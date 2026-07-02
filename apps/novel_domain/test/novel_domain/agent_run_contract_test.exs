defmodule NovelDomain.AgentRunContractTest do
  use ExUnit.Case, async: true

  alias NovelDomain.AgentNextStepDecision
  alias NovelDomain.AgentObservation
  alias NovelDomain.AgentPlan
  alias NovelDomain.AgentRun
  alias NovelDomain.AgentRunPolicy
  alias NovelDomain.AgentStep
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  test "AgentRun keeps bounded run separate from LongRunTask and tracks budget" do
    {:ok, run} =
      AgentRun.new(%{
        run_id: "run_1",
        workspace_id: "ws_1",
        work_id: "work_1",
        session_id: "sess_1",
        parent_turn_ref: "turn_1",
        origin_frame_ref: "frame_1",
        profile_ref: "character_design_with_context_v1",
        goal: %{text: "先看角色阵容，再设计反派", version: 1},
        status: :running,
        phase: :executing,
        authority_scope: %{
          production_write: false,
          allowed_tools: ["character_roster", "character_design"],
          profile_selection: %{
            profile_ref: "character_design_with_context_v1",
            source: "author_text",
            reason_codes: ["character_design_context_text_match"],
            matched_terms: ["角色阵容", "设计", "反派"]
          }
        },
        consumed_budget: %{steps: 5, tool_calls: 1, provider_calls: 1, replans: 0}
      })

    assert run.run_mode == :bounded
    assert AgentRun.budget_exhausted?(run)
    refute AgentRun.interrupt_requested?(run)
    assert AgentRunPolicy.tool_allowed?(run.policy, "character_design")
    assert run.authority_scope.profile_selection.profile_ref == "character_design_with_context_v1"
    assert run.authority_scope.profile_selection.source == "author_text"
    assert run.authority_scope.profile_selection.matched_terms == ["角色阵容", "设计", "反派"]
  end

  test "bounded run rejects LongRunTask ownership" do
    assert {:error, errors} =
             AgentRun.new(%{
               run_id: "run_2",
               workspace_id: "ws_1",
               work_id: "work_1",
               session_id: "sess_1",
               parent_turn_ref: "turn_1",
               origin_frame_ref: "frame_1",
               profile_ref: "character_design_with_context_v1",
               goal: "设计角色",
               authority_scope: %{allowed_tools: ["character_design"]},
               long_run_task_ref: "task_1"
             })

    assert "bounded run must not require LongRunTask" in errors
  end

  test "durable run requires LongRunTask ownership" do
    attrs = %{
      run_id: "run_durable",
      run_mode: :durable,
      workspace_id: "ws_1",
      work_id: "work_1",
      session_id: "sess_1",
      parent_turn_ref: "turn_1",
      origin_frame_ref: "frame_1",
      profile_ref: "durable_agent_v1",
      goal: "恢复长任务",
      authority_scope: %{allowed_tools: ["character_roster"]}
    }

    assert {:error, errors} = AgentRun.new(attrs)
    assert "durable run must link LongRunTask" in errors

    assert {:ok, run} = AgentRun.new(Map.put(attrs, :long_run_task_ref, "task_1"))
    assert run.run_mode == :durable
    assert run.long_run_task_ref == "task_1"
  end

  test "AgentPlan is an ordered PlanStep list, not batch ToolRequest list" do
    {:ok, plan} =
      AgentPlan.new(%{
        plan_id: "ap_1",
        run_ref: "run_1",
        steps: [
          %{
            step_id: "inspect_roster",
            kind: :explore,
            status: :pending,
            description: "读取角色阵容",
            success_criteria: ["observation"]
          },
          %{
            step_id: "design_character",
            kind: :act,
            status: :pending,
            description: "设计反派",
            success_criteria: ["tentative_character_seed"]
          }
        ]
      })

    assert AgentPlan.step_ids(plan) == ["inspect_roster", "design_character"]
    assert Enum.map(plan.steps, & &1.kind) == [:explore, :act]
    refute Map.has_key?(plan, :tool_requests)
  end

  test "agent_run_start and allow_agent_run are first-class execution contracts" do
    plan =
      MicroPlan.from_map(%{
        "plan_id" => "mp_agent",
        "turn_id" => "turn_1",
        "frame_ref" => "frame_1",
        "plan_goal" => %{"summary" => "启动 AgentRun"},
        "risk_hint" => "low",
        "proposed_actions" => [
          %{
            "action_id" => "act_agent",
            "action_type" => "agent_run_start",
            "summary" => "启动角色设计 AgentRun",
            "target_ref" => "character_design_with_context_v1",
            "write_intent" => "tentative",
            "risk_hint" => "low"
          }
        ]
      })

    assert hd(plan.proposed_actions).action_type == :agent_run_start

    decision = %OrchestratorDecision{
      decision_id: "decision_agent",
      turn_id: "turn_1",
      frame_ref: "frame_1",
      decision_type: :allow_agent_run,
      decision_status: :decided,
      reason_codes: ["agent_run_allowed"]
    }

    refute OrchestratorDecision.blocks_execution?(decision)

    assert "internal_steps_require_regate" in OrchestratorDecision.truthfulness_constraints(
             decision
           )
  end

  test "AgentStep stores single-step proof refs" do
    {:ok, step} =
      AgentStep.new(%{
        step_id: "step_1",
        run_ref: "run_1",
        sequence: 1,
        goal: "读取角色阵容",
        micro_plan_ref: "mp_1",
        decision_ref: "decision_1",
        tool_request_ref: "tq_1",
        tool_result_ref: "tr_1",
        observation_refs: ["obs_1"],
        idempotency_key: "run_1:1:character_roster"
      })

    assert step.sequence == 1
    assert step.decision_ref == "decision_1"
    assert step.observation_refs == ["obs_1"]
  end

  test "AgentObservation requires source and evidence" do
    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: "obs_1",
        run_ref: "run_1",
        step_ref: "step_1",
        observation_type: :character_roster,
        source_ref: "tr_1",
        summary: "当前已有 3 个角色。",
        structured_payload: %{character_count: 3},
        evidence_refs: ["tool_result:tr_1"],
        confidence: 1.0
      })

    assert AgentObservation.author_safe_summary(observation).summary == "当前已有 3 个角色。"

    assert {:error, errors} =
             AgentObservation.new(%{
               observation_id: "obs_2",
               run_ref: "run_1",
               step_ref: "step_1",
               observation_type: :character_roster,
               source_ref: "tr_1",
               summary: "缺证据"
             })

    assert "evidence_refs must not be empty" in errors
  end

  test "AgentNextStepDecision proposes loop continuation without approving execution" do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "and_1",
        run_ref: "run_1",
        sequence: 2,
        decision_type: :execute_step,
        summary: "基于角色阵容设计新角色",
        target_tool_ref: "character_design",
        write_intent: :tentative,
        risk_hint: :low,
        reason_codes: ["roster_observation_consumed"],
        observation_refs: ["obs_1"]
      })

    assert decision.decision_type == :execute_step
    assert decision.target_tool_ref == "character_design"
    refute Map.has_key?(decision, :approved)

    assert {:error, errors} =
             AgentNextStepDecision.new(%{
               decision_id: "and_bad",
               run_ref: "run_1",
               sequence: 3,
               decision_type: :execute_step,
               summary: "缺少工具"
             })

    assert "target_tool_ref is required for execute_step" in errors
  end
end
