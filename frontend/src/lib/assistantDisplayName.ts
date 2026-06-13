// Contract: docs/design/acceptance/system/SU-03-model-nickname.md
// Design: docs/design/ui/41-workbench-layout.md §4.2
//
// Work-scoped UI preference only. This module must not influence provider,
// prompt, canonical message role, or TurnResult shape.

import { isTauri } from "./env";
import { WORKBENCH } from "./copy";

const STORAGE_KEY = "ans.assistantDisplayNames";
const MAX_DISPLAY_NAME_LENGTH = 20;

type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const DEFAULT_ASSISTANT_DISPLAY_NAME =
  WORKBENCH.assistantDisplayNameDefault;

function browserStorage(): BrowserStorage | null {
  try {
    const candidate = globalThis as typeof globalThis & {
      localStorage?: BrowserStorage;
    };
    return candidate.localStorage ?? null;
  } catch {
    return null;
  }
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export function normalizeAssistantDisplayName(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return Array.from(trimmed).slice(0, MAX_DISPLAY_NAME_LENGTH).join("");
}

export function resolveAssistantDisplayName(value: string | null | undefined): string {
  return normalizeAssistantDisplayName(value) ?? DEFAULT_ASSISTANT_DISPLAY_NAME;
}

export function assistantRoleLabel(
  role: "user" | "assistant",
  assistantDisplayName: string | null | undefined,
): string {
  return role === "user"
    ? WORKBENCH.userDisplayName
    : resolveAssistantDisplayName(assistantDisplayName);
}

export async function getAssistantDisplayName(workId: string | null | undefined): Promise<string> {
  if (!isRealWorkId(workId)) return DEFAULT_ASSISTANT_DISPLAY_NAME;

  try {
    if (isTauri) {
      const value = await invokeTauri<string | null>("get_assistant_display_name", {
        workId,
      });
      return resolveAssistantDisplayName(value);
    }

    return resolveAssistantDisplayName(readBrowserNameMap()[workId]);
  } catch {
    return DEFAULT_ASSISTANT_DISPLAY_NAME;
  }
}

export async function setAssistantDisplayName(
  workId: string | null | undefined,
  value: string,
): Promise<string> {
  if (!isRealWorkId(workId)) return DEFAULT_ASSISTANT_DISPLAY_NAME;

  const normalized = normalizeAssistantDisplayName(value);

  try {
    if (isTauri) {
      await invokeTauri<string | null>("set_assistant_display_name", {
        workId,
        displayName: normalized ?? "",
      });
    } else {
      const names = readBrowserNameMap();
      if (normalized) {
        names[workId] = normalized;
      } else {
        delete names[workId];
      }
      writeBrowserNameMap(names);
    }
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("assistant display name persistence failed", { cause: error });
  }

  return normalized ?? DEFAULT_ASSISTANT_DISPLAY_NAME;
}

export async function resetAssistantDisplayName(workId: string | null | undefined): Promise<string> {
  return setAssistantDisplayName(workId, "");
}

function isRealWorkId(workId: string | null | undefined): workId is string {
  return typeof workId === "string" && workId.trim().length > 0 && workId !== "lobby";
}

function readBrowserNameMap(): Record<string, string> {
  const storage = browserStorage();
  if (!storage) return {};

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .map(([workId, value]) => [
          workId,
          normalizeAssistantDisplayName(typeof value === "string" ? value : ""),
        ])
        .filter((entry): entry is [string, string] => entry[1] !== null),
    );
  } catch {
    return {};
  }
}

function writeBrowserNameMap(names: Record<string, string>): void {
  const storage = browserStorage();
  if (!storage) return;

  const entries = Object.entries(names).filter(([, value]) =>
    normalizeAssistantDisplayName(value),
  );

  if (entries.length === 0) {
    storage.removeItem(STORAGE_KEY);
    return;
  }

  storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
}
