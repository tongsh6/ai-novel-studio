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
# 批次语义（B41 CP2）：active-only；blocked 记 skipped+reason 不中止；汇总在
# artifacts/quality-accept/batches/<...>/batch.json；退出码 0/1/65/66/67/69。
bash scripts/quality_accept.sh au03-context-source-ui --surface tauri
```

## Quality Manifests

`quality/acceptance/**` 的 manifest 门禁使用标准 YAML 解析器（PyYAML），不使用正则解析。

```bash
python3 -m pip install 'pyyaml==6.0.3'   # 一次性本地依赖（缺失时门禁硬失败）
bash scripts/quality_manifest_check.sh
node --test scripts/lib/quality/*.test.mjs
```

`quality_accept.sh` 执行前会先做同一校验；非法 manifest 不会进入运行（退出 66）。
