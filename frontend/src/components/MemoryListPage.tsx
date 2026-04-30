// Design: N/A (memory management maintenance page — awaits design spec)
// Prototype: N/A (Phase 0 memory management maintenance page has no frozen screen frame)
// NOTE: 此页面为 Phase 0 快速验证产物，待 UI 设计阶段需重新对照原型实现
import { useEffect, useState, useCallback } from "react";
import { listMemories } from "../lib/memoryApi";
import type { MemoryItem, SearchParams } from "../lib/memoryApi";
import { MemoryCreateDialog } from "./MemoryCreateDialog";
import { MemoryDetailDrawer } from "./MemoryDetailDrawer";
import styles from "./MemoryListPage.module.css";

const TYPE_LABELS: Record<string, string> = {
  WORLD_RULE: "世界观规则",
  CHARACTER_PROFILE: "人物设定",
  CURRENT_STATE: "当前状态",
  RELATIONSHIP: "人物关系",
  PLOT_FACT: "剧情事实",
  FORESHADOWING: "伏笔",
  STYLE_RULE: "写作风格",
  CONSTRAINT: "创作约束",
  AUTHOR_PREFERENCE: "作者偏好",
  IDEA: "灵感",
  DRAFT_CONTEXT: "草稿上下文",
};

const MEMORY_TYPES = ["", ...Object.keys(TYPE_LABELS)];
const SCOPES = ["", "GLOBAL", "WORK", "VOLUME", "ARC", "CHAPTER", "SESSION"];
const STATUSES = ["", "DRAFT", "CONFIRMED", "STABILIZED", "CONFLICTED", "DEPRECATED", "ARCHIVED"];

interface Props {
  workId: string;
}

export function MemoryListPage({ workId }: Props) {
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
    setMemories((prev) =>
      prev.map((m) => (m.id === item.id ? item : m)),
    );
    setSelected(item);
  };

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <h2>记忆管理</h2>
        <button className={styles.btnPrimary} onClick={() => setShowCreate(true)}>
          + 新建记忆
        </button>
      </div>

      <div className={styles.filters}>
        <input
          type="text"
          placeholder="搜索关键词..."
          value={filterKeyword}
          onChange={(e) => setFilterKeyword(e.target.value)}
          className={styles.searchInput}
        />
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          {MEMORY_TYPES.map((t) => (
            <option key={t} value={t}>{t || "全部类型"}</option>
          ))}
        </select>
        <select value={filterScope} onChange={(e) => setFilterScope(e.target.value)}>
          {SCOPES.map((s) => (
            <option key={s} value={s}>{s || "全部范围"}</option>
          ))}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s || "全部状态"}</option>
          ))}
        </select>
        <select value={filterLocked} onChange={(e) => setFilterLocked(e.target.value)}>
          <option value="">锁定状态</option>
          <option value="true">已锁定</option>
          <option value="false">未锁定</option>
        </select>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>内容</th>
              <th>类型</th>
              <th>范围</th>
              <th>状态</th>
              <th>权重</th>
              <th>锁定</th>
            </tr>
          </thead>
          <tbody>
            {memories.map((m) => (
              <tr key={m.id} onClick={() => setSelected(m)} className={styles.row}>
                <td className={styles.contentCell}>
                  <div className={styles.contentPreview}>
                    {m.content.length > 60
                      ? m.content.slice(0, 60) + "..."
                      : m.content}
                  </div>
                </td>
                <td>
                  <span className={styles.badge}>{TYPE_LABELS[m.type] ?? m.type}</span>
                </td>
                <td>{m.scope}</td>
                <td>{m.status}</td>
                <td>{m.weight}</td>
                <td>{m.locked ? "🔒" : "—"}</td>
              </tr>
            ))}
            {!loading && memories.length === 0 && (
              <tr>
                <td colSpan={6} className={styles.empty}>
                  暂无记忆，点击"新建记忆"开始。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {loading && <div className={styles.loading}>加载中...</div>}

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
