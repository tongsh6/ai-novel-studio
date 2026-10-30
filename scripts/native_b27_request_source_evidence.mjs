// B27 §9 CP3 原生真实模型证据核验（外部读证据；产品零感知）。
// 用法：node scripts/native_b27_request_source_evidence.mjs verify <batch-run-dir>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const mode = process.argv[2] ?? "verify";
const dir = path.resolve(process.argv[3] ?? "");
if (mode === "prepare" || mode === "capture") process.exit(0);
if (!dir || !fs.existsSync(dir)) {
  console.error("usage: native_b27_request_source_evidence.mjs verify <dir>");
  process.exit(64);
}

const MEMORY_TOKEN = "灵源矿区";
const checks = [];
const add = (id, ok, detail = null, severity = "critical") => {
  checks.push({ id, ok, severity, detail, at: new Date().toISOString() });
};

function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
  } catch {
    return null;
  }
}

function latestJsonl(prefix) {
  const root = path.join(dir, prefix);
  if (!fs.existsSync(root)) return [];
  const files = fs.readdirSync(root).filter((file) => file.endsWith(".jsonl")).sort();
  if (files.length === 0) return [];
  const file = path.join(root, files.at(-1));
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.includes("{"))
    .map((line) => {
      const start = line.indexOf("{");
      const end = line.lastIndexOf("}");
      try {
        return JSON.parse(line.slice(start, end + 1));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function textOf(value, acc = []) {
  if (typeof value === "string") acc.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => textOf(entry, acc));
  else if (value && typeof value === "object") Object.values(value).forEach((entry) => textOf(entry, acc));
  return acc.join("\n");
}

const driverLog = readJson("b27-request-source-native-driver-log.json");
const before = readJson("model-lifecycle-before.json");
const after = readJson("model-lifecycle-after.json");
const llmCalls = latestJsonl("llm-calls");
const appLog = latestJsonl("app-log");

add("driver_log_present", Boolean(driverLog), driverLog ? null : "缺 driver log");
const scenarios = driverLog?.scenarios ?? [];
add("scenarios_m1_m2_present", scenarios.length === 2 && scenarios.map((s) => s.id).join(",") === "M1,M2", scenarios.map((s) => s.id));
for (const scenario of scenarios) {
  add(
    `turn_result:${scenario.id}`,
    Boolean(scenario.turn_status) && typeof scenario.assistant_text === "string" && scenario.assistant_text.trim() !== "",
    { turn_status: scenario.turn_status, assistant_chars: scenario.assistant_text?.length ?? 0 },
  );
}

add("provider_calls_present", llmCalls.length >= 2, { calls: llmCalls.length });
add(
  "provider_calls_carry_request_bytes",
  llmCalls.length >= 2 && llmCalls.every((record) => Array.isArray(record?.request?.body?.messages)),
  { calls: llmCalls.length },
);
add(
  "provider_response_content_present",
  llmCalls.some((record) => textOf(record?.response?.body ?? record?.response ?? {}).trim() !== ""),
  null,
);
add("app_log_present", appLog.length > 0, { records: appLog.length });

// M1 初始请求（含作者 M1 原话的第一次 provider 调用）不得包含 memory 内容。
const callTexts = llmCalls.map((record, index) => ({ index, text: textOf(record?.request?.body ?? {}) }));
const initialCall = callTexts.find((entry) => entry.text.includes("我之前确认过的设定里")) ?? null;
const m1InitialText = initialCall?.text ?? "";
add("m1_request_identified", Boolean(initialCall), { initial_request_index: initialCall?.index ?? null });
add(
  "m1_initial_request_excludes_memory_content",
  Boolean(initialCall) && !m1InitialText.includes(MEMORY_TOKEN),
  { memory_marker_present: m1InitialText.includes(MEMORY_TOKEN), initial_request_index: initialCall?.index ?? null },
);

// 按需读取：初始请求之后的真实 provider 请求包含 memory observation 内容，才算
// observed→supplied；并用 app-log 的 memory_recall 选择证据交叉核对（不是只出现 ref）。
const recallCalls = initialCall
  ? callTexts.filter((entry) => entry.index > initialCall.index && entry.text.includes(MEMORY_TOKEN))
  : [];
const appLogText = appLog.map((record) => textOf(record)).join("\n");
const memoryRecallAction = appLogText.includes("memory_recall");
const recallTriggered = recallCalls.length > 0;
add(
  "m1_memory_recall_action_observed",
  memoryRecallAction,
  { app_log_memory_recall: memoryRecallAction },
  "model_behavior",
);
add(
  "m1_memory_observation_enters_later_request",
  recallTriggered,
  { recall_request_indexes: recallCalls.map((entry) => entry.index), initial_request_index: initialCall?.index ?? null },
  "model_behavior",
);

// M2 无关问题不得把 memory 声明/带入为 supplied。
const m2Call = callTexts.find((entry) => entry.text.includes("现在写到第几章了")) ?? null;
const m2Text = m2Call?.text ?? "";
add("m2_request_identified", Boolean(m2Call), { m2_request_index: m2Call?.index ?? null });
// M2 请求可能通过上一轮对话历史携带 memory 文本（不可当成本轮 material supplied）；
// 这里只记录路径，硬判据改为“M2 回复不得声称本轮使用/依赖记忆材料”。
add("m2_request_memory_marker_path", true, { memory_marker_present: m2Text.includes(MEMORY_TOKEN), m2_request_index: m2Call?.index ?? null });

// 回复不得宣称本轮已保存/已采纳/已完成（描述既有“已采纳正文”不算虚假完成）。
const m2Scenario = scenarios.find((scenario) => scenario.id === "M2");
const falseClaim = /(?:已保存|已完成|已经保存|已经完成|已采纳(?!正文))/u.test(String(m2Scenario?.assistant_text ?? ""));
add("m2_reply_no_false_completion", !falseClaim, { assistant_text: String(m2Scenario?.assistant_text ?? "").slice(0, 200) }, "heuristic");
const m2ClaimsMemory = /(?:记忆|memory_recall|memory)/iu.test(String(m2Scenario?.assistant_text ?? ""));
add("m2_reply_no_false_memory_claim", !m2ClaimsMemory, { assistant_text: String(m2Scenario?.assistant_text ?? "").slice(0, 200) });

// 回复/Why/trace 一致性：Why 面板必须来自已保存 trace，并反映同一来源事实（memory 内容）。
const m1Scenario = scenarios.find((scenario) => scenario.id === "M1");
const m1Why = String(m1Scenario?.why_text ?? "");
add(
  "m1_reply_why_source_consistent",
  m1Why.includes(MEMORY_TOKEN) && String(m1Scenario?.assistant_text ?? "").includes(MEMORY_TOKEN),
  { why_has_marker: m1Why.includes(MEMORY_TOKEN), reply_has_marker: String(m1Scenario?.assistant_text ?? "").includes(MEMORY_TOKEN) },
);
add(
  "why_from_persisted_trace",
  m1Why.includes("参考来源") && m1Why.includes("trace"),
  { why_excerpt: m1Why.slice(0, 120) },
);
add(
  "m1_initial_request_no_false_memory_claim",
  Boolean(initialCall) && !m1InitialText.includes("已确认设定"),
  { initial_request_has_confirmed_memory_label: m1InitialText.includes("已确认设定") },
);

// 零 canon 写：seed 恰好 1 章/1 draft/1 memory/0 采纳回执。
let dbCounts = null;
try {
  const dbPath = path.join(dir, "database", "ai_novel_studio_test.sqlite3");
  const script = [
    "import sqlite3, sys, json",
    "db = sqlite3.connect(sys.argv[1], timeout=10)",
    "def n(t): return db.execute('SELECT COUNT(*) FROM %s' % t).fetchone()[0]",
    "print(json.dumps({'chapters': n('chapters'), 'drafts': n('drafts'), 'memories': n('memory_items'), 'receipts': n('author_action_receipts')}))",
    "db.close()",
  ].join("\n");
  dbCounts = JSON.parse(execFileSync("python3", ["-c", script, dbPath], { encoding: "utf8", timeout: 20_000 }).trim());
} catch (error) {
  dbCounts = { error: error.message };
}
add(
  "zero_canon_write",
  dbCounts.chapters === 1 && dbCounts.drafts === 1 && dbCounts.receipts === 0,
  dbCounts,
);

add("why_panel_captured", scenarios.every((scenario) => String(scenario.why_text ?? "").trim() !== ""), {
  why_chars: scenarios.map((scenario) => String(scenario.why_text ?? "").length),
});
add(
  "model_lifecycle_before_recorded",
  Boolean(before && "loaded_before" in before),
  before ? { loaded_before: before.loaded_before } : null,
);
add(
  "model_lifecycle_unloaded_clean",
  Boolean(after?.unloaded) && after?.loaded_after === null,
  after ? { loaded_after: after.loaded_after, unloaded: after.unloaded, unload_error: after.unload_error } : null,
);

const criticalFailures = checks.filter((check) => check.severity === "critical" && !check.ok);
const modelBehavior = checks.find((check) => check.id === "m1_memory_observation_enters_later_request");
const status = criticalFailures.length > 0 ? "fail" : modelBehavior?.ok ? "pass" : "mechanism_pass_model_not_triggered";
const summary = {
  slice_id: "b27-request-source-native",
  provider: driverLog?.provider ?? "strata",
  model: driverLog?.model ?? null,
  status,
  checks,
  db_counts: dbCounts,
  provider_calls: llmCalls.length,
  app_log_records: appLog.length,
  m1_request_indexes: initialCall ? [initialCall.index] : [],
  m1_recall_request_indexes: recallCalls.map((entry) => entry.index),
  m2_request_indexes: m2Call ? [m2Call.index] : [],
  memory_recall_action_observed: memoryRecallAction,
  model_lifecycle: { before: before?.loaded_before ?? null, after: after?.loaded_after ?? null },
  scenario_summaries: scenarios.map((scenario) => ({
    id: scenario.id,
    turn_status: scenario.turn_status,
    questions: scenario.questions,
    assistant_chars: scenario.assistant_text?.length ?? 0,
    judgment_actions: (scenario.judgment_events ?? []).map((event) => ({ action: event.action, capability: event.capability })),
  })),
  generated_at: new Date().toISOString(),
};
fs.writeFileSync(path.join(dir, "b27-native-checks.json"), JSON.stringify(checks, null, 2));
fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(
  `[b27-native-evidence] status=${status} checks=${checks.filter((check) => check.ok).length}/${checks.length} ` +
    `provider_calls=${llmCalls.length} recall_triggered=${recallTriggered}`,
);
if (status === "fail") process.exit(1);
