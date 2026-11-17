// B87 R03 原文 UI 编排。动作只由现役 AX 语义选择；DB/HTTP 仅在动作后对账。
// NativeScenarioHarness 是唯一动作 owner；历史/覆盖事实复用现役 reader，不造历史或产品 hook。
import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { axAuthorMessages } from "./authoring_g2_evidence.mjs";
import { readAutoMaintenanceDbFacts } from "./authoring_auto_maintenance_evidence.mjs";
import { canonicalMessagesFromRows } from "./authoring_history_evidence.mjs";
import { auditCanonicalCoverage } from "./authoring_checkpoint_coverage.mjs";
import { agentActivityCapture, resumeCapture, transcriptPageCapture } from "./native_http_evidence.mjs";
import { ensureWorkSelected, frameBody, frameEvent } from "./scenario_driver.mjs";
import { logs } from "./scenario_evidence.mjs";

const EXPAND = "查看已整理的较早创作过程";
const PANEL = "已整理的较早记录";
const OPEN = "查看完整记录";
const RETURN = "返回当前会话";
const COUNT_KEYS = ["tool_exchanges", "scope_updates", "discussion_messages"];
const sumCounts = (entries) => Object.fromEntries(COUNT_KEYS.map((key) =>
  [key, entries.reduce((sum, counts) => sum + counts[key], 0)]));
const values = (node) => [node?.title, node?.desc, node?.value].filter((value) => typeof value === "string");
const named = (node, name) => values(node).includes(name);
const button = (node, name) => node?.role === "AXButton" && named(node, name);
const textOf = (message) => message.blocks.map((block) => block.text ?? "").join("");
const object = (value) => typeof value === "string" ? JSON.parse(value) : value;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const insist = (condition, reason) => assert(condition, "compaction_history_ui:" + reason);

function visible(nodes, node, fully = false) {
  const frame = node?.frame;
  if (!Array.isArray(frame) || frame.length !== 4 || !frame.every(Number.isFinite) || frame[2] <= 0 || frame[3] <= 0) return false;
  const windows = nodes.filter((entry) => entry.role === "AXWindow" && Array.isArray(entry.frame));
  if (windows.length !== 1) return false;
  const clips = [windows[0], ...nodes.filter((entry) =>
    entry.role === "AXScrollArea" && String(node.path).startsWith(entry.path + "/") && Array.isArray(entry.frame))];
  return clips.every(({ frame: clip }) => clip.length === 4 && clip.every(Number.isFinite) && clip[2] > 0 && clip[3] > 0 &&
    (fully ? frame[0] >= clip[0] && frame[1] >= clip[1] &&
      frame[0] + frame[2] <= clip[0] + clip[2] && frame[1] + frame[3] <= clip[1] + clip[3] :
      frame[0] < clip[0] + clip[2] && frame[0] + frame[2] > clip[0] &&
      frame[1] < clip[1] + clip[3] && frame[1] + frame[3] > clip[1]));
}

function expandedPanel(nodes) {
  const panels = nodes.filter((node) => node.role !== "AXStaticText" && named(node, PANEL));
  insist(panels.length === 1, "expanded_region_missing_or_ambiguous");
  const panel = panels[0], contents = nodes.filter((node) => String(node.path).startsWith(panel.path + "/"));
  const links = contents.filter((node) => button(node, OPEN));
  insist(links.length === 1, "original_link_missing_or_ambiguous");
  return { panel, contents, link: links[0] };
}

function panelVisible(nodes, detail) {
  return [detail.panel, ...detail.contents.filter((node) => node.role === "AXStaticText" || button(node, OPEN))]
    .every((node) => visible(nodes, node, true));
}

async function showExpandedPanel(harness, authors, turns, source, label) {
  const found = await harness.pollAx((_text, nodes) => nodes.some((node) => button(node, OPEN)),
    15_000, label + "_expanded");
  const detail = expandedPanel(found.nodes);
  if (!panelVisible(found.nodes, detail))
    await harness.runStep("input", label + "_panel_scroll", () => harness.ensureInput().scrollTo(detail.panel.path));
  const shown = await harness.pollAx((_text, nodes) => {
    const current = noticeSource(nodes, authors, turns);
    return current?.turn.run_id === source.turn.run_id && panelVisible(nodes, expandedPanel(nodes));
  }, 15_000, label + "_panel_visible");
  return { source, ...expandedPanel(shown.nodes) };
}

function captureScene(harness, name) {
  const nodes = harness.capture(name, { allowFullScreenFallback: false });
  const facts = harness.captures.filter((capture) => capture.name === name);
  insist(facts.length === 1 && facts[0].screenshot?.ok === true, "screenshot_missing:" + name);
  return nodes;
}

function noticeSource(nodes, authors, turns) {
  // 首个已加载细条是作者可以沿消息流找到的最早入口，不读取 DB 来挑有利目标。
  const notice = nodes.find((node) => button(node, EXPAND));
  if (!notice) return null;
  const position = nodes.indexOf(notice);
  const owners = authors.flatMap((author) => axAuthorMessages(nodes, author.text).map((node) =>
    ({ author, node, position: nodes.indexOf(node) }))).filter((owner) => owner.position < position);
  owners.sort((left, right) => left.position - right.position);
  const owner = owners.at(-1);
  insist(owner, "notice_author_boundary_missing");
  const matches = turns.filter((turn) => turn.author_id === owner.author.id);
  insist(matches.length === 1 && matches[0].joined === true, "notice_turn_binding_missing");
  return { notice, author: owner.author, turn: matches[0] };
}

function eventRows(db, runId) {
  const events = db.agent_events.filter((event) =>
    event.run_id === runId && event.event_type === "checkpoint_created" && event.visibility === "author")
    .sort((left, right) => left.sequence - right.sequence);
  insist(events.length > 0 && events.every((event) => typeof event.id === "string" && event.id !== "" &&
    Number.isSafeInteger(event.sequence) && event.sequence > 0) && new Set(events.map((event) => event.id)).size === events.length &&
    new Set(events.map((event) => event.sequence)).size === events.length, "checkpoint_events_missing_or_duplicate");
  return events.map((event) => ({ id: event.id, sequence: event.sequence, payload: object(event.payload) }));
}

function bindFacts(db, config, turn, authors, turns, providerRecords) {
  const runs = db.agent_runs.filter((run) => run.id === turn.run_id);
  insist(runs.length === 1, "run_missing_or_duplicate");
  const run = runs[0];
  insist(run.work_id === config.work.id && run.session_id === config.session_id &&
    run.parent_turn_ref === turn.turn_id, "run_scope_mismatch");
  const messages = canonicalMessagesFromRows(db.authoring_session_messages, db.agent_runs)
    .filter((message) => message.canonical_ref.session_id === config.session_id);
  const audit = auditCanonicalCoverage(messages, {
    verifyExecutions: true, verifyRequests: true, providerRecords,
    providerRuns: db.provider_runs, providerOutputs: db.provider_outputs,
  });
  insist(audit.ok, audit.reason);
  const checkpoints = audit.checkpoints.filter((entry) => entry.canonical_ref.run_id === run.id)
    .sort((left, right) => left.canonical_ref.run_sequence - right.canonical_ref.run_sequence);
  const events = eventRows(db, run.id);
  insist(events.length === checkpoints.length, "event_checkpoint_cardinality");
  for (const [index, checkpoint] of checkpoints.entries()) {
    const prior = messages.slice(0, checkpoint.checkpoint_index);
    const selected = prior.filter((message) =>
      checkpoint.covers.message_refs.some((ref) => ref.run_id === message.canonical_ref.run_id &&
        ref.run_sequence === message.canonical_ref.run_sequence) ||
      message.blocks.some((block) => message.role === "assistant" && block.type === "tool_call" &&
        checkpoint.covers.call_ids.includes(block.call_id)));
    insist(selected.length > 0, "checkpoint_source_missing");
    const first = selected[0].canonical_ref;
    assert.deepEqual(events[index].payload.covered_counts, checkpoint.counts, "compaction_history_ui:event_counts_mismatch");
    assert.deepEqual(events[index].payload.history_target,
      { session_id: first.session_id, turn_id: first.parent_turn_ref }, "compaction_history_ui:event_target_mismatch");
  }
  const target = events[0].payload.history_target;
  const targetTurns = turns.filter((entry) => entry.turn_id === target.turn_id);
  insist(targetTurns.length === 1, "original_turn_not_in_registered_inputs");
  const targetAuthors = authors.filter((author) => author.id === targetTurns[0].author_id);
  insist(targetAuthors.length === 1 && sha(targetAuthors[0].text) === targetTurns[0].author_sha256,
    "original_author_hash_mismatch");
  const author = targetAuthors[0];
  const canonicalAuthors = messages.filter((message) => message.role === "user" && message.provenance === "author" &&
    message.canonical_ref.parent_turn_ref === target.turn_id && textOf(message) === author.text);
  insist(canonicalAuthors.length === 1, "canonical_author_bytes_mismatch");
  const interactions = db.interactions.filter((entry) =>
    entry.session_id === target.session_id && entry.turn_id === target.turn_id && entry.role === "user");
  insist(interactions.length === 1 && object(interactions[0].content)?.text === author.text,
    "interaction_author_bytes_mismatch");
  const counts = sumCounts(checkpoints.map((entry) => entry.counts));
  const rows = db.authoring_session_messages.filter((row) => row.session_id === config.session_id)
    .sort((left, right) => left.sequence - right.sequence);
  const discussions = messages.filter((message) => message.role === "assistant" &&
    message.canonical_ref.parent_turn_ref === target.turn_id && checkpoints.some((entry) =>
      entry.covers.message_refs.some((ref) => ref.role === "assistant" && ref.run_id === message.canonical_ref.run_id &&
        ref.run_sequence === message.canonical_ref.run_sequence)));
  return { run_id: run.id, parent_turn_ref: run.parent_turn_ref, target, counts, events,
    author, discussions, interaction_id: interactions[0].id, canonical_sha256: sha(JSON.stringify(rows)),
    checkpoint_refs: checkpoints.map((entry) => entry.canonical_ref) };
}

function pageFacts(capture, sessionId) {
  const body = capture.body;
  insist(typeof capture.record.request_id === "string" && capture.record.request_id !== "" &&
    /^[a-f0-9]{64}$/u.test(capture.record.body_state?.sha256), "page_producer_identity_missing");
  insist(Array.isArray(body.transcript) && body.transcript_page?.returned_count === body.transcript.length,
    "page_shape_invalid");
  const entries = body.transcript;
  insist(entries.every((entry) => typeof entry.id === "string" && entry.id !== "" &&
    entry.session_id === sessionId && typeof entry.turn_id === "string") &&
    new Set(entries.map((entry) => entry.id)).size === entries.length, "page_identity_invalid");
  return { request_id: capture.record.request_id, body_sha256: capture.record.body_state.sha256,
    page: body.transcript_page, interaction_ids: entries.map((entry) => entry.id),
    turn_ids: entries.map((entry) => entry.turn_id) };
}

async function awaitCapture(harness, parser, scope, start, label) {
  const capture = await harness.pollWire((records) => {
    const result = parser(records.slice(start), scope);
    return result.reason === "capture_missing" ? null : result;
  }, 30_000, label);
  insist(capture.ok, label + ":" + capture.reason);
  return capture;
}

function joinedScope(records, config) {
  const joined = records.filter((record) => record.direction === "received" &&
    frameEvent(record) === "phx_reply" && frameBody(record)?.status === "ok" &&
    frameBody(record)?.response?.joined === true && frameBody(record).response.work_id === config.work.id &&
    frameBody(record).response.session_id === config.session_id);
  const bound = joined.filter((reply) => records.some((sent) =>
    sent.direction === "sent" && frameEvent(sent) === "phx_join" &&
    frameBody(sent)?.work_id === config.work.id && frameBody(sent)?.session_id === config.session_id &&
    sent.at <= reply.at && sent.frame[1] === reply.frame[1] && sent.frame[2] === reply.frame[2]));
  insist(bound.length === 1, "new_join_missing_or_ambiguous");
  return { at: bound[0].at, ref: bound[0].frame[1], topic: bound[0].frame[2],
    work_id: config.work.id, session_id: config.session_id };
}

async function relaunch(harness, config, label) {
  const start = harness.transport().length;
  const from = harness.nowIso();
  await harness.runStep("restore", label + "_relaunch", () => harness.rawCloseAppAndRelaunch());
  await harness.runStep("maintenance", label + "_ready", () => harness.rawWaitWorkbenchSettled(label, 180_000));
  await ensureWorkSelected(harness, config.work.title, label);
  const captured = await awaitCapture(harness, resumeCapture, { workId: config.work.id, from }, start, label + "_resume");
  insist(captured.body.work?.id === config.work.id && captured.body.active_session?.id === config.session_id,
    "resume_scope_mismatch");
  await harness.pollAx((_text, nodes) => noticeSource(nodes, config.authors, config.turns) !== null,
    30_000, label + "_notice_restored");
  return { start, from, captured, page: pageFacts(captured, config.session_id),
    join: joinedScope(harness.transport().slice(start), config) };
}

async function expandNotice(harness, authors, turns, label) {
  const found = await harness.pollAx((_text, nodes) => noticeSource(nodes, authors, turns) !== null,
    30_000, label + "_notice");
  const source = noticeSource(found.nodes, authors, turns);
  if (!visible(found.nodes, source.notice)) {
    await harness.runStep("input", label + "_scroll", () => harness.ensureInput().scrollTo(source.notice.path));
  }
  const scrolled = await harness.pollAx((_text, nodes) => {
    const current = noticeSource(nodes, authors, turns);
    return current?.author.id === source.author.id && visible(nodes, current.notice);
  }, 15_000, label + "_notice_visible");
  await harness.runStep("input", label + "_expand", () =>
    harness.safeClick(noticeSource(scrolled.nodes, authors, turns).notice, label + "_expand"));
  return showExpandedPanel(harness, authors, turns, source, label);
}

function assertCounts(contents, counts) {
  const count = (key) => counts[key].toLocaleString("zh-CN");
  const parts = [
    counts.tool_exchanges > 0 ? "已完成操作 " + count("tool_exchanges") + " 项" : null,
    counts.scope_updates > 0 ? "工作范围记录 " + count("scope_updates") + " 条" : null,
    counts.discussion_messages > 0 ? "讨论回复 " + count("discussion_messages") + " 条" : null,
  ].filter(Boolean);
  const expected = "为了保持这次创作始终清晰连贯，系统整理了较早的记录：" + parts.join("、") + "。";
  insist(contents.some((node) => named(node, expected)), "visible_category_counts_mismatch");
  insist(contents.some((node) => named(node, "原始记录仍然保留，不会被删除或改写。")), "original_retention_copy_missing");
}

async function activityEvidence(harness, config, binding, window) {
  const captured = await awaitCapture(harness, agentActivityCapture, { workId: config.work.id,
    sessionId: config.session_id, turnId: binding.parent_turn_ref, from: window.from },
  window.start, "restored_activity");
  const runs = captured.body.agent_runs.filter((run) => run.run_id === binding.run_id);
  insist(runs.length === 1 && runs[0].parent_turn_ref === binding.parent_turn_ref && Array.isArray(runs[0].events),
    "activity_run_mismatch");
  const events = runs[0].events.filter((event) => event.event_type === "checkpoint_created" && event.visibility === "author");
  insist(events.every((event) => event.run_ref === binding.run_id && event.work_id === config.work.id &&
    event.session_id === config.session_id), "activity_event_scope_mismatch");
  const projected = events.map((event) => ({ id: event.event_id, sequence: event.sequence, payload: event.payload }))
    .sort((left, right) => left.sequence - right.sequence);
  assert.deepEqual(projected, binding.events, "compaction_history_ui:restored_event_set_mismatch");
  return { captures: captured.records.map((record) => ({ request_id: record.request_id, body_sha256: record.body_state.sha256 })),
    event_ids: projected.map((event) => event.id),
    covered_counts: sumCounts(projected.map((event) => event.payload.covered_counts)) };
}

// 只验证已采集报告的结构与交叉身份；原始 HTTP/AX/截图仍由外部 evidence/视觉复核负责。
export function verifyCompactionHistoryReport(report, { required, requireOutsideInitialPage = false } = {}) {
  if (required !== true) return { ok: true, required: false, status: "not_requested" };
  const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
  const nonBlank = (value) => typeof value === "string" && value.trim() !== "";
  const same = (left, right, reason) => assert.deepEqual(left, right, "compaction_history_ui:" + reason);
  try {
    insist(report?.required === true && report.ok === true &&
      report.status === "mechanical_pass_visual_review_required", "report_not_complete");
    insist(report.require_outside_initial_page === requireOutsideInitialPage, "paging_requirement_mismatch");
    insist(report.recovery_scope === "owned_tauri_client", "recovery_scope_unproven");
    insist(report.highlight_style?.status === "visual_review_required" &&
      report.duplicate_delivery?.status === "not_exercised", "unobserved_claim");
    const source = report.source;
    insist(nonBlank(source?.run_id) && nonBlank(source?.parent_turn_ref) &&
      nonBlank(source?.history_target?.session_id) && nonBlank(source?.history_target?.turn_id) &&
      nonBlank(source?.original_interaction_id) && hash(source?.original_author_sha256) &&
      hash(source?.canonical_sha256), "source_identity_missing");
    insist(Array.isArray(source.event_ids) && source.event_ids.length > 0 &&
      source.event_ids.every(nonBlank) && new Set(source.event_ids).size === source.event_ids.length,
      "source_event_ids_invalid");
    same(Object.keys(source.covered_counts ?? {}).sort(), [...COUNT_KEYS].sort(), "source_count_keys");
    insist(COUNT_KEYS.every((key) => Number.isSafeInteger(source.covered_counts[key]) && source.covered_counts[key] >= 0) &&
      COUNT_KEYS.reduce((total, key) => total + source.covered_counts[key], 0) > 0, "source_counts_invalid");
    const pages = [report.initial_page, report.located_page, report.returned_page, report.restored_page];
    for (const page of pages) {
      insist(nonBlank(page?.request_id) && hash(page?.body_sha256) && Array.isArray(page?.interaction_ids) &&
        Array.isArray(page?.turn_ids) && page.interaction_ids.length === page.turn_ids.length &&
        page.interaction_ids.every(nonBlank) && page.turn_ids.every(nonBlank) &&
        new Set(page.interaction_ids).size === page.interaction_ids.length &&
        page.page?.returned_count === page.interaction_ids.length &&
        Number.isSafeInteger(page.page?.limit) && page.page.limit > 0, "page_report_invalid");
    }
    insist(new Set(pages.map((page) => page.request_id)).size === pages.length, "page_request_reused");
    same(report.initial_page.interaction_ids, report.returned_page.interaction_ids, "return_page_mismatch");
    same(report.initial_page.interaction_ids, report.restored_page.interaction_ids, "restored_page_mismatch");
    insist(report.located_page.page.around_turn_id === source.history_target.turn_id &&
      report.located_page.interaction_ids.includes(source.original_interaction_id) &&
      report.located_page.turn_ids.includes(source.history_target.turn_id), "original_page_target_missing");
    const outside = !report.initial_page.turn_ids.includes(source.history_target.turn_id);
    insist(report.outside_initial_page === outside && (!requireOutsideInitialPage || outside), "cross_page_not_observed");
    const joins = [report.initial_join, report.restored_join];
    insist(joins.every((join) => nonBlank(join?.ref) && nonBlank(join?.topic) && nonBlank(join?.work_id) &&
      join.session_id === source.history_target.session_id && Number.isFinite(Date.parse(join.at))) &&
      joins[0].work_id === joins[1].work_id && joins[0].topic === joins[1].topic &&
      Date.parse(joins[1].at) > Date.parse(joins[0].at), "join_identity_invalid");
    insist(Array.isArray(source.checkpoint_refs) && source.checkpoint_refs.length === source.event_ids.length &&
      source.checkpoint_refs.every((ref) => ref.run_id === source.run_id && ref.work_id === joins[0].work_id &&
        ref.session_id === source.history_target.session_id && ref.parent_turn_ref === source.parent_turn_ref &&
        Number.isSafeInteger(ref.run_sequence) && ref.run_sequence > 0) &&
      new Set(source.checkpoint_refs.map((ref) => ref.run_sequence)).size === source.checkpoint_refs.length,
      "checkpoint_refs_invalid");
    const activities = [report.initial_activity, report.restored_activity];
    const activityRequests = [];
    for (const activity of activities) {
      insist(Array.isArray(activity?.captures) && activity.captures.length > 0 &&
        activity.captures.every((capture) => nonBlank(capture.request_id) && hash(capture.body_sha256)),
        "activity_capture_missing");
      activityRequests.push(...activity.captures.map((capture) => capture.request_id));
      same(activity.event_ids, source.event_ids, "activity_event_set_mismatch");
      same(activity.covered_counts, source.covered_counts, "activity_counts_mismatch");
    }
    insist(new Set(activityRequests).size === activityRequests.length, "activity_request_reused");
    insist(report.original_visible?.author_sha256 === source.original_author_sha256 &&
      nonBlank(report.original_visible?.path) && Array.isArray(report.original_visible?.frame) &&
      report.original_visible.frame.length === 4 && report.original_visible.frame.every(Number.isFinite) &&
      report.original_visible.frame[2] > 0 && report.original_visible.frame[3] > 0, "original_ax_missing");
    insist(Array.isArray(report.located_discussion_sources) && report.located_discussion_sources.every((entry) =>
      entry.canonical_ref?.work_id === joins[0].work_id &&
      entry.canonical_ref?.session_id === source.history_target.session_id &&
      entry.canonical_ref?.parent_turn_ref === source.history_target.turn_id &&
      report.located_page.interaction_ids.includes(entry.interaction_id) && hash(entry.text_sha256)),
      "original_discussion_binding_invalid");
    insist(Array.isArray(report.captures) && report.captures.length === 6 &&
      new Set(report.captures).size === 6 && report.captures.includes("history-original-located.jpg"),
      "ui_captures_missing");
    for (const key of ["category_counts", "original_navigation", "return_current",
      "client_restart_event_set_and_counts_stable", "same_session_rejoined", "cross_page_requirement"]) {
      insist(report.checks?.[key] === true, "step_not_proven:" + key);
    }
    return { ok: true, required: true, status: report.status, visual_review_required: true,
      outside_initial_page: outside, duplicate_delivery: report.duplicate_delivery.status };
  } catch (error) {
    return { ok: false, required: true, reason: error.message, visual_review_required: true };
  }
}

export async function runCompactionHistorySequence({
  harness, config, authors, turns, readFacts = readAutoMaintenanceDbFacts,
  readProviderRecords = (dir) => logs(path.join(dir, "llm-calls")),
}) {
  const gate = config.compaction_history_check;
  if (gate?.required !== true) return { required: false, status: "not_requested" };
  const report = { required: true, ok: false, status: "running", checks: {}, captures: [],
    recovery_scope: "owned_tauri_client",
    require_outside_initial_page: gate.require_outside_initial_page === true,
    duplicate_delivery: { status: "not_exercised", reason: "No duplicate event was injected; component tests cover repeated input." },
    highlight_style: { status: "visual_review_required" } };
  const save = () => harness.writeJson("compaction-history-ui.json", report);
  const scene = (label) => { const nodes = captureScene(harness, label); report.captures.push(label + ".jpg"); save(); return nodes; };
  save();
  try {
    scene("history-before-refresh");
    const before = readFacts(harness.dir);
    const active = { ...config, authors, turns };
    const initial = await relaunch(harness, active, "history-initial");
    report.initial_page = initial.page;
    report.initial_join = initial.join;
    scene("history-initial-page");
    let expanded = await expandNotice(harness, authors, turns, "history-source");
    // 此时才将作者可见细条对应到实际 run/checkpoint，不从数据库挑入口。
    const binding = bindFacts(before, config, expanded.source.turn, authors, turns, readProviderRecords(harness.dir));
    report.source = { run_id: binding.run_id, parent_turn_ref: binding.parent_turn_ref,
      history_target: binding.target, covered_counts: binding.counts, event_ids: binding.events.map((event) => event.id),
      checkpoint_refs: binding.checkpoint_refs, original_author_sha256: sha(binding.author.text),
      original_interaction_id: binding.interaction_id, canonical_sha256: binding.canonical_sha256 };
    assertCounts(expanded.contents, binding.counts);
    report.initial_activity = await activityEvidence(harness, config, binding, initial);
    report.checks.category_counts = true;
    report.outside_initial_page = !initial.page.turn_ids.includes(binding.target.turn_id);
    expanded = await showExpandedPanel(harness, authors, turns, expanded.source, "history-source-capture");
    const expandedNodes = scene("history-expanded-source");
    insist(panelVisible(expandedNodes, expandedPanel(expandedNodes)), "panel_not_visible_at_capture");
    assertCounts(expandedPanel(expandedNodes).contents, binding.counts);
    const start = harness.transport().length;
    const from = harness.nowIso();
    await harness.runStep("input", "history_open_original", () => harness.safeClick(expanded.link, "history_open_original"));
    const located = await awaitCapture(harness, transcriptPageCapture, { workId: config.work.id,
      sessionId: binding.target.session_id, turnId: binding.target.turn_id, from }, start, "original_page");
    report.located_page = pageFacts(located, binding.target.session_id);
    const original = located.body.transcript.filter((entry) => entry.id === binding.interaction_id);
    insist(original.length === 1 && original[0].role === "user" &&
      original[0].turn_id === binding.target.turn_id && original[0].text === binding.author.text, "original_page_bytes_mismatch");
    report.located_discussion_sources = binding.discussions.map((message) => {
      const entries = located.body.transcript.filter((entry) => entry.role === "assistant" &&
        entry.agent_run_id === message.canonical_ref.run_id && entry.text === textOf(message));
      insist(entries.length === 1, "original_discussion_bytes_missing");
      return { canonical_ref: message.canonical_ref, interaction_id: entries[0].id, text_sha256: sha(entries[0].text) };
    });
    await harness.pollAx((_text, nodes) => nodes.some((node) => button(node, RETURN)) &&
      axAuthorMessages(nodes, binding.author.text).some((node) => visible(nodes, node)), 30_000, "original_visible");
    const locatedNodes = scene("history-original-located");
    const authorNodes = axAuthorMessages(locatedNodes, binding.author.text).filter((node) => visible(locatedNodes, node));
    insist(authorNodes.length === 1, "original_author_not_unique_in_viewport");
    report.original_visible = { path: authorNodes[0].path, frame: authorNodes[0].frame,
      author_sha256: sha(binding.author.text) };
    report.checks.original_navigation = true;
    const returnStart = harness.transport().length;
    const returnFrom = harness.nowIso();
    const returns = locatedNodes.filter((node) => button(node, RETURN));
    insist(returns.length === 1, "return_link_missing_or_ambiguous");
    await harness.runStep("input", "history_return_current", () => harness.safeClick(returns[0], "history_return_current"));
    const returned = await awaitCapture(harness, resumeCapture, { workId: config.work.id, from: returnFrom },
      returnStart, "return_current");
    insist(returned.body.work?.id === config.work.id && returned.body.active_session?.id === config.session_id,
      "return_session_mismatch");
    report.returned_page = pageFacts(returned, config.session_id);
    assert.deepEqual(report.returned_page.interaction_ids, initial.page.interaction_ids, "compaction_history_ui:return_page_changed");
    await harness.pollAx((_text, nodes) => !nodes.some((node) => button(node, RETURN)) &&
      axAuthorMessages(nodes, authors.at(-1).text).length === 1, 30_000, "current_view_restored");
    scene("history-returned-current");
    report.checks.return_current = true;
    const restored = await relaunch(harness, active, "history-restored");
    report.restored_page = restored.page;
    report.restored_join = restored.join;
    assert.deepEqual(restored.page.interaction_ids, initial.page.interaction_ids, "compaction_history_ui:restored_page_changed");
    const restoredExpanded = await expandNotice(harness, authors, turns, "history-restored-source");
    insist(restoredExpanded.source.turn.run_id === binding.run_id, "restored_notice_source_changed");
    const after = bindFacts(readFacts(harness.dir), config, restoredExpanded.source.turn, authors, turns,
      readProviderRecords(harness.dir));
    assert.deepEqual(after.events, binding.events, "compaction_history_ui:persisted_events_changed");
    assert.equal(after.canonical_sha256, binding.canonical_sha256, "compaction_history_ui:original_canonical_changed");
    assertCounts(restoredExpanded.contents, binding.counts);
    report.restored_activity = await activityEvidence(harness, config, binding, restored);
    await showExpandedPanel(harness, authors, turns, restoredExpanded.source, "history-restored-capture");
    const restoredNodes = scene("history-restored-expanded");
    insist(panelVisible(restoredNodes, expandedPanel(restoredNodes)), "panel_not_visible_at_capture");
    assertCounts(expandedPanel(restoredNodes).contents, binding.counts);
    report.checks.client_restart_event_set_and_counts_stable = true;
    report.checks.same_session_rejoined = true;
    report.checks.cross_page_requirement = !report.require_outside_initial_page || report.outside_initial_page;
    insist(!report.require_outside_initial_page || report.outside_initial_page, "cross_page_not_observed");
    report.ok = true;
    report.status = "mechanical_pass_visual_review_required";
    const verified = verifyCompactionHistoryReport(report, { required: true,
      requireOutsideInitialPage: report.require_outside_initial_page });
    insist(verified.ok, verified.reason);
    save();
    return report;
  } catch (error) {
    report.ok = false;
    report.status = "failed";
    report.error = error.message;
    save();
    throw error;
  }
}
