# ADR-0007：Maintenance Artifact + Adoption Card Payload 最小 schema

- 状态：Accepted (2026-04-25)
- 日期：2026-04-25
- 涉及范围：Foundation 子系统 11（UX Contract）/ Domain 子系统 25（Maintenance Hooks）/ Domain 子系统 22（Continuity）
- 相关文档：
  - `../25-maintenance-hooks.md` §24 / §25
  - `../30-contract-glossary.md` §2.2 / §3 / §10
  - `../32-human-approval-policy.md` §lines 122-127
  - `../29-design-integrity-review.md` §7.1
  - `0001-turn-result-v2-schema.md`
  - `0002-state-enums.md`
  - `0006-card-action-schema.md`
- 取代：无
- 取代者：无

---

## 背景

`25-maintenance-hooks.md` §24 已正式冻结 7 条 maintenance hook 硬骨（§24 第 1-7 条），其中第 3 条明确"maintenance 结果默认先进入 artifact / pending adoption 层"。但 §25 第 1 条同时声明"各 maintenance artifact 的最终 schema"暂不冻结。

这一空缺产生了三个具体问题：

1. `TurnResult.adoption_state.pending[]` 已由 ADR-0001 冻结 `artifact_adoption_entry` 子结构，但 maintenance artifact 的领域字段（`hook_name`、`proposed_change` 等）没有挂载位置，Domain 实现只能自行发明字段名，导致跨 hook 漂移。
2. ADR-0006 已冻结 `adoption_card` 作为 `card_type` 之一，并冻结 `accept` / `edit_then_accept` / `discard` / `branch` 作为 adoption 相关 `action_type`，但 `adoption_card` 的 `payload` 形状尚未定义，UI 无法稳定渲染 maintenance adoption 决策卡片。
3. `32-human-approval-policy.md` §lines 122-127 已给出 `risk_class`（`LOW` / `MEDIUM` / `HIGH` / `CRITICAL`）的最小分类，但 maintenance artifact 没有字段槽位承载该值，"低风险自动 adoption"的判定入口无处落地。

`29-design-integrity-review.md` §7.1 第 9 条把"maintenance artifact schema"列为 UI 设计前必须冻结的项目。本 ADR 的任务是：在不重定义任何已冻结 canonical 字段的前提下，给出 `maintenance_artifact` 的最小字段集合与 `adoption_card` payload 的最小形状，并为 `risk_class` 留出字段槽位。

---

## 考虑过的方案

### 方案 A：只在 `artifact_adoption_entry` 上追加 `domain_ext.` 扩展字段，不新增独立 schema

优点：改动最小，完全在 ADR-0001 已有扩展点内操作，不需要新 ADR。

缺点：
- `domain_ext.` 前缀约束（ADR-0001 §影响）要求扩展属性不得污染 Foundation 公共字段，但 `hook_name` / `proposed_change` / `risk_class` 是 Domain 层所有 maintenance hook 共享的结构化字段，不是单个 hook 的私有扩展，放在 `domain_ext.` 下会让跨 hook 的字段名无法统一。
- `adoption_card` 的 `payload` 形状仍然未定义，UI 无法稳定消费。
- 无法给 `risk_class` 一个可被契约测试 lint 的 canonical 位置。

### 方案 B：冻结 `maintenance_artifact` 最小字段集合 + `adoption_card` payload 形状，`risk_class` 只留字段不定策略

优点：
- 给 Domain 实现提供统一字段名，消除跨 hook 漂移。
- 闭合 ADR-0006 `adoption_card` 的 `payload` 引用目标。
- 为 `risk_class` 提供 canonical 槽位，不预设自动 adoption 策略，符合 §25 第 4 条"暂不冻结"的边界。
- 不重定义任何已冻结字段（`requires_adoption` / `adoption_state` 7 态 / `revision_base` 均 `$ref` 已有权威）。

缺点：需要新 ADR，增加文档维护成本；但这正是 §29.7.1 第 9 条要求的。

### 方案 C：同时冻结 `maintenance_artifact` schema + 自动 adoption 决策策略 + hook 执行顺序

优点：一次性把 §25 所有暂不冻结项全部收口。

缺点：
- 违反 §25 §25 第 2-4 条"本文暂不冻结"的边界声明。
- 自动 adoption 策略涉及 `32-human-approval-policy.md` 的 `default_behavior` 映射，属于 W9 之后的工单范围。
- hook 执行顺序与去重属于运行时实现细节，不是 schema 问题。
- 过早绑定策略会让后续 W9 工单无法独立演化。

---

## 最终决策

选择 **方案 B：冻结 `maintenance_artifact` 最小字段集合 + `adoption_card` payload 形状，`risk_class` 只留字段不定策略**。

本 ADR 冻结：

1. `maintenance_artifact` 的最小公共字段集合（`hook_name` / `revision_base` / `proposed_change` / `requires_adoption` / `adoption_status` / `risk_class` / `auto_adoption_hint`）。
2. `adoption_card` payload 的最小形状（作为 ADR-0006 `card_type = adoption_card` 的 `payload` 子结构）。
3. `maintenance_artifact` 在 `TurnResult.adoption_state.pending[]` / `resolved[]` 中的挂载纪律。
4. `risk_class` 字段的 canonical 槽位与取值集合（`$ref` 32 §lines 122-127）。
5. `auto_adoption_hint` 字段的 canonical 槽位（boolean，只留位置，不定策略）。

本 ADR 显式不冻结（deferred）：

1. **具体 auto-adoption 决策策略**：哪些条件触发自动 adoption，由后续 W9 工单与 `32-human-approval-policy.md` 联合冻结。
2. **hook 执行顺序、去重、失败回滚**：已在 `25-maintenance-hooks.md` §24 第 6 条冻结"失败必须显式处理"原则，具体实现不在本 ADR scope。
3. **adoption state 7 态本体语义**：由 `30-contract-glossary.md` §3.2 与 ADR-0001 共同权威，本 ADR 仅 `$ref`，不重定义。
4. **各 maintenance hook 的领域算法**：伏笔扫描、状态聚合、章节摘要生成等领域算法不在本 ADR scope。

---

## 决策内容

### 1. 挂载位置

`maintenance_artifact` 不新增 `TurnResult` 顶层字段。它通过 ADR-0001 已有的 `adoption_state.pending[]` / `adoption_state.resolved[]` 挂载，`artifact_type` 字段填写 `maintenance_artifact`（Domain 注册类型）。

```text
TurnResult.adoption_state.pending[]
  -> artifact_adoption_entry (ADR-0001 §2)
       artifact_type = "maintenance_artifact"
       + maintenance_artifact payload (本 ADR §2)

TurnResult.ui_cards[]
  -> ui_card (ADR-0006 §2)
       card_type = "adoption_card"
       payload -> adoption_card_payload (本 ADR §3)
```

`maintenance_artifact` 的领域字段通过 `artifact_adoption_entry.domain_ext.maintenance` 子对象注入，遵守 ADR-0001 `domain_ext.` 前缀约束。

### 2. `maintenance_artifact` 最小公共字段

以下字段定义在 `artifact_adoption_entry.domain_ext.maintenance` 子对象内：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `hook_name` | string | 是 | 产出本 artifact 的 hook 标识，使用 `hook.<NAME>` namespace（`30 §7.2`）；例如 `hook.SUMMARIZE_CHAPTER` |
| `revision_base` | string/null | 是 | artifact 生成时依赖的源 revision（`30 §2.2` canonical 字段名）；adoption 前必须与当前 target scope revision 比较；不得使用 `base_revision` |
| `proposed_change` | object | 是 | 结构化变更提案；最小形状见 §2.1；具体领域字段由各 hook 扩展 |
| `requires_adoption` | boolean | 是 | 该 artifact 是否必须经过 adoption boundary（`30 §3.1` canonical 字段名）；不得使用 `adoption_required` |
| `adoption_status` | enum | 是 | artifact 当前 adoption 状态；canonical 字段名沿用 ADR-0001 §2 `artifact_adoption_entry.adoption_status`（line 318），不与 `TurnResult.adoption_state` 容器名混用；取值集合 `$ref` `30 §3.2`：`TENTATIVE` / `ACCEPTED` / `EDITED_ACCEPTED` / `DISCARDED` / `SUPERSEDED` / `INVALIDATED` / `ARCHIVED`；由 ADR-0001 + `30 §3.2` 共同权威，本 ADR 不重定义 |
| `risk_class` | enum | 是 | 风险等级；取值集合 `$ref` `32 §lines 122-127`：`LOW` / `MEDIUM` / `HIGH` / `CRITICAL`；只声明字段位置，不定自动 adoption 策略 |
| `auto_adoption_hint` | boolean | 否 | 产出方对"本 artifact 是否适合自动 adoption"的提示；true 不等于系统会自动 adoption，策略由后续 W9 工单冻结 |
| `target_scope_ref` | string/null | 否 | 本 artifact 拟写入的目标对象引用（如 chapter_id / scene_id）；用于 adoption 前 revision 比较定位 |
| `validator_findings` | object[]/null | 否 | maintenance validator 的结构化校验结果摘要；详细 schema 由后续 ADR 冻结，本 ADR 只留字段位置 |

约束：

1. `hook_name` 必须使用 `hook.<NAME>` namespace，不得使用裸字符串（`30 §7.2`）。
2. `revision_base` 不得使用 `base_revision`（`30 §2.2` 已固化：mutation 用 `base_revision`，artifact 用 `revision_base`）。
3. `requires_adoption` 不得使用 `adoption_required`（`30 §3.1` 已固化）。
4. `adoption_status` 取值必须严格来自 `30 §3.2` 7 态，不得新增枚举值。
5. `risk_class` 取值必须严格来自 `32 §lines 122-127` 4 级，不得新增枚举值。
6. `auto_adoption_hint = true` 不授权系统跳过 adoption boundary；策略决定权在后续 W9 工单。

#### 2.1 `proposed_change` 最小形状

`proposed_change` 是结构化变更提案的公共 envelope，各 hook 在此基础上扩展领域字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `change_type` | string | 是 | 变更类型；建议使用 `hook.<NAME>` 同族命名；例如 `hook.SUMMARIZE_CHAPTER` 产出的 `proposed_change.change_type` 为 `chapter_summary` |
| `target_object_type` | string | 是 | 拟写入的目标对象类型；例如 `chapter_summary` / `state_snapshot` / `foreshadowing_entry` |
| `diff_summary` | string | 是 | 用户可见的变更摘要；用于 `adoption_card` 的 `summary` 字段投影 |
| `payload` | object/null | 否 | 领域字段扩展；各 hook 自定义；不得污染公共 envelope 字段 |

### 3. `adoption_card` payload 最小形状

`adoption_card` 是 ADR-0006 §3 已冻结的 `card_type`，其 `payload` 形状由本 ADR 冻结。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `artifact_id` | string | 是 | 对应 `artifact_adoption_entry.artifact_id`；用于 action 回传定位 |
| `artifact_type` | string | 是 | 对应 `artifact_adoption_entry.artifact_type`；maintenance artifact 填 `maintenance_artifact` |
| `hook_name` | string | 是 | 产出 artifact 的 hook 标识（`hook.<NAME>` namespace）；与 `domain_ext.maintenance.hook_name` 一致 |
| `revision_base` | string/null | 是 | 与 `domain_ext.maintenance.revision_base` 一致；UI 可用于展示"基于哪个版本生成" |
| `risk_class` | enum | 是 | 与 `domain_ext.maintenance.risk_class` 一致；UI 可据此调整视觉语义（`warning` / `success` style_hint） |
| `auto_adoption_hint` | boolean | 否 | 与 `domain_ext.maintenance.auto_adoption_hint` 一致；UI 可据此决定是否默认高亮"接受"按钮 |
| `diff_summary` | string | 是 | 来自 `proposed_change.diff_summary`；作为 `adoption_card.summary` 的主要内容来源 |
| `target_object_type` | string | 是 | 来自 `proposed_change.target_object_type`；UI 可据此展示"将更新哪类对象" |

约束：

1. `adoption_card` 的 `actions[]` 必须包含 ADR-0006 §5 已冻结的 adoption 相关 `action_type`：`accept` / `edit_then_accept` / `discard`；`branch` 为可选。
2. `adoption_card` 的 `refs.artifact_refs[]` 必须包含对应 `artifact_id`。
3. `adoption_card` 的 `payload` 不得重定义 ADR-0006 card 公共字段（`card_id` / `card_type` / `title` / `summary` / `status` / `actions` / `refs` / `priority` / `visibility`）。
4. `adoption_card` 的 `style_hint` 建议：`risk_class = LOW` 时使用 `success`；`risk_class = HIGH` / `CRITICAL` 时使用 `warning`；`risk_class = MEDIUM` 时使用 `neutral`。此为建议，不冻结视觉系统。

### 4. 与 ADR-0006 `next_action = ADOPT_ARTIFACTS` 的映射

`next_action = ADOPT_ARTIFACTS`（ADR-0002 canonical 值）触发时，`TurnResult.adoption_state.pending[]` 中 `requires_adoption = true` 的 maintenance artifact 必须在 `ui_cards[]` 中有对应 `adoption_card`。

| next_action | 对应 card_type | 对应 action_type |
| --- | --- | --- |
| `ADOPT_ARTIFACTS` | `adoption_card` | `accept`, `edit_then_accept`, `discard`, `branch`（可选） |

约束：

1. 不得新增 ADR-0002 `next_action` 枚举值。
2. `requires_adoption = false` 的 maintenance artifact 不强制产出 `adoption_card`；是否展示由 UI 策略决定。
3. `auto_adoption_hint = true` 且 `risk_class = LOW` 的 artifact，系统可在后续 W9 策略冻结后决定是否跳过 `adoption_card`；本 ADR 不预设该行为。

### 5. 与 `25-maintenance-hooks.md` §24 硬骨的对应关系

`25 §24` 冻结的 7 条硬骨与本 ADR 字段的对应关系：

| 25 §24 硬骨 | 本 ADR 对应字段 / 约束 |
| --- | --- |
| 第 1 条：maintenance hook 是正文链路的正式后处理层 | `hook_name` 使用 `hook.<NAME>` namespace，与正文 intent 链路区分 |
| 第 2 条：默认维护 hook 至少包括章节摘要、状态更新、伏笔扫描、伏笔回收、时间线记录 | `hook_name` 枚举由 Domain 注册，本 ADR 不穷举；`proposed_change.change_type` 区分各 hook 产物类型 |
| 第 3 条：maintenance 结果默认先进入 artifact / pending adoption 层 | 挂载在 `TurnResult.adoption_state.pending[]`，`adoption_status = TENTATIVE` |
| 第 4 条：maintenance validator 是独立校验层 | `validator_findings` 字段留位置，详细 schema deferred |
| 第 5 条：scene 级维护结果通常先作为 provisional continuity | `target_scope_ref` 区分 scene / chapter 级目标；聚合算法 deferred |
| 第 6 条：maintenance 失败、漂移和冲突必须显式处理 | `adoption_status = INVALIDATED` 表示前提失效；`validator_findings` 承载冲突信息 |
| 第 7 条：hook 不替代显式维护 intent；二者并存 | `hook_name` namespace 与 `intent.<NAME>` namespace 显式区分（`30 §7.1` / `30 §7.2`） |

---

## 决策原因

1. **为什么选方案 B 而非方案 A**：`domain_ext.` 扩展点设计用于单个 hook 的私有字段，不适合承载跨 hook 共享的结构化字段（`hook_name` / `risk_class` / `auto_adoption_hint`）。共享字段需要 canonical 位置才能被契约测试 lint。

2. **为什么选方案 B 而非方案 C**：`25 §25` 第 4 条明确"哪些低风险维护结果可自动 adoption 的最终策略"暂不冻结。提前冻结策略会让后续 W9 工单失去独立演化空间，也会与 `32-human-approval-policy.md` 的 `default_behavior` 映射产生双权威源风险。

3. **为什么 `risk_class` 只留字段不定策略**：`risk_class` 的取值集合已由 `32 §lines 122-127` 固化（`LOW` / `MEDIUM` / `HIGH` / `CRITICAL`），字段槽位是 schema 问题；但"LOW 风险是否自动 adoption"是策略问题，属于 W9 工单范围。二者必须分离。

4. **为什么 `adoption_card` payload 需要冗余部分字段**：`adoption_card.payload` 中的 `hook_name` / `revision_base` / `risk_class` 与 `domain_ext.maintenance` 中的同名字段语义一致，但 card payload 是 UI 消费的只读投影，不是写入路径。冗余是为了让 UI 不需要跨越 `artifact_adoption_entry` 和 `ui_card` 两个对象才能渲染一张卡片。

5. **为什么不新增 `TurnResult` 顶层字段**：ADR-0001 §影响明确"Domain 禁止扩展顶层字段"；`adoption_state.pending[]` 已是 maintenance artifact 的正确挂载位置。

---

## 影响

### 对 Foundation 的影响

- 闭合 ADR-0001 `artifact_adoption_entry` 在 maintenance artifact 场景下的 `domain_ext.` 扩展使用方式。
- 闭合 ADR-0006 `adoption_card` 的 `payload` 引用目标。
- 不新增 TurnResult 顶层字段，不新增 ADR-0002 `next_action` 枚举值，不新增 ADR-0006 `card_type` 或 `action_type`。

### 对 Domain 的影响

- Domain 实现 maintenance hook 时，必须按本 ADR §2 字段集合填写 `domain_ext.maintenance` 子对象，不得自行发明 `hook_name` / `revision_base` / `requires_adoption` 的别名。
- 各 hook 的领域字段通过 `proposed_change.payload` 扩展，不得污染公共 envelope。
- `risk_class` 必须由各 hook 实现方填写，不得省略（必填）。

### 对 UI 的影响

- UI 可依赖 `adoption_card.payload`（本 ADR §3）稳定渲染 maintenance adoption 决策卡片，不需要跨对象拼接字段。
- `risk_class` 为 UI 提供视觉语义提示（`warning` / `success` / `neutral` style_hint 建议），但不冻结视觉系统。
- `auto_adoption_hint` 为 UI 提供"是否默认高亮接受按钮"的提示，但最终 UI 行为由 UI 设计阶段决定。

### 必须回写的文档（不在本 ADR 内修改，列为后续工作）

1. `00-overview.md` §7：新增 D2-023「maintenance artifact + adoption card payload 最小 schema 由 ADR-0007 冻结」条目。
2. `30-contract-glossary.md` §10：新增第 14 条「`maintenance_artifact` 最小字段集合与 `adoption_card` payload 形状以 ADR-0007 为权威」。
3. `adr/0000-index.md` §2.1：新增 ADR-0007 行。
4. `29-design-integrity-review.md` §7.1 第 9 条：标注 ✅ 已由 ADR-0007 冻结。
5. `25-maintenance-hooks.md` §25 第 1 条：标注"已由 ADR-0007 冻结字段位置"。

---

## 后续工作

### 必须更新的文档

1. `../29-design-integrity-review.md` §7.1 第 9 条
   - 标注 ✅ ADR-0007 已冻结 maintenance artifact schema。
2. `../00-overview.md` §7
   - 新增 D2-023 条目。
3. `../30-contract-glossary.md` §10
   - 新增第 14 条，指向 ADR-0007。
4. `0000-index.md` §2.1
   - 新增 ADR-0007 行。
5. `../25-maintenance-hooks.md` §25 第 1 条
   - 标注"已由 ADR-0007 冻结字段位置"。
6. `0001-turn-result-v2-schema.md`
   - 在"依赖 ADR"段落追加 ADR-0007 作为 `artifact_adoption_entry` 的 maintenance artifact 扩展权威。
7. `0006-card-action-schema.md`
   - 在"依赖 ADR"段落追加 ADR-0007 作为 `adoption_card` payload 权威。

### 必须补的契约测试

1. `maintenance_artifact` 必须包含 `hook_name` / `revision_base` / `proposed_change` / `requires_adoption` / `adoption_status` / `risk_class` 六个必填字段。
2. `hook_name` 必须匹配 `hook.<NAME>` namespace 格式（`30 §7.2`）。
3. `revision_base` 不得使用 `base_revision`；`requires_adoption` 不得使用 `adoption_required`（canonical 命名 lint）。
4. `adoption_status` 取值必须属于 `30 §3.2` 7 态；不得出现非 canonical 值。
5. `risk_class` 取值必须属于 `LOW` / `MEDIUM` / `HIGH` / `CRITICAL`（`32 §lines 122-127`）。
6. `adoption_card.payload` 必须包含 `artifact_id` / `artifact_type` / `hook_name` / `revision_base` / `risk_class` / `diff_summary` / `target_object_type` 七个必填字段。
7. `adoption_card.actions[]` 必须包含至少一个 `action_type` 属于 `accept` / `edit_then_accept` / `discard`（ADR-0006 §5）。
8. `adoption_card.refs.artifact_refs[]` 必须包含对应 `artifact_id`。
9. `requires_adoption = true` 的 maintenance artifact 在 `adoption_state.pending[]` 中时，`TurnResult.next_action` 必须能映射到 `ADOPT_ARTIFACTS`（ADR-0001 §4 约束 3）。
10. `domain_ext.maintenance` 子对象不得在 `artifact_adoption_entry` 顶层直接写入字段（`domain_ext.` 前缀 lint，ADR-0001 §影响）。

### 依赖 ADR

- ADR-0001（W1，TurnResult v2 顶层 schema）：本 ADR 通过 `adoption_state.pending[]` / `resolved[]` 挂载 maintenance artifact；`artifact_adoption_entry` 子结构为本 ADR 的扩展基础。
- ADR-0002（W2，state/status/next_action 枚举）：本 ADR 消费 `ADOPT_ARTIFACTS` next_action，不新增枚举值。
- ADR-0006（W4，card / action 最小 schema）：本 ADR 冻结 `adoption_card` 的 `payload` 形状；消费 `accept` / `edit_then_accept` / `discard` / `branch` action_type，不新增枚举值。
- `30-contract-glossary.md` §2.2 / §3.1 / §3.2 / §7.2：`revision_base` / `requires_adoption` / adoption 7 态 / hook namespace 的 canonical 权威。
- `32-human-approval-policy.md` §lines 122-127：`risk_class` 取值集合的 canonical 权威。

### 待冻结的 deferred 项（后续工单）

1. **自动 adoption 决策策略**（W9 工单）：`auto_adoption_hint = true` + `risk_class = LOW` 时的系统行为，需与 `32-human-approval-policy.md` `default_behavior` 映射联合冻结。
2. **`validator_findings` 详细 schema**：maintenance validator 结构化结果的完整字段集合，由后续 ADR 冻结。
3. **scene → chapter 聚合算法**（`25 §25` 第 2 条）：`target_scope_ref` 的聚合路径与 provisional continuity 提升规则。
4. **`ambiguity_threshold` 默认值**（`25 §25` 第 3 条）：各 hook 的歧义判定阈值。

---

## 当前评审状态

当前状态为 **Accepted (2026-04-25)**。

接受时已确认：

1. `maintenance_artifact` 必填字段集合（6 个）是否覆盖所有 hook 共享需求。
2. `adoption_card` payload 字段（7 个必填 + 1 个可选）是否足以支撑 UI 渲染。
3. `risk_class` 只留字段不定策略的边界是否与 W9 工单计划对齐。
4. deferred 项清单是否完整，无遗漏的隐式冻结。
5. 回写目标文档清单（§影响 + §后续工作）是否与当前文档结构一致。

本 ADR 不需要 Oracle 评审；上述 5 项确认后已转为 Accepted。
