defmodule NovelApplication.ReplayService do
  @moduledoc """
  结构化回放服务。基于 DecisionTrace + trace refs 重建决策链，不调用 LLM。

  规格见 docs/design-v3/contracts/VS-06-replay-surface-contract-pack.md §4。
  """

  alias NovelApplication.TraceRedactor
  alias NovelDomain.DecisionTrace
  alias NovelDomain.ReplayReport

  @doc """
  从 DecisionTrace 构建 ReplayReport。不调用 provider。
  """
  @spec build_report(DecisionTrace.t()) :: ReplayReport.t()
  def build_report(%DecisionTrace{} = trace) do
    replay_id = "replay_#{System.unique_integer([:positive, :monotonic])}"

    %ReplayReport{
      replay_report_id: replay_id,
      replay_case_ref: "replay_case:#{trace.trace_id}",
      trace_ref: trace.trace_id,
      replay_level: :structural,
      chain_summary: TraceRedactor.author_safe(build_chain_summary(trace)),
      decision_explanations: TraceRedactor.author_safe(build_decision_explanations(trace)),
      state_explanations: TraceRedactor.author_safe(build_state_explanations(trace)),
      missing_trace_refs: find_missing_refs(trace),
      redaction_profile: :author_safe,
      provider_called: false,
      result_status: result_status(trace),
      generated_at: DateTime.utc_now() |> DateTime.to_iso8601()
    }
  end

  # ── chain ────────────────────────────────────────

  defp build_chain_summary(trace) do
    [
      %{step: "frame", ref: trace.frame_ref, note: "DialogueFrame formed"},
      %{step: "decision", type: trace.decision_type, note: "Orchestrator decision recorded"},
      %{step: "turn_result", ref: trace.turn_result_ref, note: "TurnResult emitted"}
    ]
  end

  defp build_decision_explanations(trace) do
    entry = %{
      decision_type: trace.decision_type,
      no_tool_reason: trace.no_tool_reason,
      no_behavior_reason: trace.no_behavior_reason,
      no_write_reason: trace.no_write_reason
    }

    if trace.decision_type == :tool_dispatched do
      [Map.put(entry, :tool_chain_step, "tool was dispatched and traced")]
    else
      [Map.put(entry, :execution_blocked, true)]
    end
  end

  defp build_state_explanations(_trace) do
    [%{step: "candidate_boundary", note: "no production write in this turn"}]
  end

  defp find_missing_refs(trace) do
    missing = []
    missing = if is_nil(trace.turn_result_ref), do: ["turn_result_ref" | missing], else: missing
    Enum.reverse(missing)
  end

  defp result_status(trace) do
    if trace.event_order != [] and not is_nil(trace.turn_result_ref) do
      :complete
    else
      :partial
    end
  end
end
