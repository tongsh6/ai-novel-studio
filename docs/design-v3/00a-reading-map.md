# v3 文档导航：按角色找入口

> 状态：草案（2026-05-02）
>
> 角色：v3 设计体系的阅读入口。本文按角色给出阅读路径、时间预算、读完能回答的问题，并标明当前已存在文档与计划中文档。
>
> 用法：先在 §0 选定身份，再按对应路径阅读。当前 v3 仍处于 Stage 1（Direction / Architecture），部分文档处于计划状态；计划中文档用于说明后续阅读顺序，不代表内容已经冻结。

---

## 0. 选你的身份

| 身份 | 路径 | 当前可读时间 | 读完能干什么 |
|---|---|---:|---|
| 完全没看过，10 分钟先了解 | §1 | 10 min | 讲清 v3 为什么存在、和 v2 根本差异是什么 |
| 产品 / 作者 / 方向评估 | §2 | 40 min | 判断 v3 是否对齐“LLM 创作伙伴”愿景 |
| 架构 / Agent 工程师 | §3 | 95 min | 理解 v3 主链、边界和后续 contract 顺序 |
| UI / Workbench 设计 | §4 | 45 min | 理解为什么 UI 不应再呈现表单式补槽 |
| 维护者 / 决策冻结 | §5 | 60 min | 判断哪些内容只是草案，哪些应升级 ADR |
| 垂直切面规划者 | §6 | 85 min | 知道何时允许切承重垂直切面，怎么切 |

不在以上身份中：先读 §1，再按最接近的角色跳读。

---

## 1. 10 分钟速览路径

| # | 文档 | 状态 | 时间 | 读完能回答 |
|---|---|---|---:|---|
| 1 | `00-vision-and-engineering-roadmap.md` §1-2 | 草案，已存在 | 5 min | v3 为什么不是 v2 补丁 |
| 2 | `01-user-llm-workbench-interaction-model.md` §1 / §4.3 / §5 | 草案，已存在 | 5 min | v3 推荐的目标拓扑是什么 |

读完这 2 份，你应该能说清：

```text
v3 不再以 Router-first 为目标；
用户面对 LLM 创作伙伴；
工作台退到工具箱位置；
Execution Orchestrator 保留执行硬门禁。
```

---

## 2. 产品 / 作者 / 方向评估路径

> 读完能判断 v3 是否解决“作者在和系统填表，而不是和 LLM 创作”的根问题。

| # | 文档 | 状态 | 时间 | 读完能回答 |
|---|---|---|---:|---|
| 1 | `00-vision-and-engineering-roadmap.md` §1-3 | 草案，已存在 | 10 min | v3 的产品与工程愿景是什么 |
| 2 | `01-user-llm-workbench-interaction-model.md` §1-4 | 草案，已存在 | 10 min | 为什么推荐 Agent-native DialogueFrame / MicroPlan |
| 3 | `00b-end-to-end-dialogue-flow.md` | 草案，已存在 | 10 min | 一次作者输入如何被自然引导并安全执行 |
| 4 | `05-turn-behavior-and-state-model.md` | 草案，已存在 | 10 min | 为什么不是所有探索都进入 clarification |
| 5 | `07-workbench-ui-contract.md` | 计划中 | 10 min | UI 应该如何呈现自然对话、候选方向和确认 |

跳过建议：

- 先不要读 Capability Toolbox 细节，除非你要评估系统可做什么。
- 先不要读 ADR，ADR 是冻结结论，不是产品体验入口。

---

## 3. 架构 / Agent 工程师路径

> 读完能开始参与 v3 架构讨论，但还不能直接写实现。

### 3.1 当前必读

| # | 文档 | 状态 | 时间 | 读完能回答 |
|---|---|---|---:|---|
| 1 | `00-vision-and-engineering-roadmap.md` 全文 | 草案，已存在 | 20 min | v3 如何从探索进入正式工程 |
| 2 | `01-user-llm-workbench-interaction-model.md` 全文 | 草案，已存在 | 25 min | DialogueFrame / MicroPlan / Execution Orchestrator 的关系 |

### 3.2 当前可继续深读

| # | 文档 | 状态 | 适用场景 |
|---|---|---|---|
| 3 | `00b-end-to-end-dialogue-flow.md` | 草案，已存在 | 需要理解 turn 主链 |
| 4 | `00d-runtime-architecture.md` | 草案，已存在 | 需要理解控制面 / 数据面 / 横切层 |
| 5 | `02-dialogue-frame-and-micro-plan.md` | 草案，已存在 | 准备冻结核心协议 |
| 6 | `03-capability-toolbox-contract.md` | 草案，已存在 | 设计工具 / capability registry |
| 7 | `04-execution-orchestrator.md` | 草案，已存在 | 设计执行权、状态机、门禁 |
| 8 | `05-turn-behavior-and-state-model.md` | 草案，已存在 | 设计 durable behavior 与 phase/status |
| 9 | `06-memory-context-and-trace.md` | 计划中 | 设计 context、trace、replay |

工程师读完当前必读后，应该能回答：

1. 为什么 v3 不应从修改 Router 开始。
2. 为什么每个 turn 必须有 DialogueFrame。
3. 为什么 Planner 不能批准自己的 MicroPlan。
4. 为什么实现前要先有 ADR / contract / 承重垂直切面 DAG。

---

## 4. UI / Workbench 设计路径

> 读完能理解 UI 为什么不能再把 slot schema 渲染成作者填写的主流程。

| # | 文档 | 状态 | 时间 | 读完能回答 |
|---|---|---|---:|---|
| 1 | `01-user-llm-workbench-interaction-model.md` §1-3 / §9-10 | 草案，已存在 | 15 min | 缺 slot 为什么不等于展示字段表单 |
| 2 | `00-vision-and-engineering-roadmap.md` §2 / §10 | 草案，已存在 | 10 min | v3 UI 相关反模式有哪些 |
| 3 | `00b-end-to-end-dialogue-flow.md` | 草案，已存在 | 10 min | UI 会看到哪些 turn 状态和消息 |
| 4 | `05-turn-behavior-and-state-model.md` | 草案，已存在 | 15 min | UI 为什么只能消费 BehaviorState / NextAction |
| 5 | `07-workbench-ui-contract.md` | 计划中 | 20 min | UI 消费 TurnResult、ui_cards、trace 的规则 |

UI 侧当前结论：

- 作者主界面应呈现 LLM 创作伙伴，而不是工作台表单。
- 候选方向、对比方案、确认卡可以是 UI 元素，但它们必须来自 v3 contract。
- UI 不反向定义 intent、slot、behavior、policy。
- UI 不绕过 Execution Orchestrator 写生产状态。

---

## 5. 维护者 / 决策冻结路径

> 读完能判断某个想法应该留在草案、升级 ADR，还是进入承重垂直切面规划。

| # | 文档 | 状态 | 时间 | 读完能回答 |
|---|---|---|---:|---|
| 1 | `00-vision-and-engineering-roadmap.md` §3 / §6 / §8-10 | 草案，已存在 | 15 min | v3 的阶段门槛和反模式 |
| 2 | `01-user-llm-workbench-interaction-model.md` §4 / §12 | 草案，已存在 | 10 min | 当前推荐方案和后续 ADR 方向 |
| 3 | `02-dialogue-frame-and-micro-plan.md` | 草案，已存在 | 15 min | 哪些字段要冻结 |
| 4 | `04-execution-orchestrator.md` | 草案，已存在 | 15 min | 哪些执行边界要冻结 |
| 5 | `05-turn-behavior-and-state-model.md` | 草案，已存在 | 15 min | 哪些行为状态要冻结 |
| 6 | `adr/` | 计划中 | 按需 | 哪些决策已经 Accepted |

维护者判断规则：

1. 影响主链的概念，不能只留在 prompt。
2. 影响状态机、schema、权限、预算、写入的内容，必须进入 ADR。
3. 影响 UI 消费路径的字段，必须有 contract。
4. 影响代码边界的设计，必须能落到承重垂直切面 DAG。

---

## 6. 垂直切面规划者路径

> 读完能准备 `tasks/slices/v3/DAG.md`，但不会过早写 implementation plan。

| # | 文档 | 状态 | 时间 | 读完能回答 |
|---|---|---|---:|---|
| 1 | `00-vision-and-engineering-roadmap.md` §3.4 / §6 / §7 | 草案，已存在 | 10 min | 什么时候允许切 slice |
| 2 | `01-user-llm-workbench-interaction-model.md` §10-11 | 草案，已存在 | 15 min | v3 主链要证明哪些不变量 |
| 3 | `00b-end-to-end-dialogue-flow.md` | 草案，已存在 | 15 min | 第一批 slice 应该覆盖哪段链路 |
| 4 | `02-dialogue-frame-and-micro-plan.md` | 草案，已存在 | 15 min | 第一批 slice 要固化哪个 contract |
| 5 | `03-capability-toolbox-contract.md` | 草案，已存在 | 15 min | 工具调用边界如何进入 slice |
| 6 | `04-execution-orchestrator.md` | 草案，已存在 | 15 min | 执行权和门禁如何进入 slice |
| 7 | `05-turn-behavior-and-state-model.md` | 草案，已存在 | 15 min | 等待态、确认态、取消态如何闭环 |
| 8 | `06-memory-context-and-trace.md` | 计划中 | 15 min | trace / replay 如何证明闭环 |
| 9 | `tasks/slices/v3/DAG.md` | 计划中 | 10 min | slice 之间如何排序 |

每条 v3 slice 必须回答：

| 问题 | 含义 |
|---|---|
| Contract | 固化或消费哪个 v3 契约、schema、ADR、状态字段 |
| Invariant | 保护哪个系统不变量 |
| Boundary | 切穿哪些真实 app 边界，哪些 app 明确不改 |
| Consumer | 第一个真实消费者是谁 |
| Proof | 用什么测试或命令证明链路成立 |

v3 第一批 slice 不应在 `00b` / `00d` / `02` / `03` / `04` / `05` 形成闭环，并由 `06` / `07` / `00c` 校验 trace、UI 消费和 contract 索引前贸然切。

---

## 7. 当前文档状态

| 文档 | 状态 | 说明 |
|---|---|---|
| `00-vision-and-engineering-roadmap.md` | 草案，已存在 | v3 工程推进方式 |
| `00a-reading-map.md` | 草案，本文 | 按角色阅读入口 |
| `01-user-llm-workbench-interaction-model.md` | 草案，已存在 | v3 交互模型与推荐方案 |
| `00b-end-to-end-dialogue-flow.md` | 草案，已存在 | v3 动态主链 |
| `00c-state-and-contract-atlas.md` | 计划中 | 状态与 contract 索引 |
| `00d-runtime-architecture.md` | 草案，已存在 | 运行时架构图 |
| `02-dialogue-frame-and-micro-plan.md` | 草案，已存在 | 核心协议草案 |
| `03-capability-toolbox-contract.md` | 草案，已存在 | 工具箱 contract |
| `04-execution-orchestrator.md` | 草案，已存在 | 执行层边界 |
| `05-turn-behavior-and-state-model.md` | 草案，已存在 | 对话行为状态 |
| `06-memory-context-and-trace.md` | 计划中 | 记忆、上下文与回放 |
| `07-workbench-ui-contract.md` | 计划中 | UI 消费契约 |

---

## 8. 通用反模式

任何角色都不要这样读或推进：

1. 只读 `01` 就开始改代码。
2. 把 v2 Router-first 当成 v3 默认实现路径。
3. 跳过 `00` 的阶段门槛，直接写 implementation plan。
4. 把计划中文档当成已经冻结的 contract。
5. 在 ADR 之前争论字段最终命名。
6. 用 UI 原型反向发明 intent 或 slot。
7. 把“能跑 demo”当成承重垂直切面完成。
8. 把自然语言 prompt 行为当成系统可审计 contract。

---

## 9. 下一步阅读建议

如果你现在要继续完善 v3 设计体系，下一篇应该写：

```text
06-memory-context-and-trace.md
```

原因：

- `00` 已经定义推进方式。
- `00a` 已经定义阅读路径。
- `01` 已经定义交互模型。
- `00b` / `00d` / `02` / `03` / `04` / `05` 已经形成主链、运行时、Frame/Plan、Toolbox、执行权和行为状态草案。
- 下一步需要定义 DialogueContext、DecisionTrace、BehaviorTrace 与 replay，证明行为状态和执行裁决可回放。
