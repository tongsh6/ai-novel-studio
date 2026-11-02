// B71 计划/修订批次的 canon、章设计态与引用证据纯函数。
//
// 输入只来自只读 DB 的 9 张 canon 表完整行与 memory_reference_logs 归一化行；
// 本模块不做 I/O、不读时钟、不依赖机器时区。canon、章设计态与引用统计是三类事实：
// - no_canon_write：9 表行数/ canon hash 不变；memory_items 只排除两个引用统计列。
// - 章设计态：v2 快照逐章保存 protected 字段 hash、真实 mission 与 updated_at；
//   chapters 完整行 hash 仍原义保留，不以设计态见证替换整表 hash。
// - memory_reference_updates_accounted：统计增量与新增 dialogue_context 引用日志精确对应。
//
// 版本迁移：v1 只读仍严格解析，但绝不为修订两段补造章设计态；需要设计态见证的
// 比较只接受 v2，缺/坏/歧义字段一律 fail closed。SQLite 的 JSON 列（plan_direction）
// 只在该列按真实 map 语义解析，其它字符串字段保持原字节；UUID/BLOB/UTC 沿用既有边界。
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const SNAPSHOT_VERSION = 2;
export const LEGACY_SNAPSHOT_VERSION = 1;
export const CANON_TABLES = Object.freeze([
  "works",
  "drafts",
  "chapters",
  "volumes",
  "scenes",
  "characters",
  "memory_items",
  "ledger_entries",
  "author_action_receipts",
]);
const OPS_COLUMNS = Object.freeze(["reference_count", "last_referenced_at"]);
const HEX64 = /^[0-9a-f]{64}$/u;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})?$/u;
const MISSION_KEYS = Object.freeze([
  "confidence",
  "decided_at",
  "derived_at",
  "mission_id",
  "must_advance",
  "must_avoid",
  "provider_call_ref",
  "source",
  "statement",
  "status",
]);
const MISSION_ITEM_KEYS = Object.freeze(["basis_label", "basis_ref", "text"]);
const MODEL_SOURCE = "model";
const AUTHOR_SOURCE = "author";
const TENTATIVE = "TENTATIVE";
const AUTHOR_STATUSES = Object.freeze(["CONFIRMED", "AUTHOR_EDITED"]);;

function invalid(path, expected) {
  throw new TypeError(`invalid_authoring_canon_snapshot: ${path} must be ${expected}`);
}

function invalidTime(value) {
  throw new TypeError(`invalid_utc_timestamp: ${JSON.stringify(value)}`);
}

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array);
const hasOwn = (value, key) => Object.hasOwn(value, key);

function requireRecord(value, path) {
  if (!isRecord(value)) invalid(path, "an object");
  return value;
}

function requireArray(value, path) {
  if (!Array.isArray(value)) invalid(path, "an array");
  return value;
}

function requireString(value, path) {
  if (typeof value !== "string") invalid(path, "a string");
  return value;
}

function requireOwn(record, key, path) {
  if (!hasOwn(record, key)) invalid(`${path}.${key}`, "present");
  return record[key];
}

function requireCount(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(path, "a non-negative safe integer");
  return value;
}

function requireHash(value, path) {
  if (typeof value !== "string" || !HEX64.test(value)) invalid(path, "a lowercase sha256 hex string");
  return value;
}

function formatUuid(hex) {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uuidFromHex(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{32}$/iu.test(value)) {
    throw new TypeError(`invalid_uuid: ${JSON.stringify(value)}`);
  }
  return formatUuid(value.toLowerCase());
}

function canonicalUuid(value, path) {
  if (value instanceof Uint8Array) {
    if (value.byteLength !== 16) invalid(path, "16 bytes");
    return uuidFromHex(Buffer.from(value).toString("hex"));
  }
  if (typeof value !== "string") invalid(path, "a UUID string or 16-byte UUID");
  const hex = value.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/iu.test(hex)) invalid(path, "a UUID");
  return uuidFromHex(hex);
}

function optionalUuid(value, path) {
  return value == null ? null : canonicalUuid(value, path);
}

// 快照必须可 JSON 往返；BLOB 只作为带类型标记的十六进制，避免丢字节或依赖对象 stringify 行为。
function jsonSafe(value, path) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid(path, "a finite number");
    return value;
  }
  if (value instanceof Uint8Array) return { $blob: Buffer.from(value).toString("hex") };
  if (Array.isArray(value)) return value.map((item, index) => jsonSafe(item, `${path}[${index}]`));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, jsonSafe(value[key], `${path}.${key}`)]),
    );
  }
  invalid(path, "a JSON-safe SQLite value");
}

// jsonSafe 已在入口对每个对象按键排序，canonicalJson 只需稳定序列化。
const canonicalJson = (value) => JSON.stringify(value);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function timestampParts(value) {
  if (typeof value !== "string") invalidTime(value);
  const match = TIMESTAMP.exec(value);
  if (!match) invalidTime(value);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "", zone] = match;
  const parts = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: Number(secondText),
    fraction,
    zone,
  };
  // 月/日/时/分/秒的溢出交给 Date 的日历回卷检测；微秒安全整数边界在最终解析处统一校验。
  return parts;
}

function calendarMicroseconds(parts, value) {
  const milliseconds = Date.UTC(
    parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second,
  );
  const expected = `${parts.year}-${String(parts.month).padStart(2, "0")}-` +
    `${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:` +
    `${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}`;
  // 任一日历字段越界都会让 Date 回卷到别的日期，ISO 前缀即不再匹配。
  if (!new Date(milliseconds).toISOString().startsWith(expected)) invalidTime(value);
  return (milliseconds * 1000) + Number(parts.fraction.padEnd(6, "0"));
}

function zoneOffsetMicroseconds(zone, value) {
  if (!zone || zone === "Z") return 0;
  const sign = zone.startsWith("+") ? 1 : -1;
  const [hour, minute] = zone.slice(1).split(":").map(Number);
  if (hour > 23 || minute > 59) invalidTime(value);
  return sign * ((hour * 60) + minute) * 60 * 1_000_000;
}

export function parseUtcTimestamp(value) {
  const parts = timestampParts(value);
  const microseconds = calendarMicroseconds(parts, value) - zoneOffsetMicroseconds(parts.zone, value);
  if (!Number.isSafeInteger(microseconds)) invalidTime(value);
  return microseconds;
}

function normalizedRows(value, table) {
  const path = `tables.${table}`;
  const rows = requireArray(value, path).map((row, index) => {
    const safe = jsonSafe(row, `${path}[${index}]`);
    if (!isRecord(safe) || typeof safe.id !== "string" || safe.id === "") {
      invalid(`${path}[${index}]`, "a row with a non-empty string id");
    }
    return safe;
  });
  const ids = new Set(rows.map((row) => row.id));
  if (ids.size !== rows.length) invalid(path, "rows with unique ids");
  // id 已唯一；用内建字符串排序（UTF-16 code unit，locale 无关）消去两路比较分支。
  const byId = new Map(rows.map((row) => [row.id, row]));
  return [...byId.keys()].sort().map((id) => byId.get(id));
}

// 每个 canon 表在 canon_sha256 中排除的“运行账面列”（rows_sha256 仍保留全行原字节）：
// - memory_items：引用计数/最近引用时间由读取投影维护，不是作者创作事实；
// - works.updated_at：WorkspaceChannel.join 的「最近打开」时钟（WorkService.mark_opened
//   → WorkRepo.touch），真实 restore/重连必然推进；它不是作品事实，作品内容/状态列仍
//   全部纳入。
const BOOKKEEPING_COLUMNS = Object.freeze({
  memory_items: Object.freeze(["reference_count", "last_referenced_at"]),
  works: Object.freeze(["updated_at"]),
});

function canonRows(rows, table) {
  const columns = BOOKKEEPING_COLUMNS[table];
  if (!columns) return rows;
  return rows.map((row) => {
    const projected = { ...row };
    for (const column of columns) delete projected[column];
    return projected;
  });
}

function rowHashes(rows, table) {
  const rowsHash = sha256(canonicalJson(rows));
  if (!BOOKKEEPING_COLUMNS[table]) return { rows_sha256: rowsHash, canon_sha256: rowsHash };
  return {
    rows_sha256: rowsHash,
    canon_sha256: sha256(canonicalJson(canonRows(rows, table))),
  };
}

// ── v2 章设计态见证 ─────────────────────────────────────

function requirePositiveInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(path, "a positive safe integer");
  return value;
}

function requireNaturalNumber(value, path) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    invalid(path, "a number between 0 and 1");
  }
  return value;
}

function requireTimestamp(value, path) {
  requireString(value, path);
  parseUtcTimestamp(value);
  return value;
}

function optionalString(record, key, path) {
  if (!hasOwn(record, key)) return null;
  const value = record[key];
  if (value === null) return null;
  requireString(value, `${path}.${key}`);
  if (value.trim() === "") invalid(`${path}.${key}`, "a non-empty string");
  return value;
}

function rejectUnknownKeys(record, allowed, path) {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) invalid(`${path}.${key}`, "a known mission field");
  }
}

function missionItem(value, path, source) {
  const item = requireRecord(value, path);
  rejectUnknownKeys(item, MISSION_ITEM_KEYS, path);
  const text = requireString(requireOwn(item, "text", path), `${path}.text`);
  if (text.trim() === "") invalid(`${path}.text`, "a non-empty string");
  const basisRef = optionalString(item, "basis_ref", path);
  const basisLabel = optionalString(item, "basis_label", path);
  if (source === MODEL_SOURCE && (basisRef === null || basisLabel === null)) {
    invalid(path, "a model mission item with basis_ref and basis_label");
  }
  return {
    text,
    ...(basisRef === null ? {} : { basis_ref: basisRef }),
    ...(basisLabel === null ? {} : { basis_label: basisLabel }),
  };
}

function missionItems(value, path, source) {
  return requireArray(value, path).map((item, index) =>
    missionItem(item, `${path}[${index}]`, source));
}

function missionIdentity(record, path) {
  const missionId = requireString(requireOwn(record, "mission_id", path), `${path}.mission_id`);
  const statement = requireString(requireOwn(record, "statement", path), `${path}.statement`);
  if (missionId.trim() === "") invalid(`${path}.mission_id`, "a non-empty string");
  if (statement.trim() === "") invalid(`${path}.statement`, "a non-empty string");
  return { missionId, statement };
}

function missionStatus(record, path) {
  const status = requireString(requireOwn(record, "status", path), `${path}.status`);
  const source = requireString(requireOwn(record, "source", path), `${path}.source`);
  if (status === TENTATIVE && source === MODEL_SOURCE) return { status, source };
  if (AUTHOR_STATUSES.includes(status) && source === AUTHOR_SOURCE) return { status, source };
  invalid(`${path}.status`, "TENTATIVE/model or CONFIRMED|AUTHOR_EDITED/author");
}

function modelMissionShape(record, path) {
  return {
    provider_call_ref: requireString(
      requireOwn(record, "provider_call_ref", path),
      `${path}.provider_call_ref`,
    ),
    derived_at: requireTimestamp(requireOwn(record, "derived_at", path), `${path}.derived_at`),
    confidence: requireNaturalNumber(requireOwn(record, "confidence", path), `${path}.confidence`),
  };
}

function optionalField(record, key, path, validate) {
  if (!hasOwn(record, key)) return {};
  return { [key]: validate(record[key], `${path}.${key}`) };
}

function authorMissionShape(record, path) {
  return {
    decided_at: requireTimestamp(requireOwn(record, "decided_at", path), `${path}.decided_at`),
    ...optionalField(record, "derived_at", path, requireTimestamp),
    ...optionalField(record, "confidence", path, requireNaturalNumber),
  };
}

export function parseMission(value, path = "mission") {
  if (value === null || value === undefined) return null;
  const record = requireRecord(value, path);
  rejectUnknownKeys(record, MISSION_KEYS, path);
  const { missionId, statement } = missionIdentity(record, path);
  const { status, source } = missionStatus(record, path);
  const sourceFields = source === MODEL_SOURCE
    ? modelMissionShape(record, path)
    : authorMissionShape(record, path);
  return {
    mission_id: missionId,
    statement,
    must_advance: missionItems(requireOwn(record, "must_advance", path), `${path}.must_advance`, source),
    must_avoid: missionItems(requireOwn(record, "must_avoid", path), `${path}.must_avoid`, source),
    status,
    source,
    ...sourceFields,
  };
}

function parsePlanDirection(value, path) {
  if (value === null) return null;
  if (typeof value !== "string") invalid(path, "a JSON object string or null");
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    invalid(path, "valid JSON");
  }
  if (parsed === null) return null;
  return requireRecord(parsed, path);
}

function chapterMission(planDirection, path) {
  if (planDirection === null || !hasOwn(planDirection, "chapter_mission")) return null;
  const value = planDirection.chapter_mission;
  if (value === null) return null;
  // 空对象由 parseMission 的必填字段边界拒绝，不再维护第二套“非空”判据。
  return parseMission(value, `${path}.chapter_mission`);
}

function protectedFields(row, planDirection, path) {
  const protectedRow = { ...row, plan_direction: planDirection };
  delete protectedRow.updated_at;
  if (isRecord(planDirection)) {
    protectedRow.plan_direction = { ...planDirection };
    delete protectedRow.plan_direction.chapter_mission;
  }
  return sha256(canonicalJson(jsonSafe(protectedRow, path)));
}

function chapterFact(row, path) {
  const id = requireOwn(row, "id", path);
  requireString(id, `${path}.id`);
  if (id === "") invalid(`${path}.id`, "a non-empty string");
  const planDirection = parsePlanDirection(requireOwn(row, "plan_direction", path), `${path}.plan_direction`);
  return {
    work_id: canonicalUuid(requireOwn(row, "work_id", path), `${path}.work_id`),
    seq: requirePositiveInteger(requireOwn(row, "seq", path), `${path}.seq`),
    title: requireString(requireOwn(row, "title", path), `${path}.title`),
    status: requireString(requireOwn(row, "status", path), `${path}.status`),
    updated_at: requireTimestamp(requireOwn(row, "updated_at", path), `${path}.updated_at`),
    protected_sha256: protectedFields(row, planDirection, path),
    mission: chapterMission(planDirection, path),
  };
}

function chapterFacts(rows) {
  const facts = {};
  for (const [index, row] of rows.entries()) {
    const path = `tables.chapters[${index}]`;
    const fact = chapterFact(row, path);
    if (hasOwn(facts, row.id)) invalid(`${path}.id`, "unique across chapters");
    facts[row.id] = fact;
  }
  return facts;
}

function parseChapterFact(id, value, path) {
  const record = requireRecord(value, path);
  const mission = hasOwn(record, "mission") ? parseMission(record.mission, `${path}.mission`) : undefined;
  if (mission === undefined) invalid(`${path}.mission`, "present");
  return {
    work_id: canonicalUuid(requireOwn(record, "work_id", path), `${path}.work_id`),
    seq: requirePositiveInteger(requireOwn(record, "seq", path), `${path}.seq`),
    title: requireString(requireOwn(record, "title", path), `${path}.title`),
    status: requireString(requireOwn(record, "status", path), `${path}.status`),
    updated_at: requireTimestamp(requireOwn(record, "updated_at", path), `${path}.updated_at`),
    protected_sha256: requireHash(requireOwn(record, "protected_sha256", path), `${path}.protected_sha256`),
    mission,
  };
}

function parseChapters(value, expectedRows) {
  const source = requireRecord(value, "chapters");
  const ids = Object.keys(source);
  if (ids.length !== expectedRows) invalid("chapters", "one design-state entry per chapters row");
  const chapters = {};
  for (const id of ids) {
    if (id === "") invalid("chapters", "non-empty chapter ids");
    chapters[id] = parseChapterFact(id, source[id], `chapters.${id}`);
  }
  return chapters;
}

function isTentativeModel(mission) {
  // v2 mission 边界已保证 TENTATIVE 只与 model 源配对，单一状态判据即可。
  return mission?.status === TENTATIVE;
}

// memory 统计的字段校验只在唯一边界实现一次；构建快照与解析快照共用。
function memoryStat(idValue, source, path) {
  const id = canonicalUuid(idValue, `${path}.id`);
  const workId = canonicalUuid(requireOwn(source, "work_id", path), `${path}.work_id`);
  const referenceCount = requireCount(requireOwn(source, "reference_count", path), `${path}.reference_count`);
  const lastReferencedAt = requireOwn(source, "last_referenced_at", path);
  if (lastReferencedAt !== null) {
    requireString(lastReferencedAt, `${path}.last_referenced_at`);
    parseUtcTimestamp(lastReferencedAt);
  }
  return {
    id,
    stat: {
      work_id: workId,
      reference_count: referenceCount,
      last_referenced_at: lastReferencedAt,
    },
  };
}

function memoryStats(rows) {
  const stats = {};
  for (const [index, row] of rows.entries()) {
    const path = `tables.memory_items[${index}]`;
    const { id, stat } = memoryStat(requireOwn(row, "id", path), row, path);
    if (hasOwn(stats, id)) invalid(`${path}.id`, "unique across memory_items");
    stats[id] = stat;
  }
  return stats;
}

function normalizeLogRow(value, index) {
  const path = `memory_reference_logs[${index}]`;
  const raw = requireRecord(value, path);
  const row = jsonSafe(raw, path);
  const field = (key) => requireOwn(raw, key, path);
  const scene = requireString(field("reference_scene"), `${path}.reference_scene`);
  if (scene.trim() === "") invalid(`${path}.reference_scene`, "a non-empty string");
  const reason = field("reference_reason");
  if (reason !== null && typeof reason !== "string") invalid(`${path}.reference_reason`, "a string or null");
  const insertedAt = requireString(field("inserted_at"), `${path}.inserted_at`);
  const time = parseUtcTimestamp(insertedAt);
  // 未知列原样保留并进入旧日志逐字比较；只有已知 id 字段做 UUID 归一。
  return {
    time,
    log: {
      ...row,
      id: canonicalUuid(field("id"), `${path}.id`),
      memory_id: canonicalUuid(field("memory_id"), `${path}.memory_id`),
      work_id: canonicalUuid(field("work_id"), `${path}.work_id`),
      task_id: optionalUuid(field("task_id"), `${path}.task_id`),
      conversation_id: optionalUuid(field("conversation_id"), `${path}.conversation_id`),
      reference_scene: scene,
      reference_reason: reason,
      inserted_at: insertedAt,
    },
  };
}

function normalizedLogs(value) {
  const records = requireArray(value, "memory_reference_logs")
    .map((row, index) => normalizeLogRow(row, index));
  const ids = new Set(records.map(({ log }) => log.id));
  if (ids.size !== records.length) invalid("memory_reference_logs", "rows with unique ids");
  // 先按唯一 id 做 locale 无关的全序，再以稳定排序按时刻分层；同一时刻保留 id 顺序。
  const byId = new Map(records.map((record) => [record.log.id, record]));
  const ordered = [...byId.keys()].sort().map((id) => byId.get(id));
  ordered.sort((left, right) => left.time - right.time);
  return ordered.map(({ log }) => log);
}

// includeChapterFacts=false 只服务 live 实模场景：L9 只需要表级内容签名，不需要
// 章节设计态逐字段见证；真实 b71-first-consumer seed 的 chapter_mission 可能缺
// decided_at 等设计态字段，不能为了 live 快照伪造或修改 seed。默认 true，planning/
// revision 的严格解析不变。
export function buildAuthoringCanonSnapshot({ tables, referenceLogs, at, includeChapterFacts = true } = {}) {
  const source = requireRecord(tables, "tables");
  const snapshotAt = requireString(at, "at");
  parseUtcTimestamp(snapshotAt);
  const snapshotTables = {};
  let memoryRows = [];
  let chapterRows = [];
  for (const table of CANON_TABLES) {
    const rows = normalizedRows(source[table], table);
    if (table === "memory_items") memoryRows = rows;
    if (table === "chapters") chapterRows = rows;
    const hashes = rowHashes(rows, table);
    snapshotTables[table] = {
      row_count: rows.length,
      rows_sha256: hashes.rows_sha256,
      canon_sha256: hashes.canon_sha256,
    };
  }
  return {
    version: SNAPSHOT_VERSION,
    at: snapshotAt,
    tables: snapshotTables,
    chapters: includeChapterFacts ? chapterFacts(chapterRows) : {},
    memory_items: memoryStats(memoryRows),
    memory_reference_logs: normalizedLogs(referenceLogs),
  };
}

function parseSnapshotTables(value) {
  const tables = requireRecord(value, "tables");
  const parsed = {};
  for (const table of CANON_TABLES) {
    const path = `tables.${table}`;
    const record = requireRecord(tables[table], path);
    const rowCount = requireCount(record.row_count, `${path}.row_count`);
    const rowsHash = requireHash(record.rows_sha256, `${path}.rows_sha256`);
    const canonHash = requireHash(record.canon_sha256, `${path}.canon_sha256`);
    if (!BOOKKEEPING_COLUMNS[table] && rowsHash !== canonHash) {
      invalid(`${path}.canon_sha256`, "equal to rows_sha256 for non-bookkeeping canon tables");
    }
    parsed[table] = { row_count: rowCount, rows_sha256: rowsHash, canon_sha256: canonHash };
  }
  return parsed;
}

function parseMemoryStats(value, expectedRows) {
  const source = requireRecord(value, "memory_items");
  const stats = {};
  for (const key of Object.keys(source)) {
    const path = `memory_items.${key}`;
    const record = requireRecord(source[key], path);
    const { id, stat } = memoryStat(key, record, path);
    if (id !== key) invalid(path, "a canonical lowercase UUID key");
    stats[id] = stat;
  }
  if (Object.keys(stats).length !== expectedRows) {
    invalid("memory_items", "one statistic entry per memory_items row");
  }
  return stats;
}

function parseSnapshot(value, label) {
  const snapshot = requireRecord(value, label);
  if (snapshot.version !== SNAPSHOT_VERSION && snapshot.version !== LEGACY_SNAPSHOT_VERSION) {
    invalid(`${label}.version`, `the integer ${LEGACY_SNAPSHOT_VERSION} or ${SNAPSHOT_VERSION}`);
  }
  const at = requireString(snapshot.at, `${label}.at`);
  parseUtcTimestamp(at);
  const tables = parseSnapshotTables(snapshot.tables);
  const chapters = snapshot.version === SNAPSHOT_VERSION
    ? parseChapters(snapshot.chapters, tables.chapters.row_count)
    : null;
  const memoryItems = parseMemoryStats(snapshot.memory_items, tables.memory_items.row_count);
  const logs = normalizedLogs(snapshot.memory_reference_logs);
  return {
    version: snapshot.version,
    at,
    tables,
    chapters,
    memory_items: memoryItems,
    memory_reference_logs: logs,
  };
}

function sameTableCanon(start, final) {
  return CANON_TABLES.every((table) =>
    start.tables[table].row_count === final.tables[table].row_count &&
    start.tables[table].canon_sha256 === final.tables[table].canon_sha256);
}

function sameMemoryIdentity(start, final) {
  const startIds = Object.keys(start.memory_items).sort();
  const finalIds = Object.keys(final.memory_items).sort();
  return startIds.length === finalIds.length &&
    startIds.every((id, index) => id === finalIds[index]) &&
    startIds.every((id) => final.memory_items[id].work_id === start.memory_items[id].work_id);
}

function newLogsByMemory(start, final) {
  const oldIds = new Set(start.memory_reference_logs.map((log) => log.id));
  const added = final.memory_reference_logs.filter((log) => !oldIds.has(log.id));
  const byMemory = new Map(Object.keys(start.memory_items).map((id) => [id, []]));
  for (const log of added) {
    const logs = byMemory.get(log.memory_id);
    if (logs) logs.push(log);
    else byMemory.set(log.memory_id, [log]);
  }
  return { added, byMemory };
}

function oldLogsPreserved(start, final) {
  const finalById = new Map(final.memory_reference_logs.map((log) => [log.id, log]));
  return start.memory_reference_logs.every((log) =>
    finalById.has(log.id) && isDeepStrictEqual(finalById.get(log.id), log));
}

function validDialogueReason(reason) {
  return typeof reason === "string" &&
    (reason === "dialogue context recall" ||
      /^dialogue recall matched author input: .+$/u.test(reason));
}

function validNewLog(log, start, startAt, finalAt) {
  const memory = start.memory_items[log.memory_id];
  const insertedAt = parseUtcTimestamp(log.inserted_at);
  return Boolean(memory) &&
    log.work_id === memory.work_id &&
    log.reference_scene === "dialogue_context" &&
    validDialogueReason(log.reference_reason) &&
    insertedAt >= startAt && insertedAt <= finalAt;
}

function nextLastReferenceValid(before, after, logs, finalAt) {
  if (logs.length === 0) return after.last_referenced_at === before.last_referenced_at;
  if (after.last_referenced_at === null) return false;
  const lastAt = parseUtcTimestamp(after.last_referenced_at);
  const lastLogAt = Math.max(...logs.map((log) => parseUtcTimestamp(log.inserted_at)));
  const notBackwards = before.last_referenced_at === null ||
    lastAt >= parseUtcTimestamp(before.last_referenced_at);
  return notBackwards && lastAt >= lastLogAt && lastAt <= finalAt;
}

function accountMemory(before, after, logs, finalAt) {
  const delta = after.reference_count - before.reference_count;
  const valid = delta === logs.length && nextLastReferenceValid(before, after, logs, finalAt);
  const updated = logs.length > 0 || delta !== 0
    ? {
      memory_id: before.id,
      reference_count_delta: delta,
      new_logs: logs.length,
      last_referenced_at: after.last_referenced_at,
    }
    : null;
  return { valid, updated };
}

function accountCounts(start, final, byMemory, finalAt) {
  let valid = true;
  const updated = [];
  for (const [id, before] of Object.entries(start.memory_items)) {
    const after = final.memory_items[id];
    // 集合/身份不一致已由 sameMemoryIdentity 单独判定；这里只需避免读取缺失统计。
    if (after === undefined) continue;
    const result = accountMemory({ ...before, id }, after, byMemory.get(id), finalAt);
    if (!result.valid) valid = false;
    if (result.updated) updated.push(result.updated);
  }
  return { valid, updated };
}

function stageRange(start, final) {
  const startAt = parseUtcTimestamp(start.at);
  const finalAt = parseUtcTimestamp(final.at);
  if (finalAt < startAt) invalid("final.at", "not earlier than start.at");
  return { startAt, finalAt };
}

function memoryAccounting(start, final, startAt, finalAt) {
  const identitySame = sameMemoryIdentity(start, final);
  const oldLogsSame = oldLogsPreserved(start, final);
  const { added, byMemory } = newLogsByMemory(start, final);
  const addedLogsValid = added.every((log) => validNewLog(log, start, startAt, finalAt));
  const accounts = accountCounts(start, final, byMemory, finalAt);
  return {
    accounted: identitySame && oldLogsSame && addedLogsValid && accounts.valid,
    added,
    accounts,
  };
}

function memoryMeasured(start, final, accounting) {
  return {
    memory_items: Object.keys(start.memory_items).length,
    reference_logs: {
      start: start.memory_reference_logs.length,
      final: final.memory_reference_logs.length,
      added: accounting.added.length,
    },
    reference_count_delta:
      accounting.accounts.updated.reduce((sum, item) => sum + item.reference_count_delta, 0),
    updated_memories: accounting.accounts.updated,
  };
}

function sameTablesExcept(start, final, excluded) {
  return CANON_TABLES
    .filter((table) => !excluded.includes(table))
    .every((table) =>
      start.tables[table].row_count === final.tables[table].row_count &&
      start.tables[table].canon_sha256 === final.tables[table].canon_sha256);
}

function tablesWithSameRows(start, final, table) {
  return start.tables[table].row_count === final.tables[table].row_count &&
    start.tables[table].rows_sha256 === final.tables[table].rows_sha256;
}

function chapterIdsSame(start, final) {
  const startIds = Object.keys(start.chapters).sort();
  const finalIds = Object.keys(final.chapters).sort();
  return startIds.length === finalIds.length &&
    startIds.every((id, index) => id === finalIds[index]);
}

function missionWriteTimes(beforeUpdated, afterUpdated, mission, startAt, finalAt) {
  const beforeAt = parseUtcTimestamp(beforeUpdated);
  const afterAt = parseUtcTimestamp(afterUpdated);
  const derivedAt = parseUtcTimestamp(mission.derived_at);
  return afterAt >= beforeAt &&
    afterAt <= finalAt &&
    derivedAt >= startAt &&
    derivedAt <= finalAt &&
    afterAt >= derivedAt;
}

// 源阶段只允许 nil/旧 TENTATIVE 被新的 model/TENTATIVE 覆盖；作者版在场时不改写、
// 不重新推导。只改 updated_at 而无 mission 因果，或 mission 改写而 timestamp 倒退，
// 都不能通过。
function missionTransition(before, after, beforeUpdated, afterUpdated, startAt, finalAt) {
  if (isDeepStrictEqual(before, after)) return beforeUpdated === afterUpdated;
  if (!isTentativeModel(after) || (before !== null && !isTentativeModel(before))) return false;
  return missionWriteTimes(beforeUpdated, afterUpdated, after, startAt, finalAt);
}

const missionField = (mission, key) => (mission && mission[key] != null ? mission[key] : null);

function designChange(id, before, after, changed) {
  return {
    chapter_id: id,
    mission_changed: changed,
    before_mission_id: missionField(before.mission, "mission_id"),
    before_mission_status: missionField(before.mission, "status"),
    after_mission_id: missionField(after.mission, "mission_id"),
    after_mission_status: missionField(after.mission, "status"),
    before_updated_at: before.updated_at,
    after_updated_at: after.updated_at,
  };
}

function chapterChange(id, before, after, targetId, startAt, finalAt) {
  if (before.protected_sha256 !== after.protected_sha256) return { valid: false, change: null };
  const changed = !isDeepStrictEqual(before.mission, after.mission);
  if (id === targetId) {
    const valid = missionTransition(
      before.mission,
      after.mission,
      before.updated_at,
      after.updated_at,
      startAt,
      finalAt,
    );
    return { valid, change: changed ? designChange(id, before, after, changed) : null };
  }
  const valid = !changed && before.updated_at === after.updated_at;
  return { valid, change: null };
}

function sourceChapterAccounted(start, final, targetId, startAt, finalAt) {
  // id 集合相同时目标章在两侧同在同缺，检查一侧即可。
  if (!chapterIdsSame(start, final) || !start.chapters[targetId]) {
    return { valid: false, changes: [] };
  }
  const results = Object.keys(start.chapters)
    .sort()
    .map((id) => chapterChange(
      id,
      start.chapters[id],
      final.chapters[id],
      targetId,
      startAt,
      finalAt,
    ));
  if (!results.every((result) => result.valid)) return { valid: false, changes: [] };
  return { valid: true, changes: results.map((result) => result.change).filter(Boolean) };
}

function chapterDesignKey(chapter) {
  return {
    protected_sha256: chapter.protected_sha256,
    updated_at: chapter.updated_at,
    mission: chapter.mission,
  };
}

function chapterDesignUnchanged(start, final) {
  if (!chapterIdsSame(start, final)) return false;
  return Object.keys(start.chapters).every((id) =>
    isDeepStrictEqual(chapterDesignKey(start.chapters[id]), chapterDesignKey(final.chapters[id])));
}

function requireDesignSnapshots(startValue, finalValue, label) {
  const start = parseSnapshot(startValue, "start");
  const final = parseSnapshot(finalValue, label);
  if (start.version !== SNAPSHOT_VERSION || final.version !== SNAPSHOT_VERSION) {
    invalid(`${label}.version`, `version 2 design-state witness required (got ${start.version}/${final.version})`);
  }
  return { start, final };
}

export function compareAuthoringCanonSnapshots(startValue, finalValue) {
  const start = parseSnapshot(startValue, "start");
  const final = parseSnapshot(finalValue, "final");
  const { startAt, finalAt } = stageRange(start, final);
  const tablesSame = sameTableCanon(start, final);
  const accounting = memoryAccounting(start, final, startAt, finalAt);
  return {
    checks: {
      no_canon_write: tablesSame,
      memory_reference_updates_accounted: accounting.accounted,
    },
    measured: {
      snapshot_version: start.version,
      start_at: start.at,
      final_at: final.at,
      canon_tables: CANON_TABLES.length,
      ...memoryMeasured(start, final, accounting),
    },
  };
}

// start→before-revision：其它表/其它章完全不变；只有目标章可新增/刷新暂定使命，
// 且 protected 字段、作者版、updated_at 因果都必须成立。v1 快照没有逐章见证，
// 不能补齐也不能放行设计态变化。
export function compareSourceDesignSnapshots(startValue, beforeValue, { targetChapterId } = {}) {
  const { start, final } = requireDesignSnapshots(startValue, beforeValue, "before-revision");
  const { startAt, finalAt } = stageRange(start, final);
  const otherTablesSame = sameTablesExcept(start, final, ["chapters"]);
  const chapterCountSame =
    start.tables.chapters.row_count === final.tables.chapters.row_count;
  const receiptsSame = tablesWithSameRows(start, final, "author_action_receipts");
  const design = sourceChapterAccounted(start, final, targetChapterId, startAt, finalAt);
  const accounting = memoryAccounting(start, final, startAt, finalAt);
  return {
    checks: {
      canon_unchanged_except_chapter_mission: otherTablesSame && chapterCountSame,
      chapter_mission_change_is_legal: design.valid,
      author_action_receipts_unchanged: receiptsSame,
      memory_reference_updates_accounted: accounting.accounted,
    },
    measured: {
      snapshot_version: start.version,
      start_at: start.at,
      final_at: final.at,
      target_chapter_id: targetChapterId ?? null,
      chapter_design_changes: design.changes,
      ...memoryMeasured(start, final, accounting),
    },
  };
}

// before-revision→final：除本次新增一条 action receipt 外，canon 与章设计态都必须
// 逐表/逐章不变；memory 引用仍按既有机制独立核算。
export function compareRevisionDesignSnapshots(beforeValue, finalValue) {
  const { start, final } = requireDesignSnapshots(beforeValue, finalValue, "final");
  const { startAt, finalAt } = stageRange(start, final);
  const unchangedExceptReceipt = sameTablesExcept(start, final, ["author_action_receipts"]);
  const receiptAddedOnce =
    final.tables.author_action_receipts.row_count ===
    start.tables.author_action_receipts.row_count + 1;
  const designUnchanged =
    tablesWithSameRows(start, final, "chapters") &&
    chapterDesignUnchanged(start, final);
  const accounting = memoryAccounting(start, final, startAt, finalAt);
  return {
    checks: {
      canon_unchanged_except_action_receipt: unchangedExceptReceipt,
      action_receipt_added_once: receiptAddedOnce,
      chapter_design_state_unchanged: designUnchanged,
      memory_reference_updates_accounted: accounting.accounted,
    },
    measured: {
      snapshot_version: start.version,
      start_at: start.at,
      final_at: final.at,
      action_receipts: {
        start: start.tables.author_action_receipts.row_count,
        final: final.tables.author_action_receipts.row_count,
      },
      ...memoryMeasured(start, final, accounting),
    },
  };
}
