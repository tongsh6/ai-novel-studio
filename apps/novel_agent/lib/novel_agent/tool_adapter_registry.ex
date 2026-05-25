defmodule NovelAgent.ToolAdapterRegistry do
  @moduledoc """
  Agent-side adapter registry for dispatchable tools.
  """

  alias NovelAgent.Tools.CharacterDesignAdapter
  alias NovelAgent.Tools.PlotOutlineAdapter
  alias NovelAgent.Tools.ProseWritingAdapter
  alias NovelAgent.Tools.TextAnalysisAdapter
  alias NovelAgent.Tools.WorldBuildingAdapter

  @spec adapter_for(String.t()) :: module() | nil
  def adapter_for("text_analysis"), do: TextAnalysisAdapter
  def adapter_for("character_design"), do: CharacterDesignAdapter
  def adapter_for("plot_outline"), do: PlotOutlineAdapter
  def adapter_for("prose_writing"), do: ProseWritingAdapter
  def adapter_for("world_building"), do: WorldBuildingAdapter
  def adapter_for(_tool_name), do: nil

  def execute("text_analysis", req, complete_fn),
    do: TextAnalysisAdapter.execute(req, complete_fn)

  def execute("character_design", req, complete_fn),
    do: CharacterDesignAdapter.execute(req, complete_fn)

  def execute("plot_outline", req, complete_fn),
    do: PlotOutlineAdapter.execute(req, complete_fn)

  def execute("prose_writing", req, complete_fn),
    do: ProseWritingAdapter.execute(req, complete_fn)

  def execute("world_building", req, complete_fn),
    do: WorldBuildingAdapter.execute(req, complete_fn)
end
