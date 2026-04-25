# ADR-0006：Card / Action 最小 schema

- 状态：Accepted (2026-04-25)
- 日期：2026-04-24
- 涉及范围：Foundation 子系统 11（UX Contract）/ 子系统 1（Agent Foundation Contract）/ 子系统 3（Conversation Behaviors）
- 相关文档：
  - `../11-ux-contract.md` §4 / §5 / §6 / §20 / §21 / §26 / §27 / §28 / §29
  - `../29-design-integrity-review.md` §4.2.4 / §6.1 / §7.1
  - `0001-turn-result-v2-schema.md`
  - `0002-state-enums.md`
  - `0005-behavior-ui-hint.md`
- 取代：无
- 取代者：无

---

## 背景

ADR-0001 已冻结 `TurnResult v2` 顶层 schema，其中 `ui_cards[]` 指向 `foundation/ui_card.json`，但 card item 的最终 schema 仍留给 W4。ADR-0005 已冻结 behavior-specific UI hint payload，并明确 W3 不定义 card/action envelope。

`11-ux-contract.md` 已给出 card 与 action 的最小字段、基础 card taxonomy、`NextAction` 到 UI action 的映射原则，以及 replay / contract test 要求。W4 的任务是把这些前置约定收口成一个可被 UI、契约测试与后续 Domain projection 消费的最小 schema。

---

## 考虑过的方案

### 方案 A：只冻结 card_type taxonomy，不冻结 action object

优点：改动最小，保留前端自由度。

缺点：与 `11 §20` “action 也是结构化对象，不能只靠前端按钮猜逻辑”冲突；无法测试 `enabled` / `requires_confirmation`，也无法稳定 replay action snapshot。

### 方案 B：冻结最小 card/action envelope，不冻结视觉布局与 domain payload

优点：闭合 ADR-0001 `ui_cards[]` 引用，保留 UI 层渲染自由；能把 ADR-0002 `next_action`、ADR-0005 `affordance_kind`、Domain adoption/progress 等语义稳定投影为结构化操作。

缺点：需要明确多层枚举边界，避免 `next_action` / `affordance_kind` / `action_type` 混用。

### 方案 C：冻结完整 card JSON Schema 与所有 subtype payload

优点：最严格，前端实现最少猜测。

缺点：过早绑定 Domain result fields、replay interaction details、visual style 与 form schema；会把 W8 slot/form 与 UI 原型阶段内容提前塞进 W4。

---

## 最终决策

选择 **方案 B：冻结最小 card/action envelope，不冻结视觉布局与 domain payload**。

本 ADR 冻结：

1. `ui_card` 的最小公共字段。
2. `card_type` 最小集合。
3. `ui_action` 的最小公共字段。
4. `action_type` 最小集合。
5. `card_type` / `action_type` / ADR-0002 `next_action` / ADR-0005 `affordance_kind` 的边界。
6. W3 behavior hint 到 W4 card/action 的投影纪律。
7. replay snapshot 与契约测试的最低要求。

本 ADR 显式不冻结：

1. `assistant_message` schema。
2. `render_mode` schema 与 render mode 枚举扩展。
3. behavior-specific payload 内部字段（已由 ADR-0005 冻结）。
4. 新 `behavior_type`、`behavior_status` 或 `next_action`。
5. Domain-specific result payload 字段。
6. W8 slot/form schema 与 `input_schema_ref` 指向的具体表单字段。
7. visual layout、颜色、图标、动画与最终 copy。
8. replay card 的完整交互细节。
9. `style_hint` 的完整视觉设计系统取值；本 ADR 只冻结最小语义集合。

---

## 决策内容

### 1. 顶层挂载位置

Card 只通过 ADR-0001 的 `TurnResult.ui_cards[]` 挂载，不新增 TurnResult 顶层字段。

```text
TurnResult.ui_cards[] -> ui_card
ui_card.actions[] -> ui_action
```

`assistant_message` 与 `ui_cards[]` 是并列顶层呈现对象。需要结构化操作、等待用户决策、风险警示、运行进度、adoption、checkpoint 或 escalation 的状态，不应只用 `assistant_message` 承载。

### 2. ui_card 最小公共 schema

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `card_id` | string | 是 | card instance id；用于 replay、diff、测试定位 |
| `card_type` | enum | 是 | 见 §3 |
| `title` | string | 是 | card 标题；不是最终 UI copy 系统 |
| `summary` | string | 是 | 用户可见摘要；复杂内容可由 subtype payload 扩展 |
| `status` | string | 是 | card 展示状态；不得替代 ADR-0002 runtime status；最小取值集合延后到 UI 设计阶段冻结，本 ADR 仅冻结字段位置 |
| `actions` | `ui_action[]` | 是 | 结构化可操作项；可为空数组 |
| `refs` | object | 是 | 指向 turn / task / artifact / behavior / trace 等来源 |
| `priority` | enum | 是 | `low` / `normal` / `high` / `critical` |
| `visibility` | enum | 是 | `primary` / `secondary` / `debug_only` |
| `payload` | object/null | 否 | card subtype 的稳定数据；Domain 扩展必须遵守命名空间纪律 |

约束：

1. `actions` 必须是结构化 `ui_action[]`，不得用纯字符串按钮代替。
2. `refs` 至少应能定位 card 来源；如果 card 来自 behavior hint，必须包含对应 `behavior_id`。
3. `payload` 不得重定义 ADR-0005 behavior payload；若需引用 behavior-specific 内容，应通过 `refs.behavior_id` 与摘要字段投影。
4. Domain-specific payload 字段必须使用 `domain_ext.` 前缀，或放入明确命名的 Domain-owned 子对象；不得污染 Foundation 公共字段。

#### 字段数说明

公共字段共 10 个（9 必填 + `payload` 可选），高于本计划 §3 W4 完成判据中的"≤ 8 个"启发上限。差异来源如下：

1. 上述 9 个必填字段直接对应 `../11-ux-contract.md` §6.1 已固化的 card 最小字段集（`card_id` / `card_type` / `title` / `summary` / `status` / `actions` / `refs` / `priority` / `visibility`），这一基线早于本计划成文，ADR-0006 的职责是把 11 已说的语义升级为 schema，不能反向裁剪 11 的硬骨。
2. `payload` 是 ADR-0006 唯一新增的字段，标记为可选（`否`），目的是按 ADR-0001 既定的 `domain_ext.` 前缀约束（`0001-turn-result-v2-schema.md` §决策内容相关段）给 Domain 留出 subtype 扩展位，而不是新增 Foundation 公共语义。
3. 计划 §3 W4 括注内的示例字段集（`id / type / title / body / actions / state_ref / created_at / domain_ext`）与 11 §6.1 既有命名不一致：`body` 对应 `summary`、`state_ref` 在 11 中不存在（运行态引用通过 `refs` 表达）、`created_at` 在 11 中也未要求（卡片创建时间可由 `TurnResult.produced_at` 与 `refs.turn_ref` 联合定位）。因此该示例集合在 ADR-0006 中视为**非权威**，以 11 §6.1 为准。
4. 没有任何字段超出 UX Contract 既有要求；不存在被新发明的 Foundation 公共字段。

### 3. card_type 最小集合

| card_type | 语义 |
| --- | --- |
| `result_card` | 结构化结果或产物摘要 |
| `clarification_card` | 要求用户补充信息 |
| `confirmation_card` | 执行前确认 |
| `warning_card` | 警示、阻断说明或轻量风险提示 |
| `checkpoint_card` | long-run / task checkpoint |
| `progress_card` | 运行中进度 |
| `adoption_card` | tentative artifact adoption 决策 |
| `failure_card` | 失败、重试或恢复说明 |
| `escalation_card` | escalation / human approval / budget-authority 门禁 |
| `replay_card` | replay / audit / history 入口 |

规则：

1. `card_type` 不是 `behavior_type`。
2. 不要求 behavior 与 card_type 一一对应。`rejection`、`cancellation`、`correction` 可根据上下文投影为 `warning_card`、`confirmation_card`、`result_card` 或其他已冻结 card type。
3. 新增 card type 必须走后续 ADR 或明确 extension policy；不得由 UI 层临时发明 Foundation card type。

### 4. ui_action 最小公共 schema

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `action_id` | string | 是 | action instance id；用于 replay、audit、点击回传 |
| `action_type` | enum | 是 | 见 §5 |
| `label` | string | 是 | 用户可见按钮/菜单文案；可被 UI copy 系统二次本地化 |
| `target_ref` | object | 是 | action 作用目标，如 turn/task/artifact/behavior/card |
| `enabled` | boolean | 是 | UI 是否可点击，不能由前端本地猜测 |
| `requires_confirmation` | boolean | 是 | 点击该 action 后是否还需二次确认 |
| `style_hint` | enum | 是 | 最小视觉语义提示，见 §6 |
| `reason` | string/null | 否 | disabled 或需要确认时的用户可见原因摘要 |

约束：

1. `enabled=false` 时应提供 `reason`，供 UI 展示不可用原因。
2. `requires_confirmation=true` 不等于 ADR-0002 `CONFIRM_BEFORE_EXECUTE`；前者是该 UI action 本身是否需要二次确认，后者是 turn/runtime 的 next action。
3. `target_ref` 必须足以让 executor / router / UI 回传事件定位目标；不得只依赖 `label`。

### 5. action_type 最小集合

| action_type | 语义 |
| --- | --- |
| `answer` | 用户提供字段、选择或文本回答 |
| `confirm` | 用户确认继续执行 |
| `reject` | 用户拒绝执行或提议 |
| `resume` | 恢复暂停/等待中的 task |
| `cancel` | 取消目标 task / behavior / action path |
| `accept` | 采纳 tentative artifact 或结果 |
| `edit_then_accept` | 修改后采纳 |
| `discard` | 丢弃 tentative artifact 或候选结果 |
| `branch` | 从 checkpoint / artifact 分支 |
| `open_replay` | 打开 replay / audit / history 视图 |
| `retry` | 重试失败路径 |
| `revise` | 要求修改、补丁或重新提出方案 |
| `dismiss` | 关闭只读、已完成或失效提示 |

规则：

1. `action_type` 不是 ADR-0002 `next_action`。
2. `action_type` 不是 ADR-0005 `affordance_kind`。
3. 一个 `next_action` 可投影为零个、一个或多个 `action_type`。
4. 一个 `affordance_kind` 可投影为一个或多个 `action_type`；例如 `revise` affordance 可投影为 `revise` 或带 form 的 `answer` action。
5. `abandon` 不作为 W4 canonical `action_type`；历史文档中的 abandon 语义应投影为 `dismiss`、`discard` 或 `cancel`，取决于目标对象是否只读、tentative artifact 或 active task/behavior。

### 6. style_hint 最小集合

`style_hint` 只表达最低限度的操作语义，不冻结颜色、组件样式或设计 token。

| style_hint | 语义 |
| --- | --- |
| `primary` | 主行动 |
| `secondary` | 次要行动 |
| `destructive` | 可能取消、丢弃或破坏当前路径 |
| `warning` | 风险提示或需谨慎操作 |
| `success` | 采纳、完成或正向确认 |
| `neutral` | 无强语义倾向 |

### 7. NextAction 到 action_type 的映射纪律

ADR-0002 的 `next_action` 是运行语义，W4 的 `action_type` 是 UI 可操作项。二者必须可映射，但不能混成同一个枚举。

| next_action | 允许的常见 action_type |
| --- | --- |
| `ASK_USER` | `answer`, `revise`, `dismiss` |
| `CONFIRM_BEFORE_EXECUTE` | `confirm`, `reject`, `revise`, `dismiss` |
| `SHOW_RESULT` | none, `open_replay`, domain-specific view action（后续扩展） |
| `RETRY_SYSTEM` | `retry`, `dismiss` |
| `RESUME_TASK` | `resume`, `cancel`, `branch` |
| `ADOPT_ARTIFACTS` | `accept`, `edit_then_accept`, `discard`, `branch` |
| `CANCEL_TASK` | `cancel`, `dismiss` |
| `NO_FURTHER_ACTION` | none, `dismiss`, `open_replay` |

约束：

1. UI 不得把非 canonical `EXECUTE_DIRECTLY` 渲染为可操作项。
2. `phase × next_action` 仍以 ADR-0002 为权威；W4 不放宽运行状态机。
3. 若 action 会触发写入、取消、采纳或预算/权限提升，executor 仍必须按 authority / budget / policy 重新校验；UI action 不是授权本身。

### 8. ADR-0005 behavior_ui_hint 到 card/action 的投影

W4 消费 ADR-0005，但不重定义 behavior payload。

| behavior_type | 默认 card projection | 默认 action projection |
| --- | --- | --- |
| `clarification` | `clarification_card` | `answer` |
| `confirmation` | `confirmation_card` | `confirm`, `reject` |
| `rejection` | `warning_card` 或 `result_card` | `dismiss`，必要时 `answer` / `revise` |
| `cancellation` | `result_card` 或 `checkpoint_card` | `dismiss` |
| `correction` | `warning_card` 或 `confirmation_card` | `revise`, `confirm`, `reject` |

规则：

1. 来自 `behavior_ui_hint` 的 card 必须在 `refs` 中保留 `behavior_id`，并应保留 source refs。
2. W4 card 的 `summary` 可以摘要展示 ADR-0005 payload，但不得把 payload 字段复制成新的权威 schema。
3. `affordance_kind` 只能约束允许的交互语义；最终按钮必须是 `ui_action` object。

### 9. refs 最小结构

`refs` 是 card/action 的来源定位集合，最小允许以下键：

| refs key | 类型 | 说明 |
| --- | --- | --- |
| `turn_ref` | string/null | 来源 turn |
| `task_ref` | string/null | 相关 task |
| `artifact_refs` | string[] | 相关 artifact |
| `behavior_id` | string/null | 相关 behavior |
| `trace_ref` | string/null | replay/audit trace |
| `policy_ref` | string/null | 触发 policy / guard |

`refs` 可扩展，但 Foundation 公共键不得被 Domain 改写语义。

### 10. replay 与 snapshot

1. card snapshot 必须能保存 `ui_card` 公共字段、`actions` snapshot 与 `refs`。
2. replay 时优先展示当时的 card/action snapshot，不用当前规则重算旧 card。
3. replay snapshot 不是重新授权；历史 action 是否仍可执行由当前 runtime policy 决定。

---

## 决策原因

1. `ui_cards[]` 已是 TurnResult 顶层结构化呈现出口；如果不冻结 item schema，UI 前仍会出现“卡片到底是什么”的猜测空间。
2. `11-ux-contract.md` 已明确 action 必须是结构化对象；冻结 action envelope 是契约测试与 replay 的前提。
3. ADR-0005 刻意不冻结 card/action envelope；ADR-0006 必须承接该边界，否则 W3 hint 无法稳定投影到 UI。
4. 保持 `next_action`、`affordance_kind`、`action_type` 三层分离，可以避免 UI 把运行状态机、behavior 语义和按钮对象混成一个枚举。
5. 不冻结 Domain payload 与视觉设计，能让 W8 slot/form schema 与后续 UI 原型继续演化。

---

## 影响

### 对 Foundation 的影响

- 闭合 ADR-0001 `ui_cards[]` item 引用目标。
- 让 `11 §6` / `11 §20` 从 pre-ADR 草案约束升级为 ADR 权威。
- 明确 `card_type` / `action_type` / `next_action` / `affordance_kind` 的边界。

### 对 Domain 的影响

- Domain 可以通过 `payload` / `refs` / 后续 extension policy 投影领域结果，但不得修改 Foundation card/action 公共字段语义。
- adoption、tentative artifact、reading projection 等领域 card 必须使用 W4 action object，而不是 UI 本地按钮逻辑。

### 对 UI 的影响

- UI 可依赖 `ui_cards[]` 中的 card/action 结构进行渲染、禁用态展示、二次确认提示与 replay。
- UI 仍保留布局、视觉层级、copy 本地化与组件实现自由。

---

## 后续工作

### 必须更新的文档

1. `../29-design-integrity-review.md` §4.2.4 / §6.1 / §7.1
   - 将 card / action schema 标注为已由 ADR-0006 冻结。
2. `../11-ux-contract.md` §6 / §20 / §27 / §29
   - 将 card/action 最小字段指向 ADR-0006；移除“最终 JSON schema 细节未冻结”的表述。
3. `0001-turn-result-v2-schema.md`
   - 将 `ui_cards[]` item `$ref` 的 ADR-0006 依赖从占位更新为已冻结权威。
4. `0002-state-enums.md`
   - 将 card/action schema 从后续依赖更新为 W4 已冻结权威。
5. `0003-authority-budget-escalation.md`
   - 将 card/action schema 从后续依赖更新为 W4 已冻结权威。
6. `0005-behavior-ui-hint.md`
   - 将 W4 / ADR-0006 从未来消费方更新为已冻结消费方。
7. `0000-index.md`
   - 新增 ADR-0006 条目。
8. `../00-overview.md` §7
   - 新增 card/action 最小 schema 已冻结的决策索引。

### 必须补的契约测试

1. `ui_cards[]` item 必须包含 W4 required card fields。
2. `actions[]` item 必须包含 W4 required action fields。
3. `action_type` 不得使用非 canonical 值，如 `EXECUTE_DIRECTLY` / `abandon`。
4. `NextAction` 到 `action_type` 的投影不得违反 ADR-0002 `phase × next_action` allowlist。
5. 来自 ADR-0005 `behavior_ui_hint` 的 card 必须保留 `refs.behavior_id`。
6. `enabled=false` 的 action 应提供 `reason`。
7. Domain payload 扩展不得污染 Foundation 公共字段。

### 依赖 ADR

- ADR-0001（W1，TurnResult v2 顶层 schema）：本 ADR 闭合 `ui_cards[]` item 的最小 schema。
- ADR-0002（W2，state/status/next_action 枚举）：本 ADR 消费 `next_action`，不新增 runtime action。
- ADR-0003（W5，authority / budget / escalation）：本 ADR 的 action 不替代 authority / budget / policy 校验。
- ADR-0005（W3，behavior-specific UI hint）：本 ADR 消费 `behavior_ui_hint` 并投影为 card/action envelope。

---

## 当前评审状态

当前状态为 **Accepted (2026-04-25)**。

- Oracle 首轮：ACCEPT WITH MINOR EDITS，要求补齐字段数说明段落与 `status` 字段注释。
- 两处编辑已应用：`status` 说明补足"最小取值集合延后冻结"口径；新增"字段数说明"段落，明确 9 必填字段源自 `11-ux-contract.md` §6.1，`payload` 为唯一新增可选字段，计划 §3 W4 示例字段集为非权威。
- Oracle 二轮：ACCEPT，无剩余编辑。

首轮 9 项 checklist 均已满足：

1. 不重定义 ADR-0005 behavior payload；通过 `refs.behavior_id` 引用。
2. 不新增 ADR-0002 `next_action` 枚举值；未放宽 phase compatibility。
3. `action_type` / `affordance_kind` / `next_action` 边界明确，三者投影关系唯一。
4. `style_hint` 最小集合未冻结具体视觉系统。
5. 回写清单覆盖 `11-ux-contract.md` / `29-design-integrity-review.md` / `30-contract-glossary.md` / `0000-index.md`。
6. card 公共字段共 10 个（9 必填 + 1 可选），超出计划 §3 W4 启发上限的差异来源已在"字段数说明"段落逐项说明。
7. 与 `30-contract-glossary.md` §9 NextAction→UI action 表一致。
8. `payload` / `domain_ext.` 前缀为 Domain 预留稳定扩展点。
9. 未引入新 Foundation 概念。
