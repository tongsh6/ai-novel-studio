// B71 原生批次的准备/采集持久化：只读写隔离批次目录与只读 DB 快照。
//
// 驱动在启动真实窗口前后调用 prepare/capture；判据不在这里，避免把验收语义
// 混进文件/DB 边界。配置与证据写入仍沿用既有命名和“不得覆盖”规则。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  all,
  productionFingerprint,
  productionTableCounts,
  read,
  seedFields,
  withDb,
  write,
} from "./scenario_evidence.mjs";
import { CANON_TABLES, buildAuthoringCanonSnapshot } from "./authoring_canon_evidence.mjs";
import {
  PENDING_FOLLOWUP_MESSAGE,
  PENDING_REVISION_MESSAGE,
  pendingSourceMessage,
} from "./authoring_pending_evidence.mjs";

const MESSAGE = "「灰烬中的手印」这章我怀疑有重复，请把全章核对一遍。";
const CONTINUATION_MESSAGE = "先写第01章正文草稿，再做质量复核；这是一项可恢复的长任务。";
const PLANNING_MESSAGE = "请按先核对再补齐计划设计一个角色，再设计相关世界设定；这是一项可恢复的长任务。";
const CHARACTER_MESSAGE = "先看看当前已有角色阵容，然后设计一个与主角形成镜像冲突的主要反派；这是一项可恢复的长任务。";

const SLICE_JOURNEYS = Object.freeze({
  "b71-first-consumer": "full-read",
  "b71-authoring-transcript": "continuation",
  "b71-authoring-profiles": "character-design",
  "b71-authoring-planning": "planning",
  "b71-authoring-revision": "revision",
  "b71-authoring-pending": "pending",
});

const JOURNEY_MESSAGES = Object.freeze({
  "full-read": MESSAGE,
  revision: MESSAGE,
  continuation: CONTINUATION_MESSAGE,
  "character-design": CHARACTER_MESSAGE,
  planning: PLANNING_MESSAGE,
});

// 修订批次的源正文必须从页面上的明确章标题行生成，不使用固定聊天文案。
const REVISION_CHAPTER_TITLE = "第02章：矿区追击战";

const WHY_CHECKPOINTS = Object.freeze(["before-why", "after-why"]);
const RUN_CHECKPOINTS = Object.freeze(["start", "before-revision", "final"]);

export function readConfig(dir) {
  return read(dir, "native-b71-config.json");
}

function readyFor(dir) {
  const ready = read(dir, "native-driver-ready.json");
  assert(SLICE_JOURNEYS[ready.slice_id], `未知原生 slice: ${ready.slice_id}`);
  assert.equal(ready.provider, "slice_verify");
  return { ...ready, journey: SLICE_JOURNEYS[ready.slice_id] };
}

function targetFor(dir, { includeSession = false } = {}) {
  const fields = seedFields(dir);
  const workId = fields("work_id");
  assert(workId, "seed 缺少 work_id");
  const sessionId = includeSession ? fields("session_id") : null;
  if (includeSession) assert(sessionId, "seed 缺少 session_id");
  return withDb(dir, (db) => {
    const rows = all(db, "SELECT title FROM works WHERE id = ?", [workId]);
    assert.equal(rows.length, 1, "seed 作品不存在");
    return {
      work_id: workId,
      work_title: String(rows[0].title),
      ...(includeSession ? { session_id: sessionId } : {}),
    };
  });
}

const messageFor = (journey) => JOURNEY_MESSAGES[journey];

export function prepare(dir) {
  const ready = readyFor(dir);
  const pending = ready.journey === "pending";
  const target = targetFor(dir, { includeSession: pending });
  const nonce = pending ? randomBytes(8).toString("hex") : null;
  write(dir, "production-sources-before.json", productionFingerprint());
  write(dir, "native-b71-config.json", {
    slice_id: ready.slice_id,
    journey: ready.journey,
    target,
    message: pending
      ? pendingSourceMessage(nonce)
      : ready.journey === "revision"
        ? ""
        : messageFor(ready.journey),
    ...(pending
      ? {
          nonce,
          revision_message: PENDING_REVISION_MESSAGE,
          followup_message: PENDING_FOLLOWUP_MESSAGE,
        }
      : {}),
    ...(ready.journey === "revision" ? { chapter_title: REVISION_CHAPTER_TITLE } : {}),
  });
}

// 真实 schema 的 binary_id 以 16 原始字节存进 TEXT 列；node:sqlite 按 TEXT 解码会损坏
// 非法 UTF-8/NUL。SQLite 层先做无损投影，纯函数仍只接受合法 UUID 字符串或 16-byte BLOB。
const REFERENCE_LOG_UUID_COLUMNS = Object.freeze([
  "id",
  "memory_id",
  "work_id",
  "task_id",
  "conversation_id",
]);

function referenceLogRows(db) {
  const projections = REFERENCE_LOG_UUID_COLUMNS.map((column) =>
    `CASE WHEN length(CAST(${column} AS BLOB)) = 16 THEN lower(hex(${column})) ELSE ${column} END AS ${column}`,
  );
  // 同名 alias 位于 * 之后，node:sqlite 以后出现的同名字段覆盖前者；未知列仍全部保留。
  return all(
    db,
    `SELECT *, ${projections.join(", ")} FROM memory_reference_logs ORDER BY inserted_at, id`,
  );
}

export function planningCanonSnapshot(dir) {
  return withDb(dir, (db) => buildAuthoringCanonSnapshot({
    tables: Object.fromEntries(CANON_TABLES.map((table) =>
      [table, all(db, `SELECT * FROM ${table} ORDER BY id`)])),
    referenceLogs: referenceLogRows(db),
    at: new Date().toISOString(),
  }));
}

const isWhyCheckpoint = (planning, checkpoint) =>
  planning && WHY_CHECKPOINTS.includes(checkpoint);

function writeWhyCheckpoint(dir, checkpoint) {
  return write(dir, `b71-${checkpoint}.json`, {
    checkpoint,
    at: new Date().toISOString(),
  });
}

function writeRunCheckpoint(dir, checkpoint, canon) {
  write(dir, `b71-${checkpoint}.json`, {
    checkpoint,
    db_production_counts: productionTableCounts(dir),
    ...(canon ? { authoring_canon: planningCanonSnapshot(dir) } : {}),
  });
}

function assertRevisionCheckpointOrder(dir, checkpoint) {
  const exists = (name) => fs.existsSync(path.join(dir, name));
  if (checkpoint === "before-revision") {
    assert(exists("b71-start.json"), "before-revision 必须在 start 之后登记");
  }
  if (checkpoint === "final") {
    assert(exists("b71-before-revision.json"), "修订 final 必须已有 before-revision 设计态边界");
  }
}

export function capture(dir, checkpoint) {
  const journey = readConfig(dir).journey;
  const planning = journey === "planning";
  const revision = journey === "revision";
  const canon = planning || revision;
  if (isWhyCheckpoint(canon, checkpoint)) return writeWhyCheckpoint(dir, checkpoint);
  assert(RUN_CHECKPOINTS.includes(checkpoint), `未知 checkpoint: ${checkpoint}`);
  if (checkpoint === "before-revision") {
    assert(revision, "before-revision 只属于修订批次");
  }
  if (revision) assertRevisionCheckpointOrder(dir, checkpoint);
  return writeRunCheckpoint(dir, checkpoint, canon);
}
