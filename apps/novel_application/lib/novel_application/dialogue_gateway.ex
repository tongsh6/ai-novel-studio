defmodule NovelApplication.DialogueGateway do
  @moduledoc """
  v3 对话入口。完整主链：AuthorInput → Frame → Plan → Decision → Action/Tool/Behavior → TurnResult。
  """

  require Logger

  alias NovelAgent.Provider.Gateway
  alias NovelApplication.ActionValidator
  alias NovelApplication.CapabilityRegistry
  alias NovelApplication.ContextAssembler
  alias NovelApplication.ExecutionOrchestrator
  alias NovelApplication.Planner
  alias NovelApplication.Toolbox
  alias NovelApplication.TraceWriter
  alias NovelApplication.TurnResultBuilder
  alias NovelDomain.AuthorActionInput
  alias NovelDomain.DialogueFrame
  alias NovelDomain.ToolRequest

  @doc "处理作者文本输入。可注入 complete_fn / trace_persister 用于测试和生产。"
  @spec handle_input(map(), (String.t() -> tuple()), function(), function()) ::
          {:ok, map(), any(), list(), any()} | {:error, term()}
  def handle_input(input, context_fetcher \\ nil, complete_fn \\ nil, trace_persister \\ nil)

  def handle_input(%{text: text} = input, context_fetcher, complete_fn, trace_persister)
      when is_binary(text) and byte_size(text) > 0 do
    ws_id = Map.get(input, :workspace_id, "default")
    generate_plan = Map.get(input, :generate_micro_plan, false)

    fetcher = context_fetcher || fn _ -> {:ok, nil, nil, nil, nil} end
    context = ContextAssembler.assemble(ws_id, fetcher)
    frame_input = %{text: text, workspace_id: ws_id}
    frame_fn = complete_fn || &Gateway.complete/1
    {frame, candidates} = Planner.form_frame(frame_input, context, frame_fn)

    case DialogueFrame.validate(frame) do
      :ok ->
        result =
          if generate_plan do
            handle_with_plan(frame, candidates, context, input, complete_fn)
          else
            handle_reply_only(frame, candidates, context)
          end

        maybe_persist_trace(result, ws_id, trace_persister)
        result
      {:error, reasons} ->
        {:error, "frame validation failed: #{Enum.join(reasons, "; ")}"}
    end
  end

  def handle_input(_, _fetcher, _complete_fn, _trace_persister), do: {:error, "text is required"}

  # ── trace persistence ─────────────────────────

  defp maybe_persist_trace({:ok, _turn_result, _trace, _candidates, _context}, _ws_id, nil), do: :ok
  defp maybe_persist_trace({:ok, _turn_result, trace, _candidates, _context}, ws_id, persister) do
    with attrs <- trace_to_attrs(trace, ws_id),
         :ok <- persister.(ws_id, attrs) do
      :ok
    else
      {:error, reason} ->
        Logger.warning("[DialogueGateway] trace persistence failed: #{inspect(reason)}")
        :ok
    end
  end
  defp maybe_persist_trace(_, _ws_id, _persister), do: :ok

  defp trace_to_attrs(trace, ws_id) do
    %{
      workspace_id: ws_id,
      trace_id: trace.trace_id,
      turn_id: trace.turn_id,
      frame_ref: trace.frame_ref,
      decision_type: to_string(trace.decision_type),
      no_tool_reason: trace.no_tool_reason,
      no_behavior_reason: trace.no_behavior_reason,
      no_write_reason: trace.no_write_reason,
      turn_result_ref: trace.turn_result_ref,
      replay_policy: trace.replay_policy,
      redaction_level: to_string(trace.redaction_level),
      event_order: Enum.map(trace.event_order, &to_string/1)
    }
  end

  # ── action ingestion (VS-05) ──────────────────

  @doc "处理作者动作输入（choose_candidate, confirm, reject 等）。"
  @spec handle_action(map(), map()) :: {:ok, map()} | {:error, String.t()}
  def handle_action(%AuthorActionInput{} = action_input, source_turn_result) do
    case ActionValidator.validate(action_input, source_turn_result) do
      :ok ->
        {:ok, %{action_id: action_input.action_id, action_type: action_input.action_type,
                status: "accepted", idempotency_key: action_input.idempotency_key}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # ── reply-only ────────────────────────────────

  defp handle_reply_only(frame, candidates, context) do
    {trace, trace_summary} = TraceWriter.record(frame, %{turn_id: frame.turn_id}, context)
    turn_result = TurnResultBuilder.build(frame, trace_summary, candidates)
    {:ok, turn_result, trace, candidates, context}
  end

  # ── plan + decision + behavior ────────────────

  defp handle_with_plan(frame, candidates, context, author_input, complete_fn) do
    complete = complete_fn || &Gateway.complete/1
    case Planner.form_micro_plan(frame, author_input, complete) do
      {:ok, plan} ->
        {decision, behavior} = ExecutionOrchestrator.decide(frame, plan)

        cond do
          decision.decision_type == :allow_tool ->
            handle_tool_dispatch(frame, plan, decision, candidates, context, author_input)

          behavior != nil ->
            handle_behavior_open(frame, plan, decision, behavior, candidates, context)

          true ->
            handle_blocked_plan(frame, plan, decision, candidates, context)
        end

      {:error, _reason} ->
        {trace, trace_summary} = TraceWriter.record_recovery(frame, %{turn_id: frame.turn_id}, context)
        turn_result = TurnResultBuilder.build(frame, trace_summary, candidates)
        {:ok, turn_result, trace, candidates, context}
    end
  end

  defp handle_blocked_plan(frame, plan, decision, candidates, context) do
    {trace, trace_summary} = TraceWriter.record_with_decision(frame, plan, decision, %{turn_id: frame.turn_id}, context)
    turn_result = TurnResultBuilder.build(frame, trace_summary, candidates, decision)
    {:ok, turn_result, trace, candidates, context}
  end

  defp handle_behavior_open(frame, plan, decision, behavior, candidates, context) do
    {trace, trace_summary} = TraceWriter.record_with_decision(frame, plan, decision, %{turn_id: frame.turn_id}, context)
    turn_result = TurnResultBuilder.build(frame, trace_summary, candidates, decision, nil, nil, behavior)
    {:ok, turn_result, trace, candidates, context}
  end

  # ── tool dispatch ─────────────────────────────

  defp handle_tool_dispatch(frame, plan, decision, candidates, context, author_input) do
    action = hd(plan.proposed_actions)
    tool_name = action[:target_ref] || action[:capability_name] || "text_analysis"
    entry = CapabilityRegistry.get(tool_name)

    req = %ToolRequest{
      tool_request_id: "tq_#{System.unique_integer([:positive, :monotonic])}",
      turn_id: frame.turn_id, frame_ref: frame.frame_id,
      plan_ref: plan.plan_id, decision_ref: decision.decision_id,
      tool_name: tool_name, tool_version: (entry && entry.tool_version) || "unknown",
      input: %{"text" => author_input.text, "genre" => "unknown"},
      read_scope_grants: entry && entry.read_scopes || [],
      write_scope_grants: [], idempotency_key: "idem_#{frame.turn_id}_#{tool_name}",
      trace_policy: %{level: "standard"}, created_at: DateTime.utc_now()
    }

    result = Toolbox.execute(req)

    artifact_set =
      if creative_tool?(tool_name) and result.status == :succeeded do
        TurnResultBuilder.build_artifact_set(result, frame.turn_id)
      end

    {trace, trace_summary} =
      TraceWriter.record_with_tool(frame, plan, decision, req, result, %{turn_id: frame.turn_id}, context)

    turn_result = TurnResultBuilder.build(frame, trace_summary, candidates, decision, result, artifact_set)
    {:ok, turn_result, trace, candidates, context}
  end

  defp creative_tool?("creative_generation"), do: true
  defp creative_tool?(_), do: false
end
