# VS-02 Tool Provenance Contract Pack

> 状态：draft for ADR-0011 to ADR-0013 acceptance（2026-05-07）
>
> 角色：为 `tasks/slices/v3/VS-02-tool-request-result-trace-loop.md` 关闭实现前文档 blocker。本文是 VS-02 的 contract pack，不是 implementation plan，不授权代码实现。

---

## 1. Scope

VS-02 只证明工具调用 provenance 的最小闭环：

```text
accepted OrchestratorDecision
→ CapabilityRegistryEntry lookup
→ ToolRequest
→ ToolResult
→ ToolTrace
→ DecisionTrace
→ replay / audit proof
```

VS-02 不实现 production write、不冻结完整 adoption boundary、不定义 UI action schema、不要求持久化 trace store。

---

## 2. CapabilityRegistryEntry 最小 Schema 草案

VS-02 只冻结 Orchestrator 审查和 ToolTrace 回放所需字段。

| Field | Type | Required | VS-02 rule |
|---|---|---:|---|
| `tool_name` | string | yes | 稳定工具名，不能使用 `intent.` namespace |
| `tool_version` | string | yes | contract version，必须进入 ToolRequest / ToolTrace |
| `tool_layer` | enum | yes | `cognitive` / `memory` / `policy` / `creative` / `artifact` / `debug` |
| `input_contract_ref` | string | yes | ToolRequest input 必须匹配 |
| `output_contract_ref` | string | yes | ToolResult output 必须匹配 |
| `read_scopes` | array | yes | grant 不得超出 registry |
| `write_scopes` | array | yes | VS-02 默认为空；非空只能产生 candidate proof |
| `risk_class` | enum | yes | `low` / `medium` / `high` / `critical` |
| `status` | enum | yes | `active` / `experimental` / `disabled` / `deprecated` |
| `trace_level` | enum | yes | 至少支持 `minimal` / `standard` |
| `provider_dependency` | enum | yes | `none` / `llm_provider` / `external_system` |
| `supports_retry` | boolean | yes | 只声明能力，不启动 retry policy |
| `supports_cancellation` | boolean | yes | 只声明能力，不冻结 cancellation lifecycle |
| `budget_profile_ref` | string or null | yes | 可为空；高预算策略留给后续 slice |

VS-02 规则：

1. `status=disabled` 的工具不能被 dispatch。
2. `status=deprecated` 的工具只能作为 replay / compatibility 材料，不能被新 decision 正常选择。
3. `status=experimental` 的工具不能成为 production write 的唯一门禁。
4. ToolTrace 必须记录 registry entry 的 name / version / status snapshot。

---

## 3. ToolRequest 最小 Schema 草案

ToolRequest 是 Execution Orchestrator 批准后形成的具体工具调用请求。

| Field | Type | Required | VS-02 rule |
|---|---|---:|---|
| `tool_request_id` | string | yes | 稳定 id |
| `turn_id` | string | yes | 当前 turn |
| `frame_ref` | string | yes | 来源 DialogueFrame |
| `plan_ref` | string or null | yes | 来源 MicroPlan；reply-only 可为空，VS-02 通常不为空 |
| `decision_ref` | string | yes | 必须引用 accepted OrchestratorDecision |
| `tool_name` | string | yes | 必须存在于 registry |
| `tool_version` | string | yes | 必须匹配 registry entry |
| `input` | object | yes | 必须满足 `input_contract_ref` |
| `read_scope_grants` | array | yes | 不得超出 registry read scopes |
| `write_scope_grants` | array | yes | VS-02 默认为空；非空不得成为 production fact |
| `idempotency_key` | string | yes | 用于重复 dispatch 检测 |
| `trace_policy` | object | yes | 声明 ToolTrace / DecisionTrace 记录要求 |
| `created_at` | timestamp | yes | 用于 replay ordering |

禁止语义：

- 没有 `decision_ref` 的 ToolRequest。
- Planner 直接生成可执行 ToolRequest。
- UI 直接提交 ToolRequest。
- ToolRequest grant 超过 registry 声明。
- ToolRequest 自带 adopted / production write 事实。

---

## 4. ToolResult 最小 Schema 草案

ToolResult 是工具返回的结构化事实，不是作者主消息，也不是状态采纳。

| Field | Type | Required | VS-02 rule |
|---|---|---:|---|
| `tool_result_id` | string | yes | 稳定 id |
| `tool_request_ref` | string | yes | 必须引用 ToolRequest |
| `tool_name` | string | yes | 与 ToolRequest 一致 |
| `status` | enum | yes | `succeeded` / `failed` / `partial` / `cancelled` |
| `output` | object or null | yes | 成功或部分成功时必须满足 `output_contract_ref` |
| `state_delta` | array | yes | 只能是 candidate / tentative / observation |
| `artifact_refs` | array | yes | 默认指向 candidate 或 tentative artifact |
| `errors` | array | yes | 失败原因，必须可被 trace 引用 |
| `warnings` | array | yes | 非阻断风险 |
| `usage` | object | yes | duration / token / provider / external usage 摘要 |
| `trace_refs` | array | yes | 至少包含 ToolTrace ref |
| `completed_at` | timestamp | yes | 用于 replay ordering |

VS-02 真值边界：

1. `status=succeeded` 不代表 production state 已写入。
2. `state_delta` 必须等待 later adoption boundary。
3. ToolResult 不能被直接拼成作者主消息。
4. ToolResult failure 必须仍然生成 ToolTrace。

---

## 5. ToolTrace / DecisionTrace 最小 Policy

VS-02 要求每次工具调用产生 ToolTrace，并被 DecisionTrace 引用。

ToolTrace required facts:

| Fact | Rule |
|---|---|
| registry snapshot | 记录 tool name / version / status / layer |
| decision link | 记录 `decision_ref` |
| request link | 记录 `tool_request_id` |
| result link | 成功、失败、取消都必须记录 |
| contract refs | 记录 input / output contract refs |
| grant summary | 记录 read / write grant 摘要 |
| timing / usage | 记录 duration 与 provider / external usage 摘要 |
| error / warning refs | 失败和警告必须可追踪 |
| adoption boundary | 明确 result 是否未采纳、仅 candidate 或等待后续裁决 |

DecisionTrace required links:

```text
frame_trace
→ micro_plan_trace
→ orchestrator_decision_trace
→ tool_request_trace
→ tool_result_trace
→ turn_result_trace
```

VS-02 replay policy:

- Structural replay 只读取 trace / contract refs / registry version，不重新调用 provider。
- Replay 必须能回答：哪个 decision 批准了哪个 tool、输入输出 contract 是什么、为什么结果没有成为 production fact。
- Provider raw logs 不能替代 ToolTrace 或 DecisionTrace。

---

## 6. Proof 草案

VS-02 implementation plan 必须把这些 proof 转成测试或可运行命令。本文只定义证明目标。

| Proof | Expected assertion |
|---|---|
| no decision no dispatch | 没有 accepted decision 时不能生成 ToolRequest |
| disabled tool rejected | registry disabled 工具不会 dispatch，并留下 decision / trace reason |
| grant scope bounded | ToolRequest read / write grants 不能超出 registry |
| result not adoption | ToolResult succeeded 后仍不产生 production fact |
| failure traced | ToolResult failed / partial / cancelled 都进入 ToolTrace |
| registry version replay | ToolTrace 能指出当时使用的 tool version / contract refs |
| structural replay | replay 不调用 provider，也能重建 decision → request → result |

Suggested tool scenario:

```text
Use a read-only validation or lookup tool approved by VS-01 OrchestratorDecision.
```

这个场景刻意不使用 production write。VS-02 的核心是 provenance 和 replay，而不是业务写入。

---

## 7. ADR-0011 to ADR-0013 Acceptance Review

ADR-0011 can enter Accepted because this pack provides the minimal registry entry and status/version semantics needed by VS-02.

ADR-0012 can enter Accepted because this pack provides the ToolRequest / ToolResult envelope and truth boundary.

ADR-0013 can enter Accepted because this pack provides the minimal ToolTrace / DecisionTrace links required for structural replay.

Acceptance does not authorize code. It only means VS-02 has stable design inputs for a later implementation plan after user approval.

---
