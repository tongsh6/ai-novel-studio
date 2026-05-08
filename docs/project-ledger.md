# Project Ledger / 项目事实台账

> 最后更新：2026-05-08（VS-00 实现完成）
>
> 角色：新会话 AI 或新贡献者在 10 分钟内恢复项目状态基线。本文是权威事实来源，设计文档和代码可能滞后于本文，但本文不应滞后于设计和代码。

---

## 1. 当前阶段目标

**Stage 3（Slice Planning）收尾 → Stage 4（Implementation）准备。**

v3 设计体系（Stage 0-3）已完成。17 个 ADR 全部 Accepted。10 个 contract pack + 10 个 slice 定义 docs-ready。

**阻塞点**：等待用户明确批准后进入 implementation plan 或代码实现。

**当前批次目标**：按审计报告 Top 3 建议推进——创建台账（本文）→ 明确迁移策略 → VS-00 implementation plan → VS-00 代码实现 → 门禁验证。

---

## 2. 已完成事项

### 2.1 v2 实现（Phase 1-3，全部 done）

| 事项 | 状态 | 证据路径 | 验证方式 |
|------|------|----------|----------|
| VS-001 TurnResult Contract Spine | done | `tasks/slices/VS-001-*.md` | mix test |
| VS-002 Clarification Card Loop | done | `tasks/slices/VS-002-*.md` | mix test |
| VS-003 Confirmation Before Execute Loop | done | `tasks/slices/VS-003-*.md` | mix test |
| VS-004 Tentative Artifact Adoption Boundary | done | `tasks/slices/VS-004-*.md` | mix test |
| VS-005 Accepted Artifact Marks Projection Stale | done | `tasks/slices/VS-005-*.md` | mix test |
| VS-006 Turn Memory Write-Through | done | `tasks/slices/VS-006-*.md` | mix test |
| VS-007 Intent Registry Expansion | done | `tasks/slices/VS-007-*.md` | mix test |
| VS-008 Provider Gateway Real Adapter (LM Studio) | done | `tasks/slices/VS-008-*.md` | mix test |
| VS-009 Governed Memory Recall Pipeline | done | `tasks/slices/VS-009-*.md` | mix test |
| VS-010 Novel Domain Core Objects | done | `tasks/slices/VS-010-*.md` | mix test |
| VS-011 Real Provider Gateway (Anthropic) | done | `tasks/slices/VS-011-*.md` | mix test |
| VS-012 End-to-End Creative Turn Pipeline | done | `tasks/slices/VS-012-*.md` | 370 tests, 0 failures, Tauri build ✅ |
| VS-013 Modify Draft Closed Loop | done | `tasks/slices/VS-013-*.md` | mix test |
| VS-014 Reading Mode Real Content Projection | done | `tasks/slices/VS-014-*.md` | mix test |
| VS-015 Create Character Candidates | done | `tasks/slices/VS-015-*.md` | mix test |
| VS-016 Quality Pass Character Outline | done | `tasks/slices/VS-016-*.md` | mix test |
| VS-017 Cross-Turn Slot Accumulation | done | `tasks/slices/VS-017-*.md` | mix test |
| VS-018 LLM Call Logging | done | `tasks/slices/VS-018-*.md` | mix test |

**汇总**：18 slices done，370 tests，0 failures，CI green，Tauri build ✅，Anthropic + LM Studio 双 Provider 调通。

### 2.2 v3 设计（Stage 0-3，全部完成）

| 事项 | 状态 | 证据路径 |
|------|------|----------|
| 愿景与工程路线 | 草案 | `docs/design-v3/00-vision-and-engineering-roadmap.md` |
| 阅读地图 | 草案 | `docs/design-v3/00a-reading-map.md` |
| 端到端主链 | 草案 | `docs/design-v3/00b-end-to-end-dialogue-flow.md` |
| 状态与 Contract Atlas | 草案 | `docs/design-v3/00c-state-and-contract-atlas.md` |
| 运行时架构 | 草案 | `docs/design-v3/00d-runtime-architecture.md` |
| 交互模型 | 草案 | `docs/design-v3/01-user-llm-workbench-interaction-model.md` |
| DialogueFrame/MicroPlan 协议 | 草案 | `docs/design-v3/02-dialogue-frame-and-micro-plan.md` |
| Capability Toolbox | 草案 | `docs/design-v3/03-capability-toolbox-contract.md` |
| Execution Orchestrator | 草案 | `docs/design-v3/04-execution-orchestrator.md` |
| Turn Behavior 状态模型 | 草案 | `docs/design-v3/05-turn-behavior-and-state-model.md` |
| Memory/Context/Trace | 草案 | `docs/design-v3/06-memory-context-and-trace.md` |
| Workbench UI Contract | 草案 | `docs/design-v3/07-workbench-ui-contract.md` |
| ADR-0001 至 ADR-0017 | **Accepted** (17 个) | `docs/design-v3/adr/` |
| Contract Packs (10 个) | 草案 | `docs/design-v3/contracts/` |
| Slice 定义 (10 个) | docs-ready | `tasks/slices/v3/` |
| DAG | docs-ready | `tasks/slices/v3/DAG.md` |
| 工程护栏 | 试行 | `docs/engineering/v3-architecture.md` |
| 质量门禁 | 试行 | `docs/engineering/v3-quality-gates.md` |

---

## 3. 已验证事项

| 事项 | 验证方式 | 报告路径 | 结论 |
|------|----------|----------|------|
| v2 端到端创作链路 | `mix test` 370 tests + Tauri build | VS-012 验证段 | 通过（v2 分支留存） |
| v3 VS-00 reply-only 最小主链 | 6 contract tests, 0 failures | `dialogue_gateway_test.exs` | **通过** |
| v3 编译零警告 | `mix compile --warnings-as-errors` | — | 通过 |
| v3 架构无循环 | `mix xref graph --format cycles` | — | No cycles |
| v3 架构门禁 | `mix run scripts/arch_check.exs` | — | 通过 |
| v3 静态扫描 | `bash scripts/ai_static_scan.sh --top 10` | `artifacts/static-scan/` | 11/13 passed, 0 new findings |
| v3 设计体系 | 人工评审 | ADR 全部 Accepted | 通过 |
| v3 全局不变量 #1, #9, #14 | VS-00 contract tests | `00c` §7 | **已验证** |
| v3 全局不变量 #2-#8, #10-#13, #15 | **未验证** | `00c` §7 | 待后续 slice |

---

## 4. 进行中事项

| 事项 | 当前状态 | 阻塞点 | 下一步 |
|------|----------|--------|--------|
| VS-00A 创作探索闭环 | docs-ready | 依赖 VS-00 完成 | implementation plan |
| VS-00B 上下文接入 | docs-ready | 依赖 VS-00A | implementation plan |

---

## 5. 已废弃事项（v2→v3）

| 事项 | 废弃原因 | 决策证据 | 是否有残留 |
|------|----------|----------|-----------|
| Router-first 拓扑 | v3 采用 Dialogue-first | `00-vision` §5.2 | **已从 v3 分支清除** |
| Router / Router.Result | 被 DialogueFrame 替代 | `00-vision` §5.2 | **已从 v3 分支清除** |
| Orchestrator (v2) | 被 ExecutionOrchestrator 替代 | `00-vision` §5.2 | **已从 v3 分支清除** |
| IntentRegistry / SlotSchema | 被 DialogueFrame + Capability Toolbox 替代 | `00-vision` §5.2 | **已从 v3 分支清除** |
| ClarificationStore | 被 BehaviorState 替代 | `00-vision` §5.2 | **已从 v3 分支清除** |
| AuthorityGate / BudgetMeter | v3 由 GateOrder 替代 | `00-vision` §5.2 | **已从 v3 分支清除** |
| TurnService | 拆分为 DialogueGateway/Planner/Orchestrator | `00-vision` §5.2 | **已从 v3 分支清除** |
| MemoryService / MemoryRecallService | v3 后续重建 | `00-vision` §5.2 | **已从 v3 分支清除** |
| AdoptionBoundary / ReadingService | v3 后续重建 | `00-vision` §5.2 | **已从 v3 分支清除** |
| Runtime session 管理 | v3 后续重建 | `00-vision` §5.2 | **已从 v3 分支清除** |
| UI 表单式补槽 | 改为自然创作引导 | `00-vision` §5.2 | 前端待清理（后续 slice） |

---

## 6. 当前 Top Priority

| 优先级 | 事项 | 原因 | 验收标准 |
|--------|------|------|----------|
| 1 | VS-00A 创作探索闭环 | 证明 AI 像创作伙伴（第二个体验承重点） | 模糊输入→自然探索+候选方向 |
| 2 | VS-00B 上下文接入 | 证明 AI 带着小说上下文回应 | 有/无上下文的对比测试 |
| 3 | VS-01 执行权结构 | 证明 MicroPlan 不能批准自己 | OrchestratorDecision 拒绝测试 |

---

## 7. 关键证据索引

| 证据 | 路径 | 说明 |
|------|------|------|
| v3 愿景 | `docs/design-v3/00-vision-and-engineering-roadmap.md` | 总入口 |
| v3 不变量总账 | `docs/design-v3/00c-state-and-contract-atlas.md` §7 | 15 条全局不变量 |
| v3 ADR 目录 | `docs/design-v3/adr/` | 17 个 Accepted |
| v3 Contract Packs | `docs/design-v3/contracts/` | 10 个 pack |
| v3 Slice DAG | `tasks/slices/v3/DAG.md` | 10 批次排序 |
| v3 Slice 文件 | `tasks/slices/v3/VS-*.md` | 具体定义 |
| v2 完成状态 | `tasks/slices/DAG.md` | 18 slices done |
| v2 实现证据 | `tasks/slices/VS-012-*.md` | 370 tests, Tauri build ✅ |
| 工程护栏 | `docs/engineering/v3-architecture.md` | app 边界、复用规则 |
| 质量门禁 | `docs/engineering/v3-quality-gates.md` | 工程/slice/小说门禁 |
| 静态扫描 | `artifacts/static-scan/` | 最新 2026-05-08 |
| AGENTS.md | `AGENTS.md` | 编码行为约束 |
| 编码规范 | `docs/coding-standards/` | 维度化规范 |
| v2 设计文档 | `docs/design-v2/README.md` | v2 设计入口 |

---

## 8. 开放问题

| 问题 | 归属 | 状态 |
|------|------|------|
| v2→v3 代码迁移策略（旁路 vs 重构） | implementation plan 前置 | 待决策 |
| JSON Schema / 代码级 contract 如何生成 | implementation plan 前置 | 待定 |
| 具体 umbrella 模块归属与测试切入点 | 每个 slice 的 implementation plan | 待定 |
| trace store / replay report 是否持久化 | VS-06 implementation plan | 待定 |
| 创作伙伴体验是否需要独立 ADR | 先由 VS-00A/VS-00B 证明 | 待定 |

---

## 9. 维护规则

1. 每次 slice 完成或阶段推进后更新本文 §2-§4。
2. 新增废弃事项时更新 §5。
3. 优先级变化时更新 §6。
4. 新增关键证据时更新 §7。
5. 开放问题收束或新增时更新 §8。
6. 更新日期写入文件头。
