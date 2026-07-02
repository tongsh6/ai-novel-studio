# UA-01 — 统一 AgentRun 循环与可打断创作对话流 Contract Pack

> 状态：UA-CP0 至 UA-CP6 已落地；普通 `conversation_turn_v1` 已从固定四阶段 workflow 继续纯化为 observation-led next-step planner loop：planner 根据 observations 选择 `context_assemble`、`dialogue_frame`、`strategy_gate`、`response_finalize`，再由 `goal_satisfied` completion decision 收束，fresh Tauri `agent-conversation-turn` 记录 4 steps / 0 tool / 7 provider calls，并证明 planner/conversation provider activity 可见。UA-CP4 已完成修订四步 profile，并继续纯化为 observation-led next-step planner：`prose_revision_from_findings_v1` 根据 observations 依次选择 `revision_prepare`、`revision_plan`、`prose_writing`、`revision_finalize`，再由 completion decision 收束，工具 step 仍重新构造单动作 MicroPlan 并经过 Orchestrator gate。正文草稿 profile 在旧四步 proof 之后继续纯化为 observation-led next-step planner：`prose_drafting_with_quality_v1` 现在先产生正文 context observation，再由 planner 决定 `prose_writing` 工具 step，工具 step 重新构造单动作 MicroPlan 并经过 Orchestrator gate，writer/evaluator ProviderExecution activity 继续进入 UI usage 轨迹。fresh Tauri `agent-prose-drafting-with-quality` 已通过，summary 记录 2 steps / 1 tool / 5 provider calls，并断言 planner/writer/evaluator provider calls 在 usage UI 可见。章节大纲、角色演化、provider progress 与 readonly batch 均已从固定 steps workflow 纯化为 profile 自身 `next_step_planner/1`，生产 `AgentRunSequentialPlanner` 已删除，现存 profile 的 `steps/1` 仅作为拒绝旧入口的 `no_return()` guard。UA-CP5 durable AgentRun + LongRunTask 已通过 backend restart 恢复验收；UA-CP6 provider progress / ProviderExecution cancel / readonly batch 已通过真实 Tauri 验收；自然语言 steering 已通过 `agent-natural-language-steer` 真实 Tauri 验收，章节大纲 profile 已通过 `agent-plot-outline-with-context` 真实 Tauri 验收，角色演化 profile 已通过 `agent-character-evolution-with-context` 真实 Tauri 验收。AgentRun 工作详情现在消费既有 author-safe `run_started.profile_selection`，在“本轮路径”中显示“理解作者意图 → 进入对应工作流”，但该入口选择只解释 profile 选择，不批准工具执行；后续 step 仍必须由 observation-led planner 选择并重新经过 MicroPlan / `ExecutionOrchestrator` gate。`agent-world-building-with-context` 与 `agent-world-building-style-rule-with-context` 已用真实 Tauri 证明 world-building profile selection 因果、路径摘要与 tentative artifact 边界同时可见。provider execution stream 统一架构已推进到 CP4D/CP5/CP6 对话主链活动投影与恢复：`agent-provider-execution-stream-unified` 真实 Tauri 证明普通 `conversation_turn_v1` 的 ProviderRun / ProviderEvent / ProviderOutput success facts 进入 developer telemetry，且 provider purposes 覆盖 author_reasoning / conversation；同一场景现在还证明 adapter 会在同一 execution stream 内投影 request_prepared / request_dispatched / provider_chunk / response_received 中间进展，其中 chunk payload 只携带序号、片段长度和累计长度，不携带 raw text delta。OpenAI-compatible vendor family、DeepSeek、LM Studio 与 Anthropic 已在同一 ProviderExecution runtime 内接入 wire-level SSE adapter：adapter `execute/5` 发送 `stream: true`，解析 SSE data frames，chunk 只投影为 redacted telemetry metadata，最终文本仍只在 terminal ProviderOutput 物化。`Provider.CancellationToken` 已接入同一 runtime：AgentRun cancel 请求 `provider_execution_cancel`，SSE adapter 停止继续读取并物化 `cancel_requested` / `cancelled` ProviderExecution facts。`Provider.Execution` public dependency 不接受裸函数，内部 final-result callback 字段已从 `complete_fn` 收口为 `result_fn`。`agent-provider-execution-error-author-safe` 证明 provider_error facts 也进入 developer telemetry，并收束为安全 TurnResult；`agent-provider-execution-activity-restored` 证明刷新/恢复后 transcript 只保留 AgentRun summary，作者展开同一 assistant 工作详情时通过 scoped AgentRun activity API 按 work/session/turn 异步读取同一批 developer telemetry 与 ProviderRun usage/event/output summary facts。ProviderRun 同一对话流 replay UI 已通过 fresh Tauri：事件序列、输出摘要和 no-provider-recall boundary 从 persisted facts 展示。当前 live provider matrix 只覆盖本地 LM Studio 与 DeepSeek；LM Studio 已有真实 Tauri + HTTP log 证据，DeepSeek 入口因当前 shell 缺 key 标记凭据阻塞，其他供应商等待用户提供 key 后再进入 CP。仍不能以历史 CP6 checkpoint progress、chunk metadata CP 或旧 `complete` 体系冒充 live vendor 真实矩阵已完成。
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

CP4 已把正文主链迁入 AgentRun lifecycle：`prose_revision_from_findings_v1` 已从四步 fixed profile 继续纯化为 observation-led next-step loop：revision source observation → provider-backed next-step decision → revision MicroPlan / Orchestrator gate observation → provider-backed next-step decision → `prose_writing` tentative revision candidate → finalization observation → completion decision。当前实现保留 revision provider call ref、原稿/修订稿 sibling tentative 边界与 replay no-provider policy；planner provider calls 与 revision writer call 都进入 consumed provider budget。`prose_drafting_with_quality_v1` 已从旧四步 fixed workflow 继续纯化为 observation-led next-step loop：context observation → provider-backed next-step decision → 单动作 MicroPlan → Orchestrator gate → `prose_writing` writer/evaluator provider calls → quality/artifact observations → completion decision。当前实现保留 writer/evaluator provider call refs 与 UI usage/activity 轨迹，fresh Tauri summary 已通过并记录 2 steps / 1 tool / 5 provider calls。正文以外更多创作 profile 已开始从固定 workflow 纯化为真正 loop：`plot_outline_with_context_v1` 先产生 context observation，再由 `next_step_planner` 选择 `plot_outline` 工具 step，工具 step 重新构造单动作 MicroPlan 并经过 Orchestrator gate，最终生成 tentative `outline_draft`，随后由 planner 返回 completion decision；`character_evolution_with_context_v1` 同样通过 context observation → planner 选择 `character_evolution` → MicroPlan/Orchestrator gate → tentative `character_evolution_seed` → completion decision 推进；`world_building_with_context_v1` 覆盖伏笔、世界规则、写作/文风规则与创作约束等具体意图，作者原始目标通过 `author_goal_text` 约束 artifact type 判定，内部 observation 不得反向污染为错误类型，已由 `agent-world-building-with-context` 与 `agent-world-building-style-rule-with-context` 真实 Tauri 证明。上述产物未采纳前均不写作品事实。

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

该 decision 不是 `MicroPlan`，也不批准工具执行；当 `decision_type=execute_step` 时，后续仍必须在该 AgentStep 内构造单动作 `MicroPlan` 并重新经过 `ExecutionOrchestrator.decide`。当前 `character_design_with_context_v1`、`conversation_turn_v1`、`prose_drafting_with_quality_v1`、`prose_revision_from_findings_v1`、`plot_outline_with_context_v1`、`character_evolution_with_context_v1`、`provider_progress_v1` 与 `readonly_batch_context_v1` 均已使用 profile 自身 next-step planner，根据 observations 选择上下文/阵容读取、修订源读取、只读批量读取、provider progress step、单个创作工具 step、汇总 step 或完成。不得恢复 `steps:` 启动参数、`planner || steps` 隐式 fallback，或把 profile `steps/1` 从拒绝旧入口的 guard 改回可执行 workflow。

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

46§9 工作详情运行中先显示同一 assistant turn 的结构性工作态骨架，避免作者发送后空等；该骨架只能由状态 chip、阶段轨道、工作详情入口等枚举/结构 UI 组成，不得代写模型推理。随后消费同一 ProviderExecution stream 内 `purpose=author_reasoning` 的 `author_narrative_delta`，provider chunk 到达即通过同一 `agent_event.provider_progress` 推动作者面 reasoning 文本增长；不得等 ProviderOutput 结束后一次性丢卡片。最终 `plan_drafted` / `plan_revised` / `exploration_observed` / `evaluation_made` 携带 source-bound `author_narrative` 后，才用结构化事件替换同 provider run 的临时 delta；普通 ProviderRun / ProviderEvent / ProviderOutput facts 仍只作为 developer detail 展开。作者可见事件禁止包含 raw prompt、chain-of-thought、provider private reasoning / thinking、API key、provider secret、未脱敏 memory、完整 ToolRequest dump 或 JSON tail。

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
- CP4D / CP5 / CP6：`NovelApplication.ProviderActivityProjector` 已把同一次 ProviderExecution 的 ProviderRun / ProviderEvent / ProviderOutput facts 投影为 developer visibility 的 `agent_event.provider_progress`；conversation / prose drafting / character design / plot outline / character evolution / prose revision flows 在 AgentRun snapshot 上接入 projector。真实 Tauri `agent-provider-execution-stream-unified` 已证明普通对话进入 `conversation_turn_v1`，provider_started / request_prepared / request_dispatched / provider_chunk / response_received / provider_final_output 以 developer provider_progress 进入同一 assistant 工作详情，并携带 provider_run_ref / provider_call_ref / progress phase / chunk length metadata，不泄漏 raw prompt、system prompt、frame JSON、assistant_message 或 raw text delta。真实 Tauri `agent-provider-execution-error-author-safe` 已证明 provider_started / provider_error 也进入 developer telemetry，payload 只暴露 status=error / output_type=empty / refs 等摘要，最终 TurnResult 不调用工具、不采纳、不写作品事实。session resume / show 首屏现在只恢复最近 transcript page 与每条 assistant 的 `agent_run` summary，不同步 hydrate author-safe events / provider_runs；更早 transcript 通过 scoped `GET /api/works/:work_id/sessions/:session_id/transcript?before_id=...` 按 interaction cursor 异步加载，并校验 work/session/cursor 归属。同一 assistant 对话流的“工作详情”默认收起，展开时通过 scoped `GET /api/works/:work_id/sessions/:session_id/turns/:turn_id/agent-run-activity` 异步读取原 work/session/turn 下的 AgentRun author-safe events、provider_run_ref、provider_call_ref、planner/conversation purpose、events、output summary 与 usage totals，不重新调用 provider，也不泄漏 raw provider content。`agent-session-transcript-lazy-page` 已进一步证明：旧 transcript page 加载出来的历史 assistant 仍只携带 `agent_run` summary，作者展开该旧 assistant 的“工作详情”时通过同一 scoped activity API 原地加载 ProviderRun replay，且加载旧页和展开旧详情都不重新调用 provider。ProviderRun replay UI 的事件序列 / 输出摘要 / no-provider-recall boundary 仍在同一 assistant 对话流内呈现。
- ADR-0022 / 46§9 对上条普通 telemetry 约束作窄化扩展：`purpose=author_reasoning` 的 provider chunk 可投影 JSON tail 之前的 `author_narrative_delta`，用于作者面实时 reasoning；该 delta 仍必须在最终 ProviderOutput 中通过 streamed-prefix / source binding 验证，不得扩展到正文、工具或 provider private reasoning。
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
- `agent-work-isolation`

UA-CP4 fresh Tauri summary 已补齐。UA-CP5 的 `agent-durable-resume-long-run-task` 已转 active/nightly 并通过真实 Tauri 验收，证明 durable run 关联 `LongRunTask`、backend restart 后 stale recovery 等待作者且不重复执行已完成 step。UA-CP6 的 `agent-provider-streaming-progress`、`agent-provider-cancel-honest-boundary`、`agent-readonly-batch-profile` 已转 active/nightly 并通过真实 Tauri 验收：provider progress 事件 author-safe 且不泄漏 raw prompt；cancel 进入 `cancelling`、请求 `provider_execution_cancel` 并最终落 `cancelled`；只读 batch profile 本身不调用内容 provider、不生成 artifact、不触发 adoption。`agent-natural-language-steer` 已证明运行中主输入框文本发送为同一 active `run_id` 的 `agent_command steer`，广播 goal version 2，页面保留本地作者消息锚点，且不产生第二个后端 `user_message`。当前普通 `user_message` 先进入 `profile_routing_v1`，由运行时 profile router 选择目标 profile，再切入目标 profile 的 observation-led next-step planner；profile routing 不批准工具执行，后续工具 step 仍重新经过 Orchestrator gate。当前预算口径包含一次 profile routing provider call：`agent-conversation-turn` 为 4 steps / 0 tools / 7 provider calls；`agent-prose-drafting-with-quality` 为 2 steps / 1 tool / 6 provider calls；`agent-plot-outline-with-context`、`agent-character-evolution-with-context`、`agent-world-building-with-context` 与 `agent-world-building-style-rule-with-context` 均为 2 steps / 1 tool / 5 provider calls；`agent-provider-streaming-progress` 为 2 provider calls；`agent-readonly-batch-profile` 为 1 provider call且无 artifact/write/adoption。不得把当前 CP6 progress/cancel/read-only batch 写成 live vendor 真实矩阵已完成。

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
