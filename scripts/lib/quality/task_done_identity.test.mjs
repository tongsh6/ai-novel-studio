// Real Git/IO boundary tests; all writable repositories belong to the existing test_env run scope.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openTestRunScope } from "../test_env.mjs";
import { snapshot, changedPaths, assertSameSource, beginScope, readScope, currentForScope,
  beginExecution, finishExecution, verifyExecution } from "./task_done_identity.mjs";

let run;
before(() => { run = openTestRunScope(); });
after(() => { run?.close(); });
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
function fixture(t, cli = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(run.tmpDir, "task-git-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, content) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  };
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q"); git("config", "user.email", "fixture@example.invalid"); git("config", "user.name", "fixture");
  write(".gitignore", "artifacts/\n"); write("tasks/current.md", "Independent task\n");
  write("source.ex", "original\n"); write("frontend/src/current.ts", "original UI\n");
  if (cli) for (const name of ["scripts/task_done_check.mjs", "scripts/lib/quality/task_done_identity.mjs"])
    write(name, fs.readFileSync(path.join(repository, name)));
  git("add", "."); git("commit", "-qm", "fixture baseline");
  const scopeFile = "artifacts/slice-verify/run/scope.json";
  const begin = () => beginScope(root, scopeFile, "tasks/current.md");
  return { root, write, git, scopeFile, begin };
}
const at = (f, name) => path.join(f.root, "artifacts/slice-verify/run", name);

test("committed clean changes remain task delta; unchanged baseline UI WIP is environment only", (t) => {
  const f = fixture(t); f.write("frontend/src/current.ts", "preexisting UI WIP");
  f.begin(); const scope = readScope(f.root, f.scopeFile);
  f.write("source.ex", "task change");
  f.git("add", "."); f.git("commit", "-qm", "task changes with prior WIP");
  assert.equal(f.git("status", "--porcelain").trim(), "");
  const current = currentForScope(f.root, scope);
  assert.deepEqual(changedPaths(scope.value.baseline, current), ["source.ex"]);
  assert.match(scope.value.baseline.wip_porcelain_z, /frontend\/src\/current.ts/);
  f.write("parallel.ex", "parallel change");
  assert.deepEqual(changedPaths(scope.value.baseline, currentForScope(f.root, scope)), ["parallel.ex", "source.ex"]);
});

test("rename/delete/mode are identities independent of core.fileMode and mtime", (t) => {
  const f = fixture(t); const before = snapshot(f.root);
  const old = fs.statSync(path.join(f.root, "source.ex"));
  f.git("config", "core.fileMode", "false");
  fs.renameSync(path.join(f.root, "source.ex"), path.join(f.root, "renamed.ex"));
  fs.chmodSync(path.join(f.root, "frontend/src/current.ts"), 0o755);
  fs.utimesSync(path.join(f.root, "frontend/src/current.ts"), old.atime, old.mtime);
  assert.deepEqual(changedPaths(before, snapshot(f.root, Object.keys(before.entries))),
    ["frontend/src/current.ts", "renamed.ex", "source.ex"]);
});

test("tracked ignored files stay visible; baseline untracked later ignored is not silently dropped", (t) => {
  const f = fixture(t); f.write("draft.ex", "draft"); f.begin();
  const scope = readScope(f.root, f.scopeFile);
  f.write(".gitignore", "artifacts/\nsource.ex\ndraft.ex\n");
  f.write("source.ex", "changed tracked ignored");
  const current = currentForScope(f.root, scope);
  assert.equal(current.entries["source.ex"].git_visible, true);
  assert.equal(current.entries["draft.ex"].git_visible, false);
  assert.deepEqual(changedPaths(scope.value.baseline, current), [".gitignore", "draft.ex", "source.ex"]);
});

test("symlink target bytes never read; link/mode changes visible; linked parent/directory blocked", (t) => {
  const f = fixture(t);
  fs.symlinkSync("/no-such-private-target", path.join(f.root, "link"));
  const before = snapshot(f.root);
  assert.equal(before.entries.link.type, "symlink");
  fs.unlinkSync(path.join(f.root, "link")); fs.symlinkSync("/another-target", path.join(f.root, "link"));
  assert.deepEqual(changedPaths(before, snapshot(f.root)), ["link"]);
  fs.rmSync(path.join(f.root, "frontend"), { recursive: true });
  fs.symlinkSync("/no-such-private-directory", path.join(f.root, "frontend"));
  assert.throws(() => snapshot(f.root), /linked parent/);
  fs.unlinkSync(path.join(f.root, "frontend")); fs.mkdirSync(path.join(f.root, "frontend/src/current.ts"), { recursive: true });
  assert.throws(() => snapshot(f.root), /unsupported file type/);
});

test("missing/tampered baseline and Git failure fail closed; begin cannot overwrite", (t) => {
  const f = fixture(t);
  assert.throws(() => readScope(f.root, f.scopeFile));
  f.begin(); assert.throws(() => f.begin(), /EEXIST/);
  const value = JSON.parse(fs.readFileSync(at(f, "scope.json")));
  value.baseline.entries["source.ex"].sha256 = "0".repeat(64);
  f.write(f.scopeFile, JSON.stringify(value));
  assert.throws(() => readScope(f.root, f.scopeFile), /fingerprint/);
  fs.renameSync(path.join(f.root, ".git"), path.join(f.root, "not-git"));
  assert.throws(() => snapshot(f.root));
});

test("same source commit is reusable; content edit with restored mtime invalidates execution", (t) => {
  const f = fixture(t); f.begin();
  f.write("source.ex", "candidate");
  beginExecution(f.root, f.scopeFile, at(f, "start.json"), "checks", null, null, "full");
  f.write("artifacts/slice-verify/run/checks.log", "independent command output\n");
  finishExecution(f.root, at(f, "start.json"), at(f, "binding.json"), at(f, "checks.log"), 0, "bounded fixture command");
  f.git("add", "."); f.git("commit", "-qm", "same tested source");
  let scope = readScope(f.root, f.scopeFile);
  verifyExecution(f.root, scope, at(f, "binding.json"), currentForScope(f.root, scope), "checks");
  const stat = fs.statSync(path.join(f.root, "source.ex"));
  f.write("source.ex", "different");
  fs.utimesSync(path.join(f.root, "source.ex"), stat.atime, stat.mtime);
  assert.throws(() => verifyExecution(f.root, scope, at(f, "binding.json"), currentForScope(f.root, scope), "checks"), /drift/);
});

test("during-execution drift or nonzero outcome stays failed, never a reusable binding", (t) => {
  const f = fixture(t); f.begin();
  beginExecution(f.root, f.scopeFile, at(f, "start.json"), "checks", null, null, "full");
  f.write("source.ex", "concurrent"); f.write("artifacts/slice-verify/run/log", "failed");
  const result = finishExecution(f.root, at(f, "start.json"), at(f, "binding.json"), at(f, "log"), 1, "actual failed fixture");
  assert.equal(result.status, "failed"); assert.equal(result.exit_code, 1);
  assert.match(result.errors.join(), /drift/);
});

test("native binding requires fresh selected output, exact slice and unchanged summary/log", (t) => {
  const f = fixture(t); f.begin();
  const summary = at(f, "summary.json");
  f.write("artifacts/slice-verify/run/summary.json", '{"slice_id":"literal-a"}');
  assert.throws(() => beginExecution(f.root, f.scopeFile, at(f, "old-start.json"), "native", "literal-a", summary), /already exists/);
  fs.unlinkSync(summary);
  beginExecution(f.root, f.scopeFile, at(f, "start.json"), "native", "literal-a", summary);
  f.write("artifacts/slice-verify/run/summary.json", '{"slice_id":"literal-a"}');
  f.write("artifacts/slice-verify/run/native.log", "actual producer output");
  finishExecution(f.root, at(f, "start.json"), at(f, "binding.json"), at(f, "native.log"), 0, "fixture producer", summary);
  const scope = readScope(f.root, f.scopeFile), current = currentForScope(f.root, scope);
  verifyExecution(f.root, scope, at(f, "binding.json"), current, "native", "literal-a", summary);
  assert.throws(() => verifyExecution(f.root, scope, at(f, "binding.json"), current, "native", "literal-b", summary), /slice/);
  f.write("artifacts/slice-verify/run/native.log", "modified log");
  assert.throws(() => verifyExecution(f.root, scope, at(f, "binding.json"), current, "native", "literal-a", summary), /log changed/);
  f.write("artifacts/slice-verify/run/native.log", "actual producer output");
  f.write("artifacts/slice-verify/run/summary.json", '{"slice_id":"modified"}');
  assert.throws(() => verifyExecution(f.root, scope, at(f, "binding.json"), current, "native", "literal-a", summary), /summary changed/);
});

function cli(f, argv, env = {}) {
  return spawnSync(process.execPath, [path.join(f.root, "scripts/task_done_check.mjs"), ...argv],
    { cwd: f.root, encoding: "utf8", env: { ...process.env, TASK_DONE_MANIFEST: "", TASK_DONE_CHECK_PURPOSE: "",
      TASK_DONE_RUNNING_MANIFEST: "", ...env } });
}
function prepared(t, scanMode = "full") {
  const f = fixture(t, true); f.begin(); f.write("source.ex", "candidate");
  assert.equal(cli(f, ["--scope", f.scopeFile, "--start-execution", at(f, "checks-start.json"), "--kind", "checks", "--scan-mode", scanMode]).status, 0);
  const result = cli(f, ["--scope", f.scopeFile, "--prepare-manifest", "--artifact-dir", path.dirname(at(f, "manifest.json")),
    "--checks-start", at(f, "checks-start.json")]);
  assert.equal(result.status, 0, result.stderr);
  return f;
}
test("ordinary checker rejects running; exact explicit nested purpose is identity-only", (t) => {
  const f = prepared(t);
  const plain = cli(f, ["--manifest", at(f, "manifest.json")]);
  assert.notEqual(plain.status, 0); assert.match(plain.stderr, /completion pending/);
  const nested = cli(f, [], { TASK_DONE_MANIFEST: at(f, "manifest.json"),
    TASK_DONE_RUNNING_MANIFEST: at(f, "manifest.json"), TASK_DONE_CHECK_PURPOSE: "execution-preflight" });
  assert.equal(nested.status, 0, nested.stderr); assert.match(nested.stdout, /completion pending/);
  assert.notEqual(cli(f, ["--manifest", at(f, "manifest.json")], { TASK_DONE_CHECK_PURPOSE: "execution-preflight",
    TASK_DONE_RUNNING_MANIFEST: at(f, "other.json") }).status, 0);
});
for (const [exitCode, skipped, expected] of [[0, false, "completed"], [1, false, "failed"], [0, true, "failed"]]) {
  test("final checks outcome " + JSON.stringify({ exitCode, skipped }) + " => " + expected, (t) => {
    const f = prepared(t, skipped ? "skipped" : "full"); f.write("artifacts/slice-verify/run/checks.log", "literal scan output");
    finishExecution(f.root, at(f, "checks-start.json"), at(f, "checks-binding.json"), at(f, "checks.log"), exitCode, "fixture scan");
    const result = cli(f, ["--finalize-manifest", "--manifest", at(f, "manifest.json"),
      "--checks-binding", at(f, "checks-binding.json")]);
    assert.equal(result.status, expected === "completed" ? 0 : 1, result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(at(f, "manifest.json"))).status, expected);
    assert.equal(cli(f, ["--manifest", at(f, "manifest.json")]).status, expected === "completed" ? 0 : 1);
  });
}
test("no-scope clean scan never calls itself task completion; explicit historical manifest rejected", (t) => {
  const f = fixture(t, true);
  const plain = cli(f, []); assert.notEqual(plain.status, 0); assert.match(plain.stderr, /clean tree is not task completion/);
  const inventory = cli(f, [], { TASK_DONE_CHECK_PURPOSE: "whole-tree-inventory" });
  assert.equal(inventory.status, 0); assert.match(inventory.stdout, /no task completion asserted/);
  f.write("artifacts/slice-verify/run/old.json", '{"schema_version":"1.0.0"}');
  assert.notEqual(cli(f, ["--manifest", at(f, "old.json")]).status, 0);
});
test("scope UI delta cannot acquire an unbound legacy summary at completion", (t) => {
  const f = fixture(t, true); f.begin(); f.write("frontend/src/current.ts", "new UI");
  beginExecution(f.root, f.scopeFile, at(f, "checks-start.json"), "checks", null, null, "full");
  f.write("artifacts/slice-verify/run/summary.json", '{"surface":"tauri","driver":"ax-native-system-ui","slice_id":"a"}');
  const result = cli(f, ["--scope", f.scopeFile, "--prepare-manifest", "--artifact-dir", path.dirname(at(f, "manifest.json")),
    "--checks-start", at(f, "checks-start.json"), "--slice-id", "a", "--ui-summary", at(f, "summary.json")]);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /existing execution binding/);
  assert.equal(fs.existsSync(at(f, "manifest.json")), false);
});

test("deletion commit preserves the tested missing identity", (t) => {
  const f = fixture(t); f.begin(); const scope = readScope(f.root, f.scopeFile);
  fs.unlinkSync(path.join(f.root, "source.ex"));
  const beforeCommit = currentForScope(f.root, scope);
  f.git("add", "-u"); f.git("commit", "-qm", "delete");
  assertSameSource(beforeCommit, currentForScope(f.root, scope));
  assert.deepEqual(changedPaths(scope.value.baseline, currentForScope(f.root, scope)), ["source.ex"]);
});
test("quick scan cannot finalize complete engineering verification", (t) => {
  const f = prepared(t, "quick"); f.write("artifacts/slice-verify/run/log", "quick only");
  finishExecution(f.root, at(f, "checks-start.json"), at(f, "binding.json"), at(f, "log"), 0, "quick fixture");
  const result = cli(f, ["--finalize-manifest", "--manifest", at(f, "manifest.json"),
    "--checks-binding", at(f, "binding.json")]);
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(at(f, "manifest.json"))).status, "failed");
});
test("native absence sidecar is bound; later addition or changed content invalidates evidence", (t) => {
  const f = fixture(t); f.begin(); const summary = at(f, "summary.json");
  beginExecution(f.root, f.scopeFile, at(f, "start.json"), "native", "a", summary);
  f.write("artifacts/slice-verify/run/summary.json", '{"slice_id":"a"}');
  f.write("artifacts/slice-verify/run/log", "native");
  finishExecution(f.root, at(f, "start.json"), at(f, "binding.json"), at(f, "log"), 0, "native fixture", summary);
  const scope = readScope(f.root, f.scopeFile);
  f.write("artifacts/slice-verify/run/native-ui-complete.json", '{"driver":"ax-native-system-ui"}');
  assert.throws(() => verifyExecution(f.root, scope, at(f, "binding.json"),
    currentForScope(f.root, scope), "native", "a", summary), /sidecar changed/);
});
test("positive native producer completion is required, not just absence of failure", (t) => {
  const f = fixture(t, true); f.begin(); f.write("frontend/src/current.ts", "changed UI");
  const summary = at(f, "summary.json");
  beginExecution(f.root, f.scopeFile, at(f, "native-start.json"), "native", "a", summary);
  f.write("artifacts/slice-verify/run/summary.json", '{"surface":"tauri","driver":"ax-native-system-ui","slice_id":"a"}');
  f.write("artifacts/slice-verify/run/log", "native");
  finishExecution(f.root, at(f, "native-start.json"), at(f, "binding.json"), at(f, "log"), 0, "native fixture", summary);
  beginExecution(f.root, f.scopeFile, at(f, "checks-start.json"), "checks", null, null, "full");
  const result = cli(f, ["--scope", f.scopeFile, "--prepare-manifest", "--artifact-dir", path.dirname(at(f, "manifest.json")),
    "--checks-start", at(f, "checks-start.json"), "--slice-id", "a", "--ui-summary", summary, "--ui-binding", at(f, "binding.json")]);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /positive all_checks_passed/);
});


for (const scanExit of [0, 1]) {
  test("actual shell passes exact running manifest to nested scan and seals immutable outcome " + scanExit, (t) => {
    const f = fixture(t, true);
    f.write("scripts/task_done.sh", fs.readFileSync(path.join(repository, "scripts/task_done.sh")));
    f.write("scripts/lib/test_env.sh", "source " + JSON.stringify(path.join(repository, "scripts/lib/test_env.sh")) + "\n");
    f.write("scripts/ai_static_scan.sh", [
      "#!/usr/bin/env bash", "set -euo pipefail",
      '[[ -n "$TASK_DONE_MANIFEST" && "$TASK_DONE_MANIFEST" == "$TASK_DONE_RUNNING_MANIFEST" ]]',
      '[[ "$TASK_DONE_CHECK_PURPOSE" == execution-preflight ]]',
      "node scripts/task_done_check.mjs", "echo literal-fixture-scan-result", "exit " + scanExit, ""
    ].join("\n"));
    f.git("add", "."); f.git("commit", "-qm", "install actual gate and fixture scan");
    f.begin(); f.write("source.ex", "task");
    const result = spawnSync("bash", [path.join(f.root, "scripts/task_done.sh"), "--scope", f.scopeFile],
      { cwd: f.root, encoding: "utf8", env: run.env({ NOVEL_TEST_ENTRY_SCOPED: "1" }) });
    assert.equal(result.status, scanExit === 0 ? 0 : 1, result.stderr + result.stdout);
    const parent = path.join(f.root, "artifacts/slice-verify");
    const dir = path.join(parent, fs.readdirSync(parent).find((name) => name.startsWith("task-completion-")));
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json")));
    assert.equal(manifest.status, scanExit === 0 ? "completed" : "failed");
    assert.equal(manifest.task_acceptance, "not_asserted");
    assert.equal(manifest.static_scan_mode, "full");
    assert.equal(cli(f, ["--manifest", path.join(dir, "manifest.json")]).status, scanExit === 0 ? 0 : 1);
    assert.match(fs.readFileSync(path.join(dir, "checks.log"), "utf8"), /completion pending/);
    assert.match(fs.readFileSync(path.join(dir, "checks.log"), "utf8"), /literal-fixture-scan-result/);
  });
}


test("read failure is not missing/empty; execution time inversion and different scope reject", (t) => {
  const f = fixture(t); f.begin();
  const read = fs.readFileSync;
  fs.readFileSync = (file, ...rest) => {
    if (file === path.join(f.root, "source.ex")) throw Object.assign(new Error("denied"), { code: "EACCES" });
    return read(file, ...rest);
  };
  try { assert.throws(() => snapshot(f.root), /denied/); }
  finally { fs.readFileSync = read; }
  beginExecution(f.root, f.scopeFile, at(f, "start.json"), "checks", null, null, "full");
  f.write("artifacts/slice-verify/run/log", "literal");
  finishExecution(f.root, at(f, "start.json"), at(f, "binding.json"), at(f, "log"), 0, "fixture");
  beginScope(f.root, at(f, "other-scope.json"), "tasks/current.md");
  const other = readScope(f.root, at(f, "other-scope.json"));
  assert.throws(() => verifyExecution(f.root, other, at(f, "binding.json"), currentForScope(f.root, other), "checks"), /binding mismatch/);
  const binding = JSON.parse(fs.readFileSync(at(f, "binding.json")));
  binding.finished_at = "2000-01-01T00:00:00Z";
  f.write("artifacts/slice-verify/run/binding.json", JSON.stringify(binding));
  const scope = readScope(f.root, f.scopeFile);
  assert.throws(() => verifyExecution(f.root, scope, at(f, "binding.json"), currentForScope(f.root, scope), "checks"), /time inversion/);
});

test("checks must freeze full/quick/skipped before execution, never infer a missing mode", (t) => {
  const f = fixture(t); f.begin();
  assert.throws(() => beginExecution(f.root, f.scopeFile, at(f, "start.json"), "checks"), /scan mode required/);
  assert.equal(fs.existsSync(at(f, "start.json")), false);
});
test("a failed native execution cannot become green by deleting its failure artifact", (t) => {
  const f = fixture(t); f.begin(); const summary = at(f, "summary.json");
  beginExecution(f.root, f.scopeFile, at(f, "start.json"), "native", "a", summary);
  f.write("artifacts/slice-verify/run/summary.json", '{"slice_id":"a","all_checks_passed":true}');
  f.write("artifacts/slice-verify/run/failure.json", '{"reason":"independent failure"}');
  f.write("artifacts/slice-verify/run/log", "native");
  const binding = finishExecution(f.root, at(f, "start.json"), at(f, "binding.json"), at(f, "log"), 0, "fixture", summary);
  assert.equal(binding.status, "failed");
  fs.unlinkSync(at(f, "failure.json"));
  const scope = readScope(f.root, f.scopeFile);
  assert.throws(() => verifyExecution(f.root, scope, at(f, "binding.json"), currentForScope(f.root, scope), "native", "a", summary), /binding mismatch/);
});
