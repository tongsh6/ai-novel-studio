// R03 讨论覆盖唯一合成事实：预注册原作者/义务、canonical 行和独立 native wire。
// 不消费产品投影；可指定 scope 供交错场景组合，无 IO。
import { createHash } from "node:crypto";
import { scopeWireMessage } from "./authoring_request_ir.mjs";

export function discussionCoverageFacts({ workId = "work-discussion", sessionId = "session-discussion" } = {}) {
  const WORK = workId, SESSION = sessionId;
  const coordinate = (run, sequence, status = "completed") => ({
    run_id: run, run_sequence: sequence, run_status: status,
    workspace_id: WORK, work_id: WORK, session_id: SESSION, parent_turn_ref: "turn-" + run,
  });
  const message = (run, sequence, role, provenance, text) => ({
    role, provenance, blocks: [{ type: "text", text }],
    source_refs: role === "user" ? [{ ref: "turn-" + run, version: 1 }] : [], versions: {},
    canonical_ref: coordinate(run, sequence),
  });
  const author = message("early", 2, "user", "author", "  比较双视角与单视角；先别执行，仍欠风险表。\r\n");
  const oldScope = message("early", 3, "scope_update", "application", "");
  oldScope.blocks = [{ type: "scope", content: { choice: null, source: "原范围" } }];
  oldScope.source_refs = [{ ref: "context:old", version: 7 }];
  oldScope.versions = { goal: 1 };
  const discussion = message("early", 4, "assistant", "model",
    "早期长讨论\n" + "两种方案需要结合叙事目的比较。".repeat(1200) + "\n我还没有完成风险表，下一轮会逐项比较。\n请作者确认结尾是否揭密。");
  const currentAuthor = message("current", 2, "user", "author", "选单视角，之前欠的风险表照做。");
  const currentScope = message("current", 3, "scope_update", "application", "");
  currentScope.blocks = [{ type: "scope", content: { choice: "单视角", source: "当前范围" } }];
  const selector = (source) => ({ run_id: source.canonical_ref.run_id, run_sequence: source.canonical_ref.run_sequence,
    role: source.role, source_refs: source.source_refs, versions: source.versions });
  // 预期义务先于摘要固定，摘要删改不能改变此 oracle。
  const obligations = ["我还没有完成风险表，下一轮会逐项比较。", "请作者确认结尾是否揭密。"];
  const raw = JSON.stringify({ version: "authoring-discussion-summary/v1",
    entries: [{ source_index: 0, summary: "早期 AI 讨论两种视角，风险表仍未完成，结尾揭密待作者确认。",
      retained_obligations: obligations }] });
  const checkpoint = message("current", 4, "checkpoint", "application", "");
  checkpoint.blocks = [{ type: "checkpoint",
    covers: { call_ids: [], message_refs: [selector(oldScope), selector(discussion)], turn_range: "turn-early" },
    source_refs: [...oldScope.source_refs,
      { ref: "session_message:early:3", version: 1 }, { ref: "session_message:early:4", version: 1 }],
    versions: {}, omissions: ["省略旧范围与早期 AI 讨论的重复展开；原始记录仍保留。"],
    discussion: { response_text: raw, response_sha256: createHash("sha256").update(raw).digest("hex"),
      provider_run_ref: "prun-summary", provider_call_ref: "pcall-summary" },
  }];
  return { messages: [author, oldScope, discussion, currentAuthor, currentScope, checkpoint],
    obligations, options: { verifyExecutions: true,
      providerRuns: [{ id: "prun-summary", provider_call_ref: "pcall-summary", agent_run_id: "current",
        workspace_id: WORK, work_id: WORK, session_id: SESSION, parent_turn_ref: "turn-current",
        status: "completed", purpose: "other", owner_refs: { operation: "transcript_compaction",
          agent_run_id: "current", workspace_id: WORK, work_id: WORK, session_id: SESSION,
          parent_turn_ref: "turn-current",
          discussion_source_keys: ["authoring-session-source/v1:" + JSON.stringify([WORK, WORK, SESSION, "early", 4])] } }],      providerOutputs: [{ provider_run_id: "prun-summary", provider_call_ref: "pcall-summary",
        agent_run_id: "current", status: "ok", content_summary: { content_sha256: checkpoint.blocks[0].discussion.response_sha256 } }],
    } };
}


export function discussionMaintenanceFacts({ workId = "work-discussion", sessionId = "session-discussion" } = {}) {
  const WORK = workId, SESSION = sessionId;
  const run = (id) => ({ id, workspace_id: WORK, work_id: WORK, session_id: SESSION,
    parent_turn_ref: "turn-" + id, status: "completed" });
  const spec = discussionCoverageFacts({ workId, sessionId });
  const [author, oldScope, discussion, currentAuthor, currentScope, checkpoint] = spec.messages;
  const summaryRecord = {
    provider: "splash", provider_run_ref: "prun-summary", provider_call_ref: "pcall-summary",
    workspace_id: WORK, work_id: WORK, session_id: SESSION, turn_id: "turn-current",    request: { body: { model: "local/Q4-PLE4", reasoning_effort: "high", max_tokens: 8192,
      messages: [{ role: "user", content: "【应用数据 · application_base · 非作者原话】\n" + JSON.stringify({
        material_kind: "quoted_discussion_sources", sources: [{ source_index: 0,
          source: { run_id: "early", run_sequence: 4 }, text: discussion.blocks[0].text,
          author_text: author.blocks[0].text }],
      }) }], tools: [] } },
  };
  const after = {
    provider: "splash", provider_run_ref: "prun-after", provider_call_ref: "pcall-after",
    work_id: WORK, session_id: SESSION, turn_id: "turn-current",
    response: { status: 200, usage: { input_tokens: 23000, output_tokens: 40 } },
    request: { body: { messages: [
    { role: "user", content: author.blocks[0].text },
    { role: "user", content: currentAuthor.blocks[0].text },
    scopeWireMessage(currentScope.blocks[0].content, { versions: currentScope.versions, sourceRefs: currentScope.source_refs }),
    { role: "user", content: "【应用数据 · checkpoint · 非作者原话】\n【应用数据 · checkpoint · 覆盖 " +
      JSON.stringify(checkpoint.blocks[0].covers) + "】\n早期讨论尚欠风险表与作者结尾确认。" },
  ] } } };
  const reply = { role: "assistant", provenance: "model", provider_run_ref: "prun-after", provider_call_ref: "pcall-after",
    blocks: [{ type: "text", text: "选择单视角不代表已完成风险表。" }], source_refs: [], versions: {},
    canonical_ref: { ...currentAuthor.canonical_ref, run_sequence: 5 } };
  const base = (runId) => ({ role: "application_base", provenance: "application",
    blocks: [{ type: "text", text: "创作助手" }], canonical_ref: {
      ...author.canonical_ref, run_id: runId, run_sequence: 1, parent_turn_ref: "turn-" + runId } });
  const all = [base("early"), author, oldScope, discussion, base("current"), currentAuthor, currentScope, checkpoint, reply];
  const runs = ["early", "current"].map(run);
  const providerRuns = [...spec.options.providerRuns.map((run) => ({ ...run, provider_id: "splash" })),
    { ...run("prun-after"), agent_run_id: "current", parent_turn_ref: "turn-current",
      provider_call_ref: "pcall-after", provider_id: "splash", purpose: "planner" }];
  const db = { agent_runs: runs, authoring_session_messages: all.map((message, index) => {
    const { canonical_ref: ref, ...body } = message;
    return { id: "row-" + index, run_id: ref.run_id, run_sequence: ref.run_sequence,
      workspace_id: WORK, work_id: WORK, session_id: SESSION, sequence: index + 1,
      role: body.role, format_version: "authoring-session-message/v1", message: JSON.stringify(body) };
  }), agent_events: [{ id: "event-discussion", run_id: "current", event_type: "checkpoint_created", sequence: 1,
    inserted_at: "2026-11-04T10:00:00.000Z", payload: { covered_counts: { tool_exchanges: 0, scope_updates: 1, discussion_messages: 1 } } }],
    provider_runs: providerRuns, provider_outputs: spec.options.providerOutputs,
    provider_events: [{ id: "after-start", provider_run_id: "prun-after", provider_call_ref: "pcall-after",
      event_type: "started", emitted_at: "2026-11-04T10:00:00.500Z" }], interactions: [], mutations: [] };
  return { ...spec, db, llmRecords: [summaryRecord, after], after, summaryRecord,
    options: { ...spec.options, verifyRequests: true, providerRecords: [summaryRecord] } };
}
// 固定 D 持久失败 → 新作者 E 来源恢复的合成事实；不从 oracle 输出生成预期。
export function maintenanceRecoveryFacts({ workId = "work-discussion", sessionId = "session-discussion", base = null, baseRecords = [], failureInput = null, recoveryInputs = null } = {}) {
  const original = discussionMaintenanceFacts({ workId, sessionId });
  const clone = (value) => structuredClone(value);
  const tables = ["agent_runs", "agent_events", "authoring_session_messages", "provider_runs", "provider_outputs", "provider_events", "interactions", "mutations"];
  const empty = Object.fromEntries(tables.map((key) => [key, []]));
  const seed = base ? clone(base) : empty;
  const append = (target, addition) => {
    for (const key of tables) target[key].push(...clone(addition[key] ?? []));
  };
  const remap = (value, replacements) => JSON.parse(Object.entries(replacements).reduce(
    (text, [from, to]) => text.replaceAll(from, to), JSON.stringify(value)));
  const source = remap(original.db, { early: "source-d", current: "failed-d", "prun-summary": "prun-failed-d",
    "pcall-summary": "pcall-failed-d", "prun-after": "prun-unused-d", "pcall-after": "pcall-unused-d" });
  const offset = Math.max(0, ...seed.authoring_session_messages.map((row) => row.sequence));
  const resequence = (rows, start) => rows.map((row, index) => ({ ...row, id: "recovery-row-" + (start + index),
    sequence: start + index }));
  const earlyRows = resequence(source.authoring_session_messages.filter((row) => row.run_id === "source-d"), offset + 1);
  const before = clone(seed);
  before.agent_runs.push(source.agent_runs.find((run) => run.id === "source-d"));
  before.authoring_session_messages.push(...earlyRows);
  before.captured_at = "2026-11-04T10:06:00.000Z";
  const failedRows = resequence(source.authoring_session_messages.filter((row) =>
    row.run_id === "failed-d" && ["application_base", "user", "scope_update"].includes(row.role)), offset + earlyRows.length + 1);
  const setAuthorText = (rows, runId, input) => {
    if (!input) return;
    const row = rows.find((item) => item.run_id === runId && item.role === "user");
    const body = JSON.parse(row.message);
    body.blocks = [{ type: "text", text: input.text }];
    row.message = JSON.stringify(body);
  };
  setAuthorText(failedRows, "failed-d", failureInput);
  const afterFailure = clone(before);
  afterFailure.agent_runs.push(source.agent_runs.find((run) => run.id === "failed-d"));
  afterFailure.authoring_session_messages.push(...failedRows);
  const failedProvider = source.provider_runs.find((run) => run.id === "prun-failed-d");
  failedProvider.owner_refs = { operation: "transcript_compaction", coverage_key: "d".repeat(64), discussion_source_keys: ["a".repeat(64)] };
  afterFailure.provider_runs.push(failedProvider);
  afterFailure.provider_outputs.push(source.provider_outputs[0]);
  afterFailure.provider_events.push({ id: "failed-d-start", provider_run_id: failedProvider.id,
    provider_call_ref: failedProvider.provider_call_ref, event_type: "started", emitted_at: "2026-11-04T10:06:10.000Z" });
  afterFailure.captured_at = "2026-11-04T10:07:00.000Z";
  const failedRecord = remap(original.summaryRecord, { early: "source-d", current: "failed-d",
    "prun-summary": "prun-failed-d", "pcall-summary": "pcall-failed-d" });
  const recovered = remap(original, { early: "source-e", current: "recovered-e",
    "prun-summary": "prun-recovered-e", "pcall-summary": "pcall-recovered-e",
    "prun-after": "prun-final-e", "pcall-after": "pcall-final-e" });
  const recoveryIds = ["source-e"];
  if (recoveryInputs) {
    setAuthorText(recovered.db.authoring_session_messages, "source-e", recoveryInputs[0]);
    setAuthorText(recovered.db.authoring_session_messages, "recovered-e", recoveryInputs.at(-1));
    const materialMessage = recovered.summaryRecord.request.body.messages[0];
    const prefix = materialMessage.content.indexOf("\n") + 1;
    const material = JSON.parse(materialMessage.content.slice(prefix));
    material.sources[0].author_text = recoveryInputs[0].text;
    materialMessage.content = materialMessage.content.slice(0, prefix) + JSON.stringify(material);
    const between = [];
    for (const [index, input] of recoveryInputs.slice(1, -1).entries()) {
      const id = "recovery-middle-" + index;
      recoveryIds.push(id);
      const templateRun = recovered.db.agent_runs.find((run) => run.id === "source-e");
      recovered.db.agent_runs.push({ ...templateRun, id, parent_turn_ref: "turn-" + id });
      for (const sourceRow of recovered.db.authoring_session_messages.filter((row) =>
        row.run_id === "source-e" && ["application_base", "user", "scope_update"].includes(row.role))) {
        const row = remap(sourceRow, { "source-e": id });
        if (row.role === "user") {
          const message = JSON.parse(row.message);
          message.blocks = [{ type: "text", text: input.text }];
          row.message = JSON.stringify(message);
        }
        between.push(row);
      }
    }
    const boundary = recovered.db.authoring_session_messages.findIndex((row) => row.run_id === "recovered-e");
    recovered.db.authoring_session_messages.splice(boundary, 0, ...between);
  }
  recoveryIds.push("recovered-e");
  recovered.db.authoring_session_messages = resequence(recovered.db.authoring_session_messages,
    offset + earlyRows.length + failedRows.length + 1);
  recovered.db.provider_runs.find((run) => run.id === "prun-recovered-e").owner_refs = {
    operation: "transcript_compaction", coverage_key: "e".repeat(64), discussion_source_keys: ["b".repeat(64)] };
  recovered.db.agent_events[0].id = "checkpoint-recovered-e";
  recovered.db.agent_events[0].inserted_at = "2026-11-04T10:10:00.000Z";
  recovered.db.provider_events[0].id = "final-e-start";
  recovered.db.provider_events[0].emitted_at = "2026-11-04T10:10:01.000Z";
  const db = clone(afterFailure);
  append(db, recovered.db);
  db.captured_at = "2026-11-04T10:11:00.000Z";
  const canonicalBody = (row) => JSON.parse(row.message);
  const text = (row) => canonicalBody(row).blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
  const authorRows = db.authoring_session_messages.filter((row) => row.role === "user");
  const request = (runId) => ({ run_id: runId, settled: true, run_status: "completed",
    text: text(authorRows.find((row) => row.run_id === runId)) });
  const checkpointWire = (row) => ({ role: "user", content: "【应用数据 · checkpoint · 非作者原话】\n【应用数据 · checkpoint · 覆盖 " +
    JSON.stringify(canonicalBody(row).blocks[0].covers) + "】\n原始记录保留。" });
  // 独立预置期望：仅 source-e 的旧 Scope/讨论被覆盖，D 失败来源仍完整；全部作者原话保留。
  recovered.after.request.body.messages = [
    ...authorRows.map((row) => ({ role: "user", content: text(row) })),
    ...db.authoring_session_messages.filter((row) => row.role === "scope_update" && row.run_id !== "source-e").map((row) => {
      const message = canonicalBody(row);
      return scopeWireMessage(message.blocks[0].content, { versions: message.versions, sourceRefs: message.source_refs });
    }),
    { role: "assistant", content: text(earlyRows.find((row) => row.role === "assistant")) },
    ...db.authoring_session_messages.filter((row) => row.role === "checkpoint").map(checkpointWire),
  ];
  const records = [...clone(baseRecords), failedRecord, recovered.summaryRecord, recovered.after];
  const counts = (snapshot, key) => key === "events" ? snapshot.agent_events.filter((row) => row.event_type === "checkpoint_created").length :
    snapshot.authoring_session_messages.filter((row) => row.role === "checkpoint").length;
  const injection = { trigger_created: true, author_error_visible: false,
    injected_at: "2026-11-04T10:06:01.000Z", removed_at: "2026-11-04T10:06:59.000Z",
    failure_request: request("failed-d"), recovery_requests: recoveryIds.map(request),
    checkpoint_events_before_failure: counts(before, "events"), checkpoint_events_after_failure: counts(afterFailure, "events"),
    checkpoint_messages_before_failure: counts(before, "messages"), checkpoint_messages_after_failure: counts(afterFailure, "messages") };
  const inputs = { failureInput: failureInput ?? { text: injection.failure_request.text },
    recoveryInputs: recoveryInputs ?? injection.recovery_requests.map(({ text }) => ({ text })) };
  const bindInput = (request, input) => {
    if (input.id !== undefined) request.author_id = input.id;
    if (input.sha256 !== undefined) request.author_sha256 = input.sha256;
  };
  bindInput(injection.failure_request, inputs.failureInput);
  injection.recovery_requests.forEach((request, index) => bindInput(request, inputs.recoveryInputs[index]));
  return { db, records, injection, appLog: [{ event: "agent_run.auto_maintenance.error", run_id: "failed-d", reason: ":checkpoint_persistence_failed" }],
    facts: { before, afterFailure, afterRecovery: clone(db), scope: { work_id: workId, session_id: sessionId }, ...inputs } };
}
