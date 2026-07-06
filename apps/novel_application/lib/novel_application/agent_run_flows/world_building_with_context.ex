defmodule NovelApplication.AgentRunFlows.WorldBuildingWithContext do
  @moduledoc """
  Bounded AgentRun flow that creates world-building setting candidates through
  the existing world_building execution chain.
  """

  alias NovelAgent.AgentTaskProfileRegistry
  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentFinalizer
  alias NovelApplication.AgenticNextStepPlanner
  alias NovelApplication.AgenticPlanDraftPlanner
  alias NovelApplication.AgentObservationAssembler
  alias NovelApplication.ContextAssembler
  alias NovelApplication.ExecutionOrchestrator
  alias NovelApplication.ProviderActivityProjector
  alias NovelApplication.TurnExecutionService
  alias NovelCommon.LogContext
  alias NovelDomain.AgentNextStepDecision
  alias NovelDomain.AgentObservation
  alias NovelDomain.AgentStep
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan

  @profile_ref "world_building_with_context_v1"
  @context_step_target "context_assemble"
  @plan_exhausted_replan_reason "计划步骤已走完，但世界设定候选尚未生成。"

  @spec profile_ref() :: String.t()
  def profile_ref, do: @profile_ref

  @spec steps(map()) :: no_return()
  def steps(_spec) do
    raise ArgumentError, "world_building_with_context_v1 requires next_step_planner/1"
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

  defp maybe_replan_exhausted_plan(run, sequence, snapshot, spec) do
    if replan_available?(run) do
      with {:ok, revised_plan, revision_meta} <-
             AgenticPlanDraftPlanner.revise_plan_with_meta(
               run,
               planner_provider_execution(spec),
               snapshot,
               revision_reason: @plan_exhausted_replan_reason
             ) do
        execute_from_revised_plan(run, sequence, snapshot, revised_plan, revision_meta)
      end
    else
      mechanical_await_author_decision(run, sequence)
    end
  end

  defp execute_from_revised_plan(run, sequence, snapshot, revised_plan, revision_meta) do
    revised_run = %{
      run
      | plan: revised_plan,
        plan_ref: revised_plan.plan_id,
        plan_version: revised_plan.version
    }

    steps = plan_steps(revised_plan)
    index = plan_cursor(snapshot)

    meta =
      revision_meta
      |> Map.put(:agent_plan, revised_plan)
      |> Map.put(:agent_plan_cursor, index)

    if index < length(steps) do
      steps
      |> Enum.at(index)
      |> mechanical_execute_decision(revised_run, sequence, snapshot, meta)
    else
      mechanical_await_author_decision(run, sequence)
    end
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

    with true <- target in [@context_step_target, "world_building"],
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

  defp mechanical_complete_decision(run, sequence) do
    AgentNextStepDecision.new(%{
      decision_id: "and_#{run.run_id}_#{sequence}_plan_goal_satisfied",
      run_ref: run.run_id,
      sequence: sequence,
      decision_type: :goal_satisfied,
      summary: "计划步骤已完成，世界设定候选已生成。",
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
      summary: "计划步骤已走完，但世界设定候选尚未生成，等待作者确认下一步。",
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

  defp write_intent_for(_step, "world_building"), do: :tentative
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
      value when is_float(value) -> value
      value when is_integer(value) -> value / 1
      _ -> 1.0
    end
  end

  defp string_list(values) when is_list(values),
    do: values |> Enum.map(&to_string/1) |> Enum.reject(&blank?/1)

  defp string_list(_values), do: []

  defp execute_context_step(run, sequence, spec, snapshot) do
    turn_id = "#{run.parent_turn_ref}:agent:#{sequence}"
    context = context_for_run(spec, run, turn_id)

    emit_stage(
      snapshot,
      :goal_understood,
      "已组装世界设定上下文。",
      ["world_building_context_assembled"],
      ["context:#{turn_id}"],
      %{
        stage: :world_building_context_assembled,
        context_ref_count: context_ref_count(context)
      }
    )

    {:ok,
     %{
       step: context_step(run, sequence),
       observations: [context_observation(run, sequence, context, turn_id)],
       stage_state: %{context: context},
       progress_signature: "#{run.run_id}:world_building_context:#{turn_id}"
     }}
  end

  defp execute_tool_step(run, sequence, spec, decision, observations, snapshot) do
    with {:ok, plan} <- plan_from_decision(run, sequence, decision) do
      frame = frame(run, sequence, plan.plan_goal.summary)
      plan = %{plan | turn_id: frame.turn_id, frame_ref: frame.frame_id}
      emit_micro_plan(snapshot, plan)
      {decision_result, _behavior} = ExecutionOrchestrator.decide(frame, plan)
      emit_gate_decision(snapshot, decision_result)

      if decision_result.decision_type == :allow_tool do
        run_tool(run, sequence, spec, frame, plan, decision_result, observations, snapshot)
      else
        {:error, {:agent_step_blocked, tool_name(plan), decision_result.first_blocking_gate}}
      end
    end
  end

  defp run_tool(run, sequence, spec, frame, plan, decision, observations, snapshot) do
    execution_context = Map.get(stage_state(snapshot), :context) || Map.get(spec, :context)

    emit_stage(
      snapshot,
      :tool_started,
      "正在调用世界设定能力。",
      ["world_building_started"],
      [plan.plan_id, Map.get(decision, :decision_id)],
      %{
        stage: :world_building_started,
        tool_name: tool_name(plan),
        plan_ref: plan.plan_id,
        decision_ref: Map.get(decision, :decision_id)
      }
    )

    {turn_result, _trace} =
      TurnExecutionService.execute(%{
        frame: frame,
        plan: plan,
        decision: decision,
        candidates: [],
        context: execution_context,
        author_input: %{
          text: author_input_text(run, plan, observations),
          author_goal_text: run.goal.text
        },
        source_turn_ref: run.parent_turn_ref,
        provider_execution: provider_execution(spec, snapshot),
        chapter_prose_reader:
          Map.get(spec, :chapter_prose_reader) ||
            NovelApplication.persistence_chapter_prose_reader(),
        chapter_summary_reader:
          Map.get(spec, :chapter_summary_reader) ||
            NovelApplication.persistence_chapter_summary_reader(),
        character_reader:
          Map.get(spec, :character_reader) || NovelApplication.persistence_character_reader()
      })

    tool_result = Map.get(turn_result, :tool_result) || %{}

    if Map.get(tool_result, :status) == :failed do
      {:error, {:tool_failed, tool_name(plan), Map.get(tool_result, :errors, [])}}
    else
      emit_stage(
        snapshot,
        :tool_completed,
        "世界设定草稿已生成。",
        ["world_building_completed"],
        tool_refs(turn_result),
        %{
          stage: :world_building_completed,
          tool_name: Map.get(tool_result, :tool_name),
          tool_result_ref: Map.get(tool_result, :tool_result_id),
          artifact_refs: artifact_refs(turn_result)
        }
      )

      turn_result = finalize(turn_result, run)
      step_id = current_step_ref(run, sequence)
      refs = artifact_refs(turn_result)

      {:ok,
       %{
         step: execution_step(run, sequence, plan, turn_result),
         observations:
           [tool_observation(run, sequence, frame, turn_result)] ++
             AgentObservationAssembler.from_turn_result(turn_result, %{
               run_id: run.run_id,
               step_id: step_id
             }),
         artifact_refs: refs,
         turn_result: turn_result,
         tool_call_count: 1,
         provider_call_count: provider_call_count(turn_result),
         progress_signature: progress_signature(turn_result)
       }}
    end
  end

  defp provider_execution(spec, snapshot) do
    (Map.get(spec, :provider_execution) ||
       Execution.dependency(purpose: :tool))
    |> ProviderActivityProjector.with_stage_sink(snapshot, purpose: :writer)
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

  defp author_input_text(run, plan, observations) do
    observation_text =
      observations
      |> Enum.map(& &1.summary)
      |> Enum.reject(&blank?/1)
      |> Enum.join("\n")

    [
      run.goal.text,
      "当前 AgentStep：#{plan.plan_goal.summary}",
      observation_section(observation_text)
    ]
    |> Enum.reject(&blank?/1)
    |> Enum.join("\n\n")
  end

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
        goal: "组装世界设定上下文",
        observation_refs: [context_observation_id(run, sequence)],
        state_snapshot_ref: state_snapshot_ref(run, sequence, "world_building_context"),
        idempotency_key:
          "#{run.run_id}:#{sequence}:world_building_context:goal_v#{run.goal.version}"
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
        observation_refs: [tool_observation_id(run, sequence)],
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
        summary: "已组装世界设定上下文，可用于后续设定、伏笔或规则草稿。",
        structured_payload: %{
          current_chapter_count: length(context.current_chapters || []),
          structured_chapter_count: length(context.structured_chapters || []),
          context_ref_count: length(context.context_refs || [])
        },
        evidence_refs: ["context:#{turn_id}"]
      })

    observation
  end

  defp tool_observation(run, sequence, frame, turn_result) do
    refs = artifact_refs(turn_result)

    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: tool_observation_id(run, sequence),
        run_ref: run.run_id,
        step_ref: current_step_ref(run, sequence),
        observation_type: :custom,
        source_ref: "turn_result:#{frame.turn_id}",
        summary: "已生成 #{length(refs)} 个待采纳世界设定候选。",
        structured_payload: %{artifact_refs: refs},
        evidence_refs: ["turn:#{frame.turn_id}" | tool_refs(turn_result)]
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

  defp finalize(turn_result, run) do
    AgentFinalizer.attach_run_summary(turn_result, %{
      run_id: run.run_id,
      run_mode: run.run_mode,
      parent_turn_ref: run.parent_turn_ref,
      profile_ref: run.profile_ref,
      status: :completed
    })
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

  defp context_observation_id(run, sequence), do: "obs_#{run.run_id}_#{sequence}_world_context"

  defp tool_observation_id(run, sequence), do: "obs_#{run.run_id}_#{sequence}_world_tool"

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
       execute_context_step(run, sequence, spec, snapshot)
     end, decision}
  end

  defp next_step_from_decision(
         %AgentNextStepDecision{decision_type: :execute_step} = decision,
         spec
       ) do
    {:execute,
     fn run, sequence, snapshot ->
       execute_tool_step(
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
             risk_hint: decision.risk_hint
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

    [
      Map.get(tool_result, :tool_name),
      stable_signature(output),
      artifact_refs(turn_result) |> Enum.join(",")
    ]
    |> Enum.reject(&blank?/1)
    |> Enum.join(":")
  end

  defp tool_refs(turn_result) do
    tool_result = Map.get(turn_result, :tool_result) || %{}
    trace_summary = Map.get(turn_result, :trace_summary) || %{}

    [
      ref("tool_result", Map.get(tool_result, :tool_result_id)),
      ref("writer_provider_call", Map.get(trace_summary, :writer_provider_call_ref))
    ]
    |> Enum.reject(&blank?/1)
  end

  defp stage_state(snapshot), do: Map.get(snapshot, :stage_state, %{})

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_get(_map, _key), do: nil

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

  defp stable_signature(value) do
    :crypto.hash(:sha256, :erlang.term_to_binary(value))
    |> Base.encode16(case: :lower)
  end

  defp blank?(value), do: not is_binary(value) or String.trim(value) == ""
end
