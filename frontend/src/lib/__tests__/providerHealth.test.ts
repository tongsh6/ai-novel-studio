import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getProviderHealth,
  providerHealthName,
  providerHealthUrl,
  type ProviderHealth,
} from "../providerHealth";

describe("provider health API client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds the provider health URL from the platform API base", () => {
    expect(providerHealthUrl("http://127.0.0.1:4657")).toBe(
      "http://127.0.0.1:4657/api/provider/health",
    );
    expect(providerHealthUrl("")).toBe("/api/provider/health");
  });

  it("fetches provider health through the shared endpoint helper", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ connected: true, provider: "lmstudio", model: "local-model" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getProviderHealth()).resolves.toEqual({
      connected: true,
      provider: "lmstudio",
      model: "local-model",
    });
    expect(fetchMock).toHaveBeenCalledWith(providerHealthUrl());
  });

  it("keeps disconnected provider message metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          connected: false,
          provider: "lmstudio",
          model: "local-model",
          message: "LLM 未连接：LM Studio 未启动",
          detail: "connection_refused",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getProviderHealth()).resolves.toEqual({
      connected: false,
      provider: "lmstudio",
      model: "local-model",
      message: "LLM 未连接：LM Studio 未启动",
      detail: "connection_refused",
    });
  });

  it("fails on non-2xx provider health responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(getProviderHealth()).rejects.toThrow("getProviderHealth failed: HTTP 503");
  });

  it("uses author-visible display fields only, never internal provider/model ids", () => {
    expect(providerHealthName({ model_display_name: "Qwen3.8" })).toBe("Qwen3.8");
    expect(providerHealthName({ model_display_name: null })).toBe("");
    // 内部 id 不参与作者面模型名推导。
    const internalIds: ProviderHealth = {
      connected: true,
      provider: "stub",
      model: "slice_verify",
      provider_display_name: "本地模型（测试环境）",
      model_display_name: null,
    };
    expect(providerHealthName(internalIds)).toBe("");
    expect(providerHealthName({})).toBe("");
  });
});
