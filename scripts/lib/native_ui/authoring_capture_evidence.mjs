// B71 原生批次的准备/采集持久化：只读写隔离批次目录与只读 DB 快照。
//
// 驱动在启动真实窗口前后调用 prepare/capture；判据不在这里，避免把验收语义
// 混进文件/DB 边界。配置与证据写入仍沿用既有命名和“不得覆盖”规则。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  ROOT,
  all,
  productionFingerprint,
  productionTableCounts,
  read,
  seedFields,
  sha256,
  shaFile,
  withDb,
  write,
} from "./scenario_evidence.mjs";
import { DEFAULT_STRATA_MODEL } from "./strata_lifecycle.mjs";
import { validateAuthorInputs } from "./request_cost_manifest.mjs";
import { COMPACTION_RUNTIME_PROFILE_ID, assertManifestRuntime, assertRuntimeFacts, getRuntimeProfile } from "./request_cost_runtime_recipe.mjs";
import { CANON_TABLES, buildAuthoringCanonSnapshot } from "./authoring_canon_evidence.mjs";
import { referenceLogRows } from "./reference_log_evidence.mjs";
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
// 回答模式 gate（等待即回答）：确定性 slice_verify 场景的 checkpoint。
// 现役确定性回答模式只采集单 run 的起止边界。
const ANSWER_MODE_CHECKPOINTS = Object.freeze(["start", "final"]);
const ANSWER_MODE_REQUEST = "第01章结尾有两个方向，先让我选择。";

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
const AUTO_INPUT_FILES = Object.freeze({
  discussions: { file: "r03-discussion-author-inputs.json", count: 20 },
  controls: { file: "r03-interleaved-author-inputs.json", count: 5 },
});

function autoMaintenanceInputs(dir, { seal = false, config } = {}) {
  const result = { input_sources: {} };
  for (const [kind, { file, count }] of Object.entries(AUTO_INPUT_FILES)) {
    const sourcePath = `scripts/lib/native_ui/fixtures/${file}`;
    const source = path.join(ROOT, sourcePath), sealed = path.join(dir, file);
    const raw = fs.readFileSync(seal ? source : sealed, "utf8");
    const input = validateAuthorInputs(JSON.parse(raw), { expectedCount: count });
    for (const turn of input.turns) {
      assert.equal(sha256(turn.text), turn.sha256, `${file} 作者原文 hash 不符: ${turn.id}`);
    }
    const reference = { source_path: sourcePath, file, sha256: sha256(raw) };
    if (seal) fs.writeFileSync(sealed, raw, { flag: "wx" });
    else {
      assert.deepEqual(config.auto_maintenance?.input_sources?.[kind], reference, `${file} 冻结输入引用不符`);
      assert.equal(shaFile(source), reference.sha256, `${file} 已偏离现役冻结来源`);
    }
    result.input_sources[kind] = reference;
    result[kind] = input.turns;
  }
  return result;
}

export function readAutoMaintenanceInputs(dir, config = read(dir, "native-b71-config.json")) {
  assert.equal(config.journey, "auto-maintenance", "冻结讨论只属于 auto-maintenance journey");
  return autoMaintenanceInputs(dir, { config });
}

export function splashRuntime(dir) {
  const observed = read(dir, "runtime-facts.json");
  assertRuntimeFacts(observed, COMPACTION_RUNTIME_PROFILE_ID);
  return { profile: COMPACTION_RUNTIME_PROFILE_ID, observed, facts_sha256: shaFile(path.join(dir, "runtime-facts.json")) };
}


// 实模批次冻结输入沿用 B71 预注册 JSON 形状；场景绑定与发送预算在此单点校验。
// 文学判断与实际请求材料覆盖由独立 evidence owner 审计。
const PREREGISTRATION_FILE = "preregistration.json";
const AUTHOR_VISIBLE_TARGET_FIELDS = Object.freeze(["work_title", "chapter_title", "reading_excerpt"]);

// B82 已冻结的作者可见场景：G2/G3 共享同一 author_visible_target 契约（同样 3 个
// 字段、同一份预注册哈希与目标绑定）。这里是选择作者可见入口的唯一判定；普通 live
// 与其它场景返回 null，保持原行为。
const R05_BUDGET = Object.freeze({
  batches: 1, author_sends: 1, manual_retries: 0, scenario_seconds: 900,
  input_timeout_ms: 120000, turn_timeout_ms: 360000,
});
const R05_FULL_READ_TARGET = Object.freeze({
  work_title: "灰烬手印验证作品", chapter_title: "第2章：灰烬中的手印",
  reading_excerpt: "末页锚点：井底浮现第七枚手印",
});
// 四个新场景的唯一登记点；batch、prepare、readConfig 共用此表，未知 Splash ID 不放行。
const R05_SCENARIOS = Object.freeze({
  "b87-r05-chapter-count": {
    mode: "read_only", goal: "count",
    seed_script: "scripts/seed_judgment_explore_chapter_full_read.exs",
    message: "这部作品目前一共有多少章？有正文和还没写正文的各几章？只告诉我这三个数量。",
    target: R05_FULL_READ_TARGET,
  },
  "b87-r05-quality": {
    mode: "read_only", goal: "quality",
    seed_script: "scripts/seed_au11_quality_diagnosis_message_envelope.exs",
    message: "请先阅读第01章《灵源账单》已经保存的正文，再判断主角的胜利来得是否太容易，指出依据和可改方向。只分析，不生成修订候选，也不要保存。",
    target: { work_title: "灵源纪元", chapter_title: "第01章：灵源账单",
      reading_excerpt: "而妹妹的名字，正写在矿井最深处那面显示屏的最上面一行。" },
  },
  "b87-r05-whole-chapter": {
    mode: "candidate", goal: "whole",
    seed_script: "scripts/seed_judgment_explore_chapter_full_read.exs",
    message: "请先把第02章《灰烬中的手印》已保存的正文从头到尾读完，再给我一份整章修订候选，减少重复描写，保留开头和结尾的线索；先不要保存。",
    target: R05_FULL_READ_TARGET,
  },
  "b87-r05-style-material": {
    mode: "candidate", goal: "style",
    seed_script: "scripts/seed_ca04_carry_gaps.exs",
    message: "请先查看本作品已经确认的风格规则，并阅读第01章《黑市对账夜》已保存的正文。据此把这一章改写成一份修订候选，突出人物之间的试探；先不要保存。",
    target: { work_title: "CA04 携带缺口验收作品", chapter_title: "第01章：黑市对账夜",
      reading_excerpt: "巡检的脚步声从巷口传来，他把账牌收进袖中。" },
  },
});
const AUTHOR_VISIBLE_SCENARIO_MODES = Object.freeze({
  "b82-g2": "candidate", "b82-g3": "read_only",
  ...Object.fromEntries(Object.entries(R05_SCENARIOS).map(([id, spec]) => [id, spec.mode])),
});

export const authorVisibleScenario = (scenarioId) =>
  typeof scenarioId === "string"
    ? (AUTHOR_VISIBLE_SCENARIO_MODES[scenarioId] ?? null)
    : null;

// B82 作者可见新运行的冻结目标：只校验真实可见作品名/章名/阅读原文为非空字符串。
// 旧预注册缺该字段仍可做通用哈希诊断；只有 prepare 会以 requireAuthorVisibleTarget
// 拒绝新驱动，历史批次保持只读可查。
function readAuthorVisibleTarget(scenario, { require = false } = {}) {
  const value = scenario.author_visible_target;
  if (value === undefined) {
    assert(
      !require,
      "预注册 scenarios[0].author_visible_target 不能为空（b82-g2/b82-g3 新运行必须冻结作者可见目标）",
    );
    return null;
  }
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "预注册 scenarios[0].author_visible_target 必须是对象",
  );
  for (const field of AUTHOR_VISIBLE_TARGET_FIELDS) {
    assert(
      typeof value[field] === "string" && value[field].trim() !== "",
      `预注册 scenarios[0].author_visible_target.${field} 不能为空`,
    );
  }
  return {
    work_title: value.work_title,
    chapter_title: value.chapter_title,
    reading_excerpt: value.reading_excerpt,
  };
}

export function validatePreregistrationFile(
  file,
  { dir, provider = "strata",
    model = provider === "splash" ? getRuntimeProfile(COMPACTION_RUNTIME_PROFILE_ID).model : DEFAULT_STRATA_MODEL,
    requireAuthorVisibleTarget = false, scenarioId = null, b71Live = false } = {},
) {
  assert(typeof dir === "string" && dir !== "", "预注册校验缺少批次目录");
  assert(["strata", "splash"].includes(provider), `预注册未知 provider: ${provider}`);
  assert(typeof model === "string" && model !== "", "预注册校验缺少冻结模型");
  let value;
  let text;
  try {
    // 一次读取：parse 与 sha256 都只针对这份 UTF-8 原文，避免读两次读到不同字节。
    text = fs.readFileSync(file, "utf8");
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`预注册不是合法 JSON: ${error.message}`);
  }
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "预注册必须是 JSON 对象",
  );
  assert(
    typeof value.id === "string" && value.id.trim() !== "",
    "预注册 id 不能为空",
  );
  assert(
    value.model !== null && typeof value.model === "object" && !Array.isArray(value.model),
    "预注册缺少 model",
  );
  assert.equal(
    value.model.provider,
    provider,
    `预注册 provider 必须与当前 route 一致（${provider}），实测: ${value.model.provider}`,
  );
  assert.equal(
    value.model.model,
    model,
    `预注册模型必须与冻结模型一致（${model}），实测: ${value.model.model}`,
  );
  if (provider === "splash") {
    const profile = assertManifestRuntime(value);
    assert.equal(profile.id, COMPACTION_RUNTIME_PROFILE_ID, "Splash 必须使用现役 R03 runtime profile");
    assert(b71Live || (typeof scenarioId === "string" && scenarioId !== ""), "Splash 调用者必须显式绑定 scenarioId");
  }
  assert(
    Array.isArray(value.scenarios) && value.scenarios.length === 1,
    "预注册 scenarios 必须恰好一项",
  );
  const scenario = value.scenarios[0];
  assert(
    scenario !== null && typeof scenario === "object" && !Array.isArray(scenario),
    "预注册 scenarios[0] 必须是对象",
  );
  // 作者原话按冻结字节发送：只拒绝空输入，不做 trim/替换。
  assert(
    typeof scenario.message === "string" && scenario.message.trim() !== "",
    "预注册 scenarios[0].message 不能为空",
  );
  assert(
    scenario.evidence !== null &&
      typeof scenario.evidence === "object" &&
      typeof scenario.evidence.dir === "string" &&
      scenario.evidence.dir !== "",
    "预注册 scenarios[0].evidence.dir 不能为空",
  );
  assert.equal(
    path.resolve(ROOT, scenario.evidence.dir),
    path.resolve(dir),
    `预注册 evidence.dir 必须等于实际批次目录: ${scenario.evidence.dir} != ${dir}`,
  );
  // G2 专项标识只从已验证哈希的冻结输入派生；缺省保持普通 live 行为。
  const actualScenarioId =
    typeof scenario.id === "string" && scenario.id.trim() !== "" ? scenario.id : null;
  if (scenarioId !== null) assert.equal(actualScenarioId, scenarioId, `冻结场景必须是 ${scenarioId}`);
  if (provider === "splash" && b71Live) {
    assert(actualScenarioId === "b82-g2" || Object.hasOwn(R05_SCENARIOS, actualScenarioId),
      "Splash B71 live 只接受 b82-g2 或已登记的 R05 场景");
  }
  const r05 = Object.hasOwn(R05_SCENARIOS, actualScenarioId) ? R05_SCENARIOS[actualScenarioId] : null;
  // 目标来自同一冻结副本；普通 live 的同名字段不改变入口行为。
  const authorVisibleTarget = authorVisibleScenario(actualScenarioId)
    ? readAuthorVisibleTarget(scenario, { require: requireAuthorVisibleTarget })
    : null;
  if (r05) {
    assert.equal(provider, "splash", "R05 provider 必须是 splash");
    assert.equal(scenario.slice_id, "b71-first-consumer", "R05 slice 绑定不符");
    assert.equal(scenario.message, r05.message, "R05 作者原文与冻结场景不符");
    assert.deepEqual(authorVisibleTarget, r05.target, "R05 作者可见目标与冻结场景不符");
    assert.equal(scenario.seed?.script, r05.seed_script, "R05 seed 路径与冻结场景不符");
    assert.equal(scenario.seed?.sha256, shaFile(path.join(ROOT, r05.seed_script)),
      "R05 seed 字节与冻结 SHA 不符");
    assert.deepEqual(value.budget, R05_BUDGET, "R05 budget 必须绑定 1 send/0 retry/900秒 owned 执行");
  }
  return {
    id: value.id,
    sha256: sha256(text),
    message: scenario.message,
    model: value.model.model,
    scenario_id: actualScenarioId,
    author_visible_target: authorVisibleTarget,
    ...(r05 ? { seed: scenario.seed, budget: value.budget, r05_goal: r05.goal } : {}),
  };
}

// 有标记或普通 live 批次内有预注册文件时，配置必须与冻结副本一致。
function checkPreregistration(dir, config) {
  const marker = config.preregistration ?? null;
  const file = path.join(dir, PREREGISTRATION_FILE);
  if (!marker && !(config.journey === "live" && fs.existsSync(file))) return null;
  assert(marker, "预注册文件存在但配置缺少 preregistration 标记");
  assert(
    typeof marker === "object" && !Array.isArray(marker),
    "native-b71-config.preregistration 必须是对象",
  );
  assert(fs.existsSync(file), `预注册文件缺失: ${PREREGISTRATION_FILE}`);
  // 历史事实按配置里冻结的模型复核；当前 env/B71_STRATA_MODEL 只在 prepare 建批时生效。
  assert(
    typeof marker.model === "string" && marker.model !== "",
    "native-b71-config.preregistration 缺少冻结模型",
  );
  const record = validatePreregistrationFile(file, { dir, provider: config.provider, model: marker.model,
    b71Live: true });
  assert.equal(marker.id, record.id, "预注册 id 与配置不一致");
  assert.equal(marker.sha256, record.sha256, "预注册文件已被篡改");
  assert.equal(config.message, record.message, "配置作者输入与预注册不一致");
  if (record.r05_goal) {
    assert.deepEqual(config.seed, record.seed, "配置 seed 与预注册不一致");
    assert.deepEqual(config.budget, record.budget, "配置 budget 预算与预注册不一致");
    assert.equal(config.slice_id, "b71-first-consumer", "配置 R05 slice 绑定不符");
  }
  // B82 作者可见目标与作者输入一起封存在同一份预注册哈希里；旧批次缺字段时
  // 保持历史可读，但 G2/G3 新批次必须有冻结来源，且配置副本不得被改写或补造。
  if (authorVisibleScenario(record.scenario_id)) {
    if (record.author_visible_target) {
      assert.deepEqual(
        config.author_visible_target,
        record.author_visible_target,
        "配置作者可见目标与预注册不一致",
      );
    } else {
      assert(
        !Object.hasOwn(config, "author_visible_target"),
        "配置作者可见目标缺少冻结预注册来源",
      );
    }
  }
  return record;
}

export function readConfig(dir) {
  const config = read(dir, "native-b71-config.json");
  const record = checkPreregistration(dir, config);
  // 配置文件自带的 scenario_id/作者可见目标可伪造，一律丢弃；只保留哈希验证后的冻结值。
  const sealed = { ...config };
  if (sealed.provider === "splash") {
    assert(["live", "auto-maintenance"].includes(sealed.journey), "Splash journey 未注册");
    assert.deepEqual(sealed.runtime, splashRuntime(dir), "实际 runtime facts 与配置不符");
    if (sealed.journey === "live") assert(record, "Splash live 缺少冻结预注册 b82-g2 或 R05");
  }
  if (sealed.journey === "auto-maintenance") {
    assert.equal(sealed.provider, "splash", "R03 auto-maintenance provider 不符");
    const inputs = readAutoMaintenanceInputs(dir, sealed);
    assert.equal(sealed.message, inputs.discussions[0].text, "作者输入与冻结原文不符");
  }
  delete sealed.scenario_id;
  delete sealed.r05_goal;
  if (record?.r05_goal) sealed.r05_goal = record.r05_goal;
  if (authorVisibleScenario(record?.scenario_id)) {
    delete sealed.author_visible_target;
    if (record.author_visible_target) sealed.author_visible_target = record.author_visible_target;
  }
  return record?.scenario_id ? { ...sealed, scenario_id: record.scenario_id } : sealed;
}

function readyFor(dir) {
  const ready = read(dir, "native-driver-ready.json");
  assert(SLICE_JOURNEYS[ready.slice_id], `未知原生 slice: ${ready.slice_id}`);
  assert(
    ["slice_verify", "streaming_slice_verify", "strata", "splash"].includes(ready.provider),
    `原生批次 provider 必须是 slice_verify/streaming_slice_verify/strata/splash，实测: ${ready.provider}`,
  );
  // provider=strata 即实模：默认 live（CP3b 协议层）；带 B71_BEHAVIOR_CASE 时切换
  // behavior journey（B70 作者行为覆盖，输入取冻结 case 原文）。
  const behaviorCaseId = process.env.B71_BEHAVIOR_CASE ?? null;
  const confirmationMode = process.env.B71_CONFIRMATION_ACTION ?? null;
  const autoMaintenance = process.env.B71_AUTO_MAINTENANCE === "1";
  const memoryDetail = process.env.B71_MEMORY_DETAIL === "1";
  const answerMode = process.env.B71_ANSWER_MODE === "1";
  let journey;
  if (answerMode) {
    assert.equal(ready.provider, "slice_verify", "answer-mode journey 只接受确定性 slice_verify");
    if (confirmationMode || behaviorCaseId || autoMaintenance || memoryDetail) {
      throw new Error("B71_ANSWER_MODE 与 confirmation/behavior/auto-maintenance/memory-detail 不能同时设置");
    }
    journey = "answer-mode";
  } else if (memoryDetail) {
    assert.equal(ready.provider, "slice_verify", "memory-detail journey 只接受确定性 slice_verify");
    if (confirmationMode || behaviorCaseId || autoMaintenance) {
      throw new Error("B71_MEMORY_DETAIL 与 confirmation/behavior/auto-maintenance 不能同时设置");
    }
    journey = "memory-detail";
  } else if (autoMaintenance) {
    assert.equal(ready.provider, "splash", "auto-maintenance journey 只接受现役 Splash runtime profile");
    journey = "auto-maintenance";
  } else if (confirmationMode) {
    assert(
      CONFIRMATION_MODES[confirmationMode],
      `未知 B71_CONFIRMATION_ACTION: ${confirmationMode}（confirm|reject）`,
    );
    journey = "confirmation";
  } else if (ready.provider === "strata" || ready.provider === "splash") {
    if (behaviorCaseId) assert.equal(ready.provider, "strata", "behavior provider 必须是 strata");
    journey = behaviorCaseId ? "behavior" : "live";
  } else {
    journey = SLICE_JOURNEYS[ready.slice_id];
  }
  if (journey === "live" || journey === "behavior" || journey === "confirmation" || journey === "auto-maintenance" || journey === "memory-detail" || journey === "answer-mode") {
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


export function prepare(dir) {
  const ready = readyFor(dir);
  const pending = ready.journey === "pending";
  const live = ready.journey === "live" || ready.journey === "behavior";
  const behavior = ready.journey === "behavior";
  const confirmation = ready.journey === "confirmation";
  const autoMaintenance = ready.journey === "auto-maintenance";
  const memoryDetail = ready.journey === "memory-detail";
  const answerMode = ready.journey === "answer-mode";
  // B82 冻结输入：只能由普通 live 批次消费批次目录内的同一副本。
  const preregistrationFile = path.join(dir, PREREGISTRATION_FILE);
  const hasPreregistration = fs.existsSync(preregistrationFile);
  const runtime = ready.provider === "splash" ? splashRuntime(dir) : null;
  if (ready.provider === "splash" && ready.journey === "live") {
    assert(hasPreregistration, "Splash live 缺少冻结预注册");
  }
  if (hasPreregistration) {
    assert(ready.journey === "live", "预注册文件只属于普通 live 批次");
  }
  const preregistration = hasPreregistration
    ? validatePreregistrationFile(preregistrationFile, { dir, provider: ready.provider,
      model: runtime ? runtime.observed.provider.model : DEFAULT_STRATA_MODEL, requireAuthorVisibleTarget: true,
      b71Live: true })
    : null;
  const visibleTarget = preregistration?.author_visible_target ?? null;
  // B82 的场景目标只取封存的作者可见目标，不依赖种子日志或数据库。
  const target = visibleTarget
    ? null
    : targetFor(dir, { includeSession: pending || live || confirmation || autoMaintenance || answerMode });
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
  const inputs = autoMaintenance ? autoMaintenanceInputs(dir, { seal: true }) : null;
  write(dir, "production-sources-before.json", productionFingerprint());
  write(dir, "native-b71-config.json", {
    slice_id: ready.slice_id,
    journey: ready.journey,
    provider: ready.provider,
    ...(target ? { target } : {}),
    ...(visibleTarget ? { author_visible_target: visibleTarget } : {}),
    ...(preregistration?.r05_goal ? { seed: preregistration.seed, budget: preregistration.budget } : {}),
    ...(preregistration
      ? {
          preregistration: {
            id: preregistration.id,
            sha256: preregistration.sha256,
            model: preregistration.model,
          },
        }
      : {}),
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
    ...(runtime ? { runtime } : {}),
    ...(autoMaintenance
      ? { auto_maintenance: { input_sources: inputs.input_sources } }
      : {}),
    message: preregistration
      ? preregistration.message
      : pending
      ? pendingSourceMessage(nonce)
      : ready.journey === "revision"
        ? ""
        : behavior
          ? behaviorCase.expression
          : answerMode
            ? ANSWER_MODE_REQUEST
            : memoryDetail
              ? MEMORY_DETAIL_MESSAGE
              : autoMaintenance
              ? inputs.discussions[0].text
              : confirmation
              ? CONFIRMATION_REQUEST
              : live
              ? LIVE_MESSAGE
              : JOURNEY_MESSAGES[ready.journey],
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
  const answerMode = journey === "answer-mode";
  const live = journey === "live" || journey === "behavior";
  const canon = planning || revision || live || confirmation || autoMaintenance;
  if (isWhyCheckpoint(canon, checkpoint)) return writeWhyCheckpoint(dir, checkpoint);
  const allowedCheckpoints = confirmation
    ? CONFIRMATION_CHECKPOINTS
    : autoMaintenance
      ? AUTO_MAINTENANCE_CHECKPOINTS
      : memoryDetail
        ? MEMORY_DETAIL_CHECKPOINTS
        : answerMode
          ? ANSWER_MODE_CHECKPOINTS
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

// 批次 runner 在启动 App 前用同一函数校验冻结副本；直接运行本文件只暴露该校验，
// 不新增脚本或协议版本。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, file, dir, provider = "strata", scenarioId = null] = process.argv.slice(2);
  if (command !== "validate-preregistration" || !file || !dir) {
    console.error("usage: node authoring_capture_evidence.mjs validate-preregistration <file> <batch-dir> [provider] [scenario-id]");
    process.exit(64);
  }
  try {
    const record = validatePreregistrationFile(file, { dir, provider,
      scenarioId: scenarioId === "b71-live" ? null : scenarioId,
      b71Live: scenarioId === "b71-live" });
    console.log(JSON.stringify(record));
  } catch (error) {
    console.error(`[b71-preregistration] ${error.message}`);
    process.exit(1);
  }
}
