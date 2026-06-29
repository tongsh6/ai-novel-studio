defmodule NovelApplication.AgentFinalizer do
  @moduledoc """
  Final TurnResult shaping for bounded AgentRun completion.
  """

  @spec attach_run_summary(map(), map()) :: map()
  def attach_run_summary(turn_result, summary) when is_map(turn_result) and is_map(summary) do
    Map.put(turn_result, :agent_run, summary)
  end
end
