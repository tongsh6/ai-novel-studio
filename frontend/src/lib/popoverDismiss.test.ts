import { describe, expect, it, vi } from "vitest";
import { installDetailsDismiss } from "./popoverDismiss";

function fakeDetails(open = true) {
  const summaryFocus = vi.fn();
  const details = {
    open,
    contains: (target: unknown) => target === "inside",
    querySelector: (selector: string) => (selector === "summary" ? { focus: summaryFocus } : null),
  };
  return { details, summaryFocus };
}

function fakeTarget() {
  const handlers = new Map<string, (event: unknown) => void>();
  const target = {
    handlers,
    addEventListener: (type: string, listener: (event: unknown) => void) => handlers.set(type, listener),
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      if (handlers.get(type) === listener) handlers.delete(type);
    },
  };
  return target;
}

describe("弹层关闭手势", () => {
  it("点击外部关闭；点击弹层内部不关闭", () => {
    const { details } = fakeDetails();
    const target = fakeTarget();
    const cleanup = installDetailsDismiss(details, target);
    target.handlers.get("pointerdown")?.({ target: "inside" });
    expect(details.open).toBe(true);
    target.handlers.get("pointerdown")?.({ target: "outside" });
    expect(details.open).toBe(false);
    cleanup();
    expect(target.handlers.size).toBe(0);
  });

  it("Esc 关闭并把焦点返回 summary 触发器", () => {
    const { details, summaryFocus } = fakeDetails();
    const target = fakeTarget();
    installDetailsDismiss(details, target);
    target.handlers.get("keydown")?.({ key: "Escape" });
    expect(details.open).toBe(false);
    expect(summaryFocus).toHaveBeenCalledTimes(1);
  });

  it("已关闭时不再触发关闭副作用", () => {
    const { details } = fakeDetails(false);
    const target = fakeTarget();
    const onClosed = vi.fn();
    installDetailsDismiss(details, target, onClosed);
    target.handlers.get("pointerdown")?.({ target: "outside" });
    target.handlers.get("keydown")?.({ key: "Escape" });
    expect(onClosed).not.toHaveBeenCalled();
  });
});
