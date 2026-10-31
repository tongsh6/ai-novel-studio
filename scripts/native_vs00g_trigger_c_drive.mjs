// VS00G 触发 C：真实 Tauri + AX/CGEvent；只点击用户可见动作，产品无验收感知。
import path from "node:path";
import { readJson, textOf } from "./lib/native_ui/driver.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  frameBody,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_vs00g_trigger_c_drive.mjs <batch-run-dir>");
  process.exit(64);
}
const EVIDENCE = path.join(ROOT, "scripts/native_vs00g_trigger_c_evidence.mjs");
const harness = new NativeScenarioHarness(dir);
const RULE = "protagonist_undermaterialized";
const frames = (wire, direction, event) =>
  wire.filter((record) => record.direction === direction && record.frame?.[3] === event);
const proposalActions = (body) =>
  (body?.available_actions ?? []).filter((action) =>
    ["fact_inventory.start", "fact_inventory.dismiss"].includes(action.label_key),
  );
const startTarget = (body) =>
  proposalActions(body).find((action) => action.action_type === "start_fact_inventory")?.target_ref ?? null;

function nodeByText(nodes, title, prefix = false) {
  return nodes.find(
    (node) =>
      ["AXButton", "AXRadioButton", "AXTab", "AXStaticText"].includes(node.role) &&
      (prefix ? textOf(node).startsWith(title) : textOf(node) === title),
  );
}

function click(title, label, prefix = false) {
  const nodes = harness.dumpNodes();
  const button = harness.findButton(nodes, title) ?? nodeByText(nodes, title, prefix);
  if (!button) throw new Error(`button_not_found:${label}:${title}`);
  harness.safeClick(button, label);
}

async function closeArchive(label) {
  await harness.runStep("maintenance", `close_archive:${label}`, async () => {
    const nodes = harness.dumpNodes();
    const close = harness.findButton(nodes, "关闭档案");
    if (close) harness.safeClick(close, `close_archive:${label}`);
    return harness.pollAx(
      (text) => !text.includes("发起全书审读"),
      30_000,
      `archive_closed:${label}`,
    );
  });
}

async function review(label) {
  await harness.runStep("maintenance", `open_review:${label}`, async () => {
    click("打开档案", `open_archive:${label}`);
    await harness.pollAx(
      (text) => text.includes("脉络") && text.includes("概览"),
      30_000,
      `review_panel:${label}`,
    );
    click("脉络", `threads_tab:${label}`, true);
    await harness.pollAx((text) => text.includes("发起全书审读"), 30_000, `threads_ready:${label}`);
  });
  return harness.runStep("turn", `full_review:${label}`, async () => {
    const startedAt = harness.nowIso();
    click("发起全书审读", `start_review:${label}`);
    const sent = await harness.pollWire(
      (wire) =>
        frames(wire, "sent", "author_action").find(
          (record) => record.at >= startedAt && frameBody(record).action?.action_type === "start_full_review",
        ) ?? null,
      30_000,
      `review_action:${label}`,
    );
    const turn = await harness.pollWire(
      (wire) =>
        frames(wire, "received", "turn_result").find((record) => {
          const body = frameBody(record);
          return record.at >= sent.at && body.agent_run?.profile_ref === "ledger_reconciliation_v1" && body.status === "completed";
        }) ?? null,
      120_000,
      `review_turn:${label}`,
    );
    return turn;
  });
  await closeArchive(label);
  return turn;
}

async function proposalVisible(label) {
  return harness.runStep("candidate", `proposal_visible:${label}`, () =>
    harness.pollAx(
      (text) => text.includes("你可以发起设定盘点") && text.includes("关闭盘点提议"),
      120_000,
      `proposal_visible:${label}`,
    ),
  );
}

async function noProposalButtons(label) {
  return harness.runStep("maintenance", `proposal_absent:${label}`, () =>
    harness.pollAx(
      (_text, nodes) => !harness.findButton(nodes, "关闭盘点提议") && !harness.findButton(nodes, "发起设定盘点"),
      30_000,
      `proposal_absent:${label}`,
    ),
  );
}

async function run() {
  runEvidenceMode(EVIDENCE, "prepare", dir);
  const config = readJson(path.join(dir, "native-vs00g-config.json"));
  await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
  await harness.runStep("maintenance", "workbench_ready:initial", () => harness.rawWaitWorkbenchSettled("initial"));
  await ensureWorkSelected(harness, config.dismiss.work_id, config.dismiss.work_title, "initial");

  const first = await review("first");
  const firstTarget = startTarget(frameBody(first));
  if (!firstTarget) throw new Error("initial_r5_proposal_missing");
  await proposalVisible("first");
  harness.capture("01-proposal");
  runEvidenceMode(EVIDENCE, "capture", dir, ["proposal"]);

  const repeatedOpen = await review("repeat_before_dismiss");
  // 重复审读只禁止“重复发起”盘点；原提议未关闭时必须保留可关闭动作（dismiss-only），
  // 否则页面再无入口，作者无法关闭提议。
  if (
    proposalActions(frameBody(repeatedOpen)).some(
      (action) => action.action_type === "start_fact_inventory",
    )
  ) {
    throw new Error("open_proposal_repeated");
  }
  // 重复审读返回后，原提议应仍投影在页面上；AX 树投影有一帧延迟，用有界等待
  // 而不是单次快照（断言意图不变：原提议保留 + 不重复出现发起按钮）。
  await harness.runStep("maintenance", "original_proposal_retained_after_rescan", () =>
    harness.pollAx(
      (_text, nodes) =>
        Boolean(harness.findButton(nodes, "关闭盘点提议")) &&
        !harness.findButton(nodes, "发起设定盘点"),
      30_000,
      "original_proposal_retained_after_rescan",
    ),
  );
  harness.capture("02-no-repeat-open");
  runEvidenceMode(EVIDENCE, "capture", dir, ["no_repeat_open"]);

  const dismissed = await harness.runStep("maintenance", "dismiss_original_after_rescan", async () => {
    const startedAt = harness.nowIso();
    click("关闭盘点提议", "dismiss_original_after_rescan");
    const sent = await harness.pollWire(
      (wire) =>
        frames(wire, "sent", "author_action").find((record) => {
          const action = frameBody(record).action ?? {};
          // 服务端会把旧提议的 dismiss 重绑到当前活跃同规则 finding，target_ref
          // 指向最新 report；断言行为是“关闭动作被真实发送”，不锁死旧 ref。
          return record.at >= startedAt && action.action_type === "adjudicate_finding" &&
            (action.target_ref === firstTarget || String(action.target_ref ?? "").startsWith("finding:"));
        }) ?? null,
      30_000,
      "dismiss_action",
    );
    return harness.pollWire(
      (wire) =>
        frames(wire, "received", "action_result").find(
          (record) => record.at >= sent.at && frameBody(record).action_type === "adjudicate_finding" && frameBody(record).status === "applied",
        ) ?? null,
      30_000,
      "dismiss_result",
    );
  });
  await noProposalButtons("dismissed");

  await harness.runStep("restore", "relaunch_after_dismiss", () => harness.rawCloseAppAndRelaunch());
  await harness.runStep("maintenance", "workbench_ready:after_dismiss", () => harness.rawWaitWorkbenchSettled("after_dismiss"));
  await ensureWorkSelected(harness, config.dismiss.work_id, config.dismiss.work_title, "after_dismiss");
  await noProposalButtons("after_relaunch");
  harness.capture("03-dismissed-after-relaunch");
  runEvidenceMode(EVIDENCE, "capture", dir, ["dismissed"]);

  const repeatedClosed = await review("repeat_after_dismiss");
  if (proposalActions(frameBody(repeatedClosed)).length !== 0) throw new Error("closed_proposal_repeated");
  await noProposalButtons("after_dismiss_rescan");
  harness.capture("04-no-repeat-closed");
  runEvidenceMode(EVIDENCE, "capture", dir, ["rescan"]);

  await ensureWorkSelected(harness, config.start.work_id, config.start.work_title, "explicit_start");
  const explicit = await review("explicit_start");
  const explicitTarget = startTarget(frameBody(explicit));
  if (!explicitTarget || explicitTarget === firstTarget) throw new Error("independent_work_proposal_missing");
  await proposalVisible("explicit_start");
  harness.capture("05-explicit-proposal");
  runEvidenceMode(EVIDENCE, "capture", dir, ["before_start"]);

  const { sent: startSent, runId } = await harness.runStep("turn", "explicit_inventory_start", async () => {
    const startedAt = harness.nowIso();
    click("发起设定盘点", "explicit_inventory_start");
    const sent = await harness.pollWire(
      (wire) =>
        frames(wire, "sent", "author_action").find((record) => {
          const action = frameBody(record).action ?? {};
          return record.at >= startedAt && action.action_type === "start_fact_inventory" && action.target_ref === explicitTarget;
        }) ?? null,
      30_000,
      "inventory_action",
    );
    const ack = await harness.pollWire(
      (wire) =>
        frames(wire, "received", "phx_reply").find((record) => {
          const body = frameBody(record);
          return record.at >= sent.at && body.status === "ok" && body.response?.action_status === "running" && typeof body.response?.run_id === "string";
        }) ?? null,
      30_000,
      "inventory_ack",
    );
    return { sent, runId: frameBody(ack).response.run_id };
  });
  const inventory = await harness.runStep("turn", "inventory_tentative_result", () =>
    harness.pollWire(
      (wire) =>
        frames(wire, "received", "turn_result").find((record) => {
          const body = frameBody(record);
          return body.agent_run?.run_id === runId && body.agent_run?.profile_ref === "fact_inventory_v1" && (body.adoption_state?.pending ?? []).length > 0;
        }) ?? null,
      120_000,
      "inventory_tentative_result",
    ),
  );
  await harness.runStep("candidate", "inventory_visible", () =>
    harness.pollAx((text) => text.includes("沈砚") && !text.includes("关闭盘点提议"), 120_000, "inventory_visible"),
  );
  harness.capture("06-inventory-started");
  runEvidenceMode(EVIDENCE, "capture", dir, ["final"]);

  harness.writeDriverLog("native-vs00g-report.json", {
    slice_id: config.slice_id,
    provider: config.provider,
    first_target: firstTarget,
    repeated_open_turn_id: frameBody(repeatedOpen)?.turn_id,
    dismissed_report_id: frameBody(dismissed)?.report_id,
    repeated_closed_turn_id: frameBody(repeatedClosed)?.turn_id,
    explicit_target: explicitTarget,
    inventory_run_id: runId,
    inventory_turn_id: frameBody(inventory)?.turn_id,
    start_action_sent_at: startSent.at,
    finding_rule: RULE,
  });
  harness.writeUiComplete(config.slice_id);
  console.log(`VS00G 触发 C 原生完成: dismiss_work=${config.dismiss.work_id} start_work=${config.start.work_id} run=${runId}`);
}

run().catch((error) => harness.fail(error));
