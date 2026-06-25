// Design: docs/design/contracts/VS-00E-prose-execution-quality-contract-pack.md §7/§15
// Prototype: novel-studio.pen → 41§3-main-workbench (ZOwOi)
import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { QualityReviewCard, type QualityReviewView } from "./UICards";
import { CARD } from "../lib/copy";

function collectText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  if (isValidElement(node)) {
    const children = (node.props as { children?: ReactNode }).children;
    return Children.toArray(children).map(collectText).join("");
  }
  return "";
}

function render(review: QualityReviewView): ReactNode {
  return QualityReviewCard({ review });
}

describe("QualityReviewCard", () => {
  it("renders findings count + summaries + evidence", () => {
    const review: QualityReviewView = {
      status: "warnings",
      policy_action: "proceed_with_warning",
      review_status: "completed",
      findings: [
        {
          quality_gate: "quality_gate.style_fit",
          validator: "validator.prose_pattern_repetition",
          severity: "warn",
          action: "warn",
          summary: "身体反应模板高频重复",
          evidence_spans: [{ text: "心脏猛地一跳" }],
        },
        {
          quality_gate: "quality_gate.character_logic",
          validator: "validator.character_agency",
          severity: "warn",
          action: "adoption_review",
          summary: "主角缺乏目标",
        },
      ],
    };

    const text = collectText(render(review));
    expect(text).toContain(CARD.qualityReview.title(2));
    expect(text).toContain("身体反应模板高频重复");
    expect(text).toContain("主角缺乏目标");
    expect(text).toContain("心脏猛地一跳");
  });

  it("shows honest unavailable notice when review did not complete", () => {
    const review: QualityReviewView = {
      status: "unavailable",
      policy_action: "quality_review_unavailable",
      review_status: "unavailable",
      findings: [],
    };

    const text = collectText(render(review));
    expect(text).toContain(CARD.qualityReview.unavailableTitle);
    // 不得伪装成「发现 N 项问题」的完成态标题
    expect(text).not.toContain("质量复核：发现");
  });

  it("renders nothing when review completed with no findings", () => {
    const review: QualityReviewView = {
      status: "passed",
      policy_action: "proceed",
      review_status: "completed",
      findings: [],
    };

    expect(render(review)).toBeNull();
  });
});
