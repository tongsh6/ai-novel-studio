// Design: N/A (memory management maintenance page — awaits design spec)
// Prototype: N/A (Phase 0 memory management maintenance page has no frozen screen frame)
// NOTE: 此组件为 Phase 0 快速验证产物，待 UI 设计阶段需重新对照原型实现
import { useCallback, useEffect, useState } from "react";
import { MEMORY } from "../lib/copy";
import type { MemoryItem, ReferenceLog } from "../lib/memoryApi";
import {
  getMemoryReferences,
  confirmMemory,
  lockMemory,
  unlockMemory,
  deprecateMemory,
  archiveMemory,
} from "../lib/memoryApi";
import styles from "./MemoryDetailDrawer.module.css";

interface Props {
  workId: string;
  item: MemoryItem;
  onUpdated: (item: MemoryItem) => void;
  onClose: () => void;
}

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

const STATUS_CLASS: Record<string, string> = {
  DRAFT: styles.statusDraft,
  CONFIRMED: styles.statusConfirmed,
  STABILIZED: styles.statusStabilized,
  CONFLICTED: styles.statusConflicted,
  DEPRECATED: styles.statusDeprecated,
  ARCHIVED: styles.statusArchived,
};

export function MemoryDetailDrawer({ workId, item, onUpdated, onClose }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [references, setReferences] = useState<ReferenceLog[] | null>(null);

  const loadReferences = useCallback(async () => {
    const result = await getMemoryReferences(workId, item.id);
    setReferences(result.ok && result.data ? result.data : []);
  }, [item.id, workId]);

  useEffect(() => {
    let active = true;

    void getMemoryReferences(workId, item.id).then((result) => {
      if (active) {
        setReferences(result.ok && result.data ? result.data : []);
      }
    });

    return () => {
      active = false;
    };
  }, [item.id, item.reference_count, item.updated_at, workId]);

  const action = async (
    fn: (w: string, id: string) => Promise<{ ok: boolean; data?: MemoryItem; error?: string }>,
  ) => {
    setLoading(fn.name);
    const result = await fn(workId, item.id);
    if (result.ok && result.data) {
      onUpdated(result.data);
      await loadReferences();
    }
    setLoading(null);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>记忆详情</h3>
          <button className={styles.close} onClick={onClose}>
            ×
          </button>
        </div>

        <div className={styles.badges}>
          <span className={`${styles.badge} ${STATUS_CLASS[item.status] ?? styles.statusDefault}`}>
            {item.status}
          </span>
          <span className={styles.badge}>{TYPE_LABELS[item.type] ?? item.type}</span>
          <span className={styles.badge}>{item.scope}</span>
          {item.locked && <span className={styles.badge}>🔒 已锁定</span>}
          {!item.recallable && <span className={styles.badge}>不可召回</span>}
        </div>

        <section className={styles.section}>
          <label>内容</label>
          <p className={styles.content}>{item.content}</p>
        </section>

        {item.summary && (
          <section className={styles.section}>
            <label>摘要</label>
            <p className={styles.content}>{item.summary}</p>
          </section>
        )}

        <section className={styles.section}>
          <label>治理信息</label>
          <div className={styles.grid}>
            <div>权重: {item.weight}</div>
            <div>置信度: {item.confidence}</div>
            <div>来源置信度: {item.source_confidence}</div>
            <div>引用次数: {item.reference_count}</div>
            <div>版本: {item.version}</div>
            <div>来源类型: {item.source_type}</div>
          </div>
        </section>

        {item.valid_from && (
          <section className={styles.section}>
            <label>有效期</label>
            <p>
              {item.valid_from.chapter_id ? `第${item.valid_from.chapter_id}章` : ""}
              {item.valid_from.scene_index ? ` 场景${item.valid_from.scene_index}` : ""}
              {" → "}
              {item.valid_until?.chapter_id ? `第${item.valid_until.chapter_id}章` : ""}
              {item.valid_until?.scene_index ? ` 场景${item.valid_until.scene_index}` : "未指定"}
            </p>
            {item.expire_condition && (
              <p className={styles.hint}>失效条件: {item.expire_condition}</p>
            )}
          </section>
        )}

        {item.tags && item.tags.length > 0 && (
          <section className={styles.section}>
            <label>标签</label>
            <div className={styles.tags}>
              {item.tags.map((t) => (
                <span key={t} className={styles.tag}>
                  {t}
                </span>
              ))}
            </div>
          </section>
        )}

        <section className={styles.section}>
          <label>时间</label>
          <div className={styles.grid}>
            <div>创建: {item.created_at}</div>
            <div>更新: {item.updated_at}</div>
            {item.last_referenced_at && <div>最近引用: {item.last_referenced_at}</div>}
          </div>
        </section>

        <section className={styles.section}>
          <label>{MEMORY.traceTitle}</label>
          {references === null ? (
            <p className={styles.hint}>{MEMORY.traceLoading}</p>
          ) : references.length === 0 ? (
            <p className={styles.hint}>{MEMORY.traceEmpty}</p>
          ) : (
            <ol className={styles.traceList}>
              {references.map((reference) => (
                <li key={reference.id} className={styles.traceItem}>
                  <div className={styles.traceMeta}>
                    <span>{referenceSceneLabel(reference.reference_scene)}</span>
                    <span>{reference.inserted_at}</span>
                  </div>
                  <p className={styles.traceReason}>
                    {reference.reference_reason || MEMORY.traceNoReason}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className={styles.actions}>
          {item.status === "DRAFT" && (
            <button
              className={styles.btnConfirm}
              disabled={loading !== null}
              onClick={() => {
                void action(confirmMemory);
              }}
            >
              {loading === "confirmMemory" ? "..." : "确认"}
            </button>
          )}
          {!item.locked ? (
            <button
              className={styles.btnSecondary}
              disabled={loading !== null}
              onClick={() => {
                void action(lockMemory);
              }}
            >
              {loading === "lockMemory" ? "..." : "锁定"}
            </button>
          ) : (
            <button
              className={styles.btnSecondary}
              disabled={loading !== null}
              onClick={() => {
                void action(unlockMemory);
              }}
            >
              {loading === "unlockMemory" ? "..." : "解锁"}
            </button>
          )}
          {item.status !== "ARCHIVED" && (
            <button
              className={styles.btnSecondary}
              disabled={loading !== null || item.locked}
              onClick={() => {
                void action(archiveMemory);
              }}
            >
              {loading === "archiveMemory" ? "..." : "归档"}
            </button>
          )}
          {item.status !== "DEPRECATED" && item.status !== "ARCHIVED" && (
            <button
              className={styles.btnDanger}
              disabled={loading !== null || item.locked}
              onClick={() => {
                void action(deprecateMemory);
              }}
            >
              {loading === "deprecateMemory" ? "..." : "废弃"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function referenceSceneLabel(scene: string) {
  return MEMORY.traceSceneLabels[scene as keyof typeof MEMORY.traceSceneLabels] ?? scene;
}
