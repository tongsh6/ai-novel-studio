# v3 文档导航：按角色找入口

> 状态：草案（2026-05-02）
>
> 角色：v3 设计体系的阅读入口。本文按角色给出阅读路径、时间预算、读完能回答的问题，并标明当前已存在文档与计划中文档。
>
> 用法：先在 §0 选定身份，再按对应路径阅读。当前 v3 已完成 Stage 1（Direction / Architecture）的主链文档，正在推进 Stage 2（Contract / ADR）；计划中文档用于说明后续阅读顺序，不代表内容已经冻结。

---

## 0. 选你的身份

| 身份 | 路径 | 当前可读时间 | 读完能干什么 |
|---|---|---:|---|
| 完全没看过，10 分钟先了解 | §1 | 10 min | 讲清 v3 为什么存在、和 v2 根本差异是什么 |
| 产品 / 作者 / 方向评估 | §2 | 50 min | 判断 v3 是否对齐“LLM 创作伙伴”愿景 |
| 架构 / Agent 工程师 | §3 | 215 min | 理解 v3 主链、边界、工程护栏和后续 contract 顺序 |
| UI / Workbench 设计 | §4 | 80 min | 理解为什么 UI 不应再呈现表单式补槽 |
| 维护者 / 决策冻结 | §5 | 155 min | 判断哪些内容只是草案，哪些应升级 ADR |
| 垂直切面规划者 | §6 | 205 min | 知道何时允许切承重垂直切面，怎么切，怎么验收 |

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
| 5 | `07-workbench-ui-contract.md` | 草案，已存在 | 10 min | UI 应该如何呈现自然对话、候选方向和确认 |

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
| 9 | `06-memory-context-and-trace.md` | 草案，已存在 | 设计 context、trace、replay |
| 10 | `07-workbench-ui-contract.md` | 草案，已存在 | 设计 UI 消费 TurnResult 和 trace 摘要 |
| 10a | `08-novel-element-model.md` | 草案，已存在 | 设计创作类 contract（规划 schema、maintenance 提炼、面板、上下文组装共用的小说要素全景） |
| 10b | `contracts/VS-00D-ai-guided-authoring-contract-pack.md` | Proposed，已存在 | 设计 AI 引导式创作的三层 contract 与 AI message layer |
| 10c | `contracts/VS-00C-creative-context-assembly-contract-pack.md` | Proposed，已存在 | 设计 prose_writing 等创作执行调用的 CreativeDecisionPacket 与上下文组装 |
| 10d | `acceptance/author/AU-11-ai-guided-authoring.md` | Design-ready，已存在 | 从作者视角验收三层 message 和 AI 引导式创作闭环 |
| 11 | `00c-state-and-contract-atlas.md` | 草案，已存在 | 汇总状态、contract、ADR 和 slice 入口 |
| 12 | `adr/README.md` | 草案，已存在 | 定义 v3 ADR 编号、状态、模板和首批顺序 |
| 13 | `adr/ADR-0001-dialogue-frame-v3.md` | Accepted，已存在 | 冻结每 turn 必有的认知锚点决策 |
| 14 | `adr/ADR-0002-micro-plan-v3.md` | Accepted，已存在 | 冻结 Planner 到执行层的行动建议协议 |
| 15 | `adr/ADR-0003-planner-authority-boundary.md` | Accepted，已存在 | 冻结 Planner 不能批准执行的权限边界 |
| 16 | `adr/ADR-0004-orchestrator-decision-v3.md` | Accepted，已存在 | 冻结 OrchestratorDecision 的裁决表达 |
| 17 | `adr/ADR-0005-execution-gate-order-v3.md` | Accepted，已存在 | 冻结执行门禁顺序 |
| 18 | `../engineering/architecture-guardrails.md` | 试行护栏，已存在 | 进入实现计划前确认 app 边界、主链落位和 v2 复用边界 |
| 19 | `../engineering/quality-gates.md` | 试行护栏，已存在 | 进入实现计划前确认工程门禁、slice 门禁和小说质量门禁 |

工程师读完当前必读后，应该能回答：

1. 为什么当前架构不应从修改 Router 开始。
2. 为什么每个 turn 必须有 DialogueFrame。
3. 为什么 Planner 不能批准自己的 MicroPlan。
4. 为什么实现前要先有 ADR / contract / 承重垂直切面 DAG。
5. 哪些历史设计可以复用，哪些不能作为当前架构捷径。

---

## 4. UI / Workbench 设计路径

> 读完能理解 UI 为什么不能再把 slot schema 渲染成作者填写的主流程。

| # | 文档 | 状态 | 时间 | 读完能回答 |
|---|---|---|---:|---|
| 1 | `01-user-llm-workbench-interaction-model.md` §1-3 / §9-10 | 草案，已存在 | 15 min | 缺 slot 为什么不等于展示字段表单 |
| 2 | `00-vision-and-engineering-roadmap.md` §2 / §10 | 草案，已存在 | 10 min | 当前 UI 相关反模式有哪些 |
| 3 | `00b-end-to-end-dialogue-flow.md` | 草案，已存在 | 10 min | UI 会看到哪些 turn 状态和消息 |
| 4 | `05-turn-behavior-and-state-model.md` | 草案，已存在 | 15 min | UI 为什么只能消费 BehaviorState / NextAction |
| 5 | `06-memory-context-and-trace.md` | 草案，已存在 | 15 min | UI 为什么只能消费 trace 摘要而不是内部日志 |
| 6 | `07-workbench-ui-contract.md` | 草案，已存在 | 20 min | UI 消费 TurnResult、ui_cards、trace 的规则 |

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
| 6 | `06-memory-context-and-trace.md` | 草案，已存在 | 15 min | 哪些 trace / replay 语义要冻结 |
| 7 | `07-workbench-ui-contract.md` | 草案，已存在 | 15 min | 哪些 UI 消费边界要冻结 |
| 8 | `00c-state-and-contract-atlas.md` | 草案，已存在 | 15 min | 哪些 contract 应优先升级 ADR |
| 9 | `adr/README.md` | 草案，已存在 | 按需 | v3 ADR 如何编号、评审和冻结 |
| 10 | `adr/ADR-0001-dialogue-frame-v3.md` | Accepted，已存在 | 按需 | DialogueFrame 的决策范围和替代方案 |
| 11 | `adr/ADR-0002-micro-plan-v3.md` | Accepted，已存在 | 按需 | MicroPlan 的冻结范围和替代方案 |
| 12 | `adr/ADR-0003-planner-authority-boundary.md` | Accepted，已存在 | 按需 | Planner 权限边界的冻结范围 |
| 13 | `adr/ADR-0004-orchestrator-decision-v3.md` | Accepted，已存在 | 按需 | OrchestratorDecision 的冻结范围 |
| 14 | `adr/ADR-0005-execution-gate-order-v3.md` | Accepted，已存在 | 按需 | Execution Gate Order 的冻结范围 |

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
| 8 | `06-memory-context-and-trace.md` | 草案，已存在 | 15 min | trace / replay 如何证明闭环 |
| 9 | `07-workbench-ui-contract.md` | 草案，已存在 | 15 min | UI 消费如何证明前台体验闭环 |
| 10 | `00c-state-and-contract-atlas.md` | 草案，已存在 | 10 min | 状态、contract、ADR、slice 如何索引 |
| 11 | `adr/README.md` | 草案，已存在 | 10 min | 哪些 ADR 先冻结，哪些只是 backlog |
| 12 | `adr/ADR-0001-dialogue-frame-v3.md` | Accepted，已存在 | 10 min | 第一条 ADR 如何约束每 turn 必有 frame |
| 13 | `adr/ADR-0002-micro-plan-v3.md` | Accepted，已存在 | 10 min | MicroPlan 如何连接 frame 与执行权 |
| 14 | `adr/ADR-0003-planner-authority-boundary.md` | Accepted，已存在 | 10 min | Planner 不能批准执行如何成为硬边界 |
| 15 | `adr/ADR-0004-orchestrator-decision-v3.md` | Accepted，已存在 | 10 min | OrchestratorDecision 如何承接执行权 |
| 16 | `adr/ADR-0005-execution-gate-order-v3.md` | Accepted，已存在 | 10 min | 执行门禁顺序如何保护权限、预算和写入 |
| 17 | `tasks/slices/v3/DAG.md` | docs-ready，已存在 | 10 min | VS-00 到 VS-11 以及 VS-00D 如何排序、依赖和阻塞 |
| 18 | `../engineering/architecture-guardrails.md` | 试行护栏，已存在 | 15 min | v3 实现计划必须遵守哪些 app 边界和复用边界 |
| 19 | `../engineering/quality-gates.md` | 试行护栏，已存在 | 15 min | 每个 slice 需要哪些工程证明、语义证明和扫描闭环 |

每条 v3 slice 必须回答：

| 问题 | 含义 |
|---|---|
| Contract | 固化或消费哪个 v3 契约、schema、ADR、状态字段 |
| Invariant | 保护哪个系统不变量 |
| Boundary | 切穿哪些真实 app 边界，哪些 app 明确不改 |
| Consumer | 第一个真实消费者是谁 |
| Proof | 用什么测试或命令证明链路成立 |

v3 第一批 slice 已在 `tasks/slices/v3/DAG.md` 排序，并已为 VS-00 到 VS-06（含 VS-00A、VS-00B、VS-02A）创建具体 slice 文件、contract pack 和 Accepted ADR 输入；VS-00D 作为后置 contract reconciliation 已补 contract pack、AU-11 验收入口和 slice 入口。implementation plan / code 仍需用户明确批准。

进入任意 implementation plan 前，必须先读 `docs/engineering/architecture-guardrails.md` 和 `docs/engineering/quality-gates.md`。这两篇负责把已有工程规则、v2 可复用设计和 v3 主链约束合并成实现前护栏。

---

## 7. 当前文档状态

| 文档 | 状态 | 说明 |
|---|---|---|
| `00-vision-and-engineering-roadmap.md` | 草案，已存在 | v3 工程推进方式 |
| `00a-reading-map.md` | 草案，本文 | 按角色阅读入口 |
| `01-user-llm-workbench-interaction-model.md` | 草案，已存在 | v3 交互模型与推荐方案 |
| `00b-end-to-end-dialogue-flow.md` | 草案，已存在 | v3 动态主链 |
| `00c-state-and-contract-atlas.md` | 草案，已存在 | 状态与 contract 索引 |
| `00d-runtime-architecture.md` | 草案，已存在 | 运行时架构图 |
| `02-dialogue-frame-and-micro-plan.md` | 草案，已存在 | 核心协议草案 |
| `03-capability-toolbox-contract.md` | 草案，已存在 | 工具箱 contract |
| `04-execution-orchestrator.md` | 草案，已存在 | 执行层边界 |
| `05-turn-behavior-and-state-model.md` | 草案，已存在 | 对话行为状态 |
| `06-memory-context-and-trace.md` | 草案，已存在 | 记忆、上下文与回放 |
| `07-workbench-ui-contract.md` | 草案，已存在 | UI 消费契约 |
| `08-novel-element-model.md` | 草案，已存在 | 小说要素模型（要素 × 层级 × 三态），创作类 contract pack 共同上游 |
| `contracts/VS-00D-ai-guided-authoring-contract-pack.md` | Proposed，已存在 | AI 引导式创作三层 contract 与 AI message layer |
| `contracts/VS-00C-creative-context-assembly-contract-pack.md` | Proposed，已存在 | 创作执行上下文组装与 CreativeDecisionPacket |
| `acceptance/author/AU-11-ai-guided-authoring.md` | Design-ready，已存在 | AI 引导式创作三层 message 验收入口 |
| `adr/README.md` | 草案，已存在 | ADR 编号、状态、模板 |
| `adr/ADR-0001-dialogue-frame-v3.md` | Accepted，已存在 | DialogueFrame v3 决策 |
| `adr/ADR-0002-micro-plan-v3.md` | Accepted，已存在 | MicroPlan v3 决策 |
| `adr/ADR-0003-planner-authority-boundary.md` | Accepted，已存在 | Planner 权限边界决策 |
| `adr/ADR-0004-orchestrator-decision-v3.md` | Accepted，已存在 | OrchestratorDecision v3 决策 |
| `adr/ADR-0005-execution-gate-order-v3.md` | Accepted，已存在 | Execution Gate Order v3 决策 |
| `adr/ADR-0006` 至 `adr/ADR-0017` | Accepted，已存在 | behavior、tool、adoption、UI、replay 决策 |
| `tasks/slices/v3/DAG.md` | docs-ready，已存在 | VS-00 到 VS-11、VS-00D 垂直切面排序 |
| `tasks/slices/v3/VS-00D-ai-guided-authoring-message-contract.md` | docs-ready，已存在 | AI 引导式创作三层 + message contract 的承重 slice 入口 |
| `../engineering/architecture-guardrails.md` | 试行护栏，已存在 | v3 技术架构、app 边界、深模块和 v2 复用边界 |
| `../engineering/quality-gates.md` | 试行护栏，已存在 | v3 工程门禁、slice 门禁、小说质量门禁和验证模板 |

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

如果你现在要继续推进 v3，当前文档阶段结论是：

```text
VS-00 到 VS-06（含 VS-00A、VS-00B、VS-02A）首批文档输入已 docs-ready；VS-00D 作为后置 contract reconciliation 已 docs-ready
```

原因：

- `00` 已经定义推进方式。
- `00a` 已经定义阅读路径。
- `01` 已经定义交互模型。
- `00b` / `00d` / `02` / `03` / `04` / `05` / `06` / `07` 已经形成主链、运行时、Frame/Plan、Toolbox、执行权、行为状态、trace/replay 和 UI 消费草案。
- `00c` 已经把状态、contract、ADR 候选和第一批 slice 入口放到同一张索引图里。
- `adr/README.md` 已经定义 v3 ADR 的编号、状态、模板和首批 ADR 顺序。
- `ADR-0001` 已经把每 turn 必有 DialogueFrame 升级为 Accepted 决策。
- `ADR-0002` 已经把 MicroPlan 升级为 Accepted 决策。
- `ADR-0003` 已经把 Planner 权限边界升级为 Accepted 决策。
- `ADR-0004` 已经把 OrchestratorDecision 升级为 Accepted 决策。
- `ADR-0005` 已经把 Execution Gate Order 升级为 Accepted 决策。
- `tasks/slices/v3/DAG.md` 已经把首批承重垂直切面排序，并关闭 VS-00 到 VS-06（含 VS-00A、VS-00B、VS-02A）的文档 blocker；VS-00D 后置 contract reconciliation 入口也已补齐。
- VS-00 / VS-00A / VS-00B / VS-01 / VS-02 / VS-02A / VS-03 / VS-04 / VS-05 / VS-06 具体 slice 文件已经创建，文档 blocker 已关闭。
- `docs/engineering/architecture-guardrails.md` 和 `docs/engineering/quality-gates.md` 已经把 v3 实现前的架构护栏、质量门禁和 v2 复用边界收口。
- 下一步需要用户明确批准后，才可创建 implementation plan 或进入代码实现。
