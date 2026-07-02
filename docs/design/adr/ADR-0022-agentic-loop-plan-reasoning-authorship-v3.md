# ADR-0022：Agentic Loop 计划可视化、评估重规划与叙事作者权 v3

- 状态：Proposed
- 日期：2026-07-01
- 来源文档：
  - `../notes/2026-07-01-agentic-loop-reasoning-stream-ui.md`
  - `../contracts/UA-01-unified-agent-run-loop-contract-pack.md`
  - `../00c-state-and-contract-atlas.md` §4 / §6 / §7 / §8 / §9
  - `../../engineering/scenario-invariants.md`（I1 因果绑定 / I3 种子贯通）
  - ADR-0021（AgentRun 与 Turn 边界）、ADR-0003（Planner Authority）、ADR-0004（OrchestratorDecision）、ADR-0013（DecisionTrace）、ADR-0014（Trace Redaction）、ADR-0015（TurnResultViewModel）
- 影响范围：Execution / Behavior / Trace / UI / Umbrella / Slice
- 相关不变量：UA-01 A 系列；场景不变量 I1 / I3；本 ADR 新增不变量 N-NARR（见「最终决策」）
- 首个证明 slice：`agentic-loop-plan-replan-reasoning`（待创建）
- 取代：无
- 取代者：无

> 关系说明：本 ADR **细化**（不取代）ADR-0021。ADR-0021 冻结了 AgentRun/Turn 边界、单步 re-gate、活动流、打断与 LongRunTask 关系；本 ADR 在其之上冻结三件 ADR-0021 未定的语义：AgentPlan 的可视化/版本化/修订、评估→重规划回路、以及作者可见叙事的作者权归属。ADR-0021 的执行权与边界决策全部保留。

---

## 背景

当前 AgentRun loop（ADR-0021）是 observation-led 的单步 next-decision 循环：`AgenticNextStepPlanner` 每轮只返回一个 `AgentNextStepDecision`（execute_step / goal_satisfied / await_author / no_progress）＋一句 `summary`，候选空间是 profile 内写死的 2–4 个 step_options。作者看到的「过程」由 `ProviderActivityProjector` 和前端 `agentRunTimeline` 用 event_type/purpose 拼成模板句（「步骤规划已开始调用创作模型」等），并把每个 provider 生命周期事件（started / request_prepared / dispatched / response_received / chunk / usage_recorded）逐条端到作者面前，夹带 `prun_/pcall_/token/phase` 等工程标识。

由此产生两个长期问题：

1. **信息流机械**：作者可见叙事约 95% 是 app 拼的模板常量，模型只贡献 artifact 正文与一句泛化 summary。这与项目最硬红线（I1/I3/场景不变量 = 内容必须模型产出、禁止 app 捏造或模板补齐）矛盾——只是过去红线只覆盖 artifact 正文，过程叙事一直是模板豁免区。
2. **loop 不够 agentic**：没有可检视的计划、没有把探索当一等公民、没有评估、没有「计划前提不成立 → 重新探索/规划/执行」的回路。机械感本质是忠实反映了一个直线型 pick-one 循环。

若不冻结这三件语义，后续 UI（`46§9`）和实现会各自发明叙事拼装方式，红线继续被绕过。

## 决策范围

本 ADR 冻结三个决策：

1. **AgentPlan 升级为可检视、可版本化、可修订的计划**。
2. **显式评估 → 重规划回路**。
3. **作者可见叙事的作者权归模型，结构骨架归 app**（含 provider 遥测降级）。

## 非目标

- **不改变 Planner「只提议、不批准」的权力边界**（ADR-0003）：评估与重规划仍不自我批准执行；每个 `act` step 仍必须生成单动作 `MicroPlan` 并重新经过 `ExecutionOrchestrator` gate（ADR-0021 / ADR-0004）。
- **不改 artifact / adoption / confirmation / projection 写入边界**（ADR-0010 等）。
- **不实现 durable checkpoint / resume**（留给 UA-CP5）。
- **不删除 provider 遥测事实本身**：`ProviderRun/Event/Output` 与其持久化留痕保留；本 ADR 只把它移出「作者叙事面」，改由开发者视图消费。
- **不暴露 provider 私有 reasoning / thinking / chain-of-thought**：本文的 reasoning 指作者可见、作者安全的叙事输出，不是供应商私有推理 token，也不是 raw chain-of-thought。
- **不承诺地板模型下的叙事质量**：地板档是 forcing function，不是叙事质量基准。
- **不允许以固定 workflow 冒充通用 Agent**（延续 ADR-0021）。

## 考虑过的方案

### 方案 A：保留现状，仅前端折叠美化

- 优点：改动最小、无后端风险。
- 缺点：叙事仍由 app 模板产出，作者已明确否决「文字是写死的」；无法产生探索/评估/重规划的真实动态；治标不治本。

### 方案 B：模型只产结构化 JSON（含一句 summary），app 继续负责把结构拼成作者叙事

- 优点：可测性好（结构可字节断言），与现有 next-step 协议接近。
- 缺点：正是当前机械感的根因；违反「内容归模型」；summary 单句无法承载计划/探索/重规划叙述。

### 方案 C：叙事措辞归模型（reasoning 一等流式输出）＋ 可修订计划 ＋ 评估/重规划 ＋ 遥测降级

- 优点：把 I1/I3 红线从 artifact 延伸到过程叙事；重规划让「计划行不通就重新探索」真实可见；保留 ADR-0021/0003/0004 全部执行权不变量。
- 缺点：叙事非确定、可测性差（需要新的不变量 driver 抓 app 模板残留）；需新增 contract、AgentEvent 事件族、planner prompt 与流式协议。

## 最终决策

采用方案 C。

**决策 1 — AgentPlan 可视化 / 版本化 / 可修订。**
`NovelDomain.AgentPlan` 扩展为跨迭代**持续维护并可就地修订**的对象：新增 `plan_version`、`revision_reason`；`steps[]` 每步语义类型为 `PlanStep`（不是运行期 `AgentStep`，也不是 `MicroPlan`），新增 `kind :: :explore | :act`、`status :: :pending | :active | :done | :skipped`，以及 `description`（**模型产出的措辞**）。本 ADR 若被接受，`PlanStep` 将取代 UA-01 §2 中 `milestones[]` 的作者可见计划表示；UA-01 的单步 `AgentStep` 执行边界不变。`explore` step 是只读信息收集，`act` step 才产生写入意图并按既有边界 re-gate。计划由 planner 每轮修订，而非每轮重造；单步 `AgentNextStepDecision` 降级为「本轮从当前 plan 中选出的那一步」。`PlanStep` 为**作者可感的里程碑粒度**（一次 run ≈3–6 条），一条 `PlanStep` 可跨多个运行期 `AgentStep` / 工具调用，**不与 tool call 1:1**，避免把逐事件刷屏在计划层重演。计划表示为**有序列表 + status/kind**，replan 时插入 / 废弃 / 重排；**不引入 runtime 强制的 step 依赖 DAG**——顺序由模型经 replan 决定，不由 DAG solver 决定；`step_options` 的 `requires/produces` 保留但仅作 planner prompt 的规划引导，不上升为每-run 机器强制依赖。`PlanStep` 可带可选、模型产的、仅供 UI 分组的 `depends_on` 提示（非 runtime 强制）。

**决策 2 — 评估 → 重规划回路。**
每次 observe 后新增一个 **evaluate** 判定：这一步是否推进目标、当前计划前提是否仍成立、是否出现新约束。判定驱动 `continue | replan | done | await_author`。`replan` 令 `plan_version + 1` 并携带**模型给出的 `revision_reason`**，可插入/废弃/重排 step。评估与重规划**不批准执行**（保留 ADR-0003 边界）。为防失控，探索与重规划次数受 `AgentRunPolicy` 预算约束。evaluate **折进 planner 同一次调用**（不新增独立 call site，避免 common continue 路径每轮翻倍调用）：结构尾巴字段顺序固定 `evaluation_of_last {advanced, plan_holds, new_constraint}` 在前、`decision` / `next_action` 在后，prompt 亦强制先评估后决策，压制「先定步、再倒填评估」。`plan_holds :: bool` 为可断言字段，由「垂直切面证明」的「前提不成立」scenario 守门（断言 loop 确实产出重规划）。此为**可逆决定**：若实测评估被规划裹挟（该 replan 时 `plan_holds` 恒真），再拆为独立便宜 evaluate 调用。

**决策 3 — 叙事作者权归模型，结构骨架归 app（新增不变量 N-NARR）。**
loop 的每次「思考」产出两段：① **reasoning 叙述**（作者安全、流式）；② **结构尾巴**（小 JSON：选哪个 step、plan/step 状态、是否 replan、是否 done/await）。作者可见的一切过程叙述（status 句、计划步骤描述、探索发现、评估结论、重规划原因）**其字节必须可溯源到某次模型输出**；②只驱动 app 骨架（状态 chip、版本号、进度、可选 action），**绝不作为叙述来源**。

为避免把 app 模板塞进 `author_narrative` 后自称 model-sourced，所有作者可见叙述片段必须携带最小 provenance：`provider_run_ref`、`provider_call_ref`、`provider_output_ref`、`source_hash`、`source_byte_range`（流式多片段时为 range 列表）和 `narrative_hash`。driver 以这些 refs 读取同一 turn/run 内的 ProviderOutput author-safe 原文或其可审计快照，断言 `author_narrative` 字节等于被引用的模型输出字节；`ProviderEvent.summary`、`AgentEvent.summary`、结构尾巴 JSON、前端 copy 常量都不能作为叙述来源。

> **不变量 N-NARR（本 ADR 冻结）**：AgentRun 作者可见过程叙述的字节来源必须是模型输出，并且必须有可机器验证的 source binding；`novel_application` / `novel_web` / `frontend` 生产路径中不得存在「读起来像叙事、用于填充作者可见过程叙述」的模板常量字符串。provider 生命周期遥测（run/call ref、chunk 序号、token、phase 枚举）默认不进作者叙事面，仅开发者视图消费。app 允许拥有的常量仅限：结构标签（「计划」「推理」「执行」）、状态/kind chip、版本号、进度与可选 action 文案。

## 决策理由

方案 C 让机械感的根因（叙事被 app 模板化 + 直线 pick-one 循环）同时消除，并与项目最硬红线同源：I1 因果绑定与 I3 种子贯通本就要求「内容必须模型产出、禁止模板补齐」，本 ADR 把该原则从 artifact 正文延伸到过程叙事。重规划回路把「探索发现前提不成立 → 改计划」变成作者可见的一等状态，这是「彻底 agentic」与「机械直线」的分水岭。同时它不触碰 Planner 权力边界与单步 re-gate，风险集中在叙事/计划表示层，不在执行权层。

## Contract 影响

修改 / 扩展：

- `NovelDomain.AgentPlan`：`plan_version`、`revision_reason`、`steps[].kind`、`steps[].status`、`steps[].description`；`steps[]` 的元素语义名为 `PlanStep`，不得与运行期 `AgentStep` 或启动 run 的 `MicroPlan` 混用。
- `NovelDomain.AgentNextStepDecision`：语义降级为「从 plan 选步」；新增 evaluate 结果表达（作为其扩展或新增 `AgentStepEvaluation`，实现期二选一，见非目标外的未决项）。
- `NovelCommon.Contracts.AgentEvent`：新增 author-safe reasoning 事件族 `plan_drafted` / `plan_revised` / `exploration_observed` / `evaluation_made`，并携带 `author_narrative`（model-sourced）和 `author_narrative_source`（provider refs / hash / byte range）字段。
- provider purpose 新增 `:author_reasoning`：承载流式作者安全叙述（区别于 `:planner` 的结构决策、`:writer` 的 artifact 内容，以及供应商私有 reasoning/thinking channel）。
- Trace（ADR-0013）：author-safe reasoning 叙述、plan 版本、`revision_reason` 与 `author_narrative_source` 记入 author-safe trace；raw prompt / chain-of-thought / provider private reasoning 仍按 ADR-0014 redact。

冻结不变量：N-NARR（见上）。

## Umbrella 边界影响

- `novel_domain`：AgentPlan / step / evaluation 纯 struct ＋ 校验；不得依赖 application/agent/persistence/web。
- `novel_common`：AgentEvent reasoning 事件族与 `author_narrative` / `author_narrative_source` 字段。
- `novel_agent`：`:author_reasoning` 作为流式 provider 输出的 purpose 与执行；planner prompt 产出「作者可见 reasoning 叙述 ＋ 结构尾巴」；不得引用 `NovelDomain` / `NovelApplication`，不得把 provider private reasoning/thinking token 转成作者叙述。
- `novel_application`：loop 维护并修订 AgentPlan、执行 evaluate、把 reasoning 流投影为 author-safe `AgentEvent`。**`ProviderActivityProjector` 不再产出作者叙事模板**，退回只把 provider 遥测投影到开发者视图。
- `novel_web`：Channel 转发 `agent_event` / `agent_run_state` / `agent_command`，不新增叙事拼装。
- `novel_persistence`：可选记录 plan 版本与 reasoning 留痕；bounded run 仍不强制 LongRunTask。

## UI / Trace / Replay 影响

- UI 依据原型 `46§9-agentic-loop-reasoning-flow`（`novel-studio.pen`，id `DM8gx`）渲染五态：探索中 / 执行中（单条进度替代逐片段刷屏）/ 受阻等待作者 / 重规划（v1→v2）/ 完成态。作者叙述来自 `AgentEvent.author_narrative`，app 只画骨架；provider 遥测折叠进开发者视图。
- Trace：reasoning 与 plan 修订可回放；作者面不出现机器 ref，但 trace/replay driver 能通过 `author_narrative_source` 在后台校验字节来源。
- Replay（ADR-0017）：默认不重跑 frame/step planner、writer、evaluator；展示已留痕的 reasoning 与 plan 版本序列。

## 垂直切面证明

首个证明 slice：`agentic-loop-plan-replan-reasoning`（待创建）。

证明路径：真实工作台输入「写下一章」→ 构造一个前提不成立场景（前文主角重伤，直接续写会冲突）→ 真实页面看到计划 v1、探索观察、评估判定「前提不成立」、重规划为 v2（携带模型给的原因）、执行、完成态计划回顾；作者可见叙述字节等于 `author_narrative_source` 指向的 ProviderOutput 字节（新增 N-NARR driver 抓 app 叙事模板残留）；provider 遥测仅在开发者视图。

## 迁移与兼容

- 延续 ADR-0021 的 next-step loop 与单步 re-gate；把「observation-led 单步决策」扩为「维护并修订可见计划 ＋ 评估/重规划」。
- reply-only / direct_tool / author_action 兼容路径保留。
- prose / character_design / plot_outline / world_building 等 profile 复用同一 loop 表示；固定 workflow 不复活。
- 分 CP 落地：CP1 可视化计划贯通（plan_drafted ＋ 前端计划面板）；CP2 评估＋重规划（plan_revised ＋ 重规划态）；CP3 reasoning 流一等输出 ＋ 遥测降级为开发者视图。

## 后续工作

- `00c` ADR Backlog、不变量总账和 slice 入口已登记 N-NARR / ADR-0022；Accepted 前需复核这些索引仍同步。
- 需落 `46-state-and-feedback.md` §9 正式 UI 文档（回链 `46§9` 原型）。
- 需要的 contract 冻结：AgentPlan / PlanStep 扩展字段、AgentEvent reasoning 事件族、`:author_reasoning` provider purpose 协议、`author_narrative_source` provenance 字段。
- 已定（2026-07-02，本 ADR 冻结范围内决议）：
  1. evaluate **折进 planner 同一次调用**（非独立 call site），配「先评估后决策」字段顺序纪律与 `plan_holds` replan scenario 守门；可逆——评估被规划裹挟时拆为独立便宜调用。
  2. 计划粒度 = **有序列表 + 里程碑级 `PlanStep`（一次 run ≈3–6 条）**，无 runtime 强制依赖 DAG；`step_options.requires/produces` 仅作 planner prompt 引导。
- Deferred（不影响本 ADR 冻结范围）：
  1. 地板模型下 reasoning 叙述的兜底策略。
