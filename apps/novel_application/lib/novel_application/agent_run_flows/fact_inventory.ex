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
      missing_skeleton_fields = skeleton_reader(spec).(run.work_id)

      with [_ | _] = materials <- material_reader(spec).(run.work_id),
           {:ok, proposal, proposal_meta} <-
             FactInventoryService.inventory_with_meta(
               materials,
               inventory_provider_execution(spec, snapshot),
               missing_skeleton_fields: missing_skeleton_fields,
               known_characters: known_characters(spec, run),
               unresolved_foreshadows: unresolved_foreshadows(spec, run)
             ),
           proposal = filter_skeleton_suggestions(proposal, missing_skeleton_fields),
           assumption_result = materialize_protagonist_assumption(spec, run, proposal),
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
          build_turn_result(run, sequence, materials, artifact_sets, assumption_result)
          |> AgentFinalizer.attach_run_summary(%{
            run_id: run.run_id,
            run_mode: run.run_mode,
            parent_turn_ref: run.parent_turn_ref,
            profile_ref: run.profile_ref,
            status: :completed
          })

        refs = artifact_refs(turn_result)

        summary =
          artifact_sets
          |> inventory_summary(refs)
          |> Map.put(:assumption, assumption_result)

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

  # VS-00G CP5b（OQ2 required 自动放行）：主角是 required 事实——盘点提炼出
  # PROTAGONIST 候选且写端口在场时，物化为 tentative Character（AI_ASSUMPTION+
  # provisional_active）。守卫（canon 在场/同名跳过）集中在持久层；物化失败绝不
  # 阻断盘点主链（档案提案链不受影响）。
  defp materialize_protagonist_assumption(spec, run, proposal) do
    writer = assumption_writer(spec)

    protagonist =
      proposal
      |> Map.get(:characters, [])
      |> Enum.find(&(map_get(&1, :narrative_role) == "PROTAGONIST"))

    cond do
      is_nil(writer) ->
        :writer_missing

      is_nil(protagonist) ->
        :no_protagonist_candidate

      true ->
        try do
          case writer.(%{
                 work_id: run.work_id,
                 name: to_string(map_get(protagonist, :title)),
                 summary: map_get(protagonist, :body),
                 narrative_role: map_get(protagonist, :narrative_role),
                 role: map_get(protagonist, :role),
                 aliases: map_get(protagonist, :aliases)
               }) do
            {:ok, skipped} when is_atom(skipped) -> skipped
            {:ok, _character} -> :activated
            {:error, _reason} -> :materialize_failed
          end
        rescue
          _error -> :materialize_failed
        catch
          _kind, _reason -> :materialize_failed
        end
    end
  end

  defp assumption_writer(%{assumption_writer: writer}) when is_function(writer, 1), do: writer

  defp assumption_writer(_spec),
    do: NovelApplication.persistence_assumption_character_writer()

  defp build_turn_result(run, sequence, materials, artifact_sets, assumption_result) do
    items = Enum.flat_map(artifact_sets, & &1.items)
    frame = frame(run, sequence, length(items), assumption_result)

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

  defp frame(run, sequence, item_count, assumption_result) do
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
        message:
          "设定盘点完成：整理出 #{item_count} 条设定与规划提案。它们仍是待采纳草稿，请逐项确认。" <>
            assumption_notice(assumption_result)
      },
      evidence_summary: %{agent_run_ref: run.run_id},
      uncertainty: []
    }
  end

  # OQ2 即时通知（防护①作者侧）：required 假定自动激活时明示告知与裁决入口。
  defp assumption_notice(:activated),
    do: "另外，我已把盘点出的主角列为【暂定】设定并开始参考；你可以在作品档案的暂定设定区确认或否决。"

  defp assumption_notice(_other), do: ""

  # 已在档角色（M4 实锤）：盘点是补全缺口，已登记角色不该被当新发现重提。
  # 读端口缺席/失败降级为空（盘点照常，重复由采纳边界的同名确认兜底）。
  defp known_characters(spec, run) do
    reader =
      Map.get(spec, :character_reader) || NovelApplication.persistence_character_reader()

    if is_function(reader, 1) do
      try do
        run.work_id
        |> reader.()
        |> Enum.flat_map(fn character ->
          # AU12 CP2 别名后门：名单必须含别名，否则「洛公子」类提案在 prompt 侧
          # 就被当成新发现（采纳边界的别名命中确认是第二道门，不是第一道）。
          name = Map.get(character, :name) || Map.get(character, "name")
          aliases = Map.get(character, :aliases) || Map.get(character, "aliases") || []
          [name | List.wrap(aliases)]
        end)
        |> Enum.filter(&is_binary/1)
      rescue
        _error -> []
      catch
        _kind, _reason -> []
      end
    else
      []
    end
  end

  # 未回收伏笔清单（VS00F 刀④ CP3）：账面 HIDDEN 伏笔条目进盘点核对段，回收
  # 提案身份锚定账面 ref。读端口缺席/失败降级为空（盘点照常，回收核对不出现）。
  defp unresolved_foreshadows(spec, run) do
    reader = Map.get(spec, :ledger_reader) || NovelApplication.persistence_ledger_reader()

    if is_function(reader, 1) do
      try do
        run.work_id
        |> reader.()
        |> Enum.filter(fn entry ->
          map_get(entry, :ledger) == "information" and map_get(entry, :status) == "HIDDEN" and
            String.starts_with?(to_string(map_get(entry, :subject_ref)), "foreshadow_")
        end)
        |> Enum.map(fn entry ->
          %{
            ref: to_string(map_get(entry, :subject_ref)),
            label: to_string(map_get(entry, :subject_label))
          }
        end)
      rescue
        _error -> []
      catch
        _kind, _reason -> []
      end
    else
      []
    end
  end

  defp material_reader(%{material_reader: reader}) when is_function(reader, 1), do: reader

  defp material_reader(_spec) do
    NovelApplication.persistence_fact_inventory_material_reader() ||
      fn _work_id -> nil end
  end

  # VS-00G CP4d：全书规划缺位读端口（可注入）。默认读 works 立项字段；只对缺位
  # 字段请求建议，作者已立值不重复建议。读取失败降级为 []（骨架建议诚实缺席，
  # 档案提案链不受影响），不让盘点 run 因骨架读取死掉。
  defp skeleton_reader(%{skeleton_reader: reader}) when is_function(reader, 1), do: reader

  defp skeleton_reader(_spec) do
    fn work_id ->
      try do
        NovelApplication.WorkService.missing_skeleton_fields(work_id)
      rescue
        _error -> []
      catch
        _kind, _reason -> []
      end
    end
  end

  # 双保险：即使模型对非缺位字段越权产建议，也在提案层按缺位集合筛除（选择不改写）。
  defp filter_skeleton_suggestions(proposal, missing_fields) do
    Map.update(proposal, :skeleton_suggestions, [], fn suggestions ->
      Enum.filter(suggestions, &(map_get(&1, :skeleton_field) in missing_fields))
    end)
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
