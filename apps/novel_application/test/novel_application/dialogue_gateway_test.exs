defmodule NovelApplication.DialogueGatewayTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.DialogueGateway
  alias NovelDomain.AuthorActionInput
  alias NovelDomain.DialogueFrame

  @frame_json """
  {
    "frame_type": "casual_reply",
    "dialogue_goal_summary": "用户发来消息",
    "needs_tool": false,
    "no_tool_reason": "no_tool_needed",
    "execution_readiness": "not_applicable",
    "assistant_message": "收到你的消息。",
    "candidate_directions": [],
    "context_used": false,
    "uncertainty": []
  }
  """

  defp provider_execution(result_fn), do: %Execution{result_fn: result_fn}

  # ── VS-00 reply-only tests ──────────────────────────

  describe "reply-only turn" do
  end

  # ── VS-00A creative exploration tests ──────────────────

  describe "creative exploration turn" do
  end

  # ── Shared invariants ─────────────────────────────────

  describe "invariants" do
    test "explicit nil provider is rejected for author actions" do
      input = %AuthorActionInput{
        input_id: "in-provider-boundary",
        source_turn_ref: "turn-provider-boundary",
        action_id: "act-provider-boundary",
        action_type: "confirm_before_execute"
      }

      assert {:error, reason} = DialogueGateway.handle_action(input, %{}, nil)
      assert String.contains?(reason, "provider execution")
    end

    test "cancel waiting action records terminal behavior trace refs for replay" do
      input = %AuthorActionInput{
        input_id: "in-cancel-behavior",
        source_turn_ref: "turn-behavior-open",
        action_id: "act-cancel-behavior",
        action_type: "reject_or_cancel_confirmation",
        target_ref: "prose_writing",
        behavior_ref: "bh-behavior-open",
        idempotency_key: "ik-cancel-behavior"
      }

      source_turn_result = %{
        turn_id: "turn-behavior-open",
        frame_ref: "frame-behavior-open",
        trace_summary: %{trace_ref: "trace-behavior-open"},
        available_actions: [
          %{
            action_id: "act-cancel-behavior",
            action_type: "reject_or_cancel_confirmation",
            target_ref: "prose_writing",
            behavior_ref: "bh-behavior-open",
            idempotency_key: "ik-cancel-behavior",
            enabled: true
          }
        ],
        behavior_state: %{
          active: %{
            behavior_id: "bh-behavior-open",
            behavior_type: "confirmation",
            opened_at_turn_ref: "turn-behavior-open",
            opened_by_decision_ref: "decision-behavior-open",
            frame_ref: "frame-behavior-open",
            plan_ref: "plan-behavior-open",
            target_ref: "prose_writing",
            required_next_action: "confirm_before_execute",
            prompt_contract: %{},
            constraints: %{},
            trace_ref: "trace-behavior-open"
          },
          history: []
        }
      }

      assert {:ok, action_result, turn_result} =
               DialogueGateway.handle_action(
                 input,
                 source_turn_result,
                 provider_execution(fn _prompt ->
                   flunk("cancel waiting must not call provider")
                 end)
               )

      assert action_result.status == "cancelled"
      assert turn_result.phase == "cancelled"
      assert turn_result.trace_summary.trace_ref == "trace:#{turn_result.turn_id}"

      assert [
               %{
                 behavior_ref: "bh-behavior-open",
                 behavior_type: "confirmation",
                 event_type: :close,
                 event_turn_ref: closed_turn_ref,
                 decision_ref: "decision-behavior-open",
                 target_ref: "prose_writing",
                 next_status: "CANCELLED",
                 resolution_ref: resolution_ref
               }
             ] = turn_result.trace_summary.behavior_trace_refs

      assert closed_turn_ref == turn_result.turn_id
      assert resolution_ref == "behavior_resolution:#{turn_result.turn_id}"
      assert :behavior_trace_recorded in turn_result.trace_summary.event_order
      assert :behavior_resolution_recorded in turn_result.trace_summary.event_order
    end

    test "DialogueFrame validation rejects forbidden semantics" do
      frame = %DialogueFrame{
        schema_version: "3.0-draft",
        frame_id: "f-1",
        turn_id: "t-1",
        workspace_id: "ws-1",
        primary: true,
        frame_type: :casual_reply,
        source_refs: %{author_input_ref: "a-1", dialogue_context_ref: nil},
        dialogue_goal: %{summary: "test"},
        tool_need: %{needs_tool: false, reason_code: :no_tool_needed},
        execution_readiness: :not_applicable,
        author_visible_draft: %{message: "something approved and ready_to_execute"},
        uncertainty: []
      }

      assert {:error, reasons} = DialogueFrame.validate(frame)
      assert Enum.any?(reasons, &String.contains?(&1, "approved"))
      assert Enum.any?(reasons, &String.contains?(&1, "ready_to_execute"))
    end

  end

  describe "trace persister callback" do
  end

  describe "interaction recorder callback" do
    test "jsonable normalizes encoder-less structs and keeps Jason-native scalars" do
      # 回归：require_confirmation 的 turn_result 内嵌 MicroPlan 等无 Encoder 的 struct，
      # 持久化（Ecto :map）/广播（Jason）若不规范化会崩。jsonable 只展开无 Encoder 的
      # struct；DateTime/Date 等 Jason 原生可编码的标量 struct 必须原样保留（展开会把
      # ISO8601 编码丢成 raw map）。
      plan = %NovelDomain.MicroPlan{
        plan_id: "p",
        turn_id: "t",
        frame_ref: "f",
        plan_goal: %{summary: "重写第一章"},
        risk_hint: :high,
        proposed_actions: [%{action_id: "a", target_chapter: "第01章"}]
      }

      input = %{
        text: "记住这轮",
        turn_result: %{
          status: "needs_confirmation",
          plan: plan,
          created_at: ~U[2024-01-01 00:00:00Z],
          actions: [%{at: ~D[2024-01-02], note: "x"}]
        }
      }

      out = DialogueGateway.jsonable(input)

      # 整体可被 Jason 编码（broadcast/persist 都安全）。
      assert {:ok, _json} = Jason.encode(out)
      # 无 Encoder 的 MicroPlan 被深度展开为纯 map，内容保留。
      refute is_struct(out.turn_result.plan)
      assert out.turn_result.plan.risk_hint == :high
      assert hd(out.turn_result.plan.proposed_actions).target_chapter == "第01章"
      # Jason 原生可编码的标量 struct 原样保留（不丢 ISO8601 编码）。
      assert out.turn_result.created_at == ~U[2024-01-01 00:00:00Z]
      assert hd(out.turn_result.actions).at == ~D[2024-01-02]
      assert out.turn_result.status == "needs_confirmation"
    end
  end
end
