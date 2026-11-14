// B71 memory-detail 证据族唯一的真实文件 fixture owner。
//
// 合成目录包含 ready/config/截图/等待账/心跳/transport/driver-log/cleanup/checkpoint
// 与 AX+可见文本；本族是纯 UI 导航回归，不含 SQLite。合成证据对应既有确定性
// slice_verify 批次，不读取作者源数据。
//
// 模板发布后只读；需要改 config、删证据或让 verify 写 summary 的 case 经
// `withWorkingCopy` 取隔离副本。时间字段固定为历史批次值，使同一规格在 run 内只
// 物化一次。
import fs from "node:fs";
import path from "node:path";
import {
  CLEAN_DETAIL_TEXT,
  CLEAN_LIST_TEXT,
  MEMORY_ENDED_AT,
  MEMORY_READY_AT,
  MEMORY_SCREENSHOTS,
  MEMORY_WAIT_BASE,
  png,
} from "./authoring_memory_detail_facts.mjs";

const WAIT_KINDS = ["maintenance", "maintenance", "maintenance"];
const CHECKPOINTS = ["start", "memory-list", "memory-detail", "final"];

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

function writeScreenshots(dir) {
  for (const name of MEMORY_SCREENSHOTS) fs.writeFileSync(path.join(dir, name), png());
}

function writeReadyAndConfig(dir) {
  writeJson(path.join(dir, "native-driver-ready.json"), {
    driver: "external-system-ui",
    browser_driver_started: false,
    run_ref: "run-ref-memory",
    provider: "slice_verify",
    slice_id: "b71-first-consumer",
    ready_at: MEMORY_READY_AT,
    app_path: "/tmp/B71 Memory Detail.app",
  });
  writeJson(path.join(dir, "native-b71-config.json"), {
    slice_id: "b71-first-consumer",
    journey: "memory-detail",
    provider: "slice_verify",
    target: { work_id: "work-memory-1", work_title: "记忆验证作品" },
    message: "打开记忆管理并查看记忆详情（作者可见文案回归）。",
  });
}

function writeWaitEvidence(dir) {
  writeJson(path.join(dir, "native-ui-complete.json"), {
    harness_run_ref: "run-ref-memory",
    driver: "ax-native-system-ui",
    app_bundle: "com.ai-novel-studio.app",
    scope: "b71-first-consumer",
    screenshots: MEMORY_SCREENSHOTS,
  });
  writeJsonl(
    path.join(dir, "native-driver-commands.jsonl"),
    WAIT_KINDS.flatMap((kind, index) => [
      { op: "begin", id: `wait-${index}`, kind },
      { op: "finish", id: `wait-${index}`, kind },
    ]),
  );
  writeJsonl(
    path.join(dir, "wait-events.jsonl"),
    WAIT_KINDS.flatMap((kind, index) => [
      { event: "wait_start", kind, at: MEMORY_WAIT_BASE + index * 1000, id: `wait-${index}` },
      { event: "wait_end", kind, ended_at: MEMORY_WAIT_BASE + index * 1000 + 500, id: `wait-${index}` },
    ]),
  );
  writeJson(path.join(dir, "wait-stats.json"), { active: null, completed: WAIT_KINDS.length });
  writeJsonl(path.join(dir, "heartbeat.jsonl"), [{ at: MEMORY_READY_AT }]);
}

function writeTransportAndLogs(dir) {
  writeJsonl(path.join(dir, "native-transport.jsonl"), [
    { at: "2026-11-04T10:00:01.000Z", direction: "http", method: "GET", path: "/api/health", status: 200 },
    { at: "2026-11-04T10:00:01.100Z", direction: "sent", frame: [null, "1", "phoenix", "heartbeat", {}] },
    { at: "2026-11-04T10:00:01.150Z", direction: "received", frame: [null, "1", "phoenix", "phx_reply", { status: "ok", response: {} }] },
  ]);
  writeJson(path.join(dir, "native-b71-driver-log.json"), {
    slice_id: "b71-first-consumer",
    provider: "slice_verify",
    journey: "memory-detail",
    navigation: [{ step: "memory_list_ready", ok: true }, { step: "memory_detail_ready", ok: true }],
    memory_rows: null,
    termination: { at: MEMORY_ENDED_AT, llm_calls: 0 },
  });
  writeJson(path.join(dir, "native-app-cleanup.json"), {
    remaining: [],
    process_observation: { method: "pgrep+lsof", actions: [] },
  });
  // 确定性 slice_verify 无 llm-calls 文件：runtime 检查按 0 次统计（目录缺失=0）。
  for (const name of CHECKPOINTS) {
    writeJson(path.join(dir, `b71-${name}.json`), {
      checkpoint: name,
      db_production_counts: {},
    });
  }
}

function writeAuthorVisibleTexts(dir, detail) {
  fs.writeFileSync(
    path.join(dir, "memory-list.ax.txt"),
    `\t\t0/0/0/0/0/1 AXStaticText, Value: ${CLEAN_LIST_TEXT.replace(/\n/g, " ")}\n`,
  );
  fs.writeFileSync(path.join(dir, "memory-list.text.txt"), CLEAN_LIST_TEXT);
  fs.writeFileSync(
    path.join(dir, "memory-detail.ax.txt"),
    `\t\t0/0/0/0/0/2 AXStaticText, Value: ${detail.replace(/\n/g, " ")}\n`,
  );
  fs.writeFileSync(path.join(dir, "memory-detail.text.txt"), detail);
  fs.writeFileSync(path.join(dir, "01-workbench.ax.txt"), "\t\t0/0/0/0/0/3 AXStaticText, Value: 项目\n");
  fs.writeFileSync(path.join(dir, "01-workbench.text.txt"), "项目\n");
  fs.writeFileSync(path.join(dir, "final.ax.txt"), "\t\t0/0/0/0/0/4 AXStaticText, Value: 记忆详情\n");
  fs.writeFileSync(path.join(dir, "final.text.txt"), "记忆详情\n");
}

// 声明完整发布路径；materializeFixture 会核对真实文件集合与声明一致。
function payloadPaths() {
  return [
    "native-driver-ready.json",
    "native-b71-config.json",
    ...MEMORY_SCREENSHOTS,
    "native-ui-complete.json",
    "native-driver-commands.jsonl",
    "wait-events.jsonl",
    "wait-stats.json",
    "heartbeat.jsonl",
    "native-transport.jsonl",
    "native-b71-driver-log.json",
    "native-app-cleanup.json",
    ...CHECKPOINTS.map((name) => `b71-${name}.json`),
    "memory-list.ax.txt",
    "memory-list.text.txt",
    "memory-detail.ax.txt",
    "memory-detail.text.txt",
    "01-workbench.ax.txt",
    "01-workbench.text.txt",
    "final.ax.txt",
    "final.text.txt",
  ];
}

/**
 * memory-detail 合成证据目录规格。`detail` 是唯一可变输入（默认干净文案，负例传
 * 含内部 code 的文案）；同一 detail 在 run 内只物化一次。
 */
export function memoryDetailFixtureSpec({ detail = CLEAN_DETAIL_TEXT } = {}) {
  return {
    name: "b71-memory-detail",
    inputs: {
      detail,
      ready_at: MEMORY_READY_AT,
      wait_base: String(MEMORY_WAIT_BASE),
      builder_source: fs.readFileSync(new URL(import.meta.url), "utf8"),
    },
    build(staging) {
      writeReadyAndConfig(staging);
      writeScreenshots(staging);
      writeWaitEvidence(staging);
      writeTransportAndLogs(staging);
      writeAuthorVisibleTexts(staging, detail);
      return payloadPaths();
    },
  };
}
