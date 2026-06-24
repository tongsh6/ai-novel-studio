// Design: docs/design/ui/43-structure-panel.md §5
// Prototype: novel-studio.pen → 43§5-structure-panel-expanded (ATnmR)
import * as Tabs from "@radix-ui/react-tabs";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  archiveDetailRows,
  archiveDetailSummary,
  archiveDetailTitle,
  memoryTypeLabel,
} from "../lib/archiveDetail";
import type { ArchiveDetailItem } from "../lib/archiveDetail";
import { STRUCTURE_PANEL } from "../lib/copy";
import { useAppStore } from "../lib/store";
import {
  getToc,
  getCharacters,
  getForeshadowing,
  getRules,
  getWorkStats,
  getWorkProfile,
} from "../lib/socket";
import type { TocData, CharacterData, MemoryItemData, WorkStats, WorkProfile } from "../lib/socket";
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
  onArtifactAction: (artifact: ArtifactEntry, actionType: StructurePanelArtifactAction) => void;
  onStartPlanning: () => void;
  onCreateCharacter: () => void;
  onDraftChapter: (chapterBrief: string) => void;
  onNewForeshadowing: () => void;
  onNewRule: () => void;
  onNewAction: (prompt: string) => void;
}

type TabType = "overview" | "outline" | "character" | "foreshadowing" | "rule";
type SelectedArchiveItem = { kind: "character"; id: string } | { kind: "memory"; id: string };
type PendingTabType = TabType;

function payloadText(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function profileText(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return payloadText(value, STRUCTURE_PANEL.profile.emptyValue);
}

function profileStatusLabel(status?: string): string {
  switch (status) {
    case "ACCEPTED":
      return STRUCTURE_PANEL.profile.statusAccepted;
    case "TENTATIVE":
      return STRUCTURE_PANEL.profile.statusTentative;
    case "DISCARDED":
      return STRUCTURE_PANEL.profile.statusDiscarded;
    default:
      return STRUCTURE_PANEL.profile.statusUnknown;
  }
}

function profileRows(profile: WorkProfile | null): { label: string; value: string }[] {
  return [
    { label: STRUCTURE_PANEL.profile.genre, value: profileText(profile?.genre) },
    {
      label: STRUCTURE_PANEL.profile.coreSellingPoint,
      value: profileText(profile?.core_selling_point),
    },
    { label: STRUCTURE_PANEL.profile.targetReader, value: profileText(profile?.target_reader) },
    { label: STRUCTURE_PANEL.profile.tonePreference, value: profileText(profile?.tone_preference) },
    { label: STRUCTURE_PANEL.profile.revision, value: profileText(profile?.revision) },
    { label: STRUCTURE_PANEL.profile.updatedAt, value: profileText(profile?.updated_at) },
  ];
}

function optionalText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function payloadField(payload: ArtifactEntry["payload"], keys: string[]): string | null {
  for (const key of keys) {
    const value = optionalText(payload[key]);
    if (value) return value;
  }
  return null;
}

function payloadItems(payload: ArtifactEntry["payload"]): unknown[] {
  return Array.isArray(payload.items) ? payload.items : [];
}

function itemField(item: unknown, keys: string[]): string | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  for (const key of keys) {
    const value = optionalText(record[key]);
    if (value) return value;
  }
  return null;
}

function compactPreview(value: string, maxLength = 150): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function containsAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function pendingArtifactTab(artifact: ArtifactEntry): PendingTabType {
  const artifactType = artifact.artifact_type;

  if (artifactType === "outline_draft" || artifactType === "plot_direction") return "outline";
  if (artifactType === "prose_fragment" || artifactType === "scene_draft") return "outline";
  if (artifactType === "character_seed") return "character";
  if (artifactType === "foreshadowing_seed") return "foreshadowing";
  if (
    artifactType === "world_rule_seed" ||
    artifactType === "style_rule_seed" ||
    artifactType === "constraint_seed"
  ) {
    return "rule";
  }

  if (artifactType === "world_setting") {
    const text = [
      payloadField(artifact.payload, ["title", "summary", "content", "body"]),
      ...payloadItems(artifact.payload).map((item) =>
        [itemField(item, ["title", "name"]), itemField(item, ["body", "content", "summary"])]
          .filter(Boolean)
          .join(" "),
      ),
    ]
      .filter(Boolean)
      .join(" ");

    if (containsAny(text, ["伏笔", "线索", "回收"])) return "foreshadowing";
    if (containsAny(text, ["规则", "风格", "约束", "世界观", "设定"])) return "rule";
  }

  return "overview";
}

function outlinePreview(payload: ArtifactEntry["payload"]): string | null {
  const items = payloadItems(payload);
  const count = optionalText(payload.chapter_count) ?? optionalText(payload.item_count);
  const titles = items
    .map((item) => itemField(item, ["title", "name"]))
    .filter((title): title is string => Boolean(title))
    .slice(0, 4);

  if (titles.length > 0) {
    const total = count ?? String(items.length);
    const suffix = Number(total) > titles.length ? "等" : "";
    return `共 ${total} 章，包含：${titles.join("、")}${suffix}。`;
  }

  const content = payloadField(payload, ["content", "body", "summary"]);
  if (!content) return null;
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" / ");
  return compactPreview(lines);
}

function genericArtifactPreview(payload: ArtifactEntry["payload"]): string | null {
  const direct = payloadField(payload, ["content", "body", "summary", "description"]);
  if (direct) return compactPreview(direct);

  const items = payloadItems(payload);
  if (items.length === 0) return null;

  const first = items[0];
  const title = itemField(first, ["title", "name"]);
  const body = itemField(first, ["body", "content", "summary", "description"]);
  const preview = [title, body].filter(Boolean).join("：");

  if (!preview) return null;
  return items.length > 1 ? `共 ${items.length} 条，首条：${compactPreview(preview)}` : compactPreview(preview);
}

function pendingArtifactTitle(artifact: ArtifactEntry, tab: PendingTabType): string {
  return (
    payloadField(artifact.payload, ["title", "name", "summary"]) ??
    STRUCTURE_PANEL.pendingFallbackTitles[tab]
  );
}

function pendingArtifactDescription(artifact: ArtifactEntry, tab: PendingTabType): string {
  const preview =
    tab === "outline" ? outlinePreview(artifact.payload) : genericArtifactPreview(artifact.payload);

  return preview ?? STRUCTURE_PANEL.pendingFallbackContent;
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
  onNewForeshadowing,
  onNewRule,
  onNewAction,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabType>(
    () =>
      pendingAdoptions
        .map((artifact) => pendingArtifactTab(artifact))
        .find((tab) => tab !== "overview") ?? "overview",
  );
  const [toc, setToc] = useState<TocData | null>(null);
  const [characters, setCharacters] = useState<CharacterData[]>([]);
  const [foreshadowing, setForeshadowing] = useState<MemoryItemData[]>([]);
  const [rules, setRules] = useState<MemoryItemData[]>([]);
  const [stats, setStats] = useState<WorkStats | null>(null);
  const [profile, setProfile] = useState<WorkProfile | null>(null);
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
  const [profileRetryNonce, setProfileRetryNonce] = useState(0);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState(false);
  const [selectedArchiveItem, setSelectedArchiveItem] = useState<SelectedArchiveItem | null>(null);
  const context = useAppStore((s) => s.context);
  const channel = useAppStore((s) => s.channel);
  const pendingAdoptionCount = pendingAdoptions.length;
  const lastWorkIdRef = useRef<string | null>(null);
  const profileRef = useRef<WorkProfile | null>(null);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  const hasArchiveSnapshot =
    profile != null ||
    stats != null ||
    toc != null ||
    characters.length > 0 ||
    foreshadowing.length > 0 ||
    rules.length > 0;

  useEffect(() => {
    if (!isOpen || !channel || !context.workId) return;
    const workId = context.workId;
    let cancelled = false;
    let anyFailed = false;

    // 仅在切换到不同作品时清空快照；同作品的刷新（模型执行/并发读取期间打开档案、待采纳数变化、
    // 手动重试）保留上次已知快照，绝不把档案清空成空白（AU-12 in-flight turn 不清空快照）。
    void Promise.resolve().then(() => {
      if (cancelled) return;
      if (lastWorkIdRef.current !== workId) {
        lastWorkIdRef.current = workId;
        setToc(null);
        setCharacters([]);
        setForeshadowing([]);
        setRules([]);
        setStats(null);
        setProfile(null);
        setProfileLoadFailed(false);
      }
      setArchiveLoading(true);
    });

    // 读失败不把已加载内容清空（不伪装成空档案）；概览只在没有任何已知快照时才降级为读取失败提示。
    const reads = [
      getToc(channel, workId)
        .then((data) => !cancelled && setToc(data))
        .catch(() => {
          anyFailed = true;
        }),
      getCharacters(channel, workId)
        .then((data) => !cancelled && setCharacters(data))
        .catch(() => {
          anyFailed = true;
        }),
      getForeshadowing(channel, workId)
        .then((data) => !cancelled && setForeshadowing(data))
        .catch(() => {
          anyFailed = true;
        }),
      getRules(channel, workId)
        .then((data) => !cancelled && setRules(data))
        .catch(() => {
          anyFailed = true;
        }),
      getWorkProfile(channel, workId)
        .then((data) => {
          if (cancelled) return;
          setProfile(data);
          setProfileLoadFailed(false);
        })
        .catch(() => {
          anyFailed = true;
          // 仅当没有任何已知 profile 快照时才把概览降级为读取失败提示；有快照则保留快照。
          if (!cancelled) setProfileLoadFailed(profileRef.current == null);
        }),
      getWorkStats(channel, workId)
        .then((data) => !cancelled && setStats(data))
        .catch(() => {
          anyFailed = true;
        }),
    ];

    void Promise.allSettled(reads).then(() => {
      if (cancelled) return;
      setArchiveLoading(false);
      setArchiveError(anyFailed);
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, channel, context.workId, pendingAdoptionCount, profileRetryNonce]);

  if (!isOpen) return null;

  const hasWork = context.workId != null;
  const footerAction = STRUCTURE_PANEL.panelActions[activeTab];
  const pendingByTab: Record<PendingTabType, ArtifactEntry[]> = {
    overview: pendingAdoptions.filter((artifact) => pendingArtifactTab(artifact) === "overview"),
    outline: pendingAdoptions.filter((artifact) => pendingArtifactTab(artifact) === "outline"),
    character: pendingAdoptions.filter((artifact) => pendingArtifactTab(artifact) === "character"),
    foreshadowing: pendingAdoptions.filter(
      (artifact) => pendingArtifactTab(artifact) === "foreshadowing",
    ),
    rule: pendingAdoptions.filter((artifact) => pendingArtifactTab(artifact) === "rule"),
  };
  const tabPendingCount = (tab: PendingTabType) => pendingByTab[tab].length;
  const tabLabel = (tab: PendingTabType, label: string) => {
    const count = tabPendingCount(tab);
    if (count === 0) return label;
    return <span className={styles.tabTextAccent}>{`${label} (${count})`}</span>;
  };

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

      {archiveLoading && (
        <div className={styles.archiveStatusBanner} role="status">
          {hasArchiveSnapshot
            ? STRUCTURE_PANEL.archiveStatus.refreshing
            : STRUCTURE_PANEL.archiveStatus.loading}
        </div>
      )}
      {!archiveLoading && archiveError && hasArchiveSnapshot && (
        <div
          className={`${styles.archiveStatusBanner} ${styles.archiveStatusBannerError}`}
          role="status"
        >
          <span>{STRUCTURE_PANEL.archiveStatus.readFailed}</span>
          <button
            className={styles.archiveStatusRetry}
            onClick={() => setProfileRetryNonce((value) => value + 1)}
          >
            {STRUCTURE_PANEL.archiveStatus.retryLabel}
          </button>
        </div>
      )}

      <div className={styles.overview}>
        {stats && (
          <>
            <div className={styles.overviewItem}>
              <span className={styles.overviewLabel}>{STRUCTURE_PANEL.stats.volumes}</span>
              <span className={styles.overviewValue}>{stats.volumes}</span>
            </div>
            <div className={styles.overviewItem}>
              <span className={styles.overviewLabel}>{STRUCTURE_PANEL.stats.drafts}</span>
              <span className={styles.overviewValue}>
                {stats.drafts_accepted}/{stats.drafts_total}
              </span>
            </div>
            <div className={styles.overviewItem}>
              <span className={styles.overviewLabel}>{STRUCTURE_PANEL.stats.characters}</span>
              <span className={styles.overviewValue}>{stats.characters}</span>
            </div>
            <div className={styles.overviewItem}>
              <span className={styles.overviewLabel}>{STRUCTURE_PANEL.stats.memories}</span>
              <span className={styles.overviewValue}>{stats.memory_items}</span>
            </div>
          </>
        )}
        <div className={styles.overviewItem}>
          <span className={styles.overviewLabel}>{STRUCTURE_PANEL.stats.pending}</span>
          <span
            className={
              pendingAdoptions.length > 0 ? styles.overviewValueAccent : styles.overviewValue
            }
          >
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
          <Tabs.Trigger className={styles.tabBtn} value="overview">
            {tabLabel("overview", STRUCTURE_PANEL.tabs.overview)}
          </Tabs.Trigger>
          <Tabs.Trigger className={styles.tabBtn} value="outline">
            {tabLabel("outline", STRUCTURE_PANEL.tabs.outline)}
          </Tabs.Trigger>
          <Tabs.Trigger className={styles.tabBtn} value="character">
            {tabLabel("character", STRUCTURE_PANEL.tabs.character)}
          </Tabs.Trigger>
          <Tabs.Trigger className={styles.tabBtn} value="foreshadowing">
            {tabLabel("foreshadowing", STRUCTURE_PANEL.tabs.foreshadowing)}
          </Tabs.Trigger>
          <Tabs.Trigger className={styles.tabBtn} value="rule">
            {tabLabel("rule", STRUCTURE_PANEL.tabs.rule)}
          </Tabs.Trigger>
        </Tabs.List>

        <div className={styles.content}>
          <Tabs.Content value="overview" className={styles.tabContent}>
            {profileLoadFailed ? (
              <EmptyState
                title={STRUCTURE_PANEL.profile.readFailureTitle}
                description={STRUCTURE_PANEL.profile.readFailureDescription}
                actionLabel={STRUCTURE_PANEL.profile.readFailureRetryLabel}
                actionVariant="secondary"
                onAction={() => setProfileRetryNonce((value) => value + 1)}
              />
            ) : (
              <div className={styles.section}>
                <div className={styles.secHeader}>
                  <span className={styles.secTitle}>{STRUCTURE_PANEL.profile.sectionTitle}</span>
                  <span className={styles.profileStatusBadge}>
                    {profileStatusLabel(profile?.status)}
                  </span>
                </div>
                <div className={styles.profileTitle}>
                  {profileText(profile?.title ?? context.workTitle)}
                </div>
                <dl className={styles.profileRows}>
                  {profileRows(profile).map((row) => (
                    <div className={styles.profileRow} key={row.label}>
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className={styles.detailHint}>{STRUCTURE_PANEL.profile.readonlyHint}</div>
                <div className={styles.cardActions}>
                  <button
                    className={styles.btnSecondary}
                    disabled={!hasWork}
                    onClick={() => onNewAction(STRUCTURE_PANEL.profile.revisePrompt)}
                  >
                    {STRUCTURE_PANEL.profile.reviseLabel}
                  </button>
                </div>
              </div>
            )}
            {renderPendingSection(
              "overview",
              pendingByTab.overview,
              getArtifactActionState,
              onArtifactAction,
            )}
          </Tabs.Content>

          <Tabs.Content value="foreshadowing" className={styles.tabContent}>
            {renderPendingSection(
              "foreshadowing",
              pendingByTab.foreshadowing,
              getArtifactActionState,
              onArtifactAction,
            )}
            {foreshadowing.length > 0 && (
              <div className={styles.section}>
                <div className={styles.secHeader}>
                  <span className={styles.secTitle}>
                    {STRUCTURE_PANEL.confirmedForeshadowingSection}
                    {` · ${foreshadowing.length}`}
                  </span>
                  <button
                    className={styles.btnSecondary}
                    onClick={() => {
                      onNewForeshadowing();
                      onClose();
                    }}
                  >
                    {STRUCTURE_PANEL.newForeshadowing}
                  </button>
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
                        {selectedArchiveItem?.id === item.id
                          ? STRUCTURE_PANEL.selected
                          : STRUCTURE_PANEL.viewDetail}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {selectedDetail && renderDetail(selectedDetail)}
            {pendingByTab.foreshadowing.length === 0 && foreshadowing.length === 0 && (
              <EmptyState
                title={STRUCTURE_PANEL.foreshadowingEmptyTitle}
                description={STRUCTURE_PANEL.foreshadowingEmptyDesc}
                actionLabel={STRUCTURE_PANEL.newForeshadowing}
                onAction={() => {
                  onNewForeshadowing();
                  onClose();
                }}
              />
            )}
          </Tabs.Content>

          <Tabs.Content value="outline" className={styles.tabContent}>
            {/* 大纲与结构单一数据源：已采纳卷/章结构（结构携带摘要+进度），不再有独立计划视图。 */}
            {renderPendingSection(
              "outline",
              pendingByTab.outline,
              getArtifactActionState,
              onArtifactAction,
            )}
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
            ) : pendingByTab.outline.length === 0 ? (
              <EmptyState
                title={STRUCTURE_PANEL.outlineEmptyTitle}
                description={
                  hasWork
                    ? STRUCTURE_PANEL.outlineEmptyWithWork
                    : STRUCTURE_PANEL.outlineEmptyNoWork
                }
                actionLabel={STRUCTURE_PANEL.startPlanning}
                actionVariant="secondary"
                onAction={() => {
                  onStartPlanning();
                  onClose();
                }}
              />
            ) : null}
          </Tabs.Content>

          <Tabs.Content value="character" className={styles.tabContent}>
            {renderPendingSection(
              "character",
              pendingByTab.character,
              getArtifactActionState,
              onArtifactAction,
            )}
            {characters.length > 0 ? (
              <div className={styles.section}>
                <div className={styles.secHeader}>
                  <span className={styles.secTitle}>
                    {STRUCTURE_PANEL.acceptedCharactersSection}
                    {` · ${characters.length}${STRUCTURE_PANEL.characterCountUnit}`}
                    {!characters.some((c) => c.narrative_role === "PROTAGONIST") && (
                      <span className={styles.cardLabelInline}>
                        {STRUCTURE_PANEL.protagonistUnsetHint}
                      </span>
                    )}
                  </span>
                  <button
                    className={styles.btnSecondary}
                    onClick={() => {
                      onCreateCharacter();
                      onClose();
                    }}
                  >
                    {STRUCTURE_PANEL.createCharacter}
                  </button>
                </div>
                {characters.map((char) => (
                  <div
                    key={char.id}
                    className={styles.cardItem}
                    data-selected={selectedArchiveItem?.id === char.id ? "true" : "false"}
                  >
                    <div className={styles.cardTitle}>
                      {char.name}
                      {char.narrative_role &&
                        STRUCTURE_PANEL.narrativeRoleLabels[char.narrative_role] && (
                          <span className={styles.cardLabelInline}>
                            {STRUCTURE_PANEL.narrativeRoleLabels[char.narrative_role]}
                          </span>
                        )}
                      {char.role && <span className={styles.cardLabelInline}>{char.role}</span>}
                    </div>
                    {char.summary && <div className={styles.cardDesc}>{char.summary}</div>}
                    {char.aliases && char.aliases.length > 0 && (
                      <div className={styles.cardDesc}>
                        {STRUCTURE_PANEL.aliasPrefix}
                        {char.aliases.join("、")}
                      </div>
                    )}
                    <div className={styles.cardActions}>
                      <button
                        className={styles.btnGhost}
                        aria-pressed={selectedArchiveItem?.id === char.id}
                        onClick={() => setSelectedArchiveItem({ kind: "character", id: char.id })}
                      >
                        {selectedArchiveItem?.id === char.id
                          ? STRUCTURE_PANEL.selected
                          : STRUCTURE_PANEL.viewDetail}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : pendingByTab.character.length === 0 ? (
              <EmptyState
                title={STRUCTURE_PANEL.characterEmptyTitle}
                description={
                  hasWork
                    ? STRUCTURE_PANEL.characterEmptyWithWork
                    : STRUCTURE_PANEL.characterEmptyNoWork
                }
                actionLabel={STRUCTURE_PANEL.createCharacter}
                onAction={() => {
                  onCreateCharacter();
                  onClose();
                }}
              />
            ) : null}
            {selectedDetail && renderDetail(selectedDetail)}
          </Tabs.Content>

          <Tabs.Content value="rule" className={styles.tabContent}>
            {renderPendingSection(
              "rule",
              pendingByTab.rule,
              getArtifactActionState,
              onArtifactAction,
            )}
            {rules.length > 0 ? (
              <div className={styles.section}>
                <div className={styles.secHeader}>
                  <span className={styles.secTitle}>
                    {STRUCTURE_PANEL.confirmedRulesSection}
                    {` · ${rules.length}${STRUCTURE_PANEL.ruleCountUnit}`}
                  </span>
                  <button
                    className={styles.btnSecondary}
                    onClick={() => {
                      onNewRule();
                      onClose();
                    }}
                  >
                    {STRUCTURE_PANEL.newRule}
                  </button>
                </div>
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
                        {selectedArchiveItem?.id === item.id
                          ? STRUCTURE_PANEL.selected
                          : STRUCTURE_PANEL.viewDetail}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : pendingByTab.rule.length === 0 ? (
              <EmptyState
                title={STRUCTURE_PANEL.ruleEmptyTitle}
                description={STRUCTURE_PANEL.ruleEmptyDesc}
                actionLabel={STRUCTURE_PANEL.newRule}
                onAction={() => {
                  onNewRule();
                  onClose();
                }}
              />
            ) : null}
            {selectedDetail && renderDetail(selectedDetail)}
          </Tabs.Content>
        </div>
      </Tabs.Root>

      <div className={styles.footerActions}>
        <button className={styles.btnSecondary} onClick={() => onNewAction(footerAction.prompt)}>
          {footerAction.label}
        </button>
        <div className={styles.actionsHint}>{footerAction.hint}</div>
      </div>
    </div>
  );
}

function renderPendingSection(
  tab: PendingTabType,
  artifacts: ArtifactEntry[],
  getArtifactActionState: Props["getArtifactActionState"],
  onArtifactAction: Props["onArtifactAction"],
) {
  if (artifacts.length === 0) return null;

  return (
    <div className={styles.section}>
      <div className={styles.secHeader}>
        <span className={styles.secTitleAccent}>{STRUCTURE_PANEL.pendingSections[tab]}</span>
      </div>
      {artifacts.map((artifact) => {
        const acceptAction = getArtifactActionState(artifact, "accept");
        const editAction = getArtifactActionState(artifact, "edit_then_accept");

        return (
          <div key={artifact.artifact_id} className={styles.cardAccent}>
            <div className={styles.cardLabel}>{STRUCTURE_PANEL.pendingBadges[tab]}</div>
            <div className={styles.cardTitle}>{pendingArtifactTitle(artifact, tab)}</div>
            <div className={styles.cardDesc}>{pendingArtifactDescription(artifact, tab)}</div>
            <div className={styles.cardDesc}>{STRUCTURE_PANEL.pendingDestinations[tab]}</div>
            <div className={styles.cardActions}>
              <button
                className={styles.btnPrimary}
                disabled={!acceptAction.enabled}
                title={acceptAction.disabledReason}
                onClick={() => onArtifactAction(artifact, "accept")}
              >
                {STRUCTURE_PANEL.pendingAcceptLabels[tab]}
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
  );
}

function EmptyState({
  title,
  description,
  actionLabel,
  actionVariant = "primary",
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  actionVariant?: "primary" | "secondary";
  onAction?: () => void;
}) {
  return (
    <div className={styles.emptySection}>
      <div className={styles.emptyTitle}>{title}</div>
      <div className={styles.emptyDesc}>{description}</div>
      {actionLabel && onAction && (
        <button
          className={actionVariant === "primary" ? styles.btnPrimary : styles.btnSecondary}
          onClick={onAction}
        >
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
      <div className={styles.detailTitle}>{archiveDetailTitle(detail)}</div>
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
