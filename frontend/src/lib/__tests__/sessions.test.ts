import { describe, expect, it } from "vitest";

import {
  resumeSessionPath,
  searchSessionsPath,
  transcriptToMessages,
  type SessionTranscriptEntry,
} from "../sessions";

describe("session API helpers", () => {
  it("builds resume path for a work", () => {
    expect(resumeSessionPath("work-1")).toBe("/api/works/work-1/sessions/resume");
  });

  it("builds encoded search path", () => {
    expect(searchSessionsPath("work-1", "妹妹 林瑶")).toBe(
      "/api/works/work-1/sessions?query=%E5%A6%B9%E5%A6%B9+%E6%9E%97%E7%91%B6",
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
});
