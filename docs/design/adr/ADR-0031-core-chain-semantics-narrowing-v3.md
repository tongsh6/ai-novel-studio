# ADR-0031：主链语义收窄——primary / reply-only / 裁决与只读输出边界 v3

- 状态：Proposed（2026-10-27 起草；评审材料见 `tasks/slices/B49-core-semantics-and-adr-review.md`，**待作者裁决，未授权实现**）
- 日期：2026-10-27
- 来源文档：
  - `../00c-state-and-contract-atlas.md` §4 / §5.3 / §6.1 / §6.3 / §6.5 / §7 / §8
  - `../00b-end-to-end-dialogue-flow.md` §1-7
  - `../04-execution-orchestrator.md` §1-9
  - `../contracts/VS-00-reply-only-contract-pack.md`、`../contracts/VS-01-execution-authority-contract-pack.md`
  - `../contracts/UA-01-unified-agent-run-loop-contract-pack.md`、`../contracts/VS-05-ui-roundtrip-contract-pack.md`
  - `tasks/slices/B49-core-semantics-and-adr-review.md`（评审证据矩阵）
  - [B13b 对账](../../../tasks/slices/B13B-adr-enforcement-reconciliation.md) 的 enforcement_gaps 逐条裁决
- 影响范围：Dialogue / Execution / Toolbox / Trace / UI / Umbrella / Slice
- 相关不变量：`00c` §7 #1、#2、#3、#4、#5、#9、#10、#12、#14、#16（N-NARR）、#17（N-PLAN）
- 首个证明 slice：B49（评审与裁决材料）；实施分别由 B01（Planner 语义）、B43（Gate/blocked）、B45（schema legacy）、后续清理 slice 承接
- 取代：无
- 取代者：无
- 收窄/承接关系（不是直接改写历史 ADR）：
  - **收窄** ADR-0001 决策 #3/#4（"primary frame 与 primary MicroPlan" 的载体）、#5 的 reply-only 解释载体；
  - **收窄** ADR-0002 决策 #1-#3（"一个 primary frame 至多一个 primary MicroPlan" 无执行载体）；
  - **收窄** ADR-0004 决策 #1/#2（reply-only 不产生 OrchestratorDecision）、#5/#6（decision_type / decision_status 子集）、#7（"默认最多批准一个下一步写入" 的载体改为 per-step re-gate）；
  - **收窄** ADR-0007 冻结动作集（退役无生产者动作）与 `primary_next_action`；
  - **收窄** ADR-0012 规则 4（只读 output 的校验分层）；
  - **承接** ADR-0022 决策 1 的现行实现边界与决策 3（N-NARR 原样保留）；ADR-0022 决策 2 的现行执行语义已由 ADR-0023（Accepted）修订、调用协议已由 ADR-0025 §5（Accepted）/B26/B27 改变。

> **边界声明**：本 ADR 不修改任何 Accepted ADR 的正文与最终决策段。它把"当前真实主链已选择的语义"写成一份可评审的收窄提案；作者接受前，Accepted ADR 的原文仍按原样有效，实现差异由各 ADR 的 `## enforcement_gaps` 记录。本 ADR 也不授权任何代码/schema 改动：实施按 B01 / B43 / B45 及其它承接 slice 逐项进入。

---

## 背景

v3 主链有两条真实形态：

1. **回复轮（Form R）**：`judgment_loop_v1` 的 reply / exploration / question / capability_gap 路径——一个 primary `DialogueFrame` + `DecisionTrace` + `TurnResult`，没有 `MicroPlan`，也没有 `OrchestratorDecision`。
2. **执行轮（Form E）**：`AgentRun`（单工具 profile、`judgment_plan_v1` 多步计划 profile、pending artifact 处理等）——每个进入 gate 的 step 各自构造一个 step `DialogueFrame`（`primary: false`）+ 单动作 `MicroPlan`，经 `ExecutionOrchestrator.decide/3` 产生一个 `OrchestratorDecision`，再派发工具或阻断。

而 Accepted ADR 的字面还要求另一组对象/字段：

- ADR-0001/0002/0004 要求"一个 primary `DialogueFrame` 至多产生一个 primary `MicroPlan`"，且 decision 必须引用 primary frame；
- ADR-0004 要求每个 turn（含 reply-only）都产生 `OrchestratorDecision`；
- ADR-0007 冻结的一组动作（`continue_dialogue` / `no_further_action` / `retry_action` / `narrow_scope` / `primary_next_action`）在实现中没有生产者或消费者；
- ADR-0012 规则 4 要求所有 `ToolResult` output 满足 registry output contract，但内部只读工具没有冻结 output schema；
- ADR-0022（Proposed）的决策 2 "每次 observe 后 evaluate" 与它的计划可视化 UI 证明，已经被 ADR-0023、ADR-0025 与 46§9.5 的后续拍板改变。

这些不是"文档写漏了"，而是**当前实现已经做出的语义选择没有被写成决策**。继续按旧字面补齐会制造无消费者的对象和字段（B13b 已逐条裁决为"降级/文档化偏差"）；把当前实现直接当 Accepted 又会静默改写历史决策。因此需要一份新 ADR 承接：逐项写明保留 / 收窄 / 退役，并给出真实 consumer 证据与未完成项。

---

## 决策范围

本 ADR 只裁决以下四组语义（对应 B49 的四个争议点），并顺带给出 ADR-0022 的现行语义承接：

1. **Turn 形态与 primary 边界**：Form R / Form E 各自必须有什么对象，`primary` 语义的规范化范围。
2. **reply-only 与 `OrchestratorDecision`**：哪些 turn 必须产生 `OrchestratorDecision`，谁承担非执行轮的解释权威，`decision_type` / `decision_status` 的当前子集。
3. **UI 动作集收窄**：`available_actions` 契约保留；逐项保留有真实生产者+消费者的动作，退役无生产者/无消费者的动作与 `primary_next_action`。
4. **只读 output 校验分层**：哪些输出必须有冻结 schema，哪些走显式 opaque/局部 contract；TurnResult 线格式的唯一校验入口。

另含**ADR-0022 现行语义承接**（第 5 组）：N-NARR / PlanStep / replan / evaluate / 调用协议 / UI 的现状与冲突处置建议。

## 非目标

- 不重建 Router、第二套 runtime、旧 Envelope 或第二套 trace。
- 不改变 ADR-0003 的 Planner 权限边界（建议权≠批准权），不改变 ADR-0005 的 12 门顺序，不改变 ADR-0010 的 adoption 写入边界。
- 不重写任何 Accepted ADR 的正文；不改历史决策段；不改 `ecosystem` 之外的产品代码。
- 不冻结完整 JSON Schema 字段全集；不新增持久化表/列。
- 不裁决与本 ADR 无关的动作面（例如 StructurePanel 直接经 Channel 提交的 `start_full_review` / `start_fact_inventory` / `merge_characters` / `adjudicate_finding`、UI 本地按钮语义）；它们不是 `TurnResult.available_actions` 契约的一部分，另行对账。
- 不把 B27 的语义 known-gap、B39 求证评审、I10 文学盲评混入本 ADR 的通过条件。

---

## 考虑过的方案

### 方案 A：按旧字面补齐

按 ADR-0001/0002/0004/0007/0012 的字面补齐 `primary` 校验、reply-only `OrchestratorDecision`、五个动作的 producer、`primary_next_action` 字段、全部只读工具 output schema。

- 优点：文档上"零偏差"，无需新的决策。
- 缺点：这些对象在真实主链上没有消费者（见 B49 证据矩阵），补齐等于为形式完整制造 dead contract；reply-only decision 还会与 `DecisionTrace` 形成两份解释事实；`primary` 字段补齐校验也不会被任何消费方读取；为内部只读工具冻结 schema 会把实现细节升格为 wire contract，违反 YAGNI 与"先有消费者再冻结"的治理口径。

### 方案 B：以当前实现为基准直接把偏差写成文档

把"文档化偏差"全量接受，不改任何决策文本，后续按当前实现开发。

- 优点：成本最低。
- 缺点：无法处理 ADR-0022 这类整份 Proposed 文档——它既有已实现部分（N-NARR/PlanStep），又有被后续 Accepted ADR 改写的部分（evaluate 语义/调用协议）；"全部文档化偏差"会让 Proposed 永远无法转 Accepted 或 Superseded，治理状态失真；也没有给 B01/B43/B45 提供可执行的收窄边界。

### 方案 C：新 ADR 承接不可共存段，内部逐项选择保留/收窄/退役（采纳）

新增本 ADR，把四组语义写成"当前有效契约"，逐项标注与旧 Accepted ADR 的收窄/承接关系；Accepted ADR 原文不动，由各 ADR 的 `enforcement_gaps` 保留偏差痕迹；ADR-0022 由本 ADR 承接现行语义后，作者再决定其状态（Superseded / Deferred / 重写后重新 Proposed）。

- 优点：不改历史、不造无消费者对象、可在作者裁决后一次性把"当前有效语义"落地为 B01/B43/B45 的可执行边界；ADR-0022 的历史冲突有了单一承接点。
- 缺点：需要在两处维护"历史原文 + 现行收窄"的映射；作者必须显式接受本 ADR，收窄才生效。
- 对 A 的保留：本 ADR 只对**有真实 consumer 的缺口**主张"补齐"（见下 `决策 1` 的 origin frame lineage、`决策 3` 的 behavior 动作 trace_ref），其余一律不补。

**选择 C。** 它是唯一能同时满足"历史不静默改写""不为形式完整造对象""B01/B43/B45 可执行"三项的方案。

---

## 最终决策

> 本节是 **Proposed 建议稿**。作者接受（本 ADR 转 Accepted）之前，以下内容不构成冻结决策；Accepted ADR 的原文与最终决策段保持历史有效，差异以各 ADR `## enforcement_gaps` 为准。

### 决策 1 — Turn 形态与 primary 边界

**1.1 Form R（回复/探索/提问/能力缺口轮）**
- 恰好一个 primary `DialogueFrame`；`primary: true` 在本形态内是规范字段（当前生产者 `dialogue_planning_service.judgment_frame/4`、`author_question.turn_result/2`、`dialogue_gateway` 的 cancel/reply 帧、`pending_artifact_workflow` 的回复帧）。
- **零 `MicroPlan`、零 `OrchestratorDecision`**；解释权威是本轮的 `DecisionTrace`（见决策 2）。
- `TurnResult.frame_ref` 指向该 primary frame；`DecisionTrace.frame_ref` 与之一致；Replay/Why 面读取 trace，不要求读取 frame 内部 schema。

**1.2 Form E（执行轮 / AgentRun）**
- run 入口记录一个 **origin frame 引用**（持久化字段 `agent_runs.origin_frame_ref`）；每个进入 gate 的 step 各自产生一个 **step `DialogueFrame`（`primary: false`）** + **恰好一个单动作 `MicroPlan`**，经 gate 后产生一个 `OrchestratorDecision`。
- **退役"一个 primary frame 至多一个 primary MicroPlan"规则**：它在当前实现中没有执行载体（step frame 生来即 `primary: false`，plan 的 `frame_ref` 在 decide 前被覆盖为 step frame：`agent_run_flows/judgment_plan.ex:607-608`、`plan_from_decision/3` 的 `run.origin_frame_ref` 初值在 `:1043-1069`）。ADR-0002 的其余决策（plan 是建议 envelope、单动作、per-step re-gate、默认下一步）全部保留。
- **`MicroPlan.primary` 与 `DialogueFrame.primary` 在 Form E 中非规范**：`primary` 字段全仓无读者（仅 struct 定义与 `MicroPlan.from_map` 的默认值）；保留为兼容字段，后续由 B45 决定移除或标 legacy，禁止为它新增校验。
- **补齐项（有真实 consumer 的缺口，A 类）**：`agent_runs.origin_frame_ref` 当前在用户消息入口被合成为字符串 `"frame_#{turn_id}"`（`dialogue_planning_service.ex:134`），并非真实 `DialogueFrame.frame_id`，且没有任何消费者校验它对应一个 frame。Replay/Why 需要可追溯的 turn 入口 lineage，因此本 ADR 要求：**origin frame ref 必须是本轮真实存在的 frame 引用，或显式改名为 turn ref 并停止冒充 frame 引用**。该语义由 B01（Planner 语义边界）承接实现与测试，不在本 ADR 授权。

### 决策 2 — reply-only 与 `OrchestratorDecision`

**2.1 执行裁决对象只在执行路径产生**

`OrchestratorDecision` 的规范范围收窄为：**每一个进入 `GateOrder` 的 `MicroPlan` 产生且只产生一个裁决**（allow / block / replay），以及 blocked 路径对应的结构化 trace。当前实现正是如此（`execution_orchestrator.ex` 的六个 decision builder + `blocked_decision_trace.ex`）。

以下 turn **不产生** `OrchestratorDecision`，并明确其解释权威：

| 非执行轮形态 | 解释权威（现状） | 证据 |
|---|---|---|
| reply-only 普通回复 | `DecisionTrace`（`decision_type=:reply_only` + `no_tool_reason` / `no_behavior_reason` / `no_write_reason` + `event_order`） | `trace_writer.ex:20-50,377-403`；`dialogue_planning_service.ex:1415-1440` |
| exploration / question_answer / capability_gap 回复 | 同上，`decision_type=:exploration` 或 reply 型 + `TurnResult.truthfulness.tool_called` | `trace_writer.ex:377-379,390-395`；`turn_result_builder.ex:74-86` |
| author action（candidate adoption / confirmation 结果 / cancel） | `AdoptionDecision` 的 trace summary / action 结果（自有 decision 类型） | `dialogue_gateway.ex:306-355,590-599`；`adoption_workflow.ex` |
| run 级停等（预算缺口、awaiting_author、failed） | AgentRun 状态 + `final_turn_result` + `trace_summary.decision_type`（如 `:plan_budget_shortfall`） | `agent_run_server.ex:2256-2345` |

因此 **ADR-0004 决策 #1/#2 按此收窄**：`reply_only` 不再是 `OrchestratorDecision.decision_type` 的取值，而是 `DecisionTrace.decision_type` 的取值。每一轮执行 turn（例如工具派发轮）仍必须同时有 `DecisionTrace` 与 `OrchestratorDecision`，两者通过 trace 的 decision 引用关联。

**2.2 `OrchestratorDecision.decision_type` 子集（保留 8 值）**

保留当前 8 个有生产者的取值：`downgrade_to_dialogue`、`require_confirmation`、`require_clarification`、`reject`、`fail_with_recovery`、`allow_tool`、`allow_agent_run`、`replay_existing`（`orchestrator_decision.ex:8-16`；构造点 `execution_orchestrator.ex:361-512`）。退役 ADR-0004 #5 中无生产者的：

- `reply_only` → 移到 `DecisionTrace` 词表；
- `allow_bounded_read_batch` → 只读批量由 `AgentRunPolicy.allow_bounded_read_batch` 与 readonly profile 承载（`agent_run_policy.ex:19,32`），无 gate 生产者；
- `cancel_or_close` → 行为关闭由 `BehaviorState` 终态 + `TurnResult.behavior_state.history` + behavior trace refs 承载（`dialogue_gateway.ex:362-470`），无 decision 生产者。

**2.3 `decision_status` 子集（保留 `:decided`）**

当前所有 builder 只产出 `:decided`（`execution_orchestrator.ex:368,397,420,447,479,502`）；`received/validated/gated/dispatching/integrating/emitted/failed` 在结构中无生产者。收窄为：`decision_status` 当前唯一规范值 `:decided`；生命周期进度由 `GateResult.order/outcome`、`DecisionTrace.event_order`、`AgentStep.status`、`AgentRun.status` 承担。新增状态必须同时新增真实生产者和消费者，不得只在 schema 里扩 enum。

**2.4 trace / decision 词表分层**

- `DecisionTrace.decision_type` 是 **turn 级解释词表**，当前生产者：`trace_writer`（reply_only / exploration / downgrade / confirmation_required / clarification_required / rejected / recovery / tool_allowed / tool_dispatched / agent_run_allowed / replay_existing）。
- `TurnResult.trace_summary.decision_type` 是 **turn/action 级解释词表**，除 `DecisionTrace` 外还有 `AdoptionDecision`（`adopt_tentative` 等）与 run 级结构（`plan_budget_shortfall`）。持久化读取端 `TraceReplayService.@decision_types`（`trace_replay_service.ex:16-20`）是当前消费词表的真源；**B43/B45 负责把新增取值纳入登记并补未知值处理**，不得静默回落 `:unknown` 后当作已解释。
- UI/Replay 的消费证据：前端 Why 面板读取 `trace_summary.decision_type` / `no_tool_reason` / `first_blocking_gate`（`frontend/src/lib/traceSummaryView.ts:90-91,281`）；`ReplayService` 从 `DecisionTrace` 构建报告（`replay_service.ex:18-38,61-90`）；`TraceReplayService` 由 `trace_replay_controller.ex:11` 消费。

### 决策 3 — UI 动作集收窄

**3.1 保留**：`TurnResult.available_actions` 仍是 UI 可提交动作的唯一来源（ADR-0007 核心语义不变）。保留以下有真实生产者+消费者的动作类型：

| action_type | 生产者 | 消费证据 |
|---|---|---|
| `answer_clarification` / `confirm_before_execute` / `reject_or_cancel_confirmation` / `cancel_pending_behavior` | `execution_orchestrator.ex:57-66,262-312` | `frontend/src/lib/workbenchActions.ts:42-68`；`WorkspaceChat.tsx` 行为动作消费 |
| `accept` / `discard` / `edit_then_accept` | `available_action_builder.ex:97-111`；`adoption_workflow.ex:1307` | `workbenchActions.ts:42-44,47-68`；`WorkspaceChat.tsx:2914-2935` |
| `choose_candidate` | `available_action_builder.ex:33` | `WorkspaceChat.tsx` 候选面板（`workbenchActions.ts:60` 排除通用区） |
| `author_choice` | `author_question.ex:90-110` | `AuthorQuestionReply.tsx:38`；`schemas.ts:49-62` 收紧校验 |
| `revise_from_findings` | `prose_revision_service.ex:308,634`（动作由 VS-00E 路径产出） | `WorkbenchActions.ts` 过滤 + `WorkspaceChat.tsx:2798-2810` |
| `agent_run_budget_next_step` / `agent_run_budget_next_steps_<n>` / `agent_run_budget_single_step_<n>` / `agent_run_budget_remaining_plan` / `agent_run_budget_selected_steps` | `agent_run_server.ex:2309-2324` | `WorkspaceChat.tsx:2895-2904,3079,4989` |

**3.2 退役**（当前无生产者或无消费者，B49 证据矩阵逐项给证）：

- `continue_dialogue`：唯一"生产者"是 `ExecutionOrchestrator.@default_behavior_next_action`（`execution_orchestrator.ex:53`）→ `BehaviorState.required_next_action` 默认值；但 `behavior_type` 只可能是 `:clarification` / `:confirmation`（`execution_orchestrator.ex:262-312`），默认分支不可达；`required_next_action` 无前端/Replay 消费者（前端只读 `behavior_state.active.behavior_type` / `behavior_id`：`WorkspaceChat.tsx:1625-1627,3057-3073`）。
- `no_further_action`：只存在于 `novel_foundation/lib/novel_foundation/enums/next_action.ex`（由 `docs/design/schemas/foundation/enums/next_action.json` 生成）与 `turn_result_validator_test.exs`；`TurnResultValidator` 全仓无生产消费者（仅测试调用）。退役。
- `retry_action` / `narrow_scope`：全仓 0 命中（应用/域/前端/schema），只出现在 ADR-0007 文本。退役。
- `primary_next_action`：全仓 0 命中（无生产者、无消费者、wire schema 无此字段）；`primary next step` 的真实载体是 `available_actions` + `behavior_state.active`。退役。
- **TurnResult 顶层 `next_action` 字段**：现有两个生产者（`author_question.ex:75` 写入 `"waiting_for_author"`；`agent_run_server.ex:2283` 写入 `"author_budget_recovery"`），无任何消费者（前端只在测试 fixture 出现）；且与旧的 UPPERCASE `NextAction` enum（`enums/next_action.json`）不是一套语义。退役字段；B45 负责 wire schema/legacy enum 的处置。
- `BehaviorState.required_next_action`：随 `continue_dialogue` 一并退出规范 next-step 载体；在字段被 B45 移除前不得新增消费者。

**3.3 恢复面归属**：`retry_action` / `narrow_scope` 原先设想的恢复能力，已由 DS03 AgentRun 控制坞的 `agent_run_budget_*` 动作组与 `available_actions` 承接（B13b 已有真实 Tauri 三场景证据）；本 ADR 不再为旧动作补 producer。

### 决策 4 — 只读 output 的 schema 校验分层

把"output 必须统一 schema 校验"收窄为**四类边界**（ADR-0012 规则 4 按此收窄）：

| 类别 | 要求 | 现状与证据 |
|---|---|---|
| (a) 创作/作者可见 artifact output（`ToolResult`） | **必须**有冻结 output contract，并由 `ToolOutputContract` 校验；`ToolResult` 不自动成为生产事实 | `novel_common/contracts/tool_output_contract.ex`；`creative_tool_adapter.ex:26-36`；`capability_registry.ex:17,33` |
| (b) 内部只读工具 output（`ToolResult`） | **显式 opaque**：adapter 自持 typed map，不要求 registry output schema；在 registry 标注 legacy/opaque | `text_analysis_adapter.ex:13-27`（typed map）；`character_roster_adapter.ex:18-23`；registry 声明 `text_analysis_output_v1` / `character_roster_result_v1`（`capability_registry.ex:45,60`）但**无对应 schema 文件**（`docs/design/schemas/foundation/` 下不存在） |
| (c) inline 只读探索（非 `ToolResult`） | 走局部 observation contract（`ExplorationService.observation`：tool/query/summary/refs/outcome/facts），不进入 `ToolRequest`/`ToolResult` | `exploration_service.ex:1-60`；`dialogue_planning_service.ex:670-740` |
| (d) TurnResult 线格式 | 唯一校验入口 = 前端 codegen v3 schema + barrel 收紧，**告警不阻断**；`additionalProperties=true` 是 draft 期政策 | `frontend/src/lib/schemas.ts:40-62`；`turnResultWire.ts:20-28`；`docs/design/schemas/foundation/turn_result_v3.json` |

具体规则：

1. 只有 (a) 类 output 有"必须统一校验"的硬要求；实现或冻结新 output schema 必须先有真实消费方。
2. (b)/(c) 类必须**显式登记为 opaque/局部 contract**（B45 落 legacy/现役分类与 `$ref` 可解释性），不得把 `z.any()` 或 adapter 内部 map 冒充 SSOT。
3. 局部 contract 保留：`ui_card.json`、`candidate_direction.json`、`artifact_adoption_entry.json`、`author_choice_action.json`（经 barrel 组合收紧，ADR-0024 决策 5）。
4. 显式 opaque 字段保留：`trace_summary`、`truthfulness`、`behavior_state`、`plan_step_selection` 等动态/派生信封（v3 已用 `z.record`/`z.any` 标注来源）。
5. **退役 SSOT 地位**：`turn_result_v2.json`、`phase_next_action_compat.json`、`NextAction` enum 与 `TurnResultValidator` 不再作为现役 SSOT（前者历史冻结；后三者仅测试调用/旧大写语义）；B45 决定保留兼容、显式 legacy 或退役。后端**不新增** TurnResult schema 二次校验（无消费者，重复校验只会造成两套真源）。

### 决策 5 — ADR-0022 现行语义承接

**5.1 决策 3（N-NARR）原样保留**：作者可见过程叙事的字节来源必须是模型输出，且有可机器校验的 source binding；app 模板不得冒充。现状：`AgentNarrativeSource` 校验 + `agent_narrative_source` 字段 + `run_n_narr.exs` driver（`scripts/scenario_invariants/run_n_narr.exs`；经 `ai_static_scan.sh:165-166` 执行）；`:author_reasoning` provider purpose 已存在（`apps/novel_agent/lib/novel_agent/provider/execution.ex:252`）。

**5.2 决策 1（AgentPlan / PlanStep 可视化 / 版本化 / 修订）按现行实现收窄**：

- 保留契约：`AgentPlan` 的 `plan_version`、`revision_reason`、`PlanStep` 的 `kind`（explore/act）、`status`（pending/active/done/skipped）、`description`（`agent_plan.ex:9-19,123-168`）；`plan_drafted` / `plan_revised` 事件与 revision 语义（`agent_run_server.ex:1330-1370`；`agentic_deviation_signal.ex:1-45`）。
- 收窄适用域：**只有模型判断需要计划的 run** 才由模型起草计划（`judgment_plan_v1`）；单工具 profile 的机械步骤序列不是计划、不发 `plan_drafted`（`mechanical_plan.ex:7` 及各 flow 注释；ADR-0025 决策 2 "计划按需"）。
- 收窄 UI 证明：46§9.5（2026-07-15 用户拍板）已移除常驻计划面板；`plan_drafted` / `plan_revised` / `PlanStep` 契约不变，前端仍消费计划步骤的结构状态与计数（`frontend/src/lib/agentRunTimeline.ts:211,324-343`；`WorkspaceChat.tsx:817-821`），但 **ADR-0022 "作者可见计划面板五态" 的 UI 证明不再有效**，不得作为该 ADR 转 Accepted 的垂直切面证明。

**5.3 决策 2（每次 observe 后 evaluate）已被后续 Accepted 决策改写，不承接**：

- ADR-0023 决策 2 已把"每次 observe 后 evaluate 折进每步 planner 调用"修订为"每次 observe 后确定性核对，命中 D1-D7 才发起一次 evaluate+replan 合并调用"（`agentic_deviation_signal.ex`）；ADR-0023 为 Accepted。
- 调用协议已由 ADR-0025 §5（Accepted，B26/B27 联合修订）改为单调用 auto 判断/续行（`judgment_protocol.ex:2`、`:514` `tool_choice: "auto"`）；`evaluation_of_last` 只在模型计划 run 的偏离/续行场景作为结构字段存在，不再是"每次 observe 都 evaluate"的独立轮次。
- 因此 ADR-0022 整份**不能原样转 Accepted**：决策 1 需要按 5.2 收窄、决策 2 已过时、决策 3 保留。

**5.4 ADR-0022 状态处置（作者裁决项，B49 决策包 R4）**：推荐作者在**接受本 ADR 后**把 ADR-0022 标为 `Superseded`（由本 ADR 承接决策 1 的现行边界与决策 3；决策 2 由 ADR-0023 的现行语义与 ADR-0025 承接）。备选：保留 Proposed 并在其正文顶部加"决策 2 已由 ADR-0023 修订、UI 证明已由 46§9.5 移除；现行语义见 ADR-0031"的关系注记。**不推荐**把 ADR-0022 原样转 Accepted 或直接重写其历史决策段。

---

## 决策理由

1. **先有消费者再冻结**：本 ADR 保留的每个对象/字段/动作都有真实生产者和真实消费证据；退役项逐项证明无生产者或无消费者。这样 B01/B43/B45 的实施边界是"删/不新增"，比"补"风险低。
2. **解释权威单一**：reply-only/探索轮用 `DecisionTrace` 解释，执行轮用 `OrchestratorDecision` 裁决；两者不竞争同一 turn 的解释事实。这保留了 ADR-0004 的"每个执行、等待、降级、拒绝和恢复路径都有结构化裁决记录"原则，同时不为不执行的轮制造对象。
3. **主链形态的真实边界**：Form R 的"一个 primary frame"与 Form E 的"per-step frame + per-step plan + per-step re-gate"是两套已验证的承载；继续要求"一个 primary frame 对应一个 primary plan"只会制造无人读的校验。
4. **只读输出分层符合 ADR-0012 的真实意图**：规则 4 的目标是防止作者可见 artifact 绕过 output contract，而不是要求所有内部工具都有 wire schema；显式 opaque 登记比冻结假 schema 更诚实。
5. **ADR-0022 不可原样接受**：它的决策 2 与现行 Accepted ADR-0023/0025 直接冲突，UI 证明已被 46§9.5 移除；新 ADR 承接是唯一不静默改写历史的路径。

---

## Contract 影响

### 收窄 / 退役（相对旧 Accepted 字面）

| 对象 | 变更 | 现行真源 |
|---|---|---|
| `DialogueFrame.primary` | Form R 规范；Form E 非规范兼容字段；不得新增校验/消费者 | `dialogue_frame.ex`；`dialogue_planning_service.ex:1693-1741`；`judgment_plan.ex:773-793` |
| "primary MicroPlan" 规则 | 退役；`MicroPlan` 保留为 per-step 建议 envelope | `micro_plan.ex`；ADR-0002 其余决策保留 |
| `agent_runs.origin_frame_ref` | A 类补齐：必须是真实 frame 引用或改名为 turn ref（B01 承接） | `dialogue_planning_service.ex:134`；`agent_run_record.ex:17` |
| `OrchestratorDecision` | 只用于 gate 裁决；`reply_only`/`allow_bounded_read_batch`/`cancel_or_close` 退役；`decision_status` 收窄为 `:decided` | `orchestrator_decision.ex`；`execution_orchestrator.ex` |
| TurnResult 顶层 `next_action` | 退役字段（无消费者） | `author_question.ex:75`；`agent_run_server.ex:2283`；`turn_result_v3.json` 可选遗留 |
| `BehaviorState.required_next_action` | 退出规范 next-step 载体 | `behavior_state.ex:216`；`trace_writer.ex:611` |
| ADR-0007 五个动作 | 退役（见决策 3.2） | 无生产者/消费者 |
| `primary_next_action` | 退役（ADR-0007 Contract 影响段） | 全仓 0 命中 |
| ADR-0012 规则 4 | 收窄为四类边界（决策 4） | `tool_output_contract.ex`；adapters；`capability_registry.ex:45,60` |
| ADR-0022 决策 1 / 2 / 3 | 1 收窄、2 不承接、3 保留 | `agent_plan.ex`；`agentic_deviation_signal.ex`；`agent_narrative_source.ex` |

### 新增（仅限有 consumer 的补齐，均不由本 ADR 授权实现）

- origin frame lineage 可验证性（B01）。
- trace/decision 词表同步与未知值处理（B43/B45）。
- 动作生产者/消费者矩阵的测试（B49 建议的后续验证，不新增产品对象）。

## Umbrella 边界影响

- `novel_domain`：`DialogueFrame` / `MicroPlan` / `OrchestratorDecision` / `AgentPlan` 的字段语义收窄登记；不新增 I/O 或业务状态。
- `novel_application`：Form R/Form E 的对象产生规则、trace/decision 映射、只读输出分层；不回退 Router/Envelope。
- `novel_agent`：tool adapter 的 output contract 分层（creative 强制 / 只读 opaque）；不改 Provider 协议。
- `novel_web`：不新增校验或动作；Channel 只转发 `TurnResult` / `event`。
- `frontend`：`available_actions` / `trace_summary` / `TurnResult` 校验面不变；退役动作不新增 UI 入口。
- `novel_persistence`：`agent_runs.origin_frame_ref` 语义说明；无新表/列。

## UI / Trace / Replay 影响

- **UI**：不新增按钮、卡片或动作；退役动作不得新增 UI 入口。`available_actions` 仍是唯一可提交动作来源；`behavior_state.active` 仍是确认动作显隐门控。
- **Trace**：Form R 必须能回答"为什么没有工具/行为/写入"（`no_tool_reason` / `no_behavior_reason` / `no_write_reason` + `event_order`）；Form E 必须能回答"哪个 frame/plan 进入了哪个 gate、裁决是什么"（decision + gate_results lineage）。
- **Replay**：默认不重新调用 provider；reply-only replay 从 `DecisionTrace` 重建（`ReplayService`），执行 replay 从 decision + gate lineage 重建（`TraceReplayService`）。未知 `decision_type` 必须可观测（不得静默 `:unknown` 无登记）。

## 垂直切面证明

- 本 ADR 本身由 B49 评审材料证明（证据矩阵，file:line）。
- 收窄落地后的第一证明：
  1. Form R：真实 Tauri 普通对话 → `DecisionTrace.decision_type=reply_only`、无 `OrchestratorDecision`、TurnResult 无 `next_action`/`required_next_action` 消费者、Why/Replay 可解释（复用 `au01-ordinary-chat-two-turn-roundtrip`）。
  2. Form E：单工具 run → step frame（`primary: false`）+ plan → gate → decision 链路可回放（复用 `agent-step-regate` / `agentic-loop-gate-deviation-replan`）。
  3. 动作矩阵：每个保留动作有 producer + Channel 提交 + 真实页面结果；退役动作 0 producer 断言。
  4. 只读输出：creative output contract 负例 + `text_analysis`/`character_roster` opaque 登记 + 探索 observation contract。
- 产品代码不得为验收新增感知逻辑（默认 no；本 ADR 不引入任何验收钩子）。

## 迁移与兼容

- Accepted ADR 原文不动；偏差痕迹保留在各 ADR `## enforcement_gaps`（B13b 裁决已登记，本 ADR 只做承接与收窄）。
- ADR-0022 状态由作者在接受本 ADR 后处理（Superseded 或加关系注记），不由 AI 代签。
- schema/code 清理按承接任务推进：B01（Planner/frame lineage 语义）、B43（gate/blocked/幂等）、B45（schema legacy/opaque/wire 字段）、B12（S7 非预算 awaiting surface）、后续清理 slice（字段退役实现）。
- 不得以本 ADR 为名恢复旧 multi-step / 旧 planner / 旧 Envelope 语义。

## 后续工作

- **B01 Planner 语义边界**：origin frame lineage 可验证性（真实 frame ref 或改名 turn ref）、PlannerBoundary 对 frame/plan 绑定的语义校验；不建第二套 Router/分类器。
- **B43 Gate 残余**：blocked 路径的 `first_blocking_gate` / `DecisionTrace` / `Replay` / no-tool-no-write 证据；decision/trace 词表与 `TraceReplayService.@decision_types` 同步；幂等输入一致性；open behavior/slot 统一进门。
- **B45 Schema legacy（对账 ID B18）**：`turn_result_v3` 可选 `next_action` 退役/标 legacy、`phase_next_action_compat`/`NextAction`/`TurnResultValidator` 的 legacy 地位、`text_analysis_output_v1`/`character_roster_result_v1` 显式 opaque 登记、`$ref`/`z.any()` 分类；不新增业务字段。
- **B12 S7 非预算 awaiting surface**：awaiting_author / no_progress 等非预算出口复用 `available_actions` + `trace_summary.decision_type` + `author_question`，不依赖 reply-only OrchestratorDecision，也不先建表。
- **ADR-0022 状态**：作者裁决后由作者/Lead 更新索引与状态（本 ADR 不代改）。
- 后续字段退役实现（`next_action`、`primary`、`required_next_action`）另开小步 slice 或随 B45 CP2 实施，不在本 ADR 内直接改代码。

## enforced_by

> **Proposed 阶段声明**：以下清单是"拟采用的实装证据映射"——所列文件已实现本 ADR 收窄后的现行语义，用于评审时核对；本 ADR **未 Accepted**，清单不代表决策已冻结或已验收。`- pending:` 条目必须在转 Accepted 前闭合（补测试/实现或改写入 `## enforcement_gaps`）。

- apps/novel_application/lib/novel_application/dialogue_planning_service.ex
- apps/novel_application/lib/novel_application/trace_writer.ex
- apps/novel_application/lib/novel_application/agent_run_flows/judgment_plan.ex
- apps/novel_application/lib/novel_application/execution_orchestrator.ex
- apps/novel_application/lib/novel_application/blocked_decision_trace.ex
- apps/novel_domain/lib/novel_domain/orchestrator_decision.ex
- apps/novel_domain/lib/novel_domain/dialogue_frame.ex
- apps/novel_domain/lib/novel_domain/agent_plan.ex
- apps/novel_application/lib/novel_application/replay_service.ex
- apps/novel_application/lib/novel_application/trace_replay_service.ex
- apps/novel_application/lib/novel_application/available_action_builder.ex
- apps/novel_application/lib/novel_application/agentic_deviation_signal.ex
- apps/novel_application/lib/novel_application/agent_narrative_source.ex
- apps/novel_agent/lib/novel_agent/tools/creative_tool_adapter.ex
- apps/novel_agent/lib/novel_agent/tools/text_analysis_adapter.ex
- apps/novel_agent/lib/novel_agent/tools/character_roster_adapter.ex
- apps/novel_application/lib/novel_application/exploration_service.ex
- frontend/src/lib/turnResultWire.ts
- frontend/src/lib/schemas.ts
- frontend/src/lib/workbenchActions.ts
- frontend/src/lib/traceSummaryView.ts
- scripts/scenario_invariants/run_n_narr.exs
- pending: Form R 无 `OrchestratorDecision` 的显式回归断言（reply-only 路径测试）
- pending: 动作 producer/consumer 矩阵测试与退役动作 0-producer 断言
- pending: trace `decision_type` 词表与 `TraceReplayService.@decision_types` 同步测试（含 `plan_budget_shortfall` 等 run 级取值）
- pending: origin frame lineage 合法性测试（B01）
- pending: 只读 output opaque 登记与 `$ref` 分类（B45）

## enforcement_gaps

- **ADR-0022 状态未处置**：本 ADR 转 Accepted 前，作者必须先裁决 ADR-0022（Superseded / Deferred / 重写）。本 ADR 不代改其状态。
- **origin frame lineage 仍不可验证**：`agent_runs.origin_frame_ref` 可由用户消息入口合成为 `"frame_<turn_id>"`（非真实 frame id），且无消费者校验这是 frame 引用；属 B01 待实现。
- **收窄后的回归/校验未落地**：`reply_only` 无 `OrchestratorDecision` 的显式回归断言、退役动作 0-producer 断言、`decision_status` 子集的 schema/校验同步均未新增（B43/B45）；origin frame lineage 的 A 类补齐见上一条。
- **字段退役未落地**：TurnResult 顶层 `next_action`、`DialogueFrame.primary`/`MicroPlan.primary`、`BehaviorState.required_next_action` 仍存在；本 ADR 只定语义，删除/标 legacy 由 B45 与后续清理 slice 执行。须保留持久化读取兼容（历史 TurnResult/trace）。
- **只读 output 分类未登记**：`text_analysis_output_v1` / `character_roster_result_v1` 仍是 registry 悬空引用（无 schema 文件）；B45 必须显式登记为 opaque 或退役该引用。
- **ADR-0007/0012/0002/0004 的 `enforcement_gaps` 文案未随本 ADR 更新**：按"不改历史 ADR 正文"约束，本 ADR 不代改；若作者接受本 ADR，B45/B43 或 B49 后续应把承接关系写回对应 ADR 的 `enforcement_gaps`（追加注记，不改最终决策段）。
- **探索内联读取不产生 ToolResult**：`ExplorationService` observation 与 ADR-0001 修订中"trace 保留实际 ToolRequest/ToolResult"的表述存在口径差；属 B39/AU-15 取证面，不在本 ADR 裁决范围，登记为跨任务残余。
