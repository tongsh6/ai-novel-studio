// live verifier 端到端合成证据测试：构造一个 provider=strata 的完整批次目录，
// 验证机制判据通过并写 summary；缺 strata 卸载核验 / 错 journey / 截图不足时失败关闭。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyLiveBatch } from "./authoring_live_evidence.mjs";
import { APP_BUNDLE, NATIVE_DRIVER } from "./scenario_evidence.mjs";

const AUTHOR =
  "先看看第01章现在的设定和正文，再按现有设定写一段更紧张的开场：主角在雨夜收到一封没有署名的信，生成待采纳的候选，先不要保存。";
const TURN = "message_live_1";
const RUN = "run_live_1";
const WORK = "work-live-1";
const SESSION = "session-live-1";

const readyAt = new Date(Date.now() - 3600_000).toISOString();
const finishedAt = new Date(Date.now() - 1800_000).toISOString();

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

const png = () => Buffer.from("89504e470d0a1a0a", "hex");

const system = () => ({ role: "system", content: "你在 AI Novel Studio 中工作，作者是唯一裁决者。" });
const appBase = () => ({ role: "user", content: "【应用数据 · application_base · 非作者原话】\n创作判断器规则。" });
const author = () => ({ role: "user", content: AUTHOR });
const scope = () => ({ role: "user", content: "【应用数据 · scope_update · 以最新版本为准】\n版本：{\"scope_revision\":1}" });

const requestMessages = [system(), appBase(), author(), scope()];

function llmRecord({ usage = true } = {}) {
  return {
    ts: "2026-11-03T10:00:01.000Z",
    turn_id: TURN,
    provider_call_ref: "pcall_live_1",
    provider_run_ref: "prun_live_1",
    provider: "strata",
    model: "iq3_s",
    request_body: { messages: requestMessages, tools: [], tool_choice: "auto" },
    response: {
      status: 200,
      body: {
        content: "我先核对第01章现有内容，再给出候选。",
        tool_calls: [],
        ...(usage ? { usage: { input_tokens: 1024, output_tokens: 128, total_tokens: 1152 } } : {}),
      },
    },
  };
}

const turnBody = {
  turn_id: TURN,
  status: "conversational",
  agent_run: { run_id: RUN, status: "completed" },
  assistant_message: { text: "我先核对第01章现有内容，再给出候选。" },
  adoption_state: {
    pending: [{ artifact_id: "as_live_1", artifact_type: "chapter_draft", adoption_status: "TENTATIVE" }],
  },
  available_actions: [],
};

function checkpoint(name, { canonHash = "canon-content", counts = {} } = {}) {
  return {
    checkpoint: name,
    at: "2026-11-03T10:00:00.000Z",
    db_production_counts: {
      mutations: 0,
      author_action_receipts: 0,
      memory_items: 0,
      chapters: 0,
      drafts: 0,
      ...counts,
    },
    authoring_canon: {
      version: 2,
      at: "2026-11-03T10:00:00.000Z",
      tables: {
        works: { row_count: 1, rows_sha256: "works-rows", canon_sha256: canonHash },
        author_action_receipts: { row_count: 0, rows_sha256: "receipts", canon_sha256: "receipts" },
      },
    },
  };
}

function buildDir({ withStrataUnloaded = true, screenshots = 3 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-live-verify-"));
  fs.mkdirSync(path.join(dir, "app-log"), { recursive: true });
  fs.mkdirSync(path.join(dir, "llm-calls"), { recursive: true });

  writeJson(path.join(dir, "native-driver-ready.json"), {
    driver: "external-system-ui",
    browser_driver_started: false,
    run_ref: "run-ref-live",
    provider: "strata",
    slice_id: "b71-first-consumer",
    ready_at: readyAt,
    app_path: "/tmp/B71 Live.app",
  });
  const shotNames = ["01-workbench.png", "after-input.png", "final.png", "why.png"].slice(0, screenshots);
  for (const name of shotNames) fs.writeFileSync(path.join(dir, name), png());
  writeJson(path.join(dir, "native-ui-complete.json"), {
    harness_run_ref: "run-ref-live",
    driver: NATIVE_DRIVER,
    app_bundle: APP_BUNDLE,
    scope: "b71-first-consumer",
    screenshots: shotNames,
  });

  const kinds = ["input", "ack", "turn", "maintenance", "maintenance", "maintenance", "maintenance", "maintenance", "maintenance"];
  writeJsonl(
    path.join(dir, "native-driver-commands.jsonl"),
    kinds.flatMap((kind, index) => [
      { op: "begin", id: `wait-${index}`, kind },
      { op: "finish", id: `wait-${index}`, kind },
    ]),
  );
  writeJsonl(
    path.join(dir, "wait-events.jsonl"),
    kinds.flatMap((kind, index) => [
      { event: "wait_start", kind, at: Date.now() - (kinds.length - index) * 1000, id: `wait-${index}` },
      { event: "wait_end", kind, ended_at: Date.now() - (kinds.length - index) * 1000 + 500, id: `wait-${index}` },
    ]),
  );
  writeJson(path.join(dir, "wait-stats.json"), { active: null, completed: kinds.length });
  writeJsonl(path.join(dir, "heartbeat.jsonl"), [{ at: readyAt }]);

  writeJsonl(path.join(dir, "app-log", "2026-11-03.jsonl"), [
    { at: "2026-11-03T10:00:00.000Z", event: "provider_gateway.complete.start", provider: "strata" },
  ]);
  writeJsonl(path.join(dir, "llm-calls", "2026-11-03.jsonl"), [llmRecord()]);

  writeJsonl(path.join(dir, "native-transport.jsonl"), [
    {
      at: "2026-11-03T10:00:00.500Z",
      direction: "sent",
      frame: [null, null, "workspace:test", "user_message", { text: AUTHOR, turn_id: TURN }],
    },
    {
      at: "2026-11-03T10:00:02.000Z",
      direction: "received",
      frame: [null, null, "workspace:test", "turn_result", turnBody],
    },
    {
      at: "2026-11-03T10:00:00.400Z",
      direction: "http",
      method: "GET",
      path: "/api/works/w/sessions/resume",
      status: 200,
    },
  ]);

  writeJson(path.join(dir, "native-b71-config.json"), {
    slice_id: "b71-first-consumer",
    journey: "live",
    provider: "strata",
    target: { work_id: WORK, work_title: "B71 live", session_id: SESSION },
    message: AUTHOR,
  });
  writeJson(path.join(dir, "b71-start.json"), checkpoint("start"));
  writeJson(path.join(dir, "b71-final.json"), checkpoint("final"));
  writeJson(path.join(dir, "native-b71-driver-log.json"), {
    slice_id: "b71-first-consumer",
    provider: "strata",
    model: "iq3_s",
    run: { status: "completed" },
    why: { opened: true, before: { llm_records: 1, provider_runs: 1 }, after: { llm_records: 1, provider_runs: 1 } },
  });
  writeJson(path.join(dir, "strata-slot.json"), {
    schema: "b71-strata-slot/v1",
    model: "iq3_s",
    loaded_before: true,
    loaded_after: withStrataUnloaded ? false : true,
    unloaded: withStrataUnloaded,
    finished_at: finishedAt,
  });
  return dir;
}

test("live verifier：完整 provider=strata 批次通过机制判据并写 summary", () => {
  const dir = buildDir();
  const { checks, summary } = verifyLiveBatch(dir);
  assert.deepEqual(checks.failed_mechanism, []);
  assert.equal(checks.checks.mechanism.ir_projection_structure, true);
  assert.equal(checks.checks.mechanism.author_bytes_exact, true);
  assert.equal(checks.checks.mechanism.unadopted_zero_write, true);
  assert.equal(checks.checks.mechanism.usage_collected, true);
  assert.equal(checks.checks.mechanism.why_replay_zero_provider, true);
  assert.equal(summary.provider, "strata");
  assert.equal(summary.verdict.mechanism, "pass");
  assert.equal(summary.verdict.full_g1_g6_signed, false);
  assert(summary.not_signed.includes("I10_literary_quality_not_signed"));
  assert(fs.existsSync(path.join(dir, "summary.json")));
  assert(fs.existsSync(path.join(dir, "native-b71-checks.json")));
  assert(fs.existsSync(path.join(dir, "native-ws-frames.json")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("live verifier：strata 未核验卸载时失败关闭", () => {
  const dir = buildDir({ withStrataUnloaded: false });
  assert.throws(() => verifyLiveBatch(dir), /strata 批次结束必须核验 loaded=null/u);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("live verifier：截图不足或缺 strata-slot 时失败关闭", () => {
  const fewShots = buildDir({ screenshots: 1 });
  assert.throws(() => verifyLiveBatch(fewShots), /原生截图不足/u);
  fs.rmSync(fewShots, { recursive: true, force: true });
  const dir = buildDir();
  fs.rmSync(path.join(dir, "strata-slot.json"));
  assert.throws(() => verifyLiveBatch(dir), /缺少 strata-slot\.json/u);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("live verifier：journey/provider 不匹配时拒绝", () => {
  const dir = buildDir();
  const configFile = path.join(dir, "native-b71-config.json");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  writeJson(configFile, { ...config, journey: "pending" });
  assert.throws(() => verifyLiveBatch(dir), /live verifier 只接受 journey=live/u);
  fs.rmSync(dir, { recursive: true, force: true });
});
