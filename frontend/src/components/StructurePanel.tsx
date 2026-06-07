// Design: docs/design-v2/ui-design/43-structure-panel.md §5
// Prototype: novel-studio-v2.pen → 43§5-structure-panel-expanded (ATnmR)
import * as Tabs from "@radix-ui/react-tabs";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  archiveDetailRows,
  archiveDetailSummary,
  archiveDetailTitle,
  memoryTypeLabel,
} from "../lib/archiveDetail";
import type { ArchiveDetailItem } from "../lib/archiveDetail";
import { STRUCTURE_PANEL } from "../lib/copy";
import { useAppStore } from "../lib/store";
import { getToc, getCharacters, getForeshadowing, getRules, getWorkStats } from "../lib/socket";
import type { TocData, CharacterData, MemoryItemData, WorkStats } from "../lib/socket";
import styles from "./StructurePanel.module.css";
import type { ArtifactEntry } from "./WorkspaceChat";

export type StructurePanelArtifactAction = "accept" | "edit_then_accept";

export interface StructurePanelActionState {
  enabled: boolean;
  disabledReason?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  pendingAdoptions: ArtifactEntry[];
  getArtifactActionState: (
    artifact: ArtifactEntry,
    actionType: StructurePanelArtifactAction,
  ) => StructurePanelActionState;
  onArtifactAction: (
    artifact: ArtifactEntry,
    actionType: StructurePanelArtifactAction,
  ) => void;
  onStartPlanning: () => void;
  onCreateCharacter: () => void;
  onDraftChapter: (chapterBrief: string) => void;
  onNewAction: () => void;
}

type TabType = "outline" | "character" | "foreshadowing" | "rule";
type SelectedArchiveItem =
  | { kind: "character"; id: string }
  | { kind: "memory"; id: string };

function payloadText(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

export function StructurePanel({
  isOpen,
  onClose,
  pendingAdoptions,
  getArtifactActionState,
  onArtifactAction,
  onStartPlanning,
  onCreateCharacter,
  onDraftChapter,
  onNewAction,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabType>("foreshadowing");
  const [toc, setToc] = useState<TocData | null>(null);
  const [characters, setCharacters] = useState<CharacterData[]>([]);
  const [foreshadowing, setForeshadowing] = useState<MemoryItemData[]>([]);
  const [rules, setRules] = useState<MemoryItemData[]>([]);
  const [stats, setStats] = useState<WorkStats | null>(null);
  const [selectedArchiveItem, setSelectedArchiveItem] = useState<SelectedArchiveItem | null>(null);
  const context = useAppStore((s) => s.context);
  const channel = useAppStore((s) => s.channel);

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

  // 已采纳卷/章结构即大纲（结构携带 summary + 进度），单一数据源，作为面板章节列表。
  const planChapters = (toc?.volumes ?? []).flatMap((vol) => vol.chapters);

  const selectedCharacter =
    selectedArchiveItem?.kind === "character"
      ? characters.find((item) => item.id === selectedArchiveItem.id)
      : undefined;
  const selectedMemory =
    selectedArchiveItem?.kind === "memory"
      ? [...foreshadowing, ...rules].find((item) => item.id === selectedArchiveItem.id)
      : undefined;
  const selectedDetail = selectedCharacter
    ? { kind: "character" as const, item: selectedCharacter }
    : selectedMemory
      ? { kind: "memory" as const, item: selectedMemory }
      : null;

  return (
    <div
      className={styles.panel}
      data-archive-character-count={characters.length}
      data-archive-foreshadowing-count={foreshadowing.length}
      data-archive-rule-count={rules.length}
      data-archive-volumes={stats?.volumes ?? 0}
      data-archive-chapters={stats?.chapters ?? 0}
      data-archive-memory-items={stats?.memory_items ?? 0}
      data-archive-drafts-total={stats?.drafts_total ?? 0}
      data-archive-drafts-accepted={stats?.drafts_accepted ?? 0}
      data-archive-detail-kind={selectedDetail?.kind ?? ""}
      data-archive-detail-id={selectedDetail?.item.id ?? ""}
    >
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <div className={styles.headerTitle}>{STRUCTURE_PANEL.title}</div>
          <div className={styles.headerSub}>
            {hasWork ? context.workTitle || STRUCTURE_PANEL.unnamedWork : STRUCTURE_PANEL.noWork}
          </div>
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label={STRUCTURE_PANEL.close}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.overview}>
        {stats && (
          <>
            <div className={styles.overviewItem}>
              <span className={styles.overviewLabel}>{STRUCTURE_PANEL.stats.volumes}</span>
              <span className={styles.overviewValue}>
                {stats.volumes}
              </span>
            </div>
            <div className={styles.overviewItem}>
              <span className={styles.overviewLabel}>{STRUCTURE_PANEL.stats.drafts}</span>
              <span className={styles.overviewValue}>
                {stats.drafts_accepted}/{stats.drafts_total}
              </span>
            </div>
            <div className={styles.overviewItem}>
              <span className={styles.overviewLabel}>{STRUCTURE_PANEL.stats.characters}</span>
              <span className={styles.overviewValue}>
                {stats.characters}
              </span>
            </div>
            <div className={styles.overviewItem}>
              <span className={styles.overviewLabel}>{STRUCTURE_PANEL.stats.memories}</span>
              <span className={styles.overviewValue}>
                {stats.memory_items}
              </span>
            </div>
          </>
        )}
        <div className={styles.overviewItem}>
          <span className={styles.overviewLabel}>{STRUCTURE_PANEL.stats.pending}</span>
          <span className={pendingAdoptions.length > 0 ? styles.overviewValueAccent : styles.overviewValue}>
            {pendingAdoptions.length}
          </span>
        </div>
      </div>

      <Tabs.Root
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value as TabType);
          setSelectedArchiveItem(null);
        }}
        className={styles.tabsRoot}
      >
        <Tabs.List className={styles.tabs}>
          <Tabs.Trigger className={styles.tabBtn} value="outline">
            {STRUCTURE_PANEL.tabs.outline}
          </Tabs.Trigger>
          <Tabs.Trigger className={styles.tabBtn} value="character">
            {STRUCTURE_PANEL.tabs.character}
          </Tabs.Trigger>
          <Tabs.Trigger className={styles.tabBtn} value="foreshadowing">
            <span className={pendingAdoptions.length > 0 ? styles.tabTextAccent : ""}>
              {STRUCTURE_PANEL.tabs.foreshadowing}
              {pendingAdoptions.length > 0 ? ` (${pendingAdoptions.length})` : ""}
            </span>
          </Tabs.Trigger>
          <Tabs.Trigger className={styles.tabBtn} value="rule">
            {STRUCTURE_PANEL.tabs.rule}
          </Tabs.Trigger>
        </Tabs.List>

        <div className={styles.content}>
          <Tabs.Content value="foreshadowing" className={styles.tabContent}>
            {pendingAdoptions.length > 0 && (
              <div className={styles.section}>
                <div className={styles.secHeader}>
                  <span className={styles.secTitleAccent}>{STRUCTURE_PANEL.pendingSection}</span>
                </div>
                {pendingAdoptions.map((artifact) => {
                  const acceptAction = getArtifactActionState(artifact, "accept");
                  const editAction = getArtifactActionState(artifact, "edit_then_accept");

                  return (
                    <div key={artifact.artifact_id} className={styles.cardAccent}>
                      <div className={styles.cardLabel}>{STRUCTURE_PANEL.pendingLabel}</div>
                      <div className={styles.cardTitle}>
                        {payloadText(artifact.payload.title, STRUCTURE_PANEL.pendingFallbackTitle)}
                      </div>
                      <div className={styles.cardDesc}>
                        {payloadText(artifact.payload.content, STRUCTURE_PANEL.pendingFallbackContent)}
                      </div>
                      <div className={styles.cardActions}>
                        <button
                          className={styles.btnPrimary}
                          disabled={!acceptAction.enabled}
                          title={acceptAction.disabledReason}
                          onClick={() => onArtifactAction(artifact, "accept")}
                        >
                          {STRUCTURE_PANEL.acceptSetting}
                        </button>
                        <button
                          className={styles.btnSecondary}
                          disabled={!editAction.enabled}
                          title={editAction.disabledReason}
                          onClick={() => onArtifactAction(artifact, "edit_then_accept")}
                        >
                          {STRUCTURE_PANEL.requestRevision}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {foreshadowing.length > 0 && (
              <div className={styles.section}>
                <div className={styles.secHeader}>
                  <span className={styles.secTitle}>{STRUCTURE_PANEL.confirmedForeshadowingSection}</span>
                </div>
                {foreshadowing.map((item) => (
                  <div
                    key={item.id}
                    className={styles.cardItem}
                    data-selected={selectedArchiveItem?.id === item.id ? "true" : "false"}
                  >
                    <div className={styles.cardTitle}>{item.content}</div>
                    <div className={styles.cardDesc}>
                      {memoryTypeLabel(item.type)}
                      {item.tags.length > 0 && ` · ${item.tags.join("、")}`}
                    </div>
                    <div className={styles.cardActions}>
                      <button
                        className={styles.btnGhost}
                        aria-pressed={selectedArchiveItem?.id === item.id}
                        onClick={() => setSelectedArchiveItem({ kind: "memory", id: item.id })}
                      >
                        {selectedArchiveItem?.id === item.id ? STRUCTURE_PANEL.selected : STRUCTURE_PANEL.viewDetail}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {selectedDetail && renderDetail(selectedDetail)}
            {pendingAdoptions.length === 0 && foreshadowing.length === 0 && (
              <EmptyState
                title={STRUCTURE_PANEL.foreshadowingEmptyTitle}
                description={STRUCTURE_PANEL.foreshadowingEmptyDesc}
              />
            )}
          </Tabs.Content>

          <Tabs.Content value="outline" className={styles.tabContent}>
            {/* 大纲与结构单一数据源：已采纳卷/章结构（结构携带摘要+进度），不再有独立计划视图。 */}
            {planChapters.length > 0 ? (
              <div className={styles.section}>
                <div className={styles.secHeader}>
                  <span className={styles.secTitle}>
                    {STRUCTURE_PANEL.acceptedChapterPlanSection}
                    {` · ${planChapters.length}${STRUCTURE_PANEL.chapterCountUnit}`}
                  </span>
                </div>
                {planChapters.map((ch) => (
                  <div key={ch.id} className={styles.cardItem}>
                    <span className={styles.cardTitle}>{ch.title}</span>
                    <div className={styles.cardDesc}>
                      {(ch.word_count ?? 0) > 0
                        ? `${STRUCTURE_PANEL.chapterWrittenPrefix} ${ch.word_count} ${STRUCTURE_PANEL.chapterWordsUnit}`
                        : STRUCTURE_PANEL.chapterPendingBadge}
                    </div>
                    {ch.summary && <div className={styles.cardDesc}>{ch.summary}</div>}
                    <div className={styles.cardActions}>
                      <button
                        className={styles.btnGhost}
                        onClick={() => {
                          onDraftChapter(`${ch.title}：${ch.summary ?? ""}`);
                          onClose();
                        }}
                      >
                        {STRUCTURE_PANEL.generateChapterDraft}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title={STRUCTURE_PANEL.outlineEmptyTitle}
                description={hasWork ? STRUCTURE_PANEL.outlineEmptyWithWork : STRUCTURE_PANEL.outlineEmptyNoWork}
                actionLabel={STRUCTURE_PANEL.startPlanning}
                onAction={() => {
                  onStartPlanning();
                  onClose();
                }}
              />
            )}
          </Tabs.Content>

          <Tabs.Content value="character" className={styles.tabContent}>
            {characters.length > 0 ? (
              <div className={styles.section}>
                {characters.map((char) => (
                  <div
                    key={char.id}
                    className={styles.cardItem}
                    data-selected={selectedArchiveItem?.id === char.id ? "true" : "false"}
                  >
                    <div className={styles.cardTitle}>
                      {char.name}
                      {char.role && <span className={styles.cardLabelInline}>{char.role}</span>}
                    </div>
                    {char.summary && (
                      <div className={styles.cardDesc}>{char.summary}</div>
                    )}
                    {char.aliases && char.aliases.length > 0 && (
                      <div className={styles.cardDesc}>
                        {STRUCTURE_PANEL.aliasPrefix}{char.aliases.join("、")}
                      </div>
                    )}
                    <div className={styles.cardActions}>
                      <button
                        className={styles.btnGhost}
                        aria-pressed={selectedArchiveItem?.id === char.id}
                        onClick={() => setSelectedArchiveItem({ kind: "character", id: char.id })}
                      >
                        {selectedArchiveItem?.id === char.id ? STRUCTURE_PANEL.selected : STRUCTURE_PANEL.viewDetail}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title={STRUCTURE_PANEL.characterEmptyTitle}
                description={hasWork ? STRUCTURE_PANEL.characterEmptyWithWork : STRUCTURE_PANEL.characterEmptyNoWork}
	                actionLabel={STRUCTURE_PANEL.createCharacter}
	                onAction={() => {
	                  onCreateCharacter();
	                  onClose();
	                }}
              />
            )}
            {selectedDetail && renderDetail(selectedDetail)}
          </Tabs.Content>

          <Tabs.Content value="rule" className={styles.tabContent}>
            {rules.length > 0 ? (
              <div className={styles.section}>
                {rules.map((item) => (
                  <div
                    key={item.id}
                    className={styles.cardItem}
                    data-selected={selectedArchiveItem?.id === item.id ? "true" : "false"}
                  >
                    <div className={styles.cardTitle}>{item.content}</div>
                    <div className={styles.cardDesc}>
                      {memoryTypeLabel(item.type)}
                      {item.tags.length > 0 && ` · ${item.tags.join("、")}`}
                    </div>
                    <div className={styles.cardActions}>
                      <button
                        className={styles.btnGhost}
                        aria-pressed={selectedArchiveItem?.id === item.id}
                        onClick={() => setSelectedArchiveItem({ kind: "memory", id: item.id })}
                      >
                        {selectedArchiveItem?.id === item.id ? STRUCTURE_PANEL.selected : STRUCTURE_PANEL.viewDetail}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title={STRUCTURE_PANEL.ruleEmptyTitle}
                description={STRUCTURE_PANEL.ruleEmptyDesc}
              />
            )}
            {selectedDetail && renderDetail(selectedDetail)}
          </Tabs.Content>
        </div>
      </Tabs.Root>

      <div className={styles.footerActions}>
	        <button
	          className={styles.btnSecondary}
	          onClick={onNewAction}
	        >
          {STRUCTURE_PANEL.newAction}
        </button>
        <div className={styles.actionsHint}>
          {STRUCTURE_PANEL.actionHint}
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className={styles.emptySection}>
      <div className={styles.emptyTitle}>{title}</div>
      <div className={styles.emptyDesc}>{description}</div>
      {actionLabel && onAction && (
        <button className={styles.btnPrimary} onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function renderDetail(detail: ArchiveDetailItem) {
  const summary = archiveDetailSummary(detail);

  return (
    <div className={styles.detailPanel}>
      <div className={styles.secHeader}>
        <span className={styles.secTitle}>{STRUCTURE_PANEL.detailTitle}</span>
      </div>
      <div className={styles.detailTitle}>
        {archiveDetailTitle(detail)}
      </div>
      {summary && <div className={styles.cardDesc}>{summary}</div>}
      <dl className={styles.detailRows}>
        {archiveDetailRows(detail).map((row) => (
          <div className={styles.detailRow} key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.detailHint}>{STRUCTURE_PANEL.detailHint}</div>
    </div>
  );
}
