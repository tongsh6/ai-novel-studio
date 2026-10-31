import test from "node:test";
import assert from "node:assert/strict";
import {
  actionMatchesArtifact,
  isOverwriteConfirmation,
  pendingText,
  revisionOf,
} from "./lib/native_ui/adoption_contract.mjs";

test("Q1c 现役 world_setting 候选从 items body 读取内容并精确绑定 revision_of", () => {
  const source = { artifact_id: "as_source", payload: { items: [{ body: "岑舟今年二十五岁。资料校验标识nonce。" }] } };
  const revision = {
    artifact_id: "as_revision",
    payload: {
      revision_of: "as_source",
      items: [{ body: "岑舟今年三十岁。资料校验标识nonce。" }],
    },
  };
  assert(pendingText(source).includes("二十五岁"));
  assert(pendingText(revision).includes("三十岁"));
  assert.equal(revisionOf(revision), source.artifact_id);
  assert.notEqual(revisionOf(revision), revision.artifact_id);
});

test("Q1c 覆盖确认兼容 action_result 与 turn_result 的现役形状", () => {
  assert(isOverwriteConfirmation({ status: "needs_confirmation" }));
  assert(isOverwriteConfirmation({ adoption_decision: { decision_type: "require_confirmation" } }));
  assert(isOverwriteConfirmation({ truthfulness: { reason_codes: ["overwrite_existing_canon"] } }));
  assert(!isOverwriteConfirmation({ status: "accepted" }));
});

test("Q1c 采纳回执必须绑定本轮候选或动作，旧回执不能复用", () => {
  assert(actionMatchesArtifact({ target_ref: "as_revision" }, "as_revision"));
  assert(actionMatchesArtifact({ decision: { candidate_ref: "as_revision" } }, "as_revision"));
  assert(actionMatchesArtifact({ action_id: "accept:as_revision" }, "as_other", "accept:as_revision"));
  assert(!actionMatchesArtifact({ target_ref: "as_source" }, "as_revision"));
});
