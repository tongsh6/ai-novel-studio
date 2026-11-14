// B84 A2 + B71 修订批次测试族纯事实 owner：只提供内存字节/行，不创建目录、DB
// 或子进程。真实文件与 SQLite 模板在 `native_b71_revision_io_fixture.mjs`；
// 测试与 IO fixture 共享同一组事实，避免各自复制期望。本模块不 import 被测 SUT
// （canon 快照由消费者用既有纯函数合成后作为规格输入传入）。
import { TRACE as COPY_TRACE } from "../../../../frontend/src/lib/copy.ts";
import { irBodyFromWire } from "./authoring_request_ir.mjs";

export const WORK = "11111111-1111-4111-8111-111111111111";
export const WORKSPACE = "22222222-2222-4222-8222-222222222222";
export const SESSION = "33333333-3333-4333-8333-333333333333";
export const MEMORY = "44444444-4444-4444-8444-444444444444";
export const USER_TURN = "turn-user-revision";
export const SOURCE_TURN = "turn-source-revision";
export const CHILD_TURN = "turn-child-revision";
export const SOURCE_RUN = "run-source-revision";
export const CHILD_RUN = "run-child-revision";
export const RECEIPT = "receipt-revision";
export const TRACE = "trace-revision";
export const CHAPTER_TITLE = "第02章：矿区追击战";
export const CHAPTER_BRIEF = `${CHAPTER_TITLE}。本章方向：短促的动作追击。`;
// WorkspaceChat.onDraftChapter 的真实可见命令模板；source 合成不得再写旁路假文本。
export const SOURCE_MESSAGE = `请根据已采纳章节计划生成${CHAPTER_BRIEF}正文草稿，保持为待采纳草稿。`;
export const ORIGINAL_BODY = "他猛地侧身。\n他一刀劈下。\n他反手格挡。\n他迈步逼近。\n他咬住暗号继续逼近。";
export const REVISED_BODY = "他侧身避开巡檢傀儡的第一击，退路在矿道尽头收窄。\n他反手格挡，借力滚进黑暗。\n他迈步逼近。\n他咬住暗号继续逼近。";
export const ITEM_ID = "revision-item-1";
export const FINDING_ID = "qf_slice_action_rhythm";
export const SEGMENT_VERSION = "authoring-run-segment/v1";

// 历史批次固定时刻：同一规格在 run 内只物化一次，不用 Date.now 污染指纹。
export const BASE_AT = Date.parse("2026-11-02T10:00:00.000Z");

export function iso(offsetMs) {
  return new Date(BASE_AT + offsetMs).toISOString();
}

function transcript(run, messages) {
  return {
    run,
    system: {},
    projection: {},
    messages,
    tools: [],
    base_refs: [],
    observation_refs: [],
    used_refs: [],
    call_ids: [],
  };
}

function assistant(pcall, prun, callId, name, args) {
  return {
    role: "assistant",
    provenance: "model",
    provider_call_ref: pcall,
    provider_run_ref: prun,
    blocks: [{ type: "tool_call", call_id: callId, name, arguments: args }],
  };
}

function validation(callId, status, reasonCode) {
  return {
    role: "tool",
    provenance: "tool_result",
    source_refs: [],
    versions: {},
    blocks: [{ type: "validation_result", call_id: callId, status, reason_code: reasonCode }],
  };
}

function pendingArtifact(artifactId, item, extra = {}) {
  return {
    artifact_id: artifactId,
    artifact_type: "prose_fragment",
    adoption_status: "TENTATIVE",
    requires_adoption: true,
    source_tool_result_ref: "tool-result-1",
    authoring_intent: null,
    target_chapter: CHAPTER_TITLE,
    target_chapter_ref: "chapter:chapter-2",
    payload: { items: [item], item_count: 1, title: `${CHAPTER_TITLE}正文草稿` },
    ...extra,
  };
}

export function sourceItem() {
  return {
    item_id: "source-item-1",
    title: `${CHAPTER_TITLE}正文草稿`,
    body: ORIGINAL_BODY,
    rationale: "根据已采纳章节计划生成待确认创作素材，未写入作品事实。",
  };
}

export function revisionItem() {
  return {
    item_id: ITEM_ID,
    title: `${CHAPTER_TITLE}修订稿`,
    body: REVISED_BODY,
    rationale: "按质量发现只调整动作句段，原稿保留。",
  };
}

export function artifacts() {
  const source = pendingArtifact("as-original", sourceItem());
  const revision = pendingArtifact("as-revision", revisionItem(), { revision_of: "as-original" });
  return { sourceArtifact: source, revisionArtifact: revision };
}

export function transcripts() {
  const { sourceArtifact } = artifacts();
  const sourceMessages = [
    { role: "system", blocks: [{ type: "text", text: "source" }] },
    assistant("pcall-source", "prun-source", "call-source", "submit_tentative_artifact", {
      items: [sourceItem()],
    }),
  ];
  const childMessages = [
    { role: "system", blocks: [{ type: "text", text: "system" }] },
    { role: "application_base", blocks: [{ type: "text", text: "revision" }] },
    assistant("pcall-1", "prun-1", "call-1", "submit_tentative_artifact", {}),
    validation("call-1", "failed", "invalid_items"),
    assistant("pcall-2", "prun-2", "call-2", "submit_tentative_artifact", {
      items: [revisionItem()],
    }),
    validation("call-2", "passed", "tentative_artifact_validated"),
  ];
  return {
    sourceTranscript: transcript(
      {
        run_id: SOURCE_RUN,
        workspace_id: WORKSPACE,
        work_id: WORK,
        session_id: SESSION,
        parent_turn_ref: USER_TURN,
      },
      sourceMessages,
    ),
    childTranscript: transcript(
      {
        run_id: CHILD_RUN,
        workspace_id: WORKSPACE,
        work_id: WORK,
        session_id: SESSION,
        parent_turn_ref: SOURCE_TURN,
      },
      childMessages,
    ),
    sourceArtifact,
  };
}

export function readyPayload() {
  return {
    run_ref: "run-ref-revision",
    driver: "external-system-ui",
    browser_driver_started: false,
    app_path: "/tmp/AI Novel Studio.app",
    bundle_identifier: "com.ai-novel-studio.app",
    provider: "slice_verify",
    slice_id: "b71-authoring-revision",
    ready_at: iso(0),
  };
}

export const SCREENSHOTS = Object.freeze(["01-workbench", "02-quality", "03-revision", "04-why"]);

export function uiCompletePayload() {
  return {
    harness_run_ref: "run-ref-revision",
    driver: "ax-native-system-ui",
    app_bundle: "com.ai-novel-studio.app",
    screenshots: SCREENSHOTS.map((name) => `${name}.jpg`),
    scope: "b71-authoring-revision",
  };
}

export function qualityText() {
  return [
    "质量复核：发现 1 项可改进问题",
    "原句",
    "位置 · 第 1–3 句",
    "判断理由",
    "影响范围 · 局部",
    "置信度 88%",
    "局部修订所选问题",
  ].join("\n");
}

export function revisionText() {
  return "原稿\n保存原稿\n修订稿\n保存修订稿\n放弃修订稿";
}

export function whyText() {
  return [COPY_TRACE.replayComplete, COPY_TRACE.replayNoProvider, "参考来源"].join("\n");
}

export function seedLog() {
  return `[seed] work_id=${WORK} session_id=${SESSION}\n`;
}

export function configPayload() {
  return {
    slice_id: "b71-authoring-revision",
    journey: "revision",
    target: { work_id: WORK, work_title: "质量修订真实原生验收" },
    message: "",
    chapter_title: CHAPTER_TITLE,
  };
}

const WAIT_KINDS = ["maintenance", "input", "ack", "turn", "maintenance", "input", "ack", "turn", "input", "turn"];

export function driverCommands() {
  return WAIT_KINDS.flatMap((kind, index) => {
    const id = `wait-${index}`;
    return [
      { op: "begin", id, kind, at: BASE_AT + index },
      { op: "finish", id, kind, at: BASE_AT + index + 1 },
    ];
  });
}

export function waitEvents() {
  return WAIT_KINDS.flatMap((kind, index) => [
    { event: "wait_start", kind, at: BASE_AT + index },
    { event: "wait_end", kind, ended_at: BASE_AT + index + 1 },
  ]);
}

export function waitStats() {
  return { active: null, completed: WAIT_KINDS.length };
}

export function appLogRecords() {
  return [1, 2, 3].map((n) => ({
    event: "provider_gateway.complete.start",
    provider: "slice_verify",
    timestamp: iso(n * 1000),
  }));
}

function firstRequest() {
  return [
    { role: "system", content: "system" },
    {
      role: "application_base",
      content: `原正文：\n${ORIGINAL_BODY}\n[质量修订要求]\n只改命中句段，让动作在风险、后果或视角上形成递进。`,
    },
  ];
}

function llmRecords() {
  const failedTool = {
    role: "tool",
    tool_call_id: "call-1",
    content: JSON.stringify({
      type: "validation_result",
      call_id: "call-1",
      status: "failed",
      reason_code: "invalid_items",
    }),
  };
  const request = firstRequest();
  return [
    {
      provider: "slice_verify",
      ts: iso(1),
      provider_call_ref: "pcall-source",
      provider_run_ref: "prun-source",
      work_id: WORK,
      session_id: SESSION,
      turn_id: USER_TURN,
      request_format: "authoring-request-ir/v1",
      response_format: "fixture_provider_result/v1",
      request_body: irBodyFromWire({ messages: [{ role: "user", content: "source" }] }),
      response: {
        status: "ok",
        body: {
          content: "",
          tool_calls: [
            { id: "call-source", name: "submit_tentative_artifact", arguments: { items: [sourceItem()] } },
          ],
        },
      },
    },
    {
      provider: "slice_verify",
      ts: iso(2),
      provider_call_ref: "pcall-1",
      provider_run_ref: "prun-1",
      work_id: WORK,
      session_id: SESSION,
      turn_id: SOURCE_TURN,
      request_format: "authoring-request-ir/v1",
      response_format: "fixture_provider_result/v1",
      request_body: irBodyFromWire({ messages: request }),
      response: {
        status: "ok",
        body: {
          content: "",
          tool_calls: [{ id: "call-1", name: "submit_tentative_artifact", arguments: {} }],
        },
      },
    },
    {
      provider: "slice_verify",
      ts: iso(3),
      provider_call_ref: "pcall-2",
      provider_run_ref: "prun-2",
      work_id: WORK,
      session_id: SESSION,
      turn_id: SOURCE_TURN,
      request_format: "authoring-request-ir/v1",
      response_format: "fixture_provider_result/v1",
      request_body: irBodyFromWire({
        messages: [
          ...request,
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "submit_tentative_artifact", arguments: "{}" },
              },
            ],
          },
          failedTool,
        ],
        tool_choice: { type: "function", function: { name: "submit_tentative_artifact" } },
      }),
      response: {
        status: "ok",
        body: {
          content: "",
          tool_calls: [
            { id: "call-2", name: "submit_tentative_artifact", arguments: { items: [revisionItem()] } },
          ],
        },
      },
    },
  ];
}

function finding() {
  return {
    quality_finding_id: FINDING_ID,
    revision_scope: "local",
    impact_scope: "local",
    evidence_spans: [
      {
        text: "他猛地侧身。\n他一刀劈下。\n他反手格挡。",
        sentence_start: 1,
        sentence_end: 3,
      },
    ],
    suggested_revision: { instruction: "只改命中句段，让动作在风险、后果或视角上形成递进。" },
    confidence: 0.88,
  };
}

function sourceResult() {
  const { sourceArtifact } = artifacts();
  return {
    turn_id: SOURCE_TURN,
    status: "conversational",
    phase: "completed",
    agent_run: {
      run_id: SOURCE_RUN,
      status: "completed",
      run_mode: "bounded",
      profile_ref: "prose_drafting_with_quality_v1",
      parent_turn_ref: USER_TURN,
    },
    adoption_state: { pending: [sourceArtifact], resolved: [] },
    quality_review: { review_status: "completed", findings: [finding()] },
    available_actions: [
      {
        action_type: "revise_from_findings",
        target_ref: "as-original",
        source_turn_ref: SOURCE_TURN,
        quality_finding_refs: [FINDING_ID],
      },
    ],
    truthfulness: { artifact_adopted: false, production_write_performed: false },
  };
}

function childResult() {
  const { revisionArtifact } = artifacts();
  return {
    turn_id: CHILD_TURN,
    status: "conversational",
    phase: "completed",
    agent_run: {
      run_id: CHILD_RUN,
      status: "completed",
      run_mode: "bounded",
      profile_ref: "prose_revision_from_findings_v1",
      parent_turn_ref: SOURCE_TURN,
      trigger: {
        kind: "author_action",
        receipt_id: RECEIPT,
        source_turn_ref: SOURCE_TURN,
        target_artifact_ref: "as-original",
        quality_finding_refs: [FINDING_ID],
      },
    },
    adoption_state: { pending: [revisionArtifact], resolved: [] },
    available_actions: [
      { action_type: "accept", target_ref: "as-revision" },
      { action_type: "discard", target_ref: "as-revision" },
    ],
    trace_summary: {
      trace_ref: TRACE,
      decision_ref: "decision-child",
      tool_result_id: "tool-result-child",
      revision_base: "as-original",
      revision_artifact_ref: "as-revision",
      revision_provider_call_ref: "pcall-2",
      quality_finding_refs: [FINDING_ID],
    },
    truthfulness: { artifact_adopted: false, production_write_performed: false },
    assistant_message: { text: "已生成修订草稿。" },
  };
}

function childState() {
  return {
    run_id: CHILD_RUN,
    status: "completed",
    phase: "completed",
    workspace_id: WORKSPACE,
    work_id: WORK,
    session_id: SESSION,
    parent_turn_ref: SOURCE_TURN,
    run_mode: "bounded",
    profile_ref: "prose_revision_from_findings_v1",
    trigger: {
      kind: "author_action",
      receipt_id: RECEIPT,
      source_turn_ref: SOURCE_TURN,
      target_artifact_ref: "as-original",
      quality_finding_refs: [FINDING_ID],
    },
  };
}

function actionResult() {
  return {
    status: "running",
    run_id: CHILD_RUN,
    receipt_id: RECEIPT,
    source_turn_ref: SOURCE_TURN,
    target_artifact_ref: "as-original",
    run_mode: "bounded",
    profile_ref: "prose_revision_from_findings_v1",
  };
}

function action() {
  return {
    action_id: "revise_from_findings:as-original",
    action_type: "revise_from_findings",
    source_turn_ref: SOURCE_TURN,
    target_ref: "as-original",
    payload: { quality_finding_refs: [FINDING_ID] },
  };
}

function wireFrame(direction, at, frame) {
  return { direction, at, frame };
}

export function wireRecords() {
  const topic = `workspace:${WORKSPACE}`;
  const source = sourceResult();
  const child = childResult();
  return [
    wireFrame("sent", iso(-1000), ["join-1", "join-1", topic, "phx_join", { work_id: WORK, session_id: SESSION }]),
    wireFrame("received", iso(-900), ["join-1", "join-1", topic, "phx_reply", {
      status: "ok",
      response: { joined: true, work_id: WORK, session_id: SESSION },
    }]),
    wireFrame("sent", iso(1000), ["join-1", "req-user", topic, "user_message", {
      text: SOURCE_MESSAGE,
      turn_id: USER_TURN,
      work_id: WORK,
      session_id: SESSION,
      generate_micro_plan: true,
    }]),
    wireFrame("received", iso(2000), ["join-1", "req-user", topic, "phx_reply", {
      status: "ok",
      response: { turn_id: USER_TURN, run_id: SOURCE_RUN },
    }]),
    wireFrame("received", iso(3000), [null, null, topic, "turn_result", source]),
    wireFrame("sent", iso(4000), ["join-1", "req-action", topic, "author_action", { action: action() }]),
    wireFrame("received", iso(5000), [null, null, topic, "action_result", actionResult()]),
    wireFrame("received", iso(6000), ["join-1", "req-action", topic, "phx_reply", {
      status: "ok",
      response: {
        received: true,
        action_status: "running",
        run_id: CHILD_RUN,
        receipt_id: RECEIPT,
        source_turn_ref: SOURCE_TURN,
        target_artifact_ref: "as-original",
        run_mode: "bounded",
        profile_ref: "prose_revision_from_findings_v1",
      },
    }]),
    wireFrame("received", iso(7000), [null, null, topic, "agent_run_state", childState()]),
    wireFrame("received", iso(8000), [null, null, topic, "turn_result", child]),
    {
      direction: "http",
      status: 200,
      path: `/api/works/${WORK}/sessions/${SESSION}/turns/${encodeURIComponent(CHILD_TURN)}/replay`,
      at: iso(10_000),
    },
  ];
}

export function checkpointPayload() {
  const startCounts = dbProductionCounts(0);
  const finalCounts = dbProductionCounts(1);
  return {
    start: { checkpoint: "start", db_production_counts: startCounts },
    beforeRevision: { checkpoint: "before-revision", db_production_counts: startCounts },
    final: { checkpoint: "final", db_production_counts: finalCounts },
    beforeWhy: { checkpoint: "before-why", at: iso(9000) },
    afterWhy: { checkpoint: "after-why", at: iso(11_000) },
  };
}

export function dbProductionCounts(receipts) {
  return {
    works: 1,
    workspaces: 1,
    work_sessions: 1,
    chapters: 1,
    volumes: 0,
    scenes: 0,
    characters: 0,
    memory_items: 1,
    ledger_entries: 0,
    author_action_receipts: receipts,
  };
}

// 9 张 canon 表当前行的纯数据；消费者用既有纯函数合成快照后作为规格输入传入。
export function canonTables({ withReceipt = false } = {}) {
  return {
    works: [{ id: WORK }],
    drafts: [],
    chapters: [
      {
        id: "chapter-2",
        work_id: WORK,
        volume_id: null,
        title: CHAPTER_TITLE,
        seq: 2,
        status: "PLANNED",
        inserted_at: iso(0),
        updated_at: iso(0),
        summary: "本章方向：短促的动作追击。",
        plan_direction: JSON.stringify({ chapter_role: "动作章" }),
      },
    ],
    volumes: [],
    scenes: [],
    characters: [],
    memory_items: [{ id: MEMORY, work_id: WORK, reference_count: 0, last_referenced_at: null }],
    ledger_entries: [],
    author_action_receipts: withReceipt ? [{ id: RECEIPT }] : [],
  };
}

export function llmFixtureRecords() {
  return llmRecords();
}
