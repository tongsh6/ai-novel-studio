// Design: docs/design/ui/42-card-system.md §分段方案的预览
// Prototype: novel-studio.pen → 42§4-adoption-card-states (PZAVY)
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CandidateSetCard } from "./UICards";
import { CARD } from "../lib/copy";

it("分段方案保留模型说明并独立展示含新段落的原文预览", () => {
  const card = {
    card_type: "candidate_set" as const,
    artifact_type: "prose_formatting_plan",
    items: [{ item_id: "plan", title: "分段", body: "模型说明", rationale: "模型理由" }],
    formatting_preview: "原文 nonce_724。\n\n下一句。",
  };
  const html = renderToStaticMarkup(<CandidateSetCard card={card} />);
  expect(html).toContain("模型说明");
  expect(html).toContain("模型理由");
  expect(html).toContain(`aria-label="${CARD.artifactDraft.formattingPreviewLabel}"`);
  expect(html).toContain(card.formatting_preview);
  expect(html).not.toContain("textarea");
  expect(card.items[0].body).toBe("模型说明");
});
