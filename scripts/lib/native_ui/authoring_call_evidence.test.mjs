// B71 §16.9 逐调用外部证据关联的纯函数测试。
//
// 只按显式 provider_call_ref(prun/pcall) 绑定；turn/time/name/hash 不参与关联。
// 本文件不 import fs/os/DatabaseSync，不创建 run scope/DB；callrefs-03 记录语义
// 用 Node 标准 JSON 模块加载受跟踪静态输入（属于代码/输入加载，不是业务 IO），
// 真实 SQLite 读边界在邻接 `authoring_call_evidence_io.test.mjs`。
import assert from "node:assert/strict";
import test from "node:test";
import callrefs03 from "./fixtures/callrefs-03-native-id-provenance.json" with { type: "json" };
import {
  PARENT,
  RUN,
  SESSION,
  WORK,
  WORKSPACE,
  assistant,
  base,
  call,
  exchange,
  nativeCall,
  pair,
  rawCall,
  scope,
  sseBase,
  sseExchange,
} from "./fixtures/authoring_call_fixture.mjs";
import { joinNativeCallEvidence } from "./authoring_call_evidence.mjs";

// 正式夹具一律携带真实 transcript.run 身份；缺/错 run 的负例仍直接调用纯入口。
const result = (patch = {}) => {
  const value = { ...base(), ...patch };
  value.transcript = { run: scope(), ...value.transcript };
  return joinNativeCallEvidence(value);
};
const checks = (patch) => result(patch).checks;
const reasons = (patch) => result(patch).failures.map((failure) => failure.reason);
const allPass = (value) => assert.deepEqual(Object.values(value.checks), [true, true, true, true, true]);

const sseResult = (patch = {}) => {
  const value = { ...sseBase(), ...patch };
  value.transcript = { run: scope(), ...value.transcript };
  return joinNativeCallEvidence(value);
};

test("显式 pcall+prun 唯一配对时逐调用与 canonical 原文一致", () => {
  const value = result();
  allPass(value);
  assert.deepEqual(value.refs.provider_run_refs, ["prun-1"]);
  assert.deepEqual(value.refs.provider_call_refs, ["pcall-1"]);
  assert.deepEqual(value.counts, {
    provider_runs: 1,
    bound_requests: 1,
    completed: 1,
    errors: 0,
    consumed_provider_calls: 1,
  });
  assert.equal(value.records.length, 1);
  assert.ok(!JSON.stringify(value.failures).includes("核对全章"));
  assert.ok(!JSON.stringify(value.refs).includes("核对全章"));
});

test("无 finite_mode_name 的运行按完整模式计数，报告不改变既有判据", () => {
  const value = result();
  allPass(value);
  assert.deepEqual(value.finite_modes, { restricted: [], complete_count: 1 });
});

test("同 parent 的另一 run 记录不得计入本 run；混入其 ProviderRun 行则 ownership 失败", () => {
  const foreign = exchange(9, {
    refs: { providerCallRef: "pcall-foreign", providerRunRef: "prun-foreign" },
    calls: [call("native-foreign", "judgment_decision", { action: "foreign" })],
  });
  const value = result({ records: [foreign, ...base().records] });
  allPass(value);
  assert.deepEqual(value.refs.provider_run_refs, ["prun-1"]);
  assert.equal(value.records.length, 1);

  const mixed = result({
    records: base().records,
    providerRuns: [...base().providerRuns, pair(9, { id: "prun-foreign", provider_call_ref: "pcall-foreign", agent_run_id: "run-foreign" })],
  });
  assert.equal(mixed.checks.native_call_pairs_owned, false);
  assert.equal(mixed.checks.native_call_pairs_bound, false);
  assert.ok(mixed.failures.some((failure) => failure.reason === "mismatched" && failure.refs.provider_run_ref === "prun-foreign"));
});

test("重复 native id 跨两次调用各按自身 pcall+prun 区分，不靠 canonical 后缀猜", () => {
  const value = result({
    providerRuns: [pair(1), pair(2)],
    records: [
      exchange(1, { calls: [call("native-submit", "submit_tentative_artifact", { body: "first" })] }),
      exchange(2, { calls: [call("native-submit", "submit_tentative_artifact", { body: "second" })] }),
    ],
    transcript: {
      messages: [
        assistant(1, [{ type: "tool_call", call_id: "native-submit", name: "submit_tentative_artifact", arguments: { body: "first" } }]),
        assistant(2, [{ type: "tool_call", call_id: "native-submit:2", provider_call_id: "native-submit", name: "submit_tentative_artifact", arguments: { body: "second" } }]),
      ],
    },
    consumedProviderCalls: 2,
  });
  allPass(value);

  const withoutOriginalId = result({
    providerRuns: [pair(1), pair(2)],
    records: [
      exchange(1, { calls: [call("native-submit", "submit_tentative_artifact", { body: "first" })] }),
      exchange(2, { calls: [call("native-submit", "submit_tentative_artifact", { body: "second" })] }),
    ],
    transcript: {
      messages: [
        assistant(1, [{ type: "tool_call", call_id: "native-submit", name: "submit_tentative_artifact", arguments: { body: "first" } }]),
        assistant(2, [{ type: "tool_call", call_id: "native-submit:2", name: "submit_tentative_artifact", arguments: { body: "second" } }]),
      ],
    },
    consumedProviderCalls: 2,
  });
  assert.equal(withoutOriginalId.checks.native_call_success_matches_canonical, false);
});

test("传输失败后重试成功：error pair 无 assistant，成功 pair 保留原文", () => {
  const value = result({
    providerRuns: [pair(1, { status: "failed" }), pair(2)],
    records: [
      exchange(1, { status: "error" }),
      exchange(2, { content: "重试成功", calls: [call("native-retry", "judgment_decision", { action: "retry" })] }),
    ],
    transcript: {
      messages: [
        assistant(2, [
          { type: "text", text: "重试成功" },
          { type: "tool_call", call_id: "native-retry", name: "judgment_decision", arguments: { action: "retry" } },
        ]),
      ],
    },
    consumedProviderCalls: 2,
  });
  allPass(value);
  assert.equal(value.counts.completed, 1);
  assert.equal(value.counts.errors, 1);

  const leaked = result({
    providerRuns: [pair(1, { status: "failed" }), pair(2)],
    records: [exchange(1, { status: "error" }), exchange(2)],
    transcript: {
      messages: [assistant(1, [{ type: "tool_call", call_id: "native-forged", name: "judgment_decision", arguments: {} }])],
    },
    consumedProviderCalls: 2,
  });
  assert.equal(leaked.checks.native_call_errors_have_no_assistant, false);
  assert.ok(leaked.failures.some((failure) => failure.reason === "mismatched" && failure.phase === "error"));

  const partialLeak = result({
    providerRuns: [pair(1, { status: "failed" })],
    records: [exchange(1, { status: "error" })],
    transcript: {
      messages: [{ ...assistant(1, []), provider_run_ref: "prun-other" }],
    },
  });
  assert.equal(partialLeak.checks.native_call_errors_have_no_assistant, false);
  assert.ok(partialLeak.failures.some((failure) => failure.phase === "error"));
});

test("一次响应内多工具共享 pcall，每个 call 逐项对照并可独立失败", () => {
  const calls = [
    call("native-a", "judgment_decision", { action: "read", nested: { z: 1, a: 2 } }),
    call("native-b", "submit_tentative_artifact", { items: [{ id: "one" }] }),
  ];
  const blocks = [
    { type: "tool_call", call_id: "native-a", name: "judgment_decision", arguments: { nested: { a: 2, z: 1 }, action: "read" } },
    { type: "tool_call", call_id: "native-b", name: "submit_tentative_artifact", arguments: { items: [{ id: "one" }] } },
  ];
  const patch = { records: [exchange(1, { calls })], transcript: { messages: [assistant(1, blocks)] } };
  allPass(result(patch));

  for (const mutate of [
    (value) => { value.blocks[1].name = "report_quality_findings"; },
    (value) => { value.blocks[0].arguments.action = "write"; },
    (value) => { value.blocks.pop(); },
    (value) => { value.calls.reverse(); },
  ]) {
    const changed = structuredClone(patch);
    mutate({ blocks: changed.transcript.messages[0].blocks, calls: changed.records[0].response.body.tool_calls });
    assert.equal(checks(changed).native_call_success_matches_canonical, false);
  }
});

test("末次响应没有后续请求回显时仍按 refs 匹配", () => {
  const value = result();
  allPass(value);
  assert.equal(value.records.length, 1);
  assert.equal(value.records[0].request_body.messages.length, 1);
});

test("缺记录、重复记录、重复 pcall/prun 或缺 ref 分别报告 missing/duplicate/mismatched", () => {
  assert.ok(reasons({ records: [] }).includes("missing"));

  const duplicateRecord = result({ records: [...base().records, structuredClone(base().records[0])] });
  assert.equal(duplicateRecord.checks.native_call_pairs_bound, false);
  assert.ok(duplicateRecord.failures.some((failure) => failure.reason === "duplicate"));

  const duplicateCall = result({ providerRuns: [pair(1), pair(2, { provider_call_ref: "pcall-1", id: "prun-2" })] });
  assert.equal(duplicateCall.checks.native_call_pairs_bound, false);
  assert.ok(duplicateCall.failures.some((failure) => failure.reason === "duplicate"));

  const duplicateRun = result({ providerRuns: [pair(1), pair(1)] });
  assert.ok(duplicateRun.failures.some((failure) => failure.reason === "duplicate"));

  const wrongRun = result({
    providerRuns: [pair(1), pair(2)],
    records: [exchange(1, { refs: { providerRunRef: "prun-2" } })],
    transcript: { messages: [assistant(1, [])] },
    consumedProviderCalls: 2,
  });
  assert.equal(wrongRun.checks.native_call_pairs_bound, false);
  assert.ok(wrongRun.failures.some((failure) => failure.reason === "mismatched"));

  const missingRunRef = result({ records: [exchange(1, { refs: { providerRunRef: "" } })] });
  assert.equal(missingRunRef.checks.native_call_pairs_bound, false);
  assert.ok(missingRunRef.failures.some((failure) => failure.reason === "missing" && failure.refs.record_index === 0));
  assert.ok(!missingRunRef.failures.some((failure) => failure.reason === "mismatched" && failure.refs.record_index === 0));
});

test("跨 scope 的 ownership 字段全部拒绝；workspace 独立于 work 不强制相等", () => {
  for (const overrides of [
    { agent_run_id: "run-other" },
    { workspace_id: "workspace-other" },
    { work_id: "work-other" },
    { session_id: "session-other" },
    { parent_turn_ref: "message-other" },
  ]) {
    const value = result({ providerRuns: [pair(1, overrides)] });
    assert.equal(value.checks.native_call_pairs_owned, false, JSON.stringify(overrides));
    assert.equal(value.checks.native_call_pairs_bound, false);
  }
  assert.notEqual(WORKSPACE, WORK);
  allPass(result());
});

test("transcript.run 的 5 个身份必须与调用 scope 逐一一致", () => {
  allPass(result());
  for (const field of ["run_id", "workspace_id", "work_id", "session_id", "parent_turn_ref"]) {
    const missing = base();
    delete missing.transcript.run[field];
    const missingResult = joinNativeCallEvidence(missing);
    assert.equal(missingResult.checks.native_call_pairs_owned, false, field);
    assert.ok(missingResult.failures.some(
      (failure) => failure.reason === "missing" && failure.phase === "ownership" && failure.refs.field === `transcript.run.${field}`,
    ));

    const mismatched = base();
    mismatched.transcript.run[field] = "other";
    const mismatchedResult = joinNativeCallEvidence(mismatched);
    assert.equal(mismatchedResult.checks.native_call_pairs_owned, false, field);
    assert.ok(mismatchedResult.failures.some(
      (failure) => failure.reason === "mismatched" && failure.phase === "ownership" && failure.refs.field === `transcript.run.${field}`,
    ));
  }

  for (const run of [undefined, null, "run-as-string"]) {
    const missing = base();
    if (run === undefined) delete missing.transcript.run;
    else missing.transcript.run = run;
    const value = joinNativeCallEvidence(missing);
    assert.equal(value.checks.native_call_pairs_owned, false);
    assert.ok(value.failures.some(
      (failure) => failure.reason === "missing" && failure.phase === "ownership" && failure.refs.field === "transcript.run",
    ));
  }
});

test("配对记录显式 work/session 必须一致，workspace 可选但提供即核对，turn_id 不承担绑定", () => {
  for (const field of ["work_id", "session_id"]) {
    const missing = base();
    delete missing.records[0][field];
    const missingResult = joinNativeCallEvidence(missing);
    assert.equal(missingResult.checks.native_call_pairs_bound, false, field);
    assert.ok(missingResult.failures.some(
      (failure) => failure.reason === "missing" && failure.phase === "binding" && failure.refs.field === field,
    ));

    const mismatched = base();
    mismatched.records[0][field] = "other";
    const mismatchedResult = joinNativeCallEvidence(mismatched);
    assert.equal(mismatchedResult.checks.native_call_pairs_bound, false, field);
    assert.ok(mismatchedResult.failures.some(
      (failure) => failure.reason === "mismatched" && failure.phase === "binding" && failure.refs.field === field,
    ));
  }

  // logger 未提供 workspace_id：不得因此强制 workspace == work，也不得补造。
  assert.equal(Object.prototype.hasOwnProperty.call(base().records[0], "workspace_id"), false);
  allPass(result());
  const withWorkspace = base();
  withWorkspace.records[0].workspace_id = WORKSPACE;
  allPass(result(withWorkspace));
  for (const workspace of ["workspace-other", WORK, ""]) {
    const changed = base();
    changed.records[0].workspace_id = workspace;
    const value = joinNativeCallEvidence(changed);
    assert.equal(value.checks.native_call_pairs_bound, false, workspace);
    assert.ok(value.failures.some(
      (failure) => failure.phase === "binding" && failure.refs.field === "workspace_id",
    ));
  }

  const crossTurn = base();
  crossTurn.records[0].turn_id = "other-parent:agent:1";
  const crossTurnResult = joinNativeCallEvidence(crossTurn);
  assert.equal(crossTurnResult.checks.native_call_pairs_bound, false);
  assert.ok(crossTurnResult.failures.some(
    (failure) => failure.reason === "mismatched" && failure.refs.field === "turn_id",
  ));
  const parentOnly = base();
  parentOnly.records[0].turn_id = PARENT;
  allPass(result(parentOnly));
});

test("fixture v1 error.body 只含 error；顶层成功字段不得混入", () => {
  const failed = (body) => result({
    providerRuns: [pair(1, { status: "failed" })],
    records: [exchange(1, { status: "error", response: { status: "error", body } })],
    transcript: { run: scope(), messages: [] },
  });
  allPass(failed({ error: ["timeout", "已超时", { diagnostic: "retryable" }] }));
  for (const extra of [
    { content: "伪造正文" },
    { tool_calls: [call("fake", "read_work", {})] },
    { id: "fake" },
  ]) {
    const value = failed({ error: { reason: "transport_failed" }, ...extra });
    assert.equal(value.checks.native_call_errors_have_no_assistant, false, JSON.stringify(extra));
    assert.ok(value.failures.some((failure) => failure.reason === "unsupported"));
  }
});

test("嵌套 function 形状不是 fixture v1 Provider.Result，不能静默兼容", () => {
  const value = base();
  const flat = value.records[0].response.body.tool_calls[0];
  value.records[0].response.body.tool_calls[0] = {
    function: { id: flat.id, name: flat.name, arguments: flat.arguments },
  };
  assert.equal(checks(value).native_call_success_matches_canonical, false);
  assert.ok(result(value).failures.some((failure) => failure.phase === "success"));
});

test("响应、助手文本、工具名、参数、native id 篡改均拒绝且不补齐", () => {
  const patches = [
    (value) => { value.records[0].response.body.content = "伪造文本"; },
    (value) => { value.transcript.messages[1].blocks[0].text = "被改写的助手文本"; },
    (value) => { value.records[0].response.body.tool_calls[0].name = "report_quality_findings"; },
    (value) => { value.transcript.messages[1].blocks[1].name = "report_quality_findings"; },
    (value) => { value.records[0].response.body.tool_calls[0].arguments.action = "write"; },
    (value) => { value.transcript.messages[1].blocks[1].arguments.action = "write"; },
    (value) => { value.records[0].response.body.tool_calls[0].id = "native-other"; },
    (value) => { value.transcript.messages[1].blocks[1].call_id = "native-other"; },
  ];
  for (const mutate of patches) {
    const value = structuredClone(base());
    mutate(value);
    assert.equal(checks(value).native_call_success_matches_canonical, false);
  }
});

test("真实 Result 的 parsed arguments + raw_arguments 两者保留时按 raw 原字节对账", () => {
  // Provider.Result 可同时带解析 map 与原始 string；IR producer 优先 raw，fixture logger 两者都留。
  const withRaw = (raw, parsed = { action: "read" }) => {
    const value = base();
    value.records[0].response.body.tool_calls[0].arguments = parsed;
    value.records[0].response.body.tool_calls[0].raw_arguments = raw;
    value.transcript.messages[1].blocks[1].arguments = parsed;
    value.transcript.messages[1].blocks[1].raw_arguments = raw;
    return value;
  };
  allPass(result(withRaw('{"action":"read"}')));
  allPass(result(withRaw(' { "action": "read" } ')));
  const parsedMismatch = withRaw('{"action":"read"}');
  parsedMismatch.transcript.messages[1].blocks[1].arguments = { action: "write" };
  assert.equal(checks(parsedMismatch).native_call_success_matches_canonical, false);
  const whitespaceMismatch = withRaw(' { "action": "read" } ');
  whitespaceMismatch.records[0].response.body.tool_calls[0].raw_arguments = '{"action":"read"}';
  assert.equal(checks(whitespaceMismatch).native_call_success_matches_canonical, false);

  // 无效 JSON 原文仍按 raw 字节对账；两侧解析都是 {}，不得因解析失败而丢掉可对账事实。
  allPass(result(withRaw("not-json", {})));
  const invalidParsedMismatch = withRaw("not-json", {});
  invalidParsedMismatch.records[0].response.body.tool_calls[0].arguments = { action: "read" };
  assert.equal(checks(invalidParsedMismatch).native_call_success_matches_canonical, false);

  const rawType = withRaw("7");
  rawType.transcript.messages[1].blocks[1].raw_arguments = 7;
  assert.equal(checks(rawType).native_call_success_matches_canonical, false);
  assert.ok(reasons(rawType).includes("encode_failed"));

  const missingResponseRaw = base();
  missingResponseRaw.transcript.messages[1].blocks[1].raw_arguments = "{}";
  assert.equal(checks(missingResponseRaw).native_call_success_matches_canonical, false);
  assert.ok(reasons(missingResponseRaw).includes("encode_failed"));

  const missingCanonicalRaw = base();
  missingCanonicalRaw.records[0].response.body.tool_calls[0].raw_arguments = "{}";
  assert.equal(checks(missingCanonicalRaw).native_call_success_matches_canonical, false);
  assert.ok(reasons(missingCanonicalRaw).includes("encode_failed"));

  // 真实 IR 同时保留 parsed map；只有 raw 一侧 parsed 缺失属不完整形状，不能静默通过。
  const missingCanonicalParsed = withRaw("{}", {});
  delete missingCanonicalParsed.transcript.messages[1].blocks[1].arguments;
  assert.equal(checks(missingCanonicalParsed).native_call_success_matches_canonical, false);
  assert.ok(reasons(missingCanonicalParsed).includes("encode_failed"));

  const missingResponseParsed = withRaw("{}", {});
  delete missingResponseParsed.records[0].response.body.tool_calls[0].arguments;
  assert.equal(checks(missingResponseParsed).native_call_success_matches_canonical, false);
  assert.ok(reasons(missingResponseParsed).includes("encode_failed"));

  const invalidJson = base();
  invalidJson.records[0].response.body.tool_calls[0].arguments = "not-json";
  delete invalidJson.transcript.messages[1].blocks[1].raw_arguments;
  assert.ok(reasons(invalidJson).includes("encode_failed"));

  const semantic = base();
  semantic.records[0].response.body.tool_calls[0].arguments = { nested: { z: 1, a: 2 }, action: "read" };
  semantic.transcript.messages[1].blocks[1].arguments = { action: "read", nested: { a: 2, z: 1 } };
  delete semantic.transcript.messages[1].blocks[1].raw_arguments;
  allPass(result(semantic));
});

test("Provider.Result.arguments 本身是 JSON 原文时按同一比较事实归一", () => {
  const raw = ' { "action": "read" } ';
  const withArgumentsString = (text, parsed = { action: "read" }) => {
    const value = base();
    value.records[0].response.body.tool_calls[0] = {
      id: "native-judgment",
      name: "judgment_decision",
      arguments: text,
    };
    value.transcript.messages[1].blocks[1] = {
      type: "tool_call",
      call_id: "native-judgment",
      name: "judgment_decision",
      arguments: parsed,
      raw_arguments: text,
    };
    return value;
  };
  allPass(result(withArgumentsString(raw)));
  allPass(result(withArgumentsString("not-json", {})));

  // 原文空白逐字比较，不 trim。
  const whitespace = withArgumentsString(raw);
  whitespace.transcript.messages[1].blocks[1].raw_arguments = '{"action":"read"}';
  assert.equal(checks(whitespace).native_call_success_matches_canonical, false);

  // 非对象 JSON 原文解析为 {}，raw 仍保留且可逐字对账。
  const nonObject = withArgumentsString('[{"a":1}]', {});
  allPass(result(nonObject));

  // raw 与 arguments 字符串并存不是 producer 形状，不能靠选择一侧通过。
  const bothStrings = base();
  const call = { id: "native-judgment", name: "judgment_decision", raw_arguments: raw, arguments: raw };
  const block = { type: "tool_call", call_id: "native-judgment", name: "judgment_decision", raw_arguments: raw, arguments: raw };
  bothStrings.records[0].response.body.tool_calls[0] = call;
  bothStrings.transcript.messages[1].blocks[1] = block;
  assert.equal(checks(bothStrings).native_call_success_matches_canonical, false);
  assert.ok(reasons(bothStrings).includes("encode_failed"));

  // raw 必须是原始字节字符串；两侧同时伪造非字符串 raw 也不能通过。
  const nonStringRaw = base();
  const nonStringCall = nonStringRaw.records[0].response.body.tool_calls[0];
  const nonStringBlock = nonStringRaw.transcript.messages[1].blocks[1];
  nonStringCall.raw_arguments = 7;
  nonStringCall.arguments = {};
  nonStringBlock.raw_arguments = 7;
  nonStringBlock.arguments = {};
  assert.equal(checks(nonStringRaw).native_call_success_matches_canonical, false);
  assert.ok(reasons(nonStringRaw).includes("encode_failed"));
});

test("两侧 parsed 同时改写不能覆盖同一 raw 原文的权威解析", () => {
  const value = base();
  const raw = '{"action":"read"}';
  const call = value.records[0].response.body.tool_calls[0];
  const block = value.transcript.messages[1].blocks[1];
  call.raw_arguments = block.raw_arguments = raw;
  call.arguments = block.arguments = { action: "write" };
  assert.equal(checks(value).native_call_success_matches_canonical, false);
});

test("turn_id 直等 parent 合法；仅精确 :agent:正整数 后缀核对 parent", () => {
  const withTurn = (turnId, parent = `${PARENT}:agent:3`) => {
    const value = base();
    value.scope = scope({ parent_turn_ref: parent });
    value.transcript.run = scope({ parent_turn_ref: parent });
    value.providerRuns[0] = pair(1, { parent_turn_ref: parent });
    value.records[0] = { ...value.records[0], turn_id: turnId };
    return joinNativeCallEvidence(value);
  };

  // 修订 parent 本身可能已是源 step turn；直等即合法，不再按后缀猜。
  allPass(withTurn(`${PARENT}:agent:3`));
  // 嵌套 step：末尾精确 :agent:正整数 的前缀就是 parent。
  allPass(withTurn(`${PARENT}:agent:3:agent:2`));
  // 普通 agent step 仍按 parent 前缀核对。
  allPass(withTurn(`${PARENT}:agent:3`, PARENT));
  // 未知格式不伪造父子关系，按 pcall 归属。
  allPass(withTurn("turn_rev", `${PARENT}:agent:3`));
  allPass(withTurn(`${PARENT}:agent:0`, `${PARENT}:agent:3`));

  for (const turnId of ["other-parent:agent:2", `${PARENT}:agent:4:agent:1`]) {
    const value = withTurn(turnId);
    assert.equal(value.checks.native_call_pairs_bound, false, turnId);
    assert.ok(value.failures.some(
      (failure) => failure.reason === "mismatched" && failure.refs.field === "turn_id",
    ), turnId);
  }
});

test("记录顺序保持原日志相对顺序，provider run 顺序不参与 prefix", () => {
  const value = result({
    providerRuns: [pair(2), pair(1)],
    records: [
      exchange(2, { calls: [call("native-2", "submit_tentative_artifact", { step: 2 })] }),
      exchange(9, { refs: { providerCallRef: "pcall-foreign", providerRunRef: "prun-foreign" } }),
      exchange(1, { calls: [call("native-1", "judgment_decision", { step: 1 })] }),
    ],
    transcript: {
      messages: [
        assistant(1, [{ type: "tool_call", call_id: "native-1", name: "judgment_decision", arguments: { step: 1 } }]),
        assistant(2, [{ type: "tool_call", call_id: "native-2", name: "submit_tentative_artifact", arguments: { step: 2 } }]),
      ],
    },
    consumedProviderCalls: 2,
  });
  allPass(value);
  assert.deepEqual(value.records.map((record) => record.provider_run_ref), ["prun-2", "prun-1"]);
  assert.deepEqual(value.refs.provider_run_refs, ["prun-2", "prun-1"]);
});

test("旧日志无 response/refs 或格式不明时不能通过；零调用不得签字", () => {
  const legacy = { ...exchange(1), provider_call_ref: undefined, provider_run_ref: undefined };
  delete legacy.request_format;
  delete legacy.response_format;
  delete legacy.response;
  const old = result({ records: [legacy] });
  assert.equal(old.checks.native_call_pairs_bound, false);
  assert.ok(old.failures.some((failure) => failure.reason === "missing"));

  const unsupported = result({ records: [{ ...base().records[0], response_format: "http_provider_result/v1" }] });
  assert.equal(unsupported.checks.native_call_pairs_bound, false);
  assert.ok(unsupported.failures.some((failure) => failure.reason === "unsupported"));

  const noResponse = result({ records: [{ ...base().records[0], response: undefined }] });
  assert.ok(noResponse.failures.some((failure) => failure.reason === "unsupported"));

  const zero = result({ providerRuns: [], records: [], consumedProviderCalls: 0 });
  assert.equal(zero.checks.native_call_counts_match_consumed, false);
  assert.equal(zero.checks.native_call_pairs_bound, false);
  assert.equal(zero.checks.native_call_pairs_owned, false);
  assert.ok(zero.failures.some((failure) => failure.phase === "counts"));
});

test("完成+错误计数必须对齐 scoped ProviderRun 与实际 consumed provider_calls", () => {
  assert.equal(checks({ consumedProviderCalls: 2 }).native_call_counts_match_consumed, false);
  assert.ok(reasons({ consumedProviderCalls: 2 }).includes("mismatched"));
  assert.equal(checks({ consumedProviderCalls: undefined }).native_call_counts_match_consumed, false);
  assert.ok(reasons({ consumedProviderCalls: undefined }).includes("missing"));
  assert.equal(checks({ consumedProviderCalls: "1" }).native_call_counts_match_consumed, false);
  assert.equal(checks({ consumedProviderCalls: 0 }).native_call_counts_match_consumed, false);
  assert.equal(checks({ providerRuns: [pair(1), pair(2)] }).native_call_counts_match_consumed, false);
  assert.ok(result({ providerRuns: [pair(1), pair(2)] }).failures.some((failure) => failure.phase === "counts"));
});

test("canonical assistant 的跨 run / 半截 refs 不得被当作本 run 绑定", () => {
  const foreign = result({
    transcript: {
      messages: [assistant("foreign", [{ type: "tool_call", call_id: "native-1", name: "judgment_decision", arguments: { action: "read" } }])],
    },
  });
  assert.equal(foreign.checks.native_call_pairs_bound, false);

  const partial = result({
    transcript: {
      messages: [assistant(1, [{ type: "tool_call", call_id: "native-judgment", name: "judgment_decision", arguments: { action: "read" } }], { provider_run_ref: undefined })],
    },
  });
  assert.equal(partial.checks.native_call_pairs_bound, false);
  assert.ok(partial.failures.some(
    (failure) => failure.reason === "mismatched" && failure.phase === "binding" && failure.refs.field === "assistant_refs",
  ));

  const onlyPartial = result({
    transcript: {
      messages: [assistant(1, [{ type: "tool_call", call_id: "native-judgment", name: "judgment_decision", arguments: { action: "read" } }], { provider_run_ref: "prun-other" })],
    },
  });
  assert.equal(onlyPartial.checks.native_call_pairs_bound, false);
  assert.ok(onlyPartial.failures.some((failure) => failure.phase === "success"));

  const unbound = result({
    transcript: {
      messages: [
        { role: "assistant", blocks: [{ type: "tool_call", call_id: "native-old", name: "judgment_decision", arguments: {} }] },
        ...base().transcript.messages,
      ],
    },
  });
  assert.equal(unbound.checks.native_call_pairs_bound, false);
  assert.ok(unbound.failures.some(
    (failure) => failure.reason === "missing" && failure.phase === "binding" && failure.refs.message_index === 0,
  ));

  const duplicated = result({
    transcript: { messages: [assistant(1, []), assistant(1, [])] },
  });
  assert.equal(duplicated.checks.native_call_pairs_bound, false);
  assert.ok(duplicated.failures.some((failure) => failure.reason === "duplicate"));
});

test("ownership 缺 id/pcall 与非对象行按 missing/mismatched 拒绝", () => {
  const nonObject = result({ providerRuns: [null] });
  assert.equal(nonObject.checks.native_call_pairs_owned, false);
  assert.ok(nonObject.failures.some((failure) => failure.reason === "mismatched"));

  for (const row of [
    { ...pair(1), id: "" },
    { ...pair(1), provider_call_ref: "" },
  ]) {
    const value = result({ providerRuns: [row], records: [] });
    assert.equal(value.checks.native_call_pairs_owned, false);
    assert.ok(value.failures.some((failure) => failure.reason === "missing"));
    assert.deepEqual(value.refs.provider_run_refs, []);
    assert.equal(value.counts.provider_runs, 0);
  }
  const mixedOwnership = result({ providerRuns: [pair(1, { workspace_id: "workspace-other" })] });
  assert.deepEqual(mixedOwnership.refs.provider_run_refs, []);
  assert.equal(mixedOwnership.counts.provider_runs, 0);
});

test("transcript 与非成功响应形状在入口统一拒绝；content 为空仍可比较", () => {
  assert.throws(
    () => joinNativeCallEvidence({ ...base(), transcript: null }),
    /transcript\.messages/,
  );
  for (const content of [null, undefined]) {
    const value = base();
    value.records[0].response.body.content = content;
    value.transcript.messages[1].blocks = value.transcript.messages[1].blocks.filter(
      (block) => block.type !== "text",
    );
    allPass(result(value));
  }
});

test("固定 fixture 格式的每个入口都拒绝未知形状", () => {
  const mutations = [
    (value) => { delete value.records[0].request_body; },
    (value) => { value.records[0].response = null; },
    (value) => { value.records[0].response.status = "pending"; },
    (value) => { value.records[0].response = { status: "ok", body: {} }; },
    (value) => { value.records[0].response.body.content = 7; },
    (value) => { value.records[0].response = { status: "error", body: {} }; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(base());
    mutate(value);
    const joined = joinNativeCallEvidence(value);
    assert.equal(joined.checks.native_call_pairs_bound, false);
    assert.ok(joined.failures.some((failure) => failure.reason === "unsupported"));
  }
});

test("error pair 只接受真实非成功终态；completed 不得冒充 error", () => {
  const failed = result({
    providerRuns: [pair(1, { status: "failed" })],
    records: [exchange(1, { status: "error" })],
    transcript: { messages: [] },
  });
  allPass(failed);
  assert.equal(failed.counts.errors, 1);

  for (const status of ["completed", "running", "cancel_requested"]) {
    const wrong = result({
      providerRuns: [pair(1, { status })],
      records: [exchange(1, { status: "error" })],
      transcript: { messages: [] },
    });
    assert.equal(wrong.checks.native_call_errors_have_no_assistant, false, status);
  }
  allPass(result({
    providerRuns: [pair(1, { status: "cancelled" })],
    records: [exchange(1, { status: "error" })],
    transcript: { messages: [] },
  }));
});

test("成功 pair 的运行终态、半截 canonical refs 与非字符串文本都拒绝", () => {
  const failedRun = result({ providerRuns: [pair(1, { status: "failed" })] });
  assert.equal(failedRun.checks.native_call_success_matches_canonical, false);

  const partial = base();
  partial.transcript.messages.push({
    role: "assistant",
    provider_call_ref: "pcall-1",
    provider_run_ref: "prun-other",
    blocks: [],
  });
  assert.equal(checks(partial).native_call_success_matches_canonical, false);
  assert.ok(result(partial).failures.some(
    (failure) => failure.phase === "success" && failure.refs.field === "assistant_refs",
  ));

  const nonStringText = base();
  nonStringText.transcript.messages[1].blocks[0].text = 7;
  assert.equal(checks(nonStringText).native_call_success_matches_canonical, false);
  assert.ok(reasons(nonStringText).includes("encode_failed"));
});

test("参数缺少可比较原文或 raw 一侧非字符串时 encode_failed", () => {
  const missingArguments = base();
  delete missingArguments.records[0].response.body.tool_calls[0].arguments;
  assert.equal(checks(missingArguments).native_call_success_matches_canonical, false);
  assert.ok(reasons(missingArguments).includes("encode_failed"));

  const rawAgainstObject = base();
  rawAgainstObject.transcript.messages[1].blocks[1].raw_arguments = "{}";
  rawAgainstObject.records[0].response.body.tool_calls[0].arguments = {};
  assert.equal(checks(rawAgainstObject).native_call_success_matches_canonical, false);
  assert.ok(reasons(rawAgainstObject).includes("encode_failed"));

  // 真实 producer：raw 是合法 JSON 但非对象时解析为 {}，raw 原字节仍保留。
  const nonObjectRaw = base();
  const nonObjectText = '[{"a":1}]';
  nonObjectRaw.records[0].response.body.tool_calls[0].arguments = {};
  nonObjectRaw.records[0].response.body.tool_calls[0].raw_arguments = nonObjectText;
  nonObjectRaw.transcript.messages[1].blocks[1].arguments = {};
  nonObjectRaw.transcript.messages[1].blocks[1].raw_arguments = nonObjectText;
  allPass(result(nonObjectRaw));

  // 扁平 parsed-only 必须是 JSON 对象；数组/原始值不是 producer 支持的 map 形状。
  for (const parsed of [[{ a: 1 }], 1]) {
    const unsupported = base();
    unsupported.records[0].response.body.tool_calls[0].arguments = parsed;
    unsupported.transcript.messages[1].blocks[1].arguments = parsed;
    assert.equal(checks(unsupported).native_call_success_matches_canonical, false, JSON.stringify(parsed));
    assert.ok(reasons(unsupported).includes("encode_failed"));
  }

  const blankIds = base();
  blankIds.records[0].response.body.tool_calls[0].id = "";
  blankIds.transcript.messages[1].blocks[1].call_id = "";
  assert.equal(checks(blankIds).native_call_success_matches_canonical, false);
});

test("夹具显式空 provider ref 保留原值，不被默认值吞掉", () => {
  const fixture = exchange(1, { refs: { providerCallRef: "", providerRunRef: "" } });
  assert.equal(fixture.provider_call_ref, "");
  assert.equal(fixture.provider_run_ref, "");
  const sse = sseExchange(2, { refs: { providerCallRef: "", providerRunRef: "" } });
  assert.equal(sse.provider_call_ref, "");
  assert.equal(sse.provider_run_ref, "");
});

test("真实 SSE decoder 成功记录按 Chat wire 只对账工具，正文不参与且标明 tool-only", () => {
  const value = sseResult();
  allPass(value);
  assert.equal(value.measured.sse_decoder_tool_only_count, 1);
  assert.equal(value.counts.completed, 1);
  assert.equal(value.counts.errors, 0);
  assert.equal(value.measured.native_id_not_provided, 0);
  // fixture 来源不标 SSE；SSE 记录按真实 response 数字 2xx 计入 completed。
  assert.equal(result().measured.sse_decoder_tool_only_count, 0);
});

test("SSE 工具参数按 raw 原始字节对账，空白不 trim，篡改 parsed/raw 都拒绝", () => {
  const raw = ' { "character_ref": "character:1" } ';
  const calls = [
    { id: "native-read", name: "read_character", arguments: { character_ref: "character:1" }, raw_arguments: raw },
  ];
  const blocks = [
    { type: "tool_call", call_id: "native-read", name: "read_character", arguments: { character_ref: "character:1" }, raw_arguments: raw },
  ];
  allPass(sseResult({ records: [sseExchange(1, { calls })], transcript: { messages: [assistant(1, blocks)] } }));

  const rawTampered = structuredClone(calls);
  rawTampered[0].raw_arguments = '{"character_ref":"character:1"}';
  const rawValue = sseResult({ records: [sseExchange(1, { calls: rawTampered })], transcript: { messages: [assistant(1, blocks)] } });
  assert.equal(rawValue.checks.native_call_success_matches_canonical, false);
  assert.ok(rawValue.failures.some((failure) => failure.phase === "success" && failure.refs.field === "arguments"));

  // raw 是权威：只改 parsed 而原文未动也必须拒绝。
  const parsedTampered = structuredClone(calls);
  parsedTampered[0].arguments = { character_ref: "character:2" };
  assert.equal(
    sseResult({ records: [sseExchange(1, { calls: parsedTampered })], transcript: { messages: [assistant(1, blocks)] } })
      .checks.native_call_success_matches_canonical,
    false,
  );
});

test("SSE 响应无原生 id 时按 canonical 显式未提供通过并计数", () => {
  const value = sseResult({
    records: [sseExchange(1, { calls: [{ name: "read_character", arguments: { character_ref: "character:1" } }] })],
    transcript: {
      messages: [
        assistant(1, [
          {
            type: "tool_call",
            call_id: "call_read_character",
            provider_call_id: null,
            name: "read_character",
            arguments: { character_ref: "character:1" },
          },
        ]),
      ],
    },
  });
  allPass(value);
  assert.equal(value.measured.native_id_not_provided, 1);
});

test("SSE 两次执行引用重用原生 id：按 pcall+prun 区分，canonical 重映射通过", () => {
  const value = sseResult({
    providerRuns: [pair(1), pair(2)],
    records: [
      sseExchange(1, { calls: [call("native-submit", "submit_tentative_artifact", { body: "first" })] }),
      sseExchange(2, { calls: [call("native-submit", "submit_tentative_artifact", { body: "second" })] }),
    ],
    transcript: {
      messages: [
        assistant(1, [{ type: "tool_call", call_id: "native-submit", name: "submit_tentative_artifact", arguments: { body: "first" } }]),
        assistant(2, [
          {
            type: "tool_call",
            call_id: "native-submit:2",
            provider_call_id: "native-submit",
            name: "submit_tentative_artifact",
            arguments: { body: "second" },
          },
        ]),
      ],
    },
    consumedProviderCalls: 2,
  });
  allPass(value);
  assert.equal(value.measured.sse_decoder_tool_only_count, 2);
});

test("SSE 参数篡改、错源、event_stream 占位、非 2xx 与非 native wire 请求都不签成功", () => {
  const tampered = sseBase();
  tampered.records[0].response.body.tool_calls[0].arguments = { action: "write" };
  assert.equal(checks(tampered).native_call_success_matches_canonical, false);

  for (const source of ["event_stream", "fixture_provider_result/v1", "other"]) {
    const value = sseResult({ records: [sseExchange(1, { source })] });
    assert.equal(value.checks.native_call_pairs_bound, false, source);
    assert.equal(value.checks.native_call_success_matches_canonical, false, source);
    assert.ok(value.failures.some((failure) => failure.reason === "unsupported"), source);
  }

  const placeholder = sseResult({ records: [sseExchange(1, { body: "event_stream" })] });
  assert.equal(placeholder.checks.native_call_pairs_bound, false);
  assert.equal(placeholder.checks.native_call_success_matches_canonical, false);
  assert.ok(placeholder.failures.some((failure) => failure.reason === "unsupported"));

  const nonSuccess = sseResult({ records: [sseExchange(1, { status: 500 })] });
  assert.equal(nonSuccess.checks.native_call_pairs_bound, false);
  assert.ok(nonSuccess.failures.some((failure) => failure.reason === "unsupported"));

  // 请求仍是 fixture canonical IR（非 native wire），即使响应有 sse body 也不认。
  const irRequest = exchange(1, { calls: [call("native-judgment", "judgment_decision", { action: "read" })] });
  delete irRequest.response_format;
  irRequest.response = { status: 200, body: { source: "sse_decoder", tool_calls: irRequest.response.body.tool_calls } };
  const irValue = sseResult({ records: [irRequest] });
  assert.equal(irValue.checks.native_call_pairs_bound, false);
  assert.ok(irValue.failures.some((failure) => failure.reason === "unsupported"));

  // fixture 来源按 response_format 固定，不按 body 形状嗅探成 SSE；正文篡改仍拒。
  const fixtureWithSseBody = base();
  fixtureWithSseBody.records[0].response.body = {
    source: "sse_decoder",
    tool_calls: fixtureWithSseBody.records[0].response.body.tool_calls,
  };
  assert.equal(checks(fixtureWithSseBody).native_call_success_matches_canonical, false);

  const fixtureTampered = base();
  fixtureTampered.records[0].response.body.content = "伪造正文";
  assert.equal(checks(fixtureTampered).native_call_success_matches_canonical, false);
});

const missingNativeId = (patch = {}) =>
  result({
    records: [exchange(1, { calls: [rawCall()] })],
    transcript: { messages: [assistant(1, [nativeCall()])] },
    ...patch,
  });

test("原生 id 未提供时 canonical 显式 nil 通过对账并报告 native_id_not_provided", () => {
  for (const raw of [rawCall(), rawCall({ id: null })]) {
    const value = missingNativeId({
      records: [exchange(1, { calls: [raw] })],
    });
    allPass(value);
    assert.equal(value.measured.native_id_not_provided, 1);
    assert.deepEqual(value.failures, []);
  }
});

test("旧 canonical 缺 provider_call_id 而 raw 无 id：如实 missing provenance，不假绿", () => {
  const block = nativeCall();
  delete block.provider_call_id;
  const value = result({
    records: [exchange(1, { calls: [rawCall()] })],
    transcript: { messages: [assistant(1, [block])] },
  });
  assert.equal(value.checks.native_call_success_matches_canonical, false);
  assert.ok(
    value.failures.some(
      (failure) =>
        failure.reason === "missing" &&
        failure.phase === "success" &&
        failure.refs.field === "native_id_provenance",
    ),
  );
  assert.equal(value.measured.native_id_not_provided, 0);
});

test("显式缺失原 id 被伪造或 raw 有 id 却声称未提供都拒绝", () => {
  const forgedRaw = result({
    records: [exchange(1, { calls: [rawCall({ id: "native-forged" })] })],
    transcript: { messages: [assistant(1, [nativeCall()])] },
  });
  assert.equal(forgedRaw.checks.native_call_success_matches_canonical, false);
  assert.ok(forgedRaw.failures.some((failure) => failure.refs.field === "native_id"));

  const forgedCanonical = result({
    records: [exchange(1, { calls: [rawCall()] })],
    transcript: { messages: [assistant(1, [nativeCall({ provider_call_id: "native-forged" })])] },
  });
  assert.equal(forgedCanonical.checks.native_call_success_matches_canonical, false);
  assert.ok(forgedCanonical.failures.some((failure) => failure.refs.field === "native_id"));
});

test("空白/非字符串 raw 或 provider_call_id 是非法来源，不算正常未提供", () => {
  for (const raw of [rawCall({ id: "" }), rawCall({ id: "   " }), rawCall({ id: 7 })]) {
    const value = result({
      records: [exchange(1, { calls: [raw] })],
      transcript: { messages: [assistant(1, [nativeCall()])] },
    });
    assert.equal(value.checks.native_call_success_matches_canonical, false);
    assert.ok(value.failures.some((failure) => failure.reason === "encode_failed"));
    assert.equal(value.measured.native_id_not_provided, 0);
  }

  for (const providerCallId of ["", "   ", 7]) {
    const value = result({
      records: [exchange(1, { calls: [rawCall()] })],
      transcript: { messages: [assistant(1, [nativeCall({ provider_call_id: providerCallId })])] },
    });
    assert.equal(value.checks.native_call_success_matches_canonical, false);
    assert.ok(value.failures.some((failure) => failure.reason === "encode_failed"));
    assert.equal(value.measured.native_id_not_provided, 0);
  }
});

test("canonical 已提供原 id 映射时 raw 不同必须 mismatched；空 call_id 是非法来源", () => {
  const mappingMismatch = result({
    records: [exchange(1, { calls: [rawCall({ id: "native-other" })] })],
    transcript: {
      messages: [
        assistant(1, [
          nativeCall({ call_id: "native-submit:2", provider_call_id: "native-submit" }),
        ]),
      ],
    },
  });
  assert.equal(mappingMismatch.checks.native_call_success_matches_canonical, false);
  assert.ok(
    mappingMismatch.failures.some(
      (failure) => failure.phase === "success" && failure.refs.field === "native_id",
    ),
  );

  const blankCallId = result({
    records: [exchange(1, { calls: [rawCall()] })],
    transcript: { messages: [assistant(1, [nativeCall({ call_id: "" })])] },
  });
  assert.equal(blankCallId.checks.native_call_success_matches_canonical, false);
  assert.ok(blankCallId.failures.some((failure) => failure.reason === "encode_failed"));
  assert.ok(
    blankCallId.failures.some(
      (failure) => failure.reason === "missing" && failure.phase === "canonical",
    ),
  );
});

test("同响应多调用分别计数，缺失 id 与已有 id 不得互相冒充", () => {
  const value = result({
    providerRuns: [pair(1)],
    records: [
      exchange(1, {
        calls: [
          rawCall({ arguments: { character_ref: "character:1" } }),
          rawCall({ id: "native-2", arguments: { character_ref: "character:2" } }),
        ],
      }),
    ],
    transcript: {
      messages: [
        assistant(1, [
          nativeCall({ call_id: "call_read_character", arguments: { character_ref: "character:1" } }),
          {
            type: "tool_call",
            call_id: "native-2",
            name: "read_character",
            arguments: { character_ref: "character:2" },
          },
        ]),
      ],
    },
  });
  allPass(value);
  assert.equal(value.measured.native_id_not_provided, 1);
});

test("重复 raw 缺失 id 允许，但 canonical 内部 call_id 重复拒绝", () => {
  const duplicateMissing = result({
    records: [
      exchange(1, {
        calls: [
          rawCall({ arguments: { character_ref: "character:1" } }),
          rawCall({ arguments: { character_ref: "character:2" } }),
        ],
      }),
    ],
    transcript: {
      messages: [
        assistant(1, [
          nativeCall({ call_id: "call_read_character", arguments: { character_ref: "character:1" } }),
          nativeCall({ call_id: "call_read_character:2", arguments: { character_ref: "character:2" } }),
        ]),
      ],
    },
  });
  allPass(duplicateMissing);
  assert.equal(duplicateMissing.measured.native_id_not_provided, 2);

  const duplicateCanonical = result({
    records: [
      exchange(1, {
        calls: [
          rawCall({ arguments: { character_ref: "character:1" } }),
          rawCall({ arguments: { character_ref: "character:2" } }),
        ],
      }),
    ],
    transcript: {
      messages: [
        assistant(1, [
          nativeCall({ call_id: "call_read_character", arguments: { character_ref: "character:1" } }),
          nativeCall({ call_id: "call_read_character", arguments: { character_ref: "character:2" } }),
        ]),
      ],
    },
  });
  assert.equal(duplicateCanonical.checks.native_call_success_matches_canonical, false);
  assert.equal(duplicateCanonical.checks.native_call_pairs_bound, false);
  assert.ok(
    duplicateCanonical.failures.some(
      (failure) => failure.reason === "duplicate" && failure.phase === "canonical",
    ),
  );
});

test("pcall+同响应内 ordinal 绑定：交换 canonical 顺序必须失败", () => {
  const calls = [
    rawCall({ id: "native-a", name: "judgment_decision", arguments: { action: "read" } }),
    rawCall({ id: "native-b", name: "submit_tentative_artifact", arguments: { body: "x" } }),
  ];
  const blocks = [
    { type: "tool_call", call_id: "native-a", name: "judgment_decision", arguments: { action: "read" } },
    { type: "tool_call", call_id: "native-b", name: "submit_tentative_artifact", arguments: { body: "x" } },
  ];
  allPass(result({ records: [exchange(1, { calls })], transcript: { messages: [assistant(1, blocks)] } }));

  const swapped = result({
    records: [exchange(1, { calls })],
    transcript: { messages: [assistant(1, [blocks[1], blocks[0]])] },
  });
  assert.equal(swapped.checks.native_call_success_matches_canonical, false);
  assert.ok(swapped.failures.some((failure) => failure.phase === "success"));
});

test("fixture canonical IR 记录按真实 source format 读取并通过配对", () => {
  const irBody = (messages) => ({
    ir_version: "authoring-request-ir/v1",
    run: { run_id: RUN, workspace_id: WORKSPACE, work_id: WORK, session_id: SESSION, parent_turn_ref: PARENT },
    system: { identity_ref: "identity:writer" },
    messages,
    tools: [{ name: "judgment_decision", description: "", input_schema: {} }],
    projection: { tool_choice: "auto" },
    refs: {},
  });
  const record = exchange(1, {
    request_format: "authoring-request-ir/v1",
    request_body: irBody([
      {
        role: "user",
        provenance: "author",
        blocks: [{ type: "text", text: "核对全章" }],
        source_refs: [],
        versions: {},
      },
    ]),
    content: "已核对全章。",
    calls: [call("native-judgment", "judgment_decision", { action: "read" })],
  });
  const joined = joinNativeCallEvidence({
    scope: scope(),
    providerRuns: [pair(1)],
    records: [record],
    transcript: {
      run: scope(),
      messages: [
        {
          role: "assistant",
          provenance: "model",
          provider_call_ref: "pcall-1",
          provider_run_ref: "prun-1",
          blocks: [
            { type: "text", text: "已核对全章。" },
            {
              type: "tool_call",
              call_id: "native-judgment",
              name: "judgment_decision",
              arguments: { action: "read" },
            },
          ],
        },
      ],
    },
    consumedProviderCalls: 1,
  });
  allPass(joined);
  assert.equal(joined.records.length, 1);
});

// callrefs-03 的历史记录只是静态输入；消费者是纯 join，不读 DB/目录。
const irRequestFor = (record) => ({
  ...record,
  request_format: "authoring-request-ir/v1",
  request_body: {
    ir_version: "authoring-request-ir/v1",
    run: callrefs03.scope,
    system: { identity_ref: "identity:writer" },
    messages: [
      {
        role: "user",
        provenance: "author",
        blocks: [{ type: "text", text: "核对全章" }],
        source_refs: [],
        versions: {},
      },
    ],
    tools: [],
    projection: { tool_choice: null },
    refs: {},
  },
});

test("callrefs-03 历史 provider_prompt 记录明确 unsupported，native id 语义用现役 IR 记录复验", () => {
  const historical = joinNativeCallEvidence({
    scope: callrefs03.scope,
    providerRuns: callrefs03.providerRuns,
    records: callrefs03.records,
    transcript: callrefs03.legacyTranscript,
    consumedProviderCalls: callrefs03.consumedProviderCalls,
  });
  assert.equal(historical.checks.native_call_success_matches_canonical, false);
  assert.ok(
    historical.failures.some(
      (failure) => failure.reason === "unsupported" && failure.phase === "binding",
    ),
  );

  const records = callrefs03.records.map(irRequestFor);
  const legacy = joinNativeCallEvidence({
    scope: callrefs03.scope,
    providerRuns: callrefs03.providerRuns,
    records,
    transcript: callrefs03.legacyTranscript,
    consumedProviderCalls: callrefs03.consumedProviderCalls,
  });
  assert.equal(legacy.checks.native_call_success_matches_canonical, false);
  assert.ok(
    legacy.failures.some(
      (failure) =>
        failure.reason === "missing" &&
        failure.phase === "success" &&
        failure.refs.field === "native_id_provenance",
    ),
  );
  assert.equal(legacy.measured.native_id_not_provided, 0);

  const repairedTranscript = structuredClone(callrefs03.legacyTranscript);
  repairedTranscript.messages[0].blocks[1].provider_call_id = null;
  const repaired = joinNativeCallEvidence({
    scope: callrefs03.scope,
    providerRuns: callrefs03.providerRuns,
    records,
    transcript: repairedTranscript,
    consumedProviderCalls: callrefs03.consumedProviderCalls,
  });
  allPass(repaired);
  assert.equal(repaired.measured.native_id_not_provided, 1);
});
