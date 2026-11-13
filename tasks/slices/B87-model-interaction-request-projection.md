# B87 · Issue #4 模型交互体系系统性重构：实施总计划与唯一任务状态源

> **补充评审输入（不改变任务状态）**：[完整 JSON 协议候选包](../../docs/design/contracts/model-interaction/README.md) 已按现有 SSOT 目录归档；Schema、合成正反例、字段/状态说明和离线验证互相可达。它保持源基线 `f13ff640`，与 `04492ea3` 的增量差异见 [归档说明](../../docs/design/contracts/model-interaction/integration-notes.md)。R00/R07/R08 先对账，不将离线 PASS 当作本任务任何批次完成。

**状态**：**doing（2026-11-13：R00 只读实体/契约审计已完成并形成裁决；R00 共同门禁尚未执行，未签 PASS；R01 尚未启动）**。

- 目标分支：`develop/dialogue-based-novel-workbench`；执行时以最新 HEAD 为准，不使用 2026-11-11 的旧日志推断现状。
- 关联：[Issue #4](https://github.com/tongsh6/ai-novel-studio/issues/4) / [VS-00M 唯一增量架构契约](../../docs/design/contracts/VS-00M-model-interaction-request-response-contract-pack.md)（Proposed 重审稿）/[VS-00L](../../docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md)（Frozen）/[ADR-0035](../../docs/design/adr/ADR-0035-session-scoped-canonical-authoring-context-v3.md)（Accepted）。
- 本文件是 **唯一执行状态真源**；[批次 README](B87-model-interaction-request-projection/README.md) 定统一执行门禁，各 `Rxx.md` 只给该会话的目标/范围/验收，不登记独立进度。索引/NEXT 只导航。
- 作者 2026-11-13 明确授予**设计与任务文档调整**权限，原则为：**未上线、无历史兼容、彻底重构保持 clean、所有新实体/设计先查重、践行 SOLID/DRY/KISS/YAGNI/SoC 等原则**。当前仅文档落地，**不等于已授权并执行生产代码/数据库修改**。

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

### 8.1 R00 只读审计结果与冻结裁决（2026-11-13）

**审计基线**：活跃分支 `develop/dialogue-based-novel-workbench`，HEAD `a43d374c56e83e4d5bf60fa462fb3e26fb563659`。本轮只读检查生产代码、契约、任务卡、测试资产与 CI 日志；未修改产品代码/数据库、未调用 Provider、未创建产品实体。

**R00 结果边界**：实体与契约审计已完成；由于当前会话没有仓库本地 checkout，未执行 README 要求的完整共同门禁、`git diff --check` 和 `node scripts/next_task_check.mjs --open`。因此本批记为 **BLOCKED（审计结论已形成，门禁证据待补）**，不得记 PASS，也不据此启动 R01 的真实 Provider 调用。

#### 7 问审计结论

| 问题 | 当前事实与裁决 |
|---|---|
| Contract | VS-00L 与 ADR-0035 是 Frozen/Accepted 运行契约；VS-00M 是 Proposed 设计候选。源包基线 `f13ff640` 到归档核对基线 `04492ea3` 只有一个提交，改动限于 VS-00M `6.1`、R07、R08。新增硬约束不能被误称为 Frozen。 |
| Invariant | 会话 Transcript + AgentRun 执行段是 canonical；`NovelCommon.RequestIR` 是唯一 IR；checkpoint 不改写 canonical；Provider 能力按真实 adapter route 派生；模型建议、Gate、执行、候选、Canon 采纳必须分开；作者可见叙事必须绑定真实 Provider 输出字节。 |
| Boundary | RequestIR/Compaction 属 `novel_common`；会话历史、压缩派生、判断、Gate、采纳属 `novel_application`；canonical 会话持久化与 run/receipt/provider facts 属 `novel_persistence`；Provider route/wire 属 `novel_agent`；前端只消费 Workspace/TurnResult/作者动作，不建立旁路事实源。 |
| Consumer | R00 结论的首个消费者是后续 R01（测量输入）与 R03/R04（Scope/历史投影）；R07 消费工具协议与结果闭环；R06 消费作者可见来源约束；R09–R15 消费授权/风险/采纳边界。 |
| Proof | 代码、Frozen 契约、数据库 Schema/迁移、调用点和已有测试分别核对；“有模块”不等于“完整支持”，历史 fixture/离线 Schema PASS 不等于当前产品行为 PASS。 |
| Acceptance Driver | R01 成本基线由真实 Tauri 会话与 Provider JSONL 取证；3/10/20 压力样本用固定输入确定性构造；R06/R07/R08 等行为变化仍需真实工作台入口，不能由单测代签。 |
| Exploration | 只读复用现有实体；不引入新 Request/Registry/ToolResult/Authorization 平行实体；任何新对象必须由具体消费者、现有替代失败和完整生命周期证明。 |

#### 现有实体与消费者裁决

| 领域 | 已存在实体/实现及真实职责 | R00 裁决 |
|---|---|---|
| Canonical 会话与请求 | `AuthoringSessionHistory`、`AuthoringTranscript`、`AuthoringCheckpoint`、`AuthoringSessionLog`、`NovelCommon.RequestIR`；会话日志 append-only，按 sequence 重建；Application 组装请求视图 | **reuse / refactor**；不新建 ModelInteraction 持久模型或第二 Transcript |
| 压缩 | `TranscriptCompaction` 选择未覆盖且已闭合的 tool exchange；`RequestIR.Compaction` 以 `covers.call_ids` 验证和投影；首个生产消费者为 `AgentRunServer` | **reuse**；当前只覆盖完整 tool exchange，不覆盖纯 Scope 更新 |
| Provider 能力与 wire | `CapabilityProfile`、`Provider.Gateway`、adapter `capabilities/1`；必备能力来自 RequestIR，未声明按 false 处理 | **reuse**；不新增 Provider 能力注册表或第二执行路径 |
| Provider 证据 | `NovelTelemetry.LLMLog` 记录 request/response body、usage、duration、provider refs；`ProviderRunLog` 持久化 author-safe run/event/output 与用量摘要 | **reuse**；精确 wire 取证读 LLM JSONL；ProviderRun facts 仅交叉核对，不能替代原始请求体 |
| Capability Registry | `NovelCommon.CapabilityRegistry` 是公共能力事实；`NovelApplication.CapabilityRegistry` 提供应用侧扩展；`CapabilityRegistryEntry` 统一条目结构 | **reuse**；两层是公共基线+应用扩展，不是应再建第三个 Registry |
| 判断工具 | `JudgmentToolContract`、`JudgmentProtocol` 已有 judgment/continuation、ask_author、plan、登记作者内容、方向提案、作品画像修订、能力缺口和 explore_request | **reuse / refactor**；`capability_lookup` 没有已证实的首个生产消费者，当前拒绝新增；`write_candidate` 不是现役工具，R07 必须先证明现有候选流程不能表达再决定 |
| 工具结果 | `NovelCommon.Contracts.ToolResult` 已表达 status/output/state_delta/artifact_refs/errors/warnings/usage/trace_refs；`TurnResultBuilder` 消费它 | **refactor existing contract**；不新建第二 ToolResult/Envelope struct。R07 将 Proposed wire envelope 映射到现有事实；确有缺失字段时修改唯一契约并迁移消费者 |
| 授权/确认/采纳 | `AgentRunRecord.run_policy/authority_scope`、`AgentRunPolicy`、`MicroPlan.risk_hint`、`GateOrder`、`ConfirmationBinding`、`ApprovalAudit`、`AdoptionWorkflow`、`AuthorActionReceiptRepo` | **reuse current run/gate/receipt/adoption path**；现有 run scope 与一次确认/动作回执不等于持久、可撤销的用户委托生命周期；R11/R14 必须核表/列/事务/消费者，不预建通用 Authorization 服务 |
| 作者可见来源 | `AgentNarrativeSource`、`NovelCommon.AuthorVisible.Text`、`AuthorVisible.Presenter`、`TurnResultBuilder`；JudgmentProtocol 的 tool narrative 从 Provider output 绑定 | **reuse**；B86 C9 完整归 B87 R06；不新增并行作者文案过滤器/来源 Serializer |

#### Frozen 冲突与唯一裁决

1. **纯对话/Scope 覆盖：保持 Frozen，不暗改。** VS-00L `16.2` 的 checkpoint 选择器是非空 `call_ids`；`RequestIR.Compaction` 只允许完整、恰好一次闭合的 tool exchange。纯 Scope 更新没有 call_id，当前不会被 checkpoint 覆盖，继续保留在历史/请求投影。R01 先测其真实重复成本；如 R03 证明必须折叠，先修订 VS-00L/ADR-0035，明确 Scope checkpoint 的身份、覆盖范围、恢复/replay、三 wire 投影和负例，再改消费者。**当前不允许纯 Scope 自动压缩。**
2. **full/自动采纳：当前禁止模型自行触发。** VS-00M `7.3` 是 Proposed 模式语义；现有 `authority_scope` 是 AgentRun 级执行事实，`ConfirmationBinding` 是一次性、绑定对象的确认，`AuthorActionReceipt` 是幂等作者动作回执。尚未证明存在 work/session/global 持久委托、范围版本、签发、到期、撤销/并发与审计生命周期。R11/R14 完成存储与消费者审计前，不实现 full 自动采纳；R15 只能在有效委托、再次 Gate、现有 AdoptionWorkflow/Repository 原子事务和回滚/幂等证据齐备后接入。
3. **能力查询工具：拒绝新增 `capability_lookup`。** 先复用 Registry、`explore_request` 与 `report_capability_gap`。只有真实作者场景无法由现有只读探索表达，且给出首个消费者后才可重新提案。
4. **候选写入工具：不预先接受 `write_candidate`。** 当前 `JudgmentToolContract` 没有该工具；R07 先对照登记作者内容、现有 tentative artifact/pending artifact 流程和真实执行入口，裁决为复用/重构/新建/拒绝之一。不能仅为统一命名新建工具。
5. **ToolResult envelope：不新增平行内部实体。** `ToolResult` 是内部执行事实；VS-00M `6.1` 的 `{ok,data,error_code,message,retryable,observation_ref,budget_after}` 只能先作为待对账的 Provider-facing 投影候选。R07 必须证明字段映射、缺失事实来源和错误/重试语义；不允许把 schema_valid、authorized、executed、candidate_created、canon_adopted 合并成一个成功值。
6. **content/decision/SSE：按 Proposed 条款进入 R07/R08 验证，不宣称已实现。** `content + write_candidate` 冲突、应用派生内部 decision、stream=true 的真实 SSE 与应用重组 JSON 区分，均需对应真实 Provider response/工具回流证据；不得把归档 wire JSON 片段当真实 SSE。
7. **B86 C9：唯一承接批次是 R06。** 现有来源绑定模块复用；历史失败案例保留为反例，已撤回实现不保留兼容路径。

#### VS-00M 源包差异核验

`f13ff6406a002eff54397b906872255048c31763` → `04492ea3b7a08cd4ce363110c099c6b4446a7488` 只有一个提交，改动仅三处：VS-00M 新增 `6.1`（8 行）；R07 新增工具结果 envelope、严格 schema/content 冲突和 decision/SSE 约束（3 项）；R08 新增局部改写范围、来源覆盖与 change_reason 一致性（2 项）。归档说明已明确原包 wire JSON 是归一/重组参考片段，不是完整 SSE 轨迹。上述变化是 R07/R08 的 Proposed 验收输入，不得倒灌为当前实现事实。

#### CI 基线对账（本次合并后 HEAD）

- 小说项目合并后整仓 run `43406293569` 为 failure；合并前基线 run `43401436744` 已有同四类失败。逐项日志对照确认以下失败签名在合并前已存在，但不据此推断所有根因完全相同：
  - Windows Tauri：`pending_message_is_durable_immutable_and_scoped`，`write before send: Access is denied (os error 5)`。
  - Elixir/Dialyzer：多个既有 pattern-match / unused-function / opaque-type 警告（涉及 workspace_channel、controllers、origin_policy 等）；Test(PR fast set) 被 Dialyzer 失败跳过。
  - Quality manifest：缺少 `artifacts/model-contracts/b39-cp1/au15-preregistration.json`、测试临时目录 `tmp/` 不存在，以及 manifest 计数差异（232 vs 231、234 vs 233）。
  - AI static scan：Gitleaks Secret leak scan `FAIL (1)`，Semgrep `PASS`；具体 finding 需读取 artifact，不能仅凭摘要判定误报。
- 新增 Project Operating Context 专项工作流 run `43406293644` 成功；它只证明画像/入口/只读校验，不替代整仓 CI。
- 以上为基线红灯分类，不属于 B87 R00 新引入的产品代码失败；根因修复应回到各自质量债务/原任务承接，B87 不降低门禁、不改样本换绿。

#### R01 Before 输入与读侧取证冻结

- **A：真实三轮样本。** 使用同一 work/session 的真实 Tauri 作者连续三轮输入；Provider 固定沿用已授权的 B71 Splash 预注册路径，不擅自换模型/推理配置。每个真实 Provider call 按 `provider_call_ref`/turn/session 分组，保留 tool call 与最终作者可见结果的对应关系。若 B71 既有授权不覆盖本次 R01 新调用，则先取得明确授权；不得把授权范围外推。
- **B：确定性压力样本。** 以 A 冻结的 RequestIR/消息序列为种子，构造 3/10/20 轮三档；明确标注 synthetic，不生成虚构真实 usage。固定 seed、Scope 更新、闭合/未闭合 tool exchange、observation/ref、正文基线和 projection 版本。B 只比较当前实现的字节/Token/前缀增长；没有真实 Provider 调用时 TTFT/latency/cached_tokens 标 `not_collected`。
- **读侧 SSOT：** 精确 Provider request/response body 读 `NovelTelemetry.LLMLog` JSONL（`log/llm-calls/YYYY-MM-DD.jsonl`）；`ProviderRunLog`/`ProviderOutputRecord` 用于交叉核对 run 状态、usage、duration/ref，不作为完整 request body 来源；`RequestIR` 与 `RequestIR.Projection` 只用于确定性重建/对照，不冒充实际发出的 wire。
- **隐私：** LLMLog 的 request body 会包含真实作者文本，当前 `sanitize_request/1` 不等于内容脱敏。原始 JSONL 只在受限本地环境读取，不提交 Git、不上传 Actions artifact；报告仅保存 source path、SHA-256、字节/Token 计数、provider/model/options、refs、时间/延迟与必要的脱敏分类。cached_tokens 是 input_tokens 子集，不相加。
- **当前可用性：** 本次 GitHub HEAD 未包含 `log/llm-calls/stage/2026-10-29.jsonl` 或 B71 ignored artifact `scenario-preregistration-splash-20261113.json`；因此不能声称已取得真实三轮样本。R01-A 在合法日志/本地运行证据可访问前保持 BLOCKED；R01-B 的构造规格已冻结，但不得先把 synthetic 结果写成真实成本。

**R00 退出状态**：审计事实与设计裁决已记录；由于尚未执行仓库本地共同门禁、`git diff --check`、`next_task_check`，本批保持 BLOCKED。没有生产实现、数据库迁移或模型调用。下一步先补 R00 规定的仓库环境门禁；通过后才可将 R00 标 PASS 并启动 R01。
