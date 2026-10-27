// B61 CP2 原生验收外部驱动：AU07×3（ToolTrace registry/redacted IO、E2E-01 只读工具 trace、
// E2E-01 ReplayReport 六问）。
//
// 用 macOS AX/CGEvent 操作真实 Tauri 窗口（原生窗口 + 真实 Phoenix 后端 + 嵌入真实前端）：
// 打开工作台 → 选中 seed 作品 → 在可见输入框发送「先看看当前已有角色阵容，然后设计一个与
// 主角形成镜像冲突的主要反派。」→ 等待 AgentRun 内部只读 character_roster 步完成与最终回复
// → 以该只读步 turn_id 查询产品持久 trace 并生成 no-provider ReplayReport。
// 证据由 scripts/native_au07_evidence.mjs 只读核验；本驱动不写断言结论，也不采纳任何候选。
// 产品代码不读取本文件；驱动只用用户可见语义（窗口标题/按钮文案/输入框/AX 可见文本）。
// 用法：node scripts/native_au07_drive.mjs <batch-run-dir>
import path from "node:path";
import { readJson, sleep } from "./lib/native_ui/driver.mjs";
import {
  NativeScenarioHarness,
  ROOT,
  ensureWorkSelected,
  frameBody,
  runEvidenceMode,
} from "./lib/native_ui/scenario_driver.mjs";
import { queryTraceByTurn } from "./native_au07_evidence.mjs";

const dir = path.resolve(process.argv[2] ?? "");
if (!dir) {
  console.error("usage: node scripts/native_au07_drive.mjs <batch-run-dir>");
  process.exit(64);
}
const EVIDENCE = path.join(ROOT, "scripts/native_au07_evidence.mjs");
const harness = new NativeScenarioHarness(dir);

async function run() {
  runEvidenceMode(EVIDENCE, "prepare", dir);
  const config = readJson(path.join(dir, "native-au07-config.json"));
  const sliceId = config.slice_id;
  const target = config.target;

  await harness.runStep("maintenance", "launch_app", () => harness.rawLaunchApp());
  await harness.runStep("maintenance", "workbench_ready:initial", () =>
    harness.rawWaitWorkbenchSettled("initial"),
  );
  await ensureWorkSelected(harness, target.work_id, target.work_title, "initial");
  harness.capture("01-workbench");
  runEvidenceMode(EVIDENCE, "capture", dir, ["start"]);

  await harness.runStep("maintenance", "input_ready", () => harness.rawWaitInputReady("turn"));
  const sent = await harness.runStep("input", "type_send", () =>
    harness.rawTypeAndSend(config.request_text, "turn"),
  );
  if (!frameBody(sent)) throw new Error("user_message_without_payload");
  await harness.runStep("ack", "ack", () =>
    harness.pollWire((wire) => harness.ackFor(wire, sent), 25_000, "ack"),
  );

  // 判断纪元：bounded AgentRun 内部第一步真实下发只读 character_roster（Orchestrator
  // allow_tool + Toolbox），中间步 turn_result 广播到真实窗口。等待该只读步完成。
  const rosterRecord = await harness.runStep("turn", "readonly_roster_step", () =>
    harness.pollWire(
      (wire) =>
        wire.find(
          (entry) =>
            entry.direction === "received" &&
            Array.isArray(entry.frame) &&
            entry.frame.length >= 5 &&
            entry.frame[3] === "turn_result" &&
            String(entry.frame[4]?.work_id ?? "") === target.work_id &&
            entry.frame[4]?.tool_result?.tool_name === "character_roster" &&
            entry.frame[4]?.tool_result?.status === "succeeded",
        ) ?? null,
      110_000,
      "readonly_roster_step",
    ),
  );
  const rosterTurn = frameBody(rosterRecord);
  const stepTurnId = String(rosterTurn?.turn_id ?? "");
  if (!stepTurnId) throw new Error("roster_step_turn_id_missing");

  // 可见证据：真实窗口渲染该步 AI 回复（含已确认角色），随后 run 终态完成。
  await harness.runStep("maintenance", "roster_reply_visible", () =>
    harness.pollAx((text) => text.includes("林澈"), 90_000, "roster_reply_visible"),
  );
  harness.capture("02-roster-step");
  await harness.runStep("maintenance", "run_terminal", () =>
    harness.pollWire(
      (wire) =>
        wire.find(
          (entry) =>
            entry.direction === "received" &&
            Array.isArray(entry.frame) &&
            entry.frame.length >= 5 &&
            entry.frame[3] === "agent_run_state" &&
            String(entry.frame[4]?.work_id ?? "") === target.work_id &&
            entry.frame[4]?.status === "completed",
        ) ?? null,
      90_000,
      "run_terminal",
    ),
  );
  await sleep(900);
  harness.capture("03-final");

  // 外部以只读步 turn_id 回查产品持久 trace（TraceRepository.list_by_turn/1 +
  // ReplayService.build_report/1），落在 native artifact dir 的 trace-query.json。
  const traceQuery = await harness.runStep("maintenance", "trace_query", () =>
    queryTraceByTurn(dir, stepTurnId),
  );
  runEvidenceMode(EVIDENCE, "capture", dir, ["final"]);

  harness.writeDriverLog("native-au07-driver-log.json", {
    slice_id: sliceId,
    provider: harness.provider,
    work_id: target.work_id,
    work_title: target.work_title,
    session_id: target.session_id,
    request_text: config.request_text,
    step_turn_id: stepTurnId,
    trace_query_count: traceQuery.count,
    trace_query_turn_id: traceQuery.turn_id,
  });
  harness.writeUiComplete(sliceId);
  console.log(
    `AU07 原生驱动完成: slice=${sliceId} step_turn_id=${stepTurnId} ` +
      `trace_count=${traceQuery.count} screenshots=${harness.screenshots.length}`,
  );
}

run().catch((error) => harness.fail(error));
