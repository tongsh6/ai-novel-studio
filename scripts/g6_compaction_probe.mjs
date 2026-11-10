// B81 CP5/G6 压缩证据探针（独立工具，非验收 gate）。
//
// 用途：对「answer-mode 双 run + 自动维护触发」批次目录做 G6 判据核查：
// 复用批次已有证据（DB / driver-log / 页面 capture / wire），输出 G6-1..G6-6 判据表，
// 不写产品代码、不改批次、不代签实模行为。判据定义见 tasks/slices/B81-session-canonical-authoring-history.md §8.6.2。
//
// 用法：node scripts/g6_compaction_probe.mjs <batch-artifact-dir>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir || !fs.existsSync(dir)) {
  console.error("usage: node scripts/g6_compaction_probe.mjs <batch-artifact-dir>");
  process.exit(64);
}

const readJson = (name) => {
  const file = path.join(dir, name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
};

// 页面可见文案是「较早的 N 项创作过程已整理」，AX 树里该细条是按钮
// 「查看已整理的较早创作过程」（标题与可见文本不同），两者都要认。
const stripText = /较早的\s*\d+\s*项创作过程已整理|创作过程已整理|查看已整理的较早创作过程/u;

function dbQuery(sql) {
  const dbFile = path.join(dir, "database", "ai_novel_studio_test.sqlite3");
  if (!fs.existsSync(dbFile)) return [];
  try {
    const out = execFileSync("sqlite3", ["-json", dbFile, sql], { encoding: "utf8" });
    return out.trim() ? JSON.parse(out) : [];
  } catch {
    return [];
  }
}

const parseJson = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const messages = dbQuery("select id, sequence, run_id, role, message from authoring_session_messages order by sequence");
const checkpointMessages = messages.filter((row) => row.role === "checkpoint");
const userMessages = messages.filter((row) => row.role === "user");
const checkpointEventRows = dbQuery(
  "select run_id, event_type, payload from agent_events where event_type = 'checkpoint_created' order by rowid",
);
const driverLog = readJson("native-b71-driver-log.json") ?? {};
const multiTurn = driverLog.multi_turn ?? null;
const config = readJson("native-b71-config.json") ?? {};
const captures = fs
  .readdirSync(dir)
  .filter((file) => file.endsWith(".ax.txt"))
  .map((file) => ({ name: file.replace(/\.ax\.txt$/u, ""), text: fs.readFileSync(path.join(dir, file), "utf8") }));
const captureText = (name) => captures.find((item) => item.name === name)?.text ?? "";

function checkpointCallIds(row) {
  const payload = parseJson(row?.message) ?? {};
  const blocks = Array.isArray(payload?.blocks) ? payload.blocks : [];
  return blocks.flatMap((block) => block?.covers?.call_ids ?? []);
}

const covers = checkpointMessages.map((row) => ({ sequence: row.sequence, run_id: row.run_id, call_ids: checkpointCallIds(row) }));
const allCoverIds = covers.flatMap((entry) => entry.call_ids);
const overlap = covers.length >= 2
  ? covers[0].call_ids.filter((id) => covers.slice(1).some((entry) => entry.call_ids.includes(id)))
  : [];

// G6-1：会话历史里已完成交换数量（driver 记录的 exchange_facts）。
const exchangeFacts = multiTurn?.exchange_facts ?? driverLog?.multi_turn?.exchange_facts ?? null;
const g6_1 = {
  ok: Number.isFinite(Number(exchangeFacts?.complete_exchanges)) && Number(exchangeFacts?.complete_exchanges) >= 4,
  detail: { complete_exchanges: exchangeFacts?.complete_exchanges ?? null },
};

// G6-2：checkpoint 由产品压缩路径提交（事件 + 会话 canonical 消息 + covers/omissions/summary）。
const blockComplete = checkpointMessages.every((row) => {
  const payload = parseJson(row?.message) ?? {};
  const blocks = Array.isArray(payload?.blocks) ? payload.blocks : [];
  return blocks.length > 0 && blocks.every((block) => Array.isArray(block?.covers?.call_ids) && block?.summary);
});
const g6_2 = {
  ok: checkpointEventRows.length >= 1 && checkpointMessages.length >= 1 && covers.every((entry) => entry.call_ids.length > 0) && blockComplete,
  detail: { events: checkpointEventRows.length, messages: checkpointMessages.length, covers, block_complete: blockComplete },
};

// G6-3：重复安全点不重复追加同一批交换（covers 无重叠；事件/消息一一对应）。
const g6_3 = {
  ok: overlap.length === 0 && checkpointEventRows.length === checkpointMessages.length,
  detail: { overlap, events: checkpointEventRows.length, messages: checkpointMessages.length },
};

// G6-4：压缩后真实请求携带折叠投影（需要 provider 请求体证据；确定性 provider 不写
// llm-calls 日志时不可判——如实 null，不猜测）。
const llmCallsDir = path.join(dir, "llm-calls");
const llmCallFiles = fs.existsSync(llmCallsDir) ? fs.readdirSync(llmCallsDir).filter((file) => file.endsWith(".jsonl")) : [];
const llmCalls = llmCallFiles.flatMap((file) =>
  fs
    .readFileSync(path.join(llmCallsDir, file), "utf8")
    .split("\n")
    .filter((line) => line.includes("{"))
    .map((line) => parseJson(line.slice(line.indexOf("{"))))
    .filter(Boolean),
);
const g6_4 = llmCalls.length > 0
  ? (() => {
      const texts = llmCalls.map((record) => JSON.stringify(record?.request ?? record?.prompt ?? {}));
      const leaked = allCoverIds.filter((callId) => texts.slice(-1)[0]?.includes?.(callId));
      return {
        ok: leaked.length === 0,
        detail: { llm_calls: llmCalls.length, covered_call_ids: allCoverIds, leaked_in_last_request: leaked },
      };
    })()
  : { ok: null, reason: "provider_request_body_not_captured_for_deterministic_provider", detail: { llm_calls: 0 } };

// G6-5：作者可见细条 + 展开四要素（页面 capture）。
// 细条出现在触发后的页面快照（after-second-round）或展开快照（after-expanded）；
// 触发前的 after-maintenance 快照不含细条是正常时序，不能拿来否定触发。
const maintenanceAx = captureText("after-second-round") || captureText("after-expanded") || captureText("after-maintenance");
const expandedAx = captureText("after-expanded");
const expandedFactors = {
  heading: /已整理的较早记录/u.test(expandedAx),
  reason: /为了保持这次创作始终清晰连贯/u.test(expandedAx),
  original_kept: /原始记录仍然保留/u.test(expandedAx),
  full_record_entry: /查看完整记录/u.test(expandedAx),
};
const g6_5 = {
  ok:
    stripText.test(maintenanceAx) &&
    expandedFactors.heading &&
    expandedFactors.reason &&
    expandedFactors.original_kept &&
    expandedFactors.full_record_entry,
  detail: {
    strip_visible: stripText.test(maintenanceAx),
    strip_capture: captureText("after-second-round") ? "after-second-round" : "after-expanded",
    expanded_capture: "after-expanded",
    factors: expandedFactors,
  },
};

// G6-6：未完成交换不被压缩（covers 只含已完成的 call）；作者原话仍在会话历史。
const canonicalText = messages.map((row) => row.message).join("\n");
const missingCoverIds = allCoverIds.filter((callId) => !canonicalText.includes(callId));
const g6_6 = {
  ok: allCoverIds.length > 0 && missingCoverIds.length === 0 && userMessages.length >= 2,
  detail: { covered_call_ids: allCoverIds, missing_covered_ids: missingCoverIds, user_messages: userMessages.length },
};

const checks = {
  G6_1_completed_exchanges_present: g6_1,
  G6_2_checkpoint_committed: g6_2,
  G6_3_no_duplicate_compaction: g6_3,
  G6_4_next_request_folded: g6_4,
  G6_5_strip_and_expand_visible: g6_5,
  G6_6_original_preserved: g6_6,
};
const failed = Object.entries(checks).filter(([, value]) => value.ok === false).map(([key]) => key);
const undecided = Object.entries(checks).filter(([, value]) => value.ok === null).map(([key]) => key);

const report = {
  schema: "g6-compaction-probe/v1",
  artifact_dir: path.relative(process.cwd(), dir),
  git_head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  config: { journey: config.journey ?? null, provider: config.provider ?? null },
  checks,
  failed,
  undecided,
  verdict: failed.length === 0 ? (undecided.length === 0 ? "pass" : "pass_with_undecided") : "fail",
};

const outDir = path.join(dir, "g6-probe");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "g6-checks.json"), JSON.stringify(report, null, 2));
const lines = [
  "# G6 压缩证据探针",
  "",
  `- artifact: ${report.artifact_dir}`,
  `- verdict: ${report.verdict}`,
  `- failed: ${failed.join(", ") || "none"}`,
  `- undecided: ${undecided.join(", ") || "none"}`,
  "",
  "| 判据 | ok | detail |",
  "|---|---|---|",
  ...Object.entries(checks).map(
    ([key, value]) => `| ${key} | ${value.ok === null ? "null" : value.ok} | ${JSON.stringify(value.detail ?? value.reason ?? {})} |`,
  ),
];
fs.writeFileSync(path.join(outDir, "g6-checks.md"), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
