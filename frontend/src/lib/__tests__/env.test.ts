import { afterEach, describe, expect, it, vi } from "vitest";

describe("Tauri environment detection", () => {
  afterEach(() => {
    vi.resetModules();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("detects Tauri 2 internals global", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });

    const env = await import("../env");

    expect(env.isTauri).toBe(true);
  });

  it("does not detect a plain browser window as Tauri", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });

    const env = await import("../env");

    expect(env.isTauri).toBe(false);
  });
});
