# B87 · Issue #4 模型交互体系系统性重构：实施总计划与唯一任务状态源

> **补充评审输入（不改变任务状态）**：[完整 JSON 协议候选包](../../docs/design/contracts/model-interaction/README.md) 已按现有 SSOT 目录归档；Schema、合成正反例、字段/状态说明和离线验证互相可达。它保持源基线 `f13ff640`，与 `04492ea3` 的增量差异见 [归档说明](../../docs/design/contracts/model-interaction/integration-notes.md)。R00/R07/R08 先对账，不将离线 PASS 当作本任务任何批次完成。

**状态**：**doing（2026-11-20：R00 已提交 `465b1a3f`；R01 可靠测量基线及工程实现已收口，证据与限制见 §11.21；R02 已 PASS，产品跨层投影、真实 B26 选择/自由答复、三 wire 机械等价及冻结 Splash 三轮的源事实/作者原文/身份对账已闭环，最终验收见 §13.10。外部证据修复提交 `90252001`，共用 seed UTF-8 修复提交 `3c66fc91`；第二/三轮业务目标未实现、模型语义与页面状态/内部身份问题仍按既有 R06–R09 保持开放。R03 已按前向修订的应用职责契约 PASS（§14.52）；原批模型质量 partial 与旧普通20成本缺证不倒签，R04 已按分层应用证据 PASS（§15.6；修复检查点 `50e02d8d`），R05 的source-03实测反例与裁决见 §16.23；正按 §16.24 收束判断/计划唯一作者正文、Writer同次可见材料声明及外部证据读取；旧count/quality结论按原源码保留，新冻结源码 count-04 通过、quality-05 机械通过但作者过程语言失败，§16.25 的 action 与作者说明职责修复已提交 `da94a8e9`，§16.26 按完整工作区规模反例提取动作契约，已以完整3581/0验证提交 `baec5e99`；同源码完整静态复审通过，count-05通过、quality-06再次出现作者过程语言失败；现按§16.27分离直接读取与作者表达职责，其余四场及cost-final-03暂停且未消耗；新的六项真实复验、最终成本与工程出口尚未完成，R05 不签 PASS；R06–R19 未实施，远端 CI 与既有全仓质量缺口仍开放，B87/Issue #4 未完成）**。

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

### 14.40 保留信息与交付责任分责的设计澄清（2026-11-18）

**目标与上位审查。** 作者可观察目标不是让待办越来越长，而是既不丢真实要求/模型承诺，也不把建议、格式偏好和范围外未知变成作者债务。按愿景§2.1作者主权、§2.4最小供给/按需求证/证据闭环审查，批30的原文可达与真实回查已经成立；canonical95明确限定部分揭密且不整体采纳场景，143/148仍升级具体手法、重开旧决定并挂全书核对。故不能将剩余问题统称缺材料，更不能全量投喂、重复检索或追加样本提示以制造达标。

**责任修订。** VS-00L§16.2.1在实际提供范围/责任解除的既有owner内明确：需要保留的信息不是统一的交付责任。作者要求与模型自身承诺分别归源，在当前有效范围内核是否仍欠；真实模型承诺不删除、不冒称作者要求。建议/候选/未决选择/范围外未知保持原性质，不自动取得必须执行或必须由作者决策的地位。必要目标条件不等于某一种具体手法必需。现有summary、保留片段、原文角色、source/locator与Observation足以承载判断，不新建责任实体、状态字段、摘要版本、台账、自动回查或专用评审器。本checkpoint仅改设计，不改产品代码、既有规则版本或冻结输入。

**独立正反判据（在实现之前固定，不从摘要或模型自报反推）。**
- 原作者明确要求比较两个方案，模型已给相同语义内容：段落改为表格或反向改写格式，交付判定应相同；不得仅因未独立成栏判欠。若确有未比较关系，必须指出该关系及真实要求来源，而非格式缺失。
- 模型自行承诺稍后补某项，作者未要求该措辞：可保留为模型尚未履行承诺，不能说作者最初明确要求；纯“可以考虑”建议则不能变成承诺。后续作者撤回/改变范围须按原话核影响，不能一律销账或一律保留。
- 作者只定目标，模型提出两种可行手法：允许说明必要的目标条件及可选路径，不能把所偏好的一种手法升级为必需；若作者后来明确选定该手法，则按新来源承接，不反推旧时已授权。
- 作者明确以新决定替代旧决定：保留历史顺序并沿新决定讨论，不要求作者先完成两者兼容；确有未覆盖的独立问题可以标明，不重新打开已回答的同一选择。
- 当前只讨论四个假设场景且禁止读取作品：可说明全书未核验，不能自动挂为欠做的全书审计；若作者另行明确要求全书审计但未给必要权限，则如实保留该有来源的任务与阻碍，不伪装已完成或无任务。
- 作者要求列出仍未闭合的讨论事项：允许同时列未决选择、待验证假设、范围边界和真正欠交付，但保持来源与性质，不将前几类统一错标为未交付。不能为了减少欠账而删掉作者明确要看的未决信息或模型自身真实承诺。
- 仅读摘要或分页不足：无法确认责任来源/完成范围时保留具体未知，不能凭“待定”一词创建义务；当前已有充分原文则不重复读。换对象、领域和措辞仍按上述语义判据，不设固定关键词或表格格数。

**七问/存在性审核。** Contract=VS-00L§16.2.1及愿景§2.1/§2.4；Invariant=保留来源性质、当前范围、真实承诺与未知，不凭派生材料增加作者责任；Boundary=本次仅VS-00L与本原任务，后续若实现只能在现役摘要/共享语义/投影owner做有界一致性修改，不能新增存储或任务状态；Consumer=整理后的真实业务判断与既有session_message_read观察回流；Proof=上述独立原话/交付反例及真实请求观察，确定性测试只证接线；Acceptance Driver=现役冻结3/10/20、后继及交错原生入口，未运行不声称语义闭环；Exploration=复用现有source/locator、coverage/omissions，足够即止，范围不明可诚实限定，不强制全会话扫描。存在性审查确认不需新实体、字段、模块、协议或第二权威。

**证据与未闭环。** 本设计基于c8-audit-fixed-30/native-01既有independent-turn11-c-retention-review.json、independent-tail-semantic-review.json及停机canonical原文，不改原报告。格式替代语义、读后建议升级、已替换决定重开等虽有既有规则仍发生，明确属模型执行/推理局限；本次澄清不声称修好它们，也不将规则文本或检索命中当机制保证。C/D机械PASS保留，11/C/20/控制3语义partial、普通20/旧10后继缺口与scan/manifest开放项保留，R03仍doing。下一步先独立审设计与是否确需现役规则的一致性替换，再决定实施；没有追加模型试跑或桌面操作。

### 14.41 责任语义接线与失败已观察用量闭合（2026-11-18）

独立审dc064439设计后，在唯一AuthoringSemantics替换保留/欠交付混写句，当前规则v4，同步AuthoringTask默认；历史v1/v2/v3及缺省v1按真实身份恢复、不能冒用当前版本执行。不新增实体、台账或模型评审循环。common红22/3→绿22/0、真实planner42/0；独立审发现writer仍断言当前v3，保留5/1红后补现役断言v4到5/0。测试只证规则/版本与当前消费者接线，不证模型遵守。证据obligation-boundary-31，四文件原干净。

普通20独立核验并未被C8代签：第14两次HTTP200/invalid_response均0正文chunk，原日志有output1551/1898，但无原始SSE，不能判定reasoning-only、服务端空内容或decoder漏字；正常终结修复不证明旧14原因已修。第16两次回查与两次维护耗264776ms，第五调用清理时仍1761chunks/2717字；360秒是整轮harness上限，不是HTTP静默。17–20/后继未运行，不提高上限追绿。

其中找到独立产品缺陷：第14日志保已知usage而失败持久Output为{}。先3557a85e修VS-00L责任归属，再复用SSEStream.Result与AdapterExecution：从同decoder保存已观察量missing=nil到错误日志、usage事件及empty失败Output，事件序号在唯一error之前；错误仍失败、不伪造正文/成功/计费完成，成功Result路径保持。timeout诊断留error.details及响应diagnostics，不混入token用量。HTTP真实200空内容和直接SSE execution→真实ProviderRunLog重复持久的两个红例保留，修后含17/null/0和全unknown{}；provider430/0、跨层7/0，独立最终review通过。证据failed-usage-31，仅两生产与两原干净测试文件。

两路最终源码统一mix check3407/0，force编译、codegen、xref、arch、ADR及I-CACHE通过；I1四例、I2三对、I3三例、N-NARR通过。首轮Credo报新增HTTP测试字符串引号readability一项，保留原红log，等价sigil修复后HTTP21/0、Credo773文件零问题。实际task_done因全工作树UI证据未选定而exit1，未制造完成manifest或拿旧页面代签新语义。随后完整scan实际21项19pass/2fail、7finding：五既有gitleaks误报、一历史凭证accepted_risk、task_done_manifest pending，逐项disposition连原report/top10归档；没有新凭证问题，原82WIP哈希全同。证据post-cd-31。没有新模型调用或桌面操作，旧真实语义partial与普通20/旧10后继缺口保持；R03仍doing。

### 14.42 一次普通10轮及有条件20轮的预注册验证计划（2026-11-18）

**目的与非盲跑条件。** 当前38ede27a包含责任语义v4、失败已观察用量及此前流式协议修复；批30只闭合C/D机械链，不能代签普通窗口或语义质量。下一实际验证限于一次原固定10轮加既定后继，独立审查后至多一次原固定20轮加既定后继，不重跑C8、不按失败次数循环试跑。新验证必须先具备供应商HTTP/SSE原字节的纯观测能力，使空响应、正常终结、传输失败和产品解码能分别取证；现普通入口TAURI_NATIVE_TRANSPORT_PROXY仅为应用WebSocket代理，不是Provider原始SSE证据，不能以该开关已开启声称前置满足。Provider观测复用必须先完成独立设计、实现、真实本地传输验证和代码门禁，不能在运行中临时补日志或改变输入。

**启动前冻结。** 由现役preflight在任何进程/页面输入前确认最终HEAD、index及原82WIP哈希、唯一新证据目录、原隔离snapshot及manifest输入哈希、桌面可持续可见、owned进程/端口与供电条件。使用原v2固定后继契约，不改原20条或后继字节、模型local/Q4-PLE4/thinking high/max_tokens32000、Provider参数300000ms、整轮360000ms、窗口32000/ratio0.7/keep4和零harness重试；已有产品内部执行次数仍如实计量，不伪称整轮只调用一次。原snapshot为20261113-real-v2-complete，沿现役hash校验，不拼接旧失败批上下文。冻结实际Provider原字节采集拓扑/版本、逐请求身份绑定与完整性判据；纯观察不得暂停、改写或补发流，也不扩散私有推理内容到报告。任一前置缺失停止，不自动启动模型补证。

**10轮后的唯一分支门槛。** 原10轮与其恰一次后继须先完成机械、来源、原文字节、首业务后继覆盖、费用及未知项、原生终态与清理审查；主体集合未闭合时依验收§5.8不发送后继。允许进入20的必要条件是上述证据通过，且独立原文核验未发现授权/事实越界、错误否认已交付、虚报全部完成或其它实质误导。本次调度另要求第10轮作者明确的核心四场单/双视角收益、风险与可观察补证已经实质交付，允许充分适用的共同材料而不要求24独立格或重复排版；核心缺项即使诚实承认，也停止本次20开跑。额外模型真实承诺、未决选择及待验证状态可按来源诚实保留，不要求全部创作目标关闭；若这些仍未完成，单列相应partial，不将准许下一步改称全部语义PASS。这是本次节约成本的调度门槛，不修改原20场景第11/16/20观察真实缺项承接的验收目标，也不倒签旧10。无法区分诚实欠项与错误判断时停止分析，不以未知当通过。既知语义错误再现而无新增根因证据时停止，不以20更长上下文赌自行纠正；停止后不得追加解释/纠正作者输入或自动另跑10。

**有条件的唯一20轮。** 满足前项并记录独立审查结论后，另起原隔离快照和新会话完整执行原20条，不能从旧第16轮继续，也不能把新10轮历史接入。主体闭合后仅一次原预注册后继，后继新维护单列窗口外未证、不递归追加。20的前10轮不代签独立10轮尾checkpoint窗口，C8的控制输入也不代签普通后继。原20/旧10失败报告不覆盖；低压3轮旧证据保持原版本范围，本计划不声称当前HEAD完整3/10/20矩阵已通过。

**事前独立语义口径。** 复用§14.40正反判据，先依据冻结作者原话及实际历史来源审要求/承诺/建议/未决/未知的性质，再核模型回答；本次1–9轮实际模型承诺须在审第10轮前按原文时序登记，不能拿旧批模型内容作新批预期；同语义不同排版不改变交付结论，真实模型承诺仍保留但不冒称作者要求，可选手法不自动必需，已替换选择不强制兼容，范围外未知不自动成债。“未闭合讨论事项”允许列选择/假设/边界，不能统称欠交付。没有强制文学答案、固定关键词或格数oracle。本计划只冻结离线审查口径，不另跑对照模型；若未来需真实对照，须独立预注册输入/预算/停止条件，不能临时塞入原20或借对照代签。

**失败停止与证据边界。** 现役driver遇技术失败、预算耗尽、错误归属或无法继续的页面状态即停止；不延长360秒、不补输入、不自动重试。记录原始HTTP状态/SSE字节及结束标记、pcall/prun、产品chunk/终态/用量、各调用与维护耗时，区别整轮预算耗尽、wire静默、未终结流与已终结空内容。失败调用与未知费用全部保留，raw观测缺失则原因继续unknown；新批原因不能倒推旧14原因，失败usage修复不等于空响应修复。清理仅限owned资源，单列业务/维护/后继成本和窗口外未证项，机械与语义分别报告。此设计没有启动新批、没有签R03完成；后续实施与实际运行仍须满足全部前置。

### 14.43 普通窗口透明传输取证与失败早停（2026-11-18）

先af184544冻结验收§5.10并独审，再复用现役provider proxy/runner/ordinary driver与原测试六文件。普通10/20明确observe、C8保持gate、ready.mode严格匹配，不偷置C8 flag；observe拒window/arm/pause，不解释/改写SSE，原字节留received/delivered，安全响应status/type/encoding与分块累计偏移时序、所有终结/中断partial hash可查，无认证头/cookie/query落盘。GET snapshot为同事件循环只读hash副本；自然HTTP complete与写入尝试不代签协议终结/产品消费，仍须原SSE及chunk/Output独立核对。

技术failed或身份未绑定立即停止原序列，不再像旧批14失败后继续；合法gap/ask不由driver伪作语义失败，未闭合交换仍不得后继。错误时先现役只读事务事实、日志前缀和proxy snapshot，再uiComplete/owned清场，runner异常退出沿同一入口补证，不新建第二快照owner。独审发现目录已建但receipt未写可能silentreturn，已先反例后修：保留旧片段，写独立较晚incomplete receipt并报缺证；正常receipt标ordered_non_atomic和开始/结束时间，不冒充多源原子快照。fetch2秒有界，本地只读DB无重试循环、finally关闭；不承诺磁盘故障下硬实时总时限。

证据observe-transport-32：proxy红例到18/18，原C8回归、完整空流/合法正文、无DONE/半帧/非法JSON原样保留、同块终止/压缩/大record、背压清理与凭证哨兵均覆盖；runner/driver先缺接线和technical failure/unbound反例后54/54，中断receipt另红绿driver37/37。完整native/model-contract/driver/toolchain Node1205/1205、0跳过，bash-n/diff-check及独立最终审查通过；原82WIP哈希未变。此为外部观测与接线证明，尚未开新实模，也未证明模型语义或普通10/20完成。

### 14.44 唯一普通10及固定后继实证：机械通过、语义停止20（2026-11-18）

先独立preflight成功再启动observe-native-33/native-10-01，冻结5091bdb7、原82WIP/index、原snapshot/输入/模型预算，Finder前台/AC100%/端口空闲；新manifest只换批身份及证据目录，数据seed并非旧源码。唯一job wc_job_0NEEnewFQA459uLO完成exit0，原10条及一次固定后继齐全，未再跑C8、未开始20。

停机DB独立核主体5CP与封窗集合相同、无迟到；从全部业务started事实独立选真正首请求5/5覆盖，末CP由固定后继首调用覆盖，所有capsule清空。11作者字节与原seed内容、6CP来源/响应hash/双ID绑定成立。机械报告SHA6271b6a5eddd744577b3a94ad2aba43c219c5a6b8bc48537275de49cc3b78517、来源绑定SHA73530d85c8c9282f5cfa8b0e76b0d576a2dc344c681f6987f1bc683351f8a264。后继新1CP属于窗口外未证，不再加观察。主体10业务+5维护，后继1业务+1维护，17调用usage全知，总input272482/output44711，cached114656属input子集，不能重复相加。06:10:42.145Z cleanup remaining=[]，四端口与owned PID均清、82WIP不变。

独立raw传输审计SHA20c2451cf4652c245c7d7962fd7acebfafdb6e9e4eb78ebf6f12c37973b1e3ea：44请求中27模型列表GET、17POST，全程observe零gate；17流均HTTP200自然完整、恰一DONE/stop且无残帧，received/delivered共9,561,436响应实体字节逐字/hash相同，不称TLS或HTTP framing字节。按原body、唯一执行时间区间、双ID/scope配对，非hash-only猜；独立解码正文SHA均等持久Output，18,396个产品chunk末累计长度对应，全completed/ok。原summary仍硬编码raw_sse/not_collected，保留不覆写，以独立原件审计纠正范围；报告owner须另修采集与核验分责，不能见bin即倒签全部通过。

语义先锁本批1–9真实承诺登记SHAe3e5978aba7b5676a101ca258767b3265ae6bbfb25f0e9cd2821862c27c8e501，再审10/后继。10 canonical44/run_mwlpy3ts_bij实质交付四场单/双收益、风险与可观察补证，允许合理共同材料，不要求24格。后继49/run_mwlq0h26_djm明确承认风险表已给，却把第二人选比较改挂为“结论性比较未交付”，依据仅“不是加权排序、不能替你决定”。独立两次回查seq12/34原承诺为逐项比较，seq44已分别给四场孟/珩收益风险及目标/代价/场景优势，未承诺加权排序。实际后继pcall_mwlq0h32_djp message23完整等于44原文，因此不是摘要漏源；这是完成条件漂移与交付/作者选择混淆，不是风险表整体被否认。未决定人选可保留，但不能因此重挂已给比较。语义报告SHAca02d2600aa563727c8e26939672e4309c27d9f753a955e02fd6b03e26d570aa，严格§14.42不晋20；没有追加纠正输入或另跑10求绿。

亲看10/后继、历史原文橙框定位、刷新后展开恢复四图，Markdown与真实页面状态正常；视觉报告仅证可见状态、不代签语义。R03保持doing：当前普通10尾首后继机械缺口已补，旧10partial/普通20失败原样保留；本批无空响应并不能倒推旧14原因。下一步只做有证据的责任分析与报告修复，不能靠提示词加码、模型反复试跑或放宽判据宣称完成。

### 14.45 传输采集与核验报告分责，保留真实语义阻塞（2026-11-18）

先1c2a254f修验收§5.10再实现现役capture IO、batch evidence及log-local evidence：当前批次报告v2，历史v1不覆写；按本批ready/request库存和受限原件路径区分not_collected、collected_unverified、collection_incomplete，字节/身份/SSE/产品核验均独立not_evaluated。不读人工独审报告来自动签PASS，不新建解析器或完成台账；已合法封存的partial响应可以采集完整，不能等同采集缺件。原日志分析只描述LLM日志local scope，不冒充整批原件不存在。读取异常仅ENOENT按缺件，其余权限/IO错误归采集缺证，符号链接及越界拒绝；HTTP数值明确响应实体字节，不称TLS/framing。

证据transport-report-34：原capture IO红33/2到绿，EACCES独立反例补正，邻owner120/120；全部native/model-contract/driver/toolchain Node1210/1210、0跳过，独立最终审查及diff-check通过。33原报告未改；首次独立out重算仍因SQLite只读连接在原目录创建-shm32KB/-wal0B，全目录hash检查抓出后立即停止，未宣称无副作用。核无打开DB且确仅两新文件后移动到derived归档保SHA/receipt，原258文件集合及hash恢复，真实DB/summary/driver从未改变。随后只原report副本+库存纯summary派生，不再开DB，前后258文件全同。

独立derived-33-inventory-only/derived-report.json把44请求标collected_unverified，四项核验not_evaluated；原机制PASS只是引用原执行报告、不是此次重新验证，真实语义partial/不晋20明确。执行HEAD5091bdb7与分析HEAD/源码SHA/未提交diff SHA分列，不把新分析器版本冒作原执行版本。旧summary的not_collected原样保留，与本批独立raw审计分别理解。

额外完整输入责任链核查SHAa06c2d5248f7d8fcaf6ea3ba01c9d0a9fc58a6759163ae21528c9a4ec21c1e13：原1把第二人选列未决且不需立即决定，原3模型已自行挂为欠比较；摘要忠实保留并有历史来源/authority:none，原8完整保留搁置限定，10最新实际交付也完整可见；system确有v4，scope未新增排序要求。不能说输入完全没有旧模型误导，但未证代码制造排序义务。49首次将完成条件升级为结论性/加权排序，证据支持模型未正确更新历史责任，而非足以再改投影或加规则宣称解决。20保持未启动、R03仍doing；此后无新的模型试跑或判据调整。

### 14.46 保留片段中性投影与下一研究的责任边界（2026-11-18）

**目标与新证据。** 愿景§2.1要求诉求跨轮存续，§2.4明确证据绑定不替代语义质量判断；VS-00L§16区分信息保留、实际交付、作者选择及执行授权。批33输入足够仍出现完成标准漂移，不能靠追加规则或无来源状态修复。独立源码审查另发现可确定的表示缺陷：DiscussionSummary.projection/2把v2任意保留源片段统一命名retained_obligations，Projection.discussion_text/2直接序列化到真实模型请求；来源/字节验证不支持该类别判定。这不是未被消费的命名问题，也不是已证明的33排序根因。

**有界设计与版本。** 按VS-00L现owner将临时展示字段替换为retained_source_fragments，当前v1/v2统一中性；保留原文、source/locator、顺序与authority:none，不推断完成或待办状态。v1历史原response retained_obligations及hash/严格读取不变，v2原response和行索引不变，不造旧请求、不释放来源。无持久协议或共享语义规则改变，不升原response/AuthoringSemantics版本；真实wire渲染、历史恢复/replay与测试随当前投影同步，不增加兼容别名同时输出旧义务标签。仅现役源解析/展示及其消费者，禁止新prompt段、ledger或评审模块。

**独立反例。** 分别用已交付说明、可选建议、作者未决选择、模型真实后续承诺作为被保留原片段：四类都必须保留精确字节、来源与顺序，当前展示均无retained_obligations分类，不能因中性化删除真正承诺。以合法历史v1逐字引文与v2连续/非连续源片段走真实三wire，原响应hash及canonical不变；缺源/错误引用依原契约失败关闭。测试只证明不附加类别与接线，不以关键词或四类样本通过宣称模型正确理解。原承诺明确排序而只给比较，仍可能欠交付；只承诺比较而已给条件差异，不因未替作者选择重挂；作者后来新增排序按新责任处理。这些是独立语义审查判据，不写成硬编码oracle。

**五方案取舍。** 首选现来源/时序/版本架构并修中性标签，不建立语义状态权威。结构化claim加责任/交付refs可改善审计，但正确引用仍可推出错误欠项，无独立消费者不产品化。有界独立review若研究应复用AgentRun预算/取消/trace，现planner协议纠正不能偷偷变文学裁判；同模型相关错误、误纠正与额外费用须测量，不能称确定性保证。作者裁决偏好与采纳，不应被迫逐轮确认明显的交付历史，不能把认知负担转回作者。模型能力/上下文消融可另行预注册小预算诊断：固定同一事实与任务，仅比较标签等明确变量，含真缺项/原承诺排序的负对照，盲审误挂与误销；不借改变上下文或模型代签原R03。此节不授权立即调用模型；任何后续实验先冻结输入、次数、费用、数据目的地和失败停止条件，禁止失败后追绿。

**七问/存在性审核。** Contract=愿景§2.1/2.4及VS-00L§16中性展示；Invariant=来源字节与历史身份不变、保留不等于当前义务；Boundary=DiscussionSummary派生projection与现Projection/wire/replay消费者，不改响应契约或持久状态；Consumer=真实业务请求中的历史展示；Proof=上述四类源片段、v1/v2及真实三wire的独立反例；Acceptance Driver=确定性接线只证标签责任，未来真实语义验证须另按冻结计划；Exploration=复用现source/locator与历史原文，不新增查询循环或第二正文。无需新实体/模块/存储/协议，仅替换现役展示键。批33语义partial、20停止与R03 doing保留；设计实施成功也不证明排序漂移解决，不覆写旧实证。

**本轮实现与验证收口。** 设计b410ca45之后，仅修改现役DiscussionSummary派生展示键与私有helper名称、common compaction测试；当前v1/v2统一retained_source_fragments，不保留旧展示别名，不改v1原response字段/hash、v2索引协议、canonical/capsule或AuthoringSemantics版本。四类literal源分别覆盖已交付说明、可选建议、未决选择与真承诺，逐一走v1/v2和三真实wire精确map，来源/locator/原字节与重复历史投影不变；连续/非连续片段既有断言保持。原application持久摘要、恢复及CP3消费者继续通过，不新建执行。

证据`artifacts/model-contracts/b87-r03/20261118/neutral-projection-34/`：baseline compile通过；先红24例2失败，再绿common24/24、application35/35；独立最终源码审查通过。完整门禁job wc_job_xtQvxMDYCAhGPk6t退出0，核full-mix-check.log合计3408 tests/0 failures；I1 4/4、I2三对disjoint、I3 3/3、N-NARR PASS、Credo773文件无问题、NEXT检查通过。

按AGENTS执行`bash scripts/ai_static_scan.sh --top 10`，job wc_job_7tTWSvn-ocGEBKqs退出1，21项中19通过/2失败/0跳过、7 findings；完整日志及top10/disposition/report已归档该目录static-scan。剩余六项gitleaks沿既有处置：Pencil元数据、确认fixture历史标识、RFC示例nonce、B63历史spec文字、E10 spec标识为五项false_positive；ProjectGod历史config为一项accepted_risk，不改原WIP、不重写历史。另一项task-done-manifest仍pending，引用旧20261115清单及当前test_touched，真实UI/模型语义未闭环，不能制造新完成凭据消警；本轮不签全扫描绿或R03 done。无新增本次两源码文件发现。原82 WIP逐项SHA与批26基准相同、暂存区检查为空后仅纳入本轮文件，不push。未新增实模，批33语义partial及普通20未启动保持；中性分类修正只证应用不附加义务标签，不证明模型能正确更新责任或排序漂移已解决。

### 14.47 R03 语义验收范围与批33归因的前向澄清（2026-11-18）

**为何验长对话。** 最早计划9a0574fe只要求旧Scope派生去冗余与3/10/20增长反例；0391725c系统重审后目标扩展为旧Scope及纯讨论覆盖，用户效果已明确“仍能回应跨轮未解决问题”。§14.1及现VS-00L§16.2.1进一步要求整理后实际续行/未解责任连续性的独立语义证据：引用合法、原文字节未改不等于摘要没有漏掉承重信息。这是整理机制对创作连续性的证明，不是要求模型所有一般推理、文学质量或任意后续判断永不出错。

**批33已证与未证。** 四场是固定讨论测试故事的码头、修钟铺、旧灯塔和潮汐档案馆，不是作者真实作品的四场正文。第10轮canonical44实际给出单/双视角收益、误导风险、可观察补证，并给孟迟/阿珩第二视角逐场及跨场比较；后继canonical49也明确承认风险表已交付。另将第二人选比较因“不是加权排序”“不能替你决定”列为未交付，原承诺并未要求排序或代作者决定，这是实际续行判断错误。该后继真实首业务请求完整包含44，主体checkpoint来源覆盖已独立通过；目前没有证据证明这个错误由摘要遗漏或压缩造成，也不能排除材料展示等影响。它不能单独成为“压缩机制失败”的因果结论，更不能据此继续无证据改产品代码。§5.9所针对批26“原文已有、节选省略”的因果材料与本批不同，不相互代签。

**调度停止不等于永久门禁。** §14.42在本次开跑前冻结了10轮后如实交付及无实质误导的省成本分支门槛，所以本次不启动20符合预注册；该规则不自动变成今后所有20轮或其他B87任务的永久前置。原33 partial、旧20技术中断及未执行17–20轮、当前HEAD尚无完整3/10/20矩阵等证据原样保留，不倒签。当前R03尚不能完整PASS，依据是其完整必验范围尚无齐全的实际证据，不能简化成“模型有一般推理错误所以压缩失败”。后续若提出新的验证计划，应前向冻结整理前后连续性、来源/信息是否改变、模型自身判断及未知归因的分层判据；不得追溯改写本次停止事实，也不以一次普通模型错误代替机制归因。

**研究取舍与独立推进。** 中性源片段展示修复80c4bd04已经确定性验证，但没有宣称修好33语义。独立审查决定不为四个探索性单样本新建原始请求重放分支/合成来源链：既有前缀probe并非同责入口，当前无经验证的同模型离线tokenizer以冻结严格输入费用边界，四次采样也不能代替R03验收；不新增模型调用，不以堆提示或新义务账本追绿。按NEXT复核，B85窗口设置设计可独立推进，其执行状态仅在B85原任务维护；R04等仍按自身依赖审查，不以本澄清宣布前置已通过。

### 14.48 回到应用研发职责：R03 前向签收修订与证据核账（2026-11-18）

**作者纠正与目标。** 作者明确“我们目前 b87 是在做什么……研发一个应用，不是在测试模型能力”。愿景§2.4规定APP提供可信事实、工具与边界；B87§4中R03负责旧Scope/纯讨论显式覆盖、Checkpoint与恢复，R04负责三wire无重复派生，R08负责讨论/修订/执行判界，R18–19做产品整体质量。此前把充分原文下的后继排序误判作为R03阻塞，再转向模型能力研究或以B85替代主线，偏离了应用责任。§14.47只解释归因仍不足以修正执行门槛。

**本次生效边界。** 同步修订VS-00L§16.2.1、R03任务卡及现役验收§5，明确取代§14.1末句的泛化跨轮义务签收和§14.42对今后工作的适用性：独立核摘要承重信息保真、真实请求/工具回流与生命周期，不要求故事比较、排序或一般推理全对。来源信息被整理抹去、错误附加权威或义务性质仍是应用缺陷；原文可回查不能替失真摘要免责。正确充分材料已进入请求后模型自行误判，仅列质量观察与归因，不单独否决应用机制，不据此堆提示、新台账或评审循环。真实模型调用与后继集成证据继续保留，不用回答正确或mock代替；旧预注册、停止和失败原件不改签。

**现有应用证据。** 批30（eb427953，§14.39）C真实取消、请求审计与停机无迟到提交；D持久失败checkpoint 11→11，跨BEAM59704→87739用原响应/plan恢复、同源仅一次模型执行及唯一提交，独立末态DB复核成立。批33（5091bdb7，§14.44）普通10主体5CP各首业务请求5/5覆盖，11作者原文字节、6CP来源/hash/双ID、原文定位/刷新与真实观察回流有证据；后继另1CP在窗口外未观察，不递归加后继冒充已证。三wire/非法身份/损坏/重复等已有确定性与持久边界反例，不能冒称三家供应商全实跑。中性投影80c4bd04经三wire及后端3408/0验证，不能冒称新原生模型判断改善。

**仍缺与正确下一步。** 普通20第16轮整体预算耗尽、17–20未执行，完整普通20与当前版本3/10/20矩阵仍缺；C8的20+5不能替代普通20增长验证。先逐项核缺的是覆盖/压力维护/请求增长/恢复的哪个应用不变量及当前源码差异，再复用现役入口补最小必要集成，不先重复故事题或建设能力对照系统。批33后继已完整得到第10轮原文仍另加加权排序条件，保留其partial质量观察，但不是压缩漏信息的既定因果。R03继续doing，R04现有PASS前置不绕过；只有按修订应用契约完成核账才作新的签收，不倒签旧批。

**工作优先级与现场。** 暂停B85后续原生验收和非必要验收基础设施扩展，保留其已实现/已测代码、正式构建和全部WIP；B85是独立产品候选，不再替代B87主线。当前只做上述应用证据核账与契约一致性；本修订没有新模型调用、没有启动App，不宣称B87/R03或B85完成。

### 14.49 R03 应用分层证据与当前 v2 规模补证（2026-11-18）

**范围核账。** R03任务卡的3/10/20是长历史下合法覆盖/保护/保真/恢复的应用规模矩阵；R04任务卡唯一目标及步骤4才明确承担同事实去冗余、稳定前缀、三wire顺序与分组字节/Token增长。§14.48列出的普通20未结束仍是事实，但不能未经责任核对就自动作为R03新增硬门。现有普通3低压不误维护、普通10五个主体checkpoint首业务请求5/5、C8真实取消/失败/同源恢复、真实回查与观察回流分别证明不同维度；C8不代普通20成本，确定性20也不代真实模型20。未发现17–20单因轮数增加就独有而尚未触达的应用状态；今后只有具体未证应用分支才触发最小补验，不为成本曲线或故事答对重开R03。

**信息保真独立复核。** 只读批33现有JSON及原LLM日志，不打开SQLite、不改原件：主体5CP（seq25/30/35/40/45）的6条源（seq4/8/12/16/20/24）逐一对照原文、summary和选中行，响应SHA与checkpoint相同；未发现新的明确承重范围/限制/真实承诺遗漏或反向改写。摘要保留的是当时真实未完成比较，不把后来交付删除；seq44与后继pcall_mwlq0h32_djp的message23重算逐字相同，9996 UTF-8 bytes、SHA d0b5470c9d7fb63b56a3a6805eb31c8221f8819e28e725fcc79cc9c3db924b8b。本结论仅限该6来源，不保证未来全部摘要。该批旧retained_obligations标签确属已修表示问题，不冒称新中性标签实跑；后继新增CP仍窗口外未观察。

**当前版本桥接。** application-boundary-35/version-bridge.json核5091bdb7到cac7c76b的已提交R03产品变化仅80c4bd04中性展示键及测试；原41项代码WIP逐SHA未变。当前独立24 common+65 application测试通过，涵盖来源/三wire/真实DB覆盖/运行取消/同源恢复。另有B85未提交工作树，不能把整树冒称旧批构建或忽略其窗口设置变化；桥接是代码与确定性证据，不是一次新的原生执行。

**最小缺口与补证。** 现b81_cp3_session_compaction_test的3/10/20此前只构造历史v1 codec。只在此现文件保留v1并补当前v2同规模：独立DB坐标、当前与最近K保护、作者字节、三wire、JSON恢复及无真实Provider不得准入断言全部复用；两行夹具明确正文/承诺，v2固定选择第1行而非从产品分片器生成预期。旧单行夹具下v2的10/20因越界索引先红2，明确两行后定向/相邻69/69通过；这是夹具边界反例，不声称发现产品bug。format、diffcheck、module-size通过，无产品改动/新模块/新模型调用，证据current-v2-scale-35。

**签收出口仍分开。** 应用机制/信息保真、真实集成、版本桥接与模型质量观察不混签。当前全工作树task_done还包含B85等UI变更，要求fresh原生证据；旧R03截图不能代签整树，也不能touch原件、提交未验收代码或修改规则绕过。故此处不虚报全门禁绿、不直接改R03为PASS；普通20原失败/未执行保留为成本实验缺证，后续按R04职责处理。B85现场仍保留，未启动其原生验收。

**本轮最终验证。** 全量`MIX_ENV=test mix check`实际3413 tests/0 failures，force compile、codegen、xref、架构/ADR与I-CACHE通过；Credo773文件无问题。完整`bash scripts/ai_static_scan.sh --top 10`为19pass/2fail/7findings，本次窗口客户端模块规模问题已按职责拆分消除，未抬阈值。剩余为五项既有gitleaks误报（Pencil元数据、确认fixture、RFC nonce、B63/E10 spec标识）、一项ProjectGod历史config accepted_risk及全工作树task_done_manifest pending；不改历史/规则/处置台账，也不补造UI完成文件。日志与原report/top10/disposition归档application-boundary-35/static-scan。仅本轮测试和本节按review粒度提交，其他WIP及暂停B85不夹带；无push、无新原生或模型试跑。

### 14.50 工程出口归责机制修正，不以无关验收替代 R03（2026-11-18）

**根因与设计。** 对照愿景的可信来源/责任边界、项目画像的适度工程及本协议“本批唯一目标”，现 task_done 把 diff HEAD+untracked 等同任务是单任务独占工作树假设：混合 WIP 会误归责，提交后 clean 又可能直接免证。历史 ec0958cba 防漏页面验证，1dc8a419 修测试路径误判，f02b5f95 强化同 slice 身份，目的均是准确证明，不是无限扩大任务。只读比较后不为 R03 造隔离重放框架，也不把 B85 七次 release 启动场景当 R03 出口；B85 的双 profile 仅局部范围且原 summary 不满足通用证据契约。

**前向机制。** quality-gates §2.3.1 先冻结任务基线、增量、完整 Git 可见受测身份及反例，再在现 task_done.sh/check owner 修正；仅抽 task_done_identity helper，真实消费者仍为现完成入口/静扫，不新增任务状态台账或产品 hook。机器前置基线→候选覆盖跨提交/并行变更；原 WIP 保留为环境不冒充本批。执行前后指纹、同 scope/slice、summary/log/native-ui-complete/failure 身份无条件核对，full/quick/skipped 在开始冻结；running 仅同源嵌套预检，失败/quick/skip 不签完整工程执行。Git 可见源码不冒充 ignored 配置、bundle 或外部依赖验证；工程结果不自动签任务 DoD/full matrix。B87 共享协议及既有脚本索引同步迁移，不接受自由路径排除或 R03 特例。

**验证与真实失败。** 独立临时 Git、CLI 与 Shell 接线23/23，包括提交后 clean、混合/并行 WIP、删除/重命名/模式/mtime、ignore集合变化、symlink父与文件类型拒绝、缺基线/Git失败、运行漂移、旧输出/错slice/篡改证据、running、quick/skip、失败文件删除不能变绿。初次CLI初始化TDZ及fixture临时路径别名失败均保留，修复后复跑；独立复审要求并完成扫描模式前置绑定与失败sidecar封存。主线程独立重跑23/23；语法、diffcheck、module-size通过。完整静扫仍19pass/2fail/7findings：六项既有gitleaks处置原样保留；task-done明确scope/manifest缺失，不再把整树WIP或clean状态偷换为任务证据。没有补造本轮/历史开始身份以取得绿灯。证据task-scope-gate-36及artifacts/slice-verify/task-completion-owner-20261118。

**重新核账。** §14.49的R03应用证据、版本桥和当前v2矩阵继续有效，批30/33及普通20原失败/未执行不改。已纠正“无关B85 UI必须为R03重新全验”的归责机制，但这不产生一次新的R03运行，也不补齐历史执行身份。R03仍doing；现阶段剩余是有来源的工程执行绑定与任务覆盖核账，不是继续考模型故事答案。B85及所有原WIP保留，R04仅做过只读设计调查，未开实现；无新App、模型调用或push。

### 14.51 历史证据合法延用与当前交叉依赖核账（2026-11-18）

**不追溯否定真实历史。** 新scope约束今后执行绑定，不因旧30/33没有新schema就抹掉原run、请求、原文、源码及DB事实。独立审查确认30的准入/来源执行权/HTTP取消/事务恢复owner未改；6d6a47a0取消路径是原observed_usage提取，新增失败usage有真实TCP及持久化反例。33→当前已提交产品差异仍只是中性展示键，原响应/索引/canonical字节不变。因此继续用旧真实证据＋具体版本差异测试，不重新考故事或整批重跑C8。

**补全此前分列的B85依赖。** WorkspaceChat整文件确实增加import与设置子组件，但只有模型设置弹窗打开且provider有效才挂载，R03整理/原文定位显示路径未改；不称整个UI未变。Rust偏好读取/写入及ContextPressure确实变化：合法默认/正值覆盖保留，非法内部窗口明确失败，不用默认伪装。30/33的原runtime-facts实际都是splash窗口32000、压力比0.7/0.9、keep4；报告中另一个262144字段不是该实际运行窗口。当前测试直接证明splash默认32000。正式构建02的590项源码与当前逐hash一致，前端8文件冻结对应536测试、Rust源c8243bfa对应22测试；不冒称这些构建/单测是新原生启动，也不签B85完成。

**当前有界实测。** 新建真实“当前应用验证阶段”scope，明确不是历史实施scope，不把旧summary贴成新绑定。运行10个当前相关测试文件，覆盖三wire/当前v2规模、摘要/运行/恢复、源回查、窗口解析、Provider活动/HTTP与options边界，共126 tests/0 failures；执行前后完整Git可见指纹一致，日志hash保留。新scope只有当前验证与后续本节记录，不追溯自动覆盖旧任务增量；每项R03 DoD继续映射到原真实证据＋当前差异测试。

**证据与边界。** 补充桥接为application-boundary-35/current-dependency-bridge-14322406.json；当前实测scope/application-result/log在artifacts/slice-verify/b87-r03-current-application-20261118。本轮没有发现必须新增模型或原生长跑的应用状态缺口；普通20成本缺证仍归R04，批33质量partial和B85未验收不改。当前工程完成入口仍须完整执行并保留既有gitleaks等实际结果，不把源身份成立等同全局绿灯；R03状态不在本节自动改PASS。

### 14.52 R03 应用 DoD 前向签收 PASS 与 R04 交接（2026-11-18）

**Outcome：PASS（本次R03应用范围）。** 依§14.48已生效的应用职责和§14.49–14.51逐项核账，独立审查未发现剩余具体必选应用状态缺口。该判断不是仅凭task_done绿灯，也不是把旧33模型quality改判成功：合法覆盖/保护/三wire由当前v1/v2×3/10/20矩阵及真实主体请求消费证明；Canonical/来源/信息保真由原33逐源独审与原文回查/观察回流证明；取消/失败/同源跨进程恢复由原30真实C/D及当前变化反例证明；原生显示/定位/刷新证据经具体源码与B85交叉依赖桥延用。当前126项应用验证及此前同源全套3413/0、前端536/0、Rust22/0分别承担其实际范围，不冒称一次全新原生/Provider执行。

**工程出口实际结果。** 当前验证scope的真实task_done完整运行退出0，manifest状态completed，仅声明工程执行身份。静扫原始检查为20pass/1fail/0skip、6findings、blocking=0；gitleaks的5项false_positive与1项accepted_risk按现有ai_static_scan_report既定处置规则非阻塞，不是本轮改规则、降低标准或抹掉发现。此前把这些已处置发现也当作当前硬阻塞不准确；未闭合的是原任务身份，此处已用新的真实当前验证阶段补上，不追造历史实施身份。首次完整记录为artifacts/slice-verify/task-completion-20261118T090041Z-88115/manifest.json；签收/排期文档变更后仍沿同scope复跑完整入口，最终日志与receipt保留在b87-r03-current-application-20261118，不手改旧manifest。

**保留限制与后继。** 原批33模型质量partial、普通20第16轮中断及17–20未执行原样保留，普通20请求增长/成本测量由R04承接；B85未完成原生验收、B87/Issue#4未完成、R04尚未实施。下一批必须以新独立上下文读取共享README、R04任务卡、VS-00M及本节，先审当前有效Scope/不可变历史/三wire稳定前缀和实际消费者，再设计实现。既有只读候选“旧run revision9→新run revision1”的最后有效范围表达尚待独立反例核实，不是已证授权bug；不能重标历史或删旧Scope破坏稳定前缀。不在本R03会话滚动实施R04。

**保护。** 本次只补有来源的证据桥、验证与状态/排期文档，不新增产品代码、原生长跑或模型调用；原WIP及暂停B85保持，不push。

## 15. R04 当前有效 Scope 与三 wire 派生（2026-11-18，进行中）

### 15.1 独立开工、目标与存在性审计

新独立执行上下文，基线 `develop/dialogue-based-novel-workbench` / `b79a38bdd41a9721e45ce9afb3eb4c5908af9766`，109 项原 WIP（95 tracked、14 untracked）及暂停的 B85 保留。实施前由 `task_done.sh --begin` 真实封存 `artifacts/slice-verify/b87-r04-scope-wire-20261118/scope.json`，不追造历史 scope。初始 shell 缺 mix/node（127）是 PATH 前置失败；选择已安装 Node v24.19.0 与 Homebrew 工具后 baseline `mix compile` 退出 0；未安装依赖、未读取生产环境秘密。

**独立目标**：作者连续询问时，当前范围由真实会话顺序和当前 run 决定，旧 run 的较大局部 revision 不恢复旧权限；同事实的旧完整 Scope 只有合法 checkpoint 才退出模型视图。未覆盖历史、作者原字节、真实 call_id/观察、已确认义务不丢。3/10/20 成本按 R01 原始 wire 口径可复算，缓存只证明前缀字节，不从 cached_tokens 推断权限或质量；真实页面/实模与确定性证据分别签收。R03旧33 quality partial、普通20第16轮中断/17–20未执行不改签。

| 七问 | 本批执行边界 |
|---|---|
| Contract | VS-00M §5.4；VS-00L §14/16.1/16.2.1/19.2；VS-00I；R03 §14.48–52 与 R01 §11.21。 |
| Invariant | 当前权威范围唯一、历史追加不可变、仅显式合法覆盖可省略；三 wire 同序同来源，跨 run revision 不作全局排序；稳定前缀、作者/工具字节与恢复/Replay 无假执行。 |
| Boundary | application SessionHistory/Judgment 请求组装与 common RequestIR Scope/Compaction/Projection 既有边界；按实际反例决定修改，不新增持久历史、Provider adapter 或前端协议。B85、原 WIP、生产配置与作者数据库禁止改动。 |
| Consumer | JudgmentProtocol.request_for_production/实际 Provider.Execution → 三 wire；AuthoringSession 的同源恢复与现役成本报告。 |
| Proof | 旧 run revision9开放→新run revision1关闭；同run更新、交错/错作品/错版本、合法与非法覆盖、工具闭合、CRLF作者原文、JSON恢复/Replay、3/10/20分组字节/Token与I-CACHE。期望由独立顺序/来源构造，不从projector反推。 |
| Acceptance Driver | 复用 native_request_cost 与 R03 现役外部Tauri驱动；先核旧证据和当前差异，仅对具体缺失应用/成本状态预注册必要实测，不无界重跑故事质量。产品不新增验收感知逻辑。 |
| Exploration | 不新增作品要素；已有真实Observation必须保留call_id/source/coverage并进入后继请求。知识读取仍走现探索面，不增加固定packet。 |

| 候选责任对象 | 现有 owner / 首个消费者 | 审计决定 |
|---|---|---|
| 会话顺序/归属 | AuthoringSessionHistory.compose → JudgmentProtocol | reuse；只派生当前Base一次、已提交原序与尾部，禁止第三份历史。 |
| 合法省略 | TranscriptCompaction + MessageCoverage + Compaction → 三wire | reuse；已支持旧Scope与讨论精确覆盖，未证明不足前不另建压缩器。 |
| Scope显示 | RequestIR.Scope/Projection.scope_update_text → 三wire | 调查中；现header“以最新版本为准”未明确局部revision与消息顺序，先做独立反例，不当作已证授权漏洞。 |
| 成本与原生证据 | request_cost_* / native_request_cost_* | reuse；不建立第二分析器，不把估算token当供应商实测。 |
| 新实体/字段/表/工具/API/事件/配置 | none | reject；当前目标未证明需要新持久/权威对象。 |

成功标准保持 R04 全卡，不以小修或局部绿灯代签 PASS。具体反例、设计先行修订、执行与失败在本节续记；当前尚无产品变更或新模型调用，R04进行中。

### 15.2 当前反例修复与唯一普通20成本预注册

**已证反例。** 真实DB保存A关闭范围，再保存较晚活动B开放范围；A局部材料不变而公开生产入口先refresh后compose，实际IR最后Scope仍为B。新增测试先红（10项/1失败），证明请求表示责任缺口，不宣称执行授权已被绕过。统一实际request与request_for_production到现私有request_transcript，先构造/作者→恰一次compose→当前材料/归属refresh；外run末Scope即使内容相同也追加当前run声明，不改历史或额外存状态。通用段构造接口仍不带显式历史，真实会话准备与持久段分责。common renderer统一说明后继更新优先、数字不跨run排序，既有revision生成不变。两个真实DB反例覆盖相同/相反内容、恢复幂等、三wire前缀与显式/预组装视图等价。首次全mix check发现段构造接口误带历史的两项回归，已按原持久边界修复而非改测试；邻接117/0，全量复跑3415项/0失败（mix-check-02.log，退出0）；编译/codegen/xref/arch/ADR/I-CACHE均实际通过。独立review未发现当前阻断问题，局部测试不代签原生。

**成本候选排除。** 批33第7–10轮虽各5个Scope、总Scope每轮增3500B，实际单Scope增700B来自作者处置/结果/引用元数据。上游InteractionLifecycle明确窗口10，旧普通20第11–14单Scope8833/8836/8837/8837B已稳定；不是无界增长证据，不删仍有消费者的元数据。当前无新压缩器/截断策略，合法历史仍只由checkpoint覆盖。

**必要新证据。** 冻结 `artifacts/model-contracts/b87-r04/20261118/cost-01/manifest.json`：只执行一次独立普通20，采用原R03二十条输入和原hash、完整隔离快照，Splash local/Q4-PLE4、thinking enabled/high、max_tokens32000、HTTP300000ms、每作者整轮360000ms、重试0；维护窗口32000/0.7、keep4、同步摘要false。观察实际20轮及第3/10前缀，不冒称三个独立当前批次；不重复3/10或固定故事后继。旧3/10凭真实来源与明确版本桥延用，因header变化不能称旧Token是当前Token。原16轮中断和批33partial保留。技术/身份/页面失败或整轮预算耗尽即停止、不补轮不重试；模型故事质量单列观察，不用于重开。实际逐run调用预算和供应商用量照实记账，没有凭空声称总金额上限。

**测量边界。** 沿现request_cost owner输出每call分组UTF-8 bytes、stable JSON/envelope守恒、真实input/cached/output（cached为input子集）、身份及prefix。R01历史3/10/20报告分组Token均not_collected；现无Q4 tokenizer，不能把bytes/4或实际总量按比例分摊冒充精确Token。缺失保持unknown，分组字节与实际调用总Token分别可复算，跨输入/配置历史差额不作严格单变量收益。当前manifest preflight已退出0，尚未启动新App/模型；启动后结果另记。

### 15.3 普通20原始终态、验收消费者反例与复核边界

唯一新原生批次在 `artifacts/slice-verify/b87-r04-scope-wire-20261118/native-20-01`：20/20界面轮次completed、39次Provider调用已终止，无追加后继或模型重试。原报告仍为FAIL（31/37），原failure.json和绑定不改：第16轮call3/5、第20轮call3被判作者缺失，all_llm_calls_bound为36/39，独立compaction preservation与后继Scope覆盖检查失败。原始HTTP/SSE采集不等于独立核验；未以模型故事质量解释失败。

**来源核实后再修消费者。** 三个失败均为judgment探索回流请求，不是维护误分类。pcall_mwlxsbkk_lku、pcall_mwlxu5c9_lqv、pcall_mwly52tu_rt2中当前作者冻结原SHA分别唯一命中wire index34/32/44（279/279/369B）；现成本owner跨调用保留第一次绝对index，合法checkpoint使前方历史退出后index失效。修复须依同调用canonical覆盖及作者run/turn/source原序重新定位，不能换成唯一文本或最后文本猜测。另现Scope reader仍只接受旧精确header，实读39日志共109条新header全部scopeContent=null，首调用即失败；这是renderer迁移未覆盖验收消费者，不是已证应用覆盖损坏。已先加正反例18项/1失败，reader兼容新旧两个精确header并拒未知头后，相关67项/0失败。原FAIL不抹去，修复后只允许现owner verify --out另目录离线重算相同原调用，不能冒称一次新原生执行。

**成本独立复算（未修签原报告）。** 同一次20运行第3/10/20前缀分别3/15/39调用，stable JSON为150762/917322/3308070B；input为36051/233604/877580，cached子集30432/117792/297632，output7104/41358/123957。原36调用报告漏计三次实际成本input147185/cached45984/output14271；不得以旧报告汇总替代全39。当前Scope第11–15为8866/8869/8870/8870/8870B，第16–20为8785/8896/8896/8896/8902B；第11后作者9、结果10、来源10，证明本次窗口观察稳定，不承诺所有未来输入。精确分类Token仍not_collected，不用字节比例补造。

**工程出口保留失败。** 首次同scope task_done确实执行并退出1：UI change requires explicit --slice。scope实际增量仅本批6文件，未混入B85；既有isUiRelevantFile路径规则匹配request_ir/projection.ex，故需要合格原生绑定。原生binding已真实FAIL，后续离线复核不能覆写旧summary/failure/绑定来伪签；门禁未完成仍明示。其后WebCodex发生间歇timeout，未知写入先恢复read_revision核实再补缺，没有重放模型或未知执行。R04继续doing，B85暂停、原109项WIP及旧33 partial/旧20中断均保留。

### 15.4 离线真实调用复核与本地修复 checkpoint（非 R04 PASS）

**真实入口闭环。** 作者绑定初版fixture通过但offline-review-01仍漏三次，暴露当前run的history.transcript不能代替会话全序。最终消费现役history.sessionMessages并保留当前transcript.run，使用同pcall/prun截取请求时点、合法coverage、全部作者原序/字节和当前run/turn/work/session/source唯一坐标定位ordinal；缺会话证据、错来源、非法覆盖及错调用配对均拒绝，不回退唯一文本猜测。实际shape正反例与邻接100项/0失败；独立只读审查确认责任边界。作者39/39不替代Scope/工具/讨论的独立核验。

**原始失败不改，另名复核。** 现owner `verify --out native-20-offline-review-02`完整重算同39调用，三作者错误及Scope解析错误均消除，总usage与独立复算一致。独立canonical coverage、全部作者原文、23个业务请求逐项原文/合法Scope/保留讨论、压力、早期讨论覆盖及原文UI成立。最后checkpoint缺后继请求，next_request为unknown、compaction仍partial；预注册没有successor，未追加模型调用。offline02唯一硬失败为原failure.json存在而拒绝native_ui_evidence PASS，这是正确保留原执行结果，不删除侧车或伪造成功绑定。`offline-evidence-bridge.json`核对1046个产品文件与原生执行前hash完全相同；后改仅验收消费者/测试及任务记录。当前只是有来源的离线复核，不是新原生执行或完整工程签收。

**工程实际证据。** 同scope完成入口退出1的原记录保留。另完整执行无scope task_done的全静态inventory（明确不宣称任务完成）：19pass/2fail/0skip，I1/I2/I3/N-NARR/I-CACHE、前端与调度/规模等检查通过；gitleaks仍是既有5条false_positive和1条accepted_risk，未改处置。Semgrep首次因官方auto规则下载TLS EOF退出2；唯一有界重试在连接恢复后由原Job对账为completed/exit0，511规则/2269文件/0 findings，无禁TLS、跳规则或重复执行。原始静扫和重试结果并列保留，不改写19/2报告。全量mix check仍为3415/0，验收消费者focused67/0与100/0另列。证据均在本批scope目录，原生/失败/成本原始文件保留。

**checkpoint边界。** 按授权仅提交本批可review修复与证据记录，混合WIP文件只取本批hunk；不把局部checkpoint当作本卡要求的整批PASS。精确分类Token仍not_collected、最终checkpoint后继请求未采集、原生成功执行绑定/同scope完整task_done仍缺，R04保持doing，不推进R05。B85、原WIP、旧批33质量partial及旧20中断不改签，不push。

### 15.5 R04 应用职责核账与当前验证阶段

按作者“研发应用，不是测试模型能力”的既有方向复核§15.4限制，不从工具输出倒推新目标。R04仍负责同事实3/10/20无旧完整Scope无界重复、稳定前缀、三wire顺序与真实来源保真；原FAIL不改。

**成本口径。** R04步骤4引用R01；R01卡要求“分类精确字节和可得Token”，允许分组tokens为not_collected，§11.21依此签测量PASS供后续沿用。现39调用分类UTF-8字节、3/10/20前缀和供应商实际input/cached/output可复算；原usage没有分类明细，现役没有经验证Q4分组tokenizer。缺分类Token是测量限制，不额外升级为应用硬门；不安装下载或用比例假造。历史独立3/10/20与本次20前缀分列，不冒称严格同输入/配置A/B。

**末项不是新增模型轮次。** offline02的18个next_request中17项真实通过，末1未观察。末项为第20轮run_mwly312p_rmc的seq9 CP（canonical index106），仅覆盖第17轮run_mwlxwtn4_n0n的seq2 Scope及seq4 assistant、call_ids为空。同型Scope+讨论已有前14个真实后继；2个工具覆盖及更复杂第16轮三Scope+讨论也已有19/20轮实际消费，复杂项由pcall_mwly52tu_rt2证明。23/23业务请求原文/合法Scope/保留讨论全真。没有新增未证应用分支，依§14.48–49不因窗口外unknown自动加第21轮；该末项未来消费仍不写成已观察。

| R04应用效果 | 同责证据与边界 |
|---|---|
| 当前Scope、交错run、revision | 真实Judgment请求compose后核owner；两组真实DB同/异Scope反例、旧9→新1及三wire前缀，不宣称曾有执行越权。 |
| 合法覆盖与材料保护 | CP3当前v1/v2×3/10/20独立DB、选择器、JSON恢复矩阵；真实20 canonical审计、23请求无损、17后继。39/39作者绑定不替代Scope/工具/讨论核验。 |
| 三wire、恢复、Replay、缓存 | CP2/CP3/CP4持久段、owner恢复幂等、common投影/压缩及I-CACHE。合法覆盖改变动态历史前缀；原报告3个rewritten保留，不用cached量代证正确性。 |
| 增长与工作台 | 唯一原生20、冻结输入/隔离DB、39调用、当前Scope第11后窗口稳定；精确分类字节和实际总Token；原FAIL、另名复核、源桥及原文UI/刷新事实共同可追溯。 |

**Provider可知差异。** VS-00L§6规定：Chat为system/messages/tool_calls/tool_call_id；Responses直接用input items/function_call/function_call_output，工具身份是call_id不是item.id；Anthropic用独立system及text/tool_use/tool_result块，客户端不合并相邻user，服务端合并/缓存不由机械测试代签。本次实跑仅Splash Chat，其他两wire以同IR、原文/工具闭合和I-CACHE证明，真实厂商行为仍属B82/B71。finite_mode只能显式覆盖实际route缺失能力，否则Gateway拒绝；本批无新增有限模式或静默降级。reader双精确header只读不可变历史证据，不新增产品双协议。

**前向验证身份。** checkpoint50e02d8d后实施源未改。依§14.51既有做法，在本阶段修改前封存 `artifacts/slice-verify/b87-r04-current-application-20261118/scope.json`，只覆盖现在验证和签收记录，不替代原实施scope或失败native绑定。当前实测8个Elixir文件99项、4个验收消费者151项，合计250/250；覆盖三wire、规模、真实DB、owner、恢复/Replay及合法/非法来源。测试前后Git可见delta为空，owned run退出0且清理完成；1046产品文件hash与原生执行前相同。下一步在此同scope完整执行工程入口，不改门禁、不借clean免证、不重跑模型。

### 15.6 R04 应用范围 PASS 与 R05 独立交接（分层证据核账）

**Outcome：PASS（当前R04应用范围）。** 独立最终审查按原卡唯一目标与§15.5逐项核对，未发现剩余实质应用阻塞。当前有效Scope/真实历史无无界重复、合法覆盖、三wire保真、跨run/恢复/Replay和I-CACHE，由原生工作台20轮、原39调用的独立复核、版本桥及当前250项测试共同证明；不是单凭工程manifest或作者绑定39/39签收。原native记录自身的native_ui_evidence、可见结果、20轮完成及刷新事实成立；其验收reader错误已按真实消费者修复，不把旧FAIL改成PASS。

**工程出口。** 当前验证阶段真实完整task_done退出0，首manifest为 `artifacts/slice-verify/task-completion-20261118T132302Z-86514/manifest.json`，状态completed；原始静扫20pass/1fail/0skip，6条gitleaks按既有5误报+1accepted_risk处置，blocking=0，未改规则或处置。这是本阶段工程执行身份，不代签原实施scope/native绑定；签收/排期文档变更后继续在同scope完整复核，最终日志另存。不补造旧开始时间、篡改侧车或凭clean免证。

**保留边界。** 原native20 FAIL、offline02报告FAIL及compaction partial、最后CP not_observed、精确分类Token not_collected、3处合法覆盖后的dynamic-prefix rewritten、旧33质量partial和旧20中断均原样保留。分类Token按R01测量口径不是附加硬门，末CP同型分支已有17个实际后继且不递归加21轮；两者不改成已测。实模只跑Splash Chat，Responses/Anthropic仅同IR机械投影，真实厂商行为仍归B82/B71。本次没有新模型能力考试或新有限模式，没有签B85、B87整体或Issue #4完成。

**交接。** 实施checkpoint为50e02d8d，原109项WIP逐字保留。下一批R05必须新独立上下文，先读AGENTS、project-operating-profile、NEXT、共享README、R05卡、VS-00M与本节，再按愿景→七问/存在性审核→独立反例推进现役Judgment/Explore/专业Task Base；不因为已有代码或R04 PASS就免审R05真实消费者。R06–R09既有开放反例保留，B85继续暂停。此会话不滚动实现R05，不push。

## 16. R05 最小可信 Base 与按需作品材料（2026-11-18 启动；2026-11-19 原生权限阻塞）

### 16.1 独立开工、判据与存在性审计

全新业务会话，基线 `develop/dialogue-based-novel-workbench` / `192a335fa37a3eef79f4a385d422403a073521a3`；109项原WIP与B85保护，不push、不读生产秘密、不管理Splash。实施前真实封存 `artifacts/slice-verify/b87-r05-minimal-base-20261118/scope.json`，`mix compile`退出0。R04应用PASS与原native FAIL、末后继unknown、分类Token未采集等分层边界原样保持。

**独立作者效果**：普通章数问答可用可信计数直接回答，不把目录/正文未读说成零章；质量判断按需取得正文，整章修订必含全章，目标段修订保持范围，既有角色详情可发现/续读，作者文风材料仅按其真实来源使用。作者原文/未完义务不因去重丢失；accepted与tentative不混同。成本只报告可核实际字节/usage，不推断文风变好。

| 七问 | R05边界 |
|---|---|
| Contract | 愿景§2.4、VS-00M§5.2/5.2.2、VS-00L§14–16与VS-00I§4.3；材料责任先修订再实现。 |
| Invariant | 身份/统计不授予正文已读资格；Base/真实观察/作者原话分立，used refs仅绑定实际供应，专业必要基线不截断，历史不重写。 |
| Boundary | application判断Scope及专业输入owner，必要纯DTO/契约与现役验证消费者；不改Provider传输、数据库Schema、前端协议，不新增事实仓库。 |
| Consumer | DialoguePlanningService→JudgmentProtocol实际请求；现Writer/Revision/Quality→CreativeProvider.Real/专业Operation。 |
| Proof | 独立已写/无正文/未知状态、空/失败/partial/跨作/重复ID统计；长角色/候选/历史不默认泄入；完整章/目标段/观察引用与作者原字节单一供给；真实请求三wire与恢复相邻验证。 |
| Acceptance Driver | 复用现役tauri_slice_verify/native_request_cost与既有修订/求证driver，按具体应用缺口选择有限场景；不增加产品验收感知代码。真实模型需先冻结范围/成本停止条件，不能以能力题代替应用验收。 |
| Exploration | 复用archive_read、chapter_read、prose_search、session_adoptions、memory_recall和AgentObservation；来源/分页/coverage回流后续请求，未读引用不升格为已读。 |

| 候选对象 | 已有owner与消费者 | 决定及不足证据 |
|---|---|---|
| 章节最小统计 | WorkspaceContext同事务ReadingProjection→DialogueContext.structured_chapters→judgment_scope | reuse；当前已读取但Scope仅not_read，章数需要额外探索。只供聚合统计，不恢复全目录/摘要/章计划。 |
| 统计字段 | 现facts.work的真实作品身份及coverage JSON | truly-new最小派生字段（非实体/持久账本）；记录总条目、已写/无正文/未知数量及来源完整性，目录与正文仍not_read。仅完整可信集合可称总量。 |
| 角色与历史预览 | CharacterProfile/ExplorationService、InteractionLifecycle/Canonical | reuse；R03已去默认长档案/预览，本批不重复实现；继续核真实按需消费者。 |
| 专业完整修订材料 | AdoptionWorkflow.accepted_chapter_scopes→PendingArtifactWorkflow→AuthoringTaskBuilder/Real | refactor-and-retire候选：同一次真实基线已在facts.materials与context_text重复供给，先独立请求反例再删除重复表示，完整字节及版本仍保留。 |
| Writer作者来源 | TurnExecutionService与Real独立author消息 | refactor-and-retire候选：context_text仍拼作者原文及全DialogueContext，需要核现役消费者，不能删除真实必要材料。 |
| 新Packet/Router/表/工具/事件/配置 | 现RequestIR/Scope/Observation足够 | reject；无新增模块、第二事实账本或关键词路由。 |

本节是执行前判据，不是完成声明；真实反例、必要设计细化、验证及剩余责任继续在本节记录，完整R05尚未签收。

### 16.2 独立复核后的责任裁决与接续（2026-11-18，实施前）

本会话按作者再次“继续推进”接续当前 R05。初始 HEAD 同 §16.1；本会话在任何 R05 改动前真实封存 `artifacts/slice-verify/b87-r05-20261118/scope.json`，scope_id=`e065723f-8abe-400b-a769-3b3917ef616f`；109 项既有 WIP 的内容/哈希及原 patch 在 `artifacts/model-contracts/b87-r05/20261118/start-worktree`。初始隔离环境 `MIX_ENV=test mix compile --warnings-as-errors` 退出 0，owned run `9ed50f52f4b3d172`。另一 R05 会话已有的五文件统计初稿作为真实增量保留并重新审核，不将其工作冒记为本会话实现；两份开始记录不合并、不追造、不修改原件。R04 的既有应用 PASS 与历史 FAIL/unknown 继续分层保留。

**审核纠正。** §16.1 的候选“完整 baseline 重复”经 adapter 边界复核未成立：AuthoringTask 的材料恢复只保留元数据，上游 materials 带 body 不等于最终模型已得到正文。因此保留唯一实际 baseline，改以独立请求字节定位真正重复的作者/观察副本。章节统计初稿重算 has_prose 且缺已有总字数，改复用同次 toc.audit；内部来源由生产者保证，不能为坏 fixture 增加层层重复判断。责任层已先修订 VS-00M §5.2.3。

| 对象/责任 | 已有实体、当前消费者与不足 | 裁决 |
|---|---|---|
| 当前阅读统计载体 | ReadingProjectionRepo.toc / ProseAudit 已给 accepted 阅读 audit；WorkspaceContext 丢弃该结果，DialogueContext 无独立载体，snapshot 的旧文本消费者不能接嵌套 map | reuse audit；truly-new 最小非持久 reading_audit 字段；退役 chapter_counts 重算；首消费者 judgment_scope |
| 专业目标与大纲范围 | run.goal / author_goal_text / AuthoringTask.author_goal 已存在；机械步骤、planning mission、Writer schema 固定章节目标；现 VS-00J 卷蓝图与 parser 已可零章 | refactor-and-retire 固定章节假设，复用原通用候选协议，不新增实体或关键词 Router |
| 可见观察与使用引用 | RequestIR/Compaction/observation_payloads 已存在；Judgment 私有遍历、专业 raw observation 与 source_refs 授信不一致 | 收敛至同一 RequestIR.visible_observations 纯函数；当前判断/专业/测试读取器消费，无新模块；专业新探索先补真实合法回流，再退役旧重复供给 |
| 候选只读详情与续页 | 现 session_adoptions 只供600字预览、目录分页未接额外额度；WorkSessionRepo/TurnInteractionService 已有真实完整源；修订写操作不能代替只读比较 | 在现工具新增最小 artifact_ref/offset 详情，接现续页门禁；无新工具/仓库 |
| 记忆真实来源与全文 | MemoryItem id/version 已有，当前读口丢版本且使用 memory:<count>；HTTP 仍消费 text/count | 透传真实条目，现 memory_recall 增加同资格 memory_ref 详情；退役伪身份，保留真实现消费者 |
| 章节设计材料详情 | chapter_read 计划500字/摘要400字后不可续读，archive chapters仅目录；现章节/卷/摘要读口均在 | 现档案 owner 完整渲染与分页，正文 reader 保持；不新增 packet、资产系统或 Reader |

**独立反例与完整出口。** 先以真实 DB 的三个结构章（有 accepted 正文、空章、仅 tentative 正文）、旧/新草稿修订和另一作品证明统计口径；来源未知不得报零。以15个候选和超过6000字正文证明真正判断循环的两轮后续读，跨作品/会话、换目标、跳页不得冒领额度；两组各命中一条但不同记忆必须有不同真实 ref/version；长计划/章摘要后半部必须经实际探索可达。专业反例覆盖卷级目标贯通且无额外章节、真实作者原字节不重复、未供应/隐藏/source-only 引用不得获信用、partial不升级完整、整章全部有序 accepted 基线与目标段边界保留。

**实施与验证分工。** 统计与 DPS 为单一文件 owner；探索/档案/记忆读口由另一 owner；专业 Goal/Task/Writer 为另一 owner。common 可见观察函数、设计/任务、所有 Mix/模型/原生执行及提交由 root 串行协调。设计先落盘，独立新增反例先执行，再实现和受影响消费者迁移。旧兼容 `AuthoringTaskBuilder.from_input/1` 已无生产消费者，查全后退役专属兼容入口与测试；`to_input` 仍有真实消费者，保留。

**专业计划读取责任补充。** 查全确认 `ExplorationStep` 已产出真实 `AgentObservation`，但 Prose flow 未写 canonical；原 `agent_plan_draft` 已合法闭合，延迟其结果会阻断交错的使命/创作请求。采用现 Scope/application 来源追加真实执行结果：新增的 `facts.exploration_result` 是当前请求纯字段，无新表/账本/工具；唯一生产者是专业执行边界，唯一规范化 owner 为现 ExplorationService，真实消费者为使命、Writer、质量与引用 trace。仅根据实际 plan 校验记录关联 plan_call_id；固定计划不伪造调用。补入独立 `planned_exploration_material_test.exs`，以已闭合计划、partial 实读、隐藏旧页和普通 Scope 引用反例证明下一实际请求；既有大型测试拆出的统计、候选和分页测试分别承担其真实边界，不调整规模基线。

**格式化后的职责归并。** 首次精确清单格式化后，规模检查真实报出 Exploration 1435、WorkArchive 513、RequestIR 956，以及两份扩大测试超界。保持原规模基线，记忆查询/预览分别迁回现 MemoryManagement 的 selector/preview，章设计精确读取与预览迁回现 ReadingProjectionService；原位置删除实现。RequestIR 新增 `Observation` 纯契约 owner（同目录未存在等价模块；AgentObservationAssembler 只组装步骤领域结果，Projection 只做三 wire 投影，均不是替代职责），集中原观察块/叶/可见性，原公共调用改委托；仅拆代码责任，不建第二材料实体。专业边界新增测试按真实修订/作者供给职责拆分，不压格式、不登记放宽门槛。首次自动审批拒绝动态差异批量格式化后，已只读核对并改为38项明确 R05 文件清单，执行成功 `ae36865761615a82`；开始时109项既有WIP快照不变。

**专业材料与目标的进一步反例。** 新增 `professional_writer_request_test.exs` 将作者/目标及可见材料资格从会话传输测试分离，`chapter_revision_request_test.exs` 专测整章/目标段基线；不复制大 fixture 包。专业资格投影由现 AuthoringTaskBuilder.request_read_materials 统一，Writer/mission/trace 共用；旧 raw snapshot 与任意 source_refs 授信退役。进一步追查真实 DPS.run_spec 发现初始 run.goal.text 直接来自作者原文，原 nonce 分离用例不能证明真实路径单供给：后续须在目标生产者保留来源绑定，区分作者目标引用与独立应用解释，内部授权文本保持；未完成前不声称全路径原文仅一份，不按字符串匹配去重。

**完整生产者审计后的实施裁决。** run.goal 共两创建口（DPS、ToolConfirmationRun）与两修改口（steer、question answer）；AgentRun.normalize_goal 当前丢弃 source_ref，持久层已整图透传，无需新表。复用现 input_ref 与 RequestIR 已允许的 source_ref，补入领域恢复与真实生产者；Scope goal 统一引用投影，AuthoringTask 新增 goal_source_ref 仅为跨 adapter 纯载体，to_request_map 是唯一专业请求投影。各真实 flow/使命/continue/quality 消费该同源绑定并退役重复 goal brief；独立应用解释仍保留。另独立审查确认混合计划漏接读叶，且内联计划虽 ID 确定仍构造两次：JP 校验和 DPS 分派。改为校验一次后沿现 plan_result 传同一 plan/meta，执行不再重造，真实校验结果直接绑定该计划；新 judgment_plan_material_test 从双原生调用、真实读取到 Writer 请求取证，补 Prose/application Scope 的恢复与可见性边界。上述设计已先写 VS-00M §5.2.3，独立反例先执行。

R05 的原生缺证仍开放：新请求体系 G2 目标段和 B29 角色预注册虽存在，其目标证据目录尚未生成；旧 G2、底层分页循环、纯 Node/Elixir 或 R04讨论20轮均不代签。复用当前 driver/seed/oracle，按必要场景冻结真实运行边界；不为一般模型能力加考试，不以局部检查点缩小完整 R05 DoD。本节仅为实施裁决，R05 继续 doing。

### 16.3 六类原生证据与成本边界预冻结（2026-11-18，执行前）

先以作者效果冻结下表，再扩现役验收消费者。每项独立隔离数据库、独立批次目录、一次作者发送、零人工重试；六项各一次。开始前由实际原生执行 owner 绑定本任务 scope、源码/配置/锁文件、种子路径及 SHA、输入原字节和模型配置；执行结束再封存同源身份。原 20261115 G2/B29 预登记未执行，不修改或补签。

| 场景 | 原样作者输入 | 既有种子与独立判据 |
|---|---|---|
| `b87-r05-chapter-count` | 这部作品目前一共有多少章？有正文和还没写正文的各几章？只告诉我这三个数量。 | `seed_judgment_explore_chapter_full_read.exs`：结构2、有正文1、无正文1；首请求已有真实同次 audit 统计且无默认7000字正文/完整计划；目录/正文不升 complete；作者可见数量正确、Canon 不变。是否多做探索另计，不写关键词出口。 |
| `b87-r05-quality` | 请先阅读第01章《灵源账单》已经保存的正文，再判断主角的胜利来得是否太容易，指出依据和可改方向。只分析，不生成修订候选，也不要保存。 | `seed_au11_quality_diagnosis_message_envelope.exs`：真实 accepted 正文进入实际作判断的请求，标题/计划/统计不替代正文；现役只读消费者是终局 Judgment，按其真实调用/叙事来源绑定正文读叶。现 Reviewer 仅评审新候选，不为假想的 accepted 只读入口造正例；具体情节依据与文学判断人工分列；无修订候选、Canon 不变。 |
| `b29-r03-candidate` | 指定老沈为主角 | `seed_b29_character_role_revision.exs`：真实目录/详情、同角色身份与八字段 before；只将老沈 ENSEMBLE_POV 改为 PROTAGONIST，其他角色/正文/记忆保持；候选卡可见，停在采纳前。不代签旧 T2–T5。 |
| `b82-g2` | 请先读第02章《灰烬中的手印》已经保存的正文，前后都核对一下，再把发现的重复写法改成一段候选给我看，先不要保存。 | 原 G2 种子：准确选有正文的第二个同名章，两页0–6000/6000–7000实际回流，版本/hash/范围/相邻请求与 used refs 对齐；目标段候选，Canon 不变。原页面 verify 与独立 audit-g2 都须留下结果。 |
| `b87-r05-whole-chapter` | 请先把第02章《灰烬中的手印》已保存的正文从头到尾读完，再给我一份整章修订候选，减少重复描写，保留开头和结尾的线索；先不要保存。 | 原 G2 种子：完整7000字 accepted 基线实际唯一必要承载、同章同版本整章候选；首尾线索来源可追溯，不能误作续写或局部补丁；章节数/ID/Canon 不变。减少重复与文学效果单列人工观察。 |
| `b87-r05-style-material` | 请先查看本作品已经确认的风格规则，并阅读第01章《黑市对账夜》已保存的正文。据此把这一章改写成一份修订候选，突出人物之间的试探；先不要保存。 | `seed_ca04_carry_gaps.exs`：已确认“多用对白推进情节，少用心理独白。”的实际正文、memory ID/version进入使用请求，非仅摘要；第一章 accepted 基线充分、候选未自动采纳，首判断无默认全量长材料；Canon 不变，文风执行另列人工观察。 |

**真实预算。** 复用现 runtime recipe：splash / local/Q4-PLE4，thinking enabled、reasoning high、max_tokens=32000、provider timeout=300000ms；model context_window=262144，maintenance window=32000、ratio=0.70、auto=true、keep_recent=4、sync_summary_maintenance=false。产品已有 max_provider_calls 不变，全部实际调用/失败逐次计量。分型等待沿现 owner 的 input120s、ack30s、turn360s、candidate300s、adoption180s、maintenance300s、restore30s；B71 ready180s、render grace10s。每项900s总上界在实际 owned 执行中约束，不能只写 manifest 或旧浏览器超时变量。传输/窗口/模型失败原样留证，不循环运行直到绿色。

**存在性及责任审核。** 已有 NativeScenarioHarness、B71 candidate/read_only AX流程、B29候选流程、等待账、真实call reader、成本纯投影与G2页事实全部复用，不新增harness/启动器/成本账本/产品验收hook。现 authoring_capture_evidence 的同一显式场景定义扩四项，并由 batch/prepare/readConfig共同消费；错误 provider/场景/输入/种子/目录绑定拒绝，不能简单解除Splash限制。现 live evidence继续I/O编排；request-facts/live-refs只按真实当前请求补partial/application读叶，不由累计canonical引用授信。G2已有页版本/used-ref算法不得复制；新 `authoring_r05_evidence` 仅为四新场景纯目标判据组合，当前消费者为既有native/live evidence分派，不承担I/O/启动/成本。新模块前已查重：G2只签其目标段场景，live/scenario已分别870/783行，均不应继续混入四类独立语义；窄owner与对应纯测试保持职责清楚。先取得目录代正文、跨版本拼页、仅summary、错误整章范围及冻结绑定反例，再实现。

**成本边界。** 复用 joinNativeCallEvidence、analyzeRequestCost 与 nativeSummary，报告每次实际调用及失败、input/output/cached tokens、分类字节与未知字段；cached是input子集，分类Token未采集时不得用字节冒充。G2页级usage只是来源使用证据。当前没有同输入已执行before实模，R04讨论20轮不得替代。若用开始源码封存与相同输入/种子做前后请求构造测量，必须明确基线为HEAD192加开始时109项WIP，只报告实际可核请求字节；本轮实模usage独立列示，不推断Token降幅或文风改善。配对测量按下述已审查方案冻结，不修改历史原件。六个场景各取首次 Judgment 请求，另以整章场景的独立初态取一次 Writer，共七对；两臂均由各自生产 DPS→AgentRunService 构造，Splash transport 注入固定原生响应，仅捕获真实最终请求，不连接模型。首次场景各一条纯文本响应；Writer 只允许一条合法 execute 决策及一条候选提交响应，第三次调用、不可达或来源不符均保留 unpaired，不补请求。种子仅建立一次初态，沿现一致快照机制给两臂独立数据库副本；固定输入原字节、真实 turn/session/目标、版本、runtime 与同一驱动 SHA，run/call 身份由各臂生产代码独立分配并逐臂绑定。实际 transport body 与同 pcall/prun 的 LLMLog 逐值核对，session canonical 复用现 request view，作者绑定复用现成本批次 reader。只比较配对成立的 stable_json/content/envelope/分类字节，保留分类守恒；整章中段、真实版本或作者来源丢失即拒绝配对。固定响应 usage 为 not_collected，不写零值或推算 Token/缓存/时延改善。

**before身份纠正。** 逐项核对封存scope的五路径SHA与HEAD/保存WIP：DialogueContext、WorkspaceContext、judgment_initial_snapshot与HEAD192完全一致；DPS/AU03等于保存原件且无统计新字段。故这份开始基线不含另一会话后叠加的五文件统计初稿，不能把接续时见到的草案追加入before。机器核对值见 `artifacts/model-contracts/b87-r05/20261118/cost-baseline-identity-01.json`；原scope、inventory和patch均不改。

应用材料是否正确充分、页面是否真实可达、模型语义表现分别判断。确定性回归、六项实模、同scope全工程出口未闭合前，R05仍doing；R06不在本批。

### 16.4 全量回归后的消费者收敛（2026-11-18，实施 checkpoint）

真实Goal/同批计划/持久恢复121例通过（owned `4255265d43b02560`）后，首次全量Elixir编译通过，测试出现9失败（`6b31957fe1dbf64d`），xref/架构尚未执行；不把局部绿灯当全量出口。已区分三类：记忆空结果的作者反馈确实丢失，原样恢复其真实empty说明；CP3整份上下文和角色raw观察标题是已退役供给形式，改用真实成功native响应、完整角色字段/来源与三wire唯一字节、未读目录不得授信等独立判据；计划预算/等待失败来自现SliceVerify仍读取goal.text而落到错误fixture分支，原实际调用计数与等待预期保留。

明确引用的作者原文读取复用现NovelTest.TestProviderPrompt：新增author_text/2只按canonical user/author的真实source_refs唯一匹配，缺失/重复/应用伪装/非IR不猜；原author_text/1是最近作者语义，不能拿它替代指定来源。现SliceVerify计划与续行是实际消费者，共用一个Scope目标reader，无新实体或产品hook。红例owned `21082b38bde8fee6` 已证明指定来源分支丢失与API缺失后再修。续行goal_text查全只有Prose及两现验收脚本复制run.goal；退役该冗余参数和fallback、对应人工专属测试，不新增只为兼容旧测试的operation.guidance；真实deviation_summary/observation_block等应用说明保留。

新增计划读叶跨run压缩反例经真实AuthoringSession生产后，按持久段去派生坐标、以已完成run状态重建会话视图；合法message_refs覆盖后，旧正文保留在canonical但不再进入visible_observations和三wire，累计Base refs不得使正文复活，当前材料和作者原文仍在。3例通过 `459e252abf95067d`，没有修改Compaction规则。64项明确文件格式化通过 `a97afd63f4ab88ec`；仍需完成后续全量出口、原生与配对成本。

**恢复幂等机制与完整后端出口。** CP4a 的持久恢复反例揭示实际偏差：Scope 写入时已使用规范 Goal 引用，same_scope? 却与未投影的 run.goal 比较，恢复会追加重复 Scope。比较和写入现统一消费 RequestIR.scope_block(scope).content，不增加字符串去重、额外状态或兼容分支；独立历史、三wire、版本及恢复期望保留。最终完整后端验证 owned `d01f5ec17b85d82c` 退出0：compile --warnings-as-errors、全量 **3462 tests / 0 failures**、xref compile-connected 0环及 arch_check 均通过，完整日志 `artifacts/model-contracts/b87-r05/20261118/full-elixir-gates-02/gates.log`。这是当前工作树的工程证据，不代签真实原生、成本对照或各候选提交树。

**原生判据继续独立审查。** 纯 oracle 的旧高version Scope 反例真实失败（owned `95c9faa6e7b21190`，16组中1失败）：同一请求的旧正确材料不能越过后来当前 Scope。另以生产 coverage 形状、带换行的实际正文、合法 author_narrative_source 与长文滚动/所属按钮审核 reader；正文完整性由实际 Writer/候选字节绑定，作者可见性由本轮真实页面入口和截图/滚动证据承担，不能把 AX 保留离屏全文当作同屏可见。计数的语义正确性保留独立人工核对，不用数字正则自动签答案。原失败原样保存，R05尚未完成。

### 16.5 验收证据类型与责任修订（2026-11-19，实施前）

**Canon 快照的真实矛盾。** 现 buildAuthoringCanonSnapshot 的 v2 在 includeChapterFacts=false 时保存章内容签名，严格 parseSnapshot 却始终按完整章设计事实解析；R05 若只比较现有 keys 的空集则会把缺表误签为未写入，若为真实种子补 decided_at 则会改变事实。现 v1 明确只读，不能让新采集降版绕过矛盾。

**同一 owner 的明确分型。** 存在性审查未发现已持久化的等价判别字段；采集参数本身不是证据。现 v2 新增最小 chapter_evidence 判别值 design_state / content_signatures，保持既有 chapters 承载和九张表、记忆引用签名算法。唯一 producer 按实际采集模式写入；唯一 parser 严格校验对应每章集合、数量与 hash/完整事实。只读比较消费全部九表及记忆引用核账；source/revision 设计态比较另要求 design_state，内容签名绝不授予设计态见证资格。当前消费者为 R05 严格零写入核验，以及既有 planning/revision、live/behavior/confirmation/auto-maintenance 和 restoration。restore 的 raw/business hash 仅消费 tables，不改变其身份算法。

**反例与影响。** 缺 mission 日期的真实只读输入应能得到合法内容签名并比较未变化；删任一表、少一章、坏 hash、未知/缺失判别字段均拒绝，内容签名不能用于设计态变更签收。新 v2 读取契约不替旧 v2 补默认模式；旧原件/旧报告保留，不能宣称它们可直接由新 verifier 重算或补字段重签。无新快照系统、无第二 parser、无产品兼容层；该裁决先于实现。

**成本快照的消费者裁决。** 查全 request_cost_snapshot 的 contentCanonSnapshot、raw/business SHA、引用核账和 restore 清单，均只需要完整表内容与引用事实；真实 source/revision 设计态消费者另经 planningCanonSnapshot，仍取完整 design_state。故成本 owner 的 contentCanon 及 reconcileSetupDelta 三处同责构造改用 content_signatures，不为 G2 作者使命补日期，不增加备份流水线或宽松 parser。旧测试专属要求成本快照包含 mission 设计字段不符合该职责，迁为完整签名与原字节/行数/引用/restore 对等判据；先以真实缺 decided_at 的 G2 形状取得 createCompleteSnapshot→restore 红，再实现。仅修改 mission 原文字节仍必须改变业务 hash 并被零写比较拒绝。

### 16.6 完整读页与修订基线的真实重复（2026-11-19，实施前）

**独立反证。** DPS 原生两页读取→PendingArtifactWorkflow 章修订→CreativeToolAdapter/Real 的实际请求同时包含两页正文与 operation.context_text 新增的完整正文。R04 对当前回合的保护是正确的，追加专业 Scope 不自动隐藏工具叶；现 baseline_once 仅数应用字段，不能证明整次 Writer 请求唯一。不得把目标缩成注入次数，责任层先补 VS-00M §5.2.3。

**最小实施边界。** ChapterRevisionScope 已有真实章页/hash/版本/连续范围算法，是完整供给资格的唯一 owner；PWF 在绑定真实请求 IR 后据该资格选择材料载体。完整可见且与 fresh accepted 身份、全版本和逐页原字节一致时，不再追加全章；不完整/旧版/隐藏时继续供应完整 fresh 基线。保持 canonical 当前回合、授权范围、内部完整基线、expected_base_versions 和采纳事务不变；复用原生页不得从 Task 元数据制造第二 Base，应用读叶仍为 Base。先跑真实 DB 的 DPS 两页→PWF→Real→三wire 红例，并保留缺页、错章、旧版、伪 range/hash、正文缺失、合法隐藏及设计预览 omissions 的独立反例。现 chapter_revision_request_test 承担该链路，不造第二分页器或通用材料框架。

**观察结构的信任边界。** 现 IR 外层校验允许合法 JSON 的非对象聚合叶及 application exploration_result；它们没有观察身份，不能转成带默认值或空字段的假观察。唯一 Observation 读取 owner 应保留 canonical 原件，仅从可见的对象形状提取观察叶，非对象既不授予已供应/完整资格，也不让正常请求因结构访问而崩溃。合法原生与应用叶的字段、状态、来源差异保持；下游不得从聚合外层引用猜补缺失叶。该判据由现 RequestIR 测试及真实 Judgment/章节材料消费者核对，不另造清洗或兼容层。

**验收与成本。** 原生 whole 判据必须识别实际页的完整范围与来源，接受完整页供给且无新副本，拒绝完整两页加全章；不能只搜连续7000字字符串。七对请求构造实验保持既定数量与直接 execute→Writer 路径，其无前置探索的字节证据不能代签本条原生路径。250项读侧、112项Canon、15项成本/CLI回归已通过，仍不证明该新目标缺口已修。R05继续doing，真实模型尚未启动。

### 16.7 成本构造链的独立反证与归属（2026-11-19，实施前）

**目标不止选中请求。** 七对实验分别证明固定一次 Judgment 或 Judgment→Writer 的同源真实构造；相同选中 body 不足以证明此前调用来自本轮。独立审查发现现 constructedArm 对非 selected 调用只核 transport/LLM 两份互相一致，未与 canonical 全链及冻结 work/session/turn 对账；capture.run_id 未与 session view 核对；仅凭数量和 selected 也未证明顺序及真实阶段。先用外来首调用、伪 run_id、单边换序、selected 非末和相同正文但错 role/tool 的字面反例取得红，再在既有 reader 收口全部调用身份/顺序/阶段，不新增解析器或降低配对门槛。

**作者身份与执行步骤的责任裁决。** 实际生产链 JudgmentPlan.frame→TurnBinding→LLMLog 会把专业调用记为父输入的 `:agent:正整数` 步骤，canonical 作者来源仍是父输入；两者类似同一业务事务下不同执行 span，不能以步骤标识替代作者来源，也不能把合法步骤改写为父输入以通过测试。现 canonicalAuthorMessage 和 constructedArm 的直接相等判断违背该生产契约。归属语法统一复用 authoring_call_evidence 既有 owner，并同时核对本轮真实 run、work/workspace/session、唯一 canonical reply 的 pcall/prun；字符串父子关系本身不授予归属。作者唯一 source_ref 与 canonical parent 始终指向冻结父输入，原文字节与完整 coverage 保留。旧 fixture 缺少真实 producer 必有的 source_refs，应按该契约修正；保留合法 child turn，并先以错父、错误步骤语法、错 run/call、缺失/重复/伪造作者来源反证。影响范围是既有成本批次和七对构造消费者；不改产品 turn 身份、不新增第二套调用解析或猜补历史来源。

**执行环境的证据边界。** source identity 文件 SHA 只证明声明文件本身，实际 checkout/cwd、完整源码执行前后指纹、BEAM 构建路径及已加载文件必须由本次外层 owner 独立记录；before 只用原109项WIP和原HEAD重建的2646项一致副本，独立编译，不复制 after 产品模块。固定 eventsource 只提供结束本次构造的原生响应，非流式入口显式拒绝；RuntimeConfig 的 nil 原值也须无条件还原，同一 BEAM 外层核对调用前后配置，不能留下默认真实路由。实际作者入口以 work.id 作为 workspace_id（WorkspaceChat topic→Channel→DPS），四种子表中没有独立 Workspace 行不构成补造实体的理由。

**失败路径与实际执行身份。** 异步 cancel 后立刻还原真实路由可能早于执行步骤退出；故每次独立测试 BEAM 的外层先用既有 RuntimeConfig 安装封闭 Splash 配置（封闭 endpoint、流式/非流式入口均显式拒绝），作为 driver 的进入与还原基线。固定响应结束或失败都只能回到该隔离基线；配置相等证据针对这个基线，不宣称操作过用户模型服务或恢复了真实路由。外层同时核 Repo.config 的实际数据库 realpath 精确等于本 arm/pair 新 restore 路径，冻结空 MIX_TEST_PARTITION；同 SHA 不能替代该位置证明。已加载 novel_* 应用声明模块与全部 Elixir.Novel* 模块取并集，真实 BEAM realpath 必须在该 arm 独立 build 内，防声明交集漏掉动态加载的另一源码新模块。recipe 的 work/session/accepted draft 归属来自种子库原始行，不由配置声明自证。

**已取得的独立数据证据。** 成本快照真实红 owned `9d883e9f1c23cb18` 后，相关六文件97项全部通过 `e3bcd1c42beca869`。四类既有种子各执行一次，运行树收尾后经 SQLite 自身 checkpoint 封闭；复用现完整快照 owner，源/full/work 字节 SHA 一致、36表全保留、初始 provider/run 清单为空。无新种子、备份器或实际模型调用。候选提交树与最终原生/配对请求仍须独立验收，不由这些局部结果代签。

### 16.8 当前职责边界复核（2026-11-19，迁移前）

**章读取证据与作者授权分责。** 全量扫描的规模信号触发职责复核，而非机械减行或调整门槛。ChapterRevisionScope 现有授权/目标语义与章页来源、版本、连续范围、真实字节资格有不同变化原因。查全 RequestIR.Observation、ReadingProjectionService、LocalizedRevision、ProseFormatting、ExplorationService 和 AuthoringTaskBuilder：它们分别负责通用可见性、DB读取、分段/diff、hash、分页生产、通用Task投影，均不应新增第二套章页资格。不存在等价现 owner，故将原唯一算法整体迁入窄 ChapterReadEvidence，只有 bind_target_segments 与 supplied_baseline? 两入口；现 CRS 与 PWF 分别为真实消费者，不建持久实体、通用框架或兼容转发。原 CRS.supplied_chapter_baseline 退役，Task materials 仍由 PWF 组装。

**必须保留的时点反例。** 完整、fresh、仍可见的旧页可满足修订基线，却不能在新作者输入之后冒充本轮读取来绑定模型发现的段落。目标绑定仍只读当前作者后的原生叶；完整供给仍读 Compaction 后可见的原生/应用叶并核 fresh accepted。独立交叉反例放入现 B28/章修订测试 owner，原三wire、缺页、旧版、应用来源、隐藏页及采纳守卫全部保留。迁移删除原实现，禁止把旧页公共 helper 留在 CRS 形成反向依赖。

**离线配对与原生采集分责。** 固定 recipe 的两臂构造、完整调用链资格、Writer 基线核验和 delta/report 是离线证据责任，不能继续累积在原生 batch 生命周期 owner。已审 request_cost_evidence（单请求量度）、batch_evidence（原生轮次签证）、manifest（历史/预注册）、snapshot（数据库）、runtime_recipe（运行参数），没有等价配对 owner。将既有 constructed* 与 analyzeConstructedPairs 整体迁入 request_cost_pairs_evidence，现 analyze-pairs CLI 与 pairs.test 直接消费；原 capture 不留兼容转发。请求量度、canonical/call/author 绑定、正文 carrier 等仍复用既有唯一 owner，不复制领域解析；通用读写只复用当前合适入口，不为几行标准 IO 另造框架。原七对、同源、全部调用顺序/身份/阶段、缺证时 unpaired/delta:null 及不测模型质量/用量/延迟的边界逐字保留，纯职责迁移沿用现独立反例。

### 16.9 本次工程结果、请求对照与原生阻塞（2026-11-19）

**当前裁决：R05 BLOCKED，未签 PASS，不进入 R06。** 本节接续原 scope `e065723f-8abe-400b-a769-3b3917ef616f`，保留开工、反例和失败原件。产品调用链、确定性反例及七对请求构造已有实际证据；六类真实模型页面目标仍缺签收，当前直接阻塞是 WebCodex Runner 的代码签名不满足 macOS 已保存的辅助功能授权要求。R03/R04 的原签收及开放限制不改写，NEXT 继续指向本批。

**分组提交与原 WIP 边界。** 每组先构造精确候选树、按职责验证，再正常提交；没有 push。原 109 项 WIP 通过封存 inventory/patch 与候选白名单核账，B84/B85 及无关迁移保持独立。

| 提交 | 审核与验证范围 |
|---|---|
| `0cb5fd503189afaf861fdc79768df87e8745e30f` | Canon v2 明确证据类型与成本快照恢复；精确候选的相关 82 项通过，保留前置失败记录。 |
| `9a01a8ba2673447858593017c3d437cc58287415` | 目标来源、可见观察及跨 app 纯契约；精确候选全后端 3392 tests / 0 failures。 |
| `44ff7cdcd7b4b20d7b5669d39f289f3159434a07` | 89 路径产品闭包：统计、真实探索、目标来源、专业材料与现役消费者；精确候选全后端 3471 tests / 0 failures。 |
| `a9a10a1f4168a1534a22287b0b3c07893f651d48` | 52 路径原生/成本 harness 闭包；62 份原生/成本测试加模块规模测试，1368 pass / 0 fail / 0 skip。 |
| `59f4b6eb5a381c68c3a8ded96d14f867edbb7fb4` | 单独补入原 109 WIP 已有的 VS-00M §5.2.2，保持封存原件逐字内容，使本节前置引用可达；不是 R05 新设计，也不重签 R03。 |

所有候选 patch/tree/命令/结果在 `artifacts/slice-verify/b87-r05-20261118/review/`。产品候选 `cf77a1394d04658ae81decb02da4cebb58b0d0cb` 的 `mix check`、Credo strict、I3/I1/I2、N-NARR、模块规模与 diff 检查通过，owned `2a64f3f6b5564988`。harness 最终候选 `23f98dfb43293e6094df71285e6bbcfaf5a43795` 的 Node、模块规模、batch shell 语法和 staged/unstaged diff 检查通过，owned `8cf9477ac677b34e`；初次暂存检查拒绝新测试的末尾空行，清除后才复验提交，没有改测试预期。

**整合工作树的工程证据。** 全后端 `3473 tests / 0 failures`，compile warnings-as-errors、xref 0 环、arch_check、Credo 与 I3/I1/I2 均通过（`full-elixir-final-05/gates.log`，owned `5e5880dba366145b`）；全原生/成本 Node `1354 / 1354`，模块规模单测 `23 / 23`（`full-native-node-03/tests.log`，owned `a33694f6b3719f4b`）。另一次完整 `mix check` 含 codegen、枚举、ADR、I-CACHE 及全部 3473 测试通过；同一脚本随后因两处 EOF 空行以 2 退出，保留 `full-mix-check-01/check.log`（owned `771cc61020260aa0`），不能把整体退出码改写成 0。候选数与整合树不同是各组明确排除原有旁支 WIP 所致，不合并重复测试计数。最终执行 `bash scripts/ai_static_scan.sh --top 10`，本批 `full-static-scan-03/report/` 保留 report/Top10/disposition/raw，owned `4799d33e79924b3b`：21 项中 19 pass / 2 fail / 0 skip，整体 exit 1，扫描前后源码指纹相同。模块规模修复已通过；两项失败为真实 UI 完成证据缺失，以及 gitleaks 的 6 个已有历史命中（原台账 5 false_positive / 1 accepted_risk）。共 7 findings，唯一 pending/blocking 为 task-done-manifest；没有新增豁免或改写长期处置。随后 `task_done.sh --scope artifacts/slice-verify/b87-r05-20261118/scope.json --slice b71-first-consumer --ui-summary artifacts/slice-verify/b87-r05-20261118/native/count-01/summary.json --ui-binding artifacts/slice-verify/b87-r05-20261118/native-bindings/count-01-binding.json` 复核同一 scope，因真实尝试未形成 binding 而 ENOENT / exit 1；证据在 `final-task-done-01/`，owned `f36400ea217e8ac3`，没有另起原生尝试或制造完成 manifest。扫描结果与原生目标分别裁决。

**七对实际请求字节。** before 为 HEAD `192a335fa37a3eef79f4a385d422403a073521a3` 加封存 109 WIP，不追入后来的统计初稿；两臂独立构建、同一初态的独立 DB 副本、相同作者输入/目标/版本/runtime/driver。recipe SHA `e1937a5c589117887da8e1ec971e37f3a46a0436493dd8e1d3f77b048a8b028c`；driver SHA `454d446fc5df7fce1520142e4f8d55b51837f7cb5d5787f50b644ffeaff5a207`。来源为本批 `cost/analysis/request-cost-pairs.json`，逐项核过 transport、LLM 与 canonical；7/7 配对成立。

| 配对 | before 稳定 JSON 字节 | after 稳定 JSON 字节 | 差值 |
|---|---:|---:|---:|
| count-initial | 40819 | 41386 | +567 |
| quality-initial | 40892 | 41458 | +566 |
| role-initial | 40744 | 41309 | +565 |
| g2-initial | 40869 | 41436 | +567 |
| whole-initial | 40896 | 41463 | +567 |
| style-initial | 40997 | 41563 | +566 |
| whole-writer | 65985 | 66346 | +361 |

六个首判断增加的 Base 359 字节来自目录/详情/续页说明，Scope 166–168 字节来自同次真实章节统计，JSON 包装增加 40 字节；没有默认加入目录、章摘要、角色正文或章节正文，正文仍 not_read。Writer 的差值为 `+359 +168 -205 +39 = +361`：实际完整请求中的作者原话由两份降到一份，独立执行说明仍保留；两臂都完整供应同一 accepted draft revision 2 的 7000 graphemes / 20620 UTF-8 字节正文，SHA `4d5b86962eed7e82f8c2e9d3cf5d280d2172941337bed3fefb1f3859c38a95f8`，各仅一份。该固定路径直接 Judgment→Writer，没有前置两页观察，不能代签 §16.6 原生路径的去重收益。全部配对字节均增加；没有 before 实模、Token/缓存/延迟/文学质量收益证据，raw HTTP bytes 与 usage 为 not_collected，不从这些值宣称整体成本下降。

**外层来源校验的真实失败与追加核验。** 原 14 臂 driver 均退出 0，外层却把 `code.which` 为空的 10 个 MixProject 内存工程定义解析成仓库目录，逐臂拒绝。原 `cost/execution-summary.json` 的 failed 不改写。追加 `cost/execution-reconciliation.json`（SHA `1e406683d8c94b3f3afd86c55603388543ae3aba28f35a6d26ee11ea2027a68e`）只在原始路径为空、存在冻结 mix.exs 唯一定义、且不属任何 runtime .app 声明时识别这些具体工程模块；14 臂合计 2173 条真实运行模块加载记录仍须落在各自独立 build 及唯一 owning app。before 419 / after 421 个声明模块文件均存在；14 份源码前后清单、编译身份、Repo realpath、空 partition、封闭 transport 及恢复基线均核对成立。没有重跑、换样本或放行仓库根目录；追加检查明确是在执行后读取保留构建，不伪称原 BEAM 已记录额外字段。

**实际原生结果。** `native-preregistration/count-01.json` 对应的唯一启动尝试落在 `native/count-01/`，owned `bf4776d39feec670`，45868ms。窗口与 app 已启动；唯一输入事件为 activate rejected，reason=`ax_trust_required`，`ax_trusted=false`、`post_access=false`。失败发生在 start Canon capture 和作者提交之前：作者发送 0，场景 completion 推理未触发。健康探活仍访问了 provider 的 `/models`，不能称完全未访问服务；Token 费用没有实测报告，不写测得 0。后续“截图 0<4”是派生失败，`native-ui-complete` 只是 finally 结束信号；实际 cleanup `remaining=[]`，运行树已收尾。原生 summary 未形成，finishExecution 的缺失输出拒绝也原样保留，不能补造 binding。

**权限的直接原因已定位。** `review/native-permission-tcc-event-query.json` 封存同次启动期间 596 个匹配事件中的前 80 个选录：系统 AttributionChain 明确将本仓库 `artifacts/tools/ax_cua` 的请求归责给 PID 923、`dev.webcodex.runner`，实际路径为 `/Users/loong/.local/share/webcodex-pkg/node_modules/@yyjeqhc/webcodex/vendor/bin/webcodex-runner`。2026-11-19 10:53:45（UTC+8），TCC 对 Accessibility 明确记录 `Failed to match existing code requirement`、状态 `-67050`，并将 PostEvent 组合到 Accessibility 后判为 `Auth:Denied`。已有授权要求为证书根 `83a1298e17883732268e21d0c98c004bae81d5d8` 与 identifier `dev.webcodex.runner`；当前 Runner 的 `codesign` 为 `Signature=adhoc`，designated requirement 只有 cdhash `408fa430deb0ab66ddff0e1420bdc40646e25860`（`review/native-permission-restart-evidence.json` 的 binaries）。当前签名不匹配已有授权是系统实报，不能归咎于作者未授权，也不能只凭祖先关系猜测责任主体。

重启前的 R04 `native-20-01/native-input-events.jsonl` 在 11-18 17:25–18:01 的实际调用中，两项权限均为 true；11-15 的既有 TCC attribution 已归责于同一路径 Runner。当前 Runner 文件 mtime 为 11-18 21:52:52，开机为 22:00:06，当前 Runner 启动为 22:00:50。追加 `review/native-permission-restart-supplement.json` 明确原浅层 glob 没覆盖 R04 层级，并封存已知 R04 首末事件；不把有限扫描称为全量最新历史。时间顺序与重启后启用当前身份相符，但 mtime 不独自证明签名改变时刻，具体安装/签名修改者尚未知；没有证据称重启本身清掉了权限。未重签、重装 Runner、重置 TCC 或改变系统权限。

此前自动审批在执行前以敏感外发疑虑拒绝过一次；补充实际 endpoint=`127.0.0.1:8000/v1`、仓库合成种子和新隔离 DB 的证据后才获准执行。未接触实际作品库、未接管模型服务，也未放宽原生输入权限门。

**恢复入口与剩余工作。** 本次已占用 count 的 1 次批次尝试，即使发送为 0 也不静默重置；其余 quality/role/G2/whole/style 五项未启动。恢复应针对系统已指认的 Runner 身份：先核清其安装/签名来源并恢复或确认稳定签名，再通过系统认可的设置流程核对、必要时更新该身份的授权；只给当前 adhoc 文件重新授权无法证明后续更新仍匹配。该处理属于工具运行环境，不在产品里添加权限兼容或旁路。助手仅经原通道复用既有只读 probe，对新受控 owned target 观察辅助功能/事件投递两项权限，截图前置另核。旧进程已经结束，不能用旧 PID 或另一终端的成功结果代签；count 恢复须先明确登记前向预算与预注册裁决，再单独记录与 count-01 关联的受控尝试；新目录和关联记录不代表原一次预算未被消耗。保留原输入/seed/runtime/判据与失败证据，不循环刷绿。随后才执行其余已冻结场景，分别核页面可见效果、实际材料/used refs、零自动采纳及人工语义；G2 还须单独 audit-g2。六项原生与原 scope 工程出口全部满足前，R05 继续 BLOCKED。

成本与原生证据绑定的是当时实际源码。其后仅修正两处现役 live 索引说明、两处测试/fixture EOF 空白并补本节结果；产品实现、冻结 driver、seed 与已生成请求未改变。最终源码身份另行记录，不把旧实验快照重签为后来的全树身份。原始错误、旧契约证据及未纳入的原 WIP 均保留。

### 16.10 作者完成授权后的同通道复核（2026-11-20）

**当前裁决仍为 R05 BLOCKED。** 作者反馈“已经授权”后，显式恢复同一 Tunnel Session 与原 scope。HEAD 为 `c7e2f542d526a853761495e0ada3b3cbbe2ab582`，全部 Git 可见源码指纹仍为 `a903f19794a0a7a48830de753c788cbc2fa32c69ead9e833b33c925bf64d5aab`，与上次 final-source 逐项相同，原 47 项 WIP 和空暂存区保持；不重复运行已验证且未变化的产品实现。来源记录为本批 `recovery-20261120/source-before.json`。

**授权记录存在，但旧身份仍未匹配。** `recovery-20261120/global-permission-preflight.json` 封存同一 Runner 下只读系统 API 检查，2026-11-20 01:24:52（UTC+8）实际为 ax_trusted=false、post_access=false、screen_capture=false。此检查没有输入、窗口启动或权限申请；它不是 ax_cua 加本批 owned target 的原生签收，也不能替代恢复后的该项复核。

随后只读系统日志 `recovery-20261120/tcc-after-authorization.json` 明确归责于 `dev.webcodex.runner`、PID 79524；当前 Runner 已为 `Authority=WebCodex Local`，Signed Time 01:19:39，进程于 01:19:49 启动，SHA256 为 `2014018d7d67e8570b79caee3f1c62c1a42dd1d918e4256d35b9516a8f293b2a`。当前 designated requirement 是 identifier `dev.webcodex.runner` 与 certificate leaf `a7e5bf5089c001040c2df55b61b890fb62138975`；TCC 却仍以原 certificate root `83a1298e17883732268e21d0c98c004bae81d5d8` 校验 Accessibility，明确 `Failed to match existing code requirement` / -67050。同路径已存条目仍为 `granted=true`、`auth_value=2`，但 verifier 仍是旧证书要求。故不能说作者没有授权、Runner 仍是 adhoc 或未重启；当前直接问题是已授权记录的旧代码身份与新签名不匹配。ScreenCapture 本次日志只报告 Unknown(None)，不从 AX 的具体原因替它作同因签收。

**恢复与预算边界。** 应在 macOS 的正常授权设置中更新这个确切 Runner 的旧条目，使授权绑定当前签名，再从原通道复测；屏幕采集许可单独核对。证书签名存在不证明后续更新永远保持相同身份；本次未修改 Runner、证书或 TCC，也不通过产品代码绕过系统授权。由于全局前置仍未获准，本次未启动新的 owned target、未建立 count-02 预注册、未消耗额外批次或作者发送，也未请求模型服务。count-01 原失败及一次预算保留；未来恢复尝试仍先作前向预算裁决、再经既有 owner 与真实 target probe 执行，其余五项继续未启动。R06 不在本批。

### 16.11 权限恢复后的前向受控执行（2026-11-20）

**恢复依据。** 作者再次完成系统授权后，同一 Runner、同一 Tunnel 通道在 2026-11-20 01:35:57（UTC+8）实际读取到 ax_trusted=true、post_access=true、screen_capture=true；原始记录为 `recovery-20261120/global-permission-preflight-02.json`。Runner SHA256 仍为 `2014018d7d67e8570b79caee3f1c62c1a42dd1d918e4256d35b9516a8f293b2a`，签名 leaf 仍为 `a7e5bf5089c001040c2df55b61b890fb62138975`。全局前置已经恢复，但此只读 API 结果不替代本批真实 owned target 的 probe，也不证明任何页面或模型目标已达成。§16.9、§16.10 的失败与各自时点结论原样保留。

**执行前预算裁决。** 依据作者既有推进授权、再次授权后的继续执行意图与 §16.9 的恢复入口，在启动前明确增加一次 count 恢复批次 `count-02`：一次 batch、一次作者发送、零手动重试、900 秒场景上限。count-01 已消耗的一次 batch 与零发送不回滚；count 累计登记为两次 batch，其中仅本次新增的一次尚待执行。本节将 `native-preregistration/count-02.json` 登记为 count-01 后的受控恢复，沿用相同场景、作者原文、seed/hash、模型、runtime、各阶段超时和独立目标，只改变预注册 id 与独立 evidence 目录；不会覆盖旧目录或重签旧失败。其余 quality/role/G2/whole/style 各自原一次批次预算与预注册保持，仍未启动。

**既有执行机制。** 继续由既有 `native_b71_batch.sh` 调用 Tauri runner 创建隔离数据库与 bundle，`NativeScenarioHarness` 从本批 ready 派生目标并绑定唯一 PID；每个真实输入均经过现有 `NativeInputBoundary` 的目标事实/probe、授权判定与投递前再次校验。首个 activation 的 probe 将记录本次真实 target 权限；不新增 launcher、权限旁路或重复的预检 owner。Splash 显式限制为既有 `http://127.0.0.1:8000/v1`，仅使用已登记的合成 seed，实际请求、页面截图、输入事件、Canon 对照、退出与清理分别留证。

**验收与状态。** 本次源基点为 `ea4110d3f994212c05e99c1d4575d31d82a1d243`；启动前后按原 scope 记录实际源码身份，文档推进不把旧工程证据重签为新全树。count 的独立预期仍为结构 2／有正文 1／无正文 1，首请求统计供应完整而目录与正文尚未读取，且无默认全文或完整计划；额外探索单独记录，Canon 不变。其余场景继续按 §16.3 原目标和反例验收；G2 保留独立 audit-g2。权限阻塞解除，真实模型页面验收继续进行；在六项实际证据与原 scope 工程出口完成前，R05 不签 PASS，R06 不进入本批。

### 16.12 count-02 实际答复与终局采证责任修订（2026-11-20）

**实测分层。** count-02 在原 scope 上以源码指纹 `dd73e46b9ab82a4d846bada5a869c3a051561d6dbcec26f5aeacc2379fe1028e` 执行；owned run 为 `498ba89524207755`，native run_ref 为 `674deb98-ddc4-4156-af08-f5eef73b4b5e`。真实目标 PID 82676 的 AX/Post 权限通过，唯一一次作者输入与 ACK 绑定 `message_374d834a-cebd-4a83-84e2-c79432c8bd75` / `run_mwnu9sah_5`。实际首请求 `pcall_mwnu9scq_7` / `prun_mwnu9scq_8` 供应正确 2/1/1 统计，目录与正文为 not_read、无默认全文；模型于 01:43:49（UTC+8）真实回复“这部作品目前共 2 章；有正文的 1 章，还没写正文的 1 章。”，作者也确认已在页面看到答复。原始 provider 记录为 HTTP 200、latency 17659ms、input 9758 / output 70 / cached 0；模型已经回答，不能把 driver 尚在等待误说成模型未答复。

**采证失败不倒签为产品失败。** driver 未识别普通回复的终局，仍停在 `author_visible_outcome`；01:47:42 实测同一目标已无 onscreen window，遂以 `owned_native_surface_not_onscreen` 退出。该时点事实不推断窗口状态变化的操作者或原因。最终截图、前后完整页面及 Canon 对照未完成，summary 缺失，原 scope 的 finishExecution 拒绝生成成功绑定；`native-ui-complete` 仅为失败后的结束信号。精确 owned 应用已清理，remaining=[]，进程树 finalized=true。上述实际答复、源身份与失败材料全部保留；不抹去已消耗的 count-02 批次/一次发送，不重写旧批为 PASS，其余五项尚未执行。

**先定可观察判据。** 普通回复按现 UI 46§9.5 可以不显示空过程组；作者已经获得本轮完整回复，页面恢复空闲且没有活动任务/待回答问题时，验收必须能够结束。必须归属本次新增作者消息、同一消息流与真实助手回复/交付入口；有本轮过程组时服从其最新状态。单有“无任务”、正文中的“已完成/失败”、旧回复、重复原话的旧回合、未结束流式正文、跨下一作者消息、只有后台 completed 均不能成立。候选完成和候选可见分别判定，不能把局部候选卡的专用文案当作整章或普通回复的通用完成协议。

**责任层与实现计划。** 现 `authoring_g2_evidence.axTurnOutcome` 已承载上述 AX 作者边界、普通回复交付结构和活动状态判定，已有 R01 当前消费者；本次应把 B71 live 等仍依赖 `authorVisibleOutcome` 扁平文本状态的现役消费者收敛到这一 owner，移除重复终局定义及只保护错误假设的测试。原始 AX 观察及失败前最后现场复用既有采集机制，在实际截图与运行身份下记录，事后 verifier 从原始节点重算，不信 driver 自报 kind，不用 DB 或隐藏 API 替代作者页面。R05 候选入口/动作仍由既有卡片 owner 做独立有界采集；不新增产品完成徽标、关键词分流器或验收旁路。先验证普通回复及强反例、共用 consumer 接线和既有候选/问答路径，再前向登记一次 count 修复验证；不先消耗其余五项以绕过当前已知采证缺陷。产品、模型输入、seed、runtime 与目标不因此改变。

### 16.13 终局采证修复后的执行预算（执行前登记，2026-11-20）

**目标不变、证据关联补全。** 修复复用现 AX 终局 owner 与原始观察 writer，并要求所有普通回复和候选场景都从最终原始 AX 重算 completed；候选可见另核。现 capture 同时保存节点、可见文本和实际窗口图的内容哈希；本次 live 在发送前另采真实 `before-input`，其原始节点用于重算作者消息基线，最终 raw 与 final capture 的哈希和本批身份交叉核对。事后不能凭 driver 自报 kind、同数量异内容节点、旧基线或稍后到达的后台 completed 代签截图时仍在执行的页面；G2 候选宽限也保留最后有效原始观察。失败与缺证继续如实留档，不更改产品以迁就验收。

**一次修复验证。** 完成上述职责修复及相关回归后，前向增加 `count-03` 一次 batch／一次作者发送／零手动重试／900 秒上限，用于真实普通回复终局采证验证。执行前 count 已实际消耗两次 batch、一次作者发送；count-01 与 count-02 及正确答复/采证失败各自保留，不重置、不重签。新增登记后 count 累计三次 batch，本次只执行新增的一次，不结转前批未用发送。`native-preregistration/count-03.json` 仍从 count-01 的冻结结构复制，只改变 id 和 evidence 目录；模型、作者原话、seed/hash、runtime、阶段预算与 2/1/1、最小供应和 Canon 不变目标完全相同。实际结果必须另行记录，验证前不宣布通过。

quality/role/G2/whole/style 继续各自原一次批次预注册；它们尚未发送，不扩大输入或模型预算。全部真实运行串行使用既有原生 owner 与 loopback Splash；每项完成后核实际请求/可见结果/来源使用/Canon/清理，G2 另作 audit-g2。原 scope 保持不变，工程闭环采用真实受测源码；仅结果文档发布应后置于该闭环并单独核验，不改写原绑定。R06 不在本批。

### 16.14 共享代理证据收尾的生命周期修订（2026-11-20）

**真实工程证据。** 终局/采证修复的定向两组为 148/0 与 81/0；随后 68 个原生及模块治理测试文件统一执行，前后 Git 可见源码指纹同为 `6e7d5035dfef4ff16773baaaff3d2b99fb2fb36ca70002e1d88eff161429133d`。结果是 1409 pass、1 个文件级 fail、零 skip；module-size 与 diff-check 通过。原记录在 `recovery-20261120/ax-outcome-native-validation-01`，不能改写为全绿。失败来自既有 `native_provider_stream_proxy.test.mjs`：请求测试结束后仍有回调写 `provider-stream.jsonl`，其临时目录已经删除，产生异步 ENOENT；不属于模型调用或 count 的另一次尝试。

**责任与独立判据。** 现测试已等待 `proxy.close()`，代理等待的是 ClientRequest.close；响应处理却在共享 keepalive socket 上另挂一次 end 日志回调，正常响应结束移出 live 后该回调仍可存活。请求证据的生命周期必须由请求 owner 收口：完成后的 socket 事件不能继续归给旧 request，close 返回后不得再写本批证据；活动请求的中断、gate 取消/排空、实际字节和响应语义仍应完整保留。先核该额外 socket 诊断是否有当前消费者；没有消费者则退役无职责的监听，有消费者则在现生命周期 owner 内正确解绑，不能加第二套 registry、吞掉 ENOENT 或重复跑到偶然通过。确定性验证应保留 upstream keepalive，先关闭 proxy 再结束 socket，确认封存日志不再变化，并继续覆盖真实未完成响应的中断。修复后再执行受影响的统一验证；原失败留存，count-03 仍未启动。

### 16.15 采证与生命周期修复的验证及提交（2026-11-20）

**机制收敛。** 提交 `e41d157725b1ebeacbeb97793a94cabd28ac3907` 只包含 16 个采证相关文件，删除平行的扁平终局定义，共用现有 AX 作者边界与终局 owner、原始观察 writer；发送前基线和最终 raw/text/window image 逐份内容绑定，候选可见仍独立核验。其精确提交树 `37f3f108e26881b3cae00e93a748937e8fa65478` 隔离导出后运行 8 组邻接测试，260 pass / 0 fail。提交 `4f734cd2cc3fcb44f779f0769258bc1c0dec10f3` 仅包含代理与邻接测试两个文件：无现役消费者的 socket-end 诊断监听退役；gate 未 arm 与 observe 两例真实保留 keepalive，关闭代理后再晚关 socket，四份证据逐字不变。独立审查通过，最终代理测试 20/0。该样本证明连接保留与晚关闭，不声称已执行第二个请求复用同一连接。

**工程证据及错误保留。** `recovery-20261120/ax-outcome-native-validation-02` 中同一源码指纹 `d5f7b0a210a369a4e3053d86c0763f05f3ef300e2452266a218d2ee0ba45b04e` 的 68 个原生测试文件为 1411 pass / 0 fail / 0 skip；外层命令漏传 module-size 的 `--check`，且错误比较含 captured_at 的完整快照，故原整体退出仍为失败。实际前后只有采集时间不同，源码指纹与 entries 一致；追加 `ax-outcome-native-validation-02-completion/reconciliation.json` 记录此事实，模块检查通过但发现新测试 EOF 多空行。随后仅补新例 5 秒有界超时并删除该空行，`ax-fix-final-validation-02` 的精确树 260/0、代理 20/0、工作树与候选 index diff-check 全通过。首次隔离导出还曾因本机 Python 不支持 tarfile 的 filter 参数、在测试前失败，改用既有 git archive/tar 后完成；该原工具失败也保留，未重写为成功。模块规模 1035 文件、80 登记文件未增长、2 项原豁免未改。

**提交与继续执行。** `recovery-20261120/verified-commits/result.json` 记录两个中文分组提交、精确 tree 与工作树逐文件字节不变证明；README 仅提交本次索引调整，原 47 项 WIP、空主 index 保持，未 push。上述局部证据不代签原生结果。下一步严格执行 §16.13 已登记的 count-03 一次验证及其余五项原预算；所有实际 native binding 与原 scope 工程出口使用冻结的真实全树身份，随后才发布结果文档。原 count-01/count-02 失败与正确答复记录保持；R05 仍未闭环，R06 不在本批。

### 16.16 原生目标标题的事实对账与前向修订（执行前登记，2026-11-20）

**count-03 实际完成。** 原 scope 上 HEAD `0b7ad1fdc92b76deb7d291f08584ec6089be2fca`、源码指纹 `a9e0926b1485e1f0c7e6117b3e91fb3385aa52e031dba1b13142a2e1312bd9de` 的受控批次于 02:30:17（UTC+8）结束，owned `c76a4e64173bcaba`、47178ms、exit 0、tree_finalized=true；六项机制检查及实际 source binding 通过。root 已查看最终真实窗口：本轮作者输入、完整回复“这部作品目前共 2 章；其中 1 章已有正文，1 章还没有正文。”、为什么入口、无任务和空输入框同时可见。截图 SHA `9af9aedfabd229b68e50da200649337feb6e3d4de943e7956f17a3abe019bd5b`；cleanup 精确 PID 96353，remaining=[]。该结论只属于实际受测树，后续登记或修订不重签旧 binding。

**quality-01 前置失败。** 同一受测树上的 quality-01 于作者发送前，以 `reading_target_label_missing:02-reading-before:第1章：灵源账单` 停止；owned `6687e7184ab37e5a`、20168ms、exit 1、tree_finalized=true，清理 PID 97530、remaining=[]。`02-reading-before` 真实图与 AX 已展示完整已采纳正文，标题恰为 `第01章：灵源账单`；原 seed 的 chapter_lines 首项也明确相同标签，作者原话本来就是第01章。错误位于外部验收：R05_SCENARIOS、独立事实 fixture 与预注册均误写成第1章，测试虽未从被测 owner 导出期望，却共享了同一错误假设。原 driver 日志、阅读图、失败及缺 summary 的绑定拒绝保留；不把二次 verifier 的通用失败原因覆盖为最初根因，不把未发送当未消费 batch。

**独立目标与最小责任层。** 质量/风格场景应精确指向作者已保存的原章节标题，保留原有前导零，且仍按作品、完整章节标签、真实摘录和当前可见视口共同核对。真实 seed 对风格也写 `第01章：黑市对账夜`，其未执行的 style-01 与场景表/fixture 同样误写；G2/whole/count 的 seed 则是未编号标题加 seq=2，既有实际阅读图明确为 `第2章：灰烬中的手印`，不能机械统一补零。仅修 `authoring_capture_evidence.mjs` 既有唯一登记表的两处字面、既有事实 fixture 和邻接 IO 测试；先以显式正确/错误标签形成独立反例，再修改实现。正确第01应精确接受，错误第1仍拒绝且不得生成 config；不改产品标题、seed、正文、作者输入、模型/runtime，不引入归一化/兼容别名或第二张场景表。

**前向预算与源身份。** 修复验证后新建 quality-02：相对 quality-01 只改 id、独立 evidence 目录和错误的目标章节标签；原一次 batch 已消费、作者发送 0，新增一次 batch／一次发送／零手动重试／900秒，累计两次登记且只执行新增这次。style-01 尚未执行，保留其原件并以前向 style-02 替代，仍只保留原一次 batch／一次发送／零手动重试，不增加 style 总预算；同样只改 id、目录与目标标签。role/G2/whole 原预算、seed/hash、输入及目标保持。源码修订冻结后再执行，所有新 binding 记录各自实际源；原 scope 工程出口选择后续真实成功且与最终实现同源的 UI binding，不能拿旧 count-03 重签新源或排除文档指纹。结果文档仍后置发布，六项业务目标与原 scope 工程出口未全部完成前，R05 不签 PASS。

**修复验证与实际冻结。** 独立两例先在原登记上 0 pass / 2 fail（`recovery-20261120/title-contract-red`），修复后 68 个原生测试文件 1413/0、module-size 与 diff-check 通过（`title-contract-green`）。预注册单独校验最初误用 evidence CLI 的不存在模式，按原 batch 实际使用的 capture owner 重做后，两份新预注册均通过（`title-prereg-validation`），未重跑 UI 或消耗场景预算。精确候选初以无 Git index 的 archive 执行，32/33 通过，既有生产文件清单断言因 file_count=0 拒绝；改用同一 tree 的隔离 Git 工作树后 33/33 通过，未更改源码或测试门槛。三个文件已提交 `663f1a1aa56168543ed83cf5ef34f7504aea40e1`，tree `09e1f01ca8005e86533f0edcd70ee9e6554f8bfb`，原失败均保留于 `title-fix-commit`。相对 count-03，Git 可见变更仅这三个外部验收文件与本任务文档，原 47 项 WIP 保持，产品/seed 路径未变。quality-02 预注册 SHA 为 `01a3109e79873399f12bbe311f93c4798c1497d32a3192f32e6d5818d26977f6`，style-02 为 `c23fafca929185ffc851d76cf1b83294e293f13b0c6a690483b231931c391161`；本段冻结后才开展新原生执行。count-03 独立请求/Canon 审读为 `count-03-posthoc-review.json`（SHA `5c929df7092e05fc85d71883e6ac864e2975e7c1401df32caccf5dae53bcca1e`）；quality-01 的原始 WS/LLM/DB 审读确认发送和回合调用均为 0，但存在健康探测，见 `quality-01-posthoc-review.json`（SHA `0c844e48e85de2c6841b6f440c0cb222dce7c0536c51e645c9599098f0377fe8`），两者均为追加派生记录，不修改原批次。

### 16.17 完整 Markdown 回复与实际阅读视口的责任修订（执行前登记，2026-11-20）

**实际失败与独立目标。** quality-02 在 HEAD `6f3e6c4789ef4d2d8a713be3bdced0b5b7827fb0`、源码指纹 `2079da1d300ca152972a17ed42bb502fc1ac84698088ee3215af4304d3dfd396` 下完成真实分析；owned `3d605acff7c7635f`、61140ms、driver 0 / runner 1，原 summary 5/6。第三次实际 judgment 请求包含 ACCEPTED v2 正文全部 378 graphemes / 1134 UTF-8 bytes，回复结合三招制胜、未确认频段、代价和反常顺利，Canon 内容未变、无候选、无采纳。失败项 `visible.author_reply_missing` 来自 R05 将含 Markdown 标记的原始回复整段搜索于渲染后的 AX 文本；最终图仅展示回复后半部，完整 AX 的首段位于屏外。两种事实必须分别保留，不能把旧批次改签 PASS。派生审核 `quality-02-posthoc-review.json` SHA `fe70c917b6c0325fc7947fda52460b49dc16d0343bd06d05e4ad2c3f2621e562`；精确 PID 1426 已清理，remaining=[]。

**目标判据先于实现。** 作者当前交付的完整文字应按现 UI 46§9.5 / ADR-0036 静态 Markdown 政策可读；一个新作者边界内、单个助手至对应“为什么”入口的交付区间，按顺序及重复次数包含完整预期内容。删中段、改实词、换序、少一份同文段落、仅有父汇总、跨两份助手交付拼接、旧回合/作者引述/过程记录冒充正文，均不得通过。仍独立要求本轮 completed。普通排版空白与代码字面内容分开，不能全局去符号、删空格或按字符串去重；转义星号、未闭合静态 Markdown、代码缩进、链接可见 URL、图片 alt、转义 HTML 都有明确人工样本。预期不得从被测转换结果反推。

**存在性、职责与当前消费者审核。** 复用现 `authoring_r05_evidence.mjs` 完成四目标的完整回复比对，复用 `authorBoundary/withinAuthorBoundary/axTurnOutcome` 定位作者与终局；G2 不增加 Markdown 职责，G3/成本链不暗增全文签收目标。现产品 `MarkdownText` 已唯一拥有呈现政策，保持其实现不变；工具通过成熟 unified/remark AST 表达已确认政策，不另造 Markdown parser，不导入产品组件生成测试期望。frontend 显式声明已锁定的 unified 11.0.5、remark-parse 11.0.0、remark-gfm 4.0.1 工具直接依赖，复用 @streamdown/cjk 1.0.4 公开 before/after 插件，保持 parse→CJK before→GFM→CJK after 顺序；不依赖 pnpm 私有路径或隐式 hoist，不升级包、不对静态文本做流式补全。未知节点明确拒签，不静默丢弃。

**公开 ESM 解析边界。** 实施前复核发现 @streamdown/cjk 只导出 import 条件，不能用 createRequire.resolve 冒充 ESM 导入解析；统一入口不增加实验性 Node flag，也不直连包的私有 dist 或 pnpm 存储路径。现依赖图已有 enhanced-resolve 5.21.0，由 Tailwind 当前使用；将该确切版本显式声明为验收工具 devDependency，通过其公开 create.sync API、import/node/default 条件和 frontend 包上下文解析上述公开入口，不新建 resolver/loader 模块或改变产品依赖版本。长单 AX 叶的首末视口还须沿现 scrollAt 在原 20 秒等待预算内按新鲜几何移动；AXScrollToVisible 成功但端点仍离屏不能签收，也不能把无主动滚动的超时归因于产品。

**实现与二阶影响边界。** R05 owner 输出有序可见单元并按完整内容消费实际 AXStaticText 叶；标题/列表父级 aggregate 和 AXListMarker 不重复计入，同文不同叶保留，允许真实 inline 拆叶但不得凭空添加或吞掉词间空格。driver 与 verifier 共用该 owner 的助手区间及首末节点选择，避免两套归属规则。沿现 scrollTo / NativeScenarioHarness.capture 追加首、末段实际位于窗口视口的证据，每份由现 assertCapturedNodes 校验同批 raw/text/image 哈希、同作品/作者区间与 completed；原 final 保留。完整 AX 比对证明全文内容，首末图证明对应位置可读，不把两图宣称为全文同时上屏或全文逐字截图覆盖。只有实际出现中段截断/不可达时才补必要中段，不建立新分页框架、采集器、产品 hook 或兼容分支。独立手写正反例先行，随后原生邻接/统一测试及既有 Markdown 呈现回归。pending-followup 的旧 awaitVisible 原文整段匹配作为现役相邻风险记录，不在本次暗改其交互生命周期。

**前向预算。** quality 已消费 2 batch、1 作者发送；完成上述修复后新增 quality-03 一次 batch／一次作者发送／零手动重试／900秒，累计登记 3 batch，仅执行新增一次。由 quality-02 复制预注册，仅改 id 与 evidence 目录，作者原话、seed/hash、章节标题、模型/runtime、材料目标、Canon 目标与阶段超时不变。不结转旧批次发送，不补造 quality-02 缺失的首段图。实现、计划与预注册先冻结再运行；旧成功 count-03 仍只属于其实际受测树，最终工程出口须使用最终真实同源成功 binding。

### 16.18 确定性角色候选的执行结果交接修订（执行前登记，2026-11-20）

**真实产品失败。** 同一冻结源上的 role-01 owned `01630654bfe433d1`、40553ms、driver 1 / runner 1，真实运行 `795d8259-0028-4477-97d3-38c432daf779`。三个实际 SSE judgment 调用均 HTTP 200，目录区分老沈/小沈，老沈完整详情进入 execute 请求；在内存构建角色修订候选后，DPS `pending_artifact_step/3` 的 `result.stage_state || %{}` 对缺省键先抛 KeyError，导致 step_task_down。确定性角色分支合法返回 turn_result/artifact_refs/counts，无 provider stage_state。持久 pending refs 为空、作者仅见内部失败，无实际候选交付；不得用 candidate_built 或 turn_result_emitted 的 trace 名称代签交付。已覆盖的全部角色字段、记忆和正文 hash 与 before 相同，无采纳/receipt；不把原 B29 未覆盖的全部 Canon 表补签为已比对。精确 PID 4408 已清理，remaining=[]；原失败、缺 summary 与 finish binding 拒绝保留。独立报告 `role-01-posthoc-review.json` SHA `9b3814c16c5f5e8b067babcaaeb08273220bdc9326c9f914b1c21896d5137983`。

**独立结果契约。** 作者指定已有“老沈”为主角，应通过现 DPS 执行路径交付且持久化唯一 TENTATIVE 角色修订候选，精确绑定老沈及当前基线；只改变 narrative_role，其他字段、其他角色和正式作品事实不变，不自动采纳。确定性步骤不调用 provider，也不应伪造 provider metadata；可缺省的 stage_state 被现适配口按缺省值合并，已有 metadata 则完整保留，必需 turn_result 等契约不能一并放松。无变更分支仍正常完成且不生成虚假候选。作者说明继续服从既有作者可见投影契约；模型 execute reason 中的内部 ref/指纹不能仅因在异常中出现就宣称已泄露，也不能在交付修复后未经审查直接当合格说明。

**责任、反证与计划。** 复核现 PendingArtifactWorkflow 所有生产者与 DPS 当前消费者后，在现 DPS 包装口正确读取可选 metadata；优先保留确定性 producer 的职责，不添返回适配层、重复注册表、伪 provider 状态或吞异常兜底。独立回归必须穿过 DPS 实际执行适配，证明缺省、存在 metadata 与 no_change 的真实交接，而非仅测试 Map.get。检查并保持已有阶段状态与后续执行清理语义，审查作者说明的责任层；若发现进一步目标偏差先修订相应设计再改代码。原 pending_artifact_workflow WIP 不混入提交。相关 backend/编译检查与精确提交树验证通过后才开展新的真实角色批次；此项属于 R05 当前交付目标，不作为 R03 遗留或 R06 范围豁免。

**前向预算。** role-01 已消费一次 batch／一次作者发送；修复后新增 role-02 一次 batch／一次作者发送／零手动重试／900秒，累计登记两次，仅执行新增一次。由 role-01 复制预注册，仅改 id 与 evidence 目录；仍通过现 B29 r03-candidate 入口，作者输入、seed/hash、模型/runtime、阶段预算与候选/正式状态目标不变。G2、whole、style-02 仍各保留未消费的一次原预算；六目标实证及原 scope 工程出口未完成前，R05 不签 PASS，R06 不推进。

### 16.19 当前作者交付契约的阻塞依赖前移（设计修订，执行前登记，2026-11-20）

**已完成的两个独立修复。** `81566845d7894015f390f20c4f8d946c5bd70564` 仅提交 DPS 可选阶段状态读取及真实 runtime/持久化回归，精确树 `6093f4a6cfa94741fb8a58df0dfa0188b316ca51` 的三组相关测试 33/0；原红例 2/2 失败，首次绿测的 fixture 漏接真实持久回调导致 32/1，修正 fixture 而非降低目标后通过。no_change 的内部枚举旧文案未被锁成正确预期。原记录保留在 role-handoff-red-01、green-01/02/03 与 exact-commit。`96c70017a69a0aafdea641ea1cf3cb5b51f5b072` 提交完整 Markdown/AX 单交付区间比对及首末真实视口采证，八个文件；精确树 `51bd0e385818f1d6bf6c69a929b6c1b697fc8099` 94/0、规模检查通过。工作树 69 个原生文件 1429/0（源码指纹 `694ce79c9db4c5a7327be9d2418a6e41c9ac23ec74cd4cec6c20898744a9e5c7`），其后仅清理新测试 EOF 空行；原失败及候选 index 的 EOF 拒绝、README 部分暂存校验误把无空格追加当有空格而失败，均保留，不将命令失败改签成功。两提交均经正常 Git hook，原 47 项 WIP 保持，主 index 为空，未 push。

**实际结果分层不变。** 对 quality-02 原始 Provider 绑定回复与原始 AX 的只读重新分析，20 个完整语义单元逐项匹配；原 final 的首端仍不在视口、末端在视口。因此 `quality-02-markdown-reanalysis.json` 只记录机制诊断，不改原 failed、截图或 summary。quality-03（SHA `bfdd78cd99d5dd1bf24b021bd854c1fa2068850deb68eea9d6cfa733d9511f3a`）与 role-02（SHA `6b745299b79e356adf3be7b7aa615de28a8b8b357a0f47b0cec827a28d8afedf`）已按 §16.17/18 生成，仅改 id/evidence.dir，均未启动；没有消耗新作者发送或模型批次。

**不能以 R06 排期豁免现役缺口。** role-01 未交付 reason 含实际 character ref 和 64 位基线指纹；JP 当前只核来源与非空，不能拒绝这些内容。更早的 JP 流式发布在整响应接受前即可显示 author_narrative_delta，事后拒绝无法撤销已显示字节。角色候选应用模板则确定输出 narrative_role/ENSEMBLE_POV/PROTAGONIST，其他主角建议直接输出 character_ref；这些 body 由 UICards 实际展示。no_change 还把系统生成句覆盖为模型助手正文。上述是当前 R05 链的真实责任缺口；本节前向修订此前“R06 不推进”的排期，将必要消费者闭环提升为 R05 阻塞依赖，仍不签完整 R06，不把一次模型碰巧使用自然语言当机制证明。

**独立作者效果与不变量。** 作者能辨认实际目标和其他建议对象，以中文理解原身份、拟改身份以及“其他角色未自动修改”；对象、基线、采纳 effect、真实 ref/code 与 Canon 语义不因展示而改变。所有实际交付给作者的模型字段分别验收：最终选中的叙述、真实提问和选项标签均不可互相掩护；违规不发布、不改字节，沿原调用闭合并有界纠错；结构化引用与完整权威材料仍可用。模型最终有效原文和系统核对事实来源分立，同一结果持久化、恢复及历史只读显示不丢失、不重复；无变化仍零候选、零动作、零作品写入。合法自然姓名和作者原文不做全局枚举替换。

**共用规则与接收/发布责任。** 唯一规则源仍是 `display_names.json.forbidden_tokens`；根据实际 producer 补已出现的 ref、明确前缀的 base36 ID、message UUID、seg/break 身份及 64hex 指纹，不用“任何下划线字符串”猜身份，不另建正则表。既有 BE/FE codegen 同步生成物，离线 scanner 继续消费该源。在既有 Common AuthorVisible.Text 增加纯 narrative 校验，保持 Text.new 构造契约；只返回有效/稳定错误，不输出清洗后的文案。JP 的 content_narrative/tool_narrative 两个接受口覆盖普通 content、reason、ask_author.question、author_reasoning、continuation 及 degrade_to_reply；不只在 decode 尾部检查，不在一字段违规后偷换另一个字段。错误沿现 validate_response/correct_or_reject/correction_transcript、原 call_id 的 failed validation_result 和普通两次上限；不使用额外一次例外，不造新循环/新作者消息。JP 保持 planner purpose，但 Execution 与 stage sink 使用现有 developer visibility；原 Provider chunk/输出证据保留，通过校验后沿既有 source-bound 事件发布。Writer 正文的独立流式消费者不改；其它发布口若未验证，不能由本节代签。

**应用展示职责与实体复用裁决。** 现 NovelApplication.AuthorVisible.Presenter 已实际承载确认、取消、阻塞、工具失败和计划步骤的纯展示投影；现 Display 已有五种 narrative_role 中文名。角色三项纯模板归入该 Presenter，CharacterProfile 保留真实身份、观察资格、基线和结构候选；旧展示 exports 退役，不留兼容壳。PWF 传本次已绑定 target 与同次 roster，按真实 ref 取展示材料，不按姓名/别名反查；Presenter 投影不查询 DB、不持久化展示身份、不另建字典/组件。JP 前移的资格接受口消费一次既有 CharacterProfile.targets(work_id) 取得权威同作品 roster，不能把模型已读的部分目录冒充完整身份集合；其与已观察 target 的整份事实须精确一致，取读间变化即拒绝。展示需包含必要姓名、别名和身份特征；缺绑定材料或可见事实仍不可区分时不得拼 ref、序号或“该角色”掩盖歧义。现 JP.validate_response 已消费 CharacterProfile.bind_judgment，资格应在该真实接受口前移并复用原纠错回路，使模型以真实 ask_author 进入既有等待/回答链；未决展示歧义在本次 JP 有界纠错上下文中保留为接受条件，直到真实 ask_author 或重新通过同一身份/展示资格的有效角色决定；不新增持久化状态机、不从无范围历史复活旧约束。普通 reply、无关操作、再次无效 execute 或预算耗尽不能把未决目标冒充完成，也不能签为澄清成功。PWF 派发时仍核当时真实来源；后发事实变化不可通过新名字或新指纹兜底替换旧观察。

**系统事实复用现役结果通告。** ADR-0024 已定义并实际消费 `ui_cards.result_card`，其语义是系统已裁决状态的作者可读通告；DialogueGateway 有 producer，UICards.ResultCard 有无动作 renderer。它已随完整 TurnResult 持久化并由恢复链保留，故不新增 status_message 字段、system 消息、通知 ID、表或平行 ViewModel。PWF no_change 保留 judgment.narrative 原文，另交付一张明确“系统核对结果”的 result_card；角色名与中文身份来自已绑定事实。WorkspaceChat 在同一遍卡片分派中允许无动作 result_card 在只读历史显示，其余候选/确认/动作约束不放宽。不把 noticeText 这种临时状态冒充持久结果，不改旧批次或历史作者数据。VS-00M 与 R06 的“独立 status_message”措辞同步修为这一已存在的责任面。

**先行反例、验证与提交。** 独立手写真实 ref/指纹/跨 chunk 反例，证明原接受门及提前发布缺口；纠正后只绑定第二次真实输出，两次失败零候选，合法 ref 留结构字段仍可精确执行，continuation/降级不绕过。角色模板以同名不同别名/身份、别名相互重叠、roster 交换顺序、缺建议 ref、不可辨认目标和已过期事实为反例；payload 的真实 code/ref 与 other_character_changes=[] 独立断言。no_change 用与系统说明显著不同的模型 nonce/换行原文，证明逐字节保留、独立一张通告、持久/恢复/重复补水及历史只读显示；错误枚举展示的专属旧测试随实现退役。受影响后端、前端、生成物、离线扫描与流式保护先验证，再按责任分组提交并核精确树；JP、PWF、WorkspaceChat、VS-00M 的原 WIP 逐 hunk 保留，不整文件夹带。上述依赖闭合后才冻结新真实批次，质量/角色/G2/whole/style 的已登记预算不增加。R05 六目标与原 scope 工程出口仍未完成；R06 的全部输入投影、其它专业输出、其它规划入口及 B86 C9 完整实模/页面回归继续保留未完成状态。

**现役外部验收同步退役错误目标。** native B29 三个入口与浏览器 B29 的可见性断言仍要求页面显示英文角色枚举，T5-repeat 还等待旧候选；这些判据与本节作者目标冲突，不能要求产品保留泄漏或制造 no_change 候选。复用现 `authoring_character_candidate_evidence.mjs` 核同次唯一 pending item 的完整展示文字，独立要求老沈的可辨认事实、中文原身份→拟改身份、尚未采纳和未写入声明；可见内容仍绑定本轮真实 title/body，禁止另一卡片或背景文字补齐。禁止内部码继续复用 `display_names.json` 及现离线扫描 owner，不新建规则表。驱动按本次真实 pending title/body 定位，T5-repeat 等本次 result_card；旧英文目标与固定旧标题全部退役。真实内部 payload/ref/effect 和 Canon 断言不改。JP 合法纠错可能有先失败后接受的 execute；复用现 canonical validation_result 读取，只将原 call_id 已明确失败且顺序闭合的尝试排除，接受决定仍唯一、实际请求含已读详情、来源精确，未闭合或双有效 execute 仍拒绝。先用手写中文卡、缺正文、错误角色、内部泄漏及失败调用闭合反例验证，再改外部消费者；这些变更不增加实模预算或重签旧批次。

**反例审查后的责任补全。** 真实 ask_author 的 question 和 options.label 会独立进入 AuthorQuestion/动作面，故干净 content 不能掩护其中的非法标识；在现接受口逐项校验实际可见字段，错误仍闭合原 call_id 并采用普通两次上限。SSOT 的 allow 唯一值为空，已查出的消费者只有规则读取、生成物和专属测试，没有实际例外需求；退役这个无消费者的整段豁免字段及 BE/JS 分支、同步现生成器/契约索引，不发明新的例外制度。任何无关正常词都不能使同段引用或内部码免检。角色标题当前采用 HTML normal 空白，写入只 trim 姓名首尾、别名和身份仍可含重复空白；Presenter 按该实际展示面规范身份投影中的可折叠空白、别名规范后再去重复/排序，使仅靠不可观察空白差异的身份不能被当作可区分。规范仅作用于系统展示及同一投影的资格比较，真实 target/payload/作者原文与持久事实逐字保留。

**外部验收的真实归属补全。** 原始作者发送前基线与候选最终 AX/text/window image 必须内容绑定，verifier 从原件重算本次作者区间、精确 item 及裁剪视口，不以 driver 的成功标记代签；使用现原生 capture/reader、作者边界、pending 定位及视口 owner，无平行捕获格式。当前候选无按钮而另一候选按钮可见、当前正文在屏外、旧回合同文、作者引述候选均拒绝。纠错除 canonical 顺序，还必须核第一调用的完整 assistant/tool failed validation 确实供应给下一真实请求，缺回执/改参数/错 call 均拒绝。T5 重复指定的正式状态不变仍独立核验，同时要求当前结果零候选、零动作、一张系统通告与模型原文分立；不将旧“幂等采纳”命名保留为本次没有发生的操作。

**发布链与模型语言的适用性裁决。** 接收规则必须适合当前消费者：模型叙述只使用同一 SSOT 中能表达机器协议字段与引用身份的 protocol_codes/ref_patterns；“工作过程”等普通中文和 Stub/Strata 等合法姓名不能仅因固定 UI 文案的治理词表而被拒绝。产品固定文案 scanner 继续使用其完整类别，模型消费者不另建词表或词级豁免。成功 ask_author 的唯一作者正文是原生工具 question；说明和提问合在该原文字段，options.label 为独立可见选项。另份非空 content 即使字面相同也拒绝并按普通两次纠错，避免两个来源由 UI 选择性吞掉一个；prompt/schema说明同步，现 assistant_message/question 两个投影绑定同一个 question 来源，退役保护不一致输入的旧测试。Response 与 ProviderOutput 是同次输出的两种现表示，不能因 question 相同就默认 options 等完整参数同源；在现 AgentNarrativeSource 增加 verify_tool_call/2 供当前 JP ask 接受口消费，复用 Provider.decode_tool_arguments/1 与 RequestIR.json_value/1，核原调用唯一、名称/原 ID 映射/完整参数等价且字符串字节不改。原 ID 依 VS-00L 可缺省，canonical ID 不冒充原 ID；实际单调用位置与真实 Provider 身份共同提供无 ID 时的可证坐标，错映射、隐藏第二调用和多义均拒绝。不新建解析器、调用实体或推断来源。

JP 改为先校验后发布后，现有 judgment_decided 接受事件必须由现 timeline 消费，保持中间探索/执行说明可见，并按真实来源字段与最终交付统一所有权。查重确认现 reply_record 只带 call/raw_content/response_kind，TraceWriter 已原样透传该对象、trace_summary schema 允许扩展，缺的是同一个已验证来源对象的最终投影；因此 JP 在现 reply_record.author_narrative_source 透传既有 narrative_source，供现 timeline 按 run、Provider 身份、source_type、实际工具字段、哈希和字节范围核同源，不能从 response_kind 猜来源。不新建来源实体、ID、缓存或平行 trace；不得恢复提前流式发布、按整次 call 粗粒度吞掉其它字段。现 continuation 已保存 author_narrative/source，但 plan事件曾把机械步骤summary挂到该source下发布，必须在现交接点消费真实已接受文字：计划/步骤摘要仍为系统事实，不能冒充模型来源。用独立含nonce/换行的模型原文及不同机械摘要验证事件和最终工作台实际字节、来源与一次展示。上述均为当前 R05 发布链必要依赖，其它规划入口未核者仍不代签。

**提问选项的可辨认接收条件。** 46§9.7 的实际选择按钮只呈现 label，AuthorQuestion 按 value 生成动作并回传 choice_value；因此不同机器 value 不能依赖相同可见标签让作者猜目标，成功发出 ask_author 本身不证明已形成可回答的澄清。按当前按钮和角色标题的 HTML normal 展示面，复用 Presenter 已有的 ASCII 可折叠空白投影并归现 Common.AuthorVisible.Text，系统角色展示与选项资格比较共用；仅比较实际 choice 按钮的标签，要求投影非空且两两不同，不规范化 NBSP 或其它身份材料。现 ToolContract 承担纯选项接收规则，JP 保留业务上下文与普通两次纠错、原 call_id 失败回执；同标签、仅首尾/重复空白不同及不可见空白标签先以独立反例拒绝，未接受内容不发布作者流。材料仍不可区分时由模型提出开放问题，不能由应用追加 ref/序号或重写标签制造区分。比较投影不替代原 label；合法 question/options、Provider 原输出、动作值及持久作者答复仍逐字保留。验证复用现 Common、B29 角色澄清与 AuthorQuestion 回传责任测试，不抬模块 baseline、不增加模型预算或新实体。

**计划说明的实际消费者裁决。** 四个 b71-first-consumer 场景的预注册 recipe 只配置 Provider/维护预算，不固定业务 profile。正常已存章节修订走 JP→revise_adopted_content→PWF→Writer，但现合法 action=plan 且无 inline plan 会经 DPS→judgment_plan_v1→AgenticPlanDraftPlanner；现可用 work_archive_read 还会进入 readonly_batch_context 的同一起草入口。因此不能把该 Planner 的提前 author 流与作者说明接收口当作无当前消费者而豁免到 R06。plan_from_result、独立 draft/revise 在既有接受/NativeToolExchange纠错与来源绑定层校验实际选中叙述，错误不换字段；Execution/stage sink 采用 developer，完整通过后由已有 plan 事件交付。保留原 Provider 记录和各入口原有有界回路，Writer 正文预览维持其独立职责。此前 quality-02 实测走 explore/archive_read→explore/chapter_read→reply，仅证明那一轮未经过 Planner，不代表合法替代路径永远不可达。先独立反例验证真实标识、提前流及错误闭合，再统一验证；不据此签完整 R06。

### 16.20 真实作者交付反例：叙述受众与阅读顺序（实施前修订，2026-11-20）

**已核实的实现检查点。** §16.19 的规则、原始输出绑定、角色交付、提问唯一正文、完整来源所有权、当前 Planner 接受口与原生证据已按职责分组提交，末尾收束为 `c2b47b83`（补齐 hydration 测试的真实来源与三个反例）、`db1b11f6`（既有外部 driver 纯排版）、`1f721832`（既有角色 builder 与提问夹具职责）。HEAD `1f7218324cc9da3ffaf774c0bfd3185b0f9df37d`、全树指纹 `85d6404b8b7bd0535f1f781866d67c728d10b55c66a5f7065804de2a99cf443d` 上后端全量 3509/0（owned `1b2f894cacc0da82`）；前端全量 551/0、typecheck/lint/format 均有实际通过记录；精确后端提交树相关 62/0、Credo strict 无问题、规模检查通过。证据在本批 `recovery-20261120/{hydration-source-full-fe-01,hydration-source-exact-commit,native-driver-format-closure-01,backend-complexity-exact-commit,author-delivery-final-backend-01}/`。原 47 项 WIP 路径与内容边界核对保持，主 index 为空，未 push；这些检查不代签页面目标。

**quality-03 的实际结果分层。** 同一冻结源经原 scope 执行一次真实 Tauri／Splash 批次，owned `ce93cd0e631dc7a0`、94531ms、实际退出 0、binding 退出 0、执行前后源码相同。六项机制检查通过：一次作者输入、完整 accepted 正文进入实际分析调用、source-bound 完整回复、首末真实视口、零候选及正式状态不变等原断言成立。root 已查看 `r05-reply-start.jpg`（SHA `41476d56c9bb750e59433028b3bdf6cb401b1ebebfdf0692ca9b49e720716d7a`）与 `r05-reply-end.jpg`（SHA `469d6d06b5d0d3c7ae3bcf63625c36f45a56f83918ea654fb4b9a58c4ac3bdb6`）：分析依据三招制胜、未辨识频段、未见代价等具体情节，改进建议与原文区分。原 summary 保持其机制 pass 与语义待独立审读，不追改旧原件。

**不能由扫描绿灯掩盖的新反例。** 末视口另显示原始第一调用 `pcall_mwodo0a7_8` 的已接受 reason：“scope 已给出该章 ref，直接读取正文与计划”。这不是错误来源绑定，也没有真实引用值泄漏，但在向作者解释内部请求组织，未达到自然创作说明目标。更确定的独立偏差是该早期说明排在最终长分析之后，形成“分析完又准备读取”的时间倒置。46§9.4.2 已要求按到达顺序，46§9.5 明确模型叙述／活动／结论／最终正文与产物的顺序；当前 WorkspaceChat 却固定先放最终正文或问题，再放 AgentRunDialogueFlow。quality-03 因此不能签完整作者交付通过，R05 仍未闭环；取材和分析的成功事实保留。

**责任、查重与目标。** 不新增字段、模型调用、叙述源、消息、词表、解析器或状态。复用现 `JudgmentToolContract` 给实际作者叙述字段的 schema 描述明确受众与职责；现 `AuthoringTaskPolicy.judgment_rules/0` 两句自然语言规范可在原模块内抽为短共享出口，由原规则及 Judgment/AgentPlan 两个现役 schema owner 消费，原字面规则随抽取退役，不另设政策模块或平行文案真源；结构化对象／引用仍只承担操作参数职责。现 reason 是作者直接看到的依据和下一步，不能被当作内部调度备注；现 author_reasoning/question 的真实作者消费者按同一职责核对，已有充分描述的字段不重复堆提示。不得把 scope/ref 加成宽泛词黑名单而误伤合法姓名、技术讨论或作者原话；不得清洗模型原文、改用另一干净字段、恢复提前发布或隐藏整个中间说明。纯规则只证明已知协议形状与来源资格，自然语言是否面向作者必须另有真实输出的独立语义判断，不能宣称字符串检查已证明全部语义。

现 `WorkspaceChat` 是最终消息装配的唯一当前消费者；在该装配面把独立过程放在对应最终正文／问题之前，保留既有 timeline 顺序、完整来源接管、问题唯一所有者、取消未交付原文、历史恢复及候选动作归属，不另建 renderer。先在既有 whole-workbench ownership 测试中用手写早期说明与不同最终正文／问题建立时序反例，覆盖完成及历史恢复；同源内容仍只一次，不同来源即使同文也保留。验证必须从作者观察顺序提出预期，不能从新 JSX 布局反推期望。提示/字段说明的变更以实际新 Provider 请求与作者输出验证，不新增只断言提示字符串的镜像测试。

**前向验证预算。** quality 已实际消费 3 batch、2 次作者发送；保留 quality-01/02 的旧失败与 quality-03 的上述分层结果。完成修复及相关验证后，登记 quality-04 一次 batch／一次作者发送／零手动重试／900秒，用于同一质量场景的叙述受众与时间顺序复核；从 quality-03 仅改变 id 与独立 evidence 目录，作者原话、seed/hash、材料、正式状态、模型/runtime 与阶段超时保持。冻结 `native-preregistration/quality-04.json`（SHA `079f7be4012a6bbfc39805b042330d4a1073d706c354f16d6be702136b5690aa`），相对原件只改上述两项；现执行协调器仅追加其哈希入口，原协调器字节在 `recovery-20261120/author-delivery-followup-registration-01/` 留存。累计登记 4 batch，只执行新增一次，不结转旧发送，不修改旧 binding。role-02、g2-01、whole-01、style-02 四批均未执行，原预算不增加。源码再次封存后才执行，最终工程出口只能绑定最终实际同源成功 UI 证据；count-03 与 quality-03 不重签到新源。

**最终成本证据。** §16.9 七对实际字节只属于其原 source；当前字段说明变化不能借用旧 after 数值。复用现固定构造 driver、snapshot restore、runtime 与 analyze-pairs owner，在新证据目录以相同新 recipe 重做 before/after 共14次封闭构造，before仍为原冻结源码及原始初态；各臂独立构建、独立恢复库、真实运行模块/Repo位置和完整source前后身份均核对。封闭 transport 合计16次内存响应、0次真实模型调用；不改原 capture 或比较规则来放过跨recipe身份。仍只报告实际请求字节与材料/原文重复，不据此宣称 Token、缓存、延迟或文学收益。上述修订不签 R06，也不缩小 R05 六目标。

### 16.21 N-NARR 验收入口与接受后交付契约对齐（实施前修订，2026-11-20）

**真实检查与失败分层。** HEAD `d4749e5ebc3e2d7e63eb04b1abfd70bb6a8236ca`、全树指纹 `1ba30b08764faacd00aeab2e67c741a0748fd49afc6ba2e6434a0f05c2cef8c5` 上，`mix check` 的全量强制编译、codegen、枚举、编译环、3509/0 测试、架构、ADR 与 I-CACHE 检查通过，I1/I2/I3 独立驱动通过；前后源身份和 47 项 WIP 相同。root 首次将 N-NARR 单独放入新的 owned scope，却漏接既有 `novel_test_db_prepare`，实际因缺 `provider_runs` 表而超时；原失败及 driver 原件保存在 `recovery-20261120/author-delivery-final-check-02/`。随后在新隔离库经同一现有迁移入口执行，得到真实契约失败：`no streamed author reasoning deltas were emitted`，证据在 `n-narr-migrated-check-01/`。该次已有 `judgment_decided` 的完整原文字节绑定通过；不能把缺表与此后真正的验收偏差混为一谈。

**独立目标与反例。** 作者必须得到经接受的真实模型说明，说明逐字对应同一实际 Provider 输出与正确来源坐标；有效交付不能被全部隐藏。判断或计划尚未接受的 Provider 片段必须保持 developer，不能先向作者外显再撤回。固定原文须由场景事先给出，包含可辨认的中文、换行与 nonce，期望不能从实际事件反推；错误 run/call、字节范围、源哈希、模板替换和缺失有效交付均不能取得通过。当前路由无需凭空产生流式作者前缀；存在 provider chunk 与接受事件也不等于来源和作者归属正确。Writer 正文预览的独立职责不因此改变。

**唯一责任与复用裁决。** §16.19 已明确 JP 及当前可达 Planner 的 Execution/stage sink 为 developer，验收后由现有 judgment/plan 事件交付，不得恢复提前发布。现 `run_n_narr.exs` 的真实入口是 `profile_routing → judgment_loop_v1`；它仍以“至少一条 author delta”作为成功条件，并保留未被当前单轮消费的旧 `conversation_turn_v1`／plan fixture 分支。对现 driver 作 `refactor-and-retire`：以真实当前消费者校验接受后字节来源及未接受片段的可见性，复用现 `AgentNarrativeSource`、Provider 契约与运行事件，移除只保护旧提前发布假设的断言和无实际消费者的 fixture。不得只删空流断言、另建来源 parser／事件／registry／业务开关，或把生产发布规则改回去迎合 driver。固定坏证据必须实际被拒绝；不以 driver 自报 PASS、数量增加或同源构造期望替代这一判断。现 Planner 的专属接受与纠错路径继续由邻接测试和实际可达证据承担，本单轮 driver 不冒称覆盖全部 Planner／Writer 或完整 R06。

**实施与出口。** 修改限于既有 N-NARR driver 及确有必要的同一入口说明；先核输出与 fixture 的现役消费者，无新实体则记录 none。保留上述两次失败，在正确隔离库前置下运行重构后的 driver、既有相关叙述/投影测试及格式/规模检查，再按独立审查过的精确提交树分组提交。该验收修正不增加任何真实模型或 native 预算；source-02、quality-04 与其余四批、14 次封闭成本构造均继续等待最终源码封存，旧证据不重签，R05 仍未闭环。

### 16.22 角色实测后的来源交接、公开说明与验收协议收束（实施前修订，2026-11-20）

**已经成立的证据。** N-NARR 经独立审查、102/0 邻接测试及精确提交树实际运行后提交 `e483474b869d9365b098e3aad85a976db2928503`；退役旧无消费者分支，423 行现入口保留 hostile chunk、固定原文、完整 ProviderOutput、接受后交付及九类坏证据。source-02 指纹 `acce988d489b6f74e81799789b7e721971366a4eef8e41e4d2aa0d55911570d8` 上，quality-04 一次真实作者发送、三次实际调用，owned `046ce431ea81793b`、95710ms、exit/binding 0；完整378字符正文、具体分析、两次说明在最终分析之前、零候选及正式内容不变均经原件和首末真实视口审核。本样本可签质量/作者交付通过；第一说明略机械、分析将叙述镜头位置当人物位置及把计划预览当硬上限的过强解释仍记录，不签 I10 或整个 R05。`native-runs/quality-04-posthoc-review.json` SHA `c9e9b4943b81229699cfbd2a255299837873b03dec04488417da9f23f14011ce`；旧 quality-03 失败不变。`cost-final-01` 同源14次封闭构造、7 paired/0 unpaired、0真实模型；六项首次请求比 before 增3600–3602 stable JSON bytes，whole-writer增904，不能宣称成本下降。原一次外层把 completed 误写为 captured 的核对失败保留，首项未重放；完整原件与修正核账见该目录 completion/execution-reconciliation/outer-verification-correction。

**role-02 的真实分层。** 同一 source-02 上一次输入“指定老沈为主角”，三次真实调用完成目录→详情→候选：目标为沈砚／老沈／灯楼查账人，八字段及21/21字符摘要进入第三次真实请求，唯一 TENTATIVE 候选只提出 ENSEMBLE_POV→PROTAGONIST；同名小沈、既有主角顾青及正式角色/记忆/正文保持。T1 与 final 已实际捕获，root 已查看候选视口（SHA `6ce3d089a6f144e85c40453a07cdb5d66a1e68f2212e09e686702b84312dcf00`）。随后真实收尾在 workbench.writeUiComplete 因 jsonWrite 未绑定而失败；owned `1a7f4a69a3348047`、39349ms、exit 1，summary/完成标记缺失、binding拒绝，清理 remaining=[]。现角色证据 owner 还因旧接受假设误拒绝实际 passed 回执。作者面另有内部指纹说明及同源重复交付，故整体仍 not_passed。独立 `native/role-02/role-02-posthoc-review.json` SHA `88d272792419a455b1e212981362674664486bd8c881a655c5f0c6413a497363` 保留上述各层，不补造旧完成文件、不重签旧结果。

**同一来源只有一个最终交付所有者。** 独立原件证明第三调用 pcall_mwofsdqj_s/prun_mwofsdqj_t 只有 judgment_decision.reason，没有第二作者字段或独立content。333 UTF-8字节、SHA `9eba536b4807060b0ef5fc07adff360ac5de834b8788666b21490123d564f2d5` 的完整来源在接受事件、WS和HTTP恢复中均保持；PWF却将该 judgment.narrative 复制成最终正文时丢弃其已有 reply_record/narrative_source，并以空 summary 构造结果，持久化与广播 trace_summary 都为 {}。责任层是现 PWF 最终结果装配：公共 frame 保留现已验证来源，结构候选、角色候选及 no_change 都先形成真实最终 frame，再消费现 TraceWriter.record 返回的 summary 交给 TurnResultBuilder。现 frontend 全来源所有权规则继续消费既有 trace_summary.reply_record.author_narrative_source；不新建来源字段、解析器、缓存或按文本/call猜测的消重规则。

**必须保留的反例。** 原始两次独立探索说明仍在最终正文之前；同call不同字段仍是不同来源；没有最终交付或取消时过程原文不能消失。no_change 的模型正文与独立系统核对卡保持各自职责。maintain_refusal_result 则会把模型正文换成应用拒绝文本：必须先确定实际应用正文，再生成不冒领模型来源的 trace/result，不能在公共 frame 增加来源后把原模型 record 留给另一份系统文字。复用现 PWF/B29 与全工作台所有权测试，以独立固定原文和来源坐标先建立失败，验证 frame→trace→结果→持久化/广播及当前/恢复交付，不从新结果反造期望。

**同一 frame 的单一来源承载裁决（2026-11-20，提交前纠偏）。** 首份 PWF 冻结稿参照 DPS 形状，在 `evidence_summary.reply_record.author_narrative_source` 外又写顶层 `evidence_summary.author_narrative_source`。全量生产读点复核证明，TraceWriter 只读取 reply_record，TurnResultBuilder 读取既有认知字段及其探索计数，最终页面读取 trace_summary.reply_record；顶层副本只有赋值和整 map 持久化，没有当前独立消费者。DPS.judgment_frame 的同形赋值不能替它提供必要性依据。按 VS-00M 的事件/最终交付职责和 VS-00D 的回放目标，PWF 不新增这份副本，DPS 现存的无消费者 frame 顶层副本也同批退役；现 AuthorQuestion 已使用只携带 reply_record 的同一有效链路。接受事件 payload 与 planner meta 的来源各有当前消费者，继续保留，不能因同名而一起删除。最终原文来源在 frame 内只由既有 reply_record 承载，沿唯一 TraceWriter/脱敏 owner 交付；没有兼容双写、alias 或新解析器。首份冻结和测试证据保留原身份，修正后重验当前消费者及原文/广播/恢复，再生成新冻结；不得把旧冻结重新盖成已修正版本。

**公开来源边界的反证复核（2026-11-20，调整测试前）。** PWF 三类模型正文来源正例已通过，58 项邻接测试却有一项因公开路径 `trace_summary.reply_record.observation_refs` 命中全树同名键禁令而失败；`pwf-source-handoff-01/green-01` 原件保留，不能把测试禁键直接当成目标。VS-00D §11.4 要求必要的真实取证 refs/coverage 随来源持久与回放；ADR-0014 要求应用层经 TraceWriter→TraceRedactor 形成 author-safe 摘要，禁止 raw prompt、私有 thinking、敏感上下文与未脱敏工具 I/O。当前 JudgmentProtocol.reply_record 只从实际 observations 投影 refs 和 tool/chapter/range/count 覆盖坐标；公开摘要既有 owner 不变，Why 仍选择作者解释字段，Timeline 消费完整叙述来源，不新增 PWF 白名单或复制私有 RequestIR。B71 当前独立 fixture 没有 explore，故该唯一路径必须实测等于空列表；其余位置同名键及原内部容器禁令保持。修订过宽断言要辨明路径与内容，不能全局删禁键、先移除数据再扫描、以现有结果反推预期，亦不声称本空列表场景覆盖非空取证内容的所有情况。

**共同 frame 的应用回执消费者复核（2026-11-20，修正前）。** 除 maintain_refusal_result，discard 分支也消费共同 frame：实际最终正文来自既有 AdoptionWorkflow.handle_discard 的处置回执，执行前模型判断应留在过程。新来源交接不得让该应用正文冒领判断模型的 reply_record。与拒绝出口同一原则，在 frame/trace 形成前确定真实回执正文并去掉不属于它的模型 reply_record/narrative_source；不修改模型原文或已接受过程事件。复用既有放弃消费者测试，提供完整已验证模型来源作为反例，验证最终应用回执不带该来源、真实处置事实及原过程说明保持。必须逐一核对共同 frame 的其余当前调用者，区分沿用模型正文与另造应用/Writer 正文，不能仅修首次显露的分支；无新增生产实体、来源解析器或通用兼容分支。

**作者说明的语义职责。** role-02 第二条 reason 原文把“当前指纹／修订基线”作为给作者的说明；它在本语境报告内部版本校验，不能靠来源真实或扫描无ref判为合格。复用现 AuthoringTaskPolicy.author_narrative_rules 及其当前三个消费者，在唯一规范中明确创作判断/材料/下一步与工具参数、引用绑定、指纹/版本校验的受众边界；作品里同名概念、作者主动询问机制仍按其真实语境讨论。不开新叙述字段、不改选中来源、不扩词黑名单、不清洗或代写模型原文，不增加语义判断模型调用。规则不机械保证所有未来自然语言，修正要由新原生角色样本独立审读，不能以提示字符串测试签通过。

**现角色证据 owner 的接受契约。** 实际 canonical 成功回执为同一 call 的 validation_result、status=passed、reason_code=judgment_validated；现 owner 只接受“没有validation回执”的execute而错误排除它。应在现 authoring_character_candidate_evidence 的既有回执读取/选择点消费明确的成功/失败状态并与实际接受来源、capability、目标及当前候选相互绑定；成功验证不等于采纳或正式写入授权。退役无回执即成功的旧假设及只保护该假设的fixture，保留失败调用→实际下一请求回执→后续合法选择的完整闭合。用独立的通过、失败、缺失、错call/目标及前失败后成功反例验证，不另建ToolResult解析器或放松字段/材料目标。

**原生完成文件的唯一生产职责。** 查重确认 jsonWrite 已在 driver.mjs，writeUiComplete 是 B29/P1/B30 的现役消费者；workbench其余14个操作型导出均零外部消费者，包含同样未绑定findByText的死分支，应退役而不续接。保留 flatText，将既有 writeUiComplete 收束为完成文件共同owner并复用jsonWrite；现 NativeScenarioHarness 方法薄委托它，退役第二处对象构造。三个直接driver都已有实际绑定的APP target，同批迁为必填target；统一保持现已存在的六字段形态，app_bundle来自真实target，input_target原样保留，不保留固定bundle/无target旧分支或通用extra。真实target验证仍归原输入/采证owner，不能由完成文件自报替代。复用既有 B29 evidence 与 scenario_driver 测试的临时目录，直接调用两入口真实落盘，对手写字段、不同bundle和完整target核验；旧missing import必须先产生实际红灯。同步实际README，不新建扫描平台；其它日志写入职责不扩大。

**前向执行与证据。** 新实体 none；以上均为现owner的复用/职责收束及死入口退役，原47项WIP按路径及增量保留。修复、独立审查、相关门禁和可review中文分组提交完成后重新封存source。role已实际消耗两batch、两次作者发送，前向仅登记role-03一次batch／一次发送／零手动重试／900秒；同原话、seed/hash、T0/T1候选模式、模型/runtime、阶段预算，不采纳且不扩大到T2–T5。登记只改id及独立evidence目录，原协调器保留前件后追加该单批入口，不重置旧消耗。g2-01、whole-01、style-02 原三批未执行，预算不变。新增语言规范会改变请求，旧cost-final-01保留其source身份，最终源码再以既有owner另做同recipe14次封闭构造；不得给旧capture换source标签。所有旧native、source-02与失败原件不重签；R05仍未闭环，R06不在本批。

### 16.23 source-03 实测反例与现役接收职责重构（实施前裁决，2026-11-20）

**本轮真实结果。** `c879eb262832f3363362025f7304428c5ba2c64e`、source-03 指纹 `39bdc8249efc0d2aaeff7af2471f50279f0df8aacfd0bfaf46651117c6c6561c` 上全量后端检查 3509/0，执行前后源码一致，原47项WIP增量保留。role-03 一次作者发送，owned `2b0c21f007fa2574`、86586ms、执行/binding 0，25项机械检查通过；目录/详情/真实下一请求、老沈唯一候选、正式状态保持、最终说明一次交付均有原件证据，但第二次 Provider reason 含“该 ref 的详情作为当前基线”，245 UTF-8字节、SHA `bfca5483af67dd164261ca51127da54d415607e12d5ff082705187e7802711c2`，真实作者AX可读。该次请求的system和字段description已经包含新版语言规则，故不是未接线；本样本仍 FAIL_AUTHOR_VISIBLE_LANGUAGE。独立可见/语义审查分别存 `recovery-20261120/role-03-visible-review/`、`role-03-semantic-review/`，原summary不改签。

同一源上 g2-01（owned `f14df78c0170ca0a`，125249ms）实际交付目标段候选，但 Writer `pcall_mwoj59yu_a4` 的 `items[0].rationale` 原文包含内部段标识，页面“创作依据”原样展示，driver0/runner1。两个真实分页观察进入各自下一请求的事实成立；返回自报另包含无本次Base/Observation授信的作者message来源，不能把材料读全等同使用声明合格。现audit-g2原样执行退出1，缺证及usage未验证保持；其只读SQLite reader生成的-shm/-wal另记入派生审计，原52份证据字节未改，不删除副产物掩盖执行事实。

whole-01（owned `236cd1b0a7f22d20`，103236ms）交付整章候选，完整7000字符基线在Writer请求出现一次、whole_chapter/replace_scope成立；原验收为driver0/runner1。作者实际最终说明236字符/692字节且与来源相同，但现reply surface把“生成草稿”结构标签并入正文，并错误定位首末截图；refs reader又因observation_refs的实际引用形状把同次Base一起置为unknown。两项需修判据，不是用现结果放宽目标。候选rationale中的“chapter_read”仍须独立审语义，不能由纠正采证推导作者交付PASS。style-02（owned `5ddd9ae4ec077492`，37256ms）一次作者发送、三次实际调用，先接受目录探索，再拒绝同响应两个judgment_decision及后续违规作者叙述；真实run失败，未交付候选，driver/runner1、无summary。保留整个失败与原call回执，不补造成功收尾。三批源码均前后不变；风格、整章和目标段的完整目标仍未闭环。

`cost-final-02` 在source-03完成14次封闭构造、7 paired/0 unpaired、16次固定内存响应、0真实模型；六项initial比before增加4657–4659 stable JSON bytes，whole-writer 65985→67040。逐调用实际加载记录为2194个非空BEAM项和140个Mix定义项，共2334项；不得把总项数称为BEAM数。报告与303份证据封存，仅对source-03有效，不向后续源码重标。

**独立目标与反例。** 作者得到有用的作品判断、取材目的及下一步，使用实际作品/角色/章节名称；操作字段与作者回应职责分离。每次模型决定只有一个明确的作者正文来源，原文字节、Provider坐标、接受后发布、过程时序、最终持久恢复与不同来源归属保持；系统结构和处置事实不冒领模型正文。相同结构化只读操作不得因说明包含“不会保存”而改变可执行性。候选使用声明必须绑定同次实际发送请求的Base或已成立观察，作者source、未读ref、未来观察和其它调用材料不能升格授信。错误声明或违规作者说明应在原工具调用接受前拒绝并进入现有有界纠错，不能先发布、清洗、删去坏引用或以另一干净字段替代；小说正文的创作职责不被一般词黑名单压缩。来源真实、schema合法和材料齐全都不能各自代签自然语言质量。

**判断/计划唯一正文与计划入口。** 现judgment_decision/continuation_decision.reason已经被schema声明为作者文字，却又由JP的写意图正则参与只读操作裁决；content优先、工具文字兜底还要求模型生成可能无人消费的第二份说明。paired plan要求同次judgment_decision(action=plan)与agent_plan_draft各写一份说明，DPS/Planner随后分别消费，当前前端虽能合并同来源交付，但该协议仍不必要地要求两份作者文本。复用现author_reasoning字段，完整退役这两个工具的reason字段与措辞驱动的只读正则；普通reply保留原生content，ask_author保留question，其余判断工具与现计划入口只从各自明确的author_reasoning交付。工具响应另带非空content即冲突，沿现接受/纠错口拒绝，不按优先级吞掉一份，不保留旧字段alias或双解析。

计划选择、计划结构及作者说明由已有agent_plan_draft单工具承担，退役judgment_decision中的plan动作及强制双工具组合。保留现Planner接受、inline_plan_meta、JudgmentPlan与plan_drafted/plan_revised、只读取材计划回到判断的真实消费者。plan的现dialogue_goal没有独立消费者，不迁成共用draft/revise的新必填副本；实际run.goal及steps继续承担目标与计划职责。三wire均已支持无content的单工具输出，Provider/IR仍忠实保留原始合法或拒绝响应，不在adapter改写；不新增并行工具参数、供应商能力声明、隐藏循环或内部思考字段。直接对作者沟通的角色定义与字段说明同步收束；重命名和提示均不承诺任意自然语言自动合格，实际新样本仍必须逐句审核。

**Writer同次返回声明与作者说明接收。** CreativeProvider.Real的generate_with_session已持有Operation.prepare后真正发送的IR，现NativeToolExchange已承担原call_id失败回执和既有两次上限。把返回used_context_refs作为待验声明，在这一真实接收口复用RequestIR现有used⊆Base∪Observation判据；只用该次IR的真实边界，不用较早ToolRequest、Scope.source_refs或跨调用累计集合。现ToolOutputContract不得把坏引用形状经string_list丢弃后当空声明通过；明确拒绝坏形状，保留其余非权威质量意见的职责。现TurnExecutionService的事后unbound记录只是审计，不继续作为接收保证，也不在PWF各分支新增一套授信器。

复用同一creative item契约和Common.AuthorVisible.Text校验实际给作者看的rationale，不对小说body施加作者说明专用约束、不代写title/body。Writer、判断与计划需要的短语言规范复用已被application和agent消费的Common.AuthoringSemantics；若迁移现AuthoringTaskPolicy规则，旧出口同批退役，不能让agent反依赖application或新建平行规则表。规则的结构检查能力边界保持公开，“该ref”“chapter_read”的真实语境仍独立审核，不靠扩大宽泛词黑名单获得绿灯。

**应用固定说明与外部证据owner。** role-03卡片“只修订既有角色主档案字段；不新建角色、不写正文、不写演化记忆”来自PWF工程常量，不是模型reason。现Presenter.body已经表达中文差异、未采纳与未修改状态，item.rationale允许缺省且UICards已有条件渲染；退役这份重复工程说明，保持真实payload/ref/effect和既有可见状态，不改全局“创作依据”标签或另造系统文案。

外部原文采证继续由现r05ReplySurface/语义单元比对/当前作者边界与首末视口owner承担：排除结构标签而完整保留实际作者正文，拒绝别的回合、过程说明、另一候选或背景同文补齐，不添加产品验收hook。Request refs读取按当前RequestIR.ref_key已有合法引用形状核同次明确登记，成功观察仍须前置唯一调用及同请求结果；缺证、坏形状和已证越界分别报告，不能全局授信source。修正后的派生审计不覆盖旧summary/binding/截图。旧wrong-path的role-02完成文件检查已另存completion-path-correction，真实native-ui-complete仍缺失，原失败结论不变。

**七问、查重与实施顺序。** Contract为VS-00M §6、现判断/计划工具契约、CreativeProvider返回契约和RequestIR引用资格；Invariant为上述单一来源、接受后发布、真实同次引用及作者采纳边界。Boundary限当前common/application/agent生产接受者与既有外部验收脚本，无数据库/新持久实体/Provider wire改写；Consumer为本批真实判断、当前计划、G2/whole/style Writer及工作台。Proof先以独立固定原文、含否定词的合法只读操作、双正文/双工具、错run/call/引用/非法rationale、缺失或坏形状声明和错误采证建立反例，再穿过真实接受→纠错→候选/事件/持久恢复验证；测试不以实现派生值反推目标。Acceptance Driver复用现B29/B71原生入口；Exploration继续使用现目录/正文/记忆观察、同次回流及预算，不添加专用packet。新增实体none：现字段/工具/规则owner复用并退役旧入口，现错误测试随契约迁移；各文件原WIP精确增量保留。

先按职责修订契约并实现上述可独立review部分，运行相关反例、门禁、精确提交树检查后分组中文提交。现已登记native预算均已消费，后续修复复验必须另行前向登记单批/单发送/零手动重试，保持原输入、seed、模型runtime及上限，不能重用旧目录或重签source-03。最后统一冻结源码，复核真实作者效果、材料和引用、最终成本与原scope工程出口；R05仍为未闭环，R06整体不在本次签署。

### 16.24 接收边界实施、独立反例与前向复验安排（2026-11-20）

**本批来源与范围。** 从 `74254680a649cb52be5c1a8ad1d3afc9a0b0231f`、`develop/dialogue-based-novel-workbench` 承接 §16.23，开始时索引为空、原48项WIP保留。实施前另以真实 `task_done --begin` 建立 `artifacts/slice-verify/b87-r05-reception-20261120/scope.json`（scope `1a2a5406-ba5f-45b8-9b33-e5e62bcf330f`），用于本轮增量与原WIP核账；原R05 scope、所有旧批原件及其失败结论不覆盖。当前只推进R05，不因局部门禁通过改签R06。

**存在性及职责审计（初始接收边界）。** 此阶段新生产module/struct/表/列/Tool/事件/持久实体为none；后续规模复审裁定的纯ExplorationPolicy及窄测试模块另见下文，不将初始裁决沿用为整个批次的新增清单。判断与续行退役reason及措辞驱动的只读开关，复用author_reasoning；计划复用agent_plan_draft，退役双工具、第二次隐式起草与双正文优先级。短作者语言规则迁入现Common.AuthoringSemantics，语义版本更新，原应用规则出口退役。Writer复用NativeToolExchange的实际发送快照、既有两次纠错和原call_id结果闭合；不创建独立引用资格表。现RequestIR.Observation新增的可用引用投影以CreativeProvider.Real为直接消费者，复用已有Compaction与观察叶遍历；RequestIR既有子集校验继续是集合判据owner。计划读取的逐叶材料与真实observation_id/step_ref复用AuthoringSession.record_exploration_result，不保留第二种聚合观察构造。外部reply/ref/plan证据只修现有reader，不在产品中增加验收钩子。

**独立反例对设计的收紧。** 引用目录并不等于材料已提供；历史允许目录含未供应或已覆盖的ref。因此当前Writer声明必须基于本次实际发送、经Compaction后可见且已登记的观察，聚合父与叶均须有效；历史完整性校验不被改造成“当前仍可用”的判断。ok/partial/truncated可声明实际已供应部分，保留原覆盖与缺口，不授予整章已读结论；stale/unavailable拒绝。只声明合法Base不得因历史中有失效观察而误拒，既有守卫只检查used−Base。另一个独立反例证明：相同工具参数不能掩盖中间结果删去原生content；现AgentNarrativeSource绑定同时核完整参数、原调用与原始正文，null/空串只在无正文时等价，非空原字节不得改写。以上在VS-00M §6同步说明，不由测试重新定义作者目标。

**已经发生的局部验证。** 原计划正文红测7/5失败；Writer形状与作者说明、Exchange快照反例先失败后修。Writer及相关契约局部141/0、计划消费者61/0；观察接收补测现13/0，Common相关66/0。观察红测中部分初稿曾先撞到空消息/缺回合坐标，已改成合法历史并显式对照旧目录校验接受与Writer拒绝，不能把setup失败当作接收证明。来源第二正文反例8/1失败，修复后来源/计划/实际材料六文件34/0。Stub13/0；SliceVerify新协议六项先6/6失败，正在迁移；应用核心42/6失败中四项涉及未迁移替身，另外两项分别揭示真实观察身份桥缺失与退役降级假设，已沿原owner修复。外部既有91/0、计划与行为49/0，截断观察新增反例18项先2失败后18/0。证据均在本批独立目录，失败日志不覆盖。完整后端、工程门禁、真实工作台与最终成本尚待，以上不签R05 PASS。

**完整回归新增的执行反例。** 首次全后端3541项有31失败，集中在应用层；其中纯读计划可绕过普通探索预算并重复读取，是生产缺口。独立JudgmentProtocol反例93项中3项按预期失败：探索关闭、剩余额度不足、工具未开放时单计划仍被接受。实施裁决先同步VS-00M §6：把现DialoguePlanningService预算/续页资格与计划分类迁入现ExplorationService，普通探索、计划接受与计划执行复用同一门禁；机械准备步不计读，依赖未来next_offset的预排页不能获准。CP4必须以两次实际读取后返回的真实next_offset提出第三次续读，仍核三叶、完整覆盖及来源闭合；B31纯取材后根据真实观察收束，context-only短计划仍由真实运行时补充创作步骤，不混淆两条路径。新增材料反例也暴露成功状态下仅tool/query/空facts会被误授信；沿现AuthoringTaskBuilder实际供给判据迁入共同Observation owner，事后与接收共享同一资格，外部证据读取同步核实际材料和同请求登记。以上反例修复仍须后续绿色验证，不把本段裁决记作通过。

**归属与计量反例。** 应用计划读取的材料继续归Base，不能因错登observation_refs而升级为原生工具观察；接收反例已证明旧投影会接受application-only声明，修复仅收紧现usable_refs来源，Builder仍共享实际材料资格。外部reader另须复用既有会话压缩投影识别已覆盖工具观察，不因仍留在历史/目录而授信。Writer纠错测试还显出现TurnExecutionService将有回调简单记为上限1：按VS-00L §16.7，其provider_call_budget应消费现NativeToolExchange有效上限，实际消耗仍由session.execution_counts独立给出；不能为通过断言把消费数冒充预算或把允许上限压成1。修复与绿色验证另记，旧失败日志保留。

**完整工程回归第一轮（full-check-01）。** 强制零警告编译、枚举/作者文案生成一致性、compile-connected环、架构检查、33/33 Accepted ADR、三wire前缀共享门均通过；完整3552项测试有19失败，全部位于应用运行流程。反例揭示五份局部计数把允许上限相加成消耗并把缺失/零值强补1，导致运行过计数甚至提前预算停等。按VS-00L既有语义，收敛到现AuthoringSession的实际execution_counts投影，五份副本、角色设计工具名硬编码及确认局部getter统一消费；不增加预算结构、不改变AgentRunServer累计owner，不改真实计数断言迁就实现。新修复仍待绿色回归。第一组独立证据提交为06ff02c2，候选提交树60/0且普通hooks执行；原WIP未暂存，未推送。

**交叉审核的接收与审计边界。** 隐藏应用读取的合法历史反例3项中1项失败：旧Scope已被checkpoint覆盖，新Scope只有关联source_refs，Writer仍借累计Base接受旧材料；本次明确重新供应和另有可见应用实读两个合法同ref对照通过。修复须复用同一可见性owner，并保留同ref确实仍可见的独立Base，不以新Scope关联目录充当实际供给。另一条独立真实原生观察反例1/1失败：AuthoringTranscript自动登记的content.observation_ref已在Writer同次请求被合法接受，TurnExecutionService却因仅投影source_refs而在trace漏记；原生观察审计先改消费现RequestIR.usable_observation_refs；随后Base亦按下述消息绑定裁决统一投影，退役原材料目录推断，不造第二套资格判据。计量局部回归60项余1失败；D1旧断言把未执行评审的允许次数计为失败Writer消耗，现通过真实Provider回调次数独立核查，不以预算反推次数。所有失败原件位于本批独立红测目录，以上设计及修复不等于验收通过。

**Base 供应事实的归属裁决。** 反向审查否决逐类解析authoring_task/facts/mission及历史撤销补偿的方案：这些都在恢复生产入口原本已知、但并入目录时丢掉的信息。存在性审计确认现Operation.prepare与AuthoringTranscript.append_scope_update已有显式base_refs入参，现消息仅缺其供应归属。复用现canonical消息，以同名base_refs元数据定位实际材料；当前资格由RequestIR经Compaction可见投影与登记集求交，Real接收、TES审计及外部同请求证据均消费这一事实，不从source_refs或业务载荷猜来源。初始Scope必须持有自己的绑定，职责Base不能冒领；纯文本材料绑定实际application_base。判断去重也须比较当前Scope实际绑定，不能因历史目录已有ref吞掉新供给；应用读取使用共同Observation状态/内容资格。Transcript已有base_refs键的递归codec、会话消息JSON和前缀比较能完整保存，无新表/列/module/struct或格式fallback。新增验证覆盖：合法历史隐藏拒绝、同ref当前/其它可见材料重供接受、再覆盖撤销、仅目录/关联来源/非应用消息拒绝、真实空读与失败读取区分、恢复后资格不变。先核这些边界，再继续全量门禁与冻结。

**计量分组与供应对照验证。** 实际消费与Observation身份回归61/0；第二组普通hooks提交89b5190d只含10个计量相关文件，精确候选树bfc0cf55独立构建，相关54项与确认规格8项共62/0、格式通过，未推送。新Base外部独立反例4项中3个false PASS已证实并保留原日志；产品完整相关文件112项尚有4失败，Professional的可见/隐藏/关联来源/同ref重供/JSON恢复已通过。剩余失败必须区分真实资格缺口与测试构造：空字符串已有invalid_text_block，纯空白绑定仍需独立拒绝；无内容块或仅含不会投影的非文本块不能供应Base；新压缩fixture曾缺消息来源身份，改用现Compaction.evidence机械构造合法历史，不能修改生产压缩门禁取得绿色。阶段验证不替代完整工程门禁或R05实模裁决。

**供应边界与完整工程绿色验证。** 前述112/4的四项剩余问题已分别核清：纯空白/空块/非文本应用Base是真实供应缺口，沿Scope现有校验拒绝；失败观察须使用真实failed输入映射到unavailable，覆盖预期保留已有nil字段，判断夹具使用其真实work_id。未新增状态别名或放宽生产门禁。`base-binding-green-02`相关完整七文件115/0；`full-check-03`工作区完整3575项、0失败，强制零警告编译、codegen、枚举lint、compile-connected环、架构、ADR 33/33及I-CACHE十对（三wire）全部通过。`invariants-02`显式MIX_ENV=test：I1四项通过、I2三对独立、I3决定性Layer B为3/3（参考Layer A仍0/3，不记作通过或实模证明），N-NARR原生正文绑定通过。owned runner均实际exit=0、tree_finalized=true。中间`full-check-02`曾有一次持久层双连接Task.await超时，原日志保留；同seed整文件14/0、未改该生产实现的后续完整3575/0，尚无证据定位锁持有者，不宣称已修复并发竞态，也未加重试/放宽timeout。源与原WIP的独立提交树验证另记。

**后端协议迁移的精确提交。** `backend-core-01`完整3573/0，但四个测试文件的只读格式检查失败；原结果保留。仅修正这四处排版后，`backend-core-02`另建完整checkout，未复用任何工作区Novel BEAM，精确tree `f7b12d5a768fcd936152730112ee32d0c10cdabb`再次完整3573/0、74个Elixir文件格式通过，编译/codegen/架构/ADR/三wire前缀门通过，owned `ade37c7a9fa7e4ff`退出0并收口。75文件原子迁移普通提交为 `f48ffe181e9876de3486407a38608aac0a3e480c`；与工作区3575的两项差异来自未纳入的原WIP测试，不是skip。JP/JTC/b29重叠路径逐字扣除原有六处载荷，44个非重叠原WIP未改。提交后源码字节不变、索引为空、未push；原post-commit因Runner PATH缺Homebrew未找到已安装git-lfs，读取原钩子后以完整PATH执行同一未改钩子退出0，前后HEAD/index不变，记录于该候选目录的post-commit-path-recovery。此组不代签尚待的外部证据、实模、成本或task_done。

**规模门禁与职责收束的实施裁决。** `module-size-inventory-01`真实六项失败：AuthoringTranscript532、ExplorationService1505、JudgmentProtocolTest3046、AuthoringSessionTest801、CP4测试904、RequestIRTest815。保留原报告与门槛，不能靠压行或删反例过门。Transcript的文本拼接与现RequestIR.Projection.text_of实现逐字等价，改直接消费该owner并删除私有副本。探索执行与纯资格政策有不同变化原因：全仓查无ExplorationPolicy/ExplorationBudget等同义owner；现AgentRunBudget明确不含planning成本，ChapterListBudget只管目录显示，复用它们会混淆预算语义。因此审定新增一个纯ExplorationPolicy模块，整体迁移当前预算、工具资格、只读计划分类与整组准入，ES保留实际读取/稳定目录/同源selector比较，JP与DPS直接消费Policy，旧政策API删除而不留委托兼容。该模块不建新实体、状态、表、DTO或控制环，2+8上界及Scope形状保持。四个超限测试按现有责任owner优先迁移，无适配owner才建立窄测试模块，测试数、独立输入与拒绝反例保持。结构重构完成后须重新过相关回归、规模与完整工程门禁。

**规模职责重构的精确提交。** `495b790486dfff7859262286103ce42e8595242a`包含17路径，精确tree `fc74b2440ce76a96a433d02d2552123cd61c6fd7`在独立checkout完整3573/0、14个Elixir文件格式通过、模块规模扫描1035文件通过；强制零警告编译、架构、ADR33/33和三wire前缀门通过。未改规模baseline或豁免。新JudgmentPlanProtocolTest承接原11条计划接收用例；M17真实三叶/两回执/续页集成例迁入现JudgmentPlanMaterialTest，原seed及长文构造复用已有TestAgenticLoopFixtures，正文独立字节证明保持。provider_call_count两条纯测试归新窄模块，两个text_operation来源/三wire用例迁入现RequestIROperationTest；测试数及声明多重集合不变，不删反例或复制第二业务夹具。JP与Application README原WIP按已封存baseline精确剥离，候选2658文件和17工作区输入在验证前后不变；普通hooks提交后源码字节保持、index为空、未push。此处仍是结构工程证据，不代签真实作者/成本与最终task_done。

**全量静态复审的前向裁决。** `full-static-01`在全部Git可见源码与HEAD前后不变时执行21项完整扫描，19通过、2检查返回非零、零skip；14个finding逐条核对后，六项既有Gitleaks处置仍有效（五条误报及一条既有历史风险），六项Credo与两项Semgrep为本轮实际阻断。Credo落在JP判断资格/分支、SliceVerify夹具控制流、TES消费投影和Common.Scope消息校验；先查现helper，按已有验证阶段/职责收束私有函数或简化控制流，保持失败先后、实际来源/正文/计量和同次授信判据，不新增module/配置/阈值豁免，不用deferred代替修复。两条Semgrep均是已读取的固定测试原文单次换行变异，分别验证非法Base段头与回放字节篡改被拒，完全不承担输入清洗；保留测试与规则，在现dispositions逐条记录可定位事实和重新审核条件，原WIP另封baseline并保留。所有新修复须重过格式、相关完整测试、严格Credo及最终全量扫描；本次退出1与八条pending原报告封存在独立目录，不覆盖或改签。

**脚本消费者的精确提交。** `3d06db104d5199b195184d06a3aa5339d87b9c84`包含七个单计划/语义/成本driver相关文件，精确tree `a54ccc755bcb71b106bd3f90a8eba5fc5432a071`。49项Node、两个脚本语法与格式均通过；直接调用真实driver提取module的31个独立边界（6接受/25拒绝）通过，主入口/DB/应用启动/transport/模型均未执行。依赖缓存、解释器路径和一次错误Mix build path造成的启动失败原件保留，正确既有elixir -pa执行的源/BEAM身份已核。此次纯验证不能冒充最终14次请求构造；普通hooks执行、index为空、未push。

**外部读取的再次反向审核。** `native-base-green-04`三个直接测试文件105/0覆盖已覆盖Scope、再次供应与再次覆盖、空/混合appbase块、同次登记和原样版本；但独立审核继续发现合法Chat请求中“应用材料＋作者完整引用该材料”两条同文user消息会被旧全局碰撞判据误拒。`native-author-quotation-red-01`五项中三项按预期失败，缺失/重复/跨作者顺序两项拒绝对照通过。修复仍必须复用现canonical前缀、Compaction与请求事实owner，按完整消息顺序恢复应用/作者归属，再授予明确binding；不能只删碰撞守卫、用全文包含或应用消息子序列替代完整对账。该问题只证明当前reader保守误拒，105/0不据此签外部证据完成，待修复后独立复审与消费者回归。

**R05成本读侧的同源裁决（实施前）。** 继续查调用链，request_cost_pairs_evidence实际复用cost_batch.canonicalAuthorMessage，R05 run_evidence也将单请求成本analysis.ok作为验收门，因此不能只修live/Scope而让成本路径继续按文字前缀猜作者。复用现canonicalRequestBindingsForProviderCall完整配对；canonicalAuthorMessage保留run/work/session/parent/source唯一性，按真正canonical user/author取得actual index，退役facts.authorMessages的前缀推断；run_evidence只薄消费同一定位结果。现request_cost_evidence已经具有resolveAuthorState显式index/hash绑定，无需新协议或分类实体：成功绑定的本轮user位置优先作为current_author，作者计数/原序、occurrences及Scope统计均消费同一事实，不能把作者完整引用Scope的文字再算成应用Scope。坏index/hash、非user、缺绑定不得升级信任，也不替未核实的历史消息补身份。先以独立同文app＋作者引用、只含marker的作者、错来源/顺序/哈希等反例证明再修；旧shiftedCanonicalAuthorFixture中的假app占位必须迁为真实Scope/checkpoint，原作者index与拒绝断言不变。只改这三个现役owner及对应既有测试，新增module/持久实体/格式/平台为none。R03批次compaction、G3与确认路径仍有各自旧作者前缀误拒边界，尚需其真实历史采集/前缀条件审核；本次不将R05修复泛称这些批次已完成，不借文本补齐它们缺少的canonical事实。

**同输入成本复验的前向裁决。** reason退役后，旧构造driver的固定响应无法同时合法通过旧基线和当前协议；不能为比较给产品恢复旧字段，也不能给旧capture换源码标签。复用现request_cost_construct的唯一transport构造点：同一个新冻结driver仅依据本次实际发出的judgment_decision schema，在唯一声明且必填的字符串reason/author_reasoning中承载同一预定文本，两臂content均为空；两字段同时/均不声明、工具不符或额外请求显式失败，不按arm/commit或错误重试切换。保留实际脚本响应与调用记录。新recipe继续冻结原七对author/seed/DB/7000字符原文/runtime，仅更新本批driver与实际source身份；旧recipe/capture只读。Writer出站历史中字段变化的字节全部计入，不能归一化删除，也不能把总差额全归因于Base变化；仍为14次构造、16次固定响应、0实模的测量边界，实际结果另记。

**新的真实批次预算。** §16.23全部旧预算已经消耗。本轮修复并验证后，前向仅登记count-04、quality-05、role-04、g2-02、whole-02、style-03，各一次batch、一次作者发送、零手动重试；对应原count-03、quality-04、role-03、g2-01、whole-01、style-02的输入、seed/hash、模型runtime与时间/阶段上限保持，不扩大角色T0/T1、不采纳。新登记和独立输出目录必须在执行前成立；执行前后封存同一源码，任何失败原样保留，不能重复派发已启动批次。最终仍须逐句审作者交付、核真实请求材料与引用、页内首末可见证据、当前成本和原scope工程出口，才能裁决R05。

**外部接收的精确提交与失败保留。** `6be9646c9bccf37ecf8c00201eb4be2aebb5a3ef`包含23路径，精确tree `9c46bc55329d68dbad4e44abedf3bde5c5cc33cf`。完整消息绑定、当前run唯一Base、canonical作者身份及C5纯调用/讨论共同判据由现owner消费；Scope完整JSON、checkpoint内容/覆盖、原生工具展开及非字符串assistant正文都有独立拒绝例。`native-reception-02`在具有独立本地.git的完整2658文件候选中运行33个实际测试文件（32个authoring文件加根目录native_b71_evidence.test），864/0、零skip，日志SHA `a357ab8451392bfca09515634dfe778d6b700097af4273102fdbde0f0c648a31`；不能沿用曾漏掉根目录文件的32分母。前件candidate-01的832通过/3失败保留：两项fixture仍用当前投影不接受的assistant null，一项capture从没有本地.git的checkout读到了父目录忽略规则；分别修正原fixture与候选Git隔离，不削弱产品拒绝。独立业务反例、广泛回归中旧IO fixture未同步真实讨论正文的失败均留存。ROOT首份提交守卫误按TAP读取Node 24实际Unicode报告，在任何index mutation前停止；核对真实日志格式后重新校验并普通提交。README原WIP按baseline往返剥离，提交后源码字节保持、index为空、未push；864/0不代签六批实模。

**成本作者绑定的精确提交。** `f559aa9330f79ed17824ea12a33d609943641422`包含三个现owner及两个直属测试，精确tree `66cedec8f34e57f6baa07bae82ea9466f4bcb419`。七个独立业务反例先实际失败，覆盖合法同文作者误拒、Scope版本/checkpoint正文/额外Scope篡改误接收以及作者分类错误；修正后两个直属suite加现request_cost_pairs共136/0、零skip。`cost-author-binding-01`独立Git候选2658文件前后不变，五个工作区源与冻结SHA一致，owned `375f6faec4369081`退出0且tree_finalized；普通hooks提交后index为空、源字节未变。此次未启动Mix、模型或十四次真实成本构造，固定原始请求、稳定JSON与总字节口径未改，最终成本必须另测。

**工作区后端验证的精确边界。** `full-check-04`实际3575/0、零警告/生成代码/架构/ADR33/33/I-CACHE通过，owned `6af2e0760543a669`退出0并清理完成。执行期间三个成本JS生产文件发生已记录修改，所有后端及mix check输入、HEAD保持；结果明确whole_tree_frozen=false，只能证明这些后端输入，不能作为最终全工作树冻结证据。其3575包含原WIP中的两项测试，不与独立提交候选的3573混称。后续static4精确候选与最终整仓工程出口仍须分别完成。

**真实模型前置只读核对。** `splash-readonly-preflight-01`实查当前model为local/Q4-PLE4、context为262144，与六登记一致；GET /v1/models公布efforts为low/medium/xhigh、default=xhigh，而六登记及产品出站均为high。现OpenAICompatible原样传effort，没有high→xhigh映射；目录未列high尚不能证明服务拒绝或等效支持，需核实际权威服务契约。没有为探测发prompt、加载/卸载模型、启动批次或修改登记/参数；该不确定性不能被预检查对象字段相等代签为模型有效档位一致。

**六项静态结构问题的精确提交。** `33fd3d641fd4582d24b1aa5019e13d9b68ece556`只含JP、SliceVerify、Scope和TurnExecutionService四个现文件，tree `bc1721c00b5ee83e7d3b351ee90b0fbdd00591f2`。JP在既有私有owner内分离工具派发并正向表达正文冲突；SliceVerify收束真实读步和既有档位谓词，未给读步追加status=ok限制；Scope.validate_owner保留Base形状、归属、正文资格及Scope归属的错误顺序；TES只移动无副作用闭包绑定。未新建module或调整门槛。`static-core-01`独立Git候选2658文件与四个工作区源前后稳定，37个锁一致非Novel缓存之外所有Novel全新编译，完整3573/0、四文件格式、严格Credo issues=[]及1035文件规模门通过，四个owned均child0/tree_finalized、无timeout。JP原两处WIP独立逆扣/正向还原证明保留，普通hooks提交后index为空、源字节保持、未push；八条初始阻断的最终全量扫描仍待新冻结源码复审。

**推理参数的请求事实与服务未知边界。** `splash-high-semantics-readonly-01`对服务OpenAPI/docs的只读请求均404，首页菜单只消费/models公布值，没有可核alias映射。复用现scenario日志reader核得旧whole-01与g2-01共八条真实Splash请求均发送reasoning_effort=high、max_tokens=32000，回执均200且有真实usage；它们证明历史请求曾被接受，不能证明当前effective effort或high=xhigh。现runtime recipe明示这些是实验请求参数而非模型原生事实，故保持六份high登记原样执行已授权批次，逐批核新runtime facts、真实出站与回执，未知有效计算档位如实保留；不额外探测、不改成广告中的另一档，也不把历史200当新批成功。构造成本只比较实际请求字节，不引申模型能力或有效推理预算等价。

### 16.25 质量复验反例后的前向职责收束（2026-11-20，实施前裁决）

**事实与冻结边界。** 提交 `7be4a590a8b70ebc2ff976892b21de453c12a950` 对应的 `full-static-02/source-before.json`（SHA-256 `d2e9dbb9fc47ab96e98ad94cb85228704d7e874cbf1cd27242d3cc61b6b390a7`，2667 个 Git 可见文件）完成全量静态复审：21 项执行、0 跳过，20 项原始退出 0；Gitleaks 原始退出 1 的 8 项为 7 个已复核误报和 1 个既有接受风险，阻断 0。原报告与分类均保留，不能将扫描器原始非零说成原始全绿。

在该冻结源码上，`count-04` 一次作者发送、一次真实调用，回复“目前一共有 2 章；已有正文 1 章；还没写正文 1 章。”与两条同名章节、仅第二章已有 7000 字采纳正文相符；初始统计未提前供应正文。独立审查 `count-04-independent-review-01/review.json` SHA-256 `f86985503461189e4331a43e14306e976124a60d185ccde8b46ee116f9c0381e` 判 PASS。此结论仅属于该源码和该批次。

`quality-05` 一次作者发送、三次真实调用，机械六项通过：378 字采纳正文的真实版本与完整区间进入后续请求，最终分析有文本依据且没有创作或采纳候选；九类 Canon 内容签名未变，读取导致的两个 memory reference_count 与两个 dialogue_context 审计记录另行保留。然而前两次接受并展示的 author_reasoning 分别是“需要先确认《灵源账单》在章节结构中的真实章节引用，才能读取其已保存正文，并据此判断主角胜利是否铺垫不足。”和“已拿到《灵源账单》的章节引用，现在读取该章的章计划与已采纳正文，作为判断胜利是否来得太容易的文本依据。”作者已明确章节，没有需要其理解或裁决的真实对象歧义；两句实际汇报内部章节身份发现与绑定，判 **FAIL_AUTHOR_VISIBLE_LANGUAGE**。独立审查 `quality-05-independent-review-01/review.json` SHA-256 `e11a45fa6bde149ded765d5088304c568df35dddad9b9880908f0135a2a70834`，窄语言复核 `native-quality-language-review-01/review.json` SHA-256 `e531a72ffa7083119263146bb5176aa3dbd20f4c37ca164aa507079191c228f2`；raw tool arguments、canonical、作者事件和画面一致。所有三次实际请求已有 Common 语言规则，因此不能归因为漏接规则或展示拼接，也不能用最终分析合格覆盖过程说明失败。

**消费与实体存在性审计。** `native-quality-language-review-01/instruction-owner-audit-01/audit.json`（SHA-256 `d93161847cf33a397dc218e3742a0def2e5b56b6a9a1cbb8e3d5e4d32a545d2b`）核得：explore 直接进入现 DialoguePlanningService 读取分支，只消费实际 tool/query、作者原话、观察及真实计数，不消费 dialogue_goal，不产生终结 DialogueFrame；JP 的复制和 reply_record 的原始参数存档不是业务消费者。execute 的同名字段仍被 PendingArtifactWorkflow 用于章修订目标、brief 和范围检查；注册与能力缺口工具也有独立职责，必须保留。现 JudgmentToolContract 已拥有工具 schema、封闭字段接收与纠错指导，JP 另有一份从平面 schema 提取字段诊断的实现，应归回同一 owner。未发现独立 JudgmentToolContractTest，允许新增一个小型 `judgment_tool_contract_test.exs` 专测其公共分支接收；协议来源和发布回环测试仍增强既有 JP/exploration_loop 测试，不新增生产模块、DTO、工具、验证平台或持久字段。

**前向设计。** 保留现根 object 的 wire 形状和唯一 author_reasoning 通道。JTC 以内聚的完整 action 契约同时派生平面供应字段、实际接收 schema、错误详情及对应示例：explore 不要求且不接受 dialogue_goal（包括 null/空串），execute 继续要求非空 goal；跨分支字段和未知 action 明确拒绝，未知 action 不默认 execute。公共 wire 是兼容现投影形状的结构描述，分支完整性由现接收 owner 校验，不声称供应商 strict 已保证；不采用未经当前三类供应商验证的根 anyOf、不建立第二份字段表。原始非法参数不得通过清洗进入正常化结果；失败调用仍原身份闭合后才接受纠正响应，explore 的已接受结果不暴露无消费者 goal 键。

AuthoringTaskPolicy 取消“复述真实观察”的过程汇报要求，改为以实际读到的材料和作者条件支持与创作问题有关的判断、发现及缺口；JTC 作者说明强调作品、所需材料与创作目的。Common v5 保持唯一共用语言规则，不叠加词语黑名单、不改写模型原文。工具契约和任务策略的版本随各自本轮真实变化前向更新。共享身份中“一切都是待确认材料”的既有 Issue #4 债务另行保留，本样本没有证明它导致此次失败，不借本轮扩大身份重构。

**Responses 默认行为的反证补充（实现前）。** [OpenAI Function calling 官方契约](https://developers.openai.com/api/docs/guides/function-calling) 的 Strict mode 节说明：Responses 省略 strict 时会尝试规范化为严格 schema，严格 schema 要求所有 properties 必填；显式 strict:false 才保持非严格调用。根 object 本身不能消除该风险：若平面字段并集被自动升级为全部必填，会与探索禁止携带执行字段发生矛盾。沿现 Responses 工具投影 owner 明确发送 strict:false，保留应用接收端完整校验；Chat Completions/Anthropic 原有非严格默认不另增设置，不建立跨供应商 strict 配置或 schema 转译平台。使用既有真实出站投影测试锁定该行为，另核三 wire 的实际根 schema、公共必填和内容不被改写。本地测试不代签当前远端 Responses 或 Anthropic 已实测，Splash 实测仍只属于其真实 wire。

**验证、预算与不倒签。** 先用独立输入保存分支/纠错/发布边界的红测，再实施；检查三类 wire 保持根 object、实际构造者与参数示例跟随新分支，旧执行目标和完整调用来源防替换继续有效。单测只证明结构与来源，不能证明一般自然创作语言合格。待有意义修复和工程验证提交后，以相同作者输入、seed、运行参数、各阶段时限，前向登记 `count-05` 与 `quality-06`，各仅一批、一次作者发送、0 次人工补发、总预算 900 秒；不覆盖 count-04/quality-05，也不把旧源码实测绑定为新源码证明。尚未启动的 `role-04/g2-02/whole-02/style-03` 四份登记与 `cost-final-03` 保持零消耗，待新源码冻结后顺序执行；六场实际内容独立审查与真实构造成本、最终工程出口仍须全部完成。旧源码冻结现在仅对上述已执行证据有效，允许本节已审计的前向实现，**R05 仍 doing，不签 PASS，不推进 R06**。

**独立反例、修复与精确提交。** 分支测试在原生产源码上实际 98/18，包含五个新 JTC 结构反例和真实读取回环反例；这不等于18个独立产品缺陷。测试自身的反馈二次 JSON 编码、旧结构错误3次调用假设和已退役 system 文案断言逐项校正，均单列原由，既有结构错误预算仍只有一次纠正、合计两次调用。Responses 的三个完整既有 suite 在修复前实际 32/3，三处均仅缺少 strict:false，实际三 wire 根 object/公共 required 断言先通过；原请求、日志与修复前 source 绑定保留。前两类原件分别在 `explore-goal-retirement-tests-01/red-01` 和 `explore-goal-migration-01/responses-red-01`。独立生产审核 `explore-goal-retirement-independent-review-01/review.json` SHA-256 `7e2803e69b06dfa9881b8562b9b778405f3abba93d5d49eae7ecf5eaf801f3a2` 未发现所审三个 owner 新阻断，不代签语言质量。

提交 `da94a8e9fb885c1bcfe92cbd90a209642fb1842e` 的24文件精确 tree 为 `996ad98ac45f3bd76bc7fa7e0ca45c8868ab8eb2`，patch SHA-256 `8762d5aff131766616281529b668278c823e992f0c0a7fba25ae0ddbe0e8993b`。JTC v3 持有两个完整闭合分支及同源诊断/示例，JP 只移除被其覆盖的结构副本，真实读取预算、能力、对象与范围仍由原 owner 核验；探索已接受结果不复制 goal。Policy v3 面向创作判断，Common v5 不变；同源 action 字段表只供应在工具 description，system 重复副本退役。Responses 原投影显式 strict:false，另外两 wire 未新增配置。现役替身与直属测试已迁；b29 旁支仅合成已发生的工具历史，不进入新响应接收，整文件及原 WIP 保持，不为其新增兼容转换。

`commit-preview/action-contract-01` 准备时把新建 Git index 尚未刷新的 stat 信息误当文件变化，未启动验证；独立 diff 证实内容一致后在新目录修正索引检查，原失败保留。`action-contract-02` 完整3581/2，两项均是旧纠错句子的逐字断言，实际字段/范围信息正确；原格式、严格Credo和规模检查已通过。只迁移相应诊断断言后，`action-contract-03` 在独立 Git checkout 的2659文件上完整 **3581/0**、24文件格式、严格Credo issues=[]、模块规模通过；仅复用37个锁一致非Novel依赖缓存，所有Novel新编译，四个owned均child0/tree_finalized且无timeout，候选与工作区输入前后稳定。JP两处、JTC三处原WIP在ROOT独立检查中正向还原工作区、反向还原候选均逐字成立；普通hooks提交后index为空、源码字节不变、未push。3581不含原WIP的两项额外测试，不与工作区总数混称；lefthook回显未发现配置，不能称其配置化检查已运行。

**新登记与待验收边界。** 代码验证提交后实际创建 `native-preregistration/count-05.json`（SHA-256 `f8be9d9bbd0eb68f7c31351b18537601096642cc73c05848803f5028023a21d7`）和 `quality-06.json`（`24410c31ec12be23282977d78870d115607c3f3863526edf00ae3ad1c9fa3acd`），相对前批仅更换id与独立输出目录，原话、seed、模型/runtime与单批/单发送/零人工补发/900秒保持。新 `action-native-coordinator.py` 仅更新已批准的六批登记映射（SHA-256 `ec37acc8230c20e71fbdc474bcc3383ccbd4edb899d2ef3409bc5f3fdc44f7e3`），旧协调器及已消耗原件未改；登记核账见 `native-forward-registration-01/registration.json`。此检查点六批均未启动，cost-final-03仍只有四个准备文件；下一步先全量静态冻结，再执行六场实际作者/材料审读及14次构造成本，最后按原scope完成工程出口，**当前仍不签R05 PASS**。

### 16.26 判断动作契约的职责拆分与实际工作区规模阻断（实施前）

**实际反例与边界。** 在 `dc692338e3f4ab816abbb8d55d9e805bb818da6a` 执行的 `full-static-03` 为21项、零skip；owned `5bc2cd7baf9fb158` 实际child1且tree_finalized，九项finding中七项既有误报、一项既有已接受风险，新增阻断为JudgmentToolContract工作区515行超过未登记模块500行门槛。该文件精确提交版本480行，另外35行属于保留的原work_profile_revision WIP；因此前一精确候选规模通过与本次完整工作区失败并不矛盾。原报告SHA-256 `3b8afacdebae4f1658bdd30855d8de69f2d6698533dd119e651fffd5f3e09417` 与前后相同源码身份保留，不能作为新实模冻结，不增豁免、不改baseline、不压行或删除原WIP过门。

**存在性审核与单向组合。** 全仓未发现独立判断动作契约owner；现AgentPlanToolContract只负责计划工具，Common ToolOutputContract/ToolRequest分别负责创作输出和已批准执行请求，JudgmentPlan负责运行时，均不能混入判断动作定义。沿已有计划工具组合方式，审定新增 `JudgmentDecisionToolContract`，整体迁移现JTC内聚的完整execute/explore分支、字段说明、示例、平面wire派生、动作选择及动作专属纠错。新模块仅提供 `tool/0`、`schema_for_action/1`、`specific_guidance/1`；JTC继续持有固定profile工具目录、版本、通用闭合验证、字段错误详情和通用反馈包装，薄消费这三个接口。动作选择按分支自身action枚举精确匹配，不trim、不默认execute；新模块不回调JTC，不建立循环、通用schema平台、DTO或持久实体。仅用于判断分支的nullable原语随职责迁移，共用验证与其他工具原语留在原owner。

**行为不变与死路退役。** 此次只改变职责归属：保留所有现役字段值、执行→探索顺序、required顺序、nullable语义、示例、工具目录位置、输出结构和契约定义的纠错文字；工具版本仍为b26-tools-v3，Policy v3/Common v5与三wire投影不变。两份独立producer→wrapper→correction核查确认：唯一schema原子错误在JP validate_tools中必转为登记专属错误或带detail的tuple；Provider同名error仅进入调用重试/最终失败，不进入纠错正文；原生非法JSON/非object也经同一包装。因此同组删除JTC无参invalid_arguments_guidance与JP唯一调用它的私有atom分支及旧注释，保留现役detail路径、原错误透传、原调用闭合和预算。JP/JTC原WIP必须逐字保留，候选仍单独剥离并正反向证明，不借重构迁走这些职责。

**独立验证。** 迁移前已在实际工作区记录 `judgment-decision-structure-01/before`：工具JSON SHA-256 `ee7e3e0eb2c142db28368525d93fae2bb9670f28f228af05adeac02a41463213`，十二组合法/跨分支/未知/缺失动作与诊断的确定性term SHA-256 `d7e0c235cf7a7a8b052ab569776f2ebb1fd3c0bba5992aa29f7e07f7838c98cd`。迁移后须用同一冻结capture脚本另写after，比较现役工具与行为逐字/逐term相等，并核真实编译来源、owned收口；已有分支、协议、读取回环及三wire测试继续验证，精确候选完整工程门与真实工作区完整静态门均须另过。不能用新单测平台或自证schema副本代替实际消费者。

**未消耗预算与后续出口。** 六份count-05/quality-06/role-04/g2-02/whole-02/style-03登记仍未启动，原JSON不绑定旧source且seed/hash与独立输出不存在性已核；保持原登记字节、输入和单批预算，待本次修复后的新成功源码冻结再绑定执行。cost-final-03仍零消耗。保留full-static-03失败原件，修复后另用full-static-04；所有实际作者语言、材料、成本与原scope最终工程出口完成前，R05仍doing，不签PASS，不推进R06。

**实施后实际对照。** fenced迁移后JTC含原WIP为361行、新动作契约161行，JP仅移除旧死路及其注释；三源之外无生产路径变化。实际工作区重新编译与同一capture均child0/tree_finalized/scope_removed，源码前后稳定；两profile工具JSON和十二组返回、详情及纠错字符串的确定性term分别保持上述同一SHA。首个比较器额外要求inspect调试文本逐字相等而退出1，原`after/result.json`保留：仅十个map的allowed_actions/disallowed相邻键显示顺序互换，完整term没有变化。`inspection-order-review-01/review.json` SHA-256 `b8346b6cfceab9436c874a60dcc138aeea2accd947217f2b179e442aaa53046c`逐项核出该显示差异；未重跑capture、修改源码或改写原件。独立反向审查另核实JP correction_transcript会把inspect(reason)放入失败回执，Common structured_content再供应其完整内容；所以本对照只证明完整工具定义、返回值与契约指南相等，**不保证完整失败回执的inspect字符串逐字一致**，也不能称该差异必与wire无关。现役字段语义与原始来源保真保持，当前实际请求和成本字节仍须按新冻结源码实测，不为调试键顺序改写产品或原件。独立候选完整工程验证及真实工作区full-static-04仍待执行，此对照不代签真实语言或最终R05验收。

**职责拆分的精确提交。** `baec5e9942b778108e0fe534ec9828c856b09b91`包含三份生产源与四份owner/决策文档，精确tree `3d5302881aec9f025cc2364892ca29a1edd5aa3d`，patch SHA-256 `5a452c12ec158b0fa54acadd5f383c3f8181d5759d8fcfdac25d456abe02ac3a`。`commit-preview/decision-structure-02`独立2660文件checkout完整 **3581/0**，三个生产Elixir文件格式、严格Credo、模块规模、设计追踪与NEXT检查通过；37个非Novel依赖缓存经锁核对复用，所有Novel重新编译。四个owned均child0/tree_finalized且无timeout，实际测试owner `5763c7842b7b9b0a`；候选和工作区输入全程不变。前件candidate-01在README原WIP补丁上下文检查处停止，未启动Mix/测试；新owner索引插入在原WIP行旁，故仅重建补丁上下文，原单行操作逐字相同，原失败保留。JP/JTC与VS/README四条重叠路径在ROOT候选中均正向恢复工作区、反向恢复候选。普通hooks提交后2669个Git可见文件字节保持、index为空，仅原48项WIP仍未提交，未push。

两份独立复审分别存于 `decision-contract-structure-independent-review-01/final-review.json`（SHA-256 `c4b020b59fdf338f98d6784bbe8087a8999d6d051f427fb3ff95e800c94e63ef`）和 `judgment-decision-structure-01/independent-review-01/report.json`（`03aa7ece9cb6e104c5ba6e873ce8c5c58e31a0952e238320afd4d5564dcb03ac`），未发现本次纯职责提取的新实质阻断，均保留上述完整失败回执字节未证明的限制。此检查点六场原登记与cost-final-03仍零消耗，完整工作区静态扫描、实际作者/材料效果与最终工程出口另验，R05仍doing。

### 16.27 直接读取与作者表达分责，保留真实计划说明（实施前）

**新源码的实际反例。** `848b3738f04a599ff914ddaae6e0ad87324a023c` 的 `full-static-04` 在2669个Git可见文件与原WIP身份前后不变时完整执行21项、零skip、零未处置阻断；owned `32632c83c98ed1c1` child0/tree_finalized。Gitleaks原始返回1的七项误报和一项既有已接受风险按原处置保留，不称21个raw检查全绿。冻结source SHA-256 `678c7d58fde8b7c5fcaa24fec01ae668f00adedc07837126a4b4d925ab46eb80`；它只绑定本次实际已执行的count-05与quality-06，不供未来改动借签。

count-05一次发送、一次调用，真实两个不同章ID与一个已采纳正文形成2/1/1，初始统计足够，7000字正文未入请求，原生首末页面与完整来源相符、没有候选或写入。独立审查 `count-05-independent-review-01/review.json` SHA-256 `cdf8433f2e229efcd3016bbd15ca3d1422c013adae65ce1007d235cd3b31748b`，限该统计场景PASS。quality-06一次发送、三次调用，第三请求确实取得第01章已采纳稿rev2、378字符/1134字节及1–378全区间，目录未冒充正文，9表Canon内容与章节状态未改；两个memory的读取计数及相应审计变动单列，不称DB逐字未变。其第一条作者过程说明仍说“先取《灵源纪元》的章节目录，确认《灵源账单》的实际条目与引用，再据此读取已保存正文。”作者已有明确目标，无需理解内部寻址；raw参数、canonical、seq11作者事件、AX23及首屏完全一致，判 **FAIL_AUTHOR_VISIBLE_LANGUAGE**。完整条目正文SHA-256 `cd82317473fd4d4218419e744ee9857d35cfe7468e8ac90958e31f3ceba2d7a6`；独立报告 `quality-06-independent-review-01/review.json` 为 `0640a93405427b9ca814c11e63a45d2477b1af6106cd355aee80218eb426455b`。两场各72份原件前后hash全同，旧quality-05失败仍保留。

**归因与文学判断的限度。** 两次explore的真实参数均已没有dialogue_goal，共同语言规则也在三次实际请求中，因此不是旧字段未迁或规则漏送。静态调用链证明存在结构耦合：直接读取分支强制非空作者说明，JP把所有工具都交给作者正文/来源提取并构造reply_record，DPS在读取前统一发布作者judgment_decided。单次失败不能证明该字段或某句prompt是唯一语言原因，但这项没有必要作者交付的强制职责可以独立审核和移除。最终分析关于轻松翻线、三招结束与无代价的判断有全文依据；“通关/核心答案”等保留为可争辩的文学解释，不按强措辞判假。把27字summary预览推成“本章设计终点本该是决定/按原计划收在……”则把未读完整设计或作者意图确定化，单列CONCERN；结尾承认未读不能自动撤回前面的确定断言。

**愿景、存在性与方案裁决。** 愿景§2将工作台定位为后台工具箱、要求Contract-first；元原则§2.4要求模型主动求证、真实观察回流、有界运行和作者主权，没有要求每次内部查询都另造作者发言。核心职责归六个现役owner，现役版本与构造消费者同步迁移：JudgmentDecisionToolContract拥有动作分支，JTC拥有目录/通用校验，JP拥有原生接收与作者产物，DPS拥有调度和事件，TaskPolicy拥有判断任务说明，Common.AuthoringSemantics拥有共同证据语义；不新增module、DTO、可见性字段、通道、控制环或验证平台。独立反向审计 `direct-explore-audience-audit-01/report.json` SHA-256 `edcb7c94af9fe1f502c134e2c6170bef21a671c55820afa9a297951a675f235c` 核得真实计划的独立消费者：AgentPlan→meta.summary/source→AgentRunServer→工作台计划说明。 生产消费者审计 `direct-explore-narrative-audit-01/review.json` SHA-256 `2b05f7add32e5e36cc0a67f8915a5112fea9889e6d1339233b90b1aa2e7cbacc`另核18份输入及JP/JTC原WIP；UA-01 §2.2现役矩阵、正文与事件文字同步退役旧plan配对、reason回退及无条件提前发布口径，历史采集结果不改写。

审定仅把 **judgment_decision.explore** 作为不产生作者正文的直接读取请求：完整分支只接受action与explore_request，author_reasoning及其他作者正文字段（包括null/空串）按现闭合校验拒绝；工具另带非空content仍拒绝，并保留失败原参数与原call有界纠错。既有AgentNarrativeSource.verify_tool_call必须继续验证真实id、完整参数、原content和映射，不能因没有作者正文跳过来源。JP不为合法explore建立narrative/narrative_source/reply_record；现provider_result、tool_call_id、transcript及真实计数继续保留，不新增无消费者provider_call_ref副本。DPS不为该内部请求制造作者judgment_decided；现真实exploration_observed系统阅读事实、运行状态、预算、取消、恢复和后续真实回复保持。不得接受旧作者字段后清洗、改写、隐藏或伪造系统说明。

**计划的最强反例。** 作者要求“先说明取材方案，再阅读并比较”时，真实整体计划说明有独立价值。所有合法AgentPlan（含DPS内联读取和独立ReadonlyBatchContext）继续接受并发布原作者说明，不按read-only效果全局删除。否决在接收后隐藏计划正文，也不为本轮反例退役只读计划：独立ReadonlyBatchContext固定读取作品/角色/规则/统计，并不能等价替代任意章、正文、记忆查询后继续判断；改成逐次读取还会增加模型调用并改变预算。若合法计划实际仍说内部引用机制，仍须按原作者语言标准判失败，本裁决不授予静默例外。

**供应、共同规则与版本。** 同一动作分支派生的平面根object继续存在，公共required自然仅为action；execute仍在自己的完整分支要求非空author_reasoning、goal及capability，字段说明明确只用于execute，不能为保根required而补nil/空串。JTC通用指引、JP输出/纠错说明及TaskPolicy同步表达直接读取与作者交付边界；工具与任务策略分别前向更新为b26-tools-v4、b27-task-v4。Common现shared_rules已经供应判断并约束coverage和假设，不宣称此前没有规则；在同一证据段细化“材料明确说了什么、文学解释/改作建议、未读完整设计或排他作者意图”的区别，允许有力度的评价，依赖未证实假设时就地说明条件或继续求证，语义版本升为b27-semantics-v6。存在性审计发现现AuthoringTask合同已有默认semantic_version，原先与Common另一个字面常量重复；默认值改为唯一v6定义，Common通过既有AuthoringTask.__struct__().semantic_version取得版本，公开消费者仍用Common.version()。Common已经编译依赖该struct，合同没有反向语义依赖；不新增API/module、不反调Common，也不为@enforce_keys构造假任务。不能加入词表、语义过滤器、额外模型判官或跨供应商新schema平台；Responses现strict:false及实际分支校验保持。

**测量消费者必须随真实职责迁移。** request_cost_construct现plain initial只有固定content却校验工具作者字段，此无消费者断言退役；固定execute响应仍从本次真正出站且唯一judgment_decision的根object properties选择唯一合法string字段reason或author_reasoning，并核实际action enum开放execute、实际响应action为execute。选择器不再读取或校验root.required，不能把平面公共交集当作execute分支义务，也不复制产品分支表或承担通用schema校验；旧矩阵中依赖required的拒绝预期退役，原证据保留，新测试只证明字段选择职责，不把畸形schema的选择成功称为应用接收。双/缺作者字段、作者字段错类型、重复/错工具、action声明不是string enum或未开放execute、实际响应不是execute均拒绝。实际两臂应用接收和completed构造闭环证明合法，原固定说明、空content、原始scripted_response及调用数照记；字段差异完整计入字节。仍为原七对、14构造、16固定响应、零实模，产品不恢复reason兼容，cost-final-03当前仍未执行。

**独立验证与前向预算。** 复用现JTC/JP/exploration_loop三个测试owner写独立反例，不建新测试模块：裸explore接收、额外作者键及非空content拒绝、无正文路径仍拒绝伪造原参数/id/content、真实两次读取与观察/版本/页范围闭合、只系统阅读进度、最后真实有来源回复；原execute/ask_author/普通reply和readonly AgentPlan完整作者说明保留。真实schema稳定性原例整体从JP迁入现judgment_initial_snapshot_test，复用该owner已有input与alias并保全原断言，只新增JP→JTC实际接线断言；迁后JP 2739行、snapshot 761行，不压缩代码、不放宽规模阈值。真实三wire矩阵核公共required与执行字段，成本选择器用独立字面输入先红后绿；格式、模块规模、原WIP正反还原、精确提交候选完整工程门和完整工作区扫描另验，不能用确定性文字匹配签文学质量。实现验证并提交后，仅为已消耗的两场前向登记count-06/quality-07，原输入、seed/runtime、一次batch/一次作者发送/零人工重试/900秒保持；尚未启动的role-04/g2-02/whole-02/style-03保留原JSON和预算，待新源码冻结执行。当前R05仍doing，所有失败原件保留，不签PASS、不推进R06。

**实施前反例证据。** `direct-explore-red-01`在HEAD `848b3738f04a599ff914ddaae6e0ad87324a023c`及未改生产源码上运行联合六文件：Common 15/0、Agent 5/0、Application 113/17，合计133项、17失败；owned `2211b8abbc5062e9`的真实child退出2、进程树完成、无超时，全部2669源码身份在执行前后不变，零模型/零UI。结果SHA-256 `49a0b7e005126d36825b3aff98b6be8845329836e3d1aefe83a87108063207f7`，独立逐项审计 `red-review.json` SHA-256 `fa6ec89ace80bc01028e60d1feb64d4f3821b9f00e5b3498ee870bd8a2d2143c`。失败由旧schema拒绝裸读取、仍接受作者字段及旧共同required触发；content/source/权限反例被更早schema拦住，不能把错误分类不符称为这些门已被绕过。第17项确见run_failed、未到awaiting_author，原日志未打印终止payload，其与同一旧bare helper/schema的因果归类保留为推断。没有夹具或编译阻断；测试冻结后才授权生产实施，旧红测及原文件哈希保留。

**生产语义反向复核。** 六个现有owner的实现保持原始content冲突门和唯一verify_tool_call，再按已解析operation省去直接explore的三项作者产物；DPS只改变该分支的作者事件发布，所有合法计划仍沿原叙述/来源/发布顺序。独立审计提出“完整材料可以恰好只有一个段落”的具体反例：Common新证据文字从单段改为段落节选，覆盖资格仍由真实供应范围决定。`direct-explore-production-02/selected.patch` SHA-256 `a0152ede2e8ea5bf3a4586b3d12bfadd0f634e2511635299118f4f4b065c0003`；独立审计 `direct-explore-production-independent-review-01/review.json` SHA-256 `159654750433b3f13a7e5ca227516ea77598c436a93b1f85b2fe9634a4b01492`，另以原HEAD/原baseline、当前HEAD/实施前、候选/实际三组差异独立核得JP原2项与JTC原3项WIP操作字节完全相同。UA-01 §5现役系统读取例示同步移除不属于其职责的模型正文/来源字段，合法计划的模型说明仍明确保留；没有改历史CP6事实。本段是实现与静态审查证据，不代签绿色执行、真实模型语言或文学分析质量。

**现役消费者与组合回归。** 逐块审计17个消费者候选路径后，实际迁移13个：唯一合同默认v6、当前版本断言、两个测试Provider及进入当前接收链的读取响应；4个仅含既有canonical history的文件整份不改，CP4/SessionMessageRead的历史段落与protected b29原WIP同样保真。Provider在构造处产裸读取，退役Stub无消费者的explore正文分支，保留登记/execute/ask/reply/完整计划的原责任；没有新增helper或产品兼容入口。`direct-explore-consumers-01/ready-03.json` SHA-256 `33560a48bace0e043c2a20d50afb49a4ae184462f5ef7033317d5f9037b6a3a7`冻结最终13文件与此前3个wire测试。第一次17文件组合回归242/2定位B29共享测试仍等旧探索作者事件；迁移为两次真实目录/详情观察后，第二次242/2又揭示“无第三观察”断言错误包含developer上下文观察。只将该反断言限定author可见读取，保留AgentRunServer原开发者事实流；canonical精确两次读取、query/coverage/角色refs/同源观察、最后execute原79字节及来源、候选/no_change/正式角色不变均继续核对。原两次失败及各冻结原件不改写。`direct-explore-green-03`实际Common 40/0、Agent 31/0、Application 171/0，合计242/0；owned `9b5683783ca4768f`的child退出0、进程树完成、无超时、执行前后全部源码身份稳定，日志SHA-256 `a719c540e067232b498aa074657302ac016c8084707a66bf47991ea691772bd5`。本次零模型/零UI；精确提交树的完整工程门与新实模仍须分别完成。

**精确候选揭示的动态测试消费者。** `commit-preview/direct-explore-contract-01`以29文件树 `1066a01e83cfd68869836c851f2cd68f115813fa`完整运行3584项、4失败，均来自现 `slice_verify_test.exs` 两个共享helper仍无条件要求作者说明；四项原业务断言覆盖章节结构profile、角色目录/详情、唯一身份、跨分句意图及不存在角色澄清，没有产品接收失败。原owned `ead8f92848e0a318` child退出2、进程树完成、无超时，日志SHA-256 `eb142b27bdbfe3528d9d4b67c9103c4a7a2f85381e28ebded4a979f1e5fb3a32`；执行前后源码/候选树稳定，后续格式/Credo/规模门未运行，原失败保留。独立所有权审计 `direct-explore-contract-01-independent-review/final-review.json` SHA-256 `9587f5bedaf7cad75b5111f6b3f2288a5f906b68ac9df8606d0d1c294b0b84c3`逐一核得2660个候选文件与tree一致，JP/JTC/VS原7项操作双向还原相同，候选排除原48项WIP与独立成本driver。新审计确认该测试文件不含原WIP，仅迁移两个既有helper：实际explore的键精确等于action与explore_request，其余动作仍要求原author_reasoning，空content及拒reason不变；逆替换证明四个业务用例和文件其余字节完全保留，无新helper或跨层调用。源码SHA-256 `4e8119c8a6f70c11d8b89fd9f367078446acde766c6722d51fb308e811814e06`，`direct-explore-slice-helper-tests-01/ready.json` SHA-256 `3c8b4ad2ffd4a0c02074c133643c5355de4b26a64709948fc2ec4773efc5799c`。单文件真实复测93/0，owned `207faca65efa1ea9` child0/tree_finalized、无超时、源码前后稳定，日志SHA-256 `ef24acdf168754e62bc0dda8a414f4f240f0f40801b582c17891779e7147aa48`；零模型/零UI。包含该修复的新精确候选必须另行通过全部工程门，不能将候选01改称通过。

**静态门的实际反馈。** 候选02格式门发现Responses测试两条赋值间缺空行；纯格式14文件证据只覆盖消费者13文件与成本driver，未覆盖此前3个wire测试，不能从编译/测试通过外推格式。原失败保留，限定行范围补唯一空行，其他测试字节不变。候选04格式通过、strict Credo退出8，唯一发现为JP narrative/4的三层嵌套，尚未运行规模门及完整测试。读取AgentNarrativeSource.verify_tool_call/2公开契约与全部分支后，确认其只返回:ok或{:error, term()}；同一既有函数展平为with先核空content、再核原调用来源，false保原ask_author/其他正文冲突分类，来源错误元组原样返回，成功分支保持直接explore无作者产物及其他动作原正文。没有新增helper、改顺序、放宽门禁或例外。`direct-explore-production-03/selected.patch` SHA-256 `ad13e4be53249091603849580bfe606f03a6f98e2ef3a3d01da6ea7d032adbdf`，相对production02只改变JP该结构，另五个生产文件相同，JP原2项/JTC原3项WIP再次逐字双向还原。上述是失败定位与修复记录，须由新的精确候选完整门禁验收。

### 16.28 直接读取修复的工程签收与成本选择器迁移

**产品候选已通过，R05仍待最终验收。** 产品提交 `a5577976cd55de1361be72b0b49f02f81f0b87ca` 的实际tree为 `0b673f10f2cfb15e6f16da05da84a9b9dab63245`，对应 `commit-preview/direct-explore-contract-05` 的30文件精确候选；2660文件独立checkout重新编译全部Novel应用，不复用Novel构建，完整3584项、0失败。格式、strict Credo、模块规模、diff、NEXT及设计追踪全部返回0，四个owned均child0、进程树完成、无超时；Mix owned `8ede4cac50fbfa20`，日志SHA-256 `75ea922e679b5561f7c45cdfc85178a0ad34589a4433b1abb98a731da2611dc5`。执行前后候选tree、工作区2669文件和选定源字节均稳定。独立增量审阅 `commit-preview/direct-explore-contract-05-independent-review/review.json` SHA-256 `8a96288a72621a4f008b32778d2c3c568114bcc644dca7b84d19cc27e3708f9d`核实JP展平仍先拒绝正文冲突、再核唯一原调用，来源错误原样返回、无新helper；所有原48项WIP保留。正常Git提交的tree精确等于已验证tree，未跳过hooks、未push，提交本身不改工作区任何源字节。该证明属于工程和接收边界，不签真实模型作者语言、文学判断或R05最终PASS。

**成本构造消费者的独立改动。** `request_cost_construct.exs`只迁移现有响应选择器：plain initial透传原固定content；固定execute根据本次唯一判断工具的root object、唯一string作者字段以及实际string action enum选择字段，响应必须实际execute。根required不再承担分支义务，实际execute分支的应用接收仍由产品验证。当前driver SHA-256 `4db26793026da5c8909134c8b8b990f039c74f2d48438ccc21c5607135e727f2`；原固定初始文句、执行说明、空工具content、Writer的7000字原文及后续队列字节保持，不增加产品reason兼容。成本driver与本节事实单独成组，不混入30文件产品提交。

**纯选择器证据的范围。** `direct-explore-cost-driver-pure-01`复用已有AST暴露证明，仅把实际driver的三个private选择器分支供测试调用，不运行main、DB、应用或transport；46项独立字面输入预期为16接受/30拒绝，输入SHA-256 `d867ff1b03f556b76b7021ee0b7fe83219fcc836f90455f480abcb2a85d518af`，预期SHA-256 `bc3ae449c804198bff0b177d34e0817247db368a303620731778f44257bb6e1d`。旧driver真实27通过/19失败，迁移后46/46；绿色owned `bee78c3b54062787` child0、进程树完成、无超时，结果SHA-256 `fa4c837611eff4b2fde4dc90a4f6cc102b28f8b04d331e8bdea1f33aa71a4dbe`，七项测试输入字节前后相同。旧31项身份保留，其中五项依赖required/plain检查的旧拒绝预期明确退役，再加15项边界；原6接受/25拒绝的旧执行结果不改写。缺失或不合适required被选择器忽略，只证明不属于选择职责，不能宣称畸形schema已获产品接收。精确成本候选继续复用同46项和原guard，加载已通过产品候选的实际RequestIR BEAM，并与成本候选源逐字核对；不借根工作区旧构建，不为纯选择器重复整套产品测试，随后完整工作区扫描仍须运行。

**七对真实构造尚未启动。** 旧prepared phase2曾在构造完成后仍校验root.required，已以新ignored准备版本 `cost-final-03-orchestration-02`迁移同一选择职责，并登记/核对实际执行四文件的路径与SHA；旧四原件逐字保留，原输出批次不改名。新manifest SHA-256 `46195f07b02a118252b007391d46bd94d950c410805401032b97d911a28682f0`，ROOT独立复核SHA-256 `5fd3adf9aa3e42d09972fe931d35cdbc5fce137cf3b72aa28d848d13322ccef0`。执行时必须调用实际phase文件，不能复制进临时脚本绕开__file__登记；在最终源码冻结后依次新after构建、14构造/16固定响应、7对分析，保持author/seed/runtime/初始DB/原文及before证据不变，零真实模型调用。当前只有准备和纯选择器证明，没有实际成本构造、请求成本改善或Token/缓存/延迟结论。新六场原生验证、七对成本及原scope完整出口通过前，R05继续doing。

### 16.29 最终原生回放消费者的目录与分页闭合

**成本分组已签工程门。** `81545ef64ea23686b2a24e5f0764b690857bf6a7`只提交driver与§16.28事实，精确tree `51458240ff8d5ad25c8d305ef62c884e2c252169`。其独立2660文件候选实际46/46，owned `3bee679ac7fed3cd` child0、进程树完成、无超时；结果SHA-256 `e17b64e96c5f7c78c0a3136dd5c4176c970d591eef11374314cec90e32ef99af`。实际driver/semantic来自成本checkout，RequestIR来自已验产品05构建且与成本源逐字相符，六项身份guard全真；格式、diff、NEXT、设计追踪均0。独立报告 `direct-explore-cost-01-independent-review/review.json` SHA-256 `97712803947edd6d8c7aab08223e3a3dd0e61db494933d69e21a8b30f8911ec0`签仅两文件，正常提交后工作区只剩原48项WIP，源字节不变、未push。真实成本构造仍未启动。

**执行前发现另一个现役消费者。** 六场live/r03-candidate入口预审未发现直接explore作者正文或固定作者事件次数依赖，原17源码和六预注册证据见 `direct-explore-native-preflight-01/review.json` SHA-256 `7445911981d5c7dd9dc7fe12da280babeab219c3772f15149fd657b878063cd1`。但最终F1文档提交后的确定性B71入口实际路由为full-read，现fullReadOutcomeChecks仍要求全部探索事件恰好2条，旧单测仅两个payload.query对象就通过。当前SliceVerify实际先archive_read/chapters，再读正文首页、再复制真实footer续页，共三次读取；独立反向审查 `f1-full-read-preflight-review-01/review.json` SHA-256 `03bc74a50fec992561a581f864eaf8f1b08929fd9afd69aff82edaa2eb18a9a8`记录18源。WorkspaceChannel只将author_visible的AgentEvent推送为agent_event，开发者观察不在本wire集合；状态快照又是agent_run_state，现received/topic/实际ACK run_ref/event过滤继续有效。本项是静态发现，尚无新原生执行结果，不改写原批次。

**存在性与最小设计。** 复用现authoring_scenario_evidence中的nativeRequestChecks及fullReadOutcomeChecks，前者只追加返回自己已经解析的末请求terminalExchange，后者在同一owner核全部owning事件；不新增parser、DTO、测试模块、全局过滤或采集平台。严格prefix成立后消费末请求图，避免将同观察在多个请求里的重复供应算作多次读取。以现observationRefOf把每条事件的observation_ref唯一绑定请求content.observation_ref，再沿原exchange核真实call_id及完整explore_request；事件本身没有call_id/status，不能要求或伪造这两个字段。三个实际读取必须按目录、首页、续页顺序闭合，目录包含章ref，两页为同章、同已供应版本、连续1–6000/6001–7000、total7000、offset0/6000及首页next_offset6000/末页null。query/summary/source_refs/versions按已供应原值相符；coverage只核真实共享字段与页事实，不能把请求额外的coverage_note/continuation_hint等强制要求事件具备。任意缺失、多余、重复、错序、未绑定或畸形owning事件均失败，不按tool筛掉反例。原工具闭合、footer字节、Scope耗尽、Base不重复、真实末页可见、零候选及生产计数不变门保留。

**证明边界与反例。** 现F1 start/final没有独立的正文/版本baseline；proseObservationBodyReason和singleDraftVersionReason需要独立expected，不能从被验证payload反造expected，也不能借用限定G2场景/目标的wrapper。这里证明同次真实事件与请求材料的一致性，不宣称独立核准DB正文或版本值；R05的G2/whole原文基准与六场语义证据仍分别验收。测试先在现owner提供独立完整请求/事件正例，覆盖目录及两页、真实coverage扩展，再以缺目录/缺页、重复/第四事件、错序、跨章版本、call/ref错绑、单边正文或元数据篡改形成反例；禁止把双边自洽当作独立全文真值。先真实红测、后实现与精确候选Node门，单独提交，再冻结完整工作区；count-06/quality-07及四场未消耗输入仍按§16.27原预算推进。本项不改变产品读取行为、作者语言标准、原失败原件或原scope，R05继续doing。

**红测与实际查询来源。** `full-read-consumer-red-01`在未改生产实现的HEAD `81545ef64ea23686b2a24e5f0764b690857bf6a7`上真实运行68项、38通过/30失败（包括失败的父测试）；owned `909371fb09935d94` child1、进程树完成、无超时、源身份前后不变，日志SHA-256 `496711d65dc2af0f906e0f51d690d7687c00296699dc10ed59bc4d6d089390c3`。新完整请求先通过全部原请求门；旧“两query”例明确得到所有旧门true而误授，其余多数失败来自新增判据尚不存在，不能解读为30个独立产品缺陷。随后反向核查发现默认SliceVerify目录请求为裸chapters，原调用、实际观察、作者事件三端都保原值；JSON仅是另一条合法输入，不能用它替代默认路径覆盖。补充报告 `f1-full-read-preflight-review-01/query-alias-review.json` SHA-256 `268d3b3cc1c1242cc7457ec8d5166023bdc5158a551a78fc11013eb4ba1c3b31`。正例须覆盖实际bare与三端同值JSON，单端改成等义JSON仍必须失败；现fixture Provider实际记录canonical IR，故亦须经现irBodyFromWire和真实reader覆盖IR对象参数，不能仅测Chat参数字符串。完整固定事实归现fixtures/authoring_run_scenarios，无同责现成factory，已审新增局部fullReadScenarioFacts；不新增文件或parser，原样本/失败原件保留。

**新增消费者的真实原生验证顺序。** 单测及精确提交门通过后，先在最终冻结源码上执行一次既有B71 full-read确定性原生回放（新tag `b87-r05-readbind-01`，一次作者发送、零手工重试、零真实模型），验证新证据消费者与真实应用输出的接线，再启动六场live预算。使用原scope记录start/finish绑定；若源码此后不变，该实际绑定可供F0完整出口复用，不为它另建scope。F0通过后才写R05/NEXT事实并提交F1；F1仍须在新文档源码身份上另作既定确定性回放和原scope完整出口，不能借用F0绑定。此顺序针对刚修改的原生消费者及已发现的shape差异，不代签六场实模或成本。

**实际落源与红绿结果。** ready02在原实现上真实运行70项、38通过/32失败（31子例及1父汇总），owned `ffc5c9cd0495a596` child1、进程树完成、无超时；日志SHA-256 `b7c20046cfa068aab694e43f575b9639c83043d1f03902fb1e68e547ad604b0f`，源身份不变。其中2项合法wire正例及28项反例因新增键不存在而失败，另1项直接捕获旧两query对象误授；没有语法、加载或fixture执行错误。首正例的IR断言和逐项翻转旧门的循环位于失败断言之后，红测没有执行这些后续分支，不能代签IR路径。A独立静态报告 `f1-full-read-implementation-independent-review-01/review.json` SHA-256 `3b7859a0e12ab7807f3e65b6e6dac9405fa9bf427c92309a1e1c5b35649cb6e7`确认真实bare/IR字段、末请求身份、共享coverage和旧门保留；复用frameBody不存在实际回环或加载期I/O。随后唯一生产owner以五项fenced精确编辑落源，实际SHA-256 `621eb40f8a7324771497a18defc33ec0cbd4979157529aced7110f515ced4fe5`与已审候选逐字相同，逆操作可还原全部原字节，应用报告SHA-256 `a85c2a6bed4067528058d6aa1edfe7fcb4f56c72cd694be17dd91157b89b5a0f`。ROOT绿色 `full-read-consumer-green-01`真实70/70，owned `841b647065f1d351` child0、进程树完成、无超时；日志SHA-256 `d8e7755aee9d5d726d5c29dfdc88b4201bde617bacb609f558f4878c73398af6`，源身份不变。该次才实际覆盖新增canonical IR正例和逐项旧门反例。测试/既有fixture分别1496/263行，未删反例、压行或提高size基线；只用现有三个源码owner和本节事实形成四文件可审提交。以上签单测与同次材料闭合，不签真实原生或独立正文基准；精确候选工程门、完整扫描、六场live、七对成本及原scope出口仍按原要求，R05继续doing。

### 16.30 Markdown硬换行的原生可见证据闭合

**已提交工程门与冻结扫描。** `4941fbb6bbc7f8c61b60375a234d75b985ceb3b0`正常提交§16.29四文件，tree `bd8d788f9476a4404d43d3a023d3f4e6f3aca9fd`与已验候选相同。独立2660文件候选实际70/70、0跳过，owned `4d76bce147762939`；规模门owned `1f3a3b26a5ecbb64`，diff/NEXT/design均0，五项身份guard全真；独立审核SHA-256 `ceb01e1efd4213d9cf120006d30599642960da306af23ec7dbc0006dda1b508b`。提交后2669源字节不变，仅原48项WIP、index空、未push。`full-static-05`在该HEAD和fingerprint `fa430b04bcc5c5ceea711f374a6c58b9d6bca8b750ac89fd6e475b3aac974f17`上执行全部21项，20原始0、gitleaks原始1、0跳过、0阻断；8项仍为7 false_positive和1既有accepted_risk，与04规范化发现及处置逐项相同，不能写成21项原始全0。唯一touched是原48项中的design pen、字节与04相同，标记来自现文件级算法。owned `b29400e2d42a3a8a` child0、进程树完成、无超时，前后身份不变；report SHA-256 `17c183e0fec7028767d81f58b34120907023dadc14fbc37d84d6ef665d90599e`，独立元数据审核SHA-256 `e1ca80db239e64d7fbbb79987a78abd071ce5f75fec44d989e2773e9567c7a69`。

**确定性接线已真实验证。** `b87-r05-readbind-01`在上述冻结源码上实际20/20，一次作者输入、四次slice_verify确定性Provider调用、零真实模型；三条author探索事件与末canonical IR原调用/观察按bare chapters、offset0、offset6000闭合，同章同供应draft版本2、范围1–6000/6001–7000及next6000/null。真实窗口首尾截图显示目录、两页阅读活动及末页手印事实，无待定卡；原始文件46项前后SHA相同。summary SHA-256 `79daf0ba889913bca150af0e144b0e36216faf359a67be098db01ebfb967aed6`，原e065 scope绑定在 `deterministic-readbind-01/binding.json`，SHA-256 `5ea46806925fb36fdc82194c990158579ed93c1cd000467066aa73c69c50fb83`。owned `166bc70a240be2f2` child0、进程树完成、无超时、53779ms；独立审核SHA-256 `153e588843160561af66c4c94abe6d7a61ebca5f93ec52f693f2c9ba072ce470`。该结果签接线与同次材料一致性，不签独立DB正文基准或实模文学质量。

**首场live的原失败保持。** 前向准备仅将count-05/quality-06改新id及输出目录为count-06/quality-07，其余输入、seed、runtime和预算逐字不变，四场未消耗预注册不改；准备manifest SHA-256 `529406de4de0264d9f9c591edb72f9225e2c873bc169abe002e1281b796515a4`。count-06在同一HEAD实际只发一次作者输入、一次Splash调用并返回HTTP200，usage为input10728、cached0、output65。回复原文为三行“总章数：2／有正文：1／还没写正文：1”，原source以Markdown两空格换行分隔；数值满足冻结2/1/1，真实final/start/end截图和AX均完整显示三行。材料/调用/源身份/成本分类门通过，唯一author_visible因reply_text_mismatch为false，summary仍5/6、all_checks_passed=false，driver0/runner1/binding1。owned `9f0a1587b44e6ebb` child1、进程树完成、无超时、30144ms；summary SHA-256 `7a4e7fe2a693a0f6589d141c3e290084e7a0b65bac4b6b0e51cc83e15c89db04`、failure SHA-256 `e2b48006d99c0c2f1bfb8ce333231aa665abe43ec27a934fc1327e9110932e44`。不覆盖原summary/failure、重放旧batch或用截图代签原失败；后续五场及真实成本暂未启动。

**根因与现有owner。** 现authoring_r05_evidence的replyInline把AST break降为普通flow换行，replyParts再折为空格；replyActualUnits却将同一AXGroup的三个无空白叶直接拼接，导致expected与actual均1 unit但分隔信息不一致。count-06实际三叶属于同一/18组、纵坐标510/535/559；不是未交付或模型数字错误。该659行owner和464行专属authoring_r05_reply.test原本与HEAD及直接explore重构前字节一致，属于被新合法回复形状暴露的既有验收投影缺口。复用现Markdown AST、unit matcher、validRect、group/page/match/visibleInput/replyViews；不新增parser、公开实体、模块或产品格式限制，不改Renderer、ADR-0036和模型指令。

**最小修复与反驳条件。** 仅在现私有parts保留明确hard-break标记及AX实际叶边界，原text不重写；明确break可消费同unit正确offset的相邻叶跨行证据（两frame有效且后叶起点不早于前叶底边），或单叶已存在的真实LF/CRLF。普通CSS空格仍须消费至少一个实际空白，code字面空白逐字匹配；缺frame、同行、重叠、错误断点不能补成break。matcher在raw offset上处理首尾范围，单个零宽边界只能消费一次，邻接显式换行不能重复计为第二份证据。先在专属既有测试owner写独立正负样本再真实红测：三叶/单叶换行、代码邻接、连续break、缺行/错序/改数字、断点与frame不符、普通空格丢失、首末视口分别核验；原错轮次、重复、截断、跨区和采集身份门保持。实现、单测、精确三文件候选和新完整扫描通过后才登记新的count批次；未消耗的其余输入保持原预算。由于源码将改变，readbind-01仅保留旧冻结身份的通过事实，F0须取修复后同源码真实原生绑定，F1仍另跑既定确定性回放及原scope完整出口。R05继续doing，不推进R06。

**独立事实与实际红绿。** count-06独立报告 `count-06-independent-review-01/review.json` SHA-256 `19df7ffca6557274fb92a5d914709088326dfad23dae04cb0c70c82b8e008933`核70原件和3附加身份文件不变，回复canonical/ProviderOutput来源、author事件、turn_result及raw_content同源51字节，SHA-256 `07eb3b85370f9e9ede332d45701ea803691772ab7fccc5fe175d3d7315d597c3`。此处未采集raw HTTP/SSE字节，不能将持久来源闭环夸为原始SSE证据。修复测试ready SHA-256 `518476c510389316178bfc04a58a3c0651feb85d81d3a0fd98fec9245d66ff3a`保原24949字节为精确前缀，只在现专属文件追加七个顶层用例，464→581行。ROOT原实现红测 `hard-break-consumer-red-01`运行两个现有测试文件，62项中58通过/4失败，无父汇总失败；owned `c7fb79d725126035` child1、进程树完成、无超时，日志SHA-256 `c331a1c680b45f8f4a3c4e31c0bdc906519532d2cc470415f21ba0297ccff66a`。四个实际失败分别是合法三行跨叶误拒、普通空格误授为hard break、代码邻接跨叶误拒、两个break被单LF误授；它们体现同一投影缺口，不计作四个独立产品缺陷。相关用例中的后续视口、代码收缩/首尾空白、零宽边界复用等断言被前置失败挡住，须绿色实际覆盖。B唯一生产候选659→691行，经A静态独审SHA-256 `d934bb3084b49e69367e2e959383afaff6b906aec5d913c1329d5543cc2d4f88`及ROOT审核后，以一个fenced change应用五处修改；实际SHA-256 `3ff374278d15888c7a2b2c45af22d476b36706fd9361d0aeed33e12b7f3f2dd6`逐字等于已审候选，逆操作恢复原文件，应用报告SHA-256 `0ccba7b2f8574583d0cf68e1de9fb3c7d72af2a9b1106926dcd1036a736d26ff`。ROOT `hard-break-consumer-green-01`同一测试输入实际62/62，owned `af16fc9139fa81c4` child0、进程树完成、无超时，日志SHA-256 `b4d9e84805805224d329378f0a7f41122a0a7c881e44fde94a84f8f90ba5cb82`；红绿各自源身份前后不变，零模型、零native、未重verify count-06。精确候选将以同字节frontend package及pnpm锁绑定现第三方安装（安装锁与冻结锁逐字相同），不借根工作区源码；本组三文件仍不与原48项WIP相交。以上签局部单测，不签新的live场景或R05出口。
