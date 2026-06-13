# VS-04 Adoption Boundary Contract Pack

> 状态：draft for ADR-0010 and ADR-0016 acceptance（2026-05-07）
>
> 角色：为 `tasks/slices/v3/VS-04-candidate-selection-adoption-boundary.md` 关闭实现前文档 blocker。本文是 VS-04 的 contract pack，不是 implementation plan，不授权代码实现。

---

## 1. Scope

VS-04 只证明 candidate selection 到 adoption boundary 的最小闭环：

```text
ToolResult / tentative artifact
→ CandidateSet
→ TurnResult candidate card
→ AuthorActionInput choose_candidate
→ Orchestrator re-gate
→ AdoptionDecision
→ adopted state or confirmation / rejection
→ ProjectionHint
→ DecisionTrace / StateTrace
```

VS-04 不冻结完整 UI view model，不定义数据库 schema，不实现真实 production write，不定义最终 projection read model。

---

## 2. CandidateSet 最小 Schema 草案

CandidateSet 是给作者选择的候选集合。它不是 adopted state。

| Field | Type | Required | VS-04 rule |
|---|---|---:|---|
| `candidate_set_id` | string | yes | 稳定 id |
| `turn_id` | string | yes | 来源 turn |
| `source_refs` | array | yes | ToolResult / MicroPlan / tentative artifact / memory refs |
| `candidate_type` | enum | yes | `direction` / `setting` / `outline` / `draft_fragment` / `revision_option` |
| `candidates` | array | yes | 至少 1 项 |
| `stability` | enum | yes | VS-04 默认为 `tentative` |
| `selection_policy_ref` | string | yes | 选择规则或互斥关系 |
| `adoption_policy_ref` | string | yes | 是否需要 confirmation / gate |
| `trace_ref` | string | yes | DecisionTrace 或 ToolTrace 引用 |

Candidate item subset:

| Field | Required | Rule |
|---|---:|---|
| `candidate_id` | yes | set 内稳定 id |
| `summary` | yes | 作者可理解摘要 |
| `content_ref` | yes | 内容引用，不要求内嵌全文 |
| `origin_ref` | yes | 来源工具、Planner 或作者输入 |
| `risk_hint` | yes | `low` / `medium` / `high` |
| `adoption_target_ref` | no | 若可采纳，指向候选写入目标 |

规则：

1. CandidateSet 可以进入 UI card，但不代表 durable selection 一定 open。
2. Candidate item 默认是 tentative。
3. Candidate item 不能被 UI 直接写成 project canon。

---

## 3. AuthorActionInput choose_candidate Subset

VS-04 只冻结 candidate selection 所需的 AuthorActionInput subset。

| Field | Required | Rule |
|---|---:|---|
| `input_id` | yes | 稳定 id |
| `source_turn_ref` | yes | 产生 candidate action 的 TurnResult |
| `action_id` | yes | 必须来自 AvailableAction |
| `action_type` | yes | VS-04 使用 `choose_candidate` |
| `candidate_set_ref` | yes | 被选择的 CandidateSet |
| `candidate_ref` | yes | 被选择的 candidate |
| `behavior_ref` | no | 若存在 durable selection，必须引用 |
| `payload` | yes | 可包含作者备注或 adoption intent |
| `idempotency_key` | yes | 防重复选择 |

规则：

1. `choose_candidate` 表达 selection intent，不表达 adoption success。
2. stale / invented `action_id` 必须被拒绝或恢复。
3. selection 后必须回到 Orchestrator gate。

---

## 4. AdoptionBoundary 最小 Policy

AdoptionBoundary 决定 candidate / ToolResult / tentative artifact 是否能成为 adopted state。

Required gate facts:

| Fact | Rule |
|---|---|
| target clarity | 必须明确写入对象和范围 |
| source provenance | 必须能追到 candidate / ToolResult / author action |
| authority | 必须通过权限检查 |
| confirmation | 高风险、production write 或覆盖动作必须满足 confirmation policy |
| freshness | source turn / action / state snapshot 不能 stale |
| conflict check | 目标状态不能和当前 canon 冲突，除非走 revision |
| trace readiness | production write 前必须准备 StateTrace / DecisionTrace material |

AdoptionDecision subset:

| Field | Required | Rule |
|---|---:|---|
| `adoption_decision_id` | yes | 稳定 id |
| `turn_id` | yes | 当前 turn |
| `source_action_ref` | yes | AuthorActionInput 或 system action |
| `candidate_ref` | yes | 被评估 candidate |
| `target_ref` | yes | 写入目标 |
| `decision_type` | yes | `adopt_tentative` / `require_confirmation` / `reject` / `downgrade_to_dialogue` / `fail_with_recovery` |
| `adopted_state_ref` | no | 只有实际采纳后存在 |
| `state_trace_ref` | no | production write 或 adopted state 必须存在 |
| `reason_codes` | yes | machine-readable reasons |
| `projection_hints` | yes | 仅在 adopted state 后可要求刷新 |
| `decision_trace_ref` | yes | DecisionTrace 引用 |

规则：

1. `candidate_selected` 不等于 `candidate_adopted`。
2. `ToolResult.state_delta` 不等于 adopted state。
3. production write 必须有 StateTrace。
4. confirmation satisfied 后仍要重新 gate。
5. adoption failure 必须产生 TurnResult，不允许静默丢弃。

---

## 5. ProjectionHint 最小 Schema 草案

ProjectionHint 告诉 UI 哪些 read model 或视图应该刷新。它不是写入授权。

| Field | Type | Required | VS-04 rule |
|---|---|---:|---|
| `projection_hint_id` | string | yes | 稳定 id |
| `turn_id` | string | yes | 当前 turn |
| `projection_ref` | string | yes | 需要刷新的 projection |
| `reason` | enum | yes | `adopted_state_changed` / `candidate_superseded` / `artifact_updated` |
| `source_state_trace_ref` | string | yes | 必须指向 adopted state trace |
| `source_decision_ref` | string | yes | AdoptionDecision 或 OrchestratorDecision |
| `priority` | enum | yes | `high` / `normal` / `low` |
| `stale_strategy` | enum | yes | `refresh` / `show_stale_notice` / `retry_later` |
| `trace_ref` | string | yes | DecisionTrace 引用 |

规则：

1. ProjectionHint 只能来自 adopted / closed state fact，不能来自 candidate selection intent。
2. UI 可以刷新 projection，但不能根据 hint 写状态。
3. Projection refresh failure 不能回滚 production state。

---

## 6. TurnResult Truthfulness Rules

| Situation | TurnResult may say | TurnResult must not say |
|---|---|---|
| candidate presented | 有若干 tentative 候选 | 已写入项目 |
| candidate selected | 已收到选择，正在审查是否可采纳 | 已采纳 |
| confirmation required | 采纳前需要确认对象和影响 | 确认已满足 |
| adoption rejected | 当前不能采纳，并说明原因或替代路径 | 部分写入已完成 |
| adopted | 已采纳并可刷新相关投影 | 未经 trace 的生产事实 |
| projection hinted | 相关视图应刷新 | UI 已经完成写入 |

---

## 7. Proof 草案

| Proof | Expected assertion |
|---|---|
| candidate not canon | CandidateSet created 后 project canon 不变 |
| selection not adoption | choose_candidate 只产生 adoption evaluation |
| stale selection rejected | stale / invented action 不写 state |
| confirmation before production | 高风险或 production adoption 进入 confirmation |
| ToolResult not adoption | ToolResult.state_delta 不直接写 adopted state |
| adopted state traced | adopted state 必须有 StateTrace / DecisionTrace |
| projection hint not write | ProjectionHint 只触发刷新，不授权 UI 写入 |
| TurnResult truthfulness | 文案区分 presented / selected / adopted |

---

## 8. ADR-0010 and ADR-0016 Acceptance Review

ADR-0010 can enter Accepted because this pack provides the VS-04 adoption boundary, adoption decision and state trace requirements.

ADR-0016 can enter Accepted because this pack provides the minimal ProjectionHint schema and UI write boundary.

Acceptance does not authorize code. It only means VS-04 has stable design inputs for a later implementation plan after user approval.

---
