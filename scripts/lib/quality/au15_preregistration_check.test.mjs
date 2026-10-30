import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

test("B42-PREP AU-15 checker reports not_ready without model/product writes", () => {
  const output = execFileSync(process.execPath, [join(root, "scripts/au15_preregistration_check.mjs")], {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.match(output, /not_ready/);

  const report = JSON.parse(
    readFileSync(join(root, "artifacts/b42-prep/readiness.json"), "utf8"),
  );
  assert.equal(report.schema, "au15-prep-readiness/v1");
  assert.equal(report.mode, "preparation_only_no_model_no_provider_no_product_write");
  assert.equal(report.overall, "not_ready");
  assert.ok(report.blockers.includes("d6a_precondition"));
  assert.ok(report.blockers.includes("author_semantic_review"));
  assert.ok(report.blockers.includes("resource_window"));
  assert.ok(report.checks.some((check) => check.id === "single_slot_unload" && check.status === "ready"));
});
