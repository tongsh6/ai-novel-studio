// Contract: docs/design/acceptance/system/SU-01-model-provider.md
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configureProvider,
  getProviderOptions,
  listProviderModels,
  saveAndApplyModelProviderConfig,
  testProviderConnection,
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
      },
    ]);
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
