// 外部 UI 编排单测：使用独立原始 canonical/Interaction/HTTP/AX 事实，不启动应用或伪造实测结果。
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { runCompactionHistorySequence, verifyCompactionHistoryReport } from "./request_cost_history_drive.mjs";

const WORK = "work-r03";
const SESSION = "session-r03";
const WORKSPACE = "workspace-r03";
const EXPAND = "查看已整理的较早创作过程";
const OPEN = "查看完整记录";
const RETURN = "返回当前会话";
const sha = (text) => createHash("sha256").update(text).digest("hex");

function fixture({ discussion = true, outside = true, requiredOutside = true } = {}) {
  const authors = Array.from({ length: 20 }, (_, index) => {
    const text = index === 0 ? "  比较两种视角，Ω é 雪；保留风险表。  " : "继续讨论第 " + (index + 1) + " 项。";
    return { id: "author-" + (index + 1), text, sha256: sha(text) };
  });
  const turns = authors.map((author, index) => ({ index: index + 1, author_id: author.id,
    author_sha256: author.sha256, turn_id: "turn-" + (index + 1), run_id: "run-" + (index + 1), joined: true }));
  const runs = turns.map((turn) => ({ id: turn.run_id, workspace_id: WORKSPACE, work_id: WORK,
    session_id: SESSION, parent_turn_ref: turn.turn_id, status: "completed" }));
  const rows = [], interactions = [];
  const counts = { tool_exchanges: 0, scope_updates: 1, discussion_messages: discussion ? 1 : 0 };
  const raw = JSON.stringify({ version: "authoring-discussion-summary/v1",
    entries: [{ source_index: 0, summary: "早期方案比较，风险表尚未完成。", retained_obligations: ["仍欠风险表。"] }] });
  const refs = [{ run_id: "run-1", run_sequence: 2, role: "scope_update", source_refs: [], versions: { scope_revision: 1 } }];
  if (discussion) refs.push({ run_id: "run-1", run_sequence: 3, role: "assistant", source_refs: [], versions: {} });
  const checkpoint = { role: "checkpoint", provenance: "application", blocks: [{ type: "checkpoint",
    covers: { call_ids: [], message_refs: refs, turn_range: "不能从这个说明推断 turn" },
    source_refs: refs.map((ref) => ({ ref: "session_message:" + ref.run_id + ":" + ref.run_sequence, version: 1 })),
    versions: {}, omissions: ["旧范围与讨论的重复展开已省略；原文仍保留。"],
    ...(discussion ? { discussion: { response_text: raw, response_sha256: sha(raw),
      provider_run_ref: "provider-summary", provider_call_ref: "call-summary" } } : {}),
  }], source_refs: [], versions: {} };
  for (const [index, turn] of turns.entries()) {
    let runSequence = 0;
    const add = (message) => rows.push({ sequence: rows.length + 1, run_sequence: ++runSequence,
      run_id: turn.run_id, session_id: SESSION, workspace_id: WORKSPACE, work_id: WORK,
      format_version: "authoring-session-message/v1", role: message.role, message: JSON.stringify(message) });
    add({ role: "user", provenance: "author", blocks: [{ type: "text", text: authors[index].text }], source_refs: [{ ref: turn.turn_id }], versions: {} });
    if (index === 0 || index === 19) add({ role: "scope_update", provenance: "application",
      blocks: [{ type: "scope", content: { source: index === 0 ? "原范围" : "当前范围" } }],
      source_refs: [], versions: { scope_revision: index === 0 ? 1 : 20 } });
    if (index === 19) add(checkpoint);
    const reply = index === 0 ? "早期方案比较，仍欠风险表。" : "第 " + (index + 1) + " 项回复。";
    add({ role: "assistant", provenance: "model", blocks: [{ type: "text", text: reply }], source_refs: [], versions: {} });
    interactions.push(
      { id: "user-" + (index + 1), session_id: SESSION, turn_id: turn.turn_id, role: "user",
        content: JSON.stringify({ text: authors[index].text }) },
      { id: "assistant-" + (index + 1), session_id: SESSION, turn_id: turn.turn_id, role: "assistant",
        content: JSON.stringify({ text: reply, agent_run_id: turn.run_id }) },
    );
  }
  const payload = { covered_counts: counts, history_target: { session_id: SESSION, turn_id: "turn-1" }, sources: [] };
  const event = { id: "event-checkpoint", run_id: "run-20", sequence: 5,
    event_type: "checkpoint_created", visibility: "author", payload: JSON.stringify(payload) };
  const db = { agent_runs: runs, authoring_session_messages: rows, interactions, agent_events: [event],
    provider_runs: discussion ? [{ id: "provider-summary", provider_call_ref: "call-summary", agent_run_id: "run-20",
      parent_turn_ref: "turn-20", workspace_id: WORKSPACE, work_id: WORK, session_id: SESSION,
      purpose: "other", status: "completed", owner_refs: { operation: "transcript_compaction" } }] : [],
    provider_outputs: discussion ? [{ provider_run_id: "provider-summary", provider_call_ref: "call-summary",
      agent_run_id: "run-20", status: "ok", content_summary: { content_sha256: sha(raw) } }] : [] };
  const entry = (row) => ({ id: row.id, session_id: row.session_id, turn_id: row.turn_id, role: row.role,
    ...JSON.parse(row.content) });
  const latest = interactions.slice(-30).map(entry);
  if (!outside) latest[0] = entry(interactions[0]);
  const page = (entries, target = null) => ({ work_id: WORK, session: { id: SESSION },
    transcript: entries, transcript_page: { limit: 30, returned_count: entries.length,
      has_more_before: target === null, has_more_after: target !== null, around_turn_id: target,
      before_id: entries[0]?.id, after_id: entries.at(-1)?.id } });
  const initial = { ...page(latest), work: { id: WORK }, active_session: { id: SESSION } };
  const located = page(interactions.slice(0, 16).map(entry), "turn-1");
  const activity = { work_id: WORK, session_id: SESSION, turn_id: "turn-20",
    agent_runs: [{ run_id: "run-20", parent_turn_ref: "turn-20", events: [{
      event_id: event.id, run_ref: event.run_id, run_id: event.run_id, sequence: event.sequence,
      work_id: WORK, session_id: SESSION, event_type: event.event_type, visibility: event.visibility, payload,
    }] }] };
  const config = { work: { id: WORK, title: "原文回查作品" }, session_id: SESSION, length: 20,
    compaction_history_check: { required: true, require_outside_initial_page: requiredOutside } };
  const providerRecords = discussion ? [{ provider_run_ref: "provider-summary", provider_call_ref: "call-summary",
    request: { body: { tools: [], messages: [
      { role: "system", content: "output_protocol_version: authoring-discussion-summary/v1" },
      { role: "user", content: "【应用数据 · application_base】\n" + JSON.stringify({
      material_kind: "quoted_discussion_sources", sources: [{ source_index: 0,
        source: { run_id: "run-1", run_sequence: 3 }, text: "早期方案比较，仍欠风险表。", author_text: authors[0].text }],
    }) }] } } }] : [];
  return { authors, turns, db, counts, config, initial, located, activity, providerRecords };
}

function fakeHarness(spec, options = {}) {
  const wire = [], saved = new Map(), actions = [];
  let ticks = 0, request = 0, restarts = 0, expanded = false, history = false, activeStep = null, noticeScrolled = false;
  const now = () => new Date(Date.UTC(2026, 10, 15) + ++ticks).toISOString();
  const emitHttp = (path, scope, body, overrides = {}) => wire.push({ at: now(), direction: "http", method: "GET",
    path, request_id: "http-" + ++request, status: 200, scope,
    body_state: { complete: true, json: "valid", truncated: false, sha256: sha(JSON.stringify(body)) }, body, ...overrides });
  const resume = () => emitHttp(`/api/works/${WORK}/sessions/resume`,
    { kind: "resume", work_id: WORK, session_id: null, turn_id: null }, spec.initial);
  const node = (path, role, value = "", frame = [40, 150, 700, 30]) => ({ path, role, value, frame });
  const nodes = () => {
    const text = history ? spec.authors[0].text : spec.authors.at(-1).text;
    const list = [node("0", "AXWindow", "", [0, 0, 1000, 900]),
      node("0/0", "AXWebArea", "", [0, 0, 1000, 900]),
      ...(options.regionMissing ? [] : [{
        ...node("0/0/10", "AXGroup", "", [0, 100, 1000, 700]),
        title: options.wrongRegion ? "另一片区域" : "会话消息",
        desc: "会话消息", subrole: "AXLandmarkRegion",
      }]),
      node("0/0/10/0", "AXGroup"), node("0/0/10/0/0", "AXStaticText", "你"),
      node("0/0/10/1", "AXGroup"), node("0/0/10/1/0", "AXStaticText", text,
        options.originalOffscreen && history ? [40, 1200, 700, 30] :
          options.originalBehindRegion && history ? [40, 820, 700, 30] : [40, 150, 700, 30])];
    if (history) return [...list, node("0/1", "AXButton", RETURN, [40, 40, 200, 30])];
    list.push(node("0/0/10/2", "AXButton", EXPAND,
      options.noticeNeedsScroll && !noticeScrolled ? [40, 1200, 700, 30] : [40, 250, 700, 30]));
    if (expanded) {
      const reason = options.wrongVisibleCount ? "错误计数" : "为了保持这次创作始终清晰连贯，系统整理了较早的记录：" +
        "工作范围记录 1 条" + (spec.counts.discussion_messages ? "、讨论回复 1 条" : "") + "。";
      const panelPath = options.panelOutsideConversation ? "0/2" : "0/0/10/3";
      const panelFrame = options.panelBehindRegion ? [40, 780, 700, 60] :
        options.panelOutsideConversation ? [40, 40, 700, 30] : [40, 150, 700, 30];
      list.push(node(panelPath, "AXGroup", "已整理的较早记录", panelFrame),
        node(panelPath + "/0", "AXStaticText", reason, panelFrame),
        node(panelPath + "/1", "AXStaticText", "原始记录仍然保留，不会被删除或改写。", panelFrame),
        node(panelPath + "/2", "AXButton", OPEN, panelFrame));
    }
    return list;
  };
  const harness = {
    dir: "/unit-test-only",
    captures: [],
    nowIso: now,
    transport: () => wire,
    writeJson: (name, value) => saved.set(name, structuredClone(value)),
    async runStep(kind, label, run) {
      assert.equal(activeStep, null, "步骤不可嵌套");
      activeStep = label;
      actions.push({ kind, label });
      try { return await run(); } finally { activeStep = null; }
    },
    async rawCloseAppAndRelaunch() {
      restarts += 1; expanded = false; history = false; noticeScrolled = false;
      const ref = "join-" + restarts;
      wire.push({ at: now(), direction: "sent", frame: [null, ref, "workspace:r03", "phx_join",
        { work_id: WORK, session_id: SESSION }] });
      wire.push({ at: now(), direction: "received", frame: [null, ref, "workspace:r03", "phx_reply",
        { status: "ok", response: { joined: true, work_id: WORK,
          session_id: options.wrongJoin ? "other" : SESSION } }] });
      resume();
      const activity = structuredClone(spec.activity);
      if (options.duplicateRestoredEvent && restarts === 2) activity.agent_runs[0].events.push(activity.agent_runs[0].events[0]);
      if (options.wrongActivityScope) activity.agent_runs[0].events[0].session_id = "other";
      emitHttp(`/api/works/${WORK}/sessions/${SESSION}/turns/turn-20/agent-run-activity`,
        { kind: "agent_activity", work_id: WORK, session_id: SESSION, turn_id: "turn-20" }, activity);
    },
    rawWaitWorkbenchSettled: async () => {},
    rawTrySelectWork: async () => true,
    ensureInput: () => ({ scrollTo: (path) => { assert(nodes().some((entry) => entry.path === path)); noticeScrolled = true; actions.push({ scroll: path }); } }),
    async pollAx(predicate, _timeout, label) {
      const current = nodes();
      if (!predicate(current.map((entry) => entry.value).join("\n"), current)) throw new Error("wait_ax_timeout:" + label);
      return { nodes: current, text: current.map((entry) => entry.value).join("\n") };
    },
    async pollWire(predicate, _timeout, label) {
      const found = predicate(wire);
      if (!found) throw new Error("wait_wire_timeout:" + label);
      return found;
    },
    safeClick(target) {
      assert(nodes().some((entry) => entry.path === target.path && entry.value === target.value), "只能点当前真实语义节点");
      actions.push({ click: target.value });
      if (target.value === EXPAND) expanded = true;
      else if (target.value === OPEN) {
        history = true;
        emitHttp(`/api/works/${WORK}/sessions/${SESSION}/transcript?around_turn_id=${options.wrongQuery ? "other" : "turn-1"}`,
          { kind: "transcript_page", work_id: WORK, session_id: SESSION, turn_id: "turn-1" },
          spec.located, options.truncatedOriginal ? { body_state: { complete: false, json: "too_large", truncated: true } } : {});
      } else if (target.value === RETURN) { history = false; expanded = false; resume(); }
      else assert.fail("未声明的 UI 动作");
    },
    capture(name) {
      this.captures.push({ name, screenshot: { ok: !options.missingScreenshot } });
      return nodes();
    },
  };
  let reads = 0;
  const readFacts = () => {
    const db = structuredClone(spec.db);
    reads += 1;
    if (options.changedOriginal && reads === 2) db.authoring_session_messages[0].message = db.authoring_session_messages[0].message.replace("比较", "篡改");
    return db;
  };
  const readProviderRecords = () => {
    const records = structuredClone(spec.providerRecords);
    if (options.wrongSummarySource) {
      const material = records[0].request.body.messages.find((message) =>
        message.role === "user" && message.content.startsWith("【应用数据 · application_base】\n"));
      material.content = material.content.replace("仍欠", "已完成");
    }
    return records;
  };
  return { harness, readFacts, readProviderRecords, saved, actions, wire, restarts: () => restarts };
}

async function execute(spec, options = {}) {
  const fake = fakeHarness(spec, options);
  const result = await runCompactionHistorySequence({ harness: fake.harness, config: spec.config,
    authors: spec.authors, turns: spec.turns, readFacts: fake.readFacts, readProviderRecords: fake.readProviderRecords });
  return { result, ...fake };
}

test("未预注册的3轮场景不启动 UI 历史步骤", async () => {
  assert.deepEqual(await runCompactionHistorySequence({ harness: {}, config: { compaction_history_check: { required: false } } }),
    { required: false, status: "not_requested" });
});

test("零工具的范围/讨论细条走真实原文语义、跨页、返回与同一事件恢复", async () => {
  const { result, actions, restarts } = await execute(fixture());
  assert.equal(result.status, "mechanical_pass_visual_review_required");
  assert.equal(result.outside_initial_page, true);
  assert.deepEqual(result.source.covered_counts, { tool_exchanges: 0, scope_updates: 1, discussion_messages: 1 });
  assert.deepEqual(result.initial_activity.event_ids, ["event-checkpoint"]);
  assert.deepEqual(result.restored_activity.event_ids, ["event-checkpoint"]);
  assert.deepEqual(result.located_discussion_sources.map((source) => source.interaction_id), ["assistant-1"]);
  assert.equal(result.original_visible.author_sha256, sha(fixture().authors[0].text));
  assert.equal(result.highlight_style.status, "visual_review_required");
  assert.equal(result.duplicate_delivery.status, "not_exercised", "恢复稳定不能代签未注入的重复交付");
  assert.equal(restarts(), 2);
  assert.deepEqual(actions.filter((action) => action.click).map((action) => action.click), [EXPAND, OPEN, RETURN, EXPAND]);
  assert.equal(result.captures.length, 6);
});

test("只有旧范围也可显现；10轮不把目标仍在初始页误报为跨页", async () => {
  const { result } = await execute(fixture({ discussion: false, outside: false, requiredOutside: false }));
  assert.equal(result.status, "mechanical_pass_visual_review_required");
  assert.equal(result.outside_initial_page, false);
  assert.deepEqual(result.source.covered_counts, { tool_exchanges: 0, scope_updates: 1, discussion_messages: 0 });
  assert.deepEqual(result.located_discussion_sources, []);
});

for (const [name, options, pattern] of [
  ["错误 query 不能借 scope/body 冒充原文", { wrongQuery: true }, /original_page/],
  ["截断原文回包", { truncatedOriginal: true }, /capture_incomplete/],
  ["原文只存在AX树但未进入视野", { originalOffscreen: true }, /original_visible/],
  ["显示类别计数不符", { wrongVisibleCount: true }, /visible_category_counts_mismatch/],
  ["恢复事件重复", { duplicateRestoredEvent: true }, /restored_event_set_mismatch/],
  ["恢复事件跨会话", { wrongActivityScope: true }, /activity_event_scope_mismatch/],
  ["错会话join", { wrongJoin: true }, /new_join_missing_or_ambiguous/],
  ["截图失败", { missingScreenshot: true }, /screenshot_missing/],
  ["原始作者行被改写", { changedOriginal: true }, /canonical_author_bytes_mismatch/],
  ["摘要请求错原始来源", { wrongSummarySource: true }, /discussion_request_sources_not_canonical_originals/],
]) {
  test(name + "失败并保留独立失败报告", async () => {
    const spec = fixture({ discussion: !options.changedOriginal }), fake = fakeHarness(spec, options);
    await assert.rejects(runCompactionHistorySequence({ harness: fake.harness, config: spec.config,
      authors: spec.authors, turns: spec.turns, readFacts: fake.readFacts, readProviderRecords: fake.readProviderRecords }), pattern);
    assert.equal(fake.saved.get("compaction-history-ui.json").status, "failed");
  });
}

test("展开面板仅在AX存在但被视口裁切时，不得签完整可见", async () => {
  const spec = fixture(), fake = fakeHarness(spec);
  const poll = fake.harness.pollAx.bind(fake.harness);
  fake.harness.pollAx = (predicate, timeout, label) => poll((_text, current) => {
    const shifted = current.map((node) => node.path.startsWith("0/0/10/3")
      ? { ...node, frame: [40, 790, 700, 90] } : node);
    return predicate(shifted.map((node) => node.value).join("\n"), shifted);
  }, timeout, label);
  fake.harness.ensureInput = () => ({ scrollTo: () => { fake.actions.push({ scroll: "panel" }); } });
  await assert.rejects(runCompactionHistorySequence({ harness: fake.harness, config: spec.config,
    authors: spec.authors, turns: spec.turns, readFacts: fake.readFacts,
    readProviderRecords: fake.readProviderRecords }), /panel_visible/);
});

test("顶层窗口可见不能替代会话区域：面板与原作者都服从实际区域裁切", async () => {
  for (const [options, reason] of [
    [{ panelBehindRegion: true }, /panel_visible/],
    [{ originalBehindRegion: true }, /original_visible/],
    [{ regionMissing: true }, /notice_restored/],
    [{ wrongRegion: true }, /notice_restored/],
  ]) await assert.rejects(execute(fixture(), options), reason);
});

test("会话外面板保留窗口裁切用途，不伪造其会话祖先", async () => {
  const value = await execute(fixture(), { panelOutsideConversation: true });
  assert.equal(value.result.status, "mechanical_pass_visual_review_required");
  assert.equal(value.result.checks.original_navigation, true);
});

test("截图前面板已移出视口时，不借之前AX的成功放行", async () => {
  const spec = fixture(), fake = fakeHarness(spec);
  const capture = fake.harness.capture.bind(fake.harness);
  fake.harness.capture = (name) => capture(name).map((node) =>
    name.endsWith("expanded") || name === "history-expanded-source"
      ? node.path.startsWith("0/0/10/3") ? { ...node, frame: [40, 1200, 700, 90] } : node
      : node);
  await assert.rejects(runCompactionHistorySequence({ harness: fake.harness, config: spec.config,
    authors: spec.authors, turns: spec.turns, readFacts: fake.readFacts,
    readProviderRecords: fake.readProviderRecords }), /panel_not_visible_at_capture/);
});

test("20轮目标实际仍在初始页时保留原文成功子证据但不签跨页", async () => {
  const spec = fixture({ outside: false }), fake = fakeHarness(spec);
  await assert.rejects(runCompactionHistorySequence({ harness: fake.harness, config: spec.config,
    authors: spec.authors, turns: spec.turns, readFacts: fake.readFacts, readProviderRecords: fake.readProviderRecords }), /cross_page_not_observed/);
  const report = fake.saved.get("compaction-history-ui.json");
  assert.equal(report.checks.original_navigation, true);
  assert.equal(report.checks.client_restart_event_set_and_counts_stable, true);
  assert.equal(report.outside_initial_page, false);
});

test("事件目标必须来自已选最早真实 source，不能接受 forged turn_range/最新DB", async () => {
  const spec = fixture();
  const payload = JSON.parse(spec.db.agent_events[0].payload);
  payload.history_target.turn_id = "turn-2";
  spec.db.agent_events[0].payload = JSON.stringify(payload);
  await assert.rejects(execute(spec), /event_target_mismatch/);
});


test("已可见细条不做多余滚动；不可见细条先按真实AX路径滚入视野", async () => {
  const visible = await execute(fixture());
  assert.equal(visible.actions.filter((action) => action.scroll).length, 0);
  const scrolled = await execute(fixture(), { noticeNeedsScroll: true });
  assert.equal(scrolled.actions.filter((action) => action.scroll).length, 2);
  assert.equal(scrolled.result.checks.original_navigation, true);
});

test("批次消费者核完整 UI 报告身份与事实关系，不只接受ok声明", async () => {
  const { result } = await execute(fixture());
  const gate = { required: true, requireOutsideInitialPage: true };
  assert.equal(verifyCompactionHistoryReport(result, gate).ok, true);
  assert.equal(verifyCompactionHistoryReport(null, { required: false }).status, "not_requested");
  assert.equal(verifyCompactionHistoryReport({ ok: true }, gate).ok, false);
  for (const [name, mutate] of [
    ["少原文页", (r) => { delete r.located_page; }],
    ["少原文目标行", (r) => { r.source.original_interaction_id = "foreign"; }],
    ["原文query目标不同", (r) => { r.located_page.page.around_turn_id = "foreign"; }],
    ["谎称不在首屏", (r) => { r.outside_initial_page = false; }],
    ["降低分页要求", (r) => { r.require_outside_initial_page = false; }],
    ["缺body hash", (r) => { delete r.initial_page.body_sha256; }],
    ["旧请求冒充返回", (r) => { r.returned_page.request_id = r.initial_page.request_id; }],
    ["恢复页少一行", (r) => { r.restored_page.interaction_ids.pop(); }],
    ["恢复事件换绑", (r) => { r.restored_activity.event_ids = ["foreign"]; }],
    ["恢复数量变化", (r) => { r.restored_activity.covered_counts.scope_updates += 1; }],
    ["缺真实activity请求", (r) => { r.restored_activity.captures = []; }],
    ["旧activity冒充恢复", (r) => { r.restored_activity.captures = structuredClone(r.initial_activity.captures); }],
    ["重复事件身份", (r) => { r.source.event_ids.push(r.source.event_ids[0]); }],
    ["负数计数", (r) => { r.source.covered_counts.scope_updates = -1; }],
    ["缺checkpoint坐标", (r) => { r.source.checkpoint_refs = []; }],
    ["checkpoint错作品", (r) => { r.source.checkpoint_refs[0].work_id = "foreign"; }],
    ["重连错会话", (r) => { r.restored_join.session_id = "foreign"; }],
    ["旧join冒充重连", (r) => { r.restored_join.at = r.initial_join.at; }],
    ["AX不是原话", (r) => { r.original_visible.author_sha256 = "0".repeat(64); }],
    ["零面积AX", (r) => { r.original_visible.frame[2] = 0; }],
    ["讨论目标错归属", (r) => { r.located_discussion_sources[0].canonical_ref.session_id = "foreign"; }],
    ["缺截图索引", (r) => { r.captures.pop(); }],
    ["返回步骤未完成", (r) => { r.checks.return_current = false; }],
    ["僭称后端恢复", (r) => { r.recovery_scope = "backend"; }],
    ["僭称颜色已验证", (r) => { r.highlight_style.status = "passed"; }],
    ["僭称重复交付已实测", (r) => { r.duplicate_delivery.status = "passed"; }],
  ]) {
    const bad = JSON.parse(JSON.stringify(result));
    mutate(bad);
    const checked = verifyCompactionHistoryReport(bad, gate);
    assert.equal(checked.ok, false, name);
    assert.equal(typeof checked.reason, "string", name);
  }
});

test("合法来源定位页不允许改作者或已覆盖讨论原文字节", async () => {
  for (const id of ["user-1", "assistant-1"]) {
    const spec = fixture();
    spec.located.transcript.find((entry) => entry.id === id).text += " 篡改";
    await assert.rejects(execute(spec), /original_page_bytes_mismatch|original_discussion_bytes_missing/);
  }
});
