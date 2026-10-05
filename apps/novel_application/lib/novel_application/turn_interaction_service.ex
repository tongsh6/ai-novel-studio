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
          candidate_selection: Map.get(input, :candidate_selection)
        })
      )
    else
      {:ok, %{run_id: run.run_id, duplicate?: false}}
    end
  end

  def record_steer(run, text, store) do
    call(
      store,
      :receive,
      Map.merge(scope(run), %{
        turn_id: "#{run.parent_turn_ref}:steer:#{run.goal.version}",
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
    存在 omitted_adoptions 时，不能因未展示某项就断言该项不存在。
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

  def source_text(nil, current_text, _context, current_turn),
    do: {:ok, current_turn, current_text}

  def source_text("current", current_text, _context, current_turn),
    do: {:ok, current_turn, current_text}

  def source_text(ref, _current_text, context, current_turn) do
    case Enum.find(author_sources(context, current_turn), &(&1.turn_ref == ref)) do
      %{text: text} -> {:ok, ref, text}
      _ -> {:error, :author_content_source_not_available}
    end
  end

  def materialized_source?(context, source_ref) do
    state = Map.get(context, :interaction_state, %{})

    accepted =
      state
      |> Map.get(:resolved_adoptions, [])
      |> Enum.filter(fn entry ->
        status = entry |> value(:adoption_status) |> to_string() |> String.upcase()
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
