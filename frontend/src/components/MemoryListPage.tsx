// Design: docs/design/ui/40-ui-overview.md §design tokens
// Prototype: novel-studio.pen → memory-management（无冻结 screen frame；对齐全局浅色 token 与状态语义）
import { useEffect, useState, useCallback } from "react";
import { listMemories } from "../lib/memoryApi";
import type { MemoryItem, SearchParams } from "../lib/memoryApi";
import { MemoryCreateDialog } from "./MemoryCreateDialog";
import { MemoryDetailDrawer } from "./MemoryDetailDrawer";
import { MEMORY } from "../lib/copy";
import {
  memoryTypeLabel,
  memoryStatusLabel,
  memoryScopeLabel,
  memoryStatusTone,
  isTerminalMemory,
  memoryRecallLabel,
  isMemoryRecalled,
  type MemoryStatusTone,
} from "../lib/memoryListView";
import styles from "./MemoryListPage.module.css";

const MEMORY_TYPES = ["", ...Object.keys(MEMORY.typeLabels)];
const SCOPES = ["", "GLOBAL", "WORK", "VOLUME", "ARC", "CHAPTER", "SESSION"];
const STATUSES = ["", "DRAFT", "CONFIRMED", "STABILIZED", "CONFLICTED", "DEPRECATED", "ARCHIVED"];

const STATUS_TONE_CLASS: Record<MemoryStatusTone, string> = {
  confirmed: styles.statusConfirmed,
  stabilized: styles.statusStabilized,
  draft: styles.statusDraft,
  conflicted: styles.statusConflicted,
  terminal: styles.statusTerminal,
};

interface Props {
  workId: string;
  onBack?: () => void;
}

export function MemoryListPage({ workId, onBack }: Props) {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [filterType, setFilterType] = useState("");
  const [filterScope, setFilterScope] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterKeyword, setFilterKeyword] = useState("");
  const [filterLocked, setFilterLocked] = useState("");

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<MemoryItem | null>(null);

  const fetchMemories = useCallback(async () => {
    setLoading(true);
    setError("");

    const params: SearchParams = {};
    if (filterType) params.type = filterType;
    if (filterScope) params.scope = filterScope;
    if (filterStatus) params.status = filterStatus;
    if (filterKeyword) params.keyword = filterKeyword;
    if (filterLocked === "true") params.locked = true;
    else if (filterLocked === "false") params.locked = false;

    const result = await listMemories(workId, params);
    if (result.ok && result.data) {
      setMemories(result.data);
    } else {
      setError("加载失败");
    }
    setLoading(false);
  }, [workId, filterType, filterScope, filterStatus, filterKeyword, filterLocked]);

  useEffect(() => {
    void Promise.resolve().then(fetchMemories);
  }, [fetchMemories]);

  const handleCreated = (item: MemoryItem) => {
    setMemories((prev) => [item, ...prev]);
    setShowCreate(false);
  };

  const handleUpdated = (item: MemoryItem) => {
    setMemories((prev) => prev.map((m) => (m.id === item.id ? item : m)));
    setSelected(item);
  };

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        {onBack && (
          <button className={styles.btnSecondary} onClick={onBack}>
            {MEMORY.backToWorkbench}
          </button>
        )}
        <h2>{MEMORY.pageTitle}</h2>
        <button className={styles.btnPrimary} onClick={() => setShowCreate(true)}>
          {MEMORY.createButton}
        </button>
      </div>

      <div className={styles.filters}>
        <input
          type="text"
          placeholder={MEMORY.list.keywordPlaceholder}
          value={filterKeyword}
          onChange={(e) => setFilterKeyword(e.target.value)}
          className={styles.searchInput}
        />
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          {MEMORY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t ? memoryTypeLabel(t) : MEMORY.list.allTypes}
            </option>
          ))}
        </select>
        <select value={filterScope} onChange={(e) => setFilterScope(e.target.value)}>
          {SCOPES.map((s) => (
            <option key={s} value={s}>
              {s ? memoryScopeLabel(s) : MEMORY.list.allScopes}
            </option>
          ))}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s ? memoryStatusLabel(s) : MEMORY.list.allStatuses}
            </option>
          ))}
        </select>
        <select value={filterLocked} onChange={(e) => setFilterLocked(e.target.value)}>
          <option value="">{MEMORY.list.lockedAll}</option>
          <option value="true">{MEMORY.list.lockedYes}</option>
          <option value="false">{MEMORY.list.lockedNo}</option>
        </select>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{MEMORY.list.columns.content}</th>
              <th>{MEMORY.list.columns.type}</th>
              <th>{MEMORY.list.columns.scope}</th>
              <th>{MEMORY.list.columns.status}</th>
              <th>{MEMORY.list.columns.recall}</th>
              <th>{MEMORY.list.columns.locked}</th>
            </tr>
          </thead>
          <tbody>
            {memories.map((m) => {
              const terminal = isTerminalMemory(m.status);
              const recalled = isMemoryRecalled(m);
              return (
                <tr
                  key={m.id}
                  onClick={() => setSelected(m)}
                  className={`${styles.row} ${terminal ? styles.rowTerminal : ""}`}
                >
                  <td className={styles.contentCell}>
                    <div className={styles.contentPreview}>
                      {m.content.length > 60 ? m.content.slice(0, 60) + "..." : m.content}
                    </div>
                  </td>
                  <td>
                    <span className={styles.typeBadge}>{memoryTypeLabel(m.type)}</span>
                  </td>
                  <td>
                    <span className={styles.scope}>{memoryScopeLabel(m.scope)}</span>
                  </td>
                  <td>
                    <span
                      className={`${styles.statusBadge} ${STATUS_TONE_CLASS[memoryStatusTone(m.status)]}`}
                    >
                      <span className={styles.statusDot} aria-hidden="true" />
                      {memoryStatusLabel(m.status)}
                    </span>
                  </td>
                  <td>
                    <span className={`${styles.recall} ${recalled ? styles.recallActive : ""}`}>
                      {memoryRecallLabel(m)}
                    </span>
                  </td>
                  <td>
                    <span className={`${styles.locked} ${m.locked ? styles.lockedActive : ""}`}>
                      {m.locked ? MEMORY.list.lockedIcon : MEMORY.list.unlockedMark}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!loading && memories.length === 0 && (
              <tr>
                <td colSpan={6} className={styles.empty}>
                  {MEMORY.list.empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {loading && <div className={styles.loading}>{MEMORY.list.loading}</div>}

      {showCreate && (
        <MemoryCreateDialog
          workId={workId}
          onCreated={handleCreated}
          onClose={() => setShowCreate(false)}
        />
      )}

      {selected && (
        <MemoryDetailDrawer
          workId={workId}
          item={selected}
          onUpdated={handleUpdated}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
