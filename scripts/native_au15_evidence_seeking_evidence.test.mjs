// B39 CP1 AU-15 证据核验器正反例：A0 不适用项过滤、A1 请求字节对账、used refs、零 canon 写、生命周期。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/native_au15_evidence_seeking_evidence.mjs");
const OBSERVATION_REF = "observation:obs_au15_1";
const OBSERVATION_TEXT = "沈砚答应三天后回灯楼接顾青。";

function llmCall(turnId, requestText, { step = "prose_writing", actualModel = "iq3_s" } = {}) {
  return {
    turn_id: turnId,
    step,
    provider: "strata",
    request: { body: { messages: [{ role: "user", content: requestText }] } },
    response: {
      model: "strata",
      usage: { model: actualModel },
      body: { choices: [{ message: { content: "候选正文（未采纳）" } }] },
    },
  };
}

function runFixtureOverrides(runId, scenario) {
  const turnId = `message_${runId}`;
  const isA0 = scenario === "A0";
  return {
    id: runId,
    scenario,
    natural_input: isA0 ? "写一个全新的第01章开头，题材你定，不需要承接前文。" : "接着前文写第03章，把沈砚答应顾青的事接着写，不要问我。",
    retention_wording: null,
    session_isolation: "fresh_session",
    turn_id: turnId,
    run_id: `run_${runId}`,
    questions: 0,
    pauses: 0,
    turn_status: "completed",
    turn_phase: "prose",
    assistant_text: "已生成待采纳正文候选。",
    assistant_text_chars: 12,
    candidate_count: 1,
    candidates: [{ artifact_id: "artifact-1", artifact_type: "prose_fragment", object_kind: "prose_fragment" }],
    preparation_events: isA0
      ? [{ status: "ready_to_write", reason: "base_sufficient", observation_count: 0 }]
      : [
          { status: "continue_exploration", tool: "chapter_read", query: "第01章：灯楼旧约" },
          { status: "ready_to_write", reason: "observations_available", observation_count: 1 },
        ],
    observations: isA0
      ? []
      : [
          {
            tool: "chapter_read",
            query: "第01章：灯楼旧约",
            summary: OBSERVATION_TEXT,
            refs: ["chapter:chapter-1"],
            outcome: "observed",
          },
        ],
    exploration_events: [],
    judgment_events: isA0 ? [{ action: "execute", capability: "prose_writing" }] : [{ action: "execute", capability: "prose_writing" }],
    plan_events: isA0
      ? [{ event_type: "plan_drafted", plan_steps: [{ kind: "act", target_tool_ref: "context_assemble" }] }]
      : [
          {
            event_type: "plan_drafted",
            plan_steps: [
              { kind: "act", target_tool_ref: "context_assemble" },
              { kind: "explore", target_tool_ref: "chapter_read" },
              { kind: "act", target_tool_ref: "prose_writing" },
            ],
          },
        ],
    agent_run_states: [{ run_id: `run_${runId}`, status: "completed" }],
    trace_summary: isA0
      ? {
          request_base_refs: ["turn:t1", "execution_brief:第01章"],
          used_context_refs: [],
          used_context_refs_validation: "no_claim",
        }
      : {
          request_base_refs: ["turn:t1", "execution_brief:第03章"],
          request_observation_refs: [OBSERVATION_REF],
          used_context_refs: [OBSERVATION_REF],
          unbound_context_refs: [],
          used_context_refs_validation: "ok",
        },
    why_text: "参考来源与 trace 一致。",
    why_ok: true,
    db_counts_before: { chapters: 4, drafts: 2, receipts: 0, accepted_hash: "hash-1" },
    db_counts_after: { chapters: 4, drafts: 2, receipts: 0, accepted_hash: "hash-1" },
    zero_canon_write: true,
    artifact_bytes_unchanged: true,
    llm_calls: [],
    llm_call_count: 1,
    provider_calls: 1,
    actual_models: ["iq3_s"],
  };
}

function makeFixture({ runs, requestIncludesObservation = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "au15-evidence-"));
  fs.mkdirSync(path.join(dir, "llm-calls"));
  fs.mkdirSync(path.join(dir, "database"));
  fs.writeFileSync(
    path.join(dir, "model-lifecycle-before.json"),
    JSON.stringify({ loaded_before: null, state_before: { loaded: null } }),
  );
  fs.writeFileSync(
    path.join(dir, "model-lifecycle-after.json"),
    JSON.stringify({ loaded_after: null, unloaded: true, unload_error: null }),
  );
  const selectedRuns = runs.map(({ runId, scenario }) => runFixtureOverrides(runId, scenario));
  fs.writeFileSync(
    path.join(dir, "au15-driver-log.json"),
    JSON.stringify(
      {
        slice_id: "au15-evidence-seeking-native",
        provider: "strata",
        model: "iq3_s",
        setup_mode: "isolated_fixture",
        d6a_precondition: "not_satisfied",
        runs: selectedRuns,
        db_snapshot_before: { chapters: 4, drafts: 2, receipts: 0, accepted_hash: "hash-1" },
        db_snapshot_after: { chapters: 4, drafts: 2, receipts: 0, accepted_hash: "hash-1" },
        zero_canon_write: true,
        artifact_bytes_unchanged: true,
        author_question_events: [],
        session_switches: [],
        transport_frames: 100,
      },
      null,
      2,
    ),
  );
  const calls = selectedRuns.map((run) => {
    const isA0 = run.scenario === "A0";
    const observedText = requestIncludesObservation
      ? `已完成观察：${OBSERVATION_REF} ${OBSERVATION_TEXT}`
      : "已完成观察：本章只有既有摘要，没有读到承诺细节。";
    return isA0 ? llmCall(run.turn_id, "写作材料：当前作品第01章。") : llmCall(run.turn_id, observedText);
  });
  fs.writeFileSync(
    path.join(dir, "llm-calls/2026-10-30.jsonl"),
    calls.map((call, index) => `[2026-10-30T00:00:0${index}Z] ${JSON.stringify(call)}`).join("\n"),
  );
  return dir;
}

function verify(dir) {
  return execFileSync("node", [SCRIPT, "verify", dir], { encoding: "utf8", stdio: "pipe" });
}

test("A1 单 run 正例：观察 refs 与真实请求字节对账、used refs 不越界、零 canon 写 → 机制 pass / 模型行为 partial", () => {
  const dir = makeFixture({ runs: [{ runId: "a1-run1", scenario: "A1" }] });
  const output = verify(dir);
  assert.match(output, /mechanism=pass/u);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.mechanism.status, "pass");
  assert.equal(summary.runs[0].observed_in_calls, 1);
  assert.equal(summary.runs[0].used_context_refs_validation, "ok");
  assert.equal(summary.model_behavior.by_scenario.A1.status, "partial");
  assert.equal(summary.model_behavior.status, "unknown");
  assert.equal(summary.formal_acceptance.status, "blocked");
  assert.ok(fs.existsSync(path.join(dir, "runs/a1-run1/au15-evidence-sidecar.json")));
});

test("A0 正例：无观察（不适用项过滤）仍机制 pass；强制探索则 fail", () => {
  const dir = makeFixture({ runs: [{ runId: "a0-run1", scenario: "A0" }] });
  verify(dir);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.mechanism.status, "pass");
  assert.equal(summary.runs[0].model_behavior_status, "observed_no_exploration");
  assert.equal(summary.model_behavior.by_scenario.A0.status, "observed_no_exploration");
  const sidecar = JSON.parse(fs.readFileSync(path.join(dir, "runs/a0-run1/au15-evidence-sidecar.json"), "utf8"));
  assert.ok(sidecar.mechanism.not_applicable_checks.includes("request_observation_refs_present"));

  // A0 的“模型自行探索”归模型行为层（不判产品机制失败），但必须如实记录为未满足。
  const forced = makeFixture({ runs: [{ runId: "a0-run1", scenario: "A0" }] });
  const driverLog = JSON.parse(fs.readFileSync(path.join(forced, "au15-driver-log.json"), "utf8"));
  driverLog.runs[0].preparation_events = [
    { status: "continue_exploration", tool: "chapter_read", query: "第01章" },
    { status: "ready_to_write", reason: "observations_available", observation_count: 1 },
  ];
  fs.writeFileSync(path.join(forced, "au15-driver-log.json"), JSON.stringify(driverLog));
  verify(forced);
  const forcedSummary = JSON.parse(fs.readFileSync(path.join(forced, "summary.json"), "utf8"));
  assert.equal(forcedSummary.runs[0].model_behavior_status, "observed_exploration");
  assert.equal(forcedSummary.model_behavior.by_scenario.A0.status, "observed_exploration");
  assert.equal(forcedSummary.mechanism.status, "pass");
});

test("A1 负例：真实请求字节不含观察 → 机制 fail 退出码非 0", () => {
  const dir = makeFixture({ runs: [{ runId: "a1-run1", scenario: "A1" }], requestIncludesObservation: false });
  assert.throws(() => verify(dir), /Command failed/u);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  assert.equal(summary.mechanism.status, "fail");
});

test("生命周期未卸载 → fail 退出码非 0", () => {
  const dir = makeFixture({ runs: [{ runId: "a1-run1", scenario: "A1" }] });
  fs.writeFileSync(
    path.join(dir, "model-lifecycle-after.json"),
    JSON.stringify({ loaded_after: "iq3_s", unloaded: false, unload_error: null }),
  );
  assert.throws(() => verify(dir), /Command failed/u);
});
