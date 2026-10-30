// B61：AU11/AU07 原生验收证据核验的共用部分（只读）。
//
// 本模块只消费隔离批次的既有证据：native-driver-ready.json / native-ui-complete.json /
// native-driver-commands.jsonl / wait-events.jsonl / heartbeat.jsonl / native-transport.jsonl /
// app-log / llm-calls / 只读 SQLite / AX 文本与截图。不操作产品、不读取产品验收开关。
// 判据对齐 frontend/slice-verify/external-ui-driver.mjs 的浏览器 canonical driver，
// 只把驱动面从 Chromium 页面换成真实 Tauri 窗口（AX/CGEvent），断言语义不降级。
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const NATIVE_DRIVER = "ax-native-system-ui";
export const APP_BUNDLE = "com.ai-novel-studio.app";

export const read = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
export const write = (dir, file, value) => {
  assert(!fs.existsSync(path.join(dir, file)), `证据不得覆盖: ${file}`);
  fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2));
};
// 可重算的派生证据允许重写（同一批次重复核验时不扩展事实）。
export const rewrite = (dir, file, value) =>
  fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2));
export const jsonl = (file) =>
  fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.includes("{"))
    .map((line) => JSON.parse(line.slice(line.indexOf("{"))));
export const logs = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((file) => file.endsWith(".jsonl"))
        .sort()
        .flatMap((file) => jsonl(path.join(dir, file)))
    : [];
export const sha256 = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");
export const shaFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── seed.log / 只读 DB ───────────────────────────────────────────────────────
export const dbPath = (dir) => path.join(dir, "database", "ai_novel_studio_test.sqlite3");

export function seedFields(dir) {
  const seedPath = path.join(dir, "seed.log");
  assert(fs.existsSync(seedPath), "seed.log 缺失");
  const tokens = fs.readFileSync(seedPath, "utf8").split(/\s+/);
  const field = (name) => {
    const prefix = `${name}=`;
    const token = tokens.find((part) => part.startsWith(prefix));
    return token ? token.slice(prefix.length) : null;
  };
  return field;
}

export function withDb(dir, fn) {
  const db = new DatabaseSync(dbPath(dir), { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export const all = (db, sql, params = []) => db.prepare(sql).all(...params);

// 生产事实表（不含 trace/交互日志）：原生批次前后必须逐表计数一致，证明本轮没有
// 隐式采纳/写入；trace 持久化本身是验收要求，不算生产写入。
export const PRODUCTION_TABLES = Object.freeze([
  "works",
  "workspaces",
  "work_sessions",
  "chapters",
  "volumes",
  "scenes",
  "characters",
  "memory_items",
  "ledger_entries",
  "author_action_receipts",
]);

export function productionTableCounts(dir) {
  return withDb(dir, (db) =>
    Object.fromEntries(
      PRODUCTION_TABLES.map((table) => [
        table,
        Number(all(db, `SELECT COUNT(*) AS n FROM ${table}`)[0].n),
      ]),
    ),
  );
}

// ── 生产源码指纹：批次期间产品代码不得被验收方改动（no acceptance hooks 红线）────────
const productPrefixes = ["frontend/src/", "frontend/src-tauri/src/"];
const productPath = (file) =>
  productPrefixes.some((prefix) => file.startsWith(prefix)) || /^apps\/[^/]+\/lib\//.test(file);

export function productionFingerprint() {
  const listing = execFileSync(
    "git",
    ["-C", ROOT, "ls-files", "--", "frontend/src", "frontend/src-tauri/src", "apps"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
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

export function gitHead() {
  return execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

export function checkProductionFingerprint(dir) {
  const before = read(dir, "production-sources-before.json");
  const now = productionFingerprint();
  const changed = Object.keys({ ...before.files, ...now.files }).filter(
    (file) => before.files[file] !== now.files[file],
  );
  return {
    unchanged: changed.length === 0,
    changed_files: changed.slice(0, 20),
    head: { before: before.head, now: now.head },
  };
}

// ── 传输帧 ──────────────────────────────────────────────────────────────────
export function transport(dir) {
  const file = path.join(dir, "native-transport.jsonl");
  assert(fs.existsSync(file), "native-transport.jsonl 缺失（外部传输代理未采证）");
  return jsonl(file);
}

export const isFrame = (record) =>
  Boolean(record && Array.isArray(record.frame) && record.frame.length >= 5);
export const frameOf = (record) => (isFrame(record) ? record.frame : null);
export const frameEvent = (record) => frameOf(record)?.[3] ?? null;
export const frameBody = (record) => frameOf(record)?.[4] ?? null;

// 浏览器 canonical driver 的 WS 证据落盘为 ui-frames.json；原生批次没有 Chromium，
// 这里把外部代理采到的真实 WS 帧单独落成 native-ws-frames.json（同一产品帧，不伪造）。
export function writeNativeFrames(dir) {
  const frames = transport(dir)
    .filter((record) => record.direction !== "http" && isFrame(record))
    .map((record) => ({
      at: record.at,
      direction: record.direction,
      event: frameEvent(record),
      body: frameBody(record),
    }));
  assert(frames.length > 0, "原生传输代理未采到任何 WS 帧");
  rewrite(dir, "native-ws-frames.json", frames);
  return frames;
}

export function sentUserMessages(wire, text) {
  const seen = new Set();
  return wire.filter((record) => {
    if (
      !(
        record.direction === "sent" &&
        isFrame(record) &&
        frameEvent(record) === "user_message" &&
        String(frameBody(record)?.text ?? "") === text
      )
    ) {
      return false;
    }
    const turnId = String(frameBody(record)?.turn_id ?? "");
    if (seen.has(turnId)) return false;
    seen.add(turnId);
    return true;
  });
}

export function turnFacts(wire, messageRecord) {
  const turnId = String(frameBody(messageRecord)?.turn_id ?? "");
  assert(turnId, "user_message 缺 turn_id");
  const ack = wire.find(
    (record) =>
      record.direction === "received" &&
      isFrame(record) &&
      record.at >= messageRecord.at &&
      record.frame[1] === messageRecord.frame[1] &&
      frameEvent(record) === "phx_reply" &&
      frameBody(record)?.status === "ok" &&
      frameBody(record)?.response?.turn_id === turnId,
  );
  const results = wire.filter(
    (record) =>
      record.direction === "received" &&
      isFrame(record) &&
      record.at >= messageRecord.at &&
      frameEvent(record) === "turn_result",
  );
  assert(results.length, `缺少 turn_result: ${turnId}`);
  return { turnId, message: messageRecord, ack, results };
}

// ── 原生批次通用证据（ready / ui-complete / 等待账 / 截图 / provider）─────────────
export function assertRecordFresh(dir, name, readyAt) {
  for (const file of [`${name}.ax.txt`, `${name}.text.txt`, `${name}.jpg`]) {
    const absolute = path.join(dir, file);
    assert(fs.existsSync(absolute), `缺少证据文件: ${file}`);
    assert(
      fs.statSync(absolute).mtimeMs >= Date.parse(readyAt),
      `证据文件早于原生窗口就绪: ${file}`,
    );
  }
  const jpg = path.join(dir, `${name}.jpg`);
  const magic = fs.readFileSync(jpg).subarray(0, 8).toString("hex");
  assert(magic.startsWith("ffd8ff") || magic === "89504e470d0a1a0a", `截图格式非法: ${name}.jpg`);
}

export function axText(dir, name) {
  const file = path.join(dir, `${name}.text.txt`);
  assert(fs.existsSync(file), `缺少可见文本证据: ${name}.text.txt`);
  return fs.readFileSync(file, "utf8");
}

export function axDump(dir, name) {
  const file = path.join(dir, `${name}.ax.txt`);
  assert(fs.existsSync(file), `缺少 AX 树证据: ${name}.ax.txt`);
  return fs.readFileSync(file, "utf8");
}

export function assertWaitLedger(
  dir,
  { minimum = 8, requiredKinds = ["input", "ack", "turn", "maintenance"] } = {},
) {
  const commandsFile = path.join(dir, "native-driver-commands.jsonl");
  assert(fs.existsSync(commandsFile), "缺少原生等待账");
  const commands = fs
    .readFileSync(commandsFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
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
  const events = fs
    .readFileSync(eventsFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
  const started = events.filter((event) => event.event === "wait_start");
  const ended = events.filter((event) => event.event === "wait_end");
  assert(started.length >= minimum, `等待账条目过少: ${started.length}`);
  assert.equal(started.length, ended.length, "等待账 start/end 不平衡");
  const kinds = new Set(ended.map((event) => event.kind));
  for (const required of requiredKinds) {
    assert(kinds.has(required), `缺少 ${required} 分型等待账`);
  }
  const byKind = Object.fromEntries([...kinds].map((kind) => [kind, ended.filter((e) => e.kind === kind).length]));
  const stats = read(dir, "wait-stats.json");
  assert.equal(stats.active, null, "等待账结束时不得有活动等待");
  assert(stats.completed >= minimum, "等待账完成数不足");
  assert(fs.existsSync(path.join(dir, "heartbeat.jsonl")), "缺少监督心跳 heartbeat.jsonl");
  const heartbeat = fs
    .readFileSync(path.join(dir, "heartbeat.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean);
  // 监督每 10s 写一次心跳；短链路（确定性 provider 全流程 <10s）只会有启动时的那一条。
  // 心跳数量与链路长度成正比，因此按实际执行时长决定下限，不把「链路短」误判成异常。
  const runElapsedMs =
    ended.length > 0 && started.length > 0 ? ended.at(-1).ended_at - started[0].at : 0;
  assert(
    heartbeat.length >= (runElapsedMs >= 15_000 ? 2 : 1),
    `监督心跳记录不足: ${heartbeat.length}（链路 ${runElapsedMs}ms）`,
  );
  return {
    commands: commands.length,
    waits: ended.length,
    kinds: [...kinds],
    by_kind: byKind,
    heartbeat_count: heartbeat.length,
    run_elapsed_ms: runElapsedMs,
  };
}

export function assertCommonEvidence(
  dir,
  {
    sliceId,
    minScreenshots = 3,
    minimumWaits = 8,
    requiredKinds,
    allowVerificationFailureMarker = false,
  } = {},
) {
  assert(fs.existsSync(path.join(dir, "native-driver-ready.json")), "缺少 native-driver-ready.json");
  assert(fs.existsSync(path.join(dir, "native-ui-complete.json")), "缺少 native-ui-complete.json");
  const ready = read(dir, "native-driver-ready.json");
  const ui = read(dir, "native-ui-complete.json");
  assert.equal(ready.driver, "external-system-ui", "原生批次 ready 驱动标识必须是 external-system-ui");
  assert.equal(ready.browser_driver_started, false, "原生批次不得启动 Chromium 浏览器驱动");
  assert.equal(ui.harness_run_ref, ready.run_ref, "native-ui-complete 未绑定本批次 run_ref");
  assert.equal(ui.driver, NATIVE_DRIVER, "原生驱动标识必须是 ax-native-system-ui（非 CUA/浏览器）");
  assert.equal(ui.app_bundle, APP_BUNDLE);
  assert.equal(ui.scope, sliceId, "native-ui-complete.scope 与场景不一致");
  assert(!fs.existsSync(path.join(dir, "ui-frames.json")), "原生批次不得存在浏览器 ui-frames 证据");
  const failurePath = path.join(dir, "failure.json");
  if (fs.existsSync(failurePath)) {
    const failure = JSON.parse(fs.readFileSync(failurePath, "utf8"));
    const runnerMarker = failure?.reason === "native_evidence_verification_failed";
    assert(
      allowVerificationFailureMarker && runnerMarker,
      "批次存在 failure.json，不得判 PASS",
    );
  }
  assert(Array.isArray(ui.screenshots), "native-ui-complete.screenshots 缺失");
  assert(
    ui.screenshots.length >= minScreenshots,
    `原生截图不足: ${ui.screenshots.length} < ${minScreenshots}`,
  );
  for (const name of ui.screenshots) {
    const file = path.resolve(dir, name);
    assert(file.startsWith(dir + path.sep), `截图越界: ${name}`);
    assert(fs.existsSync(file), `截图缺失: ${name}`);
    assert(fs.statSync(file).mtimeMs >= Date.parse(ready.ready_at), `截图早于窗口就绪: ${name}`);
    const magic = fs.readFileSync(file).subarray(0, 8).toString("hex");
    assert(
      magic.startsWith("ffd8ff") || magic === "89504e470d0a1a0a",
      `截图格式非法: ${name}`,
    );
  }
  const ledger = assertWaitLedger(dir, {
    minimum: minimumWaits,
    requiredKinds:
      requiredKinds ?? ["input", "ack", "turn", "maintenance"],
  });
  return { ready, ui, ledger };
}

export function assertProviderAndWire(
  dir,
  {
    minUserMessages = 1,
    minTurnResults = 1,
    minProviderStarts = 1,
    expectProviders = ["slice_verify"],
  } = {},
) {
  const appRecords = logs(path.join(dir, "app-log"));
  const llmRecords = logs(path.join(dir, "llm-calls"));
  const providerStarts = appRecords.filter(
    (record) => record.event === "provider_gateway.complete.start",
  );
  assert(
    providerStarts.length >= minProviderStarts,
    `provider_gateway.complete.start 不足: ${providerStarts.length}`,
  );
  const providers = [...new Set(providerStarts.map((record) => record.provider))].sort();
  const expected = [...expectProviders].sort();
  assert(
    same(providers, expected),
    `批次 provider 必须是 ${expected.join(",")}，实测: ${providers.join(",")}`,
  );
  assert(llmRecords.length > 0, "缺少 llm-calls 调用记录");
  assert(
    llmRecords.every((record) => expected.includes(record.provider)),
    `llm-calls 必须全部来自 ${expected.join(",")}；实测: ${[...new Set(llmRecords.map((r) => r.provider))].join(",")}`,
  );
  const wire = transport(dir);
  const userMessages = wire.filter(
    (record) => record.direction === "sent" && isFrame(record) && frameEvent(record) === "user_message",
  );
  const turnResults = wire.filter(
    (record) =>
      record.direction === "received" && isFrame(record) && frameEvent(record) === "turn_result",
  );
  assert(userMessages.length >= minUserMessages, `真实工作台输入帧不足: ${userMessages.length}`);
  assert(turnResults.length >= minTurnResults, `真实 turn_result 帧不足: ${turnResults.length}`);
  assert(wire.some((record) => record.direction === "http"), "缺少真实 HTTP transport 帧");
  return { appRecords, llmRecords, providerStarts, wire, userMessages, turnResults };
}

// ── 断言集合与 summary ──────────────────────────────────────────────────────
export function assertAllChecks(checks, label) {
  const failed = Object.keys(checks).filter((key) => !checks[key]);
  assert.equal(failed.length, 0, `${label} 原生断言失败: ${failed.join(", ")}`);
  return failed;
}

export function behaviorAssertions(checks) {
  return Object.keys(checks).filter((key) => checks[key]);
}

// 原生 summary 同时携带 behavior.assertions（E2E 聚合器读这里）与顶层 assertions
// （B26 原生 summary 的既有读法），两者是同一次核验的事实视图。
export function writeNativeSummary(
  dir,
  {
    sliceId,
    checks,
    measured,
    extra = {},
    provider = "slice_verify",
    driver = NATIVE_DRIVER,
    scope = "native_system_ui",
    boundary = null,
  },
) {
  const assertions = behaviorAssertions(checks);
  const summary = {
    slice_id: sliceId,
    surface: "tauri",
    driver,
    provider,
    scope,
    verified_at: new Date().toISOString(),
    git_head: gitHead(),
    checks,
    checks_passed: assertions.length,
    checks_total: Object.keys(checks).length,
    all_checks_passed: assertions.length === Object.keys(checks).length,
    behavior: { assertions },
    assertions,
    measured,
    ...(boundary ? { evidence_boundary: boundary } : {}),
    ...extra,
  };
  rewrite(dir, "summary.json", summary);
  return summary;
}

export const evidenceBoundary = () =>
  "真实 macOS Tauri 窗口（嵌入真实前端 + 真实 Phoenix 后端）+ AX/CGEvent 外部驱动 + " +
  "外部 WS/HTTP 传输代理；provider 为 slice_verify 确定性替身（模型行为语义不属本批，归 B42）；" +
  "判据与既有浏览器 canonical driver 同源，驱动面从 Chromium 页面换成原生窗口。";
