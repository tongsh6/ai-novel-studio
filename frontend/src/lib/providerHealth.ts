// Contract: GET /api/provider/health
// Design: docs/design/tech-stack/05-desktop.md §5 (Tauri endpoint abstraction)

import { apiBaseUrl } from "./env";

export interface ProviderHealth {
  connected: boolean;
  provider?: string;
  model?: string;
  message?: string;
}

const PROVIDER_HEALTH_PATH = "/api/provider/health";

export function providerHealthUrl(baseUrl = apiBaseUrl): string {
  return `${baseUrl}${PROVIDER_HEALTH_PATH}`;
}

export async function getProviderHealth(): Promise<ProviderHealth> {
  const res = await fetch(providerHealthUrl());
  if (!res.ok) throw new Error(`getProviderHealth failed: HTTP ${res.status}`);
  return (await res.json()) as ProviderHealth;
}

export function providerHealthName(health: Pick<ProviderHealth, "provider" | "model">): string {
  if (health.model) return health.model;
  if (health.provider) return health.provider;
  return "";
}
