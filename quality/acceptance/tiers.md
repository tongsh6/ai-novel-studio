# Acceptance Tiers

| Tier | Surface | 用途 |
|---|---|---|
| `pr-smoke` | browser 或 tauri | 小范围、高价值、可快速诊断的场景 |
| `nightly` | tauri | 重型真实桌面用户路径 |
| `known-gap` | browser 或 tauri | 已登记但当前不可作为 gate 执行的场景 |
| `release` | tauri | deterministic provider release candidate 结果层（机制证据） |
| `release-real-llm` | tauri | 真实模型 provider 结果层（模型行为证据 + 机制证据） |

## PR Smoke

PR smoke 不应把所有 Tauri 场景塞进 blocking job。它只用于防止 manifest 漏登记和最核心路径回归。

Tauri PR smoke scenario gate 是否 blocking 由当前 CI 配置决定；已知失败场景不得保留在 `pr-smoke` 中。2026-06-22 复核：`p1-chapter-plan-minimum` 已由真实 Tauri 12 章证据恢复为 `nightly`，不再是 known gap 示例。

## Nightly

Nightly 通过真实 Tauri 窗口和外部 UI driver 覆盖长会话、上下文来源、采纳边界、冲突恢复和章节生成。

## Release（B42 CP0/CP1 结果层语义）

Status: planned, not yet enforced；**当前两个 tier 仍为 0 注册场景，属已知未闭环事实**。

### Tier 所有权与阻塞（B42 CP0 冻结；不注册占位/blocked 假场景）

| tier | 归属与首批候选 | 何时非空 / 阻塞 |
|---|---|---|
| `release` | 确定性 provider 的机制证据层。首批候选来自 B40 重锚后的既有 deterministic 场景（B28/B30/B29/B31/B37 等 native/deterministic 证据链），在 release gate 启用时按需迁移/登记 | 待 B40 重锚 + release gate 启用；在此之前 registry 保持空，不以占位/blocked 假场景充数 |
| `release-real-llm` | 真实模型行为证据层。**首个真实场景 = AU-15 A0/A1/A2**（模型自主求证与证据闭环） | 归 B42 CP4；**ADR-0030 Accepted 后**才预注册与真实运行；不接受则保持 blocked |

- registry 为空 = 已知未闭环（已在 B42 §11 与结果层 `known_fact` 如实记录），不是 PASS，也不以假场景制造"tier 已非空"的外观。

- **归属固定**：`release` 只承载确定性机制证据；`release-real-llm` 只承载真实模型行为证据（含机制）。两类结果分开汇总，不合并成单一 PASS；deterministic nightly 结果不得提升为实模 PASS。
- **结果层入口**（读已有 batch/verdict/证据，不执行产品）：

  ```bash
  node scripts/lib/quality/release_layer_cli.mjs summarize --tier release
  node scripts/lib/quality/release_layer_cli.mjs summarize --tier release-real-llm
  ```

  空 tier 输出 `status=not_run` + `reason_codes=[empty_tier, known_fact_empty_tier]`，exit `65`（不是 PASS，也不是“全部通过”）。
- **真实模型 PASS 判据（CP0 §6.2 冻结）**：真实 provider 请求与响应正文（HTTP 200 不是模型证据）、≥2 次独立重复且全过、至少一种未参与调词的保留措辞、`model`/`actual_model`/params/driver 可回放、CP2 观察→后续真实请求链接无违规、CP3 原生 run 非 fail；缺凭据/平台只能 blocked/skipped，不能 PASS。
- **tier 何时非空**：AU-15 A0/A1/A2 的预注册与真实运行归 B42 CP4，当前 blocked（ADR-0030 仍为 Proposed，作者裁决前 AI 不代签）。
- 以下是目标命令，必须在 `quality/acceptance/scenarios.yml` 登记 release-tier 场景后才能作为当前 gate 执行：

  ```bash
  bash scripts/quality_accept.sh --tier release --surface tauri --provider slice_verify
  bash scripts/quality_accept.sh --tier release-real-llm --surface tauri --provider lmstudio
  ```

  当前无 release-tier 注册场景，这些命令返回 no scenarios / exit 65，与文档状态一致，不能作为当前 release gate。

## 必需证据完整性（B42 §12 冻结，2026-10-28）

- **场景声明**：`release-real-llm` 场景在运行前冻结 `quality-evidence-requirements/v1`（JSON：`{schema_version, dimensions, note}`），对 8 个维度声明 `required` / `not_applicable`：`base_refs`、`observations`、`observation_link`、`source_metadata`（观察 outcome + source_revision + coverage）、`used_context_refs`、`preparation`、`restore`、`replay`。未声明维度按 `required`（严格默认）；`base_refs`/`used_context_refs` 必须 required；`observation_link`/`source_metadata` required 时 `observations` 必须 required（结构上禁止删要求放行）。
- **未执行不是不适用**：replay 用三态 `replay_status = not_executed | no_provider_call | provider_called | unknown` 记录。`not_executed` 只是“没跑”，不能冒充“已验证不调 provider”；历史 artifact 缺该字段按 `unknown`，旧布尔 `replay_provider_called=false` 不得反推已验证。
- **判定**：release 结果层对证据链一律**重算**（不信任 artifact 自带的 `binding` 摘要），再按声明逐维度判完整性：必需证据缺失/未知/未执行 → `evidence_missing`（exit 67），硬违规（越界 ref、stale 信用、观察晚于请求、replay 重调 provider 等）仍 `fail`（exit 1）；`observation_link` 在观察与真实 provider 调用都已记录却无可判链接时按 fail，任一侧未记录则只算 evidence_missing。只有各必需维度完整且无阻塞 blocker 才可 PASS；`release-real-llm` 的 PASS 汇总还强制每个 pass 场景 `evidence_completeness=complete`。
- **A0 合法零探索**：Base 足够时可将 observations/link/source_metadata/preparation/restore/replay 声明为 not_applicable，不被“没有观察”误判缺失。
- **落点**：`scripts/lib/quality/evidence_chain.mjs`（声明/完整性/replay 三态）、`scripts/lib/quality/release_layer.mjs`（判定与汇总）、`scripts/lib/quality/release_layer_cli.mjs`（读 artifact 记录的 `evidence-chain.json`/`evidence-requirements.json` 或 `--evidence-requirements`）、`quality/acceptance/evidence-schema.json`（`$defs.evidence_requirements` + `replay_status`，additive 同版本）。实现记录与反例矩阵见 [B42 §12](../../tasks/slices/B42-model-behavior-evidence-tier.md#12-证据完整性回补2026-10-29-done)。
