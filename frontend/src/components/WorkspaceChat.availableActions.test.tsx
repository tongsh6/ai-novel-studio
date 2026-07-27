// Design: docs/design/acceptance/author/AU-10-workbench-ui.md §SC-AU10-C3
// Prototype: novel-studio.pen → 41§3-main-workbench (ZOwOi)
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  WorkspaceCandidatePanel,
  WorkspaceSessionList,
  type ArtifactEntry,
  type CandidateDirection,
  type TurnResult,
} from "./WorkspaceChat";
import { qualityRevisionArtifactRole } from "../lib/agentRunAnchoring";
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
  adoption_status: "not_adopted",
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

const proseArtifact = (overrides: Partial<ArtifactEntry> = {}): ArtifactEntry => ({
  artifact_id: "artifact-revision-1",
  artifact_type: "prose_fragment",
  adoption_status: "tentative",
  requires_adoption: true,
  payload: { title: "修订草稿" },
  ...overrides,
});

describe("WorkspaceChat quality revision action labels", () => {
  it("recognizes a revision from the trace summary emitted by the revision flow", () => {
    const artifact = proseArtifact();
    const result = turnResult({
      adoption_state: { pending: [artifact], resolved: [] },
      trace_summary: { revision_base: "artifact-original-1" },
    });

    expect(qualityRevisionArtifactRole(result, artifact)).toBe("revision");
  });

  it("recognizes a revision from its candidate card or author-action trigger fallback", () => {
    const artifact = proseArtifact();
    const cardResult = turnResult({
      adoption_state: { pending: [artifact], resolved: [] },
      ui_cards: [
        {
          card_type: "candidate_set",
          artifact_refs: [artifact.artifact_id],
          revision_of: "artifact-original-1",
        },
      ],
    });
    const triggerResult = turnResult({
      adoption_state: { pending: [artifact], resolved: [] },
      agent_run: {
        run_id: "run-revision-1",
        run_mode: "bounded",
        status: "completed",
        trigger: {
          kind: "author_action",
          action_type: "revise_from_findings",
          target_artifact_ref: "artifact-original-1",
        },
      },
    });

    expect(qualityRevisionArtifactRole(cardResult, artifact)).toBe("revision");
    expect(qualityRevisionArtifactRole(triggerResult, artifact)).toBe("revision");
  });

  it("keeps a reviewed source artifact independently identifiable as the original", () => {
    const artifact = proseArtifact({ artifact_id: "artifact-original-1" });
    const result = turnResult({
      adoption_state: { pending: [artifact], resolved: [] },
      quality_review: {
        status: "failed",
        policy_action: "warn",
        review_status: "completed",
        findings: [
          {
            quality_finding_id: "qf_prose_quality",
            quality_gate: "style",
            validator: "prose_quality",
            severity: "warning",
            action: "revise",
            summary: "句式节奏单一",
            reasoning: "连续句段结构相同且没有形成递进。",
            confidence: 0.88,
            impact_scope: "local",
            revision_scope: "local",
            evidence_spans: [
              {
                text: "他侧身。他挥刀。他格挡。",
                sentence_start: 2,
                sentence_end: 4,
              },
            ],
          },
        ],
      },
    });

    expect(qualityRevisionArtifactRole(result, artifact)).toBe("original");
  });

  it("restores the original role from its revise action when history omits quality details", () => {
    const artifact = proseArtifact({ artifact_id: "artifact-original-1" });
    const result = turnResult({
      adoption_state: { pending: [artifact], resolved: [] },
      available_actions: [
        {
          action_id: "revise-from-findings-1",
          action_type: "revise_from_findings",
          source_turn_ref: "turn-original-1",
          target_ref: artifact.artifact_id,
          enabled: true,
        },
      ],
    });

    expect(qualityRevisionArtifactRole(result, artifact)).toBe("original");
  });
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

  it("collapses a continued candidate group into a disclosure without claiming adoption", () => {
    const result = turnResult();
    const tree = WorkspaceCandidatePanel({
      turnResult: result,
      candidates: result.candidate_directions ?? [],
      loading: false,
      socketConnected: true,
      continuedCandidateRef: "dir-1",
      onCandidateContinue: vi.fn(),
      onCandidateAdopt: vi.fn(),
    });

    expect(tree.type).toBe("details");
    expect(textContent(tree)).toContain("已沿「赛博公司垄断流」继续讨论");
    expect(textContent(tree)).toContain(WORKBENCH.candidateCollapsedExpandLabel);
    expect(textContent(tree)).not.toContain("已采纳");
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
