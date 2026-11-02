// Design: docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md §16.10
// Design: docs/design/ui/46-state-and-feedback.md §9.8
import { describe, expect, it } from "vitest";

import type { AuthorActionResult } from "../generated/foundation/author_action_result";
import type { AgentRunStateData } from "./socket";
import { mergeAgentRunRuntimeState, upsertAssistantTurnResultMessage } from "./agentRunAnchoring";
import type { AgentRunAnchorMessage } from "./agentRunAnchoring";
import {
  readAuthorActionReceipt,
  type AuthorActionCommitScope,
  type AuthorActionCurrentScope,
} from "./authorActionReceipt";
import type { TurnResult } from "./schemas";
import { deriveWorkspaceRuntimeState } from "./workspaceRuntimeState";

const COMMIT: AuthorActionCommitScope = {
  workId: "work-1",
  sessionId: "session-1",
  connectionToken: 7,
  sourceTurnRef: "turn-quality-1",
};

const CURRENT: AuthorActionCurrentScope = {
  workId: "work-1",
  sessionId: "session-1",
  connectionToken: 7,
};

function ack(overrides: Partial<AuthorActionResult> = {}): AuthorActionResult {
  return { received: true, action_status: "accepted", ...overrides };
}

function runState(overrides: Partial<AgentRunStateData> = {}): AgentRunStateData {
  return {
    run_id: "run-revision-1",
    run_mode: "bounded",
    status: "running",
    phase: "executing",
    work_id: "work-1",
    session_id: "session-1",
    parent_turn_ref: "turn-quality-1",
    runtime_live: false,
    trigger: {
      kind: "author_action",
      action_type: "revise_from_findings",
      source_turn_ref: "turn-quality-1",
    },
    ...overrides,
  };
}

function childResult(overrides: Partial<TurnResult> = {}): TurnResult {
  return {
    schema_version: "3.0-draft",
    turn_id: "turn-quality-1:agent:2",
    parent_turn_id: "turn-quality-1",
    phase: "completed",
    status: "completed",
    assistant_message: { text: "修订稿已生成" },
    agent_run: {
      run_id: "run-revision-1",
      run_mode: "bounded",
      parent_turn_ref: "turn-quality-1",
      status: "completed",
    },
    ...overrides,
  };
}

describe("readAuthorActionReceipt", () => {
  it("consumes the actual completed runtime and keeps its parent instead of ACK.turn_id", () => {
    const read = readAuthorActionReceipt(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        turn_id: "turn-quality-1:agent:9",
        agent_run_state: runState({
          status: "completed",
          phase: "completed",
          runtime_live: false,
        }),
      }),
      COMMIT,
      CURRENT,
    );

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.receipt.runtime?.status).toBe("completed");
    expect(read.receipt.runtime?.runtime_live).toBe(false);
    expect(read.receipt.runtime?.parent_turn_ref).toBe("turn-quality-1");
    expect(read.receipt.runtime?.parent_turn_ref).not.toBe("turn-quality-1:agent:9");
  });

  it("consumes a failed, runtime-dead acknowledgment without inventing live", () => {
    const read = readAuthorActionReceipt(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        agent_run_state: runState({
          status: "failed",
          phase: "failed",
          runtime_live: false,
        }),
      }),
      COMMIT,
      CURRENT,
    );

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.receipt.runtime?.status).toBe("failed");
    expect(read.receipt.runtime?.runtime_live).toBe(false);
  });

  it("does not guess running/live when the acknowledgment carries no runtime", () => {
    const read = readAuthorActionReceipt(
      ack({ run_id: "run-revision-1", source_turn_ref: "turn-quality-1" }),
      COMMIT,
      CURRENT,
    );

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.receipt.runtime).toBeNull();
    expect(read.receipt.turnResults).toEqual([]);
  });

  it("keeps a no-run author action acknowledgment legal", () => {
    const read = readAuthorActionReceipt(
      ack({
        receipt_id: "receipt-1",
        source_turn_ref: "turn-quality-1",
        target_artifact_ref: "artifact-original",
      }),
      COMMIT,
      CURRENT,
    );

    expect(read).toEqual({
      ok: true,
      receipt: { actionStatus: "accepted", runtime: null, turnResults: [] },
    });
  });

  it("downgrades a drifted runtime to unknown instead of trusting runtime_live=true", () => {
    const drifted = { ...runState({ runtime_live: true }) } as Record<string, unknown>;
    delete drifted.phase;

    const read = readAuthorActionReceipt(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        agent_run_state: drifted as unknown as AgentRunStateData,
      }),
      COMMIT,
      CURRENT,
    );

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.receipt.runtime?.status).toBe("running");
    expect(read.receipt.runtime?.runtime_live).toBeNull();
  });

  it("rejects an acknowledgment from another connection token", () => {
    const read = readAuthorActionReceipt(
      ack({ run_id: "run-revision-1", agent_run_state: runState() }),
      COMMIT,
      { ...CURRENT, connectionToken: 8 },
    );

    expect(read).toEqual({ ok: false, issue: "connection_changed" });
  });

  it("rejects a late acknowledgment after the visible session switched", () => {
    const read = readAuthorActionReceipt(
      ack({ run_id: "run-revision-1", agent_run_state: runState() }),
      COMMIT,
      { ...CURRENT, sessionId: "session-2" },
    );

    expect(read).toEqual({ ok: false, issue: "session_changed" });
  });

  it("rejects a late acknowledgment after the work switched", () => {
    const read = readAuthorActionReceipt(
      ack({ run_id: "run-revision-1", agent_run_state: runState() }),
      COMMIT,
      { ...CURRENT, workId: "work-2" },
    );

    expect(read).toEqual({ ok: false, issue: "work_changed" });
  });

  it("does not treat a failed or conflicting action as an accepted receipt", () => {
    const read = readAuthorActionReceipt(
      ack({ received: false, action_status: "conflict", target_artifact_ref: "artifact-original" }),
      COMMIT,
      CURRENT,
    );

    expect(read).toEqual({ ok: false, issue: "not_received" });
  });

  it("fails closed when the claimed runtime is not an object", () => {
    const read = readAuthorActionReceipt(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        agent_run_state: "running" as unknown as AgentRunStateData,
      }),
      COMMIT,
      CURRENT,
    );

    expect(read).toEqual({ ok: false, issue: "runtime_invalid" });
  });

  it("rejects a malformed receipt envelope before reading any facts", () => {
    const payloads: unknown[] = [
      undefined,
      null,
      "accepted",
      42,
      [],
      { ...ack(), turn_results: {} },
      { ...ack(), turn_results: [null] },
      { ...ack(), turn_results: [42] },
    ];

    for (const payload of payloads) {
      expect(readAuthorActionReceipt(payload, COMMIT, CURRENT)).toEqual({
        ok: false,
        issue: "receipt_invalid",
      });
    }
  });

  it("rejects an array runtime instead of spreading it into a usable fact", () => {
    const read = readAuthorActionReceipt(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        agent_run_state: [] as unknown as AgentRunStateData,
      }),
      COMMIT,
      CURRENT,
    );

    expect(read).toEqual({ ok: false, issue: "runtime_invalid" });
  });

  it("rejects an acknowledgment whose runtime belongs to another work or session", () => {
    const otherWork = readAuthorActionReceipt(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        agent_run_state: runState({ work_id: "work-2" }),
      }),
      COMMIT,
      CURRENT,
    );
    const otherSession = readAuthorActionReceipt(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        agent_run_state: runState({ session_id: "session-2" }),
      }),
      COMMIT,
      CURRENT,
    );

    expect(otherWork).toEqual({ ok: false, issue: "work_changed" });
    expect(otherSession).toEqual({ ok: false, issue: "session_changed" });
  });

  it("rejects a runtime bound to another run", () => {
    const read = readAuthorActionReceipt(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        agent_run_state: runState({ run_id: "run-other" }),
      }),
      COMMIT,
      CURRENT,
    );

    expect(read).toEqual({ ok: false, issue: "run_mismatch" });
  });

  it("rejects a source mismatch in either the acknowledgment or the runtime", () => {
    const ackSource = readAuthorActionReceipt(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-other",
        agent_run_state: runState(),
      }),
      COMMIT,
      CURRENT,
    );
    const runtimeSource = readAuthorActionReceipt(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        agent_run_state: runState({
          parent_turn_ref: "turn-other",
          trigger: {
            kind: "author_action",
            action_type: "revise_from_findings",
            source_turn_ref: "turn-other",
          },
        }),
      }),
      COMMIT,
      CURRENT,
    );

    expect(ackSource).toEqual({ ok: false, issue: "source_mismatch" });
    expect(runtimeSource).toEqual({ ok: false, issue: "source_mismatch" });
  });

  it("checks every explicit source alias independently instead of masking a conflict", () => {
    const parentConflict = readAuthorActionReceipt(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        agent_run_state: runState({ parent_turn_ref: "turn-other" }),
      }),
      COMMIT,
      CURRENT,
    );
    const triggerConflict = readAuthorActionReceipt(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        agent_run_state: runState({
          trigger: {
            kind: "author_action",
            action_type: "revise_from_findings",
            source_turn_ref: "turn-other",
          },
        }),
      }),
      COMMIT,
      CURRENT,
    );
    const childParentConflict = readAuthorActionReceipt(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        agent_run_state: runState(),
        turn_results: [
          childResult({
            agent_run: { run_id: "run-revision-1", parent_turn_ref: "turn-other" },
          }),
        ],
      }),
      COMMIT,
      CURRENT,
    );
    const receiptTriggerConflict = readAuthorActionReceipt(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        trigger: { source_turn_ref: "turn-other" },
        agent_run_state: runState(),
      }),
      COMMIT,
      CURRENT,
    );
    const childTriggerConflict = readAuthorActionReceipt(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        agent_run_state: runState(),
        turn_results: [
          childResult({
            agent_run: {
              run_id: "run-revision-1",
              trigger: { source_turn_ref: "turn-other" },
            },
          }),
        ],
      }),
      COMMIT,
      CURRENT,
    );

    expect(parentConflict).toEqual({ ok: false, issue: "source_mismatch" });
    expect(triggerConflict).toEqual({ ok: false, issue: "source_mismatch" });
    expect(childParentConflict).toEqual({ ok: false, issue: "result_source_mismatch" });
    expect(receiptTriggerConflict).toEqual({ ok: false, issue: "source_mismatch" });
    expect(childTriggerConflict).toEqual({ ok: false, issue: "result_source_mismatch" });
  });

  it("compares run identity bytes without trimming the actual run id", () => {
    const read = readAuthorActionReceipt(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        agent_run_state: runState({ run_id: "run-revision-1 " }),
      }),
      COMMIT,
      CURRENT,
    );

    expect(read).toEqual({ ok: false, issue: "run_mismatch" });
  });

  it("accepts a runtime without a trigger when its parent source matches", () => {
    const state = runState();
    delete state.trigger;

    const read = readAuthorActionReceipt(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        agent_run_state: state,
      }),
      COMMIT,
      CURRENT,
    );

    expect(read.ok).toBe(true);
  });

  it("accepts a child result without an agent_run when its parent source matches", () => {
    const result = childResult();
    delete result.agent_run;

    const read = readAuthorActionReceipt(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        agent_run_state: runState(),
        turn_results: [result],
      }),
      COMMIT,
      CURRENT,
    );

    expect(read.ok).toBe(true);
  });

  it("fails closed on a child result bound to another run, work, session, or source turn", () => {
    const cases: Array<[Partial<TurnResult>, string]> = [
      [childResult({ agent_run: { run_id: "run-other" } }), "result_run_mismatch"],
      [childResult({ work_id: "work-2" }), "result_scope_mismatch"],
      [childResult({ session_id: "session-2" }), "result_scope_mismatch"],
      [childResult({ parent_turn_id: "turn-other" }), "result_source_mismatch"],
      [
        childResult({ agent_run: { run_id: "run-revision-1", parent_turn_ref: "turn-other" } }),
        "result_source_mismatch",
      ],
    ];

    for (const [result, issue] of cases) {
      const read = readAuthorActionReceipt(
        ack({
          run_id: "run-revision-1",
          source_turn_ref: "turn-quality-1",
          agent_run_state: runState(),
          turn_results: [childResult(result)],
        }),
        COMMIT,
        CURRENT,
      );
      expect(read).toEqual({ ok: false, issue });
    }
  });

  it("returns committed child results only after every identity check passes", () => {
    const result = childResult();
    const read = readAuthorActionReceipt(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        turn_id: result.turn_id,
        agent_run_state: runState({ status: "completed", phase: "completed" }),
        turn_results: [result],
      }),
      COMMIT,
      CURRENT,
    );

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.receipt.turnResults.map((entry) => entry.turn_id)).toEqual([result.turn_id]);
  });
});

describe("author action receipt projections", () => {
  it("does not revive a terminal run when a duplicate running acknowledgment arrives", () => {
    const terminal = runState({ status: "completed", phase: "completed" });
    const lateRunning = runState({ status: "running", phase: "executing" });

    expect(mergeAgentRunRuntimeState(terminal, lateRunning).status).toBe("completed");
  });

  it("upserts the same child result once without creating another author message", () => {
    const result = childResult();
    const messages: AgentRunAnchorMessage<TurnResult>[] = [
      { role: "user", text: "请按所选问题修订", turnId: "turn-quality-1" },
    ];

    const first = upsertAssistantTurnResultMessage(messages, result);
    const second = upsertAssistantTurnResultMessage(first, result);

    expect(second.filter((message) => message.role === "user")).toHaveLength(1);
    expect(
      second.filter(
        (message) => message.role === "assistant" && message.turnResult?.turn_id === result.turn_id,
      ),
    ).toHaveLength(1);
  });

  it("keeps the original candidate pending on revision acceptance and removes it only after a server-resolved projection", () => {
    const original = {
      artifact_id: "artifact-original",
      artifact_type: "prose_fragment",
      adoption_status: "TENTATIVE",
      requires_adoption: true,
      payload: { content: "原稿" },
    };

    const acceptedPending = deriveWorkspaceRuntimeState({
      adoptionState: { pending: [original], resolved: [] },
    });
    const resolvedByServer = deriveWorkspaceRuntimeState({
      adoptionState: {
        pending: [original],
        resolved: [{ ...original, adoption_status: "ACCEPTED" }],
      },
    });

    expect(acceptedPending.adoption.pendingArtifactIds).toContain("artifact-original");
    expect(resolvedByServer.adoption.pendingArtifactIds).not.toContain("artifact-original");
  });
});
