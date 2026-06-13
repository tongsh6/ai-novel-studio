/**
 * 环境检测 — 区分 Tauri 桌面环境与浏览器环境
 *
 * 规则来源：docs/design/tech-stack/05-desktop.md §5
 * 引用：AGENTS.md § 桌面优先（Desktop-First）
 *
 * 端口配置：见 frontend/.env（VITE_API_ENDPOINT, VITE_WS_ENDPOINT）
 * 以下硬编码仅作为 .env 缺失时的兜底，修改端口请改 .env
 */

function detectTauri(): boolean {
  if (typeof window === "undefined") return false;

  const candidate = window as unknown as Record<string, unknown>;
  return "__TAURI__" in candidate || "__TAURI_INTERNALS__" in candidate;
}

export const isTauri: boolean = detectTauri();

const DEFAULT_WS_HOST = "ws://localhost:4657/socket";

function configuredEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

const configuredApiEndpoint = configuredEnvValue(import.meta.env.VITE_API_ENDPOINT);
const configuredWsEndpoint = configuredEnvValue(import.meta.env.VITE_WS_ENDPOINT);

/**
 * API 基础 URL
 * 默认使用同源相对路径，由 Vite proxy 转发到 Phoenix。
 * 只有显式配置 VITE_API_ENDPOINT 时才跨源直连后端。
 */
export const apiBaseUrl: string = configuredApiEndpoint ?? "";

/**
 * WebSocket 基础 URL
 * - Tauri 桌面环境：直连 Phoenix（env 或默认 ws://localhost:4657/socket）
 * - 浏览器环境：空字符串，Phoenix.Socket 自动使用 window.location 拼接
 */
export const wsBaseUrl: string = isTauri
  ? (configuredWsEndpoint ?? DEFAULT_WS_HOST)
  : (configuredWsEndpoint ?? DEFAULT_WS_HOST);
