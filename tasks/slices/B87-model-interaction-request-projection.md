# B87 · Issue #4 模型交互体系系统性重构：实施总计划与唯一任务状态源

> **补充评审输入（不改变任务状态）**：[完整 JSON 协议候选包](../../docs/design/contracts/model-interaction/README.md) 已按现有 SSOT 目录归档；Schema、合成正反例、字段/状态说明和离线验证互相可达。它保持源基线 `f13ff640`，与 `04492ea3` 的增量差异见 [归档说明](../../docs/design/contracts/model-interaction/integration-notes.md)。R00/R07/R08 先对账，不将离线 PASS 当作本任务任何批次完成。

**状态**：**doing（2026-11-15：R00 已提交 `465b1a3f`；R01 可靠测量基线及工程实现已收口，证据与限制见 §11.21；R02 已 PASS，产品跨层投影、真实 B26 选择/自由答复、三 wire 机械等价及冻结 Splash 三轮的源事实/作者原文/身份对账已闭环，最终验收见 §13.10。外部证据修复提交 `90252001`，共用 seed UTF-8 修复提交 `3c66fc91`；第二/三轮业务目标未实现、模型语义与页面状态/内部身份问题仍按既有 R06–R09 保持开放。R03 已进入目标/契约审查（§14），R04–R19 未实施，远端 CI 与既有全仓质量缺口仍开放，B87/Issue #4 未完成）**。

- **排期（2026-11-14）**：作者决定 B84 退出当前任务队列，B87 提为 [NEXT](../NEXT.md) 当前任务；R01 测量实现质量门与最终提交优先收口，随后按原依赖推进 R02–R19。调度变化不改变 R00–R19 的验收范围或证据状态。

- 目标分支：`develop/dialogue-based-novel-workbench`；执行时以最新 HEAD 为准，不使用 2026-11-11 的旧日志推断现状。
- 关联：[Issue #4](https://github.com/tongsh6/ai-novel-studio/issues/4) / [VS-00M 唯一增量架构契约](../../docs/design/contracts/VS-00M-model-interaction-request-response-contract-pack.md)（Proposed 重审稿）/[VS-00L](../../docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md)（Frozen）/[ADR-0035](../../docs/design/adr/ADR-0035-session-scoped-canonical-authoring-context-v3.md)（Accepted）。
- 本文件是 **唯一执行状态真源**；[批次 README](B87-model-interaction-request-projection/README.md) 定统一执行门禁，各 `Rxx.md` 只给该会话的目标/范围/验收，不登记独立进度。索引/NEXT 只导航。
- 作者 2026-11-13 最初授予**设计与任务文档调整**权限，原则为：**未上线、无历史兼容、彻底重构保持 clean、所有新实体/设计先查重、践行 SOLID/DRY/KISS/YAGNI/SoC 等原则**。当时仅文档落地，**不等于当时已授权并执行生产代码/数据库修改**；本次后续授权见下条。
- **后续授权（同日，本次 goal）**：作者授权高质量推进 NEXT，要求先整体审查设计再实现，并明确使用 dsh-worker。此前“仅文档”的授权记录保留为历史事实；现在可按任务契约推进实现，但不据此把 Proposed 方案、自动采纳产品语义或未运行验收记成 Accepted/PASS。当时先完成禁止生产修改的 R00；当前实施批次以本文件状态与 §13 为准。
- **实模资源授权（同日，本会话）**：作者明确“授权使用 splash”。B87 后继按固定预注册使用 Splash 做实模基线/回归/真实页面；无需重复申请同一供应商使用权限。授权不等于预注册、实际运行或 PASS，也不允许更换样本、修改分母或覆盖失败证据。

## 1. 为什么重排

旧 R00–R10 有三项结构性问题：
1. 旧 R10 把已存在的能力注册表、风险基线、确认门、采纳边界当作一个全新“授权层”去重造，且合并风险分级、模式、数据存储、确认、自动采纳，无法在一次编码会话完整自证；
2. 旧 R09 提前做“最终发布判定”，新 R10 仍会随后改变执行/采纳权限，导致验收对最危险的后续变更**未覆盖**；
3. 旧 B86 与 B87 同时声称负责“结构化模型材料与作者可见字段”，双状态源风险；B81 已 done 的机制/G6 在旧计划仍被当作“未实现前置”，状态漂移。

本次方案是**完整重构目标 + 单会话可交付的小闭环 + 系统级最终全量验收**，并非接受原有实现问题或用“兼容历史”降低架构要求。

## 2. 全局硬红线与实现裁决

### 2.1 产品/架构不可妥协

- Dialogue-first / Agent-native，不退回关键词 Router-first；模型有自主求证职责，APP 是可信事实与执行门禁提供者。
- **唯一 Canonical**：会话 Transcript + AgentRun 段；**唯一 Request IR**：`NovelCommon.RequestIR`；三 wire 共享来源；不建“业务请求+IR”双主模型，不建第二 Run、第二 Workflow。
- 当前事实、作者要求、模型推断、真实 Observation、真正执行结果各有唯一来源；未读/过期/不完整必须如实传递。
- 提示词与工具 Schema、能力 effect、授权结果、采纳回执不得靠字符串重复定义权威规则；保留必要静态 System 规则和缓存顺序。
- 作者可见模型叙事字节绑定真实 Provider 输出（I1/N-NARR），系统状态另有系统来源；内部 ref 不泄漏。
- **越权/跨作品先拒绝；critical 再确认合法高风险行为；full 仍必须校验委托范围与真实采纳事务**，不可直接用模型建议/“提示用户已同意”写 canon。
- Writer 必要正文/章计划/文风/目标段不能为了缩 Token 被截断。正确性、文学质量、作者负担优先于成本。
- **未发布：零产品历史兼容承诺**。消费者迁移后同步删除旧 API、字段、代码、无消费者测试、adapter、冗余配置/Prompt，不留双轨或“暂且 fallback”；但不授权随意删除作者实际创作数据/原始质量证据。

### 2.2 新实体“先证明不存在”门禁（对**每一批**强制）

每个新增 `module/struct/DB table/column/tool/API/route/event/schema/policy/config/ContextBlock/checkpoint`，必须在该批开工报告列出：

| 项 | 证明要求 |
|---|---|
| 用户场景与首个真实消费者 | 不得只写“未来扩展性” |
| 全仓现有等价物 | 按符号/路径、调用者、字段与当前存储事实核查；尤其检索相关已退役设计 |
| 替代方案 | `reuse / refactor-and-retire / truly-new / reject` 四选一，解释为何现存不能胜任 |
| 与其他实体职责重叠 | 若发现双重真源，**先合并/退役**，不能继续增第三套 |
| 新对象的完整生命周期 | 创建、版本、身份、授权、并发、撤销/删除、失败、追溯、消费者、测试和最终退役旧入口 |
| 决策证据 | 可定位到代码和 Accepted/Frozen 契约；不得靠模型推测“不存在” |

**默认是收敛现役模块、严格重构并删除旧消费者**。允许在确有需求时新建必要实体（例如经审计证明现有持久结构无法表示可撤销委托），但绝不允许为图方便新增。

### 2.3 设计七原则的代码审查应用

- **SRP/SoC**：Request IR/会话历史、Context 派生、Provider wire、权限/风险、采纳事务、作者可见分别独立变更原因；不建包办一切的 Manager。
- **OCP/LSP**：从现有注册表扩展能力；Provider behaviour 行为语义一致；**不要用 OCP 为禁止改已测代码找借口**，修错误必须重构真实归属。
- **ISP/LoD**：判断/写作消费者只拿必要材料，Web/Provider 不越过直接契约读持久化或裁决作品。
- **DIP/CRP**：遵守 Umbrella 单向依赖，使用 Elixir 组合/behaviour 和纯函数，不造继承式抽象。
- **DRY/KISS/YAGNI**：唯一 Schema/风险/效果/错误真源；拒绝没有消费者的新规则引擎、跨 app 适配层、抽象仓库。

## 3. 已确认的现存实体审查结论（2026-11-13 设计阶段）

| 需求 | 已存在的实际模块（需每批复核 HEAD） | 架构裁决 |
|---|---|---|
| 会话与请求证据 | `AuthoringSessionHistory`、`AuthoringTranscript`、`AuthoringCheckpoint`、`AuthoringSessionLog`、`NovelCommon.RequestIR` | 复用/必要时**重构现役**；不建 ModelInteraction 持久模型 |
| 压缩/请求派生 | `TranscriptCompaction`、`RequestIR.Compaction`、`JudgmentProtocol`、`RequestIR.Projection` | 复用；纯对话/旧 Scope 的合法覆盖先核 Frozen |
| 业务 Context/专业 Writer | `ContextAssembler`、`DialogueContext`、`AuthoringTaskBuilder`、专业创作 flows | 重构当前请求组装；保留按需探索与正文基线 |
| 工具/能力 | `NovelCommon.CapabilityRegistry`、`NovelApplication.CapabilityRegistry`、`CapabilityRegistryEntry`、`JudgmentToolContract` | 消除重叠描述；动态 allowed/authorized 基于真实 run |
| 风险/确认/采纳 | `CapabilityRegistryEntry.risk_class`、`MicroPlan.risk_hint`、`GateOrder`、`ExecutionOrchestrator`、`ConfirmationBinding`、`AuthorActionConfirmation/Admission`、`ApprovalAudit`、`AdoptionWorkflow`、`AuthorActionReceiptRepo` | **先核各层责任与实际事务/持久化**，不凭空另建 RiskEngine、ApprovalRecord 或 AutoAdoptionService |
| 叙事与可见来源 | `AgentNarrativeSource`、`NovelCommon.AuthorVisible.Text`、`TurnResultBuilder` | 输入结构化 + 校验/有界模型纠错，不可应用改写模型字节 |
| 授权模式、可撤销委托 | `AgentRun.authority_scope`、`AgentRunPolicy`、作品/会话配置与现有 Receipt/Trace 仅为已知候选 | **尚需 R11/R14 的精确存储/消费者审计**；不是“已经支持完整授权生命周期” |
| 只读能力目录查询 | 注册表与现有探索工具存在，但专用 `capability_lookup` 未证实有生产消费者 | 先评估复用既有探索；无需求不造第八个工具 |

查重范围包括：已运行代码、当前测试、`docs/design/00f-capability-atlas.md`、`00c`、现有 ADR/Contract、已退役代码迹象；**索引存在不证明功能完整**。严禁只凭文档“已有”或“没有”作为裁决。

## 4. 改造主线与批次 DAG

```text
R00 存在性/契约核验 → R01 真实成本基线
   ↓
R02 结构化事实/来源 → R03 合法 Scope checkpoint → R04 三 wire 请求派生
   ↓                                                ↓
R05 按需取证与专业 Task Base                     R06 作者可见 ref 零泄漏（承接 B86）
   └────────────────┬────────────────────────────────┘
                    ↓
R07 原生工具/refs/结果闭环 → R08 讨论/修订/执行判界
                    ↓
R09 授权能力/效果同源 → R10 风险派生 → R11 模式持久继承 → R12 作者设置入口
                                                 ↓
                                           R13 critical 确认
                                                 ↓
                                   R14 撤销委托与生效范围
                                                 ↓
                                     R15 full 原子自动采纳
                                                 ↓
                                     R16 smart 保守确定性策略
                                                 ↓
R17 清理/删旧双轨 → R18 专业创作与采纳全链回归 → R19 真正最终实模/原生 UI A/B 验收
```

R05 与 R06 允许在不同工作树、**无同文件冲突**时按已通过前置并行；其它依赖按实际改动路径审查。任何历史 checkpoint、B71/B81 G6/C9 等失效证据不得作为当前 HEAD 成功证明。

### 4.1 独立批次导航（每批只开一个 AI 编码会话）

| 编号 | 唯一完成结果 | 独立执行任务卡 | 首个真实消费者/证明 |
|---|---|---|---|
| R00 | 完整架构/新实体存在性审计、冻结冲突与决策 | [R00](B87-model-interaction-request-projection/R00.md) | 可定位的符号/调用关系和裁决记录 |
| R01 | 原始请求成本、缓存、前缀和质量可复现基线 | [R01](B87-model-interaction-request-projection/R01.md) | 真实 Provider JSONL 与可重算报告 |
| R02 | 基于现役 RequestIR 的结构化 Scope/事实/来源 | [R02](B87-model-interaction-request-projection/R02.md) | 判断请求的真实投影，不能有伪作者/观察 |
| R03 | 纯讨论/旧 Scope 的**显式**覆盖、Checkpoint 与恢复 | [R03](B87-model-interaction-request-projection/R03.md) | Canonical、Replay、三 wire |
| R04 | 当前有效 Scope + 真实历史的无重复 Provider 视图 | [R04](B87-model-interaction-request-projection/R04.md) | 连续 3/10/20 轮多 wire |
| R05 | 最小可信 Base + 按需只读取证与专业写作材料 | [R05](B87-model-interaction-request-projection/R05.md) | Judgment → Explore → Writer |
| R06 | B86 C9 内部标识模型输入/输出/作者出口全闭环 | [R06](B87-model-interaction-request-projection/R06.md) | 真实 Tauri 页面 + 原生模型字节 |
| R07 | Tool call、refs、effect、response 与系统执行各归其位 | [R07](B87-model-interaction-request-projection/R07.md) | Judgment → Validation → Gate → Replay |
| R08 | 事实问答、讨论、纠错、执行的 Agent 语义可靠 | [R08](B87-model-interaction-request-projection/R08.md) | 真实三轮作者请求 + 负例 |
| R09 | Registry 基线/授权效果目录/实际 Gate 同源 | [R09](B87-model-interaction-request-projection/R09.md) | run 可建议集合 + Orchestrator |
| R10 | 有效 action 的动态风险分级与统一审计 | [R10](B87-model-interaction-request-projection/R10.md) | capability/effect/target + Audit |
| R11 | 授权模式继承/撤销/版本的真实持久事实 | [R11](B87-model-interaction-request-projection/R11.md) | 模式读写 + Run 权限派生 |
| R12 | 作者有实际设置入口与当前授权可见状态 | [R12](B87-model-interaction-request-projection/R12.md) | 真实 Workbench UI |
| R13 | Critical 合法高风险的明确确认/拒绝/re-gate | [R13](B87-model-interaction-request-projection/R13.md) | Confirm → Auth → Tool → Receipt |
| R14 | Full 委托的对象/effect 范围、到期/撤销、审计 | [R14](B87-model-interaction-request-projection/R14.md) | 真实用户委托入口 + Run 读取 |
| R15 | Full 自动采纳经现有事务门禁原子闭环 | [R15](B87-model-interaction-request-projection/R15.md) | 候选 → 再 gate → Adoption receipt |
| R16 | Smart 确定性策略/保守回退，无隐式自授权 | [R16](B87-model-interaction-request-projection/R16.md) | 同一矩阵 + 真实 UI |
| R17 | 删除迁移完成的旧拼串/重复事实源/兼容胶水 | [R17](B87-model-interaction-request-projection/R17.md) | 静态扫描/依赖/零消费者 |
| R18 | 专业创作、修订、质量、采纳、不泄漏回归 | [R18](B87-model-interaction-request-projection/R18.md) | 真实作者创作链、整章材料 |
| R19 | **全部变更后的**最终实模/Tauri A/B 与发布门禁 | [R19](B87-model-interaction-request-projection/R19.md) | 真实模型 + 三 wire + 全矩阵 |

> R00–R19 是**独立验收单元**，不是“一轮只写 Helper、下一轮再补测试”的横向拆包。每个改动作者体验的批次都必须在真实产品入口证明闭环。R00/R01 属事实与验收基线，可作为文档/测试类完成，其完成**不代表**功能最终完成。

### 4.2 外部依赖与非本 Issue 的责任

| 关联 | 已验证状态 / 责任 |
|---|---|
| B71 | 目前 `doing`；已存在 IR/三 wire 机制；G3/G5、供应商实模等应沿原任务承接；**不得为 B87 改写 B71 的验收口径** |
| B81 | 目前 `done`（部分历史 C9 由 B86 转交），已有跨 run 会话 Canonical/Checkpoint/Replay；**R03 只处理 B81 没解决的新 Scope 重复语义** |
| B86 | 原 C9 领域缺口、历史失败反例与目标**完整承接至 B87 R06**；旧文档标 `superseded`，不是标 `done`；同一开放后果只认 B87 |
| B85 | “模型上下文窗口用户设置 UI”独立任务，编号保持；本任务不得误覆盖其配置 UI |
| Issue #3 | 作者素材个性化，未来通过同一探索/来源机制消费；不在 B87 实现新素材库 |
| 卷纲误占章位 | 领域数据/采纳映射真实缺陷与本 Issue 的交互回归样例不同；不靠 Prompt 隐藏 |
| 长篇文学质量 | R18/R19 必有创作质量实证，不能仅凭判断器工具通过签署 I10 |

## 5. 批次 DoD 与强制失败策略

每一批独立执行必须交付：**首个真实消费者 + 现有实体查重证明 + 原生可观察行为 + 负例/异常/并发/版本 + 该批真实页面入口（行为变更）+ I1/I2/I3/N-NARR/I-CACHE 等相关门禁 + commit SHA + SSOT 回写**。只要其中必需环节缺失，结果必须是 FAIL/BLOCKED。禁止修改测试/阈值/预注册样本以逃避失败。

**不做历史兼容**：迁移本批所有受影响的当前消费者，删除旧 adapter/字段/配置/伪工具/死代码和无消费者 legacy tests，不能同时保留“v1/v2 路径”供临时回退；若迁移范围超出单批，**先按真实消费者调整批次，禁止产生双主运行态**。错误恢复/事务回滚必须保留，不属于历史兼容负担。

**不做过度工程**：命令和检查尽量复用现有 `scripts/quality_accept.sh`、`mix check`、`scenario_invariants`、B71/B81 的真实驱动。只有现有验收无法表达必要真实后果才增测试资产。对基础模块可提供机制证明，但**父任务不能在缺失真实 UI/实模证据时 done**。

**现有强制 CI 失败不能伪报**：先做 R00 当前基线审计，区分既有失败/新引入失败；旧失败不能简单归因本次文档变化，也不能拿“与本批无关”掩盖最终 full green 目标。若外部资源暂缺，记真实 BLOCKED 和解除条件，不跳过改称 PASS。

## 6. 一次编码会话的执行契约（所有任务卡共享）

详见 [README](B87-model-interaction-request-projection/README.md)，每次仅下发 **README + 当前 Rxx**，不可把全套卡片叠进模型上下文。

一轮必须依次完成：
1. 最新分支 HEAD + 工作树 + NEXT + 本批依赖状态检查；
2. 7 问（Contract/Invariant/Boundary/Consumer/Proof/Acceptance Driver/Exploration）；
3. **新增实体存在性审查表**（无新增也要明确 `none`）与“删旧收敛表”；
4. 更改设计/测试/实现直到当前批次可复现；不可在失败时降低 DoD；
5. 实际运行专属门禁、共同门禁及真实 UI/实模；记录完整结果；
6. 只提交本批内容，更新**本文件本批**状态与证据、Next 调度（实际队列更替时）；
7. 最终报告 PASS / FAIL / BLOCKED，不用“完成大部分”替代。

R00 需先对本设计提出的差异给出有效裁决；若 VS-00L/ADR-0035 等 Frozen 行为需调整，必须先落 **修订契约+场景/版本/旧入口删除计划**，不得在产品代码里暗改，也不得因“不兼容历史”绕开现有安全不变量。

## 7. 验收与最终退出标准

### 7.1 R01 冻结 Before，不以 Token 缩小作为唯一优化目标

使用用户真实三轮的 request/response 及 3/10/20 轮压力样本，分别记录静态 system/tools、Scope、历史、观察、正文、输入输出与 cached tokens（包含于输入），覆盖 provider/model/推理强度及是否冷缓存。

### 7.2 作者真实可观察结果

- “有几章内容”无需无关全文，准确区分数据库章位与已采纳正文；
- “第一章是卷纲不对吧”能自然讨论事实、不直接执行；
- “卷纲在阅读里显示不接受”能识别目标效果、核实实际能力、不拿重编号冒充移除；
- 长会话已有确认的事实/问题/作者目标连续，checkpoint/多轮恢复不丢；
- 章修订的完整 baselines、角色关系、文风、版本、采纳和冲突检查不退化；
- 作者可见无内部 `chapter:<uuid>` 等协议标识，拒绝伪工具响应；
- 授权模式/委托/critical/full/smart 每项从 UI 到真实事务和撤销/回查均可验证，非法越界拒绝。

### 7.3 全量 Release Gate（最终 R19）

- 全部 Rxx 及每个验收物有真实 PASS 证据；B86 C9、Scope 线性增长、双重真源等根问题真实解除；
- `mix check` + repo 所规定的全部必选质量/架构/静态/I1–I3/N-NARR/I-CACHE 与原生 UI 质量清单通过；
- Chat/Responses/Anthropic 三 wire 的确定性保真通过，供应商实模逐实际可用性报告，缺的真实证据不能冒充已验；
- 同一 A/B 样本，语义不退化，成本/延迟有实数、误调用与越权零容忍；
- **clean audit**：不存在遗留并行 Request、旧作用域/工具兼容、零消费者实体，所有新增在存在性表有审查闭环；不以重置开发库代替源代码正确性；
- 所有“本功能已完成”的表述有证据，任何缺口回归本文件和原相关任务，不虚构 PASS。

## 8. 当前决定、开放问题和恢复入口

**初始设计阶段记录（当前实施状态见 §13.10）**：用户明确要求未发布**不兼容历史**、彻底重审、实体存在性红线与软件原则；当时本文件完成**规划/契约建议文档修订**，未改生产代码。保留原产品既有作者采纳、权限、证据、安全约束。后续实施授权见本文开头，实际实现与验收按唯一任务状态维护。

**需由 R00/对应批在代码和 Frozen 合同上确认**：
- 旧 Scope 与纯讨论覆盖究竟能否用现有 `Compaction` 精确表达；不能时先补唯一契约再迁消费者；
- 模式持久位置、授权委托的范围与到期/撤销，是否确需新最小字段/实体；
- `smart` 可重复、可解释的保守决策表达，不得以模型自评风险替代；
- `capability_lookup` 是否真有新增的业务消费者，避免平行探索工具；
- B71 的 G3/G5/实模遗留与本任务最终 R19 的证据边界，分别归各自任务维护。

**当前执行入口**：R00 事实审计已交付（§9），R01 真实测量基线及工程收口见 §11.21，R02 最终验收与开放反例见 §13.10；下一独立批次 R03 按共享 README 在全新编码上下文启动，先审查显式覆盖、Checkpoint 与恢复的现役 owner/契约，再完整实现和验收。其它批次依实际依赖推进，不能跳过实体查重、冻结契约和完整验收。

**历史证据与计划修订**：旧 B87 R00–R10 的编号/任务范围已整体替换，Git 历史可回查；不保留旧任务卡副本或把旧批次标 done；未上线的产品无旧 API/旧 Schema 兼容承诺。

## 9. R00 执行记录（2026-11-13）

### 9.1 开工与七问

- 基线：`develop/dialogue-based-novel-workbench`，`89b44a95e22f0c4902c5dfff5002838b3097b12d`；开工工作树干净。Issue #4 本文及 3 条评论已读取；历史评论的 B85/队首导航以当前 NEXT/B87 为准。
- 分工：leader 审查愿景、Frozen 冲突、设计取舍和最终证据；dsh-worker 执行代码/调用者清单与质量基线采集（任务 `a3178e1e-73ee-4026-8357-cb7f9a510207`，session `mcp-a3178e1e-73ee-4026-8357-cb7f9a510207`）。worker 自述不代替源码/退出码验收。
- 可改：本任务执行记录、VS-00M 的审计结论与必要任务卡导航；机器证据写 `artifacts/model-contracts/b87-r00/20261113/`。禁止修改生产、测试、Schema、原始质量证据与作者数据；本批不调用真实 Provider，不改变数据库结构。

| 七问 | 本批答案 |
|---|---|
| Contract | 消费 Frozen VS-00L、Accepted ADR-0033/0035、愿景 §2.1/§2.4；审查 Proposed VS-00M 和固定源基线候选包。审计不自动冻结提案。 |
| Invariant | 唯一 Canonical/RequestIR；作者原文字节、真实观察/执行来源；不可静默丢历史；采纳/作品隔离；新增实体先查重。 |
| Boundary | 只读贯穿 common/domain/agent/application/persistence/web/frontend；本批没有生产跨层修改。 |
| Consumer | R01 的可重算成本基线，以及 R02–R19 开工时必须核查的现役归属与冲突表。 |
| Proof | 符号定义+真实调用者+存储字段/事务、Frozen 原条款；共同门禁原命令/退出码/日志。历史证据与当前 HEAD 实测分开。 |
| Acceptance Driver | R00 不改变用户行为，验收是可复查审计和既有命令；无需把 UI 或实模结果伪装成本批产物。后续行为批次沿既有真实 Tauri 驱动。 |
| Exploration | 不物化作品要素、不改变模型作品知识输入，故本批不适用；审计必须确认后继复用既有只读探索及 refs 绑定，而非新建固定投喂目录。 |

新增产品实体/字段/Schema/API/事件/配置：**none**。本批不删除产品入口；删旧收敛计划与候选概念的逐项归属在审计结果中登记，实施时仍须重新核查全部当前消费者。

### 9.2 Leader 审核：现役归属与删旧约束

代码定位的完整采集表见 `artifacts/model-contracts/b87-r00/20261113/code-existence.md`；下表是审核后的设计结论。路径相对仓库根；函数调用与字段检查优先于“同名/不同名”判断。

| 需求/候选对象 | 已核实归属与消费链 | 决定 / 不足 / 删旧约束 |
|---|---|---|
| 新请求/Exchange/ModelInteraction | `apps/novel_common/lib/novel_common/request_ir.ex` → `provider/gateway.ex:execute/4` → `RequestIR.Projection.project/3`；`AuthoringTranscript.to_request_ir/2` 为应用 producer | **reject** 平行实体，**reuse** IR；候选 Exchange 仅离线容器，生产不引入第二请求包装和数据库 |
| 新历史/Checkpoint 仓库 | `authoring_session_history.ex:fetch/compose` → `AuthoringSessionLog.fetch_session/append_run`；`AgentRunLog.commit_snapshot` 同事务提交；`AuthoringReplay`/`TraceReplayService` 回查 | **reuse** 唯一消息/段头存储；不能因 run checkpoint 与 IR checkpoint 同名就合并两种不同职责 |
| 新 Scope 压缩器 | `request_ir/compaction.ex:require_call_ids/project` + `transcript_compaction.ex:plan_maintenance` + `authoring_checkpoint.ex:append_checkpoint` | **refactor-and-retire** 现役覆盖契约，见 VS-00M §12；未冻结新选择器前不删 Scope，不伪造工具交换 |
| Context/Task 两种值 | `context_assembler.ex:assemble_for_input` 读取并组装 `DialogueContext`；`authoring_task_builder.ex:new/for_revision` 从已验证事实组装 `AuthoringTask` | **reuse** 不同职责，不因存在两种值就二选一删除。R02/R05 要收敛的是重复取数/供给/来源决策，专业 Task 仍有独立消费者；禁止建立巨型统一 Builder |
| Context/Task 兼容入口 | `ContextAssembler.fetcher_return` 仍列 5–9 元组、`safe_fetch` 兼容旧 fetcher；`AuthoringTaskBuilder.from_input` 缺字段返回 `{:ok,nil}` 并标迁移期兼容 | **refactor-and-retire**：R02/R05 查全生产与测试调用后一次迁移；不能直接删专业能力，也不能保留旧 stub 专用形状来冒充产品需求 |
| 新 Provider/路由/投影 | `NovelAgent.Provider` behaviour、`Provider.Gateway`、`SSEStream`、common 三 wire 投影均有现役 adapter 消费 | **reuse**；区分原生流、重组输出与 ProviderOutput，禁止引入候选 Python 投影器作为生产第二 adapter |
| 两个 CapabilityRegistry | common 提供共享工具事实，application 查询 common 并添加 `revise_character_profile`/`maintain_chapter_structure`；Toolbox 与 Orchestrator 消费面不同 | **reuse** 归属；**refactor-and-retire** 重复 grants/dispatchable 纯判定，不把 additive 目录误删成双真源，不新增第三 registry |
| 新 RiskPolicy/RiskEngine | `CapabilityRegistryEntry.risk_class`、`MicroPlan.risk_hint`、`GateOrder` authority、`ApprovalAudit` | **refactor-and-retire** 现有风险派生：authority 当前读模型 risk_hint，Audit 对已知动作固定 HIGH；基准/提示/最终风险不是同一事实。R10 接唯一系统派生，不新建风险服务 |
| 确认/审批记录 | `ConfirmationBinding.build` → `AuthorActionAdmission/Confirmation` → re-gate；`ApprovalAudit.enrich/project_receipt` 依托 `author_action_receipts.result` | **reuse** 现有 binding/receipt；它们是一次动作事实，不是长期授权。禁止新建 ApprovalRecord 平行存储 |
| 模式/撤销委托 | `AgentRun.authority_scope` 持久 map、`AgentRunPolicy`、work/session/偏好是候选载体；当前 run 默认 production_write=false、allowed_tools 白名单；run_mode 是 bounded/durable | **refactor-and-retire（载体选择待 R11/R14）**；尚未查得完整授权生命周期，**不能由此直接裁定 truly-new 表**。逐字段比较现存配置/receipt 的所有权、继承、撤销并发后再定最小存储；critical 是风险等级而非第五种模式 |
| 新 AutoAdoptionService | `AdoptionWorkflow`、`AdoptionBoundary`、`AuthorActionReceiptRepo` 与既有 repository 事务 | **reject** 平行采纳服务；R15 消费真实授权后复用事务，候选未存在不能预采纳，回执失败不能补写成功 |
| 新作者可见过滤器 | `AgentNarrativeSource.from_provider_result/from_tool_call_narrative` 在 JudgmentProtocol 生产调用中检查原始来源字节；`verify/3` 是独立复核函数；`AuthorVisible.Text`/Presenter 与 TurnResultBuilder 为现役出口 | **reject** 后处理改写器，**refactor-and-retire** 输入/输出漏洞。`verify/3` 无生产调用不证明“生产没有字节校验”；来源字节匹配也不证明内部 ref 不泄漏。C9 仍由 R06 处理 |
| 新页面/Channel/验收钩子 | `frontend/src/App.tsx` → `WorkspaceChat` → `WorkspaceChannel` → 应用服务；回放有 TraceReplayController | **reuse** 真实入口；不新增专用验收路由、隐藏字段或产品感知自动化 |

本批 **truly-new 产品对象为 0**。新字段及最终类型必须在所属批次逐字段复查；本表不把当前候选 Schema 的形状批准为实际字段。上述明确退役项的消费者与零残留证明由实际迁移批次补齐，未迁移前不写 clean 已完成。

**Scope 进入历史请求的实际链**：`JudgmentProtocol.transcript_for_production/2`（:112）每次从 `profile_scope_text/2` 取得材料；新段 `new_transcript/4`（:706）写 initial_scope，已有段 `refresh_transcript/5`（:146）仅在**该段当前 scope 文本相等**时不追加。随后 `compose_session_history`（:63/:78/:84）经 `AuthoringSessionHistory.fetch_session/2`（:61）只排除历史 application_base，`compose/2`（:82）保留其余已提交消息与当前未提交尾部；三 wire 再经仅折叠工具交换的 Compaction。故“段内相等不追加”不能证明“跨 turn 不重复带完整 Scope”；R01 必须据原始消息分组量化，R03/R04 从覆盖契约修复，不能怪罪 Provider 缓存或在 wire 中按关键词删消息。

**目录与历史设计复核**：00f 的能力等级及 00c 的 B58/后续表是历史导航，不替代任务状态或真实源码。除 ADR-0033/0035，还核对了 ADR-0020 与 `docs/design/quality/32-human-approval-policy.md`：maintenance 的 `auto_adoption_hint` 仅为建议、现行 HIGH/CRITICAL 与批准主体仍受限制；full 委托的影响必须覆盖这些条款，见 VS-00M §7.3/§12，不能只审 RequestIR 后便批准自动采纳。

### 9.3 候选包全量概念边界

当前候选包 9 份 Schema 中，8 份是根定义引用，105 个 `$defs` 集中在 `model-interaction.schema.json`。以下覆盖全部定义族；它们是候选审阅材料，不是 105 个待创建实体。所有嵌套字段仍受“该批查明现役字段/调用者再迁移”的门禁，不因本表分组而获得实施许可。

| 候选定义族 | 处置与真实归属 |
|---|---|
| VersionRef / Source / Coverage / Omission / Coordinate / Count / Constraint / Goal / AuthorInput / ExecutionIdentity / TaskScope / OutputContract / Task | reuse/refactor-and-retire：RequestIR、AuthoringTask、领域坐标/来源；作者原文字节单独保留；字段详细映射归 R02/R05 |
| ElementPayload_E01–E37 / NovelElement | reuse 已有要素模型与各领域契约；reject 37 张新表或全部默认材料包；payload 细字段不是现役事实 |
| SceneUnit / ExecutionBrief / StyleContext / LiteraryContext | reuse 专业创作 brief 与来源约束；StyleContext 细字段待实际消费者证明，不扩张为作者资产系统 |
| ChapterIndexPayload / TextPayload / EntityPayload / AssetPayload / CatalogPayload / Payload / Material / Context | refactor-and-retire 现役事实投影；AssetPayload 属 Issue #3 未来输入，reject 在 B87 新建资产库；禁止把所有材料整包再塞 Scope |
| Budget / Delegation / Authority / ToolDefinition / Capabilities / System / Runtime / Protocol | reuse 已有 run/budget/registry/SystemIdentity/路由；Delegation 的存储待 R11/R14，无新授权字段获准；Protocol 仅候选版本标记 |
| ToolArgs_judgment_decision / ask_author / agent_plan_draft / register_author_content / propose_creative_directions / propose_work_profile_revision / report_capability_gap / submit_tentative_artifact / report_quality_findings / continuation_decision | reuse 现役 10 个工具定义镜像；对应 profile 只取实际工具；不从候选镜像反向生成第二生产注册表 |
| ToolCall / HistoryMessage / Checkpoint / History / Request / Usage / ModelResponse / ToolResult | reuse/refactor-and-retire IR、会话与 ProviderOutput/Usage/结果契约；Scope 覆盖、结果 envelope 和缺用量需按 VS-00M §12 冻结，不能把归一结果冒充原始网络字节 |
| ValidationCheck / Validation / AuthorizationDecision / ModelTextBinding / SystemStatusMessage / ArtifactOutcome / Outcome / AuthorAction / ProviderEvent / Exchange | reuse 当前 validator/gate/trace/receipt/TurnResult/事件；reject 新 outcome/decision 持久总线；授权/执行/采纳分别保留来源 |
| SummaryResult / FactInventoryResult / LedgerResult / MissionResult / CharacterItem / FormattingItem | reuse 专业 task/parser/领域契约；不得默认候选 JSON 与全部现役 parser 逐字段等价；维护/排版的确定性后果与生成正文分开 |

### 9.4 R01 输入冻结与读侧证据

R00 已定位并由 leader 独立复算三轮原始日志，**不是当前 HEAD 新跑的成功证据**。来源：`log/llm-calls/stage/2026-11-12.jsonl` 的第 1/2/3 行，文件 SHA-256 `c1d79f7e7cf39bf0ee567b0eb13bd9c16c3897015c753b8051b130a8aa4fdafc`；应用事件 join 来源为 `log/app/stage/2026-11-12.jsonl`，SHA-256 `39fcf5190f89648e63330351e0dd9e82eb101b808782d7028a0ff4691a90ddd7`。完整行号/turn/run/call 定位见 `artifacts/model-contracts/b87-r00/20261113/sample-locations.json`。源文件只读、不提交作品全文。

| 轮次 / 固定作者原话 | 原始请求消息索引（0 起） | input / cached / output tokens | TTFT / 延迟（ms） |
|---|---|---|---|
| 1：当前有几章内容 | `request.body.messages[3].content` | 16462 / 0 / 335 | 22450 / 24930 |
| 2：第一章是 卷纲，这不对吧 | `request.body.messages[6].content` | 27540 / 16448 / 2976 | 33235 / 39898 |
| 3：不能接受卷纲在阅读里显示，应该在作品档案显示 | `request.body.messages[10].content` | 39772 / 27520 / 1621 | 17189 / 26248 |

证据边界与后继口径：

- 请求 `model` 与 `response.usage.model` 均为 `local/Q4-PLE4`，日志 `response.model` 为 `splash`；分别保留，不能把后者误认模型权重身份。日志 UTC 时间为 2026-11-11，对应本地 11-12 文件。三轮消息数 4/7/11，仅表明历史增长，不代替 R01 对 Scope/System/Tools/Observation 的精确分组。
- 请求 `stream=true`；leader 检查三行 `response.body` 均为仅含 `source`/`tool_calls` 的对象，不是原始 SSE 帧。此来源明确 `raw_sse=not_collected`；可以分析请求和应用收集的输出，不能代签网络流验收或补造帧。
- 每行去日志时间前缀后解析 JSON，来源 SHA 不符立即停止比较；按 session/turn/provider_call_ref join 应用事件，作者原话按独立 user 消息定位，不能把 application 数据块里重复出现的短语当第二条作者输入。消息哈希的编码约定见 sample manifest；原始文件哈希与解析字符串 UTF-8 哈希分开。
- `cached_tokens` 属 input 子集；分组成本以精确 UTF-8 字节为确定量，若没有同源 tokenizer/供应商分组计量则分组 tokens=`not_collected`，不按字符数伪装精确 token。缺推理选项、冷缓存状态、模型版本、真实用量按未知记录；不由耗时推断。
- **多轮固定构造（R01 入参，尚未执行）**：长度 3/10/20，输入 `T[n]=上述三条原话[(n-1) mod 3]`，不添加自动“正确答案”；每个长度独立 session、同一隔离作品起点、同一 provider/model/推理与窗口配置，轮间保留真实会话历史与实际结果，不每轮重置。它只测重复会话增长，**不是 I2 的语义独立样本或文学质量样本**。Before/After 使用同一输入序列、作品内容与配置哈希；先冻结 manifest 再运行；失败也保留，不按输出挑样。
- 原始三轮仅可作历史 Before。新 3/10/20 轮必须从当时真实可运行版本取证并标 HEAD；若作品起点不能恢复，另建明确标注的隔离复现 fixture，不能假装重放同一作者数据库。R01 先复用 B71/B81 驱动/分析入口并记录读侧分组与负例，不修改生产 Prompt 来让基线变好。

### 9.5 验证状态与恢复

本节保留首轮失败与纠错过程；最终审计结论见 §9.6。B87 全部实现及最终 R19 仍未闭环。

**当前 HEAD 的远端 CI 基线（leader 只读取得）**：[push run 43294123379](https://github.com/tongsh6/ai-novel-studio/actions/runs/43294123379)，HEAD=`89b44a95`，completed/failure；并非本轮 Markdown 修改触发。不要用仅查 PR 的 workflow API 返回空数组推定此 HEAD 没有 CI。原始 job 日志与摘要已保存 `artifacts/model-contracts/b87-r00/20261113/ci-job-*.log`、`ci-baseline.json`。

| 检查 | 真实结果 | 失败定位与后续责任 |
|---|---|---|
| Elixir CI | FAIL，Dialyzer exit 2；随后的 mix test **skipped** | `openai_compatible_stream.ex` 未知类型、`sse_stream.ex` 类型/分支、application 的 spec/不可达分支及 persistence/web 类型告警；不能用本地 ExUnit 全绿冒充已修复。B84 架构/测试债务及对应 B87 消费者重构复核，禁止 ignore/降阈值 |
| Quality manifest CI | FAIL，302 tests 中出现 4 项失败 | `au15_preregistration_check` 依赖未跟踪 artifacts 文件；`evidence_chain.test.mjs` 假定 repo/tmp 已存在；manifest 两项硬编码计数漂移（232≠231、234≠233）。需复用既有质量测试体系修正隔离和真实集合断言，不提交机器产物来满足测试 |
| Windows Tauri smoke | FAIL，11 passed/1 failed，exit 101 | `pending_message_is_durable_immutable_and_scoped` 在 `src/lib.rs:1017` 写入时报 Access is denied（os error 5）；原因尚未在 Windows 复现，不据 macOS 通过推断已解决。沿 SU04 多平台责任补证 |
| AI static scan CI | FAIL，Secret leak scan exit 1 | 需与本地新扫描及长期 disposition 对照；保留红灯，不因历史处置写成整仓全绿 |
| Frontend CI / macOS、Ubuntu Tauri smoke | PASS | 仅此 HEAD 的对应 job；smoke 使用 dummy sidecar，不是 native 创作页面或实际 sidecar release 验收 |

**本地首轮共同门禁**（14 命令原记录：`artifacts/model-contracts/b87-r00/20261113/gate-summary.tsv` 与 `logs/`）：

| 命令 | 退出码 / 证据结论 |
|---|---|
| `mix compile`；`mix compile --warnings-as-errors` | 均 0 |
| `mix test` | 0，3185 tests/0 failures；novel_web 196 tests/548.1 秒 |
| `mix check` | 0，含强制全量编译、codegen、全量测试、架构/ADR、I-CACHE；不是 Dialyzer/所有 CI 的替代 |
| `mix xref graph --format cycles --label compile-connected --fail-above 0`；`mix run scripts/arch_check.exs` | 均 0 |
| `MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs`；`run_i2_variation.exs`；`run_i3_nonce.exs`；`run_icache_prefix.exs`（四项均沿同一 `MIX_ENV=test mix run scripts/scenario_invariants/` 前缀） | 均 0 |
| `MIX_ENV=test mix run scripts/scenario_invariants/run_n_narr.exs`（裸命令） | 1，默认测试库缺 `authoring_run_segments`，不是已证实的叙事字节违规；统一扫描内经 test_env 迁移后同 driver 为 PASS。保留原失败，需隔离库独立复验 |
| `bash scripts/ai_static_scan.sh --top 10` | 1，18 passed/3 failed/0 skipped；首轮完整报告保存在 `initial-static-scan/` |
| `node scripts/next_task_check.mjs`；`git diff --check` | 均 0；leader 修改后亦复核通过 |

初扫 Top 10 实际 7 项，touched=0：5 个 gitleaks 历史误报（测试 idempotency fixture、RFC WebSocket nonce、B63 文档场景 ID、E10 spec ID、Pencil 元数据），长期台账均 `false_positive`；1 个 ProjectGod 历史凭证命中为既有 `accepted_risk`（不读取/展示凭证，不在本批重写其他分支历史，轮换仍属所有者）；1 个 `task-done-manifest` 为 `pending`（旧清单早于本次文档修改）。另一个检查失败为 Semgrep 无权写全局 `~/.semgrep/semgrep.log`，并非得到“无问题”扫描结果。后续用现有 `task_done.sh` 生成真实清单、用临时进程日志/配置位置复验 Semgrep，禁止改检查规则或长期处置来放行。

原始失败不得覆盖；复验输出归 `recheck/`，不重复运行已通过的全量测试。含 `:integration/:real_llm` 的测试排除声明保持原样，未执行的实模不代签。旧 B84 193/532s 与本轮 196/548.1s 分开记录。本批仅 Markdown 修改，crapper/dryer/mutator 对产品代码变更不适用，不伪报已运行。

**复验过程纠错**：

- N-NARR 经既有 `test_env` 创建迁移的一次性库后独立 PASS（`logs/11b-n-narr-prepared-db.log`，另见 `recheck/n-narr/`），不改不变量脚本；共用 README 已补相同运行前置。
- worker 的 Markdown 锚点审查与项目 `next_task_check` 的空白折叠规则不同；leader 一度将 NEXT 的 P1 链接改为双连字符，造成真实检查失败。最终把 P1 标题改为 `checkpoint B C` 并沿用单连字符链接，两个规则一致；实际 `node scripts/next_task_check.mjs` 再次 exit 0。不改检查规则，不改 P1 状态/验收范围。
- 首次环境复验把整条流程的 XDG 目录隔离到 artifacts，意外触发 Corepack 将已有同版本 pnpm 12.3.4 重新下载到本批临时缓存；这不符合本机“不主动重装既有工具”的要求。未修改全局配置或升级版本；leader 独立确认常规 `pnpm` 仍来自 nvm Node 24.19.0，版本 12.3.4。缓存和日志保留，不掩盖这次执行偏差。另有 Semgrep 版本缓存路径误建为目录导致 `IsADirectoryError`，不是扫描成功。
- leader 取消该轮 worker（`76d7dc16-7e1f-4630-ab99-192b75e017f1`），再以只读进程核查确认无残留 task_done/scan/semgrep。最终复验任务 `d5ab3dbe-545f-460c-8268-58321da59568` 只设置 Semgrep 的日志、设置、版本缓存**文件**变量，不再改整个 XDG/HOME 或工具版本；证据落 `closure/`，不得覆盖首轮/取消批。
- 审计返工任务 `60151a82-4123-4205-8ef8-e88f561bbf7a` 已修正 Context/Task、字节校验、委托存在性及样本哈希的过度推断；`review-followup.md` 的历史断锚发现与后续实际修复分开保留。候选定义分组核对为 105/105，本批最终跟踪修改仅 10 个 Markdown。

质量 parser 修复已登记到 [B84 既有测试债务任务](B84-web-slow-tests-and-arch-debt.md#2026-11-13-r00-核实的质量测试前置债务可独立推进)，不新建平行任务。Windows 失败的**候选根因（尚未运行验证）**：`write_submission` 在 `frontend/src-tauri/src/lib.rs:236` 以只读 `File::open` 重新打开文件后调用 `sync_all`；[Rust File 文档](https://doc.rust-lang.org/std/fs/struct.File.html#method.open) 明确 open 为只读，[Windows FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers) 要求可写句柄。这与 os error 5 一致，需在 SU04 用保留可写句柄的真实持久化链和 Windows 测试确认；不通过删 fsync 或吞错误规避。

### 9.6 R00 审计交付与后继边界

**R00 Outcome：PASS（仅本批事实/契约审计，不是生产实现或全仓 CI PASS）**。已交付：当前代码与消费者存在性矩阵、105/105 候选定义族的归属、Frozen 差异逐条处置、R01 原始样本定位/固定输入、当前本地与远端失败基线、无新增产品实体及删旧约束。设计中尚待冻结的 Scope 覆盖、字段、委托/自动采纳边界列在 VS-00M §12；它们没有被本次审计自动接受。

本批适用的治理/差异检查通过；`mix test`、含强制全量编译的 `mix check`、架构、I1/I2/I3/N-NARR/I-CACHE 均有实际成功日志。最终 `bash scripts/task_done.sh`（完整调用 `bash scripts/ai_static_scan.sh --top 10`）退出 0；扫描为 **20 passed / 1 failed / 0 skipped，6 findings，touched=0，blocking=0**。失败项仍是 gitleaks，按原长期台账 5 false_positive + 1 accepted_risk 通过处置门；没有改台账、扫描规则或阈值，**不能写成 21 项全绿**。原始和复验报告分别在 `initial-static-scan/`、`recheck/`、`closure/`，所有失败只读保留。

**Semgrep 覆盖限制**：命令退出 0、结果 findings=0，但 raw JSON 仍有 28 条错误/部分解析记录（16 条 Other syntax error、12 条 PartialParsing，涉及 YAML、workflow 与 shell）。因此这里只确认扫描命令完成，不证明这些文件得到完整语义扫描，也不把它们全部判为源码语法错误；后续应与项目标准 YAML/shell 校验分别核对，不安装/升级或屏蔽规则换绿。

首个完成清单为 `artifacts/task-done/20261113T033300Z/manifest.json`（UI not_required）；本节回填后的最终清单由相同入口重新生成，以覆盖最终 Markdown 字节。提交只包含这批设计/任务/导航文档；提交身份以本节所在提交和交付报告为准，原始机器证据不提交。

**恢复/后继**：NEXT 仍为 B87。R01 读取 README + R01 卡 + 本节/§9.4 + sample manifest，使用作者已授权的 Splash；先冻结新批次 manifest，再作当前版本 3/10/20 轮实模基线，未执行部分不能代签。B84 已登记可独立推进的质量测试前置修复；远端 Dialyzer、Windows smoke、Semgrep 覆盖与历史 gitleaks 仍是完整质量目标的开放后果，不能因 R00 审计交付而销账。R02–R19 实现、真实页面与文学质量均未完成，整个 goal 保持 active。

## 10. R01 请求成本与语义基线（2026-11-13）

> 本节保留实施与失败历史，不作为现状正确性的证明。作者后续明确的判断顺序及当前设计裁决见 §11；与之冲突的旧执行方案（尤其自建目标作品裁剪器）已撤回，不继续实现或保留兼容路径。

### 10.1 开工、七问与测量边界

基线 `465b1a3f`，开工工作树干净；R00 worker 均终态，没有仍在运行的旧采集批次。R01 使用全新 dsh-worker 会话 `mcp-04b2d6e4-f22f-4108-9a9d-b25fb3d6a807`，先查现役测量/原生驱动与实模前置；leader 负责测量定义、存在性裁决、预注册与最终验收。Splash 使用已获作者授权，不改模型设置、不卸载用户模型、不安装工具。

| 七问 | 本批答案 |
|---|---|
| Contract | 消费现役 RequestIR/VS-00L/ADR-0035、VS-00I 缓存前缀和 Provider 日志；不实现 Proposed Scope 覆盖、权限模式或新响应契约 |
| Invariant | 原始证据不可改写；作者原文与应用重复材料分开；缓存 tokens 是输入子集；未知不填 0；分组统计不得重复计量或冒充真实网络字节 |
| Boundary | 仅 `scripts/` 的外部测量/驱动、必要 `quality/` 测试夹具及任务文档；`apps/*/lib`、`frontend/src`、生产 Schema/Prompt/Provider 行为不改 |
| Consumer | R01 Before 报告、R04 请求派生对比和 R19 最终 A/B；按真实调用/会话/轮次可重算 |
| Proof | 固定日志 hash、精确字节计量与分组守恒；错误来源/错 join/缺 usage/截断证据等负例；当前 HEAD 实模样本单列，不以历史结果证明当前行为 |
| Acceptance Driver | 优先复用 B71/B81 原生外部驱动、日志与请求采集；真实工作台 3/10/20 输入需先冻结 manifest、隔离作品起点与模型配置；任何脚本/API 局部证据不标 native UI |
| Exploration | 不增加作品知识供给；只观察实际 Base、Scope、工具调用/Observation 与后续请求。实际模型选择取证与纯测量机制分别报告，不添加固定材料包让结果变好 |

计量必须区分：① 原始捕获的 HTTP body 字节；② 固定编码规则重建的 JSON 字节；③ 解析后字符串 UTF-8 字节。日志只存对象时不能声称恢复了原始 HTTP 字节。System/Tools/Scope/History/Observation/Writer 同时含结构、来源、时序和调用目的，分组采用互斥归类并明确交叉维度；不得把“历史中的 Scope/Observation”在合计中算两次。分组 token 没有同源 tokenizer/供应商计量时仍为 not_collected。

### 10.2 入口存在性审查（进行中）

已核实：`prompt_prefix_probe.exs` 有真实 HTTP/SSE 捕获与 usage/hash，但其 `judgment_input/1` 是独立测试输入；`native_b71_*` 有真实窗口/会话采集，现役 batch 的真实 provider 白名单仅 Strata，不接受 Splash；`live_run_wait.mjs` 已有日志请求、响应及 usage 字段读取 helper。不能直接复制第二套 Provider 或把 Strata 槽位卸载判据假装适用于 Splash。

当前新增产品实体：none。新增/修改测量脚本与 fixture 的最终清单须在 worker 给出调用者/职责查重后由 leader 裁决；在此之前不新增持久模型或平行报告状态源。本节尚未签署 R01 PASS，3/10/20 当前版本实模尚未执行。

### 10.3 Leader 独立校准与证据定义

对 §9.4 固定 SHA 的三行日志独立解码，按现役 `RequestIR.Projection.scope_update_text/1` 的消息头核对：Scope 内容 UTF-8 字节依次为 36097、37129、38866；第二轮仍含第一份 Scope，第三轮同时含三份，历史两份合计 73226 字节。`json.dumps(ensure_ascii=False, sort_keys=True, separators=(',', ':'))` 的重编码请求分别为 61466、100703、144207 字节；这些数字是该编码规则的结果，**不是原始 HTTP wire 长度**。首轮 system 内容为 16713 字节，三轮 hash 相同。后续正式测量器需独立重算，不硬编码本样本数值来通过。

额外证据限制来自真实代码而非推测：`SSEStream.Result` 的成功日志 `resp_body` 明确只记录 `source=sse_decoder` 与 `tool_calls`（:112–124），不记录纯正文/私有状态/原始帧；因此后续请求中回放的 assistant 文本只能标为 replay/canonical 证据，不能改名为“原始响应”。`SSEStream.mark_ttft/2` 在 `activity?=true` 时记时，故日志 `ttft_ms` 是应用流活动口径，不能等同“作者看到首个正文字符”或 HTTP 首字节。

正式报告至少区分：精确内容字节与 JSON 包装开销；互斥类别合计与历史/目的等交叉标签；实际模型调用与请求里回放的调用；明确 0 与未知；原始响应/流与 canonical/页面投影。只凭 wire 文本标记不能给任意 user 内容授予 application provenance，分类依据和是否已由 canonical/冻结作者输入绑定需随数据携带。

**原作品仍存在（leader 只读复核）**：按历史日志 work_id 对 `priv/ai_novel_studio_stage.db` 的只读 SQL 查询命中同一作品及两章：seq=1 的卷纲/PLANNED 与 seq=2 的正文章/DRAFTING。dev 与 data/workbench 库未命中。故不能用初版的空作品 seed 代替这一问题场景；正式当前版本基线须从该作品的明确隔离快照建立起点，记录“当前 stage 快照”而非宣称精确恢复 11-12 时点。原 stage 库只读、无迁移/删除/设置修改，原作品正文不得进入跟踪 fixture 或报告正文。

### 10.4 测量链实施裁决（leader；尚非实模验收）

入口审计见 `artifacts/model-contracts/b87-r01/20261113/entry-audit.md`。当前 Splash 的 `/v1/models` 可读，报告 `local/Q4-PLE4` / 262144 context；服务默认 reasoning=max，历史请求为 high。正式批次固定请求 high，并在实际 wire/日志复核；只设隔离测试进程参数，不更改 Splash 服务默认或用户偏好。不同长度分别使用三个独立原生批次/隔离 DB，固定同一 seed 内容哈希，真实生成的 work/session UUID 单独记录，不能宣称身份字节或冷缓存相同。

| 对象 | 已存在与不足 | 决定 / 生命周期 / 消费者 |
|---|---|---|
| 请求分类/日志读取 | `authoring_request_facts.mjs` 已识别 IR/native Chat；`scenario_evidence.mjs`、`live_run_wait.mjs` 已读取日志/usage；`mine_author_intents.mjs` 属 B34 意图语料，含启发式且目录写死 | **reuse** 现役读取边界；不把成本模式塞入意图挖掘器，不复制第二套 wire/日志 DTO；需要严格读取时收敛现役纯 reader，当前消费者同批回归 |
| 成本纯投影 | 现役 facts 只读来源/调用，不提供字节分组、守恒、去重或 usage 可观测性 | **truly-new** 测量函数放 `scripts/lib/native_ui/request_cost_evidence.mjs`（配行为测试），只消费已有 facts，不承担 IO/模型调用；历史 CLI 与原生批次同用；版本/hash/未知项写机器报告，不新增生产 Schema |
| 历史/批次 CLI | 现有 live 单调用探针与 B71 verifier 均不能表达固定历史源、33 个作者 turn、成本报告；候选 Python checker 不是运行测量 | **truly-new** 薄 `scripts/model_contracts/request_cost_baseline.mjs` 与测试，负责 manifest 校验、source hash、读侧 join/报告；原生 prepare/capture/verify 复用同入口，不另建一份 verifier/报告真源 |
| 任意多轮原生驱动 | `NativeScenarioHarness`/AX/工作选择/transport 已有，B71 live 只一条，auto-maintenance 固定六条且属于其它验收语义 | **truly-new** `scripts/native_request_cost_drive.mjs`（配测试），消费冻结输入/可见工作名；复用 harness，不复制 AX/PID/输入安全；页面可见状态推动流程，内部 ID/DB/网络仅在事后关联证据 |
| 原生批次编排/注册 | `tauri_slice_verify.sh` 已管理隔离 DB、Phoenix、Tauri、proxy、日志与 cleanup；缺 R01 journey 和 Splash 原生分派 | **reuse/extend** 既有 runner，仅注册 R01 的 prepare/driver/verify/seed；必要薄 `scripts/native_request_cost_batch.sh` 只调用既有 runner并监督已拥有的子进程，不复制运行时。保持 B71 既有验收判据，禁止把 Strata 槽位规则套到 Splash |
| seed / 预注册 | 现有 seed 可创建作品/session，但原 stage 作品快照不保证可恢复；B71 prereg 限一条/Strata | **reuse** 现役 seed 所有权与 fixture 机制，必要时新增最小合成 seed（先列内容与查重）；**truly-new** R01 测量 manifest 位于既有 quality fixture/运行 artifacts 体系，固定作者输入、seed hash、模型/参数、3/10/20、预算和失败策略。不新增产品字段或另一任务状态源 |

**种子裁决补正**：§10.3 已找到真实源作品。替换初版空作品 seed，不保留空/真实双轨用于逃避复现。复用 B28 既有只读 SQLite backup 方法及测试库复制边界（`scripts/native_b28_evidence.mjs:copySource` 只服务已终止 B28 证据库，不能伪造 B28 元数据绕过其限制）；R01 仅在自己的明确快照路径/批次隔离库内恢复源作品起点，并通过实际内容 fingerprint 证明三批一致。不得复制第二套产品存储/迁移器。快照需标原始来源、采集时点、文件与目标作品内容哈希、范围；不能把旧会话当新会话，须经现役会话服务或可见 UI 创建新 session。真实作品原文始终只在 gitignored 的受控本地证据内。

**实现结构补正（SRP/ISP，非新增事实模型）**：初版 CLI 已超过 1000 行，混入纯 manifest 校验、逐调用/整批判据、数据库/文件读写和命令调度；把函数拆成 CC<10 并不解决这些独立变更原因。批准对本批尚未提交代码作 `refactor-and-retire`，同批迁移调用者、删除原定义及兼容 re-export：

| 归属 | 现存重复/不足证据 | 本批唯一职责与真实消费者 |
|---|---|---|
| `scripts/lib/native_ui/request_cost_manifest.mjs`（及测试） | 当前 CLI 的 validateManifest/readManifest 混合 IO 与纯约束；B71 prereg 限 Strata/单场景，无法直接替代本批 | 纯 manifest 类型/冻结模式/范围校验；文件读取留 capture 边界。CLI 历史与原生入口共用，不建生产 Schema 或新授权模型 |
| `scripts/lib/native_ui/request_cost_batch_evidence.mjs`（及测试） | 当前 CLI 的 verifyTurn/verifyBatch/汇总同时查询 DB、找身份、判定状态、写报告 | 已采集事实 → 逐 turn/call 测量/模型结果/缺证判据；复用现役 authoring_call/run evidence，禁止复制第二套身份真源；消费者 capture/verify 和反例 |
| `scripts/lib/native_ui/request_cost_capture.mjs`（及测试） | 当前 CLI 同时承担 source/seed/日志读、prepare/capture 与写报告；原生 driver 直接 import CLI | 唯一外部证据 IO 边界，调用现有 SQLite/日志/快照底座与上述纯函数；原生 driver 和 CLI 调用它，不造通用 Manager/Repository/控制环 |
| `scripts/model_contracts/request_cost_baseline.mjs` | 当前超过 1000 行，名称“薄 CLI”与职责不符 | 只保留参数解析、命令分派、退出码；原公共函数/常量的消费者迁到实际 owner，不留旧出口兼容壳 |

单请求 `request_cost_evidence.mjs` 继续只管字节/来源/usage 纯投影，不塞整批状态或 IO。上述只是在已批准 R01 测量链内搬正职责；新文件同步 README，数据形状仍只有同一组测量报告，不能借拆分扩出第二事实源或泛用框架。

**隔离快照反例（leader 独立复核，必须先修）**：`source-snapshot/20261113-real-v2/work.sqlite3` 虽仅有 1 work/1 session，却保留源库全部 298 条 interactions 与 158 条 decision_traces；其中 267/140 条 session_id 被删除父会话的 `ON DELETE SET NULL` 变为空。原 stage 对应两表均无空 session_id，故这些不是原有全局事实，是越界历史残留。此 provisional 快照**未验收、不得用于实模**，保留失败副本。修复须从原只读来源、在删父行之前固定各表保留集合，按真实 work/session/foreign-key 归属筛选依赖行；不能从已经置空的副本猜来源、把 NULL 当全局、或只验证 works 数量。新增负例包含两个作品各有会话/历史/trace，证明副本只保留目标原始归属，不遗留被置空的别作内容，且原库不变。新副本另名，原失败证据不覆盖。

**mutation/version 裁决（已查实际 owner）**：目标原会话在只读源中有 31 interactions、18 decision_traces；目标 `mutations.target_scope="work:<id>"` 有 9 行，必须保留。`AdoptionRepository.mutation_attrs/1` 以该 scope 写入，`direction_mutation_exists?/2` 实际读取其幂等事实，不能把无 work_id 列误作无消费者而清空。`versions` 在此源为 0 行；ADR-0032 已逻辑退役 PaperTrail，但要求保留物理表/迁移，R01 不改变该决定、不新增版本兼容，保留该空表。机器反例为 `artifacts/model-contracts/b87-r01/20261113/leader-snapshot-review.json`；正确过滤应以原始归属集合证明，而非把 31/18/9 写死进程序。

**成本守恒仍有反例（leader 真实调用入口，exit 1）**：当前 `analyzeRequestCost` 对 native Chat content 数组中的未知材料块仍给 `ok=true/unclassified=0`，把其内容吞入 envelope；请求根本没有 tools 字段时也凭默认空数组计出 `tools=2` 字节。合成输入、原始观测与源码 hash 保存在 `artifacts/model-contracts/b87-r01/20261113/leader-cost-review.json`。后继必须修真实来源覆盖/已出现字段核算，再补 public 入口反例；不能用 `total - categories >= 0` 冒充独立守恒。未知材料可以明确 unsupported/unclassified，无需为过门禁实现新的多模态产品能力。

**同因再次失败：v3 仍未验收**。v3 修正了 interactions/traces/mutations，但 retained run/provider 子表仍未隔离：agent_events 应155/实2362，agent_run_steps 应32/实456，provider_events 应350/实133091，provider_outputs 应24/实595；目标行未缺，额外行全属保留集合外。机器 ID 集合差集证据 `leader-snapshot-v3-review.json`（exit 1）。共同错误前提是“让删除中的父表承担归属判断”：子表查询发生时父表还包含其他作品，删除父表又无外键级联。

**撤销该前提的设计**：先在只读源一次固定 work/session/AgentRun/ProviderRun 及各表原始保留 ID 集合、内容指纹，再对新副本应用筛选；删除顺序不再决定谁属于目标。Provider 子表按 `provider_run_id` 对应的已选 ProviderRun 集合，不能只按可空 agent_run_id；Agent 子表按已选 run_id；会话子表按原始已选 session；mutation 按真实 target_scope。每个非空业务表必须有明确保留/派生/拒绝策略，未知归属 fail-closed；过滤后逐表核精确 ID 集合和 retained row 原始字段，不只核数量。FTS/索引按既有派生语义处理，不把缓存当新作品事实。允许将当前 capture 中的快照备份/归属/恢复职责 `refactor-and-retire` 到 `request_cost_snapshot.mjs` 及测试：现有 B28 helper 有专属边界不能冒用，本批消费者为 capture/seed；不建通用备份框架、生产表或新存储真源。失败 v2/v3 与只读 full 均保留，新合规副本另名。

**作品内容指纹复用裁决**：当前 `workContentHash` 只覆盖 title/genre/premise/tone，`contentFingerprint` 只额外读章节元数据，不能证明正文、角色、记忆、账本相同；start/final 只比行数也不能证明没有 in-place 内容改写。已有 `authoring_canon_evidence.mjs` 的 `CANON_TABLES`/`buildAuthoringCanonSnapshot`/`compareAuthoringCanonSnapshots` 与 `authoring_capture_evidence.mjs:planningCanonSnapshot` 正式处理完整 canon 内容签名及运营字段差异。必须复用它们的定义：三批起点覆盖 works/drafts/chapters/volumes/scenes/characters/memory/ledger/receipts，而非另造四字段真源；单独保留 raw row 签名与 canon 签名，真实版本/身份另记。新增“只改正文/记忆/角色而行数不变”反例必须使对应指纹/变更事实变化。模型行为与测量完整性继续分开，不把合法运营计数或有来源的派生内容伪装成作者采纳，也不把未知变化写成零写入。

实现阶段先完成同一测量链的负例、自测和历史复算，再由 leader 审核源码与实际 seed/config 后冻结运行 manifest；**未冻结前不调用模型**。3/10/20 每个长度只开一批、0 harness 重试，产品原有有界纠错单列实际调用；失败不得换样本刷分。遇模型提问不自动选答案/采纳，下一固定输入只能经作者可见“开始新讨论”进入新 turn；入口不可用即记录部分执行与失败，不用 API/DB 推进。

**测量完整性与模型行为分开**：模型回复错误、报告 gap、询问或有证据的失败，都是应保留的 Before 结果，不为得到正确答案重试/换样本。只要页面仍可按预注册进行下一作者输入，继续收集固定序列；UI/传输不可继续、输入缺失、调用错绑或原始证据不足才造成测量 partial/fail。测量 PASS 只能证明完整、可复算地记录实际结果，不能签模型语义正确或整个产品 PASS。

R01 测量当前真实 Chat 请求；三 wire 机制回归继续用既有 I-CACHE，Responses/Anthropic 未采集字段如实 not_collected。不为了补历史缺失 SSE 改生产日志；有原生捕获就核验完整性，没有就保留缺测。后续 R07/R19 仍须提供各自要求的真实 wire 证据。

### 10.5 实施与审查 checkpoint（未验收）

入口审计任务 `04b2d6e4-f22f-4108-9a9d-b25fb3d6a807` 已终态；实现任务 `2faa3f21-7670-4c8e-b70b-50cab3fb6f39` 承担整条测量链与自测。leader 对初版代码作语义审查后，已在同一 worker 会话排队返工 `f6e372b5-957d-48cd-adbe-3d2c0700b174`，必须逐条用反例闭合：

1. `validation_result` 不能计为真实 Observation；unknown block 不得藏进 JSON 开销。
2. ProviderRun 与 AgentRun 不同；一个作者 turn 的所有判断/纠错/探索/Writer 调用必须精确关联，不能限定一条调用或只按 provider_run_ref 分组。
3. 固定输入第 4/7 等轮会重复原文字节，不能依赖“请求中原文唯一”；须依真实作者消息/turn 身份或受证据约束的顺序定位。
4. 字节守恒要独立核对材料覆盖与结构开销，不能仅用 `total - categories` 自证；单条作者绑定不授信全部历史内容。
5. 缺 usage 不作为 0 汇总，token 值校验与真实 Writer purpose 不能缺席。
6. 合法显式 checkpoint 导致前缀缩短是观测事实；不能以永远 append-only 拒绝正常压缩。
7. 状态由检查事实推导；模型行为失败与测量缺证分开，禁止 checks=false 却无范围说明地报告 PASS。
8. CLI 的职责与重复 reader 需收敛，不能以“薄 CLI”命名掩盖大模块；额外公共实体仍先查重裁决。
9. 保留失败/冻结证据不可覆盖；seed 内容哈希必须由真实隔离作品事实复算，不能只信 seed 自报。
10. 原生驱动必须等待本轮新作者消息及其新响应，不能在重复输入时凭整页 `includes`/旧终局文本提前推进；模型可见失败与 UI 不可继续应区分。
11. 冻结检查必须在真实批次启动前完成；历史分析的 frozen manifest 不能自动充当尚未审核 seed/config 的实模授权。

以上是初版审查点，不是已修复声明。当前没有启动 Splash 或真实 UI 批次；完成源码/测试审查后才冻结运行 manifest，R01 保持 doing。

真实起点/原生新回合与冻结前置返工由同会话任务 `8a1c4412-749d-408b-993d-bd8fc3c779d8` 承接（排在语义修复之后）。只读 stage 源、创建任务自有快照和隔离测试副本；原数据库不迁移、不删除、不改配置。源库 15 个作品不等于可以把其余作品当测试材料，运行副本必须审查目标作品可达数据范围。当前生成的 `request-cost-history.manifest.json` 只用于历史分析，**不是正式原生 3/10/20 批次的冻结批准**。

**初版质量门不能代签**：新测试 19/19、相关 Node 150/150、B71 67/67 和 `mix check` 等通过，仅是已覆盖范围的证据；初版 mutator 为 85 killed/107 survived（44.3%），crapper 的 Cov/CRAP 为 N/A、最大 CC=9，dryer 不支持 `.mjs`，均不能冒充全部 ub-mode 门通过。现有 crapper 支持读取 `coverage/**/lcov.info` 或 `target/coverage/**/lcov.info`；Node 24 自带 test coverage/LCOV reporter，可生成真实报告后用 `--use-existing-coverage`，无需安装额外工具。后继须补行为反例/消除无效代码、核查等价变异，保留实际局限，不用 CC 替换 CRAP。

**本 checkpoint 恢复点**：`2faa3f21` 实现、`f6e372b5` 语义返工、`8a1c4412` 快照/freshness 返工均已终态；worker 的 completed 不代表 leader 验收。已观察到 validation=195 的历史误归类得到修正，26/28 项局部测试通过，但 source-snapshot v2 被 leader SQL 反例否定，mutation 数据丢失未闭合。结构/质量收口任务 `e640f455-8d32-4521-9937-7700f5629073` 正在同一会话执行；随后排队 `ac333b4a-bc52-4fce-aeab-ba4a3c2c782c` 按 actual counterexample 修复隔离与 mutation 保真。接手先查询这两个 task 的真实状态，不重复派发、不重启仍在跑的质量作业；报告分别以其终态结果与当前文件为准。尚未冻结 native manifest、未运行 Splash/真实 UI、未提交本批代码；R01 不签 PASS。

## 11. 作者纠正后的目标一致性复核（2026-11-13；当前裁决）

### 11.1 判断依据

作者明确：**愿景 → 元原则 → 设计 → 任务规划 → 代码实现，测试用于验证是否达到目标**。当前实现是否正确是待证问题，不能反过来成为设计/验收的标准。该要求已写入 AGENTS 和本批执行 README。

R00 的存在性地图仍是事实证据，但“已有”不推出“正确/应保留”。Frozen/Accepted 是决策记录，也要审查与愿景/元原则是否一致；偏差回到对应设计与任务纠正，不能为维持旧实现或让测试变绿改小目标。门禁、覆盖率、变异分数均不代替目标验证。

### 11.2 上层目标 → R01 必须证明什么

| 上层依据 | R01 的必要作用与独立判据 | 当前不能据以判正确的现状 |
|---|---|---|
| 愿景 §2.1/§2.3：自然对话、目标连续、作者主权 | 以真实三轮输入记录作者可见回应、实际工具/效果与未完成目标，分别评估符合/偏离/缺证 | schema 合法、run completed、存在两条章记录，都不是“理解正确/已经完成”的证据 |
| 元原则 §2.4：最小供给、按需求证、证据闭环 | 记录实际 Base/Scope/Observation、供给与真实读取来源、后续请求引用；成本变化与语义质量分开 | Prompt/上下文已由现役 assembler 生成，不证明材料必要、来源正确或使用未越界 |
| 要素设计 §5：设计态/实现态分离；卷蓝图设计 | 章位/卷纲/已采纳正文分开对账，异常作为 Before 缺陷，不从表名/状态反推正确领域语义 | 现存卷纲占章位、reading projection 渲染结果不能做标准答案 |
| VS-00M §1/§5/§6：来源与实际效果分层 | 区分作者原话、模型建议、校验、执行、采纳；不能用重编号替代归档目标或提前宣称修复 | 复用现役 registry/gate/receipt 仍需证明其语义和实际效果一致 |
| SRP/DRY/KISS/YAGNI | 最小可靠测量链服务 R01/R04/R19；每个组件必须证明当前必要性，重复/无效职责应删除 | 已写完/测过的裁剪器、manifest 或 helper 不因此获得保留理由 |

R01 卡已补目标驱动的场景判据。基线“采集完整”与产品“符合目标”分别出结果；必须能记录当前系统失败，不能把错误冻结为 golden behavior。3/10/20 循环仅为受控压力样本，不代签正常长篇创作、语义独立性或文学质量。

### 11.3 测试准备方案收敛：隔离实例，不再重造作品裁剪规则

**撤回 §10 的作品数据裁剪方案与 keep-set 引擎**。R01 要求原作者数据不受影响、三批起点一致、由真实页面操作目标作品并记录真实请求；它不要求测试数据库只含一部作品。裁剪方案复制了作品/会话/运行数据的归属规则，还改变了真实环境、引入引用丢失与跨作品残留，属于不必要的测试子系统。即使 v5 个别检查通过，也不据此认定该设计必要。

当前方案：

1. 复用已有 SQLite 一致性 backup/隔离批次机制，使用已冻结的完整 `20261113-real-v2/full.sqlite3`（SHA `c5732f99ca320ad526069d8b578162265eac1e481ba8d15e24760e8657a559db`）恢复三个独立运行副本；不裁剪/删除行，不篡改原 stage 或只读源。其它作品是原环境背景，不能变成额外测量任务或被主动发送给模型。
2. 冻结数据实测 124 个 run 均 bounded，唯一 long_run_task 为 DONE；现役恢复设计仅重建 durable，bounded 的说明是不重新发起 planner/provider。**这只决定待验证前提，不证明实现正确**：准备/启动期间的真实调用与状态必须记录，出现未声明的恢复/调用如实失败，不能改记录或切更简单的数据源。
3. 源中 15 个作品标题相同，不能用内部 ID 驱动页面选目标。只在运行副本的 fixture 准备阶段，经现役作品服务为目标设置一个冻结的、普通且唯一的可见副本名，并经会话服务创建新 session；实际作者操作仍点击该可见作品。此为明确的 fixture 转换，不声称原始状态逐字未变。独立核对只发生声明的标题/版本/运营字段与新 session 变化，其余作品/正文/角色/记忆/账本/审计引用不变；不能因调用了现役服务就假定它正确。
4. 使用现有 canon 内容签名定义及独立原始行/文件对账，验证复制保真、声明 setup delta 和每个长度的同一起点；正文/角色/记忆变更即使行数不变也必须可见。记录所有新调用，按实际目标 work/session/run/call 关联测量，不把背景历史调用算入本批。
5. 退役未提交的过滤/keep-set 实现、对应专属接口与仅保护该算法的测试；保留 v2/v3 等机器失败证据。目标层的复制保真、作者数据保护、作用域与内容变化测试保留并改指最小方案；不得以删除实现为由删除这些目标约束。

该方案仍须实现与独立验收，不因本段设计通过而签 R01 完成。不存在兼容旧裁剪格式/新旧路径开关；历史报告只读留存，不进入新执行链。

### 11.4 验收与恢复状态

截止本次纠正，既有 dsh-worker 任务已终态，所有完成自述均只作为待审材料。`bb655b20` 的 keep-set/v5 方案按 §11.3 退役；`5072d4ab` 报 manifest 子模块变异闭合，仅能支持该子模块当时输入边界，不能证明上层设计、整个 R01 或产品达标。未提交代码、未冻结 native 批次、未运行 Splash/真实页面。先收敛未提交实现并完成目标判据，再采集基线；整体 goal 继续 active。

按本节裁决的新工作单元为 `e6a2e35a-8387-4429-93ad-4832c55b8f48`（会话 `mcp-e6a2e35a-8387-4429-93ad-4832c55b8f48`），只收敛必要测量、完整隔离副本与目标判据，禁止实模/UI调用或提交。恢复时先核其真实状态和当前 diff，不继续旧裁剪方案，不将前一轮工具分数搬作新方案验收。

### 11.5 真实入口前的参数一致性核对

收敛实现已报告完整副本/真实 seed/prepare 的无模型干跑及 89 项局部测试，但这些不证明真实入口可运行。leader 直接核实以下差异：

- 批次脚本用 `require(process.argv[1])` 读取相对 `artifacts/...json`，Node 实际报 MODULE_NOT_FOUND；必须按数据文件解析并沿既定根目录解析路径，不能把 manifest 当可执行模块。
- `NOVEL_SPLASH_REASONING_EFFORT=high` 单独设置不够：现役 adapter 在 thinking disabled 时发送 `reasoning_effort=none`。实验所需 high 必须同时经真实配置得到 enabled，并由实际请求对账，不能从 env 字面量推定。
- `MIX_ENV=test` 默认 auto maintenance=false、sync summary=true；产品默认 auto maintenance=true、sync summary=false。`ContextPressure` 的 Splash 默认窗口为 32000；manifest 中的 262144 尚未接到实际配置。必须通过现有产品运维配置对本批进程明确设置并捕获实际值。

本批 **受控实验设置**：应用维护窗口 262144（显式配置，不声称是产品默认值），真实模型当前宣告窗口单独记录；自动维护开启、keep_recent=4 与现役阈值；摘要维护使用产品异步语义；Splash thinking enabled + effort high。不改全局偏好/服务默认，不为了让压缩发生而改小窗口。测试后端与 release 的其余差异（例如测试服务器的 Origin 检查）明确留在证据边界，不以本批签其正确性。

在外部启动脚本/测试服务器中采集同一运行进程的白名单 runtime facts（provider/config、实际维护窗口/开关/摘要策略、进程身份等），并与 manifest 及实际请求互证；不得在生产路径新增验收开关、隐藏事件或暴露密钥。配置接线可用测试环境传输替身验证，但仍不能代签真实模型/页面。

### 11.6 引用记账与首次真实入口验证

**引用日志不是已证坏数据**：worker 曾因 Node 直接读 TEXT 列后 UUID 解析失败，把 240 条历史引用日志视为不可解析，并给 canon builder 传空数组。leader 只读 SQL 已核实 `id` 与 `memory_id` 的 `length(CAST(... AS BLOB))` 全部为16；沿现有 `authoring_capture_evidence.referenceLogRows` 的 SQLite 无损投影后，`buildAuthoringCanonSnapshot` 实际成功解析240条。不能把新读取代码的错误当作源数据事实，也不能把丢弃日志作为修复。

复用这一现役读取边界，单点维护并由 snapshot/capture 消费；不复制第二套 UUID 兼容器。准备阶段只允许声明的 setup delta；运行阶段正常只读取证可更新有真实来源的引用记账，必须用原始行/内容签名及实际新日志对账。作品内容变化、无凭据的计数变化和他作越界各自记录，不能用“所有行字节完全不变”拒绝合法求证，也不能忽略记账字段后直接判无写入。业务内容签名与原始行签名、引用会计证据分开保留。

首次真实入口按 ub-mode 的可观察结果验证：在复制/源保护/冻结配置/模型路由等前置完成独立核验后，可另冻结一次**工程诊断批次**验证真实 Tauri+Splash 接线，全部结果保留，不作为正式3/10/20已覆盖或模型改善证明，不改生产Prompt/模型以刷分。正式 Before 仍沿冻结3/10/20输入与参数各一批、0自动重试；诊断与正式样本分开列明，不删去失败或把诊断当原始基线。最后仍须完成相关质量门与目标语义评审才能签 R01。

### 11.7 工程诊断 01 登记

leader 复核完整源/副本及原始两类日志 SHA 均与冻结值相符；独立运行引用读取器与 runtime recipe 负例共5项通过。无模型 bootstrap 事实记录为 Splash adapter、thinking enabled、effort high、window 262144、auto maintenance true/keep4、sync summary false；这仅证明配置接线，实模仍待验证。worker 对质量工具的 PATH 检查不足：三个工具在 `/Users/loong/scripts/ub-tools/` 的既有绝对路径均存在，不应写“未安装”；尚未执行的门禁仍未通过。

诊断注册：`artifacts/model-contracts/b87-r01/20261113/diagnostic-01/registration.json`；manifest SHA `f4707bcd34c28bea4dbd1bf1fe52461b436ded82a202186e9c20d4f3c3a444ae`。只授权该注册的一批 length=3、tag `diag01`、0自动重试，独立目录 `artifacts/slice-verify/b87-r01-request-cost-live-3-diag01`；正式 Before 覆盖仍为0。候选保持 frozen=false。启动前修正已独立复现的测量错误：未知/未解码响应不能计工具调用为0；聚合不得用 `null ?? 0` 隐藏缺证。任何失败保留原样，先判断测量/接线/产品语义责任，再决策后续，不为通过当前代码的判据改写目标。

### 11.8 诊断 01 结果与报告职责纠正

诊断 01 退出1：真实原生窗口已观察，选择作品前因 `runWithHarness` 在 `ensureWorkSelected` 外重复包 `runStep` 触发 `invalid_wait_begin`。单层等待由既有 helper 负责，修复调用方，不放宽等待账本、不修改产品。未发作者输入，调用日志为空；不能给出模型/目标语义结论。leader 独立比较源/运行副本全部36表原始行签名，仅 works/work_sessions 变化；证据 `diagnostic-01/leader-startup-table-diff.json`。源及副本 SHA 未变，批次所属 app/4657/4661 已清理。

缺失响应的0值误报已修，leader 相关公共入口30项复验通过。诊断又暴露报告边界错误：缺 start checkpoint 被写成 `undeclared_model_calls_before_start`，无请求被写成 wire 不匹配，缺前后检查点被写成 `production_changed`。**缺证只能判缺证，不能捏造反例事实。** 复用现有 `checks`/`not_collected`/`failures` 与测量状态，不建立第二验证器。

同时收回“无 canon 写入 = 本成本基线通过”的隐含假设：R01 需要完整测量真实行为，不能以现有系统输出不变为标准答案。准备阶段的源保护/setup边界仍为硬门；运行阶段的业务内容/引用记账/跨作品变化须完整保留在现有 `reference_accounting` 的比较证据和 `model_behavior`/`semantic_review` 中，供目标与授权评审。证据完整但产品越权时，应明确产品偏离，不能把它误称采集失败；证据缺失时不得声称作品未变或已变。复用已存在的 canon compare（checks+measured）、checkpoint 与报告字段，删除误将无写入作为测量成功条件的耦合，不新增产品判定器或平行事实源。

下一次工程诊断在修正上述接线/报告、公共入口负例通过后单独登记为 diagnostic-02；最多一批三轮、0自动重试、旧失败只读保留。正式 Before 仍0批。只读 `/v1/models` 确认 local/Q4-PLE4，宣告262144窗口、efforts low/medium/xhigh；本机已安装 Splash 1.6.1 的 `server/chat_format.py` 接受 high，`chat_templates.py` 对模板拒绝 high 提供 xhigh alias。此为本机代码事实，实际请求与推理效果仍须观察，不凭配置宣称已发生思考。

### 11.9 诊断 02：拒绝“三轮完成”自述，改正可见终态的所属范围

diagnostic-02 退出1，真实页面发送三条作者输入；3条已完成 Splash 调用的请求日志均为 local/Q4-PLE4/high，另1条 ProviderRun 留在 running。**未完成三轮结果采集**：第1轮 completed、第2轮等待作者；第3轮发送后约0.4秒，驱动把页底仍呈现的旧任务“等待你回复”当作新回合终态，随即收尾，数据库新 root run/ProviderRun 仍 running。该截断是驱动错误，不能归因模型失败或算合法等待结果。

事后关联另有独立错误：既有 `NativeScenarioHarness` 返回 Phoenix 五元组帧，数据在 `frameBody(record)` 即 frame[4]；新 driver 却读 `record.body`，其测试也自造了错误的四元组+body夹具。3个真实回执的 turn/run 均存在，程序报告却均为空。leader 复用真实 harness 的读取方法独立复现，证据 `diagnostic-02/leader-driver-rejection.json`。

撤回前提“新作者 echo 后出现任意终态文案即可判定本轮结束”。下一修正只在外部驱动中按实际 AX 可访问分组取**本条作者消息对应的消息流**：既有“本轮创作过程”的状态、“创作问题记录”的“等待你的回答”属于可见证据；页底“当前创作任务操作”/回答面板中的旧等待不属于本轮消息终态。不得读内部 ID/WS/DB 决定点击与下一轮，不增加产品 hook，不用固定 sleep 掩盖竞态。优先复用现有 AX/状态读取函数，在既有 driver 内完成必要范围适配，不另建通用 DOM/状态框架。必须先让本次真实旧等待反例失败，并覆盖 repeated input、模型正文引用状态词、快速完成、运行中旧等待共存；只引用 WS 帧格式和 DB 事后判断采集是否截断。

diagnostic-03 在上述纯函数/公共入口反例通过后另跑一批3轮、0自动重试，继续保留01/02。截至此处正式 Before 仍0批，R01 doing，产品行为质量尚未签署。

### 11.10 诊断 03：先补观察，不以后台完成代替页面证据

diagnostic-03 退出1；5条已完成请求日志与5条 ProviderRun、3条 root run 均 completed，第1/2轮页面 completed 已采集且回执关联正确，第3轮在120秒处由 supervisor 超时收尾。第3轮实际 turn_result 在发出后约29秒已到，但缺当时 AX 树；失败采集晚于 app 清理，得到 target_not_running。**因此原因仍未证实**：不可直接宣布产品未渲染，也不可宣布只是滚动或某个 parser 分支。保留完整请求/帧/数据库和已有截图，不将第3轮算页面验收通过。

另核实外部预算接线差异：manifest/driver 360秒，但 `native_ui_wait.budgetsFor` 的实模供应商集合遗漏 Splash，实际 turn 门为120秒。应在既有外部预算 owner 补齐适用 provider，测试消费真实有效值，不能只改报告或扩大全局默认；这不是第3轮29秒后仍未识别的已证根因。

下一步禁止直接再发模型批次：先保存轮询中的最新实际 AX 原始观察及判据事实，使独立 supervisor 清理后仍有失败前证据；复用现有外部日志/写盘能力，不新增产品 hook 或第二 supervisor。可在 diagnostic-03 的**另建完整复制品**上启动同一真实产品入口，仅读回持久的三轮结果、拍摄/采 AX，禁止新作者输入/Provider 生成、禁止改原03证据库；还原页面观察只能说明恢复态，不能冒充03丢失的现场。再根据观察审查判据与产品显示是否达到目标。当前 `axTurnOutcome` 只取第一组、通用 flat 状态函数拆分后的语义漂移属于待验证代码疑点，不据疑点直接修补或盲跑。

### 11.11 恢复观察后的目标判据裁决

无新模型的恢复读回已完成，LLM日志0文件、ProviderRun/AgentRun/Canonical条数不增，原03与冻结源SHA未变；证据在 `diagnostic-03-observation/`。已修观察落盘、Splash外部360秒预算、下一作者消息边界、通用状态行语义漂移和完整身份关联。恢复态中三条答复均可读，显式选择会话后过程组不显示。**这只是观察事实，不因 driver 依赖过程组就直接判产品缺陷**；恢复状态设计的完整性仍应独立对照既有设计，不能由验收脚本倒推产品必须增加展示。

leader 实际查看恢复截图/原始AX，并核对 `WorkspaceChat` 的 `framePresentationForSummary` 消费者：第2/3轮已有结构化 `capability_gap` 的可见“能力缺口”标记及完整作者解释，后接该条“为什么”按钮。愿景允许模型诚实指出能力缺口；R01的目标是记录此真实结果及其未满足的作者目标，不要求所有结果都显示过程状态徽标。故在既有 AX owner 中复用该**现役领域结果类型**，按当前作者消息边界、真实 AXGroup 的可访问说明/直接标记子节点和对应回复/为什么按钮识别 `capability_gap`；不能从模型正文搜索关键词，也不能借用旧回合标记。无过程组也不能自行标“running”，未观察到状态就是 unknown。

新增/复用审查：没有新产品实体、Schema或验收hook；`capability_gap` 已是 `frame_summary.frame_type`，当前真实消费者为 framePresentation/WorkspaceChat，外部驱动只是补齐已有可见结果的读取。结果类型为缺口答复，绝不等同于作品效果完成；运行状态与全部调用完成性继续仅在事后互证。先回放恢复态AX与02旧等待反例，成立后才单独执行 diagnostic-04（1批3轮、0自动重试）。03实时页面仍未补成PASS，正式Before仍0批。

### 11.12 诊断 04 通过测量复核，正式 Before 冻结

diagnostic-04 退出0：真实页面第1/2轮 completed、第3轮 capability_gap；4条完成请求日志/4条ProviderRun与3条root run全部关联且终态一致。leader 逐轮从保存的原始AX重算 outcome、只读DB核对 turn/run/provider归属，查看第三轮截图，并复跑driver/batch/wait共26项测试（exit0）。input79386、cached55808（输入子集）、output6037；原始HTTP/SSE/分组tokens仍缺测。作品业务内容不变、8条新增引用有记账来源。**仅测量链通过；模型语义、作者目标效果未签，缺口尚未解决。** 诊断01–03保持失败/未闭环事实。

正式3/10/20已另冻结 `artifacts/model-contracts/b87-r01/20261113/formal-before/manifest.json`，注册见同目录 `registration.json`（含HEAD与测量脚本哈希）；三个tag为 `before03`/`before10`/`before20`，各一批、0自动重试、各自完整隔离副本。任何测量失败保留后停止依赖推进，模型/产品失败本身是需记录的Before结果。生产代码本批未改，不把诊断与历史日志算正式样本；正式数据、独立语义评审、最终质量门与提交全部完成之前，R01仍doing。

**正式采集期间的独立口径复核（保留原数据，收口时派生重算）**：before03已采完3轮/4调用，原测量报告pass；leader逐调用发现 `analyzeAuthorCall` 仅按 `callIndex===0` 将root作者字节算作current_author。同一第2轮第2次调用仍真实携带34字节的同一作者原文，却被移入history（0/1468，而按root作者归属为34/1434）；唯一false消费者就在该batch函数。当前“本轮作者”应由已绑定root turn决定，不能随内部求证调用序号消失。证据 `formal-before/leader-author-category-review.json`。这是可由原始请求重新计算的分类错误，不改模型/源数据、不重跑已冻结样本；正式采集结束后统一修正唯一owner/消费者、明确口径并生成另名派生报告，旧报告与方法哈希保留。总tokens、scope字节不受该34字节分类调整影响，尚不签最终成本口径。

**before10实际结果与后续执行事实**：10轮/15条调用和页面均采集完整，原runner退出1、JSON fail；全量关联/Provider终态/日志完整/引用记账均true。leader只读核实：作品标题始终为声明的副本名，实际变化是 `works.planning_direction.planning_mission`（model/TENTATIVE）和revision 2→4，发生在第3/8轮的规划使命步骤；不能称标题变动，也不能直接称正式正文被采纳。起点业务内容SHA与seed相等。错误在 `verifyPostSetupContent` 把**最终**revision与准备revision比较，并用 `setup_visible_name:changed_during_run` 命名；准备阶段与运行后事实仍未完全分开。源码/响应/截图与VS-00E §16.8的暂定使命设计需独立评审其意图和真实效果。

worker在检查上述完整性后继续了原登记的before20；leader曾按JSON失败以为20尚未启动，现已按worker审计事件纠正。before20属于原一次采集授权、独立副本、未换方法/输入/模型、未重跑10；继续保留正在采集的数据。收口须修正上述错误测量门并对3/10/20原数据另名重算，完整保留原10轮失败及产品状态变化；不能把原退出码改成0或用新版报告掩盖原方法缺陷。

### 11.13 正式采集结果与测量收敛裁决

原正式采集终态：before03退出0（3/3、4调用）；before10退出1（10/10、15调用，准备/运行混判与暂定使命字段变化）；before20退出1（6/20、11调用，第7轮普通输入入口等待超时）。全部原始数据保留，3/10可用于同源重算；20未完整覆盖，不得签R01。

leader选择：保留10轮真实行为，不换样本；先修测量实现，再对已采集数据另名派生，最后单独登记一次20轮补采。`works.planning_direction.planning_mission` 的model/TENTATIVE落盘已有VS-00E §16.8 B与PlanningMissionRepo消费者；本次发生在第3/8轮，是否符合作者意图仍需审实际模型决策，不能把“TENTATIVE有合同”当成意图正确，也不能将其误称正式正文已采纳。

20轮失败的已证入口问题：第6轮最后原始AX（08:15:47.188）有真实窗口、完成的本轮过程，以及旧问题的“开始新讨论”/“回答并继续”，没有普通“发送”入口。新driver只依据前一轮outcome设needsNewDiscussion，没有依据**当前可见输入模式**准备下一条原文。应删除这份推导状态，复用现有普通composer判定与可见“开始新讨论”操作；先对真实AX回放和公共入口验证，等待作者的受控压力协议保持不变，不生成新答案或点击选项。输入准备等待也须留存最新原始AX，避免只记录模型阶段。

worker将超时后的无窗口观察解释为“窗口丢失原因”，leader不采纳该因果结论：无窗口观测在08:20:47.714，监督器已于08:20:47.514报maintenance_timeout，清理与失败抓取并发；现有证据不足以证明窗口先于超时丢失。是否还有独立窗口问题留作未验证，不能据此改产品或重启作者环境。

同批测量收敛还包括：本轮作者按root turn归属而非调用序号；准备完整性在start处验证，运行期revision/使命/会话变化分别如实记录；runtime事实中的adapter白名单只是预期，不得冒充Gateway实际路由观察，优先复用Gateway现有只读metadata/options。全部是外部测量责任修正，生产行为、源/输入/模型/窗口不改，旧报告不覆盖。修正后完成适用质量门与新增实体复用复核，再登记20轮补采。

**已核实的产品语义偏差（Before，不在R01偷偷修生产）**：before10第3轮判断调用 `pcall_mweotsr1_br` 的 `dialogue_goal` 明确为“卷级大纲候选、不新建章节”；实际规划使命请求却要求“下一批章节”，Writer `pcall_mweov6uc_mr` 的最新应用消息将固定“基于已读取的章节上下文生成章节大纲草稿”标为“应用据作者输入与已验证上下文归纳”的本轮目标，覆盖范围为多对象/多章；其实际产出为第03–05章候选。第8轮再次明确卷级目标，应用目标仍相同，模型这次产出了卷纲。对应固定生产入口为 `agent_run_flows/plot_outline_with_context.ex:93` 与 `chapter_mission_service.ex:139`，同源证据 `formal-before/leader-delegated-goal-review.json`。这是应用供给存在目标冲突的实证，不是“原文字节保留就意图正确”，也不凭两例宣称唯一因果或模型普遍质量。R02的来源类型与R05的专业任务材料必须承接该反例，修源头并迁移实际消费者，不能只给请求换JSON外观或增补提示语掩盖。

### 11.14 工程质量复核仍未闭合

method-v2及点击契约返工已终态，当前相关Node881项、后端compile/test/check、xref/arch与I1/I2/I3/N-NARR/I-CACHE均有成功日志；独立重算保留3/10完整与20的6/20不完整。原始AX node不可用诊断投影替代的反例已修，当前driver单文件CRAP最高9.5。仍不得签R01。

leader扩大到本次实际改动的共享owner后，发现前轮CRAP遗漏新增G2函数：`capabilityGapFacts` 23.1、`axTurnOutcome` 16.3、`statusTokenKind` 13.1；`observeNativeLifecycle` 30、`maybeHeartbeat` 12、`assertSnapshotRunInventory` 10.6仍须同批闭合。G2原有未修改函数的复杂度已登记[B84](B84-web-slow-tests-and-arch-debt.md#2026-11-13-b87-复核发现的既有-g2-判据复杂度未整改)，不冒充已通过，也不能拿该既有债务豁免本次新增代码。

变异报告此前将第三列误写为timeout，真实列名为 **Uncovered**；evidence组日志明确有两个R01新模块当时未读到覆盖，不是526次超时。leader以安装工具的真实covered_lines读取器复核当前新鲜LCOV：cost evidence711行、batch742行、G2 989行、driver444行可读（见 `method-v2/leader-mutation-coverage-probe.json`）；不能猜旧运行缺失的原因。下一轮需绑定测试/源码/coverage哈希、按完整新增或修改函数明确范围，逐一处理未杀死的非等价变异，不用局部高分代替完整门。静态扫描当前另有最终task-done manifest待生成，6条既有gitleaks处置不改。

另收敛残留的双重可见性判据：实际推进已用AX作者归属，但driver的freshness及verifier仍消费flat字符串出现次数/尾部变化。以真实AX作者边界与已落盘原始观察作为唯一依据，删除这份近似计数的门，不为模型引用作者原话或历史过程折叠引入伪失败；现有原始观察足以离线重算，原driver字段只作为旧报告事实留存，不续造兼容运行分支。

### 11.15 变异测试环境的独立控制组复核

cost-batch单元报告469/469 killed，I/O单元报告372 killed+1等价；普通测试及原始数据保护证据保留。但leader没有仅据计数签门：快照中两个位于changed保护内的时间比较有相同等价推理，工具却一杀一存活，故增加独立控制。

使用安装工具**原create_workers**构造隔离树、目标源码不做任何变异：原目录命令exit0；snapshot目标的未变隔离树exit0；cost evidence目标的未变隔离树exit1，具体是两个相对manifest的CLI用例在另一个根目录读文件而ENOENT（`quality-closure/leader-overlay-controls/result.json`及日志）。这是当前环境中已复现的控制失败，不推定历史每个KILLED均错误，但缺未变控制组时不能排除非变异原因。

仅在测试子进程使用Node的`--preserve-symlinks --preserve-symlinks-main`，同一未变隔离树恢复exit0；将真实`unclassifiedMessages === 0`判据反转的副本exit1。原工具、全局配置、项目源均未改，证据 `logical-resolution-controls.json`。后续需对当前质量范围先核同命令未变控制组，再执行站点，并分清断言发现、隔离路径故障与资源超时；不把任意非零退出都当作可靠击杀。源码/测试/coverage哈希之外，需记录本次测试进程解析配置与隔离控制，旧结果不覆盖。

### 11.16 远端同步与项目画像消费

按维护者2026-11-13指令获取远端，保留本地R00提交后合入`a43d374c`，当前同步提交`e0976d98`；新增内容仅为项目画像、索引、接入任务和专项CI，无产品代码变化。46个WIP已先归档再stash，恢复后45个文件字节一致，AGENTS原4行增量完整叠加，0冲突；证据 `artifacts/git-sync/20261113T105225Z/restore-verification.json`。原stash与归档保留，未重写R00或旧基线提交。

已读取AGENTS指定的唯一[项目画像](../../docs/engineering/project-operating-profile.yaml)及AIEF规范。当前任务继续执行已授权B87范围：保护真实作者数据和质量证据，复用现役实体，清理无消费者兼容路径，按实际风险控制测试工具复杂度；不因未发布推定数据库可重置，不把部署/恢复/Schema责任的unknown当none。不修改画像人工确认值、不建context树、不运行Retrofit或安装新依赖。本次读取与取舍不等于AIEF模型效果实验通过，画像接入任务状态仍在原任务。

### 11.17 当前复核结果与可复现性修复

资格化变异运行完成：12个目标未变隔离控制exit0，11个有站点目标的业务负控制exit1；1050站点中883 killed、167 survived，worker判27个等价、140个未闭合/待分类。**这不是通过结论**：leader还要求复核snapshot投影分支的等价依据，按真实producer/consumer值域删死逻辑、补有效反例；禁止为分数制造不可达输入。此前“全杀”计数不作为当前门禁。证据在 `quality-closure/qualified-mutation/`，后续修复及复跑在 `quality-closure/reachable-quality/`，不覆盖原结果。

独立发现并修复CLI测试依赖ignored真实candidate的可移植性问题：复用既有manifest合成对象，提取到 `scripts/lib/native_ui/fixtures/request_cost_manifest_fixture.mjs` 并删除原内联复制；CLI不再读取作者真实数据，临时目录自行创建并清理，保留无`./`的相对路径和含空格子进程用例。worker在无artifacts的源码副本复现旧失败后修复；leader审阅关键文件并在该无symlink副本复跑11/11、exit0，核对测试/fixture字节一致且无临时残留。证据 `quality-closure/cli-self-contained/leader-clean-review.json`。这是R01内部验证修复，不是新的正式完成批次。

已完成before03/before10共13轮、19次调用的独立目标对账，证据 `formal-before/leader-before03-before10-goal-review.json`。冻结DB只读查询核实2个章条目、1章含2场已采纳正文（4183字符，去空白标点3204字符）；两批章数回答与此一致。原请求显示第2轮已重带旧Scope，before10第10轮累计15份Scope、其content共366500 UTF-8字节，单次input由10790增至117683 tokens；这些不是原始网络字节或分组tokens。已知目标传递偏差仍见§11.13，本次只补齐逐轮页面/请求/状态证据，不重复登记为新缺陷。第8轮“登记到档案侧”的主回复与待采纳状态不一致，后续状态表述验收需承接；未观察到因此完成作者采纳或章结构变化。

当前仍为R01 doing：3/10已完整采集，旧20保持6/20；剩余质量门、单独登记20补采、完整语义与最终静态扫描/任务收口尚未完成。R02–R19未实施。进度汇报区分新发现、已知问题补证和已修复，不将同一失败样本的重复核验写成新进展。

### 11.18 执行收敛纠正（作者指出死循环风险）

作者指出的不是汇报措辞，而是执行是否陷入循环。leader复查后确认：R01测量实现及测试不断扩张，先前未可靠的质量计数导致重复复跑；新一轮又添加了与既有用例相同的缺body测试，以及被`readAuthoringHistory`入口校验排除的`transcript.messages=[null]`内部输入。不能将测试数量或变异击杀数量增长当成向目标收敛。

已主动取消广泛补测试任务`241ed351-28de-44c2-b9c2-a65a0edeb062`，保留所有改动与中间证据；这是执行策略纠正，不是worker超时或外部阻塞，不暂停B87目标。其未完成变异运行不得记通过。

后续严格沿已有R01职责收口：先清除已证无生产者的兼容分支和重复/不可达测试，再以固定的真实来源、身份绑定、成本缺测、完整快照、真实页面终态判据验收；质量工具验证这些判据，不另造需求。明确发现：`prepareBatch`只产出`author_id`，测量报告却接受`authorId`并为其写兼容测试；`readAuthoringHistory`已保证消息为map，consumer不应再为null消息提供第二套容错。按源头契约删除，保留入口对损坏证据的失败行为。

R01退出条件保持原范围：可靠测量及适用质量门完成 → 单独登记并完成20轮补采（保留旧6/20）→ 独立语义对账、静态扫描与任务收口 → 本批提交。已完整的3/10不重调模型；已验且未变化的目标不重跑；新问题仅在影响上述判据、作者数据或本次改动正确性时阻断，不能用无关扩展推迟退出，也不能降低门槛签PASS。

### 11.19 删减验收与20轮补采登记

batch契约收敛单元已验：仅修改batch测量源与测试，删除3处无生产者兼容/内部重复防御，测试45→42；leader审阅差异并独立复跑相关119项、exit0。3个完整改动函数CRAP均<10、Dryer无新增重复，资格化变异5 killed+1已证对象/undefined域等价；原199个批次文件未变，目标映射保持一致。证据 `quality-closure/batch-contract-subtraction/`。该单元退出，不再继续追加改进；其它未闭合质量项未被代签。

修正此前把全部报表质量复核串行放在原始数据采集之前的安排：**采集安全/入口门通过后可取得真实数据，最终报告质量门仍在R01验收提交前强制完成**。当前驱动、等待、快照、manifest/runtime源码哈希与已审控制组一致，公开20轮preflight退出0、冻结源哈希不变，生产路径相对原基线无变化。预检CLI无stdout协议；leader展示包装曾误按JSON解码空stdout，CLI本身退出0，原记录保留，不改CLI为该包装配合。

单独登记 `formal-before/registration-before20-r1.json`（SHA `55444d3f127307f2fc26d1a08d4eb41fb2a223e70229f009b664d9d0c639301c`）：只执行1批20轮、tag `before20-r1`、0自动重试；沿用原冻结manifest/输入/模型/完整源副本，冻结29个测量文件哈希。旧3/10不重跑，旧6/20保留；采集期间不修改测量源码，任何失败如实保存，不现场换输入、补答案或修脚本重跑。此登记不代表20轮完成，也不签R01。

该批已由DSH任务`2a44960d-4adc-4d4d-8e90-605ff4476b0e`启动；恢复时查询同一任务/进程，不因观察超时重新启动。原始证据目录 `artifacts/slice-verify/b87-r01-request-cost-live-20-before20-r1/`，仅批次终态后签发送/完成及调用关联数量。

等待采集期间对snapshot投影的争议完成一次独立确认：全量脚本字节副本、无symlink回原库，当前公开snapshot测试中性组exit0；把`fields.length === 0`分别改为`!== 0`和`=== 1`，均因“works.updated_at不应改变内容canon”的业务断言exit1。证据 `quality-closure/snapshot-projection-control/`。因此这两处不能按前轮报告视为等价/缺测试；当前用例已保护，不再增加相同测试或修改正确实现。该结论仅覆盖这两处，不代签其余变异项。

### 11.20 正式3/10/20采集闭合，最终工程门仍开放

`before20-r1`仅执行一次，runner退出0；20条普通作者输入均送达并取得页面终态，20个root为19 completed+1 awaiting_author，25个ProviderRun为completed、25份ProviderOutput为ok、25条完成日志为HTTP 200。页面为16 completed、3 capability_gap、1 waiting，不能写成20个作者目标完成。input 2660608、cached 2121824（input子集）、output 33263；29个方法文件及冻结源哈希不变，旧199个批次文件未变；本批进程已收尾。worker证据 `formal-before/before20-r1-result.json`。

leader独立读取原始Phoenix发送帧，并在DB/WAL字节副本中只读对账全部输入→root→持久step→ProviderRun→输出→调用日志，同时复核每轮AX终态与截图：`formal-before/leader-before20-r1-readback/result.json`（SHA `3a1a4efb8ca4eb2854b0111aa211b6cdc7ed9b0c6cae0110d3e578b6be1042c2`）。两个Writer日志使用真实子步骤turn id，通过ProviderRun.step_id与持久sequence绑定，不能强令其等于根作者turn id；leader原过严断言的纠正已记录，不靠前缀猜归属。DB的completed_at/finalized_at为空，未补造时间；终态用持久状态、输出记录、完成日志和页面共同证明。

20轮逐项独立目标审阅已落 `formal-before/leader-before20-r1-goal-review.json`（SHA `1e5faacbe642c02925b73caf6af5f11ed36bc44b9972084e7f81880e3d9ef37e`），连同原3/10共33条输入的正式基线审阅。第5/6轮复现§11.13同类目标传递冲突，不另计新缺陷；7次章数回答均与2条目/1章正文相符。卷纲移出阅读仍未实现，候选未采纳；带卷级标题不能代签采纳后的真实层级效果。运行期仅works的canon哈希改变（模型TENTATIVE规划使命、revision到4），各类产量不变，未把设计态变化误报成正式采纳。

当前完整基线为before03、before10、before20-r1；旧before20的6/20保留为失败证据。最后一调用input227833、25份Scope文本共772324 UTF-8字节，首调用input10789、1份Scope18897字节；未到窗口溢出，不冒充压缩完整性证明。接下来只收口本次测量实现的必要质量缺口及最终静态扫描/任务提交，不再为本基线重调模型；R01仍doing，R02尚未实施。

2026-11-13 作者随后暂停原推进，并要求先整体审查测试体系。测试入口、fixture和环境作用域的跨项目设计/迁移统一归 [B84](B84-web-slow-tests-and-arch-debt.md)，不能只给R01补清理后恢复原整组变异循环。R01未提交实现及原始基线继续保留；工程质量未签，不能由B84的设计文档代签。当前只完成审查/设计，不恢复模型采集或广泛变异执行。

### 11.21 R01 工程收口接续（2026-11-14）

本轮按维护者对 NEXT 的推进授权，先收口 R01，再依原依赖推进后续批次。开工基线为 `a6f1e6a650454ee7e5a73f2f109b6a5aef04e76e`，分支 `develop/dialogue-based-novel-workbench`。工作区已有 53 项修改/未跟踪文件，包含 R01 测量实现及 B84 审查记录；只处理并提交已核实属于本批的内容，保留其他工作。原 §11.20 的停止广泛变异/模型重采约束继续有效。

本批七问与存在性复核：

| 项 | 当前执行边界 |
|---|---|
| Contract | R01 可靠成本基线、VS-00L 的 Canonical IR / 原生 wire 来源与既有 request-cost 报告口径。 |
| Invariant | 作者身份/字节不混同应用材料；System/Tools/Scope/History/Observation/Validation 成本按真实载体归属；cached 是 input 子集；缺证不补造；源库及原始批次不变。 |
| Boundary | 仅 `scripts/` 测量/测试与现有质量注册、任务记录；生产 Prompt、IR、Provider、数据模型与前端均不改变。 |
| Consumer | 现有 `request_cost_baseline.mjs`、`request_cost_capture.mjs` 与 `request_cost_batch_evidence.mjs`，供 R02–R19 同口径对比。 |
| Proof | 真实源 SHA 与旧批次只读核对、邻接纯规则/IO 反例、`mix check`、统一静态扫描及适用门禁；不用测试数量替代来源/分类判断。 |
| Acceptance Driver | 复用 `native_request_cost_batch.sh` / `native_request_cost_drive.mjs`；已冻结的 3/10/20 页面与实模证据保持原样，本轮不重采。报告派生修复只重算，不把测量完成写成作者目标完成。 |
| Exploration | 不适用：本批不物化作品要素、不改变模型获得作品知识的入口。 |
| Existence audit | 无新增产品实体/字段/模块。成本修复归现有 `request_cost_evidence.mjs`，公共消息读取仍归 `authoring_request_facts.mjs`；不新增第二成本分析器或旧格式 fallback。索引状态只纠正导航，不复制执行台账。 |

已复跑 R01 邻接 Node 测试 306/306（0 skip）；退役无消费者分支后的成本/批次判据 77/77；新增他作记账隔离矩阵后 capture IO 29/29。`mix check` 退出 0（3208 项 Elixir 测试，含全量强制编译、枚举/作者可见 codegen、xref、架构/ADR/I-CACHE）。证据统一位于 `artifacts/model-contracts/b87-r01/20261114-quality-closeout/`。

**存在性与删减裁决**：两个真实成本消费者都提供 native Chat wire，Canonical IR 的顶层 System/混合 tool blocks 成本路径只有测试消费者。按 YAGNI / 单一职责退役成本模块中的 IR 分类、自动可信来源和仅测试使用的包装导出，其他格式显式 `request_cost_requires_native_chat_wire`；共用 `authoring_request_facts` 的 IR 读取仍有 B71 等真实消费者，继续保留。没有增加第二分析器。前后 44 次冻结真实调用的完整 analysis 逐项相同，6 个原始日志/报告 hash 不变，证据 `20261113/quality-closure/cost-wire-retirement-20261114/comparison.json`。本轮不调用模型、不重采 3/10/20、不重写作者原始数据。

**历史质量清单的收口方法**：§11.17 的 140 是旧 qualified 源码/测试范围下的 `unclosed_or_unclassified`，保留原数，不能改写为当前 140 个实现缺陷或 0。复用匹配源码的 B84 capture/snapshot 实际 DB、初末快照、缺证和零值独立证明，以及 `batch-contract-subtraction`、`snapshot-projection-control` 和真实成功 preflight；不复用缺源码 hash/neutral control 的 `reachable-quality/` 裸计数。唯一发现的当前可达独立断言缺口已补：在公共 `verifyBatch` 下，他作不变、仅 `reference_count` 改变、仅 `last_referenced_at` 改变三个场景均不增加日志，精确断言 `other_work_reference_bookkeeping_intact` 与对应错误；完整采集与产品偏离仍分开，模型/语义不自签。没有恢复全范围变异，也不声称 mutation 100%。提交前只清理了 capture/manifest/test 末尾空行，业务内容不变；当前 hash 以 closeout 记录为准。

**适用质量门与限制**：13 个必要源文件的本次 CRAP 计算最高新增/修改函数为 9.5339；全文件工具仍退出 2，因为 20 个已有超限函数的函数体相对开工 HEAD 完全相同（`crap-range-review.json`），不把全文件结果伪报通过。Dryer 0.8 阈值无重复候选，13 份 .mjs→.ts 镜像逐字节一致。源库 SHA 仍为 `c5732f99ca320ad526069d8b578162265eac1e481ba8d15e24760e8657a559db`，240 行引用 UUID 无损核验通过；235 个质量 manifest 与 NEXT 检查通过。统一 `task_done.sh` 退出 0，I1/I2/I3/N-NARR/I-CACHE、编译/架构/前端及安全处置门均执行；原始 gitleaks 仍有 6 条已登记历史命中，0 条触及本批文件，不能写成扫描器全部绿色。

**邻接整组失败如实保留**：首次扩展 Node 回归因 PATH 选到无 PyYAML 的系统 Python 有 2 项加载失败，纠正 PATH 后为 1001/1002、0 skip，唯一失败为旧 G6 `C10_cleanup`。其 evaluator 直接检查宿主 4657/4661，同组既有 memory-detail 测试会真实监听这两端口；三份相关源码均未变。唯一一次有观测的单文件诊断为 13/13，57 次 pgrep/lsof 均无进程/监听，源码和原失败日志 hash 未变。原批次没有 C10.detail/PID/观测时间，不能声称还原原失败 PID，也不能以隔离通过覆盖整组失败。该既有测试资源边界由 B84 后续治理，本批不新增兼容/放宽断言；原失败保存在 `node-g6-cleanup-failure.log`，不代签全仓 clean。

**R01 Outcome：PASS（仅可靠测量基线与本批工程实现）**。3/10/20 共 33 条输入、44 次真实调用及独立目标审阅承接 §11.20，旧 6/20 失败保留；卷纲移出阅读等产品目标仍未完成。R01 五组代码提交为：

| 提交 | 可审阅职责 |
|---|---|
| `da9c38accfd7486bb46d887f1cbdd2fbb69d8e11` | 本轮 AX 作者归属、可见终态与外部等待生命周期。 |
| `19febf1319f641600a8dc283b654480514fd6b77` | 原生请求成本、实验 recipe、manifest 与纯批次判据。 |
| `5f4640e012e2cbe1a4381827e675454bc4ef8b7c` | 完整快照、实际运行清单安全与共享无损引用读取。 |
| `524a523c94899628b5828dec460d7002865df70c` | prepare/capture/verify CLI、调用身份对账及独立 IO 反例。 |
| `b612e91e168106d71a989cee4a1302cff452a797` | 既有 Tauri runner 的受控多轮驱动、运行事实与显式质量注册。 |

提交使用普通 Git hooks，没有 `--no-verify`；全局 hook 提示本项目无 lefthook 配置而退出 0，真实验证以上述显式命令为准，不拿 commit 成功代替门禁。B84/AGENTS/历史扫描处置的原有 WIP 保留未纳入。后继为 R02：先在既有设计冻结结构化 Scope 字段与来源，再同批迁移全部现役生产者/三 wire/codec，保留原始 canonical 历史，不提前跳过 R03/R04 压缩契约。

## 12. 跨任务登记更正：REV-02 页面复验归因

> 2026-11-14 整改后独立复核更正。本节保留跨任务来由，不改变 R01/R02 或其他 B87 批次目标。B84 的整改状态仍只在 [B84 原任务](B84-web-slow-tests-and-arch-debt.md) 维护。

- **原判断撤回**：此前将普通对话页面失败确诊为“生产缺少 stage_sink 注入，ProviderRun/Event/Output 从未落库”，并建议新增或前置产品接线批次。该确诊已被独立复核否定；原始判断与当时记录保留在[审查报告 §8](../../reports/2026-11-14-b84-implementation-review.md#8-处理结果2026-11-14整改实施后)。
- **代码事实**：`AgentRunServer.step_snapshot` 已构造 sink 并传给 executor（`apps/novel_application/lib/novel_application/agent_run_server.ex` 3442–3453、904–908 行）；“生产没有注入调用点”不成立。
- **运行证据**：历史 backend.log 有 ProviderRun/ProviderOutput 的 QUERY OK 写入，output 带 usage；ui-frames 的 6 条进度事件属于同一 ProviderRun，不能当成 6 次调用。历史失败消息在当前 driver 中对应 `queriedProviderRuns.length >= 3`，此前的 started/final/ref 判据已在同一顺序路径执行；不能解释成 ProviderRun 必然为 0。日志写入、帧、API 判据各自的证明边界见[报告 §9.8](../../reports/2026-11-14-b84-implementation-review.md#98-撤回缺少-stage_sink-导致未持久化的归因)。
- **空库解释边界**：该场景为非系统原生 Tauri dev 路径，EXIT cleanup 会重建 DB；退出后 0 行不能倒推运行期间未落库。后续复验应在 cleanup 之前保存必要的持久与查询证据，不能用清理后的库确诊产品接线缺失。
- **下一步判据**：由 B84 REV-02 先对照现行愿景、设计、调用契约与场景目标，核对调用数量、purpose、usage、当前 run 绑定与恢复语义，区分场景漂移、执行覆盖不足和 API 投影遗漏；不直接把 >=3 降成 >=1，也不增加无业务意义调用凑数。
- **B87 批次后果**：撤回基于旧确诊提出的“新增 sink 接线批次”建议；本轮没有新增、前置或改写 B87 批次，也没有修改生产代码。只有后续证据确认真实产品缺口，才按实际责任层另行归属，不能沿本次错误归因派生实现。
- **关联与证据**：[B84 任务](B84-web-slow-tests-and-arch-debt.md) REV-02；[报告 §9](../../reports/2026-11-14-b84-implementation-review.md#9-整改后独立复核与交接)；`quality/acceptance/scenarios/agent-provider-execution-activity-restored.yml`；历史 `artifacts/slice-verify/agent-provider-execution-activity-restored-tauri/`。本轮为只读复核与文档更正，未重跑页面。

## 13. R02 源头结构化实施（2026-11-14）

开工基线 `ecf29a75ae73967f9dcbab03b2f8fb8a624de0ec`，R01 已按 §11.21 闭环；5 项既有 AGENTS/B84/扫描处置 WIP 保留。R02 使用独立实施上下文，先在 VS-00M §5.2.1 / VS-00L §19.2 冻结字段与来源，并同步 R02 卡的实际跨层边界，再改代码。R02 当前已 PASS，最终裁决与后继边界见 §13.10；§13.1–§13.9 保留实施过程、原失败及恢复记录，不以最终通过覆盖历史。

| 七问 / 存在性 | 本批边界 |
|---|---|
| Contract | 复用 RequestIR/Transcript/DialogueContext/ContextSourceRef/AuthoringTask；新增唯一 `scope_update/application` 的 `scope.content` JSON 块，沿既有 codec 与公共三 wire renderer。 |
| Invariant | 作者原文来自真实 Interaction/receipt，空白仅校验不改字节；事实/目标/派生上下文/真实工具观察分立；缺读、失败与成功空集合不混同；保留原始 canonical 历史。 |
| Boundary | common 纯值/投影，domain DTO，persistence 已有事实读侧，application 组装/来源绑定，agent 专业入口，必要 frontend 自由答复入口及实际验收消费者同批迁移。无新存储、第二 Request、授权策略或压缩器。 |
| Consumer | JudgmentProtocol 和 Operation 两条生产链；三 wire/checkpoint；既有 B71/R01 外部验收读侧。 |
| Proof | 事实/ref/版本/覆盖负例、作者原字节、codec、三 wire、现役专业调用和外部真实工作台对账；不以 JSON 外观或测试数量证明目标。 |
| Acceptance Driver | 复用既有 Tauri/native driver 和冻结完整副本，在全新 R02 路径取 3 轮证据；作者自由答复另核对 raw 输入至 Interaction/canonical/wire，不重跑 R01 的 20 轮。 |
| Exploration | 不物化新作品要素；当前索引与未读正文明确分开，仍经既有工具读取并以真实 call_id 回流 Observation。 |
| Existence audit | IR scope 块是现有 text 无法保留结构的最小增量；无平行实体。删除 tuple/arity 兼容与旧 Scope 拼串生产入口；仍有真实专业消费者的 DialogueContext 文本职责保留，但缺状态不再假装 empty。Node 的 `scopeContent` 仅由现有唯一 reader 从原块/公共 wire 载荷派生，不持久化、不复制状态、不做旧自然语言语义 fallback。 |

并行职责明确：common 契约/三 wire/Operation；上下文与作者来源生产链；frontend 原字节入口；外部 Node 证据消费者。任务状态与提交由 leader 统一维护，禁止并行修改同一文件。实际数据库版本与授权检查留在持有事实的现有责任方；common 只做 JSON/角色/来源/值间一致性，不能用初始授权版本冒充新快照或阻断合法版本推进。

### 13.1 跨层设计裁决与删旧边界

本批按“真实来源 → canonical IR → 公共投影 → 实际消费者”审查。结构化 Scope 是现有 RequestIR message 的唯一原生块，不建立第二 Request、材料总线、来源注册表或数据库模型；原始历史文本仍是可审计原证据，现役生产与判据不再把旧标题/段落解析成事实。R03/R04 的覆盖、压缩与 checkpoint 优化没有提前实施。

- **事实读取**：沿用 DialogueContext/WorkspaceContext/ContextAssembler，唯一作品身份为 work_id。读取端返回单一 DTO，删除 tuple/arity 多形状与 workspace_id 误名回退。成功读到空集合、未读、部分、不可用和过期分别表达；不能由标题或缺字段推定已有正文、零计数或完整覆盖。 DPS/Prose 当前消费点只使用 run.work_id；启动 spec 删除 workspace 代填，缺失作品身份沿既有 AgentRun required 校验拒绝。两个独立 mechanical profile 的 Channel 启动动作不进入当前 Judgment/Prose 链，未据此宣称全仓身份债务清零。
- **作者来源**：TurnInteractionService 一次选取同一条 text/turn_id；首轮来自显式原始命令，后续严格绑定 work/session/run/turn 的真实 Interaction receipt。planner、mission、直接专业 flow、修订、确认子 run 与 Prose continuation 共同消费，删除 goal/preview/旧 closure 补原文。AuthoringSession/Transcript 对同引用同字节幂等，对同引用异字节拒绝。 最终复核发现并删除 Operation 的 parent_turn_ref 回填与无引用作者入口；现有 RequestIR 的私有文本操作作者构造器提升为 Operation、text_operation、Judgment/Transcript 共用的可失败纯契约。两者同时 nil 或完整非空白配对才合法，continued 也先校验，不在 common 代行作者追加。Quality/辅助叙述的作者引用统一读取已有 AuthoringTask.source.author_action，待评审材料回合和质量触发来源不替代作者输入；原私有重复读取同批退役。 Judgment/Transcript 删除占位作者来源及合成 run 身份；新调用必须使用实际 plan_run 或既有 transcript，纯应用 continuation 允许明确无作者。
- **应用材料**：专业执行的组合目标、AgentStep、观察与 guidance 归入既有 creative_brief；AuthoringTask.author_words 只保存显式原文，Scope 投影排除该字段。修订的原稿、格式边界、完整覆盖及原生失败回流继续保留，不能用结构化迁移删减材料或纠错证据。
- **来源与 Base**：复用既有 source_refs/base_refs/observation_refs，不按引用前缀猜可信度。Operation.source_refs 仅表示来源，显式 base_refs 只来自实际供应材料。Real/Quality 复用 AuthoringTask.material_refs，使命使用 ChapterMissionInputs.items，计划使用实读章节；作者来源和仅提及的目标不自动升格为 Base 或 Observation。 续行链复核确认计划/全部观察关联曾被误登记为 Base；沿现有 input 拆分 scope_source_refs 与 supplied_context_refs，Transcript 使用显式 append_scope_update/5，普通来源和实际材料分别传递。同 Scope 新供应材料必须更新 Base。Prose 末六条摘要不等于完整计划、全部观察或 evidence 对象已供应，保留真实 Observation 与原 Base，不建立新来源 owner。
- **辅助叙述**：复用 AuthoringSemantics.static_block/dynamic_block 与 RequestIR.Operation.text_operation。稳定规则进入 system；动态任务与真实工具结果属于 application；作者原文与同一输入引用进入独立 author 消息。AuxTaskBuilder 的旧 author_words 输入入口退役；无作者任务明确传 nil，不从应用目标或 frame/tool/provider 引用补造作者。
- **证据消费**：Node 唯一 reader 读取原生块或公共 wire JSON 载荷；语义断言由现有 scopeForProviderCall 绑定 pcall/prun、canonical 前缀、完整 Scope 序列、版本与来源。作者粘贴同字节 renderer 文本不能获得应用 provenance。原有交错恢复判据按职责拆分，保留原文、观察、checkpoint covers、ACK 与调用归属反例。

读侧严格区分“Scope 已绑定”与“同次调用的 Base 登记可证”。真实 HTTP 日志没有逐调用 IR.refs.base_refs 时，L7 返回 request_base_refs_unavailable/unknown；最终 segment 的累计 Base 不能倒填早期请求，机制总结果不代签 L7。该取证限制必须随实际验收报告保留，不以测试数量或合成 wire 证明真实 Provider 行为。

前端当前回答入口为单行 input。本批删除自由答复的 trim，保留空白输入校验；真实页面只验证可达的单行前后空白与 Unicode。LF/CRLF 的 receipt/canonical 保真及三 wire 机械投影独立记录，不能说成已从该单行页面输入多行。

### 13.2 最终门禁后的职责复核（2026-11-15，实施前裁决）

完整扫描报告的新增复杂度与规模问题必须通过职责调整消除，不修改 module-size 基线、豁免、Credo 阈值或历史处置台账。以下存在性审计与七问在新增实体前完成；生产函数迁移保持既有字段、错误顺序、原文字节与真实来源不变量。

| 边界 / 已有实体审计 | 裁决与消费链 | 证明与退役 |
|---|---|---|
| RequestIR 的 Scope 纯值责任 | 已检查 RequestIR.SystemEnvelope/Tools/Operation/Compaction/Projection；业务 VolumeScope/ChapterRevisionScope 不承担 canonical Scope。唯一新增 RequestIR.Scope，负责原生块构造、JSON/绑定/覆盖校验及 Scope revision/append；RequestIR 组合调用，保留唯一消息契约，不增加 DTO、存储或并行投影。 | 保持 validate 的原错误优先级；现有三 wire、codec、绑定/覆盖负例与 I-CACHE 证明行为。删除 parent 内迁出的实现，不保留新旧两套。 |
| 独立文本操作 | 已有 RequestIR.Operation 是纯请求构造 owner；text_operation 整体移入该模块，Planner/ChapterSummaryGenerator/FactInventoryService 与既有测试直接消费。 | 删除 RequestIR.text_operation 旧入口，不设兼容转发；纯应用调用及显式作者配对/原字节契约不变。 |
| 判断静态规则 | 已有 AuthoringTaskPolicy 负责判断/计划专属规则，接收 JudgmentProtocol 的 judgment_scope_rules 与 TurnInteractionService 的 discussion_only?；不放入只定义工具 schema 的 JudgmentToolContract。 | 所有现役调用直接迁移；规则正文和拼接顺序不变，已存在的规则 hash 语义须明确保持或按真实输入同步验证。 |
| 作者原文登记 | Persistence.AuthorContentRegistration 只负责事务内物化防重，不能持有应用判断规则。唯一新增 NovelApplication.AuthorContentRegistration，接收登记来源选择、合法性、来源物化检查、静态规则和安全失败说明；现有 Interaction 接收/receipt/作者输入仍归 TurnInteractionService。 | DPS/JudgmentProtocol/AgentRunServer 等现役消费者直接迁移，不留 TurnInteractionService 登记转发。原始登记/重复/历史来源负例完整保留，持久事务、采纳与授权不变。 |
| 执行输入与外部替身 | TurnExecutionService 已有作者输入选择和 AuthoringSession 追加，分成同一模块内的私有职责；SliceVerify 只在既有调用链求一次 canonical/material 来源并传递。 | 无新公共实体或验收入口；保留现役 frame/source 输入绑定、分支优先级与断言，禁止用减少场景降低复杂度。 |

Contract 仍为 VS-00L/VS-00M 的同一 IR 与来源契约；Invariant 为来源、身份、版本、作者原字节及历史不可改写；Boundary 为 common 纯值、application 业务规则与 persistence 事务各归原层；Consumer 已枚举并须全量迁移。Proof 由现有负例、完整 Mix 与默认静态扫描给出；Acceptance Driver 继续复用真实原生链，当前首次 activate 的 macOS 权限拒绝不由替身代签；Exploration 不增加读取、材料物化或业务能力。

测试存在性复核（先于迁移）：Gateway 的 execution refs 场景归已有 gateway_execution_refs；AuthoringTranscript 的显式压缩归已有 transcript_compaction；Judgment 的 B71 IR 场景归已有 judgment_initial_snapshot；B28 单候选契约归已有 b28_adoption_contract；Pending 中的 B30 维护归已有 b30_chapter_structure_maintenance；Workspace 的 recorder 链归已有 MemoryLogTest。迁移前同时核对接收模块的现行规模，不能把超限转移到另一文件。

仅新增三个缺少既有 owner 的测试模块：DialogueRunSpecTest 承接 DPS spec 的预算/身份契约（不复制执行 flow）；AuthorContentRegistrationTest 对应本节已审计的应用登记 owner（消息处置计数/正文预览仍在原测试）；AgentRunProseContinuationTest 承接真实 continuation 回调生命周期、settled 零调用及 Base/Scope/末六条摘要边界。已有 B27 测试只负责判断材料投影，不承接该执行生命周期。所有测试连同各自必需 fixture/helper 整组迁移，保留原断言、异步/隔离约束与场景优先级；既有可复用 setup/helper 优先直接使用，不为规模门禁删除断言或重复大型 fixture。

独立复核要求 Prose continuation 保留原有非空 current_chapters、structured_chapters 与完整 plan_direction。已确认现有 NovelApplication.TestAgenticLoopFixtures（test_helper.exs）承担同类执行夹具，尚无等价 context 函数；在该 owner 中收敛原完整 context 字面量，原 flow 与新 continuation 共同调用并保持原 work_id/字段/字节。不开新 fixture 模块，不缩减场景。

### 13.3 原生验收阻塞与恢复入口（2026-11-15）

`artifacts/model-contracts/b87-r02/20261114/native-question-01/` 是本批第一次真实 B26 原生尝试，源码绑定见 `quality/final-gate-code-manifest-pre-native.json`。debug `.app` 已成功构建并启动，但第一个 `activate` 在既有 NativeInputBoundary 被 `ax_trust_required` 拒绝，`ax_trusted=false / post_access=false`，截图也未成功。13 条 transport 记录中只发送 join/review/coordinate 查询，作者 `user_message/author_action/agent_command` 为 **0**，完成 roundtrip 为 **0**；没有 summary、native-ui-complete 或 derived wire 输出。不能称页面已通过，也不以启动或种子历史冒充新作者输入。

- 原始 runner `wc_job_R65w7o7v5yJRyABM` 已终止，exit 1；cleanup `remaining=[]`，受控端口 4657/4661 已关闭。没有重发作者请求或重跑 R01 的 20 轮。Splash 三轮尚未启动；该次尝试时，同宿主/同驱动的首个受保护动作受到相同权限边界限制，不是一次三轮实测结果。
- macOS unified log 将责任主体绑定到 `dev.webcodex.runner`，路径为 `/Users/loong/.local/share/webcodex-pkg/node_modules/@yyjeqhc/webcodex/vendor/bin/webcodex-runner`。首次失败后的恢复要求是在系统设置「隐私与安全性」为该实际宿主开启「辅助功能」及「屏幕录制」（系统名称可能为「屏幕与系统音频录制」），按系统提示重新启动宿主；当前仅屏幕录制未恢复，最新复查见下文及 §13.6。未访问或修改 TCC 数据库，未绕过系统授权；未把更新时刻推断成未经证明的故障根因。
- 精确证据：`quality/b26-r02-native-blocker.json`，SHA-256 `4e0e1d01c11297302c937a1525eb4263259643a925a1f3623382674eed3ab729`；对应 `quality/b26-r02-ax-authorization.log` 保留原始授权日志。日志未出现模型调用标记，但一次 DB 查询未打开其假设路径，因此 **不声明数据库 provider_runs=0**。
- 恢复时先确认正常系统权限，再对当时最终源码建立新 fence，在全新 B26 目录重跑现有问题选择与自由答复脚本；原失败目录只读保留。自由答复沿当前真实单行入口验证首尾空格及 Unicode，实际 ACK/action/question/submission/run/source 必须同源绑定，LF/CRLF 仍只由独立后端/机械投影证明。
- B26 真实回路通过后，沿 R01 不可变 manifest 与完整副本运行既有 `b87-r01-request-cost` 驱动的 R02 三轮：首次三条冻结输入、Splash Q4-PLE4、thinking high、max 32000、timeout 300000、context 262144、retry 0；使用新 R02 artifact 路径，不覆盖 R01。真实 HTTP 缺同调用 `IR.refs.base_refs` 的 L7 保持 `request_base_refs_unavailable / unknown`，最终累计 Base、确定性前缀或 derived wire 均不代签。

本轮默认完整静态扫描的 task-done 直接失败是旧 `20261114T161400Z` manifest 已过期，检查尚未进入 Native evidence；不能把该 raw failure 改写成直接 AX 失败。真实 AX 阻塞与 stale manifest 分别保留。没有成功原生 summary 时，不复用旧成功材料或生成通过 manifest；R02 不签 PASS、不推进 R03。

**恢复前复核（2026-11-15 13:24，Asia/Shanghai）**：在提交 `d16b59424d8f209c1f0816093f35cb0fea7c01b8` 上重新核对，193 个代码路径与最终 fence 一致，5 份作者既有 WIP 未变。只读系统 preflight 得到 `ax_trusted=true / post_access=true / screen_capture=false`；unified log 将三项检查都归到上述同一 `dev.webcodex.runner`。辅助功能已恢复，当前阻塞收窄为屏幕录制。证据为 `quality/native-permission-preflight-20261115T052436Z.json` 及同名前缀的 `-tcc.log`；本次未启动新 B26/Splash 批次、未发送作者输入。

恢复前独立审查发现既有 B26 checker 允许 `screenshots=[]` 空集合通过，准备的外部编排也未要求每次 capture 成功、未排除续行再次停等，并未调用已存在的完整 Scope 序列判据。修复前裁决：Contract 仍为 B26 的同源作者问题闭环与 R02 的来源/Scope 契约；Invariant 是新鲜且非空的截图、真实回复之后同 run 的最终 completed、同调用 canonical Scope/来源/版本一致；Boundary 限于外部验收脚本和测试，不改产品或权限边界。Existence audit 已确认 `scenario_evidence.assertCommonEvidence` 持有截图数量/文件/新鲜度/格式规则，提取至同 owner 的 `assertScreenshots`，供原调用与 B26 checker 共同消费，删除复制实现，不新增模块；外部编排复用 `assertRecordFresh` 与 `authoring_call_evidence.scopeForProviderCall`，不复制判据。现有 `scenario_evidence_io.test.mjs`/fixture 承接截图负例；B26 暂无 CLI 验收测试 owner，代理故障与 manifest scanner 的测试职责不同，仅新增直接对应 checker 的 `native_question_evidence_check.test.mjs` 并登记既有索引。Proof 要求空/缺失/过期/坏截图，以及 awaiting_author、回复前旧 completed、错 run/方向等真实文件/帧反例，成功例必须保留完整问题/作者动作/持久输入绑定；局部测试不能代签页面。Acceptance Driver 仍是本节既有真实 B26 后接冻结 Splash 三轮；Exploration 不新增作品材料、实体或供应商行为。系统屏幕录制未恢复前不消耗真实样本，不生成成功 summary。

截图驱动的进一步查重确认 `NativeScenarioHarness.screenshotSafe` 已有 `allowFullScreenFallback` 选项；只让现有 `capture` 透传该选项，R02 必需截图显式禁用整屏回退并由现有 `assertRecordFresh` 拒绝失败。原故障现场的尽力采证语义保留，其当前消费者仍存在；不建立第二截图实现。`wireTerminal` 的 awaiting_author 分类供真实模型场景使用，保持该通用语义，B26 的 completed 要求在 B26 自身断言。

### 13.4 工程验证与独立复核（2026-11-15）

本节证据统一位于 `artifacts/model-contracts/b87-r02/20261114/quality/`；路径保留批次日期，证据内部时间戳为实际 2026-11-15。原始失败、首次原生失败和早期扫描均保留，未改分母、阈值、豁免或历史风险处置。

- 最终生产版本由 `final-gate-code-manifest-r4.json` 绑定，193 个代码路径，source_hash=`923b03027d983dd1d755f5be2c94201c68eedc0f09f3e4f288a86e35ce326a12`。完整 `mix check` 在该源码上退出 0，10 个 app 合计 **3238 tests / 0 failures**，日志 SHA-256 `3cfbd1f2388a2545d119a5a0945a585c661aae6abe9575990061b6701a5cf89a`。
- 随后仅两份测试收口：TranscriptCompaction 恢复迁移用例的原非空 Base/version、作者 turn 与 run 身份；JudgmentProtocolTest 删除迁移后无调用的 helper/aliases。两文件以 `mix test --warnings-as-errors` 定向复验 **110 tests / 0 failures / 0 warnings**。该 110 是既有测试子集，不能与 3238 相加。所有生产及其余代码逐字未变；最终 `final-gate-code-manifest-post-r4-tests.json` 的 source_hash=`fb5fa2216969b4e80f1fadb2306aa85847eebe9b4b59d27f8ab7cc5e1e71e061`。原 R4 日志中三个测试编译告警保留，当前两文件已清除，不把旧日志改写为无告警。
- 默认完整 `bash scripts/ai_static_scan.sh --top 10` 在最终源码上运行并归档到 `static-scan-final-r2/`，**21 项 / 19 passed / 2 failed / 0 skipped**，raw exit **1**；日志 SHA-256 `ea2554609c26645c7a24d0a1770dfd1a73b0ca2606b49079076105444afe3c9e`。最终扫描与两份测试收口后的代码 fence 完全一致，无代码漂移。

| 验证面 | 最终结果与证据 |
|---|---|
| 编译、格式、静态结构 | `compile --warnings-as-errors`、格式、Credo strict（issues=[]）、module-size、xref compile-connected cycles、arch_check 均通过。R1 扫描新增的 23 条 Credo 与 12 个规模失败全部消除；基线、cap、豁免未改。 |
| 独立结构审查 | `owner-split-v1/proof.json` 15 项与 `owner-split-independent-review.json` 20 项均通过；校验/错误顺序、规则正文、Policy 版本/hash 及 text_operation 函数内容保留。Scope 不反向依赖父 struct，无新公共兼容层。 |
| 测试迁移完整性 | `test-owner-split-v1/migration-proof-r2.json`：34 个测试迁移恰一次，235 个断言宏保留。独立审查另核对 fixture/helper/DB/运行身份，已修复 Prose 完整章节上下文与压缩非空 Base 的场景弱化；不能只以断言计数代签语义。 |
| 规则与场景不变量 | ADR **32/32** Accepted（338 refs、1 pending）；I1 **4/4**，I2 **3 pairs / 0 violations** 且三案例各有真实 item，I3 **Layer A 3/3 有产物 + Layer B 3/3**，N-NARR 一条作者叙事字节绑定及一个流前缀通过，I-CACHE **10/10**。最终 JSON 独立归档 `final-r2-invariants/`，不以进程退出码掩盖空结果。 |
| 前端 | 最终默认扫描的 typecheck/lint、**53 files / 492 tests**、audit/design trace 通过；当前 WorkspaceChat 的作者回答原字节改动与该源码一致。 |
| Node 证据读侧 | 全量 **1020/0** 对应 `node-full-base-boundary.log`；随后唯一 live refs 模块修正后的关联定向 **82/0** 对应 `live-base-boundary-node-r2.log`。最终该模块 SHA-256=`0873e065f6b64dc8bba8561bd532e2d5bd4a81fdca19bf51e75811b5deb0ec70`；不得说 1020 全量运行在最后这一个模块版本上。 |
| 安全扫描 | Sobelow、Hex audit、Semgrep 通过；gitleaks raw exit 1 的六个历史身份与 R1 完全相同，原台账 5 false_positive + 1 accepted_risk 原样沿用，没有新增接受风险或宣称凭证已撤销。 |
| 原生与实模 | B26 首次 activate 被 macOS 权限拒绝；0 新作者输入 / 0 完成回路。Splash 三轮未启动，L7 unknown。恢复只见 §13.3，工程验证不代签实页或供应商行为。 |

最终 Top 10 实际只有 7 条，处置如下；`is_new=null` 保留未知，“未新增这六条泄漏”由原始 Fingerprint/RuleID/File/StartLine/Commit 全集相等证明，不改报告字段。

| 剩余位置 | 处置 | 本批结论 |
|---|---|---|
| native UI confirmation evidence test 历史位置 | false_positive | 原假 idempotency fixture；原台账不变。 |
| verify_b65_origin_boundary 历史位置 | false_positive | 原示例 nonce；原台账不变。 |
| B63-known-gaps-remediation 历史位置 | false_positive | 原文档内部 spec 标识；原台账不变。 |
| e2e_01_full_chain_check 历史位置 | false_positive | 原 artifact spec 标识；原台账不变。 |
| novel-studio.pen 历史位置 | false_positive | 原 Pencil 元数据；未修改 .pen。 |
| tools/company-console/server/config.mjs 历史位置 | 既有 accepted_risk | 归原历史线与凭证 owner；未声称修复、撤销或重新接受。 |
| task-done manifest | **pending / blocking** | 旧 manifest 过期；当前无成功 Native summary，不能签完成。报告把时间戳误解析为文件位置，不据 is_touched=false 豁免该阻塞。 |

综合核对记录为 `final-code-and-gate-review.json`。所有资源化测试沿既有 test_env owned scope 与独立 DB 运行；没有重置作者库，5 份既有 WIP 的 SHA-256 全程保持不变。默认扫描整体仍为失败，R02 为“实现与本轮工程验证已收口、原生验收未闭环”，不标记 PASS。

### 13.5 可审查提交与本轮交接（2026-11-15）

最终代码的三组提交如下，任务状态/NEXT/本节记录另作独立文档提交；没有 push。

| Commit | 范围 | 审查边界 |
|---|---|---|
| `ee6025d92b8a2ea62892d235787c259d1c247b10` | 164 个文件 | 唯一 Scope 与来源契约、所有 apps 现役消费者和测试、WorkspaceChat、设计契约及 I1–I3/I-CACHE 自动门禁。破坏性接口与自动消费者保持原子，避免通过兼容层拆小。 |
| `6f8fe1e0e2cda9f2a03e51a7f6c89d9e4bac2c8e` | 30 个文件 | 原生 Node 结构证据、fixtures、来源/版本/请求身份消费者及其反例。 |
| `2c7e645eff63987d58a30ac210f5081b6f343a6d` | 7 个文件 | 独立模型合约探针对齐、旧 B26 跨版本入口退役与索引。历史原始证据保留。 |

分组清单 `read_only_closeout_groups-r2.json` 与 `closeout-final-group-{1..4}.paths0` 合计 204 条路径，逐组 index/commit 路径精确核对，原 5 份 WIP 与已提交的 `99b8b15e` 28 个样式路径均无交集。使用普通 Git hooks，无 `--no-verify`；全局 hook 提示本项目无 lefthook 配置而退出 0，真实验证以 §13.4 的显式执行为准。

本轮提交完成的是 R02 工程实现与对应验证，**没有完成 R02 原生/实模验收，也没有推进 R03 或改写其他批次状态**。当前恢复条件是 §13.3 的实际宿主系统权限；解除后先对最终源码运行新 B26 真实选择/自由答复，再执行冻结副本的 Splash 三轮，核对全部证据后才能签 R02 并进入后继新上下文。

### 13.6 原生验收判据收紧与权限复查（2026-11-15，Asia/Shanghai）

恢复审查完成后，外部验收修复已按独立粒度提交为 `526160dccf98d4803d284914000f8321b547085b`（8 个脚本、测试与索引文件）；本节和权限状态另作任务文档提交，没有 push。未改变 `apps/` 或 `frontend/` 产品代码，原五份 WIP 保持逐文件 SHA-256 不变。

- 截图校验复用同一 `assertScreenshots`：拒绝空集合、非法最小数量、缺失/陈旧/坏格式图片，按真实路径检查批次边界和去重，路径别名或外部符号链接不能凑截图数。R02 六个必需采集点全部禁止整屏回退，并在首个作者输入前及每次采集后检查实际 AX/文本/图片文件。
- 回答类型来自唯一持久源动作，question/submission 必须唯一；复制一次回复改标签不能冒充两个分支。绑定源问题的真实 submission、goal、source turn、action、run，以及作者输入的角色、原文字节和创建时间；free_text 对照实际 payload，choice 对照源 label/candidate。只接受首次未 dropped 的发送之后、同 topic/run 的真实接收状态，最后状态必须 completed 且消费本次 goal +1；旧 completed、再次等待、错 run/topic、发送方向或 dropped 状态均拒绝。ACK 丢失重传的合法正例保持通过。
- R02 编排继续使用现有 `actionAck` 核 accepted 回执全身份；逐 call 新接入已有 `scopeForProviderCall`，核完整 Scope 序列/来源/版本，逐字段核五个 run 身份，并比对完整 canonical 作者前缀。没有第二来源 owner、产品验收 hook 或旧接口兼容层。
- 独立源码复核已从现役 AuthorQuestion、AuthorQuestionService、AuthorQuestionRepo、WorkSessionService 和外部 transport proxy 核实全部公共字段及时间顺序；这些是产品当前契约，不从测试输出反推预期。新 CLI 测试的源动作与 turn_result 形状也按真实 producer 修正。

本节证据仍在 `artifacts/model-contracts/b87-r02/20261114/quality/`。源码清单为 `native-acceptance-hardening-source-manifest.json`：原 193 个代码路径加本轮相关路径，共 **198** 条，source_hash=`53b218f45018804bdc1520298dd77af34761661ca117adffca7548e5cfe9d927`；外部编排 SHA-256=`f4782e38bbbb928040b7f0bf7f028decb888e1238f6970b84e4bf14d3e99519b`。两项最终门禁前后没有源码漂移。

| 验证 | 最终结果 / 证据 |
|---|---|
| 外部驱动定向 | `scenario_driver.test.mjs` **23/0**；首跑因子进程 PATH 缺 Node 造成两个旧用例 ENOENT，补执行环境后原样通过，未为此改源码。 |
| 截图与 B26 CLI 定向 | **11 + 22 = 33** 个不同测试通过；CLI producer 形状修正后单独复验 **22/0**。`b26-evidence-tests-closure.json` 保留两次日志与 owned run。 |
| 相关原生证据回归 | 冻结源码上 **50 个测试文件 / 975 tests / 0 failures / 0 skipped**；`native-hardening-node-regression.log`，SHA-256=`04b89fc676f413c1690d5e624eb5394aa75321fa6426004c148bce93f3947044`。这是本轮相关测试集合，不与 §13.4 的不同集合计数相加。 |
| 默认完整静态扫描 | `bash scripts/ai_static_scan.sh --top 10`，**21 项 / 19 passed / 2 failed / 0 skipped**，raw exit **1**；归档 `static-scan-native-hardening/`，日志 SHA-256=`f80cb912270f300b9791b28692b6f4b908e0cce9c646870f68af0c2a68f785bf`。编译、架构、规模、Credo、场景不变量、前端与 NEXT 等通过。 |
| 剩余 Top 10 | 仍为 **7** 条：gitleaks 六条的 Fingerprint/RuleID/File/StartLine/Commit 与原记录全同，沿用 **5 false_positive + 1 既有 accepted_risk**；另 **1 pending/blocking** 是旧 task-done manifest 过期，尚未进入原生证据核验。`native-hardening-scan-review.json` 保留逐项结果；没有改长期处置台账或将整体扫描标绿。 |

13:39 的第二次只读检查仍为 `ax_trusted=true / post_access=true / screen_capture=false`，证据 `native-permission-preflight-20261115T053941Z.json`。当前需由作者为 §13.3 已证实的实际宿主开启「屏幕录制/屏幕与系统音频录制」，按系统提示重启。新 B26 批次与 Splash 三轮均未启动，未发送新作者输入；**R02 仍未完成真实原生/实模验收，不签 PASS，不推进 R03**。权限恢复后，先核对本节源码 fence，再使用全新 `native-question-02` 目录执行 B26；其通过后才运行 §13.3 的冻结 Splash 三轮。

### 13.7 原生恢复与跨 run 会话前缀存在性审核（2026-11-15，Asia/Shanghai）

14:34 已实测 `AX/Post/Screen=true`，最终 198 个代码路径与外部编排哈希均匹配 §13.6，原五份 WIP 未变。`native-question-02` 首图成功，但系统 `UserNotificationCenter` 占据前台，实际 activate returned=true/confirmed=false；驱动按既有边界停在首个作者输入之前，发送作者事件为 0，runner exit=1，精确批次进程清理 remaining=[]。提示进程退出后重新创建 `native-question-03`，没有覆盖 02。

03 的真实选择答复已完成；自由答复也已 accepted 并完成同 run 继续执行，但逐调用 Scope 对账失败，整个批次仍为失败、不能签 PASS。12 个实际请求的 ProviderRun/canonical 绑定均无失败；第一 run 的 Scope 数量是 1–6 对 1–6，第二 run 则为当前段 1–6 对实际请求 7–12。原因已由源码与持久记录交叉确认：产品按 ADR-0035 合成会话历史，外部 reader 却只把当前 run 段交给完整 Scope 序列核验。只读诊断改用正确的会话前缀后，12 calls 的 Scope 与完整作者原文字节均匹配；该诊断不是新原生 PASS。

实现前存在性审核与设计决议：

| 职责 | 现有唯一 owner / 决议 |
|---|---|
| 产品请求会话视图 | `AuthoringSessionLog.fetch_session/1`、`AuthoringSessionHistory.compose/2`、`AuthoringSession.with_request_view/2` 已存在；当前 base 一次、已提交非 base 全序、当前尾部。保持此契约，不能删除合法历史以迁就验收。 |
| 外部历史读取 | 复用 `authoring_history_evidence.mjs`，保留 `transcript` 为当前 run 段，增加由同一只读事务和现役消息表派生的 `sessionMessages` 数组。它不是新持久实体或 RequestIR，不携带累计 refs。核身份、消息版本和序号；截至目标段末，再按唯一 pcall/prun 的 canonical assistant 截调用前缀。 |
| Scope / 作者前缀 | 复用既有 `scopeForProviderCall` 与真实来源 refs；迁移现役消费者使用会话消息，run 工具/预算/回执归属仍只消费当前段。完整数量、顺序、内容、版本、来源判据保持严格。并发导致无法证明同次快照时仍失败关闭，不从请求反推预期。 |
| 夹具与回归 | 复用现有 history/call/live/revision 的 fixture 和测试 owner，修正多 run 夹具的全会话 sequence，覆盖跨 run 正例、漏失/额外/乱序/篡改历史、未来行与异作品/会话、坏版本与序号反例；不创建平行测试框架。 |

当前整改仅位于外部验收层；没有新增产品实体或历史兼容层。03 的原失败、截图、输入回读、DB、12 条 captured fixture IR 和 cleanup 保留。修复后先验证及独立审查，再用全新批次重跑 B26；通过后才启动冻结 Splash 三轮。L7 缺同调用 Base refs 仍按原约定记 unknown，不以会话累计 refs 补证。

### 13.8 会话证据修复与真实 B26 闭环（2026-11-15，Asia/Shanghai）

本节基线为 `5fc9c8d2ceca65a566214df28bef2dcb10a3622d`。§13.7 的存在性审核在实现前落盘；修复收敛于既有外部证据/fixture owner，没有更改 `apps/`、前端或产品存储，也没有新增产品实体、平行 RequestIR、兼容层或验收专用产品入口。

**设计落地**：`readAuthoringHistory` 在同一只读事务内校验本会话的 run、segment 与 canonical 消息身份/版本/role/count/bounds/连续序号，派生 `sessionMessages`。当前 base 至多一次；历史非 base 保持会话全序，目标段之后的消息不倒灌。当前 `transcript`、调用/预算与自报继续限于该 run。pending、revision、mission、full-read、live/behavior 与 L7 消费者全部改为显式会话前缀；完整 Scope 判据没有降级，缺前缀不回退。L7 的同调用 Base refs 仍只来自真实请求的明确登记，累计段头与 Scope 来源均不补证。并发造成请求读取水位无法证明时仍失败关闭。

**工程证据**（根目录 `artifacts/model-contracts/b87-r02/20261114/`）：

| 验证 | 实际结果与证据 |
|---|---|
| 相关 Node 回归 | `quality/session-prefix-node-r2.log`：51 文件、1030 tests、1030 pass、0 fail、0 skip；owned run `fc53732c2f4923c3`，进程树已清。R1 的旧 header 身份负例失败保留；修复仅精确构造 header 错绑，没有放宽拒绝判据。 |
| 最后 fixture 清理 | 将重复版本字符串改回既有 `MESSAGE_FORMAT_VERSION` 常量；值仍为 `authoring-session-message/v1`。唯一消费者 `authoring_run_evidence_io.test.mjs` 13/13 通过，证据 `quality/session-prefix-final-fixture.log`，这是上述测试的子集，不累加。 |
| 源码 fence | B26/1030 tests 对应 `quality/session-prefix-source-manifest-r2.json`，209 路径；最终 `session-prefix-source-manifest-final.json` SHA=`3634dbb01d607b5565fe4ab44f061f92f8594a9b08a58a5c4c84e6c50c74150e`。两者仅上述 fixture 常量引用不同；产品、reader、driver 和原五份 WIP 均未漂移。 |
| 默认完整完成门 | `quality/session-prefix-task-done.log`，owned run `b740c00d8169333f`，exit 0；快照 `quality/session-prefix-static-scan/`：21 runs、20 passed、1 failed、0 skipped、blocking=0。编译 warnings-as-errors、架构/xref/Credo/模块门、不变量、前端 typecheck/lint/53 files 492 tests、NEXT、task-done 与 Semgrep 均通过。 |
| 安全原始结果 | gitleaks 原始 exit 1、6 条历史命中。与上一轮逐项比较 Fingerprint/RuleID/File/StartLine/Commit 完全一致：5 个既有 false_positive、1 个既有 accepted_risk，0 条触及本批文件；没有修改处置台账，不声称扫描器全绿或凭证已撤销。 |

完成门生成 `artifacts/task-done/20261115T071135Z/manifest.json`。本轮 worktree 没有产品 UI 变更，因此它记录 `ui_required=false`；真实 B26 的证明来自下面独立 runner/checker 与原始证据，不把完成门的“不需要 UI”当作页面 PASS。此前全量 Mix 的 3238/0 与其后 110/0/no-warning 子集证据仍按 §13.4 的源码边界保留，本轮没有重复声称新的全量 Mix 运行。

**真实 B26 第 04 批**：`native-question-04/` 的 runner `wc_job_H9l4ArjV85glowKx` 和外部 driver `wc_job_4QdeyCg2m71jvcXx` 均 exit 0，统一 harness=`55203d10-0633-4896-8f1f-0c3915690e83`。两轮分别为选择“保留悬念”与自由答复，各 6 个调用、终局 completed；6 次必需截图全部成功，独立逐图复核通过。逐份原始 WS 核对初始请求/ACK、问题帧、回答动作/accepted ACK 和完成帧各唯一；每轮 receipt、Interaction 与当前 run canonical answer 各一条，问题已关闭为 answered。

自由答复原文为 `"  结尾有希望，也保留悬念。Ω é 雪。  "`，两端双空格与分解形式 `e + U+0301` 在 AX 回读、WS、Interaction、canonical 和请求中一致；UTF-8 SHA-256=`48385837b84026f7b93619546a7e5be35684b67fc3b1b9e45a99156002ac151f`。当前单行入口不证明 LF/CRLF，后端与机械投影覆盖仍独立表述。

12 个实际记录的五字段 run 身份、pcall/prun、request body hash、完整作者前缀与 Scope 内容/来源/版本/顺序逐项匹配。第一 run 的 Scope 数量 1–6，第二 run 7–12；没有删除合法历史或只比最后一份 Scope。每轮第一个请求尚无本轮回答，随后五次均恰好包含一次本轮回答。第 02/03 批原失败结论与全部现场保留，修复后的诊断不回签旧批次。

| 核心产物 | SHA-256 / 边界 |
|---|---|
| `native-question-04/summary.json` | `eb3ead78b2f15cd614df08715cabdb32de11470f2afe1a6726eb1230242f6776` |
| `native-question-04/native-app-cleanup.json` | `8c1608e395729cce23a75ee7299695c6cdbe5db518ef025b9de95c59aeb27edc`；PID 29825 SIGTERM，remaining=[]，4657/4661 已关闭。 |
| `native-question-04/r02-derived-wires-report.json` | `352fb2278239f414dbea48155526d98206f585773a4756cb4832f1d1c0c3a5ad`；12 calls × 3 targets = 36 份离线投影，raw answer 保留。 |

B26 使用 `provider=slice_verify`，捕获的是 `fixture_request_ir`；离线三 wire 复用现役 AuthoringTranscript codec / RequestIR / Projection。所有产物明确 `observed_provider_http=false`，不是三家供应商实测或网络原始 HTTP 字节。作者原文与产品真实原生链路机制验收已闭环，冻结 Splash 的模型行为验收仍单列。

代码与索引提交：`9025200128fc4a3b9b85c966b4fff7cd17936908`（25 文件，完整同批迁移）。原本地未发布提交 `c3c1c1af9b98c8d31e3c33391fb9e78133f633f1` 仅按 AGENTS 规范改为中文 message，tree 同为 `3bc6a4b7c75cf60af49e50d3a42542d9b209586c`；既有证据中的原 SHA 与源码 fence 不改写，映射见 `quality/session-prefix-commit-message-closure.json`。普通 Git hooks 执行；无 lefthook 配置的提示不能代替上述显式验证。原五份 AGENTS/B84/扫描处置 WIP 未纳入，哈希保持不变；未 push。

### 13.9 冻结 Splash 三轮的启动与 seed 字节边界审核（2026-11-15，Asia/Shanghai）

首次启动请求被自动审批在执行前拒绝，理由是未确认具体 provider 的私有作品数据发送授权；当时没有创建批次或 Job。项目既有 Splash 授权记录仍保留，但个人上下文检索未找到可定位的用户原句，因此没有据文档概括直接重复该请求。随后只读核实本次环境的实际 endpoint 为 `http://127.0.0.1:8000/v1`，并核对现装 Splash 1.6.1、本地现有权重与离线入口；重审后的本机受控启动获执行，但端口已被现有服务占用，保护检查在启动第二服务前拒绝。没有接管或关闭该服务。15:22 的实际 `/v1/models` 证实 `local/Q4-PLE4`、context_length/max_model_len 均为 262144，随后按原冻结参数复用该本机服务；证据 `quality/splash-endpoint-preflight.json`、`splash-existing-service-models.json`、`splash-three-01-preflight.json`。

`splash-three-01`（Job `wc_job_ZkkAZt7iSG5Zl0la`）在 `prepareBatch` 的 seed title 严格相等判据处失败，尚未启动外部 native driver，未发送冻结作者输入。隔离库实际 work.title 为正确的“未命名作品·副本”、revision=2；但 seed.log 中中文被输出为字面 `\x{...}`，中点是单字节 `0xb7`，被 Node 按 UTF-8 读成替换字符。该批次保持 exit 1；`native-app-cleanup.json` 为 remaining=[]，不覆盖其 seed/prepare/DB 现场。

**修改前存在性审核与最终裁决**：B87 现有 producer 是 `scripts/seed_request_cost_work.exs` 的 `[request-cost-seed]` 机器记录；现有 `scenario_evidence.seedFields → request_cost_capture.readSeed/prepareBatch` 固定以 UTF-8 解析并核对冻结标题。实际同环境的 `quality/seed-stdio-diagnostic.bin` 证明 Erlang stdio 为 `encoding: :latin1`：`IO.puts` 重现坏字节，`IO.binwrite` 保留正确 UTF-8。初步 producer 局部方案经独立全现役审计修正：B28 等 seed 也输出中文标题，责任属于现有 `tauri_slice_verify.sh` 的共用 seed 启动边界；全 scripts 没有另一个通用 IO writer。最终 **reuse/refactor 共用 runner**：在同一 Mix 进程中先 `:io.setopts(:standard_io, encoding: :unicode)`，再 `--require` 原 seed；原 producer 业务/记录格式与严格 reader 不变，未验证的局部 binwrite 改动撤回。当前安装的 Mix 1.19.5 BEAM 源码证明 eval/require 按选项原序执行且 `System.argv=[]` 保持；`--eval` 后直接放文件名反而不会执行文件，明确拒绝该错误接法。没有新 helper/module/schema/env/config，不改全局 locale、不反解乱码、不增加旧格式兼容、不放宽 seed/DB 对账。后续用现役 owned scope 验证实际 Mix 字节边界，再复用原 prepare 与全新原生批次；原失败保留。

### 13.10 R02 最终验收与后继边界（2026-11-15，Asia/Shanghai）

**R02：PASS。** 按原 R02 卡 §DoD 与真实用户效果，当前作品结构事实、作者原文、目标与真实工具校验身份已从实际来源贯通到真实请求和 Tauri 作者可见回答；章数问题与结构异议均能取得真实结构信息。两名独立只读审核者分别复核页面/源数据和原任务边界。没有修改 R02 完成定义；**B87/Issue #4 仍 doing**，不能把本批判定扩大为三轮业务目标全部实现。

**共用 seed 修复**：`quality/seed-utf8-boundary-result.json`（SHA-256=`1f0ee8fcaf700b5cfe555587af8122dbe36713290985b83312a61c3b771b9d03`）保留原 Latin-1 失败字节与新入口的精确 UTF-8 对比，前后 `System.argv=[]`；owned run `3eb94a12a1ea58ae` 已收尾。独立审查确认异常/非零退出仍由原 `set -euo pipefail` 传播，replay/无 seed 分支和业务 seed 不变。修复单独提交 `3c66fc91b85a7273df8cd527c52a0aee9475ddf4`（1 文件、3 增 1 删）。

**冻结 Splash 第 02 批**：`splash-three-02/`，Job `wc_job_5HEgIt260t-Ly1ve`，exit 0；沿用原 manifest 的三条原文、完整隔离快照及参数，本机现有 `local/Q4-PLE4` 服务。实际 3 轮、3 次 Provider 调用，全部捕获并绑定。前序 `splash-three-01` 的 seed 失败原样保留，不覆盖、不修改分母；没有重跑 20 轮或换输入。

| 冻结作者原文 | 当前事实与作者可见结果 | 实际业务结果 |
|---|---|---|
| `当前有几章内容` | 2 个章节条目、1 个有正文；计划条目 0 字，正文章记录 3204 字/4183 字符、2 个已采纳片段 | `reply / reply_only` |
| `第一章是 卷纲，这不对吧` | 能取得 seq=1/PLANNED/阅读可见/0 字与 seq=2/DRAFTING/正文的真实对照；未擅自改结构 | `goal_unfulfilled / capability_gap`；自动报缺口是 R08 的未通过反例 |
| `不能接受卷纲在阅读里显示，应该在作品档案显示` | 当前 `visible_in_reading=true` 与独立作者目标保持分离；没有伪造已经隐藏或迁移 | `goal_unfulfilled / capability_gap`；archive-only 效果未实现 |

三个 run 为 `run_mwhir6es_5`、`run_mwhirfyb_8h`、`run_mwhisouq_ot`，session=`ef453170-df25-4f5c-96ef-07c0dba5cc6b`。run 的 completed 只表示执行结束；第 2/3 轮 outcome 并非成功。三轮 `production_write_performed=false`、`artifact_adopted=false`、`durable_behavior_opened=false`。页面回复、截图、实际 WS 与 Provider 记录共同核验，没有用采集器 PASS 代签业务效果。

| 独立证据（相对本节 `artifacts/model-contracts/b87-r02/20261114/`） | 结果 / SHA-256 |
|---|---|
| `splash-three-02/summary.json` | 原生采集 checks 全通过，failures=[]；`4ed110b2f181d582c7f0c8c901f459b8f3cfe2139762fd580a4a70d9e5b84c7b` |
| `quality/splash-three-02-binding-audit.json` | 3 captured / 3 proven；完整作者前缀、会话 Scope、pcall/prun/请求身份逐调用匹配；`ebbf79598d7ada2df1f12267e8f24ab88c6022e4a7ba844e89dc14ae060521b5` |
| `quality/reading-source-r2.json` | 独立冻结库经既有 ReadingProjectionRepo/Service 取得真实 TOC/章节事实，先于批次 start；`57fa4fe8ee71f7421aae00bdada419361b3af9a1b993e15c8b5f54c88bed8aa7` |
| `quality/splash-three-02-source-facts-audit.json` | 3 calls 中 6 处 Scope 的完整章节对象、真实 refs、work v2、goal 逐项对账；`ecc90ff24cc571af9ca7e0f1932a5e41bb24558a5b98a9fd07981fc2640270d5` |
| `splash-three-02/native-app-cleanup.json` | 本批 PID 49785 精确 SIGTERM，remaining=[]，4657/4661 关闭；`8a379ac1a6dc304a4de0de43005227e4c350893d1ff0161ee7cdaa506e26c655`。既有 8000 模型服务未接管/停止。 |

源对账复用现有 reader、call join、request facts 与 L7 checker；一次性断言只放 ignored evidence 目录，不新增产品模块/工具/持久模型或平行来源。冻结源到本批 final 的 volumes/chapters/scenes/drafts/chapter_summaries/characters 原始行完全相同（`quality/splash-three-02-source-rows.json`）；Work 副本标题/revision 2 属于输入前的既有 setup，并逐字段对账。start/final 的 9 张业务表 canon 及 business hash 均稳定；只有 5 条 memory 的引用计数/时间记账变化，reference log 240→248 的 8 条均绑定本作品三条真实输入，不计作正文或结构修改。

**证据限度**：章节 coverage=complete（2/2，written=1、planned=1、unknown=0），正文 coverage=`not_read`；不能声称模型实读全部正文。`request-cost-report.json` 保持 `signed:false / r01_measurement_only`，未把其原格式改作 R02 签收。实模记录是应用 decoded request body 与解码响应/WS，raw HTTP/SSE 未采；L7 三调用均为 `ok=null, reason=used_context_refs_unavailable`，不补造 self-report/Base 证据、不签 L7。B26 的 36 份三 wire 离线投影仍是机械证明，不冒充三个供应商网络实测。

**当前源码与工程门**：最终 `quality/native-final-utf8-source-manifest.json` 覆盖 211 路径（含已删除路径的 null fence），SHA-256=`99f1983f29d7e422c83ed281630f4ef5c86b62a715267537c3dca07beb0dc1ba`，实模及最终门禁前后均匹配。完整默认 `task_done.sh --slice b26-author-question-roundtrip --ui-summary <native-question-04/summary.json> --top 10` 已在独立 DB/owned run `39b2ebdd52aa3d0f` 执行 exit 0、tree_finalized=true；`quality/r02-final-code-task-done.log` SHA-256=`f0a80436f3b2851f7b51a87c4b9ac980db48072e81bb256abc91b672e354b9ff`，完成清单 `artifacts/task-done/20261115T075258Z/manifest.json`。完整扫描快照 `quality/r02-final-code-static-scan/` 为 **21 runs / 20 passed / 1 raw failed / 0 skipped / 0 blocking**；唯一 raw fail 是原六条 gitleaks（5 既有 false_positive、1 既有 accepted_risk），Fingerprint/RuleID/File/StartLine/Commit 与 §13.6 完全相同，未改台账，不声称安全历史已清零。相关 Node 1030/0、末次 fixture 13/0 和既有 Mix 3238/0、随后 110/0 各按 §13.4/§13.8 的实际源码边界保留，不相加、不冒充本次重跑。文档与 NEXT 调度修改后的默认完成门另以 `quality/r02-closeout-task-done.log`、`r02-closeout-gate-result.json`、`r02-closeout-static-scan/` 留存实际结果。

**保持开放的现有后继责任**：

| 原责任 | 本批真实反例 / 尚未完成的效果 |
|---|---|
| R06 内部身份出口 | 第三页出现 `chapter:19d52d44…`，以及技术字段/工具名；作者呈现仍不 clean。 |
| R07 状态与效果 | 第 2/3 轮 `goal_unfulfilled` 对应 UI 通用“已完成”，执行结束与目标实现的呈现混淆仍待修复。 |
| R08 意图语义 | 原卡已要求第二轮讨论不能自动缺口/修改；此次第二轮仍自动报能力缺口，不能签该语义通过。 |
| R08/R09 真实能力 | 第三轮建议在界面删除/隐藏/转卷级计划，但这批没有对应入口/合法操作证据，不能作为可执行后路。 |
| 既有领域数据/采纳映射缺陷、R19 总验 | 卷纲仍在阅读中，archive-only 目标未达成；原始 Markdown/表格与重复、冗长技术答复的页面质量问题也保留。整体模型交互与最终产品验收未完成。 |

**提交与恢复**：外部会话证据修复为 `9025200128fc4a3b9b85c966b4fff7cd17936908`，共用 seed 修复为 `3c66fc91b85a7273df8cd527c52a0aee9475ddf4`；文档/排期另组提交。原五份 WIP 哈希不变，不纳入提交；无 push。NEXT 仍为 B87，下一独立批次为 R03，按共享 README §1 使用全新上下文读取 README + R03 卡 + 本节及其唯一设计契约，重新完成七问/存在性审计再实现；本会话不滚动实现 R03，也不借本批 PASS 关闭 R06–R09 或 R19。

## 14. R03 目标判据、存在性审核与实施记录（2026-11-15，Asia/Shanghai）

**状态：doing；完整 R03 尚未验收。** 起点为 `develop/dialogue-based-novel-workbench@f7f8e461ca65ba756c641a9a5fc37af36b3ed46c`。原有 AGENTS/B84 报告/索引/扫描台账/B84 任务五份 WIP 由原工作保有，不纳入本批。基线 `mix compile` 已实际 exit 0。

### 14.1 先于实现的目标与独立判据

本节按 AGENTS 已有的「愿景 → 元原则 → 设计 → 任务 → 实现」制定，不把现役 tool-only 压缩、Frozen 标签或旧测试当作目标。R00 只证明现契约不能覆盖 Scope/纯讨论，没有预先批准新覆盖；本次根据作者设计与实现授权修订责任层契约，不追改 R00 历史。

作者需要在长会话中继续创作，而不是反复解释已说的话、已承诺的后续和仍未解决的问题。因此完整结果必须同时具备：

1. **旧 Scope 真正退出当前请求权威面**：在合法、已持久提交的 checkpoint 下去除重复完整 Scope；当前作品/目标/权限只来自实际当前范围，旧授权不能复活。
2. **纯讨论也能整理**：没有 tool_call 的早期 assistant 长答可以被有来源的派生摘要替代；只整理讨论轮的 Scope 不签完整 R03。作者全部原话、当前回合、最近保留项、真实未答问题和未完成义务仍可用。
3. **连续性与按需求证**：摘要不是 canon、作者新指令、执行回执或授权。模型能按精确历史来源回查原文，观察进入下一真实请求；作者历史和 Why 仍从原始事实回查。
4. **失败不丢历史**：取消、摘要失败/不合法、版本/身份错误、并发冲突和提交失败均不发布新整理记录、不推进旧内存；没有合法 checkpoint 就保留原请求历史。
5. **同源恢复**：Canonical 只追加，原作者/模型/artifact 字节不改；跨 run 顺序、三 wire、JSON 编解码及重启后的覆盖一致。

独立预期来自预注册作者输入/未解问题与承诺、写入前的真实会话行和范围事实、原始 Provider 响应及真实事务结果；不能从待测 projector 或摘要反推应保留内容。3/10/20 轮、交错 run、相同文本不同身份、Scope revision 重复、未答 ask_author、completed+goal_unfulfilled、错作品/版本/未来坐标、重复整理、取消、故障回滚和恢复均属必验。摘要结构/引用校验只能证明机械边界，不能证明语义无遗漏；实际模型的跨轮义务验收独立签署。

### 14.2 七问与责任边界

| 项 | 本批回答 |
|---|---|
| Contract | 修订既有 VS-00L §16.2/§16.16、ADR-0035 的覆盖与维护语义，并在 VS-00M §5.4/§12.1 对账；唯一 RequestIR/Canonical/Checkpoint 不变 |
| Invariant | 原文不改、作者主权、当前 Scope 不被旧权限替代、完整工具组、真实来源/版本、未解责任保留、提交先于发布、三 wire 同源 |
| Boundary | common 纯选择/验证/投影；application 计划/摘要调用/运行态/回查；persistence 真实身份与事务；现有 frontend 整理记录；agent 继续既有 Provider 执行，不增加控制环 |
| Consumer | 真实 AgentRun 安全点维护 → 下一判断请求 → Tauri 整理记录/历史回查；三 wire 与 durable 恢复共同消费同一 checkpoint |
| Proof | 目标导向的 3/10/20 与异常矩阵、真实持久化及三 wire、原生页面整理/重启/未答问题续行、真实摘要与后继模型行为；适用共同门禁 |
| Acceptance Driver | 复用现有 tauri_slice_verify/native_b71_auto_maintenance/request_cost 的运行时和外部 driver；迁移 C5/C6 与 R02 全 Scope 判据，期望仍由独立 canonical+合法覆盖派生；产品验收感知逻辑=无 |
| Exploration | 已确认 ExplorationService 只有作品/候选/记忆读取，尚无精确会话原文读取；在现有只读探索面接入同一 AuthoringSessionLog，绑定当前 work/session、受原观察预算和 used_refs 边界约束，不建历史副本 |

### 14.3 新增/改造对象的存在性与目标一致性审核

| 需求 / 拟变更 | 已存在 owner 与真实缺口 | 决议 / 首个消费者 |
|---|---|---|
| Scope/讨论的精确身份 | AuthoringSessionLog 已有 run_id + run_sequence、session sequence；SessionHistory.compose 目前只传 run 归属，丢序号；scope_revision 每 run 重置，不能当唯一身份 | **refactor-and-retire**：把既有行坐标传到派生视图并作选择 fence；不新建 message UUID、表或第二历史；Compaction/恢复消费 |
| 统一覆盖契约 | RequestIR.Compaction 只接闭合 call_ids，三 wire 已共用 project；AuthoringCheckpoint/Transcript 均持有追加入口 | **refactor-and-retire**：在同一 covers 契约扩展精确消息选择，移除 tool-only API 假设；保留闭合工具组作为正常覆盖种类，不造第二压缩器 |
| 历史行可信性 | fetch_session 当前只核段格式和行数；真实行/段/run 已有身份、格式与序号 | **refactor**：在现有读取边界验证消息坐标、版本、归属、角色和顺序，再允许投影省略；不复制外部证据 reader 成第二产品源 |
| 纯讨论语义摘要 | TranscriptCompaction 当前只有项数摘要；ChapterSummaryGenerator 属作品章摘要，语义不适用；Provider.Execution 与 RequestIR.Operation 已有单次请求/日志/取消 | **truly-new 的用例职责、复用执行设施**：只在既有 run 安全点内进行有界摘要调用，绑定精确原文、实际 pcall/prun；不生成第二 Run/Loop，不借章摘要承载会话义务 |
| 同一来源的唯一执行资格 | ProviderRunLog 已有真实 initialized owner_refs 与 immediate 准入；整批 coverage_key 会随 Scope/工具覆盖或讨论重分组变化，不能保护同一原文；全仓没有 discussion_source_keys 或等价逐源 fence | **refactor 既有 owner_refs**：新增非空唯一摘要源指纹数组 discussion_source_keys，沿现有 ProviderRun 记录持久；同作品/会话/operation 任何状态已有来源交集即拒 dispatch。planner 读取既有尝试源集合并只在选择时跳过，保留其最近 K 计数，使未知 D 不阻塞尚未尝试 E；不增加表/注册表/第二持久层 |
| 未答问题保护 | AuthorQuestion/Interaction/receipt 已有问题状态、版本与回答来源；工具 validation_result 不等于问题关闭 | **reuse/refactor**：从真实状态保护未解责任；不建 Obligation 表，不以 run completed 或模型自报当解决 |
| 原文按需回查 | AuthoringSessionLog 保存原文；WorkSessionService 有作者 Interaction 分页；ExplorationService 尚无精确 canonical 原文工具 | **truly-new 只读入口、reuse 存储/探索机制**：只暴露当前会话受限原文与来源，不暴露 provider 私有状态/推理，不假装作品 archive 或 session_adoptions 已能承担 |
| 整理事件与 UI | CompactionRecord、AuthoringReplay、transcriptCompactionView 已有；数量仅 covered_exchanges，0 call 的合法整理会被 UI 吞掉 | **refactor-and-retire**：真实区分工具/Scope/讨论数量，迁移既有事件与文案消费者，不增加卡片类型/验收 hook |
| 验收 | 现有 B71/G6 checker 只接受非空 call_ids；R02 checker 要求全部 Scope；request_cost 已支持 3/10/20/Splash | **refactor-and-retire**：迁移独立 oracle 和既有 driver，不取消拒绝规则、不让 wire 自证、不将旧 HEAD PASS 代签本批 |

**原生后端恢复查重（编码前）**：现役 `tauri_slice_verify.sh` 拥有唯一 BEAM 启动/回收，`native_ui_wait` 拥有等待账、进程和 health 监督，现有 Tauri relaunch 仅是客户端；全仓无可复用 backend restart 入口。R03 在原 owner 内提供一次换代：ready 的 `backend_owner` 是本批实际 PID/DB 归属；`native-backend-restart/v1` 的请求、准入、监督确认、完成文件仅属该批外部事实，绑定 run_ref/request_id/restore wait_id/旧 PID，准入与监督确认先于回收，完成再绑定实际新 PID、同 DB 与真实健康/facts。driver 只发请求，原 runner 复用同 env/同 DB 启动函数，外层 seed 只运行一次；不新增 bootstrap、supervisor、产品 hook 或第二恢复 owner。首消费者是 R03 冻结 D→真实 BEAM 重启→新 E 的故障恢复链及原监督反例测试；driver 与事后 oracle 共同复用原 owner 的只读 `readBackendRestartReceipt(dir)` 核身份、原等待窗、实际文件哈希与数据库身份，不复制四文件协议解析器。具体事实边界见现役验收设计 §5，不以客户端重连代签。

**具体模块查重裁决（编码前）**：新增 `RequestIR.MessageCoverage` 仅承载既有消息行坐标的纯选择/来源规则；新增 `RequestIR.DiscussionSummary` 仅承载模型摘要原文的解析/引用校验/投影。全仓无等价现役 owner；它们由同一个 `RequestIR.Compaction` 组合，后者继续唯一覆盖入口，避免在原 Compaction 混合工具组与模型输出两种变更责任。新增 `AuthoringSessionIntegrity` 从原 SessionLog 抽出读写共享纯身份/格式规则，Repo/事务留原 owner；`TranscriptCompactionSummary` 复用执行链做单次摘要；`AgentRunMaintenance` 从原 Server 抽出维护编排；`SessionMessageRead` 是既有探索的只读适配。无新增表/主模型/控制环，首个消费者均为本批真实链路；字段、失败/恢复与原文生命周期统一见 VS-00L §16.2.1。

**Provider 持久事实职责收敛（编码前）**：`ProviderFactMerge` 已是同次执行身份、归属和生命周期的纯判据 owner，本批操作来源形状及准入后不可变身份归并于此；`ProviderRunLog` 继续独占 Repo 查询、`immediate` 事务与一次来源执行资格授予。全仓未有等价的 Provider 记录投影 owner，原 Log 同时承担 run/event/output 写入映射、作者安全 JSON、真实输出字节摘要和 usage/activity 读投影。裁决新增 `ProviderFactProjection`，整体迁移这组互相依赖的纯表示策略，首个且唯一直接消费者是既有 Log 的写端及用量/活动读端；无 Repo、运行状态、新表或第二持久入口。准入、归属或事实冲突仍在原事务整体回滚，摘要映射不得吞错或重新授予已有执行资格。既有 ProviderRunLog/operation admission 与摘要运行测试验证真实消费者；新增唯一 `ProviderFactProjectionTest` 只检验递归隐私边界、等价 JSON 表示和真实文本 digest 规则，不复刻字段映射表。此次职责调整服务 R03 的来源不可换绑与原文保护，不放宽规模基线或失败契约。

**测试职责查重（新增前）**：现役 `RequestIRProjectionTest` 负责三 wire 格式黄金样本，`TranscriptCompactionTest` 负责应用计划和追加/codec，B81 CP3/CP4 负责真实会话存储、交错与恢复；尚无 common 的精确消息覆盖/摘要来源纯契约测试 owner。新增唯一 `RequestIR.CompactionTest` 检验显式 source 表、逐字义务、版本/身份/未来/重复负例与三 wire 保护集；预期从预先写定的原消息与选择表给出，不调用被测 evidence/selector/project 反推。现有应用测试中“当前回合全部工具均可压缩”的专属假设随目标退役，计划统一保留当前回合与全会话最近 K 已闭合项；当前回合已闭合项计入 K，并行工具组仍不可拆。3/10/20 会话机制、持久来源、运行态和 UI 测试继续放各自现有 owner，不增加通用测试执行框架。

**来源级 fence 的编码前裁决**：纯指纹唯一 owner 为既有 `RequestIR.DiscussionSummary.source_key/2`，经 `Compaction.discussion_source_key/2` 暴露；它绑定摘要协议版本、workspace/work/session、真实 run_id/run_sequence、完整模型原文及对应作者原文，排除随批次变化的 source_index。摘要 coverage_key 由有序源指纹派生，不含无关工具/Scope 覆盖；initialized 的 `owner_refs.discussion_source_keys` 必须与本次真实材料一致且先于 dispatch 提交，失败/取消/未知结果永久保有尝试事实。准入拒绝不伪计实际调用；恢复和提交校验重算 key/keys 及实际 pcall/prun/output hash。此字段首个消费者是同 run 摘要准入与 maintenance 选源；原始作者/模型正文只继续存既有 canonical，不写入这些指纹字段。

**原文 UI 外部编排查重（编码前）**：现有 `native_request_cost_drive.mjs` 负责 R01 作者轮次与真实终态，`NativeScenarioHarness` 已拥有唯一 AX 动作、截图、transport 与 owned relaunch，`native_http_evidence` 已拥有真实 HTTP 完整 body 观察；`authoring_history_evidence` 与 `authoring_auto_maintenance_evidence` 已提供唯一 canonical/DB 事实读取。旧 B71 driver 的整理细条函数为带顶层运行的私有编排，不能安全 import，也未走精确原文入口。裁决新增 `scripts/lib/native_ui/request_cost_history_drive.mjs`（及直接对应测试）只编排本次 notice → 完整原文 → 返回 → 客户端重启/重新连接，动作入口唯一消费者为既有 request-cost driver；报告纯结构与交叉身份校验 `verifyCompactionHistoryReport` 由既有 capture 复用，避免第二份 UI 规则；复用以上动作与事实 owner，不新增 DB reader、产品 hook、Transcript、面板或通用执行框架。先从真实 AX 可见细条及作者消息边界选择动作，再以本轮已知 run、合法 canonical checkpoint、同源 `checkpoint_created` 事件和真实 `around_turn_id` HTTP 回包对账；禁止以 latest DB 行选目标或猜测 `turn_range`。HTTP scope 扩展留在既有 owner，原文页要求同 work/session/turn 的唯一 query、完整 body 与请求身份，代理仅扩展已有响应 scope 投影。恢复事件沿现役 `agent-run-activity` 回包核对；多个 Step 补水同一父回合时保留全部请求，要求 request_id 唯一、每份完整且 body 一致，不能择 first/latest 绕过坏回包。覆盖 oracle 同时启用 `verifyExecutions` 与 `verifyRequests`，后者通过既有 logs owner 核同次实际摘要请求的精确原文材料，不另写来源哈希 codec。

**该 UI 场景的独立预期**：10 轮要求原文入口、当前会话返回、客户端重启/重新连接后的同一事件集合与类别计数稳定；该动作不重启 backend，不代签 durable 恢复，未注入重复交付时报告明确 not_exercised，重复 event 输入由既有组件测试独立覆盖；20 轮另要求实际刷新初始页中目标不存在、定位页中同一真实目标存在。`MemoryLog.transcript_page` 的默认 30 限额按 Interaction 行计算，轮数不能代替分页事实；不改限额、不造历史、不追加轮数凑证。目标作者原文字节、目标页行身份、真实事件 ID/类别计数必须逐项对账；AX 证明原文进入窗口，截图保留既有高亮样式待视觉复核，纯 AX 不代签颜色。外部编排/单测成功不等于真实 Tauri 已验收。

**原文导航的实际接线缺口与修复**：外部路径审计发现 `getSessionTranscriptPage` 已接收 `aroundTurnId`，但 `sessionTranscriptPagePath` 没有写入 `around_turn_id`，导致组件 mock 测试通过而真实跨页目标被静默丢弃。已在现役 `sessions.ts` 及 `sessions.test.ts` 修复参数传递/编码，并校验带空格、冒号的 `turn:early 1`；后端既有 around 页与 Interaction 分页未另造接口。root 执行的完整前端 typecheck/lint 与 **53 files / 498 tests / 0 failures** 通过，owned=`4450e3783d2793a3`，证据 `artifacts/model-contracts/b87-r03/20261115/frontend-history-url/`（源码哈希清单及 test.log）。这证明接线与局部回归，不替代本批真实原文跳转/高亮视觉验收。

**外部覆盖 oracle 查重与分责（编码前）**：全仓既有 compaction/checkpoint/maintenance 验收文件只有 `authoring_history_evidence` 的 canonical 读取与 `authoring_auto_maintenance_evidence` 的场景判据，没有独立的纯来源覆盖 owner。将本批新增的覆盖证明从 history 移入唯一 `scripts/lib/native_ui/authoring_checkpoint_coverage.mjs`（及直接对应测试），输入为真实 canonical 坐标、ProviderRun/Output 与同次请求事实；核验精确覆盖、原文哈希、逐字义务、完整工具组及受保护来源，失败保留全部历史。首个消费者为逐调用 Scope 核验、既有 C5/C6/G6、原文 UI 同源核验及 R03 批次报告；不读取 DB、不复制 projector、不从待测 wire/摘要生成预期。history 保持唯一原始行 decoder/只读事务职责。CP4 本批新增的原文分页消费集成 case 移入现役 `SessionMessageReadTest`；原有循环驱动、脚本执行及观察收集整体迁入现役 `TestAgenticLoopFixtures`，由 CP4/SessionMessageRead 两个真实测试共同消费，不复制第二回环。

**批次汇总/讨论测试事实规模分责（编码前裁决）**：全仓查重后，将本批 `evaluatePreregisteredCompaction` 从既有成本报告聚合整体移到唯一 `request_cost_compaction_evidence`；只组合现役覆盖 oracle、同次请求与冻结义务，不实现第二覆盖算法，首个生产消费者为 `request_cost_capture`，直接反例归邻接测试。将既有两个讨论事实函数整体移到 `fixtures/authoring_discussion_facts`；coverage、维护、G6 与批次直接测试共用，不保留 re-export、循环依赖或第二份原文期望。原作者输入文件与哈希保持冻结，合成测试事实不冒充实际模型输出。

**交错/运行态验收分责查重（编码前）**：既有 G6 纯判据目前只存在于 auto-maintenance evidence 私有区。将该完整职责迁入唯一 `authoring_interleaved_resume_evidence.mjs` 与对应测试，auto 保留现役文件/DB/WS 读取 wrapper；不新增 reader 或执行框架。现行目标为已完成的早期讨论可整理，等待 A 的全部原文/问题/工具组受保护，B 完成后用同一原问题回答恢复 A；等待及回答前快照由真实 DB 事实证明，最终请求按 pcall/prun 对账。旧“B 必须覆盖 active A”期望退役。checkpoint wire 字段解析从 auto 私有函数移入既有唯一 `authoring_request_facts`，两个判据共用严格原值；缺键/未知形状不能补齐。运行态端口观测从 confirmation 私有函数移入现役 `process_observation`，confirmation/auto 共用；auto 只读取 runner 的实际 owned_ports，明确外部 Splash 不在清理所有权内，观测故障不等于进程/监听数零。

新字段/模块/探索参数的精确 schema 与生命周期在责任层契约落实后才编码；上述审计不是“已实现”或“已验证”。允许分组 review/commit 的实现步骤，完整 R03 未闭合前仍为 doing，不把步骤改称独立完成批次。

**在途运行投影裁决（2026-11-15，编码前）**：取消目标时序审查发现 `DialoguePlanningService.judgment_run_summary(run, settle)` 会在业务回应时预测 completed，而真实 Server 尚需安全点维护；UI 终态单调合并因此收起仍在途的取消控制。当前 `AgentFinalizer` 已是结果运行摘要的纯投影边界，`AgentRunServer.commit_result` 已独占结果/状态/事件同事务，`WorkSessionService` 已按真实持久 run 重建历史摘要。裁决复用这些 owner，把实际 status/phase/身份白名单投影集中于 AgentFinalizer，Server 在现有输入裁决及最终新增交付边界归一，恢复消费者共享；不新增 DTO/状态/表，不放宽前端真终态单调性，不特判某个模型回应。独立预期为业务原文可交付、维护在途保持实际非终态与终止权、最终状态/事件/存储一致、二次交付失败整体回滚。已有运行/Interaction/维护测试承接反例；现役 native 完成 oracle 同时要求业务回应与真实 run 终态，退役仅凭 TurnResult.completed 结案的旧假设。此处后续修改需重新经过后端门禁，不能复用前一 source fence 冒称最终验证。

**前端运行摘要投影查重**：`WorkspaceChat.stateFromTurnResult` 现为唯一私有转换，但把缺少 status/phase 补成 completed；`agentRunAnchoring` 已拥有运行态合并与消息锚定的纯规则。将该既有转换整体移入同一纯 owner，并复用当前 WireTurnResult/AgentRunStateData 类型、既有字符串身份规则，WorkspaceChat 为实际消费者，原私有实现退役；缺事实只保留业务内容，不能生成终态。测试归现役 WorkspaceChat.agentRunAnchoring，原 ControlDock 与真终态单调性测试保持，不新增组件/模型/验收 hook。

**原生摘要出口查重与修订（编码前）**：封口预审发现成本/交错维护两个 producer 未携带完成门禁要求的 native 身份，成本 partial/fail 也未投影到门禁现役失败字段。全仓已有 `scenario_evidence.assertCommonEvidence` 与 `writeNativeSummary`，分别承担共同原生事实核验与摘要写出；复用它们并按[现役验收 §5.4](../../docs/design/acceptance/model-interaction-coverage.md#54-原生产物与完成门禁契约)修订出口。通用 writer 只接收场景已有 status 裁决与成本出口既有 writeDerivedJson 依赖，默认检查推导继续服务当前真实消费者；不新建 summary 模型/文件、不复制身份规则、不改 task_done 门禁。独立反例先覆盖缺身份、真实 partial/fail、合法可选 null、错 run/scope/driver、截图/等待账缺失及首份证据不可覆盖，再实施。该出口编码时真实场景尚未运行；其后首轮实际结果见 §14.5，冻结作者原文和阈值均不变。

### 14.4 实现阶段的验证与尚未签署项

**机制判据**：同一原始来源只有一份持久执行资格，资格与真实 pcall/prun 在 dispatch 前原子提交；并发竞争、重新分组、取消、失败、进程重建和结果未知都不能再授予第二份资格。不是执行后删除重复结果，也不依赖进程内 seen 集合。原调用结果未知时保留原文与未知事实，不重发；调用事实读取失败不得记为零或猜测次数。此保证是同源最多一次派发，不承诺外部调用必然成功或必然收到结果。真实双数据库连接竞争与未知计费反例分别保存在 `mechanism-check-01/`（22/0）及其之前保留的红例 `mechanism-counterexample-01/`。

**运行摘要阶段后端门禁的源码边界**：运行摘要 owner 与全部当前消费者迁移后，`backend-full-10/` 记录严格 Credo、`mix check`、I3/I1/I2/N-NARR，owned run `c75cc301605b845d`，exit 0、tree finalized；3314 个后端测试全部通过，强制编译无警告，编译依赖无环，架构/ADR/I-CACHE 检查通过，before/after 后端源码哈希一致。该证据替代运行摘要修改之前的 full-07。中间 full-08 的两处 AliasOrder 和 full-09 的 14 个旧裸 map 夹具失败保留；后者只涉及两个 B28 测试 owner，改用既有 AgentRun.new 构造器并保留原作者授权、完整预算和逐字目标，未增加生产兼容分支。独立 `check_module_size --check` 扫描 1010 文件通过，未改规模基线或 suppression；脚本出口修订仍需另验并冻结。

**运行摘要的独立反例与前端证据**：`runtime-summary-red-06/check.log` 用真实 DPS 业务回复进入同 run 摘要屏障，2 个测试均捕获实际 run 为 running、业务回复却预测 completed；`runtime-summary-green-02/check.log` 的 45/0 验证在途完成/取消及二次交付写失败的原子回滚。前端 `frontend-runtime-red-01/` 的两个反例先捕获缺 status/phase 被补成 completed；移除该补值、复用既有 agentRunAnchoring 投影后，`frontend-runtime-final-01/` 的 typecheck、lint、53 文件 501 个测试与 Tauri release app/DMG 构建通过（owned `662dece946ada1b3`，源码哈希前后一致）。这些测试不代签真实模型取消时序或原生界面视觉。

**原生完成判据的职责迁移**：所有查实的在线驱动和离线 evidence 完成消费者复用既有 `live_run_wait.wireTerminal`，组合同 run 业务交付与实际运行终态；在线还要求真实终态回包，真实 DB running 不能被旧回包覆盖。`artifacts/model-contracts/b87-r03/node-terminal-combination-20261115-02/test.log` 记录 18 文件 417/0（owned `0e1b471d0f554c9b`）；首轮 43 个失败及其原因保留在 `node-terminal-combination-20261115-01/`。该目录的 source-fence 明确是验证后的快照，未冒称事前采样；其后若修改产物出口，必须验证受影响契约并重建最终原生前快照。

**验收器独立反例**：原批次 oracle 曾按 run 最早作者归属后续讨论，可能把第 4 作者后的内容误报为前 3 作者内容。独立反例中其它覆盖/原文/后继请求检查全部成立，但作者序号必须为 3；修复按来源之前最近的同 run 作者坐标归属，义务摘录同源，原期望未改。红例 `preregistered-evidence-red/`、owned `dee6fd1aa133cf62` 留存；对应 22 个直接正反例通过。机械检查始终保留 `signed=false` 和语义待审状态，不能替代真实模型对未闭合义务的回应。

**测试环境事故与恢复**：早期 `backend-full-03` 的 I3 命令遗漏显式 `MIX_ENV=test`，向 dev 库写入本次三组 fixture，随后因 Strata 不可用失败。原失败日志保留；恢复以该命令 SQL 日志的精确 ID、标题与写入时间范围识别本次 69 行，先在线备份、再单事务删除本次 fixture，并逐表比较所有非本次行的前后哈希。`invariant-env-recovery-03/result.json` 记录 `restored_owned_test_records`、`unowned_rows_identical=true`，备份 SHA 为 `566502ad198e052d17bed540a5a5797523a2e71f89498a077a7bf20eb216766e`；没有重置作者库。此后全部后端验证在显式 test 环境及 owned 隔离数据库执行；失败没有被改写成通过。

上述相对目录均位于 `artifacts/model-contracts/b87-r03/20261115/`。full-10 只证明 Scope 修订之前的源码阶段；首轮真实三轮已失败并保留，后续职责修复见 §14.5/§14.6。仍待修复后的真实 3/10/20、按需探索正例、原文定位与视觉、交错问题、摘要取消、提交失败后的新来源与真实后端恢复、最终 task_done/full scan 和可 review 提交；这些缺项未闭合前本批保持 doing。
### 14.5 首轮真实三轮反例与上层目标复核（2026-11-15）

`native-3-01/` 已实际运行，三个作者输入均逐字匹配冻结文件；真实 run 均在业务回复后进入 completed，未发生探索、摘要或 checkpoint。该批 status=fail，唯一机械失败项为三轮低压：同次 pcall/prun 的真实 input_tokens 为 13992、22566、31827，最大值越过原定 22400 阈值；cached 是输入子集，未重复累计。原模型能力 262144、产品维护窗口 32000、比例 0.70、最近项 K=4 均未改。源快照 `native-source-before-01.json`/after 核实运行期间源码未变，首份失败及全部日志保留。

原始请求与 canonical 对账确认每轮新增 Scope 均来自真实消息，并非历史组合或 projector 重复投影。三份 Scope 的共同 facts 均为 14597 字节（章节 8173、角色 6200），每份还含稳定操作定义 3878 字节、探索描述 1754 字节；历史交互预览从 164 增至 4604 字节，goal.text 又复制本轮作者原文。维护器在第二、第三轮真实进入规划；三条讨论及对应作者 Scope 全处于最近 K 保护，零可整理来源是正确保护，不是漏调度。相关证据见 `native-3-01/maintenance-path-audit.md` 与原始 DB/请求。

作者效果复核发现三轮均保留风险表尚未完成，未把暂定视角当成任务履行；但首轮局部把模型假设说成作者已给定事实，第三轮主动提到无关的“沈砚”作品线。后者与默认 Scope 预装相符，实际没有额外探索读取。正文由 canonical、同 run WS 与 Interaction 三方交叉证明；日志未保存完整 SSE 正文，不声称另有原始模型全文。独立复核见 `native-3-01/independent-author-pressure-review.json`（SHA-256 `c0591d6e84c960f3bad307a5a6dd4782a8bbe607b62cd7d37c720a4f08f6cffd`）。本批不能签全语义通过。

依据愿景 §2.4、AGENTS §设计原则及 VS-00M §5.2，先修订 [VS-00M §5.2.2](../../docs/design/contracts/VS-00M-model-interaction-request-response-contract-pack.md) 与 VS-00L §19.2：从材料生产责任消除重复供给，保持 canonical 历史、当前回合与最近 K 保护，不在历史投影层增加隐藏过滤。三轮低压是本冻结对照场景的独立预期，不扩张为任意三轮的保证，也不因本次失败调阈值、作者输入或窗口。

### 14.6 判断材料职责修复的编码前裁决

**独立目标与反例**：普通新故事讨论首次请求不默认供应其它作品章计划、章摘要、角色长档案或全名册；后续请求不从 Interaction 再复制作者/assistant 正文。稳定能力定义只由协议底座声明，当前允许集、预算和状态变化不能被旧声明恢复。需要作品信息时，真实模型能主动发现章节/人物、读取有界完整来源，真实观察进入下一次判断及相关 writer，引用与版本只能绑定实际读到的材料；猜中合法但未观察的角色 ref、跨作品对象、tentative 档案、过期指纹和把目录当正文已读均应拒绝。作者原文字节、既有原文回查、未完成义务、实际登记/采纳事实及专业 writer 的完整目标基线继续保持。

| 编码前七问 | 本次裁决 |
|---|---|
| Contract | 消费愿景 §2.4、VS-00M §5.2.2、VS-00L §14/§16/§19.2、B29 角色指纹和现役 RequestIR/Observation 契约；查询仍是既有 explore_request 的 tool/query，不新增模型工具或表。 |
| Invariant | 每种事实由其现役责任者生产；默认判断材料满足最小必要供给；真实读取与来源/版本对应；当前权限不能由历史恢复；原文、候选采纳边界与一次来源执行资格不变。 |
| Boundary | novel_application 的 DPS/协议/交互投影/探索/角色绑定，消费 novel_domain 和 novel_persistence 的既有真实读口；外部验收脚本记录实际请求。不得为此全局删 DialogueContext、改数据库事实、改作者 UI 流程或引入兼容分支。 |
| Consumer | 当前判断器、其同 run 探索后再次判断、角色精准候选执行，以及 writer 对实际 Observation 的引用校验；没有当前消费者的新抽象不建立。 |
| Proof | 先写独立反例，再核材料缺省、目录/详情分页、跨作品/状态/版本拒绝、实际观察引用和稳定 Base/当前 Scope 权限。保留首轮失败；原冻结 3/10/20 与交错场景重新取真实证据，并加现役 G2/角色正例，stub 只证明接线。 |
| Acceptance Driver | 继续 native_request_cost_batch/drive 与 native_b71_batch/live/auto 及原有 evidence owner。产品验收感知逻辑为 no；外部 Splash 参数按真实 runtime 配置，外部服务无 load/unload/stop 所有权。 |
| Exploration | archive_read 正常章节/人物目录与对象详情查询复用 ReadingProjectionService、CharacterProfile/AdoptionRepository；真实 ref/指纹/coverage/分页进入现有 AgentObservation，再进入后续实际请求和 used_context_refs。目录只发现对象，不伪装完整正文；不按作者关键词预装 packet。 |

**逐实体复用/退役裁决**：DPS 已拥有判断 Scope，收敛其材料白名单及实际 base_refs；JudgmentProtocol/AuthoringTaskPolicy/CapabilityRegistry 已拥有稳定协议与能力定义，移走重复定义但保留本 profile 的真实定义与当下 allow-set；TurnInteractionService 的 context_payload 只有 DPS 生产消费者，退役其中重复原文预览，保留登记/处置/采纳事实与来源。领域 goal 和原 Interaction/canonical 记录保留，Scope 仅引用 goal 的来源与版本。ExplorationService 已独占探索目录/观察，补正常 chapters/characters 发现、详情分页和 metadata 的真实 refs/versions/coverage；CharacterProfile 与 AdoptionRepository 已拥有人物状态/工作区/指纹与最终原子采纳核验，复用其绑定且要求实际观察，不复制指纹算法。JudgmentToolContract/AuthoringTaskPolicy 同批退役“从默认人物索引复制 ref”的规则。上述均有本段指定当前消费者，不新建 reader、registry、packet、缓存、Kernel、控制环或第二事实存储；若具体实现提出新实体，必须先另行裁决，不能以此段笼统授权。

**实施与验证顺序**：先完成责任层设计和本计划，再在现役测试内固定反例；产品投影与探索链同批迁移，退役只保护默认预装的旧测试。单独迁移现役 G2 live 的 provider/runtime 与 owned cleanup，沿真实同请求 Base/Observation 证据，不用旧 PASS 代签。全部改动完成后重跑受影响测试和完整后端门禁、重建原生源码快照，再以新目录运行原冻结输入；新产物不得覆盖 `native-3-01`。10/20、原文视觉、交错/取消/恢复及完整 task_done 未闭合前仍为 doing，未提交代码。

**现役 owner 补充裁决（编码前）**：`AuthoringOperation.runtime_scope/2` 已唯一投影 authority_scope/budget/consumed_budget，提升该既有纯函数供 JudgmentProtocol 复用，避免第二运行事实组装器。`WorkArchiveService` 已拥有应用档案读取边界，承接 ExplorationService 既有 archive facet 查询/格式策略和本次目录/详情分页，返回真实材料 DTO；ExplorationService 保留唯一工具目录、预算和 Observation 包装，二者不循环依赖，原 panel 消费者保留。人物操作由同一 CharacterProfile.observed_target 在协议及 PendingArtifactWorkflow 实际候选构造前核验观察与当前指纹，不能在后二者之间静默换成未观察的新基线。narrative_role 修改所需身份/消歧字段、当前叙事身份、采纳状态和真实完整指纹必须已完整返回；长 summary 的未读页明确保留，不为无关全文强迫续读，也不把目录当详情。既有三字段 fallback 指纹和缺状态对象不得进入新真实观察绑定。

**真实请求引用日志查重（编码前）**：当前 LLMLog 记录真实 HTTP body 与 pcall/prun，但没有同请求 IR.refs；ProviderRun.metadata 也没有该事实。复用唯一 Gateway → LogContext.with_provider_call → LLMLog 记录链，将 Gateway 实际传入 adapter 的最终 IR.refs 随同调用作用域传递，LLMLog 在现有 request 下记录 refs（base_refs/observation_refs/used_refs 原值），不写入 HTTP body、不复制材料正文、不新增请求表或日志文件。LogContext 公开入口原地迁为显式四参并迁移全部当前消费者，作用域结束/异常/嵌套/并行仍恢复原值，turn 入口清空旧绑定；未知引用不补成空数组。现役 gateway_execution_refs/LogContext/LLMLog 测试覆盖两次不同请求、真实 SSE 适配器与错误记录、作用域恢复和正文不变；外部 authoring_request_facts/liveRefsCheck 消费同一记录，缺证保持失败，不能推导来源。

**人物原生正例查重（编码前）**：B29 已有真实 seed、作者原文“指定老沈为主角”、页面 driver、candidate 卡片读取及 before/after DB capture。复用 `tauri_slice_verify.sh b29-existing-character-role-revision`，只在同一外部 owner 增 `B29_NATIVE_MODE=r03-candidate` 冻结边界：真实 Splash 参数沿现役 profile，动作停止于 T1 候选并取得 t1-after/final，零采纳、零 T2；这不代签旧 B29 全矩阵。新模式补实际目录/详情探索→后续 judgment 的请求身份/refs/指纹对账，继续使用现役 history/call/refs reader，原 input/seed 不变、没有新 batch/driver/产品 hook。精确判据先写于现役 acceptance §5.5 后才编码。

**能力目录与对象读口查重（编码前）**：原 DPS 判断名称集合与 Pending 四组操作名称迁入既有 AuthoringTaskPolicy，当前消费者分别通过 judgment_capabilities/0 与 artifact_capabilities(kind) 取同一事实，效果/风险/契约仍由 CapabilityRegistry 定义；Policy 不反向依赖业务 workflow，不新增注册表或两套名单。CharacterProfile.target/2 复用既有单对象持久读口，统一真实同作品、明确 accepted 状态及完整持久指纹；WAS 详情与 observed_target 共用它，不为单对象扫全 roster。仅退役 CharacterProfile 内动态导出探测/旧档案降级/三字段伪指纹；persistence_character_reader 仍有十个专业消费者，保留其现役职责。

**已供应观察的来源裁决（编码前）**：同 run 不是已读事实的定义。判断器以本次 prepared RequestIR 经既有 Compaction.project 得到的真实可见消息，再用 RequestIR.observation_payloads 取得真实观察叶；已有历史详情仍可见且当前指纹一致时可复用，被 checkpoint 隐去、只有累计 refs、目录或模型自报均不能取得资格。CharacterProfile.observed_target(work_id, ref, visible_payloads) 是唯一匹配规则，返回 {:ok, target, original_leaf}；协议成功的既有 judgment 仅增加内部 character_observation，保存被选中的原 canonical 叶，不从模型参数读取，也不重建基线。Pending 实际派发用同一叶重新核当前指纹，不重新组合历史，不另传全供应集或接受 raw exploration 兼容形状。该字段只在本次判断→候选链消费，不进入模型工具 schema、HTTP 或 Scope，不创建新持久实体。另补已供应历史有效、隐藏/过期/缺字段无效的独立反例。 既有 reply_record.supplied_observation_refs 由相同 prepared 可见叶生成，DPS 原 raw explorations 来源退役；未实际 append 或 checkpoint 隐藏的观察不得进入该次供应声明，B27 同源测试核真实请求/回复记录。

**测试与外部证明 owner 审计**：B29 现役文件原纯测试为 async，候选派发旧夹具依赖 fake roster/work/fingerprint；该文件新建 DB 分区 B29CharacterProfileObservedDispatchTest 已先写红例，随后补齐存在性/职责审核，不能将这次顺序记作创建前已审。该分区专管真实候选派发，原六个 fake 派发用例整体迁入并退役假 context 通道；既有采纳事务及采纳后读投影测试继续各自职责，不并行两套派发契约。外部全仓没有 B29 纯 Node 判据 owner，批准唯一 native_b29_evidence.test.mjs；新增唯一 authoring_character_candidate_evidence 只承载既有 candidateFacts/stateChecks/zeroWriteBetween/候选身份字段规则的整体迁移与当前 R03 取证目标。旧 B29 与 R03 共用它，native_b29_evidence 保留唯一 IO/流程聚合，history/call/request reader 复用，无 re-export、新 DB reader 或新验收框架。新纯判据消费真实 before/after、canonical/Provider/同请求与候选事实；独立来源字段与指纹不能从候选/观察反推。

**本阶段红绿证据**：minimal-scope-red-01 的四个独立判据全部在预期责任处失败（owned 13a18c38985bd1c6）；archive-observation-red-01 为 9 例/7 失败、2 正例保持，包含未观察目标被放行及派发时默许新基线（owned c79f92f531877428）。request-refs-red-01 捕获真实 SSE 适配器日志缺 refs（5/1，owned 9b9078b3b566da1e）；显式传递本次 IR.refs 后 green-03 的 25 个 telemetry 与 5 个 agent 测试通过（owned c435beb8a3deddfa），验证两次不同供应集、HTTP 字节不夹元数据、错误记录和上下文恢复。中间 green-01 的子 app 入口加载错误、green-02 的测试输入未声明 refs 却预期三空数组均保留；修正入口与独立 fixture，不让生产补空冒充已知。均为隔离 MIX_ENV=test；这些证据不代签原生或整批 PASS。

**分页执行资格裁决（编码前）**：DPS 已有 continuation_only? 与两轮普通/八轮分页预算，但 JP 目前只验工具在允许名单，未执行同来源/next_offset 限制。现役 ExplorationService.chapter_query、SessionMessageRead.parse_query、WorkArchiveService.selector 已各自唯一解析对应参数；后二者提升窄公开，ExplorationService 复用它们统一 continuation_request?，JP 在既有 continuation_only? 分支消费，DPS 从最后真实档案页生成同一预算坐标。无新增控制循环、预算或 parser。反例先覆盖人物 A 后改读 B/目录/跳页/换工具、会话改 run_sequence、章节改 ref；原精确下一页保持可读，不调整上界。

**目录的实际消费者裁决（编码前）**：CharacterRosterNarration/TurnExecutionService 与 ExplorationService.role_fact_note 已按真实 narrative_role 回答零/一/多主角；移除默认全名册后，正常只读查询仍须在既有额度内可达。characters 显式目录补 narrative_role/status 轻量列，coverage 列明实际字段/条目范围；不含自由文本 role、summary、updated_at 或详情基线。详情所需完整字段与指纹仍是精准修订前提。独立正例用三位 accepted 人物呈现两个主角，反例排除外作品/tentative、不将未标记者猜为主角、目录不得获得 execute 资格。 ExplorationService 的 character_role_note/role_query/role_fact_note 仅在 memory_recall 按关键词暗读人物并拼文，人物来源/版本却未进入观察；正常显式目录已承担当前消费者后，同批退役这条隐式补料及其专属测试。独立空记忆反例要求主角关键词不能凭隐藏档案生成记忆事实，正规 character_roster 及其叙述消费者保持。 章节目录的 has_prose 复用 ReadingProjectionRepo 已存 accepted/edited_accepted 正文 word_count>0，WorkspaceContext/ExplorationService 已有该语义；同名 tentative-only 章与 accepted 章的独立反例先行，不供正文或推定正文已读。

**外部及 deterministic Provider 消费迁移裁决（编码前）**：G2 的 pageCheck 与附属同请求匹配整体移入既有 authoring_call_evidence.observationNextRequestEvidence，G2/B29 共用，不保留双实现。B71 pending oracle 按 acceptance §5.5 核身份/状态/标题/前后继/计数/覆盖，正文的完整证据仍归已有 writer/canon owner，退役默认 body_preview 与正文替代身份断言。slice_verify、pending_dialogue_input、stub 三个现役测试 Provider 改为消费实际 Scope 元数据及按需探索观察；不得读隐藏 DB、伪造 observation 或恢复默认材料，只证明协议接线。专业 writer 的完整基线与当前输入契约保持。没有新的模块或注册表；测试先覆盖无正文的合法状态、缺/错身份字段及实际探索往返，再迁实现。 G2 现有 provider_events.started 查询从 authoring_run_evidence 私有读取提升为同文件 readNativeCallStarts，G2/B29 两个当前 caller 复用，原查询不复制，不新增事实文件。

**职责修复的中间验证（未签原生）**：scope-history-red-03（owned ad08a394741191f5）捕获真实可见历史详情被旧 raw 入口拒绝；同组 checkpoint 隐藏/累计 refs 拒绝正例通过。red-01 的工具块参数顺序错误及 red-02 的 refs fixture 形状错误保留为夹具错误，不计产品反例。archive-index-red-01（05fea086e3c8bdb0）捕获目录缺真实多人身份及记忆查询暗补人物；archive-chapter-red-01（f9563334f10cce89）捕获同名章节无正文状态。修复后 archive-binding-focused-01（833c91fca9e4e3a7）六个现役应用文件 66/0；先前 scope-history-green-01 的唯一 refs 夹具形状错误已按契约修正。pending-metadata-red-01 捕获旧 Scope 正文要求及可缺身份的错误，第三失败仅为拟迁字段名尚不存在，不冒称语义反例；pending-metadata-green-01（cb313b73fc6a7f2c）pure+IO 66/0，原 writer 字节/采纳前后 canon/动作绑定仍核验。外部 G2/B29 有限联合 g2-b29-final-01（28ca2a1f96d18785）273/0、449 个 scripts 文件前后哈希一致；正式模块规模门禁另报 JP 与探索测试超 ratchet，仍待按真实职责收敛，不改基线。provider-material-red-01（297a92cadbb875e9）两条真实目录接线反例失败；首次 green-01 已通过 canonical 读取，但两个旧 pending 正文 fixture 尚待迁，不能计总体绿。续读 red-02（450a4fa05c05aa65）捕获换对象被放行与档案续页资格缺失，red-01 的空权限构造错误单独保留。全部是中间源码阶段证据，完整门禁及真实场景继续待完成。

**测试职责收敛裁决（迁移前）**：ExplorationServiceTest 的人物关键词不得暗供档案 DB 反例整体迁入已有 B29CharacterRoleConsumerRefreshTest。该 owner 已验证人物主档案与正规只读消费者的真实刷新，本例对照同一当前人物事实在 memory 路径中不得被无来源供应；探索测试保留通用目录、元数据、分页职责。无新模块/fixture、无断言删除，正式规模规则与 baseline 保持。

**判断职责收敛裁决（迁移前）**：JP 的角色动作绑定整段迁回已有 CharacterProfile.bind_judgment(judgment, work_id, visible_payloads)：只校验角色操作、真实作者指定的叙事身份、实际详情与当前指纹，并在原 judgment 绑定选中的 canonical 叶；JP 继续独占 prepared 请求与可见叶提取，Pending 仍用现有 observed_target 重核，不新增 DTO 或来源 reader。固定能力/探索定义组合与当前名称允许集的合法性校验迁到已拥有这些规则的 AuthoringTaskPolicy.judgment_definitions(catalog) / validate_judgment_options(options, exploration_tool_names)；目录/名称由现役 ExplorationService 静态接口显式传入，效果定义仍复用 CapabilityRegistry。该校验只负责名称是否属于定义目录，不扩大为权限/运行预算判定；原 JP 函数主体退役，当前唯一消费者为 JP，无 Policy→Exploration/Workflow 反向依赖。结构调整保留原观察/权限反例，不以基线例外或压行通过规模门禁。

**B30 现役消费者迁移裁决（编码前）**：章节编号维护判断原依赖默认 Scope 的章节与 planned_volumes，后者已由现役 WorkArchiveService.profile 的真实“预计卷数”行提供。测试 Provider 的既有 chapter_structure_arguments 先取得 chapters 目录，非空时再显式读取 profile；两份实际可见观察齐备后保留原卷号/越界/多卷歧义规则。planned_volumes_from_prompt 仅从实际 profile 观察的明确字段行读取，已读但缺值保持未知，不从 Scope、DB 或默认数值补材料；没有新字段、reader、预算或产品策略。对应旧三例迁 canonical 目录/简介，保留原执行/第9卷拒绝/多卷澄清目标，增加未读简介须取证反例。



 TestProviderPrompt 已是测试请求读取 owner，将 SliceVerify 已有 observation_payloads_of_tool_message 的读取职责迁入其 visible_observations，复用 RequestIR.Compaction.project 与 observation_payloads；SliceVerify/stub 共用实际可见档案观察，不建立第二投影器。专业 AgenticPlanDraftPlanner 仍明确生产 facts.chapters/goal.text，相关解析保留在专业计划路径；判断路径独立走按需读取，不以专业材料作为旧判断协议兼容。

### 14.7 来源唯一性机制复核（2026-11-17，实施前裁决）

**作者纠偏**：本次要求“从机制上保证没有重复，而不是防重”。此前会话中提出的 Available/Reserved/Committed 通用状态机与额外 MessageID 只是未经查重的建议，不视为已采纳或已实施。本次重新读取 AGENTS、愿景 §2.1/§2.4、责任契约、运行状态机与 Git 历史。工作区基线仍为 `f7f8e461`，219 个已有变更保留；证据 `artifacts/model-contracts/b87-r03/20261117/ownership-mechanism/before.json`。

**已核实的机制与缺口**：`ProviderRunLog.admit_operation` 已在 SQLite immediate 事务内先取得来源执行归属，再放行 Gateway；不是执行后删重，不能为了措辞否定该机制。`47a7fb98` 也已经把会话覆盖验证放入原提交事务。真正偏差是 source_key 将消息身份与正文/协议版本混在一个 hash 中，同一 canonical 坐标改变正文就会得到新资格；并且 Summary.prepare 当前信任内存 plan 的讨论材料，在 dispatch 前没有以实际 canonical 持久源核实。最终 checkpoint 拒绝不能抵消已经发生的错误调用。

**独立目标与反例（先于实现）**：同一作品/会话/run/run_sequence 始终是同一来源，不因文本、作者原文、source_index、摘要协议或分组变化获得另一份执行权；两个不同坐标的相同文本仍是不同来源。未持久、错作品、非已完成外 run、坐标/版本/原文字节与实际源不符的计划必须零派发、零准入；持久读失败也不得把未知当空历史。来源核实与资格分配须处于同一写事务，不能先读后竞态写；调用发生时恰有一份已提交归属，已取得资格后的普通事件/最终结果不可改绑。内容变化必须使完整请求的完整性摘要变化，而不是改身份。重复/并发和未知结果继续保持最多一次本地派发，不把缺少本地结果当作外部没有执行。

**方案比较**：A 继续补充 attempted_sources 排除条件，不能解决来源身份和消费边界，拒绝；B 新建通用来源状态机/租约/任务表，会与 ProviderRun、AgentRun 和 canonical Checkpoint 重复持有事实，当前无需，拒绝；C 在现役 ProviderRun 原子准入中落实稳定身份与实际来源核实，保留已有执行/取消/预算/恢复 owner，采纳。本决议是工程实现选择，不改变作者目标、冻结场景或已有主权边界。

| 七问 / 存在性 | 本轮责任裁决 |
|---|---|
| Contract | 修订 VS-00L §16.2.1，分开来源身份、请求完整性与已提交覆盖；不是把 §14.3 历史指纹裁决改写成从未发生。 |
| Invariant | identity 不含可变内容；取得归属前真实源核实；读核实/竞争裁决/initialized 写入同一事务；未获归属零派发；原文/当前范围/未解义务不变。 |
| Boundary | DiscussionSummary 纯身份；AuthoringSessionHistory 复用真实会话行读取及已有坐标/来源解析；Summary 冻结材料与内容摘要；ProviderRunLog 只持有事务及注入的窄核验，不反向依赖 application。 |
| Consumer | AgentRunMaintenance → Summary.prepare → Execution.with_admission → ProviderRunLog 的现役唯一路径；checkpoint 恢复继续核对同次请求完整性。 |
| Proof | 先录同坐标改字节、无持久源、事务内核验失败的红例，再验证真实持久源正例、两个独立连接竞争、拒绝后无调用/无行、同源重分组、跨作品、取消及未知结果。期望来自预注册 canonical 输入和真实调用计数，不来自被测 hash。 |
| Acceptance Driver | 复用 R03 既有 3/10/20/交错/取消/恢复与独立外部 oracle，不改原输入/阈值/完成标准；局部测试不得代签完整 R03 或页面。 |
| Exploration | 不新增工具或作品材料；session_message_read 及原文历史不变。 |
| Existence audit | 无新增表、列、模块、主模型、状态或 UUID。现有 DiscussionSummary.source_key 原地修正；现有 AuthoringSessionHistory 增加由 Summary 直接消费的真实讨论来源核验，复用其读取/normalize/坐标及 Compaction 的来源规则，不另写 DB reader。ProviderRunLog.admit_operation 原地收紧为必传来源核验的三参入口，Summary 与现役持久测试直接迁移，不保留二参兼容。coverage_key 改为完整冻结讨论材料的 digest，沿同一 owner_refs 字段；原文不写入 ProviderRun/Output 摘要。 |

**持久格式边界补审（编码前）**：仅替换 hash 算法会把既有旧指纹错误当作另一来源，反而重新派发。复用现有 discussion_source_keys 字符串字段，当前坐标身份编码显式为 `authoring-session-source/v1:` 加固定顺序 `[workspace_id, work_id, session_id, run_id, run_sequence]` 的规范 JSON；格式标记属于身份编码，不含摘要协议版本，不新建字段/表。纯格式验证归已有 DiscussionSummary，ProviderFactMerge 复用；ProviderRunLog 的归属读取改为显式 `{:ok, keys} | {:error, unsupported}`，旧格式/缺来源不能当空集合，也不回填或抹除。读侧和同事务准入均拒绝不支持的已有归属。planner 参数改为 owned_source_keys，明确它是持久执行权投影，不是已执行或已完成清单。所有现役消费者/测试直接迁移，没有旧接口/旧格式兼容分支。另由既有 MessageCoverage.turn_positions 核实源作者回合确实可定位，禁止用空作者文本填补未知来源。 反方复核进一步排除用 hash 代替主身份：直接编码已有复合坐标，避免引入概率碰撞；读侧解码后必须与当前 scope 一致，且重新规范编码与原字符串逐字相等，空白/转义别名不得成为第二份资格。内容的 SHA-256 只用于冻结请求及响应完整性。

**测试职责归位（迁移前）**：本轮新增的“真实持久来源 → 执行准入”消费者集成测试归现役 AuthoringSessionHistoryTest，复用其真实段 seed 与既有 Stub/Gateway 事件回调；原四项材料篡改、活动 run 拒绝、零派发及合法来源可执行控制组完整迁移，补未持久源和跨作品反例。SummaryTest 保留单次响应/持久输出/取消及运行态维护职责，不复制 CaptureProvider、环境 setup 或夹具模块；无新测试文件、无断言缩减、无门禁基线修改。

**反方与未闭合边界**：即使取得执行权后从不重发，也不等于作者目标已完成。已完成 Provider 输出与最终 checkpoint 之间仍有可恢复性缺口：当前 ProviderOutput 只存安全摘要/hash，未持久的正文不能凭 hash 复原。不得把这种状态显示为成功、自动重新授予资格，或将 raw text 偷塞入作者安全日志；完整处理及原生故障证据仍属本 R03 未闭合范围。纯防重表不能修复此缺口，亦不以本轮准入修复签署完整恢复。

### 14.8 续行复核与现役消费者闭环（2026-11-17，实施前）

现场仍为 `f7f8e461`，219 个既有变更、无暂存；五份原 WIP 哈希不变。本次快照为 `artifacts/model-contracts/b87-r03/20261117/continuation-20261117T073614Z/before.json`。显式 `MIX_ENV=test mix compile --warnings-as-errors` exit 0；来源/准入/摘要集成重跑 53/0（`ownership-focused-01`，源码前后不变），包含两个独立连接与未知结果不重发。随后完整后端 `backend-current-01` 仍有 13 个应用测试失败，不能沿用更早全量 PASS。

**资格与完整性的反例（修改前）**：同一 operation/scope 下两份不同 canonical 坐标，即使请求完整性摘要碰巧相等，仍是两份不同来源；完整性 digest 不是执行权身份。现有准入 SQL 的 `coverage_key 相等 OR 来源相交` 把两类事实混用。先在已有 ProviderOperationAdmissionTest 写“同摘要、不同来源各自可取得一次资格”的独立失败例，再让唯一准入事务只按真实来源坐标裁决重叠；coverage_key 继续不可变且用于同次请求/结果完整性核验，不删除它，不引入新表或第二 owner。Summary 的准入回调以同模块私有职责分离，取消与来源核验仍在原边界执行。

**消费者迁移判据**：§14.6 已批准判断最小供给，现役回归不能要求默认预装章节、人物或重复 goal.text。steer 必须仍证明当前 receipt 的完整原字节及 source/version；已读章节身份和覆盖从实际 Observation 验证；版本预期来自调用前实际持久源，不来自被测 projector；人物候选派发先用现役探索链形成真实 canonical 详情并绑定，再核候选/零写入/trace，不恢复未读 ref 旁路。提示规则测试保留系统可读事实先取证、已读充分事实直答、统计不证明质量及未答义务保护，不再保护“未供应目录亦可直答”的旧假设。B31 计划链失败须查实际请求与拒绝原因，不能增加无业务意义调用或删等待判据。

**职责与查重**：本段不新增模块、Schema、表、事件或测试框架。来源事务仍归 ProviderRunLog，材料核实仍归 AuthoringSessionHistory，规则仍归 AuthoringTaskPolicy，真实角色详情仍归既有 ExplorationService/CharacterProfile；现有测试 owner 原地迁移。Logger 的同调用 refs 只登记为已存在 metadata key，保持普通 formatter 不输出该载荷；结构化 LLMLog 继续唯一消费。规模/复杂度问题只允许按现役职责归位，禁止压行、提高基线或放宽阈值。I-CACHE 如需迁移，只调整已退役生产接口的输入夹具与上层已经修订的供给责任，前缀比较算法、三 wire 与因果/原字节不变量保持；实施前须明确其现行设计依据。

源码、独立失败例、验证与最终原生证据分别留存。上述 53/0 仅证明局部机制；真实 3/10/20、原生回查/取消/恢复、默认完整扫描与 task_done 未闭合前，R03 保持 doing，不提交未经验证的完整批次。

**B31 因果定位与小职责归位（实施前）**：`b31-causal-02/diagnostic.log` 捕获到新增目录读取直接分支发送 `frame_type/record_only/reply_included` 三个已退役字段，生产 schema 正确拒绝；同时目录默认分支抢占既有 plan-exhaust 专项刺激。修复只在现役 SliceVerify：探索构造器直接产生四个现行字段（action/reason/dialogue_goal/explore_request），显式专项计划先交还已有计划裁决链，后续计划仍真实读材料；不增加产品场景识别、兼容字段或无意义调用。现役 canonical IR 测试补完整参数集合断言，B31 保留原输入与 plan_drafted→awaiting_author 断言。CharacterProfile 的读取范围/形状/完整字段/新鲜度检查拆成同一模块私有职责并保持错误顺序；SliceVerify 的主角问答读取分支抽成私有函数，不引入新实体。

**模块职责与探针审计（实施前）**：完整后端 `backend-current-02` 3,340 项均无断言失败，但 AU03 测试未使用的默认参数令 `--warnings-as-errors` exit 1，不能报全量 PASS。规模修复按现有职责：立项修订字段枚举与值校验归已有 JudgmentToolContract，协议只消费其结果；同 schema 枚举与现行错误顺序保持，无新 validator。现存 `SliceVerifyQualityRevisionFixtureTest`（原大文件内独立模块）原样移到同名职责文件，4 个测试及全部 setup/helper 一起迁移，不新增类；日志私有字段裁剪用例归已有 SliceVerifyLogTest，复用其日志读取和生命周期，并修复其配置恢复误写 novel_common 的真实隔离缺陷。请求材料读取用例归现有 canonical IR 测试，移除原重复 helper，不能删断言换规模绿灯。

I-CACHE 按 VS-00L §19.2 / VS-00M §5.2.2 的既有最小供给裁决，在 VS-00I §4.3 登记判断 L2 为实际供应的作品身份/标题/版本；旧强制预装章节尾项不再代表目标。驱动只迁移已退役 judgment_scope 参数和实际材料引用，并增加未供应章节绝不能进入 Scope 的独立断言；共享前缀计算、tools 字节比较、enforce、三 wire 和专业计划的全章节材料断言保持不变，不通过减少专业必需材料、拼第二样本历史或降低阈值通过。

**日志责任纠正（实施前）**：`core-gates-01` 已实证 compile/模块规模/diff/xref/arch/I1/I2/I3/N-NARR/10 行 I-CACHE 通过；Credo 仍因五处 request refs metadata 失败。前述“全局声明 metadata key 即可”的判断撤回：已读本地 Credo check，实际只检查 formatter 输出键。目标不是打印更多材料换绿灯，而是请求证据不进入通用日志。已核对 LogContext/LLMLog/Gateway/SSEStream.Result：现役最终日志在调用者进程同步写出，没有跨进程消费者；LogContext 已拥有同次调用生命周期，新增只读 getter 的首个消费者为 LLMLog，不建第二 owner。按 ADR-0034 新补充将 refs 移出 Logger，保留同次调用私有作用域、未知与真实空值、所有异常路径与关联键；旧全局配置声明同批删除。先增加作用域内 metadata/snapshot 不含请求载荷的独立失败例，再修实现；现有 Gateway 真实 adapter 逐调用 refs/HTTP body 不污染回归必须继续通过。

### 14.9 断线恢复与真实十轮暴露的事件归属缺陷（2026-11-17）

**状态仍 doing，未提交/未签 R03。** 本次恢复同一 Session/HEAD；226 项既有改动及原五份 WIP 的基线见 `artifacts/model-contracts/b87-r03/20261117/reconnect-20261117/before.json`，原五份哈希未变。当前 compile exit 0；前次完整后端 3,345 tests/0 failures 的源码比对仅剩外部测试修复差异。本次该文件 24 tests/0 failures；默认完整扫描 Semgrep 已清，仍 19 pass/2 fail（过期 task_done/UI manifest 与已登记历史 gitleaks），不能报全绿。

**原生证据**：`native-3-reconnect-01` 使用原冻结输入/完整隔离副本/模型和阈值，exit 0，实际 input tokens 9407/11277/13730，均低于 22400；零工具、零 checkpoint 是低压控制的正确结果。独立实际 DB/Provider refs/作者原文核对见同目录 `independent-author-review.json`：风险表仍待完成；暂选被扩成另一建议作废、裸 Markdown/中英混用仍保留为语义/呈现问题，不签全部产品质量。`native-10-reconnect-01` 的十轮对话已完成，真实三条整理事件计数分别 4/2/3；第六、七、九轮的细条在实际 AX/截图可见。**首次客户端重启后的历史细条恢复失败，exit 1**，旧失败目录不可改写。两个批次源码前后 hash 完全一致。

**已验证根因，不再猜接线缺失**：十轮真实 SQLite 保留全部三条事件；重启后的 HTTP `http-59/http-63/http-65` 均返回对应完整 `checkpoint_created`/新计数/来源定位，全部十轮 activity 查询成功。随后本地 pending submission 重传旧消息，ACK 的 `turn_results` 仍是业务交付时的 running 快照。`upsertAssistantTurnResultMessage` 按 TurnResult 整体替换消息，擦掉刚补入 `turnResult.agent_run.events`；独立 loaded map 仍为 true，故不再补水。原渲染测试只把事件 JSON 往返后直接送入组件，未覆盖实际「恢复 activity → 旧回执重放」链。

**修复前独立目标与反例**：同一持久事件只产生一个作者可见记录；HTTP/WS 任意先后、重放 TurnResult、恢复快照覆盖、同源重复送达均不能删除、重复计数或改绑已见事件；另一 run/work/session 不得混入。业务结果快照不决定当前运行状态，不承担运行事件存储。当前事件归属必须在组件调用链真实可见，禁止只加保存旧 events 的条件补丁、清 loaded 强制重拉或放宽 AX 等待。实际失败批次是实施前红证据；机制测试不能代签后续原生复验。

**七问/查重裁决（实施前）**：Contract=46 §9.9 与同一 AgentRun/author-safe event；Invariant=事件身份/范围、原文、状态单调与业务交付≠执行终态；Boundary=现有 WorkspaceChat 状态 owner、agentRunTimeline 纯事件函数、WorkSessionService 只读摘要；Consumer=真实 HTTP 补水/WS/回执重放/历史分页；Proof=原十轮失败、独立输入的同源事件与回执交错用例、重启原生复验及共同门禁；Acceptance Driver=现有 request_cost_history_drive，不改判据/输入/超时；Exploration=不新增作品工具/材料。**无新增模块/表/Schema/事件/状态系统**。已有 `agentEvents` 承载唯一运行事件视图，HTTP 与 WS 共用；退役 TurnResult 内 events/provider_runs/activity_loaded 和独立 standalone event 副本。纯事件校验/合并由现有 agentRunTimeline 接收，旧私有实现删除；实际运行状态汇入已有 agentRunStates，不改写业务 TurnResult。现有 Provider activity HTTP 仍是独立查询事实，不因客户端旧字段退役删 API。单一来源不是同文本去重：消息回执不能改变事件集合；事件 id 仍用于同一持久事实的重复传输合并。

**实现与共同门禁（本次恢复）**：上述事件归属方案已落地，无新增模块/表/状态系统；`agentRunTimeline` 组合纯函数、现有 `agentEvents`/`agentRunStates`、真实运行状态的送达确认共同承担当前消费者。`event-owner-check-01` 的两个 frontend lint 与三个 EOF 空行失败已原样保留；修正后 `reconnect-20261117/event-owner-check-02` 的前后端命令均 exit 0，源码前后 hash 不变：前端 53 文件/505 tests，后端 3,345 tests/0 failures，另 `mix check`、xref、arch、I1/I2/I3/N-NARR/I-CACHE、NEXT、module-size 与 diff 检查通过。纯函数/SSR 只证明交错输入与显示投影，不代签完整 WorkspaceChat 异步接线；原生证据仍是必要条件。修复前事件丢失的逐 run/HTTP/旧回执因果证据已写入旧失败批次 `native-10-reconnect-01/restoration-cause.json`，没有改写原失败结果或原始数据。

**修复后真实十轮复验仍 FAIL**：新目录 `native-10-reconnect-02` 使用同冻结 manifest/完整副本/模型/阈值，source-before/source-after 完全一致，runner/driver exit 1。与前次不同，恢复后的 `notice_restored` 等待已返回，但紧接着 `history-initial-page` 严格窗口截图失败；实际截图时 AX 只剩菜单、无 AXWindow/AXWebArea，独立 startup 也确认目标 PID 尚存但无窗口。原生输入记录只证明该 target 的 activate/Escape，**尚不能将窗口消失归因于产品、系统权限或外部操作，也不把瞬时 predicate 成功签成可回查的完整恢复**。没有开启整屏截图兜底、放宽超时或继续发起新模型批次。cleanup 的 remaining=[]；失败窗口和外部证据完整保留。

同时暴露独立的验收分类缺口：当前 `verifyRunCall` 已用实际 ProviderRun operation 区分 `transcript_compaction`，却把它送入必须绑定当前作者消息的 `analyzeRequestCost`，因此第6–10轮第二次维护调用全部被判 `author_provenance_unverified`。它们是应用维护请求，不能伪造当前作者消息或仅凭 operation 标签直接通过；下一步应先在现有 owner 中规定实际 pcall/prun、来源坐标与原始引用材料的独立应用来源判据，再迁移分类。该缺口**未在本轮降低规则修补**。报告 turns_completed=5 是通过成本验收的轮数，不是执行轮数；实际只读 DB 事实见 `native-10-reconnect-02/independent-runtime-status.json`：10个业务run completed、10次planner+5次other实际调用、3条canonical checkpoint、0工具调用，数据库hash不变；全批仍FAIL。

**精确恢复入口**：先读取本节、两个 native-10 失败目录及 `event-owner-check-02`；先修/证明应用维护的来源判据，并审查现有 `NativeScenarioHarness.rawLaunchApp/rawCloseAppAndRelaunch` 的启动生命周期差异（前者已有 waitLaunchSettled，后者直接激活；这只是已证代码差异，不是窗口消失的既定根因），从零Provider的原生启动/重启观测定位窗口问题，不能再用十轮模型消费替代前置检查。确认后在新目录复验原十轮，然后才进入20轮。§14.7 的私有摘要与Checkpoint提交恢复窗口、取消/交错及完整语义/页面验收仍未关闭。本轮无commit、无push；原五份WIP哈希再次一致；NEXT仍B87，R03仍doing，不推进R04。

### 14.10 流式内容保真、同源接管与 Markdown 展示（2026-11-17）

作者明确批准开工。该 checkpoint 处理作者新发现的双份输出与裸 Markdown；不替代 R03 其它恢复、10/20 轮和实模语义验收。工作区基线为 `artifacts/model-contracts/b87-r03/20261117/markdown-output-01/before.json`，HEAD f7f8e461，233项既有改动及原五份 WIP 保留。

**独立目标/反例**：连续原始 chunk 拼接必须逐字等于收到的公开输出（纯空格/换行/缩进不丢）；同一调用的临时与最终内容只显示一份，维护仍 running 时也完成接管；其它来源同文不误删；取消没有最终交付时保留已收内容。中文强调/标题/列表/引用/表格/围栏正确渲染；恶意 HTML/URL/图片不得执行/请求；保存原文、作者输入及小说正文不改变。

**根因证据**：native-3-reconnect-01 同 prun 的 Provider chunks 为831/1146/816，纯空白15/19/23；WS恰少相应数量，换行24/36/25全部丢失。完整Provider增量等于最终回复、只删纯空白后等于WS。ProviderActivityProjector把delta兼作summary，AgentRunServer trim空summary后忽略整个事件。读取数据库前后SHA一致；删除空白的比较仅用于诊断，不作为产品去重。

**七问/新增审查（编码前）**：Contract=愿景、46 §9.5、ADR-0036、现有reply_record/事件与TurnResult；Invariant=原字节/来源/独立过程/作者安全；Boundary=application事件投影→前端投影/渲染，不动DB/Provider/采纳；Consumer=真实WorkspaceChat讨论和过程；Proof=先独立反例，再同源交付/跨run/安全/取消测试及门禁；Acceptance Driver=复用现役原生harness与工作台入口，先零Provider启动观测，再小批次真实输入，不加产品hook；Exploration=不涉及新要素物化。已查全仓无Markdown owner，批准唯一薄MarkdownText及其样式/测试；来源与显示归并复用agentRunTimeline、trace_summary.reply_record.provider_call_ref与agent_run身份，不新建消息ID、状态表或订阅。

**顺序**：先修责任层设计（ADR-0036/46/tech-stack），再空白红例与修复、来源接管红例与修复、共享渲染/安全反例、真实页面及全量门禁。Pencil ZOwOi/DM8gx 已只读核对；本次沿用文档流布局，不编辑 .pen。包版本已实际核对 streamdown 2.7.1 / @streamdown/cjk 1.0.4。状态以本节末尾实际验证记录为准；功能证据不代签 R03 完整闭环。

**外部观察责任修订（实施前）**：46 §9.5 的普通已交付回复不保留重复过程段，现役 shouldShowAgentRunDialogueStatus 原本也隐藏普通完成态，因此外部 axTurnOutcome 不能再依赖每条回复必有过程组。复用 authoring_g2_evidence 的作者边界/Why/路径辅助；只在当前最后一条作者边界内有真实助手回复及 Why、顶栏同容器的“无任务”、无任务控制/待答区时接受可见交付空闲。无窗口、无正文、旧轮Why、后轮完成、仍在维护或只有模型自称完成均拒绝；真实同run终态仍由原 wireTerminal 与DB双证另验。不改产品补状态钩子，不放宽等待或降低语义门禁；独立外部反例先红后绿。

**同调用不同通道的反例补审**：JudgmentProtocol 已明确 reply_record.response_kind=plain_text/structured_tool，AgentNarrativeSource 已区分 provider_output 与 provider_output_tool_narrative。接管仅适用于明确 plain_text 的已交付回复与该调用公开文字流；工具字段叙事与过程记录不能因 pcall 相同被整组删除，来源未知也不猜测。复用这些现役字段，不新增身份；独立反例覆盖同调用两个通道和缺来源种类。流式块位置锚定首个chunk，不随token到达漂移。HTML源码可安全转义显示；安全断言针对真实元素/属性/资源加载，不把字符串包含src=误判为执行。

**实现与局部验证**：已实施结构摘要/原始增量分责、plain_text 同源交付接管、退役文本比较/相邻同文折叠、独立过程与私有内容边界，以及共用 MarkdownText。现役 reply_record/AgentRun/agentEvents 复用，不新增消息身份或存储。`frontend-check-03` 的 typecheck/lint、54 文件 511 tests、Vite build 全通过；`backend-full-02` 的 mix check（3,346 tests/0 failures）、Credo strict、compile/xref/arch/ADR、I1/I2/I3/N-NARR/I-CACHE 全通过；外部观察器关联用例 267/0。red-backend/red-frontend/source-channel-red/native-observer-red/native-multiblock-red 与环境 PATH/夹具类型失败均保留；失败并未改记成通过。

**真实页面与字节证据**：首次 `native-3` 已真实交付首轮且页面正确渲染，但外部观察器错误假设回复为单个 AXGroup；实际 Markdown 标题/段落/列表是多个平级节点，故等待超时，原批 FAIL 保留。独立多块反例先红后绿，改为按当前助手显示名、作者边界、Why 与真实空闲共同观察，不增产品钩子、不改原输入/阈值/模型。新批 `native-3-02` 实际三轮/三次调用、32/32 检查、0 工具/0 业务写入、真实终态 PASS，源码前后哈希一致、cleanup remaining=[]。独立只读 DB/WS/交付对账 `independent-markdown-source-review.json`：三轮 Provider 与 wire chunk 数分别1277/1413/1015，含32/33/43个纯空白chunk，顺序与字节全等；换行43/44/38原样保留；全部源标题对应页面唯一一份，重复过程组0。turn-3.jpg 及首轮诊断截图已直接视觉复核，正常标题/加粗/列表/段距可见，无裸 Markdown 与双份回复。该报告不签全部 R03 语义；表格/代码块/危险URL/取消中间态在组件与机制层验证，未声称全部经过原生场景。原始 SSE 未采集。

**构建与完整扫描**：`final-gates-01` 的 `pnpm tauri build` exit0，生成当前 macOS arm64 release app/DMG（本地临时签名，未公证），源码前后不变。`bash scripts/ai_static_scan.sh --top 10` 仍19pass/2fail/0skip：task_done旧manifest/UI闭环pending；六条既有gitleaks中五条false_positive（Pencil元数据、确认fixture、示例nonce、B63历史标识、E2E标识），ProjectGod历史配置一条accepted_risk，非误报。未改扫描规则/历史/长期处置台账，不能声明全仓全绿。前端主包由之前约742KB增长到1296KB（gzip约386KB），构建保留原500KB告警，未实测性能收益或将警告抹去。

**提交与恢复入口**：仅独立且开工前无WIP的后端空白修复/测试已按正常Git hooks提交 `d7485088bd9892c058c2d9b59e9d6a977bd18deb`（2文件，fix: 保留作者可见流式输出的空白增量）；全局hook实际执行但提示仓库没有lefthook配置，未禁用hooks。前端展示与前轮R03事件owner/历史导航未提交改动交叠，当前未整包提交，避免夹带未验收的R03部分；未push。证据基目录均为 `artifacts/model-contracts/b87-r03/20261117/markdown-output-01/`。本checkpoint功能已落地并有真实三轮证据，完整任务仍doing：最终completion gate、全量R03取消/交错/恢复/10与20轮、前端分组提交仍待收口；不得以本次页面修复关闭原§14.7/§14.9缺口或推进R04。

**独立提交边界复核（2026-11-17 续行）**：已从 `d7485088` 构造只包含 Markdown/公开文字流同源接管的候选树，保留实际工作区原样，不把 R03 事件归属、历史导航、运行状态或 Schema 的未提交修改带入。既有 `reply_record.response_kind/provider_call_ref` 在提交基线中已存在；候选沿真实 WorkspaceChat 入口消费，不是孤立组件。隔离快照实际运行 typecheck、lint、54 文件497 tests及Vite build均通过（`closeout-continuation-01/markdown-isolated-check-01.*`）；497是独立提交快照的测试数，不把工作区511当作该快照结果。原生三轮证据仍严格属于上一段记录的集成工作区，不改写为本次候选树的独立原生验证。候选patch/树和隔离日志均在 `artifacts/model-contracts/b87-r03/20261117/closeout-continuation-01/`；本组不关闭R03，也不以提交代签恢复场景。

独立提交已完成：`cd6add561d5beee700638fcba107b3631f1058b6` 包含Markdown与接管的17个明确路径/选定hunk；`24e70a867b44219c605e86674ab68ab862865dcb` 只提交外部多段落观察器与反例，两文件候选快照110 tests通过。两次实际commit树均等于被核对的候选树，正常hooks未禁用、无push、正式index最终为空；隔离切分的首次失败日志保留，未污染真实工作区。

### 14.11 维护请求来源判据收口（2026-11-17，实施前）

责任设计先见现役验收矩阵§5.6。Contract=VS-00L独立文本操作、现役讨论source keys与canonical坐标；Invariant=来源/原字节/作者身份与成本守恒；Boundary=既有外部只读证据模块，不改产品/DB/模型输入；Consumer=verifyRunCall与已有Checkpoint请求审计；Proof=独立来源反例先红、既有成本回归、旧十轮五次维护逐调用只读复算；Acceptance Driver=复用旧批次采集事实，不声称新原生验收；Exploration=不适用。查重已发现authoring_checkpoint_coverage拥有原始讨论材料比对，继续该owner并抽共享纯职责；不新建checker/reader/表/消息或成本框架。新增的应用绑定只承载校验输出供既有成本函数消费，不伪装authorBinding。缺Checkpoint仍计真实调用；来源通过不代签摘要提交或语义完整。

**2026-11-17 实际提交与独立验证**：已核对独立仓库根目录、HEAD 和空暂存区；先前 `cd6add56`（Markdown 与同源接管）、`24e70a86`（外部多段落判据）已真实存在，不重复创建。本轮经选定路径/必要 hunk 构造候选树 `92a780e7105aa46eca4ccb4ca3faa1b242463600`，未带入产品、原生窗口、完整 R03 状态接线及预注册长会话的其它 WIP。候选快照的 8 个相关测试文件实际 220 tests / 0 failures；以该候选源码独立复算旧十轮的 5 次维护，5/5 来源/原文/调用归属/成本通过，当前作者数与作者字节均为零。原批次所有文件 SHA 前后相同，模型调用新增 0，旧 FAIL 不改签。

已通过正常 `git apply --cached`、`git commit` 提交 **`0e0dcfe2803b27e7356006c0a00295b987072f45`**（13 文件，`test: 独立核验讨论维护来源并计入请求成本`）；实际 commit tree 与已验候选一致，正常 hooks 未禁用、未 push、正式 index 为空。证据目录为 `artifacts/model-contracts/b87-r03/20261117/commit-resume-02/`：`isolated-tests-02.log`、`candidate-five-source-review.json`、`maintenance-commit.log`；首次 staging 候选错误与修正前失败保留，不冒充实际工作区回归。

提交后工作区回归 `current-gates-01` 的 55 个外部测试文件 **1,108/0**，源码前后 SHA 不变。完整扫描仍 19 pass / 2 fail；另新增 Semgrep 对负例中单次 replace 的不完整清洗命中。该调用实际是在构造非规范身份，不是清洗入口；本轮改为独立字面无效坐标，保持拒绝判据，不抑制规则、不修改受保护处置台账，复验结果追加在本节末尾。

**恢复缺口不缩小**：此前零 Provider 原生观测有冷启动及两次重启、各 12 个样本，窗口均存在，但未启动后端或恢复真实历史，不能解释原十轮窗口消失。验收矩阵已明确：只证明失败来源不重发、新来源成功，不等于已收到摘要能恢复提交；§14.7 的私有摘要→Checkpoint 故障窗口仍待实现与取证。完整 R03 保持 doing，不进入 R04。

**最终复验与提交**：负例字面化后相关 43 tests / 0 failures，随后 `current-gates-02` 的同一 55 文件回归再次 **1,108/0**，源码前后 SHA 无变化。完整 `bash scripts/ai_static_scan.sh --top 10` 为 **19 pass / 2 fail / 0 skip，7 条发现**；新增 Semgrep 已清，未关闭项为 task_done 旧清单/UI 完整验收 pending，以及六项历史 gitleaks（Pencil、确认 fixture、RFC 示例 nonce、B63 历史标识、E2E 标识五项既有 false_positive；ProjectGod 历史配置一项 accepted_risk，非误报）。不改规则、历史或原保护处置台账。负例修正独立提交 **`654f6497c4dd66a338c9eec25ab1d022ff433227`**（1 文件），正常 hooks 未禁用，无 push。

**下一恢复入口**：页面 Markdown/同源交付、外部多段落观察和维护来源核验已经分别落入上述真实提交，不再作为“交叠所以不能提交”的遗留项。仍需完成原生历史恢复窗口原因定位、已收到摘要到 Checkpoint 的持久原文恢复、取消/交错及原十轮后二十轮全矩阵；达到完整目标后由现役 task_done 入口生成对应真实完成证据，不用本次只读核验或三轮控制替代。其余产品/外部脚本 WIP 继续按依赖与独立快照验证分组，不全量 git add，不重写历史。

### 14.12 未提交积压审计与独立交付（2026-11-17）

作者要求核清大量未提交文件并继续执行。现场 `3d172743`、空暂存区，202 个 tracked 修改及 24 个 untracked 文件，共 226 路径；不是 Markdown 提交丢失，而是之前 R03 跨层实现、测试迁移和外部验收变更长期没有及时形成提交边界。仅按目录的事实分布：apps 116、scripts 78、frontend 16、docs 10、AGENTS/reports/tasks 6；五份原保护 WIP 保持不动。基线与逐文件 SHA 位于 `artifacts/model-contracts/b87-r03/20261117/backlog-closeout-01/before.json`，不以路径计数代替依赖审查。

本轮先收口既有日志证据链，不扩展 R03 范围。Contract=愿景可审计性、ADR-0034 请求证据与通用日志分责；Invariant=每次真实请求引用准确、未知与空值不同、跨调用/进程不串资料、HTTP body 和业务行为不改变；Boundary=Gateway → LogContext → LLMLog，不带执行准入/压缩/数据库/UI 的其它未提交修改；Consumer=真实 adapter 同步日志；Proof=独立提交快照的编译/测试、真实 Gateway→adapter→JSONL 逐调用对账、普通 metadata/snapshot 无资料及嵌套/异常/并行边界；Acceptance Driver=仅日志合同 checkpoint，不以局部测试签 R03 或新原生页面；Exploration=不物化作品要素、不增加模型调用。查重裁决为复用现有 LogContext/LLMLog/Gateway，无新实体；Gateway 只选择传入 ir.refs 的必要 hunk，旧三参接口全部现役消费者同批迁移。

提交前反方审查发现嵌套调用中的 turn 切换/显式 restore 会被旧 finally 恢复为父级资料，违反已有清空与隔离目标。已先修 ADR-0034 的嵌套失效规则，再用两个公开 API 反例复现（26 tests / 2 failures）；沿既有 binding 所有权修复，不新增标记/状态，相关 LogContext/LLMLog/Gateway 37 tests / 0 failures。第一次候选全量通过只证明旧快照，不能替代修正后候选复验。

第二独立交付消费同一 ADR 的真实 request.refs：既有 authoring_request_facts 只读取当前记录明确登记的引用，liveRefsCheck 继续按 pcall/prun、Scope 与实际 Observation 审核；缺失/坏形状返回未知，不用其它请求、Scope 标签、body.refs 或累计段头 refs 补证。无新实体/reader，4 个现有文件的真实消费者与独立正反例闭环；本组不带后续 checkpoint 选择解析与长会话脚本，不以引用元数据代签模型实际使用或 R03 语义。验收为候选快照 Node 套件和已有真实调用只读对账，不调用模型、不改原 FAIL。

提交纪律：候选树先独立验证，正常 git add/apply --cached/commit，提交树须等于验证快照，保留所有其它工作区字节及五份保护 WIP；不 push、不 reset、不为清空状态降低 R03 验收标准。仍缺原生恢复/摘要持久恢复/取消交错的主链继续明确标为未闭环。

**实际交付**：`05faaf3de397994480bc33f4714ffe63c7f32699`（8 路径，日志证据及嵌套失效修复）对应独立候选树 `30bcaedc4711d0e85faec1051a94391f33513f90`，该快照 mix check 3,248 tests / 0 failures，另 Credo strict、I1/I2/I3/N-NARR/I-CACHE 通过。`2c6a86b633ca444037baffad7b7110fd9aada7e8`（4 路径，外部材料引用核验）对应候选树 `990c84dd4750665a5fd81f6bbf09d53bff39ddd1`，9 个相关 Node 文件 273 tests / 0 failures。实际 commit tree 均与已验快照一致；正常 hooks 未禁用（全局 hook 报仓库缺 lefthook 配置），无 push。12 个路径中 Gateway 和 request facts 只提交目标 hunk，其它 R03 hunk 保留，因此净清出 10 个未提交路径，而不是 12。

**整合证据与边界**：`final-gates-01` 当前工作区 mix check **3,348/0**、外部 55 文件 **1,108/0**；完整 `bash scripts/ai_static_scan.sh --top 10` **19 pass / 2 fail / 7 findings**，源码前后哈希不变。未关闭项仍为 task_done 旧清单/UI 完整验收 pending、五项既有 gitleaks false_positive（Pencil、确认 fixture、RFC 示例 nonce、B63 历史标识、E2E 标识）及 ProjectGod 历史配置 accepted_risk；未改规则/台账，无新增扫描发现。`existing-call-ref-review.json` 以候选代码只读复核已有 native-3-02 的三条调用，request.refs 与原记录相同、删除元数据后仍为 unknown、HTTP body/原批次全部文件不变；只证明已有日志读取，不代表新原生运行或材料语义完整，新增模型调用为 0。

**剩余积压及恢复入口**：本节提交后剩余 216 路径（192 tracked 修改、24 untracked）：后端实现/测试 110、外部脚本 75、前端 16、设计/原 R03 任务 10、原保护 WIP 5。逐文件事实清单见本证据目录 backlog-inventory/final-state；上述分类不声称剩余每个文件已经独立审查，也不把它们一概认定不可提交。WorkspaceChat 的 Markdown hunk 已在历史提交，当前 M 是事件归属/历史恢复的其它 hunk，不是提交丢失。主线仍需闭合私有摘要到 Checkpoint 的故障恢复、原生历史重启、取消交错和原十轮后二十轮；可独立交付部分继续按依赖拆出验证，不再把完整 R03 未完成作为所有代码不提交的理由。

### 14.13 已接收摘要到 Checkpoint 的持久恢复（2026-11-17，实施前）

现场起点 `47a12bc1`、216 路径 WIP、暂存区为空；基线/哈希在 `artifacts/model-contracts/b87-r03/20261117/summary-recovery-01/before.json`，编译基线通过。目标是故障后仍以同一份已持久接收的摘要完成合法提交，不重新请求模型、不丢原文、不把取消或旧方向重新激活。只证明来源不重发、新来源能继续，不满足此目标。

七问：Contract=VS-00L §16.2.1 已接收摘要恢复修订；Invariant=来源唯一执行、冻结计划/响应原字节、原文与当前保护集、提交/事件/恢复载荷同事务；Boundary=Summary/AgentRunMaintenance → ProviderRunLog 与 AgentRunLog 原事务；Consumer=现役显式/自动维护安全点；Proof=先写持久原文缺失与失败后零调用恢复反例，再覆盖重复/篡改/取消/目标变更/外 run/事务回滚；Acceptance Driver=既有真实工作台与取消/重启驱动，不增加产品测试钩子，机制证据不代签原生；Exploration=不产生作品事实，既有原文读口不变。

存在性审查：ProviderRun 是已有唯一执行所有者，复用并补一列私有 operation_checkpoint；ProviderOutput 的安全摘要不能承载可恢复正文；LongRunTask 仅 durable、不能借给 bounded；canonical 历史只存已提交事实，不能塞入未生效计划；LLMLog 不具事务恢复保证。拒绝新表、新任务状态机、日志回读和全局重试。私有列、增量迁移及专属恢复测试文件为当前真实消费者所需新增，索引同批维护；纯恢复规则归既有 Summary/ProviderFactMerge，存储与消费归原事务。无来源内容副本，提交时把暂存原文转交 canonical 并原子清除；不覆盖作者数据库或五份保护 WIP。

**续行候选依赖与职责审查**：独立候选原先漏带 13 个 Finalizer 真实调用方与已退役摘要 helper 的移除；补齐后，40 个回归失败均定位到真实 AgentRun 夹具、交付时运行事实或 canonical 身份/历史覆盖夹具未同批迁移。选取必要 hunk，不带人物探索/最小供给的其它修改，9 处现有测试迁移后候选全量断言通过。规模门禁随后暴露 AgentRunLog 571 行超过 563 上限；先在 ADR-0035 明确纯 checkpoint header 规则归既有 AuthoringSessionIntegrity，事务/回滚仍归 AgentRunLog，保留原错误与判定顺序，不新增实体、不提高基线、不机械压行。证据保留在 `artifacts/model-contracts/b87-r03/20261117/summary-recovery-resume-02/`；候选通过不代签 R03 原生恢复。

**接收方的独立反例与修复**：提交前进一步发现旧接收快照能覆盖已经持久取消/暂停或改变目标的接收 run。先在 VS-00L 明确双运行持久事实边界，再以公开 CompactionRecord 提交反例实证失败；既有 ProviderRunLog 在写锁内、upsert 前读取接收行，ProviderFactMerge 分别校验原计划/原响应字节与双运行资格，不新增锁、状态或重试器。缺行、身份/目标版本不符、持久取消/暂停均拒绝；失败保留响应且不产生 checkpoint/作者事件。相关 37 项回归通过，原 durable header/事务边界 42 项回归通过，严格 Credo 与规模门禁通过。

**独立代码提交**：`e33bb71669916660bffb99ea98aa4c9c7e1f5b84`（82 个必要路径）提交 canonical 覆盖、来源执行权、私有响应恢复、运行事实消费者及配套测试/契约；不夹带人物探索、最小供给、客户端事件归属和其它未验收原生驱动。`b8917b6f199fd7b4826879e9ea6a3cd14359ba05`（2 文件）单独迁移外部恢复 oracle：提交 run 可不同，原 Provider 执行身份不可改绑。两组均正常 hooks、暂存密钥检查通过，不 push、不改历史。原五份保护 WIP 哈希全部保持。核心提交树 `efbbf255968a8338c2dff976b6de10178619c4f3` 相对完整验证树 `4905482fd4cc6f7962067336557612f91d86dcf8` 仅补 common README 测试索引，运行代码字节一致；外部提交树与独立验证快照完全一致。

**验证与范围**：核心候选全量后端 **3,331/0**，前端 **54 文件 497/0**、typecheck/lint/build，以及 compile、架构、xref、ADR、Credo、规模、I1/I2/I3/N-NARR/I-CACHE 均通过；外部候选相关 **222/0**。随后整合工作区后端 **3,360/0**、55 个外部测试文件 **1,109/0**，源码前后 SHA 无变化。`integrated-final-01` 完整扫描为 **19 pass / 2 fail，7 条发现**：旧 task_done/UI 全验收 pending，六项历史 gitleaks（五误报、一 ProjectGod 历史配置 accepted_risk），没有新发现。两个暂存补丁另经 gitleaks protect --staged，无泄漏。构建的已有大 chunk 告警保留。原失败/编译/夹具/规模反例日志均保留，不改签。

**下一恢复入口**：后端恢复机制已有真实事务及运行时集成证据，本轮新增真实模型调用为 0、未执行新原生页面批次，R03 仍 doing。现役验收矩阵 §5.2/§5.3 已把 C8 的“新来源继续”纠正为原 D 响应跨进程恢复；原生驱动/完整 oracle 必须按此补证，不能因原脚本测试绿灯继续沿用旧目标。先用零 Provider 的真实历史重启实验定位窗口消失，再迁移故障阶段取证，复验原十轮、二十轮及取消/交错，最终由真实 task_done 入口闭环。两组代码提交后剩余 145 路径 WIP（131 tracked、14 untracked）；最终状态与保护哈希见本目录 final-state.json，不把其它 WIP 全部判为可提交或不可提交。

### 14.14 原生历史恢复与外部输入副作用审查（2026-11-18）

起点 `a5ee68fc`、144 路径 WIP；本轮基线在 `artifacts/model-contracts/b87-r03/20261118/native-recovery-01/before.json`。旧十轮失败记录证明历史 resume 已返回、同一窗口消失前外部 `pollAx` 经 `recoverInteractionSurface` 自动发出 Escape；这是待证因果，不直接归为产品或权限问题。先用原失败批次的只读数据库副本与同一原生二进制，复用现役测试服务器、NativeScenarioHarness、精确应用路径与清理 owner，诊断冷启动/真实历史恢复/客户端重启和显式 Escape 的差异。原库、原报告与作者数据不得改写；不发送作者创作输入，不调用模型，不以诊断冒充全十轮或 R03 PASS。

Contract=VS-00L 恢复事实与外部原生验收边界；Invariant=读取/等待不改变作者窗口或历史、原始事实完整、同源应用身份、零新增 Provider 调用；Boundary=现役外部驱动与测试启动，不预设需改产品；Consumer=十轮/二十轮历史回查驱动；Proof=旧时序、预先定义的有输入/无输入原生对照、独立脚本反例、数据库/调用计数与源文件哈希；Acceptance Driver=现有 NativeScenarioHarness/真实 Tauri 窗口与隔离后端，诊断仅指定恢复环节，不增加第二套框架；Exploration=不物化要素、不供应模型材料。复用审查聚焦 scenario_driver 的观察/交互分责，不通过重试、扩大超时或整屏截图掩盖窗口消失。

**实际诊断结果**：`history-causal-01` 使用旧十轮数据库副本、原失败二进制和现役隔离后端，稳定历史窗口的 12 次观察、显式 Escape 后 12 次观察、被动重启后 18 次观察均有窗口/网页；`history-causal-02` 预先固定三次原驱动重启均成功，未命中旧缺窗口分支。两个实验均未复现原窗口消失，故因果仍未建立，不能宣称 Escape 就是根因或产品已经修复。原数据库/失败记录未改写，所有 owned 应用与后端/代理已按精确归属清理。

**独立已证缺陷与提交**：正常 `pollAx`/`tryPollAx` 在 AX 暂缺时调用通用恢复方法，实际发送 activate/Escape，且嵌套 12 次重试改变观察现场。先修 `docs/engineering/scenario-acceptance.md` §5.1 的观察/动作职责，再以四个公开观察反例得到 4/4 失败，随后移除 `recoverInteractionSurface` 与 `dumpNodesForInteraction`，所有现役读消费者使用既有 `dumpNodes`；真实作答动作需要前台时只显式激活，不猜测关闭窗口/对话框。无新模块/状态/重试，原等待预算不放宽；相关 25/25 通过。七文件独立候选树 `aa962ea9761b774515c4497f04f6b7e83f4241c4` 的外部套件 1,035/0，实际提交 **`8c9a0ab8e59393a741cc4e7bef1ad5ffad0c8dd6`** 与该树完全一致。自动维护 driver 与 README 只提交本组必要消费者迁移，未夹带其既有大范围 WIP。首次隔离验证两个 Git 指纹测试失败来自归档快照未具备自身 Git 索引，补齐该快照的真实基线/索引后原测试不改且全过；失败日志保留。

**原生回查与视觉边界**：修复后 `history-readback-03` 调用现役 `runCompactionHistorySequence`，展开计数、原文逐字定位、返回当前会话、再次重启、原事件集和原文不变六项机械检查通过。前后三次诊断的 ProviderRun/Output/Event 为 619/610/150420，AgentRun/消息/Interaction 为 134/57/318，均未增减，新增模型调用与作者创作输入均为 0。直接查看截图确认原文和高亮在视口内，但 `history-restored-expanded.jpg` 没有完整呈现整理面板；因此报告仍是机械通过/视觉未闭环，不签完整 UI。为控制变量，三个诊断用的是旧失败二进制，截图中未渲染 Markdown 不是本轮当前代码回退，也不充当当前产品构建证据。

**整合验证与未关闭项**：`integrated-gates-01` 55 文件 1,111/0，验证前后源码 SHA 不变；完整 `bash scripts/ai_static_scan.sh --top 10` 仍 19 pass / 2 fail / 7 findings。剩余为完成清单/UI 证据 pending，及五项既有 gitleaks 误报（Pencil、确认 fixture、RFC nonce、B63、E2E）与一项 ProjectGod 历史配置 accepted_risk；未改规则或受保护台账。候选/原生对照/截图评审与扫描见本节目录 `observation-review.json`、各 diagnostic-result、`observation-isolated-02.log`、`integrated-gates-01/`。原五份保护 WIP 哈希全部未变，未 push。

**下一执行入口**：原窗口消失尚无因果结论；原生回查还需在当前产品构建中验证整理面板真实可见，不能只用 AX 存在代替截图。C8 的外部故障驱动/完整 oracle 仍需按 §14.13 原 D 响应跨 BEAM 恢复迁移，不得用新来源 E 成功代签；本轮未启动新的十轮/二十轮模型执行，也未进行后端进程摘要恢复验收。完整 R03 保持 doing，不进入 R04。

### 14.15 原响应恢复证据与当前构建可见性（2026-11-18，实施与实际验收边界）

起点 `111e3af8`、144 路径 WIP、空暂存；基线和逐文件 SHA 在 `artifacts/model-contracts/b87-r03/20261118/recovery-closeout-02/before.json`。本步消费 VS-00L §16.2.1 和验收矩阵 §5.2/§5.3，目标是外部 C8 必须证明原 D 摘要持久保留、跨进程保留及同字节转交，不接受新 E 成功；历史整理面板必须实际位于视口且截图可见，不以 AX 存在代签。

Contract=上述现役契约；Invariant=原响应/冻结计划/身份/作者原文完整、恢复零额外 D 调用、只读等待不改现场；Boundary=既有外部 evidence/driver/fixture 与当前产品构建，产品无验收钩子；Consumer=现役自动维护和历史回查验收；Proof=独立原始事实正反例、隔离提交快照、真实窗口/HTTP/数据库证据分别核验；Acceptance Driver=既有 NativeScenarioHarness、历史序列及原 owned runner，不新造框架；Exploration=不物化作品要素，不更改冻结作者输入或模型预算。复用审查：恢复 oracle、快照 reader、重启 receipt、覆盖校验及滚动输入边界已有当前消费者，只修其职责内缺口。原五保护文件及其它 WIP 保持；未执行的长会话/跨 BEAM 原生场景继续列为未闭环，不以脚本单测代签。

**中断后的现场对账**：上一轮虽无正常最终回复，仓库已存在 `45a296e7fa847670d691f911fc6581b9d3c45860`（17 文件：统一整理事件视图、按历史 DOM 提交定位原文）及 `e244ea12e02239dc1d583283a14944e87e69e023`（34 文件：原 D 摘要的 C8 证据/驱动与必要消费者）。接续现场为 e244ea12、101 路径 WIP，不重复创建上述提交。UI 独立候选 54 文件 511/0，C8 独立候选 1,157/0；这些是已有日志与候选树核验，不等于新跑跨 BEAM 原生恢复。C8 已拒绝丢失原载荷后用新 E 成功代签，必须按原 pcall/prun、冻结计划/响应和事务转交取证。

**当前构建的历史可见性实证**：重新构建当前 Tauri debug app，`continue-closeout-03/current-native-02` 在原失败十轮数据库的隔离副本上运行现役历史回查序列，6 项机械检查通过。直接复核 `history-restored-expanded.jpg`：完整整理面板、真实类别计数、原文保留文案和链接进入视口；`history-original-located.jpg`：原作者消息与模型回复定位高亮，标题/强调已渲染。两次客户端重启后事件集与原文不变。新增作者创作输入/模型调用均为 0；逐表核对源列 ProviderRun/Output/Event 619/610/150420、AgentRun/消息/Interaction 134/57/318，完全一致，原库 SHA 未变。此批只证明客户端历史恢复，不是 BEAM 摘要故障恢复或跨分页验收。

**取证错误保留**：该诊断 wrapper 在原生成功后的 SQLite 只读后验阶段失败；没有改写原退出记录或重跑 UI 凑成功。确认所有 owned 进程结束且无非空 WAL 后，以 immutable 只读重新核原库/副本的完整原列与哈希，独立结论落 `current-native-02/independent-review.json`。首次前置副本读取失败发生在 UI/服务启动前，保留为准备错误，不冒充产品失败。外部候选并行测试曾因原生端口仍占用而使 D8 清场断言失败；清场后原断言不改，1,210/0/skip0。全部原日志保留。

**历史证据链提交**：`0d5ba3d1033d0a597f852055b451215274bc465a`（20 文件）提交历史回查、真实 HTTP/页面证据和必要索引/fixture；提交树 `e2d63790853e998933b66a9f78f6c35f177126cb` 与独立 1,210 项验证树一致。它不夹带 README、G2 材料/候选边界及其它未审 WIP。三组既有/新增提交均未 push，正常 hooks 与暂存密钥扫描，无历史重写。

**首批十轮的真实失败与源头修复**：按原 manifest、原十条输入、原窗口预算和零 harness retry 执行 `native-10-current-01`，第六轮等待超时。实际 6 个业务 run completed、6 次判断及 1 次摘要 completed、1 条 checkpoint。页面原始 AX 已有本轮正文/Why/顶栏无任务，但仅含整理细条的“本轮创作过程”组让 `axTurnOutcome` 跳过普通交付判定。先在验收矩阵 §5.4 固化记录/运行态分责，再独立正反例先红后绿；沿既有 AX owner 分类已知记录容器，不放宽缺正文/Why/空闲/窗口、活动控制坞、未知组及跨作者边界。`a447f03aa539b8b60760c9dee3404c150f9f8f24`（3 文件，tree `4157668251cb63dc5b040ddb994f0e60e36e6dc7`）与独立 1,211/0 快照一致，相关 111/0；保存的真实 AX 修后判 completed，移除 idle 仍 unknown。原批次 FAIL 不改签，不补发第七条，不把离线重算称十轮通过。该组只改外部观察，不给产品加状态或验收钩子。

**第二批十轮与更精确的窗口事实**：修复后另起 `native-10-current-02`，仍用相同 manifest/snapshot/输入/预算，第三轮再次超时；实际 3 个业务 run 和 3 次判断均 completed，尚无整理调用。只读取证记录 `live-readonly-window.json` 与 `native-window-os-facts.json`：原 app PID 仍在、非 hidden、AX 读取成功但窗口数为 0；WindowServer 的全部窗口集合仍登记该 PID 的 1280×801 窗口，但屏幕可见集合中没有目标窗口，目标截图不可得，前台是另一个应用。本轮未盲发 Escape/激活/重启改变故障现场；不能据此推断窗口已被销毁，也未确定桌面切换、最小化、窗口排序或其它因素的因果。旧“Escape 导致消失”仍不是已证根因。原等待上限未延长，未启动第三次实模重跑；两批都保持 FAIL，不能以后台 completed 替代真实页面。

**验证和下一断点**：`continue-closeout-03/full-scan-01` 与 `terminal-scan` 均实际执行完整 `bash scripts/ai_static_scan.sh --top 10`：19 pass/2 fail/7 findings，源码前后 SHA 不变。剩余为旧完成清单/UI 全验收 pending，以及五项历史 gitleaks 误报（Pencil、确认 fixture、RFC nonce、B63、E2E）和一项 ProjectGod 历史配置 accepted_risk；规则与处置台账未变。本轮证据总目录 `artifacts/model-contracts/b87-r03/20261118/continue-closeout-03/`，两次实模共实际发生 9 次判断、1 次摘要，不是十轮验收通过。先取得原生窗口从可见到不可见的生命周期/桌面归属证据，禁止靠读操作抢前台或增加模型重试；之后仍需原十轮、二十轮、取消/交错及 C8 真正跨 BEAM 恢复，风险表第十轮履行的语义尚未到达。R03 保持 doing，R04 未开始。最终 Git 清单、五保护文件哈希及提交后扫描见本目录 final-state 与 post-commit-scan；本节提交前剩余 83 路径，未把其它 WIP 全部判为可提交或不可提交。

### 14.16 全屏桌面转换的因果证据与可见性中断（2026-11-18，实施与断电后恢复核验）

起点 `ed79b228`、82 路径 WIP、空暂存；基线在 `artifacts/model-contracts/b87-r03/20261118/window-lifecycle-04/before.json`。第二批真实失败的系统日志已将原 PID 46443 / 窗口 12747 与桌面转换关联：本机 UTC+8 02:47:25.271 另一应用进入全屏 Space，25.786 该 Space 成为当前桌面，同一目标窗口在 25.684/25.810 从 visible→occluded→hidden。最后一次驱动输入是 02:47:04.578；此前未证实的产品销毁窗口或 Escape 根因不成立为该批解释。原批次继续 FAIL，不推定是谁发起全屏操作，不用这条身份链给另一旧批次代签。

七问：Contract=既有场景验收 §5.1 的观察/输入分责及目标身份；Invariant=真实页面不可得不冒充模型超时、未知不当 false、零隐式输入、保留原始失败；Boundary=已有 Swift startup 只读 producer→NativeScenarioHarness 两个 AX 等待入口，不修改产品/Provider/数据库；Consumer=既有十轮/历史/交错原生驱动；Proof=系统日志原链、Swift producer 与公开等待入口独立正反例、零模型原生可见性实验和正常场景回归；Acceptance Driver=现役 NativeScenarioHarness 与精确路径 owned cleanup，不另建 runner；Exploration=不物化要素，不供应模型知识。存在性审查：startup、窗口读取、当前 target、等待与错误证据 owner 均已存在，只在原职责内补充 WindowServer 白名单事实和本代是否实际见窗的观测记录；不增加产品状态、永久监控、自动激活或第二恢复机制。首次启动/换代/AX失败及可选字段缺失保留未知；仅同代已见窗且事实充分时提前停止。通过后按可审查边界提交，保护既有 WIP。

**已提交实现**：`14c1f12ac764b0ef8ac27cbd3bc395e0e227b0a2`（6 文件，163 行新增/16 行删除）已将既有 Swift startup 的 AX 错误与目标 WindowServer 白名单事实接入既有等待 owner；已见过的同代工作台窗口明确不在屏幕上时，报 `owned_native_surface_not_onscreen`，不自动激活、切桌面、Escape 或重发模型。完整窗口集合与屏幕窗口集合按目标 PID/窗口编号对账；首次启动、代次变化、读取失败或事实不全不冒充已确认不可见。提交树 `08ff946f9f59702bcea1fc003e7f98ba03e3d637` 与 `window-lifecycle-04/surface-candidate.json` 一致；独立候选原始日志为 1,214 项通过、0 失败/跳过，这是断连前已有验证，不是恢复后重新执行该全量套件。

**原生反例与证明范围**：`window-lifecycle-04/native-surface-03` 从隔离 Tauri 副本的真实最小化按钮进入不可见状态，既有等待入口报告上述明确原因；该次观察耗时 61ms，后续隐式恢复输入为零。实验确认最小化后 AX 树仍可读，不能以 AX 存在代替屏幕可见。该实验未启动后端、未调用模型；它验证外部观察职责，不代签十轮/二十轮、模型语义或 C8 后端恢复。前两次诊断的缺菜单和最小化漏判记录保留。

**断电后现场恢复（用户告知供电已恢复）**：恢复到原 Session 后，真实 HEAD 仍为 `14c1f12`，工作区 83 路径、暂存为空、无冲突。前次聊天中退回 `ed79b228` 的报告是过时信息，不能作为执行基线。`git fsck --connectivity-only --no-dangling` 退出 0；在新证据目录的批次数据库副本执行 `PRAGMA integrity_check` 返回 `ok`，原数据库文件及所读原始失败/驱动/AX/输入证据哈希前后相同。五份保护 WIP 相对 `window-lifecycle-04/before.json` 均未改变。本轮只建立机器证据目录 `artifacts/model-contracts/b87-r03/20261118/power-recovery-05/`，没有重置仓库、清除作者数据或新建平行状态文档。

**断连原 Job 已有终态，不重派发**：`wc_job_vbGBjnTHwDxSj22k` 已失败退出（exit 1）；原批次 `window-lifecycle-04/native-10-current-03` 的 `failure.json` 为第五轮 `turn_timeout`，清理记录 `remaining=[]`，恢复时对应 owned 进程不存在、4657/4661 均释放。原生 driver 只确认前四轮完成并留下四轮截图；数据库有五个业务 run 和五次判断 Provider completed，但第五轮页面终态没有被确认，没有摘要调用或 Checkpoint。`native-ui-complete.json` 仅有局部截图清单，不能覆盖 driver 的 `completed=false/partial=true`；原批次缺完整成本报告/summary，仍为 FAIL，不能解释成十轮已通过。

**原因与证据边界**：用户确认发生过断电，但上述退出记录只证明本批第五轮等待失败；不能仅据断电通知把该失败归为产品缺陷、模型超时或受控恢复成功。第五轮 AX 观察存在长时间采集空档，最终只读快照不能确认本轮作者/回复归属；后端在失败附近落下 completed 也不补足作者可见交付。该批不得与先前已证的全屏桌面转换混为同一个原因，亦不得当成 C8 原摘要跨 BEAM 恢复实验。原记录保留，不改签、不从第六轮接发来拼接十轮成功。

**恢复后验证及下一入口**：本轮通过现役 `scripts/node_test.sh` 复跑 Swift producer 与 NativeScenarioHarness 两个相关测试文件，29 项通过、0 失败/跳过，日志见 `power-recovery-05/focused-tests.log`；这只是断电后的局部复核。提交记录、当前完整扫描和最终 Git/保护文件核对统一落该目录，原始批次证据仍留原目录。本轮新增模型调用/创作输入为 0；先独立对账第五轮原请求/响应终结与原页面观察的时间线，再按冻结场景决定后续批次，不修改原输入、阈值或等待预算。完整十轮、二十轮、取消/交错及 C8 真实后端换代仍未闭环，R03 保持 doing，R04 不启动。

### 14.17 响应流终结的独立完整性反例（2026-11-18，实施与验收边界）

起点 `828526cd`、82 路径 WIP；基线 `artifacts/model-contracts/b87-r03/20261118/stream-closeout-06/before.json`。第五轮原记录只包含 decoder 派生结果，未保留原始 SSE 终结帧；不能据此断言该历史调用缺 `[DONE]`，也不重写其 FAIL。代码审查独立发现 Chat decoder 无终结状态、framing 丢弃 `[DONE]`、Anthropic decoder 不核 `message_stop`，而 Responses 已拒绝无终结流；须以公开 adapter 的独立截断反例先验证，不从旧 completed 反推正确性。

七问：Contract=VS-00L §19.3 / VS-00M §6.4 的流式事实完整性；Invariant=半截预览不成为成功结果/可执行工具或摘要来源，取消/错误优先且不重发；Boundary=既有 SSEStream framing、各 wire decoder 与现役 Result/Execution，保持产品 UI/DB/任务模型不增实体；Consumer=Splash/OpenAI-compatible/Anthropic 的真实 execute 入口及 R03 摘要来源；Proof=HTTP200但缺终结、伪终结、未封闭帧、工具参数完整但流未终结、合法分片终结、错误/取消反例及原生场景分层取证；Acceptance Driver=复用现役外部 NativeScenarioHarness 和 runner，不新增产品 hook；Exploration=不物化作品知识。复用审查：终结归 decoder、SSE帧归 framing、错误物化归 Result，均已有消费者；只扩展现役 decoder 对协议结束信号的输入，不新增并行流处理器。缺用量的现役表示与全部长会话/真实供应商证据不得由本步代签。

**低电量休眠的新增因果证据**：本机 powerd 原日志在 UTC+8 03:42:55.021 明确进入 Low Power Sleep，03:50:01.562 从 Hibernate 唤醒，覆盖原第五轮 428.484 秒 AX 采集空档；恢复后墙钟等待预算超限。这将 §14.16 的未定原因收窄到系统低电量休眠/唤醒，不是新一次受控 BEAM 恢复。`fifth-power-events.json` 与 `power-causal-review.json` 保存原日志哈希和证据边界；原始 SSE 仍未留存，因此不据此宣称旧调用一定缺终结帧，不改写旧 FAIL。

**实现与提交**：`2fbd456bdb20c34ee1d44cfbf9793661d00fe276`（11 文件，316 行新增/29 行删除）提交既有 SSEStream、Chat/Anthropic decoder、必要正例夹具迁移和独立反例。HTTP200、完整工具 JSON、usage、finish_reason 或正文中的终结字样都不能替代原 wire 的终结事实。EOF 丢弃未封闭尾部，不补造 SSE 空行；已合法终结后的未封闭心跳/尾部也不被误判为失败。保留片尾 CR，使 CRLF 跨分片不产生假空行。没有新建模块、恢复框架或兼容分支，没有改写正文或添加模型重试。缺失/错误终结沿既有错误结果路径结束，预览和调用身份不被抹除；普通业务层已有的后续调用不由本步冒充零调用。

**独立验证**：先用公开 adapter 得到 5 项目标测试中的 4 个失败，另以所有切分位置复现 CRLF 假空行，最后补齐正常终结后未封闭心跳的正反例。真实 loopback HTTP 对照使用生产 Req 通道：同为 HTTP200，有/无合法终结分别成功/失败，不只测 eventsource 替身。11 个旧正例夹具漏结束帧或错用其它 wire 标记，按协议修正输入，保留原业务断言。最终 Provider 目录 406/0；独立提交快照 `f4ec09f972f1b72b95621fa95986c1e421f46027` 的 `mix check` 3,339/0，强制零警告、codegen、循环/架构、ADR、I-CACHE、I1/I2/I3/N-NARR 与 Credo 通过，实际提交树完全一致。包含原 WIP 的整合工作区 `mix check` 3,368/0，分别记账；早期失败与选错测试行的诊断记录保留，不冒充有效红例。

**最终版本原生三轮控制**：`native-3-stream-final` 使用原冻结 manifest/snapshot/三条输入和原预算，真实 Splash/Tauri 32/32 检查通过，3 个业务运行、3 次调用完成，最大输入 14,056 小于 22,400 阈值，未误触发整理。实际截图 `turn-3.jpg` 已复核，Markdown 标题/列表正常，未完成风险表仍显示为欠项。该批代码 SHA 与最终候选一致；HTTP/数据库对账保持作者原文和作品内容。它只证明三轮低压正常路径，不代签完整 R03。

**原生十轮达到的新断点，仍 FAIL**：`native-10-stream-01` 在 EOF 尾部丢弃行为最终完善前的候选上实际完成十条冻结作者输入和十个业务回复，10 次判断成功、1 次判断 provider_internal 失败后由原流程后续调用完成、1 次摘要响应成功，共 12 次模型调用。第八轮原回答仍明确保留风险表与揭密程度两项独立义务；第十轮按码头/修钟铺/旧灯塔/档案馆分别给出单/双视角收益、误导风险和可观察证据，未代答结尾，但其形式为地点分节比较，未证明完整章节场景清单。原文与截图见 `native-ten-independent-review.json`，不从运行 completed 推断文学或整理效果。

**本批未关闭的真实失败**：合法 Checkpoint 为 0，历史回查等待整理入口失败，不是再一次窗口丢失。独立按冻结来源逐字对账，摘要 4 段 retained_obligations 中 2 段不是其原文的精确子串（`summary-source-review.json`）；私有原响应仍持久保留。不能模糊匹配、转义修补或删掉义务来让摘要通过，也不能把未整理长会话的语义保持代签整理后的保持。第三轮 provider_internal 的具体原因尚未充分取证；该轮多次实际调用还使原 native binding 报 unsupported/missing/counts mismatch，全部调用不能算已完整对账。原批次报告保持 fail，未补造 summary/完成清单，未自动重跑十轮或提前开二十轮。

**扫描、保护与下一入口**：整合验证后执行完整 `bash scripts/ai_static_scan.sh --top 10`，仍 19 pass/2 fail/7 findings，源文件 SHA 未变；剩余为完整 UI/task_done pending，五项历史 gitleaks 误报（Pencil、确认 fixture、RFC nonce、B63、E2E）及一项 ProjectGod 历史配置 accepted_risk，无新发现，不改扫描规则/处置台账。原 82 路径 WIP 与五份保护文件保持，不 push；最终提交后扫描及 Git 状态在本目录 `post-commit-scan/`、`final-state.json`。本轮新实模调用合计 15（十轮 12 + 三轮 3）。下一步从无效保留义务引用的来源表达与待提交响应恢复职责入手，审查为何一个不能提交的摘要持续占据恢复入口，并补齐同轮多调用证据绑定；不再围绕已确认的休眠反复跑模型。二十轮、取消/交错和 C8 真正跨 BEAM 恢复仍未闭环，R03 doing，R04 不启动。

### 14.18 无效摘要不垄断恢复入口（2026-11-18，实施 checkpoint）

接手原《机制保证唯一性》会话并逐条核对作者原始要求；判断仍按愿景→元原则→设计→任务→代码。基线 `f2dcace4`、82 路径 WIP，原任务与真实原生失败不改签。首先在 VS-00L §16.2.1 修订持久候选与可提交摘要的责任边界，再实施；不能以错误摘要通过不了为由放松引文校验或释放来源资格。

七问：Contract=VS-00L §16.2.1 的来源、字节及持久恢复；Invariant=原文与未完成义务保留、每源唯一执行、未知事实失败关闭、坏模型输出不得占据整个会话恢复入口；Boundary=现役 Application 选择与 common 校验、Persistence 事实读取，不新增 DB/状态/调度或修改 UI；Consumer=AgentRunMaintenance 真实安全点；Proof=独立构造首坏后好、仅坏、坏内容叠加 hash 损坏反例，保留取消/并发/事务失败回归及全门禁；Acceptance Driver=现役外部 NativeScenarioHarness，本文只是后端机制 checkpoint，原生十/二十轮及恢复仍待完整证据；Exploration=不物化作品知识，原文按需探索入口保持不变。复用审查：pending_operations 是事实候选而非成功判据，Summary 负责候选合法性，已有 source claims 是执行唯一性所有者，三者都有现役消费者，不增加第二恢复模型。

独立红例已先运行：recovery 文件 12 项中 2 项按预期失败，分别证明坏引文阻断候选以及内容错误遮住 hash 冲突；原记录位于 `artifacts/model-contracts/b87-r03/20261118/invalid-summary-recovery-07/red.log`。来源表达仍需单独审查，不能贸然升级唯一 decoder 协议导致真实历史 checkpoint 不可读；本 checkpoint 不改协议、不修补旧响应、不启动实模批次。

**实现与独立验证**：现役 Summary 按原归属判据惰性筛选候选，再逐项核恢复事实；只有已核 ProviderOutput hash 的确定性非法输出被排除。零新增持久状态/实体/重试/兼容分支。独立复审后补强仅坏候选两次经过真实维护入口仍零新增调用/Checkpoint、坏候选后遇第二份 hash 损坏仍报错、随后合法原响应实际提交的断言。最终目标文件 12/0；最终完整 `mix check` 3,370/0，强制零警告、codegen、xref、架构、ADR 和 I-CACHE 通过。I1/I2/I3 全通过；Credo 首次发现本次嵌套层数，改为惰性资格筛选后复跑无问题。最终全量测试日志 `verified-mix-check.log`，早期红例和工具环境错误记录保留。

**扫描与未闭环**：`bash scripts/ai_static_scan.sh --top 10` 完整执行，仍 19 pass/2 fail/7 findings；最终实现的编译、xref、架构、Credo、I1/I2/I3/N-NARR/I-CACHE、前端各门禁均通过。剩余五项历史 gitleaks false_positive、一项 ProjectGod accepted_risk、一项真实 UI/task_done pending，延续既有处置，无本次新增发现，不改扫描规则/处置台账。扫描原始报告位于 `artifacts/static-scan/`，执行日志在本证据目录。不能把本 checkpoint 标为完整 R03 PASS。原 82 路径逐文件 SHA 全相同（`wip-preservation.json`），本次只改 4 个此前干净文件，不 push；新模型调用/作者输入均为 0。

**下一入口**：源引用表达应从机械复制义务转向可信冻结来源定位，但须先核真实合法历史 checkpoint 与原文保护，不凭‘未发布’重写响应或使旧历史不可读。此设计未在本轮实施；同轮多调用绑定、provider_internal 原因、原生十/二十轮、取消/交错及真正跨 BEAM 恢复仍待后续证据。R03 doing，R04 不启动。

### 14.19 非成功调用绑定与本地流消费阻塞（2026-11-18，实施 checkpoint）

`c1cdc1a9` 后继续核查 §14.17 的第二断点。原第三轮 `pcall_mwl4zcbv_1pd/prun_mwl4zcbv_1pe` 的日志为 status=0、body=event_stream、usage={}、duration_ms=22784；现役真实 Chat join 只认 2xx+sse_decoder 或 fixture error，故该调用 unsupported 后整轮两次调用均未计，形成 10/12。这不是现役不支持多个成功调用，也不能直接放行占位。原 backend.log:44320 明确包含 SSEStream.handle_wire_chunk 的 Agent.update 5000ms timeout；这证明本地 accumulator 调用超时，不证明原始 SSE 缺终结或网络超时，慢回调的进一步原因仍需独立审查。

七问：Contract=VS-00M §6.4、VS-00L §16.2.1 及验收矩阵新 §5.7；Invariant=每次实际调用分别计量、完整scope/ref因果关联、失败不得冒充成功、缺usage保持未知；Boundary=现役外部native只读reader/纯join/成本消费者，不修改产品验收hook或原始批次；Consumer=R03 request_cost_batch_evidence；Proof=先独立失败→成功双调用及错ref/缺output/冲突反例，再原批只读派生对账；Acceptance Driver=现役原生driver继续使用原冻结输入，当前无新实模批次，不代签UI/语义；Exploration=非作品知识物化，不适用。新读取字段来自已有ProviderOutput，与既有ProviderRun同一快照；不建新reader/账本。

设计先落验收矩阵 §5.7，再实现外部证据绑定。SSE消费副作用责任与精确源引用协议独立审查，不能靠增加5秒超时或改写旧响应掩盖真正问题。原82路径WIP仍保护，R03保持doing。

**实现与证据**：`9af55a06` 提交4个外部脚本/测试文件。独立红例后最终97/0，包含真实SQLite reader与batch层失败→成功两次计量回归。原十轮只读派生重算12/12绑定（11 completed+1 error），全部join failures为空；失败usage present=false、input/output/cached=null，聚合保留notCollected，不填零。原报告仍FAIL且前后SHA均为48820e62894291abfee1124466cdb48598cf8940dc49c8d1b32f29d5ff70ddbb。证据在`failed-call-binding-08/`；未改原报告、未调用模型、未补签原始SSE或语义。

### 14.20 流状态容器与同步事件消费分责（2026-11-18，实施 checkpoint）

对 §14.19 原始 timeout 只作有证据的责任归因：handle_wire_chunk 的 Agent.update 闭包经 consume_frame→append_delta/append_tool_argument_delta→AdapterExecution.emit_events 同步运行任意外部sink；默认5秒Agent RPC把消费耗时包成provider_internal。先按VS-00L §19.3新增责任边界，不直接调大超时，不从现状测试反推正确性。

七问：Contract=VS-00L §19.3 既有同一流生命周期及TimeoutPolicy；Invariant=无外部IO进入accumulator原子更新、事件唯一有序、取消/deadline仍权威、缺协议终结不成功；Boundary=现役SSEStream与既有公开adapter测试，不新建任务/队列/服务，不改DB/UI；Consumer=三wire真实HTTP on_data及EOF flush；Proof=先建立超过5秒慢sink但低于真实配置时限的独立反例，另测多帧顺序/取消/显式deadline/EOF/异常清理；Acceptance Driver=原NativeScenarioHarness，后续仍需真实模型/页面证据，局部测试不代签原十轮；Exploration=不物化作品知识。复用既有Agent状态所有者、同步HTTP回调与AdapterExecution事件出口，均有现役消费者；变更仅移出外部副作用，不另建发布权威。

本步与外部失败调用绑定独立，分别验证与分组提交；旧批次、原始失败和82路径WIP保留。

**实现与验证**：`5304fd65` 提交现役SSEStream及既有预览测试。真正5.1秒sink红例先产生5000ms Agent.update超时（red-02.log）；移出外部副作用后目标13/0、Provider目录411/0，新增慢sink/顺序/取消/显式deadline/EOF异常清理五例。最终完整mix check 3375/0；完整扫描首次18pass/3fail/9发现，其中本次测试新增2项Credo AliasUsage，已由cbf582a9修正，后续§14.21最终扫描确认Credo通过。其余7项仍为UI/task_done pending、5历史误报及1accepted risk；I1/I2/I3/N-NARR/I-CACHE等门禁已通过。早期fixture漏endpoint、事务拒绝后旧代码仍失败的日志保留不冒称绿。证据在`stream-consumer-boundary-09/`；无新模型调用或原生验收，R03仍未闭环。

### 14.21 精确片段引用与真实历史保留（2026-11-18，实施 checkpoint）

源引用不能靠让模型反复准确回抄来保证。只读核实continue-closeout-03/native-10-current-01验收副本的真实v1 checkpoint（run_mwl151vc_5fv:5、prun_mwl15w62_6lz、pcall_mwl15w62_6ly）有2条摘要/2源，义务均为源子串，原响应/ProviderOutput hash一致。这证明真实历史读取消费者存在；旧副本capsule尚在，不能据此代签事务转交。未扫描日常作者库，不读取无关正文，不因未发布而删除内容。

先修订VS-00L §16.2.1：新v2请求用预编号完整行片段、模型只选择本源编号，引用字节由冻结原文派生；只保留有真实消费者的v1历史读取，禁止旧请求生产/旧来源重派。新capsule v2必填冻结discussion协议，旧capsule v1明确只读解释，坏JSON也不猜版本；coverage显式绑定原请求版本。原文预算、保护集、唯一执行及三wire共同投影不变。

七问：Contract=VS-00L §16.2.1及现役discussion/capsule字节契约；Invariant=精确源字节、旧历史可读但无新执行资格、未知拒绝、摘要不授权、原响应单一真源；Boundary=现役common来源/压缩/投影、Application摘要准入恢复、Persistence事实校验及外部checkpoint证据，不增加表/后台/独立摘要服务；Consumer=真实压力维护与三wire历史投影；Proof=先独立行片段/CRLF/非连续/越界/旧canonical/旧坏pending/请求版本冲突反例，再跨层回归与全门禁；Acceptance Driver=原3/10/20 NativeScenarioHarness与冻结输入，最终必须真实模型义务保留和原生整理，当前设计不代签；Exploration=复用现役session_message_read原文可达，不增加专用知识packet。复用查重：MessageCoverage已有源解析，DiscussionSummary已有材料预算，Compaction已有完整历史，ProviderRun已有唯一capsule，各自责任内扩展，不建重复所有者。

**实施与验证**：b7d4e75d完成现役7个生产文件与针对性测试：新v2完整行索引、混合CRLF/CR/LF原字节、相邻片段拼合/非连续分开、预算边界、三wire投影、冻结capsule版本、历史v1合法及malformed pending读取、请求响应版本错配拒绝。独立评审另发现临时wire文本可伪装canonical，先复现common/application错误接受，再由RequestIR消息契约拒绝无结构checkpoint的checkpoint角色；真实codec→validate_segment→commit_snapshot拒绝且不落run/segment。恢复反例改为真实v2越界/重复索引，hash损坏仍优先失败，不靠版本错配制造假覆盖。

外部oracle单独提交fbfee1b5，独立核对冻结来源/完整片段/响应版本；v1/v2均须唯一正确系统声明。实查真实旧v1有该声明后，修正旧fixture而不放宽核验。完整native脚本测试1045/1045通过。初次全门禁发现summary测试826行规模门禁：按实际消费者拆分prepare用例8个与AgentRunService生命周期7个，单一test support共享Provider/setup，删除原内嵌重复责任；不压行、删反例、放宽阈值或豁免。最终完整mix check3384/0；全扫描19pass/2fail/7发现，新增Credo/规模问题均已消除，I1/I2/I3/N-NARR/I-CACHE、架构、前端等通过。剩余是尚待真实UI证据的task_done及既有5项误报、1项accepted risk，不能称全扫描通过。

证据fragment-protocol-10/保留所有红/绿/首次扫描失败与scan-final-pre-native。原82路径中81个字节不变；test README仅增一条新runtime索引，先快照逐字比较并按独立index patch只提交新增行，原3条WIP仍未提交。真实3→10→20及交错/C8/取消尚待执行，独立语义检查已在实模前按冻结20轮作者原文记录semantic-review-plan.md。R03仍doing，不以单元测试/静态检查代签模型义务保留、实际页面整理或恢复闭环。

### 14.22 首次 v2 原生批次与外部空值边界（2026-11-18）

冻结03ad27a8及原manifest/快照/模型/预算运行fragment-native-11：三轮job正常结束、32/32，3调用全部对账，13条typed等待、4张真实截图；独立语义确认风险表未做、暂选不授权。三轮低压max14511<22400、无checkpoint，不代签压缩。

十轮实际完成10次业务回复及5次维护，最终机器报告32/42 FAIL：外部requestVersion在解码前将SQLite TEXT 'null'当成未清capsule。独立DB确认5个v2 checkpoint覆盖6条讨论、原响应/ProviderOutput hash一致、索引原字节合法、5个capsule均已清。6bda7c59仅修该JSON边界，坏shape仍拒绝；先红绿，全native1046/0。只读重审另存capsule-null-12/review，10/10轮15调用完整绑定、原解析错误消失；原report/summary/failure三SHA不变，派生报告继续保留原failure存在的FAIL，不覆盖证据或重发模型。

另按同一实际协议升级C8外部oracle（45250f35）：复用auditDiscussionRequest而不复制source.text/来源解析；严格v1/v2 capsule完整键、冻结协议与响应一致、JSON null清载荷，保留原plan/hash/身份/时间/原响应一次恢复等反例。全native1048/0；尚未运行真实C8，不能用oracle绿替代恢复事实。

真实图像已核第8/10轮、展开整理、完整原文定位、高亮与刷新恢复；这些不是语义成功。第10完整回复虽交四场单/双收益风险与共用证据，但未完整比较两视角证据需求/呈现差异，却称已完成不再挂账，独立结论为semantic partial（不是强制24格排版）。结尾仍未代选。原独立复核写入各批independent-review.md；R03不通过，未启动20轮。

### 14.23 完成声明与实际交付覆盖（2026-11-18，实施 checkpoint）

先沿愿景作者诉求持续、UA-01运行完成不等于目标满足修订责任：普通回复也须对作者要求与已交付内容逐项核对；不新增文学内容状态机。当前共享规则仅笼统禁止近似效果，result_narration专属的不虚报段不能覆盖本次planner普通回复，现役AuthoringSemantics.shared_rules是唯一正确责任owner。

七问：Contract=UA-01实际交付/完成声明及愿景§2.1；Invariant=欠项按事实保留、已交付不否认、模型承诺/偏好/摘要/运行状态不构成履行；Boundary=现役共有规则与真实消费者/版本测试，不动冻结作者输入、预算、作品数据或引入新状态；Consumer=AuthoringTaskPolicy判断与专业角色共用规则；Proof=共同材料不能替代差异比较的负例、共同确适用可合并的正例、部分/完整交付状态对照；确定性检查只证规则布线，实模独立核内容；Acceptance Driver=同原输入3/10/20及独立语义，不靠重复直到出现有利输出；Exploration=现役原文读取已足够，不新增工具。实施前核语义版本变更的实际持久消费者，不盲改真实历史，也不添无消费者兼容。

f9708c06在唯一shared_rules补实际要求/交付、多对象维度、共用与差异、欠项/已交付规则，版本b27-semantics-v2；新AuthoringTask默认同步，历史from_map缺省仍标v1不伪装当前执行资格。核实现役请求均新建，没有需要扩大兼容的旧任务重派消费者。真实writer IR、planner首次/修正共享规则恰一次；独立红例22/3后目标115/0，证明布线与版本，不能证明模型语义。

完整mix check两次均3385/0。首次扫描新增planner测试1461行超过规模门槛：按纯completed-prefix责任移出4个既有用例至独立102行测试，保留42个Provider/IR编排用例及全部原断言，不复制Provider/setup，不调门槛；独立用例多重集与差异复核通过，目标46/0。最终全扫描19pass/2fail/7发现，新增规模问题消除，Credo及I1/I2/I3/N-NARR/I-CACHE通过；剩余仍是待真实UI的task_done与既有gitleaks处置。证据completion-semantics-14保留首次失败、拆分和最终全量日志；README只独立提交新增顶部索引，原三条WIP保持。旧10轮semantic partial不变，新实现须按同输入/模型/预算重新独立原生验收，尚不代签R03。

### 14.24 完成规则后原生事实与有限窗口缺证（2026-11-18）

92df9acd冻结同manifest、源快照、模型、预算、原20条输入，completion-native-15先3后10；没有改题或重试直到有利输出。三轮机器32/32，3调用/13typed等待，完整原文独立审查与4张实际截图通过，max14144<22400且无checkpoint，仅低压对照。

十轮完成10业务+5维护、15调用usage全知，机器基础32/32。5个v2 checkpoint覆盖6条旧讨论，原文索引/重建、原响应与ProviderOutput hash、capsule清除独立通过；10条作者原文逐字匹配。前4个checkpoint之后的首业务请求通过，最后一次维护在第10轮后提交，无后继业务请求，故严格next_request_evidence_missing、整体partial/runner exit1。不是解析错，不删末次checkpoint、不临时补第11轮、不改原报告；20轮末尾若再维护也会有同类有限观察边界，需先修验收设计而非降低产品条件。

第10回复明显改善：四场确实逐项比较单/双收益、风险及多数证据。但旧灯塔双视角的证据格仍只有要明确守谁/欠谁的动机条件，没有可观察/可核对呈现，却宣称全部完成，独立语义仍partial。另第3未读档案即断言内容不存在、若干回指轮次错误单独记录。结尾决定仍未代答；这些不与机械缺证混淆，不用更多提示词或盲重跑代替责任分析。尚未启动20轮。

直接核第10轮、整理展开、完整原文橙框定位、刷新后展开恢复四张真实图，Markdown与可见状态正常；UI通过不代签语义。各批independent-review.md和visual-review.json保存独立结论，旧partial保留。另按既有C8完整驱动推进交错/取消/客户端重开/持久失败与BEAM重启后原响应恢复，使用独立B71 seed及新runtime事实，不复制request-cost快照，不宣称已通过。

### 14.25 固定后继观察的有限验收责任（2026-11-18，设计先行）

§14.24的末维护缺下一请求是有限观察边界，不是许可删除最后checkpoint。按验收矩阵§5.8新增普通manifest v2显式一次后继；3轮不加，10/20主体输入不变。旧manifest、旧partial及原报告不改。当前交错/C8另行执行，不修改其driver/evidence。

七问：Contract=验收§5.8及VS-00L真实checkpoint/来源/后继请求；Invariant=完整主体归属、准入维护terminal且接收结果已提交、最终反查迟到、首请求不可挑选、一次后继不递归、所有费用计量；Boundary=现役request-cost manifest/capture/driver/batch/compaction证据；Consumer=普通10/20原生批次；Proof=冻结literal与原canonical/events/ProviderRun/Output独立事实，先边界竞态/漏项/重复输入/成本漏计反例，再普通node验证，单测不代签模型质量；Acceptance Driver=既有真实页面输入/typed等待，原预算与零重试；Exploration=无新产品知识或状态，只新增通用作者核对输入。复用审核：原manifest版本冻结、作者输入校验、readonly快照、call binding与C5 owner均已有消费者，保持单一来源；不新增产品hook或评审器。

关键实施约束：不改正在执行的交错/C8文件；普通compaction消费者仅在完整主体边界已证后以限定事件集合复用C5，保留完整canonical和Provider事实，避免新来源校验器。若现役C5结构无法安全复用而必须改共享运行文件，先报告并等待C8退出，不绕过冻结。此节为设计承诺，不宣称新批次已执行或通过。

### 14.26 C8 取消/故障固定来源前置（2026-11-18）

真实失败证据 `c8-native-16`：第14次请求取消C（run_mwlbgdjv_hga）正常 completed，仅 planner 一次，无摘要 Provider。输入44,689 tokens，调用1/33，随后checkpoint只覆盖两条Scope；四条未覆盖讨论受keep4保护，另两项ask_author禁止整理。故无在途摘要，不是漏过短时调用，故障/BEAM重启未执行，不签C8通过。

先修责任契约验收§5.2，再改现役driver及同源外部检查：前10讨论/交错A/B/回答/核对不变，第11条唯一固定预热→C摘要取消→第12条故障D→第13–20条恢复+既有control3。二十条讨论及五条控制输入的字节/哈希不改，不运行中追加至绿。取消前B回复应自然成为最近四项外候选，故障前A恢复回复应自然变旧；以真实坐标、未覆盖/未占用、完成状态、作用域和压力证明，实际准入来源再次匹配。条件不成立即停止原批，不放宽保护、不伪造模型hook、不重调已占用来源。

存在性七问：Contract=验收§5.2真实摘要取消及原响应跨进程恢复；Invariant=固定输入顺序/keep4/永久来源资格/原字节/单次真实调用；Boundary=现役driver、canonical reader与auto-maintenance evidence；Consumer=真实C8批次；Proof=旧四项保护反例、新合法候选正例及错scope/未完成/被覆盖或占用/压力不足反例；Acceptance Driver=既有AX取消/owned backend重启，实际原生未获本次启动许可；Exploration=不新建产品实体或模型机制，仅更正冻结场景前置。原失败记录保留。此节先登记设计与实现约束，验证结果另补，R03仍doing。

### 14.27 结构化提问的唯一正文责任（2026-11-18，设计先行）

真实反例 `c8-native-16/interleaved-a-waiting.jpg` 同一提问完整显示两遍，底部另有定位摘要。只读隔离DB：run_mwlb8pae_elm 的canonical第4条ask_author在第5条因explore_before_ask_required拒绝，第10条才于第11条验证成功；仅一个成功question interaction（b557eb1c-344a-8766-6ad8-22a0b62ea203，question:a45b10e277e99938136e0f343f815adf4a22157a46e7ae5509c8353da6e43217），不是两次合法提问。AuthorQuestion同源生成通用文本和结构化question，WorkspaceChat无条件MarkdownText(msg.text)后又AuthorQuestionRecord全文，构成两个展示所有者。

先统一UI46 §9.7与UI47 §3.4.1：消息正文按语义类型互斥；成功author_question由现役AuthorQuestionRecord负责全文Markdown与状态，普通text走普通正文；底部只保留操作与必要短定位标签，不再截断复述短/长问题。不同身份同文不合并，拒绝调用不变问题，流式/历史/已答/取消遵守同一正文责任；原始canonical/ProviderOutput/interaction均保留，Why与选项准确绑定。

七问：Contract=UI46 §9.7、UI47 §3.4.1及UA-01作者问题身份/回复链；Invariant=一个成功question_ref一份完整正文、唯一可答入口、原事实不删；Boundary=现役问题记录与WorkspaceChat正文选择、底部操作标签，不新增文本去重/状态表；Consumer=真实等待回答与历史阅读；Proof=完整组合渲染的普通文本/长短Markdown问题、同源重连、异源同文、流式收束、已答/取消/只读、拒绝调用、Why/选项/自由回复反例；Acceptance Driver=既有真实原生等待/回答场景及截图，不改验收输入、不靠组件自证；Exploration=现役question_ref/run/version、AuthorQuestionRecord、MarkdownText、AuthorQuestionService已足够，不增新实体或第二协议。设计先行提交b18c90f2，旧截图仍为失败证据，实施不能代替真实验收。

e24ed695完成WorkspaceChat按author_question类型互斥选择正文，AuthorQuestionRecord复用MarkdownText，操作区只用现役功能定位标签，不按字符串比较去重、不删任何canonical事实。完整WorkspaceChat SSR红例先复现双全文，再目标16/16通过，覆盖长短/Markdown/普通文本/实际底bar/历史状态/异ref同文及真实upsert更新。upsert预览是合成TurnResult输入的组合验证，不等于真实WS streaming/重连与点击验证。独立review无新增阻塞；全frontend pnpm check格式/类型/lint通过、55文件520测试；首次fixture缺字段/多余断言失败日志保留后按真实类型修复。完整mix check3385/0，完整扫描19pass/2fail/7，剩余仅尚缺真实UI的task_done与既有gitleaks处置；证据question-owner-19。真实提问等待/回答及修正后C8尚待验收，不称已通过。

### 14.28 固定后继实现与一次独立20轮的实际失败（2026-11-18）

508414c9实现§14.25普通窗口，独立审查先发现后继AX终态信派生outcome与软失败可漏进PASS，两处均先反例后修正：由真实nodes重算终态、successor_visible进入partial判据。主体迟到、坏owner_refs、来源改字节、费用分账与旧v1不补输入等全native+driver1099/1099；扫描19pass/2fail/7，仍是UI/task_done与历史gitleaks，不称全扫绿。

原普通输入/模型/预算不变，仅新v2 manifest显式一次后继；冻结82cab8f1与manifest SHA 185a6fdb656708e6c7500f3e1e952452499cc1ea93510eb3bc760844c8bdddc6，执行一次独立20场景（successor-native-18/native-20-01）。不是重跑旧10求有利输出；旧10partial永久保留。第16在冻结360秒整轮预算触发turn_timeout，17–20及后继未执行，owned窗口/端口已清理，无延时/重发。

第14先已真实失败：两次HTTP200均被Gateway判invalid_response“Splash响应内容为空”，耗47.113/32.326秒；原调用记录仍有1551/1898输出tokens，持久Output是error。未收集原始SSE，不能猜thinking-only或解码丢失。driver既有策略把failed/gap/ask作为可采集终态继续，序列completed不是产品成功，不能称前15轮全通过。

第16 root仍running：完整回查第一轮1822与第六轮2685 grapheme各一次，均EOF，无重复回查循环。两次planner加两次维护已耗264.776秒；第三planner仍在输出正文时到360秒清理，不是完成后UI等待或provider死锁。该最终调用无usage/Output，不估算补齐；29条结束调用已知输入591413/输出94569/缓存259872，另1在途未知，不能称全批总量。未生成完整request-cost报告/summary，不补造成功。

语义独立核：第10又缺两处双视角证据却声称齐，第11实际识别并恢复缺项，12/13/15保留，证明缺口传播但不倒签10。14无正文不能因15补述过关；15承接作者仅公开改账、不公开父亲生死的决定且未整体采纳，但“父亲生前”引入未经确认死亡预设。11个v2 checkpoint涉及12原始来源，精确片段/响应hash与ProviderOutput/capsule清除另有真实证据，不代签语义或20完成。实际看10/14/15截图，14失败清楚可见；第16无failure.jpg，不声称看过超时截图。

C8前置已另由2f14a861/b449a776实现：固定次序、取消前真实claim/dispatch/chunk、取消后实际request审计；D重启前共用verifyMaintenanceFailureFacts证原响应合法、hash/plan与事务回滚，再准许重启。独立review发现并补齐原先仅请求合法便重启的缺口，定向42/0、完整native+双driver1106/1106；尚无修正后真实C8验收，不将单测当恢复成功。

### 14.29 C8 固定候选假设被真实工具分支否定（2026-11-18）

冻结07b3b54b执行一次修正C8（c8-fixed-20/native-01，job wc_job_-99YMnFlHI1l2N2w）；第14次请求即固定第11讨论完成后，C发送前断言probe_candidate_count_mismatch（3≠4）停止。C取消、D故障注入、BEAM重启及原响应恢复均未执行，不能签过；原failure、日志、DB、Provider记录保留，未追加输入或重跑。

两次独立核DB与规则：keep4计的是混合item，闭合工具交换也占位，而非四条纯讨论。第11讨论run_mwldsct3_e9h回查原表，先有工具交换再最终回复；其合法维护prun_mwldvvr4_g78已在checkpoint seq79覆盖预指定B来源run_mwldpde2_c8s:4，capsule清除，实际剩A恢复/核对/11三条纯讨论。41909/41840输入tokens证明压力不是缺口；不是取消轮询错过，也不是已证明的产品错误。把4改3仍因B已被占用失败，不得以换来源、加轮或缩小保护集修绿。下一步须回到真实混合item保护与在途身份重新审查验收触发契约，不把模型工具分支预测当保证。

已亲看A等待、A恢复、失败时页面三张实际图并保存visual-review.json及哈希：同一问题正文只有一份，底部功能标签/两选项/Why/自由回答仍在；回答后普通输入恢复。等待正文无Markdown语法，不能拿此图证明问题Markdown样式；后两图不含完整历史问题，不能代签重连/历史展示。独立canonical审查确认A接受保留秘密、B等待及11保留决定/未授权状态，但A扩展说明有过推后果，不能称全部语义通过。owned窗口清理remaining=[]，仅终止本批PID4785，原82项WIP保持。R03仍doing，普通20失败与有限后继未观察缺口不变。

### 14.30 首份准入与准入时点的验收责任修复（2026-11-18）

先按9cd80f47/7ee32151修验收§5.2，再由140f0f09实现：固定C/D输入窗口，锁全部持久准入中时间最早者，不先按状态、chunk、响应合法性筛赢家；冻结pcall/prun、全来源集合和原计划。当前保护集由首份准入前的不可变canonical重建，精确微秒、缺时间/等刻多义/时序倒置即失败；后续新item不能追溯解除当时保护。保留真实混合item、永久claim、scope/原文、确认前同目标、取消后真实request及D原响应/回滚/跨BEAM一次恢复全链。

独立审查先发现终态快照可能误放原受保护来源，写红反例后修复并复审；IO fixture独立literal迁移，先9/13再13/13，不用实现派生预期。完整native与两驱动1108/1108、module-size通过；完整扫描19pass/2fail/7，仍为既有task_done及gitleaks处置，日志c8-admission-21。before快照毫秒与DB微秒同刻边界会保守拒绝，不冒充已证明顺序。尚未执行新实模，不以这些检查关闭C8；固定窗口无summary或首份无法取消仍须失败，旧c8-fixed-20、普通10/20partial不重写。

### 14.31 原生首摘要观测的真实字段反例（2026-11-18）

冻结e8f53580、原20+5输入哈希及预算执行一次c8-first-admission-22/native-01（wc_job_sYQJsmDMBDJcj4qu），保护资格已通过，首摘要prun_mwlfjuxe_jki于01:15:55.358562准入，55.938保存running首快照。01:16:18.525667起123条非空chunk至19.199897，output于19.201707持久化，HTTP200/completed；观察器却始终未判可取消，最终first_summary_ended_before_cancel停止。精确wire中取消命令0次，D未开始，不能把自然完成当取消/恢复成功。

独立DB、源码及日志一致：现役ProviderEvent.emitted_at允许nil，AdapterExecution仅started填值，真实dispatch/全部chunk均nil；外部inFlightSummaryForRun错误将可选emitted_at作为必需条件。应修外部事件证据owner，使用真实持久时间与同执行sequence，不为验收修改产品事件，也不把started替代非空chunk。另本次首chunk至output仅约676ms，现轮询含300ms间隔及AX双确认；字段修复不保证真实取消窗口足够，未记录逐次predicate耗时，不能进一步编造漏采耗时因果。

first-admission-diagnostic.json独立核9个原始文件/DB哈希保持，实际failure.jpg已查看并保存visual-review.json；UI最后为完成回复、普通输入而非取消成功界面。owned本批PID32314已清理、remaining=[]；旧失败原样保留。

独立语义核A及紧接复述正确承接保留秘密，11及C后来降为未确认；但冻结11确有晚到作者措辞“仍未确认”，属于层级/指令冲突未澄清，不能直接归为遗忘或假定只指读者。另一确定缺陷独立成立：11未回查原表，错误将10已提供的若干风险/收益/文件示例标成未交付，C部分继承；实际交付保护尚未可靠。R03仍doing，普通20/后继窗口、C取消、D原响应跨BEAM恢复均不能代签。

观察器责任修复已按21219b48设计、76cede63实现：只以持久inserted_at及同执行唯一sequence核dispatch后真实非空chunk，正常nil emitted_at不再被误拒，缺时间/微秒逆序/重复sequence/已有output或终态仍不取得在途资格，确认前同target复核不变。不修改产品或原输入，独立literal红绿及只读复审通过，完整node1109/1109、module-size通过，完整scan19pass/2fail/7仅既有manifest/gitleaks，证据c8-observer-23。没有再开实模；676ms窗口下原生双确认仍未证，不能用observer修复或已有单元取消测试替代真实C/D。后续需先明确符合真实取消目标的可控外部观察/传输场景，不靠再跑模型赌时序；普通20的provider空响应/整轮超时及实际交付语义缺口保持独立待解。

### 14.32 可控外部传输窗口而非碰时序（2026-11-18）

按418f891f/a660b01d先修验收§5.2，再e9a0ab88/bc9e6d1e落独立Provider HTTP/SSE代理及runner：复用既有NOVEL_SPLASH_ENDPOINT仅对子进程临时路由，原上游预检/模型/参数/HTTP正文不改，不向生产加入验收识别。只读registry先开，首prun由持久事实独立冻结，完整材料审计及原请求字节唯一绑定external request_id，首content前精准arm；迟arm/多义/首份不合法即失败，不停业务请求等待或换第二份。

代理仅旁路解析证据副本，恰把原字节前缀转发至首个完整非空正文SSE record边界，暂停其后传输最多30秒。仍需同prun真实持久chunk及在途证明后AX双确认；代理只记中性disconnect，由真实命令/ACK、产品cancelled、同执行关闭与无迟到checkpoint独立判取消。暂停超时/清理不代签，任何情况下都不宣称停止vendor算力。D之前一次gate必须关闭且连接清空，后续纯透传；原D响应/plan/hash、事务回滚及跨BEAM一次提交不变。

独立复审发现并修了absolute URL旁路、清理误归因、首record边界不足与新增端口终局漏查；真实本地HTTP反例及完整Node1141/1141通过，最终完整scan19pass/2fail/7仍既有manifest/gitleaks。新脚本索引按index-only提交，去新增行后与原README快照逐字相等，其他原WIP未入提交。证据c8-stream-gate-24。实现/单测不代签C8，下一步仅按新机制冻结一次原生验证，原失败、普通20及语义缺口保留。

### 14.33 受控传输首批的启动偏差与桌面缺证（2026-11-18）

唯一批c8-stream-native-25/native-01（wc_job_krJ7r70vGLZiND7M）启动前编排预检误把README“两条索引加一空行”断言为总两行，shell没有fail-fast仍启动。此为执行错误，原stderr保留，launch-audit.json明确启动后补写、不是preflight；没有补造通过记录。独立核f436b452提交01:51:44Z早于runner ready01:53:11.114Z，runner生产源HEAD一致，20+5原输入source/current/batch拷贝哈希一致；81原WIP哈希未变，README仅上述插入且原字节全保留。这些允许单独审真实能力证据，但不能宣称启动门禁合规；后续启动必须set -e及前置成功后才分发，不据此补跑本批。

实批在A提问后、点击开始新讨论前因owned_native_surface_not_onscreen停止，未进入B、C门控或D恢复。最后本批输入为02:05:03.453Z发送A，其后无本批桌面操作；02:08:44.074Z WindowServer记录该App WebKit NotVisible，44.285Z得到问题，45.068Z截图失败，45.259Z可见性保护停止。主窗口13644仍存在但on_screen=false，is_hidden=false/is_active=false/AXwindow0；无本批hide/Space热键/关闭动作。近时段读电源日志未发现睡眠/唤醒或屏保启动证据，现有防休眠仍开；10:10当地时只读前台是ChatGPT，不能由此归责用户或推定失败时的切换原因。没有failure.jpg，不声称看过；没有抢占桌面或重新激活。

代理51请求（31GET/20POST），50完整响应received/delivered长度和hash逐字一致，19个结束POST与产品LLM原请求唯一匹配；最后在途请求由cleanup断连，不是用户取消。registry window/arm/pause/disarm均0，因此只能证实际透明转发，不能签门控取消或D。四端口4657/4661/51474/51475无监听，owned runner/backend/proxy/app PID均无残留；independent-outcome-review.json与窄范围OS日志保存上述证据。下一真实验证需明确可持续原生窗口可见的桌面操作时段，不再盲跑/抢前台；R03仍doing，启动程序偏差、桌面环境缺证与既有20轮/语义缺口分别保留。

### 14.34 静默传输中真实取消未及时收束（2026-11-18）

作者重新授权可见窗口后，冻结79d8007f，独立前置检查成功再分发唯一c8-visible-window-26/native-01（wc_job_O1ph9k1zwCEOFfCX）。原82路径当前哈希与前置快照一致、原20+5输入不改，未复用25的事后审计充当前置。此次实际进入C：首份prun_mwlijx56_j37/pcall_mwlijx56_j36与request-64唯一绑定，原请求SHA50202f4eb3a6a6f2693ff09c392a20d21489393daad297fcd1a6c99e525681c7；02:40:57.039Z交付1106616原始前缀字节，独立解析恰一份非空content record、无DONE，57.040843Z同执行chunk持久化。

真实AX取消命令/ACK发生02:40:58.601/.605Z，interrupt_state.requested_at为58.603197Z；但没有及时断开接收连接。代理30秒安全上限于02:41:27.041Z触发pause_timeout，随后27.061670Z才有Provider cancel_requested、27.064143Z cancelled。故gate_not_cancelled_and_drained保持FAIL，不把最终“已停止”状态当及时取消通过。取消目标没有checkpoint，D未进入。上游socket已在57.607Z关闭，早于取消，end可能被pause遮蔽；不能声称vendor仍生成或算力被取消。本批同时暴露外部判据对上游先自然结束的事实分支不足，须独立修正，不能用它抹除产品接收取消延迟。

源码责任复核：现役取消token仅变更Agent状态，同步HTTP/SSE只在chunk回调及HTTP结束读取token；首块消费后连接静默时没有主动唤醒/中断路径。下一步先按VS-00L生命周期目标补设计及真实本地HTTP静默连接红例，再修责任层实现；不得发假chunk、放开suffix、延长暂停或靠新一批实模赌时序。cancel-delay-diagnostic.json保留12原证据哈希及精确时间线；四端口4657/4661/56704/56705均无监听，owned进程全清理。

已亲看interleaved-a-waiting、cancel-confirmation及failure实际像素：等待问题正文一份，功能回答/选项/Why保留；取消确认对话框说明保护既有作品内容；最终页面可见“已停止”、无任务、普通输入恢复，正文标题/粗体正常渲染。但截图不证明及时取消或跨进程恢复，等待题无Markdown语法，不代签问题Markdown样式。R03仍doing，普通20/后继与实际交付语义缺口保留。

### 14.35 静默取消责任修复与上游闭合事实分责（2026-11-18）

先79f50c62修VS-00L §19.3再c729da1a实施现役HTTP/CancellationToken/SSEStream：原子订阅唤醒等待，以单请求owned Task和逐块握手保留caller同步sink、背压与唯一终态；取消不再等下一wire字节，退出确认本Task收束并清理本ref消息，已取消不flush未消费buffer。独立审查要求并补启动放行/worker复核、精确DOWN收敛。普通可捕获worker异常结构化返回；不可捕获强杀沿既有AgentRunServer Task DOWN失败/维护计费恢复消费者，不伪报HTTP层已捕获。现役Req0.7.3/Finch0.23真实仅H1/TLS-H1，测试约束依赖默认，无硬降协议；HTTP2未来必须另证池内流取消。显式deadline在静默中的既有缺口未因本次取消修复获通过。

独立真实TCP红例在原e3d464e4首正文后不再给字节，取消500ms仍不返回（4/1）；修复后focused33/0，实际对端closed、headers前取消、并发隔离、owner退出、5.1秒原caller慢sink及消息隔离均验证。预取消与订阅竞争有动态测试，subscribe→start精确窗口仅源码审查，不冒称确定性动态复现。完整mix check3395/0、warnings-as-errors/xref/arch/ADR/I-CACHE、Credo773文件零问题、I3 3/3、I1 4/4、I2三对不交通过；I3启动曾有SQLite locked日志但最终case error0/exit0，原日志保留于silent-http-cancel-27。

外部判据另由e0c5b7f6先修设计、00487ba7实现：上游完整HTTP已接收闭合且无错误/非人为destroy时，不虚构随后abort；真实下游仍必须在原AX命令后、30秒内断开。上游未闭合分支仍需downstream→destroy→close；任意晚到error、未知close、timeout/cleanup及无下游均拒绝。真实本地HTTP与独立literal红例保留，最终完整Node1144/1144；两分支明确报告transport_abort_observed而vendor_compute_stopped仍未知。原26 FAIL及D未进入不改签。

统一完整scan为19pass/2fail/7findings：六条既有gitleaks处置（五false_positive、一历史线accepted_risk），无新产品凭证命中；task_done_manifest仍pending，旧manifest与本次变更/未完成原生证据不匹配，不补造完成或绕过门禁。已读report/top10/disposition并随日志归档；本checkpoint不是全扫描通过，也不是R03完成。原WIP按原82哈希核对；新增VS-00L设计仅index-only抽取6行，既有WIP保留。

26语义独立复核进一步确认：原10 canonical44已有修钟铺与灯塔双视角收益风险，11 canonical74却称无对应条目，C79延续为未交付；实际request56的摘要漏掉相关段，原canonical足以反证，不因摘要语义声明而免责。A选择后11改未确认来自作者冻结原文的明确后指令，不计作模型遗忘。下一步仍需修复后一次完整C/D原生证据及普通20/后继与实际交付保留闭环，不通过放宽判断、额外创作轮或重复跑分达标。

### 14.36 已提供材料与未闭合责任的对称保留（2026-11-18）

无桌面独立审查26原文/请求确认组合责任：摘要请求49含完整原文而非输入截断，后继请求56节选遗漏部分已给比较；同时session_message_read在实际目录可达、来源locator与normal_open均在，11/C却无回查便断言缺项。不是工具不可达，也不能靠把全部历史重新注入或固定样本关键词补丁解决。

按fa2022a2先修VS-00L§16.2.1与验收§5.9，再e827a27e落实三个现役owner：摘要忠实概括实际提供的材料种类/对象/范围与限制，不把防虚报完成误作抹去已给内容；Projection固定标记摘要/节选非穷尽，缺省不证明不存在；AuthoringSemantics v3约束历史否定结论按source/locator及coverage/omissions求证。已有充分原文不重复读取，预算/分页不足可明确具体未知或缩小结论，不机械扫描全会话。材料曾给不等于全部目标满足/作者采纳/责任解除；后续作者重开选择按顺序保留。无新实体、完成台账、存储字段、全量包、自动工具循环或DiscussionSummary协议升版。新任务默认v3，历史v1/v2身份保持、不能伪装当前执行。

独立反例覆盖部分已给/仅承诺/共享材料/尾页证据/作者重开及跨域措辞；确定性红例只证明现役规则与三wire投影原先缺契约接线，不宣称复现模型质量。focused68/0，完整mix check3396/0、编译/codegen/xref/架构/ADR/I-CACHE和I1/I2/I3通过，独立实现复审无阻塞。focused五条persistence error经trace绑定旧测试的主动terminal fact persistence failure；初始化SQLite锁日志保留，完整独立库check仍0失败，单应用trace无锁，不以日志删除制造绿灯。原82项WIP哈希全同，既有SessionMessageRead未改。

最终统一scan仍19pass/2fail/7：既有六gitleaks中五false_positive、一accepted_risk，task_done_manifest仍pending；report/top10/disposition归档delivery-retention-27，不新建虚假完成manifest。未占桌面、未运行新模型批次，原10partial/20失败/26FAIL不改签。该步只闭合责任契约与接线，模型是否实际保留范围、主动求证并正确回答，仍须按原作者预期与真实原文独立验证；C/D原生及完整R03尚未闭环。

### 14.37 原生取消及时收束，但取消请求审计缺失（2026-11-18）

作者明确桌面随时可用后，先只读核HEADfe73ec44/原WIP82全同/index空、原批进程无残留/端口空闲与Finder前台；osascript只读查询超时，现役AX观察成功，不据超时推断锁屏。独立preflight成功后唯一启动c8-cancel-fixed-28/native-01（wc_job_iCz2izQkW7D_Sldk），保持原模型/原20+5输入/顺序/预算/30秒上限，不跳前置，不重跑普通20。

C首次prun_mwllth8r_hcx/pcall_mwllth8r_hcw与原request-66唯一绑定；请求SHA888de8db33b28456a0fa62a4f752e255cba85f6b6c5b824043280a93ada5161b。首正文原字节04:11:28.941Z交付，upstream29.508Z先完整HTTP闭合；真实wire取消30.118Z，downstream30.120Z，Provider cancelled30.139870Z、root cancelled30.176Z，30.781Zdisarm且无活动请求。此为真实及时接收取消，不宣称vendor计算中断，也不为已先闭合上游虚造abort。

随后requireActualProbeSource按原双ID核完整产品请求记录得到0≠1、probe_summary_request_missing而FAIL，D未进入，不能签C8通过。产品Result.cancelled分支跳过log_stream_result，28条日志无此prun；不是reader漏解析，也不能等日志或拿proxy副本替换产品审计。独立遍历原请求由完整材料审计仅匹配request-66/sourceCount1，证明目标与外部字节对应，但不填补产品日志责任。run checkpoint0，usage未采集不记零，15项原始证据哈希不变；四端口及四owned进程均已清理。cancel-log-diagnostic.json保留精确时间链。

已亲看cancelled-run.jpg实际像素（SHA bce32af83ec02f48e2ee6e6043dc92d9038e1d85016f88195b3db908cae66092），页面已停止/无任务/普通输入恢复，标题粗体渲染；取消时效以真实wire/持久/传输事实判断，不由截图代签。下一步先修现役取消分支审计责任及独立反例，不放宽验收、不修改原FAIL。

语义有正向与剩余反例：11真实session_message_read完整回查10，request57及C request63都带逐字一致10179bytes原文，11不再否认两场双视角存在；作者A选择与后次未确认时序保留。但11把未单列/未量化/未矩阵直接当未交付：早期模型确有相关深度承诺，仍须指出具体语义未覆盖而非强制格式。C还将讨论未登记为设定和范围外全书场景列入欠项，与只讨论、不写档及原四场范围混淆。故语义仍partial，不能以修复v3或一次正确回查签全面达标；独立原文审查JSON已保存。

### 14.38 取消审计、真实尝试与未知用量的闭合（2026-11-18）

按8681842f/12d4411e先修VS-00L责任设计，再0b1fc568/367e79b1实现：SSE准备事件不再提前冒充request_dispatched，HTTP worker实际进入本地Req尝试时通知原caller，沿唯一事件序列分配一次phase，预算/恢复继续消费同一事实。取消先到时停止worker并等待独立monitor退出屏障，再按同sender信号顺序收取已发生attempt，不能仅凭零等待猜消息已齐。未尝试取消无日志/无假调用，已尝试无响应仍有原请求与未知响应，不宣称vendor收到或计费完成；eventsource_fn遵循同契约，不按函数身份特判。

取消Result在原caller复用LLMLog，恰一次绑定原body/双ID/refs，取消非成功、原chunk保留但不变成完成正文。三wire只保已观察usage，缺失nil、明确0仍0；沿现usage事件/ProviderOutput/ProviderRunLog往返。真实持久红例发现safe_value曾将nil转成字符串“nil”，已在唯一sanitize owner加nil分支，不改字面字符串或历史存储，不加表/台账/模型。

证据cancel-audit-29：真实TCP→SSE→LLMLog原请求红13/1（0日志）到绿；取消尾消息通过held-token+真实accepted连接控制顺序，验证一次attempt及对端close，不靠睡眠猜时序；三wire部分17/null/0、无量/显式零、预gate取消、重复通知、事件顺序均覆盖。真实DB同execution提交两次，output/events/usage汇总保17/null/0，16/1→16/0。provider目录428/0，全mix check3404/0、force编译/xref/arch/ADR/I-CACHE、I1 4/4、I2三对、I3 3/3、Credo773文件零问题及独立final review通过。原WIP82哈希全同。

最终完整scan仍19pass/2fail/7，既有五gitleaks false_positive、一accepted_risk及task_done_manifest pending，report/top10/disposition归档，不造完成manifest。局部机制与确定性绿不代签真实C/D；28原FAIL及语义partial保留。源码门禁后按作者持续桌面授权与现场冲突检查冻结下一单批，不更改输入/阈值/keep4/取消上限或D原载荷恢复标准。

### 14.39 单批原生 C/D 通过，语义仍 partial（2026-11-18）

独立成功preflight冻结eb427953与原WIP82、原输入哈希和空index，唯一运行c8-audit-fixed-30/native-01（wc_job_fyNzOUz3Z7s8mGas）。原20+5输入完整结束，终态exit0/native PASS；未追加输入、修改阈值、重跑普通20或将旧失败覆盖。C真实取消及产品原请求审计、D真实持久失败及跨BEAM进程原载荷恢复均实际进入。

C prun_mwlnfwpo_jn5/pcall_mwlnfwpo_jn4：04:56:53.398Z原正文前缀交付并暂停，54.689Z下游断开、55.453Z disarm；取消产品日志恰一次local_attempt、usage未知{}、status0不伪作HTTP成功；不宣称vendor计算停止。D prun_mwlnhdo0_kzd/pcall_mwlnhdo0_kzc：注入回执、04:58:08.987017Z产品checkpoint_persistence_failed日志与checkpoint数11→11共同证明失败不提交；BEAM 59704→87739，同库重启后以原响应SHA1c304061db276a71f23e58e1cda48fb862662b6047befe492d35b78f8c4e2217及原plan恢复，04:59:10.126666Z唯一canonical771683cc-124b-4a97-babd-02d2a2fba451，capsule清空、完整原日志中同源模型执行仅一次。

独立independent-cd-final.json先核17项。为避免拿after-recovery快照冒充整批末证据，停机后另以mode=ro&immutable=1/query_only读取最终DB，保存independent-terminal-db-proof.json（SHA5c5b4471d4218386478f1ea07d073d4535e7dd98811062607d2f65bced347de3），明确修正旧报告时间范围、不覆盖快照：149条canonical/51 ProviderRun/21 checkpoint，9项末态检查全真，D仍恰一次且原响应/hash/plan不变，C无迟到canonical或checkpoint；DB前后SHA68f591864ebf010487e4290e623faa97f9b167cd052f007a8edd6a1b954843ff不变。原始证据哈希不变，05:15:07.213Z cleanup remaining=[]，owned进程及四端口清理。亲看interleaved-a-waiting/cancelled-run/after-recovery实际截图并存visual-review.json：单问题正文、功能回答区、取消后普通输入和恢复后整理提示可见；截图不代签DB/时效，问题无Markdown语法的图不证明其样式。

语义独立按原文仍partial：10确实交付四场单双视角收益/风险/证据；11实际完整回查10，C请求保留同一原文，不再复现28“未登记=未交付”。但仍把未单列格式当欠项、将模型提出切换点误作作者要求。停机最终canonical独立提取及independent-tail-semantic-review.json（SHA3a1d1dfbef729b82c03755d949bee0317b79bbf843ac13d219db68e03c69f611）确认20确实回查1/10、控制3准确保留作者14“只公开账页被改、不公开父亲是否活着”、未扩展写作/场景采纳授权；仍把具体“早段更正规程”建议升级必需项，将已替换决定兼容性与范围外全书核对重新挂账。工具PASS不倒签11/C语义，不把正确检索当正确判断。

因此C8取消/恢复机械链已闭合；R03仍doing，R04未开始，普通20失败与旧10 successor证据缺口原样保留。下一步针对承诺归属、格式与语义覆盖、建议和授权边界修责任设计与独立反例，先做非模型审查，不为追绿重复试跑；既有scan19pass/2fail/7及完成manifest pending不被本原生结果抹去。
