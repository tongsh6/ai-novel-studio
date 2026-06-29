# ADR-0021：AgentRun 与 Turn 边界 v3

- 状态：Accepted
- 日期：2026-06-28
- 来源文档：
  - `../contracts/UA-01-unified-agent-run-loop-contract-pack.md`
  - `../contracts/VS-01-execution-authority-contract-pack.md`
  - `../contracts/VS-02-tool-provenance-contract-pack.md`
  - `../contracts/VS-06-replay-surface-contract-pack.md`
- 影响范围：Dialogue / Execution / Toolbox / Behavior / Trace / UI / Umbrella / Slice
- 相关不变量：UA-01 A1-A25
- 首个证明 slice：`ua01-agent-bounded-roster-to-character-design`
- 取代：无
- 取代者：无

---

## 背景

当前 `WorkspaceChannel.user_message` 同步执行完整 turn。长模型调用期间，同一 channel 难以可靠 pause/cancel，也无法把多步创作过程作为 author-safe 活动流展示。已有 `MicroPlan`、`ExecutionOrchestrator`、`ToolRequest`、`ToolResult` 和 VS-00E 正文质量链路不能被绕开或平行重建。

## 决策范围

本 ADR 合并冻结五个决策：

1. AgentRun 与 Turn Boundary。
2. Single-Step Re-gate in Agent Loop。
3. Author-Safe Agent Activity Stream。
4. Agent Interrupt and Steering Semantics。
5. AgentRun and LongRunTask Relationship。

## 非目标

- 不实现 durable checkpoint/resume。
- 不声明 provider hard cancellation。
- 不允许以固定 workflow 冒充通用 Agent。

## 考虑过的方案

### 方案 A：在 DialogueGateway 内循环执行多个 MicroPlan

- 优点：改动少。
- 缺点：继续阻塞 channel；容易绕过 step re-gate；pause/cancel 只能靠前端断连伪装；trace 难以区分 turn 和内部 step。

### 方案 B：用 LongRunTask 承载所有 AgentRun

- 优点：复用已有 task 表和状态。
- 缺点：把普通 bounded run 过度持久化；当前 `TaskRunner.perform_execution` 仍是占位；会模糊 bounded 与 durable 语义。

### 方案 C：新增 AgentRun 协议，bounded run 使用 supervised runtime

- 优点：保留 DialogueFrame/MicroPlan/Orchestrator/ToolRequest 边界；可快速 ack；内部 step 可异步执行和响应 interrupt；bounded 与 durable 可清楚分层。
- 缺点：需要新增 contract、runtime、Channel 协议和验收。

## 最终决策

采用方案 C。

AgentRun 是作者 turn 下的受限执行会话，不是新的作者 turn。AgentPlan 是 milestone plan，不是 MicroPlan 数组。每个 AgentStep 必须生成一个单动作 MicroPlan，并重新经过 ExecutionOrchestrator 后才能构造 ToolRequest。AgentEvent 是过程流，不是 TurnResult。bounded AgentRun 不强制创建 LongRunTask；durable AgentRun 必须关联 LongRunTask。

## 决策理由

该方案保留既有 v3 执行权不变量，同时解决 channel 同步阻塞和打断问题。它允许先用 `character_roster → character_design` 证明 Agent loop，而不把 VS-00E 正文固定 workflow 误称为 Agent。

## Contract 影响

新增：

- `NovelDomain.AgentRun`
- `NovelDomain.AgentPlan`
- `NovelDomain.AgentStep`
- `NovelDomain.AgentObservation`
- `NovelDomain.AgentRunPolicy`
- `NovelCommon.Contracts.AgentEvent`
- `agent_run_start` MicroPlan action
- `allow_agent_run` Orchestrator decision

扩展：

- Channel protocol：`agent_event` / `agent_run_state` / `agent_command`。
- Trace summary：Agent step refs、observation refs、provider call budget。

## Umbrella 边界影响

- `novel_domain`：纯 struct + 纯校验函数；不得依赖 application/agent/persistence/web。
- `novel_common`：AgentEvent contract。
- `novel_agent`：持有 agent task profile registry、工具白名单和 provider/tool 执行边界，不得引用 `NovelDomain` 或 `NovelApplication` 内部模块。
- `novel_application`：AgentRun runtime、supervision、step execution 编排，并把 agent profile 转换为每步单动作 `MicroPlan`。
- `novel_web`：Channel adapter 和 PubSub broadcast，不持有 Agent runtime 状态。
- `novel_persistence`：UA-CP3 可加最小表；bounded runtime 不必须经 LongRunTask。

## UI / Trace / Replay 影响

UI 订阅 author-safe `AgentEvent` 和 `AgentRunState`，发送 `agent_command`。AgentEvent 不展示 raw prompt、chain-of-thought、secret、未脱敏 memory 或完整 ToolRequest dump。Replay 默认不重新调用 frame planner、step planner、writer、evaluator 或 revision writer。

## 垂直切面证明

首个证明 slice：`ua01-agent-bounded-roster-to-character-design`。

证明路径：真实工作台输入“先看看当前已有角色，再帮我设计一个与主角形成镜像冲突的主要反派” → Channel 快速返回 `run_id` → event 流显示读取角色阵容和设计反派 → 至少两个 AgentStep 均有 MicroPlan/OrchestratorDecision/ToolRequest/ToolResult → 生成 tentative `character_seed` → 未采纳不写 Character 主档案 → pause/cancel 可在运行中生效。

## 迁移与兼容

普通 reply-only、direct_tool、author_action 兼容路径保留。VS-00E 正文链已迁入 AgentRun profile：`prose_drafting_with_quality_v1` 拆为正文上下文组装、策略/授权、正文生成+质量复核、最终汇总四个显式 AgentStep；`prose_revision_from_findings_v1` 拆为读取/校验修订对象、修订计划与授权、工具执行、最终候选汇总四个显式 AgentStep。CP4 fresh Tauri summary 仍按剩余缺口跟进。

## 后续工作

- UA-CP2：supervised bounded runtime（2026-06-28 已落地）。
- UA-CP3：角色阵容读取 → 角色设计真实页面验收（2026-06-28 已通过 `ua01-agent-bounded-roster-to-character-design`）。
- UA-CP4：正文 Profile 迁移并复用 VS-00E（正文草稿四步 profile 与修订四步 profile 已实现；fresh Tauri summary 仍需补齐）。
- UA-CP5：durable AgentRun + LongRunTask 真实消费者。
- UA-CP6：streaming / provider cancel / read-only batch。
