# ADR-0023：Agentic Loop 计划驱动执行与调用经济学 v3

> **修订注记（2026-07-15，ADR-0025）**：本 ADR 适用域由"一切 AgentRun"收窄为
> "模型判断需要计划的 run"。交互式场景改走判断驱动循环（判断①/② + 计划按需 +
> 探索），N-PLAN 表述由 ADR-0025 改写；本 ADR 的机制（模型起草/修订计划、机械
> 游标推进、D 系偏离信号、协议重试、预算 backstop）全部保留并被 ADR-0025 复用。

- 状态：Accepted（CP0/CP1/CP2/CP3/CP4 均已闭合；适用域被 ADR-0025 收窄，机制沿用）
- 日期：2026-07-04
- 来源文档：
  - `../notes/2026-07-04-agentic-loop-plan-driven-execution.md`
  - `../notes/2026-07-01-agentic-loop-reasoning-stream-ui.md`
  - `../contracts/UA-01-unified-agent-run-loop-contract-pack.md`
  - `../../../tasks/slices/UA01-bounded-run-single-candidate-termination.md`（T3 已拍板选 B）
  - `../../engineering/scenario-invariants.md`
  - ADR-0021（AgentRun 与 Turn 边界）、ADR-0022（计划可视化/评估重规划/叙事作者权）、ADR-0003（Planner Authority）、ADR-0004（OrchestratorDecision）
- 影响范围：Execution / Behavior / Trace / UI / Umbrella / Slice
- 相关不变量：UA-01 A 系列；N-NARR（ADR-0022）；本 ADR 新增不变量 N-PLAN（见「最终决策」）
- 首个证明 slice：`agentic-loop-plan-replan-reasoning`（与 ADR-0022 共享伞形证明）＋ 无偏离直通、steer budget、D1/D2/D4/D5/D7 偏离信号 scenarios ＋ `agent-plan-native-tool-calling-protocol`
- 取代：无
- 取代者：无

> 关系说明：本 ADR **细化 ADR-0022、不取代之**。ADR-0022 的决策 1（AgentPlan 可视化/版本化/修订）与决策 3（叙事作者权归模型，N-NARR）原样兑现；本 ADR 只**修订其决策 2 的执行语义**——把「每次 observe 后 evaluate 折进每步 planner 调用」改为「每次 observe 后确定性核对，命中偏离信号才做一次 evaluate+replan 合并调用」——并冻结 ADR-0022 未定的执行经济学。ADR-0021/0003/0004 的执行权边界全部保留。

---

## 背景

ADR-0022 冻结了「计划可维护可修订、评估→重规划、叙事归模型」的语义，`NovelDomain.AgentPlan`/PlanStep 契约已就位，但运行时仍是逐步 pick-one：每个 step 之前调一次 `AgenticNextStepPlanner`，从 profile 写死的 2-4 个 step_options 里选下一步，`plan_steps` 主要服务 UI 展示。

2026-07-04 新主链 10 章狗粮长跑（真实 LM Studio + 真实 Tauri）实证了三类同根代价：

1. **调用经济学**：conversation=7 次 provider 调用/轮、prose=6、其余创作 profile=5，实测 40-65 秒/轮；其中约一半是「问模型下一步干嘛」的 planner 调用，而对确定性推进答案每次相同。
2. **鲁棒性**：planner 坏 JSON 无重试→一次解析失败灭整个 run；完成信号只靠提示词纪律→真实模型在 artifact_created 后再选 prose_writing（僵尸 run：未请求候选/终态不诚实/迟到帧污染消费者/单线程 provider 队列饿死后续 run）。
3. **判断力**：planner 只见观察的一行 summary，structured_payload 不进 prompt，无法区分「小问题可完成」与「冲突必须重规划」。

根因是**把确定性推进也交给模型每步重新发明**。2026-07-04 作者确认核心回路形态：计划由模型动态生成 → 执行 → 探索 → 评估 → 偏离才修订计划。

## 决策范围

本 ADR 冻结四个决策：

1. **计划驱动机械推进**（新增不变量 N-PLAN）。
2. **偏离信号族与 evaluate+replan 合并调用**（修订 ADR-0022 决策 2 执行语义）。
3. **完成与终止语义**（机械完成 + 候选预算 backstop + 重规划预算档位）。
4. **规划协议鲁棒性两级路线**。

## 非目标

- **不改变 Planner「只提议、不批准」边界**（ADR-0003）：计划与修订不自我批准执行；每个 act 步仍构造单动作 `MicroPlan` 重新经过 `ExecutionOrchestrator` gate（ADR-0021/0004）。
- **不动 N-NARR**（ADR-0022 决策 3）：作者可见叙事的字节溯源与 provenance 要求原样适用于计划起草/修订/完成节点的叙事。
- **不引入 runtime 强制的 step 依赖 DAG**（沿 ADR-0022）：顺序由模型经计划与修订决定。
- **不把 legacy 单步 next-step planner 当作 AgentPlan fallback**：`AgenticNextStepPlanner` 的旧 JSON-tail 单步测试/兼容入口不授权生产 AgentPlan draft/revision 双协议回退；AgentPlan 起草/修订只走 `AgenticPlanDraftPlanner` 的 native tool-call 协议。
- **不承诺地板模型下的计划质量**：地板档是 forcing function，不是计划质量基准。
- **不改 artifact / adoption / confirmation / projection 写入边界**。

## 考虑过的方案

### 方案 A：保持每步一调（把 ADR-0022 现状运行时化）

- 优点：每步模型全权判断，叙事密度最高，改动最小。
- 缺点：调用数/延迟不降（7/6 次每轮）；僵尸 run 只能靠预算兜底与提示词纪律；确定性推进付模型价。

### 方案 B：纯 plan-then-execute（起草后盲执行，无评估回路）

- 优点：调用数最低。
- 缺点：违背 ADR-0022 评估→重规划回路；遇前提不成立只能失败；「探索发现改变计划」不再真实存在。

### 方案 C：计划驱动 + 确定性核对 + 偏离触发 evaluate+replan（采纳）

- 优点：普通路径零 planner 调用（起草 1 次封顶）；评估回路保留且变成事件驱动；僵尸类问题结构性消失；调用数近半。
- 缺点：叙事节点收敛（作者不再每步见模型独白）；「偏离」的判定必须机器可判，需要冻结信号族；验收口径全量迁移。

### 协议子决策：直接迁原生 tool calling / 只加固 JSON-tail / 两级路线

直接迁移改造面大且迁移期脆弱性无缓解；只加固则手工切 JSON 的脆弱性长期存在。采两级：先加固（一次重试），后迁移 AgentPlan 起草/修订协议；截至 2026-07-05，第二级已由 CP4 闭合。

## 最终决策

采用方案 C ＋ 协议两级路线。

**决策 1 — 计划驱动机械推进（不变量 N-PLAN）。**
profile routing 之后、第一个 step 之前，目标 profile 的 planner 做**一次**计划起草调用：作者可见 reasoning（N-NARR 溯源）＋结构化 `PlanStep` 列表（kind/description/success_criteria/目标能力 ref，prose 步含写作坐标 `authoring_intent`/`target_chapter`/`requested_chapter_raw`）。CP0 阶段该结构来自加固 JSON tail；CP4 之后，生产 AgentPlan draft/revision 结构只来自 provider-native tool call arguments。PlanStep 目标能力必须落在 allowed_tools ∪ internal_observation_steps。此后每步完成且无偏离信号时，运行时按计划**机械推进**下一个 pending step（零 planner 调用）；act 步照旧单动作 MicroPlan → Orchestrator re-gate（门是确定性裁决，非模型调用；gate deny 构成偏离信号）。

> **不变量 N-PLAN（本 ADR 冻结）**：AgentRun 运行时的推进轨道必须整体来自模型产出并维护的 `AgentPlan`（含其修订版本）；`novel_application` 生产路径不得存在 app 预制的 per-profile 固定步骤序列作为推进轨道（已删除的 `AgentRunSequentialPlanner` 形态不得复活）。机械推进 ≠ 固定 workflow：判据是**轨道由谁产出**（模型 per-run 起草），不是推进由谁执行（app 机械沿计划推进合法）。固定/动态三层边界：能力空间固定（权限）、计划动态（模型）、执行门固定（机器）。

**决策 2 — 偏离信号族与 evaluate+replan 合并调用。**
每次 observe 后先做**确定性核对**（app 机器判，零成本）；仅命中下列信号族之一才发起**一次** evaluate+replan 合并模型调用：

| # | 信号 | 判定来源 |
|---|---|---|
| D1 | step/工具失败 | `tool_result.status=failed`（替代现状直接 run_failed：重试预算内先给模型一次改道机会） |
| D2 | 质量复核产出需行动 finding | `quality_review.policy_action ≠ none` / severity 达阈值 |
| D3 | 作者 steer | goal version bump（既有 steer→replan 促升机制归入本信号族） |
| D4 | Orchestrator gate deny / require_confirmation | 裁决结果（模型可改道或 await_author） |
| D5 | 预算余量不足以走完剩余计划 | 剩余 steps/provider 预算 < 剩余 pending 步下界 |
| D6 | 计划走完但完成条件未成立 | 全部 PlanStep done 而决策 3 完成条件缺失 |
| D7 | 观察带确定性缺口标记 | missing policy soft、空阵容等 app 可判类别 |

合并调用输出 `evaluation_of_last {advanced, plan_holds, new_constraint}`（字段顺序在前，沿 ADR-0022 纪律）＋修订后计划（`plan_version+1`、模型给出的 `revision_reason`、步骤插入/废弃/重排）或 done/await_author。修订受 `max_replans` 预算约束。本决策**修订 ADR-0022 决策 2 的执行语义**：其「evaluate 折进 planner 同一次调用、不新增独立 call site」的精神保留并加强（普通路径从每步一调降为零调）；其「每次 observe 后 evaluate（模型判）」的字面改为「每次 observe 后确定性核对＋事件触发模型判」。ADR-0022 预留的可逆阀（评估被规划裹挟时拆独立便宜 evaluate 调用）在事件触发模式下保留为后备，未激活。

**决策 3 — 完成与终止语义。**
- **机械完成**：计划全部步骤 done 且 profile 完成条件成立（创作档：待采纳 artifact 已产出；conversation：本轮回应已产出）→ run 以 `goal_satisfied` 完成，**不追加一次「done 收束」模型调用**。终局叙事＝最后一次计划（修订）调用中模型对终局的措辞＋app 结构态（chip/进度/事实计数）；不伪造收束 prose。若实测作者体感不足，可加 opt-in 步级/收束 narration 调用（默认关）。
- **候选预算 backstop**：`AgentRunPolicy` 候选预算项（`UA01-bounded-run-single-candidate-termination` T3 已拍板选 B）：候选已达预算而计划/修订仍要执行新步 → 系统裁决以 `goal_satisfied` 完成，模型提议照实留痕（reason_codes）。计划驱动下该 backstop 兜「模型把计划修出第二份候选」的残余情形。
- **重规划预算**：`max_replans` 创作档默认 1→2；conversation/readonly 维持 1。
- `awaiting_author`（预算尽/需作者输入）与 `no_progress`（progress_signature 复现）语义保留不变。

**决策 4 — 规划协议鲁棒性两级路线。**
- **第一级（ADR-0023 CP0 已落地）**：计划起草/修订调用补「携带失败片段重试一次」（与 writer、frame planner 既有同款模式），消除「一次坏 JSON 灭 run」。
- **第二级（ADR-0023 CP4 已落地）**：AgentPlan 起草/修订迁移到 provider-native tool calling（reasoning 为作者可见正文，结构为 forced tool call arguments）。`AgenticPlanDraftPlanner` 只接受匹配 `agent_plan_draft` / `agent_plan_revision` 的 tool call arguments；缺失、错名、多 tool call 或 arguments 非对象均进入 native tool-call retry / 失败，不再解析 JSON tail。ProviderExecution / activity / persistence 只暴露 author-safe `native_tool_call_count` 与 `native_tool_call_names`，不得保存或展示 tool arguments / plan steps。生产 AgentPlan draft/revision 不允许出现 JSON-tail 与 native tool calling 双协议可选支路。

## 决策理由

三类实证代价（调用数/延迟、坏 JSON 灭 run、僵尸 run）同根于逐步 pick-one；方案 C 在保留 ADR-0022 全部语义价值（模型计划、评估回路、叙事作者权）的前提下把普通路径成本压到常数，且「偏离才惊动模型」让重规划回路从每步例行公事变成有原因的事件——这更接近「探索发现改变计划」的真实 agentic 语义，而非更远。执行权层零改动，风险集中在运行时调度与验收口径迁移。

## Contract 影响

修改 / 扩展：

- `NovelDomain.AgentPlan`：契约已就位；补修订操作语义（插入/废弃/重排规范化；修订必带 `revision_reason`）。
- `NovelDomain.AgentNextStepDecision`：升级为计划起草/修订载体（实现期二选一：扩展 decision_type 增 `plan_drafted`/`plan_revised`，或复用 `execute_step`+`plan_revision` 表达）；2026-07-04 已扩展的写作坐标字段（`authoring_intent`/`target_chapter`/`requested_chapter_raw`）随 PlanStep 进入计划结构尾巴。
- `NovelDomain.AgentRunPolicy`：新增候选预算项（T3-B）；`max_replans` 档位调整。
- `NovelCommon.Contracts.AgentEvent`：`plan_drafted`/`plan_revised` 事件族沿 ADR-0022；机械推进步只产结构事件（不产叙事事件）。
- `contracts/UA-01`：预算矩阵、planner 协议（起草/修订两态 prompt＋结构尾巴 schema）、偏离信号族 D1-D7。

冻结不变量：N-PLAN（见上）。

## Umbrella 边界影响

- `novel_domain`：AgentPlan 修订语义、AgentRunPolicy 预算项，纯 struct＋校验。
- `novel_agent`：profile registry 不变；`:planner`/`:author_reasoning` purpose 不变；第二级协议迁移归 provider execution 域。
- `novel_application`：AgentRunServer 增机械推进与偏离核对调度；`AgenticNextStepPlanner` 升级为计划起草/修订 planner；不得引入 app 预制轨道（N-PLAN）。
- `novel_web`：Channel 协议不变（`agent_event`/`agent_run_state`/`agent_command`）。
- `novel_persistence`：`agent_runs.plan/plan_version` 既有列承载；无 schema 新增预期。

## UI / Trace / Replay 影响

- UI 沿 `46§9-agentic-loop-reasoning-flow` 五态；计划面板成为主叙事载体：模型措辞的 PlanStep 描述＋app 骨架的 status 推进；机械推进期间「执行中」由计划 status 变化表达，不再逐步刷模型独白。叙事节点收敛为：计划起草/计划修订（带原因）/完成/await——此变化对作者诚实声明。
- Trace：计划版本序列、`revision_reason`、偏离信号命中记录（reason_codes）进 author-safe trace；replay 默认不重跑规划调用（沿 ADR-0017）。
- N-NARR driver 适用面不变：计划起草/修订/完成节点的作者叙事字节必须溯源模型输出。

## 垂直切面证明

- 伞形 slice：`agentic-loop-plan-replan-reasoning`（与 ADR-0022 共享）——前提不成立场景：真实工作台看到计划 v1 → 探索观察 → 偏离信号命中 → 评估「前提不成立」→ 计划 v2（模型原因）→ 执行 → 完成态计划回顾。
- 新增「无偏离直通」scenario：断言直通路径 planner 调用恰 1 次（起草）、零 replan、各 profile 目标调用数（conversation ≈3 / prose 4 / 其余创作档 3，精确口径在 CP 落地时以真实验收定格）。
- 狗粮长跑作为搭车复验（0 retry 通过线，沿 `UA01-bounded-run-single-candidate-termination`），不为本 ADR 单独触发。

## 迁移与兼容

分 CP 落地；CP1 起两形态（逐步 pick-one 与计划驱动）在未迁移 profile 上并存，属**登记在案的过渡态**，验收口径按 profile 标注所处形态：

| CP | 内容 |
|---|---|
| CP0 | 规划调用坏 JSON 一次重试＋观察保真（最近 K 条观察带紧凑 structured_payload 进 prompt，预算随 AssemblyPolicy 档位）——不改 loop 形态 |
| CP1 | 计划起草调用＋AgentPlan 运行时落地＋机械推进（conversation＋prose 先行） |
| CP2 | 偏离信号族 D1-D7＋evaluate/replan 合并调用＋steer 融合＋预算语义（含候选预算 backstop 实现、max_replans 档位） |
| CP3 | 全 profile 迁移＋机械完成态＋46§9 计划面板消费＋验收口径全量迁移（各 scenario provider_calls 断言、stub 计划应答改造、锚点同步） |
| CP4 | AgentPlan 原生 tool calling 协议迁移（`agent-plan-native-tool-calling-protocol` 真实 Tauri 已通过；生产 AgentPlan draft/revision 不保留 JSON-tail fallback） |

实现检查点（2026-07-04）：CP0 已先行落到现有 observation-led next-step planner 上，内容仅限协议鲁棒性与观察保真：
`AgenticNextStepPlanner` 对坏 JSON tail / 协议字段错误 / profile 工具边界错误携带失败片段重试一次，
retry 后的 provider call count 进入 AgentRun consumed budget；prompt 只携带最近观察的 author-safe summary
与紧凑 `structured_payload`。这不代表 N-PLAN、计划起草、机械推进或 D1-D7 replan 已完成。

实现检查点（2026-07-04，CP1 首批 runtime）：`AgenticPlanDraftPlanner` 已新增为
provider-backed 计划起草器，`AgentPlan.PlanStep` 已补 `target_tool_ref` /
`write_intent` / `risk_hint` / 写作坐标字段；`conversation_turn_v1` 与
`prose_drafting_with_quality_v1` 已改为先起草 per-run AgentPlan，再由 runtime
沿计划机械推进。conversation 计划包含 context/frame/strategy/finalize，direct
focused path 记录 4 steps / 0 tool / 2 provider calls，routed 验收口径为 3 provider
calls；prose 计划包含 context/prose_writing，direct focused path 记录 2 steps /
1 tool / 3 provider calls，routed 验收口径为 4 provider calls。act 步仍重建
单动作 MicroPlan 并经过 Orchestrator gate。该检查点尚未完成 D1-D7 偏离
evaluate/replan、全 profile 迁移、46§9 计划面板全量口径和 dogfood 长跑复验。

实现检查点（2026-07-04，CP2 D6 backend）：`AgenticPlanDraftPlanner` 已补
provider-backed 计划修订器。`conversation_turn_v1` 与
`prose_drafting_with_quality_v1` 在计划 cursor 走完且 profile 完成条件未成立时，
不再立即 `await_author`；runtime 先检查 `max_replans`，有预算则发起一次
evaluate+replan 合并调用，产出 `plan_revised` author-safe 事件、`AgentPlan.version+1`
和 `replan_count=1`，随后沿修订计划继续机械推进。该 checkpoint 仅覆盖 D6 的后端
runtime 语义；真实 Tauri 证据见下一检查点。

实现检查点（2026-07-04，CP2 D6 真实 Tauri）：`agentic-loop-plan-replan-reasoning`
已接入外部 Tauri driver 并通过真实页面验收。场景从工作台发送带 D6 fixture 的普通
conversation 输入，证明初始 model-drafted AgentPlan 只有 `context_assemble` 1 步；
计划耗尽且本轮回应未生成时，runtime 发布 provider-sourced `plan_revised`（version 2，
`evaluation_of_last.plan_holds=false`，reason 为「计划步骤已走完，但本轮回应尚未生成。」），
修订计划恢复 `dialogue_frame` / `strategy_gate` / `response_finalize` 后继续完成同一 run。
summary 位于 `artifacts/slice-verify/agentic-loop-plan-replan-reasoning-tauri/summary.json`，
记录 `consumed_steps=4` / `consumed_tool_calls=0` / `consumed_provider_calls=4` /
`consumed_replans=1`。

实现检查点（2026-07-04，CP2 无偏离直通真实 Tauri）：`agentic-loop-no-deviation-direct`
已接入外部 Tauri driver 并通过真实页面验收。场景从工作台发送普通 conversation 输入，
证明初始 model-drafted AgentPlan 已完整包含 `context_assemble` / `dialogue_frame` /
`strategy_gate` / `response_finalize` 四步；runtime 沿计划机械推进到 completed no-tool
TurnResult，未发布 `plan_revised`，`consumed_replans=0`。summary 位于
`artifacts/slice-verify/agentic-loop-no-deviation-direct-tauri/summary.json`，记录
`consumed_steps=4` / `consumed_tool_calls=0` / `consumed_provider_calls=3` /
`initial_plan_step_count=4` / `plan_revised_event_count=0`。

实现检查点（2026-07-04，CP2 steer budget 真实 Tauri）：`agent-natural-language-steer`
已加严外部 Tauri verifier 并复跑通过。场景在 active AgentRun 期间通过主聊天输入框提交
作者 steering 文本，证明该文本绑定同一 active `run_id` 并作为 `agent_command steer`
处理；后端广播 `plan_adjusted` 后，下一步规划叙事提升为 provider-sourced `plan_revised`，
同一 run 消耗 `consumed_replans=1`，且不创建第二个后端 `user_message`、作者 turn 或新 run。
summary 位于 `artifacts/slice-verify/agent-natural-language-steer-tauri/summary.json`，
记录 `command=steer` / `command_source=main_input` / `adjusted_goal_version=2` /
`consumed_replans=1` / `no_second_user_message_for_steer=true`。D1/D2/D4/D5/D7
在 2026-07-05 的 CP2 checkpoint 补齐；全 profile 迁移见 CP3。

实现检查点（2026-07-04，CP3 章节大纲单 profile 真实 Tauri）：`plot_outline_with_context_v1`
已从 observation-led next-step planner 迁到 model-drafted AgentPlan + mechanical cursor。
计划起草器先产出 `context_assemble` / `plot_outline` 两步 AgentPlan；runtime 执行 context
后机械推进到 `plot_outline`，该工具 step 仍重新构造单动作 MicroPlan 并经过
`ExecutionOrchestrator` gate。真实 Tauri `agent-plot-outline-with-context` 已通过，summary
位于 `artifacts/slice-verify/agent-plot-outline-with-context-tauri/summary.json`，记录
`profile_ref=plot_outline_with_context_v1` / `pending_artifact_type=outline_draft` /
`consumed_steps=2` / `consumed_tool_calls=1` / `consumed_provider_calls=3`。

实现检查点（2026-07-04，CP3 角色演化单 profile 真实 Tauri）：`character_evolution_with_context_v1`
已从 observation-led next-step planner 迁到 model-drafted AgentPlan + mechanical cursor。
计划起草器先产出 `context_assemble` / `character_evolution` 两步 AgentPlan；runtime 执行
context 后机械推进到 `character_evolution`，该工具 step 仍重新构造单动作 MicroPlan 并经过
`ExecutionOrchestrator` gate。真实 Tauri `agent-character-evolution-with-context` 已通过，summary
位于 `artifacts/slice-verify/agent-character-evolution-with-context-tauri/summary.json`，记录
`profile_ref=character_evolution_with_context_v1` / `pending_artifact_type=character_evolution_seed` /
`pending_memory_subtype=CURRENT_STATE` / `consumed_steps=2` / `consumed_tool_calls=1` /
`consumed_provider_calls=3`。

实现检查点（2026-07-04，CP3 世界设定单 profile 真实 Tauri）：
`world_building_with_context_v1` 已从 observation-led next-step planner 迁到 model-drafted
AgentPlan + mechanical cursor。计划起草器先产出 `context_assemble` / `world_building`
两步 AgentPlan；runtime 执行 context 后机械推进到 `world_building`，该工具 step 仍
重新构造单动作 MicroPlan 并经过 `ExecutionOrchestrator` gate。`author_goal_text`
继续由原始作者目标提供，避免上下文 observation 反向污染 artifact type 判定。真实 Tauri
`agent-world-building-with-context` 与 `agent-world-building-style-rule-with-context`
已通过，summary 分别位于
`artifacts/slice-verify/agent-world-building-with-context-tauri/summary.json` 与
`artifacts/slice-verify/agent-world-building-style-rule-with-context-tauri/summary.json`，
均记录 `profile_ref=world_building_with_context_v1` / `consumed_steps=2` /
`consumed_tool_calls=1` / `consumed_provider_calls=3`，并分别保持
`pending_artifact_type=foreshadowing_seed` / `style_rule_seed`。

实现检查点（2026-07-04，CP3 provider progress + readonly batch 真实 Tauri）：
`provider_progress_v1` 与 `readonly_batch_context_v1` 已从 observation-led next-step planner
迁到 model-drafted AgentPlan + mechanical cursor。provider progress 计划起草器产出
`provider_complete` 单步，runtime 机械推进后仍只发布 author-safe provider progress 事件，
不暴露 raw prompt；真实 Tauri `agent-provider-streaming-progress` 已通过，summary 位于
`artifacts/slice-verify/agent-provider-streaming-progress-tauri/summary.json`，记录
`profile_ref=provider_progress_v1` / `plan_drafted_target_tool_ref=provider_complete` /
`plan_drafted_step_count=1` / `progress_event_count=3` / `consumed_provider_calls=3`。
同一 profile 的取消边界也已用 `agent-provider-cancel-honest-boundary` 回归通过，终态仍为
`cancelled`。readonly batch 计划起草器产出两步 `readonly_batch`，runtime 机械读取 4 项只读
上下文再汇总，保持 no content provider / no artifact / no adoption / no production write；
真实 Tauri `agent-readonly-batch-profile` 已通过，summary 位于
`artifacts/slice-verify/agent-readonly-batch-profile-tauri/summary.json`，记录
`profile_ref=readonly_batch_context_v1` / `plan_drafted_target_tool_ref=readonly_batch` /
`plan_drafted_step_count=2` / `readonly_item_refs=[work_profile, characters, rules, stats]` /
`consumed_tool_calls=4` / `consumed_provider_calls=2`。

实现检查点（2026-07-04，CP3 character_design + prose_revision + 46§9/acceptance 迁移）：
`character_design_with_context_v1` 与 `prose_revision_from_findings_v1` 已从 observation-led
next-step planner 迁到 model-drafted AgentPlan + mechanical cursor。角色设计计划起草器产出
`character_roster` / `character_design` 两步；runtime 先机械读取只读角色阵容，再推进到
`character_design`，该 act step 仍重新构造单动作 MicroPlan 并经过 `ExecutionOrchestrator`
gate。真实 Tauri `agent-bounded-roster-to-character-design`、`ua01-agent-bounded-roster-to-character-design`
与 `agent-provider-call-budget` 已通过，summary 分别位于
`artifacts/slice-verify/agent-bounded-roster-to-character-design-tauri/summary.json`、
`artifacts/slice-verify/ua01-agent-bounded-roster-to-character-design-tauri/summary.json` 与
`artifacts/slice-verify/agent-provider-call-budget-tauri/summary.json`，记录
`plan_drafted_target_tool_ref=character_roster` / `plan_drafted_step_count=2` /
`plan_drafted_targets=[character_roster, character_design]` / `consumed_steps=2` /
`consumed_tool_calls=2` / `consumed_provider_calls=3`。

修订计划起草器产出 `revision_prepare` / `revision_plan` / `prose_writing` /
`revision_finalize` 四步；`revision_plan` step 仍调用 `ProseRevisionService.plan_revision/2`
重建 revision MicroPlan 并经过 `ExecutionOrchestrator` gate，`prose_writing` step 才调用
writer 生成 sibling tentative revision draft。真实 Tauri `p1-prose-revision-candidate`、
`agent-revision-orchestrator-boundary` 与 `agent-replay-no-provider` 已通过，summary 分别位于
`artifacts/slice-verify/p1-prose-revision-candidate-tauri/summary.json`、
`artifacts/slice-verify/agent-revision-orchestrator-boundary-tauri/summary.json` 与
`artifacts/slice-verify/agent-replay-no-provider-tauri/summary.json`，记录
`revision_plan_drafted_target_tool_ref=revision_prepare` /
`revision_plan_drafted_step_count=4` /
`revision_plan_drafted_targets=[revision_prepare, revision_plan, prose_writing, revision_finalize]` /
`revision_consumed_steps=4` / `revision_consumed_tool_calls=1` /
`revision_consumed_provider_calls=2`，并证明 replay policy `recall_provider=false`。46§9
计划面板消费与 acceptance provider call / plan assertions 已同步到 `plan_drafted` 计划步骤、
`gate_decided` 授权事实与 final `turn_result.truthfulness`，不再要求旧逐步 planner 的
`evaluation_made` 或 author `exploration_observed` 事件。CP3 当前 profile 迁移已闭合。

实现检查点（2026-07-05，CP2 D1-D5/D7 偏离信号真实 Tauri）：
`prose_drafting_with_quality_v1` 与 conversation runtime 已补 D1/D2/D4/D5/D7 偏离信号语义，
并复核 D3 steer budget。每个命中信号均先发布 provider-sourced `plan_revised`（version 2，
`evaluation_of_last.plan_holds=false`，`consumed_replans=1`），再进入修订后的机械 cursor 或
`awaiting_author`，不绕过 Orchestrator gate，不恢复固定 per-profile 步骤序列。

| 信号 | 真实 Tauri evidence | 当前口径 |
|---|---|---|
| D1 工具失败 | `artifacts/slice-verify/agentic-loop-tool-failure-replan-tauri/summary.json` | 2 steps / 1 tool / 5 provider calls / 1 replan；工具失败先修订计划，未直接 `run_failed`。 |
| D2 质量行动 | `artifacts/slice-verify/agentic-loop-quality-deviation-replan-tauri/summary.json` | 2 steps / 1 tool / 5 provider calls / 1 replan；质量 `confirm` 可产出 pending candidate TurnResult，但 `AgentRun` summary 必须仍是 `awaiting_author`。 |
| D3 作者 steer | `artifacts/slice-verify/agent-natural-language-steer-tauri/summary.json` | 主输入 steer 命中同一 active run，消耗 1 次 replan budget，且不创建第二个作者 turn/run。 |
| D4 gate deny / require_confirmation | `artifacts/slice-verify/agentic-loop-gate-deviation-replan-tauri/summary.json` | 2 steps / 0 tool / 3 provider calls / 1 replan；`gate_decision_type=require_confirmation`、`gate_first_blocking_gate=authority`，writer provider 未 dispatch。 |
| D5 预算不足 | `artifacts/slice-verify/agentic-loop-budget-deviation-replan-tauri/summary.json` | 1 step / 0 tool / 2 provider calls / 1 replan；剩余 step 预算不足触发 replan，无 final TurnResult 或 tool execution。 |
| D7 确定性缺口 | `artifacts/slice-verify/agentic-loop-deterministic-gap-replan-tauri/summary.json` | 2 steps / 0 tool / 3 provider calls / 1 replan；允许 UI transient `tool_started` progress，但 `tool_completed_event_count=0` 且 `log_toolbox_execute_count=0`，writer/toolbox 未执行。 |

实现检查点（2026-07-05，CP4 AgentPlan 原生 tool calling 协议闭环）：`AgenticPlanDraftPlanner`
的 draft/revision prompt 已改为 structured prompt（`messages` + `tools` + forced
`tool_choice`），并只从 `agent_plan_draft` / `agent_plan_revision` native tool call
arguments 读取 AgentPlan 结构；binary content、缺 tool call、多 tool call、tool name
不匹配或 arguments 非对象均进入 native tool-call retry / 失败，不再解析 JSON tail。
OpenAI-compatible、LM Studio、DeepSeek、Anthropic、stub 与 slice_verify 均已接入同一
provider-native tools/tool_choice 口径。`ProviderExecution` / `ProviderOutput` /
`ProviderRunLog` / activity API 只暴露 `native_tool_call_count` 与
`native_tool_call_names`，不持久化或展示 tool arguments、plan steps 或 raw content。
真实 Tauri `agent-plan-native-tool-calling-protocol` 已通过，summary 位于
`artifacts/slice-verify/agent-plan-native-tool-calling-protocol-tauri/summary.json`，记录
`native_tool_call_names=[agent_plan_draft, agent_plan_revision]`、
`native_tool_call_final_output_count=2`、4 steps / 0 tool / 4 provider calls / 1 replan，
并证明 runtime 继续沿修订后 AgentPlan 机械推进，无 `sync_turn` fallback。`AgenticNextStepPlanner`
保留的 JSON-tail 入口仅是旧单步 next decision 测试/兼容边界，不得作为生产 AgentPlan
draft/revision fallback。

- reply-only / direct_tool / author_action 兼容路径保留。
- stub/slice_verify 的 next-step 应答改造为「产出计划/按信号修订」，锚点词变更须与 stub 同步（同 [[creative-prompt-stub-anchor-coupling]] 类耦合纪律）。
- I1/I2/I3 与既有采纳/确认边界不受影响（执行门与写入边界零改动）。

## 后续工作

- `00c` §6/§7/§8 已登记本 ADR 与 N-PLAN；当前 CP0-CP4 证据已闭合，本 ADR 升 Accepted。
- `contracts/UA-01` 已冻结 AgentPlan native tool-call draft/revision schema、偏离信号族与预算矩阵新档位；旧 JSON-tail next-step planner 仅保留为 legacy 单步兼容边界。
- `46-state-and-feedback.md` §9 已补当前计划面板主叙事载体与结构事件消费口径；CP2 D1-D7 继续消费同一 `plan_revised`/reason_codes/UI 结构，CP4 只新增 developer telemetry 的 native tool-call count/name 口径，不新增偏离信号专用 UI 或 copy。
- 已定（2026-07-04，作者拍板）：协议两级路线（先加固后迁移）；机械完成不加收束调用（opt-in 备选）；`max_replans` 创作档 2；CP1 过渡期两形态并存按 profile 标注。
- Deferred disposition（2026-07-05）：地板模型下计划质量不在本 ADR 内追加生产兜底或固定步骤 fallback；当前以 schema 校验、一次重试、D1-D7 偏离信号、预算/no-progress 终止兜底，不把地板档质量冒充为产品质量基准。若后续要做模型质量分层或强模型路由，需另立 eval/backlog。
- Deferred disposition（2026-07-05）：opt-in 步级/收束 narration 默认关闭且本 ADR 不实现；未来若需要，必须是显式产品设置或独立 ADR/slice，并继续满足 N-NARR source binding，不得由 app copy 或验收 hook 伪造。
- 修订注记（2026-07-05，用户拍板，见 `tasks/slices/UA01-agentic-loop-streaming-reasoning-card-simplification.md`）：CP4 强制 native tool call 使规划调用期间 assistant content 无字节可流，作者面对长时间零反馈后计划卡片突然出现，构成体验回归。用户拍板计划起草/修订改为**两段式调用**：第一段自由输出（无 tools）流式产出作者可见 reasoning（`author_narrative_delta` 可流），第二段强制 native tool call 产计划结构（prompt 内嵌第一段 reasoning）。规划调用成本 ×2 是**明知与本 ADR 调用经济学冲突后的体验优先决策**；叙事优先绑定第一段 content，arguments.author_reasoning 降级为空 content 回退通道。N-PLAN、D1-D7、机械推进语义不变。
