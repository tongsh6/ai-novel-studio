# ADR-0012：Quality Finding 最小 schema 与 UI 投影

- 状态：Accepted (2026-04-25)
- 日期：2026-04-25
- 涉及范围：Domain 子系统 31（Novel Quality Gates）/ Foundation 子系统 11（UX Contract）/ UI 阶段 42、46
- 相关文档：
  - `../31-novel-quality-gates.md` §9 / §10 / §11
  - `../29-design-integrity-review.md` §7.1 第 12 条
  - `../39-ui-design-implementation-plan.md` §4.2
  - `0002-state-enums.md`
  - `0006-card-action-schema.md`
- 取代：无
- 取代者：无

---

## 背景

`29-design-integrity-review.md` §7.1 第 12 条将 `quality finding` 最小 schema、默认 severity / action 枚举与 adoption / checkpoint 映射列为 UI 前 Blocking 项。

`31-novel-quality-gates.md` 已定义 `quality_finding` 的草案模型，但在本 ADR 之前它仍不是 ADR 级冻结 contract。若不收口，`42-card-system.md` 与 `46-state-and-feedback.md` 会被迫自行决定 quality warning / finding card 的字段、严重度和动作语义。

本 ADR 只冻结 UI 与运行时投影所需的最小质量发现 contract，不冻结 validator 算法、质量评分模型或最终持久化 schema。

---

## 考虑过的方案

### 方案 A：只引用 `31` 草案，不新增 ADR

优点：改动最小。

缺点：无法解除 `29 §7.1` 的 Blocking 强度；UI 仍无法判断哪些字段可作为稳定 contract 消费。

### 方案 B：冻结 `quality_finding` 最小字段 + severity/action + UI 映射

优点：关闭 UI 前阻塞项，同时保留 quality gate 算法和完整 validator schema 的演化空间。

缺点：需要明确 action 不是 runtime `NextAction`，避免 UI 误用。

### 方案 C：冻结完整质量门 JSON Schema 和所有 validator 输出

优点：实现最少猜测。

缺点：过早绑定领域质量算法，超出 UI 前冻结包范围。

---

## 最终决策

选择 **方案 B：冻结 `quality_finding` 最小字段 + severity/action + UI 映射**。

本 ADR 冻结：

1. `quality_finding` 最小字段集。
2. `source_type` 最小枚举。
3. `severity` 最小枚举。
4. `action` 最小枚举。
5. `quality_finding.action` 到 policy / runtime effect / common card 的最小映射。
6. quality finding 与 adoption、checkpoint、Experience Engine 的边界。

本 ADR 显式不冻结：

1. 各 quality gate 的最终 validator 算法。
2. 评分模型、置信度算法和自动修复策略。
3. `quality_gate` 注册表完整 schema。
4. UI 文案、颜色、图标和布局。

---

## 决策内容

### 1. `quality_finding` 最小字段集

`quality_finding` 是一次 quality gate 运行后产生的结构化结果。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `quality_finding_id` | string | 是 | finding 唯一 id |
| `quality_gate_ref` | string | 是 | 触发该 finding 的 `quality_gate.<name>` 引用 |
| `source_ref` | string | 是 | 被检查来源对象引用 |
| `source_type` | enum | 是 | 来源对象类型，取值见 §2 |
| `source_task_ref` | string/null | 否 | 关联 long-run task 或普通 task |
| `source_turn_ref` | string/null | 否 | 关联 turn |
| `target_scope_ref` | string | 是 | finding 影响的作品 / 卷 / 章 / 场景 / 对象 scope |
| `severity` | enum | 是 | 严重程度，取值见 §3 |
| `action` | enum | 是 | 建议处理动作，取值见 §4 |
| `summary` | string | 是 | UI 可直接展示的简短说明 |
| `evidence_refs` | string[] | 是 | 证据引用；可为空数组但字段必须存在 |
| `affected_object_refs` | string[] | 是 | 受影响对象引用；可为空数组但字段必须存在 |
| `can_override` | boolean | 是 | 该 finding 本身是否允许被用户覆盖；仍受 approval policy 与 authority/revision 约束 |
| `created_at` | string (ISO 8601) | 是 | 创建时间 |

`source_ref` 是 canonical 来源引用；不得另设 `source_artifact_ref` 作为同义字段。

### 2. `source_type` 最小枚举

`source_type` 至少支持：

- `ARTIFACT`
- `DRAFT`
- `OUTLINE_OBJECT`
- `MAINTENANCE_RESULT`
- `ADOPTION_PROPOSAL`
- `OBJECT_MUTATION_PROPOSAL`
- `DIRECT_VALIDATOR_RUN`

新增 `source_type` 必须由对应 Domain contract 或后续 ADR 明确来源对象。

### 3. `severity` 最小枚举

`severity` 至少支持：

- `INFO`
- `WARN`
- `ERROR`
- `CRITICAL`

`severity` 表示风险强度，不直接决定 runtime `NextAction`。最终是否阻断、确认或 checkpoint 由 `action` + approval / policy 层共同决定。

### 4. `action` 最小枚举

`quality_finding.action` 至少支持：

- `WARN`
- `RETRY`
- `CONFIRM`
- `BLOCK`
- `ADOPTION_REVIEW`
- `CHECKPOINT`

`quality_finding.action` 是 Domain policy decision，不是 ADR-0002 runtime `NextAction`。

### 5. Runtime / UI 投影映射

| `quality_finding.action` | policy / runtime effect | common card |
| --- | --- | --- |
| `WARN` | proceed with warning | `warning_card` / `adoption_card` |
| `RETRY` | retry policy | `progress_card` / `failure_card` |
| `CONFIRM` | approval `CONFIRM_BEFORE_EXECUTE` -> NextAction `CONFIRM_BEFORE_EXECUTE` | `confirmation_card` |
| `BLOCK` | block adoption or execution until correction / branch | `failure_card` / `warning_card` |
| `ADOPTION_REVIEW` | approval `ADOPTION_REQUIRED` -> NextAction `ADOPT_ARTIFACTS` | `adoption_card` |
| `CHECKPOINT` | task enters `CHECKPOINT` -> NextAction `RESUME_TASK` | `checkpoint_card` |

本 ADR 不新增 `next_action`、`card_type` 或 `action_type`。UI 必须复用 ADR-0002 与 ADR-0006 已冻结集合。

### 6. Adoption / checkpoint 边界

1. `quality_finding` 不直接修改 artifact 或 authoritative object。
2. quality gate 不直接把 artifact 变成 accepted。
3. finding 可进入 adoption card 的 risk / evidence 列表。
4. `BLOCK` finding 不可被静默采纳；必须经过 correction、branch、重新生成或明确 policy 处理。
5. `CHECKPOINT` finding 可触发 task checkpoint，但 checkpoint 期间产物仍必须走 adoption boundary。

### 7. Experience Engine 输入边界

`quality_finding` 可以作为 `experience_evidence` 的来源，但不能自动生成 `experience_rule`。经验提炼仍遵守 ADR-0014 的 evidence -> artifact -> review/adoption -> rule 流程。

---

## 影响

### 对 Domain 的影响

1. `31-novel-quality-gates.md` §9 的 `quality_finding` 草案升级为 ADR 冻结最小 contract。
2. quality gate 算法仍可后续演进，但输出到 UI / adoption / checkpoint 的最小字段不可随意漂移。

### 对 UI 的影响

1. `42-card-system.md` 可稳定设计 quality warning / finding 相关 card。
2. `46-state-and-feedback.md` 可稳定映射 warning、retry、block、checkpoint 等反馈。
3. UI 不得把 `quality_finding.action` 当作 runtime `NextAction`。

### 对 Foundation 的影响

无新增 Foundation runtime 枚举；只复用既有 state、next_action、card/action contract。

---

## 回写目标

本 ADR Accepted 后需回写：

1. `adr/0000-index.md` §2.1 / §5：新增 ADR-0012。
2. `00-overview.md` §7：新增 D2 条目。
3. `29-design-integrity-review.md` §7.1 第 12 条：标记已冻结。
4. `30-contract-glossary.md` §10：追加本 ADR 硬骨。
5. `31-novel-quality-gates.md`：标注 `quality_finding` 最小 schema 已由本 ADR 冻结。
6. `39-ui-design-implementation-plan.md` §4：移入已冻结输入。

---

## 后续工作

1. 在 schema 文件中为 `quality_finding` 建立 `$id`。
2. 在 contract tests 中验证 `quality_finding.action` 不直接作为 `next_action` 输出。
3. 在 UI 设计阶段细化 warning / failure / adoption card 的视觉呈现。

## enforced_by

- （pending — quality finding 尚未实现）
