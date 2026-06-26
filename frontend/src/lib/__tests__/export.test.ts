// Design: docs/design/ui/44-reading-mode.md §3
//
// 全书导出编排层测试：目录选择 + exportBook 透传。
import { describe, expect, it, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("pickExportDirectory", () => {
  it("returns null in non-Tauri environments", async () => {
    vi.doMock("../env", () => ({
      isTauri: false,
      apiBaseUrl: "",
      wsBaseUrl: "ws://localhost:4657/socket",
    }));

    const { pickExportDirectory } = await import("../export");
    const result = await pickExportDirectory();
    expect(result).toBeNull();
  });

  it("returns the selected directory in Tauri", async () => {
    const mockOpen = vi.fn().mockResolvedValue("/home/user/exports");
    vi.doMock("@tauri-apps/plugin-dialog", () => ({ open: mockOpen }));
    vi.doMock("../env", () => ({
      isTauri: true,
      apiBaseUrl: "",
      wsBaseUrl: "ws://localhost:4657/socket",
    }));

    const { pickExportDirectory } = await import("../export");
    const result = await pickExportDirectory();

    expect(result).toBe("/home/user/exports");
    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true, multiple: false }),
    );
  });

  it("returns null when the user cancels the dialog", async () => {
    const mockOpen = vi.fn().mockResolvedValue(null);
    vi.doMock("@tauri-apps/plugin-dialog", () => ({ open: mockOpen }));
    vi.doMock("../env", () => ({
      isTauri: true,
      apiBaseUrl: "",
      wsBaseUrl: "ws://localhost:4657/socket",
    }));

    const { pickExportDirectory } = await import("../export");
    const result = await pickExportDirectory();
    expect(result).toBeNull();
  });

  it("returns null when the dialog throws", async () => {
    const mockOpen = vi.fn().mockRejectedValue(new Error("dialog unavailable"));
    vi.doMock("@tauri-apps/plugin-dialog", () => ({ open: mockOpen }));
    vi.doMock("../env", () => ({
      isTauri: true,
      apiBaseUrl: "",
      wsBaseUrl: "ws://localhost:4657/socket",
    }));

    const { pickExportDirectory } = await import("../export");
    const result = await pickExportDirectory();
    expect(result).toBeNull();
  });
});

describe("exportBook", () => {
  it("calls exportWork with the provided options", async () => {
    const mockExportWork = vi.fn().mockResolvedValue({
      path: "/tmp/export.md",
      format: "markdown",
      work_title: "Test",
      chapter_count: 1,
      total_word_count: 100,
      exported_at: "2026-01-01T00:00:00Z",
    });
    vi.doMock("../socket", () => ({
      exportWork: mockExportWork,
    }));
    vi.doMock("../env", () => ({
      isTauri: true,
      apiBaseUrl: "",
      wsBaseUrl: "ws://localhost:4657/socket",
    }));

    const { exportBook } = await import("../export");
    const channel = { topic: "workspace:test" } as unknown as import("phoenix").Channel;
    const onProgress = vi.fn();

    const result = await exportBook(channel, "work-1", {
      exportDir: "/tmp/exports",
      onProgress,
    });

    expect(mockExportWork).toHaveBeenCalledWith(channel, "work-1", {
      exportDir: "/tmp/exports",
      onProgress,
    });
    expect(result.path).toBe("/tmp/export.md");
  });

  it("calls exportWork without exportDir when omitted", async () => {
    const mockExportWork = vi.fn().mockResolvedValue({
      path: "/tmp/export.md",
      format: "markdown",
      work_title: "Test",
      chapter_count: 1,
      total_word_count: 100,
      exported_at: "2026-01-01T00:00:00Z",
    });
    vi.doMock("../socket", () => ({
      exportWork: mockExportWork,
    }));
    vi.doMock("../env", () => ({
      isTauri: true,
      apiBaseUrl: "",
      wsBaseUrl: "ws://localhost:4657/socket",
    }));

    const { exportBook } = await import("../export");
    const channel = { topic: "workspace:test" } as unknown as import("phoenix").Channel;
    await exportBook(channel, "work-1");

    expect(mockExportWork).toHaveBeenCalledWith(channel, "work-1", {});
  });
});
