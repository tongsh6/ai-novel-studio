// 外部驱动的回答/取消业务绑定；帧工厂复用现役维护 fixture，ACK 身份由共同 owner 核验。
import assert from "node:assert/strict";
import test from "node:test";
import { authorChoiceAckFor, cancelAckFor, requireSameSummaryTarget, requireProbeCandidate, requireProbePressure, requireActualProbeSource, requireProbeSourceClaim } from "./native_b71_auto_maintenance_drive.mjs";
import { interleavedResumeFacts } from "./lib/native_ui/fixtures/authoring_auto_maintenance_facts.mjs";
import { maintenanceRecoveryFacts } from "./lib/native_ui/fixtures/authoring_discussion_facts.mjs";

function answerAttempt() {
  const facts = interleavedResumeFacts();
  const wire = facts.wire.filter((record) => record.frame[3] !== "turn_result");
  const action = wire[0].frame[4].action, response = wire[1].frame[4].response;
  action.source_turn_ref = "turn-a";
  action.payload.text = "冻结的作者选择";
  Object.assign(response, { action_type: "author_choice", source_turn_ref: action.source_turn_ref });
  return { wire, options: { runId: facts.trace.waiting_run_id, wireStart: 0,
    expected: { question_ref: facts.trace.waiting_question_ref, goal_version: 1 },
    text: action.payload.text } };
}

test("A恢复只接受同问题/目标版本/逐字回答与唯一对应ACK", () => {
  const { wire, options } = answerAttempt();
  assert.equal(authorChoiceAckFor(wire, options).response.goal_version, 2);
  for (const mutate of [
    (rows) => { rows[0].frame[4].action.payload.text += "改"; },
    (rows) => { rows[0].frame[4].action.payload.expected_goal_version = 2; },
    (rows) => { rows[1].frame[4].response.source_turn_ref = "other-turn"; },
    (rows) => { rows[1].frame[4].response.question_ref = "other-question"; },
    (rows) => { rows[1].frame[0] = "other-join"; },
    (rows) => { rows[1].frame[4].response.duplicate = true; },
    (rows) => { rows.push(structuredClone(rows[0])); },
    (rows) => { rows.push(structuredClone(rows[1])); },
  ]) {
    const changed = structuredClone(wire);
    mutate(changed);
    assert.equal(authorChoiceAckFor(changed, options), null);
  }
  assert.equal(authorChoiceAckFor(wire, { ...options, wireStart: 1 }), null);
});

test("取消接受受理ACK仅证明同run命令，不把不同ref/拒绝/重复回包当受理", () => {
  const { wire, options } = answerAttempt();
  wire[0].frame[3] = "agent_command";
  wire[0].frame[4] = { run_id: options.runId, command: "cancel" };
  wire[1].frame[4] = { status: "ok", response: { received: true, run_id: options.runId, command: "cancel" } };
  assert.equal(cancelAckFor(wire, options).response.command, "cancel");
  for (const mutate of [
    (rows) => { rows[0].frame[4].run_id = "foreign"; },
    (rows) => { rows[1].frame[4].response.command = "pause"; },
    (rows) => { rows[1].frame[4].status = "error"; },
    (rows) => { rows[1].frame[1] = "other-ref"; },
    (rows) => { rows[1].at = "2026-11-04T09:59:59.000Z"; },
    (rows) => { rows.push(structuredClone(rows[1])); },
  ]) {
    const changed = structuredClone(wire);
    mutate(changed);
    assert.equal(cancelAckFor(changed, options), null);
  }
  assert.equal(cancelAckFor(wire, { ...options, wireStart: 1 }), null);
});

test("确认取消前摘要已结束或被另一执行替换时阻断命令，不切换目标", () => {
  const expected = { provider_run_ref: "summary-run", provider_call_ref: "summary-call" };
  let commandCount = 0;
  const confirm = (current) => { requireSameSummaryTarget(expected, current); commandCount += 1; };
  for (const current of [null, { ...expected, provider_run_ref: "later-summary" },
    { ...expected, provider_call_ref: "other-call" }]) {
    assert.throws(() => confirm(current), /summary_cancellation_target_no_longer_in_flight/);
    assert.equal(commandCount, 0);
  }
  confirm({ ...expected });
  assert.equal(commandCount, 1);
});

test("固定 C8 前置：旧三条来源不足，固定第11条后B才自然退出保护集", () => {
  const row = (id, sequence) => ({role:"assistant",provenance:"model",blocks:[{type:"text",text:id}],
    canonical_ref:{workspace_id:"ws",work_id:"w",session_id:"s",run_id:id,run_sequence:sequence,run_status:"completed"}});
  const rows=[row("B",4),row("A",15),row("verify",4),row("eleven",4)];
  const options={candidateRunId:"B",workId:"w",sessionId:"s",expectedCount:4};
  assert.throws(()=>requireProbeCandidate(rows.slice(0,3),[],options),/candidate_count/);
  const key=requireProbeCandidate(rows,[],options);
  assert.equal(key,'authoring-session-source/v1:["ws","w","s","B",4]');
  for (const mutate of [
    (r)=>{r[0].canonical_ref.run_status="awaiting_author";},
    (r)=>{r[0].canonical_ref.work_id="other";},
    (r)=>{r[0].blocks=[{type:"tool_call",name:"ask_author"}];},
    (r)=>{[r[0],r[1]]=[r[1],r[0]];},
  ]) {const changed=structuredClone(rows);mutate(changed);assert.throws(()=>requireProbeCandidate(changed,[],options));}
  assert.throws(()=>requireProbeCandidate(rows,[{owner_refs:JSON.stringify({operation:"transcript_compaction",discussion_source_keys:[key]})}],options),/already_owned/);
  const five=[...rows,row("C",4)];five[4].canonical_ref.run_status="cancelled";
  assert.equal(requireProbeCandidate(five,[{owner_refs:{operation:"transcript_compaction",discussion_source_keys:[key]}}],
    {...options,candidateRunId:"A",expectedCount:5}),'authoring-session-source/v1:["ws","w","s","A",15]');
  assert.throws(()=>requireProbeCandidate(rows,[],{...options,candidateRunId:"eleven"}),/protected/);
});
test("真实压力必须来自指定前序run的最后业务调用，不以摘要或旧峰值冒充", () => {
  const runs=[{id:"p",provider_call_ref:"c",agent_run_id:"eleven",owner_refs:{}}];
  const records=[{provider_run_ref:"p",provider_call_ref:"c",ts:"2026-11-18T00:00:00Z",
    response:{status:200,usage:{input_tokens:22400}}}];
  assert.equal(requireProbePressure(runs,records,"eleven").response.usage.input_tokens,22400);
  for(const mutate of [
    (r,c)=>{c[0].response.usage.input_tokens=22399;},
    (r,c)=>{c[0].response.usage.input_tokens="44689";},
    (r,c)=>{c[0].response.status=500;},
    (r)=>{r[0].agent_run_id="foreign";},
    (r)=>{r[0].owner_refs={operation:"transcript_compaction"};},
    (r,c)=>{r.push({...r[0],id:"later"});c.push({...c[0],provider_run_ref:"later",
      ts:"2026-11-18T00:01:00Z",response:{status:200,usage:{input_tokens:1200}}});},
  ]){const r=structuredClone(runs),c=structuredClone(records);mutate(r,c);
    assert.throws(()=>requireProbePressure(r,c,"eleven"),/probe_real_pressure_missing/);}
});

test("真实摘要必须经现役原文审计且恰为预注册来源，不接受有摘要即可", () => {
  const scenario=maintenanceRecoveryFacts();
  const facts=scenario.facts.afterFailure, runId=scenario.injection.failure_request.run_id;
  const key=facts.provider_runs[0].owner_refs.discussion_source_keys[0];
  // 在途阶段只能确认 claim，缺事后 request 不得伪装成完成审计。
  assert.equal(requireProbeSourceClaim(facts,runId,key).id,facts.provider_runs[0].id);
  requireActualProbeSource(facts,scenario.records,runId,key);
  assert.throws(()=>requireActualProbeSource(facts,scenario.records,runId,"other"),/candidate_mismatch/);
  assert.throws(()=>requireActualProbeSource(facts,[],runId,key),/request_missing/);
  const duplicate=structuredClone(facts);duplicate.provider_runs.push({...duplicate.provider_runs[0],id:"other"});
  assert.throws(()=>requireActualProbeSource(duplicate,scenario.records,runId,key),/attempt_not_unique/);
  const changed=structuredClone(scenario.records);
  changed.find(r=>r.provider_run_ref===facts.provider_runs[0].id).turn_id="foreign";
  assert.throws(()=>requireActualProbeSource(facts,changed,runId,key),/owner_mismatch/);
});
