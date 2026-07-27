// Design: docs/design/contracts/VS-00E-prose-execution-quality-contract-pack.md §7/§15; docs/design/ui/46-state-and-feedback.md §9.8
// Prototype: novel-studio.pen → 46§9.8-quality-revision-ready (AH4WW)
import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { QualityReviewCard, type QualityReviewView } from "./UICards";
import { CARD } from "../lib/copy";

function finding(
  overrides: Partial<QualityReviewView["findings"][number]> = {},
): QualityReviewView["findings"][number] {
  return {
    quality_finding_id: "qf_test",
    quality_gate: "quality_gate.style_fit",
    validator: "validator.prose_pattern_repetition",
    severity: "warn",
    action: "warn",
    summary: "身体反应模板高频重复",
    reasoning: "同一身体反应在局部反复出现，没有承担新的叙事作用。",
    confidence: 0.92,
    impact_scope: "local",
    revision_scope: "local",
    evidence_spans: [{ text: "心脏猛地一跳", sentence_start: 2, sentence_end: 2 }],
    suggested_revision: { instruction: "只替换命中表达。" },
    ...overrides,
  };
}

function collectText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  if (isValidElement<Record<string, unknown>>(node)) {
    if (typeof node.type === "function") {
      const Component = node.type as (props: Record<string, unknown>) => ReactNode;
      return collectText(Component(node.props));
    }
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
        finding(),
        finding({
          quality_finding_id: "qf_agency",
          quality_gate: "quality_gate.character_logic",
          validator: "validator.character_agency",
          action: "adoption_review",
          summary: "主角缺乏目标",
          reasoning: "正文没有呈现主角的选择。",
          confidence: 0.81,
          impact_scope: "paragraph",
          revision_scope: "paragraph",
          evidence_spans: [{ text: "他只是站在那里。", sentence_start: 5, sentence_end: 5 }],
        }),
      ],
    };

    const text = collectText(render(review));
    expect(text).toContain(CARD.qualityReview.title(2));
    expect(text).toContain("身体反应模板高频重复");
    expect(text).toContain("主角缺乏目标");
    expect(text).toContain("心脏猛地一跳");
    expect(text).toContain("第 2 句");
    expect(text).toContain("判断理由");
    expect(text).toContain("影响范围");
    expect(text).toContain("置信度 92%");
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

  it("shows the scoped revision affordance only when a revise handler is provided", () => {
    const review: QualityReviewView = {
      status: "warnings",
      policy_action: "proceed_with_warning",
      review_status: "completed",
      findings: [finding()],
    };

    // 无修订入口（例如阅读态）→ 不渲染重写按钮
    expect(collectText(QualityReviewCard({ review }))).not.toContain(
      CARD.qualityReview.reviseButton,
    );

    // 有修订入口且已全选 → 渲染 local scope 主动作
    const withRevise = collectText(
      QualityReviewCard({
        review,
        selectedFindingIds: ["qf_test"],
        onToggleFinding: () => {},
        onRevise: () => {},
      }),
    );
    expect(withRevise).toContain(CARD.qualityReview.reviseButton);
    expect(withRevise).toContain(CARD.qualityReview.reviseHint);
  });

  it("switches from short submit feedback to a stable submitted decision state", () => {
    const review: QualityReviewView = {
      status: "warnings",
      policy_action: "proceed_with_warning",
      review_status: "completed",
      findings: [finding({ summary: "句式节奏单一" })],
    };

    const submitted = collectText(
      QualityReviewCard({
        review,
        selectedFindingIds: ["qf_test"],
        onToggleFinding: () => {},
        onRevise: () => {},
        revisionStarted: true,
      }),
    );

    expect(submitted).toContain(CARD.qualityReview.revisionSubmittedSummary(1));
    expect(submitted).toContain(CARD.qualityReview.revisionSubmittedExpand);
    expect(submitted).toContain("句式节奏单一");
    expect(submitted).not.toContain(CARD.qualityReview.reviseButton);
    expect(submitted).not.toContain(CARD.qualityReview.revisingButton);
  });
});
