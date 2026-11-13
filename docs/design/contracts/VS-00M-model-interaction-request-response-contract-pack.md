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

**内部标识与作者可见面（B86 缺口整体并入 B87 R06）**：`chapter:<uuid>` 等仅在结构化 ref 字段中出现，普通叙事和摘要使用作者能理解的名称；工具 narrative 字段不可夹带内部标识。遇违规**拒绝模型内容并回流有界纠错**，不把展示过滤后的文本伪装为模型原话。模型作者可见字节必须绑定实际 Provider 输出（`AgentNarrativeSource`、I1/N-NARR）；系统“本轮没有写入”等独立 `status_message` 只记录系统事实。不能把 `target_issue`、`capability_status` 先验预测塞给模型替其判断。

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
