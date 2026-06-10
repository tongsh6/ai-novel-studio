defmodule NovelDomain.MicroPlanTest do
  use ExUnit.Case, async: true

  alias NovelDomain.MicroPlan

  @plan %MicroPlan{
    plan_id: "plan-1",
    turn_id: "turn-1",
    frame_ref: "frame-1",
    plan_goal: %{summary: "重写第一章"},
    risk_hint: :high,
    requires_confirmation_hint: true,
    proposed_actions: [
      %{
        action_id: "act-1",
        action_type: :capability_invocation,
        summary: "重写第一章正文",
        target_ref: "prose_writing",
        write_intent: :production_candidate,
        risk_hint: :high,
        authoring_intent: :rewrite,
        target_chapter: "第01章：底层灵气账单",
        target_word_count: 800
      }
    ]
  }

  describe "from_map/1（确认 re-gate 载体反序列化，ADR-0009）" do
    test "struct 原样透传，nil 返回 nil" do
      assert MicroPlan.from_map(@plan) == @plan
      assert MicroPlan.from_map(nil) == nil
    end

    test "进程内 JSON 安全形态（atom key/atom 枚举）恢复为等价 struct" do
      wire = @plan |> Map.from_struct() |> Map.update!(:proposed_actions, & &1)

      restored = MicroPlan.from_map(wire)

      assert %MicroPlan{} = restored
      assert restored.plan_id == "plan-1"
      assert restored.risk_hint == :high
      assert restored.requires_confirmation_hint == true
      assert [action] = restored.proposed_actions
      assert action.action_type == :capability_invocation
      assert action.write_intent == :production_candidate
      assert action.authoring_intent == :rewrite
      assert action.target_chapter == "第01章：底层灵气账单"
      assert action.target_word_count == 800
    end

    test "持久化往返形态（string key/string 枚举，Jason round-trip）恢复 re-gate 关键字段" do
      persisted =
        @plan |> Map.from_struct() |> Jason.encode!() |> Jason.decode!()

      restored = MicroPlan.from_map(persisted)

      assert %MicroPlan{} = restored
      assert restored.plan_id == "plan-1"
      assert restored.turn_id == "turn-1"
      assert restored.frame_ref == "frame-1"
      assert restored.plan_goal == %{summary: "重写第一章"}
      # gate 消费的关键枚举必须恢复为 atom（high_risk?/production_candidate_count）。
      assert restored.risk_hint == :high
      assert MicroPlan.high_risk?(restored)
      assert MicroPlan.production_candidate_count(restored) == 1
      assert [action] = restored.proposed_actions
      assert action.action_type == :capability_invocation
      assert action.target_ref == "prose_writing"
      assert action.authoring_intent == :rewrite
      assert action.target_word_count == 800
    end

    test "未知枚举值落最保守分支，不发明新值" do
      restored =
        MicroPlan.from_map(%{
          "plan_id" => "p",
          "turn_id" => "t",
          "frame_ref" => "f",
          "risk_hint" => "extreme",
          "proposed_actions" => [
            %{"action_id" => "a", "action_type" => "self_approve", "write_intent" => "direct"}
          ]
        })

      assert restored.risk_hint == :low
      assert [action] = restored.proposed_actions
      # 未知 action_type → clarification_request（不可执行）；未知 write_intent → none（不写）。
      assert action.action_type == :clarification_request
      assert action.write_intent == :none
    end
  end
end
