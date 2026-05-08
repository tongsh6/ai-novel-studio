# ADR-0002：MicroPlan v3 语义与最小 Contract

- 状态：Accepted
- 日期：2026-05-07
- 来源文档：
  - `../00b-end-to-end-dialogue-flow.md` §3-5
  - `../00c-state-and-contract-atlas.md` §4 / §6 / §7 / §8 / §9
  - `../02-dialogue-frame-and-micro-plan.md` §1 / §3-5 / §7-10
  - `../04-execution-orchestrator.md` §1 / §3-8
  - `../contracts/VS-01-execution-authority-contract-pack.md`
- 影响范围：Dialogue / Execution / Toolbox / Behavior / Trace / UI / Umbrella / Slice
- 相关不变量：`00c` §7 #2、#3、#4、#5、#6、#8、#12
- 首个证明 slice：`tasks/slices/v3/VS-01-micro-plan-downgrade-confirmation.md`
- 取代：无
- 取代者：无

> Accepted 范围：冻结 `MicroPlan` 只是 Planner 下一步行动建议 envelope、不能授权执行、默认只建议下一步，以及 VS-01 所需最小字段语义。本文不授权代码实现；代码实现仍需用户明确开始。

---

## 背景

ADR-0001 已经把 `DialogueFrame` 提升为每个 turn 必有的结构化认知锚点。

但 `DialogueFrame` 只回答：

```text
系统如何理解这一轮作者输入？
```

它不能直接回答：

```text
为了推进这一轮，Planner 建议系统下一步尝试什么？
```

如果没有 `MicroPlan`，系统会在两个危险方向之间摇摆：

1. 让 `DialogueFrame` 直接携带工具、状态更新、确认和写入建议，导致认知对象膨胀。
2. 让 Execution Orchestrator 直接从自然语言或 frame 字段里猜测下一步，导致执行层重新变成隐性 Router。

`MicroPlan` 的职责是把 Planner 的行动建议结构化出来，同时明确它只是建议，不是授权。

一句话：

```text
DialogueFrame 负责理解；
MicroPlan 负责建议；
Execution Orchestrator 负责裁决。
```

---

## 决策范围

本 ADR 决定以下内容：

1. `MicroPlan` 是 Dialogue Planner 在需要行动推进时提交给 Execution Orchestrator 的行动建议 envelope。
2. `MicroPlan` 必须引用一个已校验的 primary `DialogueFrame`。
3. 一个 primary `DialogueFrame` 在进入 Execution Orchestrator 前最多产生一个 primary `MicroPlan`。
4. `MicroPlan` 只能表达 proposed action、requested state change、required capability、risk / confirmation hint 和 fallback strategy。
5. `MicroPlan` 不包含执行授权，不产生 `ToolRequest`，不采纳状态，不打开或关闭 durable behavior。
6. `MicroPlan` 默认只建议下一步安全动作，不能成为长计划执行器。
7. 多个 proposed actions 可以存在，但它们表示 Planner 的建议序列；Execution Orchestrator 可以批准子集、降级、要求确认、要求澄清、拒绝或失败恢复。
8. `MicroPlan` 必须进入 DecisionTrace，并能解释 Orchestrator 为什么批准、降级、确认、澄清或拒绝。

本 ADR 同时冻结 `MicroPlan` 的最小语义组：

| 语义组 | 要求 |
|---|---|
| identity | plan 可被 decision、trace、replay 引用 |
| turn binding | plan 绑定所属 turn |
| frame binding | plan 必须引用来源 DialogueFrame |
| goal | plan 说明本轮行动目标 |
| proposed actions | plan 列出 Planner 建议动作 |
| requested state changes | plan 只能请求候选状态变化 |
| required capabilities | plan 只能引用已知 capability 或 capability class |
| risk hint | plan 可以提示风险，但不能替代 gate |
| confirmation hint | plan 可以建议确认，但不能打开 confirmation |
| next-step boundary | plan 默认只建议下一步 |
| fallback | plan 可以建议失败或拒绝后的降级方式 |
| traceability | plan 必须可记录、可解释、可回放 |

---

## 非目标

本 ADR 不冻结：

1. `MicroPlan` 的最终 JSON Schema。
2. `proposed_actions` 的完整枚举全集。
3. Capability Registry 的字段、版本和启停规则。
4. `ToolRequest` / `ToolResult` schema。
5. `OrchestratorDecision` schema。
6. Execution gate 顺序。
7. TurnPhase / TurnStatus / NextAction 兼容矩阵。
8. BehaviorState envelope。
9. UI card、AvailableAction 或前端组件结构。
10. persistence schema、数据库表或索引。
11. LLM prompt 格式和 provider 结构化输出格式。

这些内容分别由 ADR-0003 之后的 Batch A、Batch B、Batch C 和后续垂直切面证明承接。

---

## 考虑过的方案

### 方案 A：不要 MicroPlan，由 DialogueFrame 直接进入 Orchestrator

Planner 只输出 `DialogueFrame`。Execution Orchestrator 根据 frame type、slot delta、上下文和 open behavior 自行决定下一步。

- 优点：对象更少，首个 reply-only slice 更容易实现。
- 缺点：Orchestrator 会被迫解释意图和推导行动建议，逐渐变成新的 Router；Planner 的行动意图不可审计；工具、行为和状态推进缺少明确输入 contract。

### 方案 B：把 MicroPlan 设计成可执行计划

Planner 输出一个接近 workflow 的 plan，其中包含工具调用、状态写入、确认逻辑、重试策略和多步执行顺序。

- 优点：demo 推进速度快，LLM 可以一次性给出完整路径。
- 缺点：Planner 实际获得执行权；长计划容易跨越权限、预算、确认和写入边界；Orchestrator 被降级成 plan runner，违背 v3 执行权不变量。

### 方案 C：把 MicroPlan 设计成下一步行动建议 envelope

Planner 只提交结构化行动建议。它可以表达目标、建议动作、候选状态变化、所需 capability 和风险提示，但所有批准、派发、采纳和等待态推进都由 Execution Orchestrator 裁决。

- 优点：保留 Planner 的自然理解能力，同时让执行权独立；适合 trace/replay；能支撑工具、behavior、confirmation、adoption 等后续 slice。
- 缺点：需要清楚定义 plan 与 decision、ToolRequest、BehaviorState 的边界；早期实现会多一个 contract adapter。

### 方案 D：只在高风险或写入动作时生成 MicroPlan

普通 read、候选生成、slot draft 更新不生成 plan，只有写入或高风险动作才生成。

- 优点：低风险 turn 的结构成本更低。
- 缺点：read / candidate / slot draft 同样会影响作者体验和 trace；系统无法解释低风险工具为什么被调用；后续很难统一 replay 和 budget。

---

## 最终决策

采用 **方案 C：把 MicroPlan 设计成下一步行动建议 envelope**。

具体决策：

1. `MicroPlan` 只在 `DialogueFrame` 表示需要工具、状态推进、behavior 推进、确认、澄清、取消、拒绝或执行候选时出现。
2. reply-only turn 没有 `MicroPlan`；如果需要读取 registry、memory、context 或生成候选方向，则不再是纯 reply-only。
3. `MicroPlan.frame_ref` 必须引用 ADR-0001 定义的 primary `DialogueFrame`。
4. `MicroPlan.proposed_actions` 表示建议动作，不表示已批准动作。
5. `MicroPlan.state_changes_requested` 表示候选变化，不表示已采纳状态。
6. `MicroPlan.required_capabilities` 表示建议使用的 capability 或 capability class，不表示已生成 `ToolRequest`。
7. `MicroPlan.requires_confirmation_hint` 只是 Planner 的提示；是否打开 confirmation 由 Execution Orchestrator 决定。
8. `MicroPlan.stop_after_next_action` 或等价语义默认必须为 true。
9. `MicroPlan` 不得包含 `approved`、`execute_now`、`tool_request_id`、`adopted_state`、`production_write_allowed` 等授权或事实语义。
10. `MicroPlan` 的生命周期在 Orchestrator 形成裁决后闭合；后续 ToolRequest、ToolResult、BehaviorState 和 TurnResult 属于 OrchestratorDecision 及下游 trace，而不是 MicroPlan 自身状态。

### 对 `02` 草案的收缩

`02-dialogue-frame-and-micro-plan.md` 早期草案把 `ToolRequested` / `ToolReturned` 放入 MicroPlan 生命周期。

本 ADR 对该语义做收缩：

```text
ToolRequested / ToolReturned 是 MicroPlan 被裁决后的下游 trace 关联，
不是 MicroPlan 自身拥有的生命周期状态。
```

原因是如果 MicroPlan 自身进入工具派发状态，它就容易被实现成执行器或 workflow runner。

---

## 决策理由

选择方案 C 的原因：

1. **对齐 v3 愿景**：Planner 可以像创作伙伴一样理解和建议，但不能越权执行。
2. **保护执行权边界**：Execution Orchestrator 是唯一裁决层，MicroPlan 不批准自己的动作。
3. **保留自然协作空间**：不是所有不确定性都变成表单；MicroPlan 可以建议候选生成、轻量探索或澄清方向。
4. **支撑 trace/replay**：系统能解释“Planner 建议了什么”和“Orchestrator 为什么没有照做”。
5. **避免长计划陷阱**：默认下一步边界能防止 LLM 一次性跨越权限、预算、确认和写入。
6. **给后续 ADR 留边界**：Planner authority、OrchestratorDecision、gate order、ToolRequest、BehaviorState 可以独立冻结。

拒绝方案 A，是因为它让 Orchestrator 重新承担意图解释。
拒绝方案 B，是因为它让 Planner 变成事实执行者。
拒绝方案 D，是因为它让低风险工具和候选生成缺少统一 trace。

---

## Contract 影响

### 新增 contract

`MicroPlan` 成为 v3 主链一等 contract。

最小语义组：

| 语义组 | 说明 |
|---|---|
| identity | plan 可被 decision、trace、replay 引用 |
| turn binding | plan 绑定一个 turn |
| frame binding | plan 引用一个已校验 DialogueFrame |
| goal | plan 说明本轮行动目标 |
| proposed actions | plan 说明 Planner 建议的下一步 |
| requested state changes | plan 只能请求候选变化 |
| required capabilities | plan 指向 capability，而不是直接工具调用事实 |
| risk / confirmation hints | plan 可以提示风险和确认需要 |
| next-step boundary | 默认只建议下一步 |
| fallback | plan 给出被拒绝或失败后的降级建议 |
| traceability | plan 必须进入 DecisionTrace |

### 候选 action 语义

本 ADR 不冻结最终枚举，但冻结 action type 的语义边界。

| 动作族 | 允许表达 | 禁止表达 |
|---|---|---|
| context / memory read | 建议读取上下文、memory、对象摘要 | 声明读取已发生 |
| slot draft | 建议更新 draft 或校验 slot | 声明生产参数已采纳 |
| candidate generation | 建议生成候选方向、对比方案、草案 | 声明候选已被作者采纳 |
| capability invocation | 建议使用某类 capability | 生成 ToolRequest 或绕过 registry |
| tentative artifact | 建议创建 tentative 产物 | 声明已写入 production |
| behavior proposal | 建议澄清、确认、取消或关闭等待态 | 直接 open / close BehaviorState |
| rejection / downgrade | 建议拒绝或降级路径 | 替代 policy / authority gate |

### 禁止语义

`MicroPlan` 禁止包含：

- execution approval
- production write authorization
- adopted state
- final domain fact
- ToolRequest / ToolResult
- durable behavior open / close fact
- UI AvailableAction
- raw private reasoning

### 后续 ADR 依赖

| 后续 ADR | 依赖方式 |
|---|---|
| ADR-0003 Planner Authority Boundary | 把本 ADR 的禁止语义提升为 Planner 权限硬边界 |
| ADR-0004 OrchestratorDecision v3 | decision 必须引用 plan，并记录批准、降级、确认、澄清、拒绝原因 |
| ADR-0005 Execution Gate Order v3 | gate 顺序审查 MicroPlan 的 action scope、risk、capability、write boundary |
| ADR-0008 BehaviorState v3 | behavior 只能由 decision 打开或关闭，不能由 plan 直接打开 |
| ADR-0012 ToolRequest / ToolResult v3 | ToolRequest 必须来自 OrchestratorDecision，不来自 MicroPlan |
| ADR-0013 DecisionTrace v3 | trace 必须记录 plan 节点和 decision 差异 |

---

## Umbrella 边界影响

本文不冻结最终模块归属，但给出边界方向：

| App | 影响 |
|---|---|
| `novel_foundation` | 可承接通用 id、Result/Error、schema validation helpers；不承接 MicroPlan 业务语义 |
| `novel_domain` | 不生成、不解释、不执行 MicroPlan；不依赖 Planner 或 provider |
| `novel_agent` | 可承接 Planner runtime 产出的 plan draft；不引用 `NovelDomain` / `NovelApplication` |
| `novel_application` | 负责校验 plan envelope、组装 OrchestratorInput、连接 TurnResult / trace |
| `novel_persistence` | 后续只负责存储 plan / trace 相关 schema，不参与 plan 裁决 |
| `novel_web` | 不直接接收或提交 MicroPlan；只暴露 TurnResult / action ingestion |
| `frontend` | 不读取 MicroPlan 内部 schema，不把 plan action 当成 UI action |

首个垂直切面可以先通过 application-level contract test 证明，不需要立即落数据库或前端组件。

---

## UI / Trace / Replay 影响

### UI

UI 通常不直接展示 `MicroPlan`。

UI 可以看到：

- assistant_message
- ui_cards
- available_actions
- trace_summary 中经过脱敏的 plan reason summary

UI 不可以：

- 把 MicroPlan proposed action 渲染成可直接提交的按钮
- 根据 MicroPlan 自行打开 confirmation modal
- 把 `requires_confirmation_hint=true` 当作已经进入 confirmation
- 把 `state_changes_requested` 当作已保存事实
- 直接调用 plan 中提到的 capability

### Trace

DecisionTrace 必须记录：

- plan identity
- source frame
- plan goal
- proposed actions summary
- requested state changes summary
- required capabilities summary
- risk / confirmation hints
- Orchestrator 对每个关键建议的裁决差异

Trace 不应记录 raw private reasoning。

### Replay

Replay 至少能回答：

```text
这个 MicroPlan 来自哪个 DialogueFrame？
Planner 建议了什么？
Orchestrator 为什么批准、降级、确认、澄清、拒绝或失败恢复？
最终 TurnResult 是否忠实表达了裁决结果？
```

Replay 默认不重新调用 LLM。

---

## 垂直切面证明

首个证明 slice：`00c` §9.2 VS-01 MicroPlan 被 Orchestrator 降级或要求确认。

该 slice 应证明：

| 问题 | 回答 |
|---|---|
| Contract | `DialogueFrame`、`MicroPlan`、`OrchestratorDecision`、`TurnResult`、`DecisionTrace` |
| Invariant | MicroPlan 只是建议；Orchestrator 是执行权唯一门禁；默认只放行下一步 |
| Boundary | 切过 application / agent plan draft / orchestrator decision / trace；不执行真实写入工具 |
| Consumer | Orchestrator contract test 或 TurnResult Builder |
| Proof | 给出多步或高风险 plan，系统产生 downgrade、confirmation 或 clarification TurnResult |

建议测试方向：

1. `MicroPlan` 必须引用已校验 `DialogueFrame`。
2. `MicroPlan` 中出现授权字段时 envelope 校验失败。
3. 多步 proposed actions 不会被默认全量执行。
4. 高风险或写入类 requested state changes 产生 confirmation 或 downgrade。
5. `requires_confirmation_hint=false` 不能阻止 Orchestrator 要求 confirmation。
6. OrchestratorDecision 和 DecisionTrace 能记录 plan 与 decision 的差异。

---

## 迁移与兼容

v3 不继承 v2 Router-first 拓扑，也不把 v2 intent routing 结果直接升级为 `MicroPlan`。

可保留的 v2 原则：

- action / state 需要机器可测试 contract。
- confirmation / clarification 需要 durable waiting state。
- adoption boundary 必须保护生产写入。
- TurnResult 是 UI canonical 出口。

需要废弃或重解释的 v2 资产：

| v2 资产 | v3 处理 |
|---|---|
| RouterResult next step | 不作为 MicroPlan 来源事实；只能作为迁移参考 |
| intent handler direct execution | 由 Planner 建议 + Orchestrator 裁决替代 |
| slot schema 表单补齐 | 只能作为 slot draft / validation 材料，不能定义作者主流程 |
| tool invocation from handler | ToolRequest 必须经 OrchestratorDecision |

迁移时不能把旧 Router handler 输出改名为 `MicroPlan` 后继续直接执行。

---

## 后续工作

1. `ADR-0003-planner-authority-boundary.md` 已提出 Planner 不能批准执行的硬边界。
2. `ADR-0004-orchestrator-decision-v3.md` 已提出 OrchestratorDecision 如何引用和裁决 MicroPlan。
3. `ADR-0005-execution-gate-order-v3.md` 已提出 gate 顺序如何审查 plan。
4. `../contracts/VS-01-execution-authority-contract-pack.md` 已补齐 VS-01 所需的 `MicroPlan` 最小 schema、action subset 和 proof 草案。
5. `tasks/slices/v3/VS-01-micro-plan-downgrade-confirmation.md` 已关闭 VS-01 文档 blocker。
6. 后续全量 schema 草案再冻结 `MicroPlan` 字段全集和完整 action 枚举。
7. 用户明确批准进入代码后，再为 VS-01 创建 implementation plan / contract test：MicroPlan 不含授权语义，多步 plan 默认不会被全量执行。
