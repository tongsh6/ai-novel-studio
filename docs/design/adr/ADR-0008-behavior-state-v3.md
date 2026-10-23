# ADR-0008：BehaviorState v3

- 状态：Accepted
- 日期：2026-05-07
- 来源文档：
  - `../00c-state-and-contract-atlas.md` §5, §6, §7, §8, §9
  - `../05-turn-behavior-and-state-model.md` §7, §8, §10, §11
  - `../06-memory-context-and-trace.md` §8
  - `../contracts/VS-03-behavior-lifecycle-contract-pack.md`
- 影响范围：Behavior / TurnResult / Trace / UI / Umbrella / Slice
- 相关不变量：`00c` §7 #7、#8、#10、#12、#14
- 首个证明 slice：VS-03 Clarification / Confirmation Behavior 生命周期
- 取代：无
- 取代者：无

---

## 背景

Clarification 和 confirmation 不能只是前端临时状态。刷新、重试、跨 turn 回答、取消和 replay 都需要 durable behavior。

## 决策范围

本 ADR 冻结 VS-03 所需的 `BehaviorState` envelope 和 lifecycle subset。

## 非目标

- 不冻结所有 behavior 类型。
- 不定义数据库 schema。
- 不实现通用 behavior stack。
- 不冻结 adoption / selection 的完整语义。

## 考虑过的方案

### 方案 A：前端 modal 状态

- 优点：界面实现简单。
- 缺点：无法跨 turn、无法 replay、无法抵御 stale action。

### 方案 B：普通 turn status 加 target 字段

- 优点：对象较少。
- 缺点：open / resolving / closed lifecycle 和 resolution 不清晰。

### 方案 C：独立 BehaviorState

- 优点：生命周期、目标、动作、resolution 和 trace 都有稳定载体。
- 缺点：需要维护 behavior id 和关闭规则。

## 最终决策

采用方案 C。VS-03 使用 `contracts/VS-03-behavior-lifecycle-contract-pack.md` §4 的最小 BehaviorState contract。

## 决策理由

BehaviorState 是 durable waiting state。它让系统可以证明“现在到底等谁、等什么、如何关闭”，也防止 UI 或 Planner 擅自打开和关闭等待态。

## Contract 影响

- 新增 VS-03 最小 BehaviorState。
- `TurnResult` 引用 active behavior summary。
- DecisionTrace 记录 behavior open / resolving / closed。

## Umbrella 边界影响

application 负责 lifecycle 裁决；foundation/domain 可承接纯结构和校验；web/frontend 只消费；agent 不直接推进 author-facing behavior；persistence 只保存事实。

## UI / Trace / Replay 影响

UI 展示 BehaviorState 摘要并提交 AvailableAction。Trace 必须记录 open / close。Replay 能说明 behavior 如何 resolved、cancelled、failed 或 superseded。

## 垂直切面证明

VS-03 证明同一 workstream 只有一个 primary author-blocking behavior，completed 不掩盖 open behavior。

## 迁移与兼容

v2 的 slot waiting、confirmation modal 或 retry state 需要迁移为 BehaviorState，而不是直接复用 UI 状态。

## 后续工作

- VS-04 扩展 selection / adoption behavior。
- VS-06 扩展 BehaviorTrace 和 replay explanation。

---

## enforced_by

- apps/novel_domain/lib/novel_domain/behavior_state.ex
- apps/novel_application/lib/novel_application/execution_orchestrator.ex
- apps/novel_application/lib/novel_application/dialogue_gateway.ex
- apps/novel_application/lib/novel_application/adoption_workflow.ex
- apps/novel_application/lib/novel_application/trace_writer.ex
- apps/novel_domain/test/novel_domain/behavior_state_test.exs
- apps/novel_application/test/novel_application/behavior_lifecycle_test.exs
- apps/novel_application/test/novel_application/adoption_workflow_test.exs
- apps/novel_domain/test/novel_domain/behavior_state_test.exs
- apps/novel_web/lib/novel_web/channels/workspace_channel.ex
- quality/acceptance/scenarios/au06-single-active-confirmation.yml
- tasks/slices/BEHAVIOR-LIFECYCLE-DECISION-AUTHORITY.md

## enforcement_gaps

- **◐ 文档化偏差（2026-10-23，作者裁决：VS-03 维持 draft，Q2 建议 B）** B13b 裁决 gap 8-1：cancel/reject 路径的 `BehaviorState` 关闭不经 `OrchestratorDecision`（`dialogue_gateway.ex` `cancel_waiting_behavior_state/3` 直接构造 `lifecycle_status: :cancelled`）；该规则原文在 VS-03 §4 规则4（contract pack 仍 draft，ADR-0008 正文未冻结关闭权）。按作者默认裁决，本 slice **不新增 `cancel_or_close` decision 载体**，登记为文档化偏差。**触发翻案**：①VS-03 §4 规则4 冻结（Q2 选 A）；②真实页面出现 cancel/reject 关闭了非目标 behavior（stale/cross-work）或 replay 需要 terminal close 证据；③新增 behavior 关闭生产者。证据与边界：`tasks/slices/BEHAVIOR-LIFECYCLE-DECISION-AUTHORITY.md` §6。
- ✅ **已关闭（2026-10-23，BEHAVIOR-LIFECYCLE-DECISION-AUTHORITY CP1/CP2）** B13b 裁决 gap 8-2：同一 workstream 至多一个 primary author-blocking behavior 的保证此前只在 Channel current-turn guard 与前端 `activeBehaviorId` 门控，`:superseded` 从未被赋值。本 slice 落地显式 supersede：`NovelDomain.BehaviorState.supersede/3`（`lifecycle_status: :superseded` + `resolution = %{ref: "behavior_superseded:<old>:<new>", superseded_by, superseded_by_ref, reason_code}`）+ `snapshot/2`（新 active + 旧 behavior 进 history）+ `from_map/1`；`AdoptionWorkflow` 在打开新 confirmation 时对同 workstream 上一个 open author-blocking behavior 显式 supersede（TurnResult `behavior_state.history` + `trace_summary.behavior_supersede_ref` + `behavior_trace_refs` + `truthfulness.superseded_behavior_ref`）；Channel 维护 `active_behavior` 快照并在真实 `author_action` accept 路径注入 `previous_behavior`。真实页面验收：`au06-single-active-confirmation`（re-anchor 到采纳覆盖确认）B2 打开时 B1 进 history 且 resolution 指向 B2、旧确认不可执行、最新确认只采纳一次。**诚实边界**：supersede 只覆盖「上一个 active behavior」（不跨 turn 累积全历史）；工具派发确认在判断纪元不产可行动 behavior TurnResult（agent flow 丢弃 `_behavior`），故 8-2 的证明面是采纳覆盖确认；8-1/9-2 仍为文档化偏差。
