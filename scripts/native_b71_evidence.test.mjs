import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  createWorkingCopy,
  materializeFixture,
  openTestRunScope,
} from "./lib/test_env.mjs";
import { main, nativeStageHistoryPreserved, planningCanonSnapshot, continuationRequestChecks, characterRequestChecks } from "./native_b71_evidence.mjs";
import { joinNativeCallEvidence } from "./lib/native_ui/authoring_call_evidence.mjs";
import {
  CANON_TABLES,
  buildAuthoringCanonSnapshot,
} from "./lib/native_ui/authoring_canon_evidence.mjs";
import { planningProtocolEvidence, providerFreeInterval } from "./lib/native_ui/authoring_planning_evidence.mjs";
import { evaluateAnswerMode } from "./lib/native_ui/authoring_answer_mode_evidence.mjs";
import { irBodyFromWire } from "./lib/native_ui/fixtures/authoring_request_ir.mjs";
import {
  PREVIEW_CALL,
  PREVIEW_DELTAS,
  PREVIEW_PROSE,
  PREVIEW_PROVIDER_RUN,
  PREVIEW_RUN,
  PREVIEW_TOPIC,
  PREVIEW_TRANSPORT,
  PREVIEW_TEXT,
  previewText,
  streamPreviewRecords,
} from "./lib/native_ui/fixtures/native_b71_stream_preview_facts.mjs";
import { streamPreviewFixtureSpec } from "./lib/native_ui/fixtures/native_b71_stream_preview_io_fixture.mjs";

let runScope;

test.before(() => {
  runScope = openTestRunScope();
});

test.after(() => {
  runScope?.close();
});

const history = [
  ["judge", "judgment_decision"],
  ["continue-1", "continuation_decision"],
  ["continue-2", "continuation_decision"],
  ["writer", "submit_tentative_artifact"],
];
const canonical = (calls) => calls.map(([call_id, name]) => ({
  role: "assistant", blocks: [{ type: "tool_call", call_id, name }],
}));
const wire = (calls) => calls.map(([id, name]) => ({
  role: "assistant", tool_calls: [{ id, function: { name } }],
}));
const quality = ["quality", "report_quality_findings"];

test("多次真实续行完整留存时通过，不要求固定次数", () => {
  assert.equal(nativeStageHistoryPreserved(canonical([...history, quality]), wire(history)), true);
});

test("丢失、交换或伪造任何前序调用都不能通过", () => {
  for (const changed of [
    history.slice(1),
    history.filter(([id]) => id !== "continue-1"),
    [history[0], history[2], history[1], history[3]],
    [...history.slice(0, 3), ["invented-writer", "submit_tentative_artifact"]],
  ]) {
    assert.equal(nativeStageHistoryPreserved(canonical([...changed, quality]), wire(history)), false);
  }
});

test("缺少最终质量调用或把工具阶段顺序颠倒时拒绝", () => {
  assert.equal(nativeStageHistoryPreserved(canonical(history), wire(history)), false);
  assert.equal(nativeStageHistoryPreserved(canonical([...history, ["other", "judgment_decision"]]), wire(history)), false);
  const reversed = [history[3], ...history.slice(0, 3)];
  assert.equal(nativeStageHistoryPreserved(canonical([...reversed, quality]), wire(reversed)), false);
});

// 以下固定夹具表达真实单槽请求顺序；负例只改一项已观察事实。

function planningFixture() {
  const names = ["judgment_decision", "agent_plan_draft", "agent_plan_revision", "submit_tentative_artifact", "submit_tentative_artifact"];
  const messages = [{ role: "user", blocks: [{ type: "text", text: "设计角色和相关世界设定" }] }];
  const projected = [{ role: "user", content: "设计角色和相关世界设定" }];
  const bodies = [];
  for (const [index, name] of names.entries()) {
    const id = `call-${index}`;
    bodies.push(structuredClone({
      messages: projected,
      tools: [{ type: "function", function: { name } }],
      tool_choice: index === 0 || index < 3 ? "auto" : { type: "function", function: { name } },
    }));
    messages.push({ role: "assistant", blocks: [{ type: "tool_call", name, call_id: id, arguments: {} }] });
    const result = { type: "validation_result", call_id: id, status: "passed", reason_code: index < 3 ? "agent_plan_validated" : "tentative_artifact_validated", detail: { execution_authorized: false, canon_written: false } };
    messages.push({ role: "tool", blocks: [result] });
    projected.push({ role: "assistant", content: "", tool_calls: [{ id, function: { name, arguments: "{}" } }] });
    projected.push({ role: "tool", tool_call_id: id, content: JSON.stringify(result) });
  }
  return { bodies, messages, planVersion: 2, replans: 1, providerCalls: 5 };
}

test("计划→重规划→两个独立创作请求保持历史并逐call闭合", () => {
  const { checks } = planningProtocolEvidence(planningFixture());
  assert.equal(checks.planning_stage_order, true);
  assert.equal(checks.planning_request_prefix, true);
  assert.equal(checks.planning_stage_tools, true);
  assert.equal(checks.canonical_history_matches_requests, true);
  assert.equal(checks.canonical_exchanges_closed, true);
  assert.equal(checks.plan_revision_committed_once, true);
  assert.equal(checks.provider_budget_matches_requests, true);
});

test("新请求删除或改写任何前序消息必须失败", () => {
  for (const mutate of [
    (fixture) => fixture.bodies[3].messages.splice(1, 1),
    (fixture) => { fixture.bodies[3].messages[0].content = "被改写的作者输入"; },
  ]) {
    const fixture = planningFixture(); mutate(fixture);
    assert.equal(planningProtocolEvidence(fixture).checks.planning_request_prefix, false);
  }
});

test("阶段倒序、开放历史工具或错绑tool_choice必须失败", () => {
  const reordered = planningFixture();
  [reordered.bodies[1], reordered.bodies[2]] = [reordered.bodies[2], reordered.bodies[1]];
  assert.equal(planningProtocolEvidence(reordered).checks.planning_stage_order, false);
  for (const mutate of [
    (fixture) => fixture.bodies[3].tools.push({ function: { name: "agent_plan_draft" } }),
    (fixture) => { fixture.bodies[4].tool_choice.function.name = "agent_plan_revision"; },
  ]) {
    const fixture = planningFixture(); mutate(fixture);
    assert.equal(planningProtocolEvidence(fixture).checks.planning_stage_tools, false);
  }
});

test("缺失、重复、错绑或跨scope的原生结果不能冒充已闭合", () => {
  for (const mutate of [
    (fixture) => fixture.messages.pop(),
    (fixture) => fixture.messages.push(structuredClone(fixture.messages.at(-1))),
    (fixture) => { fixture.messages.at(-1).blocks[0].call_id = "unknown-call"; },
    (fixture) => fixture.messages.splice(2, 0, { role: "scope_update", blocks: [{ type: "text", text: "过早切阶段" }] }),
    (fixture) => { fixture.messages.at(-1).blocks[0].status = "failed"; },
  ]) {
    const fixture = planningFixture(); mutate(fixture);
    assert.equal(planningProtocolEvidence(fixture).checks.canonical_exchanges_closed, false);
  }
});

test("durable不能丢失、重排或虚构实际请求中的call_id", () => {
  for (const mutate of [
    (fixture) => { fixture.messages[1].blocks[0].call_id = "invented"; },
    (fixture) => fixture.messages.splice(1, 2),
    (fixture) => { fixture.messages[3].blocks[0].name = "agent_plan_revision"; },
  ]) {
    const fixture = planningFixture(); mutate(fixture);
    assert.equal(planningProtocolEvidence(fixture).checks.canonical_history_matches_requests, false);
  }
});

test("版本、重规划预算、实际调用数不得以默认值或空证据代签", () => {
  for (const patch of [{ planVersion: 1 }, { replans: 0 }, { replans: 2 }]) {
    assert.equal(planningProtocolEvidence({ ...planningFixture(), ...patch }).checks.plan_revision_committed_once, false);
  }
  assert.equal(planningProtocolEvidence({ ...planningFixture(), providerCalls: 4 }).checks.provider_budget_matches_requests, false);
  const empty = planningProtocolEvidence({ bodies: [], messages: [], planVersion: 2, replans: 1, providerCalls: 0 });
  assert.equal(empty.checks.planning_stage_order, false);
  assert.equal(empty.checks.canonical_exchanges_closed, false);
});


test("计划校验不能被改成执行批准或canon写入证明", () => {
  const fixture = planningFixture();
  assert.equal(planningProtocolEvidence(fixture).checks.plan_validation_does_not_authorize_execution, true);
  fixture.messages[4].blocks[0].detail.execution_authorized = true;
  assert.equal(planningProtocolEvidence(fixture).checks.plan_validation_does_not_authorize_execution, false);
});

test("Why 观察窗按发生时间拒绝新Provider调用，未知时间也不能签PASS", () => {
  const before = "2026-11-01T08:00:00.000Z";
  const during = "2026-11-01T08:00:02.000Z";
  const interval = {
    appRecords: [{ event: "provider_gateway.complete.start", timestamp: before }],
    llmRecords: [{ ts: before }],
    start: "2026-11-01T08:00:01.000Z", end: "2026-11-01T08:00:03.000Z",
  };
  assert.equal(providerFreeInterval(interval), true);
  assert.equal(providerFreeInterval({ ...interval, llmRecords: [{ ts: during }] }), false);
  assert.equal(providerFreeInterval({ ...interval, appRecords: [{ event: "provider_gateway.complete.start", timestamp: during }] }), false);
  assert.equal(providerFreeInterval({ ...interval, llmRecords: [{}] }), false);
  assert.equal(providerFreeInterval({ ...interval, appRecords: [] }), false);
  assert.equal(providerFreeInterval({ ...interval, end: before }), false);
});

test("空调用号、重复模型调用、空结果块和非结果块均不能闭合", () => {
  const mutations = [
    (fixture) => { fixture.messages[1].blocks[0].call_id = ""; fixture.messages[2].blocks[0].call_id = ""; },
    (fixture) => fixture.messages.push(structuredClone(fixture.messages[1])),
    (fixture) => fixture.messages.splice(2, 0, { role: "tool", blocks: [] }),
    (fixture) => fixture.messages.splice(2, 0, { role: "tool", blocks: [{ type: "text", text: "伪装结果" }] }),
  ];
  for (const mutate of mutations) {
    const fixture = planningFixture(); mutate(fixture);
    assert.equal(planningProtocolEvidence(fixture).checks.canonical_exchanges_closed, false);
  }
});

test("同样长的重复请求不是严格追加，缺失选择与校验权限字段也不能代签", () => {
  const repeated = planningFixture();
  repeated.bodies[3].messages = structuredClone(repeated.bodies[2].messages);
  assert.equal(planningProtocolEvidence(repeated).checks.planning_request_prefix, false);
  for (const choice of [undefined, { type: "other" }]) {
    const fixture = planningFixture(); fixture.bodies[3].tool_choice = choice;
    assert.equal(planningProtocolEvidence(fixture).checks.planning_stage_tools, false);
  }
  const missing = planningFixture(); delete missing.messages[4].blocks[0].detail;
  assert.equal(planningProtocolEvidence(missing).checks.plan_validation_does_not_authorize_execution, false);
});

test("原生通用工具形状可读，但显式空名称不能被备用名称掩盖", () => {
  const fixture = planningFixture();
  for (const body of fixture.bodies) {
    body.tools = body.tools.map((tool) => ({ name: tool.function.name }));
    for (const message of body.messages) {
      if (message.tool_calls) message.tool_calls = message.tool_calls.map((call) => ({ id: call.id, name: call.function.name }));
    }
  }
  assert.equal(planningProtocolEvidence(fixture).checks.planning_stage_tools, true);
  assert.equal(planningProtocolEvidence(fixture).checks.canonical_history_matches_requests, true);
  fixture.bodies[1].tools[0].function = { name: "" };
  assert.equal(planningProtocolEvidence(fixture).checks.planning_stage_tools, false);
  fixture.bodies[2].messages[1].tool_calls[0].function = { name: "" };
  assert.equal(planningProtocolEvidence(fixture).checks.canonical_history_matches_requests, false);
});

test("Why边界时刻发生调用仍算新增；未知时间边界不得忽略", () => {
  const interval = {
    appRecords: [{ event: "provider_gateway.complete.start", timestamp: "2026-11-01T08:00:00.000Z" }],
    llmRecords: [{ ts: "2026-11-01T08:00:00.000Z" }],
    start: "2026-11-01T08:00:01.000Z", end: "2026-11-01T08:00:03.000Z",
  };
  for (const ts of [interval.start, interval.end]) {
    assert.equal(providerFreeInterval({ ...interval, llmRecords: [{ ts }] }), false);
  }
  assert.equal(providerFreeInterval({ ...interval, end: interval.start }), true);
  assert.equal(providerFreeInterval({ ...interval, start: "unknown", end: "2026-10-31T08:00:00.000Z" }), false);
  assert.equal(providerFreeInterval({ ...interval, end: "unknown" }), false);
});

test("首判断请求必须真实开放judgment_decision且选择auto", () => {
  for (const mutate of [
    (fixture) => { fixture.bodies[0].tools = []; },
    (fixture) => { fixture.bodies[0].tools[0].function.name = "reply"; },
    (fixture) => { fixture.bodies[0].tool_choice = "none"; },
    (fixture) => { fixture.bodies[0].tool_choice = { type: "function", function: { name: "judgment_decision" } }; },
  ]) {
    const fixture = planningFixture(); mutate(fixture);
    assert.equal(planningProtocolEvidence(fixture).checks.planning_stage_tools, false);
  }
});

test("原生证据错误类型在入口统一拒绝，不能被空数组fallback吞掉", () => {
  for (const mutate of [
    (fixture) => { fixture.bodies = false; },
    (fixture) => { fixture.messages = {}; },
    (fixture) => { fixture.bodies[0].messages = false; },
    (fixture) => { fixture.bodies[0].tools = false; },
    (fixture) => { fixture.messages[0].blocks = false; },
    (fixture) => { fixture.bodies[1].messages[1].tool_calls = {}; },
    (fixture) => { fixture.bodies[1].tools[0].function = false; },
    (fixture) => { fixture.bodies[1].messages[1].tool_calls[0].id = 1; },
    (fixture) => { fixture.messages[1].blocks[0].name = false; },
    (fixture) => { fixture.messages[2].blocks[0].detail = false; },
    (fixture) => { fixture.messages[1].blocks[0].call_id = 7; },
    (fixture) => { fixture.bodies[3].tool_choice = { type: "function" }; },
  ]) {
    const fixture = planningFixture(); mutate(fixture);
    assert.throws(() => planningProtocolEvidence(fixture), /invalid_planning_evidence/);
  }
});

test("实际wire结果错绑不能用正确的durable结果代签", () => {
  const fixture = planningFixture();
  for (const body of fixture.bodies) {
    for (const message of body.messages) {
      if (message.role === "tool" && message.tool_call_id === "call-0") {
        message.tool_call_id = "foreign-call";
        message.content = JSON.stringify({ ...JSON.parse(message.content), call_id: "foreign-call" });
      }
    }
  }
  assert.equal(planningProtocolEvidence(fixture).checks.canonical_history_matches_requests, false);
});

test("请求内工具调用不能冒充user，工具结果信封与payload必须同call", () => {
  for (const mutate of [
    (message) => { message.role = "user"; },
  ]) {
    const fixture = planningFixture(); mutate(fixture.bodies[1].messages[1]);
    assert.throws(() => planningProtocolEvidence(fixture), /invalid_planning_evidence/);
  }
  const fixture = planningFixture(); fixture.bodies[1].messages[2].tool_call_id = "wrong";
  assert.throws(() => planningProtocolEvidence(fixture), /invalid_planning_evidence/);
});

test("计划阶段只接受auto，writer同时接受bridge字符串与OpenAI具名对象", () => {
  for (const index of [1, 2]) {
    const fixture = planningFixture(); fixture.bodies[index].tool_choice = "none";
    assert.equal(planningProtocolEvidence(fixture).checks.planning_stage_tools, false);
  }
  for (const index of [3, 4]) {
    const fixture = planningFixture(); fixture.bodies[index].tool_choice = "submit_tentative_artifact";
    assert.equal(planningProtocolEvidence(fixture).checks.planning_stage_tools, true);
  }
});

test("writer具名choice仍须精确绑定当前工具，错误名与auto/required/none/missing均拒绝", () => {
  const invalid = [
    "agent_plan_revision", "submit_tentative_artifact_extra", "", "AUTO",
    "auto", "required", "none", null,
    { type: "function", function: { name: "agent_plan_revision" } },
  ];
  for (const choice of invalid) {
    for (const index of [3, 4]) {
      const fixture = planningFixture(); fixture.bodies[index].tool_choice = choice;
      assert.equal(planningProtocolEvidence(fixture).checks.planning_stage_tools, false,
        `writer[${index}] choice=${JSON.stringify(choice)}`);
    }
  }
  for (const index of [3, 4]) {
    const fixture = planningFixture(); delete fixture.bodies[index].tool_choice;
    assert.equal(planningProtocolEvidence(fixture).checks.planning_stage_tools, false);
  }
});

test("实际请求的校验内容必须来自持久原生结果，不只比call_id和status", () => {
  const fixture = planningFixture();
  for (const body of fixture.bodies) {
    for (const message of body.messages) {
      if (message.role === "tool" && message.tool_call_id === "call-1") {
        const payload = JSON.parse(message.content);
        payload.detail.execution_authorized = true;
        message.content = JSON.stringify(payload);
      }
    }
  }
  assert.equal(planningProtocolEvidence(fixture).checks.canonical_history_matches_requests, false);
});

const uuidFromHex = (hex) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
const bytesFromHex = (hex) => Buffer.from(hex, "hex");

test("真实 TEXT 列中的 16-byte UUID 在捕获边界无损投影，旧 JS 解码仍拒绝", () => {
  const dir = fs.mkdtempSync(path.join(runScope.workDir, "b71-canon-capture-"));
  const dbFile = path.join(dir, "database", "ai_novel_studio_test.sqlite3");
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const memory = "11111111-1111-4111-8111-111111111111";
  const work = "22222222-2222-4222-8222-222222222222";
  const memoryHex = memory.replaceAll("-", "");
  const workHex = work.replaceAll("-", "");
  // 真实失败形状：SQLite TEXT 列存 16 原始字节，含非法 UTF-8 与 NUL。
  const rawLogHex = "ff004142434445464748494a4b4c4d4e";
  const rawLogId = uuidFromHex(rawLogHex);
  const legalLogId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const legalTaskId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const blobLogHex = "dddddddddddd4ddd8ddddddddddddddd";
  const blobLogId = uuidFromHex(blobLogHex);
  const blobConversationHex = "eeeeeeeeeeee4eee8eeeeeeeeeeeeeee";
  const columns = "id, memory_id, work_id, task_id, conversation_id, reference_scene, " +
    "reference_reason, inserted_at, future_note, future_blob";
  try {
    const db = new DatabaseSync(dbFile);
    try {
      db.exec("PRAGMA journal_mode = DELETE");
      for (const table of CANON_TABLES) {
        if (table === "memory_items") {
          db.exec(
            "CREATE TABLE memory_items (id TEXT PRIMARY KEY, work_id TEXT, content TEXT, " +
              "reference_count INTEGER, last_referenced_at TEXT, future_column TEXT)",
          );
          db.prepare(
            "INSERT INTO memory_items (id, work_id, content, reference_count, last_referenced_at, future_column) " +
              "VALUES (?, ?, ?, ?, ?, ?)",
          ).run(memory, work, "作者已采纳的章计划", 1, null, "unknown-canon-column");
        } else if (table === "chapters") {
          db.exec(
            "CREATE TABLE chapters (id TEXT PRIMARY KEY, work_id TEXT, volume_id TEXT, title TEXT, " +
              "seq INTEGER, status TEXT, inserted_at TEXT, updated_at TEXT, summary TEXT, plan_direction TEXT)",
          );
          db.prepare(
            "INSERT INTO chapters (id, work_id, title, seq, status, inserted_at, updated_at, summary, plan_direction) " +
              "VALUES (?, ?, ?, 1, 'PLANNED', ?, ?, '', ?)",
          ).run(
            "chapters-row",
            work,
            "第01章",
            "2026-11-01T08:00:00.000000Z",
            "2026-11-01T08:00:00.000000Z",
            JSON.stringify({ chapter_role: "开篇" }),
          );
        } else {
          db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, title TEXT)`);
          db.prepare(`INSERT INTO ${table} (id, title) VALUES (?, ?)`).run(`${table}-row`, table);
        }
      }
      db.exec(
        "CREATE TABLE memory_reference_logs (id TEXT, memory_id TEXT, work_id TEXT, task_id TEXT, " +
          "conversation_id TEXT, reference_scene TEXT, reference_reason TEXT, inserted_at TEXT, " +
          "future_note TEXT, future_blob BLOB)",
      );
      db.prepare(
        `INSERT INTO memory_reference_logs (${columns}) VALUES ` +
          "(CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT), ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        bytesFromHex(rawLogHex),
        bytesFromHex(memoryHex),
        bytesFromHex(workHex),
        null,
        null,
        "dialogue_context",
        "dialogue context recall",
        "2026-11-01 08:00:01.000000",
        "未知原值",
        Buffer.from([1, 2, 255]),
      );
      db.prepare(
        `INSERT INTO memory_reference_logs (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        legalLogId,
        memory,
        work,
        legalTaskId,
        null,
        "dialogue_context",
        "dialogue context recall",
        "2026-11-01 08:00:02.000000",
        "合法文本",
        null,
      );
      db.prepare(
        `INSERT INTO memory_reference_logs (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        bytesFromHex(blobLogHex),
        bytesFromHex(memoryHex),
        bytesFromHex(workHex),
        null,
        bytesFromHex(blobConversationHex),
        "dialogue_context",
        "dialogue context recall",
        "2026-11-01 08:00:03.000000",
        "BLOB行",
        Buffer.from([9, 8, 7]),
      );

      const rawShape = db.prepare(
        "SELECT typeof(id) AS storage, length(CAST(id AS BLOB)) AS byte_length, hex(id) AS hex " +
          "FROM memory_reference_logs WHERE inserted_at = ?",
      ).get("2026-11-01 08:00:01.000000");
      assert.equal(rawShape.storage, "text");
      assert.equal(rawShape.byte_length, 16);
      assert.equal(rawShape.hex, rawLogHex.toUpperCase());
      const rawRows = db.prepare("SELECT * FROM memory_reference_logs ORDER BY inserted_at, id").all();
      assert.notEqual(rawRows[0].id, rawLogId);
      assert.throws(
        () => buildAuthoringCanonSnapshot({
          tables: Object.fromEntries(
            CANON_TABLES.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]),
          ),
          referenceLogs: rawRows,
          at: "2026-11-01T08:00:10.000Z",
        }),
        (error) => error.message ===
          "invalid_authoring_canon_snapshot: memory_reference_logs[0].id must be a UUID",
      );
    } finally {
      db.close();
    }

    const value = planningCanonSnapshot(dir);
    assert.deepEqual(Object.keys(value.tables).sort(), [...CANON_TABLES].sort());
    assert.equal(value.tables.author_action_receipts.row_count, 1);
    assert.equal(value.memory_items[memory].reference_count, 1);
    assert.deepEqual(
      value.memory_reference_logs.map((log) => log.id),
      [rawLogId, legalLogId, blobLogId],
    );
    const logs = new Map(value.memory_reference_logs.map((log) => [log.id, log]));
    const rawLog = logs.get(rawLogId);
    assert.equal(rawLog.memory_id, memory);
    assert.equal(rawLog.work_id, work);
    assert.equal(rawLog.task_id, null);
    assert.equal(rawLog.conversation_id, null);
    assert.equal(rawLog.future_note, "未知原值");
    assert.deepEqual(rawLog.future_blob, { $blob: "0102ff" });
    const legalLog = logs.get(legalLogId);
    assert.equal(legalLog.memory_id, memory);
    assert.equal(legalLog.work_id, work);
    assert.equal(legalLog.task_id, legalTaskId);
    assert.equal(legalLog.conversation_id, null);
    assert.equal(legalLog.future_note, "合法文本");
    assert.equal(legalLog.future_blob, null);
    const blobLog = logs.get(blobLogId);
    assert.equal(blobLog.memory_id, memory);
    assert.equal(blobLog.work_id, work);
    assert.equal(blobLog.task_id, null);
    assert.equal(blobLog.conversation_id, uuidFromHex(blobConversationHex));
    assert.equal(blobLog.future_note, "BLOB行");
    assert.deepEqual(blobLog.future_blob, { $blob: "090807" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── §16.9 三 consumer 使用已绑定请求集合，而不是 parent turn 字符串 ─────────────
const CALL_RUN = "run-call";
const CALL_WORK = "work-call";
const CALL_WORKSPACE = "workspace-call";
const CALL_SESSION = "session-call";
const CALL_PARENT = "turn-call";

const callScope = {
  run_id: CALL_RUN,
  workspace_id: CALL_WORKSPACE,
  work_id: CALL_WORK,
  session_id: CALL_SESSION,
  parent_turn_ref: CALL_PARENT,
};

const callRun = (n) => ({
  id: `prun-${n}`,
  provider_call_ref: `pcall-${n}`,
  agent_run_id: CALL_RUN,
  workspace_id: CALL_WORKSPACE,
  work_id: CALL_WORK,
  session_id: CALL_SESSION,
  parent_turn_ref: CALL_PARENT,
  status: "completed",
});

const wireBody = (messages, names) => ({
  messages,
  tools: names.map((name) => ({ type: "function", function: { name } })),
});
const wireCall = (id, name) => ({ id, function: { name, arguments: "{}" } });
const wireAssistant = (calls) => ({ role: "assistant", tool_calls: calls });
const wireTool = (payload) => ({ role: "tool", tool_call_id: payload.call_id, content: JSON.stringify(payload) });
const passedValidation = (callId, reason) => ({
  type: "validation_result",
  call_id: callId,
  status: "passed",
  reason_code: reason,
  detail: { execution_authorized: false, canon_written: false },
});
const fixtureCall = (id, name) => ({ id, name, arguments: {} });
const canonicalAssistant = (n, blocks) => ({
  role: "assistant",
  provenance: "model",
  provider_call_ref: `pcall-${n}`,
  provider_run_ref: `prun-${n}`,
  blocks,
});
const callExchange = (n, requestBody, calls, turnId = `${CALL_PARENT}:agent:unrelated-${n}`) => ({
  provider: "slice_verify",
  request_format: "authoring-request-ir/v1",
  response_format: "fixture_provider_result/v1",
  provider_call_ref: `pcall-${n}`,
  provider_run_ref: `prun-${n}`,
  work_id: CALL_WORK,
  session_id: CALL_SESSION,
  turn_id: turnId,
  request_body: irBodyFromWire({
    messages: requestBody.messages,
    tools: requestBody.tools,
    tool_choice: requestBody.tool_choice,
    run: callScope,
  }),
  response: { status: "ok", body: { content: "", tool_calls: calls } },
});

test("character consumer 使用 refs 绑定集合：同 parent 外来记录不得替换本 run 阶段", () => {
  const judgmentMessages = [{ role: "user", content: "角色设计" }];
  const judgmentBody = wireBody(judgmentMessages, ["judgment_decision"]);
  const writerMessages = [
    ...judgmentMessages,
    wireAssistant([wireCall("call-character", "judgment_decision")]),
    wireTool(passedValidation("call-character", "judgment_validated")),
  ];
  const writerBody = wireBody(writerMessages, ["submit_tentative_artifact"]);
  const durable = {
    run: callScope,
    messages: [
      canonicalAssistant(1, [{ type: "tool_call", call_id: "call-character", name: "judgment_decision", arguments: {} }]),
      canonicalAssistant(2, [{ type: "tool_call", call_id: "call-writer", name: "submit_tentative_artifact", arguments: {} }]),
      { role: "tool", blocks: [{ type: "validation_result", call_id: "call-writer", status: "passed", reason_code: "tentative_artifact_validated" }] },
    ],
  };
  const foreignBody = wireBody([{ role: "user", content: "外来 run" }], ["submit_tentative_artifact"]);
  const records = [
    callExchange(1, judgmentBody, [fixtureCall("call-character", "judgment_decision")]),
    callExchange(9, foreignBody, [fixtureCall("call-foreign", "submit_tentative_artifact")], CALL_PARENT),
    callExchange(2, writerBody, [fixtureCall("call-writer", "submit_tentative_artifact")]),
  ];
  const joined = joinNativeCallEvidence({
    scope: callScope,
    transcript: durable,
    providerRuns: [callRun(1), callRun(2)],
    records,
    consumedProviderCalls: 2,
  });
  assert.deepEqual(Object.values(joined.checks), [true, true, true, true, true]);
  assert.deepEqual(joined.records.map((record) => record.provider_run_ref), ["prun-1", "prun-2"]);
  const { checks: consumerChecks } = characterRequestChecks(joined.records, durable);
  assert.deepEqual(consumerChecks, {
    judgment_and_writer_keep_strict_prefix: true,
    writer_stage_only_offers_tentative_tool: true,
    durable_checkpoint_keeps_judgment_and_writer: true,
    durable_checkpoint_closes_writer: true,
  });
});

test("continuation consumer 使用 refs 绑定集合：本地记录跨 turn_id 仍参与，外来同 parent 排除", () => {
  const call = (id, name) => ({ id, function: { name, arguments: "{}" } });
  const upstream = [
    { role: "user", content: "续写第01章" },
    wireAssistant([call("call-judgment", "judgment_decision")]),
    wireTool(passedValidation("call-judgment", "judgment_validated")),
    wireAssistant([call("call-plan", "agent_plan_draft")]),
    wireTool(passedValidation("call-plan", "agent_plan_validated")),
    wireAssistant([call("call-mission", "chapter_mission")]),
    wireTool(passedValidation("call-mission", "chapter_mission_validated")),
  ];
  const continuationMessages = upstream;
  const writerMessages = [
    ...upstream,
    wireAssistant([call("call-continuation", "continuation_decision")]),
    wireTool(passedValidation("call-continuation", "continuation_validated")),
  ];
  const qualityMessages = [
    ...writerMessages,
    wireAssistant([call("call-submit", "submit_tentative_artifact")]),
    wireTool(passedValidation("call-submit", "tentative_artifact_validated")),
  ];
  const continuationBody = wireBody(continuationMessages, ["continuation_decision"]);
  const writerBody = wireBody(writerMessages, ["submit_tentative_artifact"]);
  const qualityBody = wireBody(qualityMessages, ["report_quality_findings"]);
  const unbound = (id, name) => ({ role: "assistant", blocks: [{ type: "tool_call", call_id: id, name }] });
  const durable = {
    messages: [
      unbound("call-judgment", "judgment_decision"),
      unbound("call-plan", "agent_plan_draft"),
      unbound("call-mission", "chapter_mission"),
      canonicalAssistant(1, [{ type: "tool_call", call_id: "call-continuation", name: "continuation_decision", arguments: {} }]),
      canonicalAssistant(2, [{ type: "tool_call", call_id: "call-submit", name: "submit_tentative_artifact", arguments: {} }]),
      canonicalAssistant(3, [{ type: "tool_call", call_id: "call-report", name: "report_quality_findings", arguments: {} }]),
      { role: "tool", blocks: [passedValidation("call-submit", "tentative_artifact_validated")] },
      { role: "tool", blocks: [passedValidation("call-report", "quality_findings_validated")] },
    ],
  };
  const foreignBody = wireBody([{ role: "user", content: "外来 run" }], ["report_quality_findings"]);
  const records = [
    callExchange(1, continuationBody, [fixtureCall("call-continuation", "continuation_decision")]),
    callExchange(9, foreignBody, [fixtureCall("call-foreign", "report_quality_findings")], CALL_PARENT),
    callExchange(2, writerBody, [fixtureCall("call-submit", "submit_tentative_artifact")]),
    callExchange(3, qualityBody, [fixtureCall("call-report", "report_quality_findings")]),
  ];
  const joined = joinNativeCallEvidence({
    scope: callScope,
    transcript: durable,
    providerRuns: [callRun(1), callRun(2), callRun(3)],
    records,
    consumedProviderCalls: 3,
  });
  // 旧消息缺执行引用不得补造，也不得被静默忽略：join 明示 missing。
  assert.equal(joined.checks.native_call_pairs_bound, false);
  assert.ok(joined.failures.some(
    (failure) => failure.reason === "missing" && failure.phase === "binding",
  ));
  assert.deepEqual(joined.records.map((record) => record.provider_run_ref), ["prun-1", "prun-2", "prun-3"]);
  const { checks: consumerChecks } = continuationRequestChecks(joined.records, durable);
  assert.deepEqual(Object.values(consumerChecks), Array(Object.keys(consumerChecks).length).fill(true));
});

test("CLI 未知模式、缺批次目录与有效模式分发都在入口显式失败", async () => {
  await assert.rejects(() => main(["unknown-mode", "/tmp/b71"]), /unknown mode: unknown-mode/);
  await assert.rejects(() => main(["verify"]), /usage: node scripts\/native_b71_evidence\.mjs/);
  const dir = fs.mkdtempSync(path.join(runScope.workDir, "b71-cli-"));
  try {
    await assert.rejects(() => main(["verify", dir]), /native-b71-config/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("D2 正反例：回答前基线必须非 null 且 waitRunPauseOrTerminal 后严格增量，resumed 仍必需", () => {
  const evaluate = (afterSteer) =>
    evaluateAnswerMode({
      dbFacts: {
        agent_runs: [],
        agent_events: [],
        provider_runs: [{ id: "prun-1" }, { id: "prun-2" }, { id: "prun-3" }],
        authoring_session_messages: [],
      },
      driverLog: { answer_mode: { multi_turn: { after_steer: afterSteer } } },
      scan: { ok: true, files: [], hits: [] },
      cleanup: { remaining: [] },
      runtime: { app_processes: 0, ports: { backend_4657: false, transport_4661: false }, llm_calls: 0 },
      llmCalls: 0,
    }).checks.D2_run_continued;

  assert.equal(
    evaluate({ index: 1, resumed: true, provider_calls_before: 1, provider_calls_after: 3 }).ok,
    true,
  );
  for (const invalid of [
    { index: 1, resumed: true, provider_calls_before: null, provider_calls_after: 2 },
    { index: 1, resumed: true, provider_calls_before: 2, provider_calls_after: 2 },
    { index: 1, resumed: false, provider_calls_before: 1, provider_calls_after: 2 },
    { index: 1, resumed: true, provider_calls: 2 },
  ]) {
    assert.equal(evaluate(invalid).ok, false);
  }
});

const streamChunkBodies = (records) =>
  records.map((record) => record.frame?.[4]).filter((body) => body?.event_type === "provider_progress");

function previewFixture() {
  return materializeFixture(streamPreviewFixtureSpec(), { scope: runScope });
}

// 反例只改隔离副本：重写 wire 或预览文本，模板本身不动。
function previewCopy(t, mutate = (records) => records, previewProse = PREVIEW_PROSE) {
  const copy = createWorkingCopy(previewFixture(), { context: t });
  if (previewProse !== PREVIEW_PROSE) {
    fs.writeFileSync(copy.files.get(PREVIEW_TEXT), previewText(previewProse));
  }
  fs.writeFileSync(
    copy.files.get(PREVIEW_TRANSPORT),
    `${mutate(streamPreviewRecords()).map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  return copy.dir;
}

async function rejectsStreamPreview(t, mutate, pattern, previewProse = PREVIEW_PROSE) {
  const dir = previewCopy(t, mutate, previewProse);
  await assert.rejects(() => main(["verify", dir]), pattern);
}

test("流式预览正例：终局 run 的连续 writer 增量出现在 AX 采样时通过", async (t) => {
  const dir = previewCopy(t);
  await main(["verify", dir]);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.run_id, PREVIEW_RUN);
  assert.equal(summary.provider_call_ref, PREVIEW_CALL);
  assert.deepEqual(
    Object.values(summary.checks),
    Array(Object.keys(summary.checks).length).fill(true),
  );
});

test("流式预览拒绝外来 run/purpose 的增量，不按全帧拼接", async (t) => {
  await rejectsStreamPreview(t, (records) => {
    for (const body of streamChunkBodies(records)) {
      body.run_id = "run_foreign";
      body.run_ref = "run_foreign";
      body.payload.purpose = "evaluator";
      body.payload.provider_call_ref = "pcall_foreign";
      body.payload.provider_run_ref = "prun_foreign";
    }
    return records;
  }, /writer|增量|归属|run/);
});

test("流式预览拒绝同一 run 内混用不同 Provider call 或缺失归属", async (t) => {
  // 让 AX 里显示的前 12 字跨在两组正文之间：任一组单独都匹配不到。
  const splitPreview = `${PREVIEW_DELTAS[0].slice(-6)}${PREVIEW_DELTAS[1].slice(0, 6)}`;
  for (const [mutate, pattern] of [
    [(records) => {
      streamChunkBodies(records)[1].payload.provider_call_ref = "pcall_other";
      return records;
    }, /匹配|前缀/],
    [(records) => {
      streamChunkBodies(records)[1].payload.provider_run_ref = "prun_other";
      return records;
    }, /匹配|前缀/],
    [(records) => {
      delete streamChunkBodies(records)[1].event_id;
      return records;
    }, /event_id|归属/],
  ]) {
    await rejectsStreamPreview(t, mutate, pattern, splitPreview);
  }
});

test("流式预览正例：独立 writer、外来 run、非正文与 Unicode 不破坏同源前缀", async (t) => {
  const at = (second) => `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`;
  const extraChunk = ({
    second,
    sequence,
    runId = PREVIEW_RUN,
    callRef = PREVIEW_CALL,
    providerRunRef = PREVIEW_PROVIDER_RUN,
    outputType = "text",
    delta = "",
  }) => ({
    at: at(second),
    direction: "received",
    frame: [null, null, PREVIEW_TOPIC, "agent_event", {
      payload: {
        status: "running",
        provider_call_ref: callRef,
        provider_run_ref: providerRunRef,
        purpose: "writer",
        output_type: outputType,
        ...(outputType === "text"
          ? { author_content_delta: delta, chunk_content_length: delta.length }
          : {}),
        provider_event_type: "chunk",
      },
      run_id: runId,
      run_ref: runId,
      event_type: "provider_progress",
      event_id: `evt_extra_${sequence}`,
      sequence,
    }],
  });
  const dir = previewCopy(t, (records) => {
    // Unicode 让 Elixir grapheme 累计长度与 JS UTF-16 长度不同。
    streamChunkBodies(records).at(-1).payload.author_content_delta += "🔥符纸燃尽。";
    const extras = [
      extraChunk({ second: 6, sequence: 6, outputType: "tool" }),
      extraChunk({
        second: 7,
        sequence: 10,
        callRef: "pcall_second",
        providerRunRef: "prun_second",
        delta: "另一路独立 writer 正文，",
      }),
      extraChunk({
        second: 8,
        sequence: 11,
        callRef: "pcall_second",
        providerRunRef: "prun_second",
        delta: "不应参与匹配。",
      }),
      extraChunk({ second: 9, sequence: 12, runId: "run_foreign", delta: "外来 run 正文。" }),
    ];
    const finalIndex = records.findIndex((record) => record.frame?.[3] === "turn_result");
    const ordered = [
      ...records.slice(0, finalIndex),
      ...extras,
      ...records.slice(finalIndex),
    ];
    // 终局与 chunk 同毫秒：是否属于终局前由 wire 输入顺序决定。
    const finalAt = ordered.find((record) => record.frame?.[3] === "turn_result").at;
    for (const record of ordered) {
      if (record.frame?.[4]?.event_type === "provider_progress") record.at = finalAt;
    }
    return ordered;
  });
  await main(["verify", dir]);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.provider_call_ref, PREVIEW_CALL);
  assert.equal(summary.provider_run_ref, PREVIEW_PROVIDER_RUN);
  assert.deepEqual(
    Object.values(summary.checks),
    Array(Object.keys(summary.checks).length).fill(true),
  );
});

test("流式预览只接受终局之前、owning topic 上的增量", async (t) => {
  for (const mutate of [
    (records) => {
      const chunks = records.filter((record) => record.frame?.[4]?.event_type === "provider_progress");
      const rest = records.filter((record) => record.frame?.[4]?.event_type !== "provider_progress");
      return [...rest, ...chunks];
    },
    (records) => {
      for (const record of records) {
        if (record.frame?.[4]?.event_type === "provider_progress") {
          record.frame[2] = "workspace:foreign";
        }
      }
      return records;
    },
  ]) {
    await rejectsStreamPreview(t, mutate, /writer|增量|topic/);
  }
});
