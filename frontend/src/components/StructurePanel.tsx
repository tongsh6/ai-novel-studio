// Design: docs/design/ui/43-structure-panel.md §5（模块 9「脉络」见 §5.0.1，角色归并见 §5.0.2）
// Prototype: novel-studio.pen → 43§5-structure-panel-expanded (ATnmR)
// Prototype: novel-studio.pen → 43§5-9-threads-panel (uyZGw)
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  archiveDetailRows,
  archiveDetailSummary,
  archiveDetailTitle,
  memoryTypeLabel,
} from "../lib/archiveDetail";
import type { ArchiveDetailItem } from "../lib/archiveDetail";
import { STRUCTURE_PANEL } from "../lib/copy";
import {
  isFindingFactInventoryAction,
  reviewFindingDispositionLabel,
} from "../lib/reviewFindingActions";
import { useAppStore } from "../lib/store";
import {
  getToc,
  getCharacters,
  getForeshadowing,
  getRules,
  getWorkStats,
  getWorkProfile,
  getAssumptions,
  getLedgerThreads,
  getReviewReport,
  sendAuthorAction,
  type AssumptionDto,
  type ChapterMissionDto,
  type TocChapter,
} from "../lib/socket";
import type {
  TocData,
  CharacterData,
  MemoryItemData,
  WorkStats,
  WorkProfile,
  LedgerThreads,
  LedgerThreadEntry,
  ReviewReport,
  ReviewFinding,
} from "../lib/socket";
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
  /** CP4c rail 同步：面板侧审读待处置数变化时通知父级（裁决无 turn_result 广播） */
  onReviewPendingChange?: (count: number) => void;
}

type TabType = "overview" | "outline" | "character" | "foreshadowing" | "rule" | "ledger";
type SelectedArchiveItem = { kind: "character"; id: string } | { kind: "memory"; id: string };
type PendingTabType = TabType;

function payloadText(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

// CP4c「脉络」：五账进度态渲染（进度+跳转，不复制对象列表——ui43 §5.0.1 整合红线）
const THREAD_ORDER = ["arc", "conflict", "promise", "information", "emotion_curve"] as const;
const ATTENTION_STATUSES = new Set(["STALLED", "LEAKED", "BROKEN", "DEVIATED"]);

function ledgerStatusLabel(status: string): string {
  return (STRUCTURE_PANEL.ledger.statusLabels as Record<string, string>)[status] ?? status;
}

function threadSummary(key: (typeof THREAD_ORDER)[number], entries: LedgerThreadEntry[]): string {
  if (entries.length === 0) return STRUCTURE_PANEL.ledger.threadEmpty;
  if (key === "emotion_curve") {
    const count = (status: string) => entries.filter((e) => e.status === status).length;
    return `${ledgerStatusLabel("MATCHED")} ${count("MATCHED")} · ${ledgerStatusLabel("DEVIATED")} ${count("DEVIATED")} · ${ledgerStatusLabel("UNPLANNED")} ${count("UNPLANNED")}`;
  }
  const head = entries
    .slice(0, 2)
    .map((e) => `${e.subject_label} ${ledgerStatusLabel(e.status)}`)
    .join("，");
  return entries.length > 2 ? `${head} 等 ${entries.length} 项` : head;
}

function threadChip(entries: LedgerThreadEntry[]): { text: string; accent: boolean } | null {
  const attention = entries.filter((e) => ATTENTION_STATUSES.has(e.status));
  if (attention.length > 0) {
    return { text: `${ledgerStatusLabel(attention[0].status)} ${attention.length}`, accent: true };
  }
  if (entries.length > 0) return { text: `${entries.length} 项`, accent: false };
  return null;
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
    // VS-00G CP4d：全书规划三字段——采纳全书规划建议后作者在此看到立项规划落值。
    { label: STRUCTURE_PANEL.profile.targetLength, value: profileText(profile?.target_length) },
    {
      label: STRUCTURE_PANEL.profile.plannedVolumes,
      value: profileText(profile?.planned_volumes),
    },
    { label: STRUCTURE_PANEL.profile.serialForm, value: profileText(profile?.serial_form) },
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
  if (artifactType === "character_seed" || artifactType === "character_evolution_seed")
    return "character";
  if (artifactType === "foreshadowing_seed") return "foreshadowing";
  if (
    artifactType === "world_rule_seed" ||
    artifactType === "style_rule_seed" ||
    artifactType === "constraint_seed"
  ) {
    return "rule";
  }

  // VS-00G CP4d：全书规划建议归大纲与结构域（采纳后写入立项规划字段）。
  if (artifactType === "work_skeleton_suggestion") return "outline";

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
  return items.length > 1
    ? `共 ${items.length} 条，首条：${compactPreview(preview)}`
    : compactPreview(preview);
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
  onReviewPendingChange,
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
  const [ledgerThreads, setLedgerThreads] = useState<LedgerThreads | null>(null);
  const [reviewReport, setReviewReport] = useState<ReviewReport | null>(null);
  const [ledgerActionError, setLedgerActionError] = useState<string | null>(null);
  const [factInventoryActionError, setFactInventoryActionError] = useState<string | null>(null);
  // VS-00G CP5d：「暂定设定」区（AI 工作假定的可见裁决面，OQ7）。
  const [assumptions, setAssumptions] = useState<AssumptionDto[]>([]);
  const [assumptionActionError, setAssumptionActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!onReviewPendingChange) return;
    const pending = (reviewReport?.findings ?? []).filter((f) => !f.disposition).length;
    onReviewPendingChange(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewReport]);
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
  const [profileRetryNonce, setProfileRetryNonce] = useState(0);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState(false);
  const [selectedArchiveItem, setSelectedArchiveItem] = useState<SelectedArchiveItem | null>(null);
  const context = useAppStore((s) => s.context);
  const channel = useAppStore((s) => s.channel);

  // VS-00G CP5d 防护②：一键确认（就地转正进正式档案）/否决（停止使用）。
  const decideAssumption = (assumption: AssumptionDto, decision: "confirm" | "discard") => {
    if (!channel || !context.workId) return;
    const workId = context.workId;
    const actionId = `${decision}-assumption-${assumption.id}`;

    void sendAuthorAction(channel, {
      source_turn_ref: "panel",
      action_id: actionId,
      action_type: decision === "confirm" ? "confirm_assumption" : "discard_assumption",
      idempotency_key: actionId,
      payload: { character_ref: assumption.id },
    })
      .then(() => {
        setAssumptionActionError(null);
        setAssumptions((prev) => prev.filter((item) => item.id !== assumption.id));
        if (decision === "confirm") {
          void getCharacters(channel, workId)
            .then((data) => setCharacters(data))
            .catch(() => {});
        }
      })
      .catch(() => setAssumptionActionError(STRUCTURE_PANEL.assumptions.actionFailed));
  };

  // WR01b（43 §5.0.3）：本章使命裁决——确认 / 改写（就地编辑）/ 作废；成功后重读 TOC。
  const [missionEditChapterId, setMissionEditChapterId] = useState<string | null>(null);
  const [missionDraft, setMissionDraft] = useState({ statement: "", advance: "", avoid: "" });
  const [missionActionError, setMissionActionError] = useState<string | null>(null);

  const refreshToc = () => {
    if (!channel || !context.workId) return;
    void getToc(channel, context.workId)
      .then((data) => setToc(data))
      .catch(() => {});
  };

  const startMissionEdit = (ch: TocChapter, mission: ChapterMissionDto) => {
    setMissionEditChapterId(ch.id);
    setMissionDraft({
      statement: mission.statement ?? "",
      advance: (mission.must_advance ?? []).map((item) => item.text).join("\n"),
      avoid: (mission.must_avoid ?? []).map((item) => item.text).join("\n"),
    });
  };

  const decideChapterMission = (
    ch: TocChapter,
    decision: "confirm" | "rewrite" | "discard",
    extra: Record<string, unknown> = {},
  ) => {
    if (!channel || !context.workId) return;
    const actionId = `${decision}-chapter-mission-${ch.id}`;

    void sendAuthorAction(channel, {
      source_turn_ref: "panel",
      action_id: actionId,
      action_type: `${decision}_chapter_mission`,
      idempotency_key: actionId,
      payload: { chapter_ref: ch.id, ...extra },
    })
      .then(() => {
        setMissionActionError(null);
        setMissionEditChapterId(null);
        refreshToc();
      })
      .catch(() => setMissionActionError(STRUCTURE_PANEL.chapterMission.actionFailed));
  };

  const renderChapterMission = (ch: TocChapter) => {
    const mission = ch.plan_direction?.chapter_mission;
    if (!mission || !mission.statement) return null;
    const M = STRUCTURE_PANEL.chapterMission;
    const status = mission.status ?? "TENTATIVE";
    const editing = missionEditChapterId === ch.id;

    return (
      <div className={styles.missionBlock}>
        <div className={styles.assumptionBody}>
          <span className={styles.assumptionBadge}>{M.statusLabels[status] ?? status}</span>
          <span className={styles.missionLabel}>{M.label}</span>
        </div>
        {editing ? (
          <div className={styles.missionEditor}>
            <label className={styles.missionEditorLabel}>
              {M.statementLabel}
              <textarea
                className={styles.missionTextarea}
                aria-label={M.statementLabel}
                value={missionDraft.statement}
                onChange={(e) => setMissionDraft({ ...missionDraft, statement: e.target.value })}
              />
            </label>
            <label className={styles.missionEditorLabel}>
              {M.advanceLabel}
              <textarea
                className={styles.missionTextarea}
                aria-label={M.advanceLabel}
                value={missionDraft.advance}
                onChange={(e) => setMissionDraft({ ...missionDraft, advance: e.target.value })}
              />
            </label>
            <label className={styles.missionEditorLabel}>
              {M.avoidLabel}
              <textarea
                className={styles.missionTextarea}
                aria-label={M.avoidLabel}
                value={missionDraft.avoid}
                onChange={(e) => setMissionDraft({ ...missionDraft, avoid: e.target.value })}
              />
            </label>
            <div className={styles.cardActions}>
              <button
                className={styles.btnSecondary}
                disabled={missionDraft.statement.trim() === ""}
                onClick={() =>
                  decideChapterMission(ch, "rewrite", {
                    statement: missionDraft.statement.trim(),
                    must_advance: missionDraft.advance.split("\n"),
                    must_avoid: missionDraft.avoid.split("\n"),
                  })
                }
              >
                {M.saveLabel}
              </button>
              <button className={styles.btnGhost} onClick={() => setMissionEditChapterId(null)}>
                {M.cancelLabel}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.missionStatement}>{mission.statement}</div>
            {(mission.must_advance ?? []).map((item, index) => (
              <div className={styles.missionItem} key={`advance-${index}`}>
                {M.advancePrefix}
                {item.text}
                {item.basis_label ? `（${M.basisPrefix}${item.basis_label}）` : ""}
              </div>
            ))}
            {(mission.must_avoid ?? []).map((item, index) => (
              <div className={styles.missionItem} key={`avoid-${index}`}>
                {M.avoidPrefix}
                {item.text}
                {item.basis_label ? `（${M.basisPrefix}${item.basis_label}）` : ""}
              </div>
            ))}
            <div className={styles.cardActions}>
              {status === "TENTATIVE" && (
                <button
                  className={styles.btnSecondary}
                  onClick={() => decideChapterMission(ch, "confirm")}
                >
                  {M.confirmLabel}
                </button>
              )}
              <button
                className={styles.btnSecondary}
                onClick={() => startMissionEdit(ch, mission)}
              >
                {M.rewriteLabel}
              </button>
              <button
                className={styles.btnSecondary}
                onClick={() => decideChapterMission(ch, "discard")}
              >
                {M.discardLabel}
              </button>
            </div>
          </>
        )}
        {missionActionError && editing === false && missionEditChapterId === null && (
          <div className={styles.footerActionError}>{missionActionError}</div>
        )}
      </div>
    );
  };

  // AU12（43 §5.0.2）：档案侧角色身份归并——同名是同一人/别名/改名还是真重名
  // 只能由作者裁决；当前选中行是被并入方（source），弹窗里选保留行（target）。
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeKeepName, setMergeKeepName] = useState<"target" | "source">("target");
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);

  const openMergeDialog = (candidates: CharacterData[]) => {
    setMergeTargetId(candidates[0]?.id ?? "");
    setMergeKeepName("target");
    setMergeError(null);
    setMergeBusy(false);
    setMergeDialogOpen(true);
  };

  const mergeCharacters = (source: CharacterData, targetId: string) => {
    if (!channel || !context.workId || !targetId || mergeBusy) return;
    const workId = context.workId;
    const actionId = `merge-characters-${source.id}-${targetId}`;
    setMergeBusy(true);
    setMergeError(null);

    void sendAuthorAction(channel, {
      source_turn_ref: "panel",
      action_id: actionId,
      action_type: "merge_characters",
      idempotency_key: actionId,
      payload: { source_ref: source.id, target_ref: targetId, keep_name: mergeKeepName },
    })
      .then(() => {
        setMergeDialogOpen(false);
        setSelectedArchiveItem(null);
        void getCharacters(channel, workId)
          .then((data) => setCharacters(data))
          .catch(() => {});
      })
      .catch(() => {
        setMergeBusy(false);
        setMergeError(STRUCTURE_PANEL.characterMerge.actionFailed);
      });
  };
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
        setLedgerThreads(null);
        setReviewReport(null);
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
      getAssumptions(channel, workId)
        .then((data) => !cancelled && setAssumptions(data))
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
      // CP4c 脉络：五账进度态 + 最新审读报告（只读；读失败保留快照，与档案读同策略）
      getLedgerThreads(channel, workId)
        .then((data) => !cancelled && setLedgerThreads(data))
        .catch(() => {
          anyFailed = true;
        }),
      getReviewReport(channel, workId)
        .then((data) => !cancelled && setReviewReport(data))
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
    ledger: [],
  };
  const tabPendingCount = (tab: PendingTabType) => pendingByTab[tab].length;
  const tabLabel = (tab: PendingTabType, label: string) => {
    const count = tabPendingCount(tab);
    if (count === 0) return label;
    return <span className={styles.tabTextAccent}>{`${label} (${count})`}</span>;
  };

  // 已采纳卷/章结构即大纲（结构携带 summary + 进度），单一数据源，作为面板章节列表。
  const planVolumes = toc?.volumes ?? [];
  const planChapters = planVolumes.flatMap((vol) => vol.chapters);
  // AU08 CP3：多卷书按卷分组显示；单卷书维持扁平列表——给单卷加一层「第一卷」表头
  // 只是噪声，作者看到的层级要对应真实结构。
  const showVolumeGrouping = planVolumes.length > 1;

  const renderPlanChapter = (ch: TocChapter) => (
    <div key={ch.id} className={styles.cardItem}>
      <span className={styles.cardTitle}>{ch.title}</span>
      <div className={styles.cardDesc}>
        {(ch.word_count ?? 0) > 0
          ? `${STRUCTURE_PANEL.chapterWrittenPrefix} ${ch.word_count} ${STRUCTURE_PANEL.chapterWordsUnit}`
          : STRUCTURE_PANEL.chapterPendingBadge}
      </div>
      {ch.summary && <div className={styles.cardDesc}>{ch.summary}</div>}
      {renderChapterMission(ch)}
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
  );

  // VS-00G §2.4 全书规划进度摘要（口径与收官守则注入同源）：目标体量未立时诚实
  // 提示缺口而不是留空——「不知道要写多长」正是收官循环与题材漂移的结构缺口。
  const skeletonProgressLine = (() => {
    const currentWords = Number(stats?.words_total ?? toc?.total_word_count ?? 0);
    const targetWords = Number(profile?.target_length ?? 0);
    const plannedVolumes = Number(profile?.planned_volumes ?? 0);
    const currentVolumes = Number(stats?.volumes ?? toc?.volumes?.length ?? 0);
    const serialForm = profileText(profile?.serial_form);
    const hasSerialForm = serialForm !== STRUCTURE_PANEL.profile.emptyValue;

    if (targetWords <= 0 && plannedVolumes <= 0 && !hasSerialForm) {
      return currentWords > 0 ? STRUCTURE_PANEL.skeletonProgress.missingHint : null;
    }

    const parts: string[] = [
      targetWords > 0
        ? STRUCTURE_PANEL.skeletonProgress.words(
            currentWords,
            targetWords,
            Math.round((currentWords / targetWords) * 100),
          )
        : STRUCTURE_PANEL.skeletonProgress.wordsWithoutTarget(currentWords),
    ];

    if (plannedVolumes > 0) {
      parts.push(STRUCTURE_PANEL.skeletonProgress.volumes(currentVolumes, plannedVolumes));
    }
    if (hasSerialForm) {
      parts.push(STRUCTURE_PANEL.skeletonProgress.serialForm(serialForm));
    }

    return parts.join("｜");
  })();

  // CP4c「脉络」：待处置偏离计数（tab 角标与概览审读行共用）；裁决=作者动作+
  // revise_* 回对话流发起修订意图（只读+意图边界，ui43 §3）。
  const pendingLedgerFindings = (reviewReport?.findings ?? []).filter((f) => !f.disposition);
  const ledgerTabLabel =
    pendingLedgerFindings.length > 0 ? (
      <span className={styles.tabTextAccent}>
        {`${STRUCTURE_PANEL.tabs.ledger} (${pendingLedgerFindings.length})`}
      </span>
    ) : (
      STRUCTURE_PANEL.tabs.ledger
    );

  const handleAdjudicate = (finding: ReviewFinding, index: number, disposition: string) => {
    if (!channel || !reviewReport) return;
    setLedgerActionError(null);

    if (isFindingFactInventoryAction(finding, disposition)) {
      const actionId = `finding-inventory-${reviewReport.id}-${index}`;

      void sendAuthorAction(channel, {
        source_turn_ref: "panel",
        action_id: actionId,
        action_type: "start_fact_inventory",
        idempotency_key: actionId,
        payload: {
          trigger_type: "finding",
          report_id: reviewReport.id,
          finding_index: index,
          finding_rule: finding.rule,
        },
      })
        .then(() => {
          setReviewReport((prev) =>
            prev
              ? {
                  ...prev,
                  findings: prev.findings.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, disposition: "revise_design" } : item,
                  ),
                }
              : prev,
          );
          onClose();
        })
        .catch(() => {
          setLedgerActionError(STRUCTURE_PANEL.ledger.protagonistInventoryStartFailed);
        });

      return;
    }

    void sendAuthorAction(channel, {
      source_turn_ref: "panel",
      action_id: `adjudicate-${reviewReport.id}-${index}`,
      action_type: "adjudicate_finding",
      idempotency_key: `adjudicate-${reviewReport.id}-${index}-${disposition}`,
      payload: { report_id: reviewReport.id, finding_index: index, disposition },
    })
      .then(() => {
        setReviewReport((prev) =>
          prev
            ? {
                ...prev,
                findings: prev.findings.map((f, i) => (i === index ? { ...f, disposition } : f)),
              }
            : prev,
        );
        if (disposition === "revise_design") {
          onNewAction(STRUCTURE_PANEL.ledger.reviseDesignPrompt(finding.signal));
        }
        if (disposition === "revise_prose") {
          onNewAction(STRUCTURE_PANEL.ledger.reviseProsePrompt(finding.signal));
        }
      })
      .catch(() => {
        setLedgerActionError(STRUCTURE_PANEL.ledger.adjudicateFailed);
      });
  };

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

  // AU12 归并候选：同作品其余已确认角色，同名行置顶（最常见的归并场景）。
  const mergeCandidates = selectedCharacter
    ? [...characters]
        .filter((c) => c.id !== selectedCharacter.id)
        .sort(
          (a, b) =>
            Number(b.name === selectedCharacter.name) - Number(a.name === selectedCharacter.name),
        )
    : [];
  const mergeTarget = mergeCandidates.find((c) => c.id === mergeTargetId) ?? mergeCandidates[0];

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
          <Tabs.Trigger className={styles.tabBtn} value="ledger">
            {ledgerTabLabel}
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
                {assumptions.length > 0 && (
                  <div className={styles.assumptionSection}>
                    <div className={styles.secHeader}>
                      <span className={styles.secTitle}>
                        {STRUCTURE_PANEL.assumptions.sectionTitle}
                      </span>
                    </div>
                    <div className={styles.detailHint}>{STRUCTURE_PANEL.assumptions.hint}</div>
                    {assumptions.map((assumption) => (
                      <div className={styles.assumptionRow} key={assumption.id}>
                        <div className={styles.assumptionBody}>
                          <span className={styles.assumptionBadge}>
                            {STRUCTURE_PANEL.assumptions.badge}
                          </span>
                          <span className={styles.assumptionName}>
                            {(assumption.narrative_role &&
                              STRUCTURE_PANEL.assumptions.roleLabels[
                                assumption.narrative_role
                              ]) ??
                              ""}
                            {assumption.narrative_role ? "：" : ""}
                            {assumption.name}
                          </span>
                          {assumption.summary && (
                            <span className={styles.assumptionSummary}>{assumption.summary}</span>
                          )}
                        </div>
                        <div className={styles.cardActions}>
                          <button
                            className={styles.btnSecondary}
                            onClick={() => decideAssumption(assumption, "confirm")}
                          >
                            {STRUCTURE_PANEL.assumptions.confirmLabel}
                          </button>
                          <button
                            className={styles.btnSecondary}
                            onClick={() => decideAssumption(assumption, "discard")}
                          >
                            {STRUCTURE_PANEL.assumptions.discardLabel}
                          </button>
                        </div>
                      </div>
                    ))}
                    {assumptionActionError && (
                      <div className={styles.footerActionError}>{assumptionActionError}</div>
                    )}
                  </div>
                )}
              </div>
            )}
            {reviewReport && (
              <div className={styles.section}>
                <button className={styles.btnGhost} onClick={() => setActiveTab("ledger")}>
                  {pendingLedgerFindings.length > 0
                    ? STRUCTURE_PANEL.ledger.overviewLine(pendingLedgerFindings.length)
                    : STRUCTURE_PANEL.ledger.overviewLineClear}
                </button>
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
            {skeletonProgressLine && (
              <div className={styles.section}>
                <div className={styles.secHeader}>
                  <span className={styles.secTitle}>{STRUCTURE_PANEL.skeletonProgress.label}</span>
                </div>
                <div className={styles.detailHint}>{skeletonProgressLine}</div>
              </div>
            )}
            {planChapters.length > 0 ? (
              <div className={styles.section}>
                <div className={styles.secHeader}>
                  <span className={styles.secTitle}>
                    {STRUCTURE_PANEL.acceptedChapterPlanSection}
                    {` · ${planChapters.length}${STRUCTURE_PANEL.chapterCountUnit}`}
                  </span>
                </div>
                {showVolumeGrouping
                  ? planVolumes.map((vol) => (
                      <div key={vol.id}>
                        <div className={styles.volumeHeader}>
                          {vol.title}
                          {` · ${vol.chapters.length}${STRUCTURE_PANEL.chapterCountUnit}`}
                        </div>
                        {vol.chapters.map(renderPlanChapter)}
                      </div>
                    ))
                  : planChapters.map(renderPlanChapter)}
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
            {selectedDetail &&
              renderDetail(
                selectedDetail,
                selectedDetail.kind === "character" &&
                  selectedCharacter &&
                  mergeCandidates.length > 0 ? (
                  <div className={styles.cardActions}>
                    <button
                      className={styles.btnSecondary}
                      onClick={() => openMergeDialog(mergeCandidates)}
                    >
                      {STRUCTURE_PANEL.characterMerge.openLabel}
                    </button>
                  </div>
                ) : undefined,
              )}
            {selectedCharacter && mergeTarget && (
              <Dialog.Root
                open={mergeDialogOpen}
                onOpenChange={(open) => {
                  if (!mergeBusy) setMergeDialogOpen(open);
                }}
              >
                <Dialog.Portal>
                  <Dialog.Overlay className={styles.dialogOverlay} />
                  <Dialog.Content
                    className={styles.dialogContent}
                    aria-describedby="character-merge-hint"
                  >
                    <Dialog.Title className={styles.dialogTitle}>
                      {STRUCTURE_PANEL.characterMerge.dialogTitle}
                    </Dialog.Title>
                    <p id="character-merge-hint" className={styles.dialogDescription}>
                      {STRUCTURE_PANEL.characterMerge.dialogHint}
                    </p>
                    <label className={styles.dialogField}>
                      {STRUCTURE_PANEL.characterMerge.targetLabel}
                      <select
                        className={styles.dialogSelect}
                        value={mergeTarget.id}
                        onChange={(event) => setMergeTargetId(event.target.value)}
                      >
                        {mergeCandidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name}
                            {candidate.role ? `（${candidate.role}）` : ""}
                            {candidate.summary ? ` — ${candidate.summary.slice(0, 24)}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <fieldset className={styles.dialogField}>
                      <legend>{STRUCTURE_PANEL.characterMerge.keepNameLabel}</legend>
                      <label className={styles.dialogRadioRow}>
                        <input
                          type="radio"
                          name="merge-keep-name"
                          checked={mergeKeepName === "target"}
                          onChange={() => setMergeKeepName("target")}
                        />
                        {STRUCTURE_PANEL.characterMerge.keepTargetName(mergeTarget.name)}
                      </label>
                      <label className={styles.dialogRadioRow}>
                        <input
                          type="radio"
                          name="merge-keep-name"
                          checked={mergeKeepName === "source"}
                          onChange={() => setMergeKeepName("source")}
                        />
                        {STRUCTURE_PANEL.characterMerge.keepSourceName(selectedCharacter.name)}
                      </label>
                    </fieldset>
                    <div className={styles.dialogConsequence}>
                      {STRUCTURE_PANEL.characterMerge.consequence(
                        selectedCharacter.name,
                        mergeTarget.name,
                      )}
                    </div>
                    {mergeError && <div className={styles.dialogError}>{mergeError}</div>}
                    <div className={styles.dialogActions}>
                      <Dialog.Close asChild>
                        <button className={styles.btnGhost} disabled={mergeBusy}>
                          {STRUCTURE_PANEL.characterMerge.cancelLabel}
                        </button>
                      </Dialog.Close>
                      <button
                        className={styles.btnSecondary}
                        disabled={mergeBusy}
                        onClick={() => mergeCharacters(selectedCharacter, mergeTarget.id)}
                      >
                        {STRUCTURE_PANEL.characterMerge.confirmLabel}
                      </button>
                    </div>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
            )}
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

          <Tabs.Content value="ledger" className={styles.tabContent}>
            <div className={styles.section}>
              <div className={styles.secHeader}>
                <span className={styles.secTitle}>
                  {STRUCTURE_PANEL.ledger.threadsSectionTitle}
                </span>
              </div>
              {THREAD_ORDER.map((key) => {
                const entries = ledgerThreads?.[key] ?? [];
                const chip = threadChip(entries);
                return (
                  <div key={key} className={styles.ledgerRow}>
                    <div className={styles.ledgerRowMain}>
                      <span className={styles.cardTitle}>
                        {STRUCTURE_PANEL.ledger.threadNames[key]}
                      </span>
                      <span className={styles.cardDesc}>{threadSummary(key, entries)}</span>
                    </div>
                    {chip && (
                      <span
                        className={
                          chip.accent
                            ? `${styles.ledgerChip} ${styles.ledgerChipAccent}`
                            : styles.ledgerChip
                        }
                      >
                        {chip.text}
                      </span>
                    )}
                  </div>
                );
              })}
              <div className={styles.detailHint}>{STRUCTURE_PANEL.ledger.jumpHint}</div>
            </div>
            {reviewReport ? (
              <div className={styles.section}>
                <div className={styles.secHeader}>
                  <span className={styles.secTitle}>
                    {STRUCTURE_PANEL.ledger.reportTitle}
                    {reviewReport.scanned_at_seq != null &&
                      ` · ${STRUCTURE_PANEL.ledger.reportUpTo(reviewReport.scanned_at_seq)}`}
                  </span>
                  <span
                    className={
                      pendingLedgerFindings.length > 0
                        ? `${styles.ledgerChip} ${styles.ledgerChipAccent}`
                        : styles.ledgerChip
                    }
                  >
                    {pendingLedgerFindings.length > 0
                      ? STRUCTURE_PANEL.ledger.reportPendingChip
                      : STRUCTURE_PANEL.ledger.reportResolvedChip}
                  </span>
                </div>
                {ledgerActionError && (
                  <div className={styles.archiveStatusBannerError}>{ledgerActionError}</div>
                )}
                {reviewReport.findings.map((finding, index) => (
                  <div key={`${finding.rule}-${index}`} className={styles.cardItem}>
                    <div className={styles.cardTitle}>{finding.signal}</div>
                    <div className={styles.cardDesc}>
                      {STRUCTURE_PANEL.ledger.evidencePrefix}
                      {(finding.source_refs ?? []).join("、") || "—"}
                    </div>
                    {finding.disposition ? (
                      <div className={styles.cardDesc}>
                        {STRUCTURE_PANEL.ledger.dispositionDone}
                        {" · "}
                        {reviewFindingDispositionLabel(finding, finding.disposition)}
                      </div>
                    ) : (
                      <div className={styles.cardActions}>
                        {(
                          ["revise_design", "revise_prose", "accept_drift", "dismiss"] as const
                        ).map((disposition) => (
                          <button
                            key={disposition}
                            className={
                              isFindingFactInventoryAction(finding, disposition)
                                ? styles.btnPrimary
                                : styles.btnSecondary
                            }
                            onClick={() => handleAdjudicate(finding, index, disposition)}
                          >
                            {reviewFindingDispositionLabel(finding, disposition)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <div className={styles.detailHint}>{STRUCTURE_PANEL.ledger.boundaryHint}</div>
              </div>
            ) : (
              <EmptyState
                title={STRUCTURE_PANEL.ledger.reportTitle}
                description={STRUCTURE_PANEL.ledger.reportEmpty}
              />
            )}
          </Tabs.Content>
        </div>
      </Tabs.Root>

      <div className={styles.footerActions}>
        <div className={styles.footerActionButtons}>
          {activeTab === "overview" && (
            <button
              className={styles.btnSecondary}
              onClick={() => {
                if (!channel || !hasWork) return;
                const nonce = `fact-inventory-${Date.now()}`;
                setFactInventoryActionError(null);
                void sendAuthorAction(channel, {
                  source_turn_ref: "panel",
                  action_id: nonce,
                  action_type: "start_fact_inventory",
                  idempotency_key: nonce,
                })
                  .then(() => onClose())
                  .catch(() =>
                    setFactInventoryActionError(STRUCTURE_PANEL.factInventory.startFailed),
                  );
              }}
            >
              {STRUCTURE_PANEL.factInventory.label}
            </button>
          )}
          <button
            className={styles.btnSecondary}
            onClick={() => {
              // CP4c-2：脉络页动作=显式发起全书审读（ledger_reconciliation_v1 AgentRun，
              // 异步于 turn 主链、运行进对话流）；其余 tab 保持意图发起回对话流。
              if (activeTab === "ledger") {
                if (!channel) return;
                const nonce = `full-review-${Date.now()}`;
                setLedgerActionError(null);
                void sendAuthorAction(channel, {
                  source_turn_ref: "panel",
                  action_id: nonce,
                  action_type: "start_full_review",
                  idempotency_key: nonce,
                })
                  .then(() => onClose())
                  .catch(() => setLedgerActionError(STRUCTURE_PANEL.ledger.reviewStartFailed));
                return;
              }
              onNewAction(footerAction.prompt);
            }}
          >
            {footerAction.label}
          </button>
        </div>
        <div className={styles.actionsHint}>
          {activeTab === "overview" ? STRUCTURE_PANEL.factInventory.hint : footerAction.hint}
        </div>
        {factInventoryActionError && (
          <div className={styles.footerActionError}>{factInventoryActionError}</div>
        )}
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

function renderDetail(detail: ArchiveDetailItem, actions?: ReactNode) {
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
      {actions}
      <div className={styles.detailHint}>{STRUCTURE_PANEL.detailHint}</div>
    </div>
  );
}
