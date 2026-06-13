# VS-00 Reply-only Contract Pack

> 状态：draft for ADR-0001 acceptance（2026-05-07）
>
> 角色：为 `tasks/slices/v3/VS-00-reply-only-dialogue-frame-turn-result-trace.md` 关闭实现前文档 blocker。本文是 VS-00 的 contract pack，不是 implementation plan，不授权代码实现。

---

## 1. Scope

VS-00 只证明 reply-only turn 的最小主链：

```text
AuthorInput
→ DialogueContext
→ primary DialogueFrame
→ reply-only decision summary
→ TurnResult
→ DecisionTrace
```

本文不覆盖：

- `MicroPlan`
- tool dispatch
- durable `BehaviorState`
- adoption / production write
- frontend component implementation
- persistence schema

---

## 2. DialogueFrame 最小 Schema 草案

VS-00 的 `DialogueFrame` schema 只覆盖 reply-only 路径。它必须足够证明“每 turn 必有 frame”，但不提前冻结 v3 全量 frame 字段。

### 2.1 Required Fields

| Field | Type | Required | VS-00 rule |
|---|---|---:|---|
| `schema_version` | string | yes | 固定为 `3.0-draft` 或后续 schema draft version |
| `frame_id` | string | yes | 稳定 id，可被 trace / TurnResult 引用 |
| `turn_id` | string | yes | 绑定当前 author turn |
| `workspace_id` | string | yes | 绑定 workspace |
| `primary` | boolean | yes | VS-00 必须为 `true` |
| `frame_type` | enum | yes | VS-00 允许 reply-only 子集 |
| `source_refs.author_input_ref` | string | yes | 指向本轮 AuthorInput |
| `source_refs.dialogue_context_ref` | string or null | yes | 无上下文时为 null |
| `dialogue_goal.summary` | string | yes | 作者本轮目标摘要 |
| `tool_need.needs_tool` | boolean | yes | VS-00 必须为 `false` |
| `tool_need.reason_code` | enum | yes | 解释为什么不进入 MicroPlan / tool |
| `execution_readiness` | enum | yes | VS-00 只能是 `not_applicable` 或 `not_ready` |
| `author_visible_draft.message` | string | yes | 可进入 TurnResult Builder 的回复草案 |
| `evidence_summary` | object | yes | 只记录可审计摘要，不记录 raw private reasoning |
| `uncertainty` | array | yes | 无不确定性时为空数组 |

### 2.2 VS-00 Enum Subsets

`frame_type` 在 VS-00 中只允许：

| Value | Meaning |
|---|---|
| `casual_reply` | 普通回应，不推进工具或状态 |
| `creative_exploration` | 创作讨论、方向探索或头脑风格交流 |
| `question_answer` | 回答作者关于作品、系统或写作过程的问题 |
| `meta_discussion` | 关于工作台、流程或下一步协作方式的对话 |

`tool_need.reason_code` 在 VS-00 中只允许：

| Value | Meaning |
|---|---|
| `no_tool_needed` | 本轮只需要自然语言回应 |
| `exploratory_only` | 作者在探索方向，尚未要求系统执行 |
| `insufficient_execution_target` | 还没有明确可执行目标，但不需要 durable clarification |
| `user_requested_discussion` | 作者明确要求讨论而非执行 |

`execution_readiness` 在 VS-00 中只允许：

| Value | Meaning |
|---|---|
| `not_applicable` | reply-only 路径，不进入执行判断 |
| `not_ready` | 信息不足或目标不适合执行，但不打开 durable behavior |

### 2.3 Forbidden Semantics

VS-00 `DialogueFrame` 禁止出现：

- `approved`
- `ready_to_execute`
- `production_write_allowed`
- `tool_request`
- `tool_result`
- `adoption`
- raw provider response
- raw private reasoning

如果 Planner draft 中出现这些语义，VS-00 的 envelope validation 必须失败或降级为 safe reply-only recovery。

---

## 3. Reply-only DecisionTrace 最小 Policy

VS-00 要求每个 reply-only turn 至少有一条可回放 trace。trace 可以先作为 application 层记录或 TurnResult 内部引用证明，不要求先落数据库。

### 3.1 Required Trace Shape

| Field | Required | Rule |
|---|---:|---|
| `trace_id` | yes | 稳定 id |
| `turn_id` | yes | 与 `DialogueFrame.turn_id` 一致 |
| `frame_ref` | yes | 指向 primary `DialogueFrame.frame_id` |
| `decision_summary.decision_type` | yes | VS-00 固定为 `reply_only` |
| `decision_summary.no_tool_reason` | yes | 来自 `tool_need.reason_code` |
| `decision_summary.no_behavior_reason` | yes | 说明为什么没有打开 durable behavior |
| `decision_summary.no_write_reason` | yes | 说明为什么没有 production write |
| `turn_result_ref` | yes | 指向本轮 TurnResult |
| `replay_policy.use_recorded_frame` | yes | VS-00 固定为 `true` |
| `replay_policy.recall_provider` | yes | VS-00 固定为 `false` |
| `redaction_level` | yes | 至少区分 `author_safe` / `developer` |

### 3.2 Required Event Order

VS-00 trace 至少记录以下事件顺序：

```text
author_input_received
→ dialogue_context_attached
→ dialogue_frame_validated
→ reply_only_decision_recorded
→ turn_result_emitted
```

`dialogue_context_attached` 可以记录为空上下文，但事件本身必须存在，避免 replay 时无法区分“没有上下文”和“忘记组装上下文”。

### 3.3 Trace Redaction Rule

Author-safe trace summary 可以包含：

- frame type
- dialogue goal summary
- no-tool reason summary
- whether any author action is required

Author-safe trace summary 不可以包含：

- raw provider prompt
- raw provider response
- private chain-of-thought
- hidden policy or credential material
- unredacted memory payload

Developer replay report 可以引用更多 internal refs，但仍不得记录 private reasoning。

---

## 4. TurnResult v3 Reply-only 出口规则

VS-00 不冻结 TurnResult v3 全量 schema，只冻结 reply-only 输出的 truthfulness 规则。

### 4.1 Required Reply-only Semantics

Reply-only TurnResult 必须表达：

| Semantics | Rule |
|---|---|
| canonical output | 本轮对外只通过 TurnResult / Channel response 输出 |
| assistant message | 来自 validated frame draft 或安全 fallback |
| frame summary | 包含 author-safe frame summary 或 frame trace ref |
| trace summary | 包含 author-safe no-tool / no-write explanation |
| available actions | 默认为空，或只包含安全的继续对话动作 |
| phase / status | 表示 completed reply 或 waiting for ordinary author input |
| next action | 表示 no further action 或 continue dialogue |

### 4.2 Forbidden Claims

Reply-only TurnResult 不得宣称：

- 工具已经调用
- 草稿、角色、世界观、章节或 memory 已写入 production state
- candidate 已被 adoption
- durable clarification / confirmation 已打开
- 多步计划已经执行
- UI 可以提交未由 TurnResult 派生的 action

### 4.3 v2 Compatibility Note

实现阶段可以把 VS-00 reply-only semantics 映射到现有 v2 TurnResult 顶层字段，但这只是迁移策略，不表示 v3 复用 v2 schema 全集。

---

## 5. Proof 草案

VS-00 的 implementation plan 必须把以下 proof 写成自动化测试或可运行命令。本文只定义 proof，不写代码。

| Proof | Expected assertion |
|---|---|
| reply-only frame exists | 普通创作讨论输入产生 primary `DialogueFrame` |
| no MicroPlan | `tool_need.needs_tool=false` 时没有 primary `MicroPlan` |
| TurnResult truthfulness | TurnResult 不包含 tool/adoption/write/durable behavior claim |
| trace explains non-execution | DecisionTrace 记录 no-tool、no-behavior、no-write reason |
| replay avoids provider | Replay 使用 recorded frame / trace，不重新调用 provider |
| UI boundary | Channel / API response 不暴露 raw internal frame schema 作为主渲染 contract |

建议测试输入：

```text
我想聊聊这个故事开头的气质，先别写正文，帮我判断应该更悬疑一点还是更温柔一点。
```

该输入是 reply-only，因为作者明确要求讨论方向，不要求写正文、创建候选、调用工具或写入状态。

---

## 6. ADR-0001 Acceptance Review

ADR-0001 可以进入 Accepted 的理由：

1. 冻结范围清楚：每 turn 必有 primary `DialogueFrame`，且 reply-only 也必须 trace。
2. 非目标清楚：不冻结全量 JSON Schema、MicroPlan、OrchestratorDecision、UI card 或 persistence。
3. 已比较 4 个方案，并明确拒绝 Router-first、tool-only frame 和 frame 内含执行批准。
4. 已回连 `00c` 的 contract、invariant、slice 入口和 umbrella 边界。
5. VS-00 已有具体 slice 文件。
6. 本文补齐 VS-00 所需最小 schema / trace policy / TurnResult truthfulness / proof。

Acceptance 不表示可以开始写代码。它只表示 ADR-0001 可以作为 VS-00 implementation plan 的稳定输入。

---

## 7. Remaining Deferred Items

以下问题不阻塞 ADR-0001 Accepted，也不阻塞 VS-00 implementation plan 创建，但会阻塞后续 slice：

| Item | Blocks |
|---|---|
| `MicroPlan` 字段全集和 action enum | VS-01 |
| `OrchestratorDecision` 字段全集和 reason code registry | VS-01 / VS-02 |
| `DecisionTrace` 全量 schema 与持久化策略 | VS-06 |
| TurnResultViewModel v3 字段全集 | VS-05 |
| frontend author-safe trace rendering | VS-05 / VS-06 |
