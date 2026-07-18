defmodule NovelApplication.AgentRunFlows.ProseRevisionFromFindings do
  @moduledoc """
  Bounded AgentRun flow for `revise_from_findings` author actions.
  """

  alias NovelApplication.ActionValidator
  alias NovelApplication.AgentFinalizer
  alias NovelApplication.AgenticNextStepPlanner
  alias NovelApplication.AgentObservationAssembler
  alias NovelApplication.ProseRevisionService
  alias NovelApplication.ProviderActivityProjector
  alias NovelDomain.AgentNextStepDecision
  alias NovelDomain.AgentObservation
  alias NovelDomain.AgentStep
  alias NovelDomain.AuthorActionInput

  @profile_ref "prose_revision_from_findings_v1"
  @prepare_step_target "revision_prepare"
  @plan_step_target "revision_plan"
  @finalize_step_target "revision_finalize"
  @prose_step_target "prose_writing"

  @spec profile_ref() :: String.t()
  def profile_ref, do: @profile_ref

  @spec steps(map()) :: no_return()
  def steps(_spec) do
    raise ArgumentError, "prose_revision_from_findings_v1 requires next_step_planner/1"
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

  # CP3b 尾批（ADR-0025 判断纪元）：修订 flow 的四步序列恒定（读草稿与发现 →
  # 修订策略与裁决 → 生成修订候选 → 汇总确认），符合机械准备判据——原"模型起草
  # 计划"是付费伪计划，改机械构造（0 调用、不发 plan_drafted）。
  defp plan_for_run(run, _snapshot, _spec) do
    if mechanical_plan_ready?(run.plan) do
      {:ok, run.plan, %{provider_call_count: 0, suppress_plan_event: true}}
    else
      plan = mechanical_plan(run)
      {:ok, plan, %{provider_call_count: 0, suppress_plan_event: true, agent_plan: plan}}
    end
  end

  defp mechanical_plan(run) do
    %{
      plan_id: "ap_#{run.run_id}",
      run_ref: run.run_id,
      version: 1,
      goal_version: 1,
      steps: [
        %{
          step_id: "mech_revision_prepare",
          target_tool_ref: @prepare_step_target,
          description: "读取待修订草稿和质量发现。",
          write_intent: :none
        },
        %{
          step_id: "mech_revision_plan",
          target_tool_ref: @plan_step_target,
          description: "制定修订执行策略并重新经过系统裁决。",
          write_intent: :none
        },
        %{
          step_id: "mech_revision_prose",
          target_tool_ref: @prose_step_target,
          description: "基于修订计划生成正文修订候选。",
          write_intent: :tentative
        },
        %{
          step_id: "mech_revision_finalize",
          target_tool_ref: @finalize_step_target,
          description: "汇总修订候选给作者确认。",
          write_intent: :none
        }
      ]
    }
  end

  defp mechanical_plan_ready?(plan) when is_map(plan) do
    case Map.get(plan, :steps) || Map.get(plan, "steps") do
      [_ | _] = steps ->
        Enum.all?(steps, &(not blank?(map_get(&1, :target_tool_ref))))

      _ ->
        false
    end
  end

  defp mechanical_plan_ready?(_plan), do: false

  defp mechanical_decision(run, sequence, snapshot, meta, spec) do
    steps = plan_steps(run.plan)
    index = plan_cursor(snapshot)
    meta = Map.put(meta, :agent_plan_cursor, index)

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
  end

  # 机械计划耗尽而修订候选未出：无模型计划可修订（伪计划已消灭），诚实停等作者。
  defp maybe_replan_exhausted_plan(run, sequence, _snapshot, _spec) do
    mechanical_await_author_decision(run, sequence)
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

    with true <- target in allowed_plan_targets(),
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
             risk_hint: :low,
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

  defp allowed_plan_targets,
    do: [@prepare_step_target, @plan_step_target, @prose_step_target, @finalize_step_target]

  defp mechanical_complete_decision(run, sequence) do
    AgentNextStepDecision.new(%{
      decision_id: "and_#{run.run_id}_#{sequence}_plan_goal_satisfied",
      run_ref: run.run_id,
      sequence: sequence,
      decision_type: :goal_satisfied,
      summary: "计划步骤已完成，修订候选已生成。",
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
      summary: "计划步骤已走完，但修订候选尚未生成，等待作者确认下一步。",
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

  defp write_intent_for(_step, @prose_step_target), do: :tentative
  defp write_intent_for(step, _target), do: map_get(step, :write_intent) || :none

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
      value when is_float(value) -> value
      value when is_integer(value) -> value / 1
      _ -> 1.0
    end
  end

  defp string_list(values) when is_list(values),
    do: values |> Enum.map(&to_string/1) |> Enum.reject(&blank?/1)

  defp string_list(_values), do: []

  defp prepare_step_fun(spec) do
    fn run, sequence, snapshot ->
      source_turn_result = Map.get(spec, :source_turn_result)
      action_input = Map.get(spec, :action_input)

      with %AuthorActionInput{} <- action_input,
           source when is_map(source) <- source_turn_result,
           :ok <- ActionValidator.validate(action_input, source),
           {:ok, prepared} <- ProseRevisionService.prepare_revision(source, action_input) do
        emit_stage(
          snapshot,
          :goal_understood,
          "已读取待修订草稿和质量发现。",
          ["revision_source_loaded"],
          [action_input.target_ref],
          %{
            stage: :revision_source_loaded,
            target_ref: action_input.target_ref,
            finding_count: length(Map.get(prepared, :findings, []))
          }
        )

        {:ok,
         %{
           step: prepare_step(run, sequence, action_input, prepared),
           observations: [prepare_observation(run, sequence, action_input, prepared)],
           stage_state: %{
             revision_source_turn_result: source,
             revision_action_input: action_input,
             revision_prepared: prepared
           },
           progress_signature:
             "#{run.run_id}:revision_prepare:#{action_input.target_ref}:#{finding_refs(prepared)}"
         }}
      else
        {:error, reason} -> {:error, {:revision_prepare_failed, reason}}
        other -> {:error, {:invalid_revision_agent_run_input, other}}
      end
    end
  end

  defp plan_step_fun(_spec) do
    fn run, sequence, snapshot ->
      state = stage_state(snapshot)

      with source when is_map(source) <- Map.get(state, :revision_source_turn_result),
           %AuthorActionInput{} = action_input <- Map.get(state, :revision_action_input),
           prepared when is_map(prepared) <- Map.get(state, :revision_prepared),
           {:ok, execution} <- ProseRevisionService.plan_revision(source, action_input) do
        plan = execution.plan
        decision = execution.decision

        emit_stage(
          snapshot,
          :gate_decided,
          "已通过修订工具执行授权：#{decision.decision_type}。",
          ["revision_orchestrator_decision_recorded"],
          [decision.decision_id],
          %{
            stage: :revision_orchestrator_decision_recorded,
            decision_ref: decision.decision_id,
            decision_type: decision.decision_type,
            first_blocking_gate: decision.first_blocking_gate
          }
        )

        {:ok,
         %{
           step: plan_step(run, sequence, prepared, execution),
           observations: [plan_observation(run, sequence, execution)],
           stage_state: %{revision_execution: execution},
           progress_signature:
             "#{run.run_id}:revision_plan:#{plan.plan_id}:#{decision.decision_id}"
         }}
      else
        {:error, reason} -> {:error, {:revision_plan_failed, reason}}
        other -> {:error, {:missing_revision_prepare_stage_state, other}}
      end
    end
  end

  defp execute_step_fun(spec) do
    fn run, sequence, snapshot ->
      state = stage_state(snapshot)

      with source when is_map(source) <- Map.get(state, :revision_source_turn_result),
           %AuthorActionInput{} = action_input <- Map.get(state, :revision_action_input),
           prepared when is_map(prepared) <- Map.get(state, :revision_prepared),
           execution when is_map(execution) <- Map.get(state, :revision_execution) do
        emit_stage(
          snapshot,
          :tool_started,
          "正在调用正文写作能力生成修订候选。",
          ["revision_prose_writing_started"],
          [execution.plan.plan_id, execution.decision.decision_id],
          %{
            stage: :revision_prose_writing_started,
            tool_name: "prose_writing",
            plan_ref: execution.plan.plan_id,
            decision_ref: execution.decision.decision_id
          }
        )

        execute_revision_step(
          run,
          sequence,
          source,
          action_input,
          prepared,
          execution,
          spec,
          snapshot
        )
      else
        other -> {:error, {:missing_revision_execution_stage_state, other}}
      end
    end
  end

  defp finalization_step_fun do
    fn run, sequence, snapshot ->
      state = stage_state(snapshot)

      case Map.get(state, :revision_result) do
        result when is_map(result) ->
          final_turn_result = finalize(result.turn_result, run)
          step_id = current_step_ref(run, sequence)
          artifact_refs = artifact_refs(final_turn_result)

          observations =
            final_turn_result
            |> AgentObservationAssembler.from_turn_result(%{
              run_id: run.run_id,
              step_id: step_id
            })
            |> ensure_revision_final_observation(run, sequence, artifact_refs)

          {:ok,
           %{
             step: final_step(run, sequence, final_turn_result, observations),
             observations: observations,
             artifact_refs: artifact_refs,
             turn_result: final_turn_result,
             progress_signature:
               "#{run.run_id}:revision_finalize:#{Enum.join(artifact_refs, ",")}"
           }}

        _missing ->
          {:error, {:missing_revision_result_stage_state, Map.keys(state)}}
      end
    end
  end

  defp provider_execution(spec),
    do: Map.get(spec, :provider_execution)

  defp provider_execution(spec, snapshot) do
    spec
    |> provider_execution()
    |> ProviderActivityProjector.with_stage_sink(snapshot, purpose: :revision)
  end

  defp execute_revision_step(
         run,
         sequence,
         source,
         action_input,
         prepared,
         execution,
         spec,
         snapshot
       ) do
    case ProseRevisionService.execute_revision(
           source,
           action_input,
           prepared,
           execution,
           provider_execution(spec, snapshot)
         ) do
      {:ok, result} ->
        emit_stage(
          snapshot,
          :tool_completed,
          "修订候选已生成，等待作者采纳或放弃。",
          ["revision_prose_writing_completed"],
          revision_refs(result),
          %{
            stage: :revision_prose_writing_completed,
            tool_name: "prose_writing",
            tool_result_ref: tool_result_ref(result),
            revision_artifact_ref: result.artifact_set.artifact_set_id
          }
        )

        {:ok,
         %{
           step: execute_step(run, sequence, result),
           observations: [execute_observation(run, sequence, result)],
           stage_state: %{revision_result: result},
           tool_call_count: 1,
           provider_call_count: 1,
           progress_signature:
             "#{run.run_id}:revision_execute:#{result.artifact_set.artifact_set_id}:#{tool_result_ref(result)}"
         }}

      {:error, reason} ->
        {:error, {:revision_execute_failed, reason}}
    end
  end

  defp prepare_step(run, sequence, %AuthorActionInput{} = action_input, prepared) do
    {:ok, step} =
      AgentStep.new(%{
        step_id: current_step_ref(run, sequence),
        run_ref: run.run_id,
        sequence: sequence,
        status: :completed,
        goal: "读取待修订草稿和质量发现",
        observation_refs: [prepare_observation_id(run, sequence)],
        state_snapshot_ref: state_snapshot_ref(run, sequence, "revision_prepare"),
        idempotency_key:
          "#{run.run_id}:#{sequence}:revision_prepare:#{action_input.target_ref}:#{finding_refs(prepared)}"
      })

    step
  end

  defp plan_step(run, sequence, prepared, execution) do
    {:ok, step} =
      AgentStep.new(%{
        step_id: current_step_ref(run, sequence),
        run_ref: run.run_id,
        sequence: sequence,
        status: :completed,
        goal: "制定修订执行策略并完成授权判断",
        micro_plan_ref: execution.plan.plan_id,
        decision_ref: execution.decision.decision_id,
        observation_refs: [plan_observation_id(run, sequence)],
        state_snapshot_ref: state_snapshot_ref(run, sequence, "revision_plan"),
        idempotency_key:
          "#{run.run_id}:#{sequence}:revision_plan:#{execution.plan.plan_id}:#{finding_refs(prepared)}"
      })

    step
  end

  defp execute_step(run, sequence, result) do
    execution = result.execution

    {:ok, step} =
      AgentStep.new(%{
        step_id: current_step_ref(run, sequence),
        run_ref: run.run_id,
        sequence: sequence,
        status: :completed,
        goal: "生成一个 tentative 修订草稿",
        micro_plan_ref: execution.plan.plan_id,
        decision_ref: execution.decision.decision_id,
        tool_request_ref: execution.req.tool_request_id,
        tool_result_ref: tool_result_ref(result),
        observation_refs: [execute_observation_id(run, sequence)],
        state_snapshot_ref: state_snapshot_ref(run, sequence, "revision_execute"),
        idempotency_key:
          "#{run.run_id}:#{sequence}:revision_execute:#{execution.req.tool_request_id}:#{tool_result_ref(result)}"
      })

    step
  end

  defp final_step(run, sequence, turn_result, observations) do
    trace_summary = Map.get(turn_result, :trace_summary) || %{}

    {:ok, step} =
      AgentStep.new(%{
        step_id: current_step_ref(run, sequence),
        run_ref: run.run_id,
        sequence: sequence,
        status: :completed,
        goal: "汇总修订候选给作者",
        micro_plan_ref: Map.get(trace_summary, :plan_ref),
        decision_ref: Map.get(trace_summary, :decision_ref),
        tool_request_ref: Map.get(trace_summary, :tool_request_id),
        tool_result_ref: Map.get(trace_summary, :tool_result_id),
        observation_refs: Enum.map(observations, & &1.observation_id),
        state_snapshot_ref: state_snapshot_ref(run, sequence, "revision_finalize"),
        idempotency_key: "#{run.run_id}:#{sequence}:revision_finalize:goal_v#{run.goal.version}"
      })

    step
  end

  defp prepare_observation(run, sequence, %AuthorActionInput{} = action_input, prepared) do
    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: prepare_observation_id(run, sequence),
        run_ref: run.run_id,
        step_ref: current_step_ref(run, sequence),
        observation_type: :custom,
        source_ref: "turn:#{action_input.source_turn_ref}",
        summary: "已读取待修订草稿，选中 #{length(Map.get(prepared, :findings, []))} 项质量发现。",
        structured_payload: %{
          target_ref: action_input.target_ref,
          quality_finding_refs: finding_ref_list(prepared)
        },
        evidence_refs: [
          "turn:#{action_input.source_turn_ref}",
          "artifact:#{action_input.target_ref}"
        ]
      })

    observation
  end

  defp plan_observation(run, sequence, execution) do
    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: plan_observation_id(run, sequence),
        run_ref: run.run_id,
        step_ref: current_step_ref(run, sequence),
        observation_type: :custom,
        source_ref: "decision:#{execution.decision.decision_id}",
        summary: "修订动作已重新经过 Orchestrator，并允许调用 prose_writing。",
        structured_payload: %{
          plan_ref: execution.plan.plan_id,
          decision_ref: execution.decision.decision_id,
          decision_type: execution.decision.decision_type
        },
        evidence_refs: [
          "plan:#{execution.plan.plan_id}",
          "decision:#{execution.decision.decision_id}"
        ]
      })

    observation
  end

  defp execute_observation(run, sequence, result) do
    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: execute_observation_id(run, sequence),
        run_ref: run.run_id,
        step_ref: current_step_ref(run, sequence),
        observation_type: :tool_fact,
        source_ref: "tool_result:#{tool_result_ref(result)}",
        summary: "已生成新的修订候选，不自动采纳。",
        structured_payload: %{
          revision_artifact_ref: result.artifact_set.artifact_set_id,
          revision_base: result.artifact_set.revision_base,
          quality_finding_refs: result.artifact_set.quality_finding_refs
        },
        evidence_refs: revision_refs(result)
      })

    observation
  end

  defp ensure_revision_final_observation(observations, _run, _sequence, []), do: observations

  defp ensure_revision_final_observation(observations, run, sequence, artifact_refs) do
    if Enum.any?(observations, &(&1.observation_type == :artifact_created)) do
      observations
    else
      observations ++ [revision_final_observation(run, sequence, artifact_refs)]
    end
  end

  defp revision_final_observation(run, sequence, artifact_refs) do
    refs = Enum.map(artifact_refs, &"artifact:#{&1}")

    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: final_observation_id(run, sequence),
        run_ref: run.run_id,
        step_ref: current_step_ref(run, sequence),
        observation_type: :artifact_created,
        source_ref: List.first(refs),
        summary: "修订候选已汇总给作者，已有 #{length(artifact_refs)} 个待采纳正文草稿。",
        structured_payload: %{
          artifact_refs: artifact_refs,
          revision_finalized: true
        },
        evidence_refs: refs
      })

    observation
  end

  defp next_step_from_decision(
         %AgentNextStepDecision{
           decision_type: :execute_step,
           target_tool_ref: @prepare_step_target
         } = decision,
         spec
       ),
       do: {:execute, prepare_step_fun(spec), decision}

  defp next_step_from_decision(
         %AgentNextStepDecision{
           decision_type: :execute_step,
           target_tool_ref: @plan_step_target
         } = decision,
         spec
       ),
       do: {:execute, plan_step_fun(spec), decision}

  defp next_step_from_decision(
         %AgentNextStepDecision{
           decision_type: :execute_step,
           target_tool_ref: "prose_writing"
         } = decision,
         spec
       ),
       do: {:execute, execute_step_fun(spec), decision}

  defp next_step_from_decision(
         %AgentNextStepDecision{
           decision_type: :execute_step,
           target_tool_ref: @finalize_step_target
         } = decision,
         _spec
       ),
       do: {:execute, finalization_step_fun(), decision}

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

    Map.update(result, :run_patch, patch, fn existing ->
      Map.merge(existing || %{}, patch)
    end)
  end

  defp maybe_put_plan_run_patch(result, _meta), do: result

  defp finalize(turn_result, run) do
    AgentFinalizer.attach_run_summary(turn_result, %{
      run_id: run.run_id,
      run_mode: run.run_mode,
      parent_turn_ref: run.parent_turn_ref,
      profile_ref: run.profile_ref,
      status: :completed
    })
  end

  defp artifact_refs(turn_result) do
    turn_result
    |> Map.get(:adoption_state, %{})
    |> Map.get(:pending, [])
    |> Enum.map(&(Map.get(&1, :artifact_id) || Map.get(&1, "artifact_id")))
    |> Enum.reject(&blank?/1)
  end

  defp revision_refs(result) do
    [
      ref("artifact", result.artifact_set.artifact_set_id),
      ref("revision_base", result.artifact_set.revision_base),
      ref("tool_result", tool_result_ref(result))
    ]
    |> Enum.reject(&blank?/1)
  end

  defp tool_result_ref(result) do
    execution = Map.get(result, :execution) || %{}
    tool_result = Map.get(execution, :result) || %{}

    case Map.get(tool_result, :tool_result_id) || Map.get(tool_result, "tool_result_id") do
      value when is_binary(value) -> value
      _ -> nil
    end
  end

  defp finding_refs(prepared) do
    prepared
    |> finding_ref_list()
    |> Enum.join(",")
  end

  defp finding_ref_list(prepared) do
    prepared
    |> Map.get(:findings, [])
    |> Enum.map(&(map_get(&1, :validator) |> to_text()))
    |> Enum.reject(&blank?/1)
    |> Enum.uniq()
  end

  defp prepare_observation_id(run, sequence),
    do: "obs_#{run.run_id}_#{sequence}_revision_prepare"

  defp plan_observation_id(run, sequence), do: "obs_#{run.run_id}_#{sequence}_revision_plan"

  defp execute_observation_id(run, sequence),
    do: "obs_#{run.run_id}_#{sequence}_revision_execute"

  defp final_observation_id(run, sequence),
    do: "obs_#{run.run_id}_#{sequence}_revision_finalize"

  defp current_step_ref(run, sequence),
    do: run.current_step_ref || "step_#{run.run_id}_#{sequence}"

  defp state_snapshot_ref(run, sequence, stage) do
    [
      "agent_snapshot",
      run.work_id,
      run.session_id,
      run.run_id,
      "step",
      sequence,
      stage,
      "goal_v#{run.goal.version}"
    ]
    |> Enum.map_join(":", &to_string/1)
  end

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

  defp blank?(value), do: is_nil(value) or value == ""

  defp to_text(value) when is_binary(value), do: value
  defp to_text(nil), do: ""
  defp to_text(value), do: to_string(value)
end
