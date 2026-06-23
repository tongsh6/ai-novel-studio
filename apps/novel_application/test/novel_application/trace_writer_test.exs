defmodule NovelApplication.TraceWriterTest do
  use ExUnit.Case, async: true

  alias NovelApplication.TraceRedactor
  alias NovelApplication.TraceWriter
  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.Contracts.ToolResult
  alias NovelDomain.ContextSourceRef
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

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

    test "records tool registry snapshot and redacted IO summaries without raw payload" do
      request = %ToolRequest{
        tool_request_id: "tq-redacted",
        turn_id: "turn-redact",
        frame_ref: "frame-redact",
        plan_ref: "plan-redact",
        decision_ref: "decision-redact",
        tool_name: "character_roster",
        tool_version: "1.0.0",
        input: %{
          "characters" => [
            %{"name" => "林澈", "summary" => "raw prompt should not leave ToolTrace"}
          ],
          "raw_prompt" => "hidden policy",
          "tool_input" => "provider raw response"
        },
        read_scope_grants: ["character_list"],
        write_scope_grants: []
      }

      result = %ToolResult{
        tool_result_id: "tr-redacted",
        tool_request_ref: "tq-redacted",
        tool_name: "character_roster",
        status: :succeeded,
        output: %{
          "character_count" => 1,
          "characters" => [%{"name" => "林澈"}],
          "tool_output" => "provider raw response"
        },
        usage: %{duration_ms: 12, tool: "character_roster", version: "1.0.0"}
      }

      {trace, summary} =
        TraceWriter.record_with_tool(
          frame(),
          plan(),
          allow_tool_decision(),
          request,
          result,
          %{turn_id: "turn-redact"},
          nil
        )

      assert [tool_ref] = trace.tool_trace_refs
      assert tool_ref.trace_status == :registry_snapshot
      assert tool_ref.registry_snapshot.tool_name == "character_roster"
      assert tool_ref.registry_snapshot.tool_layer == :memory
      assert tool_ref.registry_snapshot.status == :active
      assert tool_ref.contract_refs.input_contract_ref == "character_roster_query_v1"
      assert tool_ref.contract_refs.output_contract_ref == "character_roster_result_v1"
      assert tool_ref.grant_summary.requested_read_scopes == ["character_list"]
      assert tool_ref.grant_summary.requested_write_scopes == []
      assert tool_ref.grant_summary.grants_within_registry == true
      assert tool_ref.request_summary.keys == ["characters"]
      assert tool_ref.request_summary.redacted_key_count == 2
      assert tool_ref.request_summary.payload_stored == false
      assert tool_ref.result_summary.keys == ["character_count", "characters"]
      assert tool_ref.result_summary.redacted_key_count == 1
      assert tool_ref.result_summary.artifact_ref_count == 0
      assert tool_ref.io_redaction.input_payload_stored == false
      assert tool_ref.io_redaction.output_payload_stored == false

      refute inspect(tool_ref) =~ "林澈"
      refute inspect(tool_ref) =~ "hidden policy"
      refute inspect(tool_ref) =~ "provider raw response"
      refute TraceRedactor.unsafe?(tool_ref)
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

  defp plan do
    %MicroPlan{
      plan_id: "plan-redact",
      turn_id: "turn-redact",
      frame_ref: "frame-redact",
      plan_goal: %{summary: "查看角色列表"},
      risk_hint: :low
    }
  end

  defp allow_tool_decision do
    %OrchestratorDecision{
      decision_id: "decision-redact",
      turn_id: "turn-redact",
      frame_ref: "frame-redact",
      plan_ref: "plan-redact",
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["low_risk_readonly_tool"]
    }
  end
end
