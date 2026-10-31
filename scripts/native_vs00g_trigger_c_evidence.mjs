// VS00G 触发 C 原生只读证据核验；不操作产品或改写失败批次。
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  all,
  assertCommonEvidence,
  assertProviderAndWire,
  axText,
  checkProductionFingerprint,
  evidenceBoundary,
  productionFingerprint,
  read,
  rewrite,
  seedFields,
  withDb,
  write,
  writeNativeSummary,
} from "./lib/native_ui/scenario_evidence.mjs";

const SLICE = "vs00g-trigger-c";
const bodyOf = (record) => record?.frame?.[4] ?? {};
const actionsOf = (body) =>
  (body?.available_actions ?? []).filter((action) =>
    ["fact_inventory.start", "fact_inventory.dismiss"].includes(action.label_key),
  );
const targetOf = (body) =>
  actionsOf(body).find((action) => action.action_type === "start_fact_inventory")?.target_ref ?? null;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function snapshot(dir, workId) {
  return withDb(dir, (db) => ({
    canon: {
      accepted_characters: Number(all(db, "SELECT COUNT(*) AS n FROM characters WHERE work_id = ? AND status = 'ACCEPTED'", [workId])[0].n),
      accepted_memory_items: Number(all(db, "SELECT COUNT(*) AS n FROM memory_items WHERE work_id = ? AND status IN ('CONFIRMED', 'ACCEPTED')", [workId])[0].n),
      accepted_drafts: Number(all(db, "SELECT COUNT(*) AS n FROM drafts WHERE work_id = ? AND status = 'ACCEPTED'", [workId])[0].n),
    },
    proposal_receipts: Number(all(db, "SELECT COUNT(*) AS n FROM interactions WHERE workspace_id = ? AND instr(content, 'fact_inventory.start') > 0", [workId])[0].n),
    reports: all(db, "SELECT id, work_id, findings, adoption_status FROM reconciliation_reports WHERE work_id = ? ORDER BY inserted_at, id", [workId]),
  }));
}

function workConfig(dir, prefix) {
  const seed = seedFields(dir);
  const workId = seed(`${prefix}_work_id`);
  const work = withDb(dir, (db) => all(db, "SELECT id, title FROM works WHERE id = ?", [workId])[0]);
  assert(work?.title, `${prefix} 作品 seed 与只读 DB 不一致`);
  return {
    work_id: workId,
    work_title: work.title,
    session_id: seed(`${prefix}_session_id`),
    baseline: snapshot(dir, workId),
  };
}

export function prepare(dir) {
  const ready = read(dir, "native-driver-ready.json");
  assert.equal(ready.slice_id, SLICE);
  assert.equal(ready.driver, "external-system-ui");
  assert.equal(ready.browser_driver_started, false);
  assert.equal(ready.provider, "slice_verify");
  write(dir, "production-sources-before.json", productionFingerprint());
  const config = {
    slice_id: SLICE,
    provider: ready.provider,
    dismiss: workConfig(dir, "dismiss"),
    start: workConfig(dir, "start"),
  };
  assert.notEqual(config.dismiss.work_id, config.start.work_id, "两个场景必须作品隔离");
  write(dir, "native-vs00g-config.json", config);
  return config;
}

export function capture(dir, checkpoint) {
  const allowed = ["proposal", "no_repeat_open", "dismissed", "rescan", "before_start", "final"];
  assert(allowed.includes(checkpoint), `未知 VS00G capture: ${checkpoint}`);
  const config = read(dir, "native-vs00g-config.json");
  const file = path.join(dir, "native-vs00g-db.json");
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const work = checkpoint === "before_start" || checkpoint === "final" ? config.start : config.dismiss;
  rewrite(dir, "native-vs00g-db.json", { ...previous, [checkpoint]: snapshot(dir, work.work_id) });
}

export function verify(dir) {
  const config = read(dir, "native-vs00g-config.json");
  const report = read(dir, "native-vs00g-report.json");
  const { ready, ui, ledger } = assertCommonEvidence(dir, {
    sliceId: SLICE,
    minScreenshots: 6,
    minimumWaits: 15,
    requiredKinds: ["turn", "candidate", "maintenance", "restore"],
  });
  const { wire, turnResults } = assertProviderAndWire(dir, {
    minUserMessages: 0,
    minTurnResults: 4,
    minProviderStarts: 0,
  });
  const db = read(dir, "native-vs00g-db.json");
  const reviewTurns = turnResults.filter((record) => bodyOf(record).agent_run?.profile_ref === "ledger_reconciliation_v1");
  assert(reviewTurns.length >= 4, "两次去重扫描与两个独立作品的真实审读结果不足");
  const [first, repeatOpen, repeatClosed, explicit] = reviewTurns;
  const firstTarget = targetOf(bodyOf(first));
  const explicitTarget = targetOf(bodyOf(explicit));
  assert(firstTarget && explicitTarget, "真实 R5 未投影成提议动作");
  assert.equal(firstTarget, report.first_target);
  assert.equal(explicitTarget, report.explicit_target);
  assert.notEqual(firstTarget, explicitTarget, "不同作品错误共用提议目标");
  const openRepeatSuppressed =
    !actionsOf(bodyOf(repeatOpen)).some((action) => action.action_type === "start_fact_inventory") &&
    actionsOf(bodyOf(repeatOpen)).some((action) => action.action_type === "adjudicate_finding") &&
    !String(bodyOf(repeatOpen).assistant_message?.text ?? "").includes("你可以发起设定盘点");
  const closedRepeatSuppressed = actionsOf(bodyOf(repeatClosed)).length === 0 && !String(bodyOf(repeatClosed).assistant_message?.text ?? "").includes("你可以发起设定盘点");

  const authorActions = wire.filter((record) => record.direction === "sent" && record.frame?.[3] === "author_action");
  const dismissSent = authorActions.find((record) => {
    const action = bodyOf(record).action ?? {};
    return action.action_type === "adjudicate_finding" && String(action.target_ref ?? "").startsWith("finding:");
  });
  assert(dismissSent, "旧提议关闭没有走 adjudicate_finding");
  const dismissPayload = bodyOf(dismissSent).action.payload ?? {};
  assert.equal(dismissPayload.disposition, "dismiss");
  assert(
    String(dismissPayload.proposal_ref ?? "").startsWith("finding:"),
    "关闭动作缺少 proposal_ref 绑定",
  );
  assert.notEqual(dismissPayload.report_id, firstTarget.split(":")[1], "再扫描后未重绑当前报告");
  const dismissResult = wire.find((record) =>
    record.direction === "received" && record.frame?.[3] === "action_result" && record.at >= dismissSent.at &&
    bodyOf(record).action_type === "adjudicate_finding" && bodyOf(record).status === "applied",
  );
  assert(dismissResult, "关闭没有真实 action_result");
  assert.equal(bodyOf(dismissResult).report_id, dismissPayload.report_id);

  const starts = authorActions.filter((record) => bodyOf(record).action?.action_type === "start_fact_inventory");
  assert.equal(starts.length, 1, "提议或关闭隐式启动了额外汇盘点 run");
  const startSent = starts[0];
  assert.equal(startSent.at, report.start_action_sent_at);
  assert.equal(bodyOf(startSent).action.target_ref, explicitTarget);
  const startPayload = bodyOf(startSent).action.payload ?? {};
  assert.equal(startPayload.trigger_type, "finding");
  assert.equal(startPayload.report_id, explicitTarget.split(":")[1]);
  assert.equal(startPayload.finding_index, 0);
  assert.equal(startPayload.finding_rule, "protagonist_undermaterialized");
  assert.equal(startPayload.proposal_ref, explicitTarget);
  const inventory = turnResults.find((record) =>
    bodyOf(record).agent_run?.run_id === report.inventory_run_id &&
    bodyOf(record).agent_run?.profile_ref === "fact_inventory_v1" &&
    (bodyOf(record).adoption_state?.pending ?? []).length > 0,
  );
  assert(inventory, "显式点击后没有真实 fact_inventory_v1 tentative 结果");

  const dismissedReports = db.rescan.reports;
  const historicalDismiss = dismissedReports.some((row) => String(row.findings).includes('"disposition":"dismiss"'));
  const persistedDismiss = dismissedReports.some((row) => row.id === dismissPayload.report_id && String(row.findings).includes('"disposition":"dismiss"'));
  const closedCanonStable = ["proposal", "no_repeat_open", "dismissed", "rescan"].every((checkpoint) => same(db[checkpoint].canon, config.dismiss.baseline.canon));
  const explicitCanonStable = same(db.before_start.canon, config.start.baseline.canon) && same(db.final.canon, db.before_start.canon);
  const noNewCardOrCandidate = [first, explicit].every((record) =>
    (bodyOf(record).ui_cards ?? []).length === 0 && bodyOf(record).adoption_state === undefined,
  );
  const production = checkProductionFingerprint(dir);
  const checks = {
    real_tauri_window_launched: ui.driver === "ax-native-system-ui" && ready.browser_driver_started === false,
    proposal_derived_from_existing_r5_finding: Boolean(firstTarget && explicitTarget),
    proposal_visible_without_starting_run_or_write: starts.length === 1 && startSent.at >= report.start_action_sent_at && closedCanonStable,
    // 提议“已展示过”的 DB 凭据取第一次审读后的 checkpoint（重复审读后写入仍可能异步迟到），
    // 重复审读本身的行为证据由 openRepeatSuppressed（无 start + dismiss 保留）承担。
    proposal_not_repeated_before_dismiss:
      openRepeatSuppressed && db.proposal.proposal_receipts >= 1,
    dismiss_persists_and_no_reproposal: persistedDismiss && historicalDismiss && closedRepeatSuppressed,
    proposal_not_repeated_across_refresh: !axText(dir, "03-dismissed-after-relaunch").includes("关闭盘点提议") && closedRepeatSuppressed,
    accepted_or_discarded_proposal_not_shown: !axText(dir, "04-no-repeat-closed").includes("关闭盘点提议"),
    old_proposal_rebinds_active_finding: dismissPayload.report_id !== firstTarget.split(":")[1] && bodyOf(dismissResult).report_id === dismissPayload.report_id,
    explicit_start_uses_existing_fact_inventory: Boolean(inventory) && startPayload.trigger_type === "finding",
    independent_work_proposes_independently: firstTarget !== explicitTarget,
    no_new_card_type_or_acceptance_hook: noNewCardOrCandidate && production.unchanged,
    no_canon_write_before_or_after_explicit_start: closedCanonStable && explicitCanonStable,
    wait_ledger_complete: ledger.waits >= 15 && ui.screenshots.length >= 6,
  };
  const summary = writeNativeSummary(dir, {
    sliceId: SLICE,
    checks,
    measured: {
      dismiss_work_id: config.dismiss.work_id,
      start_work_id: config.start.work_id,
      first_target: firstTarget,
      explicit_target: explicitTarget,
      dismissed_report_id: dismissPayload.report_id,
      inventory_run_id: report.inventory_run_id,
      start_author_action_count: starts.length,
      production_changed_files: production.changed_files,
      surface: "tauri",
    },
    extra: {
      behavior: { name: "r5_inventory_proposal_dedup_dismiss_and_explicit_start", assertions: Object.keys(checks).filter((key) => checks[key]) },
      evidence_boundary: evidenceBoundary(),
      known_limits: [
        "使用 slice_verify 验证机制与产品边界，不代表真实模型盘点质量或 I10 文学盲评",
        "覆盖同作品同规则的去重、关闭、恢复和活跃报告重绑；works 级假定与记忆类注入富化不在本批",
      ],
    },
  });
  assert.equal(summary.all_checks_passed, true, `VS00G 原生断言失败: ${JSON.stringify(checks)}`);
  return summary;
}

export function main([mode, artifact, checkpoint]) {
  const dir = path.resolve(artifact ?? "");
  if (!artifact) throw new Error("usage: native_vs00g_trigger_c_evidence.mjs <prepare|capture|verify> <dir> [checkpoint]");
  if (mode === "prepare") return prepare(dir);
  if (mode === "capture") return capture(dir, checkpoint);
  if (mode === "verify") return verify(dir);
  throw new Error(`unknown mode: ${mode}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve(main(process.argv.slice(2))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
