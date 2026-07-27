defmodule NovelApplication.AgentRunFlows.ProseDraftingWithQuality do
  @moduledoc """
  Bounded AgentRun flow that drafts prose through the existing prose execution
  and quality-review chain.
  """

  alias NovelAgent.AgentTaskProfileRegistry
  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentFinalizer
  alias NovelApplication.AgenticDeviationSignal
  alias NovelApplication.AgenticNextStepPlanner
  alias NovelApplication.AgenticPlanDraftPlanner
  alias NovelApplication.AgentObservationAssembler
  alias NovelApplication.ContextAssembler
  alias NovelApplication.DialogueGateway
  alias NovelApplication.ExecutionOrchestrator
  alias NovelApplication.JudgmentProtocol
  alias NovelApplication.ProviderActivityProjector
  alias NovelApplication.TurnExecutionService
  alias NovelCommon.LogContext
  alias NovelDomain.AgentNextStepDecision
  alias NovelDomain.AgentObservation
  alias NovelDomain.AgentStep
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan

  @profile_ref "prose_drafting_with_quality_v1"
  @context_step_target "context_assemble"
  @plan_exhausted_replan_reason "计划步骤已走完，但正文候选尚未生成。"

  @spec profile_ref() :: String.t()
  def profile_ref, do: @profile_ref

  @spec steps(map()) :: no_return()
  def steps(_spec) do
    raise ArgumentError, "prose_drafting_with_quality_v1 requires next_step_planner/1"
  end

  @spec next_step_planner(map()) :: NovelApplication.AgentRunServer.next_step_planner()
  def next_step_planner(spec) when is_map(spec) do
    fn run, sequence, snapshot ->
      with {:ok, plan, plan_meta} <- plan_for_run(run, snapshot, spec),
           {:ok, decision, result_meta} <-
             mechanical_decision(%{run | plan: plan}, sequence, snapshot, plan_meta, spec) do
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
      [_ | _] = steps ->
        Enum.all?(steps, &(not blank?(map_get(&1, :target_tool_ref))))

      _ ->
        false
    end
  end

  defp model_plan_ready?(_plan), do: false

  defp mechanical_decision(run, sequence, snapshot, meta, spec) do
    # M0 缺陷修复（2026-07-19）：作者已采纳本轮候选 = 单候选循环的作者终局——
    # 在迭代边界机械收束（0 调用），不再对已被作者拿走的候选跑判断②/改进步/
    # 产未请求的第二候选（僵尸候选 T5 判断纪元形态）。
    if author_adopted_refs(snapshot) != [] do
      mechanical_author_adopted_complete(run, sequence)
    else
      mechanical_decision_without_settlement(run, sequence, snapshot, meta, spec)
    end
  end

  defp author_adopted_refs(snapshot) do
    stage = Map.get(snapshot, :stage_state) || Map.get(snapshot, "stage_state") || %{}
    Map.get(stage, :author_adopted_refs) || Map.get(stage, "author_adopted_refs") || []
  end

  defp mechanical_author_adopted_complete(run, sequence) do
    AgentNextStepDecision.new(%{
      decision_id: "and_#{run.run_id}_#{sequence}_author_adopted",
      run_ref: run.run_id,
      sequence: sequence,
      decision_type: :goal_satisfied,
      summary: "作者已采纳本轮候选，运行收束。",
      target_tool_ref: nil,
      write_intent: :none,
      risk_hint: :low,
      reason_codes: ["goal_satisfied", "author_adopted_candidate"],
      observation_refs: [],
      evaluation_of_last: %{advanced: true, plan_holds: true, new_constraint: nil},
      confidence: 1.0
    })
    |> case do
      {:ok, decision} -> {:ok, decision, %{provider_call_count: 0, suppress_plan_event: true}}
      error -> error
    end
  end

  defp mechanical_decision_without_settlement(run, sequence, snapshot, meta, spec) do
    steps = plan_steps(run.plan)
    index = plan_cursor(snapshot)
    meta = Map.put(meta, :agent_plan_cursor, index)

    case AgenticDeviationSignal.next(run, snapshot, steps, index) do
      nil ->
        cond do
          index < length(steps) ->
            steps
            |> Enum.at(index)
            |> mechanical_execute_decision(run, sequence, snapshot, meta)

          completion_ready?(snapshot) ->
            mechanical_complete_decision(run, sequence)

          true ->
            maybe_replan_exhausted_plan(run, sequence, snapshot, spec)
        end

      deviation ->
        maybe_replan_deviation(run, sequence, snapshot, spec, deviation)
    end
  end

  # CP3a（ADR-0025 判断②）：偏离信号不再打给"计划修订模型"（修订产出的"新计划"
  # 只是同两步重排、坐标不变——纯伪修订）；改为判断②独立短调用（探针裁决形态）：
  # 观察 + 续行——continue（按 guidance 重试当前步）｜ await_author（停等作者）。
  defp maybe_replan_deviation(run, sequence, snapshot, spec, deviation) do
    if replan_available?(run) do
      continuation_judgment(run, sequence, snapshot, spec, deviation, :retry_current)
    else
      mechanical_await_author_decision(run, sequence)
    end
  end

  # 计划耗尽而正文未产出（D6 语义判断②形态）：continue = 机械追加 prose 步
  # （耗尽未产出时缺的必然是产出步——机械判据成立），await = 停等作者。
  defp maybe_replan_exhausted_plan(run, sequence, snapshot, spec) do
    if replan_available?(run) do
      deviation = %{
        signal: "plan_exhausted",
        ref: "plan_exhausted_v#{run.plan_version || 1}",
        summary: @plan_exhausted_replan_reason
      }

      continuation_judgment(run, sequence, snapshot, spec, deviation, :append_prose)
    else
      mechanical_await_author_decision(run, sequence)
    end
  end

  defp continuation_judgment(run, sequence, snapshot, spec, deviation, continue_mode) do
    input = %{
      goal_text: run.goal.text,
      deviation_summary: AgenticDeviationSignal.revision_reason(deviation),
      observation_block: continuation_observation_block(snapshot)
    }

    case JudgmentProtocol.request_continuation(
           continuation_provider_execution(spec, snapshot),
           snapshot,
           input
         ) do
      {:ok, %{action: "continue"} = continuation} ->
        continue_after_judgment(run, sequence, snapshot, deviation, continuation, continue_mode)

      {:ok, %{action: "await_author"} = continuation} ->
        continuation_await_decision(run, sequence, snapshot, deviation, continuation)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp continuation_provider_execution(spec, snapshot) do
    (Map.get(spec, :planner_provider_execution) ||
       Map.get(spec, :provider_execution) ||
       Execution.dependency(purpose: :planner))
    |> ProviderActivityProjector.with_stage_sink(snapshot, purpose: :planner)
  end

  defp continuation_observation_block(snapshot) do
    snapshot
    |> Map.get(:observations, [])
    |> Enum.map(& &1.summary)
    |> Enum.reject(&blank?/1)
    |> case do
      [] -> nil
      summaries -> summaries |> Enum.take(-6) |> Enum.join("\n")
    end
  end

  defp continue_after_judgment(run, sequence, snapshot, deviation, continuation, continue_mode) do
    steps = plan_steps(run.plan)
    index = plan_cursor(snapshot)

    step =
      case continue_mode do
        :retry_current when index < length(steps) -> Enum.at(steps, index)
        _ -> mechanical_prose_retry_step(continuation)
      end

    meta =
      %{
        provider_call_count: continuation.provider_call_count,
        agent_plan_cursor: min(index, max(length(steps) - 1, 0)),
        # replan 计数由 runtime 按 decision 的 plan_revision 事实自动 +1
        # （maybe_attach_replan），meta 不重复计。
        # CP3b：续行重产出即替代本 run 的中间稿（改进闭环，pending 预算随之放行）。
        supersede_artifact_refs: run.pending_artifact_refs,
        reason_codes: ["judgment_continuation", "judgment_continue"],
        evaluation_of_last: %{
          advanced: false,
          plan_holds: false,
          new_constraint: continuation.guidance
        },
        plan_revision: %{
          revision_reason: continuation.narrative,
          guidance: continuation.guidance
        },
        author_narrative: continuation.narrative,
        author_narrative_source: continuation.narrative_source
      }
      |> attach_deviation_meta(deviation, snapshot)

    mechanical_execute_decision(step, run, sequence, snapshot, meta)
  end

  defp mechanical_prose_retry_step(continuation) do
    %{
      step_id: "judgment_continue_prose",
      target_tool_ref: "prose_writing",
      description: "按判断②指引继续生成正文草稿：#{continuation.guidance}",
      write_intent: :tentative
    }
  end

  defp continuation_await_decision(run, sequence, snapshot, deviation, continuation) do
    with {:ok, decision, await_meta} <- mechanical_await_author_decision(run, sequence) do
      decision = %{
        decision
        | summary: continuation.narrative,
          reason_codes:
            (["judgment_continuation", "judgment_await_author"] ++
               AgenticDeviationSignal.reason_codes(deviation) ++ decision.reason_codes)
            |> Enum.uniq()
            |> Enum.reject(&(&1 == "agent_plan_revised"))
      }

      meta =
        await_meta
        |> Map.put(:provider_call_count, continuation.provider_call_count)
        |> Map.put(:author_narrative, continuation.narrative)
        |> Map.put(:author_narrative_source, continuation.narrative_source)
        |> attach_deviation_meta(deviation, snapshot)

      {:ok, decision, meta}
    end
  end

  defp attach_deviation_meta(meta, nil, _snapshot), do: meta

  defp attach_deviation_meta(meta, deviation, snapshot) do
    reason_codes = AgenticDeviationSignal.reason_codes(deviation)

    meta
    |> Map.update(:reason_codes, reason_codes, fn codes ->
      (string_list(codes) ++ reason_codes) |> Enum.uniq()
    end)
    |> Map.put(
      :stage_state_patch,
      AgenticDeviationSignal.stage_state_patch(deviation, stage_state(snapshot))
    )
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

  defp mechanical_execute_decision(step, run, sequence, snapshot, meta) do
    target = map_get(step, :target_tool_ref)

    with true <- target in [@context_step_target, "prose_writing"],
         {:ok, decision} <-
           AgentNextStepDecision.new(%{
             decision_id:
               "and_#{run.run_id}_#{sequence}_plan_#{map_get(step, :step_id) || sequence}",
             run_ref: run.run_id,
             sequence: sequence,
             decision_type: :execute_step,
             summary: map_get(step, :description) || "执行计划步骤。",
             target_tool_ref: target,
             write_intent: write_intent_for(step, target),
             risk_hint: risk_hint_for(step),
             authoring_intent: map_get(step, :authoring_intent),
             target_chapter: map_get(step, :target_chapter),
             requested_chapter_raw: map_get(step, :requested_chapter_raw),
             target_word_count: map_get(step, :target_word_count),
             reason_codes: plan_step_reason_codes(step, target, meta),
             observation_refs: observation_refs(Map.get(snapshot, :observations, [])),
             evaluation_of_last: meta_evaluation(meta, sequence),
             plan_revision: map_get(meta, :plan_revision),
             confidence: meta_confidence(meta)
           }) do
      {:ok, decision, meta}
    else
      _ -> {:error, {:invalid_plan_step_target, target}}
    end
  end

  defp mechanical_complete_decision(run, sequence) do
    AgentNextStepDecision.new(%{
      decision_id: "and_#{run.run_id}_#{sequence}_plan_goal_satisfied",
      run_ref: run.run_id,
      sequence: sequence,
      decision_type: :goal_satisfied,
      summary: "计划步骤已完成，正文候选已生成并完成质量复核。",
      target_tool_ref: nil,
      write_intent: :none,
      risk_hint: :low,
      reason_codes: ["goal_satisfied", "agent_plan_mechanical_completion"],
      observation_refs: [],
      evaluation_of_last: %{advanced: true, plan_holds: true, new_constraint: nil},
      confidence: 1.0
    })
    |> case do
      {:ok, decision} -> {:ok, decision, %{provider_call_count: 0}}
      error -> error
    end
  end

  defp mechanical_await_author_decision(run, sequence) do
    AgentNextStepDecision.new(%{
      decision_id: "and_#{run.run_id}_#{sequence}_plan_exhausted",
      run_ref: run.run_id,
      sequence: sequence,
      decision_type: :await_author,
      summary: "计划步骤已走完，但正文候选尚未生成，等待作者确认下一步。",
      target_tool_ref: nil,
      write_intent: :none,
      risk_hint: :medium,
      reason_codes: ["plan_exhausted_without_completion"],
      observation_refs: [],
      evaluation_of_last: %{
        advanced: false,
        plan_holds: false,
        new_constraint: "completion_condition_missing"
      },
      confidence: 1.0
    })
    |> case do
      {:ok, decision} -> {:ok, decision, %{provider_call_count: 0}}
      error -> error
    end
  end

  defp write_intent_for(_step, "prose_writing"), do: :tentative
  defp write_intent_for(step, _target), do: map_get(step, :write_intent) || :none

  defp risk_hint_for(step) do
    case map_get(step, :risk_hint) do
      value when value in [:low, :medium, :high] -> value
      "medium" -> :medium
      "high" -> :high
      _ -> :low
    end
  end

  defp completion_ready?(snapshot) do
    snapshot
    |> Map.get(:observations, [])
    |> Enum.any?(fn
      %AgentObservation{observation_type: :artifact_created} -> true
      _ -> false
    end)
  end

  defp observation_refs(observations) when is_list(observations),
    do: Enum.map(observations, & &1.observation_id)

  defp observation_refs(_observations), do: []

  defp replan_available?(run) do
    consumed = budget_value(run.consumed_budget, :replans, 0)
    max = budget_value(run.budget, :max_replans, 0)

    consumed < max
  end

  defp budget_value(map, key, default) when is_map(map) do
    case map_get(map, key) do
      value when is_integer(value) and value >= 0 -> value
      _ -> default
    end
  end

  defp budget_value(_map, _key, default), do: default

  defp meta_reason_codes(meta), do: meta |> map_get(:reason_codes) |> string_list()

  defp plan_step_reason_codes(step, target, meta) do
    (meta_reason_codes(meta) ++
       [
         "agent_plan_mechanical_step",
         "plan_step:#{map_get(step, :step_id) || target}"
       ])
    |> Enum.uniq()
  end

  defp meta_evaluation(meta, sequence) do
    case map_get(meta, :evaluation_of_last) do
      evaluation when is_map(evaluation) ->
        evaluation

      _ ->
        %{advanced: sequence > 1, plan_holds: true, new_constraint: nil}
    end
  end

  defp meta_confidence(meta) do
    case map_get(meta, :confidence) do
      value when is_float(value) and value >= 0.0 and value <= 1.0 -> value
      value when is_integer(value) and value >= 0 and value <= 1 -> value * 1.0
      _ -> 1.0
    end
  end

  defp string_list(values) when is_list(values) do
    values
    |> Enum.map(&to_string/1)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
  end

  defp string_list(_values), do: []

  defp with_plan_cursor({:execute, step_fun, decision}, cursor, meta)
       when is_function(step_fun) do
    {:execute, wrap_plan_step(step_fun, cursor, meta), decision}
  end

  defp with_plan_cursor(result, _cursor, _meta), do: result

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
    stage_patch = map_get(meta, :stage_state_patch) || %{}

    {:ok,
     result
     |> Map.update(:stage_state, Map.merge(stage_patch, %{agent_plan_cursor: cursor + 1}), fn
       stage_state ->
         stage_state
         |> Kernel.||(%{})
         |> Map.merge(stage_patch)
         |> Map.merge(%{agent_plan_cursor: cursor + 1})
     end)
     |> maybe_put_plan_run_patch(meta)}
  end

  defp advance_plan_cursor(result, _cursor, _meta), do: result

  defp maybe_put_plan_run_patch(result, %{agent_plan: plan}) when is_map(plan) do
    patch = %{plan: plan, plan_ref: plan.plan_id, plan_version: plan.version}

    Map.update(result, :run_patch, patch, fn existing ->
      Map.merge(existing || %{}, patch)
    end)
  end

  defp maybe_put_plan_run_patch(result, _meta), do: result

  defp execute_context_decision_step(run, sequence, spec, snapshot) do
    turn_id = "#{run.parent_turn_ref}:agent:#{sequence}"
    context = context_for_run(spec, run, turn_id)

    emit_stage(
      snapshot,
      :goal_understood,
      "已组装正文写作上下文。",
      ["prose_context_assembled"],
      ["context:#{turn_id}"],
      %{
        stage: :prose_context_assembled,
        context_ref_count: context_ref_count(context)
      }
    )

    {:ok,
     %{
       step: context_step(run, sequence),
       observations: [context_observation(run, sequence, context, turn_id)],
       stage_state: %{context: context},
       progress_signature: "#{run.run_id}:prose_context:#{turn_id}"
     }}
  end

  defp execute_tool_decision_step(run, sequence, spec, decision, observations, snapshot) do
    with {:ok, plan} <- plan_from_decision(run, sequence, decision) do
      frame = frame(run, sequence, plan.plan_goal.summary)
      plan = %{plan | turn_id: frame.turn_id, frame_ref: frame.frame_id}
      emit_micro_plan(snapshot, plan)
      {decision_result, _behavior} = ExecutionOrchestrator.decide(frame, plan)
      emit_gate_decision(snapshot, decision_result)

      if decision_result.decision_type == :allow_tool do
        do_execute_tool_step(
          run,
          sequence,
          spec,
          plan,
          decision_result,
          observations,
          snapshot,
          continuation_guidance(decision)
        )
      else
        {:ok,
         deviation_result(
           run,
           sequence,
           "D4",
           "Orchestrator 未允许执行 #{tool_name(plan)}：#{decision_result.decision_type}。",
           "gate:#{decision_result.decision_id}",
           %{
             decision_type: decision_result.decision_type,
             first_blocking_gate: decision_result.first_blocking_gate,
             tool_name: tool_name(plan)
           },
           step: blocked_step(run, sequence, plan, decision_result)
         )}
      end
    end
  end

  # 判断②续行修正指引（CP3b）：continue 决策携带的 guidance 必须传导到执行 brief
  # ——模型的修正指引要到达写作调用，改进稿才真正"按意见修正"。
  defp continuation_guidance(%{reason_codes: codes} = decision) do
    if is_list(codes) and "judgment_continue" in codes do
      case decision.evaluation_of_last do
        %{new_constraint: guidance} when is_binary(guidance) and guidance != "" -> guidance
        _ -> nil
      end
    else
      nil
    end
  end

  defp continuation_guidance(_decision), do: nil

  defp reader_dep(spec, key, fallback), do: Map.get(spec, key) || fallback.()

  defp do_execute_tool_step(
         run,
         sequence,
         spec,
         plan,
         decision,
         observations,
         snapshot,
         guidance
       ) do
    frame = frame(run, sequence, plan.plan_goal.summary)
    execution_context = Map.get(stage_state(snapshot), :context) || Map.get(spec, :context)

    emit_stage(
      snapshot,
      :tool_started,
      "正在调用正文写作能力，随后进行质量复核。",
      ["prose_writing_started"],
      [plan.plan_id, Map.get(decision, :decision_id)],
      %{
        stage: :prose_writing_started,
        tool_name: tool_name(plan),
        plan_ref: plan.plan_id,
        decision_ref: Map.get(decision, :decision_id)
      }
    )

    {turn_result, trace} =
      TurnExecutionService.execute(%{
        frame: frame,
        plan: plan,
        decision: decision,
        candidates: [],
        context: execution_context,
        author_input: %{text: author_input_text(run, plan, observations, guidance)},
        source_turn_ref: run.parent_turn_ref,
        provider_execution: provider_execution(spec, snapshot, :writer),
        quality_provider_execution: quality_provider_execution(spec, snapshot),
        chapter_prose_reader:
          reader_dep(
            spec,
            :chapter_prose_reader,
            &NovelApplication.persistence_chapter_prose_reader/0
          ),
        chapter_summary_reader:
          reader_dep(
            spec,
            :chapter_summary_reader,
            &NovelApplication.persistence_chapter_summary_reader/0
          ),
        character_reader:
          reader_dep(spec, :character_reader, &NovelApplication.persistence_character_reader/0),
        ledger_reader:
          reader_dep(spec, :ledger_reader, &NovelApplication.persistence_ledger_reader/0),
        memory_reader:
          reader_dep(spec, :memory_reader, &NovelApplication.persistence_memory_reader/0)
      })

    tool_result = Map.get(turn_result, :tool_result) || %{}

    case tool_step_outcome(turn_result, tool_result) do
      :tool_failed ->
        {:ok, tool_failure_deviation(run, sequence, plan, turn_result, tool_result)}

      :deterministic_gap ->
        {:ok, deterministic_gap_deviation(run, sequence, plan, turn_result)}

      :completed ->
        {:ok,
         completed_tool_step(
           run,
           sequence,
           %{
             frame: frame,
             plan: plan,
             turn_result: turn_result,
             tool_result: tool_result,
             trace: trace,
             context: execution_context,
             spec: spec,
             snapshot: snapshot
           }
         )}
    end
  end

  defp tool_step_outcome(turn_result, tool_result) do
    cond do
      Map.get(tool_result, :status) == :failed -> :tool_failed
      deterministic_gap_turn_result?(turn_result) -> :deterministic_gap
      true -> :completed
    end
  end

  defp tool_failure_deviation(run, sequence, plan, turn_result, tool_result) do
    deviation_result(
      run,
      sequence,
      "D1",
      "工具 #{tool_name(plan)} 执行失败，先修订计划再决定后续动作。",
      "tool_result:#{Map.get(tool_result, :tool_result_id) || current_step_ref(run, sequence)}",
      %{
        tool_name: tool_name(plan),
        tool_result_ref: Map.get(tool_result, :tool_result_id),
        errors: Map.get(tool_result, :errors, [])
      },
      step: failed_execution_step(run, sequence, plan, turn_result),
      tool_call_count: 1,
      provider_call_count: provider_call_count(turn_result)
    )
  end

  defp deterministic_gap_deviation(run, sequence, plan, turn_result) do
    deviation_result(
      run,
      sequence,
      "D7",
      "写作坐标存在确定性缺口，当前步骤无法继续生成正文。",
      "turn_result:#{Map.get(turn_result, :turn_id) || current_step_ref(run, sequence)}",
      %{deterministic_gap: true, missing_policy: true, tool_name: tool_name(plan)},
      step: skipped_execution_step(run, sequence, plan, turn_result),
      provider_call_count: 0
    )
  end

  defp completed_tool_step(run, sequence, %{
         frame: frame,
         plan: plan,
         turn_result: turn_result,
         tool_result: tool_result,
         trace: trace,
         context: context,
         spec: spec,
         snapshot: snapshot
       }) do
    emit_stage(
      snapshot,
      :tool_completed,
      "正文草稿已生成，质量复核已完成。",
      ["prose_writing_completed", "quality_review_completed"],
      tool_and_quality_refs(turn_result),
      %{
        stage: :prose_quality_completed,
        tool_name: Map.get(tool_result, :tool_name),
        tool_result_ref: Map.get(tool_result, :tool_result_id),
        review_status: quality_review_status(turn_result),
        finding_count: quality_finding_count(turn_result)
      }
    )

    turn_result = finalize(turn_result, run, turn_result_run_status(turn_result))
    persist_completed_turn(run, turn_result, trace, context, spec)
    step_id = current_step_ref(run, sequence)

    %{
      step: execution_step(run, sequence, plan, turn_result),
      observations:
        [quality_observation(run, sequence, frame, turn_result)] ++
          AgentObservationAssembler.from_turn_result(turn_result, %{
            run_id: run.run_id,
            step_id: step_id
          }),
      artifact_refs: artifact_refs(turn_result),
      turn_result: turn_result,
      tool_call_count: 1,
      provider_call_count: provider_call_count(turn_result),
      progress_signature: progress_signature(turn_result)
    }
  end

  defp persist_completed_turn(run, turn_result, trace, context, spec) do
    # DS03：steer 后（goal.version > 1）goal.text 即作者补充文本，且该补充已由
    # persist_author_steer 独立落库——完成时再写 user entry 会在 transcript 重复。
    DialogueGateway.persist_turn_side_effects(
      {:ok, turn_result, trace, [], context},
      run.workspace_id,
      run.session_id,
      run.goal.text,
      Map.get(spec, :trace_persister),
      Map.get(spec, :memory_recorder),
      %{suppress_user_entry: run.goal.version > 1}
    )
  end

  defp deterministic_gap_turn_result?(turn_result) when is_map(turn_result) do
    text = get_in(turn_result, [:assistant_message, :text])
    tool_called = get_in(turn_result, [:truthfulness, :tool_called])

    is_binary(text) and String.contains?(text, "没有找到") and tool_called != true
  end

  defp deterministic_gap_turn_result?(_turn_result), do: false

  defp deviation_result(run, sequence, signal, summary, source_ref, payload, opts) do
    step = Keyword.fetch!(opts, :step)
    tool_call_count = Keyword.get(opts, :tool_call_count, 0)
    provider_call_count = Keyword.get(opts, :provider_call_count, 0)

    %{
      step: step,
      observations: [
        deviation_observation(run, sequence, signal, summary, source_ref, payload)
      ],
      stage_state: %{
        agentic_deviation: %{
          signal: signal,
          ref: source_ref,
          summary: summary,
          source: source_ref,
          payload: payload
        }
      },
      tool_call_count: tool_call_count,
      provider_call_count: provider_call_count,
      progress_signature: "#{run.run_id}:deviation:#{signal}:#{source_ref}"
    }
  end

  defp deviation_observation(run, sequence, signal, summary, source_ref, payload) do
    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: "obs_#{run.run_id}_#{sequence}_deviation_#{String.downcase(signal)}",
        run_ref: run.run_id,
        step_ref: current_step_ref(run, sequence),
        observation_type: :custom,
        source_ref: source_ref,
        summary: summary,
        structured_payload:
          Map.merge(payload || %{}, %{
            agentic_deviation_signal: signal,
            deterministic_gap: signal == "D7"
          }),
        evidence_refs: [source_ref]
      })

    observation
  end

  defp blocked_step(run, sequence, plan, decision_result) do
    {:ok, step} =
      AgentStep.new(%{
        step_id: current_step_ref(run, sequence),
        run_ref: run.run_id,
        sequence: sequence,
        status: :skipped,
        goal: "系统裁决未允许执行 #{tool_name(plan)}",
        micro_plan_ref: plan.plan_id,
        decision_ref: Map.get(decision_result, :decision_id),
        observation_refs: [],
        state_snapshot_ref: state_snapshot_ref(run, sequence, "gate_blocked"),
        idempotency_key: "#{run.run_id}:#{sequence}:gate_blocked:goal_v#{run.goal.version}"
      })

    step
  end

  defp failed_execution_step(run, sequence, plan, turn_result) do
    step = execution_step(run, sequence, plan, turn_result)
    %{step | status: :failed, failure_ref: "tool_failed"}
  end

  defp skipped_execution_step(run, sequence, plan, turn_result) do
    step = execution_step(run, sequence, plan, turn_result)
    %{step | status: :skipped, failure_ref: "deterministic_gap"}
  end

  defp provider_execution(spec, snapshot, purpose) do
    (Map.get(spec, :provider_execution) ||
       Execution.dependency(purpose: :writer))
    |> ProviderActivityProjector.with_stage_sink(snapshot, purpose: purpose)
  end

  defp quality_provider_execution(spec, snapshot) do
    (Map.get(spec, :quality_provider_execution) ||
       Execution.dependency(purpose: :evaluator))
    |> ProviderActivityProjector.with_stage_sink(snapshot, purpose: :evaluator)
  end

  defp planner_provider_execution(spec) do
    Map.get(spec, :planner_provider_execution) ||
      Map.get(spec, :provider_execution) ||
      Execution.dependency(purpose: :planner)
  end

  defp context_for_run(%{context: %DialogueContext{} = context}, _run, _turn_id), do: context

  defp context_for_run(spec, run, turn_id) do
    fetcher = Map.get(spec, :context_fetcher) || fn _ -> {:ok, nil, nil, nil, nil} end

    LogContext.put_turn(run.workspace_id, run.work_id, turn_id, run.session_id)

    ContextAssembler.assemble_for_input(
      run.workspace_id,
      run.goal.text,
      fetcher,
      session_id: run.session_id,
      assembly_policy: NovelApplication.current_assembly_policy()
    )
  end

  defp author_input_text(run, plan, observations, guidance) do
    observation_text =
      observations
      |> Enum.map(& &1.summary)
      |> Enum.reject(&blank?/1)
      |> Enum.join("\n")

    [
      run.goal.text,
      "当前 AgentStep：#{plan.plan_goal.summary}",
      observation_section(observation_text),
      guidance_section(guidance)
    ]
    |> Enum.reject(&blank?/1)
    |> Enum.join("\n\n")
  end

  defp guidance_section(guidance) when is_binary(guidance) and guidance != "",
    do: "续行修正指引：\n#{guidance}"

  defp guidance_section(_guidance), do: nil

  defp observation_section(""), do: nil
  defp observation_section(text), do: "已完成观察：\n#{text}"

  defp frame(run, sequence, summary) do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame_#{run.run_id}_#{sequence}",
      turn_id: "#{run.parent_turn_ref}:agent:#{sequence}",
      workspace_id: run.work_id,
      primary: false,
      frame_type: :execution_candidate,
      source_refs: %{
        author_input_ref: run.parent_turn_ref,
        agent_run_ref: run.run_id
      },
      dialogue_goal: %{summary: summary},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: summary},
      evidence_summary: %{agent_run_ref: run.run_id},
      uncertainty: []
    }
  end

  defp context_step(run, sequence) do
    {:ok, step} =
      AgentStep.new(%{
        step_id: current_step_ref(run, sequence),
        run_ref: run.run_id,
        sequence: sequence,
        status: :completed,
        goal: "组装正文写作上下文",
        observation_refs: [context_observation_id(run, sequence)],
        state_snapshot_ref: state_snapshot_ref(run, sequence, "prose_context"),
        idempotency_key: "#{run.run_id}:#{sequence}:prose_context:goal_v#{run.goal.version}"
      })

    step
  end

  defp execution_step(run, sequence, plan, turn_result) do
    action = hd(plan.proposed_actions)
    step_tool_name = action[:target_ref]
    trace_summary = Map.get(turn_result, :trace_summary) || %{}
    tool_result = Map.get(turn_result, :tool_result) || %{}

    {:ok, step} =
      AgentStep.new(%{
        step_id: current_step_ref(run, sequence),
        run_ref: run.run_id,
        sequence: sequence,
        status: :completed,
        goal: action[:summary],
        micro_plan_ref: Map.get(trace_summary, :plan_ref) || plan.plan_id,
        decision_ref: Map.get(trace_summary, :decision_ref),
        tool_request_ref: Map.get(trace_summary, :tool_request_id),
        tool_result_ref:
          Map.get(trace_summary, :tool_result_id) || Map.get(tool_result, :tool_result_id),
        observation_refs: [quality_observation_id(run, sequence)],
        state_snapshot_ref: state_snapshot_ref(run, sequence, step_tool_name),
        idempotency_key: "#{run.run_id}:#{sequence}:#{step_tool_name}:goal_v#{run.goal.version}"
      })

    step
  end

  defp context_observation(run, sequence, %DialogueContext{} = context, turn_id) do
    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: context_observation_id(run, sequence),
        run_ref: run.run_id,
        step_ref: current_step_ref(run, sequence),
        observation_type: :custom,
        source_ref: "context:#{turn_id}",
        summary: "已组装正文写作上下文，可用于后续正文策略与执行。",
        structured_payload: %{
          current_chapter_count: length(context.current_chapters || []),
          structured_chapter_count: length(context.structured_chapters || []),
          context_ref_count: length(context.context_refs || [])
        },
        evidence_refs: ["context:#{turn_id}"]
      })

    observation
  end

  defp quality_observation(run, sequence, frame, turn_result) do
    status = quality_review_status(turn_result)
    finding_count = quality_finding_count(turn_result)

    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: quality_observation_id(run, sequence),
        run_ref: run.run_id,
        step_ref: current_step_ref(run, sequence),
        observation_type: :quality_review,
        source_ref: "turn_result:#{frame.turn_id}",
        summary: quality_summary(status, finding_count),
        structured_payload: %{
          review_status: status,
          finding_count: finding_count,
          policy_action: quality_policy_action(turn_result)
        },
        evidence_refs: ["turn:#{frame.turn_id}" | tool_and_quality_refs(turn_result)]
      })

    observation
  end

  defp state_snapshot_ref(run, sequence, tool_name) do
    [
      "agent_snapshot",
      run.work_id,
      run.session_id,
      run.run_id,
      "step",
      sequence,
      tool_name,
      "goal_v#{run.goal.version}"
    ]
    |> Enum.map_join(":", &to_string/1)
  end

  defp finalize(turn_result, run, status) do
    AgentFinalizer.attach_run_summary(turn_result, %{
      run_id: run.run_id,
      run_mode: run.run_mode,
      parent_turn_ref: run.parent_turn_ref,
      profile_ref: run.profile_ref,
      status: status
    })
  end

  defp turn_result_run_status(turn_result) do
    case quality_policy_action(turn_result) do
      action when action in [:confirm, :block, "confirm", "block"] -> :awaiting_author
      _action -> :completed
    end
  end

  defp provider_call_count(turn_result) do
    count =
      turn_result
      |> get_in([:trace_summary, :provider_call_budget])
      |> case do
        budget when is_map(budget) ->
          [:writer, :evaluator, :revision_writer]
          |> Enum.map(&budget_value(budget, &1))
          |> Enum.sum()

        _ ->
          0
      end

    if count > 0, do: count, else: 1
  end

  defp budget_value(budget, key) do
    case Map.get(budget, key) || Map.get(budget, Atom.to_string(key)) do
      value when is_integer(value) and value > 0 -> value
      _ -> 0
    end
  end

  defp artifact_refs(turn_result) do
    turn_result
    |> Map.get(:adoption_state, %{})
    |> Map.get(:pending, [])
    |> Enum.map(&(Map.get(&1, :artifact_id) || Map.get(&1, "artifact_id")))
    |> Enum.reject(&blank?/1)
  end

  defp current_step_ref(run, sequence),
    do: run.current_step_ref || "step_#{run.run_id}_#{sequence}"

  defp quality_observation_id(run, sequence), do: "obs_#{run.run_id}_#{sequence}_quality"

  defp context_observation_id(run, sequence), do: "obs_#{run.run_id}_#{sequence}_prose_context"

  defp tool_name(plan), do: plan.proposed_actions |> hd() |> Map.fetch!(:target_ref)

  defp next_step_from_decision(
         %AgentNextStepDecision{
           decision_type: :execute_step,
           target_tool_ref: @context_step_target
         } = decision,
         spec
       ) do
    {:execute,
     fn run, sequence, snapshot ->
       execute_context_decision_step(run, sequence, spec, snapshot)
     end, decision}
  end

  defp next_step_from_decision(
         %AgentNextStepDecision{decision_type: :execute_step} = decision,
         spec
       ) do
    {:execute,
     fn run, sequence, snapshot ->
       execute_tool_decision_step(
         run,
         sequence,
         spec,
         decision,
         Map.get(snapshot, :observations, []),
         snapshot
       )
     end, decision}
  end

  defp next_step_from_decision(
         %AgentNextStepDecision{decision_type: :goal_satisfied} = decision,
         _spec
       ),
       do: {:complete, decision}

  defp next_step_from_decision(
         %AgentNextStepDecision{decision_type: :await_author} = decision,
         _spec
       ),
       do: {:await_author, decision}

  defp next_step_from_decision(
         %AgentNextStepDecision{decision_type: :no_progress} = decision,
         _spec
       ),
       do: {:await_author, decision}

  defp plan_from_decision(run, sequence, %AgentNextStepDecision{} = decision) do
    tool_name = decision.target_tool_ref

    if AgentTaskProfileRegistry.allowed_tool?(run.profile_ref, tool_name) do
      {:ok,
       %MicroPlan{
         plan_id: "mp_#{run.run_id}_#{sequence}",
         turn_id: run.parent_turn_ref,
         frame_ref: run.origin_frame_ref,
         plan_goal: %{summary: decision.summary},
         risk_hint: decision.risk_hint,
         proposed_actions: [
           %{
             action_id: "act_#{run.run_id}_#{sequence}_#{tool_name}",
             action_type: :capability_invocation,
             summary: decision.summary,
             target_ref: tool_name,
             write_intent: decision.write_intent,
             risk_hint: decision.risk_hint,
             # 写作坐标（VS-00C）：意图由 step planner AI 判定，随 action 进入
             # TurnExecutionService 的续写前文注入、missing policy 与采纳 append 分流。
             authoring_intent: decision.authoring_intent,
             target_chapter: decision.target_chapter,
             requested_chapter_raw: decision.requested_chapter_raw,
             target_word_count: decision.target_word_count
           }
         ],
         required_capabilities: [tool_name]
       }}
    else
      {:error, {:tool_not_allowed_by_profile, tool_name}}
    end
  end

  defp emit_micro_plan(_snapshot, _plan), do: :ok

  defp emit_gate_decision(snapshot, decision) do
    emit_stage(
      snapshot,
      :gate_decided,
      "系统已完成下一步执行裁决。",
      ["agent_step_regated"],
      [decision.decision_id],
      %{
        stage: :orchestrator_decided,
        decision_ref: decision.decision_id,
        decision_type: decision.decision_type,
        first_blocking_gate: decision.first_blocking_gate
      }
    )
  end

  defp context_ref_count(%DialogueContext{} = context) do
    length(context.current_chapters || []) +
      length(context.structured_chapters || []) +
      length(context.context_refs || [])
  end

  defp context_ref_count(_context), do: 0

  defp progress_signature(turn_result) do
    tool_result = Map.get(turn_result, :tool_result) || %{}
    output = Map.get(tool_result, :output) || Map.get(tool_result, "output") || %{}
    quality = Map.get(turn_result, :quality_review) || %{}

    [
      Map.get(tool_result, :tool_name),
      stable_signature(output),
      stable_signature(quality),
      artifact_refs(turn_result) |> Enum.join(",")
    ]
    |> Enum.reject(&blank?/1)
    |> Enum.join(":")
  end

  defp tool_and_quality_refs(turn_result) do
    tool_result = Map.get(turn_result, :tool_result) || %{}
    trace_summary = Map.get(turn_result, :trace_summary) || %{}

    [
      ref("tool_result", Map.get(tool_result, :tool_result_id)),
      ref("quality_review", quality_review_status(turn_result)),
      ref("writer_provider_call", Map.get(trace_summary, :writer_provider_call_ref)),
      ref("evaluator_provider_call", Map.get(trace_summary, :evaluator_provider_call_ref))
    ]
    |> Enum.reject(&blank?/1)
  end

  defp quality_review_status(turn_result) do
    turn_result
    |> Map.get(:quality_review, %{})
    |> map_get(:review_status)
    |> case do
      status when is_binary(status) and status != "" -> status
      _ -> "unknown"
    end
  end

  defp quality_policy_action(turn_result) do
    turn_result
    |> Map.get(:quality_review, %{})
    |> map_get(:policy_action)
  end

  defp quality_finding_count(turn_result) do
    turn_result
    |> Map.get(:quality_review, %{})
    |> map_get(:findings)
    |> case do
      findings when is_list(findings) -> length(findings)
      _ -> 0
    end
  end

  defp quality_summary("completed", 0), do: "质量复核已完成，暂未记录需关注问题。"

  defp quality_summary("completed", count), do: "质量复核已完成，记录 #{count} 项需关注问题。"

  defp quality_summary(status, count), do: "质量复核状态为 #{status}，记录 #{count} 项需关注问题。"

  defp stage_state(snapshot), do: Map.get(snapshot, :stage_state, %{})

  defp emit_stage(%{stage_sink: stage_sink}, event_type, summary, reason_codes, refs, payload)
       when is_function(stage_sink, 1) do
    stage_sink.(%{
      event_type: event_type,
      summary: summary,
      reason_codes: reason_codes,
      refs: refs,
      payload: payload
    })

    :ok
  end

  defp emit_stage(_snapshot, _event_type, _summary, _reason_codes, _refs, _payload), do: :ok

  defp ref(_prefix, nil), do: nil
  defp ref(_prefix, ""), do: nil
  defp ref(prefix, value), do: "#{prefix}:#{value}"

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_get(_map, _key), do: nil

  defp stable_signature(value) do
    :crypto.hash(:sha256, :erlang.term_to_binary(value))
    |> Base.encode16(case: :lower)
  end

  defp blank?(value), do: not is_binary(value) or String.trim(value) == ""
end
