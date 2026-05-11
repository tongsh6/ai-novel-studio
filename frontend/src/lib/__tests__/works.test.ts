// Regression for VS-09 work-management slice §6 frontend pure helper.
import { describe, expect, it } from "vitest";

import { pickInitialWorkId, type WorkDto } from "../works";

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
