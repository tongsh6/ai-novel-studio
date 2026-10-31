// Q1c 原生页面补验证据核验（外部 AX/CGEvent 驱动真实 Tauri 窗口）。
//
// 驱动：scripts/native_q1c_drive.mjs。只消费隔离批次只读证据：
// native-driver-ready.json / native-ui-complete.json / native-transport.jsonl /
// app-log / llm-calls / AX 截图文本 / 只读 SQLite / native-q1c-report.json。
// 断言语义与 browser canonical driver 同源（16 条不降级），只把驱动面换成原生窗口。
// 产品代码不读取本文件。
//
// 模式：prepare <dir> / capture <dir> <checkpoint> / verify <dir>
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  actionMatchesArtifact,
  isOverwriteConfirmation,
  pendingText,
  revisionOf,
} from "./lib/native_ui/adoption_contract.mjs";
import {
  all,
  assertCommonEvidence,
  assertProviderAndWire,
  axText,
  dbPath,
  evidenceBoundary,
  productionTableCounts,
  read,
  rewrite,
  write,
  writeNativeSummary,
  withDb,
} from "./lib/native_ui/scenario_evidence.mjs";

const SLICE = "q1c-adopted-content-revision";
const OLD_AGE = "二十五岁";
const NEW_AGE = "三十岁";

const latestLogs = (dir, sub) => {
  const base = path.join(dir, sub);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .flatMap((name) =>
      fs
        .readFileSync(path.join(base, name), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    );
};

const frameOf = (record) =>
  Array.isArray(record?.frame) && record.frame.length >= 5 ? record.frame : null;

const bodyOf = (record) => frameOf(record)?.[4] ?? {};

export function followupUsesNewVersion(text) {
  return (
    text.includes(NEW_AGE) &&
    (!text.includes(OLD_AGE) || /此前|已被.*替代|历史|旧版本|修订|原设定|采纳后的版本/.test(text))
  );
}

export function followupMemoryContextIsNew(turnResult, text) {
  const memoryRefs = (turnResult?.trace_summary?.context_refs ?? []).filter(
    (ref) => ref.source_type === "memory",
  );
  return (
    memoryRefs.length > 0 &&
    !memoryRefs.some((ref) => String(ref.summary ?? "").includes(OLD_AGE)) &&
    followupUsesNewVersion(text)
  );
}

async function createWork(ready) {
  const nonce = `Q1CNATIVE${Date.now()}`;
  const title = `Q1c原生修订作品-${nonce}`;
  const response = await fetch(`${ready.api_url}/api/works`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, genre: "仙侠", tone_preference: "冷峻" }),
  });
  assert(response.ok, `创建作品失败: HTTP ${response.status}`);
  const body = await response.json();
  assert(body?.work?.id, "创建作品响应缺少 work id");
  return { workId: body.work.id, workTitle: String(body.work.title ?? title), nonce };
}

export async function prepare(dir) {
  const ready = read(dir, "native-driver-ready.json");
  assert.equal(ready.slice_id, SLICE, "原生 ready.slice_id 与 Q1c 场景不一致");
  assert.equal(ready.driver, "external-system-ui", "原生批次驱动标识错误");
  assert.equal(ready.browser_driver_started, false, "原生批次不得启动 Chromium");
  assert.equal(ready.provider, "slice_verify", "Q1c 原生批次必须使用 slice_verify");

  const created = await createWork(ready);
  const { execFileSync } = await import("node:child_process");
  execFileSync(
    "python3",
    [
      "-c",
      [
        "import sqlite3,sys,datetime",
        "db=sqlite3.connect(sys.argv[1], timeout=10)",
        "ts=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')+'Z'",
        "db.execute('update works set updated_at=? where id=?',(ts,sys.argv[2]))",
        "db.commit(); db.close()",
      ].join("\n"),
      dbPath(dir),
      created.workId,
    ],
    { stdio: "ignore" },
  );

  const sourceText = `岑舟今年${OLD_AGE}，是青云宗宗主，掌管东洲灵脉。资料校验标识${created.nonce}。`;
  const config = {
    slice_id: SLICE,
    provider: ready.provider,
    target: { work_id: created.workId, work_title: created.workTitle },
    nonce: created.nonce,
    source_text: sourceText,
    messages: {
      source: `请把以下原文登记为作品设定，不要改写：${sourceText}`,
      revision: `请把已保存的设定里岑舟的年龄从${OLD_AGE}改成${NEW_AGE}，其他内容保持不变。资料校验标识${created.nonce}。`,
      followup: "岑舟今年多少岁？请依据当前已保存的作品设定回答。",
    },
    expected: { old_age: OLD_AGE, new_age: NEW_AGE },
    captures: [
      "00-workbench",
      "01-source-pending",
      "02-source-adopted",
      "03-revision-pending",
      "03b-revision-confirmation",
      "04-revision-adopted",
      "04b-restarted",
      "05-followup",
    ],
    baseline: productionTableCounts(dir),
  };
  write(dir, "native-q1c-config.json", config);
  return config;
}

export function capture(dir, checkpoint) {
  const config = read(dir, "native-q1c-config.json");
  assert(
    checkpoint === "start" || checkpoint === "final" || config.captures.includes(checkpoint),
    `未知 Q1c 原生 capture checkpoint: ${checkpoint}`,
  );
  const counts = productionTableCounts(dir);
  const file = path.join(dir, "native-q1c-db.json");
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  rewrite(dir, "native-q1c-db.json", { ...existing, [checkpoint]: counts });
}

export function verify(dir) {
  const config = read(dir, "native-q1c-config.json");
  const report = read(dir, "native-q1c-report.json");
  const { ready, ui } = assertCommonEvidence(dir, {
    sliceId: SLICE,
    minScreenshots: 7,
    minimumWaits: 8,
    requiredKinds: ["input", "ack", "turn", "candidate", "adoption", "restore", "maintenance"],
  });
  assert.equal(ready.slice_id, SLICE);

  const wire = assertProviderAndWire(dir, {
    minUserMessages: 3,
    minTurnResults: 3,
    minProviderStarts: 1,
  });

  const sourceMessage = wire.userMessages.find((record) => {
    const body = bodyOf(record);
    return body.text === config.messages.source && body.work_id === config.target.work_id;
  });
  assert(sourceMessage, "真实工作台未发送源设定 user_message");
  const sourceTurnId = bodyOf(sourceMessage).turn_id;
  const sourceTurn = wire.turnResults.find((record) => {
    const body = bodyOf(record);
    return (
      body.turn_id === sourceTurnId &&
      (body.adoption_state?.pending ?? []).some((entry) => pendingText(entry).includes(config.nonce))
    );
  });
  assert(sourceTurn, "未收到含源设定的 pending turn_result");
  const sourcePending = (bodyOf(sourceTurn).adoption_state?.pending ?? []).find((entry) =>
    pendingText(entry).includes(config.nonce),
  );
  assert.equal(
    bodyOf(sourceTurn).truthfulness?.production_write_performed,
    false,
    "源设定 pending 轮直接写入作品",
  );

  const sourceAdopted = wire.turnResults.find((record) => {
    const body = bodyOf(record);
    return (
      body.truthfulness?.artifact_adopted === true &&
      (body.adoption_state?.resolved ?? []).some(
        (entry) => entry.artifact_id === sourcePending?.artifact_id,
      )
    );
  });
  assert(sourceAdopted, "源设定未真实采纳");

  const revisionMessage = wire.userMessages.find((record) => {
    const body = bodyOf(record);
    return body.text === config.messages.revision && body.work_id === config.target.work_id;
  });
  assert(revisionMessage, "真实工作台未发送修订 user_message");
  const revisionTurnId = bodyOf(revisionMessage).turn_id;
  const revisionTurn = wire.turnResults.find((record) => {
    const body = bodyOf(record);
    return (
      body.turn_id === revisionTurnId &&
      (body.adoption_state?.pending ?? []).some(
        (entry) => pendingText(entry).includes(config.expected.new_age) && revisionOf(entry) != null,
      )
    );
  });
  assert(revisionTurn, "未收到含 revision_of 的修订 pending turn_result");
  const revisionPending = (bodyOf(revisionTurn).adoption_state?.pending ?? []).find(
    (entry) => pendingText(entry).includes(config.expected.new_age) && revisionOf(entry) != null,
  );
  const acceptedTargetIdentified = revisionOf(revisionPending) === sourcePending?.artifact_id;

  const confirmationRequired = wire.wire.some((record) => {
    const body = bodyOf(record);
    return (
      isOverwriteConfirmation(body) &&
      (actionMatchesArtifact(body, revisionPending?.artifact_id) ||
        body.behavior_state?.active?.target_ref === revisionPending?.artifact_id ||
        (body.adoption_state?.pending ?? []).some(
          (entry) => entry.artifact_id === revisionPending?.artifact_id,
        ))
    );
  });

  const revisionAdopted = wire.turnResults.find((record) => {
    const body = bodyOf(record);
    return (
      body.truthfulness?.artifact_adopted === true &&
      (body.adoption_state?.resolved ?? []).some(
        (entry) => entry.artifact_id === revisionPending?.artifact_id,
      )
    );
  });
  assert(revisionAdopted, "修订候选未真实采纳");

  const rows = withDb(dir, (db) =>
    all(
      db,
      "SELECT id, content, status, supersedes_ref, superseded_by_ref FROM memory_items WHERE work_id = ? AND content LIKE ?",
      [config.target.work_id, `%${config.nonce}%`],
    ),
  );
  const oldRow = rows.find((row) => String(row.content ?? "").includes(config.expected.old_age));
  const newRow = rows.find((row) => String(row.content ?? "").includes(config.expected.new_age));
  assert(oldRow, "DB 缺少旧版设定事实");
  assert(newRow, "DB 缺少修订后的新设定事实");
  assert.equal(newRow.status, "CONFIRMED", "新版设定不是 CONFIRMED");
  assert.equal(oldRow.status, "SUPERSEDED", "旧版设定不是 SUPERSEDED");
  assert.equal(String(newRow.supersedes_ref ?? ""), String(oldRow.id), "新版 supersedes_ref 未指向旧版");
  assert.equal(String(oldRow.superseded_by_ref ?? ""), String(newRow.id), "旧版 superseded_by_ref 未指向新版");

  const confirmedRows = rows.filter((row) => row.status === "CONFIRMED");
  const supersededRows = rows.filter((row) => row.status === "SUPERSEDED");

  const followupMessage = wire.userMessages.find((record) => {
    const body = bodyOf(record);
    return body.text === config.messages.followup && body.work_id === config.target.work_id;
  });
  assert(followupMessage, "真实工作台未发送追问 user_message");
  const followupTurnId = bodyOf(followupMessage).turn_id;
  const followupTurn = wire.turnResults.find(
    (record) => bodyOf(record).turn_id === followupTurnId && bodyOf(record).assistant_message != null,
  );
  assert(followupTurn, "追问未产生 turn_result");
  const followupText = String(bodyOf(followupTurn).assistant_message?.text ?? "");

  const axFinal = [
    "01-source-pending",
    "03-revision-pending",
    "03b-revision-confirmation",
    "04-revision-adopted",
    "04b-restarted",
    "05-followup",
  ]
    .map((name) => axText(dir, name))
    .join("\n");
  const axHasNew = axFinal.includes(config.expected.new_age);
  const axHasAdoptAction = axFinal.includes("保存到作品") || axFinal.includes("保存到作品档案");
  const axHasConfirm = axFinal.includes("确认执行") || axFinal.includes("确认保存");

  const appRecords = latestLogs(dir, "app-log");
  const adoptionEvents = appRecords.filter((record) =>
    String(record.event ?? "").startsWith("adoption."),
  );

  const baseline = config.baseline ?? {};
  const finalCounts = productionTableCounts(dir);
  const regressedTables = Object.keys(baseline).filter(
    (table) => (finalCounts[table] ?? 0) < (baseline[table] ?? 0),
  );
  assert.equal(regressedTables.length, 0, `生产表计数回退: ${regressedTables.join(",")}`);

  const checks = {
    real_tauri_window_launched: ui.driver === "ax-native-system-ui" && ready.browser_driver_started === false,
    source_pending_created: Boolean(sourcePending),
    source_adopted: Boolean(sourceAdopted),
    revision_candidate_created: Boolean(revisionPending),
    revision_of_present: revisionOf(revisionPending) != null,
    accepted_target_identified: acceptedTargetIdentified,
    overwrite_confirmation_required: confirmationRequired,
    exactly_one_confirmed_fact: confirmedRows.length === 1,
    old_version_not_confirmed: oldRow.status !== "CONFIRMED",
    new_version_confirmed: newRow.status === "CONFIRMED",
    one_superseded_fact: supersededRows.length === 1,
    assistant_did_not_claim_done_without_candidate:
      Boolean(revisionPending) ||
      !/已(修改|更新|保存|替换)/.test(String(bodyOf(revisionTurn).assistant_message?.text ?? "")),
    followup_uses_new_version: followupUsesNewVersion(followupText),
    followup_memory_context_is_new: followupMemoryContextIsNew(bodyOf(followupTurn), followupText),
    native_window_shows_adopt_actions: axHasAdoptAction,
    native_window_shows_confirmation: axHasConfirm,
    native_window_relaunched_before_followup: ui.screenshots.includes("04b-restarted.jpg"),
    native_window_shows_new_value: axHasNew,
    adoption_events_recorded: adoptionEvents.length >= 2,
    no_production_table_regression: regressedTables.length === 0,
  };

  const summary = writeNativeSummary(dir, {
    sliceId: SLICE,
    checks,
    measured: {
      work_id: config.target.work_id,
      work_title: config.target.work_title,
      source_turn_id: sourceTurnId,
      revision_turn_id: revisionTurnId,
      followup_turn_id: followupTurnId,
      old_memory_id: oldRow.id,
      new_memory_id: newRow.id,
      new_memory_status: newRow.status,
      old_memory_status: oldRow.status,
      confirmed_facts: confirmedRows.length,
      superseded_facts: supersededRows.length,
      driver: ui.driver,
      surface: "tauri",
      report_turn_ids: {
        source: report?.source?.turn_id ?? null,
        revision: report?.revision?.turn_id ?? null,
        followup: report?.followup?.turn_id ?? null,
      },
    },
    extra: {
      behavior: {
        name: "adopted_world_setting_revision_supersedes_old_version_and_followup_reads_new",
        assertions: Object.keys(checks).filter((key) => checks[key]),
      },
      key_events: [
        "channel.user_message.start",
        "channel.author_action.start",
        "adoption.evaluate.start",
        "adoption.evaluate.done",
        "channel.turn_result",
      ],
      evidence_boundary: evidenceBoundary(),
    },
  });
  assert.equal(summary.all_checks_passed, true, `Q1c 原生断言失败: ${JSON.stringify(checks)}`);
  return summary;
}

export function main([mode, artifact, checkpoint]) {
  const dir = path.resolve(artifact ?? "");
  if (!artifact) {
    throw new Error("usage: node scripts/native_q1c_evidence.mjs <prepare|capture|verify> <dir> [checkpoint]");
  }
  if (mode === "prepare") return prepare(dir);
  if (mode === "capture") return capture(dir, checkpoint);
  if (mode === "verify") return verify(dir);
  throw new Error(`unknown mode: ${mode}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve(main(process.argv.slice(2))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
