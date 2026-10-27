// B42 CP2：求证证据链（quality-evidence-chain/v1）的集合关系、顺序判定与历史
// artifact 只读测试。运行：node --test scripts/lib/quality/evidence_chain.test.mjs
//
// 真实验证资产（存在才跑；artifacts/ 已 gitignore，CI 缺失时跳过）：
// - artifacts/slice-verify/agentic-loop-plan-replan-reasoning-tauri/ui-frames.json
// - artifacts/slice-verify/p1-chapter-draft-generation-native/（原生实模 + llm-calls + app-log）
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BINDING_STATUSES,
  CREDITABLE_OUTCOMES,
  EVIDENCE_CHAIN_SCHEMA_VERSION,
  OBSERVATION_OUTCOMES,
  PREPARATION_OUTCOMES,
  STALE_ON_RESTORE_VALUES,
  buildEvidenceChain,
  classifyProvider,
  evaluateEvidenceChain,
  extractFrameEvidence,
  listEvidenceFiles,
  readArtifactEvidence,
  readLlmCalls,
  validateEvidenceChain,
  writeEvidenceChain,
} from "./evidence_chain.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const schema = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "quality/acceptance/evidence-schema.json"), "utf8"),
);
const CHAIN_SCHEMA = schema.$defs.evidence_chain;

function baseInput(overrides = {}) {
  return {
    run_ref: "run_1",
    scenario_id: "au15-a1-observation-binding",
    base_refs: ["base:chapter-3", "base:author-intent"],
    observations: [
      {
        observation_ref: "obs:promise",
        query: "沈砚答应几天后回灯楼",
        tool: "chapter_read",
        outcome: "observed",
        source_refs: ["chapter:3"],
        source_revision: "chapter-3@v7",
        coverage: { kind: "full", detail: "第3章全段" },
        observed_at: "2026-10-27T10:00:00Z",
      },
    ],
    provider_calls: [
      {
        provider_call_ref: "pcall:writer-1",
        at: "2026-10-27T10:00:05Z",
        turn_ref: "turn-1",
        provider: "strata",
        model: "iq3_s",
        actual_model: "strata",
      },
    ],
    used_context_refs: ["base:chapter-3", "chapter:3"],
    preparation_outcome: "ready",
    stale_on_restore: "none",
    replay_provider_called: false,
    ...overrides,
  };
}

// ---------- schema / 常量同源 ----------

test("schema $defs 与模块常量同源（quality-evidence-chain/v1）", () => {
  assert.equal(CHAIN_SCHEMA.properties.schema_version.const, EVIDENCE_CHAIN_SCHEMA_VERSION);
  assert.deepEqual(
    [...new Set([...CHAIN_SCHEMA.properties.observations.items.properties.outcome.enum])].sort(),
    [...OBSERVATION_OUTCOMES].sort(),
  );
  assert.deepEqual(
    [...CHAIN_SCHEMA.properties.preparation_outcome.enum].sort(),
    [...PREPARATION_OUTCOMES].sort(),
  );
  assert.deepEqual(
    [...CHAIN_SCHEMA.properties.stale_on_restore.enum].sort(),
    [...STALE_ON_RESTORE_VALUES].sort(),
  );
  assert.deepEqual([...CHAIN_SCHEMA.properties.binding.properties.binding_status.enum].sort(), [
    ...BINDING_STATUSES,
  ].sort());
  const required = new Set(CHAIN_SCHEMA.required);
  for (const key of ["base_refs", "observations", "used_context_refs", "observation_to_provider_call"]) {
    assert.ok(required.has(key), `schema 必须要求 ${key}`);
  }
});

test("provider 分类：确定性 / 真实 / 未知不得混淆", () => {
  assert.equal(classifyProvider("slice_verify"), "deterministic");
  assert.equal(classifyProvider("strata"), "real_model");
  assert.equal(classifyProvider("lmstudio"), "real_model");
  assert.equal(classifyProvider(""), "unknown");
  assert.equal(classifyProvider("some-vendor"), "unknown");
});

// ---------- 合法证据链 ----------

test("used ⊆ Base ∪ 实际观察且观察先于 provider 请求 → verified", () => {
  const chain = buildEvidenceChain(baseInput());
  assert.deepEqual(validateEvidenceChain(chain), []);
  assert.equal(chain.binding.binding_status, "verified");
  assert.deepEqual(chain.unbound_refs, []);
  assert.equal(chain.binding.real_observation_link_count, 1);
  assert.equal(chain.binding.used_bound_count, 2);
  assert.equal(chain.used_context_refs_status, "reported");
});

test("Base 已足够（零观察、无 used 自报告）→ partial，不伪报“确定未使用”", () => {
  const chain = buildEvidenceChain({
    base_refs: ["base:only"],
    observations: [],
    provider_calls: [],
    used_context_refs: null,
    preparation_outcome: "ready",
    stale_on_restore: "none",
  });
  assert.equal(chain.used_context_refs, null);
  assert.equal(chain.used_context_refs_status, "unknown");
  assert.ok(chain.binding.blockers.includes("used_context_refs_unknown"));
  assert.equal(chain.binding.binding_status, "partial");
  assert.equal(chain.binding.used_bound_count, 0);
});

// ---------- 越界与伪造 ----------

test("used 含 Base∪观察之外的 ref（Base 已记录）→ unbound_ref 违规", () => {
  const chain = buildEvidenceChain(
    baseInput({ used_context_refs: ["base:chapter-3", "chapter:99-never-read"] }),
  );
  assert.deepEqual(chain.unbound_refs, ["chapter:99-never-read"]);
  assert.equal(chain.binding.binding_status, "violated");
  assert.ok(chain.binding.reason_codes.includes("unbound_ref"));
});

test("Base 未记录时不得把无法判断的 ref 伪报成越界（记 unresolved）", () => {
  const chain = buildEvidenceChain(baseInput({ base_refs: null }));
  assert.deepEqual(chain.unbound_refs, []);
  assert.ok(chain.unresolved_refs.includes("base:chapter-3"), "Base 未记录时 Base ref 只能是 unresolved");
  assert.ok(!chain.unresolved_refs.includes("chapter:3"), "实际观察到的 ref 已有来源，不是 unresolved");
  assert.equal(chain.binding.binding_status, "unknown");
  assert.ok(chain.binding.blockers.includes("base_refs_unknown"));
});

test("supplied≠used：由 supplied refs 推导 used 视为违规", () => {
  const chain = buildEvidenceChain(
    baseInput({
      observations: [],
      provider_calls: [],
      supplied_refs: ["base:chapter-3"],
      used_context_refs: ["base:chapter-3"],
      used_context_refs_source: "inferred_supplied",
    }),
  );
  assert.equal(chain.binding.binding_status, "violated");
  assert.ok(chain.binding.reason_codes.includes("used_refs_inferred_from_supplied"));
});

test("未读取（error）ref 不得成为 used evidence", () => {
  const chain = buildEvidenceChain(
    baseInput({
      observations: [
        {
          observation_ref: "obs:failed-read",
          outcome: "error",
          source_refs: ["chapter:5"],
          observed_at: "2026-10-27T10:00:00Z",
        },
      ],
      used_context_refs: ["chapter:5"],
    }),
  );
  assert.equal(chain.binding.binding_status, "violated");
  assert.ok(chain.binding.reason_codes.includes("unread_ref_credited"));
});

test("stale 观察不得冒充当前事实", () => {
  const chain = buildEvidenceChain(
    baseInput({
      observations: [
        {
          observation_ref: "obs:stale",
          outcome: "stale",
          stale: true,
          source_refs: ["chapter:3"],
          observed_at: "2026-10-27T09:00:00Z",
        },
      ],
      stale_on_restore: "stale_detected",
      used_context_refs: ["chapter:3"],
    }),
  );
  assert.equal(chain.binding.binding_status, "violated");
  assert.ok(chain.binding.reason_codes.includes("stale_observation_credited"));
});

test("观察晚于后续 provider 请求 → observation_after_provider_call 违规", () => {
  const chain = buildEvidenceChain(
    baseInput({
      observations: [
        {
          observation_ref: "obs:late",
          outcome: "observed",
          source_refs: ["chapter:3"],
          source_revision: "v1",
          coverage: { kind: "full" },
          observed_at: "2026-10-27T10:05:00Z",
        },
      ],
      provider_calls: [
        {
          provider_call_ref: "pcall:before",
          at: "2026-10-27T10:00:00Z",
          provider: "strata",
          request_observation_refs: ["obs:late"],
        },
      ],
      used_context_refs: ["chapter:3"],
    }),
  );
  assert.equal(chain.binding.binding_status, "violated");
  assert.ok(chain.binding.reason_codes.includes("observation_after_provider_call"));
});

test("观察声称 observed 但没有真实来源 refs → observation_source_missing", () => {
  const chain = buildEvidenceChain(
    baseInput({
      observations: [
        {
          observation_ref: "obs:claim-no-source",
          outcome: "observed",
          source_refs: [],
          source_revision: "v1",
          coverage: { kind: "full" },
          observed_at: "2026-10-27T10:00:00Z",
        },
      ],
    }),
  );
  assert.ok(chain.binding.reason_codes.includes("observation_source_missing"));
  assert.equal(chain.binding.binding_status, "violated");
});

test("replay_provider_called=true 不得作为 replay 证据信用", () => {
  const chain = buildEvidenceChain(baseInput({ replay_provider_called: true }));
  assert.ok(chain.binding.reason_codes.includes("replay_provider_called"));
  assert.equal(chain.binding.binding_status, "violated");
});

test("观察没有 outcome/revision/coverage 元数据 → partial + 显式 blocker", () => {
  const chain = buildEvidenceChain(
    baseInput({
      observations: [{ observation_ref: "obs:bare", observed_at: "2026-10-27T10:00:00Z" }],
      used_context_refs: ["base:chapter-3"],
    }),
  );
  assert.ok(chain.binding.blockers.includes("observation_metadata_missing"));
  assert.equal(chain.binding.binding_status, "partial");
  assert.equal(chain.observations[0].metadata_missing, true);
});

test("观察未被任何后续真实 provider 请求引用 → observation_not_linked_to_provider_call", () => {
  const chain = buildEvidenceChain(
    baseInput({
      provider_calls: [
        {
          provider_call_ref: "pcall:deterministic",
          at: "2026-10-27T10:00:05Z",
          provider: "slice_verify",
        },
      ],
    }),
  );
  assert.ok(chain.binding.blockers.includes("observation_not_linked_to_provider_call"));
  assert.equal(chain.binding.real_observation_link_count, 0);
});

test("显式 request_observation_refs 关联优先于时间顺序", () => {
  const chain = buildEvidenceChain(
    baseInput({
      provider_calls: [
        {
          provider_call_ref: "pcall:writer-2",
          at: "2026-10-27T10:00:06Z",
          provider: "strata",
          request_observation_refs: ["obs:promise"],
        },
      ],
    }),
  );
  const link = chain.observation_to_provider_call.find(
    (item) => item.observation_ref === "obs:promise",
  );
  assert.equal(link.linked_by, "request_observation_ref");
  assert.equal(link.ordered, true);
  assert.equal(link.provider_real, true);
});

// ---------- 结构校验 ----------

test("validateEvidenceChain 拒绝非法版本/枚举/used 类型", () => {
  const chain = buildEvidenceChain(baseInput());
  assert.ok(validateEvidenceChain({ ...chain, schema_version: "quality-evidence-chain/v2" }).length > 0);
  assert.ok(
    validateEvidenceChain({
      ...chain,
      observations: [{ ...chain.observations[0], outcome: "maybe" }],
    }).some((error) => error.includes("outcome")),
  );
  assert.ok(
    validateEvidenceChain({ ...chain, used_context_refs: "not-array" }).some((error) =>
      error.includes("used_context_refs"),
    ),
  );
  assert.ok(
    validateEvidenceChain({ ...chain, preparation_outcome: "done" }).some((error) =>
      error.includes("preparation_outcome"),
    ),
  );
});

test("writeEvidenceChain 默认拒绝覆盖既有证据链（失败证据只增不删）", (t) => {
  const { mkdtempSync, rmSync } = fs;
  const dir = mkdtempSync(path.join(REPO_ROOT, "tmp", "evidence-chain-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const chain = buildEvidenceChain(baseInput());
  const written = writeEvidenceChain(dir, chain);
  assert.ok(fs.existsSync(written.path));
  assert.throws(() => writeEvidenceChain(dir, chain), /拒绝覆盖/);
  const again = writeEvidenceChain(dir, chain, { overwrite: true });
  assert.equal(again.ok, true);
});

// ---------- 历史真实 artifact（只读；缺失即跳过） ----------

const AGENTIC_LOOP_FRAMES = path.join(
  REPO_ROOT,
  "artifacts/slice-verify/agentic-loop-plan-replan-reasoning-tauri/ui-frames.json",
);
const P1_NATIVE_DIR = path.join(
  REPO_ROOT,
  "artifacts/slice-verify/p1-chapter-draft-generation-native",
);

test("真实 websocket frames：可抽取 observation_refs 与 self_report used refs", { skip: !fs.existsSync(AGENTIC_LOOP_FRAMES) }, () => {
  const evidence = readArtifactEvidence(path.dirname(AGENTIC_LOOP_FRAMES));
  assert.ok(evidence.files.frames.length >= 1);
  assert.ok(evidence.chain.observations.length > 0, "应抽取到 observation_refs");
  assert.ok(evidence.used_occurrences.length > 0, "应抽取到 self_report used_context_refs");
  assert.deepEqual(evidence.chain.unbound_refs, [], "历史证据不得被误判越界");
  // 历史 artifact 未记录 Base refs / outcome / revision → 只能是 unknown，不能 PASS。
  assert.equal(evidence.chain.binding.binding_status, "unknown");
  assert.ok(evidence.chain.binding.blockers.includes("base_refs_unknown"));
  assert.ok(evidence.chain.binding.blockers.includes("observation_metadata_missing"));
});

test("真实原生实模 artifact：观察→后续真实 provider 请求顺序可判，但缺 Base/元数据不得冒充 verified", { skip: !fs.existsSync(P1_NATIVE_DIR) }, () => {
  const evidence = readArtifactEvidence(P1_NATIVE_DIR, { base_refs: null });
  const files = listEvidenceFiles(P1_NATIVE_DIR);
  assert.ok(files.llm_calls.length >= 1, "应发现 llm-calls");
  assert.ok(evidence.real_provider_call_count >= 1, "应识别真实 provider 调用");
  assert.ok(evidence.chain.observations.length > 0, "应发现真实观察 refs");
  assert.equal(evidence.chain.base_refs_status, "unknown");
  assert.ok(evidence.chain.binding.real_observation_link_count >= 1, "观察必须先于后续真实 provider 请求");
  assert.equal(evidence.chain.binding.binding_status, "unknown");
  assert.ok(evidence.chain.used_context_refs.length > 0);
  assert.deepEqual(evidence.chain.unbound_refs, []);
  assert.ok(evidence.chain.unresolved_refs.length > 0, "Base 未记录时 used ref 只能是 unresolved，不是越界");
});

test("真实 llm-calls：provider/step/turn 与真实模型可回放身份可读", { skip: !fs.existsSync(P1_NATIVE_DIR) }, () => {
  const callsDir = path.join(P1_NATIVE_DIR, "run/llm-calls");
  const file = fs.readdirSync(callsDir).find((name) => name.endsWith(".jsonl"));
  assert.ok(file);
  const calls = readLlmCalls(path.join(callsDir, file));
  assert.ok(calls.length >= 1);
  const real = calls.filter((call) => call.real);
  assert.ok(real.length >= 1);
  assert.equal(real[0].provider, "strata");
  assert.ok(real[0].at, "provider call 必须带时间戳");
  assert.ok(real.some((call) => call.response_has_body), "真实响应正文可判定");
});

test("extractFrameEvidence 支持 native-transport 帧格式", { skip: !fs.existsSync(P1_NATIVE_DIR) }, () => {
  const file = path.join(P1_NATIVE_DIR, "run/native-transport.jsonl");
  if (!fs.existsSync(file)) {
    assert.ok(true);
    return;
  }
  const evidence = extractFrameEvidence({ file, relative: "run/native-transport.jsonl" });
  assert.ok(evidence.frames.length > 0);
  assert.ok(evidence.observations.length > 0);
  assert.ok(evidence.used_occurrences.length > 0);
});

test("真实 CREDITABLE 观察集合为闭集且 unknown 不在其中", () => {
  assert.ok(CREDITABLE_OUTCOMES.includes("observed"));
  assert.ok(CREDITABLE_OUTCOMES.includes("empty"));
  assert.ok(!CREDITABLE_OUTCOMES.includes("unknown"));
  assert.ok(!CREDITABLE_OUTCOMES.includes("error"));
  assert.ok(!CREDITABLE_OUTCOMES.includes("stale"));
});
