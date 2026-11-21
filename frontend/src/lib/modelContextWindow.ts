// B85: context-window runtime decoding and desktop preference commands.
// Design: desktop §6.1 / 46 §9.10. No store, default table, or provider switching.
import { isTauri } from "./env";
import { PROVIDER_IDS, type ProviderId } from "./modelProviderIdentity";

export interface ContextWindowRuntime {
  effective_tokens: number;
  default_tokens: number;
  source: "runtime_override" | "conservative_default";
}

export interface SavedContextWindow {
  provider: ProviderId;
  saved_window: number | null;
}

function validWindow(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 4294967295;
}

function readableRuntimeWindow(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function normalizeContextWindow(raw: unknown): ContextWindowRuntime | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as ContextWindowRuntime;
  if (
    !readableRuntimeWindow(value.effective_tokens) ||
    !readableRuntimeWindow(value.default_tokens)
  )
    return null;
  if (value.source !== "runtime_override" && value.source !== "conservative_default") return null;
  if (value.source === "conservative_default" && value.effective_tokens !== value.default_tokens)
    return null;
  return {
    effective_tokens: value.effective_tokens,
    default_tokens: value.default_tokens,
    source: value.source,
  };
}

function savedContextWindow(raw: unknown, provider: ProviderId): SavedContextWindow {
  if (!raw || typeof raw !== "object") throw new Error("Invalid saved context window");
  const value = raw as SavedContextWindow;
  if (
    value.provider !== provider ||
    (value.saved_window !== null && !validWindow(value.saved_window))
  ) {
    throw new Error("Invalid saved context window");
  }
  return { provider, saved_window: value.saved_window };
}

export async function getModelContextWindow(provider: ProviderId): Promise<SavedContextWindow> {
  if (!isTauri || !PROVIDER_IDS.includes(provider))
    throw new Error("Desktop context settings unavailable");
  return savedContextWindow(await invokeTauri("get_model_context_window", { provider }), provider);
}

export async function setModelContextWindow(
  provider: ProviderId,
  window: number | null,
): Promise<SavedContextWindow> {
  if (!isTauri || !PROVIDER_IDS.includes(provider))
    throw new Error("Desktop context settings unavailable");
  if (window !== null && !validWindow(window)) throw new Error("Invalid context window");
  return savedContextWindow(
    await invokeTauri("set_model_context_window", { provider, window }),
    provider,
  );
}

async function invokeTauri<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}
