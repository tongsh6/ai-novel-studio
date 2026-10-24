defmodule NovelApplication.TurnResultBuilderTest do
  use ExUnit.Case, async: true

  alias NovelApplication.TurnResultBuilder
  alias NovelCommon.Contracts.ToolResult
  alias NovelDomain.DialogueFrame
  alias NovelDomain.OrchestratorDecision

  # B13b BB-4（ADR-0006 #2，2026-10-23 作者拍板方案 A）：
  # fail_with_recovery 决策 = 失败但可恢复——phase 仍 failed，status 用
  # failed_recoverable；不可恢复失败（如工具失败且决策放行）仍是 failed。
  describe "phase/status（ADR-0006 #2 / B13b BB-4）" do
    test "fail_with_recovery 决策产出 failed phase + failed_recoverable status" do
      result =
        TurnResultBuilder.build(
          frame(),
          %{},
          [],
          decision(:fail_with_recovery),
          nil
        )

      assert result.phase == "failed"
      assert result.status == "failed_recoverable"
      assert result.truthfulness.execution_blocked == true
      assert result.truthfulness.decision_type == :fail_with_recovery
    end

    test "工具失败但决策放行仍是 failed（不是可恢复失败）" do
      tool_result = %ToolResult{
        tool_result_id: "tr-failed",
        tool_request_ref: "req-failed",
        tool_name: "prose_writing",
        status: :failed,
        output: %{}
      }

      result =
        TurnResultBuilder.build(frame(), %{}, [], decision(:allow_tool), tool_result)

      assert result.phase == "failed"
      assert result.status == "failed"
    end

    test "普通回复轮保持 dialogue phase + conversational status" do
      result = TurnResultBuilder.build(frame(), %{}, [])

      assert result.phase == "dialogue"
      assert result.status == "conversational"
    end
  end

  defp frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-status",
      turn_id: "turn-status",
      workspace_id: "work-status",
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{author_input_ref: "turn-status"},
      dialogue_goal: %{summary: "验证 TurnResult 状态口径"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "本轮执行未完成。"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp decision(type) do
    %OrchestratorDecision{
      decision_id: "decision-status",
      turn_id: "turn-status",
      frame_ref: "frame-status",
      decision_type: type,
      decision_status: :decided,
      reason_codes: [to_string(type)]
    }
  end

  test "build/8 pending_payload 只对本次候选追加 additive 字段（旧调用无变化）" do
    {:ok, artifact} =
      NovelApplication.ArtifactAssembler.assemble(
        %NovelCommon.Contracts.ToolResult{
          tool_result_id: "tr-b28",
          tool_request_ref: "tq-b28",
          tool_name: "prose_writing",
          status: :succeeded,
          output: %{
            artifact_type: "prose_fragment",
            item_count: 1,
            items: [%{item_id: "i1", title: "候选", body: "正文", rationale: nil}]
          },
          artifact_refs: ["i1"],
          state_delta: [],
          usage: %{},
          trace_refs: [],
          completed_at: DateTime.utc_now()
        },
        "turn-b28"
      )

    frame = %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-b28",
      turn_id: "turn-b28",
      workspace_id: "work",
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{author_input_ref: "turn-b28"},
      dialogue_goal: %{summary: "候选"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "候选"},
      evidence_summary: %{},
      uncertainty: []
    }

    legacy = TurnResultBuilder.build(frame, %{}, [], nil, nil, artifact)
    [legacy_pending] = legacy.adoption_state.pending
    refute Map.has_key?(legacy_pending.payload, "modification_scope")

    with_payload =
      TurnResultBuilder.build(frame, %{}, [], nil, nil, artifact, nil, %{
        pending_payload: %{"modification_scope" => "format_only", "base_text" => "正文"}
      })

    [pending] = with_payload.adoption_state.pending
    assert pending.payload["modification_scope"] == "format_only"
    assert pending.payload["base_text"] == "正文"
    assert pending.payload[:items] |> hd() |> Map.get(:body) == "正文"
  end
end
