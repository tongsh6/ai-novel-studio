defmodule NovelApplication.DialogueGateway do
  @moduledoc """
  v3 对话入口。VS-01 扩展：按需生成 MicroPlan 并通过 ExecutionOrchestrator 裁决。
  """

  alias NovelApplication.ContextAssembler
  alias NovelApplication.ExecutionOrchestrator
  alias NovelApplication.Planner
  alias NovelApplication.TraceWriter
  alias NovelApplication.TurnResultBuilder
  alias NovelDomain.DialogueFrame

  @doc """
  处理一次作者输入。默认走 reply-only/exploration 路径。
  若 generate_plan: true，则生成 MicroPlan 并通过 Orchestrator 裁决。
  """
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

  defp handle_reply_only(frame, candidates, context) do
    {trace, trace_summary} = TraceWriter.record(frame, %{turn_id: frame.turn_id}, context)
    turn_result = TurnResultBuilder.build(frame, trace_summary, candidates, nil)
    {:ok, turn_result, trace, candidates, context}
  end

  defp handle_with_plan(frame, candidates, context, author_input) do
    case Planner.form_micro_plan(frame, author_input) do
      {:ok, plan} ->
        decision = ExecutionOrchestrator.decide(frame, plan)
        {trace, trace_summary} =
          TraceWriter.record_with_decision(frame, plan, decision, %{turn_id: frame.turn_id}, context)
        turn_result = TurnResultBuilder.build(frame, trace_summary, candidates, decision)
        {:ok, turn_result, trace, candidates, context}

      {:error, _reason} ->
        # Plan generation failed — fall back to reply-only with recovery trace
        {trace, trace_summary} = TraceWriter.record_recovery(frame, %{turn_id: frame.turn_id}, context)
        turn_result = TurnResultBuilder.build(frame, trace_summary, candidates, nil)
        {:ok, turn_result, trace, candidates, context}
    end
  end
end
