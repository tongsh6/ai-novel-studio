// B84 A2 + B71 §16.9：逐调用证据的真实 SQLite 文件夹具读边界。
//
// 本文件只有两个真实 SQLite case。run scope 与不可变模板在文件入口的 `before`
// 一次申请/构造，`after` 关闭：case 只读共享模板或取自己的可写副本，绝不各自
// `openTestRunScope` 重建 run/DB。裸 `node --test` 该文件因此只构造一次模板。
//
// SQLite 模板由 `materializeFixture({name, inputs, build})` 在 run 内唯一构建：
// builder 用真实 `DatabaseSync` 文件方式创建 1 表 2 行，`finally` 关闭并以 DELETE
// journal 封存；模板只读、复用前校验完整文件集合与字节哈希。该 case 会追加一行
// wrong ownership 反例，因此通过 `createWorkingCopy` 使用自己的可写副本，模板和
// 另一副本都不受影响。真实消费者仍是 `readProviderRuns → joinNativeCallEvidence`。
//
// 共享 run 的可变资源只写本 case 独有叶子并显式回收；父 run 根/共享 work/tmp
// 不被清空。父 driver 写入的 sentinel 由外部进程在子进程退出后核对未修改。

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import {
  createWorkingCopy,
  fixtureTemplateHash,
  materializeFixture,
  openTestRunScope,
} from "../test_env.mjs";
import { joinNativeCallEvidence, readProviderRuns } from "./authoring_call_evidence.mjs";
import { base, scope, sseBase, sseExchange } from "./fixtures/authoring_call_fixture.mjs";
import {
  AUTHORING_CALL_DB_REL,
  authoringCallFixtureSpec,
} from "./fixtures/authoring_call_db_fixture.mjs";

let runScope;
let fixture;

before(() => {
  runScope = openTestRunScope();
  fixture = materializeFixture(authoringCallFixtureSpec(), { scope: runScope });
});

after(() => {
  runScope?.close();
});

function allPass(value) {
  assert.deepEqual(Object.values(value.checks), [true, true, true, true, true]);
}

function databaseDir(dir) {
  return path.join(dir, "database");
}

function templateDbFiles(fixture) {
  return fs.readdirSync(databaseDir(fixture.dir)).sort();
}

function assertTemplateSealed(fixture) {
  assert.deepEqual([...fixture.files.keys()], [AUTHORING_CALL_DB_REL]);
  assert.deepEqual(fs.readdirSync(fixture.dir).sort(), [".fixture-control.json", "database"]);
  assert.deepEqual(templateDbFiles(fixture), ["ai_novel_studio_test.sqlite3"]);
}

test("失败输出在同一只读快照按执行身份读取，缺失与冲突不补造", (t) => {
  const copy = createWorkingCopy(fixture, { scope: runScope, context: t });
  const db = new DatabaseSync(copy.files.get(AUTHORING_CALL_DB_REL));
  try {
    db.exec("CREATE TABLE provider_outputs (provider_run_id TEXT, provider_call_ref TEXT, agent_run_id TEXT, status TEXT)");
    db.prepare("UPDATE provider_runs SET status = 'failed' WHERE id = ?").run("prun-1");
    const input = sseBase();
    input.records = [sseExchange(1, { status: 0, body: "event_stream" })];
    input.transcript.messages = [];
    const inspect = () => joinNativeCallEvidence({
      ...input, providerRuns: readProviderRuns(copy.dir, scope()),
    });
    assert(inspect().failures.some((item) => item.reason === "missing"));
    db.prepare("INSERT INTO provider_outputs VALUES (?, ?, ?, ?)").run(
      "prun-1", "pcall-1", scope().run_id, "error");
    allPass(inspect());
    db.prepare("UPDATE provider_outputs SET status = 'ok'").run();
    assert(inspect().failures.some((item) => item.reason === "mismatched"));
  } finally {
    db.close();
    copy.cleanup();
  }
});

test("只读 SQLite 模板：DELETE 封存无辅助文件，真实 reader 读取且 hash 稳定", () => {
  assertTemplateSealed(fixture);
  const before = fixtureTemplateHash(fixture);

  const rows = readProviderRuns(fixture.dir, scope());
  assert.deepEqual(rows.map((row) => row.id), ["prun-1"]);
  assert.equal(rows[0].finite_mode_name, "standalone_operation");
  const joined = joinNativeCallEvidence({ ...base(), providerRuns: rows });
  allPass(joined);
  // VS-00L §6.4：验收读侧可报告受限模式；完整模式按缺省计数，不进入 PASS 判据。
  assert.deepEqual(joined.finite_modes, {
    restricted: [
      {
        provider_run_ref: "prun-1",
        provider_call_ref: "pcall-1",
        finite_mode_name: "standalone_operation",
      },
    ],
    complete_count: 0,
  });

  assert.equal(fixtureTemplateHash(fixture), before, "只读读取不得改动模板字节");
  assert.deepEqual(
    templateDbFiles(fixture),
    ["ai_novel_studio_test.sqlite3"],
    "DELETE 模板只读读取不得生成 -wal/-shm",
  );
});

test("两可写副本独立：wrong ownership 行被 reader+纯 join 拒绝，模板/父 marker/sentinel 不变", (t) => {
  const before = fixtureTemplateHash(fixture);
  const markerPath = path.join(runScope.dir, ".novel-test-run-owner.json");
  const markerBefore = fs.readFileSync(markerPath, "utf8");
  // 本 case 独有叶子：只回收自己的叶子与副本，不清空共享 tmp/work 修并发。
  const leaf = fs.mkdtempSync(path.join(runScope.tmpDir, "authoring-call-case-"));
  const sentinelPath = path.join(leaf, "borrow-sentinel.txt");
  fs.writeFileSync(sentinelPath, "sentinel\n");
  fs.chmodSync(sentinelPath, 0o644);
  const sentinelStat = fs.statSync(sentinelPath);
  let otherOwnerDir = "";
  try {
    // 同 run 可能有其他进程/用例的活跃副本；这里预建一个同 name 前缀的外部 owner
    // 资源，证明本 case 只回收 left/right/leaf，不做共享 workDir 的全量残留判断。
    otherOwnerDir = fs.mkdtempSync(
      path.join(runScope.workDir, `${fixture.name}-other-owner-`),
    );
    const otherOwnerSentinel = path.join(otherOwnerDir, "active-resource.txt");
    fs.writeFileSync(otherOwnerSentinel, "other-owner\n");

    const left = createWorkingCopy(fixture, { scope: runScope, context: t });
    const right = createWorkingCopy(fixture, { scope: runScope, context: t });
    assert.notEqual(left.dir, right.dir, "两个 case 必须各有可写副本");
    for (const copy of [left, right]) {
      assert.deepEqual([...copy.files.keys()], [AUTHORING_CALL_DB_REL]);
      assert.deepEqual(fs.readdirSync(copy.dir).sort(), ["database"]);
      assert.equal(
        fs.existsSync(path.join(copy.dir, ".fixture-control.json")),
        false,
        "控制记录不得进入工作副本",
      );
      assert.deepEqual(templateDbFiles({ dir: copy.dir }), ["ai_novel_studio_test.sqlite3"]);
    }

    const db = new DatabaseSync(left.files.get(AUTHORING_CALL_DB_REL));
    try {
      db.prepare(
        "INSERT INTO provider_runs (id, provider_call_ref, agent_run_id, workspace_id, work_id, session_id, parent_turn_ref, status, finite_mode_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        "prun-bad",
        "pcall-bad",
        scope().run_id,
        "workspace-other",
        scope().work_id,
        scope().session_id,
        scope().parent_turn_ref,
        "completed",
        null,
      );
    } finally {
      db.close();
    }

    const badRows = readProviderRuns(left.dir, scope());
    assert.equal(badRows.length, 2);
    const mismatched = joinNativeCallEvidence({ ...base(), providerRuns: badRows });
    assert.equal(mismatched.checks.native_call_pairs_owned, false);
    assert.equal(mismatched.checks.native_call_pairs_bound, false);
    assert.deepEqual(
      templateDbFiles({ dir: left.dir }),
      ["ai_novel_studio_test.sqlite3"],
      "可写副本关闭后不得留下 sidecar",
    );

    const rightRows = readProviderRuns(right.dir, scope());
    assert.equal(rightRows.length, 1, "另一副本不得看到本 case 追加行");
    allPass(joinNativeCallEvidence({ ...base(), providerRuns: rightRows }));

    assert.equal(fixtureTemplateHash(fixture), before, "case 写入不得污染只读模板");
    assert.equal(fs.readFileSync(markerPath, "utf8"), markerBefore, "借用父 marker 不变");
    assert.equal(fs.readFileSync(sentinelPath, "utf8"), "sentinel\n", "本 case sentinel 内容不变");
    assert.equal(
      fs.statSync(sentinelPath).mode & 0o777,
      sentinelStat.mode & 0o777,
      "本 case sentinel 权限不变",
    );

    left.cleanup();
    right.cleanup();
    assert.equal(fs.existsSync(left.dir), false, "case 后回收左副本");
    assert.equal(fs.existsSync(right.dir), false, "case 后回收右副本");
    assert.equal(
      fs.existsSync(otherOwnerDir),
      true,
      "本 case 的 cleanup 不得删除同 run 其他 owner 的活跃副本",
    );
    assert.equal(
      fs.readFileSync(otherOwnerSentinel, "utf8"),
      "other-owner\n",
      "其他 owner 的副本内容不得被本 case 触碰",
    );
  } finally {
    // 只清本测试自己模拟的 other owner 资源；SUT 的 left/right cleanup 未被允许碰它。
    if (otherOwnerDir) fs.rmSync(otherOwnerDir, { recursive: true, force: true });
    fs.rmSync(leaf, { recursive: true, force: true });
  }
  assert.equal(fs.existsSync(leaf), false, "本 case 独有叶子已明确回收");
});

test("成功输出摘要仅由显式消费者读取，缺失/重复/错run原事实保留且默认行为不变", (t) => {
  const copy = createWorkingCopy(fixture, { scope: runScope, context: t });
  const db = new DatabaseSync(copy.files.get(AUTHORING_CALL_DB_REL));
  try {
    db.exec("CREATE TABLE provider_outputs (provider_run_id TEXT, provider_call_ref TEXT, agent_run_id TEXT, status TEXT, content_summary TEXT)");
    const expected = { provider_run_id: "prun-1", provider_call_ref: "pcall-1",
      agent_run_id: scope().run_id, status: "ok",
      content_summary: '{"content_sha256":"8f5bd0e5429c4b64f4273f87c5338845af372dd17f87d96646e1e4d26a881c00"}' };
    const inspect = () => readProviderRuns(copy.dir, scope(), { includeOutputs: true });
    assert.deepEqual(inspect()[0].recorded_outputs, []);
    db.prepare("INSERT INTO provider_outputs VALUES (?, ?, ?, ?, ?)").run(...Object.values(expected));
    assert.deepEqual(inspect()[0].recorded_outputs.map(row => ({ ...row })), [expected]);
    assert.equal(Object.hasOwn(readProviderRuns(copy.dir, scope())[0], "recorded_outputs"), false);
    db.prepare("INSERT INTO provider_outputs VALUES (?, ?, ?, ?, ?)").run(
      "prun-1", "pcall-other", "run-other", "error", expected.content_summary);
    assert.equal(inspect()[0].recorded_outputs.length, 2, "reader 不选赢家或去重掩盖冲突");
    assert.equal(inspect()[0].recorded_outputs[1].agent_run_id, "run-other");
  } finally { db.close(); copy.cleanup(); }
});
