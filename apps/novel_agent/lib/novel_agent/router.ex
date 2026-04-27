defmodule NovelAgent.Router do
  @moduledoc """
  Router — 识别 intent + 抽取 slots。

  Phase 0 Week 4：基于关键词 + 简单正则。
  Phase 1 改为 LLM-based slot filling。
  """

  alias NovelAgent.IntentRegistry
  alias NovelAgent.Router.Result

  @genre_keywords %{
    "玄幻" => "玄幻",
    "奇幻" => "奇幻",
    "武侠" => "武侠",
    "仙侠" => "仙侠",
    "都市" => "都市",
    "科幻" => "科幻",
    "悬疑" => "悬疑",
    "历史" => "历史",
    "言情" => "言情",
    "军事" => "军事",
    "游戏" => "游戏",
    "体育" => "体育"
  }

  @doc """
  对用户输入文本做路由。

  返回 Router.Result struct。
  """
  @spec route(String.t()) :: Result.t()
  def route(text) when is_binary(text) do
    intent_name = identify_intent(text)

    case IntentRegistry.get(intent_name) do
      nil ->
        %Result{
          intent_name: :unknown,
          extracted_slots: %{},
          missing_required_slots: [],
          needs_clarification: true
        }

      schema ->
        extracted = extract_slots(text, schema)
        missing = missing_required(schema, extracted)

        %Result{
          intent_name: intent_name,
          extracted_slots: extracted,
          missing_required_slots: missing,
          needs_clarification: missing != []
        }
    end
  end

  # ---- private ----

  defp identify_intent(text) do
    if String.contains?(text, "建") or String.contains?(text, "创建") or
         String.contains?(text, "写") or String.contains?(text, "创作") do
      :create_work_seed
    else
      :unknown
    end
  end

  defp extract_slots(text, schema) do
    all_defs = schema.required ++ schema.optional

    Enum.reduce(all_defs, %{}, fn slot_def, acc ->
      case extract_slot(text, slot_def.name) do
        nil -> acc
        value -> Map.put(acc, slot_def.name, value)
      end
    end)
  end

  defp extract_slot(text, :genre) do
    Enum.find_value(@genre_keywords, fn {keyword, genre} ->
      if String.contains?(text, keyword), do: genre
    end)
  end

  defp extract_slot(_text, _slot_name), do: nil

  defp missing_required(schema, extracted) do
    Enum.reject(schema.required, fn slot_def ->
      Map.has_key?(extracted, slot_def.name)
    end)
    |> Enum.map(& &1.name)
  end
end
