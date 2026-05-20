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
