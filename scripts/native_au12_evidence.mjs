// AU12 A 原生验收证据核验（外部 AX/CGEvent 驱动真实 Tauri 窗口）。
//
// 驱动：scripts/native_au12_drive.mjs。本文件只消费隔离批次证据：
// native-driver-ready.json / native-ui-complete.json / native-transport.jsonl /
// app-log / llm-calls / AX 文本截图 / 只读 SQLite；断言与浏览器 canonical 场景同源，
// 只把驱动面从 Chromium 换为原生窗口。产品代码不读取本文件。
//
// 模式：
//   prepare <dir>  通过产品 HTTP API 创建带立项字段的作品并标记最近打开
//   capture <dir> <checkpoint>  记录只读 DB 生产表计数（start/final）
//   verify <dir>   写 summary.json（surface=tauri, driver=ax-native-system-ui）
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {
  all,
  assertCommonEvidence,
  assertProviderAndWire,
  axText,
  evidenceBoundary,
  productionTableCounts,
  read,
  rewrite,
  write,
  writeNativeSummary,
  withDb,
} from "./lib/native_ui/scenario_evidence.mjs";

const SLICE = "au12-correction-intent-roundtrip";
const FIELD = "main_goal";
const VALUE = "在巡检收网前拿到暗抽主账";
const TITLE = "主线目标";
const BODY = "让沈砚从被动卷入转向主动查账，在巡检收网前拿到暗抽主账。";
const USER_TEXT = "我想修订当前作品的立项设定，包括题材、核心卖点、目标读者和基调。请先生成一份待采纳的设定修订草稿，不要直接写入作品档案。";

async function createWork(dir, ready) {
  const nonce = Date.now();
  const title = `AU12原生修订作品-${nonce}`;
  const response = await fetch(`${ready.api_url}/api/works`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      genre: "赛博修仙",
      core_selling_point: `灵气账单追债-${nonce}`,
      target_reader: "喜欢设定驱动剧情的读者",
      tone_preference: "冷峻悬疑",
    }),
  });
  assert(response.ok, `创建作品失败: HTTP ${response.status}`);
  const body = await response.json();
  assert(body?.work?.id, "创建作品响应缺少 work id");
  return { workId: body.work.id, workTitle: String(body.work.title ?? title) };
}

export async function prepare(dir) {
  const ready = read(dir, "native-driver-ready.json");
  assert.equal(ready.slice_id, SLICE, "原生 ready.slice_id 与 AU12 场景不一致");
  assert.equal(ready.driver, "external-system-ui", "原生批次驱动标识错误");
  assert.equal(ready.browser_driver_started, false, "原生批次不得启动 Chromium");
  assert.equal(ready.provider, "slice_verify", "AU12 原生批次必须使用 slice_verify");

  const created = await createWork(dir, ready);

  const config = {
    slice_id: SLICE,
    provider: ready.provider,
    target: { work_id: created.workId, work_title: created.workTitle },
    user_text: USER_TEXT,
    expected: { field: FIELD, value: VALUE, title: TITLE, body: BODY },
    captures: ["01-workbench", "02-pending", "03-adopted-overview", "04-followup"],
    baseline: productionTableCounts(dir),
  };
  write(dir, "native-au12-config.json", config);
  return config;
}

export function capture(dir, checkpoint) {
  const config = read(dir, "native-au12-config.json");
  assert(checkpoint === "start" || checkpoint === "final" || config.captures.includes(checkpoint),
    `未知 AU12 原生 capture checkpoint: ${checkpoint}`);
  const counts = productionTableCounts(dir);
  const file = path.join(dir, "native-au12-db.json");
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  rewrite(dir, "native-au12-db.json", { ...existing, [checkpoint]: counts });
}

const latestLogs = (dir, sub) => {
  const base = path.join(dir, sub);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base).filter((name) => name.endsWith(".jsonl")).sort().flatMap((name) =>
    fs.readFileSync(path.join(base, name), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)));
};

const frameOf = (record) => Array.isArray(record?.frame) && record.frame.length >= 5 ? record.frame : null;

export function verify(dir) {
  const config = read(dir, "native-au12-config.json");
  const { ready, ui } = assertCommonEvidence(dir, {
    sliceId: SLICE,
    minScreenshots: 3,
    minimumWaits: 8,
    requiredKinds: ["input", "ack", "turn", "maintenance", "adoption"],
  });
  assert.equal(ready.slice_id, SLICE);
  const wire = assertProviderAndWire(dir, {
    minUserMessages: 1,
    minTurnResults: 2,
    minProviderStarts: 1,
  });

  const userMessage = wire.userMessages.find((record) => {
    const body = frameOf(record)?.[4] ?? {};
    return body.text === config.user_text && body.work_id === config.target.work_id &&
      body.generate_micro_plan === true;
  });
  assert(userMessage, "真实工作台未从概览发出带 generate_micro_plan 的修订 user_message");

  const turnResult = wire.turnResults.find((record) => {
    const body = frameOf(record)?.[4] ?? {};
    const pending = body.adoption_state?.pending ?? [];
    return pending.some((entry) => entry.artifact_type === "work_skeleton_suggestion");
  });
  assert(turnResult, "未收到 pending work_skeleton_suggestion 的 turn_result");
  const turnBody = frameOf(turnResult)[4];
  const pending = (turnBody.adoption_state?.pending ?? []).find(
    (entry) => entry.artifact_type === "work_skeleton_suggestion");
  const item = pending?.payload?.items?.[0] ?? pending?.items?.[0] ?? null;
  assert.equal(item?.skeleton_field, config.expected.field, "pending skeleton_field 错误");
  assert.equal(item?.skeleton_value, config.expected.value, "pending skeleton_value 错误");
  assert.equal(String(item?.body ?? ""), config.expected.body, "pending body 与显式提案不一致");
  assert.equal(turnBody.truthfulness?.production_write_performed, false, "pending 轮直接写入作品");
  assert.equal(turnBody.frame_summary?.frame_type, "execution_candidate", "pending 帧类型错误");
  assert.equal(turnBody.orchestrator_decision?.decision_type, "exploration", "pending 决策类型错误");

  const actionResult = wire.wire.find((record) => {
    const frame = frameOf(record);
    return frame?.[0] !== undefined && frame?.[3] === "action_result" &&
      frame[4]?.status === "accepted" && frame[4]?.action_type === "adopt";
  });
  assert(actionResult, "缺少真实 accept action_result");

  const adoptedTurn = wire.turnResults.find((record) => {
    const body = frameOf(record)?.[4] ?? {};
    return body.truthfulness?.artifact_adopted === true;
  });
  assert(adoptedTurn, "缺少 artifact_adopted 的采纳 turn_result");

  const appRecords = latestLogs(dir, "app-log");
  const judgment = appRecords.find(
    (record) => record.event === "judgment.decided.done" && record.action === "work_profile_revision");
  assert(judgment, "app-log 缺少 work_profile_revision 判断决策");
  const adoption = appRecords.find(
    (record) => record.event === "adoption.evaluate.done" && record.decision_type === "adopt_tentative");
  assert(adoption, "app-log 缺少 adopt_tentative 采纳评估");

  const work = withDb(dir, (db) => all(db, "SELECT main_goal, revision FROM works WHERE id = ?",
    [config.target.work_id])[0]);
  assert(work, "隔离 DB 中作品不存在");
  assert.equal(String(work.main_goal ?? ""), config.expected.value, "采纳后 works.main_goal 未回写");
  assert(Number(work.revision) >= 2, "采纳后 works.revision 未递增");

  const leaked = withDb(dir, (db) => all(db,
    "SELECT id FROM memory_items WHERE work_id = ? AND (content LIKE ? OR summary LIKE ?)",
    [config.target.work_id, `%${config.expected.value}%`, `%${config.expected.title}%`]));
  assert.equal(leaked.length, 0, "立项修订采纳产生了 world_setting 记忆副作用");

  const axFinal = `${axText(dir, "03-adopted-overview")}\n${axText(dir, "02-pending")}`;
  assert(axFinal.includes(config.expected.value), "原生窗口概览未显示采纳后的 main_goal");
  assert(axFinal.includes("全书规划建议") || axFinal.includes("采纳为全书规划"),
    "原生窗口未显示 pending 候选/采纳动作");

  const llmPrompt = latestLogs(dir, "llm-calls").map((record) =>
    String(record.prompt ?? record.request?.prompt ?? "")).join("\n");
  assert(llmPrompt.includes(config.expected.value),
    "采纳后的真实模型请求未消费新的 main_goal");

  const baseline = config.baseline ?? {};
  const finalCounts = productionTableCounts(dir);
  const newTabes = Object.keys(baseline).filter((table) =>
    (finalCounts[table] ?? 0) < (baseline[table] ?? 0));
  assert.equal(newTabes.length, 0, `生产表计数回退: ${newTabes.join(",")}`);

  const checks = {
    real_tauri_window_launched: ui.driver === "ax-native-system-ui" && ready.browser_driver_started === false,
    profile_correction_sent_from_visible_action: Boolean(userMessage),
    explicit_field_proposal_pending: Boolean(pending && item),
    no_direct_production_write_before_accept: turnBody.truthfulness?.production_write_performed === false,
    real_accept_action_resolved: Boolean(actionResult && adoptedTurn),
    works_main_goal_written_only: String(work.main_goal ?? "") === config.expected.value,
    revision_incremented: Number(work.revision) >= 2,
    no_world_setting_memory_side_effect: leaked.length === 0,
    archive_overview_shows_adopted_value: axFinal.includes(config.expected.value),
    adopted_value_enters_model_request: llmPrompt.includes(config.expected.value),
    no_production_table_regression: newTabes.length === 0,
  };
  const summary = writeNativeSummary(dir, {
    sliceId: SLICE,
    checks,
    measured: {
      work_id: config.target.work_id,
      work_title: config.target.work_title,
      turn_id: frameOf(turnResult)[4]?.turn_id,
      adopted_turn_id: frameOf(adoptedTurn)[4]?.turn_id,
      pending_field: item?.skeleton_field,
      pending_value: item?.skeleton_value,
      works_main_goal: work.main_goal,
      works_revision: Number(work.revision),
      driver: ui.driver,
      surface: "tauri",
    },
    extra: {
      behavior: {
        name: "work_profile_correction_explicit_field_proposal_adopted_into_works",
        assertions: Object.keys(checks).filter((key) => checks[key]),
      },
      turn_ids: [frameOf(turnResult)[4]?.turn_id, frameOf(adoptedTurn)[4]?.turn_id].filter(Boolean),
      key_events: ["channel.user_message.start", "judgment.decided.done",
        "channel.author_action.start", "adoption.evaluate.start", "adoption.evaluate.done",
        "channel.author_action.done", "channel.user_message.done"],
      evidence_boundary: evidenceBoundary(),
    },
  });
  assert.equal(summary.all_checks_passed, true, `AU12 原生断言失败: ${JSON.stringify(checks)}`);
  return summary;
}

const [mode, dir, extra] = process.argv.slice(2);
if (!dir) throw new Error("usage: node scripts/native_au12_evidence.mjs <prepare|capture|verify> <dir> [checkpoint]");
if (mode === "prepare") await prepare(dir);
else if (mode === "capture") capture(dir, extra);
else if (mode === "verify") verify(dir);
else throw new Error(`unknown mode: ${mode}`);
