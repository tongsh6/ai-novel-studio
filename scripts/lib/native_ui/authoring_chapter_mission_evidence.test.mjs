// B71 源阶段章使命证据的纯行为测试：pcall/prun/同次响应/请求 source_refs/
// basis_label/mission_derived 事件必须共同绑定；任一处不成立都失败。
// 运行：node --test scripts/lib/native_ui/authoring_chapter_mission_evidence.test.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildAuthoringCanonSnapshot } from "./authoring_canon_evidence.mjs";
import { missionSourceChecks } from "./authoring_chapter_mission_evidence.mjs";
import { scopeForProviderCall } from "./authoring_call_evidence.mjs";
import { missionWriterMaterial } from "./authoring_live_evidence.mjs";
import { sourceMissionNarrativeContext } from "./authoring_revision_evidence.mjs";
import { scopeWireMessage } from "./fixtures/authoring_request_ir.mjs";

const WORK = "22222222-2222-4222-8222-222222222222";
const OTHER_WORK = "33333333-3333-4333-8333-333333333333";
const CHAPTER_ID = "chapter-2";
const TARGET_REF = `chapter:${CHAPTER_ID}`;
const TITLE = "第02章：矿区追击战";
const START = "2026-11-02T06:14:42.000000Z";
const BEFORE = "2026-11-02T06:15:00.500000Z";
const PCALL = "pcall_mvyv6uq1_11";
const PRUN = "prun_mvyv6uq1_12";
const MISSION_ID = "cm_mvyv6uq3_1c";
const RUN_ID = "run-source-1";
const SESSION = "session-1";
const PARENT = "turn-user-1";
const MISSION_RULES = "章使命推导规则。";
const MISSION_AUTHOR = "写前推理材料";
const SCOPE_VERSIONS = { change_reason: "chapter_mission", scope_revision: 3, goal_version: 1 };
const LABEL_ADVANCE = "章功能定位：动作章";
const LABEL_AVOID = "第4章前保密：黑账编号揭示矿区抽成流向";
const LABEL_OTHER = "场次1：交锋｜目标：夺回被抢走的黑账残页";

function narrativeSource(text) {
  const hash = createHash("sha256").update(text, "utf8").digest("hex");
  return {
    source_type: "provider_output_tool_narrative",
    provider_call_ref: PCALL, provider_run_ref: PRUN, provider_output_ref: PRUN,
    tool_call_name: "chapter_mission", tool_call_narrative_field: "author_reasoning",
    source_hash: hash, narrative_hash: hash,
    source_byte_range: { start: 0, length: Buffer.byteLength(text, "utf8") },
  };
}

function responseArguments(overrides = {}) {
  return {
    author_reasoning: "核对了本章计划与作品脉络，只推进既定线索。",
    statement: "本章按计划推进，不引入新的主导冲突。",
    confidence: 0.9,
    must_advance: [
      { text: "按本章计划完成既定情节推进。", basis_ref: "plan:2:chapter_role" },
    ],
    must_avoid: [
      { text: "不得提前揭示后续章的计划信息。", basis_ref: "ledger:information:plan_info_4" },
      { text: "不得提前揭示未提供的依据。", basis_ref: "unknown:not_supplied" },
    ],
    ...overrides,
  };
}

function missionMap(overrides = {}) {
  return {
    mission_id: MISSION_ID,
    statement: "本章按计划推进，不引入新的主导冲突。",
    confidence: 0.9,
    must_advance: [
      { text: "按本章计划完成既定情节推进。", basis_ref: "plan:2:chapter_role", basis_label: LABEL_ADVANCE },
    ],
    must_avoid: [
      { text: "不得提前揭示后续章的计划信息。", basis_ref: "ledger:information:plan_info_4", basis_label: LABEL_AVOID },
    ],
    provider_call_ref: PCALL,
    status: "TENTATIVE",
    source: "model",
    derived_at: "2026-11-02T06:15:00.365773Z",
    ...overrides,
  };
}

function chapterRow({ id = CHAPTER_ID, workId = WORK, planDirection, updatedAt = START, overrides = {} } = {}) {
  return {
    id,
    work_id: workId,
    volume_id: null,
    title: id === CHAPTER_ID ? TITLE : "其它章",
    seq: id === CHAPTER_ID ? 2 : 3,
    status: "PLANNED",
    inserted_at: START,
    updated_at: updatedAt,
    summary: "章摘要",
    plan_direction: JSON.stringify(planDirection),
    future_chapter_column: "unknown",
    ...overrides,
  };
}

function tablesFor(planDirection, updatedAt = START) {
  return {
    works: [{ id: "work-row" }],
    drafts: [],
    chapters: [chapterRow({ planDirection, updatedAt })],
    volumes: [],
    scenes: [],
    characters: [],
    memory_items: [],
    ledger_entries: [],
    author_action_receipts: [],
  };
}

function snapshots({ startMission = null, beforeMission = missionMap(), beforeUpdated = BEFORE } = {}) {
  const start = buildAuthoringCanonSnapshot({
    tables: tablesFor({ chapter_role: "动作章", ...(startMission ? { chapter_mission: startMission } : {}) }),
    referenceLogs: [],
    at: START,
  });
  const before = buildAuthoringCanonSnapshot({
    tables: tablesFor(
      { chapter_role: "动作章", ...(beforeMission ? { chapter_mission: beforeMission } : {}) },
      beforeUpdated,
    ),
    referenceLogs: [],
    at: BEFORE,
  });
  return { start, before };
}

function scopeMessage() {
  return {
    role: "scope_update",
    provenance: "application",
    versions: { ...SCOPE_VERSIONS },
    source_refs: [
      { ref: "plan:2:chapter_role" },
      { ref: "ledger:information:plan_info_4" },
      { ref: "plan:2:scene:1" },
    ],
    blocks: [{
      type: "scope",
      content: {
        work_id: WORK,
        goal: { text: "推导本章使命", version: 1 },
        operation: {
          mission_inputs: {
            mode: "prose",
            chapter: { seq: 2, title: TITLE, chapter_ref: TARGET_REF },
            items: [
              { ref: "plan:2:chapter_role", group: "plan", text: LABEL_ADVANCE },
              { ref: "plan:2:scene:1", group: "plan", text: LABEL_OTHER },
              { ref: "ledger:information:plan_info_4", group: "secrecy", text: LABEL_AVOID },
            ],
            undated_foreshadow_count: 0,
            written_progress: { chapter_seq: 1, volume_seq: 1 },
          },
          runtime: {},
        },
      },
    }],
  };
}

function scopeProjection(scope = scopeMessage()) {
  return scopeWireMessage(scope.blocks[0].content, {
    versions: scope.versions,
    sourceRefs: scope.source_refs,
  }).content;
}

function transcript(messages) {
  return {
    run: {
      run_id: RUN_ID,
      workspace_id: WORK,
      work_id: WORK,
      session_id: SESSION,
      parent_turn_ref: PARENT,
      profile_ref: "prose_drafting_with_quality_v1",
    },
    messages: messages ?? [
      scopeMessage(),
      {
        role: "assistant",
        provenance: "model",
        provider_call_ref: PCALL,
        provider_run_ref: PRUN,
        blocks: [{
          type: "tool_call",
          call_id: "call-mission-1",
          name: "chapter_mission",
          arguments: responseArguments(),
        }],
      },
      {
        role: "tool",
        provenance: "tool_result",
        blocks: [{ type: "validation_result", call_id: "call-mission-1", status: "passed" }],
      },
    ],
  };
}

function scopeOf(t) {
  return t.messages.find(
    (message) => message.role === "scope_update" &&
      message.versions?.change_reason === "chapter_mission",
  ) ?? scopeMessage();
}

function transcriptWithScope(scope) {
  return transcript([scope, ...transcript().messages.slice(1)]);
}

// 真实 fixture_provider_result/v1 日志形状：无 agent_run_id，pcall+prun 成对，
// request_body.messages 含本次 scope 投影；work/session/turn 是真实日志字段。
function records({ arguments: args, record = {}, scope } = {}) {
  return [{
    provider_call_ref: PCALL,
    provider_run_ref: PRUN,
    work_id: WORK,
    session_id: SESSION,
    turn_id: PARENT,
    request_format: "authoring-request-ir/v1",
    request_body: {
      ir_version: "authoring-request-ir/v1",
      run: { run_id: "run-source-1", work_id: WORK, session_id: SESSION, parent_turn_ref: PARENT },
      system: { identity_ref: "identity:writer" },
      messages: [
        {
          role: "application_base",
          provenance: "application",
          blocks: [{ type: "text", text: MISSION_RULES }],
          source_refs: [],
          versions: {},
        },
        {
          role: "user",
          provenance: "author",
          blocks: [{ type: "text", text: MISSION_AUTHOR }],
          source_refs: [],
          versions: {},
        },
        structuredClone(scope ?? scopeMessage()),
      ],
      tools: [],
      projection: { tool_choice: null },
      refs: {},
    },
    response_format: "fixture_provider_result/v1",
    response: {
      status: "ok",
      body: {
        content: "",
        tool_calls: [{
          id: "call-mission-1",
          name: "chapter_mission",
          arguments: responseArguments(args),
        }],
      },
    },
    ...record,
  }];
}


function missionEvent(overrides = {}) {
  return {
    event_type: "mission_derived",
    run_ref: "run-source-1",
    emitted_at: "2026-11-02T06:15:00.366074Z",
    refs: [`mission:${MISSION_ID}`],
    payload: {
      stage: "mission_derived",
      mission_ref: `mission:${MISSION_ID}`,
      basis_refs: ["plan:2:chapter_role", "ledger:information:plan_info_4"],
      dropped_unbound_count: 1,
      input_ref_count: 3,
      must_advance_count: 1,
      must_avoid_count: 1,
      author_narrative: "核对了本章计划与作品脉络，只推进既定线索。",
      author_narrative_source: narrativeSource("核对了本章计划与作品脉络，只推进既定线索。"),
      ...overrides.payload,
    },
    ...overrides.event,
  };
}

function input(overrides = {}) {
  const { start, before } = snapshots({
    startMission: overrides.startMission,
    beforeMission: overrides.beforeMission,
    beforeUpdated: overrides.beforeUpdated,
  });
  const effectiveTranscript = overrides.transcript ?? transcript();
  return {
    startChapter: start.chapters[CHAPTER_ID],
    beforeChapter: before.chapters[CHAPTER_ID],
    targetChapterId: overrides.targetChapterId ?? CHAPTER_ID,
    targetChapterRef: overrides.targetChapterRef ?? TARGET_REF,
    sourceRunId: overrides.sourceRunId ?? RUN_ID,
    artifactTargetChapter: overrides.artifactTargetChapter ?? TITLE,
    sourceWorkId: overrides.sourceWorkId ?? WORK,
    sourceRunRecord: overrides.sourceRunRecord ?? {
      id: RUN_ID,
      work_id: WORK,
      session_id: SESSION,
      parent_turn_ref: PARENT,
      status: "completed",
    },
    transcript: effectiveTranscript,
    sessionMessages: Object.hasOwn(overrides, "sessionMessages")
      ? overrides.sessionMessages : [
          // 当前职责 Base 在前；其余消息沿会话历史原序，独立于待测请求预置。
          { role: "application_base", provenance: "application",
            blocks: [{ type: "text", text: MISSION_RULES }], source_refs: [], versions: {} },
          { role: "user", provenance: "author",
            blocks: [{ type: "text", text: MISSION_AUTHOR }], source_refs: [], versions: {} },
          ...effectiveTranscript.messages,
        ],
    records: overrides.records ?? records({ scope: scopeOf(effectiveTranscript) }),
    joinedRefs: overrides.joinedRefs ?? {
      provider_call_refs: [PCALL],
      provider_run_refs: [PRUN],
    },
    missionEvents: overrides.missionEvents ?? [missionEvent()],
    window: { startAt: START, beforeAt: BEFORE },
  };
}

function wireRecordWithScope(emptyMarker = false) {
  const scope = scopeMessage();
  const content = emptyMarker ? JSON.stringify(scope.blocks[0].content) : scopeProjection(scope);
  const record = structuredClone(records()[0]);
  delete record.request_format;
  delete record.request_body;
  record.request = {
    body: {
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: `【应用数据 · application_base · 非作者原话】\n${MISSION_RULES}` },
        { role: "user", content: MISSION_AUTHOR },
        { role: "user", content },
      ],
    },
  };
  return record;
}

function checksOf(overrides) {
  return missionSourceChecks(input(overrides)).checks;
}


function narrativeFixture(text) {
  const value = input();
  value.records[0].response.body.tool_calls[0].arguments.author_reasoning = text;
  value.transcript.messages[1].blocks[0].arguments.author_reasoning = text;
  value.missionEvents[0].payload.author_narrative = text;
  value.missionEvents[0].payload.author_narrative_source = narrativeSource(text);
  return value;
}

test("R06 两使命共用来源 owner；规划使命必须绑定目标作品、正确工具与实际接收事件", () => {
  const value = input();
  value.missionKind = "planning";
  value.requireDerivation = true;
  value.startWork = { title: "规划目标作品", updated_at: START, mission: null };
  value.beforeWork = { title: "规划目标作品", updated_at: BEFORE, mission: value.beforeChapter.mission };
  value.targetWorkId = WORK;
  value.artifactTargetWork = "规划目标作品";
  const scope = value.transcript.messages[0];
  scope.versions.change_reason = "planning_mission";
  scope.blocks[0].content.operation.mission_inputs.mode = "planning";
  scope.blocks[0].content.operation.mission_inputs.chapter = null;
  value.records[0].request_body.messages[2] = structuredClone(scope);
  value.transcript.messages[1].blocks[0].name = "planning_mission";
  value.records[0].response.body.tool_calls[0].name = "planning_mission";
  value.missionEvents[0].payload.author_narrative_source.tool_call_name = "planning_mission";
  const good = missionSourceChecks(value);
  assert.ok(Object.values(good.checks).every(Boolean), JSON.stringify(good.checks));
  const wrongTarget = structuredClone(value);
  wrongTarget.targetWorkId = OTHER_WORK;
  assert.equal(missionSourceChecks(wrongTarget).checks.mission_target_work_matches_source, false);
  const wrongSource = structuredClone(value);
  wrongSource.missionEvents[0].payload.author_narrative_source.tool_call_name = "chapter_mission";
  assert.equal(missionSourceChecks(wrongSource).checks.mission_id_and_event_are_bound, false);
});

test("R06 实际请求与 canonical 同步指向另一作品/章节/模式仍须被目标门拒绝", () => {
  for (const change of [
    content => { content.work_id = OTHER_WORK; },
    content => { content.operation.mission_inputs.chapter.chapter_ref = "chapter:other"; },
    content => { content.operation.mission_inputs.mode = "planning"; },
  ]) {
    const scope = scopeMessage();
    change(scope.blocks[0].content);
    const value = input({ transcript: transcriptWithScope(scope), records: records({ scope }) });
    assert.ok(scopeForProviderCall(value.records[0], { messages: value.sessionMessages }));
    assert.equal(missionSourceChecks(value).checks.mission_call_is_fully_joined, false);
  }
});


function writerMissionInput(kind = "chapter") {
  const value = input(), planning = kind === "planning";
  if (planning) {
    value.transcript.messages[1].blocks[0].name = "planning_mission";
    const scope = value.transcript.messages[0];
    scope.versions.change_reason = "planning_mission";
    scope.blocks[0].content.operation.mission_inputs.mode = "planning";
    scope.blocks[0].content.operation.mission_inputs.chapter = null;
  }
  const writerScope = structuredClone(scopeMessage());
  writerScope.versions = { ...writerScope.versions, change_reason: "creative_operation", scope_revision: 4 };
  writerScope.blocks[0].content = {
    work_id: WORK,
    operation: { role: "creative_execution", capability: planning ? "plot_outline" : "prose_writing",
      [planning ? "planning_mission" : "execution_brief"]: [
        value.beforeChapter.mission.statement, ...value.beforeChapter.mission.must_advance.map(item => item.text),
        ...value.beforeChapter.mission.must_avoid.map(item => item.text),
      ].join("\n") },
    authoring_task: { scope: planning ? {} : { target_chapter_ref: TARGET_REF } },
  };
  const writerCall = { role: "assistant", provenance: "model", provider_call_ref: "pcall-writer",
    provider_run_ref: "prun-writer", blocks: [{ type: "tool_call", name: "submit_tentative_artifact",
      call_id: "call-writer", arguments: { artifact_type: planning ? "outline_draft" : "prose_fragment" } }] };
  value.transcript.messages.push(writerScope, writerCall);
  const history = { record: value.sourceRunRecord, transcript: value.transcript,
    sessionMessages: [...value.sessionMessages.slice(0, 2), ...value.transcript.messages] };
  const record = structuredClone(value.records[0]);
  record.provider_call_ref = "pcall-writer"; record.provider_run_ref = "prun-writer";
  record.response.body = { content: "", tool_calls: [{ id: "call-writer", name: "submit_tentative_artifact",
    arguments: structuredClone(writerCall.blocks[0].arguments) }] };
  record.request_body.messages = structuredClone(history.sessionMessages.slice(0, -1));
  return { history, calls: { records: [record] }, mission: value.beforeChapter.mission, kind,
    writer: { provider_call_ref: "pcall-writer" }, writerScope };
}
function checkWriter(value) {
  return missionWriterMaterial(value.history, value.calls, value.mission, value.kind, value.writer,
    value.kind === "planning" ? null : TARGET_REF);
}
function syncWriterRequest(value) {
  const base = value.history.sessionMessages.slice(0, 2);
  value.history.sessionMessages = [...base, ...value.history.transcript.messages];
  const index = value.history.sessionMessages.findIndex(message => message.provider_call_ref === "pcall-writer");
  value.calls.records[0].request_body.messages = structuredClone(value.history.sessionMessages.slice(0, index));
}
test("R06 使命真实请求和 Writer 的目标/接受因果分别完整绑定", () => {
  for (const kind of ["chapter", "planning"]) {
    const value = writerMissionInput(kind);
    assert.ok(scopeForProviderCall(value.calls.records[0], { messages: value.history.sessionMessages }));
    assert.equal(checkWriter(value).ok, true, JSON.stringify(checkWriter(value)));
    value.writerScope.blocks[0].content.work_id = OTHER_WORK;
    syncWriterRequest(value);
    assert.ok(scopeForProviderCall(value.calls.records[0], { messages: value.history.sessionMessages }));
    assert.equal(checkWriter(value).target_matches, false);
    assert.equal(checkWriter(value).ok, false);
  }
  const otherChapter = writerMissionInput();
  otherChapter.writerScope.blocks[0].content.authoring_task.scope.target_chapter_ref = "chapter:other";
  syncWriterRequest(otherChapter);
  assert.ok(scopeForProviderCall(otherChapter.calls.records[0], { messages: otherChapter.history.sessionMessages }));
  assert.equal(checkWriter(otherChapter).target_matches, false);
  assert.equal(checkWriter(otherChapter).ok, false);
});
test("R06 passed validation 移至 Writer 后，真实请求与 canonical 同步仍必须拒绝", () => {
  const value = writerMissionInput();
  const [validation] = value.history.transcript.messages.splice(2, 1);
  value.history.transcript.messages.push(validation);
  syncWriterRequest(value);
  assert.ok(scopeForProviderCall(value.calls.records[0], { messages: value.history.sessionMessages }));
  const report = checkWriter(value);
  assert.equal(report.target_matches, true);
  assert.equal(report.accepted_before_writer, false);
  assert.equal(report.ok, false);
});
test("R06 页面叙述上下文只取同次作者可见发布，不能借另一 run 或开发者叙述补段", () => {
  const topic = "chat:session-1", since = START;
  const frame = (id, sequence, narrative, changes = {}) => ({ direction: "received", at: BEFORE,
    frame: [null, null, topic, "agent_event", { event_id: id, sequence, event_type: "mission_derived",
      visibility: "author", run_ref: RUN_ID, payload: { author_narrative: narrative }, ...changes }] });
  const wire = [frame("before", 1, "先核对材料。", { event_type: "judgment_decided" }),
    frame("mission", 2, " \n本章使命Ω。\r\n"), frame("developer", 3, "不该显示", { visibility: "developer" }),
    frame("other-run", 4, "另一使命", { run_ref: "other-run" })];
  assert.deepEqual(sourceMissionNarrativeContext(wire, { topic, since, runId: RUN_ID, missionEventId: "mission" }),
    { narratives: ["先核对材料。", " \n本章使命Ω。\r\n"], targetIndex: 1 });
});

test("R06 使命场景不能以零调用/零事件空集签收；普通无派生仍保留真实不适用结论", () => {
  const value = input();
  value.beforeChapter.mission = null;
  value.beforeChapter.updated_at = START;
  value.transcript.messages = [];
  value.sessionMessages = [];
  value.records = [];
  value.missionEvents = [];
  value.joinedRefs = { provider_call_refs: [], provider_run_refs: [] };
  assert.ok(Object.values(missionSourceChecks(value).checks).every(Boolean));
  assert.equal(missionSourceChecks({ ...value, requireDerivation: true }).checks.mission_was_derived, false);
});

test("R06 使命正文保留首尾空白、换行与Unicode，逐字绑定author_reasoning", () => {
  const text = "  我先核对已有计划。\r\n本章只推进这条线索🙂。\n ";
  const value = narrativeFixture(text);
  assert.equal(missionSourceChecks(value).checks.mission_id_and_event_are_bound, true);
  value.missionEvents[0].payload.author_narrative = text.trim();
  assert.equal(missionSourceChecks(value).checks.mission_id_and_event_are_bound, false);
});

test("R06 同pcall/prun不能替代原字段、完整来源与实际叙述字节", () => {
  const changes = [
    ["改写正文", (event) => { event.author_narrative = "应用改写后的说明。"; }],
    ["缺正文", (event) => { delete event.author_narrative; }],
    ["换字段", (event) => { event.author_narrative_source.tool_call_narrative_field = "statement"; }],
    ["换工具", (event) => { event.author_narrative_source.tool_call_name = "planning_mission"; }],
    ["换输出", (event) => { event.author_narrative_source.provider_output_ref = "prun-other"; }],
    ["换来源类型", (event) => { event.author_narrative_source.source_type = "provider_output"; }],
    ["坏来源hash", (event) => { event.author_narrative_source.source_hash = "0".repeat(64); }],
    ["坏叙述hash", (event) => { event.author_narrative_source.narrative_hash = "0".repeat(64); }],
    ["非完整范围", (event) => { event.author_narrative_source.source_byte_range.start = 1; }],
  ];
  for (const [label, change] of changes) {
    const value = narrativeFixture("我只推进已核对的线索。");
    assert.equal(missionSourceChecks(value).checks.mission_id_and_event_are_bound, true, label);
    change(value.missionEvents[0].payload);
    assert.equal(value.missionEvents[0].payload.author_narrative_source.provider_call_ref, PCALL);
    assert.equal(value.missionEvents[0].payload.author_narrative_source.provider_run_ref, PRUN);
    assert.equal(missionSourceChecks(value).checks.mission_id_and_event_are_bound, false, label);
  }
});

test("R06 同双键同参数但原生call_id不同或另带content不能签使命接收", () => {
  for (const change of [
    (body) => { body.tool_calls[0].id = "different-native-call"; },
    (body) => { body.content = "我只推进已核对的线索。"; },
  ]) {
    const value = narrativeFixture("我只推进已核对的线索。");
    assert.equal(missionSourceChecks(value).checks.mission_call_is_fully_joined, true);
    change(value.records[0].response.body);
    assert.equal(missionSourceChecks(value).checks.mission_call_is_fully_joined, false);
  }
});

test("跨 run 会话 Scope 用于使命请求核验，旧 run 调用不计入当前使命", () => {
  const value = input();
  const historicalScope = scopeMessage();
  historicalScope.blocks[0].content.goal.text = "上一轮使命";
  historicalScope.versions.scope_revision = 17;
  const oldCall = {
    ...structuredClone(value.transcript.messages[1]),
    provider_call_ref: "pcall-previous",
    provider_run_ref: "prun-previous",
  };
  oldCall.blocks[0].call_id = "call-previous";
  const oldResult = {
    role: "tool", provenance: "tool_result",
    blocks: [{ type: "validation_result", call_id: "call-previous", status: "passed" }],
  };
  value.sessionMessages = [value.sessionMessages[0], historicalScope, oldCall, oldResult,
    ...value.sessionMessages.slice(1)];
  value.records[0].request_body.messages.splice(1, 0,
    structuredClone(historicalScope), structuredClone(oldCall), structuredClone(oldResult));
  const result = missionSourceChecks(value);
  assert.equal(result.checks.mission_call_is_fully_joined, true);
  assert.equal(result.measured.provider_call_ref, PCALL);
  assert.equal(missionSourceChecks({ ...value, sessionMessages: null })
    .checks.mission_call_is_fully_joined, false);
  assert.equal(missionSourceChecks({
    ...value, sessionMessages: value.transcript.messages,
  }).checks.mission_call_is_fully_joined, false);
  const changed = structuredClone(value.sessionMessages);
  changed[1].versions.scope_revision += 1;
  assert.equal(missionSourceChecks({ ...value, sessionMessages: changed })
    .checks.mission_call_is_fully_joined, false);
});

test("合法暂定使命：pcall/prun、同次响应、请求 refs、被丢弃未知 basis 与事件全部绑定", () => {
  const value = missionSourceChecks(input());
  assert.ok(Object.values(value.checks).every(Boolean), JSON.stringify(value.checks));
  assert.equal(value.measured.mission_changed, true);
  assert.equal(value.measured.provider_call_ref, PCALL);
  assert.equal(value.measured.provider_run_ref, PRUN);
  assert.deepEqual(value.measured.retained_basis_refs, [
    "plan:2:chapter_role",
    "ledger:information:plan_info_4",
  ]);
  assert.equal(value.measured.dropped_basis_count, 1);
});

test("真实 producer 形状：records 无 agent_run_id，由 pcall+prun 与真实请求投影共同绑定", () => {
  const value = input();
  assert.equal(value.records.some((record) => Object.hasOwn(record, "agent_run_id")), false);
  const result = missionSourceChecks(value);
  assert.deepEqual(
    Object.entries(result.checks).filter(([, passed]) => passed !== true),
    [],
  );
});

test("canonical 仍保留材料但实际请求删掉 scope 投影时必须失败", () => {
  const recs = records();
  recs[0].request_body = {
    messages: [{ role: "user", content: "此请求没有提供任何章使命依据。" }],
  };
  const checks = checksOf({ records: recs });
  assert.equal(checks.mission_call_is_fully_joined, false);
  assert.equal(checks.mission_response_content_matches, false);
  assert.equal(checks.mission_retained_basis_and_labels_match, false);
  assert.equal(checks.mission_id_and_event_are_bound, false);
});

test("请求投影的版本/材料字节/来源/唯一性不符时失败", () => {
  const versionMismatch = records();
  versionMismatch[0].request_body.messages[2].versions.scope_revision = 4;
  assert.equal(checksOf({ records: versionMismatch }).mission_call_is_fully_joined, false);

  const textMismatch = records();
  textMismatch[0].request_body.messages[2].blocks[0].content.operation.mission_inputs.items[0].text =
    "请求里被改过的标签";
  assert.equal(checksOf({ records: textMismatch }).mission_call_is_fully_joined, false);

  const duplicate = records();
  duplicate[0].request_body.messages.push(
    structuredClone(duplicate[0].request_body.messages[2]),
  );
  assert.equal(checksOf({ records: duplicate }).mission_call_is_fully_joined, false);

  const sourceMismatch = records();
  sourceMismatch[0].request_body.messages[2].source_refs[0].ref = "unbound:request-source";
  assert.equal(checksOf({ records: sourceMismatch }).mission_call_is_fully_joined, false);
});

test("同一 basis_ref 的冲突标签是歧义来源，不能后者覆盖前者", () => {
  const scope = scopeMessage();
  scope.blocks[0].content.operation.mission_inputs.items.push({
    ref: "plan:2:chapter_role",
    group: "plan",
    text: "冲突的来源标签",
  });
  const checks = checksOf({
    transcript: transcriptWithScope(scope),
    records: records({ scope }),
  });
  assert.equal(checks.mission_call_is_fully_joined, false);
  assert.equal(checks.mission_retained_basis_and_labels_match, false);
});

test("使命材料必须来自结构 Scope，历史文本或超出 source_refs 的材料不能确权", () => {
  const oldText = scopeMessage();
  oldText.blocks = [{ type: "text", text: "- [plan:2:chapter_role] 看似合法的旧材料" }];
  assert.equal(
    checksOf({
      transcript: transcriptWithScope(oldText),
      records: records({ scope: oldText }),
    }).mission_call_is_fully_joined,
    false,
  );

  const extraRefScope = scopeMessage();
  extraRefScope.blocks[0].content.operation.mission_inputs.items.push({
    ref: "plan:2:not_in_metadata",
    group: "plan",
    text: "未登记的来源",
  });
  assert.equal(
    checksOf({
      transcript: transcriptWithScope(extraRefScope),
      records: records({ scope: extraRefScope }),
    }).mission_call_is_fully_joined,
    false,
  );
});

test("已成功派生的 mission 从设计态消失，不能因 before==after 被跳过", () => {
  const value = missionSourceChecks(input({
    startMission: null,
    beforeMission: null,
    beforeUpdated: START,
  }));
  assert.equal(value.measured.mission_changed, false);
  for (const key of [
    "mission_call_is_fully_joined",
    "mission_response_content_matches",
    "mission_retained_basis_and_labels_match",
    "mission_id_and_event_are_bound",
  ]) {
    assert.equal(value.checks[key], false, key);
  }
});

test("mission 未变化但确有成功派生调用/事件时，仍要绑定内容与落点", () => {
  const value = missionSourceChecks(input({
    startMission: missionMap(),
    beforeMission: missionMap(),
    beforeUpdated: BEFORE,
  }));
  assert.equal(value.measured.mission_changed, false);
  assert.ok(Object.values(value.checks).every(Boolean), JSON.stringify(value.checks));
});

test("mission 未变化、无事件但仍有成功调用时，不能把消失当成未派生", () => {
  const gone = missionSourceChecks(input({
    startMission: null,
    beforeMission: null,
    beforeUpdated: START,
    missionEvents: [],
  }));
  assert.equal(gone.measured.mission_changed, false);
  assert.equal(gone.checks.mission_call_is_fully_joined, false);
  assert.equal(gone.checks.mission_response_content_matches, false);

  const present = missionSourceChecks(input({
    startMission: missionMap(),
    beforeMission: missionMap(),
    beforeUpdated: BEFORE,
    missionEvents: [],
  }));
  assert.equal(present.measured.mission_changed, false);
  assert.equal(present.checks.mission_call_is_fully_joined, true);
  assert.equal(present.checks.mission_response_content_matches, true);
  assert.equal(present.checks.mission_id_and_event_are_bound, false);
});


test("单一真实材料也必须完整绑定 ref 与原标签", () => {
  const scope = scopeMessage();
  scope.source_refs = [{ ref: "plan:2:chapter_role" }];
  scope.blocks[0].content.operation.mission_inputs.items = [
    { ref: "plan:2:chapter_role", group: "plan", text: LABEL_ADVANCE },
  ];
  const args = {
    author_reasoning: "只依据唯一提供的本章计划材料。",
    statement: missionMap().statement,
    confidence: 0.9,
    must_advance: [{
      text: "按本章计划完成既定情节推进。",
      basis_ref: "plan:2:chapter_role",
    }],
    must_avoid: [],
  };
  const t = transcript([
    scope,
    {
      role: "assistant",
      provenance: "model",
      provider_call_ref: PCALL,
      provider_run_ref: PRUN,
      blocks: [{
        type: "tool_call",
        call_id: "call-mission-1",
        name: "chapter_mission",
        arguments: args,
      }],
    },
    {
      role: "tool",
      blocks: [{ type: "validation_result", call_id: "call-mission-1", status: "passed" }],
    },
  ]);
  const value = missionSourceChecks(input({
    transcript: t,
    records: records({ scope, arguments: args }),
    beforeMission: missionMap({ must_avoid: [] }),
    missionEvents: [missionEvent({
      payload: {
        basis_refs: ["plan:2:chapter_role"],
        dropped_unbound_count: 0,
        input_ref_count: 1,
        must_advance_count: 1,
        must_avoid_count: 0,
        author_narrative: args.author_reasoning,
        author_narrative_source: narrativeSource(args.author_reasoning),
      },
    })],
  }));
  assert.ok(Object.values(value.checks).every(Boolean), JSON.stringify(value.checks));
});

test("目标章/作品/run/artifact 绑定错误必须失败", () => {
  assert.equal(checksOf({ targetChapterRef: "chapter:other" }).mission_target_chapter_matches_source, false);
  assert.equal(checksOf({ artifactTargetChapter: "第03章：别的章" }).mission_target_chapter_matches_source, false);
  assert.equal(checksOf({ sourceWorkId: OTHER_WORK }).mission_target_chapter_matches_source, false);
  assert.equal(
    checksOf({ sourceRunRecord: { id: "run-other", work_id: WORK, status: "completed" } })
      .mission_call_is_fully_joined,
    false,
  );
  const wrongRunRecords = records({ record: { work_id: OTHER_WORK } });
  assert.equal(checksOf({ records: wrongRunRecords }).mission_call_is_fully_joined, false);
  for (const record of [
    { session_id: "session-other" },
    { turn_id: "turn-other" },
    { turn_id: `${PARENT}:agent:0` },
    { turn_id: `${PARENT}:agent:` },
    { provider_run_ref: "prun-other" },
  ]) {
    assert.equal(
      checksOf({ records: records({ record }) }).mission_call_is_fully_joined,
      false,
      JSON.stringify(record),
    );
  }
  assert.equal(
    checksOf({ records: records({ record: { turn_id: `${PARENT}:agent:2` } }) })
      .mission_call_is_fully_joined,
    true,
  );
});

test("pcall/prun 未完整 join 或与响应错配必须失败", () => {
  assert.equal(
    checksOf({ joinedRefs: { provider_call_refs: [], provider_run_refs: [PRUN] } })
      .mission_call_is_fully_joined,
    false,
  );
  assert.equal(
    checksOf({ joinedRefs: { provider_call_refs: [PCALL], provider_run_refs: [] } })
      .mission_call_is_fully_joined,
    false,
  );
  const wrongPcallMission = missionMap({ provider_call_ref: "pcall-other" });
  assert.equal(
    checksOf({ beforeMission: wrongPcallMission }).mission_call_is_fully_joined,
    false,
  );
  const noRecord = records({ record: { provider_call_ref: "pcall-other" } });
  assert.equal(checksOf({ records: noRecord }).mission_call_is_fully_joined, false);
});

test("statement/confidence/有效条目与同次响应不一致必须失败", () => {
  const badStatements = [
    missionMap({ statement: "模型没有说过的使命。" }),
    missionMap({ confidence: 1 }),
    missionMap({ must_advance: [{ text: "改过的推进。", basis_ref: "plan:2:chapter_role", basis_label: LABEL_ADVANCE }] }),
    missionMap({ must_avoid: [] }),
  ];
  for (const beforeMission of badStatements) {
    assert.equal(
      checksOf({ beforeMission }).mission_response_content_matches,
      false,
      JSON.stringify(beforeMission),
    );
  }
});

test("保留未提供的 basis、丢掉有效 basis、错误 label 均失败", () => {
  const extraRetained = missionMap({
    must_avoid: [
      ...missionMap().must_avoid,
      { text: "不得提前揭示未提供的依据。", basis_ref: "unknown:not_supplied", basis_label: "伪造依据" },
    ],
  });
  assert.equal(
    checksOf({ beforeMission: extraRetained }).mission_retained_basis_and_labels_match,
    false,
  );
  const droppedValid = missionMap({ must_avoid: [] });
  assert.equal(
    checksOf({ beforeMission: droppedValid }).mission_retained_basis_and_labels_match,
    false,
  );
  const wrongLabel = missionMap({
    must_advance: [{
      text: "按本章计划完成既定情节推进。",
      basis_ref: "plan:2:chapter_role",
      basis_label: "伪造依据文本",
    }],
  });
  assert.equal(
    checksOf({ beforeMission: wrongLabel }).mission_retained_basis_and_labels_match,
    false,
  );
});

test("mission_id/basis 计数/事件 run 与 pcall 错绑必须失败", () => {
  assert.equal(
    checksOf({ missionEvents: [] }).mission_id_and_event_are_bound,
    false,
  );
  for (const payload of [
    { mission_ref: "mission:cm_other" },
    { basis_refs: ["plan:2:chapter_role"] },
    { dropped_unbound_count: 0 },
    { input_ref_count: 2 },
    { must_advance_count: 2 },
    { author_narrative_source: { provider_call_ref: "pcall-other", provider_run_ref: PRUN } },
    { author_narrative_source: { provider_call_ref: PCALL, provider_run_ref: "prun-other" } },
  ]) {
    assert.equal(
      checksOf({ missionEvents: [missionEvent({ payload })] }).mission_id_and_event_are_bound,
      false,
      JSON.stringify(payload),
    );
  }
  const wrongEventRun = missionEvent({ event: { run_ref: "run-other" } });
  assert.equal(
    checksOf({ missionEvents: [wrongEventRun] }).mission_id_and_event_are_bound,
    false,
  );
  const duplicateEvents = [missionEvent(), missionEvent()];
  assert.equal(
    checksOf({ missionEvents: duplicateEvents }).mission_id_and_event_are_bound,
    false,
  );
});

test("只靠时间吻合、缺真实调用/响应时不能放行 mission 变化", () => {
  const noAssistant = transcript([
    scopeMessage(),
    { role: "tool", blocks: [{ type: "validation_result", call_id: "call-mission-1", status: "passed" }] },
  ]);
  assert.equal(
    checksOf({ transcript: noAssistant, records: [] }).mission_call_is_fully_joined,
    false,
  );
  const noResponseCall = records({ arguments: responseArguments(), record: { response: { status: "ok", body: { tool_calls: [] } } } });
  assert.equal(checksOf({ records: noResponseCall }).mission_call_is_fully_joined, false);
});

test("作者版被改写或 source 阶段重新推导 author 版必须失败", () => {
  const author = missionMap({
    status: "CONFIRMED",
    source: "author",
    must_advance: [{ text: "作者定版。" }],
    must_avoid: [],
    decided_at: BEFORE,
  });
  const checks = checksOf({ startMission: author, beforeMission: missionMap() });
  assert.equal(checks.mission_transition_is_legal, false);
  assert.equal(checks.author_version_not_rederived, false);
});

test("旧暂定→nil、只有时间变化、derived_at 越界均失败", () => {
  const old = missionMap({ derived_at: START });
  assert.equal(
    checksOf({ startMission: old, beforeMission: null }).mission_transition_is_legal,
    false,
  );
  const sameMissionLater = checksOf({
    startMission: missionMap(),
    beforeMission: missionMap(),
    beforeUpdated: BEFORE,
    missionEvents: [],
    transcript: transcript([scopeMessage()]),
  });
  assert.equal(sameMissionLater.mission_time_within_source_window, false);

  const late = missionMap({ derived_at: "2026-11-02T06:15:01.000000Z" });
  assert.equal(
    checksOf({ beforeMission: late }).mission_time_within_source_window,
    false,
  );
});

test("mission 未变化且无事件时合法通过；旧 v1 事实缺席不参与本模块", () => {
  const value = missionSourceChecks(input({
    startMission: missionMap(),
    beforeMission: missionMap(),
    beforeUpdated: START,
    missionEvents: [],
    transcript: transcript([scopeMessage()]),
  }));
  assert.ok(Object.values(value.checks).every(Boolean), JSON.stringify(value.checks));
  assert.equal(value.measured.mission_changed, false);
  const author = missionSourceChecks(input({
    startMission: missionMap({ status: "AUTHOR_EDITED", source: "author", must_advance: [{ text: "作者定版。" }], decided_at: BEFORE }),
    beforeMission: missionMap({ status: "AUTHOR_EDITED", source: "author", must_advance: [{ text: "作者定版。" }], decided_at: BEFORE }),
    missionEvents: [],
  }));
  assert.equal(author.checks.author_version_not_rederived, false);
});

test("字符串 arguments 仍按同次响应解析，坏 JSON/缺 scope 前帧关闭而不崩溃", () => {
  const stringArgs = transcript([
    scopeMessage(),
    {
      role: "assistant",
      provenance: "model",
      provider_call_ref: PCALL,
      provider_run_ref: PRUN,
      blocks: [{
        type: "tool_call",
        call_id: "call-mission-1",
        name: "chapter_mission",
        arguments: JSON.stringify(responseArguments()),
      }],
    },
  ]);
  // 两侧必须保留同一次 raw 字节；parsed-only 不能补造丢失的原文。
  const rawRecords = records();
  rawRecords[0].response.body.tool_calls[0].arguments = JSON.stringify(responseArguments());
  assert.equal(missionSourceChecks(input({ transcript: stringArgs, records: rawRecords })).checks.mission_call_is_fully_joined, true);
  assert.equal(missionSourceChecks(input({ transcript: stringArgs })).checks.mission_call_is_fully_joined, false);

  for (const bad of [
    transcript([{ role: "assistant", provider_call_ref: PCALL, provider_run_ref: PRUN, blocks: [{ type: "tool_call", call_id: "c1", name: "chapter_mission", arguments: "{" }] }]),
    transcript([scopeMessage(), { role: "assistant", provider_call_ref: PCALL, provider_run_ref: PRUN, blocks: [{ type: "tool_call", call_id: "c1", name: "chapter_mission", arguments: "{bad" }] }]),
    transcript([{ role: "application_base", blocks: [] }, { role: "assistant", provider_call_ref: PCALL, provider_run_ref: PRUN, blocks: [{ type: "tool_call", call_id: "c1", name: "chapter_mission", arguments: responseArguments() }] }]),
    transcript([{ role: "scope_update", versions: { change_reason: "other" }, source_refs: [], blocks: [] }, { role: "assistant", provider_call_ref: PCALL, provider_run_ref: PRUN, blocks: [{ type: "tool_call", call_id: "c1", name: "chapter_mission", arguments: responseArguments() }] }]),
  ]) {
    assert.equal(missionSourceChecks(input({ transcript: bad })).checks.mission_call_is_fully_joined, false);
  }
});

test("作者版允许只有 decided_at，不带 derived_at/confidence；但不得重新调用使命", () => {
  const author = {
    mission_id: MISSION_ID,
    statement: "作者定版。",
    must_advance: [{ text: "作者推进。" }],
    must_avoid: [],
    status: "AUTHOR_EDITED",
    source: "author",
    decided_at: BEFORE,
  };
  const value = missionSourceChecks(input({
    startMission: author,
    beforeMission: author,
    beforeUpdated: START,
    missionEvents: [],
    transcript: transcript([{ role: "application_base", blocks: [] }]),
    records: [],
    joinedRefs: { provider_call_refs: [], provider_run_refs: [] },
  }));
  assert.ok(Object.values(value.checks).every(Boolean), JSON.stringify(value.checks));
  assert.equal(value.measured.mission_id, MISSION_ID);
});

test("空输入 fail-closed 不抛错；mission 变化缺调用时四项证据全 false", () => {
  const empty = missionSourceChecks({});
  assert.equal(empty.checks.mission_target_chapter_matches_source, false);
  assert.equal(empty.checks.mission_time_within_source_window, false);
  const activeNoChapter = missionSourceChecks({ missionEvents: [missionEvent()] });
  assert.equal(activeNoChapter.checks.mission_transition_is_legal, false);
  const noBefore = missionSourceChecks({
    startChapter: input().startChapter,
    beforeChapter: null,
    missionEvents: [missionEvent()],
  });
  assert.equal(noBefore.checks.mission_transition_is_legal, false);
  const changedNoCall = checksOf({ transcript: transcript([]), records: [], missionEvents: [] });
  for (const key of [
    "mission_call_is_fully_joined",
    "mission_response_content_matches",
    "mission_retained_basis_and_labels_match",
    "mission_id_and_event_are_bound",
  ]) {
    assert.equal(changedNoCall[key], false, key);
  }
});

test("时间边界：derived_at/updated_at 恰在窗口端点通过，越界或先后倒置失败", () => {
  const cases = [
    [{ derived_at: START, beforeUpdated: BEFORE }, true],
    [{ derived_at: START, beforeUpdated: START }, true],
    [{ derived_at: BEFORE, beforeUpdated: BEFORE }, true],
    [{ derived_at: "2026-11-02T06:14:41.999999Z" }, false],
    [{ derived_at: "2026-11-02T06:15:00.500001Z" }, false],
    [{ beforeUpdated: "2026-11-02T06:15:00.500001Z" }, false],
    [{ beforeUpdated: "2026-11-02T06:14:41.999999Z" }, false],
  ];
  for (const [overrides, expected] of cases) {
    const mission = missionMap(overrides.derived_at ? { derived_at: overrides.derived_at } : {});
    const checks = checksOf({
      beforeMission: mission,
      beforeUpdated: overrides.beforeUpdated ?? BEFORE,
    });
    assert.equal(checks.mission_time_within_source_window, expected, JSON.stringify(overrides));
  }
});

test("scope/响应形状的缺失、重复、空值与额外字段一律关闭", () => {
  const refsCases = [
    { ...scopeMessage(), source_refs: [] },
    { ...scopeMessage(), source_refs: [{ ref: "plan:2:chapter_role" }, { ref: "plan:2:chapter_role" }] },
    { ...scopeMessage(), source_refs: [{ ref: "" }] },
    { ...scopeMessage(), blocks: [] },
  ];
  for (const scope of refsCases) {
    const t = transcript([scope, {
      role: "assistant", provider_call_ref: PCALL, provider_run_ref: PRUN,
      blocks: [{ type: "tool_call", call_id: "c1", name: "chapter_mission", arguments: responseArguments() }],
    }]);
    assert.equal(
      missionSourceChecks(input({ transcript: t })).checks.mission_call_is_fully_joined,
      false,
      JSON.stringify(scope.source_refs),
    );
  }
  for (const args of [
    { ...responseArguments(), statement: "" },
    { ...responseArguments(), confidence: "0.9" },
    { ...responseArguments(), confidence: Infinity },
    { ...responseArguments(), must_advance: [{ text: "", basis_ref: "plan:2:chapter_role" }] },
    { ...responseArguments(), must_advance: [{ text: "x", basis_ref: "" }] },
    { ...responseArguments(), must_advance: [{ text: "x", basis_ref: "plan:2:chapter_role", extra: 1 }] },
    { ...responseArguments(), must_advance: "bad" },
  ]) {
    assert.equal(
      missionSourceChecks(input({ records: records({ arguments: args }) }))
        .checks.mission_response_content_matches,
      false,
      JSON.stringify(args),
    );
  }
});

test("重复/错名响应调用、多个 mission 调用、非字符串 target ref 都关闭", () => {
  const duplicate = records({ record: { response: { status: "ok", body: { tool_calls: [
    { id: "a", name: "chapter_mission", arguments: responseArguments() },
    { id: "b", name: "chapter_mission", arguments: responseArguments() },
  ] } } } });
  assert.equal(checksOf({ records: duplicate }).mission_call_is_fully_joined, false);
  const wrongName = records({ record: { response: { status: "ok", body: { tool_calls: [
    { id: "a", name: "other", arguments: responseArguments() },
  ] } } } });
  assert.equal(checksOf({ records: wrongName }).mission_call_is_fully_joined, false);
  const twoCalls = transcript([
    scopeMessage(),
    { role: "assistant", provider_call_ref: PCALL, provider_run_ref: PRUN, blocks: [{ type: "tool_call", call_id: "c1", name: "chapter_mission", arguments: responseArguments() }] },
    { role: "assistant", provider_call_ref: PCALL, provider_run_ref: PRUN, blocks: [{ type: "tool_call", call_id: "c2", name: "chapter_mission", arguments: responseArguments() }] },
  ]);
  assert.equal(checksOf({ transcript: twoCalls }).mission_call_is_fully_joined, false);
  for (const targetChapterRef of ["chapter:", "chapter:other"]) {
    assert.equal(checksOf({ targetChapterRef }).mission_target_chapter_matches_source, false, String(targetChapterRef));
  }
  for (const targetChapterRef of [null, 42]) {
    const value = input();
    value.targetChapterRef = targetChapterRef;
    assert.equal(
      missionSourceChecks(value).checks.mission_target_chapter_matches_source,
      false,
      String(targetChapterRef),
    );
  }
  assert.equal(checksOf({ targetChapterId: "chapter-2", targetChapterRef: TARGET_REF }).mission_target_chapter_matches_source, true);
});

test("作者版即使 mission 未变，只要出现使命调用或 mission 事件就失败", () => {
  const author = missionMap({ status: "AUTHOR_EDITED", source: "author", must_advance: [{ text: "作者定版。" }], decided_at: BEFORE });
  for (const overrides of [
    { missionEvents: [missionEvent()] },
    { transcript: transcript() },
  ]) {
    const value = missionSourceChecks(input({
      startMission: author,
      beforeMission: author,
      beforeUpdated: START,
      missionEvents: [],
      ...overrides,
    }));
    assert.equal(value.checks.author_version_not_rederived, false, JSON.stringify(Object.keys(overrides)));
  }
});

test("mission_derived 事件缺 payload/refs/emitted_at 或叙述来源时关闭", () => {
  for (const event of [
    null,
    { ...missionEvent(), payload: null },
    { ...missionEvent(), refs: [] },
    { ...missionEvent(), emitted_at: "" },
    missionEvent({ payload: { author_narrative_source: {} } }),
  ]) {
    assert.equal(
      checksOf({ missionEvents: [event] }).mission_id_and_event_are_bound,
      false,
      JSON.stringify(event),
    );
  }
});

test("事件时间端点、narrative null、响应参数坏值、空 mission 时间均关闭", () => {
  for (const emitted_at of [START, BEFORE]) {
    assert.equal(
      checksOf({ missionEvents: [missionEvent({ event: { emitted_at } })] })
        .mission_id_and_event_are_bound,
      true,
      emitted_at,
    );
  }
  for (const emitted_at of ["2026-11-02T06:14:41.999999Z", "2026-11-02T06:15:00.500001Z"]) {
    assert.equal(
      checksOf({ missionEvents: [missionEvent({ event: { emitted_at } })] })
        .mission_id_and_event_are_bound,
      false,
      emitted_at,
    );
  }
  const nullNarrative = missionEvent({ payload: { author_narrative_source: null } });
  assert.equal(
    checksOf({ missionEvents: [nullNarrative] }).mission_id_and_event_are_bound,
    false,
  );
  const canonicalValidResponseBad = records({ record: { response: { status: "ok", body: { tool_calls: [
    { id: "a", name: "chapter_mission", arguments: "{bad" },
  ] } } } });
  assert.equal(
    checksOf({ records: canonicalValidResponseBad }).mission_call_is_fully_joined,
    false,
  );
  const nil = checksOf({ startMission: missionMap({ derived_at: START }), beforeMission: null });
  assert.equal(nil.mission_time_within_source_window, false);
  assert.equal(nil.mission_transition_is_legal, false);
});

test("target ref 的冒号边界与 request/call 组合不互相代签", () => {
  const value = input();
  value.targetChapterRef = "chapter:";
  value.targetChapterId = "chapter:";
  assert.equal(
    missionSourceChecks(value).checks.mission_target_chapter_matches_source,
    false,
  );
  const noScope = transcript([
    { role: "application_base", blocks: [] },
    { role: "assistant", provider_call_ref: PCALL, provider_run_ref: PRUN, blocks: [{ type: "tool_call", call_id: "c1", name: "chapter_mission", arguments: responseArguments() }] },
  ]);
  assert.equal(checksOf({ transcript: noScope }).mission_call_is_fully_joined, false);
  assert.equal(checksOf({ transcript: noScope, records: [] }).mission_id_and_event_are_bound, false);
});

test("model mission 在有调用/事件时仍是模型版，不会被误判为作者版重新推导", () => {
  const value = missionSourceChecks(input({
    startMission: missionMap(),
    beforeMission: missionMap(),
  }));
  assert.equal(value.checks.author_version_not_rederived, true);
  assert.ok(Object.values(value.checks).every(Boolean), JSON.stringify(value.checks));
});

test("scope 帧缺 versions、材料块为 null、source_refs 含 null 项都关闭而不崩溃", () => {
  const missingVersions = scopeMessage();
  delete missingVersions.versions;
  const t1 = transcript([missingVersions, ...transcript().messages.slice(1)]);
  assert.equal(checksOf({ transcript: t1 }).mission_call_is_fully_joined, false);

  const nullBlockScope = scopeMessage();
  nullBlockScope.blocks = [null, ...nullBlockScope.blocks];
  assert.equal(
    checksOf({
      transcript: transcriptWithScope(nullBlockScope),
      records: records(),
    }).mission_call_is_fully_joined,
    false,
  );

  const nullRefScope = scopeMessage();
  nullRefScope.source_refs = [...nullRefScope.source_refs, null];
  assert.equal(
    checksOf({
      transcript: transcriptWithScope(nullRefScope),
      records: records({ scope: nullRefScope }),
    }).mission_call_is_fully_joined,
    false,
  );
});

test("实际请求材料比 canon 多出未声明的 ref 时必须关闭", () => {
  const scope = scopeMessage();
  const recs = records({ scope });
  recs[0].request_body.messages[2].blocks[0].content.operation.mission_inputs.items.push({
    ref: "plan:2:extra",
    group: "plan",
    text: "请求中额外材料",
  });
  assert.equal(
    checksOf({
      transcript: transcriptWithScope(scope),
      records: recs,
    }).mission_call_is_fully_joined,
    false,
  );
});

test("缺 joinedRefs/request_body/response/tool_call/record 项时关闭而不崩溃", () => {
  const noJoined = input();
  noJoined.joinedRefs = null;
  assert.equal(missionSourceChecks(noJoined).checks.mission_call_is_fully_joined, false);

  assert.equal(
    checksOf({ records: records({ record: { request_body: null } }) }).mission_call_is_fully_joined,
    false,
  );
  assert.equal(
    checksOf({ records: records({ record: { response: null } }) }).mission_call_is_fully_joined,
    false,
  );
  assert.equal(
    checksOf({ records: records({ record: { response: { status: "ok", body: null } } }) })
      .mission_call_is_fully_joined,
    false,
  );
  assert.equal(
    checksOf({ records: records({ record: { response: { status: "ok", body: { tool_calls: [null] } } } }) })
      .mission_call_is_fully_joined,
    false,
  );
  assert.equal(checksOf({ records: [null] }).mission_call_is_fully_joined, false);
});

test("record turn_id 为空字符串时不能被当成合法 parent 作用域", () => {
  assert.equal(
    checksOf({ records: records({ record: { turn_id: "" } }) }).mission_call_is_fully_joined,
    false,
  );
});

test("响应条目的 null、空文本和额外字段不能被静默接受", () => {
  for (const must_advance of [
    [null],
    [{ text: "", basis_ref: "plan:2:chapter_role" }],
    [{
      text: "按本章计划完成既定情节推进。",
      basis_ref: "plan:2:chapter_role",
      extra: 1,
    }],
  ]) {
    assert.equal(
      checksOf({ records: records({ arguments: responseArguments({ must_advance }) }) })
        .mission_response_content_matches,
      false,
      JSON.stringify(must_advance),
    );
  }
});

test("空 statement、Infinity/NaN confidence 与坏条目让 call 证据整体关闭", () => {
  for (const argumentsValue of [
    responseArguments({ statement: "" }),
    responseArguments({ confidence: Infinity }),
    responseArguments({ confidence: NaN }),
    responseArguments({ must_advance: [null] }),
    responseArguments({ must_avoid: [null] }),
    responseArguments({ must_advance: [{ text: "", basis_ref: "plan:2:chapter_role" }] }),
    responseArguments({ must_advance: [{ text: "有文本", basis_ref: "" }] }),
  ]) {
    assert.equal(
      checksOf({ records: records({ arguments: argumentsValue }) }).mission_call_is_fully_joined,
      false,
      String(argumentsValue.confidence),
    );
  }
});

test("joinedRefs 只有 pcall 没有 prun 时关闭而不是崩溃", () => {
  const value = input();
  value.joinedRefs = { provider_call_refs: [PCALL] };
  assert.equal(missionSourceChecks(value).checks.mission_call_is_fully_joined, false);
});


test("真实 wire 与 canonical 共享结构 Scope 判据，重复历史保留，缺来源协议不放行", () => {
  assert.ok(Object.values(checksOf({ records: [wireRecordWithScope()] })).every(Boolean));
  assert.equal(checksOf({ records: [wireRecordWithScope(true)] }).mission_call_is_fully_joined, false);

  const repeated = input({ records: [wireRecordWithScope()] });
  repeated.transcript.messages.unshift(scopeMessage());
  repeated.sessionMessages.splice(2, 0, scopeMessage());
  repeated.records[0].request.body.messages.push({ role: "user", content: scopeProjection() });
  assert.ok(Object.values(missionSourceChecks(repeated).checks).every(Boolean));

  const collision = input({ records: [wireRecordWithScope()] });
  const quotedScope = {
    role: "user", provenance: "author", blocks: [{ type: "text", text: scopeProjection() }],
  };
  collision.transcript.messages.unshift(quotedScope);
  collision.sessionMessages.splice(2, 0, structuredClone(quotedScope));
  assert.equal(missionSourceChecks(collision).checks.mission_call_is_fully_joined, false);
});

test("完整请求绑定拒绝缺作者、错序或应用材料正文篡改，canonical 预期保持独立", () => {
  for (const kind of ["ir", "wire"]) {
    const original = input({ records: kind === "wire" ? [wireRecordWithScope()] : records() });
    assert.equal(missionSourceChecks(original).checks.mission_call_is_fully_joined, true);
    for (const mutation of ["missing_author", "reordered", "changed_material"]) {
      const value = structuredClone(original);
      const messages = kind === "wire" ? value.records[0].request.body.messages : value.records[0].request_body.messages;
      const baseIndex = kind === "wire" ? 1 : 0;
      const authorIndex = baseIndex + 1;
      if (mutation === "missing_author") messages.splice(authorIndex, 1);
      if (mutation === "reordered") [messages[baseIndex], messages[authorIndex]] = [messages[authorIndex], messages[baseIndex]];
      if (mutation === "changed_material") {
        if (kind === "wire") messages[baseIndex].content += "篡改后的材料。";
        else messages[baseIndex].blocks[0].text += "篡改后的材料。";
      }
      assert.deepEqual(value.sessionMessages, original.sessionMessages);
      assert.equal(missionSourceChecks(value).checks.mission_call_is_fully_joined, false, `${kind}: ${mutation}`);
    }
  }
});
