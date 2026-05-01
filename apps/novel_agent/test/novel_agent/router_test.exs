defmodule NovelAgent.RouterTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Router

  # Mock gateway that returns canned responses for testing Router logic
  # without requiring a running LLM.
  defmodule MockGateway do
    @classify_rules [
      {"建一本玄幻小说", "intent.CREATE_WORK_SEED"},
      {"创建", "intent.CREATE_WORK_SEED"},
      {"创作一本", "intent.CREATE_WORK_SEED"},
      {"写一本", "intent.CREATE_WORK_SEED"},
      {"今天天气", "unknown"},
      {"续写", "intent.CONTINUE_DRAFTING"},
      {"继续写", "intent.CONTINUE_DRAFTING"},
      {"修改一下", "intent.REVISE_DRAFT"},
      {"章节生成", "intent.DRAFT_CHAPTER"},
      {"起草一个", "intent.DRAFT_SCENE"},
      {"起草", "intent.DRAFT_SCENE"}
    ]

    @extract_patterns [
      {["genre", "玄幻"], ~s({"genre": "玄幻"})},
      {["genre", "武侠"], ~s({"genre": "武侠", "core_selling_point": "复仇", "target_reader": "成年男性"})},
      {["genre", "科幻"], ~s({"genre": "科幻"})},
      {["genre"], ~s({"genre": "未知"})},
      {["scene_boundary", "进入山谷"], ~s({"scene_boundary": "从主角进入山谷到发现洞穴"})},
      {["continuation_range", "第三章"], ~s({"continuation_range": "从第三章结尾继续"})},
      {["continuation_range"], ~s({})},
      {["revision_direction"], ~s({})},
      {["draft_ref"], ~s({})}
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
        Enum.find_value(@extract_patterns, ~s({}), fn {keywords, json} ->
          if Enum.all?(keywords, &String.contains?(prompt, &1)), do: json
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

    test "all required slots filled → no clarification" do
      result = Router.route("写一本武侠小说，核心卖点是复仇，目标读者是成年男性", MockGateway)

      assert result.intent_name == "intent.CREATE_WORK_SEED"
      assert result.extracted_slots["genre"] == "武侠"
      assert result.extracted_slots["core_selling_point"] == "复仇"
      assert result.extracted_slots["target_reader"] == "成年男性"
      assert result.needs_clarification == false
    end

    test "matches 创建 keyword + mock" do
      result = Router.route("创建一个新作品", MockGateway)
      assert result.intent_name == "intent.CREATE_WORK_SEED"
    end

    test "full fills genre + core_selling_point avoids clarification" do
      result = Router.route("创作一本复仇主题的武侠小说", MockGateway)

      assert result.intent_name == "intent.CREATE_WORK_SEED"
      refute result.needs_clarification
      assert result.extracted_slots["genre"] == "武侠"
      assert result.extracted_slots["core_selling_point"] == "复仇"
    end

    test "returns unknown for 今天天气" do
      result = Router.route("今天天气", MockGateway)

      assert result.intent_name == :unknown
      assert result.needs_clarification == true
    end

    test "returns unknown for unrecognized text" do
      result = Router.route("今天天气真好", MockGateway)
      assert result.intent_name == :unknown
      assert result.needs_clarification == true
    end

    test "routes 续写 to CONTINUE_DRAFTING with mock" do
      result = Router.route("续写，从第三章结尾继续", MockGateway)

      assert result.intent_name == "intent.CONTINUE_DRAFTING"
      assert result.extracted_slots["continuation_range"] == "从第三章结尾继续"
      assert result.needs_clarification == false
    end

    test "CONTINUE_DRAFTING missing continuation_range triggers clarification" do
      result = Router.route("继续写下去", MockGateway)

      assert result.intent_name == "intent.CONTINUE_DRAFTING"
      assert result.needs_clarification == true
    end

    test "routes 起草 to DRAFT_SCENE with scene boundary extracted" do
      result = Router.route("起草一个新的场景，场景边界是从主角进入山谷到发现洞穴", MockGateway)

      assert result.intent_name == "intent.DRAFT_SCENE"
      assert result.extracted_slots["scene_boundary"] == "从主角进入山谷到发现洞穴"
      assert result.needs_clarification == false
    end

    test "DRAFT_SCENE metadata: MEDIUM risk, no confirmation" do
      result = Router.route("起草一个场景", MockGateway)

      assert result.requires_confirmation == false
      assert result.risk_class == "MEDIUM"
    end

    test "DRAFT_CHAPTER metadata: HIGH risk, requires confirmation" do
      result = Router.route("章节生成", MockGateway)

      assert result.requires_confirmation == true
      assert result.risk_class == "HIGH"
    end

    test "REVISE_DRAFT missing revision_direction triggers clarification" do
      result = Router.route("修改一下", MockGateway)

      assert result.intent_name == "intent.REVISE_DRAFT"
      assert result.needs_clarification == true
    end
  end

  describe "extract_for_schema/3 with mock gateway" do
    test "extracts slots for a known schema without intent classification" do
      slots = Router.extract_for_schema(
        "核心卖点复仇 目标读者成年男性",
        "slot_schema.CREATE_WORK_SEED.v1",
        MockGateway
      )

      assert is_map(slots)
    end

    test "returns empty map for unknown schema_id" do
      slots = Router.extract_for_schema("some text", "nonexistent_v99", MockGateway)
      assert slots == %{}
    end
  end

  describe "route/1 with real gateway (returns :unknown without LLM)" do
    test "returns unknown when stub is the active provider" do
      result = Router.route("建一本玄幻小说")
      assert result.intent_name == :unknown
    end
  end
end
