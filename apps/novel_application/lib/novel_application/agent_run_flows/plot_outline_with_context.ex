defmodule NovelApplication.AgentRunFlows.PlotOutlineWithContext do
  @moduledoc """
  Bounded AgentRun flow that plans a chapter outline through the existing
  plot_outline execution chain.
  """

  alias NovelAgent.AgentTaskProfileRegistry
  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentFinalizer
  alias NovelApplication.AgenticNextStepPlanner
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

  @profile_ref "plot_outline_with_context_v1"
  @context_step_target "context_assemble"

  @spec profile_ref() :: String.t()
  def profile_ref, do: @profile_ref

  @spec steps(map()) :: no_return()
  def steps(_spec) do
    raise ArgumentError, "plot_outline_with_context_v1 requires next_step_planner/1"
  end

  @spec next_step_planner(map()) :: NovelApplication.AgentRunServer.next_step_planner()
  def next_step_planner(spec) when is_map(spec) do
    fn run, sequence, snapshot ->
      observations = Map.get(snapshot, :observations, [])

      with {:ok, decision} <-
             AgenticNextStepPlanner.next_decision(
               run,
               sequence,
               observations,
               planner_provider_execution(spec),
               snapshot
             ) do
        next_step_from_decision(decision, spec)
      end
    end
  end

  defp execute_context_decision_step(run, sequence, spec, snapshot) do
    turn_id = "#{run.parent_turn_ref}:agent:#{sequence}"
    context = context_for_run(spec, run, turn_id)

    emit_stage(
      snapshot,
      :goal_understood,
      "已组装章节大纲规划上下文。",
      ["outline_context_assembled"],
      ["context:#{turn_id}"],
      %{
        stage: :outline_context_assembled,
        context_ref_count: context_ref_count(context)
      }
    )

    {:ok,
     %{
       step: context_step(run, sequence),
       observations: [context_observation(run, sequence, context, turn_id)],
       stage_state: %{context: context},
       progress_signature: "#{run.run_id}:outline_context:#{turn_id}"
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
          frame,
          plan,
          decision_result,
          observations,
          snapshot
        )
      else
        {:error, {:agent_step_blocked, tool_name(plan), decision_result.first_blocking_gate}}
      end
    end
  end

  defp do_execute_tool_step(run, sequence, spec, frame, plan, decision, observations, snapshot) do
    execution_context = Map.get(stage_state(snapshot), :context) || Map.get(spec, :context)

    emit_stage(
      snapshot,
      :tool_started,
      "正在调用章节大纲规划能力。",
      ["plot_outline_started"],
      [plan.plan_id, Map.get(decision, :decision_id)],
      %{
        stage: :plot_outline_started,
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
        author_input: %{text: author_input_text(run, plan, observations)},
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
        "章节大纲草稿已生成。",
        ["plot_outline_completed"],
        tool_refs(turn_result),
        %{
          stage: :plot_outline_completed,
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
        goal: "组装章节大纲规划上下文",
        observation_refs: [context_observation_id(run, sequence)],
        state_snapshot_ref: state_snapshot_ref(run, sequence, "outline_context"),
        idempotency_key: "#{run.run_id}:#{sequence}:outline_context:goal_v#{run.goal.version}"
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
        summary: "已组装章节大纲规划上下文，可用于后续大纲策略与执行。",
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
        summary: "已生成 #{length(refs)} 个待采纳大纲草稿候选。",
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

  defp context_observation_id(run, sequence), do: "obs_#{run.run_id}_#{sequence}_outline_context"

  defp tool_observation_id(run, sequence), do: "obs_#{run.run_id}_#{sequence}_outline_tool"

  defp tool_name(plan), do: plan.proposed_actions |> hd() |> Map.fetch!(:target_ref)

  defp next_step_from_decision(
         %AgentNextStepDecision{
           decision_type: :execute_step,
           target_tool_ref: @context_step_target
         } =
           decision,
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
             risk_hint: decision.risk_hint
           }
         ],
         required_capabilities: [tool_name]
       }}
    else
      {:error, {:tool_not_allowed_by_profile, tool_name}}
    end
  end

  defp emit_micro_plan(snapshot, plan) do
    emit_stage(
      snapshot,
      :plan_created,
      "已根据观察制定下一步计划：#{plan.plan_goal.summary}",
      ["micro_plan_created", "agentic_loop_step"],
      [plan.plan_id],
      %{
        stage: :micro_plan_created,
        plan_ref: plan.plan_id,
        action_count: length(plan.proposed_actions),
        target_tool_ref: tool_name(plan)
      }
    )
  end

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
