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
