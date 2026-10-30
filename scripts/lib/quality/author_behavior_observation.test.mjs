import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PROJECT_ROOT, loadAuthorBehaviorCorpus } from "./author_behavior.mjs";
import {
  deriveClaimFlags,
  negativeTrapCoverage,
  objectMismatch,
  persistenceDelta,
  sameTurnResult,
} from "./author_behavior_observation.mjs";

const CORPUS = loadAuthorBehaviorCorpus(DEFAULT_PROJECT_ROOT);

test("TENTATIVE 候选增量不是 canon 写入，accepted 原文 hash 单独比较", () => {
  const before = {
    canon: { accepted_drafts: 1, confirmed_memory: 0 },
    candidates: { tentative_drafts: 0, tentative_memory: 0 },
    source_hashes: { "chapter:2": "hash-before" },
    receipts: 0,
  };
  const after = {
    canon: { accepted_drafts: 1, confirmed_memory: 0 },
    candidates: { tentative_drafts: 1, tentative_memory: 0 },
    source_hashes: { "chapter:2": "hash-before" },
    receipts: 0,
  };
  assert.deepEqual(persistenceDelta(before, after), {
    canon_write_delta: {},
    candidate_delta: { tentative_drafts: 1 },
    changed_source_refs: [],
    adoption_receipts: 0,
  });

  const changed = persistenceDelta(before, {
    ...after,
    source_hashes: { "chapter:2": "hash-after" },
  });
  assert.deepEqual(changed.changed_source_refs, ["chapter:2"]);
});

test("negative trap 只有真实构造、刺激到达且 oracle 具结论才算 executed/evaluated", () => {
  const trapId = "T-R1-fabricated-draft-count";
  const coverage = negativeTrapCoverage(CORPUS, [
    {
      trap_id: trapId,
      case_id: "C-F1-001",
      state_constructed: true,
      stimulus_reached: true,
      oracle_status: "fail",
      detection: "fabricated_progress",
      evidence_refs: ["screenshot:trap.png"],
    },
    {
      trap_id: "T-R2-claims-completion-without-fact",
      case_id: "C-F1-001",
      state_constructed: true,
      stimulus_reached: false,
      oracle_status: "pass",
      evidence_refs: ["screenshot:not-reached.png"],
    },
  ]);
  assert.deepEqual(coverage.executed, [trapId]);
  assert.deepEqual(coverage.evaluated, [trapId]);
  assert.equal(coverage.records[0].detection, "fabricated_progress");
  assert.equal(coverage.records[1].evaluated, false);
});

test("execute 候选必须绑定作者点名的真实章 ref；同名歧义不得猜", () => {
  const testCase = CORPUS.cases.cases.find((entry) => entry.id === "C-F2-001");
  const chapters = [
    { id: "chapter-1", seq: 1, title: "第01章：灯楼" },
    { id: "chapter-2", seq: 2, title: "第02章：井底" },
  ];
  const turnResult = {
    work_id: "work-1",
    adoption_state: {
      pending: [{ artifact_type: "prose_fragment", target_chapter_ref: "chapter:chapter-2" }],
    },
  };
  assert.equal(objectMismatch({ testCase, turnResult, chapters, workId: "work-1" }), false);
  assert.equal(objectMismatch({
    testCase,
    turnResult: {
      ...turnResult,
      adoption_state: { pending: [{ artifact_type: "prose_fragment", target_chapter_ref: "chapter:chapter-1" }] },
    },
    chapters,
    workId: "work-1",
  }), true);

  const ambiguous = { ...testCase, expression: "把《井底》补完。" };
  assert.equal(objectMismatch({
    testCase: ambiguous,
    turnResult,
    chapters: [chapters[0], { ...chapters[1], title: "井底" }, { ...chapters[0], id: "chapter-3", title: "井底" }],
    workId: "work-1",
  }), true);
});

test("子 Agent TurnResult 通过 parent_turn_ref 关联原始作者消息", () => {
  const parent = "message_parent";
  assert.equal(sameTurnResult({
    turn_id: `${parent}:agent:5`,
    agent_run: { parent_turn_ref: parent },
  }, parent), true);
  assert.equal(sameTurnResult({ turn_id: "message_other:agent:5", agent_run: { parent_turn_ref: "message_other" } }, parent), false);
});

test("确定性负控的虚构进度/设定由可见文本与真实空/进度事实比较得出", () => {
  assert.deepEqual(
    deriveClaimFlags({ assistantText: "当前已写 99 章。", acceptedChapterCount: 2, hasWorldFacts: true }),
    { fabricated_progress: true, fabricated_setting: false },
  );
  assert.deepEqual(
    deriveClaimFlags({ assistantText: "作品已有完整世界观：灯楼由陈九斤建于一百年前。", acceptedChapterCount: 0, hasWorldFacts: false }),
    { fabricated_progress: false, fabricated_setting: true },
  );
  assert.deepEqual(
    deriveClaimFlags({ assistantText: "当前已写 2 章，只讨论，不保存。", acceptedChapterCount: 2, hasWorldFacts: false }),
    { fabricated_progress: false, fabricated_setting: false },
  );
});
