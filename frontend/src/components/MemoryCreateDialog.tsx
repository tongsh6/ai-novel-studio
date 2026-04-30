// Design: N/A (memory management maintenance page — awaits design spec)
// Prototype: N/A (Phase 0 memory management maintenance page has no frozen screen frame)
// NOTE: 此组件为 Phase 0 快速验证产物，待 UI 设计阶段需重新对照原型实现
import { useState } from "react";
import { createMemory } from "../lib/memoryApi";
import type { MemoryItem } from "../lib/memoryApi";
import styles from "./MemoryCreateDialog.module.css";

const MEMORY_TYPES = [
  "WORLD_RULE", "CHARACTER_PROFILE", "CURRENT_STATE", "RELATIONSHIP",
  "PLOT_FACT", "FORESHADOWING", "STYLE_RULE", "CONSTRAINT",
  "AUTHOR_PREFERENCE", "IDEA", "DRAFT_CONTEXT",
];

const MEMORY_SCOPES = ["GLOBAL", "WORK", "VOLUME", "ARC", "CHAPTER", "SESSION"];

const SOURCE_TYPES = [
  "AUTHOR_CONFIRMED", "AUTHOR_CREATED", "AI_EXTRACTED",
  "CHAPTER_EXTRACTED", "WORK_SETTING_IMPORTED", "SESSION_CONTEXT",
];

interface Props {
  workId: string;
  onCreated: (item: MemoryItem) => void;
  onClose: () => void;
}

export function MemoryCreateDialog({ workId, onCreated, onClose }: Props) {
  const [content, setContent] = useState("");
  const [summary, setSummary] = useState("");
  const [type, setType] = useState("WORLD_RULE");
  const [scope, setScope] = useState("WORK");
  const [sourceType, setSourceType] = useState("AUTHOR_CREATED");
  const [weight, setWeight] = useState(0.5);
  const [locked, setLocked] = useState(false);
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setSaving(true);
    setError("");

    const result = await createMemory(workId, {
      content: content.trim(),
      summary: summary.trim() || undefined,
      type,
      scope,
      source_type: sourceType,
      weight,
      locked,
      tags: tags ? tags.split(",").map((t) => t.trim()) : undefined,
    });

    if (result.ok && result.data) {
      onCreated(result.data);
    } else {
      setError(typeof result.error === "string" ? result.error : "创建失败");
    }
    setSaving(false);
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog}>
        <h3>新建记忆</h3>

        <label>内容 *</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          placeholder="输入记忆内容..."
        />

        <label>摘要</label>
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="简短摘要（可选）"
        />

        <div className={styles.row}>
          <div className={styles.field}>
            <label>类型</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {MEMORY_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>作用范围</label>
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              {MEMORY_SCOPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label>来源类型</label>
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value)}
            >
              {SOURCE_TYPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>权重: {weight}</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={weight}
              onChange={(e) => setWeight(parseFloat(e.target.value))}
            />
          </div>
        </div>

        <div className={styles.row}>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={locked}
              onChange={(e) => setLocked(e.target.checked)}
            />
            锁定（AI 不可修改）
          </label>
        </div>

        <label>标签</label>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="用逗号分隔，如：主角, 设定"
        />

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.actions}>
          <button onClick={onClose} className={styles.btnCancel}>
            取消
          </button>
          <button
            onClick={() => {
              void handleSubmit();
            }}
            disabled={saving || !content.trim()}
            className={styles.btnPrimary}
          >
            {saving ? "保存中..." : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
