// B31 原生补验：仅 T3/T4/T5 前提用协议 seed；被测输入/选择/回复由系统 UI 操作。
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { B31QuestionProof, B31_STRUCTURE_REPLIES, assertProtectedVersions } from "./lib/b31-question-proof.mjs";

const [mode, artifact] = process.argv.slice(2), dir = path.resolve(artifact);
const read = (file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
const write = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2));
const lines = (file) => fs.readFileSync(path.join(dir, file), "utf8").split("\n").filter(Boolean).map(JSON.parse);
const ready = read("native-driver-ready.json"), base = ready.api_url;
const request = async (url, body) => {
  const response = await fetch(base + url, { method: body ? "POST" : "GET", signal: AbortSignal.timeout(10_000),
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  assert(response.ok, `${url}: ${response.status}`); return response.json();
};
const replyText = "直接在现有正文基础上扩写，增加场景、细节和心理描写，保持现有结构与情节不变。";

async function snapshotFor(trial) {
  const url = `/api/works/${trial.work_id}/sessions/${trial.session_id}`;
  const snapshot = await request(url), transcript = [...snapshot.transcript];
  let page = snapshot.transcript_page, pages = 1;
  while (page.has_more_before) {
    assert(pages < 20, "历史分页未收敛");
    const older = await request(`${url}/transcript?before_id=${encodeURIComponent(page.before_id)}`);
    transcript.unshift(...older.transcript); page = older.transcript_page; pages += 1;
  }
  assert.equal(new Set(transcript.map((row) => row.id)).size, transcript.length);
  return { ...snapshot, transcript, evidence_pages_loaded: pages };
}

async function capture(trialId, checkpoint) {
  assert(["T1", "T2"].includes(trialId));
  assert(["after-original-reply", "after-questions-closed"].includes(checkpoint));
  const trial = read("b31-trials.json").find((item) => item.id === trialId);
  const file = `${trialId}-${checkpoint}.json`;
  assert(!fs.existsSync(path.join(dir, file)), "检查点证据不得覆盖");
  const snapshot = await snapshotFor(trial);
  write(file, { captured_at: new Date().toISOString(), snapshot });
}

async function seed(trial, ordered) {
  const front = createRequire(new URL("../frontend/package.json", import.meta.url));
  const pw = createRequire(front.resolve("playwright/package.json"));
  const { ws: WebSocket } = pw("playwright-core/lib/utilsBundle");
  const url = base.replace("http:", "ws:") + "/socket/websocket?vsn=2.0.0";
  const ws = new WebSocket(url), received = [];
  ws.on("message", (data) => {
    const frame = JSON.parse(data.toString()); received.push(frame);
    fs.appendFileSync(path.join(dir, "protocol-seed.jsonl"), JSON.stringify({ at: new Date().toISOString(), trial: trial.id, direction: "received", frame }) + "\n");
  });
  const wait = async (predicate, budget = 30_000, runId = null) => {
    const deadline = Date.now() + budget;
    while (Date.now() < deadline) {
      const match = received.find(predicate); if (match) return match;
      const terminal = received.find((f) => f[3] === "agent_run_state" && f[4].run_id === runId && ["failed", "cancelled"].includes(f[4].status));
      if (terminal) throw new Error(`seed_run_${terminal[4].status}:${runId}`);
      if (fs.existsSync(path.join(dir, "failure.json"))) throw new Error("external_driver_failed");
      if (ws.readyState === WebSocket.CLOSED) throw new Error("seed_socket_closed");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("seed_wait_timeout");
  };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("seed_connect_timeout")), 10_000);
      ws.once("open", () => { clearTimeout(timer); resolve(); }); ws.once("error", reject);
    });
    const topic = `workspace:${trial.work_id}`;
    const push = (ref, event, body) => {
      const frame = ["1", ref, topic, event, body];
      fs.appendFileSync(path.join(dir, "protocol-seed.jsonl"), JSON.stringify({ at: new Date().toISOString(), trial: trial.id, direction: "sent", frame }) + "\n");
      ws.send(JSON.stringify(frame));
    };
    push("1", "phx_join", { work_id: trial.work_id, session_id: trial.session_id });
    const joined = await wait((f) => f[3] === "phx_reply" && f[1] === "1"); assert.equal(joined[4].status, "ok");
    for (const [index, kind] of ordered.entries()) {
      const ref = String(index + 2);
      push(ref, "user_message", { work_id: trial.work_id, session_id: trial.session_id, text: trial.inputs[kind],
        turn_id: `message_${randomUUID()}`, generate_micro_plan: false });
      const ack = await wait((f) => f[3] === "phx_reply" && f[1] === ref); assert.equal(ack[4].status, "ok");
      const runId = ack[4].response.run_id;
      const state = await wait((f) => f[3] === "agent_run_state" && f[4].run_id === runId && f[4].status === "awaiting_author", 120_000, runId);
      if (kind === "question") {
        await wait((f) => f[3] === "turn_result" && f[4].author_question?.run_id === runId, 30_000, runId);
      } else {
        assert.equal(state[4].profile_ref, "judgment_plan_v1", "plan seed 必须进入真实计划 profile");
        assert(received.some((f) => f[3] === "agent_event" && f[4].run_ref === runId && f[4].event_type === "awaiting_author" && f[4].reason_codes.includes("plan_exhausted_without_completion")), "plan seed 必须因计划耗尽等待");
        assert(!received.some((f) => f[3] === "turn_result" && f[4].author_question?.run_id === runId), "plan seed 不得变成明确问题");
      }
      trial.seed_runs[kind] = runId;
    }
  } finally { ws.close(); }
}

async function prepare() {
  assert(!fs.existsSync(path.join(dir, "b31-trials.json")), "不得覆盖已有批次");
  const trials = [], token = ready.run_ref.slice(0, 8);
  for (let n = 1; n <= 5; n++) {
    const id = `T${n}`, title = `B31 原生 ${id} ${token}`;
    const { work } = await request("/api/works", { title, genre: "赛博修仙", core_selling_point: "多个等待任务的输入归属", tone_preference: "冷静、清晰" });
    const session = await request(`/api/works/${work.id}/sessions/resume`);
    const trial = { id, title, work_id: work.id, session_id: session.active_session.id, seed_runs: {}, inputs: {
      question: `第一章字数太少了，标记UA01AWAITSTEER-${id}-${token}。`,
      plan: `先读完第01章正文，再调整章节大纲，最后更新主角当前状态，UA01PLANEXHAUST-${id}-${token}`,
      plan_b: `先读完第02章正文，再调整章节大纲，最后更新主角状态，UA01PLANEXHAUST-T5B-${token}`,
      plain: n <= 2 ? `处理重复第11章，只修正列表编号，保留你对已读正文的核对结论，B31CP2-${id}-${token}`
        : n <= 4 ? `我回答上面那个问题：直接在现有正文基础上扩写，增加细节，B31CP2-${id}-${token}`
          : `先保留当前计划，等我确认后再继续，B31CP2-T5A-${token}`,
      reply: replyText, steer: `按已核对结果先出方案，继续推进第一章结构调整，B31CP2-T5B-${token}` }, additional_replies: B31_STRUCTURE_REPLIES };
    if (n === 3) await seed(trial, ["plan", "question"]);
    if (n === 4) await seed(trial, ["question", "plan"]);
    if (n === 5) await seed(trial, ["plan", "plan_b"]);
    trials.push(trial); write("b31-setup-progress.json", trials);
  }
  write("b31-trials.json", trials); console.log(JSON.stringify(trials.map(({ id, title, inputs }) => ({ id, title, inputs })), null, 2));
}

async function verify() {
  const evidence = read("native-ui-complete.json"), trials = read("b31-trials.json");
  assert.deepEqual(trials.map((trial) => trial.id), ["T1", "T2", "T3", "T4", "T5"]);
  assert.equal(evidence.harness_run_ref, ready.run_ref); assert.equal(evidence.driver, "cua-native-system-ui");
  assert.equal(evidence.app_bundle, "com.ai-novel-studio.app"); assert.equal(ready.browser_driver_started, false);
  assert(!fs.existsSync(path.join(dir, "ui-frames.json")));
  const wire = lines("native-transport.jsonl"), received = wire.filter((r) => r.direction === "received" && !r.dropped);
  const sent = wire.filter((r) => r.direction === "sent");
  const workIds = new Set(trials.map((trial) => trial.work_id));
  const providerCalls = fs.readdirSync(path.join(dir, "app-log")).filter((name) => name.endsWith(".jsonl"))
    .flatMap((name) => lines(`app-log/${name}`)).filter((row) => row.event === "provider_gateway.complete.start" && workIds.has(row.work_id));
  assert(providerCalls.length > 0 && providerCalls.every((row) => row.provider === "slice_verify"), "本批只允许确定性替身调用");
  const ackRowFor = (row) => received.find((r) => r.at >= row.at && r.frame[1] === row.frame[1] && r.frame[2] === row.frame[2] && r.frame[3] === "phx_reply" && r.frame[4].status === "ok" && (row.frame[3] === "author_action"
    ? r.frame[4].response?.submission_id === row.frame[4].action.payload.submission_id && r.frame[4].response?.action_id === row.frame[4].action.action_id
    : r.frame[4].response?.turn_id === row.frame[4].turn_id));
  const ackFor = (row) => ackRowFor(row)?.frame[4].response;
  const stateOf = (runId, until = "9999") => received.filter((r) => r.at <= until && r.frame[3] === "agent_run_state" && r.frame[4].run_id === runId).at(-1)?.frame[4];
  const ax = (name) => { const file = path.join(dir, name); assert(fs.statSync(file).mtimeMs >= Date.parse(ready.ready_at)); return fs.readFileSync(file, "utf8"); };
  const results = [];
  const questionProof = new B31QuestionProof();
  for (const trial of trials) {
    const topic = `workspace:${trial.work_id}`, scoped = sent.filter((r) => r.frame[2] === topic);
    const inputs = scoped.filter((r) => r.frame[3] === "user_message");
    const runFor = (kind) => trial.seed_runs[kind] || ackFor(inputs.find((r) => r.frame[4].text === trial.inputs[kind]))?.run_id;
    const planId = runFor("plan"), questionId = trial.id === "T5" ? null : runFor("question");
    assert(planId); if (questionId) assert.notEqual(planId, questionId);
    const plains = inputs.filter((r) => r.frame[4].text === trial.inputs.plain);
    assert.equal(plains.length, trial.id === "T1" ? 2 : 1);
    assert.equal(new Set(plains.map((r) => ackFor(r)?.run_id)).size, plains.length);
    const snapshot = await snapshotFor(trial);
    write(`${trial.id}-verified-session.json`, snapshot);
    for (const row of plains) {
      const ack = ackFor(row); assert(ack?.run_id && ![planId, questionId, trial.seed_runs.plan_b].includes(ack.run_id));
      const persisted = snapshot.transcript.filter((r) => r.submission_id === row.frame[4].turn_id);
      assert.equal(persisted.length, 1); assert.equal(persisted[0].text, trial.inputs.plain); assert.equal(persisted[0].agent_run_id, ack.run_id);
    }
    if (trial.id !== "T5") {
      const actions = scoped.filter((r) => r.frame[3] === "author_action");
      const original = actions.filter((r) => r.frame[4].action.target_ref === questionId); assert.equal(original.length, 1);
      const row = original[0], action = row.frame[4].action, ack = ackFor(row);
      const question = snapshot.transcript.find((r) => r.turn_result?.author_question?.run_id === questionId)?.turn_result.author_question;
      assert(question); assert.equal(question.status, "answered");
      assert.equal(action.action_type, "author_choice"); assert.equal(action.target_ref, questionId);
      assert.equal(action.source_turn_ref, question.source_turn_ref); assert.equal(action.payload.question_ref, question.question_ref);
      assert.equal(action.payload.expected_goal_version, 1); assert.equal(action.payload.text, replyText);
      assert.equal(ack?.goal_version, 2); assert.equal(ack?.status, "accepted");
      assert.equal(stateOf(questionId, row.at)?.goal.version, 1); assert.equal(stateOf(planId)?.goal.version, 1);
      assert.equal(stateOf(questionId)?.status, "completed");
      assert.equal(scoped.filter((r) => r.frame[3] === "agent_command").length, 0);
      const replyRows = snapshot.transcript.filter((r) => r.submission_id === action.payload.submission_id);
      assert.equal(replyRows.length, 1); assert.equal(replyRows[0].text, replyText); assert.equal(replyRows[0].agent_run_id, questionId);
      const source = snapshot.transcript.find((r) => r.turn_result?.author_question?.question_ref === action.payload.question_ref)?.turn_result;
      questionProof.record({ source, action, receipt: ack, inputs: snapshot.transcript, at: row.at });
      assert(ax(`${trial.id}-before-reply.ax.txt`).includes("有任务正在等待你的问题回复"));
      const extras = actions.filter((r) => r.frame[4].action.target_ref !== questionId);
      if (["T1", "T2"].includes(trial.id)) {
        const plainIds = plains.map((r) => ackFor(r).run_id);
        const afterOriginal = read(`${trial.id}-after-original-reply.json`);
        assert(afterOriginal.captured_at >= ackRowFor(row).at);
        assert(!extras.length || afterOriginal.captured_at <= extras[0].at);
        const remaining = afterOriginal.snapshot.open_author_question_turn_results;
        const initialRefs = snapshot.transcript.filter((r) => plainIds.includes(r.agent_run_id) && r.turn_result?.author_question?.goal_version === 1).map((r) => r.turn_result.author_question.question_ref);
        assert.deepEqual(new Set(remaining.map((r) => r.author_question.question_ref)), new Set(initialRefs));
        assert(remaining.every((r) => r.author_question.status === "open" && r.author_question.goal_version === 1));
        if (remaining.length) {
          const visible = ax(`${trial.id}-after-original-reply.ax.txt`);
          assert(visible.includes("有任务正在等待你的问题回复"));
          assert(!/button(?: \([^)]+\))? 发送调整(?:\n|,|$)/m.test(visible));
        }
        for (const extra of extras) {
          const answer = extra.frame[4].action, receipt = ackFor(extra);
          assert(plainIds.includes(answer.target_ref), "不能回答测例之外的任务");
          const questionResult = snapshot.transcript.find((r) => r.turn_result?.author_question?.question_ref === answer.payload?.question_ref)?.turn_result;
          assert(questionResult && questionResult.author_question.status === "answered");
          questionProof.record({ source: questionResult, action: answer, receipt, inputs: snapshot.transcript, at: extra.at });
          const protectedIds = [planId, questionId, ...plainIds].filter((id) => id !== answer.target_ref);
          const versions = (at) => Object.fromEntries(protectedIds.map((id) => [id, stateOf(id, at)?.goal.version]));
          assertProtectedVersions(versions(extra.at), versions(ackRowFor(extra).at), protectedIds);
        }
        const closed = read(`${trial.id}-after-questions-closed.json`);
        assert(closed.captured_at >= (extras.at(-1) ? ackRowFor(extras.at(-1)).at : ackRowFor(row).at));
        assert.equal(closed.snapshot.open_author_question_turn_results.length, 0);
        assert(plainIds.every((id) => stateOf(id, closed.captured_at)?.status === "completed"), "不能以问题answered替代运行完成");
        assert.equal(stateOf(planId, closed.captured_at)?.goal.version, 1);
        assert.equal(stateOf(questionId, closed.captured_at)?.goal.version, 2);
        const visible = ax(`${trial.id}-after-questions-closed.ax.txt`);
        assert(/button(?: \([^)]+\))? 发送调整(?:\n|,|$)/m.test(visible) && !visible.includes("有任务正在等待你的问题回复"));
      } else assert.equal(extras.length, 0);
    } else {
      assert.equal(scoped.filter((r) => r.frame[3] === "author_action").length, 0);
      const cmds = scoped.filter((r) => r.frame[3] === "agent_command"); assert.equal(cmds.length, 1);
      const row = cmds[0], command = row.frame[4], ack = ackFor(row);
      assert.equal(command.command, "steer");
      assert.equal(command.run_id, planId); assert.equal(command.expected_goal_version, 1); assert.equal(command.text, trial.inputs.steer);
      assert.equal(ack?.resolved_run_id, planId); assert.equal(ack?.binding_source, "explicit_steer"); assert.equal(ack?.goal_version, 2);
      assert.equal(stateOf(trial.seed_runs.plan_b)?.goal.version, 1);
      const before = ax("T5-ambiguous.ax.txt"), focused = ax("T5-focused.ax.txt");
      assert(before.includes("当前有多个任务在进行") && before.includes("选择要继续的任务"));
      assert(focused.includes("将发给：「先读完第01章") && focused.includes("发送调整"));
    }
    results.push({ id: trial.id, work_id: trial.work_id, session_id: trial.session_id, plan_run_id: planId, question_run_id: questionId, plain_new_runs: plains.map((r) => ackFor(r).run_id) });
  }
  const t2 = results.find((r) => r.id === "T2"), journal = lines("native-driver-commands.jsonl");
  const windows = [1, 2, 3].map((i) => {
    const begin = journal.find((r) => r.op === "begin" && r.label === `T2-reload-${i}`), end = journal.find((r) => r.op === "finish" && r.id === begin?.id); assert(begin && end);
    const scope = received.filter((r) => Date.parse(r.at) >= begin.at && Date.parse(r.at) <= end.at && r.frame[3] === "agent_run_state" && [t2.plan_run_id, t2.question_run_id].includes(r.frame[4].run_id));
    const order = [...new Set(scope.map((r) => r.frame[4].run_id))]; assert.equal(order.length, 2);
    assert(ax(`T2-reload-${i}.ax.txt`).includes("有任务正在等待你的问题回复")); return order;
  });
  assert.deepEqual(windows[0], windows[1]); assert.deepEqual(windows[1], windows[2]);
  assert(evidence.screenshots.length >= 7);
  for (const name of evidence.screenshots) { const file = path.resolve(dir, name); assert(file.startsWith(dir + path.sep)); assert(fs.statSync(file).mtimeMs >= Date.parse(ready.ready_at)); const magic = fs.readFileSync(file).subarray(0, 8).toString("hex"); assert(magic.startsWith("ffd8ff") || magic === "89504e470d0a1a0a"); }
  write("summary.json", { slice_id: "b31-author-reply-run-binding", surface: "tauri", driver: evidence.driver, verified_at: new Date().toISOString(), trials: results, restore_orders: windows,
    screenshots: evidence.screenshots, author_question_events: questionProof.events, assertions: ["all_measured_inputs_from_native_ui", "plain_inputs_new_runs", "explicit_question_source_binding", "other_runs_untouched", "stable_restore_order", "visible_target_selection", "steer_version_and_receipt", "unique_persisted_inputs", "additional_questions_preserve_binding", "all_questions_closed_before_steer"] });
  write("author_question_events.json", questionProof.events);
  console.log("B31 原生五场景对账通过");
}
const run = () => mode === "prepare" ? prepare() : mode === "verify" ? verify() : mode === "capture" ? capture(...process.argv.slice(4)) : Promise.reject(new Error("unknown mode"));
run().catch((error) => {
  if (mode === "prepare" && !fs.existsSync(path.join(dir, "failure.json"))) {
    write("failure.json", { at: new Date().toISOString(), phase: "CP0-seed", reason: error.message });
  }
  console.error(error); process.exitCode = 1;
});
