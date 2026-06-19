import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWorkSession,
  createSessionPath,
  archiveSessionPath,
  sessionSnapshotPath,
  resumeSessionPath,
  searchSessionsPath,
  shouldInsertWorkspaceWelcome,
  transcriptToMessages,
  type SessionTranscriptEntry,
} from "../sessions";
import { WORKBENCH } from "../copy";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("session API helpers", () => {
  it("builds resume path for a work", () => {
    expect(resumeSessionPath("work-1")).toBe("/api/works/work-1/sessions/resume");
  });

  it("builds encoded search path", () => {
    expect(searchSessionsPath("work-1", "妹妹 林瑶")).toBe(
      "/api/works/work-1/sessions?query=%E5%A6%B9%E5%A6%B9+%E6%9E%97%E7%91%B6",
    );
  });

  it("builds encoded session snapshot path", () => {
    expect(sessionSnapshotPath("work 1", "session/1")).toBe(
      "/api/works/work%201/sessions/session%2F1",
    );
  });

  it("builds create session path", () => {
    expect(createSessionPath("work 1")).toBe("/api/works/work%201/sessions");
  });

  it("creates a work session through the sessions API", async () => {
    const response = {
      session: {
        id: "session-1",
        work_id: "work-1",
        title: WORKBENCH.sessionNewTitle,
        summary: null,
        status: "ACTIVE",
        source_session_ref: null,
        source_turn_ref: null,
        last_opened_at: null,
        updated_at: null,
        inserted_at: null,
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(response),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createWorkSession("work-1", { title: WORKBENCH.sessionNewTitle }),
    ).resolves.toEqual(response.session);

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/works/work-1/sessions"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: WORKBENCH.sessionNewTitle }),
    });
  });

  it("builds archive session path", () => {
    expect(archiveSessionPath("work 1", "session/1")).toBe(
      "/api/works/work%201/sessions/session%2F1/archive",
    );
  });

  it("converts transcript entries to chat messages and keeps turn_result", () => {
    const transcript: SessionTranscriptEntry[] = [
      { role: "user", text: "第一句", turn_id: "turn-1", turn_result: null },
      {
        role: "assistant",
        text: "第二句",
        turn_id: "turn-1",
        turn_result: {
          schema_version: "3.0-draft",
          turn_id: "turn-1",
          phase: "completed",
          status: "conversational",
          next_action: "continue",
          assistant_message: { text: "第二句" },
          produced_at: "2026-05-15T00:00:00Z",
        },
      },
    ];

    expect(transcriptToMessages(transcript)).toEqual([
      { role: "user", text: "第一句" },
      {
        role: "assistant",
        text: "第二句",
        turnResult: transcript[1].turn_result,
      },
    ]);
  });

  it("does not insert the workspace welcome after restoring transcript messages", () => {
    expect(shouldInsertWorkspaceWelcome(true, 0)).toBe(false);
    expect(shouldInsertWorkspaceWelcome(false, 1)).toBe(false);
    expect(shouldInsertWorkspaceWelcome(false, 0)).toBe(true);
  });
});
