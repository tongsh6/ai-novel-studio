# B49：主链语义收敛与 ADR 评审

- 状态：**done（2026-10-30 评审/逐项裁决/整体接受与承接登记完成；ADR-0031 Accepted、ADR-0022 Superseded；产品实施仍由原 B01/B43/B45 等承接）**。
- 登记日期：2026-10-27；来源：primary/reply-only/next_action/output contract 的 Accepted 字面与当前实现不同，ADR-0022 的历史语义也已被后续协议改变。
- 上游：ADR-0001/0002/0003/0004/0007/0012/0022/0023/0025、[B27](B27-systematic-prompt-and-intent-integration.md)、[B43](B43-gate-order-residual.md)、[B45](B45-schema-legacy-governance.md)。
- 本任务产物：评审材料、作者逐项裁决与已正式接受的 ADR-0031；本文档阶段完成不代表下游产品已实现/验收。
- 下游承接：[ADR-0031（Accepted）](../../docs/design/adr/ADR-0031-core-chain-semantics-narrowing-v3.md)、B01 Planner 语义、B43 Gate 残余、B45 schema legacy（对账 ID B18）、B12 S7；ADR-0022 已按作者明确授权转 Superseded。

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

> §3–§6 保留 2026-10-27 的实现证据与当时推荐。作者于 2026-10-29 选择 R2=A，已否决“普通回复不建执行裁决”的旧推荐；当前决策见 §7.5，ADR-0031 草案已据此改写，产品代码尚未改变。旧“仅 8 类”也不能覆盖新目标，R3 见 §7.6。

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
| reply-only 是否必须 OrchestratorDecision | A 补 reply-only decision / B 收窄为 DecisionTrace 解释 / C 新 ADR | **B+C** | reply-only 的为什么-没有工具/行为/写入问题已由 trace 完整回答，且被 Replay/前端消费；补 decision 会造第二份解释事实 | 若补 decision，须接通 producer、由该裁决派生 trace/replay 并处理历史兼容；不是必然重复两份事实，也不必新增模型调用 |
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

> 使用方式：作者对 R1–R7 逐项选「推荐 / 否决（并给方向）」；Lead 汇总后转 ADR-0031 的 Accepted 流程（或按否决方向重写）。**下表保留评审选项；已生效选择见后续逐项裁决记录，未选项继续待作者。**

| # | 事项 | 选项 | 推荐 | 影响 | 若否决的后续 |
|---|---|---|---|---|---|
| **R1** | 主链 turn 形态与 primary 边界 | (a) 按旧字面补齐 primary frame→primary plan 唯一性；(b) 收窄为 Form R（单 primary frame）× Form E（step frame + 单动作 plan + per-step re-gate）；(c) 维持现状、仅登记为文档化偏差 | **(b)，已确认，见 §7.2** | 决定 ADR-0001/0002 哪些段保留、`primary`/`primary plan` 是否退役；B01/B43 的实施边界 | 若 (a)：需先造出 primary plan 的载体与消费者（成本高、无当前需求）；若 (c)：治理状态继续失真，B45 无法为字段定性 |
| **R2** | reply-only 是否必须 `OrchestratorDecision` | (a) 补 reply-only decision；(b) 不产生 decision，`DecisionTrace` 是解释权威；(c) 维持现状并文档化偏差 | **A，已确认，见 §7.5；原推荐 B 未采用** | 保留并补齐 ADR-0004 #1/#2；明确统一类型与同源 Replay/Why，原省略 reply decision 推荐不再适用 | 若 (a)：需改 reply 的 decision 生产、trace/replay 投影、枚举和历史兼容；应从同一裁决派生 trace，不创建相互矛盾的两份权威 |
| **R3** | 统一裁决的类型与生命周期边界 | A 承载旧完整类型族与流程状态；B 保留真实使用/已确认必需类型（含 reply_only），裁决状态仅表示已形成决定；详见 §7.6 | **B，已确认，见 §7.7** | 不再限定现状 8 类；所有回合须有明确映射，执行进度是否另归 run/step 是本项取舍 | A 需逐状态生产/消费与适用规则；B 需与当前 run/step/trace 分工及历史读取保持一致 |
| **R4** | ADR-0022 状态处置 | (a) 接受现行语义（重写决策 1/2/3 后 Accepted）；(b) 新 ADR-0031 承接，ADR-0022 转 Superseded；(c) 就地标旧段关系注记、保持 Proposed | **B，已确认，见 §7.9** | 决定 ADR-0022 与 ADR-0031 的状态；N-NARR 与计划契约的最终归属 | 若 (a)：须显式修订 Proposed 稿并保留记录、处理与后续 ADR 的边界；若 (c)：旧稿继续仅作历史参考，不能冒充当前规范 |
| **R5** | ADR-0007 动作集与 `primary_next_action` | (a) 补齐旧动作/字段对应的实际产品链；(b) 退出无现役消费者的规范要求，保留真实动作与历史兼容 | **B，已确认，见 §7.11** | 决定 ADR-0007 冻结集收窄；前端动作区/按钮；恢复面归属 | 若 (a)：先明确真实场景、动作含义与 UI，再补 producer/handler/回执/验收；不能只补名字 |
| **R6** | 只读 output 校验范围 | (a) 全部统一 schema；(b) 四类分层（creative 强制 / 内部只读 opaque / 探索局部 contract / wire 单入口） | **B，已确认，见 §7.13** | 决定 ADR-0012 规则 4 收窄；B45 的 `$ref`/opaque 分类；内部契约与实际校验接线 | 若 (a)：须冻结内部输出 schema 并补统一验证接线；内部使用方已存在，缺的是正式 schema 绑定，不是没有消费者 |
| **R7** | A 类补齐是否授权（仅 origin frame lineage 一项） | (a) 本轮授权 B01 把 origin frame lineage 收敛为真实 frame 引用或显式 turn ref；(b) 只登记 gap，暂不补 | **A，已确认，见 §7.15** | 决定 B01 是否纳入首批；影响 Replay/Why 的 turn 入口 lineage 可追溯性 | 若 (b)：gap 保留，lineage 仍不可验证；B01 后续可再触发 |

### 7.1 2026-10-28 评审补充（推荐，不是裁决）

- 推荐仍为 **R1–R6 选 b、R7 选 a**；每项等待作者明确选择，ADR-0031 仍 Proposed，ADR-0022 不变。这里的 b/a 是上表逐项选项，不是 §5.1 的分类代号。
- **R1/R3/R5**：无当前消费者是收窄的证据，不能单独证明所有未来语义无价值。退役前须按 B45 核 producer/consumer、历史读取兼容与真实替代入口；不为旧枚举造功能，也不静默删除历史解释能力。
- **R6**：四类分层不等于内部只读无约束。opaque adapter 仍须有明确输入/输出类型、错误形状、作用域和真实消费者验证；模型可见观察须有来源与内容边界，wire 继续按现行入口校验。未能证明 typed contract 时不能仅删除 schema 声明了事。
- **R7**：先核 origin lineage 实际表达 turn 还是 frame。若只有 turn 身份，优先显式 turn ref 并说明历史兼容；需要真实 frame 消费者时才补可解析 frame 引用，不能制造空 frame 凑字段名。
- **实施后果**：B01 承接 origin lineage；B43 承接 Gate/幂等/blocked；B45 承接字段与 schema 退役。接受新 ADR 时如实保留未实现 `enforcement_gaps`；Accepted 不是“代码和真实页面验收已完成”。

### 7.2 C02-R1 裁决记录

- 日期：2026-10-29；来源：本聊天展示 R1 的 A/B/C 选项，推荐“保留总体任务与计划，每个执行动作绑定自己的步骤记录和单动作计划，并重新过门禁”后，作者回复原文 **“同意”**。
- 已生效选择：**R1=b**。普通回复保留自己的 turn/frame 记录，不强制生成业务执行计划；执行轮保留总体 AgentRun/AgentPlan，每个执行动作使用对应的 step frame 与单动作计划，并按当步状态重新检查。
- 边界：不取消总体计划，不把一次计划建议当作后续全部动作的批准；既有权限、预算、状态和采纳规则继续适用。只读探索按 C01/D5 的真实守卫与观察留痕处理，不为它伪造写动作执行记录。
- 尚未决定：R2 的 reply-only 执行裁决载体、R3–R7、ADR-0031 整体接受及 ADR-0022 状态。入口来源引用缺口仍归 R7，字段/历史兼容处置仍按 B45。
- 实施后果：后续 ADR-0031 收口据此明确主链边界，B01/B43/B45 按各自完整范围落地；本次只记录取舍，未改生产代码/schema 或任何 Accepted ADR 的历史决策段。当前进入 R2。

### 7.3 C02-R2 普通回复的裁决与留痕

- 状态：**done（作者已选择 R2=A，记录见 §7.5；仅决策闭合，生产实现仍缺）**。
- 场景：作者只是讨论人物动机，这一轮没有业务执行动作。系统仍需解释为何没有执行/写入、保留可回放记录；问题是是否还必须生成一份执行批准/阻断对象。
- 当前事实：reply 路径由 `TraceWriter.record/3` 生成 DecisionTrace，记录 frame/turn、no_tool_reason、no_write_reason 等；`TurnResultBuilder.maybe_add_decision(nil)` 允许没有 OrchestratorDecision。现有 replay/Why 消费 trace；这与 ADR-0004 要求每轮都有执行 decision 的旧字面有差异，不是没有留痕。

| 选项 | 推荐 | 影响 |
|---|---|---|
| A：所有回合都生成统一执行裁决，普通回复使用 reply_only | 可选 | 裁决对象接口更统一，但需新增 reply 生产路径、调整枚举与 trace/replay 投影并兼容历史；可以由同一裁决派生 trace，不必重复模型调用，也不能产生两份互相矛盾的权威 |
| **B：普通回复由现有 frame/DecisionTrace 解释；有执行动作才产生对应 OrchestratorDecision** | **推荐** | 复用真实生产与消费链，避免无动作时额外创建执行批准对象；普通回复仍须有可解释、可持久回放的记录，不减少审计 |
| C：暂不收敛，继续登记偏差 | 可选 | 运行行为不变，但规范差异继续开放，相关字段与消费者治理仍无最终结论 |

此选择不改变执行权限。若发生业务执行，必须进入既有裁决链；若回复前发生只读探索，必须保留真实查询与观察，不能以 reply-only 冒充“从未读取任何材料”。DecisionTrace 解释系统发生的事实，不伪造模型内心推理。本节保留提出时的 B 推荐；作者最终选择 A，见 §7.5。

### 7.4 裁决后状态流转



1. 按每项实际选择重写 ADR-0031 后再整体评审；R2 已选择 A，原推荐稿不能直接接受。接受门槛仍含 enforced_by/缺口复核、adr_trace 与必要索引同步。
2. R4 = (b) → ADR-0031 Accepted 后，作者/Lead 将 ADR-0022 状态改为 `Superseded`（替代者 ADR-0031）或按 (c) 加注记。
3. R7 = (a) → B01 把 origin frame lineage 列入首批 checkpoint；若 (b) → 在 ADR-0031 `## enforcement_gaps` 保留。
4. 任一 R 被否决 → 按"若否决的后续"重写 ADR-0031 对应段后再评审，不直接进入实现。

### 7.5 C02-R2 裁决记录

- 日期：2026-10-29；来源：本聊天展示 R2 的 A/B/C 选项后，作者回复原文 **“A”**。
- 已生效选择：**R2=A**。所有回合生成或幂等复用统一执行裁决；没有业务执行动作的普通回复明确为 `reply_only`，不再以“现状没有对象”作为省略裁决的规范理由。
- 权威与留痕：OrchestratorDecision 是执行裁决事实源；DecisionTrace 中的裁决字段从它派生/关联，工具、观察、返回内容等事实仍引用各自真实来源，不能建立互相矛盾的两份执行决定。不要求额外模型调用，也不让 Planner 批准自己的计划。
- 无动作边界：reply_only 不生成虚构的 MicroPlan，不批准业务动作、不写 canon，不伪造门禁全通过或工具调用。已有只读查询照实留痕；R1 的总体任务/计划与逐步裁决保持，不用一个 turn 级批准包办全部后续执行。
- 迁移范围：盘点形成作者回合结果的 reply/提问/能力缺口、业务执行、采纳/确认/取消和 run 停等出口，明确统一裁决与已有专业结果的映射；实际发生的写入或阻断不能一律塞入 reply_only。B43 承接裁决生产与链路，B45 承接类型/wire/trace/replay 兼容；旧记录缺裁决须诚实标记，不伪造历史已执行。
- 对 R3 的约束：`reply_only` 必须纳入统一裁决类型，原“仅保留当前 8 类”的推荐失效。新增消费者必要类型须有证据，具体类型全集与生命周期状态由 R3 处理。
- 本次已同步 ADR-0031 草案，仍 Proposed；未改 Accepted ADR 的历史决策段、生产代码/schema 或验收判据。该次 R2 选择未覆盖 R3–R7 与整份 ADR 接受，后续结果见各自裁决记录。

### 7.6 C02-R3 类型与状态决策材料

- 状态：**done（作者已确认修订后的 R3=B，见 §7.7；仅决策闭合，生产/枚举未改）**。
- 问题：统一裁决对象应只表达“本次决定是什么”，还是同时承担“收到输入→校验→派发→集成→输出”的整条执行进度？两种都须覆盖 R2 已确认的普通回复裁决，不再提供排除 reply_only 的方案。
- 当前事实：domain 定义 8 种类型，尚无 reply_only；typespec 声明 decided/failed/emitted，而生产 decision builder 当前仅产 decided。旧 ADR-0004 列出 9 个语义族、8 个生命周期状态，和当前 8 类不是简单数量差异；当前 allow_tool/allow_agent_run/replay_existing 与旧族也需映射。

| 选项 | 推荐 | 影响 |
|---|---|---|
| A：保留旧类型族及完整裁决生命周期，并补齐生产/消费 | 可选 | 能从统一裁决对象查看整条流程；需定义每种回合适用的状态转换、如何跳过不适用阶段，并与 AgentRun/AgentStep 同步，不能把未发生的 dispatch 等写成已发生 |
| **B：类型按真实行为及已确认能力维护；裁决状态只表达已形成决定，执行进度沿 run/step/事件记录** | **推荐** | 当前类型加必需的 reply_only 为起点，不以 9 这个数封顶；须逐出口映射，必要的新类型按消费者证据补。减少重复状态机，同时保持所有回合统一裁决；历史类型/状态保留读取兼容 |

B 的“已形成决定”不表示执行成功：reject、require_confirmation、fail_with_recovery 也可以是已形成的决定；实际工具失败、运行等待/取消和结果输出仍由真实运行状态与 trace 反映。尚未形成合法裁决的内部故障不能补写 decided 掩盖失败。即使采用 B，也必须保证作者/Replay 能查询整体过程，不能因分工而丢信息。

本项只裁决规范范围与职责，具体枚举映射、持久化和生产者/消费者测试在实施前冻结。原 8 类收窄表是历史建议；reply_only 已由 R2 确认必需，不能再退役。作者对修订后的 R3 选择见 §7.7；ADR-0031 已按该选择对齐，整份仍待正式接受。

### 7.7 C02-R3 裁决记录

- 日期：2026-10-29；来源：本聊天在 R2=A 后重新说明类型必须包含 reply_only，并展示“裁决维护完整执行生命周期”与“裁决记录决定/理由、进度沿 run/step/事件”两方案，推荐 B 后，作者回复原文 **“同意 推荐”**。
- 已生效选择：**R3=B**。保留所有回合统一裁决；裁决表达已经形成的决定与理由，当前新规范状态为 decided，执行进度与实际结果由 AgentRun/AgentStep/GateResult/事件表达并通过 trace 关联查询。
- 类型范围：按真实业务与已确认能力维护，reply_only 必须包含；当前 8 类加它只是审计起点，不把 9 冻结为永久上限。所有形成回合结果的出口须有明确映射，新增类型须同时有生产者、消费者与兼容方案。
- 语义边界：decided 不表示执行成功；允许、拒绝、要求确认、恢复等都可能是已形成的决定。执行后来失败不抹掉先前裁决事实；尚未形成合法裁决的内部故障不得伪补 decided，运行失败与未完成仍如实记录。
- 实施后果：B43/B45 在各自 CP 冻结枚举映射、状态分工、wire/trace/replay 与历史读取；旧 failed/emitted 等历史值不能直接变成无法读取。该选择不恢复重复执行状态机，也不丢失作者查询整个过程的能力。
- 本次同步 ADR-0031 草案，仍 Proposed；未改生产代码/schema 或 Accepted ADR 历史正文。该次 R3 选择未覆盖 R4–R7 与整体接受，后续结果见各自记录。

### 7.8 C02-R4 旧 ADR-0022 去向

- 状态：**done（作者已选择 R4=B，见 §7.9；旧稿状态变更仍待新 ADR 正式接受）**。
- 事实：ADR-0022 当前是 Proposed。它包含仍有价值的可修订计划与 N-NARR（模型过程叙事须能追溯到模型输出）；但每次观察后的评估方式已由 Accepted ADR-0023/0025 演进，旧常驻计划面板的验收前提也已改变。不能把整份旧稿原样当作当前规范。

| 选项 | 推荐 | 影响 |
|---|---|---|
| A：明确修订旧 Proposed 稿，再接受其现行版本 | 可选 | 保留原编号入口；必须保留修订记录并与 ADR-0023/0025/0031 划清边界，避免两份当前规范重复或冲突。它不是修改已 Accepted 历史正文，但也不能悄悄改写旧设计意图 |
| **B：由 ADR-0031 承接仍有效规则，待新 ADR Accepted 后将 ADR-0022 标为 Superseded** | **推荐** | 当前规范集中、历史来路保留；保留适用范围内的计划/重规划与 N-NARR，旧评估/UI 条款指向已生效后续决策。不是删功能、删文档或抹去证据 |
| C：保留 Proposed，只补关系注记 | 可选 | 最少状态变动，旧稿只供历史参考；仍需明确哪些段已失效，不能将其作为独立当前实现依据 |

若选 B，先确定处置方向，等 ADR-0031 整体正式接受时再同步旧稿状态和替代关系；不提前用 Proposed 新稿替换现行规范。本项不接受 R5–R7，也不改任何历史实现证据。

### 7.9 C02-R4 裁决记录

- 日期：2026-10-29；来源：本聊天说明 ADR-0022 中有效计划/叙事规则与已演进的评估/UI 条款，推荐“由 ADR-0031 承接有效规则，新 ADR 正式接受后旧稿标 Superseded”后，作者回复原文 **“同意”**。
- 已生效选择：**R4=B**。ADR-0031 承接 ADR-0022 的现行有效规则与适用边界；ADR-0031 正式 Accepted 后，按本次授权将 ADR-0022 标为 Superseded 并注明替代关系，保留旧文档及历史证据。
- 保留内容：适用范围内的可修订计划、模型过程叙事来源真实性（N-NARR）；观察后的评估与调用协议沿后续已接受 ADR-0023/0025，旧常驻计划面板不因本项恢复。
- 实施边界：这是规范归属调整，不删除已有功能或证据，不静默重写旧决策段。当前 ADR-0031 仍 Proposed，故尚未提前变更 ADR-0022 状态；后续满足条件时落实已选方向，无需重问同一去向。
- 该次 R4 选择未覆盖 R5–R7 与 ADR-0031 整体接受，后续结果见各自记录。本次仅更新材料与草案，无生产代码/schema 修改。

### 7.10 C02-R5 旧动作与字段的规范边界

- 状态：**done（2026-10-30 作者已选择 R5=B，见 §7.11；仅决策闭合，代码/字段/历史记录未删除）**。
- 场景：普通讨论已回复，作者可以继续输入，不一定需要“继续对话”按钮；而正文候选需要真实的采纳、放弃或编辑后采纳入口。规范应明确哪些动作是真实可执行承诺，避免旧枚举或字段要求与当前页面各自一套。
- 当前事实：现役动作主要由 `available_actions` 与 active behavior 驱动；§3.3 的 `continue_dialogue` 是旧默认分支，`no_further_action` 属旧 enum/validator，`retry_action`/`narrow_scope` 没有当前实际 producer，`primary_next_action` 是旧字段要求。它们并非“五个都已存在的按钮”；`next_action`/`required_next_action` 的兼容处置还须逐字段核读写方。

| 选项 | 推荐 | 影响 |
|---|---|---|
| A：按旧契约集合补齐实际产品能力 | 可选 | 为旧动作/字段明确触发、权限、目标、UI、handler 与回执/回放，必要时新增能力；需要真实使用场景和完整验收，不能只给枚举补 producer 凑数 |
| **B：退出无现役消费者的旧规范要求，当前动作由真实生产/消费链定义** | **推荐** | 保留采纳/放弃/编辑、澄清确认、候选选择和预算恢复等真实入口；旧字段标 legacy 或删除由 B45 逐项处理，历史读取仍兼容，不把清理等同删除历史数据 |

B 只收敛当前规范，不永久禁止未来的重试/缩小范围能力。已有同等体验保留；未来真实需求可经现有动作机制扩展，不能仅凭旧名字没人读便宣称产品不需要该体验。实际有消费者的字段不得按名单盲删，必须先核可达性和替代承接；普通回复可以没有可提交业务动作，但仍有 R2 的统一裁决与真实解释记录。

作者已选择 B，记录见 §7.11。实现/删除必须在后续 slice 内完成生产者、前端、Channel、回执、历史回放和真实页面回归，不在本次文档讨论中动代码。

### 7.11 C02-R5 裁决记录

- 日期：2026-10-30；来源：本聊天展示“按旧集合补齐能力”与“退出无现役消费者的旧规范要求、保留真实动作和历史兼容”，推荐 B 后，作者回复原文 **“同意”**。
- 已生效选择：**R5=B**。当前动作规范以真实生产、可达操作与消费链为依据；无现役消费者的旧动作/字段要求退出当前规范。已有采纳/放弃/编辑、确认澄清、候选选择、预算恢复及同等体验继续保留。
- 边界：不是按名字盲删字段或历史数据，也不永久禁止未来重试/缩小范围等能力。逐项核查调用方、可达性、真实替代与读取兼容；将来有实际需求时通过现有动作机制扩展。
- 与 R2 的关系：普通回复仍须统一裁决，但可以没有可提交业务动作，作者可继续自然输入；不为满足旧字段要求创造无用途按钮。
- 实施后果：B45 等承接代码/生成物/字段的 legacy、迁移或删除；需覆盖前端、Channel、回执、历史回放和真实页面。本次只记录范围并同步 ADR-0031 草案，未执行清理。
- 该次 R5 选择未覆盖 R6–R7 与整体接受，后续结果见对应记录。ADR-0031 仍 Proposed，ADR-0022 尚未按条件迁移。

### 7.12 C02-R6 输出校验方案

- 状态：**done（2026-10-30 作者明确选择 R6=B，见 §7.13；校验实现未改）**。
- 场景：模型生成的正文候选缺正文/引用字段，或程序读取的角色阵容结构不对，都可能影响后续展示、模型输入和采纳。要决定的是如何用一致、可追溯的契约拦住这些问题，而不是只读结果是否可以不检查。
- 当前事实：创作 artifact 已经走 ToolOutputContract；内部 text_analysis/character_roster adapter 构造 map，registry 有 output 名称但没有对应 JSON schema。它们有内部使用方，不应写成“没有消费者”；现有 map 形状或 typespec 也不自动证明运行时已严格验证。inline 探索另有 observation 契约，前端 wire 与关键局部对象有现行校验入口。

| 选项 | 推荐 | 影响 |
|---|---|---|
| A：各类工具输出分别有正式 schema，采用统一 Schema 校验机制 | 可选 | 规则集中、机器可查，增加内部读取输出的 schema/登记/验证接线与维护；每类结构仍各自定义，不强迫所有输出长成同一形状，也不必把 inline observation 伪装成 ToolResult |
| **B：按消费边界分层，所有输出都有明确契约和相应校验** | **推荐** | 创作 artifact 保持强 output contract；内部读取明确类型、必要字段、错误形状与必要运行时检查；模型观察验证来源/范围/结果等契约；wire 复用现行同源规则。减少无用途结构升格为公共 schema，但需防止每个 adapter 各自放宽 |

两方案共同底线：无效结构不能未经契约定义地静默变成“成功空结果”；跨作品/版本/来源限制继续成立；失败可解释并可追踪。进入模型、前端、持久化或采纳边界的内容不能仅以“内部数据”为由放弃验证，输出 schema 也不替代权限、版本、因果绑定与语义质量检查。

B 中 opaque 仅表示不承诺统一的公开 JSON schema，不表示任意 map 都可通过。B45 必须明确真实 contract owner/消费者与错误处理；悬空 schema 引用不得伪装成已经校验。跨层复用同一 schema 不是“两份真源”，禁止的是另写互相漂移的规则。R6 不单独冻结 wire 的告警/阻断政策，关键动作与采纳字段继续遵守已有强校验。

作者已明确选择 B，记录见 §7.13。具体工具字段及错误矩阵由实现 CP 冻结；本次不改代码/schema、不安装验证库、不取消已有校验。

### 7.13 C02-R6 裁决记录

- 日期：2026-10-30；来源：本聊天提出统一 Schema 机制与分层契约两种方案，明确内部结果也须验证，推荐 B 后，作者回复原文 **“同意推荐，R6 选 B。”**。
- 已生效选择：**R6=B**。按消费边界分层：创作候选保持强 output contract；内部读取明确类型、必要字段、错误形状与必要运行时检查；探索观察有来源/范围/结果契约；wire 复用现行同源校验规则。
- 共同底线：不因只读或内部数据而免检，不将结构错误未经契约定义地变成成功空结果；来源、权限、版本和采纳约束独立有效。opaque 不等于任意数据可通过，typespec/已有 map 形状也不自动证明运行时验证完整。
- 单一真源：明确 contract owner 与实际消费者；跨层复用同一 schema 可以成立，不能另写互相漂移的规则。R6 不额外冻结整体 wire 的告警/阻断政策，不取消关键动作/采纳字段已有强校验。
- 实施后果：B45 等核对悬空 schema、内部契约和验证接线，补失败/空结果等矩阵及真实消费者回归。ADR-0031 草案已对齐，代码/schema/依赖未改，不把规范选择当验证已经落地。
- 该次 R6 选择未覆盖 R7 与 ADR-0031 整体接受，后续结果见对应记录；ADR-0022 的条件状态迁移保持 R4 结论。

### 7.14 C02-R7 入口来源引用方案

- 状态：**done（2026-10-30 作者明确选择 R7=A，见 §7.15；尚未修改来源引用实现或存量数据）**。
- 场景：要解释一次写作任务由哪次输入/回合触发，或恢复/回放它的来源，执行记录中的引用应能对应到真实来源。系统已有 turn 关联，但不能让另一个名为 frame_ref 的字段看起来指向 frame、实际却只有合成标签。
- 当前事实：`DialoguePlanningService` 未收到 origin_frame_ref 时使用 `frame_` 拼 turn_id；实际 judgment frame_id 使用 turn_id 与 provider call 的 hash 构造，二者不保证相同。持久字段 `agent_runs.origin_frame_ref` 是 string，没有证明此合成值对应真实 frame。这是引用语义与可核验性缺口，不据此宣称已有错误执行或作品污染。

| 选项 | 推荐 | 影响 |
|---|---|---|
| **A：补齐与真实来源一致、可解析的入口引用** | **推荐** | 优先复用已有 turn/作者输入关联；若实际来源是 turn，就显式表达 turn；只有真实 frame 消费需要时才绑定真实 frame。同步生产/存储/trace/回放和历史兼容，增强来源可信度 |
| B：保持当前实现，明确登记引用不可验证的缺口 | 可选 | 无行为改动，现有其它关联仍保留；该字段的语义风险继续开放，不能宣称所有来源引用已可核验 |

A 不要求为满足字段名字虚构或新增空 frame，也不另建平行身份体系。具体采用真实 frame 引用、显式 turn 引用或迁移现有字段，由消费者审计后选择最小方案；来源类型、作品/会话范围与对象存在性须一致。旧记录不能伪补成过去已存在的 frame，应保留原值及可确定的映射/未知状态。

承接沿原 B01 Planner/来源语义条目与 B43/B45 边界；真实页面 Why/回放需能追到实际触发来源，错误/跨作品引用负例和历史恢复须分别验证。作者选择 A 的记录见 §7.15；本次未修改持久字段或存量数据。

### 7.15 C02-R7 裁决记录

- 日期：2026-10-30；来源：本聊天提出真实、可解析的来源引用与暂留缺口两方案，推荐 A 后，作者回复原文 **“同意推荐，R7 选 A。”**。
- 已生效选择：**R7=A**。任务入口引用必须与真实来源一致且可解析；优先复用已有输入/turn 关联，实际来源是 turn 就明确表达 turn，确需 frame 时才引用真实存在的 frame。
- 实施边界：不为了字段名称制造空 frame，不另造身份体系；生产、存储、trace、回放和历史兼容一起处理。旧记录不能伪补成过去存在过的 frame；能证明的映射与未知状态分别保留。
- 验证后果：真实页面 Why/回放可追到实际触发来源，并覆盖错误引用、跨作品/会话、恢复和旧记录读取；不是凭字段字符串格式就宣称可追溯。没有据此认定已有错执行或作品污染事故。
- 承接：原 B01 Planner/来源语义边界，精确入口见本文件 §7.16；B43/B45 消费对应身份与兼容规则。此次仅记录裁决，未改产品代码、schema 或存量数据。
- R1–R7 逐项取舍已齐；进入 ADR-0031 整体正式接受，不自动接受其它 C 项。

### 7.16 C02 实施基线收口

- 状态：**done（2026-10-30 作者明确正式接受 ADR-0031 并授权 ADR-0022 转 Superseded；文档状态与承接已落实）**。
- 接受来源：本聊天在呈现对齐后的 ADR-0031、实现承接及保留缺口后，作者回复原文 **“同意，正式接受 ADR-0031 为实施基线，按 R4 将 ADR-0022 标为 Superseded，继续下一项裁决。”**。
- 已接受文件：[ADR-0031](../../docs/design/adr/ADR-0031-core-chain-semantics-narrowing-v3.md)。它保留每步执行边界、补齐所有回合统一裁决、分离裁决与执行进度、保留有效计划/叙事规则、治理旧动作、分层校验，并补齐真实来源引用。
- 已选方案：R1=B、R2=A、R3=B、R4=B、R5=B、R6=B、R7=A；原 R2=B 和“仅 8 类”推荐已经失效，草案不能继续把它们作为目标。
- 真实承接：
  - [B01 入口来源与语义边界](../2026-10-27-design-to-execution-reconciliation.md#b01-入口来源与语义边界)：R7 入口引用与原 Planner 语义边界；R7 局部完成不关闭原 B01 其余范围。
  - [B43](B43-gate-order-residual.md)：R1–R3 的各回合统一裁决 producer、逐步 gate、trace/结果/回放与原幂等/blocked 全链。
  - [B45](B45-schema-legacy-governance.md)：R3/R5/R6 的 schema/词表/wire/历史兼容、真实动作和分层输出契约/必要边界校验；不再将它误写为“现行 v3 完全不变”的纯清理。
  - R4 的 ADR-0022 状态迁移在 ADR-0031 正式 Accepted 后生效，保留旧稿原文与历史证据；S7 非预算恢复仍沿原 B12/DS03 入口，不丢失其未闭环范围。
- 接受范围：接受规范及上述承接，不表示普通回复 decision、来源校验、字段退役或真实页面已经实现。具体字段全集/迁移细节由对应 CP 冻结，不预先创建新表、卡型或第二运行时。
- 历史保护：旧 Accepted ADR 的最终决策段保持；接受新 ADR 后仅追加明确承接/修订关系与缺口注记。未实现项留 enforcement_gaps，不能以通过路径检查代签运行效果。
- 状态变更已执行：ADR-0031 Accepted、ADR-0022 Superseded，旧稿正文保留；原 B01/B43/B45 的该项设计前置解除。未修改代码/schema、未运行产品/实模，也未提交 Git；本会话继续 C03。
- 接受后验证（2026-10-30）：NEXT 与 diff 检查通过，本地文档链接 259/259 可达；ADR 追溯为 30/30 Accepted、338 refs。五份旧 Accepted ADR 的 enforcement_gaps 之前内容逐字不变，ADR-0022 原关系说明及历史正文逐字保留；只新增规范关系与状态元数据。这些检查不代替下游产品验收。
- 收口验证（2026-10-30，**接受前快照，已被同节“接受后验证”取代，不得当作当前状态**）：`node scripts/next_task_check.mjs` 与 `git diff --check` 通过；修改文档本地链接 243/243 可达，ADR-0031 的 22 个既有基础引用均存在；`mix run --no-start scripts/adr_trace.exs` 为 29/29 Accepted、316 refs（该次运行时 ADR-0031 尚未被作者接受、仍按 Proposed 跳过）。上述仅为文档/引用证据，不是产品验收；当前状态以同节接受后验证（30/30 Accepted、338 refs）与 2026-10-30 基线门禁为准。

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

> 2026-10-30 更新：整体接受与旧稿迁移已完成，当前执行状态以 §7.16 及接收任务为准；下方旧评审证据仍保留日期，不能当成当前未接受。

1. **设计裁决已完成**：R1–R7 与 ADR-0031 整体接受均有作者明确记录，见 §7.16；实现/验收缺口继续由接收任务维护，不由文档完成代签。
2. **ADR-0022 状态已迁移**：按 R4 与本次明确授权转 Superseded，保留历史决策正文。
3. **ADR-0031 转 Accepted 的前置**：R1–R7 裁决 + `pending:` 项逐条复核（已实现者提供真实引用，未实现者保留 enforcement_gaps 并指定承接）+ adr_trace 通过 + 00c/README 状态同步。不能要求未接受前先实现全部目标，也不能删除缺口伪报完成。
4. **受影响 ADR 的承接注记已回写**：ADR-0001/0002/0004/0007/0012 的 enforcement_gaps 已追加当前规范关系；历史最终决策段保持，产品/测试缺口不因关系注记关闭。
5. **新发现（与本任务描述一致、需 Lead 知晓）**：
   - `agent_runs.origin_frame_ref` 可为合成字符串，不是真实 frame（F5，A 类补齐）；
   - `trace_summary.decision_type` 存在第三类生产者（`AdoptionDecision`、run 级 `plan_budget_shortfall`），持久化读取词表未完全登记（B43/B45）；
   - 探索内联读取不产生 `ToolRequest`/`ToolResult`，与 ADR-0001 修订的"trace 保留实际 ToolRequest/ToolResult"表述存在口径差（B39/AU-15 取证面，登记不抢范围）；
   - ADR-0007 的 `primary_next_action`、`retry_action`、`narrow_scope` 在全仓 0 命中，可直接退役，无需等实现。
6. **恢复方式**：先读本文件 §5/§7 与 ADR-0031；再读 B43/B45 的依赖；不要在没有作者裁决的情况下按旧 Accepted 字面改代码或按本 ADR 直接实现。B27 的实模门槛与 I10 继续独立。
7. **00c 既有坏链（非本轮引入）**：`docs/design/00c-state-and-contract-atlas.md` §9.13 有 20 条 `../../../tasks/...` 相对链接，从 `docs/design/` 解析不可达（HEAD `1ce14d5b` 即存在；正确前缀应为 `../../tasks/...`）。属全量对账任务 §6.3 的文档修正范围；本任务写作用域只允许最小追加，故未改，由 Lead/对账任务处置。
