# 42 Card System

> 状态：草案
>
> 角色：定义当前 Workbench UI 的语义卡片体系，以及它与 TurnResultViewModel、AvailableAction、BehaviorState、ProjectionHint 的映射关系。

---

## 1. 语义来源

本文所定义的所有卡片类型及字段来源严格投影于：

- `../07-workbench-ui-contract.md` §3-§8：TurnResultViewModel、`ui_cards`、`available_actions`、候选/选择/采纳边界。
- `../contracts/VS-05-ui-roundtrip-contract-pack.md` §2-§4：UI roundtrip envelope、AvailableAction 回传约束、当前冻结的 card type 最小集合。
- `../contracts/VS-04-adoption-boundary-contract-pack.md` §3-§6：候选选择、采纳边界和 projection refresh 约束。
- `../contracts/VS-03-behavior-lifecycle-contract-pack.md`：clarification / confirmation / recovery 等 author-blocking behavior 的状态来源。
- `../adr/ADR-0007-next-action-available-action-v3.md`：`primary_next_action` 与 `AvailableAction` 决策。
- `../adr/ADR-0015-turn-result-view-model-v3.md`：TurnResultViewModel 作为 UI 唯一主消费 envelope。
- `../adr/ADR-0016-projection-hint-ui-v3.md`：projection notice 的刷新提示边界。

---

## 2. 不负责范围

- 不定义卡片的最终 CSS 样式、圆角、阴影等视觉呈现。
- 绝不新增 `../contracts/VS-05-ui-roundtrip-contract-pack.md` §4 之外的 `card_type`。
- 绝不新增 `../07-workbench-ui-contract.md` §5 之外的 `action_type`。
- 不自造任何类似 `card.status` 的内部状态变量。
- 不把卡片本身当成授权来源；可提交动作只能来自同一 TurnResultViewModel 的 `available_actions`。

---

## 3. UI 场景与当前 card_type 映射

UI 场景中谈论的“确认卡”“候选卡”“恢复卡”等，必须严格映射到 VS-05 当前冻结的语义 `card_type`。

| UI 场景概念 | 当前 `card_type` | Payload / Refs 来源及用途 |
| --- | --- | --- |
| **候选方向 / 暂态产物展示** | `candidate_set` | 来源：TentativeArtifactSet / CandidateSet。用于展示候选方向、候选设定、候选片段；本身不代表采纳，也不授权写入。 |
| **澄清提示** | `clarification_prompt` | 来源：BehaviorState clarification。用于在 required input 不足时展示问题、已知信息、候选方向或自由补充入口。 |
| **执行前确认** | `confirmation_request` | 来源：BehaviorState confirmation / approval policy。用于展示确认对象、影响范围、风险和可选动作；不是采纳。 |
| **恢复提示** | `recovery_prompt` | 来源：failed recoverable decision / task state。用于展示失败原因、重试、缩小范围或继续对话动作。 |
| **解释摘要** | `trace_summary` | 来源：redacted TraceSummaryView。只展示 author-safe 解释，不暴露 raw prompt、隐藏 policy 或敏感 memory。 |
| **投影刷新提示** | `projection_notice` | 来源：ProjectionHint / reading projection status。只提示刷新或进入更新流，不能授权 UI 写入。 |
| **能力 / 策略提示** | `capability_notice` | 来源：capability registry / policy summary。只读展示系统能力、限制或当前不可用原因。 |

### 3.1 特殊场景映射约束

- **Quality Finding 场景**：以 `recovery_prompt`、`confirmation_request`、`projection_notice` 或 `trace_summary` 表达；不得新增 `quality_finding_card`。
- **Approval 场景**：以 `confirmation_request` 表达方向性确认或高风险执行前放行；不得新增 `approval_card`。
- **Projection Stale / Refresh 场景**：以 `projection_notice` 表达；不得新增 `projection_card`。
- **Tentative Artifact 场景**：以 `candidate_set` 展示，提交能力必须来自 `available_actions`；不得恢复旧 `adoption_card` 作为动作来源。

---

## 4. 卡片动作 (Actions) 约束

卡片上的所有按钮或交互项必须来自同一 TurnResultViewModel 的 `available_actions`。UI 可以把 action 渲染在卡片附近，但不能从 `card_type`、按钮中文文案或 payload 字段推导可提交动作。

当前 UI 可提交 action_type 集合来自 `../07-workbench-ui-contract.md` §5：

- `continue_dialogue`：继续自然对话。
- `answer_clarification`：回答澄清。
- `confirm_before_execute`：确认执行。
- `cancel_behavior`：取消等待态。
- `choose_candidate`：选择候选方向或候选产物。
- `revise_candidate`：要求修改候选。
- `identify_revision_target`：指定修正目标。
- `retry_action`：重试动作。
- `narrow_scope`：缩小范围。
- `open_trace_summary`：查看解释摘要。

动作的标签文案可以本地化为符合网文语境的中文（参考 `47-ui-copy-guidelines.md`），但底层的 API 调用和 `action_type` 必须遵循 Contract。

历史或口语化说法必须映射到 canonical `action_type`：

| 非 canonical 说法 | 必须改用 |
| --- | --- |
| `adopt` / `accept` / `edit_then_accept` | `choose_candidate` 或 `revise_candidate`；真正采纳由后端 adoption boundary 决定 |
| `correct` | `revise_candidate` 或 `identify_revision_target` |
| `abort` / `reject` | `cancel_behavior` |
| `provide_info` / `answer` | `answer_clarification` |
| `resume` / `branch` | 先使用 `continue_dialogue`、`retry_action` 或 `narrow_scope`，除非当前 contract 明确新增 action |

### 4.1 NextAction 到 action_type 的最小映射

| runtime `next_action` | 允许的常见 `action_type` |
| --- | --- |
| `continue_dialogue` | `continue_dialogue`, `choose_candidate`, `revise_candidate` |
| `answer_clarification` | `answer_clarification` |
| `confirm_before_execute` | `confirm_before_execute`, `cancel_behavior` |
| `choose_candidate` | `choose_candidate`, `revise_candidate` |
| `identify_revision_target` | `identify_revision_target`, `cancel_behavior` |
| `retry_action` | `retry_action`, `narrow_scope`, `continue_dialogue` |
| `open_trace_summary` | `open_trace_summary` |
| `no_further_action` | none |

UI 不得把 `next_action`、`action_type` 和按钮中文文案混成同一个字段。

### 4.2 Clarification Card 的非表单形态

`clarification_prompt` 的底层语义是“等待用户补足系统继续推进所需的信息”，但作者可见形态不应默认是表单。

允许的内容形态：

- 缺失项说明：系统还缺什么、为什么需要。
- 已知信息：从上下文推断出的 current parameters。
- 候选方向：系统根据上下文生成的 2-3 个选项。
- 对比说明：不同选项会影响主线、人物、节奏、爽点或风险的方式。
- 自由补充入口：作者可以直接说自己的偏好。

允许的 action：

| 作者可见动作 | canonical `action_type` | 说明 |
| --- | --- | --- |
| 选择这个方向 | `answer_clarification` | 把选择作为作者补充提交给系统 |
| 换一组 | `revise_candidate` | 要求系统重新生成候选 |
| 我补充一下 | `answer_clarification` | 自由文本补充 |
| 暂不处理 | `cancel_behavior` | 取消当前等待态，交由系统返回新的 TurnResult |

禁止：

1. 因为 `required_to_execute` 就把所有 slot 机械渲染成输入框。
2. 把候选值在确认前当作已执行参数。
3. 用 UI 文案创造新的 `action_type`。

### 4.3 多候选逐项操作

当一张 `candidate_set` 同时展示多个条目时，UI 必须先检查
`available_actions[].target_ref` 的真实粒度：

- 若至少两个条目分别存在 `<candidate_set_ref>::<item_id>` 形式的独立 action
  target，卡片使用单选控件绑定“本次操作对象”；未选择时底栏操作禁用，选择后只渲染
  当前条目的 `accept` / `discard` / `edit_then_accept` 动作。
- 单选只限定本次动作目标，不自动废弃其他条目。一次动作完成后，其他仍为 pending 的
  候选继续保留待处理。
- 若 action target 只指向整个 candidate set，则维持整组操作，不得用前端单选制造
  “只处理一项”的假象。
- 该交互对应 Pencil 原型
  `novel-studio.pen → 42§4-adoption-card-exclusive-choice (IIPsi)`。

---

## 5. 验收标准约束

1. 每类卡片都已说明对应的 contract 来源。
2. 绝对没有新增 VS-05 §4 之外的 card type，或 `07-workbench-ui-contract.md` §5 之外的 action type。
3. 卡片状态（如是否完成、是否挂起）必须从 TurnResult、task state、artifact state、adoption state 或 projection state 中读取，不得自造 `card.status`。
4. UI 无法映射的场景，必须先修改当前设计 contract / ADR，不允许在组件里临时命名。
