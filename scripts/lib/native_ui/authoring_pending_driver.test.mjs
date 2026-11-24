// B71 pending 外部驱动编排的 fake-harness 行为测试：不启动 GUI、不写产品。
// 证明驱动只消费真实 TurnResult/available_actions，按候选可见标题/正文定位按钮，
// 并在 source→revision→Why→accept→action Why→discard→restore→followup 顺序推进。
import assert from "node:assert/strict";
import test from "node:test";
import { capturePendingItemViews, drivePending, revealItem, turnOutcome, waitAdoptionMaintenance } from "./authoring_pending_driver.mjs";
import { actionLabelsFor, pendingSourceMessage } from "./authoring_pending_evidence.mjs";

const WORK = "11111111-1111-4111-8111-111111111111";
const SESSION = "33333333-3333-4333-8333-333333333333";
const NONCE = "a1b2c3d4e5f60718";
const SOURCE_TURN = "turn-source";
const REVISION_TURN = "turn-revision";
const FOLLOWUP_TURN = "turn-followup";
const SOURCE_RUN = "run-source";
const REVISION_RUN = "run-revision";
const FOLLOWUP_RUN = "run-followup";
const SOURCE_ID = "as-source";
const REVISION_ID = "as-revision";
const SOURCE_BODY = pendingSourceMessage(NONCE);
const REVISION_BODY = SOURCE_BODY.replace("沈砚", "林渡");
const SOURCE_TITLE = "把这份大纲直接存档为作品设定：主角沈砚经营旧书铺";
const REVISION_TITLE = "旧书铺修订稿";
const TOPIC = `workspace:${WORK}`;
const ACCEPT_REPLY = "已通过采纳边界，采纳内容已进入已决状态。";
const FOLLOWUP_MARKDOWN_REPLY = "资料处理结果如下：\n\n- **已采纳**：林渡版已进入作品档案。\n- **已放弃**：沈砚版已放弃。\n\n当前没有待采纳候选。";

const config = {
  slice_id: "b71-authoring-pending",
  journey: "pending",
  target: { work_id: WORK, work_title: "B71 pending", session_id: SESSION },
  message: SOURCE_BODY,
  nonce: NONCE,
  revision_message: "请修改现有候选，把沈砚改成林渡，其余内容和资料校验标识保留；生成修订候选，不要保存。",
  followup_message: "资料处理进度怎么样？",
};

function node(path, role, fields = {}) {
  return { path, role, frame: [10, 10, 200, 20], ...fields };
}

function itemTree(prefix, title, body) {
  return [
    node(prefix, "AXGroup", { subrole: "AXDocumentArticle" }),
    node(`${prefix}/0`, "AXStaticText", { value: title }),
    node(`${prefix}/1`, "AXStaticText", { value: body }),
    node(`${prefix}/2`, "AXButton", { title: "保存到作品档案" }),
    node(`${prefix}/3`, "AXButton", { title: "不保存" }),
  ];
}

function authorTree(container, message, children) {
  return [
    node(container, "AXGroup"),
    node(container + "/0", "AXGroup"),
    node(container + "/0/0", "AXStaticText", { value: "你" }),
    node(container + "/1", "AXGroup"),
    node(container + "/1/0", "AXStaticText", { value: message }),
    ...children,
  ];
}

// 按真实 AX 角色/会话结构手工构造期望；不调用产品投影或 Markdown 匹配器。
const CHAT = "0/0/10";
function textGroup(path, value) {
  return [node(path, "AXGroup"), node(path + "/0", "AXStaticText", { value })];
}
function chatChrome() {
  return [
    node("0", "AXWindow"), node("0/0", "AXWebArea"),
    node("0/0/0", "AXPopUpButton", { title: "AI 助手", desc: "助手名称" }),
    node(CHAT, "AXGroup", { subrole: "AXLandmarkRegion", title: "会话消息", desc: "会话消息" }),
  ];
}
function chatTurn(offset, message, blocks, authorLabel = "你") {
  return [
    ...textGroup(CHAT + "/" + offset, authorLabel),
    ...textGroup(CHAT + "/" + (offset + 1), message),
    ...textGroup(CHAT + "/" + (offset + 2), "AI 助手"),
    ...blocks,
    node(CHAT + "/" + (offset + 9), "AXButton", { title: "为什么", desc: "查看这轮回应的依据" }),
  ];
}
function followupTree(offset = 40, { message = config.followup_message, authorLabel = "你", blocks } = {}) {
  const list = CHAT + "/" + (offset + 4);
  return chatTurn(offset, message, blocks ?? [
    ...textGroup(CHAT + "/" + (offset + 3), "资料处理结果如下："),
    node(list, "AXList", { subrole: "AXContentList" }),
    node(list + "/0", "AXGroup", { value: "已采纳：林渡版已进入作品档案。" }),
    node(list + "/0/0", "AXListMarker", { value: "•" }),
    node(list + "/0/1", "AXStaticText", { value: "已采纳：林渡版已进入作品档案。" }),
    node(list + "/1", "AXGroup", { value: "已放弃：沈砚版已放弃。" }),
    node(list + "/1/0", "AXListMarker", { value: "•" }),
    node(list + "/1/1", "AXStaticText", { value: "已放弃：沈砚版已放弃。" }),
    ...textGroup(CHAT + "/" + (offset + 5), "当前没有待采纳候选。"),
  ], authorLabel);
}
function outsideReplyCopy() {
  return textGroup("0/0/90", FOLLOWUP_MARKDOWN_REPLY);
}

function captureInput(artifact = {
  artifact_id: REVISION_ID, artifact_type: "prose_fragment",
  payload: { items: [{ item_id: "r", title: REVISION_TITLE, body: REVISION_BODY }] },
}) {
  return { artifact, knownArtifacts: [artifact], message: config.revision_message, baselineAuthorCount: 0 };
}

function whyTree(prefix) {
  return [node(`${prefix}/9`, "AXButton", { title: "为什么" })];
}

function frame(at, direction, value) {
  return { at, direction, frame: value };
}

function buildWire({ followupReply = FOLLOWUP_MARKDOWN_REPLY } = {}) {
  const at = Date.now();
  const iso = (offset) => new Date(at + offset).toISOString();
  const join = (offset, joinRef) => [
    frame(iso(offset), "sent", [joinRef, joinRef, TOPIC, "phx_join", { work_id: WORK, session_id: SESSION }]),
    frame(iso(offset), "received", [joinRef, joinRef, TOPIC, "phx_reply", { status: "ok", response: { joined: true, work_id: WORK, session_id: SESSION } }]),
  ];
  const user = (offset, joinRef, requestRef, turnId, text, runId) => [
    frame(iso(offset), "sent", [joinRef, requestRef, TOPIC, "user_message", { text, turn_id: turnId, work_id: WORK, session_id: SESSION }]),
    frame(iso(offset + 1), "received", [joinRef, requestRef, TOPIC, "phx_reply", { status: "ok", response: { run_id: runId, turn_id: turnId } }]),
  ];
  const action = (offset, requestRef, payload, status, actionType, artifactId, parentTurn, turnId) => [
    frame(iso(offset), "sent", ["join-a", requestRef, TOPIC, "author_action", { action: payload }]),
    frame(iso(offset + 1), "received", ["join-a", requestRef, TOPIC, "phx_reply", { status: "ok", response: { received: true, action_status: status } }]),
    frame(iso(offset + 1), "received", [null, null, TOPIC, "action_result", {
      action_id: actionType === "adopt" ? `adopt:${artifactId}` : payload.action_id,
      action_type: actionType,
      artifact_id: artifactId,
      status,
    }]),
    frame(iso(offset + 1), "received", [null, null, TOPIC, "turn_result", {
      turn_id: turnId,
      parent_turn_id: parentTurn,
      work_id: WORK,
      session_id: SESSION,
      assistant_message: { text: payload.action_type === "accept" ? ACCEPT_REPLY : "原稿已放弃。" },
      adoption_state: { pending: [], resolved: [{ artifact_id: artifactId, adoption_status: payload.action_type === "accept" ? "ACCEPTED" : "DISCARDED" }] },
    }]),
  ];
  const completed = (offset, runId, turnId) => frame(iso(offset), "received", [null, null, TOPIC, "agent_run_state", {
    run_id: runId, parent_turn_ref: turnId, workspace_id: WORK, work_id: WORK, session_id: SESSION, status: "completed",
  }]);
  const sourceArtifact = { artifact_id: SOURCE_ID, artifact_type: "world_setting", payload: { items: [{ item_id: "s", title: SOURCE_TITLE, body: SOURCE_BODY, rationale: null }] } };
  const revisionArtifact = { artifact_id: REVISION_ID, artifact_type: "world_setting", payload: { revision_of: SOURCE_ID, items: [{ item_id: "r", title: REVISION_TITLE, body: REVISION_BODY, rationale: "r" }] } };
  const acceptAction = { action_id: `accept:${REVISION_ID}`, action_type: "accept", idempotency_key: `idem:${REVISION_TURN}:accept:${REVISION_ID}`, source_turn_ref: REVISION_TURN, target_ref: REVISION_ID, enabled: true };
  const discardAction = { action_id: `discard:${SOURCE_ID}`, action_type: "discard", idempotency_key: `idem:${SOURCE_TURN}:discard:${SOURCE_ID}`, source_turn_ref: SOURCE_TURN, target_ref: SOURCE_ID, enabled: true };
  return {
    acceptAction,
    discardAction,
    sourceArtifact,
    revisionArtifact,
    wire: [
      ...join(0, "join-a"),
      ...user(1000, "join-a", "req-source", SOURCE_TURN, SOURCE_BODY, SOURCE_RUN),
      frame(iso(1000), "received", [null, null, TOPIC, "turn_result", {
        turn_id: SOURCE_TURN,
        work_id: WORK,
        session_id: SESSION,
        agent_run: { run_id: SOURCE_RUN, status: "running", parent_turn_ref: SOURCE_TURN },
        assistant_message: { text: "" },
        adoption_state: { pending: [sourceArtifact], resolved: [] },
        available_actions: [discardAction],
      }]),
      completed(1002, SOURCE_RUN, SOURCE_TURN),
      ...user(2000, "join-a", "req-revision", REVISION_TURN, config.revision_message, REVISION_RUN),
      frame(iso(2000), "received", [null, null, TOPIC, "turn_result", {
        turn_id: REVISION_TURN,
        work_id: WORK,
        session_id: SESSION,
        agent_run: { run_id: REVISION_RUN, status: "running", parent_turn_ref: REVISION_TURN },
        assistant_message: { text: "" },
        adoption_state: { pending: [revisionArtifact], resolved: [] },
        available_actions: [acceptAction],
      }]),
      completed(2002, REVISION_RUN, REVISION_TURN),
      frame(iso(2500), "http", null),
      ...action(3000, "req-accept", acceptAction, "accepted", "adopt", REVISION_ID, REVISION_TURN, "turn-accept"),
      { at: iso(3500), direction: "http", method: "GET", status: 200,
        path: `/api/works/${WORK}/sessions/${SESSION}/turns/turn-accept/replay`,
        scope: { kind: "replay", work_id: WORK, session_id: SESSION, turn_id: "turn-accept" },
        body_state: { complete: true, json: "valid" }, body: { work_id: WORK, session_id: SESSION, turn_id: "turn-accept" } },
      ...action(4000, "req-discard", discardAction, "discarded", "discard", SOURCE_ID, SOURCE_TURN, "turn-discard"),
      { at: iso(4500), direction: "http", method: "GET", path: `/api/works/${WORK}/sessions/resume`, status: 200 },
      ...join(5000, "join-b"),
      ...user(6000, "join-b", "req-followup", FOLLOWUP_TURN, config.followup_message, FOLLOWUP_RUN),
      frame(iso(6000), "received", [null, null, TOPIC, "turn_result", {
        turn_id: FOLLOWUP_TURN,
        work_id: WORK,
        session_id: SESSION,
        agent_run: { run_id: FOLLOWUP_RUN, status: "running", parent_turn_ref: FOLLOWUP_TURN },
        assistant_message: { text: followupReply },
        adoption_state: { pending: [], resolved: [] },
      }]),
      completed(6002, FOLLOWUP_RUN, FOLLOWUP_TURN),
    ],
  };
}

function fakeHarness(fixture, { followupNodes = followupTree(), previousFollowupNodes = [] } = {}) {
  let whyOpen = false;
  let restored = false;
  let accepted = false;
  const sentMessages = new Set();
  const harness = {
    provider: "slice_verify",
    log: [],
    captures: [],
    screenshots: [],
    wire: fixture.wire,
    nowIso: () => new Date().toISOString(),
    async runStep(_kind, _label, fn) { return fn(); },
    async rawWaitInputReady() {},
    async rawWaitWorkbenchSettled() {},
    async rawCloseAppAndRelaunch() { restored = true; },
    async rawTrySelectWork() { return true; },
    async rawTypeAndSend(text) {
      sentMessages.add(text);
      return this.wire.find((record) => record.direction === "sent" && record.frame?.[3] === "user_message" && record.frame[4]?.text === text);
    },
    ackFor(_wire, sent) {
      const turnId = sent.frame[4].turn_id;
      return this.wire.find((record) => record.direction === "received" && record.frame?.[3] === "phx_reply" && record.frame[4]?.response?.turn_id === turnId);
    },
    async pollWire(predicate) {
      for (const record of this.wire) {
        const hit = predicate(this.wire);
        if (hit) return hit;
        void record;
      }
      throw new Error("fake_wire_timeout");
    },
    async pollAx(predicate) {
      const nodes = this.dumpNodes();
      const nodeText = nodes.map((item) => [item.title, item.desc, item.value].filter(Boolean).join(" ")).join("\n");
      const text = whyOpen
        ? `${nodeText}\n参考来源\n回放只读取已保存记录，不会重新调用模型`
        : nodeText;
      const hit = predicate(text, nodes);
      if (hit) return { nodes, text };
      throw new Error("fake_ax_timeout");
    },
    async tryPollAx() { return null; },
    capture(name) { this.captures.push(name); return this.dumpNodes(); },
    dumpNodes() {
      const nodes = [
        ...chatChrome(),
        ...(sentMessages.has(config.message) ? chatTurn(10, config.message,
          itemTree(CHAT + "/13", SOURCE_TITLE, SOURCE_BODY)) : []),
        ...(sentMessages.has(config.revision_message) ? chatTurn(20, config.revision_message,
          itemTree(CHAT + "/23", REVISION_TITLE, REVISION_BODY)) : []),
        ...(accepted ? [...textGroup(CHAT + "/30", "AI 助手"), ...textGroup(CHAT + "/31", ACCEPT_REPLY),
          node(CHAT + "/32", "AXButton", { title: "为什么" })] : []),
        ...(restored ? previousFollowupNodes : []),
        ...(sentMessages.has(config.followup_message) ? followupNodes : []),
      ];
      return restored ? nodes.filter((entry) =>
        !["保存到作品档案", "不保存"].includes(entry.title)) : nodes;
    },
    ensureInput() {
      return {
        scrollTo() {},
        key() { whyOpen = false; },
      };
    },
    safeClick(node) {
      this.log.push({ op: "click", title: node.title, path: node.path });
      if (node.title === "保存到作品档案") accepted = true;
      if (node.title === "为什么") whyOpen = true;
      return { ok: true };
    },
    findButton() { return null; },
    writeDriverLog(name, value) { this.driverLog = { name, value }; },
    writeUiComplete(scope) { this.uiComplete = scope; },
  };
  return harness;
}

test("turnOutcome 缺业务结果或实际终态都不完成，真实running回复可在运行完成后交付", () => {
  assert.equal(turnOutcome([turnRecord()], turnIdentity), null);
  assert.equal(turnOutcome([turnState()], turnIdentity), null);
  assert.equal(turnOutcome([turnRecord(), turnState({ status: "running" })], turnIdentity), null);
  assert.equal(turnOutcome([turnRecord(), turnState()], turnIdentity).kind, "completed");
});

test("revealItem 用候选标题+正文定位并滚动所属 AX 结构", async () => {
  const harness = fakeHarness(buildWire());
  await harness.rawTypeAndSend(config.message);
  await harness.rawTypeAndSend(config.revision_message);
  let scrolled = null;
  harness.ensureInput = () => ({ scrollTo: (path) => { scrolled = path; }, key() {} });
  await revealItem(harness, REVISION_TITLE, REVISION_BODY);
  assert.equal(scrolled, CHAT + "/23");
});

test("drivePending 按可见候选结构完成三输入/两动作/Why/恢复/新请求", async () => {
  const fixture = buildWire();
  const harness = fakeHarness(fixture);
  const captures = [];
  await drivePending(harness, config, { capture: (name) => captures.push(name) });
  assert.deepEqual(captures, [
    "after-source",
    "after-revision",
    "before-why",
    "after-why",
    "after-accept",
    "before-accept-why",
    "after-accept-why",
    "after-discard",
    "after-restore",
    "final",
  ]);
  assert.equal(harness.uiComplete, "b71-authoring-pending");
  assert.deepEqual(harness.driverLog.value.restore, {
    resolved_non_actionable: true,
    revision_body_visible: true,
  });
  assert.equal(harness.driverLog.value.accept_action_id, fixture.acceptAction.action_id);
  assert.equal(harness.driverLog.value.discard_action_id, fixture.discardAction.action_id);
  assert.equal(harness.driverLog.value.followup_run_id, FOLLOWUP_RUN);
  assert.ok(harness.captures.includes("why"));
  assert.ok(harness.captures.includes("accept-why"));
  assert.equal(harness.driverLog.value.accept_turn_id, "turn-accept");
  assert.deepEqual(harness.log.filter(entry => entry.op === "click" && entry.title === "为什么")
    .map(entry => entry.path), [CHAT + "/29", CHAT + "/32"]);
  assert.ok(harness.captures.includes("final"));
});


test("drivePending 完整两段 Markdown 按各段 AX 交付，不要求原始空行出现在整页文本", async () => {
  const fixture = buildWire({ followupReply: "第一段说明采纳结果。\n\n第二段说明没有待处理候选。" });
  const harness = fakeHarness(fixture, { followupNodes: followupTree(40, { blocks: [
    ...textGroup(CHAT + "/43", "第一段说明采纳结果。"),
    ...textGroup(CHAT + "/44", "第二段说明没有待处理候选。"),
  ] }) });
  await drivePending(harness, config, { capture() {} });
  assert.equal(harness.uiComplete, "b71-authoring-pending");
});

test("drivePending 同文旧追问只计同文 baseline，新作者回合完整列表仍可交付", async () => {
  const harness = fakeHarness(buildWire(), { previousFollowupNodes: followupTree(40), followupNodes: followupTree(50) });
  await drivePending(harness, config, { capture() {} });
  assert.equal(harness.uiComplete, "b71-authoring-pending");
});

for (const [name, nodes, previous] of [
  ["缺末段", () => followupTree().filter(entry => !entry.path.startsWith(CHAT + "/45")), () => []],
  ["列表正文篡改", () => followupTree().map(entry => entry.path === CHAT + "/44/0/1"
    ? { ...entry, value: "已采纳：沈砚版已进入作品档案。" } : entry), () => []],
  ["仅旧同文回合", () => [], () => followupTree(40)],
  ["错作者角色", () => followupTree(40, { authorLabel: "旁观者" }), () => []],
  ["错作者原话", () => followupTree(40, { message: "另一份资料进度怎么样？" }), () => []],
  ["额外助手块", () => [...followupTree(), ...textGroup(CHAT + "/46", "AI 助手"),
    ...textGroup(CHAT + "/47", "另一条未绑定的助手回复。")], () => []],
]) {
  test("drivePending " + name + "不能借会话外完整原文交付", async () => {
    const harness = fakeHarness(buildWire(), {
      followupNodes: [...nodes(), ...outsideReplyCopy()], previousFollowupNodes: previous(),
    });
    await assert.rejects(() => drivePending(harness, config, { capture() {} }), /fake_ax_timeout|followup_reply/u);
    assert.equal(harness.uiComplete, undefined);
  });
}

const turnIdentity = {
  topic: TOPIC,
  since: "2026-11-02T10:00:00.000Z",
  runId: "run-turn",
  turnId: "turn-turn",
  workId: WORK,
  sessionId: SESSION,
};

function turnRecord(overrides = {}) {
  return {
    at: "2026-11-02T10:00:02.000Z",
    direction: "received",
    frame: [null, null, TOPIC, "turn_result", {
      turn_id: "turn-turn",
      work_id: WORK,
      session_id: SESSION,
      agent_run: { run_id: "run-turn", status: "running", parent_turn_ref: "turn-turn" },
      ...overrides,
    }],
  };
}

function turnState(extra = {}) {
  return { at: "2026-11-02T10:00:03.000Z", direction: "received",
    frame: [null, null, TOPIC, "agent_run_state", { run_id: "run-turn", parent_turn_ref: "turn-turn",
      workspace_id: WORK, work_id: WORK, session_id: SESSION, status: "completed", ...extra }] };
}

test("turnOutcome 按 owning topic/sent/work/session/parent 绑定完成，错身份与重复为冲突", () => {
  assert.equal(turnOutcome([turnRecord(), turnState()], turnIdentity).kind, "completed");
  const wrongSession = turnRecord({ session_id: "other" });
  assert.equal(turnOutcome([wrongSession], turnIdentity).reason, "turn_identity_mismatch");
  const wrongParent = turnRecord({ agent_run: { run_id: "run-turn", status: "completed", parent_turn_ref: "other" } });
  assert.equal(turnOutcome([wrongParent], turnIdentity).reason, "turn_identity_mismatch");
  const duplicate = turnRecord({}, "2026-11-02T10:00:03.000Z");
  assert.equal(turnOutcome([turnRecord(), duplicate, turnState()], turnIdentity).reason, "turn_completed_duplicate");
});

test("turnOutcome 对同 run 的 run_failed/run_cancelled 立即返回失败，不等待完成", () => {
  const base = {
    at: "2026-11-02T10:00:02.000Z",
    direction: "received",
    frame: [null, null, TOPIC, "agent_event", {
      run_id: "run-turn",
      work_id: WORK,
      session_id: SESSION,
      event_type: "run_failed",
    }],
  };
  assert.deepEqual(
    { kind: turnOutcome([base], turnIdentity).kind, status: turnOutcome([base], turnIdentity).status },
    { kind: "failed", status: "failed" },
  );
  const cancelled = { ...base, frame: [...base.frame.slice(0, 4), { ...base.frame[4], event_type: "run_cancelled" }] };
  assert.equal(turnOutcome([cancelled], turnIdentity).status, "cancelled");
  assert.equal(turnOutcome([], turnIdentity), null);
});

test("revealItem 只吞明确不支持的滚动结果，目标/权限/归属错误上抛", async () => {
  const harness = fakeHarness(buildWire());
  harness.dumpNodes = () => [
    node("0/1/2", "AXGroup"),
    node("0/1/2/0", "AXStaticText", { value: SOURCE_TITLE }),
    node("0/1/2/1", "AXStaticText", { value: SOURCE_BODY }),
  ];
  harness.ensureInput = () => ({
    scrollTo() {
      throw { reason: "target_ownership_mismatch" };
    },
  });
  await assert.rejects(() => revealItem(harness, SOURCE_TITLE, SOURCE_BODY), (error) => error.reason === "target_ownership_mismatch");
  harness.ensureInput = () => ({
    scrollTo() {
      throw { reason: "axscrolltovisible_failed" };
    },
  });
  await assert.doesNotReject(() => revealItem(harness, SOURCE_TITLE, SOURCE_BODY));
});

test("turnOutcome 对错事件/缺agent_run/非对象业务记录失败关闭", () => {
  const base = turnRecord();
  for (const malformed of [
    { ...base, frame: [null, null, TOPIC, "agent_event", base.frame[4]] },
    { ...base, frame: [null, null, TOPIC, "turn_result", {}] },
    { ...base, direction: "sent" }, null,
  ]) assert.equal(turnOutcome([malformed, turnState()], turnIdentity), null);
});

test("turnOutcome 不把业务嵌套failed或无类型event当成运行失败", () => {
  assert.equal(turnOutcome([turnRecord({ work_id: "other" })], turnIdentity).reason, "turn_identity_mismatch");
  assert.equal(turnOutcome([turnRecord({ agent_run: { run_id: "other", status: "completed", parent_turn_ref: "turn-turn" } })], turnIdentity), null);
  const failed = turnRecord({ agent_run: { run_id: "run-turn", parent_turn_ref: "turn-turn", status: "failed" } });
  assert.equal(turnOutcome([failed], turnIdentity), null);
  assert.equal(turnOutcome([{ ...failed, frame: [null, null, TOPIC, "agent_event", failed.frame[4]] }], turnIdentity), null);
  assert.equal(turnOutcome([failed, turnState({ status: "failed" })], turnIdentity).status, "failed");
});

test("drivePending 在发送帧错 work 或 ACK 缺 run_id 时拒绝", async () => {
  const wrongWork = fakeHarness(buildWire());
  wrongWork.rawTypeAndSend = async (text) => ({
    direction: "sent",
    at: new Date().toISOString(),
    frame: ["join-a", "req-x", TOPIC, "user_message", { text, turn_id: "turn-x", work_id: "other", session_id: SESSION }],
  });
  await assert.rejects(() => drivePending(wrongWork, config, { capture() {} }), /错 work/);

  const noRun = fakeHarness(buildWire());
  noRun.ackFor = () => ({
    direction: "received",
    at: new Date().toISOString(),
    frame: ["join-a", "req-source", TOPIC, "phx_reply", { status: "ok", response: { turn_id: SOURCE_TURN } }],
  });
  await assert.rejects(() => drivePending(noRun, config, { capture() {} }), /ACK 缺 run_id/);
});
test("capturePendingItemViews 等待晚到候选，再分屏采入口与保存动作而不点击", async () => {
  const harness = fakeHarness(buildWire());
  const shown = authorTree("0/2", config.revision_message, itemTree("0/2/2", REVISION_TITLE, REVISION_BODY)).map((item) =>
    item.title === "保存到作品档案" ? { ...item, title: "保存为章节正文" } : item);
  let current = [];
  const decisions = [], scrolled = [], captures = [];
  harness.dumpNodes = () => current;
  harness.pollAx = async (predicate, timeout, label) => {
    assert.equal(timeout, 10_000);
    assert.equal(label, "r05-candidate-1:item_rendered");
    decisions.push(predicate("", current));
    current = shown;
    decisions.push(predicate("", current));
    return { text: "", nodes: current };
  };
  harness.ensureInput = () => ({ scrollTo: (path) => scrolled.push(path) });
  harness.capture = (name, options) => {
    assert.deepEqual(options, { allowFullScreenFallback: false });
    captures.push(name);
    return current;
  };
  const views = await capturePendingItemViews(harness, {
    itemTitle: REVISION_TITLE, itemBody: REVISION_BODY,
    ...captureInput(), prefix: "r05-candidate-1",
    buttonLabel: "保存为章节正文",
  });
  assert.deepEqual(decisions, [false, true]);
  assert.deepEqual(scrolled, ["0/2/2", "0/2/2/0", "0/2/2/2"]);
  assert.deepEqual(captures, ["r05-candidate-1-entry", "r05-candidate-1-action"]);
  assert.deepEqual(views.map((view) => view.capture), captures);
  assert(views.every((view) => view.nodes === shown));
  assert.equal(harness.log.some((entry) => entry.op === "click"), false);
});

test("capturePendingItemViews 按同次质量原稿角色采集保存原稿，保持只读", async () => {
  const harness = fakeHarness(buildWire());
  const artifact = { artifact_id: "as-mission-original", artifact_type: "prose_fragment",
    payload: { items: [{ title: REVISION_TITLE, body: REVISION_BODY }] } };
  const body = { turn_id: "turn-mission-original", adoption_state: { pending: [artifact] },
    available_actions: [
      { action_id: "accept:as-mission-original", action_type: "accept", target_ref: artifact.artifact_id,
        source_turn_ref: "turn-mission-original", idempotency_key: "idem:turn-mission-original:accept", enabled: true },
      { action_id: "revise:as-mission-original", action_type: "revise_from_findings", target_ref: artifact.artifact_id,
        source_turn_ref: "turn-mission-original", idempotency_key: "idem:turn-mission-original:revise", enabled: true },
    ] };
  const shown = authorTree("0/2", config.revision_message, itemTree("0/2/2", REVISION_TITLE, REVISION_BODY)).map((item) =>
    item.title === "保存到作品档案" ? { ...item, title: "保存原稿" } : item);
  harness.dumpNodes = () => shown;
  harness.pollAx = async (predicate) => {
    assert.equal(predicate("", shown), true);
    return { text: "", nodes: shown };
  };
  harness.ensureInput = () => ({ scrollTo: () => {} });
  harness.capture = (name, options) => {
    assert.deepEqual(options, { allowFullScreenFallback: false });
    harness.captures.push(name);
    return shown;
  };
  const views = await capturePendingItemViews(harness, {
    itemTitle: REVISION_TITLE, itemBody: REVISION_BODY,
    ...captureInput(artifact), prefix: "mission-candidate-1",
    buttonLabel: actionLabelsFor(artifact, body).accept,
  });
  assert.deepEqual(views.map((view) => view.capture), ["mission-candidate-1-entry", "mission-candidate-1-action"]);
  assert.equal(harness.log.some((entry) => entry.op === "click"), false);
});

test("capturePendingItemViews 不借用其他候选角色动作，也不默认缺失的动作标签", async () => {
  for (const [buttonLabel, actualLabel, reason] of [
    ["保存为章节正文", "保存修订稿", /pending_view_target:action_missing:action/u],
    ["保存为章节正文", "保存原稿", /pending_view_target:action_missing:action/u],
    ["保存原稿", "保存为章节正文", /pending_view_target:action_missing:action/u],
    ["保存原稿", "保存修订稿", /pending_view_target:action_missing:action/u],
    ["保存修订稿", "保存原稿", /pending_view_target:action_missing:action/u],
    ["保存到大纲", "保存原稿", /pending_view_target:action_missing:action/u],
    [undefined, "保存为章节正文", /pending_view_target:label_missing:action/u],
  ]) {
    const harness = fakeHarness(buildWire());
    const shown = authorTree("0/2", config.revision_message, itemTree("0/2/2", REVISION_TITLE, REVISION_BODY)).map((item) =>
      item.title === "保存到作品档案" ? { ...item, title: actualLabel } : item);
    harness.dumpNodes = () => shown;
    await assert.rejects(() => capturePendingItemViews(harness, {
      itemTitle: REVISION_TITLE, itemBody: REVISION_BODY,
      ...captureInput(), prefix: "r05-candidate-1",
      buttonLabel,
    }), reason);
    assert.deepEqual(harness.captures, ["r05-candidate-1-entry"]);
    assert.equal(harness.log.some((entry) => entry.op === "click"), false);
  }
});

test("capturePendingItemViews 保留完整 artifact，多条 article 共用一个保存动作", async () => {
  const harness = fakeHarness(buildWire());
  const artifact = { artifact_id: "as-outline-group", artifact_type: "outline_draft", payload: { items: [
    { item_id: "first", title: REVISION_TITLE, body: REVISION_BODY },
    { item_id: "second", title: "后续章规划", body: "这也是同一待采纳大纲的一部分。" },
  ] } };
  const nodes = authorTree("0", config.revision_message, [
    ...itemTree("0/2", REVISION_TITLE, REVISION_BODY).filter((entry) => entry.role !== "AXButton"),
    ...itemTree("0/3", artifact.payload.items[1].title, artifact.payload.items[1].body).filter((entry) => entry.role !== "AXButton"),
    node("0/4", "AXButton", { title: "保存到大纲", enabled: true }),
  ]);
  const scrolled = [];
  harness.dumpNodes = () => nodes;
  harness.ensureInput = () => ({ scrollTo: (path) => scrolled.push(path) });
  const views = await capturePendingItemViews(harness, {
    ...captureInput(artifact), itemTitle: REVISION_TITLE, itemBody: REVISION_BODY,
    prefix: "mission-candidate-1", buttonLabel: "保存到大纲",
  });
  assert.deepEqual(views.map((view) => view.capture), ["mission-candidate-1-entry", "mission-candidate-1-action"]);
  assert.equal(scrolled.at(-1), "0/4");
  assert.equal(harness.log.some((entry) => entry.op === "click"), false);
});

test("capturePendingItemViews 新同文回合只有旧卡时拒绝，不把旧图录成新候选", async () => {
  const harness = fakeHarness(buildWire());
  const message = config.revision_message;
  harness.dumpNodes = () => [
    ...authorTree("0/1", message, itemTree("0/1/2", REVISION_TITLE, REVISION_BODY)),
    ...authorTree("0/2", message, []),
  ];
  await assert.rejects(() => capturePendingItemViews(harness, {
    ...captureInput(), baselineAuthorCount: 1, itemTitle: REVISION_TITLE, itemBody: REVISION_BODY,
    prefix: "mission-candidate-1", buttonLabel: "保存为章节正文",
  }), /pending_view_target:item_outside_author_block:entry/u);
  assert.deepEqual(harness.captures, []);
  assert.equal(harness.log.some((entry) => entry.op === "click"), false);
});

test("capturePendingItemViews 对歧义或非法目标立即拒绝，不把它们当晚到卡片", async () => {
  const duplicate = [
    ...authorTree("0/1", config.message, itemTree("0/1/2", REVISION_TITLE, REVISION_BODY)),
    ...authorTree("0/2", config.revision_message, itemTree("0/2/2", REVISION_TITLE, REVISION_BODY)),
  ];
  for (const [title, expected] of [
    [REVISION_TITLE, /pending_view_target:item_ambiguous:entry/u],
    ["", /pending_view_target:item_input_missing:entry/u],
  ]) {
    const harness = fakeHarness(buildWire());
    let reads = 0;
    harness.pollAx = async (predicate) => { reads += 1; return predicate("", duplicate); };
    await assert.rejects(() => capturePendingItemViews(harness, {
      itemTitle: title, itemBody: REVISION_BODY,
      ...captureInput(), prefix: "r05-candidate-1",
      buttonLabel: "保存为章节正文",
    }), expected);
    assert.equal(reads, 1);
    assert.deepEqual(harness.captures, []);
    assert.equal(harness.log.some((entry) => entry.op === "click"), false);
  }
});

const LIVE_PENDING_BUDGET = { batches: 1, author_sends: 3, manual_retries: 0,
  scenario_seconds: 900, input_timeout_ms: 30000, turn_timeout_ms: 240000 };
const livePendingConfig = () => ({ ...config, provider: "splash", budget: { ...LIVE_PENDING_BUDGET },
  preregistration: { model: "local/Q4-PLE4" },
  runtime: { profile: "b87-r03-splash-product-maintenance-budget" } });

function maintenanceWaitProof() {
  const bundle = buildWire(), wire = bundle.wire;
  const source = wire.find((row) => row.frame?.[3] === "turn_result" && row.frame[4].turn_id === REVISION_TURN);
  const turnResult = source.frame[4], artifact = bundle.revisionArtifact;
  Object.assign(artifact, { artifact_type: "prose_fragment", target_chapter_ref: "chapter:chapter-maintenance" });
  const sent = wire.find((row) => row.frame?.[3] === "author_action" &&
    row.frame[4].action.action_id === bundle.acceptAction.action_id);
  const result = wire.find((row) => row.frame?.[3] === "action_result" && row.frame[4].artifact_id === REVISION_ID);
  result.frame[4].persistence = { persisted: true, reading_projection: {
    chapter_id: "chapter-maintenance", source_revision_ref: "draft:accepted-prose:1",
  } };
  const acceptedAt = Date.parse(sent.at);
  const proof = { wire, artifact, turnResult, receipt: result.frame[4], clock: acceptedAt + 400,
    readRecords: [], polls: [], steps: [], acceptedAt };
  proof.records = [
    { event: "chapter_summary_maintenance.run.done", outcome: "ok", work_id: WORK,
      chapter_id: "chapter-maintenance", timestamp: new Date(acceptedAt + 500).toISOString() },
    { event: "ledger.update.done", outcome: "ok", work_id: WORK,
      chapter_id: "chapter-maintenance", timestamp: new Date(acceptedAt + 700).toISOString() },
  ];
  proof.driver = {
    transport: () => proof.wire,
    runStep: async (kind, label, run) => { proof.steps.push({ kind, label }); return run(); },
    pollWire: async () => { throw new Error("unexpected maintenance poll"); },
  };
  proof.options = { driver: proof.driver, turnResult, artifact, since: source.at,
    identity: { topic: TOPIC, workId: WORK, sessionId: SESSION, turnId: REVISION_TURN, runId: REVISION_RUN },
    deadline: acceptedAt + 1000, label: "P1", readRecords: () => proof.readRecords, now: () => proof.clock };
  return proof;
}

test("maintenance wait keeps an accepted receipt pending until summary and ledger settle within the original budget", async () => {
  const p = maintenanceWaitProof();
  p.driver.pollWire = async (read, timeout, label) => {
    p.polls.push({ timeout, label });
    assert.equal(read(p.wire), null, "the accepted action alone is not background completion");
    p.clock = p.acceptedAt + 500;
    p.readRecords = p.records.slice(0, 1);
    assert.equal(read(p.wire), null, "summary alone must not finish the wait");
    p.clock = p.acceptedAt + 800;
    p.readRecords = p.records;
    return read(p.wire);
  };
  const outcome = await waitAdoptionMaintenance(p.options);
  assert.equal(outcome.summary, p.records[0]);
  assert.equal(outcome.ledger, p.records[1]);
  assert.deepEqual(p.polls, [{ timeout: 600, label: "summary_ledger:P1" }]);
  assert.deepEqual(p.steps, [{ kind: "maintenance", label: "summary_ledger:P1" }]);
});

test("maintenance wait also settles an adopted formatting plan", async () => {
  const p = maintenanceWaitProof();
  p.artifact.artifact_type = "prose_formatting_plan";
  p.receipt.artifact_type = "prose_formatting_plan";
  p.options.label = "P2";
  p.clock = p.acceptedAt + 800;
  p.readRecords = p.records;
  p.driver.pollWire = async (read, remaining, label) => {
    assert.equal(remaining, 200);
    assert.equal(label, "summary_ledger:P2");
    return read(p.wire);
  };
  const outcome = await waitAdoptionMaintenance(p.options);
  assert.equal(outcome.summary, p.records[0]);
  assert.equal(outcome.ledger, p.records[1]);
});

test("maintenance wait returns an observed degraded pair without rewriting it as success", async () => {
  const p = maintenanceWaitProof();
  for (const row of p.records) {
    row.event = row.event.replace(".done", ".error");
    Object.assign(row, { outcome: "error", reason_code: "generation_failed", outcome_detail: "observed failure" });
  }
  p.clock = p.acceptedAt + 800;
  p.readRecords = p.records;
  p.driver.pollWire = async (read) => read(p.wire);
  const outcome = await waitAdoptionMaintenance(p.options);
  assert.equal(outcome.summary, p.records[0]);
  assert.equal(outcome.ledger, p.records[1]);
  assert.equal(outcome.summary.outcome, "error");
});

for (const [name, change] of [
  ["foreign run", (p) => { p.options.identity.runId = "another-run"; }],
  ["foreign source turn", (p) => { p.turnResult.available_actions[0].source_turn_ref = "another-turn"; }],
  ["foreign copied candidate", (p) => { p.options.artifact = { ...p.artifact, target_chapter_ref: "chapter:other" }; }],
  ["missing accept frame", (p) => { p.wire = p.wire.filter((row) => row.frame?.[3] !== "author_action"); }],
  ["missing accepted ACK", (p) => { p.wire = p.wire.filter((row) =>
    !(row.frame?.[3] === "phx_reply" && row.frame[4].response?.action_status === "accepted")); }],
  ["receipt for another candidate", (p) => { p.receipt.artifact_id = "another-artifact"; }],
  ["unpersisted receipt", (p) => { p.receipt.persistence.persisted = false; }],
  ["another chapter projection", (p) => { p.receipt.persistence.reading_projection.chapter_id = "another-chapter"; }],
  ["missing source revision", (p) => { delete p.receipt.persistence.reading_projection.source_revision_ref; }],
  ["blank source revision", (p) => { p.receipt.persistence.reading_projection.source_revision_ref = " "; }],
  ["unrelated candidate", (p) => { p.artifact.artifact_type = "plot_outline"; }],
]) {
  test("maintenance wait rejects an unbound adoption before polling: " + name, async () => {
    const p = maintenanceWaitProof();
    let polls = 0;
    p.driver.pollWire = async () => { polls += 1; return { fabricated: true }; };
    change(p);
    await assert.rejects(() => waitAdoptionMaintenance(p.options));
    assert.equal(polls, 0);
  });
}

test("maintenance wait preserves a timeout and does not start a fresh budget", async () => {
  const p = maintenanceWaitProof(), timeout = new Error("frozen_maintenance_timeout");
  p.driver.pollWire = async (read, remaining) => {
    assert.equal(remaining, 600);
    assert.equal(read(p.wire), null);
    throw timeout;
  };
  await assert.rejects(() => waitAdoptionMaintenance(p.options), (error) => error === timeout);
  p.clock = p.options.deadline;
  p.driver.pollWire = async () => { assert.fail("exhausted turns must not poll again"); };
  await assert.rejects(() => waitAdoptionMaintenance(p.options), /maintenance_turn_budget_exhausted/);
});

test("pending Splash driver 保留三输入/独立动作并记录实际采用的冻结模型与等待预算", async () => {
  const harness = fakeHarness(buildWire()), waits = [], original = harness.pollWire;
  harness.provider = "splash";
  harness.pollWire = async function(predicate, timeout, label) {
    waits.push({ timeout, label });
    return original.call(this, predicate);
  };
  await drivePending(harness, livePendingConfig(), { capture() {} });
  assert.equal(harness.driverLog.value.model, "local/Q4-PLE4");
  assert.deepEqual(harness.driverLog.value.budget, LIVE_PENDING_BUDGET);
  assert.equal(harness.driverLog.value.runtime_profile, "b87-r03-splash-product-maintenance-budget");
  for (const label of ["source", "revision", "followup"]) {
    assert.equal(waits.find(wait => wait.label === `b71:${label}:ack`).timeout, 30000);
    assert.equal(waits.find(wait => wait.label === `b71:${label}:completed`).timeout, 240000);
  }
});

test("pending driver 在输入前拒绝更换原文、加预算或借用其它 provider", async () => {
  for (const mutate of [
    value => { value.revision_message += "继续保存"; },
    value => { value.followup_message += "继续"; },
    value => { value.budget.author_sends = 4; },
    value => { value.budget.turn_timeout_ms = 360000; },
    value => { value.provider = "strata"; },
  ]) {
    const current = livePendingConfig(), harness = fakeHarness(buildWire());
    harness.provider = "splash";
    let sends = 0;
    harness.rawTypeAndSend = async () => { sends += 1; throw new Error("unexpected_send"); };
    mutate(current);
    await assert.rejects(() => drivePending(harness, current, { capture() {} }), /冻结|pending.*provider/);
    assert.equal(sends, 0);
    assert.equal(harness.uiComplete, undefined);
  }
});
