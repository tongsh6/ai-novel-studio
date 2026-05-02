# Workbench UI 消费契约草案

> 状态：草案（2026-05-02）
>
> 角色：定义 v3 中 Workbench UI 如何消费 TurnResult、BehaviorState、available actions、ui_cards、trace summary、projection hints，以及 UI 事件如何回到 AuthorInput / ActionInput。本文是 ADR 前的 UI contract 草案，不是视觉稿、组件实现或前端技术方案。
>
> 相关文档：
>
> - `00-vision-and-engineering-roadmap.md` — v3 愿景与工程推进方式
> - `00a-reading-map.md` — v3 阅读路径
> - `00b-end-to-end-dialogue-flow.md` — 一次 turn 的动态主链
> - `00c-state-and-contract-atlas.md` — 状态、contract、ADR 候选和 slice 入口索引
> - `00d-runtime-architecture.md` — v3 运行时架构视图
> - `01-user-llm-workbench-interaction-model.md` — 用户、LLM、工作台交互模型
> - `02-dialogue-frame-and-micro-plan.md` — DialogueFrame / MicroPlan 协议草案
> - `03-capability-toolbox-contract.md` — Capability Toolbox 协议草案
> - `04-execution-orchestrator.md` — Execution Orchestrator 协议草案
> - `05-turn-behavior-and-state-model.md` — Turn Behavior 与状态模型草案
> - `06-memory-context-and-trace.md` — Memory、Context、Trace 与 Replay 草案
>
> 本文不做：
>
> - 不定义最终视觉设计、布局、组件样式或交互动效
> - 不定义前端技术栈、路由、状态库或具体组件文件
> - 不定义后端 API payload 最终 schema
> - 不允许 UI 直接调用工具、Repo、Agent 或 Orchestrator 内部函数
> - 不允许 UI 反向定义 intent、slot、behavior、policy 或 trace 语义

---

## 1. 定位

Workbench UI 是 v3 的作者前台体验层。

它的职责是：

```text
呈现 LLM 创作伙伴的回应；
呈现候选、确认、澄清、修正、恢复等可操作状态；
收集作者输入、选择、确认、取消或重试；
把这些动作作为新的 AuthorInput / ActionInput 提交；
消费 trace 摘要和 projection hints；
不直接改变系统事实。
```

Workbench UI 不是：

- intent router。
- slot form renderer。
- tool launcher。
- behavior state writer。
- trace viewer 的原始日志面板。
- production state writer。
- Orchestrator 的第二实现。

Workbench UI 是：

- TurnResult 的主消费者。
- 作者动作的收集者。
- available actions 的呈现者。
- trace summary 的解释入口。
- projection hints 的刷新消费者。

一句话：

```text
UI 只表达系统已经裁决出的下一步，不替系统裁决下一步。
```

---

## 2. 核心原则

### 2.1 作者面对 LLM 创作伙伴

v3 UI 的第一屏心智应该是：

```text
我正在和一个能理解上下文、提出候选、解释选择、守住边界的创作伙伴协作。
```

而不是：

```text
我正在填写工作台暴露出来的 slot 表格。
```

因此 UI 默认呈现自然对话、候选方向、可解释动作和轻量确认，而不是把内部 schema 直接映射成表单。

### 2.2 UI 消费 contract，不发明 contract

UI 可以根据 TurnResult 渲染：

- `assistant_message`
- `ui_cards`
- `primary_next_action`
- `available_actions`
- `active_behavior_ref`
- `behavior_summary`
- `trace_summary`
- `projection_hints`

UI 不可以自行推导：

- intent
- frame_type
- required slot
- confirmation policy
- authority / budget / policy 结论
- behavior open / close
- production write
- adopted state

### 2.3 UI event 不是状态变化

UI 点击、选择或输入只是作者动作。

```text
UI event
→ AuthorInput / ActionInput
→ Dialogue Planner / Execution Orchestrator
→ TurnResult
→ UI 更新
```

UI event 本身不能直接：

- 关闭 confirmation。
- 写入 project canon。
- 采纳 candidate。
- 取消 tool task。
- 重试高风险动作。
- 修改 BehaviorState。

### 2.4 TurnResult 是唯一主出口

Workbench UI 主渲染只依赖 TurnResult。

Trace、ToolResult、BehaviorState、MemoryItem 可以被 TurnResult 引用，但 UI 不直接把它们当主数据源。

---

## 3. UI 消费对象

### 3.1 TurnResultViewModel

UI 消费的主对象可称为 `TurnResultViewModel`。

它不是后端最终 schema，只是 UI contract 草案。

| 字段 | 必须 | 含义 |
|---|---|---|
| `turn_id` | 是 | 当前 turn |
| `assistant_message` | 是 | 作者主消息 |
| `turn_phase` | 是 | 来自 Turn Behavior |
| `turn_status` | 是 | 来自 Turn Behavior |
| `primary_next_action` | 是 | 主下一步动作 |
| `available_actions` | 是 | 可触发动作集合 |
| `ui_cards` | 是 | 可渲染卡片集合 |
| `active_behavior` | 否 | 当前 active behavior 摘要 |
| `trace_summary` | 否 | 可展示解释摘要 |
| `projection_hints` | 是 | 已采纳状态后的刷新提示 |
| `disabled_reason` | 否 | 当前无法行动的原因 |
| `safety_notice` | 否 | 可展示风险或权限提示 |
| `debug_refs` | 否 | 开发/debug 可用引用，不进入普通主界面 |

约束：

1. `assistant_message` 必须和 trace / state 事实一致。
2. `available_actions` 必须来自 Orchestrator 裁决。
3. `ui_cards` 必须来自 TurnResult，不由 UI 自行创建业务卡。
4. `projection_hints` 只能提示刷新，不能授权 UI 写入。
5. `debug_refs` 不能被普通作者视图当作业务数据。

### 3.2 ActiveBehaviorView

UI 可以展示 active behavior 摘要。

| 字段 | 含义 |
|---|---|
| `behavior_ref` | BehaviorState 引用 |
| `behavior_type` | clarification / confirmation / selection / correction / cancellation / recovery |
| `status` | awaiting_author / awaiting_tool / resolving 等 |
| `summary` | 可展示摘要 |
| `target_summary` | 行为目标摘要 |
| `primary_next_action` | 主动作 |
| `available_actions` | 可选动作 |
| `expires_hint` | 可选过期提示 |
| `trace_summary_ref` | 可解释引用 |

UI 只能展示和提交动作，不能更新 lifecycle_status。

### 3.3 TraceSummaryView

UI 展示 trace summary，而不是内部 trace。

| 字段 | 含义 |
|---|---|
| `trace_ref` | DecisionTrace 引用 |
| `summary` | 作者可读解释 |
| `reason_codes` | 可选机器可读原因 |
| `visible_steps` | 可展示步骤 |
| `redaction_level` | 脱敏级别 |
| `debug_available` | 是否有 debug 视图 |

可展示例子：

```text
需要确认，因为这会把候选方向写入项目设定。
```

不可展示例子：

```text
完整 provider prompt、隐藏 policy、敏感 memory、内部 scoring 明细。
```

---

## 4. UI 卡片类型候选

`ui_cards` 是语义卡片，不是视觉组件名称。

| card_type | 用途 | 常见来源 |
|---|---|---|
| `candidate_set` | 展示候选方向、候选设定、候选片段 | tentative artifact / candidate memory |
| `clarification_prompt` | 展示需要作者补充的问题 | clarification behavior |
| `confirmation_request` | 展示确认对象、影响范围和风险 | confirmation behavior |
| `selection_prompt` | 等待作者从候选中选择 | selection behavior |
| `revision_target_prompt` | 要求作者定位修正目标 | correction behavior |
| `cancellation_summary` | 展示已取消或正在取消的对象 | cancellation behavior |
| `recovery_prompt` | 展示失败原因和恢复动作 | recovery behavior |
| `trace_summary` | 展示可解释摘要 | DecisionTrace redacted summary |
| `projection_notice` | 展示已采纳状态刷新提示 | projection hints |
| `capability_notice` | 展示系统能力或限制说明 | registry / policy summary |

约束：

1. UI 不自行发明 `card_type`。
2. card 不等于 behavior；candidate card 可以只是创作展示，不一定是 durable selection。
3. card 不等于 action；action 必须来自 `available_actions`。
4. card 展示事实必须和 TurnResult / trace 一致。

---

## 5. AvailableAction 契约

`AvailableAction` 是 UI 可触发动作的 contract。

候选字段：

| 字段 | 必须 | 含义 |
|---|---|---|
| `action_id` | 是 | 动作唯一 id |
| `action_type` | 是 | confirm / cancel / choose / revise / retry / continue 等 |
| `label_key` | 是 | 文案 key，不在 contract 中硬编码最终文案 |
| `target_ref` | 否 | 目标 candidate / behavior / artifact |
| `behavior_ref` | 否 | 关联 BehaviorState |
| `requires_text_input` | 是 | 是否需要作者补充文字 |
| `requires_confirmation` | 是 | 触发该动作后是否还会进入确认，由系统裁决 |
| `enabled` | 是 | 当前是否可触发 |
| `disabled_reason` | 否 | 禁用原因 |
| `risk_hint` | 否 | 风险提示 |
| `submission_contract` | 是 | UI 提交时必须带上的字段 |

action_type 候选：

| action_type | 含义 |
|---|---|
| `continue_dialogue` | 继续自然对话 |
| `answer_clarification` | 回答澄清 |
| `confirm_before_execute` | 确认执行 |
| `cancel_behavior` | 取消等待态 |
| `choose_candidate` | 选择候选 |
| `revise_candidate` | 修改候选 |
| `identify_revision_target` | 指定修正目标 |
| `retry_action` | 重试动作 |
| `narrow_scope` | 缩小范围 |
| `open_trace_summary` | 查看解释摘要 |

约束：

1. UI 只能提交 `available_actions` 中的动作。
2. 禁用动作不能通过隐藏参数强行提交。
3. `confirm_before_execute` 必须带 behavior_ref 和 target_ref。
4. `retry_action` 必须经过 Orchestrator 重新 gate。
5. `open_trace_summary` 是读动作，不改变业务状态。

---

## 6. UI 输入回传

UI 回传给系统的输入分两类：

| 输入 | 来源 | 含义 |
|---|---|---|
| `AuthorTextInput` | 自由文本 | 作者继续自然对话 |
| `AuthorActionInput` | 点击/选择/确认/取消 | 作者对 available action 的响应 |

### 6.1 AuthorTextInput

候选字段：

| 字段 | 必须 | 含义 |
|---|---|---|
| `input_id` | 是 | 输入 id |
| `turn_parent_ref` | 否 | 来源上一轮 |
| `text` | 是 | 作者输入文本 |
| `active_behavior_ref` | 否 | 输入时 UI 看到的 active behavior |
| `client_context_ref` | 否 | UI 本地上下文引用 |
| `idempotency_key` | 是 | 防重复提交 |

### 6.2 AuthorActionInput

候选字段：

| 字段 | 必须 | 含义 |
|---|---|---|
| `input_id` | 是 | 输入 id |
| `source_turn_ref` | 是 | 产生 action 的 TurnResult |
| `action_id` | 是 | AvailableAction id |
| `action_type` | 是 | 动作类型 |
| `target_ref` | 否 | 目标对象 |
| `behavior_ref` | 否 | 关联 behavior |
| `payload` | 是 | 选择、补充文本、确认范围等 |
| `idempotency_key` | 是 | 防重复提交 |

约束：

1. UI 必须回传 `source_turn_ref`，避免把旧 action 应用到新状态。
2. UI 必须回传 `action_id`，不能只回传按钮文字。
3. UI 不提交 hidden execution flags，如 `approved=true`。
4. 系统必须重新校验 action 是否仍有效。

---

## 7. 状态渲染矩阵

| turn_status | primary_next_action | UI 主呈现 | UI 不应做 |
|---|---|---|---|
| `conversational` | `continue_dialogue` | 自然对话输入 | 强制表单 |
| `candidate_presented` | `continue_dialogue` / `choose_candidate` | 候选卡 + 继续讨论 | 默认采纳候选 |
| `needs_clarification` | `answer_clarification` | 自然问题或 clarification card | 直接写 slot production |
| `needs_confirmation` | `confirm_before_execute` | 确认卡，说明对象与影响 | 本地关闭 confirmation 并写入 |
| `needs_selection` | `choose_candidate` | 候选选择卡 | 把选择当成 adoption |
| `needs_revision_target` | `identify_revision_target` | 修正目标提示 | 猜测目标并覆盖 |
| `awaiting_tool` | `wait_for_tool` | 执行中状态，可有取消动作 | 假装已完成 |
| `failed_recoverable` | `retry_action` / `narrow_scope` | 恢复卡 | 只显示 generic failed |
| `completed` | `no_further_action` | 完成状态 + 后续引导 | 隐藏已发生写入事实 |
| `cancelled` | `continue_dialogue` | 取消摘要 | 丢失被取消对象 |

---

## 8. 候选、选择与采纳

v3 UI 必须清楚区分三件事：

```text
candidate presented
≠ candidate selected
≠ candidate adopted
```

| 阶段 | UI 可以展示 | UI 可以提交 | 不能宣称 |
|---|---|---|---|
| candidate presented | 候选集 | 继续讨论、选择、改写 | 已写入项目 |
| candidate selected | 选择意图 | choose_candidate action | 已采纳 |
| adoption confirmed | 确认卡 | confirm_before_execute | 执行前已完成 |
| adopted | 完成结果 | 后续继续 | 未经 trace 的状态变化 |

约束：

1. candidate card 必须标识 tentative。
2. 选择 candidate 后是否需要 confirmation 由 Orchestrator 决定。
3. adoption 后 UI 才能展示 production state 已更新。
4. projection notice 必须来自 adopted StateTrace。

---

## 9. Clarification 与表单边界

clarification 是作者可理解的问题，不是默认字段表单。

UI 可以使用：

- 自然语言问题。
- 少量候选选项。
- 对比卡。
- 简短输入框。
- 必要时的结构化字段。

UI 不应：

- 把所有 missing slot 渲染成字段表。
- 在没有 `needs_clarification` 时主动要求填字段。
- 把 optional detail 当成 blocking slot。
- 直接把输入写入 production state。

结构化字段仅在以下情况使用：

1. TurnResult 明确给出 `clarification_prompt` card。
2. fields 来自 TurnResult，不由 UI 根据 schema 生成。
3. 字段数量少，且服务当前 blocking path。
4. 提交后仍作为 AuthorActionInput 进入 Orchestrator。

---

## 10. Confirmation 边界

confirmation UI 必须说明：

- 确认对象。
- 影响范围。
- 是否写入 production。
- 是否消耗明显预算。
- 是否可撤销或如何修正。
- 可选动作：确认、取消、修改范围。

confirmation UI 不能：

- 只显示一个泛化“确定吗”。
- 把确认按钮直接映射为 production write。
- 在没有 behavior_ref 时提交确认。
- 把旧确认 action 应用到新 turn。

提交 confirmation：

```text
AuthorActionInput {
  action_type = confirm_before_execute
  source_turn_ref = ...
  behavior_ref = open_confirmation
  target_ref = ...
}
```

系统收到后必须重新 gate。

---

## 11. Trace Summary

Trace summary 是解释入口，不是 debug console。

UI 可展示：

- 为什么需要确认。
- 为什么没有执行。
- 为什么展示候选而不是写入。
- 为什么失败但可以重试。
- 哪些内容已采纳。

UI 不展示：

- provider raw prompt。
- hidden policy 全文。
- 敏感 memory。
- 未脱敏 tool input/output。
- 内部 scoring 明细。

Trace summary 层级：

| 层级 | 面向 | 内容 |
|---|---|---|
| `inline_reason` | 普通作者 | 一句话解释 |
| `details_summary` | 作者按需展开 | 关键步骤和影响范围 |
| `developer_debug_ref` | 开发者 | 指向 debug trace，不在普通 UI 主流程 |

---

## 12. Projection Hints

Projection hints 告诉 UI 哪些读模型或视图需要刷新。

它们不是写入授权。

候选字段：

| 字段 | 含义 |
|---|---|
| `projection_ref` | 需要刷新的 projection |
| `reason` | 刷新原因 |
| `source_state_trace_ref` | 来源状态变化 |
| `priority` | high / normal / low |
| `stale_strategy` | 如果刷新失败如何展示 |

约束：

1. UI 可以按 hint 刷新阅读投影。
2. 刷新失败不能把 production state 改回旧值。
3. projection notice 必须能追到 StateTrace。
4. Reading View 不能触发写入 capability。

---

## 13. 错误与恢复

UI 对失败的呈现必须来自 TurnResult。

| 状态 | UI 呈现 | 可用动作 |
|---|---|---|
| recoverable tool timeout | 说明超时，可重试或缩小范围 | retry_action / narrow_scope |
| context incomplete | 说明需要补充或稍后重试 | answer_clarification / retry_action |
| permission rejected | 说明权限不足或替代路径 | continue_dialogue |
| trace summary unavailable | 隐藏详情，保留主状态 | continue_dialogue |
| stale action | 提示动作过期，刷新状态 | continue_dialogue |

约束：

1. UI 不把 recoverable failure 显示成 terminal failure。
2. UI 不把 terminal failure 显示成可继续执行。
3. retry 必须提交 AuthorActionInput，不直接重放 ToolRequest。
4. stale action 必须重新拉取最新 TurnResult。

---

## 14. Stream 与增量更新

v3 可以支持 streaming，但 streaming 不改变 canonical contract。

| 流式内容 | 可增量展示 | 何时成为事实 |
|---|---|---|
| assistant text draft | 可以 | TurnResult emitted 后 |
| candidate draft | 可以 | candidate card emitted 后 |
| tool progress | 可以 | ToolTrace / TurnResult 引用后 |
| trace summary | 可以延迟 | redaction 完成后 |
| projection hint | 不建议提前 | StateTrace 完成后 |

约束：

1. streaming draft 必须标记为 draft。
2. UI 不在 final TurnResult 前宣称执行完成。
3. final TurnResult 可以修正 streaming draft。
4. 用户动作应基于 final available_actions，除非后续 ADR 定义 streaming actions。

---

## 15. 本地 UI 状态

UI 可以有本地状态，但必须限于展示层。

允许：

- 输入框内容。
- 展开/折叠。
- 当前选中的候选视觉态。
- loading / optimistic disabled。
- trace summary 是否展开。
- projection 刷新中提示。

不允许：

- 本地 BehaviorState lifecycle。
- 本地 production write state。
- 本地 authority / budget 结论。
- 本地 ToolRequest。
- 本地 confirmation resolution。

---

## 16. 与 Tauri / Web 的关系

本文不冻结实现平台。

当前项目仍是桌面优先，但 v3 UI contract 应避免绑定到具体运行环境：

- 桌面端、未来 B/S 端都消费 TurnResultViewModel。
- 文件系统、通知、窗口等平台能力由实现阶段技术栈文档和 ADR 决定。
- UI contract 不假设浏览器 API，也不定义 Tauri sidecar 行为。

实现阶段仍必须遵守项目已有前端约束和 v3 后续技术栈文档。

---

## 17. 与 umbrella 边界的关系

本文不冻结模块归属，但给出边界约束。

| 责任 | 倾向位置 | 原因 |
|---|---|---|
| TurnResultViewModel serialization | `novel_web` / API boundary | 对 UI 输出 |
| UI event ingestion | `novel_web` | 转成 AuthorInput / ActionInput |
| action validity check | `novel_application` / Orchestrator | UI 不能自行判断 |
| UI state rendering | frontend | 只消费 contract |
| trace summary redaction | application / web boundary | 输出前脱敏 |
| projection refresh | frontend read model consumer | 按 hint 刷新，不写 production |

禁止方向：

1. frontend 直接调用 `novel_agent`。
2. frontend 直接调用 Repo 或 Ecto query。
3. `novel_web` 绕过 application 生成 ToolRequest。
4. UI action 直接变成 production write。
5. trace debug endpoint 被普通作者主流程依赖。

---

## 18. 后续测试与证明方向

本文仍是设计阶段，不进入代码实现。

后续进入 slice 前，至少需要把以下 proof 写入 slice 设计：

| Proof | 证明什么 |
|---|---|
| TurnResult only render test | UI 主渲染只依赖 TurnResultViewModel |
| no UI invented action test | UI 只能提交 available_actions |
| confirmation binding UI test | 确认必须带 source_turn_ref / behavior_ref / target_ref |
| candidate no adoption UI test | 选择 candidate 不显示已采纳 |
| clarification no schema form test | 未收到 clarification card 时不渲染字段表 |
| trace summary redaction test | UI 不展示内部 raw trace |
| stale action test | 旧 action 不能被当成当前有效动作 |
| projection hint test | projection hint 只触发刷新不写状态 |
| streaming truthfulness test | streaming draft 不宣称 final execution |
| no direct tool call test | UI 不生成 ToolRequest |

---

## 19. 不变量

Workbench UI 必须保护以下不变量：

1. UI 主渲染只消费 TurnResult。
2. UI 不反向定义 intent、slot、behavior、policy。
3. UI 只能提交 AuthorTextInput 或 AuthorActionInput。
4. UI 只能提交 available_actions 中的动作。
5. confirmation action 必须绑定 source_turn、behavior 和 target。
6. candidate selection 不等于 adoption。
7. clarification 不默认渲染成字段表。
8. trace summary 必须经过 redaction。
9. projection hints 只触发刷新，不授权写入。
10. stale action 必须重新经过系统校验。
11. streaming draft 不是 final TurnResult。
12. UI 不能直接调用 toolbox、agent、repo 或 persistence。
13. UI 不能本地打开、关闭或修改 BehaviorState。
14. UI 不能宣称 trace 中未发生的执行事实。
15. UI 不把 debug trace 当普通作者主流程。

---

## 20. 反模式

v3 禁止以下 UI 设计和实现方向：

1. 把 slot schema 直接渲染成主流程表单。
2. 根据缺字段自行打开 clarification。
3. 根据按钮点击直接写 project canon。
4. 候选卡点击后显示“已采用”，但系统还没 adoption。
5. confirmation 只是前端本地 modal。
6. retry 按钮直接重放 ToolRequest。
7. UI 自行判断权限、预算或 policy。
8. trace 面板展示 raw prompt 或敏感 memory。
9. projection refresh 触发写入 capability。
10. streaming 文案提前宣称执行完成。
11. frontend 直接依赖内部 trace schema 主渲染。
12. 为了体验顺滑隐藏 rejected / failed / cancelled 的真实状态。

---

## 21. 后续 ADR 候选

本文建议后续拆出以下 ADR：

| ADR | 冻结内容 |
|---|---|
| TurnResultViewModel v3 | UI 主消费 envelope |
| UI Card Types v3 | card_type 集合与字段 |
| AvailableAction v3 | action envelope、source_turn、behavior_ref、target_ref |
| Trace Summary Visibility v3 | trace summary 层级与 redaction |
| Candidate Selection UI v3 | candidate / selection / adoption 分界 |
| Streaming UI Contract v3 | draft 与 final TurnResult 分界 |
| Projection Hint UI v3 | projection refresh 与写入边界 |

ADR 前还需要完成：

1. `00c-state-and-contract-atlas.md`

原因是 UI contract 已经把 v3 主链输出对象串到作者前台，后续需要用 atlas 汇总 contract、状态、ADR 与 slice 入口。

---

## 22. 下一步

本文完成后，v3 已具备：

- `02`：DialogueFrame / MicroPlan 协议草案。
- `03`：Capability Toolbox 协议草案。
- `04`：Execution Orchestrator 执行裁决边界。
- `05`：Turn Behavior 与 phase/status/next_action 草案。
- `06`：Memory、Context、Trace 与 Replay 草案。
- `07`：Workbench UI 消费契约草案。

下一步建议写：

```text
00c-state-and-contract-atlas.md
```

原因：

- `02` 到 `07` 已经分别定义核心对象、执行边界、行为状态、trace/replay 和 UI 消费。
- `00c` 需要把这些 contract、状态对象、ADR 候选和未来 slice 入口汇总成索引图。
- 没有 `00c`，后续进入承重垂直切面时容易遗漏 contract 或误把草案当冻结 schema。

在 `00c` 之前，不建议创建 implementation plan。
