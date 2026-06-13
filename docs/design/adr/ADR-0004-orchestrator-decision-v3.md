# ADR-0004：OrchestratorDecision v3

- 状态：Accepted
- 日期：2026-05-07
- 来源文档：
  - `../00b-end-to-end-dialogue-flow.md` §5-7
  - `../00c-state-and-contract-atlas.md` §4 / §5.3 / §6.3 / §7 / §8 / §9 / §11
  - `../03-capability-toolbox-contract.md` §3 / §7 / §10
  - `../04-execution-orchestrator.md` §1-5 / §7-14 / §17-18
  - `../05-turn-behavior-and-state-model.md` §9
  - `../06-memory-context-and-trace.md` §5-7
  - `../07-workbench-ui-contract.md` §3-5
  - `../contracts/VS-01-execution-authority-contract-pack.md`
  - `ADR-0001-dialogue-frame-v3.md`
  - `ADR-0002-micro-plan-v3.md`
  - `ADR-0003-planner-authority-boundary.md`
- 影响范围：Execution / Toolbox / Behavior / TurnResult / Trace / UI / Umbrella / Slice
- 相关不变量：`00c` §7 #2、#3、#4、#5、#6、#7、#9、#10、#12、#14、#15
- 首个证明 slice：`tasks/slices/v3/VS-01-micro-plan-downgrade-confirmation.md`
- 取代：无
- 取代者：无

> Accepted 范围：冻结 `OrchestratorDecision` 是执行裁决 envelope 和下游事实来源，且 VS-01 至少能表达 downgrade / confirmation / clarification / reject / recovery。本文不授权代码实现；代码实现仍需用户明确开始。

---

## 背景

ADR-0001 决定每个 turn 必有 `DialogueFrame`。
ADR-0002 决定 `MicroPlan` 是 Planner 的下一步行动建议 envelope。
ADR-0003 决定 Planner 只有建议权，没有执行批准权。

这三条共同留下一个必须冻结的承接点：

```text
Planner 的建议被系统审查之后，结果到底以什么 contract 表达？
```

如果没有 `OrchestratorDecision`，v3 的执行权会散落到多个地方：

1. Toolbox 根据 `MicroPlan.required_capabilities` 直接派发工具。
2. TurnResult Builder 根据 Planner 文案宣称动作已经完成。
3. BehaviorState 根据 UI 或 slot 缺失自行 open / close。
4. Trace 只能记录“发生了什么”，无法解释“为什么允许或不允许”。
5. confirmation、adoption、budget、authority 在实现中变成分散的 if/else。

`OrchestratorDecision` 解决的是这个根问题：

```text
每个执行、等待、降级、拒绝和恢复路径，都必须有一个结构化裁决记录作为事实来源。
```

它不是 gate 顺序本身，也不是工具调用结果，更不是 TurnResult 的 UI 展示结构。它是 v3 主链中承接 `DialogueFrame` / `MicroPlan` 后的执行裁决 contract。

一句话：

```text
DialogueFrame 负责理解；
MicroPlan 负责建议；
OrchestratorDecision 负责裁决；
ToolRequest、BehaviorState、TurnResult 和 DecisionTrace 都必须能追溯到裁决。
```

---

## 决策范围

本 ADR 决定以下内容：

1. `OrchestratorDecision` 是 Execution Orchestrator 对一个 turn 的结构化裁决记录。
2. 每个非纯 Planner draft 的系统输出都必须能追溯到一个 `OrchestratorDecision`，包括 reply-only 输出。
3. `OrchestratorDecision` 必须引用来源 `DialogueFrame`，并在存在 `MicroPlan` 时引用来源 plan。
4. `OrchestratorDecision` 明确表达裁决类型、生命周期状态、被批准动作、被拒绝动作、需要作者动作、状态变化、ToolRequest provenance、TurnResult policy 和 trace 引用。
5. `ToolRequest`、durable `BehaviorState` open / close、state adoption、UI `AvailableAction`、TurnResult factual claim 都必须从 decision 或后续 canonical builder 派生。
6. `OrchestratorDecision` 必须能记录 Planner 建议和最终裁决之间的差异。
7. `OrchestratorDecision` 默认最多批准一个下一步写入或高风险动作；只读 batch 语义保留但不作为 MVP 默认。
8. 错误、拒绝、降级、等待作者、幂等复用都必须表达为 decision 或 decision replay，而不是无结构异常。

本 ADR 同时冻结 `OrchestratorDecision` 的最小语义组：

| 语义组 | 要求 |
|---|---|
| identity | decision 可被 ToolRequest、BehaviorState、TurnResult、DecisionTrace 引用 |
| turn binding | decision 绑定当前 turn |
| frame binding | decision 必须引用来源 DialogueFrame |
| plan binding | 有 MicroPlan 时必须引用来源 plan |
| decision type | 明确是回复、批准、确认、澄清、降级、拒绝、取消或恢复 |
| lifecycle status | 明确 decision 在 received / validated / gated / decided / dispatching / integrating / emitted / failed 中的位置 |
| action outcome | 区分 approved / rejected / downgraded / deferred actions |
| author action | 说明是否需要作者澄清、确认、选择、取消、重试或修改 |
| tool provenance | ToolRequest 必须引用 decision；decision 必须记录被批准派发的请求 |
| state transition | 记录本轮采纳的状态变化或等待态变化 |
| TurnResult policy | 指导 TurnResult 如何诚实表达结果 |
| reason codes | 机器可读、可测试的裁决原因 |
| visible reason | 可选的作者可见简短原因 |
| traceability | decision 必须进入 DecisionTrace |

---

## 非目标

本 ADR 不冻结：

1. Execution gate 的完整顺序和每个 gate 的失败映射。
2. `OrchestratorDecision` 的最终 JSON Schema 字段全集。
3. `decision_type` / `decision_status` 的最终枚举全集。
4. `reason_codes` 的最终编码表。
5. `ToolRequest` / `ToolResult` schema。
6. `BehaviorState` lifecycle schema。
7. TurnPhase / TurnStatus / NextAction 兼容矩阵。
8. TurnResultViewModel 或 UI card 字段结构。
9. DecisionTrace 存储格式和 redaction 层级。
10. persistence schema、数据库表或索引。
11. Execution Orchestrator 的最终模块名和函数名。
12. LLM prompt、provider structured output 或工具实现细节。

这些内容由 ADR-0005 及后续 Batch B / Batch C ADR、schema 草案和垂直切面证明承接。

---

## 考虑过的方案

### 方案 A：不设独立 decision，由 TurnResult 表达裁决

Execution Orchestrator 直接输出 TurnResult，TurnResult 中包含状态、动作、工具结果和作者可见文案。

- 优点：对象少，早期 UI roundtrip 更快。
- 缺点：TurnResult 会同时承担内部裁决、外部展示和 replay 事实；UI contract 会反向约束执行层；工具派发和状态采纳缺少稳定 provenance。

### 方案 B：把 decision 拆成多个 gate result

每个 gate 输出自己的结果，例如 authority decision、budget decision、policy decision、adoption decision，最终由 TurnResult Builder 拼装。

- 优点：每个 gate 边界清晰，便于单测。
- 缺点：缺少一个本轮裁决的 canonical 聚合点；gate 之间的取舍和降级原因难以解释；ToolRequest、BehaviorState、TurnResult 不知道应该引用哪个事实来源。

### 方案 C：把 OrchestratorDecision 设计成本轮执行裁决 envelope

Execution Orchestrator 对 `DialogueFrame` 和可选 `MicroPlan` 形成一个结构化 decision。它聚合 gate 结果的结论，但不吞掉 gate trace；它批准、拒绝、降级、确认、澄清、取消或恢复，并成为 ToolRequest、BehaviorState、TurnResult 和 DecisionTrace 的上游事实。

- 优点：执行权来源唯一；trace/replay 有稳定节点；UI 不需要理解 PlannerOutput；ToolRequest 和状态推进 provenance 清楚。
- 缺点：需要明确 decision 与 gate trace、TurnResult、ToolResult、BehaviorState 的边界；早期实现多一个 contract。

### 方案 D：让 MicroPlan 进入状态机并携带裁决状态

MicroPlan 自身从 proposed 变成 approved / dispatching / completed / failed，Orchestrator 只是更新 plan 状态。

- 优点：对象数量少，计划生命周期表面完整。
- 缺点：Planner 的建议对象会被提升成执行事实；ADR-0002 对 MicroPlan 的收缩被破坏；ToolRequest 和 state adoption 容易回流到 Planner contract。

---

## 最终决策

采用 **方案 C：把 OrchestratorDecision 设计成本轮执行裁决 envelope**。

具体决策：

1. 每个 turn 在系统对外形成 TurnResult 前，必须产生一个 `OrchestratorDecision` 或复用一个已完成的幂等 decision。
2. reply-only turn 也产生 `decision_type=reply_only` 或等价语义，用来解释为什么没有工具、行为或写入。
3. `OrchestratorDecision.frame_ref` 必须引用 ADR-0001 定义的 primary `DialogueFrame`。
4. 当存在 `MicroPlan` 时，`OrchestratorDecision.plan_ref` 必须引用 ADR-0002 定义的 primary `MicroPlan`。
5. `decision_type` 至少需要覆盖以下语义族：

| 类型族 | 含义 |
|---|---|
| `reply_only` | 本轮只回复，不调用工具、不推进 durable behavior、不写状态 |
| `allow_next_action` | 批准一个下一步动作或工具请求 |
| `allow_bounded_read_batch` | 批准一组同门禁、只读、低风险的工具请求 |
| `require_clarification` | 必须让作者补足目标、范围或关键 slot |
| `require_confirmation` | 可以推进但必须先得到作者明确确认 |
| `downgrade_to_dialogue` | plan 过宽或不安全，降级为自然对话 |
| `reject` | 违反权限、策略或不可恢复约束 |
| `cancel_or_close` | 关闭等待态、取消 pending action 或处理 cancellation |
| `fail_with_recovery` | schema、工具、并发、预算或状态冲突失败，并提供恢复路径 |

6. `decision_status` 至少需要覆盖以下生命周期语义：

| 状态族 | 含义 |
|---|---|
| `received` | Orchestrator 收到输入 |
| `validated` | frame / plan / envelope 引用合法 |
| `gated` | 关键 gate 已审查并记录 |
| `decided` | 已形成裁决结论 |
| `dispatching` | 已开始派发被批准的 ToolRequest |
| `integrating` | 正在集成 ToolResult 或状态变化 |
| `emitted` | TurnResult 已形成 |
| `failed` | 失败并已形成恢复路径或内部失败记录 |

7. `approved_actions` 只表达 Orchestrator 批准的动作，不表达 Planner 建议全集。
8. `rejected_actions` / `downgraded_actions` 必须能说明哪些 Planner 建议没有被照做。
9. `required_author_action` 只能由 decision 或 canonical builder 派生；UI 不能从 MicroPlan 直接生成 action。
10. `tool_requests` 只能包含被 decision 批准或派生的 ToolRequest 引用。
11. `state_transitions` 只能包含 Orchestrator 采纳的状态变化；MicroPlan 和 ToolResult 的候选变化必须先经过 decision。
12. `turn_result_policy` 必须防止 TurnResult 宣称未发生事实。
13. `reason_codes` 必须机器可读，并能被测试断言。
14. `author_visible_reason` 可选，且必须经过 redaction / truthfulness 约束。
15. `decision_trace_ref` 必须存在，或在失败恢复路径中明确说明 trace 写入失败如何阻断生产写入。

### 对 `04` 草案的收缩

`04-execution-orchestrator.md` 中列出的 decision envelope 和 lifecycle 是本 ADR 的主要来源。

本 ADR 对其做两点收缩：

```text
ADR-0004 冻结 decision 的最小语义和事实来源地位；
ADR-0005 冻结 gate 顺序和 gate 失败映射。
```

因此，本 ADR 不把 Correlation、Envelope、Behavior、Action Scope、Authority、Policy、Budget 等 gate 顺序提升为已冻结细节，只要求 decision 能承载 gate 结论、reason code 和 trace 引用。

---

## 决策理由

选择方案 C 的原因：

1. **保护执行权唯一性**：Planner 不执行，Toolbox 不自批，UI 不发明 action，所有行动事实都回到 decision。
2. **支撑 ToolRequest provenance**：每个工具调用都能说明来自哪个 frame、plan 和 decision。
3. **支撑 TurnResult truthfulness**：TurnResult 只表达 decision 已允许、已等待、已拒绝、已降级或已恢复的事实。
4. **支撑 durable behavior**：clarification、confirmation、cancellation、recovery 都有 opening / closing decision。
5. **支撑 trace/replay**：系统能解释“Planner 建议了什么、Orchestrator 裁决了什么、为什么差异存在”。
6. **保持 ADR 边界可控**：decision 先冻结裁决表达，gate order 留给 ADR-0005，避免一个 ADR 过宽。
7. **保护垂直切面**：VS-01 可以先证明多步或高风险 plan 被降级或确认，不需要立即实现全部工具和 UI。

拒绝方案 A，是因为它让外部展示 contract 吞掉内部裁决事实。
拒绝方案 B，是因为它缺少本轮裁决的 canonical 聚合点。
拒绝方案 D，是因为它让 MicroPlan 回到可执行计划，破坏 ADR-0002 和 ADR-0003。

---

## Contract 影响

### 新增 contract

`OrchestratorDecision` 成为 v3 主链一等 contract。

最小语义组：

| 语义组 | 说明 |
|---|---|
| identity | decision 可被下游对象引用 |
| turn binding | decision 绑定当前 turn |
| frame binding | decision 必须引用来源 DialogueFrame |
| plan binding | 有 plan 时必须引用来源 MicroPlan |
| decision type | 裁决类型表达系统下一步边界 |
| decision status | 生命周期状态表达裁决进度 |
| action outcomes | 记录批准、拒绝、降级、等待和恢复 |
| author action | 记录需要作者做什么 |
| tool provenance | ToolRequest 必须由 decision 派生或批准 |
| state transitions | 记录被采纳的状态变化和 behavior lifecycle 变化 |
| turn result policy | 约束 TurnResult 的事实表达 |
| reason codes | 支撑测试、trace 和 replay |
| trace link | decision 必须进入 DecisionTrace |

### 下游派生关系

| 下游对象 | 与 decision 的关系 |
|---|---|
| `ToolRequest` | 必须引用 approving decision，不能来自 Planner 或 UI |
| `ToolResult` | 必须能追溯 approving decision；结果不自动成为生产事实 |
| `BehaviorState` | open / close / resolution 必须引用 decision |
| `TurnResult` | 必须忠实表达 decision，不能绕过 decision 宣称事实 |
| `AvailableAction` | 必须由 decision / TurnResult Builder 派生 |
| `DecisionTrace` | 必须记录 decision、gate summary、plan-vs-decision 差异 |
| `ReplayReport` | 默认使用 recorded decision，不重新调用 LLM 判断 |

### 禁止语义

`OrchestratorDecision` 不应包含：

- raw private reasoning
- provider raw response
- UI local component state
- unvalidated PlannerOutput
- unapproved ToolRequest
- unadopted ToolResult as production fact
- persistence implementation detail
- frontend-only action state

### 后续 ADR 依赖

| 后续 ADR | 依赖方式 |
|---|---|
| ADR-0005 Execution Gate Order v3 | 冻结 decision 形成前的 gate 顺序和失败映射 |
| ADR-0006 TurnPhase / TurnStatus v3 | 将 decision 映射为 UI 可见 phase/status |
| ADR-0007 NextAction / AvailableAction v3 | 从 required_author_action 派生 UI 可提交动作 |
| ADR-0008 BehaviorState v3 | behavior lifecycle 必须引用 decision |
| ADR-0009 Confirmation Binding v3 | confirmation answer 必须绑定 decision target 并重新 gate |
| ADR-0010 State Adoption Boundary v3 | state adoption 必须来自 decision |
| ADR-0012 ToolRequest / ToolResult v3 | ToolRequest provenance 必须引用 decision |
| ADR-0013 DecisionTrace v3 | trace 必须记录 decision 节点和差异 |
| ADR-0015 TurnResultViewModel v3 | UI 只消费 decision 后的 view model |

---

## Umbrella 边界影响

本文不冻结最终模块名，但冻结依赖方向上的责任边界。

| App | OrchestratorDecision 边界 |
|---|---|
| `novel_foundation` | 可承接通用 id、Result/Error、validation helper；不承接业务 gate 或执行编排 |
| `novel_domain` | 可承接纯领域规则或纯状态 transition 校验；不调用 Planner、Toolbox、Repo 或 provider |
| `novel_agent` | 可承接 Planner runtime 和工具 runtime；不能生成最终 decision，不能引用 `NovelDomain` / `NovelApplication` |
| `novel_application` | 负责 OrchestratorInput assembly、decision 形成、ToolRequest approval、TurnResult assembly、trace coordination |
| `novel_persistence` | 只能存储 application 已决定记录的 decision / trace / state；不参与裁决 |
| `novel_web` | 只暴露 TurnResult / action ingestion；不直接调用 Planner、Toolbox 或 Repo 来绕过 decision |
| `frontend` | 只消费 TurnResultViewModel / available actions / trace summary；不读取 MicroPlan 或生成 decision |

首个证明 slice 不需要一次冻结所有模块归属，但必须证明：

1. `novel_web` 不拥有执行权。
2. `novel_agent` 不把 Planner 输出直接变成 ToolRequest。
3. `novel_application` 是 decision 形成和 TurnResult 组装的边界。
4. persistence 不反向决定业务裁决。

---

## UI / Trace / Replay 影响

### UI

UI 可以看到：

- assistant_message
- ui_cards
- available_actions
- phase / status / next_action
- trace_summary 中经过脱敏的 decision summary
- author_visible_reason

UI 不可以：

- 读取 `OrchestratorDecision` raw schema 作为主渲染 contract
- 根据 MicroPlan 自行生成 confirmation / clarification / retry action
- 把 `allow_next_action` 理解为多步工作流全部完成
- 把 `ToolResult` 展示为 production fact，除非 decision / TurnResult 已采纳
- 本地覆盖 decision 或 behavior lifecycle

### Trace

DecisionTrace 必须记录：

- decision identity
- source frame
- source plan（如有）
- decision_type / decision_status
- approved / rejected / downgraded action summary
- required_author_action（如有）
- tool request refs（如有）
- state transition refs（如有）
- gate summary / reason codes
- Planner 建议和 Orchestrator 裁决的差异
- author-visible summary 的 redaction 层级

Trace 不应记录 raw private reasoning。

### Replay

Replay 至少能回答：

```text
这个 decision 来自哪个 DialogueFrame？
它审查了哪个 MicroPlan？
Planner 建议了什么？
Orchestrator 批准、拒绝、降级、确认、澄清、取消或恢复了什么？
ToolRequest、BehaviorState、TurnResult 为什么可以从这个 decision 派生？
```

Replay 默认不重新调用 LLM，也不重新让 Planner 解释当时的建议。

---

## 垂直切面证明

首个证明 slice：`00c` §9.2 VS-01 MicroPlan 被 Orchestrator 降级或要求确认。

该 slice 应证明：

| 问题 | 回答 |
|---|---|
| Contract | `PlannerOutput Boundary`、`DialogueFrame`、`MicroPlan`、`OrchestratorDecision`、`TurnResult`、`DecisionTrace` |
| Invariant | Planner 不能批准执行；Orchestrator 是执行权唯一门禁；默认只放行下一步；TurnResult 不能说假话 |
| Boundary | 切过 agent draft / application validation / orchestrator decision / trace；不碰 production write；不让 web 或 frontend 直接执行 |
| Consumer | Orchestrator contract test、TurnResult Builder 或 Toolbox dispatch boundary test |
| Proof | 多步或高风险 MicroPlan 产生 `downgrade_to_dialogue` 或 `require_confirmation` decision，并在 TurnResult / trace 中解释差异 |

建议测试方向：

1. reply-only turn 产生 `reply_only` decision，trace 能解释没有工具调用。
2. `MicroPlan` 中出现多个写入或长跑动作时，只能批准一个安全下一步或降级。
3. 高风险写入建议产生 `require_confirmation`，不会生成 ToolRequest。
4. Planner 输出 `requires_confirmation_hint=false` 时，decision 仍可要求 confirmation。
5. Planner 输出越权语义时，decision 产生 `fail_with_recovery` 或 validation failure trace。
6. ToolRequest 必须引用 decision；没有 decision_ref 的 ToolRequest 不会 dispatch。
7. TurnResult 不会把 `downgrade_to_dialogue` 写成已执行。
8. DecisionTrace 记录 approved / rejected / downgraded actions 与 reason codes。

---

## 迁移与兼容

v3 不继承 v2 Router-first 执行拓扑，也不把 v2 handler 结果直接升级为 `OrchestratorDecision`。

可保留的 v2 原则：

- TurnResult 是 UI canonical 出口。
- confirmation / clarification / adoption 需要可测试状态。
- authority / budget / policy 不应藏在工具实现里。
- trace / replay 需要稳定引用。

需要废弃或重解释的 v2 资产：

| v2 资产 | v3 处理 |
|---|---|
| RouterResult next step | 不能作为 decision；只能作为迁移材料 |
| handler 执行结果 | 必须拆成 Planner 建议 + OrchestratorDecision + ToolResult / TurnResult |
| intent complete 即执行 | 必须重新经过 decision 和 gate |
| frontend action 直接触发工具 | 必须回到主链产生新的 decision |
| ToolResult 直接拼接回复 | 必须经过 decision integration 和 TurnResult truthfulness |

迁移时不能把旧 handler 的 `execute_result`、`completed`、`confirmed` 字段改名为 `OrchestratorDecision` 后继续直接写状态。

---

## 后续工作

1. 评审 `tasks/slices/v3/DAG.md`，确认 VS-00 / VS-00A / VS-00B / VS-01 / VS-02 / VS-02A / VS-03 / VS-04 / VS-05 / VS-06 等切面排序合理。
2. 后续 schema 草案中补 `OrchestratorDecision` 字段全集、reason code registry 和 validation error code。
3. `../contracts/VS-01-execution-authority-contract-pack.md` 已补齐 VS-01 所需的 `OrchestratorDecision` 最小 schema、decision subset 和 TurnResult truthfulness mapping。
4. `tasks/slices/v3/VS-01-micro-plan-downgrade-confirmation.md` 已关闭 VS-01 文档 blocker。
5. 后续 schema 草案中补 `OrchestratorDecision` 字段全集、reason code registry 和 validation error code。
6. 用户明确批准进入代码后，再为 VS-01 创建 implementation plan / contract test：decision 降级 / confirmation，再进入 ToolRequest 闭环。
7. 后续 ADR-0008 / ADR-0009 冻结 behavior lifecycle 与 confirmation binding 如何引用 decision。
8. 后续 ADR-0013 冻结 DecisionTrace 如何记录 decision、gate summary 和 redaction。
