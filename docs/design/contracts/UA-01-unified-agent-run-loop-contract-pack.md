# UA-01 — 统一 AgentRun 循环与可打断创作对话流 Contract Pack

> **2026-10-24 联合修订已接受**：作者确认“确定 开工”，接受 B26/B27 联合设计及 ADR-0001 普通回复来源修订，并授权共享入口实现与验证。下文历史“待 Accepted / 本轮只改文档”描述保留当时语境，不再构成本次实施阻塞；实现和验收仍按各 slice 逐项留证。

> 状态：UA-CP0 至 UA-CP6 已落地；ADR-0023 CP1 已把普通 `conversation_turn_v1` 从 observation-led next-step planner loop 迁到「模型起草一次 AgentPlan + 机械推进」：profile routing 后目标 profile 起草包含 `context_assemble`、`dialogue_frame`、`strategy_gate`、`response_finalize` 的 per-run AgentPlan，后续按计划机械执行结构步并由完成条件收束；当前 focused/runtime 证据记录 direct path 2 provider calls，routed 验收口径为 4 steps / 0 tool / 3 provider calls，并证明 author_reasoning/conversation provider activity 可见。正文草稿 profile 在旧 observation-led proof 之后已进入 ADR-0023 CP1 首批计划驱动过渡态：`prose_drafting_with_quality_v1` 起草包含 context/prose_writing 的 per-run AgentPlan，context 后按计划机械推进到 `prose_writing`，工具 step 仍重新构造单动作 MicroPlan 并经过 Orchestrator gate，writer/evaluator ProviderExecution activity 继续进入 UI usage 轨迹；focused direct path 记录 2 steps / 1 tool / 3 provider calls，routed 验收口径为 2 steps / 1 tool / 4 provider calls。章节大纲、角色演化、世界设定、角色设计与修订 profile 已在 ADR-0023 CP3 checkpoint 迁到 model-drafted AgentPlan + mechanical cursor；章节大纲/角色演化/世界设定 routed 验收口径均为 2 steps / 1 tool / 3 provider calls，角色设计 routed 验收口径为 2 steps / 2 tool / 3 provider calls，修订 author_action 验收口径为 4 steps / 1 tool / 2 provider calls；world-building 两条真实 Tauri 分别保持 `foreshadowing_seed` / `style_rule_seed`，且 profile selection 因果由 `profile_routing_v1` 到 `world_building_with_context_v1` 的 state transition 与 final TurnResult profile 证明，当前 UI 不再声称展示旧 profile/path 字段。provider progress 与 readonly batch 也已在 ADR-0023 CP3 迁到 model-drafted AgentPlan + mechanical cursor：`agent-provider-streaming-progress` 证明 `provider_complete` 单步计划、3 条 author-safe progress 事件和 3 provider calls；`agent-readonly-batch-profile` 证明两步 `readonly_batch` 计划、4 项只读读取、4 tool calls 和 2 provider calls；`agent-provider-cancel-honest-boundary` 回归证明取消边界仍终态 `cancelled`。生产 `AgentRunSequentialPlanner` 已删除，现存 profile 的 `steps/1` 仅作为拒绝旧入口的 `no_return()` guard。UA-CP5 durable AgentRun + LongRunTask 已通过 backend restart 恢复验收；UA-CP6 provider progress / ProviderExecution cancel / readonly batch 已通过真实 Tauri 验收；自然语言 steering 已通过 `agent-natural-language-steer` 真实 Tauri 验收，章节大纲 profile 已通过 `agent-plot-outline-with-context` 真实 Tauri 验收，角色演化 profile 已通过 `agent-character-evolution-with-context` 真实 Tauri 验收，世界设定 profile 已通过 `agent-world-building-with-context` 与 `agent-world-building-style-rule-with-context` 真实 Tauri 验收，角色设计 profile 已通过 `agent-bounded-roster-to-character-design` / `ua01-agent-bounded-roster-to-character-design` / `agent-provider-call-budget` 真实 Tauri 验收，修订 profile 已通过 `p1-prose-revision-candidate` / `agent-revision-orchestrator-boundary` / `agent-replay-no-provider` 真实 Tauri 验收。已迁移 profile 由 AgentPlan mechanical cursor 推进，创作 act step 仍重新经过 MicroPlan / `ExecutionOrchestrator` gate。provider execution stream 统一架构已推进到 CP4D/CP5/CP6 对话主链活动投影与恢复：`agent-provider-execution-stream-unified` 真实 Tauri 证明普通 `conversation_turn_v1` 的 ProviderRun / ProviderEvent / ProviderOutput success facts 进入 developer telemetry，且 provider purposes 覆盖 author_reasoning / conversation；同一场景现在还证明 adapter 会在同一 execution stream 内投影 request_prepared / request_dispatched / provider_chunk / response_received 中间进展，其中 chunk payload 只携带序号、片段长度和累计长度，不携带 raw text delta。OpenAI-compatible vendor family、DeepSeek、LM Studio 与 Anthropic 已在同一 ProviderExecution runtime 内接入 wire-level SSE adapter：adapter `execute/5` 发送 `stream: true`，解析 SSE data frames，chunk 只投影为 redacted telemetry metadata，最终文本仍只在 terminal ProviderOutput 物化。`Provider.CancellationToken` 已接入同一 runtime：AgentRun cancel 请求 `provider_execution_cancel`，SSE adapter 停止继续读取并物化 `cancel_requested` / `cancelled` ProviderExecution facts。`Provider.Execution` public dependency 不接受裸函数，内部 final-result callback 字段已从 `complete_fn` 收口为 `result_fn`。`agent-provider-execution-error-author-safe` 证明 provider_error facts 也进入 developer telemetry，并收束为安全 TurnResult；`agent-provider-execution-activity-restored` 证明刷新/恢复后 transcript 只保留 AgentRun summary，作者展开同一 assistant 工作详情时通过 scoped AgentRun activity API 按 work/session/turn 异步读取同一批 developer telemetry 与 ProviderRun usage/event/output summary facts。ProviderRun 同一对话流 replay UI 已通过 fresh Tauri：事件序列、输出摘要和 no-provider-recall boundary 从 persisted facts 展示。当前 live provider matrix 只覆盖本地 LM Studio 与 DeepSeek；LM Studio 已有真实 Tauri + HTTP log 证据，DeepSeek 入口因当前 shell 缺 key 标记凭据阻塞，其他供应商等待用户提供 key 后再进入 CP。仍不能以历史 CP6 checkpoint progress、chunk metadata CP 或旧 `complete` 体系冒充 live vendor 真实矩阵已完成。
> ADR-0023 CP2 的 D1-D4、D6-D7 偏离信号、无偏离直通与 steer budget 当前证据（D5 见 B20 修订）：已迁移的 `conversation_turn_v1` 与 `prose_drafting_with_quality_v1` 在 AgentPlan cursor 走完但 profile 完成条件未成立、工具失败、质量行动、gate deny/require_confirmation、预算不足（B20 后先 `plan_budget_shortfall` 停等）、确定性缺口或作者 steer 时，先检查 `max_replans` 并调用 provider-backed 计划修订器；修订路径产出 `plan_revised`、`plan_version+1` 与 `replan_count=1`，随后继续沿修订后的 AgentPlan 机械推进或等待作者。真实 Tauri 已证明：D1 `agentic-loop-tool-failure-replan`（2 steps / 1 tool / 5 provider calls / 1 replan）、D2 `agentic-loop-quality-deviation-replan`（2 / 1 / 5 / 1，pending candidate TurnResult 但 AgentRun 仍 `awaiting_author`）、D3 `agent-natural-language-steer`（同一 active run 消耗 1 replan 且无第二作者 turn/run）、D4 `agentic-loop-gate-deviation-replan`（2 / 0 / 3 / 1，writer 未 dispatch）、D5 预算缺口 `agentic-loop-budget-deviation-replan`（规划总账 3 步、执行 1 步、0 tool（作者结构化 `author_limits.max_steps=1`）；TurnResult 提供“下一步/接下来 2 步/剩余全部”，勾选 2 步后 `budget_expanded` selected_steps/2 并恢复同一 run；选中 scope 完成后恢复剩余计划 checkpoint，非 `plan_revised`）、D6 `agentic-loop-plan-replan-reasoning`（4 / 0 / 4 / 1）与 D7 `agentic-loop-deterministic-gap-replan`（2 / 0 / 3 / 1，`tool_completed_event_count=0`、`log_toolbox_execute_count=0`）。`agentic-loop-no-deviation-direct` 已证明普通 conversation 初始计划完整、无 `plan_revised`、`consumed_replans=0`。ADR-0023 CP3 已把 `plot_outline_with_context_v1`、`character_evolution_with_context_v1`、`world_building_with_context_v1`、`provider_progress_v1`、`readonly_batch_context_v1`、`character_design_with_context_v1` 与 `prose_revision_from_findings_v1` 迁到 model-drafted AgentPlan + mechanical cursor，并由真实 Tauri `agent-plot-outline-with-context`、`agent-character-evolution-with-context`、`agent-world-building-with-context`、`agent-world-building-style-rule-with-context`、`agent-provider-streaming-progress`、`agent-readonly-batch-profile`、`agent-bounded-roster-to-character-design`、`ua01-agent-bounded-roster-to-character-design`、`agent-provider-call-budget`、`p1-prose-revision-candidate`、`agent-revision-orchestrator-boundary` 与 `agent-replay-no-provider` 证明。ADR-0023 CP4 已把 AgentPlan draft/revision 从 JSON tail 迁到 provider-native tool calls：`AgenticPlanDraftPlanner` 只接受 `agent_plan_draft` / `agent_plan_revision` tool call arguments；`agent-plan-native-tool-calling-protocol` 真实 Tauri 证明 activity summary 暴露 native tool-call count/name 且不泄漏 arguments。
>
> 角色：冻结 UA-CP1 至 UA-CP6 需要消费的 AgentRun / AgentPlan / AgentStep / AgentObservation / AgentEvent contract，以及 bounded/durable runtime、事件流、打断语义、角色/正文/大纲/角色演化 profile 和 durable resume 的验收边界。
>
> 上游：`VS-01-execution-authority-contract-pack.md`、`VS-02-tool-provenance-contract-pack.md`、`VS-06-replay-surface-contract-pack.md`、`VS-00E-prose-execution-quality-contract-pack.md`、ADR-0001 至 ADR-0021。

---

## 0. 当前基线

已存在并必须复用：

- 每个作者 turn 的 primary `DialogueFrame`。
- Planner 输出 `MicroPlan`，且不能批准自己的建议。
- `ExecutionOrchestrator` 是工具执行唯一裁决边界。
- 每个工具调用都有 `ToolRequest` / `ToolResult`，工具结果默认不是作品事实。
- 创作产物默认 `TentativeArtifactSet`，采纳必须走既有 adoption boundary。
- replay 默认不重新调用 provider。
- VS-00E 已落地 `ProseExecutionBrief`、`QualityFinding`、writer/evaluator/revision provider call refs 和 revision Orchestrator 边界；UA-CP0 已把 revision 工具执行重新接回 Orchestrator + 授权执行边界。

已落地（UA-CP1 至 UA-CP6）：

- `NovelDomain.AgentRun` / `AgentPlan` / `AgentStep` / `AgentObservation` / `AgentNextStepDecision` / `AgentRunPolicy`、`NovelCommon.Contracts.AgentEvent` 与 `NovelAgent.AgentTaskProfileRegistry`。
- supervised bounded runtime：`NovelApplication.AgentRunRegistry`、`AgentRunSupervisor`、`AgentStepTaskSupervisor`、`AgentRunServer`、`AgentRunService`。
- `agent_run_start` primary MicroPlan action 与 `allow_agent_run` 裁决；run 内部 step 仍逐步生成单动作 MicroPlan 并重新经过 `ExecutionOrchestrator`。
- Channel 快速 ack、`agent_event`、`agent_run_state`、`agent_command`（pause/resume/cancel/steer）协议，以及前端 AgentRun 活动面板。当前真实页面控制已覆盖 pause/resume/cancel/steer；steer 既可由可见“调整方向”输入框提交，也可在 active AgentRun 期间由主聊天输入框自然语言提交，后端 ack 后广播 `plan_adjusted` 与新版 `agent_run_state`。主输入 steer 不创建第二个后端 `user_message` / 作者 turn / run，但前端必须把作者补充文本作为本地作者消息锚在同一 active run 的结构工作态之前。
- `NovelPersistence.AgentRunLog` 与最小持久化表 `agent_runs` / `agent_run_steps` / `agent_events` 已落地；runtime 写入 run/step/event 审计记录，`agent_events` 按 `(run_id, sequence)` 唯一，持久化 payload 会剥离 nested `turn_result`。
- 首个真实切面：复合作者请求触发 bounded run，依次执行 `character_roster` observation 与消费该 observation 的 `character_design` step，输出 tentative `character_seed`，未采纳不写生产角色档案。
- 真实 Tauri 验收入口：`ua01-agent-bounded-roster-to-character-design` 及 `agent-*` 场景，证据目录 `artifacts/slice-verify/<scenario-id>-tauri/`。

CP4 已把正文主链迁入 AgentRun lifecycle；ADR-0023 CP3 后，`prose_revision_from_findings_v1` 已继续迁到 model-drafted AgentPlan + mechanical cursor：一次计划起草给出 `revision_prepare`、`revision_plan`、`prose_writing`、`revision_finalize` 四步，`revision_plan` step 仍重建 revision MicroPlan 并经过 Orchestrator gate，`prose_writing` step 生成 sibling tentative revision candidate，finalize 汇总给作者确认。当前实现保留 revision provider call ref、原稿/修订稿 sibling tentative 边界与 replay no-provider policy；计划起草与 revision writer 都进入 consumed provider budget，author_action 真实 Tauri 口径为 4 steps / 1 tool / 2 provider calls。`prose_drafting_with_quality_v1` 已从旧 observation-led next-step loop 继续迁到 ADR-0023 CP1 计划驱动过渡态：model-drafted AgentPlan 先给出 context/prose_writing 两步，runtime 机械执行 context 后推进到 `prose_writing`；工具 step 仍为单动作 MicroPlan → Orchestrator gate → writer/evaluator provider calls → quality/artifact observations → completion decision。当前实现保留 writer/evaluator provider call refs 与 UI usage/activity 轨迹，direct focused path 记录 2 steps / 1 tool / 3 provider calls，routed 验收口径为 2 steps / 1 tool / 4 provider calls。正文以外更多创作 profile 已从固定 workflow 纯化为真正 loop：`plot_outline_with_context_v1`、`character_evolution_with_context_v1`、`world_building_with_context_v1` 与 `character_design_with_context_v1` 已进一步迁到 model-drafted AgentPlan + mechanical cursor，计划一次性包含只读上下文/阵容读取与目标创作工具步，工具 step 重新构造单动作 MicroPlan 并经过 Orchestrator gate，最终分别生成 tentative `outline_draft` / `character_evolution_seed` / 世界设定类草稿 / `character_seed`；world-building 继续通过原始 `author_goal_text` 约束 artifact type 判定，真实 Tauri 已证明 `foreshadowing_seed` 与 `style_rule_seed` 两条分支均保持 2 steps / 1 tool / 3 provider calls，角色设计保持 2 steps / 2 tool / 3 provider calls。上述产物未采纳前均不写作品事实。

CP5 已落地 durable AgentRun + LongRunTask 恢复闭环：durable run 创建 `LongRunTask`，runtime checkpoint 同步 run state / completed step refs / budget / pending artifacts；Channel join 可重新绑定 live runtime sink，或在 backend restart 后从 checkpoint 广播 author-safe `run_resumed` 与 `agent_run_state`，stale snapshot 进入 `awaiting_author` 而不是静默继续。当前 durable checkpoint contract 为 v2：除 run/checkpoint 自身版本外，启动时的 `work_revision`、`target_revision_ref`、`target_revision` 可作为事实锚点写入 `authority_scope` 与 `checkpoint_data.agent_run`。stale reason 必须进入 `checkpoint_data.stale_reason` 与 run `failure_ref`，当前区分 `goal_version_mismatch`、`checkpoint_goal_version_mismatch`、`checkpoint_version_missing`、`checkpoint_version_mismatch`、`session_ref_mismatch`、`work_ref_mismatch`、`work_revision_mismatch`、`target_revision_mismatch`、`target_ref_missing`、`durable_runtime_not_live`、`forced_stale_recovery`。CP6 已补 provider progress、ProviderExecution cancel 边界和只读 batch：它证明 author-safe progress、同一 ProviderExecution 取消状态和 read-only batch profile。

## 1. AgentRun

`AgentRun` 是一个作者 turn 下的受限执行会话，不是新的作者 turn，也不替代 `DialogueFrame`。

最小字段：

```yaml
run_id: run_xxx
run_mode: bounded
workspace_id: ws_xxx
work_id: work_xxx
session_id: session_xxx
parent_turn_ref: turn_xxx
origin_frame_ref: frame_xxx
profile_ref: character_design_with_context_v1
goal: { text, version }
status: running
phase: executing
plan: AgentPlanV1
plan_ref: agent_plan_xxx
plan_version: 1
current_step_ref: step_2
completed_step_refs: [step_1]
authority_scope: { production_write: false, allowed_tools: [character_roster, character_design] }
budget: { max_steps: 5, max_tool_calls: 4, max_provider_calls: 3, max_replans: 1 }
consumed_budget: { steps: 1, tool_calls: 1, provider_calls: 0, replans: 0 }
interrupt_state: { status: none, requested_at: null }
pending_artifact_refs: []
active_behavior_ref: null
long_run_task_ref: null
```

Bounded run 不强制创建 `LongRunTask`。durable run 必须关联 `LongRunTask`；该语义已在 UA-CP5 实现。

## 2. AgentPlan

`AgentPlan` 是作者可理解的执行步骤计划，不是 `MicroPlan` 数组。

当前实现中 `AgentRun.plan_ref` 指向 `AgentPlan.plan_id`（`ap_*`），`agent_run_start` 的 primary `MicroPlan`（`mp_agent_run_*`）只负责启动 run 的一次性 gate，不作为 AgentRun 的 plan 身份。

```yaml
plan_id: ap_xxx
run_ref: run_xxx
version: 1
goal_version: 1
steps:
  - step_id: inspect_roster
    kind: explore
    status: active
    description: 读取当前角色阵容
    success_criteria: [character_roster_observation_exists]
    depends_on: []
	  - step_id: design_character
	    kind: act
	    status: pending
	    description: 设计新的主要反派
	    success_criteria: [tentative_character_seed_exists]
	    target_tool_ref: character_design
	    write_intent: tentative
	    risk_hint: low
	    authoring_intent: null
	    target_chapter: null
	    requested_chapter_raw: null
	    depends_on: [inspect_roster]
stop_conditions:
  - author_interrupt
  - confirmation_required
  - budget_exhausted
  - no_progress
  - goal_satisfied
```

禁止把 `AgentPlan.steps` 直接转成批量 `ToolRequest`。

### 2.1 AgentNextStepDecision 与 next_step_planner

AgentRun runtime 的下一步只能来自 `next_step_planner(run, sequence, snapshot)` 返回的 `AgentNextStepDecision`，不得由调用方传入裸 `steps` 列表启动运行。

`AgentNextStepDecision` 只回答循环下一步状态：

```yaml
decision_id: and_xxx
run_ref: run_xxx
sequence: 2
decision_type: execute_step # execute_step | goal_satisfied | await_author | no_progress
summary: 基于角色阵容继续设计反派
target_tool_ref: character_design
observation_refs: [obs_roster_xxx]
write_intent: tentative
risk_hint: low
confidence: 0.74
reason_codes: [roster_observation_available]
```

该 decision 不是 `MicroPlan`，也不批准工具执行；当 `decision_type=execute_step` 时，后续仍必须在该 AgentStep 内构造单动作 `MicroPlan` 并重新经过 `ExecutionOrchestrator.decide`。ADR-0023 CP1 后，`conversation_turn_v1` 与 `prose_drafting_with_quality_v1` 已由模型起草 per-run `AgentPlan` 再机械推进；ADR-0023 CP3 当前 profile checkpoint 后，`plot_outline_with_context_v1`、`character_evolution_with_context_v1`、`world_building_with_context_v1`、`provider_progress_v1`、`readonly_batch_context_v1`、`character_design_with_context_v1` 与 `prose_revision_from_findings_v1` 也由模型起草 per-run `AgentPlan` 再机械推进。不得恢复 `steps:` 启动参数、`planner || steps` 隐式 fallback，或把 profile `steps/1` 从拒绝旧入口的 guard 改回可执行 workflow。

ADR-0023 CP0 已加固现有 next-step planner 协议：若 provider 输出的两段式 JSON tail
无法解析为合法 JSON 对象，或未满足必填协议字段 / profile 工具边界，planner 必须携带失败
片段与原始任务重试一次；第二次仍失败则诚实返回 planner error，不伪造 decision。retry
不是免费分支，成功后必须把 `provider_call_count=2` 透传回 AgentRun consumed budget。
planner prompt 中的 observations 必须包含最近若干条 observation 的 author-safe summary
与紧凑 `structured_payload`；不得把完整 ToolResult 原文、raw provider output 或无限上下文
塞进 prompt。该段只描述 legacy 单步 next decision 的加固边界；ADR-0023 CP4 后，
生产 AgentPlan draft/revision 不再解析 JSON tail。

ADR-0023 CP1 首批已把 `conversation_turn_v1` 与 `prose_drafting_with_quality_v1`
迁到 plan-driven 过渡态：目标 profile 先由 provider-backed `AgenticPlanDraftPlanner`
起草 per-run `AgentPlan`，`plan_drafted` 只为整份模型计划广播一次；后续 context /
frame / strategy / finalize 或 context / prose_writing 步由 runtime 沿计划机械推进，
只产生对应结构事件（如 `goal_understood`、`evaluation_made`、`gate_decided`、
`tool_started`、`tool_completed`、`artifact_created`、`turn_result_ready`），不再为
每个确定性下一步追加模型 planner 调用。act step 仍必须重建单动作 `MicroPlan`
并经过 `ExecutionOrchestrator` gate。ADR-0023 CP3 章节大纲、角色演化与世界设定 checkpoint 已把
`plot_outline_with_context_v1` / `character_evolution_with_context_v1` / `world_building_with_context_v1` 加入同一形态：
计划只起草一次，后续按 cursor 机械推进到 act step，章节大纲、角色演化与世界设定真实 Tauri routed 口径均为
2 steps / 1 tool / 3 provider calls。ADR-0023 CP3 后，角色设计与修订也加入同一形态：
`character_design_with_context_v1` 计划为 `character_roster` / `character_design` 两步，
routed Tauri 口径为 2 steps / 2 tool / 3 provider calls；`prose_revision_from_findings_v1`
计划为 `revision_prepare` / `revision_plan` / `prose_writing` / `revision_finalize` 四步，
author_action Tauri 口径为 4 steps / 1 tool / 2 provider calls。不能把旧逐步 next-step
planner 口径反推到已迁移 profile。

ADR-0023 CP2 已补 D1-D7 偏离后的修订语义：已迁移 profile 在 PlanStep 全部走完但完成条件仍缺失、工具失败、质量行动 finding、Orchestrator gate deny/require_confirmation、预算不足、作者 steer 或确定性缺口命中时，不直接完成或失败；runtime 先按 `max_replans` 做确定性预算核对，有预算则调用计划修订器产出修订版 AgentPlan，并通过既有 `plan_revised` 事件携带 `evaluation_of_last.plan_holds=false`、`plan_revision.revision_reason`、`plan_version+1` 和 N-NARR 绑定的作者叙事。修订后的下一步仍只是 `AgentNextStepDecision`，不批准工具执行；act step 必须继续重建单动作 `MicroPlan` 并经过 `ExecutionOrchestrator` gate。

当前真实 Tauri summary 口径：D1 `agentic-loop-tool-failure-replan` 记录 2 steps / 1 tool / 5 provider calls / 1 replan；D2 `agentic-loop-quality-deviation-replan` 记录 2 / 1 / 5 / 1，且 quality confirm 只暴露 pending candidate TurnResult，AgentRun 仍等待作者；D3 `agent-natural-language-steer` 记录 `command=steer` / `command_source=main_input` / `adjusted_goal_version=2` / `consumed_replans=1` / `no_second_user_message_for_steer=true`；D4 `agentic-loop-gate-deviation-replan` 记录 2 / 0 / 3 / 1，`gate_decision_type=require_confirmation`、`gate_first_blocking_gate=authority`，writer 未 dispatch；D5 `agentic-loop-budget-deviation-replan` 记录规划总账 3 步、执行 1 步、0 tool；作者选择“接下来 2 步”触发 `budget_expanded` steps/2 并恢复同一 run；D5 `plan_revised` 属旧 conversation 路径，当前不可达；D6 `agentic-loop-plan-replan-reasoning` 记录 4 / 0 / 4 / 1 并证明修订计划恢复 `dialogue_frame` / `strategy_gate` / `response_finalize` 后继续完成；D7 `agentic-loop-deterministic-gap-replan` 记录 2 / 0 / 3 / 1，`tool_completed_event_count=0`、`log_toolbox_execute_count=0`，writer/toolbox 未执行。无偏离直通 `agentic-loop-no-deviation-direct` 记录 `initial_plan_step_count=4`、`plan_revised_event_count=0`、`consumed_replans=0`、`consumed_provider_calls=3`，证明普通路径只消费起草计划且不重规划。

ADR-0023 CP4 已冻结 AgentPlan draft/revision native tool-call schema：计划起草 prompt 强制
`tool_choice=agent_plan_draft`，计划修订 prompt 强制 `tool_choice=agent_plan_revision`；
tool arguments 对象包含 `plan.steps[]`、`reason_codes`、`confidence` 与每步的
`kind` / `description` / `success_criteria` / `target_tool_ref` / `write_intent` /
`risk_hint` / 写作坐标等结构字段。作者可见 planning prose 只能来自 provider output
content，并继续受 N-NARR source binding；tool arguments 不进入作者主视图、activity API
或 persisted provider output summary。`ProviderOutput.content_summary` 与 scoped activity API
只允许暴露 `native_tool_call_count` 与 `native_tool_call_names`，用于 developer telemetry
证明 native protocol 被消费。`agent-plan-native-tool-calling-protocol` 真实 Tauri summary
记录 `native_tool_call_names=[agent_plan_draft, agent_plan_revision]` 与
`native_tool_call_final_output_count=2`，并证明修订后 runtime 继续沿 AgentPlan 机械推进。

> **2026-10-23 B26 修订**：上段「强制 `tool_choice=agent_plan_draft` / `agent_plan_revision`」口径作废，改为 §2.2 单调用 auto 协议；arguments 结构字段、N-NARR source binding、telemetry 只暴露 `native_tool_call_count/names` 三条不变。

### 2.2 单调用判断协议（B26 / B27，2026-10-24 联合修订已接受）

本节为两项 slice 共用的模型调用协议真源。作者已授权文档对齐；不据此宣称修订 Accepted、代码实施或页面验收完成。生产切换前仍须核对实态。本节替代 §2.1 历史两段式/forced 判断与计划口径，保留 N-PLAN、执行门禁、采纳与来源保护。

“单调用”指每次判断/计划推理不再拆成叙事调用与结构调用。取证后再判断、补起草和纠错可有后续调用，必须按实际次数计预算；不把一次作者请求伪报为一次调用。同响应同源不自动证明语义一致，B27 仍校验目标、对象、效果与证据。

#### 2.2.1 请求形状与唯一探索入口（J4）

~~~yaml
# 对话判断 profile；以下为目标协议工具，不表示已实现
tools:
  - judgment_decision
  - ask_author
  - agent_plan_draft
  - register_author_content
  - propose_creative_directions
  - report_capability_gap
tool_choice: auto
~~~

- judgment_decision.action 仅为 execute / plan / explore。创作经 execute + capability 派发；探索唯一入口为 explore + explore_request{tool, query}，不同时注册 chapter_read / archive_read 等为第二套 native tools。
- 探索目录仍来自 ExplorationService 实际支持项，参数说明与 B24/B25 读取契约一致、身份优先 chapter_ref；应用验证 scope/权限/预算。目录与操作效果由 B27 同源整合。
- 续行 profile：tools=[continuation_decision, ask_author, report_capability_gap]；continuation_decision.action 仅为 continue，guidance 为可执行修正建议。模型停等一律 ask_author，不保留 continuation_decision.await_author。
- 非判断入口的计划起草/修订：tools 分别仅为 [agent_plan_draft] / [agent_plan_revision]，仍 auto；缺结构输出不能把自然文本当作计划。
- 每个 call_site/profile 的工具集合/schema 在同 run 内固定且有版本；不同职责 profile 可以不同。合法来源/对象 refs、当前版本、available_operations、权限撤回是动态状态，不每轮塞进工具 schema 枚举破坏前缀；执行前重新校验。
- 普通回复无工具；需要原文物化、可操作方向或结构化缺口时，使用下节明确业务工具。这不是为每次回复再调用一次模型抽结构。
- 模型侧业务工具不自动进入 creative capability registry；handler 复用已有业务边界。调用工具不获得修改 canon 的权限，作品写入仍经既有采纳/确认。

#### 2.2.2 提问与结构化业务输出

**A. ask_author：模型停等唯一出口（J3；F1 空选项回传与恢复补齐）**

模型输入 schema 保持 question（非空原话）、options（数组，可空）、reason_codes（可选）；每个 option 的 label/value 非空，value 不含首尾空白且在本问题内唯一，kind 为 choice/free_text（缺省 choice），recommended 只提示不自动提交。原始 options 不由应用补成虚构选择。

**A1. 每次提问都产生持久问题与可回复动作**

ask_author 成功处理的最小交付不是一条活动文字，而是独立、可恢复的 TurnResult。无论 options 是否为空，都将实际 run 的 awaiting_author/stopped 与当前问题绑定、问题 TurnResult、源事件作为同一可恢复交付记录后才广播 awaiting_author；不得只写 TurnResult.agent_run 摘要而遗漏运行事实：

~~~yaml
TurnResult:
  turn_id: <本问题独立、稳定的 source_turn_ref>
  agent_run: {run_id: <run_id>, parent_turn_ref: <原输入>, status: awaiting_author}
  author_question:
    question_ref: <app 铸造；同一有效响应重放复用>
    run_id: <run_id>
    goal_version: <提问时实际版本>
    source_turn_ref: <本 TurnResult.turn_id>
    question: <模型原话>
    options: <模型原样结构>
    status: open                 # 恢复投影：open / answered / closed
    close_reason: null           # answered / superseded / cancelled / terminal / runtime_lost
    provider_call_ref: <本次模型来源>
  available_actions:
    - <每个模型 option 对应一个 author_choice>
    - <始终存在一个系统“回复此问题”free_text 动作>
~~~

author_question 是 TurnResult 的拟新增可选 wire 字段，非小说 canon。复用 Interaction.content.turn_result 保存原始问题、AgentEvent 保存状态事件、AuthorActionReceipt 保存回复回执；不新增问题表。问题文本/options/来源不可被状态更新改写；status、close_reason 和动作 enabled 由已提交回复、当前 run/goal、后续问题及运行权威投影。每个 run 最多一个 open 模型问题，不同 run 可各有问题；新问题使该 run 的旧问题 closed/superseded。重放同一个有效 provider 响应不得生成第二个问题/动作 ID。

恢复状态优先级固定为：有已接受回复→answered/answered（即使后续 run 失败也不改为“未答”）；否则新问题/goal version 变化→closed/superseded；否则取消→closed/cancelled、bounded runtime 丢失→closed/runtime_lost、其他终态→closed/terminal；其余当前有效问题为 open。durable 尚未恢复只令动作 disabled，不擅自关闭持久 open 问题。answered/closed 动作全部禁用。

available_actions 的精确增量（其他 action_type 不改变）：
- 共同已有字段：action_type=author_choice，target_ref=run_id，source_turn_ref=该问题 TurnResult；action_id、idempotency_key、trace_ref 由 app 铸造并绑定该问题。
- 拟新增字段：question_ref（非空字符串）、expected_goal_version（正整数）、response_kind（choice/free_text）；可选 label（非空字符串，仅模型 option.label 原话）。这些字段同步进入 wire schema/codegen，不能仅存 UI 私有状态。
- 模型选项：candidate_ref=option.value，response_kind=option.kind，label=option.label；固定 label_key 使用 author_question.option，前端显示 label 原话，不把它当翻译键。kind=free_text 的选项只打开绑定输入框，非空输入提交后才算回答。
- 系统自由文本动作：response_kind=free_text，candidate_ref 与 label 均省略，label_key=author_question.reply；固定按钮文案来自 copy.ts。这是回复入口，不是模型候选，也不改写 options。options=[] 时至少仍有这一动作。
- UI 的 reply composer 持有源动作引用，不根据 latestAgentRun/数组/广播顺序造动作。点击问题卡的回复入口或模型 free_text 选项即绑定该问题并显示其问题摘要；“发送新请求”明确清除回复绑定，沿普通 user_message 发新输入。多个 open 问题时由可见卡片选择，不自动猜目标。

**A2. 统一请求、校验、幂等与原话**

choice 和 free_text 均沿现有 author_action，禁止空选项绕回无问题身份的 agent_command.steer：

~~~yaml
author_action:
  action:
    action_id: <源 available_action.action_id>
    action_type: author_choice
    source_turn_ref: <源问题 turn_id>
    target_ref: <run_id>
    candidate_ref: <模型选项 value；系统回复动作省略>
    idempotency_key: <源动作绑定键，客户端不得改造>
    payload:
      submission_id: <一次作者提交的稳定身份；重传复用，编辑后新发换身份>
      question_ref: <源问题身份>
      expected_goal_version: <源问题版本>
      text: <仅 free_text 必填；保留作者原文>
~~~

- response_kind、显示标签与选项内容均以服务端已持久源动作为准，不信客户端补字段。先按 Q3D 的 work/session/submission_id 核对持久原输入与 payload 摘要，再执行 ActionValidator 的 source/action/scope/disabled 检查和问题状态检查。
- 校验当前 work/session、question_ref、source_turn_ref、run_id、goal_version、真实 open 问题、run.status=awaiting_author 及可执行的 runtime 权威；free_text 仅用 trim 判空，保存和传给后续模型的仍是原始字节。空文本、越界、旧问题、旧版本、失活/终态拒绝，不推进 goal。
- 保留 source action 的 idempotency_key 作为动作绑定键；该动作的提交回执键由 app 机械派生 SHA256(work_id、session_id、question_ref、action_id、绑定键、submission_id 的规范序列化)。查找/写入 AuthorActionReceipt 使用派生回执键，ActionValidator 比较的仍是源动作绑定键，不能混用两个键。复用现有 receipt 字符串字段，不让客户端自造新的授权键。
- 作用域与原输入摘要校验后，已提交的同 submission_id/同 payload 必须先返回原回执，再考虑当前问题是否已关闭；只有无已提交回执的新请求才执行 open/版本/disabled 校验。这样即使问题已经 answered 也不再次 steer；同身份不同 payload 为 submission_conflict。字段校验失败可用新 submission_id 修正重发；同问题的不同提交并发最多一个被接受。
- 接受回复前按 run/question 串行化；持久作者输入、answered 事实、回执及待应用的 steer 来源要有同一提交边界。运行应用该回复按 submission_id/目标 goal version 去重，goal.version 只加1，不重置累计预算。
- choice 的 steer 文本来自已验证的 option.label，且保存 value/问题/动作来源；free_text 用作者原文。用户文本记录先可靠留存再开始后续推理；不新增 Channel 事件或 AgentRunServer 公开命令。
- ack 至少携带 question_ref、submission_id、status（accepted/rejected）、duplicate（布尔）、实际 agent_run_state 与当前 goal_version；重复提交返回原 status 并置 duplicate=true，不新增 duplicate 状态枚举。拒绝给结构化 reason_code 且保留输入；accepted 只说明输入已接收，不等于任务完成。duplicate 只复用原提交的语义结果；agent_run_state/runtime_live 每次取当前持久事实或活 runtime，不把回执中历史 running 快照重新广播成当前运行。

**A3. 刷新、断线与失活恢复**

- HTTP resume/show 与 Channel join 恢复快照均新增 open_author_question_turn_results 数组，返回同活动 work/session 的全部 open 问题源 TurnResult（含 author_question 和真实 available_actions）；不复制成新聊天消息，不复用 pending_adoption_turn_results 冒充问题。列表按 source_turn_ref/question_ref 去重，排序不决定输入目标。模型 options=[] 也必须在其中；闭合问题不再作为可答对象返回。动作验证与重复回执查找仍可按实际 source_turn_ref 读取原持久问题，不能因它移出 open 列表就拒绝合法重复回执。历史会话仅回看、不恢复 enabled 动作。
- 已绑定 composer 或本地 pending submission 恢复时核对 question_ref/版本/源动作；有效则仍指原问题。无法恢复未发送草稿的绑定时，让作者从可见问题卡重新选择，不回退 latestAgentRun；已投递记录必须按 Q3D 原身份恢复。
- 未收到 ack 时先核对 durable receipt；已接受则恢复原回执/当前状态，不重跑模型或加 goal version；未接受且问题仍有效才允许同身份重传。拒绝/过期保留原输入但不自动重发到新问题。
- 回答提交后在 runtime 应用前崩溃：输入/回执仍可查询；活 runtime 或 durable run 按既有恢复机制去重应用。bounded runtime 已死则保留已接收输入，运行按 runtime_lost_on_restart 诚实失败，不自动复活、不改投其他 run；durable 恢复未完成时动作禁用，恢复验证完成后再启用。
- 取消、终态或新问题使旧动作 disabled；校验失败不关闭仍有效的 open 问题。取消与回答按同一 run 串行次序裁决：取消先提交则拒答；回答先提交则保留输入/回执，后续取消终止新执行，不抹掉已接收输入。

**A4. 责任边界**

ask_author 不是覆盖确认或采纳：即使模型选项文字是“同意/保存”，author_choice 也只形成该问题的 steer 输入，不能直接当作 accept/confirm 授权。

B26 独立负责上述明确问题的 wire、持久投影、自由文本/选项动作、恢复、幂等与过期拒绝；不以 B31 未完成为借口省略空选项验收。B31 仅处理没有明确问题动作绑定的一般自由输入、旧 run/新话题辨识等通用归属。两者共享已有 Q3D 原话/身份保护；B26 不依赖 B31 才可验收。预算/no_progress/writer timeout 等应用停机仍走原机制，不伪造模型问题。

**B. register_author_content：原文登记明确通路（J2）**

~~~yaml
name: register_author_content
required: [author_content_source_ref, dialogue_goal, author_reasoning]
properties:
  author_content_source_ref: current 或本轮合法来源清单中的真实 turn_ref
  dialogue_goal: 作者要求登记什么及用途
  author_reasoning: 对作者的简短说明原话
~~~

- 不接受模型提供 body/content/source_text 冒充作者原文。应用按验证后的 source_ref 读取原消息字节，复用作者源候选物化/去重/采纳链，不调用 writer 重写，不自动入 canon。
- 来源必须明确且在当前 work/session 可引用；current 要显式给出，缺失不默认当前输入。消息全文/指令前缀边界保留 ADR-0027 D4 口径，不由 app 自动摘录。
- 同来源已有 pending/accepted 时返回真实对象与状态，不重复物化；全版本放弃后是否重登记沿现有规则。原文先提供、后轮再登记必须可用。
- 模型侧撤销旧 author_content_registration=true 与 action=reply/frame_type=capability_gap 的组合要求。handler 归一为明确 author_content_registration 操作，复用来源/字节/去重校验，不再制造旧 reply 协议兼容分支。
- 候选沿现有 TurnResult/adoption_state 输出，区分本轮动作 turn 与历史内容 source_turn；展示帧依据已验证操作投影，不从文字猜授权或来源。
- “只收下、暂不展开”是无工具普通回复：输入正常持久化，不调本工具、不产候选、不追加方向。record_only 不再承担隐式物化开关。

**C. propose_creative_directions：可操作方向明确来源（J1）**

- 必填 candidate_directions（至少1项）与 author_reasoning；每项沿现有 title/pitch/tone_tags，title/pitch 非空。
- 方向由模型同次工具响应产出；app 只校验、铸造 direction_id、绑定 provider/source refs，投影既有 creative_exploration 与 choose_candidate 等动作。
- 采纳/删除/查看等操作菜单不是创作方向；不从普通文本列表机械提取、不给回复补默认候选。
- 不调 writer、不生成正文或设定 canon；后续作者选择/采纳保持原边界。纯文字讨论仍可无工具。

**D. report_capability_gap：保留 Q3B 的结构化缺口**

- 必填 dialogue_goal、missing_effect、author_reasoning；可选 alternative_operation_refs 只引用当前真实可用操作。
- 投影既有 capability_gap 事实/回复；不派发近似创作能力、不产候选、不写 canon，不伪造成功的业务 ToolResult。
- 事实尚未读取应先 explore；不能用缺口报告代替取证。可机械核查的可用操作矛盾按统一有界纠错处理，不增加无限自评调用。
- 普通文本不机械猜 capability_gap 标签；本工具承载已有 Q3B 状态，不恢复 reply 的第二次分类调用。

三个业务输出工具只在需要对应结构时调用；状态/失败/重放按 §2.2.3a，名称为目标接口，schema/codegen/handler/页面证明归 B26 CP2–CP4。本轮只改文档，不改 JSON Schema 或代码。

#### 2.2.3 响应映射与副作用原子性（J1–J4）

| call_site / 同响应 tool_calls | 归一操作 | 处理 |
|---|---|---|
| 对话判断：[]，content 非空 | reply | 整段 content 即回复；reply_included 由非空内容判定；仍建立 primary DialogueFrame，按 VS-00D §11.4 标明 casual_reply 展示默认及未知模型判断；candidate_directions=[]，无默认业务动作 |
| [propose_creative_directions] | creative_directions | 校验并投影真实方向卡，不猜自然文本 |
| [register_author_content] | author_content_registration | 来源验证→保真候选或返回已有对象→completed/stopped；等采纳的是候选，不是 awaiting_author 的 run |
| [report_capability_gap] | capability_gap | 初始/续行均 completed/stopped，明确 goal_unfulfilled，零新业务写；不自动续行或隐式等作者 |
| [ask_author]（对话/续行） | await_author | 按 2.2.2 A 投影、绑定、回传 |
| [judgment_decision{action: execute, capability}] | execute | 既有 dispatch，能力/对象/权限/预算重新校验 |
| [judgment_decision{action: explore, explore_request}] | explore | 唯一探索入口；真实观察返回后再判断 |
| [judgment_decision{action: plan}, agent_plan_draft] | plan | 唯一允许的双工具组合；同 run/goal version/目标，整组校验；数组先后顺序不改变含义 |
| [judgment_decision{action: plan}] | plan_requested | 后续仅 plan 工具的 auto 调用起草；实际总次数至少2，不伪称一次 |
| [agent_plan_draft] / [agent_plan_revision]（相应非判断计划调用点） | plan / plan_revision | 消费真实模型计划，缺结构不能用文本替代 |
| [continuation_decision{action: continue}]（续行） | continue | 有依据的 guidance，沿原门禁/预算，不直接批准执行 |
| 空 content 且无工具、错 profile 工具、重复工具、未定义组合、ask_author 与其他工具同返、旧判断 reply/await_author 枚举、native chapter_read 等第二入口、必填缺失 | protocol_violation | 同一任务/来源/权限下纠错一次；仍失败诚实失败，零业务派发/写入 |

普通回复不规定“意图说明＋空行＋正文”，不解析空行/标题/列表/关键词来补业务结构。无工具仅在对话判断可结束普通回复；续行和非判断计划调用点须给各自结构。

judgment_decision 移除 reply_included、author_narrative、record_only、author_content_registration、author_content_source_ref、candidate_directions 等回复/登记专属字段；保留 execute/plan/explore 所需 dialogue_goal、reason、capability、explore_request、pending_artifact_ref、adopted_content_ref。各工具封闭字段 schema；未知/互斥字段拒绝，不保留旧协议参数作为第二入口。

整组响应先验证再派发，非法双工具不能部分登记/执行后再报错。重试保留作者输入、合法来源、目标版本、范围和权限；新 provider_call_ref 单独留痕，不与前次叙事混绑。失败响应已经流出的文字仅为未执行过程记录，不发布完成事实。来源/幂等校验不依赖 prompt 自觉。

##### 2.2.3a 确定的结果、失败与恢复（F2）

以下 run 状态使用现有枚举，不新建长期目标状态机。Run.phase 与 TurnResult.phase 是不同字段。机械结束可以用现有 terminal/settle 通路；不得为结束缺口回复而伪造 goal_satisfied 决策或继续使用 run_completed 恒带 goal_satisfied 的旧默认。

每个持久 TurnResult.trace_summary 记录 operation_code、outcome_code、source_input_ref、operation_key 及实际 effect_refs；truthfulness 按真实业务副作用填值。native 工具调用数与业务工具 dispatch 数分开统计：前者进 Provider 元数据，consumed_budget.tool_calls 沿真实业务工具语义，不把登记/提问重复算 writer 调用；provider_calls 一律真实计数。

| 结果 / 原状态 | Run.status / Run.phase | TurnResult.status / phase 与事实 | 事件、持久化与下一步 |
|---|---|---|---|
| 普通回复合法（running） | completed / stopped | conversational / dialogue；reply_delivered；不推断作者目标已满足 | 持久原话/trace 后 run_completed；新输入起新判断，不自动续行 |
| propose_creative_directions 成功 | completed / stopped | conversational / dialogue；directions_proposed；真实方向与可操作源，零 canon 写 | 原方向 ID/来源持久，刷新重用；选择是后续作者动作 |
| register_author_content 首次/合法重登记 | completed / stopped | conversational / completed；candidate_created；pending 候选、字节来源，零 canon 写 | 候选与 assistant Interaction 同提交边界；作者采纳是独立动作，不让本 run 假等待 |
| register_author_content 来源已有 pending | completed / stopped | conversational / dialogue；source_already_pending；引用已有候选，不新增、不采纳 | 复用原来源的合法动作，不伪造 source_turn_ref 或重新登记 |
| register_author_content 来源已 accepted | completed / stopped | conversational / dialogue；source_already_accepted；返回真实已采纳版本，不宣称本轮发生写入 | 不生成新候选；保留实际版本/编辑后正文和来源 |
| report_capability_gap（初始或续行 running） | completed / stopped | conversational / dialogue；frame_type=capability_gap；outcome=capability_unavailable；goal_unfulfilled；零本次新写 | 持久模型说明、缺少效果/可用路径，run_completed 的 reason_codes=capability_gap_reported/goal_unfulfilled；不发 goal_satisfied，不接着执行未完计划；后续作者请求是新判断 |
| ask_author 成功 | awaiting_author / stopped | options非空为 needs_selection、空为 needs_clarification；phase=awaiting_author；waiting_for_author、author_question 与回复动作 | 先持久问题再广播/停机，按 A1–A3 恢复；不自动再调模型 |
| 有效 author_choice 回答 open 问题 | running / planning | 先返回动作 ack，不伪造最终 TurnResult；question=answered，input 保真 | goal.version 增1且预算不清零；同 run 重入判断；后续结果另行记录 |
| malformed/非法组合/来源不合法等，在本次允许纠正内 | running / 原阶段 | 不发布成功业务结果；本尝试无新候选/写入 | 同任务、来源、范围/权限下纠错至多1次；不因换错误类型重置次数 |
| 纠正仍失败或业务前置永久拒绝 | failed / stopped | failed_recoverable / failed；具体 protocol_violation/source_invalid/operation_rejected；无本次副作用 | 记录 run_failed/失败 Interaction；同 run 不自动恢复；作者新请求可重试 |
| 业务提交/结果持久化失败 | failed / stopped（能落盘则持久） | failed_recoverable / failed，outcome=persistence_failed；不广播可采纳成功结果 | 回滚本提交；数据库不可用时仅诚实瞬时失败通知，不宣称恢复记录已保存 |
| 提交前取消赢得串行裁决 | cancelled / stopped | cancelled / cancelled；本次未提交效果为零 | 原输入保留；迟到 provider 响应只审计，不产候选/问题/动作 |
| 完成提交后再取消 | 保留已完成终态 | 返回 terminal/no-op，已提交候选或回执仍真实存在 | 不删除已提交结果，不谎称“没有任何产出”；不再次执行 |

失败/缺口不撤销本 run 早先已提交的其他候选或事实；表中“零写”指当前操作，回执须列已保留效果，不能用统一失败文案否认先前成果。completed 的 failure_ref 为空，真正 failed 时写具体失败引用/代码；gap 通过 outcome/reason_codes 表达未满足，不冒充技术故障。gap 结束是“诚实报告已完成”，不是创作目标完成；除有独立证据外，上表普通回复/方向/登记也不自动附 goal_satisfied。

副作用与恢复：
1. operation_key 绑定 run、source_input_ref、goal version、step、有效 provider_call_ref 与 native tool_call_id；一个输入/step 的结果槽只允许一个有效提交，整组响应校验在前。相同响应重放复用既有 artifact/question/direction IDs，不再铸造。
2. 新候选/方向/问题与 assistant Interaction/源 trace/operation outcome 在发布前可靠保存；运行终态以该已提交 outcome 为依据落盘。若仅终态事件/广播丢失，恢复只补记终态与重播持久结果，不重新执行。发布失败但提交成功不得按“未执行”回滚或再调模型。旧来源去重与 operation_key 去重同时保留。
3. payload 记录丢失、运行失活或取消时按 durable facts 裁决，不把“文本曾流出”当已提交。无法确认提交结果时先查持久结果槽；不得盲重试生成新产物。bounded 死 run 不复活，durable 按既有 checkpoint 恢复。
4. 业务来源失败允许一次有依据纠正；无法补全合法来源且模型需要作者决定时只能返回 ask_author。若已形成永久拒绝/失败终态，后续由新输入处理，不在失败分支偷偷转 awaiting_author。
5. 原有 schema/runtime/trace 需同批校准上述枚举使用、状态事件和完成 reason；这是 B26 CP2/CP3 的实施内容，本次不改代码或 JSON。

#### 2.2.4 叙事绑定与结果判断

- 作者可见文字来自本响应 content 或合法 author_reasoning / ask_author.question；execute/explore 的 reason 仅在满足作者可读原话契约时回退；均逐字绑定同一响应 provider_call_ref，符合 N-NARR。
- 空 content 只回退模型原话，不能 app 拼“已完成”；再无原话沿现行叙事边界诚实失败，结构状态/错误类别仍可按安全文案显示。
- 同源是必要条件，不替代 B27 的任务/对象/范围/效果一致性。无工具文本的认知记录按 VS-00D §11.4：保留原话与 supplied evidence，不从文本抽模型判断字段、不伪造 used_context_refs；必要结构化业务判断才使用对应工具。文学质量由模型据证据判断，不靠关键词/schema 合法判质量达标。
- 不要求暴露私有 thinking；本节只处理作者可见文本和工具结构。
- 协议错误、未合理取证、真实能力缺口分别记录；不全归模型质量债，也不因模型质量不足恢复两段式降级。

#### 2.2.5 不变量

- I-SC-1：叙事/动作同一有效响应来源，非法/纠错尝试不混绑。
- I-SC-2：模型停等唯一 ask_author；每次均持久问题 TurnResult 和系统自由文本动作，非空模型选项另行投影；无选项/刷新/重传不丢 question_ref、goal version 与提交身份。运行时停机沿原机制。
- I-SC-3：生产判断/计划只有 auto 单调用，不按 provider/model/env 选旧协议。历史文档/隔离离线基线不是生产兼容，旧入口不得参与生产编译/派发。
- I-SC-4：按实际主调用、取证后判断、补计划、重试计数，不硬编码“作者一轮=1”或“判断恒2”。
- I-SC-5：同 call_site/profile 连续轮静态 schema/规则前缀稳定，动态对象/权限不假冻结；保留 VS-00I 与 L4 置尾。
- I-SC-6：普通回复零工具/零业务副作用；方向/登记/缺口只来自明确结构工具，禁止从自然文本猜授权/来源/动作。
- I-SC-7：探索只有封装入口，参数/目录/实现同源；任何副作用前整组验证，原 Orchestrator/采纳门禁有效。

#### 2.2.6 B26 / B27 分工与实施依赖

共同任务输入语义真源为 [VS-00D §11](VS-00D-ai-guided-authoring-contract-pack.md)；本节只定义工具/profile/映射，不各自再维护一份语义定义。

| 工作 | 负责 | 交付 |
|---|---|---|
| 工具 schema、合法组合、结构化业务输出、ask_author、分派/回传、计数/重试、删除双协议 | B26 | 消费 B27 任务语义，保留全部现有业务链 |
| 输入组成、规则真源、能力效果说明、必要提问/取证、跨阶段目标/范围 | B27 | CP0 先设计，共享入口随 B26 一次迁移，不建前置 Router |
| writer/修订/评估/摘要/盘点/叙述与重试的角色整合 | B27 | 共享入口稳定后完成全调用点矩阵，不能只改判断即收口 |
| 全章/角色/结构维护、无明确问题动作的一般多 run 输入归属 | B28–B31 | B26 明确问题的空选项/绑定/恢复独立验收，不以 B31 为前置；不能用文案冒充业务能力 |

顺序：共同设计（B26 CP1＋B27 CP0）→ 共享入口一次迁移（B26 CP2＋B27 CP1/CP2）→ B26 协议/业务保留验证 → B27 专业调用迁移 → B27 语义对照与共同真实页面 → 各自门禁/台账。两项保留独立验收；不先落旧规则的单调用版再重写第二遍，不在双协议生产入口叠 B27 补丁。 B26 的机制通过条件是 QA/OUT、旧业务保留及自身页面/门禁；B27 另需满足 B27 §6.1 语义门槛和全调用点矩阵。B27 模型质量失败不能伪报 B27 done，也不抹掉已有 B26 机制证据；对外宣称联合修复闭环必须两项都满足。

#### 2.2.7 验收矩阵与证据边界

- J1：普通回复不靠空行/固定开场且无默认动作；明确方向工具产可点击方向并在刷新/后续对话保留来源；缺口工具保留 Q3B 结构事实。
- J2：当前/历史原文、缺来源/跨 scope、已有 pending/accepted、全放弃再登记、先收下不展开；字节/去重/刷新/作者采纳完整保留 Q3C/Q3D，不以“注册了工具名”算通过。
- J3：初始/续行 × 有/无 options × 选项/系统自由文本；每次有真实源动作；刷新、ack 丢失、相同提交重传、同身份异内容、并发答复、取消先后、过期/跨 run、bounded 失活、durable 未就绪均断言 A1–A3 状态与恢复；不依赖 B31，无 continuation.await_author 第二入口。
- J4：只经 judgment_decision.explore 读取/分页/返回观察再判断，直接 native 探索调用拒绝；非法组合零部分副作用。
- F2 结果矩阵每行都须有局部测试；普通/方向/登记成功、已有 pending/accepted、初始与续行 gap、空选项提问必须有真实页面。协议/来源错误与持久化/取消/重放通过外部 test/support 故障场景或边界测试补齐；断言当前副作用与先前已提交效果分别真实，不能统一“零写”掩盖历史。
- F3 普通回复 trace 逐项核验：primary frame/turn/trace 引用完整，保存提供材料与覆盖范围、原始回答、来源；没有结构化模型判断时明确 not_provided，不能把 casual_reply 或 supplied refs 当模型实际意图/引用。取证后收尾保留整轮真实工具记录；结构业务输出保留字段级来源。
- 所有确定性协议/状态/来源/恢复矩阵 100% 通过，任一误路由、重复副作用、原文字节漂移、虚报采纳/完成或未授权写入均阻断；真实模型 B27 通过标准以其 §6.1 为唯一口径。
- 先证明合法组合、计数、来源/无副作用、N-NARR/I1/I2/I3/缓存与业务保留，再评价自然语言质量；必要取证不算冗余调用。
- 对照分旧协议＋旧规则/单调用＋等价规则，以及单调用＋旧规则/单调用＋整合规则；旧协议基线只在隔离脚本或历史 checkout，不保留生产开关。报告分母、超时/失败、版本、上下文，不把排除超时后的比例当总体胜率。
- 外部驱动当前真实 Tauri 输入、点选、采纳、刷新、追问，保留截图/WS/app JSONL/持久来源/usage。替身证明状态链，真实模型证明自然语言质量，两类结论分开。

#### 2.2.8 现有承载与最小增量核对（2026-10-24，设计审查）

核查基线：HEAD `60f7c553` 加本轮开始前既有文档 WIP；生产仍为两段式。以下定位用于 B26 CP1 / B27 CP0 共同评审，新增字段均为目标，不代表 schema、处理器或 UI 已支持。

| 契约面 | 已有载体 / 实际消费者 | 必须同批迁移的增量与证明 |
|---|---|---|
| 模型工具输入 | application 的 `JudgmentProtocol`、`AgenticPlanDraftPlanner` 生产构造器与解析器 | 按 §2.2.1–3 的固定 profile/封闭 schema 构造，整组校验后派发；不得只改探针或保留 reply/await_author 旧入口。捕获真实构造器请求验证 schema/hash、auto、计数与非法组合零派发 |
| 普通回复认知锚点 | domain `DialogueFrame`、application `DialoguePlanningService` / `TraceWriter` / `TurnResultBuilder` | primary frame 保留；`no_tool_requested` 及来源语义先与 ADR-0001 修订联合接受。`evidence_summary` → `frame_summary` / `trace_summary.reply_record` → 持久/回放按 VS-00D §11.4 传递，不从文本补分类 |
| 问题与源动作 wire | `schemas/foundation/turn_result_v3.json` → `frontend/src/generated/foundation/turn_result_v3.ts` → `frontend/src/lib/schemas.ts` / `turnResultWire.ts` | 在现有 v3 schema 明确定义 `author_question`、available_actions 的 `question_ref/expected_goal_version/response_kind/label` 与对应条件；action_type 现为字符串，新增 author_choice 不需全局枚举。原生选项与系统 free_text 的必填/禁止字段按 A1 区分；codegen 后用真实 JSON 解析往返证明不丢字段 |
| 作者回复输入 | domain `AuthorActionInput.payload`；web `WorkspaceChannel.handle_in("author_action", ...)`；application `ActionValidator` | A2 的 submission/question/version/text 放既有 payload；response_kind/label 只信持久源动作。输入 DTO 无需为客户端新增权威 response_kind；application 补问题/版本/运行权威和原输入摘要校验，web 仅适配/分派，不直连 Repo |
| 问题、回复与结果持久化 | `Interaction.content.turn_result`、AgentEvent、`AuthorActionReceiptRepo`、`AgentRunService.steer_submission` | 现有 receipt/steer 可复用，但没有证据表明已经满足 A2 的原子提交、问题串行裁决与一次 goal 推进；同批接仓储事务/恢复，不新增问题表。重复/冲突、提交前后故障、ack 丢失按 QA/OUT 验证 |
| HTTP / Channel 恢复 | application `WorkSessionService.resume/show`；web `WorkSessionsController`、`WorkspaceChannel.join`；frontend `sessions.ts` | 增加独立 `open_author_question_turn_results`，不借 pending_adoption 集合。问题项复用生成的 TurnResult schema，集合只组合该 schema 并推导类型，不手写第二份问题形状；跨 transcript 分页、多个 run、历史只读和已回答重复回执均验证 |
| 前端问题交互 | 当前真实 WorkspaceChat 的 TurnResult 消费与 author_action 发送链 | 选项与绑定输入来自源动作，固定入口文案进 copy.ts；先读对应 UI 设计/Pencil 再编码。恢复不选 latest run，不从文字造动作；外部 Tauri 点选/自由输入/刷新验证。不得新增 card_type 或验收专用 DOM hook |

当前 v3 顶层 `additionalProperties=true`、`trace_summary` 为开放对象，仅说明可容纳未知数据；不能代替生成类型、嵌套动作字段校验、服务端合法组合和消费证明。`author_question` 目前没有显式 schema，`ActionValidator` 只检查已有 scope 字段；不能据“action_type 可传字符串”宣称完整提问链已具备。

冻结顺序：先接受 ADR-0001 来源语义修订及本节/VS-00D 的联合设计，再在 B26 CP2＋B27 CP1/CP2 一次迁移上述共享消费者；schema/codegen/解析测试与 handler 同批，不单独交付无人消费的新字段。完整 CP0 请求捕获/模型矩阵和真实页面证据仍按原任务推进，不以本静态核查销账。

## 3. AgentStep

每个 `AgentStep` 最多对应一个可执行 action。

```yaml
step_id: step_xxx
run_ref: run_xxx
sequence: 2
status: completed
goal: 设计主要反派
micro_plan_ref: mp_xxx
decision_ref: decision_xxx
tool_request_ref: tq_xxx
tool_result_ref: tr_xxx
observation_refs: [obs_xxx]
state_snapshot_ref: snapshot_xxx
attempt: 1
idempotency_key: run_xxx:2:character_design:input_hash
```

每一步都必须重新经过：

```text
MicroPlan → PlannerBoundary → GateOrder → ExecutionOrchestrator → ToolRequest → ToolResult
```

每一步还必须记录可审计的 `state_snapshot_ref` 与 `idempotency_key`，至少绑定 `work_id`、`session_id`、`run_id`、step sequence、tool name 和 goal version。durable run 的 checkpoint v2 还可绑定 `work_revision`、`target_revision_ref`、`target_revision`；恢复入口拿当前事实版本比较，若作品事实、目标版本或目标存在性不一致，必须进入 `awaiting_author`，不得静默继续执行旧 snapshot。

## 4. AgentObservation

Observation 是压缩、可引用的 step 结果摘要，不是自动作品事实。

```yaml
observation_id: obs_xxx
run_ref: run_xxx
step_ref: step_xxx
observation_type: character_roster
source_ref: tr_xxx
summary: 当前已有 3 个角色。
structured_payload: { character_count: 3 }
evidence_refs: [tool_result:tr_xxx]
confidence: 1.0
```

Observation 必须有来源和 evidence refs；不得把完整 ToolResult 原文无限塞进后续 prompt。

## 5. AgentEvent

`AgentEvent` 是 author-safe 活动流，不是 `TurnResult`。

```yaml
event_id: evt_xxx
run_ref: run_xxx
step_ref: step_xxx
sequence: 7
event_type: exploration_observed
visibility: author
summary: 已读取当前角色阵容，发现已有 3 个角色。
author_narrative: 我先核对现有角色阵容，避免新反派和既有人设重复。
author_narrative_source:
  source_type: provider_output
  provider_run_ref: prun_xxx
  provider_call_ref: pcall_xxx
  provider_output_ref: pout_xxx
  source_hash: sha256:...
  narrative_hash: sha256:...
reason_codes: [character_roster_loaded]
refs: [obs_xxx]
emitted_at: ...
```

46§9 工作详情运行中先显示同一 assistant turn 的结构性工作态骨架，避免作者发送后空等；该骨架只能由状态 chip、阶段轨道、工作详情入口等枚举/结构 UI 组成，不得代写模型推理。随后消费同一 ProviderExecution stream 内 `purpose=author_reasoning` 的 `author_narrative_delta`，provider chunk 到达即通过同一 `agent_event.provider_progress` 推动作者面 reasoning 文本增长；不得等 ProviderOutput 结束后一次性丢卡片。最终 `plan_drafted` / `plan_revised` / `exploration_observed` / `evaluation_made` 携带 source-bound `author_narrative` 后，才用结构化事件替换同 provider run 的临时 delta；普通 ProviderRun / ProviderEvent / ProviderOutput facts 仍只作为 developer detail 展开。作者可见事件禁止包含 raw prompt、chain-of-thought、provider private reasoning / thinking、API key、provider secret、未脱敏 memory、完整 ToolRequest dump、legacy JSON tail 或 native tool-call arguments。

## 6. AgentRunPolicy 与预算

首个 profile 使用 `bounded_small_v1`：

```yaml
max_steps: 5
max_tool_calls: 4
max_provider_calls: 3
max_replans: 1
max_retries_per_step: 1
max_elapsed_ms: 120000
max_pending_artifacts: 3
no_progress_threshold: 1
allowed_tool_refs: [character_roster, character_design]
durable_promotion_policy: disabled
```

`max_pending_artifacts` 是候选预算 backstop。正常路径仍由模型返回
`goal_satisfied` 完成；若 `pending_artifact_refs` 已达到预算，而下一步
planner 仍提议 `execute_step`，runtime 必须记录该模型提议，然后不执行新的
step/tool，改由系统裁决以 `goal_satisfied` 完成 run。该裁决必须留下
`candidate_budget_exhausted` 与 `model_requested_extra_candidate` reason code。
当前单候选创作 profile（`character_design_with_context_v1`、
`prose_drafting_with_quality_v1`、`plot_outline_with_context_v1`、
`character_evolution_with_context_v1`、`world_building_with_context_v1`）预算为 1；
`prose_revision_from_findings_v1`、conversation、readonly 与 provider progress
保持默认 3，避免截断候选后的 revision finalize 或非候选路径。

ADR-0023 后，创作档 `max_replans` 默认提升到 2，conversation / readonly / provider progress 维持 1。当前 CP2 偏离信号验收均只消耗 1 次 replan；若重规划预算耗尽，runtime 必须进入 `awaiting_author` 或既有预算终止语义，不得恢复固定 per-profile step sequence，也不得补发未授权工具调用。

预算计数必须分账：

```text
frame planning
micro planning
writer
evaluator
revision writer
step planning
final synthesizer
```

## 7. agent_run_start

Planner 可建议一个 primary action：

```yaml
action_type: agent_run_start
run_mode: bounded
profile_ref: character_design_with_context_v1
goal: 先读取角色阵容，再设计主要反派
write_intent: tentative
risk_hint: low
```

`agent_run_start` 只授权创建 run，不授权内部 step。`ExecutionOrchestrator` 必须新增裁决：

```text
allow_agent_run
require_confirmation
require_clarification
downgrade_to_dialogue
reject
```

run 内部每个 step 仍独立 gate。

## 8. Bounded Runtime

`novel_application` 必须启动：

```elixir
{Registry, keys: :unique, name: NovelApplication.AgentRunRegistry}
{DynamicSupervisor, strategy: :one_for_one, name: NovelApplication.AgentRunSupervisor}
{Task.Supervisor, name: NovelApplication.AgentStepTaskSupervisor}
```

`AgentRunServer` 持有 run 状态、发布事件、接收 pause/resume/cancel/steer、启动下一 step、接收 step result、更新预算和停止条件。GenServer callback 内禁止同步调用 LLM；step 执行必须走 `Task.Supervisor.async_nolink`。

第一阶段持久化只保留运行审计所需的最小三张表：

- `agent_runs`：当前 run 状态、goal/policy/budget/interrupt、completed step refs 与 terminal 时间。
- `agent_run_steps`：每步的 MicroPlan/decision/tool/observation refs、idempotency key 与起止时间。
- `agent_events`：作者安全事件流，`unique(run_id, sequence)` 防止同一 run 内事件序号重复。

这些表不把 bounded run 升格为 durable `LongRunTask`。CP5 的重启恢复语义由 durable `AgentRun` + `LongRunTask` checkpoint 共同承担。

## 9. Channel Protocol

Agent 路径新增：

```text
user_message → 快速返回 received + run_id
agent_event → 广播活动流
agent_run_state → 广播运行状态
turn_result → run 完成、暂停、失败或 awaiting author 时广播
agent_command → pause / resume / cancel / steer
```

Agent runtime 不持有 Phoenix socket。bounded runtime 通过 Channel 传入的 application-owned event sink 发布 author-visible 事件和最终 `TurnResult`；durable runtime 在 UA-CP5 中复用该 event sink，并在 Channel join recovery 时重新绑定 live runtime 或从 `LongRunTask` checkpoint 广播恢复状态。

`user_message` 不保留同步 `DialogueGateway` / `sync_turn` fallback。普通 reply-only、direct tool 与创作 profile 都必须先 ack `run_id`，再在 AgentRun lifecycle 内完成 context / frame / plan / gate / execute / finalize。`author_action` 仍走专用 action 入口，但不得作为 `user_message` 的旧同步兼容路径回流。

## 10. Interrupt Semantics

Pause：

```text
agent_command.pause
→ interrupt_requested event
→ run.status = pausing
→ 当前 step 返回后停止
→ 不再启动下一 step
→ run.status = paused
```

Cancel：绑定明确 `run_id`，保留已完成 step / event / trace / tentative artifacts，不自动采纳也不自动删除。

Resume：paused run 检查 snapshot 是否 stale；stale 时 replan 或 awaiting author。

Steer：递增 `goal.version`，旧 plan superseded，已完成 Observation 保留，未执行步骤失效并重新规划剩余步骤。

当前已落地的是 ProviderExecution cancellation：AgentRun cancel 绑定明确 `run_id`，请求同一 ProviderExecution token 取消，adapter 在同一 ProviderRun/Event/Output stream 内物化 cancelled facts。

### 10.1 Provider Execution Stream Unification（后续 CP）

provider streaming 不再作为 `complete` 之外的可选支路登记。后续 provider 体感提升必须按 `tasks/slices/UA01-provider-execution-stream-unification.md` 推进完整统一架构。

当前已落地的 CP：

- CP1：`NovelCommon.Contracts.ProviderRun` / `ProviderEvent` / `ProviderOutput`。`ProviderRun.execution_mode` 只接受 `:event_stream`；author-visible `ProviderEvent` 拒绝 raw prompt / chain-of-thought / secret / raw generated text delta payload；`ProviderOutput` 是 provider execution stream 的终态事实。
- CP2：`NovelAgent.Provider.Gateway.execute/4` 成为统一 provider execution 入口；`Gateway.complete/3` 只作为 final-result consumer 读取同一 execution stream 的 final `Result`，不构成第二套 provider 执行路径。
- CP3：`NovelAgent.Provider.AdapterExecution` 接管 final-only adapter 结果到 ProviderRun / ProviderEvent / ProviderOutput 的物化；`Provider` behaviour 增加可选 `execute/5`，支持 adapter 在同一 execution stream boundary 内扩展更细粒度事件。
- CP4A：`NovelAgent.Provider.Execution.complete/2` 会把同一次 `Gateway.execute/4` 的 ProviderRun / ProviderOutput / ProviderEvent refs 附回 `Provider.Result`；writer / evaluator caller 已可从 final result 读取独立 `provider_call_ref`，不再靠测试 map 私有字段补 trace。
- CP4B：`NovelAgent.Provider.Execution.dependency/1` 成为 tool/profile 默认 provider 依赖对象；Toolbox、AuthorizedToolExecutor、ToolAdapterRegistry、CreativeToolAdapter、CreativeProvider.Real、ProseQualityEvaluator、TurnExecutionService、ProseRevisionService 和 AgentRun creative profiles 已消费同一 dependency。存量裸函数测试注入仍可被解析，登记为后续清理项。
- CP4C：DialogueGateway / Planner / DialoguePlanningService / conversation profile 公开入口已迁移到 provider execution dependency；显式 nil provider 会被拒绝，conversation frame planning、micro planning 与 finalization 通过同一 dependency 解析。旧一参函数输入形态仍存在，登记为 provider dependency 纯化债务。
- CP4D / CP5 / CP6：`NovelApplication.ProviderActivityProjector` 已把同一次 ProviderExecution 的 ProviderRun / ProviderEvent / ProviderOutput facts 投影为 developer visibility 的 `agent_event.provider_progress`；conversation / prose drafting / character design / plot outline / character evolution / prose revision flows 在 AgentRun snapshot 上接入 projector。真实 Tauri `agent-provider-execution-stream-unified` 已证明普通对话进入 `conversation_turn_v1`，provider_started / request_prepared / request_dispatched / provider_chunk / response_received / provider_final_output 以 developer provider_progress 进入同一 assistant 工作详情，并携带 provider_run_ref / provider_call_ref / progress phase / chunk length metadata，不泄漏 raw prompt、system prompt、frame JSON、assistant_message 或 raw text delta。真实 Tauri `agent-provider-execution-error-author-safe` 已证明 provider_started / provider_error 也进入 developer telemetry，payload 只暴露 status=error / output_type=empty / refs 等摘要，最终 TurnResult 不调用工具、不采纳、不写作品事实。session resume / show 首屏现在只恢复最近 transcript page 与每条 assistant 的 `agent_run` summary，不同步 hydrate author-safe events / provider_runs；更早 transcript 通过 scoped `GET /api/works/:work_id/sessions/:session_id/transcript?before_id=...` 按 interaction cursor 异步加载，并校验 work/session/cursor 归属。同一 assistant 对话流的“工作详情”默认收起，展开时通过 scoped `GET /api/works/:work_id/sessions/:session_id/turns/:turn_id/agent-run-activity` 异步读取原 work/session/turn 下的 AgentRun author-safe events、provider_run_ref、provider_call_ref、author_reasoning/conversation purpose、events、output summary 与 usage totals，不重新调用 provider，也不泄漏 raw provider content。`agent-session-transcript-lazy-page` 已进一步证明：旧 transcript page 加载出来的历史 assistant 仍只携带 `agent_run` summary，作者展开该旧 assistant 的“工作详情”时通过同一 scoped activity API 原地加载 ProviderRun replay，且加载旧页和展开旧详情都不重新调用 provider。ProviderRun replay UI 的事件序列 / 输出摘要 / no-provider-recall boundary 仍在同一 assistant 对话流内呈现。
- ADR-0022 / 46§9 对上条普通 telemetry 约束作窄化扩展：`purpose=author_reasoning` 的 provider chunk 可投影作者可见 planning prose 的 `author_narrative_delta`，用于作者面实时 reasoning。legacy 两段式 next-step planner 只允许 JSON tail 之前的 delta；AgentPlan native tool-call draft/revision 只允许 assistant content delta，tool arguments 永不作为作者叙事。该 delta 仍必须在最终 ProviderOutput 中通过 streamed-prefix / source binding 验证，不得扩展到正文、工具或 provider private reasoning。
- 历史 profile 纯化：`provider_progress_v1` 与 `readonly_batch_context_v1` 不再通过 fixed-step adapter 进入 AgentRun runtime；两个 profile 均声明自身 `next_step_planner/1`，`steps/1` 显式拒绝运行。生产 `AgentRunSequentialPlanner` 模块已删除，final step 可保留自身 `goal_satisfied` completion decision，避免终态裁决被 execute decision 覆盖。

仍未完成：完整 live vendor 真实矩阵和人工文学质量盲评；当前 live provider CP 按用户可用资源只覆盖本地 LM Studio 与 DeepSeek。LM Studio 已通过真实 Tauri `agent-provider-execution-stream-unified --provider lmstudio`，并由 HTTP log 证明同一 turn 发出 200 `POST /chat/completions`；DeepSeek runner 已接入同一入口，但依赖 `NOVEL_DEEPSEEK_API_KEY` 或 `DEEPSEEK_API_KEY`，当前缺 key 时只能登记为凭据阻塞。OpenAI-compatible / DeepSeek / LM Studio / Anthropic wire-level SSE adapter 与 ProviderExecution cancellation 已接入同一 ProviderExecution runtime；其他供应商等待真实凭据后另行登记，不再规划独立右侧 replay console，ProviderRun replay 已落在同一 assistant 对话流。

后续必须保持：

1. Provider 执行对 application 暴露同一个 provider execution stream，事件包括 started / chunk-or-progress / final-output / error / usage / trace refs。
2. `Gateway.complete` 只能作为同一 execution stream 的兼容消费者或迁移 wrapper，不得继续作为独立 provider 执行体系扩散。
3. 底层 provider 若只有 final response，也必须由 adapter 物化为同一 provider execution event stream；application 不按 provider capability 切回旧路径。
4. writer / evaluator / revision / conversation / tool provider 调用必须消费同一 execution output，同时保留各自独立 provider_call_ref、usage、budget 和 trace。
5. Channel/UI 只消费 author-safe provider events；不展示 raw prompt、chain-of-thought 或 provider 私有 payload；最终聊天出口仍是一个 `TurnResult`。
6. replay 不重新调用 provider，只回放已保存的 provider execution facts。
7. 真实 Tauri 验收目标场景为 `agent-provider-execution-stream-unified`、`agent-provider-execution-error-author-safe` 和 `agent-provider-execution-activity-restored`；CP0 只登记和审计，不新增产品验收钩子。

## 11. 首个切面

首个真实 Agent slice：

```text
WorkspaceChannel.user_message
→ DialogueGateway / DialoguePlanningService
→ DialogueFrame
→ primary MicroPlan(agent_run_start)
→ ExecutionOrchestrator allow_agent_run
→ AgentRunService.start_bounded
→ AgentStep 1 character_roster
→ AgentObservation(character_roster)
→ AgentStep 2 character_design consumes observation
→ TentativeArtifactSet(character_seed)
→ AgentFinalizer
→ TurnResult
→ UI
```

必须证明：

1. 一个作者请求创建一个 bounded AgentRun。
2. 至少执行两个 AgentStep。
3. 每步都有独立 MicroPlan 和 OrchestratorDecision。
4. 第二步真实消费第一步 Observation。
5. 不使用 multi-action MicroPlan 绕过 gate。
6. 角色设计结果仍是 tentative。
7. 未采纳不写 Character 主档案。
8. AgentEvent author-safe 可见。
9. 运行中可以 pause/cancel/steer。
10. budget 和 no-progress policy 能在真实页面入口阻止继续自动执行。

## 12. Acceptance

CP3 最小真实页面验收已注册到 `quality/acceptance/scenarios.yml`：

```text
ua01-agent-bounded-roster-to-character-design
```

该入口及其 alias 场景由外部 Tauri automation 操作真实工作台，当前已覆盖：

- `agent-bounded-roster-to-character-design`
- `agent-step-regate`
- `agent-no-multistep-plan-bypass`
- `agent-channel-fast-ack`
- `agent-interrupt-safe-point`（pause/cancel 命令协议与终态状态；pause 不请求 ProviderExecution cancel）
- `agent-cancel-target-binding`
- `agent-steer-replan`
- `agent-natural-language-steer`
- `agent-prose-drafting-with-quality`
- `agent-plot-outline-with-context`
- `agent-character-evolution-with-context`
- `agent-loop-budget-limit`
- `agent-no-progress-stop`
- `agent-archive-read-during-run`
- `agent-event-author-safe`
- `agent-tentative-boundary`
- `agent-revision-orchestrator-boundary`（UA-CP0 revision Orchestrator 边界；UA-CP4 revision AgentRun profile 已通过 fresh Tauri）
- `agent-provider-call-budget`（UA-CP0 与 bounded run budget）
- `agent-replay-no-provider`（UA-CP0 replay policy）
- `agent-plan-native-tool-calling-protocol`（ADR-0023 CP4 AgentPlan draft/revision native tool-call 协议）
- `agent-work-isolation`

UA-CP4 fresh Tauri summary 已补齐。UA-CP5 的 `agent-durable-resume-long-run-task` 已转 active/nightly 并通过真实 Tauri 验收，证明 durable run 关联 `LongRunTask`、backend restart 后 stale recovery 等待作者且不重复执行已完成 step。UA-CP6 的 `agent-provider-streaming-progress`、`agent-provider-cancel-honest-boundary`、`agent-readonly-batch-profile` 已转 active/nightly 并通过真实 Tauri 验收：provider progress 事件 author-safe 且不泄漏 raw prompt；cancel 进入 `cancelling`、请求 `provider_execution_cancel` 并最终落 `cancelled`；只读 batch profile 本身不调用内容 provider、不生成 artifact、不触发 adoption。`agent-natural-language-steer` 已证明运行中主输入框文本发送为同一 active `run_id` 的 `agent_command steer`，广播 goal version 2，页面保留本地作者消息锚点，触发同一 run 的 `plan_adjusted` / `plan_revised` 并消耗 `consumed_replans=1`，且不产生第二个后端 `user_message`。当前普通 `user_message` 先进入 `profile_routing_v1`，由运行时 profile router 选择目标 profile；已迁移的 conversation/prose/plot outline/character evolution/world-building/provider-progress/readonly-batch profile 切入 model-drafted AgentPlan + mechanical cursor，未迁移 profile 仍切入 observation-led next-step planner。profile routing 不批准工具执行，后续创作工具 step 仍重新经过 Orchestrator gate。当前预算口径包含一次 profile routing provider call；ADR-0023 CP1 首批迁移后，`agent-conversation-turn` 为 4 steps / 0 tools / 3 provider calls，`agent-prose-drafting-with-quality` 为 2 steps / 1 tool / 4 provider calls；ADR-0023 CP2 D1 `agentic-loop-tool-failure-replan` 为 2 steps / 1 tool / 5 provider calls / 1 replan，D2 `agentic-loop-quality-deviation-replan` 为 2 / 1 / 5 / 1，D3 `agent-natural-language-steer` 为 1 replan 且无第二个作者 turn/run，D4 `agentic-loop-gate-deviation-replan` 为 2 / 0 / 3 / 1，D5 `agentic-loop-budget-deviation-replan` 为规划总账 3 步/执行 1 步/0 tool（`plan_budget_shortfall` TurnResult + 作者选“接下来 2 步” → `budget_expanded`，非 `plan_revised`），D6 `agentic-loop-plan-replan-reasoning` 为 4 / 0 / 4 / 1，D7 `agentic-loop-deterministic-gap-replan` 为 2 / 0 / 3 / 1；ADR-0023 CP2 无偏离直通的 `agentic-loop-no-deviation-direct` 为 4 steps / 0 tools / 3 provider calls / 0 replans；ADR-0023 CP3 章节大纲的 `agent-plot-outline-with-context`、角色演化的 `agent-character-evolution-with-context`、世界设定的 `agent-world-building-with-context` 与 `agent-world-building-style-rule-with-context` 均为 2 steps / 1 tool / 3 provider calls；`agent-provider-streaming-progress` 为 1 plan step / 0 tools / 3 provider calls；`agent-readonly-batch-profile` 为 2 plan steps / 4 readonly tool calls / 2 provider calls 且无 artifact/write/adoption。ADR-0023 CP4 `agent-plan-native-tool-calling-protocol` 为 4 steps / 0 tools / 4 provider calls / 1 replan，activity summary 记录 `native_tool_call_names=[agent_plan_draft, agent_plan_revision]` 与 `native_tool_call_final_output_count=2`，且不泄漏 tool arguments。ADR-0023 CP0/CP1 之后，多步 profile 的 `max_provider_calls` 仍额外预留一次规划协议 retry 余量，retry 发生时按实际调用进入 consumed budget。不得把当前 CP6 progress/cancel/read-only batch 写成 live vendor 真实矩阵已完成；不得把 legacy JSON-tail next-step planner 兼容入口写成 AgentPlan draft/revision fallback。

## 13. 不变量

```text
A1 每个作者 turn 必须有 primary DialogueFrame
A2 AgentPlan 不等于 MicroPlan
A3 每个 AgentStep 只有一个可执行 MicroPlan action
A4 每个 step 都重新经过 ExecutionOrchestrator
A5 Planner 不批准自己的执行
A6 multi-step gate 不得删除
A7 Agent 不得通过 direct Toolbox call 绕过 Orchestrator
A8 创作产物默认 tentative
A9 Agent 不得自主 adoption 或 production write
A10 作者可以 pause、resume、cancel 和 steer
A11 Provider cancel / streaming 必须保持同一 provider execution runtime；不得回退到旧 provider 执行体系
A12 Agent Activity 不得暴露私有 chain-of-thought
A13 AgentEvent 不是 TurnResult
A14 内部 AgentStep 不伪造作者 turn
A15 replay 不重新调用任何 LLM
A16 循环受 budget 和 no-progress policy 限制
A17 同一 workstream 最多一个 primary author-blocking behavior
A18 stale state 不得静默继续
A19 bounded run 不强制创建 LongRunTask
A20 durable run 必须关联 LongRunTask
A21 VS-00E 对象必须复用，不得平行重建
A22 正文 evaluator 默认每篇只运行一次
A23 writer/evaluator/revision provider 调用必须独立计费和追踪
A24 原始正文和修订稿都不得被静默覆盖
A25 ProseRevisionService 不得绕过 Orchestrator
```
