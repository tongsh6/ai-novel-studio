// Task completion identity owner. Design: docs/engineering/quality-gates.md §2.3.1.
// Git-visible files only: not a claim about ignored builds, external dependencies or link targets.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

export const digest = (value) => createHash("sha256").update(value).digest("hex");
const encoded = (value) => JSON.stringify(value);
const must = (ok, reason) => { if (!ok) throw new Error("task-done: " + reason); };
const stamp = () => new Date().toISOString();
export function git(root, argv) {
  return execFileSync("git", argv, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
export function safeRelative(value) {
  must(typeof value === "string" && value.length > 0 && !path.isAbsolute(value) &&
    !value.split("/").some((s) => s === ".." || s === "." || s === "") && !value.includes("\0"),
  "invalid relative path");
  return value;
}
export function noLinkedParents(root, relative) {
  safeRelative(relative);
  let current = root;
  for (const name of relative.split("/").slice(0, -1)) {
    current = path.join(current, name);
    try {
      const stat = fs.lstatSync(current);
      must(stat.isDirectory() && !stat.isSymbolicLink(), "non-directory or linked parent: " + relative);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }
}
export function fileIdentity(root, relative) {
  noLinkedParents(root, relative);
  const file = path.join(root, relative);
  let before;
  try { before = fs.lstatSync(file, { bigint: true }); }
  catch (error) { if (error.code === "ENOENT") return { type: "missing" }; throw error; }
  const mode = Number(before.mode & 0o7777n);
  let type, bytes;
  if (before.isSymbolicLink()) { type = "symlink"; bytes = fs.readlinkSync(file, { encoding: "buffer" }); }
  else if (before.isFile()) { type = "file"; bytes = fs.readFileSync(file); }
  else throw new Error("task-done: unsupported file type: " + relative);
  const after = fs.lstatSync(file, { bigint: true });
  for (const field of ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"])
    must(before[field] === after[field], "file changed during capture: " + relative);
  return { type, mode, sha256: digest(bytes) };
}
function visiblePaths(root) {
  return [...new Set(git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .split("\0").filter(Boolean))].sort();
}
export function snapshot(root, previousPaths = []) {
  root = fs.realpathSync(root);
  must(fs.realpathSync(git(root, ["rev-parse", "--show-toplevel"]).trim()) === root, "not repository root");
  const common = fs.realpathSync(path.resolve(root, git(root, ["rev-parse", "--git-common-dir"]).trim()));
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  const visible = visiblePaths(root);
  const names = [...new Set([...visible, ...previousPaths])].sort();
  const entries = Object.fromEntries(names.map((name) => {
    const identity = fileIdentity(root, name);
    return [safeRelative(name), { ...identity,
      git_visible: identity.type !== "missing" && visible.includes(name) }];
  }));
  must(encoded(visible) === encoded(visiblePaths(root)), "Git inventory changed during capture");
  return { schema: "task-source/v1", repository: { root, common }, head,
    captured_at: stamp(), entries, fingerprint: digest(encoded(entries)),
    wip_porcelain_z: git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]) };
}
export function validateSnapshot(value) {
  must(value?.schema === "task-source/v1" && value.repository?.root && value.repository?.common &&
    /^[a-f0-9]{40,64}$/.test(value.head ?? "") && Number.isFinite(Date.parse(value.captured_at)),
  "invalid source snapshot");
  must(value.entries && typeof value.entries === "object" && !Array.isArray(value.entries), "invalid entries");
  for (const [name, entry] of Object.entries(value.entries)) {
    safeRelative(name);
    must(typeof entry.git_visible === "boolean" && ["missing", "file", "symlink"].includes(entry.type), "invalid file identity");
    if (entry.type !== "missing")
      must(Number.isInteger(entry.mode) && entry.mode >= 0 && entry.mode <= 4095 &&
        /^[a-f0-9]{64}$/.test(entry.sha256 ?? ""), "invalid file digest/mode");
  }
  must(value.fingerprint === digest(encoded(value.entries)), "source fingerprint mismatch");
  return value;
}
export function assertSameSource(before, after) {
  validateSnapshot(before); validateSnapshot(after);
  must(encoded(before.repository) === encoded(after.repository) && before.fingerprint === after.fingerprint,
    "Git-visible source drift");
}
export function changedPaths(before, after) {
  validateSnapshot(before); validateSnapshot(after);
  must(encoded(before.repository) === encoded(after.repository), "repository mismatch");
  return [...new Set([...Object.keys(before.entries), ...Object.keys(after.entries)])].sort()
    .filter((name) => encoded(before.entries[name]) !== encoded(after.entries[name]));
}
export function readJson(file) {
  const stat = fs.lstatSync(file);
  must(stat.isFile() && !stat.isSymbolicLink(), "JSON must be regular file");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
export function artifactPath(root, file) {
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  must(relative.startsWith("artifacts/slice-verify/"), "evidence must be in artifacts/slice-verify/<scope>");
  noLinkedParents(root, relative);
  must(!fs.existsSync(absolute) || !fs.lstatSync(absolute).isSymbolicLink(), "linked evidence");
  return absolute;
}
export function writeNewJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encoded(value) + "\n", { flag: "wx" });
}
export function beginScope(root, file, task) {
  safeRelative(task);
  must(task.startsWith("tasks/"), "task source must be an existing tasks path");
  const baseline = snapshot(root);
  must(baseline.entries[task]?.type === "file" && baseline.entries[task].git_visible, "task source missing");
  const value = { schema: "task-scope/v1", scope_id: randomUUID(), begun_at: stamp(),
    task_path: task, baseline };
  writeNewJson(artifactPath(root, file), value);
  return value;
}
export function readScope(root, file) {
  const absolute = artifactPath(root, file);
  const value = readJson(absolute);
  must(value.schema === "task-scope/v1" && typeof value.scope_id === "string" &&
    Number.isFinite(Date.parse(value.begun_at)), "invalid scope");
  validateSnapshot(value.baseline);
  must(value.baseline.repository.root === fs.realpathSync(root), "scope repository mismatch");
  safeRelative(value.task_path);
  must(value.task_path.startsWith("tasks/") && value.baseline.entries[value.task_path]?.type === "file",
    "invalid task source");
  must(Date.parse(value.baseline.captured_at) <= Date.parse(value.begun_at), "scope time inversion");
  return { path: absolute, sha256: digest(fs.readFileSync(absolute)), value };
}
export function currentForScope(root, scope) {
  return snapshot(root, Object.keys(scope.value.baseline.entries));
}
export function beginExecution(root, scopeFile, file, kind, slice = null, summaryFile = null, scanMode = null) {
  must(["native", "checks"].includes(kind), "invalid execution kind");
  if (kind === "checks") must(["full", "quick", "skipped"].includes(scanMode), "explicit checks scan mode required");
  if (kind === "native") must(typeof slice === "string" && slice.length > 0, "slice required");
  const scope = readScope(root, scopeFile);
  const source = currentForScope(root, scope);
  const expectedSummary = kind === "native" ? artifactPath(root, summaryFile) : null;
  if (kind === "native") {
    must(fileIdentity(root, path.relative(root, expectedSummary)).type === "missing", "native output already exists; use a fresh run");
    const complete = path.join(path.dirname(expectedSummary), "native-ui-complete.json");
    must(fileIdentity(root, path.relative(root, complete)).type === "missing", "native sidecar already exists; use a fresh run");
  }
  const value = { expected_summary_path: expectedSummary, schema: "task-execution-start/v1", execution_id: randomUUID(),
    scope_id: scope.value.scope_id, scope_sha256: scope.sha256, scope_path: scope.path,
    kind, scan_mode: scanMode, slice_id: slice, started_at: stamp(), source };
  writeNewJson(artifactPath(root, file), value);
  return value;
}
export function finishExecution(root, startFile, outputFile, logFile, status, command, summaryFile = null) {
  const start = readJson(artifactPath(root, startFile));
  must(start.schema === "task-execution-start/v1", "invalid execution start");
  const scope = readScope(root, start.scope_path);
  must(scope.sha256 === start.scope_sha256 && scope.value.scope_id === start.scope_id, "scope changed");
  const after = currentForScope(root, scope);
  const errors = [];
  try { assertSameSource(start.source, after); } catch (error) { errors.push(error.message); }
  const logPath = artifactPath(root, logFile);
  const log = fileIdentity(root, path.relative(root, logPath));
  must(log.type === "file", "execution log missing");
  must(Number.isInteger(status) && status >= 0 && typeof command === "string" && command.length > 0, "invalid execution outcome");
  const summaryPath = summaryFile ? artifactPath(root, summaryFile) : null;
  const summary = summaryPath ? fileIdentity(root, path.relative(root, summaryPath)) : null;
  if (start.kind === "native") must(summary?.type === "file" && summaryPath === start.expected_summary_path,
    "native output missing or not execution-selected output");
  const nativeCompletePath = summaryPath ? path.join(path.dirname(summaryPath), "native-ui-complete.json") : null;
  const nativeComplete = nativeCompletePath ? fileIdentity(root, path.relative(root, nativeCompletePath)) : null;
  const failurePath = summaryPath ? path.join(path.dirname(summaryPath), "failure.json") : null;
  const failure = failurePath ? fileIdentity(root, path.relative(root, failurePath)) : null;
  if (failure && failure.type !== "missing") errors.push("native failure artifact present");
  const result = { ...start, schema: "task-execution-binding/v1", finished_at: stamp(),
    source_after: after, exit_code: status, command, log_path: logPath, log_identity: log,
    summary_path: summaryPath, summary_identity: summary,
    native_complete_path: nativeCompletePath, native_complete_identity: nativeComplete,
    native_failure_path: failurePath, native_failure_identity: failure,
    status: status === 0 && errors.length === 0 ? "passed" : "failed", errors };
  writeNewJson(artifactPath(root, outputFile), result);
  return result;
}
export function verifyExecution(root, scope, bindingFile, current, kind, slice = null, summaryFile = null) {
  const binding = readJson(artifactPath(root, bindingFile));
  must(binding.schema === "task-execution-binding/v1" && binding.status === "passed" &&
    binding.exit_code === 0 && binding.kind === kind && binding.scope_id === scope.value.scope_id &&
    binding.scope_sha256 === scope.sha256, "execution binding mismatch");
  must(Number.isFinite(Date.parse(binding.started_at)) && Number.isFinite(Date.parse(binding.finished_at)) &&
    Date.parse(scope.value.begun_at) <= Date.parse(binding.started_at) &&
    Date.parse(binding.started_at) <= Date.parse(binding.finished_at), "execution time inversion");
  if (kind === "checks") must(["full", "quick", "skipped"].includes(binding.scan_mode), "invalid checks mode");
  assertSameSource(binding.source, binding.source_after); assertSameSource(binding.source, current);
  const logPath = artifactPath(root, binding.log_path);
  must(encoded(fileIdentity(root, path.relative(root, logPath))) === encoded(binding.log_identity), "execution log changed");
  if (kind === "native") {
    must(binding.slice_id === slice && binding.summary_path === artifactPath(root, summaryFile) &&
      binding.summary_path === binding.expected_summary_path, "native slice/summary mismatch");
    must(encoded(fileIdentity(root, path.relative(root, binding.summary_path))) === encoded(binding.summary_identity),
      "native summary changed");
    const complete = path.join(path.dirname(binding.summary_path), "native-ui-complete.json");
    must(binding.native_complete_path === complete &&
      encoded(fileIdentity(root, path.relative(root, complete))) === encoded(binding.native_complete_identity),
      "native completion sidecar changed");
    const failure = path.join(path.dirname(binding.summary_path), "failure.json");
    must(binding.native_failure_path === failure && binding.native_failure_identity?.type === "missing" &&
      encoded(fileIdentity(root, path.relative(root, failure))) === encoded(binding.native_failure_identity),
      "native failure artifact changed or present");
  }
  return binding;
}