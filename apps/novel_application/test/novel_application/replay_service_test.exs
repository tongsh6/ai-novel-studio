defmodule NovelApplication.ReplayServiceTest do
  use ExUnit.Case, async: true

  alias NovelApplication.ReplayService
  alias NovelApplication.TraceRedactor
  alias NovelDomain.DecisionTrace
  alias NovelDomain.ReplayReport

  describe "build_report/1" do
    test "builds replay report from reply-only trace" do
      trace = %DecisionTrace{
        trace_id: "tr-reply",
        turn_id: "t-1",
        frame_ref: "f-1",
        decision_type: :reply_only,
        no_tool_reason: "no_tool_needed",
        no_behavior_reason: "reply-only",
        no_write_reason: "no write",
        turn_result_ref: "turn_result:t-1",
        event_order: [
          :author_input_received,
          :dialogue_frame_validated,
          :reply_only_decision_recorded,
          :turn_result_emitted
        ]
      }

      report = ReplayService.build_report(trace)

      assert %ReplayReport{} = report
      assert report.trace_ref == "tr-reply"
      assert report.replay_level == :structural
      assert report.provider_called == false
      assert report.result_status == :complete
      assert [_ | _] = report.decision_explanations
      assert hd(report.decision_explanations).decision_type == :reply_only
      assert length(report.chain_summary) >= 2
      assert length(report.required_questions) == 6

      assert Enum.any?(
               report.required_questions,
               &(&1.id == :planner_vs_decision and &1.status == :not_applicable)
             )
    end

    test "builds replay report from tool_dispatched trace" do
      trace = %DecisionTrace{
        trace_id: "tr-tool",
        turn_id: "t-2",
        frame_ref: "f-2",
        plan_ref: "plan-2",
        decision_type: :tool_dispatched,
        no_tool_reason: "tool_was_dispatched",
        no_behavior_reason: "tool_execution_completed",
        no_write_reason: "tool_result_not_adoption",
        turn_result_ref: "turn_result:t-2",
        tool_trace_refs: [
          %{
            tool_request_ref: "tool_request:t-2",
            tool_result_ref: "tool_result:t-2",
            tool_name: "creative_generator",
            tool_version: "vs-02",
            tool_status: :ok
          }
        ],
        event_order: [
          :author_input_received,
          :tool_request_constructed,
          :tool_dispatched,
          :tool_result_received,
          :tool_trace_recorded,
          :turn_result_emitted
        ]
      }

      report = ReplayService.build_report(trace)

      assert hd(report.decision_explanations).decision_type == :tool_dispatched

      assert hd(report.decision_explanations).tool_chain_step ==
               "tool request/result refs were recorded"

      assert Enum.any?(report.chain_summary, &(&1.step == "tool_trace"))
      assert Enum.any?(report.chain_summary, &(&1.step == "plan" and &1.ref == "plan-2"))
      assert report.result_status == :complete

      assert Enum.all?(report.required_questions, &(&1.status in [:answered, :not_applicable]))

      assert Enum.any?(
               report.required_questions,
               &(&1.id == :tool_approval and &1.status == :answered)
             )
    end

    test "tool dispatch without tool trace refs is partial instead of invented" do
      trace = %DecisionTrace{
        trace_id: "tr-tool-missing",
        turn_id: "t-tool-missing",
        frame_ref: "f-tool-missing",
        plan_ref: "plan-tool-missing",
        decision_type: :tool_dispatched,
        no_tool_reason: "tool_was_dispatched",
        no_behavior_reason: "tool_execution_completed",
        no_write_reason: "tool_result_not_adoption",
        turn_result_ref: "turn_result:t-tool-missing",
        event_order: [
          :author_input_received,
          :tool_dispatched,
          :tool_trace_recorded,
          :turn_result_emitted
        ]
      }

      report = ReplayService.build_report(trace)

      assert "tool_trace_refs" in report.missing_trace_refs
      assert report.result_status == :partial

      assert hd(report.decision_explanations).tool_chain_step ==
               "tool dispatch was recorded without tool trace refs"
    end

    test "tool replay exposes registry snapshot and redacted IO summaries" do
      trace = %DecisionTrace{
        trace_id: "tr-tool-redacted",
        turn_id: "t-tool-redacted",
        frame_ref: "f-tool-redacted",
        plan_ref: "plan-tool-redacted",
        decision_type: :tool_dispatched,
        no_tool_reason: "tool_was_dispatched",
        no_behavior_reason: "tool_execution_completed",
        no_write_reason: "tool_result_not_adoption",
        turn_result_ref: "turn_result:t-tool-redacted",
        tool_trace_refs: [
          %{
            tool_request_ref: "tool_request:t-tool-redacted",
            tool_result_ref: "tool_result:t-tool-redacted",
            tool_name: "character_roster",
            tool_version: "1.0.0",
            tool_status: :succeeded,
            registry_snapshot: %{
              tool_name: "character_roster",
              tool_version: "1.0.0",
              tool_layer: :memory,
              input_contract_ref: "character_roster_query_v1",
              output_contract_ref: "character_roster_result_v1",
              status: :active
            },
            contract_refs: %{
              input_contract_ref: "character_roster_query_v1",
              output_contract_ref: "character_roster_result_v1"
            },
            grant_summary: %{
              requested_read_scopes: ["character_list"],
              requested_write_scopes: [],
              grants_within_registry: true
            },
            request_summary: %{
              payload_type: :map,
              key_count: 1,
              keys: ["characters"],
              redacted_key_count: 0,
              payload_stored: false
            },
            result_summary: %{
              payload_type: :map,
              key_count: 2,
              keys: ["character_count", "characters"],
              redacted_key_count: 0,
              payload_stored: false,
              status: :succeeded,
              state_delta_count: 0,
              artifact_ref_count: 0
            },
            io_redaction: %{
              profile: :author_safe,
              input_payload_stored: false,
              output_payload_stored: false
            }
          }
        ],
        event_order: [
          :author_input_received,
          :micro_plan_generated,
          :tool_dispatched,
          :tool_trace_recorded,
          :turn_result_emitted
        ]
      }

      report = ReplayService.build_report(trace)
      tool_step = Enum.find(report.chain_summary, &(&1.step == "tool_trace"))
      tool_question = Enum.find(report.required_questions, &(&1.id == :tool_approval))

      assert report.result_status == :complete
      assert tool_step.registry_snapshot.tool_name == "character_roster"
      assert tool_step.registry_snapshot.tool_layer == :memory
      assert tool_step.contract_refs.input_contract_ref == "character_roster_query_v1"
      assert tool_step.contract_refs.output_contract_ref == "character_roster_result_v1"
      assert tool_step.grant_summary.grants_within_registry == true
      assert tool_step.request_summary.payload_stored == false
      assert tool_step.result_summary.payload_stored == false
      assert tool_step.io_redaction.input_payload_stored == false
      assert tool_step.io_redaction.output_payload_stored == false
      assert tool_question.status == :answered
      assert tool_question.answer =~ "registry_status=active"
      assert tool_question.answer =~ "input_contract=character_roster_query_v1"
      assert tool_question.answer =~ "output_contract=character_roster_result_v1"
      assert tool_question.answer =~ "raw_io_stored=false"
      refute TraceRedactor.unsafe?(Map.from_struct(report))
    end

    test "replay report does not call provider" do
      trace = %DecisionTrace{
        trace_id: "tr-no-provider",
        turn_id: "t-3",
        frame_ref: "f-3",
        decision_type: :reply_only,
        no_tool_reason: "exploratory_only",
        no_behavior_reason: "none",
        no_write_reason: "no write",
        turn_result_ref: "tr",
        event_order: [:author_input_received, :turn_result_emitted]
      }

      report = ReplayService.build_report(trace)
      assert report.provider_called == false
    end

    test "replay has generated_at timestamp" do
      trace = %DecisionTrace{
        trace_id: "tr-time",
        turn_id: "t-4",
        frame_ref: "f-4",
        decision_type: :reply_only,
        no_tool_reason: "none",
        no_behavior_reason: "none",
        no_write_reason: "none",
        turn_result_ref: "tr",
        event_order: [:author_input_received, :turn_result_emitted]
      }

      report = ReplayService.build_report(trace)
      assert report.generated_at != nil
    end

    test "missing_trace_refs is empty for complete trace" do
      trace = %DecisionTrace{
        trace_id: "tr-complete",
        turn_id: "t-5",
        frame_ref: "f-5",
        decision_type: :reply_only,
        no_tool_reason: "none",
        no_behavior_reason: "none",
        no_write_reason: "none",
        turn_result_ref: "tr",
        event_order: [:author_input_received, :turn_result_emitted]
      }

      report = ReplayService.build_report(trace)
      assert report.missing_trace_refs == []
    end

    test "missing_turn_result_ref detected as partial" do
      trace = %DecisionTrace{
        trace_id: "tr-partial",
        turn_id: "t-6",
        frame_ref: "f-6",
        decision_type: :reply_only,
        no_tool_reason: "none",
        no_behavior_reason: "none",
        no_write_reason: "none",
        turn_result_ref: nil,
        event_order: [:author_input_received]
      }

      report = ReplayService.build_report(trace)
      assert report.missing_trace_refs != []
      assert "turn_result_ref" in report.missing_trace_refs
      assert report.result_status == :partial
    end

    test "behavior lifecycle refs enter replay explanations" do
      trace = %DecisionTrace{
        trace_id: "tr-behavior",
        turn_id: "t-behavior",
        frame_ref: "f-behavior",
        plan_ref: "plan-behavior",
        decision_type: :confirmation_required,
        no_tool_reason: "micro_plan_evaluated_by_orchestrator",
        no_behavior_reason: "execution candidate evaluated by orchestrator",
        no_write_reason: "orchestrator blocked execution: confirmation_required",
        turn_result_ref: "turn_result:t-behavior",
        behavior_trace_refs: [
          %{
            behavior_ref: "behavior:t-behavior",
            event_type: :open,
            event_turn_ref: "t-behavior",
            decision_ref: "decision:t-behavior",
            next_status: :awaiting_author,
            target_ref: "draft:rewrite"
          }
        ],
        event_order: [
          :author_input_received,
          :orchestrator_decision_recorded,
          :behavior_trace_recorded,
          :turn_result_emitted
        ]
      }

      report = ReplayService.build_report(trace)

      assert report.result_status == :complete
      assert Enum.any?(report.chain_summary, &(&1.step == "behavior_trace"))
      assert Enum.any?(report.chain_summary, &(&1.step == "plan" and &1.ref == "plan-behavior"))
      assert [%{step: "behavior_lifecycle"}] = report.state_explanations
    end

    test "behavior decision without behavior refs is partial" do
      trace = %DecisionTrace{
        trace_id: "tr-behavior-missing",
        turn_id: "t-behavior-missing",
        frame_ref: "f-behavior-missing",
        plan_ref: "plan-behavior-missing",
        decision_type: :confirmation_required,
        no_tool_reason: "micro_plan_evaluated_by_orchestrator",
        no_behavior_reason: "execution candidate evaluated by orchestrator",
        no_write_reason: "orchestrator blocked execution: confirmation_required",
        turn_result_ref: "turn_result:t-behavior-missing",
        event_order: [
          :author_input_received,
          :orchestrator_decision_recorded,
          :behavior_trace_recorded,
          :turn_result_emitted
        ]
      }

      report = ReplayService.build_report(trace)

      assert "behavior_trace_refs" in report.missing_trace_refs
      assert report.result_status == :partial
    end

    test "terminal behavior refs expose close turn and resolution in replay" do
      trace = %DecisionTrace{
        trace_id: "tr-behavior-terminal",
        turn_id: "t-behavior-terminal",
        frame_ref: "f-behavior-terminal",
        decision_type: :cancel_waiting,
        no_tool_reason: "author_action_does_not_call_tool",
        no_behavior_reason: "author action closed waiting behavior",
        no_write_reason: "cancel waiting action does not perform production write",
        turn_result_ref: "turn_result:t-behavior-terminal",
        behavior_trace_refs: [
          %{
            behavior_ref: "behavior:t-behavior-terminal",
            event_type: :close,
            event_turn_ref: "t-behavior-terminal",
            decision_ref: "decision:t-behavior-open",
            next_status: "CANCELLED",
            target_ref: "prose_writing",
            resolution_ref: "behavior_resolution:t-behavior-terminal"
          }
        ],
        event_order: [
          :author_action_received,
          :behavior_close_requested,
          :behavior_trace_recorded,
          :behavior_resolution_recorded,
          :turn_result_emitted
        ]
      }

      report = ReplayService.build_report(trace)

      assert report.result_status == :complete

      assert Enum.any?(
               report.chain_summary,
               &(&1.step == "behavior_trace" and &1.event_type == :close and
                   &1.resolution_ref == "behavior_resolution:t-behavior-terminal")
             )

      assert [
               %{
                 step: "behavior_lifecycle",
                 behavior_ref: "behavior:t-behavior-terminal",
                 event_type: :close,
                 event_turn_ref: "t-behavior-terminal",
                 status: "CANCELLED",
                 resolution_ref: "behavior_resolution:t-behavior-terminal"
               }
             ] = report.state_explanations
    end

    test "state trace refs explain adoption and projection changes" do
      trace = %DecisionTrace{
        trace_id: "tr-state",
        turn_id: "t-state",
        frame_ref: "f-state",
        decision_type: :adopt_tentative,
        no_tool_reason: "user_requested_discussion",
        no_behavior_reason: "adoption action resolved",
        no_write_reason: "adoption boundary persisted selected state",
        turn_result_ref: "turn_result:t-state",
        state_trace_refs: [
          %{
            state_trace_ref: "state_trace:t-state",
            event_type: :candidate_adopted,
            adopted_state_ref: "chapter:1",
            projection_ref: "reading_projection:chapter:1"
          }
        ],
        event_order: [
          :author_action_received,
          :candidate_adopted,
          :state_trace_recorded,
          :projection_hint_emitted,
          :turn_result_emitted
        ]
      }

      report = ReplayService.build_report(trace)

      assert report.result_status == :complete
      assert Enum.any?(report.chain_summary, &(&1.step == "state_trace"))
      assert [%{step: "state_transition"}] = report.state_explanations
    end

    test "planner-mediated trace without plan_ref is partial and answers six questions" do
      trace = %DecisionTrace{
        trace_id: "tr-missing-plan",
        turn_id: "t-missing-plan",
        frame_ref: "f-missing-plan",
        decision_type: :tool_dispatched,
        no_tool_reason: "tool_was_dispatched",
        no_behavior_reason: "tool_execution_completed",
        no_write_reason: "tool_result_not_adoption",
        turn_result_ref: "turn_result:t-missing-plan",
        tool_trace_refs: [
          %{
            tool_request_ref: "tool_request:t-missing-plan",
            tool_result_ref: "tool_result:t-missing-plan",
            tool_name: "character_roster",
            tool_version: "1.0.0",
            tool_status: :succeeded
          }
        ],
        event_order: [
          :author_input_received,
          :micro_plan_generated,
          :tool_dispatched,
          :tool_trace_recorded,
          :turn_result_emitted
        ]
      }

      report = ReplayService.build_report(trace)

      assert report.result_status == :partial
      assert "plan_ref" in report.missing_trace_refs
      assert Enum.any?(report.chain_summary, &(&1.step == "plan_missing"))
      assert length(report.required_questions) == 6

      assert Enum.any?(
               report.required_questions,
               &(&1.id == :planner_vs_decision and &1.status == :missing)
             )
    end

    test "state-changing trace without state refs is partial" do
      trace = %DecisionTrace{
        trace_id: "tr-state-missing",
        turn_id: "t-state-missing",
        frame_ref: "f-state-missing",
        decision_type: :adopt_tentative,
        no_tool_reason: "user_requested_discussion",
        no_behavior_reason: "adoption action resolved",
        no_write_reason: "adoption boundary persisted selected state",
        turn_result_ref: "turn_result:t-state-missing",
        event_order: [
          :author_action_received,
          :candidate_adopted,
          :state_trace_recorded,
          :turn_result_emitted
        ]
      }

      report = ReplayService.build_report(trace)

      assert "state_trace_refs" in report.missing_trace_refs
      assert report.result_status == :partial
      assert [%{step: "state_trace_missing", status: :partial}] = report.state_explanations
    end
  end
end
