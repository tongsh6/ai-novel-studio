defmodule NovelApplication.AgentRunFlows.MechanicalPlan do
  @moduledoc """
  B27 CP3c / D2：固定单步维护 profile 的机械计划。

  `fact_inventory_v1` / `ledger_reconciliation_v1` 等维护 run 的业务目标与步骤由代码
  固定，模型「计划起草」不产生信息增量，却使机械维护被模型可用性绑定（审计 C7）。
  这里直接构造与真实 step 执行/门禁同形的计划：0 provider 调用、不发 plan_drafted
  模型事件，步骤仍经 `AgentRunServer` 的预算/门禁/step 投影。
  """

  @type plan :: %{
          plan_id: String.t(),
          run_ref: String.t(),
          version: pos_integer(),
          goal_version: pos_integer(),
          steps: [map()]
        }

  @doc "run 上已有可用的机械计划（steps 非空且 target 全部匹配）时直接复用。"
  @spec ready?(term(), String.t()) :: boolean()
  def ready?(plan, target) when is_map(plan) do
    case map_get(plan, :steps) do
      [_ | _] = steps -> Enum.all?(steps, &(map_get(&1, :target_tool_ref) == target))
      _ -> false
    end
  end

  def ready?(_plan, _target), do: false

  @doc """
  构造机械计划。`steps` 为 `[{step_id, target_tool_ref, description, success_criteria}]`。
  """
  @spec for_run(struct(), [map()]) :: plan()
  def for_run(%{run_id: run_id} = run, steps) when is_list(steps) do
    plan = Map.get(run, :plan)

    %{
      plan_id: map_get(plan, :plan_id) || "ap_#{run_id}",
      run_ref: run_id,
      version: plan_version(plan),
      goal_version: run.goal.version,
      steps: Enum.map(steps, &normalize_step/1)
    }
  end

  defp normalize_step(step) do
    %{
      step_id: map_get(step, :step_id),
      kind: map_get(step, :kind) || :act,
      status: :pending,
      description: map_get(step, :description) || "",
      success_criteria: List.wrap(map_get(step, :success_criteria)),
      depends_on: List.wrap(map_get(step, :depends_on)),
      target_tool_ref: map_get(step, :target_tool_ref),
      write_intent: map_get(step, :write_intent) || :tentative,
      risk_hint: map_get(step, :risk_hint) || :low
    }
  end

  defp plan_version(plan) when is_map(plan) do
    case map_get(plan, :version) do
      version when is_integer(version) and version > 0 -> version
      _ -> 1
    end
  end

  defp plan_version(_plan), do: 1

  defp map_get(map, key) when is_map(map) do
    Map.get(map, key, Map.get(map, Atom.to_string(key)))
  end

  defp map_get(_map, _key), do: nil
end
