# ADR-0014：Experience Objects UI 投影与上下文边界

- 状态：Accepted (2026-04-25)
- 日期：2026-04-25
- 涉及范围：Domain 子系统 33（Experience Engine）/ Domain 子系统 26（Context Assembly Policy）/ UI 阶段 43、46
- 相关文档：
  - `../33-experience-engine.md` §7 / §9 / §10 / §11 / §14
  - `../26-context-assembly-policy.md`
  - `../29-design-integrity-review.md` §7.1 第 14 条
  - `../39-ui-design-implementation-plan.md` §4.2
  - `0012-quality-finding-ui-projection.md`
  - `0013-approval-policy-record-ui-projection.md`
- 取代：无
- 取代者：无

---

## 背景

`29-design-integrity-review.md` §7.1 第 14 条将 `experience_evidence / experience_artifact / experience_rule` 最小 schema，以及 experience rule 进入 context assembly 的控制规则列为 UI 前 Blocking 项。

Experience Engine 的目标是沉淀作者修改、采纳、否决、质量门结果与章节复盘，但它不能直接污染 `writing_preferences` 或 authoritative state。UI 若没有冻结边界，很容易把原始证据、经验草稿和已采纳规则混成一个“偏好面板”。

本 ADR 冻结 experience 三类对象的最小字段、UI 呈现边界与进入上下文的控制规则。

---

## 考虑过的方案

### 方案 A：首批 UI 不展示 experience

优点：最简单。

缺点：无法支持 `39` 中结构面板 / 状态反馈对 experience 的最小占位和可解释需求，也无法关闭 `29 §7.1` 阻塞项。

### 方案 B：冻结三类 experience object 最小字段 + UI 只读/可操作边界 + context 控制规则

优点：解除阻塞，同时避免经验自动污染长期偏好或 prompt。

缺点：需要明确哪些内容只是 evidence、哪些才能作为 rule 生效。

### 方案 C：冻结完整经验学习系统

优点：后续实现确定性最高。

缺点：过早绑定经验提炼算法和策略引擎，超出 UI 前冻结范围。

---

## 最终决策

选择 **方案 B：冻结三类 experience object 最小字段 + UI 只读/可操作边界 + context 控制规则**。

本 ADR 冻结：

1. `experience_evidence` 最小字段集。
2. `experience_artifact` 最小字段集。
3. `experience_rule` 最小字段集。
4. evidence / artifact / rule 的 UI 呈现边界。
5. experience rule 进入 context assembly 的最小控制规则。
6. experience 与 adoption / approval / quality finding 的关系。

本 ADR 显式不冻结：

1. 经验聚类、提炼、评分算法。
2. 完整 experience rule 类型全集。
3. Prompt / capability 策略经验的最终执行格式。
4. UI 视觉布局与文案。

---

## 决策内容

### 1. `experience_evidence` 最小字段集

`experience_evidence` 表示原始证据引用，不是可直接执行的经验规则。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `evidence_id` | string | 是 | evidence 唯一 id |
| `evidence_type` | enum/string | 是 | 证据类型，如 edit、accepted artifact、discarded artifact、quality finding、approval record |
| `source_ref` | string | 是 | 原始来源引用 |
| `work_ref` | string | 是 | 所属作品 |
| `anchor_type` | string | 是 | 锚点类型，如 work / volume / chapter / scene / character |
| `anchor_ref` | string | 是 | 锚点引用 |
| `signal` | object/string | 是 | 证据信号摘要 |
| `created_at` | string (ISO 8601) | 是 | 创建时间 |

UI 默认将 evidence 作为只读审计 / 解释材料，不提供“直接应用为偏好”的动作。

### 2. `experience_artifact` 最小字段集

`experience_artifact` 表示系统从证据中提炼出的经验草稿，默认仍需 review / adoption。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `artifact_id` | string | 是 | artifact 唯一 id |
| `artifact_type` | enum/string | 是 | 经验草稿类型 |
| `source_evidence_refs` | string[] | 是 | 来源 evidence 列表 |
| `work_ref` | string | 是 | 所属作品 |
| `scope_ref` | string | 是 | 适用 scope |
| `candidate_rule` | object/string | 是 | 候选规则内容 |
| `confidence` | number/string | 是 | 置信度表达；具体算法 deferred |
| `risk` | enum/string | 是 | 风险等级；可映射 approval policy |
| `requires_adoption` | boolean | 是 | 是否需 adoption |
| `status` | enum/string | 是 | artifact 当前状态；不得绕过 adoption 7 态语义 |
| `created_at` | string (ISO 8601) | 是 | 创建时间 |

UI 可把高置信或高影响 artifact 投影为 `adoption_card` / `warning_card` / `result_card`，但不得把 artifact 当作已生效偏好。

### 3. `experience_rule` 最小字段集

`experience_rule` 表示已采纳、可用于后续创作的经验规则。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `rule_id` | string | 是 | rule 唯一 id |
| `rule_type` | enum/string | 是 | 规则类型 |
| `work_ref` | string | 是 | 所属作品 |
| `scope_ref` | string | 是 | 适用 scope |
| `rule_text` | string | 是 | 可解释规则文本 |
| `applies_to_intent_families` | string[] | 是 | 适用 intent family |
| `priority` | number/string | 是 | 上下文装配优先级 |
| `status` | enum/string | 是 | active / disabled / superseded / archived 等生命周期状态 |
| `source_artifact_ref` | string | 是 | 来源 experience artifact |
| `created_at` | string (ISO 8601) | 是 | 创建时间 |
| `updated_at` | string (ISO 8601) | 是 | 更新时间 |

只有 `experience_rule` 可以进入默认上下文候选池；evidence 和 artifact 不得默认进入 prompt。

### 4. UI 呈现边界

| 对象 | 默认 UI 呈现 | 可操作性 |
| --- | --- | --- |
| `experience_evidence` | 只读证据、解释来源、审计详情 | 不可直接采纳为长期偏好 |
| `experience_artifact` | 待审经验建议、风险提示、adoption 候选 | 可 accept / edit_then_accept / discard，动作走 adoption boundary |
| `experience_rule` | 已启用 / 已禁用 / 已归档规则列表，显示来源与适用范围 | 可禁用、归档、supersede；高影响修改需 approval / adoption |

Experience Engine 通常不应打扰主工作流。只有以下情况需要显式 UI：

1. 有高置信经验建议采纳。
2. 某类错误多次复发。
3. long-run resume 前需要应用新经验。
4. 用户打开经验面板。
5. 系统建议把经验并入 `writing_preferences`。

### 5. Context assembly 控制规则

experience rule 可进入 Executor / LongRunner / Validator 上下文，但必须受 Context Assembly Policy 控制。

最小规则：

1. 默认只允许 `status=active` 的 `experience_rule` 进入上下文候选。
2. `experience_artifact` 只能在 review / adoption / debug 场景进入上下文，不得默认进入执行上下文。
3. `experience_evidence` 只能在需要 explainability、review 或诊断时进入上下文。
4. context assembly 必须按 `applies_to_intent_families`、`scope_ref`、`priority` 过滤。
5. 高风险 rule（改变 quality gate 默认策略、high-risk approval policy、长期风格偏好）必须有 adoption / approval 记录后才能进入 active 状态。
6. 原始 diff、discarded artifacts 和 rejected outputs 不得批量塞入 prompt。

推荐上下文顺序仍为：当前任务 brief -> authoritative style / continuity -> relevant experience rules -> recent feedback patches -> raw evidence only when needed。

### 6. 与长期偏好的边界

经验不应直接写入 `writing_preferences`。

推荐路径：

```text
feedback_patch / edits / approvals
  -> experience evidence
  -> experience artifact
  -> review / adoption
  -> adopted experience rule
  -> optional writing_preferences proposal
```

只有当经验稳定、跨多次创作有效，并且作者采纳后，才可提议并入长期偏好。

---

## 影响

### 对 Domain 的影响

1. `33-experience-engine.md` §7 / §11 / §14 的最小对象与 UI 边界升级为 ADR 冻结 contract。
2. Experience Engine 可以消费 quality findings 与 approval records，但不能自动改写 quality gate 或 approval policy。

### 对 UI 的影响

1. `43-structure-panel.md` 可安全展示 experience 面板或只读占位。
2. `46-state-and-feedback.md` 可解释经验来源、经验启用与复发错误。
3. UI 不得把 evidence / artifact / rule 混成同一种“偏好”。

### 对 Context Assembly 的影响

context assembly 必须显式过滤 experience rules，不得默认注入大量 raw evidence。

---

## 回写目标

本 ADR Accepted 后需回写：

1. `adr/0000-index.md` §2.1 / §5：新增 ADR-0014。
2. `00-overview.md` §7：新增 D2 条目。
3. `29-design-integrity-review.md` §7.1 第 14 条：标记已冻结。
4. `30-contract-glossary.md` §10：追加本 ADR 硬骨。
5. `33-experience-engine.md`：标注 experience objects 与 context 边界已由本 ADR 冻结。
6. `39-ui-design-implementation-plan.md` §4：移入已冻结输入。

---

## 后续工作

1. 在 schema 文件中为三类 experience object 建立 `$id`。
2. 在 `26-context-assembly-policy.md` 回写 experience rule 过滤规则。
3. 在 contract tests 中验证 evidence / artifact 不会默认进入 Executor prompt。
