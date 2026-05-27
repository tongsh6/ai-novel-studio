# Acceptance Tiers

| Tier | Surface | 用途 |
|---|---|---|
| `pr-smoke` | browser 或 tauri | 小范围、高价值、可快速诊断的场景 |
| `nightly` | tauri | 重型真实桌面用户路径 |
| `known-gap` | browser 或 tauri | 已登记但当前不可作为 gate 执行的场景 |
| `release` | tauri | planned deterministic provider release candidate 验收 |
| `release-real-llm` | tauri | planned 真实 LM Studio provider 验收 |

## PR Smoke

PR smoke 不应把所有 Tauri 场景塞进 blocking job。它只用于防止 manifest 漏登记和最核心路径回归。

Tauri PR smoke scenario gate is not yet PR-blocking because no stable passing Tauri scenario is registered. 已知失败场景不得保留在 `pr-smoke` 中；例如 `p1-chapter-plan-minimum` 当前登记为 `known-gap`。

## Nightly

Nightly 通过真实 Tauri 窗口和外部 UI driver 覆盖长会话、上下文来源、采纳边界、冲突恢复和章节生成。

## Release

Status: planned, not yet enforced.

Release candidate 至少跑 deterministic provider；真实 LLM gate 应在本地 LM Studio 或自托管 runner 上执行，并上传 LLM call evidence。

以下是目标命令。它们必须在 `quality/acceptance/scenarios.yml` 登记 release-tier 场景后才能作为当前 gate 执行：

```bash
bash scripts/quality_accept.sh --tier release --surface tauri --provider slice_verify
bash scripts/quality_accept.sh --tier release-real-llm --surface tauri --provider lmstudio
```

当前没有 release / release-real-llm 场景登记；因此这些命令返回 no scenarios 与文档状态一致，不能作为当前 release gate。
