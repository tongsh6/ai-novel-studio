defmodule NovelApplication.AgentFinalizer do
  @moduledoc """
  TurnResult 的运行事实白名单投影。运行态与身份只来自实际 AgentRun 或持久行，
  业务回应、调用方摘要和旧交付都不能预测或覆盖运行事实。
  """

  alias NovelDomain.AgentRun
  alias NovelPersistence.Schemas.AgentRunRecord

  @run_fields ~w(run_mode status phase parent_turn_ref profile_ref trigger
                 long_run_task_ref plan_ref plan_version)a

  @spec attach_run_summary(map() | nil, AgentRun.t() | AgentRunRecord.t()) :: map() | nil
  def attach_run_summary(nil, _run), do: nil

  def attach_run_summary(turn_result, %AgentRun{run_id: id} = run) when is_map(turn_result),
    do: put_summary(turn_result, run, id)

  def attach_run_summary(turn_result, %AgentRunRecord{id: id} = run) when is_map(turn_result),
    do: put_summary(turn_result, run, id)

  defp put_summary(turn_result, run, id) do
    summary = run |> Map.take(@run_fields) |> Map.put(:run_id, id)

    turn_result
    |> Map.delete("agent_run")
    |> Map.put(:agent_run, summary)
  end
end
