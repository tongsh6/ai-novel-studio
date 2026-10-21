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

  # B11C CP1：场级计划白名单扩到 VS-00E §1 结构全集（title + 3 既有 + 8 新增）。
  describe "scene_plans 归一与存储往返 (B11C CP1)" do
    test "12 键白名单原样归一（空值丢弃、title 必填）" do
      direction =
        ChapterPlanDirection.new(%{
          "scene_plans" => [
            %{
              "title" => " 对账 ",
              "goal" => "核对暗扣",
              "agendas" => "",
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
            },
            %{"goal" => "无标题应丢弃"},
            "not a map"
          ]
        })

      assert direction.scene_plans == [
               %{
                 "title" => "对账",
                 "goal" => "核对暗扣",
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

    test "旧三槽场次归一结果逐字节等价（无新增键）" do
      direction =
        ChapterPlanDirection.new(%{
          scene_plans: [
            %{title: "对账", goal: "核对暗扣", agendas: "沈洛要证据", emotion: "压抑"}
          ]
        })

      assert direction.scene_plans == [
               %{
                 "title" => "对账",
                 "goal" => "核对暗扣",
                 "agendas" => "沈洛要证据",
                 "emotion" => "压抑"
               }
             ]
    end

    test "全键存储往返不丢字段" do
      storage = %{
        "plot_progress" => "追查暗扣流向",
        "scene_plans" => [
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
      }

      assert storage |> ChapterPlanDirection.from_storage() |> ChapterPlanDirection.to_storage() ==
               storage
    end

    test "scene_slot_lines 有序渲染存在子槽；缺槽不补占位" do
      assert ChapterPlanDirection.scene_slot_lines(%{
               "title" => "对账",
               "goal" => "核对暗扣",
               "agendas" => "",
               "emotion" => "压抑",
               "opposition" => "摊主拖延",
               "sensory" => "潮湿霉味"
             }) == ["目标：核对暗扣", "情绪：压抑", "阻力：摊主拖延", "感官：潮湿霉味"]

      assert ChapterPlanDirection.scene_slot_lines(%{"title" => "夜巡"}) == []
      assert ChapterPlanDirection.scene_slot_lines(nil) == []
    end
  end
end
