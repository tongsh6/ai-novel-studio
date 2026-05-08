# ADR-0006：TurnPhase / TurnStatus v3

- 状态：Accepted
- 日期：2026-05-07
- 来源文档：
  - `../00c-state-and-contract-atlas.md` §5, §6, §7, §8, §9
  - `../05-turn-behavior-and-state-model.md` §3, §4, §5, §9
  - `../contracts/VS-03-behavior-lifecycle-contract-pack.md`
- 影响范围：Behavior / TurnResult / UI / Trace / Slice
- 相关不变量：`00c` §7 #7、#9、#10、#12、#14
- 首个证明 slice：VS-03 Clarification / Confirmation Behavior 生命周期
- 取代：无
- 取代者：无

---

## 背景

UI 和 replay 需要稳定理解一轮 turn 当前处于什么阶段，但单一状态字段会把自然对话、等待作者、执行工具、失败恢复和完成状态混在一起。

VS-03 需要先冻结 clarification / confirmation 生命周期所需的最小 phase/status subset。

## 决策范围

本 ADR 冻结 `contracts/VS-03-behavior-lifecycle-contract-pack.md` §2 的 `TurnPhase` / `TurnStatus` 最小集合。

## 非目标

- 不冻结完整状态机。
- 不冻结所有工具执行状态。
- 不冻结最终 UI view model。
- 不定义数据库字段。

## 考虑过的方案

### 方案 A：只用一个 status 字段

- 优点：字段少。
- 缺点：UI 难以区分宏观阶段和具体等待原因。

### 方案 B：由 UI 自行推断状态

- 优点：后端 contract 更轻。
- 缺点：UI 会变成第二套 Orchestrator。

### 方案 C：TurnPhase + TurnStatus 分层

- 优点：宏观阶段和具体语义分离，方便 trace / UI / tests。
- 缺点：需要维护兼容矩阵。

## 最终决策

采用方案 C。VS-03 最小集合只覆盖 dialogue、awaiting_author、completed、cancelled、failed 以及 conversational、needs_clarification、needs_confirmation、cancelled、failed_recoverable。

## 决策理由

分层状态能表达“自然对话但有候选”和“等待作者确认”之间的区别，避免系统把所有不确定都变成表单式 clarification。

## Contract 影响

- `TurnResult` 必须携带 phase/status。
- author-blocking phase 必须有 BehaviorState。
- completed phase 不能隐藏 unresolved author-blocking behavior。

## Umbrella 边界影响

状态计算属于 application 编排；foundation 可承接纯 enum / validation；web/frontend 只消费；persistence 只保存事实。

## UI / Trace / Replay 影响

UI 用 phase/status 渲染状态，不推断内部裁决。Trace 必须记录状态变化原因。Replay 能解释为何进入 awaiting_author 或 completed。

## 垂直切面证明

VS-03 证明 early exploration 不打开 clarification，blocking slot 才进入 awaiting_author / needs_clarification。

## 迁移与兼容

v2 状态名可作为迁移材料，但不直接继承。

## 后续工作

- VS-05 冻结 UI view model 中的状态消费。
- VS-06 冻结 trace summary 对状态变化的展示。

---
