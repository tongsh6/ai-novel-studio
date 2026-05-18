// Design: tasks/slices/v3/VS-09-work-management.md §6 (frontend)
// Contract: backend GET /api/works / POST /api/works (NovelWeb.WorksController)
//
// 最小作品 API 客户端：list / create / lastOpened（Tauri preference command）。

import { apiBaseUrl, isTauri } from "./env";

export interface WorkDto {
  id: string;
  title: string;
  genre: string | null;
  status: string;
  updated_at: string | null;
  inserted_at: string | null;
}

const LS_KEY = "ans.lastOpenedWorkId";

function url(path: string): string {
  return `${apiBaseUrl}${path}`;
}

export async function listWorks(): Promise<WorkDto[]> {
  const res = await fetch(url("/api/works"));
  if (!res.ok) throw new Error(`listWorks failed: HTTP ${res.status}`);
  const body = (await res.json()) as { works: WorkDto[] };
  return body.works;
}

export async function createWork(input: {
  title: string;
  genre?: string;
}): Promise<WorkDto> {
  const res = await fetch(url("/api/works"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`createWork failed: HTTP ${res.status}`);
  const body = (await res.json()) as { work: WorkDto };
  return body.work;
}

type BrowserStorage = Pick<Storage, "getItem" | "setItem">;

export interface WorkConnectionIdentity {
  token: number;
  workId: string | null;
}

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

export async function getLastOpenedWorkId(): Promise<string | null> {
  try {
    if (isTauri) {
      return await invokeTauri<string | null>("get_last_opened_work_id");
    }

    return browserStorage()?.getItem(LS_KEY) ?? null;
  } catch {
    return null;
  }
}

export async function setLastOpenedWorkId(id: string): Promise<void> {
  try {
    if (!shouldPersistLastOpenedWorkId(id)) return;

    if (isTauri) {
      await invokeTauri<void>("set_last_opened_work_id", { id });
      return;
    }

    browserStorage()?.setItem(LS_KEY, id);
  } catch {
    /* Preference persistence unavailable — ignore. */
  }
}

/**
 * Pick the work id to open at app start: prefer the last opened one if it's
 * still present in `works`, otherwise fall back to the newest work, otherwise
 * null. Pure — easy to unit-test.
 */
export function pickInitialWorkId(
  works: WorkDto[],
  lastOpened: string | null,
): string | null {
  if (works.length === 0) return null;
  if (lastOpened && works.some((w) => w.id === lastOpened)) return lastOpened;
  return works[0].id;
}

export function shouldPersistLastOpenedWorkId(id: string | null): id is string {
  return typeof id === "string" && id.trim().length > 0 && id !== "lobby";
}

export function isCurrentWorkConnection(
  active: WorkConnectionIdentity,
  incoming: WorkConnectionIdentity,
): boolean {
  return active.token === incoming.token && active.workId === incoming.workId;
}
