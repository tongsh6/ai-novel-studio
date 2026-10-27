# B49：主链语义收窄与 ADR 评审

- 状态：**评审材料 done（2026-10-27）；裁决待作者（blocked-by-author）**。
- 登记日期：2026-10-27；来源：primary/reply-only/next_action/output contract 的 Accepted 字面与当前实现不同，ADR-0022 的历史语义也已被后续协议改变。
- 上游：ADR-0001/0002/0003/0004/0007/0012/0022/0023/0025、[B27](B27-systematic-prompt-and-intent-integration.md)、[B43](B43-gate-order-residual.md)、[B45](B45-schema-legacy-governance.md)。
- 本任务产物：**评审材料 + 一份新 Proposed ADR + 作者裁决包**，不是实现授权、不是 Accepted 代签。
- 下游承接：[ADR-0031（Proposed）](../../docs/design/adr/ADR-0031-core-chain-semantics-narrowing-v3.md)、B01 Planner 语义、B43 Gate 残余、B45 schema legacy（对账 ID B18）、B12 S7；ADR-0022 状态处置待作者。

> **边界与不变式**
>
> 1. 生产代码 / schema / 验收判据 / 测试断言零改动；本任务只读代码求证。
> 2. 任何 Accepted ADR 的正文与「最终决策」段零改动；偏差痕迹保留在原 ADR 的 `## enforcement_gaps`（B13b 已逐条裁决）。收窄提案写入新 ADR，不改历史。
> 3. 不代作者拍板；每项给选项、推荐、影响与若否决的后续，见 §7。
> 4. 不 git commit / push / checkout / reset / stash；提交由 Lead 执行。
> 5. 写作用域：本文件、`docs/design/adr/`（新 ADR + README 索引）、`docs/design/00c-state-and-contract-atlas.md`（最小登记）。

---

## 1. 需要裁决的不是「补还是重做」

当前实现已经选择了 step frame、reply-only trace、available_actions、creative/typed output 等新载体，但 Accepted 文本仍要求另一组字段或全集。三种坏结局：

- **直接补齐**（A）：为形式完整制造无消费者对象/字段，把契约变成装饰；
- **全部称「文档化偏差」**：掩盖真实越权风险，且 Proposed 的 ADR-0022 永远无法转 Accepted / Superseded，治理状态失真；
- **把当前实现直接当 Accepted**：静默改写历史决策，违反 ADR 维护规则。

本任务先统一四类决策（`primary frame / primary plan 与 reply-only 边界`、`reply-only 是否必须 OrchestratorDecision`、`无生产者动作的退役`、`只读 output 的校验范围`），再给 ADR-0022 的现行语义处置，最后把推荐裁决写成新 ADR（Proposed）与一页式作者裁决包。

## 2. 评审方法、口径与证据规则

### 2.1 方法

1. **原文**：只读 Accepted ADR 的最终决策段与 `## enforcement_gaps`（不修改）。
2. **实现**：在生产路径 `apps/*/lib`、`frontend/src`、`docs/design/schemas` 中用 grep/read 求证每个对象的真实生产者。
3. **消费者**：分四层取证——(i) 代码运行时消费（谁读、谁分支）；(ii) trace/replay 消费（`DecisionTrace` / `ReplayService` / `TraceReplayService`）；(iii) 前端消费（Why/动作/状态渲染）；(iv) 真实页面/验收证据（只引用已有场景 id 与 artifacts，不重跑、不伪造）。
4. **口径**：`保留` = 有 producer 且有 consumer；`收窄` = 语义仍成立但范围缩小；`退役` = 无 producer 或无可达 consumer，或已被后续 Accepted 决策改变。测试替身、stub、历史 artifacts 不能代替真实消费者。

### 2.2 证据基线

- 工作树 HEAD：`1ce14d5b`（`feat: B41 CP5 全量回归 + known-gaps 类型词表 + B40/B42 交接（B41 done）`）。
- 本轮只做只读代码求证，未运行产品测试 / Tauri / 真实模型（B49 无实模需求）。
- 门禁：`mix run scripts/adr_trace.exs`、链接可达、`git diff --check`，见 §8。

### 2.3 开工七问（保留自原任务，已按评审阶段回答）

1. **Contract**：ADR-0001/0002/0003/0004/0007/0012/0022/0023/0025、TurnResult v3/barrel、JudgmentProtocol/AgentPlan、GateOrder、Replay。裁决前只写评审材料，不改生产。
2. **Invariant**：每个保留字段/动作都有真实消费者；安全语义不减弱；历史决策不静默改写；Proposed/Accepted/Superseded 与实际实现可追溯。
3. **Boundary**：`docs/design/adr`、`00c`、`tasks/slices/B49`；代码实现等裁决后按 B01/B43/B45 等任务执行。
4. **Consumer**：后续 Planner/Gate/schema/前端/replay 实现者与作者评审者。
5. **Proof**：新 ADR（Proposed）明确 supersede/收窄关系、保留/退役清单与真实 consumer；`adr_trace` 对 Proposed 跳过；B01/B43/B45 有可执行边界。
6. **Acceptance Driver**：评审阶段以当前代码/场景证据矩阵为主；实施后按各承接任务的真实 Tauri 场景验收，产品验收感知逻辑 **no**。
7. **Exploration**：每项决策可回查生产 consumer 与证据；无消费者的字段不进入新探索面或 UI（本轮不新增任何探索面）。

---

## 3. 交付物一：主链语义对照表

### 3.1 primary frame / primary plan 与 reply-only 的真实边界

| # | Accepted 字面 | 当前实现（真实载体） | 真实 consumer | 建议 |
|---|---|---|---|---|
| F1 | ADR-0001 #1：每个作者 turn 有且至少一个 primary `DialogueFrame` | Form R（reply/exploration/question/capability_gap）由 `judgment_frame/4` 构造 `primary: true`（`dialogue_planning_service.ex:1693-1741`，`primary: true` 在 `:1707`）；author_question/cancel/pending 回复帧同样 `primary: true`（`author_question.ex:12`、`dialogue_gateway.ex:876`、`pending_artifact_workflow.ex:1879`） | `DecisionTrace.frame_ref`（`trace_writer.ex:27`）；`TurnResult.frame_ref`（`turn_result_builder.ex:38`）；前端 Why/帧展示读 `trace_summary`/`frame_summary`（`frontend/src/lib/traceSummaryView.ts:90-91`、`framePresentation.ts:80`） | **保留**（Form R 的规范语义） |
| F2 | ADR-0002 #3：一个 primary frame 在进入 Orchestrator 前最多产生一个 primary `MicroPlan`；plan 必须引用 primary frame | Form E 的每个 step 各自构造 step frame（`primary: false`，`judgment_plan.ex:779`；六个 flow 同构），plan 的 `frame_ref` 在 decide 前被覆盖为 step frame（`judgment_plan.ex:607-608`）；`plan_from_decision/3` 初值 `run.origin_frame_ref` 在 `:1043-1069` 也会被覆盖 | 无。`primary` 字段全仓**无读者**：只有 struct 定义与 `MicroPlan.from_map` 的默认值（`micro_plan.ex:170`）；`DialogueFrame.primary` 在 `apps/*/lib` 无任何 `frame.primary` 读取 | **收窄/退役规则**："primary plan 唯一性"退役；保留 `MicroPlan` 为 per-step 单动作建议 envelope（ADR-0002 其余决策保留） |
| F3 | ADR-0001 #3/#4：frame 可无 plan；仅当需要工具/状态推进/behavior 时进入 plan | Form R 零 `MicroPlan`、零 `OrchestratorDecision`（`dialogue_planning_service.ex:1415-1444` 只调 `TraceWriter.record` 与 `TurnResultBuilder.build`，无 `ExecutionOrchestrator`）；Form E 每步一个 plan | `TurnResult` 由 frame+trace 构建；`ReplayService` 从 `DecisionTrace` 解释"为什么没有工具/行为/写入"（`replay_service.ex:18-38,61-90`）；前端 Why 面板消费 `decision_type`/`no_tool_reason`（`traceSummaryView.ts:90-91`） | **保留**（reply-only 无 plan 的真实边界） |
| F4 | ADR-0004 #3：decision 的 `frame_ref` 必须引用 primary frame（存在 plan 时引用其 frame） | Form E：decision.frame_ref = step frame id；`plan.frame_ref` = step frame id；origin_frame_ref 只在 run 持久化（`agent_run_record.ex:17`），**不是**本次回复的 frame id | decision/trace（`trace_writer.ex:76-79`）；step gate lineage（`agent_run_server.ex` 的 `gate_decided` 事件）；**无 consumer 校验 origin_frame_ref 真是 frame** | **收窄**：Form E 改为 per-step frame/plan 绑定；`origin_frame_ref` 是 turn 入口 lineage（见 F5） |
| F5 | ADR-0001/0002/0004 的 frame binding 语义隐含"引用可验证的 frame" | 用户消息入口把 origin frame 合成为字符串 `"frame_#{turn_id}"`（`dialogue_planning_service.ex:134`），与真实 frame id（`frame_` + hash，`dialogue_planning_service.ex:1701-1705`）不同；全仓无消费者校验其指向真实 frame | Persistence 字段（`agent_runs.origin_frame_ref`）；run/trace 输出（`agent_run_server.ex:1908`） | **A 类补齐（唯一有 consumer 的 frame 缺口，B01 承接）**：origin frame ref 必须是真实存在的 frame 引用，或改名为 turn ref 并停止冒充 frame 引用 |
| F6 | `primary` 字段本身（ADR-0001 字段语义组） | `DialogueFrame.primary` 生产者多处（`true`/`false`），消费者 0；`MicroPlan.primary` 生产者多、消费者 0 | 无 | **退役语义（字段保留至 B45 清理）**：不得新增校验/消费者；B45 决定移除或标 legacy |

**结论（争议点 1）**：真实边界是**两种 turn 形态**——

- **Form R**：恰好一个 primary `DialogueFrame`，无 `MicroPlan`、无 `OrchestratorDecision`，解释权威是 `DecisionTrace`；
- **Form E**：run 入口有 origin frame lineage，每个 gate step 有 step frame（`primary: false`）+ 单动作 `MicroPlan` + 一个 `OrchestratorDecision`。

"一个 primary frame 至多一个 primary MicroPlan"没有执行载体，建议退役；保留 ADR-0002 的 plan 语义与 per-step re-gate。**不推荐 A（补 primary 校验）**：`primary` 无读者，补齐只会为形式完整加一条永不消费的规则；唯一值得补的是 F5 的 origin frame lineage。

### 3.2 reply-only 是否必须产生 `OrchestratorDecision`

| # | Accepted 字面 | 当前实现 | 真实 consumer | 建议 |
|---|---|---|---|---|
| D1 | ADR-0004 #1：每个 turn 在形成 TurnResult 前必须产生一个 `OrchestratorDecision` 或复用幂等 decision | reply-only 主链**不构造** `OrchestratorDecision`：`TraceWriter.record/3` 直接产生 `DecisionTrace`（`trace_writer.ex:20-50`），`TurnResultBuilder.build/8` 的 `decision` 参数为 `nil`（`dialogue_planning_service.ex:1430`；builder 的 `maybe_add_decision(nil)` 直通，`turn_result_builder.ex:215`） | `DecisionTrace` 被持久化并经 `TraceReplayService`/`ReplayService` 消费（`trace_replay_service.ex:16-20,62-111`；`trace_replay_controller.ex:11`）；前端 Why 面板消费 `decision_type`/`no_tool_reason`（`traceSummaryView.ts:90-91,281`） | **收窄**：reply-only 不产生 OrchestratorDecision；ADR-0004 #1 改为"每个执行裁决产生一个 decision；reply-only 由 DecisionTrace 解释" |
| D2 | ADR-0004 #2：reply-only 也产生 `decision_type=reply_only` 的 decision | `reply_only` 是 **DecisionTrace** 的取值（`trace_writer.ex:377-379`），不是 `OrchestratorDecision` 的取值（`orchestrator_decision.ex:8-16` 无 `reply_only`） | ReplayService 用 `trace.decision_type != :reply_only` 判断 `execution_blocked`（`replay_service.ex:79`）；前端 Why 面板按 `decision_type` 渲染（`traceSummaryView.ts:90-91`） | **收窄**：`reply_only` 归 trace 词表；从 ADR-0004 #5 的 decision_type 全集移出 |
| D3 | ADR-0004 #5 decision_type 全集 9 族（含 `allow_bounded_read_batch`、`cancel_or_close`） | 结构体实际 8 值（`orchestrator_decision.ex:8-16`）；gate 生产者全部落在其中（`execution_orchestrator.ex:361-512`） | `turn_result_builder.ex:217-227` 映射到 TurnResult `orchestrator_decision`；trace `decision_type_for/1` 映射（`trace_writer.ex:381-388`） | **收窄**：保留 8 值；退役 `allow_bounded_read_batch`（只读批量由 `AgentRunPolicy.allow_bounded_read_batch`/readonly profile 承载，`agent_run_policy.ex:19,32`）与 `cancel_or_close`（行为关闭由 `BehaviorState` 终态 + trace behavior refs 承载，`dialogue_gateway.ex:362-470`） |
| D4 | ADR-0004 #6 decision_status 生命周期 8 值 | 所有 builder 只产出 `:decided`（`execution_orchestrator.ex:368,397,420,447,479,502`）；无 `received/validated/gated/dispatching/integrating/emitted/failed` 生产者 | 无消费者读取其他状态；生命周期进度由 `GateResult.order/outcome`（`gate_order.ex:44-56` 的 `@gates` 顺序 + `gate_result.ex` 的 outcome 枚举）、`DecisionTrace.event_order`、`AgentStep/AgentRun` 状态承担 | **收窄**：规范值 `:decided`；新增状态必须同时新增生产者+消费者 |
| D5 | ADR-0004 #7：默认最多批准一个下一步写入/高风险动作；只读 batch 保留 | 12 门全 pass 但无可分发动作 → `downgrade_to_dialogue`（`execution_orchestrator.ex:361-385`）；单动作 plan 由 `GateOrder` action_scope 保障（`gate_order.ex:251-266`）；每 step re-gate（`judgment_plan.ex:605-643`） | `TurnResult.truthfulness.execution_blocked`/`decision_type`（`turn_result_builder.ex:178-199`）；前端展示阻断原因（`traceSummaryView.ts:281`） | **保留语义，改载体**：per-step re-gate 即"默认只放行下一步"的实现；不新增多步批准对象 |
| D6 | ADR-0004 隐含"所有 turn 级解释来自 decision" | 非执行轮的 turn 级解释分散为三类权威：`DecisionTrace`（reply/explore/question）、`AdoptionDecision` trace summary（作者采纳/确认/取消动作，`dialogue_gateway.ex:306-355,590-599`）、run 级结构（预算缺口 `:plan_budget_shortfall`、awaiting/failed，`agent_run_server.ex:2256-2345`） | `trace_summary.decision_type` 透到前端（`traceSummaryView.ts:90-91`）；持久化读取词表 `TraceReplayService.@decision_types`（`trace_replay_service.ex:16-20`） | **收窄 + 显式登记**：三类权威并存；B43/B45 负责词表同步与未知值可观测（`plan_budget_shortfall` 目前不在 `@decision_types` 中） |

**结论（争议点 2）**：reply-only **不需要** `OrchestratorDecision`。执行轮的裁决对象保留，但 `decision_type` 收窄为 8 值、`decision_status` 收窄为 `:decided`；非执行轮的解释权威是 `DecisionTrace`（必要时加 action/run 级 trace summary），不强制统一成一个新 decision 对象。

### 3.3 动作生产/消费矩阵（`available_actions` 及 next-step 载体）

| 动作 / 字段 | 生产者 | 消费者 | 建议 |
|---|---|---|---|
| `answer_clarification` / `confirm_before_execute` / `reject_or_cancel_confirmation` / `cancel_pending_behavior` | `execution_orchestrator.ex:57-66`（模板）、`:262-312`（open behavior 时生成，`behavior_actions/5`） | 前端动作过滤与提交：`frontend/src/lib/workbenchActions.ts:42-68,80-96`；`WorkspaceChat.tsx` 行为动作消费（`behavior_ref` 门控，`:3055-3073`） | **保留** |
| `accept` / `discard` / `edit_then_accept` | `available_action_builder.ex:97-111`；`adoption_workflow.ex:1307`（discard 结果） | `workbenchActions.ts:42-68`、`WorkspaceChat.tsx:2914-2935` | **保留** |
| `choose_candidate` | `available_action_builder.ex:33` | 候选面板（`workbenchActions.ts:60` 从通用动作区排除，候选面单独渲染；`WorkspaceChat.tsx` 候选消费） | **保留** |
| `author_choice` | `author_question.ex:90-110` | `AuthorQuestionReply.tsx:38`；`schemas.ts:49-62` 收紧校验；`WorkspaceChat.tsx` 问题回复 | **保留** |
| `revise_from_findings` | `prose_revision_service.ex:308,634`（VS-00E 路径动作） | `WorkspaceChat.tsx:2798-2810`；`workbenchActions.ts` 过滤 | **保留** |
| `agent_run_budget_next_step` / `agent_run_budget_next_steps_<n>` / `agent_run_budget_single_step_<n>` / `agent_run_budget_remaining_plan` / `agent_run_budget_selected_steps` | `agent_run_server.ex:2309-2324`（`budget_recovery_actions/2`） | `WorkspaceChat.tsx:2895-2904,3079,4989` | **保留**（恢复面真实载体） |
| `continue_dialogue` | 唯一来源：`execution_orchestrator.ex:53` `@default_behavior_next_action` → `BehaviorState.required_next_action` 默认值（`:281,289-290`）；但 `behavior_type` 只会是 `:clarification`/`:confirmation`（`:262-312`），默认分支**不可达**，实际值只有 `answer_clarification`/`confirm_before_execute` | 无。前端只读 `behavior_state.active.behavior_type`/`behavior_id`（`WorkspaceChat.tsx:1625-1627,3057-3073`），不读 `required_next_action` | **退役** |
| `no_further_action` | 仅 `novel_foundation/lib/novel_foundation/enums/next_action.ex`（由 `docs/design/schemas/foundation/enums/next_action.json` 生成）与 `turn_result_validator_test.exs` | 无。`TurnResultValidator` 全仓无生产消费者（仅测试），`NextAction` 只在 validator 内引用 | **退役** |
| `retry_action` | 0（全仓仅 ADR-0007 文本） | 0 | **退役** |
| `narrow_scope` | 0（全仓仅 ADR-0007 文本） | 0 | **退役** |
| `primary_next_action` | 0（无代码、无 wire schema 字段） | 0 | **退役**（`primary next step` 的真实载体是 `available_actions` + `behavior_state.active`） |
| TurnResult 顶层 `next_action` 字段 | `author_question.ex:75`（`"waiting_for_author"`）；`agent_run_server.ex:2283`（`"author_budget_recovery"`） | 无。前端仅在测试 fixture 出现（`frontend/src/lib/__tests__/turn_result_candidates.test.ts:22` 等）；wire schema 中为可选遗留（`turn_result_v3.json`） | **退役字段**（B45 落 wire/schema 处置；保留历史读取兼容） |
| `BehaviorState.required_next_action` | `execution_orchestrator.ex:281`，`trace_writer.ex:611` 复制进 behavior trace summary | 无（前端只取 behavior_type/behavior_id；Replay 未消费） | **退出规范 next-step 载体**（字段由 B45 决定移除/标 legacy） |

**结论（争议点 3）**：`available_actions` 契约保留；退役 ADR-0007 的 `continue_dialogue / no_further_action / retry_action / narrow_scope / primary_next_action` 与 TurnResult `next_action` 字段。恢复面已由 `agent_run_budget_*`（DS03 控制坞）承接，不需为旧动作补 producer。

### 3.4 只读 output 是否都必须统一 schema 校验

| 类别 | Accepted 字面/现状 | 真实消费者 | 建议 |
|---|---|---|---|
| (a) 创作/作者可见 artifact `ToolResult` | ADR-0012 规则 4 要求满足 registry output contract；实际由 `ToolOutputContract` 校验（`novel_common/contracts/tool_output_contract.ex`；`creative_tool_adapter.ex:26-36`） | `ArtifactAssembler`/adoption 链路；作者可见候选 | **保留强制校验**（ADR-0012 规则 4 对本类不变） |
| (b) 内部只读工具 `ToolResult`（`text_analysis`/`character_roster`） | adapter 返回内部 typed map（`text_analysis_adapter.ex:13-27`、`character_roster_adapter.ex:18-23`）；registry 声明 `text_analysis_output_v1` / `character_roster_result_v1`（`capability_registry.ex:45,60`）但**无 schema 文件**（`docs/design/schemas/foundation/` 不存在对应 JSON） | 仅内部消费（turn execution/roster 读取）；无 wire/UI 直接消费 | **显式 opaque**（adapter typed contract），B45 登记；ADR-0012 规则 4 按此收窄 |
| (c) inline 只读探索（非 `ToolResult`） | `ExplorationService.observation`（tool/query/summary/refs/outcome/facts，`exploration_service.ex:1-60`）由判断循环内联调用（`dialogue_planning_service.ex:670-740`），不产生 `ToolRequest`/`ToolResult` | judgment/AgentRun observation + trace events；不直接上 wire | **局部 contract**（保留现状；与 ADR-0001 修订"trace 保留实际 ToolRequest/ToolResult"的口径差登记为跨任务残余） |
| (d) TurnResult 线格式 | 前端 `turnResultWire.ts:20-28` safeParse 告警不阻断；`schemas.ts:40-62` 组合收紧 `ui_cards`/`candidate_directions`/`adoption_state`/`author_choice`；v3 `additionalProperties=true`（draft 期政策） | 前端所有 Channel/transcript 入口；`WorkspaceChat.tsx`/`UICards.tsx` | **保留唯一校验入口**；不为后端加第二套；显式 opaque 字段保留（`trace_summary`/`truthfulness`/`behavior_state`/`plan_step_selection`） |
| (e) 旧 v2 兼容物 | `turn_result_v2.json`（历史冻结）、`phase_next_action_compat.json`（大写 phase/next_action 旧语义）、`NextAction` enum、`TurnResultValidator`（仅测试调用） | 无生产消费者（validator 只被 `novel_domain/test/.../behavior_state_test.exs` 等测试调用） | **不进入 SSOT**：legacy 处置归 B45（对账 ID B18）；不新增无消费者校验 |

**结论（争议点 4）**：只读 output **不统一**要求 schema 校验，按四类边界分层：(a) 强制冻结 contract；(b) 显式 opaque；(c) 局部 observation contract；(d) 唯一 wire 校验入口 + 显式 opaque 字段。旧 v2/enum/validator 不具 SSOT 地位，B45 处理。

---

## 4. 交付物二：ADR-0022 现行语义对照与处置

ADR-0022 当前状态 **Proposed**；它含已实现部分（N-NARR / PlanStep / replan 机制），也含被后续 Accepted 决策改变的部分。不能只挑已实现部分转 Accepted。

| # | ADR-0022 段 | 原文语义 | 当前实现 | 冲突/承接 | 结论 |
|---|---|---|---|---|---|
| P1 | 决策 1：AgentPlan 可视化/版本化/可修订；`PlanStep`（kind/status/description）、`plan_version`、`revision_reason`；计划由 planner 每轮修订 | 模型维护计划；`PlanStep` 取代 `milestones[]`；作者可见计划 | 已实现于 domain 与 flow：`agent_plan.ex:9-19,123-168`；`plan_drafted`/`plan_revised` 事件（`agent_run_server.ex:1330-1370`）；replan 由 `agentic_deviation_signal.ex` 驱动；前端消费计划步骤状态/计数（`agentRunTimeline.ts:211,324-343`） | **适用域收窄**：只有"模型判断需要计划"的 run 才有模型计划（ADR-0025 决策 2）；单工具 profile 的机械序列不发 plan_drafted（`mechanical_plan.ex:7` 等）。**UI 证明失效**：46§9.5（2026-07-15 用户拍板）移除常驻计划面板（`WorkspaceChat.tsx:817-821`） | **保留契约 + 收窄适用域/UI 证明** |
| P2 | 决策 2："每次 observe 后新增 evaluate 判定"，evaluate 折进 planner 同一次调用（字段顺序固定） | 每次 observe 后模型 evaluate；驱动 continue/replan/done/await_author | 未按字面实现。ADR-0023 决策 2（Accepted）改为：每次 observe 后**确定性核对**，命中 D1-D7 才发起一次 evaluate+replan 合并调用（`agentic_deviation_signal.ex:1-45`）；`evaluation_of_last` 只在模型计划 run 的偏离/续行场景存在 | **已被 Accepted ADR-0023 修订**，不能原样承接 | **不承接**（以 ADR-0023 决策 2 现行语义为准） |
| P3 | 决策 2 的调用协议前提：planner 每步一次/evaluate 同调用 | 每步 planner 调用 + evaluate 折进 | 判断纪元单调用 auto（ADR-0025 §5，Accepted；B26/B27 联合修订）：`judgment_protocol.ex:2`、`:514` `tool_choice: "auto"`；每 step 的 plannner 例行调用已消失 | **调用协议已被后续 Accepted 决策改变** | **不承接**（以 ADR-0025 §5 为准） |
| P4 | 决策 3：N-NARR——作者可见过程叙事字节必须来自模型输出 + source binding；provider 遥测降级开发者视图 | 叙事归模型、结构归 app；`author_narrative_source`（provider refs/hash/byte range） | 已实现：`agent_narrative_source.ex:54,127,201`；N-NARR driver `scripts/scenario_invariants/run_n_narr.exs`（经 `scripts/ai_static_scan.sh:165-166` 执行）；`:author_reasoning` purpose（`novel_agent/lib/novel_agent/provider/execution.ex:252`）；前端消费 `author_narrative`/`author_narrative_source`（`agentRunTimeline.ts:220-231,316`） | 与现行实现一致 | **原样保留** |
| P5 | Contract 影响：`AgentPlan`/`AgentNextStepDecision`/`AgentEvent` reasoning 事件族/`:author_reasoning` purpose/trace 记录 | 新增事件族与 purpose | 事件族与 purpose 已存在；`AgentNextStepDecision` 语义在判断纪元被 judgment 结构吸收（`judgment_protocol`），`AgenticNextStepPlanner` 仅余 `with_provider_call_meta` helper | 大部分已实现；`AgentNextStepDecision` 的"降级为选步"表述已不符合判断纪元 | **保留已实现项 + 说明旧表述** |
| P6 | UI §46§9 五态/计划面板/reasoning 流；垂直证明"真实页面看到计划 v1→v2" | 计划面板五态 | 46§9.5 用户拍板改为文档流，无计划 checklist；计划事件仍消费为结构状态/计数；`agentic-loop-plan-replan-reasoning` 旧场景已随 B13b/B40 处置 | **UI 证明失效**；不得作为 ADR-0022 转 Accepted 的垂直切面证明 | **收窄证明**（改用 N-NARR driver + judgment 事件链 + 现有 B40 重锚场景） |

### 4.1 ADR-0022 处置选项

| 选项 | 内容 | 优点 | 缺点 | 推荐 |
|---|---|---|---|---|
| **A 接受现行语义** | 把 ADR-0022 决策 1/2/3 按现行实现重写并转 Accepted，补 enforced_by/gaps | 一份 Accepted 文档覆盖 | 等于重写历史决策段（决策 2 已被 ADR-0023 修订、UI 证明已被 46§9.5 改变），会造成"今天才接受一套 2026-07 的旧语义"的伪历史；且与 ADR-0023 Accepted 文本冲突 | ✗ |
| **B 新 ADR 承接** | 由 ADR-0031（Proposed）承接决策 1 的现行边界与决策 3（N-NARR），决策 2 以 ADR-0023/0031 现行语义为准；作者接受 ADR-0031 后把 ADR-0022 标 Superseded | 不改历史正文；ADR-0022 有明确归宿；N-NARR 保留；新 ADR 可评审 | 需要作者一次裁决两份文档状态 | **✓ 推荐** |
| **C 旧段标 superseded（就地注记）** | ADR-0022 内加"决策 2 已由 ADR-0023 修订、UI 证明已由 46§9.5 移除"的关系注记，保持 Proposed | 改动最小 | Proposed 文档内混有已失效段与现行段，无 enforced_by 与验收结论；未来无法稳定转 Accepted | △ 备选（若作者不想动状态） |

**推荐 B**：新增 ADR-0031 承接；作者接受后把 ADR-0022 状态改为 `Superseded`（替代者 ADR-0031；决策 2 的现行语义由 ADR-0023/0025 承担）。若作者只想文档化、不想新增状态，退而采用 C，并在 ADR-0022 顶部加关系注记（不删除历史段）。

---

## 5. 交付物三：推荐裁决（A / B / C）

### 5.1 总推荐：**C 承接 + 逐项 B 收窄 + 一处 A 补齐**

- **C（新 ADR 承接）**：不可共存的历史段（primary plan 唯一性、reply-only decision、ADR-0022 决策 2、动作全集）由 ADR-0031 承接；Accepted ADR 原文不改。
- **B（逐项收窄）**：decision_type/status 子集、动作集、只读 output 分层、ADR-0022 适用域/UI 证明，按 §3/§4 表格收窄。
- **A（补齐，仅 1 处有 consumer 的缺口）**：**origin frame lineage 可验证性**（F5）——run 入口 lineage 必须是真实 frame 引用或显式改名 turn ref（B01）。
  - 复核记录：ADR-0007 #3 的 behavior 动作 `trace_ref` **已经实现**（`execution_orchestrator.ex:298-312`，`trace_ref: "decision_trace:#{turn_id}"` 在 `:310`）；B13b 登记的该 gap 已随既有修复落地，不列入本轮补齐。

**不推荐**把 A 扩成"按旧字面全补"：其余 A 候选（primary 校验、reply-only decision、五个动作 producer、全部只读 output schema）均无真实消费者，见 §5.4 退役证明。

### 5.2 逐项裁决表

| 争议点 | 选项 | 推荐 | 理由（一句） | 若作者否决的后续 |
|---|---|---|---|---|
| primary frame / primary plan 边界 | A 补 primary 校验 / B 收窄为 Form R + Form E per-step / C 新 ADR | **B+C** | `primary` 字段无读者，primary plan 唯一性无载体；当前两形态已由真实链路与 trace 验证 | 若坚持字面，只能补 owner/consumer 都没有的校验；B01/B43 需先重造载体，成本高且收益为零 |
| reply-only 是否必须 OrchestratorDecision | A 补 reply-only decision / B 收窄为 DecisionTrace 解释 / C 新 ADR | **B+C** | reply-only 的为什么-没有工具/行为/写入问题已由 trace 完整回答，且被 Replay/前端消费；补 decision 会造第二份解释事实 | 若补 decision，`reply_only` 会同时出现在 decision 与 trace；Replay 需二选一，且 ADR-0004 #2 仍与实现不一致 |
| decision_type / status 子集 | A 按 ADR 全集补 / B 收窄到现状 8 值 + `:decided` | **B** | 其余 3 type/7 status 无生产者，全仓无消费者；gate/step/trace 已提供生命周期 | 若保留全集，schema 会长期为空值枚举，漂移检测失去意义 |
| 动作集 | A 补五动作 producer / B 退役无消费者动作 | **B** | 五动作 0 生产者或不可达；恢复面已由 `agent_run_budget_*` 承接 | 若补 producer，会新增无 UI 入口的动作与文案；需作者先给出真实产品场景 |
| 只读 output 校验 | A 全部统一 schema / B 四类分层 | **B** | 只有创作 artifact 有真实 wire/作者消费者；两个只读 registry 引用无 schema 文件，统一校验无对象可依 | 若统一，须先冻结两个 output schema 并补消费方（B45 另开，成本高、无当前消费者） |
| ADR-0022 | A 接受现行语义 / B 新 ADR 承接 / C 就地标旧段 | **B**（备选 C） | 决策 2 已被 ADR-0023 改写、UI 证明已失效，不能整份接受；新 ADR 承接保历史与 N-NARR | 采用 C 则 ADR-0022 保持 Proposed 并加关系注记；采用 A 则需重写历史决策段（违反不改历史） |
| origin frame lineage（F5） | A 补齐 / 保持现状登记 gap | **A（小步，B01）** | 唯一有真实 replay/lineage 消费者的 frame 缺口；现在是合成字符串，无法验证 frame 存在 | 保持 gap 则 Replay/Why 的 turn 入口 lineage 仍不可验证；B01 承接并把风险登记 |

### 5.3 保留清单（带 consumer 证据）

| 保留项 | 真实 consumer 证据 |
|---|---|
| primary `DialogueFrame`（Form R） | `trace_writer.ex:27`（trace.frame_ref）；`turn_result_builder.ex:38`（TurnResult.frame_ref）；前端 `traceSummaryView.ts:90-91` |
| step frame + 单动作 `MicroPlan` + per-step `OrchestratorDecision`（Form E） | `judgment_plan.ex:605-643`（gate + blocked trace）；`turn_result_builder.ex:217-227`（TurnResult.orchestrator_decision）；`agent_run_server.ex` `gate_decided` 事件（gate lineage 供验收/Replay） |
| `DecisionTrace`（reply-only/exploration 解释权威） | `trace_writer.ex:20-50`；`replay_service.ex:18-38,61-90`；`trace_replay_service.ex:16-20,62-111`；`trace_replay_controller.ex:11`；前端 `traceSummaryView.ts:90-91,281` |
| `OrchestratorDecision`（8 type / `:decided`） | `execution_orchestrator.ex:361-512`；`turn_result_builder.ex:217-227`；`blocked_decision_trace.ex:30-38` |
| `available_actions` 契约与 §3.3 保留动作 | `workbenchActions.ts:42-96`；`WorkspaceChat.tsx` 动作消费；Channel `ActionValidator`（`workspace_channel.ex:1339,1406,1690`） |
| 四类只读 output 边界 | (a) `tool_output_contract.ex`、`creative_tool_adapter.ex:26-36`；(b) 两个只读 adapter；(c) `exploration_service.ex:1-60`；(d) `turnResultWire.ts:20-28`、`schemas.ts:40-62` |
| ADR-0022 决策 3（N-NARR） | `agent_narrative_source.ex:54,127,201`；`run_n_narr.exs`；`ai_static_scan.sh:165-166`；前端 `agentRunTimeline.ts:220-231,316` |
| ADR-0022 决策 1 契约（AgentPlan/PlanStep/replan） | `agent_plan.ex:9-19,123-168`；`agentic_deviation_signal.ex:1-45`；`agent_run_server.ex:1330-1370`；前端 `agentRunTimeline.ts:211,324-343` |

### 5.4 退役清单（无消费者/不可达证明）

| 退役项 | 证明 |
|---|---|
| `primary` 唯一性规则（ADR-0002 #3） | step frame 生来 `primary: false`；plan.frame_ref 被覆盖为 step frame（`judgment_plan.ex:607-608`）；`primary` 无任何读者 |
| `DialogueFrame.primary` / `MicroPlan.primary` 字段语义 | 全仓无读取（grep `\.primary`/`frame.primary` = 0；仅 struct 定义与 `from_map` 默认） |
| `reply_only` 作为 OrchestratorDecision 类型 | 结构体 enum 无此值（`orchestrator_decision.ex:8-16`）；reply 路径不构造 decision（`dialogue_planning_service.ex:1415-1444`） |
| `allow_bounded_read_batch` decision 类型 | 无生产者；只读批量由 `AgentRunPolicy` 布尔承载且无 gate 使用（`agent_run_policy.ex:19,32`） |
| `cancel_or_close` decision 类型 | 无生产者；行为关闭由 BehaviorState 终态 + trace behavior refs（`dialogue_gateway.ex:362-470`） |
| decision_status 7 个非 `:decided` 值 | 全仓无生产者（grep `decision_status:` 仅 `:decided`） |
| `continue_dialogue` | 仅 `execution_orchestrator.ex:53` 默认值；`behavior_type` 不可达该默认分支；`required_next_action` 无前端/Replay 消费者 |
| `no_further_action` | 仅 foundation enum 与测试；`TurnResultValidator` 无生产消费者 |
| `retry_action` / `narrow_scope` | 全仓 0 命中（除 ADR-0007 文本） |
| `primary_next_action` | 全仓 0 命中 |
| TurnResult 顶层 `next_action` 字段 | 生产者 2 处（`author_question.ex:75`、`agent_run_server.ex:2283`），无消费者（前端仅测试 fixture）；旧 UPPERCASE enum 语义不同 |
| `BehaviorState.required_next_action`（作为 next-step 载体） | 前端只读 behavior_type/behavior_id；trace 仅复制；无决策/UI 消费 |
| 只读 output 的"统一 schema 校验" | 两个 registry 引用无 schema 文件；内部只读消费方（adapter/内部读取）不以 schema 为契约 |
| `turn_result_v2` / `phase_next_action_compat` / `NextAction` enum / `TurnResultValidator` 的 SSOT 地位 | 无生产消费者（validator 仅测试）；大写旧语义与现行 v3 小写 wire 不一致（B45 处置） |

### 5.5 A 类补齐清单（仅 1 项）

| 补齐项 | 真实 consumer | 承接 |
|---|---|---|
| origin frame lineage 可验证（真实 frame ref 或改名 turn ref） | Replay/Why 的 turn 入口 lineage；run → 回复 turn 的追溯 | B01（Planner 语义边界） |

复核记录（不列入补齐）：ADR-0007 #3 的 behavior 动作 `trace_ref` **已实现**（`execution_orchestrator.ex:298-312`，`trace_ref` 在 `:310`）；`decision_trace_ref` 回填**已实现**（`turn_execution_service.ex:406`、`pending_artifact_workflow.ex:566,1364,1501`）。B13b 登记的这两条修复方案已随既有修复落地，本轮不重复补。

---

## 6. 交付物四：新 ADR 与索引/承接边界

### 6.1 新 ADR（Proposed）

- 文件：[`docs/design/adr/ADR-0031-core-chain-semantics-narrowing-v3.md`](../../docs/design/adr/ADR-0031-core-chain-semantics-narrowing-v3.md)
- 状态：**Proposed**（2026-10-27），不授权实现、不改历史 Accepted ADR、不代签。
- 关系：
  - 收窄 ADR-0001 #3/#4/#5 的载体；ADR-0002 #1-#3 的 primary 唯一性；ADR-0004 #1/#2/#5/#6/#7 的子集；ADR-0007 动作集与 `primary_next_action`；ADR-0012 规则 4；
  - 承接 ADR-0022 决策 1 的现行边界与决策 3（N-NARR），不承接决策 2（已由 ADR-0023/0025 改写）。
- `enforced_by`（Proposed 阶段声明）：列出已实现现行语义的仓库路径 + `pending:` 项（转 Accepted 前须闭合）；`## enforcement_gaps` 诚实登记 origin lineage、字段退役、opaque 登记、ADR-0022 状态等未完成项。
- adr_trace 行为：非 Accepted 被跳过；**未伪造 Accepted 或 enforced_by 已满足**。若作者接受 ADR-0031，必须先把 `pending:` 项闭合或转入 enforcement_gaps。

### 6.2 索引与登记（本轮已做）

| 文件 | 变更 | 说明 |
|---|---|---|
| `docs/design/adr/ADR-0031-core-chain-semantics-narrowing-v3.md` | 新增 | Proposed 决策稿（见 6.1） |
| `docs/design/adr/README.md` | 更新 | 顶部加 B49 评审材料（Proposed，待作者裁决）注记；§8.3 索引表加 ADR-0031 行 |
| `docs/design/00c-state-and-contract-atlas.md` | 最小追加 | §8.1 Batch A 加 ADR-0031 行（状态、来源、优先原因、承接/阻塞） |

### 6.3 后续承接边界

| 承接方 | 范围 | 不做什么 |
|---|---|---|
| **B01 Planner 语义边界**（沿 B27 CP5 + B26 后继校验） | origin frame lineage 可验证性；judgment→frame→plan 的语义边界补齐；PlannerBoundary 的 frame/plan 绑定校验 | 不建第二套 Router/关键词分类器；不重复 B49 的收窄裁决 |
| **B43 Gate 残余** | 幂等输入（同 key 异 payload）；open_behavior/slot 统一进门；blocked 真实页面/first_blocking_gate/trace/replay；trace 词表与 `TraceReplayService.@decision_types` 同步（含 `plan_budget_shortfall` 等 run 级取值） | 不重建 GateOrder/幂等体系；不把 B49 的退役动作重新带回来 |
| **B45 Schema legacy（对账 ID B18）** | `turn_result_v3` 可选 `next_action` 的 legacy/退役；`phase_next_action_compat`/`NextAction`/`TurnResultValidator` 的 legacy 地位；`text_analysis_output_v1`/`character_roster_result_v1` 显式 opaque 或退役；`$ref`/`z.any()` 分类；`primary`/`required_next_action` 字段清理 | 不新增业务字段；不把意外 `z.any()` 当收紧；不破坏历史读取兼容 |
| **B12 S7 非预算 awaiting surface**（ADR-0024 CP3 / DS03 尾项） | awaiting_author/no_progress 等非预算出口复用 `available_actions` + `trace_summary.decision_type` + `author_question` | 不依赖 reply-only OrchestratorDecision；不先建表；只有真实非预算 await 场景才实施 |
| **后续字段退役实现**（小步 slice 或随 B45 CP2） | TurnResult `next_action`、`primary`、`required_next_action` 的删除/标 legacy | 不破坏历史 TurnResult/trace 读取；不改验收判据 |
| **ADR-0022 状态** | 作者接受 ADR-0031 后改 `Superseded`（替代者 ADR-0031）或在正文顶部加关系注记 | AI 不代签、不改历史决策段 |

---

## 7. 交付物五：作者裁决包（一页式）

> 使用方式：作者对 R1–R7 逐项选「推荐 / 否决（并给方向）」；Lead 汇总后转 ADR-0031 的 Accepted 流程（或按否决方向重写）。**本节不含已生效裁决，状态仍是「待作者」。**

| # | 事项 | 选项 | 推荐 | 影响 | 若否决的后续 |
|---|---|---|---|---|---|
| **R1** | 主链 turn 形态与 primary 边界 | (a) 按旧字面补齐 primary frame→primary plan 唯一性；(b) 收窄为 Form R（单 primary frame）× Form E（step frame + 单动作 plan + per-step re-gate）；(c) 维持现状、仅登记为文档化偏差 | **(b)** | 决定 ADR-0001/0002 哪些段保留、`primary`/`primary plan` 是否退役；B01/B43 的实施边界 | 若 (a)：需先造出 primary plan 的载体与消费者（成本高、无当前需求）；若 (c)：治理状态继续失真，B45 无法为字段定性 |
| **R2** | reply-only 是否必须 `OrchestratorDecision` | (a) 补 reply-only decision；(b) 不产生 decision，`DecisionTrace` 是解释权威；(c) 维持现状并文档化偏差 | **(b)** | 决定 ADR-0004 #1/#2 收窄；`decision_type` 词表；Replay/Why 读取路径 | 若 (a)：`reply_only` 双份解释事实，Replay 需二选一；ADR-0004 #2 仍与实现不符 |
| **R3** | decision_type / decision_status 子集 | (a) 按 ADR 全集保留（9 type/8 status）；(b) 收窄为现状（8 type / `:decided`） | **(b)** | 决定 ADR-0004 #5/#6 收窄；B43 gate/blocked 的 decision 语义；schema 枚举 | 若 (a)：长期空枚举，漂移检测失效；B43 需为无用值造语义 |
| **R4** | ADR-0022 状态处置 | (a) 接受现行语义（重写决策 1/2/3 后 Accepted）；(b) 新 ADR-0031 承接，ADR-0022 转 Superseded；(c) 就地标旧段关系注记、保持 Proposed | **(b)**（备选 c） | 决定 ADR-0022 与 ADR-0031 的状态；N-NARR 与计划契约的最终归属 | 若 (a)：重写历史决策段，违反「不静默改写」；若 (c)：Proposed 内混失效段，未来仍无 Accepted 归属 |
| **R5** | ADR-0007 动作集与 `primary_next_action` | (a) 补齐五个动作 producer；(b) 退役无消费者动作/字段，保留有 producer+consumer 的动作 | **(b)** | 决定 ADR-0007 冻结集收窄；前端动作区/按钮；恢复面归属 | 若 (a)：新增无 UI 入口的动作；需作者先给真实产品场景与 UI 设计 |
| **R6** | 只读 output 校验范围 | (a) 全部统一 schema；(b) 四类分层（creative 强制 / 内部只读 opaque / 探索局部 contract / wire 单入口） | **(b)** | 决定 ADR-0012 规则 4 收窄；B45 的 `$ref`/opaque 分类；是否冻结两个只读 output schema | 若 (a)：须先冻结 `text_analysis_output_v1`/`character_roster_result_v1` 并补消费方；当前无消费者 |
| **R7** | A 类补齐是否授权（仅 origin frame lineage 一项） | (a) 本轮授权 B01 把 origin frame lineage 收敛为真实 frame 引用或显式 turn ref；(b) 只登记 gap，暂不补 | **(a)** | 决定 B01 是否纳入首批；影响 Replay/Why 的 turn 入口 lineage 可追溯性 | 若 (b)：gap 保留，lineage 仍不可验证；B01 后续可再触发 |

**裁决后状态流转（供 Lead 执行）**：

1. 作者选 R1/R2/R3/R5/R6 = 推荐 → ADR-0031 按当前文本走 Accepted 门槛（补 enforced_by 复核、adr_trace、00c 状态）。
2. R4 = (b) → ADR-0031 Accepted 后，作者/Lead 将 ADR-0022 状态改为 `Superseded`（替代者 ADR-0031）或按 (c) 加注记。
3. R7 = (a) → B01 把 origin frame lineage 列入首批 checkpoint；若 (b) → 在 ADR-0031 `## enforcement_gaps` 保留。
4. 任一 R 被否决 → 按"若否决的后续"重写 ADR-0031 对应段后再评审，不直接进入实现。

---

## 8. 验证与门禁记录

| 检查 | 命令 / 方法 | 结果 |
|---|---|---|
| ADR 门禁 | `mix run scripts/adr_trace.exs` | ✅ **28/28 Accepted ADR 通过**（296 refs，0 pending）；ADR-0022 / ADR-0030 / **ADR-0031** 按非 Accepted 跳过（本 ADR 为 Proposed，未伪造 Accepted/enforced_by） |
| 新增/修改文件链接可达 | 相对路径逐个解析（脚本遍历 Markdown 链接）+ `file:line` 证据人工复核 | ✅ 本轮新增/修改的 4 份文件内链接全部可达；`00c` 中另有 20 条既有链接在 HEAD 即不可达（非本轮引入，见 §9 残余） |
| 空白/补丁格式 | `git diff --check` | ✅ 通过（无输出） |
| 生产代码/schema/验收判据未改 | `git status --short` | ✅ 仅本任务写作用域文件：`tasks/slices/B49-*.md`、`docs/design/adr/README.md`、`docs/design/00c-*.md`、新 ADR-0031；工作树另有的 `scripts/lib/quality/*.mjs` 为并行 B42 任务产物，非本任务改动 |
| 未改 Accepted ADR 决策段 | Accepted ADR 文件零 diff（本任务未编辑任何既有 ADR 文件） | ✅ |
| 未运行产品/真实模型/Tauri | — | ✅ 本轮为纯只读分析；`mix run scripts/adr_trace.exs` 会按项目默认启动应用依赖，但未启动 Phoenix/Vite/Tauri 验收服务器、无真实模型调用 |

### 8.1 执行结果（2026-10-27，工作树 HEAD `1ce14d5b`）

1. `mix run scripts/adr_trace.exs` → `✅ ADR traceability: 28/28 Accepted ADR(s) with valid enforced_by (296 refs, 0 pending)`；`ℹ️ Skipped non-Accepted ADR(s): ADR-0022..., ADR-0030..., ADR-0031...`。
2. 新增/修改文件链接检查 → 4 份文件内 Markdown 链接全部可达（含 `ADR-0031` 的 B13b 相对链接已修正为 `../../../tasks/slices/...`）。
3. `git diff --check` → 无输出（通过）。
4. `git status --short` → 本任务只改 4 份写作用域文件；未改生产代码/schema/验收判据；未改任何 Accepted ADR 文件。
5. `git diff --stat` → `docs/design/00c-state-and-contract-atlas.md` +1 行、`docs/design/adr/README.md` +3 行、`tasks/slices/B49-core-semantics-and-adr-review.md` 重写；`docs/design/adr/ADR-0031-...` 新增（未跟踪，待 Lead 提交）。

### 8.2 链接可达清单

- ADR-0031：`docs/design/adr/ADR-0031-core-chain-semantics-narrowing-v3.md`（README §8.3 索引、00c §8.1 登记）
- 证据引用均为仓库内相对路径；`apps/...`、`frontend/src/...`、`scripts/...`、`docs/design/...` 均存在（逐个 grep/read 求证过）。
- 指向 B01/B43/B45/B12 的引用只写任务名/对账 ID，不新增死链（B01/B12 无独立任务文件时使用对账文件锚点，见 §9 残余）。

---

## 9. 残余、风险与恢复

1. **待作者裁决（blocked-by-author）**：R1–R7 全部未生效；ADR-0031 保持 Proposed。任务状态「评审材料 done，裁决待作者」；不得据此改生产代码。
2. **ADR-0022 状态未动**：仍为 Proposed；作者裁决 R4 后才可由作者/Lead 改状态。AI 不改历史决策段。
3. **ADR-0031 转 Accepted 的前置**：R1–R7 裁决 + `pending:` 项闭合（Form R decision 缺失断言、动作矩阵测试、词表同步测试、origin lineage、opaque 登记）+ adr_trace 通过 + 00c/README 状态同步。上述工作属于后续承接任务，不在本轮。
4. **受影响 ADR 的 `enforcement_gaps` 文案尚未回写**：按「不改历史 ADR 正文」约束，本轮不代改；若 ADR-0031 Accepted，需在 B43/B45 或后续文档批里对 ADR-0001/0002/0004/0007/0012 的 `enforcement_gaps` 追加"已由 ADR-0031 收窄"注记（不改最终决策段）。
5. **新发现（与本任务描述一致、需 Lead 知晓）**：
   - `agent_runs.origin_frame_ref` 可为合成字符串，不是真实 frame（F5，A 类补齐）；
   - `trace_summary.decision_type` 存在第三类生产者（`AdoptionDecision`、run 级 `plan_budget_shortfall`），持久化读取词表未完全登记（B43/B45）；
   - 探索内联读取不产生 `ToolRequest`/`ToolResult`，与 ADR-0001 修订的"trace 保留实际 ToolRequest/ToolResult"表述存在口径差（B39/AU-15 取证面，登记不抢范围）；
   - ADR-0007 的 `primary_next_action`、`retry_action`、`narrow_scope` 在全仓 0 命中，可直接退役，无需等实现。
6. **恢复方式**：先读本文件 §5/§7 与 ADR-0031；再读 B43/B45 的依赖；不要在没有作者裁决的情况下按旧 Accepted 字面改代码或按本 ADR 直接实现。B27 的实模门槛与 I10 继续独立。
7. **00c 既有坏链（非本轮引入）**：`docs/design/00c-state-and-contract-atlas.md` §9.13 有 20 条 `../../../tasks/...` 相对链接，从 `docs/design/` 解析不可达（HEAD `1ce14d5b` 即存在；正确前缀应为 `../../tasks/...`）。属全量对账任务 §6.3 的文档修正范围；本任务写作用域只允许最小追加，故未改，由 Lead/对账任务处置。
