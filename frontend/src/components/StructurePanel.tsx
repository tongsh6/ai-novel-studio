// Design: docs/design-v2/ui-design/43-structure-panel.md §5
// Prototype: novel-studio-v2.pen → 43§5-structure-panel-expanded (ATnmR)
import { useState } from "react";
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

  if (!isOpen) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <div className={styles.headerTitle}>作品档案</div>
          <div className={styles.headerSub}>权威状态档案</div>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>
          ✕
        </button>
      </div>

      <div className={styles.tabs}>
        <button
          className={`${styles.tabBtn} ${
            activeTab === "outline" ? styles.tabActive : ""
          }`}
          onClick={() => setActiveTab("outline")}
        >
          大纲与结构
        </button>
        <button
          className={`${styles.tabBtn} ${
            activeTab === "character" ? styles.tabActive : ""
          }`}
          onClick={() => setActiveTab("character")}
        >
          角色
        </button>
        <button
          className={`${styles.tabBtn} ${
            activeTab === "foreshadowing" ? styles.tabActive : ""
          }`}
          onClick={() => setActiveTab("foreshadowing")}
        >
          <span
            className={
              pendingAdoptions.length > 0 ? styles.tabTextAccent : ""
            }
          >
            伏笔 {pendingAdoptions.length > 0 ? `(${pendingAdoptions.length})` : ""}
          </span>
        </button>
        <button
          className={`${styles.tabBtn} ${
            activeTab === "rule" ? styles.tabActive : ""
          }`}
          onClick={() => setActiveTab("rule")}
        >
          经验规则
        </button>
      </div>

      <div className={styles.content}>
        {activeTab === "foreshadowing" && pendingAdoptions.length > 0 && (
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
                  {/* Prototype mock data structure assumption */}
                  {payloadText(artifact.payload.content, "这块表曾在十年前随导师一同消失。")}
                </div>
                <div className={styles.cardActions}>
                  <button
                    className={styles.btnPrimary}
                    onClick={() => onAdopt(artifact)}
                  >
                    采纳设定
                  </button>
                  <button
                    className={styles.btnSecondary}
                    onClick={() => onAction("revise", artifact.artifact_id)}
                  >
                    提出修改
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Mock Data for Document L1-L4 Demonstration */}
        <div className={styles.section}>
          <div className={styles.secHeader}>
            <span className={styles.secTitle}>已归档伏笔</span>
          </div>
          <div className={styles.cardNormal}>
            <div className={styles.cardLabelInverse}>已回收</div>
            <div className={styles.cardTitle}>【伏笔】失踪的导师</div>
            <div className={styles.cardDesc}>
              新历40年，主角的导师在探索核心区时失联，只留下最后一条模糊的通讯记录。第一章已提及。
            </div>
            <div className={styles.cardMeta}>
              <button
                className={styles.btnGhost}
                onClick={() => onAction("view_source")}
              >
                查看来源
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.footerActions}>
        <button
          className={styles.btnSecondary}
          onClick={() => onAction("init_intent")}
        >
          发起伏笔调整
        </button>
        <div className={styles.actionsHint}>
          如需深度修改，请在工作台对话中提出。
        </div>
      </div>
    </div>
  );
}
