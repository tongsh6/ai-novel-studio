import test from "node:test";
import assert from "node:assert/strict";
import { discussionEvidenceChecks } from "../../native_b33_evidence.mjs";
import { buildAuthoringCanonSnapshot } from "./authoring_canon_evidence.mjs";
import { canonTables } from "./fixtures/native_b71_revision_facts.mjs";

function fixture() {
  const tables = canonTables();
  const snapshot = (rows, at) => ({
    extra_counts: { draft_versions: 0, action_receipts: 0 },
    authoring_canon: buildAuthoringCanonSnapshot({
      tables: rows, referenceLogs: [], at, includeChapterFacts: false,
    }),
  });
  return {
    tables,
    snapshot,
    evidence: {
      before: snapshot(tables, "2026-11-22T01:00:00.000Z"),
      after: snapshot(tables, "2026-11-22T01:01:00.000Z"),
      turnResult: { status: "completed", adoption_state: { pending: [] } },
      judgment: { action: "reply" },
      driverEntry: { final_kind: "turn_result", turn_status: "completed", questions: 0 },
    },
  };
}

test("B33 discussion accepts a completed reply with complete unchanged canon evidence", () => {
  const { evidence } = fixture();
  assert(Object.values(discussionEvidenceChecks(evidence)).every((value) => value === true));
});

test("B33 discussion rejects an in-place content change even when every row count stays equal", () => {
  const { tables, snapshot, evidence } = fixture();
  tables.chapters[0].title = "这一章已被悄悄改名";
  evidence.after = snapshot(tables, "2026-11-22T01:01:00.000Z");
  assert.deepEqual(
    Object.values(evidence.before.authoring_canon.tables).map((table) => table.row_count),
    Object.values(evidence.after.authoring_canon.tables).map((table) => table.row_count),
  );
  assert.equal(discussionEvidenceChecks(evidence).zero_production_write, false);
});

test("B33 discussion rejects a candidate even if a driver reports no stored row change", () => {
  const { evidence } = fixture();
  evidence.turnResult.adoption_state.pending.push({ artifact_id: "unrequested-candidate" });
  assert.equal(discussionEvidenceChecks(evidence).no_pending_candidate, false);
});

test("B33 discussion cannot become a pass through an unregistered author answer", () => {
  const { evidence } = fixture();
  evidence.driverEntry.questions = 1;
  assert.equal(discussionEvidenceChecks(evidence).no_author_supplement, false);
  evidence.driverEntry.questions = 0;
  evidence.turnResult.author_question = { question_ref: "actual-question", status: "open" };
  assert.equal(discussionEvidenceChecks(evidence).no_author_question, false);
});

test("B33 discussion does not treat a failed run or an exploration result as a final reply", () => {
  const { evidence } = fixture();
  evidence.turnResult.status = "failed";
  assert.equal(discussionEvidenceChecks(evidence).no_failed_result, false);
  evidence.turnResult.status = "completed";
  evidence.judgment.action = "explore";
  assert.equal(discussionEvidenceChecks(evidence).judgment_action_reply, false);
});

test("B33 discussion requires full snapshots and explicit candidate counts", () => {
  const { evidence } = fixture();
  delete evidence.after.extra_counts;
  assert.equal(discussionEvidenceChecks(evidence).zero_candidate_write, false);
  delete evidence.after.authoring_canon;
  assert.throws(() => discussionEvidenceChecks(evidence));
});

test("B33 discussion keeps memory reference accounting separate from canon content equality", () => {
  const { tables, snapshot, evidence } = fixture();
  tables.memory_items[0].reference_count = 1;
  tables.memory_items[0].last_referenced_at = "2026-11-22T01:00:30.000Z";
  evidence.after = snapshot(tables, "2026-11-22T01:01:00.000Z");
  const checks = discussionEvidenceChecks(evidence);
  assert.equal(checks.zero_production_write, true);
  assert.equal(checks.memory_reference_updates_accounted, false);
});
