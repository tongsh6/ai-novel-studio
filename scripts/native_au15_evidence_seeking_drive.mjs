// B39 CP1 AU-15：外部原生 Tauri + 真实模型 A0/A1/A2 证据驱动（产品零感知）。
//
// 用 macOS AX/CGEvent 操作真实 Tauri 窗口（原生窗口 + 真实 Phoenix + 嵌入式真实前端），
// 通过真实 WorkspaceChat 输入自然创作请求，串行执行预注册场景：
//   A0（Base 足够、不强制探索）→ A1（未预装人物承诺，需自行取得，2 个独立 run）
//   → A2（另一未定制要素：时间累计，2 个独立 run）。
// 只读采集 native-transport / app-log / llm-calls / AX 截图 / 只读 DB 快照，
// 记录模型生命周期（strata 单槽、结束/失败必须 unload 并核验 loaded=null）。
// 每个 run 结果写 runs/<run-id>/run.json（scenario、prepare 事件、观察、trace summary、
// 零 canon 写、候选、失败/重试分母），全局写 au15-driver-log.json。
//
// 用法：node scripts/native_au15_evidence_seeking_drive.mjs <batch-run-dir>
// 可选：AU15_SCENARIO_RUN_IDS=a0-run1:a1-run1 覆盖默认 run 列表（仅调试用，不计正式分母）。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { clickAt, pressKey, readJson, scrollAt, sleep, textOf, typeText } from "./lib/native_ui/driver.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  frameBody,
  frameOf,
} from "./lib/native_ui/scenario_driver.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_au15_evidence_seeking_drive.mjs <batch-run-dir>");
  process.exit(64);
}

const harness = new NativeScenarioHarness(dir);
const ACK_TIMEOUT = 60_000;
const TURN_TIMEOUT = 360_000;
const AUTHOR_REPLY_LIMIT = 2;
const WORK_TITLE = "AU15 Evidence Work";
const STRATA_ENDPOINT = process.env.NOVEL_STRATA_ENDPOINT ?? "http://127.0.0.1:47831/v1";
const DRIVER_LOG = "au15-driver-log.json";
const questionEvents = [];
const sessionSwitches = [];

// 预注册场景输入：A1/A2 各保留一种未参与调词的措辞（retention wording，tuned=false）。
const RUN_SPECS = [
  {
    id: "a0-run1",
    scenario: "A0",
    natural_input: "写一个全新的第01章开头，题材你定，不需要承接前文。",
    retention: null,
  },
  {
    id: "a1-run1",
    scenario: "A1",
    natural_input: "接着前文写第03章，把沈砚答应顾青的事接着写，不要问我。",
    retention: null,
  },
  {
    id: "a1-run2",
    scenario: "A1",
    natural_input: "第03章从顾青在灯楼等沈砚写起，前情里两人说好的事要接上，别停下来问我。",
    retention: { tuned: false, ref: "a1-run2", note: "同义保留措辞，未参与调词" },
  },
  {
    id: "a2-run1",
    scenario: "A2",
    natural_input: "接着前文写第04章，注意时间线已经过了多久，不能写错。",
    retention: null,
  },
  {
    id: "a2-run2",
    scenario: "A2",
    natural_input: "第04章开头交代一下，两人上次分开到现在一共过了多久，别写错天数。",
    retention: { tuned: false, ref: "a2-run2", note: "同义保留措辞，未参与调词" },
  },
];

const RUN_IDS = (process.env.AU15_SCENARIO_RUN_IDS ?? "")
  .split(":")
  .map((id) => id.trim())
  .filter(Boolean);
const ACTIVE_RUNS = RUN_IDS.length > 0 ? RUN_SPECS.filter((spec) => RUN_IDS.includes(spec.id)) : RUN_SPECS;
if (ACTIVE_RUNS.length === 0) {
  console.error(`AU15_SCENARIO_RUN_IDS 未匹配任何 run: ${RUN_IDS.join(",")}`);
  process.exit(64);
}

const nowIso = () => new Date().toISOString();
const writeJson = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));
const writeRunJson = (runId, name, value) => {
  const runDir = path.join(dir, "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, name), JSON.stringify(value, null, 2));
};
const writeRunText = (runId, name, text) => {
  const runDir = path.join(dir, "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, name), text);
};

const strataBase = (endpoint) => String(endpoint ?? "").replace(/\/v1\/?$/, "");

async function strataState() {
  try {
    const response = await fetch(`${strataBase(STRATA_ENDPOINT)}/api/models`);
    if (!response.ok) return { error: `http_${response.status}` };
    const body = await response.json();
    return { mode: body.mode ?? null, current: body.current ?? null, loaded: body.loaded ?? null };
  } catch (error) {
    return { error: error.message };
  }
}

function execText(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", timeout: 15_000 }).slice(0, 4000);
  } catch (error) {
    return `error:${String(error?.message ?? error).slice(0, 400)}`;
  }
}

function lifecycleRecord(state) {
  return {
    at: nowIso(),
    provider: "strata",
    endpoint: STRATA_ENDPOINT,
    lms_ps: execText("lms", ["ps"]),
    strata_processes: execText("pgrep", ["-fl", "strata"]),
    ...state,
  };
}

async function writeModelBefore() {
  const state = await strataState();
  const record = lifecycleRecord({
    loaded_before: state.loaded ?? null,
    current_before: state.current ?? null,
    state_before: state,
  });
  writeJson("model-lifecycle-before.json", record);
  return record;
}

async function cleanupStrata(stage) {
  let unloadError = null;
  try {
    await fetch(`${strataBase(STRATA_ENDPOINT)}/api/models/unload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  } catch (error) {
    unloadError = error.message;
  }
  await sleep(1_500);
  const state = await strataState();
  const after = lifecycleRecord({
    stage,
    loaded: state.loaded ?? null,
    current: state.current ?? null,
    loaded_after: state.loaded ?? null,
    unloaded: state.loaded === null && !state.error,
    unload_error: unloadError,
    state_after: state,
  });
  writeJson("model-lifecycle-after.json", after);
  return after;
}

// ── 只读 DB 快照（canon 计数 + 已采纳正文 hash）─────────────────────────────
function dbSnapshot() {
  const python = [
    "import sqlite3, sys, json, hashlib",
    "db = sqlite3.connect(sys.argv[1], timeout=20)",
    "def n(table):",
    "    try:",
    "        return db.execute('SELECT COUNT(*) FROM %s' % table).fetchone()[0]",
    "    except Exception:",
    "        return None",
    "tables = {'chapters': 'chapters', 'volumes': 'volumes', 'scenes': 'scenes',",
    "          'drafts': 'drafts', 'memory_items': 'memory_items',",
    "          'characters': 'characters', 'receipts': 'author_action_receipts'}",
    "counts = {key: n(table) for key, table in tables.items()}",
    "rows = db.execute(\"SELECT id, content FROM drafts WHERE status='ACCEPTED' ORDER BY id\").fetchall()",
    "counts['accepted_drafts'] = len(rows)",
    "counts['accepted_hash'] = hashlib.sha256('\\n'.join('%s:%s' % (i, c) for i, c in rows).encode()).hexdigest()",
    "print(json.dumps(counts))",
    "db.close()",
  ].join("\n");
  try {
    return JSON.parse(execFileSync("python3", ["-c", python, harness.dbFile], { encoding: "utf8", timeout: 20_000 }).trim());
  } catch (error) {
    return { error: String(error?.message ?? error).slice(0, 800) };
  }
}

const CANON_COUNT_KEYS = ["chapters", "volumes", "scenes", "memory_items", "characters", "receipts", "accepted_hash"];

function canonUnchanged(before, after) {
  if (!before || !after || before.error || after.error) return false;
  return CANON_COUNT_KEYS.every((key) => JSON.stringify(before[key]) === JSON.stringify(after[key]));
}

// ── app-log 只读采集（用于新建会话/工作台就绪的外部证据）──────────────────────
function appLogRecords() {
  const root = path.join(dir, "app-log");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((file) => file.endsWith(".jsonl"))
    .sort()
    .flatMap((file) =>
      fs
        .readFileSync(path.join(root, file), "utf8")
        .split("\n")
        .filter((line) => line.includes("{"))
        .map((line) => {
          try {
            return JSON.parse(line.slice(line.indexOf("{")));
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    );
}

async function pollAppLog(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    harness.checkSupervisor();
    const hit = appLogRecords().find(predicate);
    if (hit) return hit;
    await sleep(500);
  }
  throw new Error(`app_log_wait_timeout:${label}`);
}

// ── llm-calls 只读采集（真实 provider 请求/响应字节）──────────────────────────
function parseLlmCalls() {
  const root = path.join(dir, "llm-calls");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((file) => file.endsWith(".jsonl"))
    .sort()
    .flatMap((file, fileIndex) =>
      fs
        .readFileSync(path.join(root, file), "utf8")
        .split("\n")
        .filter((line) => line.includes("{"))
        .map((line, lineIndex) => {
          const start = line.indexOf("{");
          const end = line.lastIndexOf("}");
          if (start < 0 || end <= start) return null;
          try {
            const record = JSON.parse(line.slice(start, end + 1));
            const body = record?.request?.body ?? {};
            const messages = Array.isArray(body.messages) ? body.messages : [];
            return {
              index: `${fileIndex}:${lineIndex}`,
              timestamp: line.slice(1, line.indexOf("]")),
              file,
              step: record?.step ?? null,
              turn_id: record?.turn_id ?? null,
              provider: record?.provider ?? null,
              model: record?.response?.model ?? null,
              actual_model: record?.response?.usage?.model ?? null,
              request_chars: messages.map((message) => String(message?.content ?? "")).join("\n").length,
              response_chars: JSON.stringify(record?.response?.body ?? "").length,
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    );
}

// ── 传输帧关联 ─────────────────────────────────────────────────────────────
function findTurnResult(wire, turnId) {
  return (
    wire.find(
      (entry) =>
        entry.direction === "received" &&
        frameOf(entry) &&
        entry.frame[3] === "turn_result" &&
        (String(entry.frame[4]?.turn_id ?? "") === turnId ||
          String(entry.frame[4]?.turn_id ?? "").startsWith(`${turnId}:`)),
    ) ?? null
  );
}

function runIdsForTurn(wire, turnId) {
  const ids = new Set();
  for (const entry of wire) {
    if (entry.direction !== "received" || !frameOf(entry)) continue;
    if (entry.frame[3] === "agent_run_state" && String(entry.frame[4]?.parent_turn_ref ?? "") === turnId) {
      const runId = String(entry.frame[4]?.run_id ?? "");
      if (runId) ids.add(runId);
    }
    if (entry.frame[3] === "turn_result" && String(entry.frame[4]?.turn_id ?? "") === turnId) {
      const runId = String(entry.frame[4]?.agent_run?.run_id ?? "");
      if (runId) ids.add(runId);
    }
  }
  return ids;
}

function turnAgentEvents(wire, turnId, eventTypes) {
  const runIds = runIdsForTurn(wire, turnId);
  return wire
    .filter((entry) => {
      if (entry.direction !== "received" || !frameOf(entry) || entry.frame[3] !== "agent_event") return false;
      const body = entry.frame[4] ?? {};
      if (!eventTypes.includes(String(body.event_type ?? ""))) return false;
      const runId = String(body.run_id ?? "");
      return runIds.has(runId) || String(body.parent_turn_ref ?? "") === turnId;
    })
    .map((entry) => entry.frame[4]);
}

function latestRunState(wire, turnId) {
  const states = wire.filter(
    (entry) =>
      entry.direction === "received" &&
      frameOf(entry) &&
      entry.frame[3] === "agent_run_state" &&
      String(entry.frame[4]?.parent_turn_ref ?? "") === turnId,
  );
  return states.at(-1)?.frame?.[4] ?? null;
}

function preparationEvents(wire, turnId) {
  return turnAgentEvents(wire, turnId, ["preparation_decided"]).map((event) => ({
    status: event?.payload?.status ?? null,
    tool: event?.payload?.tool ?? null,
    query: event?.payload?.query ?? null,
    reason: event?.payload?.reason ?? null,
    observation_count: event?.payload?.observation_count ?? null,
    mission_present: event?.payload?.mission_present ?? null,
    event_summary: event?.summary ?? null,
    run_id: event?.run_id ?? null,
    emitted_at: event?.emitted_at ?? null,
  }));
}

function explorationObservations(wire, turnId) {
  return turnAgentEvents(wire, turnId, ["exploration_observed"]).map((event) => ({
    tool: event?.payload?.tool ?? null,
    query: event?.payload?.query ?? null,
    summary: event?.payload?.summary ?? null,
    refs: event?.payload?.refs ?? [],
    chapter_ref: event?.payload?.chapter_ref ?? null,
    chapter_seq: event?.payload?.chapter_seq ?? null,
    outcome: event?.payload?.outcome ?? null,
    prose_range: event?.payload?.prose_range ?? null,
    prose_total_chars: event?.payload?.prose_total_chars ?? null,
    event_summary: event?.summary ?? null,
    run_id: event?.run_id ?? null,
    emitted_at: event?.emitted_at ?? null,
  }));
}

function judgmentEvents(wire, turnId) {
  return turnAgentEvents(wire, turnId, ["judgment_decided"]).map((event) => ({
    action: event?.payload?.action ?? null,
    capability: event?.payload?.capability ?? null,
    stage: event?.payload?.stage ?? null,
    reason_codes: event?.reason_codes ?? [],
    summary: event?.summary ?? null,
    run_id: event?.run_id ?? null,
  }));
}

function planEvents(wire, turnId) {
  return turnAgentEvents(wire, turnId, ["plan_drafted", "plan_revised", "plan_adjusted"]).map((event) => ({
    event_type: event?.event_type ?? null,
    stage: event?.payload?.stage ?? null,
    target_tool_ref: event?.payload?.target_tool_ref ?? null,
    plan_steps: (event?.payload?.plan_steps ?? []).map((step) => ({
      kind: step?.kind ?? null,
      status: step?.status ?? null,
      target_tool_ref: step?.target_tool_ref ?? null,
      step_ref: step?.step_ref ?? null,
    })),
    summary: event?.summary ?? null,
    run_id: event?.run_id ?? null,
  }));
}

function agentRunStates(wire, turnId) {
  return wire
    .filter(
      (entry) =>
        entry.direction === "received" &&
        frameOf(entry) &&
        entry.frame[3] === "agent_run_state" &&
        String(entry.frame[4]?.parent_turn_ref ?? "") === turnId,
    )
    .map((entry) => ({
      run_id: entry.frame[4]?.run_id ?? null,
      status: entry.frame[4]?.status ?? null,
      current_activity_summary: entry.frame[4]?.current_activity?.summary ?? null,
    }));
}

// ── 真实 UI 动作 ─────────────────────────────────────────────────────────────
async function sendAuthorInput(text, label) {
  await harness.runStep("maintenance", `input_ready:${label}`, () => harness.rawWaitInputReady(label));
  const message = await harness.runStep("input", `type_send:${label}`, () => harness.rawTypeAndSend(text, label));
  const turnId = String(frameBody(message)?.turn_id ?? "");
  if (!turnId) throw new Error(`user_message_without_turn_id:${label}`);
  if (String(frameBody(message)?.text ?? "") !== text) throw new Error(`user_message_text_mismatch:${label}`);
  const ack = await harness.runStep("ack", `ack:${label}`, () =>
    harness.pollWire((wire) => harness.ackFor(wire, message), ACK_TIMEOUT, `ack:${label}`),
  );
  return { turnId, runId: String(ack?.frame?.[4]?.response?.run_id ?? "") };
}

function findButtonByText(nodes, predicate) {
  return (
    nodes
      .filter(
        (node) =>
          node.role === "AXButton" &&
          (predicate(String(node.title ?? "")) || predicate(String(node.value ?? "")) || predicate(textOf(node))) &&
          Array.isArray(node.frame) &&
          node.frame[1] > 0,
      )
      .at(-1) ?? null
  );
}

function findSessionSummary(nodes) {
  const byTitle = nodes.find((node) => String(node.title ?? "").trim() === "会话");
  if (byTitle) return byTitle;
  return (
    nodes.find(
      (node) =>
        (node.role === "AXDisclosureTriangle" || node.role === "AXButton") &&
        textOf(node).includes("会话") &&
        !textOf(node).includes("新建会话") &&
        !textOf(node).includes("搜索会话"),
    ) ?? null
  );
}

// 会话栏是产品原生 <details> 弹层：点击外部不会自动收起（本批实测的体验缺口，
// 属产品 UI 行为，不在本任务允许修改范围）。外部驱动按用户会做的操作在完成后再点
// 一次「会话」按钮收起，避免遮挡工作台与截图残留。
async function collapseSessionRail(label) {
  try {
    const nodes = harness.dumpNodes();
    if (!findButtonByText(nodes, (value) => value === "新建会话")) return false;
    const summary = findSessionSummary(nodes);
    if (!summary) return false;
    harness.safeClick(summary, `${label}:session_rail_collapse`);
    await sleep(400);
    harness.log.push({ op: "session_rail_collapsed", label, at: nowIso() });
    return true;
  } catch (error) {
    harness.log.push({ op: "session_rail_collapse_failed", label, error: String(error?.message ?? error) });
    return false;
  }
}

// 真实「新建会话」入口：展开会话栏 → 点击新建会话 → 等外部 app-log 的
// work_session.create.done + 输入框/同步就绪。失败只记录证据，不伪造隔离。
async function ensureFreshSession(label) {
  const startedAt = nowIso();
  const before = appLogRecords().filter((record) => record.event === "work_session.create.done").length;
  try {
    const nodes = harness.dumpNodes();
    const summary = findSessionSummary(nodes);
    if (!summary) throw new Error("session_rail_summary_not_found");
    const expanded = await harness.pollAx(
      (_text, current) => Boolean(findButtonByText(current, (value) => value === "新建会话")),
      8_000,
      `${label}:session_rail_expand_probe`,
    ).catch(() => null);
    if (!expanded) {
      harness.safeClick(summary, `${label}:session_rail`);
      await harness.pollAx(
        (_text, current) => Boolean(findButtonByText(current, (value) => value === "新建会话")),
        20_000,
        `${label}:session_rail_expanded`,
      );
    }
    const createButton = findButtonByText(harness.dumpNodes(), (value) => value === "新建会话");
    if (!createButton) throw new Error("session_create_button_not_found");
    harness.safeClick(createButton, `${label}:session_create`);
    // 不能只 find 第一条 create 记录：本批此前创建的会话也是匹配项，会立刻误判为
    // “已创建”。必须等待 create 记录数超过点击前基线，再取最新一条。
    const createRecords = () => appLogRecords().filter((record) => record.event === "work_session.create.done");
    let created = null;
    const createDeadline = Date.now() + 30_000;
    while (Date.now() < createDeadline) {
      harness.checkSupervisor();
      const records = createRecords();
      if (records.length > before) {
        created = records.at(-1);
        break;
      }
      await sleep(500);
    }
    if (!created) throw new Error("session_create_not_persisted");
    await harness.rawWaitInputReady(`${label}:session_ready`, 45_000);
    await harness.pollAx((text) => /同步已连接/u.test(text), 60_000, `${label}:session_connected`);
    await collapseSessionRail(label);
    const record = {
      label,
      at: startedAt,
      ok: true,
      session_id: created?.session_id ?? null,
      work_id: created?.work_id ?? null,
    };
    sessionSwitches.push(record);
    writeJson("session_switches.json", sessionSwitches);
    harness.log.push({ op: "session_switch", ...record });
    return record;
  } catch (error) {
    await collapseSessionRail(label);
    const record = {
      label,
      at: startedAt,
      ok: false,
      reason: String(error?.message ?? error),
      isolation: "shared_session",
    };
    sessionSwitches.push(record);
    writeJson("session_switches.json", sessionSwitches);
    harness.log.push({ op: "session_switch_failed", ...record });
    return record;
  }
}

function supplementForRun(spec) {
  if (spec.scenario === "A0") {
    return "按当前作品已有材料直接写这一段，不需要查旧正文；缺什么先查作品文件，不要编造，也不要停下问我。";
  }
  return "按当前作品事实继续；缺什么先查作品文件里的正文，不要编造，也不要停下来问我。";
}

async function answerAuthorQuestion(label, body, question) {
  const options = question.options ?? [];
  const choice = options.find((option) => option.recommended) ?? options.find((option) => option.kind !== "free_text");
  if (choice) {
    const nodes = harness.dumpNodes();
    const button = findButtonByText(nodes, (value) => value === choice.label);
    if (button) {
      harness.safeClick(button, `${label}:question-choice`);
      questionEvents.push({
        label,
        at: nowIso(),
        kind: "author_question",
        question: question.question,
        response_kind: "choice",
        choice: choice.label,
      });
      writeJson("author_question_events.json", questionEvents);
      await sleep(800);
      return;
    }
  }
  const nodes = harness.dumpNodes();
  const entry = findButtonByText(nodes, (value) => value.includes("回复此问题") || value.includes("回复"));
  if (!entry) throw new Error(`author_question_reply_entry_not_found:${label}`);
  harness.safeClick(entry, `${label}:reply-entry`);
  await sleep(900);
  const textarea = harness.dumpNodes().find((node) => node.role === "AXTextArea");
  if (!textarea) throw new Error(`author_question_textarea_not_found:${label}`);
  harness.safeClick(textarea, `${label}:reply-textarea`);
  await sleep(250);
  const reply =
    "按当前作品事实继续；缺什么先查作品文件里的正文，不要编造，也不要停下来问我。";
  typeText(harness.APP, reply);
  await sleep(400);
  const send = findButtonByText(harness.dumpNodes(), (value) => value === "发送回复");
  if (!send) throw new Error(`author_question_send_button_not_found:${label}`);
  harness.safeClick(send, `${label}:send-reply`);
  questionEvents.push({
    label,
    at: nowIso(),
    kind: "author_question",
    question: question.question,
    response_kind: "free_text",
    reply,
  });
  writeJson("author_question_events.json", questionEvents);
  await sleep(800);
}

// AgentRun 暂停（真实 UI「调整当前任务 / 发送调整」面板）时的作者默认补充。
async function supplementPausedRun(spec, label, state) {
  const nodes = harness.dumpNodes();
  const field =
    nodes.find(
      (node) =>
        node.role === "AXTextField" &&
        /调整当前任务|回复或补充|补充方向/.test(String(node.title ?? node.desc ?? node.value ?? "")),
    ) ?? null;
  if (!field) throw new Error(`run_pause_panel_not_found:${label}`);
  harness.safeClick(field, `${label}:run-pause-field`);
  await sleep(250);
  const reply = supplementForRun(spec);
  typeText(harness.APP, reply);
  await sleep(400);
  const send = findButtonByText(harness.dumpNodes(), (value) => value === "发送调整" || value.includes("发送调整"));
  if (!send) throw new Error(`run_pause_send_button_not_found:${label}`);
  harness.safeClick(send, `${label}:run-pause-send`);
  questionEvents.push({
    label,
    at: nowIso(),
    kind: "run_pause",
    stage: state?.status ?? null,
    summary: state?.current_activity?.summary ?? null,
    response_kind: "free_text",
    reply,
  });
  writeJson("author_question_events.json", questionEvents);
  await sleep(800);
}

const PAUSE_STATUSES = new Set(["awaiting_author", "awaiting_input", "paused", "stopped", "blocked"]);

async function waitTurn(turnId, spec, label) {
  let questions = 0;
  let pauses = 0;
  for (;;) {
    const found = await harness.runStep("turn", `turn_outcome:${label}:${questions}:${pauses}`, () =>
      harness.pollWire(
        (wire) => {
          const record = findTurnResult(wire, turnId);
          if (record) {
            const body = record.frame[4] ?? {};
            const question = body.author_question;
            if (question?.question && question.status !== "answered" && question.status !== "closed") {
              return { kind: "author_question", question };
            }
            if (String(body.status ?? "") === "failed") return { kind: "turn_result", body };
            const agentStatus = String(body.agent_run?.status ?? "");
            if (String(body.phase ?? "") === "running" || agentStatus === "running") return null;
            if (String(body.assistant_message?.text ?? "").trim() !== "") return { kind: "turn_result", body };
            return null;
          }
          const state = latestRunState(wire, turnId);
          if (state && PAUSE_STATUSES.has(String(state.status ?? ""))) {
            return { kind: "run_pause", state };
          }
          return null;
        },
        TURN_TIMEOUT,
        `${label}:turn_outcome`,
      ),
    );
    if (found.kind === "turn_result") return { turnResult: found.body, questions, pauses };
    if (found.kind === "author_question") {
      if (questions + pauses >= AUTHOR_REPLY_LIMIT) throw new Error(`author_question_reply_limit:${label}`);
      await harness.runStep("maintenance", `author_question:${label}:${questions + 1}`, () =>
        answerAuthorQuestion(label, null, found.question),
      );
      questions += 1;
      await sleep(800);
      continue;
    }
    if (questions + pauses >= AUTHOR_REPLY_LIMIT) throw new Error(`run_pause_reply_limit:${label}`);
    await harness.runStep("maintenance", `run_pause:${label}:${pauses + 1}`, () =>
      supplementPausedRun(spec, label, found.state),
    );
    pauses += 1;
    await sleep(800);
  }
}

async function captureWhy(label) {
  return harness.runStep("maintenance", `why:${label}`, async () => {
    // 正文 run 的候选面板可能不含「为什么」入口；先短探测，避免把不可用误记成 45s 超时失败。
    const probe = await harness.tryPollAx((text) => text.includes("为什么"), 4_000).catch(() => null);
    if (!probe) {
      harness.log.push({ op: "why_unavailable", label, at: nowIso() });
      return { text: "", ok: false, unavailable: true, error: null };
    }
    try {
      await harness.rawOpenWhy(label);
    } catch (error) {
      harness.log.push({ op: "why_failed", label, error: String(error?.message ?? error) });
      return { text: "", ok: false, error: String(error?.message ?? error) };
    }
    const text = harness.axText(harness.dumpNodes());
    harness.capture(`${label}-why`);
    pressKey(harness.APP, "escape");
    await sleep(400);
    return { text, ok: true, error: null };
  });
}

function pendingCandidates(turnResult) {
  return (turnResult?.adoption_state?.pending ?? []).map((entry) => ({
    artifact_id: entry?.artifact_id ?? null,
    artifact_type: entry?.artifact_type ?? entry?.payload?.artifact_type ?? null,
    object_kind: entry?.payload?.object_kind ?? null,
  }));
}

// ── 单 run 执行 ─────────────────────────────────────────────────────────────
async function runScenario(spec) {
  const label = spec.id;
  harness.log.push({ op: "scenario_start", id: label, scenario: spec.scenario, at: nowIso() });
  const session = spec.id === ACTIVE_RUNS[0].id ? { ok: true, session_id: null, mode: "seed_active_session" } : await ensureFreshSession(label);
  const dbBefore = dbSnapshot();
  const { turnId, runId } = await sendAuthorInput(spec.natural_input, label);
  const { turnResult, questions, pauses } = await waitTurn(turnId, spec, label);
  const dbAfter = dbSnapshot();
  // B74：在候选卡片渲染后滚动到会话底部，截取“章节内容+保存按钮”同一屏页面证据。
  await scrollConversationToBottom();

  harness.capture(`${label}-after`);
  const why = await captureWhy(label);
  const wire = harness.transport();
  const traceSummary = turnResult?.trace_summary ?? {};
  const observations = explorationObservations(wire, turnId);
  const preparations = preparationEvents(wire, turnId);
  const plans = planEvents(wire, turnId);
  const judgments = judgmentEvents(wire, turnId);
  const runStates = agentRunStates(wire, turnId);
  const llmCalls = parseLlmCalls();
  const turnCalls = llmCalls.filter((call) => String(call.turn_id ?? "") === turnId);
  const pending = pendingCandidates(turnResult);
  const zeroCanonWrite = canonUnchanged(dbBefore, dbAfter);
  const run = {
    id: label,
    scenario: spec.scenario,
    natural_input: spec.natural_input,
    retention_wording: spec.retention,
    session_isolation: session.ok === true ? (session.mode ?? "fresh_session") : "shared_session",
    session_id: turnResult?.session_id ?? session.session_id ?? null,
    session_switch: session,
    turn_id: turnId,
    run_id: String(turnResult?.agent_run?.run_id ?? runId ?? ""),
    questions,
    pauses,
    turn_status: turnResult?.status ?? null,
    turn_phase: turnResult?.phase ?? null,
    assistant_text: String(turnResult?.assistant_message?.text ?? ""),
    assistant_text_chars: String(turnResult?.assistant_message?.text ?? "").length,
    candidate_count: pending.length,
    candidates: pending,
    preparation_events: preparations,
    exploration_events: observations,
    observations: observations,
    judgment_events: judgments,
    plan_events: plans,
    agent_run_states: runStates,
    trace_summary: traceSummary,
    why: why,
    why_text: why.text,
    why_ok: why.ok,
    db_counts_before: dbBefore,
    db_counts_after: dbAfter,
    zero_canon_write: zeroCanonWrite,
    artifact_bytes_unchanged:
      Boolean(dbBefore?.accepted_hash) && dbBefore?.accepted_hash === dbAfter?.accepted_hash,
    llm_calls: turnCalls,
    llm_call_count: turnCalls.length,
    provider_calls: turnCalls.length,
    actual_models: [...new Set(turnCalls.map((call) => call.actual_model).filter(Boolean))],
    preparation_event_count: preparations.length,
    captured_at: nowIso(),
  };
  writeRunJson(label, "run.json", run);
  writeRunText(label, "natural-input.txt", spec.natural_input);
  writeRunJson(label, "retention-wording.json", spec.retention ?? { tuned: false, applicable: false });
  harness.log.push({
    op: "scenario_done",
    id: label,
    scenario: spec.scenario,
    turn_id: turnId,
    questions,
    pauses,
    candidate_count: pending.length,
    zero_canon_write: zeroCanonWrite,
    llm_calls: turnCalls.length,
  });
  return run;
}

// ── 主流程 ─────────────────────────────────────────────────────────────────

async function scrollConversationToBottom() {
  const nodes = harness.dumpNodes();
  const windowNode = nodes.find(
    (node) => node.role === "AXWindow" && Array.isArray(node.frame) && node.frame[0] > 0,
  );
  if (windowNode) {
    const [x, y, width, height] = windowNode.frame;
    clickAt(harness.APP, x + width / 2, y + height * 0.6, 1);
    await sleep(300);
  }
  if (windowNode) {
    const [x, y, width, height] = windowNode.frame;
    for (let index = 0; index < 4; index += 1) {
      scrollAt(harness.APP, x + width / 2, y + height * 0.65, -900);
      await sleep(250);
    }
  }
}

async function main() {
  const config = {
    slice_id: "au15-evidence-seeking-native",
    provider: "strata",
    model: "iq3_s",
    strata_endpoint: STRATA_ENDPOINT,
    work_title: WORK_TITLE,
    setup_mode: "isolated_fixture",
    d6a_precondition: "not_satisfied",
    scenario_order: ACTIVE_RUNS.map((spec) => `${spec.scenario}:${spec.id}`),
    run_specs: ACTIVE_RUNS,
    preregistration: "artifacts/model-contracts/b39-cp1/au15-preregistration.json",
  };
  writeJson("native-au15-config.json", config);
  const before = await writeModelBefore();
  const dbBeforeAll = dbSnapshot();
  const results = [];
  let failure = null;
  let afterLifecycle = null;
  let workId = null;

  try {
    await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
    await harness.runStep("maintenance", "workbench_ready:initial", () => harness.rawWaitWorkbenchSettled("initial"));
    await ensureWorkSelected(harness, null, WORK_TITLE, "initial");
    harness.capture("01-workbench");
    const resumeRecords = appLogRecords().filter((record) => record.event === "work_session.resume.done");
    workId = resumeRecords.at(-1)?.work_id ?? null;
    writeJson("native-au15-config.json", { ...config, work_id: workId });

    for (const spec of ACTIVE_RUNS) {
      results.push(await runScenario(spec));
    }
  } catch (error) {
    failure = { at: nowIso(), reason: String(error?.message ?? error), runs_completed: results.length };
    writeJson("driver-failure.json", failure);
    harness.log.push({ op: "scenario_failure", ...failure });
  } finally {
    if (failure) {
      // 失败也要先落一条 failure.json 让外部监督 fail-fast，再继续清理/采集。
      if (!fs.existsSync(path.join(dir, "failure.json"))) {
        writeJson("failure.json", { at: nowIso(), reason: `driver_run_failed:${failure.reason}` });
      }
    }
    afterLifecycle = await cleanupStrata(failure ? "failure" : "completed");
    const dbAfterAll = dbSnapshot();
    harness.writeDriverLog(DRIVER_LOG, {
      ...config,
      work_id: workId,
      runs: results,
      run_count: results.length,
      expected_runs: ACTIVE_RUNS.map((spec) => spec.id),
      author_question_events: questionEvents,
      session_switches: sessionSwitches,
      model_lifecycle_before: before,
      model_lifecycle_after: afterLifecycle,
      db_snapshot_before: dbBeforeAll,
      db_snapshot_after: dbAfterAll,
      zero_canon_write: canonUnchanged(dbBeforeAll, dbAfterAll),
      artifact_bytes_unchanged: dbBeforeAll?.accepted_hash === dbAfterAll?.accepted_hash,
      failure,
      transport_frames: harness.transport().length,
    });
    harness.writeUiComplete("au15-evidence-seeking-native");
  }
  if (failure) {
    console.error(`[au15-native] run failed: ${failure.reason}`);
    process.exit(1);
  }
  console.log(
    `[au15-native] runs=${results.length} questions=${questionEvents.length} ` +
      `sessions=${sessionSwitches.filter((entry) => entry.ok).length}/${sessionSwitches.length} ` +
      `canon_write=${results.every((run) => run.zero_canon_write)}`,
  );
}

main().catch((error) => {
  writeJson("failure.json", { at: nowIso(), reason: String(error?.message ?? error) });
  cleanupStrata("failure").finally(() => {
    try {
      harness.writeUiComplete("au15-evidence-seeking-native");
    } catch {
      /* supervisor already failed */
    }
    console.error(error);
    process.exit(1);
  });
});
