# Local Gates

本地开发优先跑最小但有代表性的 gate，避免把一次性人工确认伪装成已闭环。

## Backend

```bash
mix format --check-formatted
mix compile --warnings-as-errors
mix test
mix run scripts/arch_check.exs
```

如果 `mix test` 因本地 SQLite 并发偶发失败，可用 `mix test --max-cases 1` 复跑确认。

## Frontend

```bash
cd frontend && pnpm typecheck && pnpm lint && pnpm test && pnpm build
bash scripts/frontend_audit.sh
bash scripts/check_design_trace.sh
```

## Runtime Invariants

```bash
MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs
```

## Scenario Acceptance

```bash
bash scripts/quality_accept.sh --list
bash scripts/quality_accept.sh --tier pr-smoke
bash scripts/quality_accept.sh au03-context-source-ui --surface tauri
```
