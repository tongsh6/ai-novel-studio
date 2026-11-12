#!/usr/bin/env node
// Minimal codegen for frontend zod schemas.
// Walks docs/design/schemas/ for *.json (the SSOT) and runs
// json-schema-to-zod into frontend/src/generated/ mirroring the same path.
//
// B45 CP2：生成前解析同目录树内的本地 $ref（json-schema-to-zod 不跨文件解析）。
// 只展开可解析且无环的本地引用；不可解析/跨域引用保持原样，由 CLI 降级并记录为
// legacy/缺口，不伪造通过。

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const schemasRoot = join(root, "docs", "design", "schemas");
const generatedRoot = join(here, "..", "src", "generated");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".json")) out.push(full);
  }
  return out;
}

function pascalCase(s) {
  return s
    .replace(/[._-]+/g, " ")
    .replace(/\s(.)/g, (_, c) => c.toUpperCase())
    .replace(/^./, (c) => c.toUpperCase());
}

function nameFromPath(jsonPath) {
  // foundation/turn_result_v2.json -> TurnResultV2 (Schema)
  const rel = relative(schemasRoot, jsonPath).replace(/\.json$/, "");
  const base = rel.split("/").pop();
  return pascalCase(base);
}

// VS-00M is a Proposed review bundle, not a frontend contract/codegen input.
const files = walk(schemasRoot).filter((file) => {
  const schemaPath = relative(schemasRoot, file).replaceAll("\\", "/");
  return (
    !schemaPath.startsWith("author_visible/") &&
    !schemaPath.startsWith("model-interaction/")
  );
});
if (files.length === 0) {
  console.error("no schema files found under", schemasRoot);
  process.exit(1);
}

const schemaByPath = new Map(
  files.map((file) => [
    relative(schemasRoot, file).replaceAll("\\", "/"),
    JSON.parse(readFileSync(file, "utf8")),
  ]),
);

function resolveRefs(value, currentRel, seen = new Set()) {
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, currentRel, seen));
  if (!value || typeof value !== "object") return value;
  if (typeof value.$ref === "string" && !value.$ref.startsWith("#")) {
    const targetRel = relative(
      schemasRoot,
      join(schemasRoot, dirname(currentRel), value.$ref),
    ).replaceAll("\\", "/");
    const target = schemaByPath.get(targetRel);
    const nextSeen = new Set(seen).add(`${currentRel}#${value.$ref}`);
    if (target && !seen.has(`${currentRel}#${value.$ref}`) && !nextSeen.has(targetRel)) {
      const { $ref, ...siblings } = value;
      return resolveRefs({ ...target, ...siblings }, targetRel, nextSeen);
    }
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, resolveRefs(item, currentRel, seen)]),
  );
}

let count = 0;
for (const json of files) {
  const rel = relative(schemasRoot, json).replaceAll("\\", "/");
  const out = join(generatedRoot, rel.replace(/\.json$/, ".ts"));
  mkdirSync(dirname(out), { recursive: true });
  const name = nameFromPath(json);
  const resolved = resolveRefs(schemaByPath.get(rel), rel);
  const resolvedPath = join(here, "..", "..", "artifacts", "b45-codegen-resolved", rel);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, `${JSON.stringify(resolved, null, 2)}\n`);
  execFileSync(
    "pnpm",
    [
      "exec",
      "json-schema-to-zod",
      "-i",
      resolvedPath,
      "-o",
      out,
      "-n",
      `${name}Schema`,
      "-t",
      name,
    ],
    { stdio: "inherit" },
  );
  count++;
}
console.log(
  `codegen.schemas: ok (${count} schemas generated to ${relative(root, generatedRoot)}/)`,
);
