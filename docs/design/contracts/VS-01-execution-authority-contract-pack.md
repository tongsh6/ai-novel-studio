# VS-01 Execution Authority Contract Pack

> 状态：draft for ADR-0002 to ADR-0005 acceptance（2026-05-07）
>
> 角色：为 `tasks/slices/v3/VS-01-micro-plan-downgrade-confirmation.md` 关闭实现前文档 blocker。本文是 VS-01 的 contract pack，不是 implementation plan，不授权代码实现。

---

## 1. Scope

VS-01 只证明 execution authority spine 的最小闭环：

```text
primary DialogueFrame
→ MicroPlan draft
→ PlannerOutput Boundary validation
→ Execution Gate Order
→ OrchestratorDecision
→ TurnResult truthfulness
→ DecisionTrace
```

VS-01 不执行真实工具，不写 production state，不实现完整 durable behavior lifecycle，不实现 UI 组件。

---

## 2. MicroPlan 最小 Schema 草案

VS-01 的 `MicroPlan` schema 只覆盖 Orchestrator 能审查和降级的最小建议 envelope。

| Field | Type | Required | VS-01 rule |
|---|---|---:|---|
| `schema_version` | string | yes | 固定为 `3.0-draft` 或后续 schema draft version |
| `plan_id` | string | yes | 稳定 id，可被 decision / trace 引用 |
| `turn_id` | string | yes | 绑定当前 turn |
| `frame_ref` | string | yes | 必须指向 accepted primary `DialogueFrame` |
| `primary` | boolean | yes | VS-01 必须为 `true` |
| `plan_goal.summary` | string | yes | Planner 建议推进的目标 |
| `proposed_actions` | array | yes | 至少 1 项；允许多项用于证明降级 |
| `state_changes_requested` | array | yes | 可为空；只能表达候选变化 |
| `required_capabilities` | array | yes | 可为空；只能表达 capability class / key |
| `risk_hint` | enum | yes | `low` / `medium` / `high` |
| `requires_confirmation_hint` | boolean | yes | Planner 提示，不是 gate result |
| `stop_after_next_action` | boolean | yes | VS-01 必须为 `true` |
| `fallback_strategy` | object | yes | 降级或拒绝时的作者可见回应方向 |

### 2.1 Proposed Action Shape

| Field | Type | Required | Rule |
|---|---|---:|---|
| `action_id` | string | yes | plan 内稳定 id |
| `action_type` | enum | yes | VS-01 允许的动作族 |
| `summary` | string | yes | 人类可读摘要 |
| `target_ref` | string or null | yes | 无明确对象时为 null |
| `write_intent` | enum | yes | `none` / `tentative` / `production_candidate` |
| `risk_hint` | enum | yes | 可与 plan 级 risk 汇总不同 |

VS-01 允许的 `action_type`：

| Value | Meaning |
|---|---|
| `candidate_generation` | 建议生成候选，不表示已采纳 |
| `tentative_artifact` | 建议创建 tentative 产物，不表示 production write |
| `state_change_request` | 建议状态变化，必须经过 adoption / write boundary |
| `clarification_request` | 建议澄清，但不直接打开 durable behavior |
| `confirmation_request` | 建议确认，但不直接打开 confirmation |
| `capability_invocation` | 建议调用 capability，不生成 ToolRequest |

### 2.2 Forbidden Planner Semantics

`MicroPlan` 与 PlannerOutput Boundary 禁止以下语义族：

- execution approval
- ToolRequest id
- tool dispatched fact
- adopted state
- production write allowed
- BehaviorState opened / closed fact
- AvailableAction
- confirmation satisfied
- authority / budget / policy passed

这些语义出现时，VS-01 必须产生 validation failure、downgrade 或 recovery trace，不能继续执行。

---

## 3. PlannerOutput Boundary 最小 Validation

VS-01 必须在 OrchestratorDecision 形成前验证 Planner 输出。

| Validation | Failure outcome |
|---|---|
| exactly one primary DialogueFrame is referenced | `fail_with_recovery` |
| MicroPlan frame_ref points to current turn primary frame | `fail_with_recovery` |
| forbidden planner semantics absent | `fail_with_recovery` or `downgrade_to_dialogue` |
| proposed_actions are structurally valid | `fail_with_recovery` |
| stop_after_next_action is true | `downgrade_to_dialogue` |
| state_changes_requested are candidate-only | `require_confirmation` or `downgrade_to_dialogue` |

Validation failures must enter `DecisionTrace`; they must not be swallowed as ordinary prompt errors.

---

## 4. Execution Gate Order VS-01 Subset

VS-01 uses the ADR-0005 gate order, but only proves a subset.

| Order | Gate | VS-01 required proof |
|---:|---|---|
| 0 | Correlation / idempotency | turn / frame / plan refs are consistent |
| 1 | Envelope validation | invalid frame / plan refs fail before action gate |
| 3 | Action scope | multi-step or long-running plan becomes `downgrade_to_dialogue` |
| 5 | Authority | high-risk or write-sensitive request may require confirmation |
| 7 | Budget | high-cost hint may require confirmation or recovery |
| 9 | Write / adoption boundary | production candidate cannot become production fact |
| 10 | Trace readiness | decision cannot be emitted without trace material |
| 11 | TurnResult compatibility | output cannot claim downgraded / unconfirmed work happened |

VS-01 does not need to fully implement behavior compatibility, policy detail, toolbox availability, or persistence locking. It must preserve their relative order in documentation and trace shape.

---

## 5. OrchestratorDecision 最小 Schema 草案

VS-01 `OrchestratorDecision` only needs enough structure to prove downgrade / confirmation / validation failure.

| Field | Type | Required | VS-01 rule |
|---|---|---:|---|
| `decision_id` | string | yes | stable id |
| `turn_id` | string | yes | current turn |
| `frame_ref` | string | yes | accepted primary frame |
| `plan_ref` | string or null | yes | VS-01 normally set |
| `decision_type` | enum | yes | VS-01 subset |
| `decision_status` | enum | yes | at least `decided` / `failed` / `emitted` |
| `approved_actions` | array | yes | empty for downgrade / confirmation |
| `rejected_actions` | array | yes | actions rejected by validation or hard gate |
| `downgraded_actions` | array | yes | actions not executed due to scope / safety |
| `required_author_action` | object or null | yes | present for confirmation / clarification |
| `first_blocking_gate` | string or null | yes | gate identity |
| `reason_codes` | array | yes | machine-readable reasons |
| `turn_result_policy.truthfulness_constraints` | array | yes | constraints for TurnResult Builder |
| `decision_trace_ref` | string | yes | trace reference |

VS-01 `decision_type` subset:

| Value | Meaning |
|---|---|
| `downgrade_to_dialogue` | plan too broad or unsafe to execute |
| `require_confirmation` | next step may proceed only after author confirmation |
| `require_clarification` | missing target / scope prevents safe decision |
| `reject` | hard authority / policy style block |
| `fail_with_recovery` | invalid envelope, trace failure, or recoverable system issue |

VS-01 does not use `allow_next_action` to execute a real tool or write. If a low-risk action would be allowed, VS-01 may record it as a future proof but does not dispatch.

---

## 6. TurnResult Truthfulness Rules

VS-01 TurnResult must honestly represent the decision.

| Decision type | TurnResult may say | TurnResult must not say |
|---|---|---|
| `downgrade_to_dialogue` | system chose to discuss / narrow scope | any action was executed |
| `require_confirmation` | author confirmation is required | confirmation was satisfied |
| `require_clarification` | a target or scope is missing | durable behavior is resolved |
| `reject` | request cannot proceed under current rules | partial production write happened |
| `fail_with_recovery` | system needs recovery / retry path | tool or write succeeded |

Available actions are deferred to later ADRs. VS-01 may describe an author action semantically, but it must not freeze final UI action schema.

---

## 7. DecisionTrace 最小 Policy

VS-01 trace must record plan-vs-decision difference.

Required trace nodes:

```text
frame_trace
→ micro_plan_trace
→ planner_boundary_validation
→ gate_result_trace
→ orchestrator_decision_trace
→ turn_result_trace
```

Required trace facts:

| Fact | Rule |
|---|---|
| source frame | required |
| source plan | required when plan exists |
| proposed action summaries | required |
| forbidden planner semantics | recorded when present |
| first blocking gate | required for non-allow decisions |
| reason codes | required |
| author-safe summary eligibility | required |
| replay policy | replay uses recorded frame / plan / decision, not new provider call |

---

## 8. Proof 草案

VS-01 implementation plan must turn these into tests or runnable commands. This document only defines proof.

| Proof | Expected assertion |
|---|---|
| forbidden planner approval | Planner output with approval semantics is rejected or downgraded |
| multi-step downgrade | plan with multiple write / long-running actions produces `downgrade_to_dialogue` |
| high-risk confirmation | high-risk write candidate produces `require_confirmation` without ToolRequest |
| confirmation hint not authoritative | `requires_confirmation_hint=false` can still produce confirmation |
| write candidate not production fact | requested production change remains unadopted |
| trace first blocking gate | DecisionTrace records first blocking gate and reason code |
| TurnResult truthfulness | TurnResult does not claim downgraded / unconfirmed action happened |

Suggested test input:

```text
把第一章重写成悬疑风格，顺便直接替换正文、更新人物关系，并把伏笔表也整理掉。
```

This is intentionally too broad. VS-01 should prove the system narrows, confirms, or downgrades instead of executing the whole request.

---

## 9. ADR-0002 to ADR-0005 Acceptance Review

ADR-0002 can enter Accepted because this pack provides the VS-01 MicroPlan minimal schema subset and proof.

ADR-0003 can enter Accepted because this pack provides the PlannerOutput Boundary validation surface.

ADR-0004 can enter Accepted because this pack provides the VS-01 OrchestratorDecision subset and truthfulness mapping.

ADR-0005 can enter Accepted because this pack provides the VS-01 gate order subset and first-blocking-gate proof.

Acceptance does not authorize code. It only means VS-01 has stable design inputs for a later implementation plan after user approval.

---

## 10. Remaining Deferred Items

| Item | Blocks |
|---|---|
| full `NextAction` / `AvailableAction` schema | VS-03 / VS-05 |
| full `BehaviorState` lifecycle | VS-03 |
| full `ToolRequest` / `ToolResult` schema | VS-02 |
| full `DecisionTrace` persistence and redaction | VS-06 |
| production write / adoption policy | VS-04 |
