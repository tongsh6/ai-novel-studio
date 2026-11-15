// B26 核验器的真实 CLI/loopback HTTP 边界。输入全部为 owned test_env 内合成证据，
// 不启动产品、UI 或模型，不访问作者数据库；通过仅代表核验器回归通过。
// 每例独立物化文件，异步 runInScope 保持 HTTP 可响应并负责子进程登记、超时和收口。
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openTestRunScope, runInScope } from "./lib/test_env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CHECKER = path.join(HERE, "native_question_evidence_check.mjs");
const READY_AT = "2026-11-02T02:00:00.000Z";
const WORK = "synthetic-question-work";
const SESSION = "synthetic-question-session";
const TOPIC = "workspace:" + WORK;

let runScope;
test.before(() => {
  runScope = openTestRunScope();
});
test.after(() => {
  runScope?.close();
});

function fixtureData() {
  const roundtrips = ["choice", "free_text"].map((kind) => ({
    reply_kind: kind,
    run_id: "run-" + kind,
    question_ref: "question-" + kind,
    action_id: "action-" + kind,
    submission_id: "submission-" + kind,
    answer_text: kind === "choice" ? "追查信件的来源" : " 保留原始空白。\n另补一条线索。 ",
  }));
  const transcript = [];
  const wire = [];
  const records = [];
  for (const [index, round] of roundtrips.entries()) {
    const sourceTurn = "turn-" + round.reply_kind;
    const at = (offset) => new Date(Date.parse(READY_AT) + index * 10_000 + offset).toISOString();
    const sourceAction = {
      action_id: round.action_id,
      action_type: "author_choice",
      target_ref: round.run_id,
      source_turn_ref: sourceTurn,
      response_kind: round.reply_kind,
      label: round.reply_kind === "choice" ? round.answer_text : "补充说明",
      candidate_ref: round.reply_kind === "choice" ? "choice-1" : null,
      idempotency_key: "reply-key-" + round.reply_kind,
      enabled: false,
      question_ref: round.question_ref,
      expected_goal_version: 1,
    };
    transcript.push({
      id: "question-row-" + round.reply_kind,
      role: "assistant",
      agent_run_id: round.run_id,
      turn_result: {
        status: round.reply_kind === "choice" ? "needs_selection" : "needs_clarification",
        author_question: {
          question_ref: round.question_ref,
          source_turn_ref: sourceTurn,
          run_id: round.run_id,
          goal_version: 1,
          status: "answered",
          submission_id: round.submission_id,
        },
        available_actions: [sourceAction],
      },
    }, {
      id: "reply-row-" + round.reply_kind,
      role: "user",
      submission_id: round.submission_id,
      agent_run_id: round.run_id,
      text: round.answer_text,
      inserted_at: at(1_001),
    });
    const action = {
      ...sourceAction,
      enabled: true,
      payload: {
        question_ref: sourceAction.question_ref,
        expected_goal_version: sourceAction.expected_goal_version,
        submission_id: round.submission_id,
        ...(round.reply_kind === "free_text" ? { text: round.answer_text } : {}),
      },
    };
    const requestRef = String(index + 2);
    wire.push(
      {
        at: at(1_000),
        direction: "sent",
        frame: ["1", requestRef, TOPIC, "author_action", {
          work_id: WORK, session_id: SESSION, action,
        }],
      },
      {
        at: at(1_001),
        direction: "received",
        frame: ["1", requestRef, TOPIC, "phx_reply", {
          status: "ok",
          response: {
            received: true, duplicate: false, action_id: round.action_id,
            submission_id: round.submission_id, run_id: round.run_id, goal_version: 2,
          },
        }],
      },
      {
        at: at(2_000),
        direction: "received",
        frame: [null, null, TOPIC, "agent_run_state", {
          run_id: round.run_id, parent_turn_ref: sourceTurn, status: "completed",
          goal: { text: round.answer_text, version: 2 },
          consumed_budget: { provider_calls: 2, tool_calls: 0 },
        }],
      },
    );
    records.push({
      event: "channel.author_action.done",
      action_id: round.action_id,
      target_ref: round.run_id,
      action_status: "accepted",
    });
  }
  return {
    ready: {
      driver: "external-system-ui", browser_driver_started: false,
      run_ref: "synthetic-question-batch", ready_at: READY_AT,
    },
    evidence: {
      harness_run_ref: "synthetic-question-batch",
      driver: "ax-native-system-ui", app_bundle: "com.ai-novel-studio.app",
      work_id: WORK, session_id: SESSION, roundtrips, screenshots: ["shot.png"],
    },
    snapshot: {
      transcript, transcript_page: { has_more_before: false },
      open_author_question_turn_results: [],
    },
    wire,
    records,
  };
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

async function runFixture(t, mutate = () => {}) {
  const dir = fs.mkdtempSync(path.join(runScope.workDir, "question-checker-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const data = fixtureData();
  mutate(data);
  const requests = [];
  const route = "/api/works/" + WORK + "/sessions/" + SESSION;
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    response.setHeader("content-type", "application/json");
    if (request.method !== "GET" || request.url !== route) {
      response.writeHead(404).end(JSON.stringify({ error: "unknown synthetic route" }));
      return;
    }
    response.end(JSON.stringify(data.snapshot));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  data.ready.api_url = "http://127.0.0.1:" + server.address().port;
  writeJson(path.join(dir, "native-driver-ready.json"), data.ready);
  writeJson(path.join(dir, "native-ui-complete.json"), data.evidence);
  // 合成图片仅服务文件/魔数判据，不能充当真实窗口截图。
  fs.writeFileSync(path.join(dir, "shot.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  fs.writeFileSync(path.join(dir, "native-transport.jsonl"),
    data.wire.map(row => JSON.stringify(row)).join("\n") + "\n");
  const logsDir = path.join(dir, "app-log");
  fs.mkdirSync(logsDir);
  fs.writeFileSync(path.join(logsDir, "question.jsonl"),
    data.records.map(row => JSON.stringify(row)).join("\n") + "\n");
  const result = await runInScope(runScope, process.execPath, [CHECKER, dir, logsDir], {
    cwd: ROOT, timeoutMs: 15_000, stdio: ["ignore", "pipe", "pipe"],
  });
  return { dir, data, requests, result };
}

test("合成 B26 CLI 正例按真实动作、持久字节与回复后 completed 生成 summary", async (t) => {
  const { dir, data, requests, result } = await runFixture(t);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.child_exit_code, 0);
  assert.equal(result.timed_out, false);
  assert.deepEqual(requests, [{ method: "GET", url: "/api/works/" + WORK + "/sessions/" + SESSION }]);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.slice_id, "b26-author-question-roundtrip");
  assert.equal(summary.harness_run_ref, data.ready.run_ref);
  assert.equal(summary.work_id, WORK);
  assert.equal(summary.session_id, SESSION);
  assert.deepEqual(summary.roundtrips, data.evidence.roundtrips);
  assert(summary.assertions.includes("reply_run_completed_after_submission"));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "verified-session.json"), "utf8")),
    data.snapshot);
});

test("普通回复按实际 source goal 递增，不把 completed 固定到 version 2", async (t) => {
  const { dir, result } = await runFixture(t, (data) => {
    const source = data.snapshot.transcript[0].turn_result;
    source.author_question.goal_version = 3;
    source.available_actions[0].expected_goal_version = 3;
    data.wire[0].frame[4].action.payload.expected_goal_version = 3;
    data.wire[1].frame[4].response.goal_version = 4;
    data.wire[2].frame[4].goal.version = 4;
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert(fs.existsSync(path.join(dir, "summary.json")));
});

test("同 submission 的真实 ACK 丢失重传复用首次有效回复和一次持久输入", async (t) => {
  const { dir, result } = await runFixture(t, (data) => {
    const submission = data.evidence.roundtrips[0].submission_id;
    data.evidence.transport_replay = { submission_id: submission };
    const lost = data.wire[1];
    lost.dropped = true;
    lost.fault = "ack_lost_and_disconnected";
    lost.submission_id = submission;
    lost.response = structuredClone(lost.frame[4]);
    const resend = structuredClone(data.wire[0]);
    resend.at = "2026-11-02T02:00:30.000Z";
    resend.frame[0] = "new-join";
    resend.frame[1] = "replay-request";
    const reply = structuredClone(lost);
    reply.at = "2026-11-02T02:00:30.001Z";
    reply.dropped = false;
    delete reply.fault;
    delete reply.response;
    reply.frame[0] = resend.frame[0];
    reply.frame[1] = resend.frame[1];
    reply.frame[4].response.duplicate = true;
    data.wire.push(resend, reply);
  });
  assert.equal(result.exitCode, 0, result.stderr);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert(summary.assertions.includes("native_ack_loss_same_submission_replayed_once"));
  assert(summary.assertions.includes("native_reply_no_duplicate_provider_or_business_calls"));
});

const invalidCases = [
  ["无截图", data => { data.evidence.screenshots = []; }],
  ["仍 awaiting_author", data => { data.wire[2].frame[4].status = "awaiting_author"; }],
  ["只有回复前旧 completed", data => {
    const previous = data.wire.splice(2, 1)[0];
    previous.at = READY_AT;
    data.wire.unshift(previous);
  }],
  ["completed 后最后状态又等待作者", data => {
    const latest = structuredClone(data.wire[2]);
    latest.at = "2026-11-02T02:00:30.000Z";
    latest.frame[4].status = "awaiting_author";
    data.wire.push(latest);
  }],
  ["其他 run 的 completed", data => { data.wire[2].frame[4].run_id = "unrelated-run"; }],
  ["只有发送方向终态", data => { data.wire[2].direction = "sent"; }],
  ["终态已 dropped", data => { data.wire[2].dropped = true; }],
  ["其他 topic 的 completed", data => { data.wire[2].frame[2] = "workspace:other"; }],
  ["completed 未消费本次目标版本", data => { data.wire[2].frame[4].goal.version = 1; }],
  ["缺真实 author_action", data => { data.wire.shift(); }],
  ["发送的作者动作已 dropped", data => { data.wire[0].dropped = true; }],
  ["持久输入早于本次发送", data => { data.snapshot.transcript[1].inserted_at = READY_AT; }],
  ["源问题由其他 submission 回答", data => {
    data.snapshot.transcript[0].turn_result.author_question.submission_id = "unrelated-submission";
  }],
  ["author_action 属于其他 submission", data => {
    data.wire[0].frame[4].action.payload.submission_id = "unrelated-submission";
  }],
  ["重复同一次回复冒充两种回答", data => {
    data.evidence.roundtrips[1] = { ...data.evidence.roundtrips[0], reply_kind: "free_text" };
  }],
  ["round 自报的回答类型与源动作相反", data => {
    data.evidence.roundtrips[0].reply_kind = "free_text";
    data.evidence.roundtrips[1].reply_kind = "choice";
  }],
  ["自由回复帧改写原文字节", data => {
    data.wire[3].frame[4].action.payload.text = "改写后的内容";
  }],
  ["选项回复使用其他 candidate", data => {
    data.wire[0].frame[4].action.candidate_ref = "unrelated-candidate";
  }],
  ["作者动作目标版本不属于源问题", data => {
    data.snapshot.transcript[0].turn_result.author_question.goal_version = 2;
  }],
];

for (const [label, mutate] of invalidCases) {
  test("合成 B26 CLI 拒绝" + label + "且不产出成功 summary", async (t) => {
    const { dir, result } = await runFixture(t, mutate);
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.child_exit_code, 1);
    assert.equal(result.timed_out, false);
    assert.equal(result.tree_error, undefined);
    assert.match(result.stderr, /AssertionError/);
    assert.equal(fs.existsSync(path.join(dir, "summary.json")), false);
    assert.equal(fs.existsSync(path.join(dir, "verified-session.json")), false);
  });
}
