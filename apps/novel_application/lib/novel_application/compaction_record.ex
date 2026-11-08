defmodule NovelApplication.CompactionRecord do
  @moduledoc """
  B71 显式压缩的作者安全整理记录边界（VS-00L §16.2/§16.4；§18 提案方向）。

  只负责压缩成功后的三件事：构造 `checkpoint_created` 作者安全事件、与 checkpoint
  同一边界**先提交后发布**、投影作者可见回执。它不选择压缩范围、不读写 transcript、
  不改变运行状态；压缩派生仍由 `TranscriptCompaction` 负责。

  事件 payload 只含真实整理项数、来源显示名与（维护派生时的）保留项数；作者可见文案
  仍由前端 copy 渲染，事件只作为事实来源。事件构造失败只降级为「无整理记录」，不阻塞
  已成功的压缩；提交失败不广播、不推进内存。
  """

  require NovelTelemetry.LogEmit, as: LogEmit

  alias NovelApplication.{
    AgentEventPublisher,
    AgentRunPersistence,
    AuthoringReplay,
    TranscriptCompaction
  }

  alias NovelCommon.Contracts.AgentEvent
  alias NovelDomain.AgentRun

  @doc """
  提交压缩结果并投影作者回执。

  `state` 是已合并压缩后 transcript 的 AgentRunServer 状态 map。成功返回
  `{:ok, receipt, committed_state}`（committed 的 event_sequence/events 已含新事件）；
  失败返回 `{:error, :checkpoint_persistence_failed}`，不发布、不推进内存。
  """
  @spec commit(map(), map(), map()) ::
          {:ok, map(), map()} | {:error, :checkpoint_persistence_failed}
  def commit(%{run: %AgentRun{} = run} = state, plan, compacted) do
    event = event(state, plan, compacted)
    events = if match?({:ok, _event}, event), do: [elem(event, 1)], else: []

    with :ok <- persist(run, state, events) do
      {:ok, receipt(plan, compacted), publish(state, event)}
    end
  end

  def commit(_state, _plan, _compacted), do: {:error, :checkpoint_persistence_failed}

  @doc "作者可见回执：整理项数 + 摘要/省略说明/来源显示名（AuthoringReplay 投影）。"
  @spec receipt(map(), map()) :: map()
  def receipt(plan, compacted) do
    Map.merge(TranscriptCompaction.receipt(plan), author_view(compacted))
  end

  # ── 提交（同一 snapshot 边界）────────────────────────────────────────────

  # 显式压缩承诺可恢复历史：bounded/durable 都用同一 snapshot 事务提交 run、
  # 私有 checkpoint 与新增 author-safe 事件；这里**不能**使用运行日志的
  # best-effort 写入语义（提交失败必须不广播、不推进内存）。
  defp persist(%AgentRun{} = run, state, events) do
    with {:ok, snapshot} <- AgentRunPersistence.snapshot(run, state, :compaction, events: events),
         {:ok, _run} <- AgentRunPersistence.commit(snapshot) do
      :ok
    else
      {:error, _reason} -> {:error, :checkpoint_persistence_failed}
    end
  rescue
    error ->
      LogEmit.emit(:agent_run, :checkpoint_persistence, :error, %{
        run_id: run.run_id,
        error_type: inspect(error.__struct__)
      })

      {:error, :checkpoint_persistence_failed}
  catch
    :exit, _reason -> {:error, :checkpoint_persistence_failed}
  end

  # ── 发布（commit 成功后）────────────────────────────────────────────────

  defp publish(state, {:ok, event}) do
    committed = %{state | event_sequence: event.sequence, events: state.events ++ [event]}
    AgentEventPublisher.publish(event, committed.run)
    committed
  end

  defp publish(state, {:error, _errors}), do: state

  # ── 事件构造 / 作者可见投影 ─────────────────────────────────────────────

  # 整理记录是作者可见面的一手事实（VS-00L §18 提案方向）：只含真实整理项数与来源
  # 显示名，不含 call_id、ref 原值、版本或 canonical 内容。
  defp event(state, plan, compacted) do
    sequence = state.event_sequence + 1
    view = author_view(compacted)
    covered = plan |> Map.get(:covers, %{}) |> Map.get(:call_ids, []) |> length()

    payload =
      %{covered_exchanges: covered, sources: Map.get(view, :sources, [])}
      |> put_present(:retained_items, Map.get(plan, :retained_items))
      |> put_present(:scope, Map.get(plan, :scope))

    AgentEvent.new(%{
      event_id: "evt_#{state.run.run_id}_#{sequence}",
      run_ref: state.run.run_id,
      step_ref: state.run.current_step_ref,
      sequence: sequence,
      event_type: :checkpoint_created,
      visibility: :author,
      summary: "较早的 #{covered} 项创作过程已整理",
      reason_codes: ["transcript_compaction"],
      refs: [],
      payload: payload,
      emitted_at: DateTime.utc_now()
    })
  end

  # 作者可见面只经既有 AuthoringReplay 边界投影：摘要、省略说明与来源显示名，
  # 不含 call_id、ref 原值、版本或 canonical 内容。
  defp author_view(compacted) do
    case compacted |> AuthoringReplay.checkpoint_summaries() |> List.last() do
      %{} = summary ->
        %{
          summary: Map.get(summary, :summary),
          omissions: Map.get(summary, :omissions, []),
          sources: Map.get(summary, :source_names, [])
        }

      nil ->
        %{}
    end
  end

  defp put_present(map, _key, nil), do: map
  defp put_present(map, key, value), do: Map.put(map, key, value)
end
