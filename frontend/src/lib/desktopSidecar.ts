// Design: docs/design/tech-stack/05-desktop.md §3（启动/就绪/退出）
// SU04：桌面 sidecar 启动状态只用于作者可读的失败恢复提示，不承载验收语义。
import { isTauri } from "./env";
import { WORKBENCH } from "./copy";

export type DesktopSidecarStatus = "starting" | "ready" | "failed" | "unknown";

export function normalizeSidecarStatus(value: unknown): DesktopSidecarStatus {
  return value === "starting" || value === "ready" || value === "failed" ? value : "unknown";
}

export function sidecarFailureGuidance(value: unknown): string | null {
  switch (normalizeSidecarStatus(value)) {
    case "starting":
      return WORKBENCH.desktopSidecarStarting;
    case "failed":
      return WORKBENCH.desktopSidecarFailed;
    default:
      return null;
  }
}

export async function readDesktopSidecarStatus(): Promise<DesktopSidecarStatus> {
  if (!isTauri) return "unknown";

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return normalizeSidecarStatus(await invoke<string>("get_sidecar_startup_status"));
  } catch {
    return "unknown";
  }
}
