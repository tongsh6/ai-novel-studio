import { create } from "zustand";
import type { Channel } from "phoenix";

export type WorkspaceMode = "workbench" | "reading" | "memory";

export interface SystemContext {
  workId: string | null;
  workTitle: string | null;
  assistantDisplayName: string | null;
  volumeId: string | null;
  volumeTitle: string | null;
  chapterId: string | null;
  chapterTitle: string | null;
}

export interface LongRunState {
  status: "idle" | "running" | "checkpoint" | "failed";
  budgetUsed: number;
  budgetTotal: number;
  checkpointReason: string | null;
}

export type ProjectionRefreshStatus = "FRESH" | "STALE" | "REBUILDING" | "FAILED" | null;

export type PendingBuildAction = "refresh_projection" | "retry_projection" | null;

export interface AgentFeedback {
  severity: "none" | "info" | "warning" | "error";
  activeCount: number;
  message: string | null;
}

interface AppState {
  // Navigation & Mode
  mode: WorkspaceMode;
  setMode: (mode: WorkspaceMode) => void;

  // Context (Work, Volume, Chapter)
  context: SystemContext;
  setContext: (ctx: Partial<SystemContext>) => void;

  // Long-run Execution & Budget
  longRun: LongRunState;
  setLongRun: (state: Partial<LongRunState>) => void;

  // Risk / Quality Findings
  feedback: AgentFeedback;
  setFeedback: (feedback: Partial<AgentFeedback>) => void;

  // Projection (VS-005)
  projectionStatus: ProjectionRefreshStatus;
  setProjectionStatus: (status: ProjectionRefreshStatus) => void;
  pendingBuildAction: PendingBuildAction;
  setPendingBuildAction: (action: PendingBuildAction) => void;

  // Channel reference (set by WorkspaceChat on connect)
  channel: Channel | null;
  setChannel: (ch: Channel | null) => void;

  // Connection
  socketConnected: boolean;
  setSocketConnected: (connected: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  mode: "workbench",
  setMode: (mode) => set({ mode }),

  context: {
    workId: null,
    workTitle: null,
    assistantDisplayName: null,
    volumeId: null,
    volumeTitle: null,
    chapterId: null,
    chapterTitle: null,
  },
  setContext: (ctx) => set((state) => ({ context: { ...state.context, ...ctx } })),

  longRun: {
    status: "idle",
    budgetUsed: 0,
    budgetTotal: 100,
    checkpointReason: null,
  },
  setLongRun: (stateUpdate) => set((state) => ({ longRun: { ...state.longRun, ...stateUpdate } })),

  feedback: {
    severity: "none",
    activeCount: 0,
    message: null,
  },
  setFeedback: (fb) => set((state) => ({ feedback: { ...state.feedback, ...fb } })),

  projectionStatus: null,
  setProjectionStatus: (status) => set({ projectionStatus: status }),
  pendingBuildAction: null,
  setPendingBuildAction: (action) => set({ pendingBuildAction: action }),

  channel: null,
  setChannel: (ch) => set({ channel: ch }),

  socketConnected: false,
  setSocketConnected: (connected) => set({ socketConnected: connected }),
}));
