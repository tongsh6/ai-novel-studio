# Contract Glossary v2

> 状态：contract 收口草案
>
> 角色：为 `docs/design-v2` 中 Foundation 与 Domain 文档提供统一命名、字段、状态和 namespace 规则。本文不引入新业务能力，只消除跨文档漂移。

---

## 1. 命名原则

所有 contract 字段、枚举值和 namespace 必须稳定、结构化、可测试。

默认规则：

- 字段名使用 `snake_case`
- enum value 必须由所属 enum family 明确声明命名风格；runtime state / action 默认使用 `UPPER_SNAKE_CASE`，authority scope 等权限能力枚举默认使用 `snake_case`
- registry / catalog namespace 使用小写前缀加点号
- 同一个语义只能有一个 canonical 名称

---

## 2. Revision 字段

### 2.1 `base_revision`

用于 mutation / write request。

含义：

- 本次写入请求基于哪个 authoritative revision 发起
- 写入前必须与当前 authoritative revision 比较

适用对象：

- mutation request
- mutation event
- direct object write proposal

### 2.2 `revision_base`

用于 artifact。

含义：

- 该 artifact 生成时依赖的源 revision
- adoption 前必须拿它和当前 target scope revision 比较

适用对象：

- draft artifact
- maintenance artifact
- child agent returned artifact

### 2.3 `source_revision_refs`

用于派生投影或聚合视图。

含义：

- 该派生对象基于哪些 accepted / authoritative source revisions 生成

适用对象：

- reading projection root
- reader recap
- aggregate summaries

单源场景也应使用列表或 snapshot 对象表达，不再使用单数 `source_revision_ref` 作为 canonical 字段。

---

## 3. Adoption 字段

### 3.1 `requires_adoption`

canonical 字段。

含义：

- 该 artifact 或 proposed change 是否必须经过 adoption boundary 才能进入 authoritative state

不再使用 `adoption_required` 作为 canonical 字段。

### 3.2 adoption lifecycle

artifact adoption 状态至少包括：

- `TENTATIVE`
- `ACCEPTED`
- `EDITED_ACCEPTED`
- `DISCARDED`
- `SUPERSEDED`
- `INVALIDATED`
- `ARCHIVED`

`INVALIDATED` 表示 artifact 前提或适用范围失效，不能再被静默采纳。

---

## 4. Long-Run Budget 字段

long-run task 使用以下 canonical 字段：

- `estimated_budget`
- `consumed_budget`

不再使用裸 `budget` / `consumed` 作为 task contract 的 canonical 字段。

checkpoint、progress card、trace、audit 中引用 long-run 消耗时，也应使用同一组字段或它们的 snapshot ref。

---

## 5. Authority 字段

### 5.1 顶层引用

跨对象传递时使用：

- `authority_scope`

`authority_scope` 是结构化对象或结构化引用，不是扁平字符串。

### 5.2 内部维度

authority 至少包含：

- `capability_scope`
- `write_scope`
- `task_control_scope`
- `budget_override_scope`

### 5.3 `write_scope`

最小枚举：

- `read_only`
- `propose_only`
- `tentative_write`
- `production_write`

不要使用 `read-only` 这类 hyphenated enum。

---

## 6. Behavior 分类

对话行为分为两类：

### 6.1 durable behavior

需要 open / close / resolution 的行为。

至少包括：

- `clarification`
- `confirmation`
- `correction`
- `cancellation`

### 6.2 instant behavior

即时完成、不创建长期等待态的行为。

至少包括：

- `rejection`

instant behavior 可以有 explanation 和 audit，但不强制具备 durable behavior 的 `resolution_ref`。

---

## 7. Namespace 规则

同名业务动作在不同运行层必须显式区分。

### 7.1 intent namespace

格式：

```text
intent.<NAME>
```

示例：

- `intent.SUMMARIZE_CHAPTER`
- `intent.UPDATE_STATE_SNAPSHOT`

### 7.2 hook namespace

格式：

```text
hook.<NAME>
```

示例：

- `hook.SUMMARIZE_CHAPTER`
- `hook.UPDATE_STATE_SNAPSHOT`

### 7.3 capability namespace

格式：

```text
capability.<name>
```

示例：

- `capability.summarize_chapter`
- `capability.update_state_snapshot`

### 7.4 quality gate namespace

格式：

```text
quality_gate.<name>
```

示例：

- `quality_gate.worldrule_conflict`
- `quality_gate.character_logic`

### 7.5 approval policy namespace

格式：

```text
approval_policy.<name>
```

示例：

- `approval_policy.high_risk_canon_change`
- `approval_policy.long_run_budget_gate`

### 7.6 experience rule namespace

格式：

```text
experience_rule.<name>
```

示例：

- `experience_rule.chapter_hook_preference`
- `experience_rule.pacing_pattern`

### 7.7 strategy artifact namespace

格式：

```text
strategy_artifact.<type>
```

示例：

- `strategy_artifact.web_serial_retention`
- `strategy_artifact.payoff_pattern`

---

## 8. Domain Object Set

### 8.1 Asset objects

小说层资产对象至少包括：

- `character`
- `faction`
- `organization`
- `location`
- `relationship`
- `item`
- `ability`

`organization` 不是 `faction` 的隐式 alias。实现可以共享 schema，但 contract 层必须能区分。

### 8.2 Style objects

风格与作者意志对象至少包括：

- `style_sample`
- `writing_preferences`
- `brief`
- `feedback_patch`

`feedback_patch` 是在线反馈的增量对象，不应直接污染长期 `writing_preferences`。

### 8.3 Reading projection objects

阅读投影不是单个对象，而是投影对象族，至少包括：

- `reading_projection_root`
- `reading_projection_toc`
- `reading_projection_chapter`
- `reader_recap`

### 8.4 Quality / approval objects

质量与人工审批对象至少包括：

- `quality_gate`
- `quality_finding`
- `approval_policy`
- `approval_record`

`quality_gate` 是可注册的检查规则；`quality_finding` 是某次检查产生的结构化结果。`approval_policy` 是策略配置，`approval_record` 是用户或系统审批决策的审计记录。

`human_approval_policy` 不作为 canonical object name；需要强调人类审批语义时使用 human-facing approval policy。

### 8.5 Experience objects

经验沉淀对象至少包括：

- `experience_evidence`
- `experience_artifact`
- `experience_rule`

`experience_evidence` 表示原始证据引用；`experience_artifact` 表示待审查经验草稿；`experience_rule` 表示已采纳、可进入后续上下文的经验规则。

### 8.6 Strategy / semi-structured objects

半结构化策略对象至少包括：

- `strategy_artifact`

`strategy_artifact` 可以影响 prompt、validator 或 quality gate，但不能覆盖 authoritative object，不能被当成 canon。

---

## 9. NextAction 与 UI Action 映射

runtime `NextAction` 与 UI `actions` 不是同一层，但必须可映射。

| NextAction | 常见 UI actions |
|---|---|
| `ASK_USER` | `answer` |
| `CONFIRM_BEFORE_EXECUTE` | `confirm`, `reject` |
| `SHOW_RESULT` | none or domain-specific view actions |
| `RETRY_SYSTEM` | `retry` |
| `RESUME_TASK` | `resume`, `cancel`, `branch` |
| `ADOPT_ARTIFACTS` | `accept`, `edit_then_accept`, `discard` |
| `CANCEL_TASK` | `cancel` |
| `NO_FURTHER_ACTION` | none |

UI 不应反向发明新的 runtime `NextAction`。ADR-0002 已冻结 canonical `NextAction` 集合；`EXECUTE_DIRECTLY` 不是 canonical `NextAction`，执行许可由 phase + policy 决定。

---

## 10. 本文冻结的硬骨

1. `requires_adoption` 是 adoption 字段 canonical 名称
2. mutation 使用 `base_revision`，artifact 使用 `revision_base`
3. reading projection 使用 `source_revision_refs`
4. long-run task 使用 `estimated_budget` / `consumed_budget`
5. enum 命名风格由 enum family 显式声明；authority enum 使用 `snake_case`
6. behavior 分为 durable 与 instant
7. intent / hook / capability / quality_gate / approval_policy / experience_rule / strategy_artifact 必须 namespace 化
8. `feedback_patch`、`organization`、reading projection object family、quality / approval objects、experience objects、strategy artifact 都属于 Domain object set
9. adoption 7 态（§3.2）由本文与 ADR-0001（`adr/0001-turn-result-v2-schema.md`）共同作为唯一 canonical 权威；ADR-0002 仅 `$ref` 引用，不重定义。Domain 注入的扩展属性必须使用 `domain_ext.` 前缀。
10. `NextAction` canonical 集合由 ADR-0002 冻结为 8 个值：`ASK_USER`、`CONFIRM_BEFORE_EXECUTE`、`SHOW_RESULT`、`RETRY_SYSTEM`、`RESUME_TASK`、`ADOPT_ARTIFACTS`、`CANCEL_TASK`、`NO_FURTHER_ACTION`。
11. Authority / budget / escalation 最小枚举由 ADR-0003 冻结：`authority_scope` 保持结构化；`write_scope` 使用 `read_only` / `propose_only` / `tentative_write` / `production_write`；budget dimension 使用 `token` / `wall_time` / `cost` / `invocation_count` / `write_count` / `execution_unit_count`；escalation 不把 repeated failure 直接列为 reason。
