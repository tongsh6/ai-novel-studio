// R03 预注册批次直接判据：固定作者/讨论字节独立于被测覆盖与报告计算。
// 合成事实只验证机械缺证/反例；模型义务语义、真实 UI、恢复仍不得由此签字。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { auditSubjectWindowBoundary, evaluatePreregisteredCompaction } from "./request_cost_compaction_evidence.mjs";
import { canonicalMessagesFromRows, composeSessionMessages } from "./authoring_history_evidence.mjs";
import { checkpointWire, discussionMaintenanceFacts } from "./fixtures/authoring_discussion_facts.mjs";
import { autoMaintenanceConfig } from "./fixtures/authoring_auto_maintenance_facts.mjs";
import { scopeWireMessage } from "./fixtures/authoring_request_ir.mjs";

const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const text = (body) => body.blocks.map((block) => block.text ?? "").join("");
const wire = (record) => record.request.body.messages;
const finalRecord = (input) => input.records.find((record) => record.provider_call_ref === "pcall-after");

function refreshHistory(input) {
  const messages = canonicalMessagesFromRows(input.dbFacts.authoring_session_messages, input.dbFacts.agent_runs);
  for (const binding of [...input.bindings, input.successorBinding]) {
    if (binding) binding.history.sessionMessages = composeSessionMessages(messages, binding.root.id);
  }
}

function changeCheckpoint(input, change) {
  const row = input.dbFacts.authoring_session_messages.find((item) => item.role === "checkpoint");
  const message = JSON.parse(row.message);
  change(message.blocks[0]);
  row.message = JSON.stringify(message);
  refreshHistory(input);
  return message.blocks[0];
}

function batch(length) {
  const fixture = discussionMaintenanceFacts();
  const maintenance = length >= 10;
  const [firstAuthor, oldScope, firstDiscussion, currentAuthor, currentScope] = fixture.messages;
  const lastReply = JSON.parse(fixture.db.authoring_session_messages.at(-1).message);
  const plan = [
    { run: "early", author: text(firstAuthor), discussion: text(firstDiscussion) },
    ...Array.from({ length: length - 2 }, (_,index) => ({
      run: "middle-" + (index + 2),
      author: "第 " + (index + 2) + " 轮作者原话：保留尚欠的风险表；继续比较这一处取舍。",
      discussion: "第 " + (index + 2) + " 轮独立讨论：先分析叙事信息差，尚未执行作者未授权的决定。",
    })),
    { run: "current", author: text(currentAuthor), discussion: text(lastReply) },
  ];
  const db = structuredClone(fixture.db);
  const owner = db.agent_runs[0];
  const runs = plan.map((item) => ({ ...owner, id: item.run, parent_turn_ref: "turn-" + item.run }));
  const rows = [], records = [], providerRuns = [], providerEvents = [], byRun = new Map();
  const firstScopeWire = scopeWireMessage(oldScope.blocks[0].content, {
    versions: oldScope.versions, sourceRefs: oldScope.source_refs,
  });
  const firstDiscussionWire = { role: "assistant", content: plan[0].discussion };
  let prefix = [structuredClone(wire(fixture.after).find((message) =>
    message.role === "user" && message.content.startsWith("【应用数据 · application_base ·")))];

  for (const [index, item] of plan.entries()) {
    const isCurrent = item.run === "current";
    const pcall = isCurrent ? "pcall-after" : "pcall-" + item.run;
    const prun = isCurrent ? "prun-after" : "prun-" + item.run;
    const run = runs[index];
    const rowFor = (position, body) => ({
      id: "row-" + item.run + "-" + position, run_id: item.run, run_sequence: position,
      workspace_id: owner.workspace_id, work_id: owner.work_id, session_id: owner.session_id,
      role: body.role, format_version: "authoring-session-message/v1", message: JSON.stringify(body),
    });
    let segment = fixture.db.authoring_session_messages.filter((row) => row.run_id === item.run)
      .map((row) => structuredClone(row));
    if (segment.length === 0) {
      segment = [
        rowFor(1, { role: "application_base", provenance: "application", blocks: [{ type: "text", text: "创作助手" }] }),
        rowFor(2, { role: "user", provenance: "author", blocks: [{ type: "text", text: item.author }],
          source_refs: [{ ref: "turn-" + item.run }], versions: {} }),
        rowFor(3, { role: "assistant", provenance: "model", blocks: [{ type: "text", text: item.discussion }],
          source_refs: [], versions: {} }),
      ];
    }
    if (!maintenance) segment = segment.filter((row) => row.role !== "checkpoint");
    const reply = segment.findLast((row) => row.role === "assistant");
    const replyBody = JSON.parse(reply.message);
    replyBody.provider_call_ref = pcall;
    replyBody.provider_run_ref = prun;
    reply.message = JSON.stringify(replyBody);
    if (isCurrent && !maintenance) reply.run_sequence = 4;
    rows.push(...segment);

    prefix.push({ role: "user", content: item.author });
    if (index === 0) prefix.push(firstScopeWire);
    if (isCurrent) {
      prefix.push(scopeWireMessage(currentScope.blocks[0].content, {
        versions: currentScope.versions, sourceRefs: currentScope.source_refs,
      }));
      if (maintenance) {
        prefix = prefix.filter((message) => message !== firstScopeWire && message !== firstDiscussionWire);
        prefix.push(structuredClone(wire(fixture.after).find((message) => message.content.includes("· checkpoint ·"))));
        records.push(fixture.summaryRecord);
        providerRuns.push(structuredClone(fixture.options.providerRuns[0]));
      }
    }
    const record = {
      provider: "splash", provider_call_ref: pcall, provider_run_ref: prun,
      work_id: owner.work_id, session_id: owner.session_id, turn_id: run.parent_turn_ref,
      request: { body: { model: "local/Q4-PLE4", messages: structuredClone(prefix), tools: [] } },
      response: { status: 200, usage: { input_tokens: maintenance && index === length - 2 ? 23000 : 1000,
        output_tokens: 40 } },
    };
    records.push(record);
    byRun.set(item.run, isCurrent && maintenance ? [fixture.summaryRecord, record] : [record]);
    providerRuns.push({ ...run, id: prun, agent_run_id: item.run, provider_call_ref: pcall,
      provider_id: "splash", purpose: "planner", owner_refs: {} });
    providerEvents.push({ id: "started-" + item.run, provider_run_id: prun, provider_call_ref: pcall,
      event_type: "started", emitted_at: isCurrent ? "2026-11-04T10:00:00.500Z" :
        "2026-11-04T09:59:" + String(index).padStart(2, "0") + ".000Z" });
    prefix.push(index === 0 ? firstDiscussionWire : { role: "assistant", content: item.discussion });
  }

  db.agent_runs = runs;
  db.authoring_session_messages = rows.map((row, index) => ({ ...row, sequence: index + 1 }));
  db.provider_runs = providerRuns;
  db.provider_events = providerEvents;
  db.provider_outputs = maintenance ? db.provider_outputs : [];
  db.agent_events = maintenance ? db.agent_events : [];
  const source = { authors: plan.map((item, index) => ({
    id: "author-" + (index + 1), text: item.author, sha256: hash(item.author),
    obligations: index === 0 ? [{ id: "risk-table", requirement: fixture.obligations[0], review_at_turns: [3, 10, 20] }] : [],
  })) };
  const input = {
    config: { ...autoMaintenanceConfig(), length, work: { id: owner.work_id }, session_id: owner.session_id },
    source, records, dbFacts: db,
    wire: runs.map((run) => ({ direction: "received", at: "2026-11-04T10:00:01.000Z",
      frame: [null, null, "workspace:" + run.workspace_id, "turn_result", { turn_id: run.parent_turn_ref,
        work_id: run.work_id, session_id: run.session_id,
        agent_run: { run_id: run.id, parent_turn_ref: run.parent_turn_ref, status: "running" } }] })),
    bindings: runs.map((run) => ({ root: run, records: byRun.get(run.id),
      operations: new Map([["pcall-summary", "transcript_compaction"]]), history: {} })),
    uiEvidence: maintenance ? { ok: true, evidence_origin: "synthetic_normalized_ui_result" } : null,
  };
  refreshHistory(input);
  return { input, plan };
}

test("主体封边界来自原作者和已终结维护，未提交响应或迟到事实不能自证闭合", () => {
  const { input } = batch(10);
  const args = { config: input.config, source: input.source, dbFacts: input.dbFacts };
  assert.equal(auditSubjectWindowBoundary(args).ok, true);
  for (const mutate of [
    s => { s.dbFacts.agent_runs[0].status = "running"; },
    s => { s.dbFacts.provider_runs.find(r => r.id === "prun-summary").status = "running"; },
    s => { s.dbFacts.provider_runs.find(r => r.id === "prun-summary").operation_checkpoint = { response_text: "pending" }; },
    s => { s.dbFacts.provider_outputs = []; },
    s => { s.dbFacts.authoring_session_messages = s.dbFacts.authoring_session_messages.filter(r => r.role !== "checkpoint"); },
    s => { s.dbFacts.agent_events = []; },
    s => { s.source.authors[0].text += "changed"; },
  ]) {
    const bad = structuredClone(args); mutate(bad);
    assert.notEqual(auditSubjectWindowBoundary(bad).ok, true);
  }
  const cleared = structuredClone(args);
  cleared.dbFacts.provider_runs.find(r => r.id === "prun-summary").operation_checkpoint = "null";
  assert.equal(auditSubjectWindowBoundary(cleared).ok, true);
});

test("未闭合边界不发送后继时保持partial；坏canonical和多余作者仍fail", () => {
  const {input}=batch(10);
  input.config.successor_observation={lengths:[10,20],count:1};
  input.source.successorAuthor={id:"successor",text:"核对已有交付"};
  const missing=evaluatePreregisteredCompaction(input);
  assert.equal(missing.status,"partial");
  assert.equal(missing.checks.pressure.ok,null);
  assert.equal(missing.checks.all_author_originals.ok,null);
  assert.equal(missing.checks.next_request.ok,null);
  assert.equal(missing.checks.next_request.detail?.checks?.filter(check=>check.ok).length??0,0);
  const bad=structuredClone(input);
  changeCheckpoint(bad,block=>{block.discussion.response_sha256="0".repeat(64);});
  assert.equal(evaluatePreregisteredCompaction(bad).status,"fail");
  const extra=successorBatch();
  const row=extra.dbFacts.authoring_session_messages.find(item=>item.run_id==="successor"&&item.role==="user");
  extra.dbFacts.authoring_session_messages.push({...row,id:"extra-author",sequence:999,run_sequence:99});
  refreshHistory(extra);
  assert.equal(evaluatePreregisteredCompaction(extra).checks.all_author_originals.ok,false);
});

function successorBatch() {
  const { input } = batch(10);
  input.config.successor_observation = { lengths: [10,20], count: 1 };
  input.source.successorAuthor = { id: "successor", text: "只核对已经交付与仍缺少的内容。", sha256: hash("只核对已经交付与仍缺少的内容。") };
  input.dbFacts.agent_events[0].inserted_at = "2026-11-04T10:00:02.000Z";
  input.windowBoundary = { captured_at: "2026-11-04T10:00:03.000Z", dbFacts: structuredClone(input.dbFacts) };
  const db = input.dbFacts, oldRoot = input.bindings.at(-1).root;
  const root = { ...oldRoot, id: "successor", parent_turn_ref: "turn-successor" };
  const oldReply = JSON.parse(db.authoring_session_messages.at(-1).message);
  const record = structuredClone(finalRecord(input));
  Object.assign(record, { provider_call_ref: "pcall-successor", provider_run_ref: "prun-successor", turn_id: root.parent_turn_ref });
  record.request.body.messages.push({ role: "assistant", content: text(oldReply) },
    { role: "user", content: input.source.successorAuthor.text });
  input.records.push(record);
  db.agent_runs.push(root);
  const last = db.authoring_session_messages.at(-1);
  const add = (runSequence, message) => db.authoring_session_messages.push({ ...last,
    sequence: last.sequence + runSequence, id: "successor-row-" + runSequence, run_id: root.id,
    run_sequence: runSequence, role: message.role, message: JSON.stringify(message) });
  add(1, { role: "application_base", provenance: "application", blocks: [{ type: "text", text: "创作助手" }],
    source_refs: [], versions: {} });
  add(2, { role: "user", provenance: "author", blocks: [{ type:"text", text: input.source.successorAuthor.text }],
    source_refs: [{ref:root.parent_turn_ref}], versions:{} });
  add(3, { role: "assistant", provenance: "model", blocks: [{type:"text",text:"只按原文核对。"}],
    provider_call_ref:record.provider_call_ref,provider_run_ref:record.provider_run_ref,source_refs:[],versions:{} });
  db.provider_runs.push({...root,id:record.provider_run_ref,agent_run_id:root.id,
    provider_call_ref:record.provider_call_ref,purpose:"planner",owner_refs:{}});
  db.provider_events.push({provider_run_id:record.provider_run_ref,provider_call_ref:record.provider_call_ref,
    event_type:"started",emitted_at:"2026-11-04T10:00:04.000Z"});
  input.successorBinding = { root, records:[record], operations:new Map(), history:{} };
  refreshHistory(input);
  input.wire.push({direction:"sent",at:"2026-11-04T10:00:03.500Z",
    frame:["join","request","workspace:"+root.workspace_id,"user_message",{turn_id:root.parent_turn_ref,text:input.source.successorAuthor.text}]},
    {direction:"received",at:"2026-11-04T10:00:05.000Z",
      frame:[null,null,"workspace:"+root.workspace_id,"turn_result",{turn_id:root.parent_turn_ref,work_id:root.work_id,
        session_id:root.session_id,agent_run:{run_id:root.id,parent_turn_ref:root.parent_turn_ref,status:"running"}}]});
  return input;
}

test("固定后继验证主体尾维护，不将多一次请求混成主体轮数", () => {
  const input = successorBatch(), result = evaluatePreregisteredCompaction(input);
  assert.equal(result.status,"pass",JSON.stringify(result.checks));
  assert.equal(result.checks.author_runs_completed.runs.length,10);
  assert.equal(result.checks.every_request_preserved.calls.length,11);
  assert.equal(result.checks.next_request.detail.checks[0].provider_call_ref,"pcall-successor");
  assert.deepEqual(result.successor_window.successor_checkpoints_unobserved,[]);
  assert.equal(result.signed,false);
});

test("后继新增维护完整保留并列为未观察，不递归要求第二次后继", () => {
  const input=successorBatch(), db=input.dbFacts;
  const oldScope=db.authoring_session_messages.find(row=>row.run_id==="current" && row.role==="scope_update");
  const body=JSON.parse(oldScope.message), last=db.authoring_session_messages.at(-1);
  const scope={...oldScope,id:"successor-scope",run_id:"successor",run_sequence:4,sequence:last.sequence+1};
  const covers={call_ids:[],message_refs:[{run_id:"current",run_sequence:oldScope.run_sequence,
    role:"scope_update",source_refs:body.source_refs,versions:body.versions}],turn_range:"turn-current"};
  const checkpoint={role:"checkpoint",provenance:"application",blocks:[{type:"checkpoint",covers,
    source_refs:[...body.source_refs,{ref:"session_message:current:"+oldScope.run_sequence,version:1}],
    versions:{},omissions:["旧范围已整理"]}],source_refs:[],versions:{}};
  db.authoring_session_messages.push(scope,{...last,id:"successor-checkpoint",run_sequence:5,
    sequence:last.sequence+2,role:"checkpoint",message:JSON.stringify(checkpoint)});
  db.agent_events.push({run_id:"successor",sequence:10,event_type:"checkpoint_created",
    inserted_at:"2026-11-04T10:00:06.000Z",payload:{covered_counts:{tool_exchanges:0,scope_updates:1,discussion_messages:0}}});
  refreshHistory(input);
  const result=evaluatePreregisteredCompaction(input);
  assert.equal(result.status,"pass",JSON.stringify(result.checks));
  assert.equal(result.canonical_checkpoints.length,2);
  assert.equal(result.successor_window.successor_checkpoints_unobserved.length,1);
  assert.equal(result.checks.next_request.detail.checks.length,1);
});

test("后继高usage不能替代主体压力，错原文与边界后的提交不能放行", () => {
  const low=successorBatch();
  for(const record of low.records) if(record.response?.usage) record.response.usage.input_tokens=1000;
  low.successorBinding.records[0].response.usage.input_tokens=25000;
  assert.equal(evaluatePreregisteredCompaction(low).checks.pressure.ok,false);
  for(const mutate of [
    s=>{s.wire.find(record=>record.direction==="sent").frame[4].text="tampered";},
    s=>{s.windowBoundary.captured_at="2026-11-04T10:00:01.000Z";},
  ]) {
    const input=successorBatch();mutate(input);
    assert.notEqual(evaluatePreregisteredCompaction(input).status,"pass");
  }
});

test("第一业务请求缺覆盖，后续纠正请求正确也不能洗绿", () => {
  const input=successorBatch(), first=input.successorBinding.records[0];
  const later=structuredClone(first);
  later.provider_run_ref="later-provider";later.provider_call_ref="later-call";
  input.records.push(later);
  input.dbFacts.provider_runs.push({...input.dbFacts.provider_runs.at(-1),
    id:later.provider_run_ref,provider_call_ref:later.provider_call_ref});
  input.dbFacts.provider_events.push({provider_run_id:later.provider_run_ref,provider_call_ref:later.provider_call_ref,
    event_type:"started",emitted_at:"2026-11-04T10:00:04.500Z"});
  first.request.body.messages=first.request.body.messages.filter(message=>!message.content?.includes("· checkpoint ·"));
  const result=evaluatePreregisteredCompaction(input);
  assert.equal(result.checks.next_request.ok,false);
  assert.equal(result.checks.next_request.detail.checks[0].provider_call_ref,"pcall-successor");
  assert.equal(result.checks.next_request.detail.checks[0].reason,"checkpoint_cover_mismatch");
});

test("主体边界新增ProviderRun的owner_refs损坏时无法证明闭合", () => {
  const input=successorBatch();
  const db=input.windowBoundary.dbFacts;
  db.provider_runs.push({...db.provider_runs.find(run=>run.id==="prun-summary"),
    id:"malformed-boundary-provider",provider_call_ref:"malformed-boundary-call",owner_refs:'{"operation":'});
  assert.equal(auditSubjectWindowBoundary({config:input.config,source:input.source,dbFacts:db}).ok,null);
  const result=evaluatePreregisteredCompaction(input);
  assert.equal(result.status,"partial");
  assert.equal(result.checks.subject_window.ok,null);
  assert.equal(result.checks.next_request.ok,null);
});

test("最终新增主体ProviderRun的owner_refs损坏时不能遗漏为非维护", () => {
  const input=successorBatch();
  input.dbFacts.provider_runs.push({...input.dbFacts.provider_runs.find(run=>run.id==="prun-summary"),
    id:"malformed-final-provider",provider_call_ref:"malformed-final-call",owner_refs:'{"operation":'});
  const result=evaluatePreregisteredCompaction(input);
  assert.equal(result.status,"partial");
  assert.equal(result.checks.subject_window.ok,null);
  assert.equal(result.checks.next_request.ok,null);
});

test("主体迟到/未闭合、后继缺失/重复/早发与首次请求错误均不得补绿", () => {
  for (const mutate of [
    s=>{s.windowBoundary=null;},
    s=>{s.windowBoundary.dbFacts.provider_runs.find(r=>r.id==="prun-summary").status="running";},
    s=>{s.dbFacts.authoring_session_messages.push({...s.dbFacts.authoring_session_messages.find(r=>r.role==="checkpoint"),id:"late",sequence:999,run_sequence:99});},
    s=>{s.dbFacts.provider_runs.push({...s.dbFacts.provider_runs.find(r=>r.id==="prun-summary"),id:"late"});},
    s=>{s.successorBinding=null;},
    s=>{s.source.successorAuthor.text+="changed";},
    s=>{s.wire.push(structuredClone(s.wire.find(r=>r.direction==="sent")));},
    s=>{s.wire.find(r=>r.direction==="sent").at=s.windowBoundary.captured_at;},
    s=>{s.successorBinding.root.status="failed";},
    s=>{s.successorBinding.records[0].request.body.messages = s.successorBinding.records[0].request.body.messages.filter(m=>!m.content?.includes("· checkpoint ·"));},
  ]) {
    const input=successorBatch(); mutate(input);
    assert.notEqual(evaluatePreregisteredCompaction(input).status,"pass");
  }
});

for (const length of [3, 10, 20]) {
  test(length + " 轮独立正例：逐字原文、实际前缀、压力与覆盖共同成立，语义仍待审", () => {
    const { input, plan } = batch(length);
    const result = evaluatePreregisteredCompaction(input);
    assert.equal(result.status, "pass", JSON.stringify(result.checks));
    assert.equal(result.signed, false);
    assert.equal(result.semantic_status, "review_required");
    assert.equal(result.checks.author_runs_completed.ok, true);
    assert.equal(result.checks.every_request_preserved.calls.length, length);
    assert(result.checks.every_request_preserved.calls.every((call) => call.author_original_bytes &&
      call.retained_discussion_bytes && call.legal_scope));
    assert.deepEqual(input.source.authors.map((author) => author.text), plan.map((item) => item.author));
    assert.equal(result.canonical_checkpoints.length, length === 3 ? 0 : 1);
    assert.equal(result.checks.pressure.detail.max_input_tokens, length === 3 ? 1000 : 23000);
    assert.equal(result.obligations.length, 1);
    assert.equal(result.obligations[0].status, "review_required");
    assert.deepEqual(result.obligations[0].review_turns.map((item) => item.turn),
      [3, 10, 20].filter((turn) => turn <= length));
    assert(result.not_signed.includes("obligation_semantics"));
    if (length > 3) {
      assert.deepEqual(result.canonical_checkpoints[0].counts,
        { tool_exchanges: 0, scope_updates: 1, discussion_messages: 1 });
      assert.equal(result.checks.early_discussion_covered.sources[0].author_index, 0);
    }
  });
}

test("R03 每条冻结输入均须业务结果已交付且真实 completed，不能用调用成功或预测终态代签", () => {
  for (const mutate of [
    (input) => { input.bindings[0].root.status = "running"; },
    (input) => { input.bindings[0].root.status = "awaiting_author"; },
    (input) => { input.bindings[0].root.status = "failed"; },
    (input) => { input.bindings[0].root = { ...input.bindings[0].root }; delete input.bindings[0].root.status; },
    (input) => { input.wire = input.wire.filter((record) => record.frame[4].agent_run?.run_id !== "early"); },
    (input) => { input.wire[0].frame[4].agent_run.run_id = "foreign"; },
    (input) => { input.wire[0].frame[4].agent_run.status = "completed"; input.bindings[0].root.status = "running"; },
  ]) {
    const { input } = batch(3); mutate(input);
    const result = evaluatePreregisteredCompaction(input);
    assert.equal(result.checks.author_runs_completed.ok, false);
    assert.equal(result.status, "fail");
    assert.equal(result.semantic_status, "review_required");
  }
});

test("R03 原始 DB 缺运行状态时 canonical 读取边界直接拒绝", () => {
  const { input } = batch(3);
  delete input.dbFacts.agent_runs[0].status;
  assert.throws(() => evaluatePreregisteredCompaction(input), /agent_run status 缺失或未知/);
});

for (const mode of ["missing_usage", "zero_usage"]) {
  test("3轮低压控制缺实际正 usage 必须失败：" + mode, () => {
    const { input } = batch(3);
    for (const record of input.records) {
      if (mode === "missing_usage") delete record.response.usage;
      else record.response.usage.input_tokens = 0;
    }
    const result = evaluatePreregisteredCompaction(input);
    assert.equal(result.checks.pressure.ok, false);
    assert.equal(result.checks.pressure.detail.max_input_tokens, 0);
    assert.equal(result.status, "fail");
  });
}

for (const mode of ["empty", "null", "missing_prefix"]) {
  test("请求缺证保留 partial 而非 vacuous pass：" + mode, () => {
    const { input } = batch(3);
    if (mode === "empty") input.bindings = [];
    else if (mode === "null") input.bindings = [null];
    else input.bindings.at(-1).history = { sessionMessages: [] };
    const result = evaluatePreregisteredCompaction(input);
    assert.equal(result.checks.every_request_preserved.ok, null);
    assert.equal(result.status, "partial");
  });
}

for (const mutation of ["delete", "extra", "reorder", "bytes"]) {
  test("纯讨论原序原字节变化必须拒绝：" + mutation, () => {
    const { input } = batch(3);
    const messages = wire(finalRecord(input));
    const positions = messages.flatMap((message, index) => message.role === "assistant" ? [index] : []);
    assert.equal(positions.length, 2);
    if (mutation === "delete") messages.splice(positions[0], 1);
    if (mutation === "extra") messages.push({ role: "assistant", content: "未在 canonical 历史中出现的讨论。" });
    if (mutation === "reorder") [messages[positions[0]], messages[positions[1]]] = [messages[positions[1]], messages[positions[0]]];
    if (mutation === "bytes") messages[positions[0]].content += " ";
    const result = evaluatePreregisteredCompaction(input);
    const last = result.checks.every_request_preserved.calls.at(-1);
    assert.equal(last.retained_discussion_bytes, false);
    assert.equal(last.author_original_bytes, true);
    assert.equal(result.status, "fail");
  });
}

for (const missing of [false, true]) {
  test(missing ? "合法同文保留讨论缺失时拒绝，但不误报已覆盖讨论重放" :
    "与已覆盖讨论同文的独立保留消息仍合法", () => {
    const { input, plan } = batch(10);
    const retained = input.dbFacts.authoring_session_messages.find((row) =>
      row.run_id === "middle-2" && row.role === "assistant");
    const body = JSON.parse(retained.message);
    assert.equal(body.blocks[0].text, plan[1].discussion);
    body.blocks[0].text = plan[0].discussion;
    retained.message = JSON.stringify(body);
    for (const record of input.records) {
      for (const message of wire(record)) {
        if (message.role === "assistant" && message.content === plan[1].discussion)
          message.content = plan[0].discussion;
      }
    }
    refreshHistory(input);
    const messages = wire(finalRecord(input));
    const retainedCopies = messages.filter((message) =>
      message.role === "assistant" && message.content === plan[0].discussion);
    assert.equal(retainedCopies.length, 1);
    if (missing) messages.splice(messages.indexOf(retainedCopies[0]), 1);

    const result = evaluatePreregisteredCompaction(input);
    assert.equal(result.checks.canonical_coverage.ok, true);
    assert.equal(result.checks.next_request.ok, !missing, JSON.stringify(result.checks.next_request));
    if (missing) {
      assert.notEqual(result.checks.next_request.reason, "covered_discussion_still_in_next_request");
    } else {
      assert.equal(result.checks.next_request.reason, null);
    }
  });
}

test("已覆盖纯讨论不得在后请求原文重放", () => {
  const { input, plan } = batch(10);
  wire(finalRecord(input)).push({ role: "assistant", content: plan[0].discussion });
  const result = evaluatePreregisteredCompaction(input);
  assert.equal(result.checks.every_request_preserved.ok, false);
  assert.equal(result.checks.next_request.ok, false);
  assert.equal(result.checks.next_request.reason, "covered_discussion_still_in_next_request");
  assert.equal(result.status, "fail");
});

test("作者原话的单字节变化独立于讨论检查被拒绝", () => {
  const { input, plan } = batch(3);
  wire(finalRecord(input)).find((message) => message.role === "user" && message.content === plan[0].author).content += " ";
  const result = evaluatePreregisteredCompaction(input);
  const last = result.checks.every_request_preserved.calls.at(-1);
  assert.equal(last.author_original_bytes, false);
  assert.equal(last.retained_discussion_bytes, true);
  assert.equal(result.status, "fail");
});

test("篡改当前 Scope 不能凭完整作者和讨论原文通过", () => {
  const { input } = batch(3);
  const messages = wire(finalRecord(input));
  const scope = messages.findLast((message) => message.content.includes("· scope_update ·"));
  scope.content = scope.content.replace('"单视角"', '"双视角"');
  const result = evaluatePreregisteredCompaction(input);
  const last = result.checks.every_request_preserved.calls.at(-1);
  assert.equal(last.legal_scope, false);
  assert.equal(last.author_original_bytes, true);
  assert.equal(last.retained_discussion_bytes, true);
  assert.equal(result.status, "fail");
});

test("同 session 的外作品 run 不能被过滤成合法本作品批次", () => {
  const { input } = batch(10);
  input.dbFacts.agent_runs.push({ ...input.dbFacts.agent_runs[0], id: "foreign-run", work_id: "foreign-work" });
  assert.throws(() => evaluatePreregisteredCompaction(input), /preregistered session\/work identity mismatch/);
});

test("最后 checkpoint 后没有真实调用时 next_request 是缺证而非完成", () => {
  const { input } = batch(20);
  input.records = input.records.filter((record) => record.provider_call_ref !== "pcall-after");
  input.bindings.at(-1).records = input.bindings.at(-1).records.filter((record) => record.provider_call_ref !== "pcall-after");
  input.dbFacts.provider_runs = input.dbFacts.provider_runs.filter((run) => run.id !== "prun-after");
  input.dbFacts.provider_events = input.dbFacts.provider_events.filter((event) => event.provider_run_id !== "prun-after");
  input.dbFacts.authoring_session_messages = input.dbFacts.authoring_session_messages.filter((row) =>
    !(row.run_id === "current" && row.role === "assistant"));
  refreshHistory(input);
  const result = evaluatePreregisteredCompaction(input);
  assert.equal(result.checks.pressure.ok, true);
  assert.equal(result.checks.early_discussion_covered.ok, true);
  assert.equal(result.checks.next_request.ok, null);
  assert.equal(result.checks.next_request.reason, "next_request_evidence_missing");
  assert.equal(result.status, "partial");
});

test("只整理 Scope 的合法 checkpoint 不能代签早期纯讨论已被覆盖", () => {
  const { input, plan } = batch(10);
  const block = changeCheckpoint(input, (checkpoint) => {
    checkpoint.covers.message_refs = checkpoint.covers.message_refs.filter((ref) => ref.role === "scope_update");
    checkpoint.source_refs = [{ ref: "context:old", version: 7 }, { ref: "session_message:early:3", version: 1 }];
    checkpoint.summary = "仅整理旧范围。";
    delete checkpoint.discussion;
  });
  input.records = input.records.filter((record) => record.provider_call_ref !== "pcall-summary");
  for (const binding of input.bindings) binding.records = binding.records.filter((record) => record.provider_call_ref !== "pcall-summary");
  input.dbFacts.provider_runs = input.dbFacts.provider_runs.filter((run) => run.id !== "prun-summary");
  input.dbFacts.provider_outputs = [];
  input.dbFacts.agent_events[0].payload.covered_counts.discussion_messages = 0;
  const messages = wire(finalRecord(input));
  messages.find((message) => message.content.includes("· checkpoint ·")).content = checkpointWire(block).content;
  const authorIndex = messages.findIndex((message) => message.role === "user" && message.content === plan[0].author);
  messages.splice(authorIndex + 1, 0, { role: "assistant", content: plan[0].discussion });
  const result = evaluatePreregisteredCompaction(input);
  assert.equal(result.checks.canonical_coverage.ok, true);
  assert.equal(result.checks.every_request_preserved.ok, true);
  assert.equal(result.checks.next_request.ok, true);
  assert.equal(result.checks.early_discussion_covered.ok, false);
  assert.equal(result.status, "fail");
});

for (const value of [null, { ok: false }]) {
  test("10/20原文 UI 缺证或失败不可由机制通过补签：" + JSON.stringify(value), () => {
    const { input } = batch(20);
    input.uiEvidence = value;
    const result = evaluatePreregisteredCompaction(input);
    assert.equal(result.checks.original_history_ui.ok, value?.ok ?? null);
    assert.equal(result.status, value === null ? "partial" : "fail");
  });
}


test("同run多作者只按来源最近在先作者判早期覆盖，不能借首作者达标", () => {
  const { input, plan } = batch(10);
  const earlyRun = input.dbFacts.agent_runs.find((run) => run.id === "early");
  const rows = input.dbFacts.authoring_session_messages;
  const source = rows.find((row) => row.run_id === "early" && row.role === "assistant");
  const fourth = rows.filter((row) => row.run_id === "middle-4");
  const fourthBase = fourth.find((row) => row.role === "application_base");
  fourth.forEach((row, index) => {
    if (row !== fourthBase) { row.run_id = "early"; row.run_sequence = 4 + index; }
  });
  source.run_sequence = 7;
  const reordered = rows.filter((row) => row !== source && row !== fourthBase);
  reordered.splice(reordered.indexOf(fourth.at(-1)) + 1, 0, source);
  input.dbFacts.authoring_session_messages = reordered.map((row, index) => ({ ...row, sequence: index + 1 }));
  input.dbFacts.agent_runs = input.dbFacts.agent_runs.filter((run) => run.id !== "middle-4");
  const provider = input.dbFacts.provider_runs.find((run) => run.provider_call_ref === "pcall-middle-4");
  Object.assign(provider, { agent_run_id: "early", parent_turn_ref: earlyRun.parent_turn_ref });
  input.bindings[3].root = earlyRun;
  input.records.find((record) => record.provider_call_ref === "pcall-middle-4").turn_id = earlyRun.parent_turn_ref;
  input.dbFacts.provider_events.find((event) => event.provider_call_ref === "pcall-early").emitted_at =
    "2026-11-04T09:59:03.500Z";

  // 独立书写真实时间序列：第一作者的 run 在第4作者后才输出该长讨论。
  const firstRecord = input.records.find((record) => record.provider_call_ref === "pcall-early");
  const oldScopeWire = structuredClone(wire(firstRecord).find((message) => message.content.includes("· scope_update ·")));
  const delayedRequest = [structuredClone(wire(firstRecord).find((message) =>
    message.role === "user" && message.content.startsWith("【应用数据 · application_base ·")))];
  for (let index = 0; index < 4; index += 1) {
    delayedRequest.push({ role: "user", content: plan[index].author });
    if (index === 0) delayedRequest.push(oldScopeWire);
    else delayedRequest.push({ role: "assistant", content: plan[index].discussion });
  }
  firstRecord.request.body.messages = delayedRequest;
  for (const record of input.records.filter((item) => item.provider_call_ref.startsWith("pcall-middle-"))) {
    const turn = Number(record.provider_call_ref.slice("pcall-middle-".length));
    const messages = wire(record).filter((message) => message.content !== plan[0].discussion);
    if (turn > 4) {
      const position = messages.findIndex((message) => message.role === "assistant" && message.content === plan[3].discussion);
      messages.splice(position + 1, 0, { role: "assistant", content: plan[0].discussion });
    }
    record.request.body.messages = messages;
  }
  const summary = input.records.find((record) => record.provider_call_ref === "pcall-summary");
  const material = JSON.parse(wire(summary).find(message => message.role === "user" && message.content.startsWith("【应用数据 · application_base")).content.split("\n").slice(1).join("\n"));
  material.sources[0].source.run_sequence = 7;
  material.sources[0].author_text = plan[3].author;
  wire(summary).find(message => message.role === "user" && message.content.startsWith("【应用数据 · application_base")).content = "【应用数据 · application_base · 非作者原话】\n" + JSON.stringify(material);
  const block = changeCheckpoint(input, (checkpoint) => {
    checkpoint.covers.message_refs.find((ref) => ref.role === "assistant").run_sequence = 7;
    checkpoint.source_refs.find((ref) => ref.ref === "session_message:early:4").ref = "session_message:early:7";
  });
  const discussionProjection = discussionMaintenanceFacts().discussionProjection;
  discussionProjection.entries[0].source.ref = "session_message:early:7";
  discussionProjection.entries[0].locator.run_sequence = 7;
  wire(finalRecord(input)).find((message) => message.content.includes("· checkpoint ·")).content =
    checkpointWire(block, discussionProjection).content;

  const result = evaluatePreregisteredCompaction(input);
  assert.equal(result.checks.canonical_coverage.ok, true, JSON.stringify(result.checks));
  assert.equal(result.checks.all_author_originals.ok, true);
  assert.equal(result.checks.every_request_preserved.ok, true, JSON.stringify(result.checks.every_request_preserved));
  assert.equal(result.checks.next_request.ok, true);
  assert.equal(result.checks.early_discussion_covered.sources[0].author_index, 3);
  assert.equal(result.checks.early_discussion_covered.ok, false);
  assert.deepEqual(result.obligations[0].actual_summary_excerpts, []);
  assert.equal(result.status, "fail");
});

test("合法引用形状不代签义务无遗漏：漏承诺摘要仍列实际摘录为待审", () => {
  const { input } = batch(10);
  const block = changeCheckpoint(input, (checkpoint) => {
    const response = JSON.parse(checkpoint.discussion.response_text);
    response.entries[0].retained_obligations = [];
    checkpoint.discussion.response_text = JSON.stringify(response);
    checkpoint.discussion.response_sha256 = hash(checkpoint.discussion.response_text);
  });
  input.dbFacts.provider_outputs[0].content_summary.content_sha256 = block.discussion.response_sha256;
  const discussionProjection = discussionMaintenanceFacts().discussionProjection;
  discussionProjection.entries[0].retained_source_fragments = [];
  wire(finalRecord(input)).find((message) => message.content.includes("· checkpoint ·")).content =
    checkpointWire(block, discussionProjection).content;
  const result = evaluatePreregisteredCompaction(input);
  assert.equal(result.status, "pass", JSON.stringify(result.checks));
  assert.equal(result.signed, false);
  assert.equal(result.semantic_status, "review_required");
  assert.equal(result.obligations[0].status, "review_required");
  assert.deepEqual(result.obligations[0].actual_summary_excerpts[0].entry.retained_obligations, []);
});
