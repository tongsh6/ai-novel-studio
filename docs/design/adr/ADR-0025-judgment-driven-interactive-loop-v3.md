# ADR-0025：判断驱动交互循环、计划按需与探索能力域

> **2026-10-24 联合修订已接受**：作者确认“确定 开工”，接受 B26/B27 联合设计及 ADR-0001 普通回复来源修订，并授权共享入口实现与验证。下文历史“待 Accepted / 本轮只改文档”描述保留当时语境，不再构成本次实施阻塞；实现和验收仍按各 slice 逐项留证。

- 状态：Accepted
- 日期：2026-07-15（同日 Proposed → Accepted，用户四次方向拍板：消灭形式主义 /
  真循环 / 计划按需 / 探索两翼必须）
- 来源文档：
  - `../notes/2026-07-15-judgment-driven-interactive-loop.md`（完整设计探索，本 ADR 的展开层）
  - `../notes/2026-07-04-agentic-loop-plan-driven-execution.md`（ADR-0023 输入，教训继承源）
  - `../ui/46-state-and-feedback.md` §9.4/§9.5
  - `../00c-state-and-contract-atlas.md` §6.7 / §7
- 影响范围：Dialogue / Execution / Toolbox / Behavior / Trace / UI / Slice
- 相关不变量：改写 `00c` §7 #17（N-PLAN）；沿用 #16（N-NARR）、#18（N-SURF）、#2/#3/#4（执行权）
- 首个证明 slice：`UA01-judgment-driven-loop.md` CP1（对话循环）
- 取代：无（收窄 ADR-0023 适用域，机制保留；ADR-0021/0022 的事件/叙事/边界契约沿用）
- 取代者：无

---

## 背景

ADR-0023 将 agentic loop 从"每步问模型"迁到"计划驱动机械推进"，解决了三个实测
问题（调用经济学 7 次/轮、坏 JSON 灭 run、判断力不足），但把**创作决策**也压扁进
"开头一次性起草计划"：对话 profile 的可选步骤只有四个内部管线阶段 + 依赖硬约束，
模型"起草"结果恒为四步——形式上轨道由模型签名，实质是管线伪装成计划，每轮多付
一次结构化调用且信息量为零。2026-07-15 用户四次拍板校正方向（详见来源 note）。

## 决策范围

1. 交互循环的形态与三类节点定义。
2. 计划按需：是否制定计划由模型判断。
3. 探索能力域两翼的框架（工具与索引细节由 slice 冻结）。
4. N-PLAN 不变量改写。
5. 判断调用协议选型。

## 非目标

- 不改变执行权边界（ADR-0003/0004/0005/0021：判断只有建议权，动作逐一过 gate）。
- 不改变叙事作者权与字节绑定（ADR-0022 / N-NARR）。
- 不改变 S1-S7 决策面契约（ADR-0024）。
- 不冻结检索工具箱/索引/SearchProvider 的具体 schema（CP5/CP6 slice 冻结）。
- 不冻结 judgment 事件的最终命名（CP1 slice 冻结，须回连 46§9 事件族）。

## 考虑过的方案

### 方案 A：维持 ADR-0023 计划驱动，仅对话 profile 免起草
- 优点：改动最小，省 1 次调用。
- 缺点：创作决策仍被压在开头起草；交互场景"下一步取决于上一步结果与作者反应"
  的本质没有解决；D 系修订被迫当常规路径用。

### 方案 B：按场景预分配（交互式走循环、长任务走计划）
- 优点：循环与计划各得其所。
- 缺点：app 预分类"什么算长任务"是另一种写死；被用户否决。

### 方案 C：判断驱动循环 + 计划按需（选定）
- 循环：机械准备 → 模型判断① → 执行 → 模型判断② → 收束/继续/等待作者。
- 计划是判断①的可选输出：模型认为复杂才基于能力目录制定（真信息、作者可预览、
  活文档可修订）；简单请求直接执行。
- 缺点：判断质量依赖模型（以 MBC 探针与预算 backstop 兜底）；验收资产再迁移。

## 最终决策

采用方案 C。冻结以下五点（展开与示例见来源 note）：

### 1. 循环形态与三类节点

```
作者输入 → 【机械】组装上下文（0 调用）
  → 【判断①】理解意图 + 判断本轮形态（叙事流式）：
      简单→直接回复/单动作 ｜ 复杂→制定计划 ｜ 信息不足→探索 ｜ 需作者→停（S3/S4）
  → 【探索】内部检索作品事实 / 外部搜索世界知识（只读、低门禁、记预算）
  → 【执行】经 Orchestrator 门禁产出（回复 / tentative 草稿）
  → 【判断②】观察 + 续行判断：收束 ｜ 继续 ｜ 停等作者裁决（S1/S2/S5）
  →（循环，直到收束或停在作者处）
```

- **机械准备**判据：输出对相同输入恒定、不含创作判断——永不问模型。
- **模型判断**：判断①并入原路由语义（不再独立路由调用）；判断②复用
  `evaluation_of_last` 结构与 D 系观察底座，"目标已达成"必须结构显式。
- **用户裁决**：S1-S7 是循环的一等暂停出口（awaiting_author），非异常分支。

### 2. 计划按需

"是否制定计划"由模型判断，app 不得强制起草、不得按场景预分类。模型制定计划时：
结构沿用 AgentPlan（能力目录为可选目标集）、活文档可修订（D 系机制沿用）、
`plan_drafted/plan_revised` 事件照发、UI 恢复步骤/进度显示（46§9.5 删的是恒定
伪计划，真计划值得展示）。

### 3. 探索能力域（框架）

- **内部翼**：作品事实索引（起步 SQLite FTS）+ 只读检索工具箱（search_prose /
  query_character_scenes / query_foreshadowing / query_timeline 等）。
- **外部翼**：SearchProvider 抽象（与 LLM gateway 同构）+ web_search 工具；
  搜索结果只能产出**带来源出处的 tentative 设定候选**，经作者采纳进 canon；
  搜索行为作者可见、query 进 trace、网络出站需显式授权边界。
- 探索预算并入既有 backstop；无新信息连续探索命中 no-progress 停机。

### 4. N-PLAN 改写（`00c` §7 #17）

> 当存在计划时，计划必须由模型制定并维护，app 不得预制计划轨道；**是否制定
> 计划由模型判断**，app 不得强制起草也不得按场景预分类；无计划循环的轨道 =
> 逐次 judgment 事件链，同样禁止 app 预制创作决策（机械准备步除外）。

### 5. 判断调用协议

> **2026-10-24 B26 / B27 联合修订稿（作者已接受并授权实施；单调用共享入口已随 B26 CP2 落地，完整验收见 B26 §11–§14 与 B27）**：保留作者已经选择的“删除两段式、不兼容、不分档、单调用 auto”方向。协议真源为 [UA-01 §2.2](../contracts/UA-01-unified-agent-run-loop-contract-pack.md)，共同任务/规则语义真源为 [VS-00D §11](../contracts/VS-00D-ai-guided-authoring-contract-pack.md)。本稿替代 2026-10-23 注记中的回复空行解析、旧原文登记参数组合、续行第二停等入口及探索双入口；以下旧方案仅为历史记录。
>
> 起因与证据边界：旧实现为保作者可见流式叙事，将一次判断拆成两次调用；这增加了叙事/动作分叉和提问无结构出口。既有前缀工作解决的是缓存布局，不证明语义一致。CP0 LM Studio 的 11/13 有效样本与基线 13/16、另3次超时支持原型可行，不能作为总体更准或业务全链通过的证明。原型仍保留复述/报形态且工具集合不完整。
>
> **联合目标协议**：
> - 每次判断/计划推理单调用 auto，文字与动作同一有效响应；必要取证后判断、补计划和纠错按真实次数计，不限制作者整个请求只有一次推理。
> - 普通回复是整段 content，无空行/标题解析、无默认方向/物化动作。需要业务结构时，propose_creative_directions、register_author_content、report_capability_gap 分别保留已有方向、原文候选和缺口语义；不再为普通回复加第二次分类调用。
> - 原文登记必须显式来源，应用逐字读取源消息并走既有候选/去重/采纳，不由模型提供替代正文；旧 action=reply/frame_type=capability_gap 联合条件在迁移时撤销，来源与主权保护保留。
> - 初始与续行的模型停等只调 ask_author；question/options 必填、options 可空，选项/自由文本绑定实际问题、run、goal version 和来源，旧问题不可回复新任务。continuation_decision 只允许 continue。应用预算/失活/no_progress 等运行状态沿现有机制。
> - 探索只经 judgment_decision{action: explore, explore_request}，不同时暴露底层 native 探索工具。execute/plan/explore 及计划组合按 UA-01 的 profile 矩阵验证，整组通过后才派发，非法组合不产生部分副作用。
> - 计划起草/修订也 auto；判断内可内联计划，缺计划时后续起草计真实额外调用；非判断入口仍为专属 plan 工具调用。使命/writer/evaluator 等专用输出不因本决定无依据改协议。
> - 六项复审后的具体状态/恢复见 UA-01 §2.2.2 A 与 §2.2.3a：空选项始终有系统回复动作；缺口报告结束 run 但明确目标未完成；普通回复按 VS-00D §11.4 留证，不虚构结构字段。B26 QA/OUT矩阵与 B27 §6.1 固定阈值必须分别通过，文档对齐不能代替验收。
> - 同源不自动等于一致；B27 管输入、范围、证据、效果与规则整合，app 机械检查不取代模型文学判断。文本与工具各自遵守 N-NARR，不能混绑无效尝试或由 app 代写完成结论。
> - B26 管工具/schema/响应/运行/回传/计数/删除，B27 管任务语义与全调用点规则。先 B26 CP1＋B27 CP0 共同设计，再 B26 CP2＋B27 CP1/CP2 共享入口一次迁移；协议/业务保留先验证，之后专业调用整合与语义/页面验证，分项收口。
>
> 本节保留 2026-10-24 文档阶段语境（当时只改文档）；后续作者已接受联合修订并授权实施，单调用共享判断/计划入口与提问/业务输出已随 B26 CP2 迁移，证据与剩余缺口见 B26 §11–§14。模型质量债只能在输入/能力/协议完整且实证后判断，不能把应用缺口推给模型或作者，也不能因此恢复双协议降级。

**历史方案（已被上述目标替代；保留决策背景，不作为新实施依据）**：

方案 A（判断两段式，3/4~5 次）；thinking 系空 content 模型降级：
方案 C（单调用、叙事走 arguments，无流式——仅降级路径）。
CP1 实施前置：MBC 探针验证方案 B 内联协议与"是否开计划"判断质量。

## 决策理由

判断分布在全程才是用户要的创作伙伴形态（Codex 同构）；计划按需消灭了两种写死
（恒定伪计划与场景预分类）；探索让判断有据可依；三层权力结构（能力空间归系统、
判断与计划归模型、门禁与裁决归系统与作者）在本 ADR 下更加清晰而非削弱。
ADR-0023 的三个教训以机制而非架构承接：机械准备永不问模型、坏结构重试 +
awaiting_author 不灭 run、预算与 no-progress backstop 原样。

## Contract 影响

- 改写：`00c` §7 #17（N-PLAN）。
- 新增：judgment 事件族（命名 CP1 冻结）、探索工具箱与 SearchProvider contract
  （CP5/CP6 冻结）。
- 修订注记：ADR-0023（适用域收窄）、`contracts/UA-01` 契约包（循环语义补充，
  CP1 时落）。
- 沿用不动：ADR-0021/0022/0024、S1-S7、N-NARR、N-SURF。~~两段式流式协议~~（2026-10-23 B26 作废，见 §5 修订注记；流式叙事改由单调用 content 承载）。

## Umbrella 边界影响

- `novel_application`：判断循环运行时（替代交互场景的计划游标）、判断①/②
  prompt 资产、探索动作编排。
- `novel_agent`：SearchProvider 抽象（CP6）；LLM provider 协议不变。
- `novel_domain`：judgment 记录结构（若需新纯 struct）；AgentPlan 不变。
- `novel_persistence`：作品事实索引（CP5）；judgment 事件沿用 AgentRunLog。
- `frontend`：46§9.5 文档流已就位；真计划步骤恢复显示（CP4）。
- novel_web：B26 联合修订明确修改 author_choice 分派、源问题 TurnResult 查找、payload/作用域/当前问题/提交回执校验与恢复投影；业务语义仍在 application。撤销旧“透传，不应修改”范围，不新增 Channel 事件。

## UI / Trace / Replay 影响

- UI：判断叙事即 46§9.4/9.5 的段落体（不变）；探索显示活动行「正在查阅…/
  正在搜索资料…」；真计划恢复步骤/进度。
- Trace：judgment 事件链 + 探索 query 全文进 trace；外部搜索来源引用随设定
  候选持久化。
- Replay：不重调 provider/搜索；judgment 链可回放解释"当时为什么这么判断"。

## 垂直切面证明

- 历史 CP1（两段式对话循环证据；新迁移按 UA-01 §2.2.7）：简单对话 2 次调用、叙事流式增长、judgment 事件链完整、
  无第二 user_message；真实 Tauri + 既有 I1/I2/I3/N-NARR 全绿。
- CP2/CP3（创作循环）：候选产出停 S1/S2；D 系在循环语义下回归。
- CP5/CP6（探索两翼）：检索命中进判断上下文；外部设定候选带来源、未采纳不进
  canon（I3 类种子断言）。
- N-PLAN driver 按新表述迁移："模型制定计划的 run 有 plan 事件链且结构来自
  native tool call；无计划 run 有 judgment 链且无 app 预制轨道。"

## 迁移与兼容

- ADR-0023 机制保留（机械推进用于"模型制定的计划"、D 系、重试、backstop），
  适用域由"一切 run"收窄为"模型判断需要计划的 run"。
- 现有 profile 逐 CP 迁移，未迁移 profile 维持计划驱动直至其 CP。
- 验收资产随各 CP 迁移，禁止机械弱化。

## 后续工作

- 需要更新的设计文档：`00-vision` 形态章（随本批落地）、`00c` §6.7/§7/§8、
  ADR README、46§9.6 指向、`contracts/UA-01` 循环补充（CP1）。
- 需要创建的 slice：`UA01-judgment-driven-loop.md`（CP1 起）、探索两翼 slice
  （CP5/CP6）。
- 前置验证：MBC 探针——方案 B 内联协议、"是否开计划"判断质量（CP1 开工条件）。
- Deferred：judgment 事件命名、探索授权粒度与 query 脱敏、SearchProvider 选型、
  循环场景进度行表达、awaiting_author 续行语义（开放问题 1-7，见来源 note §8）。

## enforced_by

- apps/novel_application/lib/novel_application/judgment_protocol.ex
- apps/novel_application/lib/novel_application/dialogue_planning_service.ex
- apps/novel_application/lib/novel_application/agent_run_flows/judgment_plan.ex
- apps/novel_application/lib/novel_application/exploration_service.ex
- apps/novel_agent/lib/novel_agent/agent_task_profile_registry.ex
- apps/novel_application/test/novel_application/judgment_protocol_test.exs
- apps/novel_application/test/novel_application/agent_run_judgment_plan_flow_test.exs
- quality/acceptance/scenarios/wr02-planning-mission-before-outline.yml

## enforcement_gaps

- 【B26/B27 实施（2026-10-24）】共享判断与计划已切为单调用 auto，ask_author/author_choice、固定 schema、来源记录与协议唯一性守卫已实装。`scripts/model_contracts/single_call_compliance.exs`、`author_question_roundtrip_test.exs`、I-CACHE/N-NARR 与原生问题回复已有证据。完整 QA/OUT 原生与故障矩阵、B27 全专业调用与20例双臂语义评估仍有缺口，详见 B26 §11 / B27 checkpoint；局部 PASS 不等于 slice done。

- 【B13b 裁决（2026-10-22）：修复-独立 slice（等触发）】CP6 外部探索翼仍未实现：`SearchProvider`/`web_search`/带来源 out 的 tentative 设定候选/网络出站授权边界均无代码（全仓 grep 0；内部翼 `exploration_service.ex` 已落地），slice CP6 标 todo。触发=作者真实需要现实知识资料（历史/科学/设定考据）进入创作判断且内部翼 explore 未命中率可观测/被反馈时，开 `UA01-CP6-external-exploration`（Contract=ADR-0025 §3 外部翼+SearchProvider contract；Invariant=只产带来源 tentative 候选、未采纳不进 canon、query 全进 trace、网络出站显式授权；Acceptance Driver=真实 Tauri：现实资料问题→搜索活动行→带来源候选→采纳进 canon）；开工前须作者先拍板网络出站授权粒度与来源可信度边界。
- 【B13b 裁决（2026-10-22）：修复-本批】conversation manifest 未迁移为真（`agent-conversation-turn.yml:32/35/54/56/58/59` 仍写 conversation_turn_v1 计划链 4/3；driver/verifier/artifact 已迁 judgment_loop_v1 2/2，见 `native-tauri-verifier.mjs:6038-6180`、`agent-conversation-turn-tauri-lmstudio/summary.json` 2026-07-20），本批重写该 manifest。原“只能由 wr02 证明判断①选 plan 支路”不成立：`judgment-plan-multi-step` 已有真实 Tauri 证据（`artifacts/slice-verify/judgment-plan-multi-step-tauri/summary.json` 2026-07-19，judgment_plan_v1、4 步、3 产物；verifier `:6324-6392`），但未注册 `quality/acceptance/scenarios.yml`、只在 `tauri_slice_verify.sh:306-330` UA01 alias 白名单 → 本批补注册（新增 manifest + scenarios.yml 条目），使 CP1 reply/plan 两支路均为可复跑质量场景。
