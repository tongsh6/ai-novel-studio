defmodule NovelApplication.TurnInteractionService do
  @moduledoc """
  ADR-0027：统一作者消息接收和 AgentRun 结果记录边界。
  处置状态只描述消息处理；作品入档以采纳事实为准。
  """

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelApplication.DialogueGateway

  @author_preview_chars 600
  @adoption_preview_limit 12

  def store, do: NovelApplication.persistence_interaction_lifecycle()

  def receive_input(run, store, input \\ %{}) do
    if user_message?(run) do
      call(
        store,
        :receive,
        Map.merge(scope(run), %{
          turn_id: run.parent_turn_ref,
          text: Map.get(input, :text, run.goal.text),
          candidate_selection: Map.get(input, :candidate_selection),
          generate_micro_plan: Map.get(input, :generate_micro_plan, false)
        })
      )
    else
      {:ok, %{run_id: run.run_id, duplicate?: false}}
    end
  end

  def record_steer(run, text, store, submission_id \\ nil) do
    call(
      store,
      :receive,
      Map.merge(scope(run), %{
        turn_id: "#{run.parent_turn_ref}:steer:#{run.goal.version}",
        submission_id: submission_id || "#{run.parent_turn_ref}:steer:#{run.goal.version}",
        message_kind: "steer",
        text: text
      })
    )
  end

  def record_result(_run, nil, _store), do: :ok

  def record_result(run, result, store) when is_map(result) do
    attrs = Map.put(scope(run), :turn_result, DialogueGateway.jsonable(result))

    case call(store, :result, attrs) do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  def record_status(run, store) do
    case call(store, :status, scope(run)) do
      {:ok, _} ->
        :ok

      {:error, reason} ->
        LogEmit.emit(:dialogue_gateway, :persist_interaction, :error, %{
          run_id: run.run_id,
          reason_code: :message_status_persistence_failed
        })

        {:error, reason}
    end
  end

  def context_section(state) when is_map(state) do
    sources =
      state
      |> Map.get(:author_inputs, [])
      |> Enum.map(
        &Map.update!(&1, :text, fn text -> String.slice(text, 0, @author_preview_chars) end)
      )

    facts = %{
      author_inputs: sources,
      pending_adoptions: adoption_preview(state, :pending_adoptions),
      resolved_adoptions: adoption_preview(state, :resolved_adoptions),
      recent_results: Map.get(state, :recent_results, []),
      pending_adoption_count: length(Map.get(state, :pending_adoptions, [])),
      resolved_adoption_count: length(Map.get(state, :resolved_adoptions, [])),
      omitted_adoptions:
        max(length(Map.get(state, :pending_adoptions, [])) - @adoption_preview_limit, 0) +
          max(length(Map.get(state, :resolved_adoptions, [])) - @adoption_preview_limit, 0)
    }

    """
    ## 消息处置与已有产物
    下列是当前作品和会话的记录事实。processed_at 表示消息已处理；run completed 只表示
    一次运行结束，不代表已保存。resolved 中只有 ACCEPTED/EDITED_ACCEPTED 表示采纳，
    DISCARDED 等不表示入档。存档必须核对采纳/实际写入事实；pending
    仍须作者采纳。状态追问不应重开创作或反复要求作者重发同一指令。
    author_inputs 的原文预览可能截短，引用保存时系统会读取该 turn_ref 的完整原文。
    存在 omitted_adoptions 时，不能因未展示某项就断言该项不存在；
    可使用探索目录 session_adoptions 按关键词/对象引用查询完整状态，按 next_offset 翻页。
    引用编号只用于工具字段，禁止在作者可见叙事中输出内部编号。
    #{Jason.encode!(facts)}
    """
  end

  def context_section(_state), do: ""

  def input_ref(%{goal: %{version: version}, parent_turn_ref: parent}) when version > 1,
    do: "#{parent}:steer:#{version}"

  def input_ref(run), do: run.parent_turn_ref

  def author_sources(context, current_turn) do
    context
    |> Map.get(:interaction_state, %{})
    |> Map.get(:author_inputs, [])
    |> Enum.reject(&(&1.turn_ref == current_turn))
  end

  def current_text(context, current_ref, fallback) do
    context
    |> Map.get(:interaction_state, %{})
    |> Map.get(:author_inputs, [])
    |> Enum.find_value(fallback, fn entry -> if entry.turn_ref == current_ref, do: entry.text end)
  end

  @doc "原文登记的联合前置条件；只有显式来源和保真分支可以进入物化。"
  def validate_author_registration(judgment, sources) do
    result =
      case value(judgment, :author_content_registration) do
        true -> validate_registration_fields(judgment, sources)
        flag when flag in [nil, false] -> :ok
        _ -> {:error, :invalid_signal}
      end

    case result do
      :ok -> :ok
      {:error, reason} -> {:error, {:author_content_registration_invalid, reason}}
    end
  end

  defp validate_registration_fields(judgment, sources) do
    source = value(judgment, :author_content_source_ref)

    cond do
      value(judgment, :action) != "reply" or
          value(judgment, :frame_type) != "capability_gap" ->
        {:error, :operation_conflict}

      is_nil(source) or source == "" ->
        {:error, :source_required}

      source not in ["current" | sources] ->
        {:error, :source_not_available}

      true ->
        :ok
    end
  end

  @doc "两阶段共用的业务规则；登记作者原文与生成新内容是不同操作。"
  def author_registration_rules do
    """
    ## 原文登记与采纳规则（优先于一般形态映射）
    - 作者只要求把资料留在本次对话、暂不展开或生成候选时，只确认收到，不登记原文、不产方向或产物。
      对话中已留存原输入不等于作品档案已入档；后续作者明确要求登记或生成候选时再处理。
    - 作者明确要求把具体原文登记进作品档案或物化为待采纳候选时，按原文登记处理：选择直接回复，明确原文将成为
      待采纳的作品设定候选；应用按来源逐字复制，不调用创作能力重写，也不直接写入档案。
    - 原文来源必须明确：本条资料与已列出的历史资料分别引用，不能把来源缺失猜成当前
      保存指令。来源不明确时等待作者补充，不登记、不生成候选。
    - 同一来源已有待采纳候选时，引导作者采纳；已经采纳时据实际事实回答，不重复生成。
      状态追问不重开创作，运行完成不等于已保存，只有采纳/实际写入事实支持已入档的说法。
    - 只有作者确实要求生成或改写新内容时，才选择创作执行；不能把原文登记转成创作重写。
    """
  end

  def author_registration_retry_hint(reason, sources) do
    detail =
      case reason do
        :operation_conflict ->
          "author_content_registration=true 只能搭配 action=reply、frame_type=capability_gap。"

        :source_required ->
          "启用原文登记时 author_content_source_ref 必填，不能为 null 或缺失。"

        :source_not_available ->
          "原文来源不在本次上下文的合法来源集合内。"

        :invalid_signal ->
          "author_content_registration 必须是布尔值。"
      end

    detail <>
      "来源只能填 #{Enum.join(["current" | sources], " / ")}；必须按作者意图修正，" <>
      "不能把保留原文改成创作重写来绕过校验。来源不明确时 action=await_author，" <>
      "author_content_registration=false，请求作者补充来源。"
  end

  @doc "业务校验失败后的作者安全说明，不暴露机器编号或模型原始载荷。"
  def author_registration_failure_message(reason)
      when reason in [:source_required, :source_not_available],
      do: "这次未能确定要保存的原文来源，没有生成候选或写入档案。请明确指出要保存哪条资料，或重新提供原文。"

  def author_registration_failure_message(_reason),
    do: "这次原文登记的处理方式未通过校验，已停止，没有改写原文、生成候选或写入档案。请明确要保留哪份原文后再试。"

  def source_text(nil, _current_text, _context, _current_turn),
    do: {:error, {:author_content_registration_invalid, :source_required}}

  def source_text("current", current_text, _context, current_turn),
    do: {:ok, current_turn, current_text}

  def source_text(ref, _current_text, context, current_turn) do
    case Enum.find(author_sources(context, current_turn), &(&1.turn_ref == ref)) do
      %{text: text} -> {:ok, ref, text}
      _ -> {:error, {:author_content_registration_invalid, :source_not_available}}
    end
  end

  def materialized_source?(context, source_ref) do
    state = Map.get(context, :interaction_state, %{})

    accepted =
      state
      |> Map.get(:resolved_adoptions, [])
      |> Enum.filter(fn entry ->
        status = value(entry, :adoption_status)
        status in NovelDomain.AdoptionStatus.canon_statuses()
      end)

    (Map.get(state, :pending_adoptions, []) ++ accepted)
    |> Enum.any?(&(author_source_ref(&1) == "author_input:#{source_ref}"))
  end

  defp author_source_ref(entry) do
    payload = value(entry, :payload) || %{}

    case value(payload, :items) do
      [item | _] -> value(entry, :source_tool_result_ref) || value(item, :provider_call_ref)
      _ -> value(entry, :source_tool_result_ref)
    end
  end

  defp adoption_preview(state, key) do
    state
    |> Map.get(key, [])
    |> Enum.take(@adoption_preview_limit)
    |> Enum.map(&adoption_summary/1)
  end

  defp adoption_summary(entry) do
    payload = value(entry, :payload) || %{}

    %{
      artifact_ref: value(entry, :artifact_id),
      status: value(entry, :adoption_status),
      artifact_type: value(entry, :artifact_type),
      source_ref: author_source_ref(entry),
      title: value(payload, :summary) || first_title(payload)
    }
  end

  defp first_title(payload) do
    case value(payload, :items) do
      [item | _] -> value(item, :title)
      _ -> nil
    end
  end

  defp user_message?(run), do: value(run.trigger || %{}, :kind) == "user_message"

  defp scope(run) do
    %{
      workspace_id: run.workspace_id,
      session_id: run.session_id,
      run_id: run.run_id,
      status: run.status,
      goal_version: run.goal.version
    }
  end

  defp call(nil, :receive, attrs), do: {:ok, %{run_id: attrs.run_id, duplicate?: false}}
  defp call(nil, _operation, _attrs), do: {:ok, :not_configured}

  defp call(store, operation, attrs) when is_function(store, 2) do
    store.(operation, attrs)
  rescue
    _ -> {:error, :interaction_store_unavailable}
  catch
    _, _ -> {:error, :interaction_store_unavailable}
  end

  defp value(map, key), do: Map.get(map, key) || Map.get(map, Atom.to_string(key))
end
