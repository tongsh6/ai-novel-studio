# CI Gates

CI 分为 PR Blocking、Nightly / Stage、Release Candidate 三层。轻量、确定、可快速失败的检查进入 PR；重型 Tauri 场景和真实 LLM 验收进入 nightly 或 release gate。

## PR Blocking

目标 PR blocking 命令：

```bash
mix check
cd frontend && pnpm check && pnpm build
cd frontend && pnpm tauri build
MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs
bash scripts/ai_static_scan.sh --top 10 --quick
bash scripts/quality_manifest_check.sh
```

当前 CI 已覆盖 backend compile/test/arch/ADR/I1/I2/I3、frontend lint/test/build/audit/design trace、static scan。`quality_manifest_check.sh` 是本次质量体系新增的 manifest 门禁。

## Historical Secret Removal

Gitleaks previously detected `tools/company-console/server/config.mjs:4` in Git history. Anthropic-compatible company-console integration is not part of the current product scope, so that historical config file has been removed from the current branch history instead of being allowlisted.

Do not reintroduce provider tokens or Anthropic-compatible credentials in source. If this integration is revived, credentials must come from environment variables or local untracked configuration.

## Known CI Gap

`pnpm tauri build` is required by desktop-first rules, but is not yet PR-blocking because GitHub runner dependencies are not stabilized. It must be enforced in nightly or self-hosted release gate until PR runner support is ready.

## Nightly / Stage

建议入口：

```bash
bash scripts/quality_accept.sh --tier nightly --surface tauri
```

Nightly / Stage 应覆盖：

- long session compression
- context source UI
- candidate adoption bridge
- adoption safety freshness
- stale conflict
- cross-work conflict
- canon conflict
- chapter draft generation

## Release Candidate

Status: planned, not yet enforced.

The following commands are target commands and must not be treated as currently executable until release-tier scenarios are registered in `quality/acceptance/scenarios.yml`.

```bash
bash scripts/quality_accept.sh --tier release --surface tauri --provider slice_verify
bash scripts/quality_accept.sh --tier release-real-llm --surface tauri --provider lmstudio
```

Current status: no `release` or `release-real-llm` scenarios are registered. Release Candidate gates are planned targets, not current gates.

Release Candidate 必须上传 `artifacts/slice-verify/**`、`artifacts/scenario-invariants/**` 和 `artifacts/static-scan/**` 作为 workflow artifacts，并保留失败诊断。
