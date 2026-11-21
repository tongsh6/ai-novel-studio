// Design: docs/design/ui/46-state-and-feedback.md §9.10; desktop §6.1
// Prototype: novel-studio.pen → B85A1 / B85A2 / B85A3
// Sole consumer: the existing WorkspaceChat model-provider Dialog.
// Local presentation only: runtime facts and desktop saved facts remain separate.
import { useEffect, useRef, useState } from "react";
import { WORKBENCH } from "../lib/copy";
import { isTauri } from "../lib/env";
import {
  getModelContextWindow,
  setModelContextWindow,
  type ContextWindowRuntime,
} from "../lib/modelContextWindow";
import { getProviderOptions, type ProviderId } from "../lib/modelProvider";
import styles from "./WorkspaceChat.module.css";
import contextStyles from "./ModelContextWindowSettings.module.css";

type View = {
  provider: ProviderId;
  runtime: ContextWindowRuntime | null;
  saved: number | null | undefined;
  draft: string;
  loading: boolean;
  saving: boolean;
  message: string;
  messageKind: "status" | "error";
  edited: boolean;
};
const initial = (provider: ProviderId): View => ({
  provider,
  runtime: null,
  saved: undefined,
  draft: "",
  loading: true,
  saving: false,
  message: "",
  messageKind: "status",
  edited: false,
});
function patch(previous: View, provider: ProviderId, update: Partial<View>): View {
  return { ...(previous.provider === provider ? previous : initial(provider)), ...update };
}
function parsedDraft(value: string): number | null | undefined {
  if (value.trim() === "") return null;
  if (!/^[0-9]+$/.test(value.trim())) return undefined;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 4294967295 ? number : undefined;
}

export function ModelContextWindowSettings({ provider }: { provider: ProviderId }) {
  const ownerRef = useRef<{ provider: ProviderId; active: boolean; busy: boolean } | null>(null);
  const [state, setState] = useState<View>(() => initial(provider));
  const view = state.provider === provider ? state : initial(provider);
  useEffect(() => {
    const owner = { provider, active: true, busy: false };
    ownerRef.current = owner;
    const current = () => owner.active && ownerRef.current === owner;
    void getProviderOptions()
      .then((options) => {
        if (current())
          setState((old) =>
            patch(old, provider, {
              runtime:
                options.providers.find((option) => option.id === provider)?.context_window ?? null,
            }),
          );
      })
      .catch(() => {
        if (current()) setState((old) => patch(old, provider, { runtime: null }));
      });
    if (isTauri) {
      void getModelContextWindow(provider)
        .then((saved) => {
          if (current())
            setState((old) =>
              patch(old, provider, {
                saved: saved.saved_window,
                draft: saved.saved_window === null ? "" : String(saved.saved_window),
                loading: false,
              }),
            );
        })
        .catch(() => {
          if (current())
            setState((old) => patch(old, provider, { saved: undefined, loading: false }));
        });
    }
    return () => {
      owner.active = false;
    };
  }, [provider]);

  async function save(value: number | null | undefined, explicitClear = false) {
    const owner = ownerRef.current;
    if (!isTauri || !owner || owner.provider !== provider || !owner.active || owner.busy) return;
    if (value === null && view.saved === undefined && !view.edited && !explicitClear) {
      setState((old) =>
        patch(old, provider, {
          message: WORKBENCH.contextWindowSavedUnknown,
          messageKind: "error",
        }),
      );
      return;
    }
    if (value === undefined) {
      setState((old) =>
        patch(old, provider, { message: WORKBENCH.contextWindowInvalid, messageKind: "error" }),
      );
      return;
    }
    owner.busy = true;
    const current = () => owner.active && ownerRef.current === owner;
    setState((old) => patch(old, provider, { saving: true, message: "" }));
    try {
      const result = await setModelContextWindow(provider, value);
      if (current())
        setState((old) =>
          patch(old, provider, {
            saved: result.saved_window,
            draft: result.saved_window === null ? "" : String(result.saved_window),
            message: WORKBENCH.contextWindowSaved,
            messageKind: "status",
          }),
        );
    } catch {
      if (current()) {
        setState((old) =>
          patch(old, provider, {
            saved: undefined,
            message: WORKBENCH.contextWindowUnconfirmed,
            messageKind: "error",
          }),
        );
        // A rejected IPC response does not prove the write failed. Re-read once, never retry the write.
        try {
          const result = await getModelContextWindow(provider);
          if (current()) setState((old) => patch(old, provider, { saved: result.saved_window }));
        } catch {
          if (current()) setState((old) => patch(old, provider, { saved: undefined }));
        }
      }
    } finally {
      owner.busy = false;
      if (current()) setState((old) => patch(old, provider, { saving: false }));
    }
  }

  return (
    <section className={contextStyles.section} aria-label={WORKBENCH.contextWindowTitle}>
      <h3 className={styles.dialogLabel}>{WORKBENCH.contextWindowTitle}</h3>
      <p className={styles.dialogHint}>
        {view.runtime
          ? WORKBENCH.contextWindowCurrent(view.runtime.effective_tokens)
          : WORKBENCH.contextWindowRuntimeUnknown}
      </p>
      {view.runtime && (
        <p className={styles.dialogHint}>
          {view.runtime.source === "runtime_override"
            ? WORKBENCH.contextWindowOverride
            : WORKBENCH.contextWindowDefault(view.runtime.default_tokens)}
        </p>
      )}
      {isTauri ? (
        <>
          <p className={styles.dialogHint}>
            {view.saved === undefined
              ? WORKBENCH.contextWindowSavedUnknown
              : view.saved === null
                ? WORKBENCH.contextWindowNoSaved
                : WORKBENCH.contextWindowSavedValue(view.saved)}
          </p>
          <label className={styles.dialogLabel} htmlFor="model-context-window">
            {WORKBENCH.contextWindowInput}
          </label>
          <input
            id="model-context-window"
            className={styles.dialogInput}
            inputMode="numeric"
            value={view.draft}
            disabled={view.loading || view.saving}
            onChange={(event) =>
              setState((old) =>
                patch(old, provider, { draft: event.target.value, message: "", edited: true }),
              )
            }
          />
          <p className={styles.dialogHint}>{WORKBENCH.contextWindowRestart}</p>
          {view.message && (
            <p
              role={view.messageKind === "error" ? "alert" : "status"}
              className={view.messageKind === "error" ? styles.dialogError : styles.dialogHint}
            >
              {view.message}
            </p>
          )}
          <div className={styles.dialogActions}>
            <button
              type="button"
              className={styles.btnSecondary}
              disabled={view.loading || view.saving}
              onClick={() => {
                void save(null, true);
              }}
            >
              {WORKBENCH.contextWindowClear}
            </button>
            <button
              type="button"
              className={styles.sendBtn}
              disabled={view.loading || view.saving}
              onClick={() => {
                void save(parsedDraft(view.draft));
              }}
            >
              {view.saving ? WORKBENCH.contextWindowSaving : WORKBENCH.contextWindowSave}
            </button>
          </div>
        </>
      ) : (
        <p className={styles.dialogHint}>{WORKBENCH.contextWindowDesktopOnly}</p>
      )}
    </section>
  );
}
