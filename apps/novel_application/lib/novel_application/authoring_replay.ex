defmodule NovelApplication.AuthoringReplay do
  @moduledoc """
  将 canonical checkpoint 投影为作者可读的历史说明。

  只读取已保存的摘要、省略说明与来源显示名；不解释 Provider 私有状态，
  不把工具调用号、对象引用或内部版本号暴露给作者。

  运行身份统一由 `NovelApplication.AgentRunHistory` 解析；本模块只负责按会话级
  canonical 执行段（`AuthoringCheckpoint.restore/2`，底层为
  `AuthoringSessionLog` 的 run 段）与 durable checkpoint 读取 canonical 历史。
  """

  alias NovelApplication.{
    AgentRunHistory,
    AuthoringCheckpoint,
    AuthoringTranscript,
    TraceRedactor
  }

  alias NovelPersistence.{AuthoringSessionLog, LongRunTaskLog, ProviderRunLog, WorkSessionRepo}

  @internal_marker ~r/\b(?:RequestIR|request_ir|provider_session|reasoning_content|call_id|tool_call)\b|\b(?:call_|run_|turn_|ctx_|trace_|pc_)[a-z0-9_-]+|\b(?:chapter|work|character):[a-z0-9_-]+/i
  @hidden_detail "运行内部信息已隐藏。"

  @doc """
  按真实 run 身份读取 canonical 历史；缺失/错绑不能冒充完整回放。

  bounded run 没有私有历史且已记录 Provider 调用数为 0 时返回
  `:not_applicable`；其余缺历史的情况返回错误，由 TraceReplay 报告 partial。

  对外错误面 `{:error, :authoring_transcript}` 是既有 API 契约字样（TraceReport 的
  `missing_trace_refs` 使用 `"authoring_transcript"`），语义=会话 canonical 创作
  历史缺失；CP1 只改存储作用域，不改该契约面，避免无关消费者迁移。
  """
  @spec fetch(String.t(), String.t(), String.t()) ::
          {:ok, [map()]} | :not_applicable | {:error, :authoring_transcript}
  def fetch(work_id, session_id, turn_id) do
    case AgentRunHistory.resolve(work_id, session_id, turn_id) do
      {:ok, run, _source} -> fetch_checkpoint(run)
      :not_applicable -> :not_applicable
      {:error, _reason} -> {:error, :authoring_transcript}
    end
  end

  defp fetch_checkpoint(run) do
    with {:ok, checkpoint_data} <- task_checkpoint(run),
         {:ok, transcript, _source} <- restore(run, checkpoint_data) do
      case transcript do
        nil -> absent_history(run)
        transcript -> {:ok, checkpoint_summaries(transcript)}
      end
    else
      _ -> {:error, :authoring_transcript}
    end
  end

  # durable 必须能按当前 run 的任务引用读取 checkpoint；bounded 没有任务时按 run
  # 读取会话执行段（run 级私有列已退役）。任务存在时仍核对 work/parent/header，
  # 防止同父轮次串用。
  defp task_checkpoint(run) do
    case run.long_run_task_ref do
      nil ->
        if run.run_mode == "durable",
          do: {:error, :checkpoint_task_missing},
          else: {:ok, nil}

      task_ref ->
        task_ref
        |> LongRunTaskLog.get()
        |> checkpoint_from_task(run)
    end
  end

  defp checkpoint_from_task(nil, _run), do: {:error, :checkpoint_task_missing}

  defp checkpoint_from_task(task, run) do
    with :ok <- validate_task_identity(task, run) do
      {:ok, task.checkpoint_data}
    end
  end

  # task 的 header/run/work/parent 必须与真实 run 完整一致。当前唯一写格式是 v3；
  # 缺失或旧版本事实是未知，不能用 run 反推或补造（未发布阶段不兼容历史格式）。
  defp validate_task_identity(task, run) do
    agent_run = value(task.checkpoint_data, :agent_run)
    header_run_id = value(agent_run, :run_id)
    version = value(agent_run, :checkpoint_version)

    cond do
      task.workspace_id != run.work_id ->
        {:error, :checkpoint_task_workspace_mismatch}

      not is_binary(task.parent_turn_ref) or task.parent_turn_ref != run.parent_turn_ref ->
        {:error, :checkpoint_task_parent_mismatch}

      version != 3 ->
        {:error, :checkpoint_version_mismatch}

      not is_binary(header_run_id) or header_run_id != run.id ->
        {:error, :checkpoint_task_run_mismatch}

      true ->
        :ok
    end
  end

  defp restore(run, checkpoint_data) do
    AuthoringCheckpoint.restore(run, checkpoint_data)
  end

  defp absent_history(run) do
    if run.run_mode == "bounded" and known_zero_provider_calls?(run),
      do: :not_applicable,
      else: {:error, :authoring_transcript}
  end

  defp known_zero_provider_calls?(run) do
    consumed_zero? =
      case run.consumed_budget |> value(:provider_calls) do
        0 -> true
        "0" -> true
        _ -> false
      end

    consumed_zero? and ProviderRunLog.list_runs(run.id) == []
  end

  @doc """
  按真实 work/session 读取**会话级** canonical 历史的作者安全摘要（跨 run）。

  返回作者可见的 checkpoint 摘要/省略说明/来源显示名与回合/run 计数，不暴露
  run/turn/call/ref 内部标识。会话不存在返回 `:session_not_found`；读取失败
  fail-closed 为 `:authoring_transcript`（不静默返回空历史）。
  """
  @spec fetch_session(String.t(), String.t()) ::
          {:ok, map()} | {:error, :session_not_found | :authoring_transcript}
  def fetch_session(work_id, session_id)
      when is_binary(work_id) and is_binary(session_id) do
    if WorkSessionRepo.get_by_work(work_id, session_id) do
      do_fetch_session(session_id)
    else
      {:error, :session_not_found}
    end
  end

  defp do_fetch_session(session_id) do
    case AuthoringSessionLog.fetch_session(session_id) do
      {:ok, %{rows: messages}} -> session_summary(messages)
      {:error, _reason} -> {:error, :authoring_transcript}
    end
  rescue
    _error -> {:error, :authoring_transcript}
  end

  defp session_summary(messages) do
    transcript = %{
      messages:
        messages
        |> Enum.map(&Map.get(&1, :message))
        |> AuthoringTranscript.normalize_messages()
    }

    {:ok,
     %{
       status: :ok,
       turn_count: Enum.count(messages, &(Map.get(&1, :role) == "user")),
       run_count:
         messages
         |> Enum.map(&Map.get(&1, :run_id))
         |> Enum.reject(&is_nil/1)
         |> Enum.uniq()
         |> length(),
       checkpoints: checkpoint_summaries(transcript)
     }}
  end

  @spec checkpoint_summaries(AuthoringTranscript.t()) :: [map()]
  def checkpoint_summaries(%{messages: messages}) when is_list(messages) do
    for %{role: "checkpoint", blocks: blocks} <- messages,
        %{type: "checkpoint"} = block <- blocks do
      %{
        summary: safe_text(block.summary),
        omissions: Enum.map(block.omissions, &safe_text/1),
        source_names: source_names(Map.get(block, :source_refs, []))
      }
    end
  end

  def checkpoint_summaries(_transcript), do: []

  defp source_names(refs) do
    refs
    |> Enum.flat_map(&source_display_name/1)
    |> Enum.uniq()
  end

  defp source_display_name(ref) when is_map(ref) do
    case value(ref, :display_name) || value(ref, :title) || value(ref, :name) do
      name when is_binary(name) and name != "" -> [safe_text(name)]
      _ -> []
    end
  end

  defp source_display_name(_ref), do: []

  defp safe_text(text) do
    if Regex.match?(@internal_marker, text),
      do: @hidden_detail,
      else: TraceRedactor.author_safe(text)
  end

  defp value(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end

  defp value(_map, _key), do: nil
end
