import test from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { revisionChecks } from "./native_b28_evidence.mjs";
import { b28NormalizeFormatText, b28BuildInitialFragment, b28BuildContinuationFragment, b28ExpectedAgeReplacement, b28FormattingPlanMatches } from "./lib/b28-chapter-fixture.mjs";

function fixture() {
  const first = b28BuildInitialFragment(), second = b28BuildContinuationFragment();
  const before = { chapter_id: "chapter-one", chapters: [{ id: "chapter-one", title: "第01章：夜潮", seq: 1 }], drafts: [
    { id: "first", chapter_id: "chapter-one", content: first, revision: 1, draft_status: "ACCEPTED" },
    { id: "second", chapter_id: "chapter-one", content: second, revision: 1, draft_status: "ACCEPTED" },
  ] };
  const text = `${first}\n\n${second}`;
  const preview = text.replace("点灯人不能回头看灯焰。", "点灯人不能回头看灯焰。\n");
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const changes = [{ boundary_id: "fixture-boundary", lines: 1 }];
  const candidate = { artifact_type: "prose_formatting_plan", target_chapter_ref: "chapter:chapter-one", payload: {
    items: [{ item_id: "plan", title: "分段", body: "仅分段说明", rationale: "阅读节奏", line_break_changes: changes }],
    formatting_preview: preview, base_text: text, modification_scope: "format_only", adoption_effect: { mode: "format_paragraphs", coverage: "complete",
      source_hash: hash(text), preview_hash: hash(preview), line_break_changes: changes,
      covered: [{ draft_ref: "draft:first", version: 1 }, { draft_ref: "draft:second", version: 1 }],
      expected_base_versions: [{ ref: "draft:first", version: 1 }, { ref: "draft:second", version: 1 }] } } };
  const after = { ...before, drafts: [...before.drafts.map((d) => ({ ...d, draft_status: "SUPERSEDED" })), { id: "new", chapter_id: "chapter-one", content: preview, revision: 1, draft_status: "ACCEPTED" }] };
  return { before, candidate, after };
}
test("原B28两片段长度/锚点和冻结归一保持", () => {
  assert.equal(b28BuildInitialFragment().length, 2517);
  assert.equal(b28BuildContinuationFragment().length, 1075);
  assert(!b28BuildContinuationFragment().includes("\n"));
  assert.equal(b28NormalizeFormatText("甲 \r\n乙\n\n"), "甲\n乙");
  assert.notEqual(b28NormalizeFormatText("甲\n\n乙"), b28NormalizeFormatText("甲\n乙"));
});
test("全章同身份替代通过，缺覆盖/错版本/旧稿仍当前不能通过", () => {
  const { before, candidate, after } = fixture();
  assert(Object.values(revisionChecks(candidate, before, after, "format_only")).every(Boolean));
  const missing = structuredClone(candidate); missing.payload.adoption_effect.covered.pop();
  assert.equal(revisionChecks(missing, before, after, "format_only").covered, false);
  const stale = structuredClone(candidate); stale.payload.adoption_effect.expected_base_versions[0].version = 2;
  assert.equal(revisionChecks(stale, before, after, "format_only").versions, false);
  assert.equal(revisionChecks(candidate, before, before, "format_only").superseded, false);
});
test("排版删字、内容越界和新建章节均被证据校验拒绝", () => {
  const { before, candidate, after } = fixture();
  const truncated = structuredClone(candidate); truncated.payload.formatting_preview = truncated.payload.formatting_preview.slice(0, -1);
  assert.equal(revisionChecks(truncated, before, after, "format_only").change, false);
  const revision = structuredClone(candidate); revision.payload.modification_scope = "target_segments"; revision.artifact_type = "prose_fragment";
  const expected = b28ExpectedAgeReplacement(candidate.payload.base_text);
  revision.payload.content = expected.replacement;
  revision.payload.adoption_effect = { mode: "replace_segments", covered: candidate.payload.adoption_effect.covered,
    base_versions: candidate.payload.adoption_effect.expected_base_versions,
    target_segment_ids: [expected.segment_id], expected_segment_hashes: [{ segment_id: expected.segment_id, sha256: expected.sha256 }] };
  const applied = structuredClone(after); applied.drafts.at(-1).content = expected.final_text;
  assert(Object.values(revisionChecks(revision, before, applied, "target_segments")).every(Boolean));
  const wrongHash = structuredClone(revision); wrongHash.payload.adoption_effect.expected_segment_hashes[0].sha256 = "wrong";
  assert.equal(revisionChecks(wrongHash, before, applied, "target_segments").change, false);
  revision.payload.content += "另改一句";
  assert.equal(revisionChecks(revision, before, applied, "target_segments").change, false);
  const extraChapter = { ...after, chapters: [...after.chapters, { id: "wrong", seq: 2 }] };
  assert.equal(revisionChecks(candidate, before, extraChapter, "format_only").identity, false);
});

test("ADR-0029拒绝原样/只加首尾空行/改字/缺计划类型；单换行的真实新段落有效", () => {
  const { candidate } = fixture(), source = candidate.payload.base_text;
  assert(b28FormattingPlanMatches(candidate, source));
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  for (const preview of [source, "\n" + source, source + "\n", source.replace("沈砚", "别名")]) {
    const invalid = structuredClone(candidate);
    invalid.payload.formatting_preview = preview;
    invalid.payload.adoption_effect.preview_hash = hash(preview);
    assert.equal(b28FormattingPlanMatches(invalid, source), false);
  }
  const legacy = structuredClone(candidate); legacy.artifact_type = "prose_fragment";
  assert.equal(b28FormattingPlanMatches(legacy, source), false);
  const changedPlan = structuredClone(candidate); changedPlan.payload.items[0].line_break_changes = [{ boundary_id: "different", lines: 2 }];
  assert.equal(b28FormattingPlanMatches(changedPlan, source), false);
});
