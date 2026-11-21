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

草稿产物另消费 `07` §4 S2 已落地的 `accept` / `discard` / `edit_then_accept`，
分别表达采纳、放弃、作者编辑该产物的正文内容后采纳。它们必须来自实际产物的 available_actions，
不得映射为创作方向的 choose_candidate。对话中的修订/放弃按 ADR-0027 D5 绑定已有对象；
修订产生独立待采纳版本，不能把“修改”解释为“修改后采纳”。

动作的标签文案可以本地化为符合网文语境的中文（参考 `47-ui-copy-guidelines.md`），但底层的 API 调用和 `action_type` 必须遵循 Contract。

历史或口语化说法必须映射到 canonical `action_type`：

| 非 canonical 说法 | 必须改用 |
| --- | --- |
| `adopt`（口语“采纳草稿”） | 使用该产物实际提供的 `accept`；编辑正文内容后保存使用 `edit_then_accept`，均经过 adoption boundary |
| `correct` | `revise_candidate` 或 `identify_revision_target` |
| `abort` / `reject` | 取消等待行为使用 `cancel_behavior`；放弃待采纳产物使用其实际 `discard` 动作，不混淆对象 |
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

### 4.4 具有明确修改范围的正文候选编辑

本节适用于具有明确修改范围的正文候选：局部候选的 `modification_scope`、`scope.kind`、effect 必须一致表达 `target_segments` / `replace_segments`，每个 item 带原目标绑定；整章候选必须一致表达 `whole_chapter` / `replace_scope`，item 不得带局部目标绑定字段（包括 null 或空数组）。两者均复用已有 `edit_then_accept`、Workbench 编辑 Dialog、逐 item 正文和同一候选的 `available_actions`。范围、身份或绑定不完整时不得降级为平串编辑；无章级修改范围的其他候选仍沿原编辑合同，`prose_formatting_plan` 继续遵循文末只读预览边界。

**修订来源与动作含义。** `revision_base` / 当前卡片 `revision_of` 表达来源，不自动表示原稿仍待处理。来源为已保存章节的 `chapter:` ref，或已有 `payload.revision_target_status=ACCEPTED` 时，沿用正文候选的保存/编辑后保存动作，不提示“原稿仍保持独立待处理”。现质量角色分类统一消费绑定到当前 artifact 的来源与该状态；显式已采纳/章节来源优先排除，不因 `revise_from_findings`、质量动作或 findings 回落重新判为原稿/修订稿。相反，待处理候选再次修订仍可保留章范围并使用真实原 artifact 来源，不能按 scope 有无排除。冲突来源不推测优先级，无关卡片不得影响当前目标；不增加新角色、状态、动作或 ID 解析平台。

1. **一份候选，一次保存**。一个正文 candidate set 的多个 item 组成同一份候选：局部候选分别绑定修改区域，整章候选按既定顺序组成新正文；两者均按 set 原子采纳。不能套用 §4.3 的单选方案，不能给每个 item 另造采纳按钮。卡片与作品档案入口必须打开同一目标、同一动作的编辑 Dialog。
2. **分项编辑正文**。弹窗沿当前候选的已验证 item 顺序纵向呈现每项只读标题与正文输入框。结构标签使用“修改内容 1”“修改内容 2”等，不把存储片段数称为文学段落数；标题与正文仍取原候选。所有项共享一个“保存修改后的版本”主操作和一个“取消”操作，不提供新增、删除、重排区域或修改目标范围的控件。
3. **说明操作范围**。局部候选说明各项一起采纳，未列出的正文保持原样；整章候选说明各项按原顺序组成完整正文并替换整章，不得误用“未列出的正文保持原样”。标题沿用“修改后保存”。文案仍集中于现有 copy owner，不在组件里复制另一套业务说明。
4. **机器绑定不成为作者文本**。目标 segment IDs、版本、哈希和 item IDs 仅承担内部绑定；不进入可见标签、title、ARIA 描述或输入框。输入框关联可访问的“修改内容 n”及原 item 标题。作者正文中合法出现相同术语时保持原文，不按关键词清洗。
5. **只回传作者改动的正文**。既有 `AuthorActionInput.payload` 承载 `edited_items: [{item_id, body}]`，并保留实际 action/source/target 身份。服务端从原 pending 候选绑定每个唯一 item ID，保留原目标集合、scope、effect、基准版本、哈希和来源。未知、重复、遗漏的 item ID 或客户端注入的目标改动都不能成为采纳授权；本分支不同时发送 `edited_content`，也不由平串正文反推区域。
6. **正文值保持完整**。未编辑项保持原始 body；已编辑项使用正文输入框变更事件提供的完整值。不得 trim、拼接空行、按段落重切或把多个 item 合成一个值。空白检查只决定是否允许提交，不重写正文；任一项为空或只含空白时禁用整组提交，不把它解释为删除区域。
7. **复用现有编辑状态**。扩展当前 `editDialog` 的内容形状，以明确模式区分原平串编辑与局部/整章正文共同使用的 item 列表；不新增平行编辑 store、持久草稿缓存或每 item 的 useState。目标、原候选快照、所有编辑值和 submitting/failed 归同一 Dialog 状态，退役独立的重复提交状态。生命周期与迟到结果约束见 `46` §6.1。
8. **完整可达**。沿用现有 Dialog、textarea、按钮与主题样式；弹窗高度受视口约束，正文列表可滚动，标题、失败提示和统一操作区可达。焦点顺序按正文项顺序，不能因项数增加把保存按钮移到不可达的视口外。

原型入口沿用 `novel-studio.pen` 的 `42§4-adoption-card-states (PZAVY)` 与 `46§9.8-quality-revision-ready (AH4WW)` / `46§9.8-quality-revision-comparison (ksNvT)`；`IIPsi` 表达独立 action 目标的单选，不是这里的多区域正文编辑。当前 Pencil 只有这些编辑入口，尚无独立编辑 Dialog 或多项编辑/失败画面；不得将入口原型声明为本交互已经完成像素或运行验收。

---

## 5. 验收标准约束

1. 每类卡片都已说明对应的 contract 来源。
2. 绝对没有新增 VS-05 §4 之外的 card type，或 `07-workbench-ui-contract.md` §5 之外的 action type。
3. 卡片状态（如是否完成、是否挂起）必须从 TurnResult、task state、artifact state、adoption state 或 projection state 中读取，不得自造 `card.status`。
4. UI 无法映射的场景，必须先修改当前设计 contract / ADR，不允许在组件里临时命名。


## 分段方案的预览（ADR-0029）

沿用 §3 candidate_set 与 42§4-adoption-card-states（PZAVY）的待采纳布局。
`artifact_type=prose_formatting_plan` 时，先显示模型方案说明/理由，再显示独立标注“排版预览”的
完整正文，最后提供“应用分段方案 / 放弃分段方案”。预览为只读的 `formatting_preview`，
不替代模型 item.body；不展示“编辑正文后保存”，调整方案通过对话进行。
文案集中于 copy.ts，动作仍只来自 available_actions；没有新增卡型、隐藏标记或验收入口。
