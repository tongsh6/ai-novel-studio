defmodule NovelApplication.DeepExplorationLoopTest do
  use ExUnit.Case, async: true

  alias NovelApplication.DialogueGateway

  @moduledoc """
  VS-00A 深度创意探索证明。

  验证：从模糊输入（对话）到用户决策（行动）再到工具调用的完整闭环。
  """

  # ── Mocks ──────────────────────────────────────

  @exploration_response ~s({
    "frame_type": "creative_exploration",
    "dialogue_goal_summary": "展开赛博修仙方向",
    "needs_tool": false,
    "no_tool_reason": "exploratory_only",
    "execution_readiness": "not_applicable",
    "assistant_message": "我们可以尝试赛博垄断流或算法飞升流。你选哪个？",
    "candidate_directions": [
      {"title": "赛博垄断", "pitch": "公司控制灵气", "tone_tags": []}
    ],
    "context_used": false,
    "uncertainty": []
  })

  @decision_plan_response ~s({
    "plan_goal_summary": "开始构建赛博垄断的世界观设定",
    "risk_hint": "high",
    "requires_confirmation_hint": true,
    "proposed_actions": [
      {
        "action_id": "act-world-gen",
        "action_type": "capability_invocation",
        "summary": "基于赛博垄断流生成世界观初步设定",
        "target_ref": "world_building",
        "write_intent": "tentative",
        "risk_hint": "high"
      }
    ],
    "state_changes_requested": [],
    "required_capabilities": ["world_building"],
    "fallback_message": "我这就为你构思具体的公司垄断细节。"
  })

  # ── Tests ──────────────────────────────────────

  describe "VS-00A Deep Exploration Loop (Multi-turn)" do
    test "transitions from natural exploration to structured tool invocation plan" do
      # --- Turn 1: Fuzzy Exploration ---

      complete_fn_t1 = fn _prompt -> {:ok, %{content: @exploration_response}} end
      input_t1 = %{text: "我想写赛博修仙", workspace_id: "ws-deep-1"}

      {:ok, turn_result_t1, _trace_t1, _cands_t1, _ctx_t1} =
        DialogueGateway.handle_input(input_t1, nil, complete_fn_t1)

      assert turn_result_t1.frame_summary.frame_type == :creative_exploration
      assert length(turn_result_t1.candidate_directions) == 1

      # --- Turn 2: User Choice -> MicroPlan Generation ---

      # 模拟用户输入“我选赛博垄断”，并要求生成 MicroPlan (generate_micro_plan: true)
      complete_fn_t2 = fn _prompt -> {:ok, %{content: @decision_plan_response}} end

      input_t2 = %{
        text: "我选赛博垄断流，帮我开始设定世界观",
        workspace_id: "ws-deep-1",
        generate_micro_plan: true
      }

      {:ok, turn_result_t2, trace_t2, _cands_t2, _ctx_t2} =
        DialogueGateway.handle_input(input_t2, nil, complete_fn_t2)

      # 验证 Planner 现在具有工具认知，并提出了正确的 capability_invocation
      # 由于 risk_hint 为 high，触发了 authority gate，状态变为 needs_confirmation
      assert turn_result_t2.status == "needs_confirmation"
      assert turn_result_t2.truthfulness.durable_behavior_opened == true

      # 验证决策详情包含具体的风险说明和建议描述
      decision = turn_result_t2.orchestrator_decision
      assert decision.decision_type == :require_confirmation
      assert decision.required_author_action.summary =~ "需作者确认：基于赛博垄断流生成世界观初步设定"

      # 验证 MicroPlan 中的 Proposed Action 正确指向了 CapabilityRegistry 中的工具
      proposed_actions = turn_result_t2.available_actions
      assert Enum.any?(proposed_actions, &(&1[:action_type] == "confirm_before_execute"))

      # 验证 DecisionTrace 记录了这次意图
      assert trace_t2.decision_type == :confirmation_required
      assert :micro_plan_generated in trace_t2.event_order
    end
  end
end
