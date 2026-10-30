# 2026-10-27 全量设计到执行任务对账

- 状态：**done（2026-10-27，全量盘点、任务拆解与登记完成；未进入产品实现）**。
- 类型：跨周期设计/任务对账，不是产品 slice，不授权代码实现。
- 来源：作者要求不能只同步元原则与台账，必须分析全部设计及 `tasks/slices`（含 v3），把未实现、要修改、将要实现的内容拆成有依赖和验收的任务。
- 既有边界：`docs/design/` 为唯一设计真源；v3 是当前主导设计血缘，`tasks/slices/v3/` 是历史命名的当前承重工作区；B39 / VS-00K / ADR-0030 / AU-15 已有工作保留，不重复发明求证架构。

> 2026-10-30 口径补充：历史分组的覆盖数字表示当时的盘点范围，不能当作所有设计条款已有任务或实现完成的证明。当前逐文件归属、部分承接与缺项以 §14 为准。

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
2. `tasks/NEXT.md` 只保留一个当前任务、已核实有明确下一步的候选和阻塞/延期引用；候选按优先级与依赖列全，不设数量上限（2026-10-30 作者确认，见 §12），不写成混合历史与未核事项的完整 backlog。
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

#### B01 入口来源与语义边界

- 状态：**todo（原 B01 条目的执行细化；2026-10-30 ADR-0031 已接受，设计前置解除，实施未开工）**。
- 范围：保留原 B01 的完整 judgment→frame→plan 语义边界与 B26/B27 后继校验；新增明确承接 [B49 R7](slices/B49-core-semantics-and-adr-review.md#715-c02-r7-裁决记录) 的真实入口引用。R7 修复只是原 B01 的一个 checkpoint，不代替其它语义/权限/registry/ref 校验。
- 下一步：核对入口产生时间、实际 turn/frame 对象、现有 parent_turn_ref/author_input 关联及所有读取方，选择真实 frame ref 或显式 turn ref；不为字段名造空对象、不建第二 Router。
- Checkpoint：CP0 明确来源契约、七问与原语义校验剩余矩阵 → CP1 真实来源贯穿生成/存储/trace/回放并保留历史读取 → CP2 原 B01 反例及引用存在性/作品会话隔离/幂等恢复 → CP3 外部真实工作台触发与 Why/持久回放验证。各项未开工。
- 边界与消费者：domain 纯绑定规则，application 入口/PlannerBoundary，必要 persistence 引用读取与兼容；web/frontend 消费已有 trace/Why。消费者是统一裁决、逐步执行与作者追溯，不新增数据事实或无用途层。
- 不变量与证明：来源类型与真实对象一致、不得跨作品/会话；Planner 不自批执行；回放不重调模型、不伪补历史。局部测试不能代签 UI，原 B01 全范围未覆盖时不标 done。
- 状态只维护在本小节；上表保留设计差距与承接说明。具体驱动与字段迁移由 CP0 冻结，未触发存量数据修复授权。

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
| D01 B39 与预注册 | 未实现继续：ADR-0030 已于 2026-10-29 Accepted（本条其余缺口仍有效，历史记录不重写）；CP1 已有只读预研。当前预注册漏 AU-15 A0，A1 时间例与首选人物承诺/关系锚点不一致 | 沿 **B39**：先主审并校准预注册，Accepted 后从既有 CP1a/b/c 切口实施；不重做 CP0/readiness，不另立架构 |
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

## 10. 当前阻塞裁决包（2026-10-29）

本节是跨任务的评审材料与讨论顺序，**不是第二份执行状态表**。选项依据 HEAD `e1685675` 的任务、ADR 和必要代码只读核对；下文保留提出时的方案与推荐，不代表所有事项仍未裁决。每次裁决的结论、日期、理由与实施后果只写回链接的原任务；C01 的裁决及后续讨论见 [B39 路线裁决记录](slices/B39-evidence-seeking-authoring.md#972-c01-路线裁决记录)，其余状态同样回原任务读取。

**逐项处理规则**：先 C01，再其 D1–D7，随后 C02 的 R1–R7，再 C03–C08；作者可以指定跳项。只回复“同意/按推荐”时，仅针对当时明确展示的一项，不扩为整包批准。接受路线、接受 ADR、实施排期、真实模型资源窗口、数据写入授权分别处理；本轮整理不执行产品改动、真实模型或数据修复。

### 10.1 议程与原任务

| 编号 | 要决定什么 | 推荐摘要 | 主要影响 / 原任务 |
|---|---|---|---|
| C01 | 求证式创作是否进入实施准备，以及 CP1 的边界 | 统一 AgentRun 求证；先正文，再准备/恢复/迁移 | [B39](slices/B39-evidence-seeking-authoring.md)、[B42 CP4](slices/B42-model-behavior-evidence-tier.md#10-cp4blocked-登记不执行不代签) |
| C02 | 主链现行语义与旧 ADR 如何收敛 | 新 ADR 承接，逐项收窄，保留历史兼容 | [B49 §7](slices/B49-core-semantics-and-adr-review.md#7-交付物五作者裁决包一页式)；解锁 B01/B43/B45 对应范围 |
| C03 | 质量评估缺正文引用时是否回退轮次 ID | 不回退，保留语义评估 unavailable | [B63 R2](slices/B63-known-gaps-remediation.md#62-r2-质量物料引用裁决) |
| C04 | 角色无需修改时如何反馈、同名何时追问 | 普通无变化说明；真正歧义才问 | [B48](slices/B48-character-revision-noop-and-ambiguity.md)；承接 B29 T2 |
| C05 | 独立多 Agent / 24x7 是否仍是 day-1 必须 | 延期，保留真实消费者触发条件 | [B50](slices/B50-multi-agent-current-boundary.md)、B51 技术文档 |
| C06 | 坏/空创作方向候选是否要由 APP 自动补出 | 退役旧补候选目标，保留失败恢复保障 | [B40 候选策略](slices/B40-judgment-era-acceptance-reanchor.md#13-候选失败策略裁决材料) |
| C07 | 角色持久层是否与入口一样严格拒绝过期候选 | 统一严格指纹校验，保留真实重复请求幂等 | [B47 §10.1](slices/B47-canon-freshness-and-conflict-detection.md#101-角色持久层过期策略裁决材料)；这是新补入的裁决入口 |
| C08 | I10 文学盲评何时启动、由谁评 | 先冻结已有样本的人工基线方案，再安排评审 | [既有对账：I10 安排](slices/VS00D-G-GAP-RECONCILIATION.md#i10-人工盲评安排) |

**已从本次裁决中排除**：B42 §12 证据完整性缺口已有 2026-10-29 修复记录；不得再把“允许 partial 缺证据也 PASS”作为普通产品选项。B27 known-gap 已有裁决，B38 仍为条件触发；本次不重新要求作者选择已决定事项。B46/B57/B58 等未排期工作不自动变成作者阻塞。

### 10.2 C01：求证式创作路线与实施边界

**事实**：2026-10-27 的“最小供给、按需求证、证据闭环”元原则已拍板；本次不重选元原则。待确认的是 [ADR-0030 提案](../docs/design/adr/ADR-0030-evidence-seeking-authoring-v3.md) 的具体路线和实施边界。正文 run 的求证尚未完成；B42 基建修复不代表 AU-15 已通过。

| 选项 | 具体含义 | 影响 |
|---|---|---|
| **C01-A（推荐）** | 同意 ADR-0030 方案 C：系统提供意图/章节坐标/权限预算等必要底座；模型通过现有 AgentRun 按需读取作品事实，观察进入使命与写作，并留下可核对的引用 | 进入契约收口与 D1–D7 选择；随后按 CP1 正文探索 → CP2 准备判断/引用绑定 → CP3 规划修订/恢复 → CP4 携带迁移推进。增加读调用和证据处理工作，换取可扩展的事实获取能力；不一次清空现有材料 |
| C01-B | 保留元原则和提案，暂缓该实施线 | 可以先做其他已授权任务；正文求证与 AU-15 继续未闭环，须明确重新开放条件 |
| C01-C | 指定不接受的路线边界，要求修改提案后再审 | AI 只重写相关契约与影响分析；不依据现提案编码，时间和成本须随修改重新估计 |

**推荐理由**：现有判断循环、计划、观察和预算可以复用；无需新建第二运行时，也不把所有作品知识改成固定 prompt 携带。路线成立不保证真实模型一定主动查询，仍由 AU-15 实模证据判断。

**C01-A 不批量接受下面 D1–D7**。本项只确认路线，具体未决边界逐项处理，完成记录与 ADR 接受手续后才解除相应实施前置；原生实模窗口与数据操作不在此默认授权。

| 子项 | 可选方案 | 推荐与影响 |
|---|---|---|
| D1：模型实际收到的材料如何可查 | 原存放位置比较已收敛为同源、逐调用的产品约束 | 原任务维护 [D1 裁决与实施边界](slices/B39-evidence-seeking-authoring.md#974-d1-产品约束裁决记录)；具体 Context/trace/快照结构由工程评估，不预建第二事实源 |
| D2：探索预算如何控制 | A 耗尽后保留进度并由作者追加/停止；B 契约允许时输出受限结果；C 终止后重新发起 | 原任务维护 [D2 裁决与实施后果](slices/B39-evidence-seeking-authoring.md#976-d2-裁决记录)。旧 a/b/c 预算组织方式留作工程比较，次数不由本裁决凭空冻结 |
| D3：关键事实未核清时是否继续写作 | A 默认先求证/询问再给符合目标的正文候选；B 允许范围内先给明确假设的候选 | 原任务维护 [D3 裁决及实施边界](slices/B39-evidence-seeking-authoring.md#978-d3-裁决记录)。查过资料不等于准备就绪，局部接线不代签完整用户场景 |
| D4：局部进度与正式验收口径 | 原 c+a 合为分层报告：局部完成如实报告，正式场景必需证据齐全才 PASS | 原任务维护 [D4 裁决与实施后果](slices/B39-evidence-seeking-authoring.md#9710-d4-裁决记录)；不以 CP/单场景/浏览器/机制结果代签完整 slice、原生交互、真实模型或文学收益 |
| D5：只读探索的授权与执行边界 | 授权内自主只读；执行前守卫、取消/预算、观察与写入分离、真实留痕；内联/独立 gate 由工程评估 | 原任务维护 [D5 裁决与实施边界](slices/B39-evidence-seeking-authoring.md#9712-d5-裁决记录)。复用优先但不能豁免边界校验，不让作者以对象名选择架构 |
| D6：正式验收的前置作品怎么来 | A 真实模型创作并经 UI 采纳（原 ii）；B 正式使用预置资料（原 i，须修订前置要求） | 原任务维护 [D6 裁决与证据边界](slices/B39-evidence-seeking-authoring.md#9714-d6-裁决记录)；正式与机制证据分别报告，样本准备和测量分账 |
| D7：观察如何进入 writer | 内容/来源/版本/覆盖同批进入实际请求，并明确引用边界（原 i+ii） | 原任务维护 [D7 裁决与实施后果](slices/B39-evidence-seeking-authoring.md#9716-d7-裁决记录)。复用同一材料源和共享规则，不把后台留痕当模型已知来源 |

C01/D1–D7 的结果与正式接受范围统一见 [B39 实施基线收口](slices/B39-evidence-seeking-authoring.md#9717-c01-实施基线收口)；本包不复制三份文件的状态。

### 10.3 C02：主链语义与 ADR 收敛

**评审记录**：以下保留 R1–R7 的选项与影响；实际选择及 2026-10-30 正式接受见 B49 §7.16。ADR-0031 已 Accepted，ADR-0022 已 Superseded；执行状态仍在原任务，不由本表复制。

| 子项 | 选项 | 推荐 | 影响 |
|---|---|---|---|
| R1：回复轮与执行轮 | a 恢复旧 primary frame/plan 唯一性；b 回复轮一个 frame，执行轮逐步 frame/plan/re-gate；c 只留偏差记录 | 结论见 [B49 R1](slices/B49-core-semantics-and-adr-review.md#72-c02-r1-裁决记录) | 总体任务/计划保留，执行逐步检查；不连带批准 R2–R7 |
| R2：普通回复是否另建执行裁决 | A 所有回合统一执行 decision；B 无业务执行时由 frame/trace 解释；C 保持偏差 | 实际选择与实施后果见 [B49 R2](slices/B49-core-semantics-and-adr-review.md#75-c02-r2-裁决记录) | 两方案都保留审计；差异是统一裁决载体还是复用现行分工，不改变权限 |
| R3：统一裁决的类型与生命周期 | A 完整类型族及裁决生命周期；B 真实所需类型（含 reply_only）与运行状态分工 | 实际选择见 [B49 R3](slices/B49-core-semantics-and-adr-review.md#77-c02-r3-裁决记录) | 原“仅 8 类”已失效；统一裁决不等于必须复制执行状态机，实际类型须逐出口映射 |
| R4：ADR-0022 去向 | A 明确修订旧 Proposed 稿后接受；B 新 ADR 承接、旧稿 Superseded；C 保留 Proposed 加关系说明 | 实际选择见 [B49 R4](slices/B49-core-semantics-and-adr-review.md#79-c02-r4-裁决记录) | 保留历史与有效规则；选 B 时旧稿状态变更以新 ADR 正式接受为前提 |
| R5：旧动作与 next_action | A 按旧集合补齐真实产品链；B 退出无现役消费者的旧规范要求并保留兼容 | 实际选择见 [B49 R5](slices/B49-core-semantics-and-adr-review.md#711-c02-r5-裁决记录) | 保留现役按钮/恢复能力；清理需逐字段核消费者与历史读取，不盲删、不永久禁止未来扩展 |
| R6：输出校验方式 | A 各类输出正式 schema 并统一校验；B 按消费边界分层契约与验证 | 实际选择见 [B49 R6](slices/B49-core-semantics-and-adr-review.md#713-c02-r6-裁决记录) | 两者都校验；内部也有使用方，opaque 不免检，同源 schema 跨层复用不等于两份真源 |
| R7：入口来源引用是否补齐 | A 引用与真实来源一致且可解析；B 暂留明确缺口 | 实际选择见 [B49 R7](slices/B49-core-semantics-and-adr-review.md#715-c02-r7-裁决记录) | 优先复用真实 turn/输入关联，不为字段名造 frame；生产/存储/回放与历史兼容一起闭合 |

**接受后**：逐项把选择写回 B49；解决其 Accepted 门槛与 `enforcement_gaps` 登记口径，再更新 ADR 关系，按 B01/B43/B45 执行。B49 §9.3 已按既有 ADR 治理规则对齐：已实现项核实真实引用，未实现项保留 enforcement_gaps 与承接，不形成“先实现才能接受”的循环，也不删除缺口冒充完成。只选某个 R 不等于接受其余 R。

C02 已接受的范围与实施承接见 [B49 §7.16](slices/B49-core-semantics-and-adr-review.md#716-c02-实施基线收口)；本包不复制执行状态。

### 10.4 C03：质量评估缺正文引用

**事实**：当前不回退 turn_id。正文物料引用缺失时，确定性检查继续；配置语义评估器时，缺 AuthoringTask 在 provider 调用前报错并成为 unavailable，不是“已经成功评估”。原任务 [B63 R2](slices/B63-known-gaps-remediation.md#62-r2-质量物料引用裁决)。

| 选项 | 推荐 | 影响 |
|---|---|---|
| A：保持不回退及 unavailable | **推荐** | 无主链行为变化，正文身份不被轮次 ID 替代；确认后可关闭“兜底原意”悬案，但不宣称缺引用评估成功 |
| B：source_ref 缺失时回退 turn_id | 不推荐 | 改变物料身份语义，须重做来源绑定契约与回归；不能仅改一行 fallback |
| C：保持 A，并补缺引用原因的可观测性 | 需先核现有事件/trace | 若已有足够信息则不新增；若不足，仅补必要原因。改成 skipped/completed 是另一个行为选择 |

C03 的实际选择与关闭范围见 [B63 裁决记录](slices/B63-known-gaps-remediation.md#621-c03-裁决记录)；本包保留原选项，不维护第二份状态。

### 10.5 C04：角色无变化与同名歧义

**事实**：B29 T2 曾生成 old==new 候选；未采纳、零写入，不等于澄清场景通过。两种可接受反馈都必须以正确角色身份为前提，真正歧义必须询问。原任务 [B48](slices/B48-character-revision-noop-and-ambiguity.md)。

| 选项 | 推荐 | 影响 |
|---|---|---|
| A：普通回复说明无需修改，不生成候选/新 revision | **推荐** | 作者少处理一张无意义卡；复用现有回复与 trace，仍需无变化/真变更/歧义/已消歧四场景验证 |
| B：结构化“无变化”业务回执 | 有明确查询消费者时选 | 可在 receipt/why/replay 查询结果；增加回执契约与展示工作，不默认新增表或卡型 |
| C：只处理真正同名歧义，暂不处理 no-op | 不推荐 | 身份安全改善，但无意义候选仍会打扰作者，no-op 债务保持开放 |

状态已满足的 no-op 与同一请求重复提交的幂等不是一回事；任何方案都保留原请求幂等保护，不用“同名一律追问”代替上下文身份判断。

C04 的实际选择与完整实施后果见 [B48 §6–§7](slices/B48-character-revision-noop-and-ambiguity.md#6-c04-裁决记录)；原选项保留，B29 T2 不因作者裁决冒充验收通过。

### 10.6 C05：多 Agent 与全天候运行承诺

原任务 [B50](slices/B50-multi-agent-current-boundary.md)。当前有统一 AgentRun，但不能因此冒充独立进程多 Agent/24x7 已交付。

| 选项 | 推荐 | 影响 |
|---|---|---|
| A：保留 day-1 必须 | 不作为当前优先推荐 | 先明确独立消费者与父子预算、权限、取消、崩溃恢复和交接，再设计实现；不能仅靠补模块名兑现 |
| B：延期，保留未来委派方向与触发条件 | **推荐** | 当前聚焦统一 AgentRun 的创作闭环；不再用旧 24x7 承诺反向阻塞，但不永久取消未来多 Agent |
| C：正式 supersede 旧 day-1 路线 | 可选 | 当前技术权威改为统一 AgentRun，需记录替代 ADR/文档关系；未来多 Agent 需新的正式决策 |

B 的重新开放条件：真实独立任务、清楚的输入/输出与价值、父子预算/故障边界、可执行验收同时具备。选择只影响本项目产品架构，不涉及本次开发助手是否启动子代理。

C05 的实际选择、首期边界与延期实施条件见 [B50 §6](slices/B50-multi-agent-current-boundary.md#6-c05-裁决记录)；不把裁决完成写成多 Agent 产品已完成。

### 10.7 C06：坏候选后如何恢复

原任务 [B40 §13](slices/B40-judgment-era-acceptance-reanchor.md#13-候选失败策略裁决材料)。当前协议先拒绝/降级坏空候选；本轮代码核对 `judgment_candidates/2` 没有调用旧 `Planner.fallback_candidates/1`，旧函数仍定义着通用三方向。不能为了跑通旧场景把这三段文案装成模型创作结果。

| 选项 | 推荐 | 影响 |
|---|---|---|
| A：退役 APP 固定补候选目标，沿现有有界纠错；仍失败时明确反馈并可重试 | **推荐** | 不取消已有自动纠错；先核当前覆盖并补替代证据，不额外承诺候选专用再生成能力，不盲删或降低负例 |
| B：把候选专用自动再生成列为本阶段必须验证的能力 | 可选 | 先核既有通用纠错能否满足，缺什么才补；不保证无限重试或必成功，可能增加调用/等待和专门验收范围 |
| C：暂不决定，继续保留 blocked | 可选 | 生产行为保持，旧场景缺口仍在；不能因暂缓而记 PASS |

C06 实际选择与退役/替代验证承接见 [B40 §13.2–§13.3](slices/B40-judgment-era-acceptance-reanchor.md#132-c06-裁决记录)；设计已定不等于 registry 已退役或替代场景已通过。

### 10.8 C07：角色持久层的过期校验

原任务 [B47 §10.1](slices/B47-canon-freshness-and-conflict-detection.md#101-角色持久层过期策略裁决材料)。边界当前严格拒绝 fingerprint 变化；仓储 `validate_character_fingerprint/3` 在 fingerprint 不同但 old_role 等于当前角色值时仍放行。代码差异已核实，不据此声称已有误写事故。

| 选项 | 推荐 | 影响 |
|---|---|---|
| A：变更写入在持久层也严格核对整体 fingerprint | **推荐** | 权威写入边界一致；无关角色字段改变也会使旧候选失效，需要重新生成/确认。补直接仓储、并发/事务、页面和幂等回归 |
| B：保留差异，明确依赖应用入口 strict | 可暂留 | 无行为变化；直接仓储消费者仍有不同边界，需保留风险和来源限制，不标统一收口 |
| C：改为修改字段级版本语义 | 后续设计候选 | 减少无关字段更新造成的 stale，但须先定义字段版本、冲突类型与回执；不能简单用 old_role 相等替代完整版本契约 |

真实重复请求的幂等重放与新写入分开验证，不因收紧指纹把重复成功改成第二次写入；未有证据的“已是目标值”也不能自动等同同一请求重放。该后果留在 B47，不并入 B48 的候选体验裁决。

C07 的实际选择与后续原子性/幂等/页面验证见 [B47 §10.3–§10.4](slices/B47-canon-freshness-and-conflict-detection.md#103-c07-裁决记录)；没有修改生产守卫，也不改写旧批次证据。

### 10.9 C08：I10 文学盲评安排

来源与安排状态：[I10 人工盲评](slices/VS00D-G-GAP-RECONCILIATION.md#i10-人工盲评安排)。已确认 canonical-3e 导出和报告存在，但尚未核定符合 I10 的可比样本对；工程 PASS 不代表文学收益，也没有本次人工盲评结论。

| 选项 | 推荐 | 影响 |
|---|---|---|
| A：现在启动样本/匿名材料/方案准备，安排第一轮人工基线评审 | **推荐** | 先核来源与可比性，再由作者指定评审人/时间；不足时登记缺口，不自动运行模型补样，也不把单套终稿评分当收益证明 |
| B：保留基线资料，人工评审延期至 B39 第一批真实样本后 | 可选 | 减少当前评审负担，后续集中比较；预先保护基线与比较口径，期间不宣称质量收益已验证 |

A 只决定开始组织评审，不授权 AI 代评签字；具体样本包准备后再提交你审阅。只有已有文本阅读评分不能单独证明“比旧方案更好”，收益结论须有可比基线。

C08 的实际选择、基线保留与重新开放条件见 [I10 裁决记录](slices/VS00D-G-GAP-RECONCILIATION.md#c08-裁决记录2026-10-30)；上表保留提出时的推荐，不替代作者实际选择。

### 10.10 先补证据，不在本轮要求最终裁决

| 事项 | 后续可选方向 | 当前推荐与缺少材料 | 影响 / 承接 |
|---|---|---|---|
| PaperTrail 去留 | 保留、替代或延期 | **先做 B51 CP1 只读取证**：versions 存量、真实生产消费者、现有 revision/trace 替代覆盖尚未齐；现在不推荐直接卸载或删表 | [B51](slices/B51-tech-stack-current-rebase.md)；证据齐后再形成最终去留选项 |
| stage ch1/ch17 历史数据 | 保持现状，或按明确差异修复并保留历史 | **先刷新只读影响清单与逐项修复预案**：当前记录/引用、目标正文差异、备份校验、回滚与 ch17 保留方案；本轮不取得也不执行写库授权 | [B28](slices/B28-whole-chapter-revision.md)；正式修复批准须针对可审阅结果 |
| memory/设定自动冲突扩展 | 延期，或选择首个真实对象进入 contract 设计 | **先补真实对象与可靠 revision/fingerprint 方案**，不能把“想扩大覆盖”直接变成泛化 store 实现 | [B47 §10](slices/B47-canon-freshness-and-conflict-detection.md#10-残余-known-gap不伪称完成)；与 C07 现有角色边界问题分开 |

以上准备材料可由 AI 在已授权只读范围内推进；仅缺证据时不向作者索要空白最终批准。新的外部访问、真实模型资源或破坏性操作仍按各自范围单独处理。

### 10.11 裁决落实方式

1. 每次只呈现当前项的事实、选项、推荐和影响；作者回复具体项号/选项或自己的方向。
2. AI 在对应原任务记录原话、日期、选择和仍未决定的子项；只解除已满足条件的前置，必要时更新 ADR/契约关系。
3. 决策相关实施依已有 slice 的完整范围排期；授权边界、验收缺口与模型窗口不会因“同意路线”自动消失。
4. 本包不复制执行状态，不自动提交 Git、不改产品、不因整理或接受路线就把 Proposed 变为 Accepted；只有作者明确接受具体实施基线时才更新对应 ADR/契约关系。未选事项继续从原任务恢复。

## 11. 2026-10-30 裁决收口与实施排期

- 状态：**done（本轮 C01–C08 裁决记录与排期维护；不代表承接任务实现或验收完成）**。
- 本轮八组问题及 C01 D1–D7、C02 R1–R7 均已逐项取得作者明确选择并回写原任务。ADR-0030/VS-00K/AU-15 与 ADR-0031 的正式接受、ADR-0022 的 Superseded 关系已按明确授权更新；具体取舍、原话和剩余后果从 §10 链接的原任务读取，不在此复制执行状态表。
- 换队依据：已重新运行 `node scripts/next_task_check.mjs --open`，核对 B43、B01、B39、B45、B47 §10.1、B48 的实际来源与设计前置。优先 B43 的全回合裁决、幂等与真实阻断/回放基础；B01 承接真实入口引用；B39 消费统一执行边界并提供首批求证样本；B45 承接契约/历史兼容；B47 与 B48 分别闭合持久安全和作者交互。当前选择与候选顺序只维护在 [NEXT](NEXT.md)。
- 依赖处理：候选顺序不是要求每个 slice 全部 done 后才启动下一个。B43 CP0 必须与 B01 来源及 B45 必需的类型/校验对齐；具体实现 checkpoint 在各原任务细化，不等待全量 schema 清理，也不跳过同源生产者、真实消费者和外部页面验收。
- 未进入近期五个候选的工作保留原承接：[B40 §13](slices/B40-judgment-era-acceptance-reanchor.md#13-候选失败策略裁决材料) 的旧场景退役与替代失败恢复证据、[B46](slices/B46-persistent-adoption-inbox.md) 的持久采纳入口、[B51](slices/B51-tech-stack-current-rebase.md) 的技术栈与 PaperTrail 取证、[B57](slices/B57-sec-injection-boundary.md) 的输入/观察对抗矩阵、[B58](slices/B58-human-approval-policy-unification.md) 的批准策略对账等仍按原任务推进。未排期不等于 blocked；其它历史与长尾仍沿 §8/§9 和原来源恢复，本次不机械改写开放清单全部状态。
- 尚需条件或证据的事项：I10 和独立多 Agent/24x7 按原触发条件延期；AU-15 仍需产品/driver、预注册与真实模型窗口；PaperTrail、stage 数据修复和 memory/设定冲突扩展先补 §10.10 的具体材料。本轮不再就已选事项重复索要裁决，也不把这三项的最终去留/写入授权视为已经取得。
- 本次交付仅为文档与已有基线材料的校验清单；没有开始产品实现、运行模型、联系评审人、修复存量数据或提交 Git。清单不等于质量证据，队首选定不等于 CP 已开工。
- 验证：`node scripts/next_task_check.mjs --open` 通过，NEXT 为 28 行；`node --test scripts/next_task_check.test.mjs` 25/25 通过；本轮累计文档差异新增的 140 处本地链接/锚点核对无缺失；基线清单 15/15 文件复核 SHA-256 一致；`git diff --check` 通过。以上均为文档/治理及材料完整性检查，不是产品或文学质量验收。

## 12. 2026-10-30 候选容量与就绪性复核

- 状态：**done（本轮候选规则、来源复核与检查器更新完成；下游产品实施未启动）**。
- 作者选择：本聊天提出“当前任务仍为 1 项，取消候选最多 5 项限制，按明确下一步、优先级与依赖列全；阻塞/延期单列，每次完成或受阻后复核补位”，作者回复 **“同意”**。据此取代先前五项硬上限，§8/§11 保留当时的历史排期依据；当前规则见 tasks/README，当前排序只维护在 NEXT。
- Contract / Invariant：原任务状态真源、NEXT 三节简表、单一队首和有效来源不变；有明确下一步的候选不限数，阻塞/延期不能混作就绪项，父批次完成不能掩盖开放子项，历史终态不能因队列扩展自动重开。
- Boundary / Consumer：只修改 tasks 原文、索引与 scripts/next_task_check 检查器/测试；消费者为真实 CLI 与进入仓库的执行者。没有 app、schema、UI、数据或模型调用改动。Proof 使用规则反例、真实 CLI、链接与来源核对、ub 工具和统一静态扫描；真实页面 Acceptance Driver 与作品 Exploration 不适用本治理任务，产品验收感知逻辑 no。
- 复核方法：从 `--open` 回查原文，同时追 §4–§6 中已有开放承接，防止非标准历史顶部状态漏报。加入既有可推进的 CP0/材料核对/补验入口，不把审计准备等同于后续所有实现前置已满足。已有章节保持完整验收范围，只有明确子项以锚点精确排期；无法识别的其它历史文件仍需回原文，不宣称全仓所有任务都已获得实施授权。
- 承接处理：B40 C06、B46、B51、B57/B58 的既有范围可推进；AU04-AU06、B27、VS-00G 先做现役入口/定向残余/证据核对；B13 运行失败日志、CA04 B15、VS-00F 维护 StateTrace、DS03 agent_run_state 及其它已明确尾项落回既有 owner 的开放小节。B43、B01、B45 先对齐核心来源与契约，B39 消费这些边界；其它工作按当前可推进步骤排序，不要求所有前项整包 done。
- 去重与条件：B34 顶部 doing 按 §8 的历史 done 记录校正，5 PASS / 1 INCONCLUSIVE 及 B38 触发条件保留；旧 UA streaming reasoning 的残余先与 B40 同族资产核对，unified mainchain 不重建；vendor live 的历史缺凭据须重新核实，叙述体裁、人工复核、非预算 awaiting、durable/dismiss 等仍按各自真实消费者/契约/资源触发，不用排期替代授权。
- 实施记录：先补超过五项、超过旧总长度仍有效、候选状态受阻等反例，确认旧检查器按预期失败后修改；总篇幅检查调整为说明篇幅与单行限制，表格任务行不占说明配额；按布局、来源、状态、阻塞和旅程拆分原大型检查函数，保留既有错误类型与开放清单行为。未创建第二任务目录或常驻自动化，未提交 Git。
- 验证：`node --test scripts/next_task_check.test.mjs` **27/27**；`node scripts/next_task_check.mjs --open`、语法与 `git diff --check` 通过；本轮排期为 1 个当前、21 个候选（18 todo / 3 doing），NEXT 45 行。200 项候选的反例证明数量与旧总长度不会截断来源核验，末项终态/缺文件仍被拒绝；当前累计文档差异新增链接经逐项核对，无新增断链。
- ub-mode：Crapper 将检查器最大函数复杂度从 40 降至 9，本次变更函数 CRAP 最大 9.1；原 `main/taskFiles` 的 CLI 子进程覆盖没有被 LCOV 合并，报表值仍为 90/12，真实 CLI 已通过隔离执行及仓库检查，不能宣称全文件 CRAP 均达标。Dryer 对隔离目录中字节相同的 TypeScript 后缀副本按 0.8 阈值未检出重复（工具不直接支持 `.mjs`）；Mutator 对新增篇幅/状态规则执行 7 个变异，7/7 killed、0 survived，未把全文件未执行站点计为通过。详细记录见 验证摘要（`../artifacts/next-task-check/2026-10-30-expand/verification.json`）。
- 统一扫描：`bash scripts/ai_static_scan.sh --top 10` 首次被沙箱 Mix.PubSub TCP 与工具访问限制阻断，失败报告已保留；按所需权限重跑后 **19/20 checks passed、blocking=0**，退出 0。修复项为本轮队列上限/状态校验与检查器复杂度；没有通过修改产品或放宽扫描规则消除环境报错。剩余 Top 10 实际为 4 条历史 gitleaks：B63 文档/E10 spec/Pencil 元数据为既有 `false_positive`，ProjectGod 历史配置为既有 `accepted_risk`；沿原处置保留，不重写历史、不轮换他人凭据。原始 gitleaks check 仍失败，不写成全扫描零发现。报告与处置见 Top 10（`../artifacts/static-scan/top10.md`）、处置视图（`../artifacts/static-scan/disposition.md`）。

## 13. 2026-10-30 从设计反查任务遗漏

- 状态：**done（本轮设计/任务/代码交叉审计、补登记与文档验证完成；新旧产品任务仍按各自原文推进）**。
- 来源：作者要求“重新帮我梳理，看看有没有任务遗漏，或者从设计出发规划出新任务”。本轮允许补原任务、规划新 slice 和重排候选，不替作者接受尚未冻结的备份/资料落位/方向语义，不执行真实作品数据修复、实模运行、依赖安装或 Git 提交。
- 基线：`develop/dialogue-based-novel-workbench` / HEAD `e1685675`，包含本聊天此前未提交的 C01–C08、ADR-0030/0031 与队列扩展；工作区先备份，保留所有已有 WIP。C01–C08 结论继续有效，ADR-0022 保持 Superseded；不复活第七次 B27 全量 retest 或已延期的多 Agent/批量/云部署。

### 13.1 复核范围与判定方法

先从愿景 00 §2、交互 01、主链 00b/00c/00d/02–06、08、ADR/contract/schema 进入，再对照 domain/foundation/quality、tech-stack 05/06/11、UI 41/43/44/46、AU/SU、产品旅程/里程碑和现有 quality 场景，追到真实 producer、消费点与原任务。设计库存为 166 份 Markdown、原 slices 为 213 份；这些是入口盘点规模，**不是宣称 379 份正文及所有代码已经逐行审完**。深核范围是下表列出的承重边界和明确开放承接；没有检查 Pencil 视觉布局，不据未找到模块就认定功能不存在。

按三种结果处理：已有任务缺排期入口→补原任务小节；设计/现役实现有独立闭环缺口→新 slice；已交付/明确延期/无当前消费者→保留历史或条件。功能实现、页面证据、真实模型行为与人工质量结论分别判断。排队仅代表该行具体下一步可推进，CP0 准备不能代签后续契约与资源条件。

### 13.2 新登记的四个承重任务

| 设计要求与真实场景 | 已核实证据及其边界 | 唯一执行来源与下一步 |
|---|---|---|
| 06/VS-00C/AU09：回到第 3 章创作，应按真实目标章选择适用记忆，而非全书已写到第 10 章 | 普通 recall 以最大已采纳 seq 定位置；CA02 `creative_facts/1` 未消费窗口/目标章，writer/evaluator 共用事实段。是静态接线缺口，未证明线上某次文本已错误；独立 revision 路径单列核查 | [B64](slices/B64-coordinate-aware-memory-consumption.md)：先验证目标/窗口/消费者反例，复用既有章身份与有效窗，不等 B54 时间线对象 |
| 阶段 1 loopback/Tauri：HTTP 与 WS 应执行明确来源边界 | CORS 前缀表达式会接受伪 localhost/127/tauri 后缀，prod WS `check_origin:false` 与连接入口需同批核对。已离线验证表达式，无网络攻击/产品利用证据；CORS 不等于认证 | [B65](slices/B65-local-http-websocket-origin-boundary.md)：核 dev/stage/release 与实际来源矩阵，再修精确来源和连接边界；新增鉴权另冻结 |
| 阶段 1 SQLite/Tauri：作者能备份并恢复工作区，正文导出不承担完整恢复 | 当前 ExportService/前端是 Markdown 导出，Tauri 注册未发现备份恢复消费者；运维/验收复制不能代替作者入口。每日/每章、敏感文件、恢复覆盖口径未冻结 | [B66 CP0](slices/B66-local-workspace-backup-restore.md#cp0-最小本地快照恢复契约准备)：先提交一致快照、范围、敏感文件、恢复目标/回滚与自动触发选项；CP1+ 仍需具体接受 |
| VS-00F/ADR-0026/生命周期：旧章改稿或删去出场后，脉络/审读应基于当前有效正文 | 纯 LedgerEntry 反例：最近 ch10→处理旧 ch3 后变 ch3→ch12 被判 STALLED；完整章/fragment、贡献撤回与持久原子性仍待完整链证明。不是数据库或页面复现 | [B67](slices/B67-revision-aware-ledger-maintenance.md)：先冻结旧贡献失效、重算/版本与作者裁决保护；不以 max(seq) 或单纯补 trace 替代完整一致性 |

四份新任务均有七问、真实消费者、CP 与完整验收后果；没有新增 schema、ADR 或产品代码。未知语义先做具体契约准备，只有发现实际缺口才选择最小实现机制。

### 13.3 回原任务补入的十一处可推进入口

| 遗漏类型与设计依据 | 原任务承接与边界 |
|---|---|
| VS-00F 分账状态/payload 与 schema/codegen，真实脉络 DTO 已消费但没有完整契约校验入口 | [VS00F-B06](slices/VS-00F-five-ledgers-three-state.md#b06-分账契约与真实消费-checkpoint)：先区分领域信封与面板 DTO；B45 协同，不新建五账体系 |
| AU-15 已可做预注册/驱动设计，却被整个 CP4 blocked 隐藏 | [B42-PREP](slices/B42-model-behavior-evidence-tier.md#101-au-15-预注册与-driver-准备)：准备与真实运行分开，资源/产品接线不自动放行 |
| AU03 B1/B2/B3 空作品、仅背景和 fetcher 失败的完整证据 | [AU03-CONTEXT](slices/AU03-file-level-closure.md#当前上下文缺失与读取失败补验)：按 B27 当前语义重锚，不恢复 envelope |
| AU03 C3 / Journey B4 搜索命中消息定位/高亮 | [AU03-SEARCH](slices/AU03-file-level-closure.md#历史搜索命中定位与只读回看)：稳定 turn 身份、分页与只读/作品隔离 |
| AU08 C2–C4 当前已有四态和重试，但 FAILED/REBUILDING/恢复/no-write 未形成完整矩阵 | [AU08-REFRESH](slices/AU08-file-level-closure.md#阅读投影状态与失败恢复补验)：先核现有实现与旧内容口径，不造第二 projection job |
| AU10-D2 已有任务成功链，FAILED 仍缺实际页面证据 | [AU10-FAILED](slices/AU10-workbench-recovery-taskstate.md#failed-任务状态真实页面补验)：用已有导出消费者，不启动 B52 批量 |
| AU10 现役卡片/动作结果、未知/失效与跨状态消费仍有原 P1/P2 | [AU10-MATRIX](slices/AU10-file-level-closure.md#现役动作与卡片矩阵核对)：与 B43/B48/AU07/AU08 分责，不恢复退役卡型 |
| 06 §4.5 / AU09 CP2：角色演化已写入，不等于新会话真正召回 | [AU09-EVOLUTION](slices/AU09-memory-taxonomy-write-policy.md#cp2-角色演化记忆的真实召回)：复用 B64 窗口、主档案身份与真实 Why/请求证据；不包办新关系/时间线对象 |
| AU12-I1/I7 与 CA01：立项修订采纳后，works/档案/后续请求同源 | [AU12-WRITEBACK](slices/AU12-correction-intent-roundtrip.md#p2-立项修订的采纳落位与同源消费)：先字段/提案/版本契约，不将任意 world_setting 覆盖 works；已有三字段 skeleton 回写不足以代签 |
| AU09 已要求长期方向，类型/并存替换/废弃还缺可审阅材料 | [AU09-DIRECTION](slices/AU09-work-direction-memory-recall.md#6-当前契约与裁决材料准备)：准备独立可推进，父任务实施保持 blocked；旧类型建议不是新拍板 |
| SU04 仅正常冷启动/退出历史证据，设计要求失败/就绪/优雅退出生命周期 | [SU04-LIFECYCLE](slices/SU04-desktop-sidecar-packaging.md#现役故障与生命周期契约核对)：先核现役真实状态、迁移/端口/半解包失败与恢复；不被签名/跨平台条件遮住 |

此外补强 [B39 §4.1](slices/B39-evidence-seeking-authoring.md#41-求证不变量的-cp-与证据承接)：#20–#23 显式映射到 CP、场景 verifier、确定性 CI 与实模 tier，防止产品场景局部通过后漏掉工程门禁后果；此项不另增队列条目。00b/00c 的当前 VS-00K/#20–#23 口径校正为已接受设计、尚待实现，历史 Proposed 记录不机械改写。

### 13.4 优先级、去重与仍需条件的事项

B43 保持当前任务；新候选优先放 B65 的本机来源核对、B64/B67 的事实消费与派生正确性，随后与 B01/B45/B39 的既定主线衔接。五账/运行状态 schema 按真实消费者协同；旧体验补验、资料/方向契约与备份准备依次排入。唯一当前顺序见 [NEXT](NEXT.md)，不在本节复制活动状态表。

没有新建第二份 memory/trace/五账/求证架构；B57 提示注入、B58 作者批准与 B65 传输来源分责，B54 故事时间对象与 B64 章节有效窗分责，VS00F-TRACE 与 B67 派生值正确性分责。BIZ-01–06 已有收口证据，不能因 notes 索引陈旧重开；P1 的 100K 历史、后续 10 章 scoped 与 I10 人工盲评继续分证。

多 Agent/24x7、LongRunner 批量、P2 大规模长跑、完整时间线/风格对象/四门、外部搜索、durable 对账、Experience dismiss、未批准复活/合并、live vendor/OAuth、签名公证/跨平台与 stage 数据修复保留原条件。I10 仍按 C08=B 等 B39 首批真实样本；本轮不给任何条件项补签 PASS，不自动运行备份、模型或修复作者数据。

### 13.5 入口完整性与验证

- 补齐 `tasks/slices/README` 漏列的 17 份既有任务，均只增加导航角色，不改变其历史状态或自动重开实现；tasks、slices、v3 三层的 Markdown 文件逐项检查无漏列。slice 模板补回 Exploration 第七问，并将“写不出来就缩小 slice”校正为“先补设计，checkpoint 不缩小完整验收”。
- `node scripts/next_task_check.mjs --open` 通过：1 个当前任务、36 个候选，其中新增 4 个 slice 入口和 11 个既有任务入口；B39 的不变量矩阵不重复排期。`node --test scripts/next_task_check.test.mjs` 27/27 通过，检查器未在本轮修改。
- `mix run --no-start scripts/adr_trace.exs` 首次因沙箱 Mix.PubSub 本地 TCP 权限未执行；以所需权限重跑后 30/30 Accepted、338 refs、0 pending。它只证明引用可达，不证明运行时语义已正确。
- `bash scripts/gap_ledger.sh` 刷新后原 G/NEM/B 轨开放 ID 保持 20→20，无新增/丢失 ID；其中 B3 仅校准方向/演化/B64 的承接，余项保留。该计数不是项目全部任务数，也不会因为新增 B64–B67 自动关闭原差距。
- 新文件索引、文档差异新增链接/锚点、NEXT 来源与 `git diff --check` 通过；本轮证据落于 `artifacts/task-audit/2026-10-30-design/`。只有文档、任务和派生差距快照变更，纯表达式/纯函数探针按 B65/B67 的限制单独披露；未运行产品页面、真实模型或数据库操作，未新跑产品功能/静态扫描，也不将上一轮扫描结果冒充本轮产品验证。

## 14. 2026-10-30 逐文件设计承接核对

- 状态：**done（文件清单与主要承接关系核对完成；设计条款任务化仍不完整）**。
- 来源：作者询问“所有的设计文档是否都已经有对应的任务”。本节逐文件回答归属，补足 §4 历史分组统计与 §13 重点审计的证明范围；不把引用命中、存在同名任务或已有代码当作全条款覆盖。
- 范围：当前 `docs/design/` 的 **166 份 Markdown、38 份 JSON schema、1 份源原型，共 205 项**；10 张导出 PNG 是派生产物，由其源原型/导出索引解释，不逐图创建产品任务。没有逐帧审查 `.pen`，不据此作视觉实现判断。
- 证据：逐文件核对原文标题/章节/场景/余项/目录摘要与对应原任务，并复用 §13 的定向代码核对；机器清单与映射（`../artifacts/task-audit/2026-10-30-design-coverage/coverage.json`） 保留文件集合及分类，源文件指纹（`../artifacts/task-audit/2026-10-30-design-coverage/inventory.json`） 记录基线。下表是本日审计结果，不维护任务执行状态；进度与阻塞仍只回原任务读取。

> 后续登记（本节核对之后）：作者已要求将 schema 后续纳入队列；Experience Engine 已补 [B68 延期入口](slices/B68-experience-rule-governance.md)，见 §15。本节数字与机器映射保留为登记前的审计快照，不再据其中 gap=1 断言当前没有承接；41 项部分承接也不会因登记任务自动变成条款已闭环。

### 14.1 当前可以确认的结论

**尚不能认定所有设计要求都已有具体、完整的执行任务。** 每份文件都已纳入本次清单，但“主要范围有承接”只证明主题与已明确后果有接收方；它不表示所有字段、状态转换、消费者、失败恢复和验收条款都已逐条任务化，更不表示实现完成。

| 文件范围 | 主要范围有承接 | 部分承接 | 导航/约束/资产，无需独立产品任务 | 历史/被替代，有保留或后继 | 缺完整承接 | 合计 |
|---|---:|---:|---:|---:|---:|---:|
| Markdown 设计文档 | 82 | 28 | 40 | 15 | 1 | 166 |
| JSON schema | 24 | 13 | 0 | 1 | 0 | 38 |
| 源原型 | 0 | 0 | 1 | 0 | 0 | 1 |
| 总计 | 106 | 41 | 41 | 16 | 1 | 205 |

- **缺完整承接**：`domain/33-experience-engine.md`。VS-00F 仅登记 Engine 出现后的 dismiss 日志收编；B55 风格对象不能代替经验提炼、审阅、规则生命周期与后续消费的完整任务。它仍属既定延期方向，本次没有自动立项或启动引擎。
- **部分承接**包含两类：已找到具体未分配后果；或范围较宽、尚未逐字段/逐状态核清映射。两类都不能盖章完整覆盖，也不能直接解释为当前产品全部有缺陷。
- 已找到的具体缺项包括：桌面自动更新完整链；通用 schema versioning/自动 Ecto migration 草稿；telemetry opt-in/out、audit 加密与 sampling；AU13 D1 的体量 finding→补体量→规划消费→不再误终局 checkpoint。它们不能靠 B51 文档重定或主题相近的大任务代签。
- 其余待逐条映射的重点：MemoryScope/Retention/Mutation 等通用枚举生命周期、maintenance hook 全目录、所有上下文消费者的预算/省略规则、旧引导协议的保留/退役映射、生命周期各阶段转换。明确延期项继续延期；补映射时先判断保留、收窄、转交或条件登记，不按旧设计机械造无消费者能力。
- 因此应区分“文档已列入清单”“主要范围有承接”“全部适用条款有任务”“实现/验收完成”四个结论。166/166 文件列入清单不能表述为 166/166 功能已完整任务化。

### 14.2 逐文件映射

分类说明：主要范围有承接＝文件主题/当前已明确后果有原任务；部分承接＝仍有下列具体范围待分配或核清；导航/约束/资产＝由现有索引/工程检查/源资产流程消费，不强造独立产品任务；历史/被替代＝保留历史或明确后继；缺完整承接＝只有局部依赖/触发记录，未找到完整责任任务。表内任务链接是职责归属，不是完成证明。

#### 主链与入口（15 项）

| 设计来源 | 分类 | 对应任务或局部承接 | 范围与限制 |
|---|---|---|---|
| [00-vision-and-engineering-roadmap.md](../docs/design/00-vision-and-engineering-roadmap.md) | 导航/约束/资产 | [B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md)、[B52-longrun-batch-draft](slices/B52-longrun-batch-draft.md)、[B53-p2-500k-milestone](slices/B53-p2-500k-milestone.md) | 愿景、分期与开工门槛由各切片消费，不需另建愿景实现任务。 仅列明确主线承接，不能据此声称所有愿景场景或后续里程碑已覆盖。 |
| [00a-reading-map.md](../docs/design/00a-reading-map.md) | 导航/约束/资产 | [2026-10-27-design-to-execution-reconciliation](2026-10-27-design-to-execution-reconciliation.md) | 按角色导航与阅读顺序，是设计入口。 目录可达不等于被链接文件的条款已有实现任务；旧阶段标签需随原文解释。 |
| [00b-end-to-end-dialogue-flow.md](../docs/design/00b-end-to-end-dialogue-flow.md) | 主要范围有承接 | [B26-single-call-judgment-protocol](slices/B26-single-call-judgment-protocol.md)、[B27-systematic-prompt-and-intent-integration](slices/B27-systematic-prompt-and-intent-integration.md)、[B31-author-reply-run-binding](slices/B31-author-reply-run-binding.md)、[B43-gate-order-residual](slices/B43-gate-order-residual.md) | 输入、判断、执行、作者回传与裁决同源分别有现役任务承接。 owned表示主链主题有承接任务；旧示例与ADR-0031的逐出口对齐仍待B43。 |
| [00c-state-and-contract-atlas.md](../docs/design/00c-state-and-contract-atlas.md) | 导航/约束/资产 | [2026-10-27-design-to-execution-reconciliation](2026-10-27-design-to-execution-reconciliation.md) | 对象、状态、契约、ADR与切片索引，不是独立实现计划。 索引列出的任务不证明每个不变量已落地；不得把导航覆盖当条款覆盖。 |
| [00d-runtime-architecture.md](../docs/design/00d-runtime-architecture.md) | 部分承接 | [UA01-unified-agent-run-mainchain-closure](slices/UA01-unified-agent-run-mainchain-closure.md)、[B43-gate-order-residual](slices/B43-gate-order-residual.md)、[B50-multi-agent-current-boundary](slices/B50-multi-agent-current-boundary.md)、[SU04-desktop-sidecar-packaging](slices/SU04-desktop-sidecar-packaging.md) | 统一运行时、裁决、桌面进程及多Agent边界已有分别承接。 控制面/数据面/恢复/横切组件未逐格映射；多Agent当前延期，不是runtime全覆盖。 |
| [01-user-llm-workbench-interaction-model.md](../docs/design/01-user-llm-workbench-interaction-model.md) | 主要范围有承接 | [B26-single-call-judgment-protocol](slices/B26-single-call-judgment-protocol.md)、[B27-systematic-prompt-and-intent-integration](slices/B27-systematic-prompt-and-intent-integration.md)、[B43-gate-order-residual](slices/B43-gate-order-residual.md)、[AU11-creative-partner-conversational-voice](slices/AU11-creative-partner-conversational-voice.md) | 对话优先、模型创作伙伴、执行权及作者可见反馈有明确主链与体验任务。 伙伴口吻尚有体验后续；旧form_frame实现建议不能直接恢复，owned不代表体验通过。 |
| [02-dialogue-frame-and-micro-plan.md](../docs/design/02-dialogue-frame-and-micro-plan.md) | 主要范围有承接 | [2026-10-27-design-to-execution-reconciliation · 小节](2026-10-27-design-to-execution-reconciliation.md#b01-入口来源与语义边界)、[B43-gate-order-residual](slices/B43-gate-order-residual.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md)、[B49-core-semantics-and-adr-review](slices/B49-core-semantics-and-adr-review.md) | 真实来源、逐步计划与统一裁决、schema兼容已由ADR-0031承接到原任务。 历史草案字段不逐项强补；设计接受与运行时实现分开。 |
| [03-capability-toolbox-contract.md](../docs/design/03-capability-toolbox-contract.md) | 部分承接 | [B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md)、[B57-sec-injection-boundary](slices/B57-sec-injection-boundary.md)、[B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md)、[B13B-adr-enforcement-reconciliation](slices/B13B-adr-enforcement-reconciliation.md) | 分层输出校验、探索证据、权限对抗与历史ADR差距有承接任务。 registry字段、版本与工具错误/trace全矩阵未逐字段挂接；不能由B45泛称全包覆盖。 |
| [04-execution-orchestrator.md](../docs/design/04-execution-orchestrator.md) | 主要范围有承接 | [GATE-ORDER-CLOSURE-execution-gate-order-12](slices/GATE-ORDER-CLOSURE-execution-gate-order-12.md)、[B43-gate-order-residual](slices/B43-gate-order-residual.md)、[B58-human-approval-policy-unification](slices/B58-human-approval-policy-unification.md) | 门序、逐回合裁决、幂等阻断与批准审计均有明确完整范围。 已有allow证据不代签blocked，后续统一裁决与真实页面矩阵仍待实施。 |
| [04a-planning-and-long-run.md](../docs/design/04a-planning-and-long-run.md) | 主要范围有承接 | [B52-longrun-batch-draft](slices/B52-longrun-batch-draft.md)、[UA01-CP5-durable-agent-run-resume](slices/UA01-CP5-durable-agent-run-resume.md)、[AU10-workbench-recovery-taskstate](slices/AU10-workbench-recovery-taskstate.md) | durable恢复、作者任务状态与批量初稿差距均有明确任务。 B52仅条件触发；已有导出和AgentRun恢复不证明批量创作已实现。 |
| [05-turn-behavior-and-state-model.md](../docs/design/05-turn-behavior-and-state-model.md) | 主要范围有承接 | [AU04-AU06-author-action-binding](slices/AU04-AU06-author-action-binding.md)、[DS03-awaiting-author-runtime-validity-and-recovery-surface](slices/DS03-awaiting-author-runtime-validity-and-recovery-surface.md)、[B43-gate-order-residual](slices/B43-gate-order-residual.md) | 行为绑定/历史/恢复与统一裁决状态映射有现役承接。 旧NextAction等按ADR-0031收敛；非预算await与S4仍须实际消费者触发。 |
| [06-memory-context-and-trace.md](../docs/design/06-memory-context-and-trace.md) | 部分承接 | [B64-coordinate-aware-memory-consumption](slices/B64-coordinate-aware-memory-consumption.md)、[B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md)、[AU07-trace-replay-integrity](slices/AU07-trace-replay-integrity.md)、[VS-00F-five-ledgers-three-state · 小节](slices/VS-00F-five-ledgers-three-state.md#维护-statetrace-后续-checkpoint)、[AU09-work-direction-memory-recall](slices/AU09-work-direction-memory-recall.md) | 记忆窗口、求证、回放、维护trace与长期方向分别有承接任务。 存储分层/遗忘保留、全量省略说明与每类MemoryTrace条款未逐条完成映射。 |
| [07-workbench-ui-contract.md](../docs/design/07-workbench-ui-contract.md) | 部分承接 | [DS01-decision-surface-schema-gate](slices/DS01-decision-surface-schema-gate.md)、[DS02-adoption-status-canonicalization](slices/DS02-adoption-status-canonicalization.md)、[AU10-file-level-closure](slices/AU10-file-level-closure.md)、[B46-persistent-adoption-inbox](slices/B46-persistent-adoption-inbox.md) | 决策面、采纳动作、卡片矩阵和持久待处理入口有明确任务。 旧卡集合及每个状态/流式/回传组合尚未逐条核对到现役消费者。 |
| [08-novel-element-model.md](../docs/design/08-novel-element-model.md) | 部分承接 | [B11A-volume-blueprint](slices/B11A-volume-blueprint.md)、[VS-00F-five-ledgers-three-state](slices/VS-00F-five-ledgers-three-state.md)、[VS-00G-fact-inventory-run](slices/VS-00G-fact-inventory-run.md)、[B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md)、[B54-continuity-time-and-state](slices/B54-continuity-time-and-state.md) | 卷、账本、事实补全、通用求证与时间线方向有具体承接任务。 NEM-GAP-02及E24/E26/E28–E30仍按真实动作触发，未有逐要素实施任务。 |
| [README.md](../docs/design/README.md) | 导航/约束/资产 | [2026-10-27-design-to-execution-reconciliation](2026-10-27-design-to-execution-reconciliation.md) | 设计唯一真源、吸取原则与目录入口。 它证明组织规则和导航，不代替各设计条款任务映射。 |

#### 领域设计（12 项）

| 设计来源 | 分类 | 对应任务或局部承接 | 范围与限制 |
|---|---|---|---|
| [domain/20-novel-domain-overview.md](../docs/design/domain/20-novel-domain-overview.md) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | 领域边界、对象分组和生命周期总览，具体能力下沉各领域设计与切片。 全生命周期愿景不能由总览自动变成已排任务；本项无独立功能承接任务。 |
| [domain/21-novel-object-model.md](../docs/design/domain/21-novel-object-model.md) | 部分承接 | [B11A-volume-blueprint](slices/B11A-volume-blueprint.md)、[B29-existing-character-role-revision](slices/B29-existing-character-role-revision.md)、[B54-continuity-time-and-state](slices/B54-continuity-time-and-state.md)、[B55-style-objects-and-consumption](slices/B55-style-objects-and-consumption.md) | 卷章、角色身份、连续性与风格对象各有局部承接。 地点/势力/道具及完整对象生命周期未逐对象定位；无真实消费者不因设计有名就建表。 |
| [domain/22-continuity-model.md](../docs/design/domain/22-continuity-model.md) | 主要范围有承接 | [B54-continuity-time-and-state](slices/B54-continuity-time-and-state.md)、[B56-quality-maintenance-gates](slices/B56-quality-maintenance-gates.md)、[B44-persistence-transition-boundary](slices/B44-persistence-transition-boundary.md)、[B67-revision-aware-ledger-maintenance](slices/B67-revision-aware-ledger-maintenance.md) | 时间/状态读模型、连续性门、摘要状态和修订后派生一致性有明确承接。 时间对象和部分质量门仍deferred；owned不表示事件/快照已存在或全文字段已冻结。 |
| [domain/23-style-and-author-intent.md](../docs/design/domain/23-style-and-author-intent.md) | 主要范围有承接 | [B55-style-objects-and-consumption](slices/B55-style-objects-and-consumption.md)、[CA02-writing-facts-context](slices/CA02-writing-facts-context.md)、[AU09-work-direction-memory-recall](slices/AU09-work-direction-memory-recall.md) | 样本/偏好/brief/反馈补丁由B55明确承接，现有CA02和长期方向另有原任务。 B55待真实编辑/版本消费者；多方向生命周期仍待具体契约裁决。 |
| [domain/24-novel-intent-catalog.md](../docs/design/domain/24-novel-intent-catalog.md) | 导航/约束/资产 | [B27-systematic-prompt-and-intent-integration](slices/B27-systematic-prompt-and-intent-integration.md)、[B34-author-intent-corpus-validation](slices/B34-author-intent-corpus-validation.md) | 是动作族词汇与职责边界，供语义主链和真实意图语料验证消费。 不是Router分类表；13个意图族的全部能力未逐项证明已有任务或已实现。 |
| [domain/25-maintenance-hooks.md](../docs/design/domain/25-maintenance-hooks.md) | 部分承接 | [VS-00F-five-ledgers-three-state](slices/VS-00F-five-ledgers-three-state.md)、[B44-persistence-transition-boundary](slices/B44-persistence-transition-boundary.md)、[B54-continuity-time-and-state](slices/B54-continuity-time-and-state.md)、[B67-revision-aware-ledger-maintenance](slices/B67-revision-aware-ledger-maintenance.md) | 摘要/账面维护与修订失效已有承接任务；时间维护方向归B54。 完整hook目录、trigger/validator/聚合/重试与低风险策略没有逐hook任务映射。 |
| [domain/26-context-assembly-policy.md](../docs/design/domain/26-context-assembly-policy.md) | 部分承接 | [CA01-planning-context-completion](slices/CA01-planning-context-completion.md)、[CA02-writing-facts-context](slices/CA02-writing-facts-context.md)、[B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md)、[B64-coordinate-aware-memory-consumption](slices/B64-coordinate-aware-memory-consumption.md) | 规划/写作消费、求证和目标有效性有明确承接任务。 Reader/Maintenance/Replay等全部消费者的预算、省略、解释与失效规则未逐格核对。 |
| [domain/27-reading-projection.md](../docs/design/domain/27-reading-projection.md) | 主要范围有承接 | [AU08-file-level-closure](slices/AU08-file-level-closure.md)、[B28-whole-chapter-revision](slices/B28-whole-chapter-revision.md)、[P1-word-count-audit](slices/P1-word-count-audit.md) | 阅读投影来源、刷新失败恢复与阅读审计有对应原任务。 owned不表示reader_recap全字段落地；当前四态须沿AU08真实页面补验。 |
| [domain/28-authoring-lifecycle.md](../docs/design/domain/28-authoring-lifecycle.md) | 部分承接 | [AU12-correction-intent-roundtrip](slices/AU12-correction-intent-roundtrip.md)、[B28-whole-chapter-revision](slices/B28-whole-chapter-revision.md)、[B52-longrun-batch-draft](slices/B52-longrun-batch-draft.md)、[B67-revision-aware-ledger-maintenance](slices/B67-revision-aware-ledger-maintenance.md) | 立项修订、正文改稿、批量和维护一致性分别有承接。 五阶段间全部回退/主导态/推荐模式与done判据未形成逐转换任务矩阵。 |
| [domain/33-experience-engine.md](../docs/design/domain/33-experience-engine.md) | 缺完整承接 | [VS-00F-five-ledgers-three-state](slices/VS-00F-five-ledgers-three-state.md) | 仅有dismiss日志在Engine出现后的条件收编；未发现经验提炼/审阅/规则生命周期的完整承接任务。 当前明确延期，不能把VS-00F或B55泛挂成整个Engine已覆盖，也不据此自动启动引擎。 |
| [domain/34-novel-element-field-priority.md](../docs/design/domain/34-novel-element-field-priority.md) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | 字段结构化优先级、对象落位和治理约束，随真实消费切片采用。 该规则不是为全字段建表的任务；逐字段覆盖仍须看08及实际对象承接任务。 |
| [domain/README.md](../docs/design/domain/README.md) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | 领域设计目录索引。 列出文件不意味着所有领域条款均已分配任务。 |

#### 基础契约（6 项）

| 设计来源 | 分类 | 对应任务或局部承接 | 范围与限制 |
|---|---|---|---|
| [foundation/00e-architecture.md](../docs/design/foundation/00e-architecture.md) | 历史/被替代 | [UA01-unified-agent-run-mainchain-closure](slices/UA01-unified-agent-run-mainchain-closure.md)、[B50-multi-agent-current-boundary](slices/B50-multi-agent-current-boundary.md) | 原文明确Router-first部分superseded；现运行时与多Agent取舍已有后续。 只保留横切/部署参照；未逐项证明全部历史组件仍应实现。 |
| [foundation/08-provider-abstraction.md](../docs/design/foundation/08-provider-abstraction.md) | 部分承接 | [UA01-provider-execution-stream-unification](slices/UA01-provider-execution-stream-unification.md)、[B22-provider-liveness-and-budget-policy](slices/B22-provider-liveness-and-budget-policy.md)、[UA01-dynamic-agent-run-budget](slices/UA01-dynamic-agent-run-budget.md)、[SU01-provider-vendor-matrix-openai-minimax-zhipu-kimi-gemini](slices/SU01-provider-vendor-matrix-openai-minimax-zhipu-kimi-gemini.md) | 统一Provider执行、liveness、run预算和vendor矩阵有承接任务。 全接口/事件/错误/取消/选择策略未逐字段映射；live凭据及数小时后台通知不能外推完成。 |
| [foundation/09-observability-and-audit.md](../docs/design/foundation/09-observability-and-audit.md) | 部分承接 | [VS-10-observability-spine](slices/v3/VS-10-observability-spine.md)、[UA01-provider-execution-stream-unification · 小节](slices/UA01-provider-execution-stream-unification.md#10-b13-运行失败日志关联)、[AU07-trace-replay-integrity](slices/AU07-trace-replay-integrity.md) | 三源关联日志、失败链和回放解释有明确承接任务。 Metrics全集、Retention分级/删除、全审计事件生命周期尚未逐项挂接任务。 |
| [foundation/10-security-and-budget.md](../docs/design/foundation/10-security-and-budget.md) | 部分承接 | [B57-sec-injection-boundary](slices/B57-sec-injection-boundary.md)、[B58-human-approval-policy-unification](slices/B58-human-approval-policy-unification.md)、[B65-local-http-websocket-origin-boundary](slices/B65-local-http-websocket-origin-boundary.md)、[UA01-dynamic-agent-run-budget](slices/UA01-dynamic-agent-run-budget.md)、[B50-multi-agent-current-boundary](slices/B50-multi-agent-current-boundary.md) | 注入、批准、入口来源与run预算有任务，多Agent继承当前延期。 authority各scope、写限、父子/跨任务消耗与escalation全矩阵未逐条对应。 |
| [foundation/30-contract-glossary.md](../docs/design/foundation/30-contract-glossary.md) | 导航/约束/资产 | [B51-tech-stack-current-rebase](slices/B51-tech-stack-current-rebase.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | 命名/字段/状态词汇约束，B51核canonical引用，B45核实际契约。 术语存在不表示相应对象已实现；不将全词汇自动转成新字段任务。 |
| [foundation/README.md](../docs/design/foundation/README.md) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | 基础契约目录索引。 索引本身没有独立产品实现任务。 |

#### 质量设计（3 项）

| 设计来源 | 分类 | 对应任务或局部承接 | 范围与限制 |
|---|---|---|---|
| [quality/31-novel-quality-gates.md](../docs/design/quality/31-novel-quality-gates.md) | 部分承接 | [B56-quality-maintenance-gates](slices/B56-quality-maintenance-gates.md)、[P1-prose-quality-evidence-and-scoped-revision](slices/P1-prose-quality-evidence-and-scoped-revision.md)、[CA02-writing-facts-context](slices/CA02-writing-facts-context.md) | 正文质量/evaluator与四个阶段性延期门有明确承接任务。 跨章疲劳、全部门术语与validator目录、运行钩子未逐门核对；I10不由工程通过代签。 |
| [quality/32-human-approval-policy.md](../docs/design/quality/32-human-approval-policy.md) | 主要范围有承接 | [B58-human-approval-policy-unification](slices/B58-human-approval-policy-unification.md)、[AU04-AU06-author-action-binding](slices/AU04-AU06-author-action-binding.md) | B58明确承接批准语义、receipt/trace与风险矩阵，现有确认链由AU04-AU06维护。 先证明现有事实不足再加实体；新自动采纳策略并未因挂接任务而被接受。 |
| [quality/README.md](../docs/design/quality/README.md) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | 区分质量设计、运行体系、证据和长期处置台账的索引。 不是质量门功能实现或验收状态来源。 |

#### ADR（32 项）

| 设计来源 | 分类 | 对应任务或局部承接 | 范围与限制 |
|---|---|---|---|
| [adr/ADR-0001-dialogue-frame-v3.md](../docs/design/adr/ADR-0001-dialogue-frame-v3.md) | 主要范围有承接 | [2026-10-27-design-to-execution-reconciliation · 小节](2026-10-27-design-to-execution-reconciliation.md#b01-入口来源与语义边界)、[B26-single-call-judgment-protocol](slices/B26-single-call-judgment-protocol.md)、[B27-systematic-prompt-and-intent-integration](slices/B27-systematic-prompt-and-intent-integration.md)、[B43-gate-order-residual](slices/B43-gate-order-residual.md) | 普通回复来源、frame语义与真实绑定分别承接。 Accepted不表示新统一裁决及完整语义校验已实现。 |
| [adr/ADR-0002-micro-plan-v3.md](../docs/design/adr/ADR-0002-micro-plan-v3.md) | 主要范围有承接 | [2026-10-27-design-to-execution-reconciliation · 小节](2026-10-27-design-to-execution-reconciliation.md#b01-入口来源与语义边界)、[B43-gate-order-residual](slices/B43-gate-order-residual.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md)、[UA01-agentic-loop-prompt-hardening](slices/UA01-agentic-loop-prompt-hardening.md) | 逐步MicroPlan、绑定及旧primary语义由现行任务承接。 总体AgentPlan保留；旧字段清理须核消费者。 |
| [adr/ADR-0003-planner-authority-boundary.md](../docs/design/adr/ADR-0003-planner-authority-boundary.md) | 主要范围有承接 | [2026-10-27-design-to-execution-reconciliation · 小节](2026-10-27-design-to-execution-reconciliation.md#b01-入口来源与语义边界)、[B43-gate-order-residual](slices/B43-gate-order-residual.md) | Planner越权、registry与真实来源校验有完整承接。 未把关键词扫描或局部合法结构当完整语义证明。 |
| [adr/ADR-0004-orchestrator-decision-v3.md](../docs/design/adr/ADR-0004-orchestrator-decision-v3.md) | 主要范围有承接 | [B43-gate-order-residual](slices/B43-gate-order-residual.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | 所有回合统一裁决及trace/wire/回放同源由B43/B45承接。 R2=A；原trace-only偏差不是最终目标。 |
| [adr/ADR-0005-execution-gate-order-v3.md](../docs/design/adr/ADR-0005-execution-gate-order-v3.md) | 主要范围有承接 | [GATE-ORDER-CLOSURE-execution-gate-order-12](slices/GATE-ORDER-CLOSURE-execution-gate-order-12.md)、[B43-gate-order-residual](slices/B43-gate-order-residual.md) | 十二门已有原任务；幂等输入、行为/slot及blocked残余归B43。 无消费者的泛化policy规则不自动实施。 |
| [adr/ADR-0006-turn-phase-status-v3.md](../docs/design/adr/ADR-0006-turn-phase-status-v3.md) | 主要范围有承接 | [B13B-adr-enforcement-reconciliation](slices/B13B-adr-enforcement-reconciliation.md)、[B43-gate-order-residual](slices/B43-gate-order-residual.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | dialogue与failed_recoverable历史修复、现役状态映射有归属。 旧枚举兼容仍需B45逐项核对。 |
| [adr/ADR-0007-next-action-available-action-v3.md](../docs/design/adr/ADR-0007-next-action-available-action-v3.md) | 主要范围有承接 | [B43-gate-order-residual](slices/B43-gate-order-residual.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md)、[DS03-awaiting-author-runtime-validity-and-recovery-surface](slices/DS03-awaiting-author-runtime-validity-and-recovery-surface.md) | 现役动作、旧next_action退役兼容和恢复面分别承接。 不恢复无消费者的旧动作集。 |
| [adr/ADR-0008-behavior-state-v3.md](../docs/design/adr/ADR-0008-behavior-state-v3.md) | 主要范围有承接 | [BEHAVIOR-LIFECYCLE-DECISION-AUTHORITY](slices/BEHAVIOR-LIFECYCLE-DECISION-AUTHORITY.md)、[AU04-AU06-author-action-binding](slices/AU04-AU06-author-action-binding.md)、[B43-gate-order-residual](slices/B43-gate-order-residual.md) | supersede、终态历史及关闭裁决出口有承接。 VS-03关闭权偏差保留条件；新统一裁决须核对。 |
| [adr/ADR-0009-confirmation-binding-v3.md](../docs/design/adr/ADR-0009-confirmation-binding-v3.md) | 主要范围有承接 | [AU04-AU06-author-action-binding](slices/AU04-AU06-author-action-binding.md)、[BEHAVIOR-LIFECYCLE-DECISION-AUTHORITY](slices/BEHAVIOR-LIFECYCLE-DECISION-AUTHORITY.md)、[B43-gate-order-residual](slices/B43-gate-order-residual.md) | 确认绑定、幂等及真实open behavior复核有承接。 binding强一致的历史触发条件未被自动解除。 |
| [adr/ADR-0010-state-adoption-boundary-v3.md](../docs/design/adr/ADR-0010-state-adoption-boundary-v3.md) | 主要范围有承接 | [Q1CB-ADOPTION-TRANSITION-ENFORCEMENT](slices/Q1CB-ADOPTION-TRANSITION-ENFORCEMENT.md)、[B44-persistence-transition-boundary](slices/B44-persistence-transition-boundary.md)、[B46-persistent-adoption-inbox](slices/B46-persistent-adoption-inbox.md) | 采纳边界、失败回执、持久转换及待处理恢复有归属。 选择不等于采纳；新恢复能力仍待验收。 |
| [adr/ADR-0011-toolbox-registry-v3.md](../docs/design/adr/ADR-0011-toolbox-registry-v3.md) | 主要范围有承接 | [VS-02-tool-request-result-trace-loop](slices/v3/VS-02-tool-request-result-trace-loop.md)、[B13B-adr-enforcement-reconciliation](slices/B13B-adr-enforcement-reconciliation.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | registry生命周期与Tool契约治理有现役及历史承接任务。 deprecated旧登记与当前证据仍须沿原任务核对。 |
| [adr/ADR-0012-tool-request-result-v3.md](../docs/design/adr/ADR-0012-tool-request-result-v3.md) | 主要范围有承接 | [VS-02-tool-request-result-trace-loop](slices/v3/VS-02-tool-request-result-trace-loop.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | 请求/结果来源与R6分层输出校验由VS-02/B45承接。 opaque不免检；不制造不存在的请求对象。 |
| [adr/ADR-0013-decision-trace-v3.md](../docs/design/adr/ADR-0013-decision-trace-v3.md) | 主要范围有承接 | [VS-02-tool-request-result-trace-loop](slices/v3/VS-02-tool-request-result-trace-loop.md)、[B43-gate-order-residual](slices/B43-gate-order-residual.md)、[AU07-trace-replay-integrity · 小节](slices/AU07-trace-replay-integrity.md#p1-消费者与余项核对) | DecisionTrace链、统一裁决同源和深回放有归属。 文件归属不代表新旧全部trace矩阵已验证。 |
| [adr/ADR-0014-trace-redaction-v3.md](../docs/design/adr/ADR-0014-trace-redaction-v3.md) | 主要范围有承接 | [AU07-trace-replay-integrity](slices/AU07-trace-replay-integrity.md)、[AU10-file-level-closure · 小节](slices/AU10-file-level-closure.md#现役动作与卡片矩阵核对)、[SU01-api-key-secret-redaction](slices/SU01-api-key-secret-redaction.md) | 作者/开发者可见性与trace脱敏由回放及UI任务承接。 不同类型trace的P1矩阵仍开放。 |
| [adr/ADR-0015-turn-result-view-model-v3.md](../docs/design/adr/ADR-0015-turn-result-view-model-v3.md) | 主要范围有承接 | [DS01-decision-surface-schema-gate](slices/DS01-decision-surface-schema-gate.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md)、[AU10-file-level-closure · 小节](slices/AU10-file-level-closure.md#现役动作与卡片矩阵核对) | 现役TurnResult、决策面schema与前端动作消费有归属。 ViewModel是设计名；不新造同义envelope。 |
| [adr/ADR-0016-projection-hint-ui-v3.md](../docs/design/adr/ADR-0016-projection-hint-ui-v3.md) | 主要范围有承接 | [P1-chapter-adoption-reading](slices/P1-chapter-adoption-reading.md)、[AU08-file-level-closure · 小节](slices/AU08-file-level-closure.md#阅读投影状态与失败恢复补验)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | 采纳投影提示和阅读失败/恢复由已有任务承接。 域struct未接线是已记录偏差，不自动补空对象。 |
| [adr/ADR-0017-replay-report-v3.md](../docs/design/adr/ADR-0017-replay-report-v3.md) | 主要范围有承接 | [VS-06-trace-summary-replay-explanation](slices/v3/VS-06-trace-summary-replay-explanation.md)、[AU07-trace-replay-integrity · 小节](slices/AU07-trace-replay-integrity.md#p1-消费者与余项核对)、[B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md) | 结构回放、partial与求证观察增量已有原承接任务。 LLM辅助解释不默认开启；回放不重调模型。 |
| [adr/ADR-0018-business-log-schema-v3.md](../docs/design/adr/ADR-0018-business-log-schema-v3.md) | 主要范围有承接 | [B13B-adr-enforcement-reconciliation](slices/B13B-adr-enforcement-reconciliation.md)、[UA01-provider-execution-stream-unification · 小节](slices/UA01-provider-execution-stream-unification.md#10-b13-运行失败日志关联) | 日志噪声历史门禁及失败turn/三源关联有承接。 关联残余未由整场景噪声兜底关闭。 |
| [adr/ADR-0019-adoption-status-transition-v3.md](../docs/design/adr/ADR-0019-adoption-status-transition-v3.md) | 主要范围有承接 | [Q1CB-ADOPTION-TRANSITION-ENFORCEMENT](slices/Q1CB-ADOPTION-TRANSITION-ENFORCEMENT.md)、[B44-persistence-transition-boundary](slices/B44-persistence-transition-boundary.md) | 采纳七态转换和相邻仓储强制有明确任务。 复活/unarchive仍是条件项，不因矩阵许可自动开启。 |
| [adr/ADR-0020-prose-quality-finding-and-revision-candidate-boundary-v3.md](../docs/design/adr/ADR-0020-prose-quality-finding-and-revision-candidate-boundary-v3.md) | 主要范围有承接 | [P1-prose-quality-evidence-and-scoped-revision](slices/P1-prose-quality-evidence-and-scoped-revision.md)、[B36-localized-revision-algorithm](slices/B36-localized-revision-algorithm.md)、[VS00D-G-GAP-RECONCILIATION · 小节](slices/VS00D-G-GAP-RECONCILIATION.md#i10-人工盲评安排) | 质量发现、局部修订及人工文学评价分别有承接。 工程PASS不代签I10；人工评审按C08=B延期。 |
| [adr/ADR-0021-agent-run-and-turn-boundary-v3.md](../docs/design/adr/ADR-0021-agent-run-and-turn-boundary-v3.md) | 主要范围有承接 | [UA01-unified-agent-run-mainchain-closure](slices/UA01-unified-agent-run-mainchain-closure.md)、[UA01-CP5-durable-agent-run-resume](slices/UA01-CP5-durable-agent-run-resume.md)、[B31-author-reply-run-binding](slices/B31-author-reply-run-binding.md)、[B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md) | 有界/持久运行、作者输入绑定及求证扩展有归属。 运行时历史完成不代表后续所有profile均验收。 |
| [adr/ADR-0022-agentic-loop-plan-reasoning-authorship-v3.md](../docs/design/adr/ADR-0022-agentic-loop-plan-reasoning-authorship-v3.md) | 历史/被替代 | [B49-core-semantics-and-adr-review](slices/B49-core-semantics-and-adr-review.md)、[B43-gate-order-residual](slices/B43-gate-order-residual.md)、[UA01-agentic-loop-prompt-hardening](slices/UA01-agentic-loop-prompt-hardening.md) | 已被ADR-0031取代；有效逐步执行与N-NARR仍有承接。 保留历史正文；不得恢复旧两段式或旧primary要求。 |
| [adr/ADR-0023-agentic-loop-plan-driven-execution-v3.md](../docs/design/adr/ADR-0023-agentic-loop-plan-driven-execution-v3.md) | 主要范围有承接 | [UA01-agentic-loop-plan-driven-execution](slices/UA01-agentic-loop-plan-driven-execution.md)、[UA01-agentic-loop-prompt-hardening](slices/UA01-agentic-loop-prompt-hardening.md)、[B26-single-call-judgment-protocol](slices/B26-single-call-judgment-protocol.md)、[B40-judgment-era-acceptance-reanchor](slices/B40-judgment-era-acceptance-reanchor.md) | 计划机械游标、重规划及判断纪元验收由原任务承接。 旧调用计数是历史；按B26当前协议复核。 |
| [adr/ADR-0024-decision-surface-registry-v3.md](../docs/design/adr/ADR-0024-decision-surface-registry-v3.md) | 主要范围有承接 | [DS01-decision-surface-schema-gate](slices/DS01-decision-surface-schema-gate.md)、[DS03-awaiting-author-runtime-validity-and-recovery-surface](slices/DS03-awaiting-author-runtime-validity-and-recovery-surface.md)、[AU10-file-level-closure · 小节](slices/AU10-file-level-closure.md#现役动作与卡片矩阵核对)、[AU04-AU06-author-action-binding](slices/AU04-AU06-author-action-binding.md) | 决策面注册、schema、恢复和UI消费有明确承接任务。 S4、非预算等待及新卡型按原条件，不整包解锁。 |
| [adr/ADR-0025-judgment-driven-interactive-loop-v3.md](../docs/design/adr/ADR-0025-judgment-driven-interactive-loop-v3.md) | 主要范围有承接 | [UA01-judgment-driven-loop](slices/UA01-judgment-driven-loop.md)、[B26-single-call-judgment-protocol](slices/B26-single-call-judgment-protocol.md)、[B27-systematic-prompt-and-intent-integration](slices/B27-systematic-prompt-and-intent-integration.md)、[B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md) | 单调用交互、作者问题和内部求证有承接。 外部探索仍按原CP6网络授权与消费者触发。 |
| [adr/ADR-0026-five-ledgers-three-state-reconciliation-v3.md](../docs/design/adr/ADR-0026-five-ledgers-three-state-reconciliation-v3.md) | 主要范围有承接 | [VS-00F-five-ledgers-three-state](slices/VS-00F-five-ledgers-three-state.md)、[B67-revision-aware-ledger-maintenance](slices/B67-revision-aware-ledger-maintenance.md)、[VS00F-information-ledger](slices/VS00F-information-ledger.md) | 五账、信息账、维护trace/契约和修订重算已分责。 durable定期对账与Experience收编仍条件触发。 |
| [adr/ADR-0027-author-obligation-state-v3.md](../docs/design/adr/ADR-0027-author-obligation-state-v3.md) | 主要范围有承接 | [Q3D-message-outcome-roundtrip](slices/Q3D-message-outcome-roundtrip.md)、[Q3C-author-content-materialization](slices/Q3C-author-content-materialization.md)、[B26-single-call-judgment-protocol](slices/B26-single-call-judgment-protocol.md) | 输入记录、处置结果与跨轮作者来源已分配原任务。 不恢复未接受的第六账；索引旧未实施摘要不可作状态。 |
| [adr/ADR-0028-volume-structure-and-open-volume-action-v3.md](../docs/design/adr/ADR-0028-volume-structure-and-open-volume-action-v3.md) | 主要范围有承接 | [B11A-volume-blueprint](slices/B11A-volume-blueprint.md)、[R10R11-VOLUME-DEBT-SCENARIO](slices/R10R11-VOLUME-DEBT-SCENARIO.md)、[CA04-carry-gap-closure · 小节](slices/CA04-carry-gap-closure.md#7-b15-卷蓝图增量回归)、[VS-00F-five-ledgers-three-state](slices/VS-00F-five-ledgers-three-state.md) | 卷蓝图/开卷历史交付及携带回归、design_ref尾项有归属。 卷编辑及design_ref接线保留原条件。 |
| [adr/ADR-0029-prose-formatting-plan-v3.md](../docs/design/adr/ADR-0029-prose-formatting-plan-v3.md) | 主要范围有承接 | [B28-whole-chapter-revision](slices/B28-whole-chapter-revision.md) | 分段计划、确定性应用及整章修订由B28承接。 原生48项单批未重跑；stage修复须单独授权。 |
| [adr/ADR-0030-evidence-seeking-authoring-v3.md](../docs/design/adr/ADR-0030-evidence-seeking-authoring-v3.md) | 主要范围有承接 | [B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md)、[B42-model-behavior-evidence-tier](slices/B42-model-behavior-evidence-tier.md)、[VS00D-G-GAP-RECONCILIATION · 小节](slices/VS00D-G-GAP-RECONCILIATION.md#i10-人工盲评安排) | 求证产品、证据预注册和人工评价分别有承接任务。 设计接受不表示实现；CI与实模后果在CP矩阵保留。 |
| [adr/ADR-0031-core-chain-semantics-narrowing-v3.md](../docs/design/adr/ADR-0031-core-chain-semantics-narrowing-v3.md) | 主要范围有承接 | [B49-core-semantics-and-adr-review](slices/B49-core-semantics-and-adr-review.md)、[2026-10-27-design-to-execution-reconciliation · 小节](2026-10-27-design-to-execution-reconciliation.md#b01-入口来源与语义边界)、[B43-gate-order-residual](slices/B43-gate-order-residual.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | 语义接受与来源、统一裁决、输出/兼容执行明确分责。 R2=A保留；新行为尚待实现与真实页面证明。 |
| [adr/README.md](../docs/design/adr/README.md) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | ADR状态、冻结、索引与追溯规则入口。 索引不等于实现证明，无需另建产品slice。 |

#### Contract packs（21 项）

| 设计来源 | 分类 | 对应任务或局部承接 | 范围与限制 |
|---|---|---|---|
| [contracts/README.md](../docs/design/contracts/README.md) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | 契约目录、冻结前输入与实施入口索引。 条目摘要不是契约已实现或整包授权。 |
| [contracts/UA-01-unified-agent-run-loop-contract-pack.md](../docs/design/contracts/UA-01-unified-agent-run-loop-contract-pack.md) | 部分承接 | [UA01-unified-agent-run-mainchain-closure](slices/UA01-unified-agent-run-mainchain-closure.md)、[B26-single-call-judgment-protocol](slices/B26-single-call-judgment-protocol.md)、[B31-author-reply-run-binding](slices/B31-author-reply-run-binding.md)、[B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md)、[UA01-agentic-loop-prompt-hardening](slices/UA01-agentic-loop-prompt-hardening.md) | 运行、问题、绑定与求证均有承接任务。 长篇历史协议/全部profile断言未逐条核清现役映射。 |
| [contracts/VS-00-reply-only-contract-pack.md](../docs/design/contracts/VS-00-reply-only-contract-pack.md) | 主要范围有承接 | [VS-00-reply-only-dialogue-frame-turn-result-trace](slices/v3/VS-00-reply-only-dialogue-frame-turn-result-trace.md)、[2026-10-27-design-to-execution-reconciliation · 小节](2026-10-27-design-to-execution-reconciliation.md#b01-入口来源与语义边界)、[B43-gate-order-residual](slices/B43-gate-order-residual.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | 普通回复frame/trace与新增统一裁决有原承接。 旧draft字段须按ADR-0031/当前wire解释。 |
| [contracts/VS-00A-creative-exploration-contract-pack.md](../docs/design/contracts/VS-00A-creative-exploration-contract-pack.md) | 主要范围有承接 | [VS-00A-creative-exploration-loop](slices/v3/VS-00A-creative-exploration-loop.md)、[AU02-file-level-closure](slices/AU02-file-level-closure.md)、[B40-judgment-era-acceptance-reanchor · 小节](slices/B40-judgment-era-acceptance-reanchor.md#13-候选失败策略裁决材料) | 创意探索、方向候选及失败恢复有原承接任务。 不把方向探索等同作品求证；旧固定fallback已裁退役。 |
| [contracts/VS-00B-dialogue-context-grounding-contract-pack.md](../docs/design/contracts/VS-00B-dialogue-context-grounding-contract-pack.md) | 主要范围有承接 | [VS-00B-dialogue-context-grounding](slices/v3/VS-00B-dialogue-context-grounding.md)、[AU03-file-level-closure](slices/AU03-file-level-closure.md)、[B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md) | 对话上下文来源、缺失诚实与求证后续有归属。 原延后排序/打包由VS-00C体系承接。 |
| [contracts/VS-00C-creative-context-assembly-contract-pack.md](../docs/design/contracts/VS-00C-creative-context-assembly-contract-pack.md) | 部分承接 | [VS-00C-creative-context-assembly](slices/v3/VS-00C-creative-context-assembly.md)、[CA03-carry-selection-registry](slices/CA03-carry-selection-registry.md)、[B64-coordinate-aware-memory-consumption](slices/B64-coordinate-aware-memory-consumption.md)、[B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md) | 原组装、窗口修复及固定携带迁移已有承接任务。 全字段预算/省略策略与当前各flow尚未逐项核清。 |
| [contracts/VS-00D-ai-guided-authoring-contract-pack.md](../docs/design/contracts/VS-00D-ai-guided-authoring-contract-pack.md) | 部分承接 | [B26-single-call-judgment-protocol](slices/B26-single-call-judgment-protocol.md)、[B27-systematic-prompt-and-intent-integration](slices/B27-systematic-prompt-and-intent-integration.md)、[B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md) | 三层消息、全调用点语义与求证由现有主线承接。 G1–G7旧envelope表述与新语义尚未逐条闭合。 |
| [contracts/VS-00E-prose-execution-quality-contract-pack.md](../docs/design/contracts/VS-00E-prose-execution-quality-contract-pack.md) | 主要范围有承接 | [P1-prose-quality-evidence-and-scoped-revision](slices/P1-prose-quality-evidence-and-scoped-revision.md)、[B11C-scene-craft-completion](slices/B11C-scene-craft-completion.md)、[B11D-quality-field-granularity](slices/B11D-quality-field-granularity.md)、[WR01-chapter-mission-pre-writing-reasoning](slices/WR01-chapter-mission-pre-writing-reasoning.md)、[VS00D-G-GAP-RECONCILIATION · 小节](slices/VS00D-G-GAP-RECONCILIATION.md#i10-人工盲评安排) | 正文/质量/场级归因/使命与人工评价有分项任务。 多场替换等按B28/B36条件；文学收益未代签。 |
| [contracts/VS-00F-five-ledgers-three-state-contract-pack.md](../docs/design/contracts/VS-00F-five-ledgers-three-state-contract-pack.md) | 主要范围有承接 | [VS-00F-five-ledgers-three-state](slices/VS-00F-five-ledgers-three-state.md)、[B67-revision-aware-ledger-maintenance](slices/B67-revision-aware-ledger-maintenance.md)、[VS00F-information-ledger](slices/VS00F-information-ledger.md) | 五账、分账契约、StateTrace及修订后重算有承接任务。 R2、durable与Experience仍按原条件。 |
| [contracts/VS-00G-fact-completeness-and-provisioning-contract-pack.md](../docs/design/contracts/VS-00G-fact-completeness-and-provisioning-contract-pack.md) | 部分承接 | [VS-00G-fact-inventory-run](slices/VS-00G-fact-inventory-run.md)、[P1-prose-companion-artifacts](slices/P1-prose-companion-artifacts.md)、[B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md) | 盘点、暂定设定与求证富化有主承接。 works级假定/触发C等全部冻结条款未逐项映射完成。 |
| [contracts/VS-00H-system-identity-message-contract-pack.md](../docs/design/contracts/VS-00H-system-identity-message-contract-pack.md) | 主要范围有承接 | [UA01-agentic-loop-prompt-hardening](slices/UA01-agentic-loop-prompt-hardening.md)、[UA01-provider-execution-stream-unification](slices/UA01-provider-execution-stream-unification.md) | 系统身份唯一注入、provider适配与身份引用有承接。 developer显式身份展示依真实消费者。 |
| [contracts/VS-00I-prompt-prefix-stability-contract-pack.md](../docs/design/contracts/VS-00I-prompt-prefix-stability-contract-pack.md) | 主要范围有承接 | [UA01-agentic-loop-prompt-hardening](slices/UA01-agentic-loop-prompt-hardening.md)、[B26-single-call-judgment-protocol](slices/B26-single-call-judgment-protocol.md)、[UA01-provider-execution-stream-unification](slices/UA01-provider-execution-stream-unification.md) | 前缀、单调用迁移与逐vendor缓存增量有归属。 跨vendor实模需凭据/窗口，不能外推局部命中率。 |
| [contracts/VS-00J-volume-structure-and-blueprint-contract-pack.md](../docs/design/contracts/VS-00J-volume-structure-and-blueprint-contract-pack.md) | 主要范围有承接 | [B11A-volume-blueprint](slices/B11A-volume-blueprint.md)、[AU08-volume-structured-planning](slices/AU08-volume-structured-planning.md)、[CA04-carry-gap-closure · 小节](slices/CA04-carry-gap-closure.md#7-b15-卷蓝图增量回归)、[VS-00F-five-ledgers-three-state](slices/VS-00F-five-ledgers-three-state.md) | 卷容器、蓝图、开卷、携带与账面尾项有承接。 arc对象/卷编辑/记忆卷归属不在已关闭范围。 |
| [contracts/VS-00K-evidence-seeking-authoring-contract-pack.md](../docs/design/contracts/VS-00K-evidence-seeking-authoring-contract-pack.md) | 主要范围有承接 | [B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md)、[B42-model-behavior-evidence-tier](slices/B42-model-behavior-evidence-tier.md) | Base/观察/引用/恢复及证据/CI后果已映射CP。 产品未完成；字段全集与预算数值未预先冻结。 |
| [contracts/VS-01-execution-authority-contract-pack.md](../docs/design/contracts/VS-01-execution-authority-contract-pack.md) | 主要范围有承接 | [VS-01-micro-plan-downgrade-confirmation](slices/v3/VS-01-micro-plan-downgrade-confirmation.md)、[2026-10-27-design-to-execution-reconciliation · 小节](2026-10-27-design-to-execution-reconciliation.md#b01-入口来源与语义边界)、[B43-gate-order-residual](slices/B43-gate-order-residual.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | 执行建议、权限门与裁决真实链有原承接。 旧多步MicroPlan验收不能复活；保留历史兼容。 |
| [contracts/VS-02-tool-provenance-contract-pack.md](../docs/design/contracts/VS-02-tool-provenance-contract-pack.md) | 主要范围有承接 | [VS-02-tool-request-result-trace-loop](slices/v3/VS-02-tool-request-result-trace-loop.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md)、[AU07-trace-replay-integrity · 小节](slices/AU07-trace-replay-integrity.md#p1-消费者与余项核对) | 工具registry/请求结果契约与来源回放有承接任务。 只读输出校验仍待R6落实，opaque不免检。 |
| [contracts/VS-02A-tentative-creative-artifact-contract-pack.md](../docs/design/contracts/VS-02A-tentative-creative-artifact-contract-pack.md) | 主要范围有承接 | [VS-02A-tentative-creative-artifact](slices/v3/VS-02A-tentative-creative-artifact.md)、[P1-prose-companion-artifacts](slices/P1-prose-companion-artifacts.md)、[B28-whole-chapter-revision](slices/B28-whole-chapter-revision.md)、[B46-persistent-adoption-inbox](slices/B46-persistent-adoption-inbox.md) | 暂定产物、伴生产物、格式计划与持久待处理有承接。 不把未采纳内容当canon或把局部交付当全闭环。 |
| [contracts/VS-03-behavior-lifecycle-contract-pack.md](../docs/design/contracts/VS-03-behavior-lifecycle-contract-pack.md) | 部分承接 | [AU04-AU06-author-action-binding](slices/AU04-AU06-author-action-binding.md)、[BEHAVIOR-LIFECYCLE-DECISION-AUTHORITY](slices/BEHAVIOR-LIFECYCLE-DECISION-AUTHORITY.md)、[B43-gate-order-residual](slices/B43-gate-order-residual.md)、[DS03-awaiting-author-runtime-validity-and-recovery-surface](slices/DS03-awaiting-author-runtime-validity-and-recovery-surface.md) | 现役确认、关闭与恢复已有任务。 draft关闭权/强绑定偏差及S4尚需按触发核定。 |
| [contracts/VS-04-adoption-boundary-contract-pack.md](../docs/design/contracts/VS-04-adoption-boundary-contract-pack.md) | 主要范围有承接 | [VS-04-candidate-selection-adoption-boundary](slices/v3/VS-04-candidate-selection-adoption-boundary.md)、[Q1CB-ADOPTION-TRANSITION-ENFORCEMENT](slices/Q1CB-ADOPTION-TRANSITION-ENFORCEMENT.md)、[B46-persistent-adoption-inbox](slices/B46-persistent-adoption-inbox.md)、[B28-whole-chapter-revision](slices/B28-whole-chapter-revision.md) | 选择、采纳、转换、格式与跨会话恢复分责。 旧候选操作与新对象落位须按现役契约，不扩写canon。 |
| [contracts/VS-05-ui-roundtrip-contract-pack.md](../docs/design/contracts/VS-05-ui-roundtrip-contract-pack.md) | 主要范围有承接 | [DS01-decision-surface-schema-gate](slices/DS01-decision-surface-schema-gate.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md)、[AU10-file-level-closure · 小节](slices/AU10-file-level-closure.md#现役动作与卡片矩阵核对)、[AU04-AU06-author-action-binding](slices/AU04-AU06-author-action-binding.md) | 决策面、动作往返、卡片降级与脱敏有承接。 已退役卡型不恢复；完整矩阵仍待核验。 |
| [contracts/VS-06-replay-surface-contract-pack.md](../docs/design/contracts/VS-06-replay-surface-contract-pack.md) | 主要范围有承接 | [VS-06-trace-summary-replay-explanation](slices/v3/VS-06-trace-summary-replay-explanation.md)、[AU07-trace-replay-integrity · 小节](slices/AU07-trace-replay-integrity.md#p1-消费者与余项核对)、[B43-gate-order-residual](slices/B43-gate-order-residual.md)、[B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md) | 结构回放六问、权限与求证增量有承接任务。 不将LLM解释或当前目录补写为历史证据。 |

#### Schema 与索引（41 项）

| 设计来源 | 分类 | 对应任务或局部承接 | 范围与限制 |
|---|---|---|---|
| [schemas/README.md](../docs/design/schemas/README.md) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | schema/枚举索引及codegen真源规则入口。 不需要逐索引新建开发任务；索引非运行证明。 |
| [schemas/foundation/README.md](../docs/design/schemas/foundation/README.md) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | schema/枚举索引及codegen真源规则入口。 不需要逐索引新建开发任务；索引非运行证明。 |
| [schemas/foundation/artifact_adoption_entry.json](../docs/design/schemas/foundation/artifact_adoption_entry.json) | 主要范围有承接 | [DS02-adoption-status-canonicalization](slices/DS02-adoption-status-canonicalization.md)、[Q1CB-ADOPTION-TRANSITION-ENFORCEMENT](slices/Q1CB-ADOPTION-TRANSITION-ENFORCEMENT.md)、[B46-persistent-adoption-inbox](slices/B46-persistent-adoption-inbox.md) | 采纳条目与七态转换、待处理恢复有任务承接。 现役历史读取还需随消费者验证。 |
| [schemas/foundation/author_choice_action.json](../docs/design/schemas/foundation/author_choice_action.json) | 主要范围有承接 | [B26-single-call-judgment-protocol](slices/B26-single-call-judgment-protocol.md)、[B31-author-reply-run-binding](slices/B31-author-reply-run-binding.md) | 明确问题选项/自由回复源动作由B26/B31承接。 问题有效性与持久恢复须连同运行权限核验。 |
| [schemas/foundation/candidate_direction.json](../docs/design/schemas/foundation/candidate_direction.json) | 主要范围有承接 | [AU02-candidate-schema-codegen](slices/AU02-candidate-schema-codegen.md)、[B26-single-call-judgment-protocol](slices/B26-single-call-judgment-protocol.md)、[AU10-file-level-closure · 小节](slices/AU10-file-level-closure.md#现役动作与卡片矩阵核对) | 候选方向生成/组合校验与UI消费有承接。 方向not_adopted不等于artifact采纳七态。 |
| [schemas/foundation/enums/README.md](../docs/design/schemas/foundation/enums/README.md) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | schema/枚举索引及codegen真源规则入口。 不需要逐索引新建开发任务；索引非运行证明。 |
| [schemas/foundation/enums/adoption_status.json](../docs/design/schemas/foundation/enums/adoption_status.json) | 主要范围有承接 | [DS02-adoption-status-canonicalization](slices/DS02-adoption-status-canonicalization.md)、[Q1CB-ADOPTION-TRANSITION-ENFORCEMENT](slices/Q1CB-ADOPTION-TRANSITION-ENFORCEMENT.md)、[B44-persistence-transition-boundary](slices/B44-persistence-transition-boundary.md) | 七态canonical及转换仓储强制有原任务。 复活仍按触发，不因枚举存在自动执行。 |
| [schemas/foundation/enums/agent_type.json](../docs/design/schemas/foundation/enums/agent_type.json) | 部分承接 | [B50-multi-agent-current-boundary](slices/B50-multi-agent-current-boundary.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | 角色分类有延期裁决与现役/历史审计承接任务。 各枚举到当前运行profile的完整映射未核清。 |
| [schemas/foundation/enums/arc_ledger_status.json](../docs/design/schemas/foundation/enums/arc_ledger_status.json) | 主要范围有承接 | [VS-00F-five-ledgers-three-state](slices/VS-00F-five-ledgers-three-state.md)、[B67-revision-aware-ledger-maintenance](slices/B67-revision-aware-ledger-maintenance.md) | 弧光机械状态/作者裁决及修订重算有承接任务。 不得因重算撤销作者终态。 |
| [schemas/foundation/enums/behavior_status.json](../docs/design/schemas/foundation/enums/behavior_status.json) | 主要范围有承接 | [BEHAVIOR-LIFECYCLE-DECISION-AUTHORITY](slices/BEHAVIOR-LIFECYCLE-DECISION-AUTHORITY.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md)、[AU04-AU06-author-action-binding](slices/AU04-AU06-author-action-binding.md) | 行为现役值、终态历史和枚举漂移有承接。 旧集合缺现役状态，需兼容核对。 |
| [schemas/foundation/enums/chapter_mission_status.json](../docs/design/schemas/foundation/enums/chapter_mission_status.json) | 主要范围有承接 | [WR01b-chapter-mission-author-decision](slices/WR01b-chapter-mission-author-decision.md)、[WR01c-mission-why-brief-and-planning-decision](slices/WR01c-mission-why-brief-and-planning-decision.md)、[B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md) | 使命暂定/确认/编辑及求证消费有承接任务。 作者确认版不可被新推理静默覆盖。 |
| [schemas/foundation/enums/defaultability.json](../docs/design/schemas/foundation/enums/defaultability.json) | 部分承接 | [B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md)、[B43-gate-order-residual](slices/B43-gate-order-residual.md) | 槽位默认性现役/历史归属与门后slot余项有承接任务。 每种默认来源与实际消费者未逐值核清。 |
| [schemas/foundation/enums/inferability.json](../docs/design/schemas/foundation/enums/inferability.json) | 部分承接 | [B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md)、[2026-10-27-design-to-execution-reconciliation · 小节](2026-10-27-design-to-execution-reconciliation.md#b01-入口来源与语义边界) | 旧槽位推断元数据与现役语义边界有承接。 原Router前提与当前模型输出对应尚未逐值核定。 |
| [schemas/foundation/enums/information_ledger_status.json](../docs/design/schemas/foundation/enums/information_ledger_status.json) | 主要范围有承接 | [VS00F-information-ledger](slices/VS00F-information-ledger.md)、[B67-revision-aware-ledger-maintenance](slices/B67-revision-aware-ledger-maintenance.md) | 信息揭示/回收作者采纳与修订后来源有承接任务。 不将机械观察当人物知情或自动语义回收。 |
| [schemas/foundation/enums/ledger.json](../docs/design/schemas/foundation/enums/ledger.json) | 主要范围有承接 | [VS-00F-five-ledgers-three-state](slices/VS-00F-five-ledgers-three-state.md) | 五账分类与分账契约checkpoint有明确归属。 分类存在不表示每账完整运行校验已闭合。 |
| [schemas/foundation/enums/memory_class.json](../docs/design/schemas/foundation/enums/memory_class.json) | 部分承接 | [AU09-memory-taxonomy-write-policy](slices/AU09-memory-taxonomy-write-policy.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | 现役记忆写入分类及旧枚举审计有承接任务。 四类Foundation语义与小说记忆映射未逐条核清。 |
| [schemas/foundation/enums/memory_scope.json](../docs/design/schemas/foundation/enums/memory_scope.json) | 部分承接 | [AU09-AU03-session-memory-layering](slices/AU09-AU03-session-memory-layering.md)、[B64-coordinate-aware-memory-consumption](slices/B64-coordinate-aware-memory-consumption.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | work/session分层和目标窗口有承接。 GLOBAL/VOLUME/ARC等完整读写生命周期未逐项分配。 |
| [schemas/foundation/enums/memory_source_type.json](../docs/design/schemas/foundation/enums/memory_source_type.json) | 部分承接 | [AU09-memory-taxonomy-write-policy](slices/AU09-memory-taxonomy-write-policy.md)、[Q3C-author-content-materialization](slices/Q3C-author-content-materialization.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | 作者/模型来源写入与规范归属有承接。 导入等全部来源分支与权威优先级未逐类核清。 |
| [schemas/foundation/enums/memory_status.json](../docs/design/schemas/foundation/enums/memory_status.json) | 主要范围有承接 | [AU09-memory-taxonomy-write-policy](slices/AU09-memory-taxonomy-write-policy.md)、[Q1C-adopted-content-revision](slices/Q1C-adopted-content-revision.md)、[B64-coordinate-aware-memory-consumption](slices/B64-coordinate-aware-memory-consumption.md) | 确认/失效/替代与当前召回过滤有原承接任务。 记忆状态不同于artifact采纳矩阵。 |
| [schemas/foundation/enums/memory_type.json](../docs/design/schemas/foundation/enums/memory_type.json) | 部分承接 | [AU09-memory-taxonomy-write-policy](slices/AU09-memory-taxonomy-write-policy.md)、[AU09-work-direction-memory-recall](slices/AU09-work-direction-memory-recall.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | 当前写入分类及创作方向待定类型有承接任务。 全部十一类的具体生成/治理消费者未逐类覆盖证明。 |
| [schemas/foundation/enums/mutation_status.json](../docs/design/schemas/foundation/enums/mutation_status.json) | 部分承接 | [B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md)、[B44-persistence-transition-boundary](slices/B44-persistence-transition-boundary.md) | 旧Mutation枚举归属与现役持久边界可审计。 通用Mutation六阶段是否仍有完整消费者未核定。 |
| [schemas/foundation/enums/narrative_role.json](../docs/design/schemas/foundation/enums/narrative_role.json) | 主要范围有承接 | [AU09-character-role-taxonomy-protagonist-policy](slices/AU09-character-role-taxonomy-protagonist-policy.md)、[B29-existing-character-role-revision](slices/B29-existing-character-role-revision.md)、[B48-character-revision-noop-and-ambiguity](slices/B48-character-revision-noop-and-ambiguity.md) | 角色叙事身份、修订与no-op/歧义有承接任务。 主角缺失不得默认首人；新变化仍须采纳。 |
| [schemas/foundation/enums/next_action.json](../docs/design/schemas/foundation/enums/next_action.json) | 主要范围有承接 | [B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md)、[B43-gate-order-residual](slices/B43-gate-order-residual.md)、[DS03-awaiting-author-runtime-validity-and-recovery-surface](slices/DS03-awaiting-author-runtime-validity-and-recovery-surface.md) | 旧next_action退役/兼容与现役恢复动作有承接。 不存在的旧按钮不因枚举被恢复。 |
| [schemas/foundation/enums/provisional_source.json](../docs/design/schemas/foundation/enums/provisional_source.json) | 主要范围有承接 | [VS-00G-fact-inventory-run](slices/VS-00G-fact-inventory-run.md) | 暂用AI假定来源与生命周期由VS-00G承接。 works级假定及触发C未由此枚举自动实现。 |
| [schemas/foundation/enums/requiredness.json](../docs/design/schemas/foundation/enums/requiredness.json) | 部分承接 | [B43-gate-order-residual](slices/B43-gate-order-residual.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | 必需/可选slot边界由Gate残余与schema审计承接。 所有现役槽位和缺失策略尚未逐项映射。 |
| [schemas/foundation/enums/retention_tier.json](../docs/design/schemas/foundation/enums/retention_tier.json) | 部分承接 | [AU09-AU03-session-memory-layering](slices/AU09-AU03-session-memory-layering.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | 会话/作品记忆分层及旧枚举归属有承接任务。 hot/warm/cold完整迁移/保留生命周期未逐层核清。 |
| [schemas/foundation/enums/scope_dependency.json](../docs/design/schemas/foundation/enums/scope_dependency.json) | 部分承接 | [B43-gate-order-residual](slices/B43-gate-order-residual.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | 槽位依赖范围的门禁/契约归属有审计入口。 十种范围的实际消费者及无消费者值未逐项判定。 |
| [schemas/foundation/enums/slot_type.json](../docs/design/schemas/foundation/enums/slot_type.json) | 部分承接 | [B43-gate-order-residual](slices/B43-gate-order-residual.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | slot结构约束与现役/历史schema有承接。 九种类型与当前所有入口的语义覆盖尚未核清。 |
| [schemas/foundation/enums/source_type.json](../docs/design/schemas/foundation/enums/source_type.json) | 部分承接 | [Q3D-message-outcome-roundtrip](slices/Q3D-message-outcome-roundtrip.md)、[AU09-memory-trace-roundtrip](slices/AU09-memory-trace-roundtrip.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | 消息/记忆来源及trace存在原任务。 与memory_source_type两套词表的用途差异未逐项闭合。 |
| [schemas/foundation/enums/status.json](../docs/design/schemas/foundation/enums/status.json) | 主要范围有承接 | [B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md)、[B13B-adr-enforcement-reconciliation](slices/B13B-adr-enforcement-reconciliation.md) | 旧通用Status与现役小写wire映射有承接。 不把历史大写族强套当前TurnResult。 |
| [schemas/foundation/enums/structure_status.json](../docs/design/schemas/foundation/enums/structure_status.json) | 主要范围有承接 | [B30-chapter-structure-maintenance](slices/B30-chapter-structure-maintenance.md)、[B11A-volume-blueprint](slices/B11A-volume-blueprint.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | 卷章结构维护和旧枚举兼容有承接任务。 场级完整结构能力不能由此枚举外推。 |
| [schemas/foundation/enums/task_phase.json](../docs/design/schemas/foundation/enums/task_phase.json) | 主要范围有承接 | [AU10-workbench-recovery-taskstate](slices/AU10-workbench-recovery-taskstate.md)、[UA01-CP5-durable-agent-run-resume](slices/UA01-CP5-durable-agent-run-resume.md)、[B52-longrun-batch-draft](slices/B52-longrun-batch-draft.md) | 任务生命周期、FAILED补验及长跑延期有归属。 批量真实生产仍按B52触发，不给桩追加无消费者能力。 |
| [schemas/foundation/enums/turn_phase.json](../docs/design/schemas/foundation/enums/turn_phase.json) | 主要范围有承接 | [B43-gate-order-residual](slices/B43-gate-order-residual.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md)、[B13B-adr-enforcement-reconciliation](slices/B13B-adr-enforcement-reconciliation.md) | 现役turn状态与旧枚举血缘有任务承接。 旧phase族不得混同当前运行状态。 |
| [schemas/foundation/enums/volume_blueprint_status.json](../docs/design/schemas/foundation/enums/volume_blueprint_status.json) | 主要范围有承接 | [B11A-volume-blueprint](slices/B11A-volume-blueprint.md)、[CA04-carry-gap-closure · 小节](slices/CA04-carry-gap-closure.md#7-b15-卷蓝图增量回归) | 卷蓝图裁决状态与增量消费回归有承接任务。 作者手编留位不等于编辑/重排入口已开放。 |
| [schemas/foundation/ledger_entry.json](../docs/design/schemas/foundation/ledger_entry.json) | 主要范围有承接 | [VS-00F-five-ledgers-three-state · 小节](slices/VS-00F-five-ledgers-three-state.md#b06-分账契约与真实消费-checkpoint)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md)、[B67-revision-aware-ledger-maintenance](slices/B67-revision-aware-ledger-maintenance.md) | 分账契约、真实DTO与修订来源正确性有明确承接任务。 当前status/payload宽泛，不能直接强套领域信封。 |
| [schemas/foundation/ledger_information_payload.json](../docs/design/schemas/foundation/ledger_information_payload.json) | 主要范围有承接 | [VS00F-information-ledger](slices/VS00F-information-ledger.md)、[VS-00F-five-ledgers-three-state](slices/VS-00F-five-ledgers-three-state.md)、[B67-revision-aware-ledger-maintenance](slices/B67-revision-aware-ledger-maintenance.md) | 信息账计划/伏笔载荷与修订来源由原任务承接。 人物知情字段刻意留空，不按形式完整性自动补造。 |
| [schemas/foundation/phase_next_action_compat.json](../docs/design/schemas/foundation/phase_next_action_compat.json) | 主要范围有承接 | [B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md)、[B43-gate-order-residual](slices/B43-gate-order-residual.md) | 旧phase/next_action兼容矩阵由现役/历史治理承接。 实际消费者未逐条复验；不得恢复旧规范。 |
| [schemas/foundation/turn_result_v2.json](../docs/design/schemas/foundation/turn_result_v2.json) | 历史/被替代 | [B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md)、[DS01-decision-surface-schema-gate](slices/DS01-decision-surface-schema-gate.md) | 明确为v2历史冻结，当前v3及兼容处置有承接任务。 保留历史读取；缺ref不能当现役完整校验。 |
| [schemas/foundation/turn_result_v3.json](../docs/design/schemas/foundation/turn_result_v3.json) | 主要范围有承接 | [DS01-decision-surface-schema-gate](slices/DS01-decision-surface-schema-gate.md)、[B26-single-call-judgment-protocol](slices/B26-single-call-judgment-protocol.md)、[B43-gate-order-residual](slices/B43-gate-order-residual.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | 现役wire、作者问题与统一裁决/兼容均有承接。 局部开放性是现行契约，不自动全面封闭。 |
| [schemas/foundation/ui_card.json](../docs/design/schemas/foundation/ui_card.json) | 主要范围有承接 | [DS01-decision-surface-schema-gate](slices/DS01-decision-surface-schema-gate.md)、[AU10-file-level-closure · 小节](slices/AU10-file-level-closure.md#现役动作与卡片矩阵核对)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md) | 三类现役信息卡、禁actions及降级消费有承接任务。 新增卡型须走契约；不恢复旧十卡集合。 |
| [schemas/foundation/user_message_submission.json](../docs/design/schemas/foundation/user_message_submission.json) | 主要范围有承接 | [Q3D-message-outcome-roundtrip](slices/Q3D-message-outcome-roundtrip.md)、[B26-single-call-judgment-protocol](slices/B26-single-call-judgment-protocol.md)、[B31-author-reply-run-binding](slices/B31-author-reply-run-binding.md) | 不可变作者投递、结果回填与重传绑定有承接。 原话/作用域/版本的端到端证明仍按原任务。 |

#### 验收设计（24 项）

| 设计来源 | 分类 | 对应任务或局部承接 | 范围与限制 |
|---|---|---|---|
| [acceptance/README.md](../docs/design/acceptance/README.md) | 导航/约束/资产 | [2026-10-27-design-to-execution-reconciliation](2026-10-27-design-to-execution-reconciliation.md)、[B40-judgment-era-acceptance-reanchor](slices/B40-judgment-era-acceptance-reanchor.md)、[B41-quality-evidence-foundation](slices/B41-quality-evidence-foundation.md) | AU/SU/E2E验收索引与覆盖导航，证据规则由B40/B41维护。 旧覆盖率和历史artifact不代表当前HEAD通过。 |
| [acceptance/SCENARIO-BLUEPRINT.md](../docs/design/acceptance/SCENARIO-BLUEPRINT.md) | 导航/约束/资产 | [2026-10-27-design-to-execution-reconciliation](2026-10-27-design-to-execution-reconciliation.md)、[B40-judgment-era-acceptance-reanchor](slices/B40-judgment-era-acceptance-reanchor.md)、[B41-quality-evidence-foundation](slices/B41-quality-evidence-foundation.md) | 跨旅程场景地图与验收模板；具体任务从AU/SU/E2E原承接任务恢复。 不是执行状态真源，本轮未逐条证明蓝图所有场景成立。 |
| [acceptance/author/AU-01-chat.md](../docs/design/acceptance/author/AU-01-chat.md) | 主要范围有承接 | [AU01-file-level-closure](slices/AU01-file-level-closure.md)、[B43-gate-order-residual](slices/B43-gate-order-residual.md)、[AU07-trace-replay-integrity](slices/AU07-trace-replay-integrity.md)、[AU10-file-level-closure](slices/AU10-file-level-closure.md) | 普通对话、无副作用、回放及恢复有原closure与后续承接任务。 普通回复统一裁决仍在B43；历史聊天PASS不证明新增裁决已接线。 |
| [acceptance/author/AU-02-explore.md](../docs/design/acceptance/author/AU-02-explore.md) | 主要范围有承接 | [AU02-file-level-closure](slices/AU02-file-level-closure.md)、[B40-judgment-era-acceptance-reanchor · 小节](slices/B40-judgment-era-acceptance-reanchor.md#13-候选失败策略裁决材料)、[B27-systematic-prompt-and-intent-integration](slices/B27-systematic-prompt-and-intent-integration.md) | 自然探索、候选互动与失败策略由AU02/B27及C06承接。 旧APP补候选PASS已不代表现行目标；C06退役与替代覆盖尚需落实。 |
| [acceptance/author/AU-03-context.md](../docs/design/acceptance/author/AU-03-context.md) | 主要范围有承接 | [AU03-file-level-closure](slices/AU03-file-level-closure.md)、[B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md)、[B64-coordinate-aware-memory-consumption](slices/B64-coordinate-aware-memory-consumption.md)、[AU07-trace-replay-integrity](slices/AU07-trace-replay-integrity.md) | 上下文、历史会话、搜索定位、缺失/失败及求证分别有原承接任务。 长会话摘要与P2矩阵保持原范围；owned不代表每个上下文场景已补验。 |
| [acceptance/author/AU-04-execute-and-confirm.md](../docs/design/acceptance/author/AU-04-execute-and-confirm.md) | 主要范围有承接 | [AU04-AU06-author-action-binding](slices/AU04-AU06-author-action-binding.md)、[B43-gate-order-residual](slices/B43-gate-order-residual.md)、[B58-human-approval-policy-unification](slices/B58-human-approval-policy-unification.md) | 确认绑定、re-gate、幂等与批准策略已有原任务。 当前确认producer须先核定，旧高风险示例不能直接恢复为现役契约。 |
| [acceptance/author/AU-05-artifact-adoption.md](../docs/design/acceptance/author/AU-05-artifact-adoption.md) | 主要范围有承接 | [AU05-file-level-closure](slices/AU05-file-level-closure.md)、[B46-persistent-adoption-inbox](slices/B46-persistent-adoption-inbox.md)、[B47-canon-freshness-and-conflict-detection](slices/B47-canon-freshness-and-conflict-detection.md)、[Q1C-adopted-content-revision](slices/Q1C-adopted-content-revision.md)、[AU08-file-level-closure](slices/AU08-file-level-closure.md) | 采纳、持久待处理、过期冲突、修订与投影余项均有承接。 历史15/18等只代表当时场景口径，C07持久层及原生补验仍未完成。 |
| [acceptance/author/AU-06-behavior-lifecycle.md](../docs/design/acceptance/author/AU-06-behavior-lifecycle.md) | 主要范围有承接 | [AU04-AU06-author-action-binding](slices/AU04-AU06-author-action-binding.md)、[DS03-awaiting-author-runtime-validity-and-recovery-surface](slices/DS03-awaiting-author-runtime-validity-and-recovery-surface.md)、[B26-single-call-judgment-protocol](slices/B26-single-call-judgment-protocol.md)、[AU07-trace-replay-integrity](slices/AU07-trace-replay-integrity.md) | 行为停等/回复、确认终态及回放由原任务分责。 S4显式clarification和非预算await仍按原触发；没有批量复活旧behavior形态。 |
| [acceptance/author/AU-07-trace-and-replay.md](../docs/design/acceptance/author/AU-07-trace-and-replay.md) | 主要范围有承接 | [AU07-trace-replay-integrity · 小节](slices/AU07-trace-replay-integrity.md#p1-消费者与余项核对)、[B43-gate-order-residual](slices/B43-gate-order-residual.md)、[B59-agent-run-step-trace-persistence](slices/B59-agent-run-step-trace-persistence.md)、[VS-00F-five-ledgers-three-state](slices/VS-00F-five-ledgers-three-state.md) | 多类型/双视图回放、统一裁决、step与维护StateTrace有明确承接任务。 查询/partial已验与完整开发者UI分开，历史旧turn证据不代表新producer完成。 |
| [acceptance/author/AU-08-reading-mode.md](../docs/design/acceptance/author/AU-08-reading-mode.md) | 主要范围有承接 | [AU08-file-level-closure · 小节](slices/AU08-file-level-closure.md#阅读投影状态与失败恢复补验)、[AU08-reading-return-context](slices/AU08-reading-return-context.md)、[P1-chapter-adoption-reading](slices/P1-chapter-adoption-reading.md)、[P1-word-count-audit](slices/P1-word-count-audit.md) | 阅读只读与返回、投影失败恢复、字数审计均有原任务。 四态已有消费不等于FAILED/REBUILDING/离线矩阵全验，Tentative预览仍条件化。 |
| [acceptance/author/AU-09-story-memory.md](../docs/design/acceptance/author/AU-09-story-memory.md) | 主要范围有承接 | [AU09-file-level-closure](slices/AU09-file-level-closure.md)、[AU09-work-direction-memory-recall](slices/AU09-work-direction-memory-recall.md)、[B64-coordinate-aware-memory-consumption](slices/B64-coordinate-aware-memory-consumption.md)、[AU07-trace-replay-integrity](slices/AU07-trace-replay-integrity.md) | 记忆治理、方向物化、坐标召回与来源解释均有承接任务。 方向类型/写入契约及坐标消费未完成，旧终态排除测试不覆盖新增语义。 |
| [acceptance/author/AU-10-workbench-ui.md](../docs/design/acceptance/author/AU-10-workbench-ui.md) | 主要范围有承接 | [AU10-file-level-closure](slices/AU10-file-level-closure.md)、[AU10-workbench-recovery-taskstate](slices/AU10-workbench-recovery-taskstate.md)、[DS03-awaiting-author-runtime-validity-and-recovery-surface](slices/DS03-awaiting-author-runtime-validity-and-recovery-surface.md)、[B52-longrun-batch-draft](slices/B52-longrun-batch-draft.md) | 工作台实时状态、FAILED/action深矩阵及运行恢复有原承接任务。 LongRunner完整消费者仍条件触发；布局/成功task_state历史通过不等于全部状态完成。 |
| [acceptance/author/AU-11-ai-guided-authoring.md](../docs/design/acceptance/author/AU-11-ai-guided-authoring.md) | 部分承接 | [B27-systematic-prompt-and-intent-integration](slices/B27-systematic-prompt-and-intent-integration.md)、[B40-judgment-era-acceptance-reanchor](slices/B40-judgment-era-acceptance-reanchor.md)、[B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md) | 现役引导语义、旧验收重锚与求证有承接任务。 旧guidance_mode schema、clarify/confirm proof和envelope条款尚未逐项对齐保留/退役，不能以B40场景PASS代签整文。 |
| [acceptance/author/AU-12-work-profile.md](../docs/design/acceptance/author/AU-12-work-profile.md) | 主要范围有承接 | [AU12-file-level-closure](slices/AU12-file-level-closure.md)、[AU12-correction-intent-roundtrip](slices/AU12-correction-intent-roundtrip.md)、[AU12-character-identity-merge](slices/AU12-character-identity-merge.md)、[AU12-profile-read-failure-degrade](slices/AU12-profile-read-failure-degrade.md) | 档案读取/隔离/失败、修订采纳回写和角色归并有原任务。 完整8模块与更丰富立项要素仍为原P2；本轮未证明同轮模型所有字段消费。 |
| [acceptance/author/AU-13-ledgers-and-reconciliation.md](../docs/design/acceptance/author/AU-13-ledgers-and-reconciliation.md) | 部分承接 | [VS-00F-five-ledgers-three-state](slices/VS-00F-five-ledgers-three-state.md)、[B67-revision-aware-ledger-maintenance](slices/B67-revision-aware-ledger-maintenance.md)、[VS-00G-fact-inventory-run](slices/VS-00G-fact-inventory-run.md) | 五账、修订后账面一致性和设定负债有主题承接任务。 D1体量finding→补体量→规划→不再误终局的独立完整checkpoint在原任务中未核到；对账转交不等于已规划齐全。 |
| [acceptance/author/AU-14-provisioning-and-assumptions.md](../docs/design/acceptance/author/AU-14-provisioning-and-assumptions.md) | 主要范围有承接 | [VS-00G-fact-inventory-run](slices/VS-00G-fact-inventory-run.md)、[B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md)、[AU12-correction-intent-roundtrip](slices/AU12-correction-intent-roundtrip.md) | 盘点/暂定设定及CP5e、触发C、works假定和知识消费沿原承接任务。 触发C、works对象定形与记忆富化未完成；旧4场景PASS不代表全部对象/触发闭环。 |
| [acceptance/author/AU-15-evidence-seeking-authoring.md](../docs/design/acceptance/author/AU-15-evidence-seeking-authoring.md) | 主要范围有承接 | [B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md)、[B42-model-behavior-evidence-tier](slices/B42-model-behavior-evidence-tier.md) | A0–D1矩阵由B39完整CP与B42实模证据分层承接。 Accepted仅为实施基线；产品/driver、预注册、资源与实模运行仍未闭环。 |
| [acceptance/author/README.md](../docs/design/acceptance/author/README.md) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | 作者验收文件导航。 具体范围按每份AU记录，不把索引当全量通过。 |
| [acceptance/e2e/E2E-01-full-chain.md](../docs/design/acceptance/e2e/E2E-01-full-chain.md) | 主要范围有承接 | [E2E01-file-level-closure](slices/E2E01-file-level-closure.md)、[B41-quality-evidence-foundation](slices/B41-quality-evidence-foundation.md)、[B40-judgment-era-acceptance-reanchor](slices/B40-judgment-era-acceptance-reanchor.md)、[B63-known-gaps-remediation](slices/B63-known-gaps-remediation.md) | 全链路场景、聚合证据真实性、旧入口重锚和E10持久证据有承接任务。 E10已证不保证整条aggregate在当前HEAD通过；旧多步/降级场景不自动恢复。 |
| [acceptance/e2e/README.md](../docs/design/acceptance/e2e/README.md) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | 端到端验收文档导航。 独立运行场景和聚合结果必须分别读取。 |
| [acceptance/system/README.md](../docs/design/acceptance/system/README.md) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | 系统用户验收导航。 具体设置/作品/显示名范围按SU原任务，不要求索引单建slice。 |
| [acceptance/system/SU-01-model-provider.md](../docs/design/acceptance/system/SU-01-model-provider.md) | 主要范围有承接 | [SU01-file-level-closure](slices/SU01-file-level-closure.md)、[SU01-provider-vendor-matrix-openai-minimax-zhipu-kimi-gemini](slices/SU01-provider-vendor-matrix-openai-minimax-zhipu-kimi-gemini.md)、[SU01-api-key-secret-redaction](slices/SU01-api-key-secret-redaction.md)、[SU01-strata-local-provider](slices/SU01-strata-local-provider.md)、[D6-purpose-model-routing](slices/D6-purpose-model-routing.md) | 设置、provider矩阵、密钥、Strata及用途路由有原任务和条件登记。 真实OAuth/订阅传输、vendor和跨平台仍有条件；local-file已接受，不重开Keychain方案。 |
| [acceptance/system/SU-02-work-switching.md](../docs/design/acceptance/system/SU-02-work-switching.md) | 主要范围有承接 | [SU02-file-level-closure](slices/SU02-file-level-closure.md)、[SU02-work-lifecycle-management](slices/SU02-work-lifecycle-management.md)、[SU02-work-restart-recovery](slices/SU02-work-restart-recovery.md)、[SU02-artifact-projection-trace-isolation](slices/SU02-artifact-projection-trace-isolation.md) | 作品切换/生命周期/恢复/隔离及P2异常有原承接任务。 恢复归档、大列表、损坏数据和OS偏好矩阵仍按原P2，13/13不外推这些后果。 |
| [acceptance/system/SU-03-model-nickname.md](../docs/design/acceptance/system/SU-03-model-nickname.md) | 主要范围有承接 | [SU03-file-level-closure](slices/SU03-file-level-closure.md)、[SU03-assistant-display-name-boundary](slices/SU03-assistant-display-name-boundary.md) | 显示名持久化、作品隔离和不进模型协议有原任务。 未来新增assistant展示面须继续复用边界；未复跑当前HEAD页面。 |

#### UI 与源原型（17 项）

| 设计来源 | 分类 | 对应任务或局部承接 | 范围与限制 |
|---|---|---|---|
| [ui/40-ui-overview.md](../docs/design/ui/40-ui-overview.md) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | UI共同原则、设计token与状态来源约束，由具体UI任务消费。 未逐token或逐画面核验，不要求总则另建产品任务。 |
| [ui/41-workbench-layout.md](../docs/design/ui/41-workbench-layout.md) | 主要范围有承接 | [AU10-file-level-closure](slices/AU10-file-level-closure.md)、[SU02-file-level-closure](slices/SU02-file-level-closure.md)、[AU03-file-level-closure](slices/AU03-file-level-closure.md)、[B46-persistent-adoption-inbox](slices/B46-persistent-adoption-inbox.md) | 工作台布局、作品切换、历史入口及待处理区有原任务承接。 窄屏/扩展viewport仍为AU10后续；有承接任务不代表所有布局状态已验证。 |
| [ui/42-card-system.md](../docs/design/ui/42-card-system.md) | 主要范围有承接 | [DS01-decision-surface-schema-gate](slices/DS01-decision-surface-schema-gate.md)、[AU04-AU06-author-action-binding](slices/AU04-AU06-author-action-binding.md)、[AU05-file-level-closure](slices/AU05-file-level-closure.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md)、[B58-human-approval-policy-unification](slices/B58-human-approval-policy-unification.md) | 卡片schema、授权动作、采纳与确认边界有对应消费者和任务。 旧clarification/card_type表述须沿现行ADR核对，未据旧图恢复退役卡型。 |
| [ui/43-structure-panel.md](../docs/design/ui/43-structure-panel.md) | 主要范围有承接 | [AU12-work-profile-overview](slices/AU12-work-profile-overview.md)、[AU12-correction-intent-roundtrip](slices/AU12-correction-intent-roundtrip.md)、[AU12-character-identity-merge](slices/AU12-character-identity-merge.md)、[VS-00F-five-ledgers-three-state](slices/VS-00F-five-ledgers-three-state.md)、[VS-00G-fact-inventory-run](slices/VS-00G-fact-inventory-run.md)、[B11A-volume-blueprint](slices/B11A-volume-blueprint.md)、[WR01c-mission-why-brief-and-planning-decision](slices/WR01c-mission-why-brief-and-planning-decision.md) | 概览/档案、角色归并、脉络/盘点、卷蓝图与使命面均有原承接任务。 Experience和未冻结扩展对象按条件；未证明全部8模块或每个画板都已完成。 |
| [ui/44-reading-mode.md](../docs/design/ui/44-reading-mode.md) | 主要范围有承接 | [AU08-file-level-closure · 小节](slices/AU08-file-level-closure.md#阅读投影状态与失败恢复补验)、[AU08-reading-return-context](slices/AU08-reading-return-context.md)、[P1-chapter-adoption-reading](slices/P1-chapter-adoption-reading.md)、[P1-word-count-audit](slices/P1-word-count-audit.md) | 阅读只读、返回上下文、采纳投影及四态失败恢复由原任务承接。 Tentative preview在无安全契约时明确Deferred，不因覆盖映射自动开启。 |
| [ui/45-guided-conversation-flows.md](../docs/design/ui/45-guided-conversation-flows.md) | 部分承接 | [AU12-correction-intent-roundtrip](slices/AU12-correction-intent-roundtrip.md)、[B30-chapter-structure-maintenance](slices/B30-chapter-structure-maintenance.md)、[B55-style-objects-and-consumption](slices/B55-style-objects-and-consumption.md)、[B52-longrun-batch-draft](slices/B52-longrun-batch-draft.md)、[B58-human-approval-policy-unification](slices/B58-human-approval-policy-unification.md) | 立项/卷章及风格/长跑主题有承接任务；四条旧引导流的intent-slot-confirmation逐步映射未核清。 B55/B52仍deferred；风格提取标签确认等细节不能仅凭主题承接任务视为完整任务。 |
| [ui/46-state-and-feedback.md](../docs/design/ui/46-state-and-feedback.md) | 主要范围有承接 | [DS03-awaiting-author-runtime-validity-and-recovery-surface](slices/DS03-awaiting-author-runtime-validity-and-recovery-surface.md)、[B26-single-call-judgment-protocol](slices/B26-single-call-judgment-protocol.md)、[B31-author-reply-run-binding](slices/B31-author-reply-run-binding.md)、[AU10-file-level-closure](slices/AU10-file-level-closure.md)、[UA01-codex-style-narrative-alignment](slices/UA01-codex-style-narrative-alignment.md) | 运行工作区、作者问答/steer、失败反馈、叙述体裁由对应原任务承接。 旧五态/两段式示例与新主链需分别读取；未逐帧或实模验证视觉体感。 |
| [ui/47-ui-copy-guidelines.md](../docs/design/ui/47-ui-copy-guidelines.md) | 导航/约束/资产 | [B51-tech-stack-current-rebase](slices/B51-tech-stack-current-rebase.md) | 文案术语、copy集中管理与按钮映射是所有相关UI任务的约束。 B51仅校准旧术语引用；本表不宣称全部文案逐行合规。 |
| [ui/README.md](../docs/design/ui/README.md) | 导航/约束/资产 | [2026-10-27-design-to-execution-reconciliation](2026-10-27-design-to-execution-reconciliation.md) | UI目录、阅读顺序与原型追溯规则的导航节点。 目录维护归原对账；不能把索引中的状态摘要当实现状态。 |
| [ui/exports/README.md](../docs/design/ui/exports/README.md) | 导航/约束/资产 | [2026-10-27-design-to-execution-reconciliation](2026-10-27-design-to-execution-reconciliation.md) | PNG/PDF评审导出登记；从原型派生，不是独立产品任务。 包含已删除旧画板的历史PNG说明；未逐图与当前原型比对。 |
| [ui/exports/pdf/README.md](../docs/design/ui/exports/pdf/README.md) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | PDF导出暂缓及恢复条件说明。 导出链路恢复后再补评审包；不将暂缓PDF视为产品功能缺口。 |
| [ui/exports/png/README.md](../docs/design/ui/exports/png/README.md) | 导航/约束/资产 | [2026-10-27-design-to-execution-reconciliation](2026-10-27-design-to-execution-reconciliation.md) | 单屏PNG索引；本轮盘点10张派生产物，不逐PNG建任务。 清单历史数量/名称可能陈旧，未逐图核验当前画板。 |
| [ui/freeze-review.md](../docs/design/ui/freeze-review.md) | 导航/约束/资产 | [2026-10-27-design-to-execution-reconciliation](2026-10-27-design-to-execution-reconciliation.md) | 冻结前评审记录，明确尚非最终冻结，并保留PDF/polish/引导原型暂缓项。 未获得最终视觉冻结或逐帧覆盖结论；不因参考记录自动开新UI范围。 |
| [ui/novel-studio.pen](../docs/design/ui/novel-studio.pen) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | 唯一可编辑原型资产，由UI文档和追溯表供产品任务引用。 未逐帧审查；10张导出PNG为派生产物，未逐PNG建立任务或做视觉验收。 |
| [ui/pre-implementation-checklist.md](../docs/design/ui/pre-implementation-checklist.md) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | UI实现前后设计、原型、技术栈、文案、追溯的检查约束。 由每个UI任务执行，无须为清单本身单建slice。 |
| [ui/traceability/README.md](../docs/design/ui/traceability/README.md) | 导航/约束/资产 | [2026-10-27-design-to-execution-reconciliation](2026-10-27-design-to-execution-reconciliation.md) | 文档—画板追溯的目录与粒度约定。 最小8屏等历史计数未等同当前全部画板已审。 |
| [ui/traceability/screen-to-doc-map.md](../docs/design/ui/traceability/screen-to-doc-map.md) | 导航/约束/资产 | [2026-10-27-design-to-execution-reconciliation](2026-10-27-design-to-execution-reconciliation.md)、[B51-tech-stack-current-rebase](slices/B51-tech-stack-current-rebase.md) | 画板与UI/ADR引用映射资产，供实现任务定位设计来源。 仍含ADR-0022 Proposed等陈旧引用；未逐帧验证映射，维护不代签视觉实现。 |

#### 技术栈（18 项）

| 设计来源 | 分类 | 对应任务或局部承接 | 范围与限制 |
|---|---|---|---|
| [tech-stack/00-overview.md](../docs/design/tech-stack/00-overview.md) | 部分承接 | [B51-tech-stack-current-rebase](slices/B51-tech-stack-current-rebase.md)、[B50-multi-agent-current-boundary](slices/B50-multi-agent-current-boundary.md)、[SU04-desktop-sidecar-packaging](slices/SU04-desktop-sidecar-packaging.md) | 阶段1桌面和当前依赖/多Agent取舍有承接任务。 阶段2B/S、多租户/跨节点与零业务改动假设只有路线，未有完整实施映射；不自动启动阶段2。 |
| [tech-stack/01-decision-rationale.md](../docs/design/tech-stack/01-decision-rationale.md) | 导航/约束/资产 | [B51-tech-stack-current-rebase](slices/B51-tech-stack-current-rebase.md)、[B50-multi-agent-current-boundary](slices/B50-multi-agent-current-boundary.md) | 技术选择的推理与历史约束记录，作为当前重定输入。 首期多Agent等前提已变化；引用推理不代表重新授权旧实现。 |
| [tech-stack/02-alternatives.md](../docs/design/tech-stack/02-alternatives.md) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | 技术候选比较与剔除理由，不是要求实现所有候选的任务清单。 比较时点与外部生态结论未实时核验，不据此安装或替换依赖。 |
| [tech-stack/03-backend.md](../docs/design/tech-stack/03-backend.md) | 部分承接 | [B51-tech-stack-current-rebase](slices/B51-tech-stack-current-rebase.md)、[UA01-unified-agent-run-mainchain-closure](slices/UA01-unified-agent-run-mainchain-closure.md)、[B43-gate-order-residual](slices/B43-gate-order-residual.md) | 后端依赖重定和现役AgentRun/Gate有承接任务。 旧supervision/GenStage/langchain/instructor样例未逐条对到现役或延期，B51文档任务不能代签所有运行能力。 |
| [tech-stack/04-frontend.md](../docs/design/tech-stack/04-frontend.md) | 部分承接 | [B51-tech-stack-current-rebase](slices/B51-tech-stack-current-rebase.md)、[B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md)、[AU10-file-level-closure](slices/AU10-file-level-closure.md) | 框架约束、schema消费与真实工作台有承接任务。 主题切换、国际化、富文本编辑器等TBD未逐项找到冻结/延期和实施承接任务；不视为已批准功能。 |
| [tech-stack/05-desktop.md](../docs/design/tech-stack/05-desktop.md) | 部分承接 | [SU04-desktop-sidecar-packaging · 小节](slices/SU04-desktop-sidecar-packaging.md#现役故障与生命周期契约核对)、[B65-local-http-websocket-origin-boundary](slices/B65-local-http-websocket-origin-boundary.md)、[B51-tech-stack-current-rebase](slices/B51-tech-stack-current-rebase.md) | 打包/生命周期与本机传输边界有具体任务。 §8更新检查/下载/确认安装/迁移闭环未找到具体产品checkpoint；签名条件不等于更新流程已承接。 |
| [tech-stack/06-database.md](../docs/design/tech-stack/06-database.md) | 主要范围有承接 | [B51-tech-stack-current-rebase](slices/B51-tech-stack-current-rebase.md)、[B44-persistence-transition-boundary](slices/B44-persistence-transition-boundary.md)、[B47-canon-freshness-and-conflict-detection](slices/B47-canon-freshness-and-conflict-detection.md)、[B66-local-workspace-backup-restore · 小节](slices/B66-local-workspace-backup-restore.md#cp0-最小本地快照恢复契约准备)、[VS-00F-five-ledgers-three-state](slices/VS-00F-five-ledgers-three-state.md) | 当前revision取舍、持久转换/过期、维护trace及备份恢复有承接任务。 PaperTrail去留与备份契约仍待证据/接受；PostgreSQL/RLS/跨adapter路线保持阶段2条件。 |
| [tech-stack/07-provider.md](../docs/design/tech-stack/07-provider.md) | 主要范围有承接 | [SU01-file-level-closure](slices/SU01-file-level-closure.md)、[UA01-provider-execution-stream-unification](slices/UA01-provider-execution-stream-unification.md)、[B22-provider-liveness-and-budget-policy](slices/B22-provider-liveness-and-budget-policy.md)、[D6-purpose-model-routing](slices/D6-purpose-model-routing.md)、[B51-tech-stack-current-rebase](slices/B51-tech-stack-current-rebase.md) | Gateway配置/流式、用途路由、错误预算及旧选型重定均有承接任务。 live vendor矩阵与结构化partial streaming按凭据/明确需求触发，不以旧示例证明现役实现。 |
| [tech-stack/08-multi-agent.md](../docs/design/tech-stack/08-multi-agent.md) | 主要范围有承接 | [B50-multi-agent-current-boundary · 小节](slices/B50-multi-agent-current-boundary.md#61-延期实施与重新开放)、[B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md) | C05=B已将首期常驻/委派/24x7延期，原任务保存重新开放条件。 映射历史与未来方向保留；统一AgentRun不冒充完整多Agent交付。 |
| [tech-stack/09-schema-codegen.md](../docs/design/tech-stack/09-schema-codegen.md) | 部分承接 | [B45-schema-legacy-governance](slices/B45-schema-legacy-governance.md)、[DS01-decision-surface-schema-gate · 小节](slices/DS01-decision-surface-schema-gate.md#9-ds03-agent_run_state-schema-承接)、[B51-tech-stack-current-rebase](slices/B51-tech-stack-current-rebase.md) | 现役schema、legacy边界和agent_run_state生成消费有承接任务。 自动Ecto migration草稿、通用schema versioning/domain_ext保证尚未逐条对应冻结范围；B45必要契约不等于整套生成平台。 |
| [tech-stack/10-observability.md](../docs/design/tech-stack/10-observability.md) | 部分承接 | [UA01-provider-execution-stream-unification · 小节](slices/UA01-provider-execution-stream-unification.md#10-b13-运行失败日志关联)、[B59-agent-run-step-trace-persistence](slices/B59-agent-run-step-trace-persistence.md)、[AU07-trace-replay-integrity](slices/AU07-trace-replay-integrity.md)、[B51-tech-stack-current-rebase](slices/B51-tech-stack-current-rebase.md) | 真实日志关联、step持久与回放有承接任务，旧OTel选型可由B51核对。 telemetry opt-in/out、audit加密与sampling等TBD未找到具体交付承接任务；阶段2collector不自动恢复。 |
| [tech-stack/11-deployment.md](../docs/design/tech-stack/11-deployment.md) | 部分承接 | [SU04-desktop-sidecar-packaging](slices/SU04-desktop-sidecar-packaging.md)、[B65-local-http-websocket-origin-boundary](slices/B65-local-http-websocket-origin-boundary.md)、[B66-local-workspace-backup-restore · 小节](slices/B66-local-workspace-backup-restore.md#cp0-最小本地快照恢复契约准备)、[B51-tech-stack-current-rebase](slices/B51-tech-stack-current-rebase.md) | 本地打包、来源边界与灾备已有任务。 自动更新完整产品链和阶段2迁移/运维仅有设计路线，未逐项落执行任务；不将B51对账视为产品交付。 |
| [tech-stack/12-development.md](../docs/design/tech-stack/12-development.md) | 导航/约束/资产 | [B51-tech-stack-current-rebase](slices/B51-tech-stack-current-rebase.md)、[B41-quality-evidence-foundation](slices/B41-quality-evidence-foundation.md)、[B42-model-behavior-evidence-tier](slices/B42-model-behavior-evidence-tier.md) | 开发/测试/发布工作流约束，现有门禁与证据工具供各slice复用。 安装命令/版本和CI示例可能陈旧；本映射不授权安装或云发布，未逐条执行工作流。 |
| [tech-stack/13-risks.md](../docs/design/tech-stack/13-risks.md) | 导航/约束/资产 | [B51-tech-stack-current-rebase](slices/B51-tech-stack-current-rebase.md) | 技术风险、监控与回退条件登记，作为选型复核输入。 风险条目不是自动实施指令；月度review、人员与生态假设未作为产品已交付。 |
| [tech-stack/README.md](../docs/design/tech-stack/README.md) | 导航/约束/资产 | [B51-tech-stack-current-rebase](slices/B51-tech-stack-current-rebase.md) | 技术栈目录、阶段术语和阅读顺序导航。 索引中的共识需按现役/历史/延期拆开，不能证明各层功能完整。 |
| [tech-stack/verification/README.md](../docs/design/tech-stack/verification/README.md) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | 技术spike索引与验证模板。 spike通过不是生产接线或场景验收；不为每条索引新建产品任务。 |
| [tech-stack/verification/paper-trail-ecto-compatibility.md](../docs/design/tech-stack/verification/paper-trail-ecto-compatibility.md) | 主要范围有承接 | [B51-tech-stack-current-rebase](slices/B51-tech-stack-current-rebase.md) | 历史PaperTrail实验与尚未迁入CI的后果由B51版本/消费者核对及去留裁决承接。 2026-04实验不证明当前生产采用；是否迁CI取决于实际保留选择，不直接补装PG。 |
| [tech-stack/verification/structured-output-library-choice.md](../docs/design/tech-stack/verification/structured-output-library-choice.md) | 导航/约束/资产 | [B51-tech-stack-current-rebase](slices/B51-tech-stack-current-rebase.md) | 结构化输出历史选型实验，供当前Provider/依赖重定参考。 D主/A副/C回退是当时结论，未逐条证明与现役自研Gateway一致，不据实验恢复旧库。 |

#### 讨论与历史输入（16 项）

| 设计来源 | 分类 | 对应任务或局部承接 | 范围与限制 |
|---|---|---|---|
| [notes/2026-05-01-llm-call-logging-design.md](../docs/design/notes/2026-05-01-llm-call-logging-design.md) | 历史/被替代 | [VS-10-observability-spine](slices/v3/VS-10-observability-spine.md)、[UA01-provider-execution-stream-unification](slices/UA01-provider-execution-stream-unification.md) | HTTP日志备忘由三源日志spine及Provider调用事实继续承接。 notes索引中的旧VS-018路径已不存在；此映射不证明该备忘所有日志后续均完成。 |
| [notes/2026-05-02-claude-code-runtime-lessons.md](../docs/design/notes/2026-05-02-claude-code-runtime-lessons.md) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | 外部runtime对照和讨论输入，原文明确不冻结也不要求立即实现。 agent package/技法包等仅讨论，无完整产品承接任务；不从参考建议自动生成实施任务。 |
| [notes/2026-07-01-agentic-loop-reasoning-stream-ui.md](../docs/design/notes/2026-07-01-agentic-loop-reasoning-stream-ui.md) | 历史/被替代 | [UA01-agentic-loop-streaming-reasoning-card-simplification](slices/UA01-agentic-loop-streaming-reasoning-card-simplification.md)、[UA01-agentic-loop-prompt-hardening](slices/UA01-agentic-loop-prompt-hardening.md) | 推理流骨架/模型叙事权已有UI和提示词后续任务。 旧阶段及两段式假设已演变，历史UI提案不能直接复活；现役尾项须核N-NARR。 |
| [notes/2026-07-04-agentic-loop-plan-driven-execution.md](../docs/design/notes/2026-07-04-agentic-loop-plan-driven-execution.md) | 历史/被替代 | [UA01-agentic-loop-plan-driven-execution](slices/UA01-agentic-loop-plan-driven-execution.md)、[B49-core-semantics-and-adr-review](slices/B49-core-semantics-and-adr-review.md) | 计划起草/偏离重规划进入ADR-0023切片，后续语义由B49评审收敛。 备忘中的调用次数和未冻结建议不构成当前实现要求；ADR-0031为现基线。 |
| [notes/2026-07-05-agentic-verification-system.md](../docs/design/notes/2026-07-05-agentic-verification-system.md) | 历史/被替代 | [B41-quality-evidence-foundation](slices/B41-quality-evidence-foundation.md)、[B42-model-behavior-evidence-tier](slices/B42-model-behavior-evidence-tier.md)、[B34-author-intent-corpus-validation](slices/B34-author-intent-corpus-validation.md)、[VS00D-G-GAP-RECONCILIATION · 小节](slices/VS00D-G-GAP-RECONCILIATION.md#i10-人工盲评安排) | 证据地基、模型分层、语料与人工盲评有后续承接任务。 故障矩阵/mini-dogfood/分析指标未按备忘逐格核完；实模资源与I10仍独立。 |
| [notes/2026-07-15-dialogue-flow-decision-surface-review.md](../docs/design/notes/2026-07-15-dialogue-flow-decision-surface-review.md) | 历史/被替代 | [DS01-decision-surface-schema-gate](slices/DS01-decision-surface-schema-gate.md)、[DS02-adoption-status-canonicalization](slices/DS02-adoption-status-canonicalization.md)、[DS03-awaiting-author-runtime-validity-and-recovery-surface](slices/DS03-awaiting-author-runtime-validity-and-recovery-surface.md) | 决策面注册、采纳状态与停等恢复已有DS系列承接。 旧10/3/9卡片数只是当时证据，不能作为当前缺口或恢复退役卡的依据。 |
| [notes/2026-07-15-judgment-driven-interactive-loop.md](../docs/design/notes/2026-07-15-judgment-driven-interactive-loop.md) | 历史/被替代 | [UA01-judgment-driven-loop](slices/UA01-judgment-driven-loop.md)、[B26-single-call-judgment-protocol](slices/B26-single-call-judgment-protocol.md)、[B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md) | 判断循环、单调用迁移与内部求证有明确后继；外部翼留原CP6。 两段式建议已被B26取代；外网探索仍待真实需求和出站/来源策略。 |
| [notes/2026-07-22-prompt-as-function-of-state.md](../docs/design/notes/2026-07-22-prompt-as-function-of-state.md) | 历史/被替代 | [UA01-agentic-loop-prompt-hardening](slices/UA01-agentic-loop-prompt-hardening.md)、[VS-00G-fact-inventory-run](slices/VS-00G-fact-inventory-run.md)、[B27-systematic-prompt-and-intent-integration](slices/B27-systematic-prompt-and-intent-integration.md) | 状态感知提示、事实完备性/假定与调用语义由后续任务吸收。 原拍板点以现行契约和原任务为准，备忘不是直接改prompt的授权。 |
| [notes/2026-07-29-container-utilization-survey.md](../docs/design/notes/2026-07-29-container-utilization-survey.md) | 历史/被替代 | [B11A-volume-blueprint](slices/B11A-volume-blueprint.md)、[B51-tech-stack-current-rebase](slices/B51-tech-stack-current-rebase.md)、[VS-00F-five-ledgers-three-state](slices/VS-00F-five-ledgers-three-state.md) | 卷蓝图、PaperTrail真相和账面消费有明确后续，保留原四类病因。 25表是旧样本调查；其余资产/留位字段未逐表映射，不能宣称所有空容器都已有任务。 |
| [notes/2026-08-11-establish-carry-process-write-pipeline.md](../docs/design/notes/2026-08-11-establish-carry-process-write-pipeline.md) | 历史/被替代 | [B39-evidence-seeking-authoring](slices/B39-evidence-seeking-authoring.md)、[CA03-carry-selection-registry](slices/CA03-carry-selection-registry.md)、[VS00F-information-ledger](slices/VS00F-information-ledger.md) | 设立/携带/处理/写作方向由通用求证、carry及伏笔信息账继续承接。 不恢复固定packet扩张；四层所有对象组合并未逐项验收。 |
| [notes/2026-08-25-m5-dogfood-observations.md](../docs/design/notes/2026-08-25-m5-dogfood-observations.md) | 历史/被替代 | [D6-purpose-model-routing](slices/D6-purpose-model-routing.md)、[D4-planner-transient-retry](slices/D4-planner-transient-retry.md)、[VS-00G-fact-inventory-run](slices/VS-00G-fact-inventory-run.md)、[B22-provider-liveness-and-budget-policy](slices/B22-provider-liveness-and-budget-policy.md) | M5中的路由、重试、盘点与长等待债有后续任务。 当夜修复是历史事实；D1-D6及runner九项未在本轮逐项重新证明当前闭合。 |
| [notes/2026-08-26-m6-gptoss-contrast.md](../docs/design/notes/2026-08-26-m6-gptoss-contrast.md) | 历史/被替代 | [D6-purpose-model-routing](slices/D6-purpose-model-routing.md)、[D7-continuation-intent-safe-default](slices/D7-continuation-intent-safe-default.md) | 用途路由与破坏性续写默认分别由D6/D7承接，文末已纠正早期模型归因。 不恢复已撤回的模型定版建议，也不把旧对照结论当当前模型性能。 |
| [notes/2026-08-30-stage-session-archive-loop.md](../docs/design/notes/2026-08-30-stage-session-archive-loop.md) | 历史/被替代 | [Q3B-capability-gap-exit](slices/Q3B-capability-gap-exit.md)、[Q3C-author-content-materialization](slices/Q3C-author-content-materialization.md)、[Q3D-message-outcome-roundtrip](slices/Q3D-message-outcome-roundtrip.md)、[Q1B-live-archive-recheck](slices/Q1B-live-archive-recheck.md) | 能力缺口、原文物化、消息结果和真实多轮存档有后续承接。 故障现场和症状缓解建议保留历史；不得把旧失败直接判成当前缺陷。 |
| [notes/2026-10-08-agentic-business-scenario-audit.md](../docs/design/notes/2026-10-08-agentic-business-scenario-audit.md) | 历史/被替代 | [Q1B-live-archive-recheck](slices/Q1B-live-archive-recheck.md)、[B31-author-reply-run-binding](slices/B31-author-reply-run-binding.md) | BIZ修复追记与BIZ-06多轮复验有原任务，作者输入身份由B31继续保护。 前半历史反例非当前状态；本轮未重验BIZ-01至06所有具体断言。 |
| [notes/2026-10-26-story-timeline-management.md](../docs/design/notes/2026-10-26-story-timeline-management.md) | 主要范围有承接 | [B54-continuity-time-and-state](slices/B54-continuity-time-and-state.md) | 模型承接跨章故事时间、来源版本和时点状态有明确条件式任务。 B54在B39后评估；需求登记不冻结时间schema，也不承诺全部倒叙/多线首期实现。 |
| [notes/README.md](../docs/design/notes/README.md) | 导航/约束/资产 | 无独立产品任务；原因见右栏 | 讨论备忘目录与非授权边界；列明时间线等后续入口。 历史输入与现决策必须分开，目录链接数量不等于产品任务覆盖率。 |

### 14.3 本轮验证边界

机器库存与矩阵严格相等：205 个源文件、205 条唯一记录，无漏项或重复；553 处原任务引用及锚点、§14 的 760 处本地链接均可达。源文件指纹在核对期间未变化，`node scripts/next_task_check.mjs` 与 `git diff --check` 通过。该验证证明清单、归属引用和排期结构可读，不证明所有设计条款已拆成任务或产品已实现。本轮只补覆盖矩阵与索引，不新增产品任务、不修改当前排期、不运行服务/模型/数据库。

## 15. 2026-10-30 Schema 映射与条件任务入队

- 状态：**done（任务范围与排期登记完成；schema 映射、实现和真实验收仍未开工）**。
- 作者请求：在建议先做 B45 CP0、与 B43 对齐，并处理统一裁决/agent_run_state/五账三条链和十三个部分承接 schema 后，作者询问“是否可以把这些纳入任务对列”。本次据此落实为原任务交付物与排期；Experience Engine 只补责任入口，保持既定延期。

### 15.1 Schema 范围落实

| 原任务 | 本次补入的明确交付 |
|---|---|
| [B45 §7](slices/B45-schema-legacy-governance.md#7-字段与消费者映射交付2026-10-30-纳入队列) | 初始38份 schema 清单；字段/状态→设计语义→producer→转换/序列化→运行时校验→consumer→持久化/历史兼容→处置/验证映射；首批三链的具体修改清单 |
| [B43 §7](slices/B43-gate-order-residual.md#7-cp0-与-schema-映射协同2026-10-30) | 与 B45 共同核对普通回复、执行、等待和失败出口；保留真实来源、幂等/behavior/blocked 与回放完整范围，契约不替代 producer 接线 |
| [DS01 §9](slices/DS01-decision-surface-schema-gate.md#9-ds03-agent_run_state-schema-承接) | 首批 agent_run_state 真实 wire、schema/codegen/safeParse 与 live/dead/unknown/恢复权限，实施状态仍由原小节维护 |
| [VS-00F B06](slices/VS-00F-five-ledgers-three-state.md#b06-分账契约与真实消费-checkpoint) | 首批五账 status/payload 与面板 DTO 的明确投影、生成/校验、历史读取及真实消费；领域信封不直接等同面板响应 |

十三个部分承接 schema 在 B45 §7.3 逐一列名与待核问题；CP0 对每项作现役补链、历史兼容、未来预留或语义待裁决的有据处置，不另建十三个平行任务。它们当前仍待核，不因为存在一个审计入口就被写成完整消费者已覆盖。自动 migration 平台、无消费者枚举或新鉴权等不因本次入队直接启动。

### 15.2 Experience Engine 的条件承接

新增 [B68](slices/B68-experience-rule-governance.md)，完整承接 domain/33 的经验来源、证据/提炼建议、审阅、规则激活/禁用/替换/归档、真实后续消费与解释。原 VS-00F 的 dismiss 日志是潜在输入，B55 风格对象不是整个引擎的替代 owner；两者继续负责各自现役范围。

B68 为 deferred，只在 NEXT 条件区登记。需要真实经验复用需求、首个消费者、与现有记忆/方向/风格能力的复用判定及具体 contract/验收方案，才能重新开放 CP0。登记不批准常驻学习、多 Agent、自动政策调整、模型窗口或作者数据操作。此前 §14 的缺完整承接登记已有明确去处，历史审计快照保留；新增 owner 不表示条款已冻结或功能完成。

### 15.3 排期与验证边界

B43 保持当前任务；B45、B01、DS01-RUN-STATE、VS00F-B06 前移为首批候选，协同准备所需契约/来源；其余候选保持存在，未因排序被关闭。当前仍为 1 个当前任务、36 个候选，B68 仅新增条件引用。任务进度只维护原任务，NEXT 仅维护选择与顺序。

本次只改任务/设计导航与排期，保留已有 WIP；没有改产品、schema、数据库或代码生成器，没有运行模型、恢复数据或提交 Git。映射实际执行后仍须逐项局部/历史兼容/真实页面验证，不能以本次文档检查代签。

验证结果：`node scripts/next_task_check.mjs --open` 与 `git diff --check` 通过，治理测试 27/27；当前累计 Markdown 差异及新增文件的 1107 处本地链接/锚点可达，B68 已进入 slices 索引与 NEXT 条件区。候选仍为 36 项，首四项为 B45、B01、DS01-RUN-STATE、VS00F-B06；无重复来源或被移除的原候选。以上只证明任务结构与文档可达，不是 schema 或产品链验收。

## 16. 2026-10-30 愿景与元原则的全任务审查

- 状态：**done（222份任务/规划/治理文件的方向与关键机制审查完成；整改、完整产品复验未执行）**。
- 作者要求：先理解项目愿景与元原则，再核对所有任务；强调“元原则是用于指导项目所有的决策方向的”，并要求“已完成的旧实现、明确延期的能力，以及正常的机械校验”同样接受检查。
- 本轮以[愿景 00 §2](../docs/design/00-vision-and-engineering-roadmap.md)、[交互模型 01](../docs/design/01-user-llm-workbench-interaction-model.md)、已接受的 [ADR-0030](../docs/design/adr/ADR-0030-evidence-seeking-authoring-v3.md)/[ADR-0031](../docs/design/adr/ADR-0031-core-chain-semantics-narrowing-v3.md) 和最新作者裁决为依据。下面是源原则的审查解释，不另造一份设计权威，也不擅自推翻 C01–C08 或既有延期。

### 16.1 愿景、元原则与派生约束

**愿景**：可审计、判断驱动、可持续创作小说的 LLM 伙伴。作者可以自然表达目标、情绪和材料，模型据作品事实推进创作；工作台提供能力和可信状态，作者保有作品权威的决定权。作者主权同时包含对模型产物的否决权，以及亲自提供内容并经同一采纳链创设作品事实的权利。

**核心元原则**（00 §2.4）：模型是创作过程的信息求证者，APP 是可信事实、工具与边界提供者。它首先决定认知责任如何分配，再指导 schema、工具、上下文、规划、UI、验证与维护方案。不能把“工程检查都过了”或“任务表填齐了”当作该方向已经成立。

| 元原则展开 | 用于审查决策方向的问题 |
|---|---|
| M1 最小可信供给 | APP 提供的是不可让模型猜测的意图/身份/坐标/权限/能力/预算/版本与安全底座，还是在替模型穷举所有创作知识？最小不等于字数最少。 |
| M2 模型判断需求和相关性 | 信息缺口、需要读取什么、如何继续创作由谁判断？系统是否通过关键词、固定轨道或后置否决，实质上重新决定了创作意图与能力？“输出校验”的名称不构成豁免。 |
| M3 真实证据进入后续判断 | 工具读到、APP取到、实际送入请求、模型声称使用、引用可绑定、语义正确分别是什么证据？时间相邻、日志存在或字段存在不能代替真实材料进入该请求。 |
| M4 有界自主与作者主权 | 模型是否在明确权限/预算/恢复边界内工作，作者条件和最终权威是否保留？推断、候选、运行结束不能直接变成已采纳事实。 |
| M5 通用求证优先 | 新知识维度是否同批进入通用探索、观察回流和引用体系？是否又以专用固定包或另一个隐蔽loop填漏洞？既有carry须据证迁移，不一刀切删除。 |

**派生约束**：Contract/schema、逐步 Gate、统一 AgentRun、trace/replay、七问、外部真实页面验收、SSOT、app边界和最小改动，都服务上述责任分工；仍须遵守当前 Accepted 决策，但不能与元原则混成同一层清单。机械的身份/权限/版本/字节/确定性计算是 APP 应做的工作，审查的是它有没有把无法机械证明的语义当作确定事实或授权。已批准的 LOW 维护、确定性账务和政策仍按原边界执行；出现上位方向与具体规则的张力，应明确复核语义/适用性，而不是直接改交模型或撤销裁决。

**任务方向与实现结果分开**：B64/B65/B67 等修复任务本身朝正确方向推进，它们所承接的旧机制仍可能有偏差。done、deferred、historical 或“机械”都只是状态/方式，不是通过结论。延期项核未来方案，旧实现核仍生效或已替代的关键路径；治理任务则核它实际产生的规则和导航，而非因无模型调用免检。

### 16.2 全量范围与证据边界

以本轮开始的 `tasks/**/*.md` 为清单，共 **222份**，没有其它格式的任务文件。分组逐项读取目标、当前范围/余项、边界、最新裁决及完成/恢复说明，并补查当前关键生产者、校验与消费链或明确后继。长历史没有被当成当前执行要求，也没有因历史完成而跳过当前机制。

| 核对方式 | 文件数 | 可支持的结论 |
|---|---:|---|
| 当前关键代码/消费路径 | 161 | 所核责任分工与边界的静态判断；不等于重验全部代码 |
| 现行替代链 | 34 | 核对旧方案实际由何种机制承接，不能恢复旧流程 |
| 计划或治理产物方向 | 27 | 核延期/未实施方案及治理规则的方向，不声称运行行为已成立 |
| 合计 | 222 | 每份均有记录，无以状态或“机械”免检的文件 |

逐项机器记录（`../artifacts/task-audit/2026-10-30-principles/report.json`） 保存每项方向、当前机制结论、检查范围、代码/原文位置、引文与建议；审查基准（`../artifacts/task-audit/2026-10-30-principles/review-basis.json`） 记录元原则与派生约束的分层。初稿把工程约束混作平级原则的清单已标为不再采用，最终判定按作者澄清后的口径。

本轮没有修改生产代码、任务状态或排期，没有启动服务、真实模型、数据库或页面。B29/B30/B33 仅做当前纯谓词/guard的隔离求值，B42 仅对当前纯函数输入合成元数据；静态/纯函数反例不冒充线上事故、真实模型复现或完整 release 验收。

### 16.3 结论分布（不是产品通过率）

| 任务及其承接机制的审查结论 | 文件数 | 含义 |
|---|---:|---|
| 所核范围未发现明显方向偏离 | 180 | 含计划方向正确的项；不代表所有功能或文学效果通过 |
| 现役关键机制存在明确偏离/失真 | 14 | 归并为下列9类问题；不是14个独立漏洞，也不表示14个任务的修复目标错误 |
| 需要校准方向、政策解释或恢复边界 | 28 | 有证据指出需澄清处；不把疑点强判为当前代码违规 |
| 合计 | 222 | 任务方向与现役机制不能混为一个done标签 |

独立看任务目标/规则取向：199份未见明确方向冲突，23份仍需校准规则或恢复表述；这一维度不能覆盖上表的现役机制问题。审查中对34份初始证据不足项做了有界补核，记录了实际当前或替代路径；没有因缺本轮UI/实模运行就把方向留作不可判断，也没有据历史测试直接判绿。

### 16.4 九类现役偏离与修复归属

| 问题族 | 元原则与现役证据 | 应保留的目标与纠偏方向 |
|---|---|---|
| F01 后置词法语义路由（B29/B30/B33，影响B26/B27共通入口） | M2/M4。当前判断decode先按原话词语判维护/角色/写作意图，再否定模型合法reply并要求特定能力。纯函数反例：明确“只解释，不要修改”仍被判维护；“讨论…先不要生成候选”仍被判角色修订；“若没有错别字就说明无需修改”仍被要求执行/重问。见 纯规则证据（`../artifacts/task-audit/2026-10-30-principles/b33-probe.json`） 与 [JudgmentProtocol](../apps/novel_application/lib/novel_application/judgment_protocol.ex) 699–725、834–874。 | 防止请求被忽略的目标保留；应核模型的语义判断、真实目标/结果和作者条件，不能靠再加关键词豁免维持后置Router。身份/权限/采纳/真实副作用校验继续保留。沿 B27 与 B29/B30/B33 原owner明确整改范围，不恢复两段式。 |
| F02 否定范围被当作正面授权（B28） | M2/M4。[PendingArtifactWorkflow](../apps/novel_application/lib/novel_application/pending_artifact_workflow.ex) 657–671 以“整章/全文/通读”词命中选 whole_chapter，未处理否定；“不要整章重写，只改第一段”静态仍可能扩大范围，而整章分支放宽目标外差异校验。未做真实改稿。 | 保留确定性段落/字节保护和作者采纳；本轮授权范围不能由词语出现替代语义。B28/B35/B36需从真实作者目标到结构化范围再到diff验证闭合，不以原话进prompt代替权限边界正确。 |
| F03 读取失败被解释为无作品（AU03） | M1/M3。[ContextAssembler](../apps/novel_application/lib/novel_application/context_assembler.ex) 89–134 将异常/非ok降为空；失败只写日志，当前 [判断输入](../apps/novel_application/lib/novel_application/dialogue_planning_service.ex) 1809–1810 把nil说成新对话或未创建作品。未见同次请求的并行失败标签。 | 允许有界降级，必须保留 unavailable/unknown 与真实空作品的区别。由 AU03 当前失败补验、B27/B39修复可信底座，不能通过多塞知识包遮住失败。 |
| F04 已取到的memory引用被标为supplied，对应材料未渲染（AU09分层/trace） | M3。ContextAssembler 314产生memory ref；[DPS](../apps/novel_application/lib/novel_application/dialogue_planning_service.ex) 1106全收context refs，1163–1169/1786–1794不渲染对应memory_summary；[reply_record](../apps/novel_application/lib/novel_application/judgment_protocol.ex) 1202仍记录supplied。实际取到、实际提供与模型使用没有同源区分。 | B27/B39/B42/AU07按真实请求材料建立引用记录；不能简单把全部memory塞回首轮，也不能将ref存在或模型自报当作理解正确。后续memory_recall可补读，不消除初始供给记录失真。 |
| F05 时间顺序冒充输入绑定（B42） | M3。[evidence_chain](../scripts/lib/quality/evidence_chain.mjs) 398–426可按time_order关联，527–531据ordered+real认可。合成元数据中明确 request_observation_refs=[]，当前函数仍返回 binding_status=verified。见 纯函数证据（`../artifacts/task-audit/2026-10-30-principles/b42-probe.json`）；没有真实provider调用或整体release PASS结论。 | 时间先后只能支持排序，不能证明观察进入该请求。B42与B39应按真实请求材料同源关联；缺关联和明确未包含须诚实处理，先防止证据地基把未证明之事标已验证。 |
| F06 全书进度代替本轮目标与记忆适用性（AU09/CA02/B64） | M1/M3。[MemoryRecallRepo](../apps/novel_persistence/lib/novel_persistence/memory_recall_repo.ex) 40–74以max已采纳章过滤；[creative_facts](../apps/novel_persistence/lib/novel_persistence/work_archive_repo.ex) 125–134无目标/窗口；[专业消费](../apps/novel_application/lib/novel_application/turn_execution_service.ex) 1188–1196只传work_id。作者回旧章时不能一概当作最新进度。 | B64的修复方向正确；按真实目标/未知位置/历史查询分工供给适用材料，不删除历史，也不新增专用时间线包来掩盖现有读取边界。 |
| F07 处理顺序冒充故事进度（B67承接的旧维护机制） | M3。[LedgerEntry](../apps/novel_domain/lib/novel_domain/ledger_entry.ex) 的最近出场/推进可被本次旧章覆盖，已登记ch10→处理ch3→ch12误判停滞的纯函数反例。不是页面或数据库复现。 | B67方向正确；APP应计算当前有效事实的派生进度，不能让模型猜账面真假。保留来源/版本、旧贡献失效与作者裁决，不能只取max或补一条trace就关闭。 |
| F08 字符串前缀冒充本机来源（B65承接的旧边界） | M4。现有 [CORSPlug](../apps/novel_web/lib/novel_web/plugs/cors_plug.ex) 以starts_with接受伪localhost/127/tauri后缀；B65已登记纯表达式证据，未进行网络攻击。 | B65方向正确；权限边界应由APP精确保证，不交模型判断，也不能只凭“机械检查”称安全。HTTP/WS、最终配置、合法客户端与身份边界须分别核实。 |
| F09 持久角色指纹校验仍可放宽（B47） | M3/M4。[AdoptionRepository](../apps/novel_persistence/lib/novel_persistence/adoption_repository.ex) 1675–1677整体指纹不匹配仍可因old_role相同放行，与已确认C07=A不同；入口gate存在不代替持久/竞争窗口证明。 | B47新裁决方向正确，需完成既定整体基线与原子性/幂等后果；不是让模型自报是否过期，也不是删除fallback就声称整条采纳已验证。 |

以上问题分别属于认知责任越界、可信供给/证据失真或事实/权限边界实现缺陷。后两类不说明其任务目标错误，却会破坏元原则赖以成立的条件；不得因“只是机械bug”而免检，也不得据此要求模型接管版本比较或权限判断。

### 16.5 需要校准的方向与既有政策

- **专业路径的取证自主性**：WR01/WR02、plot_outline/prose profile及旧Context切片的当前代码仍预选材料、限定可用目标/固定专业步骤；B39应闭合模型发现缺口、补读和真实观察回流。既有carry按证据迁移，不直接删除；新余项不能默认继续扩“planner补四段资料”或专用包。
- **已批准的机械创作政策**：CA04/B11A收官守则、VS-00F情绪词面匹配必须审查其向作者/模型宣称的语义和当前brief优先级。保留原作者政策、ADR-0026确定性规则与LOW采纳；词面匹配信号不能无说明地等同情绪语义已经实现，进度阈值也须明确是作者约束还是创作建议。必要时复核具体契约，不能借审计直接改交LLM或重置裁决。
- **来源、类型与保护阈值**：Q3C的指代词/8字/40字规则可误拒含“刚才”的短原文；AU08/B30后继按标题“卷蓝图”等词否决对象类别；B35通用50%长度下限需区分截断丢稿与明确大幅缩写。各安全目标应保留，但词法/长度代理不能自动获得完整语义决定权；先核实际保留字/能力边界和合法反例，不一刀切删除守卫。
- **步内预算和验收见证**：D5的provider事件已补计失败调用，问题在同一步递归子调用前的额度准入；有限递归不等于满足run额度。B41允许runner见证且会拒空目录，应明确“未探测到文件”与“真实必需证据缺失”的界限；本轮没有证明它发生了整体假PASS，也不否定合法见证。
- **能力与验收边界**：订阅provider UI与未实现OAuth/专用传输的限制需如实表达；StructurePanel隐藏data-archive元数据被验收助手消费，须核真实产品用途，不能只因是data-*就删除，也不能因该场景另用了可见文本就免查。
- **旧任务恢复入口**：旧persona的form_frame/stub正则锚点要求已有B27后续规则覆盖；旧两段式流式任务、judgment恢复CP和v3 DAG“排序/状态总表”入口需就地回链最新执行源。它们不能作为恢复旧协议的理由。这里明确是历史/导航风险，不冒充现役代码已经退回两段式。

### 16.6 处理顺序建议与本轮边界

1. 先明确并修正 F01/F02 的语义与授权范围责任，以及 F03–F05 的可信输入/证据判据，再用真实场景验证；这些直接影响“模型据什么判断”与“系统是否真的尊重作者条件”。不以增加更多字段、关键词例外或单纯提高测试通过率替代责任纠偏。
2. B64/B67/B65/B47继续按已登记修复范围闭合事实和权限基础；B39推进通用求证，WR/CA余项在同一方向下迁移。新的schema必须服务这些真实producer、边界与消费者，而不是反向创造业务。
3. 对收官/情绪/来源启发式等已批准政策与边界张力，先给具体语义、反例和可比较影响，再按原裁决流程修订；不将本次审查当作自动放宽或撤销授权。
4. 延期能力已按未来方向审查，但仍保持原触发条件；本轮不启动Experience Engine、多Agent/24x7、批量长跑、外部搜索或数据修复。

上述是审查处置建议。当前任务状态、执行队列和既有完成/失败证据未改；本轮只新增本节审计记录与导航。完整功能验收、真实模型行为和文学质量仍需各原任务的证据，不能用本次静态审查代签。

### 16.7 逐任务记录

下表覆盖全部222份。标签“未见偏离”只对应本行已核范围；“现役偏离”可出现在正确的修复任务上，表示它承接的旧机制仍有问题。完整代码/引文/限制见机器记录，不把文件定位或历史状态当作审查结果。

#### 治理与整合（6份）

| 原任务 | 原则核对结论 | 核对方式 | 决策方向与范围说明 |
|---|---|---|---|
| [2026-06-14-design-v2-to-v3-absorption.md](2026-06-14-design-v2-to-v3-absorption.md) | 所核范围未见偏离 | 计划/治理方向 | 历史吸收按创作伙伴/权威边界保留领域知识；不是恢复旧Router或照旧11条继续实现。 |
| [2026-10-27-design-to-execution-reconciliation.md](2026-10-27-design-to-execution-reconciliation.md) | 所核范围未见偏离 | 计划/治理方向 | 按真实消费者分配任务并保留延期；覆盖矩阵不授权为凑字段造功能，非产品完成。 |
| [NEXT.md](NEXT.md) | 所核范围未见偏离 | 计划/治理方向 | 首批schema映射服务真实裁决/运行状态/五账消费者；条件项不自动开启，状态回原任务。 |
| [README.md](README.md) | 所核范围未见偏离 | 计划/治理方向 | 排期与执行真源分工避免重复权威；准入依真实下一步与完整范围，不以数量推进产品。 |
| [slices/README.md](slices/README.md) | 所核范围未见偏离 | 计划/治理方向 | 索引保留历史角色，七问含探索与完整闭环；不为模板预建抽象或以缩范围换完成。 |
| [slices/v3/README.md](slices/v3/README.md) | 需校准/复核 | 计划/治理方向 | 页首仍把DAG写成排序和状态总表，页尾又说明历史；恢复导航口径需统一。 |

#### B/CA及边界任务（56份）

| 原任务 | 原则核对结论 | 核对方式 | 决策方向与范围说明 |
|---|---|---|---|
| [slices/B11A-volume-blueprint.md](slices/B11A-volume-blueprint.md) | 需校准/复核 | 现役代码 | 现役收官守则确有APP阈值化创作策略；已有作者批准且含明示例外，需核与当前意图的优先级，不能按机械/已批自动通过。 |
| [slices/B11C-scene-craft-completion.md](slices/B11C-scene-craft-completion.md) | 所核范围未见偏离 | 现役代码 | 已核现役场级字段由规划文本解析、投影到writer；APP未补写因果/感官内容，模型继续负责创作。 |
| [slices/B11D-quality-field-granularity.md](slices/B11D-quality-field-granularity.md) | 所核范围未见偏离 | 现役代码 | 已核现役finding场标签从真实场边界或brief引用映射，语义质量仍交evaluator；不会凭空制造场对象。 |
| [slices/B13B-adr-enforcement-reconciliation.md](slices/B13B-adr-enforcement-reconciliation.md) | 所核范围未见偏离 | 当前替代链 | 现治理区分已裁决/待实现/历史证据，最新Accepted与原owner优先；引用存在性门禁不被当作运行正确性或作者批准。 |
| [slices/B21-first-append-scene-naming.md](slices/B21-first-append-scene-naming.md) | 所核范围未见偏离 | 现役代码 | 只修整章正文的真实场名归属，机械命名不替模型创作；历史证据按原范围保留。 |
| [slices/B22-provider-liveness-and-budget-policy.md](slices/B22-provider-liveness-and-budget-policy.md) | 所核范围未见偏离 | 现役代码 | 现役时钟按wire存活、显式deadline及取消控制资源，未见以文本内容决定创作步骤；非流式与自适应仍有限制。 |
| [slices/B23-awaiting-author-reason-and-exit-surface.md](slices/B23-awaiting-author-reason-and-exit-surface.md) | 所核范围未见偏离 | 现役代码 | 现役计划未完成先允许模型重规划；预算不足才以结构事实停等，UI显示真实summary，未给模型预制创作内容。 |
| [slices/B24-exploration-chapter-full-read.md](slices/B24-exploration-chapter-full-read.md) | 所核范围未见偏离 | 现役代码 | 已核当前chapter_read按真实章返回页范围/来源与续读，不替模型判断哪些事实相关；全Run预算另属B39。 |
| [slices/B25-chapter-identity-unification.md](slices/B25-chapter-identity-unification.md) | 所核范围未见偏离 | 现役代码 | APP统一章身份、歧义与事务，模型继续决定创作；机械寻址不替代相关性判断。 |
| [slices/B26-single-call-judgment-protocol.md](slices/B26-single-call-judgment-protocol.md) | 需校准/复核 | 现役代码 | 单调用/共享语义的目标合理，但当前主链受后置词法语义门影响；具体冲突归B33/B29/B30，不重复计根因。 |
| [slices/B27-systematic-prompt-and-intent-integration.md](slices/B27-systematic-prompt-and-intent-integration.md) | 需校准/复核 | 现役代码 | 单调用/共享语义的目标合理，但当前主链受后置词法语义门影响；具体冲突归B33/B29/B30，不重复计根因。 |
| [slices/B28-whole-chapter-revision.md](slices/B28-whole-chapter-revision.md) | 现役关键机制偏离 | 现役代码 | 整章材料与采纳目标合理，但现役范围选择按词命中；否定整章的原话仍可被扩大为whole_chapter，保护面随之改变。 |
| [slices/B29-existing-character-role-revision.md](slices/B29-existing-character-role-revision.md) | 现役关键机制偏离 | 现役代码 | 任务意图是提供真实维护能力，但当前词法后置门也拦截明确只讨论/解释的回复；不能以机械校验名义代替语义判断。 |
| [slices/B30-chapter-structure-maintenance.md](slices/B30-chapter-structure-maintenance.md) | 现役关键机制偏离 | 现役代码 | 任务意图是提供真实维护能力，但当前词法后置门也拦截明确只讨论/解释的回复；不能以机械校验名义代替语义判断。 |
| [slices/B31-author-reply-run-binding.md](slices/B31-author-reply-run-binding.md) | 所核范围未见偏离 | 现役代码 | 已核按问题身份、作者焦点和已接受的活动序选择输入对象，发送与版本检查消费同一run；未用文字类型决定创作能力。 |
| [slices/B33-authoring-intent-judgment-reliability.md](slices/B33-authoring-intent-judgment-reliability.md) | 现役关键机制偏离 | 现役代码 | 目标是可靠达成请求，但现役后置词法门把条件意图和据证无变化回复锁为execute/澄清，已确认M2/M4冲突。 |
| [slices/B34-author-intent-corpus-validation.md](slices/B34-author-intent-corpus-validation.md) | 所核范围未见偏离 | 现役代码 | 现分类脚本只是离线覆盖分析，确定性分支在test/support；语料关键词没有因此成为生产意图路由，存疑模型结果仍保留。 |
| [slices/B35-revision-adoption-scope-integrity.md](slices/B35-revision-adoption-scope-integrity.md) | 需校准/复核 | 现役代码 | 现役覆盖/版本校验保护真实正文，但通用“少于一半即不完整”把长度当完整性；明确大幅缩写的授权语义仍需复核。 |
| [slices/B36-localized-revision-algorithm.md](slices/B36-localized-revision-algorithm.md) | 所核范围未见偏离 | 现役代码 | 已核局部编辑纯算法按版本/显式范围校验字节，未决定改写意义；可用表达范围有限，不冒充所有修订已核。 |
| [slices/B37-acceptance-wait-supervision.md](slices/B37-acceptance-wait-supervision.md) | 所核范围未见偏离 | 现役代码 | 已核外部等待/进程监督，不决定故事或替模型出答案；验收硬窗口须与批准运行预算区分，非产品存活策略。 |
| [slices/B38-world-rule-save-intent.md](slices/B38-world-rule-save-intent.md) | 所核范围未见偏离 | 计划/治理方向 | 仅在真实保存需求或产品链复现后核因，不把单次模型异常变成预制能力或关键词映射。 |
| [slices/B39-evidence-seeking-authoring.md](slices/B39-evidence-seeking-authoring.md) | 所核范围未见偏离 | 计划/治理方向 | 直接让模型发现信息缺口、取证并据证创作；APP提供最小底座、真实观察和有界权威边界。 |
| [slices/B40-judgment-era-acceptance-reanchor.md](slices/B40-judgment-era-acceptance-reanchor.md) | 所核范围未见偏离 | 现役代码 | 现候选title/pitch由模型directions映射过滤，没有执行旧APP补方向；C06后续退役与替代证据仍待做，未实现不等于方向违规。 |
| [slices/B41-quality-evidence-foundation.md](slices/B41-quality-evidence-foundation.md) | 需校准/复核 | 现役代码 | manifest/verdict/聚合已分缺证据和模型层；deterministic入口将runner成功视作required全部见证，需明确合法见证与真缺证据的边界。 |
| [slices/B42-model-behavior-evidence-tier.md](slices/B42-model-behavior-evidence-tier.md) | 现役关键机制偏离 | 现役代码 | 证据层目标合理，但现役基础件可把“先观察后调用”判成binding verified，显式空请求引用仍被回填，违反M3。 |
| [slices/B43-gate-order-residual.md](slices/B43-gate-order-residual.md) | 所核范围未见偏离 | 现役代码 | 已核现役GateOrder的结构/权限检查方向；统一reply_only新producer仍待任务实施，未据此宣布全链合规。 |
| [slices/B44-persistence-transition-boundary.md](slices/B44-persistence-transition-boundary.md) | 所核范围未见偏离 | 现役代码 | 持久转换和回滚守住已接受维护政策，机械状态检查不替作者作故事裁决。 |
| [slices/B45-schema-legacy-governance.md](slices/B45-schema-legacy-governance.md) | 所核范围未见偏离 | 计划/治理方向 | 字段状态连接真实生产者、校验与消费者，不为形式完整扩知识模型或恢复旧流程。 |
| [slices/B46-persistent-adoption-inbox.md](slices/B46-persistent-adoption-inbox.md) | 所核范围未见偏离 | 计划/治理方向 | 恢复同一待采纳对象供作者继续裁决，保持待定/确认分离，不自动升级为作品事实。 |
| [slices/B47-canon-freshness-and-conflict-detection.md](slices/B47-canon-freshness-and-conflict-detection.md) | 现役关键机制偏离 | 现役代码 | B47/C07修复方向正确；现役持久入口在整体指纹不匹配时仍可凭old_role放行，不能以已有domain比较代签权威边界。 |
| [slices/B48-character-revision-noop-and-ambiguity.md](slices/B48-character-revision-noop-and-ambiguity.md) | 所核范围未见偏离 | 计划/治理方向 | 按真实身份确认无需修改，尊重跨轮消歧，避免作者处理伪候选或反复解释。 |
| [slices/B49-core-semantics-and-adr-review.md](slices/B49-core-semantics-and-adr-review.md) | 所核范围未见偏离 | 计划/治理方向 | 最新R1–R7区分模型计划、系统决定与真实来源；统一裁决不恢复形式主义空对象。 |
| [slices/B50-multi-agent-current-boundary.md](slices/B50-multi-agent-current-boundary.md) | 所核范围未见偏离 | 计划/治理方向 | C05=B先支持统一AgentRun创作/求证；独立多角色和24x7须真实收益与权限预算后再开放。 |
| [slices/B51-tech-stack-current-rebase.md](slices/B51-tech-stack-current-rebase.md) | 所核范围未见偏离 | 计划/治理方向 | 按真实消费者校正技术承诺，避免旧依赖反向规定产品；先取证再作去留和数据操作选择。 |
| [slices/B52-longrun-batch-draft.md](slices/B52-longrun-batch-draft.md) | 所核范围未见偏离 | 计划/治理方向 | 批量逐单元复用单章和通用求证，保留预算恢复与逐章采纳，无真实需求时不扩运行时。 |
| [slices/B53-p2-500k-milestone.md](slices/B53-p2-500k-milestone.md) | 所核范围未见偏离 | 计划/治理方向 | 长篇按真实连续创作和恢复取证，不用脚本堆字代替伙伴能力；预算和文学评价独立。 |
| [slices/B54-continuity-time-and-state.md](slices/B54-continuity-time-and-state.md) | 所核范围未见偏离 | 计划/治理方向 | 先证明模型能通用取证，再按真实缺口决定时间读模型，不由对象名驱动建表或预装答案。 |
| [slices/B55-style-objects-and-consumption.md](slices/B55-style-objects-and-consumption.md) | 所核范围未见偏离 | 计划/治理方向 | 风格由真实编辑需求拉动；作者当前brief属Base，旧样本按需取证而非默认扩包。 |
| [slices/B56-quality-maintenance-gates.md](slices/B56-quality-maintenance-gates.md) | 所核范围未见偏离 | 计划/治理方向 | 模型查证并提出语义冲突，APP守确定性边界、作者裁决，不以形式指标替代作品判断。 |
| [slices/B57-sec-injection-boundary.md](slices/B57-sec-injection-boundary.md) | 所核范围未见偏离 | 计划/治理方向 | 验证观察指令不能提升权限，不以关键词黑名单替代创作判断，也不预建空Guard。 |
| [slices/B58-human-approval-policy-unification.md](slices/B58-human-approval-policy-unification.md) | 所核范围未见偏离 | 计划/治理方向 | 批准对象、版本和结果可核验；低风险按已接受政策，不把模型每步判断变成作者确认。 |
| [slices/B59-agent-run-step-trace-persistence.md](slices/B59-agent-run-step-trace-persistence.md) | 所核范围未见偏离 | 现役代码 | 补真实内部步trace持久链，让观察和动作可回查，不伪造行为或为验收重建执行轨道。 |
| [slices/B60-backend-dialyzer-baseline.md](slices/B60-backend-dialyzer-baseline.md) | 所核范围未见偏离 | 现役代码 | 现类型门配置未全局ignore，关键只读修订拒绝已是解释性错误；类型治理不以工具分数改变创作语义或作者权限。 |
| [slices/B61-native-acceptance-driver-coverage.md](slices/B61-native-acceptance-driver-coverage.md) | 所核范围未见偏离 | 现役代码 | 现原生驱动/证据按外部AX、实际窗口、等待与传输事实判定，明确替身机制范围；无新运行不等于职责方向未知。 |
| [slices/B62-native-coverage-b40-family.md](slices/B62-native-coverage-b40-family.md) | 所核范围未见偏离 | 现役代码 | 现二批沿同一外部原生规则和聊天族证据脚本，保留驱动面/模型层区别，不凭旧PASS刷新当前有效性。 |
| [slices/B63-known-gaps-remediation.md](slices/B63-known-gaps-remediation.md) | 所核范围未见偏离 | 现役代码 | 已核R2现役链以正文artifact构造评审任务，失败不回退turn_id；配置语义评估时明确unavailable，未冒充模型判断完成。 |
| [slices/B64-coordinate-aware-memory-consumption.md](slices/B64-coordinate-aware-memory-consumption.md) | 现役关键机制偏离 | 现役代码 | B64修复方向符合元原则；现役目标记忆消费仍缺真实作用坐标/有效窗，不能把待办规划计为当前机制通过。 |
| [slices/B65-local-http-websocket-origin-boundary.md](slices/B65-local-http-websocket-origin-boundary.md) | 现役关键机制偏离 | 现役代码 | B65拟修来源边界方向合理；现役前缀守卫不能兑现声明的可信来源，属于权威/隔离护栏问题。 |
| [slices/B66-local-workspace-backup-restore.md](slices/B66-local-workspace-backup-restore.md) | 所核范围未见偏离 | 计划/治理方向 | 备份保护作者事实和待处理状态，先定范围与覆盖政策，不恢复时自动重放模型或采纳。 |
| [slices/B67-revision-aware-ledger-maintenance.md](slices/B67-revision-aware-ledger-maintenance.md) | 现役关键机制偏离 | 现役代码 | B67修复方向合理；现役机械维护仍把处理顺序当最近故事进度，真实来源事实未满足，规划不能代签修复。 |
| [slices/B68-experience-rule-governance.md](slices/B68-experience-rule-governance.md) | 所核范围未见偏离 | 计划/治理方向 | 模型提炼有出处经验，作者决定规则权威；通用读取与延期边界防止自动永久偏好或政策。 |
| [slices/BEHAVIOR-LIFECYCLE-DECISION-AUTHORITY.md](slices/BEHAVIOR-LIFECYCLE-DECISION-AUTHORITY.md) | 需校准/复核 | 现役代码 | 旧关闭权偏差与新统一裁决承接未标明；需澄清恢复口径，不能将旧豁免视作永久规则。 |
| [slices/CA01-planning-context-completion.md](slices/CA01-planning-context-completion.md) | 需校准/复核 | 计划/治理方向 | 既有carry可保留按证据迁移；未执行planner四段补料余项仍默认APP预装知识，应回接B39最小底座/模型求证与真实消费。 |
| [slices/CA02-writing-facts-context.md](slices/CA02-writing-facts-context.md) | 现役关键机制偏离 | 现役代码 | 当前事实段同源不等于适用：未读目标窗却将记忆标成必须遵循的事实，窗口外知识会失去适用性证据；B64待修。 |
| [slices/CA03-carry-selection-registry.md](slices/CA03-carry-selection-registry.md) | 所核范围未见偏离 | 现役代码 | 当前登记表确实是固定调用点携带选择，但此任务只统一存量行为与诚实可见性；相关性和新增供给不能由登记表自证。 |
| [slices/CA04-carry-gap-closure.md](slices/CA04-carry-gap-closure.md) | 需校准/复核 | 现役代码 | 现役收官守则确有APP阈值化创作策略；已有作者批准且含明示例外，需核与当前意图的优先级，不能按机械/已批自动通过。 |

#### 作者/系统旅程与采纳任务（90份）

| 原任务 | 原则核对结论 | 核对方式 | 决策方向与范围说明 |
|---|---|---|---|
| [slices/AU01-empty-message-guard.md](slices/AU01-empty-message-guard.md) | 所核范围未见偏离 | 现役代码 | 空输入仅机械阻断；有效输入回到模型判断，不把无MicroPlan误读为无reply_only裁决。 |
| [slices/AU01-file-level-closure.md](slices/AU01-file-level-closure.md) | 所核范围未见偏离 | 现役代码 | 自然聊天、无副作用和同源恢复的方向保留；旧文件级通过不替代B43统一裁决及后继trace证据。 |
| [slices/AU01-frame-validation-friendly-error.md](slices/AU01-frame-validation-friendly-error.md) | 所核范围未见偏离 | 现役代码 | 非法结构/授权语义由APP拒绝，友好错误不编造创作结论；现役判断协议是后继校验入口。 |
| [slices/AU01-garbage-json-recovery.md](slices/AU01-garbage-json-recovery.md) | 所核范围未见偏离 | 当前替代链 | 旧frame JSON场景已被重锚/退役；现役纯文本和原生工具响应不能重新套强制frame JSON。 |
| [slices/AU01-ordinary-chat-two-turn-roundtrip.md](slices/AU01-ordinary-chat-two-turn-roundtrip.md) | 所核范围未见偏离 | 现役代码 | 两轮自然聊天由模型出字、APP记录回传；普通回复不执行业务但仍须按ADR0031统一裁决。 |
| [slices/AU01-turnresult-recorder-ui-consistency.md](slices/AU01-turnresult-recorder-ui-consistency.md) | 所核范围未见偏离 | 现役代码 | 任务方向与现役关键链均明确：模型结果原文经记录事务存储，实时UI与恢复UI读取同一assistant文本；不因未跑当前页面就把原则方向留未判。 |
| [slices/AU02-candidate-adoption-bridge.md](slices/AU02-candidate-adoption-bridge.md) | 所核范围未见偏离 | 现役代码 | 讨论选择和采用明确分开，APP校验服务端动作而不替作者采纳；方向持久语义另有原owner。 |
| [slices/AU02-candidate-fallback-ui.md](slices/AU02-candidate-fallback-ui.md) | 所核范围未见偏离 | 当前替代链 | 旧APP补创意目标已由C06否决；现役候选转换未调用兜底，保留失败/纠错完整后果。 |
| [slices/AU02-candidate-multiturn-context.md](slices/AU02-candidate-multiturn-context.md) | 所核范围未见偏离 | 现役代码 | 当前继续讨论入口发送所选模型候选的可见标题/简介及稳定selection refs；普通后续输入不默认附selection，历史摘要供模型继续判断而不自动采纳。 |
| [slices/AU02-candidate-schema-codegen.md](slices/AU02-candidate-schema-codegen.md) | 所核范围未见偏离 | 现役代码 | schema只约束模型候选结构与未采纳身份，不替模型写创意或决定采用。 |
| [slices/AU02-file-level-closure.md](slices/AU02-file-level-closure.md) | 所核范围未见偏离 | 当前替代链 | 文件级历史探索矩阵须按新协议重读；primary与APP补候选不能作为恢复施工要求。 |
| [slices/AU02-freeform-followup-after-candidate.md](slices/AU02-freeform-followup-after-candidate.md) | 所核范围未见偏离 | 现役代码 | 自然追问不隐式选择或采纳候选，作者无需按卡片轨道走，符合自然创作伙伴方向。 |
| [slices/AU02-natural-exploration-no-slot-form.md](slices/AU02-natural-exploration-no-slot-form.md) | 所核范围未见偏离 | 当前替代链 | 不把缺槽变表单的意图仍有效；旧primary/no工具断言不能限制现役模型必要的只读取证。 |
| [slices/AU02-unadopted-candidate-no-reading-fact.md](slices/AU02-unadopted-candidate-no-reading-fact.md) | 所核范围未见偏离 | 现役代码 | 候选仅供讨论，未采纳不进入权威正文；机械隔离保护作者作品裁决权。 |
| [slices/AU03-branch-from-history.md](slices/AU03-branch-from-history.md) | 所核范围未见偏离 | 现役代码 | 历史只读并通过明确操作开新会话，来源可追而不复制旧内容冒充当前事实。 |
| [slices/AU03-current-work-archive-evidence-entry.md](slices/AU03-current-work-archive-evidence-entry.md) | 所核范围未见偏离 | 现役代码 | 区分当前作品、当前会话与历史回看；证据入口修复不把历史artifact自动升级为现役。 |
| [slices/AU03-file-level-closure.md](slices/AU03-file-level-closure.md) | 现役关键机制偏离 | 现役代码 | 新余项明确读取失败与缺事实分开、搜索只读；当前错误供给链仍有元原则冲突，不能因旧闭环豁免。 |
| [slices/AU03-session-history-readonly.md](slices/AU03-session-history-readonly.md) | 所核范围未见偏离 | 现役代码 | 历史回看不恢复旧授权或pending，当前会话按真实身份恢复，不替模型建立错误作品背景。 |
| [slices/AU03-session-new-active.md](slices/AU03-session-new-active.md) | 所核范围未见偏离 | 现役代码 | 会话创建只管理真实身份/生命周期；不继承旧transcript来填充新会话知识。 |
| [slices/AU04-AU06-author-action-binding.md](slices/AU04-AU06-author-action-binding.md) | 所核范围未见偏离 | 现役代码 | 授权动作、幂等、版本与确认后re-gate属于APP责任；继续矩阵先核B43/B58现役producer，不复活旧等待模型。 |
| [slices/AU04-file-level-closure.md](slices/AU04-file-level-closure.md) | 所核范围未见偏离 | 现役代码 | 计划不自批权限，作者确认与真实执行分层；历史确认矩阵不等同所有新回合语义已实现。 |
| [slices/AU05-adoption-safety-freshness.md](slices/AU05-adoption-safety-freshness.md) | 所核范围未见偏离 | 当前替代链 | 旧高风险方向producer已退役，安全目标由B43/B47/B58与实际采纳链续接，不能伪造高风险候选复原场景。 |
| [slices/AU05-canon-conflict-recovery.md](slices/AU05-canon-conflict-recovery.md) | 所核范围未见偏离 | 现役代码 | 结构化身份/版本证据驱动拒绝或作者覆盖，不让模型文案自行批准canon；自动检测范围仍按B47。 |
| [slices/AU05-conflict-cross-work-recovery.md](slices/AU05-conflict-cross-work-recovery.md) | 所核范围未见偏离 | 现役代码 | 跨作品/冲突来源机械拦截是安全边界，不是APP裁定创作内容；恢复不静默写入。 |
| [slices/AU05-file-level-closure.md](slices/AU05-file-level-closure.md) | 所核范围未见偏离 | 现役代码 | 产出和采纳事实分开，持久待办/过期/投影分别有owner；文件级done不覆盖所有后续。 |
| [slices/AU05-stale-conflict-cross-work-freshness.md](slices/AU05-stale-conflict-cross-work-freshness.md) | 所核范围未见偏离 | 现役代码 | 旧来源不得静默变当前授权；任务以真实版本/作用域为边界，B47续接自动快照计算。 |
| [slices/AU06-file-level-closure.md](slices/AU06-file-level-closure.md) | 所核范围未见偏离 | 当前替代链 | 保留旧confirmation lifecycle证据；现役ask_author/AgentRun恢复需读B26/DS03，不强造所有回合active behavior。 |
| [slices/AU07-behavior-trace-terminal-replay.md](slices/AU07-behavior-trace-terminal-replay.md) | 所核范围未见偏离 | 现役代码 | 真实取消/终态留痕、无provider回放，APP解释保存事实而非补写模型思路。 |
| [slices/AU07-file-level-closure.md](slices/AU07-file-level-closure.md) | 所核范围未见偏离 | 现役代码 | 最新B59/B61承接及旧gate场景退役已区分；继续双视图/多类型时只消费真实producer。 |
| [slices/AU07-gate-reason-why.md](slices/AU07-gate-reason-why.md) | 所核范围未见偏离 | 当前替代链 | 旧action_scope降级已退役；解释门禁仍有效，但不得为旧页面证据恢复不存在的多步producer。 |
| [slices/AU07-partial-replay-ui.md](slices/AU07-partial-replay-ui.md) | 所核范围未见偏离 | 现役代码 | 缺引用显示partial且不重调模型，明确证据不足，符合M3而非补齐假回放。 |
| [slices/AU07-state-trace-adoption-replay.md](slices/AU07-state-trace-adoption-replay.md) | 所核范围未见偏离 | 现役代码 | 采纳与投影引用真实状态变化，回放不产生新内容或新权威事实。 |
| [slices/AU07-trace-query-scope-negative-matrix.md](slices/AU07-trace-query-scope-negative-matrix.md) | 所核范围未见偏离 | 现役代码 | scope隔离和拒绝是机械身份校验，保护作者作品边界，不代模型解释内容。 |
| [slices/AU07-trace-replay-integrity.md](slices/AU07-trace-replay-integrity.md) | 所核范围未见偏离 | 现役代码 | 当前P1按真实producer和版本核回放，B43/B39/VS00F分责，不把查询可见当模型已使用。 |
| [slices/AU08-file-level-closure.md](slices/AU08-file-level-closure.md) | 所核范围未见偏离 | 现役代码 | 阅读消费已采纳事实，当前失败恢复明确未知/旧版本，未以读模型状态代作者采纳。 |
| [slices/AU08-reading-return-context.md](slices/AU08-reading-return-context.md) | 所核范围未见偏离 | 现役代码 | 返回仅恢复同一作品会话，不隐式发送或执行；投影失败等仍由原owner补。 |
| [slices/AU08-volume-structured-planning.md](slices/AU08-volume-structured-planning.md) | 需校准/复核 | 现役代码 | 模型给出卷章规划、作者采纳、APP解析并维护身份/seq的方向合理；现役后继另有按标题词面否决已声明chapter对象的规则，需与类型契约澄清。 |
| [slices/AU09-AU03-session-memory-layering.md](slices/AU09-AU03-session-memory-layering.md) | 现役关键机制偏离 | 现役代码 | 来源分层目标正确，但现役memory refs与实际判断内容不一致，旧通过不能豁免当前M3供给核对。 |
| [slices/AU09-archive-memory-roundtrip.md](slices/AU09-archive-memory-roundtrip.md) | 所核范围未见偏离 | 现役代码 | 模型产设定、作者采纳、APP按显式类型物化；后续模型消费不能只由档案可见或召回日志代签。 |
| [slices/AU09-archive-stats-current.md](slices/AU09-archive-stats-current.md) | 所核范围未见偏离 | 现役代码 | 档案统计来自当前权威数据，不由APP虚构创作事实；待审入口和模型使用是独立后果。 |
| [slices/AU09-character-candidate-per-item-adoption.md](slices/AU09-character-candidate-per-item-adoption.md) | 所核范围未见偏离 | 现役代码 | 当前代码把独立候选拆为set::item身份和单item载荷，动作/采纳按目标单元处理；APP没有以集合存在替作者挑选角色。 |
| [slices/AU09-character-dossier-roundtrip.md](slices/AU09-character-dossier-roundtrip.md) | 所核范围未见偏离 | 现役代码 | 角色主体从已采纳character_seed写入Character，并由档案/探索读同源字段；专业能力不等于另建角色Agent。后续关系/演化消费者仍按原条件推进。 |
| [slices/AU09-character-role-taxonomy-protagonist-policy.md](slices/AU09-character-role-taxonomy-protagonist-policy.md) | 所核范围未见偏离 | 现役代码 | 当前叙事角色只接受结构化合法值，缺省为nil；主角事实按已采纳PROTAGONIST筛选而非首行默认。查询提示追加的是明确事实边界，不在该路径改写角色。 |
| [slices/AU09-cross-work-memory-isolation.md](slices/AU09-cross-work-memory-isolation.md) | 所核范围未见偏离 | 现役代码 | work隔离是来源与权限边界；不把另一作品记忆供给模型，不替模型评判本作品相关性。 |
| [slices/AU09-file-level-closure.md](slices/AU09-file-level-closure.md) | 所核范围未见偏离 | 现役代码 | 治理、作用域和状态是APP边界；旧召回窗口/trace完成不外推当前模型实际材料与使用证明。 |
| [slices/AU09-memory-list-ux-redesign.md](slices/AU09-memory-list-ux-redesign.md) | 所核范围未见偏离 | 现役代码 | 颜色和筛选消费真实治理状态，作者判断管理对象，UI不选择小说语义或改召回策略。 |
| [slices/AU09-memory-management-workbench-entry.md](slices/AU09-memory-management-workbench-entry.md) | 所核范围未见偏离 | 现役代码 | 作者显式创建/确认/锁定/废弃记忆；APP状态门不把provider候选静默升级权威。 |
| [slices/AU09-memory-taxonomy-write-policy.md](slices/AU09-memory-taxonomy-write-policy.md) | 所核范围未见偏离 | 现役代码 | 类型映射和治理边界机械化；新CP2要求实际模型请求与通用观察消费，不能以写入行数充数。 |
| [slices/AU09-memory-trace-roundtrip.md](slices/AU09-memory-trace-roundtrip.md) | 现役关键机制偏离 | 现役代码 | 治理来源可追目标成立；当前reference在模型前记录且supplied ref与内容不齐，used表述需按M3收紧。 |
| [slices/AU09-validity-window-recall.md](slices/AU09-validity-window-recall.md) | 现役关键机制偏离 | 现役代码 | 有效窗是必要边界，但当前仍用最大已采纳章代目标坐标；B64已接债，现役偏差不能由历史closed遮蔽。 |
| [slices/AU09-work-direction-memory-recall.md](slices/AU09-work-direction-memory-recall.md) | 所核范围未见偏离 | 计划/治理方向 | 最新§6明确先冻结方向语义与通用消费，旧最新N条和枚举建议不再当基线；未来不应让APP预定全部相关方向。 |
| [slices/AU10-action-idempotency-stale-disabled.md](slices/AU10-action-idempotency-stale-disabled.md) | 需校准/复核 | 现役代码 | 动作身份/幂等是安全机械校验；旧后续建议为验收保留可重复点击需回链新红线，不自动改产品配合测试。 |
| [slices/AU10-file-level-closure.md](slices/AU10-file-level-closure.md) | 所核范围未见偏离 | 现役代码 | 当前矩阵只验证真实状态与授权消费，并与B43/投影/回放去重，不以卡片显示替代执行事实。 |
| [slices/AU10-workbench-recovery-disconnect-timeout.md](slices/AU10-workbench-recovery-disconnect-timeout.md) | 所核范围未见偏离 | 现役代码 | 失败/取消/断线不写作品，恢复不伪报成功；技术错误copy不冒充创作叙述。 |
| [slices/AU10-workbench-recovery-taskstate.md](slices/AU10-workbench-recovery-taskstate.md) | 所核范围未见偏离 | 现役代码 | 状态来自真实任务事件，FAILED不得被完成掩盖；未恢复无真实消费者的批量运行。 |
| [slices/AU10-workbench-render-stability.md](slices/AU10-workbench-render-stability.md) | 所核范围未见偏离 | 现役代码 | 性能任务的主要方向可由当前机制判断：稳定消息身份用于DOM保留，作者文本/执行语义未被渲染优化替换；条件重构不因历史测量自动开启。 |
| [slices/AU11-creative-partner-conversational-voice.md](slices/AU11-creative-partner-conversational-voice.md) | 需校准/复核 | 计划/治理方向 | 自然创作伙伴目标正确，但旧form_frame/stub锚点/no-tool待办须按B27当前语义重新限定后才能恢复。 |
| [slices/AU11-file-level-closure.md](slices/AU11-file-level-closure.md) | 所核范围未见偏离 | 当前替代链 | 文件已显式退役Envelope并指B27/B40；须核现役接线，不能因历史标签不审或复造旧对象。 |
| [slices/AU11-missing-workstate-policy.md](slices/AU11-missing-workstate-policy.md) | 所核范围未见偏离 | 现役代码 | 空作品不编造的重锚方向有效；读取失败不是空作品，当前共同context降级另有明确冲突owner。 |
| [slices/AU11-quality-diagnosis-message-envelope.md](slices/AU11-quality-diagnosis-message-envelope.md) | 所核范围未见偏离 | 现役代码 | 最新记录按真实reply来源/供给与实模分层重锚；不再恢复三层Envelope对象，质量取舍由模型完成。 |
| [slices/AU12-archive-concurrent-model-run-read-snapshot.md](slices/AU12-archive-concurrent-model-run-read-snapshot.md) | 需校准/复核 | 现役代码 | 同作品已有快照保留、更新/错误提示及跨作品清空的方向与当前机制相符；共享档案组件还把计数/身份写到隐藏data属性供验收读取，D4用途需单独核清。 |
| [slices/AU12-character-identity-merge.md](slices/AU12-character-identity-merge.md) | 所核范围未见偏离 | 现役代码 | 同名不自动合并，作者选择身份；APP确定性迁移别名/账面并让探索可达，遵守作者主权。 |
| [slices/AU12-correction-intent-roundtrip.md](slices/AU12-correction-intent-roundtrip.md) | 所核范围未见偏离 | 现役代码 | 修订从自然意图回主链并经采纳落位，最新P2要求档案/探索/实际模型同源，不能以pending卡代写入完成。 |
| [slices/AU12-file-level-closure.md](slices/AU12-file-level-closure.md) | 所核范围未见偏离 | 现役代码 | 档案展示与修改权分离，真正字段回写及模型消费在原P2接续，不把读取green当全部认知闭环。 |
| [slices/AU12-profile-read-failure-degrade.md](slices/AU12-profile-read-failure-degrade.md) | 所核范围未见偏离 | 现役代码 | UI读取失败不得伪装空档案；重试只读真实数据，APP不发明内容或生成成功结论。 |
| [slices/AU12-work-profile-overview.md](slices/AU12-work-profile-overview.md) | 所核范围未见偏离 | 现役代码 | Work字段只读展示服务作者核对，不由面板改canon；模型输入同源证明和修订落位仍须独立核。 |
| [slices/AU12-work-profile-status-isolation.md](slices/AU12-work-profile-status-isolation.md) | 所核范围未见偏离 | 现役代码 | accepted/tentative和作品scope是机械状态与身份，不用空字段或异作品数据补作者知识。 |
| [slices/Q1B-live-archive-recheck.md](slices/Q1B-live-archive-recheck.md) | 所核范围未见偏离 | 现役代码 | BIZ06已完成语义反例修复：模型消解指代、工具拿实际目标、APP投影真实回执；不重开旧失效批次。 |
| [slices/Q1C-adopted-content-revision.md](slices/Q1C-adopted-content-revision.md) | 所核范围未见偏离 | 现役代码 | 作者裁决保留/替代，版本与来源由APP守护；当前原生补验不缩减已采纳内容修订闭环。 |
| [slices/Q1CB-ADOPTION-TRANSITION-ENFORCEMENT.md](slices/Q1CB-ADOPTION-TRANSITION-ENFORCEMENT.md) | 所核范围未见偏离 | 现役代码 | 持久化转换矩阵保护作者采纳权；已授权LOW维护不自动违规，revive仍按既定延期。 |
| [slices/Q3B-capability-gap-exit.md](slices/Q3B-capability-gap-exit.md) | 所核范围未见偏离 | 当前替代链 | 诚实能力缺口目标保留，旧流程路径候选与call2形态已被Q3D/B26后继收敛，不能恢复为可采纳方向。 |
| [slices/Q3C-author-content-materialization.md](slices/Q3C-author-content-materialization.md) | 需校准/复核 | 现役代码 | 作者原文是合法创作来源，模型判意图、APP保真复制；current来源词法guard仍需复审而非因机械命名豁免。 |
| [slices/Q3D-message-outcome-roundtrip.md](slices/Q3D-message-outcome-roundtrip.md) | 所核范围未见偏离 | 现役代码 | 模型解释record_only/用途，APP记真实消息/运行/采纳与幂等；不从有卡或有文字推断作者已完成。 |
| [slices/SU01-api-key-secret-redaction.md](slices/SU01-api-key-secret-redaction.md) | 所核范围未见偏离 | 当前替代链 | secret脱敏目标有效；旧Keychain后续已被local-file决策替代，当前仍须查真实存储与输出边界。 |
| [slices/SU01-file-level-closure.md](slices/SU01-file-level-closure.md) | 所核范围未见偏离 | 现役代码 | 用户配置真实能力和secret边界，live/vendor条件保留；静态配置与离线matrix不证明真实账号可用。 |
| [slices/SU01-lmstudio-disconnected-health.md](slices/SU01-lmstudio-disconnected-health.md) | 所核范围未见偏离 | 现役代码 | 连接状态来自真实health，不静默换provider；属于能力底座而非创作相关性判断。 |
| [slices/SU01-provider-endpoint-validation.md](slices/SU01-provider-endpoint-validation.md) | 所核范围未见偏离 | 现役代码 | URL合法性是参数边界，APP拒绝非法地址不替模型决定创作；现役HTTP范围另由B65治理。 |
| [slices/SU01-provider-model-list-success.md](slices/SU01-provider-model-list-success.md) | 所核范围未见偏离 | 现役代码 | 模型列表由实际adapter返回而非前端编造；替身只证管线，未代签live服务。 |
| [slices/SU01-provider-vendor-matrix-openai-minimax-zhipu-kimi-gemini.md](slices/SU01-provider-vendor-matrix-openai-minimax-zhipu-kimi-gemini.md) | 需校准/复核 | 现役代码 | 统一Provider和独立secret的方向清楚；现役订阅项仍只有OpenAI兼容传输而在UI普通可选，需明确未实现OAuth/专用传输的能力状态，不能仅凭旧离线matrix判断完整可用。 |
| [slices/SU01-strata-local-models.md](slices/SU01-strata-local-models.md) | 所核范围未见偏离 | 当前替代链 | per-profile发现明确被统一后台替代；当前不能因旧任务完备就恢复扫描本机profile的实现。 |
| [slices/SU01-strata-local-provider.md](slices/SU01-strata-local-provider.md) | 所核范围未见偏离 | 现役代码 | 按最新统一后台提供真实模型目录与请求，不将旧端口/模型名作为恒定创作能力。 |
| [slices/SU02-artifact-projection-trace-isolation.md](slices/SU02-artifact-projection-trace-isolation.md) | 所核范围未见偏离 | 现役代码 | 跨作品隔离以真实身份约束所有结果/状态，APP不代作者跨作采纳或混入旧事实。 |
| [slices/SU02-empty-start-unnamed-work.md](slices/SU02-empty-start-unnamed-work.md) | 所核范围未见偏离 | 现役代码 | 空启动创建真实空作品身份是最低可用元数据，不补造故事内容；作者仍可命名和决策。 |
| [slices/SU02-file-level-closure.md](slices/SU02-file-level-closure.md) | 所核范围未见偏离 | 现役代码 | 作品scope和生命周期有明确事实源，P2损坏/恢复等未以13/13伪关闭，后续按真实范围核。 |
| [slices/SU02-pending-result-work-isolation.md](slices/SU02-pending-result-work-isolation.md) | 所核范围未见偏离 | 现役代码 | 迟到消息按原work/run归属，切换视图不改变生成内容或跨作品授权。 |
| [slices/SU02-work-lifecycle-management.md](slices/SU02-work-lifecycle-management.md) | 所核范围未见偏离 | 现役代码 | 新增/改名/移出由用户发起且保留身份，机械生命周期不等于APP代作者创作。 |
| [slices/SU02-work-restart-recovery.md](slices/SU02-work-restart-recovery.md) | 所核范围未见偏离 | 现役代码 | 恢复真实可用Work，不以lobby或已移出作品造状态；偏好落盘矩阵未自动升级为已验。 |
| [slices/SU03-assistant-display-name-boundary.md](slices/SU03-assistant-display-name-boundary.md) | 所核范围未见偏离 | 现役代码 | 当前显示名仅作为按work保存的本地UI偏好，被assistantRoleLabel消费；发送白名单payload不含该字段，静态边界足以判断不接管模型身份/认知。 |
| [slices/SU03-file-level-closure.md](slices/SU03-file-level-closure.md) | 所核范围未见偏离 | 现役代码 | 当前显示名仅作为按work保存的本地UI偏好，被assistantRoleLabel消费；发送白名单payload不含该字段，静态边界足以判断不接管模型身份/认知。 |
| [slices/SU04-desktop-sidecar-packaging.md](slices/SU04-desktop-sidecar-packaging.md) | 所核范围未见偏离 | 现役代码 | 当前启动/故障/退出是能力基础，先核真实状态；不借恢复默默重放创作或越过数据授权。 |

#### 运行时、正文、契约及v3任务（70份）

| 原任务 | 原则核对结论 | 核对方式 | 决策方向与范围说明 |
|---|---|---|---|
| [slices/D1-character-vacuum-closure.md](slices/D1-character-vacuum-closure.md) | 所核范围未见偏离 | 现役代码 | 角色缺席守则只解释真实快照；具名创作归模型、入档归作者，不把字段缺席直接当创作选择。 |
| [slices/D3-summary-maintenance-reliability.md](slices/D3-summary-maintenance-reliability.md) | 所核范围未见偏离 | 现役代码 | 摘要由模型生成，APP补做/失败容忍与后续读取提供可信材料，不把摘要存在当知识充分。 |
| [slices/D4-planner-transient-retry.md](slices/D4-planner-transient-retry.md) | 所核范围未见偏离 | 当前替代链 | 旧两段阶段仅留历史；现计划provider/结构错误共享一次重试额度并诚实失败。 |
| [slices/D5-inventory-thinking-model-adaptation.md](slices/D5-inventory-thinking-model-adaptation.md) | 需校准/复核 | 现役代码 | 盘点方向仍是模型提炼/作者采纳；现总账用provider事件补计失败调用，但步内递归子调用的预算准入边界仍需明确。 |
| [slices/D6-purpose-model-routing.md](slices/D6-purpose-model-routing.md) | 所核范围未见偏离 | 现役代码 | 用途路由服从作者配置，空表跟随全局不猜模型；剩余双模型UI观察不能由旧stub代签。 |
| [slices/D7-continuation-intent-safe-default.md](slices/D7-continuation-intent-safe-default.md) | 所核范围未见偏离 | 现役代码 | 续写/覆盖由模型表达，APP保护真实章身份、版本和显式作者采纳；机械解析不决定情节。 |
| [slices/DS01-decision-surface-schema-gate.md](slices/DS01-decision-surface-schema-gate.md) | 所核范围未见偏离 | 现役代码 | 现wire检测与运行状态契约服务真实消费，unknown不获得执行权；类型存在不代签接线。 |
| [slices/DS02-adoption-status-canonicalization.md](slices/DS02-adoption-status-canonicalization.md) | 所核范围未见偏离 | 现役代码 | 历史已知采纳状态只在读取归一，不改写原文和存量；不让呈现状态代替真实采纳。 |
| [slices/DS03-awaiting-author-runtime-validity-and-recovery-surface.md](slices/DS03-awaiting-author-runtime-validity-and-recovery-surface.md) | 所核范围未见偏离 | 现役代码 | 真实runtime、作用域与非空作者补充决定恢复；历史快照不能假装live。 |
| [slices/E2E01-file-level-closure.md](slices/E2E01-file-level-closure.md) | 所核范围未见偏离 | 当前替代链 | 现聚合按实际artifact、registry和版本证据计算，旧完成矩阵不作PASS依据；不再因缺本轮运行一律unknown。 |
| [slices/GATE-ORDER-CLOSURE-execution-gate-order-12.md](slices/GATE-ORDER-CLOSURE-execution-gate-order-12.md) | 所核范围未见偏离 | 现役代码 | 独立Orchestrator逐步审权并记录真实理由，模型不能自批执行；门禁不承担创作相关性选择。 |
| [slices/NEM04-scene-craft-planning.md](slices/NEM04-scene-craft-planning.md) | 所核范围未见偏离 | 现役代码 | 解析模型显式场次槽位并供后续消费；结构转换不替模型决定场景或人物行动。 |
| [slices/P1-chapter-adoption-reading.md](slices/P1-chapter-adoption-reading.md) | 所核范围未见偏离 | 现役代码 | 当前正文仅经作者采纳进入阅读事实，未采纳草稿与章节计划不能冒充已写正文。 |
| [slices/P1-chapter-draft-generation.md](slices/P1-chapter-draft-generation.md) | 所核范围未见偏离 | 现役代码 | 真实模型产物保持tentative；专业写作可补读范围仍有限，短稿通过不等于按需求证完成。 |
| [slices/P1-chapter-expansion.md](slices/P1-chapter-expansion.md) | 需校准/复核 | 现役代码 | 现稳定章ref承接早期续写；不恢复title猜归章，当前材料有效窗差距仍须B64。 |
| [slices/P1-chapter-plan-minimum.md](slices/P1-chapter-plan-minimum.md) | 所核范围未见偏离 | 现役代码 | 模型规划经采纳成为结构输入；parser不生成情节，但专业规划固定取材仍需校准。 |
| [slices/P1-prose-companion-artifacts.md](slices/P1-prose-companion-artifacts.md) | 所核范围未见偏离 | 现役代码 | 模型主产物/伴生items保留来源并默认tentative；作者逐项处置，不凑数或自动写canon。 |
| [slices/P1-prose-quality-evidence-and-scoped-revision.md](slices/P1-prose-quality-evidence-and-scoped-revision.md) | 所核范围未见偏离 | 现役代码 | 形式候选不是问题结论，语义evaluator须引用原文并限制范围；统计不代文学判断。 |
| [slices/P1-word-count-audit.md](slices/P1-word-count-audit.md) | 所核范围未见偏离 | 现役代码 | 字数/缺章/重复是可复算事实，现只统计已采纳正文，数值达标不等于文学收益。 |
| [slices/R10R11-VOLUME-DEBT-SCENARIO.md](slices/R10R11-VOLUME-DEBT-SCENARIO.md) | 所核范围未见偏离 | 现役代码 | 卷计划与事实差异产finding交作者，不静默改写卷；机械事实对照不替作者定方向。 |
| [slices/SI-001-scenario-invariants-i3-nonce.md](slices/SI-001-scenario-invariants-i3-nonce.md) | 所核范围未见偏离 | 现役代码 | nonce贯通只验证产物来源，不在产品中创造内容，不声称模型理解或文学质量。 |
| [slices/SI-002-scenario-invariants-ci-enforcement.md](slices/SI-002-scenario-invariants-ci-enforcement.md) | 所核范围未见偏离 | 当前替代链 | 旧Layer-A阶段不恢复，现CI分别强制三不变量；工程守卫不代模型创作。 |
| [slices/SI-003-scenario-invariants-i1-causal.md](slices/SI-003-scenario-invariants-i1-causal.md) | 所核范围未见偏离 | 当前替代链 | 当前I1允许合法作者原文字节；旧Provider-only表述不能否定作者创设权。 |
| [slices/SI-004-scenario-invariants-i2-variation.md](slices/SI-004-scenario-invariants-i2-variation.md) | 所核范围未见偏离 | 现役代码 | 两两差异与空产物拒绝是外部防伪计算，产品不得据验收分支硬编码创作。 |
| [slices/SI-model-behavior-contracts.md](slices/SI-model-behavior-contracts.md) | 所核范围未见偏离 | 现役代码 | 现探针复用生产planner形状；live/nightly仍依真实凭据资源，旧pass_rate不外推当前。 |
| [slices/UA01-CP5-durable-agent-run-resume.md](slices/UA01-CP5-durable-agent-run-resume.md) | 所核范围未见偏离 | 现役代码 | 现恢复区分live与持久状态，stale不静默继续，避免快照自授执行权。 |
| [slices/UA01-CP6-stream-cancel-readonly-batch.md](slices/UA01-CP6-stream-cancel-readonly-batch.md) | 所核范围未见偏离 | 现役代码 | 统一运行时提供作者取消/恢复并诚实回执；未据此声称所有vendor物理cancel均已验证。 |
| [slices/UA01-agent-plan-native-tool-calling.md](slices/UA01-agent-plan-native-tool-calling.md) | 所核范围未见偏离 | 当前替代链 | 现计划tool_prompt已用auto；旧forced方案不是恢复基线，结构校验不替模型规划。 |
| [slices/UA01-agentic-loop-plan-driven-execution.md](slices/UA01-agentic-loop-plan-driven-execution.md) | 需校准/复核 | 现役代码 | 判断和专业profile已分工；当前规划固定三步仍在，不能以历史后继标记免审认知分配。 |
| [slices/UA01-agentic-loop-prompt-hardening.md](slices/UA01-agentic-loop-prompt-hardening.md) | 所核范围未见偏离 | 现役代码 | 新T3–T5以现役来源审历史前缀、观察保真和叙事绑定，不另造planner或恢复两段式。 |
| [slices/UA01-agentic-loop-streaming-reasoning-card-simplification.md](slices/UA01-agentic-loop-streaming-reasoning-card-simplification.md) | 需校准/复核 | 现役代码 | 现代码已auto，流式反馈目标有效；仍doing的两段式后续范围需明确退役与现验收owner。 |
| [slices/UA01-bounded-run-single-candidate-termination.md](slices/UA01-bounded-run-single-candidate-termination.md) | 所核范围未见偏离 | 现役代码 | 作者采纳事实进入run状态，预算挡住未请求额外候选；这是范围控制，不是APP选创作内容。 |
| [slices/UA01-character-evolution-agent-profile.md](slices/UA01-character-evolution-agent-profile.md) | 所核范围未见偏离 | 现役代码 | 角色演化输出仍经tentative与作者采纳，已核共同执行/产物边界，未外推全部专业取证完成。 |
| [slices/UA01-codex-style-narrative-alignment.md](slices/UA01-codex-style-narrative-alignment.md) | 所核范围未见偏离 | 现役代码 | 现UI消费author_narrative/实际事件，流式字节按provider refs归组，状态计数来自运行事实；体裁观感未复跑不妨碍判定其职责方向。 |
| [slices/UA01-dynamic-agent-run-budget.md](slices/UA01-dynamic-agent-run-budget.md) | 所核范围未见偏离 | 现役代码 | 预算按计划成本、作者限制与硬上限分工，扩展须授权，不能暗扩总账或用常量替创作需求。 |
| [slices/UA01-judgment-driven-loop.md](slices/UA01-judgment-driven-loop.md) | 需校准/复核 | 现役代码 | 现判断按模型tool/query取证并留观察；末尾恢复仍指旧CP1，须校准当前CP6与单调用边界。 |
| [slices/UA01-judgment-structured-call-reliability.md](slices/UA01-judgment-structured-call-reliability.md) | 所核范围未见偏离 | 当前替代链 | 现单调用替代call2病灶；作者已停止参数对照转业务审计，不重启旧协议修补线。 |
| [slices/UA01-natural-language-steering.md](slices/UA01-natural-language-steering.md) | 所核范围未见偏离 | 当前替代链 | 现输入选择包含open question、版本与失活状态；旧active一律steer不能覆盖新答复语义。 |
| [slices/UA01-plot-outline-agent-profile.md](slices/UA01-plot-outline-agent-profile.md) | 需校准/复核 | 现役代码 | 大纲仍由模型产出、作者采纳；现flow固定读取/使命/写作，信息相关性与补读自主性需校准。 |
| [slices/UA01-provider-execution-stream-unification.md](slices/UA01-provider-execution-stream-unification.md) | 所核范围未见偏离 | 现役代码 | 统一Provider事实和日志/回放有现代码，B13关联键仍需审计，不把入口存在当日志完整。 |
| [slices/UA01-quality-revision-action-run-anchoring.md](slices/UA01-quality-revision-action-run-anchoring.md) | 所核范围未见偏离 | 现役代码 | finding动作修订保留原文/来源并产tentative sibling，动作身份一致，系统不自动采纳建议。 |
| [slices/UA01-unified-agent-run-mainchain-closure.md](slices/UA01-unified-agent-run-mainchain-closure.md) | 需校准/复核 | 现役代码 | 统一runtime承接模型判断/作者控制，但专业取证仍受固定目标限制，旧四阶段完成不能豁免。 |
| [slices/VS-00F-five-ledgers-three-state.md](slices/VS-00F-five-ledgers-three-state.md) | 需校准/复核 | 现役代码 | LOW账务与作者裁决分工有效；词面情绪匹配对外称符合/偏差，需要复核信号的语义宣称。 |
| [slices/VS-00G-fact-inventory-run.md](slices/VS-00G-fact-inventory-run.md) | 需校准/复核 | 现役代码 | 现显式盘点保留模型提案/作者采纳；开放自动提议和假定富化未明确认知来源，不默认扩知识包。 |
| [slices/VS00D-G-GAP-RECONCILIATION.md](slices/VS00D-G-GAP-RECONCILIATION.md) | 所核范围未见偏离 | 计划/治理方向 | 原文区分历史/开放债务/I10条件；治理不代模型或文学结论，无当前产品实现动作。 |
| [slices/VS00F-information-ledger.md](slices/VS00F-information-ledger.md) | 所核范围未见偏离 | 现役代码 | 信息账按已接受机械规则记进度，伏笔回收由模型提议/作者裁决；不把LOW记账泛化成语义判断。 |
| [slices/WORKBENCH-CURRENT-VOLUME.md](slices/WORKBENCH-CURRENT-VOLUME.md) | 所核范围未见偏离 | 现役代码 | 现卷坐标由真实TurnResult优先、TOC回退，标明source；当前连接身份核对后显示卷名或全书，属于事实定位。 |
| [slices/WR01-chapter-mission-pre-writing-reasoning.md](slices/WR01-chapter-mission-pre-writing-reasoning.md) | 需校准/复核 | 现役代码 | 使命由模型推导但APP预选材料且限制可读目标；引用字段存在不能代签模型可发现和补足缺口。 |
| [slices/WR01b-chapter-mission-author-decision.md](slices/WR01b-chapter-mission-author-decision.md) | 所核范围未见偏离 | 现役代码 | 现repo保留作者确认/改写使命，直接遵守作者约束是主权而非APP替创作；暂定不覆盖权威。 |
| [slices/WR01c-mission-why-brief-and-planning-decision.md](slices/WR01c-mission-why-brief-and-planning-decision.md) | 所核范围未见偏离 | 现役代码 | 规划使命作者版仍优先，当前暂定不覆盖；why/replay目标同源，但未复核全部UI字段来源。 |
| [slices/WR02-planning-mission-pre-outline-reasoning.md](slices/WR02-planning-mission-pre-outline-reasoning.md) | 需校准/复核 | 现役代码 | 现规划固定三步且APP选使命材料，仍有认知分工迁移缺口；B39应承接补读自主性，合法作者约束保留。 |
| [slices/v3/DAG.md](slices/v3/DAG.md) | 所核范围未见偏离 | 当前替代链 | 历史DAG不能代替当前原任务/NEXT；旧Proposed/todo不授权重开已完成实现。 |
| [slices/v3/VS-00-implementation-plan.md](slices/v3/VS-00-implementation-plan.md) | 所核范围未见偏离 | 当前替代链 | 现回复消费模型响应与trace；旧每turn造Frame/fallback计划不可复建，统一decision新增链仍待B43。 |
| [slices/v3/VS-00-reply-only-dialogue-frame-turn-result-trace.md](slices/v3/VS-00-reply-only-dialogue-frame-turn-result-trace.md) | 所核范围未见偏离 | 当前替代链 | 无工具回复可追溯目标由现链承接；真实来源/decision缺口不能靠补空壳满足旧对象要求。 |
| [slices/v3/VS-00A-creative-exploration-loop.md](slices/v3/VS-00A-creative-exploration-loop.md) | 所核范围未见偏离 | 当前替代链 | 现判断模型选择回复/方向/提问，未强迫slot表单；旧docs-ready不是新增实施授权。 |
| [slices/v3/VS-00B-dialogue-context-grounding.md](slices/v3/VS-00B-dialogue-context-grounding.md) | 需校准/复核 | 现役代码 | 现探索由模型请求并记观察；专业消费者仍有预选材料限制，不能把上下文在场等同求证闭环。 |
| [slices/v3/VS-00C-creative-context-assembly.md](slices/v3/VS-00C-creative-context-assembly.md) | 需校准/复核 | 现役代码 | 现坐标/材料投影仍使用，目标有效窗与补读范围有差距；历史CP完成不能豁免当前认知责任。 |
| [slices/v3/VS-00D-ai-guided-authoring-message-contract.md](slices/v3/VS-00D-ai-guided-authoring-message-contract.md) | 所核范围未见偏离 | 当前替代链 | 现输入责任由AuthoringTask与调用链承接；旧Envelope不是目标，仍须核实际材料适用性。 |
| [slices/v3/VS-01-micro-plan-downgrade-confirmation.md](slices/v3/VS-01-micro-plan-downgrade-confirmation.md) | 所核范围未见偏离 | 当前替代链 | 现独立门禁保护执行权，旧多动作降级不能为验收倒造producer；语义建议仍归模型。 |
| [slices/v3/VS-02-tool-request-result-trace-loop.md](slices/v3/VS-02-tool-request-result-trace-loop.md) | 所核范围未见偏离 | 当前替代链 | 现工具授权和回放不重调provider；日志/工具存在不能代签模型已消费全部材料。 |
| [slices/v3/VS-02A-tentative-creative-artifact.md](slices/v3/VS-02A-tentative-creative-artifact.md) | 所核范围未见偏离 | 当前替代链 | 现assembler接合法模型/作者字节到tentative，不把工具成功当采纳；同步伪任务状态不恢复。 |
| [slices/v3/VS-03-clarification-confirmation-behavior-lifecycle.md](slices/v3/VS-03-clarification-confirmation-behavior-lifecycle.md) | 所核范围未见偏离 | 当前替代链 | 现动作校验、显式问题与恢复保护作者输入/执行边界；缺字段不能自动造表单或空行为。 |
| [slices/v3/VS-04-candidate-selection-adoption-boundary.md](slices/v3/VS-04-candidate-selection-adoption-boundary.md) | 所核范围未见偏离 | 当前替代链 | 现动作匹配服务端允许项并经采纳边界，呈现/选择/采纳分离；旧入口不重造权威层。 |
| [slices/v3/VS-05-ui-available-action-roundtrip.md](slices/v3/VS-05-ui-available-action-roundtrip.md) | 所核范围未见偏离 | 当前替代链 | 现输入绑定和动作校验让UI不是裁决器；旧FU回退应先核当前owner实现。 |
| [slices/v3/VS-06-trace-summary-replay-explanation.md](slices/v3/VS-06-trace-summary-replay-explanation.md) | 所核范围未见偏离 | 当前替代链 | 现回放按scope/ref且不调用模型；完整developer权限矩阵本轮未逐项核，不能外推全面完成。 |
| [slices/v3/VS-07-frontend-workbench-ui-consumer.md](slices/v3/VS-07-frontend-workbench-ui-consumer.md) | 所核范围未见偏离 | 当前替代链 | 现wire解析、author_action提交与服务端source/scope校验保持UI收集动作/消费事实职责；不恢复旧卡型或前端裁决。 |
| [slices/v3/VS-08-end-to-end-integration-tests.md](slices/v3/VS-08-end-to-end-integration-tests.md) | 所核范围未见偏离 | 当前替代链 | 旧固定模型/Channel清单不直接恢复；现承接由质量入口按真实artifact来源/内容和分层verdict判定，缺证据不默认为通过。 |
| [slices/v3/VS-09-work-management.md](slices/v3/VS-09-work-management.md) | 所核范围未见偏离 | 当前替代链 | 现WorkService提供显式创建/更名/移出并核版本；Tauri偏好只恢复仍存在的作品ID，管理身份不代作者写内容。 |
| [slices/v3/VS-10-observability-spine.md](slices/v3/VS-10-observability-spine.md) | 所核范围未见偏离 | 现役代码 | 现LogContext使用真实已分配/恢复身份并跨异步透传；日志不产创作结论，B13缺键不由此代签。 |
| [slices/v3/VS-11-desktop-stage-process-ownership.md](slices/v3/VS-11-desktop-stage-process-ownership.md) | 所核范围未见偏离 | 现役代码 | 现脚本按本次PID清理，保护作者服务与环境；属于可信运行边界，不替模型做相关性判断。 |

### 16.8 本轮验证

任务库存与逐项矩阵严格相等：222份、222条唯一记录，无遗漏/重复；50条具体发现的引文/行号与现有源文件一致，代码证据路径/行号可达，纯规则/纯函数探针记录的源码指纹未变。§16共243处本地链接/锚点校验通过，`node scripts/next_task_check.mjs` 与 `git diff --check` 通过。审查后仅在本既有对账和 tasks/README 增加报告/导航；其余原任务、NEXT、产品代码及状态保持审查基线。本轮没有以静态扫描、旧PASS或合成元数据替代真实模型/页面验收。

## 17. 2026-10-30 元原则整改任务与排期梳理

- 状态：**done（本轮文档与队列梳理完成；任何产品/质量判定修复均未实施）**。
- 作者同意按元原则审查结果安排整改；随后明确纠正范围：“我没有想让你改代码哦，只是梳理文档和任务队列”。该限制优先，本轮只保留任务描述、整改 checkpoint、回归要求与排期。
- 越界纠正：AI 曾把“同意”误读为代码实施，临时修改证据链模块、两份测试与质量证据 schema；收到纠正后立即停止，逐文件按进入本轮时的快照恢复。四文件字节一致，其余质量代码无本轮差异；原有 WIP 和本轮文档保留。临时运行结果不是当前修复证据，不得记为B42已修或将CP标完成。

### 17.1 整改范围回到原任务

| 事项 | 唯一执行来源与本次文档交付 |
|---|---|
| 实际请求输入绑定 | [B42 §13](slices/B42-model-behavior-evidence-tier.md#13-元原则整改实际请求输入绑定)：明确时间不能代替输入、未知与空区分、输出调用/used信用及旧派生缓存重算；CP0–CP3和反例表均待执行 |
| B29/B30/B33后置语义路由 | [B33整改小节](slices/B33-authoring-intent-judgment-reliability.md#元原则整改语义判断与机械守卫分工)：统一机制族责任、三条已有反例与完整回归；B29/B30只留交接，不复制状态 |
| 否定范围与整章授权 | [B28整改小节](slices/B28-whole-chapter-revision.md#元原则整改作者范围与否定约束)：读取范围与修改授权分开，接回目标、diff、采纳及B35/B36保护；原业务历史完成不改 |
| 读取失败与缺事实 | [AU03现有入口](slices/AU03-file-level-closure.md#当前上下文缺失与读取失败补验)：补CP0–CP3，区分失败/未知/真实空并进入真实模型输入，不默认全失败都阻断 |
| 实际供给与引用 | [B27 §9](slices/B27-systematic-prompt-and-intent-integration.md#9-元原则整改实际请求材料与引用同源)：实际材料同源、历史/故障与请求证据；原retest6已裁决范围不重开 |
| 专业run求证后续 | [B39交接](slices/B39-evidence-seeking-authoring.md#10-当前初始供给整改的消费交接)：消费B27当前供给整改，保留自身探索/引用/恢复/迁移完整范围，不默认全量memory首轮注入 |
| 事实与权限基础 | B64、B47-C07、B65、B67按既有原任务依次承接；本轮只重排，不复制新的执行状态或假装修复 |

“固化反例”在本轮落实为各任务中的正式回归要求；新增/修改测试属于后续代码实施，不在本轮执行。各项均仍须按完整范围及实际资源条件验证，文档检查不能代签。

### 17.2 排期与范围边界

NEXT当前项改为B42-BINDING的CP0梳理入口；后续优先B33-SEMANTICS、B28-SCOPE、AU03-CONTEXT、B27、B39，再接记忆/指纹/来源/账面基础。原B43移入候选，与B45/schema工作服务实际整改链，其他原候选没有删除或关闭。共1个当前项、39个候选；真实顺序仅维护在NEXT。

收官、情绪等已批准政策保持具体复核流程；Experience Engine、多Agent、批量、实模窗口、历史数据修复等原条件不变。本次重排不授权本轮改代码，也不改任何既有ADR状态或验收标准。

本轮最终核对：11份任务/索引文档净变更，43处新增本地链接/锚点有效；NEXT与空白检查通过。误改的4份代码/测试/schema文件均与本轮开始快照逐字节一致，质量代码目录无本轮差异；验证记录位于 `artifacts/task-audit/2026-10-30-remediation-doc-only/validation.json`。代码修复及新增测试均未保留。
