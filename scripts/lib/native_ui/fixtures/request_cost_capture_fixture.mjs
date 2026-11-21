// B87 R01 capture 家族的唯一纯合成事实 owner。
//
// 只保存作者日志/记录/消息、语义目标、模型参数与 manifest 组合；不 import fs/os/path，
// 不创建目录或 DB，也不读取真实 artifacts/作者数据。作者文本、turn/session/provider
// 事实与固定 usage 都来自原 capture 测试的既有定义，反例仍由 case 在各自副本上替换
// 单一事实。manifest 只组合 `request_cost_manifest_fixture.mjs` 的既有基元，不整份
// 复用它的单作者最小样本；schema/lengths 仍由该纯 owner 提供，不在这里另建枚举。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { toolResultContent } from "./authoring_request_ir.mjs";
import {
  historyManifest as baseHistoryManifest,
  manifestTarget,
  nativeManifest as baseNativeManifest,
} from "./request_cost_manifest_fixture.mjs";

export const WORK_ID = "11111111-1111-4111-8111-111111111111";
export const TARGET_TITLE = "R01合成作品·副本";
export const SESSION_TITLE = "R01基线新会话";
export const SOURCE_TEXTS = Object.freeze(["作者一", "作者二😀", "作者三"]);
export const SOURCE_LOG_LLM = "llm.jsonl";
export const SOURCE_LOG_APP = "app.jsonl";

// 与 capture 现役测试一致：作者记录 ts、usage、模型参数和 seed 声明都不变。
const SOURCE_RECORD_TS = "2026-11-11T00:00:00.000Z";
const SOURCE_SEED_SCRIPT = "scripts/seed_request_cost_work.exs";
const EVIDENCE_ROOT = "artifacts/model-contracts/b87-r01/20261113";
// 规范引用是合成标签，不是实际快照定位；preflight 实际使用显式 snapshotDir。
const SYNTHETIC_SNAPSHOT_DIR =
  "artifacts/model-contracts/b87-r01/20261113/source-snapshot/test";
export const CHECKPOINT_START_AT = "2026-11-13T00:00:00.000Z";
export const CHECKPOINT_FINAL_AT = "2026-11-13T00:00:09.000Z";

// 模型参数是既有 pure manifest fixture 的 native 声明，不在这里另建第二份。
export const MODEL = Object.freeze({ ...baseNativeManifest().model });

const TARGETS = Object.freeze([
  manifestTarget(),
  {
    id: "outline-anomaly",
    question: "指出第一章是卷纲异常",
    review_focus: ["异议不能自动升级为修改授权"],
  },
  {
    id: "outline-archive-only",
    question: "明确要求卷纲只在档案显示",
    review_focus: ["缺能力如实表达，不拿重编号冒充完成"],
  },
]);

export function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const SOURCE_SEED_SHA256 = sha256Text("seed-content");

export function jsonlLine(record) {
  return `[${record.ts}] ${JSON.stringify(record)}`;
}

function makeMessages(texts, index) {
  const messages = [
    { role: "system", content: "系统提示" },
    { role: "user", content: "【应用数据 · application_base】作品资料" },
    { role: "user", content: "【应用数据 · scope_update】当前范围" },
  ];
  for (const text of texts) {
    messages.push({ role: "user", content: text });
    if (text !== texts.at(-1)) messages.push({ role: "assistant", content: "上一轮回复" });
  }
  assert.ok(index < messages.length);
  return messages;
}

export function makeRecord({
  turnId,
  text,
  texts = [text],
  index = 3,
  pcall = "pcall-1",
  prun = "prun-1",
  messages = null,
  responseToolCalls = [],
  step = "judgment",
  temperature = 0.2,
  maxTokens = MODEL.max_tokens,
}) {
  return {
    ts: SOURCE_RECORD_TS,
    step,
    turn_id: turnId,
    session_id: "session-1",
    work_id: WORK_ID,
    provider: "splash",
    provider_call_ref: pcall,
    provider_run_ref: prun,
    request: {
      body: {
        model: MODEL.model,
        reasoning_effort: MODEL.reasoning_effort,
        max_tokens: maxTokens,
        temperature,
        stream: true,
        tools: [],
        messages: messages ?? makeMessages(texts, index),
      },
    },
    response: {
      status: 200,
      model: "splash",
      usage: {
        model: MODEL.model,
        input_tokens: 100,
        cached_tokens: 10,
        output_tokens: 5,
        ttft_ms: 12,
        latency_ms: 20,
      },
      body: { source: "sse_decoder", tool_calls: responseToolCalls },
    },
  };
}

function sourceRecords() {
  return SOURCE_TEXTS.map((text, offset) =>
    makeRecord({
      turnId: `turn-${offset + 1}`,
      text,
      texts: SOURCE_TEXTS.slice(0, offset + 1),
      index: 3 + offset * 2,
    }),
  );
}

export function appLogText(records = sourceRecords()) {
  return `${records
    .map((record) =>
      JSON.stringify({
        timestamp: record.ts,
        event: "provider_gateway.complete.start",
        session_id: record.session_id,
        turn_id: record.turn_id,
        provider: "splash",
      }),
    )
    .join("\n")}\n`;
}

export function llmLogText(records = sourceRecords()) {
  return `${records.map(jsonlLine).join("\n")}\n`;
}

export function turnObservationNodes(message) {
  const container = "0/0/0/0/0";
  return [
    { path: "0", role: "AXWindow" },
    { path: container, role: "AXGroup" },
    { path: `${container}/10`, role: "AXGroup" },
    { path: `${container}/10/0`, role: "AXStaticText", value: "你" },
    { path: `${container}/11`, role: "AXGroup" },
    { path: `${container}/11/0`, role: "AXStaticText", value: message },
    { path: `${container}/12`, role: "AXGroup", title: "本轮创作过程" },
    { path: `${container}/12/0`, role: "AXStaticText", value: "已完成" },
  ];
}

export function exchangeMessages(messages, { pcall, prun, callId }) {
  return [
    ...messages,
    {
      role: "assistant",
      content: "",
      provider_call_ref: pcall,
      provider_run_ref: prun,
      tool_calls: [
        {
          id: callId,
          type: "function",
          function: { name: "read_chapter", arguments: "{}" },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: callId,
      content: toolResultContent({
        type: "observation",
        call_id: callId,
        status: "ok",
        source_refs: [],
        content: { text: "观察正文" },
      }),
    },
  ];
}

export function canonicalTranscript(turn, text) {
  const pcall1 = `pcall-${turn.index}-1`;
  const prun1 = `prun-${turn.index}-1`;
  const pcall2 = `pcall-${turn.index}-2`;
  const prun2 = `prun-${turn.index}-2`;
  const call1 = `call-${turn.index}-1`;
  const call2 = `call-${turn.index}-2`;
  const applicationBase = "作品资料";
  const scope = { summary: `当前范围${turn.index}` };
  return {
    pcall1,
    prun1,
    pcall2,
    prun2,
    call1,
    call2,
    applicationBase,
    scope,
    messages: [
      { role: "application_base", provenance: "application",
        blocks: [{ type: "text", text: applicationBase }], source_refs: [], versions: {} },
      { role: "scope_update", provenance: "application",
        blocks: [{ type: "scope", content: scope }], source_refs: [], versions: {} },
      { role: "user", provenance: "author", source_refs: [{ ref: turn.turn_id }],
        blocks: [{ type: "text", text }] },
      {
        role: "assistant",
        provenance: "model",
        provider_call_ref: pcall1,
        provider_run_ref: prun1,
        blocks: [{ type: "tool_call", call_id: call1, name: "read_chapter", arguments: {}, raw_arguments: "{}" }],
      },
      { role: "tool", provenance: "tool_result", blocks: [{ type: "observation", call_id: call1, status: "ok", source_refs: [], content: { text: "观察正文" } }] },
      {
        role: "assistant",
        provenance: "model",
        provider_call_ref: pcall2,
        provider_run_ref: prun2,
        blocks: [{ type: "tool_call", call_id: call2, name: "read_chapter", arguments: {}, raw_arguments: "{}" }],
      },
      { role: "tool", provenance: "tool_result", blocks: [{ type: "observation", call_id: call2, status: "ok", source_refs: [], content: { text: "观察正文" } }] },
    ],
  };
}

function captureAuthors(native) {
  return sourceRecords().map((record, offset) => ({
    id: `round-${offset + 1}`,
    line: offset + 1,
    message_index: 3 + offset * 2,
    sha256: sha256Text(SOURCE_TEXTS[offset]),
    ...(native
      ? { target: { ...TARGETS[offset], review_focus: [...TARGETS[offset].review_focus] } }
      : {}),
  }));
}

function captureSource({ llmLog, appLog, llmText, appText }) {
  return {
    llm_log: llmLog,
    sha256: sha256Text(llmText),
    app_log: appLog,
    app_sha256: sha256Text(appText),
    expected_lines: SOURCE_TEXTS.length,
  };
}

function captureManifestBase() {
  const base = baseHistoryManifest();
  return {
    ...base,
    source: captureSource({
      llmLog: base.source.llm_log,
      appLog: base.source.app_log,
      llmText: llmLogText(),
      appText: appLogText(),
    }),
    authors: captureAuthors(false),
    model: { ...base.model },
    seed: { script: SOURCE_SEED_SCRIPT, content_sha256: SOURCE_SEED_SHA256 },
    budget: { turn_timeout_ms: 60_000, max_harness_retries: 0 },
    evidence: { root: EVIDENCE_ROOT },
  };
}

/** history 观测输入：日志路径与字节由调用方绑定，作者/模型/seed 仍是同一真实数据定义。 */
export function historyCaptureManifest({
  llmLog,
  appLog,
  llmText = llmLogText(),
  appText = appLogText(),
}) {
  return {
    ...captureManifestBase(),
    id: "synthetic-capture-history",
    source: captureSource({ llmLog, appLog, llmText, appText }),
  };
}

/**
 * native 启动输入：source 日志/作者/seed 与 history 同源，snapshot 只取实际快照 metadata
 * 的 hash/引用签名；snapshot.dir 保留清晰标注的合成规范引用，不冒充真实作者目录。
 */
export function nativeCaptureManifest({ llmLog, appLog, snapshot }) {
  const base = baseNativeManifest();
  const history = historyCaptureManifest({ llmLog, appLog });
  return {
    ...base,
    ...history,
    id: "synthetic-capture-native",
    mode: "native",
    authors: captureAuthors(true),
    model: { ...base.model },
    seed: {
      script: SOURCE_SEED_SCRIPT,
      content_sha256: SOURCE_SEED_SHA256,
      work_id: WORK_ID,
      title: TARGET_TITLE,
      session_title: SESSION_TITLE,
    },
    runtime: { ...base.runtime },
    snapshot: {
      source_sha256: snapshot.full_sha256,
      work_sha256: snapshot.work_sha256,
      content_sha256: snapshot.content_sha256,
      business_content_sha256: snapshot.business_content_sha256,
      ...(snapshot.reference_logs ? { reference_logs: snapshot.reference_logs } : {}),
      dir: SYNTHETIC_SNAPSHOT_DIR,
    },
    evidence: { root: EVIDENCE_ROOT },
  };
}
