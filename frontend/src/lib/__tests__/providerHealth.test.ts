import { afterEach, describe, expect, it, vi } from "vitest";

import { getProviderHealth, providerHealthName, providerHealthUrl } from "../providerHealth";

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

  it("derives a display name from model first and provider second", () => {
    expect(providerHealthName({ provider: "lmstudio", model: "local-model" })).toBe("local-model");
    expect(providerHealthName({ provider: "stub" })).toBe("stub");
    expect(providerHealthName({})).toBe("");
  });
});
