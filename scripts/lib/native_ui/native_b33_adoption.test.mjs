import test from "node:test";
import assert from "node:assert/strict";
import { adoptionEvidenceChecks, selectB33PendingArtifact } from "../../native_b33_evidence.mjs";
import { adoptPending } from "../../native_b33_drive.mjs";
import { buildAuthoringCanonSnapshot } from "./authoring_canon_evidence.mjs";
import { canonTables } from "./fixtures/native_b71_revision_facts.mjs";
import { authorBoundary } from "./authoring_g2_evidence.mjs";
import { locateScopedButton } from "./authoring_pending_evidence.mjs";

// These facts describe one frozen author action, not a replay or replacement of native evidence.
// Expected selection/remaining candidate and receipt targets are handwritten, never built by the SUT.
const S4_CHAPTER = "77777777-7777-4777-8777-777777777777";
const B33_AT = "2026-11-23T01:00:00.000Z";
const B33_DONE = "2026-11-23T01:00:01.000Z";
const B33_ACCEPT = "2026-11-23T01:00:02.000Z";

function scopedCandidateProof({ companion = true } = {}) {
  const identity = { topic: "workspace:22222222-2222-4222-8222-222222222222", workspaceId: "22222222-2222-4222-8222-222222222222",
    workId: "11111111-1111-4111-8111-111111111111", sessionId: "33333333-3333-4333-8333-333333333333", turnId: "message-b33", runId: "run-b33", since: B33_AT };
  const prose = { artifact_id: "as-prose", artifact_type: "prose_fragment",
    adoption_status: "TENTATIVE", requires_adoption: true, source_tool_result_ref: "tr-writer-b33",
    target_chapter: "第07章：空章待写", target_chapter_ref: "chapter:" + S4_CHAPTER,
    payload: { title: "目标正文", item_count: 1, adoption_effect: { mode: "append" },
      items: [{ item_id: "prose-item", title: "雨夜灯塔", body: "顾青合上账册，走进雨里的灯塔。" }] } };
  const seed = { artifact_id: "as-companion", artifact_type: "foreshadowing_seed",
    adoption_status: "TENTATIVE", requires_adoption: true, source_tool_result_ref: "tr-writer-b33",
    target_chapter: null, target_chapter_ref: null,
    payload: { title: "伴生伏笔", item_count: 1, adoption_effect: { mode: "append" },
      items: [{ item_id: "seed-item", title: "旧钟少响", body: "旧钟少响一下，原因尚未揭晓。" }] } };
  const pending = companion ? [prose, seed] : [prose];
  const turnResult = { status: "conversational", workspace_id: identity.workspaceId,
    work_id: identity.workId, session_id: identity.sessionId, turn_id: "message-b33:agent:2",
    agent_run: { run_id: identity.runId, parent_turn_ref: identity.turnId, status: "running" },
    adoption_state: { pending, resolved: [] } };
  const state = { status: "completed", workspace_id: identity.workspaceId, work_id: identity.workId,
    session_id: identity.sessionId, run_id: identity.runId, parent_turn_ref: identity.turnId,
    pending_artifact_refs: pending.map((entry) => entry.artifact_id) };
  const resultRecord = { at: B33_AT, direction: "received",
    frame: [null, null, identity.topic, "turn_result", turnResult] };
  const stateRecord = { at: B33_DONE, direction: "received",
    frame: [null, null, identity.topic, "agent_run_state", state] };
  return { identity, turnResult, state, prose, seed, wire: [resultRecord, stateRecord],
    terminal: { kind: "completed", record: stateRecord, body: turnResult },
    start: { chapters: [{ chapter_id: S4_CHAPTER, seq: 7, title: "第07章：空章待写", status: "PLANNED" }] },
    scenario: { id: "S4", input: "第07章的正文还没写，帮我写出来吧。",
      expect_action: "execute", expect_capability: "prose_writing", adopt: true } };
}

function b33Selection(proof) {
  return selectB33PendingArtifact(proof.turnResult, proof);
}

for (const reversed of [false, true]) {
  test("B33 scoped adoption selects the frozen prose with one companion, order " + reversed, () => {
    const proof = scopedCandidateProof();
    if (reversed) proof.turnResult.adoption_state.pending.reverse();
    const result = b33Selection(proof);
    assert.equal(result.unique, true);
    assert.equal(result.artifact.artifact_id, "as-prose");
  });
}

test("B33 scoped adoption preserves the single prose and single structure-plan cases", () => {
  const proof = scopedCandidateProof({ companion: false });
  assert.equal(b33Selection(proof).artifact.artifact_id, "as-prose");
  proof.scenario = { id: "S5", expect_action: "execute", expect_capability: "maintain_chapter_structure", adopt: true };
  proof.prose.artifact_type = "chapter_structure_change_plan";
  proof.prose.target_chapter_ref = null;
  proof.prose.payload.object_kind = "chapter_structure_change_plan";
  proof.prose.payload.adoption_effect = { mode: "renumber_chapters", effects: ["display_number_only"] };
  assert.equal(b33Selection(proof).unique, true);
  assert.equal(b33Selection(proof).artifact.artifact_id, "as-prose");
});

for (const [name, mutate] of [
  ["two target prose candidates", (p) => {
    p.turnResult.adoption_state.pending.push({ ...structuredClone(p.prose), artifact_id: "as-second" });
    p.state.pending_artifact_refs.push("as-second");
  }],
  ["another chapter prose alongside the target", (p) => {
    p.turnResult.adoption_state.pending.push({ ...structuredClone(p.prose),
      artifact_id: "as-other", target_chapter_ref: "chapter:other-chapter" });
    p.state.pending_artifact_refs.push("as-other");
  }],
  ["a sole prose for a different chapter", (p) => { p.prose.target_chapter_ref = "chapter:other-chapter"; }],
  ["a display title without the frozen chapter ref", (p) => { delete p.prose.target_chapter_ref; }],
  ["no frozen chapter identity", (p) => { p.start.chapters = []; }],
  ["a companion without prose", (p) => {
    p.turnResult.adoption_state.pending = [p.seed]; p.state.pending_artifact_refs = ["as-companion"];
  }],
  ["an already accepted candidate", (p) => { p.prose.adoption_status = "ACCEPTED"; }],
  ["a historical candidate absent from current run refs", (p) => { p.state.pending_artifact_refs = ["as-current"]; }],
  ["a current run ref without payload", (p) => { p.state.pending_artifact_refs.push("as-missing"); }],
  ["duplicate current run refs", (p) => { p.state.pending_artifact_refs.push("as-prose"); }],
  ["missing current run refs", (p) => { delete p.state.pending_artifact_refs; }],
  ["missing terminal run witness", (p) => { p.wire.pop(); }],
  ["a nonterminal run witness", (p) => { p.state.status = "running"; }],
  ["another result run", (p) => { p.turnResult.agent_run.run_id = "run-old"; }],
  ["another result parent turn", (p) => { p.turnResult.agent_run.parent_turn_ref = "message-old"; }],
  ["another result work", (p) => { p.turnResult.work_id = "work-other"; }],
  ["another result session", (p) => { p.turnResult.session_id = "session-other"; }],
  ["another result workspace", (p) => { p.turnResult.workspace_id = "workspace-other"; }],
  ["another terminal run", (p) => { p.state.run_id = "run-old"; }],
  ["another terminal parent turn", (p) => { p.state.parent_turn_ref = "message-old"; }],
  ["another terminal work", (p) => { p.state.work_id = "work-other"; }],
  ["another terminal session", (p) => { p.state.session_id = "session-other"; }],
  ["another terminal workspace", (p) => { p.state.workspace_id = "workspace-other"; }],
]) {
  test("B33 scoped adoption rejects " + name, () => {
    const proof = scopedCandidateProof({ companion: false });
    mutate(proof);
    assert.equal(b33Selection(proof).unique, false);
  });
}

function scopedAdoptionProof() {
  const proof = scopedCandidateProof();
  const action = { action_id: "accept:as-prose", action_type: "accept", target_ref: "as-prose",
    source_turn_ref: "message-b33:agent:2", idempotency_key: "accept-prose-once", enabled: true };
  proof.turnResult.available_actions = [action, { ...action, action_id: "accept:as-companion",
    target_ref: "as-companion", idempotency_key: "accept-companion-once" }];
  const mutationId = "99999999-9999-4999-8999-999999999999";
  const memoryId = "66666666-6666-4666-8666-666666666666";
  const projection = { chapter_id: S4_CHAPTER, scene_id: "scene-b33", draft_id: "draft-b33",
    source_revision_ref: "draft:draft-b33:1", mutation_id: mutationId };
  const receipt = { action_id: "adopt:as-prose", action_type: "adopt", artifact_id: "as-prose",
    artifact_type: "prose_fragment", status: "accepted", adoption_effect: { mode: "append" },
    decision: { candidate_ref: "as-prose", decision_type: "adopt_tentative" },
    persistence: { persisted: true, mutation_id: mutationId, mutation_status: "APPLIED",
      source_revision_ref: "mutation:" + mutationId, memory_item_id: memoryId,
      memory_status: "CONFIRMED", adoption_effect: { mode: "append" }, reading_projection: projection } };
  const sendBody = { work_id: proof.identity.workId, session_id: proof.identity.sessionId, action };
  const ackBody = { status: "ok", response: { received: true, action_status: "accepted" } };
  const send = { at: B33_ACCEPT, direction: "sent",
    frame: ["join-b33", "accept-request", proof.identity.topic, "author_action", sendBody] };
  const ack = { at: B33_ACCEPT, direction: "received",
    frame: ["join-b33", "accept-request", proof.identity.topic, "phx_reply", ackBody] };
  const broadcast = { at: B33_ACCEPT, direction: "received",
    frame: [null, null, proof.identity.topic, "action_result", receipt] };
  const adopted = { artifact_id: "as-prose", artifact_type: "prose_fragment",
    requires_adoption: false, adoption_status: "ACCEPTED", source_artifact_ref: "as-prose",
    adopted_state_ref: "adopted:as-prose", mutation_ref: mutationId,
    payload: structuredClone(proof.prose.payload) };
  // AdoptionWorkflow returns an action delta, not the complete session pending projection.
  const afterResult = { turn_id: "turn-adopt-b33", parent_turn_id: "message-b33:agent:2",
    workspace_id: proof.identity.workspaceId, work_id: proof.identity.workId, session_id: proof.identity.sessionId,
    phase: "completed", status: "conversational", adoption_state: { pending: [], resolved: [adopted] } };
  const afterRecord = { at: B33_ACCEPT, direction: "received",
    frame: [null, null, proof.identity.topic, "turn_result", afterResult] };
  proof.wire.push(send, ack, broadcast, afterRecord);
  proof.driverEntry = { adoption: { artifact_id: "as-prose", button: "保存为章节正文", clicked_at: B33_DONE,
    send: structuredClone(sendBody), ack: structuredClone(ackBody), receipt: structuredClone(receipt) } };
  const stored = { id: "receipt-b33", work_id: proof.identity.workId, session_id: proof.identity.sessionId,
    source_turn_ref: "message-b33:agent:2", action_id: "accept:as-prose", action_type: "accept",
    idempotency_key: "accept-prose-once", status: "accepted",
    result: { ...structuredClone(receipt), decision: "ACCEPTED", decided_by: "author" } };
  const mutation = { id: mutationId, actor_ref: "author", source_turn_ref: "message-b33:agent:2",
    target_scope: "work:" + proof.identity.workId, target_object_ref: "as-prose", proposed_change_ref: "as-prose",
    mutation_type: "adopt_artifact", status: "APPLIED", authority_scope: "author_confirmed_adoption",
    requires_adoption: false, base_revision: 1 };
  const memory = { id: memoryId, work_id: proof.identity.workId, source_id: mutationId,
    source_type: "AUTHOR_CONFIRMED", type: "DRAFT_CONTEXT", status: "CONFIRMED",
    content: "顾青合上账册，走进雨里的灯塔。", summary: "第07章：空章待写",
    tags: ["adopted_artifact", "prose_fragment"], reference_count: 0, last_referenced_at: null };
  const storedTurn = (body) => Object.fromEntries(Object.entries(structuredClone(body))
    .filter(([key]) => !["workspace_id", "work_id", "session_id"].includes(key)));
  const sourceRow = { id: "interaction-source", workspace_id: proof.identity.workspaceId,
    session_id: proof.identity.sessionId, role: "assistant", turn_id: "message-b33:agent:2",
    content: { agent_run_id: "run-b33", turn_result: storedTurn(proof.turnResult) } };
  const actionRow = { id: "interaction-adoption", workspace_id: proof.identity.workspaceId,
    session_id: proof.identity.sessionId, role: "assistant", turn_id: "turn-adopt-b33",
    content: { turn_result: storedTurn(afterResult) } };
  const tables = canonTables();
  tables.works = [{ id: proof.identity.workId }];
  tables.chapters = [{ id: S4_CHAPTER, work_id: proof.identity.workId, seq: 4, title: "第07章：空章待写",
    status: "PLANNED", plan_direction: null, summary: "待写灯塔第一场。" }];
  tables.memory_items = [];
  const afterTables = structuredClone(tables);
  afterTables.chapters[0].status = "DRAFTING";
  afterTables.drafts = [{ id: "draft-b33", work_id: proof.identity.workId, scene_id: "scene-b33",
    status: "ACCEPTED", revision: 1, content: "顾青合上账册，走进雨里的灯塔。" }];
  afterTables.scenes = [{ id: "scene-b33", chapter_id: S4_CHAPTER, seq: 1, title: "雨夜灯塔" }];
  afterTables.author_action_receipts = [stored];
  afterTables.memory_items = [memory];
  const snapshot = (rows, at, interactions, mutations) => ({
    action_receipts: structuredClone(rows.author_action_receipts),
    scope_rows: { drafts: structuredClone(rows.drafts), scenes: structuredClone(rows.scenes),
      memory_items: structuredClone(rows.memory_items), interactions, mutations, versions: [], chapter_summaries: [] },
    authoring_canon: buildAuthoringCanonSnapshot({ tables: rows, referenceLogs: [], at, includeChapterFacts: false }) });
  // The adjacent pre-click capture already contains both candidates and any generation-stage effects.
  proof.before = snapshot(tables, B33_DONE, [structuredClone(sourceRow)], []);
  proof.after = snapshot(afterTables, B33_ACCEPT, [sourceRow, actionRow], [mutation]);
  proof.afterResult = afterResult;
  proof.afterTables = afterTables;
  proof.receipt = receipt;
  // Isolate the existing post-selection consumer; the selector's independent tests above own uniqueness.
  proof.unique = true;
  proof.artifact = proof.prose;
  return proof;
}

function scopedAdoptionPasses(proof) {
  // Keep raw rows and canon signatures coherent after each independently specified corruption.
  for (const table of ["drafts", "scenes", "memory_items"]) proof.afterTables[table] = proof.after.scope_rows[table];
  proof.afterTables.author_action_receipts = proof.after.action_receipts;
  proof.after.authoring_canon = buildAuthoringCanonSnapshot({ tables: proof.afterTables,
    referenceLogs: [], at: B33_ACCEPT, includeChapterFacts: false });
  try { return Object.values(adoptionEvidenceChecks(proof)).every(Boolean); }
  catch { return false; }
}

test("B33 scoped adoption accepts one prose receipt and leaves the companion pending", () => {
  const proof = scopedAdoptionProof();
  const checks = adoptionEvidenceChecks(proof);
  assert(Object.values(checks).every(Boolean),
    JSON.stringify(Object.entries(checks).filter(([, value]) => !value)));
});

for (const [name, mutate] of [
  ["a wire action aimed only at the companion", (p) => {
    p.wire[2].frame[4].action = structuredClone(p.turnResult.available_actions[1]);
  }],
  ["a receipt naming the companion", (p) => { p.receipt.artifact_id = "as-companion"; }],
  ["a driver log claiming a different action", (p) => { p.driverEntry.adoption.artifact_id = "as-companion"; }],
  ["a duplicate prose action", (p) => { p.wire.push(structuredClone(p.wire[2])); }],
  ["a missing persisted receipt", (p) => { p.after.action_receipts = []; }],
  ["a stored receipt for another candidate", (p) => {
    p.after.action_receipts[0].result.artifact_id = "as-companion";
  }],
  ["a stored result differing from the broadcast", (p) => {
    p.after.action_receipts[0].result.persistence.reading_projection.draft_id = "other-draft";
  }],
  ["a missing post-adoption TurnResult", (p) => { p.wire.pop(); }],
  ["another source turn in the post-adoption result", (p) => {
    p.afterResult.parent_turn_id = "message-old:agent:2";
  }],
  ["a silently accepted companion in the action delta", (p) => {
    p.afterResult.adoption_state.resolved.push({ ...structuredClone(p.seed),
      adoption_status: "ACCEPTED", requires_adoption: false });
  }],
  ["a missing companion in persisted source evidence", (p) => {
    p.after.scope_rows.interactions[0].content.turn_result.adoption_state.pending.pop();
  }],
  ["a changed companion in persisted source evidence", (p) => {
    p.after.scope_rows.interactions[0].content.turn_result.adoption_state.pending[1].payload.items[0].body =
      "已经解决的旧钟伏笔。";
  }],
  ["a companion resolved in another persisted action", (p) => {
    const row = structuredClone(p.after.scope_rows.interactions[1]);
    row.id = "interaction-companion-adoption";
    row.turn_id = row.content.turn_result.turn_id = "turn-adopt-companion";
    row.content.turn_result.adoption_state.resolved = [
      { ...structuredClone(p.seed), adoption_status: "ACCEPTED", requires_adoption: false },
    ];
    p.after.scope_rows.interactions.push(row);
  }],
  ["a companion written into the formal ledger", (p) => {
    p.afterTables.ledger_entries = [{ id: "ledger-companion", work_id: p.identity.workId,
      content: "旧钟少响一下，原因尚未揭晓。", status: "ACCEPTED" }];
    p.after.authoring_canon = buildAuthoringCanonSnapshot({ tables: p.afterTables,
      referenceLogs: [], at: B33_ACCEPT, includeChapterFacts: false });
  }],
  ["a companion written into formal memory", (p) => {
    p.after.scope_rows.memory_items.push({ id: "88888888-8888-4888-8888-888888888888",
      work_id: p.identity.workId, content: "旧钟少响一下，原因尚未揭晓。",
      type: "FORESHADOWING", status: "CONFIRMED", reference_count: 0, last_referenced_at: null });
  }],
  ["a missing prose memory row", (p) => { p.after.scope_rows.memory_items = []; }],
  ["a prose memory linked to another mutation", (p) => {
    p.after.scope_rows.memory_items[0].source_id = "mutation-other";
  }],
  ["a prose memory with companion content", (p) => {
    p.after.scope_rows.memory_items[0].content = "旧钟少响一下，原因尚未揭晓。";
  }],
  ["a memory with non-prose tags", (p) => {
    p.after.scope_rows.memory_items[0].tags = ["adopted_artifact", "foreshadowing_seed"];
  }],
  ["a missing adoption mutation", (p) => { p.after.scope_rows.mutations = []; }],
  ["a mutation targeting the companion", (p) => {
    p.after.scope_rows.mutations[0].target_object_ref = "as-companion";
  }],
  ["an extra companion mutation", (p) => {
    p.after.scope_rows.mutations.push({ ...structuredClone(p.after.scope_rows.mutations[0]),
      id: "mutation-companion", target_object_ref: "as-companion", proposed_change_ref: "as-companion" });
  }],
  ["a different persisted chapter body", (p) => { p.after.scope_rows.drafts[0].content = "未经选择的另一份正文。"; }],
  ["a projection into another chapter even when logs agree", (p) => {
    for (const receipt of [p.receipt, p.driverEntry.adoption.receipt, p.after.action_receipts[0].result]) {
      receipt.persistence.reading_projection.chapter_id = "other-chapter";
    }
  }],
  ["an extra companion action without author authorization", (p) => {
    const action = structuredClone(p.turnResult.available_actions[1]);
    p.wire.push({ at: B33_ACCEPT, direction: "sent",
      frame: ["join-b33", "companion-request", p.identity.topic, "author_action", { action }] });
  }],
  ["an extra persisted companion receipt", (p) => {
    const action = structuredClone(p.turnResult.available_actions[1]);
    const extra = structuredClone(p.after.action_receipts[0]);
    Object.assign(extra, { id: "receipt-companion", action_id: action.action_id,
      idempotency_key: action.idempotency_key });
    Object.assign(extra.result, { action_id: "adopt:as-companion", artifact_id: "as-companion",
      artifact_type: "foreshadowing_seed" });
    p.after.action_receipts.push(extra);
  }],
]) {
  test("B33 scoped adoption rejects " + name, () => {
    const proof = scopedAdoptionProof();
    mutate(proof);
    assert.equal(scopedAdoptionPasses(proof), false);
  });
}

function b33Ax(path, role, fields = {}) {
  return { path, role, frame: [10, 10, 120, 20], ...fields };
}

function b33ItemNodes(prefix, item) {
  return [
    b33Ax(prefix, "AXGroup", { subrole: "AXDocumentArticle" }),
    b33Ax(prefix + "/0", "AXGroup"),
    b33Ax(prefix + "/0/0", "AXStaticText", { value: item.title }),
    b33Ax(prefix + "/1", "AXGroup"),
    b33Ax(prefix + "/1/0", "AXStaticText", { value: item.body }),
  ];
}

function b33AdoptionNodes(proof, { flat = false, companion = false,
  label = "保存为章节正文", companionLabel = "保存到作品档案" } = {}) {
  const buttonPath = flat ? "0/3" : "0/2/2";
  return [
    b33Ax("0", "AXGroup"),
    b33Ax("0/0", "AXGroup"),
    b33Ax("0/0/0", "AXStaticText", { value: "你" }),
    b33Ax("0/1", "AXGroup"),
    b33Ax("0/1/0", "AXStaticText", { value: proof.scenario.input }),
    ...b33ItemNodes("0/2", proof.prose.payload.items[0]),
    b33Ax(buttonPath, "AXButton", { title: label, enabled: true }),
    ...(companion ? [
      ...b33ItemNodes("0/5", proof.seed.payload.items[0]),
      b33Ax("0/6", "AXButton", { title: companionLabel, enabled: true }),
    ] : []),
  ];
}

function locatedB33Button(proof, nodes, label) {
  const item = proof.prose.payload.items[0];
  return locateScopedButton(nodes, {
    artifact: proof.prose, knownArtifacts: proof.turnResult.adoption_state.pending,
    itemTitle: item.title, itemBody: item.body, label,
    authorBoundary: authorBoundary(nodes, proof.scenario.input, 0),
  });
}

for (const [label, companionLabel] of [
  ["保存原稿", "保存到作品档案"],
  ["保存到作品档案", "保存到作品档案"],
]) {
  test("B33 flat sibling cards own separate action spans: " + label, () => {
    const proof = scopedCandidateProof();
    const nodes = b33AdoptionNodes(proof, { flat: true, companion: true, label, companionLabel });
    const result = locatedB33Button(proof, nodes, label);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.button.path, "0/3");
    assert.equal(result.item_path, "0/2");
  });
}

test("B33 prose may mention a companion title without owning that companion card", () => {
  const proof = scopedCandidateProof();
  proof.prose.payload.items[0].body += "\n\n" + proof.seed.payload.items[0].title;
  const nodes = b33AdoptionNodes(proof, { companion: true });
  nodes.push(b33Ax("0/2/3", "AXStaticText", { value: proof.seed.payload.items[0].title }));
  const result = locatedB33Button(proof, nodes, "保存为章节正文");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.button.path, "0/2/2");
});

for (const [name, corrupt] of [
  ["no target action cannot borrow the companion action", (nodes) => nodes.filter((n) => n.path !== "0/3")],
  ["two target actions cannot select the first", (nodes) => [...nodes,
    b33Ax("0/4", "AXButton", { title: "保存到作品档案", enabled: true })]],
  ["the same title and body in two cards remain ambiguous", (nodes, proof) => [...nodes,
    ...b33ItemNodes("0/8", proof.prose.payload.items[0])]],
]) {
  test("B33 flat action span fails closed: " + name, () => {
    const proof = scopedCandidateProof();
    const nodes = b33AdoptionNodes(proof, { flat: true, companion: true,
      label: "保存到作品档案", companionLabel: "保存到作品档案" });
    assert.equal(locatedB33Button(proof, corrupt(nodes, proof), "保存到作品档案").ok, false);
  });
}

// The existing driver is called directly. This spy supplies only AX and the already handwritten wire facts.
function b33DriverBoundary(proof, before, after = before) {
  const wire = proof.wire.slice(0, 2);
  const trace = { dumps: [], scrolls: [], clicks: [], revealed: false };
  const driver = {
    transport: () => wire,
    dumpNodes() {
      trace.dumps.push(trace.revealed ? "after-reveal" : "before-reveal");
      return structuredClone(trace.revealed ? after : before);
    },
    ensureInput: () => ({ scrollTo(itemPath) {
      trace.scrolls.push(itemPath);
      trace.revealed = true;
    } }),
    safeClick(button) {
      trace.clicks.push(structuredClone(button));
      const at = new Date(Date.now() + 1).toISOString();
      wire.push(...proof.wire.slice(2).map((row) => ({ ...structuredClone(row), at })));
    },
    async pollWire(read, _timeout, label) {
      const observed = read(wire);
      assert.ok(observed, "Missing handwritten action evidence: " + label);
      return observed;
    },
  };
  const run = () => adoptPending(proof.turnResult, proof.identity, proof.scenario, 0, 1000,
    { driver, readStart: () => proof.start });
  return { trace, run };
}

test("B33 driver uses the actual quality original action label", async () => {
  const proof = scopedAdoptionProof();
  proof.turnResult.quality_review = { findings: [{ summary: "节奏需要调整" }] };
  const nodes = b33AdoptionNodes(proof, { label: "保存原稿" });
  const fixture = b33DriverBoundary(proof, nodes);
  const result = await fixture.run();
  assert.equal(result.button, "保存原稿");
  assert.equal(result.artifact_id, "as-prose");
  assert.deepEqual(fixture.trace.clicks.map((n) => n.path), ["0/2/2"]);
});

test("B33 driver reveals an offscreen candidate and uses fresh AX before clicking", async () => {
  const proof = scopedAdoptionProof();
  const before = b33AdoptionNodes(proof);
  before.find((n) => n.path === "0/2/2").frame = [10, -323, 120, 20];
  const after = b33AdoptionNodes(proof);
  after.find((n) => n.path === "0/2/2").path = "0/2/7";
  const fixture = b33DriverBoundary(proof, before, after);
  await fixture.run();
  assert.deepEqual(fixture.trace.scrolls, ["0/2"]);
  assert(fixture.trace.dumps.includes("after-reveal"));
  assert.deepEqual(fixture.trace.clicks.map((n) => n.path), ["0/2/7"]);
});

for (const [name, corrupt] of [
  ["removed candidate", (nodes) => nodes.filter((n) => !n.path.startsWith("0/2"))],
  ["disabled action", (nodes) => nodes.map((n) => n.path === "0/2/2" ? { ...n, enabled: false } : n)],
  ["still offscreen action", (nodes) => nodes.map((n) => n.path === "0/2/2" ? { ...n, frame: [10, -5, 120, 20] } : n)],
  ["duplicate action", (nodes) => [...nodes,
    b33Ax("0/2/3", "AXButton", { title: "保存为章节正文", enabled: true })]],
]) {
  test("B33 driver rejects changed AX after reveal: " + name, async () => {
    const proof = scopedAdoptionProof();
    const before = b33AdoptionNodes(proof);
    const fixture = b33DriverBoundary(proof, before, corrupt(structuredClone(before)));
    await assert.rejects(fixture.run());
    assert.deepEqual(fixture.trace.clicks, []);
    assert(fixture.trace.dumps.includes("after-reveal"));
  });
}

test("B33 driver does not guess an unknown or ambiguous visible action", async () => {
  for (const title of ["未知动作", "保存为章节正文"]) {
    const proof = scopedAdoptionProof();
    const nodes = b33AdoptionNodes(proof, { label: title });
    if (title === "保存为章节正文") {
      nodes.push(b33Ax("0/2/3", "AXButton", { title, enabled: true }));
    }
    const fixture = b33DriverBoundary(proof, nodes);
    await assert.rejects(fixture.run());
    assert.deepEqual(fixture.trace.clicks, []);
  }
});
