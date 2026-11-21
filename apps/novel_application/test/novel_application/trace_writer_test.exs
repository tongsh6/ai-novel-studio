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
        work_id: "work-redact",
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

    test "retains the accepted author narrative source through the final reply record" do
      text = "  要采用哪种结尾？\n"
      hash = :crypto.hash(:sha256, text) |> Base.encode16(case: :lower)

      source = %{
        source_type: "provider_output_tool_narrative",
        provider_run_ref: "prun_narrative_1",
        provider_call_ref: "pcall_narrative_1",
        provider_output_ref: "prun_narrative_1",
        tool_call_name: "ask_author",
        tool_call_narrative_field: "question",
        source_hash: hash,
        source_byte_range: %{start: 0, length: byte_size(text)},
        narrative_hash: hash
      }

      record = %{
        provider_call_ref: "pcall_narrative_1",
        response_kind: "structured_tool",
        raw_content: text,
        author_narrative_source: source
      }

      frame = %{frame() | evidence_summary: %{reply_record: record}}
      {_trace, summary} = TraceWriter.record(frame, %{turn_id: "turn-redact"}, nil)

      assert summary.reply_record == record
      assert summary.reply_record.author_narrative_source == source
    end

    test "records an application rejection without claiming a tool was dispatched" do
      {request, result} = failed_tool_exchange("authoring_task_invalid")

      {trace, summary} =
        TraceWriter.record_with_tool(
          frame(),
          plan(),
          allow_tool_decision(),
          request,
          result,
          %{turn_id: "turn-redact", execution_counts: %{tool_calls: 0, provider_calls: 0}},
          nil
        )

      refute trace.decision_type == :tool_dispatched
      refute :tool_dispatched in trace.event_order
      refute :tool_result_received in trace.event_order
      refute trace.no_tool_reason == "tool_was_dispatched"
      refute trace.no_behavior_reason == "tool_execution_completed"
      refute String.contains?(trace.no_write_reason, "orchestrator blocked")
      assert [%{tool_request_ref: "tq-not-started", tool_status: :failed}] = trace.tool_trace_refs
      assert summary.decision_type == trace.decision_type
      assert summary.tool_status == :failed
      assert summary.execution_counts == %{tool_calls: 0, provider_calls: 0}
    end

    test "records a dispatched failure as an attempted execution, not a success" do
      {request, result} = failed_tool_exchange("provider_unavailable")

      {trace, summary} =
        TraceWriter.record_with_tool(
          frame(),
          plan(),
          allow_tool_decision(),
          request,
          result,
          %{turn_id: "turn-redact", execution_counts: %{tool_calls: 1, provider_calls: 1}},
          nil
        )

      assert trace.decision_type == :tool_dispatched
      assert :tool_dispatched in trace.event_order
      assert :tool_result_received in trace.event_order
      assert [%{tool_status: :failed}] = trace.tool_trace_refs
      assert summary.tool_status == :failed
      assert summary.adoption_status == "not_adopted"
      assert summary.execution_counts == %{tool_calls: 1, provider_calls: 1}
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
          %{turn_id: "turn-redact", execution_counts: %{tool_calls: 1, provider_calls: 0}},
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

  defp failed_tool_exchange(code) do
    request = %ToolRequest{
      tool_request_id: "tq-not-started",
      turn_id: "turn-redact",
      frame_ref: "frame-redact",
      plan_ref: "plan-redact",
      decision_ref: "decision-redact",
      tool_name: "prose_writing",
      tool_version: "1.0.0",
      input: %{},
      read_scope_grants: [],
      write_scope_grants: []
    }

    result = %ToolResult{
      tool_result_id: "tr-not-started",
      tool_request_ref: request.tool_request_id,
      tool_name: request.tool_name,
      status: :failed,
      errors: [%{code: code, message: "本轮创作未能完成。"}],
      artifact_refs: [],
      state_delta: []
    }

    {request, result}
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
