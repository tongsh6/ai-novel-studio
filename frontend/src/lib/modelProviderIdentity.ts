// Frontend provider identity whitelist shared by provider settings and context-window commands.
// Backend Gateway remains the runtime provider registry; no model/window defaults here.
export type ProviderId =
  | "lmstudio"
  | "splash"
  | "strata"
  | "anthropic"
  | "deepseek"
  | "openai"
  | "openai_subscription"
  | "minimax"
  | "minimax_cn"
  | "zhipu"
  | "kimi"
  | "gemini";

export const PROVIDER_IDS: readonly ProviderId[] = [
  "lmstudio",
  "splash",
  "strata",
  "anthropic",
  "deepseek",
  "openai",
  "openai_subscription",
  "minimax",
  "minimax_cn",
  "zhipu",
  "kimi",
  "gemini",
] as const;
