# VS-03 Behavior Lifecycle Contract Pack

> 状态：draft for ADR-0006 to ADR-0009 acceptance（2026-05-07）
>
> 角色：为 `tasks/slices/v3/VS-03-clarification-confirmation-behavior-lifecycle.md` 关闭实现前文档 blocker。本文是 VS-03 的 contract pack，不是 implementation plan，不授权代码实现。

---

## 1. Scope

VS-03 只证明 clarification / confirmation durable behavior 的最小闭环：

```text
OrchestratorDecision
→ TurnPhase / TurnStatus
→ NextAction / AvailableAction
→ BehaviorState open
→ author answer / cancel
→ BehaviorState resolving / closed
→ DecisionTrace
→ TurnResult
```

VS-03 不实现 candidate adoption，不冻结完整 UI view model，不执行 production write，不定义数据库 schema。

---

## 2. TurnPhase / TurnStatus 最小集合

VS-03 只冻结 behavior lifecycle 需要的 phase/status subset。

| Contract | Value | VS-03 rule |
|---|---|---|
| `TurnPhase` | `dialogue` | 自然对话或降级回应，没有 author-blocking behavior |
| `TurnPhase` | `awaiting_author` | 必须有 active author-blocking BehaviorState |
| `TurnPhase` | `completed` | 不得存在 unresolved author-blocking behavior |
| `TurnPhase` | `cancelled` | 必须引用关闭目标或说明无目标可关闭 |
| `TurnPhase` | `failed` | 必须说明是否 recoverable |
| `TurnStatus` | `conversational` | 可继续自然对话 |
| `TurnStatus` | `needs_clarification` | 等待作者补充 blocking 信息 |
| `TurnStatus` | `needs_confirmation` | 等待作者确认明确动作 |
| `TurnStatus` | `cancelled` | 行为或 turn 被关闭 |
| `TurnStatus` | `failed_recoverable` | 有 retry、narrow scope 或 recovery path |

规则：

1. `awaiting_author` 必须搭配 author-facing `NextAction` 和 active BehaviorState。
2. `completed` 不能掩盖 open confirmation / clarification。
3. early exploration 不自动进入 `needs_clarification`。

---

## 3. NextAction / AvailableAction 最小集合

VS-03 只冻结 clarification / confirmation roundtrip 需要的动作。

| Action | Actor | Used by | Rule |
|---|---|---|---|
| `continue_dialogue` | author | dialogue fallback | 不要求 active behavior |
| `answer_clarification` | author | clarification | 必须引用 open clarification |
| `confirm_before_execute` | author | confirmation | 必须引用 open confirmation 和 target |
| `reject_or_cancel_confirmation` | author | confirmation | 关闭或拒绝 open confirmation |
| `cancel_pending_behavior` | author | clarification / confirmation | 必须引用待关闭 behavior |
| `retry_action` | author/system | recovery | 必须引用 failed recoverable behavior 或 decision |
| `narrow_scope` | author | recovery / confirmation | 用于预算、风险或范围过大 |
| `no_further_action` | none | completed | 不能和 open author-blocking behavior 同时出现 |

AvailableAction envelope subset:

| Field | Required | Rule |
|---|---:|---|
| `action_id` | yes | TurnResult 内稳定 id |
| `action_type` | yes | 使用上表动作 |
| `behavior_ref` | yes | author-blocking action 必须存在 |
| `target_ref` | yes | confirmation / cancellation 必须存在 |
| `idempotency_key` | yes | 防止重复确认或重复取消 |
| `expires_at` | no | 可选，过期后必须重新 gate |
| `trace_ref` | yes | action 来源 trace |

---

## 4. BehaviorState 最小 Schema 草案

| Field | Type | Required | VS-03 rule |
|---|---|---:|---|
| `behavior_id` | string | yes | 稳定 id |
| `behavior_type` | enum | yes | VS-03 只需要 `clarification` / `confirmation` / `recovery` |
| `lifecycle_status` | enum | yes | `open` / `awaiting_author` / `resolving` / `resolved` / `cancelled` / `failed` / `superseded` |
| `blocking_actor` | enum | yes | author / system / tool / none |
| `opened_at_turn_ref` | string | yes | 打开行为的 turn |
| `opened_by_decision_ref` | string | yes | 打开行为的 decision |
| `frame_ref` | string | yes | 关联 DialogueFrame |
| `plan_ref` | string or null | yes | 无 plan 时为 null |
| `target_ref` | string or null | yes | confirmation 必须非空 |
| `required_next_action` | string | yes | primary NextAction |
| `available_actions` | array | yes | 来自 Orchestrator，不由 UI 发明 |
| `prompt_contract` | object | yes | 问题、确认对象或影响范围的语义描述 |
| `constraints` | object | yes | authority / budget / risk / write boundary 摘要 |
| `resolution` | object or null | yes | closed behavior 必须非空 |
| `closed_at_turn_ref` | string or null | yes | closed behavior 必须非空 |
| `trace_ref` | string | yes | DecisionTrace 引用 |

VS-03 lifecycle rules:

1. 同一 workstream 默认最多一个 primary author-blocking behavior。
2. `resolved` / `cancelled` / `failed` 必须有 resolution。
3. `superseded` 必须引用替代 behavior。
4. BehaviorState 只能由 OrchestratorDecision 打开、更新或关闭。

---

## 5. Confirmation Binding 最小 Policy

ConfirmationBinding 是确认回答和 open confirmation 之间的绑定证明。

| Field | Required | Rule |
|---|---:|---|
| `binding_id` | yes | 稳定 id |
| `behavior_ref` | yes | 必须指向 open confirmation |
| `target_ref` | yes | 必须和 confirmation target 匹配 |
| `author_input_ref` | yes | 来源作者输入或 action |
| `answer_type` | yes | `confirm` / `reject` / `revise` / `cancel` |
| `idempotency_key` | yes | 重复提交必须可识别 |
| `rebased_state_snapshot_ref` | yes | 确认后重新 gate 的状态快照 |
| `gate_result_refs` | yes | 重新 gate 的结果 |
| `trace_ref` | yes | DecisionTrace 引用 |

规则：

1. 确认不能绑定最近任意动作，只能绑定 open confirmation。
2. 确认后必须重新跑 Orchestrator gate。
3. stale / duplicate confirmation 不能执行写入，只能返回已有结果、恢复或重新确认。
4. UI 不能自行关闭 confirmation 并写 production state。

---

## 6. TurnResult Truthfulness Rules

| Behavior outcome | TurnResult may say | TurnResult must not say |
|---|---|---|
| clarification open | 系统需要一个 blocking 答案 | 已经理解并执行目标 |
| clarification resolved | 已收到答案并重新进入裁决 | 已绕过 gate 执行动作 |
| confirmation open | 需要确认具体 target 和影响范围 | 已经执行 production write |
| confirmation rejected | 已取消或拒绝该 pending action | action 已部分执行 |
| confirmation confirmed | 已收到确认并重新 gate | gate 一定通过 |
| recovery open | 可重试、缩小范围或继续对话 | 系统已完成失败动作 |

---

## 7. Proof 草案

| Proof | Expected assertion |
|---|---|
| exploration no clarification | 早期探索保持 `dialogue / conversational` |
| blocking clarification opens | blocking target missing 产生 open clarification |
| clarification answer re-gates | 作者回答后 behavior 进入 resolving，并重新形成 decision |
| confirmation target binding | confirmation 必须绑定 target 和 behavior id |
| confirmation answer re-gates | confirm 后重新跑 gate，不直接执行 |
| stale confirmation rejected | stale / duplicate action 不产生新执行 |
| cancellation closes behavior | cancel action 关闭具体 behavior |
| single active author blocking | 同一 workstream 不出现两个 primary author-blocking behavior |
| TurnResult consistency | phase/status/next_action 与 BehaviorState 一致 |
| behavior trace replay | open / resolving / closed 都进入 DecisionTrace |

---

## 8. ADR-0006 to ADR-0009 Acceptance Review

ADR-0006 can enter Accepted because this pack provides the VS-03 TurnPhase / TurnStatus subset.

ADR-0007 can enter Accepted because this pack provides the VS-03 NextAction / AvailableAction subset.

ADR-0008 can enter Accepted because this pack provides the VS-03 BehaviorState lifecycle subset.

ADR-0009 can enter Accepted because this pack provides the confirmation binding and re-gate policy.

Acceptance does not authorize code. It only means VS-03 has stable design inputs for a later implementation plan after user approval.

---
