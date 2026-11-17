// B87 R01 原生序列驱动行为测试：只验证可见输入/可见终局/新讨论与事后 join 的编排，
// 不启动 GUI、不读真实 DB、不发 AX 事件。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NativeScenarioHarness } from "./lib/native_ui/scenario_driver.mjs";
import {
  buildTurnPlan,
  createAxObservation,
  freshnessFacts,
  inputModeFacts,
  joinWireAfterTerminal,
  main,
  resolveAuthors,
  runRequestCostSequence,
  runFixedSuccessorObservation,
  runWithHarness,
  waitFreshTurn,
} from "./native_request_cost_drive.mjs";

const authors = [
  { id: "round-1", text: "第一句", sha256: "a".repeat(64) },
  { id: "round-2", text: "第二句", sha256: "b".repeat(64) },
  { id: "round-3", text: "第三句", sha256: "c".repeat(64) },
];

const AX_CONTAINER = "0/0/0/0/0";

function fakeHarness({ outcomes, newDiscussion = true, answerModeAfterCompleted = false, stuckAnswerMode = false }) {
  const state = {
    sends: [],
    clicks: [],
    captures: [],
    files: {},
    wire: [],
    turn: 0,
    nodes: [
      { path: "0", role: "AXWindow" },
      { path: AX_CONTAINER, role: "AXGroup" },
    ],
    nextPath: 10,
    terminalAdded: false,
    inputMode: "ordinary",
  };
  const add = (role, title = "", value = "") => {
    const path = `${AX_CONTAINER}/${state.nextPath}`;
    state.nextPath += 1;
    state.nodes.push({ path, role, title, value });
    return path;
  };
  const addAuthor = (text) => {
    const you = add("AXGroup");
    state.nodes.push({ path: `${you}/0`, role: "AXStaticText", title: "", value: "你" });
    const author = add("AXGroup");
    state.nodes.push({ path: `${author}/0`, role: "AXStaticText", title: "", value: text });
  };
  const addDock = () => {
    const group = add("AXGroup", "当前创作任务操作");
    state.nodes.push({ path: `${group}/0`, role: "AXGroup" });
    state.nodes.push({ path: `${group}/0/0`, role: "AXGroup" });
    state.nodes.push({
      path: `${group}/0/0/0/0`,
      role: "AXStaticText",
      title: "",
      value: "等待你回复 · 创作",
    });
  };
  const inputNodes = () => {
    if (state.inputMode === "ordinary") {
      return [
        { path: `${AX_CONTAINER}/900`, role: "AXTextField", title: "", desc: "输入你的想法、问题或指令..." },
        { path: `${AX_CONTAINER}/901`, role: "AXButton", title: "发送", value: "" },
      ];
    }
    if (state.inputMode === "answer" && newDiscussion) {
      return [
        { path: `${AX_CONTAINER}/902`, role: "AXButton", title: "开始新讨论", value: "" },
        { path: `${AX_CONTAINER}/903`, role: "AXButton", title: "回答并继续", value: "" },
      ];
    }
    return [];
  };
  const allNodes = () => [...state.nodes, ...inputNodes()];
  const setTerminalInputMode = (kind) => {
    if (kind === "waiting") state.inputMode = "answer";
    else if (answerModeAfterCompleted) state.inputMode = "answer";
    else state.inputMode = "ordinary";
  };
  const addTerminal = (kind) => {
    setTerminalInputMode(kind);
    if (kind === "capability_gap") {
      const marker = add("AXGroup");
      state.nodes.find((node) => node.path === marker).desc = "能力缺口：测试目标";
      state.nodes.push({ path: `${marker}/0`, role: "AXStaticText", title: "", value: "能力缺口" });
      const reply = add("AXGroup");
      state.nodes.push({ path: `${reply}/0`, role: "AXStaticText", title: "", value: "这条目标当前做不到。" });
      const why = add("AXButton", "为什么");
      state.nodes.find((node) => node.path === why).desc = "查看这轮回应的依据";
      return;
    }
    if (kind === "waiting") {
      const group = add("AXGroup", "创作问题记录");
      state.nodes.push({ path: `${group}/0`, role: "AXStaticText", title: "", value: "问题正文" });
      state.nodes.push({ path: `${group}/1`, role: "AXStaticText", title: "", value: "等待你的回答" });
      return;
    }
    const group = add("AXGroup", "本轮创作过程");
    const status = kind === "failed" ? "失败" : "已完成";
    state.nodes.push({ path: `${group}/0`, role: "AXStaticText", title: "", value: status });
    state.nodes.push({ path: `${group}/1`, role: "AXStaticText", title: "", value: "创作" });
  };
  const text = () =>
    allNodes()
      .map((node) => node.value || node.title || "")
      .filter(Boolean)
      .join("\n");
  const ledger = singleStepLedger();
  const harness = {
    ...ledger,
    rawLaunchApp: async () => {},
    rawWaitWorkbenchSettled: async () => {},
    rawTrySelectWork: async () => true,
    rawSubmitAuthorText: async (value) => {
      state.sends.push(value);
      state.turn += 1;
      state.terminalAdded = false;
      state.inputMode = "ordinary";
      addAuthor(value);
      addDock();
      const at = `2026-11-13T00:00:0${state.turn}.000Z`;
      state.wire.push({
        at,
        direction: "sent",
        frame: ["5", String(state.turn + 8), "workspace:test", "user_message", {
          turn_id: `turn-${state.turn}`,
          text: value,
        }],
      });
      state.wire.push({
        at,
        direction: "received",
        frame: ["5", String(state.turn + 8), "workspace:test", "phx_reply", {
          status: "ok",
          response: { turn_id: `turn-${state.turn}`, run_id: `run-turn-${state.turn}` },
        }],
      });
      return at;
    },
    pollAx: async (predicate) => {
      if (predicate(text(), allNodes())) return { text: text(), nodes: allNodes() };
      if (!state.terminalAdded && state.turn > 0) {
        addTerminal(outcomes[state.turn - 1] ?? "completed");
        state.terminalAdded = true;
      }
      if (predicate(text(), allNodes())) return { text: text(), nodes: allNodes() };
      throw new Error("poll_timeout");
    },
    tryPollAx: async () => (newDiscussion ? { text: text(), nodes: allNodes() } : null),
    findComposer: (nodes) =>
      nodes.find((node) => node.role === "AXTextField" && String(node.desc ?? "").includes("输入")) ?? null,
    findSendButton: (nodes) => nodes.find((node) => node.role === "AXButton" && node.title === "发送") ?? null,
    findButton: (nodes, title) => {
      if (title !== "开始新讨论") return null;
      return nodes.find((node) => node.role === "AXButton" && node.title === title) ?? null;
    },
    safeClick: (node, label) => {
      state.clicks.push(label);
      if (node?.title === "开始新讨论" && !stuckAnswerMode) state.inputMode = "ordinary";
    },
    rawWaitInputReady: async () => ({ nodes: allNodes() }),
    capture: (name) => {
      state.captures.push(name);
    },
    runJourney: async (fn) => fn(),
    writeJson: (name, value) => {
      state.files[name] = value;
    },
    writeDriverLog: () => {},
    writeUiComplete: () => {},
    nowIso: () => "2026-11-13T00:00:00.000Z",
    transport: () => state.wire,
    sentUserMessageSince: NativeScenarioHarness.prototype.sentUserMessageSince,
    ackFor: NativeScenarioHarness.prototype.ackFor,
  };
  return { harness, state };
}

function axTurnNodes({ authors = [], quote = null, status = null } = {}) {
  const container = "0/0/0/0/0";
  const nodes = [
    { path: "0", role: "AXWindow" },
    { path: container, role: "AXGroup" },
  ];
  let next = 10;
  for (const message of authors) {
    const label = `${container}/${next++}`;
    nodes.push({ path: label, role: "AXGroup" });
    nodes.push({ path: `${label}/0`, role: "AXStaticText", value: "你" });
    const group = `${container}/${next++}`;
    nodes.push({ path: group, role: "AXGroup" });
    nodes.push({ path: `${group}/0`, role: "AXStaticText", value: message });
  }
  if (quote !== null) {
    const group = `${container}/${next++}`;
    nodes.push({ path: group, role: "AXGroup" });
    nodes.push({ path: `${group}/0`, role: "AXStaticText", value: "AI 助手" });
    nodes.push({ path: `${group}/1`, role: "AXStaticText", value: quote });
  }
  if (status !== null) {
    const group = `${container}/${next++}`;
    nodes.push({ path: group, role: "AXGroup", title: "本轮创作过程" });
    nodes.push({ path: `${group}/0`, role: "AXStaticText", value: status });
  }
  return nodes;
}

test("freshness 只按 AX 作者节点数与本轮可见终态，不用平面文本计数", () => {
  assert.deepEqual(
    freshnessFacts({ baselineAuthorCount: 1, authorCount: 2, outcomeKind: "capability_gap" }),
    {
      baseline_author_count: 1,
      author_count: 2,
      new_author_echo: true,
      terminal_kind: "capability_gap",
      terminal_after_new_echo: true,
    },
  );
  assert.equal(
    freshnessFacts({ baselineAuthorCount: 1, authorCount: 1, outcomeKind: "completed" })
      .new_author_echo,
    false,
  );
  assert.equal(
    freshnessFacts({ baselineAuthorCount: 1, authorCount: 1, outcomeKind: "completed" })
      .terminal_after_new_echo,
    false,
  );
  assert.equal(
    freshnessFacts({ baselineAuthorCount: 0, authorCount: 1, outcomeKind: null })
      .terminal_after_new_echo,
    null,
  );
});

test("公共反例：模型引用同原话+旧过程折叠使平面计数不增，AX 仍判本轮新作者+新结果", async () => {
  // 旧回合：作者原话一条 + 模型引用同原话一条（平面出现 2 次）。
  const baseline = axTurnNodes({ authors: ["重复作者"], quote: "重复作者", status: "进行中" });
  // 本轮：旧模型引用随历史折叠消失，新增第 2 条作者节点；平面仍是 2 次。
  const current = axTurnNodes({ authors: ["重复作者", "重复作者"], status: "已完成" });
  const flatCount = (nodes) =>
    nodes.map((node) => node.value ?? "").join("\n").split("重复作者").length - 1;
  assert.equal(flatCount(baseline), 2);
  assert.equal(flatCount(current), 2, "平面出现次数没有增加");

  const files = {};
  const harness = {
    nowIso: () => "2026-11-13T00:00:03.000Z",
    writeJson: (name, value) => {
      files[name] = value;
    },
    pollAx: async (predicate) => {
      assert.equal(predicate("", baseline), false);
      assert.equal(predicate("", current), true);
      return { nodes: current, text: "" };
    },
  };
  const observed = await waitFreshTurn(harness, {
    message: "重复作者",
    baselineAuthorCount: 1,
    timeoutMs: 100,
    turn: 2,
  });
  assert.equal(observed.freshness.new_author_echo, true);
  assert.equal(observed.freshness.author_count, 2);
  assert.equal(observed.freshness.terminal_kind, "completed");
  assert.equal(observed.freshness.terminal_after_new_echo, true);
  const observation = files["request-cost-turn-observation-2.json"];
  assert.equal(observation.last.outcome.kind, "completed");
  assert.ok(observation.last.nodes.length > 0);
});

test("runWithHarness 只编排可见流程/捕获日志，不启动真实窗口", async () => {
  const { harness: sequence } = fakeHarness({
    outcomes: ["completed", "completed", "completed"],
    newDiscussion: true,
  });
  let captured = null;
  const harness = {
    ...sequence,
    runJourney: async (fn) => fn(),
    rawLaunchApp: async () => {},
    rawWaitWorkbenchSettled: async () => {},
    rawTrySelectWork: async () => true,
    capture: () => {},
    writeDriverLog: (_name, value) => {
      captured = value;
    },
    writeUiComplete: () => {},
  };
  const config = {
    model: { provider: "splash", model: "local/Q4-PLE4" },
    work: { title: "work" },
    session_id: "session",
    length: 3,
    budget: { turn_timeout_ms: 1_000 },
    plan: authors.map((author, index) => ({ turn: index + 1, author_id: author.id, author_sha256: author.sha256 })),
  };
  const result = await runWithHarness({
    dir: "/tmp/r01",
    config,
    authors,
    harness,
    capture: () => ({ ok: true }),
  });
  assert.equal(result.completed, true);
  assert.equal(result.turns.length, 3);
  assert.equal(captured.completed, true);
  assert.equal(captured.turns.length, 3);
  assert.equal(resolveAuthors(config, { authors }).length, 3);
});

test("buildTurnPlan 按三条作者原话循环 3/10/20", () => {
  assert.deepEqual(
    buildTurnPlan(authors, 3).map((turn) => turn.author_id),
    ["round-1", "round-2", "round-3"],
  );
  assert.deepEqual(
    buildTurnPlan(authors, 10).map((turn) => turn.author_id),
    ["round-1", "round-2", "round-3", "round-1", "round-2", "round-3", "round-1", "round-2", "round-3", "round-1"],
  );
  assert.equal(buildTurnPlan(authors, 20).length, 20);
});

test("可见序列：三次发送、一次新讨论、事后按 turn 绑定", async () => {
  const { harness, state } = fakeHarness({
    outcomes: ["completed", "waiting", "completed"],
    newDiscussion: true,
  });
  const result = await runRequestCostSequence({
    harness,
    authors,
    length: 3,
    timeoutMs: 1_000,
  });
  assert.equal(result.completed, true);
  assert.equal(result.partial, false);
  assert.deepEqual(state.sends, ["第一句", "第二句", "第三句"]);
  assert.deepEqual(state.clicks, ["new-discussion:turn-3"]);
  assert.deepEqual(
    result.turns.map((turn) => turn.turn_id),
    ["turn-1", "turn-2", "turn-3"],
  );
  assert.equal(result.turns[1].visible_outcome.kind, "waiting");
  assert.equal(result.turns[2].new_discussion_clicked, true);
});

test("等待作者且无可见新讨论：停止为 partial，不自动答/不伪造下一轮", async () => {
  const { harness, state } = fakeHarness({
    outcomes: ["waiting", "completed"],
    newDiscussion: false,
  });
  const result = await runRequestCostSequence({
    harness,
    authors,
    length: 3,
    timeoutMs: 1_000,
  });
  assert.equal(result.completed, false);
  assert.equal(result.partial, true);
  assert.match(result.stop_reason, /input_mode_unavailable/);
  assert.deepEqual(state.sends, ["第一句"]);
  assert.equal(state.clicks.length, 0);
});

test("模型失败是 Before 行为结果：记录后继续下一固定输入", async () => {
  const { harness, state } = fakeHarness({
    outcomes: ["completed", "failed", "completed"],
    newDiscussion: true,
  });
  const result = await runRequestCostSequence({
    harness,
    authors,
    length: 3,
    timeoutMs: 1_000,
  });
  assert.equal(result.completed, true);
  assert.equal(result.partial, false);
  assert.deepEqual(state.sends, ["第一句", "第二句", "第三句"]);
  assert.equal(result.turns.length, 3);
  assert.equal(result.turns[1].visible_outcome.kind, "failed");
});


test("capability_gap 是可见终态：记录缺口后继续下一冻结输入", async () => {
  const { harness, state } = fakeHarness({
    outcomes: ["capability_gap", "completed", "completed"],
    newDiscussion: true,
  });
  const result = await runRequestCostSequence({
    harness,
    authors,
    length: 3,
    timeoutMs: 1_000,
  });
  assert.equal(result.completed, true);
  assert.equal(state.sends.length, 3);
  assert.equal(result.turns[0].visible_outcome.kind, "capability_gap");
  assert.equal(result.turns[0].visible_outcome.gap.goal, "测试目标");
  assert.equal(result.turns[0].turn_id, "turn-1");
  assert.equal(result.turns[0].run_id, "run-turn-1");
  assert.equal(result.turns[0].joined, true);
  assert.equal(result.turns[1].visible_outcome.kind, "completed");
});

test("completed 后仍处于旧回答模式：按当前可见开始新讨论切换一次，不靠上一轮 kind", async () => {
  const { harness, state } = fakeHarness({
    outcomes: ["completed", "completed", "completed"],
    newDiscussion: true,
    answerModeAfterCompleted: true,
  });
  const result = await runRequestCostSequence({
    harness,
    authors,
    length: 3,
    timeoutMs: 1_000,
  });
  assert.equal(result.completed, true);
  assert.equal(state.sends.length, 3);
  assert.deepEqual(state.clicks, [
    "new-discussion:turn-2",
    "new-discussion:turn-3",
  ]);
  assert.equal(result.turns[1].new_discussion_clicked, true);
  assert.equal(result.turns[2].new_discussion_clicked, true);
  const input = state.files["request-cost-input-observation-2.json"];
  assert.equal(input.terminal, true);
  assert.equal(input.last.terminal, true);
  assert.equal(input.clicked_new_discussion, true);
});

test("固定后继只在闭合主体边界后发一次，保留独立序号且不递归", async () => {
  const { harness, state } = fakeHarness({ outcomes: ["completed"], newDiscussion: true });
  const result = await runFixedSuccessorObservation({
    harness, config: {length:10,budget:{turn_timeout_ms:1000},successor_observation:{}},
    author: authors[0], boundary: () => ({audit:{ok:true},captured_at:"2026-11-18T00:00:00Z"}),
  });
  assert.equal(result.completed,true);
  assert.equal(result.turns.length,1);
  assert.equal(result.turns[0].index,11);
  assert.deepEqual(state.sends,[authors[0].text]);
});

test("固定后继边界未知不发送、旧配置不发送、后继追问不补答", async () => {
  for (const ok of [null,false]) {
    const { harness,state }=fakeHarness({outcomes:["completed"]});
    const result=await runFixedSuccessorObservation({harness,config:{length:10,successor_observation:{}},
      author:authors[0],boundary:()=>({audit:{ok}})});
    assert.equal(result.completed,false); assert.equal(state.sends.length,0);
  }
  const old=fakeHarness({outcomes:["completed"]});
  assert.equal(await runFixedSuccessorObservation({harness:old.harness,config:{length:10}}),null);
  assert.equal(old.state.sends.length,0);
  const waiting=fakeHarness({outcomes:["waiting"]});
  const result=await runFixedSuccessorObservation({harness:waiting.harness,
    config:{length:20,budget:{turn_timeout_ms:1000},successor_observation:{}},
    author:authors[0],boundary:()=>({audit:{ok:true}})});
  assert.equal(result.completed,false);assert.equal(waiting.state.sends.length,1);
});

test("普通 composer 可用时不做新讨论切换", async () => {
  const { harness, state } = fakeHarness({
    outcomes: ["completed", "completed"],
    newDiscussion: true,
  });
  const result = await runRequestCostSequence({
    harness,
    authors,
    length: 2,
    timeoutMs: 1_000,
  });
  assert.equal(result.completed, true);
  assert.equal(state.clicks.length, 0);
  assert.equal(result.turns[1].new_discussion_clicked, false);
});

test("切换后仍无普通入口：只点一次并明确失败，不重复点击/扩大等待", async () => {
  const { harness, state } = fakeHarness({
    outcomes: ["completed", "completed"],
    newDiscussion: true,
    answerModeAfterCompleted: true,
    stuckAnswerMode: true,
  });
  const result = await runRequestCostSequence({
    harness,
    authors,
    length: 2,
    timeoutMs: 50,
  });
  assert.equal(result.completed, false);
  assert.equal(result.partial, true);
  assert.match(result.stop_reason, /input_mode_unavailable/);
  assert.deepEqual(state.clicks, ["new-discussion:turn-2"]);
  const observation = state.files["request-cost-input-observation-2.json"];
  assert.equal(observation.clicked_new_discussion, true, "点过新讨论但未进入普通入口必须留证");
  assert.match(observation.wait_error, /poll_timeout/);
  assert.equal(observation.terminal, undefined, "未进入普通入口不能标 terminal");
});

test("无窗口/无合法输入入口：明确 input_mode_unavailable，不发送下一条", async () => {
  const { harness, state } = fakeHarness({
    outcomes: ["completed", "completed"],
    newDiscussion: false,
    answerModeAfterCompleted: true,
  });
  const result = await runRequestCostSequence({
    harness,
    authors,
    length: 2,
    timeoutMs: 50,
  });
  assert.equal(result.completed, false);
  assert.equal(result.partial, true);
  assert.match(result.stop_reason, /input_mode_unavailable/);
  assert.equal(state.sends.length, 1);
  assert.equal(state.clicks.length, 0);
  const observation = state.files["request-cost-input-observation-2.json"];
  assert.ok(observation, "输入准备失败也必须留下最新 AX 观察");
  assert.equal(observation.last.facts.window, true);
  assert.equal(observation.last.facts.ordinary, false);
  assert.match(observation.wait_error, /poll_timeout/);
});

test("joinWireAfterTerminal 读 Phoenix frame[4] 的实际 turn/run，null 时不以 joined 伪装", () => {
  const author = { text: "作者" };
  const at = "2026-11-13T00:00:00.000Z";
  const harness = Object.create(NativeScenarioHarness.prototype);
  const sent = {
    at,
    direction: "sent",
    frame: ["5", "9", "workspace:test", "user_message", { turn_id: "message-1", text: "作者" }],
  };
  const ack = {
    at,
    direction: "received",
    frame: ["5", "9", "workspace:test", "phx_reply", {
      status: "ok",
      response: { turn_id: "message-1", run_id: "run-1" },
    }],
  };

  harness.transport = () => [];
  const absent = joinWireAfterTerminal(harness, at, author);
  assert.equal(absent.joined, false);
  assert.equal(absent.sent_bound, false);
  assert.equal(absent.run_bound, false);
  assert.equal(absent.turn_id, null);

  harness.transport = () => [sent];
  const ackWithoutRun = {
    at,
    direction: "received",
    frame: ["5", "9", "workspace:test", "phx_reply", {
      status: "ok",
      response: { turn_id: "message-1" },
    }],
  };
  harness.transport = () => [sent, ackWithoutRun];
  const noRun = joinWireAfterTerminal(harness, at, author);
  assert.equal(noRun.run_id, null);
  assert.equal(noRun.ack_ok, true);
  assert.equal(noRun.run_bound, false);
  assert.equal(noRun.joined, false);

  harness.transport = () => [sent];
  const noAck = joinWireAfterTerminal(harness, at, author);
  assert.equal(noAck.turn_id, "message-1");
  assert.equal(noAck.run_id, null);
  assert.equal(noAck.ack_ok, false);
  assert.equal(noAck.sent_bound, true);
  assert.equal(noAck.run_bound, false);
  assert.equal(noAck.joined, false);

  harness.transport = () => [sent, ack];
  const joined = joinWireAfterTerminal(harness, at, author);
  assert.equal(joined.turn_id, "message-1");
  assert.equal(joined.run_id, "run-1");
  assert.equal(joined.ack_ok, true);
  assert.equal(joined.sent_bound, true);
  assert.equal(joined.run_bound, true);
  assert.equal(joined.joined, true);

  const noTurn = {
    ...sent,
    frame: ["5", "9", "workspace:test", "user_message", { text: "作者" }],
  };
  harness.transport = () => [noTurn, { ...ack, frame: ["5", "9", "workspace:test", "phx_reply", {
    status: "ok",
    response: { run_id: "run-1" },
  }] }];
  const unbound = joinWireAfterTerminal(harness, at, author);
  assert.equal(unbound.turn_id, null);
  assert.equal(unbound.sent_bound, false);
  assert.equal(unbound.run_bound, false);
  assert.equal(unbound.joined, false);
});

// 可信单活动步骤 fake：B37 等待账同一时刻只允许一个 begin；嵌套即失败。
function singleStepLedger() {
  let active = null;
  const labels = [];
  return {
    labels,
    runStep: async (_kind, label, fn) => {
      if (active !== null) throw new Error("invalid_wait_begin");
      active = label;
      labels.push(label);
      try {
        return await fn();
      } finally {
        active = null;
      }
    },
  };
}

test("选择作品复用 ensureWorkSelected 的单层等待，不在调用方重复 runStep", async () => {
  const { harness: sequence } = fakeHarness({
    outcomes: ["completed", "completed", "completed"],
  });
  const ledger = singleStepLedger();
  const harness = {
    ...sequence,
    ...ledger,
    runJourney: async (fn) => fn(),
    rawLaunchApp: async () => {},
    rawWaitWorkbenchSettled: async () => {},
    rawTrySelectWork: async () => true,
    capture: () => {},
    writeDriverLog: () => {},
    writeUiComplete: () => {},
  };
  const config = {
    model: { provider: "splash", model: "local/Q4-PLE4" },
    work: { title: "work" },
    session_id: "session",
    length: 3,
    budget: { turn_timeout_ms: 1_000 },
    plan: authors.map((author, index) => ({ turn: index + 1, author_id: author.id, author_sha256: author.sha256 })),
  };

  const result = await runWithHarness({
    dir: "/tmp/r01",
    config,
    authors,
    harness,
    capture: () => ({ ok: true }),
  });

  assert.equal(result.completed, true);
  assert.deepEqual(
    ledger.labels.filter((label) => label.startsWith("select_work")),
    ["select_work:b87-r01"],
    "select_work 只能由 ensureWorkSelected 打开一层等待",
  );
  const selectedAt = ledger.labels.indexOf("select_work:b87-r01");
  assert.equal(ledger.labels[selectedAt - 1], "workbench_ready");
  assert.equal(ledger.labels[selectedAt + 1], "capture_start");
});

test("三轮可见序列的 input/turn 等待单层且按轮交替", async () => {
  const { harness: sequence } = fakeHarness({
    outcomes: ["completed", "waiting", "completed"],
  });
  const ledger = singleStepLedger();
  const harness = { ...sequence, ...ledger };
  const result = await runRequestCostSequence({
    harness,
    authors,
    length: 3,
    timeoutMs: 1_000,
  });

  assert.equal(result.completed, true);
  for (const turn of [1, 2, 3]) {
    assert.ok(ledger.labels.includes(`input_ready_turn_${turn}`));
    assert.ok(ledger.labels.includes(`author_turn_${turn}`));
    assert.ok(ledger.labels.includes(`fresh_turn_${turn}`));
  }
});

function observationNodes(message, status = "进行中") {
  const container = "0/0/0/0/0";
  return [
    { path: "0", role: "AXWindow" },
    { path: container, role: "AXGroup" },
    { path: `${container}/10`, role: "AXGroup" },
    { path: `${container}/10/0`, role: "AXStaticText", value: "你" },
    { path: `${container}/11`, role: "AXGroup" },
    { path: `${container}/11/0`, role: "AXStaticText", value: message },
    { path: `${container}/12`, role: "AXGroup", title: "本轮创作过程" },
    { path: `${container}/12/0`, role: "AXStaticText", value: status },
  ];
}

test("等待超时时已观察到的 running AX 会先落盘，供清理后复算", async () => {
  const files = {};
  let polls = 0;
  const nodes = observationNodes("第三句");
  const harness = {
    nowIso: () => "2026-11-13T00:00:03.000Z",
    writeJson: (name, value) => {
      files[name] = value;
    },
    pollAx: async (predicate) => {
      polls += 2;
      assert.equal(predicate("", nodes), false);
      assert.equal(predicate("", nodes), false);
      throw new Error("wait_ax_timeout:fresh_turn");
    },
  };

  await assert.rejects(
    waitFreshTurn(harness, {
      message: "第三句",
      baselineAuthorCount: 0,
      timeoutMs: 1,
      turn: 3,
    }),
    /wait_ax_timeout/,
  );
  const observation = files["request-cost-turn-observation-3.json"];
  assert.ok(observation, "超时前必须已写观察文件");
  assert.equal(observation.last.outcome.kind, "running");
  assert.equal(observation.last.terminal, false);
  assert.equal(observation.last.node_count, nodes.length);
  assert.equal(observation.last.nodes.length, nodes.length);
  assert.match(observation.wait_error, /wait_ax_timeout/);
  assert.equal(observation.changes.length, 1, "相同内容不重复堆全量树");
});

test("等待命中终态时观察文件保存最后 completed 与变化摘要", async () => {
  const files = {};
  const running = observationNodes("第三句", "进行中");
  const completed = observationNodes("第三句", "已完成");
  const harness = {
    nowIso: () => "2026-11-13T00:00:04.000Z",
    writeJson: (name, value) => {
      files[name] = value;
    },
    pollAx: async (predicate) => {
      assert.equal(predicate("", running), false);
      assert.equal(predicate("", completed), true);
      return { nodes: completed, text: "第三句\n已完成" };
    },
  };

  const observed = await waitFreshTurn(harness, {
    message: "第三句",
    baselineAuthorCount: 0,
    timeoutMs: 1,
    turn: 3,
  });
  assert.equal(observed.outcome.kind, "completed");
  const observation = files["request-cost-turn-observation-3.json"];
  assert.equal(observation.last.outcome.kind, "completed");
  assert.equal(observation.last.terminal, true);
  assert.deepEqual(
    observation.changes.map((change) => change.kind),
    ["running", "completed"],
  );
});


test("AX 观察 owner 直接覆盖变化/同签名终态/finalize", () => {
  const files = {};
  const harness = {
    nowIso: () => "2026-11-13T00:00:00.000Z",
    writeJson: (name, value) => {
      files[name] = value;
    },
  };
  const writer = createAxObservation(harness, {
    file: "obs.json",
    meta: { schema: "b87-r01-ax-observation/v1", turn: 1 },
  });
  writer.record([{ path: "0", role: "AXWindow" }], {
    data: { outcome: { kind: "running" } },
    change: { kind: "running" },
  });
  writer.record([{ path: "0", role: "AXWindow" }], {
    data: { outcome: { kind: "running" } },
    change: { kind: "running" },
  });
  writer.record([{ path: "0", role: "AXWindow" }], {}, { terminal: true });
  writer.record([{ path: "0", role: "AXWindow" }, { path: "1", role: "AXGroup" }], {
    data: { outcome: { kind: "completed" } },
    change: { kind: "completed" },
  });
  writer.finalize({ wait_error: "closed" });
  assert.equal(files["obs.json"].schema, "b87-r01-ax-observation/v1");
  assert.equal(files["obs.json"].last.outcome.kind, "completed");
  assert.equal(files["obs.json"].changes.length, 2);
  assert.equal(files["obs.json"].changes[0].terminal, true, "同签名 terminal 必须回写变化摘要");
  assert.equal(files["obs.json"].wait_error, "closed");
});

test("safeClick 契约：审计投影无 frame 失败；原始完整 AX node 可走合法鼠标回退", () => {
  const harness = Object.create(NativeScenarioHarness.prototype);
  harness.target = { pid: 1 };
  const calls = [];
  let mode = "success";
  harness.input = {
    click: (path) => {
      calls.push({ type: "ax", path });
      if (mode === "fail") {
        const error = new Error("axpress_failed");
        error.reason = "axpress_failed";
        throw error;
      }
      return { ok: true, method: "ax" };
    },
    clickAt: (x, y) => {
      calls.push({ type: "mouse", x, y });
      return { ok: true, method: "mouse" };
    },
  };
  const raw = {
    path: "0/0/0/0/0/69/2",
    role: "AXButton",
    title: "开始新讨论",
    desc: "",
    frame: [10, 20, 30, 40],
    enabled: true,
  };
  assert.deepEqual(harness.safeClick(raw, "ax-ok"), { ok: true, method: "ax", label: "ax-ok" });
  const projection = { path: raw.path, role: raw.role, title: raw.title, desc: "" };
  mode = "fail";
  assert.throws(() => harness.safeClick(projection, "projection"), /no_frame/);
  const fallback = harness.safeClick(raw, "fallback");
  assert.equal(fallback.method, "mouse");
  assert.equal(fallback.fallback_from, "axpress_failed");
  assert.deepEqual(calls.at(-1), { type: "mouse", x: 25, y: 40 });
});

function contractHarness({ axpressFails = false } = {}) {
  const state = {
    mode: "answer",
    sent: false,
    sends: [],
    clicks: [],
    fallback: 0,
    nodes: [
      { path: "0", role: "AXWindow" },
      {
        path: "0/0/0/0/0/69/2",
        role: "AXButton",
        title: "开始新讨论",
        desc: "",
        frame: [10, 20, 30, 40],
        enabled: true,
      },
      { path: "0/0/0/0/0/72", role: "AXButton", title: "回答并继续", desc: "", enabled: false },
    ],
  };
  const container = "0/0/0/0/0";
  const ordinary = () => [
    { path: "0", role: "AXWindow" },
    { path: `${container}/900`, role: "AXTextField", title: "", desc: "输入你的想法、问题或指令..." },
    { path: `${container}/901`, role: "AXButton", title: "发送", value: "" },
  ];
  const completed = () => [
    { path: "0", role: "AXWindow" },
    { path: `${container}/10`, role: "AXGroup" },
    { path: `${container}/10/0`, role: "AXStaticText", value: "你" },
    { path: `${container}/11`, role: "AXGroup" },
    { path: `${container}/11/0`, role: "AXStaticText", value: "第七轮原文" },
    { path: `${container}/12`, role: "AXGroup", title: "本轮创作过程" },
    { path: `${container}/12/0`, role: "AXStaticText", value: "已完成" },
  ];
  const harness = Object.create(NativeScenarioHarness.prototype);
  harness.target = { pid: 1 };
  harness.input = {
    click: (clickPath) => {
      state.clicks.push(clickPath);
      if (axpressFails) {
        const error = new Error("axpress_failed");
        error.reason = "axpress_failed";
        throw error;
      }
      state.mode = "ordinary";
      return { ok: true, method: "ax" };
    },
    clickAt: (x, y) => {
      state.fallback += 1;
      state.mode = "ordinary";
      return { ok: true, method: "mouse", x, y };
    },
  };
  harness.nowIso = () => "2026-11-13T00:00:00.000Z";
  harness.writeJson = () => {};
  harness.capture = () => {};
  harness.pollAx = async (predicate) => {
    const nodes = state.sent ? completed() : state.mode === "ordinary" ? ordinary() : state.nodes;
    assert.equal(predicate("", nodes), true);
    return { nodes, text: nodes.map((node) => node.value || node.title || "").join("\n") };
  };
  harness.rawSubmitAuthorText = async (text) => {
    state.sent = true;
    state.sends.push(text);
    const at = "2026-11-13T00:00:01.000Z";
    const sent = { at, direction: "sent", frame: ["5", "9", "workspace:test", "user_message", { turn_id: "turn-7", text }] };
    const ack = { at, direction: "received", frame: ["5", "9", "workspace:test", "phx_reply", { status: "ok", response: { turn_id: "turn-7", run_id: "run-7" } }] };
    state.wire = [sent, ack];
    return at;
  };
  harness.transport = () => state.wire ?? [];
  harness.runStep = async (_kind, _label, fn) => fn();
  return { harness, state };
}

test("公共 runRequestCostSequence：旧回答模式点击使用完整 AX node，AXPress 成功不伪造回退", async () => {
  const { harness, state } = contractHarness({ axpressFails: false });
  const result = await runRequestCostSequence({
    harness,
    authors: [{ id: "round-7", text: "第七轮原文", sha256: "a".repeat(64) }],
    length: 1,
    timeoutMs: 100,
  });
  assert.equal(result.completed, true, result.stop_reason);
  assert.deepEqual(state.sends, ["第七轮原文"]);
  assert.equal(state.clicks.length, 1);
  assert.equal(state.fallback, 0);
});

test("公共 runRequestCostSequence：AXPress 合法失败后按完整 node frame 回退一次", async () => {
  const { harness, state } = contractHarness({ axpressFails: true });
  const result = await runRequestCostSequence({
    harness,
    authors: [{ id: "round-7", text: "第七轮原文", sha256: "a".repeat(64) }],
    length: 1,
    timeoutMs: 100,
  });
  assert.equal(result.completed, true, result.stop_reason);
  assert.equal(state.clicks.length, 1);
  assert.equal(state.fallback, 1);
  assert.deepEqual(state.sends, ["第七轮原文"]);
});

test("AX 观察 owner 覆盖非数组 nodes、无写盘与写盘异常", () => {
  const files = {};
  const writer = createAxObservation(
    { writeJson: (name, value) => { files[name] = value; } },
    { file: "no-now.json", meta: { schema: "test-observation/v1" } },
  );
  writer.record(null);
  writer.record([{ path: "0", role: "AXWindow" }]);
  writer.finalize({ final: true });
  assert.equal(files["no-now.json"].last.node_count, 1);
  assert.equal(files["no-now.json"].final, true);

  const noWrite = createAxObservation(
    { nowIso: () => "2026-11-13T00:00:00.000Z" },
    { file: "missing.json", meta: { schema: "test-observation/v1" } },
  );
  assert.doesNotThrow(() => {
    noWrite.record([], { data: { outcome: { kind: "unknown" } } });
    noWrite.finalize();
  });

  const throwing = createAxObservation({
    nowIso: () => "2026-11-13T00:00:00.000Z",
    writeJson: () => { throw new Error("disk_full"); },
  }, { file: "throw.json", meta: { schema: "test-observation/v1" } });
  assert.doesNotThrow(() => throwing.record([{ path: "0", role: "AXWindow" }]));
});

test("freshness/buildTurnPlan 默认值与非法输入边界", () => {
  assert.deepEqual(freshnessFacts(), {
    baseline_author_count: 0,
    author_count: 0,
    new_author_echo: false,
    terminal_kind: null,
    terminal_after_new_echo: null,
  });
  assert.deepEqual(freshnessFacts(), freshnessFacts({}));
  assert.equal(freshnessFacts({ baselineAuthorCount: 0, authorCount: 0, outcomeKind: "completed" }).terminal_after_new_echo, false);
  assert.throws(() => buildTurnPlan([], 1), /authors/);
  assert.throws(() => buildTurnPlan(authors, 0), /length/);
  assert.throws(() => buildTurnPlan(authors, 1.5), /length/);
});

test("joinWireAfterTerminal 对缺 frame/缺 body 的帧保持 null，不抛异常", () => {
  const harness = Object.create(NativeScenarioHarness.prototype);
  const at = "2026-11-13T00:00:00.000Z";
  const author = { text: "作者" };
  harness.transport = () => [
    { at, direction: "sent", frame: null },
    { at, direction: "received", frame: ["5", "9", "workspace:test", "phx_reply", null] },
  ];
  const joined = joinWireAfterTerminal(harness, at, author);
  assert.equal(joined.turn_id, null);
  assert.equal(joined.run_id, null);
  assert.equal(joined.joined, false);
});

test("waitFreshTurn 完成时顶层 observation 也记录 terminal=true", async () => {
  const files = {};
  const nodes = observationNodes("第三句", "已完成");
  const harness = {
    nowIso: () => "2026-11-13T00:00:04.000Z",
    writeJson: (name, value) => { files[name] = value; },
    pollAx: async (predicate) => {
      assert.equal(predicate("", nodes), true);
      return { nodes, text: "" };
    },
  };
  const observed = await waitFreshTurn(harness, {
    message: "第三句",
    baselineAuthorCount: 0,
    timeoutMs: 1,
    turn: 3,
  });
  assert.equal(observed.outcome.kind, "completed");
  assert.equal(files["request-cost-turn-observation-3.json"].terminal, true);
});

test("input_mode facts：没有窗口节点时 window=false；只有 composer 没有发送按钮不算普通入口", () => {
  const harness = Object.create(NativeScenarioHarness.prototype);
  assert.equal(inputModeFacts(harness, [{ path: "0/0", role: "AXButton", title: "发送" }]).window, false);
  const nodes = [
    { path: "0", role: "AXWindow" },
    { path: "0/0/0/0/0/900", role: "AXTextField", title: "", desc: "输入你的想法、问题或指令..." },
  ];
  const facts = inputModeFacts(harness, nodes);
  assert.equal(facts.window, true);
  assert.equal(facts.ordinary, false);
  assert.equal(facts.composer.role, "AXTextField");
  assert.equal(facts.composer.desc, "输入你的想法、问题或指令...");
  assert.equal(facts.composer.title, "");
  assert.equal(facts.send, null);
  assert.equal(inputModeFacts(harness, [
    { path: "0", role: "AXWindow" },
    { path: "0/1", role: "AXTextField", desc: "输入", title: "输入框" },
    { path: "0/2", role: "AXButton", title: "发送" },
  ]).send.title, "发送");
});

test("AX 观察 owner：非数组 node_count 为 0，变化历史上限 240", () => {
  const files = {};
  const writer = createAxObservation({ writeJson: (name, value) => { files[name] = value; } }, { file: "cap.json" });
  writer.record(null);
  assert.equal(files["cap.json"].last.node_count, 0);
  assert.deepEqual(files["cap.json"].last.nodes, []);
  for (let index = 0; index < 241; index += 1) {
    writer.record([{ path: String(index), role: "AXWindow" }]);
  }
  assert.equal(files["cap.json"].changes.length, 240);
});

test("joinWireAfterTerminal 无 sent 时 ack_ok 明确 false", () => {
  const harness = Object.create(NativeScenarioHarness.prototype);
  harness.transport = () => [];
  const joined = joinWireAfterTerminal(harness, "2026-11-13T00:00:00.000Z", { text: "作者" });
  assert.equal(joined.ack_ok, false);
  assert.equal(joined.joined, false);
});

test("runWithHarness 驱动失败也写 partial 日志、清场前后都保留证据", async () => {
  const { harness: sequence } = fakeHarness({ outcomes: ["completed"] });
  const logs = [];
  const captures = [];
  const harness = {
    ...sequence,
    rawLaunchApp: async () => {
      throw new Error("launch_failed");
    },
    capture: () => {},
    writeDriverLog: (_name, value) => logs.push(value),
    writeUiComplete: () => {},
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r01-drive-fail-"));
  try {
    await assert.rejects(
      runWithHarness({
        dir,
        config: {
          model: { provider: "splash", model: "local/Q4-PLE4" },
          work: { title: "work" },
          session_id: "session",
          length: 1,
          budget: { turn_timeout_ms: 1_000 },
          plan: [{ turn: 1, author_id: authors[0].id, author_sha256: authors[0].sha256 }],
        },
        authors,
        harness,
        capture: ({ checkpoint }) => captures.push(checkpoint),
      }),
      /launch_failed/,
    );
    assert.deepEqual(captures, ["final"], "失败后仍要尝试 final 捕获");
    const log = logs.at(-1);
    assert.equal(log.completed, false);
    assert.equal(log.partial, true);
    assert.match(log.stop_reason, /^driver_error:launch_failed$/);
    assert.equal(log.error, "launch_failed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runWithHarness 序列未完成时抛 incomplete，不把 partial 当完成", async () => {
  const { harness: sequence } = fakeHarness({
    outcomes: ["completed"],
    newDiscussion: false,
    answerModeAfterCompleted: true,
  });
  const logs = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r01-drive-incomplete-"));
  try {
    await assert.rejects(
      runWithHarness({
        dir,
        config: {
          model: { provider: "splash", model: "local/Q4-PLE4" },
          work: { title: "work" },
          session_id: "session",
          length: 2,
          budget: { turn_timeout_ms: 50 },
          plan: authors.slice(0, 2).map((author, index) => ({
            turn: index + 1,
            author_id: author.id,
            author_sha256: author.sha256,
          })),
        },
        authors,
        harness: {
          ...sequence,
          rawLaunchApp: async () => {},
          capture: () => {},
          writeDriverLog: (_name, value) => logs.push(value),
          writeUiComplete: () => {},
        },
        capture: () => ({ ok: true }),
      }),
      /request_cost_sequence_incomplete/,
    );
    const log = logs.at(-1);
    assert.equal(log.completed, false);
    assert.equal(log.partial, true);
    assert.match(log.stop_reason, /input_mode_unavailable/);
    assert.equal(log.turns.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI main：无批次目录给 usage，缺配置明确失败", async () => {
  const previous = process.exitCode;
  const errors = [];
  const originalError = console.error;
  console.error = (message) => errors.push(String(message));
  try {
    process.exitCode = undefined;
    await main([]);
    assert.equal(process.exitCode, 64);
    assert.match(errors.at(-1), /usage: node scripts\/native_request_cost_drive\.mjs/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r01-drive-cli-"));
    try {
      await assert.rejects(main([dir]), /缺少 native-request-cost-config\.json/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    console.error = originalError;
    process.exitCode = previous;
  }
});

test("runWithHarness 已有 final 结果时不重复 capture", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r01-drive-"));
  try {
    fs.writeFileSync(path.join(dir, "request-cost-final.json"), "{}");
    const { harness } = fakeHarness({ outcomes: ["completed"] , newDiscussion: true });
    const calls = [];
    const configured = {
      ...harness,
      runJourney: async (fn) => fn(),
      capture: (name) => calls.push(name),
      writeDriverLog: () => {},
      writeUiComplete: () => {},
    };
    await runWithHarness({
      dir,
      config: {
        model: { provider: "splash", model: "local/Q4-PLE4" },
        work: { title: "work" },
        session_id: "session",
        length: 1,
        budget: { turn_timeout_ms: 1_000 },
        plan: [{ turn: 1, author_id: authors[0].id, author_sha256: authors[0].sha256 }],
      },
      authors,
      harness: configured,
      capture: ({ checkpoint }) => calls.push(checkpoint),
    });
    assert.equal(calls.includes("final"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
