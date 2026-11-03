#!/usr/bin/env node
// Author-visible display-name SSOT codegen (frontend half).
//
// SSOT: docs/design/schemas/author_visible/display_names.json
// Output: frontend/src/generated/author_visible/displayNames.ts
//
// Fail-closed（生成期）：
// 1. SSOT 结构/重复 code 校验；
// 2. enum_sources 声明的每个 enum 值都必须在对应 display 域登记（缺项 exit 非 0）；
// 3. 输出带 SOURCE_HASH；后端 `mix codegen.author_visible --check` 会比对同一 hash。
//
// 与 docs/design/schemas/README.md 的唯一落点约定一致：SSOT 在 docs/design/schemas/，
// 生成物进 frontend/src/generated/（不手改）。

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const schemasRoot = join(root, "docs", "design", "schemas");
const ssotPath = join(schemasRoot, "author_visible", "display_names.json");
const outPath = join(here, "..", "src", "generated", "author_visible", "displayNames.ts");

function fail(message) {
  console.error(`codegen.author-visible: ${message}`);
  process.exit(1);
}

const raw = readFileSync(ssotPath, "utf8");
const ssot = JSON.parse(raw);

const domains = ssot.domains;
if (!domains || typeof domains !== "object" || Array.isArray(domains)) {
  fail("display_names.json 缺少 domains 对象");
}

const fallbacks = ssot.fallbacks ?? {};
const domainNames = Object.keys(domains).sort();
for (const name of domainNames) {
  const entries = domains[name];
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    fail(`domains.${name} 必须是 { code: displayName } 对象`);
  }
  if (typeof fallbacks[name] !== "string" || fallbacks[name].trim() === "") {
    fail(`fallbacks.${name} 缺失（domain ${name} 必须有作者安全兜底文案）`);
  }
  const seen = new Set();
  for (const [code, label] of Object.entries(entries)) {
    if (seen.has(code)) fail(`domains.${name}.${code} 重复`);
    seen.add(code);
    if (typeof label !== "string" || label.trim() === "") {
      fail(`domains.${name}.${code} 显示名必须是非空字符串`);
    }
  }
}

// 登记为作者可见的 enum 必须全覆盖：新增 enum 值而忘记登记 display → 生成失败。
const enumSources = ssot.enum_sources ?? {};
for (const [domain, files] of Object.entries(enumSources)) {
  const target = domains[domain];
  if (!target) fail(`enum_sources.${domain} 对应的 display 域不存在`);
  for (const rel of files) {
    const enumPath = join(schemasRoot, rel);
    let enumJson;
    try {
      enumJson = JSON.parse(readFileSync(enumPath, "utf8"));
    } catch (error) {
      fail(`无法读取 enum 源 ${rel}: ${error.message}`);
    }
    const values = enumJson.enum;
    if (!Array.isArray(values) || values.length === 0) {
      fail(`enum 源 ${rel} 缺少非空 enum 数组`);
    }
    for (const value of values) {
      if (!target[value]) {
        fail(
          `enum 值 ${value}（来自 ${rel}）未在 display_names.json 的 domains.${domain} 登记作者可见显示名`,
        );
      }
    }
  }
}

// 其余域（provider/model 等）按需登记，不做强制 enum 覆盖。

const hash = createHash("sha256").update(raw).digest("hex");

const kindUnion = domainNames.map((name) => JSON.stringify(name)).join(" | ");

function renderDomain(name) {
  const entries = Object.entries(domains[name])
    .map(([code, label]) => `    ${JSON.stringify(code)}: ${JSON.stringify(label)},`)
    .join("\n");
  return `  ${JSON.stringify(name)}: {\n${entries}\n  },`;
}

function renderFallback(name) {
  return `  ${JSON.stringify(name)}: ${JSON.stringify(fallbacks[name])},`;
}

const forbidden = ssot.forbidden_tokens ?? {};
const allow = Array.isArray(forbidden.allow) ? forbidden.allow : [];
const renderList = (values) =>
  values.length === 0 ? "[]" : `[\n${values.map((v) => `  ${JSON.stringify(v)},`).join("\n")}\n]`;

const ts = `// AUTO-GENERATED FROM docs/design/schemas/author_visible/display_names.json — DO NOT EDIT.
// Run \`pnpm codegen:author-visible\` to regenerate. Author-visible surfaces must only use these display names.

export const SOURCE_HASH = ${JSON.stringify(hash)};

export const DISPLAY_NAMES = {
${domainNames.map(renderDomain).join("\n")}
} as const;

export const FALLBACKS = {
${domainNames.map(renderFallback).join("\n")}
} as const;

export const FORBIDDEN_TOKENS = {
  allow: ${renderList(allow)},
  protocol_codes: ${renderList(forbidden.protocol_codes ?? [])},
  internal_terms_zh: ${renderList(forbidden.internal_terms_zh ?? [])},
  internal_identifiers: ${renderList(forbidden.internal_identifiers ?? [])},
  ref_patterns: ${renderList(forbidden.ref_patterns ?? [])},
} as const;

export type DisplayKind = ${kindUnion};
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, ts);

// 生成物与仓库 .prettierrc 对齐（printWidth 100 / 双引号 / trailingComma all），
// 保证 `pnpm format:check` 与生成结果无漂移。
const prettierBin = join(here, "..", "node_modules", "prettier", "bin", "prettier.cjs");
if (existsSync(prettierBin)) {
  execFileSync(process.execPath, [prettierBin, "--write", outPath], {
    cwd: join(here, ".."),
    stdio: "ignore",
  });
} else {
  console.warn(
    "codegen.author-visible: prettier not installed; generated file may fail format:check",
  );
}

console.log(
  `codegen.author-visible: ok (${domainNames.length} domains, hash ${hash.slice(0, 12)}… -> frontend/src/generated/author_visible/displayNames.ts)`,
);
