// B29 原生验收的只读证据适配：测量动作全部由外部 macOS AX/CGEvent 驱动真实 Tauri 窗口完成。
// 本文件只消费隔离批次的既有证据（seed.log / native-transport.jsonl / app-log / llm-calls /
// 只读 SQLite 快照 / AX 文本与截图），不操作产品、不读取产品验收开关。
// 判据 1:1 对齐 frontend/slice-verify/external-ui-driver.mjs 的
// driveB29ExistingCharacterRoleRevision（浏览器 surface canonical 23 checks / 5 trials），
// 只把驱动从 Chromium 页面换成原生窗口 AX/CGEvent，断言条件与语义不降级。
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SLICE_ID = "b29-existing-character-role-revision";
export const WORK_TITLE = "B29 已有角色叙事身份复现作品";
export const INPUTS = Object.freeze({
  t1: "指定老沈为主角",
  t2: "指定沈砚为主角",
  t3: "老沈适合当主角吗？只讨论，不要改作品设定",
  t4_followup: "现在谁是主角？",
  t5_discard: "把阿鸢设为主角",
  t5_repeat: "指定老沈为主角",
  t5_cross_work: "把另一个作品里的沈砚设为主角",
});
export const CHECKPOINTS = Object.freeze([
  "seed",
  "t1-before",
  "t1-after",
  "t2-before",
  "t2-after",
  "t3-before",
  "t3-after",
  "t4-before-refresh",
  "t4-after-refresh",
  "t4-after-followup",
  "t5-before-discard",
  "t5-after-discard",
  "t5-before-repeat",
  "t5-after-repeat",
  "t5-before-cross-work",
  "t5-after-cross-work",
  "final",
]);

// strata scoped 批次只覆盖 T1 正例 + T2 同名澄清负例（不重跑 23 项矩阵）。
export const STRATA_CHECKPOINTS = Object.freeze([
  "seed",
  "t1-before",
  "t1-after",
  "t2-before",
  "t2-after",
  "final",
]);

const read = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
const write = (dir, file, value) => {
  assert(!fs.existsSync(path.join(dir, file)), `证据不得覆盖: ${file}`);
  fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2));
};
const jsonl = (file) =>
  fs.readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.includes("{"))
    .map((line) => JSON.parse(line.slice(line.indexOf("{"))));
const logs = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort().flatMap((f) => jsonl(path.join(dir, f)))
    : [];
const sha256 = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");
const shaFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// llm-calls 记录里真实模型 id 的位置随 provider 实现不同：Strata 把 OpenAI 响应放在
// response.body(JSON 字符串) 与 response.usage.model；request.body 不含 model。
// provider 名（"strata"）不是模型 id，必须排除。
function llmModelOf(record) {
  const parsedBody = (() => {
    const body = record?.response?.body;
    if (typeof body !== "string") return body && typeof body === "object" ? body : null;
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  })();
  const candidates = [
    record?.request?.body?.model,
    parsedBody?.model,
    record?.response?.usage?.model,
    record?.response?.model,
    record?.model,
  ];
  const provider = record?.provider ?? null;
  const picked = candidates.find((value) => typeof value === "string" && value && value !== provider);
  return picked ?? null;
}

function seedFields(dir) {
  const seedPath = path.join(dir, "seed.log");
  assert(fs.existsSync(seedPath), "seed.log 缺失");
  const tokens = fs.readFileSync(seedPath, "utf8").split(/\s+/);
  const field = (name) => {
    const prefix = `${name}=`;
    const token = tokens.find((part) => part.startsWith(prefix));
    return token ? token.slice(prefix.length) : null;
  };
  const required = [
    "work_id",
    "session_id",
    "chapter_id",
    "shen_character_id",
    "gu_character_id",
    "shen_small_character_id",
  ];
  return Object.fromEntries(required.map((name) => [name, field(name)]));
}

const dbPath = (dir) => path.join(dir, "database", "ai_novel_studio_test.sqlite3");

function withDb(dir, fn) {
  const db = new DatabaseSync(dbPath(dir), { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const all = (db, sql, params = []) => db.prepare(sql).all(...params);
const parseAliases = (value) => {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// 与浏览器 driver 的 facts()/acceptedDraftHashes() 同口径：角色主档案 + 记忆 + 正文 hash。
export function characterFacts(db, workId) {
  const characters = all(
    db,
    "SELECT id, name, aliases, role, narrative_role, summary, status FROM characters WHERE work_id = ? ORDER BY name, id",
    [workId],
  );
  const memories = all(
    db,
    "SELECT id, type, status, content, summary FROM memory_items WHERE work_id = ? ORDER BY inserted_at",
    [workId],
  );
  const drafts = all(db, "SELECT id, content FROM drafts WHERE work_id = ? ORDER BY id", [workId]);
  return {
    work_id: workId,
    characters: characters.map((row) => ({
      id: row.id,
      name: row.name,
      aliases: parseAliases(row.aliases),
      role: row.role ?? null,
      narrative_role: row.narrative_role ?? null,
      summary: row.summary ?? null,
      status: row.status ?? null,
    })),
    character_count: characters.length,
    memories: memories.map((row) => ({
      id: row.id,
      type: row.type ?? null,
      status: row.status ?? null,
      content: String(row.content ?? ""),
      content_sha256: sha256(row.content),
      summary: row.summary ?? null,
    })),
    memory_count: memories.length,
    drafts: drafts.map((row) => ({ id: row.id, content_sha256: sha256(row.content) })),
  };
}

function captureFacts(dir) {
  return withDb(dir, (db) => {
    const seed = seedFields(dir);
    return { characters_and_memories: characterFacts(db, seed.work_id) };
  });
}

// ── 生产源码指纹：批次期间产品代码不得被测量方或其它人改动（no_acceptance_hooks 红线）──
const productPrefixes = ["frontend/src/", "frontend/src-tauri/src/"];
const productPath = (file) =>
  productPrefixes.some((prefix) => file.startsWith(prefix)) || /^apps\/[^/]+\/lib\//.test(file);

export function productionFingerprint() {
  const listing = execFileSync("git", ["-C", ROOT, "ls-files", "--", "frontend/src", "frontend/src-tauri/src", "apps"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const files = listing.split("\n").map((file) => file.trim()).filter((file) => file && productPath(file)).sort();
  const hashes = {};
  for (const file of files) {
    const absolute = path.join(ROOT, file);
    hashes[file] = fs.existsSync(absolute) ? shaFile(absolute) : "missing";
  }
  const head = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return { head, file_count: files.length, files: hashes };
}

// 测试数据准备（仅隔离副本 SQLite）：把 seed 作品置为最近打开，使原生窗口启动直接进入该作品。
// 等价于作者上一次操作后重开应用；不改产品代码、不碰源库。
function markWorkNewest(dir, workId) {
  execFileSync("python3", ["-c", [
    "import sqlite3,sys,datetime",
    "db=sqlite3.connect(sys.argv[1], timeout=10)",
    "ts=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')+'Z'",
    "db.execute('update works set updated_at=? where id=?',(ts,sys.argv[2]))",
    "db.commit(); db.close()",
  ].join("\n"), dbPath(dir), workId], { stdio: "ignore" });
}

function lmsPs() {
  const bin = process.env.LMS_BIN ?? path.join(os.homedir(), ".lmstudio", "bin", "lms");
  try {
    return { ok: true, output: execFileSync(bin, ["ps"], { encoding: "utf8", timeout: 15_000 }) };
  } catch (error) {
    return { ok: false, output: null, error: String(error.message ?? error).slice(0, 300) };
  }
}

function memorySnapshot() {
  try {
    return execFileSync("sh", ["-c", "vm_stat | head -6; sysctl -n hw.memsize; sysctl -n vm.swapusage 2>/dev/null"], {
      encoding: "utf8",
      timeout: 10_000,
    });
  } catch (error) {
    return `memory_probe_failed:${String(error.message ?? error).slice(0, 200)}`;
  }
}

function strataProcessSnapshot() {
  try {
    return execFileSync(
      "sh",
      ["-c", "ps -axo pid,ppid,rss,command | grep -Ei 'strata|llama|mlx' | grep -v grep | head -20"],
      { encoding: "utf8", timeout: 10_000 },
    );
  } catch {
    return "";
  }
}

async function probeStrata(endpoint) {
  // Strata 控制面在根路径（/api/models 返回 loaded/current），OpenAI 兼容面在 /v1（/v1/models 列可用模型）。
  const control = endpoint.replace(/\/v1\/?$/, "");
  const grab = async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  };
  const models = await grab(`${control}/api/models`).catch((error) => ({ status: null, error: String(error.message) }));
  const v1Models = await grab(`${endpoint}/models`).catch((error) => ({ status: null, error: String(error.message) }));
  return { models, v1Models, control };
}

// strata 真实模型批次：跑前记录 lms ps / 内存 / Strata 控制面状态（loaded=null 是单槽串行的前置条件）。
async function recordModelLifecycleBefore(dir, ready, model) {
  const endpoint = process.env.NOVEL_STRATA_ENDPOINT ?? "http://127.0.0.1:47831/v1";
  assert.equal(ready.provider, "strata", `真实模型批次 provider 必须是 strata，实测: ${ready.provider}`);
  const probe = await probeStrata(endpoint);
  const v1Ids = (probe.v1Models.body?.data ?? []).map((row) => row.id);
  const loaded = probe.models.body?.loaded ?? null;
  // 单槽串行硬前置：真实模型批次开始前 Strata 不得有已加载模型（否则可能是其它批次/作者资源）。
  assert.equal(loaded, null, `strata 已有已加载模型，拒绝并发真实模型批次: loaded=${String(loaded)} current=${String(probe.models.body?.current ?? null)}`);
  const record = {
    at: new Date().toISOString(),
    provider: "strata",
    endpoint,
    control_endpoint: probe.control,
    model,
    lms_ps: lmsPs(),
    strata_control: {
      status: probe.models.status ?? null,
      mode: probe.models.body?.mode ?? null,
      loaded,
      current: probe.models.body?.current ?? null,
    },
    strata_v1_models: { status: probe.v1Models.status ?? null, ids: v1Ids },
    memory: memorySnapshot(),
    processes: strataProcessSnapshot(),
  };
  write(dir, "model-lifecycle-before.json", record);
  return record;
}

export async function prepare(dir) {
  const ready = read(dir, "native-driver-ready.json");
  assert.equal(ready.driver, "external-system-ui", "原生批次 ready 驱动标识必须是 external-system-ui");
  assert.equal(ready.browser_driver_started, false, "原生批次不得启动 Chromium 浏览器驱动");
  assert(
    ["slice_verify", "strata"].includes(ready.provider),
    `B29 原生批次 provider 必须是 slice_verify 或 strata，实测: ${ready.provider}`,
  );
  const seed = seedFields(dir);
  for (const [key, value] of Object.entries(seed)) assert(value, `B29 seed 字段缺失: ${key}`);
  const model = process.env.NOVEL_STRATA_MODEL ?? "iq3_s";
  const config = {
    slice_id: SLICE_ID,
    title: "B29 已有角色叙事身份修订（原生）",
    work_title: WORK_TITLE,
    provider: ready.provider,
    scope: ready.provider === "strata" ? "scoped_real_model" : "full_deterministic_matrix",
    model: ready.provider === "strata" ? model : "slice_verify",
    run_ref: ready.run_ref,
    ready_at: ready.ready_at,
    seed,
    inputs: INPUTS,
  };
  write(dir, "b29-native-config.json", config);
  if (ready.provider === "strata") await recordModelLifecycleBefore(dir, ready, model);
  write(dir, "production-sources-before.json", productionFingerprint());
  markWorkNewest(dir, seed.work_id);
  capture(dir, "seed");
  console.log(
    `B29 原生证据准备完成: provider=${config.provider} scope=${config.scope} work=${seed.work_id} shen=${seed.shen_character_id} gu=${seed.gu_character_id}`,
  );
}

export function capture(dir, checkpoint) {
  const config = read(dir, "b29-native-config.json");
  const allowed = config.provider === "strata" ? STRATA_CHECKPOINTS : CHECKPOINTS;
  assert(allowed.includes(checkpoint), `未知 checkpoint: ${checkpoint}`);
  const facts = captureFacts(dir);
  write(dir, `${checkpoint}.json`, { at: new Date().toISOString(), checkpoint, ...facts });
}

// ── 传输帧/日志对账 helper ────────────────────────────────────────────────────
function transport(dir) {
  const file = path.join(dir, "native-transport.jsonl");
  assert(fs.existsSync(file), "native-transport.jsonl 缺失（外部传输代理未采证）");
  return jsonl(file);
}

function isFrame(record) {
  return record && Array.isArray(record.frame) && record.frame.length >= 5;
}

const frameOf = (record) => (isFrame(record) ? record.frame : null);
const frameEvent = (record) => frameOf(record)?.[3] ?? null;
const frameBody = (record) => frameOf(record)?.[4] ?? null;

function sentUserMessages(wire, text) {
  return wire.filter(
    (record) => record.direction === "sent" && frameEvent(record) === "user_message" && String(frameBody(record)?.text ?? "") === text,
  );
}

function turnFacts(wire, messageFrame) {
  const turnId = String(frameBody(messageFrame)?.turn_id ?? "");
  assert(turnId, "user_message 缺 turn_id");
  const ack = wire.find(
    (record) =>
      record.direction === "received" &&
      isFrame(record) &&
      record.at >= messageFrame.at &&
      record.frame[1] === messageFrame.frame[1] &&
      record.frame[3] === "phx_reply" &&
      record.frame[4]?.status === "ok" &&
      record.frame[4]?.response?.turn_id === turnId,
  );
  const results = wire.filter(
    (record) =>
      record.direction === "received" &&
      isFrame(record) &&
      record.at >= messageFrame.at &&
      record.frame[3] === "turn_result" &&
      String(record.frame[4]?.turn_id ?? "").startsWith(turnId),
  );
  assert(results.length, `缺少 turn_result: ${turnId}`);
  return { turnId, message: messageFrame, ack, result: results.at(-1).frame[4] };
}

function judgmentsFor(appRecords, turnId) {
  return appRecords
    .filter((record) => record.event === "judgment.decided.done" && String(record.turn_id ?? "").startsWith(turnId))
    .map((record) => ({
      event: record.event,
      action: record.action ?? null,
      capability: record.capability ?? null,
      frame_type: record.frame_type ?? null,
      reason_code: record.reason_code ?? null,
    }));
}

function pendingOf(turn) {
  return turn?.result?.adoption_state?.pending ?? [];
}

// action_result 的 artifact 归属：顶层 artifact_id / target_ref，或 decision 内 target_ref/candidate_ref，
// 或 action_id 与发送动作匹配（accept -> adopt: 前缀差异，不能只用 action_id 严格相等）。
function receiptMatchesArtifact(body, artifactId, sendAction) {
  if (!body || typeof body !== "object") return false;
  const decision = body.decision ?? {};
  return (
    body.artifact_id === artifactId ||
    body.target_ref === artifactId ||
    decision.candidate_ref === artifactId ||
    decision.target_ref === `artifact:${artifactId}` ||
    decision.target_ref === artifactId ||
    (Boolean(sendAction?.action_id) && body.action_id === sendAction.action_id)
  );
}

function adoptionFor(wire, artifactId) {
  const sends = wire.filter(
    (record) =>
      record.direction === "sent" &&
      isFrame(record) &&
      record.frame[3] === "author_action" &&
      record.frame[4]?.action?.target_ref === artifactId &&
      ["accept", "adopt", "confirm_adoption"].includes(String(record.frame[4]?.action?.action_type)),
  );
  assert.equal(sends.length, 1, `候选采纳必须恰好一次且来自 UI: ${artifactId} (${sends.length})`);
  const send = sends[0];
  const action = send.frame[4].action;
  const received = wire.filter(
    (record) =>
      record.direction === "received" &&
      isFrame(record) &&
      record.at >= send.at &&
      record.frame[3] === "action_result" &&
      record.frame[4]?.status === "accepted" &&
      receiptMatchesArtifact(record.frame[4], artifactId, action),
  );
  assert(received.length, `缺少 accepted action_result: ${artifactId}`);
  return { send, receipt: received.at(-1).frame[4] };
}

function discardFor(wire, artifactId) {
  const sends = wire.filter(
    (record) =>
      record.direction === "sent" &&
      isFrame(record) &&
      record.frame[3] === "author_action" &&
      record.frame[4]?.action?.target_ref === artifactId &&
      String(record.frame[4]?.action?.action_type) === "discard",
  );
  assert.equal(sends.length, 1, `候选放弃必须恰好一次且来自 UI: ${artifactId} (${sends.length})`);
  const send = sends[0];
  const action = send.frame[4].action;
  const received = wire.filter(
    (record) =>
      record.direction === "received" &&
      isFrame(record) &&
      record.at >= send.at &&
      record.frame[3] === "action_result" &&
      ["accepted", "discarded"].includes(String(record.frame[4]?.status)) &&
      receiptMatchesArtifact(record.frame[4], artifactId, action),
  );
  assert(received.length, `缺少 discard action_result: ${artifactId}`);
  return { send, receipt: received.at(-1).frame[4] };
}

function axText(dir, name) {
  const file = path.join(dir, `${name}.text.txt`);
  assert(fs.existsSync(file), `缺少可见文本证据: ${name}.text.txt`);
  return fs.readFileSync(file, "utf8");
}

function axDump(dir, name) {
  const file = path.join(dir, `${name}.ax.txt`);
  assert(fs.existsSync(file), `缺少 AX 树证据: ${name}.ax.txt`);
  return fs.readFileSync(file, "utf8");
}

function assertRecordFresh(dir, name, readyAt) {
  for (const file of [`${name}.ax.txt`, `${name}.text.txt`, `${name}.jpg`]) {
    const absolute = path.join(dir, file);
    assert(fs.existsSync(absolute), `缺少证据文件: ${file}`);
    assert(fs.statSync(absolute).mtimeMs >= Date.parse(readyAt), `证据文件早于原生窗口就绪: ${file}`);
  }
  const jpg = path.join(dir, `${name}.jpg`);
  const magic = fs.readFileSync(jpg).subarray(0, 8).toString("hex");
  assert(magic.startsWith("ffd8ff") || magic === "89504e470d0a1a0a", `截图格式非法: ${name}.jpg`);
}

function assertWaitLedger(dir, { requireRestore, minimum: minimumOverride }) {
  const commandsFile = path.join(dir, "native-driver-commands.jsonl");
  assert(fs.existsSync(commandsFile), "缺少原生等待账");
  const commands = fs.readFileSync(commandsFile, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  const open = new Map();
  for (const command of commands) {
    if (command.op === "begin") {
      assert(!open.has(command.id), `重复 begin: ${command.id}`);
      open.set(command.id, command);
    } else if (command.op === "finish") {
      assert(open.has(command.id), `finish 未匹配 begin: ${command.id}`);
      open.delete(command.id);
    }
  }
  assert.equal(open.size, 0, "等待账仍有未完成 begin");
  const eventsFile = path.join(dir, "wait-events.jsonl");
  assert(fs.existsSync(eventsFile), "缺少 wait-events.jsonl（监督未采证等待账）");
  const events = fs.readFileSync(eventsFile, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  const started = events.filter((event) => event.event === "wait_start");
  const ended = events.filter((event) => event.event === "wait_end");
  const minimum = minimumOverride ?? (requireRestore ? 16 : 8);
  assert(started.length >= minimum, `等待账条目过少: ${started.length}`);
  assert.equal(started.length, ended.length, "等待账 start/end 不平衡");
  const kinds = new Set(ended.map((event) => event.kind));
  const requiredKinds = requireRestore
    ? ["input", "turn", "candidate", "adoption", "maintenance", "restore"]
    : ["input", "turn", "candidate", "adoption", "maintenance"];
  for (const required of requiredKinds) {
    assert(kinds.has(required), `缺少 ${required} 分型等待账`);
  }
  const stats = read(dir, "wait-stats.json");
  assert.equal(stats.active, null, "等待账结束时不得有活动等待");
  assert(stats.completed >= minimum, "等待账完成数不足");
  assert(fs.existsSync(path.join(dir, "heartbeat.jsonl")), "缺少监督心跳 heartbeat.jsonl");
  const heartbeat = fs.readFileSync(path.join(dir, "heartbeat.jsonl"), "utf8").split("\n").filter(Boolean);
  assert(heartbeat.length >= 2, "监督心跳记录不足");
  return { commands: commands.length, waits: ended.length, kinds: [...kinds] };
}

function assertCommonEvidence(dir, config) {
  const ready = read(dir, "native-driver-ready.json");
  const ui = read(dir, "native-ui-complete.json");
  const strata = config.provider === "strata";
  assert.equal(ui.harness_run_ref, ready.run_ref, "native-ui-complete 未绑定本批次 run_ref");
  assert.equal(ui.driver, "ax-native-system-ui", "原生驱动标识必须是 ax-native-system-ui（非 CUA/浏览器）");
  assert.equal(ui.app_bundle, "com.ai-novel-studio.app");
  assert.equal(ui.scope, config.slice_id);
  assert.equal(ready.driver, "external-system-ui");
  assert.equal(ready.browser_driver_started, false, "原生批次不得启动 Chromium 浏览器驱动");
  assert(!fs.existsSync(path.join(dir, "ui-frames.json")), "原生批次不得存在浏览器 ui-frames 证据");
  assert(!fs.existsSync(path.join(dir, "failure.json")), "批次存在 failure.json，不得判 PASS");
  assert(Array.isArray(ui.screenshots), "native-ui-complete.screenshots 缺失");
  const minimumScreenshots = strata ? 5 : 10;
  assert(ui.screenshots.length >= minimumScreenshots, `截图不足: ${ui.screenshots.length}`);
  for (const name of ui.screenshots) {
    const file = path.resolve(dir, name);
    assert(file.startsWith(dir + path.sep), `截图越界: ${name}`);
    assert(fs.existsSync(file), `截图缺失: ${name}`);
    assert(fs.statSync(file).mtimeMs >= Date.parse(ready.ready_at), `截图早于窗口就绪: ${name}`);
    const magic = fs.readFileSync(file).subarray(0, 8).toString("hex");
    assert(magic.startsWith("ffd8ff") || magic === "89504e470d0a1a0a", `截图格式非法: ${name}`);
  }
  const requireRestore = !strata;
  return { ready, ui, ledger: assertWaitLedger(dir, { requireRestore, minimum: strata ? 8 : 16 }) };
}

function assertProviderAndWire(dir, config) {
  const strata = config.provider === "strata";
  const appRecords = logs(path.join(dir, "app-log"));
  const llmRecords = logs(path.join(dir, "llm-calls"));
  const providerStarts = appRecords.filter((record) => record.event === "provider_gateway.complete.start");
  assert(providerStarts.length > 0, "缺少 provider_gateway.complete.start（判断/创作调用未走真实 provider 边界）");
  const expectedProvider = strata ? "strata" : "slice_verify";
  const providers = [...new Set(providerStarts.map((record) => record.provider))];
  assert(same(providers, [expectedProvider]), `批次 provider 必须是 ${expectedProvider}，实测: ${providers.join(",")}`);
  assert(llmRecords.length > 0, "缺少 llm-calls 调用记录");
  assert(
    llmRecords.every((record) => record.provider === expectedProvider),
    `llm-calls 必须全部来自 ${expectedProvider}`,
  );
  if (strata) {
    const models = [...new Set(llmRecords.map((record) => llmModelOf(record)))];
    assert(same(models, [config.model]), `真实模型批次 llm-calls 模型必须是 ${config.model}，实测: ${models.join(",")}`);
    const responses = llmRecords
      .map((record) => record.response ?? null)
      .filter((response) => response !== null);
    assert(responses.length > 0, "llm-calls 缺少 provider 响应");
    assert(
      responses.every((response) => Number(response.status) >= 200 && Number(response.status) < 300),
      "真实模型 provider 响应必须全部 HTTP 2xx",
    );
    const urls = [...new Set(llmRecords.map((record) => String(record.request?.url ?? "")))];
    assert(urls.some((url) => /\/chat\/completions/.test(url)), "真实模型请求必须走真实 /chat/completions");
  }
  const wire = transport(dir);
  const userMessages = wire.filter((record) => record.direction === "sent" && frameEvent(record) === "user_message");
  const turnResults = wire.filter((record) => record.direction === "received" && frameEvent(record) === "turn_result");
  const minimumTurns = strata ? 2 : 7;
  assert(userMessages.length >= minimumTurns, `真实工作台输入帧不足: ${userMessages.length}`);
  assert(turnResults.length >= minimumTurns, `真实 turn_result 帧不足: ${turnResults.length}`);
  assert(wire.some((record) => record.direction === "http"), "缺少真实 HTTP transport 帧");
  return { appRecords, llmRecords, wire };
}

function checkProductionFingerprint(dir) {
  const before = read(dir, "production-sources-before.json");
  const now = productionFingerprint();
  const changed = Object.keys({ ...before.files, ...now.files }).filter((file) => before.files[file] !== now.files[file]);
  return { unchanged: changed.length === 0, changed_files: changed.slice(0, 20), head: { before: before.head, now: now.head } };
}

// ── B29：状态链读取 ──────────────────────────────────────────────────────────
const rolePairs = (facts) => (facts?.characters ?? []).map((row) => [row.id, row.narrative_role]);
const rolesEqual = (a, b) => same(rolePairs(a), rolePairs(b));
const zeroWriteBetween = (before, after) =>
  rolesEqual(before, after) &&
  before.character_count === after.character_count &&
  before.memory_count === after.memory_count;

function stateChecks(before, after, plan) {
  const afterById = new Map((after?.characters ?? []).map((row) => [row.id, row]));
  const targetId = String(plan?.character_ref ?? "").replace(/^character:/, "");
  return {
    target_character_id_present: afterById.has(targetId),
    narrative_role_updated_to_new: afterById.get(targetId)?.narrative_role === plan?.new_value,
    character_count_unchanged: before.characters.length === after.characters.length,
    character_id_set_unchanged:
      same(before.characters.map((row) => row.id).sort(), after.characters.map((row) => row.id).sort()),
    other_characters_unchanged: before.characters
      .filter((row) => row.id !== targetId)
      .every((row) => {
        const next = afterById.get(row.id);
        return (
          next &&
          next.narrative_role === row.narrative_role &&
          next.name === row.name &&
          same(next.aliases, row.aliases)
        );
      }),
    no_new_character: after.characters.length === before.characters.length,
    no_new_memory: after.memories.length === before.memories.length,
  };
}

function candidateFacts(adoption) {
  const payload = adoption?.pending_payload ?? {};
  const changes = payload.changes ?? [];
  const receipt = adoption?.action_result ?? {};
  return {
    object_kind: payload.object_kind ?? null,
    character_ref: payload.character_ref ?? null,
    character_name: payload.character_name ?? null,
    base_fingerprint: payload.base_fingerprint ?? null,
    changes,
    change_count: changes.length,
    field: changes[0]?.field ?? null,
    old_value: changes[0]?.old ?? null,
    new_value: changes[0]?.new ?? null,
    effects: payload.effects ?? [],
    other_character_changes: payload.other_character_changes ?? [],
    suggested_other_character_changes: payload.suggested_other_character_changes ?? [],
    adoption_effect: payload.adoption_effect ?? null,
    receipt_committed_changes: receipt.committed_changes ?? null,
    receipt_character_ref: receipt.character_ref ?? null,
    receipt_base_fingerprint: receipt.base_fingerprint ?? null,
    receipt_current_fingerprint: receipt.current_fingerprint ?? null,
    receipt_adoption_effect: receipt.adoption_effect ?? null,
    receipt_duplicate: receipt.duplicate ?? null,
  };
}

// ── 23 checks（1:1 对齐浏览器 driveB29ExistingCharacterRoleRevision）────────────
function b29Checks(dir, config, wire, appRecords, production) {
  const snap = (name) => read(dir, `${name}.json`).characters_and_memories;
  const seed = config.seed;
  // 原生窗口关闭重开（T4 刷新）后，前端通道重新 join 会把尚未回执清除的本地待发消息
  // 用同一 turn_id 重放一次（浏览器 canonical 批次同样存在：8 条 sent user_message / 7 条逻辑输入）。
  // 判据按“逻辑输入 = 不同 turn_id”计数，而不是按 wire 帧数；重放帧如实记入 measured。
  const turnIdOf = (record) => String(frameBody(record)?.turn_id ?? "");
  const distinctTurns = (records) => new Set(records.map(turnIdOf));
  const messages = {
    t1: sentUserMessages(wire, INPUTS.t1),
    t2: sentUserMessages(wire, INPUTS.t2),
    t3: sentUserMessages(wire, INPUTS.t3),
    t4: sentUserMessages(wire, INPUTS.t4_followup),
    t5Discard: sentUserMessages(wire, INPUTS.t5_discard),
    t5Repeat: sentUserMessages(wire, INPUTS.t5_repeat),
    t5Cross: sentUserMessages(wire, INPUTS.t5_cross_work),
  };
  const t1Turns = distinctTurns(messages.t1);
  assert.equal(t1Turns.size, 2, `「${INPUTS.t1}」必须对应两次逻辑输入（T1 正例 + T5 重复采纳，按不同 turn_id 计）: ${t1Turns.size} / ${messages.t1.length} 帧`);
  for (const [label, records, expected] of [
    ["T2", messages.t2, 1],
    ["T3", messages.t3, 1],
    ["T4", messages.t4, 1],
    ["T5-discard", messages.t5Discard, 1],
    ["T5-cross-work", messages.t5Cross, 1],
  ]) {
    assert.equal(distinctTurns(records).size, expected, `${label} 必须对应一次真实逻辑输入: ${distinctTurns(records).size} / ${records.length} 帧`);
  }
  const t1Message = messages.t1[0];
  const t1OriginalTurnId = turnIdOf(t1Message);
  const repeatMessage = messages.t1.find((record) => turnIdOf(record) !== t1OriginalTurnId) ?? null;
  assert(repeatMessage, "缺少 T5 重复采纳输入（不同 turn_id）");
  const restartReplayFrames = messages.t1.filter((record) => turnIdOf(record) === t1OriginalTurnId).length - 1;

  const t1Turn = turnFacts(wire, t1Message);
  const t2Turn = turnFacts(wire, messages.t2[0]);
  const t3Turn = turnFacts(wire, messages.t3[0]);
  const t4Turn = turnFacts(wire, messages.t4[0]);
  const t5DiscardTurn = turnFacts(wire, messages.t5Discard[0]);
  const t5RepeatTurn = turnFacts(wire, repeatMessage);
  const t5CrossTurn = turnFacts(wire, messages.t5Cross[0]);

  const t1Pending = pendingOf(t1Turn).find((entry) => entry.artifact_type === "character_profile_revision");
  assert(t1Pending, "T1 正例缺少 character_profile_revision 候选");
  const t1Adoption = adoptionFor(wire, t1Pending.artifact_id);
  const t1Plan = candidateFacts({
    pending_payload: t1Pending.payload ?? {},
    action_result: t1Adoption.receipt,
  });

  const t1Before = snap("t1-before");
  const t1After = snap("t1-after");
  const t1State = stateChecks(t1Before, t1After, t1Plan);
  const draftHashesUnchanged = same(t1Before.drafts, t1After.drafts);

  const t2Judgment = judgmentsFor(appRecords, t2Turn.turnId);
  const t3Judgment = judgmentsFor(appRecords, t3Turn.turnId);
  const t5RepeatJudgment = judgmentsFor(appRecords, t5RepeatTurn.turnId);
  const t5CrossJudgment = judgmentsFor(appRecords, t5CrossTurn.turnId);
  const askedAuthor = t2Judgment.some((record) => ["ask_author", "await_author"].includes(record.action));

  const t2Before = snap("t2-before");
  const t2After = snap("t2-after");
  const t2ZeroWrite = zeroWriteBetween(t2Before, t2After);

  const t3Before = snap("t3-before");
  const t3After = snap("t3-after");
  const t3RolesUnchanged = rolesEqual(t3Before, t3After) && t3Before.memory_count === t3After.memory_count;

  const t4BeforeRefresh = snap("t4-before-refresh");
  const t4AfterRefresh = snap("t4-after-refresh");
  const t4FollowupAfter = snap("t4-after-followup");
  const refreshStable = zeroWriteBetween(t4BeforeRefresh, t4AfterRefresh);
  const shenAfterRefresh = t4AfterRefresh.characters.find((row) => row.id === seed.shen_character_id) ?? null;
  const rosterText = axText(dir, "T4-roster");
  const followupText = String(t4Turn.result?.assistant_message?.text ?? "");

  const t5DiscardBefore = snap("t5-before-discard");
  const t5DiscardAfter = snap("t5-after-discard");
  const t5RepeatBefore = snap("t5-before-repeat");
  const t5RepeatAfter = snap("t5-after-repeat");
  const t5CrossBefore = snap("t5-before-cross-work");
  const t5CrossAfter = snap("t5-after-cross-work");

  const t5Pending = pendingOf(t5DiscardTurn).find((entry) => entry.artifact_type === "character_profile_revision");
  const t5DiscardReceipt = t5Pending ? discardFor(wire, t5Pending.artifact_id) : null;
  const repeatPending = pendingOf(t5RepeatTurn).find((entry) => entry.artifact_type === "character_profile_revision");

  const t1CandidateText = axText(dir, "T1-candidate");
  const visibleHasOldToNew =
    t1CandidateText.includes("ENSEMBLE_POV") && t1CandidateText.includes("PROTAGONIST") && t1CandidateText.includes("叙事身份修订");

  const checks = {
    judgment_bound_revise_character_profile: judgmentsFor(appRecords, t1Turn.turnId).some(
      (record) => record.action === "execute" && record.capability === "revise_character_profile",
    ),
    candidate_object_and_old_to_new_visible:
      t1Plan.character_name === "沈砚" &&
      t1Plan.field === "narrative_role" &&
      t1Plan.old_value === "ENSEMBLE_POV" &&
      t1Plan.new_value === "PROTAGONIST" &&
      visibleHasOldToNew === true,
    candidate_effects_and_other_changes_empty:
      same(t1Plan.effects, ["character_field_update"]) && (t1Plan.other_character_changes ?? []).length === 0,
    adoption_applied: Boolean(t1Adoption.receipt),
    receipt_committed_changes_old_new:
      Array.isArray(t1Plan.receipt_committed_changes) &&
      t1Plan.receipt_committed_changes[0]?.field === "narrative_role" &&
      t1Plan.receipt_committed_changes[0]?.old === "ENSEMBLE_POV" &&
      t1Plan.receipt_committed_changes[0]?.new === "PROTAGONIST",
    receipt_character_ref_and_fingerprint:
      Boolean(t1Plan.receipt_character_ref) &&
      Boolean(t1Plan.receipt_base_fingerprint) &&
      Boolean(t1Plan.receipt_current_fingerprint),
    same_character_id_updated:
      t1State.target_character_id_present === true && t1State.narrative_role_updated_to_new === true,
    character_count_and_id_set_unchanged:
      t1State.character_count_unchanged === true && t1State.character_id_set_unchanged === true,
    other_characters_unchanged: t1State.other_characters_unchanged === true,
    gu_protagonist_retained:
      t1After.characters.find((row) => row.id === seed.gu_character_id)?.narrative_role === "PROTAGONIST",
    no_new_character_or_memory: t1State.no_new_character === true && t1State.no_new_memory === true,
    prose_hashes_unchanged: draftHashesUnchanged,
    same_name_asks_author: askedAuthor === true,
    same_name_zero_write: t2ZeroWrite === true && pendingOf(t2Turn).length === 0,
    discussion_no_candidate_zero_write:
      !pendingOf(t3Turn).some((entry) => entry.artifact_type === "character_profile_revision") && t3RolesUnchanged === true,
    refresh_stable_new_value: refreshStable === true && shenAfterRefresh?.narrative_role === "PROTAGONIST",
    roster_and_followup_new_value:
      /主角/u.test(rosterText) === true && followupText.includes("沈砚") && followupText.includes("顾青"),
    followup_zero_write: rolesEqual(t4AfterRefresh, t4FollowupAfter),
    discard_keeps_original: zeroWriteBetween(t5DiscardBefore, t5DiscardAfter) === true,
    repeat_adoption_idempotent:
      zeroWriteBetween(t5RepeatBefore, t5RepeatAfter) === true &&
      t5RepeatBefore.character_count === t5RepeatAfter.character_count,
    cross_work_zero_write: zeroWriteBetween(t5CrossBefore, t5CrossAfter) === true,
    no_product_code_changed: production.unchanged === true,
    no_acceptance_hooks_added: production.unchanged === true,
  };

  const measured = {
    seed,
    t1: {
      turn_id: t1Turn.turnId,
      judgment: judgmentsFor(appRecords, t1Turn.turnId),
      assistant_text: String(t1Turn.result?.assistant_message?.text ?? ""),
      plan: t1Plan,
      pending_types: pendingOf(t1Turn).map((entry) => entry.artifact_type),
      adoption_receipt: {
        committed_changes: t1Plan.receipt_committed_changes,
        character_ref: t1Plan.receipt_character_ref,
        base_fingerprint: t1Plan.receipt_base_fingerprint,
        current_fingerprint: t1Plan.receipt_current_fingerprint,
        adoption_effect: t1Plan.receipt_adoption_effect,
        duplicate: t1Plan.receipt_duplicate,
        decision_type: t1Adoption.receipt?.decision?.decision_type ?? null,
        state_trace_ref: t1Adoption.receipt?.decision?.state_trace_ref ?? null,
      },
      state_checks: t1State,
      draft_hashes_unchanged: draftHashesUnchanged,
      before_characters: t1Before.characters,
      after_characters: t1After.characters,
      memory_count_before: t1Before.memory_count,
      memory_count_after: t1After.memory_count,
      restart_replay_frames: restartReplayFrames,
    },
    t2: {
      turn_id: t2Turn.turnId,
      judgment: t2Judgment,
      assistant_text: String(t2Turn.result?.assistant_message?.text ?? ""),
      pending_types: pendingOf(t2Turn).map((entry) => entry.artifact_type),
      asked_author: askedAuthor,
      zero_write: t2ZeroWrite,
    },
    t3: {
      turn_id: t3Turn.turnId,
      judgment: t3Judgment,
      assistant_text: String(t3Turn.result?.assistant_message?.text ?? ""),
      pending_types: pendingOf(t3Turn).map((entry) => entry.artifact_type),
      zero_write: t3RolesUnchanged,
    },
    t4: {
      refresh_stable: refreshStable,
      shen_after_refresh: shenAfterRefresh,
      roster_mentions_protagonist: /主角/u.test(rosterText),
      roster_excerpt: rosterText.slice(0, 2400),
      followup: {
        turn_id: t4Turn.turnId,
        judgment: judgmentsFor(appRecords, t4Turn.turnId),
        assistant_text: followupText,
        pending_types: pendingOf(t4Turn).map((entry) => entry.artifact_type),
      },
      followup_zero_write: rolesEqual(t4AfterRefresh, t4FollowupAfter),
    },
    t5: {
      discard: {
        turn_id: t5DiscardTurn.turnId,
        pending_types: pendingOf(t5DiscardTurn).map((entry) => entry.artifact_type),
        receipt: t5DiscardReceipt?.receipt
          ? {
              status: t5DiscardReceipt.receipt.status ?? null,
              action_type: t5DiscardReceipt.receipt.action_type ?? null,
              decision_type: t5DiscardReceipt.receipt.decision?.decision_type ?? null,
            }
          : null,
        unchanged: zeroWriteBetween(t5DiscardBefore, t5DiscardAfter),
      },
      repeat: {
        turn_id: t5RepeatTurn.turnId,
        judgment: t5RepeatJudgment,
        assistant_text: String(t5RepeatTurn.result?.assistant_message?.text ?? ""),
        pending_types: pendingOf(t5RepeatTurn).map((entry) => entry.artifact_type),
        candidate_present: Boolean(repeatPending),
        idempotent_or_noop: zeroWriteBetween(t5RepeatBefore, t5RepeatAfter),
        character_count_unchanged: t5RepeatBefore.character_count === t5RepeatAfter.character_count,
      },
      cross_work: {
        turn_id: t5CrossTurn.turnId,
        judgment: t5CrossJudgment,
        assistant_text: String(t5CrossTurn.result?.assistant_message?.text ?? ""),
        pending_types: pendingOf(t5CrossTurn).map((entry) => entry.artifact_type),
        zero_write: zeroWriteBetween(t5CrossBefore, t5CrossAfter),
      },
    },
    candidate_ax_visible_old_to_new: visibleHasOldToNew,
    rollup: {
      characters_before: t1Before.character_count,
      characters_after: t1After.character_count,
      shen_role_before: t1Before.characters.find((row) => row.id === seed.shen_character_id)?.narrative_role ?? null,
      shen_role_after: t1After.characters.find((row) => row.id === seed.shen_character_id)?.narrative_role ?? null,
      gu_role_after: t1After.characters.find((row) => row.id === seed.gu_character_id)?.narrative_role ?? null,
      final_characters: snap("final").characters.map((row) => ({ id: row.id, name: row.name, narrative_role: row.narrative_role })),
      final_memory_count: snap("final").memory_count,
    },
  };
  return { checks, measured };
}

function verifyDeterministic(dir, config) {
  assert.equal(config.provider, "slice_verify", `确定性原生矩阵 provider 必须是 slice_verify，实测: ${config.provider}`);
  const common = assertCommonEvidence(dir, config);
  const { ready, ui } = common;
  const { appRecords, llmRecords, wire } = assertProviderAndWire(dir, config);
  const production = checkProductionFingerprint(dir);
  for (const name of [
    "T0-workbench",
    "T1-candidate",
    "T1-receipt",
    "T2-clarify",
    "T3-discussion",
    "T4-refreshed",
    "T4-roster",
    "T4-followup",
    "T5-discard",
    "T5-repeat",
    "T5-cross-work",
    "B29-final",
  ]) {
    assertRecordFresh(dir, name, ready.ready_at);
  }
  const { checks, measured } = b29Checks(dir, config, wire, appRecords, production);
  const failed = Object.keys(checks).filter((key) => !checks[key]);

  const evidence = {
    scenario: config.slice_id,
    surface: "tauri",
    driver: ui.driver,
    provider: config.provider,
    evidence_boundary:
      "原生 macOS Tauri 窗口（真实前端嵌入 + 真实 Phoenix 后端 + 外部 WS/HTTP 传输代理）+ AX/CGEvent 外部驱动；provider 为 slice_verify 确定性替身；判据 1:1 沿用浏览器 canonical 23 checks / 5 trials，只是驱动面从 Chromium 页面换成原生窗口。",
    trials: [
      "T1_positive_unique_alias_narrative_role_revision",
      "T2_same_name_ambiguity_asks_author_zero_write",
      "T3_discussion_only_no_candidate_zero_write",
      "T4_refresh_reopen_roster_and_followup_new_value",
      "T5_negatives_discard_repeat_cross_work",
    ],
    checks,
    measured,
    checks_passed: Object.values(checks).filter(Boolean).length,
    checks_total: Object.keys(checks).length,
    seed: config.seed,
    screenshots: ui.screenshots,
    wait_ledger: common.ledger,
  };
  write(dir, "b29-native-checks.json", {
    slice_id: config.slice_id,
    at: new Date().toISOString(),
    driver: ui.driver,
    checks,
    failed,
    measured,
    evidence: {
      source: "既有B29浏览器矩阵 23 项 checks（frontend/slice-verify/external-ui-driver.mjs driveB29ExistingCharacterRoleRevision）",
      browser_surface: false,
      native_driver: "ax-native-system-ui",
      checks_passed: Object.values(checks).filter(Boolean).length,
      checks_total: Object.keys(checks).length,
      llm_call_count: llmRecords.length,
      provider_calls: appRecords.filter((record) => record.event === "provider_gateway.complete.start").length,
      production_unchanged: production.unchanged,
      production_changed_files: production.changed_files,
      run_ref: ready.run_ref,
      ready_at: ready.ready_at,
    },
  });
  write(dir, "native-evidence.json", evidence);
  write(dir, "summary.json", {
    slice_id: config.slice_id,
    surface: "tauri",
    driver: ui.driver,
    provider: config.provider,
    scope: "full_deterministic_matrix",
    canonical_registered: true,
    verified_at: new Date().toISOString(),
    checks_passed: Object.values(checks).filter(Boolean).length,
    checks_total: Object.keys(checks).length,
    all_checks_passed: failed.length === 0,
    failed_checks: failed,
    trials: ["T1", "T2", "T3", "T4", "T5"],
    run_ref: ready.run_ref,
    ready_at: ready.ready_at,
    html_report: null,
    screenshots: ui.screenshots,
  });

  assert.equal(failed.length, 0, `B29 原生断言失败: ${failed.join(", ")}`);
  console.log(
    `B29 原生场景通过: ${config.slice_id} checks ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}，` +
      `trials 5，wait-ledger ${JSON.stringify(read(dir, "wait-stats.json"))}`,
  );
  return evidence;
}

// ── strata scoped 真实模型证据（T1 正例 + T2 同名澄清负例；不冒充 23 项确定性矩阵）──
function verifyStrataScoped(dir, config) {
  assert.equal(config.provider, "strata", `真实模型批次 provider 必须是 strata，实测: ${config.provider}`);
  assert.equal(config.scope, "scoped_real_model");
  const common = assertCommonEvidence(dir, config);
  const { ready, ui } = common;
  const { appRecords, llmRecords, wire } = assertProviderAndWire(dir, config);
  const production = checkProductionFingerprint(dir);
  for (const name of ["T0-workbench", "T1-candidate", "T1-receipt", "T2-clarify", "B29-final"]) {
    assertRecordFresh(dir, name, ready.ready_at);
  }
  const snap = (name) => read(dir, `${name}.json`).characters_and_memories;
  const seed = config.seed;

  const t1Messages = sentUserMessages(wire, INPUTS.t1);
  const t2Messages = sentUserMessages(wire, INPUTS.t2);
  assert.equal(t1Messages.length, 1, `真实模型 T1 原话必须只发送一次: ${t1Messages.length}`);
  assert.equal(t2Messages.length, 1, `真实模型 T2 原话必须只发送一次: ${t2Messages.length}`);
  const t1Turn = turnFacts(wire, t1Messages[0]);
  const t2Turn = turnFacts(wire, t2Messages[0]);

  const t1Pending = pendingOf(t1Turn).find((entry) => entry.artifact_type === "character_profile_revision");
  assert(t1Pending, `真实模型 T1 未产出 character_profile_revision 候选（pending=${pendingOf(t1Turn).map((entry) => entry.artifact_type).join(",") || "none"}）`);
  const t1Adoption = adoptionFor(wire, t1Pending.artifact_id);
  const plan = candidateFacts({ pending_payload: t1Pending.payload ?? {}, action_result: t1Adoption.receipt });

  const t1Before = snap("t1-before");
  const t1After = snap("t1-after");
  const state = stateChecks(t1Before, t1After, plan);
  const draftHashesUnchanged = same(t1Before.drafts, t1After.drafts);
  const t1Judgment = judgmentsFor(appRecords, t1Turn.turnId);

  const t2Judgment = judgmentsFor(appRecords, t2Turn.turnId);
  const t2Before = snap("t2-before");
  const t2After = snap("t2-after");
  const t2ZeroWrite = zeroWriteBetween(t2Before, t2After);
  const t2Pending = pendingOf(t2Turn).filter((entry) => entry.artifact_type === "character_profile_revision");

  const candidateText = axText(dir, "T1-candidate");
  const visibleOldToNew =
    candidateText.includes("ENSEMBLE_POV") && candidateText.includes("PROTAGONIST") && candidateText.includes("叙事身份修订");

  const providerStarts = appRecords.filter((record) => record.event === "provider_gateway.complete.start");
  const llmOk =
    llmRecords.length > 0 &&
    llmRecords.every((record) => record.provider === "strata" && llmModelOf(record) === config.model) &&
    llmRecords.every((record) => {
      const status = Number(record.response?.status ?? 0);
      return status >= 200 && status < 300;
    }) &&
    llmRecords.some((record) => /\/chat\/completions/.test(String(record.request?.url ?? "")));

  const lifecycleBeforePath = path.join(dir, "model-lifecycle-before.json");
  const lifecycleBefore = fs.existsSync(lifecycleBeforePath) ? read(dir, "model-lifecycle-before.json") : null;
  const v1Ids = lifecycleBefore?.strata_v1_models?.ids ?? [];
  const modelLoadedBeforeNull =
    Boolean(lifecycleBefore) &&
    lifecycleBefore?.strata_control?.loaded === null &&
    v1Ids.includes(config.model);

  const questionEventsPath = path.join(dir, "author_question_events.json");
  const questionEvents = fs.existsSync(questionEventsPath) ? read(dir, "author_question_events.json") : [];
  const questionEventsBounded =
    Array.isArray(questionEvents) &&
    questionEvents.length <= 2 &&
    questionEvents.every((event) => event && typeof event.reply_text === "string" && String(event.reply_text).length > 0);

  const checks = {
    real_provider_calls_strata: providerStarts.length > 0 && providerStarts.every((record) => record.provider === "strata"),
    real_llm_records_provenance: llmOk,
    judgment_bound_revise_character_profile: t1Judgment.some(
      (record) => record.action === "execute" && record.capability === "revise_character_profile",
    ),
    candidate_character_ref_matches_seed:
      String(plan.character_ref ?? "").replace(/^character:/, "") === seed.shen_character_id,
    candidate_object_and_old_to_new_visible:
      plan.character_name === "沈砚" &&
      plan.field === "narrative_role" &&
      plan.old_value === "ENSEMBLE_POV" &&
      plan.new_value === "PROTAGONIST" &&
      visibleOldToNew === true,
    candidate_effects_and_other_changes_empty:
      same(plan.effects, ["character_field_update"]) && (plan.other_character_changes ?? []).length === 0,
    adoption_applied_from_native_ui: Boolean(t1Adoption.receipt),
    receipt_committed_changes_old_new:
      Array.isArray(plan.receipt_committed_changes) &&
      plan.receipt_committed_changes[0]?.field === "narrative_role" &&
      plan.receipt_committed_changes[0]?.old === "ENSEMBLE_POV" &&
      plan.receipt_committed_changes[0]?.new === "PROTAGONIST",
    receipt_character_ref_and_fingerprint:
      Boolean(plan.receipt_character_ref) &&
      Boolean(plan.receipt_base_fingerprint) &&
      Boolean(plan.receipt_current_fingerprint),
    same_character_id_updated:
      state.target_character_id_present === true && state.narrative_role_updated_to_new === true,
    character_count_and_id_set_unchanged:
      state.character_count_unchanged === true && state.character_id_set_unchanged === true,
    other_characters_unchanged: state.other_characters_unchanged === true,
    gu_protagonist_retained:
      t1After.characters.find((row) => row.id === seed.gu_character_id)?.narrative_role === "PROTAGONIST",
    no_new_character_or_memory: state.no_new_character === true && state.no_new_memory === true,
    prose_hashes_unchanged: draftHashesUnchanged,
    same_name_asks_author: t2Judgment.some((record) => ["ask_author", "await_author"].includes(record.action)),
    same_name_zero_write: t2ZeroWrite === true && t2Pending.length === 0,
    author_question_events_bounded: questionEventsBounded,
    model_loaded_before_null: modelLoadedBeforeNull,
    no_product_code_changed: production.unchanged === true,
    no_acceptance_hooks_added: production.unchanged === true,
  };
  const failed = Object.keys(checks).filter((key) => !checks[key]);

  const measured = {
    scope: "scoped_real_model",
    provider: "strata",
    model: config.model,
    covered: [
      "T1_positive_unique_alias_narrative_role_revision_real_model",
      "T2_same_name_ambiguity_asks_author_zero_write_real_model",
    ],
    not_covered: [
      "T3_discussion_only_no_candidate_zero_write",
      "T4_refresh_reopen_roster_and_followup_new_value",
      "T5_negatives_discard_repeat_cross_work",
    ],
    seed,
    t1: {
      turn_id: t1Turn.turnId,
      judgment: t1Judgment,
      assistant_text: String(t1Turn.result?.assistant_message?.text ?? ""),
      plan,
      pending_types: pendingOf(t1Turn).map((entry) => entry.artifact_type),
      adoption_receipt: {
        committed_changes: plan.receipt_committed_changes,
        character_ref: plan.receipt_character_ref,
        base_fingerprint: plan.receipt_base_fingerprint,
        current_fingerprint: plan.receipt_current_fingerprint,
        adoption_effect: plan.receipt_adoption_effect,
        decision_type: t1Adoption.receipt?.decision?.decision_type ?? null,
        state_trace_ref: t1Adoption.receipt?.decision?.state_trace_ref ?? null,
      },
      state_checks: state,
      draft_hashes_unchanged: draftHashesUnchanged,
      before_characters: t1Before.characters,
      after_characters: t1After.characters,
      memory_count_before: t1Before.memory_count,
      memory_count_after: t1After.memory_count,
    },
    t2: {
      turn_id: t2Turn.turnId,
      judgment: t2Judgment,
      assistant_text: String(t2Turn.result?.assistant_message?.text ?? ""),
      pending_types: pendingOf(t2Turn).map((entry) => entry.artifact_type),
      zero_write: t2ZeroWrite,
    },
    real_provider: {
      app_log_provider_calls: providerStarts.length,
      llm_call_count: llmRecords.length,
      models: [...new Set(llmRecords.map((record) => llmModelOf(record)))],
      http_statuses: [...new Set(llmRecords.map((record) => record.response?.status ?? null))],
    },
    model_lifecycle_before: lifecycleBefore
      ? {
          at: lifecycleBefore.at,
          model: lifecycleBefore.model,
          strata_control: lifecycleBefore.strata_control,
          strata_v1_models: lifecycleBefore.strata_v1_models,
        }
      : null,
    author_question_events: questionEvents,
    candidate_ax_visible_old_to_new: visibleOldToNew,
    wait_ledger: common.ledger,
  };

  const evidenceBoundary =
    "scoped real-model evidence（真实 Strata/iq3_s 经原生 Tauri 入口）：只覆盖 T1 正例（判断绑定/候选/原生保存/DB+receipt）与 T2 同名澄清负例（零写入）。" +
    "不覆盖也不冒充 23 项确定性原生矩阵（T3 讨论、T4 刷新/消费者、T5 放弃/重复/跨作品），该完整矩阵由 b29-existing-character-role-revision-native 批次承担。";

  write(dir, "b29-native-checks.json", {
    slice_id: config.slice_id,
    at: new Date().toISOString(),
    driver: ui.driver,
    provider: config.provider,
    model: config.model,
    scope: "scoped_real_model",
    checks,
    failed,
    measured,
    evidence: {
      source: "B29 浏览器 canonical 矩阵中 T1/T2 的真实模型 scoped 复验（不重跑全矩阵，不换分）",
      browser_surface: false,
      native_driver: "ax-native-system-ui",
      checks_passed: Object.values(checks).filter(Boolean).length,
      checks_total: Object.keys(checks).length,
      llm_call_count: llmRecords.length,
      provider_calls: providerStarts.length,
      production_unchanged: production.unchanged,
      production_changed_files: production.changed_files,
      run_ref: ready.run_ref,
      ready_at: ready.ready_at,
    },
  });
  write(dir, "native-evidence.json", {
    scenario: config.slice_id,
    surface: "tauri",
    driver: ui.driver,
    provider: config.provider,
    model: config.model,
    scope: "scoped_real_model",
    canonical_registered: false,
    evidence_boundary: evidenceBoundary,
    trials: ["T1_positive_real_model", "T2_same_name_negation_real_model"],
    checks,
    measured,
    checks_passed: Object.values(checks).filter(Boolean).length,
    checks_total: Object.keys(checks).length,
    seed: config.seed,
    screenshots: ui.screenshots,
  });
  write(dir, "summary.json", {
    slice_id: config.slice_id,
    surface: "tauri",
    driver: ui.driver,
    provider: config.provider,
    model: config.model,
    scope: "scoped_real_model",
    canonical_registered: false,
    evidence_boundary: evidenceBoundary,
    verified_at: new Date().toISOString(),
    checks_passed: Object.values(checks).filter(Boolean).length,
    checks_total: Object.keys(checks).length,
    all_checks_passed: failed.length === 0,
    failed_checks: failed,
    trials: ["T1", "T2"],
    not_covered: measured.not_covered,
    run_ref: ready.run_ref,
    ready_at: ready.ready_at,
    html_report: null,
    screenshots: ui.screenshots,
  });

  assert.equal(failed.length, 0, `B29 strata scoped 原生断言失败: ${failed.join(", ")}`);
  console.log(
    `B29 strata scoped 真实模型证据通过: checks ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}，` +
      `trials T1+T2（不冒充 23 项矩阵），llm_calls=${llmRecords.length}，provider=strata/model=${config.model}`,
  );
  return { checks, measured };
}

export function verify(dir) {
  const config = read(dir, "b29-native-config.json");
  if (config.provider === "strata") return verifyStrataScoped(dir, config);
  return verifyDeterministic(dir, config);
}

export async function main([mode, artifact, extra]) {
  const dir = path.resolve(artifact);
  if (mode === "prepare") return prepare(dir);
  if (mode === "capture") return capture(dir, extra);
  if (mode === "verify") return verify(dir);
  if (mode === "facts") return console.log(JSON.stringify(captureFacts(dir), null, 2));
  throw new Error("unknown mode");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    if (process.argv[2] === "prepare") {
      const dir = path.resolve(process.argv[3]);
      if (fs.existsSync(dir) && !fs.existsSync(path.join(dir, "failure.json"))) {
        fs.writeFileSync(
          path.join(dir, "failure.json"),
          JSON.stringify({ at: new Date().toISOString(), phase: "B29-prepare", reason: error.message }),
        );
      }
    }
    console.error(error);
    process.exitCode = 1;
  });
}
