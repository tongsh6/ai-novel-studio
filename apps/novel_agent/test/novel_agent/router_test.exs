defmodule NovelAgent.RouterTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Router

  # Mock gateway that returns canned responses for testing Router logic
  # without requiring a running LLM.
  defmodule MockGateway do
    def complete(prompt) do
      cond do
        # Classification prompts
        String.contains?(prompt, "判断其意图") ->
          classify(prompt)

        # Slot extraction prompts
        String.contains?(prompt, "提取以下 slot") ->
          extract(prompt)

        true ->
          {:ok, "{}"}
      end
    end

    defp classify(prompt) do
      cond do
        String.contains?(prompt, "建一本玄幻小说") -> {:ok, "intent.CREATE_WORK_SEED"}
        String.contains?(prompt, "创建") -> {:ok, "intent.CREATE_WORK_SEED"}
        String.contains?(prompt, "今天天气") -> {:ok, "unknown"}
        String.contains?(prompt, "续写") -> {:ok, "intent.CONTINUE_DRAFTING"}
        String.contains?(prompt, "修改一下") -> {:ok, "intent.REVISE_DRAFT"}
        String.contains?(prompt, "章节") -> {:ok, "intent.DRAFT_CHAPTER"}
        String.contains?(prompt, "起草一个") -> {:ok, "intent.DRAFT_SCENE"}
        String.contains?(prompt, "写一本") -> {:ok, "intent.CREATE_WORK_SEED"}
        String.contains?(prompt, "继续写") -> {:ok, "intent.CONTINUE_DRAFTING"}
        true -> {:ok, "unknown"}
      end
    end

    defp extract(prompt) do
      cond do
        # CREATE_WORK_SEED slot extraction
        String.contains?(prompt, "genre") and String.contains?(prompt, "玄幻") ->
          {:ok, ~s({"genre": "玄幻"})}

        String.contains?(prompt, "genre") and String.contains?(prompt, "武侠") ->
          {:ok, ~s({"genre": "武侠", "core_selling_point": "复仇", "target_reader": "成年男性"})}

        String.contains?(prompt, "genre") and String.contains?(prompt, "科幻") ->
          {:ok, ~s({"genre": "科幻"})}

        String.contains?(prompt, "genre") ->
          {:ok, ~s({"genre": "未知"})}

        # DRAFT_SCENE with scene_boundary
        String.contains?(prompt, "scene_boundary") and String.contains?(prompt, "进入山谷") ->
          {:ok, ~s({"scene_boundary": "从主角进入山谷到发现洞穴"})}

        # CONTINUE_DRAFTING with continuation_range
        String.contains?(prompt, "continuation_range") and String.contains?(prompt, "第三章") ->
          {:ok, ~s({"continuation_range": "从第三章结尾继续"})}

        # CONTINUE_DRAFTING without enough info
        String.contains?(prompt, "continuation_range") ->
          {:ok, ~s({})}

        # REVISE_DRAFT without revision_direction
        String.contains?(prompt, "revision_direction") ->
          {:ok, ~s({})}

        String.contains?(prompt, "draft_ref") ->
          {:ok, ~s({})}

        true ->
          {:ok, ~s({})}
      end
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
      result = Router.route("创建一部科幻作品", MockGateway)
      assert result.intent_name == "intent.CREATE_WORK_SEED"
    end

    test "deferred_to_runtime is propagated" do
      result = Router.route("建一本玄幻小说", MockGateway)
      assert "capability_mapping" in result.deferred_to_runtime
      assert "prompt" in result.deferred_to_runtime
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

  describe "route/1 with real gateway (returns :unknown without LLM)" do
    test "returns unknown when stub is the active provider" do
      result = Router.route("建一本玄幻小说")
      assert result.intent_name == :unknown
    end
  end
end
