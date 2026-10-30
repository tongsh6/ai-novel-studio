import { afterEach, describe, expect, it, vi } from "vitest";

import { LedgerThreadsContractError, parseLedgerThreads } from "../ledgerThreadsWire";

const emptyThreads = {
  arc: [],
  conflict: [],
  promise: [],
  information: [],
  emotion_curve: [],
};

describe("ledger_threads wire (VS-00F B06)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("合法空账通过（五组空数组不是读取失败）", () => {
    expect(parseLedgerThreads(emptyThreads)).toBe(emptyThreads);
  });

  it("合法条目通过，ledger 枚举受校验", () => {
    const payload = {
      ...emptyThreads,
      arc: [
        {
          id: "entry_1",
          ledger: "arc",
          subject_label: "凌渊",
          status: "ON_TRACK",
          payload: { last_seen_seq: 3 },
          source_refs: ["chapter_summary:ch_3"],
          last_event_chapter: "ch-3",
        },
      ],
    };
    expect(parseLedgerThreads(payload).arc).toHaveLength(1);
  });

  it("历史条目缺 payload/source_refs/last_event 仍可读（optional 兼容）", () => {
    const payload = {
      ...emptyThreads,
      information: [
        {
          id: "legacy_entry",
          ledger: "information",
          subject_label: "旧信息账",
          status: "HIDDEN",
        },
      ],
    };
    expect(parseLedgerThreads(payload).information[0]?.id).toBe("legacy_entry");
  });

  it("未知 ledger 显式失败，不伪装成空账", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const payload = {
      ...emptyThreads,
      arc: [{ id: "e1", ledger: "budget", subject_label: "x", status: "ON_TRACK" }],
    };
    expect(() => parseLedgerThreads(payload)).toThrow(LedgerThreadsContractError);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("缺五账分组/非对象显式失败", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => parseLedgerThreads({ arc: [] })).toThrow(LedgerThreadsContractError);
    expect(() => parseLedgerThreads(null)).toThrow(LedgerThreadsContractError);
  });
});
