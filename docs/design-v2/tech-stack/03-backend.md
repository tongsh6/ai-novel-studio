# Backend 后端栈

> 状态：草案
>
> 目的：定义 Elixir 后端的完整栈、版本基线、关键纪律。本文不展开具体子系统的设计（那些在 [`07-provider.md`](./07-provider.md)、[`08-multi-agent.md`](./08-multi-agent.md) 等）。

---

## 1. 总览

```yaml
language:        Elixir 1.17+
runtime:         Erlang/OTP 27+
web:             Phoenix 1.7 (API only, no LiveView)
db_orm:          Ecto 3.x
db_alpha:        SQLite via ecto_sqlite3
db_beta:         PostgreSQL via postgrex / ecto_sql
migrations:      Ecto.Migration
revision_audit:  paper_trail (Hibernate Envers 等价)
event_bus:       Phoenix.PubSub + Distributed Erlang
long_run:        GenServer + GenStage + Task.Supervisor
schema_validate: Ecto.Changeset + Dialyxir
llm_client:      langchain_elixir + instructor_ex + 自封装 Provider Gateway
http_client:     Req
testing:         ExUnit + Mox + StreamData
observability:   opentelemetry-erlang + Phoenix.Telemetry
release:         Mix Release (单二进制)
```

---

## 2. 选型理由

### 2.1 Elixir 1.17+

| 优势 | 对应本项目硬骨 |
|---|---|
| OTP supervision tree | [`../00-overview.md`](../00-overview.md) §4.12 多 Agent 父子关系是基因 |
| Process isolation + linking + monitoring | §4.12 crash isolation + handoff agent_ref |
| GenServer + 异步消息 | §4.12 Agent 间消息协议 |
| Reduction-based scheduling | §4.10 Budget 计量天然 |
| Distributed Erlang | 阶段 2 跨节点免费 |
| Mix Release 单二进制 | 阶段 1 桌面应用部署轻 |
| Hot code swap | 阶段 2 多作者期 0 downtime 升级（可选）|

为什么 1.17+：

- Elixir 1.17（2024 Q2）引入 set-theoretic types 早期版本，schema 严格性会逐步改善
- Erlang/OTP 27 正式稳定，BEAM JIT 性能提升

### 2.2 Phoenix 1.7（API only）

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

`paper_trail` 是 Elixir 生态的版本历史插件，对应 v2 [`../30-contract-glossary.md`](../30-contract-glossary.md) §2.3 `source_revision_refs` 的硬约束：

- 每次写入自动创建 `versions` 表的 audit record
- 包含 `event` (insert/update/delete) + `item_changes` (jsonb 增量) + `originator_id`
- 提供 `PaperTrail.get_versions/1` 查询历史

替代方案：

- 自实现 audit log（增加复杂度）
- Ecto.Changeset.prepare_changes 钩子（要重复造轮子）

### 2.5 langchain_elixir + instructor_ex

`langchain_elixir` 是 Elixir 的 LangChain 等价物，覆盖：

- ChatModel / Message 抽象
- Function calling
- Streaming
- 主流 provider 适配（OpenAI / Anthropic / Azure / Bedrock / Ollama）

`instructor_ex` 是 Instructor 的 Elixir port，提供：

- Pydantic-style 结构化输出（JSON Schema → Ecto schema）
- 自动 retry + validation
- 本项目 ADR-0001 字段抽取的天然工具

详见 [`07-provider.md`](./07-provider.md)。

---

## 3. OTP supervision tree 概要

> **权威定义在 [`08-multi-agent.md`](./08-multi-agent.md) §2**。本节只给"应用启动时顶层 supervisor 树"，workspace / author / agent 子树不在此处展开（避免双源真相漂移）。

```text
AINovelStudio.Application
├── AINovelStudio.Repo (Ecto)
├── Phoenix.PubSub
├── AINovelStudio.Telemetry
├── AINovelStudio.Foundation.Application
│   ├── Provider.Gateway.Supervisor              # 07
│   ├── Memory.Service.Supervisor                # Foundation §5
│   ├── Authority.Gate                           # Foundation §10
│   ├── Budget.Meter                             # Foundation §10
│   ├── Capability.Registry                      # Foundation §4
│   ├── Hook.Registry                            # Foundation §4 / Domain §25
│   └── Observability.Pipeline                   # 10
├── AINovelStudio.Domain.Application
│   ├── Intent.Registry                          # Domain §24
│   ├── ContextAssembler.Supervisor              # Domain §26
│   ├── Projection.Refresher                     # Domain §27 / ADR-0011
│   └── Maintenance.Hooks                        # Domain §25
├── AINovelStudioWeb.Endpoint (Phoenix)
└── Workspace.DynamicSupervisor                  # 多 workspace 根
    └── (per workspace) → 见 08-multi-agent.md §2 完整子树
```

---

## 4. Mix umbrella 项目结构

详见 [`12-development.md`](./12-development.md)。简版：

```
apps/
├── novel_foundation/   # Layer 1: 业务无关 Agent 基础
├── novel_domain/       # Layer 2: 小说业务
├── novel_web/          # Phoenix API + Channels
└── novel_persistence/  # Ecto schemas + migrations
```

---

## 5. 关键工程纪律

### 5.1 Process design

每个长期 alive 的实体必须是 GenServer / GenStateMachine / Agent，**不允许"裸 spawn process"**：

- 必须有明确的 `init/1` + `handle_call/3` + `handle_cast/2`
- 必须挂在 supervision tree 下
- 必须有 graceful shutdown 处理

### 5.2 Schema 来源唯一

**SSOT 是 `docs/design-v2/schemas/*.json`**（ADR-0001 锁定路径）。

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
    {:phoenix, "~> 1.7"},
    {:phoenix_pubsub, "~> 2.1"},
    {:phoenix_live_dashboard, "~> 0.8", only: :dev},
    {:plug_cowboy, "~> 2.7"},

    # Persistence
    {:ecto_sql, "~> 3.11"},
    {:ecto_sqlite3, "~> 0.16"},      # Stage 1
    {:postgrex, "~> 0.18"},          # Stage 2 (delayed via mix env)
    {:paper_trail, "~> 1.1"},

    # LLM
    {:langchain, "~> 0.3"},          # langchain_elixir
    {:instructor, "~> 0.1"},         # instructor_ex
    {:req, "~> 0.5"},                # HTTP client

    # Multi-Agent / OTP
    {:gen_stage, "~> 1.2"},
    {:libcluster, "~> 3.4"},         # Stage 2 distributed
    {:swarm, "~> 3.4"},              # process registry across nodes (optional)

    # Schema
    {:ex_json_schema, "~> 0.10"},    # JSON Schema runtime validate

    # Observability
    {:opentelemetry, "~> 1.5"},
    {:opentelemetry_exporter, "~> 1.7"},
    {:opentelemetry_phoenix, "~> 1.2"},
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
| §4.8 Provider | [`07-provider.md`](./07-provider.md) | langchain + instructor |
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
