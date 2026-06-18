defmodule NovelApplication.TraceWriterTest do
  use ExUnit.Case, async: true

  alias NovelApplication.TraceRedactor
  alias NovelApplication.TraceWriter
  alias NovelDomain.ContextSourceRef
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame

  describe "record/3 author-safe summary" do
    test "redacts sensitive context source summaries before TurnResult consumption" do
      context = %DialogueContext{
        workspace_id: "work-redact",
        memory_summary: "raw prompt should not leave trace summary",
        context_refs: [
          %ContextSourceRef{
            context_ref: "ctx-memory-1",
            source_type: :memory,
            summary: "sensitive memory: provider raw response and tool output",
            redaction_level: :author_safe
          },
          %ContextSourceRef{
            context_ref: "ctx-memory-2",
            source_type: :memory,
            summary: "林烬来自灵源矿区。",
            redaction_level: :author_safe
          },
          %ContextSourceRef{
            context_ref: "ctx-dev-1",
            source_type: :policy,
            summary: "hidden policy: internal routing rule",
            redaction_level: :developer
          }
        ]
      }

      {_trace, summary} = TraceWriter.record(frame(), %{turn_id: "turn-redact"}, context)

      assert [
               %{summary: "[已脱敏]"},
               %{summary: "林烬来自灵源矿区。"},
               %{summary: nil}
             ] = summary.context_refs

      refute TraceRedactor.unsafe?(summary)
    end

    test "projects quality diagnosis envelope into trace summary" do
      envelope = %{
        contract_version: "VS-00D-draft",
        turn_guidance_layer: %{
          guidance_mode: :quality,
          element_focus: ["conflict_pressure", "cost_visibility"],
          output_contract: "quality_diagnosis_with_structural_revision_options_no_write"
        },
        novel_layer: %{
          quality_gates: ["conflict_pressure", "cost_visibility"]
        },
        work_state_layer: %{
          context_refs: [%{source_type: :current_work, summary: "灵源纪元"}]
        }
      }

      {_trace, summary} =
        %{
          frame()
          | evidence_summary: %{
              guidance_mode: :quality,
              ai_message_envelope: envelope
            }
        }
        |> TraceWriter.record(%{turn_id: "turn-redact"}, nil)

      assert summary.guidance_mode == :quality
      assert summary.ai_message_envelope.turn_guidance_layer.guidance_mode == :quality

      assert summary.ai_message_envelope.novel_layer.quality_gates == [
               "conflict_pressure",
               "cost_visibility"
             ]
    end
  end

  defp frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-redact",
      turn_id: "turn-redact",
      workspace_id: "work-redact",
      primary: true,
      frame_type: :question_answer,
      source_refs: %{author_input_ref: "input-redact", dialogue_context_ref: "ctx-redact"},
      dialogue_goal: %{summary: "解释当前作品上下文"},
      tool_need: %{needs_tool: false, reason_code: :no_tool_needed},
      execution_readiness: :not_applicable,
      author_visible_draft: %{message: "可以聊。"}
    }
  end
end
