# 架构分析报告：AI 小说工作台 Elixir/Phoenix Umbrella 项目

**分析日期**: 2026-04-28
**分支**: `idea/dialogue-based-novel-workbench/v2`
**分析范围**: 全部设计文档 + 全部代码 + 依赖关系 + 测试

---

## 目录

1. [设计文档分析](#1-设计文档分析)
2. [当前代码分析](#2-当前代码分析)
3. [设计文档与代码的差距](#3-设计文档与代码的差距)
4. [设计文档存在的问题与建议修改](#4-设计文档存在的问题与建议修改)
5. [推荐目标代码架构](#5-推荐目标代码架构)
6. [迁移路径](#6-迁移路径)
7. [架构门禁方案](#7-架构门禁方案)
8. [风险与注意事项](#8-风险与注意事项)

---

## 1. 设计文档分析

### 1.1 设计文档总览

设计文档分三层组织：

```text
docs/design-v2/
├── Foundation 层 (00-12)  —— 通用 Agent 基础
├── Domain 层    (20-34)  —— 小说业务
└── UI 层        (39-47)  —— 界面与交互
```

另有：
- `adr/` — 15 项已冻结的 ADR（均为 Accepted）
- `schemas/` — JSON Schema SSOT
- `tech-stack/` — 技术栈与工程文档
- `ui-design/` — UI 设计

### 1.2 Foundation 层（设计文档中的 Layer 1）

**定义**（01-agent-foundation-contract.md §2）：

> Agent Foundation Layer 是一个业务无关的 Agent 基础设施层。它不关心"章节""伏笔""人物""卷""正文"等小说术语。

**包含 12 个子系统**：

| # | 子系统 | 文档 | 核心内容 |
|---|--------|------|---------|
| 1 | 交互契约 | 01 §4.1 | TurnResult canonical schema, id 规则 |
| 2 | 回合与任务状态 | 02 | Turn/Clarification/Long-run/Tentative FSM |
| 3 | 意图与对话行为 | 03 | Clarification, Confirmation, Rejection, Cancellation |
| 4 | 能力与 Executor 层 | 04 | Intent Registry, Capability Registry, Router/Executor/Validator |
| 5 | 记忆体系 | 05 | Hot/Warm/Cold 分层, Retrieval Index, Replay |
| 6 | 规划与编排 | 06 | Orchestrator, LongRunner, Checkpoint, Plan |
| 7 | 一致性与并发 | 07 | Revision stamp, Optimistic lock, Rebase/Invalidation |
| 8 | Provider 抽象 | 08 | LLM Provider Gateway, Usage 计量, Error 标准化 |
| 9 | 观测性 | 09 | Trace, Metrics, Structured logs, Replay |
| 10 | 安全与预算 | 10 | Authority Gate, Budget Meter, Confirmation policy |
| 11 | UX 基础语义 | 11 | Card protocol, Render modes, Streaming events |
| 12 | 多 Agent 组合 | 12 | Agent identity, Delegation, Authority/Budget 继承 |

### 1.3 Domain 层（设计文档中的 Layer 2）

**定义**（20-novel-domain-overview.md §2）：

> Novel Domain Layer 是建立在通用 Agent Foundation 之上的小说业务特化层。

**包含 14 个模块**（20-34），分为三组：

| 组 | 文档 | 内容 |
|----|------|------|
| 对象模型 | 21 | Work, Volume, Chapter, Scene, Draft, Character 等 |
| 连续性 | 22 | StateSnapshot, Timeline, Foreshadowing, WorldRule |
| 风格 | 23 | StyleSample, WritingPreferences, Brief |
| Intent 目录 | 24 | 立项/世界观/主线/分卷/章节/场景/正文/改稿 intent 族 |
| 维护钩子 | 25 | Post-hook, Maintenance validator |
| 上下文组装 | 26 | Router/Executor/LongRunner/Reader 的 context 策略 |
| 阅读投影 | 27 | Reading projection, accepted/tentative 边界 |
| 生命周期 | 28 | 建立期/推进期/连载期/修订期 |
| 术语表 | 30 | Foundation/Domain 共享字段名 |
| 质量门禁 | 31 | 连续性/人物/节奏/爽点/hook 等 gate |
| 审批策略 | 32 | 作者确认策略, 高风险 canon 变更 |
| 经验引擎 | 33 | 经验沉淀/反哺上下文 |
| 要素优先级 | 34 | 结构化/半结构化/文档层落位规则 |

### 1.4 设计文档中的代码映射

**tech-stack/03-backend.md §4** 的映射：

```
apps/
├── novel_foundation/   # Layer 1: 业务无关 Agent 基础
├── novel_domain/       # Layer 2: 小说业务
├── novel_web/          # Phoenix API + Channels
└── novel_persistence/  # Ecto schemas + migrations
```

**tech-stack/12-development.md** 给出更详细的目录结构：

```
novel_foundation/lib/foundation/
├── orchestrator/
├── router/
├── executor/
├── validator/
├── long_runner/
├── memory/
├── provider/                # Provider Gateway
├── observability/
├── authority/
├── budget/
├── multi_agent/
├── application.ex
└── telemetry.ex

novel_domain/lib/domain/
├── objects/                 # Work/Volume/Chapter/Scene/Draft/Character
├── continuity/              # StateSnapshot/Timeline/Foreshadowing
├── style/                   # StyleSample/Preferences/Brief
├── intents/                 # Intent registry
├── hooks/                   # Maintenance hooks
├── context_policy/          # Context assembly
├── projection/              # Reading projection
├── lifecycle/               # Authoring lifecycle
├── quality_gates/
├── approval/
└── experience/
```

**tech-stack/03-backend.md §3** 的监督树：

```text
AINovelStudio.Application
├── AINovelStudio.Repo
├── Phoenix.PubSub
├── AINovelStudio.Telemetry
├── AINovelStudio.Foundation.Application
│   ├── Provider.Gateway.Supervisor
│   ├── Memory.Service.Supervisor
│   ├── Authority.Gate
│   ├── Budget.Meter
│   ├── Capability.Registry
│   ├── Hook.Registry
│   └── Observability.Pipeline
├── AINovelStudio.Domain.Application
│   ├── Intent.Registry
│   ├── ContextAssembler.Supervisor
│   ├── Projection.Refresher
│   └── Maintenance.Hooks
├── AINovelStudioWeb.Endpoint
└── Workspace.DynamicSupervisor
    └── (per workspace) → 08-multi-agent.md §2
```

---

## 2. 当前代码分析

### 2.1 实际项目结构

```text
apps/
├── novel_foundation/   (12 .ex 文件, ~350 行业务代码, 5 测试)
├── novel_domain/        ( 2 .ex 文件,  ~15 行业务代码, 0 测试)
├── novel_persistence/   ( 7 .ex 文件, ~300 行业务代码, 16 测试)
└── novel_web/           ( 6 .ex 文件,  ~90 行业务代码,  3 测试)
```

### 2.2 各 app 实际内容

#### novel_foundation（12 个文件）

```
novel_foundation/lib/
├── novel_foundation.ex                         # 公开 API: start_workspace/stop_workspace/start_author/stop_author/spawn_dummy_agent
├── novel_foundation/application.ex              # OTP App: 启动 5 个 Registry + Workspace.DynamicSupervisor
├── novel_foundation/registries.ex               # 5 个 Registry 声明
├── novel_foundation/agent.ex                    # Agent 子树查询 (whereis/list)
├── novel_foundation/agent/dummy.ex              # 占位 GenServer (Phase 0 验证)
├── novel_foundation/agent/children/
│   └── dynamic_supervisor.ex                   # Per-author 下子 Agent DynamicSupervisor
├── novel_foundation/author.ex                   # Author 子树查询 (whereis/list)
├── novel_foundation/author/
│   ├── dynamic_supervisor.ex                   # Per-workspace 下 Author DynamicSupervisor
│   └── supervisor.ex                           # Per-author Supervisor
├── novel_foundation/workspace.ex                # Workspace 子树查询 (whereis/list)
└── novel_foundation/workspace/
    ├── dynamic_supervisor.ex                   # 顶层多 workspace DynamicSupervisor
    └── supervisor.ex                           # Per-workspace Supervisor
```

**实际职责**: 100% 是 Agent 运行时监督树管理代码。0% 是基础工具库。

#### novel_domain（2 个文件）

```
novel_domain/lib/
├── novel_domain.ex                              # 空壳 @moduledoc
└── novel_domain/application.ex                  # 空 Supervisor
```

**实际职责**: 完全空白，骨架占位。

#### novel_persistence（7 个文件）

```
novel_persistence/lib/
├── novel_persistence.ex                         # 空壳
├── novel_persistence/application.ex             # 启动 Repo
├── novel_persistence/repo.ex                    # Ecto Repo (PostgreSQL)
├── novel_persistence/schema_drift.ex            # JSON Schema ↔ Ecto 一致性校验
├── novel_persistence/schemas/
│   ├── workspace.ex                             # DB 表: workspaces (name, description)
│   └── foundation/
│       ├── artifact_adoption_entry.ex           # Embedded schema (JSON mirror, ADR-0001)
│       └── turn_result.ex                      # Embedded schema (JSON mirror, ADR-0001)
└── mix/tasks/codegen.schemas.ex                 # Schema drift 检查 mix task
```

**实际职责**: Ecto Repo + DB Schema + 嵌入式 Schema (JSON mirror) + Schema drift 检查。职责基本清晰。

#### novel_web（6 个文件）

```
novel_web/lib/
├── novel_web.ex                                 # 空壳
├── novel_web/application.ex                     # 启动 PubSub + Endpoint
├── novel_web/endpoint.ex                        # Phoenix Endpoint
├── novel_web/router.ex                          # GET /health
├── novel_web/controllers/
│   ├── health_controller.ex
│   └── error_json.ex
└── novel_web/channels/
    ├── user_socket.ex                           # WebSocket 入口 (无鉴权, Phase 0 占位)
    └── workspace_channel.ex                     # join + ping/pong
```

**实际职责**: Phoenix HTTP + WebSocket 网关，职责清晰，无跨层污染。

### 2.3 依赖关系分析

**mix.exs 层面的依赖声明**:

| App | Hex 依赖 | Umbrella 依赖 |
|-----|---------|--------------|
| novel_foundation | 无 | **无** |
| novel_domain | 无 | **无** |
| novel_persistence | ecto, ecto_sql, postgrex, paper_trail, jason | **无** |
| novel_web | phoenix, phoenix_pubsub, jason, bandit | **无** |

**关键发现**: 所有 app 都没有声明任何 umbrella 内依赖。4 个 app 在 Mix 层面是互相独立的。

**mix xref 编译期图**: 只有 `novel_web/endpoint.ex → novel_web/router.ex`

**mix xref 运行时图**: 全部是 app 内部引用，无跨 app 引用。

**循环依赖检查**: 通过（无循环依赖）。

**编译警告**: 无。

**测试**: 全部通过（24 个测试，0 failures）。

### 2.4 当前代码的质量判断

| 维度 | 判断 |
|------|------|
| 代码质量 | ✅ 良好 — 无警告、测试全过、无循环依赖 |
| 代码量 | ✅ 极轻 — 总共 ~750 行业务代码 |
| 架构正确性 | 🔴 见下一节 |
| 设计文档一致性 | 🔴 见下一节 |

---

## 3. 设计文档与代码的差距

### 3.1 核心差距表

| # | 设计文档说的 | 代码实际 | 差距 |
|---|------------|---------|------|
| 1 | `novel_foundation` = Layer 1 Agent 基础 (orchestrator/router/executor/provider/memory/...) | `novel_foundation` = 仅有监督树启停 (workspace/author/agent Supervisor + Registry + Dummy GenServer) | 设计文档规划的 12 个子系统，代码只实现了监督树骨架 (约 3%) |
| 2 | `novel_domain` = Layer 2 小说业务 (objects/continuity/style/intents/hooks/...) | `novel_domain` = 空壳 | 设计文档规划的 14 个模块，代码一个都没实现 |
| 3 | 监督树根是 `AINovelStudio.Application`，下设 `Foundation.Application` 和 `Domain.Application` 两个子 Application | 实际有 4 个独立 Application，各管各的 | 代码是平铺的 4 个 OTP App，没有统一的 Application 根 |
| 4 | `Workspace.DynamicSupervisor` 在 `AINovelStudio.Application` 根下 | `Workspace.DynamicSupervisor` 在 `NovelFoundation.Application` 下 | 监督树所有权不同 |
| 5 | 设计文档精心定义了分层（Foundation → Domain 不可逆依赖） | 代码中 4 个 app 完全独立，无依赖声明 | 设计文档的架构约束在代码中完全没有体现 |

### 3.2 关键结论

当前代码还处于极早期 Phase 0 阶段。代码量很少，但**架构骨架的放置位置从第一天就错了**：

- `novel_foundation` 的全部代码都是 Agent 运行时管理，不是基础工具库
- `novel_domain` 完全没有启动
- 4 个 app 之间没有任何显式依赖关系

**好消息**: 正因为代码量极少（~750 行），现在调整架构的代价极低。如果等到 Phase 1+ 积累了上千行代码再改，代价会成倍增长。

---

## 4. 设计文档存在的问题与建议修改

### 4.1 核心问题：术语 "Foundation" 的歧义

设计文档把"Agent 运行时基础设施"称为"Foundation Layer"，这个名字有两个问题：

1. **误导性**：大多数开发者的直觉中，"foundation" ≈ "基础工具库"（Result/Error/Clock/Telemetry）。但实际上设计文档的 Foundation 是一个完整的 Agent 运行时引擎 —— Orchestrator、Router、Executor、Provider Gateway、Memory Service 全部在内。

2. **缺少真正的基础层**：项目确实需要一个轻量的共享内核（Result/Error/ID/Clock/Pagination/Validation），但设计文档没有为它留位置。它被隐含地认为"应该在 Foundation 的某个角落"，但没有明确边界。

3. **与代码命名冲突**：设计文档说 `novel_foundation` = Layer 1 Agent 基础（含 12 个子系统），但代码中的 `novel_foundation` 目前只有监督树。未来如果按设计文档填满，`novel_foundation` 会成为项目最大的一个 app（含 orchestrator, router, executor, provider, memory, authority, budget, observability...），这是一个典型的"上帝模块"。

### 4.2 设计文档内部不一致

#### 不一致 1：Intent.Registry 的归属

- `00-overview.md §4.4` 把 Intent Registry 放在 Foundation Layer（子系统 4）
- `04-capability-and-intent-registry.md` 全文把 Intent Registry 作为 Foundation 机制
- 但 `03-backend.md §3` 把 `Intent.Registry` 放在 `Domain.Application` 下

**正确语义**：Foundation 提供 Intent Registry 的**机制**（注册、查询、序列化），Domain 使用这个机制**注册具体的小说 intent**。所以 Intent Registry 作为基础设施属于 Foundation，但小说 intent 的注册行为属于 Domain（或更精确地说，属于 Application）。

#### 不一致 2：Workspace.DynamicSupervisor 的归属

- `03-backend.md §3` 把 `Workspace.DynamicSupervisor` 放在 `AINovelStudio.Application` 根下（与 Foundation.Application 平级）
- `08-multi-agent.md §2` 把 Workspace 监督树作为 Foundation 监督树的一部分

**正确语义**：Workspace 是 Agent 运行时的进程隔离单元，属于 Agent Runtime。

#### 不一致 3：命名空间不统一

- `03-backend.md §3` 用 `AINovelStudio.Foundation.Application` / `AINovelStudio.Domain.Application`
- `12-development.md` 用 `novel_foundation/lib/foundation/` / `novel_domain/lib/domain/`
- `08-multi-agent.md §3` 用 `AINovelStudio.Foundation.Agent.Reviewer`
- 代码中用 `NovelFoundation.*` / `NovelDomain.*` / `NovelWeb.*` / `NovelPersistence.*`

### 4.3 建议的设计文档修改

#### 修改 1：引入三层逻辑架构（替代当前的两层）

当前：
```
Layer 1: Agent Foundation Layer (业务无关 Agent 基础)
Layer 2: Novel Domain Layer     (小说业务)
```

建议改为：
```
Layer 0: Shared Kernel           (基础工具 — Result/Error/ID/Clock/Pagination/Telemetry)
Layer 1: Agent Runtime           (Agent 运行时 — 原 "Foundation Layer")
Layer 2: Novel Domain & Application (小说领域 + 应用编排 — 原 "Domain Layer" 拆分)
```

**理由**：
- "Agent Runtime" 比 "Agent Foundation" 更准确地描述这一层的职责
- 增加 Shared Kernel 为真正的基础工具提供明确位置
- 将 Domain 层拆分为纯领域模型 + 应用编排，避免 Domain 变成第二个"上帝模块"

#### 修改 2：修正 03-backend.md §3 监督树

`Workspace.DynamicSupervisor` 应属于 Agent Runtime 而非根级。

`Intent.Registry` 应明确：机制属于 Agent Runtime，注册内容由 Application 层负责。

#### 修改 3：修正 03-backend.md §4 umbrella 映射

从 4 个 app 改为 6 个：

```
apps/
├── novel_foundation/      # Layer 0: Shared Kernel
├── novel_agent/           # Layer 1: Agent Runtime
├── novel_domain/          # Layer 2a: Novel Domain Models
├── novel_application/     # Layer 2b: Novel Application Services
├── novel_persistence/     # Database Layer
└── novel_web/             # Phoenix Gateway
```

#### 修改 4：更新 12-development.md 目录结构

见下一节代码架构设计。

---

## 5. 推荐目标代码架构

### 5.1 总览

```
apps/
├── novel_foundation/       # Layer 0: Shared Kernel
├── novel_agent/            # Layer 1: Agent Runtime
├── novel_domain/           # Layer 2a: Novel Domain Models
├── novel_application/      # Layer 2b: Novel Application Services
├── novel_persistence/      # Database Layer
└── novel_web/              # Phoenix Gateway
```

### 5.2 novel_foundation（Shared Kernel）

**职责**：项目内所有 app 共享的纯基础能力。无业务语义、无 Agent 概念、无 OTP 进程、无外部依赖（除了 Elixir 标准库）。

```text
novel_foundation/lib/novel_foundation/
├── novel_foundation.ex        # @moduledoc 说明本 app 的边界
├── result.ex                  # {:ok, value} | {:error, reason} 类型与组合子
├── error.ex                   # 统一 Error struct（code, message, details）
├── id.ex                      # ID 生成（UUID v7, prefix 规则）
├── clock.ex                   # 可注入的时间源（便于测试）
├── pagination.ex              # 分页参数与游标
├── validation.ex              # 通用校验 helper
└── telemetry.ex               # Telemetry 事件定义与 helper
```

**禁止包含**：
- 任何 OTP 进程（GenServer, Supervisor, Registry, DynamicSupervisor）
- 任何业务概念（Workspace, Author, Agent, Work, Chapter）
- 任何 Ecto/Phoenix/Provider 依赖
- `Application` 模块（不需要启动，纯库）

**mix.exs 依赖**：无（或仅 `:telemetry`）

### 5.3 novel_agent（Agent Runtime）

**职责**：业务无关的 Agent 运行时引擎。这是项目的核心——设计文档原 "Foundation Layer" 的代码实现。

```text
novel_agent/lib/novel_agent/
├── novel_agent.ex                         # 公开 API
├── novel_agent/application.ex              # OTP App 入口（启动运行时监督树）
│
├── novel_agent/turn/                      # Turn 管理
│   ├── orchestrator.ex                    # Turn 唯一编排入口
│   ├── turn.ex                            # Turn struct
│   └── phase.ex                           # Turn phase 状态机 (RECEIVED→ROUTED→...→COMPLETED)
│
├── novel_agent/router/                    # 路由
│   ├── router.ex                          # Intent 识别 + Slot 抽取
│   └── behaviour.ex                       # Router behaviour
│
├── novel_agent/executor/                  # 执行
│   ├── executor.ex                        # Capability 执行器
│   ├── validator.ex                       # 输出校验器
│   └── behaviour.ex                       # Executor/Validator behaviour
│
├── novel_agent/long_runner/               # 长跑任务
│   ├── long_runner.ex                     # 多步任务编排
│   ├── checkpoint.ex                      # Checkpoint 管理
│   └── plan.ex                            # Plan struct
│
├── novel_agent/registry/                  # 注册中心（Foundation 提供的机制）
│   ├── capability_registry.ex             # Capability 注册与查询
│   ├── intent_registry.ex                 # Intent 注册与查询（机制）
│   ├── hook_registry.ex                   # Hook 注册与触发
│   └── registry.ex                        # 通用 Registry behaviour
│
├── novel_agent/memory/                    # 记忆服务
│   ├── memory_service.ex                  # 记忆管理（Hot/Warm/Cold）
│   ├── retrieval.ex                       # 检索接口
│   └── tier.ex                            # 冷热分层逻辑
│
├── novel_agent/provider/                  # Provider Gateway（原设计文档 §8）
│   ├── gateway.ex                         # 统一 LLM 调用入口
│   ├── behaviour.ex                       # Provider behaviour
│   ├── openai.ex                          # OpenAI 适配器
│   ├── anthropic.ex                       # Anthropic 适配器
│   ├── stub.ex                            # Stub provider（正式实现）
│   ├── usage.ex                           # Usage 统一计量
│   └── error.ex                           # Provider error 标准化
│
├── novel_agent/runtime/                   # 运行时进程管理（← 从当前 novel_foundation 迁移）
│   ├── registries.ex                      # Registry 声明
│   ├── workspace_session.ex               # Workspace 会话管理
│   ├── workspace_session/
│   │   ├── dynamic_supervisor.ex
│   │   └── supervisor.ex
│   ├── author_session.ex                  # Author 会话管理
│   ├── author_session/
│   │   ├── dynamic_supervisor.ex
│   │   └── supervisor.ex
│   ├── agent_process.ex                   # Agent 进程管理（原名 Agent，与 Elixir 标准库冲突）
│   └── agent_process/
│       ├── children/
│       │   └── dynamic_supervisor.ex
│       └── dummy.ex                       # Phase 1 替换为 Writer/Reviewer/Planner
│
├── novel_agent/authority/                 # 权限门禁
│   └── gate.ex
│
├── novel_agent/budget/                    # 预算计量
│   └── meter.ex
│
├── novel_agent/observability/             # 观测性
│   ├── trace.ex
│   └── metrics.ex
│
└── novel_agent/multi_agent/               # 多 Agent 组合
    ├── envelope.ex                        # Agent 间消息协议
    └── delegation.ex                      # 委派管理
```

**依赖**：

```elixir
defp deps do
  [
    {:novel_foundation, in_umbrella: true},
    # Provider 相关的 hex 依赖（langchain, instructor_lite, req）
    # Ecto/Phoenix 依赖（通过 novel_persistence 间接）
  ]
end
```

**关键**：`novel_agent` 不依赖 `novel_domain`。Agent Runtime 不知道什么是章节、人物、伏笔。

### 5.4 novel_domain（Novel Domain Models）

**职责**：纯小说领域模型与领域规则。无副作用、无 I/O、无进程。

```text
novel_domain/lib/novel_domain/
├── novel_domain.ex
│
├── novel_domain/works/                     # 主结构对象
│   ├── work.ex                             # Work struct
│   ├── volume.ex                           # Volume struct
│   ├── chapter.ex                          # Chapter struct
│   ├── scene.ex                            # Scene struct
│   ├── draft.ex                            # Draft struct
│   ├── worldbuilding.ex                    # Worldbuilding struct
│   └── outline.ex                          # MainOutline/Arc struct
│
├── novel_domain/characters/                # 资产对象
│   ├── character.ex
│   ├── faction.ex
│   ├── location.ex
│   └── relationship.ex
│
├── novel_domain/continuity/                # 连续性对象
│   ├── state_snapshot.ex
│   ├── timeline_event.ex
│   ├── foreshadowing.ex
│   └── world_rule.ex
│
├── novel_domain/style/                     # 风格对象
│   ├── style_sample.ex
│   ├── writing_preferences.ex
│   └── brief.ex
│
├── novel_domain/policies/                  # 领域规则（纯函数，无副作用）
│   ├── continuity_policy.ex                # 连续性规则
│   ├── style_policy.ex                     # 风格规则
│   ├── quality_gates.ex                    # 质量门禁规则
│   └── approval_policy.ex                  # 审批策略
│
└── novel_domain/events/                    # 领域事件（纯 struct）
    ├── events.ex                           # 事件类型定义
    └── event_bus.ex                        # EventBus behaviour（不含具体实现）
```

**禁止包含**：
- Ecto.Schema / Ecto.Changeset
- GenServer / Supervisor / Registry
- Phoenix 任何模块
- HTTP Client
- Repo / 数据库查询

**依赖**：

```elixir
defp deps do
  [
    {:novel_foundation, in_umbrella: true}
  ]
end
```

### 5.5 novel_application（Novel Application Services）

**职责**：小说创作的应用服务层。这是"胶水层"——协调 novel_domain（领域模型）+ novel_agent（Agent 运行时）+ novel_persistence（数据库）来完成具体的创作用例。

```text
novel_application/lib/novel_application/
├── novel_application.ex                    # 公开 API
│
├── novel_application/works/                # 作品管理用例
│   ├── create_work.ex                      # 创建作品
│   ├── open_work.ex                        # 打开作品
│   └── manage_structure.ex                 # 管理卷/章结构
│
├── novel_application/chapters/             # 章节创作用例
│   ├── start_chapter.ex                    # 开始新章
│   ├── continue_chapter.ex                 # 续写章节
│   ├── revise_chapter.ex                   # 修订章节
│   └── review_chapter.ex                   # 审阅章节
│
├── novel_application/conversations/        # 对话处理用例
│   ├── handle_message.ex                   # 处理作者消息（核心入口）
│   └── assemble_turn.ex                    # 组装 Turn 输入
│
├── novel_application/context/              # 上下文组装（领域策略的执行）
│   ├── context_builder.ex                  # 上下文构建器
│   ├── context_selector.ex                 # 上下文选择策略
│   └── context_budget.ex                   # 上下文 Token 预算
│
├── novel_application/prompts/              # Prompt 构建（小说特化）
│   ├── prompt_builder.ex                   # Prompt 组装
│   ├── system_prompts.ex                   # System prompt 模板
│   └── task_prompts.ex                     # 任务 prompt 模板
│
├── novel_application/registration/         # 领域注册（向 Agent Runtime 注册小说能力）
│   ├── intent_registration.ex              # 注册小说 intent
│   ├── capability_registration.ex           # 注册小说 capability
│   └── hook_registration.ex                # 注册小说 hook
│
├── novel_application/projection/           # 阅读投影更新协调
│   ├── refresher.ex                        # Projection Refresher
│   └── subscriber.ex                       # Domain Event 订阅
│
└── novel_application/runtime/              # 小说创作运行时（生成会话等）
    └── generation_session.ex               # 一次 AI 生成会话
```

**依赖**：

```elixir
defp deps do
  [
    {:novel_foundation, in_umbrella: true},
    {:novel_domain, in_umbrella: true},
    {:novel_agent, in_umbrella: true}
  ]
end
```

**注意**：`novel_application` 依赖 `novel_agent` 和 `novel_domain`，但不直接依赖 `novel_persistence`（通过 `novel_agent` 间接使用）。

### 5.6 novel_persistence（Database Layer）

**职责**：数据库实现。保持当前结构，增强内部分层。

```text
novel_persistence/lib/novel_persistence/
├── novel_persistence.ex
├── novel_persistence/application.ex
├── novel_persistence/repo.ex
│
├── novel_persistence/schemas/              # DB 表 Ecto Schema（← 当前内容，移到子目录）
│   ├── workspace.ex                        # workspaces 表
│   └── ...                                 # 未来：versions, interactions, checkpoints 等
│
├── novel_persistence/embedded/             # 嵌入式 Schema（JSON mirror）（← 从 schemas/ 分出）
│   ├── artifact_adoption_entry.ex
│   └── turn_result.ex
│
├── novel_persistence/repository/           # Repository 模式（未来需要时）
│   ├── workspace_repo.ex
│   └── ...
│
├── novel_persistence/mappers/              # DB Schema ↔ Domain Model 映射（未来需要时）
│   └── workspace_mapper.ex
│
├── novel_persistence/multi/                # Ecto.Multi 函数集（adoption boundary）
│   └── ...
│
└── novel_persistence/schema_drift.ex       # 已有，保持
```

**依赖**：

```elixir
defp deps do
  [
    {:novel_foundation, in_umbrella: true},
    {:novel_domain, in_umbrella: true},      # 当引入 mapper 时需要
    {:ecto, "~> 3.13"},
    {:ecto_sql, "~> 3.13"},
    {:postgrex, "~> 0.22"},
    {:paper_trail, "~> 1.1"},
    {:jason, "~> 1.4"}
  ]
end
```

### 5.7 novel_web（Phoenix Gateway）

**职责**：HTTP + WebSocket 网关。保持当前结构，不需要大改。

```text
novel_web/lib/novel_web/
├── novel_web.ex
├── novel_web/application.ex
├── novel_web/endpoint.ex
├── novel_web/router.ex
├── novel_web/controllers/
├── novel_web/channels/
├── novel_web/plugs/                         # 未来：auth, workspace_scope
└── novel_web/serializers/                   # JSON 序列化
```

**依赖**：

```elixir
defp deps do
  [
    {:novel_application, in_umbrella: true},
    {:novel_foundation, in_umbrella: true},   # 仅用基础类型
    {:phoenix, "~> 1.8"},
    {:phoenix_pubsub, "~> 2.1"},
    {:jason, "~> 1.4"},
    {:bandit, "~> 1.5"}
  ]
end
```

**禁止依赖**：`novel_persistence`（不直接碰 Repo/Query）、`novel_agent`（不直接调 Agent Runtime）、`novel_domain`

### 5.8 完整依赖图

```text
novel_web
    ├── novel_application
    └── novel_foundation

novel_application
    ├── novel_agent
    ├── novel_domain
    └── novel_foundation

novel_agent
    └── novel_foundation

novel_persistence
    ├── novel_domain
    └── novel_foundation

novel_domain
    └── novel_foundation

novel_foundation
    └── nothing (仅 Elixir stdlib)
```

**编译顺序**（Mix 自动推导）：
```
novel_foundation → novel_domain → novel_persistence → novel_agent → novel_application → novel_web
```

### 5.9 与设计文档的逻辑层级对应

| 设计文档逻辑层 | 代码 app |
|--------------|---------|
| Layer 0: Shared Kernel (新增) | `novel_foundation` |
| Layer 1: Agent Runtime (原 "Foundation") | `novel_agent` |
| Layer 2a: Domain Models | `novel_domain` |
| Layer 2b: Application Services | `novel_application` |
| (横切) Database | `novel_persistence` |
| (横切) Web Gateway | `novel_web` |

---

## 6. 迁移路径

### 6.1 设计文档修改（第一步，先于代码）

#### 文档修改清单

| 文件 | 修改内容 |
|------|---------|
| `00-overview.md` §3 | 总体分层从 2 层改为 3 层（加 Shared Kernel）；重命名 "Agent Foundation Layer" → "Agent Runtime Layer" |
| `01-agent-foundation-contract.md` §2 | 标题改为 "Agent Runtime Layer 的定义" |
| `tech-stack/03-backend.md` §3 | 监督树归属修正：Intent.Registry 不在 Domain.Application；Workspace.DynamicSupervisor 归属 Agent Runtime |
| `tech-stack/03-backend.md` §4 | Umbrella 从 4 app 改为 6 app |
| `tech-stack/12-development.md` §1 | 目录树更新为新 6-app 结构 |
| `README.md` | 文档分区增加 "Shared Kernel" 说明 |
| `00a-system-landscape.md` | 更新全景图以反映三层 + 6 app |

**注意**：`00-overview.md` §4 的 12 个子系统定义**不需要改内容**，只需要把章节标题的 "Agent Foundation Layer" 改为 "Agent Runtime Layer"。子系统本身的设计是正确的。

### 6.2 代码迁移（第二步，在文档修改 review 通过后）

#### Phase 0-A：创建新 app 骨架（预计 30 分钟）

```
步骤 1: 创建 novel_agent
  cd apps && mix new novel_agent --sup
  配置 mix.exs（deps: [novel_foundation]）

步骤 2: 创建 novel_application
  cd apps && mix new novel_application --sup
  配置 mix.exs（deps: [novel_foundation, novel_domain, novel_agent]）

步骤 3: 验证编译
  mix compile（应通过，新 app 是空壳）

步骤 4: 验证测试
  mix test（应通过）
```

#### Phase 0-B：搬迁 novel_foundation 的全部代码到 novel_agent（预计 1 小时）

这是唯一有实质性的迁移步骤：

```
步骤 5: 创建 novel_agent/lib/novel_agent/runtime/ 目录

步骤 6: 逐个搬迁文件，同时改 namespace：

  原文件                                              新文件
  ─────────────────────────────────────────────────────────────────
  novel_foundation/application.ex              → novel_agent/application.ex
  novel_foundation/registries.ex               → novel_agent/runtime/registries.ex
  novel_foundation/workspace.ex                → novel_agent/runtime/workspace_session.ex
  novel_foundation/workspace/dynamic_supervisor.ex → novel_agent/runtime/workspace_session/dynamic_supervisor.ex
  novel_foundation/workspace/supervisor.ex     → novel_agent/runtime/workspace_session/supervisor.ex
  novel_foundation/author.ex                   → novel_agent/runtime/author_session.ex
  novel_foundation/author/dynamic_supervisor.ex → novel_agent/runtime/author_session/dynamic_supervisor.ex
  novel_foundation/author/supervisor.ex        → novel_agent/runtime/author_session/supervisor.ex
  novel_foundation/agent.ex                    → novel_agent/runtime/agent_process.ex
  novel_foundation/agent/dummy.ex              → novel_agent/runtime/agent_process/dummy.ex
  novel_foundation/agent/children/dynamic_supervisor.ex → novel_agent/runtime/agent_process/children/dynamic_supervisor.ex

  命名空间映射：
  NovelFoundation            → NovelAgent.Runtime
  NovelFoundation.Application → NovelAgent.Application
  NovelFoundation.Registries  → NovelAgent.Runtime.Registries
  NovelFoundation.Workspace   → NovelAgent.Runtime.WorkspaceSession
  NovelFoundation.Author      → NovelAgent.Runtime.AuthorSession
  NovelFoundation.Agent       → NovelAgent.Runtime.AgentProcess

步骤 7: 更新 novel_foundation/lib/novel_foundation.ex
  删除全部公开 API 函数（start_workspace 等）
  保留模块，@moduledoc 更新为 "Shared Kernel 基础能力"

步骤 8: 更新 novel_foundation/mix.exs
  移除 `mod: {NovelFoundation.Application, []}`
  novel_foundation 变为纯库（不需要 OTP Application）

步骤 9: 创建 novel_agent/lib/novel_agent.ex
  提供与原来 novel_foundation.ex 相同的公开 API
  （start_workspace, stop_workspace, start_author, stop_author, spawn_dummy_agent, 各种 pid 查询）

步骤 10: 搬迁测试
  novel_foundation/test/novel_foundation_test.exs → novel_agent/test/novel_agent_test.exs
  更新 alias 和模块引用
```

#### Phase 0-C：更新 novel_web 的依赖（预计 15 分钟）

```
步骤 11: novel_web/mix.exs 添加 {:novel_agent, in_umbrella: true}
步骤 12: 如果 novel_web 中有对 NovelFoundation 的引用，改为 NovelAgent
  （检查后发现当前没有 — Phase 0 阶段 web 还没对接 foundation）
```

#### Phase 0-D：验证与清理（预计 30 分钟）

```
步骤 13: mix deps.get && mix compile --warnings-as-errors
步骤 14: mix test
步骤 15: mix xref graph --format cycles --label compile-connected --fail-above 0
步骤 16: 验证 umbella 内依赖声明正确
步骤 17: git commit
```

#### Phase 1（后续，不立即执行）

```
- 在 novel_domain 中创建领域模型 struct
- 在 novel_application 中创建第一个用例（如 CreateWork）
- novel_application 向 novel_agent 注册小说 intent
- novel_agent 中 dummy.ex 替换为真正的 Writer/Reviewer/Planner GenServer
- novel_web 对接 novel_application API
```

---

## 7. 架构门禁方案

### 7.1 mix.exs 显式依赖声明（强制约束）

每个 app 的 `mix.exs` 必须通过 `in_umbrella: true` 显式声明依赖。这是 Elixir 编译器强制执行的第一道门禁。

**规则**：

| App | 可依赖 |
|-----|--------|
| novel_foundation | 无 |
| novel_domain | novel_foundation |
| novel_persistence | novel_foundation, novel_domain |
| novel_agent | novel_foundation |
| novel_application | novel_foundation, novel_domain, novel_agent |
| novel_web | novel_foundation, novel_application |

**禁止的依赖**（编译期就会被 enforcing）：

```elixir
# novel_domain 不能声明
{:novel_persistence, in_umbrella: true}  # ❌
{:novel_agent, in_umbrella: true}         # ❌
{:novel_web, in_umbrella: true}           # ❌

# novel_agent 不能声明
{:novel_domain, in_umbrella: true}        # ❌ Agent 不知道小说业务
{:novel_web, in_umbrella: true}           # ❌

# novel_web 不能声明
{:novel_persistence, in_umbrella: true}   # ❌ Web 不直接碰 DB
{:novel_agent, in_umbrella: true}         # ❌ Web 不直接调 Agent Runtime
```

### 7.2 自定义架构检查脚本

```elixir
# scripts/arch_check.exs
defmodule ArchCheck do
  @moduledoc """
  架构门禁脚本。检查代码层是否违反设计文档定义的依赖规则。
  """

  # ---- 禁止规则 ----

  @foundation_forbidden [
    # novel_foundation 不能包含任何业务概念
    ~r/NovelFoundation.*(?:GenServer|DynamicSupervisor|Supervisor|Registry)/,
    ~r/NovelFoundation\.(?:Agent|Author|Workspace)(?:\.|$)/,
    ~r/NovelFoundation.*(?:Ecto|Phoenix|Repo)/,
  ]

  @domain_forbidden [
    # novel_domain 不能有副作用或基础设施依赖
    ~r/Ecto\./,
    ~r/Phoenix\./,
    ~r/Repo\./,
    ~r/GenServer/,
    ~r/DynamicSupervisor/,
    ~r/Registry\./,
  ]

  @agent_forbidden [
    # novel_agent 不能依赖小说业务概念
    ~r/NovelDomain\./,
    ~r/NovelApplication\./,
  ]

  @web_forbidden [
    # novel_web 不能直接碰数据库和 Agent 运行时
    ~r/Ecto\.Query/,
    ~r/NovelPersistence\.Repo/,
    ~r/NovelPersistence\.Schemas\./,
    ~r/NovelAgent\.(?!Runtime\.)/,  # 不能直接调 Agent 内部模块
  ]

  @app_rules %{
    "novel_foundation" => @foundation_forbidden,
    "novel_domain" => @domain_forbidden,
    "novel_agent" => @agent_forbidden,
    "novel_web" => @web_forbidden,
  }

  def run do
    errors = []

    errors =
      Enum.reduce(@app_rules, errors, fn {app, rules}, acc ->
        files = Path.wildcard("apps/#{app}/lib/**/*.ex")
        acc ++ check_files(files, rules, app)
      end)

    # 循环依赖检查
    {cycle_output, cycle_status} =
      System.cmd("mix", ["xref", "graph", "--format", "cycles",
        "--label", "compile-connected", "--fail-above", "0"])

    if cycle_status != 0 do
      errors = errors ++ ["循环依赖检测失败:\n#{cycle_output}"]
    end

    if errors == [] do
      IO.puts("✅ 架构检查通过")
      System.halt(0)
    else
      IO.puts("❌ 架构违规:\n")
      Enum.each(errors, &IO.puts("  - #{&1}"))
      System.halt(1)
    end
  end

  defp check_files(files, rules, app) do
    Enum.flat_map(files, fn file ->
      content = File.read!(file)
      Enum.flat_map(rules, fn rule ->
        if match = Regex.run(rule, content) do
          ["[#{app}] #{file}: 匹配到禁止模式 #{inspect(rule)}"]
        else
          []
        end
      end)
    end)
  end
end

ArchCheck.run()
```

### 7.3 root mix.exs 中的 check alias

```elixir
# root mix.exs
defp aliases do
  [
    check: [
      "compile --warnings-as-errors",
      "xref graph --format cycles --label compile-connected --fail-above 0",
      "test",
      "run scripts/arch_check.exs"
    ]
  ]
end
```

### 7.4 CI 接入

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
    steps:
      - uses: actions/checkout@v4
      - uses: erlef/setup-beam@v1
        with:
          elixir-version: "1.19"
          otp-version: "28"
      - run: mix deps.get
      - run: mix check
```

### 7.5 门禁规则总结

| # | 规则 | 执行方式 | 违规时 |
|---|------|---------|--------|
| 1 | novel_foundation 不能有业务模块/OTP 进程 | `scripts/arch_check.exs` | CI 失败 |
| 2 | novel_domain 不能依赖 Ecto/Phoenix/GenServer | `scripts/arch_check.exs` | CI 失败 |
| 3 | novel_agent 不能依赖 novel_domain | mix.exs 不声明 in_umbrella | 编译失败 |
| 4 | novel_web 不能依赖 novel_persistence/novel_agent | mix.exs 不声明 in_umbrella + arch_check | 编译失败 + CI 失败 |
| 5 | 无循环依赖 | `mix xref graph --format cycles --fail-above 0` | CI 失败 |
| 6 | 编译无警告 | `mix compile --warnings-as-errors` | CI 失败 |
| 7 | 全部测试通过 | `mix test` | CI 失败 |

---

## 8. 风险与注意事项

### 8.1 术语统一

设计文档修改后，以下术语在全部文档中必须保持一致：

| 旧术语 | 新术语 | 适用范围 |
|--------|--------|---------|
| Agent Foundation Layer | Agent Runtime Layer | 设计文档 |
| novel_foundation (原定义) | novel_agent | 代码 |
| novel_foundation (新定义) | novel_foundation (Shared Kernel) | 代码 |
| Agent.Dummy / Agent.Writer | AgentProcess.Dummy / AgentProcess.Writer | 代码（避免与 Elixir 标准库 Agent 冲突） |

### 8.2 不立即做的事情

- ❌ 不要急于在 `novel_domain` 中创建大量领域模型 struct — 等 Phase 1 需要时按需创建
- ❌ 不要在 `novel_agent` 中实现全部 12 个子系统 — 按 Phase 1+ 渐进式填充
- ❌ 不要在 `novel_application` 还没成型时引入复杂的 repository/mapper 模式
- ❌ 不要为了架构"完整性"提前创建 `novel_agent` 的空模块文件

### 8.3 当前代码中值得保留的内容

当前所有代码都**不需要删除**，只需要**搬家**：

- 监督树三层（workspace → author → agent）的设计是正确的
- `:one_for_one` / `:rest_for_one` crash isolation 策略是正确的
- Registry 注册与查询模式是正确的
- Dummy GenServer 作为 Phase 0 验证是正确的
- 测试用例是有效的（搬家后需要更新 alias）

### 8.4 关键设计决策留待后续

以下决策不在本次架构调整中解决，留给后续 Phase：

1. **Provider Gateway 是否单独拆 app**：当前放在 `novel_agent` 内，如果未来 Provider 适配器超过 5 个或需要独立发布，再拆分为 `novel_provider`
2. **Repository 模式**：当 Domain Model 和 DB Schema 出现明显分歧时再引入
3. **Event Bus 实现**：当前用 Phoenix.PubSub 够用，如果需要跨节点再换
4. **novel_persistence 内部分层**：当 schemas 数量超过 20 时再细分 `schemas/` 和 `embedded/`

### 8.5 执行优先级

```
优先级 1: 设计文档修改（2-3 小时，review + 修订）
优先级 2: 创建 novel_agent + novel_application 空壳（30 分钟）
优先级 3: 搬迁 novel_foundation → novel_agent（1 小时）
优先级 4: 清理 novel_foundation + 更新依赖声明（30 分钟）
优先级 5: 创建 arch_check.exs + CI 配置（1 小时）
优先级 6: 验证 + 测试 + commit（30 分钟）
─────────────────────────────────────────
总计预估: 5-6 小时
```

---

## 附录 A：设计文档修改细节

### A.1 00-overview.md §3 修改

**当前**：
```markdown
## 3. 总体分层
v2 架构分两层：
Layer 2: Novel Domain Layer
Layer 1: Agent Foundation Layer
```

**修改为**：
```markdown
## 3. 总体分层
v2 架构分三层：

Layer 0: Shared Kernel — 无业务语义的基础工具库
Layer 1: Agent Runtime Layer — 业务无关的 Agent 运行时引擎
Layer 2: Novel Domain & Application — 小说领域模型 + 创作应用服务
```

### A.2 03-backend.md §4 修改

**当前**：
```
apps/
├── novel_foundation/   # Layer 1
├── novel_domain/       # Layer 2
├── novel_web/
└── novel_persistence/
```

**修改为**：
```
apps/
├── novel_foundation/    # Layer 0: Shared Kernel
├── novel_agent/         # Layer 1: Agent Runtime
├── novel_domain/        # Layer 2a: Domain Models
├── novel_application/   # Layer 2b: Application Services
├── novel_persistence/   # Database
└── novel_web/           # Phoenix Gateway
```

---

## 附录 B：当前代码逐文件迁移表

| # | 当前文件 | 处理方式 | 目标文件 |
|---|---------|---------|---------|
| 1 | `novel_foundation/lib/novel_foundation/application.ex` | 迁移+改名 | `novel_agent/lib/novel_agent/application.ex` |
| 2 | `novel_foundation/lib/novel_foundation.ex` | 重写 | `novel_agent/lib/novel_agent.ex` + 清空 `novel_foundation.ex` |
| 3 | `novel_foundation/lib/novel_foundation/registries.ex` | 迁移+改名 | `novel_agent/lib/novel_agent/runtime/registries.ex` |
| 4 | `novel_foundation/lib/novel_foundation/workspace.ex` | 迁移+改名 | `novel_agent/lib/novel_agent/runtime/workspace_session.ex` |
| 5 | `novel_foundation/lib/novel_foundation/workspace/dynamic_supervisor.ex` | 迁移+改名 | `novel_agent/lib/novel_agent/runtime/workspace_session/dynamic_supervisor.ex` |
| 6 | `novel_foundation/lib/novel_foundation/workspace/supervisor.ex` | 迁移+改名 | `novel_agent/lib/novel_agent/runtime/workspace_session/supervisor.ex` |
| 7 | `novel_foundation/lib/novel_foundation/author.ex` | 迁移+改名 | `novel_agent/lib/novel_agent/runtime/author_session.ex` |
| 8 | `novel_foundation/lib/novel_foundation/author/dynamic_supervisor.ex` | 迁移+改名 | `novel_agent/lib/novel_agent/runtime/author_session/dynamic_supervisor.ex` |
| 9 | `novel_foundation/lib/novel_foundation/author/supervisor.ex` | 迁移+改名 | `novel_agent/lib/novel_agent/runtime/author_session/supervisor.ex` |
| 10 | `novel_foundation/lib/novel_foundation/agent.ex` | 迁移+改名 | `novel_agent/lib/novel_agent/runtime/agent_process.ex` |
| 11 | `novel_foundation/lib/novel_foundation/agent/dummy.ex` | 迁移+改名 | `novel_agent/lib/novel_agent/runtime/agent_process/dummy.ex` |
| 12 | `novel_foundation/lib/novel_foundation/agent/children/dynamic_supervisor.ex` | 迁移+改名 | `novel_agent/lib/novel_agent/runtime/agent_process/children/dynamic_supervisor.ex` |
| 13 | `novel_foundation/test/novel_foundation_test.exs` | 迁移+改名 | `novel_agent/test/novel_agent_test.exs` |
| 14 | `novel_foundation/test/test_helper.exs` | 保留 | 不变（或删除，因为 foundation 不再有测试） |
| 15 | `novel_domain/*` | 保留 | 不变（目前空壳，未来填充） |
| 16 | `novel_persistence/*` | 保留 | 不变（仅建议内部分层，不做迁移） |
| 17 | `novel_web/*` | 保留 | 不变（仅更新 mix.exs 依赖） |

---

*本报告基于 2026-04-28 代码状态和设计文档状态编写。*
