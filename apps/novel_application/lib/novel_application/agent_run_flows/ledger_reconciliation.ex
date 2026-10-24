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
  alias NovelApplication.AgentRunFlows.MechanicalPlan
  alias NovelApplication.AgentRunFlows.TurnBinding
  alias NovelApplication.AuxTaskBuilder
  alias NovelApplication.LedgerReconciliationService
  alias NovelCommon.Contracts.AuthoringTask
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

  # B27 CP3c / D2：固定单步维护 run 用机械计划，不再模型起草无业务目标的计划。
  # 两步与既有 step 语义同形：第一步机械审读，第二步汇总作者回执。
  defp plan_for_run(run, _snapshot, _spec) do
    if MechanicalPlan.ready?(run.plan, @reconcile_step_target) do
      {:ok, run.plan, %{provider_call_count: 0, suppress_plan_event: true}}
    else
      plan =
        MechanicalPlan.for_run(run, [
          %{
            step_id: "ledger_reconcile_1",
            target_tool_ref: @reconcile_step_target,
            description: "机械执行全书审读并物化审读报告。",
            success_criteria: ["ledger_reconcile_observation_exists"],
            write_intent: :tentative
          },
          %{
            step_id: "ledger_reconcile_finalize_1",
            target_tool_ref: @reconcile_step_target,
            description: "汇总审读结论并声明未改动设定或正文。",
            success_criteria: ["ledger_reconcile_turn_result_emitted", "production_write_false"],
            write_intent: :none
          }
        ])

      {:ok, plan,
       %{
         provider_call_count: 0,
         suppress_plan_event: true,
         agent_plan: plan,
         agent_plan_cursor: 0
       }}
    end
  end

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
        summary_map = snapshot |> Map.get(:stage_state, %{}) |> Map.get(:ledger_reconcile, %{})
        {:ok, final_decision(run, sequence, summary_map, observation_refs(snapshot)), meta}

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

  # B27 CP3c / C3：审读失败时不用 goal_satisfied 冒充完成；run 生命周期可结束，
  # 但决策语义是未达成（作者文案同步「未完成」）。
  defp unfulfilled_decision(run, sequence, summary_map, observation_refs) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "and_#{run.run_id}_#{sequence}_ledger_reconcile_unfulfilled",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :no_progress,
        summary: "全书审读未完成：#{Map.get(summary_map, :reason, "未知原因")}。未改动任何设定或正文。",
        reason_codes: ["ledger_reconcile_failed", "goal_unfulfilled"],
        observation_refs: observation_refs
      })

    decision
  end

  defp final_decision(run, sequence, summary_map, observation_refs) do
    case Map.get(summary_map, :status) do
      :error -> unfulfilled_decision(run, sequence, summary_map, observation_refs)
      _ -> complete_decision(run, sequence, observation_refs)
    end
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
         %AgentNextStepDecision{decision_type: decision_type} = decision,
         _spec
       )
       when decision_type in [:goal_satisfied, :no_progress],
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
      summary_map = reconcile_summary(outcome)

      case AuxTaskBuilder.for_ledger_reconcile(%{
             work_id: run.work_id,
             trigger: :agent_run,
             scanned_at_seq: Map.get(summary_map, :scanned_at_seq),
             author_words: run.goal.text
           }) do
        {:ok, task} ->
          summary_map = Map.put(summary_map, :authoring_task, AuthoringTask.to_map(task))

          {:ok,
           %{
             step: step(run, sequence, "ledger_reconcile"),
             observations: [observation(run, sequence, outcome)],
             stage_state: %{ledger_reconcile: summary_map},
             tool_call_count: 1,
             progress_signature: "#{run.run_id}:ledger_reconciled"
           }}

        {:error, reason} ->
          {:error, {:ledger_reconcile_task_invalid, reason}}
      end
    end
  end

  defp reconcile_fn(%{reconcile_fn: fun}) when is_function(fun, 1), do: fun

  defp reconcile_fn(_spec) do
    fn work_id ->
      deps = LedgerReconciliationService.persistence_deps()
      report_repo = LedgerReconciliationService.persistence_report_repo()

      with {:ok, scan} <- LedgerReconciliationService.scan(work_id, deps),
           {:ok, outcome} <-
             LedgerReconciliationService.materialize_from_scan(work_id, scan, report_repo, nil) do
        coverage = %{
          rules_evaluated: scan.rules_evaluated,
          rules_skipped: scan.rules_skipped,
          scope: scan.scope
        }

        {:ok, outcome, coverage}
      end
    end
  end

  defp reconcile_summary({:ok, :no_findings}), do: %{status: :no_findings, finding_count: 0}

  defp reconcile_summary({:ok, report}) when is_map(report),
    do: %{status: :report, finding_count: report.finding_count, report_id: report.id}

  defp reconcile_summary({:ok, :no_findings, coverage}) do
    coverage |> Map.put(:status, :no_findings) |> Map.put(:finding_count, 0)
  end

  defp reconcile_summary({:ok, report, coverage}) when is_map(report) do
    coverage
    |> Map.put(:status, :report)
    |> Map.put(:finding_count, report.finding_count)
    |> Map.put(:report_id, report.id)
  end

  defp reconcile_summary({:error, reason}), do: %{status: :error, reason: inspect(reason)}

  defp observation(run, sequence, outcome) do
    summary_map = reconcile_summary(outcome)

    skipped_note = coverage_skipped_note(summary_map)

    text =
      case summary_map.status do
        :no_findings ->
          "全书审读完成：未发现偏离，不产生新报告。#{skipped_note}"

        :report ->
          "全书审读完成：发现 #{summary_map.finding_count} 处偏离，审读报告已物化（TENTATIVE）。#{skipped_note}"

        :error ->
          "全书审读失败：#{summary_map.reason}"
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
         loop_decision: final_decision(run, sequence, summary_map, observation_refs(snapshot)),
         progress_signature: "#{run.run_id}:ledger_reconcile_finalized"
       }}
    end
  end

  # app 侧事实口径（readonly 先例）：机械产出如实汇报，不代模型发声、不改设定或正文。
  # B27 CP3c / C3：run 可以结束，但「完成」声明只属于真实成功的审读；error 时
  # phase/status 如实标 failed，且不伪造 tool_result 成功。
  defp turn_result(run, summary_map) do
    skipped_note = coverage_skipped_note(summary_map)

    text =
      case summary_map do
        %{status: :report, finding_count: count} ->
          "全书审读完成：发现 #{count} 处偏离，审读报告已就绪——档案「脉络」页可逐项处置。#{skipped_note}未改动任何设定或正文。"

        %{status: :error, reason: reason} ->
          "全书审读未完成：#{reason}。未改动任何设定或正文。"

        _ ->
          "全书审读完成：已执行规则未发现偏离。#{skipped_note}未改动任何设定或正文。"
      end

    {phase, status, tool_status} =
      case summary_map do
        %{status: :error} -> {"failed", "failed_recoverable", :failed}
        _ -> {"completed", "completed", :succeeded}
      end

    %{
      schema_version: "3.0-draft",
      turn_id: TurnBinding.bind(run, "ledger_reconcile"),
      parent_turn_id: run.parent_turn_ref,
      phase: phase,
      status: status,
      next_action: "none",
      assistant_message: %{text: text},
      ui_cards: [],
      available_actions: [],
      tool_result: %{status: tool_status, artifact_refs: [], errors: []},
      artifact_set: nil
    }
  end

  defp coverage_skipped_note(%{rules_skipped: [_ | _] = skipped}) do
    "另有 #{length(skipped)} 项规则因数据缺失/读端口缺席未执行（覆盖清单见轨迹），不构成「全书无问题」结论。"
  end

  defp coverage_skipped_note(_summary_map), do: ""

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
end
