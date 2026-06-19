defmodule NovelApplication.ActionRoundtripTest do
  use ExUnit.Case, async: true

  alias NovelApplication.ActionValidator
  alias NovelDomain.AuthorActionInput

  @valid_source %{
    turn_id: "turn-1",
    available_actions: [
      %{
        action_id: "act-confirm",
        action_type: "confirm_before_execute",
        # 生产 turn_result 的确认 action 始终带 behavior_ref/target_ref（指向 open
        # confirmation，VS-03 §5），fixture 与之对齐。
        behavior_ref: "bh-1",
        target_ref: "text_analysis",
        enabled: true,
        idempotency_key: "ik1"
      },
      %{
        action_id: "act-disabled",
        action_type: "cancel_pending_behavior",
        enabled: false,
        disabled_reason: "stale"
      },
      %{
        action_id: "choose_candidate:dir-1",
        action_type: "choose_candidate",
        candidate_set_ref: "candidate_set:turn-1",
        candidate_ref: "dir-1",
        target_ref: "dir-1",
        enabled: true
      }
    ]
  }

  describe "action validation" do
    test "valid action passes" do
      # 前端提交确认时回传 available_action 的 target_ref/behavior_ref
      # （workbenchActions.toAuthorActionPayload），input 与之对齐。
      input = %AuthorActionInput{
        input_id: "in-1",
        source_turn_ref: "turn-1",
        action_id: "act-confirm",
        action_type: "confirm_before_execute",
        target_ref: "text_analysis",
        behavior_ref: "bh-1",
        idempotency_key: "ik1"
      }

      assert :ok = ActionValidator.validate(input, @valid_source)
    end

    test "stale source_turn_ref rejected" do
      input = %AuthorActionInput{
        input_id: "in-stale",
        source_turn_ref: "turn-old",
        action_id: "act-confirm",
        action_type: "confirm_before_execute"
      }

      assert {:error, reason} = ActionValidator.validate(input, @valid_source)
      assert String.contains?(reason, "stale")
    end

    test "invented action rejected" do
      input = %AuthorActionInput{
        input_id: "in-invented",
        source_turn_ref: "turn-1",
        action_id: "act-fake",
        action_type: "nonexistent_action"
      }

      assert {:error, reason} = ActionValidator.validate(input, @valid_source)
      assert String.contains?(reason, "invented")
    end

    test "disabled action rejected" do
      input = %AuthorActionInput{
        input_id: "in-disabled",
        source_turn_ref: "turn-1",
        action_id: "act-disabled",
        action_type: "cancel_pending_behavior"
      }

      assert {:error, reason} = ActionValidator.validate(input, @valid_source)
      assert String.contains?(reason, "disabled")
    end

    test "candidate action scope mismatch rejected" do
      input = %AuthorActionInput{
        input_id: "in-candidate-mismatch",
        source_turn_ref: "turn-1",
        action_id: "choose_candidate:dir-1",
        action_type: "choose_candidate",
        target_ref: "dir-1",
        candidate_set_ref: "candidate_set:turn-1",
        candidate_ref: "dir-2"
      }

      assert {:error, reason} = ActionValidator.validate(input, @valid_source)
      assert String.contains?(reason, "candidate_ref")
    end

    test "target_ref mismatch rejected" do
      input = %AuthorActionInput{
        input_id: "in-target-mismatch",
        source_turn_ref: "turn-1",
        action_id: "choose_candidate:dir-1",
        action_type: "choose_candidate",
        target_ref: "dir-other",
        candidate_set_ref: "candidate_set:turn-1",
        candidate_ref: "dir-1"
      }

      assert {:error, reason} = ActionValidator.validate(input, @valid_source)
      assert String.contains?(reason, "target_ref")
    end

    test "missing behavior_ref is rejected when available action carries one" do
      input = %AuthorActionInput{
        input_id: "in-behavior-missing",
        source_turn_ref: "turn-1",
        action_id: "act-confirm",
        action_type: "confirm_before_execute",
        target_ref: "text_analysis",
        idempotency_key: "ik1"
      }

      assert {:error, reason} = ActionValidator.validate(input, @valid_source)
      assert String.contains?(reason, "behavior_ref")
    end

    test "idempotency_key mismatch rejected" do
      input = %AuthorActionInput{
        input_id: "in-idempotency-mismatch",
        source_turn_ref: "turn-1",
        action_id: "act-confirm",
        action_type: "confirm_before_execute",
        target_ref: "text_analysis",
        behavior_ref: "bh-1",
        idempotency_key: "other-key"
      }

      assert {:error, reason} = ActionValidator.validate(input, @valid_source)
      assert String.contains?(reason, "idempotency_key")
    end

    test "missing target_ref is rejected when available action carries one" do
      input = %AuthorActionInput{
        input_id: "in-target-missing",
        source_turn_ref: "turn-1",
        action_id: "choose_candidate:dir-1",
        action_type: "choose_candidate",
        candidate_set_ref: "candidate_set:turn-1",
        candidate_ref: "dir-1"
      }

      assert {:error, reason} = ActionValidator.validate(input, @valid_source)
      assert String.contains?(reason, "target_ref")
    end

    test "restored string-key source action passes validation" do
      input = %AuthorActionInput{
        input_id: "in-candidate-restored",
        source_turn_ref: "turn-1",
        action_id: "choose_candidate:dir-1",
        action_type: "choose_candidate",
        target_ref: "dir-1",
        candidate_set_ref: "candidate_set:turn-1",
        candidate_ref: "dir-1"
      }

      source = %{
        "turn_id" => "turn-1",
        "available_actions" => [
          %{
            "action_id" => "choose_candidate:dir-1",
            "action_type" => "choose_candidate",
            "target_ref" => "dir-1",
            "candidate_set_ref" => "candidate_set:turn-1",
            "candidate_ref" => "dir-1",
            "enabled" => true
          }
        ]
      }

      assert :ok = ActionValidator.validate(input, source)
    end

    test "missing source_turn_result rejected" do
      input = %AuthorActionInput{
        input_id: "in-1",
        source_turn_ref: "turn-1",
        action_id: "act-1",
        action_type: "test"
      }

      assert {:error, _} = ActionValidator.validate(input, nil)
    end
  end

  describe "action idempotency ledger" do
    alias NovelApplication.ActionIdempotencyLedger

    test "records successful actions by work/session/source/action/idempotency key" do
      input = %AuthorActionInput{
        input_id: "in-ledger-1",
        source_turn_ref: "turn-1",
        action_id: "act-confirm",
        action_type: "confirm_before_execute",
        idempotency_key: "ik-confirm"
      }

      result = %{status: "accepted", action_id: "act-confirm"}
      scope = %{work_id: "work-1", session_id: "session-1"}

      ledger = ActionIdempotencyLedger.record(%{}, input, scope, result)

      assert {:duplicate, entry} = ActionIdempotencyLedger.lookup(ledger, input, scope)
      assert entry.result == result
      assert entry.idempotency_key == "ik-confirm"
    end

    test "does not deduplicate actions without an idempotency key" do
      input = %AuthorActionInput{
        input_id: "in-ledger-2",
        source_turn_ref: "turn-1",
        action_id: "act-confirm",
        action_type: "confirm_before_execute"
      }

      ledger = ActionIdempotencyLedger.record(%{}, input, %{}, %{status: "accepted"})

      assert :miss = ActionIdempotencyLedger.lookup(ledger, input, %{})
    end

    test "keeps duplicate detection scoped to work and session" do
      input = %AuthorActionInput{
        input_id: "in-ledger-3",
        source_turn_ref: "turn-1",
        action_id: "act-confirm",
        action_type: "confirm_before_execute",
        idempotency_key: "ik-confirm"
      }

      ledger =
        ActionIdempotencyLedger.record(
          %{},
          input,
          %{work_id: "work-1", session_id: "session-1"},
          %{status: "accepted"}
        )

      assert :miss =
               ActionIdempotencyLedger.lookup(
                 ledger,
                 input,
                 %{work_id: "work-2", session_id: "session-1"}
               )
    end
  end

  describe "DialogueGateway handle_action" do
    alias NovelApplication.DialogueGateway

    @source_with_plan Map.put(@valid_source, :plan, %NovelDomain.MicroPlan{
                        plan_id: "plan-1",
                        turn_id: "turn-1",
                        frame_ref: "frame-1",
                        plan_goal: %{summary: "test"},
                        risk_hint: :low,
                        requires_confirmation_hint: false,
                        proposed_actions: [
                          %{action_type: :capability_invocation, target_ref: "text_analysis"}
                        ],
                        state_changes_requested: [],
                        required_capabilities: [],
                        fallback_strategy: %{downgrade_message: "fallback"}
                      })

    @candidate_source %{
      turn_id: "turn-candidates-1",
      frame_ref: "frame-candidates-1",
      work_id: "work-1",
      available_actions: [
        %{
          action_id: "choose_candidate:dir-1",
          action_type: "choose_candidate",
          target_ref: "dir-1",
          candidate_set_ref: "candidate_set:turn-candidates-1",
          candidate_ref: "dir-1",
          enabled: true
        }
      ],
      candidate_directions: [
        %{
          direction_id: "dir-1",
          title: "高风险主线覆盖",
          pitch: "直接覆盖既有主线设定",
          tone_tags: ["主线"],
          risk_hint: :high,
          adoption_status: :not_adopted
        }
      ]
    }

    test "confirm_before_execute requires stored plan in source" do
      input = %AuthorActionInput{
        input_id: "in-gw",
        source_turn_ref: "turn-1",
        action_id: "act-confirm",
        action_type: "confirm_before_execute",
        target_ref: "text_analysis",
        behavior_ref: "bh-1",
        idempotency_key: "ik1"
      }

      assert {:error, reason} = DialogueGateway.handle_action(input, @valid_source)
      assert String.contains?(reason, "without stored plan")
    end

    test "confirm_before_execute with plan re-gates" do
      input = %AuthorActionInput{
        input_id: "in-gw-plan",
        source_turn_ref: "turn-1",
        action_id: "act-confirm",
        action_type: "confirm_before_execute",
        target_ref: "text_analysis",
        behavior_ref: "bh-1",
        idempotency_key: "ik1"
      }

      assert {:ok, _ack} = DialogueGateway.handle_action(input, @source_with_plan)
    end

    test "reject_or_cancel_confirmation closes waiting behavior without tool or write" do
      source =
        Map.put(@valid_source, :available_actions, [
          %{
            action_id: "act-reject",
            action_type: "reject_or_cancel_confirmation",
            target_ref: "text_analysis",
            behavior_ref: "bh-1",
            enabled: true,
            idempotency_key: "ik-reject"
          }
        ])

      input = %AuthorActionInput{
        input_id: "in-gw-reject",
        source_turn_ref: "turn-1",
        action_id: "act-reject",
        action_type: "reject_or_cancel_confirmation",
        target_ref: "text_analysis",
        behavior_ref: "bh-1",
        idempotency_key: "ik-reject"
      }

      assert {:ok, ack, turn_result} = DialogueGateway.handle_action(input, source)
      assert ack.status == "cancelled"
      assert ack.action_type == "reject_or_cancel_confirmation"
      assert turn_result.status == "cancelled"
      assert turn_result.phase == "cancelled"
      assert turn_result.behavior_state.active == nil

      assert [
               %{
                 behavior_id: "bh-1",
                 behavior_type: "confirmation",
                 status: "CANCELLED",
                 target_ref: "text_analysis",
                 closed_at_turn_ref: closed_turn_ref,
                 resolution_ref: resolution_ref
               }
             ] = turn_result.behavior_state.history

      assert closed_turn_ref == turn_result.turn_id
      assert resolution_ref == "behavior_resolution:#{turn_result.turn_id}"
      assert turn_result.truthfulness.tool_called == false
      assert turn_result.truthfulness.artifact_adopted == false
      assert turn_result.truthfulness.production_write_performed == false
    end

    test "high-risk confirmation re-gates to execution with persisted (string-keyed) source" do
      # 回归（发现2）：resume 后 source_turn_result 经持久化往返为 string-keyed、
      # plan 为 JSON 安全 map；确认必须仍能 rehydrate plan 并 re-gate 放行执行。
      plan = %NovelDomain.MicroPlan{
        plan_id: "plan-persist-1",
        turn_id: "turn-persist-1",
        frame_ref: "frame-persist-1",
        plan_goal: %{summary: "重写第一章"},
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
      }

      source =
        %{
          turn_id: "turn-persist-1",
          frame_ref: "frame-persist-1",
          workspace_id: "ws-persist",
          available_actions: [
            %{
              action_id: "act-confirm-p",
              action_type: "confirm_before_execute",
              behavior_ref: "bh-p1",
              target_ref: "prose_writing",
              enabled: true,
              idempotency_key: "ik-p"
            }
          ],
          plan: DialogueGateway.jsonable(plan)
        }
        |> Jason.encode!()
        |> Jason.decode!()

      input = %AuthorActionInput{
        input_id: "in-p",
        source_turn_ref: "turn-persist-1",
        action_id: "act-confirm-p",
        action_type: "confirm_before_execute",
        target_ref: "prose_writing",
        behavior_ref: "bh-p1",
        idempotency_key: "ik-p"
      }

      complete_fn = fn _prompt ->
        {:ok,
         %{
           content:
             Jason.encode!([
               %{"item_id" => "i1", "title" => "重写", "body" => "新正文", "rationale" => nil}
             ])
         }}
      end

      assert {:ok, ack, turn_result} = DialogueGateway.handle_action(input, source, complete_fn)
      assert ack.status == "accepted"
      assert turn_result.tool_result.tool_name == "prose_writing"
      assert turn_result.truthfulness.tool_called == true
    end

    test "invented action rejected by gateway" do
      input = %AuthorActionInput{
        input_id: "in-gw-fake",
        source_turn_ref: "turn-1",
        action_id: "act-fake",
        action_type: "nonexistent"
      }

      assert {:error, reason} = DialogueGateway.handle_action(input, @valid_source)
      assert String.contains?(reason, "invented")
    end

    test "stale action rejected by gateway" do
      input = %AuthorActionInput{
        input_id: "in-gw-stale",
        source_turn_ref: "turn-old",
        action_id: "act-confirm",
        action_type: "confirm_before_execute"
      }

      assert {:error, reason} = DialogueGateway.handle_action(input, @valid_source)
      assert String.contains?(reason, "stale")
    end

    test "high risk candidate adoption requires confirmation and does not write production state" do
      input = %AuthorActionInput{
        input_id: "in-gw-candidate-high-risk",
        source_turn_ref: "turn-candidates-1",
        action_id: "choose_candidate:dir-1",
        action_type: "choose_candidate",
        target_ref: "dir-1",
        candidate_set_ref: "candidate_set:turn-candidates-1",
        candidate_ref: "dir-1"
      }

      assert {:ok, ack, turn_result} =
               DialogueGateway.handle_action(
                 input,
                 Map.put(@candidate_source, :current_work_id, "work-1")
               )

      assert ack.status == "needs_confirmation"
      assert ack.adoption_decision.decision_type == :require_confirmation
      assert "high_risk_candidate" in ack.adoption_decision.reason_codes
      assert turn_result.status == "needs_confirmation"
      assert turn_result.truthfulness.candidate_selected == true
      assert turn_result.truthfulness.candidate_adopted == false
      assert turn_result.truthfulness.production_write_performed == false
    end

    test "cross work candidate adoption fails with recovery" do
      input = %AuthorActionInput{
        input_id: "in-gw-candidate-cross-work",
        source_turn_ref: "turn-candidates-1",
        action_id: "choose_candidate:dir-1",
        action_type: "choose_candidate",
        target_ref: "dir-1",
        candidate_set_ref: "candidate_set:turn-candidates-1",
        candidate_ref: "dir-1"
      }

      source =
        @candidate_source
        |> Map.put(:current_work_id, "work-2")
        |> put_in([:candidate_directions, Access.at(0), :risk_hint], :low)

      assert {:ok, ack, turn_result} = DialogueGateway.handle_action(input, source)
      assert ack.status == "failed"
      assert ack.adoption_decision.decision_type == :fail_with_recovery
      assert "work_id_mismatch" in ack.adoption_decision.reason_codes
      assert turn_result.truthfulness.candidate_adopted == false
      assert turn_result.truthfulness.production_write_performed == false
    end

    test "canon conflict candidate adoption fails with recovery" do
      input = %AuthorActionInput{
        input_id: "in-gw-candidate-canon-conflict",
        source_turn_ref: "turn-candidates-1",
        action_id: "choose_candidate:dir-1",
        action_type: "choose_candidate",
        target_ref: "dir-1",
        candidate_set_ref: "candidate_set:turn-candidates-1",
        candidate_ref: "dir-1"
      }

      source =
        @candidate_source
        |> Map.put(:current_work_id, "work-1")
        |> put_in([:candidate_directions, Access.at(0), :risk_hint], :low)
        |> put_in(
          [:candidate_directions, Access.at(0), :adoption_target_ref],
          "canon:role:lin-jin:age"
        )
        |> put_in([:candidate_directions, Access.at(0), :canon_conflicts], [
          %{
            target_ref: "canon:role:lin-jin:age",
            current_value: "林烬十七岁",
            proposed_value: "林烬三十二岁",
            canon_revision: 7
          }
        ])

      assert {:ok, ack, turn_result} = DialogueGateway.handle_action(input, source)
      assert ack.status == "failed"
      assert ack.adoption_decision.decision_type == :fail_with_recovery
      assert "canon_conflict_detected" in ack.adoption_decision.reason_codes
      assert "conflict_recovery_required" in ack.adoption_decision.reason_codes
      assert turn_result.status == "failed"
      assert turn_result.truthfulness.candidate_selected == true
      assert turn_result.truthfulness.candidate_adopted == false
      assert turn_result.truthfulness.production_write_performed == false
    end

    test "stale source candidate adoption is rejected with visible turn_result" do
      input = %AuthorActionInput{
        input_id: "in-gw-candidate-stale",
        source_turn_ref: "turn-candidates-1",
        action_id: "choose_candidate:dir-1",
        action_type: "choose_candidate",
        target_ref: "dir-1",
        candidate_set_ref: "candidate_set:turn-candidates-1",
        candidate_ref: "dir-1"
      }

      source =
        @candidate_source
        |> Map.put(:current_work_id, "work-1")
        |> Map.put(:candidate_set_stability, "stale")
        |> put_in([:candidate_directions, Access.at(0), :risk_hint], :low)

      assert {:ok, ack, turn_result} = DialogueGateway.handle_action(input, source)
      assert ack.status == "rejected"
      assert ack.adoption_decision.decision_type == :reject
      assert "source_turn_stale" in ack.adoption_decision.reason_codes
      assert turn_result.status == "cancelled"
      assert turn_result.truthfulness.candidate_adopted == false
      assert turn_result.truthfulness.production_write_performed == false
    end
  end
end
