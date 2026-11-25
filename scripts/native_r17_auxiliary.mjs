// R17 CP2 scoped mechanism acceptance. Two independent single-work journeys;
// existing AX/CGEvent harness, B28 adoption, seeds and evidence owners are reused.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NativeScenarioHarness } from "./lib/native_ui/scenario_driver.mjs";
import { textOf } from "./lib/native_ui/driver.mjs";
import { all, withDb, read, write, seedFields, productionFingerprint,
  checkProductionFingerprint, assertCommonEvidence, assertProviderAndWire,
  requestIdentity, requestReplies, frameBody, logs, writeNativeSummary, evidenceBoundary
} from "./lib/native_ui/scenario_evidence.mjs";
import { scopeRowValues, chapterSummaryMaterial } from "./lib/native_ui/chapter_summary_maintenance_evidence.mjs";
import { runScopeScenario } from "./native_b28_scope_drive.mjs";
import { SCENARIOS, B28_BUDGET } from "./native_b28_scope_evidence.mjs";

const INVENTORY = "r17-auxiliary-inventory";
const SUMMARY = "r17-auxiliary-summary";
const P1 = SCENARIOS.find(s => s.id === "P1");
const RECORD = "native-r17-auxiliary.json";
const RULE = "作者是唯一裁决者";
const stamp = () => new Date().toISOString();
const list = value => Array.isArray(value) ? value : [];
const text = message => list(message.blocks).filter(b => b.type === "text").map(b => b.text).join("");
const frames = (wire, direction, event) => wire.filter(r => r.direction === direction && r.frame?.[3] === event);
const nonBlank = value => typeof value === "string" && value.trim() !== "";

function snapshot(dir) {
  return withDb(dir, db => ({
    at: stamp(),
    ...Object.fromEntries(["works", "chapters", "volumes", "scenes", "drafts",
      "characters", "memory_items", "ledger_entries", "chapter_summaries", "author_action_receipts"]
      .map(table => [table, scopeRowValues(table, all(db, `SELECT * FROM ${table} ORDER BY id`))]))
  }));
}

function config(dir, sliceId) {
  assert([INVENTORY, SUMMARY].includes(sliceId));
  const ready = read(dir, "native-driver-ready.json"), seed = seedFields(dir);
  assert.equal(ready.slice_id, sliceId);
  assert.equal(ready.provider, "slice_verify");
  const workId = seed("work_id");
  const work = withDb(dir, db => all(db, "SELECT id,title FROM works WHERE id=?", [workId])[0]);
  assert(nonBlank(workId) && nonBlank(work?.title), "seed work missing");
  return { sliceId, target: { work_id: workId, work_title: work.title,
    session_id: seed("session_id"), chapter_id: seed("target_chapter_id"),
    control_chapter_id: seed("control_chapter_id") },
    budget: { ...B28_BUDGET, max_author_inputs: 1 } };
}

function click(harness, name, label) {
  const nodes = harness.dumpNodes();
  const node = harness.findButton(nodes, name) ??
    nodes.find(n => ["AXButton", "AXRadioButton", "AXTab"].includes(n.role) && (n.title === name || textOf(n) === name));
  assert(node, `button_not_found:${label}:${name}`);
  harness.safeClick(node, label);
}

async function inventory(harness, c, dir) {
  await harness.runStep("maintenance", "archive_overview", async () => {
    click(harness, "打开档案", "archive_open");
    const overview = await harness.pollAx((_text, nodes) => nodes.some(n => n.role === "AXRadioButton" && n.title === "概览"), 30000, "overview_tab");
    const tab = overview.nodes.find(n => n.role === "AXRadioButton" && n.title === "概览");
    if (tab.value !== "1") click(harness, "概览", "overview_tab");
    await harness.pollAx((_text, nodes) => Boolean(harness.findButton(nodes, "发起设定盘点")),
      30000, "inventory_button");
  });
  harness.capture("02-archive");
  const sent = await harness.runStep("input", "inventory_start", async () => {
    const since = stamp();
    click(harness, "发起设定盘点", "inventory_start");
    return harness.pollWire(wire => frames(wire, "sent", "author_action").find(r =>
      r.at >= since && frameBody(r)?.action?.action_type === "start_fact_inventory") ?? null,
      30000, "inventory_action");
  });
  const identity = requestIdentity(sent);
  const ack = await harness.runStep("ack", "inventory_ack", () =>
    harness.pollWire(wire => {
      const replies = requestReplies(wire, identity, sent.at);
      assert(replies.length <= 1, "inventory ack ambiguous");
      return replies[0] ?? null;
    }, 30000, "inventory_ack"));
  const response = frameBody(ack)?.response;
  assert(frameBody(ack)?.status === "ok" && response?.action_status === "running" && nonBlank(response.run_id));
  const result = await harness.runStep("turn", "inventory_result", () =>
    harness.pollWire(wire => frames(wire, "received", "turn_result").find(r => {
      const b = frameBody(r);
      return r.at >= sent.at && r.frame[2] === identity.topic &&
        b?.agent_run?.run_id === response.run_id && b.agent_run.profile_ref === "fact_inventory_v1" &&
        b.tool_result?.tool_name === "fact_inventory" && b.tool_result.status === "succeeded" &&
        list(b.adoption_state?.pending).length > 0;
    }) ?? null, 120000, "inventory_result"));
  const pending = frameBody(result).adoption_state.pending;
  const title = pending.find(p => p.artifact_type === "world_rule_seed")?.payload?.items?.[0]?.title;
  assert(nonBlank(title), "inventory rule candidate missing");
  await harness.runStep("candidate", "inventory_visible", () =>
    harness.pollAx(value => value.includes(title), 60000, "inventory_candidate_visible"));
  harness.capture("03-inventory-pending");
  write(dir, "final-db.json", snapshot(dir));
  return { run_id: response.run_id, turn_id: frameBody(result).turn_id, since: sent.at,
    action_id: frameBody(sent).action.action_id, candidate_title: title };
}

async function drive(dir, sliceId) {
  const harness = new NativeScenarioHarness(dir);
  try {
    const c = config(dir, sliceId);
    write(dir, "production-sources-before.json", productionFingerprint());
    await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
    await harness.runStep("maintenance", "workbench_ready", () => harness.rawWaitWorkbenchSettled("initial"));
    assert.equal(harness.visibleWorkTitle(harness.dumpNodes()), c.target.work_title,
      "target work not selected at startup; no menu switch attempted");
    harness.capture("01-workbench");
    write(dir, "start-db.json", snapshot(dir));
    const result = sliceId === INVENTORY ? await inventory(harness, c, dir)
      : await runScopeScenario(harness, c, P1, {
          captureEvidence: checkpoint => write(dir, `db-${checkpoint}.json`, snapshot(dir)),
          readMaintenanceRecords: () => logs(path.join(dir, "app-log"))
        });
    if (sliceId === SUMMARY) {
      assert.equal(result.final_kind, "turn_result");
      assert(result.adoption?.maintenance, "summary maintenance not reached");
      write(dir, "final-db.json", snapshot(dir));
    }
    harness.writeDriverLog(RECORD, { slice_id: sliceId, target: c.target, result });
    harness.writeUiComplete(sliceId);
  } catch (error) {
    await harness.fail(error);
    throw error;
  }
}

// Canonical request shape, not model semantics; a deterministic provider is not real-model HTTP proof.
export function auxiliaryRequest(record, role) {
  const ir = record?.request_body;
  assert.equal(ir?.system?.run_role, role, "wrong effective role");
  assert.equal(ir.run?.profile_ref, role, "wrong independent operation profile");
  assert(!ir.run.run_id && !ir.run.session_id && !ir.run.parent_turn_ref, "invented independent run identity");
  const rules = ir.system.instructions;
  assert(nonBlank(rules) && rules.split(RULE).length === 2, "shared rules missing or repeated");
  assert(!rules.includes("单个创作产物用 judgment_decision.execute"), "judgment rule leaked");
  assert.deepEqual(ir.tools, []);
  const [base] = ir.messages;
  assert.equal(base?.role, "application_base");
  assert.equal(base?.provenance, "application");
  assert(base.blocks.every(b => b.type === "text"));
  const material = text(base);
  assert(nonBlank(material) && !material.includes(RULE), "shared rules mixed with materials");
  assert(ir.messages.slice(1).every(m => m.role === "scope_update" && m.provenance === "application"),
    "unexpected author/notice/role history");
  assert.equal(record.response?.status, "ok", "auxiliary response not successful");
  return { ir, rules, material };
}

function own(rows, workId) { return rows.filter(r => r.work_id === workId); }
function chapterDrafts(db, chapterId) {
  const scenes = new Set(db.scenes.filter(s => s.chapter_id === chapterId).map(s => s.id));
  return db.drafts.filter(d => scenes.has(d.scene_id) && d.status === "ACCEPTED");
}
function sameRows(a,b) { assert.deepEqual(a,b); return true; }

function verify(dir, sliceId) {
  const { ready, ui } = assertCommonEvidence(dir, { sliceId, minScreenshots: 2, minimumWaits: 4,
    requiredKinds: ["input","ack","turn","maintenance"] });
  const { wire, llmRecords, appRecords } = assertProviderAndWire(dir,
    { minUserMessages: sliceId === INVENTORY ? 0 : 1 });
  const driver = read(dir, RECORD), c = config(dir, sliceId);
  assert.equal(driver.slice_id, sliceId);
  assert.deepEqual(driver.target,c.target);
  assert(checkProductionFingerprint(dir).unchanged);
  const a = read(dir, "start-db.json"), b = read(dir, "final-db.json"), workId = c.target.work_id;
  const role = sliceId === INVENTORY ? "fact_inventory" : "chapter_summary";
  const calls = llmRecords.filter(r => r.request_body?.system?.run_role === role);
  assert.equal(calls.length, 1, "auxiliary operation count changed");
  const call = calls[0], { ir, rules, material } = auxiliaryRequest(call, role);
  const checks = { real_tauri_and_provider: ready.provider === "slice_verify" && ui.scope === sliceId,
    unique_effective_role: true, actual_material_separated: true, no_invented_author_or_run: true,
    production_unchanged_during_capture: true };
  if (sliceId === INVENTORY) {
    const sends = frames(wire,"sent","author_action");
    assert.equal(sends.length,1);
    assert.equal(frameBody(sends[0]).action.action_type,"start_fact_inventory");
    assert.equal(frameBody(sends[0]).action.action_id,driver.result.action_id);
    const result = frames(wire,"received","turn_result").map(frameBody)
      .find(r => r.agent_run?.run_id === driver.result.run_id && r.turn_id === driver.result.turn_id);
    assert(result?.agent_run?.profile_ref === "fact_inventory_v1");
    const types = new Set(list(result.adoption_state?.pending).map(p => p.artifact_type));
    for (const type of ["character_seed","world_rule_seed","foreshadowing_seed"]) assert(types.has(type), type);
    for (const draft of own(a.drafts,workId).filter(d => d.status === "ACCEPTED")) {
      assert(nonBlank(draft.content) && material.includes(draft.content), "accepted seed material absent");
      assert(!rules.includes(draft.content), "prose in system");
    }
    for (const table of ["chapters","volumes","scenes","drafts","chapter_summaries","ledger_entries"])
      sameRows(a[table],b[table]);
    sameRows(a.characters.filter(r=>r.status==="ACCEPTED"),b.characters.filter(r=>r.status==="ACCEPTED"));
    sameRows(a.memory_items.filter(r=>["CONFIRMED","ACCEPTED"].includes(r.status)),
      b.memory_items.filter(r=>["CONFIRMED","ACCEPTED"].includes(r.status)));
    for (const f of ["target_length","planned_volumes","serial_form"]) {
      assert.equal(a.works.find(w=>w.id===workId)[f],b.works.find(w=>w.id===workId)[f]);
    }
    Object.assign(checks,{ explicit_inventory_action_bound: true, tentative_seed_families_visible: true,
      accepted_prose_and_authoritative_settings_unchanged: true });
  } else {
    const adopted = driver.result.adoption;
    const projection = adopted.receipt.persistence?.reading_projection;
    assert(adopted.receipt.persistence?.persisted === true && projection?.chapter_id === c.target.chapter_id);
    const before = read(dir,"db-P1-before-adoption.json");
    sameRows(a.drafts,before.drafts);
    sameRows(a.chapter_summaries,before.chapter_summaries);
    sameRows(chapterDrafts(a,c.target.control_chapter_id),chapterDrafts(b,c.target.control_chapter_id));
    const nowDrafts=chapterDrafts(b,c.target.chapter_id), oldDrafts=chapterDrafts(a,c.target.chapter_id);
    assert.notDeepEqual(nowDrafts,oldDrafts);
    const added=own(b.chapter_summaries,workId).filter(r=>!a.chapter_summaries.some(old=>old.id===r.id));
    assert.equal(added.length,1);
    const row=added[0];
    assert.equal(row.status,"ACCEPTED"); assert.equal(row.chapter_id,c.target.chapter_id);
    assert.equal(adopted.receipt.artifact_type,"prose_fragment");
    assert.equal(row.material_scope,"fragment");
    assert.equal(row.revision_base,projection.source_revision_ref);
    assert.equal(row.source_ref,driver.result.turn_id);
    assert.deepEqual(ir.refs.base_refs,[row.source_ref,"chapter:"+row.chapter_id]);
    const draft=nowDrafts.find(d=>d.id===projection.draft_id);
    assert(draft && nonBlank(draft.content) && !a.drafts.some(d=>d.id===draft.id),"new adopted draft missing");
    assert.equal(material,chapterSummaryMaterial({chapterId:row.chapter_id,revisionBase:row.revision_base,
      materialScope:"fragment",text:draft.content.trim()}));
    assert(!rules.includes(draft.content.trim()));
    const response=call.response.body?.content;
    assert(nonBlank(response) && row.summary_text===response.trim(),"persisted summary differs from response");
    assert(appRecords.some(r=>r.event==="chapter_summary_maintenance.run.done" &&
      r.work_id===workId && r.chapter_id===row.chapter_id && r.status==="ACCEPTED" && r.four_column===true));
    Object.assign(checks,{ no_summary_before_author_adoption: true, exact_adopted_source_and_revision: true,
      accepted_summary_bound_to_response: true, control_chapter_unchanged: true });
  }
  return writeNativeSummary(dir,{sliceId,checks,measured:{work_id:workId,auxiliary_calls:calls.length,
    provider_call_ref:call.provider_call_ref,provider_run_ref:call.provider_run_ref},
    extra:{evidence_boundary:evidenceBoundary(),known_limits:["CP2定向机制；不代签原综合场景、R08或实模语义"]}});
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode,dir,sliceId]=process.argv.slice(2);
  if (mode==="drive") await drive(path.resolve(dir),sliceId);
  else if(mode==="verify") verify(path.resolve(dir),sliceId);
  else throw new Error("usage: native_r17_auxiliary.mjs drive|verify DIR SLICE");
}
