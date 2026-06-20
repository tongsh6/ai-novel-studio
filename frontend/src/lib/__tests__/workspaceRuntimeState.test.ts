import { describe, expect, it } from "vitest";

import {
  deriveWorkspaceRuntimeState,
  getPendingAdoptionCount,
  getReadingProjectionStatus,
  getVisibleWorkTitle,
  isArtifactResolved,
  shouldShowDisconnectedBadge,
  shouldShowWelcomeMessage,
} from "../workspaceRuntimeState";

describe("WorkspaceRuntimeState", () => {
  it("uses valid work title as the visible title", () => {
    const state = deriveWorkspaceRuntimeState({
      work: { id: "work-1", title: "剑起长夜" },
    });

    expect(getVisibleWorkTitle(state)).toBe("剑起长夜");
    expect(state.work.status).toBe("ready");
  });

  it("normalizes invalid work titles to current work", () => {
    for (const title of [
      "",
      "无活跃作品",
      "作品加载失败",
      "未连接",
      "as_15",
      "artifact-123",
      "mock_work",
      "undefined",
      "null",
    ]) {
      const state = deriveWorkspaceRuntimeState({
        work: { id: "work-1", title },
      });

      expect(getVisibleWorkTitle(state)).toBe("当前作品");
    }
  });

  it("keeps the unnamed work title visible because it is a real persisted work name", () => {
    const state = deriveWorkspaceRuntimeState({
      work: { id: "work-1", title: "未命名作品" },
    });

    expect(getVisibleWorkTitle(state)).toBe("未命名作品");
  });

  it("does not show a disconnected badge when socket is connected and work is ready", () => {
    const state = deriveWorkspaceRuntimeState({
      connection: { connected: true },
      work: { id: "work-1", title: "真实作品" },
    });

    expect(state.connection.status).toBe("connected");
    expect(state.work.status).toBe("ready");
    expect(shouldShowDisconnectedBadge(state)).toBe(false);
    expect(state.ui.headerTitle).toBe("真实作品");
  });

  it("treats explicit socket false as disconnected instead of booting", () => {
    const state = deriveWorkspaceRuntimeState({
      connection: { connected: false },
      work: { id: "work-1", title: "真实作品" },
    });

    expect(state.connection.status).toBe("failed");
    expect(state.ui.connectionLabel).toBe("离线");
    expect(shouldShowDisconnectedBadge(state)).toBe(true);
  });

  it("keeps connection, work, and session failures separate", () => {
    const state = deriveWorkspaceRuntimeState({
      connection: { connected: true },
      work: { id: "work-1", title: "真实作品" },
      session: { id: "session-1", error: "resume failed" },
    });

    expect(state.connection.status).toBe("connected");
    expect(state.work.status).toBe("ready");
    expect(state.session.status).toBe("failed");
    expect(shouldShowDisconnectedBadge(state)).toBe(false);
  });

  it("does not show welcome after transcript has been restored", () => {
    const state = deriveWorkspaceRuntimeState({
      session: { id: "session-1", transcriptRestored: true },
      transcript: [],
    });

    expect(shouldShowWelcomeMessage(state)).toBe(false);
  });

  it("does not show welcome when transcript is non-empty", () => {
    const state = deriveWorkspaceRuntimeState({
      session: { id: "session-1" },
      transcript: [{ role: "assistant", text: "已有消息" }],
    });

    expect(shouldShowWelcomeMessage(state)).toBe(false);
  });

  it("shows welcome for a new empty active session", () => {
    const state = deriveWorkspaceRuntimeState({
      session: { id: "session-1" },
      transcript: [],
    });

    expect(shouldShowWelcomeMessage(state)).toBe(true);
  });

  it("excludes resolved artifacts from pending count", () => {
    const state = deriveWorkspaceRuntimeState({
      adoptionState: {
        pending: [
          { artifact_id: "artifact-1", adoption_status: "PENDING" },
          { artifact_id: "artifact-2", adoption_status: "PENDING" },
          { artifact_id: "artifact-1", adoption_status: "PENDING" },
        ],
        resolved: [{ artifact_id: "artifact-2", adoption_status: "ACCEPTED" }],
      },
    });

    expect(state.adoption.pendingArtifactIds).toEqual(["artifact-1"]);
    expect(getPendingAdoptionCount(state)).toBe(1);
    expect(isArtifactResolved(state, "artifact-2")).toBe(true);
  });

  it("treats accepted, discarded, and edited accepted artifacts as resolved", () => {
    const state = deriveWorkspaceRuntimeState({
      adoptionState: {
        pending: [
          { artifact_id: "accepted", adoption_status: "ACCEPTED" },
          { artifact_id: "discarded", adoption_status: "DISCARDED" },
          { artifact_id: "edited", adoption_status: "EDITED_ACCEPTED" },
          { artifact_id: "pending", adoption_status: "PENDING" },
        ],
        resolved: [],
      },
    });

    expect(state.adoption.resolvedArtifactIds.sort()).toEqual(["accepted", "discarded", "edited"]);
    expect(state.adoption.pendingArtifactIds).toEqual(["pending"]);
  });

  it("derives reading projection empty, ready, and failed states", () => {
    expect(
      getReadingProjectionStatus(
        deriveWorkspaceRuntimeState({
          readingProjection: { chapters: [] },
        }),
      ),
    ).toBe("empty");

    expect(
      getReadingProjectionStatus(
        deriveWorkspaceRuntimeState({
          readingProjection: { chapters: [{ id: "chapter-1" }] },
        }),
      ),
    ).toBe("ready");

    expect(
      getReadingProjectionStatus(
        deriveWorkspaceRuntimeState({
          readingProjection: { chapters: [], error: "boom" },
        }),
      ),
    ).toBe("failed");
  });

  it("keeps completed task state visible instead of collapsing it to idle", () => {
    const state = deriveWorkspaceRuntimeState({
      task: { status: "COMPLETED" },
    });

    expect(state.task.status).toBe("completed");
  });

  it("does not expose internal ids as visible work titles", () => {
    const state = deriveWorkspaceRuntimeState({
      work: {
        id: "work-1",
        title: "2d67fbb5-6c2e-4d8d-9f69-e9f4e31c7bb2",
      },
    });

    expect(getVisibleWorkTitle(state)).toBe("当前作品");
  });
});
