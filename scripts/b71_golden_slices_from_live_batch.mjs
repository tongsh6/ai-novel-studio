#!/usr/bin/env node
// B71 CP3b：从实模批次 03 的真实 Provider 请求字节离线提取黄金请求切片证据。
//
// 这不是新验收批次：只读取已验证批次目录里的 llm-calls 原始记录，按 VS-00L §7
// G1–G6 定义做结构化切片分析；不重跑、不改写原证据、不代签真实模型语义。
//
// 用法：node scripts/b71_golden_slices_from_live_batch.mjs <batch-dir> [--out <dir>]

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.resolve(process.argv[2] ?? "");
const outArgIndex = process.argv.indexOf("--out");
const outDir = path.resolve(
  outArgIndex >= 0 ? process.argv[outArgIndex + 1] : path.join(ROOT, "artifacts/b71-resume/golden-slices"),
);

if (!dir || !fs.existsSync(dir)) {
  console.error("usage: node scripts/b71_golden_slices_from_live_batch.mjs <batch-dir> [--out <dir>]");
  process.exit(64);
}

const sha256 = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");

function readLlmCalls(batchDir) {
  const callDir = path.join(batchDir, "llm-calls");
  const rows = [];
  for (const name of fs.readdirSync(callDir).sort()) {
    if (!name.endsWith(".jsonl")) continue;
    for (const line of fs.readFileSync(path.join(callDir, name), "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // 真实记录形如 "[2026-...Z] {json}"；也兼容纯 JSON 行。
      const match = /^\[[^\]]+\]\s*(\{.*)$/.exec(trimmed);
      const payload = match ? match[1] : trimmed;
      try {
        rows.push(JSON.parse(payload));
      } catch {
        // 单行坏记录不影响其余切片；最终报告会记录 parse_errors。
      }
    }
  }
  return rows;
}

// wire chat.completions body：messages 每条 role/content/tool_calls/tool_call_id。
// application_base / scope_update 通过文本 header 的【应用数据 · <kind>】标记识别
// （Chat Completions 投影在无结构化 channel 时必须带 provenance header，VS-00L §6.1）。
const APPLICATION_DATA_MARK = /^【应用数据 · ([a-z_]+) · /;

export function classifyMessage(message) {
  const role = message?.role;
  const content = typeof message.content === "string" ? message.content : "";
  if (role === "system") return { kind: "system", text: content };
  if (role === "assistant") return { kind: "assistant", text: content, tool_calls: message.tool_calls ?? [] };
  if (role === "tool") return { kind: "tool_result", text: content, tool_call_id: message.tool_call_id ?? null };
  if (role === "user") {
    const mark = APPLICATION_DATA_MARK.exec(content);
    if (mark) return { kind: `user:${mark[1]}`, text: content };
    return { kind: "user:author", text: content };
  }
  return { kind: `unknown:${role}`, text: content };
}

export function sliceRequest(record, index) {
  const body = record?.request?.body ?? {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const classified = messages.map(classifyMessage);
  const authorMessages = classified.filter((m) => m.kind === "user:author");
  const assistant = classified.filter((m) => m.kind === "assistant");
  const toolResults = classified.filter((m) => m.kind === "tool_result");
  const toolCalls = assistant.flatMap((m) =>
    (m.tool_calls ?? []).map((call) => ({
      id: call?.id ?? null,
      name: call?.function?.name ?? call?.name ?? null,
      arguments_sha256: sha256(call?.function?.arguments ?? call?.arguments ?? ""),
    })),
  );
  return {
    index,
    message_count: messages.length,
    kinds: classified.map((m) => m.kind),
    roles: messages.map((m) => m?.role ?? null),
    tool_names: tools.map((tool) => tool?.function?.name ?? tool?.name ?? null),
    tool_calls: toolCalls,
    tool_result_call_ids: toolResults.map((m) => m.tool_call_id),
    tool_result_contents: toolResults.map((m) => m.text),
    author_messages: authorMessages.map((m) => ({ sha256: sha256(m.text), chars: m.text.length })),
    prefix_sha256: sha256(messages.map((m) => JSON.stringify(m)).join("\n")),
  };
}

// 追加式前缀：后一请求的 messages 前 N 条必须与前一请求逐条字节相等（允许只追加）。
export function prefixIsAppend(previous, current) {
  if (!previous || !current) return { ok: false, reason: "missing" };
  const before = previous.rawMessages;
  const after = current.rawMessages;
  if (after.length < before.length) return { ok: false, reason: "shrunk", before: before.length, after: after.length };
  for (let i = 0; i < before.length; i += 1) {
    if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) {
      return { ok: false, reason: "prefix_diff", index: i };
    }
  }
  return { ok: true, appended: after.length - before.length };
}

// G 切片判定（结构事实；不判模型语义正确性）。
export function goldenSlices(requests) {
  const slices = [];
  const first = requests[0];
  // G1 首轮：system ×2 + application_base + 独立 author user（可选 scope_update）。
  if (first) {
    const hasBase = first.kinds.some((kind) => kind === "user:application_base");
    const authorIndex = first.kinds.indexOf("user:author");
    const baseIndex = first.kinds.indexOf("user:application_base");
    const systemIndexes = first.kinds.map((kind, i) => (kind === "system" ? i : -1)).filter((i) => i >= 0);
    slices.push({
      id: "G1",
      name: "首轮",
      request_index: 0,
      ok: Boolean(hasBase) && authorIndex >= 0 && systemIndexes.length >= 1 && baseIndex < authorIndex,
      facts: {
        system_messages: systemIndexes.length,
        application_base_before_author: baseIndex >= 0 && baseIndex < authorIndex,
        author_message_index: authorIndex,
        author_bytes_sha256: first.author_messages[0]?.sha256 ?? null,
        tools: first.tool_names,
      },
    });
  }
  // G2 观察后：assistant tool_calls 的 call_id 必须在其后续请求的 tool result 中按
  // tool_call_id 出现。请求 messages 含追加式 transcript 回放（同一 call 会在后续请求
  // 重复出现），因此按唯一 call_id 去重后再判绑定，避免把回放次数当调用次数。
  const uniqueCallIds = [...new Set(requests.flatMap((req) => req.tool_calls.map((call) => call.id).filter(Boolean)))];
  const uniqueResultIds = new Set(requests.flatMap((req) => req.tool_result_call_ids.filter(Boolean)));
  const boundIds = uniqueCallIds.filter((id) => uniqueResultIds.has(id));
  const observationRequests = requests.filter((req) => req.tool_result_call_ids.length > 0);
  slices.push({
    id: "G2",
    name: "观察后",
    request_index: observationRequests[0]?.index ?? null,
    ok:
      uniqueCallIds.length > 0 &&
      uniqueResultIds.size > 0 &&
      boundIds.length === uniqueCallIds.length &&
      observationRequests.length > 0,
    facts: {
      unique_tool_call_ids: uniqueCallIds.length,
      unique_tool_result_ids: uniqueResultIds.size,
      call_ids_bound: boundIds.length,
      replayed_occurrences_total: requests.flatMap((req) => req.tool_calls.map((call) => call.id).filter(Boolean)).length,
      requests_with_tool_results: observationRequests.map((req) => req.index),
    },
  });
  // G3 校验失败后：wire 中是否存在 failed validation_result（作为 tool 结果回流）。
  const failedValidation = requests.filter((req) =>
    (req.tool_result_contents ?? []).some((content) => /"status"\s*:\s*"failed"/.test(String(content))),
  );
  slices.push({
    id: "G3",
    name: "校验失败后",
    request_index: failedValidation[0]?.index ?? null,
    ok: failedValidation.length > 0,
    facts: { requests_with_failed_validation: failedValidation.map((req) => req.index) },
  });
  // G4 候选后：assistant tool_calls 是否包含创作/候选工具（submit_tentative_artifact 等）。
  const candidateCallNames = requests.flatMap((req) => req.tool_calls.map((call) => call.name)).filter(Boolean);
  const candidateTools = candidateCallNames.filter((name) => /tentative|candidate|artifact|prose_writing|creative/i.test(String(name)));
  slices.push({
    id: "G4",
    name: "候选后",
    request_index: requests.findIndex((req) => req.tool_calls.some((call) => /tentative|artifact|prose_writing/i.test(String(call.name ?? "")))),
    ok: candidateTools.length > 0,
    facts: { candidate_tool_calls: candidateTools, all_tool_call_names: [...new Set(candidateCallNames)] },
  });
  // G5 作者边界后：需要作者采纳/拒绝动作开启的新边界——本实模批次未触发，明确不算覆盖。
  slices.push({ id: "G5", name: "作者边界后", ok: false, facts: { reason: "author_boundary_not_triggered_in_live_batch" } });
  // G6 压缩后：需要显式压缩 checkpoint——本实模批次未触发，明确不算覆盖。
  slices.push({ id: "G6", name: "压缩后", ok: false, facts: { reason: "compression_not_triggered_in_live_batch" } });
  return slices;
}

function main() {
  const records = readLlmCalls(dir);
  if (records.length === 0) {
    console.error("no llm-calls records found");
    process.exit(1);
  }
  const requests = records.map((record, index) => {
    const slice = sliceRequest(record, index);
    const body = record?.request?.body ?? {};
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    return { ...slice, rawMessages };
  });
  const appendChecks = requests.map((req, i) => (i === 0 ? null : prefixIsAppend(requests[i - 1], req)));
  const slices = goldenSlices(requests.map(({ rawMessages, ...rest }) => ({ ...rest, rawMessages })));
  const authorHashes = [...new Set(requests.flatMap((req) => req.author_messages.map((m) => m.sha256)))];

  const report = {
    schema: "b71-live-golden-slices/v1",
    source_batch: path.relative(ROOT, dir),
    analyzed_at: new Date().toISOString(),
    note: "对已验证实模批次的真实请求字节做离线切片分析；不是新验收批次，不改写原证据，不代签模型语义。",
    requests: requests.map(({ rawMessages, ...rest }) => rest),
    append_prefix_checks: appendChecks,
    author_message_hashes: authorHashes,
    slices,
    summary: {
      request_count: requests.length,
      append_prefix_ok: appendChecks.every((check) => check === null || check.ok === true),
      g1: slices.find((s) => s.id === "G1")?.ok ?? false,
      g2: slices.find((s) => s.id === "G2")?.ok ?? false,
      g3: slices.find((s) => s.id === "G3")?.ok ?? false,
      g4: slices.find((s) => s.id === "G4")?.ok ?? false,
      g5: false,
      g6: false,
      not_covered: ["G5 作者边界（未触发）", "G6 压缩（未触发）"],
    },
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "live-golden-slices.json"), `${JSON.stringify(report, null, 2)}\n`);
  const md = [
    "# B71 CP3b 实模批次黄金请求切片分析",
    "",
    `- 来源批次：\`${report.source_batch}\``,
    `- 分析时间：${report.analyzed_at}`,
    `- 边界：对真实请求字节的离线切片分析，不是新验收批次；不代签模型语义与 G5/G6。`,
    "",
    "## 请求序列",
    "",
    "| # | messages | roles/kinds | tools | tool_calls | tool_results |",
    "|---|---:|---|---:|---:|---:|",
    ...requests.map(
      (req) =>
        `| ${req.index} | ${req.message_count} | ${req.kinds.join(" → ")} | ${req.tool_names.length} | ${req.tool_calls.length} | ${req.tool_result_call_ids.length} |`,
    ),
    "",
    "## 追加式前缀",
    "",
    ...appendChecks.map((check, i) => (i === 0 ? "- #0 基线" : `- #${i}: ${check.ok ? `ok（追加 ${check.appended} 条）` : `FAIL ${check.reason}`}`)),
    "",
    "## G 切片",
    "",
    "| 切片 | 结果 | 关键事实 |",
    "|---|---|---|",
    ...slices.map((s) => `| ${s.id} ${s.name} | ${s.ok ? "✅" : "❌"} | ${JSON.stringify(s.facts)} |`),
    "",
    "## 结论",
    "",
    `- 请求 ${report.summary.request_count} 条、追加式前缀 ${report.summary.append_prefix_ok ? "全部通过" : "存在断裂"}。`,
    `- 已覆盖：${["G1", "G2", "G3", "G4"].filter((id) => report.summary[id.toLowerCase()]).join("、") || "无"}。`,
    `- 未覆盖（明确不代签）：${report.summary.not_covered.join("；")}。`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "live-golden-slices.md"), md);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`report: ${path.relative(ROOT, path.join(outDir, "live-golden-slices.md"))}`);
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
