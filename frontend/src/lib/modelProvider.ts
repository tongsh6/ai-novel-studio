// Contract: docs/design/acceptance/system/SU-01-model-provider.md
// Design: docs/design/ui/41-workbench-layout.md §4.2
//
// Provider settings are split deliberately:
// - backend runtime config is in-memory only;
// - non-secret desktop preferences live in Tauri app config;
// - API keys live in macOS Keychain via Tauri commands.

import { apiBaseUrl, isTauri } from "./env";

export type ProviderId = "stub" | "lmstudio" | "anthropic" | "deepseek";

export interface ProviderOption {
  id: ProviderId;
  label: string;
  current: boolean;
  model: string | null;
  endpoint: string | null;
  requires_api_key: boolean;
  supports_api_key: boolean;
  supports_endpoint: boolean;
  supports_thinking: boolean;
  api_key_configured: boolean;
}

export interface ProviderOptionsResponse {
  current_provider: ProviderId;
  providers: ProviderOption[];
}

export interface ProviderModelOption {
  id: string;
  label: string;
  owned_by: string | null;
}

export interface ProviderModelsResponse {
  ok: boolean;
  provider: ProviderId;
  models: ProviderModelOption[];
  message?: string;
  detail?: string;
}

export interface StoredProviderPreference {
  model?: string | null;
  endpoint?: string | null;
  thinking?: "enabled" | "disabled" | null;
  reasoning_effort?: string | null;
  api_key_configured?: boolean;
}

export interface StoredProviderSettings {
  selected_provider?: ProviderId | null;
  providers: Record<string, StoredProviderPreference>;
}

export interface ProviderConfigInput {
  provider: ProviderId;
  model?: string | null;
  endpoint?: string | null;
  apiKey?: string | null;
  clearApiKey?: boolean;
  thinking?: "enabled" | "disabled" | null;
  reasoningEffort?: string | null;
}

export interface ProviderConnectionResult {
  ok: boolean;
  connected?: boolean;
  provider: ProviderId;
  model?: string | null;
  message?: string;
  detail?: string;
}

export interface ModelProviderRuntimeState {
  options: ProviderOptionsResponse;
  stored: StoredProviderSettings;
  selectedProvider: ProviderId;
}

const SETTINGS_STORAGE_KEY = "ans.modelProviderSettings";
const PROVIDER_OPTIONS_PATH = "/api/provider/options";
const PROVIDER_MODELS_PATH = "/api/provider/models";
const PROVIDER_CONFIG_PATH = "/api/provider/config";
const PROVIDER_TEST_PATH = "/api/provider/test";

const inMemoryApiKeys: Partial<Record<ProviderId, string>> = {};

function url(path: string): string {
  return `${apiBaseUrl}${path}`;
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export async function getProviderOptions(): Promise<ProviderOptionsResponse> {
  const res = await fetch(url(PROVIDER_OPTIONS_PATH));
  if (!res.ok) throw new Error(`getProviderOptions failed: HTTP ${res.status}`);
  return normalizeProviderOptions((await res.json()) as ProviderOptionsResponse);
}

export async function configureProvider(
  input: ProviderConfigInput,
): Promise<ProviderConnectionResult> {
  const res = await fetch(url(PROVIDER_CONFIG_PATH), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toBackendPayload(input)),
  });

  const body = (await res.json()) as ProviderConnectionResult;
  if (!res.ok) throw new Error(body.message || `configureProvider failed: HTTP ${res.status}`);
  return body;
}

export async function listProviderModels(
  input: ProviderConfigInput,
): Promise<ProviderModelsResponse> {
  const res = await fetch(url(PROVIDER_MODELS_PATH), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toBackendPayload(input)),
  });

  const body = normalizeProviderModels((await res.json()) as ProviderModelsResponse);
  if (!res.ok) throw new Error(body.message || `listProviderModels failed: HTTP ${res.status}`);
  return body;
}

export async function testProviderConnection(
  input: ProviderConfigInput,
): Promise<ProviderConnectionResult> {
  const res = await fetch(url(PROVIDER_TEST_PATH), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toBackendPayload(input)),
  });

  const body = (await res.json()) as ProviderConnectionResult;
  if (!res.ok) throw new Error(body.message || `testProviderConnection failed: HTTP ${res.status}`);
  return body;
}

export async function getStoredProviderSettings(): Promise<StoredProviderSettings> {
  if (isTauri) {
    return normalizeStoredSettings(
      await invokeTauri<StoredProviderSettings>("get_model_provider_settings"),
    );
  }

  return readBrowserSettings();
}

export async function saveStoredProviderSettings(
  input: ProviderConfigInput,
): Promise<StoredProviderSettings> {
  if (isTauri) {
    return normalizeStoredSettings(
      await invokeTauri<StoredProviderSettings>("set_model_provider_settings", {
        input: {
          selectedProvider: input.provider,
          provider: input.provider,
          model: normalizeOptionalText(input.model),
          endpoint: normalizeOptionalText(input.endpoint),
          thinking: input.thinking ?? null,
          reasoningEffort: normalizeOptionalText(input.reasoningEffort),
          apiKey: normalizeOptionalText(input.apiKey),
          clearApiKey: input.clearApiKey ?? false,
        },
      }),
    );
  }

  const settings = readBrowserSettings();
  settings.selected_provider = input.provider;
  settings.providers[input.provider] = {
    model: normalizeOptionalText(input.model),
    endpoint: normalizeOptionalText(input.endpoint),
    thinking: input.thinking ?? null,
    reasoning_effort: normalizeOptionalText(input.reasoningEffort),
    api_key_configured: Boolean(normalizeOptionalText(input.apiKey)),
  };

  const key = normalizeOptionalText(input.apiKey);
  if (input.clearApiKey) {
    delete inMemoryApiKeys[input.provider];
  } else if (key) {
    inMemoryApiKeys[input.provider] = key;
  }

  writeBrowserSettings(settings);
  return settings;
}

export async function getStoredProviderApiKey(provider: ProviderId): Promise<string | null> {
  if (isTauri) {
    return await invokeTauri<string | null>("get_model_provider_api_key", { provider });
  }

  return inMemoryApiKeys[provider] ?? null;
}

export async function loadAndSyncModelProviderState(): Promise<ModelProviderRuntimeState> {
  const [options, stored] = await Promise.all([getProviderOptions(), getStoredProviderSettings()]);

  const selectedProvider = stored.selected_provider ?? options.current_provider;
  const preference = stored.providers[selectedProvider] ?? {};

  if (stored.selected_provider) {
    await configureProvider({
      provider: selectedProvider,
      model: preference.model ?? providerOption(options, selectedProvider)?.model ?? null,
      endpoint: preference.endpoint ?? providerOption(options, selectedProvider)?.endpoint ?? null,
      thinking: preference.thinking ?? null,
      reasoningEffort: preference.reasoning_effort ?? null,
      apiKey: await getStoredProviderApiKey(selectedProvider),
    });
  }

  return {
    options: await getProviderOptions(),
    stored,
    selectedProvider,
  };
}

export async function saveAndApplyModelProviderConfig(
  input: ProviderConfigInput,
): Promise<ModelProviderRuntimeState> {
  const stored = await saveStoredProviderSettings(input);
  const apiKey = input.clearApiKey ? null : await getStoredProviderApiKey(input.provider);

  await configureProvider({
    ...input,
    apiKey: apiKey ?? input.apiKey ?? null,
  });

  return {
    options: await getProviderOptions(),
    stored,
    selectedProvider: input.provider,
  };
}

export function providerOption(
  options: ProviderOptionsResponse,
  provider: ProviderId,
): ProviderOption | undefined {
  return options.providers.find((option) => option.id === provider);
}

export function providerDisplayName(option: Pick<ProviderOption, "label" | "model">): string {
  return option.model ? `${option.label} · ${option.model}` : option.label;
}

export function providerNeedsApiKey(option: Pick<ProviderOption, "requires_api_key">): boolean {
  return option.requires_api_key;
}

function toBackendPayload(input: ProviderConfigInput): Record<string, unknown> {
  return {
    provider: input.provider,
    model: normalizeOptionalText(input.model),
    endpoint: normalizeOptionalText(input.endpoint),
    api_key: normalizeOptionalText(input.apiKey),
    clear_api_key: input.clearApiKey ?? false,
    thinking: input.thinking ?? null,
    reasoning_effort: normalizeOptionalText(input.reasoningEffort),
  };
}

function normalizeProviderOptions(raw: ProviderOptionsResponse): ProviderOptionsResponse {
  return {
    current_provider: normalizeProviderId(raw.current_provider) ?? "stub",
    providers: (raw.providers ?? [])
      .flatMap((option) => {
        const id = normalizeProviderId(option.id);
        if (!id) return [];

        return [
          {
            ...option,
            id,
            model: normalizeOptionalText(option.model),
            endpoint: normalizeOptionalText(option.endpoint),
            api_key_configured: Boolean(option.api_key_configured),
          },
        ];
      })
      .filter((option, index, all) => all.findIndex((item) => item.id === option.id) === index),
  };
}

function normalizeProviderModels(raw: ProviderModelsResponse): ProviderModelsResponse {
  return {
    ok: Boolean(raw.ok),
    provider: normalizeProviderId(raw.provider) ?? "stub",
    models: (raw.models ?? [])
      .flatMap((model) => {
        const id = normalizeOptionalText(model.id);
        if (!id) return [];

        return [
          {
            id,
            label: normalizeOptionalText(model.label) ?? id,
            owned_by: normalizeOptionalText(model.owned_by),
          },
        ];
      })
      .filter((model, index, all) => all.findIndex((item) => item.id === model.id) === index),
    message: normalizeOptionalText(raw.message) ?? undefined,
    detail: normalizeOptionalText(raw.detail) ?? undefined,
  };
}

function normalizeStoredSettings(raw: StoredProviderSettings): StoredProviderSettings {
  const selectedProvider = normalizeProviderId(raw.selected_provider);
  const providers: Record<string, StoredProviderPreference> = {};

  for (const [provider, preference] of Object.entries(raw.providers ?? {})) {
    const providerId = normalizeProviderId(provider);
    if (!providerId) continue;

    providers[providerId] = {
      model: normalizeOptionalText(preference.model),
      endpoint: normalizeOptionalText(preference.endpoint),
      thinking: normalizeThinking(preference.thinking),
      reasoning_effort: normalizeOptionalText(preference.reasoning_effort),
      api_key_configured: Boolean(preference.api_key_configured),
    };
  }

  return { selected_provider: selectedProvider, providers };
}

function normalizeProviderId(value: unknown): ProviderId | null {
  return value === "stub" || value === "lmstudio" || value === "anthropic" || value === "deepseek"
    ? value
    : null;
}

function normalizeThinking(value: unknown): "enabled" | "disabled" | null {
  return value === "enabled" || value === "disabled" ? value : null;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBrowserSettings(): StoredProviderSettings {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { selected_provider: null, providers: {} };
    return normalizeStoredSettings(JSON.parse(raw) as StoredProviderSettings);
  } catch {
    return { selected_provider: null, providers: {} };
  }
}

function writeBrowserSettings(settings: StoredProviderSettings): void {
  try {
    globalThis.localStorage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* Browser fallback persistence unavailable. */
  }
}
