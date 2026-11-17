// R01 manifest 纯约束测试：不读文件/DB。
import assert from "node:assert/strict";
import test from "node:test";
import {
  LENGTHS,
  MANIFEST_SCHEMA,
  prefixComparison,
  tokenAggregate,
  validateManifest,
} from "./request_cost_manifest.mjs";
import {
  historyManifest,
  manifestTarget,
  nativeManifest,
} from "./fixtures/request_cost_manifest_fixture.mjs";

const base = historyManifest();


test("manifest：history 通过；native 缺 snapshot/未冻结/错 lengths 拒绝", () => {
  assert.equal(validateManifest(base).ok, true);
  assert.throws(() => validateManifest({ ...base, frozen: false }), /frozen/);
  assert.throws(() => validateManifest({ ...base, mode: "native" }), /target|work_id|snapshot/);
  assert.throws(() => validateManifest({ ...base, lengths: [3, 10] }), /lengths/);
  assert.throws(() => validateManifest({ ...base, mode: "unknown" }), /mode/);
  for (const id of ["   ", 1, null]) {
    assert.throws(() => validateManifest({ ...base, id }), /id/, String(id));
  }
  for (const turn_timeout_ms of [0, -1, 1.5, "1", undefined]) {
    assert.throws(
      () => validateManifest({ ...base, budget: { ...base.budget, turn_timeout_ms } }),
      /budget.turn_timeout_ms/,
      String(turn_timeout_ms),
    );
  }
  for (const expected_lines of [0, -1, 1.5, "1"]) {
    assert.throws(
      () => validateManifest({
        ...base,
        source: { ...base.source, expected_lines },
        authors: [],
      }),
      /expected_lines/,
      String(expected_lines),
    );
  }
  for (const line of [0, 2, 1.5]) {
    assert.throws(
      () => validateManifest({ ...base, authors: [{ ...base.authors[0], line }] }),
      /author.line/,
      String(line),
    );
  }
  assert.throws(
    () => validateManifest({ ...base, authors: [{ ...base.authors[0], message_index: -1 }] }),
    /message_index/,
  );
  assert.throws(
    () => validateManifest({
      ...base,
      authors: [{ ...base.authors[0] }, { ...base.authors[0], id: "b" }],
    }),
    /位置重复/,
  );
});

test("native 合法输入接受；路径/身份/冻结/重复 ID 全部拒绝", () => {
  const target = manifestTarget();
  const native = nativeManifest(target);
  assert.equal(validateManifest(native).ok, true);
  assert.throws(() => validateManifest({ ...native, snapshot: undefined }), /snapshot/);
  assert.throws(() => validateManifest({ ...native, runtime: undefined }), /runtime/);
  assert.throws(
    () => validateManifest({ ...native, model: { ...native.model, thinking: "disabled" } }),
    /thinking/,
  );
  assert.throws(
    () => validateManifest({ ...native, model: { ...native.model, max_tokens: 0 } }),
    /max_tokens/,
  );
  assert.throws(
    () => validateManifest({ ...native, model: { ...native.model, timeout_ms: 0 } }),
    /timeout_ms/,
  );
  assert.throws(
    () => validateManifest({ ...native, model: { ...native.model, context_window: 32_000 } }),
    /context_window/,
  );
  assert.throws(
    () => validateManifest({ ...native, runtime: { ...native.runtime, sync_summary_maintenance: true } }),
    /sync_summary_maintenance/,
  );
  assert.throws(
    () => validateManifest({ ...native, runtime: { ...native.runtime, auto_maintenance: { enabled: false, keep_recent_items: 4 } } }),
    /auto_maintenance/,
  );
  assert.throws(() => validateManifest({ ...native, snapshot: { ...native.snapshot, content_sha256: "z".repeat(64) } }), /content_sha256/);
  assert.throws(
    () => validateManifest({ ...native, snapshot: { ...native.snapshot, business_content_sha256: "z".repeat(64) } }),
    /business_content_sha256/,
  );
  assert.throws(() => validateManifest({ ...native, seed: { ...native.seed, work_id: " " } }), /work_id/);
  assert.throws(() => validateManifest({ ...native, seed: { ...native.seed, title: "有 空格" } }), /空格/);
  assert.throws(() => validateManifest({ ...native, authors: [{ ...base.authors[0], target: undefined }] }), /target/);
  assert.throws(() => validateManifest({ ...native, authors: [{ ...base.authors[0], target: { ...target, id: " " } }] }), /target.id/);
  assert.throws(() => validateManifest({ ...native, authors: [{ ...base.authors[0], target: { ...target, review_focus: [] } }] }), /review_focus/);
  assert.throws(() => validateManifest({ ...native, snapshot: { ...native.snapshot, dir: "/tmp/x" } }), /绝对/);
  assert.throws(() => validateManifest({ ...native, snapshot: { ...native.snapshot, dir: "artifacts/model-contracts/b87-r01/../evil" } }), /\.\./);
  assert.throws(() => validateManifest({ ...native, snapshot: { ...native.snapshot, dir: "artifacts/model-contracts/b87-r01-evil/x" } }), /必须在/);
  assert.throws(() => validateManifest({ ...native, snapshot: { ...native.snapshot, dir: "artifacts/model-contracts/b87-r01/x" } }), /source-snapshot/);

  for (const bad of [null, [], 1, "x"]) {
    assert.throws(() => validateManifest(bad), /对象/, String(bad));
  }
  for (const [key, value] of [["schema", "other"], ["id", "   "], ["id", 1], ["mode", "other"], ["mode", 1], ["frozen", 1], ["frozen", "true"]]) {
    assert.throws(() => validateManifest({ ...base, [key]: value }), new RegExp(key), `${key}=${value}`);
  }
  for (const bad of ["a".repeat(63), "g".repeat(64), 1, null, "A".repeat(64)]) {
    assert.throws(
      () => validateManifest({ ...base, source: { ...base.source, sha256: bad } }),
      /source.sha256/,
      String(bad),
    );
  }
  assert.throws(() => validateManifest({ ...base, source: { ...base.source, llm_log: "../x" } }), /\.\./);
  assert.throws(() => validateManifest({ ...base, evidence: { root: "artifacts/../x" } }), /\.\./);
  assert.throws(() => validateManifest({ ...base, evidence: { root: "/artifacts/x" } }), /绝对/);
  assert.throws(() => validateManifest({ ...base, seed: { ...base.seed, script: "/tmp/seed.exs" } }), /绝对/);
  assert.throws(() => validateManifest({ ...base, seed: { ...base.seed, script: ".." } }), /\.\./);
  for (const model of [
    { ...base.model, provider: "other" },
    { ...base.model, model: "  " },
    { ...base.model, context_window: 0 },
    { ...base.model, context_window: 1.5 },
    { ...base.model, context_window: 1 },
  ]) {
    if (model.context_window === 1) assert.equal(validateManifest({ ...base, model }).ok, true);
    else assert.throws(() => validateManifest({ ...base, model }), /model/);
  }
  assert.equal(validateManifest({ ...base, source: { ...base.source, expected_lines: 1 }, authors: [{ ...base.authors[0], line: 1, message_index: 0 }] }).ok, true);
  assert.throws(() => validateManifest({ ...base, budget: { ...base.budget, max_harness_retries: 1 } }), /max_harness_retries/);
  assert.throws(() => validateManifest({ ...base, authors: [{ ...base.authors[0], id: "same" }, { ...base.authors[0], id: "same", line: 2 }] }), /author.id 重复/);
  assert.throws(() => validateManifest({ ...base, lengths: [3, 3, 10, 20] }), /lengths/);
  assert.throws(() => validateManifest({ ...base, lengths: "3,10,20" }), /lengths/);
  assert.throws(() => validateManifest({ ...base, authors: [] }), /authors 不能为空/);
  assert.throws(() => validateManifest({ ...base, authors: "not-array" }), /authors 不能为空/);
});

function successorManifest() {
  return {
    ...nativeManifest(),
    schema: "b87-r01-request-cost-manifest/v2",
    source: { kind: "preregistered_author_inputs", path: "scripts/lib/native_ui/fixtures/discussions.json",
      sha256: "a".repeat(64), expected_turns: 20 },
    authors: Array.from({ length: 20 }, (_, index) =>
      ({ id: "discussion-" + index, input_index: index, sha256: "b".repeat(64) })),
    successor_observation: {
      source: { path: "scripts/lib/native_ui/fixtures/successor.json", sha256: "c".repeat(64), expected_turns: 1 },
      author: { id: "successor", sha256: "d".repeat(64) },
      lengths: [10, 20], count: 1,
    },
  };
}

test("v2明确冻结唯一后继；旧v1不静默增加输入", () => {
  const manifest = successorManifest();
  assert.equal(validateManifest(manifest).ok, true);
  const old = structuredClone(manifest);
  old.schema = "b87-r01-request-cost-manifest/v1";
  delete old.successor_observation;
  assert.equal(validateManifest(old).ok, true);
  old.successor_observation = structuredClone(manifest.successor_observation);
  assert.throws(() => validateManifest(old), /successor_observation/);
  for (const mutate of [
    value => delete value.successor_observation,
    value => value.mode = "history",
    value => value.source = structuredClone(base.source),
    value => value.successor_observation.extra = true,
    value => value.successor_observation.count = 2,
    value => value.successor_observation.count = "1",
    value => value.successor_observation.lengths = [3, 10, 20],
    value => value.successor_observation.lengths = [20, 10],
    value => value.successor_observation.lengths = [10, 10, 20],
    value => value.successor_observation.source.expected_turns = 2,
    value => value.successor_observation.source.expected_turns = "1",
    value => value.successor_observation.source.kind = "other",
    value => value.successor_observation.source.path = "../successor.json",
    value => value.successor_observation.source.path = "/tmp/successor.json",
    value => value.successor_observation.source.sha256 = "bad",
    value => value.successor_observation.author.sha256 = "bad",
    value => value.successor_observation.author.input_index = 0,
    value => value.successor_observation.author.id = value.authors[0].id,
    value => value.successor_observation.author.id = "",
  ]) {
    const bad = structuredClone(manifest); mutate(bad);
    assert.throws(() => validateManifest(bad), undefined, mutate.toString());
  }
});

test("prefix/token 聚合边界", () => {
  assert.equal(prefixComparison([{ a: 1 }], [{ a: 1 }, { b: 2 }]).kind, "append");
  assert.equal(prefixComparison([{ a: 1 }, { b: 2 }], [{ a: 1 }]).kind, "compressed");
  assert.equal(prefixComparison([{ a: 9 }], [{ a: 1 }]).kind, "rewritten");
  assert.equal(prefixComparison([], []).kind, "append");
  const agg = tokenAggregate(
    [
      { usage: { input_tokens: 0 } },
      { usage: { input_tokens: null } },
      { analysis: { usage: { input_tokens: 3 } } },
      { analysis: null, usage: { input_tokens: 4 } },
      { analysis: { usage: false }, usage: { input_tokens: 5 } },
    ],
    "input_tokens",
  );
  assert.deepEqual(agg, { known_sum: 7, known_calls: 3, missing_calls: 2, total: null });
  assert.deepEqual(
    tokenAggregate([{ usage: { input_tokens: 0 } }, { analysis: { usage: null } }], "input_tokens"),
    { known_sum: 0, known_calls: 1, missing_calls: 1, total: null },
  );
  assert.equal(tokenAggregate([{ analysis: null, usage: null }], "input_tokens").missing_calls, 1);
});
