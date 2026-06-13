# VS-00D AI-Guided Authoring Contract Pack（AI 引导式创作三层 + Message 契约）

> 状态：draft for review（2026-06-13）
>
> 角色：本文定义“AI 如何引导作者进行小说创作”的三层 contract：小说层、当前作品层、本轮引导层；同时定义这三层如何落到每一次 AI 调用的 message layer。本文不引入脱离现有主链的新 runtime 架构；它约束现有 `DialogueGateway → ContextAssembler → Planner → DialogueFrame → MicroPlan → ExecutionOrchestrator → Tool/Provider → TurnResult/Trace` 如何补强小说创作判断能力。
>
> 当前实现事实：代码中已有 `Planner.form_frame/3`、`Planner.form_micro_plan/4`、`DialogueContext`、`DialogueFrame`、`MicroPlan`、`ExecutionOrchestrator` 与 creative provider；但 `DialogueFrame` 当前仍是粗粒度字段，`DialogueContext` 当前主要承载 snapshot / conversation / memory / chapters，尚未承载完整小说层与作品状态投影。本文是未来设计完善的 contract pack，不宣称当前代码已完成。

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
| frame_type | 本轮认知类型 | 已有 `DialogueFrame.frame_type` |
| dialogue_goal | 本轮对话目标 | 已有 `DialogueFrame.dialogue_goal` |
| guidance_mode | 探索 / 结构 / 执行 / 质量 / 澄清 / 确认 / 无引导 | 目标 schema；当前可先作为 `evidence_summary` 或 `uncertainty` 过渡 |
| element_focus | 本轮重点小说要素，如人物动机、章节功能、信息释放 | 目标 schema；可先进入 trace / evidence |
| missing_questions | 继续前必须问作者的问题 | 可映射到 clarification / uncertainty |
| risk_flags | 连续性、质量、越权、缺上下文风险 | 进入 uncertainty / Orchestrator gate / trace |
| output_contract | 本轮希望 AI 返回诊断、选项、正文、修订建议或确认问题 | 影响 MicroPlan / ToolRequest / provider prompt |

实现原则：

1. `Planner.form_frame` 是本轮引导层的第一入口；它可以让 AI 做创作语义判断。
2. `DialogueFrame.validate/1` 和后续 schema 校验负责保证 AI 输出结构合法。
3. `MicroPlan` 只能表达下一步行动建议，不能把引导判断升级为执行批准。
4. `ExecutionOrchestrator` 仍负责权限、风险、写入、确认、采纳边界。
5. 作者最终决定方向、确认高风险变更、采纳或拒绝候选。

---

## 3. 决策分权

| 角色 | 决定什么 | 不能决定什么 |
|---|---|---|
| 作者 | 创作偏好、最终取舍、是否确认/采纳 | 不需要手动选择每个小说要素或上下文切片 |
| AI / Planner | 作者意图解释、创作问题诊断、guidance mode 建议、要素聚焦、候选方向、风险提示 | 不能声明对象真实存在、不能批准执行、不能写入权威状态 |
| Agent / Application | 组装上下文、校验结构、检查对象存在、控制预算、省略留痕、执行门禁、trace/replay | 不能用硬编码规则替代全部创作语义判断 |
| Orchestrator | 是否允许工具调用、是否需要确认/澄清/降级/拒绝 | 不能替作者发明创作目标 |
| Provider | 根据已组装 packet 做推理和生成 | 不能决定自己本轮应该看到哪些真实作品状态 |

原则：

```text
AI 参与创作判断；
Agent 约束和取证；
Orchestrator 裁决执行；
作者保留创作主权。
```

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
→ Planner.form_frame
   - 接收小说层压缩原则 + 当前作品层 + 作者输入
   - AI 产出本轮引导判断
→ DialogueFrame.validate
   - 系统校验结构、禁止批准语义
→ Planner.form_micro_plan（按需）
   - AI 提出下一步行动建议
→ ExecutionOrchestrator
   - gate / confirmation / downgrade / allow_tool
→ TurnExecutionService / CreativeProvider
   - 根据已裁决 action 和上下文渲染工具输入
→ TurnResult / Trace / Author action
```

两个关键约束：

1. 第一轮 Planner 判断可以由 AI 参与；但它只能基于 `ContextAssembler` 已提供的证据与小说层原则判断。
2. 创作执行阶段不能重新让 provider 黑箱决定上下文；它必须消费已经结构化和校验过的 DialogueFrame / MicroPlan / DialogueContext / ToolRequest。

---

## 6. 当前差距

| # | 差距 | 当前事实 | 完善方向 |
|---|---|---|---|
| G1 | 小说层未成为一等 contract | Planner prompt 只有“你是小说创作 AI”与粗规则 | 把小说第一性原则和要素索引纳入 Planner contract |
| G2 | 当前作品层太薄 | DialogueContext 主要是 snapshot / conversation / memory / chapters | 按 VS-00C/08 补结构化章节、章摘要、前文、进度账 |
| G3 | 本轮引导层字段不完整 | DialogueFrame 只有 coarse frame_type/tool_need/readiness | 先用 evidence/uncertainty 承载，后续 ADR 扩展 schema |
| G4 | 创作执行 prompt 与 Planner 判断脱节 | CreativeProvider 只看 creative_brief/context_text | 让工具输入携带可追踪的引导判断与要素焦点 |
| G5 | 要素选择不可解释 | 当前没有记录“为什么本轮看这些小说要素” | trace 中记录 element_focus / omitted_elements / rationale |
| G6 | 质量门主要是设计文档，未进入本轮引导 | provider 只有正文风格要求 | 把质量门作为 Planner 诊断与 CreativeProvider 输出约束 |
| G7 | AI message 层没有独立 contract | 当前 prompt/messages 多由调用点拼接 | 用 `AIMessageEnvelope` 统一三层 message block、缺失处理和 trace |

---

## 7. 实现原则（未来 slice 必须遵守）

1. **不推翻现有主链**：所有完善必须穿过 DialogueGateway / ContextAssembler / Planner / DialogueFrame / MicroPlan / Orchestrator / ToolResult / TurnResult。
2. **AI 判断必须结构化**：小说创作判断不能只留在 assistant_message 文案里，至少要进入 DialogueFrame evidence / uncertainty / trace；成熟后进 schema。
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
