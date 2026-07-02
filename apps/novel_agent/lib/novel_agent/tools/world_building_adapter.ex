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
    explicit_artifact_type = first_present(input, ["artifact_type", :artifact_type])
    author_goal_text = first_present(input, ["author_goal_text", :author_goal_text])

    case artifact_type_ref(explicit_artifact_type) do
      nil ->
        author_goal_text
        |> intent_text_or_fallback(input)
        |> artifact_type_from_text()

      type ->
        type
    end
  end

  defp artifact_type(_req), do: :world_setting

  defp artifact_type_ref("foreshadowing_seed"), do: :foreshadowing_seed
  defp artifact_type_ref("world_rule_seed"), do: :world_rule_seed
  defp artifact_type_ref("style_rule_seed"), do: :style_rule_seed
  defp artifact_type_ref("constraint_seed"), do: :constraint_seed
  defp artifact_type_ref("world_setting"), do: :world_setting
  defp artifact_type_ref(_type), do: nil

  defp intent_text_or_fallback(text, _input) when is_binary(text) and text != "", do: text
  defp intent_text_or_fallback(_text, input), do: fallback_intent_text(input)

  defp artifact_type_from_text(text) do
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

  defp fallback_intent_text(input) do
    [
      Map.get(input, "creative_brief"),
      Map.get(input, :creative_brief),
      Map.get(input, "text"),
      Map.get(input, :text)
    ]
    |> Enum.reject(&is_nil/1)
    |> Enum.map_join("\n", &to_string/1)
  end

  defp first_present(input, keys) do
    case keys |> Enum.map(&Map.get(input, &1)) |> Enum.find(&present?/1) do
      nil -> ""
      value -> to_string(value)
    end
  end

  defp present?(value), do: is_binary(value) and String.trim(value) != ""

  defp contains_any?(text, terms) do
    Enum.any?(terms, &String.contains?(text, &1))
  end
end
