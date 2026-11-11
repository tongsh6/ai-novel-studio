// B71 记忆详情/列表 P0 泄漏回归原生驱动（journey=memory-detail）。
//
// 真实 Tauri 页面：工作台 → 「记忆」管理页 → 选中一条记忆 → 「记忆详情」抽屉 → 采集 AX/文本。
// 判据与采集分离（authoring_memory_detail_evidence）；本驱动只负责像作者一样导航与取证。
import path from "node:path";
import { readJson } from "./lib/native_ui/driver.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";
import { logs } from "./lib/native_ui/scenario_evidence.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_b71_memory_detail_drive.mjs <batch-run-dir>");
  process.exit(64);
}

const evidence = path.join(ROOT, "scripts/native_b71_evidence.mjs");
const harness = new NativeScenarioHarness(dir);
const READY_TIMEOUT_MS = Number(process.env.B71_MEMORY_DETAIL_READY_TIMEOUT_MS ?? 180_000);
const FLOW_LABEL = "b71-memory-detail";

function textOf(node) {
  return `${node?.title ?? ""} ${node?.desc ?? ""} ${node?.value ?? ""}`;
}

function findMemoryNav(nodes) {
  const roles = new Set(["AXButton", "AXLink", "AXRadioButton", "AXTab", "AXPopUpButton"]);
  const matches = nodes.filter(
    (node) =>
      roles.has(node?.role) &&
      textOf(node).includes("记忆") &&
      !textOf(node).includes("记忆管理") &&
      !textOf(node).includes("记忆详情") &&
      !textOf(node).includes("新建记忆"),
  );
  return matches.at(-1) ?? null;
}

function findMemoryRow(nodes) {
  // 列表是表格：优先 AXRow/AXCell，其次按 seed 内容文本定位可点击单元格。
  const rowRoles = new Set(["AXRow", "AXOutlineRow", "AXCell"]);
  const candidateTexts = ["陈九斤", "灯楼", "井底回声", "潮汐账页"];
  const rows = nodes.filter((node) => rowRoles.has(node?.role) && candidateTexts.some((text) => textOf(node).includes(text)));
  if (rows.length > 0) return rows[0];
  const textNodes = nodes.filter(
    (node) => node?.role === "AXStaticText" && candidateTexts.some((text) => textOf(node).includes(text)),
  );
  return textNodes[0] ?? null;
}

async function openMemoryPage(attempts) {
  const nodes = harness.dumpNodesForInteraction(`${FLOW_LABEL}:nav_scan`);
  const entry = findMemoryNav(nodes);
  attempts.push({ step: "find_memory_entry", ok: Boolean(entry), role: entry?.role ?? null, title: entry?.title ?? null });
  if (!entry) throw new Error("memory_entry_not_found");
  await harness.runStep("maintenance", "open_memory_page", () => {
    harness.safeClick(entry, `${FLOW_LABEL}:open_memory`);
  });
  await harness.pollAx((text) => text.includes("记忆管理"), 20_000, `${FLOW_LABEL}:memory_list_ready`);
  attempts.push({ step: "memory_list_ready", ok: true });
}

async function openMemoryDetail(attempts) {
  await harness.runStep("maintenance", "select_memory_row", () => {
    const nodes = harness.dumpNodesForInteraction(`${FLOW_LABEL}:row_scan`);
    const row = findMemoryRow(nodes);
    attempts.push({ step: "find_memory_row", ok: Boolean(row), role: row?.role ?? null, title: row?.title ?? null });
    if (!row) throw new Error("memory_row_not_found");
    harness.safeClick(row, `${FLOW_LABEL}:select_memory`);
  });
  await harness.pollAx((text) => text.includes("记忆详情"), 20_000, `${FLOW_LABEL}:memory_detail_ready`);
  attempts.push({ step: "memory_detail_ready", ok: true });
}

async function run() {
  runEvidenceMode(evidence, "prepare", dir);
  const config = readJson(path.join(dir, "native-b71-config.json"));
  if (config.journey !== "memory-detail") throw new Error(`memory-detail driver 只接受 journey=memory-detail，实测: ${config.journey}`);
  if (config.provider !== "slice_verify") throw new Error(`memory-detail driver 只接受确定性 slice_verify，实测: ${config.provider}`);

  let driverLog = null;
  try {
    await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
    await harness.runStep("maintenance", "workbench_ready", () =>
      harness.rawWaitWorkbenchSettled(FLOW_LABEL, READY_TIMEOUT_MS),
    );
    await ensureWorkSelected(harness, config.target.work_title, FLOW_LABEL);
    harness.capture("01-workbench");
    runEvidenceMode(evidence, "capture", dir, ["start"]);

    const attempts = [];
    await openMemoryPage(attempts);
    harness.capture("memory-list");
    runEvidenceMode(evidence, "capture", dir, ["memory-list"]);

    await openMemoryDetail(attempts);
    harness.capture("memory-detail");
    runEvidenceMode(evidence, "capture", dir, ["memory-detail"]);

    const rows = (() => {
      try {
        const db = null; // 纯 UI 驱动不读 DB；记忆行数由页面列表可见证据判定。
        void db;
        return null;
      } catch {
        return null;
      }
    })();

    const termination = {
      at: harness.nowIso(),
      llm_calls: logs(path.join(dir, "llm-calls")).length,
    };
    harness.capture("final");
    runEvidenceMode(evidence, "capture", dir, ["final"]);
    driverLog = {
      slice_id: config.slice_id,
      provider: "slice_verify",
      journey: "memory-detail",
      navigation: attempts,
      memory_rows: rows,
      termination,
    };
    harness.writeDriverLog("native-b71-driver-log.json", driverLog);
    console.log(`B71 memory-detail 驱动完成: attempts=${attempts.length} llm_calls=${termination.llm_calls}`);
  } finally {
    harness.writeUiComplete(config.slice_id);
  }
}

await harness.runJourney(run);
