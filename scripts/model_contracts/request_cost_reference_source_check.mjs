// B87 R01 真实源引用日志只读核对：证明 240 条 memory_reference_logs 的 id/memory_id
// 在 SQLite 中是 16 原始字节（声明 TEXT），现有 referenceLogRows 投影后 240 条全部可解析，
// 而不是把 Node TEXT 解码失败当成源数据坏。只读冻结 full，不写源/快照。
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  FROZEN_FULL,
  FROZEN_FULL_SHA256,
  businessContentSha,
  contentCanonSnapshot,
  contentCanonSha,
  referenceLogsSignature,
  sha256File,
} from "../lib/native_ui/request_cost_snapshot.mjs";
import { referenceLogRows, REFERENCE_LOG_UUID_COLUMNS } from "../lib/native_ui/reference_log_evidence.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const OUT = path.resolve(
  ROOT,
  process.argv[2] ?? "artifacts/model-contracts/b87-r01/20261113/goal-alignment/reference-source-check.json",
);
const SNAPSHOT_MANIFEST = path.join(
  ROOT,
  "artifacts/model-contracts/b87-r01/20261113/source-snapshot/20261113-real-v2-complete/manifest.json",
);

const full = path.resolve(ROOT, FROZEN_FULL);
const before = sha256File(full);
const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_MANIFEST, "utf8"));
const at = snapshot.source?.captured_at ?? snapshot.captured_at;
const db = new DatabaseSync(full, { readOnly: true });
let facts;
try {
  const total = Number(db.prepare("SELECT COUNT(*) AS n FROM memory_reference_logs").get().n);
  const columns = Object.fromEntries(
    REFERENCE_LOG_UUID_COLUMNS.map((column) => {
      const row = db
        .prepare(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN ${column} IS NULL THEN 1 ELSE 0 END) AS null_rows,
             SUM(CASE WHEN length(CAST(${column} AS BLOB)) = 16 THEN 1 ELSE 0 END) AS len16_rows,
             SUM(CASE WHEN ${column} IS NOT NULL AND length(CAST(${column} AS BLOB)) <> 16 THEN 1 ELSE 0 END) AS other_len_rows,
             SUM(CASE WHEN length(CAST(${column} AS BLOB)) = 16 AND length(lower(hex(${column}))) = 32 THEN 1 ELSE 0 END) AS hex32_rows
           FROM memory_reference_logs`,
        )
        .get();
      return [column, {
        total: Number(row.total),
        null_rows: Number(row.null_rows),
        len16_rows: Number(row.len16_rows),
        other_len_rows: Number(row.other_len_rows),
        hex32_rows: Number(row.hex32_rows),
      }];
    }),
  );
  const distinctIds = Number(
    db.prepare("SELECT COUNT(DISTINCT lower(hex(id))) AS n FROM memory_reference_logs").get().n,
  );
  const rows = referenceLogRows(db);
  const canonicalIds = rows.filter((row) => typeof row.id === "string" && /^[0-9a-f]{32}$/u.test(row.id));
  const canonicalMemoryIds = rows.filter(
    (row) => typeof row.memory_id === "string" && /^[0-9a-f]{32}$/u.test(row.memory_id),
  );
  const canon = contentCanonSnapshot(db, at);
  const raw = contentCanonSha(db);
  const business = businessContentSha(canon);
  const candidate = JSON.parse(
    fs.readFileSync(
      path.resolve(ROOT, "artifacts/model-contracts/b87-r01/20261113/request-cost-native-complete.candidate.json"),
      "utf8",
    ),
  );

  facts = {
    schema: "b87-r01-reference-source-check/v1",
    source: {
      path: path.relative(ROOT, full),
      sha256_before: before,
      sha256_after: null,
      expected_sha256: FROZEN_FULL_SHA256,
      unchanged: null,
    },
    sql: {
      total_rows: total,
      uuid_columns: columns,
      distinct_id_count: distinctIds,
    },
    reader: {
      rows: rows.length,
      canonical_id_rows: canonicalIds.length,
      canonical_memory_id_rows: canonicalMemoryIds.length,
      all_ids_canonical: canonicalIds.length === rows.length,
      all_memory_ids_canonical: canonicalMemoryIds.length === rows.length,
    },
    canon: {
      memory_reference_logs: canon.memory_reference_logs.length,
      memory_items: canon.tables.memory_items.row_count,
      content_sha256_raw_rows: raw,
      business_content_sha256: business,
      snapshot_manifest_content_sha256: snapshot.snapshot.content_sha256,
      content_sha_matches_snapshot: raw === snapshot.snapshot.content_sha256,
      business_matches_candidate: business === candidate.snapshot.business_content_sha256,
      reference_logs_match_candidate:
        referenceLogsSignature(db).count === candidate.snapshot.reference_logs.count &&
        referenceLogsSignature(db).sha256 === candidate.snapshot.reference_logs.sha256,
    },
    assertions: {
      total_is_240: total === 240,
      id_and_memory_id_all_16_bytes:
        columns.id.len16_rows === total && columns.memory_id.len16_rows === total,
      no_uuid_column_other_length:
        REFERENCE_LOG_UUID_COLUMNS.every((column) => columns[column].other_len_rows === 0),
      reader_returns_all_rows: rows.length === total,
      canon_parses_all_logs: canon.memory_reference_logs.length === total,
      distinct_ids: distinctIds === total,
      business_matches_candidate: business === candidate.snapshot.business_content_sha256,
      reference_logs_match_candidate:
        referenceLogsSignature(db).count === candidate.snapshot.reference_logs.count &&
        referenceLogsSignature(db).sha256 === candidate.snapshot.reference_logs.sha256,
    },
  };
} finally {
  db.close();
}
const after = sha256File(full);
facts.source.sha256_after = after;
facts.source.unchanged = after === before && after === FROZEN_FULL_SHA256;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(facts, null, 2)}\n`);
const failed = Object.entries(facts.assertions).filter(([, ok]) => !ok).map(([key]) => key);
process.stdout.write(`${JSON.stringify({ ok: failed.length === 0 && facts.source.unchanged, failed, out: path.relative(ROOT, OUT) })}\n`);
if (failed.length > 0 || !facts.source.unchanged) process.exitCode = 1;
