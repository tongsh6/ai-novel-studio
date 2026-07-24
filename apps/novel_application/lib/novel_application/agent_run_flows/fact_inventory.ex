defmodule NovelApplication.AgentRunFlows.FactInventory do
  @moduledoc """
  设定盘点 AgentRun profile（VS-00G CP4b-2 / 契约 §3.3 `fact_inventory_v1`）。

  壳复用 `ledger_reconciliation_v1`：模型只起草允许工具范围内的计划，运行期机械读取
  作品材料并调用 FactInventoryService 提炼。提炼结果按既有 seed artifact family 分组，
  同一 TurnResult 生成多张 candidate_set 和逐项采纳动作；作者采纳前不进入 canon。
  """

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentFinalizer
  alias NovelApplication.AgenticNextStepPlanner
  alias NovelApplication.AgenticPlanDraftPlanner
  alias NovelApplication.FactInventoryService
  alias NovelApplication.ProviderActivityProjector
  alias NovelApplication.TurnResultBuilder
  alias NovelCommon.Contracts.ToolResult
  alias NovelDomain.{AgentNextStepDecision, AgentObservation, AgentStep, DialogueFrame}

  @profile_ref "fact_inventory_v1"
  @inventory_step_target "fact_inventory"
  @plan_exhausted_reason "计划步骤已走完，但设定盘点尚未产生待采纳提案。"

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
    case map_get(plan, :steps) do
      [_ | _] = steps ->
        Enum.all?(steps, &(map_get(&1, :target_tool_ref) == @inventory_step_target))

      _ ->
        false
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

      inventory_done?(snapshot) ->
        {:ok, complete_decision(run, sequence, observation_refs(snapshot)), meta}

      true ->
        {:error, {:plan_exhausted, @plan_exhausted_reason}}
    end
  end

  defp mechanical_execute_decision(step, run, sequence, meta) do
    target = map_get(step, :target_tool_ref)

    with true <- target == @inventory_step_target,
         {:ok, decision} <-
           AgentNextStepDecision.new(%{
             decision_id:
               "and_#{run.run_id}_#{sequence}_plan_#{map_get(step, :step_id) || sequence}",
             run_ref: run.run_id,
             sequence: sequence,
             decision_type: :execute_step,
             summary: map_get(step, :description) || "读取作品材料并整理设定盘点提案。",
             target_tool_ref: target,
             write_intent: :tentative,
             risk_hint: :low,
             reason_codes: ["agent_plan_step", "fact_inventory_readonly_extract"],
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
        decision_id: "and_#{run.run_id}_#{sequence}_fact_inventory_complete",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :goal_satisfied,
        summary: "设定盘点提案已生成，等待作者逐项处置。",
        reason_codes: ["fact_inventory_artifacts_created", "goal_satisfied"],
        observation_refs: observation_refs
      })

    decision
  end

  defp next_step_from_decision(
         %AgentNextStepDecision{
           decision_type: :execute_step,
           target_tool_ref: @inventory_step_target
         } = decision,
         spec
       ) do
    {:execute, inventory_step(spec), decision}
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
    Map.update(result, :run_patch, patch, &Map.merge(&1 || %{}, patch))
  end

  defp maybe_put_plan_run_patch(result, _meta), do: result

  defp inventory_step(spec) do
    fn run, sequence, snapshot ->
      with [_ | _] = materials <- material_reader(spec).(run.work_id),
           {:ok, proposal, proposal_meta} <-
             FactInventoryService.inventory_with_meta(
               materials,
               inventory_provider_execution(spec, snapshot)
             ),
           [_ | _] = artifact_sets <-
             FactInventoryService.artifact_sets(proposal, %{
               source_turn_ref: inventory_turn_id(run, sequence),
               source_tool_result_ref: tool_result_id(run, sequence),
               context_refs: [
                 "work:#{run.work_id}",
                 "fact_inventory_materials:#{length(materials)}"
               ]
             }) do
        turn_result =
          build_turn_result(run, sequence, materials, artifact_sets)
          |> AgentFinalizer.attach_run_summary(%{
            run_id: run.run_id,
            run_mode: run.run_mode,
            parent_turn_ref: run.parent_turn_ref,
            profile_ref: run.profile_ref,
            status: :completed
          })

        refs = artifact_refs(turn_result)
        summary = inventory_summary(artifact_sets, refs)

        {:ok,
         %{
           step: step(run, sequence),
           observations: [artifact_observation(run, sequence, summary, refs)],
           artifact_refs: refs,
           turn_result: turn_result,
           stage_state: %{fact_inventory: summary},
           tool_call_count: 1,
           provider_call_count: proposal_meta.provider_call_count,
           progress_signature: "#{run.run_id}:fact_inventory:#{stable_signature(refs)}"
         }}
      else
        [] -> {:error, :fact_inventory_materials_missing}
        nil -> {:error, :fact_inventory_material_reader_missing}
        {:error, reason} -> {:error, {:fact_inventory_failed, reason}}
      end
    end
  end

  defp build_turn_result(run, sequence, materials, artifact_sets) do
    items = Enum.flat_map(artifact_sets, & &1.items)
    frame = frame(run, sequence, length(items))

    tool_result = %ToolResult{
      tool_result_id: tool_result_id(run, sequence),
      tool_request_ref: "fact_inventory_request_#{run.run_id}_#{sequence}",
      tool_name: @inventory_step_target,
      status: :succeeded,
      output: %{
        output_contract_ref: "tentative_artifact_v1",
        artifact_types: Enum.map(artifact_sets, & &1.artifact_type),
        item_count: length(items),
        material_count: length(materials),
        items: items
      },
      state_delta:
        Enum.map(artifact_sets, fn set ->
          %{
            type: :tentative_artifact,
            key: @inventory_step_target,
            artifact_type: set.artifact_type
          }
        end),
      artifact_refs: Enum.map(items, &map_get(&1, :item_id)),
      trace_refs: ["tool_trace:#{tool_result_id(run, sequence)}"],
      completed_at: DateTime.utc_now()
    }

    trace_summary = %{
      tool_result_id: tool_result.tool_result_id,
      writer_provider_call_ref: Enum.find_value(items, &map_get(&1, :provider_call_ref)),
      context_refs: ["work:#{run.work_id}", "fact_inventory_materials:#{length(materials)}"]
    }

    TurnResultBuilder.build_artifact_sets(frame, trace_summary, nil, tool_result, artifact_sets)
  end

  defp inventory_summary(artifact_sets, refs) do
    counts =
      Map.new(artifact_sets, fn set ->
        {set.artifact_type, length(set.items)}
      end)

    %{
      status: :proposal,
      artifact_refs: refs,
      item_count: Enum.sum(Map.values(counts)),
      counts: counts
    }
  end

  defp artifact_observation(run, sequence, summary, refs) do
    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: "obs_#{run.run_id}_#{sequence}_fact_inventory",
        run_ref: run.run_id,
        step_ref: current_step_ref(run, sequence),
        observation_type: :artifact_created,
        source_ref: tool_result_id(run, sequence),
        summary: "已从作品材料整理出 #{summary.item_count} 条待采纳设定提案。",
        structured_payload: summary,
        evidence_refs: [
          "tool_result:#{tool_result_id(run, sequence)}" | Enum.map(refs, &"artifact:#{&1}")
        ]
      })

    observation
  end

  defp step(run, sequence) do
    {:ok, step} =
      AgentStep.new(%{
        step_id: current_step_ref(run, sequence),
        run_ref: run.run_id,
        sequence: sequence,
        status: :completed,
        goal: "读取作品材料并整理待采纳设定提案",
        micro_plan_ref: "mp_#{run.run_id}_fact_inventory_#{sequence}",
        decision_ref: "decision_#{run.run_id}_fact_inventory_#{sequence}",
        tool_request_ref: "fact_inventory_request_#{run.run_id}_#{sequence}",
        tool_result_ref: tool_result_id(run, sequence),
        observation_refs: ["obs_#{run.run_id}_#{sequence}_fact_inventory"],
        state_snapshot_ref: "agent_snapshot:#{run.work_id}:#{run.run_id}:fact_inventory",
        idempotency_key: "#{run.run_id}:#{sequence}:fact_inventory:goal_v#{run.goal.version}"
      })

    step
  end

  defp frame(run, sequence, item_count) do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame_#{run.run_id}_#{sequence}",
      turn_id: inventory_turn_id(run, sequence),
      workspace_id: run.work_id,
      primary: false,
      frame_type: :execution_candidate,
      source_refs: %{author_input_ref: run.parent_turn_ref, agent_run_ref: run.run_id},
      dialogue_goal: %{summary: "从作品材料整理设定盘点提案"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{
        message: "设定盘点完成：整理出 #{item_count} 条角色、规则或伏笔提案。它们仍是待采纳草稿，请逐项确认。"
      },
      evidence_summary: %{agent_run_ref: run.run_id},
      uncertainty: []
    }
  end

  defp material_reader(%{material_reader: reader}) when is_function(reader, 1), do: reader

  defp material_reader(_spec) do
    NovelApplication.persistence_fact_inventory_material_reader() ||
      fn _work_id -> nil end
  end

  defp inventory_provider_execution(spec, snapshot) do
    (Map.get(spec, :provider_execution) || Execution.dependency(purpose: :tool))
    |> ProviderActivityProjector.with_stage_sink(snapshot, purpose: :writer)
  end

  defp planner_provider_execution(spec) do
    Map.get(spec, :planner_provider_execution) || Map.get(spec, :provider_execution)
  end

  defp inventory_done?(snapshot) do
    snapshot
    |> Map.get(:stage_state, %{})
    |> map_get(:fact_inventory)
    |> is_map()
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

  defp plan_steps(plan) when is_map(plan), do: List.wrap(map_get(plan, :steps))
  defp plan_steps(_plan), do: []

  defp artifact_refs(turn_result) do
    turn_result
    |> Map.get(:adoption_state, %{})
    |> Map.get(:pending, [])
    |> Enum.map(&map_get(&1, :artifact_id))
    |> Enum.reject(&blank?/1)
  end

  defp observation_refs(snapshot) do
    snapshot
    |> Map.get(:observations, [])
    |> Enum.map(& &1.observation_id)
  end

  defp current_step_ref(run, sequence), do: "step_#{run.run_id}_#{sequence}"
  defp inventory_turn_id(run, sequence), do: "#{run.parent_turn_ref}:agent:inventory:#{sequence}"
  defp tool_result_id(run, sequence), do: "tr_#{run.run_id}_fact_inventory_#{sequence}"

  defp stable_signature(value) do
    :crypto.hash(:sha256, :erlang.term_to_binary(value))
    |> Base.encode16(case: :lower)
  end

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_get(_map, _key), do: nil

  defp blank?(value), do: not is_binary(value) or String.trim(value) == ""
end
