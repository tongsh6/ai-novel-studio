defmodule NovelApplication.AgentRunFlows.LedgerReconciliation do
  @moduledoc """
  全书审读 AgentRun profile（VS-00F CP4c-2 / 契约 §3.2 `ledger_reconciliation_v1`）。

  建立在 `readonly_batch_context_v1` 的只读工具纪律上，区别仅在允许产出恰一个
  tentative `reconciliation_report_artifact`（repo 物化，TENTATIVE/单活跃/SUPERSEDE
  链——CP2b 语义）。规则判定全程机械（I-L4，模型不参与）；模型只起草计划；
  turn 文案为 app 侧事实口径（readonly 先例）。异步于 turn 主链，失败诚实失败。
  """

  alias NovelApplication.AgentFinalizer
  alias NovelApplication.AgenticNextStepPlanner
  alias NovelApplication.AgenticPlanDraftPlanner
  alias NovelApplication.LedgerReconciliationService
  alias NovelDomain.{AgentNextStepDecision, AgentObservation, AgentStep}

  @profile_ref "ledger_reconciliation_v1"
  @reconcile_step_target "ledger_reconcile"
  @plan_exhausted_replan_reason "计划步骤已走完，但全书审读尚未完成。"

  @spec profile_ref() :: String.t()
  def profile_ref, do: @profile_ref

  @spec next_step_planner(map()) :: NovelApplication.AgentRunServer.next_step_planner()
  def next_step_planner(spec) when is_map(spec) do
    fn run, sequence, snapshot ->
      with {:ok, plan, plan_meta} <- plan_for_run(run, snapshot, spec),
           {:ok, decision, result_meta} <-
             mechanical_decision(%{run | plan: plan}, sequence, snapshot, plan_meta) do
        decision
        |> next_step_from_decision(spec)
        |> with_plan_cursor(Map.get(result_meta, :agent_plan_cursor, 0), result_meta)
        |> AgenticNextStepPlanner.with_provider_call_meta(result_meta)
      end
    end
  end

  defp plan_for_run(run, snapshot, spec) do
    if model_plan_ready?(run.plan) do
      {:ok, run.plan, %{provider_call_count: 0, suppress_plan_event: true}}
    else
      with {:ok, plan, meta} <-
             AgenticPlanDraftPlanner.draft_plan_with_meta(
               run,
               planner_provider_execution(spec),
               snapshot
             ) do
        {:ok, plan, Map.put(meta, :agent_plan, plan)}
      end
    end
  end

  defp model_plan_ready?(plan) when is_map(plan) do
    case Map.get(plan, :steps) || Map.get(plan, "steps") do
      [_ | _] = steps -> Enum.all?(steps, &(not blank?(map_get(&1, :target_tool_ref))))
      _ -> false
    end
  end

  defp model_plan_ready?(_plan), do: false

  defp mechanical_decision(run, sequence, snapshot, meta) do
    steps = plan_steps(run.plan)
    index = plan_cursor(snapshot)
    meta = Map.put(meta, :agent_plan_cursor, index)

    cond do
      index < length(steps) ->
        steps
        |> Enum.at(index)
        |> mechanical_execute_decision(run, sequence, meta)

      reconciled?(snapshot) ->
        {:ok, complete_decision(run, sequence, observation_refs(snapshot)), meta}

      true ->
        {:error, {:plan_exhausted, @plan_exhausted_replan_reason}}
    end
  end

  defp mechanical_execute_decision(step, run, sequence, meta) do
    target = map_get(step, :target_tool_ref)

    with true <- target == @reconcile_step_target,
         {:ok, decision} <-
           AgentNextStepDecision.new(%{
             decision_id:
               "and_#{run.run_id}_#{sequence}_plan_#{map_get(step, :step_id) || sequence}",
             run_ref: run.run_id,
             sequence: sequence,
             decision_type: :execute_step,
             summary: map_get(step, :description) || "机械执行全书审读并物化审读报告。",
             target_tool_ref: target,
             write_intent: :tentative,
             risk_hint: :low,
             reason_codes: ["agent_plan_step", "ledger_reconcile_mechanical"],
             observation_refs: [],
             evaluation_of_last: nil,
             plan_revision: map_get(meta, :plan_revision),
             confidence: 1.0
           }) do
      {:ok, decision, meta}
    else
      _ -> {:error, {:invalid_plan_step_target, target}}
    end
  end

  defp complete_decision(run, sequence, observation_refs) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "and_#{run.run_id}_#{sequence}_ledger_reconcile_complete",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :goal_satisfied,
        summary: "全书审读已完成并物化审读结论。",
        reason_codes: ["ledger_reconcile_finalized", "goal_satisfied"],
        observation_refs: observation_refs
      })

    decision
  end

  defp next_step_from_decision(
         %AgentNextStepDecision{
           decision_type: :execute_step,
           target_tool_ref: @reconcile_step_target
         } = decision,
         spec
       ) do
    {:execute,
     fn run, sequence, snapshot ->
       if reconciled?(snapshot) do
         finalize_step().(run, sequence, snapshot)
       else
         reconcile_step(spec).(run, sequence, snapshot)
       end
     end, decision}
  end

  defp next_step_from_decision(
         %AgentNextStepDecision{decision_type: :goal_satisfied} = decision,
         _spec
       ),
       do: {:complete, decision}

  defp next_step_from_decision(decision, _spec), do: {:await_author, decision}

  defp with_plan_cursor({:execute, step_fun, decision}, cursor, meta)
       when is_function(step_fun) do
    {:execute, wrap_plan_step(step_fun, cursor, meta), decision}
  end

  defp with_plan_cursor(other, _cursor, _meta), do: other

  defp wrap_plan_step(step_fun, cursor, meta) do
    fn run, sequence, snapshot ->
      run
      |> maybe_put_agent_plan(meta)
      |> then(&step_fun.(&1, sequence, snapshot))
      |> advance_plan_cursor(cursor, meta)
    end
  end

  defp maybe_put_agent_plan(run, %{agent_plan: plan}) when is_map(plan) do
    %{run | plan: plan, plan_ref: plan.plan_id, plan_version: plan.version}
  end

  defp maybe_put_agent_plan(run, _meta), do: run

  defp advance_plan_cursor({:ok, result}, cursor, meta) when is_map(result) do
    {:ok,
     result
     |> Map.update(:stage_state, %{agent_plan_cursor: cursor + 1}, fn stage_state ->
       Map.merge(stage_state || %{}, %{agent_plan_cursor: cursor + 1})
     end)
     |> maybe_put_plan_run_patch(meta)}
  end

  defp advance_plan_cursor(result, _cursor, _meta), do: result

  defp maybe_put_plan_run_patch(result, %{agent_plan: plan}) when is_map(plan) do
    patch = %{plan: plan, plan_ref: plan.plan_id, plan_version: plan.version}
    Map.update(result, :run_patch, patch, fn existing -> Map.merge(existing || %{}, patch) end)
  end

  defp maybe_put_plan_run_patch(result, _meta), do: result

  # 机械审读步：扫描全账面 vs 设计并物化报告（CP2b materialize；空偏离不落盘）。
  defp reconcile_step(spec) do
    fn run, sequence, _snapshot ->
      outcome = reconcile_fn(spec).(run.work_id)

      {:ok,
       %{
         step: step(run, sequence, "ledger_reconcile"),
         observations: [observation(run, sequence, outcome)],
         stage_state: %{ledger_reconcile: reconcile_summary(outcome)},
         tool_call_count: 1,
         progress_signature: "#{run.run_id}:ledger_reconciled"
       }}
    end
  end

  defp reconcile_fn(%{reconcile_fn: fun}) when is_function(fun, 1), do: fun

  defp reconcile_fn(_spec) do
    fn work_id ->
      LedgerReconciliationService.materialize(
        work_id,
        LedgerReconciliationService.persistence_deps(),
        LedgerReconciliationService.persistence_report_repo(),
        nil
      )
    end
  end

  defp reconcile_summary({:ok, :no_findings}), do: %{status: :no_findings, finding_count: 0}

  defp reconcile_summary({:ok, report}) when is_map(report),
    do: %{status: :report, finding_count: report.finding_count, report_id: report.id}

  defp reconcile_summary({:error, reason}), do: %{status: :error, reason: inspect(reason)}

  defp observation(run, sequence, outcome) do
    summary_map = reconcile_summary(outcome)

    text =
      case summary_map.status do
        :no_findings -> "全书审读完成：未发现偏离，不产生新报告。"
        :report -> "全书审读完成：发现 #{summary_map.finding_count} 处偏离，审读报告已物化（TENTATIVE）。"
        :error -> "全书审读失败：#{summary_map.reason}"
      end

    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: "obs_#{run.run_id}_#{sequence}_ledger_reconcile",
        run_ref: run.run_id,
        step_ref: current_step_ref(run, sequence),
        observation_type: :tool_fact,
        source_ref: "ledger_reconcile:#{run.work_id}",
        summary: text,
        structured_payload: summary_map,
        evidence_refs: ["agent_event:ledger_reconcile", "ledger_report:#{run.work_id}"]
      })

    observation
  end

  defp finalize_step do
    fn run, sequence, snapshot ->
      summary_map =
        snapshot
        |> Map.get(:stage_state, %{})
        |> Map.get(:ledger_reconcile, %{status: :no_findings, finding_count: 0})

      turn_result =
        run
        |> turn_result(summary_map)
        |> AgentFinalizer.attach_run_summary(%{
          run_id: run.run_id,
          run_mode: run.run_mode,
          parent_turn_ref: run.parent_turn_ref,
          profile_ref: run.profile_ref,
          status: :completed
        })

      {:ok,
       %{
         step: step(run, sequence, "ledger_reconcile_finalize"),
         observations: [],
         turn_result: turn_result,
         loop_status: :completed,
         loop_decision: complete_decision(run, sequence, observation_refs(snapshot)),
         progress_signature: "#{run.run_id}:ledger_reconcile_finalized"
       }}
    end
  end

  # app 侧事实口径（readonly 先例）：机械产出如实汇报，不代模型发声、不改设定或正文。
  defp turn_result(run, summary_map) do
    text =
      case summary_map do
        %{status: :report, finding_count: count} ->
          "全书审读完成：发现 #{count} 处偏离，审读报告已就绪——档案「脉络」页可逐项处置。未改动任何设定或正文。"

        %{status: :error, reason: reason} ->
          "全书审读未完成：#{reason}。未改动任何设定或正文。"

        _ ->
          "全书审读完成：五条脉络未发现偏离。未改动任何设定或正文。"
      end

    %{
      schema_version: "3.0-draft",
      turn_id: "#{run.parent_turn_ref}:agent:ledger_reconcile",
      parent_turn_id: run.parent_turn_ref,
      phase: "completed",
      status: "completed",
      next_action: "none",
      assistant_message: %{text: text},
      ui_cards: [],
      available_actions: [],
      tool_result: %{status: :succeeded, artifact_refs: [], errors: []},
      artifact_set: nil
    }
  end

  defp reconciled?(snapshot) do
    snapshot
    |> Map.get(:stage_state, %{})
    |> Map.get(:ledger_reconcile)
    |> is_map()
  end

  defp observation_refs(snapshot) do
    snapshot
    |> Map.get(:observations, [])
    |> Enum.map(& &1.observation_id)
  end

  defp step(run, sequence, suffix) do
    {:ok, step} =
      AgentStep.new(%{
        step_id: current_step_ref(run, sequence),
        run_ref: run.run_id,
        sequence: sequence,
        status: :completed,
        goal: step_goal(suffix),
        micro_plan_ref: "mp_#{run.run_id}_#{suffix}_#{sequence}",
        decision_ref: "decision_#{run.run_id}_ledger_reconcile_#{sequence}",
        tool_request_ref: "ledger_reconcile_request_#{run.run_id}_#{sequence}",
        tool_result_ref: "ledger_reconcile_result_#{run.run_id}_#{sequence}",
        observation_refs: [],
        state_snapshot_ref: "agent_snapshot:#{run.work_id}:#{run.run_id}:#{suffix}",
        idempotency_key: "#{run.run_id}:#{sequence}:#{suffix}:goal_v#{run.goal.version}"
      })

    step
  end

  defp step_goal("ledger_reconcile"), do: "机械执行全书审读"
  defp step_goal(_suffix), do: "汇总审读结论"

  defp current_step_ref(run, sequence), do: "step_#{run.run_id}_#{sequence}"

  defp planner_provider_execution(spec) do
    Map.get(spec, :planner_provider_execution) || Map.get(spec, :provider_execution)
  end

  defp plan_cursor(snapshot) when is_map(snapshot) do
    snapshot
    |> Map.get(:stage_state, %{})
    |> map_get(:agent_plan_cursor)
    |> case do
      value when is_integer(value) and value >= 0 -> value
      _ -> 0
    end
  end

  defp plan_cursor(_snapshot), do: 0

  defp plan_steps(plan) when is_map(plan) do
    case Map.get(plan, :steps) || Map.get(plan, "steps") do
      steps when is_list(steps) -> steps
      _ -> []
    end
  end

  defp plan_steps(_plan), do: []

  defp map_get(map, key) when is_map(map), do: Map.get(map, key) || Map.get(map, to_string(key))
  defp map_get(_map, _key), do: nil

  defp blank?(value), do: not is_binary(value) or String.trim(value) == ""
end
