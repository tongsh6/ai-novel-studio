defmodule NovelDomain.ChapterPlanDirectionTest do
  use ExUnit.Case, async: true

  alias NovelDomain.ChapterPlanDirection

  test "normalizes storage maps and drops blank fields" do
    direction =
      ChapterPlanDirection.new(%{
        "chapter_role" => " 推进章 ",
        "plot_progress" => "主角发现灵气账单异常",
        "character_change" => "",
        "emotion" => "紧张"
      })

    assert direction.chapter_role == "推进章"
    assert direction.plot_progress == "主角发现灵气账单异常"
    assert direction.character_change == nil

    assert ChapterPlanDirection.to_storage(direction) == %{
             "chapter_role" => "推进章",
             "plot_progress" => "主角发现灵气账单异常",
             "emotion" => "紧张"
           }
  end

  test "empty directions collapse to nil" do
    assert ChapterPlanDirection.new(%{}) == nil
    assert ChapterPlanDirection.to_storage(%{}) == nil
    assert ChapterPlanDirection.empty?(%{"plot_progress" => " "})
  end

  test "summary uses the four objective fields" do
    direction =
      ChapterPlanDirection.new(%{
        plot_progress: "推进矿区调查",
        character_change: "主角从被动转为主动",
        information_release: "揭示公司抽取灵气",
        foreshadowing_action: "埋下旧服务器残诀"
      })

    assert ChapterPlanDirection.summary(direction) ==
             "推进矿区调查；主角从被动转为主动；揭示公司抽取灵气；埋下旧服务器残诀"
  end

  test "prompt_lines renders E18-E22 direction labels" do
    direction =
      ChapterPlanDirection.new(%{
        chapter_role: "转折章",
        plot_progress: "主角进入旧服务器",
        character_change: "第一次主动冒险",
        information_release: "残诀来源可疑",
        foreshadowing_action: "残诀尾页缺失",
        emotion: "紧张中带兴奋",
        opening_hook: "红色账单倒计时",
        ending_hook: "服务器里传来妹妹声音",
        word_count_and_scenes: "约 3000 字，2 场"
      })

    assert ChapterPlanDirection.prompt_lines(direction) == [
             "- 章功能定位：转折章",
             "- 目标四件套：情节推进=主角进入旧服务器；人物变化=第一次主动冒险；信息释放=残诀来源可疑；伏笔动作=残诀尾页缺失",
             "- 情绪定位：紧张中带兴奋",
             "- 章首拉力：红色账单倒计时",
             "- 章尾断章：服务器里传来妹妹声音",
             "- 字数与场次：约 3000 字，2 场"
           ]
  end
end
