defmodule NovelAgent.Tools.CharacterEvolutionAdapter do
  @moduledoc """
  AU-09 角色演化记忆：更新已有角色的演化/当前状态/关系变化。

  产出 `character_evolution_seed` 待采纳草稿；采纳后写**角色记忆**
  （CHARACTER_PROFILE/CURRENT_STATE/RELATIONSHIP），区别于 `character_design`
  写 Character 主档案。见 `06-memory-context-and-trace.md §4.5`。
  """

  alias NovelAgent.CreativeProvider.Real
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Tools.CreativeToolAdapter
  alias NovelCommon.Contracts.ToolRequest

  @spec execute(ToolRequest.t(), Execution.dependency()) ::
          NovelCommon.Contracts.ToolResult.t()
  def execute(%ToolRequest{} = req, provider_execution),
    do: CreativeToolAdapter.execute(req, :character_evolution_seed, provider_execution, Real)
end
