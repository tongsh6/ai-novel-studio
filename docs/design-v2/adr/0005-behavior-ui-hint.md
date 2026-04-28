# ADR-0005：Behavior-specific UI Hint 最小 schema

- 状态：Accepted
- 日期：2026-04-24（Accepted 于 2026-04-24，oracle 二轮复审 ACCEPT）
- 涉及范围：Foundation 子系统 3（Conversation Behaviors）/ 子系统 11（UX Contract）/ 子系统 1（Agent Foundation Contract）
- 相关文档：
  - `../03-conversation-behaviors.md` §4 / §5 / §6 / §7 / §8 / §9 / §17 / §18 / §21 / §22
  - `../11-ux-contract.md` §6 / §8 / §9 / §20 / §21 / §22 / §28 / §29
  - `../01-agent-foundation-contract.md` §9 / §11 / §21
  - `../02-turn-and-task-state-machines.md` §6 / §7 / §11
  - `../30-contract-glossary.md` §6 / §9
  - `../29-design-integrity-review.md` §4.2.3 / §7.1
  - `0001-turn-result-v2-schema.md`
  - `0002-state-enums.md`
- 取代：无
- 取代者：无

---

## 背景

ADR-0001 已冻结 `TurnResult.behavior_state` 的顶层形状，ADR-0002 已冻结 `behavior_status` 与 `next_action`。但 UI 仍缺少一个稳定 contract 来判断：同样是 active behavior，clarification、confirmation、rejection、cancellation、correction 各自需要显示哪些语义信息。

现有文档已经明确：

1. clarification 需要展示 prompt、required/optional fields、current parameters 与 answer action。
2. confirmation 需要展示 risk summary、budget estimate、affected scope、confirm/reject action。
3. rejection / cancellation / correction 都需要有用户可见 summary 或 card。
4. UI 不应凭“看起来像 clarification / confirmation”的样式推断语义，必须由 behavior type 与 runtime state 驱动。

W3 的目标是冻结 **behavior-specific UI hint payload**：它告诉 UI “这个 behavior 对应的可见语义材料是什么”。W4 / ADR-0006 再决定这些材料如何进入 card/action envelope。

---

## 考虑过的方案

### 方案 A：让每种 behavior 直接产出完整 card

优点：

- UI 实现最直接。
- clarification / confirmation 可以马上渲染。

缺点：

- 会吞并 W4 card/action schema。
- behavior 语义会和 card 表现层耦合。
- 同一个 behavior 无法稳定投影到不同 UI 表达（卡片、抽屉、日志、回放）。

### 方案 B：冻结 behavior-specific hint payload，不冻结 card/action envelope

优点：

- 明确 W3/W4 边界：W3 定语义材料，W4 定展示容器。
- 与 ADR-0001 `behavior_state` 和 ADR-0002 `next_action` / `behavior_status` 对齐。
- UI 可以稳定消费 behavior 语义，同时保留后续 card system 的表现自由度。

缺点：

- W3 不能单独完成最终 UI 渲染，还需要 W4 落地。
- 需要定义一层 hint payload 到 card/action 的投影边界。

### 方案 C：只依赖 `behavior_state.active`，不新增 UI hint

优点：

- schema 最少。
- 不新增中间层。

缺点：

- `behavior_state.active` 只包含 id/type/status/resolution_ref，不含 clarification prompt、risk summary、scope summary 等 UI 必要材料。
- UI 会被迫回查多个 behavior object 或推断字段语义。
- 无法通过 contract tests 验证 behavior-specific UI 信息是否齐全。

---

## 最终决策

选择 **方案 B：冻结 behavior-specific hint payload，不冻结 card/action envelope**。

本 ADR 冻结：

1. `behavior_ui_hint` 的最小公共字段。
2. clarification / confirmation / rejection / cancellation / correction 五类 payload 的最小字段。
3. `affordance_kind` 最小集合，用于表达 behavior 层允许的交互语义。
4. hint 与 ADR-0001 `behavior_state`、ADR-0002 `next_action` 的一致性约束。
5. W3 与 W4 的边界：W3 不定义 card/action envelope。

本 ADR 显式不冻结：

1. card / action JSON schema（W4 / ADR-0006）。
2. card type taxonomy 与 visual layout。
3. `action_id` / `action_type` / `label` / `enabled` / `style_hint` 等 action object 字段。
4. render mode schema。
5. 新 behavior type。
6. 新 `next_action` 或 `behavior_status`。
7. confirmation threshold 默认值。
8. reason_code 完整枚举。
9. correction resolution subtype 完整 taxonomy。
10. UI 文案最终 copy、颜色、图标或动画。

---

## 决策内容

### 1. 顶层挂载位置

`behavior_ui_hint` 是 behavior object 或 behavior projection 的子结构，不新增 `TurnResult` 顶层字段。

推荐挂载：

```text
behavior_state.active.ui_hint
behavior_state.history[].ui_hint (optional, for replay)
```

在 JSON Schema 层，ADR-0001 的 `behavior_state.active` / `history[]` 当前允许 `additionalProperties: true`；`ui_hint` 通过本 ADR 在该扩展点内收口。若未来将 `behavior_state` 子结构拆成独立 schema，应把 `ui_hint` 显式提升为该子 schema 的可选字段。

### 2. 公共 schema

`behavior_ui_hint` 最小公共字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `hint_id` | string | 是 | hint 实例 id，便于 replay / audit |
| `behavior_id` | string | 是 | 对齐 `behavior_state.active.behavior_id` 或 history item |
| `behavior_type` | enum | 是 | `clarification` / `confirmation` / `rejection` / `cancellation` / `correction` |
| `behavior_status` | enum | 是 | ADR-0002 `behavior_status` |
| `next_action` | enum | 是 | ADR-0002 `next_action` |
| `payload` | object | 是 | 按 behavior_type 分支 |
| `affordances` | array | 是 | 允许的 behavior-level 交互语义，不是 W4 action object |
| `resolution_ref` | string/null | 否 | closed/replayed behavior 的 resolution 引用 |
| `source_refs` | string[] | 否 | 指向 source turn / task / artifact / policy 的引用 |

约束：

1. `behavior_type` 必须等于对应 behavior_state item 的 `behavior_type`。
2. `behavior_status` 必须等于对应 behavior_state item 的 `status`。
3. `next_action` 必须来自 ADR-0002 canonical set。
4. `affordances[]` 只能使用本 ADR §4 的 `affordance_kind`。
5. closed behavior 若有 `resolution_ref`，hint 必须保留足以 replay 的 summary 信息。

### 3. behavior-specific payload

#### 3.1 clarification_payload

| 字段 | 类型 | 必填 | 来源语义 |
| --- | --- | --- | --- |
| `prompt_message` | string | 是 | clarification prompt |
| `required_fields` | string[] | 是 | 必答字段 |
| `optional_fields` | string[] | 否 | 可选字段 |
| `current_parameters` | object | 否 | 当前已知参数 |
| `input_schema_ref` | string/null | 否 | 用于 W4/W8 表单生成的 schema ref |

默认 affordance：`answer`。若 clarification 已 superseded / expired，可使用 `dismiss`。

`input_schema_ref` 是可选引用，不冻结表单 schema。它只为 W4 card/action 与 W8 slot schema 提供连接点，避免 W3 把 required_fields 直接扩展成 UI form 定义。

#### 3.2 confirmation_payload

| 字段 | 类型 | 必填 | 来源语义 |
| --- | --- | --- | --- |
| `prompt_message` | string | 是 | confirmation prompt |
| `target_action` | string | 是 | 待确认动作 |
| `risk_summary` | string | 是 | 风险摘要 |
| `budget_estimate` | object/null | 否 | 预算预估 |
| `affected_scope_summary` | string | 是 | 影响范围摘要 |
| `policy_ref` | string/null | 否 | 触发 confirmation 的 policy |

默认 affordances：`confirm`、`reject`。

`policy_ref` 是可选审计引用，用于解释 confirmation 由哪条 policy / authority / budget gate 触发；本 ADR 不冻结 policy schema。

#### 3.3 rejection_payload

| 字段 | 类型 | 必填 | 来源语义 |
| --- | --- | --- | --- |
| `user_facing_explanation` | string | 是 | 用户可见拒绝说明 |
| `reason_code` | string/null | 否 | reason code；完整枚举不在 W3 冻结 |
| `allowed_alternatives` | string[] | 否 | 可选替代方案 |

默认 affordances：`dismiss`；若存在替代方案，可增加 `revise` 或 `answer`。

#### 3.4 cancellation_payload

| 字段 | 类型 | 必填 | 来源语义 |
| --- | --- | --- | --- |
| `target_entity_type` | string | 是 | 被取消对象类型 |
| `target_entity_ref` | string | 是 | 被取消对象引用 |
| `cancellation_scope` | string | 是 | 取消范围 |
| `effect_summary` | string | 是 | 取消影响摘要 |

默认 affordances：`dismiss`。取消不等于 rollback；如需恢复路径，应由 W4 card/action 或后续 task policy 表达。

#### 3.5 correction_payload

| 字段 | 类型 | 必填 | 来源语义 |
| --- | --- | --- | --- |
| `corrected_entity_type` | string | 是 | 需修正对象类型 |
| `corrected_entity_ref` | string | 是 | 需修正对象引用 |
| `reason_summary` | string | 是 | 修正原因摘要 |
| `proposed_resolution_type` | string | 是 | 建议解决类型；完整 taxonomy 不在 W3 冻结 |
| `current_value_summary` | string/null | 否 | 当前值摘要 |
| `proposed_value_summary` | string/null | 否 | 建议值摘要 |

默认 affordances：`revise`、`confirm`、`reject`。

`current_value_summary` / `proposed_value_summary` 是可选展示摘要，用于让 correction card 解释“当前是什么 / 建议改成什么”；它们不冻结 correction resolution subtype taxonomy，也不替代被修正对象的 authoritative 字段。

### 4. affordance_kind 最小集合

| affordance_kind | 语义 |
| --- | --- |
| `answer` | 用户提供信息或字段值 |
| `confirm` | 用户确认继续执行 |
| `reject` | 用户拒绝执行或提议 |
| `cancel` | 用户取消目标 task / behavior（仅在允许时） |
| `revise` | 用户要求修改或提供修正 |
| `dismiss` | 用户关闭已完成/失效/只读提示 |

`affordance_kind` 不是 W4 `action_type`。W4 可以把一个 affordance 投影成一个或多个 action object，但不得发明与本 ADR 矛盾的 behavior affordance。

### 5. behavior_type 与 next_action 对齐

| behavior_type | active status | canonical next_action | 默认 affordances |
| --- | --- | --- | --- |
| `clarification` | `WAITING_USER` | `ASK_USER` | `answer` |
| `confirmation` | `WAITING_USER` | `CONFIRM_BEFORE_EXECUTE` | `confirm`, `reject` |
| `rejection` | closed/history | `NO_FURTHER_ACTION` or `ASK_USER` | `dismiss`, optional `answer` / `revise` |
| `cancellation` | closed/history | `NO_FURTHER_ACTION` | `dismiss` |
| `correction` | `OPEN` / `WAITING_USER` | `ASK_USER` or `CONFIRM_BEFORE_EXECUTE` | `revise`, `confirm`, `reject` |

规则：

1. active `clarification` 必须使用 `next_action=ASK_USER`。
2. active `confirmation` 必须使用 `next_action=CONFIRM_BEFORE_EXECUTE`。
3. active `correction` 若要求用户输入，使用 `ASK_USER`；若要求用户确认修正方案，使用 `CONFIRM_BEFORE_EXECUTE`。
4. `rejection` / `cancellation` 默认不进入 `behavior_state.active`；若用于 replay，应落在 history。
5. W3 不定义 `card_type`；W4 必须根据 `behavior_type` + `payload` + `affordances` 投影 card。

---

## 决策原因

选择方案 B 的原因：

1. `behavior_state` 已有 id/type/status，但缺少 UI 必需语义材料；W3 需要补 payload，不应改 TurnResult 顶层。
2. clarification / confirmation 的 UI 需求在 `03` 与 `11` 中已经足够明确，可以冻结最小 payload。
3. W4 card/action schema 尚未冻结；W3 直接定义 card 会造成双权威。
4. `affordance_kind` 保留 behavior-level 交互语义，同时避免提前绑定 action object 字段。
5. `next_action` 仍由 ADR-0002 负责；W3 只规定 behavior hint 与它的相容关系。

不选择方案 A，因为它会吞并 W4。

不选择方案 C，因为 UI 会缺失 prompt、risk、scope、reason 等最基本可见材料。

---

## 影响

### 对 Foundation 的影响

- `behavior_state.active` / `history[]` 的扩展点有了 canonical `ui_hint` 结构。
- behavior replay 可以保留用户可见 summary 与 resolution_ref。
- W3 不改变 ADR-0001 顶层字段，也不新增 ADR-0002 状态枚举。

### 对 Domain 的影响

- Domain behavior 可以在 payload 中使用 domain-specific refs，但扩展字段仍遵守 ADR-0001 的 `domain_ext.` 前缀纪律。
- Domain 不得自造新 behavior_type；需要新 behavior type 必须新 ADR。
- reason_code / proposed_resolution_type 的完整领域枚举后置，不在 W3 冻结。

### 对 UI 的影响

- UI 可以根据 `behavior_type` + `payload` 稳定展示 clarification / confirmation / rejection / cancellation / correction。
- UI 仍需等待 W4 定义 card/action envelope。
- UI 不得仅凭 card 样式判断 behavior 语义。

### 对 ADR-0006 的影响

- ADR-0006 应消费本 ADR 的 `behavior_ui_hint`，将其投影为 card/action schema。
- ADR-0006 可以定义 action object 字段与 visual hints，但不得改变本 ADR 的 behavior payload 语义。

---

## 后续工作

### 必须更新的文档

1. `../29-design-integrity-review.md` §7.1
   - 将 Foundation 第 3 项标注为已由 ADR-0005 冻结。
2. `0001-turn-result-v2-schema.md`
   - 将 ADR-0005 从占位依赖更新为 behavior-specific UI hint 权威。
3. `0002-state-enums.md`
   - 将 ADR-0005 从后续依赖更新为 W3 已冻结权威。
4. `0000-index.md`
   - 新增 ADR-0005 条目。
5. `../00-overview.md` §7
   - 新增 behavior-specific UI hint 已冻结的决策索引。
6. `../03-conversation-behaviors.md` §6.5
   - 将 confirmation 的 `next_action` 从旧草案 `ASK_USER` 对齐为 ADR-0002 / ADR-0005 的 `CONFIRM_BEFORE_EXECUTE`。

### 必须补的契约测试

1. hint alignment 测试：`behavior_ui_hint.behavior_id/type/status` 必须与对应 behavior_state item 一致。
2. next_action alignment 测试：clarification → `ASK_USER`；confirmation → `CONFIRM_BEFORE_EXECUTE`。
3. payload required fields 测试：五类 behavior payload 必填字段不可缺。
4. affordance enum 测试：只允许本 ADR §4 的 `affordance_kind`。
5. W3/W4 boundary 测试：`behavior_ui_hint` 不得包含 W4 action object 字段（如 `action_id`、`label`、`enabled`、`style_hint`）。
6. replay 测试：history hint 若存在 closed behavior，必须保留 summary / resolution_ref 足以回放。
7. domain extension 测试：payload 内 Domain 扩展属性必须使用 `domain_ext.` 前缀。

### Schema 引用基址约定

本 ADR 沿用 ADR-0001 的 schema 根目录：`docs/design-v2/schemas/`。

建议 `$id`：

- `foundation/behavior_ui_hint.json`
- `foundation/behavior_ui_hint/clarification_payload.json`
- `foundation/behavior_ui_hint/confirmation_payload.json`
- `foundation/behavior_ui_hint/rejection_payload.json`
- `foundation/behavior_ui_hint/cancellation_payload.json`
- `foundation/behavior_ui_hint/correction_payload.json`
- `foundation/enums/affordance_kind.json`

### 依赖 ADR

- ADR-0001（W1，TurnResult v2 顶层 schema）：提供 `behavior_state.active/history` 挂载点。
- ADR-0002（W2，state/status/next_action）：提供 `behavior_status` 与 `next_action`。
- ADR-0006（W4，card/action schema）：消费本 ADR，但不被本 ADR定义。

---

## 状态

当前状态为 Accepted。oracle 二轮复审已确认：

1. W3 没有吞并 W4 card/action schema。
2. `behavior_ui_hint` 与 ADR-0001 `behavior_state` 挂载关系清晰。
3. `next_action` / `behavior_status` 没有被 W3 重定义。
4. 五类 behavior payload 的最小字段均有源文档依据。
5. reason_code / correction taxonomy / visual style 均保持后置。

## enforced_by

- `NovelApplication.TurnService` — behavior_state.active 组装（behavior_type / behavior_id / status / missing_slots）
- `NovelFoundation.Enums.BehaviorStatus` — OPEN / WAITING_USER / RESOLVED / CANCELLED / EXPIRED 枚举
- `NovelFoundation.TurnResultValidator` — behavior_state 形状校验 + 终态不得留在 active
