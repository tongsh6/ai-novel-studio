// Design: tasks/slices/v3/VS-09-work-management.md §6 (frontend)
// Contract: backend GET /api/works / POST /api/works (NovelWeb.WorksController)
//
// 最小作品 API 客户端：list / create / lastOpened（localStorage）。

import { apiBaseUrl } from "./env";

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

export function getLastOpenedWorkId(): string | null {
  try {
    return window.localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

export function setLastOpenedWorkId(id: string): void {
  try {
    window.localStorage.setItem(LS_KEY, id);
  } catch {
    /* localStorage unavailable — ignore */
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
