// 记忆详情/列表 P0 泄漏回归判据 D1–D8 正反例 + 全类别扫描 + 合成目录端到端。
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  evaluateMemoryDetail,
  runtimeAfterBatch,
  scanMemoryDetailTexts,
  verifyMemoryDetailBatch,
} from "./authoring_memory_detail_evidence.mjs";

const DISPLAY_NAMES_SSOT = JSON.parse(
  fs.readFileSync(
    new URL("../../../docs/design/schemas/author_visible/display_names.json", import.meta.url),
    "utf8",
  ),
);
const MEMORY_DOMAIN_KEYS = Object.freeze({
  status: "memory_status",
  type: "memory_type",
  scope: "memory_scope",
  source: "memory_source_type",
});
const readyAt = new Date(Date.now() - 3600_000).toISOString();

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}
const png = () => Buffer.from("89504e470d0a1a0a", "hex");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil(read, accept, timeoutMs = 3000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let value = read();
  while (!accept(value) && Date.now() < deadline) {
    await delay(intervalMs);
    value = read();
  }
  return value;
}

function settledChild(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

async function stopOwnedChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  if (await settledChild(child, 3000)) return;
  child.kill("SIGKILL");
  await settledChild(child, 3000);
}

async function spawnNode(args, stdio) {
  const child = spawn(process.execPath, args, { stdio });
  await once(child, "spawn");
  return child;
}

function waitForStdout(child, marker, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`等待子进程输出 ${marker} 超时；已收到: ${output}`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
    };
    const onData = (chunk) => {
      output += chunk;
      if (output.includes(marker)) {
        cleanup();
        resolve(output);
      }
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`listener 提前退出 code=${code} signal=${signal}；已收到: ${output}`));
    };
    child.stdout.on("data", onData);
    child.once("exit", onExit);
  });
}

function lsofListen(port) {
  const args = ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"];
  try {
    const stdout = execFileSync("lsof", args, { encoding: "utf8" });
    return { listeners: stdout.split("\n").filter((line) => line.includes("LISTEN")), error: null };
  } catch (error) {
    const stdout = String(error.stdout ?? "");
    const listeners = stdout.split("\n").filter((line) => line.includes("LISTEN"));
    if (listeners.length > 0) return { listeners, error: null };
    const stderr = String(error.stderr ?? "").trim();
    if (error.status === 1 && stderr === "") return { listeners: [], error: null };
    return { listeners: [], error: stderr || `lsof 退出码 ${error.status ?? "unknown"}` };
  }
}

const TCP_LISTENER_SCRIPT = `
const net = require("node:net");
const ports = [4657, 4661];
let listening = 0;
for (const port of ports) {
  const server = net.createServer((socket) => socket.end());
  server.on("error", (error) => {
    console.error("listen-error:" + port + ":" + error.code);
    process.exit(2);
  });
  server.listen(port, "127.0.0.1", () => {
    listening += 1;
    if (listening === ports.length) console.log("ready");
  });
}
`;

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
    scan: overrides.scan ?? memoryScan(),
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
  assert.deepEqual(result.required, [
    "D1_author_visible_no_internal_tokens",
    "D2_memory_status_display",
    "D3_memory_dimensions_display",
    "D4_tags_no_internal_ref",
    "D5_local_time_format",
    "D6_no_duplicate_ref_prefix",
    "D7_navigation_visible",
    "D8_cleanup",
  ]);
  assert.equal(result.checks.D1_author_visible_no_internal_tokens.ok, true);
  assert.equal(result.checks.D2_memory_status_display.ok, true);
  assert.equal(result.checks.D2_memory_status_display.reason, null);
  assert.equal(result.checks.D3_memory_dimensions_display.ok, true);
  assert.equal(result.checks.D3_memory_dimensions_display.reason, null);
  assert.equal(result.checks.D4_tags_no_internal_ref.ok, true);
  assert.equal(result.checks.D4_tags_no_internal_ref.reason, null);
  assert.equal(result.checks.D5_local_time_format.ok, true);
  assert.equal(result.checks.D5_local_time_format.reason, null);
  assert.equal(result.checks.D6_no_duplicate_ref_prefix.ok, true);
  assert.equal(result.checks.D6_no_duplicate_ref_prefix.reason, null);
  assert.equal(result.checks.D7_navigation_visible.ok, true);
  assert.equal(result.checks.D7_navigation_visible.reason, null);
  assert.equal(result.checks.D8_cleanup.ok, true);
  assert.equal(result.checks.D8_cleanup.reason, null);
});

test("反例：状态/维度内部 code 泄漏 → D2/D3 fail", () => {
  const leaked = memoryScan({
    detail: CLEAN_DETAIL_TEXT.replace("已确认", "CONFIRMED").replace("作者创建", "AUTHOR_CONFIRMED").replace("整部作品", "WORK"),
  });
  const result = evaluateMemoryDetail(baseArgs({ scan: leaked }));
  assert.equal(result.checks.D2_memory_status_display.ok, false);
  assert.equal(result.checks.D2_memory_status_display.reason, "memory_status_code_leaked");
  assert.equal(result.checks.D3_memory_dimensions_display.ok, false);
  assert.equal(result.checks.D3_memory_dimensions_display.reason, "memory_dimension_display_missing_or_code_leaked");
});

test("反例：状态/维度展示缺失 → D2/D3 fail", () => {
  const statusMissing = evaluateMemoryDetail(
    baseArgs({
      scan: memoryScan({ list: "记忆管理\n", detail: "记忆详情\n整部作品\n来源类型: 作者创建\n创建: 2026-11-04 10:00\n" }),
    }),
  );
  assert.equal(statusMissing.checks.D2_memory_status_display.ok, false);
  assert.equal(statusMissing.checks.D2_memory_status_display.reason, "memory_status_display_missing");

  const typeMissing = evaluateMemoryDetail(
    baseArgs({
      scan: memoryScan({ list: "记忆管理\n", detail: "记忆详情\n已确认\n整部作品\n来源类型: 作者创建\n创建: 2026-11-04 10:00\n" }),
    }),
  );
  assert.equal(typeMissing.checks.D3_memory_dimensions_display.ok, false);
  assert.equal(typeMissing.checks.D3_memory_dimensions_display.reason, "memory_dimension_display_missing_or_code_leaked");
});

test("反例：ISO 时间 / candidate: 内部 ref / 重复前缀 分别 fail", () => {
  const iso = evaluateMemoryDetail(
    baseArgs({ scan: memoryScan({ detail: CLEAN_DETAIL_TEXT.replace("2026-11-04 10:00", "2026-11-04T10:00:00Z") }) }),
  );
  assert.equal(iso.checks.D5_local_time_format.ok, false);
  const bothTimes = evaluateMemoryDetail(
    baseArgs({ scan: memoryScan({ detail: `${CLEAN_DETAIL_TEXT}2026-11-04T10:00:00Z\n` }) }),
  );
  assert.equal(bothTimes.checks.D5_local_time_format.ok, false);
  assert.equal(bothTimes.checks.D5_local_time_format.reason, "iso_time_leaked");
  const ref = evaluateMemoryDetail(
    baseArgs({ scan: memoryScan({ detail: CLEAN_DETAIL_TEXT + "\n标签: candidate:cand_1 candidate_set:candset_1 decision:dec_1" }) }),
  );
  assert.equal(ref.checks.D4_tags_no_internal_ref.ok, false);
  assert.equal(ref.checks.D4_tags_no_internal_ref.reason, "internal_ref_tag_leaked");
  const dup = evaluateMemoryDetail(
    baseArgs({ scan: memoryScan({ detail: CLEAN_DETAIL_TEXT + "\n标签: candidate_set:candidate_set:candset_1" }) }),
  );
  assert.equal(dup.checks.D6_no_duplicate_ref_prefix.ok, false);
});

test("反例：全类别扫描命中 / 导航缺失 / 清理失败 → D1/D7/D8 fail", () => {
  const hit = evaluateMemoryDetail(
    baseArgs({
      scan: memoryScan({
        extraHits: [
          { file: "memory-detail.ax.txt", token: "prose_writing", kind: "protocol_codes", source: "ax:value", context: "已确认「prose_writing」操作" },
          { file: "memory-detail.text.txt", token: "工作过程", kind: "internal_terms_zh", source: "visible", context: "工作过程" },
        ],
      }),
    }),
  );
  assert.equal(hit.checks.D1_author_visible_no_internal_tokens.ok, false);
  assert.deepEqual(
    hit.checks.D1_author_visible_no_internal_tokens.detail.hits.map((entry) => entry.token),
    ["prose_writing", "工作过程"],
  );
  const navDetailMissing = evaluateMemoryDetail(
    baseArgs({ scan: memoryScan({ list: "记忆管理", detail: "普通内容" }) }),
  );
  assert.equal(navDetailMissing.checks.D7_navigation_visible.ok, false);
  assert.equal(navDetailMissing.checks.D7_navigation_visible.reason, "memory_detail_not_visible");
  const navListMissing = evaluateMemoryDetail(
    baseArgs({ scan: memoryScan({ list: "普通内容", detail: "记忆详情" }) }),
  );
  assert.equal(navListMissing.checks.D7_navigation_visible.ok, false);
  assert.equal(navListMissing.checks.D7_navigation_visible.reason, "memory_list_not_visible");
  const cleanup = evaluateMemoryDetail(baseArgs({ cleanup: { remaining: [{ pid: 1 }] } }));
  assert.equal(cleanup.checks.D8_cleanup.ok, false);
});

test("SSOT 四 domain 每个 code 都被 exact token 识别为泄漏", () => {
  const leakChecks = {
    status: { check: "D2_memory_status_display", field: "code_leaks" },
    type: { check: "D3_memory_dimensions_display", field: "type_code_leaks" },
    scope: { check: "D3_memory_dimensions_display", field: "scope_code_leaks" },
    source: { check: "D3_memory_dimensions_display", field: "source_code_leaks" },
  };
  for (const [key, domain] of Object.entries(MEMORY_DOMAIN_KEYS)) {
    for (const code of Object.keys(DISPLAY_NAMES_SSOT.domains[domain])) {
      const result = evaluateMemoryDetail(
        baseArgs({ scan: memoryScan({ detail: `${CLEAN_DETAIL_TEXT}诊断标识: ${code}\n` }) }),
      );
      const check = result.checks[leakChecks[key].check];
      assert.ok(
        check.detail[leakChecks[key].field].includes(code),
        `${domain}.${code} 应被识别为内部 code 泄漏`,
      );
      assert.equal(check.ok, false, `${domain}.${code} 泄漏时 ${leakChecks[key].check} 必须失败`);
    }
  }
});

test("标识符边界：非 exact token 不误判，中文相邻 exact token 仍命中", () => {
  const nearMiss = `${CLEAN_DETAIL_TEXT}备注: WORKSHOP RECONFIRMED AUTHOR_CONFIRMED_EXTRA IDEA_DRAFT XWORK CONFIRMED2 GLOBAL_SCOPE\n`;
  const clean = evaluateMemoryDetail(baseArgs({ scan: memoryScan({ detail: nearMiss }) }));
  assert.deepEqual(clean.checks.D2_memory_status_display.detail.code_leaks, []);
  assert.deepEqual(clean.checks.D3_memory_dimensions_display.detail.type_code_leaks, []);
  assert.deepEqual(clean.checks.D3_memory_dimensions_display.detail.scope_code_leaks, []);
  assert.deepEqual(clean.checks.D3_memory_dimensions_display.detail.source_code_leaks, []);
  assert.equal(clean.checks.D2_memory_status_display.ok, true);
  assert.equal(clean.checks.D3_memory_dimensions_display.ok, true);

  const embedded = evaluateMemoryDetail(
    baseArgs({ scan: memoryScan({ detail: `${CLEAN_DETAIL_TEXT}状态CONFIRMED，范围WORK，来源AUTHOR_CONFIRMED。\n` }) }),
  );
  assert.ok(embedded.checks.D2_memory_status_display.detail.code_leaks.includes("CONFIRMED"));
  assert.ok(embedded.checks.D3_memory_dimensions_display.detail.scope_code_leaks.includes("WORK"));
  assert.ok(embedded.checks.D3_memory_dimensions_display.detail.source_code_leaks.includes("AUTHOR_CONFIRMED"));
});

test("中文展示表按实际 SSOT 数据枚举：四 domain 全部展示值被识别", () => {
  const domains = DISPLAY_NAMES_SSOT.domains;
  const detail = [
    "记忆详情",
    ...Object.values(domains.memory_status),
    ...Object.values(domains.memory_type),
    ...Object.values(domains.memory_scope),
    `来源类型: ${Object.values(domains.memory_source_type).join(" ")}`,
    "创建: 2026-11-04 10:00",
    "更新: 2026-11-04 10:00",
  ].join("\n");
  const result = evaluateMemoryDetail(baseArgs({ scan: memoryScan({ detail }) }));
  const dimensions = result.checks.D3_memory_dimensions_display.detail;
  assert.deepEqual(result.checks.D2_memory_status_display.detail.display_words, Object.values(domains.memory_status));
  assert.deepEqual(dimensions.type_words, Object.values(domains.memory_type));
  assert.deepEqual(dimensions.scope_words, Object.values(domains.memory_scope));
  assert.deepEqual(dimensions.source_words, Object.values(domains.memory_source_type));
  assert.equal(result.checks.D2_memory_status_display.ok, true);
  assert.equal(result.checks.D3_memory_dimensions_display.ok, true);
});

test("D1 全类别扫描：真实文件中的协议码与中文内部术语仍被扫描", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-memory-scan-"));
  try {
    fs.writeFileSync(path.join(dir, "memory-list.text.txt"), "记忆管理\n工作过程\n");
    fs.writeFileSync(
      path.join(dir, "memory-detail.ax.txt"),
      "\t\t0/0/0/0/0/1 AXStaticText, Value: prose_writing\n",
    );
    const scan = scanMemoryDetailTexts(dir);
    assert.equal(scan.ok, false);
    const tokens = new Set(scan.hits.map((hit) => hit.token));
    assert.ok(tokens.has("工作过程"), "中文内部术语仍须被全类别扫描命中");
    assert.ok(tokens.has("prose_writing"), "协议码仍须被全类别扫描命中");
    const missing = scanMemoryDetailTexts(path.join(dir, "not-a-directory"));
    assert.equal(missing.ok, false);
    assert.deepEqual(missing.files, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("D1 命中证据 context 从可见文本首字符起精确取 240 字符", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-memory-context-"));
  const visible = `${"雨港旧灯楼的账页记着一笔未结的旧账。".repeat(20)}工作过程`;
  try {
    fs.writeFileSync(path.join(dir, "memory-detail.text.txt"), visible);
    const scan = scanMemoryDetailTexts(dir);
    const hit = scan.hits.find((entry) => entry.token === "工作过程");
    assert.ok(hit, "真实可见文本中的内部术语必须产生命中证据");
    assert.equal(hit.source, "visible");
    assert.equal(hit.context.length, 240);
    assert.equal(hit.context, visible.slice(0, 240));
    assert.equal(hit.context.startsWith(visible[0]), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("D8 清理判据：runtime 缺失/进程/端口/llm 未停均失败", () => {
  const base = baseArgs();
  const runtimes = [
    null,
    { app_processes: 1, ports: { backend_4657: false, transport_4661: false }, llm_calls: 0 },
    { app_processes: 0, ports: { backend_4657: true, transport_4661: false }, llm_calls: 0 },
    { app_processes: 0, ports: { backend_4657: false, transport_4661: true }, llm_calls: 0 },
    { app_processes: 0, ports: { backend_4657: false, transport_4661: false }, llm_calls: 1 },
  ];
  for (const runtime of runtimes) {
    const result = evaluateMemoryDetail({ ...base, runtime });
    assert.equal(result.checks.D8_cleanup.ok, false);
    assert.equal(result.checks.D8_cleanup.reason, "cleanup_unverified_or_runtime_not_stopped");
    if (runtime?.llm_calls === 1) {
      assert.equal(result.checks.D8_cleanup.detail.llm_calls_stopped, false);
    }
  }
  const noEvidence = evaluateMemoryDetail({ ...base, cleanup: null, termination: null, runtime: null });
  assert.equal(noEvidence.checks.D8_cleanup.ok, false);
  assert.equal(noEvidence.checks.D8_cleanup.detail.remaining, 0);
});

test("runtimeAfterBatch：缺失/非法 ready 与 llm-calls 目录统计", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-memory-runtime-"));
  try {
    const empty = runtimeAfterBatch(dir);
    assert.ok(Number.isInteger(empty.app_processes));
    assert.equal(typeof empty.ports.backend_4657, "boolean");
    assert.equal(typeof empty.ports.transport_4661, "boolean");
    assert.equal(empty.llm_calls, 0);

    writeJson(path.join(dir, "native-driver-ready.json"), { app_path: path.join(dir, "B71-no-such-app") });
    assert.ok(Number.isInteger(runtimeAfterBatch(dir).app_processes));

    fs.mkdirSync(path.join(dir, "llm-calls"));
    writeJsonl(path.join(dir, "llm-calls", "a.jsonl"), [{ a: 1 }, { b: 2 }]);
    fs.appendFileSync(path.join(dir, "llm-calls", "a.jsonl"), "not-json\n");
    assert.equal(runtimeAfterBatch(dir).llm_calls, 2);

    fs.writeFileSync(path.join(dir, "native-driver-ready.json"), "not-json");
    assert.ok(Number.isInteger(runtimeAfterBatch(dir).app_processes));

    fs.writeFileSync(path.join(dir, "native-driver-ready.json"), "null");
    assert.ok(Number.isInteger(runtimeAfterBatch(dir).app_processes));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runtimeAfterBatch：ready.app_path 只统计本次目标进程，不统计其他进程", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-memory-apppath-"));
  const stamp = `${process.pid}${Date.now()}`;
  const target = `b71target${stamp}`;
  const other = `b71other${stamp}`;
  const children = [];
  try {
    writeJson(path.join(dir, "native-driver-ready.json"), { app_path: target });
    children.push(await spawnNode(["-e", "setInterval(() => {}, 1000)", target], "ignore"));
    children.push(await spawnNode(["-e", "setInterval(() => {}, 1000)", other], "ignore"));
    for (const child of children) process.kill(child.pid, 0);

    const targetCount = await pollUntil(
      () => runtimeAfterBatch(dir).app_processes,
      (count) => count === 1,
    );
    assert.equal(targetCount, 1, "目标进程存活时只应统计到 1 个目标进程");

    writeJson(path.join(dir, "native-driver-ready.json"), { app_path: other });
    const otherCount = await pollUntil(
      () => runtimeAfterBatch(dir).app_processes,
      (count) => count === 1,
    );
    assert.equal(otherCount, 1, "切换 app_path 后证明另一个自有进程同样可见且按路径选择");
  } finally {
    for (const child of children) await stopOwnedChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runtimeAfterBatch：真实 TCP listener 使 4657/4661 为 true，关闭后为 false", async (t) => {
  const portChecks = [4657, 4661].map((port) => ({ port, ...lsofListen(port) }));
  const probeErrors = portChecks.filter((check) => check.error !== null);
  if (probeErrors.length > 0) {
    t.skip(`无法确认端口未占用（权限/命令错误），不杀任何进程：${probeErrors.map((check) => `${check.port}:${check.error}`).join("; ")}`);
    return;
  }
  const busy = portChecks.filter((check) => check.listeners.length > 0);
  if (busy.length > 0) {
    t.skip(`端口已被外部占用，环境冲突，不杀他人进程：${busy.flatMap((check) => check.listeners).join(" | ")}`);
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b71-memory-ports-"));
  try {
    let child = null;
    try {
      child = await spawnNode(["-e", TCP_LISTENER_SCRIPT], ["ignore", "pipe", "pipe"]);
      await waitForStdout(child, "ready");
      const listening = await pollUntil(
        () => runtimeAfterBatch(dir).ports,
        (ports) => ports.backend_4657 === true && ports.transport_4661 === true,
        3000,
      );
      assert.equal(listening.backend_4657, true, "自有 listener 占用 4657 时必须观察到 true");
      assert.equal(listening.transport_4661, true, "自有 listener 占用 4661 时必须观察到 true");
    } finally {
      await stopOwnedChild(child);
    }

    const closed = await pollUntil(
      () => runtimeAfterBatch(dir).ports,
      (ports) => ports.backend_4657 === false && ports.transport_4661 === false,
      5000,
    );
    assert.deepEqual(closed, { backend_4657: false, transport_4661: false });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("verify 失败关闭：journey/provider/证据不足均不写通过结论", () => {
  const journey = buildDir();
  try {
    const configPath = path.join(journey, "native-b71-config.json");
    writeJson(configPath, { ...JSON.parse(fs.readFileSync(configPath, "utf8")), journey: "other" });
    assert.throws(() => verifyMemoryDetailBatch(journey), /只接受 journey=memory-detail/u);
  } finally {
    fs.rmSync(journey, { recursive: true, force: true });
  }

  const provider = buildDir();
  try {
    const configPath = path.join(provider, "native-b71-config.json");
    writeJson(configPath, { ...JSON.parse(fs.readFileSync(configPath, "utf8")), provider: "stub" });
    assert.throws(() => verifyMemoryDetailBatch(provider), /只接受确定性 slice_verify/u);
  } finally {
    fs.rmSync(provider, { recursive: true, force: true });
  }

  const missingEvidence = buildDir();
  try {
    fs.rmSync(path.join(missingEvidence, "memory-detail.jpg"));
    assert.throws(() => verifyMemoryDetailBatch(missingEvidence));
  } finally {
    fs.rmSync(missingEvidence, { recursive: true, force: true });
  }

  const noDriverLog = buildDir();
  try {
    fs.rmSync(path.join(noDriverLog, "native-b71-driver-log.json"));
    assert.throws(() => verifyMemoryDetailBatch(noDriverLog), /B71 memory-detail 判据失败/u);
  } finally {
    fs.rmSync(noDriverLog, { recursive: true, force: true });
  }
});

test("合成目录端到端：verify 通过并写 summary；内部 code 泄漏时失败关闭", () => {
  const dir = buildDir();
  const { result, summary } = verifyMemoryDetailBatch(dir);
  assert.deepEqual(result.failed, []);
  assert.equal(summary.verdict.mechanism, "pass");
  assert.equal(summary.verdict.p0_leak_fixed, true);
  assert.equal(summary.verdict.full_g1_g6_signed, false);
  assert.equal(summary.verdict.i10_signed, false);
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
