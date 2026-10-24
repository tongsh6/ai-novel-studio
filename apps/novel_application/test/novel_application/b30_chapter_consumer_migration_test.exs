defmodule NovelApplication.B30ChapterConsumerMigrationTest do
  use ExUnit.Case, async: true

  alias NovelApplication.{ChapterDisplay, ChapterListBudget, TurnExecutionService}
  alias NovelDomain.DialogueContext

  @ch1 %{id: "aaaa1111-1111-1111-1111-111111111111", seq: 1, title: "第01章：初夜"}
  @ch2 %{id: "bbbb2222-2222-2222-2222-222222222222", seq: 2, title: "第11章：外门名册上的空白"}
  @ch3 %{id: "cccc3333-3333-3333-3333-333333333333", seq: 3, title: "第12章：旧钱与旧名"}

  test "展示口径：身份=ref，章号=当前 seq，title 历史编号前缀不参与展示" do
    assert ChapterDisplay.core_title("第11章：外门名册上的空白") == "外门名册上的空白"
    assert ChapterDisplay.core_title("外门名册上的空白") == "外门名册上的空白"
    assert ChapterDisplay.core_title("第 2 回：旧钱") == "旧钱"

    assert ChapterDisplay.display_title(@ch2) == "第2章：外门名册上的空白"
    assert ChapterDisplay.display_title(%{title: "无编号标题", seq: nil}) == "无编号标题"

    assert ChapterDisplay.text_matches?(@ch2, "第2章")
    assert ChapterDisplay.text_matches?(@ch2, "把第2章正文续写")
    assert ChapterDisplay.text_matches?(@ch2, "外门名册上的空白")
    refute ChapterDisplay.text_matches?(@ch2, "第11章")
    refute ChapterDisplay.text_matches?(@ch3, "第11章")
  end

  test "TEC 目标章：作者按当前 seq 点名 → 命中同章 ref/title（旧 title 编号不误导）" do
    context = %DialogueContext{
      workspace_id: "work-1",
      current_chapters: ["第01章：初夜", "第11章：外门名册上的空白", "第12章：旧钱与旧名"],
      structured_chapters: [@ch1, @ch2, @ch3]
    }

    action = %{target_chapter: nil, authoring_intent: nil, target_chapter_ref: nil}

    # 作者说“第2章”：命中真实 seq=2 的章（title 里历史编号是 11）
    assert TurnExecutionService.resolve_target_chapter(
             action,
             context,
             nil,
             "work-1",
             "把第2章再润色一下"
           ) == "第11章：外门名册上的空白"

    # 作者复制历史标题编号“第11章”：不再被 title 前缀当成身份 → 不归章
    assert TurnExecutionService.resolve_target_chapter(
             action,
             context,
             nil,
             "work-1",
             "把第11章再润色一下"
           ) == ""

    # 明确 ref 优先
    assert TurnExecutionService.resolve_target_chapter_identity(
             %{action | target_chapter_ref: "chapter:#{@ch2.id}"},
             context,
             nil,
             fn _work_id -> [@ch1, @ch2, @ch3] end,
             "work-1",
             "续写这一章"
           ) == %{title: "第11章：外门名册上的空白", ref: "chapter:#{@ch2.id}"}
  end

  test "章索引展示：第<当前 seq>章 + title core（规划/判断/探索同一 helper）" do
    line =
      ChapterListBudget.entry_line(%{
        title: "第11章：外门名册上的空白",
        seq: 2,
        id: @ch2.id,
        has_prose: true
      })

    assert line =~ "第 2 章"
    assert line =~ "外门名册上的空白"
    refute line =~ "第 11 章"
    assert line =~ "chapter_ref=chapter:#{@ch2.id}"
  end

  test "章使命输入：chapter_ref 进材料头，展示用当前 seq + core title" do
    inputs =
      NovelDomain.ChapterMissionInputs.build(%{
        chapter: %{
          id: @ch2.id,
          chapter_ref: "chapter:#{@ch2.id}",
          seq: 2,
          title: "第11章：外门名册上的空白"
        },
        entries: [],
        roster: []
      })

    section = NovelDomain.ChapterMissionInputs.to_prompt_section(inputs)

    assert section =~ "目标章：第2章 外门名册上的空白"
    assert section =~ "chapter:#{@ch2.id}"
    refute section =~ "目标章：第11章"
  end
end
