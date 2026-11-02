// Design: docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md §16.10
// Design: docs/design/ui/46-state-and-feedback.md §9.8
import { describe, expect, it } from "vitest";

import type { AuthorActionResult } from "../generated/foundation/author_action_result";
import { upsertAssistantTurnResultMessage, mergeAgentRunRuntimeState } from "./agentRunAnchoring";
import type { AgentRunStateData } from "./socket";
import {
  isAuthorActionDelivered,
  submitAndDeliverAuthorAction,
  type AuthorActionDeliveryEffects,
  type AuthorActionSubmissionResult,
} from "./authorActionSubmission";
import type { AuthorActionCommitScope, AuthorActionCurrentScope } from "./authorActionReceipt";
import { WORKBENCH } from "./copy";
import type { TurnResult } from "./schemas";

const COMMIT: AuthorActionCommitScope = {
  connectionToken: 7,
  workId: "work-1",
  sessionId: "session-1",
  sourceTurnRef: "turn-quality-1",
};

const CURRENT: AuthorActionCurrentScope = {
  connectionToken: 7,
  workId: "work-1",
  sessionId: "session-1",
};

const ACTION = {
  source_turn_ref: "turn-quality-1",
  action_id: "action-revise",
  action_type: "revise_from_findings",
};

interface ViewMessage {
  role: "user" | "assistant";
  text: string;
  turnResult?: TurnResult;
}

interface View {
  messages: ViewMessage[];
  agentRunStates: Record<string, AgentRunStateData>;
  loading: boolean;
  revisionTurnId: string | null;
}

function view(initial: Partial<View> = {}): View {
  return {
    messages: [{ role: "user", text: "请按所选问题修订" }],
    agentRunStates: {},
    loading: true,
    revisionTurnId: null,
    ...initial,
  };
}

function effectsFor(target: View): AuthorActionDeliveryEffects {
  return {
    publishDuplicate: () => {
      target.messages = [
        ...target.messages,
        { role: "assistant", text: WORKBENCH.actionDuplicate },
      ];
    },
    publishFailure: () => {
      target.messages = [...target.messages, { role: "assistant", text: WORKBENCH.actionFailure }];
    },
    publishUnverifiable: () => {
      target.messages = [
        ...target.messages,
        { role: "assistant", text: WORKBENCH.actionReceiptUnverifiable },
      ];
    },
    applyTurnResult: (result) => {
      target.messages = upsertAssistantTurnResultMessage(target.messages, result);
    },
    applyRuntime: (state) => {
      target.agentRunStates = {
        ...target.agentRunStates,
        [state.run_id]: mergeAgentRunRuntimeState(target.agentRunStates[state.run_id], state),
      };
    },
    settle: () => {
      target.loading = false;
      target.revisionTurnId = null;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function ack(overrides: Partial<AuthorActionResult> = {}): AuthorActionResult {
  return { received: true, action_status: "accepted", ...overrides };
}

function runState(overrides: Partial<AgentRunStateData> = {}): AgentRunStateData {
  return {
    run_id: "run-revision-1",
    run_mode: "bounded",
    status: "completed",
    phase: "completed",
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

async function submit(
  target: View,
  response: Promise<AuthorActionResult>,
  current: () => AuthorActionCurrentScope = () => CURRENT,
): Promise<AuthorActionSubmissionResult | null> {
  return submitAndDeliverAuthorAction({
    action: ACTION,
    committed: COMMIT,
    send: () => response,
    getCurrentScope: current,
    effects: effectsFor(target),
  });
}

describe("submitAndDeliverAuthorAction", () => {
  it("delivers a same-scope success once, merges real receipt facts, and settles request pending", async () => {
    const target = view({ revisionTurnId: "turn-quality-1" });
    const reply = deferred<AuthorActionResult>();
    const pending = submit(target, reply.promise);

    reply.resolve(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        agent_run_state: runState(),
        turn_results: [childResult()],
      }),
    );

    const result = await pending;
    expect(result?.status).toBe("accepted");
    expect(target.loading).toBe(false);
    expect(target.revisionTurnId).toBeNull();
    expect(target.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(
      target.messages.filter(
        (message) =>
          message.role === "assistant" && message.turnResult?.turn_id === childResult().turn_id,
      ),
    ).toHaveLength(1);
    expect(target.agentRunStates["run-revision-1"]?.status).toBe("completed");
  });

  it("keeps a no-runtime budget acknowledgment accepted and settles without inventing a run", async () => {
    const target = view();
    const result = await submit(
      target,
      Promise.resolve(
        ack({
          receipt_id: "receipt-budget",
          source_turn_ref: "turn-quality-1",
          target_artifact_ref: "artifact-original",
        }),
      ),
    );

    expect(result?.status).toBe("accepted");
    expect(target.loading).toBe(false);
    expect(target.agentRunStates).toEqual({});
    expect(target.messages).toHaveLength(1);
  });

  it("does not touch a new view when a deferred success arrives after the session switched", async () => {
    const target = view({ revisionTurnId: "turn-quality-1" });
    const reply = deferred<AuthorActionResult>();
    const pending = submit(target, reply.promise, () => ({
      ...CURRENT,
      sessionId: "session-2",
    }));

    reply.resolve(
      ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        agent_run_state: runState(),
        turn_results: [childResult()],
      }),
    );

    expect(await pending).toBeNull();
    expect(target).toEqual(view({ revisionTurnId: "turn-quality-1" }));
  });

  it("does not touch a new view when a deferred duplicate arrives after the work switched", async () => {
    const target = view();
    const reply = deferred<AuthorActionResult>();
    const pending = submit(target, reply.promise, () => ({ ...CURRENT, workId: "work-2" }));

    reply.resolve(ack({ duplicate: true, action_status: "accepted" }));

    expect(await pending).toBeNull();
    expect(target).toEqual(view());
  });

  it("does not publish failure or settle when a deferred rejection arrives after the connection token changed", async () => {
    const target = view({ revisionTurnId: "turn-quality-1" });
    const reply = deferred<AuthorActionResult>();
    const pending = submit(target, reply.promise, () => ({ ...CURRENT, connectionToken: 8 }));

    reply.reject(new Error("transport closed"));

    expect(await pending).toBeNull();
    expect(target).toEqual(view({ revisionTurnId: "turn-quality-1" }));
  });

  it("fails closed and settles when the transport rejects in the same scope", async () => {
    const target = view({ revisionTurnId: "turn-quality-1" });

    const result = await submit(target, Promise.reject(new Error("transport closed")));

    expect(result?.status).toBe("failed");
    expect(target.messages).toContainEqual({
      role: "assistant",
      text: WORKBENCH.actionFailure,
    });
    expect(target.revisionTurnId).toBeNull();
    expect(target.loading).toBe(false);
  });

  it("does not revive a terminal run or create a user message for a same-scope duplicate", async () => {
    const terminal = runState({ status: "completed", phase: "completed" });
    const target = view({ agentRunStates: { "run-revision-1": terminal } });
    const result = await submit(
      target,
      Promise.resolve(
        ack({
          duplicate: true,
          run_id: "run-revision-1",
          source_turn_ref: "turn-quality-1",
          agent_run_state: runState({ status: "running", phase: "executing" }),
          turn_results: [childResult({ turn_id: "turn-quality-1:agent:9" })],
        }),
      ),
    );

    expect(result?.status).toBe("duplicate");
    expect(target.agentRunStates["run-revision-1"]?.status).toBe("completed");
    expect(target.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(target.messages).toContainEqual({
      role: "assistant",
      text: WORKBENCH.actionDuplicate,
    });
    expect(
      target.messages.filter((message) => message.turnResult?.turn_id === "turn-quality-1:agent:9"),
    ).toHaveLength(1);
    expect(target.loading).toBe(false);
  });

  it("applies a duplicate completed receipt before reporting duplicate", async () => {
    const target = view({
      revisionTurnId: "turn-quality-1",
      agentRunStates: {
        "run-revision-1": runState({ status: "running", phase: "executing" }),
      },
    });
    const result = await submit(
      target,
      Promise.resolve(
        ack({
          duplicate: true,
          run_id: "run-revision-1",
          source_turn_ref: "turn-quality-1",
          agent_run_state: runState({ status: "completed", phase: "completed" }),
          turn_results: [childResult()],
        }),
      ),
    );

    expect(result?.status).toBe("duplicate");
    expect(target.agentRunStates["run-revision-1"]?.status).toBe("completed");
    expect(target.messages).toContainEqual({
      role: "assistant",
      text: WORKBENCH.actionDuplicate,
    });
    expect(
      target.messages.filter((message) => message.turnResult?.turn_id === childResult().turn_id),
    ).toHaveLength(1);
    expect(target.revisionTurnId).toBeNull();
    expect(target.loading).toBe(false);
  });

  it("applies a duplicate failed receipt to the old running runtime", async () => {
    const target = view({
      agentRunStates: {
        "run-revision-1": runState({ status: "running", phase: "executing" }),
      },
    });
    const result = await submit(
      target,
      Promise.resolve(
        ack({
          duplicate: true,
          run_id: "run-revision-1",
          source_turn_ref: "turn-quality-1",
          agent_run_state: runState({ status: "failed", phase: "failed" }),
        }),
      ),
    );

    expect(result?.status).toBe("duplicate");
    expect(target.agentRunStates["run-revision-1"]?.status).toBe("failed");
    expect(target.messages).toContainEqual({
      role: "assistant",
      text: WORKBENCH.actionDuplicate,
    });
    expect(target.loading).toBe(false);
  });

  it("rejects a misbound duplicate without publishing duplicate or its facts", async () => {
    const target = view({
      agentRunStates: {
        "run-revision-1": runState({ status: "running", phase: "executing" }),
      },
    });
    const result = await submit(
      target,
      Promise.resolve(
        ack({
          duplicate: true,
          run_id: "run-revision-1",
          source_turn_ref: "foreign-source",
          agent_run_state: runState({ status: "completed", phase: "completed" }),
          turn_results: [childResult()],
        }),
      ),
    );

    expect(result?.status).toBe("failed");
    expect(target.agentRunStates["run-revision-1"]?.status).toBe("running");
    expect(target.messages).not.toContainEqual({
      role: "assistant",
      text: WORKBENCH.actionDuplicate,
    });
    expect(target.messages).toContainEqual({
      role: "assistant",
      text: WORKBENCH.actionFailure,
    });
    expect(
      target.messages.filter((message) => message.turnResult?.turn_id === childResult().turn_id),
    ).toHaveLength(0);
    expect(target.loading).toBe(false);
  });

  it("settles a malformed receipt as unverifiable without applying partial facts", async () => {
    const target = view({ revisionTurnId: "turn-quality-1" });
    const malformed = {
      ...ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        agent_run_state: runState({ status: "completed", phase: "completed" }),
        turn_results: [childResult()],
      }),
      turn_results: [null],
    };

    const result = await submit(
      target,
      Promise.resolve(malformed as unknown as AuthorActionResult),
    );

    expect(result?.status).toBe("failed");
    expect(target.agentRunStates).toEqual({});
    expect(
      target.messages.filter((message) => message.turnResult?.turn_id === childResult().turn_id),
    ).toHaveLength(0);
    expect(target.messages).toContainEqual({
      role: "assistant",
      text: WORKBENCH.actionReceiptUnverifiable,
    });
    expect(target.messages).not.toContainEqual({
      role: "assistant",
      text: WORKBENCH.actionFailure,
    });
    expect(target.revisionTurnId).toBeNull();
    expect(target.loading).toBe(false);
  });

  it("settles primitive and non-array wiring as unverifiable without applying facts", async () => {
    const payloads: unknown[] = [
      undefined,
      "accepted",
      {
        ...ack({
          run_id: "run-revision-1",
          source_turn_ref: "turn-quality-1",
          agent_run_state: runState({ status: "completed", phase: "completed" }),
        }),
        turn_results: {},
      },
      {
        ...ack({
          run_id: "run-revision-1",
          source_turn_ref: "turn-quality-1",
          agent_run_state: runState({ status: "completed", phase: "completed" }),
        }),
        turn_results: [42],
      },
    ];

    for (const payload of payloads) {
      const target = view();
      const result = await submit(target, Promise.resolve(payload as AuthorActionResult));

      expect(result?.status).toBe("failed");
      expect(target.agentRunStates).toEqual({});
      expect(target.messages).toContainEqual({
        role: "assistant",
        text: WORKBENCH.actionReceiptUnverifiable,
      });
      expect(target.loading).toBe(false);
    }
  });

  it("does not touch a new view when a deferred malformed receipt arrives after the session switched", async () => {
    const target = view({ revisionTurnId: "turn-quality-1" });
    const reply = deferred<AuthorActionResult>();
    const pending = submit(target, reply.promise, () => ({
      ...CURRENT,
      sessionId: "session-2",
    }));

    reply.resolve({
      ...ack({
        run_id: "run-revision-1",
        source_turn_ref: "turn-quality-1",
        agent_run_state: runState(),
      }),
      turn_results: [null],
    } as unknown as AuthorActionResult);

    expect(await pending).toBeNull();
    expect(target).toEqual(view({ revisionTurnId: "turn-quality-1" }));
  });

  it("keeps runtime unknown when a run acknowledgment carries no runtime", async () => {
    const target = view();
    const result = await submit(
      target,
      Promise.resolve(
        ack({
          run_id: "run-revision-1",
          source_turn_ref: "turn-quality-1",
        }),
      ),
    );

    expect(result?.status).toBe("accepted");
    expect(target.agentRunStates).toEqual({});
    expect(target.loading).toBe(false);
  });

  it("fails closed without applying an identity-conflicting receipt", async () => {
    const target = view();
    const result = await submit(
      target,
      Promise.resolve(
        ack({
          run_id: "run-revision-1",
          source_turn_ref: "turn-quality-1",
          agent_run_state: runState({ parent_turn_ref: "foreign-source" }),
        }),
      ),
    );

    expect(result?.status).toBe("failed");
    expect(target.agentRunStates).toEqual({});
    expect(target.messages).toContainEqual({
      role: "assistant",
      text: WORKBENCH.actionFailure,
    });
    expect(target.loading).toBe(false);
  });

  it("treats accepted and duplicate outcomes as delivered action facts, never failed or stale", () => {
    expect(isAuthorActionDelivered({ status: "accepted", response: ack() })).toBe(true);
    expect(isAuthorActionDelivered({ status: "duplicate" })).toBe(true);
    expect(isAuthorActionDelivered({ status: "failed" })).toBe(false);
    expect(isAuthorActionDelivered(null)).toBe(false);
  });
});
