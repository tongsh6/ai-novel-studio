defmodule NovelApplication.GateOrderClosureTest do
  @moduledoc """
  GATE-ORDER-CLOSURE（B13b §4.1 #2）验收：ADR-0005 冻结的 12 门、GateResult
  结构化 lineage、gate order version、DecisionTrace/Replay 记录，以及各门真实阻断判定。

  真实页面验收见 `quality/acceptance/scenarios/agent-step-regate.yml`（app JSONL
  `orchestrator.decide.done` 的 gate_outcomes/version 断言）。
  """

  use ExUnit.Case, async: true

  alias NovelApplication.ExecutionOrchestrator
  alias NovelApplication.GateOrder
  alias NovelApplication.ReplayService
  alias NovelApplication.TraceWriter
  alias NovelDomain.ConfirmationBinding
  alias NovelDomain.DecisionTrace
  alias NovelDomain.DialogueFrame
  alias NovelDomain.GateResult
  alias NovelDomain.MicroPlan

  defp build_frame(attrs \\ []) do
    struct!(
      DialogueFrame,
      Keyword.merge(
        [
          schema_version: "3.0-draft",
          frame_id: "f-gate",
          turn_id: "t-gate",
          workspace_id: "ws-gate",
          primary: true,
          frame_type: :execution_candidate,
          source_refs: %{author_input_ref: "a-gate", dialogue_context_ref: nil},
          dialogue_goal: %{summary: "测试门禁"},
          tool_need: %{needs_tool: true, reason_code: :tool_needed},
          execution_readiness: :ready,
          author_visible_draft: %{message: "执行下一步"},
          uncertainty: []
        ],
        attrs
      )
    )
  end

  defp build_action(attrs \\ []) do
    Map.merge(
      %{
        action_id: "act-1",
        action_type: :capability_invocation,
        summary: "执行一步",
        target_ref: "prose_writing",
        write_intent: :tentative,
        risk_hint: :low
      },
      Map.new(attrs)
    )
  end

  defp build_plan(attrs \\ []) do
    defaults = [
      plan_id: "p-gate",
      turn_id: "t-gate",
      frame_ref: "f-gate",
      plan_goal: %{summary: "测试计划"},
      risk_hint: :low,
      proposed_actions: [build_action()],
      state_changes_requested: [],
      required_capabilities: ["prose_writing"],
      fallback_strategy: %{downgrade_message: "先聊聊方向"}
    ]

    struct!(MicroPlan, Keyword.merge(defaults, attrs))
  end

  defp gate_outcomes({:pass, results}), do: Map.new(results, &{&1.gate, &1.outcome})

  defp gate_outcomes({:block, _gate, _reason, results}),
    do: Map.new(results, &{&1.gate, &1.outcome})

  defp gate_outcomes({:replay_existing, _gate, _ref, results}),
    do: Map.new(results, &{&1.gate, &1.outcome})

  defp first_blocking_gate({:block, gate, _reason, _results}), do: gate
  defp first_blocking_gate({:pass, _results}), do: nil

  # ── 契约：12 门与 version ────────────────────────

  describe "gate order contract" do
    test "exposes ADR-0005 12-gate order and version" do
      assert GateOrder.gate_order_version() == "adr-0005-v1"

      assert GateOrder.gate_names() == [
               :correlation,
               :envelope_validation,
               :behavior_compatibility,
               :action_scope,
               :slot_contract_validation,
               :authority,
               :policy_safety,
               :budget,
               :toolbox_availability,
               :write_boundary,
               :trace_readiness,
               :turn_result_compat
             ]

      assert Enum.map(GateOrder.gate_specs(), & &1.order) == Enum.to_list(0..11)
    end

    test "passing plan produces one ordered GateResult per gate" do
      plan = build_plan()
      assert {:pass, results} = GateOrder.evaluate(plan)
      assert length(results) == 12
      assert Enum.map(results, & &1.gate) == GateOrder.gate_names()
      assert Enum.map(results, & &1.order) == Enum.to_list(0..11)
      assert Enum.all?(results, &match?(%GateResult{}, &1))
      assert Enum.all?(results, &(&1.outcome in [:pass, :pass_with_note]))
    end

    test "gate lineage is JSON-safe for app log and trace persistence" do
      {:pass, results} = GateOrder.evaluate(build_plan())
      lineage = GateResult.lineage(results)

      assert is_list(lineage)
      assert Enum.all?(lineage, &is_map/1)
      assert {:ok, json} = Jason.encode(lineage)
      assert json =~ "correlation"
      assert json =~ "turn_result_compat"
    end
  end

  # ── 逐门真实判定 ───────────────────────────────

  describe "gate 0 correlation" do
    test "blocks missing required refs" do
      plan = build_plan(plan_id: nil)
      assert {:block, :correlation, reason, _results} = GateOrder.evaluate(plan)
      assert reason =~ "missing required refs"
    end

    test "blocks frame/turn mismatch against injected frame" do
      plan = build_plan(turn_id: "t-other")
      frame = build_frame()

      assert {:block, :correlation, reason, _results} =
               GateOrder.evaluate(plan, nil, %{frame: frame})

      assert reason =~ "turn_id"
    end

    test "records idempotency lineage from injected author action key" do
      plan = build_plan()
      context = %{frame: build_frame(), idempotency: %{key: "confirm_abc"}}

      assert {:pass, results} = GateOrder.evaluate(plan, nil, context)
      correlation = Enum.find(results, &(&1.gate == :correlation))
      assert correlation.outcome == :pass_with_note
      assert correlation.input_refs[:idempotency_key] == "confirm_abc"
    end

    test "short-circuits with replay_existing when replay evidence is injected" do
      plan = build_plan()
      context = %{frame: build_frame(), idempotency: %{replay_decision_ref: "decision_prev"}}

      assert {:replay_existing, :correlation, "decision_prev", [result]} =
               GateOrder.evaluate(plan, nil, context)

      assert result.outcome == :replay_existing
    end
  end

  describe "gate 1 envelope validation" do
    test "blocks empty proposed actions" do
      plan = build_plan(proposed_actions: [])
      assert {:block, :envelope_validation, reason, _} = GateOrder.evaluate(plan)
      assert reason =~ "no proposed actions"
    end

    test "blocks unbounded plan" do
      plan = build_plan(stop_after_next_action: false)
      assert {:block, :envelope_validation, reason, _} = GateOrder.evaluate(plan)
      assert reason =~ "bounded to the next action"
    end
  end

  describe "gate 2 behavior compatibility" do
    test "blocks a new action scope while an author-blocking behavior is open" do
      context = %{
        frame: build_frame(),
        open_behavior: %{behavior_id: "bh-1", lifecycle_status: :awaiting_author}
      }

      assert {:block, :behavior_compatibility, reason, _} =
               GateOrder.evaluate(build_plan(), nil, context)

      assert reason =~ "open author-blocking behavior"
    end

    test "passes when the author action resolved the behavior" do
      context = %{
        frame: build_frame(),
        open_behavior: %{behavior_id: "bh-1", lifecycle_status: :awaiting_author},
        behavior_resolution: :author_confirmed
      }

      assert {:pass, results} = GateOrder.evaluate(build_plan(), nil, context)
      behavior = Enum.find(results, &(&1.gate == :behavior_compatibility))
      assert behavior.outcome == :pass_with_note
      assert behavior.notes == ["behavior_resolved:author_confirmed"]
    end
  end

  describe "gate 4 slot contract validation" do
    test "blocks proposed action missing summary" do
      plan = build_plan(proposed_actions: [build_action(action_id: "a1", summary: "")])
      assert {:block, :slot_contract_validation, reason, _} = GateOrder.evaluate(plan)
      assert reason =~ "summary missing"
    end

    test "blocks proposed action with invalid write intent" do
      plan = build_plan(proposed_actions: [build_action(write_intent: :unknown_intent)])
      assert {:block, :slot_contract_validation, reason, _} = GateOrder.evaluate(plan)
      assert reason =~ "write_intent invalid"
    end

    test "blocks production_candidate state change before write boundary" do
      plan =
        build_plan(
          state_changes_requested: [
            %{target: "chapter:1", change: "替换正文", write_intent: :production_candidate}
          ]
        )

      assert {:block, :policy_safety, reason, _} = GateOrder.evaluate(plan)
      assert reason =~ "candidate-only"
    end
  end

  describe "gate 7 budget" do
    test "blocks when run budget is exhausted" do
      context = %{frame: build_frame(), budget: %{exhausted?: true, remaining: %{tool_calls: 0}}}

      assert {:block, :budget, reason, _} = GateOrder.evaluate(build_plan(), nil, context)
      assert reason =~ "budget is exhausted"
    end

    test "blocks when tool call budget is exhausted for a tool action" do
      context = %{
        frame: build_frame(),
        budget: %{remaining: %{tool_calls: 0, provider_calls: 3}}
      }

      assert {:block, :budget, reason, _} = GateOrder.evaluate(build_plan(), nil, context)
      assert reason =~ "tool budget is exhausted"
    end

    test "passes with real remaining run budget" do
      context = %{
        frame: build_frame(),
        budget: %{remaining: %{tool_calls: 2, provider_calls: 3}}
      }

      assert {:pass, results} = GateOrder.evaluate(build_plan(), nil, context)
      budget = Enum.find(results, &(&1.gate == :budget))
      assert budget.outcome == :pass_with_note
      assert budget.notes == ["run_budget_remaining"]
    end
  end

  describe "gate 8 toolbox availability" do
    test "blocks unknown capability" do
      plan = build_plan(proposed_actions: [build_action(target_ref: "not_a_registered_tool")])

      assert {:block, :toolbox_availability, reason, _} = GateOrder.evaluate(plan)
      assert reason =~ "not registered"
    end

    test "passes registered capability" do
      plan = build_plan(proposed_actions: [build_action(target_ref: "prose_writing")])
      assert {:pass, results} = GateOrder.evaluate(plan)
      toolbox = Enum.find(results, &(&1.gate == :toolbox_availability))
      assert toolbox.outcome == :pass
    end

    test "does not require a registry hit for non-tool actions" do
      plan =
        build_plan(
          proposed_actions: [build_action(action_type: :clarification_request, target_ref: nil)]
        )

      assert {:pass, results} = GateOrder.evaluate(plan)
      toolbox = Enum.find(results, &(&1.gate == :toolbox_availability))
      assert toolbox.outcome == :pass
    end
  end

  describe "gate 10 trace readiness" do
    test "blocks when trace channel is not writable" do
      context = %{frame: build_frame(), trace_ready?: false}

      assert {:block, :trace_readiness, reason, _} =
               GateOrder.evaluate(build_plan(), nil, context)

      assert reason =~ "cannot be persisted"
    end

    test "passes when trace channel is writable" do
      context = %{frame: build_frame(), trace_ready?: true}
      assert {:pass, results} = GateOrder.evaluate(build_plan(), nil, context)
      trace = Enum.find(results, &(&1.gate == :trace_readiness))
      assert trace.outcome == :pass
    end
  end

  describe "gate 11 turn result compatibility" do
    test "blocks a frame without author-visible message" do
      frame = build_frame(author_visible_draft: %{message: ""})

      assert {:block, :turn_result_compat, reason, _} =
               GateOrder.evaluate(build_plan(), nil, %{frame: frame})

      assert reason =~ "truthful TurnResult"
    end
  end

  # ── Orchestrator 集成 ──────────────────────────

  describe "orchestrator gate lineage" do
    test "allow_tool decision carries gate version and ordered gate results" do
      frame = build_frame()
      plan = build_plan()

      {decision, _behavior} = ExecutionOrchestrator.decide(frame, plan)

      assert decision.decision_type == :allow_tool
      assert decision.gate_order_version == GateOrder.gate_order_version()
      assert length(decision.gate_results) == 12
      assert Enum.map(decision.gate_results, & &1.gate) == GateOrder.gate_names()
    end

    test "blocked decision records first blocking gate and gate lineage" do
      frame = build_frame()
      plan = build_plan(risk_hint: :high, proposed_actions: [build_action(risk_hint: :high)])

      {decision, behavior} = ExecutionOrchestrator.decide(frame, plan)

      assert decision.decision_type == :require_confirmation
      assert decision.first_blocking_gate == "authority"
      assert behavior.behavior_id
      authority = Enum.find(decision.gate_results, &(&1.gate == :authority))
      assert authority.outcome == :soft_block
      assert authority.reason_code == "high_risk_requires_author_confirmation"
    end

    test "planner boundary failure still records envelope gate result" do
      frame = build_frame(frame_id: "f-real")
      plan = build_plan(frame_ref: "f-wrong")

      {decision, nil} = ExecutionOrchestrator.decide(frame, plan)
      assert decision.first_blocking_gate == "planner_boundary"

      assert [%GateResult{gate: :envelope_validation, outcome: :hard_block}] =
               decision.gate_results
    end

    test "confirmation re-gate is gate-visible and does not bypass policy" do
      frame = build_frame()
      plan = build_plan(risk_hint: :high, proposed_actions: [build_action(risk_hint: :high)])

      {:ok, binding} =
        ConfirmationBinding.build(%{
          behavior_ref: "bh-1",
          target_ref: "prose_writing",
          author_input_ref: "in-1",
          answer_type: :confirm,
          idempotency_key: "ik-gate",
          rebased_state_snapshot_ref: "state_snapshot:work-1:turn-1:plan-1",
          gate_result_refs: ["gate_result:turn-1:plan-1:confirm"],
          trace_ref: "decision_trace:turn-1"
        })

      {decision, _behavior} =
        ExecutionOrchestrator.decide(frame, plan,
          confirmation_binding: binding,
          gate_context: %{idempotency: %{key: binding.idempotency_key}}
        )

      assert decision.decision_type == :allow_tool
      authority = Enum.find(decision.gate_results, &(&1.gate == :authority))
      assert authority.outcome == :pass_with_note
      correlation = Enum.find(decision.gate_results, &(&1.gate == :correlation))
      assert correlation.input_refs[:idempotency_key] == "ik-gate"
    end
  end

  describe "gate-passed downgrade truthfulness" do
    test "gates all pass but no dispatchable action keeps first_blocking_gate nil" do
      frame = build_frame()

      plan =
        build_plan(
          proposed_actions: [
            build_action(action_id: "a1", action_type: :clarification_request, target_ref: nil)
          ]
        )

      {decision, nil} = ExecutionOrchestrator.decide(frame, plan)

      assert decision.decision_type == :downgrade_to_dialogue
      assert decision.first_blocking_gate == nil
      assert "no_dispatchable_action" in decision.reason_codes
      assert length(decision.gate_results) == 12
      assert Enum.all?(decision.gate_results, &(&1.outcome in [:pass, :pass_with_note]))
    end
  end

  describe "gate 8 toolbox dispatchability" do
    test "blocks a registered but non-dispatchable capability (disabled/deprecated)" do
      context = %{
        frame: build_frame(),
        capability_resolver: fn name -> name == "always_available" end
      }

      plan = build_plan(proposed_actions: [build_action(target_ref: "disabled_tool")])

      assert {:block, :toolbox_availability, reason, _} =
               GateOrder.evaluate(plan, nil, context)

      assert reason =~ "not registered"
    end

    test "passes only dispatchable registered capabilities" do
      plan = build_plan(proposed_actions: [build_action(target_ref: "prose_writing")])
      assert {:pass, results} = GateOrder.evaluate(plan)
      toolbox = Enum.find(results, &(&1.gate == :toolbox_availability))
      assert toolbox.outcome == :pass
    end
  end

  # ── Trace / Replay 记录 ────────────────────────

  describe "DecisionTrace records gate lineage" do
    test "trace with tool carries gate version and gate result refs" do
      frame = build_frame()
      plan = build_plan()
      {decision, _} = ExecutionOrchestrator.decide(frame, plan)

      req = %NovelCommon.Contracts.ToolRequest{
        tool_request_id: "req-gate",
        turn_id: frame.turn_id,
        frame_ref: frame.frame_id,
        decision_ref: decision.decision_id,
        tool_name: "prose_writing",
        tool_version: "1.0.0"
      }

      result = %NovelCommon.Contracts.ToolResult{
        tool_result_id: "res-gate",
        tool_request_ref: "req-gate",
        tool_name: "prose_writing",
        status: :succeeded,
        output: %{},
        errors: []
      }

      {trace, summary} =
        TraceWriter.record_with_tool(
          frame,
          plan,
          decision,
          req,
          result,
          %{turn_id: frame.turn_id},
          nil
        )

      assert trace.gate_order_version == GateOrder.gate_order_version()
      assert length(trace.gate_result_refs) == 12
      assert Enum.all?(trace.gate_result_refs, &is_map/1)
      assert summary.gate_order_version == GateOrder.gate_order_version()
      assert length(summary.gate_results) == 12
    end

    test "blocked decision trace carries gate version, blocking gate and lineage" do
      frame = build_frame()
      plan = build_plan(risk_hint: :high, proposed_actions: [build_action(risk_hint: :high)])
      {decision, _} = ExecutionOrchestrator.decide(frame, plan)

      {trace, summary} =
        TraceWriter.record_with_decision(frame, plan, decision, %{turn_id: frame.turn_id}, nil)

      assert trace.gate_order_version == GateOrder.gate_order_version()
      # 阻断发生在第 6 门 authority：lineage 记录 0..5，不伪造后续门。
      assert length(trace.gate_result_refs) == 6
      assert Enum.map(trace.gate_result_refs, & &1[:gate]) |> List.last() == "authority"
      assert summary.first_blocking_gate == "authority"
      assert summary.gate_order_version == GateOrder.gate_order_version()
      authority = Enum.find(summary.gate_results, &(&1.gate == "authority"))
      assert authority.outcome == "soft_block"
      assert authority.reason_code == "high_risk_requires_author_confirmation"
    end

    test "replay report answers gate order question from recorded lineage" do
      trace = %DecisionTrace{
        trace_id: "trace-gate-1",
        turn_id: "t-gate",
        frame_ref: "f-gate",
        plan_ref: "p-gate",
        decision_type: :tool_dispatched,
        no_tool_reason: "tool_was_dispatched",
        no_behavior_reason: "tool_execution_completed",
        no_write_reason: "tool_result_not_adoption_awaiting_adoption_boundary",
        turn_result_ref: "t-gate",
        replay_policy: %{use_recorded_frame: true, recall_provider: false},
        redaction_level: :author_safe,
        gate_order_version: GateOrder.gate_order_version(),
        gate_result_refs: [
          %{gate: "correlation", order: 0, outcome: "pass_with_note"},
          %{gate: "action_scope", order: 3, outcome: "hard_block", reason_code: "multi_step"}
        ],
        event_order: [:author_input_received]
      }

      report = ReplayService.build_report(trace)

      gate_step = Enum.find(report.chain_summary, &(&1.step == "gate_order"))
      assert gate_step
      assert gate_step.ref == GateOrder.gate_order_version()

      # VS-06 六问契约不变：gate order version / first blocking gate 并入 decision_reason。
      assert length(report.required_questions) == 6
      question = Enum.find(report.required_questions, &(&1.id == :decision_reason))
      assert question.status == :answered
      assert question.answer =~ "gate_order_version=#{GateOrder.gate_order_version()}"
      assert question.answer =~ "first_blocking_gate=action_scope"
    end
  end

  # ── GateResult 语义 ────────────────────────────

  describe "GateResult" do
    test "outcome enum covers ADR-0005 semantics" do
      assert GateResult.outcomes() == [
               :pass,
               :pass_with_note,
               :soft_block,
               :hard_block,
               :replay_existing,
               :recoverable_failure
             ]
    end

    test "blocking? only true for blocking outcomes" do
      assert GateResult.blocking?(GateResult.block(:authority, 5, :soft_block, "r", "reason"))
      refute GateResult.blocking?(GateResult.pass(:authority, 5))
      refute GateResult.blocking?(GateResult.pass_with_note(:budget, 7, "note"))
    end

    test "to_map drops internal-only material and keeps audit facts" do
      result =
        GateResult.block(:authority, 5, :soft_block, "high_risk", "需确认", author_visible: true)

      map = GateResult.to_map(result)

      assert map.gate == "authority"
      assert map.outcome == "soft_block"
      assert map.reason_code == "high_risk"
      assert map.author_visible == true
      refute Map.has_key?(map, :__struct__)
    end
  end
end
