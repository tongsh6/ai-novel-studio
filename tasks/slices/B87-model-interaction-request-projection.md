# B87 · Issue #4 模型交互体系系统性重构：实施总计划与唯一任务状态源

> **补充评审输入（不改变任务状态）**：[完整 JSON 协议候选包](../../docs/design/contracts/model-interaction/README.md) 已按现有 SSOT 目录归档；Schema、合成正反例、字段/状态说明和离线验证互相可达。它保持源基线 `f13ff640`，与 `04492ea3` 的增量差异见 [归档说明](../../docs/design/contracts/model-interaction/integration-notes.md)。R00/R07/R08 先对账，不将离线 PASS 当作本任务任何批次完成。

**状态**：**doing（2026-11-15：R00 已提交 `465b1a3f`；R01 可靠测量基线及工程实现已收口并分组提交，证据与限制见 §11.21；R02 跨层实现与本轮工程验证已收口并分组提交，真实原生验收受宿主系统权限阻塞，执行与恢复见 §13，未签 PASS；R03–R19 未实施，远端 CI 与既有全仓质量缺口仍开放）**。

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

**生效**：用户明确要求未发布**不兼容历史**、彻底重审、实体存在性红线与软件原则；本文件完成**规划/契约建议文档修订**，不改生产代码。保留原产品既有作者采纳、权限、证据、安全约束。

**需由 R00/对应批在代码和 Frozen 合同上确认**：
- 旧 Scope 与纯讨论覆盖究竟能否用现有 `Compaction` 精确表达；不能时先补唯一契约再迁消费者；
- 模式持久位置、授权委托的范围与到期/撤销，是否确需新最小字段/实体；
- `smart` 可重复、可解释的保守决策表达，不得以模型自评风险替代；
- `capability_lookup` 是否真有新增的业务消费者，避免平行探索工具；
- B71 的 G3/G5/实模遗留与本任务最终 R19 的证据边界，分别归各自任务维护。

**当前执行入口**：R00 事实审计已交付（§9），R01 真实测量基线及工程收口见 §11.21；下一批 R02 在独立编码上下文内先冻结结构化 Scope 字段与来源，再完整实现和验收。其它批次依实际依赖推进，不能跳过实体查重、冻结契约和完整验收。

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

开工基线 `ecf29a75ae73967f9dcbab03b2f8fb8a624de0ec`，R01 已按 §11.21 闭环；5 项既有 AGENTS/B84/扫描处置 WIP 保留。R02 使用独立实施上下文，先在 VS-00M §5.2.1 / VS-00L §19.2 冻结字段与来源，并同步 R02 卡的实际跨层边界，再改代码。本节当前为 doing，不代签机制、实页或模型行为验收。

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

- 原始 runner `wc_job_R65w7o7v5yJRyABM` 已终止，exit 1；cleanup `remaining=[]`，受控端口 4657/4661 已关闭。没有重发作者请求或重跑 R01 的 20 轮。Splash 三轮尚未启动；同宿主/同驱动的首个受保护动作仍会遇到相同权限边界，这是由已观测失败得出的限制，不是一次三轮实测结果。
- macOS unified log 将责任主体绑定到 `dev.webcodex.runner`，路径为 `/Users/loong/.local/share/webcodex-pkg/node_modules/@yyjeqhc/webcodex/vendor/bin/webcodex-runner`。应由作者在系统设置「隐私与安全性」为该实际宿主开启「辅助功能」及「屏幕录制」（系统名称可能为「屏幕与系统音频录制」），按系统提示重新启动宿主。未访问或修改 TCC 数据库，未绕过系统授权；未把更新时刻推断成未经证明的故障根因。
- 精确证据：`quality/b26-r02-native-blocker.json`，SHA-256 `4e0e1d01c11297302c937a1525eb4263259643a925a1f3623382674eed3ab729`；对应 `quality/b26-r02-ax-authorization.log` 保留原始授权日志。日志未出现模型调用标记，但一次 DB 查询未打开其假设路径，因此 **不声明数据库 provider_runs=0**。
- 恢复时先确认正常系统权限，再对当时最终源码建立新 fence，在全新 B26 目录重跑现有问题选择与自由答复脚本；原失败目录只读保留。自由答复沿当前真实单行入口验证首尾空格及 Unicode，实际 ACK/action/question/submission/run/source 必须同源绑定，LF/CRLF 仍只由独立后端/机械投影证明。
- B26 真实回路通过后，沿 R01 不可变 manifest 与完整副本运行既有 `b87-r01-request-cost` 驱动的 R02 三轮：首次三条冻结输入、Splash Q4-PLE4、thinking high、max 32000、timeout 300000、context 262144、retry 0；使用新 R02 artifact 路径，不覆盖 R01。真实 HTTP 缺同调用 `IR.refs.base_refs` 的 L7 保持 `request_base_refs_unavailable / unknown`，最终累计 Base、确定性前缀或 derived wire 均不代签。

本轮默认完整静态扫描的 task-done 直接失败是旧 `20261114T161400Z` manifest 已过期，检查尚未进入 Native evidence；不能把该 raw failure 改写成直接 AX 失败。真实 AX 阻塞与 stale manifest 分别保留。没有成功原生 summary 时，不复用旧成功材料或生成通过 manifest；R02 不签 PASS、不推进 R03。

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
