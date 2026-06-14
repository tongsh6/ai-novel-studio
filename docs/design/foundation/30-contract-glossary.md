# Contract Glossary

> 状态：v3 体系领域层 · 当前权威（横切契约 · 术语）。归 v3 治理、服从 v3 原则（见 `docs/design/README.md`「整合原则：以 v3 为主体，吸取 v2」）；标题/历史中的 v2 仅为来源标记。v3 主链核心术语见 §0。
>
> 角色：为 `docs/design` 中主链、Foundation 与 Domain 文档提供统一命名、字段、状态和 namespace 规则。本文不引入新业务能力，只消除跨文档漂移。

---

## 0. v3 主链核心术语（spine）

v3 会话结构与执行主链的 canonical 术语。**定义以各源文档/ADR 为准**，本表只给一句话定位与指针，避免漂移。

| 术语 | 一句话 | 权威源 |
|---|---|---|
| `DialogueFrame` | 每个 turn 必有的结构化认知帧（frame_type / dialogue_goal / 执行就绪度等） | `02`、ADR-0001 |
| `MicroPlan` | Planner 向执行层提出的下一步行动建议 envelope（无执行批准权） | `02`、ADR-0002/0003 |
| `OrchestratorDecision` | Execution Orchestrator 的执行裁决 envelope | `04`、ADR-0004 |
| Execution Gate Order | 执行门禁顺序（authority / write_boundary / budget…） | `04`、ADR-0005 |
| `ContextPacket` | 按消费者分型的最小上下文包（planner / tool / ui_trace / replay…） | `06`§5.2 |
| `DialogueContext` | 组装好、可解释 omission 的对话上下文 envelope | `06`§5.3、VS-00B/VS-00C |
| `AIMessageEnvelope` | AI 引导三层契约投影到每次 AI 调用的可重建 message | `00`§2.2、`01`§3.3、VS-00D |
| `TurnResult` | 每个 turn 唯一 canonical 出口 view model | ADR-0015 |
| `DecisionTrace` | turn 决策留痕（可回放；replay 默认不重调 LLM） | ADR-0013、`06` |
| `ConfirmationBinding` | 确认动作与待执行计划的绑定（re-gate） | ADR-0009 |
| `AvailableAction` | UI 可消费的本轮可用动作 | ADR-0007 |
| `BehaviorState` | durable behavior（clarification / confirmation…）状态 | ADR-0008、`05` |
| phase / status | turn 阶段与状态机 | ADR-0006、`05` |

> 与下文关系：§2–§9 是 v2 来源、被 v3 吸取保留的字段/对象/namespace 术语；本 §0 是 v3 主链新增的会话结构与执行术语。两者同属当前 v3 体系。

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
- projection chapter（ADR-0009）

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

#### 3.2.1 合法转换矩阵（canonical，ADR-0019）

> 状态：**Accepted**（ADR-0019，2026-06-14）。本表是 ADR-0019 的 canonical 镜像；冲突以 ADR-0019 为准。管 artifact adoption 7 态，与 `NovelDomain.MemoryItem` 记忆状态机是两套独立状态机。

初始态：`TENTATIVE`（artifact 产出即 tentative，VS-02A / ADR-0010）。

| from | 允许 to |
|---|---|
| `TENTATIVE` | `ACCEPTED`、`EDITED_ACCEPTED`、`DISCARDED`、`INVALIDATED` |
| `ACCEPTED` | `SUPERSEDED`、`INVALIDATED`、`DISCARDED`、`ARCHIVED` |
| `EDITED_ACCEPTED` | `SUPERSEDED`、`INVALIDATED`、`DISCARDED`、`ARCHIVED` |
| `DISCARDED` | `TENTATIVE`（复活）、`ARCHIVED` |
| `SUPERSEDED` | `TENTATIVE`（复活）、`ARCHIVED` |
| `INVALIDATED` | `TENTATIVE`（复活）、`ARCHIVED` |
| `ARCHIVED` | `TENTATIVE`（un-archive 复活） |

不变量（ADR-0019）：进入 `ACCEPTED`/`EDITED_ACCEPTED` 只能来自 `TENTATIVE`，**复活不直接复原 canon，须经 `TENTATIVE` 重新采纳**（保证每个 canon 有可溯采纳决策）；当前有效 canon 只含 `ACCEPTED`/`EDITED_ACCEPTED`；无永久终态（`ARCHIVED` 可 un-archive）；非表中转换在持久化边界一律拒绝；自反转换为合法 no-op。

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
9. adoption 状态由本文、`../contracts/VS-04-adoption-boundary-contract-pack.md` 与当前 schema 共同作为 canonical 权威；Domain 注入的扩展属性必须使用 `domain_ext.` 前缀。
10. `NextAction` canonical 集合由 ADR-0002 冻结为 8 个值：`ASK_USER`、`CONFIRM_BEFORE_EXECUTE`、`SHOW_RESULT`、`RETRY_SYSTEM`、`RESUME_TASK`、`ADOPT_ARTIFACTS`、`CANCEL_TASK`、`NO_FURTHER_ACTION`。
11. Authority / budget / escalation 最小枚举由 ADR-0003 冻结：`authority_scope` 保持结构化；`write_scope` 使用 `read_only` / `propose_only` / `tentative_write` / `production_write`；budget dimension 使用 `token` / `wall_time` / `cost` / `invocation_count` / `write_count` / `execution_unit_count`；escalation 不把 repeated failure 直接列为 reason。
12. Volume / arc 关系由 ADR-0004 冻结为 `volume -> arc -> chapter -> scene`；`volume` 是 canonical middle-structure parent 与 reading projection TOC 一级来源，`arc` 是 volume-local story-planning unit，不跨 volume。跨卷故事线通过 strategy artifact / motif / foreshadowing / secondary view 表达。
13. Behavior-specific UI hint 最小 schema 由 ADR-0005 冻结，承载于 `behavior_state.active.ui_hint` 与 `behavior_state.history[].ui_hint`；只表达 clarification / confirmation / rejection / cancellation / correction 的用户可见语义材料与 affordance hint，不定义 card/action envelope。
14. Card / action 最小 schema 由 `../07-workbench-ui-contract.md` 与 `../contracts/VS-05-ui-roundtrip-contract-pack.md` 冻结；`ui_cards` 是展示语义，`available_actions` 是唯一可提交动作来源；Domain 扩展使用 `domain_ext.` 前缀；`action_type` / `primary_next_action` 边界清晰，UI 不发明新动作值。
15. Maintenance artifact 与 adoption boundary 由 `../domain/25-maintenance-hooks.md` 与 `../contracts/VS-04-adoption-boundary-contract-pack.md` 约束；暂态产物通过 `candidate_set` 展示，采纳/选择/修订必须由 `available_actions` 回到主链裁决，不恢复旧 `adoption_card` 作为动作来源。
16. 首批 UI intent 最小集合由 ADR-0008（`adr/0008-first-batch-intents.md`）冻结，覆盖立项 / 世界观 / 主线 / 章节 / 场景五阶段、合计 ≤20 个 intent；每个 intent 仅冻结 `intent_name`（namespace `intent.<NAME>`）、family、lifecycle stage、`risk_class`、`confirmation` 默认值、`long_run_fit`；slot schema / capability 映射 / approval_policy_id / prompt / UI 入口分组延后；`hook.<NAME>` 与 `intent.<NAME>` 不得使用同名条目。
17. Reading projection 4 类对象（`reading_projection_root` / `toc` / `chapter` / `reader_recap`）最小字段集由 ADR-0009（`adr/0009-projection-object-schema.md`）冻结；所有对象使用 `source_revision_refs`（§2.3）表达派生来源；projection 内部 `work_ref` 规范化为 `work_id`、`generated_at` 规范化为 `projected_at`；`reader_recap` 与 `chapter_summary`（22-continuity §10）/ aggregate summaries（22-continuity §25）边界清晰，只读 accepted source、不参与维护链路、不进入 context assembly。
18. 首批 UI intent 的最小 slot schema 由 ADR-0010（`adr/0010-first-batch-intent-slot-schema.md`）冻结；每个 `slot_schema_ref` 指向统一 envelope，slot entry 字段与 04 §6.1 对齐；`requiredness` / `inferability` / `defaultability` 沿用 04 §6.2-§6.5；缺失 `required_to_execute` 且不可高置信推断、不可默认的 slot 才触发 clarification；capability mapping / prompt / UI layout / approval_policy_id 仍 deferred。
19. Reading projection refresh 状态与触发语义由 ADR-0011（`adr/0011-projection-refresh-state-triggers.md`）冻结；`reading_projection_root.status` 四态为 `FRESH` / `STALE` / `REBUILDING` / `FAILED`；accepted source 变化与 `intent.REFRESH_READING_PROJECTION` 触发 stale / rebuild；stale 判定由系统基于 `source_revision_refs` 完成，UI 不得自行猜测；不新增 Foundation `next_action` / `card_type` / `action_type`。
20. Quality finding 最小 schema 与 UI 投影由 `../quality/31-novel-quality-gates.md`、`../07-workbench-ui-contract.md` 和 VS-05 共同约束；`quality_finding.action` 是 Domain policy decision，不是 runtime `primary_next_action`；finding 不直接修改 artifact 或 authoritative object，只作为 policy、adoption、checkpoint、UI card 和 Experience Engine 输入。
21. Approval policy / approval record 最小 schema 与 UI 投影由 `../quality/32-human-approval-policy.md`、`../05-turn-behavior-and-state-model.md` 和 VS-03 共同约束；`risk_class` 最小枚举为 `LOW` / `MEDIUM` / `HIGH` / `CRITICAL`；`default_behavior` 必须映射到当前 behavior / available action 语义，但不等同于 `primary_next_action`；bypass 不得覆盖 authority / revision / security / hard consistency conflict。
22. Experience objects UI 投影与上下文边界由 ADR-0014（`adr/0014-experience-ui-context-boundary.md`）冻结；`experience_evidence` 只读、`experience_artifact` 待 review/adoption、`experience_rule` 才可作为上下文候选；evidence / artifact 不得默认进入 Executor prompt。
23. 结构面板字段优先级与渐进披露由 ADR-0015（`adr/0015-structure-panel-field-priority.md`）冻结；首批结构面板对象、三层优先级、L1-L4 渐进披露与 UI 不得自造 schema / 子类型 / 编辑表单的边界已收口。
