// B71 pending 外部驱动编排的 fake-harness 行为测试：不启动 GUI、不写产品。
// 证明驱动只消费真实 TurnResult/available_actions，按候选可见标题/正文定位按钮，
// 并在 source→revision→Why→accept→discard→restore→followup 顺序推进。
import assert from "node:assert/strict";
import test from "node:test";
import { drivePending, isCompletedTurn, revealItem, turnOutcome } from "./authoring_pending_driver.mjs";
import { pendingSourceMessage } from "./authoring_pending_evidence.mjs";

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
    node(prefix, "AXGroup"),
    node(`${prefix}/0`, "AXStaticText", { value: title }),
    node(`${prefix}/1`, "AXStaticText", { value: body }),
    node(`${prefix}/2`, "AXButton", { title: "保存到作品档案" }),
    node(`${prefix}/3`, "AXButton", { title: "不保存" }),
  ];
}

function whyTree(prefix) {
  return [node(`${prefix}/9`, "AXButton", { title: "为什么" })];
}

function frame(at, direction, value) {
  return { at, direction, frame: value };
}

function buildWire() {
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
      adoption_state: { pending: [], resolved: [{ artifact_id: artifactId, adoption_status: payload.action_type === "accept" ? "ACCEPTED" : "DISCARDED" }] },
    }]),
  ];
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
        agent_run: { run_id: SOURCE_RUN, status: "completed", parent_turn_ref: SOURCE_TURN },
        assistant_message: { text: "" },
        adoption_state: { pending: [sourceArtifact], resolved: [] },
        available_actions: [discardAction],
      }]),
      ...user(2000, "join-a", "req-revision", REVISION_TURN, config.revision_message, REVISION_RUN),
      frame(iso(2000), "received", [null, null, TOPIC, "turn_result", {
        turn_id: REVISION_TURN,
        work_id: WORK,
        session_id: SESSION,
        agent_run: { run_id: REVISION_RUN, status: "completed", parent_turn_ref: REVISION_TURN },
        assistant_message: { text: "" },
        adoption_state: { pending: [revisionArtifact], resolved: [] },
        available_actions: [acceptAction],
      }]),
      frame(iso(2500), "http", null),
      ...action(3000, "req-accept", acceptAction, "accepted", "adopt", REVISION_ID, REVISION_TURN, "turn-accept"),
      ...action(4000, "req-discard", discardAction, "discarded", "discard", SOURCE_ID, SOURCE_TURN, "turn-discard"),
      { at: iso(4500), direction: "http", method: "GET", path: `/api/works/${WORK}/sessions/resume`, status: 200 },
      ...join(5000, "join-b"),
      ...user(6000, "join-b", "req-followup", FOLLOWUP_TURN, config.followup_message, FOLLOWUP_RUN),
      frame(iso(6000), "received", [null, null, TOPIC, "turn_result", {
        turn_id: FOLLOWUP_TURN,
        work_id: WORK,
        session_id: SESSION,
        agent_run: { run_id: FOLLOWUP_RUN, status: "completed", parent_turn_ref: FOLLOWUP_TURN },
        assistant_message: { text: "已处置 ACCEPTED / DISCARDED。" },
        adoption_state: { pending: [], resolved: [] },
      }]),
    ],
  };
}

function fakeHarness(fixture) {
  let whyOpen = false;
  let restored = false;
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
        : `${nodeText}\n已处置 ACCEPTED / DISCARDED。`;
      const hit = predicate(text, nodes);
      if (hit) return { nodes, text };
      throw new Error("fake_ax_timeout");
    },
    async tryPollAx() { return null; },
    capture(name) { this.captures.push(name); },
    dumpNodes() {
      if (restored) return [node("0/9", "AXStaticText", { value: REVISION_BODY })];
      return [
        ...itemTree("0/1/0", SOURCE_TITLE, SOURCE_BODY),
        ...whyTree("0/1"),
        ...itemTree("0/2/0", REVISION_TITLE, REVISION_BODY),
        ...whyTree("0/2"),
      ];
    },
    ensureInput() {
      return {
        scrollTo() {},
        key() { whyOpen = false; },
      };
    },
    safeClick(node) {
      this.log.push({ op: "click", title: node.title });
      if (node.title === "为什么") whyOpen = true;
      return { ok: true };
    },
    findButton() { return null; },
    writeDriverLog(name, value) { this.driverLog = { name, value }; },
    writeUiComplete(scope) { this.uiComplete = scope; },
  };
  return harness;
}

test("isCompletedTurn 只接受同 run 的 completed 结果", () => {
  const record = { direction: "received", frame: [null, null, TOPIC, "turn_result", { agent_run: { run_id: "r", status: "completed" } }] };
  assert.equal(isCompletedTurn(record, "r"), true);
  assert.equal(isCompletedTurn(record, "other"), false);
  assert.equal(isCompletedTurn({ ...record, direction: "sent" }, "r"), false);
});

test("revealItem 用候选标题+正文定位并滚动所属 AX 结构", async () => {
  const harness = fakeHarness(buildWire());
  let scrolled = null;
  harness.ensureInput = () => ({ scrollTo: (path) => { scrolled = path; }, key() {} });
  await revealItem(harness, REVISION_TITLE, REVISION_BODY);
  assert.equal(scrolled, "0/2/0");
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
  assert.ok(harness.captures.includes("final"));
});

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
      agent_run: { run_id: "run-turn", status: "completed", parent_turn_ref: "turn-turn" },
      ...overrides,
    }],
  };
}

test("turnOutcome 按 owning topic/sent/work/session/parent 绑定完成，错身份与重复为冲突", () => {
  assert.equal(turnOutcome([turnRecord()], turnIdentity).kind, "completed");
  const wrongSession = turnRecord({ session_id: "other" });
  assert.equal(turnOutcome([wrongSession], turnIdentity).reason, "turn_identity_mismatch");
  const wrongParent = turnRecord({ agent_run: { run_id: "run-turn", status: "completed", parent_turn_ref: "other" } });
  assert.equal(turnOutcome([wrongParent], turnIdentity).reason, "turn_identity_mismatch");
  const duplicate = turnRecord({}, "2026-11-02T10:00:03.000Z");
  assert.equal(turnOutcome([turnRecord(), duplicate], turnIdentity).reason, "turn_completed_duplicate");
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
    { kind: "failed", status: "run_failed" },
  );
  const cancelled = { ...base, frame: [...base.frame.slice(0, 4), { ...base.frame[4], event_type: "run_cancelled" }] };
  assert.equal(turnOutcome([cancelled], turnIdentity).status, "run_cancelled");
  assert.equal(turnOutcome([], turnIdentity), null);
});

test("revealItem 只吞明确不支持的滚动结果，目标/权限/归属错误上抛", async () => {
  const harness = fakeHarness(buildWire());
  harness.dumpNodes = () => [
    node("0/1/0", "AXGroup"),
    node("0/1/0/0", "AXStaticText", { value: SOURCE_TITLE }),
    node("0/1/0/1", "AXStaticText", { value: SOURCE_BODY }),
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

test("isCompletedTurn 对错事件/缺 agent_run/非对象记录失败关闭", () => {
  const base = { direction: "received", frame: [null, null, TOPIC, "turn_result", { agent_run: { run_id: "r", status: "completed" } }] };
  assert.equal(isCompletedTurn(base, "r"), true);
  assert.equal(isCompletedTurn({ ...base, frame: [null, null, TOPIC, "agent_event", base.frame[4]] }, "r"), false);
  assert.equal(isCompletedTurn({ ...base, frame: [null, null, TOPIC, "turn_result", {}] }, "r"), false);
  assert.equal(isCompletedTurn(null, "r"), false);
});

test("turnOutcome 对错 work/run 与 agent_run.status=failed 给出明确结果", () => {
  const identity = { ...turnIdentity };
  assert.equal(turnOutcome([turnRecord({ work_id: "other" })], identity).reason, "turn_identity_mismatch");
  assert.equal(turnOutcome([turnRecord({ agent_run: { run_id: "other", status: "completed", parent_turn_ref: "turn-turn" } })], identity), null);
  const failedBody = { run_id: "run-turn", work_id: WORK, session_id: SESSION, agent_run: { run_id: "run-turn", status: "failed" } };
  const failed = { at: "2026-11-02T10:00:02.000Z", direction: "received", frame: [null, null, TOPIC, "agent_event", failedBody] };
  assert.deepEqual(
    { kind: turnOutcome([failed], identity).kind, status: turnOutcome([failed], identity).status },
    { kind: "failed", status: "failed" },
  );
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
