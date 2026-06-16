// Regression for SU-03 model nickname: UI label preference only.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_ASSISTANT_DISPLAY_NAME,
  assistantRoleLabel,
  getAssistantDisplayName,
  normalizeAssistantDisplayName,
  resetAssistantDisplayName,
  resolveAssistantDisplayName,
  setAssistantDisplayName,
} from "../assistantDisplayName";

describe("assistant display name normalization", () => {
  it("falls back to the stable default for blank values", () => {
    expect(normalizeAssistantDisplayName("  ")).toBeNull();
    expect(resolveAssistantDisplayName("  ")).toBe(DEFAULT_ASSISTANT_DISPLAY_NAME);
  });

  it("trims and caps display names to 20 visible characters", () => {
    expect(normalizeAssistantDisplayName("  创作助手  ")).toBe("创作助手");
    expect(normalizeAssistantDisplayName("一二三四五六七八九十一二三四五六七八九十甲乙")).toBe(
      "一二三四五六七八九十一二三四五六七八九十",
    );
  });

  it("does not rewrite canonical roles, only labels assistant messages", () => {
    expect(assistantRoleLabel("user", "创作助手")).toBe("你");
    expect(assistantRoleLabel("assistant", "创作助手")).toBe("创作助手");
    expect(assistantRoleLabel("assistant", "")).toBe(DEFAULT_ASSISTANT_DISPLAY_NAME);
  });
});

describe("assistant display name browser preference", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("persists names per work in the platform fallback store", async () => {
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

    await setAssistantDisplayName("work-a", "创作助手");
    await setAssistantDisplayName("work-b", "编辑");

    expect(await getAssistantDisplayName("work-a")).toBe("创作助手");
    expect(await getAssistantDisplayName("work-b")).toBe("编辑");
  });

  it("resets blank names to the default without contaminating other works", async () => {
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

    await setAssistantDisplayName("work-a", "创作助手");
    await setAssistantDisplayName("work-b", "编辑");
    await resetAssistantDisplayName("work-a");

    expect(await getAssistantDisplayName("work-a")).toBe(DEFAULT_ASSISTANT_DISPLAY_NAME);
    expect(await getAssistantDisplayName("work-b")).toBe("编辑");
  });

  it("ignores fallback workspace ids", async () => {
    expect(await setAssistantDisplayName("lobby", "创作助手")).toBe(DEFAULT_ASSISTANT_DISPLAY_NAME);
    expect(await getAssistantDisplayName(null)).toBe(DEFAULT_ASSISTANT_DISPLAY_NAME);
  });
});
