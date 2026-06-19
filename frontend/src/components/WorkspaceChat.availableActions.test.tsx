// Design: docs/design/acceptance/author/AU-10-workbench-ui.md §SC-AU10-C3
// Prototype: novel-studio.pen → 41§3-main-workbench (ZOwOi)
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  WorkspaceCandidatePanel,
  WorkspaceSessionList,
  type CandidateDirection,
  type TurnResult,
} from "./WorkspaceChat";
import { WORKBENCH } from "../lib/copy";
import { toAuthorActionPayload } from "../lib/workbenchActions";
import type { AuthorActionPayload } from "../lib/socket";
import type { WorkSessionDto } from "../lib/sessions";

interface ElementProps {
  children?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  onChange?: (event: { target: { value: string } }) => void;
  title?: string;
  placeholder?: string;
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

function findButtonsByAriaLabel(node: ReactNode, label: string): TestElement[] {
  const found: TestElement[] = [];

  function visit(current: ReactNode) {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }

    if (!isValidElement(current)) return;

    const element = current as TestElement;
    if (element.type === "button" && element.props["aria-label"] === label) {
      found.push(element);
    }

    elementChildren(element).forEach(visit);
  }

  visit(node);
  return found;
}

function findInputByPlaceholder(node: ReactNode, placeholder: string): TestElement | undefined {
  let found: TestElement | undefined;

  function visit(current: ReactNode) {
    if (found) return;

    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }

    if (!isValidElement(current)) return;

    const element = current as TestElement;
    if (element.type === "input" && element.props.placeholder === placeholder) {
      found = element;
      return;
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

const session = (overrides: Partial<WorkSessionDto>): WorkSessionDto => ({
  id: "session-1",
  work_id: "work-1",
  title: "当前会话",
  summary: null,
  status: "ACTIVE",
  source_session_ref: null,
  source_turn_ref: null,
  last_opened_at: null,
  updated_at: null,
  inserted_at: null,
  ...overrides,
});

describe("WorkspaceChat candidate controls", () => {
  it("continues discussion without submitting a choose_candidate author_action", () => {
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
    const continued: CandidateDirection[] = [];
    const tree = WorkspaceCandidatePanel({
      turnResult: result,
      candidates: result.candidate_directions ?? [],
      loading: false,
      socketConnected: true,
      onCandidateContinue: (clickedTurnResult, clickedCandidate) => {
        expect(clickedTurnResult.turn_id).toBe("server-turn-1");
        continued.push(clickedCandidate);
      },
      onCandidateAdopt: vi.fn(),
    });

    const [button] = findButtonsByText(tree, WORKBENCH.candidateContinueLabel);
    expect(button).toBeDefined();
    expect(button.props.disabled).toBe(false);

    button.props.onClick?.();

    expect(continued).toEqual([result.candidate_directions![0]]);
  });

  it("submits the server action payload from the adopt button", () => {
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
      onCandidateContinue: vi.fn(),
      onCandidateAdopt: (clickedTurnResult, action) => {
        submitted.push(toAuthorActionPayload(clickedTurnResult.turn_id, action));
      },
    });

    const [button] = findButtonsByText(tree, WORKBENCH.candidateAdoptLabel);
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

  it("keeps discussion available when no matching available_action exists", () => {
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
    expect(button.props.disabled).toBe(false);

    button.props.onClick?.();

    expect(onCandidateContinue).toHaveBeenCalledOnce();
  });

  it("uses server-provided target and candidate refs for adoption instead of candidate.direction_id", () => {
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
      onCandidateContinue: vi.fn(),
      onCandidateAdopt: (clickedTurnResult, action) => {
        submitted.push(toAuthorActionPayload(clickedTurnResult.turn_id, action));
      },
    });

    findButtonsByText(tree, WORKBENCH.candidateAdoptLabel)[0].props.onClick?.();

    expect(submitted[0]).toMatchObject({
      action_id: "server-action-y",
      target_ref: "server_target_y",
      candidate_set_ref: "server_candidate_set_y",
      candidate_ref: "server_candidate_y",
    });
    expect(JSON.stringify(submitted[0])).not.toContain("local_candidate_x");
  });

  it("does not derive an adoption action from card_type=candidate_set", () => {
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
    expect(button.props.disabled).toBe(false);

    expect(findButtonsByText(tree, WORKBENCH.candidateAdoptLabel)).toEqual([]);
  });
});

describe("WorkspaceChat session controls", () => {
  it("offers a work-scoped new session action beside search", () => {
    const searched: string[] = [];
    let createCount = 0;
    const tree = WorkspaceSessionList({
      sessions: [session({ id: "active", title: "当前会话" })],
      activeSessionId: "active",
      sessionSearch: "",
      canCreateSession: true,
      creatingSession: false,
      onSessionSearch: (query) => searched.push(query),
      onOpenSession: vi.fn(),
      onCreateSession: () => {
        createCount += 1;
      },
      onArchiveSession: vi.fn(),
    });

    const input = findInputByPlaceholder(tree, WORKBENCH.sessionSearchPlaceholder);
    expect(input).toBeDefined();
    input?.props.onChange?.({ target: { value: "林瑶" } });
    expect(searched).toEqual(["林瑶"]);

    const [createButton] = findButtonsByAriaLabel(tree, WORKBENCH.sessionCreate);
    expect(createButton).toBeDefined();
    expect(createButton.props.disabled).toBe(false);

    createButton.props.onClick?.();

    expect(createCount).toBe(1);
  });

  it("archives only exited history sessions from the list", () => {
    const archived: string[] = [];
    const tree = WorkspaceSessionList({
      sessions: [
        session({ id: "active", title: "当前会话", status: "ACTIVE" }),
        session({ id: "history", title: "历史会话", status: "EXITED" }),
        session({ id: "archived", title: "已归档会话", status: "ARCHIVED" }),
      ],
      activeSessionId: "active",
      sessionSearch: "",
      canCreateSession: false,
      creatingSession: false,
      onSessionSearch: vi.fn(),
      onOpenSession: vi.fn(),
      onCreateSession: vi.fn(),
      onArchiveSession: (item) => archived.push(item.id),
    });

    const archiveButtons = findButtonsByAriaLabel(tree, WORKBENCH.sessionArchive);
    expect(archiveButtons).toHaveLength(1);

    archiveButtons[0].props.onClick?.();

    expect(archived).toEqual(["history"]);

    const [createButton] = findButtonsByAriaLabel(tree, WORKBENCH.sessionCreate);
    expect(createButton.props.disabled).toBe(true);
  });
});
