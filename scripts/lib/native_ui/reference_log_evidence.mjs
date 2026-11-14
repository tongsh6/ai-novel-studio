// SQLite memory_reference_logs 的无损读取边界（唯一实现）。
//
// 真实 schema 的 binary_id 以 16 原始字节存进 TEXT 列；node:sqlite 直接按 TEXT 解码会
// 损坏 NUL/非法 UTF-8。这里在 SQLite 层把 16 字节列投影为 lower(hex(...))，纯函数
// （canon builder）仍只接受合法 UUID 字符串或 16-byte BLOB。原始行其余列原样保留。
import { all } from "./scenario_evidence.mjs";

export const REFERENCE_LOG_UUID_COLUMNS = Object.freeze([
  "id",
  "memory_id",
  "work_id",
  "task_id",
  "conversation_id",
]);

export function referenceLogRows(db) {
  const projections = REFERENCE_LOG_UUID_COLUMNS.map((column) =>
    `CASE WHEN length(CAST(${column} AS BLOB)) = 16 THEN lower(hex(${column})) ELSE ${column} END AS ${column}`,
  );
  // 同名 alias 位于 * 之后，node:sqlite 以后出现的同名字段覆盖前者；未知列仍全部保留。
  return all(
    db,
    `SELECT *, ${projections.join(", ")} FROM memory_reference_logs ORDER BY inserted_at, id`,
  );
}
