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
- quality/acceptance/scenarios/au06-single-active-confirmation.yml

## enforcement_gaps

- B13b 裁决（2026-10-22，修复-独立 slice `BEHAVIOR-LIFECYCLE-DECISION-AUTHORITY`）：cancel/reject 路径的 `BehaviorState` 关闭不经 `OrchestratorDecision`（`dialogue_gateway.ex:312,364-460` 直接构造 `lifecycle_status: :cancelled`）；该规则原文在 VS-03 §4 规则4（contract pack 仍 draft，且 ADR-0008 正文未冻结关闭权，原 gap 引用需修正）。slice 以 `cancel_or_close` decision + behavior trace ref 收敛，并扩 `au10-workbench-recovery-cancel-waiting` 真实页面断言；前置：作者裁决 VS-03 是否冻结（见 B13b 汇总「需要作者裁决的问题」）。
- B13b 裁决（2026-10-22，修复-独立 slice `BEHAVIOR-LIFECYCLE-DECISION-AUTHORITY`）：同一 workstream 至多一个 primary author-blocking behavior 的保证当前只在 Channel current-turn guard（`workspace_channel.ex:2861-2870`）与前端 `activeBehaviorId` 门控（`workbenchActions.ts:54-64`、`WorkspaceChat.tsx:2740-2756`），BehaviorState 的 `:superseded` 从未被赋值（全仓仅 `behavior_state.ex:74` 读取）；slice CP2 增加显式 supersede + history 断言，扩 `au06-single-active-confirmation`。
