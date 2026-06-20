defmodule NovelApplication.ExecutionAuthorityTest do
  use ExUnit.Case, async: true

  alias NovelApplication.ExecutionOrchestrator
  alias NovelApplication.GateOrder
  alias NovelApplication.PlannerBoundary
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  # Test helpers — build realistic test structs

  defp build_frame(attrs) do
    struct!(
      DialogueFrame,
      Keyword.merge(
        [
          schema_version: "3.0-draft",
          frame_id: "f-test",
          turn_id: "t-test",
          workspace_id: "ws-test",
          primary: true,
          frame_type: :casual_reply,
          source_refs: %{author_input_ref: "a-test", dialogue_context_ref: nil},
          dialogue_goal: %{summary: "测试意图"},
          tool_need: %{needs_tool: true, reason_code: :insufficient_execution_target},
          execution_readiness: :not_ready,
          author_visible_draft: %{message: "test"},
          uncertainty: []
        ],
        attrs
      )
    )
  end

  defp build_plan(attrs \\ []) do
    defaults = [
      plan_id: "p-test",
      turn_id: "t-test",
      frame_ref: "f-test",
      plan_goal: %{summary: "测试计划"},
      risk_hint: :low,
      requires_confirmation_hint: false,
      proposed_actions: [
        %{
          action_id: "act-1",
          action_type: :clarification_request,
          summary: "澄清需求",
          target_ref: nil,
          write_intent: :none,
          risk_hint: :low
        }
      ],
      state_changes_requested: [],
      required_capabilities: [],
      fallback_strategy: %{downgrade_message: "先聊聊方向"}
    ]

    struct!(MicroPlan, Keyword.merge(defaults, attrs))
  end

  # ── PlannerOutput Boundary ──────────────────────

  describe "PlannerBoundary" do
    test "rejects frame_ref mismatch" do
      frame = build_frame(frame_id: "f-real")
      plan = build_plan(frame_ref: "f-wrong")

      assert {:error, reason} = PlannerBoundary.validate(frame, plan)
      assert String.contains?(reason, "frame_ref")
    end

    test "rejects stop_after_next_action = false" do
      frame = build_frame(frame_id: "f-match")
      plan = build_plan(frame_ref: "f-match", stop_after_next_action: false)

      assert {:error, reason} = PlannerBoundary.validate(frame, plan)
      assert String.contains?(reason, "stop_after_next_action")
    end

    test "accepts valid frame-plan pair" do
      frame = build_frame(frame_id: "f-ok")
      plan = build_plan(frame_ref: "f-ok", stop_after_next_action: true)

      assert :ok = PlannerBoundary.validate(frame, plan)
    end
  end

  # ── MicroPlan Forbidden Semantics ───────────────

  describe "MicroPlan forbidden semantics" do
    test "rejects 'approved' in plan content" do
      plan = build_plan(plan_goal: %{summary: "this plan is approved and ready_to_execute"})

      assert {:error, terms} = MicroPlan.check_forbidden(plan)
      assert "approved" in terms
    end

    test "rejects 'production_write_allowed' in action summary" do
      plan =
        build_plan(
          proposed_actions: [
            %{
              action_id: "a",
              action_type: :tentative_artifact,
              summary: "production_write_allowed",
              target_ref: nil,
              write_intent: :production_candidate,
              risk_hint: :high
            }
          ]
        )

      assert {:error, terms} = MicroPlan.check_forbidden(plan)
      assert "production_write_allowed" in terms
    end

    test "accepts clean plan" do
      plan = build_plan()
      assert :ok = MicroPlan.check_forbidden(plan)
    end
  end

  # ── Gate Order ─────────────────────────────────

  describe "GateOrder" do
    test "multi-step plan blocked by action_scope gate" do
      plan =
        build_plan(
          proposed_actions: [
            %{
              action_id: "a1",
              action_type: :tentative_artifact,
              summary: "动作1",
              target_ref: nil,
              write_intent: :tentative,
              risk_hint: :low
            },
            %{
              action_id: "a2",
              action_type: :state_change_request,
              summary: "动作2",
              target_ref: nil,
              write_intent: :none,
              risk_hint: :low
            }
          ]
        )

      assert MicroPlan.multi_step?(plan)
      assert {:block, :action_scope, _, _} = GateOrder.evaluate(plan)
    end

    test "high-risk plan blocked by authority gate" do
      plan =
        build_plan(
          risk_hint: :high,
          proposed_actions: [
            %{
              action_id: "a1",
              action_type: :tentative_artifact,
              summary: "危险操作",
              target_ref: nil,
              write_intent: :tentative,
              risk_hint: :high
            }
          ]
        )

      assert MicroPlan.high_risk?(plan)
      assert {:block, :authority, _, _} = GateOrder.evaluate(plan)
    end

    test "production_candidate blocked by write_boundary gate" do
      plan =
        build_plan(
          risk_hint: :low,
          proposed_actions: [
            %{
              action_id: "a1",
              action_type: :tentative_artifact,
              summary: "写生产数据",
              target_ref: nil,
              write_intent: :production_candidate,
              risk_hint: :medium
            }
          ]
        )

      assert MicroPlan.production_candidate_count(plan) > 0
      assert {:block, :write_boundary, _, _} = GateOrder.evaluate(plan)
    end

    test "forbidden semantics blocked by envelope_validation gate" do
      plan = build_plan(plan_goal: %{summary: "approved execution plan"})

      assert {:block, :envelope_validation, _, _} = GateOrder.evaluate(plan)
    end

    test "low-risk single-step plan passes gates" do
      plan =
        build_plan(
          risk_hint: :low,
          proposed_actions: [
            %{
              action_id: "a1",
              action_type: :clarification_request,
              summary: "澄清",
              target_ref: nil,
              write_intent: :none,
              risk_hint: :low
            }
          ]
        )

      assert {:pass, _results} = GateOrder.evaluate(plan)
    end
  end

  # ── Orchestrator Decision ──────────────────────

  describe "ExecutionOrchestrator" do
    test "multi-step plan → downgrade_to_dialogue" do
      frame = build_frame(frame_id: "f-dg")

      plan =
        build_plan(
          frame_ref: "f-dg",
          proposed_actions: [
            %{
              action_id: "a1",
              action_type: :tentative_artifact,
              summary: "动作1",
              target_ref: nil,
              write_intent: :tentative,
              risk_hint: :low
            },
            %{
              action_id: "a2",
              action_type: :state_change_request,
              summary: "动作2",
              target_ref: nil,
              write_intent: :none,
              risk_hint: :low
            }
          ]
        )

      {decision, _behavior} = ExecutionOrchestrator.decide(frame, plan)

      assert decision.decision_type == :downgrade_to_dialogue
      assert decision.first_blocking_gate == "action_scope"
      assert OrchestratorDecision.blocks_execution?(decision)
    end

    test "high-risk plan → require_confirmation" do
      frame = build_frame(frame_id: "f-hr")

      plan =
        build_plan(
          frame_ref: "f-hr",
          risk_hint: :high,
          proposed_actions: [
            %{
              action_id: "a1",
              action_type: :tentative_artifact,
              summary: "危险",
              target_ref: nil,
              write_intent: :tentative,
              risk_hint: :high
            }
          ]
        )

      {decision, _behavior} = ExecutionOrchestrator.decide(frame, plan)

      assert decision.decision_type == :require_confirmation
      assert OrchestratorDecision.blocks_execution?(decision)
    end

    test "high-risk plan with confirm binding re-gates to allow_tool (ADR-0009)" do
      frame = build_frame(frame_id: "f-hr-confirm")

      plan =
        build_plan(
          frame_ref: "f-hr-confirm",
          risk_hint: :high,
          proposed_actions: [
            %{
              action_id: "a1",
              action_type: :capability_invocation,
              summary: "重写第一章正文",
              target_ref: "prose_writing",
              write_intent: :production_candidate,
              risk_hint: :high
            }
          ]
        )

      # 无确认 → 拦；携带有效确认绑定 → 放行，且裁决留下绑定证明。
      {blocked, _} = ExecutionOrchestrator.decide(frame, plan)
      assert blocked.decision_type == :require_confirmation

      {:ok, binding} =
        NovelDomain.ConfirmationBinding.build(%{
          behavior_ref: "bh-1",
          target_ref: "prose_writing",
          author_input_ref: "in-1",
          answer_type: :confirm,
          idempotency_key: "ik-1",
          rebased_state_snapshot_ref: "state_snapshot:work-1:turn-1:plan-1",
          gate_result_refs: ["gate_result:turn-1:plan-1:confirm"]
        })

      {decision, behavior} =
        ExecutionOrchestrator.decide(frame, plan, confirmation_binding: binding)

      assert decision.decision_type == :allow_tool
      assert behavior == nil
      assert Enum.any?(decision.reason_codes, &String.starts_with?(&1, "confirmed_by:"))
      assert "rebased_state_snapshot:state_snapshot:work-1:turn-1:plan-1" in decision.reason_codes
      assert "gate_result_ref:gate_result:turn-1:plan-1:confirm" in decision.reason_codes
    end

    test "reject binding does not unlock high-risk plan" do
      frame = build_frame(frame_id: "f-hr-reject")

      plan =
        build_plan(
          frame_ref: "f-hr-reject",
          risk_hint: :high,
          proposed_actions: [
            %{
              action_id: "a1",
              action_type: :capability_invocation,
              summary: "重写",
              target_ref: "prose_writing",
              write_intent: :tentative,
              risk_hint: :high
            }
          ]
        )

      {:ok, binding} =
        NovelDomain.ConfirmationBinding.build(%{
          behavior_ref: "bh-1",
          target_ref: "prose_writing",
          author_input_ref: "in-1",
          answer_type: :reject,
          rebased_state_snapshot_ref: "state_snapshot:work-1:turn-1:plan-1",
          gate_result_refs: ["gate_result:turn-1:plan-1:reject"]
        })

      {decision, _behavior} =
        ExecutionOrchestrator.decide(frame, plan, confirmation_binding: binding)

      assert decision.decision_type == :require_confirmation
      refute Enum.any?(decision.reason_codes, &String.starts_with?(&1, "confirmed_by:"))
    end

    test "confirm binding does not bypass non-confirmation gates (multi-step still blocked)" do
      frame = build_frame(frame_id: "f-hr-multi")

      action = %{
        action_id: "a1",
        action_type: :capability_invocation,
        summary: "动作",
        target_ref: "prose_writing",
        write_intent: :tentative,
        risk_hint: :high
      }

      plan =
        build_plan(
          frame_ref: "f-hr-multi",
          risk_hint: :high,
          proposed_actions: [action, Map.put(action, :action_id, "a2")]
        )

      {:ok, binding} =
        NovelDomain.ConfirmationBinding.build(%{
          behavior_ref: "bh-1",
          target_ref: "prose_writing",
          author_input_ref: "in-1",
          answer_type: :confirm,
          rebased_state_snapshot_ref: "state_snapshot:work-1:turn-1:plan-1",
          gate_result_refs: ["gate_result:turn-1:plan-1:confirm"]
        })

      {decision, _behavior} =
        ExecutionOrchestrator.decide(frame, plan, confirmation_binding: binding)

      # 确认满足的只是 authority/write_boundary；多步 plan 仍被 action_scope 拦
      # （VS-03 §6：确认不等于 gate 一定通过）。
      assert decision.decision_type == :downgrade_to_dialogue
      assert decision.first_blocking_gate == "action_scope"
    end

    test "frame_ref mismatch → fail_with_recovery" do
      frame = build_frame(frame_id: "f-real-2")
      plan = build_plan(frame_ref: "f-wrong-2")

      {decision, _behavior} = ExecutionOrchestrator.decide(frame, plan)

      assert decision.decision_type == :fail_with_recovery
      assert decision.first_blocking_gate == "planner_boundary"
    end

    test "production_candidate write → require_confirmation" do
      frame = build_frame(frame_id: "f-prod")

      plan =
        build_plan(
          frame_ref: "f-prod",
          risk_hint: :low,
          proposed_actions: [
            %{
              action_id: "a1",
              action_type: :tentative_artifact,
              summary: "写生产",
              target_ref: nil,
              write_intent: :production_candidate,
              risk_hint: :medium
            }
          ]
        )

      {decision, _behavior} = ExecutionOrchestrator.decide(frame, plan)

      assert decision.decision_type in [:require_confirmation, :downgrade_to_dialogue]
      assert OrchestratorDecision.blocks_execution?(decision)
    end

    test "truthfulness constraints prevent claiming execution" do
      frame = build_frame(frame_id: "f-true")

      plan =
        build_plan(
          frame_ref: "f-true",
          risk_hint: :high,
          proposed_actions: [
            %{
              action_id: "a1",
              action_type: :tentative_artifact,
              summary: "写",
              target_ref: nil,
              write_intent: :tentative,
              risk_hint: :high
            }
          ]
        )

      {decision, _behavior} = ExecutionOrchestrator.decide(frame, plan)
      constraints = OrchestratorDecision.truthfulness_constraints(decision)

      assert "no_action_executed" in constraints
    end

    test "decision trace records all required fields" do
      frame = build_frame(frame_id: "f-trace")

      plan =
        build_plan(
          frame_ref: "f-trace",
          risk_hint: :high,
          proposed_actions: [
            %{
              action_id: "a1",
              action_type: :tentative_artifact,
              summary: "测试",
              target_ref: nil,
              write_intent: :tentative,
              risk_hint: :high
            }
          ]
        )

      {decision, _behavior} = ExecutionOrchestrator.decide(frame, plan)

      assert decision.decision_id != nil
      assert decision.turn_id == "t-test"
      assert decision.frame_ref == "f-trace"
      assert decision.plan_ref == "p-test"
      assert decision.decision_status == :decided
      assert decision.first_blocking_gate != nil
      assert [_ | _] = decision.reason_codes
    end

    test "rejected_actions contains all proposed actions when blocked" do
      frame = build_frame(frame_id: "f-rej")

      plan =
        build_plan(
          frame_ref: "f-rej",
          risk_hint: :high,
          proposed_actions: [
            %{
              action_id: "a1",
              action_type: :tentative_artifact,
              summary: "X",
              target_ref: nil,
              write_intent: :tentative,
              risk_hint: :high
            }
          ]
        )

      {decision, _behavior} = ExecutionOrchestrator.decide(frame, plan)

      assert decision.rejected_actions != []
      assert hd(decision.rejected_actions).action_id == "a1"
    end
  end
end
