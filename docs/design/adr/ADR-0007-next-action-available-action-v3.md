# ADR-0007：NextAction / AvailableAction v3

- 状态：Accepted
- 日期：2026-05-07
- 来源文档：
  - `../00c-state-and-contract-atlas.md` §5, §6, §7, §8, §9
  - `../05-turn-behavior-and-state-model.md` §6, §12, §13
  - `../07-workbench-ui-contract.md` §2, §3
  - `../contracts/VS-03-behavior-lifecycle-contract-pack.md`
- 影响范围：Behavior / UI / TurnResult / Trace / Slice
- 相关不变量：`00c` §7 #7、#9、#10、#12
- 首个证明 slice：VS-03 Clarification / Confirmation Behavior 生命周期
- 取代：无
- 取代者：无

---

## 背景

作者下一步能做什么必须由 Orchestrator 裁决后进入 TurnResult，不能由 UI 根据按钮或字段自行发明。

VS-03 需要冻结 clarification / confirmation roundtrip 所需的最小 `NextAction` / `AvailableAction` contract。

## 决策范围

本 ADR 冻结 `contracts/VS-03-behavior-lifecycle-contract-pack.md` §3 的动作 subset 和 AvailableAction envelope。

## 非目标

- 不冻结最终按钮文案。
- 不冻结全部 UI action taxonomy。
- 不冻结 candidate adoption action。
- 不冻结 projection refresh action。

## 考虑过的方案

### 方案 A：UI 直接提交按钮名

- 优点：实现快。
- 缺点：按钮名会变成业务 contract，stale action 难以校验。

### 方案 B：只让作者继续自然输入

- 优点：最少结构。
- 缺点：confirmation / cancellation / retry 无法稳定绑定目标。

### 方案 C：NextAction + AvailableAction

- 优点：primary next step 和可选动作清晰，可校验 stale / invented action。
- 缺点：需要后端生成 action envelope。

## 最终决策

采用方案 C。VS-03 只冻结 continue_dialogue、answer_clarification、confirm_before_execute、reject_or_cancel_confirmation、cancel_pending_behavior、retry_action、narrow_scope、no_further_action。

## 决策理由

动作 envelope 让 UI 保持轻量：它只呈现和提交作者选择，真正的 state transition 仍由 Orchestrator 裁决。

## Contract 影响

- `TurnResult.primary_next_action` 必须来自 Orchestrator。
- author-blocking AvailableAction 必须引用 BehaviorState。
- action 必须带 idempotency key 和 trace ref。

## Umbrella 边界影响

application 生成和校验 AvailableAction；web/frontend 只提交 action input；domain 不处理 UI 事件；agent 不接收 UI action。

## UI / Trace / Replay 影响

UI 不能提交 invented action。Trace 必须记录 action 来源和处理结果。Replay 能解释 stale action 为什么被拒绝或恢复。

## 垂直切面证明

VS-03 证明 stale / duplicate confirmation 不产生新执行，cancel action 只能关闭对应 behavior。

## 迁移与兼容

历史 UI 事件需要映射为当前 ActionInput，不能直接写状态。

## 后续工作

- VS-05 冻结完整 UI roundtrip。
- VS-04 冻结 candidate selection / adoption 相关 actions。

---
