import assert from "node:assert/strict";
import test from "node:test";
import {
  actionMatchesArtifact,
  actionResultBindsArtifact,
  actionResultIdentityFor,
  isOverwriteConfirmation,
  pendingText,
  revisionOf,
  turnMatchesMessage,
} from "./adoption_contract.mjs";

test("pendingText 合并 payload/top-level items 与正文，忽略空值", () => {
  assert.equal(
    pendingText({
      payload: { content: "payload-content", items: [{ body: "b1", content: "c1" }] },
      content: "top-content",
      items: [{ body: "b2" }],
    }),
    "payload-content\ntop-content\nb1\nc1\nb2",
  );
  assert.equal(pendingText(null), "");
});

test("revisionOf 保持既有字段优先级并返回 null 缺省", () => {
  assert.equal(revisionOf({ payload: { revision_of: "payload" } }), "payload");
  assert.equal(revisionOf({ payload: { items: [{ revision_of: "item" }] } }), "item");
  assert.equal(revisionOf({ revision_of_ref: "ref" }), "ref");
  assert.equal(revisionOf({ payload: { revision_of_ref: "payload-ref" } }), "payload-ref");
  assert.equal(revisionOf({ revision_of: "plain" }), "plain");
  assert.equal(revisionOf(null), null);
});

test("isOverwriteConfirmation 覆盖 status/decision/reason_codes", () => {
  assert.equal(isOverwriteConfirmation({ status: "needs_confirmation" }), true);
  assert.equal(isOverwriteConfirmation({ status: "requires_confirmation" }), true);
  assert.equal(isOverwriteConfirmation({ adoption_decision: { decision_type: "require_confirmation" } }), true);
  assert.equal(isOverwriteConfirmation({ decision_type: "require_confirmation" }), true);
  assert.equal(isOverwriteConfirmation({ truthfulness: { reason_codes: ["overwrite_existing_canon"] } }), true);
  assert.equal(isOverwriteConfirmation({ status: "accepted" }), false);
  assert.equal(isOverwriteConfirmation(null), false);
});

test("actionMatchesArtifact 只按现有 artifact/candidate/target 语义匹配", () => {
  assert.equal(actionMatchesArtifact({ artifact_id: "a" }, "a"), true);
  assert.equal(actionMatchesArtifact({ target_ref: "a" }, "a"), true);
  assert.equal(actionMatchesArtifact({ decision: { candidate_ref: "a" } }, "a"), true);
  assert.equal(actionMatchesArtifact({ decision: { target_ref: "artifact:a" } }, "a"), true);
  assert.equal(actionMatchesArtifact({ decision: { target_ref: "a" } }, "a"), true);
  assert.equal(actionMatchesArtifact({ action_id: "act" }, "a", "act"), true);
  assert.equal(actionMatchesArtifact({ artifact_id: "other" }, "a"), false);
  assert.equal(actionMatchesArtifact(null, "a"), false);
});

test("actionResultIdentityFor 只产生 accept→adopt 与 discard 两条合法身份", () => {
  assert.deepEqual(actionResultIdentityFor({ action_type: "accept", target_ref: "a" }), {
    action_id: "adopt:a",
    action_type: "adopt",
  });
  assert.deepEqual(actionResultIdentityFor({ action_type: "discard", target_ref: "a" }), {
    action_id: "discard:a",
    action_type: "discard",
  });
  assert.equal(actionResultIdentityFor({ action_type: "accept", target_ref: " " }), null);
  assert.equal(actionResultIdentityFor({ action_type: "other", target_ref: "a" }), null);
});

test("actionResultBindsArtifact 拒绝别名、错类型与错 artifact", () => {
  const accept = { action_type: "accept", target_ref: "a" };
  assert.equal(actionResultBindsArtifact({ action_id: "adopt:a", action_type: "adopt", artifact_id: "a" }, accept), true);
  assert.equal(actionResultBindsArtifact({ action_id: "accept:a", action_type: "accept", artifact_id: "a" }, accept), false);
  assert.equal(actionResultBindsArtifact({ action_id: "adopt:a", action_type: "adopt", artifact_id: "other" }, accept), false);
  assert.equal(actionResultBindsArtifact({ action_id: "adopt:a", action_type: "discard", artifact_id: "a" }, accept), false);
  const discard = { action_type: "discard", target_ref: "a" };
  assert.equal(actionResultBindsArtifact({ action_id: "discard:a", action_type: "discard", artifact_id: "a" }, discard), true);
});

test("turnMatchesMessage 绑定 turn_id 或 agent_run.parent_turn_ref", () => {
  assert.equal(turnMatchesMessage({ turn_id: "t" }, "t"), true);
  assert.equal(turnMatchesMessage({ agent_run: { parent_turn_ref: "t" } }, "t"), true);
  assert.equal(turnMatchesMessage({ turn_id: "other" }, "t"), false);
  assert.equal(turnMatchesMessage(null, "t"), false);
});

test("空 payload/空 items/空 entry 不崩溃且保持缺省", () => {
  assert.equal(pendingText({ payload: {}, items: [null, { body: null }] }), "");
  assert.equal(pendingText({ payload: null, items: null }), "");
  assert.equal(revisionOf({ payload: {}, revision_of_ref: null, revision_of: null }), null);
  assert.equal(revisionOf({ payload: { items: [] } }), null);
  assert.equal(actionMatchesArtifact({ decision: null, artifact_id: null, target_ref: null }, "a"), false);
  assert.equal(actionMatchesArtifact({ action_id: null, artifact_id: "a" }, "a", null), true);
  assert.equal(actionResultBindsArtifact(null, { action_type: "accept", target_ref: "a" }), false);
  assert.equal(actionResultIdentityFor({ action_type: "accept" }), null);
  assert.equal(turnMatchesMessage({ agent_run: null }, "t"), false);
});
