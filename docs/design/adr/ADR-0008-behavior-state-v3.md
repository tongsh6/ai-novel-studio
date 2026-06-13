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
