defmodule NovelApplication.AgentRunState do
  @moduledoc """
  既有 AgentRunState wire 的纯事实投影，供实时 Channel 与持久 activity 查询共用。

  输入必须是调用方已核验归属的实际 AgentRun 或持久记录。本模块不查询、不写入，
  不赋予 runtime_live 或命令权限；TurnResult 关联摘要仍由 AgentFinalizer 负责。
  """

  alias NovelDomain.AgentRun
  alias NovelPersistence.Schemas.AgentRunRecord

  @fields ~w(run_mode status phase long_run_task_ref workspace_id work_id session_id
             parent_turn_ref origin_frame_ref profile_ref trigger goal plan_ref plan_version
             current_step_ref completed_step_refs pending_artifact_refs interrupt_state
             budget consumed_budget)a
  @optional_maps ~w(goal interrupt_state budget consumed_budget)a

  @spec project(AgentRun.t() | AgentRunRecord.t()) :: map()
  def project(%AgentRun{run_id: id} = run), do: project_run(run, id)
  def project(%AgentRunRecord{id: id} = run), do: project_run(run, id)

  defp project_run(run, id) do
    run
    |> Map.take(@fields)
    |> Enum.reject(fn {key, value} -> key in @optional_maps and is_nil(value) end)
    |> Map.new()
    |> stringify_atom_values()
    |> Map.put(:run_id, id)
    |> Map.put(:current_activity, current_activity(run))
  end

  defp current_activity(run) do
    completed_steps = length(run.completed_step_refs || [])
    trigger = run.trigger || %{}
    action_type = Map.get(trigger, :action_type) || Map.get(trigger, "action_type")

    %{
      kind:
        if(action_type == "revise_from_findings",
          do: "revision_draft_generation",
          else: "agent_run_execution"
        ),
      phase: activity_phase(run),
      completed_steps: completed_steps,
      total_steps: max(plan_step_count(run.plan), completed_steps)
    }
  end

  defp plan_step_count(%{steps: steps}) when is_list(steps), do: length(steps)
  defp plan_step_count(%{"steps" => steps}) when is_list(steps), do: length(steps)
  defp plan_step_count(_plan), do: 0

  defp activity_phase(run) do
    cond do
      to_string(run.status) in ["completed", "cancelled", "failed"] -> "finalizing"
      to_string(run.phase) == "planning" -> "preparing"
      to_string(run.phase) == "finalizing" -> "finalizing"
      true -> "generating"
    end
  end

  defp stringify_atom_values(value) when is_map(value),
    do: Map.new(value, fn {key, item} -> {key, stringify_atom_values(item)} end)

  defp stringify_atom_values(value) when is_list(value),
    do: Enum.map(value, &stringify_atom_values/1)

  defp stringify_atom_values(value) when is_boolean(value), do: value
  defp stringify_atom_values(nil), do: nil
  defp stringify_atom_values(value) when is_atom(value), do: Atom.to_string(value)
  defp stringify_atom_values(value), do: value
end
