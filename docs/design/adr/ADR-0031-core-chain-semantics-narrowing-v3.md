# ADR-0031：主链语义收敛——逐步执行、统一裁决与输出边界 v3

- 状态：Accepted（2026-10-30，作者明确正式接受为实施基线；R1=B、R2=A、R3=B、R4=B、R5=B、R6=B、R7=A；产品与验收缺口保留）
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
- 取代：ADR-0022（2026-10-30 按作者 R4=B 生效；旧稿原文与历史证据保留）
- 取代者：无
- 收窄/承接关系（不是直接改写历史 ADR）：
  - **收窄** ADR-0001 决策 #3/#4（"primary frame 与 primary MicroPlan" 的载体）、#5 的 reply-only 解释载体；
  - **收窄** ADR-0002 决策 #1-#3（"一个 primary frame 至多一个 primary MicroPlan" 无执行载体）；
  - **保留并补齐** ADR-0004 决策 #1/#2 的统一裁决要求（R2=A，普通回复也产生 reply_only decision）；#5/#6 按 R3=B 区分裁决类型与运行生命周期，#7 的下一步批准仍以 per-step re-gate 承载；
  - **收窄** ADR-0007 冻结动作集（退役无生产者动作）与 `primary_next_action`；
  - **收窄** ADR-0012 规则 4（只读 output 的校验分层）；
  - **承接** ADR-0022 决策 1 的现行实现边界与决策 3（N-NARR 原样保留）；ADR-0022 决策 2 的现行执行语义已由 ADR-0023（Accepted）修订、调用协议已由 ADR-0025 §5（Accepted）/B26/B27 改变。

> **边界声明**：本 ADR 不修改任何 Accepted ADR 的正文与最终决策段。它区分既有主链事实与作者明确要求补齐的能力，形成已接受的实施规范；旧 ADR 的最终决策段保留历史，对应现行语义以本 ADR 的明确修订/保留关系为准，未实现部分由 enforcement_gaps 记录。产品实施按 B01 / B43 / B45 等完整 slice 推进，不由设计接受代签完成。

---

> 2026-10-29 作者选择 [B49 R2=A](../../../tasks/slices/B49-core-semantics-and-adr-review.md#75-c02-r2-裁决记录)。因此本稿不再推荐“普通回复省略执行裁决”；下文背景保留现实现事实，目标与缺口按统一裁决更新，R1–R7 的实际选择已齐，整体接受与后续状态以 [B49 收口](../../../tasks/slices/B49-core-semantics-and-adr-review.md#716-c02-实施基线收口) 为准。

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

这些不是"文档写漏了"，而是**当前实现已经做出的语义选择没有被写成决策**。不能机械地按旧全集补对象，也不能把当前实现自动当作正确规范。作者已逐项选择：保留总体计划和逐步门禁，补所有回合统一裁决，分离执行进度，治理旧动作/输出契约并修复真实来源引用。本 ADR 明确现有证据与未实现后果，保留旧决策历史。

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
- 不重写旧 Accepted ADR 的最终决策段；本轮只收口文档，产品改动分别按 B01/B43/B45 的真实边界和完整验收实施。
- 不在本 ADR 预定完整字段全集或新持久化表/列；对应 CP 先核既有载体与消费者，必要迁移需明确版本和历史兼容。
- 不裁决与本 ADR 无关的动作面（例如 StructurePanel 直接经 Channel 提交的 `start_full_review` / `start_fact_inventory` / `merge_characters` / `adjudicate_finding`、UI 本地按钮语义）；它们不是 `TurnResult.available_actions` 契约的一部分，另行对账。
- 不把 B27 的语义 known-gap、B39 求证评审、I10 文学盲评混入本 ADR 的通过条件。

---

## 考虑过的方案

### 方案 A：按旧字面补齐

按 ADR-0001/0002/0004/0007/0012 的字面补齐 `primary` 校验、reply-only `OrchestratorDecision`、旧动作的 producer、`primary_next_action` 等字段、全部只读工具 output schema。

- 优点：文档上"零偏差"，无需新的决策。
- 代价：旧全集需要新增并维护对应生产/消费链，不能只补字段或枚举；其中 R2 的 reply-only decision 已被作者单独选定，须让 trace 同源派生而非形成第二权威。旧 primary 强制关系、动作全集和统一输出 schema 则未被整体选用，分别以 R1/R5/R6 为准。

### 方案 B：以当前实现为基准直接把偏差写成文档

把"文档化偏差"全量接受，不改任何决策文本，后续按当前实现开发。

- 优点：成本最低。
- 缺点：无法处理 ADR-0022 这类整份 Proposed 文档——它既有已实现部分（N-NARR/PlanStep），又有被后续 Accepted ADR 改写的部分（evaluate 语义/调用协议）；"全部文档化偏差"会让 Proposed 永远无法转 Accepted 或 Superseded，治理状态失真；也没有给 B01/B43/B45 提供可执行的收窄边界。

### 方案 C：新 ADR 承接不可共存段，内部逐项选择保留/收窄/退役（采纳）

新增本 ADR，把四组语义写成"当前有效契约"，逐项标注与旧 Accepted ADR 的收窄/承接关系；Accepted ADR 原文不动，由各 ADR 的 `enforcement_gaps` 保留偏差痕迹；ADR-0022 已按 R4=B 于 2026-10-30 随本 ADR 接受转为 Superseded。

- 优点：不改历史、不造无消费者对象、可在作者裁决后一次性把"当前有效语义"落地为 B01/B43/B45 的可执行边界；ADR-0022 的历史冲突有了单一承接点。
- 缺点：需要在两处维护"历史原文 + 现行收窄"的映射；作者必须显式接受本 ADR，收窄才生效。
- 补齐范围：R2 已确认所有回合统一裁决，普通回复 decision 属新增生产链缺口；R7 已选择修复真实入口引用；其他项按各自已确认范围处理。无消费者或需求的对象不因旧字面而自动补造。

**采用新 ADR 承接方式，并按 R1–R7 的实际选择落实。** 这包含 R2/R7 的能力补齐，不能简化为“只收窄、只清理现状”。

---

## 最终决策

> R1–R7 已逐项确认，作者于 2026-10-30 明确正式接受本 ADR 为实施基线，并授权 ADR-0022 转 Superseded。来源与承接见 [B49 §7.16](../../../tasks/slices/B49-core-semantics-and-adr-review.md#716-c02-实施基线收口)。旧最终决策段保留，未实现缺口不因接受或引用检查通过而关闭。

### 决策 1 — Turn 形态与 primary 边界

**1.1 Form R（回复/探索/提问/能力缺口轮）**
- 恰好一个 primary `DialogueFrame`；`primary: true` 在本形态内是规范字段（当前生产者 `dialogue_planning_service.judgment_frame/4`、`author_question.turn_result/2`、`dialogue_gateway` 的 cancel/reply 帧、`pending_artifact_workflow` 的回复帧）。
- **无业务执行时零 `MicroPlan`，但必须生成或幂等复用统一 `OrchestratorDecision`**；普通回复类型为 `reply_only`，不批准业务动作。DecisionTrace 的裁决信息由该对象派生/关联（R2=A；实现待补）。
- `TurnResult.frame_ref` 指向该 primary frame；`DecisionTrace.frame_ref` 与之一致；Replay/Why 面读取 trace，不要求读取 frame 内部 schema。

**1.2 Form E（执行轮 / AgentRun）**
- run 入口记录与真实来源一致、可解析的引用（当前遗留字段为 `agent_runs.origin_frame_ref`，按 R7 确认真实 frame 或显式 turn 语义）；每个进入 gate 的 step 各自产生一个 **step `DialogueFrame`（`primary: false`）** + **恰好一个单动作 `MicroPlan`**，经 gate 后产生一个 `OrchestratorDecision`。
- **退役"一个 primary frame 至多一个 primary MicroPlan"规则**：它在当前实现中没有执行载体（step frame 生来即 `primary: false`，plan 的 `frame_ref` 在 decide 前被覆盖为 step frame：`agent_run_flows/judgment_plan.ex:607-608`、`plan_from_decision/3` 的 `run.origin_frame_ref` 初值在 `:1043-1069`）。ADR-0002 的其余决策（plan 是建议 envelope、单动作、per-step re-gate、默认下一步）全部保留。
- **`MicroPlan.primary` 与 `DialogueFrame.primary` 在 Form E 中非规范**：`primary` 字段全仓无读者（仅 struct 定义与 `MicroPlan.from_map` 的默认值）；保留为兼容字段，后续由 B45 决定移除或标 legacy，禁止为它新增校验。
- **补齐项（有真实 consumer 的缺口，A 类）**：`agent_runs.origin_frame_ref` 当前在用户消息入口被合成为字符串 `"frame_#{turn_id}"`（`dialogue_planning_service.ex:134`），并非真实 `DialogueFrame.frame_id`，且没有任何消费者校验它对应一个 frame。Replay/Why 需要可追溯的 turn 入口 lineage，因此本 ADR 要求：**origin frame ref 必须是本轮真实存在的 frame 引用，或显式改名为 turn ref 并停止冒充 frame 引用**。按 R7=A 由 [原 B01 执行小节](../../../tasks/2026-10-27-design-to-execution-reconciliation.md#b01-入口来源与语义边界) 承接生成/存储/trace/回放及历史兼容；优先复用已有输入/turn 关联，不制造空 frame、不伪补历史。本 ADR 已正式接受，可作为该任务实施输入；当前对应产品能力尚未实现。

### 决策 2 — 所有回合的统一裁决（R2=A）

**2.1 统一事实源与无动作分支**

每个回合对外形成 TurnResult 前，必须产生或幂等复用统一 `OrchestratorDecision`。普通回复明确使用 `reply_only`，解释为何没有业务执行/写入；不制造 MicroPlan、批准动作或虚假的 gate/tool 通过记录。新增裁决可以由应用根据本轮真实输入和判断确定性构造，不要求额外模型调用，也不让 Planner 批准自己的计划。

执行回合继续按 R1 逐步绑定 step frame/单动作 plan 并 re-gate；统一对象不等于一个 turn 级批准覆盖所有后续动作。回复前的只读探索仍有真实查询/观察证据，`reply_only` 不能被用来抹掉它们。

DecisionTrace 的执行裁决字段从该对象派生并关联 decision ref；工具结果、观察、采纳回执和运行状态继续来自各自真实生产者，trace 汇集这些事实，不独立生成第二份执行结论。Why/Replay 必须能从同一来源解释，无需重新调用 provider。

**2.2 各出口的迁移审计（未实现）**

| 当前出口 | 当前事实 | 必须完成的映射 |
|---|---|---|
| 普通 reply | 只有 DecisionTrace，TurnResult 可无 decision | 新增 reply_only decision，裁决字段投影同源；无业务动作/写入、幂等重放均有反例 |
| exploration / question / capability_gap 回复 | 由 frame/trace 表达，探索另有观察记录 | 按真实发生的行为映射统一裁决；有读取则保留读取事实，不虚构执行批准 |
| 作者采纳/确认/取消结果 | 已有 AdoptionDecision、action_result 等专业事实 | 盘点形成回合结果的入口并明确统一裁决与专业结果关系；实际写入/阻断不能笼统归为 reply_only，不重复业务授权或副作用 |
| run 预算停等/awaiting/failed | AgentRun 状态、final_turn_result、trace_summary | 统一裁决类型按具体行为映射，保留运行状态及原因；不能把等待或失败伪报普通回复完成 |

**2.3 类型与生命周期（R3=B，分项已确认）**

现有代码类型为 `downgrade_to_dialogue`、`require_confirmation`、`require_clarification`、`reject`、`fail_with_recovery`、`allow_tool`、`allow_agent_run`、`replay_existing`；R2 已要求增加 `reply_only`。因此原“仅 8 类、reply_only 只归 trace”的提案失效。各出口审计若需要其它类型，须同时明确生产者、消费者、状态与历史兼容；不以 9 这个数预先封顶。

作者已选择 R3=B：类型按真实行为及已确认需求维护；裁决对象表达已形成的决定与理由，当前新规范 decision_status 为 decided；运行进度与实际结果继续由 GateResult、AgentStep/AgentRun 状态和事件表达，通过 trace 关联供作者和回放查询。分项裁决见 [B49 R3](../../../tasks/slices/B49-core-semantics-and-adr-review.md#77-c02-r3-裁决记录)；整份 ADR 已于 2026-10-30 正式接受，实施仍按原任务逐项验证。

当前 builder 仅产 `decided`，虽然 struct typespec 也声明 failed/emitted。按 R3 选择，`decided` 不代表执行成功；拒绝或要求作者确认也可能是已形成的决定。尚未形成合法裁决的内部失败不得补写 decided 掩盖。

**2.4 词表与历史兼容**

当前 `DecisionTrace.decision_type` 与 `trace_summary.decision_type` 包含 reply_only、exploration、工具派发、作者采纳、预算停等等不同来源；`TraceReplayService.@decision_types` 是现有读取消费词表，不自动等于新增统一裁决的最终枚举。B43/B45 必须核定映射、同步读取与未知值可观测，不能靠统一改名丢失业务事实。

新回合必须满足统一裁决目标；旧持久记录若只有 trace，按历史格式读取并明确缺少独立裁决，不伪造过去已经产生的 decision。字段必需性与 schema 版本迁移在对应 slice 中冻结，不能直接破坏旧记录读取。

### 决策 3 — UI 动作集收窄

R5=B 已分项确认，作者选择与边界见 [B49 R5](../../../tasks/slices/B49-core-semantics-and-adr-review.md#711-c02-r5-裁决记录)。退出旧规范要求不等于立即删除代码/历史数据；逐项核消费者、可达性与替代，保留现役能力和历史读取。未来真实需求仍可扩展；R2 的统一裁决不强迫每轮出现业务按钮。

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

作者已确认 R6=B：按消费边界分层契约与校验；所有输出都须有相应验证，不以 opaque 豁免。分项记录见 [B49 R6](../../../tasks/slices/B49-core-semantics-and-adr-review.md#713-c02-r6-裁决记录)，整份 ADR 已于 2026-10-30 正式接受，实施仍按原任务逐项验证。

把"output 必须统一 schema 校验"收窄为**四类边界**（ADR-0012 规则 4 按此收窄）：

| 类别 | 要求 | 现状与证据 |
|---|---|---|
| (a) 创作/作者可见 artifact output（`ToolResult`） | **必须**有冻结 output contract，并由 `ToolOutputContract` 校验；`ToolResult` 不自动成为生产事实 | `novel_common/contracts/tool_output_contract.ex`；`creative_tool_adapter.ex:26-36`；`capability_registry.ex:17,33` |
| (b) 内部只读工具 output（`ToolResult`） | **显式内部契约**：adapter 明确类型/必要字段/错误形状与必要运行时检查；opaque 仅表示不承诺统一公开 JSON schema，须登记 owner/消费者，不是任意 map 免校验 | `text_analysis_adapter.ex:13-27`（typed map）；`character_roster_adapter.ex:18-23`；registry 声明 `text_analysis_output_v1` / `character_roster_result_v1`（`capability_registry.ex:45,60`）但**无对应 schema 文件**（`docs/design/schemas/foundation/` 下不存在） |
| (c) inline 只读探索（非 `ToolResult`） | 走局部 observation contract（`ExplorationService.observation`：tool/query/summary/refs/outcome/facts），不进入 `ToolRequest`/`ToolResult` | `exploration_service.ex:1-60`；`dialogue_planning_service.ex:670-740` |
| (d) TurnResult 线格式 | 复用现行 codegen v3 schema 与局部契约的同源规则；关键动作字段继续强校验；整体告警/阻断及扩展字段政策沿现行契约，R6 不额外冻结或豁免 | `frontend/src/lib/schemas.ts:40-62`；`turnResultWire.ts:20-28`；`docs/design/schemas/foundation/turn_result_v3.json` |

具体规则：

1. (a) 保持统一强 output contract；(b)/(c) 同样必须有明确契约和对应验证。R6=B 不豁免运行时边界，不从“当前无 JSON schema”推导“无需校验”；必要字段、错误形状与失败/空结果区别均须明确。
2. (b)/(c) 类必须**显式登记为 opaque/局部 contract**（B45 落 legacy/现役分类与 `$ref` 可解释性），不得把 `z.any()` 或 adapter 内部 map 冒充 SSOT。
3. 局部 contract 保留：`ui_card.json`、`candidate_direction.json`、`artifact_adoption_entry.json`、`author_choice_action.json`（经 barrel 组合收紧，ADR-0024 决策 5）。
4. 显式 opaque 字段保留：`trace_summary`、`truthfulness`、`behavior_state`、`plan_step_selection` 等动态/派生信封（v3 已用 `z.record`/`z.any` 标注来源）。
5. **退役 SSOT 地位**：`turn_result_v2.json`、`phase_next_action_compat.json`、`NextAction` enum 与 `TurnResultValidator` 不再作为现役 SSOT（前者历史冻结；后三者仅测试调用/旧大写语义）；B45 决定保留兼容、显式 legacy 或退役。是否在其它实际边界复用同源校验由消费者决定；复用同一 schema 不是第二份真源，禁止的是另写漂移规则。R6 不单独变更现行 wire 告警/阻断政策。

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

**5.4 ADR-0022 状态处置（R4=B，已生效）**：作者于 2026-10-30 正式接受本 ADR，并明确授权将 ADR-0022 标为 `Superseded`，替代者为本 ADR；旧稿正文和历史证据保留。本 ADR 承接其决策 1 的现行边界与决策 3，决策 2 的当前执行语义仍以 ADR-0023/0025 为准，不恢复旧常驻计划面板。依据见 [B49 整体接受记录](../../../tasks/slices/B49-core-semantics-and-adr-review.md#716-c02-实施基线收口)。

---

## 决策理由

1. **消费者与作者确认目标共同约束范围**：既有字段/动作按真实生产与消费证据保留或退役；R2 已明确要求补普通回复的统一裁决生产链。B01/B43/B45 必须区分已有能力、新确认的缺口与历史兼容，不能把本 ADR 当成只删不补的清理许可。
2. **执行裁决权威单一**：按 R2=A，所有回合由统一 OrchestratorDecision 表达执行决定；trace 的裁决信息从它派生，观察/采纳/运行状态继续关联各自真实来源。按 R3=B，裁决事实与执行进度分工，不能生成互相矛盾的权威。
3. **主链形态的真实边界**：Form R 的"一个 primary frame"与 Form E 的"per-step frame + per-step plan + per-step re-gate"是两套已验证的承载；继续要求"一个 primary frame 对应一个 primary plan"只会制造无人读的校验。
4. **只读输出分层符合 ADR-0012 的真实意图**：规则 4 的目标是防止作者可见 artifact 绕过 output contract，而不是要求所有内部工具都有 wire schema；分层必须有类型、错误形状与必要运行时验证，不能仅标 opaque；按已确认 R6=B 落实明确契约、必要运行时验证和实际消费证据。
5. **ADR-0022 不可原样接受**：它的决策 2 与现行 Accepted ADR-0023/0025 直接冲突，UI 证明已被 46§9.5 移除；推荐新 ADR 承接以保留清晰的历史与现行边界；旧 Proposed 稿也可显式修订，但须保留修订记录并解决重复/冲突，作者已按 R4=B 选择新稿接受后将旧稿 Superseded。

---

## Contract 影响

### 收窄 / 退役（相对旧 Accepted 字面）

| 对象 | 变更 | 现行真源 |
|---|---|---|
| `DialogueFrame.primary` | Form R 规范；Form E 非规范兼容字段；不得新增校验/消费者 | `dialogue_frame.ex`；`dialogue_planning_service.ex:1693-1741`；`judgment_plan.ex:773-793` |
| "primary MicroPlan" 规则 | 退役；`MicroPlan` 保留为 per-step 建议 envelope | `micro_plan.ex`；ADR-0002 其余决策保留 |
| `agent_runs.origin_frame_ref` | A 类补齐：必须是真实 frame 引用或改名为 turn ref（B01 承接） | `dialogue_planning_service.ex:134`；`agent_run_record.ex:17` |
| `OrchestratorDecision` | 所有回合统一裁决，补普通回复 `reply_only`；类型按真实需求映射（含 reply_only），decision_status 为 decided；执行进度另归 run/step/事件，历史读取兼容 | `orchestrator_decision.ex`；`execution_orchestrator.ex` |
| TurnResult 顶层 `next_action` | 退役字段（无消费者） | `author_question.ex:75`；`agent_run_server.ex:2283`；`turn_result_v3.json` 可选遗留 |
| `BehaviorState.required_next_action` | 退出规范 next-step 载体 | `behavior_state.ex:216`；`trace_writer.ex:611` |
| ADR-0007 旧动作及 next-step 字段要求 | 按 R5 退出无现役消费者的规范要求，逐项核实际读写与历史兼容；现役能力保留 | 见决策 3.2 与 B49 生产/消费矩阵，不能按名字盲删 |
| `primary_next_action` | 退役（ADR-0007 Contract 影响段） | 全仓 0 命中 |
| ADR-0012 规则 4 | 收窄为四类边界（决策 4） | `tool_output_contract.ex`；adapters；`capability_registry.ex:45,60` |
| ADR-0022 决策 1 / 2 / 3 | 1 收窄、2 不承接、3 保留 | `agent_plan.ex`；`agentic_deviation_signal.ex`；`agent_narrative_source.ex` |

### 待实施的补齐（正式接受后按对应任务执行）

- 所有回合统一裁决的 producer、真实 reply_only 与各出口映射、同源 trace/结果/回放（B43）。
- 真实入口来源引用的生成/存储/回放与历史兼容（原 B01 执行小节）。
- trace/decision 词表同步与未知值处理（B43/B45）。
- 真实动作/旧字段兼容与分层输出的必要校验、失败矩阵（B45 及各 contract owner）。

## Umbrella 边界影响

- `novel_domain`：frame/plan/decision 的纯值与绑定/类型校验，新增 reply_only 语义但不引入 I/O；执行进度仍属 run/step。
- `novel_application`：Form R/Form E 的对象产生规则、trace/decision 映射、只读输出分层；不回退 Router/Envelope。
- `novel_agent`：tool adapter 的 output contract 分层（creative 强制 / 只读 opaque）；不改 Provider 协议。
- `novel_web`：不新增校验或动作；Channel 只转发 `TurnResult` / `event`。
- `frontend`：`available_actions` / `trace_summary` / `TurnResult` 校验面不变；退役动作不新增 UI 入口。
- `novel_persistence`：`agent_runs.origin_frame_ref` 语义说明；无新表/列。

## UI / Trace / Replay 影响

- **UI**：不新增按钮、卡片或动作；退役动作不得新增 UI 入口。`available_actions` 仍是唯一可提交动作来源；`behavior_state.active` 仍是确认动作显隐门控。
- **Trace**：Form R 必须能回答"为什么没有工具/行为/写入"（`no_tool_reason` / `no_behavior_reason` / `no_write_reason` + `event_order`）；Form E 必须能回答"哪个 frame/plan 进入了哪个 gate、裁决是什么"（decision + gate_results lineage）。
- **Replay**：默认不重新调用 provider；新回合的裁决信息从同源 decision/trace 重建，执行轮保留真实 gate lineage。旧 trace-only 记录保持历史读取兼容，不伪造 decision。未知类型须可观测。

## 垂直切面证明

- 本 ADR 本身由 B49 评审材料证明（证据矩阵，file:line）。
- 收窄落地后的第一证明：
  1. Form R：真实 Tauri 普通对话 → 真实 `OrchestratorDecision.decision_type=reply_only`、同源 trace/TurnResult/Why/Replay；无批准业务动作、无作品写入、幂等不重复，兼容历史无 decision 记录。复用普通对话入口并增加对应断言，不伪造通过记录。
  2. Form E：单工具 run → step frame（`primary: false`）+ plan → gate → decision 链路可回放（复用 `agent-step-regate` / `agentic-loop-gate-deviation-replan`）。
  3. 动作矩阵：每个保留动作有 producer + Channel 提交 + 真实页面结果；退役动作 0 producer 断言。
  4. 分层输出：创作 contract 负例、内部读取真实字段/类型/错误矩阵、探索来源与范围契约；登记 opaque 不算验证完成，非法结构不得冒充成功空结果。
  5. 来源：真实工作台启动执行后，Why/持久回放可解析实际输入/turn/frame；错误与跨作品/会话引用被拒，旧合成引用保持诚实兼容，不伪补历史 frame。
- 产品代码不得为验收新增感知逻辑（默认 no；本 ADR 不引入任何验收钩子）。

## 迁移与兼容

- Accepted ADR 原文不动；偏差痕迹保留在各 ADR `## enforcement_gaps`（B13b 裁决已登记，本 ADR 只做承接与收窄）。
- ADR-0022 已按 R4=B 转 Superseded；旧正文完整保留，当前规则按本 ADR 与 ADR-0023/0025 的明确承接读取。
- schema/code 清理按承接任务推进：B01（Planner/frame lineage 语义）、B43（gate/blocked/幂等）、B45（schema legacy/opaque/wire 字段）、B12（S7 非预算 awaiting surface）、后续清理 slice（字段退役实现）。
- 不得以本 ADR 为名恢复旧 multi-step / 旧 planner / 旧 Envelope 语义。

## 后续工作

- **原 B01 执行小节**：[入口来源与语义边界](../../../tasks/2026-10-27-design-to-execution-reconciliation.md#b01-入口来源与语义边界) 承接 R7，保留原 PlannerBoundary 全范围；不以来源局部修复代签整个 B01，不建第二 Router/身份体系。
- **[B43 Gate 与统一裁决](../../../tasks/slices/B43-gate-order-residual.md)**：R2 统一裁决 producer、各回合出口映射及 trace/replay 同源；blocked 路径的 `first_blocking_gate` / `DecisionTrace` / `Replay` / no-tool-no-write 证据；decision/trace 词表与 `TraceReplayService.@decision_types` 同步；幂等输入一致性；open behavior/slot 统一进门。
- **[B45 Schema 与输出边界](../../../tasks/slices/B45-schema-legacy-governance.md)**：`turn_result_v3` 可选 `next_action` 退役/标 legacy、`phase_next_action_compat`/`NextAction`/`TurnResultValidator` 的 legacy 地位、`text_analysis_output_v1`/`character_roster_result_v1` 显式 opaque 登记、`$ref`/`z.any()` 分类；只增改 R2/R3/R6 实际消费者所需的契约/校验，不借治理新增无用途业务能力。
- **B12 S7 非预算 awaiting surface**：awaiting_author / no_progress 等非预算出口复用 `available_actions` + `trace_summary.decision_type` + `author_question`，须按真实停等行为与统一裁决映射，不能全部伪报 reply_only；不先建表。
- **ADR-0022 状态**：已于 2026-10-30 完成 Superseded 与索引/承接关系同步；这不关闭任何产品实现缺口。
- 后续字段退役实现（`next_action`、`primary`、`required_next_action`）另开小步 slice 或随 B45 CP2 实施，不在本 ADR 内直接改代码。

## enforced_by

> 以下真实路径支撑既有逐步执行、trace/replay、现役动作、部分输出边界及 N-NARR；**它们没有完成本 ADR 新要求的普通回复裁决、统一出口映射、真实入口引用及完整内部校验**。本 ADR 已 Accepted，但不关闭下节缺口。路径存在只证明可追溯，不证明运行正确。

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

## enforcement_gaps

- **真实来源引用仍不可验证（R7=A）**：`agent_runs.origin_frame_ref` 可由用户消息入口合成为 `"frame_<turn_id>"`（非真实 frame id），且无消费者校验这是 frame 引用；属原 B01 执行小节待实现；须完成存在性/范围/旧记录与真实页面回放矩阵。
- **统一裁决及回归未落地**：各类型/trace 读取词表同步、未知值处理与真实回复/执行/停等/作者动作回归尚缺；reply_only decision 与所有回合出口映射、同源 trace/wire/replay、历史兼容均待 B43/B45；类型与生命周期按 R3=B 同步并验证历史兼容。退役动作按 R5，origin lineage 按 R7，不能用一项选择代签其它项。
- **动作与字段兼容未闭合**：现役 producer/consumer、Channel/回执/真实页面和旧记录矩阵待 B45 完成；TurnResult 顶层 `next_action`、`DialogueFrame.primary`/`MicroPlan.primary`、`BehaviorState.required_next_action` 仍存在；本 ADR 只定语义，删除/标 legacy 由 B45 按消费者审计执行，不得破坏 R1 的真实 frame/plan 绑定。须保留持久化读取兼容（历史 TurnResult/trace）。
- **分层输出契约与校验未闭合**：`text_analysis_output_v1` / `character_roster_result_v1` 仍是 registry 悬空引用；B45 按 R6=B 明确真实 owner/消费者与契约，核必要运行时检查、错误形状和失败/空结果矩阵。仅标 opaque 或删除引用不等于完成校验。
- **文档关系已登记、实际执行仍待验证**：ADR-0001/0002/0004/0007/0012 的 enforcement_gaps 已追加本 ADR 的承接说明，历史最终决策段未改；相应 producer/consumer/schema/页面缺口仍按 B01/B43/B45 验证，不以注记代签。
- **探索与统一裁决的证据消费待验证**：按已接受 ADR-0030/D5，内联探索保留真实 observation/查询/来源；实际存在 ToolRequest/ToolResult 时照实保留，不存在时不伪造。与新增统一 decision/trace 的关联由 B39/B43 验证，当前不将观察日志当完整链路通过。
