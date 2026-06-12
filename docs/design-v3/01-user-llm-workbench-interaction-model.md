# v3 用户-LLM-工作台交互模型

> 状态：草案（2026-05-02）
>
> 角色：v3 架构的第一份交互模型分析型设计备忘录。本文不继承 v2 文档编号，也不把 v2 `Router-first` 拓扑作为兼容约束。
>
> 目标：重新定义用户、LLM、工作台三者关系，确立 v3 的 Dialogue-first / Agent-native 主链，为后续 DialogueFrame、MicroPlan、Capability Toolbox、Execution Orchestrator 等契约设计提供方向。

---

## 1. 核心判断

v3 的产品与架构目标不是“把表单追问写得更自然”，而是重新确定三者关系：

```text
用户通过 LLM 进行创作；
LLM 是作者可感知的创作伙伴；
工作台是 LLM 和执行系统背后的装备库、技能库、武器库。
```

因此，v3 不再采用 `Router-first` 作为目标 turn 拓扑。

`Router-first` 的结构性问题在于：工作台先拦截用户输入，完成 intent 分类、slot 抽取、缺失字段判断后，才把 LLM 放到执行位置。这个模型即使把追问文案改得更温柔，本质上仍然是“工作台挡在用户和 LLM 之间当柜员”。

v3 采用的目标心智是：

```text
自然创作对话在前；
工具化、契约化、执行化在后；
状态机、权限、预算、确认、审计永远由执行层硬门禁控制。
```

---

## 2. v2 Router-first 模型的问题

v2 早期实现可概括为：

```text
User
→ Router
  - classify intent
  - extract slots
  - detect missing required slots
→ TurnService / Orchestrator
→ Executor / LLM
→ TurnResult
```

这个模型的优点是简单、可测试、容易打通最小链路。但它把 LLM 放在了错误的位置：

| 现象 | 结构性原因 |
|---|---|
| 作者感觉自己在填表 | Router 缺 slot 后直接触发机械 clarification |
| LLM 不像创作伙伴 | LLM 多数时候只在最后内容生成阶段出现 |
| “没想好”“换一组”“更燃一点”等话语难处理 | Router 主要做分类和抽槽，不承担探索式对话 |
| slot schema 被误解为 UI 表单 | required slot 被提前暴露到作者前台 |
| 工作台压过 LLM | 工作台成为用户入口，LLM 成为工作台工具 |

ADR-0010 这类 slot schema 本身不是问题。系统在执行前必须知道需要哪些参数，这是正确的。问题是：slot 校验不应成为作者首先面对的交互体验。

v3 的重构不是废弃契约，而是把契约从作者前台移到 LLM 和执行系统背后。

---

## 3. v3 设计原则

### 3.1 Dialogue-first

用户输入首先进入 Dialogue Planner 的创作对话循环，而不是进入固定前置 Router。

Dialogue Planner 负责：

- 理解用户当前创作意图。
- 用编辑口吻引导作者表达模糊想法。
- 生成候选方向、对比方案、追问与自然语言回应。
- 把用户自然语言整理为结构化草稿。

### 3.2 AI-guided authoring

v3 的默认体验应是 AI 引导作者创作，而不是作者指挥一组离散工具。作者可以从"我想写个更燃的开头""这一章感觉不对""给我一个修仙升级体系"这类不完整表达开始；AI 的责任是把它推进为可创作、可执行、可审计的下一步。

AI 引导作者创作包括四类动作：

| 引导类型 | AI 应做什么 | 不应做什么 |
|---|---|---|
| 探索引导 | 帮作者展开题材、主题、人物、冲突、卖点和读者期待 | 立刻要求作者填写固定字段 |
| 结构引导 | 把想法整理成卷/章/场方向、章节功能、信息释放和伏笔安排 | 把自由讨论直接写入权威大纲 |
| 执行引导 | 在首稿、续写、重写、修订之间提出下一步建议，并说明依据 | 绕过 Orchestrator 直接执行高风险写入 |
| 质量引导 | 提醒人物动机、连续性、节奏、读者效果和承诺风险 | 用泛泛的写作建议替代当前作品上下文判断 |

这意味着 Dialogue Planner 的作者可见回应不只是"回答问题"，而是要持续帮助作者完成创作判断：下一步写什么、为什么这样写、有哪些选择、风险在哪里、哪些内容需要确认。系统内部再把这些引导结果落成 DialogueFrame、MicroPlan、CreativeDecisionPacket 和 TurnResult。

AI 引导式创作的 contract 分三层（正式定义见 `contracts/VS-00D-ai-guided-authoring-contract-pack.md`）：

| 层 | 本层回答的问题 | 交互含义 |
|---|---|---|
| 小说层 | 什么是有效的小说创作判断 | AI 不是泛聊，而是按欲望、阻力、变化、代价、读者期待、人物动机、章节功能、信息释放、伏笔、连续性、文风、质量门来引导 |
| 当前作品层 | 这本书现在有什么真实状态 | AI 只能基于 DialogueContext 中有来源的作品状态判断；没有上下文时必须暴露缺失 |
| 本轮引导层 | 这一轮该怎么推进作者 | Planner 用 AI 做语义判断，系统把判断结构化、校验、留痕，并交给 Orchestrator 控制执行边界 |

这个三层 contract 是交互体验的底座：作者看到的是自然创作引导，系统内部必须能回答“AI 为什么这样引导、基于哪些作品状态、涉及哪些小说要素、下一步是否允许执行”。这些答案不能只存在于产品架构图里；每次调用 AI 时，三层 contract 都必须投影为可重建的 AI message envelope。

### 3.3 Conversation structure is the Agent kernel

v3 是 Agent-native，不是"聊天框 + 工具调用"。每一次用户与 AI 的交互都必须被视为一个 agent turn；这个 turn 的会话结构决定了创作质量上限。

一个有效的小说创作 agent turn 至少要回答：

- 作者此刻是在探索、规划、首稿、续写、重写、修订还是维护；
- 当前写作坐标指向哪部作品、哪一卷、哪一章、哪一场或哪一段；
- AI 看到的是哪些设计态、实现态、进度态材料；
- 缺失、冲突、过期、超预算内容如何处理；
- 本轮输出是建议、候选正文、可采纳变更、维护提炼，还是纯对话；
- 执行权、写入权、确认权、采纳权分别属于谁。

因此，prompt 不是主设计对象。prompt 是会话结构在具体 provider 上的文本投影；真正的 contract 是 `AIMessageEnvelope`、DialogueFrame、ContextPacket、MicroPlan、ToolInput、ToolResult、TurnResult 和 Trace 的组合。如果只优化 prompt 文案而不设计 message envelope 和会话结构，系统会退化为不可审计的通用聊天续写。

### 3.4 Contract-first, not prompt-only

v3 不把系统契约藏进 prompt。

Intent、slot、capability、policy、authority、budget、behavior、TurnResult 仍然必须是结构化契约。LLM 可以提出理解和建议，但不能绕过契约执行。

### 3.5 Workbench as Toolbox

工作台不是用户前台流程，而是工具箱：

| 工具箱层 | 含义 |
|---|---|
| 装备库 | 当前作品上下文、对话历史、slot draft、memory、registry |
| 技能库 | intent 解释、slot 更新、候选方向生成、内容生成、校验 |
| 武器库 | 写入、adoption、projection、audit、authority、budget、confirmation |

### 3.6 Execution authority stays outside Planner

Dialogue Planner 可以提出 MicroPlan，但不能批准自己的 MicroPlan。

写入、长跑、高风险、预算敏感、confirmation、production state 变更都必须由 Execution Orchestrator 放行。

### 3.7 Trace and replay are first-class

废弃 Router-first 后，系统不能滑入不可审计黑箱。

每个 turn 必须留下结构化认知帧，每个行动必须留下计划、请求、结果与决策 trace。

---

## 4. 候选方案

### 4.1 方案 A：Router-first v2 延续

```text
User → Router → TurnService / Orchestrator → Executor / LLM
```

继续保留 Router 作为每个 turn 的第一站，只优化 clarification 文案，让缺 slot 的追问更自然。

优点：

- 与 v2 代码最接近。
- 分类、抽槽、缺失字段检测容易单测。
- 迁移成本低。

缺点：

- 没有改变“工作台挡在用户和 LLM 之间”的结构。
- LLM 仍然不是作者可感知的创作伙伴。
- 探索式补槽仍然会被 required slot 心智牵引。
- 容易把 ADR-0010 的 slot schema 误实现成 UI 表单。

结论：不推荐作为 v3 目标。它可以作为 v2 原型证据，但不应继续主导 v3。

### 4.2 方案 B：Dialogue-first + 后台结构化工具

```text
User → Dialogue Planner → Intent / Slot tools → Execution Orchestrator → TurnResult
```

LLM / Dialogue Planner 成为用户前台体验层，原 Router 的分类、抽槽、校验职责退到后台工具。

优点：

- 用户体验方向正确。
- Router 不再挡在用户和 LLM 之间。
- 可以复用 intent registry、slot schema、policy、TurnResult 等契约。

缺点：

- 如果后台工具仍围绕旧 `RouterResult` 组织，容易变成“换皮 Router”。
- 如果没有每 turn 的结构化认知帧，废弃 Router-first 后主链会出现空洞。
- 如果 Planner 直接驱动工具执行，容易进入黑箱 ReAct 风格。

结论：方向正确，但还需要更明确的 v3 主链协议。

### 4.3 方案 C：Agent-native DialogueFrame / MicroPlan 架构（推荐）

```text
User
→ Dialogue Planner
→ DialogueFrame
→ MicroPlan（按需）
→ Execution Orchestrator
→ Capabilities / Tools
→ TurnResult + Trace
```

这是 v3 推荐方案。

核心变化：

1. `Router-first` 拓扑废弃。
2. `Router` 不再作为顶层架构概念出现。
3. 原 Router 职责拆解为后台工具。
4. 每个 turn 必有 `DialogueFrame`。
5. 当需要工具、slot 更新、confirmation 或执行时，`DialogueFrame` 升级出 `MicroPlan`。
6. Execution Orchestrator 审查 MicroPlan，并默认只放行下一步安全动作。
7. 最终对外出口仍是 TurnResult + Trace。

优点：

- 对齐“LLM 是创作伙伴，工作台是工具箱”的最终愿景。
- 保留 contract-first、trace、replay、testing 能力。
- 避免 Router-first 的表单体验。
- 避免裸 Planner 动态调工具造成黑箱。
- 为长跑、checkpoint、adoption、projection 留出统一执行层边界。

结论：推荐作为 v3 目标架构。

---

## 5. 目标拓扑与角色定义

v3 目标拓扑：

```text
作者
→ Dialogue Planner
→ DialogueFrame
→ MicroPlan（按需）
→ Execution Orchestrator
→ Capabilities / Tools
→ TurnResult + Trace
```

角色定义：

| 角色 | v3 定位 |
|---|---|
| 作者 | 只和 LLM 创作伙伴对话，不直接面对 slot 表单或系统内部状态 |
| Dialogue Planner | 作者可见体验层；负责理解、追问、创作引导、候选方向、自然语言回应 |
| DialogueFrame | 每个 turn 必有的轻量结构化认知帧，替代 v2 `RouterResult` 的入口地位 |
| MicroPlan | 当需要工具调用、slot 更新、确认、执行时，从 DialogueFrame 升级出来的小计划 |
| Execution Orchestrator | 系统契约层；负责批准动作、推进状态机、调用能力、权限/预算/确认门禁、TurnResult 出口 |
| Capabilities / Tools | 工作台工具箱：IntentInterpreter、SlotStateUpdater、SlotValidator、MemoryRecall、ContextRead、DraftGenerator、ArtifactValidator 等 |
| Workbench | LLM 和 Orchestrator 背后的装备库、技能库、武器库，不再是用户前台柜员 |

v3 的 Orchestrator 不是单个 Router-first 调度器，而是双层协作：

| 层 | 责任 |
|---|---|
| Dialogue Planner | 管作者可见对话 loop |
| Execution Orchestrator | 管工具执行、状态机、权限、预算、确认、TurnResult |

---

## 6. DialogueFrame

`DialogueFrame` 是每个用户 turn 必须产生的最小结构化解释。

它回答：

```text
这一轮用户输入，在系统看来是什么性质？
```

它不是执行计划，也不是工具调用请求。它为 v3 提供稳定认知入口，避免废弃 Router-first 后主链变成纯自然语言黑箱。

建议最小字段：

| 字段 | 含义 |
|---|---|
| `frame_type` | 本轮类型：闲聊、探索、补槽、确认、纠错、取消、执行候选等 |
| `guidance_mode` | AI 本轮引导方式：`explore` / `structure` / `execute` / `quality` / `clarify` / `confirm` / `none` |
| `dialogue_goal` | 本轮对话目标，如“探索新书定位” |
| `intent_hypothesis` | 可为空；如果能判断，则指向候选 intent |
| `slot_state_delta` | 本轮从用户话语中得到的 slot 草稿增量 |
| `needs_tool` | 是否需要工具或能力介入 |
| `execution_readiness` | `not_applicable` / `not_ready` / `ready_candidate` |
| `author_visible_message` | 给作者看的自然语言回应草案 |

示例：

```json
{
  "frame_type": "exploration",
  "guidance_mode": "explore",
  "dialogue_goal": "explore_work_seed_positioning",
  "intent_hypothesis": "intent.CREATE_WORK_SEED",
  "slot_state_delta": {},
  "needs_tool": true,
  "execution_readiness": "not_ready",
  "author_visible_message": "我们先不用急着定死。我给你几个方向看看哪种更接近。"
}
```

`DialogueFrame` 的关键价值：

- 每轮都有结构化认知入口。
- AI 引导作者的方式可被测试和回放，而不是只体现在文案语气里。
- 闲聊、探索、纠错、取消、确认都能进入同一主链。
- Router-first 被替代后，trace 仍连续。
- 测试可以断言“系统为什么没有执行”。

---

## 7. MicroPlan

`MicroPlan` 只在需要行动时出现。

它回答：

```text
为了推进这一轮，Planner 建议系统下一步做什么？
```

触发条件包括：

- 需要读取上下文或记忆。
- 需要解释 intent。
- 需要更新或校验 slot。
- 需要生成候选方向。
- 需要进入 confirmation。
- 需要调用 capability。
- 需要创建 tentative artifact。
- 需要处理 cancellation / correction。

建议最小字段：

| 字段 | 含义 |
|---|---|
| `plan_goal` | 小计划目标 |
| `proposed_actions` | 建议动作列表，但不代表全部会被自动执行 |
| `required_capabilities` | 涉及哪些工具或 capability |
| `risk_hint` | Planner 对风险/预算的提示 |
| `state_changes_requested` | 请求更新哪些状态，如 slot draft、behavior_state |
| `requires_confirmation` | Planner 是否认为需要确认 |
| `stop_after_next_action` | 默认 true，表示只放行下一步 |

Execution Orchestrator 的默认原则：

```text
Planner 可以提出 MicroPlan，但不能批准自己的 MicroPlan。
Execution Orchestrator 默认只放行下一步安全动作。
写入、长跑、高风险、预算敏感操作必须经过硬门禁。
```

这样可以避免两个极端：

| 极端 | 问题 |
|---|---|
| Planner 想到哪做到哪 | 工具调用不可审计，容易越权 |
| 每轮都提交完整大计划 | 自然对话重新变成流程引擎 |

v3 采用：

```text
每 turn 必有 DialogueFrame；
需要行动时按需升级 MicroPlan；
Orchestrator 只放行当前安全边界内的下一步。
```

---

## 8. Router 概念退出顶层架构

v3 不保留 `Router` 作为顶层节点。

原因不是“路由能力不需要了”，而是 `Router` 这个名字持续暗示：

```text
用户输入 → 先路由 → 再决定是否让 LLM 说话
```

这与 v3 的目标体验相反。

原 v2 Router 职责拆解为后台工具：

| v2 Router 职责 | v3 工具 / Capability |
|---|---|
| classify intent | `IntentInterpreter` |
| extract slots | `SlotStateUpdater` |
| missing required slots | `SlotValidator` |
| decide clarification | `BehaviorPolicyEvaluator` |
| expose route_result | `DialogueFrame.trace` / `decision_trace` |
| fallback unknown | `UncertaintyHandler` / `ClarificationPolicy` |

这些工具必须遵守三条约束：

1. 不能生成作者可见主文案。
2. 不能直接执行能力或写状态。
3. 必须被 trace 记录。

工具箱分层：

| 层 | 工具类型 | 例子 |
|---|---|---|
| 认知工具 | 理解用户和状态 | `IntentInterpreter`, `SlotStateUpdater`, `UncertaintyHandler` |
| 记忆工具 | 读上下文和历史 | `ContextReader`, `MemoryRecall`, `ObjectLookup` |
| 策略工具 | 判断是否允许推进 | `SlotValidator`, `BehaviorPolicyEvaluator`, `AuthorityChecker`, `BudgetEstimator` |
| 创作工具 | 生成内容或候选 | `CandidateDirectionGenerator`, `DraftGenerator`, `OutlineGenerator` |
| 产物工具 | 校验、采纳、投影 | `ArtifactValidator`, `AdoptionBoundary`, `ProjectionRefresher` |

核心结论：

```text
Workbench 是工具箱，不是用户前台流程。
Dialogue Planner 决定“需要拿什么工具”。
Execution Orchestrator 决定“是否允许拿、怎么拿、拿完如何留痕”。
```

---

## 9. Clarification / Confirmation 的 v3 表达

v3 不废弃 clarification / confirmation，但改变它们的触发位置和作者可见形态。

v2 Router-first 常见链路：

```text
Router 发现 blocking_slots 缺失
→ TurnService 生成 clarification
→ 作者看到“还需要补充字段”
```

v3 链路：

```text
Dialogue Planner 理解用户处于什么创作状态
→ DialogueFrame 标记 frame_type = exploration / slot_filling / uncertainty
→ 必要时 MicroPlan 请求 SlotValidator / BehaviorPolicyEvaluator
→ Execution Orchestrator 判断是否需要 durable behavior
→ Planner 生成作者可见的自然引导
```

因此：

- `clarification` 仍然是 durable behavior。
- `blocking_slots` 仍然是执行硬门禁。
- 缺 slot 不等于立刻向作者展示字段问题。
- 作者看到的是探索式引导、候选方向、对比方案、追问创作偏好。
- 系统内部仍记录 required_fields、current_parameters、resolution_ref。

建议区分两层：

| 层 | 作用 |
|---|---|
| `DialogueFrame.frame_type` | 本轮对话性质，如探索、补槽、确认、纠错 |
| `behavior_state.active` | durable 行为状态，如 open clarification / confirmation |

不是所有探索式对话都要立即创建 durable clarification。

例如用户说“我想开本新书，但没想好”，这更像 `exploration` frame，可以先生成候选方向。当系统确认某个 intent 已经进入执行候选、且 blocking slot 仍缺失时，才升级为 durable clarification。

Confirmation 规则更硬：

```text
Planner 可以建议 ready_candidate；
Execution Orchestrator 才能判断 READY_TO_EXECUTE；
高风险 / 写入 / 长跑 / 预算敏感动作必须插入 confirmation。
```

---

## 10. 端到端 turn 主链

v3 turn 主链：

```text
1. 作者输入
2. Dialogue Planner 读取最小对话上下文
3. Planner 生成 DialogueFrame
4. 如果 needs_tool=false：
   - Execution Orchestrator 做 envelope 校验
   - 返回 reply-only TurnResult

5. 如果 needs_tool=true：
   - DialogueFrame 升级 MicroPlan
   - Execution Orchestrator 审查 MicroPlan
   - 放行下一步安全 action/tool
   - 工具返回 ToolResult
   - Planner 基于 ToolResult 生成下一版 DialogueFrame / author_visible_message
   - Orchestrator 组装 TurnResult + trace

6. 如果 execution_readiness=ready_candidate：
   - Execution Orchestrator 做 slot/policy/authority/budget 硬校验
   - 低风险可执行 → capability invoke
   - 高风险/写入/长跑 → confirmation
   - 产物先 tentative，不直接 production write
```

示例：作者说“我想开本新书，但还没想好。”

内部应产生：

```text
DialogueFrame:
  frame_type = exploration
  intent_hypothesis = intent.CREATE_WORK_SEED
  slot_state_delta = {}
  needs_tool = true
  execution_readiness = not_ready

MicroPlan:
  plan_goal = explore_work_seed_positioning
  proposed_actions = [generate_candidate_directions]
  state_changes_requested = [record draft intent hypothesis]
```

Execution Orchestrator 放行：

```text
允许生成候选方向
不允许创建作品
不允许进入 confirmation
记录 trace
```

作者看到：

```text
我们先不用急着定死。我给你三个方向看看哪种更接近……
```

当 slot draft 稳定、Planner 提出 `ready_candidate` 后，Execution Orchestrator 才能进入 slot/policy/authority/budget 硬校验。

---

## 11. 测试、审计与可回放

v3 最大风险是：废弃 Router-first 后，系统从“僵硬但可解释”变成“自然但不可解释”。

因此 v3 必须把可审计性放进主链：

```text
每个 turn 必须有 DialogueFrame。
每个行动必须有 MicroPlan 或 ToolRequest。
每个工具返回必须有 ToolResult。
每个 Orchestrator 决策必须有 DecisionTrace。
最终输出必须是 TurnResult。
```

replay 时应看到：

```text
UserInput
→ DialogueFrame：这一轮系统如何理解用户
→ MicroPlan：Planner 想推进什么
→ OrchestratorDecision：批准/拒绝/降级的原因
→ ToolResult：工具实际返回什么
→ TurnResult：对外呈现什么
```

测试目标：

| 测试目标 | 示例 |
|---|---|
| 对话自然性 | “我还没想好”不会机械要求填写三个字段 |
| 契约稳定性 | 每个 turn 都有合法 DialogueFrame |
| 工具边界 | Planner 不能直接调用写入 capability |
| slot 安全 | `ready_candidate` 必须通过 SlotValidator |
| confirmation 门禁 | 高风险 / 长跑 / 写入动作必须被 Orchestrator 拦截 |
| trace 完整 | 每个 tool/action 都能回放输入输出和采纳状态 |
| TurnResult 合法 | 最终输出仍满足 canonical schema |

示例 golden tests：

```text
用户：开本新书，但没想好
期望：
- frame_type = exploration
- intent_hypothesis = intent.CREATE_WORK_SEED
- execution_readiness = not_ready
- 不调用 create capability
- assistant_message 是探索式引导
```

```text
用户：就按第二个方向创建
前提：slot draft 已齐
期望：
- frame_type = execution_candidate
- MicroPlan 请求 validate_slots + authority_check
- Orchestrator 可进入 confirmation 或 tentative create
- Planner 不能直接写 production
```

---

## 12. v3 文档落地与后续 ADR

`docs/design-v3/` 是独立文档体系，不继承 v2 编号。

建议 v3 文档骨架：

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

本文是 `01`，负责确立交互模型和目标拓扑。当前已拆出或后续需要补齐：

| 后续文档 / ADR | 主题 |
|---|---|
| `00-vision-and-engineering-roadmap.md` | v3 愿景、阶段门槛和工程推进方式 |
| `00a-reading-map.md` | 按角色阅读入口 |
| `00b-end-to-end-dialogue-flow.md` | 一次 turn 的动态主链 |
| `00c-state-and-contract-atlas.md` | 状态、contract、ADR 候选和 slice 入口索引 |
| `00d-runtime-architecture.md` | 控制面、数据面、横切层运行时架构 |
| `02-dialogue-frame-and-micro-plan.md` | DialogueFrame / MicroPlan schema 与状态 |
| `03-capability-toolbox-contract.md` | capability/tool contract 与 registry |
| `04-execution-orchestrator.md` | Execution Orchestrator 边界、状态机、门禁 |
| `05-turn-behavior-and-state-model.md` | clarification / confirmation / correction 等行为 |
| `06-memory-context-and-trace.md` | context assembly、memory、decision trace、replay |
| `07-workbench-ui-contract.md` | 前端如何消费 TurnResult、ui_cards、available actions、trace summary |

迁移策略：

| 层面 | 策略 |
|---|---|
| 分支 | 从 v2 签出 `v3` 分支进行大改 |
| 文档 | `docs/design-v3/` 独立成套，不在 v2 文档内打补丁 |
| 代码 | VS-00 到 VS-06（含 VS-00A、VS-00B、VS-02A）首批文档输入已齐备；VS-00D 后置 contract reconciliation 已 docs-ready；只有用户明确批准后，才进入 implementation plan 或代码实现 |
| 命名 | 不再以 `Router` 命名顶层模块；引入 `DialoguePlanner`, `ExecutionOrchestrator`, `DialogueFrame`, `MicroPlan` |
| 旧实现 | 作为 v2 原型和对照，不作为 v3 兼容约束 |
| ADR | 首批 ADR-0001 至 ADR-0017 已按 slice 需要进入 Accepted |

本文不是“给现有 Router 加自然语言追问”的设计。

本文是 v3 架构重画：先定义最终愿景，再用文档和 ADR 固化承重垂直切面；实现阶段仍等待用户明确批准。
