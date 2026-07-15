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

### 2.1 Agent 系统的核心：会话结构

v3 的本质是一个小说创作 Agent 系统。它的核心不是模型供应商、prompt 模板、UI 表单或工具数量，而是**每一轮用户与 AI 交互时的会话结构**。

会话结构定义了：

- AI 当前以什么身份参与创作；
- 本轮作者意图、写作坐标、作品状态、可用工具、权限、预算和风险是什么；
- 哪些材料进入上下文，哪些材料被省略，省略如何解释；
- AI 的输出如何进入候选、确认、采纳、提炼、trace 和 replay；
- 哪些内容可以被模型建议，哪些内容必须由系统 contract 和 Orchestrator 决策。

因此，v3 的首要设计对象不是"最终 prompt 文案"，而是每个 agent turn 的结构化会话合同。prompt 只是该合同在某个 provider 上的渲染结果。只要会话结构没有设计好，模型越强只会更快地产生不可追溯、不可控、不可持续的创作漂移；会话结构设计好以后，不同 provider 只是预算、渲染和质量上限的差异。

### 2.2 AI 引导式创作

本应用应当帮助作者**通过 AI 的引导完成小说创作**，而不是要求作者先学会系统字段、工具面板或工程化流程。

AI 引导式创作的含义：

- 作者可以用模糊、片段化、情绪化的语言开始创作；
- AI 负责把模糊想法推进成可讨论的方向、对比方案、关键取舍和下一步行动；
- AI 在适当时机提醒作者补齐前提、角色动机、冲突、读者期待、章节功能、伏笔与风险；
- AI 能根据当前作品状态主动指出"现在更应该规划、续写、重写、修订还是维护"；
- 系统把 AI 的引导结果结构化为 DialogueFrame / MicroPlan / CreativeDecisionPacket / TurnResult，而不是让作者直接面对 schema。

边界同样明确：AI 可以引导、建议、整理、生成候选与暴露风险，但不能替作者静默决定作品权威状态。写入、采纳、高风险改动和长期记忆进入权威层，仍必须经过 Execution Orchestrator、policy、confirmation/adoption 和 trace。

### 2.3 产品形态：判断驱动的创作伙伴（2026-07-15 用户拍板收敛）

一句话形态：**小说创作的 Codex——一个可审计的、判断驱动的 LLM 创作伙伴：作者用
自然语言创作，AI 全程出声地思考、行动，并在每个关键处把裁决权交还作者；系统只做
门禁、记账和归档，自己不说话。**

四个形态支柱（对应契约）：

| 支柱 | 含义 | 契约锚点 |
|---|---|---|
| 对话即界面 | AI 一次回应 = 一段文档流（流式意图陈述 → 活动指示 → 阶段结论 → 产物卡 → 停在需要作者处）；一切"话"归模型且字节可溯源，系统只留结构词 | 46§9.4/9.5、ADR-0022（N-NARR） |
| 判断驱动 | 初始会话 → 模型判断 → 执行 → 再判断 → 或等待作者；计划按需涌现（是否制定计划由模型判断）；探索两翼（向内检索作品事实、向外搜索世界知识）支撑判断有据 | ADR-0025、ADR-0023（收窄域） |
| 作者主权 | 一切产出默认 tentative，写入作品事实必须经作者采纳；S1-S7 决策面是 AI 规范停下等作者的出口；每个动作过 Orchestrator 门禁 | ADR-0024、ADR-0003/0004/0005/0010 |
| 作品事实库 | 角色/设定/伏笔/章节/记忆构成持久 canon；AI 每轮携带当前作品事实工作；全程 trace 可回放 | `08`、`06`、ADR-0013/0017 |

与代码 agent 的本质差异（本产品护城河）：代码产出可测试自证，小说的"对"只有作者
能裁决——tentative-first 采纳边界与结构化 canon 是领域必然，不是保守设计。

实现层必须把 AI 引导式创作拆成三层 contract，并让三层 contract 投影到每一次 AI 调用的 message layer，而不是只优化 prompt 文案：

| 层 | 责任 | 主要载体 |
|---|---|---|
| 小说层 | 定义通用创作判断框架：欲望、阻力、变化、代价、读者期待、人物动机、章节功能、信息释放、伏笔、连续性、文风、质量门 | `08-novel-element-model.md`、质量门、`VS-00D` |
| 当前作品层 | 投影当前作品真实状态：snapshot、章节、摘要、记忆、前文、人物状态、伏笔/信息/情绪进度 | `DialogueContext` / Context Layer |
| 本轮引导层 | 由 AI 在 Planner 阶段判断本轮该探索、结构化、执行、质量诊断，还是澄清/确认；系统负责校验和门禁 | `DialogueFrame` / `MicroPlan` / Trace |

这三层与 AI message layer 的设计入口见 `contracts/VS-00D-ai-guided-authoring-contract-pack.md`。任何实现如果只把这些原则写进 provider prompt，而没有形成可重建的 `AIMessageEnvelope`，也没有进入 DialogueFrame、DialogueContext、MicroPlan、ToolInput 或 trace，就不算完成 AI 引导式创作能力。

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
docs/design/
```

建议骨架：

```text
docs/design/
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

1. 该方向至少有一份 docs/design 文档说明背景、目标、边界。
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

当前阶段已经形成 Stage 1：Direction / Architecture 的主文档链路，并开始进入 Stage 2：Contract / ADR。

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
| 12 | `docs/design/adr/README.md` | 定义 v3 ADR 编号、状态、模板和首批顺序 |
| 13 | `docs/design/adr/ADR-0001-dialogue-frame-v3.md` | 提出每 turn 必有的认知锚点决策 |
| 14 | `docs/design/adr/ADR-0002-micro-plan-v3.md` | 提出 Planner 到执行层的行动建议协议决策 |
| 15 | `docs/design/adr/ADR-0003-planner-authority-boundary.md` | 提出 Planner 不能批准执行的权限边界 |
| 16 | `docs/design/adr/ADR-0004-orchestrator-decision-v3.md` | 提出 OrchestratorDecision 的裁决表达 |
| 17 | `docs/design/adr/ADR-0005-execution-gate-order-v3.md` | 提出执行门禁顺序 |
| 18 | `tasks/slices/v3/DAG.md` | 准备进入承重垂直切面规划（已创建，待评审） |

在第 18 步之前，不建议写代码实现计划。

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
14. `00c-state-and-contract-atlas.md` 作为 v3 状态、contract、ADR 候选和垂直切面入口总索引；垂直切面 DAG 之前应先建立 v3 ADR 目录与首批 ADR 顺序。
15. v3 ADR 目录采用独立编号、Proposed / Accepted / Superseded / Deferred 状态，并要求 ADR 回连 `00c` 的 contract、invariant 和 slice 入口。
16. `ADR-0001-dialogue-frame-v3.md` 已将每 turn 必有 DialogueFrame 升级为 Accepted 决策。
17. `ADR-0002-micro-plan-v3.md` 已将 MicroPlan 作为下一步行动建议 envelope 升级为 Accepted 决策。
18. `ADR-0003-planner-authority-boundary.md` 已将 Planner 只有建议权、没有执行批准权升级为 Accepted 决策。
19. `ADR-0004-orchestrator-decision-v3.md` 已将 OrchestratorDecision 作为执行裁决 envelope 升级为 Accepted 决策。
20. `ADR-0005-execution-gate-order-v3.md` 已将 Execution Gate Order 升级为 Accepted 决策。
21. `ADR-0006` 至 `ADR-0009` 已将 phase/status、AvailableAction、BehaviorState 与 ConfirmationBinding 升级为 Accepted 决策。
22. `ADR-0010` 已将 State Adoption Boundary 升级为 Accepted 决策。
23. `ADR-0011` 至 `ADR-0013` 已将 Toolbox Registry、ToolRequest / ToolResult 与 DecisionTrace 升级为 Accepted 决策。
24. `ADR-0014` 至 `ADR-0015` 已将 Trace Redaction 与 TurnResultViewModel 升级为 Accepted 决策。
25. `ADR-0016` 至 `ADR-0017` 已将 ProjectionHint 与 ReplayReport 升级为 Accepted 决策。
26. 首批 v3 slice 需要同时证明“系统不会乱执行”和“AI 像创作伙伴”：VS-00A 证明模糊创作想法先自然展开，VS-00B 证明 AI 带着当前小说上下文回应。
27. 产品默认体验是 AI 引导作者进行小说创作；作者面对的是自然创作引导，系统内部再把引导结果结构化为 DialogueFrame / MicroPlan / CreativeDecisionPacket / TurnResult。

---

## 9. 当前开放问题

以下问题暂不冻结，后续在对应文档或 ADR 中收束：

| 问题 | 建议归属 |
|---|---|
| JSON Schema 或代码级 contract 如何从 contract pack 生成 | implementation plan 前置工作 |
| v2 代码迁移是重构还是旁路新链路 | implementation plan 阶段 |
| 具体 umbrella 模块归属与测试切入点 | 每个 slice 的 implementation plan |
| trace store / replay report 是否持久化 | VS-06 implementation plan 或后续 persistence ADR |
| 创作伙伴体验是否需要独立 ADR | 先由 VS-00A / VS-00B 证明；若后续多个 slice 复用，再升级为 ADR |

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
10. 已完成 `docs/design/adr/README.md`，定义 v3 ADR 编号、状态、模板和首批 ADR 顺序。
11. 已完成 `docs/design/adr/ADR-0001-dialogue-frame-v3.md`，将 DialogueFrame 升级为 Accepted 决策。
12. 已完成 `docs/design/adr/ADR-0002-micro-plan-v3.md`，将 MicroPlan 升级为 Accepted 决策。
13. 已完成 `docs/design/adr/ADR-0003-planner-authority-boundary.md`，将 Planner 权限边界升级为 Accepted 决策。
14. 已完成 `docs/design/adr/ADR-0004-orchestrator-decision-v3.md`，将执行裁决表达升级为 Accepted 决策。
15. 已完成 `ADR-0005-execution-gate-order-v3.md`，将执行门禁顺序升级为 Accepted 决策。
16. 已创建 `tasks/slices/v3/DAG.md`、VS-00 / VS-00A / VS-00B / VS-01 / VS-02 / VS-02A / VS-03 / VS-04 / VS-05 / VS-06 slice 文件和对应 contract pack，VS-00 / VS-00A / VS-00B / VS-01 / VS-02 / VS-02A / VS-03 / VS-04 / VS-05 / VS-06 文档 blocker 已关闭。
17. 已完成 `docs/engineering/architecture-guardrails.md` 和 `docs/engineering/quality-gates.md`，把 v3 技术架构、质量门禁和 v2 复用边界收口为实现前护栏。
18. 当前文档阶段已经具备进入 implementation plan 评审的输入；只有用户明确批准后，才可创建 implementation plan 或进入代码实现。

只有用户明确批准后，才进入 implementation plan 或代码实现。
