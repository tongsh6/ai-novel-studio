# v3 愿景与工程路线

> 状态：草案（2026-05-02）
>
> 角色：v3 设计文档体系的入口文档。本文定义 v3 为什么存在、如何从 idea 推进到正式工程、每个阶段产出什么、何时允许进入实现，以及如何保持长期可持续迭代。
>
> 关联文档：
> - `01-user-llm-workbench-interaction-model.md` — v3 用户-LLM-工作台交互模型

---

## 1. v3 为什么存在

v3 不是 v2 的局部补丁，也不是“把 Router 追问写得更自然”的实现任务。

v3 的出发点是一个结构性判断：

```text
用户应该通过 LLM 进行创作；
LLM 应该是作者可感知的创作伙伴；
工作台应该是 LLM 和执行系统背后的装备库、技能库、武器库；
Router-first 不应继续作为目标交互拓扑。
```

v2 的价值在于验证了很多底层工程骨架：

- TurnResult 合同出口
- clarification / confirmation / adoption 基础链路
- slot schema 与 intent registry
- provider gateway
- memory / trace 初步能力
- 承重垂直切面（Vertical Slice）执行纪律

但 v2 的默认交互心智仍然偏 `Router-first`：

```text
User → Router → TurnService / Orchestrator → Executor / LLM
```

这个拓扑让工作台站到了作者和 LLM 之间。v3 要重新把 LLM 放回作者体验前台，把工作台移到后台工具箱位置。

---

## 2. v3 总愿景

v3 的目标不是“更会聊天”，而是建立一个可以长期演化的小说创作 Agent 工作台。

核心愿景：

| 维度 | v3 目标 |
|---|---|
| 体验 | 作者面对 LLM 创作伙伴，而不是 slot 表单 |
| 架构 | Dialogue-first / Agent-native，不再 Router-first |
| 契约 | Contract-first，不把系统约束藏进 prompt |
| 执行 | Planner 提建议，Execution Orchestrator 掌握执行权 |
| 工具 | Workbench 是工具箱，不是用户前台流程 |
| 产物 | 写入默认 tentative，经 adoption / confirmation / policy 放行 |
| 审计 | DialogueFrame / MicroPlan / ToolResult / DecisionTrace 可回放 |
| 迭代 | 先设计体系，再 ADR，再承重垂直切面，再实现 |

一句话版本：

```text
v3 要做的是一个可审计、可规划、可持续迭代的 LLM 创作伙伴系统，而不是一个会调用 LLM 的表单工作台。
```

---

## 3. v3 的工程推进阶段

v3 按 6 个阶段推进。每个阶段都有明确产物，不能跳过。

### 3.1 Stage 0：Idea / Exploration

目标：收集问题、隐喻、候选模型、关键分歧。

允许产物：

- 问题备忘录
- 交互隐喻
- 候选方案分析
- 开放问题列表
- 失败模型分析

禁止产物：

- 直接写代码
- 直接冻结 ADR
- 直接切 implementation plan

当前已完成的探索输入：

- v2 `03a-user-llm-workbench-interaction-model.md`
- v3 `01-user-llm-workbench-interaction-model.md`
- “工作台是工具箱，LLM 是创作伙伴”的核心隐喻

### 3.2 Stage 1：Direction / Architecture

目标：确定 v3 的方向、主链、边界、反模式。

必须产物：

- v3 愿景与工程路线
- v3 阅读地图
- v3 端到端主链
- v3 运行时架构图
- v3 反模式清单

阶段完成标准：

- 新人能在 10 分钟内讲清 v3 和 v2 的根本差异。
- 工程师能判断一个新想法属于哪个 v3 子系统。
- 维护者能知道哪些内容只是草案，哪些内容准备进入 ADR。

### 3.3 Stage 2：Contract / ADR

目标：把稳定决策冻结成机器可测试、可引用、可追踪的 contract。

候选 ADR：

| ADR | 主题 |
|---|---|
| DialogueFrame | 每 turn 必有的结构化认知帧 |
| MicroPlan | Planner 到 Execution Orchestrator 的行动建议协议 |
| Capability Toolbox | 工具 / capability registry 与调用边界 |
| Execution Orchestrator | 执行权、状态机、门禁、TurnResult 出口 |
| Behavior Model | clarification / confirmation / correction / cancellation 的 v3 表达 |
| Trace / Replay | DecisionTrace、ToolResult、回放要求 |
| Workbench UI Contract | UI 如何消费 TurnResult、cards、actions、trace summary |

阶段完成标准：

- 每个核心对象有字段、状态、生命周期和消费者。
- 每条冻结决策有 ADR 编号、状态和替代方案。
- 后续实现不能靠口头约定解释 contract。

### 3.4 Stage 3：Slice Planning

目标：把 v3 切成承重垂直切面 DAG。

每条 slice 必须回答：

| 问题 | 含义 |
|---|---|
| Contract | 固化或消费哪个契约、schema、ADR、状态字段 |
| Invariant | 保护哪个系统不变量 |
| Boundary | 切穿哪些真实 app 边界，哪些 app 明确不改 |
| Consumer | 第一个真实消费者是谁 |
| Proof | 用什么测试或命令证明链路成立 |

禁止切法：

- 只建表
- 只写 API
- 只搭 UI 壳
- 只加 provider / repository / service 抽象
- 只做 happy path，没有状态、契约、不变量测试

### 3.5 Stage 4：Implementation

目标：按 slice 实现、验证、扫描、复盘。

实现前置条件：

- 对应设计文档存在。
- 相关 ADR 或草案 contract 足够清晰。
- slice 文档已写明 Contract / Invariant / Boundary / Consumer / Proof。
- 任务不再依赖“实现时再想清楚”的关键架构问题。

完成标准：

- 代码实现完成。
- 测试通过。
- 架构边界检查通过。
- AI 静态扫描闭环完成。
- slice 文档记录决策、验证、剩余风险。

### 3.6 Stage 5：Iteration

目标：基于真实使用和实现反馈持续修正。

允许动作：

- 草案文档修订。
- 新增 ADR。
- Supersede 旧 ADR。
- 重排 slice DAG。
- 将探索结论降级为备忘录或升级为 contract。

禁止动作：

- 为了赶实现绕过 ADR。
- 用局部代码事实反向污染顶层愿景。
- 将临时 prompt 行为当成系统 contract。

---

## 4. v3 文档体系

v3 文档不继承 v2 编号。v3 使用独立目录：

```text
docs/design-v3/
```

建议骨架：

```text
docs/design-v3/
  00-vision-and-engineering-roadmap.md
  00a-reading-map.md
  00b-end-to-end-dialogue-flow.md
  00c-state-and-contract-atlas.md
  00d-runtime-architecture.md
  01-user-llm-workbench-interaction-model.md
  02-dialogue-frame-and-micro-plan.md
  03-capability-toolbox-contract.md
  04-execution-orchestrator.md
  05-turn-behavior-and-state-model.md
  06-memory-context-and-trace.md
  07-workbench-ui-contract.md
  adr/
```

各文档职责：

| 文档 | 角色 |
|---|---|
| `00` | v3 为什么存在、怎么推进、如何从设计进入实现 |
| `00a` | 按角色阅读路径 |
| `00b` | v3 主链：用户输入如何变成 DialogueFrame / MicroPlan / TurnResult |
| `00c` | 状态机、contract、ADR 的索引图 |
| `00d` | 运行时架构图：控制面、数据面、横切层 |
| `01` | 用户、LLM、工作台三者交互模型 |
| `02` | DialogueFrame / MicroPlan 协议 |
| `03` | Capability Toolbox 与工具注册 |
| `04` | Execution Orchestrator 执行权边界 |
| `05` | clarification / confirmation / correction / cancellation |
| `06` | memory、context assembly、trace、replay |
| `07` | Workbench UI 如何消费 v3 输出 |
| `adr/` | 冻结的 v3 决策 |

---

## 5. v3 与 v2 的关系

v3 从 v2 分支签出，但不继承 v2 的目标拓扑。

### 5.1 v2 可复用资产

| v2 资产 | v3 处理 |
|---|---|
| TurnResult 合同思路 | 保留“唯一 canonical 出口”的原则，字段可重新评估 |
| 状态机纪律 | 保留终态、等待态、门禁态的设计方式 |
| ADR-0008 / ADR-0010 | 作为 intent / slot 早期素材，不作为 v3 最终冻结约束 |
| Provider Gateway | 保留 provider 抽象方向 |
| Adoption Boundary | 保留 tentative-first 与生产写入门禁方向 |
| Memory / Trace | 升级为 v3 主链一等对象 |
| 承重垂直切面方法 | 完整保留 |

### 5.2 v2 不继承约束

| v2 内容 | v3 处理 |
|---|---|
| Router-first turn 拓扑 | 废弃为目标架构 |
| `Router` 顶层概念 | 拆解为后台工具，不再作为 turn 第一站 |
| TurnService 巨型编排心智 | 后续拆分为 Dialogue Planner / Execution Orchestrator / Toolbox |
| slot 缺失直接机械 clarification | 改为 DialogueFrame + MicroPlan + durable behavior 分层 |
| UI 面对表单式补槽 | 改为作者面对自然创作引导 |

---

## 6. 从设计进入实现的门槛

v3 不允许“有一个想法就直接写代码”。

进入实现前必须满足：

1. 该方向至少有一份 design-v3 文档说明背景、目标、边界。
2. 若涉及核心 contract，必须有 ADR 草案或 Accepted ADR。
3. 若涉及状态字段、schema、行为对象，必须说明生命周期和消费者。
4. 若涉及代码，必须切成承重垂直切面。
5. 每条 slice 必须回答 Contract / Invariant / Boundary / Consumer / Proof。
6. 不允许只因“当前实现方便”而违背 v3 顶层愿景。

实现计划的触发顺序：

```text
设计文档
→ ADR / schema 草案
→ slice DAG 节点
→ slice 设计
→ implementation plan
→ 代码实现
→ 验证 / 静态扫描
→ slice 复盘
```

---

## 7. v3 首批设计里程碑

当前阶段已经形成 Stage 1：Direction / Architecture 的主文档链路，下一步准备进入 Stage 2：Contract / ADR。

建议首批里程碑：

| 顺序 | 产物 | 目标 |
|---|---|---|
| 1 | `00-vision-and-engineering-roadmap.md` | 确立 v3 工程推进方式 |
| 2 | `00a-reading-map.md` | 给不同角色入口 |
| 3 | `00b-end-to-end-dialogue-flow.md` | 画清 v3 主链 |
| 4 | `00d-runtime-architecture.md` | 画清控制面 / 数据面 / 横切 |
| 5 | `02-dialogue-frame-and-micro-plan.md` | 把核心协议从 `01` 拆成 contract 草案 |
| 6 | `03-capability-toolbox-contract.md` | 定义工具箱注册与调用边界 |
| 7 | `04-execution-orchestrator.md` | 定义执行权和门禁 |
| 8 | `05-turn-behavior-and-state-model.md` | 定义 durable behavior 与 phase/status/next_action |
| 9 | `06-memory-context-and-trace.md` | 定义上下文、trace、replay 的可回放边界 |
| 10 | `07-workbench-ui-contract.md` | 定义 UI 如何消费 TurnResult 与行为动作 |
| 11 | `00c-state-and-contract-atlas.md` | 汇总状态、contract、ADR 与 slice 索引 |
| 12 | `docs/design-v3/adr/README.md` | 定义 v3 ADR 编号、状态、模板和首批顺序 |
| 13 | `tasks/slices/v3/DAG.md` | 准备进入承重垂直切面规划 |

在第 13 步之前，不建议写代码实现计划。

---

## 8. 当前已确认决策

以下内容已在 v3 探索中确认，可作为后续文档输入：

1. v3 不继承 v2 文档编号。
2. v3 从 v2 分支签出为 `idea/dialogue-based-novel-workbench/v3` 分支，远端为 `origin/idea/dialogue-based-novel-workbench/v3`。
3. v3 采用 Dialogue-first / Agent-native 方向。
4. 不再让 `Router` 这个名字暗示 turn 第一站。
5. 顶层采用双层协作：Dialogue Planner + Execution Orchestrator。
6. 每个 turn 必有 DialogueFrame。
7. DialogueFrame 按需升级 MicroPlan。
8. Planner 可以提出行动建议，但不能批准自己的执行。
9. Workbench 是工具箱，不是作者前台流程。
10. 设计体系和承重垂直切面 DAG 先于代码实现。
11. 不是所有探索都打开 durable clarification，只有阻塞下一步安全推进时才进入 BehaviorState。
12. Replay 默认不重新调用 LLM，优先基于结构化 trace 和版本引用解释系统决策。
13. Workbench UI 只消费 TurnResult、available actions、trace summary 和 projection hints，不直接写 BehaviorState 或调用工具。
14. `00c-state-and-contract-atlas.md` 作为 v3 状态、contract、ADR 候选和垂直切面入口总索引；垂直切面 DAG 之前应先建立 v3 ADR 目录与首批 Proposed ADR 顺序。

---

## 9. 当前开放问题

以下问题暂不冻结，后续在对应文档或 ADR 中收束：

| 问题 | 建议归属 |
|---|---|
| DialogueFrame 的字段全集与枚举 | `02-dialogue-frame-and-micro-plan.md` |
| MicroPlan 与 ToolRequest 的关系 | `02-dialogue-frame-and-micro-plan.md` |
| Capability Toolbox 是否统一 registry | `03-capability-toolbox-contract.md` |
| Execution Orchestrator 的 umbrella 模块归属如何冻结 | `04-execution-orchestrator.md` + slice DAG |
| TurnPhase / TurnStatus / NextAction 是否复用 v2 顶层字段 | `05-turn-behavior-and-state-model.md` + v3 ADR |
| MemoryItem / DialogueContext / DecisionTrace 字段全集 | `06-memory-context-and-trace.md` + v3 ADR |
| TurnResult v3 是否复用 v2 顶层字段 | v3 ADR |
| UI card/action/trace summary 字段全集 | `07-workbench-ui-contract.md` + v3 ADR |
| v3 ADR 编号、状态、模板和首批顺序 | `docs/design-v3/adr/README.md` |
| v2 代码迁移是重构还是旁路新链路 | slice DAG 阶段 |

---

## 10. 反模式

v3 禁止以下推进方式：

1. 直接把 v2 Router 改名成 Dialogue Planner。
2. 只改 prompt，不改主链 contract。
3. 只做自然语言回复，不留下 DialogueFrame / trace。
4. Planner 直接写生产状态。
5. 为了跑通 demo 跳过 confirmation / authority / budget。
6. 用 UI 表单反向定义 slot contract。
7. 用“之后再抽象”绕过 capability toolbox 设计。
8. 在没有 slice Contract / Invariant / Boundary / Consumer / Proof 的情况下写实现计划。
9. 把 v2 当前代码结构当成 v3 不可变约束。
10. 把 v3 顶层设计做成一次性大爆炸重写，而不是承重垂直切面。

---

## 11. 下一步

v3 下一步应继续完善设计体系，而不是进入代码实现。

推荐顺序：

1. 已完成 `00a-reading-map.md`，建立 v3 阅读路径。
2. 已完成 `00b-end-to-end-dialogue-flow.md`，把 DialogueFrame / MicroPlan / Execution Orchestrator 主链画清。
3. 已完成 `00d-runtime-architecture.md`，给出控制面、数据面、横切层。
4. 已完成 `02-dialogue-frame-and-micro-plan.md`，形成 frame / plan contract 草案。
5. 已完成 `03-capability-toolbox-contract.md` 与 `04-execution-orchestrator.md`，形成工具箱与执行权草案。
6. 已完成 `05-turn-behavior-and-state-model.md`，收束 clarification / confirmation / correction / cancellation / recovery。
7. 已完成 `06-memory-context-and-trace.md`，定义 context、trace、replay。
8. 已完成 `07-workbench-ui-contract.md`，定义 UI 如何消费 v3 输出。
9. 已完成 `00c-state-and-contract-atlas.md`，汇总状态、contract、ADR 候选和 slice 入口。
10. 下一步写 `docs/design-v3/adr/README.md`，定义 v3 ADR 编号、状态、模板和首批 Proposed ADR 顺序。
11. 再写首批 Proposed ADR。
12. 最后创建 `tasks/slices/v3/DAG.md`。

只有当上述设计链路能支撑第一条承重垂直切面时，才进入 implementation plan。
