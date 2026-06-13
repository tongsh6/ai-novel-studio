# Backend 后端栈

> 状态：草案
>
> 目的：定义 Elixir 后端的完整栈、版本基线、关键纪律。本文不展开具体子系统的设计（那些在 [`07-provider.md`](./07-provider.md)、[`08-multi-agent.md`](./08-multi-agent.md) 等）。

---

## 1. 总览

```yaml
language:        Elixir 1.19+
runtime:         Erlang/OTP 28+
web:             Phoenix 1.8 (API only, no LiveView)
db_orm:          Ecto 3.x
db_alpha:        SQLite via ecto_sqlite3
db_beta:         PostgreSQL via postgrex / ecto_sql
migrations:      Ecto.Migration
revision_audit:  paper_trail (Hibernate Envers 等价)
event_bus:       Phoenix.PubSub + Distributed Erlang
long_run:        GenServer + GenStage + Task.Supervisor
schema_validate: Ecto.Changeset + Dialyxir
llm_client:      langchain_elixir + instructor_lite + 自封装 Provider Gateway
http_client:     Req
testing:         ExUnit + Mox + StreamData
observability:   opentelemetry-erlang + Phoenix.Telemetry
release:         Mix Release (单二进制)
```

---

## 2. 选型理由

### 2.1 Elixir 1.19+

| 优势 | 对应本项目硬骨 |
|---|---|
| OTP supervision tree | [`../00-overview.md`](../00-overview.md) §4.12 多 Agent 父子关系是基因 |
| Process isolation + linking + monitoring | §4.12 crash isolation + handoff agent_ref |
| GenServer + 异步消息 | §4.12 Agent 间消息协议 |
| Reduction-based scheduling | §4.10 Budget 计量天然 |
| Distributed Erlang | 阶段 2 跨节点免费 |
| Mix Release 单二进制 | 阶段 1 桌面应用部署轻 |
| Hot code swap | 阶段 2 多作者期 0 downtime 升级（可选）|

为什么 1.19+：

- Elixir 1.17 引入 set-theoretic types 早期版本；1.19 继续增强类型检查与大型项目编译性能，更适合作为新项目基线
- Erlang/OTP 28 是 Elixir 1.19 的推荐运行时基线，避免 Phase 0 后立刻遇到运行时升级阻塞

### 2.2 Phoenix 1.8（API only）

| 优势 | 备注 |
|---|---|
| Channels（WebSocket）| 适合流式 + Multi-Agent 进度推送 + ADR-0011 projection refresh 通知 |
| Phoenix.PubSub | Event Bus 一行注解 |
| Plug 中间件链 | Authority Gate / Budget Meter 横切层标准位置 |
| `phx.gen` 自动生成 | API endpoint 模板化 |
| 不用 LiveView | 前端独立 SPA，UI 不在 server 端渲染 |

**为什么不用 LiveView**：

LiveView 的"server-rendered + WebSocket diff"模式会绑定 UI 状态到服务端，违反 [`../00e-architecture.md`](../00e-architecture.md) §10 反模式 #5 "UI 不能直接读 Domain Stores"。本项目的 UI 复杂度（卡片协议 + 流式 + 结构面板 + 多种 render mode）也超出 LiveView 适用范围。

Phoenix 退化为 API server + WebSocket gateway。

### 2.3 Ecto 3.x

| 用途 | 说明 |
|---|---|
| ORM | 所有 Domain Object / Continuity / Style schemas |
| Changeset | ADR-0001 字段级 validation |
| Migration | Ecto.Migration（强制版本化） |
| Adapter 抽象 | SQLite ↔ PostgreSQL 切换 |
| Multi | 跨表事务 + adoption boundary 原子性 |
| Query DSL | Reading projection 查询 |

**关键纪律**：

- 所有可演化对象表必须有 `revision_id` + `inserted_at` + `updated_at`
- 跨表关联通过 `belongs_to / has_many` + 显式 `foreign_key`
- Adoption boundary 必须用 `Ecto.Multi.run/4` 保证原子性

### 2.4 paper_trail（revision audit）

> 状态：✅ 基线（已实测，2026-04-26）。详见 [`verification/paper-trail-ecto-compatibility.md`](./verification/paper-trail-ecto-compatibility.md)。

`paper_trail` 是 Elixir 生态的版本历史插件，对应 v2 [`../30-contract-glossary.md`](../30-contract-glossary.md) §2.3 `source_revision_refs` 的硬约束：

- 每次写入自动创建 `versions` 表的 audit record
- 包含 `event` (insert/update/delete) + `item_changes` (jsonb 增量) + `originator_id`
- 提供 `PaperTrail.get_versions/1` 查询历史

实测要点（已写入 v2 contract 实现纪律）：

- `Ecto.Multi` 强制失败时不会留下孤立 version（同事务边界）。
- `versions.id` 是 BIGSERIAL，可直接写入 `source_revision_refs.source_revision_id`。
- 自定义 atom 错误必须走 `repo.transaction(multi)`，**不要**走 `PaperTrail.Multi.commit/1`（后者假设 error 第三元为 `Ecto.Changeset`）。
- `item_type` 仅存"末段模块名"（`Module |> Module.split() |> List.last()`），跨 boundary 同名 schema 时必须在 `meta` 里冗余 namespace。
- SQLite 阶段必须固化 `pool_size: 1` + WAL，否则会触发 "database is locked"。

替代方案（仅作为兜底，不再是评估项）：

- 自实现 audit log（增加复杂度）
- Ecto.Changeset.prepare_changes 钩子（要重复造轮子）

### 2.5 langchain_elixir + instructor_lite

> 状态：✅ 基线（已实测，2026-04-26 含 `instructor_lite` 补评）。详见 [`verification/structured-output-library-choice.md`](./verification/structured-output-library-choice.md)。
>
> 关键改动：原方案中的 `instructor_ex` 0.1.0 已被 `instructor_lite` 1.2 替换。两者都走 Ecto schema → JSON Schema 的派生路径，但 `instructor_lite` 输出更精简，`instructor_ex` 会额外注入 description / format / pattern 等元数据；本项目选择 `instructor_lite` 是因为它在 2025-2026 内有 5 次 1.x release，维护活跃度显著优于未再发布新版的 hex `instructor` 0.1.0。

**职责分层**（Phase 0 起强制，避免双源真相）：

| 层 | 工具 | 职责 |
|---|---|---|
| 结构化输出（intent slot / artifact / card payload / quality finding） | `instructor_lite` 1.2 | Ecto embedded_schema 作为 SSOT → 自动派生 JSON Schema（含 `Ecto.Enum` enum 约束）→ Ecto changeset 二次校验 → `Adapter` behaviour 化 provider 接入。spike 实测 normal 20/20，free_form/lure_extra 各 3/3，全部 100%。|
| 多 Agent / 工具链编排（function calling、多步推理、工具选择） | `langchain` 0.8 | ChatModel / Message / LLMChain 抽象 + 主流 provider 适配；instructor_lite 不覆盖这部分。 |
| 统一计量、错误归一、retry、circuit breaker、stub | 自封装 Provider Gateway（[`07-provider.md`](./07-provider.md)） | 包住前两者；**必须**吸收 langchain 的 `Req.TransportError` 漏网（spike 中 path A 该错误未被 `LangChainError` 捕获，落到 rescue 变 `:exception`）。|

`langchain` 提供：ChatModel / Message 抽象、Function calling、Streaming、主流 provider 适配（OpenAI / Anthropic / Azure / Bedrock / Ollama）。

`instructor_lite` 提供：Pydantic-style 结构化输出（Ecto schema → JSON Schema）、可选 retry + Ecto changeset 二次校验、`InstructorLite.Adapter` behaviour 让自定义 provider 不需要 fork。是 ADR-0001 字段抽取的天然工具。

**禁止**：产品代码绕过 Provider Gateway 直接调用 langchain 或 instructor_lite；具体 contract 在 [`07-provider.md`](./07-provider.md)。

**Ecto.Enum 落地纪律**（spike 实测后追加）：

- LLM I/O embedded_schema 中受限字符串字段必须用 `field :foo, Ecto.Enum, values: [...]`，**不要**写 `field :foo, :string` + 注释里说明 enum——后者会让 instructor_lite 派生出"任意 string"，模型自由发挥时 ex_json_schema 才在 Gateway 入口拦下，绕一圈成 schema_mismatch。
- `Ecto.Enum` cast 完是 atom；Provider Gateway 出口必须先 stringify 再交给 `ex_json_schema` 校验或下游消费，否则会被判 schema_mismatch。详见 [`09-schema-codegen.md`](./09-schema-codegen.md) §4.5。

---

## 3. OTP supervision tree 概要

> **权威定义在 [`08-multi-agent.md`](./08-multi-agent.md) §2**。本节只给"应用启动时顶层 supervisor 树"，workspace / author / agent 子树不在此处展开（避免双源真相漂移）。

```text
AINovelStudio.Application
├── AINovelStudio.Repo (Ecto)
├── Phoenix.PubSub
├── AINovelStudio.Telemetry
├── AINovelStudio.Agent.Application
│   ├── Provider.Gateway.Supervisor              # Layer 1 §8
│   ├── Memory.Service.Supervisor                # Layer 1 §5
│   ├── Authority.Gate                           # Layer 1 §10
│   ├── Budget.Meter                             # Layer 1 §10
│   ├── Capability.Registry                      # Layer 1 §4（机制）
│   ├── Intent.Registry                          # Layer 1 §4（机制）
│   ├── Hook.Registry                            # Layer 1 §4（机制）
│   ├── Observability.Pipeline                   # Layer 1 §9
│   └── Workspace.DynamicSupervisor              # 多 workspace 根
│       └── (per workspace) → 见 08-multi-agent.md §2 完整子树
├── AINovelStudio.Application.Application
│   ├── ContextAssembler.Supervisor              # 小说上下文组装
│   ├── Projection.Refresher                     # 阅读投影刷新
│   └── Maintenance.Hooks                        # 小说维护钩子
├── AINovelStudioWeb.Endpoint (Phoenix)
```

---

## 4. Mix umbrella 项目结构

详见 [`12-development.md`](./12-development.md)。简版：

```
apps/
├── novel_foundation/   # Layer 0: Shared Kernel（Result/Error/ID/Clock/Telemetry）
├── novel_agent/        # Layer 1: Agent Runtime（Orchestrator/Router/Executor/Provider/Memory/Supervision）
├── novel_domain/       # Layer 2a: Novel Domain Models（纯领域对象与规则）
├── novel_application/  # Layer 2b: Application Services（小说创作用例编排）
├── novel_persistence/  # Database Layer（Ecto Repo/Schema/Migration）
└── novel_web/          # Phoenix API + Channels
```

---

## 5. 关键工程纪律

### 5.1 Process design

每个长期 alive 的实体必须是 GenServer / GenStateMachine / Agent，**不允许"裸 spawn process"**：

- 必须有明确的 `init/1` + `handle_call/3` + `handle_cast/2`
- 必须挂在 supervision tree 下
- 必须有 graceful shutdown 处理

### 5.2 Schema 来源唯一

**SSOT 是 `docs/design/schemas/*.json`**（ADR-0001 锁定路径）。

Ecto schema 由自定义 mix task 从 JSON Schema codegen 生成。**禁止手写 Ecto schema 又同时修改 JSON Schema**——会漂移。

详见 [`09-schema-codegen.md`](./09-schema-codegen.md)。

### 5.3 Persistence

- 所有数据库写入走 `Ecto.Multi`（保证事务）
- Adoption boundary 是唯一 `production_write` 通道
- Tentative artifact 与 accepted production 物理隔离（不同表）
- 详见 [`06-database.md`](./06-database.md)

### 5.4 Authority + Budget

- 每个 capability invoke 必须穿过 `Authority.Gate.check/3`
- 每个 capability invoke 必须经过 `Budget.Meter.allocate/3` + `Budget.Meter.consume/3`
- 父 → 子 Agent 时 budget 必须收缩（不允许子拿到大于父的 budget）

### 5.5 Observability

- 所有 turn / capability invoke / artifact mutation 必须 emit OTel span
- 详见 [`10-observability.md`](./10-observability.md)

### 5.6 错误处理哲学

- "Let it crash"：unexpected error 不要 catch，让 supervisor 重启
- 业务级错误（用户输入错误、quota 超限）走 `{:error, reason}` tuple
- 不要混用 raise 与 error tuple

### 5.7 测试

- 单元测试：ExUnit + Mox（mock provider gateway）
- 契约测试：JSON Schema validate + Ecto changeset 测试
- 属性测试：StreamData（state machine 测试 + invariant 测试）
- 集成测试：单独 supervision tree 启动 + 真实 LLM stub provider

---

## 6. 依赖清单

`mix.exs` 顶层依赖（umbrella root）：

```elixir
defp deps do
  [
    # Core
    {:phoenix, "~> 1.8"},
    {:phoenix_pubsub, "~> 2.1"},
    {:phoenix_live_dashboard, "~> 0.8", only: :dev},
    {:plug_cowboy, "~> 2.7"},

    # Persistence
    {:ecto_sql, "~> 3.13"},
    {:ecto_sqlite3, "~> 0.22"},      # Stage 1
    {:postgrex, "~> 0.22"},          # Stage 2 (delayed via mix env)
    {:paper_trail, "~> 1.1"},

    # LLM
    {:langchain, "~> 0.8"},          # langchain_elixir, multi-agent / tool-call
    {:instructor_lite, "~> 1.2"},    # 结构化输出主依赖，2026-04 spike 实测后从 instructor_ex / hex instructor 0.1.0 升级
    {:req, "~> 0.5"},                # HTTP client

    # Multi-Agent / OTP
    {:gen_stage, "~> 1.3"},
    {:libcluster, "~> 3.4"},         # Stage 2 distributed
    {:horde, "~> 0.10"},             # process registry across nodes (optional)

    # Schema
    {:ex_json_schema, "~> 0.10"},    # JSON Schema runtime validate

    # Observability
    {:opentelemetry, "~> 1.7"},
    {:opentelemetry_exporter, "~> 1.10"},
    {:opentelemetry_phoenix, "~> 2.0"},
    {:opentelemetry_ecto, "~> 1.2"},
    {:telemetry_metrics, "~> 1.0"},
    {:telemetry_metrics_prometheus, "~> 1.1"},

    # Auth
    {:bcrypt_elixir, "~> 3.1"},
    {:joken, "~> 2.6"},              # JWT

    # Dev / Test
    {:dialyxir, "~> 1.4", only: [:dev, :test]},
    {:credo, "~> 1.7", only: [:dev, :test]},
    {:mox, "~> 1.1", only: :test},
    {:stream_data, "~> 0.6", only: :test},
    {:ex_machina, "~> 2.7", only: :test}
  ]
end
```

---

## 7. 与 v2 子系统的对应关系

| v2 子系统 | 实现位置 | 依赖 |
|---|---|---|
| §4.1 交互契约 | `novel_web/lib/novel_web/controllers/`、Phoenix Channels | phoenix |
| §4.2 状态机 | `novel_foundation/lib/foundation/state/` | gen_state_machine |
| §4.3 对话行为 | `novel_domain/lib/domain/conversation/` | - |
| §4.4 Capability/Intent | `novel_foundation/lib/foundation/registry/` | - |
| §4.5 记忆体系 | `novel_foundation/lib/foundation/memory/` | ecto + ets |
| §4.6 规划编排 | `novel_foundation/lib/foundation/orchestrator/` | gen_stage + task |
| §4.7 一致性 | `novel_persistence/lib/persistence/multi/` | ecto + paper_trail |
| §4.8 Provider | [`07-provider.md`](./07-provider.md) | langchain + instructor_lite |
| §4.9 观测性 | [`10-observability.md`](./10-observability.md) | opentelemetry |
| §4.10 安全/预算 | `novel_foundation/lib/foundation/{authority,budget}/` | - |
| §4.11 UX 语义 | `novel_web/lib/novel_web/views/turn_result/` | - |
| §4.12 多 Agent | [`08-multi-agent.md`](./08-multi-agent.md) | core OTP |

---

## 8. 当前 TBD

- 具体 Workspace.Supervisor 启动策略（rest_for_one vs one_for_one）
- ETS 表结构（hot tier 设计）
- Authority.Gate 的具体策略 DSL
- Budget.Meter 的多维度统一接口
- Distributed Erlang 节点发现策略（libcluster 配置）

以上 TBD 在对应子系统文档（[`07`](./07-provider.md) ~ [`10`](./10-observability.md)）中展开，或者作为 Phase 0 实施时立 ADR。
