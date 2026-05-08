defmodule NovelApplication.PlannerBoundary do
  @moduledoc """
  PlannerOutput Boundary — 在 OrchestratorDecision 形成前验证 Planner 输出。

  VS-01: validates that Planner output doesn't contain execution approval semantics.
  """

  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan

  @doc """
  Validate that Planner output is a suggestion, not an execution order.

  Returns :ok or {:error, reason}.
  """
  @spec validate(DialogueFrame.t(), MicroPlan.t()) :: :ok | {:error, String.t()}
  def validate(%DialogueFrame{} = frame, %MicroPlan{} = plan) do
    with :ok <- check_frame_ref(frame, plan),
         :ok <- MicroPlan.check_forbidden(plan) do
      check_stop_after_next(plan)
    end
  end

  defp check_frame_ref(frame, plan) do
    if plan.frame_ref == frame.frame_id do
      :ok
    else
      {:error, "MicroPlan frame_ref (#{plan.frame_ref}) does not match DialogueFrame (#{frame.frame_id})"}
    end
  end

  defp check_stop_after_next(plan) do
    if plan.stop_after_next_action do
      :ok
    else
      {:error, "MicroPlan must have stop_after_next_action: true"}
    end
  end
end
