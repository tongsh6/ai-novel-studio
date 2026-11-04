// B71 证据采集适配的行为测试：真实帧形状的选择、缺失关闭与结果落盘。
// 测试只验证采集/持久化边界，不声称任何真实页面批次已通过。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  ackRunId,
  authoringInput,
  authoringRunFacts,
  collectAuthoringRun,
  completedForRun,
  explorationFacts,
  finishVerification,
  firstCompletedTurn,
  lastCompletedTurn,
  readCheckpoint,
  verificationExtra,
} from "./authoring_run_evidence.mjs";
import { requestBodies, requestBodiesOf } from "./authoring_scenario_evidence.mjs";
import { irBodyFromWire } from "./fixtures/authoring_request_ir.mjs";

const frame = (event, body, direction = "received", at = "2026-11-01T08:00:00.000Z") => ({
  direction,
  at,
  frame: ["join", "ref", "room:test", event, body],
});

test("作者输入与 ack run_id 只接受真实匹配帧，缺失时失败", () => {
  const sent = frame("user_message", { text: "目标输入", turn_id: "turn-1" }, "sent");
  assert.equal(
    authoringInput([frame("user_message", { text: "其它" }), sent], {
      message: "目标输入",
      missingInput: "缺少作者输入",
    }),
    sent,
  );
  assert.equal(
    authoringInput([sent], { message: "目标输入", missingInput: "缺少作者输入" }),
    sent,
  );
  // 非帧记录没有 body，不能因可选读取缺失而抛错。
  assert.equal(
    authoringInput([{ direction: "sent", at: "2026-11-01T08:00:00.000Z" }, sent], {
      message: "目标输入",
      missingInput: "缺少作者输入",
    }),
    sent,
  );
  assert.throws(
    () => authoringInput([], { message: "目标输入", missingInput: "缺少作者输入" }),
    /缺少作者输入/,
  );
  assert.equal(
    ackRunId(frame("phx_reply", { status: "ok", response: { run_id: "run-1" } }), {
      missingAck: "缺 run_id",
    }),
    "run-1",
  );
  for (const bad of [null, frame("phx_reply", { status: "ok", response: {} }), frame("phx_reply", null)]) {
    assert.throws(() => ackRunId(bad, { missingAck: "缺 run_id" }), /缺 run_id/);
  }
});

test("completed 结果必须同时匹配 run 与 completed 状态，首/末选择各自精确", () => {
  const completed = (runId) => ({ agent_run: { run_id: runId, status: "completed" } });
  assert.equal(completedForRun(completed("run-1"), "run-1"), true);
  assert.equal(completedForRun(completed("run-2"), "run-1"), false);
  assert.equal(completedForRun({ agent_run: { run_id: "run-1", status: "failed" } }, "run-1"), false);
  assert.equal(completedForRun(null, "run-1"), false);
  assert.equal(completedForRun({}, "run-1"), false);

  const results = [
    { agent_run: { run_id: "run-1", status: "failed" } },
    completed("run-1"),
    completed("run-2"),
    completed("run-1"),
    completed("run-1"),
  ];
  assert.equal(firstCompletedTurn(results, "run-1", "缺完成结果"), results[1]);
  assert.equal(lastCompletedTurn(results, "run-1", "缺完成结果"), results[4]);
  assert.throws(() => firstCompletedTurn(results, "run-9", "缺完成结果"), /缺完成结果/);
  assert.throws(() => lastCompletedTurn(results, "run-9", "缺完成结果"), /缺完成结果/);
});

test("探索事件只认 owning scope 的 agent_event/exploration_observed 并保留真实查询顺序", () => {
  const observed = (body) => ({
    ...frame("agent_event", {
      event_type: "exploration_observed",
      run_ref: "run-1",
      run_id: "run-1",
      ...body,
    }),
  });
  const wire = [
    frame("agent_event", { event_type: "other", payload: { query: "q-0" }, run_ref: "run-1" }),
    observed({ payload: { query: "q-1" } }),
    frame("turn_result", { turn_id: "turn-1" }),
    observed({ payload: { query: "q-2" } }),
    observed({ payload: undefined }),
    frame("agent_event", null),
  ];
  const facts = explorationFacts(wire, { topic: "room:test", runId: "run-1" });
  assert.equal(facts.count, 3);
  assert.deepEqual(facts.queries, ["q-1", "q-2", undefined]);
  assert.equal(explorationFacts([], { topic: "room:test", runId: "run-1" }).count, 0);
  assert.deepEqual(explorationFacts([], { topic: "room:test", runId: "run-1" }).queries, []);
});

test("检查项未全通过时在落盘前失败，通过后按既有名称写 checks/summary", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-run-evidence-"));
  try {
    fs.writeFileSync(path.join(dir, "native-transport.jsonl"), `${JSON.stringify(frame("agent_event", {
      event_type: "tool_call",
      payload: {},
    }))}\n`);
    assert.throws(
      () => finishVerification(dir, {
        checks: { ok: true, broken: false },
        measured: { count: 1 },
        sliceId: "b71-test",
        label: "测试核验",
        extra: {},
      }),
      /测试核验 原生断言失败: broken/,
    );
    assert.equal(fs.existsSync(path.join(dir, "native-b71-checks.json")), false);

    const result = finishVerification(dir, {
      checks: { ok: true },
      measured: { count: 1 },
      sliceId: "b71-test",
      label: "测试核验",
      extra: { behavior: { assertions: ["ok"] } },
    });
    assert.deepEqual(result, { checks: { ok: true }, measured: { count: 1 } });
    const written = JSON.parse(fs.readFileSync(path.join(dir, "native-b71-checks.json"), "utf8"));
    assert.deepEqual(written, { checks: { ok: true }, failed: [], measured: { count: 1 } });
    const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
    assert.equal(summary.slice_id, "b71-test");
    assert.equal(summary.all_checks_passed, true);
    assert.equal(summary.checks_passed, 1);
    assert.equal(summary.checks_total, 1);
    assert.equal(fs.existsSync(path.join(dir, "native-ws-frames.json")), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("checkpoint 读取与 summary extra 使用既有字段名", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-checkpoint-"));
  try {
    fs.writeFileSync(
      path.join(dir, "b71-start.json"),
      JSON.stringify({ checkpoint: "start", db_production_counts: { works: 1 } }),
    );
    assert.deepEqual(readCheckpoint(dir, "start").db_production_counts, { works: 1 });
    const extra = verificationExtra({
      checks: { ok: true, broken: false },
      common: { ledger: { waits: 9 }, ui: { screenshots: ["a.jpg"] } },
      turnId: "turn-1",
      turnIds: ["turn-0", "turn-1"],
      behavior: { native_request: { request_count: 1 } },
    });
    assert.equal(extra.turn_id, "turn-1");
    assert.deepEqual(extra.turn_ids, ["turn-0", "turn-1"]);
    assert.deepEqual(extra.behavior.assertions, ["ok"]);
    assert.deepEqual(extra.wait_ledger, { waits: 9 });
    assert.deepEqual(extra.screenshots, ["a.jpg"]);
    assert.equal(typeof extra.evidence_boundary, "string");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("采集入口在证据缺失时关闭，不返回空结果", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-collect-"));
  try {
    assert.throws(
      () => collectAuthoringRun(dir, {
        common: { sliceId: "b71-authoring-transcript", minScreenshots: 3, minimumWaits: 9 },
        wire: { minUserMessages: 1, minTurnResults: 1, minProviderStarts: 3 },
        message: "目标",
        missingInput: "缺输入",
        missingAck: "缺 ack",
        missingCompleted: "缺完成",
        completedTurn: "first",
      }),
      /缺少 native-driver-ready/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── first-consumer：真实 ACK run + 同 run pcall 记录 ──────────────────────────
const F_WORK = "work-first";
const F_WORKSPACE = "workspace-first";
const F_SESSION = "session-first";
const F_PARENT = "message-first";
const F_RUN = "run-first";
const F_DECOY = "run-decoy";
const F_MESSAGE = "「灰烬中的手印」这章我怀疑有重复，请把全章核对一遍。";
const F_TOPIC = `workspace:${F_WORKSPACE}`;
const F_T0 = "2026-11-02T01:00:00.000Z";
const F_T1 = "2026-11-02T01:00:00.100Z";
const F_T2 = "2026-11-02T01:00:00.200Z";
const F_T3 = "2026-11-02T01:00:00.300Z";
const F_T4 = "2026-11-02T01:00:01.000Z";

const F_FIRST_SPEC = Object.freeze({
  message: F_MESSAGE,
  missingInput: "缺全章核对输入",
  missingAck: "缺真实输入 ack run_id",
  missingCompleted: "缺同一 bounded run 的完成结果",
  completedTurn: "first",
  requireRunMode: "bounded",
});

function wf(joinRef, requestRef, event, body, direction = "received", at = F_T0) {
  return { direction, at, frame: [joinRef, requestRef, F_TOPIC, event, body] };
}

function boundedTranscript(runId = F_RUN, calls = ["pcall-1", "prun-1", "call-1", "pcall-2", "prun-2", "call-2"]) {
  const [pcall1, prun1, call1, pcall2, prun2, call2] = calls;
  return {
    version: "authoring-transcript/v1",
    transcript: {
      run: {
        run_id: runId,
        workspace_id: F_WORKSPACE,
        work_id: F_WORK,
        session_id: F_SESSION,
        parent_turn_ref: F_PARENT,
        profile_ref: "judgment_loop_v1",
      },
      system: { identity_ref: "identity:authoring/v1" },
      messages: [
        { role: "user", provenance: "author", blocks: [{ type: "text", text: F_MESSAGE }] },
        {
          role: "assistant",
          provenance: "model",
          provider_call_ref: pcall1,
          provider_run_ref: prun1,
          blocks: [{ type: "tool_call", call_id: call1, name: "search", arguments: {} }],
        },
        { role: "tool", blocks: [{ type: "observation", call_id: call1, content: { query: "{}" } }] },
        {
          role: "assistant",
          provenance: "model",
          provider_call_ref: pcall2,
          provider_run_ref: prun2,
          blocks: [{ type: "tool_call", call_id: call2, name: "search", arguments: {} }],
        },
        { role: "tool", blocks: [{ type: "observation", call_id: call2, content: { query: "{}" } }] },
      ],
      tools: [{ name: "search" }],
      base_refs: [],
      observation_refs: [],
      used_refs: [],
      projection: { target: "chat_completions" },
      call_ids: [call1, call2],
    },
  };
}

function createFirstConsumerBatch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-first-run-"));
  fs.mkdirSync(path.join(dir, "database"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "native-b71-config.json"),
    JSON.stringify({ target: { work_id: F_WORK, work_title: "灰烬中的手印" } }),
  );
  const db = new DatabaseSync(path.join(dir, "database", "ai_novel_studio_test.sqlite3"));
  try {
    db.exec(
      "CREATE TABLE agent_runs (id TEXT PRIMARY KEY, workspace_id TEXT, work_id TEXT, session_id TEXT, " +
        "parent_turn_ref TEXT, long_run_task_ref TEXT, run_mode TEXT, status TEXT, plan_version INTEGER, " +
        "consumed_budget TEXT, pending_artifact_refs TEXT, authoring_transcript TEXT)",
    );
    db.exec(
      "CREATE TABLE provider_runs (id TEXT PRIMARY KEY, provider_call_ref TEXT, agent_run_id TEXT, " +
        "workspace_id TEXT, work_id TEXT, session_id TEXT, parent_turn_ref TEXT, status TEXT)",
    );
    const insertRun = db.prepare(
      "INSERT INTO agent_runs (id, workspace_id, work_id, session_id, parent_turn_ref, long_run_task_ref, " +
        "run_mode, status, plan_version, consumed_budget, pending_artifact_refs, authoring_transcript) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertProvider = db.prepare(
      "INSERT INTO provider_runs (id, provider_call_ref, agent_run_id, workspace_id, work_id, session_id, parent_turn_ref, status) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insertRun.run(
      F_RUN, F_WORKSPACE, F_WORK, F_SESSION, F_PARENT, null, "bounded", "completed", 1,
      JSON.stringify({ provider_calls: 2 }), JSON.stringify([]),
      JSON.stringify(boundedTranscript()),
    );
    insertRun.run(
      F_DECOY, F_WORKSPACE, F_WORK, F_SESSION, F_PARENT, null, "bounded", "completed", 1,
      JSON.stringify({ provider_calls: 1 }), JSON.stringify([]),
      JSON.stringify(boundedTranscript(F_DECOY, ["pcall-9", "prun-9", "call-9", "pcall-9", "prun-9", "call-9"])),
    );
    for (const [n, run] of [[1, F_RUN], [2, F_RUN], [9, F_DECOY]]) {
      insertProvider.run(`prun-${n}`, `pcall-${n}`, run, F_WORKSPACE, F_WORK, F_SESSION, F_PARENT, "completed");
    }
  } finally {
    db.close();
  }
  const join = wf("join-3", "join-3", "phx_join", { work_id: F_WORK, session_id: F_SESSION }, "sent", F_T0);
  const joinReply = wf("join-3", "join-3", "phx_reply", {
    status: "ok",
    response: { joined: true, work_id: F_WORK, session_id: F_SESSION },
  }, "received", F_T1);
  const sent = wf("join-3", "request-4", "user_message", {
    text: F_MESSAGE,
    turn_id: F_PARENT,
    work_id: F_WORK,
    session_id: F_SESSION,
  }, "sent", F_T2);
  const ack = wf("join-3", "request-4", "phx_reply", {
    status: "ok",
    response: { turn_id: F_PARENT, run_id: F_RUN, run_mode: "bounded" },
  }, "received", F_T3);
  const result = wf("join-3", "request-4", "turn_result", {
    turn_id: F_PARENT,
    agent_run: { run_id: F_RUN, status: "completed", run_mode: "bounded" },
    adoption_state: { pending: [] },
  }, "received", F_T4);
  const unrelatedResult = wf("join-3", "request-4", "turn_result", {
    turn_id: "turn-other",
  }, "received", F_T4);
  const wire = [join, joinReply, sent, ack, result, unrelatedResult];
  const exchange = (n, turnId = `${F_PARENT}:agent:${n}`) => ({
    provider: "slice_verify",
    request_format: "authoring-request-ir/v1",
    response_format: "fixture_provider_result/v1",
    provider_call_ref: `pcall-${n}`,
    provider_run_ref: `prun-${n}`,
    work_id: F_WORK,
    session_id: F_SESSION,
    turn_id: turnId,
    request_body: irBodyFromWire({ messages: [{ role: "user", content: F_MESSAGE }] }),
    response: {
      status: "ok",
      body: { content: "", tool_calls: [{ id: `call-${n}`, name: "search", arguments: {} }] },
    },
  });
  const llmRecords = [exchange(1), exchange(2), exchange(9)];
  return { dir, wire, sent, ack, result, llmRecords, evidence: { wire, userMessages: [sent], llmRecords } };
}

function withFirstConsumerBatch(run) {
  const batch = createFirstConsumerBatch();
  try {
    return run(batch);
  } finally {
    fs.rmSync(batch.dir, { recursive: true, force: true });
  }
}

test("first-consumer 用真实 ACK 的 bounded run_id 读取私有历史并只消费该 run 的 pcall 记录", () => {
  withFirstConsumerBatch(({ dir, evidence, ack }) => {
    const facts = authoringRunFacts(dir, evidence, F_FIRST_SPEC);
    assert.equal(facts.facts.ack, ack);
    assert.equal(facts.runId, F_RUN);
    assert.equal(facts.history.mode, "bounded");
    assert.equal(facts.history.record.id, F_RUN);
    assert.equal(facts.history.record.workspace_id, F_WORKSPACE);
    assert.equal(facts.completed.agent_run.run_id, F_RUN);
    assert.equal(facts.allResults.length, 2);
    assert.equal(facts.results.length, 1);
    assert.equal(facts.results[0].agent_run.run_id, F_RUN);
    assert.deepEqual(facts.calls.measured.provider_run_refs, ["prun-1", "prun-2"]);
    assert.deepEqual(Object.values(facts.calls.checks), [true, true, true, true, true]);
    // 记录的真实 turn_id 是 :agent: step，不是 parent 文本；pcall 绑定仍纳入请求规则。
    assert.deepEqual(requestBodies(facts.calls.records, F_PARENT), []);
    assert.equal(requestBodiesOf(facts.calls.records).length, 2);
  });
});

test("同 parent 的另一 bounded run 记录不会进入首消费者证据", () => {
  withFirstConsumerBatch(({ dir, evidence }) => {
    const facts = authoringRunFacts(dir, evidence, F_FIRST_SPEC);
    assert.ok(!facts.calls.measured.provider_run_refs.includes("prun-9"));
    assert.ok(!facts.calls.records.some((record) => record.provider_run_ref === "prun-9"));
    assert.ok(!facts.calls.failures.some((failure) => failure.refs?.provider_run_ref === "prun-9"));
  });
});

test("run 私有预算缺失时 counts 检查显式失败而不抛异常", () => {
  const batch = createFirstConsumerBatch();
  try {
    const db = new DatabaseSync(path.join(batch.dir, "database", "ai_novel_studio_test.sqlite3"));
    try {
      db.prepare("UPDATE agent_runs SET consumed_budget = NULL WHERE id = ?").run(F_RUN);
    } finally {
      db.close();
    }
    const facts = authoringRunFacts(batch.dir, batch.evidence, F_FIRST_SPEC);
    assert.equal(facts.history.budget, null);
    assert.equal(facts.calls.checks.native_call_counts_match_consumed, false);
    assert.ok(facts.calls.failures.some((failure) => failure.phase === "counts"));
  } finally {
    fs.rmSync(batch.dir, { recursive: true, force: true });
  }
});

test("缺失或错绑 pcall 时首消费者显式失败，不按 parent 猜记录", () => {
  for (const mutate of [
    (records) => { records[0].provider_call_ref = "pcall-unknown"; },
    (records) => { delete records[0].provider_call_ref; delete records[0].provider_run_ref; },
    (records) => { records[0].provider_run_ref = "prun-2"; },
  ]) {
    const batch = createFirstConsumerBatch();
    try {
      mutate(batch.llmRecords);
      const facts = authoringRunFacts(batch.dir, batch.evidence, F_FIRST_SPEC);
      assert.equal(facts.calls.checks.native_call_pairs_bound, false);
      assert.ok(facts.calls.failures.some((failure) => failure.phase === "binding"));
    } finally {
      fs.rmSync(batch.dir, { recursive: true, force: true });
    }
  }
});

test("缺少真实 ACK 时不使用 DB 最新 run；durable/未知模式不能冒充首消费者", () => {
  const batch = createFirstConsumerBatch();
  try {
    const noAck = {
      ...batch.evidence,
      wire: batch.wire.filter((record) => record !== batch.ack),
    };
    assert.throws(() => authoringRunFacts(batch.dir, noAck, F_FIRST_SPEC), /缺真实输入 ack run_id/);

    const db = new DatabaseSync(path.join(batch.dir, "database", "ai_novel_studio_test.sqlite3"));
    try {
      db.prepare("UPDATE agent_runs SET run_mode = ? WHERE id = ?").run("durable", F_RUN);
    } finally {
      db.close();
    }
    assert.throws(
      () => authoringRunFacts(batch.dir, batch.evidence, F_FIRST_SPEC),
      /run_mode durable 与场景 bounded 不一致/,
    );
  } finally {
    fs.rmSync(batch.dir, { recursive: true, force: true });
  }
});

test("bounded 记录不能冒充要求 durable 的消费者", () => {
  withFirstConsumerBatch(({ dir, evidence }) => {
    assert.throws(
      () => authoringRunFacts(dir, evidence, { ...F_FIRST_SPEC, requireRunMode: "durable" }),
      /run_mode bounded 与场景 durable 不一致/,
    );
  });
});

// ── 共享请求/广播证据边界：ACK 生命周期与同 topic 广播 ─────────────────────────

test("ACK 必须绑定作者消息自己的 join_ref/request_ref/topic，跨生命周期不确认", () => {
  withFirstConsumerBatch(({ dir, evidence, ack }) => {
    const patches = [
      (wrong) => { wrong.frame[0] = "foreign-join"; },
      (wrong) => { wrong.frame[1] = "request-foreign"; },
      (wrong) => { wrong.frame[2] = "workspace:foreign"; },
    ];
    for (const patch of patches) {
      const wrong = structuredClone(ack);
      patch(wrong);
      const bad = { ...evidence, wire: evidence.wire.map((record) => (record === ack ? wrong : record)) };
      assert.throws(() => authoringRunFacts(dir, bad, F_FIRST_SPEC), /缺真实输入 ack run_id/);
    }
  });
});

test("同一请求出现多个 ACK（冲突或重复）都失败，不任选第一个", () => {
  withFirstConsumerBatch(({ dir, evidence, ack }) => {
    const conflicting = structuredClone(ack);
    conflicting.frame[4].response.run_id = F_DECOY;
    const duplicate = structuredClone(ack);
    for (const extra of [conflicting, duplicate]) {
      const bad = { ...evidence, wire: [...evidence.wire, extra] };
      assert.throws(() => authoringRunFacts(dir, bad, F_FIRST_SPEC), /ACK 多义/);
    }
  });
});

test("完成结果必须来自作者消息同一 topic，跨 topic 广播不算完成", () => {
  withFirstConsumerBatch(({ dir, evidence, result }) => {
    const wrong = structuredClone(result);
    wrong.frame[2] = "workspace:foreign";
    const bad = { ...evidence, wire: evidence.wire.map((record) => (record === result ? wrong : record)) };
    assert.throws(
      () => authoringRunFacts(dir, bad, F_FIRST_SPEC),
      /缺同一 bounded run 的完成结果/,
    );
  });
});

test("真实广播帧 join_ref/request_ref 为 null 时仍按 topic/方向/实际 run 绑定", () => {
  withFirstConsumerBatch(({ dir, evidence }) => {
    const wire = evidence.wire.map((record) => {
      const clone = structuredClone(record);
      if (clone.frame[3] === "turn_result") {
        clone.frame[0] = null;
        clone.frame[1] = null;
      }
      return clone;
    });
    wire.push({
      direction: "received",
      at: F_T4,
      frame: [null, null, F_TOPIC, "agent_event", {
        event_type: "exploration_observed",
        run_ref: F_RUN,
        run_id: F_RUN,
        payload: { query: "q-null-join" },
      }],
    });
    const facts = authoringRunFacts(dir, { ...evidence, wire }, F_FIRST_SPEC);
    assert.equal(facts.completed.agent_run.run_id, F_RUN);
    assert.equal(facts.scope.topic, F_TOPIC);
    assert.equal(facts.scope.run_id, F_RUN);
    const exploration = explorationFacts(wire, {
      topic: facts.scope.topic,
      runId: facts.scope.run_id,
    });
    assert.equal(exploration.count, 1);
    assert.deepEqual(exploration.queries, ["q-null-join"]);
  });
});

test("同 parent 其它 run、跨 topic/方向/错 run_ref 的探索事件不计入 owning scope", () => {
  const event = (body, { direction = "received", topic = F_TOPIC } = {}) => ({
    direction,
    at: F_T4,
    frame: [null, null, topic, "agent_event", body],
  });
  const own = (query) => event({
    event_type: "exploration_observed",
    run_ref: F_RUN,
    run_id: F_RUN,
    payload: { query },
  });
  const wire = [
    own("q-1"),
    event({
      event_type: "exploration_observed",
      run_ref: F_DECOY,
      run_id: F_DECOY,
      payload: { query: "q-decoy" },
    }),
    own("q-2"),
    event({
      event_type: "exploration_observed",
      run_ref: F_RUN,
      run_id: F_RUN,
      payload: { query: "q-foreign-topic" },
    }, { topic: "workspace:foreign" }),
    event({
      event_type: "exploration_observed",
      run_ref: F_RUN,
      run_id: F_RUN,
      payload: { query: "q-sent" },
    }, { direction: "sent" }),
    event({
      event_type: "exploration_observed",
      run_ref: F_RUN,
      run_id: F_DECOY,
      payload: { query: "q-mismatch" },
    }),
    event({
      event_type: "exploration_observed",
      run_id: F_RUN,
      payload: { query: "q-no-run-ref" },
    }),
    event({
      event_type: "other",
      run_ref: F_RUN,
      run_id: F_RUN,
      payload: { query: "q-other" },
    }),
    event(null),
  ];
  const facts = explorationFacts(wire, { topic: F_TOPIC, runId: F_RUN });
  assert.equal(facts.count, 2);
  assert.deepEqual(facts.queries, ["q-1", "q-2"]);
  assert.throws(
    () => explorationFacts(wire, { topic: "", runId: F_RUN }),
    /探索证据缺 owning topic/,
  );
  assert.throws(
    () => explorationFacts(wire, { topic: F_TOPIC, runId: "" }),
    /探索证据缺 owning run/,
  );
});

test("探索事实必须显式提供合法 owning scope，空批与无 run 旧 shape 也关闭", () => {
  const tagged = [
    frame("agent_event", {
      event_type: "exploration_observed",
      run_ref: "run-1",
      run_id: "run-1",
      payload: { query: "q-1" },
    }),
  ];
  const legacy = frame("agent_event", {
    event_type: "exploration_observed",
    payload: { query: "q-legacy" },
  });
  assert.throws(() => explorationFacts(tagged), /探索证据缺 owning scope/);
  // 无 run 身份的历史合成形状不能借空 scope 返回假可用事实。
  assert.throws(() => explorationFacts([legacy]), /探索证据缺 owning scope/);
  assert.throws(() => explorationFacts([]), /探索证据缺 owning scope/);
  assert.throws(() => explorationFacts([legacy], null), /探索证据缺 owning scope/);
  assert.throws(() => explorationFacts([legacy], undefined), /探索证据缺 owning scope/);
  assert.throws(() => explorationFacts([legacy], "room:test"), /探索证据缺 owning scope/);
  // 显式 scope 下空批合法；缺 run 身份的事件不能贡献事实。
  assert.equal(explorationFacts([], { topic: "room:test", runId: "run-1" }).count, 0);
  assert.equal(explorationFacts([legacy], { topic: "room:test", runId: "run-1" }).count, 0);
});
