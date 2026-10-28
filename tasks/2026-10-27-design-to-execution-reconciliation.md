# 2026-10-27 全量设计到执行任务对账

- 状态：**done（2026-10-27，全量盘点、任务拆解与登记完成；未进入产品实现）**。
- 类型：跨周期设计/任务对账，不是产品 slice，不授权代码实现。
- 来源：作者要求不能只同步元原则与台账，必须分析全部设计及 `tasks/slices`（含 v3），把未实现、要修改、将要实现的内容拆成有依赖和验收的任务。
- 既有边界：`docs/design/` 为唯一设计真源；v3 是当前主导设计血缘，`tasks/slices/v3/` 是历史命名的当前承重工作区；B39 / VS-00K / ADR-0030 / AU-15 已有工作保留，不重复发明求证架构。

## 1. 目标产物

本任务只负责全量覆盖、证据对账、跨任务去重和登记，不直接实现产品能力：

```text
设计条款与任务原文
→ 当前生产实现 / 测试 / 真实页面与实模证据
→ 保留 / 修改 / 未实现继续 / 将实现 / 补验 / 退役
→ 原任务承接或新增任务
→ 依赖、阻塞与 NEXT 当前可执行顺序
```

完成标准不是“所有文件被提到”，而是每个可行动项都有来源、当前证据、真实消费者、承接任务和验收方向；每个不需要行动的文件也有可解释的不行动理由。

## 2. 全量范围

按盘点开始时的当前工作树：

| 分组 | 范围 | 覆盖要求 |
|---|---|---|
| 主链与领域 | `docs/design/00*`–`08*`、`domain/`、`foundation/`、`tech-stack/`、`notes/`、`docs/product/` | 主链逐条；notes 只作输入；技术约束不机械造任务 |
| 契约与决策 | `contracts/`、`adr/`、`schemas/` 全部 Markdown/JSON | 区分 Accepted/Frozen/Proposed、代码实现、schema/前端消费与真实验收 |
| v3 slices | `tasks/slices/v3/` 全部 20 份 + `tasks/2026-06-14-design-v2-to-v3-absorption.md` | 原任务、DAG、后续承接和退役逐一对账 |
| 后续 AU/B 轨 | `tasks/slices/` 根目录全部 AU/B/BEHAVIOR 文件 | 以原任务状态和剩余后果为准，不以索引摘要替代 |
| 其余任务 | `tasks/slices/` 根目录其余全部文件及 `tasks/` 顶层文档 | 去重、识别临时文件、保留最新并行完成状态 |
| 验收与 UI | `acceptance/`、`quality/`（设计与运行）、`docs/engineering/`、`docs/coding-standards/`、根 `AGENTS.md`、`docs/design/ui/`、quality scenarios/fixtures | 区分未实现、已实现缺验收、机制证据与真实模型行为；工程约束不机械造任务 |

基线数量（父子目录不叠加）：`docs/design/` 165 份 Markdown、`tasks/` 192 份、`tasks/slices/` 189 份（其中 v3 20 份）、`docs/design/schemas/` 38 份 JSON、`quality/acceptance/scenarios/` 214 个 yml。

## 3. 分类与登记纪律

| 分类 | 判定与动作 |
|---|---|
| 已实现保留 | 当前实现与证据满足目标，不重复建任务；历史证据保留 |
| 要修改 | 已有实现/机制，但责任、数据流、契约或消费面需要改变；优先修改原任务或明确承接者 |
| 未实现继续 | 原任务未闭环且仍有效，沿原任务推进，不新建重复任务 |
| 将要实现 | 目标需要新增能力或新承重 slice，必须写清七问、依赖和验收 |
| 补验 | 已有实现，缺真实页面、真实模型、原生交互或恢复证据，不重做产品功能 |
| 退役/被取代 | 已被新设计或后续任务取代，标 superseded/deferred 并链接承接者，不进入实现队列 |
| 需裁决 | 证据冲突、范围选择或作者主权事项，列出具体决策，不由 AI 擅自拍板 |

登记要求：

1. 原任务是执行状态唯一真源；本文件是覆盖与处置总账，不复制每份任务的详细执行记录。
2. `tasks/NEXT.md` 只保留当前任务、至多五个候选和阻塞引用，不写成完整 backlog。
3. 新增文件只放既有 `tasks/` / `tasks/slices/`，同步所属 README 与 `00c`；不新建 plans/specs 目录。
4. 新实现任务必须有 Contract / Invariant / Boundary / Consumer / Proof / Acceptance Driver / Exploration；只有设计输入时先标“需设计/评审”，不得直接授权代码。
5. 真实模型行为、确定性机制、真实页面、局部测试分别标证据，不互相代签。
6. 时间线等领域读模型按依赖排序，不抢通用求证架构的前置；不为每个领域新增固定 prompt packet。
7. 并行任务与 WIP 按当前状态保留；完成项不留在 NEXT，未闭环后果不得因合并或移出队列销账。

## 4. 分组结果汇总

> 六组只读审计结果将在此合并。未完成前本节只保留占位，不把待核对项写成事实。

### 4.1 主链、领域与技术设计

覆盖：主链 15、domain 12、foundation 6、tech-stack 18、notes 16、product 3，合计 **70/70**。notes 只作设计输入，不自动授权实现；旧技术选型“锁定/必须”不自动等于当前生产事实。

| 对账 ID | 分类与当前证据 | 承接与依赖 |
|---|---|---|
| A01 求证主链 | 未实现继续：B39 已证正文 profile 白名单、Base refs、used refs、replay 仍未闭环；CP0/预研已有 | 沿 **B39 CP1→CP4**，不另建架构；ADR-0030 Accepted、Base refs 形状/探索预算/CP1 边界先决 |
| A02 guidance 与 AU11 语义 | 要修改：`guidance_mode/element_focus` 非完整当前实现，AU11 旧场景 blocked；B27 34/40 known-gap | 沿 **B27**：G3 schema/旧 envelope 退役边界、五个失败定向硬化；B40 只做 AU11 场景重锚，不另起 envelope 项目 |
| A03 VS-00G 完备性与假定 | 未实现继续：CP5e 证据冲突，触发 C、寿命、works 假定、记忆富化开放 | 沿 **VS-00G**：先 A3 确认→正式档案、A2 否决→缺席守则，再按真实触发安排 C；不重复五账或新假定表 |
| A04 LongRunner 批量初稿 | 将实现（延期触发）：`TaskRunner` 异步仍只是 sleep/checkpoint/complete，真实生产消费者只有导出，批量入口未开放 | **条件式新任务 LONGRUN-BATCH-DRAFT，当前不排期**：作者重新开放批量需求；多单元后台、逐章 tentative、跨重启不重复、外部真实页面；B39/UA01 durable 不顶替 |
| A05 Projection 刷新生命周期 | **主审冲突，暂不据此新建**：一组只见 STALE/读取服务，另一组已证 B28/ReadingMode 有 FRESH/STALE/REBUILDING/FAILED 与 refetch/retry | 先按 **AU08/AU10 现有实现补验**，不重造 projection job；需核当前 ReadingMode、adoption hint、失败/重试契约，FAILED 与旧内容处理以现实现为准 |
| A06 Developer replay matrix | 未实现继续（深层 replay）：scoped old-turn/partial 已闭环，developer 权限、多类型、registry/redacted、reason catalog 开放 | 沿 **AU07 file-level follow-up**，不另建重复 `AU07-DEVELOPER-REPLAY-MATRIX`；先冻 developer 权限与真实消费者，B39 CP3 的 observation replay 分属其内 |
| A07 注入安全边界 | 补验先于实现：未检出专用 injection guard，但 GateOrder/Orchestrator/adoption 已有结构防线，不能据模块缺席断言无防护 | **新任务 SEC-INJECTION-BOUNDARY（先补验）**：作者输入/作品观察中的越权写库、伪采纳、泄密对抗；失败才做最小防线，不预建空 Guard，不重复 B39/SU01 |
| A08 PaperTrail 生产真相 | 要修改/待裁决：依赖与 versions migration 有，生产调用未检出；现有 `source_revision_ref + StateTrace` 是另一实现路径，spike 未勾 CI | **新任务 REV-AUDIT-PRODUCTION-TRUTH（先裁决）**：保留 PaperTrail 还是正式采用现有 revision/trace 替代；先只读 versions 存量与消费，再 ADR，不能直接删表或把 spike 当生产证据 |
| A09 技术栈当前重定 | 要修改：langchain/instructor/GenStage/Horde/OTel 等声明与当前 mix.exs、Provider、自研 codegen、Tauri sidecar 不一致；PaperTrail 例外单列 | **新任务 TECH-STACK-CURRENT-REBASE（doc/必要 ADR，非倒装依赖）**：逐项给当前证据或 supersession；以代码/lock/CI/Tauri 配置为准，不重装旧库，联动 A10 |
| A10 Multi-Agent 当前边界 | 要修改（必须作者裁决）：tech08 把 process-isolated Multi-Agent/24x7 当 day-1 绝对约束且“全部通过”，当前承重为统一 AgentRun，B39 禁第二 runtime | **新任务 ADR-MULTI-AGENT-CURRENT-BOUNDARY（只先裁决）**：保留/延期/supersede 由作者定；不得由审计擅自推翻历史拍板或借 B39 偷建第二 loop；tech08“全部通过”不得当验收事实 |
| A11 Canonical 引用与状态纠偏 | 要修改（doc-only）：glossary 错 ADR/死链、07 退役卡仍作前提、D6/I5/B22/B34 等状态前后矛盾 | 归 **本全量对账任务/必要时的 TECH-STACK-CURRENT-REBASE** 统一修正，不重做 absorption、B13B 或 DS01 产品实现；多 Agent 不确定项交 A10 |
| A12 时间线与时点状态 | 将实现（B39 后评估）：无同名 timeline_event/state_snapshot 生产对象，MemoryItem/Ledger 可能替代部分语义但无 Accepted 映射 | 沿 **B39 CP4**：先通用 chapter_read/prose_search 观察回流证明，再决定建立/映射/退役；不先建表、不把 08“已覆盖”当实现、不硬补模糊时间 |
| A13 创作方向长期召回 | 未实现继续：会话级软约定，跨会话/压缩无召回、why 与生命周期 | 沿 **AU09-work-direction-memory-recall**：先类型裁决，再采纳写入/召回/why；不把主档案更新当召回证明，不重复 B27 输入审计 |
| A14 B3 toolbox 遥测关联 | 未实现（B3 子项）：VS-10 spine 已有，但 toolbox run/turn 绑定 todo；AU-15 也要求 query→observation→provider call 对账 | 沿 **B3 observability 批**：统一 LogContext/异步边界与 B39 证据词表，不新建日志平台 |
| A15 B10 omission/摘要质量/why | 未实现（B10 子项）：OmissionNote 主要只覆盖 prior_prose，summary window/roster/ledger cap 缺省略记录；四栏结构不等于摘要质量 | 沿 **B10**：逐项 omitted refs+reason+恢复；区分 APP 未提供与模型未读取；why 面板只在真实消费者出现时做，不加固定 packet |
| A16 live vendor / SI T5/T6 | 补验（凭据）：SU01 矩阵/离线完成，live vendor、OAuth、DeepSeek live、SI T5/T6 仍 blocked | 沿 **B4 + SI + SU01**：真实凭据/订阅环境与生命周期；无凭据保持 blocked，不以 stub 或旧 live 代签 |
| A17 P1 word-count B/C | 未实现：A 已证空章/短章/阈值，重复段/重复章、缺章率与 word-count.json 补全未做 | 沿 **P1-word-count-audit B/C**：确定性段落比对和计划 seq↔已采纳章对账，不把计划章当正文，不先跑重型全量 |
| A18 P2 500K 里程碑 | 将实现（后续里程碑）：P1 已关闭，P2 尚无 500k；ReadingProjectionRepo 仍 `@audit_stage :p1`，不能直接复用阈值 | **条件式新任务 P2-500K-MILESTONE，当前不抢 B39 队首**：依赖 P1 B/C、作品级阈值、作者预算/排期，≥500k 有效字、每章≥2000、分卷/连续性/重开/导出；P3/P4 不提前吞并 |
| A19 AU04-AU06 行为矩阵 | 补验/未实现余项：高风险确认、取消、supersede 已有，但成功 terminal history、blocking clarification、持久 BehaviorBinding/timeout 未全闭 | 沿 **AU04-AU06**：先真实可达 producer，S4 只在误判/产品要求时另评；不伪造 producer，不重复 DS03 awaiting 恢复 |
| A20 外部探索翼 | 将实现（条件触发）：内部探索已有，SearchProvider/web_search 未生产；出站授权、来源可信度、query 脱敏未决 | 沿 **UA01-CP6**：真实研究需求+作者拍板出站粒度/来源信任/脱敏；外部资料只产带 URL 的 tentative 候选，采纳前零 canon，非 B39 CP1 前置 |
| A21 狗粮 runner 余项 | 要修改（验收 harness）：P1 实模已完成，B6/B7/B9 的帧分类多源、确认路径、Q1 空章、Q4 重复观察仍有债 | 沿 **P1 dogfood/对账**：只迁移真实旅程所需分类/确认/恢复，不改生产配合 runner，不做全 runner 框架重构；needs_confirmation 显式确认或 skip 计数 |
| A22 历史会话与档案矩阵 | 补验/将实现后续：历史搜索缺命中高亮/定位 turn，stats/detail current、pending inbox 等仍 partial | 沿 **AU03/AU09 已登记后续 checkpoint**：按实际 UI 需求拆小步，不重复 AU07 persisted query 或 AU12 快照；D09 持久 inbox 与档案视图统一承接 |
| A23 I10 文学盲评 | 补验（人工门控）：canonical-3e 与原生 scoped 提供样本，未指定负责人/时机 | 沿 **I10 既有条件项**：作者指定负责人、样本、时间、rubric；`walkthroughs/<date>/` 归档，工程/实模/文学结论分开，不用 LLM-as-judge 代签 |

**不另立任务组**：domain/33 Experience、NEM-GAP-02/04、domain/25 与 NEM-GAP-05/06 维持真实消费者触发；tech-stack 的 PostgreSQL/Horde/分布式/OAuth/OTel collector 属阶段 2；P3/P4 不跳过 P2；`structured-output-library-choice` 不重装 instructor/langchain；notes 中已承接的 Agentic loop、判断循环、容器调查、M5/M6、业务审计只保留后续原任务，不重复开。

**主审冲突单列**：A05 与 D13 对 Projection 当前实现程度判断不同，必须先核代码，不能按较旧设计新建生命周期；A06 与 D11 同指 AU07 后续，统一沿 AU07，不另立重复任务；A08/A09/A10 涉及历史明确技术拍板，必须由作者裁决，不能仅按“当前没有模块”就宣布 superseded。

### 4.2 契约、ADR 与 schema

覆盖：contracts 21/21、ADR 31/31、schemas+索引 41/41，合计 **93/93**。Accepted 只表示决策接受，Frozen 只表示设计冻结，codegen 只表示可生成；三者都不自动证明实现或验收。

| 对账 ID | 分类与当前证据 | 承接与依赖 |
|---|---|---|
| B01 Planner 语义边界 | 要修改/未实现继续：`PlannerBoundary` 仍偏局部 forbidden/ref 检查，完整 judgment→frame→plan 语义边界未闭合；B26/B27 不替代 | 沿 **B27 CP5 + B26 后继校验**，不建第二 Router/关键词分类器；与 B02 裁决联动，真实 gate/replay 验收 |
| B02 主链语义收窄 | 需裁决/部分退役：primary、reply-only decision、next_action、只读 output 的 Accepted 字面与当前实现不同，直接补字段会造无消费者对象 | **新评审任务**：主链语义收窄 ADR，先拍板再改 schema/代码；与 B01/B03/B18 联动 |
| B03 Gate 残余 | 要修改：12 门与 allow 已有 PASS，但 blocked 页面、真实 behavior/slot、同键异 payload 一致性未闭合 | **新后续任务 GATE-ORDER-RESIDUAL**，沿原 done 不重复；依赖 B02/B01，局部故障矩阵+可控真实页面 |
| B04 ChapterSummary 转换边界 | 要修改：Draft 矩阵已落地，`ChapterSummaryRepo` 仍可绕矩阵，非法转换没有仓储级保证；不是宣称已有非法数据 | **新小型后续 CHAPTER-SUMMARY-ADOPTION-BOUNDARY** 或 Q1CB 明确 follow-up；ADR-0019，非法注入回滚、合法 supersede 不回归 |
| B05 账本 StateTrace | 未实现继续：VS-00F 原任务仍记只有业务日志，契约要求的权威账面 StateTrace 未闭合 | 原 **VS-00F maintenance-trace checkpoint**；与 B04 分验，自动/作者两类变更均可 replay、失败无权威 diff |
| B06 其余五账 schema | schema 脱节：conflict/promise/emotion 在 Elixir 硬编码，JSON 只有 arc/info，`ledger_entry.status/payload` 过宽 | 原 **VS-00F CP2/CP3 schema checkpoint**；先确定真实 wire consumer，否则走收窄 ADR，不为生成而生成 |
| B07 VS-00G 余项 | 要修改/补验：CP5e 契约写 PASS 且有历史 summary，原任务未勾，状态冲突；触发 C、R8、works 假定、记忆类富化仍开放 | 原 **VS-00G**：先核 CP5e 证据/当前复跑，再按真实消费者推进；不得重复 CP5a-d |
| B08 VS-00D/B27/AU11 | 要修改/补验/部分退役：CP3 已接 AuthoringTask，旧 Envelope 退役；CP4 34/40、CP5 todo，AU11 blocked | 原 **B27 CP5 + B40** 分责：B27 做语义/调用点/G 项，B40 做 AU11/判断纪元验收重锚；不做第七次全量 retest |
| B09 I10 文学盲评 | 补验（人工）：样本已有，未归档人工盲评；AI 不得代签 | 沿 **P1/原 I10 候选**，等作者指定负责人和时机，写 `walkthroughs/<date>/`，工程 PASS 与文学结论分开 |
| B10 ADR-0022 评审 | 需评审：Proposed 但 N-NARR/PlanStep/重规划已有实现；历史“每次 observe 都 evaluate”和旧协议已被后续决策改变 | **新评审任务**：接受现行语义、另立新 ADR或标旧段 superseded；转 Accepted 才补 enforced_by/gaps，不直接改历史 |
| B11 ADR-0030/VS-00K/B39 | 需评审；Accepted 后将实现：CP0 done，CP1 只有预研，创作 run 探索/Base refs/used refs/准备判断/实模求证未闭合 | 沿 **B39**，不新建第二 agent runtime、writer 内循环或时间线 schema；SC-AU15 A0/A1/A2 分证 |
| B12 S7 非预算 awaiting surface | 未实现继续（条件触发）：预算短缺已闭环，no_progress/非预算 await 与恢复动作 schema 未闭合 | 沿 **ADR-0024 CP3 / DS03 尾项**，只有真实非预算 await 场景才实施；不与 S4 混任务 |
| B13 失败日志 turn 关联 | 要修改/补验：`agent_run.run_failed` 缺 turn_id，噪声断言的场景级兜底不能证明关联键协议 | 沿 **UA01 provider execution stream / VS10 尾项**，不新建观测平台；补 base turn/work/session 与三源串联 |
| B14 判断纪元证据重锚 | 补验/退役：11 份退役事件 manifest、VS10 过期、AU11/AU07 等不能当 current-HEAD PASS | **已登记 B40**：只处理质量资产与证据；功能修复回各 owner，不能用改断言掩盖缺陷 |
| B15 CA04 卷蓝图增量回归 | 补验：ADR-0028 明说 additive 后未复跑，旧 summary 仍在 | 原 **CA04 仅回归**：当前 HEAD 验证三条 carry 行为与 deferred gate，不新建卷功能 |
| B16 vendor cache/live | 补验（凭据/环境门控）：字段与部分 live 有证据，Anthropic/其他 vendor 未闭环 | 原 **prompt hardening + B4 条件项**；有凭据和消费者才排，缺凭据保持 blocked，不恢复双协议 |
| B17 B28/ADR-0029 证据 | 文档更新+补验残余：B28 已 done，ADR gap 落后；原生 48 项单批未跑 | 原 **B28 最新证据回链**；是否补 A3 由主审决定，不新建排版实现、不重跑换分 |
| B18 schema legacy 治理 | 要修改/部分退役：v2 `$ref` 缺失导致 `z.any()`，旧 enum 与现行 v3 不同，不能当完整 SSOT | **新小任务 SCHEMA-LEGACY-GOVERNANCE**：标 legacy/现役/消费者，隔离、显式 opaque、补本地定义或退役；依赖 B02/B06，不破坏兼容测试 |
| B19 文档/状态真源 | 要修改：contracts README、 slices README、VS-00G CP5e、ADR-0029 等落后于原任务 | 归 **本全量对账任务**统一修正，不新造产品任务；索引不替代原任务，开放项不得因文案同步被误销账 |
| B20 developer 身份引用展示 | 未实现继续（有消费者才做）：`system_identity_ref` 已进 activity summary，developer UI 显式版本/hash 未做 | 沿 **UA01 provider stream / T7 尾项**；与 B16 vendor 补验分开，作者视图不含身份原文 |

**无独立新任务组**：VS-00A、VS-00C 原 CP、VS-00E 质量主链、VS-00J 卷结构，以及 ADR-0006/0010/0011/0013/0014/0015/0016/0017/0021/0023/0027/0028 的当前核心实现均保留；只按上表或既有条件项处理。外部探索翼、adoption revive、durable 定期对账、Experience dismiss、S4 显式 clarification、卷 design_ref、writer 内 native 工具循环、时间线/state_snapshot 专用 schema 等均维持 Deferred/触发制，不因对账批量复活。

**主审特别抽验**：B02 的“补实现还是收窄”不能混同；B04/B05/B06 的事实链不能被 Q1CB、五账页面或 ADR 门禁绿外推；v2/legacy schema 的 `z.any()` 与现行 v3 有意局部校验必须分开。

### 4.3 v3 slices 与整合台账

覆盖：`tasks/slices/v3/` **20/20** + `tasks/2026-06-14-design-v2-to-v3-absorption.md` **1/1**。v3 是当前主导设计血缘，不是废弃目录；主要问题是旧状态、后续承接和证据口径未同步，不是整包重做。

| 文件 | 当前处置与真实承接 |
|---|---|
| `VS-00-implementation-plan.md` | 作为可执行计划已被 UA01/B26/B27 取代，只保留历史，不重做删建主链 |
| `VS-00-reply-only...` | 原始最小能力已落地；AU01 保体验，UA01/B26/B27 保当前协议与语义，旧 live 断言只重锚 |
| `VS-00A-creative-exploration-loop.md` | AU02 保自然探索；B26/B27 保当前业务工具与语义；不恢复旧 form_frame 口吻任务 |
| `VS-00B-dialogue-context-grounding.md` | VS-00C/CA01–04/WR 保实现；缺上下文不编造随 AU11/VS-00D 重锚，B39 接按需求证 |
| `VS-00C-creative-context-assembly.md` | 原 CP0–CP5 已完成，不新增 CP6；CA/WR 保留现有携带，B39 CP1–CP4 承接求证增量 |
| `VS-00D-ai-guided-authoring-message-contract.md` | 旧 Envelope 路线退役；B27 CP3 已落 AuthoringTask，CP5/AU11 重锚与 G 项处置待办，不恢复旧对象 |
| `VS-01-micro-plan-downgrade-confirmation.md` | GATE-ORDER/UA01/B22/B37 已承接执行与预算；`e2e-01-downgrade` 需重锚或退役，不能反推 gate 未实现 |
| `VS-02-tool-request-result-trace-loop.md` | 主链无需重建；UA01/AU07 保运行与 replay，B39 复用只读探索，旧证据按当前锚点重跑 |
| `VS-02A-tentative-creative-artifact.md` | 原能力已由 P1/AU09/Q3C/B28 扩展；durable 由 UA01 承接，禁止恢复 synthetic task_state_events |
| `VS-03-clarification-confirmation-behavior-lifecycle.md` | AU04/AU06/BEHAVIOR/B26/DS03 保当前停等；旧 surface 不恢复，8-1/9-2 仅既定触发再评估 |
| `VS-04-candidate-selection-adoption-boundary.md` | AU05/DS02/Q1CB/B28–30 已承接；revive/un-archive 仍是作者需求触发的条件项 |
| `VS-05-ui-available-action-roundtrip.md` | AU04/AU06/AU10/DS01/DS02/E2E 保 action 安全；FU-3 只有出现真实绕过 guard 消费者才升级 |
| `VS-06-trace-summary-replay-explanation.md` | AU07/UA01 保现有 replay；B39 CP3 新增 observation replay，不重建 ReplayService |
| `VS-07-frontend-workbench-ui-consumer.md` | 作为最小 UI 指南已被当前 WorkspaceChat/AU/SU/UA/P1 取代，不重造样板组件 |
| `VS-08-end-to-end-integration-tests.md` | 原固定 LM Studio CI 方案被 E2E/SI/Tauri/P1 取代；只保留验收维护，不另建集成层 |
| `VS-09-work-management.md` | SU02/AU03/AU08/AU09/AU12 已承接，高级异常与大列表仍按 SU02 P2，不重开原 slice |
| `VS-10-observability-spine.md` | 核心已存在；D11 只需判断纪元证据重锚，远程聚合/PII/OpenTelemetry 仍是非目标 |
| `VS-11-desktop-stage-process-ownership.md` | stage ownership 保留；生产 sidecar 归 SU04，签名公证/跨架构/tag 由外部条件触发 |
| `2026-06-14-design-v2-to-v3-absorption.md` | 整合本身完成；尾部 adoption repository 遗留已由 Q1CB/DS02 承接， revive 仍按条件 deferred |

**v3 需要行动的承接项**：

1. **B39 保留为唯一求证实现主线**：不新建 VS-00C CP6、时间线专用 slice 或 writer 内第二 agent loop；前置是 ADR-0030/VS-00K/AU-15 评审与既有 AgentRun/ExplorationService，不依赖 VS-09/10/11。
2. **判断纪元验收重锚（候选新任务 B40）**：承接 B27 CP5、VS00D-G 的 AU11 两条 blocked、B13B D7/D11 与 AU07 ToolTrace 证据漂移。只重写/退役旧断言、重跑当前链并修台账，不复活 envelope/form_frame，不重写产品功能；B27 的 34/40 known-gap 单列，不做第七次全量 retest。
3. **纯文档状态修正（不占产品队列）**：修 DAG/v3 README/absorption/slices 索引的历史状态与承接链接；当前实现/验收状态仍以原任务和 quality 证据为准。

**DAG 已核实的失效点**：主图缺 VS-00C/09/10/11；VS-00D→VS-00C 的投影关系未表达；VS-05→VS-06 缺边；VS-09/10/11 不应被伪串成业务尾部；VS-00D“implementation plan not authorized”和 VS-07 运行 blocker 已失效；多个子文件 batch 编号与 DAG 漂移，应只保留 DAG 链接。B39 的真实前置是 ADR-0030 与既有运行能力，不是“全部旧 VS 完成”。

**主审已抽验**：B27 CP5 仍 todo（`B27:117-128`）；AU11 blocked 的触发已经是 B27/G7 落地（`quality/acceptance/known-gaps.md:11-12`）；AU07 文件仍写独立 ToolTrace 未闭（`AU07-file-level-closure.md:49,57`），而当前 `TraceWriter/ReplayService` 已有对应实现，场景仍要求旧 `planner.form_frame/form_micro_plan`（`au07-tooltrace-registry-redacted-io.yml:67`）。这些证据支持“验收重锚+状态修正”，不支持重新实现产品。

### 4.4 AU / B 轨任务

覆盖：根目录 AU 67 + B/BEHAVIOR 23，合计 **90/90**。最新完成状态必须保留，B28/B29/B30/B31/B33–B37/P1 不因旧顶部备注或中间态重开。

| 对账 ID | 分类与剩余后果 | 承接与依赖 |
|---|---|---|
| D01 B39 与预注册 | 未实现继续：ADR-0030 仍 Proposed；CP1 已有只读预研。当前预注册漏 AU-15 A0，A1 时间例与首选人物承诺/关系锚点不一致 | 沿 **B39**：先主审并校准预注册，Accepted 后从既有 CP1a/b/c 切口实施；不重做 CP0/readiness，不另立架构 |
| D02 B27 known-gap | 未实现继续：CP4 measured FAIL、CP5 todo；B31 done 不自动关闭 M01/M02/M08/M16/M18 | 沿 **B27 CP5/定向硬化**：定向案例、争议复核和第二方人工记录；不全量 retest 换分，未改判前保持 known-gap |
| D03 AU09 创作方向长期召回 | 未实现继续：跨会话/压缩后仍缺结构化消费者；类型与多方向语义待拍板 | 沿 **AU09-work-direction-memory-recall**：先定 CREATIVE_DIRECTION vs CONSTRAINT，再做采纳写入、recall/why、废弃和真实场景；不改成 run Observation 或仅加固定携带 |
| D04 B29 no-op 与同名歧义 | 要修改/补验（先裁决）：主业务 done；实模 T2 出现 old==new no-op 候选，且“跨轮已唯一消歧”与“同名必澄清”冲突 | **待作者裁决后考虑新后续任务**：区分 no-op 守卫与上下文感知歧义，不能一律追问，也不能接受无意义候选；B29 done 不重开，T2 不冒充 PASS |
| D05 高风险 confirmation 语义 | 要修改/补验（先裁决）：旧高风险 rewrite→needs_confirmation producer 已变化，AU04/AU10 旧证据不能直接代表当前产品 | **先裁决恢复高风险工具确认，还是以 AgentRun awaiting/ask_author 为新契约**；再在原 AU04/AU10 场景重锚，不新建重复任务，不用 adoption seed 掩盖语义变化 |
| D06 durable clarification / BehaviorBinding ledger | 要修改/部分可能退役：B26 ask_author 与旧 durable clarification 不是同载体，独立 ledger 也可能与 TurnResult/receipt/DecisionTrace 重复 | **先裁决统一还是 supersede**；若保留则复用 B26/B31/BEHAVIOR 绑定并证明真实 producer，ledger 由 AU07 真实查询消费者拉动，不先建表 |
| D07 AU11 旧 envelope 路线 | 退役旧实现+修改场景：旧 envelope 无 producer，底层质量诊断/缺上下文目标已由 B27 承接 | 旧 `AU11-guidance-mode-schema-freeze`、`AU11-prose-writing-envelope-projection` 不排队；两场景归 **B40** 重锚，原任务只更新承接，不复活旧对象 |
| D08 AU11 口吻与真实语义 | 要修改：旧 Planner.form_frame 已不存在，但机械诊断腔和 truthfulness 问题仍真实 | 改写原 backlog：以 **B27 AuthoringSemantics + B34 真实语料**做 baseline/treatment；不新建 persona 旁路，不逐条恢复旧 Planner driver |
| D09 持久 adoption inbox + pending view | 未实现继续：transcript/runtime pending 不等于跨会话 workbox；AU05/AU09 若分开建会重复 | **新建一个统一任务**：上游持久 inbox + 下游 pending view 同一契约；依赖 pending/receipt 与 B31 恢复，真实重开/新会话可处理、accept/discard 后消失、作品隔离 |
| D10 canon/revision 自动冲突与 freshness | 将实现：当前安全门依赖候选预声明冲突，不能证明系统从持久事实发现冲突/过期 | **先 contract 后新后续任务**：复用 B28/B29/B36 base version/fingerprint/stale，逐对象接持久基线，不造泛化 canon store；自动识别→fail_with_recovery/覆盖确认、stale 零写入 |
| D11 AU07 replay/developer/multi-type | 未实现继续：基础 scoped/partial/no-provider/State/Behavior 已完成，但 developer 权限、ToolTrace、multi-type、reason catalog、MemoryTrace 聚合仍开放 | 沿 **AU07 file-level follow-up** 一条工作线，先冻 developer 权限/字段与消费者；独立 ToolTrace/MemoryTrace 实体只在确有查询需求时做，确认终态 replay 也归此 |
| D12 AU03/AU11 空上下文与失败矩阵 | 补验：empty/no-facts、work-only、fetcher failure 尚未系统证明不编造与恢复 | 沿 **AU03/AU11 robustness follow-up**：先按 B27 重锚，B39 Accepted 后再核 Preparation Decision，不新建第二上下文架构 |
| D13 AU08 projection refresh/status/failure | 补验：旧账写无 producer，但 B28/ReadingMode 已有 FRESH/STALE/REBUILDING/FAILED 与 refetch/retry；不需要第二套 projection job | 沿 **AU08 follow-up / AU10 recovery**：只补当前实现的 FAILED/retry/no-write/离线证据；按现契约确认失败时旧内容保留 |
| D14 AU10 FAILED task_state 与 action/card 矩阵 | 补验：成功 task_state 已有，FAILED 真实页面、action_result 全状态与 unknown card fallback 未系统验收 | 沿 **AU10 原 follow-up**：确定性 FAILED export/task driver + action/card 矩阵；保留 Option A，不重开不稳定双击专属验收 |
| D15 AU09 角色演化记忆召回 | 补验+后续分解：能写 evolution memory 不等于后续创作实际召回；广义 CP2 不能无限打包关系/时间线/其他 tab | 沿 **memory-taxonomy CP2 窄范围召回补验**：采纳演化→新会话/后续创作 recall+why→主档案身份 SSOT→superseded 不召回；关系对象/时间线另评，不重做 B29/AU12 |
| D16 AU12 accepted world_setting 物化 | 未实现继续：pending correction 已完成，采纳后 works 字段/后续 prompt 是否同源未闭环；不同类型不能一律覆盖 works | 沿 **AU12 原 CP2/P2 contract**：先定哪些 artifact 物化 works、哪些只留 governed memory/档案，再做采纳事务与同源投影，未采纳不变 |
| D17 I10 文学盲评 | 补验（人工）：canonical-3e 与原生 scoped 是材料，不是文学收益证明 | 沿 **P1/既有对账任务**，等负责人和时机；人工报告与工程证据分开，不自动评分代签 |
| D18 stage 历史数据修复 | 将实现（仅授权后）：ch1/ch17、历史矛盾 memory、重复章/误建蓝图行仍是只读清单，产品修复不自动修数据 | **只有作者单独授权才新建数据修复任务**：备份+sha、逐对象 diff、明确 replace/merge/保留、可回滚；不得按 title 静默合并或删除证据批次 |

**条件触发，不进入当前实现队列**：

- B22 自适应 p99/语义 stall/run 级预算、B11D 多场正文/只替换规划场/逐场评审、B36 多段局部替换、B31 重传版本潜在问题，均先抽验真实消费者或新需求，不重开原任务。
- B38 只有真实产品链复现或作者请求才启动；AU05B revive、UA01-CP6 外部探索、VS-00F durable 对账、Experience dismiss、R2 design_ref、完整新卷流等维持既定触发。
- E28–E30、卷蓝图手编、人工合并编辑器、旧 workspace_id 迁移、长 turn 实时并发读取、AU09 排序分页/locked overwrite/独立 Channel 管理等，先证明真实消费者，不为了“更完整”排队。
- I10 人工盲评、签名公证/跨架构/tag CI、live vendor 等外部条件项只能 blocked/待触发，不用 stub 或本机证据代签。

**仅状态清理，不生成新任务**：B33/B34/B35/B36/B11A 等文件后文已有完成记录但顶部夹带历史中间态；tasks/slices/README 的 DS01 todo、UA01 dynamic budget registered 与原任务 done 冲突；这些只修正导航，不重跑实现。

**主审裁决优先于任务创建**：D04 同名歧义/no-op、D05 高风险 confirmation、D06 durable clarification/ledger 不能由 AI 擅自选架构；D09/D10 是少数确实没有统一承接、可独立立项的能力。

### 4.5 其余任务

覆盖：指定 slices 79/79 + tasks 顶层 1/1，合计 **80/80**。`tasks/slices/README.md` 只用于去重，不以摘要代替原任务。

| 对账 ID | 分类与承接 |
|---|---|
| E01 E2E 聚合假绿 | **B41 优先修复**：aggregate 对必需 blocked 场景失败/blocked，重算 E4；不得接受旧 artifact 冒充当前证据。E4 re-anchor/退役归 B40 |
| E02 Gate 幂等、behavior/slot 与 blocked | **B43**：同 key 异 payload 拒绝、open behavior 统一进门、真实 blocked 页面/replay；B02 同键异 payload 另测 `edited_content` |
| E03 相邻 persistence 矩阵 | **B44**：ChapterSummaryRepo + ReconciliationReportRepo 移除 update_all 绕过，逐行矩阵校验；不扩成所有 persistence 改造 |
| E04 DS03 `agent_run_state` schema | 沿 **DS01/DS03 尾项**：additive schema/codegen/safeParse，覆盖 live/dead/unknown 与恢复，不改状态机 |
| E05 UA prompt T3–T9 | 沿 **UA01-agentic-loop-prompt-hardening**：app 保留完成前缀、D2 finding 结构保真、PlanStep.description N-NARR、`success_criteria` 无消费者则退役，不新造评判机 |
| E06 P1 word-count B/C | 沿 **P1-word-count-audit**：确定性重复段/章、缺章率和 word-count.json；不能用 runner 统计代替 ReadingMode |
| E07 CA01 works 写入与假定 | 沿 **CA01 + VS-00G + Q1c**：先统一 premise/theme/main_goal 的候选、暂定/确认、supersede/revision，再写 repo；不能只加字段白名单 |
| E08 AU09 创作方向 | 沿 **AU09-work-direction-memory-recall**：先写入映射与类型，再 recall/why；B39 可消费证据但不能代替物化 |
| E09 B3 toolbox 遥测 | 沿 **B3 observability**：补 turn_id/run_id 与 LogEmit 关联，不改 verifier 规避；与 B39 证据词表一致 |
| E10 VS-00F StateTrace/R2 | 沿 **VS-00F**：摘要/账本权威变化可 replay；R2 新主线无 design_ref 的 finding 要有真实结构化来源，rail 完成不能掩盖 |
| E11 AU08/P1 projection | 沿 **AU08 follow-up**：B28 已有 FRESH/STALE/REBUILDING/FAILED 与 refetch/retry，只补失败/重试/no-write/离线证据，不新建 projection job |
| E12 P1 里程碑口径 | 不新建 P1-100K 任务：旧 100K 与 canonical 12,894 字分属不同证据，不能把 canonical 当里程碑或 I10；P2 归 **B53**，先 P1 B/C 和作品级阈值 |
| E13 OpenAI 订阅 | 沿 **SU01**：真实 OAuth/专用传输才可实现；若近期不做，应隐藏/退役“订阅”可选项，不能让展示大于能力 |
| E14 VS00D B10/B5 可解释性 | 沿 **B27/VS-00C**：roster/摘要窗/ledger cap 的来源化省略与 trace；47 机械步状态行是结构词，不冒充模型叙事 |
| E15 Q1c native | 沿 **Q1C + native driver**：Q1c-specific world_setting 的原生修订/覆盖/刷新/追问；B28 原生正文证据不能替代，先分辨 harness 漂移与产品回归 |
| E16 live vendor / DeepSeek / 平台 | 沿 **SU01 + SI + UA + Strata**：真实账号/平台后跑双变体、ProviderExecution、nightly、Windows/Linux secret、Strata Bearer；缺凭据 exit 65 不装 PASS |
| E17 SU04 签名/公证/release | 沿 **SU04**：Apple 证书和 release runner 分两步；本机 ad-hoc .app 不等于下载零提示或 tag 多平台通过 |
| E18 D6 purpose 路由 UI | 沿 **D6**：真实 LM Studio 双模型验证 select→保存→重启→writer 实际模型；填表/跨供应商不承诺 |
| E19 D1/D5/D7 模型效果 | 沿下一次经批准的实模/狗粮：D1 空 roster 取名、D5 真退化降批、D7 M10 无 continuation→overwrite 误判，不另起长跑 |
| E20 创作效果观察 | 沿真实复验：CA01/02、伴生不凑数、WR01/02 使命牵引、Codex 观感；机制 PASS 不代签，不新造固定 packet/评分器 |
| E21 I10 文学盲评 | 沿 **I10 原条件项**：作者指定负责人/样本/时机，人工记录与工程/实模结论分开 |
| E22 B27 known-gap | 沿 **B27/B31/硬化周期**：M01r2/M02/M08r2/M16r1/M18r1 scoped 与第二方复核；不得用其他 PASS 抵消或全量 retest |
| E23 VS00I/B22/B24 后置 | 沿 **UA prompt hardening/B22/B24**：凭据或真实长章/存活问题触发；cache/TTFT 未知不等于 0，长章续读/批量预算不擅自放宽 |
| E24 CA02 风格对象与四门 | 风格对象归 **B55**；worldrule/timeline/foreshadowing/serialization 四门归 **B56**，先真实消费者和读模型，不堆固定 packet |
| E25 CA03/CA04 固定 packet 余项 | **退役原实现方式、保留问题**：统一交 B39 CP2/CP3 的通用探索/观察/证据回流，不另做一套求证，不误写“问题不存在” |
| E26 VS-00G 触发 C | 沿 **VS-00G + B39 CP2**：同缺失只提一次可关闭，关闭后不追问、不自动起 run、不写 canon；不另造关键词触发器 |
| E27 Q1CB revive | 继续 deferred：只有作者真实需要才开 AU05b；矩阵可回 TENTATIVE 不等于已有生产入口，不先造 UI |
| E28 VS-00F durable/dismiss | 继续条件触发：超 bounded/跨重启才复用 LongRunTask；Experience Engine 有批准与真实消费者才收编，不提前建引擎/调度 |
| E29 E2E/developer/身份 UI | 沿 **AU07 replay owner + developer UI owner**：多类型 replay/scoped/no-provider/脱敏；system_identity_ref 只显示 version/hash/ref，不显示原文 |
| E30 UA CP6 外部探索 | 沿 **UA01-CP6**：真实研究需求+作者出站授权/来源策略；外部资料带来源和 tentative，内部求证完成不等于互联网研究能力 |
| E31 SU02 P2 | 沿 **SU02/AU10 recovery**：后端不可用/损坏数据/恢复归档/大列表/并发冲突/OS preference 按真实价值拆 CP，不推翻 13/13 核心 |
| E32 ChapterSummary 静态债 | 沿 **DS02/Q1B 既有 deferred**：只在下次修改解析器时顺带抽取映射并复跑，不单独泛泛重构；多处登记不变成独立产品任务 |

**状态冲突需同步而不是生成新任务**：VS-00G 原 doing/CP5e 与 AU14 4/4 和 R8 实现证据冲突；UA bounded 顶部 active/T5 blocked 与末尾通过冲突；slices README 的 DS01/Q1B/UA judgment-driven/CA03 等与原任务不一致；Q1c 的 browser 边界不能被 B28 原生证据覆盖；DeepSeek 单变体证据不能关闭 SI T5/UA ProviderExecution/live 矩阵；OpenAI 订阅的 UI 可选项大于实际 OAuth 能力。以上只修正真源与承接，不重跑全部实现。

**完成/被承接组**：D3/D4/DS01/NEM04/Q1B/Q3B/Q3C/Q3D/R10R11、SI-001–004、SU01 最小 checkpoint、UA01 多数声明范围、WORKBENCH-CURRENT-VOLUME、WR01b/c、CA03/CA04 G1–G3、Q1CB 主矩阵、VS-00G CP5a-d 与 AU14 A1/A2/A3/B1 的现有证据、VS-00F rail 等，不因新原则或旧备注重做。`SU01-strata-local-models` 已 Superseded，`UA01-judgment-structured-call-reliability` 的旧两段式不恢复。

### 4.6 验收、UI 与质量证据

覆盖：**333/333**（acceptance 24、design quality 3、engineering 9、UI 29 条目、quality 运行 258、coding-standards 9、AGENTS 1、必要证据 289 份 summary 与 walkthrough 索引）。214 个场景全部纳入，49 个场景家族；3 个 YAML 损坏文件也已人工覆盖。未读大日志，不把历史 PASS 当本批复跑。

#### A. 证据现状的关键事实

- 场景注册：212；未注册：`b27-natural-author-intent`、`b34-author-intent-corpus-fixtures`。默认 active 200 + 显式 active 7 + blocked 5；nightly 210、pr-smoke 2；release/release-real-llm 均为 0。
- YAML 损坏但已人工覆盖 3 个：`agentic-loop-budget-deviation-replan`、`au13-review-adjudication-roundtrip`、`b27-prompt-lifecycle-consistency`。
- 61 份 summary 是 `surface=browser / driver=headless-chromium`，只有 9 份明确 native system/CGEvent 类 driver；不能用 `tauri_window_launched=true` 或 summary 存在推断 macOS 原生交互。
- AU-15 场景文件为 0；B39 未注册、未运行，不能拿历史探索场景或 stub 代替。
- 至少 22 个 verifier 仍引用旧 `planner.form_*`，其中 19 个仍 active；5 个 active 场景无 summary。先动态抽 2–3 个 run，再决定 re-anchor/blocked，不机械批量改状态。

#### B. P0/P1 验收基建与真实证据分层

| 对账 ID | 分类与承接 |
|---|---|
| F01 三个 YAML 与解析器 | **B41 CP0/CP1**：先修 3 个文件，再以受控 YAML 解析替代正则，增加非法 YAML、重复 ID、未注册和缺键硬失败；不能靠历史业务 PASS 消除 manifest 无效 |
| F02 tier 与 blocked 行为 | **B41 CP2**：`ids-by-tier` active-only；blocked=skipped+reason，fail=真实失败，evidence_missing=缺证据，not_run=未执行；blocked 不因跳过而变整批 PASS |
| F03 E2E 假绿 | **B41 CP3**：aggregate 增加 blocked/freshness/来源判断，E4 blocked 不得写已验收；当前/历史/局部/缺失证据分开 |
| F04 verdict 与 evidence schema | **B41 CP4**：schema 增加 status/reason/artifact links/surface/driver/provider/model/attempts/timeouts/git_head/mechanism/model_behavior，并让 runner 真正消费；缺字段不能默认 PASS |
| F05 实模 tier | **B42 CP0/CP1**：`release-real-llm` 建立独立结果层，实模与 deterministic 不混 verdict；自然输入、参数、禁答集、独立重复、保留措辞、失败分母和凭据 blocked 先冻结 |
| F06 求证证据字段 | **B42 CP2**：补 `base_refs`、请求观察、observation refs/outcome/source_revision/coverage、observation_to_provider_call、used/unbound/unknown、preparation_outcome、stale_on_restore、replay_provider_called；集合与请求顺序可判 |
| F07 原生证据发现 | **B42 CP3**：run/final/failure/scoped/termination/native-transport/AX/DB snapshot 统一 run manifest，记录生产指纹、driver 与 scoped 范围；final/failure 并存不得只看 final 写 PASS |
| F08 known-gaps 分类 | **B41 CP5 + B40**：增加 retired/driver_stale/evidence_missing/implementation_missing，避免全用 blocked；先修确定项，其余动态复核，不把“无 summary”直接写成实现缺失 |

#### C. 场景重锚、退役与证据恢复

| 对账 ID | 分类与承接 |
|---|---|
| F09 AU11 两场景 | **B40 CP1 + B27 CP5**：退役旧 envelope 断言，按 AuthoringTask/普通回复来源/覆盖/缺失处理重锚；同步删除 AU03/AU07/蓝图中以 blocked 证据回填 PASS 的写法 |
| F10 ProviderProgress | **B40/验收维护**：退役 `provider_progress_v1` 旧 manifest/driver，保留 unified/error-author-safe 场景；修正 blocked_reason 中不存在的场景引用名 |
| F11 E4/au07-gate/multi-step | **B40 + B41**：合并退役不可达旧场景，把 why 断言挂当前 gate/agent-step-regate；E2E 聚合重算，不能恢复多步伪生产者 |
| F12 5 个 active 无 summary | 先恢复/重跑证据并记 evidence_missing，不先开产品实现；区分后续失败覆盖/清理与实现退化，取得当前外部 UI summary 再恢复结论 |
| F13 19 个 active 旧事件场景 | **B40**：先动态抽 `au07-trace-why-entry`、`p1-chapter-draft-generation`、`e2e-01-readonly-tool-trace`，再逐个 re-anchor；不能只改 known-gaps 文本或把旧 event 名简单替换当成语义等价 |
| F14 legacy au10-micro-plan | **B40/验收维护**：退役 pr-smoke，选当前可运行最小真实路径替换；不恢复 MicroPlan，不把旧 Tauri summary 当 browser PASS |
| F15 重复 bounded roster 场景 | **B40/验收维护**：合并为一个场景+两类断言或 evidence alias，保留 roster Observation→character design 独立断言，避免 nightly 双重运行 |

#### D. 原有消费者与后续工作

| 对账 ID | 分类与承接 |
|---|---|
| F16 AU03 空上下文/失败矩阵 | 沿 **AU03/AU11 robustness**：empty/no-facts、只有 Work 无“刚才讨论”、fetcher 失败作者可见且恢复；旧 AU11 blocked 不能补签，B39 后再核 Preparation Decision |
| F17 AU08 Reading/Projection | 沿 **AU08**：先把 B28 R4 与现有 manifest 对齐，再补 FRESH/FAILED/整组失败/旧内容保留/恢复/no-write；REBUILDING 未覆盖不得称四态全验收，不新建 projection job |
| F18 AU07 replay/developer | 沿 **AU07**：developer 权限/字段差、多类型 replay；B39 CP3 才增加 Observation/version/stale/replay no-provider；先重锚现有 ToolTrace，不混淆旧 prompt 与当前观察 |
| F19 AU13 D1 体量负债 | 沿 **VS-00G/AU13**：单独完成 finding→作者补体量→规划 prompt→后续不再终局章；保留 D2/D3 合并场景，计数改为可复核场景+D1 未闭环，不写“5/5 全完成” |
| F20 AU14 后续触发与对象类型 | 沿 **VS-00G**：A1/A2/A3/B1 已证不否定；触发 C、works 级假定、记忆类富化单列，不能写整个 AU-14 完成；实模盘点质量另评 |
| F21 四个质量门 | **B56**：worldrule/timeline/foreshadowing/serialization 按阶段拆 slice；其余语义 evaluator 的文学收益归 I10，不用脚本分数或 stub finding 代签 |
| F22 作者批准策略 | **B58**：先对账 author_action/adoption/receipt/StateTrace/DecisionTrace 是否满足批准语义，再决定是否需新 approval_record；死亡/结局/高预算等风险矩阵和不可 bypass 验收，不直接建表 |
| F23 SU01 live/OAuth/平台 | 沿 **SU01**：真实账号成功/失败/权限矩阵、OAuth 真流程、Windows/Linux 原生 secret 页面；不可用必须 blocked，不能用 harnessed HTTP 代签 |
| F24 SU02 P2 边缘矩阵 | 沿 **SU02/AU10 recovery**：后端不可用、损坏数据、恢复/归档、大列表/并发冲突按真实价值，不重复切换主链 |
| F25 B27 fixtures/arms/未注册草案 | 沿 **B27 下一硬化周期**：M14/B28/B30 已实现的“缺口”需重冻，不能继续当 capability_gap；arms retired 元数据与 integrated/pending 口径由主审确认，不手改 hash；不立即全量 retest |
| F26 b27-natural/b34 未注册草案 | **文档治理**：b27-natural 只保留独特页面表达增量，否则退役；b34 是 deterministic fixture，留 fixture/test 索引，不注册 nightly |
| F27 UI clarification 边界 | 归 **B39 CP2**：最小 Base→通用求证→仍不可决才 clarification；非要素表单场景保留原边界，不能把缺专用 packet 等同缺作者输入 |
| F28 UI freeze/traceability | 归 **本全量对账任务**：`.pen` 仍是初版原型，freeze-review 不是最终冻结；同步 ADR/status/导出清单和后续 AgentRun/质量场景，不用 PNG 代替运行时验收 |
| F29 AGENTS I1 与 Mock 口径 | 小范围文档同步：I1 补“Provider 响应或合法作者消息字节”；Mock 注明仅作局部测试，不能代签真实模型语义/自主求证，不改变求证主原则 |

**验收基建优先于新增场景**：先让非法 manifest、blocked、缺证据和假绿无法被写成 PASS，再做场景重锚和实模分层。B39 的实现/验收仍以 ADR-0030 评审为前置，不因基础设施完成而提前写成已落地。

### 4.7 覆盖汇总

| 分组 | 覆盖 |
|---|---:|
| 主链、领域、技术设计 | 70/70 |
| 契约、ADR、schema | 93/93 |
| v3 slices + 整合台账 | 20/20 + 1/1 |
| AU / B 轨任务 | 90/90 |
| 其余任务 | 80/80 |
| 验收、UI、质量与必要证据 | 333/333 |

各组均报告未覆盖 0；交叉索引、场景和证据条目存在重叠，以上数字不用于计算独立功能数或任务数。主审已抽验高影响项，包括 E2E 假绿、Gate 幂等、两个相邻 repo 的 `update_all`、ReadingMode 当前四态、AU11/AU07 旧断言和 B39 预注册不一致。

## 5. 跨组去重与依赖

### 5.1 统一承接，避免重复任务

- **求证唯一实现主线是 B39**：v3 VS-00C、CA03/CA04 固定 packet 余项、VS-00G 记忆类注入、时间线和未来读模型都不得另起第二套求证架构。CA03/CA04 的旧固定注入方案退役的是实现方式，不是问题本身。
- **验收重锚统一由 B40**：AU11、AU07、B13B D7/D11、E4/au07-gate、ProviderProgress、重复 roster、legacy au10 等共享同一“当前生产链重锚或退役”工作，不重复修产品。B41/B42 提供 verdict 和实模证据地基。
- **B27 保持全调用点语义主线**：G1–G7、guidance/schema、AU11 口吻、M01/M02/M08/M16/M18 和第二方复核都在原任务，不以 B31/B28/B29/B30 的完成代签，也不做第七次全量 retest。
- **VS-00F/VS-00G 各保原任务**：账本 StateTrace、R2、其余 schema、durable/dismiss、触发 C、works 假定与记忆富化不重复建项目；只淘汰旧固定 packet 方案并转 B39。
- **AU07 统一深层 replay**：developer/multi-type/ToolTrace/MemoryTrace/reason catalog/confirm terminal 都沿同一工作线，B39 CP3 只增加 Observation 特化，不复制 ReplayService。
- **AU08/AU10 统一 projection 与 recovery**：B28/ReadingMode 已有四态与 refetch/retry，不新建 projection job；只补失败、重试、no-write、离线和 R4 范围外证据。
- **B 轨新能力只补真正空缺**：持久 inbox 统一 AU05/AU09，canon freshness 复用 B28/B29/B36，Gate residual 复用 GATE-ORDER，摘要/审读 persistence 复用 Q1CB 的矩阵。原任务 done 不重开。

### 5.2 依赖顺序

1. **B41 质量证据地基**：先阻止非法 YAML、blocked 混入、缺证据和 E2E 假绿被写成 PASS。
2. **B42 实模与求证证据分层**：在 B41 的 verdict 上区分机制/模型行为/native/browser，补齐 AU-15 的观察与 used refs 证据。
3. **B40 判断纪元验收重锚**：按当前生产链重跑或退役旧场景，同步 known-gaps 和文档，不再以旧 summary 代当前证据。
4. **B39 求证式创作**：先评审 ADR-0030/VS-00K/AU-15；Accepted 后 CP1，复用 B41/B42 的证据，不先做时间线。
5. **B49 主链语义与 ADR 评审**：可与 B41/B42 并行评审，约束 B43 Gate、B45 schema、B06 五账和其他字段/动作退役，不预先授权实现。
6. **B43/B44/B05/B06 安全与事实边界**：Gate 幂等/behavior/blocked、摘要与审读矩阵、账本 StateTrace 和 schema 按真实消费者推进，可并行于 B39。
7. **B46/B47 作者工作箱与事实新鲜度**：持久 inbox、canon freshness 分别形成统一能力，不与 B39 混合。
8. **既有任务续作**：B27、VS-00F/G、AU07、AU09 work-direction、AU03/AU10 recovery、UA01 prompt/provider、CA04、Q1c、DS03 等按各自余项和触发条件。
9. **B50/B51 技术决策**：先由作者裁决 Multi-Agent、PaperTrail 与技术栈旧锁定，再决定 B52 批量、B53 P2 及是否还有独立子 Agent 消费者。
10. **B54/B55/B56/B57/B58 后续领域与安全**：时间/状态读模型看 B39 CP4；风格对象看真实编辑消费者；四门按阶段拆；注入先补验；批准策略先对账再决定是否需新实体。

### 5.3 必须作者裁决，不能由对账直接选择

| 事项 | 可选方向与当前处理 |
|---|---|
| B29 no-op 与同名歧义 | B48 已登记 blocked：拒绝 no-op、显式幂等回执或仅收紧歧义；不得一律同名追问，也不得把 T2 写成 PASS |
| 高风险工具 confirmation | 恢复为可行动 TurnResult，或以 AgentRun awaiting/ask_author 为当前契约；裁决后才 re-anchor AU04/AU10，不能用 adoption seed 掩盖 |
| durable clarification / BehaviorBinding ledger | 统一 B26 ask_author 与旧行为，或 supersede 旧方案；ledger 须由 AU07 真实查询消费者拉动，不先建表 |
| Multi-Agent day-1 约束 | B50 保留/延期/supersede 由作者决定；不新建 runtime，tech08“全部通过”不得当验收事实 |
| PaperTrail | B51 保留、替换或 supersede 由只读 versions 与现有 revision/trace 证据和 ADR 决定，不直接删表 |
| 主链 Accepted 文本与实现偏差 | B49 先评审保留/收窄/退役，再改 schema/代码；不能把“文档化偏差”当所有问题的答案 |
| I10 文学盲评 | 等作者指定负责人、样本、时机和 rubric；AI 不用自动评分代签 |
| stage 历史数据修复 | 只有作者单独授权才新建数据修复任务；备份、diff、回滚和保留策略先行 |

### 5.4 不进入当前实现队列的条件项

外部探索、adoption revive、durable 定期对账、Experience dismiss、S4 显式 clarification、卷 design_ref、E28–E30、卷编辑/重排、B11D 多场正文、B36 多段替换、LongRunner 批量（B52）、P2 500K（B53）、时间/状态读模型（B54）、风格对象（B55）、四门（B56）、live vendor/OAuth、签名公证/跨平台、I10 人工盲评、stage 数据修复，均按既定触发条件执行，不因全量对账批量复活。

## 6. 最终任务登记清单

### 6.1 新登记任务文件（已创建）

| 任务 | 状态 | 主要承接与依赖 |
|---|---|---|
| [B40](slices/B40-judgment-era-acceptance-reanchor.md) | todo | 判断纪元验收重锚；依赖 B27 CP3 与 B41 verdict，不依赖 ADR-0030 |
| [B41](slices/B41-quality-evidence-foundation.md) | todo，队首候选 | 先修 YAML/parser、blocked 分层、E2E 假绿和 verdict 契约，再支撑 B40/B42/B39 |
| [B42](slices/B42-model-behavior-evidence-tier.md) | todo | 依赖 B41；实模/机制/native/browser 分层、求证证据字段与原生 run 索引 |
| [B43](slices/B43-gate-order-residual.md) | todo | Gate 幂等、behavior/slot、真实 blocked 页面；与 B49 语义裁决联动 |
| [B44](slices/B44-persistence-transition-boundary.md) | todo | 两个相邻 repo 的矩阵强制；ADR-0019，合法 supersede 不回归 |
| [B45](slices/B45-schema-legacy-governance.md) | todo | legacy/现役/真实消费者治理；依赖 B49 与五账 schema 决策，不增加业务字段 |
| [B46](slices/B46-persistent-adoption-inbox.md) | todo | AU05/AU09 统一持久 inbox 与待处理视图，依赖现有 pending/receipt 和 B31 恢复语义 |
| [B47](slices/B47-canon-freshness-and-conflict-detection.md) | todo | 持久冲突/stale 自动发现与重新 gate；复用 B28/B29/B36 的版本/fingerprint，不建泛化 canon store |
| [B48](slices/B48-character-revision-noop-and-ambiguity.md) | blocked，待作者裁决 | B29 no-op 与上下文感知同名歧义；裁决前不改代码、T2 不算 PASS |
| [B49](slices/B49-core-semantics-and-adr-review.md) | todo，评审先行 | 主链语义收窄与 ADR-0022 现行评审；约束 B43/B45/B06 等后续，不直接改生产 |
| [B50](slices/B50-multi-agent-current-boundary.md) | blocked，待作者裁决 | Multi-Agent 保留/延期/supersede；不新建 runtime，不重复 UA01/B39 |
| [B51](slices/B51-tech-stack-current-rebase.md) | todo | 依赖与 canonical 引用重定、PaperTrail 生产真相；依赖 B50/B49，非倒装依赖 |
| [B52](slices/B52-longrun-batch-draft.md) | deferred，作者重新开放批量需求才启动 | 多单元后台、逐章 tentative、跨重启不重复；B39/UA01 durable 不顶替 |
| [B53](slices/B53-p2-500k-milestone.md) | deferred，P1 B/C 与作者预算后 | ≥500K、每章≥2000、分卷、连续性/恢复/导出；作品级阈值，非脚本堆字 |
| [B54](slices/B54-continuity-time-and-state.md) | deferred，B39 CP4 后评估 | 时间/时点读模型建立、映射或退役；先通用探索，不先建 timeline_event/state_snapshot |
| [B55](slices/B55-style-objects-and-consumption.md) | deferred，真实风格编辑/版本消费者触发 | style_sample/preferences/brief/feedback_patch 的真实消费；作者当前 brief 仍属 Base，不堆固定 packet |
| [B56](slices/B56-quality-maintenance-gates.md) | deferred，按阶段拆 slice | worldrule/timeline/foreshadowing/serialization 四门的读模型与运行钩子；B54 时间项依赖其后，I10 独立 |
| [B57](slices/B57-sec-injection-boundary.md) | todo，先补验 | 作者输入/观察/外部资料注入对抗；失败才做最小防线，不预建空 Guard |
| [B58](slices/B58-human-approval-policy-unification.md) | todo | 先对账现有 receipt/trace 再决定是否需新实体；高风险批准与不可 bypass 审计，不直接建表 |

### 6.2 继续原任务，不新建重复任务

- **B27**：CP5/known-gap、G1–G7、guidance/schema、AU11 口吻与第二方复核。
- **B39**：CP1–CP4 求证、ADR-0030 评审与预注册校准，不新建第二求证架构。
- **VS-00F**：StateTrace、R2、其余五账 schema、durable/dismiss 与长期效果。
- **VS-00G**：CP5e 证据复核、触发 C、works 级假定、记忆类富化；CP5a-d 不重复。
- **AU07**：developer/multi-type/replay、ToolTrace/MemoryTrace/reason catalog/confirm terminal。
- **AU09**：work-direction、evolution recall、accepted world_setting 后续物化；AU12 correction 的 works 同源。
- **AU03/AU04-AU06/AU10**：空上下文/confirmation/behavior/recovery/FAILED/task_state/action 矩阵与 clarification 裁决。
- **UA01**：prompt T3–T9、provider stream、developer 身份、VS00I/vendor cache、CP6 外部探索与 durable 条件项。
- **CA01/CA02/CA03/CA04**：works 写入、创作效果、G4/G5 只淘汰固定 packet 方案后转 B39；CA04 卷蓝图增量回归。
- **Q1C/Q1CB**：Q1c-specific native 与旧 AU 回归；revive 仍 deferred；相邻 repo 已由 B44 独立承接。
- **DS01/DS03**：`agent_run_state` schema/codegen 与 S7 非预算 awaiting surface。
- **SU01/SU02/SU04/SI**：live vendor/OAuth、跨平台、签名公证、DeepSeek/SI T5/T6、Strata 可选 Key 与真实平台条件。
- **P1-word-count/P1 dogfood/I10**：重复段/章与缺章率、runner 余项、实模效果、人工盲评；不重跑 100K 换分。

### 6.3 纯文档状态修正，不占产品队列

- v3 DAG 缺边/失效 blocker/历史 batch 漂移、v3 README 与 absorption 尾部的 Q1CB 已闭环事实。
- tasks/slices/README 的前缀、DS01/UA dynamic budget/Q1B/CA03 等旧摘要；contracts README 的 VS-00F 状态、ADR-0029 的 B28 旧 gap。
- VS-00D、AU11、AU07、E2E/acceptance README 中“blocked 证据仍回填 PASS”和“known-gaps 为空”的错误口径。
- tech-stack/glossary/UI 的错 ADR、死链、退役卡仍作推荐、S4/S7 与当前裁决不一致；多 Agent 交 B50，不倒装依赖。
- B33/B34/B35/B36/B11A/UA bounded 等顶部历史中间态只保留为历史，不据此重开实现。
- AGENTS I1 补作者原文字节与 coding standards 的 Mock 边界，不改变求证主原则。

以上修正由本全量对账任务及 B40/B41/B49/B50/B51 按归属承接，不另造“文档修复”产品任务。

## 7. 验证与恢复

完成后至少执行：

```bash
node scripts/next_task_check.mjs
mix run scripts/adr_trace.exs
bash scripts/gap_ledger.sh
git diff --check
```

另需检查：新增任务文件及所有链接可达、原任务状态与 NEXT 一致、开放 ID 没有意外减少。此次为文档/任务对账，不以这些检查代替产品功能或真实模型验收。

本次实际结果（2026-10-27）：

- `node scripts/next_task_check.mjs`：ok；当前为 B41，候选为 B42/B40/B39/B49/B38。
- `mix run scripts/adr_trace.exs`：28/28 Accepted ADR enforced_by 通过；ADR-0022/0030 按 Proposed 跳过。
- `bash scripts/gap_ledger.sh`：维持 20 项开放差距，无意外销账。
- 新任务及总账本地链接检查：20 份全部通过。
- `git diff --check`：通过。
- 未运行后端/前端功能测试、真实模型或 Tauri；本任务只完成审计、任务登记和文档治理，不表示产品能力或真实模型行为已通过。

恢复时先读本文件、NEXT 和各原任务；不得只按索引摘要或历史完成记录继续。若审计期间并行任务完成，按最新原任务更新处置，不回滚他人证据。

## 8. 2026-10-28 排期与决策材料复核

- 状态：**done（任务体系与决策材料更新、检查器与验证完成；不授权下游产品实施）**。
- 来源：作者要求「1 帮我完善 next task 体系 2 决策补充更新」。本轮授权排期、规则/检查器完善和决策材料纠错；不是作者逐项接受 ADR-0030/0031 或 D1–D7/R1–R7。
- 复核范围：NEXT、tasks 规则、B39/B40/B42–B51/B57/B58/B60/B63 的原任务与高影响代码事实；开放来源另由 `next_task_check --open` 即时列出。没有逐一裁决全部历史任务，不能声称全仓无可推进项。

### 8.1 排期理由与承接

1. **先补证据判定**：B42 §12 已复现 partial+缺观察元数据仍 pass 的局部反例，回补属于 CP1/CP2 原反假绿目标；不受 CP4 的 ADR/模型窗口阻塞。
2. **独立安全边界与验收恢复**：B44 可先审计仓储转换；B40 §10.2 接回原同族清单，过去批次 done 不代表完整任务 done。
3. **条件候选保留依赖**：B39 等 ADR-0030/D1–D7；B43 等 B49。候选顺序不是必须等待前项解锁的串行依赖，可先选择已满足前置的项；B47 先做对象级 CP0。
4. **尚未进入近期五项的工作仍有原入口**：[B46 持久 Inbox](slices/B46-persistent-adoption-inbox.md) 先核事实源与跨会话恢复；[B57 注入边界](slices/B57-sec-injection-boundary.md) 可先做既有作者输入/作品观察的对抗矩阵，新增求证/外部资料部分等对应入口；[B58 批准策略](slices/B58-human-approval-policy-unification.md) 先对账 receipt/trace；[B51](slices/B51-tech-stack-current-rebase.md) 先做只读依赖与 PaperTrail 证据。这里登记承接理由，不复制执行状态，不建立第二队列。
5. **条件项与待裁决不销账**：B38 从近期候选转条件引用；B29 T2 统一指 B48；B50 与 B51 的裁决入口补入 NEXT；I10、stage 修复、B27 已裁决 known-gap 与既有外部条件仍由原任务承接。原生覆盖与 release 空 registry 的事实留 B40/B42/B61/B62，不在 NEXT 堆历史数字。

### 8.2 决策材料更新边界

- B39 校准 D1–D7，区分逐请求 Base/Observation、累计预算、CP1 局部报告、正式 AU-15 前置与未执行 replay；建议不写成 Accepted。
- B49 推荐加上 typed contract、历史兼容、真实 lineage 和 enforcement_gaps 的限制；R1–R7 仍待作者。
- B63 R2 纠正 task=nil 的完整失败链与 C 选项，推荐不回退 turn_id；B48 区分普通无变化说明与结构化业务回执，避免把 no-op 与重复请求幂等混为一谈。
- B50 补延期推荐和重新开放条件；B51 保留“先取证、后裁决”，不凭本轮文档更新选定 PaperTrail 去留。

### 8.3 体系验证与未闭环

本轮人工改动仅在 `tasks/` 和排期检查脚本/索引；`reports/gap-ledger/latest.json` 由原脚本刷新，不改产品、ADR 状态、release 判定代码或已有验收判据。新增 `--open` 清单从原文派生、不落盘；检查器阻止 blocked/deferred 占队首、多个状态来源、空队首但有可推进候选，以及借用子标题状态。

验证记录（2026-10-28）：

- `mix compile` 通过；`node --test scripts/next_task_check.test.mjs` **25/25**；`node scripts/next_task_check.mjs` 与 `--open` 通过。清单仍显式列出未识别顶部状态的历史文档，不把它们默认为 done，也不在本轮机械改名。
- 修改文档的本地链接核对 **137/137**；`mix run --no-start scripts/adr_trace.exs` **28/28 Accepted、296 refs**；ADR-0022/0030/0031 仍按 Proposed 跳过。
- `bash -n scripts/gap_ledger.sh`、`bash scripts/gap_ledger.sh` 通过；开放 ID 前后相同、均 **20 项**，只刷新日期/连续计数；`git diff --check` 通过。
- `bash scripts/ai_static_scan.sh --top 10` 首跑发现旧 completion manifest 过期；用 `bash scripts/task_done.sh --top 10` 重建并复扫，**19/20 checks passed，blocking=0**。I1/I2/I3、N-NARR、I-CACHE、前端 typecheck/lint/test 与架构检查通过；本次无 UI 改动，manifest 如实记录 UI evidence not_required。
- 剩余 Top 10 实际为 **4 条历史 gitleaks 命中**：B63 历史文档行、E10 spec 标识符、Pencil 元数据为既有 `false_positive`；历史 `tools/company-console/server/config.mjs` 为既有 `accepted_risk`。本次未修改处置台账、未忽略扫描、未重写历史。原始 gitleaks check 仍失败，不能写“全扫描零发现”；结果及处置见 `artifacts/static-scan/top10.md`、`disposition.md`、`report.json`。

B42 §12 仅登记缺陷并排期，尚未修复；B39/B42 CP4、B49/B48/B50 等仍待各自裁决。本文档更新不能用作产品/真实页面/真实模型验收证据。

## 9. 2026-10-29 队列收口复核（Lead）

- 状态：**done（本轮排期复核；不授权未选入 backlog 的实施）**。
- 本轮执行：B42 §12 证据完整性回补 → B44 持久化转换边界（CP0–CP3）→ B40 §10.2 同族场景重锚（18 场景，17 PASS + 1 retired）→ B47 canon freshness（CP0–CP3）。逐项状态与证据见各原任务；NEXT 只留排期结论。
- 收口前开放来源复核：`node scripts/next_task_check.mjs --open` 所列 `todo/doing` 与未识别历史文档已按本文件 §8.1 与各原任务核对；**未识别历史文档不是待办证据**，其执行状态仍以原文档头部/正文为准，不因本轮收口自动改状态。
- **NEXT 空置理由（范围限定）**：本轮入选的 4 个任务均达到各自 slice 的 CP 标准（B42 §12 / B44 / B40 §10.2 / B47 CP3）；剩余开放项均不满足“已授权且本轮可开工”：
  1. 作者裁决类：ADR-0030/VS-00K/AU-15（B39、B42 CP4）、B49 R1–R7、B63 R2、B48、B50（见 NEXT 阻塞节）。
  2. 人工/数据授权：I10 盲评、stage 存量修复（B28）。
  3. 产品裁决：`au02-candidate-fallback-ui` 无可达生产者；B47 §10 memory/设定对象纳入自动冲突需先补对象 contract。
  4. 未选入本轮的 backlog（不销账、不在 NEXT 累积日志）：B45（schema/legacy 治理，依赖 B49 五账决策）、B46（持久 adoption inbox，需产品 slice 设计+真实页面验收）、B51（技术栈/PaperTrail 先取证后裁决）、B57（注入边界，可先做既有作者输入/观察对抗矩阵）、B58（批准策略，先对账 receipt/trace）、B39/B43（条件候选）。承接入口仍是各自原任务与 §8.1；下一周期由作者排期或按触发条件启动。
- 本轮新增已知残余（不冒充闭环）：① 页面证据均为 `surface=browser/driver=headless-chromium`，native AX 覆盖缺口仍按 B61/B62 已交付范围；② 页面 verdict 的 `git_head` 固定在运行时机，后续提交会使既有页面证据在新 freshness 检查中判 stale，按需 scoped 复跑，不自动续期；③ B47 CP3 只覆盖 O1 章正文（stale/conflict/fresh），O2 角色 fingerprint 页面矩阵未纳入；④ B44 CP3 单活跃报告替换链无现成页面场景（repo 测试覆盖）；⑤ B42 CP4/AU-15 真实模型仍 blocked-by-author。
- 本轮未运行：真实模型、native 系统驱动、长跑批处理；未修改 ADR decision 文本（仅 B44 作者确认的 ADR-0019 适用范围补充）、未修历史 stage 数据、未重写历史证据。
