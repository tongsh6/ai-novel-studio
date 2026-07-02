import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWorkSession,
  createSessionPath,
  archiveSessionPath,
  getSessionTranscriptPage,
  getTurnAgentRunActivity,
  getTurnProviderRuns,
  sessionTranscriptPagePath,
  sessionSnapshotPath,
  resumeSessionPath,
  searchSessionsPath,
  shouldInsertWorkspaceWelcome,
  turnAgentRunActivityPath,
  transcriptToMessages,
  turnProviderRunsPath,
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

  it("builds encoded session transcript page path", () => {
    expect(sessionTranscriptPagePath("work 1", "session/1", { beforeId: "msg:1", limit: 12 })).toBe(
      "/api/works/work%201/sessions/session%2F1/transcript?before_id=msg%3A1&limit=12",
    );
  });

  it("builds encoded provider run activity path", () => {
    expect(turnProviderRunsPath("work 1", "session/1", "turn:1")).toBe(
      "/api/works/work%201/sessions/session%2F1/turns/turn%3A1/provider-runs",
    );
  });

  it("builds encoded agent run activity path", () => {
    expect(turnAgentRunActivityPath("work 1", "session/1", "turn:1")).toBe(
      "/api/works/work%201/sessions/session%2F1/turns/turn%3A1/agent-run-activity",
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

  it("loads provider run activity through the sessions API", async () => {
    const response = {
      work_id: "work-1",
      session_id: "session-1",
      turn_id: "turn-1",
      provider_runs: [{ provider_run_ref: "prun-1", provider_call_ref: "pcall-1" }],
      agent_runs: [{ run_id: "run-1" }],
      totals: { provider_run_count: 1, total_tokens: 12 },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(response),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getTurnProviderRuns("work-1", "session-1", "turn-1")).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/works/work-1/sessions/session-1/turns/turn-1/provider-runs"),
    );
  });

  it("loads agent run activity through the sessions API", async () => {
    const response = {
      work_id: "work-1",
      session_id: "session-1",
      turn_id: "turn-1",
      provider_runs: [{ provider_run_ref: "prun-1", provider_call_ref: "pcall-1" }],
      agent_runs: [{ run_id: "run-1", events: [{ event_id: "evt-1" }] }],
      totals: { provider_run_count: 1, total_tokens: 12 },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(response),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getTurnAgentRunActivity("work-1", "session-1", "turn-1")).resolves.toEqual(
      response,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/works/work-1/sessions/session-1/turns/turn-1/agent-run-activity",
      ),
    );
  });

  it("loads a session transcript page through the sessions API", async () => {
    const response = {
      work_id: "work-1",
      session: {
        id: "session-1",
        work_id: "work-1",
        title: "默认会话",
        summary: null,
        status: "ACTIVE",
        source_session_ref: null,
        source_turn_ref: null,
        last_opened_at: null,
        updated_at: null,
        inserted_at: null,
      },
      read_only: false,
      transcript: [{ role: "user", text: "更早对话", turn_id: "turn-1", turn_result: null }],
      transcript_page: {
        limit: 30,
        returned_count: 1,
        has_more_before: false,
        before_id: "interaction-1",
        after_id: "interaction-1",
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(response),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getSessionTranscriptPage("work-1", "session-1", { beforeId: "interaction-2" }),
    ).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/works/work-1/sessions/session-1/transcript?before_id=interaction-2",
      ),
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
      { role: "user", text: "第一句", turnId: "turn-1" },
      {
        role: "assistant",
        text: "第二句",
        turnId: "turn-1",
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
