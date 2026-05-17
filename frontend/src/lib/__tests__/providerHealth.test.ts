import { afterEach, describe, expect, it, vi } from "vitest";

import { getProviderHealth, providerHealthUrl } from "../providerHealth";

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
      json: () => Promise.resolve({ connected: true, model: "local-model" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getProviderHealth()).resolves.toEqual({
      connected: true,
      model: "local-model",
    });
    expect(fetchMock).toHaveBeenCalledWith(providerHealthUrl());
  });

  it("fails on non-2xx provider health responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );

    await expect(getProviderHealth()).rejects.toThrow(
      "getProviderHealth failed: HTTP 503",
    );
  });
});
