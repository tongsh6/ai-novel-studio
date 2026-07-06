defmodule NovelApplication.AgentRunFlows.ProviderProgress do
  @moduledoc """
  AgentRun flow that exposes unified provider execution progress through
  author-safe AgentEvent records.
  """

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.Gateway
  alias NovelAgent.Provider.Result, as: ProviderResult
  alias NovelApplication.AgentFinalizer
  alias NovelApplication.AgenticNextStepPlanner
  alias NovelApplication.AgenticPlanDraftPlanner
  alias NovelDomain.{AgentNextStepDecision, AgentObservation, AgentStep}

  @profile_ref "provider_progress_v1"
  @provider_step_target "provider_complete"
  @plan_exhausted_replan_reason "计划步骤已走完，但 provider 进度结果尚未生成。"

  @spec profile_ref() :: String.t()
  def profile_ref, do: @profile_ref

  @spec steps(map()) :: no_return()
  def steps(_spec) do
    raise ArgumentError, "provider_progress_v1 requires next_step_planner/1"
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
        mechanical_complete_decision(run, sequence, observation_refs(snapshot))

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

    with true <- target == @provider_step_target,
         {:ok, decision} <-
           AgentNextStepDecision.new(%{
             decision_id:
               "and_#{run.run_id}_#{sequence}_plan_#{map_get(step, :step_id) || sequence}",
             run_ref: run.run_id,
             sequence: sequence,
             decision_type: :execute_step,
             summary: map_get(step, :description) || "记录 provider 执行进度边界。",
             target_tool_ref: target,
             write_intent: :none,
             risk_hint: :low,
             reason_codes: plan_step_reason_codes(step, target, meta),
             observation_refs: observation_refs(snapshot),
             evaluation_of_last: meta_evaluation(meta, sequence),
             plan_revision: map_get(meta, :plan_revision),
             confidence: meta_confidence(meta)
           }) do
      {:ok, decision, meta}
    else
      _ -> {:error, {:invalid_plan_step_target, target}}
    end
  end

  defp mechanical_complete_decision(run, sequence, observation_refs) do
    AgentNextStepDecision.new(%{
      decision_id: "and_#{run.run_id}_#{sequence}_provider_progress_complete",
      run_ref: run.run_id,
      sequence: sequence,
      decision_type: :goal_satisfied,
      summary: "计划步骤已完成，Provider 进度边界已记录。",
      reason_codes: [
        "provider_progress_recorded",
        "goal_satisfied",
        "agent_plan_mechanical_completion"
      ],
      observation_refs: observation_refs,
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
      decision_id: "and_#{run.run_id}_#{sequence}_provider_progress_plan_exhausted",
      run_ref: run.run_id,
      sequence: sequence,
      decision_type: :await_author,
      summary: "计划步骤已走完，但 provider 进度结果尚未生成，等待作者确认下一步。",
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

  defp completion_ready?(snapshot),
    do: provider_progress_recorded?(snapshot) or is_map(Map.get(snapshot, :final_turn_result))

  defp provider_step(spec) do
    fn run, sequence, snapshot ->
      text = Map.get(spec, :text) || run.goal.text
      capabilities = provider_capabilities(spec)

      emit_provider_progress(snapshot, "供应商请求已开始。", ["provider_call_started"], %{
        stage: :provider_call_started,
        provider_capabilities: capabilities,
        stream_mode: stream_mode(capabilities)
      })

      emit_provider_progress(
        snapshot,
        "Provider execution stream 已进入执行中。",
        ["provider_execution_stream_active"],
        %{
          stage: :provider_execution_stream_active,
          provider_capabilities: capabilities,
          stream_mode: stream_mode(capabilities)
        }
      )

      case provider_complete(spec).(provider_prompt(text)) do
        {:ok, result} ->
          content = provider_content(result)
          observation = observation(run, sequence, capabilities)

          emit_provider_progress(
            snapshot,
            "供应商已返回完整结果。",
            [
              "provider_call_completed"
            ],
            %{
              stage: :provider_call_completed,
              provider_capabilities: capabilities,
              output_chars: String.length(content)
            }
          )

          turn_result =
            run
            |> turn_result(content, capabilities)
            |> AgentFinalizer.attach_run_summary(%{
              run_id: run.run_id,
              run_mode: run.run_mode,
              parent_turn_ref: run.parent_turn_ref,
              profile_ref: run.profile_ref,
              status: :completed
            })

          {:ok,
           %{
             step: step(run, sequence),
             observations: [observation],
             turn_result: turn_result,
             provider_call_count: 1,
             loop_status: :completed,
             loop_decision: complete_decision(run, sequence, [observation.observation_id]),
             progress_signature: "#{run.run_id}:provider_progress:#{run.goal.version}"
           }}

        {:error, reason} ->
          {:error, {:provider_progress_failed, reason}}
      end
    end
  end

  defp provider_progress_recorded?(snapshot) do
    snapshot
    |> Map.get(:observations, [])
    |> Enum.any?(fn
      %AgentObservation{structured_payload: payload} ->
        Map.has_key?(payload, :provider_capabilities)

      _ ->
        false
    end)
  end

  defp complete_decision(run, sequence, observation_refs) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "and_#{run.run_id}_#{sequence}_provider_progress_complete",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :goal_satisfied,
        summary: "Provider 进度边界已记录。",
        reason_codes: ["provider_progress_recorded", "goal_satisfied"],
        observation_refs: observation_refs
      })

    decision
  end

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

  defp next_step_from_decision(
         %AgentNextStepDecision{
           decision_type: :execute_step,
           target_tool_ref: @provider_step_target
         } = decision,
         spec
       ),
       do: {:execute, provider_step(spec), decision}

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

  defp observation_refs(snapshot) do
    snapshot
    |> Map.get(:observations, [])
    |> Enum.map(fn
      %AgentObservation{observation_id: id} -> id
      _ -> nil
    end)
    |> Enum.reject(&is_nil/1)
  end

  defp emit_provider_progress(snapshot, summary, reason_codes, payload) do
    case Map.get(snapshot, :stage_sink) do
      sink when is_function(sink, 1) ->
        sink.(%{
          event_type: :provider_progress,
          summary: summary,
          reason_codes: reason_codes,
          payload: payload
        })

      _ ->
        :ok
    end
  end

  defp provider_capabilities(spec) do
    case Map.get(spec, :provider_capabilities_fn) do
      fun when is_function(fun, 0) -> fun.()
      _ -> Gateway.provider_capabilities()
    end
  end

  defp stream_mode(%{supports_streaming: true}), do: :provider_stream
  defp stream_mode(_capabilities), do: :provider_execution_stream

  defp provider_complete(spec) do
    spec
    |> provider_execution()
    |> Execution.result_fn()
  end

  defp provider_execution(spec) do
    Map.get(spec, :provider_execution) ||
      Execution.dependency(purpose: :other)
  end

  defp planner_provider_execution(spec) do
    Map.get(spec, :planner_provider_execution) ||
      Map.get(spec, :provider_execution) ||
      Execution.dependency(purpose: :planner)
  end

  defp provider_prompt(text) do
    """
    请基于作者请求生成一个简短、安全、可展示的创作执行摘要。

    作者请求：
    #{text}
    """
  end

  defp provider_content(%ProviderResult{content: content}) when is_binary(content), do: content
  defp provider_content(%{content: content}) when is_binary(content), do: content
  defp provider_content(%{"content" => content}) when is_binary(content), do: content
  defp provider_content(content) when is_binary(content), do: content
  defp provider_content(_result), do: ""

  defp step(run, sequence) do
    {:ok, step} =
      AgentStep.new(%{
        step_id: current_step_ref(run, sequence),
        run_ref: run.run_id,
        sequence: sequence,
        status: :completed,
        goal: "调用 provider 并记录进度边界",
        micro_plan_ref: "mp_#{run.run_id}_provider_progress_#{sequence}",
        decision_ref: "decision_#{run.run_id}_provider_progress_#{sequence}",
        tool_request_ref: "provider_request_#{run.run_id}_#{sequence}",
        tool_result_ref: "provider_result_#{run.run_id}_#{sequence}",
        observation_refs: ["obs_#{run.run_id}_#{sequence}_provider_progress"],
        state_snapshot_ref: "agent_snapshot:#{run.work_id}:#{run.run_id}:provider_progress",
        idempotency_key: "#{run.run_id}:#{sequence}:provider_progress:goal_v#{run.goal.version}"
      })

    step
  end

  defp observation(run, sequence, capabilities) do
    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: "obs_#{run.run_id}_#{sequence}_provider_progress",
        run_ref: run.run_id,
        step_ref: current_step_ref(run, sequence),
        observation_type: :custom,
        source_ref: "provider_capability:#{run.run_id}",
        summary: "已记录 provider 进度与取消能力边界。",
        structured_payload: %{
          provider_capabilities: capabilities,
          stream_mode: stream_mode(capabilities)
        },
        evidence_refs: [
          "agent_event:provider_progress",
          "provider_capability:#{capability_ref(capabilities)}"
        ]
      })

    observation
  end

  defp turn_result(run, content, capabilities) do
    %{
      schema_version: "3.0-draft",
      turn_id: "#{run.parent_turn_ref}:agent:provider_progress",
      parent_turn_id: run.parent_turn_ref,
      phase: "completed",
      status: "completed",
      next_action: "none",
      assistant_message: %{
        text: "模型调用已完成，进度事件已记录；当前 provider 的取消策略为 #{cancel_strategy_text(capabilities)}。"
      },
      frame_summary: %{
        frame_type: "agent_provider_progress",
        dialogue_goal: "展示 provider 进度与取消能力边界",
        uncertainty: []
      },
      available_actions: [],
      ui_cards: [],
      candidate_directions: [],
      trace_summary: %{
        provider_progress: true,
        provider_output_chars: String.length(content),
        provider_capabilities: capabilities,
        raw_prompt_stored: false
      },
      produced_at: DateTime.utc_now() |> DateTime.to_iso8601()
    }
  end

  defp cancel_strategy_text(%{cancel_strategy: strategy}) do
    case strategy do
      :provider_execution_cancel -> "ProviderExecution 取消"
      "provider_execution_cancel" -> "ProviderExecution 取消"
      _ -> "ProviderExecution 取消"
    end
  end

  defp cancel_strategy_text(_capabilities), do: "ProviderExecution 取消"

  defp capability_ref(%{provider: provider}), do: provider
  defp capability_ref(_capabilities), do: "unknown"

  defp current_step_ref(run, sequence),
    do: run.current_step_ref || "step_#{run.run_id}_#{sequence}"

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_get(_map, _key), do: nil

  defp blank?(value), do: not is_binary(value) or String.trim(value) == ""
end
