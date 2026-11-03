// 记忆详情/列表 P0 泄漏回归判据 D1–D8 正反例 + 全类别扫描 + 合成目录端到端。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  evaluateMemoryDetail,
  scanMemoryDetailTexts,
  verifyMemoryDetailBatch,
} from "./authoring_memory_detail_evidence.mjs";

const readyAt = new Date(Date.now() - 3600_000).toISOString();

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}
const png = () => Buffer.from("89504e470d0a1a0a", "hex");

const CLEAN_LIST_TEXT =
  "记忆管理\n新建记忆\n搜索记忆...\n内容 类型 范围 状态 召回 锁定\n" +
  "陈九斤守着雨港旧灯楼，账页上记着一笔不能公开的旧账。 世界观规则 整部作品 已确认 召回 否\n" +
  "井底回声在雷雨夜出现，与上一笔欠款有关。 伏笔 整部作品 已确认 召回 否\n";
const CLEAN_DETAIL_TEXT =
  "记忆详情\n已确认\n世界观规则\n整部作品\n摘要\n灯楼旧账\n治理信息\n权重: 1\n来源类型: 作者创建\n" +
  "创建: 2026-11-04 10:00\n更新: 2026-11-04 10:00\n引用记录\n暂无引用\n";

function memoryScan({ list = CLEAN_LIST_TEXT, detail = CLEAN_DETAIL_TEXT, extraHits = [] } = {}) {
  return {
    ok: extraHits.length === 0,
    hits: extraHits,
    files: ["memory-list.ax.txt", "memory-detail.ax.txt"],
    memory_text: [list, detail].join("\n"),
  };
}

function baseArgs(overrides = {}) {
  return {
    config: { slice_id: "b71-first-consumer", journey: "memory-detail", provider: "slice_verify" },
    scan: overrides.scan ?? memoryScan(),
    driverLog: overrides.driverLog ?? { termination: { llm_calls: 0 }, navigation: [{ step: "ok" }] },
    cleanup: overrides.cleanup ?? { remaining: [], process_observation: { method: "pgrep+lsof" } },
    termination: overrides.termination ?? { llm_calls: 0 },
    runtime: overrides.runtime ?? {
      app_processes: 0,
      ports: { backend_4657: false, transport_4661: false },
      llm_calls: 0,
    },
  };
}

test("记忆详情正例：D1–D8 全过（全类别零命中/displayName/tags/时间/导航/清理）", () => {
  const result = evaluateMemoryDetail(baseArgs());
  assert.deepEqual(result.failed, []);
  assert.equal(result.checks.D1_author_visible_no_internal_tokens.ok, true);
  assert.equal(result.checks.D2_memory_status_display.ok, true);
  assert.equal(result.checks.D3_memory_dimensions_display.ok, true);
  assert.equal(result.checks.D4_tags_no_internal_ref.ok, true);
  assert.equal(result.checks.D5_local_time_format.ok, true);
  assert.equal(result.checks.D6_no_duplicate_ref_prefix.ok, true);
  assert.equal(result.checks.D7_navigation_visible.ok, true);
  assert.equal(result.checks.D8_cleanup.ok, true);
});

test("反例：状态/维度内部 code 泄漏 → D2/D3 fail", () => {
  const leaked = memoryScan({
    detail: CLEAN_DETAIL_TEXT.replace("已确认", "CONFIRMED").replace("作者创建", "AUTHOR_CONFIRMED").replace("整部作品", "WORK"),
  });
  const result = evaluateMemoryDetail(baseArgs({ scan: leaked }));
  assert.equal(result.checks.D2_memory_status_display.ok, false);
  assert.equal(result.checks.D3_memory_dimensions_display.ok, false);
});

test("反例：ISO 时间 / candidate: 内部 ref / 重复前缀 分别 fail", () => {
  const iso = evaluateMemoryDetail(
    baseArgs({ scan: memoryScan({ detail: CLEAN_DETAIL_TEXT.replace("2026-11-04 10:00", "2026-11-04T10:00:00Z") }) }),
  );
  assert.equal(iso.checks.D5_local_time_format.ok, false);
  const ref = evaluateMemoryDetail(
    baseArgs({ scan: memoryScan({ detail: CLEAN_DETAIL_TEXT + "\n标签: candidate:cand_1 candidate_set:candset_1 decision:dec_1" }) }),
  );
  assert.equal(ref.checks.D4_tags_no_internal_ref.ok, false);
  const dup = evaluateMemoryDetail(
    baseArgs({ scan: memoryScan({ detail: CLEAN_DETAIL_TEXT + "\n标签: candidate_set:candidate_set:candset_1" }) }),
  );
  assert.equal(dup.checks.D6_no_duplicate_ref_prefix.ok, false);
});

test("反例：全类别扫描命中 / 导航缺失 / 清理失败 → D1/D7/D8 fail", () => {
  const hit = evaluateMemoryDetail(
    baseArgs({ scan: memoryScan({ extraHits: [{ file: "memory-detail.ax.txt", token: "prose_writing", kind: "protocol_codes", source: "ax:value", context: "已确认「prose_writing」操作" }] }) }),
  );
  assert.equal(hit.checks.D1_author_visible_no_internal_tokens.ok, false);
  const nav = evaluateMemoryDetail(
    baseArgs({ scan: memoryScan({ list: "记忆管理", detail: "普通内容" }) }),
  );
  assert.equal(nav.checks.D7_navigation_visible.ok, false);
  const cleanup = evaluateMemoryDetail(baseArgs({ cleanup: { remaining: [{ pid: 1 }] } }));
  assert.equal(cleanup.checks.D8_cleanup.ok, false);
});

test("合成目录端到端：verify 通过并写 summary；内部 code 泄漏时失败关闭", () => {
  const dir = buildDir();
  const { result, summary } = verifyMemoryDetailBatch(dir);
  assert.deepEqual(result.failed, []);
  assert.equal(summary.verdict.mechanism, "pass");
  assert.equal(summary.verdict.p0_leak_fixed, true);
  fs.rmSync(dir, { recursive: true, force: true });

  const failing = buildDir({ detail: CLEAN_DETAIL_TEXT.replace("已确认", "CONFIRMED") });
  assert.throws(() => verifyMemoryDetailBatch(failing), /memory-detail 判据失败/u);
  fs.rmSync(failing, { recursive: true, force: true });
});

function buildDir({ detail = CLEAN_DETAIL_TEXT } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-memory-detail-"));
  writeJson(path.join(dir, "native-driver-ready.json"), {
    driver: "external-system-ui",
    browser_driver_started: false,
    run_ref: "run-ref-memory",
    provider: "slice_verify",
    slice_id: "b71-first-consumer",
    ready_at: readyAt,
    app_path: "/tmp/B71 Memory Detail.app",
  });
  writeJson(path.join(dir, "native-b71-config.json"), {
    slice_id: "b71-first-consumer",
    journey: "memory-detail",
    provider: "slice_verify",
    target: { work_id: "work-memory-1", work_title: "记忆验证作品" },
    message: "打开记忆管理并查看记忆详情（作者可见文案回归）。",
  });
  const screenshots = ["01-workbench.jpg", "memory-detail.jpg"];
  for (const name of screenshots) fs.writeFileSync(path.join(dir, name), png());
  writeJson(path.join(dir, "native-ui-complete.json"), {
    harness_run_ref: "run-ref-memory",
    driver: "ax-native-system-ui",
    app_bundle: "com.ai-novel-studio.app",
    scope: "b71-first-consumer",
    screenshots,
  });
  const kinds = ["maintenance", "maintenance", "maintenance"];
  writeJsonl(
    path.join(dir, "native-driver-commands.jsonl"),
    kinds.flatMap((kind, index) => [
      { op: "begin", id: `wait-${index}`, kind },
      { op: "finish", id: `wait-${index}`, kind },
    ]),
  );
  writeJsonl(
    path.join(dir, "wait-events.jsonl"),
    kinds.flatMap((kind, index) => [
      { event: "wait_start", kind, at: Date.now() - 6000, id: `wait-${index}` },
      { event: "wait_end", kind, ended_at: Date.now() - 5000, id: `wait-${index}` },
    ]),
  );
  writeJson(path.join(dir, "wait-stats.json"), { active: null, completed: kinds.length });
  writeJsonl(path.join(dir, "heartbeat.jsonl"), [{ at: readyAt }]);
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
    termination: { at: new Date().toISOString(), llm_calls: 0 },
  });
  writeJson(path.join(dir, "native-app-cleanup.json"), { remaining: [], process_observation: { method: "pgrep+lsof", actions: [] } });
  // 确定性 slice_verify 无 llm-calls 文件：runtime 检查按 0 次统计（目录缺失=0）。
  for (const name of ["start", "memory-list", "memory-detail", "final"]) {
    writeJson(path.join(dir, `b71-${name}.json`), {
      checkpoint: name,
      db_production_counts: {},
    });
  }
  fs.writeFileSync(path.join(dir, "memory-list.ax.txt"), `\t\t0/0/0/0/0/1 AXStaticText, Value: ${CLEAN_LIST_TEXT.replace(/\n/g, " ")}\n`);
  fs.writeFileSync(path.join(dir, "memory-list.text.txt"), CLEAN_LIST_TEXT);
  fs.writeFileSync(path.join(dir, "memory-detail.ax.txt"), `\t\t0/0/0/0/0/2 AXStaticText, Value: ${detail.replace(/\n/g, " ")}\n`);
  fs.writeFileSync(path.join(dir, "memory-detail.text.txt"), detail);
  fs.writeFileSync(path.join(dir, "01-workbench.ax.txt"), "\t\t0/0/0/0/0/3 AXStaticText, Value: 项目\n");
  fs.writeFileSync(path.join(dir, "01-workbench.text.txt"), "项目\n");
  fs.writeFileSync(path.join(dir, "final.ax.txt"), "\t\t0/0/0/0/0/4 AXStaticText, Value: 记忆详情\n");
  fs.writeFileSync(path.join(dir, "final.text.txt"), "记忆详情\n");
  return dir;
}
