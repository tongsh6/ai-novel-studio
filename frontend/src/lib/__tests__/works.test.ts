// Regression for VS-09 work-management slice §6 frontend pure helper.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getLastOpenedWorkId,
  pickInitialWorkId,
  setLastOpenedWorkId,
  type WorkDto,
} from "../works";

const work = (id: string): WorkDto => ({
  id,
  title: id,
  genre: null,
  status: "TENTATIVE",
  updated_at: null,
  inserted_at: null,
});

describe("pickInitialWorkId", () => {
  it("returns null when there are no works", () => {
    expect(pickInitialWorkId([], "anything")).toBeNull();
    expect(pickInitialWorkId([], null)).toBeNull();
  });

  it("returns lastOpened when it still exists", () => {
    const works = [work("a"), work("b"), work("c")];
    expect(pickInitialWorkId(works, "b")).toBe("b");
  });

  it("falls back to newest (works[0]) when lastOpened is missing", () => {
    const works = [work("newest"), work("middle"), work("oldest")];
    expect(pickInitialWorkId(works, null)).toBe("newest");
    expect(pickInitialWorkId(works, "deleted-id")).toBe("newest");
  });
});

describe("last opened work preference", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("uses browser storage only through the platform helper fallback", async () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => store.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          store.set(key, value);
        }),
      },
    });

    await setLastOpenedWorkId("work-42");

    expect(await getLastOpenedWorkId()).toBe("work-42");
  });

  it("falls back to null when preference storage is unavailable", async () => {
    expect(await getLastOpenedWorkId()).toBeNull();
    await expect(setLastOpenedWorkId("work-42")).resolves.toBeUndefined();
  });
});
