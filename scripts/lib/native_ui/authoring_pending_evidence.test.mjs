// B71 CP4b pending 对话候选作者边界：纯判据正反例。
//
// 只消费外部 AX 节点、真实 author_action 帧、同次 Provider 记录与 scope facts；
// 不启动 GUI/Mix，不写产品路径。负例必须显式失败关闭，不能回退 first/last。
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { scopeWireMessage } from "./fixtures/authoring_request_ir.mjs";
import { authorBoundary } from "./authoring_g2_evidence.mjs";
// 真实批次 cp4b-pending-02 的原始 AX dump（nonce 脱敏）：Why/候选 article/动作按钮是
// 同一 AXWebArea 下的同级兄弟，用于锁定扁平树定位语义，不用合成完美树替代真实形状。
const FLAT_AX = JSON.parse(
  fs.readFileSync(new URL("./fixtures/b71-pending-flat-ax-dual-candidates.json", import.meta.url), "utf8"),
);
const FLAT_NODES = FLAT_AX.nodes;
const FLAT_ITEMS = FLAT_AX.items;
const FLAT_ARTIFACTS = [FLAT_ITEMS.source, FLAT_ITEMS.revision].map((item) => ({
  artifact_id: item.artifact_id, artifact_type: "world_setting",
  payload: { items: [{ item_id: item.artifact_id + ":item", title: item.itemTitle, body: item.itemBody }] },
}));
import {
  actionAck,
  actionFrame,
  actionLabelsFor,
  actionResult,
  actionTurnResult,
  canonTableSignature,
  followupReplyChecks,
  isPendingWaitMiss,
  locatePendingItem,
  locateScopedButton,
  locateWhyButton,
  resolvedEntry,
  scopeFactsChecks,
  scopeFactsFromRequest,
  selectPendingAction,
  writerArtifactMatch,
} from "./authoring_pending_evidence.mjs";

const WORK = "11111111-1111-4111-8111-111111111111";
const SESSION = "33333333-3333-4333-8333-333333333333";
const SOURCE_TURN = "turn-source";
const REVISION_TURN = "turn-revision";
const USER_TURN = "turn-followup";
const SOURCE_ID = "as-source";
const REVISION_ID = "as-revision";
const SOURCE_BODY = "把这份大纲直接存档为作品设定：主角沈砚经营旧书铺。校验标识abc。";
const REVISION_BODY = "把这份大纲直接存档为作品设定：主角林渡经营旧书铺。校验标识abc。";
const SOURCE_TITLE = "把这份大纲直接存档为作品设定：主角沈砚经营旧书铺";
const REVISION_TITLE = "旧书铺修订稿";
const ACCEPT_LABEL = "保存到作品档案";
const DISCARD_LABEL = "不保存";

function node(path, role, fields = {}) {
  return { path, role, frame: [10, 10, 120, 20], ...fields };
}

function text(path, value) {
  return node(path, "AXStaticText", { value });
}

function button(path, title) {
  return node(path, "AXButton", { title });
}

function itemTree(prefix, title, body, labels = []) {
  return [
    node(prefix, "AXGroup", { subrole: "AXDocumentArticle" }),
    node(prefix + "/0", "AXGroup"),
    text(prefix + "/0/0", title),
    node(prefix + "/1", "AXGroup"),
    text(prefix + "/1/0", body),
    ...labels.map(([suffix, label]) => button(prefix + "/" + (Number(suffix) + 2), label)),
  ];
}

function authorTree(container, message, children) {
  return [
    node(container, "AXGroup"),
    node(container + "/0", "AXGroup"),
    text(container + "/0/0", "你"),
    node(container + "/1", "AXGroup"),
    text(container + "/1/0", message),
    ...children,
  ];
}

function artifact(id, items) {
  return { artifact_id: id, artifact_type: "outline_draft",
    payload: { items: items.map((item, index) => ({ item_id: id + ":" + index, ...item })) } };
}

const SOURCE_ARTIFACT = artifact(SOURCE_ID, [{ title: SOURCE_TITLE, body: SOURCE_BODY }]);
const REVISION_ARTIFACT = artifact(REVISION_ID, [{ title: REVISION_TITLE, body: REVISION_BODY }]);
const KNOWN_ARTIFACTS = [SOURCE_ARTIFACT, REVISION_ARTIFACT];
const SOURCE_MESSAGE = "请生成旧书铺设定。";
const REVISION_MESSAGE = "请修订旧书铺设定。";

function contextFor(nodes, candidate, message, options = {}) {
  const item = candidate.payload.items[0];
  return { itemTitle: item.title, itemBody: item.body, artifact: candidate,
    knownArtifacts: KNOWN_ARTIFACTS, authorBoundary: authorBoundary(nodes, message, 0), ...options };
}

function action(overrides = {}) {
  return {
    action_id: `accept:${REVISION_ID}`,
    action_type: "accept",
    idempotency_key: `idem:${REVISION_TURN}:accept:${REVISION_ID}`,
    source_turn_ref: REVISION_TURN,
    target_ref: REVISION_ID,
    enabled: true,
    ...overrides,
  };
}

function frameRecord(direction, at, frame, path = null) {
  return { direction, at, frame, ...(path ? { path } : {}) };
}

function sentAction(at, payload) {
  return frameRecord("sent", at, ["join-2", "ref-2", "workspace:" + WORK, "author_action", { action: payload }]);
}

function ackAt(at, identity, response) {
  return frameRecord("received", at, [identity[0], identity[1], identity[2], "phx_reply", { status: "ok", response }]);
}

function broadcast(at, event, body) {
  return frameRecord("received", at, [null, null, "workspace:" + WORK, event, body]);
}

test("AX 定位按真实 artifact 和当前作者块选择按钮，不取全局 first/last", () => {
  const nodes = [
    ...authorTree("0/1", SOURCE_MESSAGE, itemTree("0/1/2", SOURCE_TITLE, SOURCE_BODY, [["0", ACCEPT_LABEL], ["1", DISCARD_LABEL]])),
    ...authorTree("0/2", REVISION_MESSAGE, itemTree("0/2/2", REVISION_TITLE, REVISION_BODY, [["0", ACCEPT_LABEL], ["1", DISCARD_LABEL]])),
  ];
  const revision = locateScopedButton(nodes, { ...contextFor(nodes, REVISION_ARTIFACT, REVISION_MESSAGE), label: ACCEPT_LABEL });
  assert.equal(revision.ok, true);
  assert.equal(revision.button.path, "0/2/2/2");
  const original = locateScopedButton(nodes, { ...contextFor(nodes, SOURCE_ARTIFACT, SOURCE_MESSAGE), label: DISCARD_LABEL });
  assert.equal(original.ok, true);
  assert.equal(original.button.path, "0/1/2/3");
});

test("同一作者块内两 artifact 各有同名按钮时，只取自己的结构；不能借唯一他方动作", () => {
  const nodes = authorTree("0/1", SOURCE_MESSAGE, [
    ...itemTree("0/1/2", SOURCE_TITLE, SOURCE_BODY, [["0", ACCEPT_LABEL]]),
    ...itemTree("0/1/3", REVISION_TITLE, REVISION_BODY, [["0", ACCEPT_LABEL]]),
  ]);
  const options = { ...contextFor(nodes, SOURCE_ARTIFACT, SOURCE_MESSAGE), label: ACCEPT_LABEL };
  assert.equal(locateScopedButton(nodes, options).button.path, "0/1/2/2");
  const missing = nodes.filter((entry) => entry.path !== "0/1/2/2");
  const denied = locateScopedButton(missing, { ...options, authorBoundary: authorBoundary(missing, SOURCE_MESSAGE, 0) });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "foreign_item_in_block");
  assert.equal(locateScopedButton(nodes, { ...options, knownArtifacts: undefined }).reason, "known_artifacts_missing");
});

test("当前作者块缺动作时，不能向 root 或旧作者回合借唯一按钮", () => {
  const nodes = [
    node("0", "AXGroup"),
    node("0/0", "AXGroup"), text("0/0/0", "你"),
    node("0/1", "AXGroup"), text("0/1/0", SOURCE_MESSAGE),
    ...itemTree("0/2", SOURCE_TITLE, SOURCE_BODY),
    button("0/3", ACCEPT_LABEL),
    node("0/4", "AXGroup"), text("0/4/0", "你"),
    node("0/5", "AXGroup"), text("0/5/0", REVISION_MESSAGE),
    ...itemTree("0/6", REVISION_TITLE, REVISION_BODY),
  ];
  const result = locateScopedButton(nodes, { ...contextFor(nodes, REVISION_ARTIFACT, REVISION_MESSAGE), label: ACCEPT_LABEL });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "action_missing");
  assert.equal(result.button, undefined);
});

test("同文新作者回合尚无新卡时，唯一旧卡也不能冒充本轮", () => {
  const message = "请再生成同一份候选。";
  const nodes = [
    node("0", "AXGroup"),
    node("0/0", "AXGroup"), text("0/0/0", "你"),
    node("0/1", "AXGroup"), text("0/1/0", message),
    ...itemTree("0/2", REVISION_TITLE, REVISION_BODY, [["0", ACCEPT_LABEL]]),
    node("0/3", "AXGroup"), text("0/3/0", "你"),
    node("0/4", "AXGroup"), text("0/4/0", message),
  ];
  const boundary = authorBoundary(nodes, message, 1);
  assert.equal(boundary.author.path, "0/4/0");
  const options = { ...contextFor(nodes, REVISION_ARTIFACT, message), authorBoundary: boundary, label: ACCEPT_LABEL };
  assert.equal(locateScopedButton(nodes, options).reason, "item_outside_author_block");
  assert.equal(locatePendingItem(nodes, options).reason, "item_outside_author_block");
});

test("一个真实 artifact 的十二个 article 可共用唯一保存动作，每个条目仍单独定位", () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    title: "第" + (index + 1) + "章", body: "第" + (index + 1) + "章的独立规划正文。",
  }));
  const candidate = artifact("as-outline-twelve", items);
  const message = "请规划后续章节，保持待采纳。";
  const nodes = authorTree("0", message, [
    ...items.flatMap((item, index) => itemTree("0/" + (index + 2), item.title, item.body)),
    button("0/14", "保存到大纲"),
  ]);
  for (const [index, item] of items.entries()) {
    const options = { ...contextFor(nodes, candidate, message, { knownArtifacts: [candidate] }),
      itemTitle: item.title, itemBody: item.body, label: "保存到大纲" };
    const result = locateScopedButton(nodes, options);
    assert.equal(result.ok, true, item.title);
    assert.equal(result.item_path, "0/" + (index + 2));
    assert.equal(result.button.path, "0/14");
  }
  const other = artifact("as-outline-other", [{ title: "另一份大纲", body: "另一候选正文。" }]);
  const mixed = [...nodes, ...itemTree("0/15", other.payload.items[0].title, other.payload.items[0].body)];
  const denied = locateScopedButton(mixed, {
    ...contextFor(mixed, candidate, message, { knownArtifacts: [candidate, other] }), label: "保存到大纲",
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "foreign_item_in_block");
});

test("同一 artifact 也不能把分属两个 article 的标题和正文拼成一个条目", () => {
  const items = [{ title: "甲章", body: "甲章正文。" }, { title: "乙章", body: "乙章正文。" }];
  const candidate = artifact("as-split-items", items);
  const message = "请展示这份大纲。";
  const nodes = authorTree("0", message, [
    ...itemTree("0/2", items[0].title, items[1].body),
    ...itemTree("0/3", items[1].title, items[0].body),
    button("0/4", "保存到大纲"),
  ]);
  const options = { ...contextFor(nodes, candidate, message, { knownArtifacts: [candidate] }), label: "保存到大纲" };
  assert.equal(locatePendingItem(nodes, options).reason, "item_missing");
  assert.equal(locateScopedButton(nodes, options).reason, "item_missing");
});

test("artifact 原始分组缺失、混入、改写、重复 ID 或重复条目均失败关闭", () => {
  const nodes = authorTree("0", SOURCE_MESSAGE, itemTree("0/2", SOURCE_TITLE, SOURCE_BODY, [["0", ACCEPT_LABEL]]));
  const base = { ...contextFor(nodes, SOURCE_ARTIFACT, SOURCE_MESSAGE), label: ACCEPT_LABEL };
  const cases = [
    ["known_artifacts_missing", { knownArtifacts: [] }],
    ["artifact_not_known", { artifact: { ...SOURCE_ARTIFACT, artifact_id: "as-unknown" } }],
    ["artifact_not_known", { artifact: { ...SOURCE_ARTIFACT, revision_base: REVISION_ID } }],
    ["known_artifacts_invalid", { knownArtifacts: [SOURCE_ARTIFACT, structuredClone(SOURCE_ARTIFACT)] }],
    ["known_artifacts_invalid", { knownArtifacts: [{ ...SOURCE_ARTIFACT, payload: { items: [] } }] }],
    ["artifact_item_missing", { artifact: REVISION_ARTIFACT }],
    ["artifact_item_ambiguous", { knownArtifacts: [SOURCE_ARTIFACT, artifact("as-copy", SOURCE_ARTIFACT.payload.items)] }],
    ["author_boundary_missing", { authorBoundary: undefined }],
  ];
  for (const [reason, change] of cases) {
    const result = locateScopedButton(nodes, { ...base, ...change });
    assert.equal(result.ok, false, reason);
    assert.equal(result.reason, reason);
  }
  const duplicateItems = artifact("as-duplicate-items", [SOURCE_ARTIFACT.payload.items[0], SOURCE_ARTIFACT.payload.items[0]]);
  assert.equal(locateScopedButton(nodes, { ...base, artifact: duplicateItems, knownArtifacts: [duplicateItems] }).reason,
    "artifact_item_ambiguous");
});

test("AX 定位保留缺条目、重复同文条目、多义、禁用和不可见按钮拒绝", () => {
  const nodes = authorTree("0", REVISION_MESSAGE,
    itemTree("0/2", REVISION_TITLE, REVISION_BODY, [["0", ACCEPT_LABEL], ["1", ACCEPT_LABEL]]));
  const options = { ...contextFor(nodes, REVISION_ARTIFACT, REVISION_MESSAGE), label: ACCEPT_LABEL };
  assert.equal(locateScopedButton(nodes, options).reason, "action_ambiguous");
  assert.equal(locateScopedButton(nodes, { ...options, itemTitle: "不存在" }).reason, "item_missing");
  const duplicates = [...nodes, ...itemTree("0/3", REVISION_TITLE, REVISION_BODY, [["0", ACCEPT_LABEL]])];
  assert.equal(locateScopedButton(duplicates, { ...options, authorBoundary: authorBoundary(duplicates, REVISION_MESSAGE, 0) }).reason,
    "item_ambiguous");
  for (const [field, value, reason] of [
    ["enabled", false, "action_disabled"],
    ["frame", [0, 0, 0, 0], "action_not_visible"],
  ]) {
    const changed = nodes.filter((entry) => entry.path !== "0/2/3").map((entry) =>
      entry.path === "0/2/2" ? { ...entry, [field]: value } : entry);
    assert.equal(locateScopedButton(changed, { ...options, authorBoundary: authorBoundary(changed, REVISION_MESSAGE, 0) }).reason, reason);
  }
});

test("Why 仅在真实 artifact 所属作者块定位，缺按钮和多义不借其他回合", () => {
  const nodes = [
    ...authorTree("0/1", SOURCE_MESSAGE, [...itemTree("0/1/2", SOURCE_TITLE, SOURCE_BODY), button("0/1/3", "为什么")]),
    ...authorTree("0/2", REVISION_MESSAGE, [...itemTree("0/2/2", REVISION_TITLE, REVISION_BODY), button("0/2/3", "为什么")]),
  ];
  const options = contextFor(nodes, REVISION_ARTIFACT, REVISION_MESSAGE);
  assert.equal(locateWhyButton(nodes, options).button.path, "0/2/3");
  const ambiguous = [...nodes, button("0/2/4", "为什么")];
  assert.equal(locateWhyButton(ambiguous, { ...options, authorBoundary: authorBoundary(ambiguous, REVISION_MESSAGE, 0) }).reason,
    "action_ambiguous");
  const missing = nodes.filter((entry) => entry.path !== "0/2/3");
  assert.equal(locateWhyButton(missing, { ...options, authorBoundary: authorBoundary(missing, REVISION_MESSAGE, 0) }).reason,
    "action_missing");
});

test("真实 available_actions 必须唯一定位目标；缺/重复/错绑/禁用都拒绝", () => {
  const turn = {
    turn_id: REVISION_TURN,
    available_actions: [action()],
  };
  assert.equal(selectPendingAction(turn, { artifactId: REVISION_ID, actionType: "accept" }).action_id, action().action_id);
  assert.throws(
    () => selectPendingAction({ ...turn, available_actions: [] }, { artifactId: REVISION_ID, actionType: "accept" }),
    /唯一/,
  );
  assert.throws(
    () =>
      selectPendingAction(
        { ...turn, available_actions: [action(), action({ action_id: "accept:dup" })] },
        { artifactId: REVISION_ID, actionType: "accept" },
      ),
    /唯一/,
  );
  assert.throws(
    () => selectPendingAction({ ...turn, available_actions: [action({ target_ref: SOURCE_ID })] }, { artifactId: REVISION_ID, actionType: "accept" }),
    /唯一/,
  );
  assert.throws(
    () => selectPendingAction({ ...turn, available_actions: [action({ source_turn_ref: SOURCE_TURN })] }, { artifactId: REVISION_ID, actionType: "accept" }),
    /source_turn_ref/,
  );
  assert.throws(
    () => selectPendingAction({ ...turn, available_actions: [action({ enabled: false })] }, { artifactId: REVISION_ID, actionType: "accept" }),
    /enabled/,
  );
});

test("action 帧按 topic/时窗/完整 payload 唯一绑定；错 target/source/idempotency 不混入", () => {
  const at = "2026-11-02T10:00:00.000Z";
  const payload = action();
  const wire = [sentAction(at, payload)];
  const found = actionFrame(wire, { topic: `workspace:${WORK}`, since: at, action: payload });
  assert.equal(found, wire[0]);
  assert.throws(
    () => actionFrame(wire, { topic: `workspace:${WORK}`, since: "2026-11-02T10:00:01.000Z", action: payload }),
    /实测 0/,
  );
  assert.throws(
    () => actionFrame(wire, { topic: "workspace:other", since: at, action: payload }),
    /实测 0/,
  );
  assert.throws(
    () => actionFrame([...wire, sentAction(at, { ...payload, target_ref: SOURCE_ID })], { topic: `workspace:${WORK}`, since: at, action: payload }),
    /实测 1/,
  );
  assert.throws(
    () => actionFrame([...wire, sentAction(at, { ...payload, source_turn_ref: SOURCE_TURN })], { topic: `workspace:${WORK}`, since: at, action: payload }),
    /实测 1/,
  );
});

test("author_action ACK 只接受同 join/request/topic 的唯一成功回复", () => {
  const at = "2026-11-02T10:00:00.000Z";
  const payload = action();
  const frame = sentAction(at, payload);
  const identity = ["join-2", "ref-2", `workspace:${WORK}`];
  const ok = ackAt("2026-11-02T10:00:01.000Z", identity, {
    received: true,
    action_status: "accepted",
  });
  assert.equal(actionAck([frame, ok], frame, { actionStatus: "accepted" }).response.action_status, "accepted");
  assert.throws(() => actionAck([frame], frame, { actionStatus: "accepted" }), /实测 0/);
  assert.throws(
    () => actionAck([frame, ok, { ...ok, at: "2026-11-02T10:00:02.000Z" }], frame, { actionStatus: "accepted" }),
    /实测 2/,
  );
  assert.throws(
    () => actionAck([frame, { ...ok, frame: [identity[0], "other-ref", identity[2], "phx_reply", ok.frame[4]] }], frame, { actionStatus: "accepted" }),
    /实测 0/,
  );
  assert.throws(
    () => actionAck([frame, ackAt("2026-11-02T10:00:01.000Z", identity, { received: true, action_status: "discarded" })], frame, { actionStatus: "accepted" }),
    /action_status/,
  );
  assert.throws(
    () => actionAck([frame, ackAt("2026-11-02T10:00:01.000Z", identity, { received: true, action_status: "accepted", duplicate: true })], frame, { actionStatus: "accepted" }),
    /duplicate/,
  );
});

test("action_result 只按 owning topic/发送后/action+artifact+状态唯一绑定", () => {
  const at = "2026-11-02T10:00:00.000Z";
  const payload = action();
  const result = broadcast("2026-11-02T10:00:02.000Z", "action_result", {
    action_id: `adopt:${REVISION_ID}`,
    action_type: "adopt",
    artifact_id: REVISION_ID,
    status: "accepted",
  });
  assert.equal(
    actionResult([result], { topic: `workspace:${WORK}`, since: at, action: payload, actionStatus: "accepted" }),
    result,
  );
  assert.throws(
    () => actionResult([{ ...result, at: "2026-11-02T09:59:59.000Z" }], { topic: `workspace:${WORK}`, since: at, action: payload, actionStatus: "accepted" }),
    /实测 0/,
  );
  assert.throws(
    () => actionResult([{ ...result, frame: result.frame.map((part, index) => (index === 2 ? "workspace:other" : part)) }], { topic: `workspace:${WORK}`, since: at, action: payload, actionStatus: "accepted" }),
    /实测 0/,
  );
  assert.throws(
    () => actionResult([{ ...result, frame: result.frame.map((part, index) => (index === 4 ? { ...part, artifact_id: SOURCE_ID } : part)) }], { topic: `workspace:${WORK}`, since: at, action: payload, actionStatus: "accepted" }),
    /实测 0|冲突/,
  );
  const alias = { ...result, frame: result.frame.map((part, index) => (index === 4 ? { ...part, action_id: payload.action_id } : part)) };
  assert.throws(
    () => actionResult([alias], { topic: `workspace:${WORK}`, since: at, action: payload, actionStatus: "accepted" }),
    /冲突/,
  );
});

test("动作 TurnResult 按 parent turn 唯一绑定，拒绝源/子轮次混淆", () => {
  const at = "2026-11-02T10:00:00.000Z";
  const turn = broadcast("2026-11-02T10:00:02.000Z", "turn_result", {
    turn_id: "turn-adopt",
    parent_turn_id: REVISION_TURN,
    adoption_state: { pending: [], resolved: [] },
  });
  assert.equal(
    actionTurnResult([turn], { topic: `workspace:${WORK}`, since: at, parentTurnRef: REVISION_TURN }),
    turn,
  );
  assert.throws(
    () => actionTurnResult([turn], { topic: `workspace:${WORK}`, since: at, parentTurnRef: SOURCE_TURN }),
    /实测 0/,
  );
  assert.throws(
    () =>
      actionTurnResult([turn, { ...turn, at: "2026-11-02T10:00:03.000Z" }], {
        topic: `workspace:${WORK}`,
        since: at,
        parentTurnRef: REVISION_TURN,
      }),
    /实测 2/,
  );
});

test("resolved entry 精确匹配 artifact 与状态，缺/重复/错状态失败", () => {
  const turn = {
    adoption_state: {
      pending: [],
      resolved: [{ artifact_id: REVISION_ID, adoption_status: "ACCEPTED" }],
    },
  };
  assert.equal(resolvedEntry(turn, REVISION_ID, "ACCEPTED").artifact_id, REVISION_ID);
  assert.throws(() => resolvedEntry(turn, SOURCE_ID, "DISCARDED"), /实测 0/);
  assert.throws(() => resolvedEntry(turn, REVISION_ID, "DISCARDED"), /实测 0/);
  assert.throws(
    () =>
      resolvedEntry(
        { adoption_state: { resolved: [
          { artifact_id: REVISION_ID, adoption_status: "ACCEPTED" },
          { artifact_id: REVISION_ID, adoption_status: "ACCEPTED" },
        ] } },
        REVISION_ID,
        "ACCEPTED",
      ),
    /实测 2/,
  );
});

function actionLabelInput(artifactType = "prose_fragment") {
  const artifact = { artifact_id: REVISION_ID, artifact_type: artifactType,
    payload: { items: [{ title: REVISION_TITLE, body: REVISION_BODY }] } };
  const body = { turn_id: REVISION_TURN, adoption_state: { pending: [artifact] },
    available_actions: [action()] };
  return { artifact, body };
}

test("作者动作标签复用真实终局角色，区分普通正文、质量原稿、修订稿和大纲", () => {
  const cases = [
    ["普通正文", "prose_fragment", () => {}, { accept: "保存为章节正文", discard: "不保存" }],
    ["质量原稿", "prose_fragment", ({ body }) => {
      body.available_actions.push(action({ action_id: "revise-source", action_type: "revise_from_findings" }));
    }, { accept: "保存原稿", discard: "放弃原稿" }],
    ["质量结果原稿", "scene_draft", ({ body }) => {
      body.quality_review = { findings: [{ summary: "节奏需要调整" }] };
    }, { accept: "保存原稿", discard: "放弃原稿" }],
    ["质量修订稿", "prose_fragment", ({ artifact }) => {
      artifact.revision_base = SOURCE_ID;
    }, { accept: "保存修订稿", discard: "放弃修订稿" }],
    ["已采纳章节的修订", "prose_fragment", ({ artifact, body }) => {
      artifact.payload.revision_target_status = "ACCEPTED";
      artifact.revision_base = "chapter:accepted-target";
      body.quality_review = { findings: [{ summary: "节奏需要调整" }] };
    }, { accept: "保存为章节正文", discard: "不保存" }],
    ["另一候选的修订动作", "prose_fragment", ({ body }) => {
      body.available_actions.push(action({ action_id: "revise-other", action_type: "revise_from_findings",
        target_ref: SOURCE_ID }));
    }, { accept: "保存为章节正文", discard: "不保存" }],
    ["章节大纲", "outline_draft", ({ body }) => {
      body.quality_review = { findings: [{ summary: "待审阅" }] };
    }, { accept: "保存到大纲", discard: "不保存" }],
    ["档案候选", "world_setting", () => {}, { accept: ACCEPT_LABEL, discard: DISCARD_LABEL }],
  ];
  for (const [name, type, change, expected] of cases) {
    const input = actionLabelInput(type); change(input);
    assert.deepEqual(actionLabelsFor(input.artifact, input.body), expected, name);
  }
  const unknown = actionLabelInput("unknown_type");
  assert.throws(() => actionLabelsFor(unknown.artifact, unknown.body), /未知/u);
  assert.throws(() => actionLabelsFor("prose_fragment", { revision: true }), /未知/u);
});

test("作者动作标签拒绝错候选、同 ID 改写角色或正文、歧义及缺失终局", () => {
  for (const change of [
    (input) => { input.artifact.artifact_id = SOURCE_ID; },
    (input) => { input.artifact.payload.items[0].body = "另一份正文"; },
    (input) => { input.artifact.revision_base = SOURCE_ID; },
    (input) => { input.body.adoption_state.pending = []; },
    (input) => { input.body.adoption_state.pending.push(structuredClone(input.body.adoption_state.pending[0])); },
    (input) => { input.body = null; },
  ]) {
    const input = actionLabelInput();
    input.artifact = structuredClone(input.artifact);
    change(input);
    assert.throws(() => actionLabelsFor(input.artifact, input.body), /不属于同次 TurnResult 的唯一 pending/u);
  }
});

test("只读标签不补造接受动作，保存与放弃权限仍由真实动作分别核验", () => {
  const { artifact, body } = actionLabelInput();
  body.available_actions = [action({ action_id: "discard-source", action_type: "discard" })];
  assert.deepEqual(actionLabelsFor(artifact, body), { accept: "保存为章节正文", discard: "不保存" });
  assert.throws(() => selectPendingAction(body, { artifactId: artifact.artifact_id, actionType: "accept" }), /必须唯一/u);
  assert.equal(selectPendingAction(body, { artifactId: artifact.artifact_id, actionType: "discard" }).action_type, "discard");
});

test("writer 响应与 revision 全 item 集 id/title/body/rationale 精确相等", () => {
  const item = {
    item_id: "revision-item-1",
    title: REVISION_TITLE,
    body: REVISION_BODY,
    rationale: "按作者要求修改名字，原稿保留。",
    provider_call_ref: "pcall-writer",
  };
  const artifact = { payload: { items: [item] } };
  const records = [
    {
      provider_call_ref: "pcall-judgment",
      response: { status: "ok", body: { content: "", tool_calls: [
        { id: "call-j", name: "judgment_decision", arguments: { action: "execute" } },
      ] } },
    },
    {
      provider_call_ref: "pcall-writer",
      response: { status: "ok", body: { content: "", tool_calls: [
        {
          id: "call-w",
          name: "submit_tentative_artifact",
          arguments: {
            artifact_type: "world_setting",
            items: [{ item_id: "revision-item-1", title: REVISION_TITLE, body: REVISION_BODY, rationale: "按作者要求修改名字，原稿保留。" }],
          },
        },
      ] } },
    },
  ];
  assert.deepEqual(writerArtifactMatch({ artifact, records }), {
    ok: true,
    reason: null,
    provider_call_ref: "pcall-writer",
    writer_item_count: 1,
  });
  for (const [label, changed] of [
    ["id", { ...item, item_id: "other" }],
    ["title", { ...item, title: "别的标题" }],
    ["body", { ...item, body: "别的正文" }],
    ["rationale", { ...item, rationale: "别的理由" }],
  ]) {
    const badArtifact = { payload: { items: [changed] } };
    assert.equal(writerArtifactMatch({ artifact: badArtifact, records }).ok, false, label);
  }
  const extraArtifact = {
    payload: { items: [item, { ...item, item_id: "revision-item-2" }] },
  };
  assert.equal(writerArtifactMatch({ artifact: extraArtifact, records }).ok, false);
});

test("writer arguments 支持对象、标准 JSON 字符串与 raw_arguments，非法字符串失败关闭", () => {
  const item = {
    item_id: "revision-item-args",
    title: REVISION_TITLE,
    body: REVISION_BODY,
    rationale: null,
    provider_call_ref: "pcall-args",
  };
  const artifact = { payload: { items: [item] } };
  const record = (call) => ({
    provider_call_ref: "pcall-args",
    response: { status: "ok", body: { content: "", tool_calls: [call] } },
  });
  const args = { artifact_type: "world_setting", items: [item] };
  assert.equal(writerArtifactMatch({ artifact, records: [record({ arguments: args })] }).ok, true);
  assert.equal(writerArtifactMatch({ artifact, records: [record({ arguments: JSON.stringify(args) })] }).ok, true);
  assert.equal(writerArtifactMatch({ artifact, records: [record({ raw_arguments: args })] }).ok, true);
  assert.equal(writerArtifactMatch({ artifact, records: [record({ arguments: "not-json" })] }).ok, false);
});

test("scope facts 只解析末次 Scope 元数据，按独立来源逐 ref/status/title/lineage 核对", () => {
  const facts = {
    pending_adoptions: [],
    resolved_adoptions: [
      {
        status: "DISCARDED",
        title: SOURCE_TITLE,
        artifact_ref: SOURCE_ID,
        revision_of: null,
      },
      {
        status: "ACCEPTED",
        title: REVISION_TITLE,
        artifact_ref: REVISION_ID,
        revision_of: SOURCE_ID,
      },
    ],
    pending_adoption_count: 0,
    resolved_adoption_count: 2,
    omitted_adoptions: 0,
  };
  const request = { messages: [scopeWireMessage({
    context: {
      interaction_state: facts,
      conversation_summary: '{"pending_adoptions":[],"resolved_adoptions":[]}',
    },
  })] };  assert.deepEqual(scopeFactsFromRequest(request), facts);
  const checks = scopeFactsChecks(facts, {
    source: { artifact_id: SOURCE_ID, status: "DISCARDED", title: SOURCE_TITLE, body: SOURCE_BODY, revision_of: null },
    revision: { artifact_id: REVISION_ID, status: "ACCEPTED", title: REVISION_TITLE, body: REVISION_BODY, revision_of: SOURCE_ID },
  });
  assert.equal(Object.values(checks.checks).every(Boolean), true);
  for (const patch of [
    { artifact_ref: "wrong-ref" }, { status: "ACCEPTED" },
    { title: "错标题" }, { revision_of: "wrong-source" },
  ]) {
    const changed = { ...facts, resolved_adoptions: [{ ...facts.resolved_adoptions[0], ...patch }, facts.resolved_adoptions[1]] };
    assert.equal(scopeFactsChecks(changed, {
      source: { artifact_id: SOURCE_ID, status: "DISCARDED", title: SOURCE_TITLE, revision_of: null },
      revision: { artifact_id: REVISION_ID, status: "ACCEPTED", title: REVISION_TITLE, revision_of: SOURCE_ID },
    }).checks.scope_discarded_source_exact, false);
  }
  const bad = { ...facts, pending_adoptions: [{ artifact_ref: REVISION_ID }], pending_adoption_count: 1 };
  assert.equal(
    Object.values(
      scopeFactsChecks(bad, {
        source: { artifact_id: SOURCE_ID, status: "DISCARDED", title: SOURCE_TITLE, body: SOURCE_BODY, revision_of: null },
        revision: { artifact_id: REVISION_ID, status: "ACCEPTED", title: REVISION_TITLE, body: REVISION_BODY, revision_of: SOURCE_ID },
      }).checks,
    ).every(Boolean),
    false,
  );
  assert.equal(scopeFactsFromRequest({ messages: [{ role: "user", content: "没有 section" }] }), null);
});

test("scope facts 只认最新 applied scope_update，作者引用和历史 scope 不授权", () => {
  const facts = {
    pending_adoptions: [],
    resolved_adoptions: [
      { status: "DISCARDED", artifact_ref: SOURCE_ID, title: SOURCE_TITLE, body_preview: SOURCE_BODY, revision_of: null },
      { status: "ACCEPTED", artifact_ref: REVISION_ID, title: REVISION_TITLE, body_preview: REVISION_BODY, revision_of: SOURCE_ID },
    ],
    pending_adoption_count: 0,
    resolved_adoption_count: 2,
    omitted_adoptions: 0,
  };
  const oldFacts = { ...facts, resolved_adoptions: [], resolved_adoption_count: 0 };
  const scope = (version, state) => scopeWireMessage(
    { context: { interaction_state: state } },
    { versions: { scope_revision: version } },
  );
  const authorQuote = {
    role: "user",
    content: `资料处理进度怎么样？\n以下是引用材料：\n${JSON.stringify(facts)}`,
  };
  assert.equal(scopeFactsFromRequest({ messages: [authorQuote] }), null);
  assert.deepEqual(scopeFactsFromRequest({ messages: [scope(1, oldFacts), scope(2, facts)] }), facts);
  assert.equal(scopeFactsFromRequest({ messages: [scope(1, facts), scope(2, null)] }), null);
  assert.deepEqual(scopeFactsFromRequest({ messages: [scope(1, null), scope(2, facts), authorQuote] }), facts);
  assert.equal(scopeFactsFromRequest({ messages: [scope(1, { ...facts, pending_adoptions: {} })] }), null);});

test("followup 回复必须等于同次 Provider 原字节并识别真实状态及已采纳候选", () => {
  const facts = {
    resolved_adoptions: [
      { status: "DISCARDED", title: SOURCE_TITLE, artifact_ref: SOURCE_ID },
      { status: "ACCEPTED", title: REVISION_TITLE, artifact_ref: REVISION_ID },
    ],
  };
  const reply = `当前待采纳 0 份，已处置 2 份：ACCEPTED ${REVISION_TITLE}；DISCARDED ${SOURCE_TITLE}。`;
  const turnResult = {
    assistant_message: { text: reply },
    truthfulness: { production_write_performed: false, artifact_adopted: false },
  };
  const checks = followupReplyChecks({ turnResult, providerContent: reply, facts });
  assert.equal(Object.values(checks).every(Boolean), true);
  const mismatched = followupReplyChecks({ turnResult, providerContent: "other", facts });
  assert.equal(mismatched.reply_exact_provider, false);
  const generic = followupReplyChecks({
    turnResult: { ...turnResult, assistant_message: { text: "当前共 0 章，章节索引已就绪。" } },
    providerContent: "当前共 0 章，章节索引已就绪。",
    facts,
  });
  assert.equal(generic.reply_consumes_resolved_statuses, false);
  const overreach = followupReplyChecks({
    turnResult: { ...turnResult, truthfulness: { production_write_performed: true } },
    providerContent: reply,
    facts,
  });
  assert.equal(overreach.reply_no_production_write, false);
});

// 边界矩阵：缺字段/空值/多义必须返回显式 false 或稳定错误，不能靠 TypeError 碰巧失败。
test("空值与缺字段矩阵：定位/动作/事实/回复都 fail closed", () => {
  assert.equal(locateScopedButton(null, { label: "x" }).reason, "nodes_missing");
  assert.equal(locateScopedButton([], { label: "x" }).reason, "item_input_missing");
  assert.equal(locateScopedButton([], { itemTitle: "t", itemBody: "b", label: "" }).reason, "label_missing");
  assert.equal(locateWhyButton(null, {}).reason, "nodes_missing");
  assert.throws(() => selectPendingAction(null, { artifactId: "a", actionType: "accept" }), /turn_id/);
  assert.throws(() => selectPendingAction({ turn_id: "t" }, { artifactId: "", actionType: "accept" }), /必须非空/);
  assert.throws(() => selectPendingAction({ turn_id: "t", available_actions: [{ action_type: "accept", target_ref: "a", action_id: "x", source_turn_ref: "t" }] }, { artifactId: "a", actionType: "accept" }), /缺失/);
  assert.throws(() => actionFrame([], {}), /owning topic/);
  assert.throws(() => actionFrame([], { topic: "t" }), /since/);
  assert.throws(() => actionFrame([], { topic: "t", since: "2026-01-01T00:00:00Z", action: {} }), /动作身份缺失/);
  assert.throws(() => actionAck([], null, {}), /请求身份/);
  assert.throws(() => actionAck([], { frame: [null, "r", "t", "author_action", {}] }, {}), /请求身份/);
  assert.throws(() => actionResult([], { topic: "t", since: "2026-01-01T00:00:00Z", action: { action_type: "other" }, actionStatus: "x" }), /未知动作/);
  assert.throws(() => actionTurnResult([], { topic: "t", since: "2026-01-01T00:00:00Z" }), /parentTurnRef/);
  assert.throws(() => resolvedEntry(null, "a", "ACCEPTED"), /必须恰好一条/);
  assert.deepEqual(writerArtifactMatch({ artifact: null, records: [] }), { ok: false, reason: "artifact_items_missing" });
  const fieldsMissing = writerArtifactMatch({ artifact: { payload: { items: [{ item_id: "i" }] } }, records: [] });
  assert.equal(fieldsMissing.ok, false);
  assert.equal(fieldsMissing.reason, "artifact_item_fields_missing");
  const callAmbiguous = writerArtifactMatch({ artifact: { payload: { items: [{ item_id: "i", title: "t", body: "b", rationale: null }] } }, records: [] });
  assert.equal(callAmbiguous.ok, false);
  assert.equal(callAmbiguous.reason, "provider_call_ref_ambiguous");
  assert.equal(scopeFactsFromRequest(null), null);
  assert.equal(scopeFactsFromRequest({ messages: [{ role: "assistant", content: "## 消息处置与已有产物\n{}" }] }), null);
  assert.equal(scopeFactsFromRequest({ messages: [{ role: "user", content: "## 消息处置与已有产物\n{}" }] }), null);
  const emptyChecks = scopeFactsChecks(null, { source: null, revision: null });
  assert.equal(Object.values(emptyChecks.checks).every(Boolean), false);
  assert.equal(emptyChecks.checks.scope_discarded_source_exact, false);
  assert.equal(emptyChecks.checks.scope_accepted_revision_exact, false);
  assert.equal(isPendingWaitMiss(null), false);
  assert.equal(isPendingWaitMiss({ code: "B71_PENDING_NOT_FOUND" }), true);
  assert.equal(followupReplyChecks({}).reply_present, false);
  assert.equal(followupReplyChecks({ turnResult: { assistant_message: { text: "" }, truthfulness: {} }, providerContent: null, facts: null }).reply_exact_provider, false);
});

test("action 冲突/重复/错状态边界", () => {
  const at = "2026-11-02T10:00:00.000Z";
  const payload = action();
  const frame = sentAction(at, payload);
  assert.throws(() => actionAck([frame], frame, { actionStatus: "accepted" }), /实测 0/);
  assert.throws(() => actionAck([frame, { ...frame, direction: "received" }], frame, { actionStatus: "accepted" }), /实测 0/);
  assert.throws(() => actionResult([], { topic: "t", since: at, action: payload, actionStatus: "accepted" }), /实测 0/);
  assert.throws(() => actionTurnResult([], { topic: "t", since: at, parentTurnRef: "p" }), /实测 0/);
});

test("空节点与缺字段矩阵覆盖 AX/动作/事实边界", () => {
  assert.equal(locatePendingItem([null], { itemTitle: SOURCE_TITLE, itemBody: SOURCE_BODY }).reason, "item_missing");
  assert.equal(locatePendingItem([null], { itemTitle: "", itemBody: SOURCE_BODY }).reason, "item_input_missing");
  assert.equal(locatePendingItem([], { itemTitle: SOURCE_TITLE, itemBody: SOURCE_BODY }).reason, "item_missing");
  const page = authorTree("0", SOURCE_MESSAGE,
    itemTree("0/2", SOURCE_TITLE, SOURCE_BODY, [["0", ACCEPT_LABEL]]));
  const nodes = [null, ...page];
  const options = { ...contextFor(page, SOURCE_ARTIFACT, SOURCE_MESSAGE), label: ACCEPT_LABEL };
  assert.equal(locateScopedButton(nodes, options).ok, true);
  assert.equal(locateScopedButton(nodes, { ...options, knownArtifacts: [null, ...KNOWN_ARTIFACTS] }).reason,
    "known_artifacts_invalid");
  assert.equal(locateScopedButton(nodes, { ...options, label: "no" }).reason, "action_missing");
  const noFrame = [{ ...node("0/1", "AXGroup"), frame: null }];
  assert.equal(locateScopedButton(noFrame, { ...options, itemTitle: "t", itemBody: "b", label: "x" }).reason, "item_missing");
  assert.throws(() => resolvedEntry({ adoption_state: { resolved: [null] } }, "a", "ACCEPTED"), /必须恰好一条/);
  assert.equal(scopeFactsFromRequest({ messages: [null, { role: "user", content: null }] }), null);
  const checks = scopeFactsChecks({ pending_adoptions: [], pending_adoption_count: 0, resolved_adoptions: [], resolved_adoption_count: 0, omitted_adoptions: 0 }, {});
  assert.equal(checks.checks.scope_resolved_count_exact, false);
  assert.equal(checks.checks.scope_discarded_source_exact, false);
  assert.equal(followupReplyChecks({ facts: { resolved_adoptions: [] } }).reply_present, false);
});

// 边界归一化回归：帧形状/可见性/事实 section/回复消费/写手响应都在入口一次校验，
// 缺字段不得被 optional chaining 或 fallback 当成成功。
test("AX 可见性按 frame 的 y/宽/高判定，x=0 仍可见，零高度不可见", () => {
  const base = authorTree("0", REVISION_MESSAGE, itemTree("0/2", REVISION_TITLE, REVISION_BODY));
  const visibleAtX0 = [
    ...base,
    { ...button("0/2/9", ACCEPT_LABEL), frame: [0, 10, 10, 10] },
  ];
  assert.equal(
    locateScopedButton(visibleAtX0, { ...contextFor(visibleAtX0, REVISION_ARTIFACT, REVISION_MESSAGE), label: ACCEPT_LABEL }).ok,
    true,
  );
  const zeroHeight = [
    ...base,
    { ...button("0/2/9", ACCEPT_LABEL), frame: [10, 10, 10, 0] },
  ];
  assert.equal(
    locateScopedButton(zeroHeight, { ...contextFor(zeroHeight, REVISION_ARTIFACT, REVISION_MESSAGE), label: ACCEPT_LABEL }).reason,
    "action_not_visible",
  );
  const tooShort = [
    ...base,
    { ...button("0/2/9", ACCEPT_LABEL), frame: [10, 10, 10] },
  ];
  assert.equal(
    locateScopedButton(tooShort, { ...contextFor(tooShort, REVISION_ARTIFACT, REVISION_MESSAGE), label: ACCEPT_LABEL }).reason,
    "action_not_visible",
  );
});


test("scope facts 的身份、标题及前后继证据不可缺省", () => {
  const source = { artifact_id: SOURCE_ID, status: "DISCARDED", title: SOURCE_TITLE, revision_of: null };
  const revision = { artifact_id: REVISION_ID, status: "ACCEPTED", title: REVISION_TITLE, revision_of: SOURCE_ID };
  const facts = {
    pending_adoptions: [],
    resolved_adoptions: [
      { artifact_ref: SOURCE_ID, status: "DISCARDED", title: SOURCE_TITLE, revision_of: null },
      { artifact_ref: REVISION_ID, status: "ACCEPTED", title: REVISION_TITLE, revision_of: SOURCE_ID },
    ],
    pending_adoption_count: 0, resolved_adoption_count: 2, omitted_adoptions: 0,
  };
  for (const field of ["artifact_id", "status", "title", "revision_of"]) {
    const missing = { ...source }; delete missing[field];
    assert.equal(scopeFactsChecks(facts, { source: missing, revision }).checks.scope_discarded_source_exact, false);
  }
  for (const field of ["artifact_ref", "status", "title", "revision_of"]) {
    const missing = { ...facts.resolved_adoptions[1] }; delete missing[field];
    assert.equal(scopeFactsChecks({ ...facts, resolved_adoptions: [facts.resolved_adoptions[0], missing] },
      { source, revision }).checks.scope_accepted_revision_exact, false);
  }
  const duplicate = { ...facts, resolved_adoptions: [...facts.resolved_adoptions, facts.resolved_adoptions[1]] };
  assert.equal(scopeFactsChecks(duplicate, { source, revision }).checks.scope_accepted_revision_exact, false);
});

test("followup 回复识别已采纳候选，正文片段不能替代身份", () => {
  const facts = {
    resolved_adoptions: [
      { status: "DISCARDED", title: SOURCE_TITLE, artifact_ref: SOURCE_ID },
      { status: "ACCEPTED", title: REVISION_TITLE, artifact_ref: REVISION_ID },
    ],
  };
  const check = (reply) =>
    followupReplyChecks({
      turnResult: { assistant_message: { text: reply }, truthfulness: {} },
      providerContent: reply,
      facts,
    }).reply_identifies_accepted_artifact;
  assert.equal(check(`ACCEPTED DISCARDED ${REVISION_TITLE}`), true);
  assert.equal(check(`ACCEPTED DISCARDED ${REVISION_ID}`), true);
  assert.equal(check(`ACCEPTED DISCARDED ${REVISION_BODY}`), false);
  assert.equal(check("ACCEPTED DISCARDED"), false);
});

test("writer 边界对 null item/record 失败关闭而不抛 TypeError", () => {
  const artifact = { payload: { items: [null] } };
  const missingFields = writerArtifactMatch({ artifact, records: [] });
  assert.equal(missingFields.ok, false);
  assert.equal(missingFields.reason, "artifact_item_fields_missing");
  const item = { item_id: "i", title: "t", body: "b", rationale: null, provider_call_ref: "pcall" };
  const missingRecord = writerArtifactMatch({ artifact: { payload: { items: [item] } }, records: [null] });
  assert.equal(missingRecord.ok, false);
  assert.equal(missingRecord.reason, "writer_record_missing");
});

test("action_result 的 decision.candidate_ref 指向目标时视为冲突而非静默忽略", () => {
  const at = "2026-11-02T10:00:00.000Z";
  const payload = action();
  const conflictRecord = broadcast("2026-11-02T10:00:02.000Z", "action_result", {
    action_id: "other",
    action_type: "other",
    artifact_id: "other",
    decision: { candidate_ref: REVISION_ID },
    status: "accepted",
  });
  assert.throws(
    () => actionResult([conflictRecord], { topic: `workspace:${WORK}`, since: at, action: payload, actionStatus: "accepted" }),
    /冲突/,
  );
});

test("ACK body 缺失时给稳定错误而非 TypeError", () => {
  const at = "2026-11-02T10:00:00.000Z";
  const payload = action();
  const frame = sentAction(at, payload);
  const ack = frameRecord("received", "2026-11-02T10:00:01.000Z", ["join-2", "ref-2", `workspace:${WORK}`, "phx_reply", null]);
  assert.throws(() => actionAck([frame, ack], frame, { actionStatus: "accepted" }), /ACK 未确认受理/);
});

test("actionFrame 同动作重复发送必须失败，不能取第一条", () => {
  const at = "2026-11-02T10:00:00.000Z";
  const payload = action();
  const sent = sentAction(at, payload);
  assert.throws(
    () => actionFrame([sent, { ...sent, at: "2026-11-02T10:00:01.000Z" }], { topic: `workspace:${WORK}`, since: at, action: payload }),
    /实测 2/,
  );
});

// ── 真实扁平 AX 树（真实批次 cp4b-pending-02 原始 dump，nonce 脱敏）────────────
//
// 真实 Tauri/WKWebView 中，候选 article、Why 按钮与动作按钮是同一 AXWebArea 下的
// 同级兄弟；规则是「同级兄弟顺序 + 用户消息 marker」切出本消息块，块内唯一命中，
// 并排除其它已知候选（不借兄弟候选按钮）。

function flatContext(nodes, kind) {
  const candidate = FLAT_ARTIFACTS[kind === "source" ? 0 : 1];
  const authorPath = kind === "source" ? "0/0/0/0/0/13/0" : "0/0/0/0/0/25/0";
  const message = FLAT_NODES.find((entry) => entry.path === authorPath).value;
  return { itemTitle: FLAT_ITEMS[kind].itemTitle, itemBody: FLAT_ITEMS[kind].itemBody,
    artifact: candidate, knownArtifacts: FLAT_ARTIFACTS, authorBoundary: authorBoundary(nodes, message, 0) };
}

test("真实扁平 AX 树：修订稿 Why/采纳/放弃按当前作者块唯一命中", () => {
  const revision = flatContext(FLAT_NODES, "revision");
  const why = locateWhyButton(FLAT_NODES, revision);
  assert.equal(why.ok, true);
  assert.equal(why.button.path, "0/0/0/0/0/30");
  assert.equal(why.scope_path, "0/0/0/0/0/24");
  assert.equal(why.item_path, "0/0/0/0/0/33");
  assert.equal(locateScopedButton(FLAT_NODES, { ...revision, label: "保存到作品档案" }).button.path, "0/0/0/0/0/34");
  assert.equal(locateScopedButton(FLAT_NODES, { ...revision, label: "不保存" }).button.path, "0/0/0/0/0/35");
});

test("真实扁平 AX 树：源稿动作按自身消息块命中，离屏 Why 报 action_not_visible", () => {
  const source = flatContext(FLAT_NODES, "source");
  const accept = locateScopedButton(FLAT_NODES, { ...source, label: "保存到作品档案" });
  assert.equal(accept.ok, true);
  assert.equal(accept.button.path, "0/0/0/0/0/21");
  assert.equal(accept.scope_path, "0/0/0/0/0/12");
  assert.equal(locateScopedButton(FLAT_NODES, { ...source, label: "不保存" }).button.path, "0/0/0/0/0/22");
  assert.equal(locateWhyButton(FLAT_NODES, source).reason, "action_not_visible");
});

test("真实扁平 AX 树：删掉自身动作后在当前块失败，不上升到旧候选唯一按钮", () => {
  const nodes = FLAT_NODES.filter((entry) => entry.path !== "0/0/0/0/0/34");
  const result = locateScopedButton(nodes, { ...flatContext(nodes, "revision"), label: "保存到作品档案" });
  assert.equal(result.ok, false);
  assert.equal(result.button, undefined);
  assert.equal(result.reason, "action_missing");
});

test("真实扁平 AX 树：同一消息块内动作标签重复必须 action_ambiguous", () => {
  const nodes = FLAT_NODES.map((entry) => entry.path === "0/0/0/0/0/35"
    ? { ...entry, title: "保存到作品档案" } : entry);
  const result = locateScopedButton(nodes, { ...flatContext(nodes, "revision"), label: "保存到作品档案" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "action_ambiguous");
  assert.equal(result.count, 2);
});

test("真实扁平 AX 树：跨消息块不得借用对方 Why", () => {
  const nodes = FLAT_NODES.filter((entry) => entry.path !== "0/0/0/0/0/30");
  const result = locateWhyButton(nodes, flatContext(nodes, "revision"));
  assert.equal(result.ok, false);
  assert.equal(result.button, undefined);
  assert.equal(result.reason, "action_missing");
});

test("canon 内容口径：仅账面列变化不算表变化，内容列变化仍算", () => {
  // 真实 cp4b-pending-06：restore 时 works.updated_at 被 WorkRepo.touch 推进，
  // rows_sha256 变化但 canon_sha256（内容口径）不变；不能因此误判 canon 写入。
  const snapshotOf = ({ rows, canon, count = 1 }) => ({
    tables: { works: { row_count: count, rows_sha256: rows, canon_sha256: canon } },
  });
  const base = snapshotOf({ rows: "a", canon: "c" });
  const bookkeepingOnly = snapshotOf({ rows: "b", canon: "c" });
  const contentChanged = snapshotOf({ rows: "b", canon: "d" });
  assert.equal(canonTableSignature(base, "works"), canonTableSignature(bookkeepingOnly, "works"));
  assert.notEqual(canonTableSignature(base, "works"), canonTableSignature(contentChanged, "works"));
  assert.notEqual(
    canonTableSignature(base, "works"),
    canonTableSignature(snapshotOf({ rows: "a", canon: "c", count: 2 }), "works"),
  );
  assert.equal(canonTableSignature(base, "missing"), null);
});

test("canonical IR scope_update 直接按 role/provenance/blocks 读取，未知格式不代签", () => {
  const facts = {
    pending_adoptions: [],
    resolved_adoptions: [],
    pending_adoption_count: 0,
    resolved_adoption_count: 0,
    omitted_adoptions: 0,
  };
  const content = { context: { interaction_state: facts } };
  const ir = {
    ir_version: "authoring-request-ir/v1",
    messages: [
      {
        role: "user",
        provenance: "author",
        blocks: [{ type: "text", text: "作者原话" }],
        source_refs: [],
        versions: {},
      },
      {
        role: "scope_update",
        provenance: "application",
        blocks: [{ type: "scope", content }],
        source_refs: [],
        versions: { scope_revision: 1 },
      },
    ],
    tools: [],
    projection: { tool_choice: null },
    refs: {},
  };
  assert.deepEqual(scopeFactsFromRequest(ir), facts);
  assert.equal(scopeFactsFromRequest({ ...ir, ir_version: undefined }), null);
  assert.equal(scopeFactsFromRequest({ request_format: "provider_prompt/v1" }), null);
});
