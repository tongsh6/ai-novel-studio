// B75：原生 <details> 弹层统一关闭手势（click-outside / Esc）。
// 纯事件装配逻辑，便于在不依赖 jsdom 的 node 测试中断言；产品组件只负责传 ref 与回调。

export type DismissableDetails = {
  open: boolean;
  contains: (target: Node) => boolean;
  querySelector: (selector: string) => { focus?: () => void } | null;
};

export type DismissEventTarget = Pick<Document, "addEventListener" | "removeEventListener">;

type DismissEvent = Event & { key?: string; target?: EventTarget | null };

export function installDetailsDismiss(
  details: DismissableDetails,
  target: DismissEventTarget,
  onClosed?: () => void,
): () => void {
  const onPointerDown = (event: Event) => {
    const typed = event as DismissEvent;
    if (!details.open) return;
    if (details.contains(typed.target as Node)) return;
    details.open = false;
    onClosed?.();
  };

  const onKeyDown = (event: Event) => {
    const typed = event as DismissEvent;
    if (!details.open || typed.key !== "Escape") return;
    details.open = false;
    details.querySelector("summary")?.focus?.();
    onClosed?.();
  };

  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("keydown", onKeyDown);

  return () => {
    target.removeEventListener("pointerdown", onPointerDown);
    target.removeEventListener("keydown", onKeyDown);
  };
}
