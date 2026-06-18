defmodule NovelApplication.AIMessageEnvelopeTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AIMessageEnvelope
  alias NovelDomain.ContextSourceRef
  alias NovelDomain.DialogueContext

  describe "quality diagnosis envelope" do
    test "builds reconstructable novel/work/guidance layers from DialogueContext" do
      context = context_with_work_state()

      envelope =
        AIMessageEnvelope.quality_diagnosis(
          "这一章感觉不够爽，主角赢得太轻了。",
          context,
          turn_id: "turn-quality"
        )

      assert envelope.contract_version == "VS-00D-draft"
      assert envelope.call_site == :planner
      assert envelope.turn_ref == "turn-quality"

      assert envelope.novel_layer.always_on_principles == [
               "冲突压力必须可感知",
               "胜利需要可见代价",
               "读者回报要和铺垫/期待绑定",
               "主角能动性必须驱动局面变化"
             ]

      assert envelope.novel_layer.selection_rationale =~ "胜利过轻"
      refute inspect(envelope.novel_layer) =~ "灵源纪元"

      assert envelope.work_state_layer.snapshot_summary =~ "灵源纪元"

      assert envelope.work_state_layer.writing_coordinate == %{
               chapter: "第三章：霓虹地牢",
               source: :current_work_snapshot
             }

      assert [%{source_type: :current_work}, %{source_type: :memory}] =
               envelope.work_state_layer.context_refs

      assert envelope.work_state_layer.chapter_summary == [
               "第三章：霓虹地牢: 林烬破解地牢阵列并轻松击败守卫。"
             ]

      assert envelope.turn_guidance_layer.guidance_mode == :quality

      assert envelope.turn_guidance_layer.element_focus == [
               "conflict_pressure",
               "cost_visibility",
               "reader_payoff",
               "protagonist_agency"
             ]

      assert "缺本章已采纳正文片段，不能逐句诊断，只能基于摘要/上下文给结构建议。" in envelope.turn_guidance_layer.missing_questions
    end

    test "marks missing work state instead of fabricating facts" do
      envelope =
        AIMessageEnvelope.quality_diagnosis(
          "这一章不够爽，主角赢得太轻了",
          %DialogueContext{workspace_id: "work-empty"},
          turn_id: "turn-empty"
        )

      assert envelope.work_state_layer.snapshot_summary == %{
               status: :missing,
               reason: "no_current_work_snapshot"
             }

      assert envelope.work_state_layer.chapter_state == %{
               status: :missing,
               reason: "no_chapter_state"
             }

      assert envelope.work_state_layer.context_refs == []
      assert "缺当前作品快照，只能给通用质量诊断。" in envelope.turn_guidance_layer.missing_questions
      assert "缺目标章节摘要或章节列表，需要作者补充要诊断的章节。" in envelope.turn_guidance_layer.missing_questions
    end

    test "does not build envelope for ordinary chat" do
      refute AIMessageEnvelope.quality_diagnosis("我们聊聊角色名字。", nil)
    end
  end

  defp context_with_work_state do
    %DialogueContext{
      workspace_id: "work-quality",
      current_work_snapshot: %{
        "title" => "灵源纪元",
        "genre" => "赛博修仙",
        "core_selling_point" => "林烬追查妹妹失踪真相",
        "target_reader" => "喜欢悬疑成长线的读者",
        "current_chapter" => "第三章：霓虹地牢",
        "protagonist" => "林烬",
        "tone_preference" => "克制、悬疑、带希望感"
      },
      structured_chapters: [
        %{
          title: "第三章：霓虹地牢",
          seq: 3,
          summary: "林烬破解地牢阵列并轻松击败守卫。",
          has_prose: true
        }
      ],
      context_refs: [
        %ContextSourceRef{
          context_ref: "ctx-work",
          source_type: :current_work,
          summary: "灵源纪元 / 赛博修仙 / 林烬追查妹妹失踪真相"
        },
        %ContextSourceRef{
          context_ref: "ctx-memory",
          source_type: :memory,
          summary: "林烬的雷电灵力来自妹妹留下的矿区线索。"
        }
      ],
      assembled_at: "2026-06-18T00:00:00Z"
    }
  end
end
