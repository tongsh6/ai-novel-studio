// B87 R01 纯规则回归：不申请 run scope、不建目录/DB，只消费内存事实与纯函数。
//
// 真实文件/日志/SQLite/CLI main 编排在邻接 `request_cost_capture_io.test.mjs`；本文件
// 保留 prefix、manifest 结构、调用身份、pcall、rebuildSnapshot 入参拒绝与请求参数
// 投影，避免把纯变异点绑到真实批次构造上。
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import preregisteredInputs from "../lib/native_ui/fixtures/r03-discussion-author-inputs.json" with { type: "json" };
import { nativeManifest } from "../lib/native_ui/fixtures/request_cost_manifest_fixture.mjs";
import {
  prefixComparison,
  validateManifest,
  validateAuthorInputs,
} from "../lib/native_ui/request_cost_manifest.mjs";
import {
  verifyCallIdentity,
  verifyPcall,
} from "../lib/native_ui/request_cost_batch_evidence.mjs";
import {
  rebuildSnapshot,
  requestSettingsFacts,
} from "../lib/native_ui/request_cost_capture.mjs";
import { historyCaptureManifest } from "../lib/native_ui/fixtures/request_cost_capture_fixture.mjs";


test("R03 manifest预注册来源严格引用20条原文，target与义务只有输入文件一份", () => {
  const input = structuredClone(preregisteredInputs);
  assert.equal(validateAuthorInputs(input), input);
  assert.throws(() => validateAuthorInputs({ ...input, turns: input.turns.slice(0, 19) }), /20条/u);
  const duplicate = structuredClone(input);
  duplicate.turns[1].id = duplicate.turns[0].id;
  assert.throws(() => validateAuthorInputs(duplicate), /id缺失或重复/u);
  const missingObligation = structuredClone(input);
  delete missingObligation.turns[0].obligations[0].requirement;
  assert.throws(() => validateAuthorInputs(missingObligation), /requirement/u);
  const manifest = nativeManifest();
  manifest.source = { kind: "preregistered_author_inputs",
    path: "scripts/lib/native_ui/fixtures/r03-discussion-author-inputs.json", sha256: "a".repeat(64), expected_turns: 20 };
  manifest.authors = input.turns.map((turn, index) => ({ id: turn.id, input_index: index, sha256: turn.sha256 }));
  assert.equal(validateManifest(manifest).ok, true);
  const wrongOrder = structuredClone(manifest);
  [wrongOrder.authors[0], wrongOrder.authors[1]] = [wrongOrder.authors[1], wrongOrder.authors[0]];
  assert.throws(() => validateManifest(wrongOrder), /原顺序/u);
  assert.throws(() => validateManifest({ ...manifest, source: { ...manifest.source, llm_log: "invented" } }), /不接受llm_log/u);
});

test("前缀比较区分追加/显式压缩/改写，不把压缩本身当伪造", () => {
  const a = { role: "user", content: "a" };
  const b = { role: "user", content: "b" };
  const c = { role: "user", content: "c" };
  assert.equal(prefixComparison([a, b], [a, b, c]).kind, "append");
  assert.equal(prefixComparison([a, b, c], [a, b]).kind, "compressed");
  assert.equal(prefixComparison([a, b], [a, c]).kind, "rewritten");
});

test("manifest 校验：未冻结、错误 source hash、错误 lengths 都拒绝", () => {
  const manifest = historyCaptureManifest({
    llmLog: "log/llm.jsonl",
    appLog: "log/app.jsonl",
  });
  assert.equal(validateManifest(manifest).ok, true);
  assert.throws(() => validateManifest({ ...manifest, frozen: false }), /frozen/);
  assert.throws(
    () => validateManifest({ ...manifest, source: { ...manifest.source, sha256: "x" } }),
    /sha256/,
  );
  assert.throws(() => validateManifest({ ...manifest, lengths: [3, 10] }), /lengths/);
});

test("verifyCallIdentity 错 session/work 都 fail", () => {
  const failures = [];
  const fail = (...args) => failures.push(args.join(":"));
  verifyCallIdentity({
    record: { session_id: "other", work_id: "other-work" },
    prefix: "p",
    config: { session_id: "session", work: { id: "work" } },
    fail,
  });
  assert.ok(failures.some((entry) => entry.includes("session_mismatch")));
  assert.ok(failures.some((entry) => entry.includes("work_mismatch")));
});

test("verifyPcall 缺 ref/重复 ref 都 fail", () => {
  const failures = [];
  const fail = (...args) => failures.push(args.join(":"));
  verifyPcall({ plan: { turn: 1 }, record: {}, callIndex: 0, seenPcalls: new Set(), fail });
  verifyPcall({ plan: { turn: 1 }, record: { provider_call_ref: "p1" }, callIndex: 0, seenPcalls: new Set(["p1"]), fail });
  assert.ok(failures.some((entry) => entry.includes("provider_call_ref_missing")));
  assert.ok(failures.some((entry) => entry.includes("duplicate_provider_call_ref")));
});

test("rebuildSnapshot 只接受冻结 v2 full，拒绝 stage/其它源", () => {
  // 错误 source 在 provenance 读取/snapshotPaths/outDir 创建前就拒绝；不申请临时环境。
  assert.throws(
    () => rebuildSnapshot({
      fullPath: "priv/ai_novel_studio_stage.db",
      outDir: "artifacts/model-contracts/b87-r01/20261113/source-snapshot/never-created",
    }),
    /快照源固定/,
  );
  assert.throws(
    () => rebuildSnapshot({
      fullPath: "artifacts/does-not-exist.sqlite3",
      outDir: "artifacts/model-contracts/b87-r01/20261113/source-snapshot/never-created-2",
    }),
    /快照源固定/,
  );
});

test("rebuildSnapshot 错误源在任何文件/provenance 读取前拒绝", () => {
  // 负控制不读真实文件：把所有同步文件入口替换为记录+抛错。干净副本没有冻结
  // metadata，若仍先读它就会在这里被捕获，而不是靠工作树私有文件掩盖。
  const touched = [];
  const names = [
    "existsSync",
    "readFileSync",
    "statSync",
    "lstatSync",
    "copyFileSync",
    "mkdirSync",
    "writeFileSync",
    "openSync",
    "readdirSync",
  ];
  const saved = names.map((name) => [name, fs[name]]);
  for (const name of names) {
    fs[name] = (file) => {
      touched.push(`${name}:${String(file)}`);
      throw new Error(`文件边界不应被触达: ${name} ${String(file)}`);
    };
  }
  try {
    assert.throws(
      () => rebuildSnapshot({
        fullPath: "artifacts/model-contracts/b87-r01/20261113/source-snapshot/not-frozen/full.sqlite3",
        outDir: "artifacts/model-contracts/b87-r01/20261113/source-snapshot/never-created-3",
      }),
      /快照源固定/,
    );
    assert.deepEqual(touched, [], "错误源必须在任何文件/provenance 读取前拒绝");
  } finally {
    for (const [name, fn] of saved) fs[name] = fn;
  }
});

test("requestSettingsFacts 保留按 step 的温度集合，不把 judgment 与 tool 统一", () => {
  const facts = requestSettingsFacts([
    { step: "judgment", request: { body: { model: "m", reasoning_effort: "high", max_tokens: 32000, temperature: 0.2 } } },
    { step: "tool.plot_outline", request: { body: { model: "m", reasoning_effort: "high", max_tokens: 32000, temperature: 0.7 } } },
    { step: "tool.plot_outline", request: { body: { model: "m", reasoning_effort: "high", max_tokens: 32000, temperature: 0.7 } } },
    {},
  ]);
  assert.deepEqual(facts.temperature_by_step, {
    judgment: [0.2],
    "tool.plot_outline": [0.7],
  });
  assert.deepEqual(facts.max_tokens, [32000]);
});
