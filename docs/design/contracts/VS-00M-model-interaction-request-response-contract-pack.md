# VS-00M · 模型交互端到端架构与治理契约（B87 / B89 共享设计）

> **完整 JSON 候选审查材料**：[阅读入口](model-interaction/README.md) · [字段规范](model-interaction/01-protocol-spec.md) · [候选 Schema](../schemas/model-interaction/README.md) · [覆盖矩阵](../acceptance/model-interaction-coverage.md)。源包基线为 `f13ff640`；本文件 `04492ea3` 新增的输出通道、tool result envelope、SSE 约束见 [归档差异](model-interaction/integration-notes.md)，仍由 B87 R00/R07/R08 对账。附件入库不改变本文件状态，也不覆盖下文 §6.1。

> **状态：Proposed · 2026-11-13 系统性重审稿（设计已落文档，尚未实施、尚未宣称 Frozen）**。本次作者明确授权彻底审核和修改设计/任务文档，确认**项目未发布、无需历史兼容、要求 clean、禁止不经存在性审查新增实体/设计**。R00 完成 Frozen 契约影响审计与设计决策后再进行正式冻结；不能把本稿直接当现网实现事实。
>
> **设计真源**：本文件只负责“模型请求材料—Provider 往返—系统校验—授权/采纳—审计”的增量契约；[VS-00L](VS-00L-authoring-run-transcript-request-ir-contract-pack.md)（Frozen）、[VS-00I](VS-00I-prompt-prefix-stability-contract-pack.md)、[ADR-0033](../adr/ADR-0033-authoring-run-transcript-request-ir-v3.md)、[ADR-0035](../adr/ADR-0035-session-scoped-canonical-authoring-context-v3.md)、[产品愿景与元原则](../00-vision-and-engineering-roadmap.md#24-创作信息获取元原则最小供给按需求证证据闭环2026-10-27-用户拍板) 高于未经批准的本文件字段草案。与 Frozen 不同处在 §8 单独列出，**先裁决后改**，不偷偷实现。
>
> **实施归属（2026-11-24 前向拆分）**：[B87](../../../tasks/slices/B87-model-interaction-request-projection.md) 保留 R00–R08、R17–R19，负责模型交互基础、相应清理、创作回归与终验；[B89](../../../tasks/slices/B89-author-controlled-execution.md) A01–A08 完整承接原 R09–R16 的能力/风险治理、授权模式、确认、委托、自动采纳与 Smart。两项任务各自维护唯一执行状态与独立完成证据，本文件仍为一处共享设计真源；拆分不启动 B89，也不把待裁决语义改为 Accepted/Frozen。[B86](../../../tasks/slices/B86-structured-model-materials-internal-ref-isolation.md) 的 C9 未完成后果仍在 B87 R06，原失败证据不销账。**不建立第二套 ModelInteraction 持久事实源、Agent loop、Provider adapter 或能力注册表。**

## 1. 产品目标、反目标与优先级

AI Novel Studio 是 **Dialogue-first / Agent-native 的小说创作伙伴**，不是关键词 Router、表单编排器或 Prompt 拼接工厂。作者提出目标，模型自主判断是答复、讨论、取证、创作、修订还是向作者请示；应用提供事实、能力、预算与权威门禁，最后由作品状态和作者授权确定真实效果。

最终评价顺序：
1. **事实正确、无越权、作者主权与正文质量不退化**；再评价成本与延迟。
2. **跨轮语义连续**：模型知道此前承诺、问题、未决目标；不因压缩漏掉最近义务。
3. **来源真实**：Base、作者原话、模型推断、Tool Observation、系统执行结果不冒充彼此。
4. **系统 clean**：没有平行事实源、重复决策器、无消费者实体、旧版运行时兼容、无效抽象。
5. **性能可量化**：简单问答不随轮数携带多份完整 Scope；固定工具/系统前缀继续有效缓存。

反目标：预先用 APP 判完作者意图、按自然语言关键词配发专用 Packet、用模糊摘要代替必要正文、用结构化 JSON 外观冒充上下文优化、用模型文本冒充执行成功、为将来可能性搭框架。

## 2. 系统唯一主链与职责所有权

下述主链表达现役基础及拟建设治理层的职责关系，不宣称所有能力已经实现。模式、长期委托与自动采纳的增量建设归 B89；B87 继续遵守现有身份/作品隔离、对象/版本、预算、确认、作者采纳和真实来源边界，不因批次转出豁免现役缺陷。

```text
真实作者输入（author turn，原文字节）
 → AgentRun（目标/预算/权限/中断/恢复；编排决策）
 → 会话 Canonical Transcript（完整追加、run 执行段、真实工具/校验）
 → application 的请求派生：System + 当前有效 Scope + 必要历史/Checkpoint + 证据
 → 现有 NovelCommon.RequestIR（唯一中立模型交互契约）
 → 三种 wire projection（Chat Completions / Responses / Anthropic）
 → NovelAgent.Provider.Gateway / Adapter 原生请求、流式/终止响应
 → JudgmentProtocol / ToolContract 与 refs/effect/字节验证
 → ExecutionOrchestrator/GateOrder + 作者确认/委托策略 + AdoptionWorkflow
 → 已发生的工具结果/版本事务/DecisionTrace/TurnResult
 → Canonical 追加与 Replay/Why / 真实作者可见展示
```

| 层 / 归属 | 已存在的事实与模块 | 唯一责任；禁止重复 |
|---|---|---|
| 运行与权限事实（domain/application） | `NovelDomain.AgentRun` / `AgentRunPolicy`、`ExecutionOrchestrator`、`GateOrder` | run 目标、预算、工具权限、风险与重门；不得由 Prompt 或 Provider 持有权威执行状态 |
| Canonical 历史（application/persistence） | `AuthoringTranscript`、`AuthoringSessionHistory`、`AuthoringCheckpoint`、`TranscriptCompaction`、`AuthoringSessionLog`、`AuthoringReplay` | 会话唯一追加事实，checkpoint 与作用域投影，run 只为执行段；不能引入新 ModelInteraction 表 |
| 模型请求/协议（common/application） | `NovelCommon.RequestIR`、`RequestIR.Projection`、`JudgmentProtocol`、`ContextAssembler`、`AuthoringTaskBuilder` | common 纯契约与 wire，application 组装可信领域事实；不复制工具 Schema，不把写作任务简化成判断器 |
| Provider 传输（agent） | `Gateway`、`AdapterExecution`、三类 adapter、流式归一化 | 原生工具请求、响应、usage/TTFT、有限模式；不得创造领域事实或自我授权 |
| 能力/效果（common+application） | `NovelCommon.CapabilityRegistry`、`NovelApplication.CapabilityRegistry`、`CapabilityRegistryEntry`、`JudgmentToolContract` | 已注册的能力及运行时可用性，已有 application 局部维护能力不得复制为第三目录；业务 effect 与 agent 决策工具分离 |
| 作者可见来源（common/application） | `NovelCommon.AuthorVisible.Text`、`AgentNarrativeSource`、`TurnResultBuilder` | 模型叙事字节不被应用改写；系统事实使用独立明确标注的状态文案 |
| 作者确认/采纳（domain/application/persistence） | `ConfirmationBinding`、`AuthorActionConfirmation`、`AuthorActionAdmission`、`ApprovalAudit`、`AdoptionBoundary`、`AdoptionWorkflow`、`AuthorActionReceiptRepo` | 对象绑定、重新 gate、版本与写入事务、可重试回执；不绕过边界另开“自动采纳写库”服务 |
| 展示/读取 | `WorkspaceChannel`、`WorkspaceChat`、`ReadingProjectionRepo` | 展示真实结果与作品权威阅读投影；不得把模型的显示建议当成已修改章位 |

**分层原则**：`NovelDomain` 不依赖 `NovelCommon`、`NovelApplication` 不反向被 `NovelAgent` 引用；三 wire 与跨应用纯契约归 `novel_common`，IO/决策编排归 application，DB 事务归 persistence。遵守 `AGENTS.md` 与 `scripts/arch_check.exs`；“四层闭环”是观察模型，不是四套新持久对象。

## 3. 软件工程原则在本项目的可操作判据

| 原则 | 实施要求 / 典型违例 |
|---|---|
| SRP | 请求派生、Provider 传输、授权决策、采纳事务、作者可见来源分别负责；禁止一个 Builder 同时组装 Prompt、判断风险并写库 |
| OCP | 采用现有 registry/contract 添加能力，扩展已有行为；**不是禁止为修复错误而修改已测模块**，不为 OCP 生成无消费者接口或兼容胶水 |
| LSP | Elixir 重点体现在 Provider behaviour/Tool executor 契约替换：不同 adapter 的 call_id、流式终止、usage/错误语义和原始字节不得悄悄降级 |
| ISP | 判断器只拿当前需要的工具/事实，Writer 获得必要正文；不把全能力目录、管理功能与原始作品档案强制塞入每次调用 |
| DIP | application 的上层规则只依赖 common/domain 契约，IO 经现有端口注入；不在 common/domain 为了读取数据库或 Provider 反向依赖 |
| LoD | Writer 不知道持久化表结构，Provider 不知道作者采纳，UI 不访问 Repo；交互经合法直接协作者和明确结果契约 |
| CRP | 复用模块组合、行为协议与已实现纯函数；Elixir 无须为“继承体系”造类 |
| DRY | 能力 effect、工具 JSON Schema、风险基线、错误 reason_code、来源判据只存在一个权威注册/校验位置 |
| KISS | 能用现有 IR/Transcript、已有 Gate 和 Receipt 收口，不多加 Adapter、协调器、路由器和重复状态层 |
| YAGNI | 不预建泛用规则引擎、权限服务、复杂配置中心、多 Agent；缺现实消费者的抽象一律不落地 |
| SoC / 封装 | 清晰的领域值、应用编排、持久化与模型传输边界；公开尽量少的稳定接口，内部 shape 不泄漏 UI |
| 适度工程 | 复杂度与真实需求、已知风险、明确演进一致；无历史兼容不等于牺牲边界/回滚/可观测性 |

审查标准不是“写了多少层”，而是**一个事实只由一个责任方负责、一个改变有真实消费者且可被端到端验证**。

## 4. 强制存在性审查（新实体/新设计/新字段之前）

**红线**：任何新增 module、struct、DB 表/列、API、工具、事件、Schema、Context Block、风险分类、权限设置、prompt DSL、checkpoint 类型、配置项、任务源，必须在改动前出示证据：

```text
拟新增对象/能力 → 所需真实用户效果 → 首个消费者
→ 全仓现存实体/契约/字段/端口/配置/事件/测试检索
→ 已存在的职责是否能够复用或收敛？为何不能？
→ 四种裁决：reuse / refactor-and-retire / truly-new / reject
→ if truly-new：不变量、生命周期、所有权、版本、故障/撤销、验收、删除旧入口
```

| 曾建议新增的名字 | 核查到的存量事实 | 本设计裁决 |
|---|---|---|
| `ModelInteraction` 表、`ApplicationRequest` 持久实体 | Session Canonical + RequestIR + ProviderRunLog + DecisionTrace | **REJECT**：仅作为非持久化观察/投影视图 |
| `ContextBlock` 新总线 | `RequestIR` message/blocks、`DialogueContext`、`scope_update` | **REUSE/REFACTOR**：优先用现有 typed payload + 投影；证明确有语义缺口再改现役 IR |
| 新 Session、Run、Checkpoint 仓库 | `WorkSessionRepo`、`AuthoringSessionLog`、`AuthoringCheckpoint`、`RequestIR.Compaction` | **REUSE**：不可再建第二套；需要拓展覆盖必须审查 Frozen 合同 |
| 新 Provider Wire、工具 Schema 管理器 | `RequestIR.Projection`、`JudgmentToolContract`、Gateway/Adapter | **REUSE**：同源校验与失败结构化，不建立外壳 |
| `CapabilityCatalog` 第二表、`capability_lookup` 新工具 | common+application registry 和已有 explore 工具；`capability_lookup` 当前尚无核实的生产入口 | **先审查真实调用价值**；不足则在既有探索面/注册表加只读端口，绝不直接新增第二 registry 或预先要求第八个判断工具 |
| `RiskPolicy` 新服务、风险主表 | `CapabilityRegistryEntry.risk_class`、`MicroPlan.risk_hint`、`GateOrder`、`ApprovalAudit.risk_class` | **REFACTOR**：registry 为能力基准，应用统一派生实际效果风险；淘汰互相矛盾的风险副本 |
| `AuthorizationMode`、`DelegationRecord`、新偏好表 | `AgentRun.authority_scope`、`AgentRunPolicy`、WorkSession/作品配置、author action/receipt/trace 已有 | **存在性审查未完结**：若现有模型不能安全表达继承、到期、撤销、范围绑定，才允许新增最小值/持久字段；先于代码有专门审查表 |
| `ApprovalRecord`、`AutoAdoptionService` | ConfirmationBinding、AuthorActionAdmission/Confirmation、ApprovalAudit、AdoptionWorkflow、ReceiptRepo | **REUSE/REFACTOR**：复用已存在的决策与事务，不再建第二采纳服务 |
| `AuthorVisibleFilter` | AuthorVisible.Text、AgentNarrativeSource、JudgmentToolContract | **REFACTOR**：模型内容拒绝+纠错，不做展示文本后处理/替换，保护 I1/N-NARR |

这是一份**已核实对象存在性的架构审计入口，不是“所有能力均已实现”的声明**。真实性、可满足程度由 R00/各批在现行 HEAD 逐符号与真实消费者复核；未验证的持久授权设置/撤销机制不能写成已有能力。

## 5. 请求构造、上下文与明确的来源类型

### 5.1 单一事实流与示意结构

```text
RequestIR（已存在，生产中立契约）：
  run       : 运行身份/目标的不可变快照
  system    : 身份 ref + 宪法/输出协议版本
  messages  : Canonical 中可进入此次模型请求的有序消息视图
  tools     : 当前 profile 的真实、完整 tool schema
  projection: tool_choice / usage_streaming / finite_mode
  refs      : base_refs / observation_refs / used_refs
```

**不把整个“model_interaction_request + provider_request + response + validation” JSON 发给 Provider**。Application Request 是由 run/会话派生的逻辑视图，不得被反向持久化成第二真源。原生 Provider 请求只包含目标 API 接受的 system/messages/tools/参数；三种 wire 投影必须使用同一个 IR 来源。

### 5.2 Base / History / Scope / Author / Tool 责任

- **System**：`SystemIdentity`、共享宪法、profile 规则与工具输出契约；沿用 VS-00H/VS-00I 缓存前缀，不能把动态 run_id 插到静态前缀前；保留“靠近决策点”的有证据判例而不机械把全部规则提前。
- **Application Base**：作品/任务坐标、当前可用权限、剩余预算、状态版本、内容读取入口、必要的安全底座；无关的全角色档案、历史候选 body_preview 不默认供给。
- **Scope**：每次更新追加带 `source_refs / versions / change_reason` 的当前范围事实；现行 `scope_update` 的 canonical 消息不改写。Model-facing 当前范围材料可以结构化为 `facts`（有来源/版本）、`coverage`、`omissions`；不能把作者意图猜测、预判问题结论填进事实栏。
- **历史**：真实作者原话、assistant/tool 顺序、尚未完成义务、可验证 checkpoint；不能只放最近轮摘要丢失跨轮依赖。
- **作者输入**：当前原文独立 `user`+author provenance，字节保持；应用附注不冒充作者、工具/外部不可信文本不得升格为 system 指令。
- **工具**：完整且合法的原生 Schema 来自同一注册表；业务能力与 Agent 决策出口分别定义，`report_capability_gap` 不是作品写入能力。
- **Writer / Reviewer**：按目标读需要的全章/目标段/章计划/角色状态/作者风格样本；范围、覆盖、未读、当前 accepted 基线与 tentative 明示，不能以省 Token 代替完整基线。


### 5.2.1 R02 当前 Scope 纯值契约（2026-11-14）

R02 沿用现有 `RequestIR`、`AuthoringTranscript`、`DialogueContext`、`ContextSourceRef` 与 `AuthoringTask`；不新增持久实体、仓库、通用 ContextBlock 或第二份 Provider JSON 真源。新生产的 Scope 唯一形状为 `scope_update/application` 消息中的一个 `{type: "scope", content: {...}}` 块。外层 `source_refs/versions` 仍是该消息的来源与版本；`content` 使用既有 JSON payload codec，不增加 nested-key 白名单。

| 字段 | 来源与唯一职责 | 缺失、覆盖与校验 |
|---|---|---|
| `content.work_id` | 当前请求绑定的作品身份，与 RequestIR run 一致；DialogueContext 也唯一使用 work_id | 独立专业操作没有作品时可同时省略；绑定 ID 不证明已读取事实。common 只校验结构及值间一致性；真实数据库/授权核验属于现有 owner |
| `facts` | 实读 work metadata、章节目录/版本、相关资产与目标；对象使用唯一 `ref`、实际 `work_id` 和已知 `version` | 未读字段不造值；不从标题推定有正文，不从作者期望推定当前可见；不存在可确认版本时不伪造 |
| `goal` | 既有 run.goal 的应用目标/解释，标 application 来源；可绑定 `source_input_ref` | 不成为第二作者原文字段；v2 本身不证明作者来源，真实 steer/回答以既有 Interaction receipt 绑定 |
| `context` | 既有会话/记忆/行为/交互派生材料及来源；显式 derived/application | 不升格为作品事实；模型推断继续保留在 assistant/工具参数 |
| `authoring_task` / `operation` | 专业调用复用现有 AuthoringTask 和当前操作的结构字段、真实输入材料 | 不把已渲染巨型 prompt 套 JSON；真实 prose/material 字节不改写，指令留现有 system/profile owner |
| `coverage` | 按实际来源记录 `complete/partial/not_read/unavailable/stale` 与已知 count/returned/total | 成功空集合才可 complete+0；未读不报 0；目录覆盖不等于正文覆盖，当前 draft refs 截断必须可见 |
| `omissions` | 带非空 `source/reason` 字符串的 JSON map 列表，记录实际预算裁剪、未读、来源失败和截断 | 不接字符串双形状，不从缺省值推断 empty canon，不隐去不完整读取 |

现役生产入口共五个：JudgmentProtocol、CreativeProvider.Real、ProseQualityEvaluator、ChapterMissionService、AgenticPlanDraftPlanner。后四复用 RequestIR.Operation；使命材料沿 ChapterMissionInputs 的原 ref/group/text，计划沿实际 chapter_index_reader，不以标题伪造身份。common 的事实 ref 校验只证明供应 Base 与本消息来源一致，版本自洽只比较实际提供的 work.version；不把 run 创建时的 authority_scope.work_revision 冒充最新版本。

当前作者原文仅由独立 `user/author` 消息提供，来源沿用 Interaction 的 turn/ref；空白只用于合法性检查，不用于变换文本。应用目标与作者字节分别承担原有职责。当前阅读可见性来自真实 ReadingProjection 的目录成员；`desired_visible` 是作者要求，不能写成当前事实，也不预设没有来源的值。

作者来源由既有 `TurnInteractionService.author_input/2` 一次返回 `%{turn_id, text}`：v1 使用明确输入命令，v2/steer/自由答复按 work/session/run/turn 读取 Interaction receipt。专业 planner、mission、writer、候选修订与 continuation 使用同一选择中的字节及引用；`source_input_ref` 沿现有 Operation opts / CreativeRequest 透传。合成的目标、步骤、观察和指导属于 `creative_brief`，不再装进作者原文字段；AuthoringTask 的 `author_words` 只取显式原文。应用通过 AuthoringSession/AuthoringTranscript 按来源幂等追加作者消息；同来源不同字节拒绝，common 不推测后续回合、不读库。没有作者输入的内部动作保留其应用来源，不补作者话。

Operation、text_operation、JudgmentProtocol 与 AuthoringTranscript 共用现有 RequestIR 的作者消息构造边界：仅接受两个 nil，或非空白原文与明确输入引用的完整配对；首操作、standalone 和 continued 都拒绝半对/坏类型，不从 run.parent_turn_ref 回填。continued 的合法配对也不由 common 自动追加作者。Quality 与辅助叙述复用 AuthoringTask.source 的 author_action 引用；待评审材料的 source_turn_ref、quality_finding 与 quality_gate_revision 不能充当作者输入来源。 Judgment 使用实际 plan_run 或既有 transcript 的运行身份，不再生成 judgment:current 或 author_turn:current；普通判断必须提供作者配对，纯应用 continuation 明确允许两者同时 nil。

专业 Operation 的 `source_refs` 只说明 Scope 来源；`base_refs` 明确列出已供应材料，缺省为空，不能从一般来源回填。Real/Quality 沿 AuthoringTask.materials 的 ref/实有 version，使命沿 ChapterMissionInputs 的真实 item refs，计划沿实际章节 facts。作者回合、目标范围和观察引用不会因作为 source 出现而自动进入 Base 或 Observation；common 只检查显式值，不替应用裁定材料是否实读。 Judgment 继续用 supplied_context_refs 表示实际供应的 Base，scope_source_refs 只表示普通来源；Scope 消息引用是两者并集，Transcript 追加接口显式接收独立 base_refs。相同 Scope 下首次实际供应的材料也必须登记，不能被 Scope 去重吞掉。Prose continuation 的 plan/observation/evidence 关联仅属普通来源，末六条摘要和偏差信息不能冒充完整计划或证据已供应。既有 Base 与真实 observation_refs 保持原职责。

辅助结果叙述仍使用现有 text_operation，不伪造工具或 Scope。AuxTaskBuilder 只消费同一个真实 author_input 的 turn_id/text，复用 AuthoringTask.source/author_words；Planner 的 system 只消费 static_block，dynamic_block 中的作者原文不重复进入应用材料。text_operation 仅对显式 author_text/source_input_ref 成对输入建立独立 user，缺/坏配对拒绝；两者同时为空时保留原有纯应用调用。作者来源不推导自 frame、tool 或 provider；已有无作者的章节摘要与事实盘点不扩大本次改动范围。

新块只允许出现在 `scope_update/application`，不能冒充作者、模型或真实 tool observation。现有真实工具执行仍按 call_id 进入 observation；Base 与 observation 引用保持分立，used_refs 仍受既有边界约束。三 wire 只消费公共 Scope renderer，不先用 text-only 判空，也不独立组装另一份事实。

本批删除字符串 Scope 生产 API、判断器拼串、Operation 拼串和多形状 fetch 兼容，迁移全部现役消费者。历史 canonical 中的原 text block 按通用文本语义保留为真实证据；不解析成新事实、不重写、不静默过滤。R03/R04 的覆盖/压缩契约不在本批提前实施。

**2026-11-15 职责复核**：原生 Scope 的构造/校验/绑定/revision/append 统一由 `RequestIR.Scope` 承担，RequestIR 只组合该纯值 owner；这不是新 DTO 或第二事实源。独立文本请求归已有 `RequestIR.Operation.text_operation`，全部现役消费者迁移并删除旧 parent 入口。判断专属静态规则归已有 AuthoringTaskPolicy；原文登记的应用业务规则归 NovelApplication.AuthorContentRegistration，已有同名 persistence 模块继续只持有事务防重。TurnInteractionService 保留 Interaction 接收、receipt 和真实作者输入选择。存在性审计、七问、消费链与退役记录见 B87 §13.2；以上划分不改变本文的来源/作者/覆盖语义。

### 5.2.2 R03 真实反例后的判断材料责任修订（2026-11-15，先于实现）

本修订消费愿景 §2.4 与 §5.2 的最小供给原则。真实三轮在作品事实没有变化时，Scope 默认重复携带完整章计划/章摘要、全角色正文及历史文字预览，并把无关作品人物带入新故事讨论。修订的是判断材料的生产与实际消费职责，不能在 History/Projection 中过滤已记录 Scope，也不能降低压力判据、最近 K 保护或作者原文要求。

- **判断底座只提供当前必要事实。** 保留真实作品身份、明确绑定的当前写作坐标、权限、预算、版本和采纳/处置边界；全章节材料、全角色清单及正文不默认披露。操作目标只供应当前消费者实际需要的定位/类型/版本/状态元数据，不能把目标 DTO 全字段当模型材料。完整章计划、章摘要、角色正文转由现役探索读取。应用内部合法对象核验可以读取真实目标集合，但不会因此授予模型“已观察”的事实。
- **历史文字只有既有 canonical 供给链。** 判断 Scope 的交互状态保留来源身份、handling、registration、truthfulness、pending/resolved adoption 及覆盖缺口，退役作者文字和 assistant 400 字预览；不得另造摘要或文本字段补位。run.goal 实体继续存在，判断 Scope 只提供版本/作者来源等目标关联，不再复制作者原文。旧 canonical 消息和 Interaction 原始内容不改写。
- **稳定定义与当前允许集分离。** 既有 AuthoringTaskPolicy/CapabilityRegistry/ExplorationService 提供当前 profile 的稳定定义，由既有 SystemEnvelope/初始 Base 构造一次；Scope 只携当前允许名称、真实目标、预算与状态。定义目录不是授权，旧目录或旧 Scope 不恢复已失效能力；同 run 稳定层不因预算、目标和权限更新而重写。不建立全局全能力投喂表或第二注册表。
- **按需读取必须同批闭环。** 复用 archive_read、chapter_read 与现有 ReadingProjectionService、CharacterProfile、AdoptionRepository 读口。archive_read 明确提供章节/角色目录及角色详情的有界查询，模型无需故意猜错名称发现目录；保留 string query 传输，结构参数沿现役 JSON query 方式表达 facet/ref/offset。角色目录用于发现及只读身份核对，显式返回 ref/name/aliases/narrative_role/status 与所返字段/条目范围，不返回自由文本 role、summary、updated_at 或完整修订基线；未标记身份不能推断为主角，多主角如实保留。正文经详情分页完整可达，不能沿用无续读的 1500 字截断。只返回真实本作品 accepted/edited_accepted 对象；无结果、未读、缺页、跨作品、过期来源都明确表达。角色沿用既有 base_fingerprint，不伪造整数版本。 memory_recall 只返回实际记忆来源，不再按“主角/谁是”等关键词暗读人物主档案拼入记忆正文；当前人物事实通过显式 characters 目录/详情或现役 character_roster 读取，并携自身来源与版本。 章节目录按既有 ReadingProjection 的 accepted 正文 word_count>0 语义返回 has_prose，以区分同名计划章与已存正文章；该布尔事实不授予正文已读覆盖。
- **观察与精确操作共用实际来源。** ExplorationService 的既有 observation_metadata 把同一次真实读取的 source_refs、versions、coverage/omissions 传给既有 AgentObservation；判断续行和 writer 的 used_context_refs 沿现役证据校验消费。角色操作必须绑定实际观察中的对象 ref 与当前指纹，不能因猜中了应用内部 roster 的 ref 就视为已读取；实际供应集取本次 prepared RequestIR 经现役 Compaction.project 的可见消息，并复用 RequestIR.observation_payloads 展开真实观察叶；可见且当前指纹一致的历史详情可以复用，不能要求新 run 机械重读，被覆盖隐藏的旧详情与累计 refs 不构成已读事实。CharacterProfile.observed_target 是唯一匹配规则，返回当前真实 target 与选中的原 canonical 叶；协议仅在既有 judgment 的内部 character_observation 保存该叶，实际候选构造消费同一叶再核当前指纹，不能在二者之间悄悄换成未观察的新基线。不接受 raw exploration 与 canonical 两种形状并行，也不将该内部凭证加入 Scope 或模型 schema。 现有 reply_record.supplied_observation_refs 同样只从本次 prepared 可见观察叶取得；raw exploration 暂存列表、累计会话 refs 或 profile 猜测均不能证明该次供应。narrative_role 修订要求所需身份/消歧字段、当前叙事身份、采纳状态和完整真实指纹已在详情观察中返回；长 summary 的未读页如实保留，不强迫无关正文续读，也不冒称完整档案已读。最终采纳继续由既有事务重验完整指纹与字段边界。读取不构成写入授权。
- **续读资格由真实上一页决定。** 既有普通探索两轮与额外分页八轮的上界不变。普通额度耗尽后，只允许上一真实 Observation 的同工具、同来源坐标与精确 next_offset；章节 ref、会话 run_id/run_sequence、档案 facet/ref 均不可更换，目录转详情也是新读取而非续页。读取完成、无 next_offset 或坐标不匹配都不授予续读资格。复用各现役 query parser 与 ExplorationService 的同源坐标比较，由 ExplorationPolicy 统一裁决当前额度与续读资格；模型提示只是说明，不承担约束执行。
- **Base 与关联引用继续分立。** 只有确实供应的材料进入 base_refs；目标、目录或来源身份不等于完整内容已读。专业 writer/reviewer 的必要完整基线仍由其现有输入 owner 按具体目标提供，不因判断底座收敛被全局删减。新故事讨论不通过关键词、fixture 标记或预算特判取得另一套供给策略。

验证必须先给独立正反例：无探索的新故事判断不含作品长材料与历史预览；作者原文和未完义务保真；必要对象经实际只读观察进入后继请求，来源与版本闭合；隐藏合法 ref、过期指纹、跨作品 ref 和缺页不能冒充已读。真实三轮低压及 10/20 轮整理继续使用原冻结输入/阈值；补充真实按需探索→观察回流→writer used refs/角色精确对象的证明。具体任务状态与存在性审核只在 B87 §14 记录。

### 5.2.3 R05 现役材料责任细化（2026-11-18，实施前）

本节按愿景 §2.4 复核当前消费者，替代尚未完成的 `chapter_counts` 初稿派生；不回写旧 Canonical，不改变 R03/R04 原始证据或采纳生命周期。

- **最小统计复用当前阅读事实。** `WorkspaceContext` 在现有同次读取中保留 `ReadingProjectionRepo.toc/1` 已产生的 `audit`，经 `DialogueContext.reading_audit`（`work_id/audit`，无持久化）传递。计字、当前 accepted 草稿及阅读可见章节的选择仍只有 `ProseAudit/ReadingProjectionRepo` 一个责任方。判断只将完整可信 audit 投影为 `facts.work.chapter_statistics` 的 `structure_chapter_count/written_chapter_count/empty_chapter_count/total_word_count`；有正文数是该 audit 的章数减空章数，不再按 `has_prose` 逐项重造计数规则。来源未读、失败、partial、stale 或无真实 audit 时不供应总量；成功空作品可供应零。`coverage.chapter_statistics` 表达实际供应，目录和正文仍为 not_read，聚合只绑定 work ref。身份/作品隔离由现真实读取与唯一边界保证，下游不为人工坏夹具层层添加重复防御。
- **作者目标贯通专业任务。** 复用 run.goal 与现 `author_goal_text/AuthoringTask.author_goal`，机械动作描述不能覆盖已绑定目标；planning mission 和 outline Writer 使用既有通用大纲范围。既有章条目与 VS-00J 卷蓝图行是同一 plot_outline 的合法输出形状，模型按作者目标选择，不由应用关键词选路，不强制卷级请求附带新章。作者原文继续只由独立 author 消息供应，应用目标和执行简述保留各自来源。
- **材料元数据不等于内容。** `AuthoringTask.materials` 当前跨 adapter 只保留 ref/version/coverage 元数据；专业修订的有序完整 baseline 在真实请求中只有一份时必须保留。仅在独立请求证明同一原文字节确实重复后，退役对应生产者的副本；不能因为上游 map 曾包含 body 就删除唯一实际正文。整章、目标段、质量评审的必要 accepted 基线及 tentative 边界不因成本优化缩小。
- **完整修订基线按实际供应选择载体。** 独立真实路径审查确认：同轮完整原生读页已经进入 Writer 请求时，PendingArtifactWorkflow 再拼一份 fresh 全章会重复供给。将 ChapterRevisionScope 已有且唯一的章页解析、source hash、版本合并与连续范围规则迁入纯 Application 的 ChapterReadEvidence；ChapterRevisionScope 只负责结构化范围、真实观察和基线的机械复核，PendingArtifactWorkflow 负责材料载体选择和 Task 元数据。证据 owner 的 bind_target_segments 只接受当前作者输入之后的真实原生页；supplied_baseline? 消费 RequestIR.visible_observations，核对同章、fresh accepted 全版本集合、全文 hash、完整字符/UTF-8 字节范围及逐页真实正文字节。两者共享页算法但不共享观察时点，不能把旧可见正文误当本轮模型选段依据。完整供应已成立时，修订请求不再注入全章副本；材料元数据指向实际观察，保留本轮修改范围与 expected_base_versions，原生叶不额外升为 Base，应用叶保持原 provenance。证明不足、缺页、旧版、错章、隐藏页或仅元数据时仍完整供应 fresh 基线。首页的计划/摘要预览 omissions 不否定已经核实的正文范围，也不因此升级设计材料。材料复用不改变当前作者授权，完整内部基线与最终采纳校验保留；不删当前回合历史、不改 Compaction 保护、不做拼完正文后的字符串去重。实际请求新增专业 Scope 不产生 checkpoint，已核可见叶继续经三 wire 投影；该性质由真实 DPS→读页→PWF→Real 回归验证。
- **本次可见材料只有一个派生规则。** 将判断器现有的 `Compaction.project → observation_payloads` 组合收归已有 `RequestIR.visible_observations/1`，由判断、专业消费及测试读取器共同调用。普通 source refs、目标身份、raw snapshot 与已覆盖隐藏的观察不自动取得 Base/Observation 信用；partial 只证明实际供应部分。专业计划中真实只读执行必须先完成合法材料回流，才可删除旧摘要供给；不伪造 assistant tool_call、不对已闭合 call_id 追加第二工具结果、不以任务完成自述代替真实执行。
- **计划校验与实际读取分别留真。** `agent_plan_draft` 的校验结果按原时机闭合；计划可交错读取、使命推理与创作，不能把计划校验拖延为整个计划完成。专业读取在真实 `ExplorationStep` 执行返回处，由已有 `AuthoringSession` 追加 application Scope：`operation.role=planned_exploration`，带既有 plan/step/observation 身份；只在已有校验结果确实关联该 plan 时登记真实 plan_call_id。`facts.exploration_result` 保存本次实际读取的规范化叶，不复制整个快照、不伪造 call_id 或模型调用。规范化只由现 `ExplorationService.request_observation/1` 负责，单次原生探索、原生计划聚合和专业已执行读取共用。后者为应用真实供应材料，source refs 由该叶实际内容产生，归 Base；原生 tool_result 仍归 Observation。`RequestIR.visible_observations/1` 对两种现役来源采用同一 Compaction 可见性，显式保留 application provenance，非该操作的普通 Scope 不变成读取证据。专业任务/mission/trace 消费这个实际请求视图后退役旧 summary 副本及 raw-ref 授信；partial、版本与 omissions 保持原样。
- **专业材料资格在唯一应用投影定义。** `AuthoringTaskBuilder.request_read_materials/1` 只消费本次 RequestIR 的可见叶，依真实内容、status、coverage、omissions 和 next_offset 产生当前专业材料元数据；无正文/事实的 ref-only 记录不授内容信用，status=ok 不等于整篇完整。Builder、使命引用与 Writer evidence 共同使用该投影，后两者不再读取 raw snapshot；来源 provenance 仅在本次组装使用，不新增持久实体。Writer 证据以真实末次请求、追加 Writer 结果之前为边界，应用实读归 Base，原生实读归 Observation，任务的任意 source_refs 不自动进入二者。
- **候选全文通过现会话探索读取。** `session_adoptions` 继续使用可信 work/session 和 `WorkSessionRepo.adoption_state/2`，目录只供实际定位/状态/来源元数据；同工具的 `{artifact_ref, offset}` 详情复用 `TurnInteractionService.artifact_body/1`，按 6000 grapheme 分页。列表 offset 表示条目，详情 offset 表示正文字符，各自明示 coverage、omissions、next_offset。只有同列表查询或同 artifact_ref 的精确下一页可用续读额度，目录转详情、换对象、跳页均是新读取；读取不改变候选/采纳状态，不新增工具、仓库或平行读取器。
- **记忆身份来自真实条目。** 现召回读口透传 MemoryItem 的真实 id/version 及实际供应范围，退役 `memory:<命中数>`。保留 HTTP 消费者需要的现 text/count 派生，不把其摘要当完整正文；搜索页明确为有界召回而非全部记忆，详情通过现工具 `{memory_ref, offset}` 取得全文，沿用现同作品、可召回状态与有效期选择，不使用直接 get 绕过资格。长正文分页保留真实版本，不能把不同版本的页声称为同一完整材料；无可核版本不伪造整数。档案中已存在的风格规则/作者偏好沿原通用分页供给，实际页只登记真正供应的条目来源与版本。
- **章节设计材料也必须可取足。** 既有 `archive_read` 的 chapters facet 使用精确 chapter ref 读取完整章计划、关联的当前卷蓝图及当前 accepted 章摘要，并复用现 6000 字分页；章、摘要使用真实 row ref，无整数版本时明确缺失。现 `chapter_read` 正文分页和页内版本保持，首页附带的计划/摘要预览明确 partial/省略及完整读取入口，预览不授予全文已读资格。完整渲染归已有档案 owner，不能另复制一套计划 renderer。

上述读取职责在现 owner 内收敛：记忆 selector 与有界条目 DTO 由 `MemoryManagementService.recall_selector/1、recall_preview/1` 单独定义，Exploration 的真实读取与续页检查共用；章节精确设计来源由已有 `ReadingProjectionService.chapter_design/2` 选择，首页计划预览及仅供其使用的格式投影归同 owner 的 `chapter_plan_preview/2`，档案只负责完整渲染/分页。迁移删除旧实现，不建平行 Reader。canonical 观察块、叶恢复与请求可见性属于同一纯契约，收敛到 `RequestIR.Observation`，RequestIR 保留既有公共 API 委托；它与 domain AgentObservation、应用结果组装和 Provider wire 投影职责分开，无持久实体或副本。

**目标来源与单次计划构造。** 作者输入成为 run.goal 的生产者必须同时保留现已受理输入的 `source_ref`：初次创建复用 turn_id，转向/回答复用 TurnInteractionService.input_ref 的真实版本身份；AgentRun normalize/恢复透传这一来源。内部 goal.text 继续用于授权与目标判断，原文字节仍只来自真实 author_input/canonical author 消息。Scope 的既有 goal 来源投影在有明确 source_ref 时只给 source_input_ref/version，不再复印目标正文；独立应用解释没有这项原文绑定，保留自己的文本。AuthoringTask 以最小非持久 `goal_source_ref` 传递这一绑定，内部 to_map/from_map 保留语义，专业请求经唯一 to_request_map 投影：作者原话从专门消息供应，已绑定目标为来源引用，独立解释目标保留文本。创作 brief、使命和继续判断从其真实目标 owner 消费引用，不把 goal.text 再拼成另一份 brief；不通过文本相等、关键词或 fixture 标记决定去重。

混合 JudgmentPlan 的实际读步复用同一 application 读叶桥接后，退役其旧 observation summary 拼接。内联计划只在 JudgmentProtocol 的既有校验边界构造一次 AgentPlan：现内部 plan_result 接收已验证 plan/meta，路由和执行直接消费该同一结果，删除 selected_judgment_plan 的第二次构造；真实 agent_plan_draft call 的校验结果绑定该 plan_ref/version，judgment_decision 的结果仍由实际完成时机闭合。没有实际 plan_run 时不得伪造已校验计划，也不得让未校验 raw 结果进入执行；原模型响应继续由 canonical/provider_result 原件保存。

目标来源迁移同时覆盖现验收消费者：TestProviderPrompt的指定作者读取只按唯一明确source_ref匹配canonical author消息，不能取最近消息猜目标；SliceVerify计划与续行共用该目标reader。continuation旧goal_text经全部生产及验收调用者查全后，只是run.goal副本，连同fallback退役；无真实独立说明消费者，不建立替代guidance字段。已有偏差/观察等真实应用说明仍按各自字段保留，不因去副本而丢弃。

**外部验收职责。** R05 复用既有原生 AX 单次输入路径及章数、质量、角色、目标段、整章、风格六类场景；原冻结输入/种子/预算与独立判据见 B87 §16.3。验收聚焦最小可信底座、真实自主取证、可见观察回流、专业必要材料与首个产品消费者。愿景 §2.4 的真实求证和证据相容要求保留，未配置专用 Packet 的作品要素应能沿同一链消费；确定性替身不能代签模型自主取材。正确充分供给后的格式服从、一般推理或文学表现按 R08/R18/R19 如实维护，不能自动升级为 R05 的通用否决项；材料失真、未读/partial/stale 冒充完整当前基线、错误来源或范围仍属应用缺陷。

场景合法性只由现 capture owner 显式登记，batch/prepare/readConfig 共用；不能各自复制白名单。现 request-facts/live-refs 只从真实当前请求抽取可见材料，partial 与应用来源保持，累计 ref 不授信；现 G2 页/版本/used-ref 算法复用。四新场景的纯判据组合仍归 authoring_r05_evidence，现 live/native evidence 是真实消费者，不新建 harness、reader、成本账本或产品 hook。请求构造字节与实模 usage 分别报告；无配对 before 实模不宣称 Token、时延、缓存或文学收益，总 JSON 字节下降不是本批额外门槛。实际冗余仍按现有生产/消费责任修复；原应用、页面、模型结果和失败证据分别保留，不因重新归属而重签。

普通两轮及额外八轮分页上界保持；续页资格只来自真实上一页的同来源精确坐标。所有新增纯 DTO 字段和查询形状的存在性、首消费者、独立反例及退役对象见 B87 §16.2；本节不宣称实现或验收完成。

### 5.3 事实/意图/观察分界

| 类别 | 谁说/谁证实 | 可进入后续模型请求的方式 |
|---|---|---|
| 当前作品事实 | persistence/current snapshot，应用读端口 | `base_refs` + 版本/权限/覆盖；仅真实已读字段 |
| 作者指令/目标 | 当前原话或明确被绑定的作者历史消息 | 独立 user 消息/author_message_ref；目标解释不冒充客观事实 |
| Agent 推断 | 模型当前讨论/工具决策 | assistant/工具参数，尚未验收；不得写入 Base 作为已经确认的类别 |
| 真实 Observation | 受控工具已执行且有 `call_id` | tool-result + source_refs、版本、coverage/omissions；未执行不伪造 |
| 系统动作与采纳 | gate/transaction receipt 与 canon 版本 | 系统确认后的回执；模型曾提建议 ≠ 真执行 |
| 作者素材/风格（未来 Issue #3） | 作者资产系统，非当前 canon | 按需探索，`inspiration_only` 与 `canon` 不混同；本次不实现资产系统 |

实例：`visible_in_reading=true` 若实际查得是当前事实；“应该只在档案显示”是作者要求；“目录缺少删除章位能力”只有真实目录/校验支持时才能说已证实。卷纲/章节误分类是独立领域缺陷，不得靠 prompt 移花接木。

**引用指针不是当前基线**：单独 `ref` 仅定位对象，不证明其详情已读、覆盖完整、版本有效，更不能自动升格为当前已确认的作品事实。只有当前作品中真实读取、来源/版本/coverage 合法的 Base 或 Observation 才能支撑对应的「当前基线」断言。作者反馈的「该 ref 的详情作为当前基线」需区分技术占位指代与事实权威越级两种风险（原完整样本是请求先读，不等于已发生后者）；前者须在模型输入/作者可见输出边界分离，后者须由来源与版本证据约束。未读、partial、stale、跨作品时显式承认缺口或继续真实求证，不能由 prompt 承诺、模型摘要或 UI 替换代替系统校验；不能因词面出现 `ref`/`基线` 就拦截作者主动讨论技术细节。

### 5.4 Scope 去冗余与显式压缩（重要的 Frozen 冲突边界）

**R03 修订入口（2026-11-15）**：本节目标保持；精确选择器、纯讨论语义摘要、原文回查、义务保护及失败恢复的现行工程裁决见 VS-00L §16.2.1，完整独立判据见 B87 §14。此前 R00 的不能覆盖结论保留为历史，不冒充此前已批准；新契约不等于已实现。

当前 B81 已把会话 Canonical → Request IR 接通，且能对**闭合工具交换**做 checkpoint，但纯讨论中旧完整 Scope 可能随历史重复进入 Provider 请求。

**目标行为**：
1. Canonical 仍严格追加、跨 turn 可回查，作者原文字节不变；
2. “当前有效 Scope”只能有一份权威值，旧 Scope 是历史事实但不再被呈现为**同样当前有效**的状态；
3. 若 Provider 投影不携带旧 Scope 的完整文本，必须有**先提交、可验证的显式 checkpoint/覆盖契约**（包括被替代 scope 的身份/版本/来源、仍生效的历史义务与摘要、省略说明）；没有合法覆盖则不能静默丢；
4. 压缩不能捏造旧作者/工具话语、不能覆盖未闭合或其他 run 当前责任；错版本/错作品/交错恢复 fail-closed；
5. 先根据 R01 数据确定是“重复文本导致增长”还是“合法历史必须保留”，不能盲删历史；
6. 各 Provider 投影应当等价消费**同一覆盖语义**；缓存前缀仍按 VS-00I 验证，cached_tokens 属于 input_tokens 子集。

**协议注意**：目前 VS-00L 对 `covers.call_ids` 与 tool exchange 有严格约束，ADR-0035 明确会话连续性；若需要覆盖纯 user/assistant 回合或被替代 Scope，R00 必须先给出**现有 Compaction 可否合法承载的证明**。不能合法承载则先按真实需求提交 VS-00L/ADR 补充决策，选定唯一覆盖结构并迁移现有消费者，**不保留旧兼容分支**。不能把“只保留最新 Scope”作为绕过契约的快捷优化。



**R04 请求时点与版本顺序澄清（2026-11-18，实施前）**：Scope revision 不是跨 run 的全局排序键，新 run 的 revision 1 可以晚于旧 run 的 revision 9；三 wire 的共同展示须明确按真实消息顺序承接更新，而不是取数值最大。历史条目不随下一请求重标“当前/过时”。裸 compose/Replay 保留真实全序，不保证末项属于恢复的旧 run，也不因此调模型。实际 Judgment 请求须先恰一次组装已有会话历史，再核当前真实材料和运行归属，必要时沿现 append_scope_update 追加当前 run 范围；不能先比较局部旧段后把外 run Scope 拼到末尾。已是会话视图的主流程不重复 compose，不剥离未消费历史。writer/evaluator/plan/mission 已有无条件追加当前操作 Scope 的 owner 继续复用。版本数字保留既有生成规则，不另建全局计数或持久 current 标记；末范围相同但归属外 run 仍不得代替当前运行声明。原序/字节、合法 checkpoint、真实来源与执行门禁保持不变。

## 6. 响应链、工具协议与作者可见原文

```text
Provider raw response（原始 content / tool_calls / arguments / call_id / usage）
  -> wire 解码与 schema 检查（失败按原 call_id 纠错；不伪造）
  -> effect / target ref / work scope / version / budget 校验
  -> 系统权限与风险裁决（非模型自报）
  -> Orchestrator 逐步 gate / 作者确认 / 可撤销委托
  -> ToolResult、真实采纳回执、版本改变或明确无写入
  -> 同一 Canonical 追加工具结果/校验
  -> 作者可见 narration（模型原文字节） + status_message（系统事实）
```

**必须区别**：
- `model_suggested`：模型只是提出工具；
- `schema_validated`：字段格式合法；
- `effect_authorized`：系统确认该对象/动作处于授权范围；
- `execution_completed`：真实工具操作已成功；
- `candidate_created`：生成了待采纳作品；
- `canon_adopted`：经过合法作者决定或事先有效委托、真正提交并产生回执。
这些属于不同事实来源和时间，不能用一个 `status=success` 代替。

**内部标识与作者可见面（B86 缺口整体并入 B87 R06，当前 R05 交付的必要依赖见 B87 §16.19/16.23）**：`chapter:<uuid>` 等仅在结构化 ref 字段中出现，普通叙事和摘要使用作者能理解的名称；工具 narrative 字段不可夹带内部标识。遇违规**拒绝模型内容并回流有界纠错**，不把展示过滤后的文本伪装为模型原话。模型作者可见字节必须绑定实际 Provider 输出（`AgentNarrativeSource`、I1/N-NARR）；系统“本轮没有写入”等事实复用 ADR-0024 现有 `ui_cards.result_card` 独立通告，明确系统来源并随同轮结果持久恢复，不覆盖模型助手正文、不新增平行状态字段。模型作者叙述须先通过接收校验，再发布到作者面；未经接受的流式片段不提前展示，原 Provider 证据仍保留。模型自然语言校验消费同一规则源的机器协议字段/引用规则，不能把固定 UI 文案用语约束泛化为对合法姓名和小说分析词语的封禁。ask_author 的唯一正文是原生 question，非空 content 作为第二正文须拒绝纠错；选项标签独立校验且原字节保留。接受事件与最终 reply_record 透传同一个 author_narrative_source，按完整来源身份确定唯一展示归属，机械步骤摘要不得借用模型来源。不能把 `target_issue`、`capability_status` 先验预测塞给模型替其判断。

**R06 能力称谓供给（2026-11-24，实施前裁决）**：现 AuthoringTaskPolicy.operation_data 继续从原能力 registry / 既有 profile 形成机器 name、效果及读写域等定义；只对 Common.AuthorVisible.Display 已在 capability 域明确登记的 name，旁列同源 display_name，未登记项不补泛称、不删除合法能力。display_names.json 及其既有生成物仍是唯一称谓来源，不新建词典、别名解析或能力实体。该显示元数据仅进入新 transcript 的 application_base；实际能力身份、当前 Scope 许可、执行校验与全部 refs 继续使用原机器值，显示名不授予执行资格，也不回填或重写已有 transcript。规则文案、工具 schema、唯一作者正文字段、原字节接收和两次交换预算保持；本次纯材料变化不为改变 policy hash 而升级静态规则版本，完整请求身份以实际 IR / wire 与冻结源码核定。现效果说明已经是自然语言，因此缺少显示名只是待验证的有限原因；须先核新 WR02 首次真实请求收到该字段，再独立审读作者说明，不能以字段存在或单测通过证明 R06 语言问题已解决。

**使命接收（B87 R06，2026-11-21，实施前）**：chapter_mission/planning_mission 的唯一作者说明是原工具参数 author_reasoning；原响应 content 只能为 nil/空串，非空（含仅空白）作为第二正文拒绝，不作优先选择或失败回退。现 ChapterMissionService 先核既有闭合工具 schema、同次原始工具调用及所有作者可见原字段（author_reasoning、statement、must_advance[].text、must_avoid[].text）的资格，再绑定依据并返回接受结果；两个现役 flow 仅对该成功结果落暂定、发布 mission_derived。失败沿现 NativeToolExchange 原 call_id 和最多两次调用的纠错路径，原 Provider 响应及失败回执保留，末次失败不生成成功使命；技术失败继续沿 VS-00E I-M4 诚实降级，不误宣称整轮零候选。ChapterMission 的构造、持久恢复与作者改写只用 trim 判空，模型原文字段及已有依据标签保留字节，身份/状态规范化职责不扩面。废除旧同名 envelope 解包及双正文兼容，不新增循环、状态或领域对 Common 的依赖。

**R06 使命材料同源绑定（2026-11-24，实施前裁决）**：本次 name-supply 实模已证明三个实际读取 ref 合法、但持久使命缺 basis_label。ChapterMissionService 改用 NativeToolExchange 已有三参接收接口，以同次 prepare 后真正发送的 actual_request 为准；初始使命材料只按实际供应资格消费，读取材料只来自该请求可见、可用的 Observation，不能从累计目录、隐藏历史、未来请求或最新 DB 补依据。沿现 AuthoringTaskBuilder.request_read_materials 与 ChapterMissionInputs 的材料事实派生具体作者可读依据，ref 与材料文本/明确对象名称来自同一条实际记录；basis_label 是材料依据，不是 capability display_name、ref 别名或通用占位。保留版本、页段、coverage 与 omissions 的差异，同 ref 多份材料不得后写覆盖或借名称升级为完整读取；不把观察全文重新投喂进 mission_inputs，也不复制一套材料注册表。

ChapterMission.bind 的独立 known_refs 与可缺省 label_fun 接口退役，同批迁移唯一生产调用者和现测试；绑定消费现有材料条目，未知引用继续沿 I-M1 dropped，已获资格且被实际引用却缺可追溯依据的条目明确失败，不产生残缺 model 使命。from_author 的作者自主条目保持原独立路径。工具 schema、唯一作者正文、原字节与有界模型纠错保持；解析成功后才在 application 完成材料绑定，成功才 complete/发布，装配/绑定失败复用现 AuthoringSession 的 failed 原调用闭合与 retryable=false，不扩 NativeToolExchange、不新增模型回合。实际 Writer 消费必须保留依据的覆盖限定，不能把 long label 尾部限定截掉；读侧证据同批从同次 canonical/实际请求前缀核定，不能让产品为迎合旧 reader 重复供应材料。该修复不把更早判断中的“完整计划”误述当作已修复，R08/R17/R18 原归属保持。

本次同源绑定的存在性补核：AgentObservationAssembler 生产观察，RequestIR.Scope/Observation 定义请求与可见性，均不等价于 application 的已读材料投影；将 AuthoringTaskBuilder 原 request_read_materials 整段迁入纯 AuthoringReadMaterials.from_request/1，使命绑定与原任务材料组装两个现消费者直接迁移，旧入口与专属副本退役。既有 basis_label 概念可作为本次中间材料依据元数据，进入闭合 AuthoringTask 材料投影前移除，不成为新的模型返回字段；版本、页段与遗漏保持原事实，不增同义状态。ChapterMission 的 Writer 依据消费退役整体 short 截断，源头只使用具体材料依据/明确名称而不复制整章正文，避免长名后覆盖限定丢失。

既有 WorkArchive 多来源详情/档案页不一定有 facts 名称，不能因此把已实际供应的合法材料全部降权。此类读取仅按 coverage.sources 中唯一精配 ref 的既有 offset/returned_graphemes/total_graphemes，构成该条目实际原文字符范围的依据，继续保留版本与遗漏限定；与章正文页段同理，不拆猜整体 summary、不按 ref 造标题、不广播一份总说明，也不增加 producer 字段。

同一 WorkArchive 的单来源 facet 页（如现 stats）已有 coverage.summary 的 typed 字符范围；明确 facts 名称仍优先，否则只有当前叶实际 source_refs 唯一且精配该 ref 才能消费该范围，复用同一合法范围校验。不能回退复制整页 summary 到各使命 basis，使后续 Writer 重复收到原材料；多来源不能借用整页范围，缺失或无效范围明确缺依据。原 B39 三 wire 的材料只供一次断言保持，不因新标签改小验收范围。

AuthoringTask.materials 现闭合合同要求 ref 唯一，不能把同 ref 的多份读叶直接重复写入该列表。AuthoringReadMaterials 保留各实际来源供使命绑定；ATB 的现任务消费者按 ref 保序汇合元数据，每份实际覆盖、遗漏与已知版本在 omission_note 中保留，只有全部版本一致才保留单一 version，只有所有来源均明确完整且版本无冲突才可标 complete?=true。未知或冲突不得选首项、末项或冒称最新；实际材料正文仍留原请求，不复制 basis_label 全文进任务元数据，不改变唯一 ref 校验门。

**探索输入的双面身份（B87 R06）**：在现 ExplorationService/WorkArchiveService/ChapterListBudget 责任内，将候选章与目录条目保留在已有结构事实面，引用、版本和续页控制沿已有 source_refs/versions/coverage/next_offset 传递；普通 summary/omissions 只表达名称、内容、覆盖和不足，不再嵌 ref 索引或 JSON 查询。正文内容仍完整按原页预算供应，预算按实际投影计入，不把成本藏入另一字段。B24 §1.1 的旧文本索引/footer 由此替代，唯一寻址、同章续页及跨作品拒绝不变。旧 Provider/AX 原件不改写，TurnResult/UI 不设过滤器。

**R06 可证明范围**：共同 Text 接收门负责机器协议与身份形状，AgentNarrativeSource 负责原字节来源；两者均不是一般自然语言事实判官。原 role-03 完整原句为“修订主档案字段前必须读取该 ref 的详情作为当前基线，目录信息不足以支撑修改”，当次 action=explore，证明技术化指代，未证明未读却声称已核实。该路由按现 explore 闭合契约不产生作者正文；精确原句作为该接收边界反例，另核真实材料对未读/partial/stale/跨作品声明的约束。普通创作说明与作者主动技术讨论以独立正反例和有限真实场景审读核验，保持原文；不添加 ref/基线/seq 等词黑名单、隐藏模型审查回合或万能语义门，也不将来源有效和结构通过写成普适语境正确。R08 一般意图判断、R17 system 生命周期及 R18/R19 文学/全局评估保持原批次责任。

**现役判断与计划的单一正文（B87 §16.23/16.27 裁决）**：普通 reply 仅消费原生 content；ask_author 仅消费 question；judgment_decision.explore 仅提交结构化读取请求，不产生作者正文，作者字段按闭合分支拒绝；其余判断工具、continuation_decision 与 agent_plan_draft/agent_plan_revision 仅消费已有 author_reasoning。judgment_decision/continuation_decision 的 reason 字段退役，工具响应另带非空 content 须拒绝并闭合原调用；不能优先选取一份、清洗或补写另一份。作者说明不得兼任执行效果的关键词开关，同一结构化只读动作不因“不会保存”等措辞改变资格。计划选择、结构及说明由现 agent_plan_draft 单调用承担，judgment_decision 的 plan 动作与强制双工具组合退役；现 run.goal、计划版本/已完成前缀、inline_plan_meta 与 plan_drafted/plan_revised 的实际职责保留，不增加无消费者的 plan dialogue_goal 副本。合法计划即使只读也保留整体作者说明，不能按执行效果隐藏已接受原话；直接读取保留原始调用校验、观察和系统进度，不制造作者来源或reply_record。Provider/IR 原始记录仍完整保真，历史证据不改写；规则不承诺一般自然语言语境的机械正确，实际作者效果仍需独立验证。

**判断 action 的职责边界（B87 §16.25/16.26/16.27 裁决）**：explore 只表达实际读取请求，不要求且不接受 dialogue_goal 或 author_reasoning 等作者正文字段；执行动作仍以非空 dialogue_goal 服务真实创作目标与范围，注册和能力缺口工具的同名字段按原职责保留。JudgmentDecisionToolContract 是完整 action 分支、字段说明、示例与动作纠错的唯一 owner；JudgmentToolContract 组合工具目录并持有通用闭合接收及字段错误详情，按原始 action 消费同一分支，不相互回调；保持根 object wire 形状，公共required仅action，execute自身仍要求非空author_reasoning/goal/capability；完整分支接收拒绝跨分支字段及未知 action，不能从平面可选字段推断另一分支被接受。原始非法参数保留并回流原有有界纠错，不清洗后接受；explore 的规范化结果不复制无消费者目标，也不创建narrative/narrative_source/reply_record；完整Provider参数和来源验证、真实计数与观察闭合保持。作者说明服务作品、实际材料及创作目的，真实歧义只有影响作者判断时才解释；不得要求逐步复述内部观察或绑定过程。此约束不新增一般词禁用或模型原文改写，真实语言效果须经独立模型场景审读。 Responses 在现投影处显式发送 strict:false，避免供应商默认严格化将平面可选字段自动升为必填；应用完整分支校验保留，其他 wire 不新增无需求的严格配置。

**执行目标字段的值域（B87 R08 §19.17，2026-11-23，实施前裁决）**：pending_artifact_ref、adopted_content_ref、character_ref 在固定公开 wire 与完整 execute 分支中均可省略；出现时使用已有非空字符串契约，不接受 null、空串、仅空白或非字符串。真实目标存在性、能力归属、完整观察、版本与授权仍由现 JudgmentProtocol / PendingArtifactWorkflow / CharacterProfile 接收和执行边界核验；省略不等于自动选定目标，内部 normalized map 的 nil 不属于原始 wire。字段归属及非空要求继续由 JudgmentDecisionToolContract 的同一字段说明派生，execute 的 schema 纠错也复用该说明，避免提前拒绝后丢失“不适用字段须省略”的指引。adopted 修订专属指导仅消费原参数中的真实 capability；未知或多余字段不能触发另一能力的目标指导。公开 minLength:1 由现本地字符串判空规则补足仅空白拒绝，不声称供应商原生校验等价；非空 ref 原字节保留。非法原始参数逐字保留，沿原调用闭合且最多两次实际交换；不得剥除 null 后接受、trim 后重绑对象、扩预算或新增纠错环。三种 Provider 投影沿现入口使用同一静态 schema，Responses 保留 strict:false；升级改变工具字节和指纹，只证明新版本内稳定，不复用旧源码的验收绑定。该收束修正已证明无成功消费者的空引用表示，不证明能力/对象语义已被模型正确选择，也不替代 R08 的真实页面验收。

**只读取材的共同预算（B87 §16.24 回归裁决）**：单个计划包装不改变读取资格。直接explore与只读计划内联共用同一纯资格政策。存在性审计确认AgentRunBudget只管已起草计划的执行成本与作者上限，ChapterListBudget只管目录投影，均不能承载读取资格；将已从DialoguePlanningService收拢的2次普通读取、最多8次真实续读、开放工具和计划只读分类从执行服务分离到单一ExplorationPolicy，原位置实现退役。ExplorationService继续拥有真实读口、稳定目录及同源query/续页坐标比较，Policy仅消费其纯接口而不执行读取；Scope预算形状保持，不新增配额状态、循环或登记表。JudgmentProtocol在接受前按整批实际读取步骤校验，DialoguePlanningService执行边界再以当时真实observations重算并调用同一门禁。context_assemble/character_roster已准备的机械步骤不消耗读取额度；其余实际读取不得超过当前剩余额度，当前只允许续读时最多提出一项，且须对应上一真实页的next_offset。尚未执行步骤的预期分页不能提前授予额外续读额度；不通过的计划按原call_id失败闭合并有界纠错，不部分执行、不隐式重置预算。包含创作动作的计划继续走现JudgmentPlan运行时与效果门禁；只读取材完成后回到判断，不为适配旧测试伪造创作或重规划。

**现役创作返回的接收资格（B87 §16.23 裁决）**：模型返回 used_context_refs 是待验声明；现 CreativeProvider.Real 在同次 NativeToolExchange 接收口，基于 Operation.prepare 后实际发送的 IR，复用 RequestIR 引用资格判据核 used⊆Base∪Observation。坏形状、未读、跨调用和 source-only 作者引用不能被过滤成空声明或升级授信；错误保留原输出与失败回执，进入既有有界纠错，未接受候选不外发。事后 EvidenceUsage/unbound 只是审计，不代替接收门禁；其原生观察集合也须消费同一 RequestIR.usable_observation_refs，包含已登记、实际可见的 content.observation_ref，不能在接收成功后又因只读 source_refs 而将合法观察身份记为 unbound；应用读取仍归 Base，不向任务材料或 Base 补登观察身份。接收时的 Observation 资格须来自该次请求经过现 Compaction 投影后仍实际可见、有效的观察，且引用已登记在同请求中；独立 observation_refs 目录、只含tool/query及空facts的关联元数据、失败聚合下的成功叶、失效/不可用结果和已被覆盖的旧观察均不能授信。沿现 AuthoringTaskBuilder.read_content? 的实际供给判据迁入共同 Observation owner，供接收与事后材料归属共同消费并退役原副本；有真实摘要或事实计数的空读结果仍是观察，不以正文非空替代是否已读。ok/partial/truncated 中实际已供应的部分可作为使用声明来源，原 coverage、omissions 与状态仍须保留，不升级为完整读取；stale/unavailable 不能授信。复用现 RequestIR.Observation 的可见遍历与 RequestIR 的集合资格判据，不把新返回声明的当前可用性检查混进历史记录完整性校验；Base 引用也不因历史存在观察而被错误要求必须使用观察。现 creative item 的 rationale 是给作者的说明，复用 Common.AuthorVisible.Text 的现有结构资格；title/body 的创作职责独立，不施加一般词封禁。应用生成的角色卡工程 rationale 在已有 Presenter.body 完整表达效果时退役，不增补平行说明或来源。共同短语言规范继续由 Common.AuthoringSemantics 统一承载；本轮判断、续行与独立计划调用沿现 system 供应 author_narrative_rules，相关工具字段只说明其独有职责、来源和动作状态，不再复制共同规则。Writer 在既有 IR 上追加 static_block 与独立构造请求的两个入口由 R17 审计迁移，本轮不新增省略规则的渲染接口，也不宣称所有 Writer 请求已单份供给。接收门禁与通用质量标准不变，不新增规则仓库或反向依赖。

**R08 候选纠错的完整反馈（2026-11-24，实施前裁决）**：同一原生候选响应可能同时违反独立约束。现 CreativeProvider.Real 的候选结构/条目接收与 used_context_refs 资格分别消费原响应和本次 actual_request；不能因另一处候选字段缺失而跳过已能独立核实的引用错误，使唯一的两次调用窗口逐轮才暴露一个错误。复用 CreativeProviderResult.errors 列表，按原接收顺序保留主错误，并将本响应已证成的独立错误一次写入同一 call_id 的现 validation detail 与纠错 message。errors 只是现结果列表在既有开放 validation detail 中的同源投影，不成为第二错误真源；没有新错误主模型、工具输入或持久字段、循环、预算或资格门。NativeToolExchange 的原始响应、失败闭合及最多两次实际调用保持。

独立引用检查先要求原 arguments/self_report/used_context_refs 具有既定合法形状；无法解析、错误容器、非数组、混入非字符串或空白等仅报告已证的结构/形状问题，不过滤、补空数组、猜造引用或继续依赖完整候选的应用校验。合法形状的引用只按当次真正供应的 RequestIR 判据检查，作者消息 source ref 不自动成为 Base/Observation。全部既有结构、条目、范围、唯一引用资格和应用校验通过后才交付候选；错误聚合不发布部分成功产物，不改模型原字节或扩大材料授信。该机制只保证反馈完整性，不保证模型一定修对，也不能代签 R08 其余语义场景。

**Base 的实际供应归属（B87 §16.24）**：已有 Operation/AuthoringTranscript 的 base_refs 参数由实际材料 owner 给出，须以同名元数据绑定到真正承载材料的 canonical application_base 或 scope_update 消息，不能只并入累计目录。此绑定定位既有供应事实，不创建新材料实体；IR.refs.base_refs 仍是历史登记索引，当前可用集合由现 RequestIR 对 Compaction 后可见消息的明确绑定与登记集合求交，Real 接收和 TurnExecutionService 审计消费同一投影。普通 source_refs、作者/模型/工具消息、checkpoint及纯职责说明均不能替代 Base 供应；缺少绑定不从历史目录、业务 payload 或关联来源猜回。首次操作的材料属于初始 Scope 时，绑定该 Scope，不能复制到永驻职责 Base；纯文本操作的实际材料可直接绑定其 application_base；带材料绑定的消息不能没有内容块，application_base 还须只包含实际会投影的非空白文本，不能以被投影丢弃的结构块冒充材料。计划、使命、专业写作及当前判断均复用现共同构造入口，不新增各类业务 payload 的 Base 解析器。应用 planned_exploration 的供应仍须共享现 Observation 状态/实际内容资格，失效、不可用或仅关联元数据不得因登记了消息绑定而升级。相同 ref 只要仍由另一条可见实际材料消息供应就保留；所有供应消息被覆盖后即不可再声明。当前返回声明通过现 RequestIR.validate_used_refs 复用既有集合判据，不能把完整历史IR的登记表替换成可见子集后再做历史校验。历史原文、压缩选择器和已有登记不改写，持久消息完整保存该事实，不加历史兼容推断。

**外部请求证明与作者身份（B87 §16.24）**：外部 reader 复用同次 ProviderCall/ProviderRun 的完整 canonical 可见前缀与实际请求逐条配对，角色、来源、顺序、工具展开、Scope 完整 JSON 与 checkpoint 选择/覆盖均有对应；不能用应用消息子序列、文字前缀、全文相同或出现标记代替完整证明。会话历史中的初始 Base 只取该 ProviderRun 所属 agent_run 的 Base 并供应一次，其余消息原序保留，原始行和覆盖证据不改写。Base 的明确绑定与同次登记集合只有在上述配对成立后才授信；作者可以完整引用应用材料，不因同文碰撞失去真实 author 身份。可选首条 system envelope 不授 Base，也不能据此声称其内容已全部逐字核实；未知块或不支持的混合 checkpoint 形状明确失败。成本 reader 与 R05 验收共用这一作者定位，已核定的本轮 user index 优先分类为 CurrentAuthor，计数/occurrences/Scope 统计保持同一归属，实际请求原文与总字节不变。此规则不替尚未具有完整 canonical 证明的其他历史批次补身份或签通过。

**交换预算与实际消耗**：沿VS-00L §16.7保留两种已有语义：provider_call_budget为本次操作允许的上限，execution_counts为session记录的实际消耗。Writer的接收纠错属于同一NativeToolExchange，不在外层再开循环；TurnExecutionService的trace预算须消费该既有交换owner返回的有效上限，不能仅因存在Provider回调就写成1，也不能把实际重试次数回填预算。一次成功与两次纠错可有相同允许上限、不同真实消耗；原始调用身份各自保留。运行流程统一通过现AuthoringSession的实际计数投影消费trace_summary.execution_counts，不再从trace预算求和或按工具名猜成1；五份预算求和副本、角色设计硬编码与确认流程的局部getter收敛到该唯一投影。缺失实际消耗不以预算补造，AgentRunServer仍按实际步增量与真实Provider事件下界累计，不改运行累计owner。

**引用与错误**： `alternative_operation_refs` 必须为本轮现能力、实际开放探索或当前 profile 判断工具中的真实操作 ID，描述去 `author_reasoning`；`used_refs ⊆ base_refs ∪ observation_refs`；不允许跨作品伪引用、未查实空列表、无 call_id 的假 Observation、tool 伪 XML、同一调用仅局部闭合。不合法必须拒绝/明确失败与必要可恢复状态，不能吞掉错误或绕过门禁。

### 6.1 输出通道与工具结果的硬约束

- **作者可见通道唯一（现役）**：复用 `submit_tentative_artifact`，作品正文来自原 `items[].body`，作者创作说明来自原 `rationale`，引用声明来自 `self_report.used_context_refs`；不新建 `write_candidate`，也不把候选包的 `change_reason/coverage_note` 再增为同义作者字段。工具调用另带非空 content 按现接收合同拒绝并回流原调用有界纠错，不选择、清洗或拼接两份正文。区间替换与作者编辑的现役字段和验收边界见 §6.2；既有观察 coverage_note 的材料说明职责不变。
- **工具结果 envelope**：所有工具结果必须为 `{ok, data, error_code, message, retryable, observation_ref, budget_after}`；失败不得伪装成成功，`retryable` 必须真实；应用校验/执行/采纳事实不得合并为一个 `success`。
- **流式一致性**：本项目 HTTP 请求 `stream: true` 时，wire 证据必须来自实际 SSE，不能以应用重组 JSON 冒充原始流。三类 wire 各按自身协议判定：Chat Completions 为 `chat.completion.chunk`/delta、`finish_reason` 与 `[DONE]`（支持且请求 `include_usage` 时另有 usage chunk）；Responses 为带类型的 `response.*` 事件，区分 `response.completed`、`response.incomplete` 和失败；Anthropic 为 `message_start`、内容块增量、`message_delta` 与 `message_stop`。不得要求 Responses/Anthropic 产生 Chat 专属字段或 `[DONE]`；缺用量不能伪填实测 0，流中断不能当正常完成。依据与现役归属见 §12。
- **协议包结构化**：`application_base`/`scope_update` 的 goal/target_refs/permissions/budget/coverage/output_contract 在应用内部是结构化值，wire 只是序列化视图；工具越权、预算耗尽、target 不在 observed_refs 等校验读内部结构，不读模型复述。
- **decision 不塞给模型**：应用解析 `tool_calls` 生成 `decision {type,target_ref,tool_call_id,modification_scope,source_refs,evidence_coverage}`，与 tool result 一起进入下一轮 loop；HTTP 响应不新增自定义顶层字段。

### 6.2 R05 章正文修订的来源区间与候选正文（实施前裁决）

本节依据 B87 §16.34 的真实反例，前向替代 B36 中“一个存储片段对应一个自然段”、空行猜测对应、整章等分块数与半长度门的现役约束；B36 的原实施结果和失败证据保留。复用现 `prose_fragment`、`items`、`payload.scope`、`adoption_effect`、`replace_segments/replace_scope` 和作者动作，不建立 `prose_segment_patch`、另一份 patch 正文、`region_changes`、新工具或第二修订平台。本节只规定当前候选的表达与闭合，不宣称模型已正确理解作者意图或 R05 已通过。

**存在性与两个新字段。** `item_id/title/body/rationale`、章级 `target_segment_ids`、baseline refs/version/hash、action payload 和整体 prose 采纳均已存在，但没有“此 item 正文替换哪些源片段”的现役字段，也没有保留 item 归属的作者编辑输入。本次仅新增以下两个字段位置；同名已存的全局目标字段仍负责授权，不复制正文。

| 字段位置 | 形状与适用范围 | 唯一职责 |
|---|---|---|
| `items[].target_segment_ids` | 仅 `target_segments` 正文修订的每个 item 必填非空 string 数组；其余类型/范围不接受该字段，包括 null | 把该 item 的原始 `body` 绑定到真实基线中的一个连续源区间 |
| `author_action.payload.edited_items` | scoped 正文候选的 `edit_then_accept` 使用 `[{item_id, body}]`；每项只含这两个既有键 | 作者只编辑正文；服务端按原 pending 的唯一 item_id 保留原目标、版本、hash、effect 与来源 |

`body` 是自然正文，允许一个源片段拆成多个自然段，或多个相邻源片段合成一个自然段。多个非连续区间由同一 prose 候选的多个 items 表达并原子采纳；不能跨过未选区间合成 min–max 大范围。现 Judgment 字段说明须明确 ID 对应确定性存储片段，不能视作自然段号；选择前核真实内容/byte 边界并覆盖全部待改片段，未选片段整体保留，选中片段内仍须履行作者要求保留的字句。修订纠错指南复用该字段 description，PWF/Real 的目标段落用语统一为修订片段，不新增选段路由或保证模型一定遵守。prose items 继续属于同一采纳单元，不变成多个可独立采纳的替代方案；角色等现有逐候选类型保持其自身语义。新映射不以空行、字数、item 序号或 segment ID 的数字外观推断。

**原始列表、授权与材料覆盖。** 原始授权 ID 列表及每个 item 的 ID 列表必须先检查 string 形状和重复，再核真实身份；不能先调用旧 `normalize_target_ids/1` 的 `to_string/Enum.uniq`，再把被修复的输入签为合法。连续性只按同次真实基线的源顺序判断；每个区间内部和区间之间均不得重复、重叠、跨章、跨版本或包含未知 ID。每个 item 内的目标必须按真实源顺序连续；外层 items 已有显式绑定，允许列表顺序变化而得到同一源顺序合成结果，UI 仍展示原 items 顺序。所有 items 的目标并集必须等于当前已授权的选集，缺项不作为“其余不变”悄悄接受。Provider 主项和 companion 的 item_id 唯一性复用现 `ToolOutputContract.validate_unique_item_ids/2`；纯应用边界也不得先转 map 吞掉重复。作者编辑的未知、重复、遗漏 item_id 或试图修改机器字段均拒绝，不能靠 map 覆盖或列表位置猜回归属。

修改范围提议、实际材料覆盖与作者采纳权限分别成立。`complete/partial` 只能表达现材料 owner 证明的实际供应，不能由候选长短、分段数或模型声明生成；读过全文不自动授权整章写入，目标区间全部已读也不等于全章已读。模型选段仍经 `ChapterRevisionScope/ChapterReadEvidence` 核本次作者输入后的真实章页、完整目标 byte 区间、同源 hash 和版本；部分目标字节、缺页、隐藏或过期材料不能支撑完整片段。Writer 的完整 baseline 仍按 §5.2.3 的真实可见页证明复用或由现 owner 完整供应，不凭目录或 source refs 补已读信用。

`whole_chapter` 须在当前 run 的作品、能力、对象与权限边界内取得完整 fresh accepted 基线；`target_segments` 只生成当前已验证选集的候选，不因应用持有全章而扩大范围。模型范围提议及有效 ref 都不证明已获作者采纳授权，也不能机械证明其理解了作者意图；普通创作结果仍是 tentative，写入 Canon 必须继续经现作者动作/合法委托与采纳事务门禁。格式操作复用现 `ProseFormatting` 的整章换行计划，保留非换行字节、版本及合法换行边界；本次不增加局部只排版语义。

**作者原话只由现判断链解释一次。** TurnInteractionService→DialoguePlanningService→Judgment RequestIR→AuthoringSession 保留本轮作者原文及既有来源绑定，机械 goal/执行说明不能替换它。Judgment 依据该原文与真实观察作一次语义判断；在现 `execute + revise_adopted_content + chapter_ref` 决定中贯通既有 `AuthoringTask.scope.modification_scope` 三种值：`format_only / target_segments / whole_chapter`，不创建第二套范围枚举、授权 DTO 或解释器。该字段是待系统复核的操作提议，不是模型签发的授权证明。

局部范围中的段号、字面替换和阅读后发现目标，由 Judgment 通过既有 `chapter_read` 取得真实内容后选择既有 `target_segment_ids`；系统不把作者文字再次翻译成 ordinal/literal locator，不新增定位协议或直接文字替换旁路。引用、否定、条件、局部限制、参考章与修改章的区别属于同一次判断的语义责任；歧义沿现 `ask_author` 澄清，不要求作者使用固定中文口令。模型是否忠实表达作者意图通过 R08 的真实语义反例验证，不能用 refs/版本机械合法冒充语义正确。

现 `JudgmentDecisionToolContract`、`JudgmentProtocol` 与后续 Decision/Run/PendingArtifactWorkflow 消费同一个已验证判断，接通既有 `modification_scope`，删除“章修订禁止该字段、随后解析 run.goal.text 猜范围”的双重解释。现 `ChapterRevisionScope` 根据该结构化提议、真实读取和当前 accepted facts 复核范围、作品/对象、版本与 hash，不再解析 author_goal。`ChapterRevisionAuthorInput` 的作者语言授权、整章词面、显式段号、引号字面与先行词规则连同所有调用和专属镜像测试完整退役，不保留 fallback、门面或第二章节选择器。

目标章节、真实读页与候选范围必须一致；跨作品、错误绑定对象、未知或失效 ref 必须拒绝。合法 ref 仅证明对象可定位及其实际读取资格，不能证明模型选择恰好符合作者自然语言；已有结构化目标限制和 run 权限仍由系统独立核验，未给出的限制不由词表猜出。当前改动只收束章修订路径，普通 artifact 支路的既有自然语言 guard 仍按 R08 原职责继续审查，不宣称全产品已消除所有此类规则。

**存在性与首消费者裁决。** modification_scope 及三个值已由 AuthoringTask 持有，判断结果复用该字段，不新建 DTO、表或枚举；JudgmentDecisionToolContract 与 JudgmentProtocol 只贯通现字段。ChapterRevisionScope 已有范围/观察绑定而没有独立的判断组合校验入口，将其现有组合检查收敛为 validate_judgment_scope/1，供原 bind_observed_targets/2 和 PWF 执行边界共同消费，旧分散判断退役。ChapterReadEvidence、LocalizedRevision、ProseFormatting 与 AuthoringTaskBuilder 均复用；ChapterRevisionAuthorInput 整体删除，不留委托门面。现作者来源与 steer 清理链已覆盖本轮输入身份，不另加同义来源字段或校验层。

**范围拒绝与再次修订不得旁路。** 章修订决定缺少范围、范围值非法或其组合冲突必须在现接收边界拒绝；`target_segments` 必须给出非空、形状合法且无重复的 `target_segment_ids`，再绑定当前真实读取。`whole_chapter` 与 `format_only` 不接受 `target_segment_ids`；非章修订动作不接受这两个章范围字段。错误按原 call_id 进入现有有界纠错，不能从作者词面、历史 goal、候选长度或旧默认值补出另一范围。

已有章候选再次修订沿原 payload 的 scope、target IDs、对象与版本/hash 复核，模型的新文字、全章基线或参数不得扩大既有选集；不能因声明缺失退回普通 artifact 修订。此处仅证明结构化提议的资格、范围执行与真实来源，不把有界纠错通过当作模型已经忠实理解否定、条件或隐含限制。无法确定目标/范围的判断应走既有澄清；作者原文与原始输出保留，tentative/采纳边界不变。

**形状、上下文与纯应用的分工。** `ToolOutputContract` 负责新字段基本形状和原值保真；现创作接收 owner 根据实际 AuthoringTask/Scope 选择字段适用性，不依据 Writer 重新自报 scope。Common 不查询 DB、不调用 Persistence/Domain 来猜权限。作者原话的语义解释归现 Judgment 链；已验证决定的范围及原 scope/effect 与当前 accepted 来源/版本/hash 的机械复核归纯 `ChapterRevisionScope`；读取复用现 `AdoptionWorkflow.chapter_revision_context/2` → `AdoptionRepository.accepted_chapter_scopes/2` 和 `ReadingProjectionRepo.chapter_prose_text/1`。在现 `ChapterRevisionScope` 新增窄 `revalidate_payload/2`，只对传入原 payload 和当前事实作复核，返回原 payload 或错误，不读 DB、不重新解析作者意图、不扩选集；已查不存在同名或等价 payload 复核 API；当前真实调用归 pending 的候选预检与再次修订，签名只承接这两处已存在的事实输入。另经同责查重后，由同一 owner 的 `declares_revision_scope?/1` 统一识别原 payload 的范围声明：modification_scope、scope.kind、replace effect 或任一 item 映射字段都使 AW/PWF 进入严格分支；它不授予授权、不补齐缺项。缺失或冲突的声明必须拒绝，不能因部分字段丢失退回普通修订、平串编辑或保存。独立可达性审计确认普通质量修订确有生产入口，但当前没有产生 scoped 质量修订动作的链路，不能把服务存在等同于第二个 scoped caller。真实片段存在性、连续区间、选集完整性、正文应用和回执派生只在现纯 `LocalizedRevision` 定义；调用方传同一已复核基线和授权，不在各入口复制平串 guard。

沿现 `LocalizedRevision.replace_segments/3` 将第三参数前向改为原 `items`，AdoptionWorkflow attrs 直接传 payload.items，不另命名 replacement_items/regions。PWF 在现 NativeToolExchange 的 `validate_result` 回调中复用该纯规则，拒绝不可应用候选并按原 call_id 回流既有有界纠错；不先发布候选再等待作者采纳时发现映射错误。最后采纳事务重新核工作/章节、当前 accepted 集合、版本和 hash，再用同一纯应用逻辑执行；预检不替代事务时点的 freshness。错误保留原输出、原调用和真实计数，不能清洗、补字段、扩大选集或自动退到 whole_chapter。

纯正文入口经查重后在同一 `LocalizedRevision` 中提供：新增 `compose_content/1(items)` 校验非空列表与各 body 的 binary/非空白形状，返回原 body 按既定分隔符组成的正文；新增 `replace_scope/2(base_segments, items)` 返回 `{:ok, 完整正文, 回执}`，复用同一组合及旧 slot/no-op 规则。现 `chapter_prose_text/1` 消费 accepted Draft.content 并剔空，不能用它冒充候选正文验证。原 `validate/3` 的消费者迁完后删除旧入口。局部与整章 scoped 的外部采纳 attrs 仅以 `items` 提供正文，不能同时提供 `content`（即使文字相同）；Repository 在进入现 MemoryItem/事务步骤前由 `compose_content/1` 一次派生内部 content，后续记忆与展示消费这份派生值，局部正文的真实应用仍只消费原 items 的映射。该聚合是候选正文，不冒充应用后的整章正文；不新增持久镜像、范围真源或兼容双入口，非 scoped 的现有真实 content 消费保持其职责。

**正文与确定性组合。** 所有正文路径验证非空可以检查空白，但成功值必须返回原 binary；退役正文 `String.trim`、`to_string`、丢空 item 和用标题补正文等隐式修复。非正文标题/说明的独立规则不借此扩大修改。局部替换以绑定区间的 `body` 原字节替换区间正文，只保留区间外原字节与该区间最后一个原尾分隔符一次；区间内原分隔符可随作者授权的合并/拆分消失，不能又按旧逐片段规则加回。整体 whole 候选按原 items 顺序，以固定 `"\n\n"` 连接每个原 body 得到整章替换正文；这是现整体 prose 组装语义的明确分隔符，不是目标映射或完整性推断，不 trim 各 body，不另附旧章尾分隔符。该正文组装和适用性在现纯 owner 中共用，不能在编辑、预检、采纳各复制一份。

whole 允许合法压缩重复和改变自然段结构，取消源/候选重分段后等数量、以及新正文不得少于旧正文一半的判据。范围完整性由真实章身份、完整 accepted 覆盖、版本、作者授权及当前整体替换表达证明；原“短的局部候选不得冒充整章”的保护改由这些真实契约承接，不能通过删除保护让任何短片段无条件覆盖整章。

**pending、质量修订、编辑与来源。** 章级 scoped 候选继续生成独立 tentative 产物；普通 revise_pending 以原 scope/effect 识别该职责，携带原 accepted 基线、授权集合、版本/hash，以及当前待改候选的结构化 items。既有作者修改必须进入下一次真实请求，不能只从原章重建；新候选保留 revision_of 等原 provenance，不盲拷旧 payload，也不在重建时丢失 effect。当前 `revise_from_findings` 只由 TurnExecutionService 的普通候选质量链生成；PWF 的 scoped 章修订结果不生成此动作，真实 ActionValidator 拒绝凭空提交的动作。本节保持这一现役边界，不手造 available action 宣称 scoped quality 已覆盖，也不增加新的自动或递归修订。普通质量修订保留其真实请求与来源回归；若后续切片开放 scoped quality，必须先复用原授权、fresh 基线和纯区间应用，不能把通用未绑定候选的正文拼接/段落数 guard 当作授权或丢弃原 scope/effect。

编辑仍用现 action、可信 source_turn/work/session、幂等与 stale 检查。scoped 候选不再接受平串 edited_content 作为旧兼容分支；edited_items 只能变更正文，服务端复用原唯一映射并经相同纯规则校验。非 scoped 候选确有的 edited_content 消费不是历史兼容，不据本节盲删。ProviderOutput/canonical 原参数、被拒响应、模型正文来源、作者编辑来源及 pending/recovery 字段均保真；不把作者编辑后的字节标成原模型逐字输出，不新增 content 镜像。最终仍须明确作者采纳决定，失败零写入，候选可见不等于已采纳或文学质量通过。

**回执与无消费者退役。** 复用现 `segment_changes/diff_stats/old_chars/new_chars` 和真实 source revision：一个发生变化的连续区间将实际替换字节只计入首个旧 source slot，其余合并 slot 的内部新贡献为空；whole 用全部旧 slots 表达整体替换。若替换后的整个区间字节与原文一致，保留原逐 slot pairs，不能因记账归并制造假变化。内部空贡献不授权外部空 body 或新增删除操作。区间外字节必须逐字一致，回执不把贡献 slot 冒称新分段身份。

迁移完真实消费者后，删除 `replacement_pieces/2` 的空行映射、旧逐 ID 单自然段限制、`LocalizedRevision.validate/3` 的全文重分段等数量路径、半长度门及仅服务退役入口的私有函数/专属测试；不得保留新旧双入口、按协议版本兼容接受或无调用门面。纯分段/页坐标、真实目标与 hash 校验、正确窄选、未选字节保留和原子回滚责任保留。模块规模沿现脚本实际 ratchet（max(30, 5%)）和原登记验证，不提高门槛；优先净删旧算法，不能压行或删必要注释凑数。如仍需职责拆分，先查重和审核真实独立责任，不增 baseline 迁就实现。

**前向版本。** 标准化 creative items 输出统一采用 `tentative_artifact_v2`，由现 `ToolOutputContract.creative_output_contract_ref/0` 的窄纯 getter 单源提供；该 getter 是本次经存在性审查的新增 API，不是新实体或版本平台。Registry 仅把它用于输出声明，CreativeToolAdapter、FactInventory 及 Builder 的通用输出消费者取同源值；Common 不反向依赖 Domain/Application，getter 不访问 Registry。prose 专有期望输出采用 `prose_writing_v2`，在现 AuthoringTaskBuilder 以一个私有定义供 prose/chapter-revision 复用。Registry 的 `input_contract_ref=prose_writing_v1` 仍表示原输入职责，不做同字串批量替换。本轮还独立纠正 Judgment 的 target_segment_ids 字段语义：确定性存储片段不是一句话或文学自然段；若要保留锚句而改同块重复，仍须选择该块并在 body 保留锚句。该 JTC owner 语义变更前向采用 `b26-tools-v5`，不是因 prose v2 连带升版；Policy `b27-task-v4` 与 Common v6 的自身职责未变，保留原版本；不新增 output_schema_ref 真源。所有当前输出生产者、引用和直接测试同批迁移，既有历史 snapshot/原批请求/§16.31 当时版本事实保留，不因新版本回写。

### 6.3 R07 原始工具接收、结果回执与执行事实（实施前裁决）

本节只前向收束现役判断/候选接收、原生结果投影及真实执行/采纳状态；不新增工具、响应主模型、权限模式或重试环。候选 JSON 包仍是其原 source_mirror，不提升为生产第二真源。所有当前消费者同批迁移；历史 Provider/Canonical/原批次证据保持原样，不回写成新合同。

**判断操作与引用。** `alternative_operation_refs` 只能包含本轮真实可建议的操作 ID：现能力集合、实际开放的探索工具集合和当前 profile 的现判断工具；各集合仍由原 owner 提供，不新增总 registry。未知名、带说明的 ID、当前 profile/Scope 不开放项按原 call 拒绝，原参数完整留证；删除过滤后接受和重复工具名常量。execute 的目标字段由现 `AuthoringTaskPolicy.artifact_capabilities/1` 分组派生：pending/adopted/character_profile 分别仅使用 `pending_artifact_ref/adopted_content_ref/character_ref`，其它能力不提供这些字段；不适用字段不提交，包括 null。目标存在性、作品/版本、已读材料和范围仍由对应现 owner 核验；合法字段组合不授予执行或采纳权限。描述与组合校验共用现 `JudgmentDecisionToolContract`，前向判断合同为 `b26-tools-v6`，无旧版接受分支。

`observed_refs` 是按具体操作由真实 Base/当前可用 Observation 派生的目标资格概念，不新建平行引用账本。领域目标 ID、材料来源 ref、observation_ref、provider_call_ref 各保职责；目录可发现不等于详情已读，新建对象也不伪造旧观察。旧 `judgment_output_text` 中失效字段、近似操作口号、与现 schema/能力效果相冲突的重复规则同批退役，既有工具定义与任务规则承担其原职责；跨角色 system 生命周期仍归 R17。

结构形状校验复用现 `JudgmentToolContract.valid?/2` 的实际实现并下沉为 `NovelCommon.Contracts.ToolArgumentSchema.valid?/2`。全库审计未发现 Common/Agent 现役 Schema owner 或 JSON Schema 依赖；现 ChapterMission、AgenticPlan、Judgment 已消费此校验器，新增的 Real raw 接收同批复用低层实现。删除原 Application API并迁移所有真实调用，不保留转发兼容层；只支持已有 type/properties/required/additionalProperties/items/minItems/minLength/enum/anyOf/uniqueItems/minimum/maximum 子集，按新独立反例补齐已声明的唯一项及整数边界。UUID/ref/目标权限继续由领域 owner 核验，不扩建完整 Schema 引擎。

**候选原参数闭合。** 复用 `submit_tentative_artifact`。根仅接收 `items/companion_artifacts/self_report`；item 公共字段为 `item_id/title/body/rationale`，现专属字段为 `target_segment_ids/line_break_changes/chapter_ref/narrative_role/role/aliases/memory_subtype/planned_reveal/resolution_target/resolved_at_seq`；companion 另带现 `artifact_type`，限当前四类；self_report 仅 `assumptions/intended_reader_effect/used_context_refs/risk_flags`。嵌套对象同样 closed，类型/枚举沿现 Foundation/ToolOutputContract/CreativeItemAttributes；字段适用性按实际 artifact type/task 核验。应用派生的 `provider_call_ref/quality_action` 不作为模型输入字段。
`skeleton_field/skeleton_value` 的现真实消费者是 FactInventory 的 `work_skeleton_suggestion` 包装，不属于当前 creative artifact 或四种 companion；内部 normalize 保留其原职责，普通 world_rule_seed 等 raw creative 类型不能借此新增 carrier。

原生响应 content 只允许 nil/空串；纯空白仍为非空，不能与候选工具正文同返。未知键、坏 self_report 形状和非法引用在 Real 重建前整次拒收，原 call 闭合后沿原 NativeToolExchange 纠错。原已解码 arguments 不再 encode→修 JSON/去 fence→parse；公共 item 校验仍服务内部产物和 FactInventory 的不同包装职责，不建立双 parse 兼容。候选标题/正文/说明保持原字节，内部来源字段只由应用真实注入。

现 `item.chapter_ref` 已有 Adapter/采纳消费者，必须从原响应到内部 item、Assembler、pending 与采纳事务完整保持；取消丢掉后按旧结果重挂。非空引用须属于本次可信作品索引；索引缺失或可信空索引均不能给非空引用授信，错误引用不退回按 title 新建。校验经现 executor options 进入原 NativeToolExchange 的应用 validator，错误在候选发布前纠正；删除成功返回后的失败改写。最终采纳时继续执行现 work/对象/版本事务校验，不因预检而取消 freshness。

**七字段只作原生结果投影。** canonical `observation/validation_result` 继续是唯一结果事实；既有 `RequestIR.Projection.structured_content/1` 为三 wire 派生以下七键。外层各自保留原生 call 关联，不改变 Chat/Responses/Anthropic 的消息或 SSE 协议。

| 字段 | Observation | validation_result |
|---|---|---|
| ok | status 为 ok/partial/truncated 时 true，unavailable/stale 时 false | 仅 passed 为 true |
| data | 原 type/status/source_refs/versions/coverage/omissions/next_offset/content | 原 type/status/reason_code/detail，含原授权与 Canon 标记 |
| error_code | 成功 null；失败取实际结构状态 | 成功 null；失败取原 reason_code |
| message | 正常 null；失败可取真实 content.summary，无则 null | 仅取实际 detail.message，无则 null |
| retryable | 当前直接探索无自动重试，实际 producer 写 false | 实际纠错分支供给；成功或终局 false；无历史事实 null |
| observation_ref | 仅真实 content.observation_ref；无则 null，不借任一聚合叶身份 | 恒为 null |
| budget_after | 当时已有探索窗口快照；无则 null | 当次交换真实上限/消耗快照；无则 null |

data 保留原 typed 结果，排除外层已有 call_id 和以下快照字段；partial/truncated 不被提升为全文信用，校验 passed 不变成执行/采纳成功。三 wire 当前 evidence reader 同批消费新 envelope，不保留旧 wire 双解析或补签历史证据。

**仅新增的事实位置。** 现结果块增加 `retryable: boolean|null`、`budget_after: map|null` 两项当时快照；没有等价历史字段，当前 Scope 无法证明过去消耗，故不得从最新 Scope 补算。budget_after 以 `{exchange: {provider_call_budget, provider_call_count}}` 明示本次交换窗口，或以 `{exploration: 原 ExplorationPolicy.budget 值}` 明示实际探索窗口；两者不当成 run 总剩余额度。均由原实际 owner 在结果发生时供应，缺值/null 表示没有证据，不能伪填 0。

现 RequestIR 构造器、AuthoringTranscript 和 codec 透传这个纯 receipt_context；不建 DTO/表/新 Schema 文件。Native 在拒绝处只计算一次有效重试决定（错误可重试且真实 count 未达 max_calls），回执与是否继续消费同一决定；finish 透传已有 `provider_call_budget` 语义，AuthoringSession 最终闭合原 pending call 时消费真实 limit/count，retryable=false，不另开循环。Judgment 统一沿现 `@max_attempts=2`，删除按特定错误码额外第三次的分支；成功/失败/终局快照与实际调用分支同源。没有工具 call、传输失败、零预算时不能造假工具结果或 Observation。

**现职责归位。** 当前工具选择整体归回已有 `RequestIR.Tools`：原目录顺序、schema、名称读取和未知名称错误保持，由其 `select/2`、`name/1` 单源供应，删除 RequestIR 私有重复实现。现 canonical JSON 解码只有 AuthoringTranscript 一份；将完整键白名单、opaque payload 保护、递归归一及形状/ref 校验移至纯叶 `AuthoringTranscript.Codec`，由 Transcript 的恢复编排和 Checkpoint/SessionHistory/Replay/CompactionSummary 的真实恢复消费者直接调用；原 decoder 和旧归一入口删除，不留双 parser。Checkpoint 继续负责存储、事务和版本外壳，Codec 不持有新事实或 I/O。该归位使 receipt 往返沿同一实现闭合，不扩展历史协议接受范围。

**真实执行与恢复。** 原 ToolResult 的 succeeded/failed/partial/cancelled 是工具结果枚举，UI 显示名按该枚举映射；未知值表达未知。运行 completed 只表达该轮生命周期结束，不代表目标完成或已保存。TraceWriter 的全部现生产调用者必须传真实 execution_counts，tool_calls=0 时不记 tool_dispatched/tool_execution_completed；Gate 已允许、预检失败、真实派发后失败分别保留事实。

使命/材料窗口 ref 不能证明采纳；Replay 的缺证判断、状态链、说明和采纳回答均选择带真实持久写入/采纳字段的既有摘要，并保留实际 receipt 绑定，不依赖数组首项。运行恢复读取已持久 AgentRun 的 completed_step_refs/pending_artifact_refs/plan/status；WS 与既有 HTTP activity 同源投影到现 AgentRunState 合同，业务 TurnResult.agent_run 仍仅为关联摘要。恢复不能补造完成步数或 live 权限，旧摘要不能覆盖较新的运行事实。后台派生维护仍按原策略与来源记录，不把它当本轮候选已采纳。

### 6.4 R08 意图解释、真实作者来源与普通候选修订（实施前裁决）

本节按愿景 §2.3–2.4、VS-00D §11 与 B87 §19 的存在性审查，前向收束现有 Judgment、原文登记及普通候选修订职责。它替代 B33 当前说明中将中文 discussion_only、过去指代与固定 explore-before-ask 当作客观机械事实的部分；B27/B33/B34 历史输入、原始结果和失败证据不改写。本节不改变 R07 的未验收状态，不扩展 B89 A01（原 R09）的能力治理或 B87 R17 system 生命周期。

**一次语义判断与规则归属。** 作者的否定、条件、引用、讨论、明确动作和来源选择由现 Judgment 根据真实原话、会话状态与实际材料判断。AuthoringTaskPolicy 承担判断/计划业务语义，AuthoringSemantics 承担现专业调用共同约束，AuthorContentRegistration 承担登记来源与保真规则；JudgmentProtocol 的输出说明仅承担原生工具、正文通道、字段和组合合同。重复业务指令从错误责任位置退役，不在渲染末端去重。删除 discussion_only? 中文正/反词表、依赖该标志的校验/纠错，以及从指代词推导“必须先探索”的机械拒绝；APP 不增加第二意图分类器、文本过滤器或新模型审查回合。结构事实充分不等于文学完成，结构异议不自动成为修改请求，明确效果只能对应实际能力或诚实缺口；资料接收与有内容的讨论保持不同作者效果。

**纠错尝试不是作者问答事实。** 被拒绝的 ask_author 工具响应尚未向作者发布，不能由 previous_attempt_tools 将其推断为“已提问未获回答”，也不能因此否决同一有界协议窗口中的合法纠正。退役该推断和没有真实生产者的 action_intent_correction_info 例外。真正已发布的问题及作者选择继续由现 TurnInteraction/BehaviorState、来源与动作绑定消费；不得把重试、沉默或模型自述当作作者回答。原调用身份、两次实际 Provider 上限、失败留证和预算不改变。

**无工具响应的拒收事实（R08 2026-11-23，实施前扩展）。** 真实纯文本首稿被现接收门拒绝后仍留在canonical，不能只追加无状态纠错文字，使后继请求或摘要把它当成已经交付的讨论。复用现 validation_result 与 application_notice：RequestIR.append_validation_result/6、AuthoringTranscript.append_validation/6 的string主体仍是原生工具call_id；新增由真实响应provider_call_ref/provider_run_ref组成的map主体，只允许产生无call_id、status=failed的application_notice回执。沿原status/reason_code/detail/retryable/budget_after，不新增published布尔、block type、表、来源账本或判断循环。这是现协议的有限前向扩展，不把它称为零契约变化。

仅JudgmentProtocol与NativeToolExchange现有发布前拒收出口供应该事实。引用保存在notice现有顶层执行元数据，必须绑定同一运行下紧前、唯一的真实无工具assistant；作者会话仍须保留同源作者输入与有效来源，不能借其他run的作者或把缺来源补成已知；缺/错/跨输入/重复引用、重复回执、工具主体与响应主体混用均拒绝。实际空content或仅思考响应可保留空blocks及其真实身份，不补造正文；运输失败没有响应时不能伪造assistant或该回执。原始输出、顺序、私有状态、调用次数和失败终局保持；旧自由notice仍为未知，不以词面补标，成功回复及普通职责续行notice不受失败推断。机械身份只能定位响应，拒收/未交付事实的权威来自上述真实控制流，不能从pcall或相邻位置单独推断发布状态。

三wire复用现七字段结构投影，明确传递这份响应未通过接收、未作为回复交付以及原纠错理由；有真实作者输入时保持其来源，没有作者的应用任务只陈述原任务，不宣称作者关系；不得加入针对某句回答的禁词/改写规则。顶层pcall/prun仅用于内部绑定，不进入Provider body，普通text notice原字节保持；不伪造原生工具call，响应级回执不计入工具结果集合或实际Provider调用分母。MessageCoverage、TranscriptCompaction的最近K项/分组/可压缩与摘要来源资格、SessionMessageRead回查事实及两个现JS请求/覆盖判据同批消费同一canonical拒收事实。失败原文仍可逐字回查且保留hash/分页，回查同时带真实拒收资格，不能由completed run冒充已发布。无回执保持未知，不能补造已接收结论；已有真实工具validation链和普通通知保留其不同职责。

**既有无作者应用任务的兼容边界（2026-11-23，实施前补充）。** 独立质量评审、从已建AgentRun目标构造的内部计划或章使命可以合法不携作者原话，不得为了记录拒收而制造作者。此分支在源响应发生时已存在的历史前缀中不能有user/author消息，且须在源响应之前存在同owner、真实先后顺序的application_base与有效scope_update；分别选源前同owner的最近Base与最近Scope，再要求Base早于Scope，选中后无效不得借更早对象回填，任务材料沿现Scope/source_refs保留；真实run_id、响应身份唯一性、邻接与坐标规则均不变，不以业务角色词表或新增mode字段判定。缺Base/Scope、跨owner、混入外run作者、存在但无有效来源的作者仍拒绝。后续新作者输入不得追溯改变旧拒收事实、旧前缀或来源；源之前已有的坏/外run作者仍不能降级为应用任务。该回执只证明实际响应被接收门拒绝，不供应作者身份或授权；即使应用任务材料含作者字句，也不升格为author provenance。持久作者会话的来源消费者仍独立核实原作者，不能据此回填或推定缺失作者。

上述 map 主体由 append_validation_result 的共用构造路径在原 detail.message 前加入确定性事实：有真实作者输入为 `本次响应未通过接收，未作为作者回复发布；仍在处理原作者输入。\n`；合法无作者应用任务为 `本次响应未通过接收，未作为任务回复发布；仍在处理原任务。\n`。随后原纠错 message 逐字保留；三 wire 不再各自拼接第二份事实，七字段中的 message 继续唯一来自 detail.message。string 工具主体及普通 text notice 不加该前缀。SessionMessageRead 仅在同源拒收绑定成立时，于既有 facts.validation_result 返回原 validation_result block；不投影内部执行引用，不新增发布布尔，缺回执时该 key 缺失，不能补成功值。

**来源资格来自真实消息。** 登记复用现 register_author_content、author_content_source_ref 和作者消息来源，不以“之前”等词、引号/冒号或 8/40 字门槛决定 current/历史资格。当前原文仍是本条完整作者消息的原字节；历史来源必须对应当前作品、当前会话中的真实作者消息。判断侧从当前实际供应的 canonical 作者消息或现 SessionMessageRead 的完整来源观察派生可用资格，不能把最近十条 interaction_state.author_inputs 当作全部可登记范围，也不能用摘要、元数据、部分页或 assistant/tool 内容冒充完整作者原文。回查证据沿现 MessageCoverage、AuthoringSessionLog、消息 role/provenance/source_refs 与完整内容 hash 绑定；同一 run 中的不同作者回合不能由 parent_turn_ref 猜成同一来源。

**接收与物化贯通。** 现 DialoguePlanningService/AuthorContentRegistration 的来源接收、登记和请求供给消费同一个实际来源身份；历史物化复用 WorkSessionRepo.user_entry(work, session, turn) 取得受作品/会话约束的完整持久原字节，并与真实供应证据对账。只改 prompt 指向消息回查而不接通合法来源及物化不算完成。新鲜原字节、实际已供应和作者语义选择分别成立；完整读取不能自动授权采纳。保留来源未找到、错误身份、内容不一致及重复物化的现有业务边界，禁止扩大固定历史包、建立另一来源 registry 或从相似词猜来源。新增纯投影/组合函数只落现 owner，实施前记录首个消费者；不新增表、API、工具或来源主模型。

**R08 来源接线的存在性审查与首个消费者。** 复用 AuthorContentRegistration 作为纯来源规则 owner，保留已有 register_author_content 工具及 author_content_source_ref 字段：author_sources(%RequestIR{}) 从真实已供消息返回 {:ok, [%{ref, source_hash}]} 或明确来源错误，替换旧 context/current_turn 两参最近名单投影；bind_judgment(judgment, request) 在 JudgmentProtocol 处理真实响应且剥离临时会话视图之前绑定内部 author_content_source=%{ref, source_hash}，不增加模型返回字段。该纯绑定替换 validate_author_registration 的名单资格校验；source_text(binding, actual_ref, actual_text) 替换旧四参来源读取，只核真实身份及原字节 hash，IO 仍由 DialoguePlanningService 调用现 WorkSessionRepo.user_entry/3 承担。当前来源身份沿实际 source_input_ref 进入 goal；不得用最后一条 user 或 run.parent_turn_ref 代替。历史来源复用现 SessionMessageRead 完整内容观察和 canonical 作者消息；同 ref 内容冲突必须显式失败，不能以 map 覆盖或去重遮盖。SessionMessageRead 在既有 facts 中保留真实消息 source_refs/provenance 与作品/会话身份，观察 ID、版本、coverage 与完整性仍由现 owner 生成。这些是既有 owner 的内部接线替换，不新增表、工具、对外 API 或第二来源模型。

首次判断先用现 AuthoringTranscript.new 和现会话组合器生成只供来源派生的真实作者消息视图；该临时视图不发送、不持久化。取得完整来源资格后，复用同一构造器的 initial_scope 一次生成最终 application_base → Scope → author 请求，再由原会话 owner 组合历史。最终只有一份首次 Scope，静态规则与已供作品事实保持在变化的作者输入之前；来源计算顺序不能改变实际消息的缓存边界。保留现构造器 base.source_refs 的来源说明与 scope.base_refs 的材料资格分工，不新增构造器或改写历史消息。既有 transcript 继续仅追加作者和真正变化的 Scope。模型 author_content_sources 目录仅投影当前与已完整提供历史作者消息的真实 ref，每项为 %{ref}；其 ref 集合与当次真实请求的完整 author_sources 资格集合相同。内部 %{ref, source_hash} 继续由 AuthorContentRegistration 派生、绑定并与持久原文核对，source_hash 没有登记工具参数或模型选择职责，不随登记目录重复供应，也不在登记静态规则中提示模型解释。SessionMessageRead 的原始分页观察及章正文、格式化所需 hash/版本仍按既有 typed 合同无损保留；不得在 Provider 投影末端删证据、过滤作者原文里的 hash 或校验码。本轮来源仍由已有 goal.source_input_ref 标识，不新增 current/history 字段。register_author_content 统一原样选择目录中的真实 ref，接收时再以最终实际 RequestIR 独立核资格；目录声明本身不授信。退役 current 别名及其依当前 Scope 解析别名的专属逻辑，字符串 current 若恰好就是某条真实来源 ID，仍按普通精确引用处理，不设词法黑名单。同文不同身份分别保留，不依文本去重或父回合猜测身份。引用说明归现 JudgmentToolContract 的参数合同，旧静态规则中的目录外 current 特例删除；工具合同升为 b26-tools-v7，所有当前替身、语义判据及调用消费者同批迁移，历史请求、原始响应和候选规范归档不重写。固定 schema 保持无动态 ref enum；新版本工具/规则指纹会改变，但同版本内不同来源不改静态工具或初始消息的缓存分层。该调整只收束 R08 来源事实的产生、可发现性和精确选择，R17 system 生命周期不在本批实现。

**普通 artifact 的完整对象修订。** 沿现 pending_artifact_ref/adopted_content_ref、完整 artifact_body、AuthoringTask.scope.refs/base_ref/base_hash、真实作者原话与来源、Judgment 当前目标及原 Writer body/rationale 组织修订。删除 PendingArtifactWorkflow 的 guard_scope_text、layout_only_request?、paragraph_index、numeric_change、revision_target_hint 及仅服务它们的后验校验：不能把作者原话与模型 dialogue_goal 拼成第二份授权输入，再依词面选择一个范围或插入专项改写指令。普通 artifact 不建立第二套范围 DTO，不套用 whole_chapter 或章 segment IDs；完整对象候选是否忠实履行局部措辞要求由真实语义证据判断，不能以旧 regex 的通过代签。

普通修订规则继续归现 AuthoringSemantics.operation_rules(:revision)，由既有 static_block 消费；PendingArtifactWorkflow 两支不再传重复静态 revision 文案，Real.single_revision_guidance 的段号、数值及排版特例退役。已核 for_revision 显式构造 task.kind=:revision，CreativeToolAdapter/Real 消费真实 AuthoringTask，不依赖该可选文案决定修订身份。共享规则仅要求按实际输出契约交付目标对象/范围的完整修订内容：内容候选 body 与 rationale 分工，不把 format_only 的计划 body 或 target_segments 的局部映射要求改成整章输出。原 revision 对范围限制及不自动采纳的复述归回唯一规则：共同裁决/采纳约束由 shared_rules 提供，revision 只说明对象与基线、实际修改范围、完整替换和 body/rationale 分工；生产只经同时消费两者的 static_block 交付该规则。沿现 AuthoringTask.semantic_version 提升至 b27-semantics-v7，无新规则模块或兼容分支。

章正文的 format_only/target_segments/whole_chapter 仍按 §6.2 的真实基线、已读目标、版本/hash、确定性换行/区间应用及采纳事务执行。已声明章 scope 的候选不得退回普通分支；普通修订的 provider 原参数、来源、非空原 body、真实预算/call_id、tentative 和独立作者采纳保持。仅服务旧词法 guard 的纠错刺激迁移为真实可达的结构/来源失败，不能为删除旧规则丢掉原交换与执行计数覆盖。

**本批控制流与测试职责复核。** JudgmentProtocol 的 append_request_author/3 只承接原条件作者追加，initial_request_transcript/6 只承接原首次完整 Scope 构造与同源历史组合，两者均为 request_transcript 的私有分解，不新增请求模型、构造器或执行控制环。已有 transcript 的续行、重复构造与三 wire 恢复整例归既有 JudgmentProtocolTest，复用现 TestAgenticLoopFixtures；JudgmentInitialSnapshotTest 保留首次快照与静态事实缓存判据。PendingArtifactWorkflowTest 中角色档案实读后修订的整例归既有 B29CharacterRoleConsumerRefreshTest，使用原 DataCase、真实 work/session 与相同 Writer 接线，保留原文和零主档案写入断言。测试归属调整不删除断言、降低门禁、扩大模块规模基线或引入新的场景框架。

AuthorContentRegistration 的页面核验复用原范围、原字节和来源身份规则：page_content_valid?/1、page_ranges_valid?/1 仅分解 valid_page?/2 的内容形状与字节/字符范围责任，complete_read_binding/2 仅承接完整拼接结果的长度、hash 与页面坐标核对，join_page/2 为原 join_pages/1 的逐页组合函数；均为同 owner 私有函数，已查无可复用的作者来源等价实现，不借章节区间检查冒充原文身份校验。usable_observations、父观察状态、真实页状态、缺页和来源冲突语义保持。作者登记的四个现 DPS 流程测试整体归已有 AuthorContentRegistrationTest，该 owner 已覆盖真实 Judgment 接收与数据库边界；原 drive_judgment/4、drive_judgment_result/4 移入已有 TestAgenticLoopFixtures 供这两个测试消费者复用，避免复制运行驱动。原生登记替身仅留在该测试 owner 的 registration_execution/2；不新增生产/测试模块或放宽验证。

**现役字段和证明。** 局部正文仅使用 modification_scope=target_segments、items[].target_segment_ids 与原 rationale；不引入 paragraph_only、change_reason 或第二候选说明。真实目标与已供材料按操作关联，不把领域 ID 与 observation_ref 直接做字符串集合比较。观察 coverage_note 保留其材料覆盖说明职责，partial 不授信 full；rationale 与 body 的语义一致必须审阅实际结果。确定性测试证明接线、结构、来源与效果，实模 A/B 和当前工作台证明作者意图；B27 退休快照不作本批 Before，B33 当前证据不得继续以词法守卫是否触发代替讨论零候选/零作品写入。历史失败不抹去，缺实际模型/页面/binding 时不签 PASS。

**当前 B33 外部验收消费者。** 复用 native_b33_evidence/drive 与现 authoring_canon_evidence 的完整内容快照比较，S6 改为正常讨论零候选/零作品内容写入；不再消费已退役 discussion_only_violation，也不以只比较表行数证明零写入。已有六条冻结输入保持；旧批次模型配置与结果只读保留，当前独立批次按下述真实供应商裁决冻结。驱动退役按场景补话和自动选择作者答案，遇到未预注册追问/暂停只记录原始结果并结束该批，不能由驱动纠正模型到达 PASS。discussionEvidenceChecks 是该既有 verifier 内抽出的纯断言函数，首个消费者仍为 verify，用独立内容变更、候选、追问和失败反例校验；不建立第二场景框架、产品开关或模型调用入口。原 B33 历史证据不重写；此证据维护不代替 R08 当前源码的实模 A/B 与原生绑定。

**B33 当前供应商与外部服务边界（R08 恢复前裁决）。** 现役六场输入和顺序保持，旧 Strata 批次原件不改写；当前 R08 批次允许沿已授权的 Splash 受控参数执行。复用现 `native_b33_evidence/drive` 的配置、`scenario_evidence.assertProviderAndWire`、`request_cost_runtime_recipe` 的受控参数及 runtime 事实核验、`strata_lifecycle.readStrataState` 的只读观察；不复制供应商注册、运行配方或模型生命周期控制。执行前的模型声明、实际 ready/runtime 事实、Provider 调用日志、真实请求 URL 及请求中的模型/effort/max_tokens 必须按实际供应商对账；请求 URL 必须来自该实际 endpoint 的原生产路径，缺失或地址错配均不授信；每条真实调用还须通过现执行双引用绑定唯一持久 ProviderRun 与本批真实作者运行，缺失、混绑、错误身份或终态不能靠同供应商计数通过。未观察到的事实不以默认值补成成功。现 B33 配置在首次作者输入前封存实际模型声明、来源引用与预算，驱动和 verifier 共同消费；不得直接借用旧批次源码标签、预算或把该参数组描述为产品默认。`tauri_slice_verify` 只在既有 B33 注册路径复用现 runtime-facts 观察，不新增生产 hook。原生网络帧与 Provider 调用日志分别说明覆盖范围，未采集原始 HTTP/SSE 不声称已经取得。

作者运行的模型服务不属于 B33 进程树：退役 B33 自行请求 Strata unload 及其“loaded 为 null 即成功”的判据，结束只读记录实际 provider/model/endpoint 与可用状态；不得为验收启停、卸载或修改服务配置。开始失败、观察失败或未知状态如实记录；无实际作者效果时不补写 UI completion。新增私有函数/配置字段仅服务现 prepare→driver→verify 消费链，测试归现 `native_b33_evidence.test.mjs`；生产实体、Schema、独立 harness 和第二控制环均为 none。供应商接线修复只解除当前消费者的运行前置，不能代签 R08 实模 A/B 或完整语义矩阵。

**R08 章范围与作者行为验收的同职责迁移。** native_b28_scope 与 B71 behavior 继续承担其已登记的章范围和作者状态场景，不另建 R08 harness。当前供应商、runtime/seed/case 原件及预算在 prepare 阶段固定，逐次调用复用现 readBatchAuthoringHistory/bindNativeCalls 与实际 ProviderRun、canonical 请求、原始请求及 SSE 对账；不能仅把 Strata 字符串换成 Splash 或仅凭供应商调用数授信。所有用户发送、ACK、终态、问题与动作按本轮真实身份关联，驱动不能选择推荐／首项答案、追加未冻结补话或自动恢复暂停；waiting/failed/cancelled 如实留证，没有作者决定时不采纳。真实采纳复用当前对象的 available_actions、限定 AX 定位和 actionFrame/actionAck/actionResult，不用全局同名按钮或驱动自报回执。外部模型仅只读观察，不卸载或启停。

章目标、当前基线/版本/hash、原始产物字段、局部未选区与无关章、动作/receipt/canon 约束保持；N4 的条件原话不等于已证明条件为假，条件成立与不成立须以独立事实和输入分别覆盖，不能补话改写原意。作者行为 seed 若没有真实 pending，就不能授信 S3 或多候选状态；需要候选的当前场景先通过实际工作台产生并计入冻结输入/预算。中文正则或关键词命中不负责自然语言语义签字；现回复与独立真实预期沿既有 semantic_review/not_signed/verdict 格式交给独立审读，机器事实仍严格拒绝错绑、缺证与越权。旧批原件、固定语料与失败保持，不因消费者迁移重算历史 PASS。仅补现 B28 缺失的职责测试，登记既有索引；无新增产品实体、API、意图路由、供应商框架或第二控制环。

真实调用没有非终局观察时，观察进入后续请求的义务未触发，沿现 null/not_signed 与 required_mechanism 表达，不把空集合判失败或声称已验证回流；不得为通过验收强迫多一次模型调用。有非终局调用时，每个实际 call_id 对应的完整结果及非空观察仍须进入同 run 后续真实请求，缺失拒绝。终局豁免不能仅靠“它是最后一次请求”，必须另有实际 run/业务结果、canonical/Provider 和作品事实闭合。


**R08 当前原生反证后的格式与缺口规则收束（2026-11-23，实施前）。** B28-native-02 的真实辅助摘要请求同时收到 chapter_summary 的 json/英文必填键与角色四栏文本要求，结果 JSON 外壳被旧标签 parser 混入正式摘要及 mood 派生；A2 的真实 WorldBuilding 请求同时收到作者单句正文限制与 creation 五栏正文强制。两者是实际应用规则矛盾，不能记为纯模型责任，也不能以原有测试已通过维持矛盾。

ChapterSummary 沿现 AuxTaskBuilder → ChapterSummaryGenerator → Domain.ChapterSummary → Maintenance/ledger 一条链统一为四栏纯文本。仅 summary 的 output_contract.kind 改为 text、required_keys=[]，继续由现角色专属说明与 Domain 的 section_order/section_labels 定义四栏；schema_ref=chapter_summary_v1 继续标识相同领域四栏对象，其余辅助任务的 JSON 合同不变。现 Generator.parse_sections 在调用原 Domain parser 前，必须确认输入完整且严格由四个既定标签各一行、按既定顺序、每栏有非空内容组成；标签是该机器格式的一部分，不用于推断作者自然语言意图。拒绝 JSON 外壳、缺栏、空栏、重栏、额外行，不能从任意文本中捞标签或把缺栏补成（无）。明确的（无）继续按现 Domain 声明的缺席语义处理；已查明全四栏（无）被旧空 map fallback 误归为 plot，与 parse_sections 声明的 render_sections 逆变换矛盾，因此同批在原 Domain parser 修正：已识别标签且无有效内容返回空 map，无任何已识别标签的旧纯文本才保留 plot fallback。不另建 parser；按既有“标签前缀行”合同，只在行首识别栏目，行内已知或未知【标签】作为正文原样保留，不能用禁符规则回避原 parser 全局拆分造成的字节丢失。逐行重复的最后有值规则与未知前缀兼容保持。只有完整成功才写新的 ACCEPTED 摘要；失败沿现错误/降级通道，旧正式摘要不 supersede，mood/ledger 不吸收坏输出。没有第二 JSON parser、新表、新 DTO 或摘要修复模型回合；原 JSON 污染证据与已发生写入不回填或抹除。

WorldBuilding 的外层 items/item_id/title/body/rationale 协议与正文形式分开。现 Real.world_building_creation_schema/world_building_guidance 的类型维度只是未明确指定正文形式时的专业指导；正文须遵守实际作者要求的内容、范围和结构，不能无条件加栏目、补待定或扩写。来源、修改依据与不确定性说明归现 rationale，不用正文栏目强制增加作者未要的内容。新建保持真实 task.kind，不伪装 revision；原 revision 保留原稿形态，通用 schema、used_context_refs、唯一性与采纳门不放宽。现接收链已原样接收非空单句 body，故只纠正真实生产提示的责任层，不加模板剥离、关键词特判或输出后处理。

现 report_capability_gap 的 optional alternative_operation_refs 与接收门本来允许没有可行替代，但三处文案无条件要求“最近可行路径”。由现 AuthoringTaskPolicy 单源供应其条件规则，判断规则及 JudgmentToolContract 的工具/author_reasoning 描述共同消费：说明缺失效果；仅在当前目录或已供应材料证实可行时说明替代路径，否则如实说明目前无法确认；未知的人工或界面操作不能断言可用，也不能断言不存在。真实只读求证与作者已提供的人工路径仍可用，不能把未知转成不存在或为格式捏造操作。替代引用继续受原目录验证，不增加 schema 字段或 capability，不改执行门或重试预算。TaskPolicy/JudgmentToolContract 分别升至 b27-task-v6/b26-tools-v8，并迁移当前引用/测试；旧请求版本及失败原件保持。此合同对齐只消除无替代分支的表达歧义，不供应界面能力表，也不保证模型一定正确。

**R08 原生消费者的当前权威与身份边界（2026-11-23，实施前）。** B33 S4 的目标正文与伴生候选在真实 AX 中为扁平相邻卡片，实际按钮标签来自当前 available_actions；驱动必须消费现 actionLabelsFor，限定真实 artifact 所属的局部 AX 范围，并使用现 revealItem 滚动后重新读取 AX、验证唯一可见按钮。不得用整个作者块中的伴生标题拒绝正确卡片，不得选首个/最后一个同名按钮或加入产品测试 hook。真实 actionFrame/actionAck/actionResult、目标身份、点击前后采纳事务和未选候选保持强校验。

同批 B33 的 22 条实际模型调用含 20 条作者 AgentRun 调用及 2 条合法后台 ChapterSummary 调用，不能把所有日志行强行对成作者 ProviderRun。复用现原始请求/SSE/日志/runtime/计数关联；作者调用继续双引用唯一绑定真实 AgentRun/ProviderRun，辅助调用仅在真实角色、同作品/章节来源及实际结果链足以证明现有辅助 owner 时单独归类。辅助失败也保留真实结果，不捏造成功摘要或 run；未知/错绑调用关闭。全体真实请求、SSE、失败和预算仍计入分母，不删除辅助调用来凑计数。

同一正文采纳还会沿现 AdoptionWorkflow → chapter_summary_maintainer 异步触发 ChapterSummaryMaintenance，再串行 LedgerMaintenance，不能只支持旧 summary_repair 来源或在采纳回执后立刻截断后台分母。采纳来源必须绑定真实 accept 发送、ACK、receipt 与被采纳候选的 source TurnResult；source_ref 为该源 TurnResult 的 turn_id，章节与 revision_base 取真实 reading_projection。prose_fragment 材料按现 items body 顺序以双换行连接、沿 Generator 既有整段 trim，明确 fragment 范围；不能改成整章、添加标题或补 AgentRun。辅助调用可能早于采纳 ACK/receipt 回包，下界取本次真实 accept 发送，不能倒置生产时序。驱动沿现 runStep/pollWire 只读等待同作品/章的摘要及后续 ledger 的 done/error，再采后态；等待计入已冻 turn/root 期限，不触发新的模型或作者输入、不改变异步产品配置。未观察到真实终态、未知调用或中止如实未通过，不能以零新增行或旧成功日志当完成。

账本后态仍由现 B33 scope_rows 保存原行并与 Canonical 对账。只有真实采纳、原始摘要调用、新 ACCEPTED 摘要及同作品/章的 ledger.done 已绑定时，才按现 LedgerMaintenance/Repository 的作用域核派生变化：不得删除旧行，外作品逐字不变；旧行 id/work_id/ledger/subject_ref/inserted_at 不变，仅允许原仓储维护列更新。新增来源限已绑定的本次 chapter_summary:<chapter>@<真实 revision> 或作品级 genre 的 work_profile:<work>；直接章属的 emotion_curve 绑定本章，同作品 arc/conflict 的既有身份可沿原规则全局重算。未知变化缺证不授信，其他作品内容零写门保持。此处仅证明授权、来源与作用域，不在验收脚本复制账本算法或加入文学评分。

**WR02 既有章摘要修复的外部核账（2026-11-24，实施前裁决）**：本轮候选保持 tentative、原正文/章节结构/作者采纳回执保持原保护；不能因同窗口出现后台维护就将新大纲判成已采纳，也不能豁免整个账本。summary_repair 的权威来源必须由开场已 ACCEPTED 的旧章正文逐行身份、revision、scene 顺序和实际字节证明，区别于本轮 receipt 触发的采纳维护；原始辅助请求/完整响应、实际章节/作品、成功摘要及 ledger 终态应闭合。生产当前 repair 的 revision_base=null 和不带 @revision 的 source_ref 如实保留，不能称其本身已证明版本；外部证据用真实源行版本和同场唯一 summary 身份补齐来源核账，歧义/未知/不匹配仍失败，不改产品 source_ref 格式或自动采纳策略。

复用现 B33 的实际辅助调用与 ledger 作用域判据，并在现 WR02 请求事实/采集/Canon 消费者中同批接线；作者调用仍按真实 AgentRun/ProviderRun 绑定，辅助调用按其真实角色和源结果链独立核账，全体请求、失败与预算都保留。只有证成的维护差异可进入现严格 Canon 比较，旧行身份/外作品/原正文保护不放宽，允许的列及来源仍以既有维护设计为据。未知写入、旧成功日志、只有 ledger.done 或净行数不能构成证明。原 WR02 的 mission_design_only 与 B28 §21.3 失败不重写；不改变原模型配置、HTTP cap=null、读取预算、异步开关或强制额外调用。

新 WR02 在原 preregistration 的唯一场景 scenarios[0].evidence.provider_stream 前向登记本批原始流的绝对 dir、mode=observe、upstream_endpoint 与 max_upstream_requests=null。现 validate → prepare marker → checkPreregistration/readConfig 消费同一哈希正文并逐值核回；实际 ready.endpoint 还须与 runtime.observed.provider.endpoint 一致。此字段仅定位和核定既有外部证据，不成为产品参数或新增预算，不从兄弟目录猜路径，不回填旧批；确定性场景没有外部调用时不要求该字段。

**R06 WR02 只读因果核验与计数口径（2026-11-25，实施前裁决）**：Why/恢复的只读边界在第一次对应输入投递前开始。全局完成日志数量增加不单独证明这次输入触发了模型；仅对已有完整 ChapterSummary 维护核账中、原始 HTTP request_id/requested_at、实际 LLM 完成双引用与完整维护证明唯一绑定且明确早于边界启动的同一请求，允许其在窗口内完成所造成的精确增量。须逐字段核对 llm_records/provider_runs 前后计数，且全部变化能由该请求的实际完成记录解释；不做统一减一、不接受布尔豁免。窗口内任何新 POST/新 gateway start/重试仍失败，旧任务在窗口内自动发起后续请求也不凭任务名豁免。实际 app start 原行没有 pcall/prun；全量应用启动集合独立执行严格时间核验，不假造逐请求启动双引用，不由完成时间减 duration 猜启动。请求已在边界前发出的直接证明来自原始 HTTP，而非日志标签或数量推测。身份或时间多义、缺完整响应/源版本/摘要与账本终态、未知增量及受保护内容变化继续失败。全体 HTTP、用量、预算与原始失败均保留；仅现 WR02 消费者使用该明确证明，共享 providerFreeInterval 的默认严格语义及其它场景不放宽，不改产品后台策略、异步开关或采纳权威。

WR02 的现役采集由 scenario_evidence.readProviderReadOnlySnapshot 与 native_b71_live_drive 共担：counts.llm_records 与 identities.completed_calls（每项 provider_call_ref/provider_run_ref）来自同一份 llm-calls 原行集合；counts.provider_runs 与 identities.provider_run_ids 来自同一次只读 provider_runs 行查询。原 before/after 两计数字段保持，read_only.provider_identities 保存 before/after 身份原集合，缺失/重复/不完整身份不得先去重或补空。每个 before 身份须保留，新增完成身份须与已核旧维护完成逐一相等；ProviderRun 集合与数量均须相同，仅顺序变化不算调用。start 在采样与输入前，after 全部采样结束后才记 end。read_only.input_events_before 记录进入 Why 前原 native-input-events.jsonl 的行数，first_input_attempt 保存此后首个 attempt 的 1-based line 与原 record；包括 scroll/activate，不能只找点击。核验重读原 JSONL 核回该行、首个顺序、时间及本批 run/应用归属，不信复制字段自报；合法 restore 换 PID/generation 保留当时身份，不与最终 target 强行相等。旧证据缺这些新增采集事实时明确缺证，不回填或重签。字段仅属于外部观察，没有新产品状态、业务事件或第二调用解析器。

同一使命报告的 input_ref_count 必须对应原 mission_inputs 初始输入及 derived 事件的实际数量；本次实际可见读取叶与初始来源的 ref 去重并集另记 supplied_ref_count。两者由现 suppliedMissionMaterials/requestMeasured 的既有输入分别投影，不修改产品事件或把并集当成实际选用数。supplied_ref_count 是该外部报告的新测量字段，现有 retained_basis_refs 继续表达实际保留依据；未知请求仍为 null，不补 0。新增读取引用没有被真实模型选中时保持未覆盖，不通过要求引用特定 ref 或追加样本制造命中。旧 summary/binding/verdict 不重写；封存原件在新目录中的独立诊断只验证新核验逻辑，不成为旧场景的新正式 PASS。

B71 checkpoint 的全会话 pending 权威沿现只读 GET /api/works/:work_id/sessions/:session_id → WorkSessionService.show → WorkSessionRepo.adoption_state；该 owner 已按持久交互及真实 resolved 身份投影全会话待采纳集合。退役从全部 AgentRun.pending_artifact_refs 并集推导全会话 pending 的新错误接线。每个 checkpoint 保存当时真实同作品/会话 HTTP 响应及采集身份，以实际 pending artifact 身份集合和数量消费；不读取跨会话 inbox、不用会创建/激活会话的 resume，不从最终 DB 回填旧快照。缺证、截断、错作品/会话、空或重复身份关闭，不能补 0。新候选以 after IDs 减 before IDs 并与真实发布对象绑定，不能用净计数差掩盖旧 A 消失而新 B 产生；当前 TurnResult 的本轮 pending 数量仍保持其独立语义。HTTP 识别、capture、state/behavior 判据与现测试同批迁移，连续性只比较稳定状态事实，采集时间/原响应留在证据外壳，不建第二 pending registry。现 native_b71_evidence capture 入口沿 ready 已归属 transport 端口访问同回环主机代理；ready.api_url 仍表示后端直连，不改其旧语义。每次 GET 冻结请求起止窗口，以 fetch 收到的解压后原字节 SHA 对账现 proxy body_state.sha256，并核解码 JSON 全对象等于记录 body，再与该窗口新增的唯一完整 HTTP 记录绑定；proxy 的 at 是请求开始时间，较早在途响应不能借日志新尾段混入。现 proxy.responseScope 同步识别 session show 的 work.id/session.id；读侧要求原记录真实存在、每 checkpoint request_id 唯一，before 采集完成早于实际作者发送、after 开始晚于同 run 实际业务结果和运行终态且在下一发送前；最终 DB 状态不能倒推检查点当时已经完成，继续复用现 wireTerminal 的真实运行帧并与 DB 归属/状态对账。只认 ACTIVE 且 read_only=false 的同会话集合；pending_adoption_turn_results 是源 TurnResult 原件，不要求其历史候选并集等于当前 pending_adoptions。

为补齐旧Q3合法停等后未发送的条件成立用例，允许在现corpus/registry另登记Q1→Q2→Q4三步数据分支：保留原三条字节、预期与S2，新的case/journey身份按连续序号冻结；原四步分支、Q3与旧证据保持。不得复用停等旧会话、代答或虚构pending，原稿与修订稿须由新批真实前两轮产生。B28缺场沿现子集选择各自从原seed单独执行；新批预算由B87 §19.44预先限定，执行后不得为取得通过扩充。

## 7. 授权、风险与采纳：完整安全模型（替代旧 R10 巨型任务）

**当前归属**：本节保留单一设计定义。§7.1 的身份、作品隔离、权威执行与独立采纳等既有约束继续适用于 B87；动态可建议集/执行同源、风险治理及 §7.2–7.4 的新增模式、委托和自动采纳建设由 [B89](../../../tasks/slices/B89-author-controlled-execution.md) A01–A08 承接。B87 的完成不等待这些转出功能，但其现役约束、已证缺陷和保留失败不能通过转交销账。本节标题中的“旧 R10”保留 2026-11-13 的历史重排语境，当前批次映射以 B89 为准。

### 7.1 五个独立判断

```text
① 对象/作者/作品身份与允许操作合法？（违法/越界直接 DENY）
② 该 capability + effect + target + 当前版本存在且可执行？（无则 GAP）
③ 此 run/profile/预算可以向模型建议该 effect 吗？（AUTHORIZED SUGGESTION）
④ 真正执行前的风险与权限模式怎么判？（ALLOW / CONFIRM / DENY）
⑤ 创作候选能否进入 Canon？（采纳边界+版本+回执+委托真实性）
```

顺序不可交换。**跨作品越权绝不是“critical 可确认”的行为**；不存在的删除工具也不能因为作者点“确认”被执行。低/中/高/critical 风险只适用于身份/能力/版本合法的动作。

### 7.2 风险的唯一派生

本节能力/可建议效果/执行权限的收束归 B89 A01，动态风险与审批审计同源归 B89 A02；各项实施前仍须核现存 owner、真实消费者和受影响的冻结契约。

- 来源基线：既有 `CapabilityRegistryEntry.risk_class`，不是另造新 `RiskClass` 表；动态调整由已有应用权威 gate 的纯规则对 `capability/effect/target/context` 决定。改写已采纳正文、结构重排和核心设定等实际影响需区分；风险的差异必须可重算、可测试、可审计。
- `MicroPlan.risk_hint` 是模型提示，不是权威风险；`ApprovalAudit` 的风险审计应记录最终系统计算结果，不再维护不同来源的“全部 HIGH”等平行推导。
- 已有 `capabilities` 分为 **系统注册能力**、**run 可建议效果**、**执行权限**、**采纳授权**。仅把当前可建议/必要只读探索最小信息送模型；完整 registry 可经真实现有探索通道查询，`capability_lookup` 如无真实消费不要先行新增。

### 7.3 模式语义与决策表（拟冻结）

以下拟冻结产品语义由 B89 A03–A08 承接，模式持久化与设置入口、critical 确认扩展、委托、自动采纳和 Smart 各有独立批次。本次只调整实施归属，不批准该表，也不改变尚未裁决时的现役采纳边界。

| 模式 | 只读（low） | 创建 TENTATIVE / 中风险 | 高风险已采纳对象变更 | critical（合法且可确认） |
|---|---|---|---|---|
| `manual` | 可直接只读；“每步”指每次有副作用的**执行** | 执行前需作者允许；**采纳仍独立** | 逐对象确认，再按采纳门 | 永远单次明确确认 |
| `risk_based` | 可直接只读 | 可生成 tentative，等待作者采纳 | 逐对象确认，按采纳门 | 永远单次明确确认 |
| `full` | 可直接只读 | 有效委托范围内可执行并自动采纳 | 仅有效委托/合法对象/可回滚时允许；否则明确确认 | 永远单次明确确认；不能靠 full 绕过 |
| `smart` | 可直接只读 | **确定性、可解释策略**根据范围与委托放行；未知降级到 risk_based/manual | 保守确认，不使用模型主观“安全评分” | 永远单次明确确认 |

- 选择 `run > session > work > global`；默认无设置时采用保守、现有产品兼容的 *安全行为*，但**不保留旧代码兼容分支**。模式的作者输入、作用域、版本、撤销与生效时间必须有真实记录。无真实设置事实不能推断作者已经选择 `full`。
- 任何模式下作品边界错误、操作不存在、候选已过期/作品版本变化、预算耗尽先拒绝/缺口，再谈风险。
- `critical` 的确认绑定到确切对象/effect/版本/后果（`ConfirmationBinding`），作者明确同意后在执行时**再次 gate/rebase**；一项确认不得升级成今后自动通行。原文“同意=执行+采纳”的体验目标只有在**原子、安全且对象类型允许**时成立；创作过程要先生成候选的，不可以把尚未存在的候选预采纳。
- `full` 自动采纳必须有作者显式 **delegation scope**（作品、操作/effect、目标范围、可选版本、过期/撤销、签发来源、最大影响界限），实际消费时再次验证、记录系统来源 `auto_adopted`，走**现有 AdoptionWorkflow/Repository 原子写入**，可回滚/可追踪；不可通过只改前端开关或模型工具调用实现。遇失败不“补写成功”；重复提交严格幂等。
- `smart` 不得引入第二 Agent 或规则引擎；只有能用现有 run/风险/委托事实定义可重算策略时才发布，未知/歧义保守退回确认，**B89 不得跳过 A08 就把自身整体任务标 done；B87 按保留范围独立签收，不等待 Smart 建设**。

**R00 冻结冲突补记**：上述 `full` 目标尚不能覆盖 [ADR-0020](../adr/ADR-0020-prose-quality-finding-and-revision-candidate-boundary-v3.md) 的修订/自动采纳边界，以及 [32 §5.1/§11.1/§13.1](../quality/32-human-approval-policy.md) 的现行 HIGH/CRITICAL 人工采纳、批准主体与 maintenance auto-adoption 约束。B89 A06/A07（原 R14/R15）必须先明确哪些对象/effect 可被作者事先委托，并逐条修订受影响 Frozen 条款；未裁决前仍执行原边界。`auto_adopted` 若用于未来审计，只能表示实际系统来源/命中策略，**不是新增 adoption_status**；采纳仍使用既有七态，不能写成作者本人点击批准。

### 7.4 持久化/授权实体红线

`AgentRun.authority_scope`、`AgentRunPolicy.allowed_tool_refs`、`ConfirmationBinding`、`AuthorActionReceiptRepo`、`ApprovalAudit`、作品/会话配置是已经存在的起点，**不等于它们已经支持长期委托的授权生命周期**。

R00 的历史存在性审计继续保留；B89 A03/A05/A06 按“现存表/列/状态/消费者/事务”复核模式、确认与委托的现役承载能力。只有可机械证明无法在现存语义中正确表达授权范围、撤销/并发和审计时，允许**最小必要新实体**，并附替代方案比较、唯一生命周期、消费链和退役清单。禁止先创建“通用 Authorization 服务表集”。

## 8. 与冻结设计的差异及先决裁决

| 差异 | 当前已存在基线 | 实施前门槛 |
|---|---|---|
| 纯对话/旧 Scope 去冗余 | VS-00L/ADR-0035 只认可特定显式 checkpoint/closed tool exchanges；canonical 不删改 | R00/03 明确检查 `covers` 的正确性；如需新覆盖语义先补 Frozen 契约/ADR，连同三 wire/恢复/回查测试一起决定 |
| 请求材料从文本到结构化 | RequestIR 已有 message+block，但很多 `scope_update` 仍是长文本 | R02 给出现有 IR 消费者/真实 Provider 展开方式；必要时直接重构现役 schema，删旧拼串分支；不做双轨 |
| 作者可见引用泄漏 | B86 真实模型 C9 失败与两次已撤回实现 | R06 以结构化来源+作者可见字节验证闭环；保留历史失败案例但不保留已撤回代码的兼容 |
| 授权模式/委托/自动采纳 | Registry 风险基线/Orchestrator/Confirmation/Adoption 已存在，**完整委托能力尚未核实存在** | 由 B89 A01–A08 承接；A03/A06/A07 等相应批次实施前先裁决授权行为、持久生命周期与采纳主体，不得以纯文本声明或模型自报代替实际审计与事务；只改现存消费者所需对象，不作为 B87 的新功能前置 |
| 快速迭代 clean | 未发布；ADR-0035/VS-00L 已批准不做历史兼容 | 现行代码/Schema 允许无兼容迁移，旧入口在全部实际消费者转移后删除；仍保留用户已创作数据和历史证据的安全边界 |

**作者授权范围**：2026-11-13 已明确授权**修改设计与任务文档并进行整体性重审**；不代表本文件可以无证据宣称实模行为、数据库事务、作者自动采纳已实现，也不自动替代对 Frozen 契约有实质语义改变时必须留下的裁决和证据。

2026-11-24 作者决定将原 R09–R16 从 B87 独立拆出，B87 保留 R00–R08、R17–R19。该决定仅改变任务归属、依赖和各自验收范围，不批准新的权限产品语义，不启动已暂停的授权治理实现，也不修改任何历史证据结论。

## 9. 验收口径：从证据到真实创作

**分属任务独立验收**：B87 R17–R19 验收 R00–R08 及受影响的现役创作、确认、作者采纳、恢复和三 wire 行为；不要求新增四种模式、长期委托、自动采纳或 Smart。[B89](../../../tasks/slices/B89-author-controlled-execution.md) 必须在 A01–A08 全部功能变更完成后，独立承担本任务的旧规则/重复授权实现清理、真实 Tauri/模型/三 wire、模式/确认/委托/自动采纳事务矩阵，以及对现役创作、采纳和恢复链的回归。B89 不借 B87 R19 的较早结果签收其后续改动，B87 也不等待 B89 的独立终验。以下证据口径按各自任务范围及真实受影响消费者使用。

**机制证据**：结构化输入的 provenance/身份/版本/覆盖/省略；静态 schema/运行时权限不同源的负例；不合法工具/文本引用 fail-closed；重复或交错 checkpoint；跨作品与 stale；真实事务 rollback、撤销、重复提交。

**原生/真实页面证据**：同一作者真实 Tauri 工作台连续输入 3/10/20 轮，真实新消息与 checkpoint 投影；统计查询不读无关正文、纠错讨论不误执行、明确操作正确处理效果缺口；同一会话跨 run、恢复/取消、现有作者采纳/拒绝及作者可见状态。新增模式、委托/撤销、自动采纳与 Smart 的真实页面矩阵由 B89 在其全部功能落地后的有效基线上独立补齐。外部驱动不植入产品特殊验收分支。

**实模证据**：同源模型/provider/推理预算、样本冻结和请求 A/B；测量 input/output/cached_tokens、TTFT、latency、Tool Call 正确率、事实引用正确率、候选可追溯与作者负担。cached_tokens 是 input_tokens 子集，不能另加；以多个样本/重复试验区分模型性能波动。写作质量必须有正常小说章节材料的连续性、情绪铺垫、目标外正文保真/文学盲评，不能用短 Token 指标代签。

**强制回归**：`mix check`、`mix test`、xref、arch_check、I1/I2/I3、N-NARR、I-CACHE、B71/B81、当前质量清单/真实 Tauri、三 wire；各自任务必选范围内的任何 FAIL/BLOCKED 均不算该任务最终 PASS。外部供应商无法测试时明确 known-gap，不声称完成全部支持。

## 10. 实施、替换与退役策略

- 按 [B87](../../../tasks/slices/B87-model-interaction-request-projection.md) 保留批次或 [B89](../../../tasks/slices/B89-author-controlled-execution.md) 独立批次的实际归属实施；各批使用独立会话和自身 scope，先重新读取当前分支 HEAD/WIP 与事实/实体审计，再改。B89 的范围迁移不解除暂停或待裁决条件。
- **不兼容历史产品协议**：无 legacy adapter、双写、旧工具 schema fallback、临时开关和“未来过渡”分支；现存消费者同批迁移且删旧入口/旧专属测试。代码变更与完整行为验收同批完成。
- **不是破坏式清空作者资料**：即使未发布，真实作品/会话/已采纳内容/审计证据的丢弃仍需明确告知与备份/数据重置授权；禁止用“无兼容”掩盖误删用户创作事实。
- 结束时盘点新的/退役的 module、struct、表/列、schema、工具、配置、路由/事件、测试 fixture；新增的均须回答“为何现存不能用”，退役的均不得留零消费者/僵尸适配。
- B87 的执行状态只在 B87 总计划，B89 的执行状态只在 B89 总计划；本设计文档不复制 Rxx/Axx 状态，`tasks/NEXT.md` 只记录排期，验收/历史批次可在现有 artifacts/ledger 登记。各自最终完成条件包含本任务全部变更后的清理与集成验收，不能把后续功能证据债务留给另一任务。

## 11. 本次设计重审摘要（2026-11-13）

本节保留 2026-11-13 的历史设计重排原文。2026-11-24 前向拆分后的实施归属见文首与 §7–§10：原 R09–R16 归 B89 A01–A08，B87 保留 R00–R08、R17–R19；下文历史“整体功能变更之后”的验收要求由两项任务各自履行。

保留：四层逻辑闭环、作者主权、真实来源、源头结构化、场景化验收，以及已记录的 manual/risk_based/full/smart 和 critical/full 用户体验目标。

纠正：不新增平行 Request、Capability、Approval/Adoption 存储；不把 `critical` 当越权豁免；不让 manual 的“每一步”与只读操作矛盾；不让 full 自动采纳绕过独立采纳边界；不提前将 `capability_lookup` 写为已存在工具；不让旧 B86 与 B87 双持任务真源；R10 拆分而不是挤进一次会话；最终 A/B 与实模验收放所有功能变更之后。

## 12. R00 增量契约审查（2026-11-13；不自动冻结）

本节区分**已核实的技术事实与工程处置**、**尚需冻结的语义改变**。本次 NEXT 推进授权允许审查后实施；它不构成作者已经选择未裁决的产品权限语义的证据。执行结果和质量状态只记 [B87 §9](../../../tasks/slices/B87-model-interaction-request-projection.md#9-r00-执行记录2026-11-13)。候选包仍保留固定源基线，不逐份覆写历史 fixture 来制造一致。

### 12.1 冻结差异处置表

2026-11-24 仅前向更新下表的后续承接任务；R00 原执行事实、候选包基线及各条 Frozen/Proposed/待裁决性质保持。

| 差异 | 当前可核实依据 | 唯一处置与实施前条件 | 首个消费者 |
|---|---|---|---|
| 第二 Request/Exchange/ModelInteraction 主模型 | VS-00L §4/§16.1、ADR-0035 决策 1/2；候选规范 §2 明确 Exchange 只是离线容器 | **禁止**新建平行聚合/存储/控制环；候选四层视图只能映射现役事实。R02 在现役 IR 细化，不能照搬候选 Request 顶层替换主链 | Judgment/专业创作 |
| Scope 的事实/来源/覆盖结构化 | VS-00L §19.2 已区分 application_base/scope_update/author；候选 Source/Material 是建议表达 | **修改现役归属**，R02 逐字段对账、明确版本与全消费者迁移后实施；保持作者原文独立，不制造 Observation；不另建 ContextBlock 总线 | ContextAssembler → JudgmentProtocol → RequestIR |
| 纯讨论或旧 Scope 的显式覆盖 | VS-00L §16.2 要求非空 `covers.call_ids`；`RequestIR.Compaction.require_call_ids/1`、`project/1` 只选择 assistant/tool 的交换 ID；ADR-0035 决策 3/4/10 | **2026-11-15 R03 工程裁决已写入 VS-00L §16.2.1 / ADR-0035（实施仍见 B87 §14）**：复用真实 run/message 坐标、唯一 covers 与已绑定模型来源的纯讨论摘要，保留作者原文/当前范围/未解义务，精确原文通过现有探索链回查；所有三 wire/恢复/事件/验收同批迁移。禁止只去 Scope 代签纯讨论、伪 call_id、turn_range 截断或第二压缩器 | SessionHistory/Compaction/Replay/三 wire |
| `write_candidate` 与现役候选工具 | 候选包规范 §7 和现役 creative 工具使用 `submit_tentative_artifact`；新用语不能证明缺少工具 | **R05 现役归属已明确**：按 §6/§6.2 复用 `submit_tentative_artifact` 及原生有界纠错，不新增或双注册同义工具；R07 原参数闭合、content 唯一性、现 chapter_ref 保真及原交换内作品校验按 §6.3 前向实施，历史源镜像不提升为生产真源 | NativeToolExchange/ArtifactAssembler |
| `change_reason`/`coverage_note`/`paragraph_only` 与 `rationale`/`target_segments` | 候选包 §4.3、§7 的建议字段不等于现役事实；I1/N-NARR 与现 rationale 原文约束保持 | **R05 必要字段已前向裁决，见 §6.2/B87 §16.34**：保留原 rationale；仅新增 item.target_segment_ids 与 action.payload.edited_items 两个位置，复用原 body 和 scope/effect，不新增同义说明、patch 正文或 region_changes。观察 coverage_note 原职责不变；R07/R08 其它未决项不据此签完成 | Writer/局部修订/作者编辑/采纳 |
| 统一七字段工具结果 envelope | VS-00L §16.5/§16.7 区分 observation、validation_result 和真正执行；候选 ToolResult 不等于现役领域 ToolResult | **R07 前向裁决见 §6.3**：现 canonical 增当时 retryable/budget_after 快照，三 wire 只派生七字段；现 call 关联、原 typed data 和结果种类保留，无观察不造 observation_ref，无历史预算不补值；无平行响应实体 | Judgment correction/三 wire/Replay |
| target / source / observation 引用混用 | 候选规范 §4.3 区分 scope.refs、material_refs、observation_ref、provider_call_ref；§6 约束 used_refs | **R07 按 §6.3 保持分界**；`observed_refs` 由现 Base/Observation 按操作派生，现 chapter_ref 在接收/候选/采纳链保真并核当前 work，不能拿目标 ID 或“可读取”冒充已读，也不能把 observation 身份与领域目标 ID 作字符串集合比较；真实 Base 与真实观察分别校验 | Ref 校验/修订目标范围 |
| `decision` 派生结构 | 已有 Judgment/AgentPlan/ToolResult/DecisionTrace；候选 Outcome 是观察视图 | **复用现有结果和 trace**；是否需要新字段以真实 caller 为准，禁止新建决策器/持久 Decision 真源；Provider HTTP 不新增自定义顶层业务字段 | JudgmentProtocol → Orchestrator |
| 四种权限模式/委托/full 自动采纳 | ADR-0033/0035 保留 tentative-first、无模型 adopt/canon_write；VS-00M §7.3 是拟冻结目标 | **待产品语义及持久生命周期裁决**；模式选择不是任意对象采纳授权。B89 A01–A08 在现存 gate/receipt/事务上补齐，A03/A06 必须证明签发、继承、撤销、到期、并发和范围；未批准前保持现役采纳边界，不能把 map 字段当已实现委托；不作为 B87 保留批次的建设前置 | 作者设置 → Gate → Adoption |
| 自动采纳对象与批准主体 | ADR-0020 明确禁止自动采纳/递归修订；32 §5.1/§11.1 固定当前作者批准主体，§13.1 仅允许 LOW maintenance 进入自动采纳候选，HIGH/CRITICAL 仍人工，且不增第八种 adoption 状态 | **待冻结裁决**；B89 A06/A07 必须对正文/修订/维护分别审查委托是否形成合法例外，保留 sibling、只读 evaluator、一次动作边界及真实审计主体。不能以“已有 auto_adoption_hint”推定 full 已合法，也不能直接删原保护测试 | ProseRevision/maintenance/ApprovalAudit/Adoption |
| 三 wire 流式格式 | 现役 `SSEStream.ChatDecoder`、`ResponsesDecoder`、`AnthropicDecoder` 已分开；见下节官方协议 | **技术纠正** §6.1：共享终态语义，不共享 Chat 字段布局；不改 Frozen 原生保真原则。R07 校验真实 SSE 和重组结果边界 | 三 adapter/流式证据采集 |
| 旧接口与旧证据 | ADR-0035 决策 9/迁移章节、B87 §2.1 | **保持**无历史兼容：各任务的当前消费者迁完即删对应旧入口/专属测试；原始失败证据与真实作品数据不随接口退役销毁 | B87 R17；B89 自身清理与最终集成签收 |

“待冻结”是有明确承接点的设计差异，不等于整项审计无法完成，也不允许后续实现越过该条件。R00 不把 Proposed 自动改成 Frozen，不为未确定的字段先创建迁移或 stub。

### 12.2 三 wire 流式依据

2026-11-13 核对 [OpenAI Chat 创建接口](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[OpenAI 流式响应指南](https://developers.openai.com/api/docs/guides/streaming-responses) 与 [Anthropic 流式消息文档](https://platform.claude.com/docs/en/build-with-claude/streaming)。Chat 的 usage chunk 在启用时位于 `[DONE]` 之前，中断可能缺失；Responses 使用类型事件；Anthropic 使用 message/content-block 事件和 `message_stop`。这些只是协议事实，不证明任一本地 vendor 或当前 decoder 已通过全部实测。

现役实现核对入口：`apps/novel_agent/lib/novel_agent/provider/sse_stream.ex` 及其 `chat_decoder.ex`、`responses_decoder.ex`、`anthropic_decoder.ex`。无原始 SSE 捕获的旧响应 JSON 只能用于已说明的重组层分析，不补造网络事件。
