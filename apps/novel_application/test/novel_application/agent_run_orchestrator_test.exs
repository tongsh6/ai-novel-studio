defmodule NovelApplication.AgentRunOrchestratorTest do
  use ExUnit.Case, async: true

  alias NovelApplication.ExecutionOrchestrator
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan

  test "low-risk agent_run_start creates allow_agent_run decision only for run creation" do
    {decision, behavior} = ExecutionOrchestrator.decide(frame(), agent_plan())

    assert behavior == nil
    assert decision.decision_type == :allow_agent_run
    assert "agent_run_start" in decision.reason_codes
    assert "internal_steps_require_regate" in decision.reason_codes

    assert decision.turn_result_policy.truthfulness_constraints == [
             "agent_run_created",
             "internal_steps_require_regate"
           ]
  end

  test "agent_run_start does not bypass multi-step gate" do
    plan = %{
      agent_plan()
      | proposed_actions:
          agent_plan().proposed_actions ++
            [
              %{
                action_id: "act_extra",
                action_type: :capability_invocation,
                summary: "不应同批执行的角色设计",
                target_ref: "character_design",
                write_intent: :tentative,
                risk_hint: :low
              }
            ]
    }

    {decision, _behavior} = ExecutionOrchestrator.decide(frame(), plan)

    assert decision.decision_type == :downgrade_to_dialogue
    assert decision.first_blocking_gate == "action_scope"
  end

  defp frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-agent",
      turn_id: "turn-agent",
      workspace_id: "work-agent",
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{},
      dialogue_goal: %{summary: "启动角色设计 AgentRun"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "我会先查看角色阵容，再设计一个反派候选。"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp agent_plan do
    %MicroPlan{
      plan_id: "mp-agent",
      turn_id: "turn-agent",
      frame_ref: "frame-agent",
      plan_goal: %{summary: "启动角色设计 AgentRun"},
      risk_hint: :low,
      proposed_actions: [
        %{
          action_id: "act_agent_run",
          action_type: :agent_run_start,
          summary: "启动角色设计 AgentRun",
          target_ref: "character_design_with_context_v1",
          write_intent: :tentative,
          risk_hint: :low
        }
      ]
    }
  end
end
