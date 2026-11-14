// B87 R01 manifest 纯约束：冻结模式、source/snapshot/作者/模型/预算字段校验。
// 不做文件读取、不查询 DB；文件 hash/快照内容由 capture 边界核对。
import assert from "node:assert/strict";
import path from "node:path";
import { stableJson } from "./request_cost_evidence.mjs";
import { assertManifestRuntime } from "./request_cost_runtime_recipe.mjs";

export const MANIFEST_SCHEMA = "b87-r01-request-cost-manifest/v1";
export const LENGTHS = Object.freeze([3, 10, 20]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonBlank = (value) => typeof value === "string" && value.trim() !== "";
const list = (value) => (Array.isArray(value) ? value : []);

export function prefixComparison(previous, next) {
  const left = list(previous);
  const right = list(next);
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    if (stableJson(left[index]) !== stableJson(right[index])) return { kind: "rewritten", shared };
  }
  if (left.length === right.length) return { kind: "append", shared };
  const kind = ["append", "append", "compressed"][Math.sign(left.length - right.length) + 1];
  return { kind, shared };
}

function assertSha(value, label) {
  assert(typeof value === "string" && /^[a-f0-9]{64}$/u.test(value), `${label} 必须是 64 位 sha256`);
}

function assertFilePath(value, label) {
  assert(nonBlank(value), `${label} 不能为空`);
  assert(!value.includes("\0"), `${label} 不能含 NUL`);
  assert(!value.split(/[\\/]/u).some((part) => part === "." || part === ".."), `${label} 不能含 . 或 .. 越界`);
}

function assertRelativePath(value, label, prefix = null) {
  assert(nonBlank(value), `${label} 不能为空`);
  assert(!path.posix.isAbsolute(value), `${label} 不能是绝对路径`);
  assert(!value.includes("\0"), `${label} 不能含 NUL`);
  assert(!value.split("/").some((part) => part === "." || part === ".."), `${label} 不能含 . 或 .. 越界`);
  assert(path.posix.normalize(value) === value, `${label} 不能含 . 或 .. 越界`);
  if (prefix !== null) assert(value.startsWith(prefix), `${label} 必须在 ${prefix} 下`);
}

export function validateManifest(manifest) {
  assert(isObject(manifest), "manifest 必须是对象");
  assert.equal(manifest.schema, MANIFEST_SCHEMA, `manifest schema 必须是 ${MANIFEST_SCHEMA}`);
  assert(nonBlank(manifest.id), "manifest id 不能为空");
  assert.equal(manifest.frozen, true, "manifest 必须 frozen=true 才能进入测量");
  assert(["history", "native"].includes(manifest.mode), "manifest.mode 必须是 history|native");
  validateSource(manifest.source);
  const native = manifest.mode === "native";
  validateAuthors(manifest.authors, manifest.source.expected_lines, native);
  assert(
    Array.isArray(manifest.lengths) &&
      manifest.lengths.length === LENGTHS.length &&
      LENGTHS.every((length) => manifest.lengths.includes(length)),
    `manifest.lengths 必须是 ${LENGTHS.join("/")}`,
  );
  validateModel(manifest.model, native);
  validateSeed(manifest.seed, native);
  assert(isObject(manifest.budget), "manifest 缺少 budget");
  assertPositiveInteger(manifest.budget.turn_timeout_ms, "manifest.budget.turn_timeout_ms");
  assert.equal(manifest.budget.max_harness_retries, 0, "max_harness_retries 必须为 0");
  if (native) {
    assert(isObject(manifest.runtime), "native manifest 缺少 runtime");
    assertNonBlank(manifest.runtime.profile, "manifest.runtime.profile");
    assertManifestRuntime(manifest);
    assert(isObject(manifest.snapshot), "native manifest 缺少 snapshot");
    assertSha(manifest.snapshot.source_sha256, "manifest.snapshot.source_sha256");
    assertSha(manifest.snapshot.work_sha256, "manifest.snapshot.work_sha256");
    assertSha(manifest.snapshot.content_sha256, "manifest.snapshot.content_sha256");
    assertSha(
      manifest.snapshot.business_content_sha256,
      "manifest.snapshot.business_content_sha256",
    );
    if (manifest.snapshot.reference_logs !== undefined) {
      assert(isObject(manifest.snapshot.reference_logs), "manifest.snapshot.reference_logs 必须是对象");
      assertPositiveInteger(
        manifest.snapshot.reference_logs.count,
        "manifest.snapshot.reference_logs.count",
      );
      assertSha(
        manifest.snapshot.reference_logs.sha256,
        "manifest.snapshot.reference_logs.sha256",
      );
    }
    assertRelativePath(
      manifest.snapshot.dir,
      "manifest.snapshot.dir",
      "artifacts/model-contracts/b87-r01/",
    );
    assert(
      manifest.snapshot.dir.includes("/source-snapshot/"),
      "manifest.snapshot.dir 必须指向 source-snapshot 完整副本",
    );
  }
  assert(isObject(manifest.evidence), "manifest 缺少 evidence");
  assertRelativePath(manifest.evidence.root, "manifest.evidence.root", "artifacts/");
  return { ok: true, manifest };
}

function validateSource(source) {
  assert(isObject(source), "manifest 缺少 source");
  assertFilePath(source.llm_log, "manifest.source.llm_log");
  assertFilePath(source.app_log, "manifest.source.app_log");
  assertSha(source.sha256, "manifest.source.sha256");
  assertSha(source.app_sha256, "manifest.source.app_sha256");
  assert(
    Number.isInteger(source.expected_lines) && source.expected_lines > 0,
    "manifest.source.expected_lines 必须是正整数",
  );
}

function validateTarget(target, label) {
  assert(isObject(target), `${label} 必须是对象`);
  assertNonBlank(target.id, `${label}.id`);
  assertNonBlank(target.question, `${label}.question`);
  assert(Array.isArray(target.review_focus) && target.review_focus.length > 0, `${label}.review_focus 不能为空`);
  for (const item of target.review_focus) assertNonBlank(item, `${label}.review_focus 项`);
}

function validateAuthors(authors, expectedLines, native) {
  assert(Array.isArray(authors) && authors.length > 0, "manifest.authors 不能为空");
  const seen = new Set();
  const ids = new Set();
  for (const author of authors) {
    assert(isObject(author), "manifest.authors 项必须是对象");
    assert(nonBlank(author.id), "author.id 不能为空");
    assert(!ids.has(author.id), `author.id 重复: ${author.id}`);
    ids.add(author.id);
    assert(Number.isInteger(author.line), "author.line 必须是整数");
    assert(author.line >= 1 && author.line <= expectedLines, `author.line 越界: ${author.line}`);
    assert(
      Number.isInteger(author.message_index) && author.message_index >= 0,
      "author.message_index 非法",
    );
    assertSha(author.sha256, `author(${author.id}).sha256`);
    const key = `${author.line}:${author.message_index}`;
    assert(!seen.has(key), `author 位置重复: ${key}`);
    seen.add(key);
    if (native) validateTarget(author.target, `author(${author.id}).target`);
  }
}

function assertPositiveInteger(value, label) {
  assert(Number.isInteger(value) && value > 0, `${label} 必须是正整数`);
}

function assertNonBlank(value, label) {
  assert(nonBlank(value), `${label} 不能为空`);
}

function validateModel(model, native) {
  assert(isObject(model), "manifest 缺少 model");
  assert.equal(model.provider, "splash", "manifest.model.provider 必须是 splash");
  assertNonBlank(model.model, "manifest.model.model");
  assertNonBlank(model.reasoning_effort, "manifest.model.reasoning_effort");
  assertPositiveInteger(model.context_window, "manifest.model.context_window");
  if (native) {
    assert(["enabled", "disabled"].includes(model.thinking), "manifest.model.thinking 必须是 enabled|disabled");
    assertPositiveInteger(model.max_tokens, "manifest.model.max_tokens");
    assertPositiveInteger(model.timeout_ms, "manifest.model.timeout_ms");
  }
}

function validateSeed(seed, native) {
  assert(isObject(seed), "manifest 缺少 seed");
  assertRelativePath(seed.script, "manifest.seed.script");
  if (native) {
    assertNonBlank(seed.work_id, "manifest.seed.work_id");
    assertNonBlank(seed.title, "manifest.seed.title");
    assertNonBlank(seed.session_title, "manifest.seed.session_title");
    assert(!seed.title.includes(" "), "manifest.seed.title 不能含空格（seed.log 以空白分隔）");
    assert(!seed.session_title.includes(" "), "manifest.seed.session_title 不能含空格");
  }
}



export function knownNumberAggregate(values) {
  const known = values.filter((value) => Number.isInteger(value) && value >= 0);
  const knownSum = known.reduce((sum, value) => sum + value, 0);
  const missing = values.length - known.length;
  return {
    known_sum: knownSum,
    known_calls: known.length,
    missing_calls: missing,
    total: missing === 0 ? knownSum : null,
  };
}

export function tokenAggregate(calls, key) {
  return knownNumberAggregate(
    calls.map((call) => (call.analysis?.usage ?? call.usage)?.[key] ?? null),
  );
}