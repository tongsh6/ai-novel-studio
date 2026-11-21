// B85 lifecycle unit tests execute the real component handlers with controlled async IO.
// These are not browser/native acceptance; the release Dialog is verified separately.
import { beforeEach, describe, expect, it, vi } from "vitest";
import styles from "./WorkspaceChat.module.css";
import type { ReactElement } from "react";

const h = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void)[],
  cleanups: [] as (() => void)[],
  desktop: true,
}));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const n = h.cursor++;
    if (!(n in h.slots))
      h.slots[n] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [
      h.slots[n],
      (v: unknown) => {
        h.slots[n] =
          typeof v === "function" ? (v as (previous: unknown) => unknown)(h.slots[n]) : v;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const n = h.cursor++;
    if (!(n in h.slots)) h.slots[n] = { current: initial };
    return h.slots[n];
  },
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => {
    const n = h.cursor++;
    const old = h.slots[n] as unknown[] | undefined;
    if (!old || deps.some((x, i) => x !== old[i])) {
      h.slots[n] = deps;
      h.effects.push(() => {
        h.cleanups[n]?.();
        const cleanup = fn();
        h.cleanups[n] = cleanup || (() => {});
      });
    }
  },
}));
vi.mock("../lib/env", () => ({
  get isTauri() {
    return h.desktop;
  },
}));
const api = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), options: vi.fn() }));
vi.mock("../lib/modelContextWindow", () => ({
  getModelContextWindow: api.get,
  setModelContextWindow: api.set,
}));
vi.mock("../lib/modelProvider", () => ({ getProviderOptions: api.options }));
import { ModelContextWindowSettings } from "./ModelContextWindowSettings";
import { WORKBENCH } from "../lib/copy";

type Node = ReactElement<Record<string, unknown>>;
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const n = value as Node;
  return [n, ...nodes(n.props.children)];
}
function render(provider: "splash" | "deepseek" = "splash") {
  h.cursor = 0;
  const tree = ModelContextWindowSettings({ provider });
  for (const run of h.effects.splice(0)) run();
  return nodes(tree);
}
function text(ns: Node[]) {
  return ns
    .flatMap((n) => (typeof n.props.children === "string" ? [n.props.children] : []))
    .join(" ");
}
function button(ns: Node[], label: string) {
  const n = ns.find((n) => n.type === "button" && n.props.children === label);
  if (!n) throw new Error("missing button " + label);
  return n.props;
}
function edit(ns: Node[], value: string) {
  const n = ns.find((n) => n.type === "input")!;
  (n.props.onChange as (e: unknown) => void)({ target: { value } });
}
function click(ns: Node[], label: string) {
  (button(ns, label).onClick as () => void)();
}
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function stop() {
  for (const f of h.cleanups) f?.();
  h.cleanups = [];
}
beforeEach(() => {
  stop();
  h.slots = [];
  h.cursor = 0;
  h.effects = [];
  h.desktop = true;
  vi.clearAllMocks();
  api.get.mockResolvedValue({ provider: "splash", saved_window: null });
  api.set.mockImplementation((p: string, w: number | null) =>
    Promise.resolve({ provider: p, saved_window: w }),
  );
  api.options.mockResolvedValue({
    providers: [
      {
        id: "splash",
        context_window: {
          effective_tokens: 32000,
          default_tokens: 32000,
          source: "conservative_default",
        },
      },
    ],
  });
});

describe("context settings visual states", () => {
  it("keeps independent section spacing and a divider in scoped CSS", async () => {
    const { readFileSync } = (await import("node:" + "fs")) as {
      readFileSync: (path: URL, encoding: string) => string;
    };
    const css = readFileSync(
      new URL("./ModelContextWindowSettings.module.css", import.meta.url),
      "utf8",
    );
    expect(css).toMatch(/display:\s*flex/);
    expect(css).toMatch(/flex-direction:\s*column/);
    expect(css).toMatch(/gap:\s*10px/);
    expect(css).toMatch(/border-top:\s*1px solid var\(--border-subtle\)/);
  });
  it("renders invalid and unconfirmed outcomes as errors, confirmed saved as ordinary status", async () => {
    render();
    await settle();
    edit(render(), "0");
    click(render(), WORKBENCH.contextWindowSave);
    expect(
      render().find((n) => n.props.children === WORKBENCH.contextWindowInvalid)?.props.className,
    ).toBe(styles.dialogError);
    edit(render(), "64000");
    api.set.mockRejectedValueOnce(new Error("IPC uncertain"));
    click(render(), WORKBENCH.contextWindowSave);
    await settle();
    expect(
      render().find((n) => n.props.children === WORKBENCH.contextWindowUnconfirmed)?.props.role,
    ).toBe("alert");
    click(render(), WORKBENCH.contextWindowSave);
    await settle();
    expect(
      render().find((n) => n.props.children === WORKBENCH.contextWindowSaved)?.props.role,
    ).toBe("status");
    expect(
      render().find((n) => n.props.children === WORKBENCH.contextWindowSaved)?.props.className,
    ).toBe(styles.dialogHint);
  });
});

describe("ModelContextWindowSettings", () => {
  it("shows current and saved separately; saving never claims runtime changed", async () => {
    render();
    await settle();
    let ns = render();
    edit(ns, "64000");
    ns = render();
    click(ns, WORKBENCH.contextWindowSave);
    await settle();
    ns = render();
    expect(api.set).toHaveBeenCalledWith("splash", 64000);
    expect(text(ns)).toContain("32,000");
    expect(text(ns)).toContain("64,000");
    expect(text(ns)).toContain(WORKBENCH.contextWindowSaved);
  });
  it("clear dispatches null but never rewrites current runtime", async () => {
    api.get.mockResolvedValue({ provider: "splash", saved_window: 64000 });
    render();
    await settle();
    click(render(), WORKBENCH.contextWindowClear);
    await settle();
    expect(api.set).toHaveBeenCalledWith("splash", null);
    expect(text(render())).toContain("32,000");
  });
  it("invalid numeric input does not call IPC", async () => {
    render();
    await settle();
    for (const v of ["0", "-1", "1.2", "1e4", "4294967296", "abc"]) {
      edit(render(), v);
      click(render(), WORKBENCH.contextWindowSave);
    }
    expect(api.set).not.toHaveBeenCalled();
    expect(text(render())).toContain(WORKBENCH.contextWindowInvalid);
  });
  it("same-tick duplicate clicks cannot duplicate a pending write", async () => {
    const wait = deferred<unknown>();
    api.set.mockReturnValue(wait.promise);
    render();
    await settle();
    edit(render(), "64000");
    const ns = render();
    click(ns, WORKBENCH.contextWindowSave);
    click(ns, WORKBENCH.contextWindowSave);
    expect(api.set).toHaveBeenCalledTimes(1);
    wait.resolve({ provider: "splash", saved_window: 64000 });
    await settle();
  });
  it("unknown write result rereads saved facts without losing draft or fabricating unchanged", async () => {
    api.set.mockRejectedValue(new Error("lost IPC response"));
    render();
    await settle();
    edit(render(), "64000");
    api.get.mockResolvedValue({ provider: "splash", saved_window: 64000 });
    click(render(), WORKBENCH.contextWindowSave);
    await settle();
    expect(text(render())).toContain(WORKBENCH.contextWindowUnconfirmed);
    expect(text(render())).toContain("64,000");
    expect(render().find((n) => n.type === "input")?.props.value).toBe("64000");
  });
  it("failed reread is unknown, not the old saved value", async () => {
    api.get.mockResolvedValue({ provider: "splash", saved_window: 64000 });
    render();
    await settle();
    edit(render(), "96000");
    api.set.mockRejectedValue(new Error("lost"));
    api.get.mockRejectedValue(new Error("read failed"));
    click(render(), WORKBENCH.contextWindowSave);
    await settle();
    expect(text(render())).toContain(WORKBENCH.contextWindowSavedUnknown);
    expect(text(render())).not.toContain("64,000");
  });
  it("late previous provider read cannot overwrite new provider", async () => {
    const old = deferred<unknown>();
    api.get
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue({ provider: "deepseek", saved_window: 128000 });
    render();
    render("deepseek");
    await settle();
    old.resolve({ provider: "splash", saved_window: 64000 });
    await settle();
    expect(text(render("deepseek"))).toContain("128,000");
    expect(text(render("deepseek"))).not.toContain("64,000");
  });
  it("close cancels presentation, not writes; reopen reads actual saved fact", async () => {
    const wait = deferred<unknown>();
    api.set.mockReturnValue(wait.promise);
    render();
    await settle();
    edit(render(), "64000");
    click(render(), WORKBENCH.contextWindowSave);
    stop();
    wait.resolve({ provider: "splash", saved_window: 64000 });
    await settle();
    h.slots = [];
    api.get.mockResolvedValue({ provider: "splash", saved_window: 64000 });
    render();
    await settle();
    expect(text(render())).toContain("64,000");
  });
  it("unconfirmed runtime remains unknown, browser has no save", async () => {
    h.desktop = false;
    api.options.mockRejectedValue(new Error("offline"));
    render();
    await settle();
    const ns = render();
    expect(text(ns)).toContain(WORKBENCH.contextWindowRuntimeUnknown);
    expect(text(ns)).toContain(WORKBENCH.contextWindowDesktopOnly);
    expect(ns.filter((n) => n.type === "input")).toHaveLength(0);
    expect(api.get).not.toHaveBeenCalled();
  });
  it("unknown saved value cannot turn untouched empty draft into implicit clear", async () => {
    api.get.mockRejectedValue(new Error("invalid stored zero"));
    render();
    await settle();
    click(render(), WORKBENCH.contextWindowSave);
    await settle();
    expect(api.set).not.toHaveBeenCalled();
    click(render(), WORKBENCH.contextWindowClear);
    await settle();
    expect(api.set).toHaveBeenCalledWith("splash", null);
  });
  it("cancel without save never dispatches and fresh opening discards edits", async () => {
    render();
    await settle();
    edit(render(), "64000");
    stop();
    h.slots = [];
    render();
    await settle();
    expect(render().find((n) => n.type === "input")?.props.value).toBe("");
    expect(api.set).not.toHaveBeenCalled();
  });
});
