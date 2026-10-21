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

  # B11C CP1：场次子槽词表扩到 VS-00E §1 scene_units 已冻结的场级结构全集。
  # 全部可选；无新子槽的旧场次行解析结果逐字节不变（存量 NEM04 计划零影响）。
  describe "场级结构子槽 (B11C CP1)" do
    test "因果/信息差/对白/感官子槽逐项解析" do
      assert [%{plan_direction: direction}] =
               ChapterPlanParser.parse("""
               第01章：黑市对账夜: 沈洛潜入黑市。
               场次：对账｜目标：核对暗扣｜议程：沈洛要证据｜情绪：压抑｜阻力：摊主拖延｜转折：残页暴露｜后果：打草惊蛇｜读者得知：公司抽走频段｜主角得知：账单有内部编号｜仍隐藏：幕后主使｜对白表面：对账寒暄｜潜台词：互相试探｜感官：潮湿霉味、风扇噪音
               """)

      assert direction["scene_plans"] == [
               %{
                 "title" => "对账",
                 "goal" => "核对暗扣",
                 "agendas" => "沈洛要证据",
                 "emotion" => "压抑",
                 "opposition" => "摊主拖延",
                 "turn" => "残页暴露",
                 "consequence" => "打草惊蛇",
                 "reader_learns" => "公司抽走频段",
                 "protagonist_learns" => "账单有内部编号",
                 "remains_hidden" => "幕后主使",
                 "surface_topic" => "对账寒暄",
                 "hidden_conflict" => "互相试探",
                 "sensory" => "潮湿霉味、风扇噪音"
               }
             ]
    end

    test "别名词一一映射到规范键；词表外子槽被忽略" do
      assert [%{plan_direction: direction}] =
               ChapterPlanParser.parse("""
               第01章：夜巡: 沈洛夜巡。
               场次：夜巡｜冲突：巡检逼近｜读者知道：有人跟踪｜隐藏：真正名单｜时空感官：冷雨、铁锈味｜气氛：闷热
               """)

      assert direction["scene_plans"] == [
               %{
                 "title" => "夜巡",
                 "opposition" => "巡检逼近",
                 "reader_learns" => "有人跟踪",
                 "remains_hidden" => "真正名单",
                 "sensory" => "冷雨、铁锈味"
               }
             ]
    end

    test "无新子槽的旧场次行解析结果不变（增量键不出现）" do
      assert [%{plan_direction: direction}] =
               ChapterPlanParser.parse("""
               第01章：黑市对账夜: 沈洛潜入黑市。
               场次：对账｜目标：核对暗扣｜议程：沈洛要证据、摊主要脱身｜情绪：压抑
               """)

      assert direction["scene_plans"] == [
               %{
                 "title" => "对账",
                 "goal" => "核对暗扣",
                 "agendas" => "沈洛要证据、摊主要脱身",
                 "emotion" => "压抑"
               }
             ]
    end

    test "新子槽不污染章级方向与摘要；无标题行仍整行丢弃" do
      assert [%{summary: summary, plan_direction: direction}] =
               ChapterPlanParser.parse("""
               第01章：起: 甲。
               场次：｜阻力：无标题应丢弃
               场次：对账｜感官：潮湿霉味
               """)

      assert summary == "甲。"
      assert direction["scene_plans"] == [%{"title" => "对账", "sensory" => "潮湿霉味"}]
      refute Map.has_key?(direction, "opposition")
    end
  end
end
