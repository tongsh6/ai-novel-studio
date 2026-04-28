defmodule NovelAgent.Router do
  @moduledoc """
  Router — 识别 intent + 抽取 slots。

  Phase 0 Week 4：基于关键词 + 简单正则。
  Phase 1：LLM-based slot filling（当前仍为关键词版）。
  Phase 1 ADR-0010：slot schema 升级为完整 envelope（9 字段 slot entry）。
  """

  alias NovelAgent.IntentRegistry
  alias NovelAgent.IntentRegistry.SlotSchema
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

  @doc "对用户输入文本做路由。返回 Router.Result struct。"
  @spec route(String.t()) :: Result.t()
  def route(text) when is_binary(text) do
    intent_name = identify_intent(text)

    case IntentRegistry.get(intent_name) do
      nil ->
        %Result{
          intent_name: :unknown,
          schema_id: nil,
          extracted_slots: %{},
          missing_required_slots: [],
          needs_clarification: true,
          deferred_to_runtime: []
        }

      schema ->
        extracted = extract_slots(text, schema)
        missing = missing_blocking(schema, extracted)

        %Result{
          intent_name: schema.intent_name,
          schema_id: schema.schema_id,
          extracted_slots: extracted,
          missing_required_slots: missing,
          needs_clarification: missing != [],
          deferred_to_runtime: schema.deferred_to_runtime
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

  defp extract_slots(text, %SlotSchema{} = schema) do
    Enum.reduce(schema.slots, %{}, fn slot_entry, acc ->
      name = slot_entry.slot_name

      case extract_slot(text, name) do
        nil -> acc
        value -> Map.put(acc, name, value)
      end
    end)
  end

  defp extract_slot(text, "genre") do
    Enum.find_value(@genre_keywords, fn {keyword, genre} ->
      if String.contains?(text, keyword), do: genre
    end)
  end

  defp extract_slot(_text, _slot_name), do: nil

  # Only slots that are required_to_execute AND not_inferable AND no_default
  # are "blocking" — if any are missing, clarification must trigger.
  defp missing_blocking(%SlotSchema{} = schema, extracted) do
    schema
    |> SlotSchema.blocking_slots()
    |> Enum.reject(&Map.has_key?(extracted, &1))
  end
end
