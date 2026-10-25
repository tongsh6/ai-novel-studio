#!/usr/bin/env node
// P1 同模型双工具 speed/quality bench（一次性 probe，不接产品；task-83）。
// 用法：
//   node scripts/model_tool_bench.mjs --provider lmstudio --base-url http://127.0.0.1:1234/v1 \
//     --model qwen3.8-27b-bf16 --out-dir artifacts/novel-output/p1-model-tool-compare-2026-10-25/calls/lmstudio
//   node scripts/model_tool_bench.mjs --provider strata --base-url http://127.0.0.1:47831/v1 \
//     --model <variant-id> --out-dir .../calls/strata
//
// 固定 prompt 集：plan-json / prose-800 / judge-short；temperature=0、max_tokens 固定；
// 每 prompt 一次、不重试换分。流式读取以测 TTFT；若服务端流式不回 usage，则用字符数估算
// output_tokens 并在结果中标注 estimated=true（不额外补调）。原始 request/SSE/组装结果落 calls/*.json。
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = { provider: "lmstudio", baseUrl: "http://127.0.0.1:1234/v1", model: "qwen3.8-27b-bf16", outDir: "" };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--provider") { args.provider = value; i += 1; }
    else if (key === "--base-url") { args.baseUrl = value; i += 1; }
    else if (key === "--model") { args.model = value; i += 1; }
    else if (key === "--out-dir") { args.outDir = value; i += 1; }
    else throw new Error(`unknown argument: ${key}`);
  }
  if (!args.outDir) throw new Error("--out-dir is required");
  return args;
}

const PROMPTS = [
  {
    id: "plan-json",
    max_tokens: 1536,
    kind: "plan_json",
    messages: [
      {
        role: "user",
        content:
          '你是 AgentRun 计划起草器。只输出一个 JSON object（不要 markdown 代码围栏、不要解释），必须包含顶层四字段：\n' +
          '- plan: {"steps": [...]}\n' +
          '- author_reasoning: string\n' +
          '- reason_codes: string[]\n' +
          '- confidence: number 0..1\n' +
          '每个 step 必须含 step_id, kind(explore|act), description, success_criteria(string[]), target_tool_ref(仅 context_assemble|chapter_mission|prose_writing)；若该 step 为 prose_writing，还必须有 authoring_intent(continuation|rewrite|null)。\n' +
          '任务：为小说第01章「底层灵气账单」起草正文首稿计划，作者原话：「第01章：底层灵气账单的正文还没写，帮我写出来吧。」',
      },
    ],
  },
  {
    id: "prose-800",
    max_tokens: 3072,
    kind: "prose",
    messages: [
      {
        role: "user",
        content:
          "你是中文长篇小说写作助手。用雨港悬疑的笔调写第01章开篇正文，约 800–1200 个汉字；保持人物陆沉舟、欠费停灵夜、灵气带宽被公司暗中抽走等已有设定；只输出正文，不要标题、解释、markdown。",
      },
    ],
  },
  {
    id: "judge-short",
    max_tokens: 256,
    kind: "judge",
    messages: [
      {
        role: "user",
        content:
          "作者说：「把第一章正文整理一下，只调整分段和排版，不要改字句。」\n请用 2–3 句自然语言判断作者意图、应绑定的对象范围和应执行的操作/能力；不要输出 JSON，不要长篇解释。",
      },
    ],
  },
];

function cjkCount(text) {
  return (String(text).match(/[\u3400-\u9fff]/g) ?? []).length;
}
function sentenceCount(text) {
  return (String(text).match(/[。！？!?]/g) ?? []).length;
}
function longestRepeatRatio(text) {
  const clean = String(text).replace(/\s+/g, "");
  if (clean.length < 32) return 0;
  const windowSize = 8;
  const seen = new Map();
  let repeated = 0;
  for (let i = 0; i + windowSize <= clean.length; i += 1) {
    const gram = clean.slice(i, i + windowSize);
    const count = (seen.get(gram) ?? 0) + 1;
    seen.set(gram, count);
    if (count > 1) repeated += 1;
  }
  return Number((repeated / Math.max(1, clean.length - windowSize + 1)).toFixed(4));
}
function stripFences(text) {
  return String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}
function planCompliance(text) {
  const violations = [];
  let parsed = null;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch (error) {
    violations.push(`json_parse_error: ${String(error?.message ?? error).slice(0, 160)}`);
    return { json_parse_ok: false, violations, parsed: null };
  }
  const requiredTop = ["plan", "author_reasoning", "reason_codes", "confidence"];
  for (const key of requiredTop) {
    if (!(key in parsed)) violations.push(`missing_top_level:${key}`);
  }
  const steps = parsed?.plan?.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    violations.push("plan.steps_missing_or_empty");
  } else {
    const validKinds = new Set(["explore", "act"]);
    const validTargets = new Set(["context_assemble", "chapter_mission", "prose_writing"]);
    steps.forEach((step, index) => {
      for (const key of ["step_id", "kind", "description", "success_criteria", "target_tool_ref"]) {
        if (!(key in step)) violations.push(`step${index}:missing_${key}`);
      }
      if (step?.kind && !validKinds.has(step.kind)) violations.push(`step${index}:invalid_kind:${step.kind}`);
      if (step?.target_tool_ref && !validTargets.has(step.target_tool_ref)) {
        violations.push(`step${index}:invalid_target:${step.target_tool_ref}`);
      }
      if (step?.target_tool_ref === "prose_writing" && !("authoring_intent" in step)) {
        violations.push(`step${index}:missing_authoring_intent`);
      } else if (step?.target_tool_ref === "prose_writing") {
        const value = step.authoring_intent;
        if (![null, "continuation", "rewrite", "null"].includes(value)) {
          violations.push(`step${index}:invalid_authoring_intent:${String(value)}`);
        }
      }
    });
  }
  if (!Array.isArray(parsed?.reason_codes)) violations.push("reason_codes_not_array");
  if (typeof parsed?.confidence !== "number") violations.push("confidence_not_number");
  if (typeof parsed?.author_reasoning !== "string" || parsed.author_reasoning.length === 0) {
    violations.push("author_reasoning_not_nonempty_string");
  }
  return { json_parse_ok: true, violations, parsed };
}
function proseMetrics(text, finishReason) {
  const content = String(text ?? "");
  return {
    chars: content.length,
    cjk_chars: cjkCount(content),
    paragraphs: content.split(/\n+/).filter((line) => line.trim()).length,
    repetition_8gram_ratio: longestRepeatRatio(content),
    finish_reason: finishReason ?? null,
    truncated: finishReason === "length",
    sample_head: content.slice(0, 240),
    sample_tail: content.slice(-240),
  };
}
function judgeMetrics(text) {
  const content = String(text ?? "");
  return {
    chars: content.length,
    cjk_chars: cjkCount(content),
    sentences: sentenceCount(content),
    mentions_chapter: /第一章|第01章/.test(content),
    mentions_format: /排版|分段/.test(content),
    mentions_scope: /章节|整章/.test(content),
    sample: content.slice(0, 400),
  };
}

async function runPrompt({ args, prompt }) {
  const url = `${args.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model: args.model,
    messages: prompt.messages,
    temperature: 0,
    max_tokens: prompt.max_tokens,
    reasoning_effort: "none",
    stream: true,
    stream_options: { include_usage: true },
  };
  const started = Date.now();
  let ttftMs = null;
  let rawSse = "";
  let content = "";
  let reasoning = "";
  let finalUsage = null;
  let finishReason = null;
  let status = null;
  let error = null;
  const events = [];
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(900_000),
    });
    status = response.status;
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const piece = decoder.decode(value, { stream: true });
      rawSse += piece;
      buffer += piece;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        let chunk = null;
        try { chunk = JSON.parse(payload); } catch { continue; }
        events.push(chunk);
        const choice = chunk?.choices?.[0];
        const delta = choice?.delta ?? {};
        const deltaContent = String(delta?.content ?? "");
        const deltaReasoning = String(delta?.reasoning_content ?? delta?.reasoning ?? "");
        if (ttftMs === null && (deltaContent.length > 0 || deltaReasoning.length > 0)) {
          ttftMs = Date.now() - started;
        }
        if (deltaContent) content += deltaContent;
        if (deltaReasoning) reasoning += deltaReasoning;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (chunk?.usage) finalUsage = chunk.usage;
      }
    }
  } catch (caught) {
    error = String(caught?.message ?? caught);
  }
  const durationMs = Date.now() - started;
  const outputTokens = finalUsage?.completion_tokens ?? finalUsage?.output_tokens ?? null;
  const estimatedTokens = outputTokens ?? Math.round(cjkCount(content) / 1.6 + (content.length - cjkCount(content)) / 4);
  const tokPerSecond = estimatedTokens && durationMs > 0 ? Number(((estimatedTokens * 1000) / durationMs).toFixed(3)) : null;
  const decodeMs = durationMs - (ttftMs ?? 0);
  const decodeTokPerSecond =
    estimatedTokens && decodeMs > 0 ? Number(((estimatedTokens * 1000) / decodeMs).toFixed(3)) : null;
  const quality =
    prompt.kind === "plan_json"
      ? planCompliance(content)
      : prompt.kind === "prose"
        ? proseMetrics(content, finishReason)
        : judgeMetrics(content);
  const record = {
    provider: args.provider,
    model: args.model,
    base_url: args.baseUrl,
    prompt_id: prompt.id,
    prompt_kind: prompt.kind,
    params: { temperature: 0, max_tokens: prompt.max_tokens, reasoning_effort: "none", stream: true, stream_options: { include_usage: true } },
    request: { url, body },
    response: {
      status,
      error,
      ttft_ms: ttftMs,
      duration_ms: durationMs,
      finish_reason: finishReason,
      usage: finalUsage,
      output_tokens: estimatedTokens,
      output_tokens_estimated: outputTokens === null,
      tok_per_s_total: tokPerSecond,
      tok_per_s_decode: decodeTokPerSecond,
      content,
      reasoning_content: reasoning.slice(0, 2000),
      reasoning_chars: reasoning.length,
      sse_event_count: events.length,
      raw_sse: rawSse,
    },
    quality,
    started_at: new Date(started).toISOString(),
  };
  return record;
}

const args = parseArgs(process.argv);
fs.mkdirSync(args.outDir, { recursive: true });
const summary = {
  schema: "p1-model-tool-bench-v1",
  generated_at: new Date().toISOString(),
  provider: args.provider,
  model: args.model,
  base_url: args.baseUrl,
  prompts: [],
};
for (const prompt of PROMPTS) {
  const record = await runPrompt({ args, prompt });
  const file = path.join(args.outDir, `${prompt.id}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  summary.prompts.push({
    prompt_id: prompt.id,
    prompt_kind: prompt.kind,
    max_tokens: prompt.max_tokens,
    status: record.response.status,
    error: record.response.error,
    ttft_ms: record.response.ttft_ms,
    duration_ms: record.response.duration_ms,
    finish_reason: record.response.finish_reason,
    output_tokens: record.response.output_tokens,
    output_tokens_estimated: record.response.output_tokens_estimated,
    tok_per_s_total: record.response.tok_per_s_total,
    tok_per_s_decode: record.response.tok_per_s_decode,
    quality: record.quality,
    call_file: file,
  });
  console.log(
    `[bench] ${args.provider} ${prompt.id} status=${record.response.status} dur=${record.response.duration_ms}ms ` +
      `ttft=${record.response.ttft_ms}ms tokens=${record.response.output_tokens} tok/s=${record.response.tok_per_s_total}`,
  );
}
fs.writeFileSync(path.join(args.outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(`[bench] summary=${path.join(args.outDir, "summary.json")}`);
