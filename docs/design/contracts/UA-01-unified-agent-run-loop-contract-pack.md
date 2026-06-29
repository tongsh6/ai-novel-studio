# UA-01 — 统一 AgentRun 循环与可打断创作对话流 Contract Pack

> 状态：UA-CP0 至 UA-CP6 已落地；UA-CP4 已完成正文草稿四步 profile 与修订四步 profile，并有 fresh Tauri summary；UA-CP5 durable AgentRun + LongRunTask 已通过 backend restart 恢复验收；UA-CP6 provider progress / cooperative cancel honest boundary / readonly batch 已通过真实 Tauri 验收（2026-06-29）。当前 provider token streaming 与 hard cancellation 仍是后续能力，不能用 CP6 的协作式降级冒充。
>
> 角色：冻结 UA-CP1 至 UA-CP5 需要消费的 AgentRun / AgentPlan / AgentStep / AgentObservation / AgentEvent contract，以及 bounded/durable runtime、事件流、打断语义、首个角色设计切面和 durable resume 的验收边界。
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

已落地（UA-CP1 至 UA-CP5）：

- `NovelDomain.AgentRun` / `AgentPlan` / `AgentStep` / `AgentObservation` / `AgentRunPolicy`、`NovelCommon.Contracts.AgentEvent` 与 `NovelAgent.AgentTaskProfileRegistry`。
- supervised bounded runtime：`NovelApplication.AgentRunRegistry`、`AgentRunSupervisor`、`AgentStepTaskSupervisor`、`AgentRunServer`、`AgentRunService`。
- `agent_run_start` primary MicroPlan action 与 `allow_agent_run` 裁决；run 内部 step 仍逐步生成单动作 MicroPlan 并重新经过 `ExecutionOrchestrator`。
- Channel 快速 ack、`agent_event`、`agent_run_state`、`agent_command`（pause/resume/cancel/steer）协议，以及前端 AgentRun 活动面板。当前真实页面控制已覆盖 pause/resume/cancel/steer；steer 以可见输入框提交，后端 ack 后广播 `plan_adjusted` 与新版 `agent_run_state`。
- `NovelPersistence.AgentRunLog` 与最小持久化表 `agent_runs` / `agent_run_steps` / `agent_events` 已落地；runtime 写入 run/step/event 审计记录，`agent_events` 按 `(run_id, sequence)` 唯一，持久化 payload 会剥离 nested `turn_result`。
- 首个真实切面：复合作者请求触发 bounded run，依次执行 `character_roster` observation 与消费该 observation 的 `character_design` step，输出 tentative `character_seed`，未采纳不写生产角色档案。
- 真实 Tauri 验收入口：`ua01-agent-bounded-roster-to-character-design` 及 `agent-*` 场景，证据目录 `artifacts/slice-verify/<scenario-id>-tauri/`。

CP4 已把正文主链迁入 AgentRun lifecycle：`prose_drafting_with_quality_v1` 是正文草稿四步 profile（context / strategy+gate / prose+quality / finalize），`prose_revision_from_findings_v1` 是按质量问题重写的四步 profile，二者均已有 fresh Tauri summary。

CP5 已落地 durable AgentRun + LongRunTask 恢复闭环：durable run 创建 `LongRunTask`，runtime checkpoint 同步 run state / completed step refs / budget / pending artifacts；Channel join 可重新绑定 live runtime sink，或在 backend restart 后从 checkpoint 广播 author-safe `run_resumed` 与 `agent_run_state`，stale snapshot 进入 `awaiting_author` 而不是静默继续。CP6 已补 provider progress、provider cancel 诚实边界和只读 batch：当前 provider 无 token streaming / hard cancellation 时分别声明 checkpoint progress 与 cooperative safe-point cancel。

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

`AgentPlan` 是 milestone plan，不是 `MicroPlan` 数组。

当前实现中 `AgentRun.plan_ref` 指向 `AgentPlan.plan_id`（`ap_*`），`agent_run_start` 的 primary `MicroPlan`（`mp_agent_run_*`）只负责启动 run 的一次性 gate，不作为 AgentRun 的 plan 身份。

```yaml
plan_id: ap_xxx
run_ref: run_xxx
version: 1
goal_version: 1
milestones:
  - milestone_id: inspect_roster
    summary: 读取当前角色阵容
    success_criteria: [character_roster_observation_exists]
  - milestone_id: design_character
    summary: 设计新的主要反派
    success_criteria: [tentative_character_seed_exists]
stop_conditions:
  - author_interrupt
  - confirmation_required
  - budget_exhausted
  - no_progress
  - goal_satisfied
```

禁止把 `AgentPlan.milestones` 直接转成批量 `ToolRequest`。

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

每一步还必须记录可审计的 `state_snapshot_ref` 与 `idempotency_key`，至少绑定 `work_id`、`session_id`、`run_id`、step sequence、tool name 和 goal version；更完整的 work revision/target revision stale 检查属于 UA-CP4+ 的 durable/resume 深化。

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
event_type: observation_recorded
visibility: author
summary: 已读取当前角色阵容，发现已有 3 个角色。
reason_codes: [character_roster_loaded]
refs: [obs_xxx]
emitted_at: ...
```

作者可见事件禁止包含 raw prompt、chain-of-thought、API key、provider secret、未脱敏 memory 或完整 ToolRequest dump。

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

普通 reply-only、direct_tool、author_action 保留兼容路径。

## 10. Interrupt Semantics

Pause：

```text
agent_command.pause
→ interrupt_requested event
→ run.status = pausing
→ 当前 step 若无法硬取消则等待返回
→ 不再启动下一 step
→ run.status = paused
```

Cancel：绑定明确 `run_id`，保留已完成 step / event / trace / tentative artifacts，不自动采纳也不自动删除。

Resume：paused run 检查 snapshot 是否 stale；stale 时 replan 或 awaiting author。

Steer：递增 `goal.version`，旧 plan superseded，已完成 Observation 保留，未执行步骤失效并重新规划剩余步骤。

第一阶段只实现协作式取消，不声明 provider hard cancellation。

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
- `agent-interrupt-safe-point`（pause/cancel 命令协议与 safe-point 状态，不声明 provider hard cancellation）
- `agent-cancel-target-binding`
- `agent-steer-replan`
- `agent-loop-budget-limit`
- `agent-no-progress-stop`
- `agent-archive-read-during-run`
- `agent-event-author-safe`
- `agent-tentative-boundary`
- `agent-revision-orchestrator-boundary`（UA-CP0 revision Orchestrator 边界；UA-CP4 revision AgentRun profile 已更新 driver/verifier，fresh summary 待复跑）
- `agent-provider-call-budget`（UA-CP0 与 bounded run budget）
- `agent-replay-no-provider`（UA-CP0 replay policy）
- `agent-work-isolation`

UA-CP4 fresh Tauri summary 已补齐。UA-CP5 的 `agent-durable-resume-long-run-task` 已转 active/nightly 并通过真实 Tauri 验收，证明 durable run 关联 `LongRunTask`、backend restart 后 stale recovery 等待作者且不重复执行已完成 step。UA-CP6 的 `agent-provider-streaming-progress`、`agent-provider-cancel-honest-boundary`、`agent-readonly-batch-profile` 已转 active/nightly 并通过真实 Tauri 验收：provider progress 事件 author-safe 且不泄漏 raw prompt；provider 不支持硬取消时进入 `cancelling` 并记录 `provider_hard_cancel_unsupported` / `cooperative_cancel`；只读 batch 不调用 provider、不生成 artifact、不触发 adoption。不得把当前 CP6 协作式取消写成 provider hard cancellation 已完成。

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
A11 Provider 不支持硬取消时必须诚实降级
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
