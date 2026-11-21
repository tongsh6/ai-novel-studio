// B85 desktop preference IPC boundary; runtime options integration stays in modelProvider.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";

describe("context-window desktop preferences", () => {
  afterEach(() => {
    vi.doUnmock("../env");
    vi.doUnmock("@tauri-apps/api/core");
    vi.resetModules();
    vi.unstubAllGlobals();
  });
  async function desktop() {
    vi.resetModules();
    vi.doMock("../env", () => ({ apiBaseUrl: "", isTauri: true }));
    const invoke = vi.fn();
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    return { api: await import("../modelContextWindow"), invoke };
  }
  it("patches one provider only and validates the returned saved identity", async () => {
    const { api, invoke } = await desktop();
    invoke.mockResolvedValue({ provider: "splash", saved_window: 64000 });
    await expect(api.setModelContextWindow("splash", 64000)).resolves.toEqual({
      provider: "splash",
      saved_window: 64000,
    });
    expect(invoke).toHaveBeenCalledWith("set_model_context_window", {
      provider: "splash",
      window: 64000,
    });
    invoke.mockResolvedValue({ provider: "deepseek", saved_window: 64000 });
    await expect(api.getModelContextWindow("splash")).rejects.toThrow();
    invoke.mockResolvedValue({ provider: "splash" });
    await expect(api.getModelContextWindow("splash")).rejects.toThrow();
  });
  it("clear is null, invalid input never dispatches, browser never stores", async () => {
    const { api, invoke } = await desktop();
    invoke.mockResolvedValue({ provider: "splash", saved_window: null });
    await api.setModelContextWindow("splash", null);
    expect(invoke).toHaveBeenCalledWith("set_model_context_window", {
      provider: "splash",
      window: null,
    });
    invoke.mockClear();
    for (const value of [0, -1, 1.5, 4294967296, NaN])
      await expect(api.setModelContextWindow("splash", value)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
    vi.resetModules();
    vi.doMock("../env", () => ({ apiBaseUrl: "", isTauri: false }));
    const browser = await import("../modelContextWindow");
    await expect(browser.setModelContextWindow("splash", 64000)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
