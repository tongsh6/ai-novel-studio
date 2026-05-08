defmodule NovelApplication.DialogueGateway do
  @moduledoc """
  v3 对话入口。VS-03 扩展：behavior lifecycle + action roundtrip。
  """

  alias NovelApplication.CapabilityRegistry
  alias NovelApplication.ContextAssembler
  alias NovelApplication.ExecutionOrchestrator
  alias NovelApplication.Planner
  alias NovelApplication.Toolbox
  alias NovelApplication.TraceWriter
  alias NovelApplication.TurnResultBuilder
  alias NovelDomain.DialogueFrame
  alias NovelDomain.ToolRequest

  @doc "处理作者文本输入。"
  @spec handle_input(map(), (String.t() -> tuple())) :: {:ok, map(), any(), list(), any()} | {:error, term()}
  def handle_input(input, context_fetcher \\ nil)

  def handle_input(%{text: text} = input, context_fetcher) when is_binary(text) and byte_size(text) > 0 do
    ws_id = Map.get(input, :workspace_id, "default")
    generate_plan = Map.get(input, :generate_micro_plan, false)

    fetcher = context_fetcher || fn _ -> {:ok, nil, nil, nil, nil} end
    context = ContextAssembler.assemble(ws_id, fetcher)
    {frame, candidates} = Planner.form_frame(%{text: text, workspace_id: ws_id}, context)

    case DialogueFrame.validate(frame) do
      :ok ->
        if generate_plan do
          handle_with_plan(frame, candidates, context, input)
        else
          handle_reply_only(frame, candidates, context)
        end
      {:error, reasons} ->
        {:error, "frame validation failed: #{Enum.join(reasons, "; ")}"}
    end
  end

  def handle_input(_, _fetcher), do: {:error, "text is required"}

  # ── reply-only ────────────────────────────────

  defp handle_reply_only(frame, candidates, context) do
    {trace, trace_summary} = TraceWriter.record(frame, %{turn_id: frame.turn_id}, context)
    turn_result = TurnResultBuilder.build(frame, trace_summary, candidates)
    {:ok, turn_result, trace, candidates, context}
  end

  # ── plan + decision + behavior ────────────────

  defp handle_with_plan(frame, candidates, context, author_input) do
    case Planner.form_micro_plan(frame, author_input) do
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
