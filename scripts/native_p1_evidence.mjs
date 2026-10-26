// P1 原生实模 scoped 创作旅程的只读证据适配：测量动作全部由外部 macOS AX/CGEvent 驱动真实
// Tauri 窗口完成。本文件只消费隔离批次的既有证据（seed.log / native-transport.jsonl /
// app-log / llm-calls / 只读 SQLite 快照 / AX 文本与截图 / 生产源码指纹 / 模型生命周期），
// 不操作产品、不读取产品验收开关。
//
// 覆盖 NEXT 要求的「原生创作/维护/恢复/导出」四项能力（scoped，不重跑 canonical 10 章矩阵）：
//   T1 创作：真实主输入写第01章正文 → 真实模型 judgment/候选 → 可见候选卡采纳 → DB accepted + 阅读可见
//   T2 维护：真实主输入仅排版修订 → 分段方案候选 → 「应用分段方案」→ 非换行字节不变/同章身份/章数不变
//   T3 恢复：真实关闭原生应用并重开 → 作品/会话/已采纳正文/阅读恢复 → 续写输入 → 采纳 → 同章追加
//   T4 导出：阅读模式「导出全书」→ 真实 macOS 目录选择对话框 → 磁盘文件存在/大小/sha256/内容匹配 → 回工作台
// provider 必须是真实 Strata iq3_s（单槽串行、结束卸载并验证 loaded=null）。
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SLICE_ID = "p1-chapter-draft-generation";
export const WORK_TITLE = "P1 单章正文草稿验证作品";
export const CHAPTER_TITLE = "第01章：底层灵气账单";
export const INPUTS = Object.freeze({
  // 与 canonical runner 同一自然作者措辞口径（真实主输入，不点档案按钮旁路）。
  t1: "第01章：底层灵气账单的正文还没写，帮我写出来吧。",
  t2: "把第01章正文整理一下，只调整分段和排版，不要改字句。",
  t3: "接着第01章：底层灵气账单往下写一段吧。",
});
// strata 真实模型 scoped 批次只覆盖 T1–T4 四项能力，不重跑 canonical 10 章/维护 5 拍矩阵。
export const CHECKPOINTS = Object.freeze([
  "seed",
  "t1-before",
  "t1-after",
  "t2-before",
  "t2-after",
  "t3-before-restore",
  "t3-after-restore",
  "t3-after",
  "final",
]);

const read = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
// 证据文件不可覆盖（失败批次只读保留）；verifier 自身输出用 writeOut。
const write = (dir, file, value) => {
  assert(!fs.existsSync(path.join(dir, file)), `证据不得覆盖: ${file}`);
  fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2));
};
const writeOut = (dir, file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2));
const jsonl = (file) =>
  fs.readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.includes("{"))
    .map((line) => JSON.parse(line.slice(line.indexOf("{"))));
const logs = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".jsonl"))
        .sort()
        .flatMap((f) => jsonl(path.join(dir, f)))
    : [];
const sha256 = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");
const shaFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stripNewlines = (value) => String(value ?? "").replace(/\r/g, "").replace(/\n/g, "");
const countNewlines = (value) => (String(value ?? "").match(/\n/g) ?? []).length;

function seedFields(dir) {
  const seedPath = path.join(dir, "seed.log");
  assert(fs.existsSync(seedPath), "seed.log 缺失");
  const tokens = fs.readFileSync(seedPath, "utf8").split(/\s+/);
  const field = (name) => {
    const prefix = `${name}=`;
    const token = tokens.find((part) => part.startsWith(prefix));
    return token ? token.slice(prefix.length) : null;
  };
  const fields = Object.fromEntries(
    ["work_id", "session_id", "memory_item_id"].map((name) => [name, field(name)]),
  );
  for (const [key, value] of Object.entries(fields)) assert(value, `P1 seed 字段缺失: ${key}`);
  return fields;
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
const one = (db, sql, params = []) => db.prepare(sql).get(...params) ?? null;

// ── 作品事实快照：章节身份/正文（accepted 按场景顺序拼接）/草稿版本/摘要/会话 ─────────────
export function workFacts(db, workId) {
  const work = one(db, "SELECT id, title, status FROM works WHERE id = ?", [workId]);
  assert(work, `作品不存在: ${workId}`);
  const chapters = all(db, "SELECT id, title, seq, status, volume_id, summary FROM chapters WHERE work_id = ? ORDER BY seq", [workId]);
  const scenes = all(db, "SELECT id, chapter_id, title, seq, status FROM scenes WHERE work_id = ? ORDER BY chapter_id, seq", [workId]);
  const drafts = all(
    db,
    "SELECT d.id, d.scene_id, s.chapter_id, d.content, d.status AS draft_status, d.revision FROM drafts d JOIN scenes s ON s.id = d.scene_id WHERE d.work_id = ? ORDER BY s.chapter_id, s.seq, d.revision",
    [workId],
  );
  const summaries = all(
    db,
    "SELECT id, chapter_id, status, summary_text, source_ref, revision_base FROM chapter_summaries WHERE work_id = ? ORDER BY inserted_at",
    [workId],
  );
  const sessions = all(db, "SELECT id, status, last_opened_at, title FROM work_sessions WHERE work_id = ? ORDER BY inserted_at", [workId]);
  const memories = all(db, "SELECT id, type, status FROM memory_items WHERE work_id = ? ORDER BY inserted_at", [workId]);
  const scenesByChapter = new Map();
  for (const scene of scenes) {
    const list = scenesByChapter.get(scene.chapter_id) ?? [];
    list.push(scene.id);
    scenesByChapter.set(scene.chapter_id, list);
  }
  const acceptedByChapter = new Map();
  for (const draft of drafts.filter((row) => row.draft_status === "ACCEPTED")) {
    const list = acceptedByChapter.get(draft.chapter_id) ?? [];
    list.push({ id: draft.id, revision: Number(draft.revision), content: String(draft.content ?? "") });
    acceptedByChapter.set(draft.chapter_id, list);
  }
  const chapterContent = {};
  const orderedByChapter = new Map();
  for (const chapter of chapters) {
    const sceneIds = scenesByChapter.get(chapter.id) ?? [];
    const accepted = [...(acceptedByChapter.get(chapter.id) ?? [])].sort(
      (a, b) =>
        sceneIds.indexOf(drafts.find((d) => d.id === a.id)?.scene_id) -
        sceneIds.indexOf(drafts.find((d) => d.id === b.id)?.scene_id),
    );
    orderedByChapter.set(
      chapter.id,
      accepted.map((row) => row.id),
    );
    chapterContent[chapter.id] = accepted.map((row) => row.content).filter(Boolean).join("\n\n");
  }
  return {
    work_id: workId,
    work: { id: work.id, title: work.title, status: work.status },
    chapters: chapters.map((row) => ({ id: row.id, title: row.title, seq: Number(row.seq), status: row.status, volume_id: row.volume_id ?? null })),
    chapter_count: chapters.length,
    scenes: scenes.map((row) => ({ id: row.id, chapter_id: row.chapter_id, seq: Number(row.seq), title: row.title, status: row.status })),
    drafts: drafts.map((row) => ({
      id: row.id,
      scene_id: row.scene_id,
      chapter_id: row.chapter_id,
      status: row.draft_status,
      revision: Number(row.revision),
      content: String(row.content ?? ""),
      content_sha256: sha256(row.content),
      content_length: String(row.content ?? "").length,
      non_newline_sha256: sha256(stripNewlines(row.content)),
    })),
    summaries: summaries.map((row) => ({
      id: row.id,
      chapter_id: row.chapter_id,
      status: row.status,
      summary_sha256: sha256(row.summary_text),
      source_ref: row.source_ref ?? null,
      revision_base: row.revision_base ?? null,
    })),
    sessions: sessions.map((row) => ({ id: row.id, status: row.status, title: row.title, last_opened_at: row.last_opened_at })),
    memory_items: memories.map((row) => ({ id: row.id, type: row.type, status: row.status })),
    chapter_content: chapterContent,
    chapter_content_by_draft: Object.fromEntries(
      chapters.map((chapter) => [
        chapter.id,
        (orderedByChapter.get(chapter.id) ?? []).map((draftId) => {
          const draft = drafts.find((row) => row.id === draftId);
          return { draft_id: draftId, content_sha256: sha256(draft?.content), content_length: String(draft?.content ?? "").length };
        }),
      ]),
    ),
  };
}

function captureFacts(dir) {
  return withDb(dir, (db) => {
    const seed = seedFields(dir);
    return { facts: workFacts(db, seed.work_id) };
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
  const files = listing
    .split("\n")
    .map((file) => file.trim())
    .filter((file) => file && productPath(file))
    .sort();
  const hashes = {};
  for (const file of files) {
    const absolute = path.join(ROOT, file);
    hashes[file] = fs.existsSync(absolute) ? shaFile(absolute) : "missing";
  }
  const head = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return { head, file_count: files.length, files: hashes };
}

// 测试数据准备（仅隔离副本 SQLite）：把 seed 作品置为最近打开，使原生窗口启动直接进入该作品。
// 等价于作者上一次打开该作品后重开应用；不改产品代码、不碰源库。
function markWorkNewest(dir, workId) {
  execFileSync(
    "python3",
    [
      "-c",
      [
        "import sqlite3,sys,datetime",
        "db=sqlite3.connect(sys.argv[1], timeout=10)",
        "ts=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')+'Z'",
        "db.execute('update works set updated_at=? where id=?',(ts,sys.argv[2]))",
        "db.commit(); db.close()",
      ].join("\n"),
      dbPath(dir),
      workId,
    ],
    { stdio: "ignore" },
  );
}

// ── 真实模型生命周期：跑前记录 / 跑后卸载并验证 loaded=null（单槽串行硬约束）──────────
function lmsPs() {
  const bin = process.env.LMS_BIN ?? path.join(os.homedir(), ".lmstudio", "bin", "lms");
  try {
    return { ok: true, output: execFileSync(bin, ["ps"], { encoding: "utf8", timeout: 20_000 }) };
  } catch (error) {
    return { ok: false, output: null, error: String(error.message ?? error).slice(0, 300) };
  }
}

function memorySnapshot() {
  try {
    return execFileSync("sh", ["-c", "vm_stat | head -8; sysctl -n hw.memsize; sysctl -n vm.swapusage 2>/dev/null"], {
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

const strataBase = () => (process.env.NOVEL_STRATA_ENDPOINT ?? "http://127.0.0.1:47831/v1").replace(/\/v1\/?$/, "");

async function probeStrata() {
  const base = strataBase();
  const grab = async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  };
  const models = await grab(`${base}/api/models`).catch((error) => ({ status: null, error: String(error.message) }));
  const v1Models = await grab(`${base}/v1/models`).catch((error) => ({ status: null, error: String(error.message) }));
  return { models, v1Models, base };
}

async function recordModelLifecycleBefore(dir, ready, model) {
  const probe = await probeStrata();
  const v1Ids = (probe.v1Models.body?.data ?? []).map((row) => row.id);
  const record = {
    at: new Date().toISOString(),
    provider: "strata",
    endpoint: probe.base,
    model,
    lms_ps: lmsPs(),
    strata_control: {
      status: probe.models.status ?? null,
      mode: probe.models.body?.mode ?? null,
      loaded: probe.models.body?.loaded ?? null,
      current: probe.models.body?.current ?? null,
    },
    strata_v1_models: { status: probe.v1Models.status ?? null, ids: v1Ids },
    memory: memorySnapshot(),
    processes: strataProcessSnapshot(),
    run_ref: ready.run_ref,
  };
  write(dir, "model-lifecycle-before.json", record);
  // 单槽串行前置：真实模型批次的跑前 Strata 控制面必须为空（已有模型属于作者/其它批次，不擅自卸载）。
  assert.equal(
    record.strata_control.loaded,
    null,
    `preflight_strata_model_loaded:${JSON.stringify(record.strata_control).slice(0, 300)}`,
  );
  return record;
}

// POST /api/models/unload 后轮询直到 loaded=null；用于批次结束（成功/失败/中断）清理。
export async function unloadModel(dir) {
  const base = strataBase();
  const response = await fetch(`${base}/api/models/unload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(20_000),
  }).catch((error) => ({ ok: false, status: null, text: async () => String(error.message) }));
  const responseBody = await response.text().catch(() => "");
  const started = Date.now();
  let loaded = "unverified";
  let control = null;
  while (Date.now() - started < 30_000) {
    const probe = await probeStrata();
    control = probe.models.body ?? null;
    loaded = probe.models.body?.loaded ?? null;
    if (loaded === null) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  const record = {
    at: new Date().toISOString(),
    endpoint: `${base}/api/models/unload`,
    post_status: response.status ?? null,
    post_body: String(responseBody).slice(0, 600),
    poll_ms: Date.now() - started,
    strata_control: { loaded, current: control?.current ?? null, mode: control?.mode ?? null },
    unload_verified_loaded_null: loaded === null,
    lms_ps: lmsPs(),
    memory: memorySnapshot(),
    processes: strataProcessSnapshot(),
  };
  const outFile = path.join(dir, "model-lifecycle-after.json");
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2));
  return record;
}

export async function prepare(dir) {
  const ready = read(dir, "native-driver-ready.json");
  assert.equal(ready.driver, "external-system-ui", "原生批次 ready 驱动标识必须是 external-system-ui");
  assert.equal(ready.browser_driver_started, false, "原生批次不得启动 Chromium 浏览器驱动");
  assert.equal(ready.provider, "strata", `P1 真实模型批次 provider 必须是 strata，实测: ${ready.provider}`);
  const seed = seedFields(dir);
  const facts = withDb(dir, (db) => workFacts(db, seed.work_id));
  assert.equal(facts.work.title, WORK_TITLE, `seed 作品标题不符: ${facts.work.title}`);
  const chapter = facts.chapters.find((row) => row.title === CHAPTER_TITLE);
  assert(chapter, `seed 缺少目标章: ${CHAPTER_TITLE}`);
  assert.equal(chapter.seq, 1, "目标章 seq 必须是 1");
  const model = process.env.NOVEL_STRATA_MODEL ?? "iq3_s";
  const exportDir = path.join(dir, "export-dir");
  fs.mkdirSync(exportDir, { recursive: true });
  const config = {
    slice_id: SLICE_ID,
    scope: "scoped_native_creation_maintenance_restore_export",
    work_title: WORK_TITLE,
    chapter_title: CHAPTER_TITLE,
    provider: ready.provider,
    model,
    run_ref: ready.run_ref,
    ready_at: ready.ready_at,
    seed,
    chapter_id: chapter.id,
    seed_chapter_count: facts.chapter_count,
    seed_chapter_ids: facts.chapters.map((row) => row.id),
    inputs: INPUTS,
    export_dir: exportDir,
  };
  write(dir, "p1-native-config.json", config);
  await recordModelLifecycleBefore(dir, ready, model);
  write(dir, "production-sources-before.json", productionFingerprint());
  markWorkNewest(dir, seed.work_id);
  capture(dir, "seed");
  console.log(
    `P1 原生证据准备完成: provider=${config.provider} model=${model} work=${seed.work_id} chapter=${chapter.id} export_dir=${exportDir}`,
  );
}

export function capture(dir, checkpoint) {
  assert(CHECKPOINTS.includes(checkpoint), `未知 checkpoint: ${checkpoint}`);
  const snapshot = captureFacts(dir);
  write(dir, `${checkpoint}.json`, { at: new Date().toISOString(), checkpoint, ...snapshot });
}

// ── 传输帧/日志对账 helper ────────────────────────────────────────────────────
function transport(dir) {
  const file = path.join(dir, "native-transport.jsonl");
  assert(fs.existsSync(file), "native-transport.jsonl 缺失（外部传输代理未采证）");
  return jsonl(file);
}

const frameOf = (record) => (Array.isArray(record?.frame) && record.frame.length >= 5 ? record.frame : null);
const frameEvent = (record) => frameOf(record)?.[3] ?? null;
const frameBody = (record) => frameOf(record)?.[4] ?? null;
const atMs = (value) => Date.parse(String(value ?? ""));

function sentUserMessages(wire, text) {
  return wire.filter(
    (record) =>
      record.direction === "sent" && frameEvent(record) === "user_message" && String(frameBody(record)?.text ?? "") === text,
  );
}

function sentFrames(wire) {
  return wire.filter((record) => record.direction === "sent" && frameOf(record));
}

function turnFacts(wire, messageFrame) {
  const turnId = String(frameBody(messageFrame)?.turn_id ?? "");
  assert(turnId, "user_message 缺 turn_id");
  const ack = wire.find(
    (record) =>
      record.direction === "received" &&
      frameOf(record) &&
      record.at >= messageFrame.at &&
      record.frame[1] === messageFrame.frame[1] &&
      record.frame[3] === "phx_reply" &&
      record.frame[4]?.status === "ok" &&
      record.frame[4]?.response?.turn_id === turnId,
  );
  const results = wire.filter(
    (record) =>
      record.direction === "received" &&
      frameOf(record) &&
      record.at >= messageFrame.at &&
      record.frame[3] === "turn_result" &&
      String(record.frame[4]?.turn_id ?? "").startsWith(turnId),
  );
  assert(results.length, `缺少 turn_result: ${turnId}`);
  return { turnId, message: messageFrame, ack, results, result: results.at(-1).frame[4] };
}

function judgmentsFor(appRecords, turnId) {
  return appRecords
    .filter((record) => record.event === "judgment.decided.done" && String(record.turn_id ?? "").startsWith(turnId))
    .map((record) => ({
      action: record.action ?? null,
      capability: record.capability ?? null,
      frame_type: record.frame_type ?? null,
      reason_code: String(record.reason_code ?? "").slice(0, 400),
    }));
}

const REVISION_CAPABILITIES = ["revise_adopted_content", "prose_revision", "revise_prose", "revise_chapter"];
const contentArtifactTypes = new Set(["prose_fragment", "scene_draft", "prose_formatting_plan"]);
const pendingOf = (turn) => turn?.result?.adoption_state?.pending ?? [];

function candidateBody(candidate) {
  const payload = candidate?.payload ?? {};
  if (typeof payload.formatting_preview === "string" && payload.formatting_preview.length > 0) {
    return { mode: "formatting_preview", body: payload.formatting_preview };
  }
  if (Array.isArray(payload.items)) {
    const bodies = payload.items.map((item) => item?.body).filter((value) => typeof value === "string" && value.length > 0);
    if (bodies.length) return { mode: "items_body", body: bodies.join("\n\n") };
  }
  if (typeof payload.content === "string" && payload.content.length > 0) return { mode: "content", body: payload.content };
  return { mode: "none", body: "" };
}

function candidateProviderRefs(candidate) {
  const refs = [];
  if (typeof candidate?.payload?.provider_call_ref === "string") refs.push(candidate.payload.provider_call_ref);
  for (const item of candidate?.payload?.items ?? []) {
    if (typeof item?.provider_call_ref === "string") refs.push(item.provider_call_ref);
  }
  return [...new Set(refs)];
}

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
      frameOf(record) &&
      record.frame[3] === "author_action" &&
      record.frame[4]?.action?.target_ref === artifactId &&
      ["accept", "adopt", "confirm_adoption"].includes(String(record.frame[4]?.action?.action_type)),
  );
  assert.equal(sends.length, 1, `候选采纳必须恰好一次且来自 UI: ${artifactId} (${sends.length})`);
  const send = sends[0];
  const action = send.frame[4].action;
  const accepted = wire.filter(
    (record) =>
      record.direction === "received" &&
      frameOf(record) &&
      record.at >= send.at &&
      record.frame[3] === "action_result" &&
      record.frame[4]?.status === "accepted",
  );
  const attributed = accepted.filter((record) => receiptMatchesArtifact(record.frame[4], artifactId, action));
  assert(accepted.length, `缺少 accepted action_result: ${artifactId}`);
  assert(attributed.length, `accepted action_result 无法归属: ${artifactId}`);
  const receipt = attributed.at(-1).frame[4];
  const resolved = wire.filter(
    (record) =>
      record.direction === "received" &&
      frameOf(record) &&
      record.at >= send.at &&
      record.frame[3] === "turn_result" &&
      (record.frame[4]?.adoption_state?.resolved ?? []).some((entry) => entry.artifact_id === artifactId),
  );
  return { send, action, receipt, resolved };
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

// 读取投影帧：received phx_reply，response 带 id/title/scenes/word_count。
function readingProjections(wire) {
  return wire
    .filter((record) => record.direction === "received" && frameOf(record) && record.frame[3] === "phx_reply")
    .map((record) => ({ at: record.at, response: record.frame[4]?.response ?? null }))
    .filter(
      (entry) =>
        entry.response &&
        typeof entry.response === "object" &&
        typeof entry.response.title === "string" &&
        Array.isArray(entry.response.scenes),
    );
}

function readingProjectionAfter(wire, iso, chapterTitle) {
  return (
    readingProjections(wire)
      .filter((entry) => atMs(entry.at) >= atMs(iso) && entry.response.title === chapterTitle)
      .at(-1) ?? null
  );
}

function projectionText(entry) {
  return (entry?.response?.scenes ?? []).map((scene) => String(scene?.content ?? "")).filter(Boolean).join("\n\n");
}

// 选择「正文内容与期望一致」的读数投影（容忍采纳写入期间更早的旧投影帧；场景分隔只按非换行字节比较）。
function readingProjectionFor(wire, iso, chapterTitle, expectedText) {
  if (!expectedText) return null;
  const expected = stripNewlines(expectedText);
  return (
    readingProjections(wire)
      .filter(
        (entry) =>
          atMs(entry.at) >= atMs(iso) &&
          entry.response.title === chapterTitle &&
          stripNewlines(projectionText(entry)) === expected,
      )
      .at(-1) ?? null
  );
}

// 阅读模式 AX 可见性探针：取正文第一行有意义的片段（AX 文本按行渲染，逐行文本可稳定命中）。
function proseProbe(text) {
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 8);
  return lines[0]?.slice(0, 30) ?? "";
}

function assertWaitLedger(dir, readyAt) {
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
  for (const command of commands.filter((entry) => entry.op === "begin")) {
    assert(command.at >= Date.parse(readyAt) - 5_000, "等待账早于本批窗口就绪");
  }
  const eventsFile = path.join(dir, "wait-events.jsonl");
  assert(fs.existsSync(eventsFile), "缺少 wait-events.jsonl（监督未采证等待账）");
  const events = fs.readFileSync(eventsFile, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  const started = events.filter((event) => event.event === "wait_start");
  const ended = events.filter((event) => event.event === "wait_end");
  assert(started.length >= 18, `等待账条目过少: ${started.length}`);
  assert.equal(started.length, ended.length, "等待账 start/end 不平衡");
  const kinds = new Set(ended.map((event) => event.kind));
  for (const required of ["input", "turn", "candidate", "adoption", "maintenance", "restore", "export"]) {
    assert(kinds.has(required), `缺少 ${required} 分型等待账`);
  }
  const stats = read(dir, "wait-stats.json");
  assert.equal(stats.active, null, "等待账结束时不得有活动等待");
  assert(!stats.failure, `等待账存在失败: ${stats.failure}`);
  assert(stats.completed >= started.length, "等待账完成数不足");
  const heartbeatFile = path.join(dir, "heartbeat.jsonl");
  assert(fs.existsSync(heartbeatFile), "缺少监督心跳 heartbeat.jsonl");
  const heartbeat = fs.readFileSync(heartbeatFile, "utf8").split("\n").filter(Boolean);
  assert(heartbeat.length >= 2, "监督心跳记录不足");
  return {
    commands: commands.length,
    waits: ended.length,
    kinds: [...kinds],
    by_kind: stats.by_kind ?? null,
    active: stats.active ?? null,
    timeouts: 0,
  };
}

function checkProductionFingerprint(dir) {
  const before = read(dir, "production-sources-before.json");
  const now = productionFingerprint();
  const changed = Object.keys({ ...before.files, ...now.files }).filter((file) => before.files[file] !== now.files[file]);
  return { unchanged: changed.length === 0, before, changed_files: changed.slice(0, 20), head: { before: before.head, now: now.head } };
}

// ── provider 因果绑定：候选 item 的 provider_call_ref → DB provider_runs/provider_outputs ──────
function usageModelOf(row) {
  try {
    return JSON.parse(String(row.usage ?? "{}")).model ?? null;
  } catch {
    return null;
  }
}

// provider 因果绑定：候选 item 的 provider_call_ref 必须命中真实 provider run（strata、completed、outputs ok），
// 且该 run 的 provider_outputs.usage.model 必须是实际服务模型 iq3_s（产品侧 provider_gateway 记录的 model 标签
// 在 slice 运行时为 unconfigured，由 Strata 统一入口按默认模型服务；真实身份以 provider 返回 usage 为准）。
function providerProvenance(db, refs, turnId) {
  const query = (where, params) =>
    all(
      db,
      `SELECT r.provider_call_ref, r.parent_turn_ref, r.purpose, r.provider_id, r.model, r.status,
              o.status AS output_status, o.output_type, o.content_length, o.usage
       FROM provider_runs r LEFT JOIN provider_outputs o ON o.provider_run_id = r.id
       WHERE ${where} ORDER BY r.inserted_at`,
      params,
    );
  const runs = refs.length ? query(`r.provider_call_ref IN (${refs.map(() => "?").join(",")})`, refs) : [];
  const turnRuns = query("r.parent_turn_ref LIKE ?", [`${turnId}%`]);
  const selected = refs.length && runs.length ? runs : turnRuns;
  const real = selected.filter(
    (row) =>
      row.provider_id === "strata" &&
      row.status === "completed" &&
      row.output_status === "ok" &&
      usageModelOf(row) === "iq3_s",
  );
  return {
    refs,
    matched_ref_rows: runs.length,
    turn_run_count: turnRuns.length,
    real_model_runs: real,
    purpose: selected[0]?.purpose ?? null,
    usage_models: [...new Set(selected.map(usageModelOf).filter(Boolean))],
    refs_matched: refs.length > 0 && runs.length === refs.length,
    bound: real.length > 0,
  };
}

// ── verify ───────────────────────────────────────────────────────────────────
async function verify(dir) {
  const config = read(dir, "p1-native-config.json");
  const ready = read(dir, "native-driver-ready.json");
  const ui = read(dir, "native-ui-complete.json");
  const driverLog = read(dir, "p1-native-driver-log.json");
  const production = checkProductionFingerprint(dir);
  const appRecords = logs(path.join(dir, "app-log"));
  const llmRecords = logs(path.join(dir, "llm-calls"));
  const wire = transport(dir);
  const checkpointTexts = ["t1-before", "t1-after", "t2-before", "t2-after", "t3-before-restore", "t3-after-restore", "t3-after", "final"];
  const snap = Object.fromEntries(checkpointTexts.map((name) => [name, read(dir, `${name}.json`)]));
  const seed = read(dir, "seed.json").facts;
  const facts = (name) => snap[name].facts;

  // ── 通用原生证据边界 ─────────────────────────────────────────────────────
  assert.equal(ui.harness_run_ref, ready.run_ref, "native-ui-complete 未绑定本批次 run_ref");
  assert.equal(ui.driver, "ax-native-system-ui", "原生驱动标识必须是 ax-native-system-ui（非 CUA/浏览器）");
  assert.equal(ui.app_bundle, "com.ai-novel-studio.app");
  assert.equal(ui.scope, config.slice_id);
  assert.equal(ready.driver, "external-system-ui");
  assert.equal(ready.browser_driver_started, false, "原生批次不得启动 Chromium 浏览器驱动");
  assert(!fs.existsSync(path.join(dir, "ui-frames.json")), "原生批次不得存在浏览器 ui-frames 证据");
  assert(!fs.existsSync(path.join(dir, "failure.json")), "批次存在 failure.json，不得判 PASS");
  assert(Array.isArray(ui.screenshots), "native-ui-complete.screenshots 缺失");
  assert(ui.screenshots.length >= 14, `截图不足: ${ui.screenshots.length}`);
  for (const name of ui.screenshots) {
    const file = path.resolve(dir, name);
    assert(file.startsWith(dir + path.sep), `截图越界: ${name}`);
    assert(fs.existsSync(file), `截图缺失: ${name}`);
    assert(fs.statSync(file).mtimeMs >= Date.parse(ready.ready_at), `截图早于窗口就绪: ${name}`);
    const magic = fs.readFileSync(file).subarray(0, 8).toString("hex");
    assert(magic.startsWith("ffd8ff") || magic === "89504e470d0a1a0a", `截图格式非法: ${name}`);
  }
  for (const name of [
    "T1-candidate",
    "T1-receipt",
    "T1-reading",
    "T2-candidate",
    "T2-receipt",
    "T2-reading",
    "T3-restored-workbench",
    "T3-restored-reading",
    "T3-candidate",
    "T3-receipt",
    "T3-reading",
    "T4-export-dialog",
    "T4-export-success",
    "T4-back-workbench",
  ]) {
    assertRecordFresh(dir, name, ready.ready_at);
  }
  const ledger = assertWaitLedger(dir, ready.ready_at);
  const productionUnchanged = production.unchanged;
  void production.before;

  // ── 真实模型边界：app-log + llm-calls 全部 strata/iq3_s ────────────────────
  const providerStarts = appRecords.filter(
    (record) => record.event === "provider_gateway.complete.start" && record.work_id === config.seed.work_id,
  );
  assert(providerStarts.length > 0, "缺少 provider_gateway.complete.start（判断/创作调用未走真实 provider 边界）");
  const providers = [...new Set(providerStarts.map((record) => record.provider))];
  assert(same(providers, ["strata"]), `真实模型批次 provider 必须全部 strata，实测: ${providers.join(",")}`);
  // 产品侧 provider_gateway 记录的 model 标签在 slice 运行时可能为 unconfigured（provider 配置未注入 model 名，
  // 由 Strata 统一入口按默认模型 iq3_s 服务）；真实模型身份以 provider_outputs.usage.model（provider 返回）为准。
  const reportedModels = [...new Set(providerStarts.map((record) => record.model))];
  const purposes = providerStarts.reduce((acc, record) => {
    acc[record.purpose ?? "unknown"] = (acc[record.purpose ?? "unknown"] ?? 0) + 1;
    return acc;
  }, {});
  const llmModelOf = (record) => record.request?.body?.model ?? record.response?.model ?? null;
  const workLlm = llmRecords.filter((record) => !record.work_id || record.work_id === config.seed.work_id);
  assert(workLlm.length > 0, "缺少 llm-calls 调用记录");
  const llmProviders = [...new Set(workLlm.map((record) => record.provider))];
  assert(same(llmProviders, ["strata"]), `llm-calls provider 必须全部 strata，实测: ${llmProviders.join(",")}`);
  const llmModels = [...new Set(workLlm.map(llmModelOf))];
  void llmModelOf;
  // 真实模型身份：provider_runs(purpose, provider_id=strata) → provider_outputs.usage.model（provider 返回的模型名）。
  const modelUsage = withDb(dir, (db) =>
    all(
      db,
      `SELECT r.provider_call_ref, r.parent_turn_ref, r.purpose, r.provider_id, r.status, o.usage
       FROM provider_runs r LEFT JOIN provider_outputs o ON o.provider_run_id = r.id
       WHERE r.provider_id = 'strata' ORDER BY r.inserted_at`,
    ),
  );
  const usageModels = [
    ...new Set(
      modelUsage
        .map((row) => {
          try {
            return JSON.parse(String(row.usage ?? "{}")).model ?? null;
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    ),
  ];
  const usageRunCount = modelUsage.filter((row) => {
    try {
      return JSON.parse(String(row.usage ?? "{}")).model === config.model;
    } catch {
      return false;
    }
  }).length;
  // narration 等直连调用只有 provider_gateway 记录、不建 provider_runs 行；provider_runs ≥4 即可证明真实模型 run。
  assert(modelUsage.length >= 4, `provider_runs 真实模型 run 过少: ${modelUsage.length}`);
  assert(same(usageModels, [config.model]), `provider 返回的真实模型必须是 ${config.model}，实测: ${usageModels.join(",")}`);
  const llmStatuses = workLlm.map((record) => Number(record.response?.status ?? 0));
  assert(llmStatuses.every((status) => status >= 200 && status < 300), "真实模型 provider 响应必须全部 HTTP 2xx");
  const llmUrls = [...new Set(workLlm.map((record) => String(record.request?.url ?? "")))];
  assert(llmUrls.some((url) => /\/chat\/completions/.test(url)), "真实模型请求必须走真实 /chat/completions");
  const llmTurns = [...new Set(workLlm.map((record) => String(record.turn_id ?? "")).filter(Boolean))];
  const callDurations = workLlm.map((record) => Number(record.response?.duration_ms ?? 0)).filter((value) => value > 0);
  const realCalls = providerStarts.length;
  const llmTotalDurationMs = workLlm.reduce((sum, record) => sum + Number(record.response?.duration_ms ?? 0), 0);

  // ── 模型生命周期：跑前 loaded=null，跑后卸载并验证 loaded=null ────────────────
  const lifecycleBefore = read(dir, "model-lifecycle-before.json");
  assert.equal(lifecycleBefore.provider, "strata");
  assert.equal(lifecycleBefore.strata_control?.loaded, null, "跑前 Strata loaded 必须为 null（单槽串行前置）");
  assert((lifecycleBefore.strata_v1_models?.ids ?? []).includes(config.model), "跑前 /v1/models 必须登记目标模型");
  assert(lifecycleBefore.lms_ps?.ok === true, "跑前 lms ps 记录失败");
  const lifecycleAfter = fs.existsSync(path.join(dir, "model-lifecycle-after.json"))
    ? read(dir, "model-lifecycle-after.json")
    : null;
  assert(lifecycleAfter, "缺少跑后 model-lifecycle-after.json（必须卸载并验证）");
  assert.equal(lifecycleAfter.strata_control?.loaded, null, "跑后 Strata loaded 必须为 null（已卸载）");
  assert(lifecycleAfter.unload_verified_loaded_null === true, "跑后卸载未验证 loaded=null");

  // ── 指令：三条真实主输入各一次，无重发 ────────────────────────────────────
  const userMessages = wire.filter((record) => record.direction === "sent" && frameEvent(record) === "user_message");
  const texts = userMessages.map((record) => String(frameBody(record)?.text ?? ""));
  const instructionTurns = {};
  for (const [id, text] of Object.entries(INPUTS)) {
    const matched = userMessages.filter((record) => String(frameBody(record)?.text ?? "") === text);
    assert.equal(matched.length, 1, `指令「${id}」必须恰好真实发送一次: ${matched.length}`);
    instructionTurns[id] = matched[0];
  }
  assert.equal(userMessages.length, 3, `本批次只允许三条真实主输入，实测: ${userMessages.length} (${texts.join(" | ")})`);
  const repliedMessages = sentFrames(wire).filter((record) => frameEvent(record) !== "user_message");
  const replies = repliedMessages.filter((record) => frameEvent(record) === "author_action" && frameBody(record)?.action?.payload?.question_ref);
  void replies;
  const terminateFrames = sentFrames(wire).filter((record) => /terminate|cancel/i.test(frameEvent(record) ?? ""));
  const cancelActions = sentFrames(wire).filter(
    (record) =>
      frameEvent(record) === "author_action" &&
      /cancel|terminate|abort/i.test(String(frameBody(record)?.action?.action_type ?? "")),
  );
  assert.equal(terminateFrames.length + cancelActions.length, 0, "批次不得 cancel/终止真实模型 run");

  const t1Turn = turnFacts(wire, instructionTurns.t1);
  const t2Turn = turnFacts(wire, instructionTurns.t2);
  const t3Turn = turnFacts(wire, instructionTurns.t3);
  const t1Pending = pendingOf(t1Turn).find((entry) => contentArtifactTypes.has(entry.artifact_type));
  const t2Pending = pendingOf(t2Turn).find((entry) => contentArtifactTypes.has(entry.artifact_type));
  const t3Pending = pendingOf(t3Turn).find((entry) => contentArtifactTypes.has(entry.artifact_type));
  assert(t1Pending, "T1 缺少正文候选");
  assert(t2Pending, "T2 缺少排版/修订候选");
  assert(t3Pending, "T3 续写缺少正文候选");
  const t1Candidate = { pending: t1Pending, ...candidateBody(t1Pending), refs: candidateProviderRefs(t1Pending) };
  const t2Candidate = { pending: t2Pending, ...candidateBody(t2Pending), refs: candidateProviderRefs(t2Pending) };
  const t3Candidate = { pending: t3Pending, ...candidateBody(t3Pending), refs: candidateProviderRefs(t3Pending) };
  const t1Adoption = adoptionFor(wire, t1Pending.artifact_id);
  const t2Adoption = adoptionFor(wire, t2Pending.artifact_id);
  const t3Adoption = adoptionFor(wire, t3Pending.artifact_id);

  // ── T1 创作 ──────────────────────────────────────────────────────────────
  const seedFacts = seed;
  const t1Before = facts("t1-before");
  const t1After = facts("t1-after");
  const t2Before = facts("t2-before");
  const t2After = facts("t2-after");
  const t3BeforeRestore = facts("t3-before-restore");
  const t3AfterRestore = facts("t3-after-restore");
  const t3After = facts("t3-after");
  const finalFacts = facts("final");
  const t1Judgments = judgmentsFor(appRecords, t1Turn.turnId);
  const t2Judgments = judgmentsFor(appRecords, t2Turn.turnId);
  const t3Judgments = judgmentsFor(appRecords, t3Turn.turnId);
  const chapterId = config.chapter_id;
  const chapterIdentity = (factsValue) =>
    (factsValue.chapters ?? []).map((row) => ({ id: row.id, seq: row.seq, title: row.title }));
  const acceptedDraftsFor = (factsValue, chapter) =>
    (factsValue.drafts ?? []).filter((row) => row.chapter_id === chapter && row.status === "ACCEPTED");
  const chapterContentOf = (factsValue, chapter) => factsValue.chapter_content?.[chapter] ?? "";
  const otherChapterContentUnchanged = (before, after) =>
    (before.chapters ?? [])
      .filter((row) => row.id !== chapterId)
      .every((row) => chapterContentOf(before, row.id) === chapterContentOf(after, row.id));
  const requestStrings = (record) => {
    const strings = [];
    const walk = (value) => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(record.request ?? {});
    return strings;
  };
  const t1InstructionConsumedLater = (needle) => {
    const key = proseProbe(needle);
    if (!key) return false;
    return workLlm.some((record) => requestStrings(record).some((value) => value.includes(key)));
  };

  const t1DbContent = chapterContentOf(t1After, chapterId);
  const t1BeforeContent = chapterContentOf(t1Before, chapterId);
  const t1Accepted = acceptedDraftsFor(t1After, chapterId);
  const t1Provenance = withDb(dir, (db) => providerProvenance(db, t1Candidate.refs, t1Turn.turnId));
  const t1ReadingFrame = readingProjectionFor(wire, t1Adoption.send.at, config.chapter_title, t1DbContent);
  const t1ReadingText = axText(dir, "T1-reading");
  const t1ReadingProbe = proseProbe(t1DbContent);

  // ── T2 维护 ──────────────────────────────────────────────────────────────
  const t2Payload = t2Candidate.pending.payload ?? {};
  const t2Scope = t2Payload.modification_scope ?? t2Payload.scope?.modification_scope ?? null;
  const t2Preview = typeof t2Payload.formatting_preview === "string" ? t2Payload.formatting_preview : null;
  const t2BaseText = typeof t2Payload.base_text === "string" ? t2Payload.base_text : null;
  const t2Effect = t2Payload.adoption_effect ?? {};
  const t2BeforeContent = chapterContentOf(t2Before, chapterId);
  const t2AfterContent = chapterContentOf(t2After, chapterId);
  const t2Accepted = acceptedDraftsFor(t2After, chapterId);
  const t2ReceiptProjection = t2Adoption.receipt?.persistence?.reading_projection ?? {};
  const t2Provenance = withDb(dir, (db) => providerProvenance(db, t2Candidate.refs, t2Turn.turnId));
  const t2ReadingFrame = readingProjectionFor(wire, t2Adoption.send.at, config.chapter_title, t2AfterContent);
  const t2ReadingText = axText(dir, "T2-reading");
  const t2SupersededRetained = (t2After.drafts ?? []).filter(
    (row) => row.chapter_id === chapterId && row.status === "SUPERSEDED",
  );
  const t2ExpectedBaseVersions = (t2Effect.expected_base_versions ?? []).map((row) => ({
    ref: String(row.ref ?? row.draft_ref ?? "").replace(/:\d+$/, ""),
    version: Number(row.version),
  }));
  const t2BeforeDraft = t1Accepted[0] ?? null;
  const t2BaseVersionMatches =
    Boolean(t2BeforeDraft) &&
    t2ExpectedBaseVersions.some(
      (row) => row.ref === `draft:${t2BeforeDraft.id}` && row.version === t2BeforeDraft.revision,
    );
  const t2NonNewlinePreserved = stripNewlines(t2AfterContent) === stripNewlines(t2BeforeContent);

  // ── T3 恢复 + 续写 ────────────────────────────────────────────────────────
  const restoreLogs = (driverLog.captures ?? []).filter((entry) => entry.op === "restore");
  const restoreEntry = restoreLogs.at(-1) ?? null;
  const cleanupFile = path.join(dir, "native-app-cleanup.json");
  const cleanup = fs.existsSync(cleanupFile) ? read(dir, "native-app-cleanup.json") : null;
  const restoreSameFacts =
    same(chapterIdentity(t3BeforeRestore), chapterIdentity(t3AfterRestore)) &&
    same(chapterContentOf(t3BeforeRestore, chapterId), chapterContentOf(t3AfterRestore, chapterId)) &&
    same(
      (t3BeforeRestore.drafts ?? []).map((row) => [row.id, row.status, row.revision, row.content_sha256]),
      (t3AfterRestore.drafts ?? []).map((row) => [row.id, row.status, row.revision, row.content_sha256]),
    );
  const activeSessionBefore = (t3BeforeRestore.sessions ?? []).find((row) => row.status === "ACTIVE");
  const activeSessionAfterRestore = (t3AfterRestore.sessions ?? []).find((row) => row.status === "ACTIVE");
  const restoredWorkbenchText = axText(dir, "T3-restored-workbench");
  const t3BeforeContent = chapterContentOf(t3BeforeRestore, chapterId);
  const t3AfterContent = chapterContentOf(t3After, chapterId);
  const t3Accepted = acceptedDraftsFor(t3After, chapterId);
  const t3Provenance = withDb(dir, (db) => providerProvenance(db, t3Candidate.refs, t3Turn.turnId));
  const restoredReadingFrame = readingProjectionFor(
    wire,
    snap["t3-before-restore"].at,
    config.chapter_title,
    t3BeforeContent,
  );
  const restoredReadingText = axText(dir, "T3-restored-reading");
  const t3ReadingFrame = readingProjectionFor(wire, t3Adoption.send.at, config.chapter_title, t3AfterContent);
  const t3ReadingText = axText(dir, "T3-reading");
  const t3PriorPreserved = stripNewlines(t3AfterContent).startsWith(stripNewlines(t3BeforeContent))
    ? "prefix"
    : stripNewlines(t3AfterContent).includes(stripNewlines(t3BeforeContent))
      ? "contains"
      : "missing";
  const t3SameChapter =
    same(chapterIdentity(t3BeforeRestore), chapterIdentity(t3After)) &&
    t3After.chapter_count === t3BeforeRestore.chapter_count;
  const t3WordGrowth = stripNewlines(t3AfterContent).length > stripNewlines(t3BeforeContent).length;

  // ── T4 导出 ──────────────────────────────────────────────────────────────
  const exportSends = sentFrames(wire).filter((record) => frameEvent(record) === "export_work");
  const exportSend = exportSends.at(-1) ?? null;
  const exportDir = config.export_dir;
  const exportSuccessText = axText(dir, "T4-export-success");
  const exportPathMatch = /已导出到\s+([^\n]+\.md)/.exec(exportSuccessText);
  const exportPath = exportPathMatch ? exportPathMatch[1].trim() : null;
  const exportFile = exportPath && fs.existsSync(exportPath) ? exportPath : null;
  const exportReply = exportSend
    ? wire
        .filter(
          (record) =>
            record.direction === "received" &&
            frameOf(record) &&
            record.at >= exportSend.at &&
            record.frame[3] === "phx_reply" &&
            record.frame[1] === exportSend.frame[1],
        )
        .map((record) => record.frame[4])
        .find((body) => body?.status === "ok" && body?.response?.path) ?? null
    : null;
  const exportFileSha = exportFile ? shaFile(exportFile) : null;
  const exportFileSize = exportFile ? fs.statSync(exportFile).size : 0;
  const exportFileText = exportFile ? fs.readFileSync(exportFile, "utf8") : "";
  // 产品导出语义：单文件 Markdown 写入用户选择的目录；记录目录实际内容，不用截图代替文件证据。
  const exportDirFiles = fs.existsSync(exportDir)
    ? fs
        .readdirSync(exportDir)
        .filter((name) => fs.statSync(path.join(exportDir, name)).isFile())
        .map((name) => ({ name, size_bytes: fs.statSync(path.join(exportDir, name)).size }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const exportDirMarkdownFiles = exportDirFiles.filter((row) => row.name.endsWith(".md"));
  const exportCurrentContent = chapterContentOf(finalFacts, chapterId);
  const exportContentMatch =
    exportFileText.length > 0 &&
    exportCurrentContent.length > 0 &&
    (exportFileText.includes(exportCurrentContent) ||
      stripNewlines(exportFileText).includes(stripNewlines(exportCurrentContent)));
  const backWorkbenchText = axText(dir, "T4-back-workbench");
  const appLogExport = appRecords.filter(
    (record) => record.event === "channel.export_work.done" && record.work_id === config.seed.work_id,
  );

  // ── author question 事件 ─────────────────────────────────────────────────
  const questionEvents = fs.existsSync(path.join(dir, "author_question_events.json"))
    ? read(dir, "author_question_events.json")
    : [];
  const questionRepliesByTurn = questionEvents.reduce((acc, entry) => {
    acc[entry.label] = (acc[entry.label] ?? 0) + 1;
    return acc;
  }, {});
  const questionRepliesBounded = Object.values(questionRepliesByTurn).every((count) => count <= 2);

  // ── checks ───────────────────────────────────────────────────────────────
  const checks = {
    // 原生证据边界
    native_ui_complete_bound_to_run: ui.harness_run_ref === ready.run_ref,
    native_driver_is_ax_system_ui: ui.driver === "ax-native-system-ui" && ready.driver === "external-system-ui",
    native_app_bundle_matches: ui.app_bundle === "com.ai-novel-studio.app",
    native_scope_matches_slice: ui.scope === config.slice_id,
    native_no_browser_driver: ready.browser_driver_started === false && !fs.existsSync(path.join(dir, "ui-frames.json")),
    native_batch_has_no_failure: !fs.existsSync(path.join(dir, "failure.json")),
    native_screenshots_fresh: ui.screenshots.length >= 14,
    wait_ledger_balanced_no_active: ledger.active === null,
    wait_ledger_zero_timeout: ledger.waits >= 18,
    wait_ledger_typed_kinds: ["input", "turn", "candidate", "adoption", "maintenance", "restore", "export"].every((kind) => ledger.kinds.includes(kind)),
    supervisor_heartbeat_present: fs.existsSync(path.join(dir, "heartbeat.jsonl")),
    // 真实模型边界
    provider_all_strata: same(providers, ["strata"]),
    real_model_identity_from_provider_usage: same(usageModels, [config.model]) && usageRunCount >= 4,
    provider_reported_model_labels_recorded: reportedModels.length > 0,
    real_model_calls_at_least_4: realCalls >= 4,
    real_model_calls_span_three_turns: llmTurns.length >= 3,
    llm_calls_all_real_strata: same(llmProviders, ["strata"]),
    llm_calls_http_chat_completions_ok: llmStatuses.every((status) => status >= 200 && status < 300) && llmUrls.some((url) => /\/chat\/completions/.test(url)),
    real_model_call_usage_recorded: usageRunCount >= 4 && llmTotalDurationMs > 0,
    // 模型生命周期
    model_loaded_before_null: lifecycleBefore.strata_control?.loaded === null,
    model_unloaded_after_and_verified: lifecycleAfter.strata_control?.loaded === null && lifecycleAfter.unload_verified_loaded_null === true,
    // 指令无重发/不 cancel
    instructions_each_sent_once: userMessages.length === 3 && Object.values(INPUTS).every((text) => sentUserMessages(wire, text).length === 1),
    no_duplicate_instruction: texts.length === new Set(texts).size,
    no_cancel_or_terminate: terminateFrames.length + cancelActions.length === 0,
    author_question_events_bounded: questionRepliesBounded && fs.existsSync(path.join(dir, "author_question_events.json")),
    author_question_replies_are_real_ui_actions: questionEvents.every((entry) => Boolean(entry.question_ref) || Boolean(entry.reply_text)),
    // 生产源码指纹
    production_sources_unchanged: productionUnchanged,
    no_acceptance_hooks_added: productionUnchanged,
    // T1 创作
    t1_judgment_executes_prose_writing: t1Judgments.some((entry) => entry.action === "execute" && entry.capability === "prose_writing"),
    t1_candidate_is_prose: ["prose_fragment", "scene_draft"].includes(t1Pending.artifact_type),
    t1_candidate_targets_chapter: t1Pending.target_chapter_ref === `chapter:${chapterId}` || String(t1Pending.title ?? "").includes(config.chapter_title),
    t1_candidate_body_nonempty: t1Candidate.body.length >= 300,
    t1_candidate_visible_card: /章节正文草稿|待保存章节草稿|正文草稿/.test(axText(dir, "T1-candidate")) && /保存为章节正文|保存原稿|保存修订稿/.test(axText(dir, "T1-candidate")),
    t1_candidate_provenance_real_model: t1Provenance.bound,
    t1_adoption_applied_once: Boolean(t1Adoption.receipt),
    t1_adoption_bound_source_turn: String(t1Adoption.action.source_turn_ref ?? "").startsWith(t1Turn.turnId),
    t1_adoption_resolved_turn: t1Adoption.resolved.length > 0,
    t1_db_accepted_matches_candidate: t1DbContent === t1Candidate.body,
    t1_single_accepted_draft:
      t1Accepted.length === 1 &&
      !(seedFacts.drafts ?? []).some((row) => row.chapter_id === chapterId && row.status === "ACCEPTED"),
    t1_chapter_identity_unchanged: same(chapterIdentity(seedFacts), chapterIdentity(t1After)) && t1After.chapter_count === seedFacts.chapter_count,
    t1_no_other_chapter_rows_changed: otherChapterContentUnchanged(seedFacts, t1After),
    t1_reading_projection_matches_db: Boolean(t1ReadingFrame) && stripNewlines(projectionText(t1ReadingFrame)) === stripNewlines(t1DbContent),
    t1_reading_visible: /阅读模式/.test(t1ReadingText) && t1ReadingProbe.length >= 8 && t1ReadingText.includes(t1ReadingProbe),
    t1_accepted_content_consumed_by_next_provider_call: t1InstructionConsumedLater(t1DbContent),
    // T2 维护
    t2_judgment_binds_revision: t2Judgments.some((entry) => entry.action === "execute" && REVISION_CAPABILITIES.includes(String(entry.capability ?? ""))),
    t2_candidate_scope_format_only: t2Scope === "format_only",
    t2_candidate_targets_same_chapter: t2Pending.target_chapter_ref === `chapter:${chapterId}`,
    t2_candidate_preview_present: Boolean(t2Preview && t2BaseText),
    t2_candidate_base_is_t1_accepted: Boolean(t2BaseText) && stripNewlines(t2BaseText) === stripNewlines(t1DbContent),
    t2_candidate_preview_preserves_non_newline: Boolean(t2Preview) && stripNewlines(t2Preview) === stripNewlines(t2BaseText ?? ""),
    t2_candidate_preview_adds_line_breaks: Boolean(t2Preview && t2BaseText) && countNewlines(t2Preview) > countNewlines(t2BaseText ?? ""),
    t2_candidate_effect_complete: t2Effect.coverage === "complete" || t2Effect.mode === "format_paragraphs",
    t2_candidate_expected_base_versions_match: t2BaseVersionMatches,
    t2_candidate_visible_card: /分段方案/.test(axText(dir, "T2-candidate")) && /应用分段方案/.test(axText(dir, "T2-candidate")),
    t2_adoption_applied_once: Boolean(t2Adoption.receipt),
    t2_adoption_bound_source_turn: String(t2Adoption.action.source_turn_ref ?? "").startsWith(t2Turn.turnId),
    t2_receipt_reports_format_paragraphs: t2ReceiptProjection.adoption_effect === "format_paragraphs",
    t2_receipt_non_newline_hash_matches: t2ReceiptProjection.non_newline_hash === sha256(stripNewlines(t2BeforeContent)),
    t2_receipt_changed_boundaries: Array.isArray(t2ReceiptProjection.changed_boundaries) && t2ReceiptProjection.changed_boundaries.length > 0,
    t2_receipt_result_hash_matches: t2ReceiptProjection.result_hash === sha256(t2AfterContent),
    t2_db_content_equals_preview: t2AfterContent === t2Preview,
    t2_non_newline_bytes_preserved: t2NonNewlinePreserved,
    t2_word_count_unchanged: stripNewlines(t2AfterContent).length === stripNewlines(t2BeforeContent).length,
    t2_same_chapter_identity_and_count: same(chapterIdentity(t2Before), chapterIdentity(t2After)) && t2After.chapter_count === t2Before.chapter_count,
    t2_old_draft_superseded_retained:
      Boolean(t2BeforeDraft) &&
      t2SupersededRetained.some((row) => row.id === t2BeforeDraft.id) &&
      t2Accepted.length === 1 &&
      t2Accepted[0].content === t2AfterContent,
    t2_reading_projection_matches_db: Boolean(t2ReadingFrame) && stripNewlines(projectionText(t2ReadingFrame)) === stripNewlines(t2AfterContent),
    t2_reading_visible: /阅读模式/.test(t2ReadingText) && proseProbe(t2AfterContent).length >= 8 && t2ReadingText.includes(proseProbe(t2AfterContent)),
    // T3 恢复
    t3_restore_real_restart: Boolean(restoreEntry) && Boolean(cleanup) && (cleanup.remaining ?? []).length === 0 && restoreEntry.old_pid !== restoreEntry.new_pid,
    t3_restore_db_facts_identical: restoreSameFacts,
    t3_restore_session_active_same: Boolean(activeSessionBefore) && activeSessionBefore.id === activeSessionAfterRestore?.id,
    t3_restore_workbench_visible: restoredWorkbenchText.includes(config.work_title) && /发送/.test(restoredWorkbenchText),
    t3_restore_reading_visible: /阅读模式/.test(restoredReadingText) && proseProbe(t3BeforeContent).length >= 8 && restoredReadingText.includes(proseProbe(t3BeforeContent)),
    t3_restore_reading_projection_matches_db: Boolean(restoredReadingFrame) && stripNewlines(projectionText(restoredReadingFrame)) === stripNewlines(t3BeforeContent),
    // T3 续写
    t3_judgment_executes_prose_writing: t3Judgments.some((entry) => entry.action === "execute" && entry.capability === "prose_writing"),
    t3_candidate_targets_same_chapter: t3Pending.target_chapter_ref === `chapter:${chapterId}` || String(t3Pending.title ?? "").includes(config.chapter_title),
    t3_candidate_body_nonempty: t3Candidate.body.length > 0,
    t3_candidate_visible_card: /正文草稿|续写草稿|章节正文草稿/.test(axText(dir, "T3-candidate")),
    t3_candidate_provenance_real_model: t3Provenance.bound,
    t3_adoption_applied_once: Boolean(t3Adoption.receipt),
    t3_adoption_bound_source_turn: String(t3Adoption.action.source_turn_ref ?? "").startsWith(t3Turn.turnId),
    t3_adoption_resolved_turn: t3Adoption.resolved.length > 0,
    t3_same_chapter_append: t3SameChapter && t3WordGrowth,
    t3_prior_bytes_preserved: t3PriorPreserved !== "missing",
    t3_db_content_matches_candidate_relation: t3AfterContent === t3Candidate.body || t3AfterContent.includes(t3Candidate.body) || t3Candidate.body.includes(t3AfterContent),
    t3_reading_projection_matches_db: Boolean(t3ReadingFrame) && stripNewlines(projectionText(t3ReadingFrame)) === stripNewlines(t3AfterContent),
    t3_reading_visible: /阅读模式/.test(t3ReadingText) && proseProbe(t3AfterContent).length >= 8 && t3ReadingText.includes(proseProbe(t3AfterContent)),
    // T4 导出
    t4_native_directory_dialog_visible: /选择导出目录|请选择保存导出文件的文件夹|前往文件夹/.test(axText(dir, "T4-export-dialog")),
    t4_export_work_sent_from_ui: Boolean(exportSend) && path.resolve(String(exportSend.frame[4]?.export_dir ?? "")) === path.resolve(exportDir),
    t4_export_reply_ok: Boolean(exportReply?.response?.path),
    t4_export_success_visible: /已导出到/.test(exportSuccessText) && Boolean(exportPath),
    t4_export_file_exists: Boolean(exportFile) && exportFileSize > 0,
    t4_export_file_within_export_dir: Boolean(exportFile) && path.resolve(exportFile).startsWith(path.resolve(exportDir) + path.sep),
    t4_export_content_matches_chapter: exportContentMatch && exportFileText.includes(config.chapter_title),
    t4_export_sha256_recorded: Boolean(exportFileSha),
    t4_export_single_markdown_in_target_dir:
      exportDirMarkdownFiles.length === 1 && Boolean(exportFile) && path.basename(exportFile) === exportDirMarkdownFiles[0].name,
    t4_export_app_log_recorded: appLogExport.length >= 1,
    t4_back_to_workbench_session:
      /发送/.test(backWorkbenchText) &&
      (backWorkbenchText.includes(config.work_title) ||
        backWorkbenchText.includes(config.chapter_title) ||
        backWorkbenchText.includes(INPUTS.t1) ||
        backWorkbenchText.includes(INPUTS.t2) ||
        backWorkbenchText.includes(INPUTS.t3)),
    // 全链
    adoption_chain_byte_consistent: t1DbContent === t1Candidate.body && t2AfterContent === t2Preview && (t3AfterContent === t3Candidate.body || t3AfterContent.includes(t3Candidate.body) || t3Candidate.body.includes(t3AfterContent)),
    final_work_chapter_count_unchanged: finalFacts.chapter_count === seedFacts.chapter_count,
    final_chapter_identity_unchanged: same(chapterIdentity(seedFacts), chapterIdentity(finalFacts)),
    final_accepted_scene_chain_intact: (() => {
      const finalScenes = (finalFacts.scenes ?? []).filter((row) => row.chapter_id === chapterId);
      const finalAccepted = acceptedDraftsFor(finalFacts, chapterId);
      const finalContent = chapterContentOf(finalFacts, chapterId);
      return finalScenes.length === finalAccepted.length && finalScenes.length >= 1 && finalContent.length > 0;
    })(),
    t3_continuation_appends_new_scene_same_chapter: (() => {
      const beforeScenes = (t3BeforeRestore.scenes ?? []).filter((row) => row.chapter_id === chapterId);
      const afterScenes = (t3After.scenes ?? []).filter((row) => row.chapter_id === chapterId);
      const afterAccepted = acceptedDraftsFor(t3After, chapterId);
      return afterScenes.length === beforeScenes.length + 1 && afterAccepted.length === afterScenes.length && t3SameChapter;
    })(),
    final_reading_projection_matches_final_db: Boolean(t3ReadingFrame) && stripNewlines(projectionText(t3ReadingFrame)) === stripNewlines(chapterContentOf(t3After, chapterId)),
  };

  const failed = Object.keys(checks).filter((key) => !checks[key]);
  const measured = {
    seed: { work_id: config.seed.work_id, chapter_id: chapterId, chapter_count: seedFacts.chapter_count },
    instructions: Object.fromEntries(
      Object.entries(INPUTS).map(([id, text]) => [id, { text, count: sentUserMessages(wire, text).length, turn_id: instructionTurns[id] ? String(frameBody(instructionTurns[id])?.turn_id ?? "") : null }]),
    ),
    real_model: {
      provider_calls: realCalls,
      purposes,
      llm_calls: workLlm.length,
      llm_turns: llmTurns.length,
      llm_total_duration_ms: llmTotalDurationMs,
      provider_call_duration_ms: callDurations,
      reported_model_labels: reportedModels,
      provider_usage_models: usageModels,
      provider_usage_model_runs: usageRunCount,
      provider_runs: modelUsage.length,
      providers,
    },
    model_lifecycle: {
      before: { loaded: lifecycleBefore.strata_control?.loaded ?? null, lms_ps: lifecycleBefore.lms_ps?.output ?? null, memory: String(lifecycleBefore.memory ?? "").slice(0, 400) },
      after: { loaded: lifecycleAfter.strata_control?.loaded ?? null, post_status: lifecycleAfter.post_status, poll_ms: lifecycleAfter.poll_ms, lms_ps: lifecycleAfter.lms_ps?.output ?? null },
    },
    t1: {
      turn_id: t1Turn.turnId,
      judgment: t1Judgments,
      pending: { artifact_id: t1Pending.artifact_id, artifact_type: t1Pending.artifact_type, title: t1Pending.title ?? null, target_chapter_ref: t1Pending.target_chapter_ref ?? null },
      candidate_mode: t1Candidate.mode,
      candidate_chars: t1Candidate.body.length,
      candidate_sha256: sha256(t1Candidate.body),
      candidate_provider_refs: t1Candidate.refs,
      provenance: { bound: t1Provenance.bound, refs_matched: t1Provenance.refs_matched, purpose: t1Provenance.purpose, runs: t1Provenance.real_model_runs.length, turn_runs: t1Provenance.turn_run_count, usage_models: t1Provenance.usage_models },
      adoption: { action_id: t1Adoption.action.action_id, action_type: t1Adoption.action.action_type, source_turn_ref: t1Adoption.action.source_turn_ref, receipt_status: t1Adoption.receipt.status, persisted: t1Adoption.receipt.persistence?.persisted ?? null, reading_projection: t1Adoption.receipt.persistence?.reading_projection ?? null, resolved: t1Adoption.resolved.length > 0 },
      db_content_chars: t1DbContent.length,
      db_content_sha256: sha256(t1DbContent),
      db_equals_candidate: t1DbContent === t1Candidate.body,
      reading_frame_at: t1ReadingFrame?.at ?? null,
    },
    t2: {
      turn_id: t2Turn.turnId,
      judgment: t2Judgments,
      pending: { artifact_id: t2Pending.artifact_id, artifact_type: t2Pending.artifact_type, title: t2Pending.title ?? null, target_chapter_ref: t2Pending.target_chapter_ref ?? null, modification_scope: t2Scope },
      base_text_chars: (t2BaseText ?? "").length,
      preview_chars: (t2Preview ?? "").length,
      preview_non_newline_equal_base: Boolean(t2Preview && t2BaseText) && stripNewlines(t2Preview) === stripNewlines(t2BaseText ?? ""),
      preview_newlines: countNewlines(t2Preview ?? ""),
      base_text_newlines: countNewlines(t2BaseText ?? ""),
      adoption: { action_id: t2Adoption.action.action_id, action_type: t2Adoption.action.action_type, source_turn_ref: t2Adoption.action.source_turn_ref, receipt_status: t2Adoption.receipt.status, reading_projection: t2Adoption.receipt.persistence?.reading_projection ?? null, resolved: t2Adoption.resolved.length > 0 },
      before_chars: t2BeforeContent.length,
      after_chars: t2AfterContent.length,
      non_newline_preserved: t2NonNewlinePreserved,
      expected_base_versions: t2ExpectedBaseVersions,
      expected_base_version_matches: t2BaseVersionMatches,
      receipt_result_hash: t2ReceiptProjection.result_hash ?? null,
      receipt_result_hash_matches: t2ReceiptProjection.result_hash === sha256(t2AfterContent),
      superseded_drafts: t2SupersededRetained.map((row) => ({ id: row.id, revision: row.revision })),
      accepted_drafts: t2Accepted.map((row) => ({ id: row.id, revision: row.revision })),
      content_sha256: sha256(t2AfterContent),
    },
    t3: {
      restore: {
        logged: restoreLogs.length,
        old_pid: restoreEntry?.old_pid ?? null,
        new_pid: restoreEntry?.new_pid ?? null,
        cleanup_elapsed_ms: cleanup?.elapsed_ms ?? null,
        cleanup_remaining: cleanup?.remaining?.length ?? null,
        db_facts_identical: restoreSameFacts,
        active_session: activeSessionAfterRestore?.id ?? null,
        transcript_present:
          restoredWorkbenchText.includes(INPUTS.t1) ||
          restoredWorkbenchText.includes(INPUTS.t2) ||
          restoredWorkbenchText.includes(INPUTS.t3),
        workbench_visible: checks.t3_restore_workbench_visible,
      },
      continuation: {
        turn_id: t3Turn.turnId,
        judgment: t3Judgments,
        pending: { artifact_id: t3Pending.artifact_id, artifact_type: t3Pending.artifact_type, title: t3Pending.title ?? null, target_chapter_ref: t3Pending.target_chapter_ref ?? null },
        candidate_chars: t3Candidate.body.length,
        candidate_sha256: sha256(t3Candidate.body),
        candidate_provider_refs: t3Candidate.refs,
        provenance: { bound: t3Provenance.bound, refs_matched: t3Provenance.refs_matched, purpose: t3Provenance.purpose, runs: t3Provenance.real_model_runs.length, usage_models: t3Provenance.usage_models },
        adoption: { action_id: t3Adoption.action.action_id, action_type: t3Adoption.action.action_type, source_turn_ref: t3Adoption.action.source_turn_ref, receipt_status: t3Adoption.receipt.status, reading_projection: t3Adoption.receipt.persistence?.reading_projection ?? null, resolved: t3Adoption.resolved.length > 0 },
        before_chars: t3BeforeContent.length,
        after_chars: t3AfterContent.length,
        prior_preserved: t3PriorPreserved,
        word_growth: stripNewlines(t3AfterContent).length - stripNewlines(t3BeforeContent).length,
        content_sha256: sha256(t3AfterContent),
        scenes_before: (t3BeforeRestore.scenes ?? []).filter((row) => row.chapter_id === chapterId).length,
        scenes_after: (t3After.scenes ?? []).filter((row) => row.chapter_id === chapterId).length,
        accepted_drafts: t3Accepted.map((row) => ({ id: row.id, revision: row.revision, status: row.status })),
      },
    },
    t4: {
      export_dir: exportDir,
      dialog_visible: checks.t4_native_directory_dialog_visible,
      sent_export_dir: exportSend ? String(exportSend.frame[4]?.export_dir ?? "") : null,
      reply_path: exportReply?.response?.path ?? null,
      path: exportFile,
      size_bytes: exportFileSize,
      sha256: exportFileSha,
      directory_files: exportDirFiles,
      chapter_title_in_file: exportFileText.includes(config.chapter_title),
      content_match: exportContentMatch,
      t1_instruction_visible_after: backWorkbenchText.includes(INPUTS.t1),
    },
    author_question_events: questionEvents,
    author_question_replies_by_turn: questionRepliesByTurn,
    wait_ledger: ledger,
    production: { unchanged: productionUnchanged, changed_files: production.changed_files, head: production.head },
    final: {
      chapter_count: finalFacts.chapter_count,
      chapter_content_chars: chapterContentOf(finalFacts, chapterId).length,
      accepted_drafts: acceptedDraftsFor(finalFacts, chapterId).length,
      content_sha256: sha256(chapterContentOf(finalFacts, chapterId)),
      chapter_identity_unchanged: same(chapterIdentity(seedFacts), chapterIdentity(finalFacts)),
    },
  };

  writeOut(dir, "p1-native-checks.json", {
    slice_id: config.slice_id,
    at: new Date().toISOString(),
    driver: ui.driver,
    provider: config.provider,
    model: config.model,
    checks,
    failed,
    measured,
    evidence: {
      source: "NEXT「原生创作/维护/恢复/导出」四项能力 scoped 证据（非 canonical 10 章重跑）",
      canonical_reference: "artifacts/novel-output/p1-authoring-dogfood-2026-10-25-canonical3e/（浏览器实模 canonical 保留，不重跑）",
      browser_surface: false,
      native_driver: "ax-native-system-ui",
      checks_passed: Object.values(checks).filter(Boolean).length,
      checks_total: Object.keys(checks).length,
      llm_call_count: workLlm.length,
      provider_calls: realCalls,
      wait_ledger: ledger,
      run_ref: ready.run_ref,
      ready_at: ready.ready_at,
    },
  });

  writeOut(dir, "real-model-proof.json", {
    at: new Date().toISOString(),
    slice_id: config.slice_id,
    scope: "native scoped authoring journey: creation / maintenance / restore / export",
    surface: "tauri",
    driver: ui.driver,
    provider: config.provider,
    model: config.model,
    checks,
    failed,
    checks_passed: Object.values(checks).filter(Boolean).length,
    checks_total: Object.keys(checks).length,
    scope_passed: failed.length === 0,
    canonical_matrix_rerun: false,
    instructions: measured.instructions,
    provider_calls: providerStarts.map((record) => ({
      turn_id: record.turn_id ?? null,
      purpose: record.purpose ?? null,
      provider: record.provider ?? null,
      model: record.model ?? null,
      duration_ms: Number(record.duration_ms ?? 0),
      at: record.timestamp ?? null,
    })),
    llm_calls: {
      count: workLlm.length,
      turns: llmTurns.length,
      total_duration_ms: llmTotalDurationMs,
      models: llmModels,
      providers: llmProviders,
    },
    model_lifecycle: measured.model_lifecycle,
    adoptions: [measured.t1.adoption, measured.t2.adoption, measured.t3.continuation.adoption],
    restore: measured.t3.restore,
    export: measured.t4,
    author_question_events: questionEvents,
    limitations: [
      "I10 文学盲评仍需作者指定负责人/时机，AI 不代签；本批次只证明产品状态链与真实模型链路，不替代文学质量收益判定。",
      "scoped 而非 canonical：只覆盖 T1 创作/T2 排版维护/T3 恢复续写/T4 导出四项能力，不重跑 10 章全矩阵，不用于换分。",
      "候选正文与 provider 输出的字节级 I1 对照受真实模型流式响应未落库限制：本批以 candidate→provider_call_ref→provider_runs/provider_outputs(strata/iq3_s/usage) 的因果绑定 + 采纳链字节一致（wire→DB→阅读投影）+ 已采纳正文进入后续 provider 请求三重证据替代，属诚实降级。",
    ],
    evidence_boundary:
      "原生 macOS Tauri 窗口 + AX/CGEvent 外部驱动 + 真实 Phoenix 后端 + 真嵌入式前端；provider=Strata iq3_s（单槽串行，跑前 loaded=null，跑后 unload 并验证 loaded=null）。",
  });

  writeOut(dir, "native-evidence.json", {
    scenario: config.slice_id,
    surface: "tauri",
    driver: ui.driver,
    provider: config.provider,
    model: config.model,
    evidence_boundary: "原生 macOS Tauri 窗口 + AX/CGEvent 外部驱动真实工作台主输入/候选/采纳/重启/导出；provider=Strata iq3_s。",
    trials: [
      "T1_creation_real_model_prose_candidate_adopted",
      "T2_maintenance_format_only_revision_applied",
      "T3_restore_real_restart_and_continuation_same_chapter",
      "T4_export_native_directory_dialog_and_disk_file",
    ],
    checks,
    failed,
    measured,
    checks_passed: Object.values(checks).filter(Boolean).length,
    checks_total: Object.keys(checks).length,
    screenshots: ui.screenshots,
  });

  writeOut(dir, "summary.json", {
    slice_id: config.slice_id,
    surface: "tauri",
    driver: ui.driver,
    provider: config.provider,
    model: config.model,
    scope: "scoped_native_creation_maintenance_restore_export",
    verified_at: new Date().toISOString(),
    checks_passed: Object.values(checks).filter(Boolean).length,
    checks_total: Object.keys(checks).length,
    all_checks_passed: failed.length === 0,
    failed_checks: failed,
    trials: ["T1_creation", "T2_maintenance", "T3_restore_continuation", "T4_export"],
    real_model_calls: measured.real_model.provider_calls,
    llm_calls: workLlm.length,
    export: { path: exportFile, size_bytes: exportFileSize, sha256: exportFileSha },
    wait_ledger: ledger,
    run_ref: ready.run_ref,
    ready_at: ready.ready_at,
    screenshots: ui.screenshots,
    limitations: [
      "I10 文学盲评需作者安排，AI 不代签",
      "scoped 四项能力证据，不重跑 canonical 10 章矩阵",
    ],
  });

  assert.equal(failed.length, 0, `P1 原生断言失败: ${failed.join(", ")}`);
  console.log(
    `P1 原生实模 scoped 旅程通过: checks ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}, real_calls=${realCalls}, llm_calls=${workLlm.length}, export=${exportFile} (${exportFileSize}B sha256=${String(exportFileSha).slice(0, 16)}…)`,
  );
}

export async function main([mode, artifact, extra]) {
  const dir = path.resolve(artifact ?? "");
  if (!dir || !fs.existsSync(dir)) throw new Error(`artifact dir 不存在: ${artifact}`);
  if (mode === "prepare") return prepare(dir);
  if (mode === "capture") return capture(dir, extra);
  if (mode === "unload") return unloadModel(dir);
  if (mode === "verify") return verify(dir);
  throw new Error("unknown mode");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
