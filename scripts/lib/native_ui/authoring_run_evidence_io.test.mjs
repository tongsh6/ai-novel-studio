// B71 first-consumer run 证据邻接 IO：真实 transport/checkpoint 文件落盘、4 表
// SQLite 历史读取与 ACK/完成结果绑定。模板由 `fixtures/authoring_run_io_fixture.mjs`
// 在 run 内物化一次；需要改 DB 的反例取 `withWorkingCopy` 副本。纯帧/transcript/
// llm 事实在 `authoring_run_scenarios.mjs`，纯测试不建目录/DB。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  authoringRunFacts,
  collectAuthoringRun,
  explorationFacts,
  finishVerification,
  readCheckpoint,
  verificationExtra,
} from "./authoring_run_evidence.mjs";
import { requestBodies, requestBodiesOf } from "./authoring_scenario_evidence.mjs";
import { materializeFixture, openTestRunScope, withWorkingCopy } from "../test_env.mjs";
import {
  F_DECOY,
  F_FIRST_SPEC,
  F_RUN,
  F_TOPIC,
  F_T4,
  F_WORKSPACE,
  firstConsumerEvidence,
  frame,
} from "./fixtures/authoring_run_scenarios.mjs";
import { FIRST_CONSUMER_DB_REL, firstConsumerFixtureSpec } from "./fixtures/authoring_run_io_fixture.mjs";

let runScope;

test.before(() => {
  runScope = openTestRunScope();
});

test.after(() => {
  runScope?.close();
});

function fixture() {
  return materializeFixture(firstConsumerFixtureSpec(), { scope: runScope });
}

function tempDir(tag) {
  return fs.mkdtempSync(path.join(runScope.workDir, tag));
}

test("检查项未全通过时在落盘前失败，通过后按既有名称写 checks/summary", () => {
  const dir = tempDir("b71-run-evidence-");
  try {
    fs.writeFileSync(
      path.join(dir, "native-transport.jsonl"),
      `${JSON.stringify(frame("agent_event", { event_type: "tool_call", payload: {} }))}\n`,
    );
    assert.throws(
      () =>
        finishVerification(dir, {
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
  const dir = tempDir("b71-checkpoint-");
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
  const dir = tempDir("b71-collect-");
  try {
    assert.throws(
      () =>
        collectAuthoringRun(dir, {
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

test("first-consumer 用真实 ACK 的 bounded run_id 读取私有历史并只消费该 run 的 pcall 记录", () => {
  const template = fixture();
  const { evidence, ack } = firstConsumerEvidence();
  const facts = authoringRunFacts(template.dir, evidence, F_FIRST_SPEC);
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
  assert.deepEqual(requestBodies(facts.calls.records, "message-first"), []);
  assert.equal(requestBodiesOf(facts.calls.records).length, 2);
});

test("同 parent 的另一 bounded run 记录不会进入首消费者证据", () => {
  const template = fixture();
  const { evidence } = firstConsumerEvidence();
  const facts = authoringRunFacts(template.dir, evidence, F_FIRST_SPEC);
  assert.ok(!facts.calls.measured.provider_run_refs.includes("prun-9"));
  assert.ok(!facts.calls.records.some((record) => record.provider_run_ref === "prun-9"));
  assert.ok(!facts.calls.failures.some((failure) => failure.refs?.provider_run_ref === "prun-9"));
});

test("run 私有预算缺失时 counts 检查显式失败而不抛异常", () => {
  const template = fixture();
  const { evidence } = firstConsumerEvidence();
  withWorkingCopy(template, (copy) => {
    const db = new DatabaseSync(copy.files.get(FIRST_CONSUMER_DB_REL));
    try {
      db.prepare("UPDATE agent_runs SET consumed_budget = NULL WHERE id = ?").run(F_RUN);
    } finally {
      db.close();
    }
    const facts = authoringRunFacts(copy.dir, evidence, F_FIRST_SPEC);
    assert.equal(facts.history.budget, null);
    assert.equal(facts.calls.checks.native_call_counts_match_consumed, false);
    assert.ok(facts.calls.failures.some((failure) => failure.phase === "counts"));
  });
});

test("缺失或错绑 pcall 时首消费者显式失败，不按 parent 猜记录", () => {
  const template = fixture();
  for (const mutate of [
    (records) => {
      records[0].provider_call_ref = "pcall-unknown";
    },
    (records) => {
      delete records[0].provider_call_ref;
      delete records[0].provider_run_ref;
    },
    (records) => {
      records[0].provider_run_ref = "prun-2";
    },
  ]) {
    const { evidence } = firstConsumerEvidence();
    mutate(evidence.llmRecords);
    const facts = authoringRunFacts(template.dir, evidence, F_FIRST_SPEC);
    assert.equal(facts.calls.checks.native_call_pairs_bound, false);
    assert.ok(facts.calls.failures.some((failure) => failure.phase === "binding"));
  }
});

test("缺少真实 ACK 时不使用 DB 最新 run；durable/未知模式不能冒充首消费者", () => {
  const template = fixture();
  const { evidence, ack } = firstConsumerEvidence();
  const noAck = { ...evidence, wire: evidence.wire.filter((record) => record !== ack) };
  assert.throws(() => authoringRunFacts(template.dir, noAck, F_FIRST_SPEC), /缺真实输入 ack run_id/);

  withWorkingCopy(template, (copy) => {
    const db = new DatabaseSync(copy.files.get(FIRST_CONSUMER_DB_REL));
    try {
      db.prepare("UPDATE agent_runs SET run_mode = ? WHERE id = ?").run("durable", F_RUN);
    } finally {
      db.close();
    }
    assert.throws(
      () => authoringRunFacts(copy.dir, evidence, F_FIRST_SPEC),
      /run_mode durable 与场景 bounded 不一致/,
    );
  });
});

test("bounded 记录不能冒充要求 durable 的消费者", () => {
  const template = fixture();
  const { evidence } = firstConsumerEvidence();
  assert.throws(
    () => authoringRunFacts(template.dir, evidence, { ...F_FIRST_SPEC, requireRunMode: "durable" }),
    /run_mode bounded 与场景 durable 不一致/,
  );
});

test("ACK 必须绑定作者消息自己的 join_ref/request_ref/topic，跨生命周期不确认", () => {
  const template = fixture();
  const { evidence, ack } = firstConsumerEvidence();
  const patches = [
    (wrong) => {
      wrong.frame[0] = "foreign-join";
    },
    (wrong) => {
      wrong.frame[1] = "request-foreign";
    },
    (wrong) => {
      wrong.frame[2] = "workspace:foreign";
    },
  ];
  for (const patch of patches) {
    const wrong = structuredClone(ack);
    patch(wrong);
    const bad = { ...evidence, wire: evidence.wire.map((record) => (record === ack ? wrong : record)) };
    assert.throws(() => authoringRunFacts(template.dir, bad, F_FIRST_SPEC), /缺真实输入 ack run_id/);
  }
});

test("同一请求出现多个 ACK（冲突或重复）都失败，不任选第一个", () => {
  const template = fixture();
  const { evidence, ack } = firstConsumerEvidence();
  const conflicting = structuredClone(ack);
  conflicting.frame[4].response.run_id = F_DECOY;
  const duplicate = structuredClone(ack);
  for (const extra of [conflicting, duplicate]) {
    const bad = { ...evidence, wire: [...evidence.wire, extra] };
    assert.throws(() => authoringRunFacts(template.dir, bad, F_FIRST_SPEC), /ACK 多义/);
  }
});

test("完成结果必须来自作者消息同一 topic，跨 topic 广播不算完成", () => {
  const template = fixture();
  const { evidence, result } = firstConsumerEvidence();
  const wrong = structuredClone(result);
  wrong.frame[2] = "workspace:foreign";
  const bad = { ...evidence, wire: evidence.wire.map((record) => (record === result ? wrong : record)) };
  assert.throws(() => authoringRunFacts(template.dir, bad, F_FIRST_SPEC), /缺同一 bounded run 的完成结果/);
});

test("真实广播帧 join_ref/request_ref 为 null 时仍按 topic/方向/实际 run 绑定", () => {
  const template = fixture();
  const { evidence } = firstConsumerEvidence();
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
    frame: [
      null,
      null,
      F_TOPIC,
      "agent_event",
      {
        event_type: "exploration_observed",
        run_ref: F_RUN,
        run_id: F_RUN,
        payload: { query: "q-null-join" },
      },
    ],
  });
  const facts = authoringRunFacts(template.dir, { ...evidence, wire }, F_FIRST_SPEC);
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
