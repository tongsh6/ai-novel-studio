// B71 pending 运行证据 I/O 边界：命名 checkpoint 读取与 capture 写入前校验。
// 不启动 GUI/Mix，不写产品路径；完整 DB/WS 链路由 native_b71_pending_test 回归。
//
// 每个反例需要独立的可写 config/checkpoint 目录，属于 case 级独立状态，不共享只读
// 模板；目录统一落在外层 run scope 的 work 区，由 scope 退出时回收，不再落系统
// TMPDIR 裸目录。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  capturePending,
  providerContentFor,
  pendingRuntimeChecks,
  writerValidationPassed,
  readPendingCheckpoint,
} from "./authoring_pending_run_evidence.mjs";
import { openTestRunScope } from "../test_env.mjs";
import * as pendingEvidence from "./authoring_pending_run_evidence.mjs";

let runScope;

test.before(() => {
  runScope = openTestRunScope();
});

test.after(() => {
  runScope?.close();
});

function tempDir() {
  return fs.mkdtempSync(path.join(runScope.workDir, "b71-pending-run-evidence-"));
}

function writeConfig(dir, value) {
  fs.writeFileSync(path.join(dir, "native-b71-config.json"), JSON.stringify(value));
}

test("readPendingCheckpoint 只按名称读取本批次 checkpoint，缺失显式失败", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "b71-start.json"), JSON.stringify({ checkpoint: "start", n: 1 }));
  assert.deepEqual(readPendingCheckpoint(dir, "start"), { checkpoint: "start", n: 1 });
  assert.throws(() => readPendingCheckpoint(dir, "missing"), /ENOENT/);
});

test("capturePending 在写 DB 前拒绝错 journey/未知 checkpoint/覆盖/跳步", () => {
  const wrongJourney = tempDir();
  writeConfig(wrongJourney, { journey: "other" });
  assert.throws(() => capturePending(wrongJourney, "start"), /pending capture 只属于/);

  const unknown = tempDir();
  writeConfig(unknown, { journey: "pending" });
  assert.throws(() => capturePending(unknown, "nope"), /未知 pending checkpoint/);

  const overwrite = tempDir();
  writeConfig(overwrite, { journey: "pending" });
  fs.writeFileSync(path.join(overwrite, "b71-start.json"), "{}");
  assert.throws(() => capturePending(overwrite, "start"), /不得覆盖/);

  const skip = tempDir();
  writeConfig(skip, { journey: "pending" });
  assert.throws(() => capturePending(skip, "after-source"), /必须在 start 之后登记/);
});


function acceptWhyProof() {
  const workId = "work-accept", sessionId = "session-accept";
  const action = { action_id: "accept:artifact-revision", action_type: "accept",
    idempotency_key: "idem-accept", source_turn_ref: "turn-revision", target_ref: "artifact-revision" };
  const state = { event_type: "candidate_adopted", production_write_performed: true,
    action_turn_ref: "turn_adopt-current", source_turn_ref: "turn-revision",
    artifact_id: "artifact-revision", candidate_ref: "artifact-revision",
    adopted_state_ref: "memory-accepted", state_trace_ref: "state-accepted",
    mutation_ref: "mutation-accepted", source_revision_ref: "mutation:mutation-accepted" };
  const turnResult = { work_id: workId, session_id: sessionId, turn_id: "turn_adopt-current",
    parent_turn_id: "turn-revision", trace_summary: { state_trace_ref: "state-accepted", state_trace_refs: [state] },
    adoption_state: { resolved: [{ artifact_id: "artifact-revision", adoption_status: "ACCEPTED",
      adopted_state_ref: "memory-accepted", state_trace_ref: "state-accepted", mutation_ref: "mutation-accepted" }] } };
  const receipt = { id: "receipt-accepted", work_id: workId, session_id: sessionId,
    action_id: action.action_id, action_type: "accept", idempotency_key: action.idempotency_key,
    source_turn_ref: action.source_turn_ref, status: "accepted",
    result: { action_id: "adopt:artifact-revision", action_type: "adopt", artifact_id: "artifact-revision",
      decision: "ACCEPTED", status: "accepted", persistence: { persisted: true, memory_status: "CONFIRMED",
        memory_item_id: "memory-accepted", mutation_id: "mutation-accepted", source_revision_ref: "mutation:mutation-accepted" } } };
  const before = { at: "2026-11-24T06:00:01.000Z", llm_count: 3, provider_start_count: 3,
    db_counts: { provider_runs: 3, agent_runs: 2 }, memory_items: [{ id: "memory-accepted", content: "作者原文", reference_count: 0 }],
    receipts: [structuredClone(receipt)], canon: { at: "2026-11-24T06:00:01.000Z",
      tables: { memory_items: { row_count: 1, rows_sha256: "rows", canon_sha256: "canon" } }, memory_reference_logs: [] } };
  const after = structuredClone(before);
  after.at = after.canon.at = "2026-11-24T06:00:03.000Z";
  const body = { work_id: workId, session_id: sessionId, turn_id: turnResult.turn_id,
    trace_summary: { state_trace_refs: [structuredClone(state)], replay_provider_called: false } };
  const wire = [{ at: "2026-11-24T06:00:02.000Z", direction: "http", method: "GET", status: 200,
    path: "/api/works/work-accept/sessions/session-accept/turns/turn_adopt-current/replay",
    scope: { kind: "replay", work_id: workId, session_id: sessionId, turn_id: turnResult.turn_id },
    body_state: { complete: true, json: "valid" }, body }];
  return { wire, checkpoints: { "before-accept-why": before, "after-accept-why": after },
    action, turnResult, receipt, workId, sessionId };
}

test("采纳 Why 绑定真实 action Replay、状态引用及持久 receipt，观察窗口零额外效果", () => {
  const checks = pendingEvidence.acceptWhyChecks(acceptWhyProof());
  assert(Object.values(checks).every(Boolean), JSON.stringify(checks));
});

test("采纳 Why 拒绝错绑、额外引用、重放调用和观察窗口写入", async (t) => {
  const mutations = {
    "生成轮 Replay": f => { f.wire[0].path = f.wire[0].path.replace("turn_adopt-current", "turn-revision"); },
    "HTTP 错作品": f => { f.wire[0].body.work_id = "other"; },
    "HTTP 错会话": f => { f.wire[0].body.session_id = "other"; },
    "HTTP 错动作轮": f => { f.wire[0].body.turn_id = "other"; },
    "capture 错 scope": f => { f.wire[0].scope.turn_id = "other"; },
    "重复 Replay": f => { f.wire.push(structuredClone(f.wire[0])); },
    "动作错 parent": f => { f.turnResult.parent_turn_id = "other"; },
    "动作错 work": f => { f.turnResult.work_id = "other"; },
    "动作错 session": f => { f.turnResult.session_id = "other"; },
    "错 action ref": f => { f.wire[0].body.trace_summary.state_trace_refs[0].action_turn_ref = f.turnResult.trace_summary.state_trace_refs[0].action_turn_ref = "other"; },
    "错 source ref": f => { f.wire[0].body.trace_summary.state_trace_refs[0].source_turn_ref = f.turnResult.trace_summary.state_trace_refs[0].source_turn_ref = "other"; },
    "错 artifact ref": f => { f.wire[0].body.trace_summary.state_trace_refs[0].artifact_id = f.turnResult.trace_summary.state_trace_refs[0].artifact_id = "other"; },
    "错 adopted ref": f => { f.wire[0].body.trace_summary.state_trace_refs[0].adopted_state_ref = f.turnResult.trace_summary.state_trace_refs[0].adopted_state_ref = "other"; },
    "重复采纳 ref": f => { f.wire[0].body.trace_summary.state_trace_refs.push(structuredClone(f.wire[0].body.trace_summary.state_trace_refs[0])); },
    "没有生产写入": f => { f.wire[0].body.trace_summary.state_trace_refs[0].production_write_performed = false; },
    "receipt 内部状态相反": f => { f.receipt.result.status = "discarded"; },
    "receipt 错 memory": f => { f.receipt.result.persistence.memory_item_id = "other"; },
    "receipt 错 mutation": f => { f.receipt.result.persistence.mutation_id = "other"; },
    "resolved 错 state": f => { f.turnResult.adoption_state.resolved[0].state_trace_ref = "other"; },
    "Replay 重新调模型": f => { f.wire[0].body.trace_summary.replay_provider_called = true; },
    "多 LLM 日志": f => { f.checkpoints["after-accept-why"].llm_count++; },
    "多 Provider start": f => { f.checkpoints["after-accept-why"].provider_start_count++; },
    "多 Provider run": f => { f.checkpoints["after-accept-why"].db_counts.provider_runs++; },
    "多 Agent run": f => { f.checkpoints["after-accept-why"].db_counts.agent_runs++; },
    "Canon 行发生变化": f => { f.checkpoints["after-accept-why"].canon.tables.memory_items.rows_sha256 = "changed"; },
    "原文变化": f => { f.checkpoints["after-accept-why"].memory_items[0].content = "另一个正文"; },
    "引用计数变化": f => { f.checkpoints["after-accept-why"].memory_items[0].reference_count++; },
    "引用日志增加": f => { f.checkpoints["after-accept-why"].canon.memory_reference_logs.push({ id: "extra" }); },
    "回执增加": f => { f.checkpoints["after-accept-why"].receipts.push({ id: "extra" }); },
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, () => {
    const f = acceptWhyProof();
    mutate(f);
    assert(Object.values(pendingEvidence.acceptWhyChecks(f)).some(value => !value), name);
  });
});

// SSE 原日志只记录工具事实；成功正文的独立事实来自持久 ProviderOutput 的 SHA。
// 期望正文在夹具中预先给定，不能从待检 canonical 消息反推输出行。
function replyProof() {
  const reply = "已采纳修订稿；原稿已放弃。\r\n";
  const scope = { id: "run-reply", workspace_id: "workspace-reply", work_id: "work-reply",
    session_id: "session-reply", parent_turn_ref: "turn-reply", status: "completed" };
  const assistant = { role: "assistant", provenance: "model", provider_call_ref: "pcall-reply",
    provider_run_ref: "prun-reply", blocks: [{ type: "text", text: reply }] };
  const record = { provider_call_ref: "pcall-reply", provider_run_ref: "prun-reply",
    agent_run_id: "run-reply", work_id: "work-reply", session_id: "session-reply",
    turn_id: "turn-reply", response: { status: 200, body: { source: "sse_decoder", tool_calls: [] } } };
  const output = { provider_run_id: "prun-reply", provider_call_ref: "pcall-reply",
    agent_run_id: "run-reply", status: "ok",
    content_summary: JSON.stringify({ content_sha256: createHash("sha256")
      .update("已采纳修订稿；原稿已放弃。\r\n").digest("hex") }) };
  const row = { id: "prun-reply", provider_call_ref: "pcall-reply", agent_run_id: "run-reply",
    workspace_id: "workspace-reply", work_id: "work-reply", session_id: "session-reply",
    parent_turn_ref: "turn-reply", status: "completed", recorded_outputs: [output] };
  return { reply, history: { record: scope, transcript: { messages: [assistant] } },
    records: [record], providerRuns: [row] };
}

test("pending SSE 正文绑定唯一已完成的持久输出 SHA，保留末尾原字节", () => {
  const f = replyProof();
  assert.equal(providerContentFor(f.history, f.records, f.providerRuns, f.reply), f.reply);
  // 当前 run 可先探索/校验，再给出作者可见回复；不能取第一个 assistant。
  f.history.transcript.messages.unshift({ role: "assistant", provenance: "model",
    provider_call_ref: "pcall-explore", provider_run_ref: "prun-explore",
    blocks: [{ type: "tool_call", call_id: "explore", name: "judgment_decision", arguments: { action: "explore" } }] });
  assert.equal(providerContentFor(f.history, f.records, f.providerRuns, f.reply), f.reply);
});

test("pending SSE 缺失、错绑、重复或失败的输出不能借日志正文授信", async (t) => {
  const mutations = {
    missing_output: f => { f.providerRuns[0].recorded_outputs = []; },
    hash_mismatch: f => { f.providerRuns[0].recorded_outputs[0].content_summary = JSON.stringify({ content_sha256: "0".repeat(64) }); },
    malformed_summary: f => { f.providerRuns[0].recorded_outputs[0].content_summary = "{"; },
    duplicate_output: f => { f.providerRuns[0].recorded_outputs.push(structuredClone(f.providerRuns[0].recorded_outputs[0])); },
    output_other_run: f => { f.providerRuns[0].recorded_outputs[0].agent_run_id = "other-run"; },
    output_other_prun: f => { f.providerRuns[0].recorded_outputs[0].provider_run_id = "other-prun"; },
    output_other_call: f => { f.providerRuns[0].recorded_outputs[0].provider_call_ref = "other-call"; },
    output_failed: f => { f.providerRuns[0].recorded_outputs[0].status = "error"; },
    provider_failed: f => { f.providerRuns[0].status = "failed"; },
    history_running: f => { f.history.record.status = "running"; },
    provider_other_run: f => { f.providerRuns[0].agent_run_id = "other-run"; },
    provider_other_work: f => { f.providerRuns[0].work_id = "other-work"; },
    provider_other_session: f => { f.providerRuns[0].session_id = "other-session"; },
    provider_other_parent: f => { f.providerRuns[0].parent_turn_ref = "other-turn"; },
    provider_duplicate_call: f => { f.providerRuns.push({ ...f.providerRuns[0], id: "other-prun" }); },
    provider_duplicate_prun: f => { f.providerRuns.push({ ...f.providerRuns[0], provider_call_ref: "other-call" }); },
    record_duplicate: f => { f.records.push(structuredClone(f.records[0])); },
    record_other_run: f => { f.records[0].agent_run_id = "other-run"; },
    record_error: f => { f.records[0].response.status = 500; },
    canonical_duplicate: f => { f.history.transcript.messages.push(structuredClone(f.history.transcript.messages[0])); },
    canonical_other_call: f => { f.history.transcript.messages[0].provider_call_ref = "other-call"; },
    canonical_changed_bytes: f => { f.history.transcript.messages[0].blocks[0].text = f.reply.trim(); },
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, () => {
    const f = replyProof();
    // 实际 SSE logger 不提供正文；即使后补一个相同字符串，也不能顶替独立持久输出。
    f.records[0].response.body.content = f.reply;
    mutate(f);
    assert.equal(providerContentFor(f.history, f.records, f.providerRuns, f.reply), null);
  });
});

test("pending 实模运行、持久行与真实请求共同绑定冻结模型参数，普通 Writer 无8192例外", () => {
  const config = { provider: "splash", preregistration: { model: "local/Q4-PLE4" },
    budget: { batches: 1, author_sends: 3, manual_retries: 0, scenario_seconds: 900,
      input_timeout_ms: 30000, turn_timeout_ms: 240000 },
    runtime: { profile: "b87-r03-splash-product-maintenance-budget",
      observed: { provider: { selected: "splash", model: "local/Q4-PLE4", endpoint: "http://127.0.0.1:8000/v1" } } } };
  const ready = { provider: "splash" }, driver = { provider: "splash", model: "local/Q4-PLE4",
    runtime_profile: "b87-r03-splash-product-maintenance-budget", budget: structuredClone(config.budget) };
  const phase = index => ({ providerRuns: [{ id: `prun-${index}`, provider_call_ref: `pcall-${index}`,
    provider_id: "splash", model: "local/Q4-PLE4", purpose: "world_building" }],
    calls: { checks: { ownership: true }, records: [{ provider: "splash",
      provider_call_ref: `pcall-${index}`, provider_run_ref: `prun-${index}`,
      request: { url: "http://127.0.0.1:8000/v1/chat/completions",
        body: { model: "local/Q4-PLE4", reasoning_effort: "high", max_tokens: 32000,
          messages: [{ role: "user", content: "已冻结的作者原文" }], tools: [] } } }] } });
  const phases = [phase(1), phase(2), phase(3)];
  const proof = () => ({ config: structuredClone(config), ready: structuredClone(ready),
    driver: structuredClone(driver), phases: structuredClone(phases) });
  const ok = p => Object.values(pendingRuntimeChecks(p.config, p.ready, p.driver, p.phases)).every(Boolean);
  assert.equal(ok(proof()), true);
  for (const mutate of [
    p => { p.ready.provider = "strata"; },
    p => { p.driver.model = "other"; },
    p => { p.config.runtime.observed.provider.model = "other"; },
    p => { p.phases[1].providerRuns[0].model = "other"; },
    p => { p.phases[1].calls.records[0].request.body.model = "other"; },
    p => { p.phases[1].calls.records[0].request.url = "http://other/v1/chat/completions"; },
    p => { p.phases[1].calls.records[0].request.body.reasoning_effort = "low"; },
    p => { p.phases[1].calls.records[0].request.body.max_tokens = 8192; },
    p => { p.phases[1].calls.checks.ownership = false; },
    p => { p.phases[1].providerRuns.push({ ...p.phases[1].providerRuns[0], id: "other-prun" }); },
  ]) {
    const p = proof(); mutate(p); assert.equal(ok(p), false);
  }
  const compact = proof(), row = compact.phases[1].providerRuns[0];
  row.purpose = "other"; row.owner_refs = JSON.stringify({ operation: "transcript_compaction" });
  compact.phases[1].calls.records[0].request.body.max_tokens = 8192;
  assert.equal(ok(compact), true);
  row.purpose = "world_building";
  assert.equal(ok(compact), false);
});


test("冻结普通修订只替换唯一姓名，标题和理由仍由既有 Writer 字段证据签字", () => {
  const source = "把这份大纲直接存档为作品设定：主角沈砚经营旧书铺。校验标识a1b2c3d4e5f60718。";
  const revised = "把这份大纲直接存档为作品设定：主角林渡经营旧书铺。校验标识a1b2c3d4e5f60718。";
  assert.equal(typeof pendingEvidence.revisionBodyPreserved, "function");
  assert.equal(pendingEvidence.revisionBodyPreserved(source, revised), true);
  for (const body of [
    source,
    "把这份大纲直接存档为作品设定：主角林渡。校验标识a1b2c3d4e5f60718。",
    "把这份大纲直接存档为作品设定：主角林渡经营旧书铺。校验标识a1b2c3d4e5f60719。",
    revised + "\n",
    " " + revised,
  ]) assert.equal(pendingEvidence.revisionBodyPreserved(source, body), false);
  assert.equal(pendingEvidence.revisionBodyPreserved("沈砚见到沈砚。", "林渡见到林渡。"), false);
  assert.equal(pendingEvidence.revisionBodyPreserved("", revised), false);
  assert.equal(pendingEvidence.revisionBodyPreserved(source, null), false);
});

test("Writer 校验只授信当前候选来源；先失败后合法纠错保留两次尝试而不误拒", () => {
  const attempt = (pcall, callId, status) => [
    { role: "assistant", provenance: "model", provider_call_ref: pcall,
      blocks: [{ type: "tool_call", name: "submit_tentative_artifact", call_id: callId, arguments: {} }] },
    { role: "tool", provenance: "tool_result",
      blocks: [{ type: "validation_result", call_id: callId, status }] },
  ];
  const history = { transcript: { messages: [
    ...attempt("pcall-rejected", "call-rejected", "failed"),
    ...attempt("pcall-returned", "call-returned", "passed"),
  ] } };
  assert.equal(writerValidationPassed(history, "pcall-returned"), true);
  assert.equal(writerValidationPassed(history, "pcall-rejected"), false);
  assert.equal(writerValidationPassed(history, "pcall-missing"), false);
  assert.equal(writerValidationPassed(history, undefined), false);
  history.transcript.messages.push(structuredClone(history.transcript.messages[3]));
  assert.equal(writerValidationPassed(history, "pcall-returned"), false);
});
