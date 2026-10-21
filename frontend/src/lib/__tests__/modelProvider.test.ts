// Contract: docs/design/acceptance/system/SU-01-model-provider.md
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configureProvider,
  getProviderSecretStorageStatus,
  getProviderOptions,
  isLoopbackProviderEndpoint,
  isValidProviderEndpoint,
  listProviderLocalModels,
  listProviderModels,
  saveAndApplyModelProviderConfig,
  testProviderConnection,
  normalizePurposeModels,
} from "../modelProvider";

function installLocalStorage() {
  const store = new Map<string, string>();

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
    },
  });

  return store;
}

function providerOptionsBody(currentProvider = "stub") {
  return {
    current_provider: currentProvider,
    providers: [
      {
        id: "stub",
        label: "Stub",
        current: currentProvider === "stub",
        model: null,
        endpoint: null,
        requires_api_key: false,
        supports_api_key: false,
        supports_endpoint: false,
        supports_thinking: false,
        api_key_configured: false,
      },
      {
        id: "deepseek",
        label: "DeepSeek",
        current: currentProvider === "deepseek",
        model: "deepseek-v4-flash",
        endpoint: "https://api.deepseek.com",
        requires_api_key: true,
        supports_api_key: true,
        supports_endpoint: true,
        supports_thinking: true,
        api_key_configured: true,
      },
    ],
  };
}

function parseJsonBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== "string") {
    throw new Error("expected JSON string request body");
  }

  return JSON.parse(init.body) as Record<string, unknown>;
}

describe("model provider API client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("validates optional provider endpoints as absolute http(s) URLs", () => {
    expect(isValidProviderEndpoint("")).toBe(true);
    expect(isValidProviderEndpoint("   ")).toBe(true);
    expect(isValidProviderEndpoint("https://api.deepseek.com")).toBe(true);
    expect(isValidProviderEndpoint("http://127.0.0.1:1234/v1")).toBe(true);

    expect(isValidProviderEndpoint("localhost:1234/v1")).toBe(false);
    expect(isValidProviderEndpoint("ftp://example.com/v1")).toBe(false);
    expect(isValidProviderEndpoint("not a url")).toBe(false);
  });

  it("reports browser fallback secret storage as runtime-only", async () => {
    await expect(getProviderSecretStorageStatus()).resolves.toEqual({
      available: true,
      kind: "browser_memory",
      platform: "browser",
    });
  });

  it("normalizes local file secret storage reported by the Tauri shell", async () => {
    vi.resetModules();
    vi.doMock("../env", () => ({
      apiBaseUrl: "http://127.0.0.1:4657",
      isTauri: true,
    }));
    vi.doMock("@tauri-apps/api/core", () => ({
      invoke: vi.fn().mockResolvedValue({
        available: true,
        kind: "local_file",
        platform: "darwin",
      }),
    }));

    const { getProviderSecretStorageStatus: getStatus } = await import("../modelProvider");

    await expect(getStatus()).resolves.toEqual({
      available: true,
      kind: "local_file",
      platform: "darwin",
    });
  });

  it("normalizes provider options and filters duplicate provider ids", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            current_provider: "deepseek",
            providers: [
              ...providerOptionsBody("deepseek").providers,
              {
                id: "deepseek",
                label: "Duplicate",
                current: false,
                model: "ignored",
                endpoint: null,
                requires_api_key: true,
                supports_api_key: true,
                supports_endpoint: true,
                supports_thinking: true,
                api_key_configured: false,
              },
              {
                id: "slice_verify",
                label: "Slice Verify",
                current: true,
                model: null,
                endpoint: null,
                requires_api_key: false,
                supports_api_key: false,
                supports_endpoint: false,
                supports_thinking: false,
                api_key_configured: false,
              },
            ],
          }),
      }),
    );

    await expect(getProviderOptions()).resolves.toMatchObject({
      current_provider: "deepseek",
      providers: [
        { id: "stub", api_key_configured: false },
        { id: "deepseek", model: "deepseek-v4-flash", api_key_configured: true },
      ],
    });
  });

  it("preserves the OpenAI-compatible vendor matrix from the backend registry", async () => {
    const matrix = [
      "openai",
      "openai_subscription",
      "minimax",
      "minimax_cn",
      "zhipu",
      "kimi",
      "gemini",
    ] as const;

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              current_provider: "openai",
              providers: matrix.map((id) => ({
                id,
                label: id,
                current: id === "openai",
                model: null,
                endpoint: null,
                requires_api_key: true,
                supports_api_key: true,
                supports_endpoint: true,
                supports_thinking: false,
                api_key_configured: false,
              })),
            }),
        }),
      ),
    );

    const options = await getProviderOptions();
    expect(options.current_provider).toBe("openai");
    expect(options.providers.map((option) => option.id)).toEqual([...matrix]);
  });

  it("keeps the local strata provider from the backend registry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            current_provider: "strata",
            providers: [
              {
                id: "strata",
                label: "Strata",
                current: true,
                model: "strata-local",
                endpoint: "http://127.0.0.1:8081/v1",
                requires_api_key: false,
                supports_api_key: true,
                supports_endpoint: true,
                supports_thinking: false,
                api_key_configured: false,
              },
            ],
          }),
      }),
    );

    await expect(getProviderOptions()).resolves.toMatchObject({
      current_provider: "strata",
      providers: [
        {
          id: "strata",
          label: "Strata",
          model: "strata-local",
          endpoint: "http://127.0.0.1:8081/v1",
          requires_api_key: false,
          supports_api_key: true,
        },
      ],
    });
  });

  it("sends provider config to the backend using the runtime contract", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(parseJsonBody(init));
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, provider: "deepseek", model: "deepseek-v4-pro" }),
        });
      }),
    );

    await configureProvider({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      endpoint: "https://api.deepseek.com/v1",
      apiKey: "secret",
      clearApiKey: false,
      thinking: "enabled",
      reasoningEffort: "medium",
    });

    expect(bodies).toEqual([
      {
        provider: "deepseek",
        model: "deepseek-v4-pro",
        endpoint: "https://api.deepseek.com/v1",
        api_key: "secret",
        clear_api_key: false,
        thinking: "enabled",
        reasoning_effort: "medium",
        purpose_models: null,
      },
    ]);
  });

  it("sends whitelisted per-purpose model overrides and drops unknown or empty entries", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(parseJsonBody(init));
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, provider: "lmstudio", model: "m-global" }),
        });
      }),
    );

    await configureProvider({
      provider: "lmstudio",
      model: "m-global",
      purposeModels: {
        writer: " m-writer ",
        planner: "",
        bogus: "m-x",
      },
    });

    expect(bodies[0].purpose_models).toEqual({ writer: "m-writer" });
  });

  it("normalizes stored purpose overrides against the route-key whitelist", () => {
    expect(normalizePurposeModels({ writer: "m-w", bogus: "x", evaluator: "  " })).toEqual({
      writer: "m-w",
    });
    expect(normalizePurposeModels(null)).toBeNull();
    expect(normalizePurposeModels({})).toBeNull();
  });

  it("tests provider config without requiring a save first", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: false,
          connected: false,
          provider: "deepseek",
          model: "deepseek-v4-flash",
          message: "连接不可用",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      testProviderConnection({ provider: "deepseek", clearApiKey: true }),
    ).resolves.toMatchObject({ ok: false, connected: false });

    expect(parseJsonBody(fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)).toMatchObject({
      provider: "deepseek",
      clear_api_key: true,
    });
  });

  it("loads live provider models through the backend contract", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            provider: "deepseek",
            models: [
              { id: "deepseek-chat", label: "DeepSeek Chat", owned_by: "deepseek" },
              { id: "deepseek-chat", label: "duplicate", owned_by: "deepseek" },
              { id: "deepseek-reasoner", label: null, owned_by: "deepseek" },
            ],
          }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listProviderModels({
        provider: "deepseek",
        endpoint: "https://api.deepseek.com",
        apiKey: "secret",
      }),
    ).resolves.toMatchObject({
      ok: true,
      provider: "deepseek",
      models: [
        { id: "deepseek-chat", label: "DeepSeek Chat", owned_by: "deepseek" },
        { id: "deepseek-reasoner", label: "deepseek-reasoner", owned_by: "deepseek" },
      ],
    });

    const requestUrl = fetchMock.mock.calls[0]?.[0];
    if (typeof requestUrl !== "string") throw new Error("expected request URL string");

    expect(requestUrl).toContain("/api/provider/models");
    expect(parseJsonBody(fetchMock.mock.calls[0]?.[1])).toMatchObject({
      provider: "deepseek",
      endpoint: "https://api.deepseek.com",
      api_key: "secret",
    });
  });

  it("stores non-secret preferences and clears browser fallback api keys", async () => {
    const store = installLocalStorage();
    const bodies: Record<string, unknown>[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT") {
          bodies.push(parseJsonBody(init));
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ ok: true, provider: "deepseek", model: "deepseek-v4-pro" }),
          });
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(providerOptionsBody("deepseek")),
        });
      }),
    );

    await saveAndApplyModelProviderConfig({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      endpoint: "https://api.deepseek.com",
      apiKey: "secret",
      thinking: "enabled",
      reasoningEffort: "medium",
    });

    expect(store.get("ans.modelProviderSettings")).toContain('"api_key_configured":true');
    expect(store.get("ans.modelProviderSettings")).not.toContain("secret");
    expect(bodies[0]).toMatchObject({ api_key: "secret", clear_api_key: false });

    await saveAndApplyModelProviderConfig({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      endpoint: "https://api.deepseek.com",
      clearApiKey: true,
    });

    expect(store.get("ans.modelProviderSettings")).toContain('"api_key_configured":false');
    expect(bodies[1]).toMatchObject({ api_key: null, clear_api_key: true });
  });
});

// Contract: tasks/slices/SU01-strata-local-models.md §4（本机 Strata 模型发现）
describe("provider local model discovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("requests local models from the provider discovery endpoint", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            provider: "strata",
            models: [
              {
                id: "qwen3.8-flash-next-iq3_s",
                label: "qwen3.8-flash-next-iq3_s",
                endpoint: "http://127.0.0.1:8082/v1",
                host: "127.0.0.1",
                port: 8082,
                running: false,
                config: "strata-iq3_s.json",
              },
            ],
          }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listProviderLocalModels("strata");

    expect(result).toMatchObject({
      ok: true,
      provider: "strata",
      models: [
        {
          id: "qwen3.8-flash-next-iq3_s",
          endpoint: "http://127.0.0.1:8082/v1",
          port: 8082,
          running: false,
          config: "strata-iq3_s.json",
        },
      ],
    });

    const requestUrl = fetchMock.mock.calls[0]?.[0];
    if (typeof requestUrl !== "string") throw new Error("expected request URL string");
    expect(requestUrl).toContain("/api/provider/local-models?provider=strata");
    expect(fetchMock.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("normalizes local model entries and drops unusable or duplicate profiles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            provider: "strata",
            models: [
              {
                id: "qwen3.8-flash-next-iq3_s",
                label: "qwen3.8-flash-next-iq3_s",
                endpoint: "http://127.0.0.1:8082/v1",
                host: "127.0.0.1",
                port: 8082,
                running: true,
                config: "strata-iq3_s.json",
              },
              {
                id: "qwen3.8-flash-next-iq3_s",
                label: "duplicate profile",
                endpoint: "http://127.0.0.1:9999/v1",
                host: "127.0.0.1",
                port: 9999,
                running: false,
                config: "duplicate.json",
              },
              {
                id: "  ",
                label: "missing id",
                endpoint: "http://127.0.0.1:8080/v1",
              },
              {
                id: "missing-endpoint",
                label: "missing endpoint",
                endpoint: "   ",
              },
              {
                id: " qwen3.8-flash-next-q2_0 ",
                label: "",
                endpoint: " http://127.0.0.1:8081/v1 ",
                host: "",
                port: 70000,
                running: false,
                config: "  ",
              },
            ],
          }),
      }),
    );

    const result = await listProviderLocalModels("strata");

    expect(result.models).toHaveLength(2);
    expect(result.models[0]).toMatchObject({
      id: "qwen3.8-flash-next-iq3_s",
      label: "qwen3.8-flash-next-iq3_s",
      endpoint: "http://127.0.0.1:8082/v1",
      port: 8082,
      running: true,
      config: "strata-iq3_s.json",
    });
    expect(result.models[1]).toEqual({
      id: "qwen3.8-flash-next-q2_0",
      label: "qwen3.8-flash-next-q2_0",
      endpoint: "http://127.0.0.1:8081/v1",
      host: "127.0.0.1",
      port: null,
      running: false,
      config: null,
    });
  });

  it("surfaces the backend discovery failure message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: () =>
          Promise.resolve({
            ok: false,
            provider: "missing",
            models: [],
            message: "unknown provider",
            detail: 'provider "missing" is not registered',
          }),
      }),
    );

    await expect(listProviderLocalModels("strata")).rejects.toThrow("unknown provider");
  });

  it("falls back to an HTTP status message when discovery has no message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      }),
    );

    await expect(listProviderLocalModels("strata")).rejects.toThrow(
      "listProviderLocalModels failed: HTTP 500",
    );
  });

  it("recognizes only loopback provider endpoints", () => {
    expect(isLoopbackProviderEndpoint("http://127.0.0.1:8081/v1")).toBe(true);
    expect(isLoopbackProviderEndpoint("http://localhost:8082/v1")).toBe(true);
    expect(isLoopbackProviderEndpoint("https://LOCALHOST/v1")).toBe(true);
    expect(isLoopbackProviderEndpoint("http://[::1]:8082/v1")).toBe(true);

    expect(isLoopbackProviderEndpoint("")).toBe(false);
    expect(isLoopbackProviderEndpoint("   ")).toBe(false);
    expect(isLoopbackProviderEndpoint("https://api.deepseek.com")).toBe(false);
    expect(isLoopbackProviderEndpoint("http://192.168.1.9:8081/v1")).toBe(false);
    expect(isLoopbackProviderEndpoint("http://127.0.0.1.example.com/v1")).toBe(false);
    expect(isLoopbackProviderEndpoint("localhost:8081/v1")).toBe(false);
    expect(isLoopbackProviderEndpoint("ftp://127.0.0.1/v1")).toBe(false);
    expect(isLoopbackProviderEndpoint("not a url")).toBe(false);
  });
});
