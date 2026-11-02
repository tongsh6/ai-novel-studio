// B71 计划批次 canon/引用快照的纯函数测试。
// 运行：node --test scripts/lib/native_ui/authoring_canon_evidence.test.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  CANON_TABLES,
  LEGACY_SNAPSHOT_VERSION,
  SNAPSHOT_VERSION,
  buildAuthoringCanonSnapshot,
  compareAuthoringCanonSnapshots,
  compareRevisionDesignSnapshots,
  compareSourceDesignSnapshots,
  parseUtcTimestamp,
  uuidFromHex,
} from "./authoring_canon_evidence.mjs";

const WORK = "22222222-2222-4222-8222-222222222222";
const OTHER_WORK = "33333333-3333-4333-8333-333333333333";
const MEMORY = "11111111-1111-4111-8111-111111111111";
const OTHER_MEMORY = "44444444-4444-4444-8444-444444444444";
const LOG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const START = "2026-11-01T08:00:00.000Z";
const FINAL = "2026-11-01T08:00:10.000Z";

function memoryRow(overrides = {}) {
  return {
    id: MEMORY,
    work_id: WORK,
    volume_id: null,
    arc_id: null,
    chapter_id: null,
    content: "井底浮现第七枚手印",
    summary: "作者已采纳的章计划",
    type: "chapter_plan",
    scope: "work",
    status: "CONFIRMED",
    source_type: "AUTHOR_CONFIRMED",
    source_id: "55555555-5555-4555-8555-555555555555",
    reference_count: 0,
    weight: "0.8000",
    confidence: "0.9000",
    source_confidence: "1.0000",
    locked: 1,
    recallable: 1,
    common_sense: 0,
    valid_from: null,
    valid_until: null,
    expire_condition: null,
    version: 1,
    tags: "[\"adopted_artifact\",\"outline_draft\"]",
    last_referenced_at: null,
    inserted_at: "2026-11-01T07:00:00.000000Z",
    updated_at: "2026-11-01T07:00:00.000000Z",
    future_column: "unknown-column-must-be-hashed",
    future_flag: true,
    future_blob: new Uint8Array([0, 255, 7]),
    ...overrides,
  };
}

function mission(overrides = {}) {
  return {
    mission_id: "cm_test_1",
    statement: "本章按计划推进。",
    confidence: 0.9,
    must_advance: [
      { text: "推进既定情节。", basis_ref: "plan:1:chapter_role", basis_label: "章功能定位：开篇" },
    ],
    must_avoid: [],
    provider_call_ref: "pcall-mission-1",
    status: "TENTATIVE",
    source: "model",
    derived_at: START,
    ...overrides,
  };
}

function chapterRow(overrides = {}) {
  return {
    id: "chapter-row",
    work_id: WORK,
    volume_id: null,
    title: "第一章",
    seq: 1,
    status: "PLANNED",
    inserted_at: START,
    updated_at: START,
    summary: "章摘要",
    plan_direction: JSON.stringify({ chapter_role: "开篇" }),
    future_chapter_column: "unknown-chapter-column",
    ...overrides,
  };
}

function baseTables(memoryOverrides = {}) {
  const row = (id, extra = {}) => ({ id, ...extra });
  return {
    works: [row("work-row", { title: "灰烬中的手印" })],
    drafts: [row("draft-row", { content: "草稿" })],
    chapters: [chapterRow()],
    volumes: [row("volume-row", { title: "第一卷" })],
    scenes: [row("scene-row", { title: "井底" })],
    characters: [row("character-row", { name: "沈砚" })],
    memory_items: [memoryRow(memoryOverrides)],
    ledger_entries: [row("ledger-row", { content: "已发生事实" })],
    author_action_receipts: [row("receipt-row", { action: "adopt_artifact" })],
  };
}

function logRow(overrides = {}) {
  return {
    id: LOG,
    memory_id: MEMORY,
    work_id: WORK,
    task_id: null,
    conversation_id: null,
    reference_scene: "dialogue_context",
    reference_reason: "dialogue recall matched author input: 请核对",
    inserted_at: "2026-11-01T08:00:05.123456",
    ...overrides,
  };
}

function snapshot({ tables = baseTables(), logs = [], at = START } = {}) {
  return buildAuthoringCanonSnapshot({ tables, referenceLogs: logs, at });
}

function finalWith(memoryOverrides, logs, at = FINAL) {
  return snapshot({ tables: baseTables(memoryOverrides), logs, at });
}

function hexBytes(hex) {
  return Uint8Array.from(hex.match(/../g).map((pair) => Number.parseInt(pair, 16)));
}

test("快照带版本、at、9表全行/canon hash、每 memory 统计和完整引用日志", () => {
  const value = snapshot({ logs: [logRow()] });
  assert.equal(value.version, SNAPSHOT_VERSION);
  assert.equal(value.at, START);
  assert.deepEqual(Object.keys(value.tables).sort(), [...CANON_TABLES].sort());
  assert.equal(CANON_TABLES.length, 9);
  for (const table of CANON_TABLES) {
    assert.equal(value.tables[table].row_count, 1);
    assert.match(value.tables[table].rows_sha256, /^[0-9a-f]{64}$/);
    assert.match(value.tables[table].canon_sha256, /^[0-9a-f]{64}$/);
  }
  assert.equal(value.tables.works.canon_sha256, value.tables.works.rows_sha256);
  assert.deepEqual(value.memory_items[MEMORY], {
    work_id: WORK,
    reference_count: 0,
    last_referenced_at: null,
  });
  assert.equal(value.memory_reference_logs.length, 1);
  assert.deepEqual(value.memory_reference_logs[0], logRow());
});

test("memory_items 的 canon hash 只排除两个统计列，未知新增列仍纳入", () => {
  const start = snapshot();
  const opsOnly = finalWith({ reference_count: 1, last_referenced_at: "2026-11-01T08:00:05.123456Z" }, [logRow()]);
  assert.equal(start.tables.memory_items.canon_sha256, opsOnly.tables.memory_items.canon_sha256);
  assert.notEqual(start.tables.memory_items.rows_sha256, opsOnly.tables.memory_items.rows_sha256);

  for (const [column, value] of [
    ["content", "被改写的内容"],
    ["status", "DRAFT"],
    ["version", 2],
    ["updated_at", "2026-11-01T09:00:00.000000Z"],
    ["future_column", "changed-unknown-column"],
  ]) {
    const changed = finalWith({ [column]: value }, [], FINAL);
    assert.notEqual(start.tables.memory_items.canon_sha256, changed.tables.memory_items.canon_sha256, column);
  }
});

test("合法零次引用通过，且不要求固定出现引用日志", () => {
  const result = compareAuthoringCanonSnapshots(snapshot(), snapshot({ at: FINAL }));
  assert.deepEqual(result.checks, {
    no_canon_write: true,
    memory_reference_updates_accounted: true,
  });
  assert.equal(result.measured.reference_logs.added, 0);
  assert.equal(result.measured.reference_count_delta, 0);
  assert.deepEqual(result.measured.updated_memories, []);
});

test("合法一次引用：naive UTC 日志、计数增量和 last_referenced_at 精确对应", () => {
  const final = finalWith(
    { reference_count: 1, last_referenced_at: "2026-11-01T08:00:05.123456Z" },
    [logRow({ inserted_at: "2026-11-01 08:00:05.123456" })],
  );
  const result = compareAuthoringCanonSnapshots(snapshot(), final);
  assert.equal(result.checks.no_canon_write, true);
  assert.equal(result.checks.memory_reference_updates_accounted, true);
  assert.equal(result.measured.reference_logs.added, 1);
  assert.equal(result.measured.reference_count_delta, 1);
});

test("合法多次引用按实际日志数核算，不假定只有两次", () => {
  const logs = [1, 2, 3, 4].map((index) => logRow({
    id: `${String(index).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    inserted_at: `2026-11-01T08:00:0${index}.000000`,
  }));
  const final = finalWith(
    { reference_count: 4, last_referenced_at: "2026-11-01T08:00:04.000000Z" },
    logs,
  );
  const result = compareAuthoringCanonSnapshots(snapshot(), final);
  assert.equal(result.checks.no_canon_write, true);
  assert.equal(result.checks.memory_reference_updates_accounted, true);
  assert.equal(result.measured.reference_logs.added, 4);
  assert.equal(result.measured.reference_count_delta, 4);
});

test("每个 memory 的计数增量分别对应自己的新增日志数", () => {
  const tables = baseTables();
  tables.memory_items.push(memoryRow({ id: OTHER_MEMORY, content: "第二条记忆" }));
  const finalTables = structuredClone(tables);
  finalTables.memory_items[0].reference_count = 1;
  finalTables.memory_items[0].last_referenced_at = "2026-11-01T08:00:05.123456Z";
  const result = compareAuthoringCanonSnapshots(
    snapshot({ tables }),
    snapshot({ tables: finalTables, logs: [logRow()], at: FINAL }),
  );
  assert.equal(result.checks.no_canon_write, true);
  assert.equal(result.checks.memory_reference_updates_accounted, true);
  assert.equal(result.measured.updated_memories.length, 1);
  assert.equal(result.measured.updated_memories[0].memory_id, MEMORY);
});

test("只有 memory_items 排除两个统计列，其他表同名列仍属于 canon", () => {
  const startTables = baseTables();
  startTables.works[0].reference_count = 0;
  startTables.works[0].last_referenced_at = null;
  const finalTables = structuredClone(startTables);
  finalTables.works[0].reference_count = 1;
  finalTables.works[0].last_referenced_at = "2026-11-01T08:00:05.000000Z";
  assert.notEqual(
    snapshot({ tables: startTables }).tables.works.canon_sha256,
    snapshot({ tables: finalTables }).tables.works.canon_sha256,
  );
});

test("行与引用日志按固定顺序哈希/输出，输入顺序不影响证据", () => {
  const ordered = baseTables();
  ordered.works = [
    { id: "row-b", value: 2 }, { id: "row-a", value: 1 }, { id: "row-d", value: 4 },
    { id: "row-c", value: 3 }, { id: "row-f", value: 6 }, { id: "row-e", value: 5 },
  ];
  const reordered = structuredClone(ordered);
  reordered.works.reverse();
  assert.equal(
    snapshot({ tables: ordered }).tables.works.rows_sha256,
    snapshot({ tables: reordered }).tables.works.rows_sha256,
  );

  const logs = [
    logRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", inserted_at: "2026-11-01T08:00:05.000000" }),
    logRow({ id: LOG, inserted_at: "2026-11-01T08:00:04.000000" }),
  ];
  assert.deepEqual(
    snapshot({ logs }).memory_reference_logs,
    snapshot({ logs: [...logs].reverse() }).memory_reference_logs,
  );
  const sameTime = [
    logRow({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", inserted_at: "2026-11-01T08:00:05.000000" }),
    logRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", inserted_at: "2026-11-01T08:00:05.000000" }),
  ];
  assert.deepEqual(
    snapshot({ logs: sameTime }).memory_reference_logs.map((log) => log.id),
    ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
  );
  assert.deepEqual(
    snapshot({ logs: sameTime }).memory_reference_logs,
    snapshot({ logs: [...sameTime].reverse() }).memory_reference_logs,
  );
});

test("时间边界：合法最小/最大字段通过，越界、非法日历与非法时区被拒绝", () => {
  assert.equal(
    parseUtcTimestamp("2026-12-31T23:59:59.999999Z"),
    (Date.UTC(2026, 11, 31, 23, 59, 59) * 1000) + 999999,
  );
  assert.equal(parseUtcTimestamp("1900-01-01T00:00:00Z"), Date.UTC(1900, 0, 1) * 1000);
  assert.equal(
    parseUtcTimestamp("2026-11-01T03:00:00-05:00"),
    parseUtcTimestamp("2026-11-01T08:00:00Z"),
  );
  assert.equal(
    parseUtcTimestamp("2026-11-01T08:00:00+00:00"),
    parseUtcTimestamp("2026-11-01T08:00:00Z"),
  );
  assert.equal(
    parseUtcTimestamp("2026-11-01T08:30:00+05:30"),
    parseUtcTimestamp("2026-11-01T03:00:00Z"),
  );
  assert.equal(
    parseUtcTimestamp("2026-11-01T09:59:00+23:00"),
    parseUtcTimestamp("2026-10-31T10:59:00Z"),
  );
  assert.equal(
    parseUtcTimestamp("2026-11-01T00:01:00-23:59"),
    parseUtcTimestamp("2026-11-02T00:00:00Z"),
  );
  for (const value of [
    "0999-12-31T23:59:59Z",
    "2026-00-01T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-01-00T00:00:00Z",
    "2026-01-32T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T23:60:00Z",
    "2026-01-01T23:59:60Z",
    "2026-02-29T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-01-01T00:00:00+24:00",
    "2026-01-01T00:00:00+00:60",
    "2026-01-01T00:00:00-99:00",
  ]) {
    assert.throws(() => parseUtcTimestamp(value), /invalid_utc_timestamp/, value);
  }
});

test("引用窗口端点含边界，final 早于 start 或 last_referenced_at 越过边界均拒绝", () => {
  const logs = [
    logRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", inserted_at: START }),
    logRow({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", inserted_at: FINAL }),
  ];
  assert.equal(
    compareAuthoringCanonSnapshots(
      snapshot(),
      finalWith({ reference_count: 2, last_referenced_at: FINAL }, logs),
    ).checks.memory_reference_updates_accounted,
    true,
  );
  assert.equal(
    compareAuthoringCanonSnapshots(snapshot({ at: START }), snapshot({ at: START })).checks.no_canon_write,
    true,
  );
  assert.throws(
    () => compareAuthoringCanonSnapshots(snapshot({ at: FINAL }), snapshot({ at: START })),
    /invalid_authoring_canon_snapshot/,
  );

  const startAtLastReference = snapshot({
    tables: baseTables({ last_referenced_at: "2026-11-01T08:00:06.000000Z" }),
  });
  const equalLastReference = finalWith(
    { reference_count: 1, last_referenced_at: "2026-11-01T08:00:06.000000Z" },
    [logRow({ inserted_at: "2026-11-01T08:00:05.000000" })],
  );
  assert.equal(
    compareAuthoringCanonSnapshots(startAtLastReference, equalLastReference)
      .checks.memory_reference_updates_accounted,
    true,
  );
  assert.equal(
    compareAuthoringCanonSnapshots(snapshot(), finalWith(
      { reference_count: 1, last_referenced_at: FINAL },
      [logRow({ inserted_at: "2026-11-01T08:00:05.000000" })],
    )).checks.memory_reference_updates_accounted,
    true,
  );
  assert.equal(
    compareAuthoringCanonSnapshots(snapshot(), finalWith(
      { reference_count: 1, last_referenced_at: null },
      [logRow()],
    )).checks.memory_reference_updates_accounted,
    false,
  );
});

test("计数倒退或新增日志但计数不变都必须失败，且失配会进入 measured", () => {
  const decreased = compareAuthoringCanonSnapshots(
    snapshot({ tables: baseTables({ reference_count: 5 }) }),
    snapshot({
      tables: baseTables({ reference_count: 3, last_referenced_at: "2026-11-01T08:00:06.000000Z" }),
      logs: [logRow(), logRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })],
      at: FINAL,
    }),
  );
  assert.equal(decreased.checks.memory_reference_updates_accounted, false);

  const plusDelta = compareAuthoringCanonSnapshots(
    snapshot({ tables: baseTables({ reference_count: 1 }) }),
    snapshot({
      tables: baseTables({ reference_count: 2, last_referenced_at: "2026-11-01T08:00:06.000000Z" }),
      logs: [
        logRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", inserted_at: "2026-11-01T08:00:03.000000" }),
        logRow({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", inserted_at: "2026-11-01T08:00:04.000000" }),
        logRow({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", inserted_at: "2026-11-01T08:00:05.000000" }),
      ],
      at: FINAL,
    }),
  );
  assert.equal(plusDelta.checks.memory_reference_updates_accounted, false);

  const extraLog = compareAuthoringCanonSnapshots(
    snapshot(),
    finalWith({ reference_count: 0, last_referenced_at: null }, [logRow()]),
  );
  assert.equal(extraLog.checks.memory_reference_updates_accounted, false);
  assert.equal(extraLog.measured.updated_memories.length, 1);
  assert.equal(extraLog.measured.reference_count_delta, 0);
});

test("内容、状态、版本、updated_at 或未知列变化均触发 canon 写入失败", () => {
  const start = snapshot();
  for (const [column, value] of [
    ["content", "被改写的内容"],
    ["status", "DRAFT"],
    ["version", 2],
    ["updated_at", "2026-11-01T09:00:00.000000Z"],
    ["future_column", "changed-unknown-column"],
  ]) {
    const final = finalWith({ [column]: value }, [], FINAL);
    assert.equal(
      compareAuthoringCanonSnapshots(start, final).checks.no_canon_write,
      false,
      column,
    );
  }
});

test("嵌套不可 JSON 化值必须拒绝，不能被对象直接透传", () => {
  for (const bad of [() => {}, Symbol("bad"), 1n]) {
    const tables = baseTables();
    tables.works[0].bad = bad;
    assert.throws(
      () => snapshot({ tables }),
      /invalid_authoring_canon_snapshot/,
    );
  }
});

test("9 表任一行增删都触发 canon 写入失败", () => {
  const start = snapshot();
  for (const table of CANON_TABLES) {
    const added = structuredClone(baseTables());
    added[table].push(table === "memory_items"
      ? memoryRow({ id: OTHER_MEMORY, content: "新增记忆" })
      : table === "chapters"
        ? chapterRow({ id: `extra-${table}`, seq: 2, title: "第二章" })
        : { id: `extra-${table}`, title: "extra" });
    assert.equal(
      compareAuthoringCanonSnapshots(start, snapshot({ tables: added, at: FINAL })).checks.no_canon_write,
      false,
      `add ${table}`,
    );
    const deleted = structuredClone(baseTables());
    deleted[table] = [];
    assert.equal(
      compareAuthoringCanonSnapshots(start, snapshot({ tables: deleted, at: FINAL })).checks.no_canon_write,
      false,
      `delete ${table}`,
    );
  }
});

test("伪造计数、缺日志、日志数不匹配均不能通过引用核算", () => {
  const forged = finalWith({ reference_count: 2, last_referenced_at: "2026-11-01T08:00:05.123456Z" }, [logRow()]);
  assert.equal(compareAuthoringCanonSnapshots(snapshot(), forged).checks.memory_reference_updates_accounted, false);
  const missing = finalWith({ reference_count: 1, last_referenced_at: "2026-11-01T08:00:05.123456Z" }, []);
  assert.equal(compareAuthoringCanonSnapshots(snapshot(), missing).checks.memory_reference_updates_accounted, false);
  const tooManyLogs = finalWith(
    { reference_count: 1, last_referenced_at: "2026-11-01T08:00:05.123456Z" },
    [logRow(), logRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })],
  );
  assert.equal(compareAuthoringCanonSnapshots(snapshot(), tooManyLogs).checks.memory_reference_updates_accounted, false);
});

test("重复引用日志 id 被快照构建和比较拒绝", () => {
  const count = { reference_count: 2, last_referenced_at: "2026-11-01T08:00:05.123456Z" };
  assert.throws(
    () => finalWith(count, [logRow(), logRow()]),
    /invalid_authoring_canon_snapshot/,
  );
  const final = finalWith(count, [logRow()]);
  final.memory_reference_logs.push(structuredClone(final.memory_reference_logs[0]));
  assert.throws(
    () => compareAuthoringCanonSnapshots(snapshot(), final),
    /invalid_authoring_canon_snapshot/,
  );
});

test("旧引用日志被修改或删除均不能通过", () => {
  const start = snapshot({ logs: [logRow()] });
  const modified = finalWith({}, [logRow({ reference_reason: "被改写的旧 reason" })]);
  assert.equal(compareAuthoringCanonSnapshots(start, modified).checks.memory_reference_updates_accounted, false);
  const deleted = finalWith({}, []);
  assert.equal(compareAuthoringCanonSnapshots(start, deleted).checks.memory_reference_updates_accounted, false);
});

test("旧引用日志的未知列完整保留、JSON 安全并纳入逐字比较", () => {
  const unknown = {
    audit_extra: "原值",
    audit_nested: { z: 1, a: [true, null, "x"] },
    audit_blob: new Uint8Array([0, 255, 7]),
  };
  const start = snapshot({ logs: [logRow(unknown)] });
  const [preserved] = start.memory_reference_logs;
  assert.equal(preserved.audit_extra, "原值");
  assert.deepEqual(preserved.audit_nested, { a: [true, null, "x"], z: 1 });
  assert.deepEqual(preserved.audit_blob, { $blob: "00ff07" });
  assert.deepEqual(JSON.parse(JSON.stringify(start)), start);

  const tampered = finalWith({}, [logRow({ ...unknown, audit_extra: "篡改" })], FINAL);
  assert.equal(
    compareAuthoringCanonSnapshots(start, tampered).checks.memory_reference_updates_accounted,
    false,
  );
  const removed = finalWith({}, [logRow({
    audit_nested: unknown.audit_nested,
    audit_blob: unknown.audit_blob,
  })], FINAL);
  assert.equal(
    compareAuthoringCanonSnapshots(start, removed).checks.memory_reference_updates_accounted,
    false,
  );
  const addedToOld = compareAuthoringCanonSnapshots(
    snapshot({ logs: [logRow()] }),
    finalWith({}, [logRow({ audit_extra: "后来新增" })], FINAL),
  );
  assert.equal(addedToOld.checks.memory_reference_updates_accounted, false);
});

test("只归一已知 id 字段的 UUID，未知字段按原值保留", () => {
  const rawExtraId = MEMORY.replaceAll("-", "").toUpperCase();
  const value = snapshot({ logs: [logRow({ extra_ref: rawExtraId })] });
  const [log] = value.memory_reference_logs;
  assert.equal(log.id, LOG);
  assert.equal(log.memory_id, MEMORY);
  assert.equal(log.extra_ref, rawExtraId);
});

test("新日志必须属于已存在 memory/work，且 scene 必须是 dialogue_context", () => {
  const count = { reference_count: 1, last_referenced_at: "2026-11-01T08:00:05.123456Z" };
  for (const bad of [
    logRow({ memory_id: OTHER_MEMORY }),
    logRow({ work_id: OTHER_WORK }),
    logRow({ reference_scene: "memory_lifecycle" }),
    logRow({ reference_scene: "memory_lifecycle_blocked" }),
  ]) {
    assert.equal(
      compareAuthoringCanonSnapshots(snapshot(), finalWith(count, [bad])).checks.memory_reference_updates_accounted,
      false,
      JSON.stringify({ memory_id: bad.memory_id, work_id: bad.work_id, scene: bad.reference_scene }),
    );
  }
});

test("新日志 reason 必须来自 dialogue recall，时间必须落在 start/final 窗口", () => {
  const count = { reference_count: 1, last_referenced_at: "2026-11-01T08:00:05.123456Z" };
  for (const bad of [
    logRow({ reference_reason: null }),
    logRow({ reference_reason: "" }),
    logRow({ reference_reason: "   " }),
    logRow({ reference_reason: "forged but non-empty" }),
    logRow({ reference_reason: "dialogue recall matched author input:" }),
    logRow({ inserted_at: "2026-11-01T07:59:59.999999" }),
    logRow({ inserted_at: "2026-11-01T08:00:10.000001" }),
  ]) {
    assert.equal(
      compareAuthoringCanonSnapshots(snapshot(), finalWith(count, [bad])).checks.memory_reference_updates_accounted,
      false,
      JSON.stringify({ reason: bad.reference_reason, inserted_at: bad.inserted_at }),
    );
  }
  const fallback = finalWith(count, [logRow({ reference_reason: "dialogue context recall" })]);
  assert.equal(
    compareAuthoringCanonSnapshots(snapshot(), fallback).checks.memory_reference_updates_accounted,
    true,
  );
});

test("无新增日志时 last_referenced_at 必须原样不变", () => {
  const start = snapshot({ logs: [logRow()] });
  const changed = finalWith({ last_referenced_at: "2026-11-01T08:00:06.000000Z" }, [logRow()]);
  assert.equal(compareAuthoringCanonSnapshots(start, changed).checks.memory_reference_updates_accounted, false);
});

test("有新增日志时 last_referenced_at 不得倒退、早于最后日志或晚于 final", () => {
  const start = snapshot({
    tables: baseTables({ last_referenced_at: "2026-11-01T08:00:04.000000Z" }),
  });
  const logs = [
    logRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", inserted_at: "2026-11-01T08:00:05.000000" }),
    logRow({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", inserted_at: "2026-11-01T08:00:06.000000" }),
  ];
  const count = { reference_count: 2 };
  for (const last of [
    "2026-11-01T08:00:03.000000Z",
    "2026-11-01T08:00:05.500000Z",
    "2026-11-01T08:00:11.000000Z",
  ]) {
    assert.equal(
      compareAuthoringCanonSnapshots(start, finalWith({ ...count, last_referenced_at: last }, logs))
        .checks.memory_reference_updates_accounted,
      false,
      last,
    );
  }
  assert.equal(
    compareAuthoringCanonSnapshots(start, finalWith({ ...count, last_referenced_at: "2026-11-01T08:00:06.000001Z" }, logs))
      .checks.memory_reference_updates_accounted,
    true,
  );
});

test("naive UTC 时间按 UTC 解析，不受机器时区影响", () => {
  assert.equal(parseUtcTimestamp("2026-11-01 08:00:00"), Date.UTC(2026, 10, 1, 8, 0, 0) * 1000);
  assert.equal(parseUtcTimestamp("2026-11-01T08:00:00Z"), parseUtcTimestamp("2026-11-01 08:00:00"));
  assert.equal(parseUtcTimestamp("2026-11-01T16:00:00+08:00"), parseUtcTimestamp("2026-11-01T08:00:00Z"));
  const final = finalWith(
    { reference_count: 1, last_referenced_at: "2026-11-01T08:00:05.123456Z" },
    [logRow({ inserted_at: "2026-11-01 08:00:05.123456" })],
  );
  assert.equal(compareAuthoringCanonSnapshots(snapshot(), final).checks.memory_reference_updates_accounted, true);
});

test("坏时间值被拒绝，不能靠 Date.parse 宽松放行", () => {
  for (const value of ["not-a-time", "2026-02-30T08:00:00Z", "2026-11-01T08:00:00+99:00"]) {
    assert.throws(() => parseUtcTimestamp(value), /invalid_utc_timestamp/);
  }
  assert.equal(parseUtcTimestamp("2026-11-01T08:00:00"), parseUtcTimestamp("2026-11-01T08:00:00Z"));
});

test("引用日志 UUID 十六进制/BLOB 归一为虚线小写，且快照可 JSON 往返", () => {
  const bytes = hexBytes(MEMORY.replaceAll("-", ""));
  const raw = logRow({
    id: LOG.replaceAll("-", "").toUpperCase(),
    memory_id: bytes,
    work_id: WORK.replaceAll("-", ""),
  });
  const value = snapshot({ logs: [raw] });
  assert.equal(value.memory_reference_logs[0].id, LOG);
  assert.equal(value.memory_reference_logs[0].memory_id, MEMORY);
  assert.equal(value.memory_reference_logs[0].work_id, WORK);
  assert.equal(uuidFromHex(MEMORY.replaceAll("-", "")), MEMORY);
  for (const bad of ["not-hex", 123, "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"]) {
    assert.throws(() => uuidFromHex(bad), /invalid_uuid/);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
});

test("缺版本、缺 at、缺表、缺字段和旧格式快照都硬拒绝", () => {
  const final = snapshot({ at: FINAL });
  const missingVersion = snapshot();
  delete missingVersion.version;
  const missingAt = snapshot();
  delete missingAt.at;
  const missingTable = snapshot();
  delete missingTable.tables.chapters;
  const missingRowCount = snapshot();
  delete missingRowCount.tables.works.row_count;
  const missingStat = snapshot();
  delete missingStat.memory_items[MEMORY].work_id;
  const missingLogField = snapshot({ logs: [logRow()] });
  delete missingLogField.memory_reference_logs[0].inserted_at;
  for (const bad of [
    undefined,
    null,
    {},
    { checkpoint: "start", db_production_counts: {} },
    missingVersion,
    missingAt,
    missingTable,
    missingRowCount,
    missingStat,
    missingLogField,
  ]) {
    assert.throws(
      () => compareAuthoringCanonSnapshots(bad, final),
      /invalid_authoring_canon_snapshot/,
    );
  }
});

test("坏类型、非 JSON 值和缺统计字段都硬拒绝", () => {
  const final = snapshot({ at: FINAL });
  for (const mutate of [
    (value) => { value.version = "1"; },
    (value) => { value.at = 123; },
    (value) => { value.tables = []; },
    (value) => { value.tables.works.row_count = "1"; },
    (value) => { value.tables.works.rows_sha256 = "short"; },
    (value) => { value.tables.memory_items.rows_sha256 = "short"; },
    (value) => { value.tables.memory_items.canon_sha256 = "SHORT"; },
    (value) => { value.memory_items = []; },
    (value) => { value.memory_items[MEMORY].reference_count = "0"; },
    (value) => { value.memory_items[MEMORY].last_referenced_at = 7; },
    (value) => { value.memory_reference_logs = {}; },
    (value) => { value.memory_reference_logs = [42]; },
  ]) {
    const bad = snapshot();
    mutate(bad);
    assert.throws(
      () => compareAuthoringCanonSnapshots(bad, final),
      /invalid_authoring_canon_snapshot/,
    );
  }
});

test("表行必须是非空字符串 id 的唯一对象，坏行不能被哈希掩盖", () => {
  for (const rows of [
    [null],
    [[]],
    [{}],
    [{ id: "" }],
    [{ id: 1 }],
    [new Uint8Array([1, 2])],
    [{ id: "same" }, { id: "same" }],
  ]) {
    const tables = baseTables();
    tables.works = rows;
    assert.throws(
      () => snapshot({ tables }),
      /invalid_authoring_canon_snapshot/,
      JSON.stringify(rows),
    );
  }
});

test("memory id 集合或 work_id 变化不能被统计增量掩盖", () => {
  const otherMemory = structuredClone(baseTables());
  otherMemory.memory_items[0] = memoryRow({ id: OTHER_MEMORY });
  assert.equal(
    compareAuthoringCanonSnapshots(snapshot(), snapshot({ tables: otherMemory, at: FINAL }))
      .checks.memory_reference_updates_accounted,
    false,
  );
  const movedWork = structuredClone(baseTables());
  movedWork.memory_items[0].work_id = OTHER_WORK;
  assert.equal(
    compareAuthoringCanonSnapshots(snapshot(), snapshot({ tables: movedWork, at: FINAL }))
      .checks.memory_reference_updates_accounted,
    false,
  );
});

test("嵌套对象键序不影响 canon 行 hash", () => {
  const first = baseTables();
  first.works[0].nested = { z: [1, { b: 2, a: 1 }], a: true };
  const second = baseTables();
  second.works[0].nested = { a: true, z: [1, { a: 1, b: 2 }] };
  assert.equal(
    snapshot({ tables: first }).tables.works.rows_sha256,
    snapshot({ tables: second }).tables.works.rows_sha256,
  );
});

// ── v2：章设计态见证与两段边界 ─────────────────────────────

function chapterSnapshot({ at = START, planDirection, updatedAt = START, overrides = {} } = {}) {
  const tables = baseTables();
  tables.chapters = [chapterRow({
    updated_at: updatedAt,
    plan_direction: JSON.stringify(planDirection),
    ...overrides,
  })];
  return snapshot({ tables, at });
}

test("v2 快照按章保存 protected hash、真实 mission 与 updated_at", () => {
  const value = chapterSnapshot({ planDirection: { chapter_role: "开篇", chapter_mission: mission() } });
  assert.equal(value.version, SNAPSHOT_VERSION);
  assert.equal(value.version, 2);
  const fact = value.chapters["chapter-row"];
  assert.equal(fact.work_id, WORK);
  assert.equal(fact.seq, 1);
  assert.equal(fact.title, "第一章");
  assert.equal(fact.updated_at, START);
  assert.match(fact.protected_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(fact.mission, mission());
  assert.equal(value.tables.chapters.row_count, 1);
});

test("mission 之外的 plan_direction 键改变 protected hash，mission 单独改变不影响 protected hash", () => {
  const noMission = chapterSnapshot({ planDirection: { chapter_role: "开篇" } });
  const withMission = chapterSnapshot({ planDirection: { chapter_role: "开篇", chapter_mission: mission() } });
  assert.equal(noMission.chapters["chapter-row"].protected_sha256, withMission.chapters["chapter-row"].protected_sha256);
  assert.equal(noMission.chapters["chapter-row"].mission, null);
  assert.notEqual(noMission.tables.chapters.rows_sha256, withMission.tables.chapters.rows_sha256);

  const changedRole = chapterSnapshot({ planDirection: { chapter_role: "改过的章功能" } });
  assert.notEqual(noMission.chapters["chapter-row"].protected_sha256, changedRole.chapters["chapter-row"].protected_sha256);

  const changedScene = chapterSnapshot({
    planDirection: { chapter_role: "开篇", scene_plans: [{ title: "新增场次" }] },
  });
  assert.notEqual(noMission.chapters["chapter-row"].protected_sha256, changedScene.chapters["chapter-row"].protected_sha256);
});

test("v2 快照拒绝坏 plan_direction、缺字段、mission 未知键与缺 basis_label", () => {
  const badDirections = [
    "[]",
    JSON.stringify({ chapter_mission: [] }),
    JSON.stringify({ chapter_mission: {} }),
    JSON.stringify({ chapter_mission: mission({ unknown_key: "x" }) }),
    JSON.stringify({ chapter_mission: mission({
      must_advance: [{ text: "推进。", basis_ref: "plan:1:chapter_role" }],
    }) }),
    JSON.stringify({ chapter_mission: mission({ status: "CONFIRMED" }) }),
    JSON.stringify({ chapter_mission: mission({ source: "author" }) }),
  ];
  for (const plan_direction of badDirections) {
    assert.throws(
      () => chapterSnapshot({ planDirection: JSON.parse(plan_direction) }),
      /invalid_authoring_canon_snapshot/,
      plan_direction,
    );
  }
  const tables = baseTables();
  tables.chapters[0].plan_direction = "{bad json";
  assert.throws(
    () => snapshot({ tables }),
    /invalid_authoring_canon_snapshot/,
  );
});

test("source 段：nil→model/TENTATIVE 合法，protected 不变且时间落在窗口", () => {
  const start = chapterSnapshot({ at: START, planDirection: { chapter_role: "开篇" } });
  const before = chapterSnapshot({
    at: FINAL,
    planDirection: { chapter_role: "开篇", chapter_mission: mission({ derived_at: FINAL }) },
    updatedAt: FINAL,
  });
  const result = compareSourceDesignSnapshots(start, before, { targetChapterId: "chapter-row" });
  assert.deepEqual(result.checks, {
    canon_unchanged_except_chapter_mission: true,
    chapter_mission_change_is_legal: true,
    author_action_receipts_unchanged: true,
    memory_reference_updates_accounted: true,
  });
  assert.equal(result.measured.chapter_design_changes.length, 1);
  assert.equal(result.measured.chapter_design_changes[0].mission_changed, true);
});

test("source 段：旧 TENTATIVE→新 TENTATIVE 合法，旧 TENTATIVE→nil 或作者版改写失败", () => {
  const old = mission({ derived_at: START });
  const start = chapterSnapshot({ planDirection: { chapter_mission: old } });
  const refreshed = chapterSnapshot({
    at: FINAL,
    planDirection: { chapter_mission: mission({ mission_id: "cm_test_2", derived_at: FINAL }) },
    updatedAt: FINAL,
  });
  assert.equal(
    compareSourceDesignSnapshots(start, refreshed, { targetChapterId: "chapter-row" })
      .checks.chapter_mission_change_is_legal,
    true,
  );
  const discarded = chapterSnapshot({ at: FINAL, planDirection: {}, updatedAt: FINAL });
  assert.equal(
    compareSourceDesignSnapshots(start, discarded, { targetChapterId: "chapter-row" })
      .checks.chapter_mission_change_is_legal,
    false,
  );

  const author = mission({
    status: "CONFIRMED",
    source: "author",
    must_advance: [{ text: "作者定版。" }],
    derived_at: START,
    decided_at: FINAL,
  });
  const authorStart = chapterSnapshot({ planDirection: { chapter_mission: author } });
  const authorOverwritten = chapterSnapshot({
    at: FINAL,
    planDirection: { chapter_mission: mission({ derived_at: FINAL }) },
    updatedAt: FINAL,
  });
  assert.equal(
    compareSourceDesignSnapshots(authorStart, authorOverwritten, { targetChapterId: "chapter-row" })
      .checks.chapter_mission_change_is_legal,
    false,
  );
});

test("source 段：改其它 plan 字段、title/status/未知字段/其它章或仅改 timestamp 均失败", () => {
  const start = chapterSnapshot({ planDirection: { chapter_role: "开篇" } });
  const mutations = [
    (row) => { row.plan_direction = JSON.stringify({ chapter_role: "改过", chapter_mission: mission({ derived_at: FINAL }) }); },
    (row) => { row.title = "改过的章标题"; row.plan_direction = JSON.stringify({ chapter_mission: mission({ derived_at: FINAL }) }); },
    (row) => { row.status = "DRAFT"; row.plan_direction = JSON.stringify({ chapter_mission: mission({ derived_at: FINAL }) }); },
    (row) => { row.future_chapter_column = "changed"; row.plan_direction = JSON.stringify({ chapter_mission: mission({ derived_at: FINAL }) }); },
  ];
  for (const mutate of mutations) {
    const tables = baseTables();
    tables.chapters[0].plan_direction = JSON.stringify({ chapter_role: "开篇" });
    mutate(tables.chapters[0]);
    tables.chapters[0].updated_at = FINAL;
    const before = snapshot({ tables, at: FINAL });
    const result = compareSourceDesignSnapshots(start, before, { targetChapterId: "chapter-row" });
    assert.equal(result.checks.chapter_mission_change_is_legal, false);
  }

  const secondStartTables = baseTables();
  secondStartTables.chapters.push(chapterRow({ id: "chapter-2", seq: 2, title: "第二章" }));
  const secondStart = snapshot({ tables: secondStartTables, at: START });
  const secondBeforeTables = structuredClone(secondStartTables);
  secondBeforeTables.chapters[1].plan_direction = JSON.stringify({ chapter_mission: mission({ derived_at: FINAL }) });
  secondBeforeTables.chapters[1].updated_at = FINAL;
  const secondBefore = snapshot({ tables: secondBeforeTables, at: FINAL });
  assert.equal(
    compareSourceDesignSnapshots(secondStart, secondBefore, { targetChapterId: "chapter-row" })
      .checks.chapter_mission_change_is_legal,
    false,
  );

  const timestampOnlyTables = structuredClone(baseTables());
  timestampOnlyTables.chapters[0].updated_at = FINAL;
  const timestampOnly = snapshot({ tables: timestampOnlyTables, at: FINAL });
  assert.equal(
    compareSourceDesignSnapshots(start, timestampOnly, { targetChapterId: "chapter-row" })
      .checks.chapter_mission_change_is_legal,
    false,
  );
});

test("source 段：旧 v1 快照不能补造设计态见证，缺 target 章也失败", () => {
  const start = chapterSnapshot({ planDirection: { chapter_role: "开篇" } });
  const before = chapterSnapshot({
    at: FINAL,
    planDirection: { chapter_role: "开篇", chapter_mission: mission({ derived_at: FINAL }) },
    updatedAt: FINAL,
  });
  const legacyStart = structuredClone(start);
  legacyStart.version = LEGACY_SNAPSHOT_VERSION;
  delete legacyStart.chapters;
  const legacyBefore = structuredClone(before);
  legacyBefore.version = LEGACY_SNAPSHOT_VERSION;
  delete legacyBefore.chapters;
  assert.throws(
    () => compareSourceDesignSnapshots(legacyStart, legacyBefore, { targetChapterId: "chapter-row" }),
    /version 2/,
  );
  assert.equal(
    compareSourceDesignSnapshots(start, before, { targetChapterId: "missing" })
      .checks.chapter_mission_change_is_legal,
    false,
  );
});

test("revision 段：仅新增一条 receipt 且章设计态严格不变才通过", () => {
  const beforeTables = baseTables();
  beforeTables.chapters[0].plan_direction = JSON.stringify({ chapter_role: "开篇", chapter_mission: mission() });
  const afterTables = structuredClone(beforeTables);
  afterTables.author_action_receipts.push({ id: "receipt-row-2", action: "revise_from_findings" });
  const before = snapshot({ tables: beforeTables, at: START });
  const after = snapshot({ tables: afterTables, at: FINAL });
  const result = compareRevisionDesignSnapshots(before, after);
  assert.deepEqual(result.checks, {
    canon_unchanged_except_action_receipt: true,
    action_receipt_added_once: true,
    chapter_design_state_unchanged: true,
    memory_reference_updates_accounted: true,
  });

  const missionChangedTables = structuredClone(afterTables);
  missionChangedTables.chapters[0].plan_direction = JSON.stringify({
    chapter_role: "开篇",
    chapter_mission: mission({ mission_id: "cm_child_changed" }),
  });
  assert.equal(
    compareRevisionDesignSnapshots(before, snapshot({ tables: missionChangedTables, at: FINAL }))
      .checks.chapter_design_state_unchanged,
    false,
  );
  assert.equal(
    compareRevisionDesignSnapshots(before, before).checks.action_receipt_added_once,
    false,
  );
});

test("章 seq/confidence 边界与缺失 chapter_mission 的 map 语义", () => {
  for (const seq of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => chapterSnapshot({ planDirection: { chapter_role: "开篇" }, overrides: { seq } }),
      /invalid_authoring_canon_snapshot/,
      String(seq),
    );
  }
  for (const confidence of [0, 1]) {
    const value = chapterSnapshot({ planDirection: { chapter_mission: mission({ confidence }) } });
    assert.equal(value.chapters["chapter-row"].mission.confidence, confidence);
  }
  for (const confidence of [-0.1, 1.1, Number.NaN, "0.9"]) {
    assert.throws(
      () => chapterSnapshot({ planDirection: { chapter_mission: mission({ confidence }) } }),
      /invalid_authoring_canon_snapshot/,
      String(confidence),
    );
  }
  assert.equal(chapterSnapshot({ planDirection: {} }).chapters["chapter-row"].mission, null);
  assert.equal(
    chapterSnapshot({ planDirection: { chapter_mission: null } }).chapters["chapter-row"].mission,
    null,
  );
});

test("source 段：其它表同计数改内容、其它章 updated_at、章增删、非目标 mission 都失败", () => {
  const base = chapterSnapshot({ planDirection: { chapter_role: "开篇" } });

  const draftTables = baseTables();
  draftTables.drafts[0].content = "被改写";
  const draftChanged = snapshot({ tables: draftTables, at: FINAL });
  assert.equal(
    compareSourceDesignSnapshots(base, draftChanged, { targetChapterId: "chapter-row" })
      .checks.canon_unchanged_except_chapter_mission,
    false,
  );

  const secondTables = baseTables();
  secondTables.chapters.push(chapterRow({ id: "chapter-2", seq: 2, title: "第二章" }));
  const secondStart = snapshot({ tables: secondTables, at: START });
  const secondUpdatedTables = structuredClone(secondTables);
  secondUpdatedTables.chapters[1].updated_at = FINAL;
  assert.equal(
    compareSourceDesignSnapshots(secondStart, snapshot({ tables: secondUpdatedTables, at: FINAL }), {
      targetChapterId: "chapter-row",
    }).checks.chapter_mission_change_is_legal,
    false,
  );
  const secondMissionTables = structuredClone(secondTables);
  secondMissionTables.chapters[1].plan_direction = JSON.stringify({ chapter_mission: mission({ derived_at: FINAL }) });
  secondMissionTables.chapters[1].updated_at = FINAL;
  assert.equal(
    compareSourceDesignSnapshots(secondStart, snapshot({ tables: secondMissionTables, at: FINAL }), {
      targetChapterId: "chapter-row",
    }).checks.chapter_mission_change_is_legal,
    false,
  );

  const addedTables = structuredClone(baseTables());
  addedTables.chapters.push(chapterRow({ id: "chapter-new", seq: 2 }));
  assert.equal(
    compareSourceDesignSnapshots(base, snapshot({ tables: addedTables, at: FINAL }), {
      targetChapterId: "chapter-row",
    }).checks.chapter_mission_change_is_legal,
    false,
  );
  const removedTables = structuredClone(baseTables());
  removedTables.chapters = [];
  assert.equal(
    compareSourceDesignSnapshots(base, snapshot({ tables: removedTables, at: FINAL }), {
      targetChapterId: "chapter-row",
    }).checks.chapter_mission_change_is_legal,
    false,
  );
});

test("source 段：mission 时间因果边界逐项关闭", () => {
  const start = chapterSnapshot({ at: START, planDirection: { chapter_role: "开篇" } });
  const cases = [
    [{ derived_at: START, updated_at: FINAL }, true],
    [{ derived_at: FINAL, updated_at: FINAL }, true],
    [{ derived_at: "2026-11-01T07:59:59.999999Z", updated_at: FINAL }, false],
    [{ derived_at: "2026-11-01T08:00:10.000001Z", updated_at: FINAL }, false],
    [{ derived_at: FINAL, updated_at: "2026-11-01T08:00:09.999999Z" }, false],
    [{ derived_at: FINAL, updated_at: "2026-11-01T08:00:10.000001Z" }, false],
  ];
  for (const [{ derived_at, updated_at }, expected] of cases) {
    const before = chapterSnapshot({
      at: FINAL,
      updatedAt: updated_at,
      planDirection: { chapter_role: "开篇", chapter_mission: mission({ derived_at }) },
    });
    assert.equal(
      compareSourceDesignSnapshots(start, before, { targetChapterId: "chapter-row" })
        .checks.chapter_mission_change_is_legal,
      expected,
      JSON.stringify({ derived_at, updated_at }),
    );
  }
  const measured = compareSourceDesignSnapshots(start, chapterSnapshot({
    at: FINAL,
    updatedAt: FINAL,
    planDirection: { chapter_role: "开篇", chapter_mission: mission({ derived_at: FINAL }) },
  }), { targetChapterId: "chapter-row" }).measured;
  assert.equal(measured.chapter_design_changes[0].before_mission_id, null);
  assert.equal(measured.chapter_design_changes[0].after_mission_id, "cm_test_1");
  assert.equal(measured.chapter_design_changes[0].after_mission_status, "TENTATIVE");
});

test("source 段：目标章 id 为空时 measured 保留空串；混合 v1/v2 仍拒绝", () => {
  const start = chapterSnapshot({ planDirection: { chapter_role: "开篇" } });
  const before = chapterSnapshot({ at: FINAL, updatedAt: FINAL, planDirection: { chapter_role: "开篇" } });
  const value = compareSourceDesignSnapshots(start, before, { targetChapterId: "" });
  assert.equal(value.measured.target_chapter_id, "");
  const legacy = structuredClone(start);
  legacy.version = LEGACY_SNAPSHOT_VERSION;
  delete legacy.chapters;
  assert.throws(
    () => compareSourceDesignSnapshots(legacy, before, { targetChapterId: "chapter-row" }),
    /version 2/,
  );
  assert.throws(
    () => compareSourceDesignSnapshots(start, legacy, { targetChapterId: "chapter-row" }),
    /version 2/,
  );
});

test("revision 段：章增删或 mission 变化都让设计态不变检查失败", () => {
  const beforeTables = baseTables();
  beforeTables.chapters[0].plan_direction = JSON.stringify({ chapter_mission: mission() });
  const before = snapshot({ tables: beforeTables, at: START });
  const addTables = structuredClone(beforeTables);
  addTables.chapters.push(chapterRow({ id: "chapter-2", seq: 2 }));
  addTables.author_action_receipts.push({ id: "receipt-row-2", action: "revise_from_findings" });
  assert.equal(
    compareRevisionDesignSnapshots(before, snapshot({ tables: addTables, at: FINAL }))
      .checks.chapter_design_state_unchanged,
    false,
  );
  const updatedTables = structuredClone(beforeTables);
  updatedTables.chapters[0].updated_at = FINAL;
  updatedTables.author_action_receipts.push({ id: "receipt-row-2", action: "revise_from_findings" });
  assert.equal(
    compareRevisionDesignSnapshots(before, snapshot({ tables: updatedTables, at: FINAL }))
      .checks.chapter_design_state_unchanged,
    false,
  );
});

test("plan_direction JSON null 与同计数的表内容/章 id 替换均按边界关闭", () => {
  const tables = baseTables();
  tables.chapters[0].plan_direction = "null";
  const nullPlan = snapshot({ tables });
  assert.equal(nullPlan.chapters["chapter-row"].mission, null);

  const base = chapterSnapshot({ planDirection: { chapter_role: "开篇" } });
  const renamedTables = baseTables();
  renamedTables.chapters = [chapterRow({ id: "chapter-2", seq: 1, title: "第一章" })];
  const renamed = snapshot({ tables: renamedTables, at: FINAL });
  assert.equal(
    compareSourceDesignSnapshots(base, renamed, { targetChapterId: "chapter-row" })
      .checks.chapter_mission_change_is_legal,
    false,
  );
  const beforeTables = baseTables();
  beforeTables.chapters[0].plan_direction = JSON.stringify({ chapter_mission: mission() });
  const before = snapshot({ tables: beforeTables, at: START });
  const renamedRevisionTables = baseTables();
  renamedRevisionTables.chapters = [chapterRow({ id: "chapter-2", seq: 1, title: "第一章" })];
  renamedRevisionTables.author_action_receipts.push({ id: "receipt-row-2", action: "revise_from_findings" });
  assert.equal(
    compareRevisionDesignSnapshots(before, snapshot({ tables: renamedRevisionTables, at: FINAL }))
      .checks.chapter_design_state_unchanged,
    false,
  );
});


test("行排序使用 locale 无关的确定性字符串序，且 hash 与逐字有序行一致", () => {
  const rows = [
    { id: "row-b", value: 2 },
    { id: "row-a", value: 1 },
    { id: "row-d", value: 4 },
    { id: "row-c", value: 3 },
    { id: "row-é", value: 5 },
    { id: "row-Z", value: 6 },
  ];
  const shuffled = [...rows].reverse();
  const value = snapshot({ tables: { ...baseTables(), works: shuffled } });
  const ordered = [...rows].sort((left, right) => (left.id < right.id ? -1 : 1));
  assert.equal(
    value.tables.works.rows_sha256,
    createHash("sha256").update(JSON.stringify(ordered)).digest("hex"),
  );
  assert.equal(value.tables.works.rows_sha256, snapshot({
    tables: { ...baseTables(), works: rows },
  }).tables.works.rows_sha256);
});

test("source 段：receipt 同计数但内容变化仍算 canon 写入", () => {
  const startTables = baseTables();
  const start = snapshot({ tables: startTables, at: START });
  const changedTables = structuredClone(startTables);
  changedTables.author_action_receipts[0].action = "discard_artifact";
  const changed = snapshot({ tables: changedTables, at: FINAL });
  assert.equal(
    compareSourceDesignSnapshots(start, changed, { targetChapterId: "chapter-row" })
      .checks.author_action_receipts_unchanged,
    false,
  );
});

test("source 段：目标章 mission/updated_at 均未变时不产出设计变更", () => {
  const planDirection = { chapter_role: "开篇", chapter_mission: mission() };
  const start = chapterSnapshot({ at: START, planDirection, updatedAt: START });
  const before = chapterSnapshot({ at: FINAL, planDirection, updatedAt: START });
  const value = compareSourceDesignSnapshots(start, before, { targetChapterId: "chapter-row" });
  assert.equal(value.checks.chapter_mission_change_is_legal, true);
  assert.deepEqual(value.measured.chapter_design_changes, []);
});

test("revision 段：排序在末尾的新增章仍必须让设计态不变检查失败", () => {
  const beforeTables = baseTables();
  beforeTables.author_action_receipts.push({ id: "receipt-row-2", action: "revise_from_findings" });
  const before = snapshot({ tables: beforeTables, at: START });
  const addedTables = structuredClone(baseTables());
  addedTables.chapters.push(chapterRow({ id: "chapter-z", seq: 2, title: "末尾新增章" }));
  addedTables.author_action_receipts.push({ id: "receipt-row-2", action: "revise_from_findings" });
  assert.equal(
    compareRevisionDesignSnapshots(before, snapshot({ tables: addedTables, at: FINAL }))
      .checks.chapter_design_state_unchanged,
    false,
  );
});

test("revision 段：plan_direction 仅 JSON 空白变化也按 raw 章行变化关闭", () => {
  const beforeTables = baseTables();
  beforeTables.chapters[0].plan_direction = JSON.stringify({ chapter_role: "开篇", chapter_mission: mission() });
  const before = snapshot({ tables: beforeTables, at: START });
  const finalTables = structuredClone(beforeTables);
  finalTables.chapters[0].plan_direction = finalTables.chapters[0].plan_direction.replace(",", ", ");
  finalTables.author_action_receipts.push({ id: "receipt-row-2", action: "revise_from_findings" });
  const final = snapshot({ tables: finalTables, at: FINAL });
  assert.deepEqual(
    final.chapters["chapter-row"].mission,
    before.chapters["chapter-row"].mission,
  );
  assert.equal(
    compareRevisionDesignSnapshots(before, final).checks.chapter_design_state_unchanged,
    false,
  );
});

test("source 段：mission 写入与章 updated_at 同一时刻仍按时间因果合法", () => {
  const start = chapterSnapshot({ at: START, planDirection: { chapter_role: "开篇" } });
  const before = chapterSnapshot({
    at: FINAL,
    updatedAt: START,
    planDirection: { chapter_role: "开篇", chapter_mission: mission({ derived_at: START }) },
  });
  assert.equal(
    compareSourceDesignSnapshots(start, before, { targetChapterId: "chapter-row" })
      .checks.chapter_mission_change_is_legal,
    true,
  );
});

test("source 段：目标章改 mission 时其它章保持不变仍是合法源段", () => {
  const startTables = baseTables();
  startTables.chapters.push(chapterRow({ id: "chapter-2", seq: 2, title: "第二章" }));
  const start = snapshot({ tables: startTables, at: START });
  const beforeTables = structuredClone(startTables);
  beforeTables.chapters[0].plan_direction = JSON.stringify({ chapter_role: "开篇", chapter_mission: mission({ derived_at: FINAL }) });
  beforeTables.chapters[0].updated_at = FINAL;
  const value = compareSourceDesignSnapshots(
    start,
    snapshot({ tables: beforeTables, at: FINAL }),
    { targetChapterId: "chapter-row" },
  );
  assert.equal(value.checks.chapter_mission_change_is_legal, true);
  assert.equal(value.measured.chapter_design_changes.length, 1);
});

test("revision 段：章设计态键集合与表行数不一致时失败关闭", () => {
  const tables = baseTables();
  tables.author_action_receipts.push({ id: "receipt-row-2", action: "revise_from_findings" });
  const before = snapshot({ tables: baseTables(), at: START });
  const final = snapshot({ tables, at: FINAL });
  final.chapters = { "chapter-ghost": final.chapters["chapter-row"] };
  assert.equal(
    compareRevisionDesignSnapshots(before, final).checks.chapter_design_state_unchanged,
    false,
  );
});

test("works 的 canon hash 只排除最近打开时钟 updated_at，其它作品事实列仍纳入", () => {
  const start = snapshot();
  const opened = baseTables();
  opened.works[0].updated_at = "2026-11-01T09:00:00.000000Z";
  const reopened = snapshot({ tables: opened, at: FINAL });
  // 真实 restore/channel join 的 WorkRepo.touch 只推进 updated_at：不算 canon 写入。
  assert.equal(start.tables.works.canon_sha256, reopened.tables.works.canon_sha256);
  assert.notEqual(start.tables.works.rows_sha256, reopened.tables.works.rows_sha256);
  for (const [column, value] of [
    ["title", "被改写的标题"],
    ["status", "ACCEPTED"],
    ["revision", 2],
    ["main_goal", "新目标"],
    ["future_column", "changed-unknown-column"],
  ]) {
    const tables = baseTables();
    tables.works[0][column] = value;
    assert.notEqual(start.tables.works.canon_sha256, snapshot({ tables }).tables.works.canon_sha256, column);
  }
});
