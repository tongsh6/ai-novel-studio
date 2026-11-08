# 产品级偏差诊断：会话结构在运行时缺失（2026-11-08）

> 状态：**讨论备忘录（不授权实现）**。本文是只读诊断，不冻结构，不改代码；若结论进入实现，必须先升级到 contract/ADR/slice 设计。
>
> 触发：B71 G6（压缩后真实请求）长期无法取证。按作者指示，不把压缩当作独立小功能修补，而是回到愿景与元原则，检查它暴露的产品级偏差。

## 1. 结论（先行）

**压缩/G6 只是症状。产品级偏差是：会话结构（session）在运行时没有被作为 canonical 事实与上下文主体——每个 turn 的执行是一个独立、不继承历史的 run；session 退化为展示流容器。**

由此派生：
- 跨轮上下文断裂：第二轮请求不含上一轮的作者诉求、观察、决策、承诺（模型每轮从零开始）；
- 会话级 canonical 事实源缺失（"唯一运行事实源"实际是"每次 run 的事实源"）；
- 压缩没有对象（长会话在实现中不存在）→ 自动维护不可达、G6 无法取证；
- 审计/回查、跨轮义务（D8 类）只能靠作品档案、状态字段与展示流补偿，形成结构性补丁。

## 2. 设计意图（愿景/契约原文）

- 愿景 §2.1：「v3 的本质是一个小说创作 Agent 系统。它的核心……是**每一轮用户与 AI 交互时的会话结构**」；并明确「作者的显式诉求如何**跨 turn 存续**：诉求在被满足或被作者撤回前是待满足的义务，不随单 turn 消费而消失；同一义务重复未满足必须升级（D8 判例）」。
- 愿景 §2.4（元原则）：「观察必须形成**证据闭环**……并进入后续模型请求」；「按需求证复用统一 AgentRun 的观察、预算、取消、**恢复**与留痕」。
- 愿景 §1/§2：「LLM 应该是**作者可感知的创作伙伴**」；「可审计、可规划、可持续迭代」。
- VS-00L §16.1 标题：「**单一 canonical 会话边界**」；§16.6：「**已有会话保留全部消息**，新阶段必须追加该角色完整规则」。
- VS-00L 第 99 行：「**长会话只通过 `checkpoint` 消息压缩**：必须记录覆盖的 **turn 范围**、来源 refs、版本、省略范围与不可见性说明」。
- VS-00L 第 221 行 G6：「**长会话** + checkpoint(covers/refs/versions/omissions)——checkpoint 是唯一压缩表达；作者原文/artifact 字节可回查」。

## 2.5 同构性判断（2026-11-08 作者纠正）

**对话不是"过程记录"，而是工作面；这一点与 Codex/Claude Code 同构。**

| 层 | Codex / Claude Code | 我们（应然） |
|---|---|---|
| 工作面 | session 对话（作者指令、AI 判断、工具调用与观察、承诺、上下文压力） | session 对话（作者意图、创作判断、观察、承诺、上下文压力） |
| 事实材料 | 代码仓库/文件系统，通过工具读取（按需、不预装） | 应用内部作品信息（章节/角色/设定/采纳状态/版本），通过工具读取（按需、不预装） |
| 事实格式 | 文件/代码（通用文本） | **结构化作品事实 + 采纳门 + 版本/证据链**（我们的产品差异） |
| 作者安全 | 无（开发者向，token/命令可见） | 作者可见面安全（无技术词、失败静默、幂等恢复）（我们的产品差异） |

**推论**：
- "对话空间连续进入每轮请求（压缩后）"不是创作产品的特殊需求，而是与外部工具**同一范式**；本报告的 P0-1（跨轮上下文断裂）因此不是"差异化设计"，而是偏离了共同范式。
- 我们的真实差异只在**事实材料与产品契约层**（结构化作品事实、采纳门、证据闭环、作者安全），不在会话模型本身。
- 因此修复不必发明新会话模型，可直接对齐成熟范式：**session 工作面连续 + 压缩投影 + 工具读取事实**，再叠加我们的契约要求。

## 3. 实现事实（只读证据）

### 3.1 新 run 不继承会话历史（代码事实）

- `NovelApplication.JudgmentProtocol.new_transcript/4`（`apps/novel_application/lib/novel_application/judgment_protocol.ex:635`）：新 transcript 从 `RequestIR.application_base_text()` + `system` + **当前作者输入**（`author_text`）+ **当前 scope** 构造；`:transcript` 传入时只走"追加规则"，**没有跨 run 加载/继承路径**。
- canonical transcript 持久化在 **`agent_runs.authoring_transcript`**（run 级私有 JSON 列，VS-00L §16.12）；没有会话级 transcript 表/模块。

### 3.2 同 session 多 run 的真实批次证据

`artifacts/slice-verify/b71-first-consumer-auto-maint-cp4b-auto-maint-a3/database/*.sqlite3`（同一 session，6 个 run，A3 跨 run 续行批次）：

| run | 该 run transcript 中的作者消息 |
|---|---|
| run 1 | 「先读一下第01章的正文和章计划，我想知道现在的进度。」 |
| run 2 | 「再读一下第02章的正文和章计划，确认两章之间是否连贯。」 |
| run 3 | 「继续读一下第03章的计划，然后告诉我下一步该写什么。」 |
| run 4 | 「再看一下第01章的正文，确认开头是否抓人。」 |
| run 5 | 「把刚才读到的线索汇总一下，哪些还能继续用？」 |
| run 6 | 「最后再核对一遍第02章的正文，确保没有遗漏。」 |

- 每个 run 的 canonical transcript 都是 `application_base` + **仅本 run 的作者消息** + `scope_update` + 本 run 的 assistant/tool 交换；**不含任何历史 run 的消息/观察/判断**。
- run 5 的「把**刚才**读到的线索汇总一下」类跨轮指代，模型只能依赖作品档案与工具重新读取，而不是会话事实。

### 3.3 会话历史的存在形态（非 canonical）

- `:session_transcript` 只作为**旧上下文装配材料类型**存在（`NovelDomain.ContextSourceRef`、`ContextAssembler` 的类型/摘要名），由旧 `DialoguePlanningService.judgment_context_step` 的 `ContextAssembler.assemble_for_input` 装配；
- **B71 判断主链不消费它**（`agent_run_server.ex` / `judgment_protocol.ex` / `authoring_session.ex` 无 `session_transcript` 引用）；
- 作者可见消息流/历史来自 `Interaction`/`TurnResult` 持久层（按 work/session/turn 查询），是展示与回查数据，不进入模型请求；
- `AgentRunHistory` 是"按 work/session/turn 解析已持久化 run"的**读取边界**，不把历史带入新 run 上下文。

### 3.4 压缩作用域 = run + "更早作者回合"（双重不可达）

- `TranscriptCompaction.plan_maintenance/2` 作用在 `stage_state.judgment_transcript`（run 内），且以「最后一条 `role=="user"` 消息位置」为当前回合起点，**只整理更早作者回合**（`current_turn_start` 排除当前回合）；
- 运行证据：实模 b1（同 run 4 完整交换、usage 32497、**0 checkpoint**）；实模 b2/obs-01（**0 checkpoint**）；确定性 planning/revision 批次（单 run 5 完整交换、usage 越线、**0 checkpoint**）；
- 测试把该实现选择锁定为"预期行为"（`transcript_compaction_test.exs:261/296`），而契约只要求"保留最近 K 项已完成交换 + 不压缩未完成/未闭合交换 + 作者原话/当前 scope/原序"，**没有"当前工作回合永不整理"**。

## 4. 偏差清单

| 编号 | 偏差 | 证据 | 违背 | 级别 |
|---|---|---|---|---|
| P0-1 | 跨轮上下文断裂：模型看不到上一轮诉求/观察/判断/承诺 | §3.2 六 run 证据；§3.1 new_transcript | 愿景 §2.1（会话结构/诉求跨 turn 存续）、§2.4.3（观察进入后续请求）、D8 判例 | P0 |
| P0-2 | 会话级 canonical 事实源缺失：唯一事实源实为 run 级 | §3.1/§3.3；无会话级 transcript | VS-00L §16.1 名实不符；可审计/回放/压缩失去会话对象 | P0 |
| P1-1 | 压缩/G6 不可达（症状） | §3.4 全部批次 0 checkpoint | §99/§221「长会话压缩」 | P1 |
| P1-2 | 跨轮义务/语义对账靠状态字段与展示流补偿（D8 类复发风险） | behavior/goal 字段跨轮传递；展示流非事实源 | 愿景 §2.1；D8 | P1 |
| P1-3 | 旧 `session_transcript` 材料类型残留但主链不消费（语义双轨/漂移） | §3.3 | 项目「不缝合怪」「彻底重构」原则 | P1 |
| P1-4 | 验收被反向使用：为让 G6 有证据长期构造异常路径/构造场景，掩盖产品缺陷 | A3/A3b 多轮失败与归因反复修正 | 场景化验收的初衷（发现缺陷） | P1 |

## 5. 根因判断

1. **run 与 session 的职责/事实边界从未定义**：run 被当作执行单元，也被隐式当作上下文与事实单元；session 只有展示与查询语义。
2. **CP3/CP4 单链重构把上下文收敛为「作品档案 scope + 当前输入」**，会话历史退出模型上下文；但 compression/审计/G6 的契约仍按会话假设，形成设计语义漂移。
3. **验收体系长期以「单次 run 的执行正确性」为中心**，没有把"会话连续性与跨轮证据闭环"作为第一性检验，导致偏差以"G6 不可达/模型不配合/场景不可构造"的形式反复出现。

## 6. 影响面

- **作者体验**：模型无法成为"记得这次会话"的伙伴；跨轮指代、承诺、未满足诉求只能靠档案/状态补偿；D8 类"每轮从零判定"风险。
- **模型行为**：跨轮观察无法进入后续请求，元原则的"按需求证 + 证据闭环"只在单 run 内成立。
- **产物/审计**：压缩/G6 无对象；Why/回放基于 run 碎片 + 展示流；"会话到目前为止发生了什么"没有单一事实源。
- **工程**：双轨数据边界（run canonical vs Interaction 展示流）；压缩、历史回查、长会话上下文都需要在错误层级打补丁。
- **验收**：真实多轮会话场景无法作为第一性证据，只能构造异常路径。

## 7. 修复方向选项（供作者裁决，不预设）

> **2026-11-08 二次修正（作者纠正）**：本报告早前把"对话"表述为过程记录、把"作品档案"当作与外部工具不同的"事实权威"，这是错误论证。正确认识是同构的：**对话是工作面**（与 Codex/Claude Code 的 session 同构），**应用内作品信息是被工具读取的事实材料**（与代码仓库文件同构）；差异只在产品契约层（结构化事实/采纳门/证据链/作者安全）。见新增 §2.5。会话历史连续进入每轮请求由此成为范式要求，而非可选优化。
>
> **2026-11-08 修正记录**：初版方案 A 曾写作“每轮最小上下文派生”，是把元原则 §2.4「最小供给」（针对作品知识/素材）错误平移到会话连续性上的引申。若每轮上下文最小化（不含会话历史），压缩将失去对象、与压缩机制自相矛盾（外部工具如 Codex/Claude Code 也是每轮携带压缩后的会话历史，而非每轮从零）。正确表述为：**会话历史连续进入每轮请求，经 checkpoint 压缩投影控制规模；素材仍按最小供给按需求证**。此修正不改变本报告的偏差结论、证据与其它章节。

- **方案 A：会话级 canonical 运行事实源 + 每轮请求携带压缩投影后的会话历史（符合愿景）**
  会话（session）的 canonical transcript（跨 turn 的运行事实：作者回合、工具交换、观察、checkpoint）成为唯一事实源；run 是会话的执行单元。每轮请求的上下文 = **会话历史（经 checkpoint 压缩投影：更早交换折叠为 covers/摘要，保留最近 K，作者原话与当前 scope 原序）** + 当前作品档案/scope + 当前作者输入 + 按需求证观察。
  注意：**元原则 §2.4「最小供给」约束的是事实材料供给（不预装全集、模型按需求证），不约束会话连续性**（对话是工作面，见 §2.5）；压缩不是附属功能，而是维持"长会话历史连续 + 窗口可控 + 证据保真"的核心机制。压缩/审计/回查/G6 均以会话为对象。代价：持久化、恢复、三类投影、性能、契约落地与迁移——架构级重构，符合"未发布、彻底重构、clean"前提。
- **方案 B：过渡态（显式会话摘要材料进入每轮请求，保留 run 级 canonical）**
  只补"连续性"而保留 run 级事实源；压缩仍无对象、G6 仍不可达；属过渡但存在"缝合"风险。
- **方案 C：重新定义产品为单轮执行器**
  承认 session 仅为展示层，修订愿景 §2.1 与契约会话语义；与项目愿景冲突，除非作者重新裁决。

## 8. 需要作者裁决的问题

1. 会话（session）与 run 的职责/事实边界如何定义？canonical 事实源的层级是会话还是 run？
2. 压缩（checkpoint）作用域是会话历史（跨 turn，§99 语义）还是当前 run 上下文？
3. 跨 turn 义务/诉求（D8 类）应由会话 canonical 承载，还是继续由状态字段 + 展示流承载？
4. 旧 `session_transcript` 材料类型的处置（删除/迁移/明确保留边界）？
5. 验收第一性标准：以"真实作者多轮会话的连续性 + 证据闭环"为准，还是继续以单 run 执行正确性为准？
6. 若选方案 A，是否立即进入 ADR 与承重 slice 设计（会话级 canonical 事实源 → 每轮上下文派生（会话历史压缩投影 + 素材按需求证）→ 压缩/审计/G6），并按项目节奏分期？

## 9. 证据索引

- 跨 run 会话批次：`artifacts/slice-verify/b71-first-consumer-auto-maint-cp4b-auto-maint-a3/`（6 runs，SQLite `agent_runs.authoring_transcript`）
- 实模 G6 批次：`artifacts/slice-verify/b71-first-consumer-live-cp4b2-iq3s-01/`（本地批次目录含 summary/DB）
- 确定性探针：`artifacts/slice-verify/b71-authoring-planning-tauri-native-cp4b2-g6-det-probe-01/`、`.../b71-authoring-revision-tauri-native-cp4b2-g6-det-probe-03/`
- 代码：`judgment_protocol.ex:635`（new_transcript）、`transcript_compaction.ex`（plan_maintenance/current_turn_start）、`agent_run_server.ex`（maybe_auto_maintain）、`context_assembler.ex`/`dialogue_planning_service.ex`（session_transcript 旧材料）
- 契约：`docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md` §16.1/§16.6/§16.12/第 99/221 行
- 愿景：`docs/design/00-vision-and-engineering-roadmap.md` §2.1/§2.4
