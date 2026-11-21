// Design: UI42 §4.4 / UI46 §6.1. Real Workbench callbacks; not native/browser acceptance.
import {
  Children,
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as Dialog from "@radix-ui/react-dialog";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AuthorActionSubmission,
  AuthorActionSubmissionResult,
} from "../lib/authorActionSubmission";
import type {
  SessionSearchHit,
  WorkspaceSessionSnapshot,
  WorkspaceSessionTranscriptPage,
} from "../lib/sessions";
import { authorQuestionQueryKey } from "../lib/sessions";
import { useAppStore } from "../lib/store";
import { WorkspaceChat, type ChatMessage, type TurnResult } from "./WorkspaceChat";

const state = vi.hoisted(() => ({
  messages: [] as ChatMessage[],
  calls: 0,
  refCalls: 0,
  collect: false,
  cells: new Map<number, unknown>(),
  refs: new Map<number, { current: unknown }>(),
  tree: null as ReactNode,
  client: null as QueryClient | null,
  deliveries: [] as Array<{
    submission: AuthorActionSubmission;
    resolve: (result: AuthorActionSubmissionResult | null) => void;
  }>,
  historyCalls: [] as unknown[][],
  resolveSnapshot: null as ((snapshot: WorkspaceSessionSnapshot) => void) | null,
  resolvePage: null as ((page: WorkspaceSessionTranscriptPage) => void) | null,
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (!state.collect) return actual.useState(initial);
      const index = state.calls++;
      const value = index === 0 ? state.messages : initial;
      if (!state.cells.has(index)) {
        state.cells.set(index, typeof value === "function" ? (value as () => unknown)() : value);
      }
      return [
        state.cells.get(index),
        (update: unknown) => {
          const previous = state.cells.get(index);
          state.cells.set(
            index,
            typeof update === "function"
              ? (update as (previous: unknown) => unknown)(previous)
              : update,
          );
        },
      ];
    },
    useRef: (initial: unknown) => {
      if (!state.collect) return actual.useRef(initial);
      const index = state.refCalls++;
      if (!state.refs.has(index)) {
        // Supply the existing channel boundary; no editing-state slot is injected.
        state.refs.set(index, { current: index === 2 ? { topic: "editor-test" } : initial });
      }
      return state.refs.get(index)!;
    },
  };
});
vi.mock("@radix-ui/react-dialog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@radix-ui/react-dialog")>();
  return {
    ...actual,
    Portal: (props: ComponentProps<typeof actual.Portal>) => <>{props.children}</>,
  };
});
vi.mock("../lib/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/store")>();
  return {
    ...actual,
    // Server rendering otherwise always selects Zustand's startup snapshot.
    useAppStore: Object.assign(
      (selector: (value: ReturnType<typeof actual.useAppStore.getState>) => unknown) =>
        selector(actual.useAppStore.getState()),
      actual.useAppStore,
    ),
  };
});
vi.mock("../lib/authorActionSubmission", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/authorActionSubmission")>();
  return {
    ...actual,
    submitAndDeliverAuthorAction: (submission: AuthorActionSubmission) =>
      new Promise<AuthorActionSubmissionResult | null>((resolve) => {
        state.deliveries.push({ submission, resolve });
      }),
  };
});
vi.mock("../lib/sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/sessions")>();
  return {
    ...actual,
    getSessionSnapshot: (...args: Parameters<typeof actual.getSessionSnapshot>) =>
      new Promise<WorkspaceSessionSnapshot>((resolve) => {
        state.historyCalls.push(["snapshot", ...args]);
        state.resolveSnapshot = resolve;
      }),
    getSessionTranscriptPage: (...args: Parameters<typeof actual.getSessionTranscriptPage>) =>
      new Promise<WorkspaceSessionTranscriptPage>((resolve) => {
        state.historyCalls.push(["page", ...args]);
        state.resolvePage = resolve;
      }),
  };
});
function WorkspaceProbe() {
  state.collect = true;
  try {
    state.tree = WorkspaceChat();
    return state.tree;
  } finally {
    state.collect = false;
  }
}
function render(results: TurnResult[] = []) {
  if (!state.cells.has(0)) {
    state.messages = results.map((turnResult) => ({
      role: "assistant",
      text: turnResult.assistant_message?.text ?? "",
      turnId: turnResult.turn_id,
      turnResult,
    }));
  }
  state.calls = 0;
  state.refCalls = 0;
  const client = state.client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.client = client;
  client.setQueryData(authorQuestionQueryKey(useAppStore.getState().context.workId, null), []);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <WorkspaceProbe />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  state.messages = [];
  state.calls = 0;
  state.refCalls = 0;
  state.collect = false;
  state.cells.clear();
  state.refs.clear();
  state.tree = null;
  state.deliveries = [];
  state.historyCalls = [];
  state.resolveSnapshot = null;
  state.resolvePage = null;
  state.client?.clear();
  state.client = null;
  useAppStore.setState(useAppStore.getInitialState(), true);
});

type EditNode = ReactElement<{
  children?: ReactNode;
  card?: { candidate_set_ref?: string };
  renderArtifactActions?: () => ReactNode;
  open?: boolean;
  disabled?: boolean;
  value?: string;
  onClick?: () => void;
  onChange?: (event: { target: { value: string } }) => void;
  onOpenChange?: (open: boolean) => void;
  onOpenSearchHit?: (hit: SessionSearchHit) => void;
}>;

function elements(tree: ReactNode = state.tree): EditNode[] {
  const found: EditNode[] = [];
  Children.forEach(tree, (node) => {
    if (!isValidElement<EditNode["props"]>(node)) return;
    found.push(node);
    if (node.props.children != null) found.push(...elements(node.props.children));
  });
  return found;
}

function nodeText(tree: ReactNode): string {
  return Children.toArray(tree)
    .map((node) =>
      isValidElement<{ children?: ReactNode }>(node)
        ? nodeText(node.props.children)
        : typeof node === "string" || typeof node === "number"
          ? String(node)
          : "",
    )
    .join("");
}

function editor(): EditNode {
  const dialogs = elements().filter((node) => node.type === Dialog.Root && node.props.open);
  expect(dialogs).toHaveLength(1);
  return dialogs[0];
}

function editorFields() {
  return elements(editor()).filter((node) => node.type === "textarea");
}

function editorButton(label: string) {
  const button = elements(editor()).find(
    (node) => node.type === "button" && nodeText(node.props.children) === label,
  );
  expect(button).toBeDefined();
  return button!;
}

function openButton(target: string) {
  const card = elements().find((node) => node.props.card?.candidate_set_ref === target);
  expect(card?.props.renderArtifactActions).toBeTypeOf("function");
  const buttons = elements(card!.props.renderArtifactActions!()).filter(
    (node) => node.type === "button" && nodeText(node.props.children).includes("修改后保存"),
  );
  expect(buttons).toHaveLength(1);
  return buttons[0];
}

const ORIGINAL_OPENING = "  甲段。\r\n\r\n保留原始空白。\n";
const ORIGINAL_ENDING = "题字 target_segment_ids 属于故事正文。\n末句。  ";

type RevisionScope = "target_segments" | "whole_chapter";

function editingTurn(scope: RevisionScope = "target_segments"): TurnResult {
  const pending = ["draft-a", "draft-b"].map((id) => {
    const targets = [id + "-PRIVATE-0", id + "-PRIVATE-2"];
    return {
      artifact_id: id,
      artifact_type: "prose_fragment",
      adoption_status: "TENTATIVE" as const,
      requires_adoption: true,
      payload: {
        modification_scope: scope,
        scope:
          scope === "target_segments"
            ? { kind: scope, target_segment_ids: targets }
            : { kind: scope },
        adoption_effect:
          scope === "target_segments"
            ? { mode: "replace_segments", target_segment_ids: targets }
            : { mode: "replace_scope" },
        items: [
          {
            item_id: id + "-opening",
            title: "开端",
            body: ORIGINAL_OPENING,
            rationale: "收束重复。",
            ...(scope === "target_segments" ? { target_segment_ids: [targets[0]] } : {}),
          },
          {
            item_id: id + "-ending",
            title: "结尾",
            body: ORIGINAL_ENDING,
            rationale: "保留末句。",
            ...(scope === "target_segments" ? { target_segment_ids: [targets[1]] } : {}),
          },
        ],
      },
    };
  });
  return {
    schema_version: "3.0-draft",
    turn_id: "turn-edit",
    phase: "completed",
    status: "completed",
    next_action: "continue",
    assistant_message: { text: "两份独立候选，请分别决定。" },
    adoption_state: { pending, resolved: [] },
    ui_cards: pending.map((entry) => ({
      card_type: "candidate_set" as const,
      candidate_set_ref: entry.artifact_id,
      artifact_refs: [entry.artifact_id],
      artifact_type: "prose_fragment",
      items: entry.payload.items,
    })),
    available_actions: pending.map((entry) => ({
      action_id: "edit-" + entry.artifact_id,
      action_type: "edit_then_accept",
      target_ref: entry.artifact_id,
      enabled: true,
      idempotency_key: "key-" + entry.artifact_id,
    })),
  };
}

function startEditor(scope: RevisionScope = "target_segments") {
  const value = editingTurn(scope);
  render([value]);
  openButton("draft-a").props.onClick!();
  render([value]);
  return value;
}

async function deliver(status: "failed" | "duplicate") {
  const pending = state.deliveries[0];
  pending.submission.effects.settle();
  pending.resolve({ status });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("WorkspaceChat scoped prose editing ownership", () => {
  it("opens separate body fields for one proposal without exposing its machine bindings", () => {
    const value = startEditor();
    const original = JSON.stringify(value);
    expect(editorFields().map((node) => node.props.value)).toEqual([
      ORIGINAL_OPENING,
      ORIGINAL_ENDING,
    ]);
    const html = renderToStaticMarkup(editor());
    expect(html).toContain("开端");
    expect(html).toContain("结尾");
    expect(html).toContain("题字 target_segment_ids 属于故事正文。");
    expect(html).not.toContain("PRIVATE");
    expect(html).not.toContain("draft-a-opening");
    expect(html).not.toContain('type="radio"');
    expect(
      elements(editor()).filter(
        (node) => node.type === "button" && nodeText(node.props.children) === "保存修改后的版本",
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(value)).toBe(original);
  });

  it.each(["target_segments", "whole_chapter"] as const)(
    "submits one %s proposal with exact body bytes",
    async (scope) => {
      const value = startEditor(scope);
      expect(editorFields()).toHaveLength(2);
      editorFields()[0].props.onChange!({ target: { value: "  改写甲。\n\n新段。\n " } });
      render([value]);
      editorButton("保存修改后的版本").props.onClick!();
      expect(state.deliveries).toHaveLength(1);
      expect(state.deliveries[0].submission.action).toEqual({
        source_turn_ref: "turn-edit",
        action_id: "edit-draft-a",
        action_type: "edit_then_accept",
        target_ref: "draft-a",
        idempotency_key: "key-draft-a",
        payload: {
          edited_items: [
            { item_id: "draft-a-opening", body: "  改写甲。\n\n新段。\n " },
            { item_id: "draft-a-ending", body: "题字 target_segment_ids 属于故事正文。\n末句。  " },
          ],
        },
      });
      await deliver("duplicate");
      render([value]);
      expect(elements().filter((node) => node.type === Dialog.Root && node.props.open)).toEqual([]);
    },
  );

  it("retains every failed edit, then cancels and reopens from the original candidate", async () => {
    const value = startEditor();
    expect(editorFields()).toHaveLength(2);
    editorFields()[0].props.onChange!({ target: { value: "  作者的新开端。\n " } });
    render([value]);
    editorFields()[1].props.onChange!({ target: { value: "\n作者的新结尾。  " } });
    render([value]);
    editorButton("保存修改后的版本").props.onClick!();
    await deliver("failed");
    render([value]);
    expect(editorFields().map((node) => node.props.value)).toEqual([
      "  作者的新开端。\n ",
      "\n作者的新结尾。  ",
    ]);
    expect(renderToStaticMarkup(editor())).toContain("你的编辑内容已保留");
    editorButton("取消").props.onClick!();
    render([value]);
    openButton("draft-a").props.onClick!();
    render([value]);
    expect(editorFields().map((node) => node.props.value)).toEqual([
      ORIGINAL_OPENING,
      ORIGINAL_ENDING,
    ]);
    expect(state.deliveries).toHaveLength(1);
  });

  it("blocks controlled dismissal and a queued other-target opener during submission", async () => {
    const value = startEditor();
    const openOther = openButton("draft-b").props.onClick!;
    editorFields()[0].props.onChange!({ target: { value: "A 的提交正文。" } });
    render([value]);
    editorButton("保存修改后的版本").props.onClick!();
    render([value]);
    expect(editorButton("取消").props.disabled).toBe(true);
    expect(editorButton("保存修改后的版本").props.disabled).toBe(true);
    editor().props.onOpenChange!(false);
    openOther();
    render([value]);
    expect(editorFields()[0].props.value).toBe("A 的提交正文。");
    expect(state.deliveries).toHaveLength(1);
    await deliver("failed");
  });

  it.each(["target_segments", "whole_chapter"] as const)(
    "rejects invalid item mapping for %s without opening a flat editor",
    (scope) => {
      const value = editingTurn(scope);
      const items = value.adoption_state!.pending[0].payload.items as Array<
        Record<string, unknown>
      >;
      const first = items[0];
      if (scope === "target_segments") {
        delete first.target_segment_ids;
      } else {
        first.target_segment_ids = null;
      }
      render([value]);
      openButton("draft-a").props.onClick!();
      render();
      expect(elements().filter((node) => node.type === Dialog.Root && node.props.open)).toEqual([]);
      expect(state.deliveries).toHaveLength(0);
    },
  );

  it.each(["failed", "duplicate"] as const)(
    "keeps the edit locked through early settle until the %s delivery is terminal",
    async (status) => {
      const value = startEditor();
      const openOther = openButton("draft-b").props.onClick!;
      editorFields()[0].props.onChange!({ target: { value: "A 的未完成提交。" } });
      render([value]);
      editorButton("保存修改后的版本").props.onClick!();
      const pending = state.deliveries[0];
      // Settling transport is not the final delivery consumed by the editing Dialog.
      pending.submission.effects.settle();
      render([value]);
      expect(editorButton("取消").props.disabled).toBe(true);
      editorButton("取消").props.onClick!();
      openOther();
      render([value]);
      expect(editorFields()[0].props.value).toBe("A 的未完成提交。");
      pending.resolve({ status });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      render([value]);
      if (status === "failed") {
        expect(editorFields()[0].props.value).toBe("A 的未完成提交。");
        expect(renderToStaticMarkup(editor())).toContain("你的编辑内容已保留");
        editorButton("取消").props.onClick!();
        render([value]);
      } else {
        expect(elements().filter((node) => node.type === Dialog.Root && node.props.open)).toEqual(
          [],
        );
      }
      openButton("draft-b").props.onClick!();
      render([value]);
      expect(editorFields().map((node) => node.props.value)).toEqual([
        ORIGINAL_OPENING,
        ORIGINAL_ENDING,
      ]);
      expect(renderToStaticMarkup(editor())).not.toContain("你的编辑内容已保留");
      expect(state.deliveries).toHaveLength(1);
    },
  );
  it("invalidates the old edit when delayed history commits and ignores the old null delivery", async () => {
    useAppStore.getState().setContext({ workId: "work-edit" });
    const value = editingTurn();
    render([value]);
    const history = elements().find((node) => typeof node.props.onOpenSearchHit === "function");
    expect(history).toBeDefined();
    history!.props.onOpenSearchHit!({
      session_id: "history-session",
      turn_id: "history-turn",
      session_title: "历史会话",
      role: "user",
      snippet: "历史正文",
      inserted_at: null,
    });
    expect(state.historyCalls).toEqual([
      ["snapshot", "work-edit", "history-session"],
      ["page", "work-edit", "history-session", { aroundTurnId: "history-turn" }],
    ]);
    openButton("draft-a").props.onClick!();
    render();
    editorFields()[0].props.onChange!({ target: { value: "仍属于原候选的编辑。" } });
    render();
    editorButton("保存修改后的版本").props.onClick!();
    render();
    expect(editorButton("取消").props.disabled).toBe(true);

    const session = {
      id: "history-session",
      work_id: "work-edit",
      title: "历史会话",
      summary: null,
      status: "ARCHIVED" as const,
      source_session_ref: null,
      source_turn_ref: null,
      last_opened_at: null,
      updated_at: null,
      inserted_at: null,
    };
    const transcript = [
      {
        turn_id: "history-turn",
        role: "user" as const,
        text: "已加载的只读历史正文。",
        turn_result: null,
      },
    ];
    const page = {
      limit: 20,
      returned_count: 1,
      has_more_before: false,
      before_id: null,
      after_id: null,
    };
    state.resolveSnapshot!({
      work: {
        id: "work-edit",
        title: "测试作品",
        genre: null,
        status: "ACTIVE",
        updated_at: null,
        inserted_at: null,
      },
      session,
      read_only: true,
      transcript,
      transcript_page: page,
      pending_adoptions: [],
      resolved_adoptions: [],
      resume_trace_refs: [],
    });
    state.resolvePage!({
      work_id: "work-edit",
      session,
      read_only: true,
      transcript,
      transcript_page: page,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const beforeDelivery = render();
    expect(elements().filter((node) => node.type === Dialog.Root && node.props.open)).toEqual([]);
    expect(beforeDelivery).toContain("已加载的只读历史正文。");
    expect(state.deliveries[0].submission.getCurrentScope().sessionId).toBe("history-session");

    // The existing submission owner returns null for this changed session; it owns that verdict.
    state.deliveries[0].resolve(null);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const afterDelivery = render();
    expect(elements().filter((node) => node.type === Dialog.Root && node.props.open)).toEqual([]);
    expect(afterDelivery).toContain("已加载的只读历史正文。");
    expect(afterDelivery).not.toContain("你的编辑内容已保留");
    expect(state.deliveries).toHaveLength(1);
  });
});
