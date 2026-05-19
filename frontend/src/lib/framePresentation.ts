import { WORKBENCH } from "./copy";

export interface FrameSummaryLike {
  frame_type?: unknown;
  dialogue_goal?: unknown;
}

export type FrameTone =
  | "exploration"
  | "reply"
  | "question"
  | "meta"
  | "confirmation"
  | "default";

export interface FramePresentation {
  visible: boolean;
  label: string;
  tone: FrameTone;
  goal: string | null;
  title: string;
}

const FRAME_PRESENTATION_BY_TYPE: Record<string, { label: string; tone: FrameTone }> = {
  creative_exploration: {
    label: WORKBENCH.frameBadges.creativeExploration,
    tone: "exploration",
  },
  casual_reply: {
    label: WORKBENCH.frameBadges.casualReply,
    tone: "reply",
  },
  question_answer: {
    label: WORKBENCH.frameBadges.questionAnswer,
    tone: "question",
  },
  meta_discussion: {
    label: WORKBENCH.frameBadges.metaDiscussion,
    tone: "meta",
  },
  confirmation_answer: {
    label: WORKBENCH.frameBadges.confirmationAnswer,
    tone: "confirmation",
  },
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeFrameType(value: unknown): string {
  return stringValue(value).toLowerCase().replace(/-/g, "_");
}

export function framePresentationForSummary(
  summary: FrameSummaryLike | null | undefined,
): FramePresentation {
  const frameType = normalizeFrameType(summary?.frame_type);
  const goal = stringValue(summary?.dialogue_goal) || null;
  const presentation = FRAME_PRESENTATION_BY_TYPE[frameType] ?? {
    label: WORKBENCH.frameBadges.fallback,
    tone: "default" as const,
  };

  return {
    visible: frameType.length > 0,
    label: presentation.label,
    tone: presentation.tone,
    goal,
    title: WORKBENCH.frameBadgeTitle(presentation.label, goal),
  };
}
