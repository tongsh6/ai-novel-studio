# VS-06 Replay Surface Contract Pack

> 状态：draft for ADR-0017 acceptance（2026-05-07）
>
> 角色：为 `tasks/slices/v3/VS-06-trace-summary-replay-explanation.md` 关闭实现前文档 blocker。本文是 VS-06 的 contract pack，不是 implementation plan，不授权代码实现。

---

## 1. Scope

VS-06 只证明 trace summary 与 replay explanation 的最小闭环：

```text
DecisionTrace
→ ToolTrace / BehaviorTrace / StateTrace refs
→ TraceSummaryView
→ ReplayCase
→ ReplayReport
→ explanation without provider call
```

VS-06 不实现 trace store，不定义 debug console，不重新调用 LLM，不冻结完整 observability 平台。

---

## 2. TraceSummaryView VS-06 Subset

VS-06 复用 ADR-0014 的 redaction 规则，并补 replay explanation 所需字段。

| Field | Type | Required | VS-06 rule |
|---|---|---:|---|
| `trace_ref` | string | yes | DecisionTrace ref |
| `turn_id` | string | yes | 被解释的 turn |
| `summary` | string | yes | author-safe explanation |
| `reason_codes` | array | yes | 非敏感 reason codes |
| `visible_steps` | array | yes | redacted step summaries |
| `source_trace_refs` | array | yes | frame / plan / decision / tool / behavior / state refs 摘要 |
| `redaction_level` | enum | yes | `author_safe` / `developer_summary` |
| `replay_report_ref` | string or null | yes | developer path 可引用 |

规则：

1. author-safe summary 不展示 raw prompt、hidden policy、sensitive memory 或 raw tool I/O。
2. visible steps 必须能映射到 DecisionTrace 的结构化节点。
3. summary 不能补写 trace 中不存在的解释。

---

## 3. ReplayCase 最小 Schema 草案

ReplayCase 是一次 replay 输入 envelope。

| Field | Type | Required | VS-06 rule |
|---|---|---:|---|
| `replay_case_id` | string | yes | 稳定 id |
| `trace_ref` | string | yes | 被 replay 的 DecisionTrace |
| `turn_id` | string | yes | 被 replay 的 turn |
| `replay_level` | enum | yes | VS-06 使用 `structural` |
| `contract_versions` | object | yes | frame / plan / tool / behavior / trace / UI contract versions |
| `registry_snapshots` | array | yes | 工具 version / status snapshot |
| `state_snapshot_refs` | array | yes | gate / adoption 使用的状态快照 |
| `redaction_profile` | enum | yes | `author_safe` / `developer_summary` |
| `created_at` | timestamp | yes | replay case created time |

规则：

1. `replay_level=structural` 不重新调用 provider。
2. ReplayCase 必须绑定 contract versions，避免用当前 schema 误读历史 trace。
3. ReplayCase 不能改变 production state。

---

## 4. ReplayReport 最小 Schema 草案

ReplayReport 是 replay 的输出解释。

| Field | Type | Required | VS-06 rule |
|---|---|---:|---|
| `replay_report_id` | string | yes | 稳定 id |
| `replay_case_ref` | string | yes | 来源 ReplayCase |
| `trace_ref` | string | yes | 被解释 DecisionTrace |
| `replay_level` | enum | yes | VS-06 使用 `structural` |
| `chain_summary` | array | yes | 按 frame / plan / decision / tool / behavior / state / TurnResult 串起 |
| `decision_explanations` | array | yes | 为什么执行或不执行 |
| `state_explanations` | array | yes | candidate / adopted / projection 边界解释 |
| `missing_trace_refs` | array | yes | 缺失或不可解释节点 |
| `redaction_profile` | enum | yes | 报告可见性 |
| `provider_called` | boolean | yes | VS-06 必须为 false |
| `result_status` | enum | yes | `complete` / `partial` / `invalid_trace` |

规则：

1. ReplayReport 解释历史事实，不重新创作。
2. `provider_called` 必须为 false。
3. `missing_trace_refs` 非空时不得声称 replay complete。
4. developer summary 可以比 author summary 多，但仍不能改变业务状态。

---

## 5. Required Replay Questions

VS-06 replay 必须至少能回答：

| Question | Source |
|---|---|
| 本轮为什么是 reply-only / require confirmation / tool dispatch / adoption | OrchestratorDecision / gate trace |
| Planner 建议和最终 decision 有什么差异 | MicroPlan / DecisionTrace |
| 哪个 tool 被批准、使用哪个 registry version、返回什么结果 | ToolTrace |
| 为什么 ToolResult 没有直接成为 adopted state | AdoptionDecision / StateTrace |
| 哪个 behavior 被打开、如何关闭 | BehaviorTrace / DecisionTrace |
| TurnResult 为什么可以展示这些 action / cards / trace summary | TurnResultViewModel / TraceSummaryView |

---

## 6. Proof 草案

| Proof | Expected assertion |
|---|---|
| replay no provider | structural replay never calls LLM/provider |
| complete chain replay | frame / plan / decision / tool / behavior / state / TurnResult refs can be ordered |
| missing trace detected | missing critical trace produces `partial` or `invalid_trace` |
| redacted author summary | author summary excludes sensitive internals |
| developer report separated | developer report is not ordinary UI main data |
| adoption explanation | report explains selected vs adopted boundary |
| stale action explanation | report explains stale / invented action rejection |
| truthfulness check | ReplayReport does not invent facts missing from trace |

---

## 7. ADR-0017 Acceptance Review

ADR-0017 can enter Accepted because this pack provides the ReplayCase / ReplayReport structural replay contract and no-provider rule.

Acceptance does not authorize code. It only means VS-06 has stable design inputs for a later implementation plan after user approval.

---
