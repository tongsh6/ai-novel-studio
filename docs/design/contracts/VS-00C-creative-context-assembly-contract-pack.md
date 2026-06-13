# VS-00C Creative Context Assembly Contract Pack（创作上下文组装）

> 状态：draft for review（2026-06-13，rev3：要素模型上游接入 + 预算 profile 化 + VS-00D message layer 对齐）
>
> 角色：本文是创作执行（写章/续写/重写等 prose_writing 类动作）上下文组装的 contract pack，关闭 `VS-00B-dialogue-context-grounding-contract-pack.md` §6 显式遗留的「上下文排序、去重和 token 打包策略」延期项。上游：`VS-00D-ai-guided-authoring-contract-pack.md`（AI 引导式创作三层 + message contract）与 `../08-novel-element-model.md`（小说要素模型）——上下文组装是要素模型四个消费面之一（上下文 = 要素模型在当前写作坐标上的投影）。本文不是 implementation plan，不直接授权代码实现；实现须按 §8 分期拆为 `tasks/slices/v3/` 下的 slice。
>
> 缘起：P1 狗粮长跑中「续写前文注入超出小上下文窗口模型 n_ctx」被以"尾部裁剪 2000 字"修复（`turn_execution_service.ex` `@prior_prose_max_chars`）。该修复方向部分符合设计（见 §3.4），但缺策略层、缺省略可解释性、缺 summary 替代——本文把"生成一章内容需要哪些元素组装给 AI"归正为设计驱动的契约。
>
> 模型无关性前提：应用支持 provider 切换（SU-01：stub / lmstudio / anthropic / deepseek registry；SU-I4 切换不破坏已有对话与作品上下文）。开发阶段的本地小模型是刻意选择的**地板档**（最严苛预算逼出诚实的分层与压缩，狗粮长跑即降级路径的常态验收），不是设计基准。本契约凡属"结构"（分层顺序、挤压顺序、对象语义）一律模型无关；凡属"数值"（预算大小、窗口条数）一律 per-provider profile 参数化。

---

## 1. 设计来源梳理（v3 为主体，v2 做补充）

### 1.1 v3 权威结论（必须遵守）

| 来源 | 结论 | 对本契约的约束 |
|---|---|---|
| `06-memory-context-and-trace.md` §3 | Memory / Context / Trace / Replay 四层分离 | 上下文组装属 Context 层，组装结果可被 Trace 引用 |
| `06-memory-context-and-trace.md` §5.2 | ContextPacket 按消费者分型：planner / orchestrator / tool / ui_trace / replay；tool_context = "工具所需最小输入、权限、预算、trace policy"，禁止"无关会话、敏感 memory" | 创作执行的上下文是 **tool_context**，与 planner_context 分开治理，不共用一份"万能上下文包" |
| `06-memory-context-and-trace.md` §5.3 | DialogueContext envelope 含 `omission_notes`、`assembly_policy_ref`、`token_budget` | 省略必须显式留痕；预算是 envelope 一等字段，不是实现内 magic number |
| `06-memory-context-and-trace.md` §5.4 | 组装策略八维度（relevance / recency / authority / stability / sensitivity / budget / risk / omission）；Tool context 必须最小化 | 本契约先冻结其中 budget + omission + authority 三个维度的最小落地（其余 defer，见 §9） |
| `06-memory-context-and-trace.md` §5.5 | omission reasons 枚举：irrelevant / budget_limited / sensitive / stale / debug_only / requires_confirmation | OmissionNote.reason 取该枚举子集 |
| `06-memory-context-and-trace.md` §7 | ContextTrace 记录 packet、omission reason | 组装与降级事件进 trace / 业务日志 |
| `06-memory-context-and-trace.md` §16 | Context assembly use case 属 novel_application；禁止"Context assembler 直接读取全量数据库拼 prompt" | 边界不变：组装在 application，数据经 persistence fetcher 注入 |
| `06-memory-context-and-trace.md` §18 / `00c` #13 | 不变量："Context 不是全量数据库 dump"；"context 是最小可解释包"；"上下文必须可解释 omission" | 本契约的核心不变量来源 |
| `VS-00B` §2/§3 | DialogueContext 最小来源集合 + ContextSourceRef + trace 绑定；Planner 不直接访问 Repo | 已实现，本契约在其上扩展，不推翻 |
| `VS-00D` §4 | AIMessageEnvelope 按 call_site 投影 NovelLayer / WorkState / TurnGuidance；`prose_writing` 只展开写作坐标相关原则、作品状态和输出契约 | 本文的 CreativeDecisionPacket 是 `call_site=:prose_writing` 的专项 envelope，不是另一套总架构 |
| `AU-03` SC-F1 | 长会话只带"最近 turn + session summary"，token 长度可控 | 会话维度的压缩已有最小实现（session summary）；本契约处理的是**作品正文维度**的同构问题 |
| `AU-09` I3/I5/I6 | 只有 confirmed/stabilized 且 recallable 的记忆进普通召回；按当前 Work 隔离；有效期窗口影响召回 | 连续性层中 memory 部分沿用既有 recall 主链，不另起一套 |
| `08-novel-element-model.md`（v3 上游） | 要素 × 层级 × 三态模型；上下文 = 要素模型在写作坐标上的投影；章计划/章摘要必须按要素分维度；分期依据是数据依赖与杠杆 | §3.1 分层的元素来源；CP2 摘要四栏与 CP4 章计划结构化的契约依据 |
| `SU-01` SU-I2/SU-I4 | provider 选择经 Gateway；切换供应商不破坏已有对话和作品上下文 | 组装语义必须 provider 无关（VS00C-I7）；预算 profile 对接 provider registry |

### 1.2 v2 补充结论（v3 未展开处的细则）

| 来源 | 结论 | 对本契约的约束 |
|---|---|---|
| `domain/26-context-assembly-policy.md` §6.1 / §27.2 | 冻结组装顺序：任务元信息 → 结构对象 → 连续性对象 → 风格对象 → experience rules → strategy artifacts → summaries → 原文片段 → 近期运行态 | §3.1 的分层顺序直接采用（本期未建模的层留空位，不改序） |
| `domain/26-context-assembly-policy.md` §8 | Executor Context Policy：target structure objects + relevant continuity layer + active style layer + local accepted text context + task/brief context | 创作执行 tool_context 的应有元素清单（§3.1） |
| `domain/26-context-assembly-policy.md` §8.5 / §15.3 | 原文只读"与当前目标直接相邻或强相关的 excerpts，而不是整本书"；原文片段的职责是"局部文风、上下句承接、必须引用的细节" | **尾部 excerpt 方向正确**；错在无策略、无解释、无 summary 替代 |
| `domain/26-context-assembly-policy.md` §14.3 | 预算不足时降级路径：原文片段 → summary → aggregate summary → 省略 | 被裁掉的前文必须有 summary 替代物，而不是凭空消失 |
| `domain/26-context-assembly-policy.md` §14.4 | 禁止降级项：当前 target object、必要 worldrules、active brief、blocking behavior context | 任务元信息与目标章身份永不被预算挤掉 |
| `domain/26-context-assembly-policy.md` §15.4 / §27.3 | 执行消费者默认权重 `structured objects > summaries > raw text excerpts` | 分层进入顺序与预算挤压顺序的依据 |
| `domain/26-context-assembly-policy.md` §25 | 持久化要求：context assembly summary、selected/omitted source refs、downgrade notes；事件 `context_assembled` / `context_downgraded` | OmissionNote 留痕与业务日志事件命名依据 |
| `domain/22-continuity-model.md` §10 | `chapter_summary` 是独立连续性/memory 对象（"对某一章内容的高信息密度压缩总结，用于检索、连续性维护和长跑续接"），**不是 chapter 偷塞一个 summary 字段**；adoption 7 态；maintenance → tentative → adoption → authoritative | §5 新对象的定义依据；与现有 `chapters.summary`（**计划摘要**）必须区分 |
| `domain/22-continuity-model.md` §16/§17 | 连续性对象（chapter_summary 等）对续写/long-run resume 比原始对话历史更重要；resume 不依赖全量旧正文 | 跨章上下文以章摘要为主、原文 excerpt 为辅 |
| `domain/23-style-and-author-intent.md` §9 | 风格层优先级 `feedback_patch > local brief > parent brief > writing_preferences > style_sample derived cues` | 本期不建模风格对象（§9 defer），但分层顺序中保留风格层空位 |

### 1.3 两版关系判定

v3 `06` 定义**信封与不变量**（packet 分型、omission、budget、trace），v2 `26/22/23` 定义**内容策略**（什么元素、什么顺序、怎么降级）。两者不冲突：v2 §27 冻结的 11 条硬骨在 v3 中没有任何一条被推翻，v3 §20 的 ADR 候选（DialogueContext v3）正是把 v2 策略装进 v3 信封。本契约即按"v3 信封 + v2 内容策略"组合冻结。

### 1.4 本轮补强结论：从 context packet 升级为 creative decision packet

小说创作的第一性原理不是"给模型塞更多上下文"，而是让模型在每一轮写作前知道四件事：

1. **写到哪里**：当前写作坐标是什么（作品 / 卷 / 章 / 场 / 段落，处于规划、首稿、续写、重写、修订还是维护）。
2. **为什么写**：这一轮要服务的结构功能、人物变化、信息释放、伏笔动作和读者体验是什么。
3. **凭什么写**：哪些设计态、实现态、进度态材料被带入，哪些被省略，省略是否安全。
4. **写完如何检查**：输出中哪些假设、上下文引用、读者效果和风险需要被后续质量门/maintenance 验证。

因此，本契约的目标不只是生成 `context_text`，而是生成一个 **CreativeDecisionPacket**：给 AI 的文本只是该包的 provider 渲染层；写作坐标、组装策略、省略说明、缺失处理结果和 trace 引用同样是一等 contract。否则系统会退化成"聊天续写器"，无法支撑长篇小说的连续性、结构张力和作者可控性。

换句话说，prose_writing 调用不是"把一段上下文发给 AI"，而是小说创作 Agent 系统中的一次受控 agent turn。`messages` 的最终文本形态必须由 CreativeDecisionPacket 推导，不能由调用点临时拼接；否则 Context、Planner、Orchestrator、Provider、Quality Gate、Trace 会各自理解"这一轮在写什么"，会话结构失真，创作质量也就失去系统性保障。

与 `VS-00D` 的关系：

```text
VS-00D AIMessageEnvelope(call_site=:prose_writing)
  → 本文 CreativeDecisionPacket
  → provider 可见 prose_writing messages
  → ToolResult / candidate artifact / trace
```

因此，本文只负责创作执行调用的上下文和 message 投影；Planner 如何判断本轮是否应该进入写作、质量诊断或澄清，仍由 `VS-00D` 的 Turn Guidance Contract 与 `02-dialogue-frame-and-micro-plan.md` 承担。

---

## 2. 现状与差距

### 2.1 现有链路（2026-06-12，分支 idea/dialogue-based-novel-workbench/v3）

```text
WorkspaceContext.context_fetcher_with_query/0   (persistence)
  → {snapshot, conversation_summary, memory_summary, behavior_summary, chapter_titles}
  → ContextAssembler.assemble_for_input/4        (application)
  → DialogueContext{5 个扁平字段 + context_refs}
  → ① Planner: DialogueContext.to_prompt_text/1（全段落直拼）
  → ② 创作执行: TurnExecutionService.tool_input/5
       = creative_brief（动作摘要+目标字数+作者输入）
       + context_text（prior_prose 尾部 2000 字 + to_prompt_text 全文 + 当前作者输入）
  → CreativeProvider (real.ex 三锚点模板：用户创作简述：/上下文：/重要：)
```

### 2.2 差距表（每条对应设计条款）

| # | 差距 | 违反/缺失的设计条款 |
|---|---|---|
| G1 | planner 与 tool 共用同一份 `to_prompt_text` 输出，无 per-consumer 包 | v3 06 §5.2（tool_context 最小化）、v2 26 §3.4 |
| G2 | 前文裁剪预算 `@prior_prose_max_chars 2000` 写死在实现里 | v3 06 §5.3（token_budget 是 envelope 字段）、v2 26 §14 |
| G3 | 被裁掉的前文凭空消失，无 summary 替代 | v2 26 §14.3（降级路径：原文 → summary） |
| G4 | 省略不留痕：无 omission_notes、无 `context_downgraded` 事件、trace 不可解释 | v3 06 §5.3/§5.5/§7、`00c` #13、v2 26 §25 |
| G5 | 无 `chapter_summary` 连续性对象（写后内容压缩）；跨章写作时模型对前面各章**写了什么**一无所知，只知道标题 | v2 22 §10/§16/§17 |
| G6 | 结构对象只进了标题列表（`current_chapters: [String.t()]`）；目标章的计划摘要（`chapters.summary`）、卷内位置（seq、前后章）未进入创作上下文 | v2 26 §8.2（结构对象优先）、21 对象模型 |
| G7 | 无风格层对象（writing_preferences / brief / feedback_patch）；仅 work snapshot 的 `tone_preference` 字段间接进入 | v2 23（defer，见 §9） |
| G8 | 组装策略八维度仅 relevance（memory recall 关键词）半落地 | v3 06 §5.4（defer 大部分，见 §9） |
| G9 | **确认后执行路径零上下文**：`handle_confirmation_dispatch` 以 `context: nil`、无 `chapter_prose_reader`、`author_input="确认执行"` 调用 TurnExecutionService——高风险动作（rewrite 必经确认）执行时拿到的上下文反而比低风险直接执行更少；重写最需要的本章已采纳正文恰恰注入不了，且缺失零留痕（2026-06-12 实现前推演发现，狗粮未暴露系因误判 rewrite 的章恰好无正文） | VS00C-I2（省略必须可解释）、ADR-0009 确认语义（作者确认的是"带上下文的那个计划"） |
| G10 | context fetcher 异常无保护：`ContextAssembler.assemble/2` 直接匹配 `{:ok, ...}`，DB 抖动导致整轮崩溃而非降级为明确空上下文 | AU-03 GAP-08（既有登记，CP1 动 ContextAssembler 时顺手关闭） |
| G11 | 无一等 `WritingCoordinate`：目标章/场、生命周期阶段、写作模式、目标单位都从作者输入或 planner 推断，无法作为上下文选择器和 trace 事实 | `08` §7 上下文组装规则、v2 28 生命周期、v3 01 DialogueFrame |
| G12 | 无 `ReaderEffectBrief` / 预检质量意图：上下文告诉 AI "已有材料是什么"，但没有明确告诉 AI "这一轮要让读者感到什么、制造什么悬念、避免什么破坏" | v2 31 质量门、`08` E20/E21/E37、v2 23 作者意图 |
| G13 | 缺失内容无严重度策略：有些缺失应阻断或请求确认（目标章不存在、必要世界规则缺失），有些只需降级留痕；现状没有统一决策表 | v2 26 §14.4 禁降级项、v3 06 §5.4 risk/omission |
| G14 | 创作输出契约缺少自报告字段：AI 只返回正文/候选内容，缺少 `assumptions`、`used_context_refs`、`risk_flags` 等后续验证材料 | v2 31 质量门、v3 trace/replay、maintenance 提炼链路 |

### 2.3 对"裁剪 2000 字"修复的设计定性

按 v2 26 §8.5/§15.3，续写时注入"本章尾部原文 excerpt"**正是设计要求的形态**——原文片段的职责就是局部文脉与上下句承接，"不是整本书"。该修复不是方向错误，而是缺三件设计件：

1. **预算来自策略而非常量**（G2）；
2. **被省略部分以 summary 替代**而非消失（G3 → 依赖 G5 的 chapter_summary）；
3. **省略可解释**：omission note + 降级事件 + trace（G4）。

---

## 3. 目标契约：prose_writing 的 tool_context

### 3.0 CreativeDecisionPacket（目标信封）

创作执行的目标输入不是一段散文 prompt，而是下列信封的 provider 渲染结果：

```text
CreativeDecisionPacket
  packet_id              : string
  capability             : :prose_writing
  writing_coordinate     : WritingCoordinate
  assembly_policy_ref    : string
  task_brief             : string
  design_state_packet    : text | structured map
  implemented_state_packet : text | structured map
  progress_state_packet  : text | structured map
  style_intent_packet    : text | structured map | nil
  reader_effect_brief    : ReaderEffectBrief | nil
  missing_policy_result  : MissingPolicyResult
  omission_notes         : [OmissionNote]
  context_refs           : [ContextSourceRef]
  trace_ref              : string
```

渲染规则：

1. AI 只需要看到 author-safe 的文本投影；`packet_id`、`trace_ref`、`context_refs` 可只进入 trace，不必逐字塞进 prompt。
2. `design_state_packet` 表示写前设计态（章计划、结构方向、作者意图）；`implemented_state_packet` 表示已采纳正文提炼出的事实态（章摘要、人物状态、连续性）；`progress_state_packet` 表示进度态（伏笔账、情绪曲线、承诺账的当前位置）。三者不得混成一段不可追溯文本。
3. `missing_policy_result` 必须先于 provider 调用产生。若结果为 block，则不得调用 AI；若为 degrade，则必须带 `omission_notes`。
4. 现阶段实现可以仍然把各 packet 渲染为 `context_text`，但 contract 层必须按上述信封推演和验收。

#### 3.0.1 WritingCoordinate

`WritingCoordinate` 是上下文组装的选择器，先于 L1-L6 分层产生：

```text
WritingCoordinate
  work_ref        : string
  lifecycle_phase : :setup | :planning | :drafting | :maintenance | :revision
  authoring_mode  : :first_draft | :continuation | :rewrite | :revise | :explore | :maintain
  target_unit     : :work | :volume | :chapter | :scene | :paragraph
  volume_ref      : string | nil
  chapter_ref     : string | nil
  scene_ref       : string | nil
  source_turn_ref : string
```

规则：

- `target_unit=:chapter` 且缺 `chapter_ref` 时，若作者请求是写章/续写/重写，属于 hard missing，必须 block 或请求作者确认目标，不能让 AI 自行猜。
- `authoring_mode` 决定 L5 原文 excerpt 是否可用：首稿通常不带目标章正文，续写/重写必须尝试读取目标章已采纳正文。
- `lifecycle_phase` 决定主要消费者：planning 优先结构方向，drafting 优先 prose_writing，maintenance 优先提炼与对账，revision 优先差异与风险。
- provider 大小只影响预算 profile，不影响坐标字段。

#### 3.0.2 ReaderEffectBrief

`ReaderEffectBrief` 是从小说创作第一性原理补上的"读者侧目标"，来源于章级方向（E18-E22）、作者意图（v2 23）和质量门（v2 31）：

```text
ReaderEffectBrief
  intended_emotion    : string | nil
  tension_source      : string | nil
  payoff_or_promise   : string | nil
  suspense_boundary   : string | nil
  hook_target         : string | nil
  web_serial_risk_notes : [string]
```

它不是事后评价，而是写前约束：AI 在生成正文时必须知道这一章/这一段要制造的情绪、悬念边界和承诺。缺失时可以降级，但应进入 `missing_policy_result`，因为"没有读者效果目标"会直接降低创作质量，而不只是影响 token 预算。

#### 3.0.3 MissingPolicyResult（缺失严重度）

缺失处理按严重度统一归口，避免各调用点自行 fallback：

| severity | 含义 | 例子 | 处理 |
|---|---|---|---|
| `block` | 缺失会导致写错对象或静默污染权威状态 | 重写但目标章不存在；确认执行但找不到原计划/原作者输入 | 不调用 AI，返回可解释失败或请求作者确认 |
| `high_risk_confirm` | 可继续但需要作者知道风险 | 世界规则冲突、必要前文摘要 stale、续写目标正文为空但章已标记有正文 | 进入确认/澄清路径，trace 记录风险 |
| `degrade_with_note` | 可降级执行且有替代物 | 原文超预算，以 chapter_summary 替代；旧对话被 session summary 替代 | 调用 AI，写 OmissionNote + replacement |
| `omit_with_trace` | 低风险省略 | 无关记忆、过期运行态、debug-only 材料 | 调用 AI，写 OmissionNote |

`MissingPolicyResult` 是 provider 调用前的系统判断，不是 AI 判断。AI 可以在输出自报告里暴露它感知到的不确定性，但不能覆盖该结果。

#### 3.0.4 创作输出的自报告字段

prose_writing 类输出除正文/候选内容外，目标 contract 应允许 AI 返回以下非权威字段：

```text
CreativeOutputSelfReport
  assumptions            : [string]
  intended_reader_effect : string | nil
  used_context_refs      : [string]
  risk_flags             : [string]
```

这些字段只作为 quality gate、trace、maintenance 的输入线索，**不得**直接变成作品事实或采纳状态。任何 `assumptions` 若要进入设定/连续性/进度账，必须经过既有 adoption 或 maintenance 对账。

### 3.1 分层元素（冻结顺序，对齐 v2 26 §6.1）

创作执行（capability = prose_writing，authoring_intent ∈ {none/首稿, continuation, rewrite}）的 tool_context 由以下层按序组装。标注【已有】的层沿用现有实现，标注【新】的层由 §8 分期补齐，标注【空位】的层本期不建模但顺序保留：

| 层 | 内容 | 状态 |
|---|---|---|
| L1 任务元信息 | `WritingCoordinate` + creative_brief：动作摘要 + 目标字数 + 作者输入原文 | creative_brief【已有】；坐标【新】CP0 |
| L2 目标结构对象与方向 | 目标章 title + seq + **计划摘要**（`chapters.summary`）+ 卷内位置（前一章/后一章标题）；章计划结构化（CP4）后，计划摘要升级为要素四件套方向信息（章功能 / 目标四件套 / 情绪定位 / 断章要求，`08` E18-E22）；并投影 `ReaderEffectBrief` 的章级目标 | 【新】CP3 / CP4 / CP5 |
| L3 连续性层 | (a) 最近 N 章的 `chapter_summary`（写后内容压缩，N 由策略定，默认 2）；(b) 相关 confirmed/recallable memory（伏笔/规则/设定）；按设计态/实现态/进度态拆分渲染，不混为一段"背景" | (a)【新】CP2；(b)【已有】AU-09 recall 主链 |
| L4 风格与作者意图层 | 作品 snapshot 风格字段（tone_preference 等）；写作守则（provider 层 `@prose_writing_guidelines`）；后续 style 对象补齐时挂接 style_intent_packet | 【已有最小形态】；style 对象【空位】§9 |
| L5 局部原文 excerpt | 仅 continuation/rewrite：目标章已采纳正文**尾部 excerpt**，预算由策略给出；超预算部分以该章 `chapter_summary` 替代并产生 OmissionNote | 裁剪【已有】→ 策略化 CP1；summary 替代 CP2 |
| L6 近期运行态 | conversation_summary（含 session 早期摘要）、open_behavior_summary | 【已有】 |

挤压规则（预算不足时，对齐 v2 26 §14.2/§14.3/§15.4）：

- 优先保全：L1、L2（目标章身份与计划摘要永不挤掉——26 §14.4 禁降级项）；
- 先挤 L5（原文 excerpt 缩短 → 由 L3(a) summary 兜底）；
- 再挤 L6（近期对话直接省略，记 OmissionNote）；
- L3 summary 只可整条省略不可截断（截断的摘要比没有更危险），省略记 OmissionNote。

### 3.2 AssemblyPolicy（最小冻结字段，预算按 provider profile 参数化）

组装策略独立成值对象（novel_domain 纯 struct）。**分层结构与挤压顺序（§3.1）模型无关、对所有 profile 一致；预算数值按 provider profile 参数化**——裁切线随 profile 移动，结构不动：

```text
AssemblyPolicy
  policy_id            : string（trace 引用用，如 "prose_writing/floor_v1"、"prose_writing/large_v1"）
  consumer             : :tool | :planner（本期只冻结 :tool 的 prose_writing profile）
  excerpt_budget_chars : integer（L5 预算）
  summary_window       : integer（L3(a) 最近 N 章）
  context_budget_chars : integer | nil（context_text 总预算上限；nil = 不设全局上限）
```

profile 矩阵（初始档位，数值属"暂不冻结"内容，落地时按 provider 实测调整）：

| 档位 | 适用 provider | excerpt_budget_chars | summary_window |
|---|---|---|---|
| floor（地板档） | lmstudio 小窗口（n_ctx≈4k） | 2000（迁移自 `@prior_prose_max_chars`，作为档位参数而非设计常量） | 2 |
| standard | 中等窗口 | 整章或 8000+ | 5+ |
| large | anthropic / deepseek 大窗口 | 整章全文 | 卷内全部章 |

规则：

1. profile 的选取来源是 Gateway provider registry 的当前 provider/model（SU-01 既有事实），由 application 解析为 policy 实例；**产品代码不得读取验收专用开关来切换 policy**（场景化验收红线）。
2. 预算单位本期用字符数（确定性可测）；token 精确估算 defer（§9），但 profile 矩阵本身属 CP1 范围，不是后续优化。
3. policy_id 必须写入 trace（§4），保证"这轮上下文按哪个策略组装"可回答；切换 provider 后下一轮 trace 的 policy_id 应随之变化（SU-I4 的可观测投影）。
4. 地板档的角色是**优雅降级的常态验收**（狗粮长跑跑在它上面），不是设计基准；任何按地板档能力裁剪 §3.1 结构的提议都违反本契约。

### 3.3 OmissionNote（冻结字段）

```text
OmissionNote
  source      : string（被省略对象，如 "prior_prose:第三章"、"conversation_summary"）
  reason      : :budget_limited | :irrelevant | :stale（v3 06 §5.5 枚举子集）
  replacement : string | nil（替代物描述，如 "chapter_summary:第三章"；nil = 无替代直接省略）
```

去向：

- 挂在 DialogueContext envelope 新增字段 `omission_notes: [OmissionNote.t()]`（对齐 v3 06 §5.3）；
- 进入 trace_summary（作者可见侧只给 author-safe 摘要，对齐 AU-03 SC-E2）；
- 业务日志事件（ADR-0018 风格，对齐 v2 26 §25.2 命名）：
  - `context.assemble.done` 增加 `omission_count`、`assembly_policy_id` 字段；
  - 新增 `context.downgrade.done`（每次发生预算降级时发，载明 source/reason/replacement）。

### 3.4 DialogueContext envelope 演进（最小增量）

现有扁平结构**不推翻**，按 v3 06 §5.3 增量补三个字段：

```text
DialogueContext +=
  omission_notes      : [OmissionNote.t()]（默认 []）
  assembly_policy_ref : string | nil
  structured_chapters : [%{title, seq, summary, has_prose}]（CP3；current_chapters 标题列表保留，
                         to_prompt_text 的「## 已采纳章节」标题格式不变——它有真实下游消费者）
```

per-consumer 的完整 ContextPacket 体系 defer（§9）；本期 planner 路径行为不变。

---

## 4. 不变量（本契约保护的）

| 编号 | 不变量 | 来源 |
|---|---|---|
| VS00C-I1 | 创作上下文不是全量 dump：任何单轮 prose_writing 的 context_text 不包含整本书正文；跨章信息只能以 summary/结构对象形态进入 | v3 06 §18、`00c` #13 |
| VS00C-I2 | 省略必须可解释：凡是"存在但未进入上下文"的目标章正文/近期对话，必有 OmissionNote + 降级事件，trace 可回答"为什么没带" | v3 06 §5.3/§5.5、v2 26 §19/§25 |
| VS00C-I3 | 预算策略驱动：上下文长度控制只能经 AssemblyPolicy，实现内不得再出现裁剪 magic number | v3 06 §5.3、v2 26 §14 |
| VS00C-I4 | structured > summary > excerpt：预算挤压先挤原文、后挤摘要，永不挤掉目标章身份与计划摘要 | v2 26 §15.4/§14.4 |
| VS00C-I5 | chapter_summary 是写后压缩的独立对象，走 tentative → adoption → authoritative；未采纳的摘要不进入普通创作上下文 | v2 22 §10/§14、v3 ADR-0010 采纳边界 |
| VS00C-I6 | 既有 I1/I2/I3 场景不变量与 real.ex 三锚点（用户创作简述：/上下文：/重要：）不被破坏：本契约只改 context_text **内容**，不改 prompt 模板锚点结构 | AGENTS.md 场景化验收不变量 |
| VS00C-I7 | 组装语义与 provider 无关：分层结构、挤压顺序、权威性过滤对所有 provider 一致；profile 只参数化预算与渲染。切换 provider 不改变"带什么、按什么顺序、谁先被挤掉"，只改变裁切线位置 | SU-01 SU-I4、`08` §2.2 |
| VS00C-I8 | 写作坐标先于上下文：prose_writing 调用必须先确定 WritingCoordinate，再按坐标投影要素；不得从 prompt 文本临时猜目标 | `08` §7、v2 28、v3 01 |
| VS00C-I9 | 缺失处理由 MissingPolicyResult 统一决策：hard missing 不调用 AI，risk missing 需确认，budget missing 可降级但必须留痕 | v2 26 §14.4、v3 06 §5.4 |
| VS00C-I10 | 读者效果是写前输入，不是写后评价：ReaderEffectBrief 能缺省但不能被误当作无关上下文 | v2 31、`08` E20/E21/E37 |
| VS00C-I11 | AI 自报告字段非权威：assumptions / used_context_refs / risk_flags 只能供质量门与 maintenance 复核，不能直接写入作品事实 | v3 trace/replay、ADR-0010 |

---

## 5. 新对象：chapter_summary（连续性层）

### 5.1 与现有 `chapters.summary` 的区分（防混淆，关键）

| | `chapters.summary`（已有字段） | `chapter_summary`（本契约新对象） |
|---|---|---|
| 语义 | **计划摘要**：采纳章节计划时落下的大纲意图（写前） | **内容压缩**：对已采纳正文的高信息密度总结（写后） |
| 来源 | 规划采纳（planning adoption） | maintenance 从已采纳正文提炼 |
| 用途 | 目录/结构面板/写首稿的目标说明（L2） | 续写衔接、跨章连续性、long-run resume（L3a/L5 替代物） |
| 设计依据 | 21 §5.3 结构节点 | 22 §10 连续性对象，"不是 chapter 偷塞一个 summary 字段" |

### 5.2 最小字段（对齐 22 §5.1/§10）

```text
chapter_summaries
  id               : binary_id
  work_id          : binary_id（work 隔离，AU09-I5 同口径）
  chapter_id       : binary_id（anchor = chapter，22 §12.2）
  status           : adoption 7 态（TENTATIVE/ACCEPTED/EDITED_ACCEPTED/DISCARDED/SUPERSEDED/INVALIDATED/ARCHIVED，22 §13.5）
  summary_text     : text（目标 200~400 字，按要素四栏结构：情节推进 / 人物状态与弧光变化 /
                       伏笔动作（新埋/推进/回收）/ 情绪基调——`08` §7：一个对象同时喂四本账的最小近似）
  source_ref       : string（从哪次采纳/哪个 turn 提炼，22 §22）
  revision_base    : string（基于该章哪一版正文，正文重写后旧摘要置 SUPERSEDED）
  inserted/updated_at
```

### 5.3 产生与生效路径（对齐 22 §14.1）

```text
章正文采纳完成（既有 AdoptionWorkflow 之后）
  → maintenance 步骤：调创作 provider 产 tentative chapter_summary
  → 进入既有采纳边界（默认低风险自动采纳或并入采纳回执，由 slice 设计按 ADR-0010 定）
  → ACCEPTED 后进入 L3(a)/L5 替代物
```

同章正文再次续写/重写采纳后，旧 ACCEPTED 摘要置 SUPERSEDED、生成新 tentative（revision_base 指向新正文）。摘要生成失败不阻断正文采纳主链（降级：该章暂无摘要，续写时 L5 仍可用尾部 excerpt，OmissionNote.reason=:stale 记"摘要缺失"）。

---

## 6. 边界（Boundary）

| App | 改什么 | 不改什么 |
|---|---|---|
| novel_domain | AssemblyPolicy、OmissionNote 纯 struct；DialogueContext 增量字段；ChapterSummary 领域规则（状态流转） | 既有 MicroPlan/TurnResult 契约 |
| novel_application | ContextAssembler 接 policy/omission；TurnExecutionService L2~L5 组装与降级；maintenance 摘要用例 | Planner 判定逻辑、GateOrder、AdoptionWorkflow 主流程 |
| novel_persistence | chapter_summaries schema/migration/repo；WorkspaceContext fetcher 返回结构化章条目与摘要 | 既有 reading projection 口径 |
| novel_agent | （仅 CP2）chapter_summary 生成走既有 CreativeProvider 通道，不新增 provider 类型 | real.ex 三锚点模板、stub 既有锚点 |
| novel_web / frontend | trace why 面板透出 omission 摘要（可后置 checkpoint） | Channel 契约主体 |

明确不改：`real.ex` prompt 模板锚点；`to_prompt_text` 的「## 已采纳章节」标题格式（slice_verify 测试 provider 以它计算增量规划起点——这是测试侧消费产品真实 prompt 文本，不是产品感知验收）。

---

## 7. 与既有机制的关系

- **AU-03 长会话压缩（SC-F1）**：会话维度的"最近 turn + session 早期摘要"已有最小实现；本契约是**作品正文维度**的同构治理，复用其"摘要是派生物、原文仍可查"原则，不动其实现。
- **AU-09 memory recall**：L3(b) 直接沿用 `context_fetcher_with_query` 召回主链与 reference log；chapter_summary **不进** memory_items（它是连续性对象，22 §16 中是 warm tier 的*来源*，不是治理记忆本身），避免双轨。
- **VS-00B**：ContextSourceRef/trace 绑定机制沿用；chapter_summary 进入上下文时产生 `source_type: :current_work`（或经 ADR 评审新增 `:continuity`——见 §10）。
- **导出/阅读投影**：`ReadingProjectionRepo.accepted_chapter_prose/2` 仍是正文单一源；摘要绝不反向污染正文投影。

---

## 8. 实现分期（checkpoint，每期独立可验收）

> 每个 CP 须按承重六问补 slice 设计后才可编码；本节冻结范围与验收方向，不替代 slice 文档。
>
> 分期依据是**数据依赖与杠杆率**（`08` §8 同一原则），与当前接入模型的能力无关：CP0 先冻结坐标与缺失策略；CP1 不引入新对象先把既有裁剪策略化；CP2 依赖采纳链路产出摘要数据；CP3 依赖 fetcher 结构化；CP4 依赖规划链路改造；CP5 把读者效果与质量预检接入创作输出闭环。

### CP0 — WritingCoordinate + MissingPolicyResult（先把"这一轮到底在写哪里"固化）

- **范围**：冻结 `WritingCoordinate` / `MissingPolicyResult` 值对象与推导规则；DialogueFrame 或 prose_writing tool_input 中必须携带坐标；确认路径保留原计划坐标与原作者输入引用；hard missing 场景不调用 provider；trace 记录坐标和缺失决策。
- **Proof**：首稿/续写/重写三类输入推导出不同 `authoring_mode`；缺目标章的重写请求返回可解释 block 且没有 provider 调用；确认执行能复用原轮坐标；坐标字段进入 trace；I1/I2/I3 不变量仍过。
- **Gap 关闭**：G11、G13 的 hard missing 部分，并降低 G9 的确认路径风险。

### CP1 — 策略化省略 + 预算 profile 化 + 缺失上下文归正（零新对象，把"补丁"升级为设计件）

- **范围**：AssemblyPolicy/OmissionNote struct；`@prior_prose_max_chars` 迁入 policy 并落为 §3.2 profile 矩阵（profile 由 application 从 Gateway provider registry 的当前 provider/model 解析，地板档初值 2000）；tail_slice 截断产生 OmissionNote（reason=:budget_limited，replacement=nil——本期尚无摘要）；`context.downgrade.done` 事件 + trace_summary 透出；`context.assemble.done` 增加 omission_count/assembly_policy_id；**确认派发路径与正常路径同源组装**（`handle_confirmation_dispatch` 重新组装 DialogueContext、注入 chapter_prose_reader、恢复原轮作者输入——恢复来源由 slice 设计定，关 G9）；**fetcher 异常 fallback 为明确空上下文 + trace warning**（关 G10 / AU-03 GAP-08）。
- **Proof**：单测断言截断必产 note/事件、不截断不产；不同 provider 配置下解析出不同 policy_id 且写入 trace（VS00C-I7 的最小证明）；确认路径执行的 prompt 含与直接路径同源的上下文段（重写已有正文章时 prior_prose 非空）；fetcher 抛错时 turn 不崩且回复诚实说明读不到背景；确定性 provider 全链路跑 I1/I2/I3 不破；外部 driver 从日志/trace 断言降级事件出现在真实 wire。
- **Gap 关闭**：G2、G4、G9、G10（G3 留待 CP2 填 replacement）。

### CP2 — chapter_summary 对象与续写摘要兜底

- **范围**：schema/migration/repo/领域状态流转；正文采纳后 maintenance 产 tentative → 采纳路径（按 ADR-0010 定自动/确认档位）；L5 截断时 replacement 填该章摘要、L3(a) 注入最近 N 章摘要；fetcher 扩展。
- **Proof**：续写一个 >预算 长章时 prompt 含「摘要 + 尾部 excerpt + OmissionNote(replacement=摘要)」三件套；写第 N 章首稿时 prompt 含前 N-1 章（窗口内）摘要；正文重写后旧摘要 SUPERSEDED；摘要生成失败不阻断采纳；dogfood 长跑（LM Studio n_ctx=4096）连续累积超长章不再 HTTP 400 且衔接质量可人工抽查。
- **Gap 关闭**：G3、G5。

### CP3 — 结构对象分层进入创作上下文

- **范围**：fetcher 返回结构化章条目 `{title, seq, summary(计划), has_prose}`；L2 注入目标章计划摘要与前后章位置；`resolve_target_chapter` 改读结构化条目（行为不变）；`current_chapters`/「## 已采纳章节」保持兼容。
- **Proof**：写第 N 章首稿的 prompt 含该章计划摘要与卷内位置；I2 输入差异不变量仍过；既有 P1 章节 slice 全部复跑通过。
- **Gap 关闭**：G6、G1（tool 侧形成独立分层组装，planner 侧不变）。

### CP4 — 章计划结构化（方向层进入 L2，关闭 `08` NEM-GAP-03）

- **范围**：规划动作的章计划产出从自由文本摘要升级为要素四件套结构（章功能定位 / 目标四件套：情节推进·人物变化·信息释放·伏笔动作 / 情绪定位 / 断章要求，`08` E18-E22）；物化到章结构（`chapters.summary` 演进或伴生结构，落地时定）；写章时 L2 注入结构化方向而非一段散文。涉及规划链路（planner 输出 schema、物化层），是本组上下文契约中改动面最大的 checkpoint，故置于 CP3 之后。
- **Proof**：规划采纳后章结构含四件套字段；写该章首稿的 prompt 含方向信息；确定性 provider 与真实 LLM 两档验收（沿用既有规划 slice 模式）；增量规划（追加章）兼容。
- **Gap 关闭**：`08` NEM-GAP-03；L2 方向层从"计划摘要近似"升级为完整形态。

### CP5 — ReaderEffectBrief + 创作输出自报告（把质量门前移到写前）

- **范围**：从章计划 E18-E22、作者意图、continuity/quality findings 组装 `ReaderEffectBrief`；prose_writing 渲染层加入读者效果与风险约束；CreativeProvider/TurnResult 允许承载 `CreativeOutputSelfReport`（字段为非权威线索）；quality gate 和 maintenance 可消费自报告，但不得直接采纳为事实。
- **Proof**：写章 prompt 含 intended emotion / hook / promise 或明确 omission；AI 输出可带 assumptions/risk_flags，trace 可见但作品事实不因其自动改变；质量门能把 risk_flags 转成 warning/confirm/block 之一；没有 ReaderEffectBrief 时按 MissingPolicyResult 降级并留痕。
- **Gap 关闭**：G12、G14，并把 v2 31 质量门从纯后验提升为写前约束。

---

## 9. 明确 defer（不属于本契约，防 scope 蔓延）

| 项 | 归属 |
|---|---|
| 风格层对象（style_sample / writing_preferences / brief / feedback_patch） | 后续独立 contract pack（v2 23 全文为依据）。defer 理由：独立的对象体系、优先级规则与采纳路径，超出上下文组装单一消费面——**不是**因当前模型能力或"质量后置"（该排期决策不构成设计约束） |
| state_snapshot / timeline_event / foreshadowing 独立对象 | 22 其余对象；伏笔/规则现以 memory_items 承载已满足 P1 |
| 五本账对象化（弧光/冲突/信息/情绪曲线/承诺）与三态对账机制 | `08` NEM-GAP-05/06，独立 contract pack（依赖 CP2/CP4 的提炼与规划数据基础） |
| 场级 craft 槽（场景目标/出场人物议程/情绪） | `08` NEM-GAP-04，接续既有创作槽位方向（目标字数槽同型），属规划/槽捕获链路而非上下文组装 |
| 组装八维度中 relevance ranking（embedding）、sensitivity、risk 完整落地 | memory/context policy 后续 slice（VS-00B §6 同源延期） |
| per-consumer ContextPacket 全集与 planner_context 重构 | v3 06 §20 ADR 候选成熟后 |
| token 精确估算（字符数→token 的换算精度） | 后续优化；**注意预算 profile 矩阵本身已属 CP1（§3.2），不在此 defer 之列** |
| 有效期窗口（valid_from/until）参与召回 | AU-09 GAP-08 既有归属 |

---

## 10. ADR 候选

1. **DialogueContext v3 envelope**（v3 06 §20 已列）：omission_notes / assembly_policy_ref 字段进入 envelope 的正式冻结——CP1 落地后提。
2. **ContextSourceRef.source_type 是否新增 `:continuity`**：chapter_summary 进上下文时归 `:current_work` 还是独立来源类型——CP2 slice 设计时定，倾向新增（作者可见 why 面板能区分"作品背景"与"前章摘要"）。
3. **chapter_summary 的采纳档位**（自动采纳 vs 并入正文采纳回执 vs 独立确认）：CP2 slice 按 ADR-0010 边界提案。
4. **WritingCoordinate 成为 DialogueFrame 一等字段**：坐标由 Planner 产出还是 ContextAssembler 推导，需在 CP0 slice 后冻结。
5. **CreativeDecisionPacket / CreativeOutputSelfReport**：是否升级为 schema SSOT，及哪些字段进入 provider JSON contract，需在 CP5 前提 ADR。
6. **MissingPolicyResult 严重度枚举**：block / confirm / degrade / omit 是否作为跨 capability 通用枚举，需与 v3 06 context policy 对齐。

---

## 11. 验收命令方向（slice 落地时具体化）

```bash
# CP0
mix test apps/novel_application/test/novel_application/dialogue_gateway_test.exs
mix test apps/novel_application/test/novel_application/context_assembler_test.exs

# CP1
mix test apps/novel_application/test/novel_application/context_assembler_test.exs
mix test apps/novel_application/test/novel_application/turn_execution_service_test.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i{1,2,3}_*.exs

# CP2/CP3：外部自动化驱动真实页面（场景化验收红线）
bash scripts/tauri_slice_verify.sh <cp2-continuation-summary-slice>
bash scripts/dogfood_run.sh --resume --target-words ...   # 长章续写不再受 n_ctx 限制的真实证据

# CP5
mix test apps/novel_application/test/novel_application/creative_decision_packet_test.exs
bash scripts/tauri_slice_verify.sh <cp5-reader-effect-brief-slice>
```
