// B61：AU11/AU07 原生外部证据采集、读取与核验的共用部分。
//
// 本模块只记录或消费隔离批次事实：native-driver-ready.json / native-ui-complete.json /
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
export function regularEvidencePath(value, kind) {
  assert(typeof value === "string" && value.trim() !== "" && path.isAbsolute(value),
    "evidence path must be explicit and absolute");
  const stat = fs.lstatSync(value);
  assert(!stat.isSymbolicLink() && (kind === "directory" ? stat.isDirectory() : stat.isFile()),
    "evidence must remain at its original regular path");
  assert.equal(fs.realpathSync(value), path.resolve(value), "evidence path changed identity");
  return value;
}

// B33 与 WR02 共用原件 IO；来源登记/预算及纯判据仍归各实际消费者。
export function readProviderObservation(directory) {
  regularEvidencePath(directory, "directory");
  const readyFile = regularEvidencePath(path.join(directory, "provider-stream-ready.json"), "file");
  const eventsFile = regularEvidencePath(path.join(directory, "provider-stream.jsonl"), "file");
  const text = fs.readFileSync(eventsFile, "utf8");
  assert(text.endsWith("\n"), "observation event file is not sealed");
  const rawDir = regularEvidencePath(path.join(directory, "provider-stream-requests"), "directory");
  return {
    directory, ready: JSON.parse(fs.readFileSync(readyFile, "utf8")),
    events: text.trim().split("\n").map(line => JSON.parse(line)),
    readBytes(name) {
      assert(/^request-[1-9][0-9]*(?:\.(?:received|delivered))?\.bin$/u.test(name),
        "unsafe original byte filename");
      return fs.readFileSync(regularEvidencePath(path.join(rawDir, name), "file"));
    },
  };
}

// B28/B33 的同一观察预注册入口；场景和回合预算由各消费者显式传入。
export function checkedScenarioPreregistration(file, dir, { provider, model, endpoint, scenarios, budget }) {
  regularEvidencePath(file, "file");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(record.provider, provider, "preregistration provider mismatch");
  assert.equal(record.runtime?.provider, provider, "preregistration runtime provider mismatch");
  assert.equal(record.runtime?.model, model, "preregistration model mismatch");
  assert.equal(path.resolve(ROOT, record.artifact_dir ?? ""), path.resolve(dir), "preregistration output mismatch");
  assert(Array.isArray(scenarios) && scenarios.length > 0 &&
    Array.isArray(record.scenarios) && record.scenarios.length === scenarios.length, "preregistration scenarios missing");
  for (const [index, scenario] of scenarios.entries()) {
    const frozen = record.scenarios[index];
    for (const [key, value] of Object.entries(scenario)) assert.deepEqual(frozen[key], value, "frozen scenario mismatch");
    assert.equal(frozen.input_sha256, createHash("sha256").update(scenario.input).digest("hex"), "frozen input hash mismatch");
  }
  assert(budget && Object.keys(budget).length > 0, "consumer budget missing");
  for (const [key, value] of Object.entries(budget)) assert.equal(record.budget?.[key], value, "frozen budget mismatch");
  assert.equal(record.budget?.max_manual_retries, 0, "manual retries are not authorized");
  const limit = record.budget?.max_upstream_requests;
  assert(Number.isSafeInteger(limit) && limit > 0, "frozen positive HTTP budget missing");
  assert(typeof record.proxy_dir === "string" && record.proxy_dir.trim() !== "", "preregistration proxy_dir missing");
  const proxyDir = regularEvidencePath(path.resolve(ROOT, record.proxy_dir), "directory");
  const readyFile = regularEvidencePath(path.join(proxyDir, "provider-stream-ready.json"), "file");
  const observed = JSON.parse(fs.readFileSync(readyFile, "utf8"));
  assert.equal(observed.mode, "observe", "registered observation proxy missing");
  assert.equal(observed.max_upstream_requests, limit, "proxy HTTP budget mismatch");
  assert.equal(observed.upstream_endpoint, record.upstream_endpoint, "proxy upstream mismatch");
  assert.equal(observed.endpoint, endpoint, "runtime endpoint differs from frozen observation");
  assert(Number.isSafeInteger(observed.pid) && observed.pid > 0, "proxy PID missing");
  return { path: file, sha256: shaFile(file), proxy_dir: proxyDir, max_upstream_requests: limit,
    ready_sha256: shaFile(readyFile) };
}

export const write = (dir, file, value) => {
  assert(!fs.existsSync(path.join(dir, file)), `证据不得覆盖: ${file}`);
  fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2));
};
// 可重算的派生证据允许重写（同一批次重复核验时不扩展事实）。
export const rewrite = (dir, file, value) =>
  fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2));
function turnObservationSignature(nodes) {
  return createHash("sha256").update(JSON.stringify(nodes)).digest("hex");
}

function persistAxObservation(harness, { file, meta, last, changes, extra = {} }) {
  if (typeof harness.writeJson !== "function") return;
  try {
    harness.writeJson(file, {
      schema: meta.schema,
      ...meta,
      updated_at:
        typeof harness.nowIso === "function" ? harness.nowIso() : new Date().toISOString(),
      last,
      changes,
      ...extra,
    });
  } catch {}
}

function buildAxObservation(harness, nodes, { signature, terminal, data }) {
  return {
    at: typeof harness.nowIso === "function" ? harness.nowIso() : new Date().toISOString(),
    signature,
    node_count: Array.isArray(nodes) ? nodes.length : 0,
    terminal,
    ...data,
    nodes: Array.isArray(nodes) ? nodes : [],
  };
}

// 单一 AX 观察落盘 owner：每次内容变化写 latest raw nodes + 事实，历史只留小摘要；
// 失败时同步 finalize，保证 supervisor 清理后仍可复算。
export function createAxObservation(harness, { file, meta = {} }) {
  const changes = [];
  let last = null;
  let lastSignature = null;
  const persist = (extra = {}) =>
    persistAxObservation(harness, { file, meta, last, changes, extra });
  return {
    record(nodes, { data = {}, change = {} } = {}, { terminal = false } = {}) {
      const signature = turnObservationSignature(nodes);
      if (signature === lastSignature) {
        if (terminal) {
          last = { ...last, terminal: true };
          // 首次 record 已 push；同签名分支只会在至少一条变化之后发生。
          changes[changes.length - 1].terminal = true;
          persist();
        }
        return last;
      }
      lastSignature = signature;
      last = buildAxObservation(harness, nodes, { signature, terminal, data });
      changes.push({ at: last.at, signature, terminal, ...change });
      if (changes.length > 240) changes.shift();
      persist();
      return last;
    },
    finalize: persist,
  };
}

// 成本原生批次与固定同输入配对共用：派生报告保留先前产物，不覆盖原件。
function derivedFile(file) {
  if (!fs.existsSync(file)) return file;
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const extension = path.extname(file);
  return `${file.slice(0, -extension.length)}.${stamp}${extension}`;
}

export function writeDerivedJson(file, value) {
  const output = derivedFile(file);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  rewrite(path.dirname(output), path.basename(output), value);
}

export function writeDerivedText(file, value) {
  const output = derivedFile(file);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, value);
}

export function markdownTable(rows, header) {
  return [
    `| ${header.join(" | ")} |`,
    `|${header.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

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

// 单次日志读取/单次实际行查询同时产生 count 与成员，不能再次读取后猜测增量。
// 缺失、重复身份保留原样给纯核验拒绝；没有有效结果时不发布部分快照。
export function readProviderReadOnlySnapshot(dir) {
  const records = logs(path.join(dir, "llm-calls"));
  const providerRuns = withDb(dir, db => all(db, "SELECT id FROM provider_runs ORDER BY id"));
  return {
    counts: { llm_records: records.length, provider_runs: providerRuns.length },
    identities: {
      completed_calls: records.map(record => ({
        provider_call_ref: record.provider_call_ref ?? null,
        provider_run_ref: record.provider_run_ref ?? null,
      })),
      provider_run_ids: providerRuns.map(row => row.id),
    },
  };
}


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

function gitList(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function productionFingerprint(root = ROOT) {
  const paths = ["frontend/src", "frontend/src-tauri/src", "apps"];
  // tracked + untracked（遵循 .gitignore）；分批列出后按 path 去重，避免新增合法
  // 未提交模块被漏掉，也不把 test/support/artifacts 纳入产品指纹。
  const listing = [
    ...gitList(root, ["ls-files", "--", ...paths]).split("\n"),
    ...gitList(root, ["ls-files", "--others", "--exclude-standard", "--", ...paths]).split("\n"),
  ];
  const files = [...new Set(listing.map((file) => file.trim()))]
    .filter((file) => file && productPath(file))
    .sort();
  const hashes = {};
  for (const file of files) {
    const absolute = path.join(root, file);
    hashes[file] = fs.existsSync(absolute) ? shaFile(absolute) : "missing";
  }
  const head = gitList(root, ["rev-parse", "HEAD"]).trim();
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

const isSentUserMessage = (record, text) =>
  record.direction === "sent" &&
  isFrame(record) &&
  frameEvent(record) === "user_message" &&
  String(frameBody(record)?.text ?? "") === text;

export function sentUserMessages(wire, text) {
  const seen = new Set();
  return wire.filter((record) => {
    if (!isSentUserMessage(record, text)) return false;
    const turnId = String(frameBody(record)?.turn_id ?? "");
    if (seen.has(turnId)) return false;
    seen.add(turnId);
    return true;
  });
}

// Phoenix 请求身份：请求帧与它的 ACK 必须属于同一 join_ref/request_ref/topic
// 生命周期。request_ref 只在同一 join 内唯一，不能跨 join/topic 复用。
// user_message 与 author_action 共用此边界，各自只保留领域成功解析。
export function requestIdentity(record, label = "user_message") {
  assert.equal(record?.direction, "sent", `${label} 必须是发送方向`);
  assert(typeof record?.at === "string" && record.at !== "", `${label} 缺 at`);
  const frame = frameOf(record);
  assert(frame, `${label} 缺真实 WS 帧`);
  const [joinRef, requestRef, topic] = frame;
  assert(typeof joinRef === "string" && joinRef !== "", `${label} 缺 join_ref`);
  assert(typeof requestRef === "string" && requestRef !== "", `${label} 缺 request_ref`);
  assert(typeof topic === "string" && topic !== "", `${label} 缺 topic`);
  return { joinRef, requestRef, topic };
}

const isRecord = (value) => value !== null && typeof value === "object";

function runRefMatches(body, runRef) {
  if (runRef === null) return true;
  if (!isRecord(body) || body.run_ref !== runRef) return false;
  return body.run_id === undefined || body.run_id === runRef;
}

function agentRunMatches(body, agentRunId) {
  if (agentRunId === null) return true;
  const run = isRecord(body) ? body.agent_run : null;
  return isRecord(run) && run.run_id === agentRunId;
}

function broadcastFrameMatches(record, { topic, at, event, direction }) {
  if (record?.direction !== direction || !isFrame(record)) return false;
  const frame = frameOf(record);
  if (frame[2] !== topic) return false;
  if (event !== null && frame[3] !== event) return false;
  return at === null || record.at >= at;
}

// broadcast 帧（agent_event/turn_result）由 Channel 广播，真实 join_ref/request_ref 为 null；
// 因此只能按 owning topic + 广播方向 + 实际 run 绑定，不能要求它们等于作者请求 ref。
export function broadcastFrames(
  wire,
  {
    topic,
    at = null,
    runRef = null,
    agentRunId = null,
    event = null,
    direction = "received",
  } = {},
) {
  assert(typeof topic === "string" && topic !== "", "广播筛选缺 owning topic");
  return wire.filter((record) => {
    if (!broadcastFrameMatches(record, { topic, at, event, direction })) return false;
    const body = frameBody(record);
    return runRefMatches(body, runRef) && agentRunMatches(body, agentRunId);
  });
}

// Phoenix 的 join_ref/request_ref 只在单条 socket 连接内唯一：重连/应用重启后，新连接的
// ref 会从同一起点重新计数（真实批次 cp4b-pending-04 restore 后，followup 与 source 都是
// join_ref=5/request_ref=9）。因此回复必须绑定到请求所在的 socket 连接段——下一条
// sent phx_join 之后属于新连接，不能再当作此前请求的 ACK；否则会把新连接的 ACK 误算给
// 旧请求（表现为“同请求 ACK 实测 2”）。
function nextJoinAfter(wire, at) {
  const joins = wire.filter(
    (record) =>
      record?.direction === "sent" &&
      isFrame(record) &&
      frameEvent(record) === "phx_join" &&
      typeof record.at === "string" &&
      record.at > at,
  );
  if (joins.length === 0) return null;
  return joins.map((record) => record.at).sort()[0];
}

function requestReplyMatches(record, identity, at, nextJoinAt) {
  if (record?.direction !== "received" || !isFrame(record)) return false;
  if (typeof record.at !== "string" || record.at < at) return false;
  if (nextJoinAt !== null && record.at >= nextJoinAt) return false;
  const frame = frameOf(record);
  return (
    frame[0] === identity.joinRef &&
    frame[1] === identity.requestRef &&
    frame[2] === identity.topic &&
    frameEvent(record) === "phx_reply"
  );
}

// 请求回复的唯一共享读取边界：按请求自己的 join/request/topic、发送时刻之后、且仍属于
// 同一 socket 连接段的接收方向 phx_reply 匹配。缺 ACK/多义 ACK 的失败关闭由领域消费者决定。
export function requestReplies(wire, identity, since) {
  const nextJoinAt = nextJoinAfter(wire, since);
  return wire.filter((record) => requestReplyMatches(record, identity, since, nextJoinAt));
}

function successfulAck(reply, turnId) {
  if (!reply) return undefined;
  const body = frameBody(reply);
  return body?.status === "ok" && body?.response?.turn_id === turnId ? reply : undefined;
}

export function turnFacts(wire, messageRecord) {
  const turnId = String(frameBody(messageRecord)?.turn_id ?? "");
  assert(turnId, "user_message 缺 turn_id");
  const identity = requestIdentity(messageRecord);
  const replies = requestReplies(wire, identity, messageRecord.at);
  assert(replies.length <= 1, `同一请求的 ACK 多义，拒绝猜取: ${identity.requestRef}`);
  const results = broadcastFrames(wire, {
    topic: identity.topic,
    at: messageRecord.at,
    event: "turn_result",
  });
  assert(results.length, `缺少 turn_result: ${turnId}`);
  return { turnId, message: messageRecord, ack: successfulAck(replies[0], turnId), results };
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

// 通用原生批次与 B26 共用同一截图门；零证据不得空集合通过。
export function assertScreenshots(dir, screenshots, readyAt, minimum = 1) {
  assert(Array.isArray(screenshots), "native-ui-complete.screenshots 缺失");
  assert(Number.isInteger(minimum) && minimum >= 1, "原生截图最小数量必须为正整数");
  assert(screenshots.length >= minimum, `原生截图不足: ${screenshots.length} < ${minimum}`);
  const root = fs.realpathSync(dir);
  const seen = new Set();
  for (const name of screenshots) {
    const file = path.resolve(dir, name);
    assert(file.startsWith(dir + path.sep), `截图越界: ${name}`);
    assert(fs.existsSync(file), `截图缺失: ${name}`);
    const real = fs.realpathSync(file);
    assert(real.startsWith(root + path.sep), `截图越界: ${name}`);
    assert(!seen.has(real), "原生截图路径重复");
    seen.add(real);
    assert(fs.statSync(file).mtimeMs >= Date.parse(readyAt), `截图早于窗口就绪: ${name}`);
    const magic = fs.readFileSync(file).subarray(0, 8).toString("hex");
    assert(
      magic.startsWith("ffd8ff") || magic === "89504e470d0a1a0a",
      `截图格式非法: ${name}`,
    );
  }
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
  assertScreenshots(dir, ui.screenshots, ready.ready_at, minScreenshots);
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
    status = Object.values(checks).every((value) => value === true) ? "pass" : "fail",
  },
  persist = rewrite,
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
    behavior: { assertions },
    assertions,
    measured,
    ...(boundary ? { evidence_boundary: boundary } : {}),
    ...extra,
    status,
    all_checks_passed: status === "pass",
  };
  persist(dir, "summary.json", summary);
  return summary;
}

export const evidenceBoundary = () =>
  "真实 macOS Tauri 窗口（嵌入真实前端 + 真实 Phoenix 后端）+ AX/CGEvent 外部驱动 + " +
  "外部 WS/HTTP 传输代理；provider 为 slice_verify 确定性替身（模型行为语义不属本批，归 B42）；" +
  "判据与既有浏览器 canonical driver 同源，驱动面从 Chromium 页面换成原生窗口。";
