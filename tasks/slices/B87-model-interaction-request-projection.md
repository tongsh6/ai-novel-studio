# B87 · Issue #4 模型交互体系系统性重构：实施总计划与唯一任务状态源

> **补充评审输入（不改变任务状态）**：[完整 JSON 协议候选包](../../docs/design/contracts/model-interaction/README.md) 已按现有 SSOT 目录归档；Schema、合成正反例、字段/状态说明和离线验证互相可达。它保持源基线 `f13ff640`，与 `04492ea3` 的增量差异见 [归档说明](../../docs/design/contracts/model-interaction/integration-notes.md)。R00/R07/R08 先对账，不将离线 PASS 当作本任务任何批次完成。

**状态**：**doing（2026-11-13：R00 事实/契约审计交付完成，收口见 §9.6；R01–R19 未实施，生产行为未变；远端 CI 基线缺口仍开放）**。

- 目标分支：`develop/dialogue-based-novel-workbench`；执行时以最新 HEAD 为准，不使用 2026-11-11 的旧日志推断现状。
- 关联：[Issue #4](https://github.com/tongsh6/ai-novel-studio/issues/4) / [VS-00M 唯一增量架构契约](../../docs/design/contracts/VS-00M-model-interaction-request-response-contract-pack.md)（Proposed 重审稿）/[VS-00L](../../docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md)（Frozen）/[ADR-0035](../../docs/design/adr/ADR-0035-session-scoped-canonical-authoring-context-v3.md)（Accepted）。
- 本文件是 **唯一执行状态真源**；[批次 README](B87-model-interaction-request-projection/README.md) 定统一执行门禁，各 `Rxx.md` 只给该会话的目标/范围/验收，不登记独立进度。索引/NEXT 只导航。
- 作者 2026-11-13 最初授予**设计与任务文档调整**权限，原则为：**未上线、无历史兼容、彻底重构保持 clean、所有新实体/设计先查重、践行 SOLID/DRY/KISS/YAGNI/SoC 等原则**。当时仅文档落地，**不等于当时已授权并执行生产代码/数据库修改**；本次后续授权见下条。
- **后续授权（同日，本次 goal）**：作者授权高质量推进 NEXT，要求先整体审查设计再实现，并明确使用 dsh-worker。此前“仅文档”的授权记录保留为历史事实；现在可按任务契约推进实现，但不据此把 Proposed 方案、自动采纳产品语义或未运行验收记成 Accepted/PASS。当前先完成禁止生产修改的 R00。
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

**生效**：用户明确要求未发布**不兼容历史**、彻底重审、实体存在性红线与软件原则；本文件完成**规划/契约建议文档修订**，不改生产代码。保留原产品既有作者采纳、权限、证据、安全约束。

**需由 R00/对应批在代码和 Frozen 合同上确认**：
- 旧 Scope 与纯讨论覆盖究竟能否用现有 `Compaction` 精确表达；不能时先补唯一契约再迁消费者；
- 模式持久位置、授权委托的范围与到期/撤销，是否确需新最小字段/实体；
- `smart` 可重复、可解释的保守决策表达，不得以模型自评风险替代；
- `capability_lookup` 是否真有新增的业务消费者，避免平行探索工具；
- B71 的 G3/G5/实模遗留与本任务最终 R19 的证据边界，分别归各自任务维护。

**最先可启动**：R00（只读审计+冻结冲突核对+实体查重，不修改生产代码）；R01 需 R00 形成经过复核的成本样本。其它批次依实际依赖推进，不能因“作者授权改设计”自动跳过 R00。

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
