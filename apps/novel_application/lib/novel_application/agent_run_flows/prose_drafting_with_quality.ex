defmodule NovelApplication.AgentRunFlows.ProseDraftingWithQuality do
  @moduledoc """
  Bounded AgentRun flow that drafts prose through the existing prose execution
  and quality-review chain.
  """

  alias NovelAgent.Provider.Gateway
  alias NovelApplication.AgentFinalizer
  alias NovelApplication.AgentObservationAssembler
  alias NovelApplication.AgentStepPlanner
  alias NovelApplication.ContextAssembler
  alias NovelApplication.ExecutionOrchestrator
  alias NovelApplication.TurnExecutionService
  alias NovelCommon.LogContext
  alias NovelDomain.AgentObservation
  alias NovelDomain.AgentStep
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame

  @profile_ref "prose_drafting_with_quality_v1"

  @spec profile_ref() :: String.t()
  def profile_ref, do: @profile_ref

  @spec steps(map()) :: [NovelApplication.AgentRunService.step_fun()]
  def steps(spec) when is_map(spec) do
    [
      context_step_fun(spec),
      strategy_step_fun(spec),
      execution_step_fun(spec),
      finalization_step_fun()
    ]
  end

  defp context_step_fun(spec) do
    fn run, sequence, snapshot ->
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
  end

  defp strategy_step_fun(spec) do
    fn run, sequence, snapshot ->
      plan_and_gate_step(run, sequence, snapshot, Map.get(snapshot, :observations, []), spec)
    end
  end

  defp execution_step_fun(spec) do
    fn run, sequence, snapshot ->
      state = stage_state(snapshot)

      case {Map.get(state, :frame), Map.get(state, :plan), Map.get(state, :decision)} do
        {%DialogueFrame{} = frame, plan, decision} ->
          do_execute_tool_step(
            run,
            sequence,
            spec,
            frame,
            plan,
            decision,
            Map.get(snapshot, :observations, []),
            snapshot
          )

        _missing ->
          {:error, {:missing_prose_strategy_stage_state, Map.keys(state)}}
      end
    end
  end

  defp finalization_step_fun do
    fn run, sequence, snapshot ->
      state = stage_state(snapshot)

      case Map.get(state, :turn_result) do
        turn_result when is_map(turn_result) ->
          final_turn_result = finalize(turn_result, run)
          step_id = current_step_ref(run, sequence)

          {:ok,
           %{
             step: final_step(run, sequence, final_turn_result),
             observations:
               AgentObservationAssembler.from_turn_result(final_turn_result, %{
                 run_id: run.run_id,
                 step_id: step_id
               }),
             artifact_refs: artifact_refs(final_turn_result),
             turn_result: final_turn_result,
             progress_signature:
               "#{run.run_id}:prose_finalize:#{Enum.join(artifact_refs(final_turn_result), ",")}"
           }}

        _missing ->
          {:error, {:missing_prose_turn_result_stage_state, Map.keys(state)}}
      end
    end
  end

  defp plan_and_gate_step(run, sequence, snapshot, observations, spec) do
    with {:ok, plan} <- AgentStepPlanner.next_plan(run, sequence, observations) do
      frame = frame(run, sequence, plan.plan_goal.summary)
      plan = %{plan | turn_id: frame.turn_id, frame_ref: frame.frame_id}

      context =
        Map.get(stage_state(snapshot), :context) || context_for_run(spec, run, frame.turn_id)

      emit_stage(
        snapshot,
        :plan_created,
        "已生成正文执行计划。",
        ["micro_plan_created"],
        [
          plan.plan_id
        ],
        %{
          stage: :micro_plan_created,
          plan_ref: plan.plan_id,
          action_count: length(plan.proposed_actions)
        }
      )

      {decision, _behavior} = ExecutionOrchestrator.decide(frame, plan)

      if decision.decision_type == :allow_tool do
        emit_stage(
          snapshot,
          :gate_decided,
          "已通过正文工具执行授权：#{decision.decision_type}。",
          ["orchestrator_decision_recorded"],
          [Map.get(decision, :decision_id)],
          %{
            stage: :orchestrator_decision_recorded,
            decision_ref: Map.get(decision, :decision_id),
            decision_type: decision.decision_type,
            first_blocking_gate: decision.first_blocking_gate
          }
        )

        {:ok,
         %{
           step: strategy_step(run, sequence, plan, decision),
           observations: [strategy_observation(run, sequence, plan, decision)],
           stage_state: %{frame: frame, plan: plan, decision: decision, context: context},
           progress_signature:
             "#{run.run_id}:prose_strategy:#{plan.plan_id}:#{decision.decision_id}"
         }}
      else
        {:error, {:agent_step_blocked, tool_name(plan), decision.first_blocking_gate}}
      end
    end
  end

  defp do_execute_tool_step(run, sequence, spec, frame, plan, decision, observations, snapshot) do
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

    {turn_result, _trace} =
      TurnExecutionService.execute(%{
        frame: frame,
        plan: plan,
        decision: decision,
        candidates: [],
        context: execution_context,
        author_input: %{text: author_input_text(run, plan, observations)},
        source_turn_ref: run.parent_turn_ref,
        complete_fn: complete_fn(spec),
        quality_complete_fn: quality_complete_fn(spec),
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

      {:ok,
       %{
         step: execution_step(run, sequence, plan, turn_result),
         observations: [quality_observation(run, sequence, frame, turn_result)],
         stage_state: %{turn_result: turn_result},
         tool_call_count: 1,
         provider_call_count: provider_call_count(turn_result),
         progress_signature: progress_signature(turn_result)
       }}
    end
  end

  defp complete_fn(spec), do: Map.get(spec, :complete_fn) || (&Gateway.complete/1)

  defp quality_complete_fn(spec) do
    Map.get(spec, :quality_complete_fn) || Map.get(spec, :complete_fn) || (&Gateway.complete/1)
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
        goal: "组装正文写作上下文",
        observation_refs: [context_observation_id(run, sequence)],
        state_snapshot_ref: state_snapshot_ref(run, sequence, "prose_context"),
        idempotency_key: "#{run.run_id}:#{sequence}:prose_context:goal_v#{run.goal.version}"
      })

    step
  end

  defp strategy_step(run, sequence, plan, decision) do
    {:ok, step} =
      AgentStep.new(%{
        step_id: current_step_ref(run, sequence),
        run_ref: run.run_id,
        sequence: sequence,
        status: :completed,
        goal: "制定正文执行策略并完成授权判断",
        micro_plan_ref: plan.plan_id,
        decision_ref: Map.get(decision, :decision_id),
        observation_refs: [strategy_observation_id(run, sequence)],
        state_snapshot_ref: state_snapshot_ref(run, sequence, "prose_strategy"),
        idempotency_key: "#{run.run_id}:#{sequence}:prose_strategy:goal_v#{run.goal.version}"
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

  defp final_step(run, sequence, turn_result) do
    trace_summary = Map.get(turn_result, :trace_summary) || %{}
    tool_result = Map.get(turn_result, :tool_result) || %{}

    {:ok, step} =
      AgentStep.new(%{
        step_id: current_step_ref(run, sequence),
        run_ref: run.run_id,
        sequence: sequence,
        status: :completed,
        goal: "汇总正文草稿和质量复核结果给作者",
        micro_plan_ref: Map.get(trace_summary, :plan_ref),
        decision_ref: Map.get(trace_summary, :decision_ref),
        tool_request_ref: Map.get(trace_summary, :tool_request_id),
        tool_result_ref:
          Map.get(trace_summary, :tool_result_id) || Map.get(tool_result, :tool_result_id),
        observation_refs: [artifact_observation_id(run, sequence)],
        state_snapshot_ref: state_snapshot_ref(run, sequence, "prose_finalize"),
        idempotency_key: "#{run.run_id}:#{sequence}:prose_finalize:goal_v#{run.goal.version}"
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

  defp strategy_observation(run, sequence, plan, decision) do
    decision_ref = Map.get(decision, :decision_id) || plan.plan_id

    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: strategy_observation_id(run, sequence),
        run_ref: run.run_id,
        step_ref: current_step_ref(run, sequence),
        observation_type: :custom,
        source_ref: "decision:#{decision_ref}",
        summary: "已完成正文执行策略判断：允许调用 #{tool_name(plan)}。",
        structured_payload: %{
          plan_ref: plan.plan_id,
          decision_ref: decision_ref,
          tool_name: tool_name(plan)
        },
        evidence_refs: ["plan:#{plan.plan_id}", "decision:#{decision_ref}"]
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

  defp finalize(turn_result, run) do
    AgentFinalizer.attach_run_summary(turn_result, %{
      run_id: run.run_id,
      run_mode: run.run_mode,
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

  defp strategy_observation_id(run, sequence), do: "obs_#{run.run_id}_#{sequence}_prose_strategy"

  defp quality_observation_id(run, sequence), do: "obs_#{run.run_id}_#{sequence}_quality"

  defp artifact_observation_id(run, sequence),
    do: "obs_#{current_step_ref(run, sequence)}_artifact"

  defp context_observation_id(run, sequence), do: "obs_#{run.run_id}_#{sequence}_prose_context"

  defp tool_name(plan), do: plan.proposed_actions |> hd() |> Map.fetch!(:target_ref)

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
