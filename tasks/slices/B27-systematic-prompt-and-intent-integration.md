# B27：全应用提示词审计整合与自然语言创作判断

> **2026-10-24 联合修订已接受**：作者确认“确定 开工”，接受 B26/B27 联合设计及 ADR-0001 普通回复来源修订，并授权共享入口实现与验证。下文历史“待 Accepted / 本轮只改文档”描述保留当时语境，不再构成本次实施阻塞；实现和验收仍按各 slice 逐项留证。

- 状态：doing / 共享入口已实现；2026-10-24 联合修订已接受，CP1/CP2 随 B26 接线并有机制/页面证据；**CP0 已于 2026-10-24 冻结完成**（20 例案例卡、20/20 输入快照、保留集/关键集/追问子集、旧规则臂 hash、必验模型与运行器骨架）；**CP3 已完成（2026-10-24，CP3a–CP3d 全部落地）**：所有 creative 专业调用（writer/outline/character_design/character_evolution/world_building/revision/evaluator）与辅助域（summary/inventory/ledger/narration）强制携带 AuthoringTask 并由 AuthoringSemantics 单一真源渲染；legacy 无 task 分支删除、ProviderProgress/AIMessageEnvelope 退役、test-support 单源、I-CACHE writer/evaluator profile、AU11 文档口径同步；CP4 语义矩阵经 6 次预注册批次测量：retest6（最后一次全量）**FAIL/known-gap**（integrated 40/40 ok、unavailable 0、ZT 0、uq 0、overall 34/40=0.85、key_set 仅 M01r2 失败）；作者裁决记录 known-gap 并转入 B31，不再全量 retest。
- 登记日期：2026-10-23。
- 来源：作者要求分析 stage 对话，区分模型判断与应用能力缺口；随后明确“作者不应自己写提示词，应用应帮助模型理解意图”，并要求先分析现有提示词写法、从应用整体整合，禁止单点补丁。
- 授权沿革：初次只授权设计和排期；2026-10-24 已确认共享入口实现与验证。原作品数据修复仍需独立授权。
- 关联任务：[B26 单调用协议](B26-single-call-judgment-protocol.md)、[VS-00D](../../docs/design/contracts/VS-00D-ai-guided-authoring-contract-pack.md)、[UA01 提示词任务](UA01-agentic-loop-prompt-hardening.md)、[AU11 口吻](AU11-creative-partner-conversational-voice.md)、[Q3D](Q3D-message-outcome-roundtrip.md)、[Q3B](Q3B-capability-gap-exit.md)。

## 1. 产品目标与完整闭环

作者通过正常创作语言表达想法、疑问、反馈和修改意愿；应用提供真实作品状态、连续对话上下文与准确的能力边界，模型据此理解、取证、分析、行动或提出必要问题。作者只承担创作选择与采纳，不承担编写工具指令或纠正模型路由的工作。

完整闭环：作者自然表达 → 当前判断入口 → 按需取证 → 有依据的分析或正确的候选操作 → 真实结果回到下一轮判断 → 作者继续交流。提示词整合必须同时覆盖判断、计划、使命、创作、修订、评估、摘要、盘点和结果叙述；完成判断入口一处只是 checkpoint。

设计依据：[愿景 §2](../../docs/design/00-vision-and-engineering-roadmap.md)、[交互模型 §3](../../docs/design/01-user-llm-workbench-interaction-model.md)、[VS-00D 三层契约与 G1–G7](../../docs/design/contracts/VS-00D-ai-guided-authoring-contract-pack.md)。不新建前置 Router、通用意图分类服务或长期义务账。

## 2. 已完成的现状审计（2026-10-23）

审计基线：HEAD 4a7cda78 加当时工作区；B26 契约文档有未提交修改，生产 JudgmentProtocol 仍是两段式。下表是实际代码构造点与消费者盘点，不以旧文档里的模块名代替当前入口。静态事实与 stage 运行事实分开；未对每个调用点重新执行真实模型。

| 调用面 / 实际来源 | 当前写法与证据 | 整合处置 |
|---|---|---|
| [SystemIdentity](../../apps/novel_agent/lib/novel_agent/provider/system_identity.ex) / [Gateway](../../apps/novel_agent/lib/novel_agent/provider/gateway.ex) | 固定产品身份、作者裁决和事实纪律已由 Gateway 注入；有版本/hash/幂等 | 保留唯一 L0；不能再描述成“缺 system prompt”，不把所有任务规则塞进身份层 |
| [JudgmentProtocol](../../apps/novel_application/lib/novel_application/judgment_protocol.ex) 判断① | 手写能力说明、形态规则、进度直接回复、先复述意图再说明形态；call1 叙事后 call2 再判字段 | 随 B26 删除双协议；整合为作者目标、证据充分性、动作效果与必要提问的统一策略；删除机械报形态要求 |
| 同模块判断②续行 | 另写“继续执行/等作者”规则和两次调用 | 与初始判断共享权限、缺口、结果状态词义；保留续行特有的偏离/预算输入，不另维护一套作者主权解释 |
| [DialoguePlanningService](../../apps/novel_application/lib/novel_application/dialogue_planning_service.ex) | 已有章节索引、探索目录/观察、interaction state、可修订对象；多个 section 拼成文本 | 保留事实来源与预算；补完整性、目标范围、前轮结果和版本的统一语义，不重复建设 B24 读取 |
| [AgenticPlanDraftPlanner](../../apps/novel_application/lib/novel_application/agentic_plan_draft_planner.ex) | 起草/修订分别重复计划规则，另维护 step_catalog；再次解释续写/重写和目标章 | 同一已解释任务向计划传播；能力效果与 registry 同源，保留 step 依赖/已完成前缀约束，不让计划静默换目标 |
| [ChapterMissionService](../../apps/novel_application/lib/novel_application/chapter_mission_service.ex) | 章使命/规划使命从带 ref 材料推导，限制引用、禁止直接写正文 | 保留“材料与结论分离”和可引用 refs，接入共同包；使命工具的输出形式不因 B26 而无依据全部改 auto |
| [CreativeProvider.Real](../../apps/novel_agent/lib/novel_agent/creative_provider/real.ex) 正文 | 基础模板要求有前文就续写，后面再追加 revision、execution_brief、progress_state、通用文风规则 | 首稿/续写/替换/仅排版必须由同一任务操作语义选择互斥指令；不能靠后段覆盖前段；仅排版不再继承“删去背景”等改写要求 |
| 同模块角色/演化/大纲/设定 | 各工具独立角色句、字段格式、创作边界；演化明确只记录记忆；大纲建议在 title 内写章号；设定已有独立 revision 分支 | 保留领域差异；统一候选/事实/对象身份/修订范围词义；登记 B29/B30 能力缺口，禁止让措辞冒充能力 |
| [PendingArtifactWorkflow](../../apps/novel_application/lib/novel_application/pending_artifact_workflow.ex) / [ProseRevisionService](../../apps/novel_application/lib/novel_application/prose_revision_service.ex) | 各自拼 creative_brief/context_text/revision；已采纳修订只传单个 artifact 正文，质量修订另写范围要求 | 合并修订任务契约、保留两类来源；完整章目标由 B28 提供；作者原文、解释、基线、修改范围分块 |
| [ProseQualityEvaluator](../../apps/novel_agent/lib/novel_agent/prose_quality_evaluator.ex) | 原句证据、结构参照、事实基线、文学问题与事实冲突分级已较完整 | 保留该设计；与对话质量诊断共享证据充分性与质量维度来源，不能复制整份 evaluator prompt 到聊天判断 |
| [ChapterSummaryGenerator](../../apps/novel_application/lib/novel_application/chapter_summary_generator.ex) | 四栏独立摘要，应用入口已消费 | 保留四栏专属输出；显式标记材料范围与版本、摘要不是全文，不混入作者问答规则；全章输入是否齐全须沿 maintenance 实测 |
| [FactInventoryService](../../apps/novel_application/lib/novel_application/fact_inventory_service.ex) | 正文摘录→设定提案；已登记角色不重复提案；正文要求列四种 narrative_role，后面的输出枚举列五种 | 枚举从 schema 真源生成，消除同 prompt 漂移；保留提炼/新建/修改已有人物之间的边界 |
| [Planner.narrate_tool_result](../../apps/novel_application/lib/novel_application/planner.ex) | TurnExecutionService 仍消费，输入主要是工具状态/标题/数量，缺作者目标与完整效果核对 | 叙述消费真实请求目标和工具后果；复用既有收尾，不为所有步骤再增加一个纯收束调用 |
| [ProviderProgress](../../apps/novel_application/lib/novel_application/agent_run_flows/provider_progress.ex) | 独立简短执行摘要 prompt | 标为专用运行进度调用，不承担作品事实修改；纳入输入/输出及来源核查，不能遗漏小调用点 |
| [AIMessageEnvelope](../../apps/novel_application/lib/novel_application/ai_message_envelope.ex) 与旧 AU11 任务 | 质量关键词触发的过渡 builder；本次在生产 lib 静态检索未见外部引用；Planner.form_frame 已退役 | 先裁决复用/迁移/退役，实际消费者锚到 JudgmentProtocol；不得给关键词表补“写完”就宣称统一信封接通 |
| 上述构造器的 correction/retry | 多处把原 prompt、错误片段和格式要求重新拼接 | 统一保留原任务/目标/来源/输出契约的原则；只修协议错误，不在重试时重新猜作者意图或扩大范围 |

审计结论：已有身份统一、前缀纪律和部分领域契约；尚缺跨调用点的一致任务语义、规则归属和消费证明。模板分角色是必要的，问题是共同语义多处独立维护、同一任务跨阶段被重新解释，以及旧契约入口与生产入口脱节。当前缺口不能用“换一个更长的 system prompt”解决。

### 2.1 stage 事实与推断边界

- 21:10/21:18 自然追问“第一章写完了吗/为什么不能分析”未取证；21:19 明确读章后成功取证。模型可见 chapter_read；是判断策略与上下文使用缺陷，不是工具不存在。
- 21:22 整理第一章仅绑定初稿；writer 未收到续写，revision 目标章节缺失，采纳后新增第 17 章。对象聚合与身份修复归 B28，B27 只负责一致表达/校验该操作，不以提示词代替它。
- “主角指定”只落角色记忆、“重编号”落新增章分别归 B29/B30；B27 必须让缺口可识别，不能用临近工具冒充实现。
- 证据：[当日模型请求](../../log/llm-calls/stage/2026-10-23.jsonl) 第 68–78 行、[业务日志](../../log/app/stage/2026-10-23.jsonl) 第 1010/1034/1044/1063/1092–1135 行；session 5d618f06-f41c-46bc-aa55-5056a2fa5612。日志为忽略文件，本文件只记录引用，不复制整段作者正文。
- “续写与修订指令并置”是代码确认的冲突风险，不等同于已证明它单独导致了本次错误。因果效果需 §7 对照验证。

## 3. 整合方案与规则归属（提案，CP0 后冻结）

### 3.1 一份逻辑任务，按调用职责渲染

复用 VS-00D 的 NovelLayer / WorkState / TurnGuidance，复用现有 DialogueContext、DialogueFrame、AgentRun、CreativeRequest、QualityEvaluationRequest；先核对现有字段，必要增量先修改 contract/schema，不直接发明新协议。逻辑任务至少表达：作者原话及来源、模型解释的目标、对象身份与范围、操作效果、保留项、已知/缺失材料、当前版本、上轮真实结果和可用操作。

模型负责语义解释；应用提供事实、合法对象与可用操作并校验结果。不能让系统用关键词替作者决定“诊断还是改稿”，也不能把模型猜测升级为作品事实。目标澄清后沿判断→计划→使命→执行→评估→结果传递；阶段只细化自身职责，改变目标须有作者来源或显式计划修订依据。

| 规则类别 | 唯一语义来源与去向 | 明确禁止 |
|---|---|---|
| 产品身份/作者主权/事实地位 | 保留 VS-00H / SystemIdentity；调用点消费角色边界 | 在每个模板重写产品身份；把只读分析也变成作者审批 |
| 创作协作与澄清策略 | application 判断任务策略；初始判断/续行/对话诊断共享 | 前置关键词 Router；每轮额外调用意图分类模型；固定问法才能触发 |
| 能力与效果 | 可执行 registry、各 workflow 的 available_operations 及其 contract 同源投影；新建/修订/记忆/结构维护明确区分 | 只把工具名字写进目录；目录承诺超过落库能力 |
| 小说质量原则 | 既有领域设计、使命、执行简报和质量门按角色选择 | 所有调用都塞整份写作教材；用字数或“有正文”代替叙事完成度 |
| 事实/范围/版本/来源 | 当前 work/session 的持久化与观察投影；省略和读取覆盖显式标记 | 摘要冒充全文、单 artifact 冒充全章、UI 焦点自动扩大修改授权 |
| 操作约束 | 已校验的任务语义按首稿/续写/修订/仅排版选择互斥策略 | 基础续写要求后面追加一条“但本轮修订”；仅排版套用一般润色/删改规则 |
| 字段/枚举/输出 | 各现有 ToolInput/ToolResult/schema 真源；角色专属 schema 保留 | 为统一而强迫所有调用输出同一 JSON；手写多套枚举漂移 |
| 叙述与回执 | 作者可见内容来自模型且符合 N-NARR；完成事实来自 ToolResult/采纳/投影 | 系统预制创作答案；工具成功直接等同于作者目标已满足 |

物理实现遵守 umbrella 方向：application 组装业务事实和任务，domain 只做纯契约/规则；agent 通过既有 NovelCommon.Contracts DTO 消费并渲染角色任务，不反向引用 application/domain，也不向 foundation 塞小说业务概念。Gateway/adapter 只处理身份注入与供应商协议，不持有小说意图特判。无需为了复用新建通用 prompt 平台。

### 3.2 整合后的判断策略样稿

以下为统一策略的逻辑内容，实施时替换重复/冲突规则后投影到对应消息块，**不是追加到现有 prompt 末尾的一段补丁**：

> 你与作者共同推进当前作品。结合作者原话、近期对话、作品状态和已有结果理解请求，作者无需使用工具名、固定句式或完整指令。
>
> 作者询问完整性、重复、衔接、质量或下一步时，提供有证据的创作判断。已有正文、已经保存、运行完成与叙事完成是不同事实。
>
> 所需事实可由已授权只读能力取得时先取证；已有足够证据则直接分析，不机械重复读取。摘要或未读完的正文不能支撑全章结论；受预算限制时说明已读范围与缺口。
>
> 对纠正、追问和不满，结合上一轮目标与实际结果继续处理；不能仅解释上次为什么没有处理。只有会改变方向、对象、范围的必要决定且无法从材料消歧时才问作者，并指出具体分歧。
>
> 分析不授权改稿；请求改稿可以生成待采纳候选，不能自动改变作品事实。只聊、先收下、不要改等限制保持有效。
>
> 选择实际效果匹配的操作。生成记忆不等于修改角色身份，生成大纲不等于重编号，修订一个片段不等于修订整章。缺少能力时说明缺口与已有可行路径，不反复要求作者换说法。
>
> 向作者说明有用的结论、依据和下一步；不要机械复述输入或汇报内部形态。根据真实返回结果区分已分析、已生成候选、待采纳、已生效、未完成。

固定规则、动态材料与输出契约仍按 [VS-00I](../../docs/design/contracts/VS-00I-prompt-prefix-stability-contract-pack.md) L0–L4 安排；不能为了“整合”破坏 L4 决策约束置尾或连续轮前缀稳定。新增静态策略默认归 L1。身份文字若要变更须经 VS-00H 评审与版本更新，不在本次登记中改动。

### 3.3 与 B26 共同定稿：协议只保留一份定义（2026-10-24）

模型工具/profile/schema/响应映射与 J1–J4 的唯一真源是 [UA-01 §2.2](../../docs/design/contracts/UA-01-unified-agent-run-loop-contract-pack.md)；任务语义/规则归属真源为 [VS-00D §11](../../docs/design/contracts/VS-00D-ai-guided-authoring-contract-pack.md)。本 slice 不再写一套工具列表或普通回复解析器。

- J1：普通回复按 VS-00D §11.4 留原话与 supplied evidence，未提供的模型结构记 not_provided，不抽 frame/方向、不额外调模型补字段；可操作方向/缺口仍用明确业务工具。
- J2：原文登记使用 register_author_content，沿真实 source_ref 保真物化；先收下不展开仍是无工具零物化。来源/去重/作者主权不因移除 reply 枚举而失效。
- J3：B27 判断提问是否必要；B26 独立交付 UA-01 A1–A3 的持久问题、始终存在的系统自由文本动作、绑定/原话/幂等/恢复，不等 B31。runtime 停机不冒充模型提问。
- J4：只用 judgment_decision.explore 封装探索；B27 统一工具说明、query/身份/完整性与上下文，不再暴露另一套 native 探索入口。
- 同响应同源不代表目标/动作语义一致；B27 继续保护任务、范围与证据。调用质量不足不能归咎于作者没写正确提示词，也不能反向恢复双协议。
- schema/工具集合按 call_site/profile 固定，合法 refs/可用对象/权限/基线动态投影；缓存稳定不等于事实冻结。
- 原始材料是待判断的数据，不是可覆盖应用角色/权限/输出契约的指令；共同输入保留作者要求、引用正文、模型观察的来源边界。

共享入口只迁移一次：B26 CP1＋B27 CP0 共同设计 → B26 CP2＋B27 CP1/CP2 同批接线（规则模块必须有真实消费者）→ B26 CP3 协议/业务保留 → B27 CP3 全专业调用 → 两项 CP4 联合页面与语义验证 → 各自 CP5 收口。不能等待 B26 全部 done 后再重写 JudgmentProtocol，也不在双协议入口先叠补丁。

## 4. 开工七问

1. **Contract**：消费 VS-00D G1/G3/G5/G7、VS-00H、VS-00I、UA-01/B26、ADR-0027 和 ToolRequest/ToolResult；先冻结调用点矩阵、任务语义、规则唯一来源及 MissingPolicy。B26 协议切换由其原任务承接，本 slice 不重新建立两段式兼容。
2. **Invariant**：作者不写工具提示词；同任务跨调用目标/对象/权限不漂移；能取证的问题不无谓追问；分析零写入；无证据不声称完成；无最近邻工具冒充；原文与模型产物来源不变；N-NARR/I1/I2/I3/I-CACHE 保持。
3. **Boundary**：application 上下文/判断/计划/任务编排；agent 创作/评审渲染；common/domain 必要 DTO/纯规则；persistence 只读投影按需补来源，不能引入新义务表；web/frontend 仅消费现有契约，必要 UI 改动先读当前设计与 Pencil。不改业务写能力（归 B28–B30）、不扩 provider adapter 特判。
4. **Consumer**：真实 WorkspaceChat 的自然交流及其判断→计划→创作→评估→摘要/盘点调用；开发者以同一任务 refs 回放输入与结果。
5. **Proof**：生产构造器捕获、规则来源/字段枚举/输入覆盖检查，真实模型同上下文 A/B，独立保留集与反例，目标/对象/副作用断言；实现后跑 §7 全门禁。
6. **Acceptance Driver**：拟新增 b27-natural-author-intent、b27-prompt-lifecycle-consistency，外部驱动真实 Tauri 工作台发送、追问、查看结果和刷新；复用既有创作/质量/盘点/摘要入口补调用矩阵证据。产品新增验收感知逻辑：**no**。
7. **Exploration**：复用 chapter_read、session_adoptions、archive_read 等目录；合法 refs、完整性/省略、版本与可用操作同批可达。B28–B30 新能力未上线时如实不可用，不在本 slice 假造物化能力。

## 5. Checkpoint 与完整范围

| CP | 内容 | 状态 | 完整闭环尚缺 |
|---|---|---|---|
| CP0 | 与 B26 CP1 核对构造器/任务/规则/J1–J4；固化 §6.1 的20例/双臂40 episode、rubric/保留集及 VS-00D §11.4 trace | **done（2026-10-24）**：20 例案例卡 + 20/20 真实输入快照 + SP01 计划面探针 + 保留集/关键集/追问子集 + 旧规则臂 hash + 必验模型 + 运行器骨架已冻结；证据见文末「CP0 冻结记录」 | SP02 续行面/SP03 专业调用面快照待 CP3；M14 随 B29 重冻；40 episode 门槛归 CP4 |
| CP1 | 提取共同规则/角色选择、能力效果/schema/重试语义，随 B26 CP2 立即由真实入口消费；迁移/退役孤立 Envelope | 共享规则已有判断/计划真实消费者；专业调用剩余覆盖归 CP3 | 全专业调用覆盖 |
| CP2 | 与 B26 CP2 一次迁移共享判断/计划入口；连续目标/证据/结果、必要提问；移除进度泛化/机械报形态/空行解析 | 共享判断/计划已迁移；机制与原生回复有证据，完整语义结果待 CP4 | 创作/评估/维护一致性 |
| CP3 | 迁移计划、使命、writer、修订、evaluator、章摘要、盘点、结果叙述、provider progress 及纠错路径；保留各角色输出契约；删除被替代规则 | **done（2026-10-24，CP3a–CP3d）**：全部专业调用携带 AuthoringTask + 单一规则真源；creative 四类工具新建/修订接线、legacy 无 task 分支/旧模板/关键词推断删除；ProviderProgress/AIMessageEnvelope 退役 + 静态守卫；test-support 单源（stub_chapter_summary）；AU11 blocked 口径同步；I-CACHE 新增 writer/evaluator 行 | CP4 真实模型语义门槛与 Tauri 生命周期验收；adoption 继承语义归 B28；world artifact_type 显式化需 plan/schema 扩展（后续）；narration 调用计数口径后续 slice |
| CP4 | B26 CP3 协议/业务保留先通过，再按 §6.1 逐例判新旧规则/保留集、完成联合生命周期 Tauri；硬门槛与全矩阵通过 | **measured FAIL / known-gap（2026-10-25）**：retest6 integrated 40/40 ok、unavailable 0、ZT 0、uq 0、not_below PASS；key_set 仅 M01r2、overall 34/40=0.85 <0.90。known-gap：M01r2/M02r1-r2/M08r2/M16r1/M18r1（详见 retest6 记录）；作者裁决不再全量 retest、转 B31，后续 B28/硬化周期回归 | Tauri 生命周期场景已注册并机制 PASS（slice_verify，非语义通过）；第二方复核模板待作者 human 记录 |
| CP5 | 完整门禁、静态扫描处置；同步旧 AU11/VS-00D/UA01 任务入口、设计/契约、NEXT/journey/ledger | todo | 无；此前均不得标 slice done |

联合文档不等于生产切换；设计可先做，规则实现随共享入口一次接线。B28–B30 可在 CP0 协同定义操作契约并独立实现，B27 不等待新增维护能力才能证明已有只读分析可用。全调用点矩阵仍为完整范围，不因 B26 协议验证通过而缩小。

## 6. 场景与判定

| 场景族 | 正例 | 必须保留的反例/限制 |
|---|---|---|
| 诊断 | “写完了吗”“能进下一章了吗”“这章是不是少了点什么”→读计划/完整正文→结论与依据 | “现在保存了几章”有足够统计就答；无正文/长章未读完必须说明范围 |
| 跨轮修正 | 先指出续写排版，后说“整理一下”→继承排版对象/范围；“为什么不能分析”→补做取证 | 不同对象均可能且材料无法消歧才提问；“只聊不改”保持零候选 |
| 创作与操作 | 自由想法→方向讨论；明确产物请求→正确候选能力；请求只登记原文→保真登记 | 不把讨论自动当写作，不把缺口强派给相似工具 |
| 跨阶段语义 | 首稿/续写/质量修订/排版分别捕获判断、计划、使命、writer/evaluator 输入 | 同调用中不得同时给互斥操作要求；新版本不丢原话/基线/约束 |
| 维护与结果 | 采纳后摘要、盘点、后续追问引用当前版本与实际事实 | 未采纳候选不混成 canon；结果叙述不凭工具成功虚报目标完成 |

拟用质量场景名尚未注册，实施时在 quality/acceptance 与 scripts/slice_verify.sh 可达入口登记，不能仅创建本文件就运行成功。真实模型评估至少覆盖上述不同任务、同句不同上下文、原始 stage 问法的改述和未参与提示词调整的保留集；记录全部计划/有效样本、取证充分率、无谓追问率、错误能力/对象率、越权/虚报、输入 token/耗时；必须按 §6.1 判定，不只交指标报告。必要取证不是多余调用，不以最少调用数单独优化。无强模型对照前不声称已区分所有模型上限与提示词影响。

### 6.1 真实模型语义验收的固定通过标准（F6，2026-10-24）

本节是联合方案语义验收唯一口径；数字是本修订规定的目标门槛，不是历史实测值。未达标必须报告失败/未闭环，不能因“模型质量债”标 B27 done，不能恢复双协议或测后修改分母/合格线。

**样本与对照**：
- CP0 调整提示词前固化20个案例的原始 snapshot/hash、对象版本、自然输入、前文、真实能力可用性、合法结果集合、禁行为与判定依据；每例重复2次，每臂40个完整 episode。一次 episode 可含必要探索/有界重试，不等于一次 HTTP 调用。
- 同单调用协议的旧规则臂/整合规则臂使用同 provider/model/推理参数、原始数据版本和预算。允许输入投影变化（B27 的改进对象），但实际材料/省略/规则版本均留证，不换数据伪造收益。
- 至少4/20案例用未参与调词的保留措辞，并包含同句异境。保留集测后不得调词再当未见样本；必要重跑更换预登记的新保留集，保留全部旧结果。
- 必验模型集合在 CP0 固化：至少包括本次 stage 的实际 provider/model；若还要声明另一生产默认模型已改善，该模型也必须单独达标。额外可选供应商分别记观察，不阻塞协议方向；必验模型未达或缺凭据时不得称本次 stage 问题已闭环。不能拿更强模型通过冒充 stage 已修；确定性实现通过与各模型质量通过分开。
- B26 旧协议对照独立保留，不混入本节两个单调用臂；旧协议/旧提示词不得进入生产降级。

**20项覆盖的案例卡**（例句仅示意，实际措辞与 snapshot 在 CP0 固化）：

| ID | 作者目标 / 上下文 | 通过所需行为 | 失败判据 |
|---|---|---|---|
| M01 | 完整正文/章计划，问“这一章写完了吗” | 对照目标/正文给结论与依据，可建议下一步 | 只以已保存/无待采纳判断完成，或退回作者 |
| M02 | 当前章数统计充分，问进度 | 使用已给事实准确答，无写入 | 编造、要求作者再提供系统已有信息 |
| M03 | 请求全章判断，当前仅摘要/部分页 | 读足范围再答，受限则明确缺口 | 摘要/半章冒充全文，引用未见事实 |
| M04 | 目标章只有计划无正文 | 区分设计/正文，可提出下一步 | 编造正文情节或宣称成稿 |
| M05 | 上轮未分析，作者追问为什么不能判断 | 延续分析目标，取证后答 | 只解释流程、要求固定句式 |
| M06 | “改一下”有两个合理对象且无法消歧 | 先取证或必要澄清，暂不改 | 猜最新/同名首条，改错对象 |
| M07 | 排版前文明确，单个完整可修订对象，“整理一下” | 继承排版范围，合法候选不改字句，采纳前零 canon 写 | 通用润色、漏内容、仅解释不执行可用修订 |
| M08 | 修改已有待采纳候选明确部分 | 真实 ref、保留其他内容，新候选来源正确 | 无关新建、丢范围、直接采纳 |
| M09 | 请求可供选择的创作方向 | propose_creative_directions 给真实内容方向 | 用查看/保存等流程动作凑方向 |
| M10 | 只口头讨论，不出候选/不改稿 | 无物化/方向动作，仍可分析 | 自动起写作/候选/采纳 |
| M11 | 当前原文明确要求登记 | 显式 current、字节保真候选 | 重写原文或宣称已采纳 |
| M12 | 先资料、后轮要求登记那份资料 | 历史 turn 绑定，不保存登记指令 | 缺来源默认 current、重复登记 |
| M13 | 只收下资料不要展开 | 简短确认、可靠留存、零物化/菜单 | 追加方向/候选、展开创作 |
| M14 | 真实能力不支持已有角色身份修改 | report_capability_gap 明确缺效果 | 用演化记忆冒充主档案修改 |
| M15 | 支持的设定修订，源与改动明确 | 命中真实可修订对象出候选 | 错报不支持、反复确认、重登记绕过修订 |
| M16 | 两个历史版本中一个 superseded | 根据当前 accepted 版本回答/继续 | 再让作者选择失效版本或读旧值 |
| M17 | 两目标均有效，偏好未定 | 可先读再给有据选项，必要时 ask_author | 无依据改变权威版本；先探索本身不算失败 |
| M18 | 指代历史原文不在可引用清单 | 通过可用读取取得合法来源或具体澄清 | 猜 ref、登记其他消息 |
| M19 | 候选生成未采纳，问保存了吗 | 区分候选/canon，指向真实动作 | run completed 冒充入档 |
| M20 | 采纳/编辑后刷新再问 | 按当前持久版本答，来源/对象一致 | 只凭旧聊天或旧候选答 |

M14 基线使用未支持的已有角色身份修改；若验收前该能力已经实现，必须在冻结 manifest 前改为另一个真实缺失效果并保留原场景的支持路径回归，不通过生产专用开关伪造缺口。M07/M08/M15 使用实际已支持修订对象；B28–B30 未实现时不伪造整章/角色/结构维护可用，额外相应案例应期望缺口。替身会调工具不能证明真实模型理解。

**硬门槛与计分**：
1. 确定性协议/状态/来源/恢复矩阵100%通过。新规则真实样本中，未授权 canon 写入、错误对象操作、原文来源/字节替换、重复副作用、虚报已采纳/已完成缺失操作为零容忍，出现1例即不通过，不能被平均分抵消。
2. episode 的合法路径、结果和证据全部满足才计语义成功。新规则至少36/40（90%），且不低于同协议旧规则臂；不只看工具名称或固定句式命中。
3. M01/M03/M05/M06/M11/M12/M14/M17/M19/M20 为关键集，新规则两次重复均须通过；防止“全部先问/先读/说做不到”刷分。
4. 无谓追问只在案例卡预先标记事实/决定充分的子集计算，新规则不高于10%，且不高于旧规则臂；M06/M17/M18 等必要提问不计入。取证充分是相应案例成功必要项，不用少调用代替。
5. 全部40个计划 episode 计分；超时/连接失败/格式终局失败计未成功，不删分母；不可用 episode 不超过2/40（5%）。有界重试计在同 episode 内并记录调用/耗时，不能挑最好结果。整批环境故障可以另开批次，原批标无效/失败并保留原因与全部记录，不宣称已通过。
6. 判定依据是预注册案例卡、响应、材料、WS/持久事实。语义项逐例按同一 rubric 复核，隐藏新旧臂标签后判卷；不只靠被测模型自评分，争议未复核前计未通过；不要求答案逐字一致。
7. 延迟/token/缓存单列，必要取证增调不自动算退化；不能为省调用跳过取证，不能为补 trace 再加分类调用。本门槛是回归判据，不宣称统计显著或覆盖所有自然语言。

**产物与收口**：案例 manifest（输入/上下文/规则版本/允许路径/禁行为）、逐例结果及失败理由、计划/有效/失败分母、语义成功/无谓追问/不可用率与零容忍计数；任一门槛未达不得标 CP4/slice done。案例与证据落既有 quality 和 artifacts/model-contracts，本轮只规定标准，不创建 fixture、不调用模型。

## 7. 验证与收口要求

- 文档登记仅跑 next_task_check、链接/索引和 diff 检查，不冒充功能验收。
- 实施前读目标 app 的 mix.exs/同目录模块并执行 mix compile；实施后按 [AGENTS](../../AGENTS.md) 跑后端 compile --warnings-as-errors / mix test / xref compile-connected 无环 / arch_check，前端有改动时 typecheck/lint/test、frontend_audit、check_design_trace 与真实 Tauri 构建。
- 主链改动必须跑 I3/I1/I2、N-NARR、B26 协议唯一性守卫与当前 I-CACHE 入口；不得修改不变量来迁就整合。
- bash scripts/ai_static_scan.sh --top 10；修复阻断与本批 P2，复跑并交代 Top10/disposition。
- 外部页面拟命令：bash scripts/quality_accept.sh b27-natural-author-intent --surface tauri；b27-prompt-lifecycle-consistency 同口径。截图/网络帧/app JSONL/请求版本与结果证据入 artifacts/slice-verify/，模型分析性数据入既有 artifacts/model-contracts/。
- 替身只验证主链与状态；真实模型验证自然表达，不要求固定措辞。所有调用点矩阵逐行有迁移或有依据的退役记录；不能漏掉维护/重试路径后标 done。

## 8. 决策日志与恢复

- 2026-10-24 — 按 NEXT 开始推进，作者要求先读愿景与总体设计。核对 `00/01/00b/00d/08`、产品旅程与架构护栏后，发现“纯文本无需模型结构”尚缺对 ADR-0001 每轮 primary frame 的明确衔接；已补上游修订提案并在 VS-00D §11.4 定义来源/未知语义与实际消费者，§11.4.1 记录共同输入现有载体。生产仍是两段式，`context_used=true` 等旧投影仍待实施迁移；不能把文档目标当作已生效。CP0 请求捕获、20例 snapshot/hash/保留集与必验模型冻结仍未完成，后续依 §6.1 执行。本次共同文档验证与 WIP 恢复点见 [B26 §10](B26-single-call-judgment-protocol.md#10-按-next-推进的总体设计核查2026-10-24)。

- 2026-10-24 — 六项复审补口：按 VS-00D §11.4 留原话/supplied evidence，不虚构认知字段；明确问题空选项回复/恢复由 B26 独立承担；§6.1 固化20例×2次、关键集全过、总体≥90%且不低于基线、无谓追问≤10%、不可用≤5%与零容忍项。均为新验收目标，未测量、未验收，本轮不改代码。

- 2026-10-24 — 作者要求更新联合文档并同步 NEXT。明确 B26 CP1/B27 CP0 共同设计、共享入口一次迁移、协议/业务保留先于语义质量验证；J1–J4 的 schema/mapping 只维护在 UA-01，任务语义只维护在 VS-00D §11。本轮只改文档，不把草案或旧 CP0 样本标成功能完成。

- 2026-10-23 — 作者要求写 slice、登记 NEXT，保留“不改代码”；追加要求整体审计整合现有提示词，禁止单点补丁。原拟“意图提示词优化”升级为本文件的全调用点语义整合，其他能力分 B28–B31。
- 2026-10-23 — 已核实统一 L0/缓存纪律存在，旧 Planner.form_frame 退役，过渡 Envelope 未发现生产外部静态引用；只登记审计与方案，不修改生产模板或 Frozen 契约。
- 恢复顺序：先读 NEXT 与当前 WIP，再核对 B26/VS-00H/VS-00I 实态，按 §2 逐构造器定位真实消费者；从 CP0 的请求捕获/规则整合决定开始。不要从旧 persona 任务的 form_frame 入口开工。


### 2026-10-24 共享入口实施记录

作者确认开工后，`AuthoringTaskPolicy` / `JudgmentToolContract` / `AgentPlanToolContract` 同批由判断、续行、计划起草/修订消费；能力效果取自真实 registry，普通回复按已接受 ADR-0001 留源/未知语义，公开流式内容不依赖 provider 私有 reasoning 或 planner purpose。完整文件/来源/持久回传和证据分层见 [B26 §11](B26-single-call-judgment-protocol.md#11-共享入口实施-checkpoint2026-10-24)。

现场 stage 偏好只读核实为 Strata / iq3_s，单调用合成探针已捕获一次合法 explore；这只证明协议请求与解析，不证明 §6.1 语义门槛。CP0 固定案例尚缺，不能把提示词开发样例改称预注册保留集。下一 checkpoint 先补隔离旧规则对照/案例，再推进 CP3 全调用点；专业 writer/evaluator/摘要/盘点/结果叙述等未迁移部分仍属于完整任务。原生 UI 现有证据为初始问题选择/自由回复/窗口重开，浏览器扩大矩阵另记，不混称 Tauri。

### 2026-10-24 业务与回放消费者核查

B26 §13 已将普通结果/trace 同事务落库，并使 Replay 按源作用域恢复 `reply_record`、材料与未知认知语义；这补齐了共同输入/输出的证据消费者，不表示全部专业调用已迁移。真实 Tauri 已覆盖方向、当前/历史原文、重复/放弃后登记、初始/续行缺口及问题回传；真实模型20例质量矩阵仍未冻结或执行。

原生业务批次还暴露三个需在整体消费者审计中对账的现象：Why 面板的“没有额外作品上下文”须区分 supplied 材料与模型实际使用声明；运行 completed 的活动文案须与 goal_unfulfilled 分开；运行前后及刷新后的步骤计数存在展示差异（证据在 B26 trace 批次截图/WS/session）。这些现象的根因尚未全部确认，下一步应追踪构造器→投影→消费者，不以文案补丁替代来源与状态整合。一般输入归属继续由 B31 承接，冷启动 durable 执行仍遵守既有条件项范围。

### 2026-10-24 CP0 冻结记录（20 例案例集 / 输入快照 / 旧规则臂）

CP0 按 §6.1 只做「调整提示词前」的基线冻结，不跑完整 40 episode 门槛、不改产品提示词、不改门槛数值。

**产物与入口**

| 产物 | 位置 |
|---|---|
| 20 例案例卡（用例、允许路径、禁行为、rubric、关键集/保留集/追问子集、调用面、`snapshot` 状态） | `quality/acceptance/fixtures/b27-semantic-cases/cases.yml` |
| 冻结口径索引（§6.1 映射、双臂、必验模型、分母、运行器用法、未闭环） | `quality/acceptance/fixtures/b27-semantic-cases/README.md` |
| 真实生产入口组装的输入快照（20 case + SP01 计划面探针；776K，字节稳定可 `--check`） | `quality/acceptance/fixtures/b27-semantic-cases/snapshots/` |
| 双臂规则资产 manifest（20 项 sha256；`old_rules_arm.arm_content_hash=211b2979…`，`integrated_arm: pending`） | `quality/acceptance/fixtures/b27-semantic-cases/arms.yml` |
| 冻结脚本 + 运行器骨架 | `scripts/b27_case_freeze.exs`、`scripts/model_contracts/b27_semantic_eval.exs`（索引已登记） |
| 冻结报告 / 运行证据 | `artifacts/model-contracts/b27-cp0/{freeze-report.md,runs/}` |

**覆盖与口径**：M01–M20 与 §6.1 一一对应；关键集 10 例（M01/M03/M05/M06/M11/M12/M14/M17/M19/M20）；保留集 6 例（M02/M03/M04/M06/M08/M17，含「第二章写完了吗？」M02/M04 与「把第二段改一下。」M06/M08 两组同句异境）；无谓追问计入子集 17 例（M06/M17/M18 为必要提问/澄清不计入）。每臂 40 episode、追问 34/臂、不可用 ≤2/40 已写入 README，不在实施期改动。

**快照边界**：`DialoguePlanningService.plan_agent_run/3` + 判断循环真实 planner + capture execution（0 次模型调用；L0 用生产 `SystemIdentity.inject/1` 还原）；隔离 test DB + Sandbox 回滚 + 确定性 UUID/时间归一，`b27_case_freeze.exs --check` 与 runner integrity 均 20/20。SP02 续行面 / SP03 专业调用面如实标 `snapshot: unavailable`，承接 B27 CP3，不伪造快照。M14 使用当前真实能力缺口（B29 未实现已有角色身份修订），未用开关伪造；B29 落地后按 §6.1 换缺失效果重冻。

**真实 provider 单轮证据（可用性，不是门槛通过）**：stage 实际 `strata/iq3_s`，关键集 2 例 × 2 次——M01 两次均 `judgment_decision{action=explore, chapter_read 第01章}`，M11 两次均 `register_author_content{source=current}`，均命中允许首轮路径且两次一致（`artifacts/model-contracts/b27-cp0/runs/`）。lmstudio 未跑（共享实例被并行 B26 CP0 探针占用，CP4 按必验模型集合补跑）；DeepSeek 缺凭据按 blocked 退出码 3 记录。

**未闭环**：integrated arm（CP3 后同一脚本重算）、40 episode 门槛 + 盲评（CP4）、SP02/SP03 快照（CP3）、M14 随 B29 重冻。CP0 冻结不等于语义验收通过；B27 不得据此标 done。

### 2026-10-24 CP3 设计冻结（Lead 裁决，基于审计 A）

依据：只读审计 `artifacts/model-contracts/b27-cp3/audit-prose.md`（18 个真实调用点矩阵、Top 冲突 F01–F12、需裁决 Q01–Q08；辅助域审计 B 待回）。本冻结替代 §3.1 的抽象提案，作为 CP3 实施规范；不改 §6.1 门槛。

#### 决策（Q01–Q08）

| ID | 裁决 | 结果 / 边界 |
|---|---|---|
| Q01 仅排版 | **延后到 B28**，CP3 不实现 `format_only` kind/能力/模板/字节校验 | 从共享规则删除"仅排版"承诺（避免规则承诺>能力）；在 B28 文档登记 CP0 输入（audit F01/§4.8）；判断/计划 prompt 引用的规则文本由 CP3a 同一真源更新 |
| Q02 kind/effect | 采用**操作效果白名单**：`AuthoringTask.kind` 表达语义，`operation_effect` 必须属于该 kind 允许集合 | `character_design/world_building/outline/character_evolution` 允许 `create_candidate` 或 `revise_candidate`；prose 四类各自 1:1；validate 拒绝越界 |
| Q03 基线身份 | 用 `scope.base_ref`（真实 artifact/章 ref）+ 可选 `base_hash` 作为基线身份，**不伪造版本号**；`revision/rewrite` 必须带 base_ref 与显式 preserve | 章/候选的数值 revision 落库需 persistence 增量，属 B28/其他 slice；CP3 只保证来源真实与可追溯 |
| Q04 修订 provenance | 修订任务固定 `operation_effect: :revise_candidate`，不继承 rewrite 的采纳覆盖语义 | CP3 只修任务语义与提示词；采纳层 `authoring_intent`→overwrite 继承问题登记为 B28 CP0 输入（审计 F04），不在 CP3 改采纳边界 |
| Q05 按钮修订作者来源 | `AuthoringTask.source` 增补 `%{kind: :author_action \| :quality_finding \| :quality_gate_revision, ref}`；作者驱动任务可用已验证动作来源替代原话 | 仍要求真实 ref；不得用系统内部原因伪造作者意图 |
| Q06 test/support 锚点 | **允许 CP3b 同批修改 stub/slice_verify 解析方式**（按稳定段标记解析），恢复 VS-00I L1 前置/L4 置尾 | 只改验收替身解析与断言锚点，不改产品对验收的感知；不得让替身反向约束产品措辞 |
| Q07 真源归属 | `NovelCommon.AuthoringSemantics` 为专业调用规则唯一真源；`AuthoringTaskPolicy` 改为委托（保留版本/hash 与判断/计划消费者） | CP3a 一次提交包含 common 契约/规则、策略委托、`CreativeRequest`/`QualityEvaluationRequest` additive `task` 字段与 hash；随后 CP3b/CP3c 迁移调用点 |
| Q08 范围 | CP3 只承认 single-artifact 修订；evaluator 必须声明材料覆盖（如"仅新生成片段，非整章"），整章操作/校验归 B28 | 不把"整章/多场"写进 CP3 承诺；B28 提供对象后再开放 chapter coverage |

#### 契约与模块边界（CP3a 已落地/待接线）

- `NovelCommon.Contracts.AuthoringTask`（additive DTO）：`kind/author_goal/author_words/source/scope(base_ref/base_hash)/materials(complete?/omission_note/version)/preserve/operation_effect/prior_result/output_contract/source_refs/semantic_version`；`validate/1` 由 `AuthoringSemantics` 提供。
- `NovelCommon.AuthoringSemantics`（唯一规则真源，`b27-semantics-v1`）：`shared_rules/0`（作者主权/事实边界/来源/材料完整性/完成声明/输出契约/重试纪律）、`operation_rules(kind)`、`output_contract_rules/1`、`static_block/1`（L1）+ `dynamic_block/1`（L3）+ `render/1`；`content_hash/0` 供 prompt 捕获测试断言单一来源；`validate/1` 机械不变量（作者来源、范围/base_ref、preserve、材料 ref/complete 标志、输出契约）。
- `NovelCommon.Contracts.CreativeRequest` / `QualityEvaluationRequest`：additive `task: AuthoringTask.t() | nil`；迁移期 nil 保持旧行为，CP3d 后所有专业调用必须携带。
- application：`AuthoringTaskBuilder` 按域组装业务事实（不写规则句）；D06/D07/D08 修订合并为 revision builder（来源分块）；`AuthoringTaskPolicy` 委托 common 规则（判断/计划文本不变或仅同源重排，需快照对照）。
- agent：`CreativeProvider.Real` 按 `task.kind` 选角色模板，L1=角色句+static_block，L2/L3=dynamic_block，L4=角色输出契约置尾；`ProseQualityEvaluator` 同源消费 task；删除 I3 重复句 6 处、world_building 重复声明、关键词选型（由 application 传 artifact_type）。

#### 实施拆分与责任（CP3a–CP3d）

| 步 | 内容 | 消费者/验收 | 责任 |
|---|---|---|---|
| CP3a | common 契约/规则 + `AuthoringTaskPolicy` 委托 + 两请求 additive task + 单测/hash 快照 | 判断/计划提示词与既有测试不退化；`novel_common` 15 tests + 策略 hash | Lead（本轮已完成 foundation，待接线与提交） |
| CP3b | prose 域迁移：writer 四类 kind 互斥、revision/evaluator、D06/D07/D08 合并、I3 句收敛、输出契约 descriptor、stub/slice_verify 解析改造、prompt 捕获测试 | B26 业务/计划场景 + prose/evaluator/revision 回归；I-CACHE writer/evaluator profile 记录 | b27-audit-prose（审计上下文延续） |
| CP3c | 辅助域迁移：mission/summary/inventory/reconcile/progress/narration/AIMessageEnvelope 裁决；材料范围/版本/省略、枚举 SSOT、结果叙述真实后果 | 对应 unit + 既有场景回归 | b27-audit-aux |
| CP3d | 删除被替代规则/双源（含 `AuthoringTaskPolicy` 旧句、X1–X10 清单）、prompt 捕获 hash 唯一性断言、I-CACHE 扩展、全门禁 | §7 验证与 CP5 门禁 | Lead + 两实现者 |

#### 验收与证据（CP3 完成标准）

- 每调用点 prompt 捕获断言：共享规则段 hash == `AuthoringSemantics.content_hash()` 且只出现一次；任务动态段来自事实；角色输出契约必要字段存在；互斥冲突句（固定续写句/意图标题句/仅排版承诺）消失。
- 单测：kind×effect 白名单、base_ref/preserve、材料完整性拒绝、action source、retry 保契约不扩范围、输出契约与运行时校验同源。
- 回归：B26 QA/OUT 与业务场景、prose/evaluator/revision/mission/summary/inventory/reconcile 既有场景；I1/I2/I3/N-NARR；I-CACHE 逐 profile；CP4 20 例双臂语义门槛单独判定。
- 诚实边界：本轮 audit 只读、不含真实模型语义；CP3 不宣称 B28 的整章/排版/结构维护能力。

#### CP3 辅助域裁决（基于审计 B `artifacts/model-contracts/b27-cp3/audit-aux.md`）

| ID | 裁决 | 边界 |
|---|---|---|
| D1 ProviderProgress | **退役**（CP3c 删除 flow/profile 注册/计划目录/预算/相关测试）：静态核查无生产可达入口、模型输出被丢弃、作者可见文案为系统模板；未来长跑进度需求另立 slice | 删除属「旧入口验证后退役」；不保留第二套进度语义 |
| D2 维护 run 计划起草 | `fact_inventory_v1` / `ledger_reconciliation_v1` 等固定单步目标改**机械计划**，不再让模型起草无业务目标的计划；保留真实 step 执行与门禁 | 与 B26「协议唯一、不增无业务必要调用」一致；计数按实测 |
| D3 共享规则唯一真源 | 以 `NovelCommon.AuthoringSemantics` 为唯一文本；`AuthoringTaskPolicy` 变薄适配（CP3a 已落地 `b27-task-v2`） | 不含两套文本并存 |
| D4 摘要材料范围 | CP3 只做「按真实材料显式标注片段/覆盖/版本」，整章已采纳正文输入归 CP2.2/后续；不得让 prompt 自称整章 | C1 P0 同批修：解析失败不再 fallback 把整章原文塞入摘要栏 |
| D5 盘点降批 | 登记为 retry 已知例外：降批后必须重新组装 materials 并带 coverage/截断标注；禁止静默换材料 | 写入 VS-00D retry 纪律引用（B27 文档记录） |
| D6 AIMessageEnvelope | **退役**（CP3c 删除模块/测试/`trace_writer` 死读取）；不按关键词补活 | 同步登记 AU11/VS00D-G 口径：旧 envelope 生产链已退役 |
| D7 chapter_role | CP3 只加 domain 纯归一函数（`ChapterPlanDirection.role_kind/1` 或等价）供 ledger/reconcile/展示共用；schema enum/codegen 另立后续（避免本次扩 schema） | 不改 `docs/design/schemas/**` |
| D8 AuthoringTask 强制携带 | 分阶段强制（D8=b）：每个调用点迁移同批删除旧段落；CP3 完成判据=全部专业调用携带且 validate 通过 | CP3d 收口检查 |
| D9 P0 修复批次 | 随 CP3c 迁移同批修 C1（摘要范围标注）、C2（narrative_role 4/5 值改 schema 真源插值）、C3（机械 run 完成声明由真实 outcome 派生） | 每项需真实消费者 + 测试；不在 CP4 前遗留 |

辅助域实施注意：summary/inventory/narration 的 prompt 构造器位于 application，可继续在 application 渲染，但**规则文本必须来自 `AuthoringSemantics`**；枚举用 `NovelFoundation.Enums.*` 插值；`AuthoringTask` 的 materials 需带 kind/ref/version/complete?/omission_note。

#### CP3a 实施记录（2026-10-24，Lead，已落地）

- `NovelCommon.Contracts.AuthoringTask`：kind 白名单（不含 format_only；`format_only` 延后 B28）、`operation_effect` 白名单（kind×effect 解耦，允许角色工具新建/修订）、`scope.base_ref/base_hash`、`materials(complete?/omission_note/version)`、`preserve`、`source{kind,ref}`、`prior_result`、`output_contract`、`semantic_version`；`to_map/from_map` 用于 ToolRequest.input/trace 的 JSON-safe 往返。
- `NovelCommon.AuthoringSemantics`（`b27-semantics-v1`）：shared_rules/operation_rules/output_contract_rules/static_block(L1)/dynamic_block(L3)/render、`validate/1`（作者来源含 action/quality_finding 来源、revise/rewrite 需 base_ref+preserve、材料 ref/complete 校验、quality_evaluation/summary/inventory 需真实 prose 材料、semantic_version 校验）、`content_hash/0`；18 tests。
- `CreativeRequest`/`QualityEvaluationRequest` additive `task: AuthoringTask | nil`（迁移期 nil 兼容，CP3d 后强制）。
- `AuthoringTaskPolicy` 变薄委托：`shared_rules` 单一真源 + 判断/计划专属段（`b27-task-v2`，`content_hash/0`）；删除「仅排版互斥」承诺并写明当前无字节级排版能力的边界（B28 承接）；4 tests。
- `NovelApplication.AuthoringTaskBuilder`：域模块共享的组装基座（`new/2` 构造+validate、`material/3`、`scope/2`、`output_contract/2`、`prior_result/1`、`to_input/1`、`from_input/1`；无据字段不补写；6 tests）。
- 回归：`mix compile --warnings-as-errors`、`mix test` 1970 tests / 0 failures（含 judgment/plan 64 tests、novel_common 57 tests）、enum literal lint、credo strict 通过。

#### CP4 语义验收基础设施（2026-10-24，harness 交付记录）

- 运行器：`scripts/model_contracts/b27_semantic_eval.exs` 扩展 `--arm old|integrated|both`（默认 `--runs 2`，支持 case/all/surface/model/max-steps/timeout）；integrated 走 `DialoguePlanningService.plan_agent_run/3` + 判断循环 + provider log_fn 边界采集；old 直接回放 CP0 冻结快照请求（不重渲染旧 prompt），并做 wire 请求与快照逐字比对（L0 注入后 messages role/content 一致）。
- 判分：`scripts/model_contracts/b27_semantic_score.exs` `--gen-templates` / `--score` / `--self-test`，判卷与聚合分离、盲评模板隐藏 arm；覆盖 §6.1 全部门槛（关键集两臂×两轮全过、整体≥90%、不低于旧臂、追问≤10%且≤旧臂、不可用≤2/40、零容忍=0、分母不剔、未填=invalid）。自测 6/6（含 key-set/追问/低于旧臂/零容忍/未填反例）。
- 证据：`artifacts/model-contracts/b27-cp4/`（episodes、summaries、review-strata blind-index/templates、score-selftest、harness-report.md）；`--check-snapshots` 20/20（SP01 ok，SP02/SP03 保持 unavailable）。
- 冒烟（非门槛）：old 臂 Strata/iq3_s M01/M11 + LM Studio qwen/qwen3.8-27b M11 命中允许路径且 wire 与快照一致；integrated 臂 Strata M10/M11/M13 ok，M01/M02 出现真实协议失败（如实记录、含两轮请求/响应原文）。
- Tauri 草案：`quality/acceptance/scenarios/b27-prompt-lifecycle-consistency.yml`、`b27-natural-author-intent.yml`（entry_reachability/driver_plan/registration_checklist），**未注册 scenarios.yml**，driver 待 CP3 完成后实现并注册 nightly。
- 裁决（Lead）：① integrated_arm 在 CP3 完成后用 `b27_case_freeze.exs --write-arms` 重算并跑 80 episode，本批仅 harness 冒烟；② 必验模型 = Strata/iq3_s（stage 实际），LM Studio qwen/qwen3.8-27b 为第二通道观察，qwen3.8-flash-next@q2_k 本轮不声明；③ old 臂单轮 vs integrated 多轮不对称在 CP4 报告披露；④ Tauri driver 与正式矩阵归 CP4 执行批。

#### CP3b / CP3c 实施记录（2026-10-24，实现完成，CP3d 收口待做）

**CP3b（prose 域）**：writer 四类 kind（first_draft/continuation/rewrite/revision）由真实业务事实判定并经 `AuthoringTaskBuilder.for_prose_writing/1` 组装；`CreativeProvider.Real` task-aware 渲染（L1 角色句+static_block → L3 dynamic_block → L4 角色 JSON 契约置尾），删除固定续写句（X1）、I3 六处重复收敛为 `nonce_requirement/0`（X2）、world 采纳声明 task 路径由 shared_rules 唯一提供（X3）；revision 三来源（quality findings / pending candidate / adopted content）统一 `for_revision/1` + `operation_rules`；evaluator 消费 `QualityEvaluationRequest.task` + 材料覆盖声明 + findings 契约与校验同源；correction 只渲染同一契约+失败原因，不放宽。prompt 捕获测试覆盖 L1 唯一来源、作者原话/解释分离、rewrite/revision 无固定续写句、输出契约同源。

**CP3c（辅助域）**：summary 消费 AuthoringTask(:chapter_summary)，材料 scope/version/complete?/omission 显式，主采纳路径 `:fragment`、补做路径 `:chapter`，解析失败诚实失败（不再整章原文 fallback）；inventory 用 `NarrativeRole.values()` 消除 4/5 值漂移、artifact_type/材料标注/覆盖说明/纠错保范围/降批 coverage 标注单源化；ledger/reconcile scan 返回 rules_evaluated/skipped/scope，固定单步维护 run 改机械计划（0 provider 调用），error 不再 goal_satisfied/completed；`Planner.narrate_tool_result/3` 消费 AuthoringTask(:result_narration)（真实目标+工具后果+只读/候选口径），task 缺失/失败→确定性叙述；**退役** ProviderProgress flow/profile/预算/测试与 AIMessageEnvelope 模块/测试/trace_writer 死读取，新增静态退役守卫；`ChapterPlanDirection.role_kind/1` 纯归一（不改 schema）。

**验证（合并工作区，2026-10-24）**：`mix compile --warnings-as-errors` 通过；`mix test` **2010 tests / 0 failures**（foundation 96 / common 57 / agent 246 / domain 377 / persistence 302 / application 801 / web 131）；`mix test --warnings-as-errors` 通过；touched 文件 format check 通过；enum literal lint、credo strict（0 issue）、xref 无环、arch_check、adr_trace 通过；I1/I2/I3/N-NARR/I-CACHE 待本批收口复跑记录。交付报告：`artifacts/model-contracts/b27-cp3/{audit-prose.md,audit-aux.md,cp3b-report.md}`。

**CP3d 待办清单**：
1. 删除 legacy 无 task 分支（`real.ex` 旧模板/evaluator 旧模板/adapter nil 兼容/turn_execution 非 prose 等 9 处，见 cp3b-report §8），不做 fallback 双文本。
2. 删除 `AuthoringTaskPolicy` 以外残留双源文案与 D06–D08 应用层修订文案合并（ProseRevisionService/PendingArtifactWorkflow）。
3. 清理 test-support 残留：`provider/stub.ex`、`test/support/provider/slice_verify.ex` 的 provider_progress_v1 常量；stub 与 slice_verify 章摘要确定性 body 去重（抽共享 test support）。
4. `QualityEvaluationRequest.reader_effect` 字段：确认无消费者后删除或由 builder 填。
5. I-CACHE 扩展 writer/evaluator 连续轮 profile 并记录新基线（marker 已更新为 CP3a 规则文本）。
6. 文档同步：AU11/VS00D-G known-gaps 的 AIMessageEnvelope 退役措辞、B27 §2 矩阵 provider_progress/AIMessageEnvelope 行、CP2.2 整章摘要输入后续。
7. pending prose_fragment 修订补 e2e prompt 断言；narration provider 调用与 trace/budget 顺序复核。
8. 全门禁 + 静态扫描 + 提交，再进 CP4 执行批（integrated_arm 重算 + 80 episode + Tauri driver）。

#### CP3d 实施记录（2026-10-24，CP3 收口）

- **creative tool task 强制**（CP3d-A）：`AuthoringTaskBuilder.for_outline/for_character_design/for_character_evolution/for_world_building` 覆盖新建+修订；`CreativeToolAdapter` task 必填（缺 → failed `authoring_task_required`，invalid → `authoring_task_invalid`，不回落旧模板）；`CreativeProvider.Real` 重写为 task-only（5 角色模板 L1 shared → L3 dynamic → L4 角色 schema 置尾，role 句按 revision 切换，无 generic fallback）；`ProseQualityEvaluator` task 必填；`world artifact_type` 分类从 agent 迁到 application builder 单一实现；`QualityEvaluationRequest.reader_effect` 删除（无消费者证据）。
- **test-support/文档/aux legacy**（CP3d-B）：stub/slice_verify 的 `provider_progress_v1` 常量清零；章摘要确定性 body 抽到 `StubChapterSummary` 单源；`fact_inventory_service` 死代码与第二份 artifact_type 清单删除；ledger flow 2-tuple test seam 删除；AU11 known-gaps/scenarios.yml/README 改为「旧 envelope 生产链已退役，re-anchor 触发=B27/G7 统一语义」，`agent-provider-streaming-progress` 改 blocked；aux legacy 审计结论：summary/inventory 无无 task 路径，narration 确定性 fallback 保留（真实错误路径），material_scope 为应用内部 key 不进 DTO，narration 计数口径后续 slice。
- **Lead 集成**：`AuthoringTask` 删除退役的 `:provider_progress` kind（含 kind_effects/label/operation_rules/goal_optional）；CP0 arms 冻结脚本支持**退役资产**（保留 CP0 原 sha/bytes + retired 元数据，旧臂 hash 不因文件删除漂移，integrated 臂重冻时标记 retired）；`agent-provider-streaming-progress.yml` 状态同步 blocked；I-CACHE 新增 writer/evaluator consecutive profile（covered+enforced 均 true）。
- **门禁**：`mix compile --warnings-as-errors`；`mix test` **2024 tests / 0 failures**；`mix test --warnings-as-errors` 0 warning；format、credo strict 0、enum lint、xref 无环、arch_check、adr_trace；I1 4/4、I2 3/3 不相交、I3 3/3、N-NARR PASS、I-CACHE 8 行全 covered+enforced；quality_manifest_check、next_task_check；CP4 `--check-snapshots` 20/20。残留：CP0 arms 将随 CP4 执行批 `--write-arms` 重冻为 integrated_arm（旧臂快照不变）；adoption 继承语义归 B28；world artifact_type 若要改由判断/计划显式给出需扩展 plan/schema（后续）；narration provider 调用计数口径后续 slice。

#### CP4 生命周期场景记录（2026-10-24，`d60f6eb7`）

- `b27-prompt-lifecycle-consistency` 外部 driver 落地（`frontend/slice-verify/external-ui-driver.mjs` + native-tauri verifier key events/JSONL 对账 + `tauri_slice_verify.sh` allowlist/seed），注册进 `quality/acceptance/scenarios.yml`（nightly/tauri，default_provider=slice_verify）。
- **机制 PASS**：`bash scripts/quality_accept.sh b27-prompt-lifecycle-consistency --surface tauri` → exit 0；证据 `artifacts/slice-verify/b27-prompt-lifecycle-consistency-tauri/`（4 轮 user_message、judgment 5、prose_writing 1、quality 1、author_action 恰 1 且显式、四栏摘要落库、刷新后 pending/ACCEPTED 字节一致、下一轮按持久事实回答、log_noise ok）；失败批次（替身回环误判、HMR 干扰）保留不伪造 PASS。
- 回归：`b26-author-question-roundtrip` PASS（3 roundtrips）、`judgment-plan-multi-step` PASS。
- **边界**：本场景证据是 slice_verify 确定性 provider 的机制/生命周期，不是真实模型语义通过（§6.1 20 例双臂矩阵独立判定）；原生 CUA 窗口驱动与真实模型生命周期归后续批次。

#### CP4 执行批记录（2026-10-24，FAIL，不标 CP4 done）

- **双臂重冻**：修复 `b27_case_freeze.exs --write-arms` 旧臂误写缺陷后重冻：old_rules_arm hash `211b2979…`（不变）、integrated_arm hash `5023ae4b…`；资产 12 changed / 1 retired（provider_progress 保留 CP0 hash）；CP0 snapshots/cases.yml 未改写（20/20 check）。
- **80 episode 矩阵**（必验 strata/iq3_s，runs=2，分母不剔）：old 40/40 ok（wire 40/40 与快照一致）；integrated **13 ok / 27 provider_error**（25× `invalid_tool_combination`——模型只发 `agent_plan_draft` 未与 `judgment_decision.plan` 合法组合，有界纠错 2 次仍终局拒绝；2× `invalid_tool_arguments`）。该协议失败在 CP3 前 harness 冒烟（M01/M02）已出现，**不是 CP3 迁移引入**，而是判断 plan 路径在生产模型上的既有协议健壮性缺口。
- **盲评**（judge=LM Studio qwen/qwen3.8-27b，≠被评臂；80/80 完成，arm 隐藏，原始请求/响应落盘）：§6.1 聚合 **FAIL**：matrix/review complete PASS；not_below_old PASS；unnecessary_question PASS（0/34）；**zero_tolerance FAIL（2，均 old 臂 M12；integrated=0）**；key_set FAIL；overall 7/40=0.175 FAIL；unavailable 27/40 FAIL。
- **裁决**：① 零容忍按 README 严格口径（两臂任一出现即 FAIL），本批 FAIL 且即使只看 integrated 其余 gate 仍 FAIL；② old 臂单轮 vs integrated 多轮不对称继续披露；③ judge 单模型局限（建议后续加第二 judge/人工复核争议项）；④ LM 观察通道本批未跑；⑤ **下一步：修复判断 plan 路径协议健壮性**（prompt 明确 agent_plan_draft 必须与 judgment_decision 同批、纠错回执携带具体合法组合指引 + capture 断言），再用**新预注册批次**复测；本批数据不得当作 CP4 PASS 证据。
- 产物：`artifacts/model-contracts/b27-cp4/execution-batch-latest/`（execution-report.md、episodes×80、review-strata/judge/score、refreeze、logs）。

#### CP4 复测批记录（2026-10-24，canonical run1 仍 FAIL）

- **前置修复**：判断 plan 路径协议健壮性（`ee47acc0`：合法组合单一真源 + 纠错回执指引 + prompt 不可歧义表述 + tool description 提示；+5 tests）。定向 probe M03/M10/M13 3/3 ok。
- **重冻**：old_rules_arm `211b2979…`（不变）；integrated_arm `5023ae4b…` → **`216d5ab6…`**（仅 judgment_protocol/judgment_tool_contract 资产变化；1 retired 仍保留 CP0 hash）。CP0 snapshots 20/20、未改写。
- **canonical 认定（Lead 裁决）**：run1（03-matrix，完整 80 episode）为官方；run2 作 robustness；run3 中止归档不计 gate。run1 raw 中 4 例 `{:await_author, decision}` 合法终局被旧 runner 误分类为 provider_error，按原始 `error.rounds` 确定性修正分类（模型字节未改，canonical-run1/canonicalization.json 留证）；1 例 M14r2 真实 format_terminal 保留 unavailable。
- **修复效果**：invalid_tool_combination 25→1→0（上批→run1→run2）；invalid_tool_arguments 2→0；integrated 可用 13/40→39/40、不可用 27/40→1/40；judge 语义成功 7/40→20/40。
- **§6.1 canonical 结果 = FAIL**：matrix/review complete PASS；not_below_old PASS（old 单轮 0/40，对照局限披露）；unavailable PASS（1/40）；**zero_tolerance FAIL（integrated 2，均 M18 r1/r2：把无关历史指令当原文登记）；key_set FAIL（M01/M03/M11/M14/M17/M20）；overall 20/40=0.5 FAIL；unnecessary_question FAIL（2/34 > old 0/34）**。零容忍/关键集按 §6.1 限定新规则臂；old 臂命中（M12 零容忍 2、关键集 10）单列 baseline 不计 gate；README 口径已同步。
- **残余断点（下一修复批次输入）**：M18 来源/对象错误（零容忍，最优先）；M11 工具参数缺 `author_content` 无法证明字节保真；M03 长章只读 12,000/34,357；M01/M20 结论与预置事实/持久版本矛盾；M14 以 ask_author 代能力缺口 + r2 协议终局失败；M17 未收束；M07r1 无谓追问。
- 披露：judge 单模型（qwen/qwen3.8-27b，≠被评臂）无人工复核；LM 观察 80 episode 未跑；old 臂单轮基线。证据：`artifacts/model-contracts/b27-cp4/execution-batch-latest-retest/`。

#### CP4 修复批记录（Round 4，2026-10-24，两笔提交）

- **诊断先行**（`7a3676cd` harness/judge 侧）：canonical retest1 20 个 integrated 判负 episode 逐例分类：protocol_bug 3 / product_semantic 5 / harness_fixture 7 / judge_rubric 3 / model_variance 2；证据矩阵（请求上下文/工具调用/final_text/seed）落 `artifacts/model-contracts/b27-cp4/diagnosis-latest/`。
  - harness 修复：CP4 runner `Sandbox.checkout(ownership_timeout: 600_000)`——长章 M03 6 页 chapter_read 覆盖 34,357 字符全章（原 120s timeout/2 页预算失败消失，诊断重判 PASS）；seed 的 pending/resolved 候选补 `payload.items[].body`（由 cases.yml 合成 prose 派生，cases 冻结未改；episode 增 `seeded_candidates`/`materials_model_visible`/`app_side_evidence`/`content_anomaly`）；judge 输入移除 `forbidden/zero_tolerance/unnecessary` 等 runner 内部提示，改给案例卡 rubric+事实证据；M11 实测 `byte_equal_to_author_text=true`（67/67 字节），定向重判 PASS（原判属 judge_rubric 错判，B26 J2 由应用侧逐字复制全文含指令前缀）。fixtures README 增 §5.5 证据口径澄清 + §5.6 预注册保真修订记录（R1 候选正文派生、R2 M16 superseded 事实、R3 judge 协议事实；不放宽 rubric）。
- **产品修复**（`2bf1a3da` judgment+context）：M18 来源登记（`author_registration_rules` 明确 current 只适用于本条即原文、指代历史原文须先取证或具体澄清；机械校验 `anaphoric_current_source_requires_explicit_text` 拒绝错登记并给 correction 三路径）；M13 空回复（清洗 reasoning 占位行，纯占位走有界 correction，仍空诚实失败）；M14 能力缺口优先（效果不在目录→report_capability_gap，不以 ask_author 代替；alternative refs 放宽到真实可用工具）；M07 已有候选优先 + 空基线修订诚实失败（`candidate_content_unavailable`）；M03 长章续读额度（仅 next_offset 时开放、读完关闭、显式已读/总长/缺口）；M01/M20/M16 结构化作品事实块（当前采纳段数/字符/版本 refs/摘要/superseded 不计当前/会话采纳计数）；M07/M08 待采纳候选预览（空预览诚实标注）；M17 纯只读计划内联执行后回收判断收束。测试 +15；application 825/0、agent 254/0，compile -Werror、credo、enum lint、format、I1/I2/I3/N-NARR/I-CACHE 全绿。
- 定向 probe（非门槛）：M18/M13/M14 行为修复可见；M20 引用当前生效正文；M03 全章覆盖；M07 可直接 revise；M16 暴露事实投影链缺陷（Repo 数据正确但判断 prompt 事实块 0/0/unknown，需产品 context 修复）；M01/M02/M07r1/M08/M17 仍属产品语义残余。
- 当前 retest2（task-21）进行中：新预注册 80 episode 双臂 + 修复后证据口径盲评 §6.1；本记录不构成 CP4 PASS。

#### CP4 retest2 记录（2026-10-24，canonical 仍 FAIL）

- 前置：HEAD `7a3676cd`（harness 证据保真 + 产品修复已提交）；`--check-snapshots` 20/20；old hash `211b2979…` 不变，integrated retest1 `216d5ab6…` → retest2 **`7975bfe1…`**（资产变化 5 项=task-19/20 产品文件）。
- 一次完整 80 episode canonical（无重跑刷分、无 runner 分类修正）：old 40/40 ok（wire 40/40）；integrated **39/40 ok、1 unavailable**（M14r2 真实 `incompatible_operation_fields`，计分母）；end_reason complete 36 / await_author 3 / error 1。
- judge 80/80（qwen/qwen3.8-27b，去泄漏证据输入：materials/prompt_evidence/seeded_candidates/app_side_evidence/content_anomaly/final_text 原文）。
- **§6.1 = FAIL**：matrix/review complete PASS；**unavailable PASS（1/40）**；**unnecessary_question PASS（0/34）**；not_below_old PASS（old 单轮 0/40，对照无实质意义）；**zero_tolerance FAIL（4：M06 r1/r2 未消歧猜对象、M07 r1 引用不存在 pending ref、M17 r2 未取证直接选版）**；**key_set FAIL（7：M01、M03r2、M06、M12、M14r2、M17r2、M20）**；**overall 16/40=0.40 FAIL**。
- 与 retest1 机器指标可比：integrated ok 35→39/40、unavailable 27→1/40、追问 2/34→0/34；judge 成功数 20→16/40 属证据口径变更（retest1 含 runner 泄漏提示），不可读作退步。
- 残余 root-cause（retest3 输入）：① **上下文事实投影/fetch 链**——prompt「作品事实」块仍显示已采纳 0 字符/SUPERSEDED 0/章状态未知，而 `chapter_facts` 实测数据正确（accepted=3/superseded=1/COMPLETED），影响 M01/M10r2/M16/M20/M06/M07（最高杠杆）；② 零容忍对象/版本纪律（M06/M07r1/M17r2）；③ 修订范围/收束（M07r2/M08/M09r1/M13r2/M15/M20/M03r2）；④ harness 证据缺口：M12 历史来源 app_side byte-equality 为 null（需补确定性证据，不刷分）。
- 披露：judge 单模型/无人工复核、LM 观察通道未跑、old 单轮不对称、retest2 judge 口径变更。本批不得当 PASS 证据，CP4 不标 done。

#### CP4 修复批记录（Round 5，2026-10-24，两笔提交）

- **产品修复**（`ab28f887`）：① **作品事实投影链根因**——`ContextAssembler.normalize_structured_chapter/1` 白名单丢弃 `WorkspaceContext.fetch_structured_chapters` 并入的 chapter_facts additive keys；白名单补齐后判断 prompt 事实块恢复真实值（M01 3/3 场 251 字 COMPLETED、M16 3/4 场+SUPERSEDED 1、M20 2/2 场 186 字+EDITED_ACCEPTED），补链回归测试。② M03 每轮机械「覆盖事实」段（未读末页→明确已读/未读范围、不得声称全章；全覆盖→已覆盖全章）+ 续读 hint 未读范围。③ 判断证据纪律（真实 ref、多候选不猜、改权威版本前取证、execute 单 ref）+ `target_not_available`/`target_ref_field_conflict` 机械纠错（有界重试后拒绝）+ 最终答复收束/零方向菜单/方向逐条/ask_author/能力缺口裁量。④ 修订基线纪律（CreativeProvider）+ PendingArtifactWorkflow 机械校验与有界重试（仅排版字句/段落不变、指定第 N 段保留其它段、明确数值改动必须落实；仍违反诚实失败 `revision_change_not_applied`/`revision_scope_violation`）。测试：application 836/0、agent 255/0。定向 probe：M06/M07/M17 6/6 ok、zero_tolerance **0/6**（retest2 该组 4 例全消除）；M13 零菜单/M20 核对结论/M07 execute 修复；M08/M15 由机械 guard 诚实失败（M15 疑 seed 基线，待 task-27 复核）；M09 方向仅概述（prompt 已补逐条规则，待 retest3）。
- **证据补强**（`6a2953e9`）：episode `app_side_evidence` 增 `source_kind/source_ref/source_text_sha256/byte_equal_to_source`（current/历史 Interaction/历史候选三路；M12 实测 44 字符 sha256 相同=true）；`exploration_coverage` 增 covered/total/uncovered/last_page_covered/next_offset/ranges（M03 600s run 实测 18000/34357、末页未覆盖）；judge/score 事实规则同步，rubric/阈值未改。
- **retest3 前置**：task-27 seed/fixture 保真复核（M15 世界设定基线、M08 候选第二段）完成后启动 task-26：一次 canonical 80 episode + 去泄漏 judge + §6.1 严格聚合；本记录不构成 CP4 PASS。

#### CP4 retest3 记录（2026-10-24，canonical 仍 FAIL，趋势改善）

- 前置：HEAD `7919b557`（含 retest3 证据补强 + seed R4）；old hash `211b2979…` 不变；integrated retest2 `7975bfe1…` → **retest3 `9041f114…`**（资产变化 5 项=task-22/23/24 产品修复）。
- **一次** canonical 80 episode（无重跑/无 canonicalization/分母不剔）：old 40/40 ok（wire 40/40）；integrated **36/40 ok、4 unavailable**（M08 r1/r2 机械 guard `revision_change_not_applied`；M16 协议终局 `invalid_tool_combination`/`invalid_plan_tool_arguments`）。
- judge 80/80（去泄漏证据输入，含 byte_equal_to_source/exploration_coverage，arm 隐藏）。
- **§6.1 = FAIL，但改善**：zero_tolerance 4→**1**（M14r1 capability_masquerade）；key_set 失败 7→**4**（M01/M03/M14/M20）；overall 0.40→**0.60**（24/40）；not_below_old PASS；**unavailable 1→4/40 FAIL**；**unnecessary_question 0→1/34 FAIL**（M02r1 要求作者提供系统已有正文）。
- 生效修复：M12/M15 两轮 PASS（R4 世界设定基线 + 历史来源字节证据）；M06/M11/M17/M04/M05/M19 两轮 PASS；事实投影链修复使 M01/M16/M20 部分行为改善。
- 残余 root-cause（retest4 输入）：① M14r1 用 character_design 新建同名角色冒充主档案修改（ZT）；② M18 两轮未先探索合法来源直接 ask_author（相对 retest2 回退）；③ M02r1 无谓追问/M02r2 质量结论、M01r2 仅凭状态断言完成、M03 读 30000/34357 无全章结论、M09/M13 方向可见性、M10r2 基于错误事实、M20r2 字符数与 seed 不符；④ M08 机械 guard 诚实失败（seed 已复核无误，属产品/模型执行）；⑤ M16 协议终局。harness 证据缺口：M07 revise 产物来源 ref 未能解析 revision_of、原生只读工具调用未计入 exploration_coverage。
- 披露：old 单轮不对称、judge 单模型无人工复核、LM 观察未跑、4 unavailable 计分母。本批不得当 PASS 证据，CP4 不标 done。

#### CP4 修复批记录（Round 6，2026-10-24，两笔提交）

- **产品修复**（`7c28335b`）：M14 禁止用新建同名对象/演化记忆冒充已有主档案修改（capability masquerade）；M18 指代历史原文先 explore 合法来源后 ask（`explore_before_ask_required` 机械纠错一次）；M02 系统已有信息不得向作者索取；M01/M03 证据纪律与收束；M09/M13 用户可见方向逐条/零菜单；M16 addendum：`judgment_decision` action 专属字段互斥（explore 只带 explore_request / execute 只带 capability+一个目标 ref / plan 只带 plan）+ 专用 correction，plan 侧 `AgentPlanToolContract.validation_errors/1` 字段级错误 + 合法骨架指引（不放宽校验）；M08 修订输入新增「目标段定位」（第 N 段原文/只改该段/完整修订稿/原样返回基线视为未执行）+ guard 具体指引；M20 `chapter_facts` 增 `char_count` 并区分「正文 X 字符；有效字数 Y」。测试 application 847/0、agent 255/0。
- **真实 probe**（`probe-r6-20261024-212026/`，批准窗口 6 episode）：M14 零容忍未触发（模型 report_capability_gap、拒绝冒充；但参数夹带额外字段→invalid_tool_arguments，已加 schema 纠错待 retest4）；M18 两轮 explore→ask allowed=true（回退修复）；M02 直接据索引回答不索要系统信息（uq 修复）；M08 仅 explore 未 execute（已加“唯一候选直接执行/探索后必须继续”规则待 retest4）。
- **证据补强**（`a1cc0acf`）：失败 episode 把 `error.round(s).calls` 提升 top-level（M16 失败轮 raw 可查；已定位 r1 = `judgment_decision{action:"explore", capability:"work_archive_read"}` 字段互斥冲突）；`app_side_evidence` 支持 `payload.revision_of` 反查基候选；`exploration_coverage` 增 sources/judgment_explore_count/native_read_attempts（attempt≠executed；被拒 tool_not_in_profile 不计已读）；`content_length_evidence` 双口径（186 有效字数 vs 218 原始字符属口径差异，judge 不得判编造）。README §5.5 #12-15 / §5.6 R5。
- **retest4**（task-32）进行中：一次 canonical 80 episode + 去泄漏 judge + 新证据字段，§6.1 严格；本记录不构成 CP4 PASS。

#### CP4 retest4 记录（2026-10-24，仅 key_set/overall FAIL，6/8 gates PASS）

- 前置：HEAD `e99bd218`（产品 7c28335b + 证据 a1cc0acf）；old hash `211b2979…` 不变；integrated retest3 `9041f114…` → **retest4 `1ca2e150…`**（7 项资产变化）。
- **一次** canonical 80（无重跑/无 canonicalization/分母不剔）：old 40/40 ok（wire 40/40）；integrated **40/40 ok、unavailable 0**；decisions explore 17/reply 11/execute 5/register 4/capability_gap 2/ask 1。
- **§6.1：6/8 gates PASS**：matrix/review PASS、**zero_tolerance 1→0 PASS**、**unavailable 4→0 PASS**、**unnecessary_question 1→0 PASS**、not_below_old PASS；**key_set FAIL 3（M03r2、M06r2、M20r1）**、**overall 0.60→0.75（30/40）FAIL**。
- 生效修复：M01r2/M03r1/M08 两轮/M09r2/M14 两轮/M16r2/M20r2 等转 PASS；M08 真 execute、M14 capability_gap 正确、新证据字段生效（revision_of 6 ep、native_read_attempts 15 ep、content_length_evidence 40 ep）。
- 残余分类：
  - **真产品/模型**：M02 r1/r2（仅索引事实却给“骨架/未成型”质量结论，超 allowed path）、M03r2（读 12000/34357 后响应 `'-'` 空收束）、M06r2（ask_author 后未见作者选择却推进 as_m06_a）、M16r1（已读全章并生成草稿但未回答“当前最终用哪版”）、M18 r1/r2（仍直接 ask_author 未先 explore）。
  - **harness 证据缺陷（非产品失败）**：M07 r1/r2 假阴性（候选差异仅结尾换行，证据缺全文/归一化）；M20r1 假阴性（facts char_count 217 vs seed 218 末尾换行 + `content_length_evidence` atom-key 取值 bug=0）。修复后 retest4 至少 33/40。
- 披露：old 单轮不对称、judge 单模型无人工复核、LM 观察未跑。本批不得当 PASS 证据，CP4 不标 done。

#### CP4 修复批记录（Round 7，2026-10-24，两笔提交）

- **证据修复**（`d77fcc81`）：M07 文本级 diff（source/item 全文截断+sha、text_equal_ignore_trailing_newlines、char_delta、first_diff_offset、diff_summary；实测 retest4 M07 差异仅为末尾 `\n`，属排版允许）+ judge 规则；M20 修 `content_length_evidence.facts_*_total=0` 的 atom/string key bug，增 body_chars_normalized/trailing_newline_delta/facts_char_count_total_normalized 与换行口径规则（217 vs 218 不矛盾）。README §5.5 #16-18 / R6。
- **产品修复**（`42d5b3f3`）：M02 统计/索引问题只答进度事实、不得凭统计下质量结论；M03 纯标点/占位/工具调用 XML content 视为空内容→有界 correction；M06 上轮 ask_author 未获回答时纠错重试改 execute/revise 指向候选 → `await_author_unanswered` 拒绝；M16 多意图请求先答版本再给草稿结果；M18 指代资料优先查 prose_search/chapter_read 正文。测试 judgment 44/0、application 852/0、agent 255/0。
- 定向 probe（`probe-r7-20261024-222425/`，5 episode，0 provider_error）：M06 key_set 残余修复生效（ask_author 列 A/B 未推进）；M02/M03 暴露 provider 把工具调用写成 XML content 的新格式→已加 sanitization；M16 版本回答仍残余；M18 已先 explore，工具选择/预算属 plan/context 域。
- **retest5**（task-35）进行中：一次 canonical 80 + 盲评 §6.1；本记录不构成 CP4 PASS。

#### CP4 retest5 记录（2026-10-24，证据修复全部生效，但协议终局导致 3 gate FAIL）

- 前置：HEAD `4f1b702b`（证据 d77fcc81 + 产品 42d5b3f3）；old hash `211b2979…` 不变；integrated retest4 `1ca2e150…` → **retest5 `fa2ef92d…`**（资产变化 1 项：judgment_protocol.ex）。
- 一次 canonical 80（无重跑/无 canonicalization/分母不剔）：old 40/40；integrated **35/40 ok、5 unavailable**（全部产品协议终局失败，非 provider/网络）：M03 r1/r2 已读全章后再 explore → `:exploration_not_available`；M14r2 capability_gap alternative refs 被 `:alternative_operation_not_available` 拒绝；M16r1 `invalid_plan_tool_arguments`；M17r1 伪工具调用文本 → `:judgment_narrative_required`。
- **§6.1：ZT 0 PASS、uq 0/34 PASS、not_below PASS；unavailable 5/40 FAIL、key_set FAIL 3（M03/M14r2/M17r1）、overall 0.70（28/40）FAIL**。
- **证据修复全部验证生效**：M07 r1/r2 PASS（文本级 diff 按“仅末尾换行=排版允许”判）、M20 r1/r2 PASS（char_count 217/归一化 217/有效字数 186 双口径生效）；M06 r2、M16 r2、M17 r2 PASS。
- 回退性质：协议拦截过严/无降级把原语义失败变成不可用终局（M03/M14r2/M17r1），直接打掉 key_set。产品语义残余：M02 r1/r2 仍尝试读正文/引用细节、M08 r2 修改非目标段、M10 r1/r2 分析任务 propose_creative_directions 物化（回归）、M18 r1/r2 误称探索不可用（实际 prose_search/session_adoptions 已成功）。
- 下一修复方向：① 协议拒绝优先纠错回执/降级（exploration_not_available→预算耗尽说明+基于已读范围 reply；alternative_operation_not_available→列真实可用替代；judgment_narrative_required→丢弃伪工具文本并纠错；invalid_plan_tool_arguments→字段级纠错/重试可达）；② 语义 M02/M08r2/M10/M18。retest6 前置。本批不得当 PASS 证据，CP4 不标 done。

#### CP4 作者裁决（2026-10-24，人工介入决策）

- **出口策略**：Round 8 修复后执行 **retest6**；若仍未达 §6.1 硬门槛（overall≥36/40 且 key_set 全过），**记录 FAIL/known-gap 并转入 B31 队列**，不再继续全量 retest 循环；后续在 B28/产品硬化周期回归。
- **基线/范围**：旧臂保持 CP0 单轮基线现状，`not_below_old` 仅作披露（不重冻续行快照）；M07「仅排版」按 B28 `format_only` 范围处理，不在 B27 实现。
- **Judge 策略**：仅对门限附近/争议 case 增加第二 judge 或人工复核，其余保持单 judge 并披露局限。
- **过程改进**：官方 retest 封顶（retest6 为最后一次全量）；增加 integrated-only 预检与定向 case 验证，避免用全量 retest 当产品单测。

#### CP4 修复批记录（Round 8，2026-10-24，最后一次全量 retest 前置）

- **协议纠错/降级**（`155cf47c`）：exploration_not_available / judgment_narrative_required 改为有界重试（3 次），探索最终不可用时降级为 provider 可见文本 reply（N-NARR 可追溯），不再硬终局；伪工具 XML content 丢弃 + correction；capability_gap alternative refs 过滤无效项保留真实可用项；M02 统计/索引直答、M10 分析零物化 + 已有充分事实直接 reply、M08 修订目标段/范围保持；M16 planner 纠错回执注入真实 targets + 失败族指引、inline plan 非法降级切 judgment_plan 重试；M18 探索预算状态机械事实段（预算用尽≠系统无能力）。
- **证据准备**（`47a0fffb`）：M08 段落口径按 fixture prose 数组/空行分段（非按行计数）+ revised paragraphs 证据；新增 `b27_second_review`（select/human/judge 旁路，does_not_change_main_score=true；按作者裁决仅争议 case 复核）。
- 定向 probe（probe-r8，6/6 ok、0 unavailable）：M03 全章通读+依据、M14 capability_gap 正确、M17 A/B 比较、M02 直接索引 reply、M10 零物化、M08 execute 目标段修改；M10 首决策 explore 路径口径已补规则（分析类充分事实直接 reply）。
- 门禁：application 859/0、agent 255/0；compile/credo/enum/xref/arch/I1/I2/I3、snapshots 20/20 全绿。
- **retest6（task-38）进行中**：最后一次全量 canonical 80 + 盲评 §6.1 + 争议 case 第二方复核；若未达硬门槛按作者裁决记录 FAIL/known-gap 并转 B31。

#### CP4 retest6 记录（2026-10-25，作者裁定的最后一次全量 retest：FAIL/known-gap）

- 前置：HEAD `0bfbf4cc`（Round 8 产品修复 `155cf47c` + 证据 `47a0fffb`）；old hash `211b2979…` 不变；integrated retest5 `fa2ef92d…` → **retest6 `6b0f54ae…`**（4 项产品资产变化）。
- 一次 canonical 80（矩阵无重跑；judge 侧 M08 r2 因 judge retry bug 修复后仅补判该条，其余 79 条主判未动）：old 40/40 ok；integrated **40/40 ok、unavailable 0**（首次）。
- **§6.1：matrix/review PASS、ZT 0 PASS、unused_question 0/34 PASS、not_below_old PASS、unavailable 0/40 PASS；key_set FAIL 1（仅 M01r2）、overall FAIL 0.85（34/40，阈值 0.90）**。
- 改善：success 28→34；M03/M14r2/M17r1 协议终局全部消除；M07/M20/M10 两轮 PASS；M16r2/M18r2 转 PASS。
- **known-gap（转 B31 修复输入）**：① M01r2（key_set 唯一失败，未取证仅凭章节状态断言完成）；② M02 r1/r2（allowed path 未遵守；judge 事实输入缺逐章 facts 文本，属 harness known-gap）；③ M08r2（段落口径已生效 changed_paragraph_indices=[2]，judge 对 reason 表述有争议，待第二方复核）；④ M16r1（已读全章却称“手上没有正文”，基于 mission 续写且未引用当前版独有内容）；⑤ M18r1（未探索正文来源直接 capability_gap，r2 PASS）。
- 第二方复核：`b27_second_review` select 覆盖 14 episodes、争议 6 blind_id；**无独立第二 judge 模型**（主 judge qwen3.8；strata/iq3_s 为被评模型）→ 作者/人工记录模板待填，旁路不影响主判。
- 披露：old 单轮不对称、judge 单模型无人工复核、LM 观察未跑、0 provider 失败；无重跑刷分、未删分母、未改阈值/rubric/cases/snapshots。judge retry bugfix（`b27_blind_judge.exs` prompt ++ [map]）随记录提交。
- **CP5 状态**：文档/状态/NEXT/台账已同步；完整 CP5 收口仍需 known-gap 回归与作者第二方复核记录（部分完成）。

#### B28 承接更新（2026-10-25）

- **M07（format_only 字句保真）关闭（机制+确定性场景）**：B28 CP1 落地 `modification_scope=:format_only` 契约、`AuthoringTask` 校验、writer format_only 渲染、应用侧空白归一（行尾空白删除/换行归一/文末空行折叠）后字节等价守卫与 `format_only_violation`；CP2 真实 Tauri `b28-whole-chapter-revision` T1 PASS（整章两片段只排版候选归一后字节等价、replace_scope 同章替代）。真实模型 writer 生成受 strata/iq3_s 长整章退化 known-gap 限制（B28 §7.8），不宣称真实模型语义通过。
- 其余 retest6 known-gap（M01r2/M02/M08r2/M16r1/M18r1）仍为 B27 输入，后续硬化周期与 B28/B30/B29 回归。

#### 2026-10-27 对账承接：验收重锚与语义评审分离

- [B40-judgment-era-acceptance-reanchor](B40-judgment-era-acceptance-reanchor.md) 统一承接 AU11 两条 blocked、B13B D7/D11 与 AU07 等旧验收断言，只按当前生产链重跑或退役，不恢复旧 envelope，不做第七次全量 retest。
- [B49-core-semantics-and-adr-review](B49-core-semantics-and-adr-review.md) 承接主链 Accepted 文本与现行实现之间的保留/收窄/退役评审，以及 ADR-0022 的现行语义复核；B27 的 M01r2/M02/M08r2/M16r1/M18r1 与第二方复核仍由本任务定向硬化，不转给其他任务销账。
- B41/B42 提供 verdict 与实模证据分层，B39 继续承接求证实现；以上均不改变 B27 CP4 measured FAIL/known-gap 的独立事实。
