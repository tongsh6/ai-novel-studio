// Design: docs/design-v3/07-workbench-ui-contract.md
// Design: tasks/slices/v3/VS-07-frontend-workbench-ui-consumer.md §1
//
// v3 Phoenix Channel 消息类型 — user_message / author_action / ping。
// 所有 v3 消息通过 WorkspaceChannel (Elixir) 处理，返回 TurnResult。

import type { Channel, Socket } from "phoenix";
import { createSocket, joinWorkspace } from "./socket";

// ── v3 TurnResult types ──────────────────────────

export interface V3TurnResult {
  schema_version: string;
  turn_id: string;
  frame_ref: string;
  assistant_message: { text: string };
  frame_summary: {
    frame_type: string;
    dialogue_goal: string;
    uncertainty?: string[];
    context_used?: boolean;
  };
  trace_summary: Record<string, unknown>;
  phase: string;
  status: string;
  available_actions: V3AvailableAction[];
  truthfulness: V3Truthfulness;
  candidate_directions?: V3CandidateDirection[];
  orchestrator_decision?: Record<string, unknown>;
  tool_result?: Record<string, unknown>;
  adoption_state?: {
    pending: V3ArtifactEntry[];
    resolved: V3ArtifactEntry[];
  };
  ui_cards?: V3UICard[];
  behavior_state?: Record<string, unknown>;
}

export interface V3UICard {
  card_type: string;
  priority?: string;
  visibility?: string;
  title?: string;
  body?: string;
  artifact_refs?: string[];
  actions?: V3UIAction[];
}

export interface V3UIAction {
  action_id: string;
  action_type?: string;
  label: string;
  target_ref: string;
  enabled: boolean;
  style_hint?: string;
}

export interface V3ArtifactEntry {
  artifact_id: string;
  artifact_type: string;
  adoption_status: string;
  requires_adoption: boolean;
  revision_base?: string | null;
  payload: {
    title?: unknown;
    [key: string]: unknown;
  };
}

export interface V3AvailableAction {
  action_id: string;
  action_type: string;
  behavior_ref?: string;
  target_ref?: string;
  candidate_set_ref?: string;
  candidate_ref?: string;
  enabled: boolean;
  disabled_reason?: string;
  idempotency_key?: string;
}

export interface V3Truthfulness {
  tool_called: boolean;
  artifact_adopted: boolean;
  production_write_performed: boolean;
  durable_behavior_opened: boolean;
}

export interface V3CandidateDirection {
  direction_id: string;
  title: string;
  pitch: string;
  tone_tags: string[];
  risk_hint?: "low" | "medium" | "high";
  adoption_status: string;
}

// ── v3 AuthorAction types ─────────────────────────

export interface V3AuthorActionPayload {
  source_turn_ref: string;
  action_id: string;
  action_type: string;
  behavior_ref?: string;
  candidate_set_ref?: string;
  candidate_ref?: string;
  idempotency_key?: string;
}

// ── Connection ────────────────────────────────────

export interface V3ConnectResult {
  socket: Socket;
  channel: Channel;
}

export function connectV3(workspaceId = "lobby"): V3ConnectResult {
  const socket = createSocket();
  socket.connect();
  const channel = joinWorkspace(socket, `workspace:${workspaceId}`);
  return { socket, channel };
}

// ── user_message ──────────────────────────────────

export function sendUserMessage(
  channel: Channel,
  text: string,
  generateMicroPlan = false,
): Promise<{ received: boolean }> {
  return new Promise((resolve, reject) => {
    channel
      .push("user_message", { text, generate_micro_plan: generateMicroPlan })
      .receive("ok", (resp) => resolve(resp as { received: boolean }))
      .receive("error", (err) => reject(new Error(String(err))))
      .receive("timeout", () => reject(new Error("user_message timeout")));
  });
}

// ── author_action ─────────────────────────────────

export interface AuthorActionResult {
  received: boolean;
  action_status: string;
}

export function sendAuthorAction(
  channel: Channel,
  action: V3AuthorActionPayload,
): Promise<AuthorActionResult> {
  return new Promise((resolve, reject) => {
    channel
      .push("author_action", { action })
      .receive("ok", (resp) => resolve(resp as AuthorActionResult))
      .receive("error", (err) => reject(new Error(String(err))))
      .receive("timeout", () => reject(new Error("author_action timeout")));
  });
}

// ── Subscribe ─────────────────────────────────────

export function onTurnResult(
  channel: Channel,
  callback: (result: V3TurnResult) => void,
): void {
  channel.on("turn_result", (payload: V3TurnResult) => {
    callback(payload);
  });
}

export function onActionResult(
  channel: Channel,
  callback: (result: Record<string, unknown>) => void,
): void {
  channel.on("action_result", (payload: Record<string, unknown>) => {
    callback(payload);
  });
}

// ── task_state ────────────────────────────────────
// Subscribe task lifecycle events broadcast by the backend. Long-running tasks
// are owned by TaskRunner, while the current synchronous creative tool path can
// emit a compact RUNNING/COMPLETED lifecycle for immediate UI feedback.
//
// Full TaskRunner/LongRunTaskLog streaming is still tracked separately in the
// project ledger; this subscription should accept both sources.

export interface V3TaskState {
  task_id: string;
  task_type?: string;
  phase: string;        // PLANNED | RUNNING | CHECKPOINT | RESUMING | COMPLETED | CANCELLED | FAILED
  status: string;       // READY | RUNNING | DONE | ERROR | CANCELLED ...
  progress?: number;    // 0..100
  step?: string;
  updated_at?: string;
}

export function onTaskState(
  channel: Channel,
  callback: (state: V3TaskState) => void,
): void {
  channel.on("task_state", (payload: V3TaskState) => {
    callback(payload);
  });
}

// ── Ping ──────────────────────────────────────────

export function ping(
  channel: Channel,
  payload: Record<string, unknown> = {},
): Promise<{ event: string; echo: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    channel
      .push("ping", payload)
      .receive("ok", (resp) =>
        resolve(resp as { event: string; echo: Record<string, unknown> }),
      )
      .receive("error", (err) => reject(new Error(String(err))))
      .receive("timeout", () => reject(new Error("ping timeout")));
  });
}
