// B71 auto-maintenance 邻接 IO：真实 AX/capture 文本、驱动 JSONL、7 表 SQLite 与
// 端到端 verify。模板由 `fixtures/authoring_auto_maintenance_io_fixture.mjs` 在 run 内
// 物化一次（只读共享）；需要改 AX/DB 或写 summary 的 case 取 `withWorkingCopy` 隔离
// 副本。纯评估在邻接 `authoring_auto_maintenance_evidence.test.mjs`，不建目录/DB。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import {
  evaluateAutoMaintenance,
  scanAuthorVisibleFiles,
  verifyAutoMaintenanceBatch,
  waitForEvidenceFile,
} from "./authoring_auto_maintenance_evidence.mjs";
import { materializeFixture, openTestRunScope, withWorkingCopy } from "../test_env.mjs";
import {
  CALL_ID,
  FAILURE_REASON,
  FAIL_RUN,
  MAINTENANCE_STRIP_AX,
  afterRecord,
  afterWireMessages,
  beforeRecord,
  dbFactsFor,
  driverLogFor,
  llmRecords,
} from "./fixtures/authoring_auto_maintenance_facts.mjs";
import { autoMaintenanceFixtureSpec } from "./fixtures/authoring_auto_maintenance_io_fixture.mjs";

let runScope;

test.before(() => {
  runScope = openTestRunScope();
});

test.after(() => {
  runScope?.close();
});

function fixture() {
  return materializeFixture(autoMaintenanceFixtureSpec(), { scope: runScope });
}

function evaluateIn(dir, overrides = {}) {
  return evaluateAutoMaintenance({
    config: { slice_id: "b71-first-consumer", journey: "auto-maintenance", provider: "strata" },
    dbFacts: overrides.dbFacts ?? dbFactsFor(),
    checkpoints: { start: { authoring_canon: { tables: {} } }, final: { authoring_canon: { tables: {} } } },
    driverLog: overrides.driverLog ?? driverLogFor(),
    cleanup: overrides.cleanup ?? { remaining: [], process_observation: { method: "pgrep+lsof" } },
    strataSlot: overrides.strataSlot ?? { unloaded: true },
    llmRecords: overrides.llmRecords ?? llmRecords(),
    appLog: overrides.appLog ?? [
      { event: "agent_run.auto_maintenance.error", run_id: FAIL_RUN, reason: FAILURE_REASON },
    ],
    dir,
    multiTurn: overrides.multiTurn ?? null,
  });
}

test("A3 正例：C1–C10 全过（真实压力/事件+checkpoint/细条/四要素/精简/canonical/幂等/失败静默/扫描/清理）", () => {
  const template = fixture();
  const result = evaluateIn(template.dir);
  assert.deepEqual(result.failed, []);
  assert.equal(result.checks.C1_real_pressure.ok, true);
  assert.equal(result.checks.C2_auto_maintenance_committed.ok, true);
  assert.equal(result.checks.C3_strip_visible.ok, true);
  assert.equal(result.checks.C4_expanded_factors.ok, true);
  assert.equal(result.checks.C5_next_request_compact.ok, true);
  assert(result.checks.C5_next_request_compact.detail.covered_call_ids.includes(CALL_ID));
  assert(result.checks.C5_next_request_compact.detail.checks[0].wire_checkpoint_covers.some((ids) => ids.includes(CALL_ID)));
  assert.equal(result.checks.C6_canonical_complete.ok, true);
  assert(result.checks.C6_canonical_complete.detail.covered_call_ids.includes(CALL_ID));
  assert.equal(result.checks.C7_refresh_idempotent.ok, true);
  assert.equal(result.checks.C8_failure_silent.ok, true);
  assert.equal(result.checks.C9_author_visible_no_internal_tokens.ok, true);
  assert.equal(result.checks.C10_cleanup.ok, true);
});

test("A3 反例：细条缺失/四要素缺失 分别 fail", () => {
  const template = fixture();
  withWorkingCopy(template, (copy) => {
    fs.writeFileSync(path.join(copy.dir, "after-maintenance.ax.txt"), "\t\t0/0/0/0/0/10 AXButton, 普通消息\n");
    assert.equal(evaluateIn(copy.dir).checks.C3_strip_visible.ok, false);
  });
  withWorkingCopy(template, (copy) => {
    fs.writeFileSync(path.join(copy.dir, "after-expanded.ax.txt"), "普通内容\n");
    assert.equal(evaluateIn(copy.dir).checks.C4_expanded_factors.ok, false);
  });
});

test("A3 反例：刷新不幂等/清理失败 分别 fail", () => {
  const template = fixture();
  const refresh = evaluateIn(template.dir, {
    driverLog: { ...driverLogFor(), refresh: { before_checkpoint_events: 1, after_checkpoint_events: 2 } },
  });
  assert.equal(refresh.checks.C7_refresh_idempotent.ok, false);
  const cleanup = evaluateIn(template.dir, { cleanup: { remaining: [{ pid: 1 }], process_observation: {} } });
  assert.equal(cleanup.checks.C10_cleanup.ok, false);
  const strata = evaluateIn(template.dir, { strataSlot: { unloaded: false } });
  assert.equal(strata.checks.C10_cleanup.ok, false);
});

test("C3/C7 正例：现行 AXButton accessible name（enabled=true）识别为可见细条", () => {
  const template = fixture();
  withWorkingCopy(template, (copy) => {
    fs.writeFileSync(path.join(copy.dir, "after-maintenance.ax.txt"), `${MAINTENANCE_STRIP_AX}\n`);
    fs.writeFileSync(path.join(copy.dir, "after-refresh.ax.txt"), `${MAINTENANCE_STRIP_AX}\n`);
    const result = evaluateIn(copy.dir);
    assert.equal(result.checks.C3_strip_visible.ok, true);
    assert.match(
      String(result.checks.C3_strip_visible.detail.matched ?? ""),
      /AXButton, 查看已整理的较早创作过程, enabled=true/u,
    );
    assert.equal(result.checks.C7_refresh_idempotent.ok, true);
    assert.equal(result.checks.C7_refresh_idempotent.detail.strip_visible_after_refresh, true);
  });
});

test("C3/C7 反例：同名非 AXButton / 纯文本 / disabled AXButton 都不算可见细条", () => {
  const cases = [
    ["同文本静态元素", "\t\t0/0/0/0/0/50/3 AXStaticText, 查看已整理的较早创作过程, enabled=true"],
    ["同文本纯可见文本", "查看已整理的较早创作过程"],
    ["同名 disabled AXButton", "\t\t0/0/0/0/0/50/3 AXButton, 查看已整理的较早创作过程, enabled=false, Actions: AXPress"],
  ];
  const template = fixture();
  for (const [name, line] of cases) {
    withWorkingCopy(template, (copy) => {
      fs.writeFileSync(path.join(copy.dir, "after-maintenance.ax.txt"), `${line}\n`);
      fs.writeFileSync(path.join(copy.dir, "after-refresh.ax.txt"), `${line}\n`);
      const result = evaluateIn(copy.dir);
      assert.equal(result.checks.C3_strip_visible.ok, false, name);
      assert.equal(result.checks.C7_refresh_idempotent.ok, false, name);
    });
  }
});

test("A3 反例：AX 全类别泄漏命中（prose_writing / 工作过程）→ C9 fail", () => {
  const template = fixture();
  assert.equal(scanAuthorVisibleFiles(template.dir).ok, true);
  withWorkingCopy(template, (copy) => {
    fs.writeFileSync(
      path.join(copy.dir, "after-maintenance.ax.txt"),
      "\t\t0/0/0/0/0/10 AXStaticText, Value: 已确认「prose_writing」操作\n",
    );
    const leak = scanAuthorVisibleFiles(copy.dir);
    assert.equal(leak.ok, false);
    assert(leak.hits.some((hit) => hit.token === "prose_writing"));
  });
});

test("A3 合成目录端到端：verify 通过并写 summary；细条缺失时失败关闭", () => {
  const template = fixture();
  withWorkingCopy(template, (copy) => {
    const { result, summary } = verifyAutoMaintenanceBatch(copy.dir);
    assert.deepEqual(result.failed, []);
    assert.equal(summary.verdict.mechanism, "pass");
    assert.equal(summary.verdict.auto_maintenance_loop_closed, true);
  });
  withWorkingCopy(template, (copy) => {
    fs.writeFileSync(path.join(copy.dir, "after-maintenance.ax.txt"), "\t\t0/0/0/0/0/10 AXButton, 普通消息\n");
    assert.throws(() => verifyAutoMaintenanceBatch(copy.dir), /auto-maintenance 判据失败/u);
  });
});

test("verify 前有界等待 finally 证据：延迟落盘的 strata-slot.json 会被等待到", () => {
  const dir = fs.mkdtempSync(path.join(runScope.workDir, "b71-wait-"));
  const file = path.join(dir, "strata-slot.json");
  // 子进程 300ms 后落盘（verify 主线程用 Atomics.wait 阻塞，同进程 setTimeout 无法执行）。
  spawn(
    process.execPath,
    ["-e", `setTimeout(() => require("fs").writeFileSync(${JSON.stringify(file)}, "{}"), 300)`],
    { stdio: "ignore" },
  );
  assert.equal(waitForEvidenceFile(dir, "strata-slot.json", 5_000), true);

  const missing = fs.mkdtempSync(path.join(runScope.workDir, "b71-wait-"));
  assert.equal(waitForEvidenceFile(missing, "strata-slot.json", 600), false);
});

test("G6 multi-turn 正例：同 run pause/steer/resume 成立 → C11 pass，C7/C8 一并判", () => {
  const template = fixture();
  const result = evaluateIn(template.dir, {
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [
        {
          index: 1,
          ok: true,
          kind: "choice",
          label: "保留悬念",
          observation: {
            question_text: "请确认要看哪一章的正文与章计划？",
            answer_source: "extracted_text",
            answer_text: "继续核对正文与章计划的一致性：先给出依据再继续；不要提前结束。",
          },
        },
      ],
      resumes: [{ index: 1, resumed: true, status: "running" }],
      rounds: [{ index: 1, pause_kind: "paused", exchange_facts: { complete_exchanges: 0 } }],
      stop_reason: "triggered",
      max_steers: 6,
      checkpoint_events: 1,
    },
  });
  assert.equal(result.checks.C11_multi_turn_same_run.ok, true);
  assert.equal(result.checks.C7_refresh_idempotent.ok, true);
  assert.equal(result.checks.C8_failure_silent.ok, true);
  assert(result.required.includes("C7_refresh_idempotent"));
  assert(result.required.includes("C8_failure_silent"));
  assert(result.required.includes("C11_multi_turn_same_run"));
  assert(!result.failed.includes("C11_multi_turn_same_run"));
  assert(!result.failed.includes("C7_refresh_idempotent"));
  assert(!result.failed.includes("C8_failure_silent"));
  assert.deepEqual(result.failed, []);
  assert(!result.not_signed.some((item) => item.includes("not_in_scope_multi_turn")));
});

test("G6 multi-turn：C7/C8 不再豁免，缺刷新/失败证据即失败", () => {
  const template = fixture();
  const result = evaluateIn(template.dir, {
    driverLog: { ...driverLogFor(), refresh: null, failure_injection: null },
    multiTurn: {
      pause: { kind: "paused", status: "awaiting_author" },
      steers: [
        {
          index: 1,
          ok: true,
          observation: { question_text: "请确认要看哪一章？", answer_source: "option", answer_text: "选项A" },
        },
      ],
      resumes: [{ index: 1, resumed: true, status: "running" }],
      rounds: [{ index: 1, pause_kind: "paused" }],
      stop_reason: "triggered",
      max_steers: 6,
      checkpoint_events: 1,
    },
  });
  assert.equal(result.checks.C7_refresh_idempotent.ok, false);
  assert.equal(result.checks.C8_failure_silent.ok, false);
  assert(result.failed.includes("C7_refresh_idempotent"));
  assert(result.failed.includes("C8_failure_silent"));
  assert(!result.not_signed.some((item) => item.includes("not_in_scope_multi_turn")));
});

test("C7 反例：刷新计数为 null/字符串/负数时不得通过", () => {
  const template = fixture();
  const base = driverLogFor();
  for (const [label, patch] of [
    ["null 计数", { after_checkpoint_messages: null }],
    ["字符串计数", { before_checkpoint_events: "1" }],
    ["负数计数", { after_checkpoint_events: -1 }],
  ]) {
    const result = evaluateIn(template.dir, {
      driverLog: { ...base, refresh: { ...base.refresh, ...patch } },
    });
    assert.equal(result.checks.C7_refresh_idempotent.ok, false, label);
  }
});

test("跨 run A3 场景：C11 不判，C7/C8 仍判", () => {
  const template = fixture();
  const result = evaluateIn(template.dir);
  assert.equal(result.checks.C11_multi_turn_same_run.ok, null);
  assert(!result.required.includes("C11_multi_turn_same_run"));
  assert.equal(result.checks.C7_refresh_idempotent.ok, true);
  assert.equal(result.checks.C8_failure_silent.ok, true);
});

test("C5 正例（真实目录下 C5 与 wire 覆盖）", () => {
  const template = fixture();
  const messages = afterWireMessages({ summary: `已整理的较早记录（原文含 ${CALL_ID}）` });
  const result = evaluateIn(template.dir, {
    llmRecords: [beforeRecord(), afterRecord({ messages })],
  });
  assert.equal(result.checks.C5_next_request_compact.ok, true);
  assert(result.checks.C5_next_request_compact.detail.checks[0].wire_checkpoint_covers.some((ids) => ids.includes(CALL_ID)));
});
