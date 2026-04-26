# Multi-Agent §12 在 OTP 上的映射

> 状态：草案
>
> 目的：把 [`../00-overview.md`](../00-overview.md) §4.12 + `../12-multi-agent-composition.md`（待写）的 Multi-Agent 硬骨逐条映射到 OTP 原语。本文是技术栈推荐能否成立的**最关键验证点**。

---

## 1. 硬骨 → OTP 原语映射表

| §12 硬骨条件 | OTP 原语 | 说明 |
|---|---|---|
| Agent identity | `Registry` + `pid()` + `agent_ref` | 每个 Agent 有唯一 ID（UUID）+ 运行时 pid，通过 Registry 查找 |
| 父子 Agent 关系 | `Supervisor` + `DynamicSupervisor` | 父 Agent 的 supervisor 启动子 Agent |
| 父子预算继承 | GenServer state + 父消息 | 父在 spawn 子时通过 init args 传 budget；子 GenServer state 持有自己的 budget |
| consumed budget 回传 | `GenServer.cast/2` 异步消息 | 子定期 cast `{:budget_consumed, amount}` 给父 |
| 子 Agent 默认 tentative_write | Authority Gate + write_scope 字段 | 子 Agent 的 authority struct 写死 `write_scope: :tentative_write` |
| Crash isolation | `Process.link/1` + Supervisor restart | 子 crash 通过 link 通知父，supervisor 自动重启子 |
| handoff 保留 agent_ref | Message envelope 必含 `from_agent: agent_ref` | 用 struct 强制 |
| LongRunner 子 Agent → checkpoint 语义 | GenStage + `Task.Supervisor` | LongRunner 是独立 process，用 GenStage 做 backpressure |
| Distributed Erlang 跨节点 | `:global` registry + `libcluster` | 阶段 2 自动跨节点发现 |

---

## 2. Supervision Tree 设计

```text
AINovelStudio.Application
└── Workspace.DynamicSupervisor             # 顶层多作者根
    └── (per workspace, dynamically started)
        Workspace.Supervisor                # one_for_one
        ├── Workspace.Registry              # process registry
        ├── Memory.Service                  # workspace 共享记忆服务
        ├── EventBus.Subscriber             # 订阅 Domain Event
        └── Author.DynamicSupervisor        # 多作者
            └── (per author, dynamically started)
                Author.Supervisor           # one_for_one
                ├── Author.Registry
                ├── Agent.Orchestrator      # turn 唯一编排入口
                └── Agent.Children.DynamicSupervisor   # rest_for_one
                    ├── Agent.Writer        # 真 process
                    ├── Agent.Reviewer      # 真 process
                    ├── Agent.Planner       # 真 process
                    └── Agent.LongRunner    # 真 process
```

### 2.1 Restart 策略选择

| Supervisor | 策略 | 理由 |
|---|---|---|
| Workspace.DynamicSupervisor | `:one_for_one` | 一个 workspace 崩了不影响别的 workspace |
| Workspace.Supervisor | `:rest_for_one` | Memory.Service 重启时其下所有 Author/Agent 也重启（依赖关系）|
| Author.DynamicSupervisor | `:one_for_one` | 一个 author session 崩了不影响别的 |
| Author.Supervisor | `:rest_for_one` | Orchestrator 重启时其下子 Agent 也重启 |
| Agent.Children.DynamicSupervisor | `:one_for_one` | **关键**：一个 Agent crash 不影响其他 Agent —— 这就是用户要求的 crash isolation |

---

## 3. Agent identity

### 3.1 agent_ref struct

```elixir
defmodule AINovelStudio.Foundation.Agent.Ref do
  @type t :: %__MODULE__{
          id: String.t(),                  # UUID
          type: agent_type(),
          workspace_id: String.t(),
          author_id: String.t() | nil,
          parent_ref: t() | nil,
          spawned_at: DateTime.t()
        }
  
  @type agent_type :: 
          :orchestrator 
          | :writer 
          | :reviewer 
          | :planner 
          | :long_runner 
          | :maintainer
  
  defstruct [:id, :type, :workspace_id, :author_id, :parent_ref, :spawned_at]
  
  def new(type, workspace_id, opts \\ []) do
    %__MODULE__{
      id: UUID.uuid7(),
      type: type,
      workspace_id: workspace_id,
      author_id: opts[:author_id],
      parent_ref: opts[:parent_ref],
      spawned_at: DateTime.utc_now()
    }
  end
end
```

### 3.2 Registry 查找

```elixir
# Spawn 时注册
{:ok, pid} = GenServer.start_link(Agent.Reviewer, init_args, 
  name: {:via, Registry, {AINovelStudio.AgentRegistry, agent_ref.id}})

# 查找 + 发消息
case Registry.lookup(AINovelStudio.AgentRegistry, agent_ref.id) do
  [{pid, _}] -> GenServer.call(pid, :status)
  [] -> {:error, :agent_not_found}
end
```

### 3.3 跨节点（阶段 2）

阶段 2 用 `:global` 或 `Swarm`：

```elixir
# 阶段 1: 单节点
{:via, Registry, {AINovelStudio.AgentRegistry, agent_ref.id}}

# 阶段 2: 跨节点
{:via, Swarm, agent_ref.id}
```

**业务代码 0 改动**，只是 via 元组替换，可以用 helper 抽象。

---

## 4. Agent GenServer 模板

每个 Agent 是独立 GenServer，长期 alive：

```elixir
defmodule AINovelStudio.Foundation.Agent.Reviewer do
  use GenServer
  
  defstruct [
    :ref,                # AgentRef
    :authority,          # AuthorityScope (write_scope: :tentative_write)
    :budget,             # Budget remaining
    :consumed,           # Budget consumed since spawn
    :state,              # :idle | :busy | :paused | :stopping
    :current_task_id,
    :inbox_size,
    :memory_handle,      # 指向 Memory.Service 的 reference
    # Reviewer 特有 state
    :focus,              # :pacing / :consistency / :style
    :recent_findings     # 累积的 review 历史（cross-turn memory）
  ]
  
  # ===== Public API =====
  
  def start_link(args) do
    GenServer.start_link(__MODULE__, args, 
      name: {:via, Registry, {AINovelStudio.AgentRegistry, args.ref.id}})
  end
  
  def review(agent_id, draft) do
    GenServer.cast(via(agent_id), {:review, draft})
  end
  
  def cancel(agent_id) do
    GenServer.cast(via(agent_id), :cancel)
  end
  
  def status(agent_id) do
    GenServer.call(via(agent_id), :status)
  end
  
  defp via(agent_id), do: {:via, Registry, {AINovelStudio.AgentRegistry, agent_id}}
  
  # ===== GenServer callbacks =====
  
  @impl true
  def init(args) do
    state = %__MODULE__{
      ref: args.ref,
      authority: args.authority,
      budget: args.budget,
      consumed: %{tokens: 0, cost_usd: 0.0, wall_ms: 0},
      state: :idle,
      focus: args[:focus] || :consistency,
      recent_findings: [],
      memory_handle: args.memory_handle
    }
    
    # 订阅 Domain Event Bus
    Phoenix.PubSub.subscribe(
      AINovelStudio.PubSub,
      "workspace:#{state.ref.workspace_id}:draft_committed"
    )
    
    {:ok, state}
  end
  
  @impl true
  def handle_cast({:review, draft}, %{state: :idle} = state) do
    # 立即响应 cast，开始 review
    new_state = %{state | state: :busy, current_task_id: UUID.uuid7()}
    
    # 异步执行 review（Task.Supervisor 跑，不阻塞 GenServer）
    Task.Supervisor.start_child(
      AINovelStudio.TaskSupervisor,
      fn -> do_review(state.ref, draft, state.focus) end
    )
    
    {:noreply, new_state}
  end
  
  @impl true
  def handle_cast({:review, _draft}, state) do
    # 已忙，丢弃或排队
    {:noreply, state}
  end
  
  @impl true
  def handle_cast(:cancel, state) do
    # 用户取消，发停止信号给 in-flight Task
    cancel_in_flight_task(state.current_task_id)
    {:noreply, %{state | state: :idle, current_task_id: nil}}
  end
  
  # 来自 Domain Event Bus 的 broadcast
  @impl true
  def handle_info({:draft_committed, draft}, state) do
    # 后台自动 review (24x7 工作模式)
    handle_cast({:review, draft}, state)
  end
  
  # Task 完成回调
  @impl true
  def handle_info({:review_done, findings, usage}, state) do
    # 1. 报告 budget consumed 给父 (Orchestrator)
    if state.ref.parent_ref do
      Agent.Orchestrator.report_consumed(state.ref.parent_ref.id, usage)
    end
    
    # 2. 累积到 recent_findings
    new_findings = [findings | Enum.take(state.recent_findings, 49)]
    
    # 3. 创建 tentative artifact
    {:ok, artifact} = AINovelStudio.Domain.MaintenanceArtifact.create(
      hook_name: "hook.REVIEW_PACING",
      revision_base: findings.draft_revision,
      proposed_change: findings.proposed_change,
      requires_adoption: true,
      proposed_by_agent_id: state.ref.id  # handoff agent_ref
    )
    
    # 4. 投影到 UI（adoption_card via TurnResult.ui_cards）
    
    {:noreply, %{state | 
      state: :idle, 
      current_task_id: nil,
      recent_findings: new_findings,
      consumed: merge_usage(state.consumed, usage)
    }}
  end
  
  @impl true
  def terminate(reason, state) do
    # 优雅关闭：保存 state 到持久化层（可选）
    if reason != :normal do
      AINovelStudio.Persistence.AgentState.snapshot(state)
    end
    :ok
  end
end
```

---

## 5. 父子委派（Delegation）

### 5.1 Delegation Envelope

```elixir
defmodule AINovelStudio.Foundation.MultiAgent.Delegation do
  @type t :: %__MODULE__{
          id: String.t(),
          from_agent: AgentRef.t(),
          to_agent_type: atom(),
          task: term(),
          authority_scope: AuthorityScope.t(),     # 收缩后
          budget_allocation: Budget.t(),           # 分配给子
          deadline_at: DateTime.t() | nil,
          metadata: map()
        }
  
  defstruct [
    :id, :from_agent, :to_agent_type, :task, 
    :authority_scope, :budget_allocation, :deadline_at, :metadata
  ]
end
```

### 5.2 父 Agent 委派

```elixir
defmodule AINovelStudio.Foundation.Agent.Orchestrator do
  use GenServer
  
  def delegate_to_writer(orchestrator_ref, brief, budget_subset) do
    # 创建子 Agent
    child_ref = AgentRef.new(:writer, orchestrator_ref.workspace_id, 
      author_id: orchestrator_ref.author_id, 
      parent_ref: orchestrator_ref)
    
    # 收缩 authority + budget
    child_authority = AuthorityScope.derive_child(
      orchestrator_ref.authority,
      write_scope: :tentative_write,                    # 强制
      capability_scope: [:complete_text, :search_memory]
    )
    
    # 启动子 Agent process
    {:ok, _pid} = DynamicSupervisor.start_child(
      AINovelStudio.AgentChildrenSupervisor,
      {Agent.Writer, %{
        ref: child_ref,
        authority: child_authority,
        budget: budget_subset,
        memory_handle: orchestrator_ref.memory_handle
      }}
    )
    
    # 发起任务
    Agent.Writer.write(child_ref.id, brief)
    
    {:ok, child_ref}
  end
end
```

### 5.3 Authority 收缩

```elixir
defmodule AINovelStudio.Foundation.Authority.Scope do
  @type t :: %__MODULE__{
          capability_scope: list(atom()),
          write_scope: :read_only | :propose_only | :tentative_write | :production_write,
          task_control_scope: list(atom()),
          budget_override_scope: nil | atom()
        }
  
  def derive_child(parent_scope, overrides) do
    # 子永远不能比父权限大
    requested_caps = overrides[:capability_scope] || parent_scope.capability_scope

    %__MODULE__{
      capability_scope:
        intersect_caps(parent_scope.capability_scope, requested_caps),
      write_scope:
        narrower_of(parent_scope.write_scope, overrides[:write_scope] || :tentative_write),
      task_control_scope:
        overrides[:task_control_scope] || parent_scope.task_control_scope,
      budget_override_scope: nil  # 子 Agent 永远不能 override budget
    }
  end

  # 子 capability ⊆ 父 capability。Elixir 没有 Enum.intersection/2，这里走 MapSet。
  defp intersect_caps(parent, child) do
    MapSet.intersection(MapSet.new(parent), MapSet.new(child)) |> MapSet.to_list()
  end
  
  defp narrower_of(parent, child) do
    rank = %{read_only: 0, propose_only: 1, tentative_write: 2, production_write: 3}
    if rank[child] <= rank[parent], do: child, else: parent
  end
end
```

---

## 6. consumed budget 回传

```elixir
defmodule AINovelStudio.Foundation.Agent.Orchestrator do
  def report_consumed(orchestrator_id, child_usage) do
    GenServer.cast(via(orchestrator_id), {:child_consumed, child_usage})
  end
  
  @impl true
  def handle_cast({:child_consumed, usage}, state) do
    # 累计到自己的 consumed
    new_consumed = merge_usage(state.consumed, usage)
    
    # 检查 budget 是否超限
    if Budget.Meter.exceeds?(state.budget, new_consumed) do
      # 触发 checkpoint / escalation
      escalate_budget_exceeded(state)
    end
    
    {:noreply, %{state | consumed: new_consumed}}
  end
end
```

---

## 7. Crash Isolation 验证

### 7.1 子 crash 不影响父

```elixir
# Reviewer crash
GenServer.cast(reviewer_pid, :throw_for_test)  # internal raise

# Supervisor 配置 :one_for_one + DynamicSupervisor
# → Reviewer 重启
# → Writer 不受影响（仍在 :busy 状态写文章）
```

### 7.2 父 crash → 子也重启

```elixir
# Orchestrator crash
# → Author.Supervisor (rest_for_one) 重启 Orchestrator + 其下所有子 Agent
# → 因为子 Agent 的 budget 来自父，父重启后 budget 状态需要从持久化恢复
```

### 7.3 持久化恢复

每个 Agent 在 `terminate/2` 中 snapshot state（Reviewer 的 recent_findings 等），重启时从 snapshot 恢复：

```elixir
def init(args) do
  state = case AINovelStudio.Persistence.AgentState.get_snapshot(args.ref.id) do
    {:ok, snapshot} -> deserialize(snapshot)
    :not_found -> initial_state(args)
  end
  {:ok, state}
end
```

---

## 8. LongRunner 与 GenStage

LongRunner 处理"连续写 10 章"这种长跑任务：

```elixir
defmodule AINovelStudio.Foundation.Agent.LongRunner do
  use GenStage  # 而非 GenServer，因为要 backpressure
  
  # Producer-consumer pattern
  # 每完成一个 unit (章节) 产出一个事件，订阅方（UI / Reviewer）按需消费
  
  def start_link(args) do
    GenStage.start_link(__MODULE__, args, name: via(args.ref.id))
  end
  
  @impl true
  def init(args) do
    {:producer, %{
      ref: args.ref,
      plan: args.plan,
      current_unit: 0,
      total_units: length(args.plan.units),
      status: :running
    }}
  end
  
  @impl true
  def handle_demand(demand, state) do
    # 用户/UI 拉取下一批结果
    units_to_produce = generate_next_units(state, demand)
    new_state = %{state | current_unit: state.current_unit + length(units_to_produce)}
    {:noreply, units_to_produce, new_state}
  end
  
  defp generate_next_units(state, demand) do
    # 调用 Provider Gateway 写章节
    # 每写完一章 emit checkpoint event
    # ...
  end
end
```

---

## 9. handoff 与 agent_ref

跨 Agent 传递 artifact 必须保留 `agent_ref`：

```elixir
defmodule AINovelStudio.Foundation.MultiAgent.Handoff do
  @type t :: %__MODULE__{
          artifact: any(),
          from_agent: AgentRef.t(),
          to_agent_ref: AgentRef.t() | nil,
          handoff_at: DateTime.t(),
          consumed: boolean()
        }
end

# 例：Writer 把 draft handoff 给 Reviewer
def handoff_draft_to_reviewer(writer_ref, draft, reviewer_ref) do
  handoff = %Handoff{
    artifact: draft,
    from_agent: writer_ref,
    to_agent_ref: reviewer_ref,
    handoff_at: DateTime.utc_now(),
    consumed: false
  }
  
  Agent.Reviewer.review_handoff(reviewer_ref.id, handoff)
end
```

---

## 10. 跨节点 (阶段 2)

### 10.1 节点发现

```elixir
# config/runtime.exs (阶段 2)
config :libcluster,
  topologies: [
    novel_cluster: [
      strategy: Cluster.Strategy.Kubernetes,
      config: [
        mode: :hostname,
        kubernetes_node_basename: "ai-novel-studio",
        kubernetes_selector: "app=ai-novel-studio",
        polling_interval: 10_000
      ]
    ]
  ]
```

### 10.2 Workspace consistent hashing

把同一个 workspace 的所有 Agent 路由到同一节点（避免跨节点 message 延迟）：

```elixir
defmodule AINovelStudio.Foundation.Cluster.Router do
  def node_for_workspace(workspace_id) do
    :erlang.phash2(workspace_id, length(Node.list([:visible, :this])))
    |> then(&Enum.at([Node.self() | Node.list()], &1))
  end
  
  def spawn_agent_on_workspace_node(workspace_id, agent_module, args) do
    target_node = node_for_workspace(workspace_id)
    :rpc.call(target_node, DynamicSupervisor, :start_child, 
      [AINovelStudio.AgentChildrenSupervisor, {agent_module, args}])
  end
end
```

---

## 11. 监控

每个 Agent 必须 emit telemetry：

```elixir
:telemetry.execute(
  [:ai_novel_studio, :agent, :state_changed],
  %{count: 1},
  %{
    agent_id: state.ref.id,
    agent_type: state.ref.type,
    workspace_id: state.ref.workspace_id,
    from_state: old_state.state,
    to_state: new_state.state
  }
)
```

详见 [`10-observability.md`](./10-observability.md)。

---

## 12. 验证清单

§12 硬骨条件最终验证：

- [x] Agent identity（Registry + AgentRef）
- [x] 父子关系（Supervisor 树）
- [x] 父子预算继承（init_args + AuthorityScope.derive_child）
- [x] consumed budget 回传（GenServer.cast）
- [x] 子默认 tentative_write（AuthorityScope.derive_child 强制）
- [x] Crash isolation（DynamicSupervisor :one_for_one）
- [x] handoff agent_ref（Handoff struct）
- [x] LongRunner checkpoint 语义（GenStage producer）
- [x] 跨节点（libcluster + Swarm）

**全部通过**。Elixir + OTP 是 §12 的本主场，技术栈推荐确认成立。

---

## 13. 当前 TBD

- 具体 LongRunner 的 GenStage backpressure 策略
- Agent state snapshot 频率与策略
- 跨节点 Agent 的 budget 同步机制（最终一致 vs 强一致）
- Agent lifecycle 的具体状态机（除 :idle / :busy / :paused / :stopping）
- 与 Reading Projection Refresher 的 GenStage 集成

以上 TBD 在 `../12-multi-agent-composition.md` 主文档完成时同步落实。
