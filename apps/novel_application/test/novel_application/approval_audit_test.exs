defmodule NovelApplication.ApprovalAuditTest do
  use ExUnit.Case, async: true

  alias NovelApplication.ApprovalAudit
  alias NovelDomain.AuthorActionInput

  defp input(action_type, target_ref \\ "artifact-1") do
    %AuthorActionInput{
      input_id: "in-1",
      source_turn_ref: "turn-1",
      action_id: "action-1",
      action_type: action_type,
      target_ref: target_ref
    }
  end

  test "adoption 动作补 policy/risk/target_type/ACCEPTED，不补缺失 revision" do
    result =
      ApprovalAudit.enrich(input("adopt"), %{
        status: "accepted",
        artifact_type: "chapter_draft",
        run_id: "run-1"
      })

    assert result.approval_policy_ref == "approval_policy.high_risk_canon_change"
    assert result.risk_class == "HIGH"
    assert result.target_type == "chapter_draft"
    assert result.decision == "ACCEPTED"
    assert result.decided_by == "author"
    assert result.source_task_ref == "run-1"
    refute Map.has_key?(result, :base_revision)
  end

  test "edit_then_accept 成功映射 EDITED_ACCEPTED；失败不伪造 decision" do
    edited =
      ApprovalAudit.enrich(input("edit_then_accept"), %{
        status: "accepted",
        artifact_type: "chapter_draft"
      })

    assert edited.decision == "EDITED_ACCEPTED"

    failed =
      ApprovalAudit.enrich(input("adopt"), %{
        status: "failed",
        artifact_type: "chapter_draft"
      })

    refute Map.has_key?(failed, :decision)
    refute Map.has_key?(failed, :decided_by)
    assert failed.risk_class == "HIGH"
  end

  test "discard / confirmation 的状态映射" do
    discarded = ApprovalAudit.enrich(input("discard"), %{status: "discarded"})
    assert discarded.decision == "DISCARDED"
    assert discarded.decision != "ACCEPTED"

    confirmed =
      ApprovalAudit.enrich(input("confirm_before_execute"), %{
        status: "accepted",
        target_type: "long_run"
      })

    assert confirmed.approval_policy_ref == "approval_policy.long_run_budget_gate"
    assert confirmed.decision == "CONFIRMED"
    assert confirmed.target_type == "long_run"

    cancelled =
      ApprovalAudit.enrich(input("confirm_before_execute"), %{status: "cancelled"})

    assert cancelled.decision == "CANCELLED"
  end

  test "project_receipt 只投影带 policy 的真实批准记录，不补 nil" do
    receipt = %{
      id: "receipt-1",
      source_turn_ref: "turn-1",
      action_id: "act-1",
      action_type: "accept",
      inserted_at: ~U[2026-10-31 00:00:00.000000Z],
      result: %{
        "approval_policy_ref" => "approval_policy.high_risk_canon_change",
        "risk_class" => "HIGH",
        "decision" => "ACCEPTED",
        "decided_by" => "author",
        "target_type" => "chapter_draft"
      }
    }

    projection = ApprovalAudit.project_receipt(receipt)
    assert projection["approval_record_id"] == "receipt-1"
    assert projection["decision"] == "ACCEPTED"
    assert projection["target_type"] == "chapter_draft"
    assert projection["source_turn_ref"] == "turn-1"
    refute Map.has_key?(projection, "decision_note")

    nil_projection =
      ApprovalAudit.project_receipt(%{id: "receipt-2", result: %{"status" => "accepted"}})

    assert nil_projection == nil
  end

  test "base_revision 只透传真实值；未知动作不补默认批准记录" do
    with_revision =
      ApprovalAudit.enrich(input("adopt"), %{
        status: "accepted",
        base_revision: %{"chapter" => 3}
      })

    assert with_revision.base_revision == %{"chapter" => 3}

    unknown = ApprovalAudit.enrich(input("choose_candidate"), %{status: "accepted"})
    assert unknown == %{status: "accepted"}
    refute Map.has_key?(unknown, :approval_policy_ref)
  end
end
