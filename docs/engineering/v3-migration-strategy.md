# v2→v3 迁移策略

> 状态：Accepted（2026-05-08）
>
> 角色：决定 v3 代码实现方式，给出每个 umbrella app 的模块级处置清单。

---

## 1. 决策：彻底重构（Rewrite）

**v3 分支上彻底替换 v2 代码。v2 全部实现安全留存在 `origin/idea/dialogue-based-novel-workbench/v2` 等 v2 专属分支上。**

### 理由

1. **v2 在专属分支安全留存**：v2 的 370 tests、Tauri build 等全部成果在 v2 分支上完整可追溯，v3 分支不需要保留 v2 代码。
2. **拓扑根本不同**：v2 是 `Router → intent/slot → TurnService`，v3 是 `Planner → DialogueFrame → Orchestrator → ToolRequest`。两类链路的核心假设互不兼容，旁路共存只会增加认知负担和代码腐化。
3. **干净起点**：彻底重构意味着 v3 分支上的每个模块、每个测试都服务于 v3 语义。没有"这个模块是 v2 残留还是 v3 新加"的困惑。
4. **编译速度**：删除不再需要的 v2 模块减少编译单元，加快反馈循环。

### 原则

- v3 模块直接使用规范的 Elixir 模块名，不用 `V3` 命名空间前缀。
- 可复用的底层基础设施（Provider Gateway、Ecto Schema、Domain struct）保留并适配。
- 与 Router-first 拓扑绑定的模块直接删除。
- 测试全部改写为 v3 语义。

---

## 2. 模块级处置清单

### 2.1 novel_foundation — 保留，按需扩展

| 模块 | 处置 | 说明 |
|------|------|------|
| `NovelFoundation.Enums.*` | **保留** | 按 v3 ADR 扩展枚举值，移除 v2 专用值 |
| `NovelFoundation.ID` | **保留** | ID 生成，框架无关 |
| `NovelFoundation.UpstreamError` | **保留** | 错误类型 |
| `NovelFoundation.TurnResultValidator` | **重写** | v3 TurnResult 结构不同 |
| `NovelFoundation.Result` | **保留** | Result/Error 类型 |

### 2.2 novel_domain — 保留纯领域对象，新增 v3 struct

| 模块 | 处置 |
|------|------|
| `NovelDomain.Work` | **保留** |
| `NovelDomain.Volume` | **保留** |
| `NovelDomain.Chapter` | **保留** |
| `NovelDomain.Scene` | **保留** |
| `NovelDomain.Draft` | **保留** |
| `NovelDomain.Character` | **保留** |
| `NovelDomain.MemoryItem` | **保留** |
| `NovelDomain.NarrativePosition` | **保留** |
| `NovelDomain.Types` | **保留** |

新增：
- `NovelDomain.DialogueFrame`
- `NovelDomain.MicroPlan`
- `NovelDomain.OrchestratorDecision`
- `NovelDomain.DecisionTrace`
- `NovelDomain.BehaviorState`
- `NovelDomain.CapabilityRegistryEntry`
- `NovelDomain.ToolRequest`
- `NovelDomain.ToolResult`
- `NovelDomain.TentativeArtifactSet`

### 2.3 novel_agent — 删除 Router-first 模块，保留 Provider

| 模块 | 处置 |
|------|------|
| `NovelAgent.Router` | **删除** |
| `NovelAgent.Router.Result` | **删除** |
| `NovelAgent.Orchestrator` | **删除**（被 ExecutionOrchestrator 替代） |
| `NovelAgent.IntentRegistry` | **删除**（被 Capability Toolbox 替代） |
| `NovelAgent.IntentRegistry.SlotSchema` | **删除** |
| `NovelAgent.ClarificationStore` | **删除**（被 BehaviorState 替代） |
| `NovelAgent.AuthorityGate` | **删除**（被 GateOrder 替代） |
| `NovelAgent.BudgetMeter` | **删除**（v3 后续重建） |
| `NovelAgent.Provider.Gateway` | **保留** |
| `NovelAgent.Provider.Anthropic` | **保留** |
| `NovelAgent.Provider.LMStudio` | **保留** |
| `NovelAgent.Provider.Stub` | **保留** |
| `NovelAgent.Provider.Result` | **保留** |
| `NovelAgent.Provider.Usage` | **保留** |
| `NovelAgent.Agent` | **删除**（v3 后续重建） |
| `NovelAgent.Agent.Writer` | **删除** |
| `NovelAgent.Capabilities.SimpleComplete` | **删除** |
| `NovelAgent.Runtime.*` | **删除**（v3 后续重建） |
| `NovelAgent.Memory.Store` | **删除**（v3 后续重建） |
| `NovelAgent.AuditLog` | **删除**（由 DecisionTrace 替代） |
| `NovelAgent.LLMLog` | **删除**（由 TraceWriter 替代） |
| `NovelAgent.Telemetry` | **保留** |
| `NovelAgent.LongRunner` | **删除**（v3 后续重建） |

### 2.4 novel_application — 重写为核心编排层

| 模块 | 处置 |
|------|------|
| `NovelApplication.TurnService` | **删除** |
| `NovelApplication.AdoptionBoundary` | **删除**（v3 后续重建） |
| `NovelApplication.MemoryService` | **删除**（v3 后续重建） |
| `NovelApplication.MemoryRecallService` | **删除**（v3 后续重建） |
| `NovelApplication.ReadingService` | **删除**（v3 后续重建） |
| `NovelApplication.MemoryPolicy.*` | **删除**（v3 后续重建） |
| `NovelApplication.IntentHandlers.Scan` | **删除** |

新增：
- `NovelApplication.DialogueGateway` — 对话入口
- `NovelApplication.Planner` — Dialogue Planner
- `NovelApplication.TurnResultBuilder` — TurnResult v3 构建
- `NovelApplication.TraceWriter` — trace 写入协调

后续 slice 新增：
- `NovelApplication.ContextAssembler` — 上下文组装（VS-00B）
- `NovelApplication.ExecutionOrchestrator` — 执行裁决（VS-01）
- `NovelApplication.GateOrder` — 执行门禁（VS-01）

### 2.5 novel_web — 适配

| 模块 | 处置 |
|------|------|
| `NovelWeb.WorkspaceChannel` | **重写** |
| `NovelWeb.Router` (Phoenix) | **保留并适配** |
| `NovelWeb.Controllers.SystemController` | **保留** |
| `NovelWeb.Controllers.ProviderController` | **保留** |
| `NovelWeb.Controllers.MemoryController` | **删除** |
| `NovelWeb.Controllers.HealthController` | **保留** |

### 2.6 novel_persistence — 保留 DB 基础设施

| 模块 | 处置 |
|------|------|
| `NovelPersistence.Repo` | **保留** |
| 所有 Ecto Schema | **保留**（表结构可复用） |
| `NovelPersistence.MemoryLog` | **保留** |
| `NovelPersistence.MutationLog` | **保留** |
| `NovelPersistence.SchemaDrift` | **保留** |

### 2.7 frontend — 重置为 v3 语义

v3 分支上前端组件全部重写为 v3 TurnResultViewModel 消费模式。v2 前端代码在 v2 分支留存。

---

## 3. 实施顺序

按 v3 DAG 批次逐步重构：

| Batch | 删除的 v2 模块 | 新建的 v3 模块 |
|-------|---------------|---------------|
| B1 VS-00 | Router, Router.Result, Orchestrator, TurnService, IntentRegistry (slot 相关), ClarificationStore, AuthorityGate, BudgetMeter, Agent, Agent.Writer, Capabilities.*, Runtime.*, Memory.Store, AuditLog, LLMLog, LongRunner, MemoryService, MemoryRecallService, ReadingService, MemoryPolicy.*, IntentHandlers.*, AdoptionBoundary | DialogueFrame, DecisionTrace, DialogueGateway, Planner, TurnResultBuilder, TraceWriter |
| B2 VS-00A | — | 扩展 Planner 支持 exploration frame |
| B3 VS-00B | — | ContextAssembler |
| B4 VS-01 | — | ExecutionOrchestrator, GateOrder, MicroPlan, OrchestratorDecision |
| B5 VS-02 | — | Toolbox, Toolbox.Registry, ToolRequest, ToolResult |
| B6 VS-02A | — | TentativeArtifactSet |
| B7 VS-03 | — | BehaviorState, ConfirmationBinding |
| B8 VS-04 | — | AdoptionBoundary v3 |
| B9 VS-05 | — | WorkspaceChannel 重写, TurnResultViewModel |
| B10 VS-06 | — | TraceRedaction, ReplayReport |

---

## 4. 风险与回滚

- **v2 安全**：v2 全部代码在 `origin/idea/dialogue-based-novel-workbench/v2` 等专属分支上，不受任何影响。
- **v3 分支回滚**：如果某个 batch 不可行，`git revert` 即可。
- **编译**：每 batch 完成后必须通过 `mix compile --warnings-as-errors`。
