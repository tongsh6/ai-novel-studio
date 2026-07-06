defmodule NovelApplication.AgentRunFlows.ReadonlyBatchContext do
  @moduledoc """
  Read-only AgentRun profile that batches independent archive/context reads.

  The profile produces observations and a normal TurnResult. It never creates
  tentative artifacts, adoption actions, or production writes.
  """

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentFinalizer
  alias NovelApplication.AgenticNextStepPlanner
  alias NovelApplication.AgenticPlanDraftPlanner
  alias NovelApplication.WorkArchiveService
  alias NovelDomain.{AgentNextStepDecision, AgentObservation, AgentStep}

  @profile_ref "readonly_batch_context_v1"
  @readonly_step_target "readonly_batch"
  @plan_exhausted_replan_reason "计划步骤已走完，但只读批量上下文尚未汇总。"

  @spec profile_ref() :: String.t()
  def profile_ref, do: @profile_ref

  @spec steps(map()) :: no_return()
  def steps(_spec) do
    raise ArgumentError, "readonly_batch_context_v1 requires next_step_planner/1"
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

      readonly_batch_finalized?(snapshot) ->
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

    with true <- target == @readonly_step_target,
         {:ok, decision} <-
           AgentNextStepDecision.new(%{
             decision_id:
               "and_#{run.run_id}_#{sequence}_plan_#{map_get(step, :step_id) || sequence}",
             run_ref: run.run_id,
             sequence: sequence,
             decision_type: :execute_step,
             summary: map_get(step, :description) || "推进只读批量上下文计划步骤。",
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
      decision_id: "and_#{run.run_id}_#{sequence}_readonly_batch_complete",
      run_ref: run.run_id,
      sequence: sequence,
      decision_type: :goal_satisfied,
      summary: "计划步骤已完成，只读批量上下文已汇总。",
      reason_codes: [
        "readonly_batch_finalized",
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
      decision_id: "and_#{run.run_id}_#{sequence}_readonly_batch_plan_exhausted",
      run_ref: run.run_id,
      sequence: sequence,
      decision_type: :await_author,
      summary: "计划步骤已走完，但只读批量上下文尚未汇总，等待作者确认下一步。",
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

  defp batch_read_step(spec) do
    fn run, sequence, snapshot ->
      items = readonly_items(spec, run.work_id)

      results =
        NovelApplication.AgentStepTaskSupervisor
        |> Task.Supervisor.async_stream_nolink(items, &read_item/1,
          ordered: true,
          timeout: 5_000
        )
        |> Enum.map(&normalize_task_result/1)

      Enum.each(results, &emit_batch_item(snapshot, &1))

      observations =
        results
        |> Enum.with_index(1)
        |> Enum.map(fn {result, index} -> observation(run, sequence, index, result) end)

      {:ok,
       %{
         step: step(run, sequence, "readonly_batch_read"),
         observations: observations,
         stage_state: %{readonly_batch: results},
         tool_call_count: length(results),
         progress_signature: progress_signature(run, results)
       }}
    end
  end

  defp finalize_step do
    fn run, sequence, snapshot ->
      results =
        snapshot
        |> Map.get(:stage_state, %{})
        |> Map.get(:readonly_batch, [])

      turn_result =
        run
        |> turn_result(results)
        |> AgentFinalizer.attach_run_summary(%{
          run_id: run.run_id,
          run_mode: run.run_mode,
          parent_turn_ref: run.parent_turn_ref,
          profile_ref: run.profile_ref,
          status: :completed
        })

      {:ok,
       %{
         step: step(run, sequence, "readonly_batch_finalize"),
         observations: [],
         turn_result: turn_result,
         loop_status: :completed,
         loop_decision: complete_decision(run, sequence, observation_refs(snapshot)),
         progress_signature: "#{run.run_id}:readonly_batch_finalized:#{length(results)}"
       }}
    end
  end

  defp readonly_batch_read?(snapshot) do
    snapshot
    |> Map.get(:stage_state, %{})
    |> Map.get(:readonly_batch)
    |> is_list()
  end

  defp readonly_batch_finalized?(snapshot), do: is_map(Map.get(snapshot, :final_turn_result))

  defp complete_decision(run, sequence, observation_refs) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "and_#{run.run_id}_#{sequence}_readonly_batch_complete",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :goal_satisfied,
        summary: "只读批量上下文已汇总。",
        reason_codes: ["readonly_batch_finalized", "goal_satisfied"],
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
           target_tool_ref: @readonly_step_target
         } = decision,
         spec
       ) do
    {:execute,
     fn run, sequence, snapshot ->
       if readonly_batch_read?(snapshot) do
         finalize_step().(run, sequence, snapshot)
       else
         batch_read_step(spec).(run, sequence, snapshot)
       end
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

  defp observation_refs(snapshot) do
    snapshot
    |> Map.get(:observations, [])
    |> Enum.map(fn
      %AgentObservation{observation_id: id} -> id
      _ -> nil
    end)
    |> Enum.reject(&is_nil/1)
  end

  defp readonly_items(spec, work_id) do
    readers =
      case Map.get(spec, :readers) do
        readers when is_map(readers) -> readers
        _ -> %{}
      end

    [
      %{
        item_ref: "work_profile",
        label: "作品档案概况",
        read: Map.get(readers, :work_profile, fn -> WorkArchiveService.profile(work_id) end)
      },
      %{
        item_ref: "characters",
        label: "角色档案",
        read: Map.get(readers, :characters, fn -> WorkArchiveService.characters(work_id) end)
      },
      %{
        item_ref: "rules",
        label: "规则档案",
        read: Map.get(readers, :rules, fn -> WorkArchiveService.rules(work_id) end)
      },
      %{
        item_ref: "stats",
        label: "作品统计",
        read: Map.get(readers, :stats, fn -> WorkArchiveService.stats(work_id) end)
      }
    ]
  end

  defp read_item(%{read: read} = item) when is_function(read, 0) do
    started = System.monotonic_time(:millisecond)
    data = read.()
    duration = System.monotonic_time(:millisecond) - started

    item
    |> Map.drop([:read])
    |> Map.merge(%{
      status: :ok,
      summary: item_summary(item, data),
      count: item_count(data),
      duration_ms: duration
    })
  rescue
    error ->
      item
      |> Map.drop([:read])
      |> Map.merge(%{
        status: :error,
        summary: "#{item.label}读取失败。",
        count: 0,
        error: Exception.message(error)
      })
  end

  defp normalize_task_result({:ok, result}), do: result

  defp normalize_task_result({:exit, reason}) do
    %{
      item_ref: "unknown",
      label: "未知只读项",
      status: :error,
      summary: "只读项读取失败。",
      count: 0,
      error: inspect(reason)
    }
  end

  defp emit_batch_item(snapshot, result) do
    case Map.get(snapshot, :stage_sink) do
      sink when is_function(sink, 1) ->
        sink.(%{
          event_type: :tool_completed,
          summary: "只读批量已读取#{result.label}。",
          reason_codes: ["readonly_batch_item_read", "readonly_authorized"],
          refs: ["readonly:#{result.item_ref}"],
          payload: %{
            stage: :readonly_batch_item,
            item_ref: result.item_ref,
            status: result.status,
            count: result.count,
            production_write: false
          }
        })

      _ ->
        :ok
    end
  end

  defp observation(run, sequence, index, result) do
    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: "obs_#{run.run_id}_#{sequence}_readonly_#{result.item_ref}",
        run_ref: run.run_id,
        step_ref: current_step_ref(run, sequence),
        observation_type: :tool_fact,
        source_ref: "readonly:#{result.item_ref}",
        summary: result.summary,
        structured_payload: %{
          item_ref: result.item_ref,
          label: result.label,
          status: result.status,
          count: result.count,
          batch_index: index
        },
        evidence_refs: [
          "readonly_authorized:#{result.item_ref}",
          "agent_event:readonly_batch_item_read"
        ]
      })

    observation
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
        decision_ref: "decision_#{run.run_id}_readonly_authorized_#{sequence}",
        tool_request_ref: "readonly_request_#{run.run_id}_#{sequence}",
        tool_result_ref: "readonly_result_#{run.run_id}_#{sequence}",
        observation_refs: [],
        state_snapshot_ref: "agent_snapshot:#{run.work_id}:#{run.run_id}:#{suffix}",
        idempotency_key: "#{run.run_id}:#{sequence}:#{suffix}:goal_v#{run.goal.version}"
      })

    step
  end

  defp step_goal("readonly_batch_read"), do: "并行读取只读上下文"
  defp step_goal(_suffix), do: "汇总只读上下文"

  defp turn_result(run, results) do
    success_count = Enum.count(results, &(&1.status == :ok))

    %{
      schema_version: "3.0-draft",
      turn_id: "#{run.parent_turn_ref}:agent:readonly_batch",
      parent_turn_id: run.parent_turn_ref,
      phase: "completed",
      status: "completed",
      next_action: "none",
      assistant_message: %{
        text: "已完成 #{success_count}/#{length(results)} 项只读上下文读取，未写入作品事实。"
      },
      frame_summary: %{
        frame_type: "agent_readonly_batch",
        dialogue_goal: "批量读取作品上下文",
        uncertainty: []
      },
      available_actions: [],
      ui_cards: [],
      candidate_directions: [],
      adoption_state: %{pending: [], resolved: []},
      trace_summary: %{
        readonly_batch: true,
        production_write: false,
        replay_policy: %{recall_provider: false},
        item_refs: Enum.map(results, & &1.item_ref)
      },
      produced_at: DateTime.utc_now() |> DateTime.to_iso8601()
    }
  end

  defp item_summary(%{label: label}, data), do: "#{label}读取完成：#{item_count(data)} 项。"

  defp item_count(data) when is_list(data), do: length(data)
  defp item_count(data) when is_map(data), do: map_size(data)
  defp item_count(nil), do: 0
  defp item_count(_data), do: 1

  defp progress_signature(run, results) do
    signature =
      results
      |> Enum.map(&{&1.item_ref, &1.status, &1.count})
      |> :erlang.term_to_binary()
      |> then(&:crypto.hash(:sha256, &1))
      |> Base.encode16(case: :lower)

    "#{run.run_id}:readonly_batch:#{signature}"
  end

  defp current_step_ref(run, sequence),
    do: run.current_step_ref || "step_#{run.run_id}_#{sequence}"

  defp planner_provider_execution(spec) do
    Map.get(spec, :planner_provider_execution) ||
      Map.get(spec, :provider_execution) ||
      Execution.dependency(purpose: :planner)
  end

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_get(_map, _key), do: nil

  defp blank?(value), do: not is_binary(value) or String.trim(value) == ""
end
