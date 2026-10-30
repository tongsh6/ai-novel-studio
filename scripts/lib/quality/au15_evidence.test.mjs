// B39 CP1d：AU-15 证据 sidecar 正反例（请求字节对账/准备判断/used refs 绑定）。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { buildAu15Evidence, parseLlmCalls } from "./au15_evidence.mjs";

const ROOT = path.resolve(import.meta.dirname, "../../..");

function callsWith(observationRef, include = true) {
  return [
    {
      model: "iq3_s",
      requestText: include
        ? `材料：${observationRef} 沈砚答应三天后回灯楼接顾青。`
        : "材料：本章只有既有摘要，没有读到承诺细节。",
    },
  ];
}

function driverLog({ scenario = "A1", observationRef = "observation:obs_1", continueExploration = true } = {}) {
  return {
    scenario,
    trace_summary: {
      request_base_refs: ["turn:t1", "execution_brief:第02章"],
      request_observation_refs: [observationRef],
      used_context_refs: [observationRef],
      unbound_context_refs: [],
      used_context_refs_validation: "ok",
    },
    preparation_events: [
      ...(continueExploration
        ? [{ status: "continue_exploration", tool: "chapter_read", query: "第01章" }]
        : []),
      { status: "ready_to_write", reason: continueExploration ? "observations_available" : "base_sufficient" },
    ],
    observations: [{ observation_id: "obs_1", summary: "沈砚答应三天后回灯楼接顾青。" }],
    zero_canon_write: true,
    artifact_bytes_unchanged: true,
  };
}

test("A1：请求字节含观察 ref/内容、used refs 绑定、准备判断 → mechanism pass / model observed", () => {
  const observationRef = "observation:obs_1";
  const evidence = buildAu15Evidence({
    scenario: "A1",
    driverLog: driverLog({ observationRef }),
    llmCalls: callsWith(observationRef),
    dbCounts: { receipts: 0, canon_delta: 0 },
  });
  assert.equal(evidence.schema, "au15-evidence-sidecar/v1");
  assert.equal(evidence.mechanism.status, "pass", JSON.stringify(evidence.mechanism.checks));
  assert.equal(evidence.model_behavior.status, "observed");
  assert.equal(evidence.provider_calls[0].observed_in_calls, true);
  assert.deepEqual(evidence.evidence_gaps, []);
});

test("负例：请求字节没有观察内容 → fail；A0 强制探索 → fail；used ref 越界 → fail", () => {
  const observationRef = "observation:obs_1";
  const noRequestContent = buildAu15Evidence({
    scenario: "A1",
    driverLog: driverLog({ observationRef }),
    llmCalls: callsWith(observationRef, false),
  });
  assert.equal(noRequestContent.mechanism.status, "fail");

  const a0Forced = buildAu15Evidence({
    scenario: "A0",
    driverLog: driverLog({ observationRef, continueExploration: true }),
    llmCalls: callsWith(observationRef),
  });
  assert.equal(a0Forced.mechanism.status, "fail");

  const log = driverLog({ observationRef });
  log.trace_summary.used_context_refs = ["chapter:not_visible"];
  log.trace_summary.unbound_context_refs = ["chapter:not_visible"];
  log.trace_summary.used_context_refs_validation = "partial";
  const outOfScope = buildAu15Evidence({
    scenario: "A1",
    driverLog: log,
    llmCalls: callsWith(observationRef),
  });
  assert.equal(outOfScope.mechanism.status, "fail");
});

test("parseLlmCalls 读取 request/response 字节与模型身份", () => {
  const parsed = parseLlmCalls(
    '[2026-10-30T00:00:00Z] {"request":{"body":{"messages":[{"role":"user","content":"观察：沈砚承诺"}]}},"response":{"body":{"model":"iq3_s","choices":[{"message":{"content":"ok"}}]}}}',
  );
  assert.equal(parsed.length, 1);
  assert.match(parsed[0].requestText, /沈砚承诺/u);
  assert.equal(parsed[0].model, "iq3_s");
});

test("CLI verify 读取 artifact 并写 sidecar", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "au15-evidence-"));
  fs.mkdirSync(path.join(dir, "llm-calls"));
  fs.writeFileSync(
    path.join(dir, "llm-calls/2026-10-30.jsonl"),
    `[2026-10-30T00:00:00Z] ${JSON.stringify({
      request: { body: { messages: [{ role: "user", content: "材料：observation:obs_1 沈砚承诺" }] } },
      response: { body: { model: "iq3_s" } },
    })}`,
  );
  fs.writeFileSync(path.join(dir, "au15-driver-log.json"), JSON.stringify(driverLog()));
  fs.writeFileSync(path.join(dir, "db-snapshot.json"), JSON.stringify({ receipts: 0, canon_delta: 0 }));
  execFileSync("node", [path.join(ROOT, "scripts/au15_evidence.mjs"), "verify", dir, "--scenario", "A1"], {
    encoding: "utf8",
  });
  const sidecar = JSON.parse(fs.readFileSync(path.join(dir, "au15-evidence-sidecar.json"), "utf8"));
  assert.equal(sidecar.mechanism.status, "pass");
  assert.equal(sidecar.model_behavior.observed_in_calls, 1);
});
