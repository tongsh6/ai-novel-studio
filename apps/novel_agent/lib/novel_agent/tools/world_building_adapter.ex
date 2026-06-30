defmodule NovelAgent.Tools.WorldBuildingAdapter do
  @moduledoc false

  alias NovelAgent.CreativeProvider.Real
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Tools.CreativeToolAdapter
  alias NovelCommon.Contracts.ToolRequest

  @spec execute(ToolRequest.t(), Execution.dependency()) ::
          NovelCommon.Contracts.ToolResult.t()
  def execute(%ToolRequest{} = req, provider_execution),
    do: CreativeToolAdapter.execute(req, artifact_type(req), provider_execution, Real)

  defp artifact_type(%ToolRequest{input: input}) when is_map(input) do
    text =
      [
        Map.get(input, "artifact_type"),
        Map.get(input, :artifact_type),
        Map.get(input, "creative_brief"),
        Map.get(input, :creative_brief),
        Map.get(input, "text"),
        Map.get(input, :text)
      ]
      |> Enum.reject(&is_nil/1)
      |> Enum.map_join("\n", &to_string/1)

    cond do
      contains_any?(text, ["伏笔", "悬念", "线索", "回收"]) ->
        :foreshadowing_seed

      contains_any?(text, ["风格规则", "写作规则", "文风", "语气", "推荐写法"]) ->
        :style_rule_seed

      contains_any?(text, ["约束", "限制", "禁止", "不得", "禁忌"]) ->
        :constraint_seed

      contains_any?(text, ["规则", "规则体系", "世界规则"]) ->
        :world_rule_seed

      true ->
        :world_setting
    end
  end

  defp artifact_type(_req), do: :world_setting

  defp contains_any?(text, terms) do
    Enum.any?(terms, &String.contains?(text, &1))
  end
end
