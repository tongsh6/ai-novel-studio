// Design: docs/design-v3/acceptance/author/AU-10-workbench-ui.md §SC-AU10-C3
// Prototype: novel-studio-v2.pen → 41§3-main-workbench (ZOwOi)
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  WorkspaceCandidatePanel,
  type CandidateDirection,
  type TurnResult,
} from "./WorkspaceChat";
import { findCandidateAvailableAction } from "../lib/candidateSelection";
import { WORKBENCH } from "../lib/copy";
import { toAuthorActionPayload } from "../lib/workbenchActions";
import type { AuthorActionPayload } from "../lib/socket";

interface ElementProps {
  children?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  [key: string]: unknown;
}

type TestElement = ReactElement<ElementProps>;

function elementChildren(node: ReactNode): ReactNode[] {
  if (!isValidElement(node)) return [];
  const children = (node as TestElement).props.children;
  return Children.toArray(children);
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (!isValidElement(node)) return "";
  return elementChildren(node).map(textContent).join("");
}

function findButtonsByText(node: ReactNode, text: string): TestElement[] {
  const found: TestElement[] = [];

  function visit(current: ReactNode) {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }

    if (!isValidElement(current)) return;

    const element = current as TestElement;
    if (element.type === "button" && textContent(element).includes(text)) {
      found.push(element);
    }

    elementChildren(element).forEach(visit);
  }

  visit(node);
  return found;
}

const candidate = (directionId = "dir-1"): CandidateDirection => ({
  direction_id: directionId,
  title: "赛博公司垄断流",
  pitch: "底层散修对抗大厂灵气垄断。",
  tone_tags: ["赛博", "修真"],
  adoption_status: "candidate",
});

const turnResult = (overrides: Partial<TurnResult> = {}): TurnResult => ({
  schema_version: "v3",
  turn_id: "turn-1",
  phase: "awaiting_author",
  status: "choose_candidate",
  next_action: "choose_candidate",
  assistant_message: { text: "请选择方向" },
  candidate_directions: [candidate()],
  available_actions: [],
  ui_cards: [],
  produced_at: "2026-05-26T00:00:00Z",
  ...overrides,
});

function submitCandidateAction(
  result: TurnResult,
  selectedCandidate: CandidateDirection,
): AuthorActionPayload | null {
  const candidates = result.candidate_directions ?? [];
  const candidateIndex = candidates.findIndex(
    (item) => item.direction_id === selectedCandidate.direction_id,
  );
  const action = findCandidateAvailableAction({
    availableActions: result.available_actions ?? [],
    candidate: selectedCandidate,
    candidateIndex: candidateIndex >= 0 ? candidateIndex : undefined,
    candidateCount: candidates.length,
    sourceTurnRef: result.turn_id,
  });

  return action ? toAuthorActionPayload(result.turn_id, action) : null;
}

describe("WorkspaceChat candidate available_actions rendering", () => {
  it("renders candidate controls from available_actions and submits the server action payload", () => {
    const result = turnResult({
      turn_id: "server-turn-1",
      available_actions: [
        {
          action_id: "server-action-1",
          action_type: "choose_candidate",
          source_turn_ref: "server-turn-1",
          target_ref: "server-target-1",
          candidate_set_ref: "server-candidate-set-1",
          candidate_ref: "dir-1",
          enabled: true,
          idempotency_key: "server-idem-1",
        },
      ],
    });
    const submitted: AuthorActionPayload[] = [];
    const tree = WorkspaceCandidatePanel({
      turnResult: result,
      candidates: result.candidate_directions ?? [],
      loading: false,
      socketConnected: true,
      onCandidateContinue: (clickedTurnResult, clickedCandidate) => {
        const payload = submitCandidateAction(clickedTurnResult, clickedCandidate);
        if (payload) submitted.push(payload);
      },
      onCandidateAdopt: vi.fn(),
    });

    const [button] = findButtonsByText(tree, WORKBENCH.candidateContinueLabel);
    expect(button).toBeDefined();
    expect(button.props.disabled).toBe(false);

    button.props.onClick?.();

    expect(submitted).toEqual([
      {
        source_turn_ref: "server-turn-1",
        action_id: "server-action-1",
        action_type: "choose_candidate",
        target_ref: "server-target-1",
        candidate_set_ref: "server-candidate-set-1",
        candidate_ref: "dir-1",
        idempotency_key: "server-idem-1",
      },
    ]);
  });

  it("does not submit when no matching available_action exists", () => {
    const result = turnResult();
    const onCandidateContinue = vi.fn();
    const tree = WorkspaceCandidatePanel({
      turnResult: result,
      candidates: result.candidate_directions ?? [],
      loading: false,
      socketConnected: true,
      onCandidateContinue,
      onCandidateAdopt: vi.fn(),
    });

    const [button] = findButtonsByText(tree, WORKBENCH.candidateContinueLabel);
    expect(button.props.disabled).toBe(true);

    button.props.onClick?.();

    expect(onCandidateContinue).not.toHaveBeenCalled();
  });

  it("uses server-provided target and candidate refs instead of candidate.direction_id", () => {
    const result = turnResult({
      turn_id: "server-turn-y",
      candidate_directions: [candidate("local_candidate_x")],
      available_actions: [
        {
          action_id: "server-action-y",
          action_type: "choose_candidate",
          source_turn_ref: "server-turn-y",
          target_ref: "server_target_y",
          candidate_set_ref: "server_candidate_set_y",
          candidate_ref: "server_candidate_y",
          enabled: true,
          idempotency_key: "server-idem-y",
        },
      ],
    });
    const submitted: AuthorActionPayload[] = [];
    const tree = WorkspaceCandidatePanel({
      turnResult: result,
      candidates: result.candidate_directions ?? [],
      loading: false,
      socketConnected: true,
      onCandidateContinue: (clickedTurnResult, clickedCandidate) => {
        const payload = submitCandidateAction(clickedTurnResult, clickedCandidate);
        if (payload) submitted.push(payload);
      },
      onCandidateAdopt: vi.fn(),
    });

    findButtonsByText(tree, WORKBENCH.candidateContinueLabel)[0].props.onClick?.();

    expect(submitted[0]).toMatchObject({
      action_id: "server-action-y",
      target_ref: "server_target_y",
      candidate_set_ref: "server_candidate_set_y",
      candidate_ref: "server_candidate_y",
    });
    expect(JSON.stringify(submitted[0])).not.toContain("local_candidate_x");
  });

  it("does not derive a business action from card_type=candidate_set", () => {
    const result = turnResult({
      ui_cards: [{ card_type: "candidate_set", title: "候选方向" }],
      available_actions: [],
    });
    const onCandidateContinue = vi.fn();
    const tree = WorkspaceCandidatePanel({
      turnResult: result,
      candidates: result.candidate_directions ?? [],
      loading: false,
      socketConnected: true,
      onCandidateContinue,
      onCandidateAdopt: vi.fn(),
    });

    const [button] = findButtonsByText(tree, WORKBENCH.candidateContinueLabel);
    expect(button.props.disabled).toBe(true);

    button.props.onClick?.();

    expect(onCandidateContinue).not.toHaveBeenCalled();
  });
});
