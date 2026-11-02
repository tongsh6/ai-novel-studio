// B71 CP4b pending 对话候选作者边界：纯判据正反例。
//
// 只消费外部 AX 节点、真实 author_action 帧、同次 Provider 记录与 scope facts；
// 不启动 GUI/Mix，不写产品路径。负例必须显式失败关闭，不能回退 first/last。
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
// 真实批次 cp4b-pending-02 的原始 AX dump（nonce 脱敏）：Why/候选 article/动作按钮是
// 同一 AXWebArea 下的同级兄弟，用于锁定扁平树定位语义，不用合成完美树替代真实形状。
const FLAT_AX = JSON.parse(
  fs.readFileSync(new URL("./fixtures/b71-pending-flat-ax-dual-candidates.json", import.meta.url), "utf8"),
);
const FLAT_NODES = FLAT_AX.nodes;
const FLAT_ITEMS = FLAT_AX.items;
const FLAT_KNOWN = [FLAT_ITEMS.source, FLAT_ITEMS.revision];
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

function itemTree(prefix, title, body, labels) {
  return [
    node(prefix, "AXGroup"),
    node(`${prefix}/0`, "AXGroup"),
    text(`${prefix}/0/0`, title),
    text(`${prefix}/0/1`, body),
    ...labels.map(([suffix, label]) => button(`${prefix}/0/${suffix}`, label)),
  ];
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

test("AX 定位按候选标题/正文所属结构选按钮，不取全局 first/last", () => {
  const nodes = [
    ...itemTree("0/1/0", SOURCE_TITLE, SOURCE_BODY, [
      ["0", ACCEPT_LABEL],
      ["1", DISCARD_LABEL],
    ]),
    ...itemTree("0/2/0", REVISION_TITLE, REVISION_BODY, [
      ["0", ACCEPT_LABEL],
      ["1", DISCARD_LABEL],
    ]),
  ];
  const knownItems = [
    { itemTitle: SOURCE_TITLE, itemBody: SOURCE_BODY },
    { itemTitle: REVISION_TITLE, itemBody: REVISION_BODY },
  ];
  const revision = locateScopedButton(nodes, {
    itemTitle: REVISION_TITLE,
    itemBody: REVISION_BODY,
    label: ACCEPT_LABEL,
    knownItems,
  });
  assert.equal(revision.ok, true);
  assert.equal(revision.button.path.startsWith("0/2/0/"), true);
  const original = locateScopedButton(nodes, {
    itemTitle: SOURCE_TITLE,
    itemBody: SOURCE_BODY,
    label: DISCARD_LABEL,
    knownItems,
  });
  assert.equal(original.ok, true);
  assert.equal(original.button.path.startsWith("0/1/0/"), true);
});

test("目标自身无动作时不向共享祖先借用另一候选唯一动作", () => {
  const knownItems = [
    { itemTitle: SOURCE_TITLE, itemBody: SOURCE_BODY },
    { itemTitle: REVISION_TITLE, itemBody: REVISION_BODY },
  ];
  const nodes = [
    ...itemTree("0/1/0", SOURCE_TITLE, SOURCE_BODY, []),
    ...itemTree("0/2/0", REVISION_TITLE, REVISION_BODY, [["0", ACCEPT_LABEL]]),
  ];
  const located = locateScopedButton(nodes, {
    itemTitle: SOURCE_TITLE,
    itemBody: SOURCE_BODY,
    label: ACCEPT_LABEL,
    knownItems,
  });
  assert.equal(located.ok, false);
  assert.equal(located.reason, "action_missing");
  assert.equal(
    locateScopedButton(nodes, { itemTitle: SOURCE_TITLE, itemBody: SOURCE_BODY, label: ACCEPT_LABEL }).reason,
    "known_items_missing",
  );
});

test("AX 定位拒绝缺 item、重复 item、同 scope 多义按钮与不可见按钮", () => {
  const nodes = [
    ...itemTree("0/1/0", REVISION_TITLE, REVISION_BODY, [
      ["0", ACCEPT_LABEL],
      ["1", ACCEPT_LABEL],
    ]),
  ];
  assert.equal(
    locateScopedButton(nodes, { itemTitle: REVISION_TITLE, itemBody: REVISION_BODY, label: ACCEPT_LABEL, knownItems: [{ itemTitle: REVISION_TITLE, itemBody: REVISION_BODY }] }).reason,
    "action_ambiguous",
  );
  assert.equal(
    locateScopedButton(nodes, { itemTitle: "不存在", itemBody: REVISION_BODY, label: ACCEPT_LABEL, knownItems: [{ itemTitle: REVISION_TITLE, itemBody: REVISION_BODY }] }).reason,
    "item_missing",
  );
  const duplicateItems = [...nodes, ...itemTree("0/3/0", REVISION_TITLE, REVISION_BODY, [["0", ACCEPT_LABEL]])];
  assert.equal(
    locateScopedButton(duplicateItems, { itemTitle: REVISION_TITLE, itemBody: REVISION_BODY, label: ACCEPT_LABEL, knownItems: [{ itemTitle: REVISION_TITLE, itemBody: REVISION_BODY }] }).reason,
    "item_ambiguous",
  );
  const hidden = [
    ...itemTree("0/1/0", REVISION_TITLE, REVISION_BODY, []),
    { ...button("0/1/0/9", ACCEPT_LABEL), frame: [0, 0, 0, 0] },
  ];
  assert.equal(
    locateScopedButton(hidden, { itemTitle: REVISION_TITLE, itemBody: REVISION_BODY, label: ACCEPT_LABEL, knownItems: [{ itemTitle: REVISION_TITLE, itemBody: REVISION_BODY }] }).reason,
    "action_not_visible",
  );
});

test("Why 只在候选所属消息内定位，缺按钮或同消息多义均失败", () => {
  const nodes = [
    ...itemTree("0/1/0", SOURCE_TITLE, SOURCE_BODY, []),
    button("0/1/1", "为什么"),
    ...itemTree("0/2/0", REVISION_TITLE, REVISION_BODY, []),
    button("0/2/1", "为什么"),
  ];
  const knownItems = [
    { itemTitle: SOURCE_TITLE, itemBody: SOURCE_BODY },
    { itemTitle: REVISION_TITLE, itemBody: REVISION_BODY },
  ];
  const why = locateWhyButton(nodes, { itemTitle: REVISION_TITLE, itemBody: REVISION_BODY, knownItems });
  assert.equal(why.ok, true);
  assert.equal(why.button.path, "0/2/1");
  const ambiguous = [...nodes, button("0/2/2", "为什么")];
  assert.equal(
    locateWhyButton(ambiguous, { itemTitle: REVISION_TITLE, itemBody: REVISION_BODY, knownItems }).reason,
    "action_ambiguous",
  );
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

test("作者动作标签按真实 artifact 类型分派，未知类型失败关闭", () => {
  assert.deepEqual(actionLabelsFor("world_setting"), { accept: ACCEPT_LABEL, discard: DISCARD_LABEL });
  assert.deepEqual(actionLabelsFor("prose_fragment", { revision: true }), {
    accept: "保存修订稿",
    discard: "放弃修订稿",
  });
  assert.deepEqual(actionLabelsFor("prose_fragment", { revision: false }), {
    accept: "保存为章节正文",
    discard: "不保存",
  });
  assert.throws(() => actionLabelsFor("unknown_type"), /未知/);
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

test("scope facts 只解析消息处置 section 的 JSON，并逐 ref/status/body 核对", () => {
  const facts = {
    pending_adoptions: [],
    resolved_adoptions: [
      {
        status: "DISCARDED",
        title: SOURCE_TITLE,
        body_preview: SOURCE_BODY,
        artifact_ref: SOURCE_ID,
        revision_of: null,
      },
      {
        status: "ACCEPTED",
        title: REVISION_TITLE,
        body_preview: REVISION_BODY,
        artifact_ref: REVISION_ID,
        revision_of: SOURCE_ID,
      },
    ],
    pending_adoption_count: 0,
    resolved_adoption_count: 2,
    omitted_adoptions: 0,
  };
  const text = [
    "【应用数据 · scope_update】",
    "## 消息处置与已有产物",
    JSON.stringify(facts),
    "## 已采纳可修订对象",
    '{"pending_adoptions":[],"resolved_adoptions":[]}',
  ].join("\n");
  const request = { messages: [{ role: "user", content: text }] };
  assert.deepEqual(scopeFactsFromRequest(request), facts);
  const checks = scopeFactsChecks(facts, {
    source: { artifact_id: SOURCE_ID, status: "DISCARDED", title: SOURCE_TITLE, body: SOURCE_BODY, revision_of: null },
    revision: { artifact_id: REVISION_ID, status: "ACCEPTED", title: REVISION_TITLE, body: REVISION_BODY, revision_of: SOURCE_ID },
  });
  assert.equal(Object.values(checks.checks).every(Boolean), true);
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
  const scope = (version, body) => ({
    role: "user",
    content: `【应用数据 · scope_update · 以最新版本为准】\n版本：{"scope_revision":${version}}\n${body}`,
  });
  const section = (value) => `## 消息处置与已有产物\n${JSON.stringify(value)}\n`;
  const authorQuote = {
    role: "user",
    content: `资料处理进度怎么样？\n以下是引用材料：\n${section(facts)}`,
  };
  assert.equal(scopeFactsFromRequest({ messages: [authorQuote] }), null);
  assert.deepEqual(scopeFactsFromRequest({ messages: [scope(1, section(oldFacts)), scope(2, section(facts))] }), facts);
  assert.equal(scopeFactsFromRequest({ messages: [scope(1, section(facts)), scope(2, "## 当前范围\n本次没有状态供给。")] }), null);
  assert.deepEqual(scopeFactsFromRequest({ messages: [scope(1, "## 当前范围\n本次没有状态供给。"), scope(2, section(facts)), authorQuote] }), facts);
  assert.equal(scopeFactsFromRequest({ messages: [scope(1, `${section(facts)}\n${JSON.stringify(facts)}`)] }), null);
});

test("followup 回复必须等于同次 Provider 原字节并消费真实状态/已采纳全文", () => {
  const facts = {
    resolved_adoptions: [
      { status: "DISCARDED", title: SOURCE_TITLE, body_preview: SOURCE_BODY, artifact_ref: SOURCE_ID },
      { status: "ACCEPTED", title: REVISION_TITLE, body_preview: REVISION_BODY, artifact_ref: REVISION_ID },
    ],
  };
  const reply = `当前待采纳 0 份，已处置 2 份：ACCEPTED ${REVISION_TITLE}；DISCARDED ${SOURCE_TITLE}。${REVISION_BODY}`;
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

test("scope facts 同 section 多个合法 JSON 或跨 section 多义都拒绝", () => {
  const facts = { pending_adoptions: [], resolved_adoptions: [] };
  const one = `## 消息处置与已有产物\n${JSON.stringify(facts)}`;
  const two = `${one}\n${JSON.stringify(facts)}`;
  assert.equal(scopeFactsFromRequest({ messages: [{ role: "user", content: two }] }), null);
  assert.equal(scopeFactsFromRequest({ messages: [
    { role: "user", content: one },
    { role: "user", content: one },
  ] }), null);
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
  const known = [{ itemTitle: SOURCE_TITLE, itemBody: SOURCE_BODY }];
  assert.equal(locatePendingItem([null], { itemTitle: SOURCE_TITLE, itemBody: SOURCE_BODY }).reason, "item_missing");
  assert.equal(locatePendingItem([null], { itemTitle: "", itemBody: SOURCE_BODY }).reason, "item_input_missing");
  assert.equal(locatePendingItem([], { itemTitle: SOURCE_TITLE, itemBody: SOURCE_BODY }).reason, "item_missing");
  const nodes = [
    null,
    ...itemTree("0/1/0", SOURCE_TITLE, SOURCE_BODY, [["0", ACCEPT_LABEL]]),
  ];
  assert.equal(
    locateScopedButton(nodes, { itemTitle: SOURCE_TITLE, itemBody: SOURCE_BODY, label: ACCEPT_LABEL, knownItems: [null, ...known] }).ok,
    true,
  );
  assert.equal(
    locateScopedButton(nodes, { itemTitle: SOURCE_TITLE, itemBody: SOURCE_BODY, label: "no", knownItems: known }).reason,
    "action_missing",
  );
  const noFrame = [{ ...node("0/1", "AXGroup"), frame: null }];
  assert.equal(locateScopedButton(noFrame, { itemTitle: "t", itemBody: "b", label: "x", knownItems: known }).reason, "item_missing");
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
  const known = [{ itemTitle: REVISION_TITLE, itemBody: REVISION_BODY }];
  const base = itemTree("0/1/0", REVISION_TITLE, REVISION_BODY, []);
  const visibleAtX0 = [
    ...base,
    { ...button("0/1/0/9", ACCEPT_LABEL), frame: [0, 10, 10, 10] },
  ];
  assert.equal(
    locateScopedButton(visibleAtX0, { itemTitle: REVISION_TITLE, itemBody: REVISION_BODY, label: ACCEPT_LABEL, knownItems: known }).ok,
    true,
  );
  const zeroHeight = [
    ...base,
    { ...button("0/1/0/9", ACCEPT_LABEL), frame: [10, 10, 10, 0] },
  ];
  assert.equal(
    locateScopedButton(zeroHeight, { itemTitle: REVISION_TITLE, itemBody: REVISION_BODY, label: ACCEPT_LABEL, knownItems: known }).reason,
    "action_not_visible",
  );
  const tooShort = [
    ...base,
    { ...button("0/1/0/9", ACCEPT_LABEL), frame: [10, 10, 10] },
  ];
  assert.equal(
    locateScopedButton(tooShort, { itemTitle: REVISION_TITLE, itemBody: REVISION_BODY, label: ACCEPT_LABEL, knownItems: known }).reason,
    "action_not_visible",
  );
});

test("真实 scope producer 的说明文字+标准 JSON 行只取唯一事实", () => {
  const facts = {
    pending_adoptions: [],
    resolved_adoptions: [
      { status: "DISCARDED", title: SOURCE_TITLE, body_preview: SOURCE_BODY, artifact_ref: SOURCE_ID, revision_of: null },
      { status: "ACCEPTED", title: REVISION_TITLE, body_preview: REVISION_BODY, artifact_ref: REVISION_ID, revision_of: SOURCE_ID },
    ],
    pending_adoption_count: 0,
    resolved_adoption_count: 2,
    omitted_adoptions: 0,
  };
  const content = [
    "【应用数据 · scope_update · 以最新版本为准】",
    '版本：{"scope_revision":3}',
    "## 消息处置与已有产物",
    "本消息已处理以下候选：",
    JSON.stringify(facts),
    "## 已采纳可修订对象",
    '{"pending_adoptions":[],"resolved_adoptions":[]}',
  ].join("\n");
  assert.deepEqual(scopeFactsFromRequest({ messages: [{ role: "user", content }] }), facts);
});

test("scope facts 允许省略 title/revision_of，但出现时必须精确", () => {
  const facts = {
    pending_adoptions: [],
    resolved_adoptions: [
      { status: "DISCARDED", artifact_ref: SOURCE_ID, body_preview: SOURCE_BODY },
      { status: "ACCEPTED", artifact_ref: REVISION_ID, body_preview: REVISION_BODY },
    ],
    pending_adoption_count: 0,
    resolved_adoption_count: 2,
    omitted_adoptions: 0,
  };
  const source = { artifact_id: SOURCE_ID, status: "DISCARDED", body: SOURCE_BODY };
  const revision = { artifact_id: REVISION_ID, status: "ACCEPTED", body: REVISION_BODY };
  const checks = scopeFactsChecks(facts, { source, revision });
  assert.equal(checks.checks.scope_discarded_source_exact, true);
  assert.equal(checks.checks.scope_accepted_revision_exact, true);
  const bad = scopeFactsChecks(facts, {
    source: { ...source, title: "错标题" },
    revision: { ...revision, revision_of: "other" },
  });
  assert.equal(bad.checks.scope_discarded_source_exact, false);
  assert.equal(bad.checks.scope_accepted_revision_exact, false);
});

test("followup 回复消费已采纳标题或正文任一即可，两者都缺失败", () => {
  const facts = {
    resolved_adoptions: [
      { status: "DISCARDED", title: SOURCE_TITLE, body_preview: SOURCE_BODY, artifact_ref: SOURCE_ID },
      { status: "ACCEPTED", title: REVISION_TITLE, body_preview: REVISION_BODY, artifact_ref: REVISION_ID },
    ],
  };
  const check = (reply) =>
    followupReplyChecks({
      turnResult: { assistant_message: { text: reply }, truthfulness: {} },
      providerContent: reply,
      facts,
    }).reply_consumes_accepted_content;
  assert.equal(check(`ACCEPTED DISCARDED ${REVISION_TITLE}`), true);
  assert.equal(check(`ACCEPTED DISCARDED ${REVISION_BODY}`), true);
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

test("真实扁平 AX 树：修订稿 Why/采纳/放弃按消息块唯一命中", () => {
  const revision = {
    itemTitle: FLAT_ITEMS.revision.itemTitle,
    itemBody: FLAT_ITEMS.revision.itemBody,
    knownItems: FLAT_KNOWN,
  };
  const why = locateWhyButton(FLAT_NODES, revision);
  assert.equal(why.ok, true);
  assert.equal(why.button.path, "0/0/0/0/0/30");
  assert.equal(why.scope_path, "0/0/0/0/0/24");
  assert.equal(why.item_path, "0/0/0/0/0/33");

  const accept = locateScopedButton(FLAT_NODES, { ...revision, label: "保存到作品档案" });
  assert.equal(accept.ok, true);
  assert.equal(accept.button.path, "0/0/0/0/0/34");

  const discard = locateScopedButton(FLAT_NODES, { ...revision, label: "不保存" });
  assert.equal(discard.ok, true);
  assert.equal(discard.button.path, "0/0/0/0/0/35");
});

test("真实扁平 AX 树：源稿动作按自身消息块命中，离屏 Why 报 action_not_visible", () => {
  const source = {
    itemTitle: FLAT_ITEMS.source.itemTitle,
    itemBody: FLAT_ITEMS.source.itemBody,
    knownItems: FLAT_KNOWN,
  };
  const accept = locateScopedButton(FLAT_NODES, { ...source, label: "保存到作品档案" });
  assert.equal(accept.ok, true);
  assert.equal(accept.button.path, "0/0/0/0/0/21");
  assert.equal(accept.scope_path, "0/0/0/0/0/12");
  const discard = locateScopedButton(FLAT_NODES, { ...source, label: "不保存" });
  assert.equal(discard.ok, true);
  assert.equal(discard.button.path, "0/0/0/0/0/22");
  // 源稿 Why 在真实 dump 中 frame.y=-255（滚动到视口上方）：命中在块内但不可见，
  // 必须如实报 action_not_visible，不能跨块借用修订稿可见的 Why。
  const why = locateWhyButton(FLAT_NODES, source);
  assert.equal(why.ok, false);
  assert.equal(why.reason, "action_not_visible");
});

test("真实扁平 AX 树：删掉自身动作后不得借用兄弟候选按钮，也不回退全局 first/last", () => {
  const withoutRevisionAccept = FLAT_NODES.filter((node) => node.path !== "0/0/0/0/0/34");
  const located = locateScopedButton(withoutRevisionAccept, {
    itemTitle: FLAT_ITEMS.revision.itemTitle,
    itemBody: FLAT_ITEMS.revision.itemBody,
    label: "保存到作品档案",
    knownItems: FLAT_KNOWN,
  });
  assert.equal(located.ok, false);
  assert.equal(located.button, undefined);
  // 外层块会出现源稿可见文本 → 显式 foreign_item_in_block（失败关闭），而不是借用 …/21。
  assert.equal(located.reason, "foreign_item_in_block");
});

test("真实扁平 AX 树：同一消息块内动作标签重复必须 action_ambiguous", () => {
  const duplicated = FLAT_NODES.map((node) =>
    node.path === "0/0/0/0/0/35" ? { ...node, title: "保存到作品档案" } : node,
  );
  const located = locateScopedButton(duplicated, {
    itemTitle: FLAT_ITEMS.revision.itemTitle,
    itemBody: FLAT_ITEMS.revision.itemBody,
    label: "保存到作品档案",
    knownItems: FLAT_KNOWN,
  });
  assert.equal(located.ok, false);
  assert.equal(located.reason, "action_ambiguous");
  assert.equal(located.count, 2);
});

test("真实扁平 AX 树：跨消息块不得借用对方 Why", () => {
  const withoutRevisionWhy = FLAT_NODES.filter((node) => node.path !== "0/0/0/0/0/30");
  const located = locateWhyButton(withoutRevisionWhy, {
    itemTitle: FLAT_ITEMS.revision.itemTitle,
    itemBody: FLAT_ITEMS.revision.itemBody,
    knownItems: FLAT_KNOWN,
  });
  assert.equal(located.ok, false);
  assert.equal(located.button, undefined);
  assert.equal(located.reason, "foreign_item_in_block");
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
