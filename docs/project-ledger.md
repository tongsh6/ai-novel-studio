# Project Ledger / 项目事实台账

> 最后更新：2026-05-09（v3 质量夯实：LLM 日志反向分析 → 6 项修复 + InferenceParams + 双 umbrella app + injectable HTTP）
>
> 角色：新会话 AI 或新贡献者在 10 分钟内恢复项目状态基线。本文是权威事实来源，设计文档和代码可能滞后于本文，但本文不应滞后于设计和代码。

---

## 1. 当前阶段目标

**Stage 5（Real Integration）— v3 主链代码完成，正在接入真实 provider、真实持久化和前端 Workbench。**

v3 设计体系（Stage 0-3）已完成。17 个 ADR 全部 Accepted。10 个 contract pack + 10 个 slice 定义全部 docs-ready。

v3 实现（Stage 4）已完成 **全部 10 个承重竖切面**（VS-00 ~ VS-06），319 tests，0 failures，13/13 静态扫描通过。

**当前批次目标**：按顺序推进 4 个集成方向——

1. 真实 LLM 集成（Planner → Gateway → LM Studio / Anthropic）
2. 真实持久化（ContextAssembler + TraceWriter → SQLite3）
3. 前端 Workbench（Tauri 消费 v3 Channel）
4. 端到端集成测试（全链路 + 真实 provider）

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

### 2.2 v3 设计与实现（Stage 0-4，全部完成）

| 事项 | 状态 | 证据路径 |
|------|------|----------|
| 愿景与工程路线 | Accepted | `docs/design-v3/00-vision-and-engineering-roadmap.md` |
| 阅读地图 | Accepted | `docs/design-v3/00a-reading-map.md` |
| 端到端主链 | Accepted | `docs/design-v3/00b-end-to-end-dialogue-flow.md` |
| 状态与 Contract Atlas | Accepted | `docs/design-v3/00c-state-and-contract-atlas.md` |
| 运行时架构 | Accepted | `docs/design-v3/00d-runtime-architecture.md` |
| 交互模型 | Accepted | `docs/design-v3/01-user-llm-workbench-interaction-model.md` |
| DialogueFrame/MicroPlan 协议 | Accepted | `docs/design-v3/02-dialogue-frame-and-micro-plan.md` |
| Capability Toolbox | Accepted | `docs/design-v3/03-capability-toolbox-contract.md` |
| Execution Orchestrator | Accepted | `docs/design-v3/04-execution-orchestrator.md` |
| Turn Behavior 状态模型 | Accepted | `docs/design-v3/05-turn-behavior-and-state-model.md` |
| Memory/Context/Trace | Accepted | `docs/design-v3/06-memory-context-and-trace.md` |
| Workbench UI Contract | Accepted | `docs/design-v3/07-workbench-ui-contract.md` |
| ADR-0001 至 ADR-0017 | **Accepted** (17 个) | `docs/design-v3/adr/` |
| Contract Packs (10 个) | Accepted | `docs/design-v3/contracts/` |
| Slice 定义 (10 个) | docs-ready | `tasks/slices/v3/` |
| DAG | docs-ready | `tasks/slices/v3/DAG.md` |
| 工程护栏 | 试行 | `docs/engineering/v3-architecture.md` |
| 质量门禁 | 试行 | `docs/engineering/v3-quality-gates.md` |

### 2.3 v3 实现 Slice（全部 10 个，全部 done）

| Slice | 名称 | 提交 | 核心验证 |
|-------|------|------|----------|
| VS-00 | Reply-only DialogueFrame + TurnResult + Trace | `0e4da50` | 每 turn 必有 frame；TurnResult canonical；replay 不调 LLM |
| VS-00A | Creative Exploration Loop | `0e4da50` | 模糊输入→自然探索；不打开机械表单 |
| VS-00B | DialogueContext Grounding | `0e4da50` | 有/无上下文正确组装；context refs 可追溯 |
| VS-01 | MicroPlan + OrchestratorDecision + Gate Order | `0e4da50` | Plan 只是建议；Orchestrator 唯一门禁；8 gates |
| VS-02 | ToolRequest/ToolResult/ToolTrace | `d0a96df` | ToolRequest 需 decision_ref；trace provenance 闭环 |
| VS-02A | Tentative Creative Artifact | `d0a96df` | 创作产出默认 tentative；不直接写 production |
| VS-03 | Durable Behavior Lifecycle | `276367a` | clarification/confirmation open→awaiting→resolved |
| VS-04 | Candidate Selection & Adoption Boundary | `ff11b0d` | selection ≠ adoption；需 confirmation 才写 production |
| VS-05 | UI Action Roundtrip | `f7ba5c2` | 只能提交 available actions；stale/invented 被拒 |
| VS-06 | Replay Surface | `f7ba5c2` | trace summary 脱敏；replay 不调 provider |

| QP-01 | 质量夯实：LLM 日志反向分析 → 6 项修复 | `HEAD` | 341 tests, 0 failures |
| | — 统一 log/llm-calls 路径（`__DIR__` 推导） | | `.gitignore` apps/*/log/ |
| | — Provider 日志记录真实 req/resp body | | Anthropic/LMStudio write_log 重构 |
| | — Planner 设置 turn_id/step 进程上下文 | | `with_turn_context/3` |
| | — InferenceParams 通用推理参数（移除 max_tokens: -1） | | `provider/inference_params.ex` |
| | — Provider 健康检查改为 HTTP GET /v1/models | | `HTTP.get/2` |
| | — Provider HTTP 可注入（消除测试网络依赖） | | struct `:http_fn` 字段 + mock 测试 |
| | — 日志记录提取到 LLMLog.record/5（消除 adapter 重复） | | |
| | — 新建 novel_common + novel_test umbrella apps | | 共享测试 helper |
| | — Provider 单元测试全量 mock（不再产生 LLM 调用日志） | | |

**汇总**：10 slices + 1 quality pass done，341 tests，0 failures，compile --warnings-as-errors clean，0 cycles，arch green。

---

## 3. 已验证事项

| 事项 | 验证方式 | 报告路径 | 结论 |
|------|----------|----------|------|
| v2 端到端创作链路 | `mix test` 370 tests + Tauri build | VS-012 验证段 | 通过（v2 分支留存） |
| v3 编译零警告 | `mix compile --warnings-as-errors` | — | **通过** |
| v3 架构无循环 | `mix xref graph --format cycles` | — | **通过（0 cycles）** |
| v3 架构门禁 | `mix run scripts/arch_check.exs` | — | **通过** |
| v3 静态扫描 | `bash scripts/ai_static_scan.sh --top 10` | `artifacts/static-scan/` | **13/13 PASS** |
| v3 设计体系 | 人工评审 | ADR 全部 Accepted | **通过** |
| v3 全局不变量 #1（每 turn 必有 frame） | VS-00 dialogue_gateway_test.exs | `00c` §7 | **已验证** |
| v3 全局不变量 #2（MicroPlan 只是建议） | VS-01 execution_authority_test.exs | `00c` §7 | **已验证** |
| v3 全局不变量 #3（Orchestrator 唯一门禁） | VS-01 + VS-02 tool_provenance_test.exs | `00c` §7 | **已验证** |
| v3 全局不变量 #4（默认只放行下一步） | VS-01 gate_order tests | `00c` §7 | **已验证** |
| v3 全局不变量 #5（工具调用有 trace） | VS-02 tool_provenance_test.exs | `00c` §7 | **已验证** |
| v3 全局不变量 #6（写入默认 tentative） | VS-02A creative_artifact_test.exs | `00c` §7 | **已验证** |
| v3 全局不变量 #7（durable behavior 生命周期） | VS-03 behavior_lifecycle_test.exs | `00c` §7 | **已验证** |
| v3 全局不变量 #8（缺 slot 不自动表单） | VS-00A dialogue_gateway_test.exs | `00c` §7 | **已验证** |
| v3 全局不变量 #9（TurnResult canonical） | VS-00 ~ VS-06 全部 test | `00c` §7 | **已验证** |
| v3 全局不变量 #10（UI 只能提交 available） | VS-05 action_roundtrip_test.exs | `00c` §7 | **已验证** |
| v3 全局不变量 #11（selection ≠ adoption） | VS-04 adoption_boundary_test.exs | `00c` §7 | **已验证** |
| v3 全局不变量 #12（confirmation 重新 gate） | VS-03 behavior_lifecycle_test.exs | `00c` §7 | **已验证** |
| v3 全局不变量 #13（trace summary 脱敏） | VS-06 replay_service_test.exs | `00c` §7 | **已验证** |
| v3 全局不变量 #14（replay 不调 LLM） | VS-06 replay_service_test.exs | `00c` §7 | **已验证** |
| v3 全局不变量 #15（projection hints 只触发刷新） | VS-04 adoption_boundary_test.exs | `00c` §7 | **已验证** |

**全部 15 条全局不变量均已验证。**

---

## 4. 进行中事项

| 事项 | 当前状态 | 阻塞点 | 下一步 |
|------|----------|--------|--------|
| 真实 LLM 集成 | ✅ 已完成 | — | Planner → Gateway → LM Studio / Anthropic 已调通 |
| 真实持久化 | ✅ 已完成 | — | ContextAssembler + TraceWriter → SQLite3 已验证 |
| 前端 Workbench | ✅ 已完成 | — | Tauri 消费 v3 Channel 已验证 |
| 端到端集成测试 | ✅ 已完成 | — | VS-08 全链路 + stub/real LLM 已验证 |
| Provider 日志质量 | ✅ 已完成 | — | QP-01 6 项修复全部落地 |

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
| 1 | ✅ 真实 LLM 集成 | 已完成 | LM Studio + Anthropic 双 Provider 调通 |
| 2 | ✅ 真实持久化 | 已完成 | SQLite3 读写验证通过 |
| 3 | ✅ 前端 Workbench | 已完成 | Tauri 端到端对话轮次可用 |
| 4 | ✅ 端到端集成测试 | 已完成 | VS-08 全链路通过 |
| 5 | Provider 日志质量 | 已完成 | QP-01 6 项修复，日志可追溯、无污染 |

---

## 7. 关键证据索引

| 证据 | 路径 | 说明 |
|------|------|------|
| v3 愿景 | `docs/design-v3/00-vision-and-engineering-roadmap.md` | 总入口 |
| v3 不变量总账 | `docs/design-v3/00c-state-and-contract-atlas.md` §7 | 15 条全局不变量（全部已验证） |
| v3 ADR 目录 | `docs/design-v3/adr/` | 17 个 Accepted |
| v3 Contract Packs | `docs/design-v3/contracts/` | 10 个 pack |
| v3 Slice DAG | `tasks/slices/v3/DAG.md` | 10 批次排序 |
| v3 Slice 文件 | `tasks/slices/v3/VS-*.md` | 具体定义（全部 done） |
| v2 完成状态 | `tasks/slices/DAG.md` | 18 slices done |
| v2 实现证据 | `tasks/slices/VS-012-*.md` | 370 tests, Tauri build ✅ |
| v3 实现证据 | `apps/*/test/` | 341 tests, 0 failures (8 apps) |
| novel_common | `apps/novel_common/` | 底层共享 app，依赖 novel_foundation |
| novel_test | `apps/novel_test/` | 跨 app 测试共享，依赖 novel_agent |
| 工程护栏 | `docs/engineering/v3-architecture.md` | app 边界、复用规则 |
| 质量门禁 | `docs/engineering/v3-quality-gates.md` | 工程/slice/小说门禁 |
| 静态扫描 | `artifacts/static-scan/` | 最新 2026-05-09（13/13 PASS） |
| AGENTS.md | `AGENTS.md` | 编码行为约束 |
| 编码规范 | `docs/coding-standards/` | 维度化规范 |

---

## 8. 开放问题

| 问题 | 归属 | 状态 |
|------|------|------|
| v2→v3 代码迁移策略（旁路 vs 重构） | 已解决 | **彻底重构完成（v3 分支）** |
| JSON Schema / 代码级 contract 如何生成 | 待定 | contract packs 手工维护中 |
| trace store / replay report 是否持久化 | 已解决 | SQLite3 decision_traces 表 + TraceRepository |
| 创作伙伴体验是否需要独立 ADR | 已由 VS-00A/VS-00B 证明 | 无需独立 ADR |
| 真实 LLM 集成测试策略 | 已解决 | VS-08 集成测试（stub + real LLM） |
| **集成测试脚本质量** | **待改进** | **VS-08 集成测试三轮修复均只改了测试文件本身，未暴露业务代码 bug。需补充：注入已知业务 bug 验证测试捕获能力的反向验证脚本，以及业务代码 mutation testing** |
| **上下文路径无集成测试覆盖** | **已补充** | **新增 "context injection reaches LLM prompt" 测试。fetcher 注入非空上下文 → ContextAssembler → Planner → LLM prompt 包含上下文。日志验证：turn_* 中 prompt 显示作品快照/对话摘要/记忆已注入。** |

---

## 9. 维护规则

1. 每次 slice 完成或阶段推进后更新本文 §2-§4。
2. 新增废弃事项时更新 §5。
3. 优先级变化时更新 §6。
4. 新增关键证据时更新 §7。
5. 开放问题收束或新增时更新 §8。
6. 更新日期写入文件头。
