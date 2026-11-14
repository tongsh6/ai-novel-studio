// B71 §16.14 确认批次 I/O/报告编排测试（合成完整批次，不启动真实 App）。
//
// 入口是生产公开的 verifyConfirmationBatch；文件级 `before` 只申请/借用 run scope
// 并安装 ps/lsof mock，`after` 关闭。固定 wire/canon/AX/PNG/合成 app/DB 只在首个
// 真正需要批次模板的 case 经 `materializeFixture` 物化成唯一只读模板（同 run 同规格
// 由 owner 复用）。每个 case 取自己的可写副本，并在副本上装配绝对 app_path/
// ready_at/heartbeat 与单一缺输入变更；报告只写本副本，模板和另一副本不受影响。
//
// OS 观察只 mock child_process.execFileSync 的 ps/lsof 边界（明确模拟无目标进程/
// 无监听），其它命令仍交回真实 exec。不访问 UserNotificationCenter/
// SystemNotificationCenter，也不依赖用户当前进程/端口。
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { mock } from "node:test";
import {
  fixtureTemplateHash,
  materializeFixture,
  openTestRunScope,
  withWorkingCopy,
} from "../test_env.mjs";
import { readConfirmationDbFacts, verifyConfirmationBatch } from "./authoring_confirmation_evidence.mjs";
import { CONFIRMATION_REQUEST } from "./authoring_confirmation_constants.mjs";
import { CHILD_RUN, CLICK_AT, SOURCE_RUN, SOURCE_TURN } from "./fixtures/authoring_confirmation_scenarios.mjs";
import {
  BATCH_SCREENSHOTS,
  CONFIRMATION_DB_REL,
  assembleConfirmationBatchCase,
  confirmationBatchFixtureSpec,
} from "./fixtures/authoring_confirmation_io_fixture.mjs";

const realExecFileSync = childProcess.execFileSync;

let runScope;

// 只替换 ps/lsof（以及 ps 失败后才会用到的 pgrep）边界：明确声明无目标进程、无监听。
// git 等其它只读调用原样交回真实 exec；生产实现没有 test 注入开关。
test.before(() => {
  mock.method(childProcess, "execFileSync", (command, args, options) => {
    if (command === "ps") return "";
    if (command === "lsof" || command === "pgrep") {
      const error = new Error(`${command}: no matching entries`);
      error.status = 1;
      throw error;
    }
    return realExecFileSync(command, args, options);
  });
  syncBuiltinESMExports();
  runScope = openTestRunScope();
});

test.after(() => {
  try {
    mock.restoreAll();
    syncBuiltinESMExports();
  } finally {
    runScope?.close();
  }
});

// 惰性依赖：before 只拥有/借用 run（并安装 ps/lsof mock）；首个真正需要批次模板的
// case 才申请，同 run 同规格由 materializeFixture 自行复用，不在这里维护 memo。
function batchFixture() {
  return materializeFixture(confirmationBatchFixtureSpec(), { scope: runScope });
}

// 副本的唯一出口是 withWorkingCopy：assemble 与 fn 都在回调内，任一失败都由同一
// 组合器关闭副本并保留主因，不再维护会遮掉 primary 的局部 finally。
function withBatch(options, fn) {
  return withWorkingCopy(
    batchFixture(),
    (copy) => {
      assembleConfirmationBatchCase(copy.dir, options);
      return fn({ dir: copy.dir });
    },
    { scope: runScope },
  );
}

const confirmationChecks = [
  "C1_source_persisted",
  "C2_confirmation_accepted",
  "C3_author_action_run_bound",
  "C4_behavior_uniquely_consumed",
  "C5_duplicate_idempotent",
  "C6_reject_zero_side_effect",
  "C7_confirmed_child_execution",
  "C8_author_bytes",
  "C9_why_replay_zero_provider",
  "C10_restore_not_actionable",
  "C11_cleanup",
  "C12_child_live_startup_events",
];
const expectedChecks = [...confirmationChecks, "author_visible_no_internal_tokens"];

test("完整确认批次：verifyConfirmationBatch 生成 summary/checks/ws frames 并通过 C1–C12", () => {
  const fixture = batchFixture();
  const templateBefore = fixtureTemplateHash(fixture);
  assert.equal(
    fs.existsSync(path.join(fixture.dir, ".fixture-control.json")),
    true,
    "只读模板保留自己的控制记录",
  );

  withBatch({}, ({ dir }) => {
    assert.equal(
      fs.existsSync(path.join(dir, ".fixture-control.json")),
      false,
      "控制记录不进入 case 工作副本",
    );
    const { result, summary } = verifyConfirmationBatch(dir);

    assert.equal(result.schema, "b71-confirmation-checks/v1");
    assert.deepEqual(result.failed, []);
    assert.deepEqual(Object.keys(result.checks), expectedChecks);
    for (const key of expectedChecks) {
      assert.equal(
        result.checks[key].ok,
        key === "C6_reject_zero_side_effect" ? null : true,
        `${key} 结果不符`,
      );
    }
    assert.equal(result.checks.C6_reject_zero_side_effect.reason, "confirm_mode");
    assert.deepEqual(result.required, expectedChecks.filter((key) => key !== "C6_reject_zero_side_effect"));

    // 关键同源 id：wire 选中的 source turn / child run / 点击时刻必须与 fixture 一致。
    assert.equal(result.source_turn_id, SOURCE_TURN);
    assert.equal(result.source_run_id, SOURCE_RUN);
    assert.equal(result.child_run_id, CHILD_RUN);
    assert.equal(result.click_at, CLICK_AT);
    assert.equal(result.action.action_id, "act_confirm_decision_1");
    assert.equal(result.measured.receipts, 1);
    assert.equal(result.measured.executed_tool, "prose_writing");
    assert.equal(result.measured.pending_artifact_type, "prose_fragment");
    assert.equal(result.measured.runtime_after_batch.app_processes, 0);
    assert.deepEqual(result.measured.runtime_after_batch.ports, {
      backend_4657: false,
      transport_4661: false,
    });
    assert.equal(result.measured.runtime_after_batch.llm_calls, 1);

    assert.equal(summary.schema, "b71-confirmation-summary/v1");
    assert.equal(summary.mode, "confirm");
    assert.equal(summary.surface, "tauri-native");
    assert.equal(summary.driver, "ax-native-system-ui");
    assert.equal(summary.request, CONFIRMATION_REQUEST);
    assert.deepEqual(summary.required, result.required);
    assert.deepEqual(summary.failed, []);
    assert.equal(summary.verdict.mechanism, "pass");
    assert.equal(summary.verdict.model_behavior.executed.branch, "executed");
    assert.equal(summary.verdict.full_g1_g6_signed, false);
    assert.equal(summary.verdict.i10_signed, false);
    assert.deepEqual(summary.checks, Object.fromEntries(expectedChecks.map((key) => [key, result.checks[key].ok])));
    assert.equal(summary.author_visible.ok, true);
    assert.deepEqual(summary.author_visible.hits, []);
    assert(summary.author_visible.scanned_files.includes("02-card.text.txt"));
    assert.equal(summary.wait_ledger.waits, 9);
    assert(summary.wait_ledger.kinds.includes("restore"));

    // 三个报告/帧产物必须是本次真实写出，不是手填输入。
    for (const name of ["summary.json", "native-b71-checks.json", "native-ws-frames.json"]) {
      assert(fs.existsSync(path.join(dir, name)), `${name} 未生成`);
    }
    const savedChecks = JSON.parse(fs.readFileSync(path.join(dir, "native-b71-checks.json"), "utf8"));
    assert.deepEqual(savedChecks, result);
    const savedSummary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
    assert.equal(savedSummary.verdict.mechanism, "pass");
    const frames = JSON.parse(fs.readFileSync(path.join(dir, "native-ws-frames.json"), "utf8"));
    assert(frames.length > 0);
    assert(frames.every((frame) => frame.direction !== "http"));
    assert(frames.some((frame) => frame.event === "agent_event" && frame.body.run_id === CHILD_RUN));
  });

  assert.equal(fixtureTemplateHash(fixture), templateBefore, "报告写入不得污染只读模板");
});

test("两可写副本写隔离：报告/DB 变更只落本副本，另一副本与模板不变", () => {
  const fixture = batchFixture();
  const templateBefore = fixtureTemplateHash(fixture);
  let leftDir;
  let rightDir;
  withBatch({}, ({ dir: outerDir }) => {
    leftDir = outerDir;
    withBatch({}, ({ dir: innerDir }) => {
      rightDir = innerDir;
      verifyConfirmationBatch(leftDir);
      assert.equal(fs.existsSync(path.join(leftDir, "summary.json")), true);
      assert.equal(
        fs.existsSync(path.join(rightDir, "summary.json")),
        false,
        "报告不得写入另一副本",
      );

      const db = new DatabaseSync(path.join(leftDir, CONFIRMATION_DB_REL));
      try {
        db.prepare("INSERT INTO mutations (id, inserted_at) VALUES (?, ?)").run("mut-left", "2026-11-03T10:00:09.000Z");
      } finally {
        db.close();
      }
      assert.equal(readConfirmationDbFacts(leftDir).mutations_count, 1, "左副本看到自己的写入");
      assert.equal(readConfirmationDbFacts(rightDir).mutations_count, 0, "右副本不得看到左副本写入");
      assert.equal(fixtureTemplateHash(fixture), templateBefore, "副本写入不得污染只读模板");
    });
    assert.equal(fs.existsSync(rightDir), false, "内层副本在回调后已回收");
    assert.equal(fs.existsSync(leftDir), true, "外层回调期间外层副本仍持有");
  });
  assert.equal(fs.existsSync(leftDir), false, "case 后回收左副本");
  assert.equal(fs.existsSync(rightDir), false, "case 后回收右副本");
});

test("withBatch 双失败：批次回调主因与副本 cleanup 失败同时保留", () => {
  const holder = { dir: "" };
  const originalRmSync = fs.rmSync;
  fs.rmSync = function (target, ...rest) {
    if (holder.dir && String(target) === holder.dir) {
      const error = new Error("EACCES: injected batch copy cleanup failure");
      error.code = "EACCES";
      throw error;
    }
    return originalRmSync.call(fs, target, ...rest);
  };
  let failure;
  try {
    withBatch({}, ({ dir }) => {
      holder.dir = dir;
      throw new Error("injected batch assertion primary");
    });
  } catch (error) {
    failure = error;
  } finally {
    fs.rmSync = originalRmSync;
  }
  // leader dual-failure-red.log 的回归：withBatch 若再包一层 finally，primary 会被
  // cleanup 掩掉，这里必须同时看到二者且 primary 在首位。
  assert.ok(failure instanceof AggregateError, "批次消费者双失败必须同时携带 primary 与 cleanup");
  assert.equal(failure.errors.length, 2);
  assert.match(failure.errors[0].message, /injected batch assertion primary/u);
  assert.match(failure.errors[1].message, /injected batch copy cleanup failure/u);
  assert.match(failure.message, /工作副本 清理失败/u);
  assert.equal(fs.existsSync(holder.dir), true, "cleanup 失败时保留目录供核验");
  fs.rmSync(holder.dir, { recursive: true, force: true });
  assert.equal(fs.existsSync(holder.dir), false, "恢复注入后实际回收副本");
});

test("缺 child 实时启动 WS（DB 完整）：判据失败且报告只写 fail 结论", () => {
  withBatch({ withoutChildEvents: true }, ({ dir }) => {
    assert.throws(
      () => verifyConfirmationBatch(dir),
      /B71 confirmation 判据失败: C12_child_live_startup_events/,
    );

    // verify 在断言前落盘报告；失败批次必须留下可核验的 fail，而不是 pass。
    const savedChecks = JSON.parse(fs.readFileSync(path.join(dir, "native-b71-checks.json"), "utf8"));
    assert.deepEqual(savedChecks.failed, ["C12_child_live_startup_events"]);
    assert.equal(savedChecks.checks.C12_child_live_startup_events.ok, false);
    assert.equal(savedChecks.checks.C12_child_live_startup_events.detail.db_has_tool_started, true);
    const savedSummary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
    assert.equal(savedSummary.verdict.mechanism, "fail");
    assert.deepEqual(savedSummary.failed, ["C12_child_live_startup_events"]);
    assert.equal(savedSummary.checks.C12_child_live_startup_events, false);
    assert.notEqual(savedSummary.verdict.mechanism, "pass");
  });
});

test("缺 llm-calls 目录：批次读取失败关闭，不生成报告", () => {
  withBatch({ omitLlmCalls: true }, ({ dir }) => {
    assert.throws(() => verifyConfirmationBatch(dir), /缺少 llm-calls 调用记录/);
    assert.equal(fs.existsSync(path.join(dir, "summary.json")), false);
    assert.equal(fs.existsSync(path.join(dir, "native-b71-checks.json")), false);
  });
});

test("缺真实 user_message 帧：输入证据不足时失败关闭", () => {
  withBatch({ userMessage: false }, ({ dir }) => {
    assert.throws(() => verifyConfirmationBatch(dir), /真实工作台输入帧不足: 0/);
    assert.equal(fs.existsSync(path.join(dir, "summary.json")), false);
  });
});

test("缺 provider_gateway.complete.start：provider 来源证据不足时失败关闭", () => {
  withBatch({ providerStart: false }, ({ dir }) => {
    assert.throws(() => verifyConfirmationBatch(dir), /批次 provider 必须是 slice_verify，实测: /);
    assert.equal(fs.existsSync(path.join(dir, "summary.json")), false);
  });
});

test("缺 canon start checkpoint：批次读取失败关闭", () => {
  withBatch({ omitStartCheckpoint: true }, ({ dir }) => {
    assert.throws(() => verifyConfirmationBatch(dir), /缺少 checkpoint b71-start\.json/);
    assert.equal(fs.existsSync(path.join(dir, "summary.json")), false);
  });
});

test("DB 缺 mutations 表：只读计数失败关闭，不伪造 0", () => {
  withBatch({ dropTables: ["mutations"] }, ({ dir }) => {
    assert.throws(() => verifyConfirmationBatch(dir), /no such table: mutations/);
    assert.equal(fs.existsSync(path.join(dir, "summary.json")), false);
  });
});

test("截图不足：原生证据门槛失败关闭", () => {
  withBatch({ screenshots: BATCH_SCREENSHOTS.slice(0, 3) }, ({ dir }) => {
    assert.throws(() => verifyConfirmationBatch(dir), /原生截图不足: 3 < 4/);
    assert.equal(fs.existsSync(path.join(dir, "summary.json")), false);
  });
});

test("非 confirmation journey：批次入口拒绝", () => {
  withBatch({ journey: "live" }, ({ dir }) => {
    assert.throws(() => verifyConfirmationBatch(dir), /只接受 journey=confirmation/);
    assert.equal(fs.existsSync(path.join(dir, "summary.json")), false);
  });
});

// 保留一个不依赖 mock 的正例对照：runtime 的 ps/lsof 边界只在上面被替换，
// 这里用显式 exec 证明 observeConfirmationRuntime 的无进程/无监听事实来自 mock 注入，
// 而 git 等其它命令仍可按真实 exec 执行（读只读 HEAD）。
test("mock 只拦截 ps/lsof：其它只读命令仍走真实 exec", () => {
  const head = childProcess.execFileSync("git", ["-C", process.cwd(), "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  }).trim();
  assert.match(head, /^[0-9a-f]{7,}$/);
});
