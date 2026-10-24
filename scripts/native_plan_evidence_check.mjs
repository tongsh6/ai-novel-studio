// B26：既有多步计划场景的原生矩阵；仅消费外部 UI、真实网络/日志和持久结果。
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const [artifactDir, appLogDir, llmLogDir] = process.argv.slice(2);
const dir = path.resolve(artifactDir);
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const readLines = (file) => fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse);
const readLogs = (folder) => fs.readdirSync(folder).filter((name) => name.endsWith(".jsonl"))
  .flatMap((name) => readLines(path.join(folder, name)));
const ready = read("native-driver-ready.json"), evidence = read("native-ui-complete.json");
assert.equal(evidence.harness_run_ref, ready.run_ref);
assert.equal(evidence.driver, "macos-cgevent-plan-matrix");
assert.equal(evidence.app_bundle, "com.ai-novel-studio.app");
assert.equal(ready.browser_driver_started, false);
assert(!fs.existsSync(path.join(dir, "ui-frames.json")));
assert(evidence.screenshots.length >= 4);
for (const name of evidence.screenshots) {
  const file = path.resolve(dir, name);
  assert(file.startsWith(dir + path.sep));
  assert(fs.statSync(file).mtimeMs >= Date.parse(ready.ready_at));
  const header = fs.readFileSync(file).subarray(0, 8).toString("hex");
  assert(header.startsWith("ffd8ff") || header === "89504e470d0a1a0a");
}
const wire = readLines(path.join(dir, "native-transport.jsonl"));
const frames = wire.filter((row) => row.direction === "received" && !row.dropped).map((row) => row.frame).filter(Boolean);
const logs = readLogs(appLogDir), calls = readLogs(llmLogDir);
const fetchJSON = async (url) => { const response = await fetch(url); assert(response.ok); return response.json(); };
const base = `${ready.api_url}/api/works/${evidence.work_id}/sessions/${evidence.session_id}`;
const snapshot = await fetchJSON(base);
assert.equal(snapshot.transcript_page.has_more_before, false, "三次计划验收应在完整最近页内");
const cases = {};
for (const [mode, draftCount, revisionCount, totalCalls] of [["同批计划", 0, 0, 3], ["另行起草计划", 1, 0, 4], ["先核对再补齐计划", 1, 1, 5]]) {
  const parent = evidence.turns[mode];
  assert(parent);
  const sends = wire.filter((row) => row.direction === "sent" && row.frame?.[3] === "user_message" && row.frame[4].turn_id === parent);
  assert.equal(sends.length, 1, "每条计划必须仅由一次真实主输入启动");
  const input = sends[0].frame[4];
  assert.equal(input.work_id, evidence.work_id);
  assert.equal(input.session_id, evidence.session_id);
  assert(input.text.includes(mode));
  const ack = frames.find((frame) => frame[3] === "phx_reply" && frame[4].response?.turn_id === parent && frame[4].response?.run_id);
  assert(ack);
  const runId = ack[4].response.run_id;
  const states = frames.filter((frame) => frame[3] === "agent_run_state" && frame[4].run_id === runId).map((frame) => frame[4]);
  const terminal = states.at(-1);
  assert.equal(terminal.status, "completed");
  assert.equal(terminal.profile_ref, "judgment_plan_v1");
  assert.equal(terminal.consumed_budget.provider_calls, totalCalls);
  assert.equal(terminal.consumed_budget.tool_calls, 2);
  assert.equal(terminal.consumed_budget.replans, revisionCount);
  const scopedCalls = calls.filter((row) => row.work_id === evidence.work_id && row.session_id === evidence.session_id && (row.turn_id === parent || row.turn_id?.startsWith(`${parent}:`)));
  assert.equal(scopedCalls.length, totalCalls, "实际 provider 请求必须与预算一致");
  const names = (row) => row.tools.map((tool) => tool.name);
  assert.equal(scopedCalls.filter((row) => names(row).includes("judgment_decision")).length, 1);
  assert.equal(scopedCalls.filter((row) => names(row).length === 1 && names(row)[0] === "agent_plan_draft").length, draftCount);
  assert.equal(scopedCalls.filter((row) => names(row).length === 1 && names(row)[0] === "agent_plan_revision").length, revisionCount);
  for (const call of scopedCalls.filter((row) => names(row).length > 0)) assert.equal(call.tool_choice, "auto");
  // 两个原生窗口订阅可收到同一广播；按真实 event id 去重，不把副本算成新执行。
  const events = [...new Map(frames.filter((frame) => frame[3] === "agent_event" && frame[4].run_ref === runId)
    .map((frame) => [frame[4].event_id, frame[4]])).values()];
  const drafts = events.filter((event) => event.event_type === "plan_drafted");
  const revisions = events.filter((event) => event.event_type === "plan_revised");
  assert.equal(drafts.length, 1);
  assert.equal(revisions.length, revisionCount);
  const finalSteps = (revisions.at(-1) || drafts[0]).payload.plan_steps;
  assert(finalSteps.length >= 3);
  assert.deepEqual(finalSteps.filter((step) => step.kind === "act").map((step) => step.target_tool_ref), ["character_design", "world_building"]);
  if (revisionCount) {
    assert.equal(drafts[0].payload.plan_steps.length, 1);
    // 修订不得改写已完成前缀的定义字段；status 是 run 内执行态（active → done），
    // 由完成标记推进而非修订改写，单独钉 done，不参与定义字段逐字节比较。
    const stepDefinition = ({ status, ...definition }) => definition;
    assert.deepEqual(stepDefinition(finalSteps[0]), stepDefinition(drafts[0].payload.plan_steps[0]), "修订不得改写已完成前缀");
    assert.equal(finalSteps[0].status, "done", "已完成前缀在修订后保持 done");
  }
  if (draftCount === 0) {
    const judgment = events.find((event) => event.event_type === "judgment_decided");
    assert(judgment);
    assert.equal(drafts[0].payload.author_narrative_source.provider_call_ref, judgment.payload.author_narrative_source.provider_call_ref);
    assert.equal(drafts[0].payload.author_narrative_source.provider_output_ref, judgment.payload.author_narrative_source.provider_output_ref);
  }
  const outputs = snapshot.transcript.filter((row) => row.role === "assistant" && row.agent_run_id === runId && row.turn_result).map((row) => row.turn_result);
  const pending = outputs.flatMap((result) => result.adoption_state?.pending || []);
  assert(pending.length >= 2);
  assert.equal(new Set(pending.map((item) => item.artifact_id)).size, pending.length);
  for (const result of outputs) assert.equal(result.truthfulness.production_write_performed, false);
  const scopedLog = logs.filter((row) => row.turn_id === parent || row.turn_id?.startsWith(`${parent}:`));
  assert(scopedLog.filter((row) => row.event === "toolbox.execute.done").length >= 2);
  assert(scopedLog.filter((row) => row.event === "orchestrator.decide.done").length >= 2);
  cases[mode] = { parent_turn_id: parent, run_id: runId, provider_calls: totalCalls, independent_drafts: draftCount,
    revisions: revisionCount, pending_artifact_refs: pending.map((item) => item.artifact_id) };
}
assert(!wire.some((row) => row.direction === "sent" && row.frame?.[3] === "author_action"), "计划验收不能自动采纳");
assert.equal(snapshot.resolved_adoptions.length, 0);
fs.writeFileSync(path.join(dir, "verified-session.json"), JSON.stringify(snapshot, null, 2));
fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify({slice_id: "judgment-plan-multi-step", surface: "tauri",
  driver: evidence.driver, verified_at: new Date().toISOString(), harness_run_ref: ready.run_ref, cases,
  screenshots: evidence.screenshots, assertions: ["same_response_plan_source", "independent_draft_auto", "revision_preserves_completed_prefix", "actual_request_counts", "real_orchestrator_tools", "pending_only_after_reopen"]}, null, 2));
console.log("native-plan: 同响应计划、独立起草、耗尽修订与待采纳持久结果对账通过");
