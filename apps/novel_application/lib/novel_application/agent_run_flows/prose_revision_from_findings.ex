defmodule NovelApplication.AgentRunFlows.ProseRevisionFromFindings do
  @moduledoc """
  Bounded AgentRun flow for `revise_from_findings` author actions.
  """

  alias NovelApplication.ActionValidator
  alias NovelApplication.AgentFinalizer
  alias NovelApplication.AgentObservationAssembler
  alias NovelApplication.ProseRevisionService
  alias NovelApplication.ProviderActivityProjector
  alias NovelDomain.AgentObservation
  alias NovelDomain.AgentStep
  alias NovelDomain.AuthorActionInput

  @profile_ref "prose_revision_from_findings_v1"

  @spec profile_ref() :: String.t()
  def profile_ref, do: @profile_ref

  @spec steps(map()) :: [NovelApplication.AgentRunService.step_fun()]
  def steps(spec) when is_map(spec) do
    [
      prepare_step_fun(spec),
      plan_step_fun(spec),
      execute_step_fun(spec),
      finalization_step_fun()
    ]
  end

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
          :plan_created,
          "已生成修订执行计划。",
          ["revision_micro_plan_created"],
          [plan.plan_id],
          %{
            stage: :revision_micro_plan_created,
            plan_ref: plan.plan_id,
            action_count: length(plan.proposed_actions)
          }
        )

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
            AgentObservationAssembler.from_turn_result(final_turn_result, %{
              run_id: run.run_id,
              step_id: step_id
            })

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

  defp finalize(turn_result, run) do
    AgentFinalizer.attach_run_summary(turn_result, %{
      run_id: run.run_id,
      run_mode: run.run_mode,
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
