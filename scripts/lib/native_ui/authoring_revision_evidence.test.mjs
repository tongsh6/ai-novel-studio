// B71 修订证据边界的纯行为测试：真实 WorkspaceChat 请求形状、Phoenix 请求/广播
// 归属、child run 时窗。只构造真实帧形状，不读产品状态、不跑原生批次。
import assert from "node:assert/strict";
import test from "node:test";
import {
  REVISION_CHAPTER_TITLE,
  actionResultFor,
  authorActionAck,
  chapterDraftTarget,
  childRunStates,
  childTurnResults,
  outsideEvidencePreserved,
  retryExchangeChecks,
  revisionActionFrame,
  revisionArtifactChecks,
  revisionDecisionEvents,
  revisionRunChecks,
  revisionUiChecks,
  revisionWhyChecks,
  sourceGenerationMessage,
  sourceMissionEvents,
} from "./authoring_revision_evidence.mjs";

import { irBodyFromWire } from "./fixtures/authoring_request_ir.mjs";
const TOPIC = "workspace:owned";
const FOREIGN = "workspace:foreign";
const AT = "2026-11-02T03:40:01.000Z";
const BEFORE = "2026-11-02T03:39:00.000Z";
const AFTER = "2026-11-02T03:40:02.000Z";
const CHAPTER_BRIEF = `${REVISION_CHAPTER_TITLE}。本章方向：短促的动作追击。`;
const SOURCE_TEXT = `请根据已采纳章节计划生成${CHAPTER_BRIEF}正文草稿，保持为待采纳草稿。`;

const frame = (direction, at, [joinRef, requestRef, topic, event, body]) => ({
  direction,
  at,
  frame: [joinRef, requestRef, topic, event, body],
});

const sourceRecord = ({
  text = SOURCE_TEXT,
  at = AT,
  topic = TOPIC,
  generate = true,
  requestRef = "req-source",
} = {}) =>
  frame("sent", at, [
    "join-1",
    requestRef,
    topic,
    "user_message",
    {
      work_id: "work-1",
      session_id: "session-1",
      turn_id: "turn-source",
      generate_micro_plan: generate,
      text,
    },
  ]);

const sourceOptions = { chapterTitle: REVISION_CHAPTER_TITLE, since: BEFORE };

test("sourceGenerationMessage 认 WorkspaceChat onDraftChapter 的真实请求形状", () => {
  const record = sourceRecord();
  assert.equal(sourceGenerationMessage([record], sourceOptions), record);
  const atSince = sourceRecord({ at: BEFORE });
  assert.equal(sourceGenerationMessage([atSince], { ...sourceOptions, since: BEFORE }), atSince);
  assert.equal(sourceGenerationMessage([null, record], sourceOptions), record);
});

test("sourceGenerationMessage 拒绝只有章标题或更长章名的旁路文案", () => {
  const fakes = [
    sourceRecord({ text: `${REVISION_CHAPTER_TITLE}：主角在废弃矿区遭遇巡检傀儡。` }),
    sourceRecord({
      text: `请根据已采纳章节计划生成${REVISION_CHAPTER_TITLE}外传正文草稿，保持为待采纳草稿。`,
    }),
    sourceRecord({ text: `${REVISION_CHAPTER_TITLE}。本章方向：短促的动作追击。` }),
  ];
  for (const fake of fakes) {
    assert.throws(() => sourceGenerationMessage([fake], sourceOptions), /revision_source_message/);
  }
});

test("sourceGenerationMessage 要求 generate_micro_plan 真与 since 时窗", () => {
  assert.throws(
    () => sourceGenerationMessage([sourceRecord({ generate: false })], sourceOptions),
    /revision_source_message/,
  );
  assert.throws(
    () => sourceGenerationMessage([sourceRecord({ at: BEFORE })], { ...sourceOptions, since: AT }),
    /revision_source_message/,
  );
  assert.throws(
    () => sourceGenerationMessage([sourceRecord({ text: SOURCE_TEXT })], {
      ...sourceOptions,
      since: AFTER,
    }),
    /revision_source_message/,
  );
});

test("sourceGenerationMessage 对同 scope 多义请求拒绝猜取", () => {
  assert.throws(
    () => sourceGenerationMessage([sourceRecord(), sourceRecord({ requestRef: "req-source-2" })], sourceOptions),
    /必须恰好一条，实测 2/,
  );
});

const actionBody = {
  action: {
    action_type: "revise_from_findings",
    source_turn_ref: "turn-source",
    target_ref: "artifact-1",
  },
};
const actionIdentity = {
  topic: TOPIC,
  since: AT,
  sourceTurnRef: "turn-source",
  targetRef: "artifact-1",
};
const actionRecord = ({ topic = TOPIC, at = AFTER, direction = "sent" } = {}) =>
  frame(direction, at, ["join-1", "req-action", topic, "author_action", actionBody]);

test("revisionActionFrame 只认同 owning topic 且不早于 since 的 author_action", () => {
  const good = actionRecord();
  assert.equal(revisionActionFrame([good], actionIdentity), good);
  const atSince = actionRecord({ at: AT });
  assert.equal(revisionActionFrame([atSince], actionIdentity), atSince);
  assert.equal(revisionActionFrame([null, good], actionIdentity), good);
  assert.throws(
    () => revisionActionFrame([actionRecord({ topic: FOREIGN })], actionIdentity),
    /revision_action_frame/,
  );
  assert.throws(
    () => revisionActionFrame([actionRecord({ at: BEFORE })], actionIdentity),
    /revision_action_frame/,
  );
  assert.throws(
    () => revisionActionFrame([actionRecord({ direction: "received" })], actionIdentity),
    /revision_action_frame/,
  );
  assert.throws(
    () => revisionActionFrame([actionRecord(), actionRecord()], actionIdentity),
    /必须恰好一条，实测 2/,
  );
  assert.throws(() => revisionActionFrame([], { ...actionIdentity, topic: "" }), /缺 owning topic/);
  assert.throws(() => revisionActionFrame([], { ...actionIdentity, since: "" }), /缺 since/);
});

test("revisionActionFrame 拒绝错 source/target/action_type，不按路径猜", () => {
  for (const action of [
    { ...actionBody.action, action_type: "accept" },
    { ...actionBody.action, source_turn_ref: "turn-other" },
    { ...actionBody.action, target_ref: "artifact-other" },
    null,
  ]) {
    const record = frame("sent", AFTER, ["join-1", "req-action", TOPIC, "author_action", { action }]);
    assert.throws(() => revisionActionFrame([record], actionIdentity), /revision_action_frame/);
  }
});

const resultBody = {
  receipt_id: "receipt-1",
  run_id: "run-1",
  source_turn_ref: "turn-source",
  target_artifact_ref: "artifact-1",
};
const resultIdentity = {
  receiptId: "receipt-1",
  runId: "run-1",
  sourceTurnRef: "turn-source",
  targetRef: "artifact-1",
  topic: TOPIC,
  at: AT,
};
const resultRecord = ({ topic = TOPIC, at = AFTER, body = resultBody } = {}) =>
  frame("received", at, [null, null, topic, "action_result", body]);

test("actionResultFor 绑定 owning topic、at 与完整回执身份", () => {
  assert.deepEqual(actionResultFor([resultRecord()], resultIdentity), resultBody);
  assert.throws(
    () => actionResultFor([resultRecord({ topic: FOREIGN })], resultIdentity),
    /revision_action_result/,
  );
  assert.throws(
    () => actionResultFor([resultRecord({ at: BEFORE })], resultIdentity),
    /revision_action_result/,
  );
  for (const body of [
    { ...resultBody, receipt_id: "receipt-other" },
    { ...resultBody, run_id: "run-other" },
    { ...resultBody, source_turn_ref: "turn-other" },
    { ...resultBody, target_artifact_ref: "artifact-other" },
    null,
  ]) {
    assert.throws(() => actionResultFor([resultRecord({ body })], resultIdentity), /revision_action_result/);
  }
  assert.throws(
    () => actionResultFor([resultRecord(), resultRecord()], resultIdentity),
    /必须恰好一条，实测 2/,
  );
  assert.throws(() => actionResultFor([], null), /缺 owning topic/);
  assert.throws(() => actionResultFor([], { ...resultIdentity, topic: "" }), /缺 owning topic/);
  assert.throws(() => actionResultFor([], { ...resultIdentity, at: "" }), /缺 at/);
});

const stateBody = { run_id: "run-1", status: "completed" };
const stateRecord = ({ topic = TOPIC, at = AFTER, body = stateBody } = {}) =>
  frame("received", at, [null, null, topic, "agent_run_state", body]);
const turnBody = { turn_id: "child-turn-1", agent_run: { run_id: "run-1", status: "completed" } };
const turnRecord = ({ topic = TOPIC, at = AFTER, body = turnBody } = {}) =>
  frame("received", at, [null, null, topic, "turn_result", body]);

test("childRunStates 按 owning topic、at 与 run_id 排除跨 topic/动作前帧", () => {
  const good = stateRecord();
  const wire = [
    stateRecord({ topic: FOREIGN }),
    stateRecord({ at: BEFORE }),
    stateRecord({ body: { run_id: "run-2", status: "completed" } }),
    stateRecord({ body: null }),
    good,
  ];
  assert.deepEqual(childRunStates(wire, "run-1", { topic: TOPIC, at: AT }), [
    { at: AFTER, body: stateBody },
  ]);
  assert.throws(() => childRunStates(wire, "run-1", null), /缺 owning topic/);
  assert.throws(() => childRunStates(wire, "run-1", { at: AT }), /缺 owning topic/);
  assert.throws(() => childRunStates(wire, "run-1", { topic: TOPIC }), /缺 at/);
  assert.throws(() => childRunStates(wire, "", { topic: TOPIC, at: AT }), /缺 run_id/);
});

test("childTurnResults 按 owning topic、at 与 agent_run.run_id 排除跨 topic/动作前帧", () => {
  const good = turnRecord();
  const wire = [
    turnRecord({ topic: FOREIGN }),
    turnRecord({ at: BEFORE }),
    turnRecord({ body: { turn_id: "child-turn-2", agent_run: { run_id: "run-2", status: "completed" } } }),
    turnRecord({ body: null }),
    turnRecord({ body: {} }),
    good,
  ];
  assert.deepEqual(childTurnResults(wire, "run-1", { topic: TOPIC, at: AT }), [
    { at: AFTER, body: turnBody },
  ]);
  assert.throws(() => childTurnResults(wire, "run-1", null), /缺 owning topic/);
  assert.throws(() => childTurnResults(wire, "run-1", { at: AT }), /缺 owning topic/);
  assert.throws(() => childTurnResults(wire, "run-1", { topic: TOPIC }), /缺 at/);
  assert.throws(() => childTurnResults(wire, "", { topic: TOPIC, at: AT }), /缺 run_id/);
});

const actionFrame = actionRecord();
const reply = ({
  joinRef = "join-1",
  requestRef = "req-action",
  topic = TOPIC,
  at = AFTER,
  body = { status: "ok", response: { received: true, action_status: "running" } },
} = {}) => frame("received", at, [joinRef, requestRef, topic, "phx_reply", body]);

test("authorActionAck 复用共享请求回复边界并拒绝跨 topic/动作前回复", () => {
  const accepted = reply();
  const ack = authorActionAck([actionFrame, accepted], actionFrame);
  assert.equal(ack.response.action_status, "running");
  assert.equal(ack.reply, accepted);
  assert.deepEqual(ack.identity, { joinRef: "join-1", requestRef: "req-action", topic: TOPIC });

  for (const candidate of [
    reply({ topic: FOREIGN }),
    reply({ at: BEFORE }),
    reply({ joinRef: "join-other" }),
    reply({ requestRef: "req-other" }),
  ]) {
    assert.throws(() => authorActionAck([actionFrame, candidate], actionFrame), /ACK 必须唯一/);
  }
  assert.throws(
    () => authorActionAck([actionFrame, reply(), reply({ at: "2026-11-02T03:40:03.000Z" })], actionFrame),
    /ACK 必须唯一/,
  );
});

test("authorActionAck 只接受确认受理的成功响应，不把错误回复当 ACK", () => {
  for (const body of [
    { status: "error", response: { received: true } },
    { status: "ok", response: { received: false } },
  ]) {
    assert.throws(() => authorActionAck([actionFrame, reply({ body })], actionFrame), /ACK 未确认受理/);
  }
});

test("chapterDraftTarget 在空输入、重复章题、前序按钮与下一章前关闭或精确命中", () => {
  assert.equal(chapterDraftTarget(null, REVISION_CHAPTER_TITLE), null);
  assert.equal(chapterDraftTarget([], ""), null);
  assert.equal(chapterDraftTarget([{ role: "AXButton", title: "生成正文草稿" }], REVISION_CHAPTER_TITLE), null);
  const nodes = [
    { role: "AXStaticText", value: REVISION_CHAPTER_TITLE },
    { role: "AXStaticText", value: REVISION_CHAPTER_TITLE },
    { role: "AXButton", title: "保存", path: "save" },
    null,
    { role: "AXButton", value: "生成正文草稿", path: "target" },
  ];
  assert.equal(chapterDraftTarget(nodes, REVISION_CHAPTER_TITLE)?.path, "target");
  const nextFirst = [
    { role: "AXStaticText", value: REVISION_CHAPTER_TITLE },
    { role: "AXButton", title: "保存", path: "save" },
    { role: "AXStaticText", value: "第03章：誓词回环" },
    { role: "AXButton", title: "生成正文草稿", path: "next" },
  ];
  assert.equal(chapterDraftTarget(nextFirst, REVISION_CHAPTER_TITLE), null);
  const targetFirst = [
    { role: "AXStaticText", value: REVISION_CHAPTER_TITLE },
    { role: "AXButton", title: "生成正文草稿", path: "first" },
  ];
  assert.equal(chapterDraftTarget(targetFirst, REVISION_CHAPTER_TITLE)?.path, "first");
});

test("outsideEvidencePreserved 对空值、缺句位、错句位与未替换关闭", () => {
  const original = "他猛地侧身。\n他一刀劈下。\n他反手格挡。\n尾。";
  const span = {
    text: "他猛地侧身。他一刀劈下。他反手格挡。",
    sentence_start: 1,
    sentence_end: 3,
  };
  assert.equal(outsideEvidencePreserved("", "改", [span]), false);
  assert.equal(outsideEvidencePreserved(original, "", [span]), false);
  assert.equal(outsideEvidencePreserved(original, "改", []), false);
  assert.equal(outsideEvidencePreserved(original, "改", [null]), false);
  assert.equal(outsideEvidencePreserved(original, "改", [{ ...span, sentence_start: 0 }]), false);
  assert.equal(outsideEvidencePreserved(original, "改", [{ ...span, sentence_start: "1" }]), false);
  assert.equal(outsideEvidencePreserved(original, "改", [{ ...span, sentence_end: 4 }]), false);
  assert.equal(outsideEvidencePreserved(original, "改", [{ ...span, text: "别句。" }]), false);
  assert.equal(outsideEvidencePreserved(original, "改", [{ ...span, text: "" }]), false);
  const spanThree = {
    text: "甲乙。丙丁。戊己。",
    sentence_start: 1,
    sentence_end: 3,
  };
  const originalThree = "甲乙。\n丙丁。\n戊己。\n尾。";
  assert.equal(outsideEvidencePreserved(originalThree, "\n尾。", [spanThree]), false);
  assert.equal(outsideEvidencePreserved(originalThree, originalThree, [spanThree]), false);
});

test("outsideEvidencePreserved 按 finding 句位保留未选换行与原文", () => {
  const original = "他猛地侧身。\n他一刀劈下。\n他反手格挡。\n他迈步逼近。\n他咬住暗号KEEP继续逼近。";
  const revised = "他猛地侧身让过刃锋，反手一刀劈在傀儡关节上；格挡的火星还没落下，退路已经被这一击撞开。\n他迈步逼近。\n他咬住暗号KEEP继续逼近。";
  const span = {
    text: "他猛地侧身。他一刀劈下。他反手格挡。",
    sentence_start: 1,
    sentence_end: 3,
  };
  assert.equal(outsideEvidencePreserved(original, revised, [span]), true);
  assert.equal(
    outsideEvidencePreserved(original, revised.replace("KEEP", "ALTERED"), [span]),
    false,
  );
  assert.equal(
    outsideEvidencePreserved(original, revised.replace("\n他迈步逼近。", "他迈步逼近。"), [span]),
    false,
  );
  assert.equal(
    outsideEvidencePreserved(original, revised, [{ ...span, sentence_end: 2 }]),
    false,
  );
});

test("outsideEvidencePreserved 不忽略其余 span，重叠或无法证明时关闭", () => {
  const original = "甲乙。\n丙丁。\n戊己。\n庚辛。";
  const spans = [
    { text: "甲乙。", sentence_start: 1, sentence_end: 1 },
    { text: "戊己。", sentence_start: 3, sentence_end: 3 },
  ];
  const revised = "甲改。\n丙丁。\n戊改。\n庚辛。";
  assert.equal(outsideEvidencePreserved(original, revised, spans), true);
  assert.equal(
    outsideEvidencePreserved(original, revised.replace("\n丙丁。\n", "丙丁。"), spans),
    false,
  );
  assert.equal(
    outsideEvidencePreserved(original, revised, [spans[0], { ...spans[1], text: "别句。" }]),
    false,
  );
  assert.equal(
    outsideEvidencePreserved(original, revised, [
      { text: "甲乙。丙丁。", sentence_start: 1, sentence_end: 2 },
      { text: "丙丁。戊己。", sentence_start: 2, sentence_end: 3 },
    ]),
    false,
  );
});

test("revisionDecisionEvents 只收 owning topic、since 后、接收方向的处置广播", () => {
  const wire = [
    frame("received", AFTER, [null, null, TOPIC, "agent_event", { event_type: "artifact_adopted" }]),
    frame("received", BEFORE, [null, null, TOPIC, "agent_event", { event_type: "artifact_discarded" }]),
    frame("received", AFTER, [null, null, FOREIGN, "agent_event", { event_type: "artifact_superseded" }]),
    frame("sent", AFTER, [null, null, TOPIC, "agent_event", { event_type: "artifact_adopted" }]),
    frame("received", AFTER, [null, null, TOPIC, "agent_event", { event_type: "run_completed" }]),
    frame("received", AFTER, [null, null, TOPIC, "agent_event", null]),
    null,
  ];
  assert.deepEqual(
    revisionDecisionEvents(wire, TOPIC, AT).map((record) => record.frame[4].event_type),
    ["artifact_adopted"],
  );
});

test("revisionWhyChecks 按 turn 的 replay path、状态与时窗判定", () => {
  const path = "/api/works/work-1/sessions/session-1/turns/turn-child/replay";
  const beforeWhy = { at: BEFORE };
  const afterWhy = { at: AFTER };
  const input = { workId: "work-1", sessionId: "session-1", childTurnId: "turn-child", beforeWhy, afterWhy };
  const http = (over = {}) => ({ direction: "http", at: AT, status: 200, path, ...over });
  assert.deepEqual(revisionWhyChecks({ ...input, wire: [http()] }), {
    why_uses_scoped_persisted_replay: true,
  });
  for (const record of [
    http({ status: 500 }),
    http({ path: "/api/other" }),
    http({ direction: "sent" }),
    http({ at: "2026-11-02T03:38:59.000Z" }),
    http({ at: "2026-11-02T03:40:03.000Z" }),
    null,
  ]) {
    assert.deepEqual(revisionWhyChecks({ ...input, wire: [record] }), {
      why_uses_scoped_persisted_replay: false,
    });
  }
  assert.equal(
    revisionWhyChecks({ ...input, beforeWhy: null, wire: [http()] }).why_uses_scoped_persisted_replay,
    false,
  );
  assert.equal(
    revisionWhyChecks({ ...input, afterWhy: null, wire: [http()] }).why_uses_scoped_persisted_replay,
    false,
  );
});

test("revisionUiChecks 逐项校验质量卡、修订候选、Why 与作者安全文案", () => {
  const quality = [
    "质量复核：发现",
    "原句",
    "位置",
    "判断理由",
    "影响范围",
    "置信度",
    "局部修订所选问题",
  ].join("\n");
  const revision = "原稿\n修订稿\n保存修订稿";
  const why = [
    "基于本轮已保存的推理记录生成回放。",
    "回放只读取已保存记录，不会重新调用模型。",
  ].join("\n");
  const checks = revisionUiChecks({
    qualityVisible: quality,
    revisionVisible: revision,
    why,
    userMessages: ["作者输入"],
  });
  assert.ok(Object.values(checks).every(Boolean));
  assert.equal(
    revisionUiChecks({ qualityVisible: quality.replace("置信度", ""), revisionVisible: revision, why, userMessages: [] })
      .quality_card_shows_evidence_and_scope,
    false,
  );
  assert.equal(
    revisionUiChecks({ qualityVisible: quality, revisionVisible: "修订稿", why, userMessages: [] })
      .revision_candidate_visible_independently,
    false,
  );
  // 03 的真实持久回放说明应绿；02 只有 fallback 摘要时应红。
  assert.equal(
    revisionUiChecks({
      qualityVisible: quality,
      revisionVisible: revision,
      why: "基于本轮已保存的推理记录生成回放。\n回放只读取已保存记录，不会重新调用模型。",
      userMessages: [],
    }).why_panel_is_author_safe,
    true,
  );
  for (const fallback of [
    "回放只读取已保存记录，不会重新调用模型",
    "系统保留了本轮的安全解释摘要。\n解释来自本轮已保存的 trace 摘要，不会重新调用模型或改写作品。",
    `${why}\n提交工具 submit_tentative_artifact`,
  ]) {
    assert.equal(
      revisionUiChecks({
        qualityVisible: quality,
        revisionVisible: revision,
        why: fallback,
        userMessages: [],
      }).why_panel_is_author_safe,
      false,
      fallback,
    );
  }
  assert.equal(
    revisionUiChecks({ qualityVisible: quality, revisionVisible: revision, why, userMessages: ["1", "2"] })
      .no_second_user_message_after_action,
    false,
  );
  assert.equal(
    revisionUiChecks({
      qualityVisible: `${quality}\nprovider_call_ref`,
      revisionVisible: revision,
      why,
      userMessages: [],
    }).author_visible_copy_has_no_internal_protocol_codes,
    false,
  );
});

test("修订判据在空输入上 fail-closed，不把缺失事实当通过", () => {
  const run = revisionRunChecks({});
  assert.equal(run.no_auto_decision_events, true);
  for (const [key, value] of Object.entries(run)) {
    if (key !== "no_auto_decision_events") assert.equal(value, false, key);
  }
  const artifact = revisionArtifactChecks({}).checks;
  assert.equal(artifact.out_of_scope_bytes_preserved, true);
  for (const [key, value] of Object.entries(artifact)) {
    if (key !== "out_of_scope_bytes_preserved") assert.equal(value, false, key);
  }
  for (const [key, value] of Object.entries(retryExchangeChecks({}).checks)) {
    assert.equal(value, false, key);
  }
  const ui = revisionUiChecks({});
  assert.equal(ui.author_visible_copy_has_no_internal_protocol_codes, true);
  for (const [key, value] of Object.entries(ui)) {
    if (key !== "author_visible_copy_has_no_internal_protocol_codes") assert.equal(value, false, key);
  }
});

test("sourceGenerationMessage 只接受 user_message 且生产者模板前后缀完整", () => {
  const exact = sourceRecord();
  const wrongEvent = { ...exact, frame: [...exact.frame.slice(0, 3), "phx_reply", exact.frame[4]] };
  const noPrefix = sourceRecord({ text: `${CHAPTER_BRIEF}正文草稿，保持为待采纳草稿。` });
  const noSuffix = sourceRecord({ text: `请根据已采纳章节计划生成${CHAPTER_BRIEF}` });
  const nullBody = frame("sent", AT, ["join-1", "req-source", TOPIC, "user_message", null]);
  for (const record of [wrongEvent, noPrefix, noSuffix, nullBody]) {
    assert.throws(() => sourceGenerationMessage([record], sourceOptions), /revision_source_message/);
  }
});

test("chapterDraftTarget 不把目标章之前的按钮当成目标章", () => {
  const nodes = [
    { role: "AXStaticText", value: "第01章：底层灵气账单" },
    { role: "AXButton", title: "生成正文草稿", path: "prior" },
    { role: "AXStaticText", value: REVISION_CHAPTER_TITLE },
    { role: "AXButton", title: "生成正文草稿", path: "target" },
  ];
  assert.equal(chapterDraftTarget(nodes, REVISION_CHAPTER_TITLE)?.path, "target");
});

test("outsideEvidencePreserved 支持末句、前缀、相邻与乱序 span", () => {
  assert.equal(
    outsideEvidencePreserved("甲。乙。", "甲改。乙改。", [
      { text: "甲。乙。", sentence_start: 1, sentence_end: 2 },
    ]),
    true,
  );
  assert.equal(
    outsideEvidencePreserved("甲。\n乙。\n丙。", "甲。\n乙改。\n丙。", [
      { text: "乙。", sentence_start: 2, sentence_end: 2 },
    ]),
    true,
  );
  assert.equal(
    outsideEvidencePreserved("甲。乙。丙。", "甲改。乙改。丙。", [
      { text: "甲。", sentence_start: 1, sentence_end: 1 },
      { text: "乙。", sentence_start: 2, sentence_end: 2 },
    ]),
    true,
  );
  assert.equal(
    outsideEvidencePreserved(
      "甲乙。\n丙丁。\n戊己。\n庚辛。",
      "甲改。\n丙丁。\n戊改。\n庚辛。",
      [
        { text: "戊己。", sentence_start: 3, sentence_end: 3 },
        { text: "甲乙。", sentence_start: 1, sentence_end: 1 },
      ],
    ),
    true,
  );
});

test("outsideEvidencePreserved 拒绝删除未选片段或把未选片段挪进后缀", () => {
  assert.equal(
    outsideEvidencePreserved("甲。\n乙。\n丙。", "甲。\n丙。", [
      { text: "乙。", sentence_start: 2, sentence_end: 2 },
    ]),
    false,
  );
  const original = "甲。\n乙。\n丙。\n乙。\n";
  const spans = [
    { text: "甲。", sentence_start: 1, sentence_end: 1 },
    { text: "丙。", sentence_start: 3, sentence_end: 3 },
  ];
  assert.equal(
    outsideEvidencePreserved(original, "甲改。\n乙。\n丙改。\n乙。\n", spans),
    true,
  );
  assert.equal(
    outsideEvidencePreserved(original, "甲改。\n丙改。\n乙。\n", spans),
    false,
  );
  assert.equal(
    outsideEvidencePreserved("甲。\n乙。\n丙。\n乙。\n丁。", "甲改。\n乙。\n丙改。\n丁改。", [
      { text: "甲。", sentence_start: 1, sentence_end: 1 },
      { text: "丙。", sentence_start: 3, sentence_end: 3 },
      { text: "丁。", sentence_start: 5, sentence_end: 5 },
    ]),
    false,
  );
  // 命中句段可整体替换为空，但与未选句之间的换行仍必须保留。
  assert.equal(
    outsideEvidencePreserved("甲。\n乙。\n丙。", "甲改改。\n乙。\n", [
      { text: "甲。", sentence_start: 1, sentence_end: 1 },
      { text: "丙。", sentence_start: 3, sentence_end: 3 },
    ]),
    true,
  );
  assert.equal(
    outsideEvidencePreserved("甲。\n乙。\n丙。", "甲改改。\n乙。", [
      { text: "甲。", sentence_start: 1, sentence_end: 1 },
      { text: "丙。", sentence_start: 3, sentence_end: 3 },
    ]),
    false,
  );
});

test("outsideEvidencePreserved 从首字符起计句位", () => {
  assert.equal(
    outsideEvidencePreserved("。甲。乙。", "。甲改。乙。", [
      { text: "甲。", sentence_start: 2, sentence_end: 2 },
    ]),
    true,
  );
});

test("outsideEvidencePreserved 在非空前缀下只替换命中 span", () => {
  assert.equal(
    outsideEvidencePreserved("甲乙原句。尾。", "甲乙新句。尾。", [
      { text: "甲乙原句。", sentence_start: 1, sentence_end: 1 },
    ]),
    true,
  );
});

test("outsideEvidencePreserved 将句前换行留在未选字节", () => {
  const spans = [{ text: "旧句。", sentence_start: 2, sentence_end: 2 }];
  const original = "前句。\n旧句。\n后句。";
  assert.equal(outsideEvidencePreserved(original, "前句。\n新句。\n后句。", spans), true);
  assert.equal(outsideEvidencePreserved(original, "前句。新句。\n后句。", spans), false);
});

test("outsideEvidencePreserved 将首句前导空格留在未选字节", () => {
  const spans = [{ text: "旧句。", sentence_start: 1, sentence_end: 1 }];
  const original = "  旧句。\n后句。";
  assert.equal(outsideEvidencePreserved(original, "  新句。\n后句。", spans), true);
  assert.equal(outsideEvidencePreserved(original, "新句。\n后句。", spans), false);
});

test("outsideEvidencePreserved 多个 span 共用同一句前空白边界", () => {
  const original = "甲。\n 乙。\n丙。";
  const spans = [
    { text: "甲。", sentence_start: 1, sentence_end: 1 },
    { text: "乙。", sentence_start: 2, sentence_end: 2 },
    { text: "丙。", sentence_start: 3, sentence_end: 3 },
  ];
  assert.equal(outsideEvidencePreserved(original, "甲改。\n 乙改。\n丙改。", spans), true);
  assert.equal(outsideEvidencePreserved(original, "甲改。\n乙改。\n丙改。", spans), false);
  assert.equal(
    outsideEvidencePreserved(original, "甲改。\n 乙改。丙改。", [
      spans[0],
      spans[1],
      { text: "丙。", sentence_start: 3, sentence_end: 3 },
    ]),
    false,
  );
});

test("outsideEvidencePreserved 将末句后的空白留在未选后缀", () => {
  const spans = [{ text: "旧句。", sentence_start: 2, sentence_end: 2 }];
  const original = "前句。\n旧句。  \n";
  assert.equal(outsideEvidencePreserved(original, "前句。\n新句。  \n", spans), true);
  assert.equal(outsideEvidencePreserved(original, "前句。\n新句。", spans), false);
});

test("outsideEvidencePreserved 单句可替换但删除命中段不留替换字节时关闭", () => {
  assert.equal(
    outsideEvidencePreserved("旧句。", "新句。", [{ text: "旧句。", sentence_start: 1, sentence_end: 1 }]),
    true,
  );
  assert.equal(
    outsideEvidencePreserved("甲。\n乙。", "\n乙。", [
      { text: "甲。", sentence_start: 1, sentence_end: 1 },
    ]),
    false,
  );
});

test("outsideEvidencePreserved 未选片段位于修订开头时仍按原顺序保留", () => {
  assert.equal(
    outsideEvidencePreserved("甲。\n乙。\n丙。", "\n乙。\n改", [
      { text: "甲。", sentence_start: 1, sentence_end: 1 },
      { text: "丙。", sentence_start: 3, sentence_end: 3 },
    ]),
    true,
  );
});

test("outsideEvidencePreserved 末句无终止符时仍按句位定位", () => {
  assert.equal(
    outsideEvidencePreserved("甲。旧尾", "甲。新尾", [
      { text: "旧尾", sentence_start: 2, sentence_end: 2 },
    ]),
    true,
  );
  assert.equal(
    outsideEvidencePreserved("甲。旧尾", "新尾", [
      { text: "旧尾", sentence_start: 2, sentence_end: 2 },
    ]),
    false,
  );
});

test("retryExchangeChecks 只从 assistant tool_call 与 tool validation_result 取事实", () => {
  const userCall = retryExchangeChecks({
    transcript: { messages: [{ role: "user", blocks: [{ type: "tool_call", name: "submit_tentative_artifact" }] }] },
    records: [],
  });
  assert.equal(userCall.measured.revision_call_count, 0);
  const assistantText = retryExchangeChecks({
    transcript: { messages: [{ role: "assistant", blocks: [{ type: "text" }] }] },
    records: [],
  });
  assert.equal(assistantText.measured.revision_call_count, 0);
  const assistantValidation = retryExchangeChecks({
    transcript: { messages: [{ role: "assistant", blocks: [{ type: "validation_result", status: "passed" }] }] },
    records: [],
  });
  assert.equal(assistantValidation.checks.second_validation_is_closed, false);
  const toolText = retryExchangeChecks({
    transcript: { messages: [{ role: "tool", blocks: [{ type: "text", status: "passed" }] }] },
    records: [],
  });
  assert.equal(toolText.checks.second_validation_is_closed, false);
  const nullRecord = retryExchangeChecks({ transcript: { messages: [] }, records: [null] });
  assert.equal(nullRecord.checks.revision_exchange_has_exactly_two_calls, false);
  const assistantCall = { role: "assistant", provider_call_ref: "pcall-1", provider_run_ref: "prun-1", blocks: [{ type: "tool_call", name: "submit_tentative_artifact" }] };
  const noResponse = retryExchangeChecks({
    transcript: { messages: [assistantCall] },
    records: [{ provider_call_ref: "pcall-1" }],
  });
  assert.equal(noResponse.checks.revision_exchange_has_exactly_two_calls, false);
  const nullBody = retryExchangeChecks({
    transcript: { messages: [assistantCall] },
    records: [{ provider_call_ref: "pcall-1", response: { body: null } }],
  });
  assert.equal(nullBody.checks.revision_exchange_has_exactly_two_calls, false);
});

test("eventTypesAfter 接受正好落在 since 的广播", () => {
  const wire = [frame("received", AT, [null, null, TOPIC, "agent_event", { event_type: "artifact_adopted" }])];
  assert.equal(revisionDecisionEvents(wire, TOPIC, AT).length, 1);
});

test("revisionWhyChecks 接受正好落在 Why 前后边界上的 replay", () => {
  const path = "/api/works/work-1/sessions/session-1/turns/turn-child/replay";
  const input = {
    workId: "work-1",
    sessionId: "session-1",
    childTurnId: "turn-child",
    beforeWhy: { at: BEFORE },
    afterWhy: { at: AFTER },
  };
  for (const at of [BEFORE, AFTER]) {
    assert.equal(
      revisionWhyChecks({ ...input, wire: [{ direction: "http", at, status: 200, path }] })
        .why_uses_scoped_persisted_replay,
      true,
    );
  }
});

test("revisionRunChecks 对半缺失的 child trace 关闭", () => {
  const run = revisionRunChecks({ childInteraction: null, decisionTrace: {} });
  assert.equal(run.child_result_and_trace_are_committed, false);
});

test("artifact 判据对 null pending/items/spans/payload 关闭而不崩溃", () => {
  const artifact = {
    artifact_id: "rev",
    artifact_type: "prose_fragment",
    adoption_status: "TENTATIVE",
    payload: { items: [] },
  };
  const childTurnResult = {
    adoption_state: { pending: [artifact] },
    trace_summary: { revision_artifact_ref: "rev" },
    available_actions: [{ target_ref: "rev" }],
  };
  const checks = revisionArtifactChecks({
    childTurnResult,
    sourceArtifactId: "source",
    sourceOriginal: undefined,
    sourceWireOriginal: undefined,
    lastLegalResponse: undefined,
    lastLegalArguments: undefined,
    sourceFinding: { evidence_spans: [null] },
    actionPayload: {},
    sourceTurnId: "turn-source",
  }).checks;
  assert.equal(checks.revision_actions_target_revision_only, true);

  const nullPending = revisionArtifactChecks({
    childTurnResult: {
      adoption_state: { pending: [null] },
      trace_summary: { revision_artifact_ref: "missing" },
    },
    sourceArtifactId: "source",
  }).checks;
  assert.equal(nullPending.revision_artifact_is_sibling_tentative, false);

  const nullItems = revisionArtifactChecks({
    childTurnResult: {
      adoption_state: {
        pending: [
          {
            artifact_id: "rev",
            artifact_type: "prose_fragment",
            adoption_status: "TENTATIVE",
            payload: { items: [null] },
          },
        ],
      },
      trace_summary: { revision_artifact_ref: "rev" },
    },
    sourceArtifactId: "source",
    lastLegalArguments: { items: [null] },
  }).checks;
  assert.equal(nullItems.artifact_items_match_last_legal_response_bytes, false);
  assert.equal(revisionArtifactChecks({}).measured.revision_artifact_id, null);
  assert.equal(
    revisionArtifactChecks({
      childTurnResult,
      sourceArtifactId: "source",
      lastLegalArguments: { items: [null] },
    }).measured.revision_artifact_id,
    "rev",
  );
});

test("retryExchangeChecks 的 validation 读取只认 tool 角色的 validation_result", () => {
  const twoToolText = retryExchangeChecks({
    transcript: {
      messages: [
        { role: "tool", blocks: [{ type: "text", status: "passed" }] },
        { role: "tool", blocks: [{ type: "text", status: "passed" }] },
      ],
    },
    records: [],
  });
  assert.equal(twoToolText.checks.second_validation_is_closed, false);
  const twoAssistantValidation = retryExchangeChecks({
    transcript: {
      messages: [
        { role: "assistant", blocks: [{ type: "validation_result", status: "passed" }] },
        { role: "assistant", blocks: [{ type: "validation_result", status: "passed" }] },
      ],
    },
    records: [],
  });
  assert.equal(twoAssistantValidation.checks.second_validation_is_closed, false);
});

test("retryExchangeChecks 接受 JSON 字符串 arguments 且缺 validation 时关闭", () => {
  const call = {
    role: "assistant",
    provider_call_ref: "pcall-1",
    provider_run_ref: "prun-1",
    blocks: [{ type: "tool_call", call_id: "call-1", name: "submit_tentative_artifact" }],
  };
  const validation = {
    role: "tool",
    blocks: [{ type: "validation_result", call_id: "call-1", status: "failed", reason_code: "invalid_items" }],
  };
  const record = {
    provider_call_ref: "pcall-1",
    response: { body: { tool_calls: [{ name: "submit_tentative_artifact", arguments: "{}" }] } },
  };
  const accepted = retryExchangeChecks({ transcript: { messages: [call, validation] }, records: [record] });
  assert.equal(accepted.checks.first_response_rejected_as_invalid_items, true);
  const withoutValidation = retryExchangeChecks({ transcript: { messages: [call] }, records: [record] });
  assert.equal(withoutValidation.checks.first_response_rejected_as_invalid_items, false);
});

test("retryExchangeChecks 对重复 pcall 与缺 request_body/空 message 关闭", () => {
  const call = (pcall, callId) => ({
    role: "assistant",
    provider_call_ref: pcall,
    provider_run_ref: `prun-${callId}`,
    blocks: [{ type: "tool_call", call_id: callId, name: "submit_tentative_artifact" }],
  });
  const duplicate = retryExchangeChecks({
    transcript: { messages: [call("pcall-1", "call-1"), call("pcall-1", "call-2")] },
    records: [
      { provider_call_ref: "pcall-1" },
      { provider_call_ref: "pcall-1" },
    ],
  });
  assert.equal(duplicate.checks.revision_exchange_has_exactly_two_calls, false);
  const noRequests = retryExchangeChecks({
    transcript: { messages: [call("pcall-1", "call-1"), call("pcall-2", "call-2")] },
    records: [
      { provider_call_ref: "pcall-1" },
      { provider_call_ref: "pcall-2" },
    ],
  });
  assert.equal(noRequests.checks.second_request_is_strict_first_prefix, false);
  const nullMessage = retryExchangeChecks({
    transcript: { messages: [call("pcall-1", "call-1"), call("pcall-2", "call-2")] },
    records: [
      { provider_call_ref: "pcall-1", request_body: { messages: [null] } },
      { provider_call_ref: "pcall-2", request_body: { messages: [null, null] } },
    ],
  });
  assert.equal(nullMessage.checks.revision_request_carries_source_bytes_and_findings, false);
});

test("artifact 判据对空 child、双候选 trace ref 与缺 payload 关闭", () => {
  assert.equal(
    revisionArtifactChecks({ childTurnResult: {}, sourceArtifactId: "source" }).checks
      .revision_artifact_is_sibling_tentative,
    false,
  );
  const first = { artifact_id: "first", artifact_type: "prose_fragment", adoption_status: "TENTATIVE" };
  const second = { artifact_id: "second", artifact_type: "prose_fragment", adoption_status: "TENTATIVE" };
  const selected = revisionArtifactChecks({
    childTurnResult: {
      adoption_state: { pending: [first, second] },
      trace_summary: { revision_artifact_ref: "second" },
    },
    sourceArtifactId: "source",
  }).revisionArtifact;
  assert.equal(selected?.artifact_id, "second");

  const source = { artifact_id: "source", artifact_type: "prose_fragment", adoption_status: "TENTATIVE" };
  const wrongType = { artifact_id: "wrong", artifact_type: "other", adoption_status: "TENTATIVE" };
  const valid = { artifact_id: "valid", artifact_type: "prose_fragment", adoption_status: "TENTATIVE" };
  const noRef = revisionArtifactChecks({
    childTurnResult: { adoption_state: { pending: [source, wrongType, valid] } },
    sourceArtifactId: "source",
  }).revisionArtifact;
  assert.equal(noRef, null);
  const badRef = revisionArtifactChecks({
    childTurnResult: {
      adoption_state: { pending: [source, wrongType, valid] },
      trace_summary: { revision_artifact_ref: "missing" },
    },
    sourceArtifactId: "source",
  }).revisionArtifact;
  assert.equal(badRef, null);

  const noPayload = revisionArtifactChecks({
    childTurnResult: {
      adoption_state: { pending: [{ artifact_id: "rev", artifact_type: "prose_fragment" }] },
      trace_summary: { revision_artifact_ref: "rev" },
    },
    sourceArtifactId: "source",
    lastLegalArguments: { items: [null] },
  }).checks;
  assert.equal(noPayload.artifact_items_match_last_legal_response_bytes, false);
});

test("artifact 判据用 impact_scope 判定 local 并暴露 measured scope", () => {
  const item = (id, body) => ({ item_id: id, title: id, body, rationale: id });
  const original = item("source-item", "甲乙原句尾");
  const revised = item("rev-item", "甲丙改写完全不同尾");
  const revisionArtifact = {
    artifact_id: "rev",
    artifact_type: "prose_fragment",
    adoption_status: "TENTATIVE",
    payload: { items: [revised] },
  };
  const result = revisionArtifactChecks({
    childTurnResult: {
      adoption_state: { pending: [revisionArtifact] },
      trace_summary: { revision_artifact_ref: "rev" },
      available_actions: [{ target_ref: "rev" }],
    },
    sourceArtifactId: "source",
    sourceOriginal: { artifact_id: "source", adoption_status: "TENTATIVE", payload: { items: [original] } },
    sourceWireOriginal: { payload: { items: [original] } },
    lastLegalArguments: { items: [revised] },
    sourceFinding: { impact_scope: "local", evidence_spans: [{ text: "原句" }] },
    actionPayload: { quality_finding_refs: [] },
    sourceTurnId: "turn-source",
  });
  assert.equal(result.checks.out_of_scope_bytes_preserved, false);
  assert.equal(result.measured.revision_scope, "local");
});

test("retryExchangeChecks 在 firstRequest 缺失而 secondRequest 存在时关闭", () => {
  const call = (pcall, callId) => ({
    role: "assistant",
    provider_call_ref: pcall,
    provider_run_ref: `prun-${callId}`,
    blocks: [{ type: "tool_call", call_id: callId, name: "submit_tentative_artifact" }],
  });
  const result = retryExchangeChecks({
    transcript: { messages: [call("pcall-1", "call-1"), call("pcall-2", "call-2")] },
    records: [
      { provider_call_ref: "pcall-1" },
      { provider_call_ref: "pcall-2", request: { body: { messages: [] } } },
    ],
  });
  assert.equal(result.checks.second_request_is_strict_first_prefix, false);
});

test("requestCarries 把空白 findingInstruction 视为无要求，非空缺失时关闭", () => {
  const call = {
    role: "assistant",
    provider_call_ref: "pcall-1",
    provider_run_ref: "prun-1",
    blocks: [{ type: "tool_call", call_id: "call-1", name: "submit_tentative_artifact" }],
  };
  const record = {
    provider_call_ref: "pcall-1",
    request: { body: { messages: [{ role: "user", content: "原文\n质量修订要求" }] } },
    response: { body: { tool_calls: [{ name: "submit_tentative_artifact", arguments: {} }] } },
  };
  const accepted = retryExchangeChecks({
    transcript: { messages: [call] },
    records: [record],
    originalBody: "原文",
    findingInstruction: undefined,
  });
  assert.equal(accepted.checks.revision_request_carries_source_bytes_and_findings, true);
  const rejected = retryExchangeChecks({
    transcript: { messages: [call] },
    records: [record],
    originalBody: "原文",
    findingInstruction: "具体要求",
  });
  assert.equal(rejected.checks.revision_request_carries_source_bytes_and_findings, false);
});

test("retryExchangeChecks 拒绝 null 或空 items 的第二响应", () => {
  const transcript = {
    messages: [
      {
        role: "assistant",
        provider_call_ref: "pcall-1",
        provider_run_ref: "prun-1",
        blocks: [{ type: "tool_call", call_id: "call-1", name: "submit_tentative_artifact" }],
      },
      { role: "tool", blocks: [{ type: "validation_result", call_id: "call-1", status: "failed", reason_code: "invalid_items" }] },
      {
        role: "assistant",
        provider_call_ref: "pcall-2",
        provider_run_ref: "prun-2",
        blocks: [{ type: "tool_call", call_id: "call-2", name: "submit_tentative_artifact" }],
      },
      { role: "tool", blocks: [{ type: "validation_result", call_id: "call-2", status: "passed", reason_code: "tentative_artifact_validated" }] },
    ],
  };
  const records = [
    {
      provider_call_ref: "pcall-1",
      response: { body: { tool_calls: [{ name: "submit_tentative_artifact", arguments: {} }] } },
    },
    {
      provider_call_ref: "pcall-2",
      response: { body: { tool_calls: [{ name: "submit_tentative_artifact", arguments: { items: [null] } }] } },
    },
  ];
  assert.equal(
    retryExchangeChecks({ transcript, records }).checks.second_response_is_legal_local_revision,
    false,
  );
  records[1].response.body.tool_calls[0].arguments = { items: [] };
  assert.equal(
    retryExchangeChecks({ transcript, records }).checks.second_response_is_legal_local_revision,
    false,
  );
});

test("artifact 字节判据对同长度不同字节关闭", () => {
  const revisionItem = { item_id: "item-1", title: "标题", body: "正文甲", rationale: "理由" };
  const responseItem = { ...revisionItem, body: "正文乙" };
  const artifact = {
    artifact_id: "rev",
    artifact_type: "prose_fragment",
    adoption_status: "TENTATIVE",
    payload: { items: [revisionItem] },
  };
  const checks = revisionArtifactChecks({
    childTurnResult: {
      adoption_state: { pending: [artifact] },
      trace_summary: { revision_artifact_ref: "rev" },
    },
    sourceArtifactId: "source",
    lastLegalArguments: { items: [responseItem] },
  }).checks;
  assert.equal(checks.artifact_items_match_last_legal_response_bytes, false);
});

test("artifact 字节判据绑定完整 item 集合、数量与唯一 item_id", () => {
  const item = (id, body) => ({ item_id: id, title: `标题-${id}`, body, rationale: `理由-${id}` });
  const first = item("item-1", "正文甲");
  const second = item("item-2", "正文乙乙");
  const artifact = {
    artifact_id: "rev",
    artifact_type: "prose_fragment",
    adoption_status: "TENTATIVE",
    payload: { items: [first, second] },
  };
  const input = {
    childTurnResult: {
      adoption_state: { pending: [artifact] },
      trace_summary: { revision_artifact_ref: "rev" },
    },
    sourceArtifactId: "source",
    lastLegalArguments: { items: [first, second] },
  };
  const check = (lastLegalArguments) =>
    revisionArtifactChecks({ ...input, lastLegalArguments }).checks
      .artifact_items_match_last_legal_response_bytes;
  assert.equal(check({ items: [{ ...first }, { ...second }] }), true);
  assert.equal(
    revisionArtifactChecks({ ...input, lastLegalArguments: { items: [first, second] } })
      .measured.revision_body_length,
    first.body.length,
  );
  assert.equal(check({ items: [first, { ...second, body: "正文丙" }] }), false);
  assert.equal(check({ items: [first] }), false);
  assert.equal(check({ items: [first, second, item("item-3", "正文丙")] }), false);
  assert.equal(check({ items: [first, { ...second, item_id: "item-1" }] }), false);
  const duplicateRevision = {
    ...artifact,
    payload: { items: [first, { ...second, item_id: "item-1" }] },
  };
  assert.equal(
    revisionArtifactChecks({
      ...input,
      childTurnResult: {
        adoption_state: { pending: [duplicateRevision] },
        trace_summary: { revision_artifact_ref: "rev" },
      },
    }).checks.artifact_items_match_last_legal_response_bytes,
    false,
  );
  const identicalDuplicateRevision = { ...artifact, payload: { items: [first, first] } };
  assert.equal(
    revisionArtifactChecks({
      ...input,
      childTurnResult: {
        adoption_state: { pending: [identicalDuplicateRevision] },
        trace_summary: { revision_artifact_ref: "rev" },
      },
    }).checks.artifact_items_match_last_legal_response_bytes,
    false,
  );
});

test("原稿保留核验完整 item 集合而非首项", () => {
  const item = (id, body) => ({ item_id: id, title: `标题-${id}`, body, rationale: `理由-${id}` });
  const sourceItems = [item("source-1", "原一"), item("source-2", "原二")];
  const revision = {
    artifact_id: "rev",
    artifact_type: "prose_fragment",
    adoption_status: "TENTATIVE",
    payload: { items: [item("rev-1", "改一")] },
  };
  const base = {
    childTurnResult: {
      adoption_state: { pending: [revision] },
      trace_summary: { revision_artifact_ref: "rev" },
    },
    sourceArtifactId: "source",
    sourceOriginal: {
      artifact_id: "source",
      adoption_status: "TENTATIVE",
      payload: { items: sourceItems },
    },
    sourceWireOriginal: { payload: { items: structuredClone(sourceItems) } },
  };
  const check = (over = {}) =>
    revisionArtifactChecks({ ...base, ...over }).checks
      .original_artifact_unchanged_and_tentative;
  assert.equal(check(), true);
  assert.equal(
    check({
      sourceWireOriginal: {
        payload: { items: [sourceItems[0], { ...sourceItems[1], body: "被改" }] },
      },
    }),
    false,
  );
  assert.equal(
    check({ sourceWireOriginal: { payload: { items: [sourceItems[0]] } } }),
    false,
  );
  assert.equal(
    check({
      sourceWireOriginal: {
        payload: { items: [...sourceItems, item("source-3", "原三")] },
      },
    }),
    false,
  );
  assert.equal(
    check({
      sourceWireOriginal: {
        payload: { items: [sourceItems[0], { ...sourceItems[1], item_id: "source-1" }] },
      },
    }),
    false,
  );
  assert.equal(
    check({
      sourceWireOriginal: {
        payload: { items: [sourceItems[0], sourceItems[0]] },
      },
    }),
    false,
  );
  assert.equal(
    check({
      sourceOriginal: {
        artifact_id: "source",
        adoption_status: "TENTATIVE",
        payload: { items: [sourceItems[0], sourceItems[0]] },
      },
      sourceWireOriginal: { payload: { items: [sourceItems[0], sourceItems[1]] } },
    }),
    false,
  );
  assert.equal(
    check({
      sourceWireOriginal: {
        payload: { items: [item("other-1", "原一"), item("other-2", "原二")] },
      },
    }),
    false,
  );
});

test("v2 receipt 必须携带 run/receipt 身份且与 row/source/child 一致", () => {
  const sourceRecord = { work_id: "work-1", workspace_id: "workspace-1", session_id: "session-1" };
  const base = {
    receiptId: "receipt-1",
    childRunId: "child-run",
    sourceTurnId: "source-turn",
    sourceRecord,
    receiptRow: {
      id: "receipt-1",
      source_turn_ref: "source-turn",
      action_type: "revise_from_findings",
      session_id: "session-1",
      work_id: "work-1",
      result: { admission_version: 2, run_id: "child-run", receipt_id: "receipt-1" },
    },
  };
  const check = (receiptRow) =>
    revisionRunChecks({ ...base, receiptRow }).receipt_stable_and_persisted;
  assert.equal(check(base.receiptRow), true);
  for (const result of [
    null,
    { run_id: "child-run", receipt_id: "receipt-1" },
    { admission_version: 1, run_id: "child-run", receipt_id: "receipt-1" },
    { admission_version: "2", run_id: "child-run", receipt_id: "receipt-1" },
    { admission_version: 2, receipt_id: "receipt-1" },
    { admission_version: 2, run_id: "child-run" },
    { admission_version: 2, run_id: "other-run", receipt_id: "receipt-1" },
    { admission_version: 2, run_id: "child-run", receipt_id: "other-receipt" },
  ]) {
    assert.equal(check({ ...base.receiptRow, result }), false, JSON.stringify(result));
  }
  assert.equal(check({ ...base.receiptRow, source_turn_ref: "other-turn" }), false);
  assert.equal(check({ ...base.receiptRow, action_type: "accept" }), false);
  assert.equal(check({ ...base.receiptRow, session_id: "other-session" }), false);
  assert.equal(check({ ...base.receiptRow, work_id: "other-work" }), false);
});

test("第二请求必须逐字携带第一轮 assistant tool_calls 与关联 validation", () => {
  const originalBody = "他猛地侧身。";
  const legal = { items: [{ item_id: "item-1", title: "标题", body: "改后。", rationale: "理由" }] };
  const firstRequest = [{ role: "system", content: `原正文：${originalBody}\n质量修订要求` }];
  const call = (id, pcall, prun, args) => ({
    role: "assistant",
    provider_call_ref: pcall,
    provider_run_ref: prun,
    blocks: [{ type: "tool_call", call_id: id, name: "submit_tentative_artifact", arguments: args }],
  });
  const validation = (id, status, reason) => ({
    role: "tool",
    blocks: [{ type: "validation_result", call_id: id, status, reason_code: reason }],
  });
  const appended = (over = {}) => ({
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: "call-1",
        type: "function",
        function: { name: "submit_tentative_artifact", arguments: "{}" },
        ...over,
      },
    ],
  });
  const failed = (over = {}) => ({
    role: "tool",
    tool_call_id: "call-1",
    content: JSON.stringify({
      type: "validation_result",
      call_id: "call-1",
      status: "failed",
      reason_code: "invalid_items",
      ...over,
    }),
  });
  const firstResponseCall = { id: "call-1", name: "submit_tentative_artifact", arguments: {} };
  const run = ({ appendedMessage = appended(), failedMessage = failed(), responseCall = firstResponseCall } = {}) =>
    retryExchangeChecks({
      originalBody,
      transcript: {
        messages: [
          call("call-1", "pcall-1", "prun-1", {}),
          validation("call-1", "failed", "invalid_items"),
          call("call-2", "pcall-2", "prun-2", legal),
          validation("call-2", "passed", "tentative_artifact_validated"),
        ],
      },
      records: [
        {
          provider_call_ref: "pcall-1",
          request: { body: { messages: firstRequest } },
          response: { body: { tool_calls: [responseCall] } },
        },
        {
          provider_call_ref: "pcall-2",
          request: {
            body: { messages: [...firstRequest, appendedMessage, failedMessage] },
          },
          response: {
            body: {
              tool_calls: [{ id: "call-2", name: "submit_tentative_artifact", arguments: legal }],
            },
          },
        },
      ],
    });
  assert.equal(run().checks.second_request_appends_only_native_result, true);
  assert.equal(
    run({
      responseCall: {
        id: "call-1",
        name: "submit_tentative_artifact",
        arguments: "{ }",
      },
    }).checks.second_request_appends_only_native_result,
    false,
  );
  assert.equal(
    run({ appendedMessage: appended({ id: "call-other" }) }).checks
      .second_request_appends_only_native_result,
    false,
  );
  assert.equal(
    run({ appendedMessage: appended({ function: { name: "other_tool", arguments: "{}" } }) }).checks
      .second_request_appends_only_native_result,
    false,
  );
  assert.equal(
    run({ appendedMessage: appended({ function: { name: "submit_tentative_artifact", arguments: '{"fabricated":true}' } }) }).checks
      .second_request_appends_only_native_result,
    false,
  );
  assert.equal(
    run({ failedMessage: failed({ call_id: "call-other" }) }).checks
      .second_request_appends_only_native_result,
    false,
  );
  assert.equal(
    run({ failedMessage: failed({ status: "passed" }) }).checks
      .second_request_appends_only_native_result,
    false,
  );
  const missingId = run({ responseCall: { name: "submit_tentative_artifact", arguments: {} } });
  assert.equal(missingId.checks.second_request_appends_only_native_result, true);
  const twoCalls = appended();
  twoCalls.tool_calls.push(structuredClone(twoCalls.tool_calls[0]));
  assert.equal(
    run({ appendedMessage: twoCalls }).checks.second_request_appends_only_native_result,
    false,
  );
});

test("local 修订在源/修订 item 数不唯一时关闭", () => {
  const item = (id, body) => ({ item_id: id, title: id, body, rationale: id });
  const original = item("source-item", "甲。\n乙。\n丙。");
  const revised = item("rev-item", "甲改。\n乙。\n丙。");
  const revisionArtifact = {
    artifact_id: "rev",
    artifact_type: "prose_fragment",
    adoption_status: "TENTATIVE",
    payload: { items: [revised] },
  };
  const base = {
    childTurnResult: {
      adoption_state: { pending: [revisionArtifact] },
      trace_summary: { revision_artifact_ref: "rev" },
    },
    sourceArtifactId: "source",
    lastLegalArguments: { items: [revised] },
    sourceFinding: {
      revision_scope: "local",
      evidence_spans: [{ text: "甲。", sentence_start: 1, sentence_end: 1 }],
    },
    actionPayload: {},
    sourceTurnId: "turn-source",
  };
  const check = (sourceItems, revisionItems) =>
    revisionArtifactChecks({
      ...base,
      sourceOriginal: {
        artifact_id: "source",
        adoption_status: "TENTATIVE",
        payload: { items: sourceItems },
      },
      childTurnResult: {
        ...base.childTurnResult,
        adoption_state: {
          pending: [{ ...revisionArtifact, payload: { items: revisionItems } }],
        },
      },
    }).checks.out_of_scope_bytes_preserved;
  assert.equal(check([original], [revised]), true);
  assert.equal(check([original, item("source-2", "甲。\n乙。\n丙。")], [revised]), false);
  assert.equal(check([original], [revised, item("rev-2", "甲。\n乙。\n丙。")]), false);
});

test("originalPreserved 在半缺失的 source 原稿上关闭而不崩溃", () => {
  const checks = revisionArtifactChecks({
    childTurnResult: { adoption_state: { pending: [] } },
    sourceArtifactId: "source",
    sourceWireOriginal: { payload: { items: [{ title: "source-item" }] } },
  }).checks;
  assert.equal(checks.original_artifact_unchanged_and_tentative, false);
});

test("sourceMissionEvents 只取同 topic/run、接收方向且不早于 source 的真实 mission_derived", () => {
  const event = (at, body, direction = "received", topic = TOPIC) =>
    frame(direction, at, [null, null, topic, "agent_event", body]);
  const mission = (runRef) => ({
    run_ref: runRef,
    event_type: "mission_derived",
    payload: { mission_ref: "mission:cm_1" },
  });
  const own = event(AFTER, mission("run-source"));
  const rows = [
    event(BEFORE, mission("run-source")),
    event(AFTER, mission("run-other")),
    event(AFTER, mission("run-source"), "sent"),
    event(AFTER, mission("run-source"), "received", FOREIGN),
    event(AFTER, { ...mission("run-source"), event_type: "other" }),
    own,
  ];
  const found = sourceMissionEvents(rows, { topic: TOPIC, since: AT, runId: "run-source" });
  assert.equal(found.length, 1);
  assert.equal(found[0], own);
  assert.deepEqual(sourceMissionEvents([], { topic: TOPIC, since: AT, runId: "run-source" }), []);
  for (const bad of [
    null,
    { topic: "", since: AT, runId: "run-source" },
    { topic: TOPIC, since: 1, runId: "run-source" },
    { topic: TOPIC, since: "", runId: "run-source" },
    { topic: TOPIC, since: AT, runId: "" },
    {},
  ]) {
    assert.deepEqual(sourceMissionEvents([own], bad), [], JSON.stringify(bad));
  }
  const nullBody = frame("received", AFTER, [null, null, TOPIC, "agent_event", null]);
  assert.deepEqual(sourceMissionEvents([nullBody], { topic: TOPIC, since: AT, runId: "run-source" }), []);
});


test("canonical IR 重试请求按 blocks 证明第一轮 tool_call/validation 原样追加", () => {
  const originalBody = "他猛地侧身。";
  const legal = { items: [{ item_id: "item-1", title: "标题", body: "改后。", rationale: "理由" }] };
  const firstBody = irBodyFromWire({
    messages: [{ role: "user", content: `原文：${originalBody}\n质量修订要求` }],
  });
  const appendedAssistant = {
    role: "assistant",
    provenance: "model",
    blocks: [{ type: "tool_call", call_id: "call-1", name: "submit_tentative_artifact", arguments: {} }],
    source_refs: [],
    versions: {},
  };
  const appendedValidation = {
    role: "tool",
    provenance: "tool_result",
    blocks: [
      {
        type: "validation_result",
        call_id: "call-1",
        status: "failed",
        reason_code: "invalid_items",
      },
    ],
    source_refs: [],
    versions: {},
  };
  const secondBody = {
    ...firstBody,
    messages: [...firstBody.messages, appendedAssistant, appendedValidation],
  };
  const call = (id, pcall, prun, args) => ({
    role: "assistant",
    provider_call_ref: pcall,
    provider_run_ref: prun,
    blocks: [{ type: "tool_call", call_id: id, name: "submit_tentative_artifact", arguments: args }],
  });
  const validation = (id, status, reason) => ({
    role: "tool",
    blocks: [{ type: "validation_result", call_id: id, status, reason_code: reason }],
  });
  const result = retryExchangeChecks({
    originalBody,
    transcript: {
      messages: [
        call("call-1", "pcall-1", "prun-1", {}),
        validation("call-1", "failed", "invalid_items"),
        call("call-2", "pcall-2", "prun-2", legal),
        validation("call-2", "passed", "tentative_artifact_validated"),
      ],
    },
    records: [
      {
        provider_call_ref: "pcall-1",
        request_format: "authoring-request-ir/v1",
        request_body: firstBody,
        response: { body: { tool_calls: [{ id: "call-1", name: "submit_tentative_artifact", arguments: {} }] } },
      },
      {
        provider_call_ref: "pcall-2",
        request_format: "authoring-request-ir/v1",
        request_body: secondBody,
        response: { body: { tool_calls: [{ id: "call-2", name: "submit_tentative_artifact", arguments: legal }] } },
      },
    ],
  });
  assert.equal(result.checks.second_request_is_strict_first_prefix, true);
  assert.equal(result.checks.second_request_appends_only_native_result, true);
  assert.equal(result.checks.revision_request_carries_source_bytes_and_findings, true);
  assert.equal(result.checks.second_response_is_legal_local_revision, true);
});
