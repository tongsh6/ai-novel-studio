import { apiBaseUrl } from "./env";

const BASE = apiBaseUrl;

export interface MemoryItem {
  id: string;
  work_id: string;
  volume_id?: string;
  arc_id?: string;
  chapter_id?: string;
  content: string;
  summary?: string;
  type: string;
  scope: string;
  status: string;
  source_type: string;
  source_id?: string;
  reference_count: number;
  weight: number;
  confidence: number;
  source_confidence: number;
  locked: boolean;
  recallable: boolean;
  common_sense: boolean;
  valid_from?: NarrativePosition;
  valid_until?: NarrativePosition;
  expire_condition?: string;
  version: number;
  tags?: string[];
  last_referenced_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface NarrativePosition {
  work_id: string;
  volume_id?: string;
  arc_id?: string;
  chapter_id?: string;
  scene_index?: number;
  narrative_layer?: string;
  timeline_node_id?: string;
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  count?: number;
}

export interface RecallResult {
  text: string;
  iron_law_count: number;
  candidate_count: number;
  estimated_tokens: number;
}

export interface ReferenceLog {
  id: string;
  memory_id: string;
  work_id: string;
  task_id?: string;
  conversation_id?: string;
  reference_scene: string;
  reference_reason?: string;
  inserted_at: string;
}

export interface SearchParams {
  type?: string;
  scope?: string;
  status?: string;
  source_type?: string;
  locked?: boolean;
  recallable?: boolean;
  keyword?: string;
  weight_min?: number;
  weight_max?: number;
  sort_by?: string;
  sort_dir?: string;
  limit?: number;
  offset?: number;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  return res.json() as Promise<ApiResponse<T>>;
}

export async function createMemory(
  workId: string,
  data: Partial<MemoryItem>,
): Promise<ApiResponse<MemoryItem>> {
  return request<MemoryItem>(`/api/works/${workId}/memories`, {
    method: "POST",
    body: JSON.stringify({ work_id: workId, ...data }),
  });
}

export async function listMemories(
  workId: string,
  params: SearchParams = {},
): Promise<ApiResponse<MemoryItem[]>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const query = qs.toString();
  return request<MemoryItem[]>(`/api/works/${workId}/memories${query ? `?${query}` : ""}`);
}

export async function getMemory(
  workId: string,
  memoryId: string,
): Promise<ApiResponse<MemoryItem>> {
  return request<MemoryItem>(`/api/works/${workId}/memories/${memoryId}`);
}

export async function confirmMemory(
  workId: string,
  memoryId: string,
): Promise<ApiResponse<MemoryItem>> {
  return request<MemoryItem>(`/api/works/${workId}/memories/${memoryId}/confirm`, {
    method: "POST",
  });
}

export async function lockMemory(
  workId: string,
  memoryId: string,
): Promise<ApiResponse<MemoryItem>> {
  return request<MemoryItem>(`/api/works/${workId}/memories/${memoryId}/lock`, { method: "POST" });
}

export async function unlockMemory(
  workId: string,
  memoryId: string,
): Promise<ApiResponse<MemoryItem>> {
  return request<MemoryItem>(`/api/works/${workId}/memories/${memoryId}/unlock`, {
    method: "POST",
  });
}

export async function deprecateMemory(
  workId: string,
  memoryId: string,
): Promise<ApiResponse<MemoryItem>> {
  return request<MemoryItem>(`/api/works/${workId}/memories/${memoryId}/deprecate`, {
    method: "POST",
  });
}

export async function archiveMemory(
  workId: string,
  memoryId: string,
): Promise<ApiResponse<MemoryItem>> {
  return request<MemoryItem>(`/api/works/${workId}/memories/${memoryId}/archive`, {
    method: "POST",
  });
}

export async function updateMemoryWeight(
  workId: string,
  memoryId: string,
  weight: number,
): Promise<ApiResponse<MemoryItem>> {
  return request<MemoryItem>(`/api/works/${workId}/memories/${memoryId}/weight`, {
    method: "PATCH",
    body: JSON.stringify({ weight }),
  });
}

export async function updateMemoryValidity(
  workId: string,
  memoryId: string,
  data: {
    valid_from?: NarrativePosition;
    valid_until?: NarrativePosition;
    expire_condition?: string;
  },
): Promise<ApiResponse<MemoryItem>> {
  return request<MemoryItem>(`/api/works/${workId}/memories/${memoryId}/validity`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function recallMemories(
  workId: string,
  params: {
    query?: string;
    scene?: string;
    token_budget?: number;
    scope?: string;
    prefer_types?: string[];
  } = {},
): Promise<ApiResponse<RecallResult>> {
  return request<RecallResult>(`/api/works/${workId}/memories/recall`, {
    method: "POST",
    body: JSON.stringify({ work_id: workId, ...params }),
  });
}

export async function getMemoryReferences(
  workId: string,
  memoryId: string,
): Promise<ApiResponse<ReferenceLog[]>> {
  return request<ReferenceLog[]>(`/api/works/${workId}/memories/${memoryId}/references`);
}
