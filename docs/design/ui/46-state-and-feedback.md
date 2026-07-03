# 46 State and Feedback

> 状态：草案
>
> 角色：定义工作台和长跑任务的各级反馈状态来源及表现要求。

---

## 1. 语义来源

本文所处理的状态及反馈信息投影自：

- `../05-turn-behavior-and-state-model.md`：核心交互轮次、等待作者状态与恢复路径。
- `../07-workbench-ui-contract.md`：TurnResultViewModel、`ui_cards`、`available_actions`、projection hints。
- `../contracts/VS-03-behavior-lifecycle-contract-pack.md`：clarification / confirmation / recovery lifecycle。
- `../contracts/VS-05-ui-roundtrip-contract-pack.md`：当前 UI card type 与 action roundtrip 边界。
- `../contracts/UA-01-unified-agent-run-loop-contract-pack.md`：AgentRun、AgentEvent、agent_run_state 与 provider execution stream 的作者可见边界。
- `../quality/31-novel-quality-gates.md`：质量检查状态投影。
- `../quality/32-human-approval-policy.md`：审批与人工确认策略。

---

## 2. 不负责范围

- 不自造新的运行状态（如自定义一个不在状态机内的 `semi-paused`）。
- 绝不使用仅靠颜色表达状态的 UI 设计（必须有清晰文字标签或图标）。

---

## 3. 基础交互状态

这些属于即时反馈，对应 Turn State Machine。

- **Loading / Thinking**：等待系统处理。展示明确的 Agent 正在思考的提示。
- **Streaming**：结果逐步返回中。文本应当打字机式平滑输出。
- **AgentRun Activity**：AgentRun 内部 step、observation、provider execution event 的作者安全工作轨迹。它是运行轨迹，不是聊天消息。
- **Waiting User (Clarification/Confirmation required)**：交互挂起，等待用户决策。对话流应当停留在对应的 Card 处，并可能在界面底部输入区给予强提示。

### 3.1 AgentRun 与模型执行流反馈

当作者 turn 进入 AgentRun 后，UI 必须把运行反馈放回同一个对话 turn，而不是另开任务面板。目标体验对齐 Codex Desktop 的对话流：简短状态、可展开 details、作者可随时补充方向，最终结果原地落回同一条 assistant 回复。

1. 作者消息之后立即出现一条 assistant 工作态 turn，先用一句短状态说明正在做什么，例如“正在读取角色档案”“正在生成正文草稿”“正在复核质量”。该工作态必须锚定触发它的作者 turn；即使上一轮 final `TurnResult` 或运行事件迟到，也不得漂移到后续作者消息下方。final `TurnResult` 到达后必须把对应 AgentRun 标记为 terminal，下一条普通作者输入不得被旧 run 误判为 steering。
2. AgentRun 内部 step、observation、provider execution event 只进入该 turn 的可展开 details；不得追加为多条 assistant message。
3. Provider execution stream 在 details 中表现为“模型执行流”：开始、正在接收片段、用量待汇总、完成或失败。展开后可以显示用途、模型事件、运行编号、调用编号、状态、输出类型、结果长度和用量计数等作者安全细节，帮助作者理解执行前因后果；不得显示 provider 原文、raw prompt 或私有 payload。
4. 工作态 turn 可以在 details 前显示一行轻量执行摘要，把已发生的 author-safe event 按真实出现顺序归纳为本轮路径，并汇总模型调用次数、结果长度和用量计数。路径不是固定模板：普通对话可呈现“读取上下文 → 调用模型 → 模型判断 → 系统裁决 → 完成回应”；角色设计可呈现“读取上下文 → 执行创作能力 → 调用写作模型 → 生成待采纳候选 → 完成回应”；章节大纲可呈现“读取上下文 → 调用步骤规划模型 → 制定计划 → 系统裁决 → 规划章节大纲 → 调用写作模型 → 生成大纲候选 → 完成回应”；角色演化可呈现“读取上下文 → 调用步骤规划模型 → 制定计划 → 系统裁决 → 更新角色演化记忆 → 调用写作模型 → 生成角色演化候选 → 完成回应”；正文质量 profile 可呈现“读取上下文 → 制定计划 → 系统裁决 → 执行创作能力 → 调用写作模型 → 调用复核模型 → 质量复核 → 生成待采纳候选 → 完成回应”。该摘要只消费已广播/已恢复的 author-safe events，不重新查询 provider，也不替代完整 timeline。这里的“系统裁决”对应 Orchestrator / gate，不表示模型批准自己的执行；只有真实出现 `provider_progress` 时才显示模型调用节点。
5. 右侧作品档案 / 结构面板不承载 AgentRun activity，不变成 Agent 控制台，也不被运行轨迹挤占。
6. active run 期间，主输入框保持可用，但语义切换为“调整当前请求 / 追加要求”，提交后绑定当前 `run_id` 发送 `agent_command steer`，协议层不得创建第二个 `user_message` / 作者 turn / 新 run；UI 层必须把这条作者补充作为本地作者消息显示在主对话流里，并在其后继续显示同一 active run 的结构工作态。
7. `pause` / `cancel` / `steer` 控件只提交后端授权的 `agent_command`，前端不得自行修改 run 状态。
8. 最终正文、修订稿或候选产物仍通过完成态 `TurnResult` / tentative artifact 出口出现，并原地替换或收束同一个 assistant 工作态 turn；中间 provider chunk 不得直接采纳或覆盖产物。
9. 可见事件只显示作者安全摘要、阶段、进度、预算或风险；不得显示 raw prompt、chain-of-thought、API key、provider 私有 payload 或完整 ToolRequest。

#### 3.1.1 Assistant 工作态 turn

工作态 turn 是 AgentRun 在聊天流中的唯一主呈现。它由三层组成：

| 层级 | 默认可见 | 内容 | 禁止 |
| --- | --- | --- | --- |
| Status line | yes | 一个短动词状态 + 当前目标，例如“正在整理章节上下文” | 不显示内部 module / function / provider prompt |
| Activity details | collapsed | 本轮路径摘要、step 摘要、observation 摘要、provider execution progress、计划/裁决编号、provider run/call refs、预算/用量摘要 | 不显示 chain-of-thought、raw prompt、完整 ToolRequest 或 provider 原文 |
| Result slot | yes when ready | 最终 assistant text、ui_cards、tentative artifact 摘要 | 不让中间 chunk 静默覆盖原稿或修订稿 |

状态推进示例：

```text
作者：帮我重写第三章这一段，让节奏更紧。

assistant 工作态 turn：
  正在读取第三章上下文...
  [展开工作详情]

状态更新：
  正在生成修订草稿...
  已收到模型片段 4 / 用量待汇总

作者在输入框追加：
  保留原来的冷峻语气，别太热血。

同一 turn 更新：
  已收到调整，正在按新方向继续...

最终：
  我给你保留了冷峻语气，并把追击段压短成更密的动作节奏。
  [修订草稿 tentative card]
```

这条链路的关键不是把每个 step 显示出来，而是让作者持续知道“当前请求还活着、正在做什么、可以怎样介入”。

---

## 4. 长跑与产物状态 (Task & Artifact States)

长跑任务和生成产物的状态对应 Task/Artifact State Machine 和 Adoption State。

- **Candidate Presented (候选待选择)**：候选方向或暂态产物生成完毕，使用 `candidate_set` 展示；是否产生采纳由后端 adoption boundary 裁决。
- **Checkpoint (中断点)**：任务执行中遇到阈值限制（预算用尽、关键决策点、严重质量警告等）自动暂停。
  - **UI 必须**：在主区域和上下文栏显著提示。
  - 必须提供清晰的 **Checkpoint 原因**（如：预算超支 / 遇到逻辑冲突）。
  - 必须列出正在 pending 的 artifacts。
  - 必须提供清晰的恢复（Resume）、取消（Cancel）或调整（Branch）动作。
- **Failed / Retry (失败/重试)**：
  - 必须区分失败的性质：是需要作者补充信息的 `ask user`？是需要微调指示的 `correction`？是直接废弃的 `discard`？还是系统级的允许原样 `retry`？
- **Resumed / Completed (已恢复/已完成)**：正常结束。

---

## 5. 风险与警告反馈

系统主动暴露的问题，不可忽视。

- **Budget Warning (预算预警)**：当达到 budget guard 阈值时，触发 `confirmation_request`、`recovery_prompt` 或顶部提示，明确指出剩余可用 budget 份额。
- **Quality Warning (质量预警)**：当触发 Quality Finding 时：
  - 若为致命级：直接进入 Checkpoint 或失败。
  - 若为普通警告：以 `recovery_prompt`、`trace_summary` 或 `confirmation_request` 列出影响范围（例如“第二卷的时间线可能与第三章矛盾”），并提供可选的修正操作入口。

---

## 6. 验收标准约束

1. 本文列出的每个状态都已说明来源于哪个底层的 Contract 字段。
2. 约束视觉表现：不能仅靠颜色区分状态（如红绿灯），必须附带文案。
3. 长跑任务的卡片必须显式包含：进度、预算、当前风险及 Checkpoint 原因。
4. 失败状态的处理必须给作者提供明确的下一步分类（重试/修正/废弃/求助）。

---

## 7. 状态来源矩阵

| UI 状态 | canonical 来源字段 | 允许 action | 禁止误用 |
| --- | --- | --- | --- |
| Loading / Thinking | turn phase / status in TurnResultViewModel | none | 不得伪造 running task |
| Streaming | streaming event + current turn ref | none / `cancel_behavior`（若 available action 明确提供） | 不得把 partial text 当 accepted artifact |
| AgentRun Activity | `agent_event` + `agent_run_state` + provider execution event refs | `agent_command` 中后端授权的 pause / cancel / steer | 不得当作 TurnResult；不得放到右侧作品档案面板；不得把内部 step 追加成 assistant message；不得暴露 raw prompt / chain-of-thought |
| Waiting User - Clarification | active behavior clarification + `primary_next_action=answer_clarification` | `answer_clarification`, `revise_candidate`, `cancel_behavior` | 不得绕过 required slot 执行；也不得把 clarification 简化为必填表单 |
| Waiting User - Confirmation | active behavior confirmation + `primary_next_action=confirm_before_execute` | `confirm_before_execute`, `cancel_behavior` | 不得用 adoption 文案表达方向确认 |
| Candidate Presented | `candidate_set` card + candidate available actions | `choose_candidate`, `revise_candidate`, `continue_dialogue` | 不得显示为 authoritative；不得把选择当作采纳 |
| Checkpoint / Recovery | task state / `recovery_prompt` card | `retry_action`, `narrow_scope`, `continue_dialogue`, `cancel_behavior` | 不得在纯 running 中直接分叉 |
| Failed / Retry | turn/task status error 或 projection status failed | `retry_action`, `narrow_scope`, `continue_dialogue` | 不得静默回退成 completed |
| Resumed | task resumes into running through new TurnResultViewModel | none | 不得当作新 task |
| Completed | completed TurnResultViewModel | `open_trace_summary`（若 available action 明确提供） | 不得继续显示 blocking action |
| Budget Warning | budget guard decision / policy summary | `confirm_before_execute`, `cancel_behavior`, `narrow_scope`（按 available action） | 不得只用颜色警示 |
| Quality Warning | `quality_finding.severity` + policy decision | `revise_candidate`, `retry_action`, `narrow_scope`, `confirm_before_execute`（按 available action） | 不得把 `quality_finding.action` 当 `primary_next_action` |
| Projection Stale | `reading_projection_root.status=STALE` | 触发 `intent.REFRESH_READING_PROJECTION` 的入口 | 不得让 UI 自己比较字段猜 stale |

所有状态都必须有中文文案解释，不能只依赖颜色、图标或英文枚举。

Clarification 等待态还必须解释“为什么需要这一步”，并在作者可能不知道答案时提供候选方向或编辑建议。例如：立项、新卷、新章规划不应只提示“请填写核心目标”，而应说明系统可基于上下文先给几种推进方向供作者选择。

## 8. 对应原型 screen

| Screen frame | 必须体现 |
| --- | --- |
| `46§6-checkpoint-feedback` | checkpoint 原因、pending artifacts、恢复/取消/调整动作 |
| `46§7-inline-interaction-states` | 按钮触发后的即时反馈、主对话不重复追加内部状态 |
| `46§9-agentic-loop-reasoning-flow`（探索态 · 未冻结，见 ADR-0022 Proposed 与 `notes/2026-07-01-agentic-loop-reasoning-stream-ui.md`） | 同一 assistant 工作态回复内展示 agentic loop 推理流五态（探索中 / 执行中 / 受阻等待作者 / 重规划 v1→v2 / 完成态）：叙事措辞归模型（浅色左橙边条=模型逐字输出）、结构骨架归 app（状态 chip / 版本 / 进度 / 可选 action）；provider 遥测降级为开发者视图；不展示 raw prompt、provider 术语或私有 chain-of-thought。替代已于 2026-07-01 删除的 `46§8-agent-run-dialogue-flow-v4` |

---

## 9. Agentic Loop 推理流（46§9）

> 状态：按 ADR-0022 Proposed 与 `notes/2026-07-01-agentic-loop-reasoning-stream-ui.md` 落地中的 UI 契约。ADR 未 Accepted 前，本文只冻结当前实现边界，不扩大到新语义授权。

### 9.1 根原则

`46§9-agentic-loop-reasoning-flow` 的根原则是：**UI 只渲染模型原话 + 极薄结构骨架，叙事措辞一律不由 app 写。**

| 内容 | 来源 | UI 责任 |
| --- | --- | --- |
| 状态行 | app enum / run status / phase | 只显示状态 chip、阶段和短结构状态；不得承载模型长叙事 |
| 计划 step 描述 | AgentPlan / PlanStep 中的模型输出描述 | 展示文本；只追加 chip、版本号、状态 |
| 探索发现、评估结论、重规划原因、完成回顾 | 运行中来自 `purpose=author_reasoning` 的 `author_narrative_delta`；完成后来自 `AgentEvent.payload.author_narrative`，且必须绑定 provider output 字节 | 在推理流区域逐条展示，不改写、不补齐；最终 source-bound 事件到达后用结构化事件替换临时流 |
| 标签、chip、版本、进度、按钮、折叠入口 | app copy / event_type / status enum | 只表达结构，不写“模型发现/模型认为”的叙述句 |
| 普通 provider run/call ref、chunk、token、phase | provider telemetry | 仅折叠在开发者详情，不进入作者主叙事；`author_reasoning` 的 JSON 前 delta 是唯一例外 |

判定标准：任何一句读起来像在描述模型正在想什么、发现了什么、为什么改计划、为什么完成的中文，必须来自 `author_narrative_delta` 或 `author_narrative`，并通过 N-NARR source binding / streamed-prefix 校验。`AgentEvent.summary`、`ProviderEvent.summary`、前端 copy 常量和结构 JSON tail 都不能作为作者叙述来源。

发送后、模型叙事首个 delta 到达前，UI 必须立即显示同一 assistant turn 的结构性工作态骨架（例如状态 chip、阶段轨道、工作详情入口）。这类即时反馈只能表达“请求已进入工作态/准备中/进行中”等枚举状态，不能补写模型发现或推理内容。

如果一个 active AgentRun 已锚在更早的 assistant turn，而作者又在主输入区补充方向，最新作者输入必须先作为本地作者消息留在 transcript 中；其后仍必须显示当前 run 的结构工作态，作为“系统正在处理这次请求”的位置锚点；即使 run 随后进入 completed / failed / cancelled 终态，该位置锚点也必须保留到下一条作者输入或等价的最终回复接管位置。这可以重复结构骨架，但不能重复或伪造模型叙事。该本地作者消息不等价于第二个后端 `user_message` / turn / run，外部验收必须同时证明页面有本地锚点且网络层没有第二个 `user_message`。

这里的“逐字流式”不是完成后一次性渲染卡片：`purpose=author_reasoning` 的 provider chunk 到达时，`author_narrative_delta` 必须沿同一 `agent_event.provider_progress` 实时进入 46§9 推理区；推理区必须消费未压缩的完整 delta 流并持续累积文本，不能先经过“只保留最新 provider chunk”的详情列表压缩。外部验收至少观察到多个 delta frame 推动同一 reasoning 文本增长。最终 source-bound `author_narrative` 只能替换临时流，不能作为首个作者可见过程叙事。

### 9.2 层级结构

同一 assistant 工作态 turn 内展示四层：

1. 状态行：只展示同一 run 的结构状态、阶段、状态 chip 和短枚举文案；不得重复推理区里的 `author_narrative_delta` / `author_narrative`。
2. 计划：显示 `plan_version` 与 `plan_steps`；step 的 `kind/status` 渲染为 chip，step 描述来自模型。
3. 推理：运行中先聚合 `author_reasoning` delta 为一条持续增长的模型原文；最终按事件顺序展示 `plan_drafted / plan_revised / exploration_observed / evaluation_made` 的 `author_narrative`，并去重同一 provider run 的临时 delta；同一段叙事不得再出现在状态行。
4. 终态与产物：终态只显示结构标签；最终正文、候选、修订稿仍走既有 `TurnResult` / tentative artifact 出口。

### 9.3 禁止

- 禁止用 `ProviderActivityProjector`、前端 copy 或 `AgentObservation.summary` 拼作者可见过程叙事。
- 禁止把普通 provider telemetry、raw prompt、provider 私有 reasoning / thinking、完整 ToolRequest 放入作者主视图；`author_reasoning` 只能透出 JSON tail 之前的作者可见模型文本。
- 禁止把结构 JSON tail 里的字段当作作者叙述渲染；JSON tail 只能驱动 chip、状态、版本、下一步 action。
- 禁止为了验收给生产 UI 增加专用 hook；场景验证必须从真实页面与真实事件投影观察。
