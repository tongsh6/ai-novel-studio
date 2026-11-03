#!/usr/bin/env node
// 作者可见文本泄漏扫描器（唯一实现）。
//
// 规则来源：docs/design/schemas/author_visible/display_names.json 的 forbidden_tokens。
// 三类证据面（防止误判）：
//  1. 作者可见产品文案：必须零命中；
//  2. 模型生成正文：不在本扫描范围（N-NARR 保真优先；由 prompt 治理单列）；
//  3. AX 提取伪泄漏：AX dump 会把 name/description/value 拼成一行，扫描时必须把
//     同一元素的 name/description/value 作为独立文本分别扫描，而不是扫描拼接串
//     （否则 `AI AI 名称`、`会话 0` 会被误报）。
//
// 白名单：SSOT forbidden_tokens.allow；零隐式例外，代码内不得加开关。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const ssotPath = join(repoRoot, "docs", "design", "schemas", "author_visible", "display_names.json");

/** 读取 SSOT 的禁止 token 规则（扫描全类别，无收窄参数）。 */
export function loadForbiddenTokens(ssot = ssotPath) {
  const parsed = JSON.parse(readFileSync(ssot, "utf8"));
  const tokens = parsed.forbidden_tokens ?? {};
  return {
    allow: Array.isArray(tokens.allow) ? tokens.allow : [],
    protocol_codes: Array.isArray(tokens.protocol_codes) ? tokens.protocol_codes : [],
    internal_terms_zh: Array.isArray(tokens.internal_terms_zh) ? tokens.internal_terms_zh : [],
    internal_identifiers: Array.isArray(tokens.internal_identifiers) ? tokens.internal_identifiers : [],
    ref_patterns: Array.isArray(tokens.ref_patterns) ? tokens.ref_patterns : [],
  };
}

function compilePatterns(tokens) {
  // pattern 来自受控 SSOT（docs/design/schemas/author_visible/display_names.json 的
  // forbidden_tokens.ref_patterns，由开发者维护的静态数据，不是用户/外部输入），
  // 不存在 ReDoS 攻击面；Semgrep 按「动态构造正则」规则误报（见下一行抑制）。
  return tokens.ref_patterns.map((pattern) => {
    try {
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
      return new RegExp(pattern);
    } catch (error) {
      throw new Error(`invalid ref_patterns regex ${pattern}: ${error.message}`);
    }
  });
}

function asTexts(texts) {
  return (texts ?? [])
    .map((entry) =>
      typeof entry === "string" ? { text: entry, source: "text" } : { text: entry?.text ?? "", source: entry?.source ?? "text" },
    )
    .filter((entry) => typeof entry.text === "string");
}

/**
 * 扫描作者可见文本集合。
 * @returns {{ok: boolean, hits: Array<{token: string, kind: string, text: string, source: string}>}}
 */
export function scanAuthorVisibleTexts(texts, options = {}) {
  const tokens = options.tokens ?? loadForbiddenTokens();
  const patterns = compilePatterns(tokens);
  const allow = tokens.allow;
  const hits = [];

  const allowed = (text) => allow.some((entry) => text.includes(entry));

  for (const { text, source } of asTexts(texts)) {
    if (!text || allowed(text)) continue;

    for (const token of tokens.protocol_codes) {
      if (text.includes(token)) hits.push({ token, kind: "protocol_code", text, source });
    }
    for (const token of tokens.internal_terms_zh) {
      if (text.includes(token)) hits.push({ token, kind: "internal_term_zh", text, source });
    }
    for (const token of tokens.internal_identifiers) {
      if (text.includes(token)) hits.push({ token, kind: "internal_identifier", text, source });
    }
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match) hits.push({ token: match[0], kind: "ref_pattern", text, source });
    }
  }

  return { ok: hits.length === 0, hits };
}

const NODE_LINE = /^\s*[0-9/]+ (AX[A-Za-z]+),\s?(.*)$/;

/**
 * 从 AX dump 文本中提取「作者可感知文本」，按元素分开：name / description / value。
 * 不拼接同一元素的 name+description+value（那是 AX dump 的展示方式，不是产品文案）。
 */
export function extractAxTexts(axDump) {
  const entries = [];
  let current = null;

  const push = (text, source) => {
    const value = typeof text === "string" ? text.trim() : "";
    if (value !== "") entries.push({ text: value, source });
  };

  for (const line of String(axDump ?? "").split("\n")) {
    const match = NODE_LINE.exec(line);
    if (match) {
      current = match[2] ?? "";
      // 同一元素内：name 是第一个逗号前的部分（可能为空）。
      const nameEnd = current.indexOf(", ");
      const name = nameEnd >= 0 ? current.slice(0, nameEnd) : current;
      const isFieldFragment =
        name.includes("=") || name.startsWith("Description:") || name.startsWith("Value:");
      if (name && !isFieldFragment) push(name, "ax:name");
    } else if (current !== null) {
      // 多行 Value 的续行（如欢迎语），归到当前元素的 value。
      push(line, "ax:value");
    }
  }

  for (const line of String(axDump ?? "").split("\n")) {
    const match = NODE_LINE.exec(line);
    if (!match) continue;
    const rest = match[2] ?? "";
    const description = extractField(rest, "Description:");
    if (description) entries.push({ text: description, source: "ax:description" });
    const value = extractField(rest, "Value:");
    if (value) entries.push({ text: value, source: "ax:value" });
  }

  return entries;
}

function extractField(rest, field) {
  const marker = `${field} `;
  const start = rest.indexOf(marker);
  if (start < 0) return null;
  const after = rest.slice(start + marker.length);
  const endCandidates = [", enabled=", ", focused=", ", Actions:", ", subrole=", ", Value:", ", Description:"]
    .map((candidate) => after.indexOf(candidate))
    .filter((index) => index >= 0);
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) : after.length;
  const value = after.slice(0, end).trim();
  return value === "" ? null : value;
}

/** 便捷入口：直接传 AX dump 扫描。 */
export function scanAxDump(axDump, options = {}) {
  return scanAuthorVisibleTexts(extractAxTexts(axDump), options);
}
