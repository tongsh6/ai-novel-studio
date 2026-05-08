defmodule NovelApplication.ReplayService do
  @moduledoc """
  结构化回放服务。基于 DecisionTrace + trace refs 重建决策链，不调用 LLM。
  """

  alias NovelDomain.DecisionTrace
  alias NovelDomain.ReplayReport

  @doc """
  从 DecisionTrace 构建 ReplayReport。不调用 provider。
  """
  @spec build_report(DecisionTrace.t()) :: ReplayReport.t()
  def build_report(%DecisionTrace{} = trace) do
    replay_id = "replay_#{System.unique_integer([:positive, :monotonic])}"

    %ReplayReport{
      replay_case_id: replay_id,
      trace_ref: trace.trace_id,
      turn_id: trace.turn_id,
      replay_level: :structural,
      contract_versions: %{trace_schema: "3.0-draft"},
      decision_explanation: %{
        decision_type: trace.decision_type,
        no_tool_reason: trace.no_tool_reason,
        no_behavior_reason: trace.no_behavior_reason,
        no_write_reason: trace.no_write_reason,
        event_order: trace.event_order
      },
      tool_chain: build_tool_chain(trace),
      behavior_lifecycle: build_behavior_chain(trace),
      state_changes: build_state_chain(trace),
      provider_calls_avoided: true,
      generated_at: DateTime.utc_now() |> DateTime.to_iso8601()
    }
  end

  defp build_tool_chain(trace) do
    if trace.decision_type == :tool_dispatched do
      [%{step: "tool_request", ref: trace.frame_ref, note: "tool was dispatched and traced"}]
    else
      [%{step: "no_tool", reason: trace.no_tool_reason}]
    end
  end

  defp build_behavior_chain(trace) do
    if trace.event_order |> Enum.any?(&(&1 in [:micro_plan_generated, :orchestrator_decision_recorded])) do
      [%{step: "decision", ref: trace.frame_ref, note: "orchestrator evaluated plan"}]
    else
      [%{step: "reply_only", note: "no durable behavior opened"}]
    end
  end

  defp build_state_chain(trace) do
    [%{step: "turn_result", ref: trace.turn_result_ref, note: "completed"}]
  end
end
