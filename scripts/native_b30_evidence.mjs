// B30 原生验收的只读证据适配：测量动作全部由外部 macOS AX/CGEvent 驱动真实 Tauri 窗口完成。
// 本文件只消费隔离批次的既有证据（seed.log / native-transport.jsonl / app-log / llm-calls /
// 只读 SQLite 快照 / AX 文本与截图），不操作产品、不读取产品验收开关。
// 判据对齐 frontend/slice-verify/external-ui-driver.mjs 的 driveB30ChapterRenumberRoundtrip
// 与 driveB30VolumeBlueprintKindBoundary（浏览器 surface canonical 判据），阈值/语义不降级。
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const slices = Object.freeze({
  "b30-chapter-renumber-roundtrip": {
    title: "B30 章节重编号 roundtrip（原生）",
    checkpoints: [
      "seed",
      "t1-before",
      "t1-after",
      "t2-before",
      "t2-after",
      "t3-before",
      "t3-after",
      "t4-before-refresh",
      "t4-after-refresh",
      "t5-before-no_volume_named_multi_volume",
      "t5-after-no_volume_named_multi_volume",
      "t5-before-out_of_range_ninth_volume",
      "t5-after-out_of_range_ninth_volume",
      "t5-before-duplicate_chapter_numbers",
      "t5-after-duplicate_chapter_numbers",
      "t8-before",
      "t8-after",
      "t6-before",
      "t6-after-plan",
      "t6-after-next",
      "final",
    ],
    initialWork: "work_a_id",
  },
  "b30-volume-blueprint-kind-boundary": {
    title: "B30 卷蓝图/卷章类型边界（原生）",
    checkpoints: ["seed", "b-before", "b-after-plan", "b-after-next", "final"],
    initialWork: "work_b_id",
  },
});

const contentArtifactTypes = new Set(["prose_fragment", "scene_draft", "prose_formatting_plan"]);

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
    "work_a_id", "session_a_id", "volume1_id", "volume2_id", "chapter_ids",
    "work_b_id", "session_b_id",
    "work_c_id", "session_c_id", "type_mismatch_reason",
    "type_mismatch_chapter_count", "type_mismatch_volume_count",
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

// 与浏览器 driver structureFacts 同口径：卷/章/正文 hash/摘要 hash/标题号/归卷。
export function structureFacts(db, workId) {
  const volumes = all(db, "SELECT id, title, seq, status, blueprint FROM volumes WHERE work_id = ? ORDER BY seq", [workId]);
  const chapters = all(db, "SELECT id, title, seq, status, volume_id, summary FROM chapters WHERE work_id = ? ORDER BY seq", [workId]);
  const drafts = all(
    db,
    "SELECT d.id, d.scene_id, s.chapter_id, d.content, d.status AS draft_status, d.revision FROM drafts d JOIN scenes s ON s.id = d.scene_id WHERE d.work_id = ? ORDER BY d.inserted_at",
    [workId],
  );
  const summaries = all(
    db,
    "SELECT id, chapter_id, status, summary_text, source_ref, revision_base FROM chapter_summaries WHERE work_id = ? ORDER BY inserted_at",
    [workId],
  );
  const acceptedByChapter = new Map();
  for (const draft of drafts.filter((row) => row.draft_status === "ACCEPTED")) {
    acceptedByChapter.set(draft.chapter_id, String(draft.content ?? ""));
  }
  return {
    volumes: volumes.map((row) => ({
      id: row.id,
      title: row.title,
      seq: Number(row.seq),
      status: row.status,
      blueprint_sha256: row.blueprint == null ? null : sha256(JSON.stringify(row.blueprint)),
      has_blueprint: row.blueprint != null,
    })),
    chapters: chapters.map((row) => {
      const content = acceptedByChapter.get(row.id) ?? "";
      const match = String(row.title ?? "").match(/第\s*(\d+)\s*章/u);
      return {
        id: row.id,
        title: row.title,
        seq: Number(row.seq),
        status: row.status,
        volume_id: row.volume_id,
        content_chars: content.length,
        content_sha256: content ? sha256(content) : null,
        title_number: match ? Number(match[1]) : null,
      };
    }),
    drafts: drafts.map((row) => ({
      id: row.id,
      chapter_id: row.chapter_id,
      status: row.draft_status,
      revision: Number(row.revision),
      content_sha256: sha256(row.content),
    })),
    summaries: summaries.map((row) => ({
      id: row.id,
      chapter_id: row.chapter_id,
      status: row.status,
      summary_sha256: sha256(row.summary_text),
      source_ref: row.source_ref ?? null,
      revision_base: row.revision_base ?? null,
    })),
  };
}

export function workCounts(db, workId) {
  const chapterCount = all(db, "SELECT COUNT(*) AS n FROM chapters WHERE work_id = ?", [workId])[0].n;
  const volumeCount = all(db, "SELECT COUNT(*) AS n FROM volumes WHERE work_id = ?", [workId])[0].n;
  return { chapters: Number(chapterCount), volumes: Number(volumeCount) };
}

function captureFacts(dir) {
  return withDb(dir, (db) => {
    const fields = seedFields(dir);
    const workC = structureFacts(db, fields.work_c_id);
    return {
      work_a: structureFacts(db, fields.work_a_id),
      work_b: structureFacts(db, fields.work_b_id),
      work_c: { ...workCounts(db, fields.work_c_id), chapters: workC.chapters, volumes: workC.volumes },
    };
  });
}

// ── 生产源码指纹：批次期间产品代码不得被测量方或其它人改动（no_acceptance_hooks 红线）──
const productPrefixes = ["frontend/src/", "frontend/src-tauri/src/"];
const productPath = (file) =>
  productPrefixes.some((prefix) => file.startsWith(prefix)) || /^apps\/[^/]+\/lib\//.test(file);

export function productionFingerprint() {
  const listing = execFileSync("git", ["-C", ROOT, "ls-files", "--", "frontend/src", "frontend/src-tauri/src", "apps"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
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

// 测试数据准备（仅隔离副本 SQLite）：把初始作品置为最近打开，使原生窗口启动直接进入该作品。
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

export function prepare(dir, sliceId) {
  const slice = slices[sliceId];
  assert(slice, `未知 slice: ${sliceId}`);
  const ready = read(dir, "native-driver-ready.json");
  assert.equal(ready.driver, "external-system-ui");
  assert.equal(ready.browser_driver_started, false);
  const seed = seedFields(dir);
  assert(seed.work_a_id && seed.work_b_id && seed.work_c_id, "B30 seed 字段缺失");
  write(dir, "b30-native-config.json", {
    slice_id: sliceId,
    title: slice.title,
    provider: ready.provider,
    run_ref: ready.run_ref,
    ready_at: ready.ready_at,
    seed,
  });
  write(dir, "production-sources-before.json", productionFingerprint());
  const initialWorkId = seed[slice.initialWork];
  assert(initialWorkId, `初始作品字段缺失: ${slice.initialWork}`);
  markWorkNewest(dir, initialWorkId);
  capture(dir, "seed");
  console.log(`B30 原生证据准备完成: slice=${sliceId} initial_work=${initialWorkId}`);
}

export function capture(dir, checkpoint) {
  const config = read(dir, "b30-native-config.json");
  const slice = slices[config.slice_id];
  assert(slice.checkpoints.includes(checkpoint), `未知 checkpoint: ${checkpoint}`);
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

function turnFacts(wire, messageFrame) {
  const turnId = String(messageFrame.frame[4]?.turn_id ?? "");
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

// 关闭重开（T4 刷新）后前端会按恢复的会话重播既有 user_message 帧（turn_id 不变）；
// 对账必须按 turn_id 去重，否则同一作者输入会被重复计数。
function sentUserMessages(wire, text) {
  const seen = new Set();
  return wire.filter(
    (record) => {
      if (
        !(
          record.direction === "sent" &&
          isFrame(record) &&
          record.frame[3] === "user_message" &&
          String(record.frame[4]?.text ?? "") === text
        )
      ) {
        return false;
      }
      const turnId = String(record.frame[4]?.turn_id ?? "");
      if (seen.has(turnId)) return false;
      seen.add(turnId);
      return true;
    },
  );
}

function judgmentsFor(appRecords, turnId) {
  return appRecords
    .filter((record) => record.event === "judgment.decided.done" && String(record.turn_id ?? "").startsWith(turnId))
    .map((record) => ({
      action: record.action ?? null,
      capability: record.capability ?? null,
      frame_type: record.frame_type ?? null,
      reason_code: record.reason_code ?? null,
    }));
}

function pendingOf(turn) {
  return turn?.result?.adoption_state?.pending ?? [];
}

// action_result 的 artifact 归属：product 会把 accept:<id> 规范为 adopt:<id>，
// 因此不能按 action_id 对账；用 artifact_id / decision.target_ref / candidate_ref。
function receiptMatchesArtifact(body, artifactId) {
  if (!body || typeof body !== "object") return false;
  const decision = body.decision ?? {};
  return (
    body.artifact_id === artifactId ||
    body.target_ref === artifactId ||
    decision.target_ref === `artifact:${artifactId}` ||
    decision.candidate_ref === artifactId ||
    decision.target_ref === artifactId
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
  const accepted = wire.filter(
    (record) =>
      record.direction === "received" &&
      isFrame(record) &&
      record.at >= send.at &&
      record.frame[3] === "action_result" &&
      record.frame[4]?.status === "accepted",
  );
  const attributed = accepted.filter((record) => receiptMatchesArtifact(record.frame[4], artifactId));
  assert(accepted.length, `缺少 accepted action_result: ${artifactId}`);
  assert(attributed.length || accepted.length === 1, `accepted action_result 无法归属: ${artifactId}`);
  return { send, receipt: (attributed.at(-1) ?? accepted.at(-1)).frame[4] };
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

const countButtons = (axText_, label) =>
  (axText_.match(new RegExp(`AXButton\\s+${label}`, "gu")) ?? []).length;

function chapterIdentity(facts) {
  return facts.chapters.map(({ id, seq, title, volume_id, content_sha256 }) => ({ id, seq, title, volume_id, content_sha256 }));
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

function assertWaitLedger(dir, { requireRestore }) {
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
  const minimum = requireRestore ? 20 : 8;
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
  assert.equal(ui.harness_run_ref, ready.run_ref, "native-ui-complete 未绑定本批次 run_ref");
  assert.equal(ui.driver, "ax-native-system-ui", "原生驱动标识必须是 ax-native-system-ui（非 CUA/浏览器）");
  assert.equal(ui.app_bundle, "com.ai-novel-studio.app");
  assert.equal(ui.scope, config.slice_id);
  assert.equal(ready.driver, "external-system-ui");
  assert.equal(ready.browser_driver_started, false, "原生批次不得启动 Chromium 浏览器驱动");
  assert(!fs.existsSync(path.join(dir, "ui-frames.json")), "原生批次不得存在浏览器 ui-frames 证据");
  assert(!fs.existsSync(path.join(dir, "failure.json")), "批次存在 failure.json，不得判 PASS");
  assert(Array.isArray(ui.screenshots), "native-ui-complete.screenshots 缺失");
  assert(ui.screenshots.length >= 8, `截图不足: ${ui.screenshots.length}`);
  for (const name of ui.screenshots) {
    const file = path.resolve(dir, name);
    assert(file.startsWith(dir + path.sep), `截图越界: ${name}`);
    assert(fs.existsSync(file), `截图缺失: ${name}`);
    assert(fs.statSync(file).mtimeMs >= Date.parse(ready.ready_at), `截图早于窗口就绪: ${name}`);
    const magic = fs.readFileSync(file).subarray(0, 8).toString("hex");
    assert(magic.startsWith("ffd8ff") || magic === "89504e470d0a1a0a", `截图格式非法: ${name}`);
  }
  const requireRestore = config.slice_id === "b30-chapter-renumber-roundtrip";
  return { ready, ui, ledger: assertWaitLedger(dir, { requireRestore }) };
}

function assertProviderAndWire(dir, config) {
  const minimums =
    config.slice_id === "b30-chapter-renumber-roundtrip"
      ? { userMessages: 8, turnResults: 9 }
      : { userMessages: 1, turnResults: 2 };
  const appRecords = logs(path.join(dir, "app-log"));
  const llmRecords = logs(path.join(dir, "llm-calls"));
  const providerStarts = appRecords.filter((record) => record.event === "provider_gateway.complete.start");
  assert(providerStarts.length > 0, "缺少 provider_gateway.complete.start（判断/创作调用未走真实 provider 边界）");
  const providers = [...new Set(providerStarts.map((record) => record.provider))];
  assert(same(providers, ["slice_verify"]), `确定性批次 provider 必须是 slice_verify，实测: ${providers.join(",")}`);
  assert(
    llmRecords.length > 0 && llmRecords.every((record) => record.provider === "slice_verify"),
    "llm-calls 必须全部来自 slice_verify 确定性替身",
  );
  const wire = transport(dir);
  const userMessages = wire.filter((record) => record.direction === "sent" && isFrame(record) && record.frame[3] === "user_message");
  const turnResults = wire.filter((record) => record.direction === "received" && isFrame(record) && record.frame[3] === "turn_result");
  assert(userMessages.length >= minimums.userMessages, `真实工作台输入帧不足: ${userMessages.length}`);
  assert(turnResults.length >= minimums.turnResults, `真实 turn_result 帧不足: ${turnResults.length}`);
  assert(wire.some((record) => record.direction === "http"), "缺少真实 HTTP transport 帧");
  return { appRecords, llmRecords, wire };
}

function checkProductionFingerprint(dir) {
  const before = read(dir, "production-sources-before.json");
  const now = productionFingerprint();
  const changed = Object.keys({ ...before.files, ...now.files }).filter((file) => before.files[file] !== now.files[file]);
  return { unchanged: changed.length === 0, changed_files: changed.slice(0, 20), head: { before: before.head, now: now.head } };
}

// ── 场景 1：章节重编号 roundtrip（T1–T6）+ T8 档案类型边界 ──────────────────────
const T1_TEXT = "把第2卷章节编号理顺，内容不要动";
const T2_TEXT = "把第2卷第11章和第12章的编号对调";
const T5_NEGATIVES = [
  { id: "no_volume_named_multi_volume", text: "把章节编号理顺，内容不要动" },
  { id: "out_of_range_ninth_volume", text: "把第九卷章节编号理顺，内容不要动" },
  { id: "duplicate_chapter_numbers", text: "把第2卷第11章和第11章的编号对调" },
];
const T6_PLAN_TEXT = "请基于当前作品规划卷章结构，并生成章节大纲。";
const T8_REVISION_TEXT = "把第12章正文整章通读修订一遍，让行文更通顺，情节不要改。";

function renumberChecks(dir, config, wire, appRecords, production) {
  const snap = (name) => read(dir, `${name}.json`);
  const seed = snap("seed");
  const t1Before = snap("t1-before");
  const t1After = snap("t1-after");
  const t2Before = snap("t2-before");
  const t2After = snap("t2-after");
  const t3Before = snap("t3-before");
  const t3After = snap("t3-after");
  const t4Before = snap("t4-before-refresh");
  const t4After = snap("t4-after-refresh");
  const t6Before = snap("t6-before");
  const t6AfterPlan = snap("t6-after-plan");
  const t6AfterNext = snap("t6-after-next");
  const final = snap("final");

  // T1：正例 dense 重编号
  const t1Messages = sentUserMessages(wire, T1_TEXT);
  assert.equal(t1Messages.length, 2, `T1/T3 输入必须各发送一次，实测: ${t1Messages.length}`);
  const t1 = turnFacts(wire, t1Messages[0]);
  const t3 = turnFacts(wire, t1Messages[1]);
  const t1Pending = pendingOf(t1).find((entry) => entry.artifact_type === "chapter_structure_change_plan");
  assert(t1Pending, "T1 缺少 chapter_structure_change_plan 候选");
  const t1Plan = t1Pending.payload?.change_plan ?? {};
  const t1Mapping = Array.isArray(t1Plan.mapping) ? t1Plan.mapping : [];
  const t1Adoption = adoptionFor(wire, t1Pending.artifact_id);
  const t1Receipt = t1Adoption.receipt;
  const t1Judgments = judgmentsFor(appRecords, t1.turnId);
  const t1State = applyStateChecks(t1Before.work_a, t1After.work_a, t1Plan);

  const t2 = turnFacts(wire, sentUserMessages(wire, T2_TEXT)[0]);
  const t2Pending = pendingOf(t2).find((entry) => entry.artifact_type === "chapter_structure_change_plan");
  assert(t2Pending, "T2 缺少 change plan 候选");
  const t2Plan = t2Pending.payload?.change_plan ?? {};
  adoptionFor(wire, t2Pending.artifact_id);
  const t2State = applyStateChecks(t2Before.work_a, t2After.work_a, t2Plan);

  const t3Pending = pendingOf(t3).find((entry) => entry.artifact_type === "chapter_structure_change_plan");
  if (t3Pending) adoptionFor(wire, t3Pending.artifact_id);
  const t3SeqsUnchanged = t3Before.work_a.chapters.every(
    (row) => t3After.work_a.chapters.find((next) => next.id === row.id)?.seq === row.seq,
  );
  const t3NoNewChapters = t3After.work_a.chapters.length === t3Before.work_a.chapters.length;

  // T4：刷新/消费者
  const refreshedStable =
    t4Before.work_a.chapters.length === t4After.work_a.chapters.length &&
    t4Before.work_a.chapters.every((row) => {
      const next = t4After.work_a.chapters.find((item) => item.id === row.id);
      return next && next.seq === row.seq && next.content_sha256 === row.content_sha256;
    });
  const refreshedAx = axDump(dir, "T4-refreshed");
  const acceptButtonsAfterRefresh =
    countButtons(refreshedAx, "保存到作品") + countButtons(refreshedAx, "保存到大纲") +
    countButtons(refreshedAx, "应用分段方案") + countButtons(refreshedAx, "保存为章节正文");
  const tocAfterRefresh = latestToc(wire, t4After.at);
  const tocTitles = tocAfterRefresh.chapters.map((row) => row.title);
  const expectedTitles = [...t4After.work_a.chapters].sort((a, b) => a.seq - b.seq).map((row) => row.title);
  const tocOrderMatchesSeq =
    JSON.stringify(tocTitles.filter((title) => expectedTitles.includes(title))) ===
    JSON.stringify(expectedTitles.filter((title) => tocTitles.includes(title)));
  const reading12 = axText(dir, "T4-reading-12");
  const reading11 = axText(dir, "T4-reading-11");
  const readingQueriesVisible =
    /阅读模式/u.test(reading12 + reading11) && /旧钱锚点/u.test(reading12) && /门册空白锚点/u.test(reading11);

  // T5：负例矩阵
  const negativeResults = T5_NEGATIVES.map((negative) => {
    const turn = turnFacts(wire, sentUserMessages(wire, negative.text)[0]);
    const before = snap(`t5-before-${negative.id}`);
    const after = snap(`t5-after-${negative.id}`);
    const zeroWrite =
      before.work_a.chapters.length === after.work_a.chapters.length &&
      before.work_a.chapters.every((row) => {
        const next = after.work_a.chapters.find((item) => item.id === row.id);
        return next && next.seq === row.seq && next.content_sha256 === row.content_sha256 && next.title === row.title;
      });
    const pendingTypes = pendingOf(turn).map((entry) => entry.artifact_type);
    const judgments = judgmentsFor(appRecords, turn.turnId);
    const assistantText = String(turn.result?.assistant_message?.text ?? "");
    return {
      id: negative.id,
      pending_types: pendingTypes,
      judgments,
      zero_write: zeroWrite,
      no_new_chapters: after.work_a.chapters.length === before.work_a.chapters.length,
      no_outline_or_prose_candidate: !pendingTypes.some((type) => ["outline_draft", "prose_fragment", "prose_formatting_plan"].includes(type)),
      clarified_or_rejected:
        judgments.some((record) => record.action === "ask_author" || record.action === "capability_gap") ||
        /没有找到第9卷|当前作品登记|无法|需要你|澄清|拒绝|没有找到/u.test(assistantText),
      assistant_text: assistantText,
    };
  });

  // T6：卷蓝图/类型边界（真实规划卷章 + 规划下一卷 + harness）
  const t6Plan = turnFacts(wire, sentUserMessages(wire, T6_PLAN_TEXT)[0]);
  const t6PlanPending = pendingOf(t6Plan).find((entry) => entry.artifact_type === "outline_draft");
  assert(t6PlanPending, "T6 首次规划缺少 outline_draft 候选");
  const planAdoption = adoptionFor(wire, t6PlanPending.artifact_id);
  const blueprintLines = (t6PlanPending.payload?.items ?? [])
    .flatMap((item) => String(item?.body ?? "").split("\n"))
    .map((line) => line.trim())
    .filter((line) => line.startsWith("卷蓝图："));
  const t6Next = planNextVolumeTurn(wire);
  const nextPending = t6Next.pending;
  const nextAdoption = nextPending ? adoptionFor(wire, nextPending.artifact_id) : null;
  const blueprintChapters = (facts) => facts.chapters.filter((row) => /卷蓝图|蓝图/u.test(String(row.title ?? "")));
  const seedTypeMismatch = {
    reason: config.seed.type_mismatch_reason,
    chapter_count: config.seed.type_mismatch_chapter_count,
    volume_count: config.seed.type_mismatch_volume_count,
  };
  const workCFinal = final.work_c;

  const checks = {
    maintenance_capability_bound_on_positive: t1Judgments.some(
      (record) => record.action === "execute" && record.capability === "maintain_chapter_structure",
    ),
    maintenance_not_fallback_to_outline_or_prose:
      pendingOf(t1).every((entry) => entry.artifact_type === "chapter_structure_change_plan") &&
      !t1Judgments.some(
        (record) => record.action === "execute" && ["plot_outline", "prose_writing"].includes(String(record.capability ?? "")),
      ),
    change_plan_candidate_visible_with_mapping:
      /章节重编号变更计划/u.test(axText(dir, "T1-candidate")) &&
      /第\s*\d+\s*章\s*→\s*第\s*\d+\s*章/u.test(axText(dir, "T1-candidate")),
    change_plan_effects_display_number_only: same(t1Plan.effects ?? [], ["display_number_only"]),
    change_plan_mapping_non_empty: t1Mapping.length > 0,
    change_plan_object_count_matches_mapping: Number(t1Plan.object_count) === t1Mapping.length,
    adoption_applied: Boolean(t1Receipt),
    adoption_receipt_committed_mapping: (t1Receipt?.committed_mapping ?? []).length === t1Mapping.length,
    adoption_receipt_object_count: Number(t1Receipt?.object_count) === Number(t1Plan.object_count),
    adoption_receipt_warnings_is_list: Array.isArray(t1Receipt?.warnings),
    seq_matches_committed_mapping: t1State.seq_matches_committed_mapping,
    chapter_identity_content_volume_title_unchanged:
      t1State.chapter_identity_content_volume_unchanged && t1State.title_text_unchanged,
    chapter_count_unchanged: t1State.chapter_count_unchanged,
    summary_references_unchanged: t1State.summaries_references_unchanged,
    seq_unique_after_renumber: t1State.seq_unique,
    swap_two_phase_applied:
      t2State.seq_matches_committed_mapping &&
      (t2Plan.mapping ?? []).length === 2 &&
      t2State.chapter_identity_content_volume_unchanged,
    reapply_idempotent_no_move: t3SeqsUnchanged && t3NoNewChapters,
    refresh_stable_and_consumers:
      refreshedStable && acceptButtonsAfterRefresh === 0 && tocOrderMatchesSeq && readingQueriesVisible,
    negative_matrix_all_zero_write: negativeResults.length >= 3 && negativeResults.every((item) => item.zero_write),
    negative_matrix_no_new_chapters: negativeResults.every((item) => item.no_new_chapters),
    negative_matrix_no_outline_or_prose_candidate: negativeResults.every((item) => item.no_outline_or_prose_candidate),
    negative_matrix_clarified_or_rejected: negativeResults.every((item) => item.clarified_or_rejected),
    blueprint_plan_adopted: Boolean(planAdoption.receipt),
    blueprint_not_materialized_as_chapter_after_plan: blueprintChapters(t6AfterPlan.work_b).length === 0,
    blueprint_stored_on_volumes: t6AfterPlan.work_b.volumes.filter((row) => row.has_blueprint).length > 0,
    blueprint_not_materialized_after_next_volume: blueprintChapters(t6AfterNext.work_b).length === 0,
    blueprint_next_volume_action_recorded: Boolean(nextAdoption || t6Next.recorded_reason),
    harness_type_mismatch_rejected_zero_rows:
      seedTypeMismatch.reason === "type_mismatch" &&
      Number(seedTypeMismatch.chapter_count) === 0 &&
      Number(seedTypeMismatch.volume_count) === 0 &&
      Number(workCFinal.chapters.length) === 0 &&
      Number(workCFinal.volumes.length) === 0,
    no_product_code_changed: production.unchanged,
    no_acceptance_hooks_added: production.unchanged,
  };

  return {
    checks,
    measured: {
      t1: {
        turn_id: t1.turnId,
        judgments: t1Judgments,
        pending_types: pendingOf(t1).map((entry) => entry.artifact_type),
        mapping: t1Mapping,
        object_count: t1Plan.object_count ?? null,
        effects: t1Plan.effects ?? null,
        receipt_committed_mapping: t1Receipt?.committed_mapping ?? null,
        receipt_object_count: t1Receipt?.object_count ?? null,
        receipt_warnings: t1Receipt?.warnings ?? null,
        state_checks: t1State,
        before_chapter_count: t1Before.work_a.chapters.length,
        after_chapter_count: t1After.work_a.chapters.length,
      },
      t2: { turn_id: t2.turnId, mapping: t2Plan.mapping ?? [], state_checks: t2State },
      t3: { turn_id: t3.turnId, seqs_unchanged: t3SeqsUnchanged, no_new_chapters: t3NoNewChapters },
      t4: {
        refreshed_stable: refreshedStable,
        accept_buttons_after_refresh: acceptButtonsAfterRefresh,
        toc_order_matches_seq: tocOrderMatchesSeq,
        reading_queries_visible: readingQueriesVisible,
        toc_chapters: tocAfterRefresh.chapters,
      },
      t5: negativeResults,
      t6: {
        plan_turn_id: t6Plan.turnId,
        blueprint_lines: blueprintLines,
        blueprint_chapters_after_plan: blueprintChapters(t6AfterPlan.work_b),
        blueprint_chapters_after_next: blueprintChapters(t6AfterNext.work_b),
        volumes_after_plan: t6AfterPlan.work_b.volumes,
        volumes_after_next: t6AfterNext.work_b.volumes,
        next_volume: { turn: t6Next.turnId ?? null, recorded_reason: t6Next.recorded_reason ?? null, adopted: Boolean(nextAdoption) },
        harness: seedTypeMismatch,
        work_c: { chapter_count: workCFinal.chapters.length, volume_count: workCFinal.volumes.length },
      },
      production: { unchanged: production.unchanged, changed_files: production.changed_files, head: production.head },
      seed_blueprint: seed.work_b,
    },
  };
}

function applyStateChecks(before, after, plan) {
  const afterById = new Map(after.chapters.map((row) => [row.id, row]));
  const mapping = Array.isArray(plan?.mapping) ? plan.mapping : [];
  const seqMatches = mapping.every((item) => {
    const chapterId = String(item.chapter_ref ?? "").replace(/^chapter:/, "");
    const target = afterById.get(chapterId);
    return target && target.seq === item.to_seq;
  });
  const identityUnchanged =
    before.chapters.length === after.chapters.length &&
    before.chapters.every((row) => {
      const next = afterById.get(row.id);
      return (
        next &&
        next.title === row.title &&
        next.volume_id === row.volume_id &&
        next.content_sha256 === row.content_sha256
      );
    });
  const summariesUnchanged =
    before.summaries.length === after.summaries.length &&
    before.summaries.every((summary) =>
      after.summaries.some((next) => next.chapter_id === summary.chapter_id && next.summary_sha256 === summary.summary_sha256),
    );
  const seqs = after.chapters.map((row) => row.seq);
  return {
    seq_matches_committed_mapping: seqMatches,
    chapter_identity_content_volume_unchanged: identityUnchanged,
    summaries_references_unchanged: summariesUnchanged,
    seq_unique: new Set(seqs).size === seqs.length,
    title_text_unchanged:
      before.chapters.length === after.chapters.length &&
      before.chapters.every((row) => afterById.get(row.id)?.title === row.title),
    chapter_count_unchanged: before.chapters.length === after.chapters.length,
    title_number_seq_mismatch_after: after.chapters.filter(
      (row) => row.title_number !== null && row.title_number !== row.seq,
    ).length,
  };
}

function latestToc(wire, afterAt) {
  const replies = wire
    .filter((record) => record.direction === "received" && isFrame(record) && record.at >= afterAt)
    .map((record) => record.frame[4]?.response ?? record.frame[4])
    .filter((response) => Array.isArray(response?.volumes));
  const latest = replies.at(-1) ?? null;
  return {
    volumes: latest?.volumes ?? [],
    chapters: (latest?.volumes ?? []).flatMap((volume) =>
      (volume.chapters ?? []).map((chapter) => ({ title: chapter.title, seq: chapter.seq ?? null, volume_title: volume.title })),
    ),
  };
}

function planNextVolumeTurn(wire) {
  const sends = wire.filter(
    (record) => record.direction === "sent" && isFrame(record) && record.frame[3] === "plan_next_volume",
  );
  if (sends.length === 0) return { turnId: null, pending: null, recorded_reason: "next_volume_button_not_visible" };
  const send = sends.at(-1);
  const results = wire.filter(
    (record) =>
      record.direction === "received" &&
      isFrame(record) &&
      record.at >= send.at &&
      record.frame[3] === "turn_result" &&
      record.frame[4]?.tool_result?.tool_name === "plot_outline" &&
      record.frame[4]?.tool_result?.output?.artifact_type === "outline_draft",
  );
  if (results.length === 0) return { turnId: null, pending: null, recorded_reason: "no_next_volume_turn_result" };
  const result = results.at(-1).frame[4];
  return {
    turnId: result.turn_id,
    pending: (result.adoption_state?.pending ?? []).find((entry) => entry.artifact_type === "outline_draft") ?? null,
    recorded_reason: null,
  };
}

function t8Checks(dir, wire, config) {
  const revisionMessages = sentUserMessages(wire, T8_REVISION_TEXT);
  assert.equal(revisionMessages.length, 1, "T8 修订请求必须发送一次");
  const turn = turnFacts(wire, revisionMessages[0]);
  const candidate = pendingOf(turn).find((entry) => contentArtifactTypes.has(entry.artifact_type));
  const workspace = axText(dir, "T8-workspace-card");
  const archiveOutline = axText(dir, "T8-archive-outline");
  const outlinePositive = axText(dir, "T8-archive-outline-positive");
  const before = read(dir, "t8-before.json").work_a;
  const after = read(dir, "t8-after.json").work_a;
  // 修订类候选的可见标题在 payload.title（pending entry 本身 title 可能为空）。
  const candidateTitle = String(candidate?.title ?? candidate?.payload?.title ?? "").trim();
  const zeroWrite = before.chapters.length === after.chapters.length &&
    before.chapters.every((row) => {
      const next = after.chapters.find((item) => item.id === row.id);
      return next && next.seq === row.seq && next.content_sha256 === row.content_sha256;
    });
  const checks = {
    t8_content_candidate_real_ui_turn:
      Boolean(candidate) && contentArtifactTypes.has(String(candidate?.artifact_type)),
    t8_content_candidate_zero_write: zeroWrite,
    t8_workspace_card_keeps_content_candidate:
      Boolean(candidateTitle) && workspace.includes(candidateTitle),
    // 档案大纲 tab 已真实渲染已采纳结构（防止“空面板也算没有误标”）。
    t8_archive_outline_tab_rendered: /已采纳章节计划/u.test(archiveOutline),
    // 正文/修订类候选不得以「待保存大纲 / 大纲草稿 / 保存到大纲 / 提出修改」出现。
    // 注意：档案面板叠加在工作台之上，窗口级 AX 文本仍包含面板背后的对话候选卡
    // （其正确标签是“保存修订稿/编辑修订稿后保存”），因此只断言大纲专属标签缺席。
    t8_archive_outline_hides_content_candidate:
      !/待保存大纲/u.test(archiveOutline) &&
      !/大纲草稿/u.test(archiveOutline) &&
      !/保存到大纲/u.test(archiveOutline) &&
      !/提出修改/u.test(archiveOutline),
    t8_real_outline_candidate_still_uses_outline_labels:
      /待保存大纲/u.test(outlinePositive) && /大纲草稿/u.test(outlinePositive) && /保存到大纲/u.test(outlinePositive),
  };
  return {
    checks,
    measured: {
      turn_id: turn.turnId,
      candidate: candidate
        ? {
            artifact_id: candidate.artifact_id,
            artifact_type: candidate.artifact_type,
            title: candidate.title ?? null,
            target_chapter_ref: candidate.target_chapter_ref ?? null,
            modification_scope:
              candidate.payload?.modification_scope ?? candidate.payload?.scope?.modification_scope ?? null,
          }
        : null,
      workspace_excerpt: workspace.slice(0, 1200),
      archive_outline_excerpt: archiveOutline.slice(0, 1200),
      outline_positive_excerpt: outlinePositive.slice(0, 1200),
      zero_write: zeroWrite,
    },
  };
}

function verifyRenumber(dir, config) {
  const common = assertCommonEvidence(dir, config);
  const { ready, ui } = common;
  const { appRecords, llmRecords, wire } = assertProviderAndWire(dir, config);
  const production = checkProductionFingerprint(dir);
  for (const name of [
    "T1-candidate",
    "T4-refreshed",
    "T4-reading-12",
    "T4-reading-11",
    "T8-workspace-card",
    "T8-archive-outline",
    "T8-archive-outline-positive",
  ]) {
    assertRecordFresh(dir, name, ready.ready_at);
  }

  const result = renumberChecks(dir, config, wire, appRecords, production);
  const t8 = t8Checks(dir, wire, config);
  const checks = { ...result.checks, ...t8.checks };
  const failed = Object.keys(checks).filter((key) => !checks[key]);

  write(dir, "b30-native-checks.json", {
    slice_id: config.slice_id,
    at: new Date().toISOString(),
    driver: ui.driver,
    base_checks: result.checks,
    t8_checks: t8.checks,
    failed,
    measured: result.measured,
    t8_measured: t8.measured,
    evidence: {
      server_source: "既有B30浏览器矩阵 30 项 checks（frontend/slice-verify/external-ui-driver.mjs driveB30ChapterRenumberRoundtrip）",
      added_native: "T8 档案类型边界（commit e83c06c5）原生补证",
      browser_surface: false,
      native_driver: "ax-native-system-ui",
      checks_passed: Object.values(checks).filter(Boolean).length,
      checks_total: Object.keys(checks).length,
      llm_call_count: llmRecords.length,
      provider_calls: appRecords.filter((record) => record.event === "provider_gateway.complete.start").length,
      wait_ledger: common.ledger,
      run_ref: ready.run_ref,
      ready_at: ready.ready_at,
    },
  });

  write(dir, "native-evidence.json", {
    scenario: config.slice_id,
    surface: "tauri",
    driver: ui.driver,
    provider: config.provider,
    evidence_boundary:
      "原生 macOS Tauri 窗口 + AX/CGEvent 外部驱动 + 真实 Phoenix/Vite 前端；provider 为 slice_verify 确定性替身；判据沿用浏览器 canonical 矩阵（30 项）并新增 T8 档案类型边界原生补证。",
    trials: ["T1_positive_dense_renumber", "T2_swap_two_phase", "T3_reapply_idempotent", "T4_refresh_and_consumers", "T5_negative_matrix", "T6_volume_blueprint_kind_boundary", "T8_archive_type_boundary"],
    base_checks: result.checks,
    t8_checks: t8.checks,
    measured: result.measured,
    t8_measured: t8.measured,
    checks_passed: Object.values(checks).filter(Boolean).length,
    checks_total: Object.keys(checks).length,
    screenshots: ui.screenshots,
  });

  write(dir, "summary.json", {
    slice_id: config.slice_id,
    surface: "tauri",
    driver: ui.driver,
    provider: config.provider,
    verified_at: new Date().toISOString(),
    checks_passed: Object.values(checks).filter(Boolean).length,
    checks_total: Object.keys(checks).length,
    base_checks_passed: Object.values(result.checks).filter(Boolean).length,
    base_checks_total: Object.keys(result.checks).length,
    t8_checks_passed: Object.values(t8.checks).filter(Boolean).length,
    t8_checks_total: Object.keys(t8.checks).length,
    all_checks_passed: failed.length === 0,
    failed_checks: failed,
    trials: ["T1", "T2", "T3", "T4", "T5", "T6", "T8"],
    run_ref: ready.run_ref,
    ready_at: ready.ready_at,
    html_report: null,
    screenshots: ui.screenshots,
  });

  assert.equal(failed.length, 0, `B30 原生断言失败: ${failed.join(", ")}`);
  console.log(`B30 原生场景通过: ${config.slice_id} checks ${Object.values(result.checks).filter(Boolean).length}/${Object.keys(result.checks).length} + T8 ${Object.values(t8.checks).filter(Boolean).length}/${Object.keys(t8.checks).length}`);
}

// ── 场景 2：卷蓝图/卷章类型边界（B1 真实页面 + B2 harness）────────────────────
function blueprintChecks(dir, config, wire, appRecords, production) {
  const snap = (name) => read(dir, `${name}.json`);
  const before = snap("b-before");
  const afterPlan = snap("b-after-plan");
  const afterNext = snap("b-after-next");
  const final = snap("final");

  const planTurn = turnFacts(wire, sentUserMessages(wire, T6_PLAN_TEXT)[0]);
  const planPending = pendingOf(planTurn).find((entry) => entry.artifact_type === "outline_draft");
  assert(planPending, "B1 首轮规划缺少 outline_draft 候选");
  const planReceipt = adoptionFor(wire, planPending.artifact_id).receipt;
  const blueprintLines = (planPending.payload?.items ?? [])
    .flatMap((item) => String(item?.body ?? "").split("\n"))
    .map((line) => line.trim())
    .filter((line) => line.startsWith("卷蓝图："));
  const next = planNextVolumeTurn(wire);
  const nextAdoption = next.pending ? adoptionFor(wire, next.pending.artifact_id) : null;
  const blueprintChapterRows = (facts) => facts.chapters.filter((row) => /卷蓝图|蓝图/u.test(String(row.title ?? "")));
  const blueprintVolumeCount = (facts) => facts.volumes.filter((row) => row.has_blueprint).length;
  const nextVolumeRecorded = Boolean(nextAdoption) || typeof next.recorded_reason === "string";
  const harness = {
    reason: config.seed.type_mismatch_reason,
    chapter_count: config.seed.type_mismatch_chapter_count,
    volume_count: config.seed.type_mismatch_volume_count,
    db_chapter_count: final.work_c.chapters.length,
    db_volume_count: final.work_c.volumes.length,
  };

  const checks = {
    real_plan_adopted: Boolean(planReceipt),
    plan_carried_volume_blueprint_lines: blueprintLines.length > 0,
    blueprint_stored_on_volumes_after_plan: blueprintVolumeCount(afterPlan.work_b) > 0,
    no_blueprint_chapter_after_plan: blueprintChapterRows(afterPlan.work_b).length === 0,
    no_blueprint_seq_after_plan: blueprintChapterRows(afterPlan.work_b).length === 0,
    next_volume_action_visibility_recorded: nextVolumeRecorded,
    next_volume_plan_adopted_or_recorded_boundary:
      Boolean(nextAdoption) || next.recorded_reason === "next_volume_button_not_visible",
    no_blueprint_chapter_after_next_volume: blueprintChapterRows(afterNext.work_b).length === 0,
    blueprint_count_grew_or_kept: blueprintVolumeCount(afterNext.work_b) >= blueprintVolumeCount(afterPlan.work_b),
    harness_type_mismatch_rejected_zero_rows:
      harness.reason === "type_mismatch" &&
      Number(harness.chapter_count) === 0 &&
      Number(harness.volume_count) === 0 &&
      harness.db_chapter_count === 0 &&
      harness.db_volume_count === 0,
    no_product_code_changed: production.unchanged,
    no_acceptance_hooks_added: production.unchanged,
  };

  const archiveAfterNext = axText(dir, "B-archive-after-next");
  const measured = {
    plan_turn_id: planTurn.turnId,
    plan_receipt: {
      committed_mapping: planReceipt?.committed_mapping ?? null,
      object_count: planReceipt?.object_count ?? null,
      warnings: planReceipt?.warnings ?? null,
    },
    blueprint_lines: blueprintLines,
    arc: {
      before: { volumes: before.work_b.volumes.length, chapters: before.work_b.chapters.length, blueprints: blueprintVolumeCount(before.work_b) },
      after_plan: {
        volumes: afterPlan.work_b.volumes.length,
        chapters: afterPlan.work_b.chapters.length,
        blueprints: blueprintVolumeCount(afterPlan.work_b),
        blueprint_chapters: blueprintChapterRows(afterPlan.work_b),
      },
      after_next: {
        volumes: afterNext.work_b.volumes.length,
        chapters: afterNext.work_b.chapters.length,
        blueprints: blueprintVolumeCount(afterNext.work_b),
        blueprint_chapters: blueprintChapterRows(afterNext.work_b),
      },
    },
    next_volume: { turn_id: next.turnId, adopted: Boolean(nextAdoption), recorded_reason: next.recorded_reason },
    harness,
    reading_archive_visible: /卷蓝图/u.test(archiveAfterNext),
    provider_calls: appRecords.filter((record) => record.event === "provider_gateway.complete.start").length,
  };
  return { checks, measured };
}

function verifyBlueprint(dir, config) {
  const common = assertCommonEvidence(dir, config);
  const { ready, ui } = common;
  const { appRecords, llmRecords, wire } = assertProviderAndWire(dir, config);
  const production = checkProductionFingerprint(dir);
  for (const name of ["B0-workbench", "B-plan-candidate", "B-archive-after-plan", "B-archive-after-next"]) {
    assertRecordFresh(dir, name, ready.ready_at);
  }
  const { checks, measured } = blueprintChecks(dir, config, wire, appRecords, production);
  const failed = Object.keys(checks).filter((key) => !checks[key]);

  write(dir, "b30-native-checks.json", {
    slice_id: config.slice_id,
    at: new Date().toISOString(),
    driver: ui.driver,
    checks,
    failed,
    measured,
    evidence: {
      source: "既有B30浏览器矩阵 12 项 checks（frontend/slice-verify/external-ui-driver.mjs driveB30VolumeBlueprintKindBoundary）",
      browser_surface: false,
      native_driver: "ax-native-system-ui",
      checks_passed: Object.values(checks).filter(Boolean).length,
      checks_total: Object.keys(checks).length,
      llm_call_count: llmRecords.length,
      wait_ledger: common.ledger,
      run_ref: ready.run_ref,
      ready_at: ready.ready_at,
    },
  });
  write(dir, "native-evidence.json", {
    scenario: config.slice_id,
    surface: "tauri",
    driver: ui.driver,
    provider: config.provider,
    evidence_boundary:
      "原生 macOS Tauri 窗口 + AX/CGEvent 外部驱动真实工作台规划卷章/规划下一卷；非法混排走 seed harness 持久层；判据沿用浏览器 canonical 12 项。",
    trials: ["B1_real_volume_planning_boundary", "B2_harness_type_mismatch"],
    checks,
    measured,
    checks_passed: Object.values(checks).filter(Boolean).length,
    checks_total: Object.keys(checks).length,
    screenshots: ui.screenshots,
  });
  write(dir, "summary.json", {
    slice_id: config.slice_id,
    surface: "tauri",
    driver: ui.driver,
    provider: config.provider,
    verified_at: new Date().toISOString(),
    checks_passed: Object.values(checks).filter(Boolean).length,
    checks_total: Object.keys(checks).length,
    all_checks_passed: failed.length === 0,
    failed_checks: failed,
    trials: ["B1", "B2"],
    run_ref: ready.run_ref,
    ready_at: ready.ready_at,
    screenshots: ui.screenshots,
  });
  assert.equal(failed.length, 0, `B30 卷蓝图原生断言失败: ${failed.join(", ")}`);
  console.log(`B30 卷蓝图原生场景通过: ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
}

export function verify(dir) {
  const config = read(dir, "b30-native-config.json");
  if (config.slice_id === "b30-chapter-renumber-roundtrip") return verifyRenumber(dir, config);
  if (config.slice_id === "b30-volume-blueprint-kind-boundary") return verifyBlueprint(dir, config);
  throw new Error(`未知 slice: ${config.slice_id}`);
}

export async function main([mode, artifact, extra]) {
  const dir = path.resolve(artifact);
  if (mode === "prepare") return prepare(dir, extra);
  if (mode === "capture") return capture(dir, extra);
  if (mode === "verify") return verify(dir);
  throw new Error("unknown mode");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    if (process.argv[2] === "prepare") {
      const dir = path.resolve(process.argv[3]);
      if (fs.existsSync(dir) && !fs.existsSync(path.join(dir, "failure.json"))) {
        fs.writeFileSync(path.join(dir, "failure.json"), JSON.stringify({ at: new Date().toISOString(), phase: "B30-prepare", reason: error.message }));
      }
    }
    console.error(error);
    process.exitCode = 1;
  });
}
