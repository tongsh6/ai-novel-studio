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
| `46§9-agentic-loop-reasoning-flow`（当前冻结 screen，见 ADR-0022 / ADR-0023 与 `notes/2026-07-01-agentic-loop-reasoning-stream-ui.md`） | 同一 assistant 工作态回复内展示 agentic loop 推理流五态（探索中 / 执行中 / 受阻等待作者 / 重规划 v1→v2 / 完成态）：叙事措辞归模型（浅色左橙边条=模型逐字输出）、结构骨架归 app（状态 chip / 版本 / 进度 / 可选 action）；provider 遥测降级为开发者视图；不展示 raw prompt、provider 术语或私有 chain-of-thought。替代已于 2026-07-01 删除的 `46§8-agent-run-dialogue-flow-v4` |
| `46§9.7-agent-run-control-dock` | active AgentRun 的控制固定在输入区上方；对话内只保留运行记录；暂停/继续共用一个主操作槽位；终止任务独立并二次确认 |
| `46§9.8-quality-revision-ready` | 质量卡只承载问题选择与修订决策；原稿保留独立保存、放弃、编辑后保存动作 |
| `46§9.8-quality-revision-running` | 作者动作回执与来源绑定；同一 revision run 只出现一个 assistant 工作回合 |
| `46§9.8-quality-revision-paused` | 暂停态沿用同一动作回执、assistant 工作回合与固定控制坞，不复制第二套进度 |
| `46§9.8-quality-revision-comparison` | run 终态后固定控制坞收起；原稿与修订稿作为两个独立 tentative 候选分别决策 |

---

## 9. Agentic Loop 推理流（46§9）

> 状态：按 ADR-0022 / ADR-0023 Accepted 与 `notes/2026-07-01-agentic-loop-reasoning-stream-ui.md` 冻结当前 UI 契约。ADR-0023 CP2/CP3/CP4 evidence 已闭合：计划面板消费 `plan_drafted` / `plan_revised` / 结构事件，AgentPlan draft/revision 结构来自 native tool-call arguments；UI 只展示模型作者叙事与 author-safe 结构/telemetry，不展示 tool arguments。

### 9.1 根原则

`46§9-agentic-loop-reasoning-flow` 的根原则是：**UI 只渲染模型原话 + 极薄结构骨架，叙事措辞一律不由 app 写。**

| 内容 | 来源 | UI 责任 |
| --- | --- | --- |
| 状态行 | app enum / run status / phase | 只显示状态 chip、阶段和短结构状态；不得承载模型长叙事 |
| 计划 step 描述 | AgentPlan / PlanStep 中的模型输出描述 | 展示文本；只追加 chip、版本号、状态 |
| 探索发现、评估结论、重规划原因、完成回顾 | 运行中来自 `purpose=author_reasoning` 的 `author_narrative_delta`；完成后来自 `AgentEvent.payload.author_narrative`，且必须绑定 provider output 字节 | 在推理流区域逐条展示，不改写、不补齐；最终 source-bound 事件到达后用结构化事件替换临时流 |
| 授权、工具执行、产物、最终结果 | `gate_decided` / `tool_started` / `tool_completed` / `artifact_created` / `turn_result_ready` / `run_completed` 等结构事件与 final `TurnResult.truthfulness` | 只更新阶段、状态、计数、边界说明和折叠详情；不得伪造模型叙事，也不得要求每个结构步骤都有旧 `exploration_observed` / `evaluation_made` 作者事件 |
| 标签、chip、版本、进度、按钮、折叠入口 | app copy / event_type / status enum | 只表达结构，不写“模型发现/模型认为”的叙述句 |
| 普通 provider run/call ref、chunk、token、phase | provider telemetry | 仅折叠在开发者详情，不进入作者主叙事；`author_reasoning` 的作者可见 planning prose delta 是唯一例外，legacy JSON tail 与 native tool-call arguments 都不得作为作者叙事 |

判定标准：任何一句读起来像在描述模型正在想什么、发现了什么、为什么改计划、为什么完成的中文，必须来自 `author_narrative_delta` 或 `author_narrative`，并通过 N-NARR source binding / streamed-prefix 校验。`AgentEvent.summary`、`ProviderEvent.summary`、前端 copy 常量、legacy JSON tail 和 native tool-call arguments 都不能作为作者叙述来源。

ADR-0023 CP2 的 D1-D7 偏离信号不新增专用 UI 语义：UI 继续消费同一 `plan_revised` 事件、`plan_version`、`reason_codes=agentic_deviation:*`、`evaluation_of_last` 和结构事件。D2 质量行动场景可在同一工作态中出现 pending candidate，但 AgentRun 状态必须仍显示等待作者；D4 gate deny/require_confirmation 只显示授权等待/受阻结构事实，不暗示 writer 已执行；D7 确定性缺口可短暂显示工具进度骨架，但没有 `tool_completed`、artifact 或写入事实时不得显示执行完成或候选产出。上述断言由外部 Tauri verifier 从真实页面和事件日志观察，不要求生产 UI 暴露验收专用 hook。

发送后、模型叙事首个 delta 到达前，UI 必须立即显示同一 assistant turn 的结构性工作态骨架（例如状态 chip 与「正在启动」状态行）。这类即时反馈只能表达“请求已进入工作态/准备中/进行中”等枚举状态，不能补写模型发现或推理内容。

如果一个 active AgentRun 已锚在更早的 assistant turn，而作者又在主输入区补充方向，最新作者输入必须先作为本地作者消息留在 transcript 中；其后仍必须显示当前 run 的结构工作态，作为“系统正在处理这次请求”的位置锚点；即使 run 随后进入 completed / failed / cancelled 终态，该位置锚点也必须保留到下一条作者输入或等价的最终回复接管位置。这可以重复结构骨架，但不能重复或伪造模型叙事。该本地作者消息不等价于第二个后端 `user_message` / turn / run，外部验收必须同时证明页面有本地锚点且网络层没有第二个 `user_message`。

这里的“逐字流式”不是完成后一次性渲染卡片：`purpose=author_reasoning` 的 provider chunk 到达时，`author_narrative_delta` 必须沿同一 `agent_event.provider_progress` 实时进入 46§9 推理区；推理区必须消费未压缩的完整 delta 流并持续累积文本，不能先经过“只保留最新 provider chunk”的详情列表压缩。外部验收至少观察到多个 delta frame 推动同一 reasoning 文本增长。最终 source-bound `author_narrative` 只能替换临时流，不能作为首个作者可见过程叙事。

### 9.2 层级结构

> 修订（2026-07-05，用户拍板，见 `tasks/slices/UA01-agentic-loop-streaming-reasoning-card-simplification.md`）：
> 卡片按「页面元素简化、交互不简化」收敛为**三层**——状态行、计划 checklist、流式推理区。
> 原四层中的独立终态区并入状态行状态 chip；7 节点阶段带、三处 hint 说明文案、
> 步骤 kind/status 双文字标签（保留状态符号）、以及「工作详情」折叠区（模型执行流 /
> 模型调用明细 / 事件序列 / 输出摘要 / 回放边界）整体移除；provider 执行取证走
> trace/replay 与持久化 ProviderRun 事实，不再占据对话卡片。计划 `plan_version`
> pill 仅在 version ≥ 2（发生修订）时显示。

同一 assistant 工作态 turn 内展示三层：

1. 状态行：只展示同一 run 的结构状态、状态 chip（含终态）和短枚举文案；不得重复推理区里的 `author_narrative_delta` / `author_narrative`。
2. 计划：显示 `plan_steps`（状态符号 + 模型 step 描述）；发生修订时显示 `plan_version` pill。
3. 推理：运行中先聚合 `author_reasoning` delta 为一条持续增长的模型原文；最终按事件顺序展示 `plan_drafted / plan_revised / exploration_observed / evaluation_made / mission_derived`（写前推理「本章使命」，WR01 / VS-00E §16）等带 source-bound `author_narrative` 的事件，并去重同一 provider run 的临时 delta；`gate_decided` / `tool_started` / `tool_completed` / `artifact_created` / final `turn_result` 等只作为结构事实更新计划状态与状态行。同一段叙事不得再出现在状态行。

最终正文、候选、修订稿仍走既有 `TurnResult` / tentative artifact 出口。

「为什么」弹窗（WR01c）：`trace_summary.chapter_mission` / `planning_mission` 结构化 payload
渲染为独立使命区块（标签+状态+一句使命+必须推进/不得逐条+依据标签）；缺 payload 的旧 trace
回退一句话 statement。replay 加载成功后区块与广播同源（state_trace_refs 持久，不丢行）。

### 9.3 禁止

- 禁止用 `ProviderActivityProjector`、前端 copy 或 `AgentObservation.summary` 拼作者可见过程叙事。
- 禁止把普通 provider telemetry、raw prompt、provider 私有 reasoning / thinking、完整 ToolRequest 或 native tool-call arguments 放入作者主视图；`author_reasoning` 只能透出作者可见 planning prose，legacy 两段式协议只允许 JSON tail 之前的文本。
- 禁止把 legacy 结构 JSON tail 或 native tool-call arguments 里的字段当作作者叙述渲染；这些结构只能驱动 chip、状态、版本、下一步 action 或 developer-only count/name telemetry。
- 禁止为了验收给生产 UI 增加专用 hook；场景验证必须从真实页面与真实事件投影观察。

### 9.4 叙事体裁对齐：Codex 式工作流呈现（2026-07-15 用户拍板）

> 修订注记：用户以 Codex Desktop 工作流截图为参照拍板对齐方向——AI 响应以
> 「意图开场段 → 折叠活动行 → 阶段结论段 → 轻量进度 → 产物卡」的文档流呈现，
> 文案按写作场景重写。本节不推翻 §9.1 根原则与 §9.2 三层收敛：叙事措辞仍归模型
> （体裁靠提示词引导），新增的活动行与进度行是纯结构件（app copy），归 app。

#### 9.4.1 五要素映射

| Codex 要素 | 写作场景等价物 | 数据来源 | 措辞归属 |
|---|---|---|---|
| 意图开场段（目标+顺序+边界承诺，一段连贯第一人称） | 「先看看你现在的角色阵容，再围绕镜像冲突设计反派；生成的候选只作为草稿等你确认，不会直接写进作品档案。」 | `author_reasoning` 流式 delta（计划起草 call1，已落地） | **模型**（提示词体裁约束） |
| 折叠活动行（「运行了多个命令」「正在编辑文件」） | 「查阅作品档案 · 角色 3 · 设定 2」「正在起草角色候选…」「检索前文 · 第 12-14 章」 | `gate_decided` / `tool_started` / `tool_completed` / `artifact_created` 结构事件 + refs 计数 | **app copy**（中性结构动词模板，禁止"模型发现/认为"句式） |
| 阶段结论段（「范围已核清：只改 X…不新增 Y…」） | 「阵容已核清：确认角色 2 名，无既定反派；候选将围绕稽查线设计，本轮只产出待采纳草稿，不触碰已确认设定。」 | `exploration_observed` / `evaluation_made` 的 `author_narrative`（source-bound） | **模型**（提示词体裁：核清了什么/判断是什么/只动哪里） |
| 轻量进度行（「第 1/6 步 · 2 个文件已更 +25-13」） | 「第 2/4 步 · 1 份草稿待采纳 · 约 1,200 字」 | plan cursor / `pending_artifact_refs` / artifact 字数统计 | **app copy** |
| 产物摘要（文件 diff 列表） | 候选卡 / 采纳卡（已有；2026-07-15 已改逐候选内嵌按钮 + 网格铺开） | `TurnResult.ui_cards` / `adoption_state` | 既有契约 |

#### 9.4.2 布局演进（相对 §9.2 三层）

三层语义不变，呈现体裁调整：

1. 状态行：保留（chip + 短枚举），并入进度行（步数 · 待采纳产物 · 字数）。
2. 计划 checklist：保留。
3. 推理区：从「标签 + 短句列表」改为**文档流段落体**——意图开场段与阶段结论段
   按到达顺序成段渲染（模型原文，不改写）；结构事件不再逐条显示，聚合为段落间的
   折叠活动行（同类连续事件合并计数，点击展开仅显示结构事实：动作 + 对象 ref + 计数，
   无叙事）。

#### 9.4.3 提示词体裁约束（实施时进 prompt 资产，非 UI 责任）

- 计划起草 call1 的 author_reasoning 开场须包含：本轮目标复述、动作顺序、边界承诺
  （不写入/待确认语义）。
- `exploration_observed` / `evaluation_made` 叙事须为成段结论：已核清事实 + 判断 +
  影响范围（内联关键对象名），不再是单短句。
- 体裁约束只影响措辞组织方式；N-NARR 字节绑定、两段式协议、native tool calling 均不变。

#### 9.4.4 活动行 copy 草案（实施时进 copy.ts）

> 收紧（2026-07-15 用户确认「文案几乎全部归 AI」后）：活动行只承担**进行中指示**
> （spinner 的文字形态）；动作**完成后的描述让位给模型的阶段结论段**，系统模板
> 不复述已完成动作，只保留计数/单位等骨架词。

| 结构事件 | 文案模板 | 时机边界 |
|---|---|---|
| tool_started（context/roster/readonly 类） | 「正在查阅{对象}…」 | 仅进行中显示；tool_completed 后该行收起，动作结果由模型结论段叙述 |
| tool_started（creative 类） | 「正在起草…」 | 同上；产物事实由候选卡 + 进度行计数表达 |
| artifact_created | 不产生文案行；进度行计数 +1（「{n} 份待采纳」） | 纯计数 |
| gate_decided（allow_tool） | 无文案（结构静默） | — |
| gate_decided（require_confirmation） | 状态枚举「等待你的确认」（S3 决策面接管） | 状态词，非叙述 |

#### 9.4.5 红线

- 活动行与进度行是结构件：不得出现任何"模型发现/模型认为/模型打算"句式（§9.1 判定标准不放宽）。
- 意图段/结论段若模型未产出（空叙事），UI 显示结构骨架即可，不得由 copy 补写。
- 本节实施须切独立 slice（提示词资产 + AgentRunDialogueFlow 布局 + copy），
  验收沿用 46§9 场景族并按新体裁校准断言；不新增第二套叙事来源或旁路事件。

### 9.5 文档流化：移除常驻计划面板与卡片容器（2026-07-15 用户拍板）

> 修订注记：用户对照 Codex Desktop 参照后拍板——普通对话的计划 checklist 四行
> 恒定（对话 profile 可用步骤只有四个内部管线阶段且依赖链硬约束，模型起草必然
> 全选），描述的是系统内部管线而非创作动作，并与意图开场段的自然语言重复；
> 运行组的卡片容器感与 Codex 文档流差异大。本节修订 §9.2 层级结构。

1. **计划 checklist 不再常驻显示**。计划的顺序与意图由模型意图开场段（§9.4）
   作为唯一作者可见表达；计划修订由 `plan_revised` 的模型结论段叙事表达。
   `plan_drafted` / `plan_revised` 事件、AgentPlan 契约、trace/replay 均不变——
   移除的只是 UI 常驻面板，不是计划语义。
2. **运行组卡片容器视觉移除**（轨道线/面板边界）。AI 的一次回应就是一段文档流：
   模型叙事段落 → 进行中活动行 → 模型结论段 → 回复正文/产物卡，全部内联于同一
   assistant 消息。
   如果最终 `assistant_message.text` 与 `author_narrative` 含有逐字相同的完整段落，
   UI 只保留 `assistant_message` 中的一份；只允许按完整段落做规范化空白后的精确去重，
   不做模糊匹配，不改写模型原文，也不隐藏不相同的过程叙事。
3. **保留的结构物（极简）**：状态词（进行中/已完成/等待你确认）、轻量进度
   （第 n/m 步 · k 份草稿待采纳 · 约 x 字）、进行中活动行（§9.4.4 收紧版）、
   暂停/继续/取消控制。均为骨架词，不叙述。
4. **执行中标识必须全程连续**（2026-07-15 用户补充）：run 非终态期间作者必须
   随时可辨"仍在执行"。实现为事实驱动的双层：①非终态常驻脉冲点（状态词行）；
   ②活动行覆盖两类窗口——工具执行窗口（tool_started→tool_completed，
   「正在起草…/正在查阅…」）与 AI 接口调用窗口（provider_started→同 call_ref
   终态，「正在推理…」，含计划结构化/回应生成/模型 thinking 期）。禁止无事实
   依据的静态"思考中"假占位。
4. **验收口径迁移**：`section[aria-label="计划"]` 结构断言废弃；计划事实断言
   迁至事件流（`plan_drafted` 帧 + plan_steps payload）；恢复场景（reload）断言
   迁为"模型叙事段落从持久化事件重建可见"。

### 9.6 判断循环下的呈现（指向 ADR-0025）

判断驱动交互循环（ADR-0025，2026-07-15 Accepted）下本节语义不变，两点明确：
判断①/②的模型叙事即 §9.4/§9.5 的段落体（意图开场段/阶段结论段体裁沿用）；
**真计划恢复步骤/进度显示**——当模型判断需要并制定了计划（plan_drafted 携带
模型起草结构）时，步骤 checklist 与「第 n/m 步」恢复；无计划循环只有叙事段落 +
活动行 + 状态词。探索动作显示活动行「正在查阅…/正在搜索资料…」。

### 9.7 一体化运行工作区（2026-07-24 用户拍板）

active AgentRun 的暂停、继续、终止和自然语言调整入口不得跟随流式文本宽度或消息高度
移动。控制面采用**对话内状态记录 + 固定的一体化任务工作区**：

1. 对话内的 assistant 工作态展示模型叙事和当前语义活动，但不再承载可操作按钮。
   active run 的状态、结构进度统一由固定控制坞显示，避免两处逐字重复
   “状态 · 任务 · 第 n/m 步”；终态结构结果才随对话保留为历史记录。
2. active run 期间，状态、控制和“调整当前任务”输入合并为一张固定工作卡。它位于
   `chatArea` 滚动容器之外，因此流式文字增长、换行和作者滚动历史都不得改变控制位置。
3. 对话消息、固定工作卡和普通输入区共用同一条 `880px` 最大内容轨道；宽屏居中，窄屏
   使用 `16–32px` 自适应页边距，不允许控制面重新铺满整个左侧工作区。
4. 工作卡状态行消费既有 `agent_run_state`、AgentPlan cursor 和 pending artifact refs，显示
   当前状态与轻量进度；展开后只显示 author-safe 运行摘要，不新增 provider console 或
   raw trace。
5. 状态行右侧保留两个稳定槽位（2026-07-28 DS03 修订：`awaiting_author` 撤出裸「继续」）：
   - 主操作槽位在 `running` 显示「暂停」，在 `paused` 显示「继续」，
     `pausing / cancelling` 显示不可重复触发的处理中状态；暂停和继续不得同时出现。
   - `awaiting_author` 是系统缺作者输入的决策点，不显示「继续」；主操作槽位改为
     补充引导文案，唯一恢复路径是输入非空补充后「发送调整」（服务端拒绝裸 resume）。
   - 危险操作显示「终止任务」，与主操作拉开层级；点击后必须说明影响并二次确认。
6. 工作卡输入行必须持续显示“调整当前任务”语义，提交按钮使用「发送调整」。
   空输入时发送按钮必须明确禁用并降为中性灰；暂停且空输入时「继续」是唯一黑色主操作。
   输入补充要求后，「发送调整」升为黑色主操作，「继续」退为描边操作；运行中的暂停和
   终止始终保持次级/危险层级，避免双主操作竞争。`running` 与 `awaiting_author` 的输入
   占位语分开：前者为“输入调整方向，引导当前任务…”，后者为“输入具体补充后发送，
   任务将按新方向继续…”，不得暗示可以“直接继续”。
7. `paused` 状态必须停止 spinner、呼吸点等运行中动效，语义活动改成
   “已暂停，继续后从当前步骤恢复”；顶栏同步显示“1 个任务已暂停”，不得同时出现
   “无任务”或“正在生成”。`completed / cancelled / failed` 终态同样不得残留
   “正在生成/正在执行”等活动行。
8. 「终止任务」仍提交 canonical `agent_command cancel`，只改作者界面语义，不新增状态和
   command。说明文案必须明确：尚未完成的生成停止；已写入作品的内容不删除；待处理候选
   不自动采纳。
9. run 进入 `completed / cancelled / failed` 后任务工作卡立即收起，并恢复普通对话输入；
   对话内终态记录保留。窄宽度下状态、控制和输入允许分行，但操作顺序与语义不变。
   其中普通聊天的 bounded run 若成功完成且没有独立模型过程叙事、计划、待采纳产物、
   正文草稿或 `author_action` 来源，完整 assistant 回复已经是充分终态反馈，可省略
   “已完成 · 创作执行”结构摘要；失败/取消、durable run、作者动作、计划和产物终态
   仍必须保留。

该布局由 `46§9.7-agent-run-control-dock`（`dxUhh`）冻结。真实验收沿用
`agent-interrupt-safe-point`、`agent-cancel-target-binding` 与
`agent-provider-cancel-honest-boundary`：从固定控制坞操作真实页面，继续证明 command
绑定当前 `run_id`，暂停不请求 ProviderExecution cancel，终止仍走单一取消路径。产品代码
不得增加验收专用 DOM hook。

#### 9.7.1 运行时有效性与恢复面（2026-07-28 DS03 冻结）

历史 `TurnResult.agent_run` 只是可读快照，不授予实时命令权限；控制坞的命令权限
唯一真源是服务端 `agent_run_state` 帧的 `runtime_live` 字段。状态矩阵：

| 状态 | 作者语义 | 主操作 |
|---|---|---|
| `paused` + runtime live | 作者主动暂停，可原地恢复 | 「继续」 |
| `awaiting_author` + runtime live | 缺少作者决策/补充 | 非空输入后「发送调整」；无裸「继续」 |
| bounded runtime dead | 历史任务已失效 | 「重新发起任务」（预填原目标，走新 `user_message`，不向旧 run 发 `agent_command`） |
| durable checkpoint（runtime dead） | 有持久检查点 | 显示“已从检查点恢复，实时控制不可用”；不复用 bounded resume 假象 |
| liveness 未确认（仅历史快照） | 状态确认中 | 全部命令按钮禁用，显示“正在确认任务状态…” |

命令失败（`not_found` / `awaiting_author_requires_input` / `steer_requires_text` /
`run_scope_mismatch` / `timeout` …）在控制坞内显示**单一**内联 system status（按
run/command/reason 去重，成功后清除），不得追加为 assistant 气泡；`not_found` 同时把
该 run 本地降为 dead。command pending 期间所有提交按钮禁用（防连击）。dead run 不再
计入顶栏“进行中任务”聚合，主输入框恢复普通消息语义。

### 9.8 作者动作触发的单一工作回合（2026-07-24 用户拍板）

质量卡等决策面发起 `author_action` 后，不得同时出现“卡片内无限 loading”“游离的泛化
AI 状态块”“固定控制坞”三套并行反馈。动作、运行和结果按一条可恢复的来源链呈现：

1. **决策面只负责决定**。质量卡展示 findings 选择与“生成修订稿”动作；服务端确认启动
   后折叠为“质量复核：n 项建议 · 修订任务已提交”的可展开摘要，不继续用大面积警告卡或
   spinner 冒充整段运行进度。
2. **动作必须有回执**。`action_result` 返回稳定 `receipt_id`、`run_id`、
   `source_turn_ref`、`source_surface_ref` 与 trigger；对话显示
   “你选择了：按 n 项质量问题生成修订稿”，并明确来源质量卡与目标原稿。它是
   `author_action` 回执，不得伪装成第二条 `user_message`。回执与对应 assistant 工作回合
   必须组成同一来源链，不能被大段垂直留白切散。
3. **一个 run 只有一个 assistant 工作回合**。同一回合原地消费模型叙事、
   `current_activity`、轻量进度与终态 TurnResult；不得再追加一个仅含
   “创作执行 / 当前创作请求进行中”的泛化状态块。活动行只显示一次当前活动。
4. **固定坞只控制同一 run**。控制坞消费与 assistant 工作回合相同的 `run_id`，
   只承担状态、结构进度、暂停/继续/终止与 steering；不得复制模型叙事或活动文案。
5. **来源绑定必须可恢复**。AgentRun 持久 `trigger.kind=author_action` 及动作/来源/
   目标/finding refs；页面刷新后通过活跃 run 状态恢复回执与工作回合锚点，不创建
   第二个作者 turn，也不重新调用 provider。
6. **候选独立且动作有主次**。原稿与修订稿各自显示同构候选操作组：保存为主操作，
   编辑后保存为次操作，放弃为低层级危险操作并二次确认。两者都是独立 tentative
   artifact，生成修订稿不锁定、不覆盖、不自动采纳原稿；若作者先后保存两个版本，
   沿用既有 revision conflict/确认边界。
7. **失败诚实收束**。run 启动失败不得留下幽灵回执或永久 loading；运行失败时回执保留，
   同一 assistant 工作回合显示失败与恢复建议，控制坞收起。
8. **质量发现必须可核对**。展开态 finding 不能只给抽象结论；必须同时显示原句、句段位置、
   判断理由、影响范围和置信度。形式统计只是候选来源，UI 只展示经过语义确认后的 finding，
   不展示“同句首/同标点”即等于文学问题的机械结论。
9. **修订动作按范围命名**。所选 finding 全为 `local` 时主动作写“局部修订所选问题”；
   最高范围为 `paragraph` 时写“修订相关段落”；存在 `chapter` 时写“按所选问题修订整章”。
   运行中与暂停态的模型叙事必须说明实际范围，不能继续使用泛化的“整篇重写”文案。

运行态公开契约最小形状：

```text
trigger = {
  kind, receipt_id, action_id, action_type,
  source_turn_ref, source_surface_ref,
  target_artifact_ref, quality_finding_refs
}

current_activity = {
  kind, phase, completed_steps, total_steps
}
```

本节由四个 `46§9.8-quality-revision-*` Pencil frame 冻结。场景验收必须从真实质量卡
点击开始，证明仅产生一次 `author_action`、零第二条 `user_message`，回执/run/source
绑定一致，刷新后仍恢复到同一 assistant 工作回合，终态后原稿与修订稿可分别决策。
