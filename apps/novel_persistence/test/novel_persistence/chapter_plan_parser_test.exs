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

  # AU08 CP2：卷归属逐章标注。选标注而非「卷标题分隔行」是因为标注自描述、不依赖行序，
  # 计划重排或追加章都不会串卷。
  describe "卷归属标注 (AU08 CP2)" do
    test "逐章标注被抽成 volume_title，且不污染 plan_direction 与摘要" do
      assert [
               %{title: "第01章：起", volume_title: "第一卷", summary: "甲。"} = c1,
               %{title: "第02章：承", volume_title: "第二卷"}
             ] =
               ChapterPlanParser.parse("""
               第01章：起: 甲。
               所属卷：第一卷
               情节推进：主角发现账单异常
               第02章：承: 乙。
               所属卷：第二卷
               情节推进：主角进入旧服务器
               """)

      assert c1.plan_direction == %{"plot_progress" => "主角发现账单异常"}
      refute c1.summary =~ "第一卷"
    end

    test "ASCII 冒号加空格写法不会被劈成新章（chapter_start_line? 的真实陷阱）" do
      # 「所属卷: 第一卷」命中 contains?(": ")：不把卷标注算进 label_line? 就会在此处
      # 劈出一个标题为「所属卷」的空章，卷分组反而制造出假章。
      chapters =
        ChapterPlanParser.parse("""
        第01章：起: 甲。
        所属卷: 第一卷
        情节推进：主角发现账单异常
        """)

      assert [%{title: "第01章：起", volume_title: "第一卷"}] = chapters
      refute Enum.any?(chapters, &(&1.title == "所属卷"))
    end

    test "场次逐场标注解析进 plan_direction.scene_plans（NEM04 刀③）" do
      assert [%{plan_direction: direction}] =
               ChapterPlanParser.parse("""
               第01章：黑市对账夜: 沈洛潜入黑市。
               情节推进：追查暗扣流向
               场次：对账｜目标：核对暗扣并确认被抽走的频段｜议程：沈洛要证据、摊主要脱身｜情绪：压抑
               场次：夜巡｜目标：躲过巡检带走残页｜情绪：紧绷
               字数与场次：约1200字，两场（对账/夜巡）
               """)

      assert direction["plot_progress"] == "追查暗扣流向"
      assert direction["word_count_and_scenes"] == "约1200字，两场（对账/夜巡）"

      assert direction["scene_plans"] == [
               %{
                 "title" => "对账",
                 "goal" => "核对暗扣并确认被抽走的频段",
                 "agendas" => "沈洛要证据、摊主要脱身",
                 "emotion" => "压抑"
               },
               %{"title" => "夜巡", "goal" => "躲过巡检带走残页", "emotion" => "紧绷"}
             ]
    end

    test "场次行 ASCII 冒号写法不劈假章；无标题场次行整行丢弃" do
      chapters =
        ChapterPlanParser.parse("""
        第01章：起: 甲。
        场次: 对账｜目标：核对
        场次：｜目标：无标题应丢弃
        """)

      assert [%{title: "第01章：起", plan_direction: direction}] = chapters
      refute Enum.any?(chapters, &(&1.title == "场次"))
      assert direction["scene_plans"] == [%{"title" => "对账", "goal" => "核对"}]
    end

    test "无场次标注时 plan_direction 不含 scene_plans 键（旧计划逐字节等价）" do
      assert [%{plan_direction: direction}] =
               ChapterPlanParser.parse("""
               第01章：起: 甲。
               情节推进：主角发现账单异常
               """)

      refute Map.has_key?(direction, "scene_plans")
    end

    test "无标注时 volume_title 为 nil（单卷书与旧计划逐字节等价）" do
      assert [%{title: "第01章：起", volume_title: nil, summary: "甲。"}] =
               ChapterPlanParser.parse("第01章：起: 甲。")
    end

    test "同卷多章共用同一卷名；卷名两侧空白归一" do
      assert [
               %{volume_title: "第一卷"},
               %{volume_title: "第一卷"},
               %{volume_title: "第二卷"}
             ] =
               ChapterPlanParser.parse("""
               第01章：起: 甲。
               所属卷：  第一卷
               第02章：承: 乙。
               卷归属：第一卷
               第03章：转: 丙。
               所属分卷：第二卷
               """)
    end
  end
end
