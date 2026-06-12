import { afterEach, describe, expect, it, vi } from "vitest";

describe("Tauri environment detection", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
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

  it("uses same-origin API paths when Tauri endpoint env values are blank", async () => {
    vi.stubEnv("VITE_API_ENDPOINT", "");
    vi.stubEnv("VITE_WS_ENDPOINT", " ");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });

    const env = await import("../env");

    expect(env.isTauri).toBe(true);
    expect(env.apiBaseUrl).toBe("");
    expect(env.wsBaseUrl).toBe("ws://localhost:4657/socket");
  });

  it("uses explicit Tauri API and socket endpoints only when configured", async () => {
    vi.stubEnv("VITE_API_ENDPOINT", "http://127.0.0.1:4658");
    vi.stubEnv("VITE_WS_ENDPOINT", "ws://127.0.0.1:4658/socket");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });

    const env = await import("../env");

    expect(env.apiBaseUrl).toBe("http://127.0.0.1:4658");
    expect(env.wsBaseUrl).toBe("ws://127.0.0.1:4658/socket");
  });
});
