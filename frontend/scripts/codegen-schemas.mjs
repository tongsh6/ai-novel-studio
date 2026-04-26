#!/usr/bin/env node
// Phase 0 minimal codegen for frontend zod schemas.
// Walks docs/design-v2/schemas/ for *.json (the SSOT, ADR-0001) and runs
// json-schema-to-zod into frontend/src/generated/ mirroring the same path.
//
// Phase 1 may upgrade this to handle $ref resolution + tighter typing once
// downstream enum/envelope ADRs land their schemas. For now $ref targets that
// are not resolvable will fall through to z.any() (CLI default depth).

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const schemasRoot = join(root, "docs", "design-v2", "schemas");
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

const files = walk(schemasRoot);
if (files.length === 0) {
  console.error("no schema files found under", schemasRoot);
  process.exit(1);
}

let count = 0;
for (const json of files) {
  const rel = relative(schemasRoot, json).replace(/\.json$/, ".ts");
  const out = join(generatedRoot, rel);
  mkdirSync(dirname(out), { recursive: true });
  const name = nameFromPath(json);
  execFileSync(
    "pnpm",
    [
      "exec",
      "json-schema-to-zod",
      "-i",
      json,
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
console.log(`codegen.schemas: ok (${count} schemas generated to ${relative(root, generatedRoot)}/)`);
