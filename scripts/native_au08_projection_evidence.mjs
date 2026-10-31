// AU08 原生阅读投影故障恢复只读证据核验，不操作产品。
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  all,
  assertCommonEvidence,
  assertProviderAndWire,
  axText,
  evidenceBoundary,
  productionTableCounts,
  read,
  rewrite,
  seedFields,
  transport,
  write,
  writeNativeSummary,
  withDb,
} from "./lib/native_ui/scenario_evidence.mjs";

const SLICE = "au08-reading-projection-failure-recovery";
const bodyOf = (record) => record?.frame?.[4] ?? {};
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function snapshot(dir) {
  return withDb(dir, (db) => {
    const seed = seedFields(dir);
    return {
      drafts: all(
        db,
        `SELECT d.id, d.content, d.status, d.revision, s.chapter_id
           FROM drafts d JOIN scenes s ON s.id = d.scene_id
          WHERE d.work_id = ? ORDER BY d.id, d.revision`,
        [seed("work_id")],
      ),
      memory_items: all(
        db,
        "SELECT id, content, status, revision FROM memory_items WHERE work_id = ? ORDER BY id",
        [seed("work_id")],
      ),
      counts: productionTableCounts(dir),
    };
  });
}

export function prepare(dir) {
  const ready = read(dir, "native-driver-ready.json");
  assert.equal(ready.slice_id, SLICE);
  assert.equal(ready.driver, "external-system-ui");
  assert.equal(ready.browser_driver_started, false);
  assert.equal(ready.provider, "slice_verify");
  const seed = seedFields(dir);
  const work = withDb(dir, (db) => all(db, "SELECT id, title FROM works WHERE id = ?", [seed("work_id")])[0]);
  assert(work?.title, "seed 作品不存在");
  const config = {
    slice_id: SLICE,
    provider: ready.provider,
    target: { work_id: seed("work_id"), work_title: work.title, session_id: seed("session_id") },
    baseline: productionTableCounts(dir),
  };
  write(dir, "native-au08-config.json", config);
  return config;
}

export function capture(dir, checkpoint) {
  assert(["after_adoption", "final"].includes(checkpoint), `未知 AU08 capture: ${checkpoint}`);
  const file = path.join(dir, "native-au08-db.json");
  read(dir, "native-au08-config.json");
  const current = snapshot(dir);
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  rewrite(dir, "native-au08-db.json", { ...previous, [checkpoint]: current });
}

export function verify(dir) {
  const config = read(dir, "native-au08-config.json");
  const report = read(dir, "native-au08-report.json");
  const { ready, ui, ledger } = assertCommonEvidence(dir, {
    sliceId: SLICE,
    minScreenshots: 4,
    minimumWaits: 8,
    requiredKinds: ["input", "ack", "turn", "candidate", "adoption", "maintenance"],
  });
  const wire = assertProviderAndWire(dir, {
    minUserMessages: 1,
    minTurnResults: 2,
    minProviderStarts: 1,
  });
  const raw = transport(dir);

  const sourcePending = wire.turnResults.find((record) =>
    (bodyOf(record).adoption_state?.pending ?? []).some((entry) => entry.artifact_type === "prose_fragment"),
  );
  assert(sourcePending, "缺少真实正文 pending");
  const pending = (bodyOf(sourcePending).adoption_state?.pending ?? []).find(
    (entry) => entry.artifact_type === "prose_fragment",
  );
  const adopted = wire.turnResults.find((record) =>
    bodyOf(record).truthfulness?.artifact_adopted === true &&
    (bodyOf(record).adoption_state?.resolved ?? []).some((entry) => entry.artifact_id === pending?.artifact_id),
  );
  assert(adopted, "正文候选未真实采纳");

  const db = read(dir, "native-au08-db.json");
  const acceptedText = db.after_adoption.drafts
    .filter((row) => row.status === "ACCEPTED")
    .map((row) => row.content)
    .join("\n");
  const probe = String(report.chapter_probe ?? "");
  assert(probe.length >= 8 && acceptedText.includes(probe), "阅读探针不属于已采纳正文");

  const fault = raw.find((record) => record.fault === "channel_error_injected");
  assert(fault, "缺少 channel_error_injected 实际命中");
  assert.equal(fault.event, "get_chapter_content");
  assert.equal(fault.mode, "error");
  assert.equal(fault.count, 1);
  assert.equal(raw.filter((record) => record.fault === "channel_error_injected").length, 1);
  const faultSent = raw.find(
    (record) => record.direction === "sent" && record.frame?.[1] === fault.ref && record.dropped === true,
  );
  const errorReply = raw.find(
    (record) =>
      record.synthetic === true &&
      record.direction === "received" &&
      record.frame?.[1] === fault.ref &&
      bodyOf(record).status === "error" &&
      bodyOf(record).response?.reason === "external_channel_fault" &&
      bodyOf(record).response?.event === "get_chapter_content",
  );
  assert(faultSent && errorReply, "error 未绑定原 get_chapter_content ref 或未阻止上游");
  const sameRefUpstreamReply = raw.find(
    (record) =>
      record.direction === "received" &&
      record.frame?.[1] === fault.ref &&
      !record.synthetic && record.at >= fault.at,
  );
  assert(!sameRefUpstreamReply, "故障 ref 同时出现上游响应，无法证明零上游");

  const recoveryRequest = raw.find(
    (record) =>
      record.direction === "sent" &&
      record.frame?.[3] === "get_chapter_content" &&
      record.at > fault.at && !record.dropped,
  );
  const recoveryReply = recoveryRequest && raw.find(
    (record) =>
      record.direction === "received" &&
      record.frame?.[1] === recoveryRequest.frame[1] &&
      !record.synthetic && bodyOf(record).status === "ok",
  );
  assert(recoveryReply, "故障耗次后没有真实 get_chapter_content 恢复响应");
  assert(JSON.stringify(bodyOf(recoveryReply).response ?? {}).includes(probe), "恢复响应未读回已采纳正文");

  const stale = axText(dir, "01-reading-stale");
  const failed = axText(dir, "02-reading-failed");
  const recovered = axText(dir, "03-reading-recovered");
  const staleVisible = stale.includes("投影状态：已过期") && stale.includes("刷新投影") && stale.includes(probe);
  const failedVisible = failed.includes("投影状态：重建失败") && failed.includes("重试");
  const oldContentHidden = !failed.includes(probe) && failed.includes("正文没有被改动");
  const recoveredVisible = recovered.includes(probe) && !recovered.includes("投影状态：重建失败");

  const writesAfterFault = raw.filter(
    (record) =>
      record.direction === "sent" &&
      record.at > fault.at &&
      ["user_message", "author_action"].includes(record.frame?.[3]),
  );
  const factsUnchanged = same(db.after_adoption, db.final);
  const checks = {
    real_tauri_window_launched: ui.driver === "ax-native-system-ui" && ready.browser_driver_started === false,
    source_prose_generated_and_adopted: Boolean(sourcePending && adopted),
    reading_stale_visible: staleVisible,
    channel_error_injected_once: Boolean(fault) && raw.filter((record) => record.fault === "channel_error_injected").length === 1,
    error_reply_bound_to_get_chapter_content: Boolean(faultSent && errorReply && !sameRefUpstreamReply),
    reading_failed_visible: failedVisible,
    old_content_not_presented_as_latest: oldContentHidden,
    retry_after_fault_recovery: Boolean(recoveryRequest && recoveryReply),
    accepted_content_restored: recoveredVisible && JSON.stringify(bodyOf(recoveryReply).response ?? {}).includes(probe),
    no_write_during_fault_and_retry: writesAfterFault.length === 0 && factsUnchanged,
    production_facts_unchanged: factsUnchanged,
    wait_ledger_complete: ledger.waits >= 8 && ui.screenshots.length >= 4,
  };
  const summary = writeNativeSummary(dir, {
    sliceId: SLICE,
    checks,
    measured: {
      work_id: config.target.work_id,
      source_turn_id: report.source_turn_id,
      adopted_turn_id: report.adopted_turn_id,
      fault_ref: fault.ref,
      recovery_ref: recoveryRequest.frame[1],
      probe,
      writes_after_fault: writesAfterFault.length,
      surface: "tauri",
    },
    extra: {
      behavior: {
        name: "reading_projection_error_then_retry_recovers_without_write",
        assertions: Object.keys(checks).filter((key) => checks[key]),
      },
      evidence_boundary: evidenceBoundary(),
      known_limits: [
        "仅覆盖单作品一次 get_chapter_content error 与手动重试",
        "不证明服务端权威 projection version/revision、跨作品/离线完整矩阵或 legacy proxy mutation 已闭环",
      ],
    },
  });
  assert.equal(summary.all_checks_passed, true, `AU08 原生断言失败: ${JSON.stringify(checks)}`);
  return summary;
}

export function main([mode, artifact, checkpoint]) {
  const dir = path.resolve(artifact ?? "");
  if (!artifact) throw new Error("usage: native_au08_projection_evidence.mjs <prepare|capture|verify> <dir> [checkpoint]");
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
