# ADR-0019：Adoption Status Transition Matrix v3

- 状态：Accepted
- 日期：2026-06-14
- 来源文档：
  - `../foundation/30-contract-glossary.md` §3.2 / §3.2.1（取值集合 canonical + 转换矩阵落点）
  - `../domain/22-continuity-model.md` §13.5（chapter_summary 7 态）、§21（correction / supersede / invalidate 语义）
  - `ADR-0001-dialogue-frame-v3.md`（7 态 canonical 取值）
  - `ADR-0002-micro-plan-v3.md` §5（artifact lifecycle state 与 status 映射）
  - `ADR-0010-state-adoption-boundary-v3.md`（采纳边界：selection ≠ adoption）
- 影响范围：Artifact / Adoption / Persistence / Domain / Trace
- 相关不变量：`00c` 采纳边界不变量；本 ADR 新增"转换合法性"不变量
- 首个证明 slice：后续 adoption 状态流转 slice（代码 enforcement）
- 取代：无（填补 v2→v3 迁移中丢失的"合法转换"定义空白）
- 取代者：无

---

## 背景

artifact adoption 7 态取值集合（`TENTATIVE / ACCEPTED / EDITED_ACCEPTED / DISCARDED / SUPERSEDED / INVALIDATED / ARCHIVED`）在 `30 §3.2`、`adoption_status.json` schema、生成的 `NovelFoundation.Enums.AdoptionStatus` 中已 canonical 并 code-enforced（`valid?`）。

但**哪些状态之间的转换合法**在 v3 文档、ADR、schema、代码中全部缺失。`22 §13.5` 曾引用 v2 `02 §523-533`「已固化合法转换」，该内容在 v2→v3 迁移中丢失且无据可考（2026-06-14 整合 review R3 发现，见 `tasks/2026-06-14-design-v2-to-v3-absorption.md` §5b）。无转换矩阵意味着持久化层无法拒绝非法状态跳变（如 ARCHIVED 静默复活、绕过 TENTATIVE 直接 ACCEPTED）。

注意：本矩阵管 **artifact adoption 7 态**，与 `NovelDomain.MemoryItem` 的**记忆状态机**（DRAFT/CONFIRMED/STABILIZED/DEPRECATED/ARCHIVED）是两套独立状态机，不可混用。

## 决策范围

冻结 artifact adoption 7 态的初始态、合法转换集合、终态语义与不变量；并要求持久化/领域层 enforce。

## 非目标

- 不改取值集合（取值 canonical 仍属 `30 §3.2` + ADR-0001）。
- 不定义"复活后是否成为 current canon"的采纳决策逻辑（属 adoption decision / ADR-0010 边界，本 ADR 只管状态转换合法性）。
- 不涉及记忆状态机（MemoryItem）。

## 考虑过的方案

### 方案 A：保守不可逆（终态不复活）
DISCARDED/SUPERSEDED/INVALIDATED/ARCHIVED 为终态，重新提议须新建 artifact。审计最强，但作者无法"撤回误丢弃 / 恢复旧版 / 复用失效项"，体验僵硬。

### 方案 B：全可逆 + 复活统一重入采纳流（最终采用）
允许撤采纳与复活；但复活一律先回 `TENTATIVE` 重新走采纳，不直接复原为 `ACCEPTED`。兼顾灵活与可审计。

## 最终决策

采用方案 B。

### 初始态

artifact 产出即 `TENTATIVE`（VS-02A / ADR-0010）。

### 合法转换矩阵

| from | 允许 to |
|---|---|
| `TENTATIVE` | `ACCEPTED`、`EDITED_ACCEPTED`、`DISCARDED`、`INVALIDATED` |
| `ACCEPTED` | `SUPERSEDED`、`INVALIDATED`、`DISCARDED`、`ARCHIVED` |
| `EDITED_ACCEPTED` | `SUPERSEDED`、`INVALIDATED`、`DISCARDED`、`ARCHIVED` |
| `DISCARDED` | `TENTATIVE`（复活）、`ARCHIVED` |
| `SUPERSEDED` | `TENTATIVE`（复活）、`ARCHIVED` |
| `INVALIDATED` | `TENTATIVE`（复活）、`ARCHIVED` |
| `ARCHIVED` | `TENTATIVE`（un-archive 复活） |

- 自反转换（同态 → 同态）视为合法 no-op（与 MemoryItem 一致）。
- `ACCEPTED ↔ EDITED_ACCEPTED` 不互转：编辑后采纳在采纳动作时一次确定。

### 决策点（用户 2026-06-14 裁定）

1. **允许 `ACCEPTED`/`EDITED_ACCEPTED` → `DISCARDED`**（撤采纳）。
2. **允许 `DISCARDED`/`SUPERSEDED`/`INVALIDATED`（及 `ARCHIVED`）复活**。
3. ADR + 代码双固化。

### 不变量

- INV-1：任何到 `ACCEPTED`/`EDITED_ACCEPTED` 的进入只能来自 `TENTATIVE`。**复活不直接复原为 ACCEPTED**，必须经 `TENTATIVE` 重新采纳——保证每个 canon 进入都有可溯的采纳决策。
- INV-2：当前有效 canon 集合只含 `ACCEPTED` / `EDITED_ACCEPTED`。
- INV-3：无永久终态；`ARCHIVED` 是休眠态，可 un-archive 回 `TENTATIVE`。
- INV-4：非表中转换一律拒绝（持久化边界 reject）。

## 决策理由

作者需要纠错与复用空间（撤回误采纳、恢复旧版、复用一度失效的设定），方案 A 太僵。但"复活直接复原 ACCEPTED"会让 canon 出现无采纳决策来源的条目、破坏可审计。方案 B 用"复活→TENTATIVE 重入采纳"在灵活与可审计之间取平衡。

## Contract 影响

- `30 §3.2.1` 升级为本矩阵的 canonical 镜像（状态 Accepted）。
- adoption 写入边界须校验转换合法性。

## Umbrella 边界影响

- `novel_domain`：提供纯函数 `adoption_transition_allowed?/2`（与 `MemoryItem.status_transition_allowed?/2` 对称）。
- `novel_persistence`：artifact adoption 写入 changeset 调用该校验，拒绝非法转换。
- `novel_application` / `novel_web`：不绕过持久化校验直接改状态。

## UI / Trace / Replay 影响

非法转换被拒须产生可解释结果（不静默吞）。复活、撤采纳应在 trace 留痕。

## 垂直切面证明

后续 slice 须证明：合法转换通过、非法转换在持久化边界被拒、复活经 TENTATIVE 重入、撤采纳留痕。

## 迁移与兼容

填补空白，无既有合法转换被推翻。现有数据若存在非法态对（理论上不应有），迁移时按矩阵校正或归档。

## 后续工作

- 在 `artifact_adoption_entry` changeset + `novel_domain` 增 `adoption_transition_allowed?/2` enforcement 与测试。

## 适用范围补充（2026-10-29，作者确认）

维护类 artifact（`../domain/25-maintenance-hooks.md §8.1` 维护 artifact 家族，如 `reconciliation_report_artifact`）的**维护类替换**不属于本 ADR 的 artifact adoption 转换：

- `TENTATIVE → SUPERSEDED`（新扫描报告替换旧的待处理报告、旧版留史）由 `NovelDomain.MaintenanceArtifactStatus` 在通用矩阵之上追加**唯一一条**替换规则后放行；通用矩阵本身不变（对 Draft/ChapterSummary 等采纳类 artifact，`TENTATIVE→SUPERSEDED` 仍非法）。
- 依据：`../domain/22-continuity-model.md §21.2`（supersede = 新版替代旧版、旧版保留历史意义）；维护产物不进入 canon，不是作者采纳决策，故不适用 INV-1 的采纳语义。
- 边界：不建立第二套 7 态矩阵；不改变本 ADR 任何采纳类决策；历史行状态值不变、无数据迁移。
- 来源与执行：作者 2026-10-29 确认 B44 的 A 方案（保留现有产品行为“新扫描报告 → 旧待处理报告标为已被更新版本取代”）；实现、测试与页面证据见 `tasks/slices/B44-persistence-transition-boundary.md` §6.3/§8/§9。

## enforced_by

- apps/novel_domain/lib/novel_domain/adoption_status.ex
- apps/novel_domain/lib/novel_domain/chapter_summary.ex
- apps/novel_persistence/lib/novel_persistence/schemas/foundation/artifact_adoption_entry.ex
- apps/novel_domain/test/novel_domain/adoption_status_test.exs
- apps/novel_domain/test/novel_domain/chapter_summary_test.exs
- apps/novel_persistence/test/novel_persistence/schemas/foundation/artifact_adoption_entry_test.exs
- apps/novel_persistence/lib/novel_persistence/schemas/draft.ex
- apps/novel_persistence/lib/novel_persistence/adoption_repository.ex
- apps/novel_persistence/test/novel_persistence/schemas/draft_test.exs
- apps/novel_application/lib/novel_application/adoption_workflow.ex
- apps/novel_application/test/novel_application/adoption_workflow_test.exs
- quality/acceptance/scenarios/q1c-adopted-content-revision.yml
- quality/acceptance/scenarios/p1-chapter-edit-then-accept.yml
- tasks/slices/Q1CB-ADOPTION-TRANSITION-ENFORCEMENT.md
- apps/novel_domain/lib/novel_domain/maintenance_artifact_status.ex
- apps/novel_persistence/lib/novel_persistence/status_transition.ex
- apps/novel_persistence/lib/novel_persistence/schemas/chapter_summary.ex
- apps/novel_persistence/lib/novel_persistence/schemas/reconciliation_report.ex
- apps/novel_persistence/lib/novel_persistence/chapter_summary_repo.ex
- apps/novel_persistence/lib/novel_persistence/reconciliation_report_repo.ex
- apps/novel_domain/test/novel_domain/maintenance_artifact_status_test.exs
- apps/novel_persistence/test/novel_persistence/chapter_summary_repo_test.exs
- apps/novel_persistence/test/novel_persistence/reconciliation_report_repo_test.exs
- tasks/slices/B44-persistence-transition-boundary.md

## enforcement_gaps

- ✅ **已关闭（2026-10-23，Q1CB-ADOPTION-TRANSITION-ENFORCEMENT）** B13b 裁决（含伪缺口修正）：artifact 7 态矩阵的 enforcer 原只在领域调用侧生效（`ChapterSummary.accept`），`AdoptionRepository` 直写 Draft ACCEPTED / supersede `update_all` 绕过矩阵。本 slice 把矩阵下沉持久化边界：`Draft.changeset/2` 对 persisted struct 的 status 变更调用 `NovelDomain.AdoptionStatus.transition_allowed?/2`（非法 → changeset error `illegal adoption transition FROM -> TO`）；`adopt_changeset`/`discard_changeset` 改走 changeset，新增 `supersede_changeset`；`AdoptionRepository.supersede_accepted_drafts/3` 删除 `update_all`，逐行 `Draft.supersede_changeset |> repo.update()`（非法转换中止事务）；`AdoptionWorkflow` 将 `{:illegal_adoption_transition, detail}` 分类为可解释 failed action_result + `failed_recoverable` TurnResult（reason code `illegal_adoption_transition`，作者文案只说结构事实，原文零泄漏）。canon 两步留痕：pending TurnResult 条目为 `TENTATIVE`、采纳 TurnResult resolved 条目为 `ACCEPTED`/`EDITED_ACCEPTED`（真实 Tauri `p1-chapter-edit-then-accept` 扩展断言）。**修正边界**：MemoryItem 走记忆状态机、LedgerEntry 走两步 TENTATIVE→ACCEPTED 仪式，不计入本 gap。证据：`apps/novel_persistence/lib/novel_persistence/schemas/draft.ex`、`apps/novel_persistence/lib/novel_persistence/adoption_repository.ex`、`apps/novel_application/lib/novel_application/adoption_workflow.ex`、`tasks/slices/Q1CB-ADOPTION-TRANSITION-ENFORCEMENT.md`、`artifacts/slice-verify/p1-chapter-edit-then-accept-tauri/summary.json`。
- ◐ **Deferred（2026-10-23 作者默认裁决 Q4：复活先降级 Deferred）** B13b 裁决（等产品触发）：复活/un-archive（`DISCARDED/SUPERSEDED/INVALIDATED/ARCHIVED → TENTATIVE`）矩阵已允许且单测覆盖（`adoption_status.ex`、`draft_test.exs`），但生产无写入入口、无验收场景。触发=作者真实需要撤回误丢弃/恢复旧版 → 开 `AU05b-adoption-revive`（Contract=复活路径/INV-1/INV-3；Invariant=复活必须经 TENTATIVE 重入、直达 canon 被拒；Acceptance Driver=au05 家族真实 Tauri：丢弃→恢复→重采）。本 slice 不实现该入口，不冒充已闭环。

