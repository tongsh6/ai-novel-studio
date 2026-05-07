# ADR-0003：Planner Authority Boundary

- 状态：Proposed
- 日期：2026-05-07
- 来源文档：
  - `../00b-end-to-end-dialogue-flow.md` §3-5
  - `../00c-state-and-contract-atlas.md` §4 / §6 / §7 / §8 / §9 / §10 / §11
  - `../02-dialogue-frame-and-micro-plan.md` §1 / §2 / §3 / §5 / §8 / §9
  - `../04-execution-orchestrator.md` §1-9
  - `ADR-0001-dialogue-frame-v3.md`
  - `ADR-0002-micro-plan-v3.md`
- 影响范围：Dialogue / Execution / Toolbox / Behavior / Trace / UI / Umbrella / Slice
- 相关不变量：`00c` §7 #2、#3、#4、#5、#6、#7、#9、#10、#12
- 首个证明 slice：`00c` §9.2 VS-01 MicroPlan 被 Orchestrator 降级或要求确认
- 取代：无
- 取代者：无

---

## 背景

ADR-0001 决定每个 turn 必有 `DialogueFrame`。
ADR-0002 决定 `MicroPlan` 是 Planner 的下一步行动建议 envelope。

这两条仍然没有完全消除一个关键风险：

```text
实现时把 Planner 的建议当成系统批准。
```

如果这个边界不冻结，v3 会很容易滑回以下形态：

1. Planner 输出 `ready_candidate`，调用层就认为可以执行。
2. Planner 输出 `requires_confirmation_hint=false`，系统就跳过 confirmation。
3. Planner 生成 `state_changes_requested`，应用层就把它当成已采纳状态。
4. Planner 提到某个 capability，工具层就直接派发 ToolRequest。
5. Planner 生成作者可见文案，TurnResult 就宣称动作已经完成。

这些问题的共同点是：LLM 的理解和建议被误用成系统事实。

v3 的目标不是削弱 Planner，而是给 Planner 一个清晰、强大的位置：

```text
Planner 负责理解、建议、解释和创作协作；
Planner 不负责批准、派发、采纳、等待态推进或事实宣告。
```

---

## 决策范围

本 ADR 决定以下内容：

1. Dialogue Planner 的权限边界。
2. Planner 可以输出哪些对象和语义。
3. Planner 明确不能输出哪些授权、事实和状态推进语义。
4. Execution Orchestrator 必须重新裁决所有来自 Planner 的行动建议。
5. UI、Toolbox、Persistence、Domain 不能直接消费 Planner 输出作为执行事实。
6. Planner 输出必须通过 envelope / semantic validation 才能进入 OrchestratorInput。
7. Planner 与 Orchestrator 的差异必须进入 DecisionTrace。

本 ADR 冻结的是边界规则，不冻结最终模块名、函数名、schema 字段全集或 provider prompt。

---

## 非目标

本 ADR 不冻结：

1. Planner runtime 的具体模块归属。
2. LLM prompt 模板或 provider structured output 格式。
3. `DialogueFrame` / `MicroPlan` 最终 JSON Schema。
4. `OrchestratorDecision` schema。
5. Execution gate 顺序。
6. ToolRequest / ToolResult schema。
7. BehaviorState lifecycle schema。
8. TurnResultViewModel 或 UI action schema。
9. persistence schema、数据库表或索引。
10. 具体测试文件路径。

这些内容由后续 ADR、schema 草案和垂直切面实现阶段承接。

---

## 考虑过的方案

### 方案 A：信任 Planner 的结构化输出

只要 Planner 输出符合 schema，系统就按 plan 执行；Orchestrator 只做技术校验和工具派发。

- 优点：链路短，demo 容易跑通，LLM 可以一次性完成理解和行动。
- 缺点：Planner 实际拥有执行权；authority、budget、confirmation、adoption、trace 都会被弱化；schema 合法会被误认为行为安全。

### 方案 B：Planner 只允许自然语言，不输出结构化建议

Planner 只负责对作者说话，所有 intent、slot、action、tool、state 都由传统服务或规则系统决定。

- 优点：执行边界非常硬，LLM 不容易越权。
- 缺点：系统退回 Router-first / service-first；LLM 创作伙伴能力被降级；DialogueFrame 与 MicroPlan 失去意义，v3 目标被削弱。

### 方案 C：Planner 输出结构化 frame / plan，但权限矩阵硬隔离

Planner 可以输出 `DialogueFrame`、`MicroPlan`、作者可见回应草案和解释材料。所有执行批准、ToolRequest、state adoption、BehaviorState open/close、AvailableAction、TurnResult fact 都只能由 Execution Orchestrator 或后续 canonical builder 产生。

- 优点：保留 LLM 的理解和协作能力，同时让执行边界可测试、可回放、可审计。
- 缺点：需要额外的 validation、adapter 和 trace discipline；初期文档和测试工作更多。

### 方案 D：按风险等级允许 Planner 自动执行低风险动作

低风险 read、候选生成、memory recall 可以由 Planner 自动触发；高风险和写入动作才交给 Orchestrator。

- 优点：低风险路径更顺滑，减少 Orchestrator 参与次数。
- 缺点：低风险动作也会消耗预算、影响上下文、生成候选和 trace；风险等级本身需要 gate 判断，不能由 Planner 自己宣布。

---

## 最终决策

采用 **方案 C：Planner 输出结构化 frame / plan，但权限矩阵硬隔离**。

### Planner 可以做

| 能力 | 说明 |
|---|---|
| 生成 `DialogueFrame` draft | 理解作者输入，提出 frame type、goal、uncertainty、visible draft |
| 生成 `MicroPlan` draft | 提出下一步行动建议、候选状态变化、required capabilities、risk / confirmation hint |
| 生成作者可见回应草案 | 为 TurnResult Builder 提供自然语言候选，不直接成为事实输出 |
| 解释建议理由 | 给 trace summary / replay 提供可脱敏的 reason material |
| 基于 ToolResult 生成后续回应草案 | 在 Orchestrator 集成工具结果后，帮助形成自然语言表达 |

### Planner 不可以做

| 禁止能力 | 原因 |
|---|---|
| 批准执行 | 执行权属于 Execution Orchestrator |
| 生成可派发 `ToolRequest` | ToolRequest 必须经 OrchestratorDecision |
| 采纳 `state_changes_requested` | state adoption 必须经过 gate / adoption boundary |
| 打开或关闭 `BehaviorState` | durable behavior 是可回放状态，不是 Planner 草案 |
| 生成 UI `AvailableAction` | UI 只能提交 canonical TurnResult 暴露的 action |
| 宣称生产写入完成 | TurnResult fact 必须来自已采纳状态或 ToolResult 集成 |
| 绕过 confirmation / clarification | 等待态和确认态必须由 Orchestrator 裁决 |
| 自己决定 budget / authority / policy 通过 | 这些是 gate 结果，不是语言判断 |
| 直接调用 persistence / domain write | Planner 不拥有生产写入边界 |

### 必须拦截的语义

任何 Planner 输出中出现以下语义，必须被 validation 拦截、降级或转成 recovery trace：

- `approved`
- `execute_now`
- `ready_to_execute`
- `tool_request_id`
- `tool_dispatched`
- `state_adopted`
- `production_write_allowed`
- `behavior_opened`
- `behavior_closed`
- `available_action`
- `confirmation_satisfied`
- `budget_approved`
- `authority_approved`

这些名字不是最终 schema 黑名单全集，而是冻结语义族：Planner 输出不得表达“系统已经批准、已经派发、已经采纳、已经打开等待态或已经形成 UI 可提交动作”。

---

## 决策理由

选择方案 C 的原因：

1. **对齐 v3 愿景**：LLM 是作者可感知的创作伙伴，而不是被规则系统压扁成自然语言模板。
2. **保护执行权**：Planner 可以强大，但不能成为隐形 executor。
3. **支持垂直切面证明**：VS-01 可以直接测试 Planner 越权字段被拒绝、多步 plan 被降级、高风险建议被确认。
4. **支持 trace/replay**：系统能解释 Planner 建议和 Orchestrator 裁决之间的差异。
5. **保护 UI canonical 出口**：UI 不需要知道 Planner 内部 plan，只消费 TurnResult 和 available actions。
6. **避免低风险例外膨胀**：read、candidate、memory 也必须留下 decision trace，不能由 Planner 自行触发。

拒绝方案 A，是因为 schema 合法不等于行为安全。
拒绝方案 B，是因为它背离 Agent-native 方向。
拒绝方案 D，是因为低风险也需要预算、trace、registry 和 replay 边界。

---

## Contract 影响

### PlannerOutput Boundary

新增一个边界概念：`PlannerOutput Boundary`。

它不是最终 schema 名，而是实现时必须存在的 contract 层。

最小语义：

| 语义组 | 要求 |
|---|---|
| allowed outputs | `DialogueFrame` draft、`MicroPlan` draft、visible response draft、reason material |
| forbidden outputs | approval、dispatch、adoption、behavior fact、UI action、production fact |
| validation | Planner 输出必须做 envelope + semantic validation |
| conversion | 合法 Planner 输出只能被转换为 OrchestratorInput 或 reply-only TurnResult material |
| trace | Planner 建议和 Orchestrator 裁决差异必须进入 trace |

### 对 DialogueFrame 的影响

`DialogueFrame.execution_readiness=ready_candidate` 只能表示：

```text
Planner 认为本轮可能进入执行审查。
```

它不能表示：

```text
系统已经准备执行。
```

### 对 MicroPlan 的影响

`MicroPlan` 仍然是建议 envelope。

`requires_confirmation_hint=false` 只能表示 Planner 没有主动提示确认需要。它不能阻止 Orchestrator 根据 authority、policy、budget、write boundary 要求 confirmation。

`state_changes_requested` 只能进入候选变化集合，不得进入 adopted state。

### 对 OrchestratorDecision 的影响

后续 `ADR-0004-orchestrator-decision-v3.md` 必须保证：

1. decision 记录来源 frame / plan。
2. decision 明确区分 approved / rejected / downgraded / confirmation / clarification。
3. decision 能记录“Planner 建议”和“最终裁决”的差异。
4. ToolRequest、BehaviorState、AvailableAction、state transition 都必须从 decision 或 canonical builder 派生。

---

## Umbrella 边界影响

本文不冻结最终模块名，但冻结依赖方向上的权限边界。

| App | Planner 权限边界 |
|---|---|
| `novel_foundation` | 可承接通用 validation result / error code / id helper；不承接 Planner 业务语义 |
| `novel_domain` | 不引用 Planner，不接收 Planner 直接写入，不把 Planner 输出当 domain fact |
| `novel_agent` | 可承接 Planner runtime、provider gateway、structured draft parsing；不调用 `NovelDomain` / `NovelApplication` |
| `novel_application` | 负责 PlannerOutput validation、OrchestratorInput assembly、TurnResult assembly |
| `novel_persistence` | 不接受 Planner 直接写入；只能存储 application 已决定记录的 trace / draft / decision |
| `novel_web` | 不暴露 PlannerOutput 作为 API contract；只暴露 TurnResult / action ingestion |
| `frontend` | 不读取 PlannerOutput；不把 Planner 建议渲染为可提交 action |

首个证明 slice 不需要一次决定所有模块名，但必须证明 Planner 输出不会越过 application / orchestrator 边界。

---

## UI / Trace / Replay 影响

### UI

UI 可以消费：

- TurnResultViewModel
- assistant_message
- ui_cards
- available_actions
- trace_summary 中经过脱敏的 planner/decision summary

UI 不可以消费：

- PlannerOutput raw schema
- MicroPlan proposed action 作为按钮
- `ready_candidate` 作为“立即执行”
- `requires_confirmation_hint=false` 作为无需确认
- Planner visible draft 作为已完成事实

### Trace

DecisionTrace 必须记录：

- Planner 输出了哪些 frame / plan 摘要。
- Planner 是否提出了风险、确认或 fallback hint。
- 哪些 Planner 建议被 Orchestrator 批准。
- 哪些 Planner 建议被降级、拒绝、要求确认或要求澄清。
- 是否出现越权语义，以及系统如何恢复。

Trace 不记录 raw private reasoning。

### Replay

Replay 至少能回答：

```text
Planner 建议了什么？
这些建议有没有越权？
Orchestrator 为什么没有直接照做？
最终 TurnResult 是否只表达已裁决、已采纳或可安全展示的事实？
```

Replay 默认不重新调用 LLM。

---

## 垂直切面证明

首个证明 slice：`00c` §9.2 VS-01 MicroPlan 被 Orchestrator 降级或要求确认。

该 slice 应证明：

| 问题 | 回答 |
|---|---|
| Contract | `PlannerOutput Boundary`、`DialogueFrame`、`MicroPlan`、`OrchestratorDecision`、`DecisionTrace` |
| Invariant | Planner 不能批准执行；Orchestrator 是执行权唯一门禁；默认只放行下一步 |
| Boundary | 切过 agent draft / application validation / orchestrator decision / trace；不碰 production write |
| Consumer | Orchestrator contract test 或 application-level TurnResult test |
| Proof | 越权 Planner 输出被拒绝或降级；高风险 plan 产生 confirmation；多步 plan 不被全量执行 |

建议测试方向：

1. Planner 输出 `approved=true` 或等价语义时 validation 失败。
2. Planner 输出 `tool_request_id` 或等价语义时不会派发工具。
3. `ready_candidate` 不会绕过 OrchestratorDecision。
4. `requires_confirmation_hint=false` 不会绕过 confirmation gate。
5. `state_changes_requested` 不会成为 production state。
6. DecisionTrace 记录 Planner 建议和 Orchestrator 裁决差异。

---

## 迁移与兼容

v3 不继承 v2 Router-first 执行拓扑。

可保留的 v2 原则：

- 结构化 intent / slot 可以作为 Planner 理解材料。
- action / confirmation / adoption 需要机器可测试 contract。
- TurnResult 是 UI canonical 出口。
- trace / replay 需要稳定引用。

需要废弃或重解释的 v2 资产：

| v2 资产 | v3 处理 |
|---|---|
| Router handler 直接执行 | 改为 Planner 建议 + Orchestrator 裁决 |
| intent match 即可进入 handler | intent 只是 frame / plan 材料，不是执行批准 |
| slot complete 即可执行 | slot complete 仍需 authority / policy / budget / adoption gate |
| frontend action 触发工具 | UI action 必须回到主链重新裁决 |

迁移时不能把旧 handler 的 `execute`、`ready`、`dispatch` 语义搬进 PlannerOutput。

---

## 后续工作

1. 写 `ADR-0004-orchestrator-decision-v3.md`，冻结 OrchestratorDecision 如何表达裁决结果。
2. 写 `ADR-0005-execution-gate-order-v3.md`，冻结 gate 顺序如何落实 Planner 权限边界。
3. 后续 schema 草案中补 `PlannerOutput Boundary` 的 validation error code。
4. 在 `tasks/slices/v3/DAG.md` 中安排 VS-01。
5. 实现前补 contract test：Planner 越权语义被拒绝，Planner 建议和 Orchestrator 裁决差异进入 trace。
