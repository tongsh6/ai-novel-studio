// Design: docs/design-v2/ui-design/43-structure-panel.md §5
// Prototype: novel-studio-v2.pen → 43§5-structure-panel-expanded (ATnmR)
import { useEffect, useState } from "react";
import { useAppStore } from "../lib/store";
import { getToc, getCharacters, getForeshadowing, getRules, getWorkStats } from "../lib/socket";
import type { TocData, CharacterData, MemoryItemData, WorkStats } from "../lib/socket";
import styles from "./StructurePanel.module.css";
import type { ArtifactEntry } from "./WorkspaceChat";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  pendingAdoptions: ArtifactEntry[];
  onAdopt: (artifact: ArtifactEntry) => void;
  onAction: (actionType: string, artifactId?: string) => void;
}

type TabType = "outline" | "character" | "foreshadowing" | "rule";

function payloadText(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

export function StructurePanel({
  isOpen,
  onClose,
  pendingAdoptions,
  onAdopt,
  onAction,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabType>("foreshadowing");
  const [toc, setToc] = useState<TocData | null>(null);
  const [characters, setCharacters] = useState<CharacterData[]>([]);
  const [foreshadowing, setForeshadowing] = useState<MemoryItemData[]>([]);
  const [rules, setRules] = useState<MemoryItemData[]>([]);
  const [stats, setStats] = useState<WorkStats | null>(null);
  const context = useAppStore((s) => s.context);
  const channel = useAppStore((s) => s.channel);

  // Fetch all data when panel opens and work exists
  useEffect(() => {
    if (!isOpen || !channel || !context.workId) return;
    getToc(channel, context.workId).then((data) => setToc(data)).catch(() => setToc(null));
    getCharacters(channel, context.workId).then((data) => setCharacters(data)).catch(() => setCharacters([]));
    getForeshadowing(channel, context.workId).then((data) => setForeshadowing(data)).catch(() => setForeshadowing([]));
    getRules(channel, context.workId).then((data) => setRules(data)).catch(() => setRules([]));
    getWorkStats(channel, context.workId).then((data) => setStats(data)).catch(() => setStats(null));
  }, [isOpen, channel, context.workId]);

  if (!isOpen) return null;

  const hasWork = context.workId != null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <div className={styles.headerTitle}>作品档案</div>
          <div className={styles.headerSub}>
            {hasWork ? context.workTitle || "未命名作品" : "尚未创建设定"}
          </div>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>
          ✕
        </button>
      </div>

      {/* L1 Overview */}
      <div className={styles.overview}>
        {stats && (
          <>
            <div className={styles.overviewItem}>
              <span className={styles.overviewLabel}>卷</span>
              <span className={styles.overviewValue}>{stats.volumes}</span>
            </div>
            <div className={styles.overviewItem}>
              <span className={styles.overviewLabel}>草稿</span>
              <span className={styles.overviewValue}>{stats.drafts_accepted}/{stats.drafts_total}</span>
            </div>
            <div className={styles.overviewItem}>
              <span className={styles.overviewLabel}>角色</span>
              <span className={styles.overviewValue}>{stats.characters}</span>
            </div>
            <div className={styles.overviewItem}>
              <span className={styles.overviewLabel}>设定</span>
              <span className={styles.overviewValue}>{stats.memory_items}</span>
            </div>
          </>
        )}
        <div className={styles.overviewItem}>
          <span className={styles.overviewLabel}>待采纳</span>
          <span className={pendingAdoptions.length > 0 ? styles.overviewValueAccent : styles.overviewValue}>
            {pendingAdoptions.length}
          </span>
        </div>
      </div>

      <div className={styles.tabs}>
        <button
          className={`${styles.tabBtn} ${activeTab === "outline" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("outline")}
        >
          大纲与结构
        </button>
        <button
          className={`${styles.tabBtn} ${activeTab === "character" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("character")}
        >
          角色
        </button>
        <button
          className={`${styles.tabBtn} ${activeTab === "foreshadowing" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("foreshadowing")}
        >
          <span className={pendingAdoptions.length > 0 ? styles.tabTextAccent : ""}>
            伏笔{pendingAdoptions.length > 0 ? ` (${pendingAdoptions.length})` : ""}
          </span>
        </button>
        <button
          className={`${styles.tabBtn} ${activeTab === "rule" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("rule")}
        >
          经验规则
        </button>
      </div>

      <div className={styles.content}>
        {/* Foreshadowing Tab */}
        {activeTab === "foreshadowing" && (
          <>
            {pendingAdoptions.length > 0 && (
              <div className={styles.section}>
                <div className={styles.secHeader}>
                  <span className={styles.secTitleAccent}>待采纳内容</span>
                </div>
                {pendingAdoptions.map((artifact) => (
                  <div key={artifact.artifact_id} className={styles.cardAccent}>
                    <div className={styles.cardLabel}>待采纳</div>
                    <div className={styles.cardTitle}>
                      {payloadText(artifact.payload.title, artifact.artifact_id)}
                    </div>
                    <div className={styles.cardDesc}>
                      {payloadText(artifact.payload.content, "等待审核中的内容")}
                    </div>
                    <div className={styles.cardActions}>
                      <button className={styles.btnPrimary} onClick={() => onAdopt(artifact)}>采纳设定</button>
                      <button className={styles.btnSecondary} onClick={() => onAction("revise", artifact.artifact_id)}>提出修改</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {foreshadowing.length > 0 && (
              <div className={styles.section}>
                <div className={styles.secHeader}>
                  <span className={styles.secTitle}>已确认设定</span>
                </div>
                {foreshadowing.map((item) => (
                  <div key={item.id} className={styles.cardItem}>
                    <div className={styles.cardTitle}>{item.content}</div>
                    <div className={styles.cardDesc}>
                      {item.type}{item.tags.length > 0 && ` · ${item.tags.join("、")}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {pendingAdoptions.length === 0 && foreshadowing.length === 0 && (
              <div className={styles.emptySection}>
                <div className={styles.emptyIcon}>📋</div>
                <div className={styles.emptyTitle}>暂无伏笔设定</div>
                <div className={styles.emptyDesc}>
                  在对话中说"创建主线大纲"或"构建世界观"，AI 会生成设定内容。
                </div>
              </div>
            )}
          </>
        )}

        {/* Outline Tab */}
        {activeTab === "outline" && (
          <>
            {toc && toc.volumes.length > 0 ? (
              <div className={styles.section}>
                {toc.volumes.map((vol) => (
                  <div key={vol.id} className={styles.section}>
                    <div className={styles.secHeader}>
                      <span className={styles.secTitle}>{vol.title}</span>
                    </div>
                    {vol.chapters.map((ch) => (
                      <div key={ch.id} className={styles.cardItem}>
                        <span className={styles.cardTitle}>{ch.title}</span>
                      </div>
                    ))}
                    {vol.chapters.length === 0 && (
                      <div className={styles.emptyDesc}>暂无章节</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptySection}>
                <div className={styles.emptyIcon}>📖</div>
                <div className={styles.emptyTitle}>大纲与结构</div>
                <div className={styles.emptyDesc}>
                  {hasWork
                    ? "在对话中说「生成章节大纲」或「规划分卷结构」，AI 会帮你整理作品的骨架。"
                    : "先在工作台创建作品，AI 会帮你搭建大纲和分卷结构。"}
                </div>
                <button
                  className={styles.btnPrimary}
                  onClick={() => {
                    onAction("init_intent");
                    onClose();
                  }}
                >
                  开始规划
                </button>
              </div>
            )}
          </>
        )}

        {/* Character Tab */}
        {activeTab === "character" && (
          <>
            {characters.length > 0 ? (
              <div className={styles.section}>
                {characters.map((char) => (
                  <div key={char.id} className={styles.cardItem}>
                    <div className={styles.cardTitle}>
                      {char.name}
                      {char.role && <span className={styles.cardLabel}> — {char.role}</span>}
                    </div>
                    {char.summary && (
                      <div className={styles.cardDesc}>{char.summary}</div>
                    )}
                    {char.aliases && char.aliases.length > 0 && (
                      <div className={styles.cardDesc}>
                        别名：{char.aliases.join("、")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptySection}>
                <div className={styles.emptyIcon}>👤</div>
                <div className={styles.emptyTitle}>角色档案</div>
                <div className={styles.emptyDesc}>
                  {hasWork
                    ? "在对话中说「创建角色」或「分析已有角色」，AI 会提取角色信息并建档。"
                    : "先在工作台创建作品，AI 会在创作过程中自动提取角色信息。"}
                </div>
                <button
                  className={styles.btnPrimary}
                  onClick={() => {
                    onAction("init_intent");
                    onClose();
                  }}
                >
                  创建角色
                </button>
              </div>
            )}
          </>
        )}

        {/* Rules Tab */}
        {activeTab === "rule" && (
          <>
            {rules.length > 0 ? (
              <div className={styles.section}>
                {rules.map((item) => (
                  <div key={item.id} className={styles.cardItem}>
                    <div className={styles.cardTitle}>{item.content}</div>
                    <div className={styles.cardDesc}>
                      {item.type}{item.tags.length > 0 && ` · ${item.tags.join("、")}`}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptySection}>
                <div className={styles.emptyIcon}>📐</div>
                <div className={styles.emptyTitle}>经验规则</div>
                <div className={styles.emptyDesc}>
                  在对话中说"导入风格样本"或"构建世界观"，AI 会生成写作规则和设定约束。
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className={styles.footerActions}>
        <button
          className={styles.btnSecondary}
          data-slice-verify="panel-new-action"
          onClick={() => onAction("init_intent")}
        >
          发起新操作
        </button>
        <div className={styles.actionsHint}>
          如需深度修改，请在工作台对话中提出。
        </div>
      </div>
    </div>
  );
}
