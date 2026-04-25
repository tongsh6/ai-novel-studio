# 42 Card System

> 状态：草案
>
> 角色：定义 v2 UI 中的卡片体系及其与 Foundation/Domain Contract 的映射关系。

---

## 1. 语义来源

本文所定义的所有卡片类型及字段来源严格投影于：

- `../11-ux-contract.md`：UI 卡片作为辅助对话流的结构化展示实体。
- `../adr/0001-turn-result-v2-schema.md`：卡片挂载点。
- `../adr/0005-behavior-ui-hint.md`：行为提示映射。
- `../adr/0006-card-action-schema.md`：Canonical 卡片类型限制。
- `../adr/0007-maintenance-artifact-schema.md`：Adoption 卡片负载结构。
- `../adr/0012-quality-finding-ui-projection.md`：quality finding 场景映射。
- `../adr/0013-approval-policy-record-ui-projection.md`：approval 场景映射。

---

## 2. 不负责范围

- 不定义卡片的最终 CSS 样式、圆角、阴影等视觉呈现。
- 绝不新增 ADR-0006 之外的 `card_type` 或基础动作语义。
- 不自造任何类似 `card.status` 的内部状态变量。

---

## 3. UI 场景与 Canonical 卡片映射

UI 场景中谈论的“确认卡”、“采纳卡”等，在系统底层必须严格映射为 `ADR-0006` 中的 `canonical card_type`。

| UI 场景概念 | 对应的 Canonical `card_type` | Payload / Refs 来源及用途 |
| --- | --- | --- |
| **Clarification Card** | `clarification_card` | 来源：ADR-0005 behavior hint, `refs.behavior_id`。<br/>用途：当意图槽位不足时，帮助用户补足信息；可表现为候选方向、对比方案、编辑建议或直接补充问题，不限于字段输入。 |
| **Confirmation Card** | `confirmation_card` | 来源：ADR-0005 behavior hint, Approval policy。<br/>用途：高风险操作或方向性确认（非状态采纳）。 |
| **Warning Card** | `warning_card` | 来源：Validation, quality finding, projection stale, policy warning。<br/>用途：非致命警告，需作者知晓或处理。 |
| **Checkpoint Card** | `checkpoint_card` | 来源：Long-run task, checkpoint refs。<br/>用途：长跑任务被中断等待人工干预（预算、权限、分支决策）。 |
| **Tentative Artifact Card** | `result_card` / `adoption_card` | 来源：Artifact refs。<br/>用途：如果是纯结果展示用 `result_card`；若需作者决策是否合入权威状态，用 `adoption_card`。 |
| **Adoption Card** | `adoption_card` | 来源：ADR-0007 maintenance/adoption payload。<br/>用途：明确包含 Accept/Reject/Revise 操作的结构化产物采纳卡。 |
| **Long-run Progress Card** | `progress_card` | 来源：Task refs, budget/progress snapshot。<br/>用途：展示长跑执行中的进度及预算消耗情况。 |

### 3.1 特殊场景映射约束

- **Quality Finding 场景**：必须使用 `warning_card`、`failure_card`、`checkpoint_card` 或 `adoption_card`。绝对**不得**新增 `quality_finding_card`。
- **Approval 场景**：必须使用 `confirmation_card`、`escalation_card`、`adoption_card` 或 `warning_card`。绝对**不得**新增 `approval_card`。
- **Projection Stale / Refresh 场景**：必须使用 `warning_card`、`progress_card` 或 `failure_card`。绝对**不得**新增 `projection_card`。

---

## 4. 卡片动作 (Actions) 约束

卡片上的所有按钮或交互项（Action），必须是 ADR-0006 允许的 canonical action，如：

- `answer`：补充澄清信息
- `confirm` / `reject`：确认或拒绝执行方向
- `accept` / `edit_then_accept` / `discard`：采纳、编辑后采纳或丢弃 tentative artifact
- `resume` / `cancel` / `branch`：恢复、取消或分叉 checkpoint/task
- `retry` / `revise` / `dismiss`：重试、要求修改或关闭提示
- `open_replay`：打开 replay / audit / history 入口

动作的标签文案可以本地化为符合网文语境的中文（参考 `47-ui-copy-guidelines.md`），但底层的 API 调用和 `action_type` 必须遵循 Contract。

历史或口语化说法必须映射到 canonical `action_type`：

| 非 canonical 说法 | 必须改用 |
| --- | --- |
| `adopt` | `accept` |
| `correct` | `revise` |
| `abort` | `cancel` |
| `provide_info` | `answer` |

### 4.1 NextAction 到 action_type 的最小映射

| runtime `next_action` | 允许的常见 `action_type` |
| --- | --- |
| `ASK_USER` | `answer`, `revise`, `dismiss` |
| `CONFIRM_BEFORE_EXECUTE` | `confirm`, `reject`, `revise`, `dismiss` |
| `SHOW_RESULT` | none, `open_replay` |
| `RETRY_SYSTEM` | `retry`, `dismiss` |
| `RESUME_TASK` | `resume`, `cancel`, `branch` |
| `ADOPT_ARTIFACTS` | `accept`, `edit_then_accept`, `discard`, `branch` |
| `CANCEL_TASK` | `cancel`, `dismiss` |
| `NO_FURTHER_ACTION` | none, `dismiss`, `open_replay` |

UI 不得把 `next_action`、`action_type` 和按钮中文文案混成同一个字段。

### 4.2 Clarification Card 的非表单形态

`clarification_card` 的底层语义是“等待用户补足 required slot”，但作者可见形态不应默认是表单。

允许的内容形态：

- 缺失项说明：系统还缺什么、为什么需要。
- 已知信息：从上下文推断出的 current parameters。
- 候选方向：系统根据上下文生成的 2-3 个选项。
- 对比说明：不同选项会影响主线、人物、节奏、爽点或风险的方式。
- 自由补充入口：作者可以直接说自己的偏好。

允许的 action：

| 作者可见动作 | canonical `action_type` | 说明 |
| --- | --- | --- |
| 选择这个方向 | `answer` | 把选择合并为 slot answer |
| 换一组 | `revise` | 要求系统重新生成候选 |
| 我补充一下 | `answer` | 自由文本补充 |
| 暂不处理 | `dismiss` | 关闭当前只读提示或退出引导 |

禁止：

1. 因为 `required_to_execute` 就把所有 slot 机械渲染成输入框。
2. 把候选值在确认前当作已执行参数。
3. 用 UI 文案创造新的 `action_type`。

---

## 5. 验收标准约束

1. 每类卡片都已说明对应的 contract 来源。
2. 绝对没有新增 ADR-0006 之外的 card / action 基础语义。
3. 卡片状态（如是否完成、是否挂起）必须从 TurnResult、task state、artifact state、adoption state 或 projection state 中读取，不得自造 `card.status`。
4. UI 无法映射的场景，必须通过架构组走 ADR 流程修改。
