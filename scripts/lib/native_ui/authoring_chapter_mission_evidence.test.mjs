// B71 源阶段章使命证据的纯行为测试：pcall/prun/同次响应/请求 source_refs/
// basis_label/mission_derived 事件必须共同绑定；任一处不成立都失败。
// 运行：node --test scripts/lib/native_ui/authoring_chapter_mission_evidence.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthoringCanonSnapshot } from "./authoring_canon_evidence.mjs";
import { chapterMissionSourceChecks } from "./authoring_chapter_mission_evidence.mjs";

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
const SCOPE_VERSIONS = { change_reason: "chapter_mission", scope_revision: 3, goal_version: 1 };
const LABEL_ADVANCE = "章功能定位：动作章";
const LABEL_AVOID = "第4章前保密：黑账编号揭示矿区抽成流向";
const LABEL_OTHER = "场次1：交锋｜目标：夺回被抢走的黑账残页";

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
      type: "text",
      text: [
        "本次你承担写前推理器的角色。",
        "- [plan:2:rule_example] 规则示例：这不是正式材料声明。",
        "材料（每条以 [ref] 开头，方括号内的 ref 是唯一可引用的依据标识）：",
        "",
        "目标章：第02章：矿区追击战（chapter:chapter-2）",
        "",
        "### 本章计划（设计态）",
        `- [plan:2:chapter_role] ${LABEL_ADVANCE}`,
        `- [plan:2:scene:1] ${LABEL_OTHER}`,
        "",
        "### 后续章计划信息（不得提前揭示）",
        `- [ledger:information:plan_info_4] ${LABEL_AVOID}`,
        "",
        "## 当前运行权限与预算（不是执行批准）",
        "- [plan:rule_example] 这不是正式材料声明。",
      ].join("\n"),
    }],
  };
}

function scopeProjection(scope = scopeMessage()) {
  return [
    "【应用数据 · scope_update · 以最新版本为准】",
    `版本：${JSON.stringify(scope.versions)}`,
    ...scope.blocks.map((block) => block.text),
  ].join("\n");
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
          role: "system",
          provenance: "application",
          blocks: [{ type: "text", text: "system prompt" }],
          source_refs: [],
          versions: {},
        },
        {
          role: "user",
          provenance: "author",
          blocks: [{ type: "text", text: "写前推理材料" }],
          source_refs: [],
          versions: {},
        },
        {
          role: "scope_update",
          provenance: "application",
          blocks: [{ type: "text", text: scopeText(scope ?? scopeMessage()) }],
          source_refs: scopeSourceRefs(scope ?? scopeMessage()),
          versions: (scope ?? scopeMessage()).versions,
        },
      ],
      tools: [],
      projection: { tool_choice: null },
      refs: {},
    },
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

function scopeText(scope) {
  return (Array.isArray(scope?.blocks) ? scope.blocks : [])
    .map((block) => block?.text)
    .filter((text) => typeof text === "string" && text.trim() !== "")
    .join("\n");
}

function scopeSourceRefs(scope) {
  return Array.isArray(scope?.source_refs) ? scope.source_refs : [];
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
      author_narrative_source: {
        provider_call_ref: PCALL,
        provider_run_ref: PRUN,
      },
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
  const content = emptyMarker ? scopeText(scope) : scopeProjection(scope);
  const record = structuredClone(records()[0]);
  delete record.request_format;
  delete record.request_body;
  record.request = {
    body: {
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "写前推理材料" },
        { role: "user", content },
      ],
    },
  };
  return record;
}

function checksOf(overrides) {
  return chapterMissionSourceChecks(input(overrides)).checks;
}

test("合法暂定使命：pcall/prun、同次响应、请求 refs、被丢弃未知 basis 与事件全部绑定", () => {
  const value = chapterMissionSourceChecks(input());
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
  const result = chapterMissionSourceChecks(value);
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

test("请求投影的版本/原文/唯一性不符时失败", () => {
  const versionMismatch = records();
  versionMismatch[0].request_body.messages[2].versions.scope_revision = 4;
  assert.equal(checksOf({ records: versionMismatch }).mission_call_is_fully_joined, false);

  const textMismatch = records();
  textMismatch[0].request_body.messages[2].blocks[0].text =
    textMismatch[0].request_body.messages[2].blocks[0].text
      .replace(LABEL_ADVANCE, "请求里被改过的标签");
  assert.equal(checksOf({ records: textMismatch }).mission_call_is_fully_joined, false);

  const duplicate = records();
  duplicate[0].request_body.messages.push(
    structuredClone(duplicate[0].request_body.messages[2]),
  );
  assert.equal(checksOf({ records: duplicate }).mission_call_is_fully_joined, false);

  // canonical IR 的作者身份来自 role/provenance，不再依赖应用数据 marker。
  const noMarker = records();
  noMarker[0].request_body.messages[2].blocks[0].text = scopeMessage().blocks[0].text;
  assert.equal(checksOf({ records: noMarker }).mission_call_is_fully_joined, true);
});

test("同一 basis_ref 的冲突标签是歧义来源，不能后者覆盖前者", () => {
  const scope = scopeMessage();
  const previous = `- [plan:2:chapter_role] ${LABEL_ADVANCE}`;
  scope.blocks[0].text = scope.blocks[0].text.replace(
    previous,
    `- [plan:2:chapter_role] 冲突的来源标签\n${previous}`,
  );
  const checks = checksOf({
    transcript: transcriptWithScope(scope),
    records: records({ scope }),
  });
  assert.equal(checks.mission_call_is_fully_joined, false);
  assert.equal(checks.mission_retained_basis_and_labels_match, false);
});

test("只解析材料声明区：缺表头或材料 ref 超出 operation source_refs 均失败", () => {
  const noHeaderScope = scopeMessage();
  noHeaderScope.blocks[0].text = noHeaderScope.blocks[0].text
    .replace("材料（每条以 [ref] 开头，方括号内的 ref 是唯一可引用的依据标识）：\n", "");
  assert.equal(
    checksOf({
      transcript: transcriptWithScope(noHeaderScope),
      records: records({ scope: noHeaderScope }),
    }).mission_call_is_fully_joined,
    false,
  );

  const extraRefScope = scopeMessage();
  extraRefScope.blocks[0].text = extraRefScope.blocks[0].text.replace(
    `- [plan:2:scene:1] ${LABEL_OTHER}`,
    `- [plan:2:scene:1] ${LABEL_OTHER}\n- [plan:2:not_in_metadata] 未登记的来源`,
  );
  assert.equal(
    checksOf({
      transcript: transcriptWithScope(extraRefScope),
      records: records({ scope: extraRefScope }),
    }).mission_call_is_fully_joined,
    false,
  );
});

test("已成功派生的 mission 从设计态消失，不能因 before==after 被跳过", () => {
  const value = chapterMissionSourceChecks(input({
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
  const value = chapterMissionSourceChecks(input({
    startMission: missionMap(),
    beforeMission: missionMap(),
    beforeUpdated: BEFORE,
  }));
  assert.equal(value.measured.mission_changed, false);
  assert.ok(Object.values(value.checks).every(Boolean), JSON.stringify(value.checks));
});

test("mission 未变化、无事件但仍有成功调用时，不能把消失当成未派生", () => {
  const gone = chapterMissionSourceChecks(input({
    startMission: null,
    beforeMission: null,
    beforeUpdated: START,
    missionEvents: [],
  }));
  assert.equal(gone.measured.mission_changed, false);
  assert.equal(gone.checks.mission_call_is_fully_joined, false);
  assert.equal(gone.checks.mission_response_content_matches, false);

  const present = chapterMissionSourceChecks(input({
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

test("材料表头位于首行时仍解析；表头前的规则示例 ref 不进入来源映射", () => {
  const headerFirst = scopeMessage();
  const text = headerFirst.blocks[0].text;
  headerFirst.blocks[0].text = text.slice(text.indexOf("材料（每条以 [ref] 开头"));
  const value = chapterMissionSourceChecks(input({
    transcript: transcriptWithScope(headerFirst),
    records: records({ scope: headerFirst }),
  }));
  assert.ok(Object.values(value.checks).every(Boolean), JSON.stringify(value.checks));
});

test("单一材料行也是完整声明区，不因数量为 1 被当成空", () => {
  const scope = scopeMessage();
  scope.source_refs = [{ ref: "plan:2:chapter_role" }];
  scope.blocks[0].text = [
    "材料（每条以 [ref] 开头，方括号内的 ref 是唯一可引用的依据标识）：",
    `- [plan:2:chapter_role] ${LABEL_ADVANCE}`,
  ].join("\n");
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
  const value = chapterMissionSourceChecks(input({
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
  const value = chapterMissionSourceChecks(input({
    startMission: missionMap(),
    beforeMission: missionMap(),
    beforeUpdated: START,
    missionEvents: [],
    transcript: transcript([scopeMessage()]),
  }));
  assert.ok(Object.values(value.checks).every(Boolean), JSON.stringify(value.checks));
  assert.equal(value.measured.mission_changed, false);
  const author = chapterMissionSourceChecks(input({
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
  assert.equal(chapterMissionSourceChecks(input({ transcript: stringArgs })).checks.mission_call_is_fully_joined, true);

  for (const bad of [
    transcript([{ role: "assistant", provider_call_ref: PCALL, provider_run_ref: PRUN, blocks: [{ type: "tool_call", call_id: "c1", name: "chapter_mission", arguments: "{" }] }]),
    transcript([scopeMessage(), { role: "assistant", provider_call_ref: PCALL, provider_run_ref: PRUN, blocks: [{ type: "tool_call", call_id: "c1", name: "chapter_mission", arguments: "{bad" }] }]),
    transcript([{ role: "application_base", blocks: [] }, { role: "assistant", provider_call_ref: PCALL, provider_run_ref: PRUN, blocks: [{ type: "tool_call", call_id: "c1", name: "chapter_mission", arguments: responseArguments() }] }]),
    transcript([{ role: "scope_update", versions: { change_reason: "other" }, source_refs: [], blocks: [] }, { role: "assistant", provider_call_ref: PCALL, provider_run_ref: PRUN, blocks: [{ type: "tool_call", call_id: "c1", name: "chapter_mission", arguments: responseArguments() }] }]),
  ]) {
    assert.equal(chapterMissionSourceChecks(input({ transcript: bad })).checks.mission_call_is_fully_joined, false);
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
  const value = chapterMissionSourceChecks(input({
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
  const empty = chapterMissionSourceChecks({});
  assert.equal(empty.checks.mission_target_chapter_matches_source, false);
  assert.equal(empty.checks.mission_time_within_source_window, false);
  const activeNoChapter = chapterMissionSourceChecks({ missionEvents: [missionEvent()] });
  assert.equal(activeNoChapter.checks.mission_transition_is_legal, false);
  const noBefore = chapterMissionSourceChecks({
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
      chapterMissionSourceChecks(input({ transcript: t })).checks.mission_call_is_fully_joined,
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
      chapterMissionSourceChecks(input({ records: records({ arguments: args }) }))
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
      chapterMissionSourceChecks(value).checks.mission_target_chapter_matches_source,
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
    const value = chapterMissionSourceChecks(input({
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
    chapterMissionSourceChecks(value).checks.mission_target_chapter_matches_source,
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
  const value = chapterMissionSourceChecks(input({
    startMission: missionMap(),
    beforeMission: missionMap(),
  }));
  assert.equal(value.checks.author_version_not_rederived, true);
  assert.ok(Object.values(value.checks).every(Boolean), JSON.stringify(value.checks));
});

test("scope 帧缺 versions、材料块为 null、source_refs 含 null 项都关闭而不崩溃", () => {
  const missingVersions = {
    role: "scope_update",
    provenance: "application",
    source_refs: [{ ref: "plan:2:chapter_role" }],
    blocks: [{ type: "text", text: "材料（每条以 [ref] 开头）\n- [plan:2:chapter_role] 标签" }],
  };
  const t1 = transcript([missingVersions, ...transcript().messages.slice(1)]);
  assert.equal(checksOf({ transcript: t1 }).mission_call_is_fully_joined, false);

  const nullBlockScope = scopeMessage();
  nullBlockScope.blocks = [null, ...nullBlockScope.blocks];
  assert.equal(
    checksOf({
      transcript: transcriptWithScope(nullBlockScope),
      records: records(),
    }).mission_call_is_fully_joined,
    true,
  );

  const nullRefScope = scopeMessage();
  nullRefScope.source_refs = [...nullRefScope.source_refs, null];
  assert.equal(
    checksOf({
      transcript: transcriptWithScope(nullRefScope),
      records: records({ scope: nullRefScope }),
    }).mission_call_is_fully_joined,
    true,
  );
});

test("实际请求材料比 canon 多出未声明的 ref 时必须关闭", () => {
  const scope = scopeMessage();
  scope.blocks[0].text = [
    "材料（每条以 [ref] 开头，方括号内的 ref 是唯一可引用的依据标识）：",
    `- [plan:2:chapter_role] ${LABEL_ADVANCE}`,
    `- [plan:2:scene:1] ${LABEL_OTHER}`,
    `- [ledger:information:plan_info_4] ${LABEL_AVOID}`,
  ].join("\n");
  const recs = records({ scope });
  recs[0].request_body.messages[2].blocks[0].text += "\n- [plan:2:extra] 请求中额外材料";
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
  assert.equal(chapterMissionSourceChecks(noJoined).checks.mission_call_is_fully_joined, false);

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
  assert.equal(chapterMissionSourceChecks(value).checks.mission_call_is_fully_joined, false);
});


test("真实 wire scope 仍按原应用数据 marker 与版本行读取，缺 marker 不放行", () => {
  assert.ok(Object.values(checksOf({ records: [wireRecordWithScope()] })).every(Boolean));
  assert.equal(checksOf({ records: [wireRecordWithScope(true)] }).mission_call_is_fully_joined, false);
});
