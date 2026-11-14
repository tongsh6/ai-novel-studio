// B84 A2：B71 §16.14 confirmation 证据的真实 IO 边界。
//
// 本文件承接从 `authoring_confirmation_evidence.test.mjs` 迁出的真实文件/SQLite
// 集合：只读 DB reader、runtime 文件观察、AX/可见文本扫描，以及“缺 runtime 但
// 实际 llm-calls 存在也不得推断”的原反例。纯判据/解析/按钮定位仍留在原文件。
//
// run scope 在文件级 `before` 一次申请/借用，`after` 关闭；具体模板按消费者需要
// 首次 `materializeFixture` 时才构造，同 run 同规格由 owner 复用，不在本文件维护
// memo/registry。只读 AX/文本扫描为字面文件规格，不建 DB、不取可写副本；真实可变
// 反例（删表、删 llm-calls）仍取自己的可写副本。真实消费者仍是
// `readConfirmationDbFacts` / `observeConfirmationRuntime` / `scanAuthorVisibleBatch`。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after, before } from "node:test";
import {
  createWorkingCopy,
  fixtureTemplateHash,
  materializeFixture,
  openTestRunScope,
  withWorkingCopy,
} from "../test_env.mjs";
import {
  evaluateConfirmation,
  observeConfirmationRuntime,
  readConfirmationDbFacts,
  scanAuthorVisibleBatch,
} from "./authoring_confirmation_evidence.mjs";
import { confirmationInput } from "./fixtures/authoring_confirmation_scenarios.mjs";
import {
  CONFIRMATION_DB_REL,
  confirmationAxFixtureSpec,
  confirmationReaderFixtureSpec,
  confirmationRuntimeFixtureSpec,
  confirmationRuntimeReady,
} from "./fixtures/authoring_confirmation_io_fixture.mjs";

let runScope;

before(() => {
  runScope = openTestRunScope();
});

after(() => {
  runScope?.close();
});

// 惰性依赖：各消费者按需申请既有 owner；同 run 同规格由 materializeFixture 复用。
function readerFixture() {
  return materializeFixture(confirmationReaderFixtureSpec(), { scope: runScope });
}

function runtimeFixture() {
  return materializeFixture(confirmationRuntimeFixtureSpec(), { scope: runScope });
}

function axFixture(file, content) {
  return materializeFixture(confirmationAxFixtureSpec(file, content), { scope: runScope });
}

function databaseEntries(dir) {
  return fs.readdirSync(path.join(dir, "database")).sort();
}

function fakeRuntimeExec(executable, { listener4657 = true } = {}) {
  const calls = [];
  const exec = (command, args) => {
    calls.push({ command, args });
    if (command === "ps") return ` 111 1 ${executable}\n 222 1 /usr/bin/other\n`;
    if (command === "lsof") {
      return args.includes("-iTCP:4657") && listener4657 ? "app 111 lo TCP *:4657 (LISTEN)\n" : "";
    }
    throw new Error(`unexpected command: ${command}`);
  };
  return { exec, calls };
}

test("readConfirmationDbFacts：真实只读 SQLite 行按既有列/JSON 字节/排序/计数读取", () => {
  const fixture = readerFixture();
  const before = fixtureTemplateHash(fixture);
  assert.deepEqual(databaseEntries(fixture.dir), ["ai_novel_studio_test.sqlite3"]);

  const facts = readConfirmationDbFacts(fixture.dir);
  assert.equal(facts.receipts.length, 1);
  assert.equal(facts.receipts[0].id, "r1");
  // JSON 列按 SQLite 文本原样返回，不在 reader 内重新序列化。
  assert.equal(facts.receipts[0].result, JSON.stringify({ turn_id: "turn_dec" }));
  assert.equal(facts.agent_runs[0].id, "run-child");
  assert.equal(facts.interactions[0].turn_id, "turn_dec");
  assert.equal(facts.provider_runs[0].agent_run_id, "run-child");
  // 插入顺序与 ORDER BY inserted_at,id 相反；同 inserted_at 由 id 决定次序。
  assert.deepEqual(
    facts.agent_events.map((row) => row.id),
    ["e-c", "e-a", "e-b"],
  );
  assert.equal(facts.agent_events[0].event_type, "tool_started");
  assert.equal(facts.decision_traces[0].turn_id, "turn_dec");
  assert.equal(facts.mutations_count, 1);
  assert.equal(facts.memory_count, 1);
  assert.equal(facts.receipts_count, 1);
  assert.equal(facts.provider_runs_count, 1);
  assert.equal(facts.agent_runs_count, 1);

  assert.equal(fixtureTemplateHash(fixture), before, "只读读取不得改动模板字节");
  assert.deepEqual(
    databaseEntries(fixture.dir),
    ["ai_novel_studio_test.sqlite3"],
    "DELETE 模板只读读取不得生成 -wal/-shm",
  );
});

test("readConfirmationDbFacts：缺表/读取失败如实抛出，副本变更不污染模板或另一副本", () => {
  const fixture = readerFixture();
  const before = fixtureTemplateHash(fixture);
  let brokenDir;
  let intactDir;
  withWorkingCopy(
    fixture,
    (broken) => {
      brokenDir = broken.dir;
      withWorkingCopy(
        fixture,
        (intact) => {
          intactDir = intact.dir;
          assert.equal(fs.existsSync(path.join(broken.dir, ".fixture-control.json")), false);
          const db = new DatabaseSync(broken.files.get(CONFIRMATION_DB_REL));
          try {
            db.exec("DROP TABLE author_action_receipts");
          } finally {
            db.close();
          }
          assert.throws(() => readConfirmationDbFacts(broken.dir), /author_action_receipts/u);

          const intactFacts = readConfirmationDbFacts(intact.dir);
          assert.equal(intactFacts.receipts_count, 1, "另一副本不得看到本副本的删表变更");
          assert.equal(fixtureTemplateHash(fixture), before, "副本变更不得污染只读模板");
        },
        { scope: runScope },
      );
      assert.equal(fs.existsSync(intactDir), false, "内层副本在回调后已回收");
      assert.equal(fs.existsSync(brokenDir), true, "外层回调期间外层副本仍持有");
    },
    { scope: runScope },
  );
  assert.equal(fs.existsSync(brokenDir), false, "case 后回收删表副本");
  assert.equal(fs.existsSync(intactDir), false, "case 后回收对照副本");
});

test("evaluateConfirmation：缺 runtime 但实际 llm-calls 存在也不得推断运行态", () => {
  const fixture = runtimeFixture();
  const log = path.join(fixture.dir, "llm-calls", "2026-11-03.jsonl");
  assert.equal(fs.readFileSync(log, "utf8").trim().split("\n").length, 2);
  const result = evaluateConfirmation({
    ...confirmationInput("confirm"),
    runtime: undefined,
    dir: fixture.dir,
  });
  assert.equal(result.checks.C11_cleanup.ok, false);
  assert.equal(result.measured.runtime_after_batch, undefined);
});

test("observeConfirmationRuntime：只按本批 ready 的精确 executable 归属，并区分 lsof 无匹配/执行错误", () => {
  const fixture = confirmationRuntimeReady(runtimeFixture().dir);
  const { exec, calls } = fakeRuntimeExec(fixture.executable);
  assert.deepEqual(observeConfirmationRuntime(fixture.dir, fixture.ready, { exec }), {
    app_processes: 1,
    ports: { backend_4657: true, transport_4661: false },
    llm_calls: 2,
  });
  assert.equal(calls[0].command, "ps");
  assert.equal(calls.filter((call) => call.command === "lsof").length, 2);

  const noListener = (command) => {
    if (command === "ps") return "";
    if (command === "lsof") throw Object.assign(new Error("lsof no match"), { status: 1 });
    throw new Error(`unexpected command: ${command}`);
  };
  assert.deepEqual(observeConfirmationRuntime(fixture.dir, fixture.ready, { exec: noListener }).ports, {
    backend_4657: false,
    transport_4661: false,
  });

  const brokenLsof = (command) => {
    if (command === "ps") return "";
    throw Object.assign(new Error("lsof denied"), { status: 2 });
  };
  assert.throws(() => observeConfirmationRuntime(fixture.dir, fixture.ready, { exec: brokenLsof }), /lsof denied/u);
});

test("observeConfirmationRuntime：缺 ready/app/llm-calls 观察失败如实抛出，不回退默认名字或伪造 0", (t) => {
  const copy = createWorkingCopy(runtimeFixture(), { scope: runScope, context: t });
  fs.rmSync(path.join(copy.dir, "llm-calls"), { recursive: true, force: true });
  const fixture = confirmationRuntimeReady(copy.dir);
  const { exec } = fakeRuntimeExec(fixture.executable);
  assert.throws(() => observeConfirmationRuntime(fixture.dir, null, { exec }), /ready_invalid/u);
  assert.throws(
    () => observeConfirmationRuntime(fixture.dir, { ...fixture.ready, app_path: path.join(fixture.dir, "missing.app") }, { exec }),
    /app_path_missing/u,
  );
  assert.throws(() => observeConfirmationRuntime(fixture.dir, fixture.ready, { exec }), /llm-calls/u);
});

test("AX 断言层：全类别内部 token 命中判红（含中文内部术语）", () => {
  // 每个固定输入一个只读字面规格；目录里只有本 case 声明的 capture，不取副本。
  const leak = scanAuthorVisibleBatch(
    axFixture(
      "01-source.ax.txt",
      "\t\t0/0/0/0/0/8 AXPopUpButton, 模型已连接, Description: Stub · 当前模型：slice_verify, enabled=true\n",
    ).dir,
  );
  assert.equal(leak.ok, false);
  assert(leak.hits.some((hit) => hit.token === "slice_verify" || hit.token === "Stub"));
  assert.deepEqual(leak.scanned_files, ["01-source.ax.txt"], "本 case 目录只含自己声明的 capture");

  const proseLeak = scanAuthorVisibleBatch(
    axFixture(
      "02-after-confirm.ax.txt",
      "\t\t0/0/0/0/0/27/0 AXStaticText, Value: 已确认「prose_writing」操作，正在处理。\n",
    ).dir,
  );
  assert.equal(proseLeak.ok, false);
  assert(proseLeak.hits.some((hit) => hit.token === "prose_writing"));
  assert.deepEqual(proseLeak.scanned_files, ["02-after-confirm.ax.txt"]);

  const p1Scan = scanAuthorVisibleBatch(
    axFixture(
      "02-after-confirm.ax.txt",
      "\t\t0/0/0/0/0/1 AXStaticText, Value: 当前创作请求的工作过程\n",
    ).dir,
  );
  // P1 后全类别启用：中文内部术语与其它类别一样判红，同时单独输出清单供报告。
  assert.equal(p1Scan.ok, false);
  assert(p1Scan.hits.some((hit) => hit.token === "工作过程"));
  assert(p1Scan.internal_terms_zh_hits.some((hit) => hit.token === "工作过程"));
  assert.deepEqual(p1Scan.scanned_files, ["02-after-confirm.ax.txt"]);

  const cleanScan = scanAuthorVisibleBatch(
    axFixture("01-source.ax.txt", "\t\t0/0/0/0/0/2 AXStaticText, Value: 需要确认\n").dir,
  );
  assert.equal(cleanScan.ok, true);
  assert.deepEqual(cleanScan.hits, []);
  assert.deepEqual(cleanScan.scanned_files, ["01-source.ax.txt"]);
});

test("AX 断言层：text.txt 可见文本同样扫描真实内部 token", () => {
  const scan = scanAuthorVisibleBatch(axFixture("01-source.text.txt", "Value: slice_verify\n").dir);
  assert.equal(scan.ok, false);
  assert(scan.hits.some((hit) => hit.token === "slice_verify" && hit.file === "01-source.text.txt"));
  assert.deepEqual(scan.scanned_files, ["01-source.text.txt"]);
});
