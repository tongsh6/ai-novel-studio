# VS-00M · 模型交互端到端架构与治理契约（Issue #4 / B87）

> **完整 JSON 候选审查材料**：[阅读入口](model-interaction/README.md) · [字段规范](model-interaction/01-protocol-spec.md) · [候选 Schema](../schemas/model-interaction/README.md) · [覆盖矩阵](../acceptance/model-interaction-coverage.md)。源包基线为 `f13ff640`；本文件 `04492ea3` 新增的输出通道、tool result envelope、SSE 约束见 [归档差异](model-interaction/integration-notes.md)，仍由 B87 R00/R07/R08 对账。附件入库不改变本文件状态，也不覆盖下文 §6.1。

> **状态：Proposed · 2026-11-13 系统性重审稿（设计已落文档，尚未实施、尚未宣称 Frozen）**。本次作者明确授权彻底审核和修改设计/任务文档，确认**项目未发布、无需历史兼容、要求 clean、禁止不经存在性审查新增实体/设计**。R00 完成 Frozen 契约影响审计与设计决策后再进行正式冻结；不能把本稿直接当现网实现事实。
>
> **设计真源**：本文件只负责“模型请求材料—Provider 往返—系统校验—授权/采纳—审计”的增量契约；[VS-00L](VS-00L-authoring-run-transcript-request-ir-contract-pack.md)（Frozen）、[VS-00I](VS-00I-prompt-prefix-stability-contract-pack.md)、[ADR-0033](../adr/ADR-0033-authoring-run-transcript-request-ir-v3.md)、[ADR-0035](../adr/ADR-0035-session-scoped-canonical-authoring-context-v3.md)、[产品愿景与元原则](../00-vision-and-engineering-roadmap.md#24-创作信息获取元原则最小供给按需求证证据闭环2026-10-27-用户拍板) 高于未经批准的本文件字段草案。与 Frozen 不同处在 §8 单独列出，**先裁决后改**，不偷偷实现。
>
> **任务唯一状态源**：[B87](../../../tasks/slices/B87-model-interaction-request-projection.md)；[B86](../../../tasks/slices/B86-structured-model-materials-internal-ref-isolation.md) 的 C9 未完成后果并入 B87 R06，原失败证据不销账。**不建立第二套 ModelInteraction 持久事实源、Agent loop、Provider adapter 或能力注册表。**

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
- **完整修订基线按实际供应选择载体。** 独立真实路径审查确认：同轮完整原生读页已经进入 Writer 请求时，PendingArtifactWorkflow 再拼一份 fresh 全章会重复供给。将 ChapterRevisionScope 已有且唯一的章页解析、source hash、版本合并与连续范围规则迁入纯 Application 的 ChapterReadEvidence；ChapterRevisionScope 只负责作者授权与判断编排，PendingArtifactWorkflow 负责材料载体选择和 Task 元数据。证据 owner 的 bind_target_segments 只接受当前作者输入之后的真实原生页；supplied_baseline? 消费 RequestIR.visible_observations，核对同章、fresh accepted 全版本集合、全文 hash、完整字符/UTF-8 字节范围及逐页真实正文字节。两者共享页算法但不共享观察时点，不能把旧可见正文误当本轮模型选段依据。完整供应已成立时，修订请求不再注入全章副本；材料元数据指向实际观察，保留本轮修改范围与 expected_base_versions，原生叶不额外升为 Base，应用叶保持原 provenance。证明不足、缺页、旧版、错章、隐藏页或仅元数据时仍完整供应 fresh 基线。首页的计划/摘要预览 omissions 不否定已经核实的正文范围，也不因此升级设计材料。材料复用不改变当前作者授权，完整内部基线与最终采纳校验保留；不删当前回合历史、不改 Compaction 保护、不做拼完正文后的字符串去重。实际请求新增专业 Scope 不产生 checkpoint，已核可见叶继续经三 wire 投影；该性质由真实 DPS→读页→PWF→Real 回归验证。
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

**外部验收职责。** R05 以既有原生 AX 单次输入路径覆盖章数、质量、角色、目标段、整章、风格六类，冻结输入/种子/预算与独立判据见 B87 §16.3。场景合法性只有现 capture owner 的显式登记；batch/prepare/readConfig共用，不能各自复制白名单。现 request-facts/live-refs只从真实当前请求抽取可见材料，partial与应用来源保持，累计ref不授信；现G2页/版本/used-ref算法复用。四新场景的纯判据组合归窄 authoring_r05_evidence，现live/native evidence是真实消费者；不新建harness、reader、成本账本或产品hook。请求构造字节与实模usage分别报告，没有配对before调用不宣称Token降幅，应用供给、作者页面与文学效果分别核账。

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

### 5.4 Scope 去冗余与显式压缩（重要的 Frozen 冲突边界）

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

**现役判断与计划的单一正文（B87 §16.23 裁决）**：普通 reply 仅消费原生 content；ask_author 仅消费 question；其余判断工具、continuation_decision 与 agent_plan_draft/agent_plan_revision 仅消费已有 author_reasoning。judgment_decision/continuation_decision 的 reason 字段退役，工具响应另带非空 content 作为第二作者正文须拒绝并闭合原调用；不能优先选取一份、清洗或补写另一份。作者说明不得兼任执行效果的关键词开关，同一结构化只读动作不因“不会保存”等措辞改变资格。计划选择、结构及说明由现 agent_plan_draft 单调用承担，judgment_decision 的 plan 动作与强制双工具组合退役；现 run.goal、计划版本/已完成前缀、inline_plan_meta 与 plan_drafted/plan_revised 的实际职责保留，不增加无消费者的 plan dialogue_goal 副本。Provider/IR 原始记录仍完整保真，历史证据不改写；规则不承诺一般自然语言语境的机械正确，实际作者效果仍需独立验证。

**判断 action 的职责边界（B87 §16.25/16.26 裁决）**：explore 只表达实际读取请求与唯一作者说明，不再要求或接受 dialogue_goal；执行动作仍以非空 dialogue_goal 服务真实创作目标与范围，注册和能力缺口工具的同名字段按原职责保留。JudgmentDecisionToolContract 是完整 action 分支、字段说明、示例与动作纠错的唯一 owner；JudgmentToolContract 组合工具目录并持有通用闭合接收及字段错误详情，按原始 action 消费同一分支，不相互回调；保持根 object wire 形状，完整分支接收拒绝跨分支字段及未知 action，不能从平面可选字段推断另一分支被接受。原始非法参数保留并回流原有有界纠错，不清洗后接受；explore 的规范化结果不复制无消费者目标。作者说明服务作品、实际材料及创作目的，真实歧义只有影响作者判断时才解释；不得要求逐步复述内部观察或绑定过程。此约束不新增一般词禁用或模型原文改写，真实语言效果须经独立模型场景审读。 Responses 在现投影处显式发送 strict:false，避免供应商默认严格化将平面可选字段自动升为必填；应用完整分支校验保留，其他 wire 不新增无需求的严格配置。

**只读取材的共同预算（B87 §16.24 回归裁决）**：单个计划包装不改变读取资格。直接explore与只读计划内联共用同一纯资格政策。存在性审计确认AgentRunBudget只管已起草计划的执行成本与作者上限，ChapterListBudget只管目录投影，均不能承载读取资格；将已从DialoguePlanningService收拢的2次普通读取、最多8次真实续读、开放工具和计划只读分类从执行服务分离到单一ExplorationPolicy，原位置实现退役。ExplorationService继续拥有真实读口、稳定目录及同源query/续页坐标比较，Policy仅消费其纯接口而不执行读取；Scope预算形状保持，不新增配额状态、循环或登记表。JudgmentProtocol在接受前按整批实际读取步骤校验，DialoguePlanningService执行边界再以当时真实observations重算并调用同一门禁。context_assemble/character_roster已准备的机械步骤不消耗读取额度；其余实际读取不得超过当前剩余额度，当前只允许续读时最多提出一项，且须对应上一真实页的next_offset。尚未执行步骤的预期分页不能提前授予额外续读额度；不通过的计划按原call_id失败闭合并有界纠错，不部分执行、不隐式重置预算。包含创作动作的计划继续走现JudgmentPlan运行时与效果门禁；只读取材完成后回到判断，不为适配旧测试伪造创作或重规划。

**现役创作返回的接收资格（B87 §16.23 裁决）**：模型返回 used_context_refs 是待验声明；现 CreativeProvider.Real 在同次 NativeToolExchange 接收口，基于 Operation.prepare 后实际发送的 IR，复用 RequestIR 引用资格判据核 used⊆Base∪Observation。坏形状、未读、跨调用和 source-only 作者引用不能被过滤成空声明或升级授信；错误保留原输出与失败回执，进入既有有界纠错，未接受候选不外发。事后 EvidenceUsage/unbound 只是审计，不代替接收门禁；其原生观察集合也须消费同一 RequestIR.usable_observation_refs，包含已登记、实际可见的 content.observation_ref，不能在接收成功后又因只读 source_refs 而将合法观察身份记为 unbound；应用读取仍归 Base，不向任务材料或 Base 补登观察身份。接收时的 Observation 资格须来自该次请求经过现 Compaction 投影后仍实际可见、有效的观察，且引用已登记在同请求中；独立 observation_refs 目录、只含tool/query及空facts的关联元数据、失败聚合下的成功叶、失效/不可用结果和已被覆盖的旧观察均不能授信。沿现 AuthoringTaskBuilder.read_content? 的实际供给判据迁入共同 Observation owner，供接收与事后材料归属共同消费并退役原副本；有真实摘要或事实计数的空读结果仍是观察，不以正文非空替代是否已读。ok/partial/truncated 中实际已供应的部分可作为使用声明来源，原 coverage、omissions 与状态仍须保留，不升级为完整读取；stale/unavailable 不能授信。复用现 RequestIR.Observation 的可见遍历与 RequestIR 的集合资格判据，不把新返回声明的当前可用性检查混进历史记录完整性校验；Base 引用也不因历史存在观察而被错误要求必须使用观察。现 creative item 的 rationale 是给作者的说明，复用 Common.AuthorVisible.Text 的现有结构资格；title/body 的创作职责独立，不施加一般词封禁。应用生成的角色卡工程 rationale 在已有 Presenter.body 完整表达效果时退役，不增补平行说明或来源。判断、计划与Writer需要的短语言规范由既有 Common.AuthoringSemantics 统一承载，原应用规则出口同步退役，避免反向依赖和规则副本。

**Base 的实际供应归属（B87 §16.24）**：已有 Operation/AuthoringTranscript 的 base_refs 参数由实际材料 owner 给出，须以同名元数据绑定到真正承载材料的 canonical application_base 或 scope_update 消息，不能只并入累计目录。此绑定定位既有供应事实，不创建新材料实体；IR.refs.base_refs 仍是历史登记索引，当前可用集合由现 RequestIR 对 Compaction 后可见消息的明确绑定与登记集合求交，Real 接收和 TurnExecutionService 审计消费同一投影。普通 source_refs、作者/模型/工具消息、checkpoint及纯职责说明均不能替代 Base 供应；缺少绑定不从历史目录、业务 payload 或关联来源猜回。首次操作的材料属于初始 Scope 时，绑定该 Scope，不能复制到永驻职责 Base；纯文本操作的实际材料可直接绑定其 application_base；带材料绑定的消息不能没有内容块，application_base 还须只包含实际会投影的非空白文本，不能以被投影丢弃的结构块冒充材料。计划、使命、专业写作及当前判断均复用现共同构造入口，不新增各类业务 payload 的 Base 解析器。应用 planned_exploration 的供应仍须共享现 Observation 状态/实际内容资格，失效、不可用或仅关联元数据不得因登记了消息绑定而升级。相同 ref 只要仍由另一条可见实际材料消息供应就保留；所有供应消息被覆盖后即不可再声明。当前返回声明通过现 RequestIR.validate_used_refs 复用既有集合判据，不能把完整历史IR的登记表替换成可见子集后再做历史校验。历史原文、压缩选择器和已有登记不改写，持久消息完整保存该事实，不加历史兼容推断。

**外部请求证明与作者身份（B87 §16.24）**：外部 reader 复用同次 ProviderCall/ProviderRun 的完整 canonical 可见前缀与实际请求逐条配对，角色、来源、顺序、工具展开、Scope 完整 JSON 与 checkpoint 选择/覆盖均有对应；不能用应用消息子序列、文字前缀、全文相同或出现标记代替完整证明。会话历史中的初始 Base 只取该 ProviderRun 所属 agent_run 的 Base 并供应一次，其余消息原序保留，原始行和覆盖证据不改写。Base 的明确绑定与同次登记集合只有在上述配对成立后才授信；作者可以完整引用应用材料，不因同文碰撞失去真实 author 身份。可选首条 system envelope 不授 Base，也不能据此声称其内容已全部逐字核实；未知块或不支持的混合 checkpoint 形状明确失败。成本 reader 与 R05 验收共用这一作者定位，已核定的本轮 user index 优先分类为 CurrentAuthor，计数/occurrences/Scope 统计保持同一归属，实际请求原文与总字节不变。此规则不替尚未具有完整 canonical 证明的其他历史批次补身份或签通过。

**交换预算与实际消耗**：沿VS-00L §16.7保留两种已有语义：provider_call_budget为本次操作允许的上限，execution_counts为session记录的实际消耗。Writer的接收纠错属于同一NativeToolExchange，不在外层再开循环；TurnExecutionService的trace预算须消费该既有交换owner返回的有效上限，不能仅因存在Provider回调就写成1，也不能把实际重试次数回填预算。一次成功与两次纠错可有相同允许上限、不同真实消耗；原始调用身份各自保留。运行流程统一通过现AuthoringSession的实际计数投影消费trace_summary.execution_counts，不再从trace预算求和或按工具名猜成1；五份预算求和副本、角色设计硬编码与确认流程的局部getter收敛到该唯一投影。缺失实际消耗不以预算补造，AgentRunServer仍按实际步增量与真实Provider事件下界累计，不改运行累计owner。

**引用与错误**： `alternative_operation_refs` 必须为真实 capability ID，描述去 `author_reasoning`；`used_refs ⊆ base_refs ∪ observation_refs`；不允许跨作品伪引用、未查实空列表、无 call_id 的假 Observation、tool 伪 XML、同一调用仅局部闭合。不合法必须拒绝/明确失败与必要可恢复状态，不能吞掉错误或绕过门禁。

### 6.1 输出通道与工具结果的硬约束

- **作者可见通道唯一**：当响应携带 `write_candidate` 等作者可见正文工具时，`content` 必须为 null；作者可读说明只走 `change_reason`/`coverage_note`。应用必须校验，出现 `content + 候选工具` 即 `contract_violation`，不生成候选并回流有界纠错；不能只靠 system prompt。
- **工具结果 envelope**：所有工具结果必须为 `{ok, data, error_code, message, retryable, observation_ref, budget_after}`；失败不得伪装成成功，`retryable` 必须真实；应用校验/执行/采纳事实不得合并为一个 `success`。
- **流式一致性**：本项目 HTTP 请求 `stream: true` 时，wire 证据必须来自实际 SSE，不能以应用重组 JSON 冒充原始流。三类 wire 各按自身协议判定：Chat Completions 为 `chat.completion.chunk`/delta、`finish_reason` 与 `[DONE]`（支持且请求 `include_usage` 时另有 usage chunk）；Responses 为带类型的 `response.*` 事件，区分 `response.completed`、`response.incomplete` 和失败；Anthropic 为 `message_start`、内容块增量、`message_delta` 与 `message_stop`。不得要求 Responses/Anthropic 产生 Chat 专属字段或 `[DONE]`；缺用量不能伪填实测 0，流中断不能当正常完成。依据与现役归属见 §12。
- **协议包结构化**：`application_base`/`scope_update` 的 goal/target_refs/permissions/budget/coverage/output_contract 在应用内部是结构化值，wire 只是序列化视图；工具越权、预算耗尽、target 不在 observed_refs 等校验读内部结构，不读模型复述。
- **decision 不塞给模型**：应用解析 `tool_calls` 生成 `decision {type,target_ref,tool_call_id,modification_scope,source_refs,evidence_coverage}`，与 tool result 一起进入下一轮 loop；HTTP 响应不新增自定义顶层字段。

## 7. 授权、风险与采纳：完整安全模型（替代旧 R10 巨型任务）

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

- 来源基线：既有 `CapabilityRegistryEntry.risk_class`，不是另造新 `RiskClass` 表；动态调整由已有应用权威 gate 的纯规则对 `capability/effect/target/context` 决定。改写已采纳正文、结构重排和核心设定等实际影响需区分；风险的差异必须可重算、可测试、可审计。
- `MicroPlan.risk_hint` 是模型提示，不是权威风险；`ApprovalAudit` 的风险审计应记录最终系统计算结果，不再维护不同来源的“全部 HIGH”等平行推导。
- 已有 `capabilities` 分为 **系统注册能力**、**run 可建议效果**、**执行权限**、**采纳授权**。仅把当前可建议/必要只读探索最小信息送模型；完整 registry 可经真实现有探索通道查询，`capability_lookup` 如无真实消费不要先行新增。

### 7.3 模式语义与决策表（拟冻结）

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
- `smart` 不得引入第二 Agent 或规则引擎；只有能用现有 run/风险/委托事实定义可重算策略时才发布，未知/歧义保守退回确认，**不是临时跳过该批就把整体任务标 done**。

**R00 冻结冲突补记**：上述 `full` 目标尚不能覆盖 [ADR-0020](../adr/ADR-0020-prose-quality-finding-and-revision-candidate-boundary-v3.md) 的修订/自动采纳边界，以及 [32 §5.1/§11.1/§13.1](../quality/32-human-approval-policy.md) 的现行 HIGH/CRITICAL 人工采纳、批准主体与 maintenance auto-adoption 约束。R14/R15 必须先明确哪些对象/effect 可被作者事先委托，并逐条修订受影响 Frozen 条款；未裁决前仍执行原边界。`auto_adopted` 若用于未来审计，只能表示实际系统来源/命中策略，**不是新增 adoption_status**；采纳仍使用既有七态，不能写成作者本人点击批准。

### 7.4 持久化/授权实体红线

`AgentRun.authority_scope`、`AgentRunPolicy.allowed_tool_refs`、`ConfirmationBinding`、`AuthorActionReceiptRepo`、`ApprovalAudit`、作品/会话配置是已经存在的起点，**不等于它们已经支持长期委托的授权生命周期**。

R00/R11/R13 必须按“现存表/列/状态/消费者/事务”评估能否承载模式与委托。只有可机械证明无法在现存语义中正确表达授权范围、撤销/并发和审计时，允许**最小必要新实体**，并附替代方案比较、唯一生命周期、消费链和退役清单。禁止先创建“通用 Authorization 服务表集”。

## 8. 与冻结设计的差异及先决裁决

| 差异 | 当前已存在基线 | 实施前门槛 |
|---|---|---|
| 纯对话/旧 Scope 去冗余 | VS-00L/ADR-0035 只认可特定显式 checkpoint/closed tool exchanges；canonical 不删改 | R00/03 明确检查 `covers` 的正确性；如需新覆盖语义先补 Frozen 契约/ADR，连同三 wire/恢复/回查测试一起决定 |
| 请求材料从文本到结构化 | RequestIR 已有 message+block，但很多 `scope_update` 仍是长文本 | R02 给出现有 IR 消费者/真实 Provider 展开方式；必要时直接重构现役 schema，删旧拼串分支；不做双轨 |
| 作者可见引用泄漏 | B86 真实模型 C9 失败与两次已撤回实现 | R06 以结构化来源+作者可见字节验证闭环；保留历史失败案例但不保留已撤回代码的兼容 |
| 授权模式/委托/自动采纳 | Registry 风险基线/Orchestrator/Confirmation/Adoption 已存在，**完整委托能力尚未核实存在** | R09–R14 先冻结授权行为/生命周期，不得以纯文本声明或模型自报代替实际审计与事务；只改现存消费者所需对象 |
| 快速迭代 clean | 未发布；ADR-0035/VS-00L 已批准不做历史兼容 | 现行代码/Schema 允许无兼容迁移，旧入口在全部实际消费者转移后删除；仍保留用户已创作数据和历史证据的安全边界 |

**作者授权范围**：2026-11-13 已明确授权**修改设计与任务文档并进行整体性重审**；不代表本文件可以无证据宣称实模行为、数据库事务、作者自动采纳已实现，也不自动替代对 Frozen 契约有实质语义改变时必须留下的裁决和证据。

## 9. 验收口径：从证据到真实创作

**机制证据**：结构化输入的 provenance/身份/版本/覆盖/省略；静态 schema/运行时权限不同源的负例；不合法工具/文本引用 fail-closed；重复或交错 checkpoint；跨作品与 stale；真实事务 rollback、撤销、重复提交。

**原生/真实页面证据**：同一作者真实 Tauri 工作台连续输入 3/10/20 轮，真实新消息与 checkpoint 投影；统计查询不读无关正文、纠错讨论不误执行、明确操作正确处理效果缺口；同一会话跨 run、恢复/取消、采纳/自动采纳/拒绝及作者可见状态。外部驱动不植入产品特殊验收分支。

**实模证据**：同源模型/provider/推理预算、样本冻结和请求 A/B；测量 input/output/cached_tokens、TTFT、latency、Tool Call 正确率、事实引用正确率、候选可追溯与作者负担。cached_tokens 是 input_tokens 子集，不能另加；以多个样本/重复试验区分模型性能波动。写作质量必须有正常小说章节材料的连续性、情绪铺垫、目标外正文保真/文学盲评，不能用短 Token 指标代签。

**强制回归**：`mix check`、`mix test`、xref、arch_check、I1/I2/I3、N-NARR、I-CACHE、B71/B81、当前质量清单/真实 Tauri、三 wire；任何 FAIL/BLOCKED 均不算最终 PASS。外部供应商无法测试时明确 known-gap，不声称完成全部支持。

## 10. 实施、替换与退役策略

- 按 [B87](../../../tasks/slices/B87-model-interaction-request-projection.md) 单会话独立批次实施；先重新读取当前分支 HEAD/WIP 与事实/实体审计，再改。
- **不兼容历史产品协议**：无 legacy adapter、双写、旧工具 schema fallback、临时开关和“未来过渡”分支；现存消费者同批迁移且删旧入口/旧专属测试。代码变更与完整行为验收同批完成。
- **不是破坏式清空作者资料**：即使未发布，真实作品/会话/已采纳内容/审计证据的丢弃仍需明确告知与备份/数据重置授权；禁止用“无兼容”掩盖误删用户创作事实。
- 结束时盘点新的/退役的 module、struct、表/列、schema、工具、配置、路由/事件、测试 fixture；新增的均须回答“为何现存不能用”，退役的均不得留零消费者/僵尸适配。
- 唯一任务状态在 B87；本设计文档不复制 Rxx 状态，`tasks/NEXT.md` 只记录排期，验收/历史批次可在现有 artifacts/ledger 登记。

## 11. 本次设计重审摘要（2026-11-13）

保留：四层逻辑闭环、作者主权、真实来源、源头结构化、场景化验收，以及已记录的 manual/risk_based/full/smart 和 critical/full 用户体验目标。

纠正：不新增平行 Request、Capability、Approval/Adoption 存储；不把 `critical` 当越权豁免；不让 manual 的“每一步”与只读操作矛盾；不让 full 自动采纳绕过独立采纳边界；不提前将 `capability_lookup` 写为已存在工具；不让旧 B86 与 B87 双持任务真源；R10 拆分而不是挤进一次会话；最终 A/B 与实模验收放所有功能变更之后。

## 12. R00 增量契约审查（2026-11-13；不自动冻结）

本节区分**已核实的技术事实与工程处置**、**尚需冻结的语义改变**。本次 NEXT 推进授权允许审查后实施；它不构成作者已经选择未裁决的产品权限语义的证据。执行结果和质量状态只记 [B87 §9](../../../tasks/slices/B87-model-interaction-request-projection.md#9-r00-执行记录2026-11-13)。候选包仍保留固定源基线，不逐份覆写历史 fixture 来制造一致。

### 12.1 冻结差异处置表

| 差异 | 当前可核实依据 | 唯一处置与实施前条件 | 首个消费者 |
|---|---|---|---|
| 第二 Request/Exchange/ModelInteraction 主模型 | VS-00L §4/§16.1、ADR-0035 决策 1/2；候选规范 §2 明确 Exchange 只是离线容器 | **禁止**新建平行聚合/存储/控制环；候选四层视图只能映射现役事实。R02 在现役 IR 细化，不能照搬候选 Request 顶层替换主链 | Judgment/专业创作 |
| Scope 的事实/来源/覆盖结构化 | VS-00L §19.2 已区分 application_base/scope_update/author；候选 Source/Material 是建议表达 | **修改现役归属**，R02 逐字段对账、明确版本与全消费者迁移后实施；保持作者原文独立，不制造 Observation；不另建 ContextBlock 总线 | ContextAssembler → JudgmentProtocol → RequestIR |
| 纯讨论或旧 Scope 的显式覆盖 | VS-00L §16.2 要求非空 `covers.call_ids`；`RequestIR.Compaction.require_call_ids/1`、`project/1` 只选择 assistant/tool 的交换 ID；ADR-0035 决策 3/4/10 | **待冻结裁决**：现行契约不能承载 Scope/无工具回合覆盖。禁止伪造 call_id、仅用 turn_range 或直接过滤旧 Scope。R03 必须先修订选择器/来源/义务保留/提交失败/恢复契约及版本、负例矩阵，所有三 wire 同批迁移，不新增第二压缩器 | SessionHistory/Compaction/Replay/三 wire |
| `write_candidate` 与现役候选工具 | 候选包规范 §7 和现役 creative 工具使用 `submit_tentative_artifact`；新用语不能证明缺少工具 | **复用/重构并退旧**；`write_candidate` 在 §6.1/R07 只是待映射用语，不授权新增同义工具。R07 在现役工具上落实输出互斥，若改名必须先列全消费者并同批删旧名，不双注册 | NativeToolExchange/ArtifactAssembler |
| `change_reason`/`coverage_note`/`paragraph_only` 与 `rationale`/`target_segments` | 候选包 §4.3、§7 与 §6.1 使用不同字段；来源字节约束仍为 Frozen I1/N-NARR | **待字段级冻结**；先证明哪些是相同语义、哪些是新增覆盖声明，不直接把说明字段当正文或用应用补写。R07/R08 同步 schema、解析、正文范围、作者出口和反例；本批不造字段 | Writer/局部修订/作者可见卡片 |
| 统一七字段工具结果 envelope | VS-00L §16.5/§16.7 区分 observation、validation_result 和真正执行；候选 ToolResult 不等于现役领域 ToolResult | **修改现役契约前先对账**；R07 为各结果类型给出七字段来源及不适用值、原 call_id 与重试语义，保留验证≠授权≠执行≠采纳，不新建一套响应事实。校验反馈不得伪造 observation_ref | Judgment correction/三 wire/Replay |
| target / source / observation 引用混用 | 候选规范 §4.3 区分 scope.refs、material_refs、observation_ref、provider_call_ref；§6 约束 used_refs | **保持分界并澄清集合**；R07 冻结 `observed_refs` 的来源与覆盖含义，不能拿目标 ID 或“可读取”冒充已读，也不能把 observation 身份与领域目标 ID 作字符串集合比较；真实 Base 与真实观察分别校验 | Ref 校验/修订目标范围 |
| `decision` 派生结构 | 已有 Judgment/AgentPlan/ToolResult/DecisionTrace；候选 Outcome 是观察视图 | **复用现有结果和 trace**；是否需要新字段以真实 caller 为准，禁止新建决策器/持久 Decision 真源；Provider HTTP 不新增自定义顶层业务字段 | JudgmentProtocol → Orchestrator |
| 四种权限模式/委托/full 自动采纳 | ADR-0033/0035 保留 tentative-first、无模型 adopt/canon_write；VS-00M §7 是拟冻结目标 | **待产品语义及持久生命周期裁决**；模式选择不是任意对象采纳授权。R09–R16 在现存 gate/receipt/事务上补齐，R11/R14 必须证明签发、继承、撤销、到期、并发和范围；未批准前保持现役采纳边界，不能把 map 字段当已实现委托 | 作者设置 → Gate → Adoption |
| 自动采纳对象与批准主体 | ADR-0020 明确禁止自动采纳/递归修订；32 §5.1/§11.1 固定当前作者批准主体，§13.1 仅允许 LOW maintenance 进入自动采纳候选，HIGH/CRITICAL 仍人工，且不增第八种 adoption 状态 | **待冻结裁决**；R14/R15 必须对正文/修订/维护分别审查委托是否形成合法例外，保留 sibling、只读 evaluator、一次动作边界及真实审计主体。不能以“已有 auto_adoption_hint”推定 full 已合法，也不能直接删原保护测试 | ProseRevision/maintenance/ApprovalAudit/Adoption |
| 三 wire 流式格式 | 现役 `SSEStream.ChatDecoder`、`ResponsesDecoder`、`AnthropicDecoder` 已分开；见下节官方协议 | **技术纠正** §6.1：共享终态语义，不共享 Chat 字段布局；不改 Frozen 原生保真原则。R07 校验真实 SSE 和重组结果边界 | 三 adapter/流式证据采集 |
| 旧接口与旧证据 | ADR-0035 决策 9/迁移章节、B87 §2.1 | **保持**无历史兼容：当前消费者迁完即删旧入口/专属测试；原始失败证据与真实作品数据不随接口退役销毁 | R17 clean audit |

“待冻结”是有明确承接点的设计差异，不等于整项审计无法完成，也不允许后续实现越过该条件。R00 不把 Proposed 自动改成 Frozen，不为未确定的字段先创建迁移或 stub。

### 12.2 三 wire 流式依据

2026-11-13 核对 [OpenAI Chat 创建接口](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[OpenAI 流式响应指南](https://developers.openai.com/api/docs/guides/streaming-responses) 与 [Anthropic 流式消息文档](https://platform.claude.com/docs/en/build-with-claude/streaming)。Chat 的 usage chunk 在启用时位于 `[DONE]` 之前，中断可能缺失；Responses 使用类型事件；Anthropic 使用 message/content-block 事件和 `message_stop`。这些只是协议事实，不证明任一本地 vendor 或当前 decoder 已通过全部实测。

现役实现核对入口：`apps/novel_agent/lib/novel_agent/provider/sse_stream.ex` 及其 `chat_decoder.ex`、`responses_decoder.ex`、`anthropic_decoder.ex`。无原始 SSE 捕获的旧响应 JSON 只能用于已说明的重组层分析，不补造网络事件。
