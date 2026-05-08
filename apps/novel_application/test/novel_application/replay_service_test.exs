defmodule NovelApplication.ReplayServiceTest do
  use ExUnit.Case, async: true

  alias NovelApplication.ReplayService
  alias NovelDomain.DecisionTrace
  alias NovelDomain.ReplayReport

  describe "build_report/1" do
    test "builds replay report from reply-only trace" do
      trace = %DecisionTrace{
        trace_id: "tr-reply", turn_id: "t-1", frame_ref: "f-1",
        decision_type: :reply_only,
        no_tool_reason: "no_tool_needed",
        no_behavior_reason: "reply-only",
        no_write_reason: "no write",
        turn_result_ref: "turn_result:t-1",
        event_order: [:author_input_received, :dialogue_frame_validated,
                      :reply_only_decision_recorded, :turn_result_emitted]}

      report = ReplayService.build_report(trace)

      assert %ReplayReport{} = report
      assert report.trace_ref == "tr-reply"
      assert report.replay_level == :structural
      assert report.provider_called == false
      assert report.result_status == :complete
      assert report.decision_explanations != []
      assert hd(report.decision_explanations).decision_type == :reply_only
      assert length(report.chain_summary) >= 2
    end

    test "builds replay report from tool_dispatched trace" do
      trace = %DecisionTrace{
        trace_id: "tr-tool", turn_id: "t-2", frame_ref: "f-2",
        decision_type: :tool_dispatched,
        no_tool_reason: "tool_was_dispatched",
        no_behavior_reason: "tool_execution_completed",
        no_write_reason: "tool_result_not_adoption",
        turn_result_ref: "turn_result:t-2",
        event_order: [:author_input_received, :tool_request_constructed,
                      :tool_dispatched, :tool_result_received,
                      :tool_trace_recorded, :turn_result_emitted]}

      report = ReplayService.build_report(trace)

      assert hd(report.decision_explanations).decision_type == :tool_dispatched
      assert hd(report.decision_explanations).tool_chain_step != nil
    end

    test "replay report does not call provider" do
      trace = %DecisionTrace{
        trace_id: "tr-no-provider", turn_id: "t-3", frame_ref: "f-3",
        decision_type: :reply_only,
        no_tool_reason: "exploratory_only", no_behavior_reason: "none",
        no_write_reason: "no write", turn_result_ref: "tr",
        event_order: [:author_input_received, :turn_result_emitted]}

      report = ReplayService.build_report(trace)
      assert report.provider_called == false
    end

    test "replay has generated_at timestamp" do
      trace = %DecisionTrace{
        trace_id: "tr-time", turn_id: "t-4", frame_ref: "f-4",
        decision_type: :reply_only,
        no_tool_reason: "none", no_behavior_reason: "none",
        no_write_reason: "none", turn_result_ref: "tr",
        event_order: [:author_input_received, :turn_result_emitted]}

      report = ReplayService.build_report(trace)
      assert report.generated_at != nil
    end

    test "missing_trace_refs is empty for complete trace" do
      trace = %DecisionTrace{
        trace_id: "tr-complete", turn_id: "t-5", frame_ref: "f-5",
        decision_type: :reply_only,
        no_tool_reason: "none", no_behavior_reason: "none",
        no_write_reason: "none", turn_result_ref: "tr",
        event_order: [:author_input_received, :turn_result_emitted]}

      report = ReplayService.build_report(trace)
      assert report.missing_trace_refs == []
    end

    test "missing_turn_result_ref detected as partial" do
      trace = %DecisionTrace{
        trace_id: "tr-partial", turn_id: "t-6", frame_ref: "f-6",
        decision_type: :reply_only,
        no_tool_reason: "none", no_behavior_reason: "none",
        no_write_reason: "none",
        turn_result_ref: nil,
        event_order: [:author_input_received]}

      report = ReplayService.build_report(trace)
      assert report.missing_trace_refs != []
      assert "turn_result_ref" in report.missing_trace_refs
      assert report.result_status == :partial
    end
  end
end
