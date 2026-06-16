# AI Novel Studio Frontend

This frontend is part of the AI Novel Studio Tauri desktop application.

## Run

```bash
pnpm tauri dev
```

## Local checks

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm check
pnpm build
pnpm tauri build
```

## Scenario acceptance

```bash
bash ../scripts/quality_accept.sh --list
bash ../scripts/quality_accept.sh --tier pr-smoke
bash ../scripts/quality_accept.sh au03-context-source-ui --surface tauri
```

## Rules

- Desktop-first: do not assume browser-only runtime.
- Use `frontend/src/lib/env.ts` for platform/environment abstraction.
- Do not add acceptance-only DOM hooks.
- Do not add `data-testid` for scenario acceptance.
- Prefer visible semantics: role, label, placeholder, button text, visible page text.
- User-visible copy belongs in `frontend/src/lib/copy.ts`.
- UI components must keep design trace headers when required by project rules.
