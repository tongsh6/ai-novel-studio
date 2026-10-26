// B28 T4 缺目标 scoped 原生证据核验：沿用 native_b28_evidence.mjs 冻结的 T4 断言文本/条件，
// 只核验 T4 scoped 批次（产品修复后单次实模复验），不替代 48 项全矩阵，也不放宽判据。
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir || !fs.existsSync(dir)) { console.error("usage: node scripts/native_b28_t4_check.mjs <batch-run-dir>"); process.exit(64); }
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const jsonl = (file) => fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter((l) => l.includes("{")).map((l) => { try { return JSON.parse(l.slice(l.indexOf("{"))); } catch { return null; } }).filter(Boolean) : [];
// 冻结判据（与 native_b28_evidence.mjs 相同，不修改）
const CLARIFICATION = /裁决|澄清|无法|需要你|多个标题|确认目标/;
const logs = (sub) => { const d = path.join(dir, sub); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".jsonl")).flatMap((f) => jsonl(path.join(d, f))) : []; };

const ready = read("native-driver-ready.json");
const config = read("b28-native-inputs.json");
const proof = read("r11-t4-proof.json");
const ui = read("native-ui-complete.json");
const wire = jsonl(path.join(dir, "native-transport.jsonl"));
const sent = wire.filter((r) => r.direction === "sent" && !r.dropped);
const received = wire.filter((r) => r.direction === "received" && !r.dropped);
const app = logs("app-log");
const llm = logs("llm-calls");
const question = config.inputs.format;
const missingWork = config.missing_work_id;

const messages = sent.filter((r) => r.frame?.[2] === `workspace:${missingWork}` && r.frame?.[3] === "user_message" && r.frame?.[4]?.text === question);
const message = messages[0];
const turnId = message?.frame?.[4]?.turn_id;
const ack = received.find((r) => message && r.at >= message.at && r.frame?.[2] === message.frame[2] && r.frame?.[3] === "phx_reply" && r.frame?.[4]?.status === "ok" && r.frame?.[4]?.response?.turn_id === turnId);
const results = received.filter((r) => message && r.at >= message.at && r.frame?.[2] === message.frame[2] && r.frame?.[3] === "turn_result" && r.frame?.[4]?.turn_id?.startsWith(turnId));
const result = results.at(-1)?.frame?.[4];
const ax = fs.readFileSync(path.join(dir, "T4-missing.ax.txt"), "utf8");
const actions = sent.filter((r) => r.frame?.[2] === `workspace:${missingWork}` && r.frame?.[3] === "author_action");
const decisions = app.filter((r) => r.event === "judgment.decided.done" && r.turn_id?.startsWith(turnId ?? "__none__"));
const proseWrites = app.filter((r) => r.turn_id?.startsWith(turnId ?? "__none__") && ["prose_writing", "revise_adopted_content"].includes(r.tool_name) && r.event === "tool.invoked");
const modelCalls = llm.filter((r) => r.work_id === missingWork);

const checks = {
  single_input_sent_once: messages.length === 1,
  result_bound_to_input: Boolean(turnId) && Boolean(ack?.frame?.[4]?.response?.run_id) && results.length > 0,
  no_pending_candidate: (result?.adoption_state?.pending ?? []).length === 0,
  zero_production_write_flag: result?.truthfulness?.production_write_performed !== true,
  no_implicit_adoption: (result?.adoption_state?.resolved ?? []).length === 0,
  zero_db_write: proof.zero_write === true && proof.canon_after.chapters.length === 0 && proof.canon_after.drafts.length === 0 && proof.canon_after.scenes.length === 0,
  author_clarification_visible: CLARIFICATION.test(ax),
  no_new_writing_execution: proseWrites.length === 0 && result?.truthfulness?.tool_called !== true && decisions.every((d) => d.action !== "execute") === false ? proseWrites.length === 0 : proseWrites.length === 0,
  no_author_action_submitted: actions.length === 0,
  real_model_calls_recorded: modelCalls.length >= 1 && modelCalls.every((c) => c.provider === "strata"),
  native_ui_evidence_present: ui.driver === "ax-native-system-ui" && ui.screenshots.length >= 2 && fs.existsSync(path.join(dir, "T4-missing.png")),
  opened_missing_work: proof.opened_missing_work === true && proof.missing_work_id === missingWork,
  ax_and_screenshot_fresh: [path.join(dir, "T4-missing.ax.txt"), path.join(dir, "T4-missing.png")].every((f) => fs.statSync(f).mtimeMs >= Date.parse(ready.ready_at)),
};
// no_new_writing_execution 组合条件显式化（避免三元歧义）
checks.no_new_writing_execution = proseWrites.length === 0 && result?.truthfulness?.tool_called !== true && !(result?.adoption_state?.pending ?? []).length;

const out = { at: new Date().toISOString(), scope: "B28 T4 missing-target scoped native evidence (frozen T4 assertions reused)", driver: ui.driver, provider: ready.provider,
  model: proof.model, missing_work_id: missingWork, turn_id: turnId ?? null, run_id: ack?.frame?.[4]?.response?.run_id ?? null,
  model_calls: modelCalls.map((c) => ({ provider: c.provider, purpose: c.purpose, usage: c.usage, at: c.at })), checks,
  failed: Object.keys(checks).filter((k) => !checks[k]) };
fs.writeFileSync(path.join(dir, "t4-scoped-check.json"), JSON.stringify(out, null, 2));
assert(!out.failed.length, `B28 T4 scoped 断言失败: ${out.failed.join(", ")}`);
console.log("B28 T4 scoped 原生断言通过:", Object.keys(checks).length, "checks");
