# CI Gates

CI 分为 PR Blocking、Nightly / Stage、Release Candidate 三层。轻量、确定、可快速失败的检查进入 PR；重型 Tauri 场景和真实 LLM 验收进入 nightly 或 release gate。

## PR Blocking

目标 PR blocking 命令：

```bash
mix check
mix run scripts/check_single_call_protocol.exs   # 单调用协议源码守卫（B26 CP2，2026-11-04 从测试迁出）
cd frontend && pnpm check && pnpm build
cd frontend && pnpm tauri build
MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs
bash scripts/ai_static_scan.sh --top 10 --quick
bash scripts/quality_manifest_check.sh
node --test scripts/check_module_size.test.mjs && node scripts/check_module_size.mjs --check   # 模块规模 ratchet（CI static-scan job 显式 step + 扫描 check）
node --test scripts/lib/quality/*.test.mjs   # manifest/verdict/e2e/批次负例回归（CI quality-manifest job 已执行）
```

当前 CI 已覆盖 backend compile/test/arch/ADR/I1/I2/I3、frontend lint/test/build/audit/design trace、static scan、模块规模 ratchet。`quality_manifest_check.sh` 是质量体系的 manifest 门禁（B41 CP1 起使用 PyYAML 标准解析器 + 单一 `scripts/lib/quality/manifest.mjs` 语义校验）；CI 的 `Quality manifest` job 会固定安装 `pyyaml==6.0.3` 并先跑 `node --test scripts/lib/quality/*.test.mjs` 负例测试。

2026-11-04 测试提速起：CI `backend` job 跑 PR 快集 `mix test --exclude slow`；全量测试（含 `@tag :slow`）由 `.github/workflows/nightly.yml` 每天 UTC 18:00 / 手动触发承接。`--exclude slow` 在尚未标注慢集时等价全量，慢集标注按实测补充（本轮已迁出/消除的慢项见 `artifacts/test-audit/SUMMARY.md` §8）。

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
