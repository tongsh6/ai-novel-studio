# VS-05 UI Roundtrip Contract Pack

> 状态：draft for ADR-0014 and ADR-0015 acceptance（2026-05-07）
>
> 角色：为 `tasks/slices/v3/VS-05-ui-available-action-roundtrip.md` 关闭实现前文档 blocker。本文是 VS-05 的 contract pack，不是 implementation plan，不授权代码实现。

---

## 1. Scope

VS-05 只证明 Workbench UI roundtrip 的最小闭环：

```text
TurnResultViewModel
→ UI renders available action
→ AuthorActionInput
→ action validation
→ stale / invented action rejection
→ new TurnResultViewModel
→ redacted TraceSummaryView
```

VS-05 不实现最终前端组件，不冻结视觉系统，不执行工具，不写 production state。

---

## 2. TurnResultViewModel 最小 Schema 草案

TurnResultViewModel 是 Workbench UI 的主消费 envelope。

| Field | Type | Required | VS-05 rule |
|---|---|---:|---|
| `turn_id` | string | yes | 当前 turn |
| `schema_version` | string | yes | UI contract version |
| `assistant_message` | object | yes | 作者主消息，必须事实一致 |
| `turn_phase` | enum | yes | 来自 ADR-0006 |
| `turn_status` | enum | yes | 来自 ADR-0006 |
| `primary_next_action` | enum | yes | 来自 ADR-0007 |
| `available_actions` | array | yes | 来自 Orchestrator，不由 UI 发明 |
| `ui_cards` | array | yes | 语义卡片，不是组件名 |
| `active_behavior` | object or null | yes | author-blocking behavior 摘要 |
| `trace_summary` | object or null | yes | redacted TraceSummaryView |
| `projection_hints` | array | yes | 来自 ADR-0016，只触发刷新 |
| `disabled_reason` | string or null | yes | 当前无法行动原因 |
| `debug_refs` | array | yes | 普通作者视图不得使用为业务数据 |

规则：

1. UI 主渲染只依赖 TurnResultViewModel。
2. TurnResultViewModel 可以引用 trace / behavior / tool / projection，但不暴露 raw internal objects 作为主数据源。
3. `assistant_message` 不能宣称 trace 中未发生的动作。
4. `available_actions` 为空时，UI 只能提交自由文本或刷新。
5. 服务端必须保留或可取回当前可执行 TurnResultViewModel；AuthorActionInput 只能回传 action 引用，不能用客户端回传的完整 TurnResultViewModel 作为授权依据。

---

## 3. AvailableAction Roundtrip Subset

VS-05 复用 ADR-0007 的 action subset，并补 UI roundtrip 字段。

| Field | Required | Rule |
|---|---:|---|
| `action_id` | yes | TurnResult 内稳定 id |
| `action_type` | yes | 必须在 accepted action set 内 |
| `source_turn_ref` | yes | UI 提交时必须回传 |
| `behavior_ref` | no | author-blocking action 必须存在 |
| `target_ref` | no | confirmation / candidate / cancellation 必须存在 |
| `enabled` | yes | disabled action 不能被执行 |
| `disabled_reason` | no | disabled 时必须能解释 |
| `submission_contract` | yes | 规定 payload required fields |
| `idempotency_key` | yes | 防重复提交 |
| `trace_ref` | yes | action 来源 trace |

AuthorActionInput validation:

| Validation | Failure outcome |
|---|---|
| server-side source TurnResultViewModel exists or is rebasable | missing / stale source TurnResult |
| `source_turn_ref` still current or rebasable | stale action TurnResult |
| `action_id` exists in source TurnResult | invented action rejection |
| `action_type` matches stored action | validation failure |
| disabled action not accepted | rejected TurnResult |
| required behavior / target refs match | stale or mismatch rejection |
| idempotency key not duplicate, or duplicate returns existing result | idempotent response |

---

## 4. UI Card Type 最小集合

VS-05 只冻结 UI roundtrip 需要的 card type 集合。

| card_type | Source | Rule |
|---|---|---|
| `candidate_set` | CandidateSet | tentative unless adopted trace exists |
| `clarification_prompt` | BehaviorState clarification | requires `answer_clarification` action |
| `confirmation_request` | BehaviorState confirmation | requires target and impact summary |
| `recovery_prompt` | failed recoverable decision | requires retry / narrow / continue action |
| `trace_summary` | TraceSummaryView | must be redacted |
| `projection_notice` | ProjectionHint | refresh only, no write |
| `capability_notice` | registry / policy summary | informational |

Rules:

1. UI cannot invent `card_type`.
2. card does not imply action.
3. card facts must match TurnResult / trace.

---

## 5. TraceSummaryView Redaction Policy

VS-05 only freezes author-visible redaction.

TraceSummaryView subset:

| Field | Required | Rule |
|---|---:|---|
| `trace_ref` | yes | DecisionTrace ref |
| `summary` | yes | author-safe explanation |
| `reason_codes` | yes | machine-readable, non-sensitive |
| `visible_steps` | yes | redacted step summaries |
| `redaction_level` | yes | `author_safe` for VS-05 |
| `debug_available` | yes | boolean only; no raw debug material |

Author-visible summary must not include:

- provider raw prompt
- hidden policy text
- sensitive memory content
- unredacted tool input / output
- internal scoring details
- debug-only trace refs as business data

---

## 6. Proof 草案

| Proof | Expected assertion |
|---|---|
| turn result is sole UI source | UI contract reads TurnResultViewModel, not internal trace/tool objects |
| invented action rejected | unknown action_id cannot advance state |
| stale action rejected | old source_turn_ref cannot mutate current state |
| disabled action rejected | disabled action returns explanation only |
| valid action re-enters main chain | accepted action produces a new TurnResultViewModel |
| server source of truth | forged client `source_turn_result` cannot authorize an action absent from server-held source TurnResultViewModel |
| trace summary redacted | author view excludes prompt / hidden policy / sensitive memory |
| projection hint refresh only | UI refresh action cannot write state |
| message truthfulness | assistant_message matches trace and adopted state facts |

---

## 7. ADR-0014 and ADR-0015 Acceptance Review

ADR-0014 can enter Accepted because this pack provides author-visible TraceSummaryView redaction rules.

ADR-0015 can enter Accepted because this pack provides the VS-05 TurnResultViewModel and UI action roundtrip contract.

Acceptance does not authorize code. It only means VS-05 has stable design inputs for a later implementation plan after user approval.

---
