#!/usr/bin/env node
/**
 * check_module_size.mjs 的正式测试（node --test scripts/check_module_size.test.mjs）。
 *
 * 覆盖窗口：百分位（仅报告参考）、观察名单判定、baseline 校验（ratchet/未登记/豁免/删除）、
 * baseline 生成（只降不升/新债拒绝/豁免优先）。
 * 不测「谁该被拆」——那是 review 的定性判断；机器只保证趋势不被恶化。
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_POLICY,
  buildBaseline,
  detectOutliers,
  percentile,
  validateBaseline,
} from "./check_module_size.mjs";

const policy = {
  prod: { outlier_floor: 500 },
  test: { outlier_floor: 800 },
};

function prod(path, lines, scope = "novel_application") {
  return { path, lines, scope, kind: "prod" };
}

function baselineOf(files = {}, exemptions = {}) {
  return { schema: "module-size-baseline/v1", policy, files, exemptions };
}

test("percentile 用 nearest-rank，空数组返回 null（仅供报告参考）", () => {
  assert.equal(percentile([], 90), null);
  assert.equal(percentile([10], 90), 10);
  assert.equal(percentile([10, 20, 30, 40, 50], 90), 50);
  assert.equal(percentile([50, 10, 40, 30, 20], 90), 50);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
});

test("detectOutliers：超过关注门槛的文件进入观察名单，未超过的不进", () => {
  const scan = [prod("a.ex", 100), prod("b.ex", 500), prod("c.ex", 501), prod("d.ex", 2000)];
  const group = detectOutliers(scan, policy).get("novel_application\u0000prod");
  assert.equal(group.floor, 500);
  assert.deepEqual([...group.outliers], ["c.ex", "d.ex"]);
});

test("detectOutliers：生产与测试用不同关注门槛，分组独立", () => {
  const scan = [
    prod("big.ex", 900),
    { path: "t700.exs", lines: 700, scope: "novel_application", kind: "test" },
    { path: "t900.exs", lines: 900, scope: "novel_application", kind: "test" },
    { path: "frontend/src/lib/x.ts", lines: 700, scope: "frontend", kind: "prod" },
  ];
  const groups = detectOutliers(scan, policy);
  assert.deepEqual([...groups.get("novel_application\u0000prod").outliers], ["big.ex"]);
  assert.deepEqual([...groups.get("novel_application\u0000test").outliers], ["t900.exs"]);
  assert.deepEqual([...groups.get("frontend\u0000prod").outliers], ["frontend/src/lib/x.ts"]);
});

test("percentile 只影响报告参考值，不影响观察名单判定", () => {
  // 两个文件：一个 900、一个 5000。P90=5000，但 900 仍因超过 floor 进入名单。
  const scan = [prod("a.ex", 900), prod("b.ex", 5000)];
  const group = detectOutliers(scan, policy).get("novel_application\u0000prod");
  assert.equal(group.p90, 5000);
  assert.deepEqual([...group.outliers], ["a.ex", "b.ex"]);
});

test("validateBaseline：ratchet 超限失败，并给出源头修法", () => {
  const scan = [prod("big.ex", 3600)];
  const result = validateBaseline(scan, baselineOf({ "big.ex": { lines: 3400, max_lines: 3400 } }));
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /ratchet：big\.ex 当前 3600 行 > 登记上限 3400 行/);
  assert.match(result.failures[0], /抽到新模块|拆分/);
});

test("validateBaseline：行数未增长即通过（只减不增）", () => {
  const scan = [prod("big.ex", 3400)];
  const result = validateBaseline(scan, baselineOf({ "big.ex": { lines: 3400, max_lines: 3400 } }));
  assert.deepEqual(result.failures, []);
});

test("validateBaseline：行数下降也通过（ratchet 只约束增长）", () => {
  const scan = [prod("big.ex", 3000)];
  const result = validateBaseline(scan, baselineOf({ "big.ex": { lines: 3400, max_lines: 3400 } }));
  assert.deepEqual(result.failures, []);
});

test("validateBaseline：出现新的未登记观察文件失败", () => {
  const scan = [prod("a.ex", 100), prod("new_big.ex", 900)];
  const result = validateBaseline(scan, baselineOf());
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /未登记：new_big\.ex/);
});

test("validateBaseline：豁免文件不再报未登记，也不受 ratchet 约束", () => {
  const scan = [prod("frontend/src/lib/copy.ts", 5000)];
  const result = validateBaseline(
    scan,
    baselineOf({}, { "frontend/src/lib/copy.ts": { reason: "UI 文案 SSOT", review_by: "2027-01-01" } }),
  );
  assert.deepEqual(result.failures, []);
  assert.equal(result.exemptionCount, 1);
});

test("validateBaseline：baseline 记录的文件消失只警告不失败", () => {
  const scan = [prod("small.ex", 100)];
  const result = validateBaseline(scan, baselineOf({ "gone.ex": { lines: 900, max_lines: 900 } }));
  assert.deepEqual(result.failures, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /已不存在：gone\.ex/);
});

test("validateBaseline：baseline 缺失或 schema 不符直接失败（工具输入边界，一次校验）", () => {
  assert.equal(validateBaseline([], null).failures.length, 1);
  assert.match(validateBaseline([], null).failures[0], /baseline 缺失或 schema 不符/);
  assert.equal(validateBaseline([], { schema: "other/v1" }).failures.length, 1);
});

test("buildBaseline 首次生成：登记全部当前观察文件，max_lines = 当前行数", () => {
  const scan = [prod("a.ex", 100), prod("b.ex", 700), prod("c.ex", 2000), prod("d.ex", 3000)];
  const { baseline, unregistered } = buildBaseline(scan, null, {
    policy,
    now: new Date("2026-11-03T00:00:00Z"),
  });
  assert.deepEqual(unregistered, []);
  assert.deepEqual(Object.keys(baseline.files).sort(), ["b.ex", "c.ex", "d.ex"]);
  assert.equal(baseline.files["b.ex"].max_lines, 700);
  assert.equal(baseline.files["d.ex"].max_lines, 3000);
});

test("buildBaseline 更新：max_lines 取 min（只降不升），并清理消失文件", () => {
  const scan = [prod("c.ex", 1800), prod("d.ex", 3100)];
  const previous = baselineOf({
    "c.ex": { lines: 2000, max_lines: 2000 },
    "d.ex": { lines: 3000, max_lines: 3000 },
    "gone.ex": { lines: 5000, max_lines: 5000 },
  });
  const { baseline } = buildBaseline(scan, previous, { registerNew: true });
  assert.equal(baseline.files["c.ex"].max_lines, 1800); // 降
  assert.equal(baseline.files["d.ex"].max_lines, 3000); // 当前 3100 > 3000，保持下限等待修复
  assert.equal(baseline.files["gone.ex"], undefined); // 清理
});

test("buildBaseline 更新：出现未登记新观察文件时拒绝写入（未传 registerNew）", () => {
  const scan = [prod("old.ex", 900), prod("new.ex", 5000)];
  const previous = baselineOf({ "old.ex": { lines: 900, max_lines: 900 } });
  const { unregistered } = buildBaseline(scan, previous, { registerNew: false });
  assert.deepEqual(
    unregistered.map((item) => item.filePath),
    ["new.ex"],
  );
});

test("buildBaseline：exemption 文件不进入 files（豁免优先于登记）", () => {
  const scan = [prod("a.ex", 100), prod("big.ex", 2000), prod("copy.ts", 5000)];
  const previous = baselineOf({}, { "copy.ts": { reason: "聚合型文件" } });
  const { baseline } = buildBaseline(scan, previous, { registerNew: true });
  assert.equal(baseline.files["copy.ts"], undefined);
  assert.deepEqual(Object.keys(baseline.files).sort(), ["big.ex"]);
});

test("默认策略：生产关注门槛 500 / 测试 800，且不是 fail 红线", () => {
  assert.equal(DEFAULT_POLICY.prod.outlier_floor, 500);
  assert.equal(DEFAULT_POLICY.test.outlier_floor, 800);
  // 499 行文件既不进观察名单，也不产生任何失败。
  const scan = [prod("small.ex", 499)];
  const { failures } = validateBaseline(scan, baselineOf());
  assert.deepEqual(failures, []);
});
