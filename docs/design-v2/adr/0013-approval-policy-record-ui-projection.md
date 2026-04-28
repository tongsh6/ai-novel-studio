# ADR-0013：Approval Policy / Record 最小 schema 与 UI 投影

- 状态：Accepted (2026-04-25)
- 日期：2026-04-25
- 涉及范围：Domain 子系统 32（Human Approval Policy）/ Foundation 子系统 3、10、11 / UI 阶段 42、45、46
- 相关文档：
  - `../32-human-approval-policy.md` §5 / §11 / §12 / §13
  - `../29-design-integrity-review.md` §7.1 第 13 条
  - `../39-ui-design-implementation-plan.md` §4.2
  - `0002-state-enums.md`
  - `0003-authority-budget-escalation.md`
  - `0006-card-action-schema.md`
  - `0012-quality-finding-ui-projection.md`
- 取代：无
- 取代者：无

---

## 背景

`29-design-integrity-review.md` §7.1 第 13 条将 `approval_policy / approval_record` 最小 schema、`risk_class` 与 bypass policy 边界列为 UI 前 Blocking 项。

`32-human-approval-policy.md` 已定义人工审批策略草案，但 UI 若缺少冻结 contract，会混淆 confirmation、adoption、checkpoint、block 与普通 assistant message 的边界。

本 ADR 冻结 UI 与运行时投影所需的最小审批策略和审批记录 contract，不冻结所有业务审批规则或完整策略引擎。

---

## 考虑过的方案

### 方案 A：只在 UI 文档中约定审批卡片

优点：UI 阶段推进最快。

缺点：违反 UI 不反向发明 contract 的纪律，且 approval / adoption / confirmation 容易漂移。

### 方案 B：冻结 approval policy / record 最小字段、risk_class、behavior 映射与 bypass 边界

优点：解除 UI 前阻塞，同时保留具体审批策略配置的演化空间。

缺点：需要明确 default_behavior 不是 runtime `NextAction`。

### 方案 C：冻结完整审批策略引擎

优点：实现侧最清晰。

缺点：过早绑定所有业务策略，超出 UI 前冻结包范围。

---

## 最终决策

选择 **方案 B：冻结 approval policy / record 最小字段、risk_class、behavior 映射与 bypass 边界**。

本 ADR 冻结：

1. `approval_policy` 最小字段集。
2. `risk_class` 最小枚举。
3. `default_behavior` 最小枚举及其到 runtime `NextAction` 的映射。
4. `approval_record` 最小字段集。
5. `decision` 最小枚举。
6. bypass / override 的优先级边界。
7. approval UI 可投影 card_type 集合。

本 ADR 显式不冻结：

1. 每个 intent 的最终审批策略配置。
2. 所有商业策略和平台策略。
3. UI 具体布局和文案。
4. 自动 adoption 的完整算法；本 ADR 只冻结边界。

---

## 决策内容

### 1. `approval_policy` 最小字段集

每条 approval policy 至少包括：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `approval_policy_id` | string | 是 | policy 唯一 id |
| `policy_name` | string | 是 | human-readable 名称 |
| `policy_version` | string | 是 | policy 版本 |
| `applies_to_intent_families` | string[] | 是 | 适用 intent family |
| `applies_to_artifact_types` | string[] | 是 | 适用 artifact 类型 |
| `applies_to_object_types` | string[] | 是 | 适用 object 类型 |
| `risk_class` | enum | 是 | 默认风险等级，取值见 §2 |
| `default_behavior` | enum | 是 | 默认审批行为，取值见 §3 |
| `required_user_action` | string[] | 是 | 用户必须选择或完成的动作 |
| `bypass_policy` | object | 是 | 旁路 / 覆盖规则；必须显式声明是否允许 bypass |
| `audit_level` | enum/string | 是 | 审计等级；具体枚举可后续扩展 |
| `status` | enum/string | 是 | policy 生命周期状态 |

### 2. `risk_class` 最小枚举

`risk_class` 固定最小取值：

- `LOW`
- `MEDIUM`
- `HIGH`
- `CRITICAL`

新增 risk class 必须走后续 ADR 或对应 Domain contract 更新。

### 3. `default_behavior` 与 runtime 映射

`default_behavior` 是 Domain policy decision enum，不等同于 runtime `NextAction`。

| `default_behavior` | 常见 runtime `NextAction` |
| --- | --- |
| `AUTO_PROCEED` | `SHOW_RESULT` or `NO_FURTHER_ACTION` |
| `CONFIRM_BEFORE_EXECUTE` | `CONFIRM_BEFORE_EXECUTE` |
| `CHECKPOINT_BEFORE_CONTINUE` | `RESUME_TASK` |
| `ADOPTION_REQUIRED` | `ADOPT_ARTIFACTS` |
| `BLOCK_UNTIL_USER_DECISION` | `ASK_USER` |

本 ADR 不新增 `NextAction`。UI 不得把 `default_behavior` 直接当作 button action 或 runtime next_action。

### 4. `approval_record` 最小字段集

每次人工审批、用户覆盖、自动 adoption 命中或重要审批决策都应形成 record。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `approval_record_id` | string | 是 | record 唯一 id |
| `approval_policy_ref` | string | 是 | 命中的 approval policy |
| `source_turn_ref` | string/null | 否 | 来源 turn |
| `source_task_ref` | string/null | 否 | 来源 task |
| `target_ref` | string | 是 | 被审批对象 |
| `target_type` | string | 是 | 被审批对象类型 |
| `risk_class` | enum | 是 | 决策时采用的风险等级 |
| `decision` | enum | 是 | 决策结果，取值见 §5 |
| `decision_note` | string/null | 否 | 用户或系统说明 |
| `decided_by` | string | 是 | `user` / `system` / agent ref 等决策主体 |
| `decided_at` | string (ISO 8601) | 是 | 决策时间 |
| `base_revision` | object/string | 是 | 决策基于的 authoritative revision |

### 5. `decision` 最小枚举

`approval_record.decision` 至少支持：

- `CONFIRMED`
- `REJECTED`
- `EDITED_CONFIRMED`
- `ACCEPTED`
- `EDITED_ACCEPTED`
- `DISCARDED`
- `BRANCHED`
- `CANCELLED`

`ACCEPTED` / `EDITED_ACCEPTED` 不新增 adoption 状态；它们记录 approval decision，artifact lifecycle 仍使用 `30 §3.2` adoption 7 态。

### 6. UI 投影

approval policy 通常投影为：

- `confirmation_card`
- `adoption_card`
- `checkpoint_card`
- `warning_card`
- `escalation_card`

UI 不得把高风险确认埋进普通 assistant message。卡片至少应展示：

1. 需要确认什么。
2. 为什么需要确认。
3. 影响哪些对象。
4. 不确认会怎样。
5. 可选动作。
6. 是否可稍后处理。

### 7. Bypass / override 边界

覆盖判定优先级固定如下：

1. authority / revision / security / hard consistency conflict 永远不可被 `can_override` 覆盖。
2. `approval_policy.bypass_policy` 优先于单个 `quality_finding.can_override`。
3. `quality_finding.can_override` 只能表达该 finding 本身是否可被覆盖。
4. 多个 finding 同时存在时，任一 non-overridable finding 都会阻断整体 bypass。
5. 用户覆盖必须产生 `approval_record` / audit record。

### 8. Maintenance auto-adoption 边界

`maintenance_artifact.auto_adoption_hint = true` 仅是产出方建议，不授权系统跳过 adoption boundary。

实际是否进入自动 adoption 候选，由 `approval_policy.default_behavior` + `bypass_policy` + `risk_class` 共同决定。`risk_class = HIGH` / `CRITICAL` 的 maintenance artifact 即便带有 `auto_adoption_hint`，仍必须走人工 adoption。

自动 adoption 完成后，artifact adoption lifecycle 仍取 `ACCEPTED` 或 `EDITED_ACCEPTED`，不引入 `AUTO_ADOPTED`。

---

## 影响

### 对 Domain 的影响

1. `32-human-approval-policy.md` §5 / §11 / §13 的最小模型升级为 ADR 冻结 contract。
2. approval policy 成为 quality finding、maintenance auto-adoption、long-run checkpoint 的共同决策入口。

### 对 UI 的影响

1. `42-card-system.md`、`45-guided-conversation-flows.md`、`46-state-and-feedback.md` 可稳定设计审批 flow。
2. UI 可区分 confirmation、adoption、checkpoint 与 block，而不自造新 runtime 状态。

### 对 Foundation 的影响

无新增 Foundation runtime 枚举；approval 只通过已有 behavior、next_action、card/action contract 投影。

---

## 回写目标

本 ADR Accepted 后需回写：

1. `adr/0000-index.md` §2.1 / §5：新增 ADR-0013。
2. `00-overview.md` §7：新增 D2 条目。
3. `29-design-integrity-review.md` §7.1 第 13 条：标记已冻结。
4. `30-contract-glossary.md` §10：追加本 ADR 硬骨。
5. `32-human-approval-policy.md`：标注 approval policy / record 最小 schema 已由本 ADR 冻结。
6. `39-ui-design-implementation-plan.md` §4：移入已冻结输入。

---

## 后续工作

1. 在 schema 文件中为 `approval_policy` 与 `approval_record` 建立 `$id`。
2. 为 `bypass_policy` 补完整结构化 schema。
3. 在 contract tests 中验证 high/critical 风险不被 auto-adoption 绕过。

## enforced_by

- （pending — approval policy / record 尚未实现）
