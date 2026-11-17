import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { auditCanonicalCoverage, auditDiscussionRequest } from "./authoring_checkpoint_coverage.mjs";
import { analyzeRequestCost } from "./request_cost_evidence.mjs";
import { discussionCoverageFacts as coverageSpec, discussionMaintenanceFacts } from "./fixtures/authoring_discussion_facts.mjs";
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
    Buffer.byteLength(spec.summaryRecord.request.body.messages[0].content));
  assert.equal(analysis.provenance.basis, "external_application_binding");
  assert.deepEqual(analysis.provenance.trusted_application_messages, [0]);
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
  const original = spec.summaryRecord.request.body.messages[0].content;
  const prefix = original.slice(0, original.indexOf("\n") + 1);
  const material = JSON.parse(original.slice(original.indexOf("\n") + 1));
  material.sources.push({ source_index: 1, source: {run_id:"early", run_sequence:5},
    text:"另一个讨论来源，尚欠场景检查。", author_text:"  比较双视角与单视角；先别执行，仍欠风险表。\r\n" });
  spec.summaryRecord.request.body.messages[0].content = prefix + JSON.stringify(material);
  const good = auditDiscussionRequest(spec.summaryRecord, run, spec.messages);
  assert.equal(good.ok, true, good.reason);
  assert.equal(good.sourceCount, 2);
  run.owner_refs.discussion_source_keys.reverse();
  const bad = auditDiscussionRequest(spec.summaryRecord, run, spec.messages);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /out_of_order/);
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
