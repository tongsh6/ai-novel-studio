/**
 * 环境检测 — 区分 Tauri 桌面环境与浏览器环境
 *
 * 规则来源：docs/design-v2/tech-stack/05-desktop.md §5
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

const DEFAULT_API_HOST = "http://localhost:4657";
const DEFAULT_WS_HOST = "ws://localhost:4657/socket";

/**
 * API 基础 URL
 * Tauri 桌面环境：sidecar Phoenix server
 * 浏览器环境：由 VITE_API_ENDPOINT 环境变量注入
 */
export const apiBaseUrl: string = isTauri
  ? (import.meta.env.VITE_API_ENDPOINT ?? DEFAULT_API_HOST)
  : (import.meta.env.VITE_API_ENDPOINT as string) ?? "";

/**
 * WebSocket 基础 URL
 * Tauri 桌面环境：sidecar Phoenix server
 * 浏览器环境：由 VITE_WS_ENDPOINT 环境变量注入
 */
/**
 * WebSocket 基础 URL
 * - Tauri 桌面环境：直连 Phoenix（env 或默认 ws://localhost:4657/socket）
 * - 浏览器环境：空字符串，Phoenix.Socket 自动使用 window.location 拼接
 */
export const wsBaseUrl: string = isTauri
  ? (import.meta.env.VITE_WS_ENDPOINT as string) || DEFAULT_WS_HOST
  : (import.meta.env.VITE_WS_ENDPOINT as string) || DEFAULT_WS_HOST;
