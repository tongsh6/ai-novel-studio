defmodule NovelApplication.AuthorQuestion do
  @moduledoc "B26：模型问题与真实源动作的确定性投影，不从文本推断授权。"

  def turn_result(run, judgment) do
    id = turn_id(run, judgment)

    frame = %NovelDomain.DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame:#{identity(run, judgment)}",
      turn_id: id,
      workspace_id: run.workspace_id,
      primary: true,
      frame_type:
        if(judgment.action == "capability_gap", do: :capability_gap, else: :question_answer),
      source_refs: %{
        author_input_ref: NovelApplication.TurnInteractionService.input_ref(run),
        dialogue_context_ref: nil
      },
      dialogue_goal: %{summary: judgment.dialogue_goal || run.goal.text},
      tool_need: %{needs_tool: false, reason_code: :no_tool_requested},
      execution_readiness: :not_applicable,
      author_visible_draft: %{message: judgment.narrative},
      evidence_summary: %{frame_origin: "model_tool", reply_record: judgment.reply_record}
    }

    {trace, summary} = NovelApplication.TraceWriter.record(frame, %{turn_id: id})

    result =
      NovelApplication.TurnResultBuilder.build(frame, summary)
      |> NovelApplication.AgentFinalizer.attach_run_summary(%{
        run_id: run.run_id,
        run_mode: run.run_mode,
        parent_turn_ref: run.parent_turn_ref,
        profile_ref: run.profile_ref,
        status: if(judgment.action == "await_author", do: :awaiting_author, else: :completed)
      })
      |> Map.put(
        :outcome,
        if(judgment.action == "capability_gap", do: "goal_unfulfilled", else: "await_author")
      )

    result = if judgment.action == "await_author", do: attach(result, judgment, run), else: result
    {result, trace}
  end

  def turn_id(run, judgment) do
    "#{run.parent_turn_ref}:question:#{identity(run, judgment)}"
  end

  def attach(result, judgment, run) do
    ref = "question:#{identity(run, judgment)}"

    question = %{
      question_ref: ref,
      run_id: run.run_id,
      goal_version: run.goal.version,
      source_turn_ref: result.turn_id,
      question: judgment.question,
      options: judgment.options,
      status: "open",
      close_reason: nil,
      provider_call_ref: judgment.narrative_source.provider_call_ref
    }

    actions = Enum.map(judgment.options, &action(question, &1)) ++ [action(question, nil)]

    result
    |> Map.put(:author_question, question)
    |> Map.put(:available_actions, actions)
    |> Map.put(:phase, "awaiting_author")
    |> Map.put(
      :status,
      if(judgment.options == [], do: "needs_clarification", else: "needs_selection")
    )
    |> Map.put(:next_action, "waiting_for_author")
  end

  defp identity(run, judgment) do
    hash(
      {run.run_id, run.goal.version, judgment.narrative_source.provider_call_ref,
       judgment.tool_call_id}
    )
  end

  defp action(question, option) do
    value = field(option, :value)
    id = "answer:#{hash({question.question_ref, value})}"

    base = %{
      action_id: id,
      action_type: "author_choice",
      target_ref: question.run_id,
      source_turn_ref: question.source_turn_ref,
      question_ref: question.question_ref,
      expected_goal_version: question.goal_version,
      response_kind: field(option, :kind) || if(option, do: "choice", else: "free_text"),
      label_key: if(option, do: "author_question.option", else: "author_question.reply"),
      enabled: true,
      idempotency_key: "idem:#{id}",
      trace_ref: question.provider_call_ref
    }

    if option,
      do: Map.merge(base, %{candidate_ref: value, label: field(option, :label)}),
      else: base
  end

  @doc "状态投影只改状态与动作可用性，原问题/选项字节保持。"
  def project(result, run, live?, read_only? \\ false) do
    q = field(result, :author_question)
    {status, reason} = status(q, run, live?)
    ready? = live? and to_string(field(run, :status)) == "awaiting_author"
    enabled = status == "open" and ready? and not read_only?

    result
    |> Map.put(
      :author_question,
      Map.merge(Map.drop(q, ["status", "close_reason"]), %{status: status, close_reason: reason})
    )
    |> Map.delete("author_question")
    |> Map.put(
      :available_actions,
      Enum.map(field(result, :available_actions) || [], fn action ->
        action |> Map.put(:enabled, enabled) |> Map.delete("enabled")
      end)
    )
    |> Map.delete("available_actions")
  end

  defp status(q, run, live?) do
    case field(q, :status) do
      "answered" -> {"answered", "answered"}
      "closed" -> {"closed", field(q, :close_reason)}
      _ -> runtime_status(q, run, live?)
    end
  end

  defp runtime_status(_q, nil, _live?), do: {"closed", "runtime_lost"}

  defp runtime_status(q, run, live?) do
    cond do
      goal_version(run) != field(q, :goal_version) -> {"closed", "superseded"}
      to_string(field(run, :status)) == "cancelled" -> {"closed", "cancelled"}
      not live? and to_string(field(run, :run_mode)) == "bounded" -> {"closed", "runtime_lost"}
      to_string(field(run, :status)) in ~w(completed failed) -> {"closed", "terminal"}
      true -> {"open", nil}
    end
  end

  defp goal_version(run), do: field(run, :goal_version) || field(field(run, :goal), :version)

  def validate_reply(run, request, source) do
    q = field(source, :author_question)

    with true <- run.work_id == request.workspace_id and run.session_id == request.session_id,
         true <- run.status == :awaiting_author,
         true <- run.goal.version == request.expected_goal_version,
         true <- field(q, :status) == "open" and field(q, :question_ref) == request.question_ref,
         :ok <- NovelApplication.ActionValidator.validate(request.action_input, source) do
      :ok
    else
      _ -> {:error, :stale_author_question}
    end
  end

  def hash(value),
    do: :crypto.hash(:sha256, :erlang.term_to_binary(value)) |> Base.encode16(case: :lower)

  defp field(map, key) when is_map(map), do: Map.get(map, key, Map.get(map, to_string(key)))
  defp field(_, _), do: nil
end
