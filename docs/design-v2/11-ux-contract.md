# UX Contract v2

> 状态：草案
>
> 角色：`docs/design-v2/01-agent-foundation-contract.md` 的 UX Contract 子系统展开文档，并依赖 `docs/design-v2/02-turn-and-task-state-machines.md`、`docs/design-v2/03-conversation-behaviors.md`、`docs/design-v2/06-planning-and-long-run.md`、`docs/design-v2/09-observability-and-audit.md`、`docs/design-v2/10-security-and-budget.md`。
>
> 目标：定义 v2 中 UI 必须消费的稳定运行语义，包括 render mode、message/card taxonomy、progress / warning / interruption / adoption / streaming 语义，以及哪些信息必须显式暴露、哪些不得由前端自行推断。

---

## 1. 文档定位

本文回答 8 个问题：

1. Foundation 到底向 UI 暴露哪些稳定语义
2. 什么是 render mode
3. message 与 card 有什么区别
4. 哪些卡片类型必须存在
5. progress、warning、failure、checkpoint、adoption 这些状态如何投影
6. streaming / interruption 如何进入 UI contract
7. 哪些信息必须显式提供，不能让 UI 猜
8. UX contract 和后续 UI 设计文档、`pencil` 原型的边界是什么

本文不负责：

- 页面布局
- 视觉风格
- 交互动画
- 具体文案措辞

本文只定义 UI 消费 contract。

---

## 2. 设计目标

### 2.1 UI 只能投影运行语义，不能发明运行语义

UI 可以决定：

- 怎么摆
- 怎么分层
- 怎么命名展示

但不能自己创造：

- 新 phase
- 新 task status
- 新 adoption 状态
- 新 confirmation 语义

### 2.2 对话优先，但卡片必须是一等呈现对象

v2 主工作台以对话为主，但系统不是纯文本聊天。

因此 UI 必须同时支持：

- assistant message
- structured cards
- progress surfaces
- warning / risk surfaces

### 2.3 关键状态必须显式可见

对于用户需要做决定、等待、确认、恢复、采纳的地方，UI 不应隐藏成一行文本。

必须显式呈现：

- clarification
- confirmation
- checkpoint
- pending adoption
- failure
- escalation required

### 2.4 UI 需要稳定最小语义层

后续即使切换：

- 单栏 / 双栏 / 抽屉
- 对话风格
- 阅读模式
- 结构面板

只要 major version 不变，UI 都应能依赖同一套 Foundation UX contract。

---

## 3. UX Contract 的定义

UX Contract 是 Foundation 向 UI 暴露的运行语义层。

它至少包含：

- message contract
- render mode
- card taxonomy
- progress semantics
- warning / risk semantics
- interruption semantics
- adoption semantics
- streaming event semantics
- visibility rules

它不包含：

- grid 布局
- 视觉组件样式
- 动画节奏
- 品牌设计

---

## 4. 顶层呈现对象

UI 至少要能消费两类顶层呈现对象：

1. `assistant_message`
2. `ui_cards`

### 4.1 assistant_message

用于：

- 主对话流中的自然语言结果
- 对当前动作、状态、结果的主叙述

### 4.2 ui_cards

用于：

- 结构化结果
- 待用户决策的动作
- 风险与警示
- 运行时进度
- adoption / checkpoint / escalation 等非纯文本状态

### 4.3 基本原则

不是每个 turn 都必须有 card，  
但任何需要结构化操作的状态都不应只靠 `assistant_message` 一段话承载。

---

## 5. Render Mode Contract

`render_mode` 用于告诉 UI 这轮输出主要应该如何呈现。

### 5.1 render mode 最小枚举

至少支持：

- `chat`
- `chat_with_cards`
- `cards_first`
- `read_projection`
- `system_notice`

### 5.2 含义

- `chat`
  - 以 assistant 文本为主
  - card 可无

- `chat_with_cards`
  - 文本为主，辅以一个或多个 card

- `cards_first`
  - 核心信息由 card 承载
  - 文本是说明或收束

- `read_projection`
  - 以阅读投影为主

- `system_notice`
  - 以系统状态通知为主

### 5.3 render mode 的限制

render mode 只能描述呈现主导方式，不能替代：

- phase
- status
- card type

---

## 6. Card Taxonomy Contract

card 是结构化 UI 呈现单元。

### 6.1 card 最小字段

至少包括：

- `card_id`
- `card_type`
- `title`
- `summary`
- `status`
- `actions`
- `refs`
- `priority`
- `visibility`

### 6.2 `card_type`

Foundation 至少冻结以下类型：

- `result_card`
- `clarification_card`
- `confirmation_card`
- `warning_card`
- `checkpoint_card`
- `progress_card`
- `adoption_card`
- `failure_card`
- `escalation_card`
- `replay_card`

### 6.3 `actions`

表示 UI 可以提供哪些明确操作。

例如：

- answer
- confirm
- reject
- resume
- cancel
- accept
- edit_then_accept
- discard
- branch

### 6.4 `visibility`

至少支持：

- `primary`
- `secondary`
- `debug_only`

---

## 7. Message Contract

`assistant_message` 是 UI 主对话流的最小单位。

### 7.1 最小字段

至少包括：

- `role`
- `content`
- `message_type`
- `refs`

### 7.2 `message_type`

至少支持：

- `assistant_reply`
- `system_summary`
- `warning_summary`
- `failure_summary`

### 7.3 message 的边界

message 用于叙述，不用于替代结构化控制面。

例如不应仅靠 message 承载：

- clarification 表单
- confirmation 风险详情
- batch adoption 操作

---

## 8. Clarification UX Contract

clarification 必须可见地呈现为待回答状态。

### 8.1 必须暴露的内容

至少包括：

- clarification prompt
- required fields
- optional fields（如有）
- current known parameters
- answer action

### 8.2 默认 card 类型

建议投影为：

- `clarification_card`

### 8.3 不允许的降级

不允许只渲染成一条模糊消息，例如：

- “请补充一下信息”

却不给出系统到底缺什么。

---

## 9. Confirmation UX Contract

confirmation 必须明确呈现风险门。

### 9.1 必须暴露的内容

至少包括：

- risk summary
- budget estimate
- affected scope summary
- confirm action
- reject action

### 9.2 默认 card 类型

建议投影为：

- `confirmation_card`

### 9.3 不允许的降级

不允许只给一个“继续吗”按钮，却不显示：

- 会花多少
- 会写哪里
- 为什么要确认

---

## 10. Warning / Risk UX Contract

warning 和 risk 不等于 failure。

### 10.1 warning 必须暴露的内容

至少包括：

- warning type
- affected scope summary
- recommended action

### 10.2 风险来源

至少包括：

- budget nearing limit
- consistency drift
- provider degraded mode
- partial result
- stale artifact

### 10.3 默认 card 类型

建议投影为：

- `warning_card`

---

## 11. Progress UX Contract

progress 是长跑和多步执行的核心 UI 语义。

### 11.1 progress 最小字段

至少包括：

- `progress_id`
- `subject_ref`
- `status`
- `current_step_summary`
- `completed_count`
- `remaining_estimate`
- `usage_summary`
- `last_updated_at`

### 11.2 典型适用对象

至少包括：

- long-run task
- delegation
- long streaming generation

### 11.3 默认 card 类型

建议投影为：

- `progress_card`

---

## 12. Checkpoint UX Contract

checkpoint 必须是显式可操作暂停态。

### 12.1 必须暴露的内容

至少包括：

- checkpoint reason
- progress summary
- pending artifacts summary
- unresolved items
- resume action
- cancel action
- branch action（如有）

### 12.2 默认 card 类型

建议投影为：

- `checkpoint_card`

### 12.3 checkpoint 不是 failure

UI 不应把 checkpoint 视觉上当成“报错弹窗”。

---

## 13. Adoption UX Contract

adoption 是 UI 必须高度可见的一类结构化动作。

### 13.1 必须暴露的内容

至少包括：

- artifact summary
- artifact status
- target scope summary
- revision base / staleness hint
- accept action
- edit_then_accept action
- discard action

### 13.2 默认 card 类型

建议投影为：

- `adoption_card`

### 13.3 batch adoption

如果支持 batch adoption，UI 仍必须能看见逐项状态，而不是只有一个总按钮。

---

## 14. Failure UX Contract

failure 必须可见，但不等于暴露内部异常堆栈。

### 14.1 必须暴露的内容

至少包括：

- failure summary
- failure class
- subject ref
- retry path（如有）
- fallback suggestion（如有）

### 14.2 默认 card 类型

建议投影为：

- `failure_card`

### 14.3 failure 与 warning 的区别

- warning：仍可继续
- failure：当前路径已不能按原计划继续

---

## 15. Escalation UX Contract

当需要 authority 或 budget 升级时，UI 必须显式进入 escalation 语义。

### 15.1 必须暴露的内容

至少包括：

- escalation type
- current scope
- requested scope
- reason summary
- approve / deny path

### 15.2 默认 card 类型

建议投影为：

- `escalation_card`

---

## 16. Replay UX Contract

replay 是高级能力，但也需要基本 UX contract。

### 16.1 必须暴露的内容

至少包括：

- replay availability
- replay level
- missing raw / trace warnings
- open replay action

### 16.2 默认 card 类型

建议投影为：

- `replay_card`

---

## 17. Streaming UX Contract

streaming 不能只是一段“正在输出”的视觉效果，它必须有正式事件语义。

### 17.1 UI 必须消费的 streaming 事件

至少包括：

- stream_started
- stream_delta
- stream_usage_update
- stream_completed
- stream_failed
- stream_cancelled

### 17.2 streaming 的 UI 语义

UI 至少要知道：

- 当前是否仍在流式进行
- 当前内容是否 partial
- 最终是否已封账为稳定结果

### 17.3 streaming 与 final result

streaming 结束后，UI 必须收到可稳定存档的最终对象，而不是只留屏幕上的增量文本。

---

## 18. Interruption UX Contract

interruption 指运行被暂停、取消或中断。

### 18.1 interruption 最小语义

至少支持：

- `paused`
- `cancelled`
- `interrupted_partial`
- `blocked`

### 18.2 区分点

- `paused`
  - 可恢复

- `cancelled`
  - 明确终止

- `interrupted_partial`
  - 产生了部分结果

- `blocked`
  - 被 guard 或 consistency 阻断

### 18.3 UI 必须显式区分

不能把这些全都做成一个“已停止”标签。

---

## 19. Visibility Rules

不是所有运行信息都应该默认展示在主工作台。

### 19.1 `primary`

必须默认可见。

至少包括：

- clarification
- confirmation
- checkpoint
- adoption
- failure
- escalation

### 19.2 `secondary`

默认可折叠或次级可见。

例如：

- detailed progress
- usage summary
- warning details

### 19.3 `debug_only`

仅高级调试视图可见。

例如：

- trace refs
- raw provider refs
- low-level structured logs

---

## 20. Action Contract

card 上的 action 也必须是结构化对象，而不是 UI 自己拼按钮。

### 20.1 最小字段

至少包括：

- `action_id`
- `action_type`
- `label`
- `target_ref`
- `enabled`
- `requires_confirmation`
- `style_hint`

### 20.2 `action_type`

至少支持：

- answer
- confirm
- reject
- resume
- cancel
- accept
- edit_then_accept
- discard
- branch
- open_replay

### 20.3 `enabled`

UI 不应靠本地猜测按钮是否能点，必须由 contract 明确给出。

### 20.4 与 NextAction 的映射

`NextAction` 是运行语义，`action_type` 是 UI 可操作项。二者必须可映射，但不能混成同一个枚举。

| NextAction | 常见 action_type |
|---|---|
| `ASK_USER` | `answer` |
| `CONFIRM_BEFORE_EXECUTE` | `confirm`, `reject` |
| `SHOW_RESULT` | none or domain-specific view actions |
| `RETRY_SYSTEM` | `retry` |
| `RESUME_TASK` | `resume`, `cancel`, `branch` |
| `ADOPT_ARTIFACTS` | `accept`, `edit_then_accept`, `discard` |
| `NO_FURTHER_ACTION` | none |

---

## 21. 与状态机的关系

UX contract 本质上是状态机的投影层。

### 21.1 状态机优先

如果 UI contract 和状态机冲突，以状态机为准。

### 21.2 示例映射

例如：

- turn `NEEDS_CLARIFICATION` -> `clarification_card`
- task `CHECKPOINT` -> `checkpoint_card`
- artifact `TENTATIVE` -> `adoption_card`
- task `RUNNING` -> `progress_card`
- escalation `OPEN` -> `escalation_card`

---

## 22. 与行为协议的关系

clarification / confirmation / cancellation / correction / rejection 的基础语义来自行为协议，UX contract 只负责规定 UI 应如何稳定消费。

### 22.1 不能倒置依赖

不是因为 UI 想做一个卡片，就重新定义一个 behavior。

### 22.2 UX 只规定“如何看见”

行为协议规定“它是什么”，UX contract 规定“它必须怎样被稳定呈现”。

---

## 23. 与 Observability 的关系

UI 可以显示观测摘要，但不能直接依赖低层 trace/log。

### 23.1 UI 可消费的 observability 摘要

至少包括：

- progress summary
- usage summary
- warning summary
- failure summary
- replay availability

### 23.2 UI 不应直接消费

例如：

- raw structured logs
- raw provider payloads
- full audit record

除非进入专门调试视图。

---

## 24. 与 Security / Budget 的关系

高风险动作、budget 命中、authority 不足这些状态必须有明确 UX surface。

### 24.1 UI 必须可见

至少包括：

- risk summary
- budget nearing / exceeded
- blocked reason
- escalation required

### 24.2 UI 不能降级成静默失败

如果因为 budget 或 authority 不能继续，UI 不应只显示“请求失败”。

必须让用户知道：

- 是什么 guard 挡住了
- 下一步能做什么

---

## 25. 与 Domain 的接口

Domain 可以基于 Foundation UX contract 扩展 domain-specific cards，但不能破坏基础 taxonomy。

### 25.1 Domain 可扩展项

至少包括：

- result_card 的 domain fields
- domain-specific summaries
- domain-specific action labels

### 25.2 Domain 不得改写项

Domain 不得改写：

- clarification / confirmation / checkpoint / adoption / failure / escalation 这些基础 card 语义
- render mode 的基础含义
- action 基本结构

---

## 26. 持久化与回放要求

UI contract 不只是即时渲染，也必须支持回放。

### 26.1 至少要可回放的对象

至少包括：

- assistant_message
- card snapshots
- actions snapshot
- render_mode

### 26.2 回放原则

历史回放时，UI 应优先展示当时的稳定快照，而不是用当前规则重算旧卡片。

---

## 27. 契约测试要求

### 27.1 render mode tests

验证：

- 每个 turn 至少有可解析的 render mode

### 27.2 card taxonomy tests

验证：

- clarification / confirmation / checkpoint / adoption / failure / escalation 至少能生成对应 card

### 27.3 action tests

验证：

- card actions 结构完整
- enabled / requires_confirmation 正确

### 27.4 streaming / interruption tests

验证：

- streaming 事件可映射为 UI 状态
- pause / cancel / blocked / partial 可以区分

---

## 28. 本文冻结的硬骨

本文正式冻结以下 UX 硬骨：

1. UI 只能投影运行语义，不能发明运行语义
2. `assistant_message` 与 `ui_cards` 是两类顶层呈现对象
3. render mode 是 Foundation contract，而不是 UI 自造标签
4. clarification / confirmation / warning / checkpoint / progress / adoption / failure / escalation / replay 这些 card type 是基础 taxonomy
5. streaming 和 interruption 必须有正式 UI 事件语义
6. visibility 必须区分 primary / secondary / debug_only
7. action 也是结构化对象，不能只靠前端按钮猜逻辑

---

## 29. 本文暂不冻结的内容

以下只定边界，不定最终实现：

1. card 的最终 JSON schema 细节
2. style_hint 的最终取值
3. result_card 的 domain 字段扩展方式
4. replay card 的最终交互细节

---

## 30. 下一步

Foundation 关键文档到这里已经基本闭环。

下一步更合理的是进入 Domain 层，从：

1. `20-novel-domain-overview.md`
2. `21-novel-object-model.md`

开始，把小说业务层完整接上来。 UI 设计文档和 `pencil` 原型仍然放在 Domain 设计完成之后。
