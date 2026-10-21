defmodule NovelApplication.ProseExecutionBriefBuilderTest do
  use ExUnit.Case, async: true

  alias NovelApplication.CreativeDecisionPacketBuilder
  alias NovelApplication.ProseExecutionBriefBuilder
  alias NovelDomain.ChapterPlanDirection

  defp build(inputs) do
    inputs |> CreativeDecisionPacketBuilder.build() |> ProseExecutionBriefBuilder.build()
  end

  test "projects structured chapter direction into one grounded scene unit (not degraded)" do
    direction =
      ChapterPlanDirection.from_storage(%{
        "chapter_role" => "铺垫章",
        "plot_progress" => "主角进入旧服务器",
        "character_change" => "主角第一次主动冒险",
        "information_release" => "残诀来源指向旧实验",
        "foreshadowing_action" => "残诀尾页缺失",
        "emotion" => "紧张中带兴奋"
      })

    {brief, meta} =
      build(%{
        chapter_direction: direction,
        chapter: %{"title" => "第02章", "summary" => "x"},
        author_input: "写第二章",
        source_turn_ref: "turn-1"
      })

    refute meta.degraded
    assert "chapter_plan_direction" in meta.source
    assert brief.brief_id =~ "peb_"
    assert brief.anchor["chapter_ref"] == "第02章"
    assert brief.chapter_context["chapter_role"] == "铺垫章"

    assert [unit] = brief.scene_units
    refute Map.get(unit, "degraded")
    # target_change grounded in character_change (preferred) over plot_progress
    assert unit["target_change"]["description"] == "主角第一次主动冒险"
    assert unit["causal_spine"]["turn"] == "残诀尾页缺失"
    assert unit["causal_spine"]["consequence"] == "残诀来源指向旧实验"
    assert unit["emotion_transition"]["end"] == "紧张中带兴奋"
    assert unit["information_delta"]["reader_learns"] == "残诀来源指向旧实验"
  end

  # NEM04 刀③：规划落库的逐场计划展开为多场单元——VS-00E「多场展开属后续」就此闭环。
  test "expands planned scene_plans into per-scene units with title/goal/agendas/emotion" do
    direction =
      ChapterPlanDirection.from_storage(%{
        "emotion" => "紧张",
        "plot_progress" => "潜入黑市",
        "scene_plans" => [
          %{
            "title" => "对账",
            "goal" => "核对暗扣确认被抽走的频段",
            "agendas" => "沈洛要证据、摊主要脱身",
            "emotion" => "压抑"
          },
          %{"title" => "夜巡", "goal" => "躲过巡检带走残页"}
        ]
      })

    {brief, meta} =
      build(%{
        chapter_direction: direction,
        chapter: %{"title" => "第01章", "summary" => "x"},
        author_input: "写第一章",
        source_turn_ref: "turn-1"
      })

    refute meta.degraded
    assert "chapter_plan_scene_plans" in meta.source

    assert [first, second] = brief.scene_units
    assert first["unit_id"] == "scene_1"
    assert first["scene_title"] == "对账"
    assert first["scene_mode"] == "planned_scene"
    assert first["target_change"]["description"] == "核对暗扣确认被抽走的频段"
    assert first["character_agendas"] == "沈洛要证据、摊主要脱身"
    assert first["emotion_transition"]["end"] == "压抑"
    refute Map.get(first, "degraded")

    # 场缺情绪回退章级情绪定位；缺议程不写空壳键。
    assert second["scene_title"] == "夜巡"
    assert second["emotion_transition"]["end"] == "紧张"
    refute Map.has_key?(second, "character_agendas")
    # B11C CP1：缺新子槽时四组场级结构键不存在（不伪造）。
    refute Map.has_key?(second, "causal_spine")
    refute Map.has_key?(second, "information_delta")
    refute Map.has_key?(second, "dialogue_intent")
    refute Map.has_key?(second, "sensory_anchor")

    # prompt 渲染带场名与议程原文（writer 可读性）。
    section = NovelDomain.ProseExecutionBrief.to_prompt_section(brief)
    assert section =~ "scene_1（planned_scene）场：对账"
    assert section =~ "人物议程：沈洛要证据、摊主要脱身"
    assert section =~ "场：夜巡"
  end

  # B11C CP1：规划子槽确定性投影进 VS-00E §1 场级结构——只从规划字节映射，
  # 缺省不写键、不做模型二次生成。
  test "maps planned scene craft slots into causal/info/dialogue/sensory structures" do
    direction =
      ChapterPlanDirection.from_storage(%{
        "emotion" => "紧张",
        "scene_plans" => [
          %{
            "title" => "对账",
            "goal" => "核对暗扣",
            "agendas" => "沈洛要证据、摊主要脱身",
            "emotion" => "压抑",
            "opposition" => "摊主拖延并暗中报信",
            "turn" => "账单残页暴露抽签记录",
            "consequence" => "暗扣被坐实、打草惊蛇",
            "reader_learns" => "公司抽走频段",
            "protagonist_learns" => "账单上有内部编号",
            "remains_hidden" => "幕后主使",
            "surface_topic" => "对账寒暄",
            "hidden_conflict" => "互相试探底线",
            "sensory" => "潮湿霉味、风扇噪音"
          },
          %{
            "title" => "夜巡",
            "goal" => "带走残页",
            "surface_topic" => "巡检寒暄",
            "sensory" => "冷雨"
          }
        ]
      })

    {brief, meta} =
      build(%{
        chapter_direction: direction,
        chapter: %{"title" => "第01章", "summary" => "x"},
        author_input: "写第一章",
        source_turn_ref: "turn-1"
      })

    refute meta.degraded
    assert [first, second] = brief.scene_units

    # causal_spine 不产 goal（目标只进 target_change，避免 prompt 重复）
    assert first["causal_spine"] == %{
             "opposition_or_dilemma" => "摊主拖延并暗中报信",
             "turn" => "账单残页暴露抽签记录",
             "consequence" => "暗扣被坐实、打草惊蛇"
           }

    assert first["information_delta"] == %{
             "reader_learns" => "公司抽走频段",
             "protagonist_learns" => "账单上有内部编号",
             "remains_hidden" => "幕后主使"
           }

    assert first["dialogue_intent"] == %{
             "mode" => "subtext",
             "surface_topic" => "对账寒暄",
             "hidden_conflict" => "互相试探底线"
           }

    # 感官字符串按 、，,；; 切分；单值也成一项。
    assert first["sensory_anchor"] == ["潮湿霉味", "风扇噪音"]

    # 只有表面话题 → direct；没有潜台词时不写 mode=subtext，也不补空洞。
    assert second["dialogue_intent"] == %{"mode" => "direct", "surface_topic" => "巡检寒暄"}
    assert second["sensory_anchor"] == ["冷雨"]
    refute Map.has_key?(second, "causal_spine")
    refute Map.has_key?(second, "information_delta")

    # 简报渲染：四组结构都进入 writer prompt。
    section = NovelDomain.ProseExecutionBrief.to_prompt_section(brief)
    assert section =~ "因果：阻力：摊主拖延并暗中报信；转折：账单残页暴露抽签记录；后果：暗扣被坐实、打草惊蛇"
    assert section =~ "信息变化：读者得知：公司抽走频段"
    assert section =~ "对话意图：潜台词：表面谈对账寒暄，暗里争互相试探底线"
    assert section =~ "感官锚点：潮湿霉味、风扇噪音"
    assert section =~ "对话意图：表面谈巡检寒暄"
  end

  test "degrades to minimal brief from plan summary when no structured direction" do
    {brief, meta} =
      build(%{
        chapter_direction: nil,
        chapter: %{"title" => "第03章", "summary" => "主角与师父对峙"},
        author_input: "写第三章",
        source_turn_ref: "turn-2"
      })

    assert meta.degraded
    assert "plan_summary_or_author_input" in meta.source
    assert [unit] = brief.scene_units
    assert unit["target_change"]["description"] == "主角与师父对峙"
  end

  test "degrades with deliberate_pause when no direction and no summary/input" do
    {brief, meta} = build(%{chapter_direction: nil, chapter: %{}, author_input: ""})

    assert meta.degraded
    assert [unit] = brief.scene_units
    assert unit["degraded"] == true
    assert unit["target_change"]["type"] == "deliberate_pause"
  end
end
