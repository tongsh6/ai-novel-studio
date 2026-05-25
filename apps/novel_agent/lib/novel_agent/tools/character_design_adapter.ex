defmodule NovelAgent.Tools.CharacterDesignAdapter do
  @moduledoc false

  alias NovelAgent.CreativeProvider.Real
  alias NovelAgent.Tools.CreativeToolAdapter
  alias NovelCommon.Contracts.ToolRequest

  @spec execute(ToolRequest.t(), (String.t() -> tuple()) | nil) ::
          NovelCommon.Contracts.ToolResult.t()
  def execute(%ToolRequest{} = req, complete_fn),
    do: CreativeToolAdapter.execute(req, :character_seed, complete_fn, Real)
end
