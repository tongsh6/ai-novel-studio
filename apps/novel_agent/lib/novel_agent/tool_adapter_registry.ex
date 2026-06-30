defmodule NovelAgent.ToolAdapterRegistry do
  @moduledoc """
  Agent-side adapter registry for dispatchable tools.
  """

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Tools.CharacterDesignAdapter
  alias NovelAgent.Tools.CharacterEvolutionAdapter
  alias NovelAgent.Tools.CharacterRosterAdapter
  alias NovelAgent.Tools.PlotOutlineAdapter
  alias NovelAgent.Tools.ProseWritingAdapter
  alias NovelAgent.Tools.TextAnalysisAdapter
  alias NovelAgent.Tools.WorldBuildingAdapter

  @spec adapter_for(String.t()) :: module() | nil
  def adapter_for("text_analysis"), do: TextAnalysisAdapter
  def adapter_for("character_roster"), do: CharacterRosterAdapter
  def adapter_for("character_design"), do: CharacterDesignAdapter
  def adapter_for("character_evolution"), do: CharacterEvolutionAdapter
  def adapter_for("plot_outline"), do: PlotOutlineAdapter
  def adapter_for("prose_writing"), do: ProseWritingAdapter
  def adapter_for("world_building"), do: WorldBuildingAdapter
  def adapter_for(_tool_name), do: nil

  @spec execute(String.t(), NovelCommon.Contracts.ToolRequest.t(), Execution.dependency()) ::
          NovelCommon.Contracts.ToolResult.t()
  def execute("text_analysis", req, provider_execution),
    do: TextAnalysisAdapter.execute(req, provider_execution)

  def execute("character_roster", req, provider_execution),
    do: CharacterRosterAdapter.execute(req, provider_execution)

  def execute("character_design", req, provider_execution),
    do: CharacterDesignAdapter.execute(req, provider_execution)

  def execute("character_evolution", req, provider_execution),
    do: CharacterEvolutionAdapter.execute(req, provider_execution)

  def execute("plot_outline", req, provider_execution),
    do: PlotOutlineAdapter.execute(req, provider_execution)

  def execute("prose_writing", req, provider_execution),
    do: ProseWritingAdapter.execute(req, provider_execution)

  def execute("world_building", req, provider_execution),
    do: WorldBuildingAdapter.execute(req, provider_execution)
end
