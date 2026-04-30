# 工程操作系统蓝图

> 状态：试行蓝图
>
> 启动日期：2026-04-30
>
> 目标：把本项目的工程原则、任务组织、模块划分、复杂时序、性能关注和 AI 协作方式固化为可持续推进的事项，避免信息只留在对话中。

---

## 1. 背景

本项目是 Elixir/Phoenix Umbrella + Tauri/React 前端 + Agent Runtime 的小说创作系统。项目早期最重要的不是快速堆功能，也不是单纯求稳，而是建立可持续发展的承重结构。

本蓝图把以下诉求统一为一个工程操作系统：

- DRY、开闭原则、正交性、切面化能力
- 合理模块划分与长期可维护性
- 复杂时序调整与执行性能
- 符合前沿研究范式的业务逻辑建模
- 任务按承重竖切面组织，并按线性批次推进
- 大任务先建有向无环图（DAG），再按拓扑顺序施工
- 深模块架构：小接口、大内部能力、强不变量

---

## 2. 核心原则

### 2.1 DRY：只抽真实重复

本项目不把“看起来相似”视为 DRY 依据。

允许抽象的条件：

1. 至少两个当前 slice 已出现同类重复。
2. 重复背后有相同 contract 或 invariant。
3. 抽象后的接口更小，而不是更宽。
4. 抽象有真实 consumer，不是为未来预留。

禁止：

- 为单个调用点创建通用 service。
- 为未来 provider / repository / policy 预埋空接口。
- 为减少几行代码牺牲状态机和 contract 清晰度。

### 2.2 开闭原则：通过 catalog / policy / capability 扩展

本项目的开闭原则不是提前定义大而全接口，而是在稳定承重边界上扩展。

优先扩展点：

- intent registry
- capability catalog
- authority / budget policy
- card/action projection
- memory recall policy
- projection refresh trigger

禁止扩展点：

- Web 层直接判断业务策略
- Frontend 自行发明 `card_type` / `action_type`
- Agent 直接写 Domain authoritative state
- Persistence schema 反向决定 Domain 语义

### 2.3 正交性：核心能力互不侵入

以下能力必须保持正交：

| 能力 | 拥有者 | 不应侵入 |
|---|---|---|
| Authority / budget | `novel_agent` + `novel_application` 编排 | UI / Web 本地判断 |
| Memory | `novel_agent` hot tier + `novel_persistence` warm/cold tier | Domain 纯模型 |
| Adoption | `novel_application` boundary | Agent runtime 直接写权威状态 |
| Projection | Domain/Application 规则 | Frontend 缓存猜测 |
| Audit / replay | application/runtime 边界 | UI 文案或按钮 label |

正交性检查问题：

- 这个模块是否同时拥有两个不同变化原因？
- 这个字段是否被两个系统用作不同语义？
- 这个 action 是否同时表达 UI 交互和授权结果？

### 2.4 切面：跨切关注点必须有挂载点

切面能力包括：

- authority
- budget
- audit
- telemetry
- memory write-through
- projection invalidation
- quality gate

切面能力不能散落在 controller、component 或 provider 中。它们必须挂到以下位置之一：

- Application use case
- Agent runtime policy/gate
- TurnResult projection
- Domain pure rule
- Persistence repository/log boundary

### 2.5 深模块：小接口，大内部能力

深模块标准：

1. 对外接口少。
2. 内部隐藏复杂时序和状态推进。
3. 拥有明确不变量。
4. 有性能边界。
5. 有 contract test 或 invariant test。

候选深模块：

| 模块 | 深模块职责 |
|---|---|
| `NovelApplication.TurnService` | turn 主编排、TurnResult 出口校验、memory/adoption/projection 切面挂载 |
| `NovelApplication.AdoptionBoundary` | tentative artifact 到 authoritative state 的唯一边界 |
| `NovelAgent.Router` | intent / capability / policy 路由，不拥有 Domain 语义 |
| `NovelAgent.Memory.Store` | hot memory 顺序、分区、低延迟查询 |
| `NovelApplication.MemoryRecallService` | governed memory recall pipeline |
| Projection builder（待建） | accepted source 到 reading projection 的派生链路 |

---

## 3. 任务组织模型

### 3.1 大任务先变 DAG

任何超过一个 slice 的事项，必须先建 DAG。

DAG 节点必须是承重竖切面，不是横向技术层。

节点必须包含：

```yaml
id: VS-001
type: Turn Slice
depends_on: []
contracts: []
invariants: []
batch: 1
```

DAG 边表示“后一个 slice 依赖前一个 slice 的 contract / invariant / consumer 已经成立”。

### 3.2 执行按线性分批

DAG 用来表达依赖，执行时按拓扑排序分批推进。

批次规则：

1. 一个批次内的 slice 可以并行分析，但默认线性落地。
2. 同一批次不得修改同一深模块的同一责任面。
3. 后一批次不能绕过前一批次未完成的 contract。
4. 每批完成后更新 DAG 状态和 task 决策日志。

### 3.3 承重竖切面

承重竖切面的详细规则见 `docs/engineering/vertical-slice.md`。

本项目首选 slice 类型：

- Turn Slice
- Behavior Slice
- Artifact Slice
- Projection Slice
- Memory Slice
- UI Contract Slice

---

## 4. 建模业务逻辑的前沿范式

本项目的业务逻辑不应退化为 CRUD。优先使用以下建模方式：

| 业务复杂度 | 建模方式 | 项目落点 |
|---|---|---|
| 对话流程 | 状态机 / event trace | turn phase/status、behavior_state |
| 长任务 | explicit task lifecycle | long-run task |
| AI 产物可信化 | tentative artifact + adoption boundary | adoption_state |
| 派生阅读面 | materialized projection | reading_projection_* |
| 记忆召回 | retrieval pipeline + policy | MemoryRecallService |
| 权限与预算 | policy decision point | AuthorityGate / BudgetMeter |
| 多 Agent 协作 | capability routing + delegation trace | Router / Orchestrator |

建模纪律：

- 状态是运行语义，不是 UI 标签。
- 终态不可逆，恢复必须通过新事件或新实体表达。
- AI 输出默认是 proposed / tentative，不直接成为权威状态。
- 派生对象必须带 `source_revision_refs`。
- UI action 不是授权，执行端必须重新校验 policy。

---

## 5. 复杂时序与性能

### 5.1 时序原则

复杂时序必须显式表达，不通过隐式副作用串联。

优先表达方式：

- phase/status 状态机
- task lifecycle
- event / log
- projection stale marker
- adoption action
- memory write-through result

禁止：

- 通过 UI 是否显示某按钮推断后端状态。
- 通过 DB 字段是否为空推断流程阶段。
- 在 Web/Controller 中串联业务时序。

### 5.2 性能原则

同步 turn 路径必须短。

同步路径允许：

- intent/policy 判断
- lightweight memory write
- bounded memory recall
- TurnResult validation
- 小型 card/action projection

同步路径避免：

- 大型 projection rebuild
- 长文本全库扫描
- 未设 budget 的多 agent fan-out
- 阻塞式 provider 长任务

异步或长跑路径必须进入 long-run task / checkpoint 语义，不伪装成一次普通 turn。

### 5.3 性能预算入口

后续每个性能敏感 slice 必须写清：

- 同步路径最大步骤
- 数据量上界
- token / budget 上界
- 是否允许降级
- 是否需要 checkpoint

---

## 6. 阶段规划

### Phase 0：固化蓝图与试行入口

目标：把规则从对话固化到仓库。

完成标准：

- `docs/engineering/architecture-operating-system.md`
- `docs/engineering/vertical-slice.md`
- `tasks/slices/README.md`
- `tasks/slices/DAG.md`
- 工程事项 task 文件

### Phase 1：承重 slice 试行

目标：用 2-3 个 slice 验证规则是否有效。

建议顺序：

1. VS-001 TurnResult Contract Spine
2. VS-006 Turn Memory Write-Through
3. VS-002 Clarification Card Loop

完成标准：

- 每个 slice 都有 Contract / Invariant / Boundary / Consumer / Proof
- 每个 slice 完成后更新试行反馈
- 发现过重或缺失规则时回写本文档

### Phase 2：DAG 化任务系统

目标：所有大任务先建 DAG，再按线性批次推进。

完成标准：

- `tasks/slices/DAG.md` 成为当前 slice 依赖图入口
- 新增 slice 必须声明 `depends_on`
- 每个批次有明确完成标准
- 不再出现横向层任务单独施工

### Phase 3：深模块图谱

目标：定义项目长期承重模块，明确接口、不变量、性能边界和禁止依赖。

产物：

- `docs/engineering/deep-modules.md`
- 关键深模块卡片：
  - TurnService
  - AdoptionBoundary
  - MemoryRecallService
  - Router / Orchestrator
  - Projection builder

完成标准：

- 每个深模块都有公开接口和隐藏复杂度说明
- 每个深模块至少有一个 invariant test
- 新模块必须说明是否属于深模块、浅适配器或纯数据结构

### Phase 4：正交切面治理

目标：让 authority、budget、memory、audit、projection、quality gate 有统一挂载点。

产物：

- `docs/engineering/cross-cutting-concerns.md`
- 切面挂载矩阵

完成标准：

- Web / UI 不承担业务切面判断
- Application use case 明确切面调用顺序
- 性能敏感切面具备同步/异步边界

### Phase 5：适应度函数脚本化

目标：把稳定规则变成检查脚本，而不是一开始就重流程。

候选脚本：

- `scripts/check_slice_dag.exs`
- `scripts/check_contract_trace.exs`
- `scripts/check_module_boundaries.exs`
- `scripts/check_cross_cutting.exs`

触发条件：

- 同一类 review 问题重复出现 2 次以上。
- 某条规则已经稳定，不再频繁调整。
- 脚本能检查事实，而不是猜测意图。

### Phase 6：性能与时序压测

目标：对长任务、memory recall、projection rebuild、多 agent fan-out 做可观测性能治理。

产物：

- 性能预算表
- benchmark / smoke test
- checkpoint 策略
- 降级策略

完成标准：

- 同步 turn 路径有预算
- 长跑任务不会阻塞普通 turn
- projection rebuild 有 stale/rebuild/fresh 可观测状态

---

## 7. 当前推进入口

执行事项：

- `tasks/2026-04-30-engineering-operating-system.md`

当前 DAG：

- `tasks/slices/DAG.md`

试行 slice：

- `tasks/slices/VS-001-turn-result-contract-spine.md`
- `tasks/slices/VS-006-turn-memory-write-through.md`
- `tasks/slices/VS-002-clarification-card-loop.md`

接手者先读本文件，再读执行事项，最后按 DAG 选择下一个 slice。

