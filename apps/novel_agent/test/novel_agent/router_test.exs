defmodule NovelAgent.RouterTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Router

  describe "route/1 with create_work_seed" do
    test "identifies intent and extracts genre slot" do
      result = Router.route("建一本玄幻小说")

      assert result.intent_name == :create_work_seed
      assert result.extracted_slots[:genre] == "玄幻"
      assert :core_selling_point in result.missing_required_slots
      assert :target_reader in result.missing_required_slots
      assert result.needs_clarification == true
    end

    test "with all required slots filled" do
      result = Router.route("写一本武侠小说，核心卖点是复仇，目标读者是成年男性")

      assert result.intent_name == :create_work_seed
      assert result.extracted_slots[:genre] == "武侠"
      # core_selling_point and target_reader can't be extracted by Phase 0 heuristics
      assert result.needs_clarification == true
    end

    test "matches 创建 keyword" do
      result = Router.route("创建一部科幻作品")
      assert result.intent_name == :create_work_seed
    end
  end

  describe "route/1 with unknown intent" do
    test "returns unknown for unrecognized text" do
      result = Router.route("今天天气真好")
      assert result.intent_name == :unknown
    end
  end
end
