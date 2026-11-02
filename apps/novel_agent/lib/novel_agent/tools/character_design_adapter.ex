defmodule NovelAgent.Tools.CharacterDesignAdapter do
  @moduledoc false

  alias NovelAgent.CreativeProvider.Real
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Tools.CreativeToolAdapter
  alias NovelCommon.Contracts.ToolRequest

  @spec execute_with_session(ToolRequest.t(), Execution.dependency(), keyword()) ::
          {NovelCommon.Contracts.ToolResult.t(), map()}
  def execute_with_session(%ToolRequest{} = req, provider_execution, opts \\ []),
    do:
      CreativeToolAdapter.execute_with_session(
        req,
        :character_seed,
        provider_execution,
        Real,
        opts
      )

  @spec execute(ToolRequest.t(), Execution.dependency()) ::
          NovelCommon.Contracts.ToolResult.t()
  def execute(%ToolRequest{} = req, provider_execution),
    do: CreativeToolAdapter.execute(req, :character_seed, provider_execution, Real)
end
