#!/usr/bin/env node
// B45 CP0：38 份 JSON schema 的可复核盘点（$ref/enum/生成物/真实消费者）。
// 只读 docs/design/schemas 与 frontend/src，不修改产品 codegen 或 schema。
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const schemasRoot = join(root, "docs/design/schemas");
const generatedRoot = join(root, "frontend/src/generated");
const outDir = join(root, "artifacts/b45-schema-inventory");
mkdirSync(outDir, { recursive: true });

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".json")) out.push(full);
  }
  return out;
}
function pascalCase(s) {
  return s.replace(/[._-]+/g, " ").replace(/\s(.)/g, (_, c) => c.toUpperCase()).replace(/^./, (c) => c.toUpperCase());
}
function refsOf(value, out = []) {
  if (Array.isArray(value)) value.forEach((item) => refsOf(item, out));
  else if (value && typeof value === "object") {
    if (typeof value.$ref === "string") out.push(value.$ref);
    Object.values(value).forEach((item) => refsOf(item, out));
  }
  return out;
}
const files = walk(schemasRoot).sort();
const rels = files.map((file) => relative(schemasRoot, file));
const docs = new Map(rels.map((rel) => [rel, JSON.parse(readFileSync(join(schemasRoot, rel), "utf8"))]));
const generatedFiles = walkFiles(generatedRoot);
function walkFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}
const sourceFiles = readdirSync(join(root, "frontend/src"), { recursive: true })
  .map((rel) => join(root, "frontend/src", rel))
  .filter((file) => /\.(ts|tsx)$/.test(file) && !file.includes(`${join(root, "frontend/src/generated")}`))
  .filter((file) => statSync(file).isFile());
const sourceText = new Map(sourceFiles.map((file) => [file, readFileSync(file, "utf8")]));

const rows = [];
for (const rel of rels) {
  const doc = docs.get(rel);
  const refs = refsOf(doc);
  const unresolved = [];
  for (const ref of refs) {
    if (ref.startsWith("#")) continue;
    const target = relative(schemasRoot, join(schemasRoot, dirname(rel), ref)).replaceAll("\\", "/");
    if (!docs.has(target)) unresolved.push({ ref, target });
  }
  const base = rel.replace(/\.json$/, "").split("/").pop();
  const name = pascalCase(base);
  const generatedRel = rel.replace(/\.json$/, ".ts");
  const generatedPath = join(generatedRoot, generatedRel);
  let generated = null;
  if (generatedFiles.includes(generatedPath)) {
    const text = readFileSync(generatedPath, "utf8");
    generated = { file: relative(root, generatedPath), any_count: (text.match(/z\.any\(\)/g) ?? []).length };
  }
  const consumers = [];
  const generatedImport = `generated/foundation/${generatedRel.replace(/\.ts$/, "")}`;
  for (const [file, text] of sourceText) {
    if (text.includes(`${name}Schema`) || text.includes(generatedImport)) consumers.push(relative(root, file));
  }
  const elixirModule = `NovelFoundation.Enums.${name}`;
  const elixirFile = join(root, "apps/novel_foundation/lib/novel_foundation/enums", `${base}.ex`);
  let elixir = null;
  if (rel.startsWith("foundation/enums/") && statSync(dirname(elixirFile), { throwIfNoEntry: false })) {
    try {
      const text = readFileSync(elixirFile, "utf8");
      elixir = { file: relative(root, elixirFile), generated: text.includes("AUTO-GENERATED FROM docs/design/schemas") };
    } catch { elixir = null; }
  }
  const backendConsumers = [];
  if (elixir) {
    const allAppFiles = readdirSync(join(root, "apps"), { recursive: true })
      .map((relPath) => join(root, "apps", relPath))
      .filter((file) => file.endsWith(".ex") && statSync(file).isFile() && !file.endsWith(`/enums/${base}.ex`));
    for (const file of allAppFiles) {
      if (readFileSync(file, "utf8").includes(elixirModule)) backendConsumers.push(relative(root, file));
    }
  }
  const enumValues = Array.isArray(doc.enum) ? doc.enum : undefined;
  rows.push({
    schema: rel,
    title: doc.title ?? null,
    generated,
    refs,
    unresolved_refs: unresolved,
    enum_values: enumValues,
    consumers: [...new Set(consumers)],
    elixir,
    backend_consumers: [...new Set(backendConsumers)],
    classification: classify(rel, generated, unresolved),
  });
}

function classify(rel, generated, unresolved) {
  if (rel.includes("turn_result_v2")) return "legacy-frozen (not current wire)";
  if (rel.includes("phase_next_action_compat")) return "legacy-compat (generated any)";
  if (unresolved.length > 0) return "broken-ref";
  if (generated && generated.any_count > 0) return "active-with-intentional-open-shape";
  return "active";
}

const report = {
  generated_at: new Date().toISOString(),
  schema_count: rows.length,
  ref_count: rows.reduce((sum, row) => sum + row.refs.length, 0),
  unresolved_ref_count: rows.reduce((sum, row) => sum + row.unresolved_refs.length, 0),
  rows,
};
writeFileSync(join(outDir, "schema-inventory.json"), `${JSON.stringify(report, null, 2)}\n`);
const lines = [
  "# B45 CP0 schema inventory",
  "",
  `- schemas: ${report.schema_count}`,
  `- $refs: ${report.ref_count}; unresolved: ${report.unresolved_ref_count}`,
  "",
  "| schema | class | generated any | unresolved $ref | frontend consumers | backend consumers |",
  "|---|---|---:|---:|---|---|",
  ...rows.map((row) => `| ${row.schema} | ${row.classification} | ${row.generated?.any_count ?? "n/a"} | ${row.unresolved_refs.length} | ${row.consumers.length ? row.consumers.join("<br>") : "—"} | ${row.backend_consumers.length ? row.backend_consumers.length + " files" : "—"} |`),
  "",
];
writeFileSync(join(outDir, "schema-inventory.md"), lines.join("\n"));
console.log(`b45-schema-inventory: ${rows.length} schemas, ${report.unresolved_ref_count} unresolved refs -> ${relative(root, outDir)}`);
