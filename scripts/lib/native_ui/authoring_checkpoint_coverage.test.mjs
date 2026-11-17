import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { auditCanonicalCoverage, auditDiscussionRequest } from "./authoring_checkpoint_coverage.mjs";
import { analyzeRequestCost } from "./request_cost_evidence.mjs";
import { discussionCoverageFacts as coverageSpec, discussionMaintenanceFacts as originalMaintenanceFacts } from "./fixtures/authoring_discussion_facts.mjs";
function discussionMaintenanceFacts() {
  const spec = originalMaintenanceFacts();
  spec.options.providerRuns[0].operation_checkpoint = {
    version: "provider-operation-checkpoint/v1", goal_version: 1, plan: {},
  };
  return spec;
}
const materialMessage = spec => spec.summaryRecord.request.body.messages.find(message =>
  message.role === "user" && message.content.startsWith("【应用数据 · application_base"));
function v2Spec(indices = [0, 1, 3]) {
  const spec = discussionMaintenanceFacts();
  spec.options.providerRuns[0].operation_checkpoint = {
    version: "provider-operation-checkpoint/v2", goal_version: 1, plan: {},
    discussion_protocol_version: "authoring-discussion-summary/v2",
  };
  const original = "风险表未完成。\r\n请作者确认。\r中间说明\n尾行😀";
  spec.messages[2].blocks[0].text = original;
  const message = materialMessage(spec);
  const prefix = message.content.slice(0, message.content.indexOf("\n") + 1);
  const material = JSON.parse(message.content.slice(prefix.length));
  delete material.sources[0].text;
  material.sources[0].fragments = [
    { fragment_index: 0, text: "风险表未完成。\r\n" },
    { fragment_index: 1, text: "请作者确认。\r" },
    { fragment_index: 2, text: "中间说明\n" },
    { fragment_index: 3, text: "尾行😀" },
  ];
  message.content = prefix + JSON.stringify(material);
  spec.summaryRecord.request.body.messages.find(message => message.role === "system").content =
    "output_protocol_version: authoring-discussion-summary/v2";
  const discussion = spec.messages.at(-1).blocks[0].discussion;
  discussion.response_text = JSON.stringify({ version: "authoring-discussion-summary/v2",
    entries: [{ source_index: 0, summary: "尚欠风险表与作者确认。", retained_fragment_indices: indices }] });
  discussion.response_sha256 = createHash("sha256").update(discussion.response_text).digest("hex");
  spec.options.providerOutputs[0].content_summary.content_sha256 = discussion.response_sha256;
  return spec;
}

test("v2独立完整行片段：原字节、连续与不连续义务，并保持v1历史", () => {
  const spec = v2Spec();
  const audited = auditCanonicalCoverage(spec.messages, spec.options);
  assert.equal(audited.ok, true, audited.reason);
  assert.deepEqual(audited.checkpoints[0].entries[0].retained_obligations,
    ["风险表未完成。\r\n请作者确认。\r", "尾行😀"]);
  const request = auditDiscussionRequest(spec.summaryRecord, spec.options.providerRuns[0], spec.messages);
  assert.equal(request.ok, true, request.reason);
  assert.equal(analyzeRequestCost(spec.summaryRecord, {applicationBinding:request.binding,purpose:"other"}).ok,true);
  assert.equal(auditCanonicalCoverage(coverageSpec().messages, coverageSpec().options).ok,true);
  for (const indices of [[4],[-1],[1,1],[2,0],[0.5],["0"]]) {
    const bad = v2Spec(indices);
    assert.equal(auditCanonicalCoverage(bad.messages,bad.options).ok,false,JSON.stringify(indices));
  }
  for (const mutate of [
    m=>m.sources[0].fragments[0].text="风险表未完成。\n",
    m=>m.sources[0].fragments.reverse(),
    m=>m.sources[0].fragments[1].fragment_index=0,
    m=>m.sources[0].text="重复原文",
  ]) {
    const bad=v2Spec(), item=materialMessage(bad);
    const p=item.content.indexOf("\n")+1, material=JSON.parse(item.content.slice(p));
    mutate(material); item.content=item.content.slice(0,p)+JSON.stringify(material);
    assert.equal(auditCanonicalCoverage(bad.messages,bad.options).ok,false);
    assert.equal(auditDiscussionRequest(bad.summaryRecord,bad.options.providerRuns[0],bad.messages).ok,false);
  }
  const mismatch=v2Spec();
  mismatch.summaryRecord.request.body.messages[0].content="output_protocol_version: authoring-discussion-summary/v1";
  assert.equal(auditCanonicalCoverage(mismatch.messages,mismatch.options).ok,false);
  assert.equal(auditDiscussionRequest(mismatch.summaryRecord,mismatch.options.providerRuns[0],mismatch.messages).ok,false);
});

test("v2协议声明必须唯一且存在，不能用空集合或重复自证", () => {
  for (const mutate of [
    messages=>messages.shift(),
    messages=>messages.push(structuredClone(messages[0])),
    messages=>messages[0].content += "\noutput_protocol_version: authoring-discussion-summary/v1",
  ]) {
    const spec=v2Spec(); mutate(spec.summaryRecord.request.body.messages);
    assert.equal(auditCanonicalCoverage(spec.messages,spec.options).ok,false);
    assert.equal(auditDiscussionRequest(spec.summaryRecord,spec.options.providerRuns[0],spec.messages).ok,false);
  }
});

test("v2成本按冻结capsule而非坏响应猜版本；缺失/错配不能退回旧格式", () => {
  for (const mutate of [
    c=>delete c.discussion_protocol_version,
    c=>c.discussion_protocol_version="authoring-discussion-summary/v1",
    c=>c.version="provider-operation-checkpoint/v9",
    c=>c.unexpected=true,
    c=>c.goal_version=0,
    c=>c.plan=null,
  ]) {
    const spec=v2Spec(); mutate(spec.options.providerRuns[0].operation_checkpoint);
    assert.equal(auditDiscussionRequest(spec.summaryRecord,spec.options.providerRuns[0],spec.messages).ok,false);
  }
  const spec=v2Spec();
  spec.options.providerRuns[0].operation_checkpoint.response_text="{broken";
  const withoutCheckpoint=spec.messages.filter(m=>m.role!=="checkpoint");
  assert.equal(auditDiscussionRequest(spec.summaryRecord,spec.options.providerRuns[0],withoutCheckpoint).ok,true);
  delete spec.options.providerRuns[0].operation_checkpoint;
  assert.equal(auditDiscussionRequest(spec.summaryRecord,spec.options.providerRuns[0],withoutCheckpoint).ok,false);
  assert.equal(auditDiscussionRequest(spec.summaryRecord,spec.options.providerRuns[0],spec.messages).ok,true);
});

test("维护成本来源来自真实坐标与原文；无Checkpoint也计成本，不伪造作者", () => {
  const spec = discussionMaintenanceFacts();
  const run = spec.options.providerRuns[0];
  const messages = spec.messages.filter((message) => message.role !== "checkpoint");
  const audited = auditDiscussionRequest(spec.summaryRecord, run, messages);
  assert.equal(audited.ok, true, audited.reason);
  assert.equal(audited.sourceCount, 1);
  const analysis = analyzeRequestCost(spec.summaryRecord, { applicationBinding: audited.binding, purpose: "other" });
  assert.equal(analysis.ok, true, analysis.reason);
  assert.equal(analysis.cross.author_message_count, 0);
  assert.equal(analysis.cross.current_author_index, null);
  assert.equal(analysis.category_bytes.current_author, 0);
  assert.equal(analysis.category_bytes.application_base,
    Buffer.byteLength(materialMessage(spec).content));
  assert.equal(analysis.provenance.basis, "external_application_binding");
  assert.deepEqual(analysis.provenance.trusted_application_messages,
    [spec.summaryRecord.request.body.messages.indexOf(materialMessage(spec))]);
  assert.equal(analyzeRequestCost(spec.summaryRecord).ok, false);
  const tampered = structuredClone(spec.summaryRecord);
  tampered.provider_call_ref = "another-call";
  assert.equal(analyzeRequestCost(tampered, { applicationBinding: audited.binding }).ok, false);
});

test("维护来源拒绝标签自证、身份/原文/作者/顺序及范围篡改", () => {
  const cases = [
    ["pcall", (s) => { s.summaryRecord.provider_call_ref = "other"; }],
    ["prun", (s) => { s.summaryRecord.provider_run_ref = "other"; }],
    ["log work", (s) => { s.summaryRecord.work_id = "other"; }],
    ["log workspace", (s) => { s.summaryRecord.workspace_id = "other"; }],
    ["log session", (s) => { s.summaryRecord.session_id = "other"; }],
    ["owner parent", (s) => { s.options.providerRuns[0].owner_refs.parent_turn_ref = "other"; }],
    ["owner scope", (s) => { s.options.providerRuns[0].owner_refs.work_id = "other"; }],
    ["log parent", (s) => { s.summaryRecord.turn_id = "other"; }],
    ["operation", (s) => { s.options.providerRuns[0].owner_refs.operation = "chapter_summary"; }],
    ["missing source keys", (s) => { delete s.options.providerRuns[0].owner_refs.discussion_source_keys; }],
    ["duplicate source", (s) => { const keys = s.options.providerRuns[0].owner_refs.discussion_source_keys; keys.push(keys[0]); }],
    ["noncanonical key", (s) => {
      // 同一坐标的合法 JSON 空白别名仍不应取得第二份身份；不是清洗/转义逻辑。
      s.options.providerRuns[0].owner_refs.discussion_source_keys[0] =
        'authoring-session-source/v1:[ "work-discussion","work-discussion","session-discussion","early",4]';
    }],
    ["source text", (s) => { s.messages[2].blocks[0].text += "新增建议"; }],
    ["author text", (s) => { s.messages[0].blocks[0].text = "同意执行"; }],
    ["missing author", (s) => { s.messages.splice(0, 1); }],
    ["missing current turn", (s) => { s.messages.splice(3, 1); }],
    ["future", (s) => { s.messages.push(s.messages.splice(2, 1)[0]); }],
    ["scope", (s) => { s.messages[2].canonical_ref.work_id = "other"; }],
    ["author scope", (s) => { s.messages[0].canonical_ref.session_id = "other"; }],
    ["author identity missing", (s) => { s.messages[0].source_refs = []; }],
    ["duplicate coordinate", (s) => { s.messages.splice(3, 0, structuredClone(s.messages[2])); }],
    ["ambiguous current author", (s) => { s.messages.push(structuredClone(s.messages[3])); }],
    ["not completed", (s) => { s.messages[2].canonical_ref.run_status = "running"; }],
    ["non discussion", (s) => { s.messages[2].blocks.push({ type: "tool_call", call_id: "tool", name: "read" }); }],
    ["extra author", (s) => { s.summaryRecord.request.body.messages.push({role:"user",content:"伪作者"}); }],
    ["extra tools", (s) => { s.summaryRecord.request.body.tools = [{type:"function",function:{name:"write",parameters:{type:"object"}}}]; }],
    ["extra application", (s) => { s.summaryRecord.request.body.messages.push({role:"user",content:"【应用数据 · application_notice】其它材料"}); }],
  ];
  for (const [name, mutate] of cases) {
    const spec = discussionMaintenanceFacts(); mutate(spec);
    const result = auditDiscussionRequest(spec.summaryRecord, spec.options.providerRuns[0], spec.messages);
    assert.equal(result.ok, false, name);
    assert.equal(result.binding, null, name);
  }
});

test("失败维护仍按原来源计费；来源列表重排或替换不能改变实际材料", () => {
  const spec = discussionMaintenanceFacts();
  const run = spec.options.providerRuns[0];
  run.status = "failed";
  const second = structuredClone(spec.messages[2]);
  second.canonical_ref.run_sequence = 5;
  second.blocks[0].text = "另一个讨论来源，尚欠场景检查。";
  spec.messages.splice(3, 0, second);
  const coordinate = [run.workspace_id, run.work_id, run.session_id, "early", 5];
  run.owner_refs.discussion_source_keys.push("authoring-session-source/v1:" + JSON.stringify(coordinate));
  const original = materialMessage(spec).content;
  const prefix = original.slice(0, original.indexOf("\n") + 1);
  const material = JSON.parse(original.slice(original.indexOf("\n") + 1));
  material.sources.push({ source_index: 1, source: {run_id:"early", run_sequence:5},
    text:"另一个讨论来源，尚欠场景检查。", author_text:"  比较双视角与单视角；先别执行，仍欠风险表。\r\n" });
  materialMessage(spec).content = prefix + JSON.stringify(material);
  const good = auditDiscussionRequest(spec.summaryRecord, run, spec.messages);
  assert.equal(good.ok, true, good.reason);
  assert.equal(good.sourceCount, 2);
  run.owner_refs.discussion_source_keys.reverse();
  const bad = auditDiscussionRequest(spec.summaryRecord, run, spec.messages);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /out_of_order/);
});

test("持久恢复可由新run提交，但摘要仍须绑定原执行与在先canonical归属", () => {
  const spec = coverageSpec();
  const checkpoint = spec.messages.pop();
  const author = structuredClone(spec.messages[3]);
  const scope = structuredClone(spec.messages[4]);
  for (const message of [author, scope, checkpoint]) {
    message.canonical_ref.run_id = "recovery";
    message.canonical_ref.parent_turn_ref = "turn-recovery";
  }
  author.source_refs = [{ ref: "turn-recovery", version: 1 }];
  spec.messages.push(author, scope, checkpoint);
  assert.equal(auditCanonicalCoverage(spec.messages, spec.options).ok, true);
  const cases = [
    (s) => { s.options.providerRuns[0].agent_run_id = "missing-origin"; },
    (s) => { s.options.providerRuns[0].parent_turn_ref = "wrong-parent"; },
    (s) => { s.options.providerOutputs[0].agent_run_id = "recovery"; },
    (s) => { s.messages[3].canonical_ref.work_id = "foreign"; },
  ];
  for (const change of cases) {
    const changed = structuredClone(spec); change(changed);
    assert.equal(auditCanonicalCoverage(changed.messages, changed.options).ok, false);
  }
});

test("R03 原始 DB 坐标 oracle：零工具的旧 Scope 与纯讨论覆盖，作者字节和最新范围永久保留", () => {
  const spec = coverageSpec();
  const result = auditCanonicalCoverage(spec.messages, spec.options);
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.checkpoints[0].counts, { tool_exchanges: 0, scope_updates: 1, discussion_messages: 1 });
  assert.deepEqual(result.retainedMessages, [spec.messages[0], spec.messages[3], spec.messages[4], spec.messages[5]]);
  assert.deepEqual(result.checkpoints[0].entries[0].retained_obligations, spec.obligations);
  assert.equal(result.retainedMessages[0].blocks[0].text, "  比较双视角与单视角；先别执行，仍欠风险表。\r\n");
});

test("R03 独立覆盖 oracle 拒绝未知/未来/重复/跨作品/版本及受保护来源，不以摘要自证", () => {
  const cases = [
    ["missing call_ids", (s) => { delete s.messages[5].blocks[0].covers.call_ids; }],
    ["missing message_refs", (s) => { delete s.messages[5].blocks[0].covers.message_refs; }],
    ["unknown", (s) => { s.messages[5].blocks[0].covers.message_refs[0].run_sequence = 500; }],
    ["future", (s) => { const source = s.messages.splice(2, 1)[0]; s.messages.push(source); }],
    ["duplicate", (s) => { s.messages.push(structuredClone(s.messages[5])); }],
    ["same selector twice", (s) => { s.messages[5].blocks[0].covers.message_refs.push(structuredClone(s.messages[5].blocks[0].covers.message_refs[0])); }],
    ["version", (s) => { s.messages[5].blocks[0].covers.message_refs[0].versions = { goal: 9 }; }],
    ["source ref", (s) => { s.messages[5].blocks[0].covers.message_refs[0].source_refs = []; }],
    ["cross work", (s) => { s.messages[2].canonical_ref.work_id = "elsewhere"; }],
    ["author", (s) => { s.messages[5].blocks[0].covers.message_refs[1].role = "user"; }],
    ["current discussion", (s) => { s.messages[2].canonical_ref.run_id = "current"; s.messages[5].blocks[0].covers.message_refs[1].run_id = "current"; }],
    ["cancelled discussion", (s) => { s.messages[2].canonical_ref.run_status = "cancelled"; }],
    ["failed discussion", (s) => { s.messages[2].canonical_ref.run_status = "failed"; }],
    ["awaiting question", (s) => { s.messages[2].canonical_ref.run_status = "awaiting_author"; }],
    ["latest scope", (s) => { s.messages.splice(4, 1); }],
    ["mixed tool discussion", (s) => { s.messages[2].blocks.push({ type: "tool_call", call_id: "active", name: "ask_author" }); }],
    ["raw hash", (s) => { s.messages[5].blocks[0].discussion.response_text += " "; }],
    ["foreign provider owner", (s) => { s.options.providerRuns[0].agent_run_id = "elsewhere"; }],
    ["persisted hash", (s) => { s.options.providerOutputs[0].content_summary.content_sha256 = "0".repeat(64); }],
    ["provider pair", (s) => { s.options.providerRuns[0].provider_call_ref = "other"; }],
  ];
  for (const [name, mutate] of cases) {
    const spec = coverageSpec();
    mutate(spec);
    assert.equal(auditCanonicalCoverage(spec.messages, spec.options).ok, false, name);
  }
});

test("R03 当前工作回合保护：首个 Scope 虽在作者之前，归属唯一当前作者仍不可覆盖", () => {
  const spec = coverageSpec();
  const [author, initialScope, , , currentScope, checkpoint] = spec.messages;
  for (const row of [author, initialScope, currentScope, checkpoint]) row.canonical_ref.run_id = "current";
  initialScope.canonical_ref.run_sequence = 1;
  author.canonical_ref.run_sequence = 2;
  const block = checkpoint.blocks[0];
  block.covers.message_refs = [{ run_id: "current", run_sequence: 1, role: "scope_update",
    source_refs: initialScope.source_refs, versions: initialScope.versions }];
  delete block.discussion;
  block.source_refs = [...initialScope.source_refs, { ref: "session_message:current:1", version: 1 }];
  const messages = [initialScope, author, currentScope, checkpoint];
  const result = auditCanonicalCoverage(messages);
  assert.equal(result.ok, false);
  assert.match(result.reason, /protected/u);
  assert.deepEqual(result.retainedMessages, messages);
});

test("R03 改写义务引用不能通过原文校验；合法空义务不能冒充语义完整", () => {
  const spec = coverageSpec();
  const checkpoint = spec.messages[5].blocks[0];
  const output = JSON.parse(checkpoint.discussion.response_text);
  output.entries[0].retained_obligations = ["风险表已经完成"];
  checkpoint.discussion.response_text = JSON.stringify(output);
  checkpoint.discussion.response_sha256 = createHash("sha256").update(checkpoint.discussion.response_text).digest("hex");
  spec.options.providerOutputs[0].content_summary.content_sha256 = checkpoint.discussion.response_sha256;
  assert.equal(auditCanonicalCoverage(spec.messages, spec.options).ok, false);
  output.entries[0].retained_obligations = [];
  checkpoint.discussion.response_text = JSON.stringify(output);
  checkpoint.discussion.response_sha256 = createHash("sha256").update(checkpoint.discussion.response_text).digest("hex");
  spec.options.providerOutputs[0].content_summary.content_sha256 = checkpoint.discussion.response_sha256;
  const mechanical = auditCanonicalCoverage(spec.messages, spec.options);
  assert.equal(mechanical.ok, true);
  assert.notDeepEqual(mechanical.checkpoints[0].entries[0].retained_obligations, spec.obligations);
});
