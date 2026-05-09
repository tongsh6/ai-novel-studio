defmodule NovelE2E.V3FullChainTest do
  use ExUnit.Case, async: false

  @moduledoc """
  VS-08 端到端集成测试。

  全部测试从 DialogueGateway.handle_input 入口进入，经完整主链：
    AuthorInput → Planner → DialogueFrame → MicroPlan → GateOrder
    → OrchestratorDecision → BehaviorState / Toolbox → TurnResult

  使用 stub complete_fn 注入精确的 LLM 响应来触发每条代码路径。
  真实 LLM 测试单独一组，验证 LLM 输出可解析。
  """

  alias NovelApplication.DialogueGateway
  alias NovelApplication.ReplayService

  @moduletag :integration

  # ═══════════════════════════════════════════════════
  # 工具：sequenced stub complete_fn
  # ═══════════════════════════════════════════════════

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

  @multi_step_plan_json """
  {
    "plan_goal_summary": "同时执行多个动作",
    "risk_hint": "low",
    "requires_confirmation_hint": false,
    "proposed_actions": [
      {"action_id": "a1", "action_type": "tentative_artifact", "summary": "动作1", "target_ref": null, "write_intent": "tentative", "risk_hint": "low"},
      {"action_id": "a2", "action_type": "state_change_request", "summary": "动作2", "target_ref": null, "write_intent": "none", "risk_hint": "low"}
    ],
    "state_changes_requested": [],
    "required_capabilities": [],
    "fallback_message": "范围太大，先聚焦一个方向"
  }
  """

  @high_risk_plan_json """
  {
    "plan_goal_summary": "高风险写入正文",
    "risk_hint": "high",
    "requires_confirmation_hint": true,
    "proposed_actions": [
      {"action_id": "a1", "action_type": "tentative_artifact", "summary": "直接替换正文", "target_ref": null, "write_intent": "production_candidate", "risk_hint": "high"}
    ],
    "state_changes_requested": [],
    "required_capabilities": [],
    "fallback_message": "需要你确认后才能执行此操作"
  }
  """

  @tool_dispatch_plan_json """
  {
    "plan_goal_summary": "分析文本特征",
    "risk_hint": "low",
    "requires_confirmation_hint": false,
    "proposed_actions": [
      {"action_id": "a1", "action_type": "capability_invocation", "summary": "分析文本", "target_ref": "text_analysis", "write_intent": "none", "risk_hint": "low"}
    ],
    "state_changes_requested": [],
    "required_capabilities": [],
    "fallback_message": "无法分析文本"
  }
  """

  @creative_plan_json """
  {
    "plan_goal_summary": "生成角色设定",
    "risk_hint": "low",
    "requires_confirmation_hint": false,
    "proposed_actions": [
      {"action_id": "a1", "action_type": "capability_invocation", "summary": "创作角色", "target_ref": "creative_generation", "write_intent": "tentative", "risk_hint": "low"}
    ],
    "state_changes_requested": [],
    "required_capabilities": [],
    "fallback_message": "无法生成角色"
  }
  """

  @broken_plan_json "this is not valid json {{{"

  defp sequenced_complete_fn(frame_response, plan_response) do
    # Agent 持有响应序列。按序 pop，耗尽后返回 :exhausted
    {:ok, agent} = Agent.start_link(fn -> [frame_response, plan_response] end)
    fn prompt -> pop_or_exhaust(agent, prompt) end
  end

  defp pop_or_exhaust(agent, _prompt) do
    case Agent.get(agent, & &1) do
      [next | rest] ->
        Agent.update(agent, fn _ -> rest end)
        {:ok, %{content: next}}

      [] ->
        {:error, :exhausted}
    end
  end

  # ═══════════════════════════════════════════════════
  # Proof 1: reply-only 主链
  # ═══════════════════════════════════════════════════

  describe "reply-only chain (stub LLM)" do
    test "full chain: input → frame → turn_result → trace" do
      complete_fn = fn _prompt -> {:ok, %{content: @frame_json}} end

      {:ok, turn_result, trace, _candidates, _context} =
        DialogueGateway.handle_input(%{text: "你好", workspace_id: "ws-r1"}, nil, complete_fn)

      assert turn_result.schema_version == "3.0-draft"
      assert turn_result.frame_ref != nil
      assert turn_result.assistant_message.text == "收到你的消息。"
      assert turn_result.truthfulness.tool_called == false
      assert turn_result.truthfulness.production_write_performed == false
      assert trace.decision_type == :reply_only
      assert :reply_only_decision_recorded in trace.event_order
      assert :turn_result_emitted in trace.event_order
    end

    test "replay from reply-only trace never calls provider" do
      complete_fn = fn _prompt -> {:ok, %{content: @frame_json}} end
      {:ok, _turn_result, trace, _candidates, _context} =
        DialogueGateway.handle_input(%{text: "hi", workspace_id: "ws-r1b"}, nil, complete_fn)

      report = ReplayService.build_report(trace)

      assert report.provider_called == false
      assert report.trace_ref == trace.trace_id
      assert length(report.chain_summary) >= 2
    end
  end

  # ═══════════════════════════════════════════════════
  # Proof 4: downgrade 完整链路
  # ═══════════════════════════════════════════════════

  describe "downgrade chain (stub LLM)" do
    test "multi-step plan → GateOrder blocks → downgrade_to_dialogue → truthful TurnResult" do
      complete_fn = sequenced_complete_fn(@frame_json, @multi_step_plan_json)

      {:ok, turn_result, trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "重写第一章+更新角色+整理伏笔", workspace_id: "ws-dg", generate_micro_plan: true},
          nil, complete_fn)

      # 主链到达了 OrchestratorDecision
      decision = turn_result.orchestrator_decision
      assert decision != nil
      assert decision.decision_type == :downgrade_to_dialogue
      assert decision.first_blocking_gate == "action_scope"

      # TurnResult 诚实——没有谎称执行
      assert turn_result.truthfulness.execution_blocked == true
      assert turn_result.truthfulness.tool_called == false
      assert turn_result.truthfulness.production_write_performed == false

      # Trace 记录了阻塞原因
      assert trace.decision_type == :downgrade
      assert trace.no_write_reason =~ "action_scope"
      assert :orchestrator_decision_recorded in trace.event_order
    end
  end

  # ═══════════════════════════════════════════════════
  # Proof 5: confirmation 完整链路
  # ═══════════════════════════════════════════════════

  describe "confirmation chain (stub LLM)" do
    test "high-risk plan → confirmation required → BehaviorState opened → available_actions" do
      complete_fn = sequenced_complete_fn(@frame_json, @high_risk_plan_json)

      {:ok, turn_result, trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "直接替换正文", workspace_id: "ws-cf", generate_micro_plan: true},
          nil, complete_fn)

      decision = turn_result.orchestrator_decision
      assert decision != nil
      assert decision.decision_type == :require_confirmation
      assert decision.first_blocking_gate != nil

      # BehaviorState 被打开
      behavior = turn_result.behavior_state
      assert behavior != nil
      assert behavior.behavior_type == :confirmation
      assert behavior.lifecycle_status == :awaiting_author
      assert behavior.required_next_action == "confirm_before_execute"

      # available_actions 来自 Orchestrator，不为空
      assert turn_result.available_actions != []
      action_types = Enum.map(turn_result.available_actions, & &1.action_type)
      assert "confirm_before_execute" in action_types

      # Phase/Status 反映等待态
      assert turn_result.phase == "awaiting_author"
      assert turn_result.status == "needs_confirmation"

      # Trace 记录了阻塞原因
      assert trace.no_write_reason =~ "authority"
    end
  end

  # ═══════════════════════════════════════════════════
  # Proof 6: tool dispatch 完整链路
  # ═══════════════════════════════════════════════════

  describe "tool dispatch chain (stub LLM)" do
    test "single-step low-risk plan → allow_tool → Toolbox.execute → ToolResult → trace" do
      complete_fn = sequenced_complete_fn(@frame_json, @tool_dispatch_plan_json)

      {:ok, turn_result, trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "分析文本", workspace_id: "ws-tl", generate_micro_plan: true},
          nil, complete_fn)

      # Orchestrator 放行了工具
      decision = turn_result.orchestrator_decision
      assert decision != nil
      assert decision.decision_type == :allow_tool
      assert decision.first_blocking_gate == nil

      # ToolResult 存在且成功
      tool_result = turn_result.tool_result
      assert tool_result != nil
      assert tool_result.status == :succeeded
      assert tool_result.tool_name == "text_analysis"
      assert tool_result.output.word_count != nil

      # Truthfulness 报告了工具调用
      assert turn_result.truthfulness.tool_called == true
      # 但未声称已采纳或写入
      assert turn_result.truthfulness.artifact_adopted == false
      assert turn_result.truthfulness.production_write_performed == false

      # Trace 记录了完整工具链路
      assert trace.decision_type == :tool_dispatched
      assert :tool_dispatched in trace.event_order
      assert :tool_result_received in trace.event_order
    end
  end

  # ═══════════════════════════════════════════════════
  # Proof 7: creative artifact 完整链路
  # ═══════════════════════════════════════════════════

  describe "creative artifact chain (stub LLM)" do
    test "creative tool → TentativeArtifactSet → adoption_status tentative" do
      complete_fn = sequenced_complete_fn(@frame_json, @creative_plan_json)

      {:ok, turn_result, _trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "生成角色设定", workspace_id: "ws-ca", generate_micro_plan: true},
          nil, complete_fn)

      decision = turn_result.orchestrator_decision
      assert decision.decision_type == :allow_tool

      tool_result = turn_result.tool_result
      assert tool_result.status == :succeeded
      assert tool_result.tool_name == "creative_generation"

      # TentativeArtifactSet 存在
      artifacts = turn_result.tentative_artifacts
      assert artifacts != nil
      assert artifacts.adoption_status == :tentative
      assert length(artifacts.items) == 3
    end
  end

  # ═══════════════════════════════════════════════════
  # Proof 11: error recovery 完整链路
  # ═══════════════════════════════════════════════════

  describe "error recovery chain (stub LLM)" do
    test "broken provider → fallback frame → recovery trace" do
      broken_fn = fn _prompt -> {:error, %{code: "timeout", message: "timeout"}} end

      {:ok, turn_result, trace, _candidates, _context} =
        DialogueGateway.handle_input(%{text: "测试", workspace_id: "ws-err"}, nil, broken_fn)

      assert turn_result.assistant_message.text != ""
      assert turn_result.frame_ref != nil
      assert trace.decision_type in [:reply_only, :fail_with_recovery]
    end

    test "garbage JSON → fallback frame → never crashes" do
      garbage_fn = fn _prompt -> {:ok, %{content: "not valid json {{{"}} end

      {:ok, turn_result, _trace, _candidates, _context} =
        DialogueGateway.handle_input(%{text: "测试", workspace_id: "ws-garbage"}, nil, garbage_fn)

      assert turn_result.assistant_message.text != ""
      assert turn_result.frame_ref != nil
    end

    test "plan JSON parse failure → recovery → turn_result still valid" do
      complete_fn = sequenced_complete_fn(@frame_json, @broken_plan_json)

      {:ok, turn_result, trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "test", workspace_id: "ws-err3", generate_micro_plan: true},
          nil, complete_fn)

      assert turn_result.frame_ref != nil
      assert trace.decision_type == :fail_with_recovery
      assert :micro_plan_generation_failed in trace.event_order
    end
  end

end
