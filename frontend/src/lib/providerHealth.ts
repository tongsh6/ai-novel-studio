// Contract: GET /api/provider/health
// Design: docs/design/tech-stack/05-desktop.md §5 (Tauri endpoint abstraction)

import { apiBaseUrl } from "./env";

export interface ProviderHealth {
  connected: boolean;
  /** 内部 provider id：只供诊断/兼容消费，作者可见面不得直接展示。 */
  provider?: string;
  /** 内部 model id：只供诊断/兼容消费，作者可见面不得直接展示。 */
  model?: string;
  /** 作者可读 provider 名（本地模型（测试环境）/OpenAI 等）。 */
  provider_display_name?: string | null;
  /** 作者可读模型名；模型名不可证时为 null（作者面显示一次中性的「当前模型」）。 */
  model_display_name?: string | null;
  message?: string;
  detail?: string;
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

/**
 * 作者面模型名：只消费 display 字段，**不回退内部 provider/model id**。
 * 缺失意味着「模型名不可证」，由调用方显示一次中性的「当前模型」。
 */
export function providerHealthName(health: Pick<ProviderHealth, "model_display_name">): string {
  return health.model_display_name ?? "";
}
