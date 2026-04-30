defmodule NovelAgent.RouterTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Router

  # Mock gateway that returns canned responses for testing Router logic
  # without requiring a running LLM.
  defmodule MockGateway do
    @classify_rules [
      {"建一本玄幻小说", "intent.CREATE_WORK_SEED"},
      {"创建", "intent.CREATE_WORK_SEED"},
      {"今天天气", "unknown"},
      {"续写", "intent.CONTINUE_DRAFTING"},
      {"修改一下", "intent.REVISE_DRAFT"},
      {"章节", "intent.DRAFT_CHAPTER"},
      {"起草一个", "intent.DRAFT_SCENE"},
      {"写一本", "intent.CREATE_WORK_SEED"},
      {"继续写", "intent.CONTINUE_DRAFTING"}
    ]

    @extract_rules [
      {fn p -> String.contains?(p, "genre") and String.contains?(p, "玄幻") end,
       ~s({"genre": "玄幻"})},
      {fn p -> String.contains?(p, "genre") and String.contains?(p, "武侠") end,
       ~s({"genre": "武侠", "core_selling_point": "复仇", "target_reader": "成年男性"})},
      {fn p -> String.contains?(p, "genre") and String.contains?(p, "科幻") end,
       ~s({"genre": "科幻"})},
      {fn p -> String.contains?(p, "genre") end, ~s({"genre": "未知"})},
      {fn p ->
         String.contains?(p, "scene_boundary") and String.contains?(p, "进入山谷")
       end, ~s({"scene_boundary": "从主角进入山谷到发现洞穴"})},
      {fn p ->
         String.contains?(p, "continuation_range") and String.contains?(p, "第三章")
       end, ~s({"continuation_range": "从第三章结尾继续"})},
      {fn p -> String.contains?(p, "continuation_range") end, ~s({})},
      {fn p -> String.contains?(p, "revision_direction") end, ~s({})},
      {fn p -> String.contains?(p, "draft_ref") end, ~s({})}
    ]

    def complete(prompt) do
      cond do
        String.contains?(prompt, "判断其意图") -> wrap(classify(prompt))
        String.contains?(prompt, "提取以下 slot") -> wrap(extract(prompt))
        true -> {:ok, %{content: "{}"}}
      end
    end

    defp wrap({:ok, content}), do: {:ok, %{content: content}}

    defp classify(prompt) do
      result =
        Enum.find_value(@classify_rules, "unknown", fn {key, intent} ->
          if String.contains?(prompt, key), do: intent
        end)

      {:ok, result}
    end

    defp extract(prompt) do
      result =
        Enum.find_value(@extract_rules, ~s({}), fn {match_fn, json} ->
          if match_fn.(prompt), do: json
        end)

      {:ok, result}
    end
  end

  describe "route/2 with mock gateway" do
    test "classifies and extracts genre from 建一本玄幻小说" do
      result = Router.route("建一本玄幻小说", MockGateway)

      assert result.intent_name == "intent.CREATE_WORK_SEED"
      assert result.schema_id == "slot_schema.CREATE_WORK_SEED.v1"
      assert result.extracted_slots["genre"] == "玄幻"
      assert "core_selling_point" in result.missing_required_slots
      assert result.needs_clarification == true
    end

    test "returns unknown for 今天天气" do
      result = Router.route("今天天气", MockGateway)

      assert result.intent_name == "unknown"
      assert result.needs_clarification == true
      assert result.clarification_card_type == "intent_not_understood"
    end

    test "full fills genre + core_selling_point avoids clarification" do
      result = Router.route("创作一本复仇主题的武侠小说", MockGateway)

      assert result.intent_name == "intent.CREATE_WORK_SEED"
      refute result.needs_clarification
      assert result.extracted_slots["genre"] == "武侠"
      assert result.extracted_slots["core_selling_point"] == "复仇"
    end
  end
end
