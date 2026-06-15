defmodule NovelDomain.WritingCoordinateTest do
  use ExUnit.Case, async: true

  alias NovelDomain.WritingCoordinate

  describe "derive/1 authoring_mode 归一" do
    test "首稿：prose_writing + intent none → :first_draft（target_unit :chapter）" do
      c = WritingCoordinate.derive(%{capability: "prose_writing", authoring_intent: :none})
      assert c.authoring_mode == :first_draft
      assert c.target_unit == :chapter
    end

    test "续写：prose_writing + intent continuation → :continuation" do
      c =
        WritingCoordinate.derive(%{capability: "prose_writing", authoring_intent: :continuation})

      assert c.authoring_mode == :continuation
      assert c.target_unit == :chapter
    end

    test "重写：prose_writing + intent rewrite → :rewrite" do
      c = WritingCoordinate.derive(%{capability: "prose_writing", authoring_intent: :rewrite})
      assert c.authoring_mode == :rewrite
    end

    test "规划：plot_outline → :planning（target_unit :work）" do
      c = WritingCoordinate.derive(%{capability: "plot_outline", authoring_intent: :none})
      assert c.authoring_mode == :planning
      assert c.target_unit == :work
    end

    test "其它能力（character_design）→ :none（无 target_unit）" do
      c = WritingCoordinate.derive(%{capability: "character_design", authoring_intent: :none})
      assert c.authoring_mode == :none
      assert c.target_unit == nil
    end
  end

  describe "derive/1 字段归一与透传" do
    test "requested/matched chapter 去空白；source ref 透传" do
      c =
        WritingCoordinate.derive(%{
          capability: "prose_writing",
          authoring_intent: :continuation,
          requested_chapter: " 第三章 ",
          matched_chapter: "  第03章：xxx  ",
          work_ref: "work_1",
          source_turn_ref: "turn_9"
        })

      assert c.requested_chapter == "第三章"
      assert c.matched_chapter == "第03章：xxx"
      assert c.work_ref == "work_1"
      assert c.source_turn_ref == "turn_9"
    end

    test "缺失/非字符串章节归一为空串" do
      c = WritingCoordinate.derive(%{capability: "prose_writing", authoring_intent: :none})
      assert c.requested_chapter == ""
      assert c.matched_chapter == ""
    end
  end
end
