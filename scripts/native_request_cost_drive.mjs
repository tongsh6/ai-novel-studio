// B87 R01 原生任意多轮驱动：只按作者可见输入/可见终局/可见“开始新讨论”推进，
// 不用 WS/DB/内部 ID 选目标或决定下一步；turn_id/run_id 仅在每轮可见终局后做事后证据 join。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  axTurnOutcome,
  countAxAuthorMessages,
} from "./lib/native_ui/authoring_g2_evidence.mjs";
import {
  NativeScenarioHarness,
  ensureWorkSelected,
  frameBody,
} from "./lib/native_ui/scenario_driver.mjs";
import {
  captureBatch,
  loadSourceAuthors,
  readManifest,
} from "./lib/native_ui/request_cost_capture.mjs";
import { runCompactionHistorySequence } from "./lib/native_ui/request_cost_history_drive.mjs";

export const DRIVER_SCHEMA = "b87-request-cost-driver/v1";
const TERMINAL_OUTCOMES = new Set(["completed", "failed", "waiting", "capability_gap"]);

// 可见性只认 AX 作者节点归属：发送前 baseline_author_count 与当前 author_count
// 的差值才是“本轮出现新作者消息”，再由本轮可见终态决定是否可结束等待。
// 不再统计整页文本出现次数/尾部变化——模型引用作者原话或历史过程折叠都会让
// 平面计数失真，不能继续作为终态门。
export function freshnessFacts({
  baselineAuthorCount = 0,
  authorCount = 0,
  outcomeKind = null,
} = {}) {
  const newAuthorEcho = authorCount > baselineAuthorCount;
  return {
    baseline_author_count: baselineAuthorCount,
    author_count: authorCount,
    new_author_echo: newAuthorEcho,
    terminal_kind: outcomeKind,
    terminal_after_new_echo:
      outcomeKind === null ? null : newAuthorEcho && TERMINAL_OUTCOMES.has(outcomeKind),
  };
}

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

function createTurnObservation(harness, { turn, message, baselineAuthorCount }) {
  const writer = createAxObservation(harness, {
    file: `request-cost-turn-observation-${turn}.json`,
    meta: {
      schema: "b87-r01-turn-observation/v1",
      turn,
      author_message: message,
      baseline_author_count: baselineAuthorCount,
    },
  });
  const outcomeOf = (nodes) => axTurnOutcome(nodes, { message, baselineAuthorCount });
  return {
    observe(nodes, options) {
      const outcome = outcomeOf(nodes);
      writer.record(nodes, { data: { outcome }, change: { kind: outcome.kind } }, options);
      return outcome;
    },
    outcome: outcomeOf,
    finalize: writer.finalize,
  };
}

export async function waitFreshTurn(
  harness,
  { message, baselineAuthorCount, timeoutMs, turn },
) {
  const observation = createTurnObservation(harness, {
    turn,
    message,
    baselineAuthorCount,
  });
  let observed;
  try {
    observed = await harness.pollAx(
      (_text, nodes) => TERMINAL_OUTCOMES.has(observation.observe(nodes).kind),
      timeoutMs,
      "r01:fresh_turn",
    );
  } catch (error) {
    // 失败现场必须早于 supervisor 清理落盘；这里同步写最后一次已观察到的 nodes。
    observation.finalize({ wait_error: error.message, at: new Date().toISOString() });
    throw error;
  }
  const outcome = observation.observe(observed.nodes, { terminal: true });
  const result = {
    ...observed,
    freshness: freshnessFacts({
      baselineAuthorCount,
      authorCount: outcome.author_count,
      outcomeKind: outcome.kind,
    }),
    outcome,
  };
  observation.finalize({ terminal: true });
  return result;
}

export function buildTurnPlan(authors, length) {
  assert(Array.isArray(authors) && authors.length > 0, "authors 不能为空");
  assert(Number.isInteger(length) && length > 0, "length 必须是正整数");
  return Array.from({ length }, (_, index) => {
    const author = authors[index % authors.length];
    return { turn: index + 1, author_id: author.id, author };
  });
}

// wire 字段只接受产品真实字符串；缺失统一成 null，避免 undefined 在 JSON 中丢字段。
const absentToNull = (value) => (value === undefined ? null : value);
const textOrEmpty = (value) => (typeof value === "string" ? value : "");

function sentTurnId(sent) {
  // sent 由 sentUserMessageSince 选出，必然带 frame/body。
  return absentToNull(frameBody(sent).turn_id);
}

function ackRunId(ack) {
  // ackFor 只返回带匹配 response.turn_id 的 phx_reply；没有回执才为 null。
  return ack === null ? null : absentToNull(frameBody(ack).response.run_id);
}

export function joinWireAfterTerminal(harness, sentAt, author) {
  const wire = harness.transport();
  const sent = harness.sentUserMessageSince(wire, sentAt, author.text);
  if (!sent) {
    return {
      turn_id: null,
      run_id: null,
      ack_ok: false,
      sent_bound: false,
      run_bound: false,
      joined: false,
    };
  }
  const ack = harness.ackFor(wire, sent);
  const turnId = sentTurnId(sent);
  const runId = ackRunId(ack);
  return {
    turn_id: turnId,
    run_id: runId,
    ack_ok: Boolean(ack),
    sent_bound: Boolean(turnId),
    run_bound: Boolean(runId),
    // 只有 turn 与 run 同时可知才算完整关联；不能用其中一个掩盖另一个缺失。
    joined: Boolean(turnId && runId),
  };
}

function createInputObservation(harness, turn) {
  const writer = createAxObservation(harness, {
    file: `request-cost-input-observation-${turn}.json`,
    meta: { schema: "b87-r01-input-observation/v1", turn },
  });
  return {
    record(nodes, facts, options) {
      return writer.record(
        nodes,
        {
          data: { facts },
          change: {
            ordinary: facts.ordinary,
            new_discussion: Boolean(facts.new_discussion),
            window: facts.window,
          },
        },
        options,
      );
    },
    finalize: writer.finalize,
  };
}

export function inputModeFacts(harness, nodes) {
  const composer = harness.findComposer(nodes);
  const send = harness.findSendButton(nodes);
  const newDiscussion = harness.findButton(nodes, "开始新讨论");
  const fact = (node) =>
    node
      ? { path: node.path, role: node.role, title: textOrEmpty(node.title), desc: textOrEmpty(node.desc) }
      : null;
  return {
    window: nodes.some((node) => node.role === "AXWindow"),
    ordinary: Boolean(composer && send),
    composer: fact(composer),
    send: fact(send),
    new_discussion: fact(newDiscussion),
  };
}

// 每轮从当前真实 AX 选择输入模式：普通 composer+发送优先；只有当前是旧回答
// 模式且有可见“开始新讨论”时才点一次并等待普通入口。不能靠上一轮 outcome 推断。
async function prepareInput(harness, turn, timeoutMs) {
  const observation = createInputObservation(harness, turn);
  const predicate = (accept) => (_text, nodes) => {
    const facts = inputModeFacts(harness, nodes);
    observation.record(nodes, facts);
    return accept(facts);
  };
  let observed;
  try {
    observed = await harness.pollAx(
      predicate((facts) => facts.ordinary || Boolean(facts.new_discussion)),
      timeoutMs,
      `r01:input_mode:${turn}`,
    );
  } catch (error) {
    observation.finalize({ wait_error: error.message });
    throw new Error(`input_mode_unavailable:${error.message}`);
  }

  let facts = inputModeFacts(harness, observed.nodes);
  let clicked = false;
  // poll 谓词已经保证 !ordinary 时必有可见「开始新讨论」；这里直接取同一次
  // observed.nodes 的完整 AX node 操作，facts 里的投影不参与点击。
  if (!facts.ordinary) {
    const newDiscussionNode = harness.findButton(observed.nodes, "开始新讨论");
    harness.safeClick(newDiscussionNode, `new-discussion:turn-${turn}`);
    clicked = true;
    try {
      observed = await harness.pollAx(
        predicate((next) => next.ordinary),
        timeoutMs,
        `r01:input_after_new_discussion:${turn}`,
      );
    } catch (error) {
      observation.finalize({ wait_error: error.message, clicked_new_discussion: true });
      throw new Error(`input_mode_unavailable:after_new_discussion:${error.message}`);
    }
    facts = inputModeFacts(harness, observed.nodes);
  }
  observation.record(observed.nodes, facts, { terminal: true });
  observation.finalize({ terminal: true, clicked_new_discussion: clicked });
  return { clicked, nodes: observed.nodes, text: observed.text };
}

export async function runRequestCostSequence({
  harness,
  authors,
  length,
  timeoutMs = 360_000,
}) {
  const plan = buildTurnPlan(authors, length);
  const turns = [];
  let stopReason = null;

  for (const item of plan) {
    try {
      const prepared = await harness.runStep(
        "maintenance",
        `input_ready_turn_${item.turn}`,
        () => prepareInput(harness, item.turn, timeoutMs),
      );
      const clickedNewDiscussion = prepared.clicked;
      const baselineObserved = await harness.pollAx(
        () => true,
        5_000,
        `r01:baseline:${item.turn}`,
      );
      const baselineAuthorCount = countAxAuthorMessages(
        baselineObserved.nodes,
        item.author.text,
      );
      const sentAt = await harness.runStep("input", `author_turn_${item.turn}`, () =>
        harness.rawSubmitAuthorText(item.author.text, `r01:${item.turn}`),
      );
      const observed = await harness.runStep("turn", `fresh_turn_${item.turn}`, () =>
        waitFreshTurn(harness, {
          message: item.author.text,
          baselineAuthorCount,
          timeoutMs,
          turn: item.turn,
        }),
      );
      const outcome = observed.outcome;
      harness.capture(`turn-${item.turn}`);
      const joined = joinWireAfterTerminal(harness, sentAt, item.author);
      turns.push({
        index: item.turn,
        author_id: item.author.id,
        author_sha256: item.author.sha256,
        sent_at: sentAt,
        visible_outcome: outcome,
        freshness: observed.freshness,
        new_discussion_clicked: clickedNewDiscussion,
        ...joined,
      });
      // 模型答错/gap/ask/失败是 Before 行为结果，不是测量失败；输入入口由下一轮
      // prepareInput 根据当前真实 AX 决定，不继承上一轮 outcome。
    } catch (error) {
      stopReason = `turn_error:${error.message}`;
      break;
    }
  }

  // 只有 catch 会 break；没有 stopReason 就说明计划的每一轮都已记录。
  const completed = stopReason === null;
  return {
    completed,
    partial: !completed,
    stop_reason: stopReason,
    turns,
  };
}

function readConfig(dir) {
  const file = path.join(dir, "native-request-cost-config.json");
  assert(fs.existsSync(file), "缺少 native-request-cost-config.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function resolveAuthors(config, source) {
  const byId = new Map(source.authors.map((author) => [author.id, author]));
  return config.plan.map((plan) => {
    const author = byId.get(plan.author_id);
    assert(author, `config.plan 引用了未知 author: ${plan.author_id}`);
    assert.equal(author.sha256, plan.author_sha256, "config.plan 作者 hash 与 source 不一致");
    return author;
  });
}

export async function runWithHarness({ dir, config, authors, harness, capture = captureBatch }) {
  let driverLog = {
    schema: DRIVER_SCHEMA,
    slice_id: "b87-r01-request-cost",
    provider: config.model.provider,
    model: config.model.model,
    work: config.work,
    session_id: config.session_id,
    length: config.length,
    turns: [],
    stop_reason: "not_started",
  };

  await harness.runJourney(async () => {
    try {
      await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
      await harness.runStep("maintenance", "workbench_ready", () =>
        harness.rawWaitWorkbenchSettled("b87-r01", 180_000),
      );
      // 单层等待由 ensureWorkSelected 负责；调用方不能再包 runStep。
      await ensureWorkSelected(harness, config.work.title, "b87-r01");
      harness.capture("workbench");
      await harness.runStep("maintenance", "capture_start", () =>
        capture({ batchDir: dir, checkpoint: "start" }),
      );
      const result = await runRequestCostSequence({
        harness,
        authors,
        length: config.length,
        timeoutMs: config.budget.turn_timeout_ms,
      });
      driverLog = {
        ...driverLog,
        turns: result.turns,
        completed: result.completed,
        partial: result.partial,
        stop_reason: result.stop_reason,
      };
      if (result.completed) {
        driverLog.compaction_history = await runCompactionHistorySequence({
          harness, config, authors, turns: result.turns,
        });
      }
      harness.writeDriverLog("native-request-cost-driver-log.json", driverLog);
      if (!fs.existsSync(path.join(dir, "request-cost-final.json"))) {
        capture({ batchDir: dir, checkpoint: "final" });
      }
      harness.writeUiComplete("b87-r01-request-cost");
      if (!result.completed) {
        throw new Error(`request_cost_sequence_incomplete:${result.stop_reason}`);
      }
    } catch (error) {
      driverLog = {
        ...driverLog,
        completed: false,
        partial: true,
        stop_reason: !driverLog.stop_reason || driverLog.stop_reason === "not_started"
          ? `driver_error:${error.message}`
          : driverLog.stop_reason,
        error: error.message,
      };
      if (!fs.existsSync(path.join(dir, "request-cost-final.json"))) {
        try {
          capture({ batchDir: dir, checkpoint: "final" });
        } catch (captureError) {
          driverLog.capture_error = captureError.message;
        }
      }
      harness.writeDriverLog("native-request-cost-driver-log.json", driverLog);
      harness.writeUiComplete("b87-r01-request-cost");
      throw error;
    }
  });
  return driverLog;
}

async function run(dir, { harnessFactory = (batchDir) => new NativeScenarioHarness(batchDir) } = {}) {
  const config = readConfig(dir);
  const loaded = readManifest(config.manifest.path);
  const source = loadSourceAuthors(loaded.manifest);
  const authors = resolveAuthors(config, source);
  return runWithHarness({ dir, config, authors, harness: harnessFactory(dir) });
}

export async function main(argv) {
  const batchArg = argv[0];
  if (!batchArg) {
    console.error("usage: node scripts/native_request_cost_drive.mjs <batch-dir>");
    process.exitCode = 64;
    return;
  }
  await run(path.resolve(batchArg));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
