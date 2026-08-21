defmodule NovelApplication.ProseExecutionBriefMissionTest do
  use ExUnit.Case, async: true

  alias NovelApplication.CreativeDecisionPacketBuilder
  alias NovelApplication.ProseExecutionBriefBuilder
  alias NovelDomain.ChapterMission
  alias NovelDomain.ChapterPlanDirection
  alias NovelDomain.ProseExecutionBrief

  defp packet(mission) do
    CreativeDecisionPacketBuilder.build(%{
      chapter_direction:
        ChapterPlanDirection.new(%{
          chapter_role: "推进章",
          plot_progress: "沈洛带证据撤出黑市",
          emotion: "紧张"
        }),
      chapter: %{"id" => "ch3", "title" => "第03章：巡检收网", "seq" => 3},
      author_input: "续写第三章",
      source_turn_ref: "turn_wr01",
      chapter_mission: mission
    })
  end

  test "在场的使命进 chapter_context.mission、brief_source 含 chapter_mission，并渲染进 prompt 段" do
    mission =
      %{
        "mission_id" => "cm_1",
        "statement" => "本章必须回收旧账牌伏笔。",
        "must_advance" => [
          %{
            "text" => "让旧账牌编号兑现",
            "basis_ref" => "ledger:information:foreshadow_a",
            "basis_label" => "伏笔：旧账牌（预期第2章回收，已超期）"
          }
        ],
        "must_avoid" => [
          %{"text" => "不提前揭示第五章信息", "basis_ref" => "ledger:information:plan_info_5"}
        ],
        "dropped" => [%{"text" => "编造", "basis_ref" => "nope"}]
      }

    {brief, meta} = ProseExecutionBriefBuilder.build(packet(mission))

    assert "chapter_mission" in meta.source
    assert "chapter_mission" in brief.source_refs
    assert brief.chapter_context["mission"]["statement"] == "本章必须回收旧账牌伏笔。"
    refute Map.has_key?(brief.chapter_context["mission"], "dropped")

    section = ProseExecutionBrief.to_prompt_section(brief)
    assert section =~ "## 场级执行简述"
    assert section =~ "本章：章节定位=推进章"
    assert section =~ "本章使命：本章必须回收旧账牌伏笔。"
    assert section =~ "· 必须推进：让旧账牌编号兑现（依据：伏笔：旧账牌（预期第2章回收，已超期））"
    assert section =~ "· 不得：不提前揭示第五章信息"
    refute section =~ "编造"
    # 使命段在章行之后、场次之前
    assert :binary.match(section, "本章使命") < :binary.match(section, "- scene_1")
  end

  test "降级使命只留痕 chapter_mission_degraded，不渲染使命块；缺席时简报逐字节不变" do
    {degraded_brief, degraded_meta} =
      ProseExecutionBriefBuilder.build(
        packet(ChapterMission.degraded("timeout") |> ChapterMission.to_map())
      )

    assert "chapter_mission_degraded" in degraded_meta.source
    assert degraded_brief.chapter_context["mission_degraded_reason"] == "timeout"
    refute Map.has_key?(degraded_brief.chapter_context, "mission")
    refute ProseExecutionBrief.to_prompt_section(degraded_brief) =~ "本章使命"

    {absent_brief, absent_meta} = ProseExecutionBriefBuilder.build(packet(nil))
    refute Enum.any?(absent_meta.source, &String.starts_with?(&1, "chapter_mission"))
    assert absent_brief.chapter_context == %{"chapter_role" => "推进章"}
  end
end
