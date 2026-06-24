// Design: docs/design/ui/43-structure-panel.md §4.3
// Prototype: novel-studio.pen → 43§5-structure-panel-expanded (ATnmR)
import type { CharacterData, MemoryItemData } from "./socket";
import { STRUCTURE_PANEL } from "./copy";

export type ArchiveDetailItem =
  | { kind: "character"; item: CharacterData }
  | { kind: "memory"; item: MemoryItemData };

export interface ArchiveDetailRow {
  label: string;
  value: string;
}

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function labelFromMap(
  labels: Record<string, string>,
  value: string | null | undefined,
): string | null {
  const normalized = nonEmpty(value);
  if (!normalized) return null;
  return labels[normalized] ?? normalized;
}

function formatNumber(value: number | null | undefined): string | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return value.toFixed(2);
}

function formatDate(value: string | null | undefined): string | null {
  const normalized = nonEmpty(value);
  if (!normalized) return null;

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return normalized;

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function pushRow(rows: ArchiveDetailRow[], label: string, value: string | null): void {
  if (!value) return;
  rows.push({ label, value });
}

export function memoryTypeLabel(value: string): string {
  return labelFromMap(STRUCTURE_PANEL.memoryTypeLabels, value) ?? value;
}

export function archiveDetailTitle(detail: ArchiveDetailItem): string {
  if (detail.kind === "character") return detail.item.name;
  return detail.item.content;
}

export function archiveDetailSummary(detail: ArchiveDetailItem): string | null {
  if (detail.kind === "character") return nonEmpty(detail.item.summary);
  const summary = nonEmpty(detail.item.summary);
  return summary && summary !== detail.item.content ? summary : null;
}

export function archiveDetailRows(detail: ArchiveDetailItem): ArchiveDetailRow[] {
  const rows: ArchiveDetailRow[] = [];

  if (detail.kind === "character") {
    pushRow(
      rows,
      STRUCTURE_PANEL.detailRows.narrativeRole,
      detail.item.narrative_role
        ? (STRUCTURE_PANEL.narrativeRoleLabels[detail.item.narrative_role] ??
            detail.item.narrative_role)
        : null,
    );
    pushRow(rows, STRUCTURE_PANEL.detailRows.role, nonEmpty(detail.item.role));
    pushRow(
      rows,
      STRUCTURE_PANEL.detailRows.aliases,
      detail.item.aliases.length > 0 ? detail.item.aliases.join("、") : null,
    );
    pushRow(rows, STRUCTURE_PANEL.detailRows.state, STRUCTURE_PANEL.detailValues.adopted);
    pushRow(rows, STRUCTURE_PANEL.detailRows.updatedAt, formatDate(detail.item.updated_at));
    return rows;
  }

  pushRow(
    rows,
    STRUCTURE_PANEL.detailRows.type,
    labelFromMap(STRUCTURE_PANEL.memoryTypeLabels, detail.item.type),
  );
  pushRow(
    rows,
    STRUCTURE_PANEL.detailRows.scope,
    labelFromMap(STRUCTURE_PANEL.memoryScopeLabels, detail.item.scope),
  );
  pushRow(
    rows,
    STRUCTURE_PANEL.detailRows.source,
    labelFromMap(STRUCTURE_PANEL.sourceTypeLabels, detail.item.source_type),
  );
  pushRow(
    rows,
    STRUCTURE_PANEL.detailRows.state,
    detail.item.recallable === false
      ? STRUCTURE_PANEL.detailValues.notRecallable
      : STRUCTURE_PANEL.detailValues.recallable,
  );
  pushRow(rows, STRUCTURE_PANEL.detailRows.weight, formatNumber(detail.item.weight));
  pushRow(rows, STRUCTURE_PANEL.detailRows.confidence, formatNumber(detail.item.confidence));
  pushRow(
    rows,
    STRUCTURE_PANEL.detailRows.referenceCount,
    String(detail.item.reference_count ?? 0),
  );
  pushRow(rows, STRUCTURE_PANEL.detailRows.version, String(detail.item.version ?? 1));
  pushRow(
    rows,
    STRUCTURE_PANEL.detailRows.tags,
    detail.item.tags.length > 0 ? detail.item.tags.join("、") : null,
  );
  pushRow(
    rows,
    STRUCTURE_PANEL.detailRows.protection,
    detail.item.locked ? STRUCTURE_PANEL.detailValues.locked : null,
  );
  pushRow(rows, STRUCTURE_PANEL.detailRows.updatedAt, formatDate(detail.item.updated_at));

  return rows;
}
