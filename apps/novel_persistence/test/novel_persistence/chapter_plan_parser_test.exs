defmodule NovelPersistence.ChapterPlanParserTest do
  use ExUnit.Case, async: true

  alias NovelPersistence.ChapterPlanParser

  test "keeps legacy one-line chapter summaries compatible" do
    assert [
             %{
               seq: 1,
               title: "第01章：底层灵气账单",
               summary: "主角发现灵气带宽被公司暗中抽走。",
               plan_direction: nil
             },
             %{
               seq: 2,
               title: "第02章：旧服务器里的残诀",
               summary: "主角找到残缺功法并第一次突破。",
               plan_direction: nil
             }
           ] =
             ChapterPlanParser.parse("""
             第01章：底层灵气账单: 主角发现灵气带宽被公司暗中抽走。
             第02章：旧服务器里的残诀: 主角找到残缺功法并第一次突破。
             """)
  end

  test "parses CP4 multi-line E18-E22 chapter direction" do
    assert [
             %{
               seq: 1,
               title: "第01章：底层灵气账单",
               summary: "主角发现灵气账单异常；主角从被动忍耐转为主动追查；公司正在抽取底层修士灵气；埋下旧服务器残诀线索",
               plan_direction: %{
                 "chapter_role" => "推进章",
                 "plot_progress" => "主角发现灵气账单异常",
                 "character_change" => "主角从被动忍耐转为主动追查",
                 "information_release" => "公司正在抽取底层修士灵气",
                 "foreshadowing_action" => "埋下旧服务器残诀线索",
                 "emotion" => "压迫、悬疑",
                 "opening_hook" => "账单红字倒计时",
                 "ending_hook" => "旧服务器突然响应妹妹声音",
                 "word_count_and_scenes" => "约 3000 字，2 场"
               }
             },
             %{
               seq: 2,
               title: "第02章：旧服务器里的残诀",
               plan_direction: %{"plot_progress" => "主角进入旧服务器"}
             }
           ] =
             ChapterPlanParser.parse("""
             第01章：底层灵气账单: 章功能定位：推进章
             情节推进：主角发现灵气账单异常
             人物变化：主角从被动忍耐转为主动追查
             信息释放：公司正在抽取底层修士灵气
             伏笔动作：埋下旧服务器残诀线索
             情绪定位：压迫、悬疑
             章首拉力：账单红字倒计时
             章尾断章：旧服务器突然响应妹妹声音
             字数与场次：约 3000 字，2 场

             第02章：旧服务器里的残诀: 情节推进：主角进入旧服务器
             """)
  end

  test "keeps explicit legacy summary when structure labels follow" do
    assert [
             %{
               title: "第01章：底层灵气账单",
               summary: "主角发现灵气账单异常。",
               plan_direction: %{"plot_progress" => "主角发现灵气账单异常"}
             }
           ] =
             ChapterPlanParser.parse("""
             第01章：底层灵气账单: 主角发现灵气账单异常。
             情节推进：主角发现灵气账单异常
             """)
  end
end
