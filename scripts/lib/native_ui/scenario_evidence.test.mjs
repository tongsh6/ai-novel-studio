// 共享请求/广播证据边界的行为测试：真实 Phoenix 帧形状的选择与失败关闭。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  PRODUCTION_TABLES,
  assertCommonEvidence,
  assertProviderAndWire,
  assertRecordFresh,
  assertWaitLedger,
  broadcastFrames,
  checkProductionFingerprint,
  productionFingerprint,
  productionTableCounts,
  requestIdentity,
  requestReplies,
  sentUserMessages,
  turnFacts,
} from "./scenario_evidence.mjs";

const TOPIC = "workspace:scope";
const T0 = "2026-11-02T02:00:00.000Z";
const T1 = "2026-11-02T02:00:00.100Z";
const T2 = "2026-11-02T02:00:00.200Z";
const T3 = "2026-11-02T02:00:00.300Z";

const frame = (joinRef, requestRef, topic, event, body, direction = "received", at = T0) => ({
  direction,
  at,
  frame: [joinRef, requestRef, topic, event, body],
});

const sent = (at = T0) =>
  frame("join-1", "request-1", TOPIC, "user_message", { turn_id: "turn-1", text: "输入" }, "sent", at);

const reply = (body, { joinRef = "join-1", requestRef = "request-1", topic = TOPIC, at = T1 } = {}) =>
  frame(joinRef, requestRef, topic, "phx_reply", body, "received", at);

const okReply = (runId = "run-1") => reply({
  status: "ok",
  response: { turn_id: "turn-1", run_id: runId },
});

const result = (body, { topic = TOPIC, at = T2 } = {}) =>
  frame(null, null, topic, "turn_result", body, "received", at);

const event = (body, { topic = TOPIC, at = T2, direction = "received" } = {}) =>
  frame(null, null, topic, "agent_event", body, direction, at);

test("turnFacts 用作者消息自己的 join_ref/request_ref/topic 绑定唯一 ACK", () => {
  const message = sent();
  const ack = okReply();
  const facts = turnFacts([message, ack, result({ agent_run: { run_id: "run-1" } })], message);
  assert.equal(facts.turnId, "turn-1");
  assert.equal(facts.ack, ack);
  assert.equal(facts.results.length, 1);
  assert.equal(facts.results[0].frame[2], TOPIC);
});

test("turnFacts 拒绝缺失、错方向或错请求身份的 ACK", () => {
  const message = sent();
  const turnResult = result({ agent_run: { run_id: "run-1" } });
  const cases = [
    reply({ status: "ok", response: { turn_id: "turn-1" } }, { joinRef: "join-foreign" }),
    reply({ status: "ok", response: { turn_id: "turn-1" } }, { requestRef: "request-foreign" }),
    reply({ status: "ok", response: { turn_id: "turn-1" } }, { topic: "workspace:foreign" }),
    reply({ status: "ok", response: { turn_id: "turn-1" } }, { at: "2026-11-01T23:59:59.000Z" }),
  ];
  for (const candidate of cases) {
    assert.equal(turnFacts([message, candidate, turnResult], message).ack, undefined);
  }
});

test("turnFacts 对同一请求多个 ACK 失败，不任选第一个", () => {
  const message = sent();
  const turnResult = result({ agent_run: { run_id: "run-1" } });
  assert.throws(
    () => turnFacts([message, okReply("run-1"), okReply("run-2"), turnResult], message),
    /ACK 多义/,
  );
});

test("turnFacts 只把成功且 turn 匹配的 ACK 交给消费者，run_id 仍由消费者核验", () => {
  const message = sent();
  const turnResult = result({ agent_run: { run_id: "run-1" } });
  const errorAck = reply({ status: "error", response: { turn_id: "turn-1" } });
  assert.equal(turnFacts([message, errorAck, turnResult], message).ack, undefined);
  const otherTurn = reply({ status: "ok", response: { turn_id: "turn-other" } });
  assert.equal(turnFacts([message, otherTurn, turnResult], message).ack, undefined);
  const noRun = reply({ status: "ok", response: { turn_id: "turn-1" } });
  assert.equal(turnFacts([message, noRun, turnResult], message).ack, noRun);
});

test("turnFacts 只接受同 topic/接收方向/不早于发送时间的 turn_result", () => {
  const message = sent();
  const ack = okReply();
  const wire = [
    message,
    ack,
    result({ agent_run: { run_id: "run-1" } }, { topic: "workspace:foreign" }),
    result({ agent_run: { run_id: "run-1" } }, { at: "2026-11-01T23:59:59.000Z" }),
    event({ agent_run: { run_id: "run-1" } }),
    result({ agent_run: { run_id: "run-1" } }),
  ];
  const facts = turnFacts(wire, message);
  assert.equal(facts.results.length, 1);
  assert.equal(facts.results[0].frame[2], TOPIC);
});

test("turnFacts 缺 turn_id、方向、join/request/topic 或结果时关闭", () => {
  const message = sent();
  const turnResult = result({ agent_run: { run_id: "run-1" } });
  assert.throws(
    () => turnFacts([turnResult], frame("join-1", "request-1", TOPIC, "user_message", {}, "sent", T0)),
    /缺 turn_id/,
  );
  assert.throws(() => turnFacts([turnResult], { direction: "sent", at: T0 }), /缺 turn_id/);
  assert.throws(
    () => turnFacts([turnResult], frame("join-1", "request-1", TOPIC, "user_message", { turn_id: "turn-1" })),
    /必须是发送方向/,
  );
  const noAt = frame("join-1", "request-1", TOPIC, "user_message", { turn_id: "turn-1" }, "sent", T0);
  delete noAt.at;
  assert.throws(() => turnFacts([turnResult], noAt), /user_message 缺 at/);
  for (const [joinRef, requestRef, topic] of [
    [null, "request-1", TOPIC],
    ["join-1", null, TOPIC],
    ["join-1", "request-1", null],
  ]) {
    assert.throws(
      () => turnFacts(
        [turnResult],
        frame(joinRef, requestRef, topic, "user_message", { turn_id: "turn-1" }, "sent", T0),
      ),
      /缺 (join_ref|request_ref|topic)/,
    );
  }
  assert.throws(() => turnFacts([message, okReply()], message), /缺少 turn_result/);
});

test("requestIdentity/requestReplies 是请求与回复的共享边界", () => {
  const message = sent();
  const identity = requestIdentity(message);
  assert.deepEqual(identity, { joinRef: "join-1", requestRef: "request-1", topic: TOPIC });
  assert.deepEqual(
    requestReplies([message, okReply(), reply({}, { topic: "workspace:foreign" })], identity, message.at),
    [okReply()],
  );
  assert.deepEqual(requestReplies([message], identity, T1), []);

  assert.throws(
    () => requestIdentity({ direction: "received", at: T0, frame: message.frame }),
    /user_message 必须是发送方向/,
  );
  assert.throws(
    () => requestIdentity({ direction: "sent", frame: message.frame }),
    /user_message 缺 at/,
  );
  assert.throws(
    () => requestIdentity({ direction: "sent", at: T0, frame: [null, "request-1", TOPIC, "user_message", {}] }),
    /user_message 缺 join_ref/,
  );
  assert.throws(
    () => requestIdentity({ direction: "sent", at: T0, frame: ["join-1", null, TOPIC, "user_message", {}] }),
    /user_message 缺 request_ref/,
  );
  assert.throws(
    () => requestIdentity({ direction: "sent", at: T0, frame: ["join-1", "request-1", null, "user_message", {}] }),
    /user_message 缺 topic/,
  );
  assert.throws(
    () => requestIdentity({ direction: "sent", at: T0 }),
    /user_message 缺真实 WS 帧/,
  );
});

test("broadcastFrames 按 owning topic/方向/event 绑定，真实 null join/ref 广播可识别", () => {
  const wire = [
    event({ event_type: "exploration_observed" }),
    event({ event_type: "exploration_observed" }, { direction: "sent" }),
    event({ event_type: "exploration_observed" }, { topic: "workspace:foreign" }),
    frame("join-1", "request-1", TOPIC, "agent_event", { event_type: "exploration_observed" }),
    { direction: "received", at: T2 },
  ];
  assert.equal(broadcastFrames(wire, { topic: TOPIC }).length, 2);
  assert.equal(broadcastFrames(wire, { topic: TOPIC, event: "agent_event" }).length, 2);
  assert.equal(broadcastFrames(wire, { topic: TOPIC, event: "turn_result" }).length, 0);
  assert.equal(broadcastFrames(wire, { topic: TOPIC, direction: "sent" }).length, 1);
  assert.equal(broadcastFrames(wire, { topic: "workspace:foreign" }).length, 1);
});

test("broadcastFrames 的 at/runRef/agentRunId 过滤各自精确且可组合", () => {
  const wire = [
    event({ run_ref: "run-1", run_id: "run-1", agent_run: { run_id: "run-1" } }, { at: T1 }),
    event({ run_ref: "run-1", run_id: "run-2", agent_run: { run_id: "run-1" } }, { at: T2 }),
    event({ run_ref: "run-2", run_id: undefined, agent_run: { run_id: "run-2" } }, { at: T3 }),
    event({ run_ref: "run-1", run_id: "run-1", agent_run: { run_id: "run-2" } }, { at: T3 }),
    event({ run_ref: "run-1", run_id: "run-1" }, { at: T3 }),
    event(null, { at: T3 }),
  ];
  assert.equal(broadcastFrames(wire, { topic: TOPIC, at: T2 }).length, 5);
  assert.equal(broadcastFrames(wire, { topic: TOPIC, runRef: "run-1" }).length, 3);
  assert.equal(broadcastFrames(wire, { topic: TOPIC, agentRunId: "run-1" }).length, 2);
  assert.equal(
    broadcastFrames(wire, { topic: TOPIC, runRef: "run-1", agentRunId: "run-1" }).length,
    1,
  );
  assert.equal(broadcastFrames(wire, { topic: TOPIC, runRef: "run-1", at: T3 }).length, 2);
});

test("broadcastFrames 缺 owning topic 时关闭", () => {
  assert.throws(() => broadcastFrames([], {}), /缺 owning topic/);
  assert.throws(() => broadcastFrames([], { topic: "" }), /缺 owning topic/);
});

// ── 共享模块的既有批次断言：成功路径与失败关闭 ─────────────────────────────────

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "scenario-evidence-"));
const writeJson = (dir, file, value) =>
  fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
const writeJsonl = (dir, file, records) =>
  fs.writeFileSync(path.join(dir, file), records.map((record) => JSON.stringify(record)).join("\n") + "\n");

function writeWaitLedger(
  dir,
  {
    commands = [
      { op: "begin", id: "wait-1" },
      { op: "finish", id: "wait-1" },
    ],
    events = [
      { event: "wait_start", at: 1000, kind: "input" },
      { event: "wait_end", at: 1000, ended_at: 2000, kind: "input" },
    ],
    stats = { active: null, completed: 1 },
    heartbeat = true,
  } = {},
) {
  writeJsonl(dir, "native-driver-commands.jsonl", commands);
  writeJsonl(dir, "wait-events.jsonl", events);
  writeJson(dir, "wait-stats.json", stats);
  const heartbeatPath = path.join(dir, "heartbeat.jsonl");
  if (heartbeat) fs.writeFileSync(heartbeatPath, "{}\n");
  else fs.rmSync(heartbeatPath, { force: true });
}

test("sentUserMessages 只选同文本的发送 user_message 并按 turn_id 去重", () => {
  const first = frame("join-1", "request-1", TOPIC, "user_message", { text: "目标", turn_id: "t1" }, "sent", T0);
  const duplicate = structuredClone(first);
  const second = frame("join-1", "request-2", TOPIC, "user_message", { text: "目标", turn_id: "t2" }, "sent", T1);
  const wire = [
    first,
    duplicate,
    second,
    frame("join-1", "request-3", TOPIC, "user_message", { text: "其它", turn_id: "t3" }, "sent", T1),
    frame("join-1", "request-4", TOPIC, "user_message", { text: "目标", turn_id: "t4" }, "received", T1),
    { direction: "sent", at: T1 },
  ];
  assert.deepEqual(sentUserMessages(wire, "目标"), [first, second]);
  assert.deepEqual(sentUserMessages([], "目标"), []);
});

test("productionFingerprint 读取 git HEAD 与受控产品文件哈希", () => {
  const fingerprint = productionFingerprint();
  assert.match(fingerprint.head, /^[0-9a-f]{40}$/);
  assert.ok(fingerprint.file_count > 0);
  assert.match(fingerprint.files["frontend/src/lib/socket.ts"], /^[0-9a-f]{64}$/);
});

test("productionFingerprint 覆盖 tracked+untracked、遵循 gitignore/productPath 并发现增删改", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-fingerprint-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  };
  try {
    git("init");
    git("config", "user.email", "b71@example.test");
    git("config", "user.name", "b71");
    write("frontend/src/tracked.ts", "export const tracked = 1;\n");
    write("apps/demo/lib/tracked.ex", "defmodule Demo.Tracked do\nend\n");
    write("test/support/existing.ex", "defmodule Demo.Support do\nend\n");
    write("artifacts/before.txt", "ignored by gitignore");
    write(".gitignore", "artifacts/\n*.tmp\n");
    git("add", ".");
    git("commit", "-m", "base");

    write("frontend/src/untracked.ts", "export const untracked = 1;\n");
    write("apps/demo/lib/untracked.ex", "defmodule Demo.Untracked do\nend\n");
    write("test/support/untracked.ex", "defmodule Demo.UntrackedSupport do\nend\n");
    write("artifacts/after.txt", "still ignored");
    write("frontend/src/ignored.tmp", "ignored by extension");

    const first = productionFingerprint(dir);
    assert.match(first.head, /^[0-9a-f]{40}$/);
    assert.match(first.files["frontend/src/tracked.ts"], /^[0-9a-f]{64}$/);
    assert.match(first.files["frontend/src/untracked.ts"], /^[0-9a-f]{64}$/);
    assert.match(first.files["apps/demo/lib/untracked.ex"], /^[0-9a-f]{64}$/);
    assert.equal(Object.hasOwn(first.files, "test/support/existing.ex"), false);
    assert.equal(Object.hasOwn(first.files, "test/support/untracked.ex"), false);
    assert.equal(Object.hasOwn(first.files, "artifacts/after.txt"), false);
    assert.equal(Object.hasOwn(first.files, "frontend/src/ignored.tmp"), false);
    assert.equal(first.file_count, Object.keys(first.files).length);

    write("frontend/src/untracked.ts", "export const untracked = 2;\n");
    const modified = productionFingerprint(dir);
    assert.notEqual(modified.files["frontend/src/untracked.ts"], first.files["frontend/src/untracked.ts"]);

    fs.rmSync(path.join(dir, "apps/demo/lib/untracked.ex"));
    const deletedUntracked = productionFingerprint(dir);
    assert.equal(Object.hasOwn(deletedUntracked.files, "apps/demo/lib/untracked.ex"), false);
    assert.notDeepEqual(deletedUntracked.files, first.files);

    write("apps/demo/lib/new.ex", "defmodule Demo.New do\nend\n");
    const added = productionFingerprint(dir);
    assert.match(added.files["apps/demo/lib/new.ex"], /^[0-9a-f]{64}$/);
    assert.equal(added.file_count, deletedUntracked.file_count + 1);
    assert.equal(added.file_count, first.file_count);

    fs.rmSync(path.join(dir, "frontend/src/tracked.ts"));
    const deletedTracked = productionFingerprint(dir);
    assert.equal(deletedTracked.files["frontend/src/tracked.ts"], "missing");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("assertRecordFresh 要求三份证据齐全、不过期且截图魔数合法", () => {
  const dir = tempDir();
  try {
    const readyAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(path.join(dir, "cap.ax.txt"), "ax");
    fs.writeFileSync(path.join(dir, "cap.text.txt"), "text");
    fs.writeFileSync(path.join(dir, "cap.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]));
    assert.doesNotThrow(() => assertRecordFresh(dir, "cap", readyAt));

    fs.rmSync(path.join(dir, "cap.text.txt"));
    assert.throws(() => assertRecordFresh(dir, "cap", readyAt), /缺少证据文件: cap.text.txt/);
    fs.writeFileSync(path.join(dir, "cap.text.txt"), "text");

    const future = new Date(Date.now() + 60_000).toISOString();
    assert.throws(() => assertRecordFresh(dir, "cap", future), /证据文件早于原生窗口就绪/);

    fs.writeFileSync(path.join(dir, "cap.jpg"), Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]));
    assert.throws(() => assertRecordFresh(dir, "cap", readyAt), /截图格式非法/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("assertWaitLedger 收支平衡、分型齐全且有监督心跳时返回统计", () => {
  const dir = tempDir();
  try {
    const check = () => assertWaitLedger(dir, { minimum: 1, requiredKinds: ["input"] });
    writeWaitLedger(dir);
    const ledger = check();
    assert.equal(ledger.commands, 2);
    assert.equal(ledger.waits, 1);
    assert.deepEqual(ledger.kinds, ["input"]);
    assert.deepEqual(ledger.by_kind, { input: 1 });
    assert.equal(ledger.heartbeat_count, 1);
    assert.equal(ledger.run_elapsed_ms, 1000);

    writeWaitLedger(dir, { commands: [{ op: "begin", id: "wait-1" }] });
    assert.throws(check, /等待账仍有未完成 begin/);
    writeWaitLedger(dir, { commands: [{ op: "begin", id: "wait-1" }, { op: "begin", id: "wait-1" }] });
    assert.throws(check, /重复 begin/);
    writeWaitLedger(dir, { commands: [{ op: "finish", id: "wait-1" }] });
    assert.throws(check, /finish 未匹配 begin/);
    writeWaitLedger(dir, { events: [{ event: "wait_start", at: 1000, kind: "input" }] });
    assert.throws(check, /等待账 start\/end 不平衡/);
    writeWaitLedger(dir, {
      events: [
        { event: "wait_start", at: 1000, kind: "other" },
        { event: "wait_end", at: 2000, kind: "other" },
      ],
    });
    assert.throws(check, /缺少 input 分型等待账/);
    writeWaitLedger(dir, { stats: { active: "still-waiting", completed: 1 } });
    assert.throws(check, /等待账结束时不得有活动等待/);
    writeWaitLedger(dir, { stats: { active: null, completed: 0 } });
    assert.throws(check, /等待账完成数不足/);
    writeWaitLedger(dir, { heartbeat: false });
    assert.throws(check, /缺少监督心跳 heartbeat.jsonl/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeProviderBatch(dir, provider = "slice_verify") {
  fs.mkdirSync(path.join(dir, "app-log"), { recursive: true });
  fs.mkdirSync(path.join(dir, "llm-calls"), { recursive: true });
  writeJsonl(dir, "app-log/a.jsonl", [
    { event: "provider_gateway.complete.start", provider },
  ]);
  writeJsonl(dir, "llm-calls/a.jsonl", [{ provider, request_format: "provider_prompt/v1" }]);
  writeJsonl(dir, "native-transport.jsonl", [
    frame("join-1", "request-1", TOPIC, "user_message", { turn_id: "t1", text: "hi" }, "sent", T0),
    frame(null, null, TOPIC, "turn_result", { turn_id: "t1" }, "received", T1),
    { direction: "http", at: T1, path: "/api/x", status: 200 },
  ]);
}

test("assertProviderAndWire 汇总真实 transport/provider 记录并拒绝错 provider", () => {
  const dir = tempDir();
  try {
    writeProviderBatch(dir);
    const out = assertProviderAndWire(dir);
    assert.equal(out.providerStarts.length, 1);
    assert.equal(out.userMessages.length, 1);
    assert.equal(out.turnResults.length, 1);
    assert.equal(out.wire.length, 3);

    writeProviderBatch(dir, "strata");
    assert.throws(() => assertProviderAndWire(dir), /批次 provider 必须是 slice_verify/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeCommonBatch(dir, sliceId = "slice-x") {
  const readyAt = new Date(Date.now() - 1000).toISOString();
  writeJson(dir, "native-driver-ready.json", {
    driver: "external-system-ui",
    browser_driver_started: false,
    run_ref: "run-x",
    ready_at: readyAt,
  });
  writeJson(dir, "native-ui-complete.json", {
    harness_run_ref: "run-x",
    driver: "ax-native-system-ui",
    app_bundle: "com.ai-novel-studio.app",
    scope: sliceId,
    screenshots: ["shot.jpg"],
  });
  fs.writeFileSync(path.join(dir, "shot.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]));
  writeWaitLedger(dir);
}

test("assertCommonEvidence 通过完整批次并在 failure/ui-frames 标记时关闭", () => {
  const dir = tempDir();
  const spec = {
    sliceId: "slice-x",
    minScreenshots: 1,
    minimumWaits: 1,
    requiredKinds: ["input"],
  };
  try {
    writeCommonBatch(dir);
    const out = assertCommonEvidence(dir, spec);
    assert.equal(out.ready.run_ref, "run-x");
    assert.equal(out.ui.scope, "slice-x");
    assert.equal(out.ledger.waits, 1);

    writeJson(dir, "failure.json", { reason: "native_evidence_verification_failed" });
    assert.doesNotThrow(() =>
      assertCommonEvidence(dir, { ...spec, allowVerificationFailureMarker: true }),
    );
    assert.throws(() => assertCommonEvidence(dir, spec), /批次存在 failure.json，不得判 PASS/);
    fs.rmSync(path.join(dir, "failure.json"));

    fs.writeFileSync(path.join(dir, "ui-frames.json"), "{}");
    assert.throws(() => assertCommonEvidence(dir, spec), /不得存在浏览器 ui-frames 证据/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("productionTableCounts 只读临时 SQLite 的生产表计数", () => {
  const dir = tempDir();
  try {
    fs.mkdirSync(path.join(dir, "database"), { recursive: true });
    const db = new DatabaseSync(path.join(dir, "database", "ai_novel_studio_test.sqlite3"));
    try {
      for (const table of PRODUCTION_TABLES) {
        db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY)`);
      }
      db.exec("INSERT INTO works (id) VALUES ('work-1')");
    } finally {
      db.close();
    }
    const counts = productionTableCounts(dir);
    assert.equal(counts.works, 1);
    assert.equal(counts.workspaces, 0);
    assert.equal(Object.keys(counts).length, PRODUCTION_TABLES.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("checkProductionFingerprint 比对批次前后产品源码指纹", () => {
  const dir = tempDir();
  try {
    const before = productionFingerprint();
    writeJson(dir, "production-sources-before.json", before);
    const same = checkProductionFingerprint(dir);
    assert.equal(same.unchanged, true);
    assert.deepEqual(same.changed_files, []);
    assert.equal(same.head.before, before.head);
    assert.match(same.head.now, /^[0-9a-f]{40}$/);

    const changedFile = "frontend/src/lib/socket.ts";
    writeJson(dir, "production-sources-before.json", {
      ...before,
      files: { ...before.files, [changedFile]: "0".repeat(64) },
    });
    const changed = checkProductionFingerprint(dir);
    assert.equal(changed.unchanged, false);
    assert.ok(changed.changed_files.includes(changedFile));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("重连后 join_ref/request_ref 复用：新连接 ACK 不得算给旧请求（真实 cp4b-pending-04 形状）", () => {
  // 真实批次 restore 后，新 socket 的 join/ref 从同一起点重新计数：followup 与 source
  // 都是 join_ref=5/request_ref=9。回复必须绑定请求所在 socket 连接段。
  const firstJoin = frame("join-1", "request-1", TOPIC, "phx_join", { session: "s" }, "sent", T0);
  const firstMessage = sent(T0);
  const firstAck = okReply("run-old");
  const secondJoin = frame("join-1", "request-1", TOPIC, "phx_join", { session: "s" }, "sent", T2);
  const secondMessage = frame(
    "join-1",
    "request-1",
    TOPIC,
    "user_message",
    { turn_id: "turn-2", text: "资料处理进度怎么样？" },
    "sent",
    T3,
  );
  const secondAck = frame(
    "join-1",
    "request-1",
    TOPIC,
    "phx_reply",
    { status: "ok", response: { turn_id: "turn-2", run_id: "run-new" } },
    "received",
    "2026-11-02T02:00:00.400Z",
  );
  const wire = [firstJoin, firstMessage, firstAck, secondJoin, secondMessage, secondAck];

  const identity = requestIdentity(firstMessage);
  assert.deepEqual(requestReplies(wire, identity, firstMessage.at), [firstAck]);

  // 旧连接内本请求的 ACK 缺失时失败关闭（不能借用新连接同 ref 的 ACK）。
  assert.deepEqual(requestReplies([firstJoin, firstMessage, secondJoin, secondMessage, secondAck], identity, firstMessage.at), []);

  // turnFacts 走同一共享边界：旧请求只认旧连接的 ACK。
  const results = result({ agent_run: { run_id: "run-old" } }, { at: "2026-11-02T02:00:00.150Z" });
  const facts = turnFacts([firstJoin, firstMessage, firstAck, results, secondJoin, secondMessage, secondAck], firstMessage);
  assert.equal(facts.ack, firstAck);
});
