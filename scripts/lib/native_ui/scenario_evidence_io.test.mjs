// B61/B71 scenario 证据邻接 IO：真实 git 子进程产品指纹、capture/等待账/provider/
// common 证据目录与 10 表 SQLite 只读计数。模板由 `fixtures/scenario_evidence_io_fixture.mjs`
// 在 run 内按规格唯一物化（只读共享）；需要改文件的反例取 `withWorkingCopy` 隔离副本，
// 真实 git 仓库与指纹对照目录只落 run scope 的 work 区。纯帧/turn/broadcast 判定留在
// 邻接 `scenario_evidence.test.mjs`，不建目录/DB/子进程。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  PRODUCTION_TABLES,
  assertCommonEvidence,
  assertProviderAndWire,
  assertRecordFresh,
  assertWaitLedger,
  checkProductionFingerprint,
  productionFingerprint,
  productionTableCounts,
} from "./scenario_evidence.mjs";
import { materializeFixture, openTestRunScope, withWorkingCopy } from "../test_env.mjs";
import {
  PRODUCTION_DB_REL,
  commonBatchFixtureSpec,
  providerBatchFixtureSpec,
  recordFixtureSpec,
  productionDbFixtureSpec,
  waitLedgerFixtureSpec,
  writeProviderBatch,
  writeWaitLedger,
} from "./fixtures/scenario_evidence_io_fixture.mjs";

let runScope;

test.before(() => {
  runScope = openTestRunScope();
});

test.after(() => {
  runScope?.close();
});

function fixture(spec) {
  return materializeFixture(spec(), { scope: runScope });
}

function tempDir(tag) {
  return fs.mkdtempSync(path.join(runScope.workDir, tag));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

test("productionFingerprint 读取 git HEAD 与受控产品文件哈希", () => {
  const fingerprint = productionFingerprint();
  assert.match(fingerprint.head, /^[0-9a-f]{40}$/);
  assert.ok(fingerprint.file_count > 0);
  assert.match(fingerprint.files["frontend/src/lib/socket.ts"], /^[0-9a-f]{64}$/);
});

test("productionFingerprint 覆盖 tracked+untracked、遵循 gitignore/productPath 并发现增删改", (t) => {
  const dir = tempDir("b71-fingerprint-");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  };
  git("init");
  // 合成仓库不继承宿主全局 hooksPath/签名配置：产品指纹只应观察本仓库文件。
  git("config", "core.hooksPath", "/dev/null");
  git("config", "commit.gpgsign", "false");
  git("config", "user.email", "b71@example.test");
  git("config", "user.name", "b71");
  write("frontend/src/tracked.ts", "export const tracked = 1;\n");
  write("apps/demo/lib/tracked.ex", "defmodule Demo.Tracked do\nend\n");
  write("test/support/existing.ex", "defmodule Demo.Support do\nend\n");
  write("artifacts/before.txt", "ignored by gitignore");
  write(".gitignore", "artifacts/\n*.tmp\n");
  git("add", ".");
  git("commit", "-m", "base");

  write("frontend/src/untracked.ts", "export const untracked = 1;\n");
  write("apps/demo/lib/untracked.ex", "defmodule Demo.Untracked do\nend\n");
  write("test/support/untracked.ex", "defmodule Demo.UntrackedSupport do\nend\n");
  write("artifacts/after.txt", "still ignored");
  write("frontend/src/ignored.tmp", "ignored by extension");

  const first = productionFingerprint(dir);
  assert.match(first.head, /^[0-9a-f]{40}$/);
  assert.match(first.files["frontend/src/tracked.ts"], /^[0-9a-f]{64}$/);
  assert.match(first.files["frontend/src/untracked.ts"], /^[0-9a-f]{64}$/);
  assert.match(first.files["apps/demo/lib/untracked.ex"], /^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(first.files, "test/support/existing.ex"), false);
  assert.equal(Object.hasOwn(first.files, "test/support/untracked.ex"), false);
  assert.equal(Object.hasOwn(first.files, "artifacts/after.txt"), false);
  assert.equal(Object.hasOwn(first.files, "frontend/src/ignored.tmp"), false);
  assert.equal(first.file_count, Object.keys(first.files).length);

  write("frontend/src/untracked.ts", "export const untracked = 2;\n");
  const modified = productionFingerprint(dir);
  assert.notEqual(modified.files["frontend/src/untracked.ts"], first.files["frontend/src/untracked.ts"]);

  fs.rmSync(path.join(dir, "apps/demo/lib/untracked.ex"));
  const deletedUntracked = productionFingerprint(dir);
  assert.equal(Object.hasOwn(deletedUntracked.files, "apps/demo/lib/untracked.ex"), false);
  assert.notDeepEqual(deletedUntracked.files, first.files);

  write("apps/demo/lib/new.ex", "defmodule Demo.New do\nend\n");
  const added = productionFingerprint(dir);
  assert.match(added.files["apps/demo/lib/new.ex"], /^[0-9a-f]{64}$/);
  assert.equal(added.file_count, deletedUntracked.file_count + 1);
  assert.equal(added.file_count, first.file_count);

  fs.rmSync(path.join(dir, "frontend/src/tracked.ts"));
  const deletedTracked = productionFingerprint(dir);
  assert.equal(deletedTracked.files["frontend/src/tracked.ts"], "missing");
});

test("assertRecordFresh 要求三份证据齐全、不过期且截图魔数合法", () => {
  const template = fixture(recordFixtureSpec);
  const mtimes = ["cap.ax.txt", "cap.text.txt", "cap.jpg"].map((name) =>
    fs.statSync(template.files.get(name)).mtimeMs,
  );
  const readyAt = new Date(Math.min(...mtimes)).toISOString();
  assert.doesNotThrow(() => assertRecordFresh(template.dir, "cap", readyAt));

  withWorkingCopy(template, (copy) => {
    fs.rmSync(path.join(copy.dir, "cap.text.txt"));
    assert.throws(() => assertRecordFresh(copy.dir, "cap", readyAt), /缺少证据文件: cap.text.txt/);
  });

  const future = new Date(Date.now() + 60_000).toISOString();
  assert.throws(() => assertRecordFresh(template.dir, "cap", future), /证据文件早于原生窗口就绪/);

  withWorkingCopy(template, (copy) => {
    fs.writeFileSync(path.join(copy.dir, "cap.jpg"), Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]));
    assert.throws(() => assertRecordFresh(copy.dir, "cap", readyAt), /截图格式非法/);
  });
});

test("assertWaitLedger 收支平衡、分型齐全且有监督心跳时返回统计", () => {
  const template = fixture(waitLedgerFixtureSpec);
  const check = (dir) => assertWaitLedger(dir, { minimum: 1, requiredKinds: ["input"] });
  const ledger = check(template.dir);
  assert.equal(ledger.commands, 2);
  assert.equal(ledger.waits, 1);
  assert.deepEqual(ledger.kinds, ["input"]);
  assert.deepEqual(ledger.by_kind, { input: 1 });
  assert.equal(ledger.heartbeat_count, 1);
  assert.equal(ledger.run_elapsed_ms, 1000);

  const cases = [
    [{ commands: [{ op: "begin", id: "wait-1" }] }, /等待账仍有未完成 begin/],
    [
      {
        commands: [
          { op: "begin", id: "wait-1" },
          { op: "begin", id: "wait-1" },
        ],
      },
      /重复 begin/,
    ],
    [{ commands: [{ op: "finish", id: "wait-1" }] }, /finish 未匹配 begin/],
    [{ events: [{ event: "wait_start", at: 1000, kind: "input" }] }, /等待账 start\/end 不平衡/],
    [
      {
        events: [
          { event: "wait_start", at: 1000, kind: "other" },
          { event: "wait_end", at: 2000, kind: "other" },
        ],
      },
      /缺少 input 分型等待账/,
    ],
    [{ stats: { active: "still-waiting", completed: 1 } }, /等待账结束时不得有活动等待/],
    [{ stats: { active: null, completed: 0 } }, /等待账完成数不足/],
    [{ heartbeat: false }, /缺少监督心跳 heartbeat.jsonl/],
  ];
  for (const [patch, pattern] of cases) {
    withWorkingCopy(template, (copy) => {
      writeWaitLedger(copy.dir, patch);
      assert.throws(() => check(copy.dir), pattern);
    });
  }
});

test("assertProviderAndWire 汇总真实 transport/provider 记录并拒绝错 provider", () => {
  const template = fixture(providerBatchFixtureSpec);
  const out = assertProviderAndWire(template.dir);
  assert.equal(out.providerStarts.length, 1);
  assert.equal(out.userMessages.length, 1);
  assert.equal(out.turnResults.length, 1);
  assert.equal(out.wire.length, 3);

  withWorkingCopy(template, (copy) => {
    writeProviderBatch(copy.dir, "strata");
    assert.throws(() => assertProviderAndWire(copy.dir), /批次 provider 必须是 slice_verify/);
  });
});

test("assertCommonEvidence 通过完整批次并在 failure/ui-frames 标记时关闭", () => {
  const template = fixture(commonBatchFixtureSpec);
  const spec = {
    sliceId: "slice-x",
    minScreenshots: 1,
    minimumWaits: 1,
    requiredKinds: ["input"],
  };
  const out = assertCommonEvidence(template.dir, spec);
  assert.equal(out.ready.run_ref, "run-x");
  assert.equal(out.ui.scope, "slice-x");
  assert.equal(out.ledger.waits, 1);

  withWorkingCopy(template, (copy) => {
    writeJson(path.join(copy.dir, "failure.json"), {
      reason: "native_evidence_verification_failed",
    });
    assert.doesNotThrow(() =>
      assertCommonEvidence(copy.dir, { ...spec, allowVerificationFailureMarker: true }),
    );
    assert.throws(() => assertCommonEvidence(copy.dir, spec), /批次存在 failure.json，不得判 PASS/);
  });

  withWorkingCopy(template, (copy) => {
    fs.writeFileSync(path.join(copy.dir, "ui-frames.json"), "{}");
    assert.throws(() => assertCommonEvidence(copy.dir, spec), /不得存在浏览器 ui-frames 证据/);
  });
});

test("productionTableCounts 只读合成 SQLite 的生产表计数且不遗留 WAL sidecar", () => {
  const template = fixture(productionDbFixtureSpec);
  const counts = productionTableCounts(template.dir);
  assert.equal(counts.works, 1);
  assert.equal(counts.workspaces, 0);
  assert.equal(Object.keys(counts).length, PRODUCTION_TABLES.length);
  const dbFile = template.files.get(PRODUCTION_DB_REL);
  assert.equal(fs.existsSync(`${dbFile}-wal`), false);
  assert.equal(fs.existsSync(`${dbFile}-shm`), false);
});

test("checkProductionFingerprint 比对批次前后产品源码指纹", (t) => {
  const dir = tempDir("b71-fingerprint-check-");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const before = productionFingerprint();
  writeJson(path.join(dir, "production-sources-before.json"), before);
  const same = checkProductionFingerprint(dir);
  assert.equal(same.unchanged, true);
  assert.deepEqual(same.changed_files, []);
  assert.equal(same.head.before, before.head);
  assert.match(same.head.now, /^[0-9a-f]{40}$/);

  const changedFile = "frontend/src/lib/socket.ts";
  writeJson(path.join(dir, "production-sources-before.json"), {
    ...before,
    files: { ...before.files, [changedFile]: "0".repeat(64) },
  });
  const changed = checkProductionFingerprint(dir);
  assert.equal(changed.unchanged, false);
  assert.ok(changed.changed_files.includes(changedFile));
});
