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
import {
  PILOT_GROUP_CASE_IDS,
  loadLiveCaseCorpus,
  selectLiveCase,
} from "../quality/author_behavior_live_cases.mjs";
import {
  CONFIRMATION_CHECKPOINTS,
  CONFIRMATION_MODES,
  CONFIRMATION_REQUEST,
} from "./authoring_confirmation_constants.mjs";

const MESSAGE = "「灰烬中的手印」这章我怀疑有重复，请把全章核对一遍。";
const CONTINUATION_MESSAGE = "先写第01章正文草稿，再做质量复核；这是一项可恢复的长任务。";
const PLANNING_MESSAGE = "请按先核对再补齐计划设计一个角色，再设计相关世界设定；这是一项可恢复的长任务。";
const CHARACTER_MESSAGE = "先看看当前已有角色阵容，然后设计一个与主角形成镜像冲突的主要反派；这是一项可恢复的长任务。";
// CP3b 实模场景的真实作者自然语言创作请求：不携带验收专用标识/开关/固定期望，
// 模型可自主选择只读求证或直接产出 tentative 候选。
const LIVE_MESSAGE =
  "先看看第01章现在的设定和正文，再按现有设定写一段更紧张的开场：主角在雨夜收到一封没有署名的信，生成待采纳的候选，先不要保存。";

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
// 记忆详情/列表 P0 泄漏回归（与 authoring_memory_detail_evidence 的 checkpoint 名保持同源）。
const MEMORY_DETAIL_CHECKPOINTS = Object.freeze(["start", "memory-list", "memory-detail", "final"]);
const MEMORY_DETAIL_MESSAGE = "打开记忆管理并查看记忆详情（作者可见文案回归）。";

// A3 安全点自动维护（与 authoring_auto_maintenance_evidence 的 checkpoint 名保持同源）。
const AUTO_MAINTENANCE_CHECKPOINTS = Object.freeze([
  "start",
  "after-maintenance",
  "after-expanded",
  "after-next-request",
  "after-refresh",
  "after-failure",
  "after-recovery",
  "final",
]);
const AUTO_MAINTENANCE_REQUESTS = Object.freeze([
  "先读一下第01章的正文和章计划，我想知道现在的进度。",
  "再读一下第02章的正文和章计划，确认两章之间是否连贯。",
  "继续读一下第03章的计划，然后告诉我下一步该写什么。",
  "再看一下第01章的正文，确认开头是否抓人。",
  "把刚才读到的线索汇总一下，哪些还能继续用？",
  "最后再核对一遍第02章的正文，确保没有遗漏。",
]);

export function readConfig(dir) {
  return read(dir, "native-b71-config.json");
}

function readyFor(dir) {
  const ready = read(dir, "native-driver-ready.json");
  assert(SLICE_JOURNEYS[ready.slice_id], `未知原生 slice: ${ready.slice_id}`);
  assert(
    ["slice_verify", "strata"].includes(ready.provider),
    `原生批次 provider 必须是 slice_verify 或 strata，实测: ${ready.provider}`,
  );
  // provider=strata 即实模：默认 live（CP3b 协议层）；带 B71_BEHAVIOR_CASE 时切换
  // behavior journey（B70 作者行为覆盖，输入取冻结 case 原文）。
  const behaviorCaseId = process.env.B71_BEHAVIOR_CASE ?? null;
  const confirmationMode = process.env.B71_CONFIRMATION_ACTION ?? null;
  const autoMaintenance = process.env.B71_AUTO_MAINTENANCE === "1";
  const memoryDetail = process.env.B71_MEMORY_DETAIL === "1";
  let journey;
  if (memoryDetail) {
    assert.equal(ready.provider, "slice_verify", "memory-detail journey 只接受确定性 slice_verify");
    if (confirmationMode || behaviorCaseId || autoMaintenance) {
      throw new Error("B71_MEMORY_DETAIL 与 confirmation/behavior/auto-maintenance 不能同时设置");
    }
    journey = "memory-detail";
  } else if (autoMaintenance) {
    assert.equal(ready.provider, "strata", "auto-maintenance journey 只接受 provider=strata");
    journey = "auto-maintenance";
  } else if (confirmationMode) {
    assert(
      CONFIRMATION_MODES[confirmationMode],
      `未知 B71_CONFIRMATION_ACTION: ${confirmationMode}（confirm|reject）`,
    );
    journey = "confirmation";
  } else if (ready.provider === "strata") {
    journey = behaviorCaseId ? "behavior" : "live";
  } else {
    journey = SLICE_JOURNEYS[ready.slice_id];
  }
  if (journey === "live" || journey === "behavior" || journey === "confirmation" || journey === "auto-maintenance" || journey === "memory-detail") {
    assert.equal(ready.slice_id, "b71-first-consumer", `${journey} journey 只用于 b71-first-consumer`);
  }
  return {
    ...ready,
    provider: ready.provider,
    journey,
    behavior_case_id: behaviorCaseId,
    confirmation_mode: confirmationMode,
  };
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
  const live = ready.journey === "live" || ready.journey === "behavior";
  const behavior = ready.journey === "behavior";
  const confirmation = ready.journey === "confirmation";
  const autoMaintenance = ready.journey === "auto-maintenance";
  const memoryDetail = ready.journey === "memory-detail";
  const target = targetFor(dir, { includeSession: pending || live || confirmation || autoMaintenance });
  const nonce = pending ? randomBytes(8).toString("hex") : null;
  // 作者行为覆盖：输入必须是 B70 冻结 case 的 expression 原文（禁止现场造输入）。
  let behaviorCase = null;
  if (behavior) {
    const caseId = String(ready.behavior_case_id ?? "");
    assert(
      PILOT_GROUP_CASE_IDS.includes(caseId),
      `behavior case 必须是已批准的 pilot 组: ${caseId}`,
    );
    behaviorCase = selectLiveCase(loadLiveCaseCorpus(), caseId);
    write(dir, "behavior-case.json", behaviorCase);
  }
  write(dir, "production-sources-before.json", productionFingerprint());
  write(dir, "native-b71-config.json", {
    slice_id: ready.slice_id,
    journey: ready.journey,
    provider: ready.provider,
    target,
    ...(behaviorCase
      ? {
          behavior: {
            case_id: behaviorCase.case_id,
            target_id: behaviorCase.target_id,
            state_id: behaviorCase.state_id,
            split: behaviorCase.split,
            expression_sha256: behaviorCase.expression_sha256,
            expected: behaviorCase.expected,
            persona_id: behaviorCase.persona?.persona_id ?? null,
          },
        }
      : {}),
    ...(confirmation
      ? { confirmation: { mode: ready.confirmation_mode } }
      : {}),
    ...(autoMaintenance
      ? { auto_maintenance: { requests: AUTO_MAINTENANCE_REQUESTS } }
      : {}),
    message: pending
      ? pendingSourceMessage(nonce)
      : ready.journey === "revision"
        ? ""
        : behavior
          ? behaviorCase.expression
          : memoryDetail
            ? MEMORY_DETAIL_MESSAGE
            : autoMaintenance
              ? AUTO_MAINTENANCE_REQUESTS[0]
              : confirmation
              ? CONFIRMATION_REQUEST
              : live
              ? LIVE_MESSAGE
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

export function planningCanonSnapshot(dir, { includeChapterFacts = true } = {}) {
  return withDb(dir, (db) => buildAuthoringCanonSnapshot({
    tables: Object.fromEntries(CANON_TABLES.map((table) =>
      [table, all(db, `SELECT * FROM ${table} ORDER BY id`)])),
    referenceLogs: referenceLogRows(db),
    at: new Date().toISOString(),
    includeChapterFacts,
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

function writeRunCheckpoint(dir, checkpoint, canon, { includeChapterFacts = true } = {}) {
  write(dir, `b71-${checkpoint}.json`, {
    checkpoint,
    db_production_counts: productionTableCounts(dir),
    ...(canon ? { authoring_canon: planningCanonSnapshot(dir, { includeChapterFacts }) } : {}),
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
  // live/behavior/confirmation 实模需要未采纳零写入的 canon 内容快照。
  const confirmation = journey === "confirmation";
  const autoMaintenance = journey === "auto-maintenance";
  const memoryDetail = journey === "memory-detail";
  const live = journey === "live" || journey === "behavior";
  const canon = planning || revision || live || confirmation || autoMaintenance;
  if (isWhyCheckpoint(canon, checkpoint)) return writeWhyCheckpoint(dir, checkpoint);
  const allowedCheckpoints = confirmation
    ? CONFIRMATION_CHECKPOINTS
    : autoMaintenance
      ? AUTO_MAINTENANCE_CHECKPOINTS
      : memoryDetail
        ? MEMORY_DETAIL_CHECKPOINTS
        : RUN_CHECKPOINTS;
  assert(allowedCheckpoints.includes(checkpoint), `未知 checkpoint: ${checkpoint}`);
  if (checkpoint === "before-revision") {
    assert(revision, "before-revision 只属于修订批次");
  }
  if (revision) assertRevisionCheckpointOrder(dir, checkpoint);
  // live/behavior/confirmation 实模：canon 快照只做表级内容签名（不解析章节设计态明细）。
  return writeRunCheckpoint(dir, checkpoint, canon, {
    includeChapterFacts: !(live || confirmation || autoMaintenance),
  });
}
