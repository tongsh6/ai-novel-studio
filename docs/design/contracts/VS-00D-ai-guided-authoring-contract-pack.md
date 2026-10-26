# VS-00D AI-Guided Authoring Contract Pack（AI 引导式创作三层 + Message 契约）

> **2026-10-24 联合修订已接受**：作者确认“确定 开工”，接受 B26/B27 联合设计及 ADR-0001 普通回复来源修订，并授权共享入口实现与验证。下文历史“待 Accepted / 本轮只改文档”描述保留当时语境，不再构成本次实施阻塞；实现和验收仍按各 slice 逐项留证。

> 状态：draft for review（2026-06-13）
>
> 角色：本文定义“AI 如何引导作者进行小说创作”的三层 contract：小说层、当前作品层、本轮引导层；同时定义这三层如何落到每一次 AI 调用的 message layer。本文不引入脱离现有主链的新 runtime 架构；它约束现有 `DialogueGateway / AgentRun → ContextAssembler → JudgmentProtocol → DialogueFrame / MicroPlan → ExecutionOrchestrator → Tool/Provider → TurnResult/Trace` 如何补强小说创作判断能力。
>
> 当前实现事实（2026-10-24 校准）：当前判断入口为 DialoguePlanningService / JudgmentProtocol，计划由 AgenticPlanDraftPlanner 承接；旧 Planner.form_frame / form_micro_plan 已退役。AIMessageEnvelope 仍为质量诊断过渡 builder，本次生产 lib 静态检索未见外部引用，不能当作全调用点接通。生产共享判断/计划入口已按 §11 迁移为单调用 `tool_choice: auto`，两段式已删除；完整协议/业务/页面验收与剩余缺口见 B26 §11–§14，不以本文宣称 G1–G7 已关闭。

---

## 1. 核心问题

本应用的目标不是“给编辑器接一个 AI”，而是让作者通过 AI 的引导完成小说创作。由于 provider 模型本身无状态、非项目专用，小说创作能力必须由 Agent 每一轮构造的会话结构提供。

因此，每轮交互不能只问：

```text
用户说了什么？
```

而必须同时回答：

```text
这轮创作应该按哪些小说原则判断？
当前这本书有哪些真实状态可用？
AI 本轮应该如何引导作者，且哪些判断需要系统校验和作者确认？
```

这就是本文收束的三层 contract；在进入 Accepted ADR 前，本文仍是 Proposed contract pack，不宣称当前代码已经完整实现。

三层 contract 必须同时存在于两个层面：

| 层面 | 责任 | 反模式 |
|---|---|---|
| 架构层 | 规定系统如何组装、校验、裁决和留痕 | 只把“小说原则”写进不可审计的 prompt 文案 |
| AI message 层 | 规定每次发给 AI 的 messages 中有哪些分层内容、来源、缺失处理和输出 contract | 让模型面对散乱上下文，自行猜测当前作品状态和本轮任务 |

本文后续所有实现分期都必须同时回答：架构对象怎么承载，以及最终发给 AI 的 message 怎么呈现。

---

## 2. 三层 Contract

三层 contract 是信息与判断职责的分层，不是三个新增 runtime component。它们最终会投影到 `DialogueContext`、`DialogueFrame`、`MicroPlan`、ToolInput、TurnResult 和 Trace，也会投影到 provider 可见的 messages。

### 2.1 小说层：Novel Creation Contract

小说层是跨作品、跨 turn 的通用创作判断框架。它回答：

```text
什么是有效的小说创作判断？
AI 引导作者时应该检查哪些创作维度？
```

小说层不属于某一本书，也不由作者每轮手动填写。它来自设计文档、ADR、质量门和项目内置创作规则，是 Agent 给 AI 的“创作判断框架”。

最小内容：

| 维度 | 判断问题 |
|---|---|
| 欲望 | 主体想要什么，目标是否具体、有压力 |
| 阻力 | 目标为什么难，冲突是否能推动行动 |
| 变化 | 人物、关系、局势或读者认知是否发生变化 |
| 代价 | 获得与失去是否同时存在，选择是否有重量 |
| 读者期待 | 本轮是否制造、推进或兑现承诺 |
| 人物动机 | 行动是否来自角色内在动机，而不是剧情硬推 |
| 章节功能 | 本章/本场承担推进情节、人物变化、信息释放、伏笔动作中的哪一项或几项 |
| 信息释放 | 读者知道什么、不知道什么、何时知道 |
| 伏笔 | 本轮是新埋、推进、回收还是避免破坏伏笔 |
| 连续性 | 设定、时间线、人物状态、关系状态是否仍一致 |
| 文风 | 视角、语气、节奏、对白和描写密度是否服务类型与作者意图 |
| 质量门 | 是否需要提醒、重试、确认、阻断或进入采纳审查 |

实现原则：

1. 小说层必须版本化，可被 trace 引用；不能散落在不可追踪 prompt 文案里。
2. 每轮 Planner 调用至少应携带压缩版小说层核心原则和要素索引。
3. 工具执行或正文生成时，应携带与本轮写作坐标相关的小说层切片，而不是完整教材式 prompt dump。
4. 小说层只能提供判断框架，不能替代当前作品事实。

### 2.2 当前作品层：Work State Contract

当前作品层是当前作品的真实状态投影。它回答：

```text
这本书现在已经是什么？
这一轮 AI 可以基于哪些有来源的作品状态进行判断？
```

当前作品层由 `DialogueContext` 承载和投影。当前实现已经有 `current_work_snapshot`、`conversation_summary`、`memory_summary`、`open_behavior_summary`、`current_chapters`、`context_refs`；未来需要沿这个对象补强，而不是另起一套并行上下文。

目标内容：

| 维度 | 来源 | 约束 |
|---|---|---|
| work snapshot | 已有作品元信息 | 只能来自 persistence / 已组装上下文 |
| 写作坐标 | 当前 work / volume / chapter / scene / authoring mode | 不能让 AI 从自由文本里静默猜成事实 |
| 章节结构 | 章节标题、顺序、计划摘要、前后章位置 | 目标章必须可追踪 |
| 章摘要 | 已采纳正文的压缩总结 | 未生成或过期时要显式缺失 |
| 前文正文 | 仅与当前坐标相邻或强相关的 excerpt | 超预算必须省略留痕 |
| 人物状态 | 当前动机、关系、伤势、立场、弧光阶段 | 不能由 AI 编造 |
| 伏笔/信息/情绪进度 | 进度账或其近似摘要 | 缺失时不能假装存在 |
| 风格与作者意图 | 作者偏好、文风、反馈 patch | 与作品事实分开 |
| context refs | 来源引用 | AI 输出事实必须能回溯来源 |

实现原则：

1. 当前作品层必须 evidence-bound：没有来源的状态不能作为作品事实进入 prompt。
2. AI 可以指出缺失或怀疑冲突，但不能直接创造当前作品状态。
3. `ContextAssembler` 是该层进入 Planner / Tool 的入口；Planner 不直接访问 Repo。
4. `DialogueContext` 的扩展应优先服务真实消费者：Planner、MicroPlan、CreativeProvider、Trace、Replay。

### 2.3 本轮引导层：Turn Guidance Contract

本轮引导层是 AI 在 Planner 阶段对“这一轮该如何推进”的结构化判断。它回答：

```text
作者这一轮处于什么创作问题？
AI 应该探索、结构化、执行、质量诊断，还是先澄清/确认？
```

该层必须由 AI 参与判断，因为它涉及作者自然语言、创作语义、质量诊断和取舍解释；但 AI 只能提出判断，不能独自决定执行和写入。

目标内容：

| 字段/概念 | 含义 | 当前落位 |
|---|---|---|
| frame_type | 结构业务操作的认知类型；普通回复默认仅展示用途 | 已有 DialogueFrame.frame_type；无工具回复按 §11.4，不把默认值当模型判断 |
| dialogue_goal | 本轮对话目标 | 已有 `DialogueFrame.dialogue_goal` |
| guidance_mode | 探索 / 结构 / 执行 / 质量 / 澄清 / 确认 / 无引导 | 目标 schema；当前可先作为 `evidence_summary` 或 `uncertainty` 过渡 |
| element_focus | 本轮重点小说要素，如人物动机、章节功能、信息释放 | 目标 schema；可先进入 trace / evidence |
| missing_questions | 继续前必须问作者的问题 | 可映射到 clarification / uncertainty |
| risk_flags | 连续性、质量、越权、缺上下文风险 | 进入 uncertainty / Orchestrator gate / trace |
| output_contract | 本轮希望 AI 返回诊断、选项、正文、修订建议或确认问题 | 影响 MicroPlan / ToolRequest / provider prompt |

实现原则：

1. 当前本轮引导入口为 DialoguePlanningService / JudgmentProtocol；由 AI 做创作语义判断，旧 Planner.form_frame 不作为新实施落点。
2. `DialogueFrame.validate/1` 和后续 schema 校验负责保证 AI 输出结构合法。
3. `MicroPlan` 只能表达下一步行动建议，不能把引导判断升级为执行批准。
4. `ExecutionOrchestrator` 仍负责权限、风险、写入、确认、采纳边界。
5. 作者最终决定方向、确认高风险变更、采纳或拒绝候选。

---

## 3. 决策分权

| 角色 | 决定什么 | 不能决定什么 |
|---|---|---|
| 作者 | 创作偏好、最终取舍、是否确认/采纳 | 不需要手动选择每个小说要素或上下文切片 |
| AI / Planner | 作者意图解释、创作问题诊断、guidance mode 建议、要素聚焦、信息缺口与只读取证请求、候选方向、风险提示 | 不能声明对象真实存在、不能批准执行、不能写入权威状态；不能以“求证”为由绕过 Orchestrator |
| Agent / Application | 组装最小可信底座、执行真实读取、校验结构、检查对象存在、控制预算、省略留痕、执行门禁、trace/replay | 不能用硬编码规则替代全部创作语义判断，也不能替模型伪造信息需求或观察 |
| Orchestrator | 是否允许工具调用、是否需要确认/澄清/降级/拒绝 | 不能替作者发明创作目标，也不能替模型选择作品知识或暗中改写求证计划 |
| Provider | 根据初始 Base 与本 run 实际观察做推理和生成，可通过注册工具判断相关性并请求材料 | 不能直接读取 Repo、决定权限或把未实际返回的作品状态当成已知 |

原则：

```text
AI 参与创作判断；
Agent 约束和取证；
Orchestrator 裁决执行；
作者保留创作主权；
系统对账产出与义务。
```

第五行（2026-08-30 增补，D8 判例）：前四行只分配了「做事」的权力，没有角色负责
「核对做成了没有」。execute 完成时必须能回答「本产出满足了作者的哪个诉求」——
答不上来即诚实上报，不得静默完成；作者行使主权的前提是系统把可裁决之物端到面前。

---

## 4. AI Message Layer Contract

AI message 层是三层 contract 的运行时投影。它回答：

```text
每一次调用 AI 时，模型实际看见什么？
每一块内容来自哪里？
缺失、冲突、过期或被省略时如何处理？
模型必须返回什么结构，哪些判断要被 trace 和系统校验？
```

### 4.1 MessageEnvelope

所有创作相关 AI 调用都应由同一个逻辑信封推导，而不是在各调用点临时拼接 prompt。

```text
AIMessageEnvelope
  envelope_id             : string
  call_site               : :planner | :micro_plan | :prose_writing | :quality_diagnosis | :memory_summary
  contract_version        : string
  model_profile_ref       : string | nil
  turn_ref                : string
  work_ref                : string | nil
  writing_coordinate      : WritingCoordinate | nil
  novel_layer             : NovelLayerMessage
  work_state_layer        : WorkStateMessage
  turn_guidance_layer     : TurnGuidanceMessage
  output_contract         : OutputContract
  missing_policy          : MissingPolicy
  trace_requirements      : TraceRequirements
```

约束：

1. `AIMessageEnvelope` 是逻辑 contract；不同 provider 可以渲染成不同 role/messages，但语义块不能丢失。
2. `envelope_id`、`turn_ref`、`work_ref`、`trace_requirements` 不必逐字暴露给模型，但必须进入 trace。
3. provider 可见文本只能来自 envelope 的 author-safe 投影，不能让 provider 自行读取 Repo、文件或全局状态。
4. call site 可以选择压缩或展开三层内容，但不能把三层混成一段无法回溯的自然语言。

### 4.2 三层 message block

#### NovelLayerMessage

小说层 message block 给 AI 的不是“写作教材全文”，而是本轮需要使用的判断框架。

```text
NovelLayerMessage
  kernel_version      : string
  always_on_principles: [principle_id]
  expanded_elements   : [element_id]
  quality_gates       : [gate_id]
  selection_rationale : text
  omitted_elements    : [OmittedElement]
```

来源：

- `08-novel-element-model.md` 的要素 × 层级 × 三态。
- `domain/21-novel-object-model.md` 对象骨架、`22` 连续性、`23` 风格与作者意图。
- `quality/31-novel-quality-gates.md` 小说质量门。

缺失处理：

- 小说层原则不应因当前作品缺上下文而缺失；至少要有压缩版核心原则。
- 若某些元素因本轮不相关或预算省略，必须记录 `omitted_elements` 和理由。
- 不允许让 AI 把小说层原则当成当前作品事实。

#### WorkStateMessage

当前作品层 message block 给 AI 的是当前作品的 evidence-bound 投影。

```text
WorkStateMessage
  snapshot_summary       : text | nil
  writing_coordinate     : WritingCoordinate | nil
  chapter_state          : text | structured map | nil
  prior_prose_excerpt    : text | nil
  chapter_summary        : text | structured map | nil
  character_state        : text | structured map | nil
  continuity_ledgers     : text | structured map | nil
  style_intent           : text | structured map | nil
  context_refs           : [ContextSourceRef]
  omission_notes         : [OmissionNote]
  freshness_notes        : [FreshnessNote]
```

来源：

- `DialogueContext` / `ContextPacket`。
- 已采纳作品对象、章节、摘要、记忆、前文 excerpt、人物状态、伏笔/信息/情绪/承诺进度。
- `VS-00C` 中 prose_writing 坐标下的 CreativeDecisionPacket。

缺失处理：

- 缺当前章正文、章摘要、人物状态、伏笔账时，message 必须显式说明缺失，而不是让 AI 假装读过。
- 预算省略要进入 `omission_notes`；过期摘要要进入 `freshness_notes`。
- tentative / candidate / canonical 状态必须分开，不得在 message 中混成“事实”。

#### TurnGuidanceMessage

本轮引导层 message block 给 AI 的是本轮判断任务和输出约束。

```text
TurnGuidanceMessage
  author_input           : text
  open_behavior_summary  : text | nil
  planner_task           : :classify_and_guide | :plan_action | :write | :diagnose | :summarize
  guidance_candidates    : [:explore | :structure | :execute | :quality | :clarify | :confirm | :none]
  required_judgments     : [judgment_id]
  prohibited_claims      : [claim_type]
  output_schema_ref      : string
  author_visible_policy  : text
```

来源：

- 作者原始输入。
- 当前 behavior / confirmation / clarification 状态。
- Planner / MicroPlan / Tool call site。
- Execution Orchestrator 和 policy 对执行边界的要求。

缺失处理：

- 如果作者意图、目标章、执行对象或必要上下文不清楚，AI 应输出缺失问题或风险，而不是直接生成权威结论。
- AI 可以提出 `guidance_mode` 和 `element_focus`，但执行、写入、确认、采纳仍由系统和作者裁决。
- 输出 schema 不合法时，系统必须 fallback / recovery，并在 trace 中记录。

### 4.3 不同 call site 的 message 选择

| call_site | 小说层 | 当前作品层 | 本轮引导层 | 主要输出 |
|---|---|---|---|---|
| `planner` | 必带压缩核心原则；按作者输入展开相关要素 | 中等投影，强调事实来源和缺失 | 最强：判断本轮应探索、结构、执行、质量、澄清或确认 | `DialogueFrame` / evidence / uncertainty |
| `micro_plan` | 只带与 frame 相关的原则和风险 | 只带执行建议所需状态、权限和上下文 refs | 强调下一步行动建议与边界 | `MicroPlan` |
| `prose_writing` | 只展开写作坐标相关原则、风格和质量门 | 最强：前文、章计划、摘要、状态、进度账 | 强调生成任务、读者效果、输出契约 | ToolResult / candidate artifact |
| `quality_diagnosis` | 展开质量门和相关小说要素 | draft / 已采纳上下文 / 设计态与实现态对账材料 | 强调诊断问题、修复方向、是否需要作者确认 | quality finding / revision options |
| `memory_summary` | 只带提炼维度，不带完整创作教材 | 当前 turn 和可采纳事实来源 | 强调 tentative / confirmed / canonical 区分 | Memory candidate / summary |

### 4.4 最终发给 AI 的结构化描述

provider 可见 messages 可以按 provider API 渲染，但语义顺序必须稳定：

```text
SYSTEM / DEVELOPER
  - 你是 AI Novel Studio 的创作协作模型
  - 必须按 NovelLayer / WorkState / TurnGuidance 三层判断
  - 不得把缺失上下文编造成作品事实
  - 不得批准执行、写入或采纳

USER / CONTEXT
  [NovelLayer]
  - 本轮必须使用的小说创作原则
  - 展开的小说要素与质量门
  - 被省略的要素及原因

  [WorkState]
  - 当前作品 snapshot / 写作坐标
  - 章节、摘要、前文、人物、伏笔、信息、情绪、风格状态
  - context refs / omission notes / freshness notes

  [TurnGuidance]
  - 作者原始输入
  - 本轮任务
  - 需要 AI 判断的问题
  - 禁止声明和边界
  - 输出 schema
```

这不是要求所有 call site 都发同样长度的文本；它要求每个 call site 的 message 都能映射回同一个 envelope，并解释“为什么这一轮展开这些内容、省略那些内容”。

> `SYSTEM / DEVELOPER` 块的内容真源、注入点（Provider Gateway）、adapter 渲染、trace 留痕与不变量见 `VS-00H-system-identity-message-contract-pack.md`（2026-10-21 Frozen，CP1–CP3 已实现）。2026-10-21 实现前核查：代码中尚无任何 `role: "system"` 消息，该块此前只存在于本文；CP1 后 Gateway 已注入身份消息。其中“必须按三层判断”一行暂不进入 v1 身份文本，待 §6 G7 信封统一后由本文决定是否升版加入。

### 4.5 MissingPolicy

| 状态 | 含义 | message 行为 | 系统行为 |
|---|---|---|---|
| `absent` | 本轮需要的作品材料不存在 | 明确告诉 AI 不存在，要求提出澄清或降级建议 | trace 记录缺失；必要时阻断执行 |
| `omitted` | 存在但因预算、权限、相关性被裁剪 | 给摘要或 omission note，不让 AI 假装已读全文 | trace 记录裁剪原因 |
| `stale` | 材料可能过期或被替代 | 标注 freshness risk | 降权或要求重新组装 |
| `conflicting` | 设计态、实现态、记忆之间冲突 | 要求 AI 暴露冲突和可选处理，不得自行合并成事实 | 进入 quality / clarification / adoption |
| `unauthorized` | 当前消费者无权读取 | 不进入 provider 可见文本 | trace 记录 redacted / sensitive |

### 4.6 TraceRequirements

每次创作相关 AI 调用都必须能在 trace 中回答：

1. 使用了哪个 `AIMessageEnvelope` 版本。
2. 小说层展开了哪些原则和要素，哪些被省略。
3. 当前作品层包含哪些 `context_refs`，哪些缺失、过期或被裁剪。
4. 本轮引导层要求 AI 判断什么，输出 schema 是什么。
5. AI 输出中的引导判断、风险和缺失问题落到了哪个结构对象：`DialogueFrame`、`MicroPlan`、ToolResult、TurnResult 或 Memory candidate。
6. 系统如何校验、降级、拒绝、追问、确认或交给作者采纳。

---

## 5. 每轮运行形态（基于现有主链）

本文不要求新增 parallel pipeline。目标形态应沿现有主链演进：

```text
AuthorInput
→ ContextAssembler
   - 组装当前作品层：snapshot / memory / chapters / future structured state
→ JudgmentProtocol（由 DialoguePlanningService 调用）
   - 接收小说层压缩原则 + 当前作品层 + 作者输入
   - AI 产出本轮引导判断
→ DialogueFrame.validate
   - 系统校验结构、禁止批准语义
→ 当前 action / plan 编排构造 MicroPlan（按需）
   - AI 提出下一步行动建议
→ ExecutionOrchestrator
   - gate / confirmation / downgrade / allow_tool
→ TurnExecutionService / CreativeProvider
   - 根据已裁决 action 和上下文渲染工具输入
→ TurnResult / Trace / Author action
```

两个关键约束：

1. 第一轮 Planner 判断可以由 AI 参与；它以初始 Base 与小说层原则为起点。需要既有作品证据而 Base 不足时，可以沿同一 AgentRun 发起只读取证，后续判断使用初始 Base 与实际观察，不能把首轮缺失直接当成作品事实不存在。
2. 创作执行阶段不能让 provider 黑箱决定权限或任意读取数据源；它只能消费已经结构化和校验过的 DialogueFrame / MicroPlan / DialogueContext / ToolRequest，以及同一 run 后续真实观察。观察的来源、版本、覆盖与后续请求必须可追踪。

---

## 6. 当前差距

> 2026-10-05 状态校准：以下仍是开放范围，但描述已区分现有实现与剩余缺口。
> 依据：`tasks/slices/AU11-quality-diagnosis-message-envelope.md`、VS-00E 实现与 `tasks/NEXT.md`；
> 既有 proof 为历史证据，本次文档校准不声明重新验收或自动关闭差距。

| # | 差距 | 当前事实 | 完善方向 |
|---|---|---|---|
| G1 | 小说层契约的全调用点覆盖未闭环 | AU11 质量诊断已有 `AIMessageEnvelope.novel_layer` 的原则、要素及质量门投影；不是只有角色 prompt。当前 builder 明确仍为过渡实现 | 核对判断/规划/创作调用点的统一来源与缺失策略，不能以 AU11 单场景代表完整覆盖 |
| G2 | 当前作品层的事实与风格消费仍不完整 | 结构化章计划、摘要、前文及账面消费已有实现；`tasks/NEXT.md` Order 7 仍登记事实/风格输入和省略说明的剩余工作 | 按 Order 7 与具体 flow 实证补齐消费面，不重新建设已有结构链 |
| G3 | 本轮引导字段的正式 schema 与场景覆盖未闭环 | AU11 已在过渡 envelope/trace 记录 guidance_mode、element_focus、risk 与缺失；不能仍视为只有 coarse frame_type | 保留 AU11 的 schema 冻结与 clarify/confirm 等剩余验收，按 ADR 扩展 |
| G4 | 创作决策载体的完整语义投影未闭环 | `CreativeDecisionPacketBuilder` 已传递坐标、章方向、读者效果、作者输入及本章使命，并由 `ProseExecutionBriefBuilder` 消费；continuity/style_intent 等仍是后续 checkpoint | 对齐 VS-00E 的剩余输入维度与实际调用证据，不把已接通载体写成完全脱节 |
| G5 | 要素选择解释尚未覆盖完整调用面 | AU11 质量诊断已有 selection_rationale、omitted_elements 与 element_focus；当前实现只证明该 checkpoint | 扩展真实任务中的要素选择与省略 trace，保留调用点级证据 |
| G6 | 质量门的全链消费与效果验收未闭环 | AU11 有质量门投影，VS-00E 已有正文执行简报、评估与修订服务；不能再称只有风格要求 | 继续核对质量判断的事实输入、作者处置与长篇效果，不把机制存在等同于质量达标 |
| G7 | message envelope 的统一契约与全调用点覆盖未闭环 | `NovelApplication.AIMessageEnvelope` 已有过渡 builder 与 AU11 最小真实页面 proof；独立冻结契约及所有调用点统一尚未由该 checkpoint 证明 | 依契约 call-site 矩阵补齐来源、MissingPolicy 与 TraceRequirements；AU11 局部 closed 不等于本项整体关闭 |

---

## 7. 实现原则（未来 slice 必须遵守）

1. **不推翻现有主链**：所有完善必须穿过 DialogueGateway / ContextAssembler / Planner / DialogueFrame / MicroPlan / Orchestrator / ToolResult / TurnResult。
2. **可执行判断必须结构化，普通回答保留真实认知记录**：对象、操作、来源、范围和可操作结果由明确结构输出承载；无工具普通分析/问答按 §11.4 保存原话与应用提供的证据，未输出的模型意图/焦点/不确定性记 not_provided，不从文字抽取、不用默认 frame 伪造，也不为补字段再调用模型。
3. **作品状态必须有来源**：当前作品层不能由 AI 生成；AI 只能请求、引用、诊断缺失或提出怀疑。
4. **小说层不是 prompt dump**：每轮至少带核心原则与要素索引，按本轮引导层展开相关切片；选择结果必须可 trace。
5. **MicroPlan 仍是建议**：即使 AI 判断“应执行/应重写/应修订”，也只能形成 plan，不能绕过 Orchestrator。
6. **质量门前移但不越权**：AI 可以提前提醒质量风险；阻断、确认、采纳仍由系统 policy 和作者动作决定。
7. **设计与实现同步**：任何新增字段必须更新 `DialogueFrame` / `MicroPlan` / `DialogueContext` 对应 contract、测试和 trace，而不是只改 prompt。
8. **message 是 contract 投影**：prompt/messages 只能由三层 envelope 渲染，不能在调用点临时拼一段不可追踪文本。

---

## 8. 分期建议

### CP1 — Planner 引导判断最小闭环（不改 schema）

- **范围**：在 Planner prompt 中加入小说层压缩原则与要素索引；要求 AI 输出本轮要素焦点、风险和缺失，先落入 `evidence_summary` / `uncertainty` 或 trace。
- **Proof**：同一作者输入在不同作品上下文下，frame 能说明不同的要素焦点；无上下文时诚实标记缺失，不编造作品事实。

### CP1A — AIMessageEnvelope 文档与渲染契约

- **范围**：先不改 provider 行为，冻结 `AIMessageEnvelope` 的逻辑字段、call site 矩阵、MissingPolicy 与 TraceRequirements；把现有 Planner / CreativeProvider prompt 映射到该 envelope。
- **Proof**：能对任意一次现有 AI 调用结构化说明三层内容分别来自哪里、缺什么、最终进入哪个 message block；不能说明的调用点登记为 gap。

### CP2 — DialogueFrame schema 演进

- **范围**：经 ADR 冻结 `guidance_mode`、`element_focus`、`quality_risks`、`missing_questions` 等字段是否进入 DialogueFrame。
- **Proof**：schema contract test；当前实现与文档一致；reply-only / exploration / execution_candidate 均有合法 frame。

### CP3 — Work State Projection 补强

- **范围**：沿 `DialogueContext` 补结构化章节、章计划、章摘要、前文 excerpt、人物状态、伏笔/信息/情绪进度引用。
- **Proof**：Planner 和 prose_writing 工具能引用真实来源；缺失有 omission / uncertainty；不直接读 Repo。

### CP4 — CreativeProvider 消费引导层

- **范围**：工具输入不只含 `creative_brief/context_text`，还应包含本轮引导判断、要素焦点、质量约束和输出契约的可渲染摘要。
- **Proof**：provider prompt 仍通过现有不变量；输出能回连 frame/plan/context refs；AI 自报告不自动写入作品事实。

---

## 9. 验收方向

最小场景：

```text
作者：这一章感觉不够爽，主角赢得太轻了。
```

期望：

1. Planner 不直接进入普通闲聊，也不机械要求填写字段。
2. DialogueFrame / trace 能说明本轮是质量或结构类引导，关注冲突、代价、读者回报、主角能动性。
3. Context 中若没有当前章正文或章摘要，系统明确缺失，不让 AI 假装读过。
4. 若进入重写/修订，MicroPlan 只是建议，Orchestrator 仍决定是否需要确认或降级。
5. TurnResult 给作者的是具体创作取舍和下一步，而不是泛泛“加强冲突”。
6. Trace 能重建本轮 `AIMessageEnvelope`：小说层展开了什么、当前作品层用了哪些 refs、哪些材料缺失、本轮引导层要求 AI 判断什么。

---

## 10. 与现有文档关系

- `00/01`：本文把“AI 引导式创作”落成可实现的三层 contract。
- `02`：DialogueFrame 是本轮引导层的主要载体；字段演进需经 ADR。
- `06`：当前作品层属于 Context Layer；省略、来源、trace 规则沿用该文档。
- `08`：小说层的要素模型上游来自 Novel Element Model。
- `VS-00C`：创作执行上下文是当前作品层在 prose_writing 坐标上的投影；本文覆盖更上游的 AI 引导判断。
- `04/VS-01`：Planner 的引导判断和 MicroPlan 仍受 Orchestrator 权限边界约束。
- `acceptance/author/AU-11-ai-guided-authoring.md`：作者视角验收本文的最小闭环；缺该验收时，本文不能进入实现完成口径。
- `tasks/slices/v3/VS-00D-ai-guided-authoring-message-contract.md`：承重 slice 入口；用于把本文从 contract pack 推进到可验证实现。

## 11. B26 / B27 联合消息语义（2026-10-24 修订已接受）

本节与 [UA-01 §2.2](UA-01-unified-agent-run-loop-contract-pack.md) 共同定稿：本节管理语义输入/规则归属，UA-01 管工具协议、四断点 J1–J4 与回传。共享判断/计划入口已按本节迁移，验证与未闭环项见 B26/B27；不宣称 G1–G7 已关闭，不新增前置意图分类调用或长期义务表。

### 11.1 一份逻辑任务，多个专业调用

复用 DialogueContext / DialogueFrame / AgentRun / CreativeRequest / QualityEvaluationRequest。先列出现有承载与必要 schema 增量，不能把全部概念立刻新增成字段，也不能在字符串里拼另一份隐式协议：

| 语义 | 来源 | 下游约束 |
|---|---|---|
| 作者原话/来源与动作身份 | Interaction、投递/steer 来源、合法来源清单 | 原话不被解释覆盖；历史内容来源与本轮动作来源分开 |
| 当前目标与解释依据 | 明确模型结构，或带来源的作者原话/既有目标；普通回复按 §11.4 | 后续可细化，不无声换目标；未提供的模型解释不伪造，不成为 canon |
| 对象/范围/基线版本 | 当前章/角色/候选等读投影 | 同名不当身份、摘要不冒充全文；覆盖与未读部分明确 |
| 操作效果与保留项 | operation contract、作者范围、Orchestrator | 续写/重写/修订/仅排版互斥；模板不扩大权限 |
| 缺失/冲突/预算/可用操作 | 真实取证和 runtime | 能取证先取证；有必要作者决定才提问；缺口不派给近似能力 |
| 结果与未完成部分 | ToolResult、Adoption、Projection、receipt | 工具成功/候选生成/入档/目标满足分开；机械事实可校验，文学质量由模型解释 |

合法对象 refs 不塞静态 schema 枚举；前端焦点不是修改授权。B27 不替代 B28–B30 操作能力，B31 的真实回复绑定也不能靠 prompt 猜。

### 11.2 规则归属与替换纪律

- 保留 SystemIdentity 唯一 L0、角色专属格式、来源/采纳边界及 L0–L4；不拼覆盖所有角色的大 system prompt。
- 统一任务/能力效果/身份/状态词义，按调用职责投影；原文登记、方向、缺口由 UA-01 明确工具承载，不从空行/标题/列表恢复业务结构。
- 删除固定复述/报形态与进度问法一律直接答的过宽规则；保留简短行动说明和证据结论。普通回复不为填 frame 再调模型。
- writer 按已验证操作选规则：仅排版不继承续写/润色/删情节；修订不得与基础模板的“接着前文写”同时生效。
- 枚举/输出字段从 schema/contract 真源投影；重试只纠错，保留同任务/范围/来源/输出约束，不扩权。
- 保留作者原文字节与候选/canon 隔离，模型自称完成不代替结果核验；结构工具的作者文字仍符合 N-NARR。
- application 组装业务事实/任务，agent 消费既有 common DTO、不反向依赖 domain/application，Gateway/adapter 不持有小说意图特判。
- 旧 Envelope 可用纯逻辑迁往实际消费者；失效入口验证后退役，禁止加“写完”关键词冒充意图能力修复。

### 11.3 分工、依赖与验收

B26 管 schema/映射/分派/回传/重试计数/协议删除，B27 管本节输入/规则及专业调用。共同设计先于共享迁移：B26 CP1＋B27 CP0 → B26 CP2＋B27 CP1/CP2 同一入口改造 → 协议/业务保留验证 → B27 CP3 专业调用整合 → 语义 A/B、全生命周期真实 Tauri、各自门禁。B27 不等待 B26 全部收口才再改一次 JudgmentProtocol。

验收分：协议/来源/无副作用确定性验证；同模型同上下文自然表达对照；作者输入→取证/候选/作者动作→持久化/刷新/追问的真实页面。J1–J4 用例归 UA-01 §2.2.7，专业调用矩阵归 B27 §2；无消费证据的 matrix 行不能当作已完成。B26 CP0 旧探针只证明旧规则下部分单调用可行，不代表 B27 已生效。

### 11.4 无工具回复与结构化认知记录的边界（F3，2026-10-24）

普通问答/文学分析可以只返回文本，不为“本轮是什么类型”再调工具或另一模型。认知记录不替模型补内在判断；本节取代 §2.3/§7 中“所有回复必有模型结构”的旧泛化解释。

本节**不取消每个作者 turn 的 primary DialogueFrame**。与 [ADR-0001 修订提案](../adr/ADR-0001-dialogue-frame-v3.md) 联合接受后，应用出口仍建立、校验并持久引用 frame；变化是区分模型输出与应用记录事实，而非让普通回复绕过认知锚点。该上游修订未 Accepted 前，本节不能自行替代 ADR-0001 的字段语义。

| 回复形态 | 持久记录 | 不能声称 |
|---|---|---|
| 无工具普通回复 | 原始 content + provider_call_ref/source_input_ref；trace_summary.reply_record.response_kind=plain_text；supplied_context_refs、真实 observation_refs/读取覆盖；model_interpretation_status=not_provided，model_interpretation=null | 不从散文提取/默认 guidance_mode、element_focus、uncertainty；提供材料不等于模型实际使用 |
| 明确工具结构的判断/业务输出 | 实际 goal/target/source/范围字段及 provider 来源；app 校验事实与结果单列 | 不将 schema 合法或工具成功当文学判断正确；不填工具未给的推断 |
| 取证后普通分析 | 除文本外引用先前同任务/版本的结构判断与真实观察，标 upstream_judgment_ref | 不冒充本次新判断字段，不把先前目标绑到新话题，不声称模型逐项使用全部 supplied refs |

- 无工具回复必有 primary frame 与稳定 frame_id/turn_id/source_refs；frame_type=casual_reply 仅为非权威展示默认，evidence_summary.frame_origin=application_display_default，不用于权限、意图路由、质量分类或自动记忆。dialogue_goal.summary 用作者原话或同任务/版本仍适用的已验证上游 goal，标 goal_origin=author_input/upstream_judgment，不冒充本次模型理解。
- tool_need.needs_tool=false 配拟新增 reason_code=no_tool_requested，表示当前响应没有请求派发；execution_readiness=not_applicable 表示本响应无可执行建议，不判断作者目标是否已完成。evidence_summary.model_interpretation_status=not_provided 与 model_interpretation=null 是未知语义的依据；旧 uncertainty 容器若保留空数组，只是未承载模型输出，不能展示为“无不确定性”。
- supplied_context_refs 是确实进入请求的材料；observation_refs/coverage 来自真实取证。used_context_refs、模型焦点/不确定性未结构输出时留 null/缺省，不填空集合冒充“确定没有”，不沿用旧 context_used=true 机械断言。
- 派发能力、生成可操作方向/原文候选、提交 quality finding 或推进确认，必须使用对应业务结构及门禁；文本不会自动升级成这些效果。现有质量评审继续走 QualityEvaluationRequest/Findings，不新增每轮必调分类器。
- 历史记录缺元数据时标 legacy_unknown，只回看，不回填虚构分类、不改历史模型正文。
- 字段落现有 trace_summary/evidence 与版本化三层输入，不新增认知/义务表。B27 定语义，B26 在共享回复出口接线，两者共同验收。
- 证明：普通统计答复、完整章分析、部分读取诚实说明各一例；原话/refs/覆盖可回放，未提供判断字段未知，零额外抽取调用、零业务副作用。模型质量按 B27 §6.1，不以字段存在即通过。

**当前消费者核查与迁移验收**：`DialoguePlanningService.judgment_frame/4` 目前固定写 `context_used=true`，`TraceWriter.record/3` 按 frame type/reason 投影摘要，`TurnResultBuilder` 从 frame 构造结果；只往 `evidence_summary` 加字段不能保证 Why/Replay 消费到来源。实施时必须同批覆盖 frame → TraceWriter/脱敏 → TurnResult.frame_summary/trace_summary.reply_record → 持久 Interaction/DecisionTrace → replay/view model。author-safe 摘要只投影必要来源与覆盖，不复制 raw prompt、私有 thinking 或敏感上下文。

同一 turn 先探索后文本收尾时，`no_tool_requested` 只属于最后一个 provider 响应；实际探索记录、计数及 `upstream_judgment_ref` 不被覆盖。`truthfulness` 的整轮工具调用事实从真实记录聚合，不能从最终 frame 的默认值反推。验证必须断言 primary frame 引用、逐字段来源、刷新/回放后来源不丢、未输出判断不被下游使用，以及整轮探索仍可见。

### 11.4.1 共同任务输入的现有承载（B27 CP0 设计核对）

以下是当前代码可定位的载体与必要消费规则，不是已经接通的统一信封；实际请求捕获、20例 snapshot/hash 与保留集仍按 B27 §6.1 完成。

| 语义与现有载体 | 共享入口与专业调用的处理 | 缺失处置 / 验证 |
|---|---|---|
| 原话与来源：Interaction / AuthorActionInput.payload、AgentRun goal/version | application 绑定本轮来源、目标版本与历史材料来源，判断/计划/重试使用同一绑定；原文登记按原消息取字节 | 没有合法来源不默认 current；历史资料登记、重传同身份异内容分别拒错 |
| 作品状态：DialogueContext.current_work_snapshot / structured_chapters / interaction_state / context_refs / omission_notes / assembly_policy | 作为 WorkState 投影；取证 observation 的对象版本、分页与覆盖同批传递，不把摘要或裁切段改称全章 | 可读则先取证；预算不足诚实保留覆盖缺口，不能硬填事实 |
| 任务执行：CreativeRequest.source_turn_ref / decision_packet / execution_brief / revision / progress_state / planning_mission | common DTO 是 application → agent 的既有边界；应用先明确目标/操作/范围，agent 按该任务渲染角色规则 | 当前 revision 仍是文本，不能宣称已具备互斥操作契约；CP1 以真实 writer 消费确定必要 DTO 增量，不塞进 provider_hints 或靠字符串关键词选操作 |
| 质量评审：QualityEvaluationRequest.source_ref / source_type / prose_text / execution_brief / facts_context / scene_units | 保留独立评审契约，比较实际提交正文与对应目标/基线；对话诊断只复用质量维度和证据原则 | 缺场/章覆盖显式说明；不把 evaluator prompt 全量复制到判断入口，不拿单段评审冒充全章结论 |
| 结果：ToolResult / adoption_state / projection refs / receipt | 后续判断消费已生成、待采纳、已采纳、投影状态的真实差别；任务完成须独立证据 | 普通文本、run completed、工具成功均不自动生成 goal_satisfied；M19/M20 验证刷新后的权威状态 |

固定小说原则与协作策略归 L1，动态作品/任务材料按 VS-00I 放入对应层，L4 决策约束仍置尾。接受共同设计不等于全专业调用已经迁移；B27 CP1/CP3 必须逐调用点记录上述载体实际进入请求的位置、版本、缺失策略与真实消费者。

### 11.4.2 求证式三层输入增补（2026-10-27，VS-00K Proposed）

本节增补而不改写 §11.4 已接受的 supplied ≠ used、未知不得伪造及 primary frame 边界，也不要求复活已退役的 Envelope 实现。

1. 三层逻辑输入按**初始 Base + 本 run 实际观察**组装。`WorkStateMessage` 可以来自初始 DialogueContext，也可以来自后续真实观察；每次消费请求须保留自己的来源、版本、覆盖和 observation refs，不能把 supplied 当成 used。
2. 模型可通过 ADR-0025 的唯一探索入口及创作 AgentPlan 的只读探索步判断相关性，不为每类作品事实另开 provider-native 第二探索协议。权限、作品隔离和预算由应用与 Orchestrator 校验。
3. `used_context_refs` 未结构输出时继续为 null/unknown；返回时只能指向本次请求实际可见的 Base refs 或本 run 此前观察 refs。普通文本不机械提取 used refs 或“已核对”结论。
4. 取证观察的分页、覆盖、权威性和版本与观察一起传递；读取一部分不能改称全章，读取失败不能改称作品没有该事实。模型信息缺口与 APP hard missing 分层，不能由任一方伪造 ready。
5. 证明必须沿 `model request → explore → observation → later model request → used refs` 核对真实顺序，并保留 VS-00D §11.4 的零额外抽取、零业务副作用和 B27 语义质量分轨。求证证据不自动等于文学判断正确或 I10 通过。

完整求证契约与 CP 见 `VS-00K-evidence-seeking-authoring-contract-pack.md`、B39、AU-15；本节不声明当前实现已完成。

### 11.5 六项补口的职责与通过边界

问题的持久投影、空选项回传/恢复与各结果运行态以 UA-01 §2.2.2 A / §2.2.3a 为真源，B26 独立完成；无明确问题绑定的一般自由输入归 B31，不是 B26 前置。§11.4 解决纯文本记录，不放宽可执行判断的结构/来源。

旧 novel_web “仅透传”范围由 ADR-0025 当前边界替代；I-CACHE-3 单调用/语义口径由 VS-00I §7 定义，旧 none 调用对断言仅历史。B27 §6.1 固化期望/阈值/分母，不能测后改合格线。文档交叉审查只说明规格一致，状态链、真实模型和真实 Tauri 仍需证据。
