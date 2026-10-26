# Product User Journeys / 用户旅程地图

> 最后更新：2026-10-24（执行状态归原任务，本文只维护体验断点与覆盖；不再镜像队首）
>
> 角色：v3 产品级用户旅程总图。本文按真实用户目标组织 SU/AU、v3 主链对象、contract、不变量、证据和断点，负责回答：
>
> - 用户完整体验应怎样连续发生？
> - 当前最长闭环前缀走到哪里？
> - 下一步为什么应补这个断点？
> - 每个断点消费哪个 v3 契约，保护哪个系统不变量？
>
> 本文不是完整 acceptance，不替代 `docs/design/acceptance/`；不是事实台账，不替代 `docs/project-ledger.md`；不是执行队列，不替代 `tasks/NEXT.md`。
>
> 2026-05-22 验收卫生更正：历史行里的旧 `scripts/tauri_slice_verify.sh <slice-id>` 命令只表示当时沉淀过 Tauri 证据。清理嵌入式验收钩子后，当前可重复运行的原生 Tauri 验证只保留已迁移到外部 UI driver 的 slice；历史 slice 必须补外部 Playwright driver 后才能重新加入 `--list`，不得在产品 React 或 Channel 中恢复 autorun / UI state 上报钩子。
>
> 输入来源：
>
> - `docs/design/00-vision-and-engineering-roadmap.md`
> - `docs/design/00b-end-to-end-dialogue-flow.md`
> - `docs/design/00c-state-and-contract-atlas.md`
> - `docs/design/07-workbench-ui-contract.md`
> - `docs/design/acceptance/SCENARIO-BLUEPRINT.md`
> - `docs/design/acceptance/README.md`
> - `docs/project-ledger.md`
> - `tasks/NEXT.md`
> - `docs/product/novel-output-milestones.md`

---

## 0. 定位

v3 的产品愿景不是“更会聊天”，而是：

```text
作者通过 LLM 进行创作；
LLM 是作者可感知的创作伙伴；
工作台是 LLM 和执行系统背后的装备库、技能库、武器库；
系统用 contract、orchestrator、adoption、trace 和 replay 守住边界。
```

因此用户旅程不能只按 AU/SU 文件罗列，也不能只按实现模块罗列。本文按 10 条顶层旅程组织完整产品地图：

| Journey | 用户目标 | 主要覆盖 |
|---|---|---|
| A | 启动、模型供应商与桌面可用性 | SU-01、VS-10、VS-11 |
| B | 作品空间、会话与上下文分层 | SU-02、AU-03、AU-12 |
| C | 自然创作对话与探索 | AU-01、AU-02 |
| D | 小说创作生命周期 | 立项、世界观、角色、章节、场景、正文、修订、成稿 |
| E | 执行、确认与行为生命周期 | AU-04、AU-06 |
| F | 候选、草稿、采纳与作品事实 | AU-05 |
| G | 阅读模式与投影刷新 | AU-08、ProjectionHint |
| H | 故事设定、记忆治理与召回 | AU-09、AU-03、AU-07 |
| I | 透明度、Why、Trace 与 Replay | AU-07、E2E、VS-10 |
| J | 工作台操作体验与个性化 | AU-10、SU-03 |

分层读法：

```text
基础运行层：A、B
作者创作层：C、D、F、G、H
系统治理层：E、I
工作台体验层：J
```

---

## 1. 状态定义

| Status | 含义 |
|---|---|
| `closed` | 已有真实 Tauri/前端发起闭环，且 artifact 或命令可复跑。 |
| `partial` | 有代码、局部测试、Channel/API 自动化或 UI 壳，但真实用户链路不完整。 |
| `gap` | 设计存在，缺关键实现、入口、状态、持久化或 proof。 |
| 任务排期 | 仅在 `tasks/NEXT.md` 选择；本文不使用 next/queued 表示执行优先级。 |
| `blocked` | 已确认需要前置条件，必须写明 blocker 和解锁条件。 |

证据等级：

| Evidence Grade | 含义 |
|---|---|
| `Tauri automation` | 原生 Tauri 工作台真实入口发起验证，优先级最高。 |
| `Browser slice verify` | 浏览器真实前端入口发起验证。 |
| `Channel/API automation` | Channel、Controller 或 API 自动化。 |
| `Application/Persistence test` | application、domain、persistence 局部测试。 |
| `Document only` | 只有设计或台账记录，不算闭环。 |

v3 主链对象标签从以下集合中选择：

```text
AuthorInput / DialogueContext / DialogueFrame / MicroPlan / OrchestratorDecision
ToolRequest / ToolResult / BehaviorState / AvailableAction / AuthorActionInput
TentativeArtifactSet / AdoptionDecision / ProjectionHint / TurnResultViewModel
DecisionTrace / TraceSummaryView / ReplayReport
```

---

## 2. Journey A：启动、模型供应商与桌面可用性

目标：系统用户能启动桌面应用，知道 AI 是否可用，看到真实 provider/model 状态，并且桌面进程、日志和运行时生命周期可诊断。

关联验收：SU-01、VS-10、VS-11。

关联 v3 contract：Provider health envelope、business log schema、desktop stage process ownership。

保护的不变量：`00c` §7 #9 TurnResult / UI canonical boundary、#13 trace summary visibility；工程层保护桌面进程所有权与可观测性。

真实消费者：Tauri 工作台、provider health badge、业务日志回溯工具、维护者。

Longest Closed Prefix：A1-A4。

Current Breakpoint：A5 provider 配置/切换主路径已闭环（含 OpenAI〔API Key/订阅〕、Minimax、智谱、Kimi、Gemini 供应商矩阵）；剩余仅 live vendor 真实云端失败矩阵与 OpenAI 订阅 OAuth 登录传输（需真实账号，SC-SU01-B3 P1 后续）。

Next Proof：有真实供应商账号后，从真实工作台配置 live vendor / 订阅令牌 -> 下一轮请求使用新 provider/model -> 日志可追踪。

| Step | 用户动作 / 体验节点 | AU/SU | v3 主链对象 | Status | Evidence Grade | Evidence / Command | Gap / Next |
|---:|---|---|---|---|---|---|---|
| A1 | 启动应用并进入真实工作台 | AU-03 / VS-11 | TurnResultViewModel | closed | Tauri automation | `artifacts/slice-verify/stage-startup-context-contract-tauri/summary.json` | 证明启动后恢复同一 work/session；生产 sidecar lifecycle 仍可继续加固。 |
| A2 | 看到 LLM/provider/model 状态 | SU-01 | TurnResultViewModel | closed | Tauri automation | `artifacts/slice-verify/su01-provider-health-model-tauri/summary.json`；`bash scripts/tauri_slice_verify.sh su01-provider-health-model` | 只覆盖 health/model 展示，不覆盖切换配置。 |
| A3 | 业务日志可按 turn/work/session 回溯 | VS-10 | DecisionTrace / TraceSummaryView | closed | Browser/Tauri verify | `vs10-observability-spine` browser + Tauri evidence 见台账 | 完整运营诊断仍依赖 Journey I。 |
| A4 | 关闭 Tauri/stage 后由 launcher 清理 Phoenix/Vite 并恢复配置 | VS-11 | TurnResultViewModel | closed | Tauri automation | `artifacts/slice-verify/desktop-stage-process-ownership-tauri/summary.json`；`bash scripts/tauri_slice_verify.sh desktop-stage-process-ownership` | 证明 dev/stage owner 模型；不声称覆盖生产 sidecar。 |
| A5 | 配置或切换模型供应商 | SU-01 | AuthorActionInput / TurnResultViewModel | checkpoint closed / live vendor 后续 | Tauri automation | `artifacts/slice-verify/su01-model-provider-switching-tauri/summary.json`；`artifacts/slice-verify/su01-provider-vendor-matrix-tauri/summary.json`；`bash scripts/tauri_slice_verify.sh su01-provider-vendor-matrix` | provider 列表（含 OpenAI〔API Key/订阅〕、Minimax、智谱、Kimi、Gemini 矩阵）、Key/endpoint 设置、local-file 安全存储、runtime 切换、test-fail 不切换、secret 脱敏均已由真实工作台证明；剩 live vendor 真实云端失败矩阵 + 订阅 OAuth 登录传输（SC-SU01-B3 P1）。 |
| A6 | provider 不可用时看到清晰降级 | SU-01 / AU-01 | OrchestratorDecision / TraceSummaryView | checkpoint closed / 继续补矩阵 | Tauri automation + Channel/API automation | `artifacts/slice-verify/au10-workbench-recovery-disconnect-timeout-tauri/summary.json`；`artifacts/slice-verify/au10-workbench-recovery-provider-timeout-tauri/summary.json`；provider health controller tests；AU-01 error recovery tests | provider 不可用和真实 provider timeout 后 no-write fallback、loading 清除、恢复后下一轮已由真实工作台证明；缺乱码和更完整 UI 矩阵。 |

---

## 3. Journey B：作品空间、会话与上下文分层

目标：作者能长期围绕一个作品创作，系统稳定区分当前作品、当前 active session、历史会话、已确认记忆和可解释上下文来源。

关联验收：SU-02、AU-03、AU-07、AU-09、AU-12。

关联 v3 contract：`DialogueContext`、`CurrentWorkSnapshot`、`ContextSourceRef`、`DecisionTrace.context_refs`、work/session scoped AuthorInput。

保护的不变量：`00c` §7 #1 每 turn 必有 frame、#9 TurnResult canonical、#13 trace summary 脱敏、#14 replay 默认不调 LLM。

真实消费者：`WorkspaceChat`、StructurePanel 作品档案、Channel join、ContextAssembler、Planner prompt、why 面板。

Longest Closed Prefix：B1-B12（B12 为 AU-12 CP1 works 立项档案只读概览 checkpoint）。

Current Breakpoint：Journey B 当前连续前缀已闭环到 B12 CP1。用户 2026-06-17 调整队列先做 AU12，CP1 已闭环；AU-09 文件级收口也已完成，核心记忆治理链 P0 已关闭。本轮执行顺序按用户指定进入 AU-10 文件级审计。

Next Proof：本轮下一 proof 是 AU-10 文件级工作台矩阵。B12 后续 proof 是 CP2 accepted-artifact 类立项要素、缺字段/失败矩阵、跨作品切换矩阵，以及 CP3 correction 修订入口。

| Step | 用户动作 / 体验节点 | AU/SU | v3 主链对象 | Status | Evidence Grade | Evidence / Command | Gap / Next |
|---:|---|---|---|---|---|---|---|
| B1 | 选择/切换作品，保证作品隔离 | SU-02 | AuthorInput / DialogueContext | closed | Tauri automation | `artifacts/slice-verify/su02-work-switching-tauri/summary.json`；`bash scripts/tauri_slice_verify.sh su02-work-switching` | 不可用作品降级、完整作品管理面板仍未闭环。 |
| B2 | 启动后恢复真实 active session | AU-03 | DialogueContext / TurnResultViewModel | closed | Tauri automation | `artifacts/slice-verify/au03c-work-session-resume-tauri/summary.json`；`bash scripts/tauri_slice_verify.sh au03c-work-session-resume` | 历史会话治理仍需补。 |
| B3 | 当前 active session 连续聊天进入 Planner context | AU-01 / AU-03 | DialogueContext / DialogueFrame | closed | Tauri automation | `artifacts/slice-verify/au01-ordinary-chat-two-turn-roundtrip-tauri/summary.json` | messages 契约后的真实 LMStudio 复验证据仍需补。 |
| B4 | 搜索历史会话 | AU-03 | DialogueContext | partial | Channel/API automation | `WorkSessionService.search/2`、`WorkSessionsController.index/2`、右侧 session list | 搜索命中高亮、打开指定 turn 位置仍缺。 |
| B5 | 只读查看历史 transcript | AU-03 | TurnResultViewModel | closed | Tauri automation | `artifacts/slice-verify/au03-session-history-readonly-tauri/summary.json`；`bash scripts/tauri_slice_verify.sh au03-session-history-readonly` | 只读回看已闭环；下一步是分支继续。 |
| B6 | 历史 transcript 不恢复旧 pending/action/loading | AU-03 / AU-05 | AvailableAction / TurnResultViewModel | closed | Tauri automation | 同 B5 | 旧 pending 清空已验证，后续要证明分支来源引用。 |
| B7 | 从历史会话继续，显式创建新 active session / branch | AU-03 | AuthorActionInput / DialogueContext / DecisionTrace | closed | Tauri automation | `artifacts/slice-verify/au03-branch-from-history-tauri/summary.json`；`bash scripts/tauri_slice_verify.sh au03-branch-from-history` | 真实工作台搜索历史会话、打开只读 transcript、点击“从这里继续”，创建并切换新 active session；`source_session_ref/source_turn_ref` 指向旧会话与旧 turn，旧 transcript 未被复制到新 session。 |
| B8 | 归档旧会话，默认不进入日常 context，仍可搜索/回放 | AU-03 / AU-07 | DialogueContext / ReplayReport | closed | Tauri automation + Application/Persistence test | `artifacts/slice-verify/au03-archive-session-filter-tauri/summary.json`；`bash scripts/tauri_slice_verify.sh au03-archive-session-filter` | 真实工作台可归档历史会话，默认列表隐藏 archived，显式搜索仍可找回并只读打开；普通 context 过滤 archived transcript 由 persistence/application 测试覆盖。 |
| B9 | 最新 Work 背景与当前 session transcript 分层进入 context | AU-03 / AU-09 | DialogueContext / ContextSourceRef | closed | Tauri/LMStudio + Application/Persistence test | `artifacts/slice-verify/au03-current-work-context-ssot-tauri-lmstudio/summary.json`；`bash scripts/tauri_slice_verify.sh --real-lmstudio au03-current-work-context-ssot` | 已证明历史只读 transcript 打开后返回 active session，下一轮 prompt 使用最新 Work 背景 + 当前 active session transcript，旧历史 session 未覆盖当前作品事实。 |
| B10 | 作者能在 why 面板看到上下文来源摘要 | AU-03 / AU-07 | TraceSummaryView | closed | Tauri automation | `artifacts/slice-verify/au03-context-source-ui-tauri/summary.json`；`bash scripts/tauri_slice_verify.sh au03-context-source-ui` | 真实工作台普通回复 why 面板显示 current work / recent dialogue / memory 三类 author-safe 来源摘要，不暴露 raw prompt。 |
| B11 | 长会话压缩，旧 turn 进入 summary，最新 turn 保持顺序 | AU-03 | DialogueContext / DecisionTrace | closed | Tauri automation + Application/Persistence test | `artifacts/slice-verify/au03-long-session-compression-tauri/summary.json`；`bash scripts/tauri_slice_verify.sh au03-long-session-compression` | 已证明超过窗口的旧 turn 进入 `work_sessions.summary`，Planner request messages 只携带 early summary + 最新 transcript 窗口，不携带旧 turn 原文；2026-06-21 额外 real LMStudio 尝试完成 provider 调用但未产出 UI summary，不作为当前验收证据。 |
| B12 | 作者在作品档案核对 AI 使用的立项设定 | AU-12 / AU-03 | CurrentWorkSnapshot / WorkArchiveView | checkpoint closed | Tauri automation | `artifacts/slice-verify/au12-work-profile-overview-tauri/summary.json`；`bash scripts/tauri_slice_verify.sh au12-work-profile-overview` | CP1 已证明真实工作台作品档案「概览」显示 works 立项字段且 DTO/UI/日志不泄漏内部 Work UUID；accepted 状态矩阵、缺字段/失败、跨作品切换、no-write 计数和 correction 修订仍待后续。 |
| B13 | 模型执行期间打开作品档案仍可读快照 | AU-12 / AU-10 | WorkArchiveView / StructurePanel | closed | Tauri automation | `artifacts/slice-verify/au12-archive-concurrent-model-run-read-snapshot-tauri/summary.json`；`bash scripts/quality_accept.sh au12-archive-concurrent-model-run-read-snapshot --surface tauri` | StructurePanel 常驻挂载保留快照 + 仅 workId 变才重置 + loading/error 诚实状态条；执行期间打开档案显示立项快照（非空白）+「正在更新作品档案」指示，开档案只读 no-write，turn 完成后刷新。已知边界：channel 串行下执行期间 archive 读排队、turn 完成才返回，实时并发读取归后端异步化（AU-10）后续。 |

当前连续断点：

```text
B1-B12 CP1 closed；C1-C6 closed；F5 high-risk confirmation checkpoint closed；F6 stale restored candidate checkpoint closed；F7 cross-work recovery checkpoint closed；F8 canon conflict recovery checkpoint closed；Journey D 的 P1 10 万字主链 checkpoint 与 VS-00C CP0-CP5 closed；AU10 recovery 已推进到 provider timeout CP3B；Journey H / AU09-archive-memory-roundtrip CP2、AU09-memory-management-workbench-entry、AU09-memory-trace-roundtrip、AU09-validity-window-recall、AU09-cross-work-memory-isolation 与 AU09-AU03-session-memory-layering 已闭环，当前队首为 AU11-quality-diagnosis-message-envelope。
```

因此下一项功能推进应是 `AU11-quality-diagnosis-message-envelope` 的质量诊断 message envelope 闭环，除非出现 P0 bug。

---

## 4. Journey C：自然创作对话与探索

目标：作者首先感受到自己在和 LLM 创作伙伴讨论，而不是被工作台表单拦截；模糊想法能自然展开成候选方向，候选选择不等于采纳。

关联验收：AU-01、AU-02、AU-10、AU-11。

关联 v3 contract：`AuthorInput`、`DialogueFrame`、`CandidateDirectionSet`、`AIMessageEnvelope`、`TraceSummaryView`、`TurnResultViewModel`、`AvailableAction`。

保护的不变量：`00c` §7 #1 每 turn 必有 frame、#8 缺 slot 不自动表单化、#9 TurnResult canonical、#10 UI 只能提交 available actions、#11 selection != adoption。

真实消费者：`WorkspaceChat` 输入框、消息列表、候选卡、frame badge。

Longest Closed Prefix：C1-C6；C7 补矩阵，C8 旧证据链失效；C9/C10/C12/C13 保留各自已验范围。

Current Breakpoint：C14 的明确问题绑定/空选项恢复/业务输出回执已由 B26 自身范围闭环（CP0–CP5，真实 Tauri + 事务矩阵，见 B26 §14）；C14 剩余的真实模型自然表达语义质量由 B27 §6.1/CP4 判定，B26 不得代替。C15 / B31 的一般输入归属已由原生五场景覆盖；不外推为真实模型自然表达质量通过。C9/C10/C12/C13 的既有局部闭环保留；旧 AU11 envelope 生产链已退役，历史证据不证明当前统一输入。执行排期见 `tasks/NEXT.md`。

环境前置回归（2026-10-05，B16）：Phoenix 1.8.9 与锁定前端依赖恢复后，`q3c-author-content-materialization --surface tauri` 复跑通过；Tauri 已启动，外部 Playwright 操作真实工作台页面，证明作者原文候选与采纳链路。提供者为确定性替身，不证明 C9 义务机制或真实模型已闭环。

Current Proof：`q3d-message-outcome-roundtrip --surface tauri` 已证明只读结果回填、原文分轮引用、输入/结果刷新恢复、重复候选保护和真实采纳状态追问；使用确定性 provider。原 Q3c 同消息路径同时回归通过。

Current Proof（B24 / C12，2026-10-23 PASS）：`judgment-explore-chapter-full-read` 由外部 Playwright 驱动真实 Tauri 工作台：作者式审核请求 → 判断 explore → 从模型可见章节索引复制目标章 `chapter_ref`（`chapter:<chapters.id>`）→ 两页续读（1–6000 / 6001–7000，`next_offset=6000` 后末页为空）→ 逐字复制 footer JSON 续读 → 回复引用仅末页存在的正文事实 → 零写入；seed 两章同名标题，证明 ref 消歧（干扰章带（计划中））；作者可见时间线为「已阅读章节正文「灰烬中的手印」（第 2 章）…」，不出现 `chapter_read`/ref/UUID/JSON/offset。`judgment-explore-chapter-plan`（断言随文案更新）与 `p1-chapter-adoption-reading` 回归真实 Tauri PASS。证据 `artifacts/slice-verify/judgment-explore-chapter-full-read-tauri/summary.json` + 截图/WS 帧/llm-calls/app JSONL。

| Step | 用户动作 / 体验节点 | AU/SU | v3 主链对象 | Status | Evidence Grade | Evidence / Command | Gap / Next |
|---:|---|---|---|---|---|---|---|
| C1 | 普通创作聊天不误触发 MicroPlan | AU-01 / AU-10 | DialogueFrame / TurnResultViewModel | closed | Tauri automation | `artifacts/slice-verify/au10-ordinary-chat-no-micro-plan-tauri/summary.json` | 完整 AU-01 场景覆盖仍需重算。 |
| C2 | 两轮普通聊天保留上下文和 DOM 反馈 | AU-01 / AU-03 | DialogueContext / DialogueFrame | closed | Tauri automation | `artifacts/slice-verify/au01-ordinary-chat-two-turn-roundtrip-tauri/summary.json` | messages 契约后真实 LMStudio 复验仍需补。 |
| C3 | 模糊创意产生候选方向 | AU-02 | DialogueFrame / TurnResultViewModel | closed | Tauri automation | `artifacts/slice-verify/au02-candidate-continuation-tauri/summary.json` | 真人 UI 观感复验仍可补。 |
| C4 | 候选卡可点击继续探索 | AU-02 / AU-10 | AvailableAction / AuthorInput | closed | Tauri automation | `bash scripts/tauri_slice_verify.sh au02-candidate-continuation` | 继续探索不等于采纳已验证。 |
| C5 | frame badge 区分自然回复和探索 | AU-02 / AU-10 | DialogueFrame / TurnResultViewModel | closed | Tauri automation | `au02-candidate-continuation` frame badge evidence | 还缺更多 frame 类型样例。 |
| C6 | 从候选方向明确进入采纳边界 | AU-02 / AU-05 | AuthorActionInput / AdoptionDecision | closed | Tauri automation | `artifacts/slice-verify/au02-candidate-adoption-bridge-tauri/summary.json` | 已证明 selection / adoption 分离；后续转入 Journey F 安全门禁。 |
| C7 | LLM 异常、乱码、超时后可继续自然对话 | AU-01 | OrchestratorDecision / TraceSummaryView | checkpoint closed / 继续补矩阵 | Tauri automation + Application test | `artifacts/slice-verify/au10-workbench-recovery-disconnect-timeout-tauri/summary.json`；`artifacts/slice-verify/au10-workbench-recovery-cancel-waiting-tauri/summary.json`；`artifacts/slice-verify/au10-workbench-recovery-provider-timeout-tauri/summary.json`；broken provider / garbage JSON tests | provider 不可用恢复、高风险 confirmation 取消等待与真实 provider timeout 已由真实工作台证明；缺乱码和更完整 UI 恢复验收。 |
| C8 | 质量诊断请求组织三层 message | AU-11 / VS-00D / AU-07 | AIMessageEnvelope / DialogueFrame / TraceSummaryView | blocked（历史 checkpoint 保留） | 历史 Tauri；当前证据链失效 | `tasks/slices/AU11-quality-diagnosis-message-envelope.md`；`quality/acceptance/known-gaps.md` | 旧 producer 已退役，两份 AU11 场景已有失败记录；由 C14/B27 改锚当前判断链，未恢复前不把历史 closed 当当前覆盖。 |
| C9 | 输入可靠留存，作者约束、候选语义与动作后果一致 | Q3d / ADR-0027 | Interaction / AgentRun / TurnResult / Adoption | closed（BIZ-01–05） | 真实页面正反例 + Flash Next Q2 实模 | `tasks/slices/Q3D-message-outcome-roundtrip.md`；审计 notes §10 | 仅记录无候选，流程建议不产生方向动作；历史权限、正常方向讨论/选择、真实产物三类操作均已验证。 |
| C10 | 真实模型理解采纳事实并正确引导已有对象的后续处理 | Q1b / Q3d / DS02 | Interaction / Judgment / Adoption | closed（BIZ-06） | 三项页面专项；十轮数据链与最终四轮实模语义复验 | `tasks/slices/Q1B-live-archive-recheck.md`；`artifacts/project-analysis/biz6-context-semantic-review.json` | 上下文指代进入实际修订，原稿保留，新稿需采纳；放弃回执、版本登记和编辑后状态一致。已采纳内容的变更另归 D5。 |
| C11 | 在合理等待内得到与模型叙事一致的判断 | UA01-CALL2 / B26 / ADR-0025 | JudgmentProtocol / ProviderRun / MBC | 旧专项并入 C14 | 历史实模慢调用记录；新协议未验收 | `tasks/slices/UA01-judgment-structured-call-reliability.md`；`tasks/slices/B26-single-call-judgment-protocol.md` | call2 537 秒记录保留历史意义；参数对照停止。实际计数/存活/同源检查随 B26，新语义质量随 B27，不为性能重新建设两段式。 |
| C12 | 判断循环内部探索能读到完整章并据此答复（不再「可见正文被截断」） | B24-EXPLORATION-CHAPTER-FULL-READ / ADR-0025 | ExplorationService observation / Judgment / AgentRun | **closed（2026-10-23，真实 Tauri PASS）** | 单元矩阵 + 真实 Tauri automation | `artifacts/slice-verify/judgment-explore-chapter-full-read-tauri/summary.json`；`tasks/slices/B24-exploration-chapter-full-read.md` §8；`tasks/NEXT.md` B24 行 | `chapter_read` 观察 v2：【计划】≤500 /【摘要】≤400 / 正文单页 6000、短章一次全文；**唯一寻址 `chapter_ref = chapter:<chapters.id>`（DB 唯一、改名稳定）；seq 仅唯一别名、title 仅旧兼容且歧义列候选**；JSON `{"chapter_ref","offset"}` 续读 + `next_offset`/范围/footer（同 ref）；判断/计划章节索引同批暴露 ref；**作者可见 activity `第 N 章「title」`、不暴露内部工具 id/ref/UUID/JSON（I-READ-8/9）**；explore progress signature 去 sequence（同页重复命中 no-progress、合法续读不误停）；call2 观察重复渲染修复。写入/采纳链 title 身份统一归 follow-up（B25 候选）；超长章（>12k）/3 章以上批量/观察预算档位化登记 gap；确定性重复检测（方案 B）归 `P1-word-count-audit` checkpoint B。 |
| C13 | 判断循环重复读取同一处仍无新信息时，诚实停下等作者而不是空转 | B23-FOLLOWUP-NOPROGRESS / ADR-0025 | AgentRun progress signature / awaiting_author 出口 | **closed（2026-10-23，真实 Tauri PASS）** | 确定性 Tauri automation | `artifacts/slice-verify/agent-no-progress-stop-tauri/summary.json`；`quality/acceptance/scenarios/agent-no-progress-stop.yml` | 同 tool+同 query（含 offset）重复观察命中既有 `apply_progress_signature` no_progress 停等（B24 CP2 已去 sequence）；真实 Tauri 场景按判断纪元语义重写（两次同页探索 → awaiting_author + reason_codes 含 no_progress、零最终 TurnResult/零写入）；两次 `exploration_observed` 同 tool+同 query+观察字节相同 → `progress_signature` 重复（B24 CP2 去 sequence）→ `apply_progress_signature` 命中 no_progress → awaiting_author；真实 Tauri PASS：`stop_reason=no_progress`、`exploration_count=2`、`steps=3/provider_calls=4/tool_calls=0`、无最终 TurnResult/零写入；台账三处不一致已修正 |
| C14 | 正常创作表达得到有据判断；明确问题的选项与自由回复可靠回传 | B26-SINGLE-CALL-JUDGMENT / B27 / PLANNER-SEMANTIC-BOUNDARY | 共同任务输入 / 单调用响应 / AuthorQuestion / AgentRun / Frame / MicroPlan | **partial（2026-10-24）**：B26 自身范围闭环（协议/问答/业务输出/页面矩阵/门禁）；真实模型自然表达语义质量随 B27 §6.1 待验 | 真实 Tauri 原生批次 + 事务矩阵 + CP0 隔离对照；实模语义门槛待 B27 | `tasks/slices/B26-single-call-judgment-protocol.md` §14；`tasks/slices/B27-systematic-prompt-and-intent-integration.md`；`quality/acceptance/fixtures/b27-semantic-cases/` | B26 独立自证明确问题/空选项/结果持久恢复与业务输出，不等 B31；普通文本认知记录与来源/回放已迁移；20 例×双臂语义门槛归 B27 CP4。B26 与 B27 的联合生命周期/自然表达回归由 B27 CP4 承接。 |
| C15 | 没有明确问题动作绑定时，继续旧讨论或换话题仍进入正确任务 | B31-AUTHOR-REPLY-RUN-BINDING / Q3D / DS03 | AuthorInput / AgentRun / Behavior / 来源与投递身份 | **closed（2026-10-25，绑定/恢复机制）** | 外部CUA原生五场景；7条问题源绑定回复；三次重开顺序稳定；普通输入与显式steer分流 | `tasks/slices/B31-author-reply-run-binding.md` 原生补验收口；`artifacts/slice-verify/b31-native-20261025-a4/run/summary.json` | 确定性provider证明绑定与生命周期；真实模型自然表达仍归B27。原问题答复不关闭其他问题，只有明确来源才推进对应run。 |

---

## 5. Journey D：小说创作生命周期

目标：作者能围绕一部长篇作品从立项、定位、世界观、角色、卷章、场景、正文、修订到成稿持续推进，而不是只得到零散聊天回复或孤立草稿。本 Journey 也是 `docs/product/novel-output-milestones.md` 的主要产品承载面，P1/P2/P3/P4 的字数目标必须通过这里的章节规划、正文生成、采纳、阅读和导出链路证明，而不是通过旁路脚本堆字数。

关联验收：AU-02、AU-05、AU-08、AU-09；复用 v2 小说领域设计 `20-28`、质量门禁 `31-32` 的产品语义。

关联 v3 contract：`DialogueContext`、`MicroPlan`、`ToolRequest`、`ToolResult`、`TentativeArtifactSet`、`AdoptionDecision`、`ProjectionHint`。

保护的不变量：`00c` §7 #3 Orchestrator 唯一门禁、#5 工具调用有 trace、#6 写入默认 tentative、#11 selection != adoption、#15 projection 只刷新。

真实消费者：作者主工作台、作品档案、采纳面板、阅读模式。

Longest Closed Prefix：D1-D3 是最小闭环；D7 的 P1 10 万字主链 checkpoint 已闭环；VS-00C CP2-CP5 已补齐当前设计要求下“写第 N 章首稿”的上下文质量前置。

Current Breakpoint：D12 已取得局部修订及分段采纳的真实原生证据，完整矩阵和显示缺口仍为 partial；D13/D14 的原生对象维护与 D15 的原生长篇复验仍需补证，I10 文学盲评由作者裁决。前置交互语义由 C14/C15 承接，各历史证据只覆盖已验范围。

Next Proof：按 `tasks/NEXT.md` 新顺序，从自然输入贯通候选、采纳、原对象更新、读取/探索/下一轮上下文；D12–D14 分别以原 slice 的真实 Tauri 场景验证，D15 按 3–5 周期真实创作节拍检验组合效果。历史基线清账/B21/B13b 已收口，不再充当下一队首；Q1c 的 browser 证据保留其 surface 边界。

| Step | 用户动作 / 体验节点 | AU/SU | v3 主链对象 | Status | Evidence Grade | Evidence / Command | Gap / Next |
|---:|---|---|---|---|---|---|---|
| D1 | 模糊立项或题材想法被展开 | AU-02 | DialogueFrame / TurnResultViewModel | closed | Tauri automation | `artifacts/slice-verify/au02-candidate-continuation-tauri/summary.json` | 只是探索入口，不是完整立项生命周期。 |
| D2 | AI 生成小说材料但默认只是草稿 | AU-05 | ToolResult / TentativeArtifactSet | closed | Tauri automation | `artifacts/slice-verify/au05-adoption-boundary-tauri/summary.json` | 完整 StateTrace 仍不足。 |
| D3 | 采纳章节片段后能阅读 | AU-08 | AdoptionDecision / ProjectionHint | closed | Tauri automation | `artifacts/slice-verify/au08-adoption-reading-projection-tauri/summary.json` | 真实卷章归属/合并仍缺。 |
| D4 | 立项 -> 世界观/角色/大纲/章节/场景的连续规划 | AU-02 / AU-09 | MicroPlan / ToolRequest / DialogueContext | gap | Document only | v2 lifecycle 设计、v3 acceptance 分散覆盖 | 缺统一生命周期入口和分阶段 proof。 |
| D5 | 修订已采纳内容，保留 provenance 和冲突恢复 | Q1c / AU-05 / AU-08 | AdoptionDecision / DecisionTrace | closed（2026-10-21） | Browser scenario + application/persistence tests | `quality/acceptance/scenarios/q1c-adopted-content-revision.yml`；`artifacts/slice-verify/q1c-adopted-content-revision/summary.json`；`tasks/slices/Q1C-adopted-content-revision.md` §4B | 正式场景证明 revision_of 命中、覆盖确认、旧版 SUPERSEDED/新版 CONFIRMED、follow-up 读新值；歧义/stale/跨作品/放弃由确定性测试覆盖。原生 Tauri Q1c 场景未跑。 **该 closed 仅为原 Q1c 场景；完整章多片段覆盖、原生 Tauri 与全消费后果归 D12/B28，未被此证据证明。** |
| D6 | 内容质量门禁参与采纳或修订 | AU-05 / AU-09 | ToolResult / OrchestratorDecision / TraceSummaryView | gap | Document only | v2 quality gates 已设计，v3 首批只接最小质量证明 | 缺质量 finding 到 UI/proof 的产品链。 |
| D7 | P1 10 万字最小长篇闭环 | AU-02 / AU-05 / AU-08 / AU-10 | TentativeArtifactSet / AdoptionDecision / ProjectionHint / TurnResultViewModel | closed | Tauri automation | `artifacts/novel-output/p1-100k-dogfood/`；`artifacts/slice-verify/p1-chapter-plan-minimum-tauri/summary.json`；`artifacts/slice-verify/p1-chapter-draft-generation-tauri/summary.json`；`tasks/slices/P1-chapter-adoption-reading.md` | P1 长篇主链已达成；VS-00C 上下文质量 CP、AU09 archive memory roundtrip CP2、AU09 memory management entry、AU09 memory trace roundtrip、AU09 validity window recall、AU09 cross-work memory isolation 和 AU09/AU03 session memory layering 均已闭环，当前队首转向 AU11 quality diagnosis message envelope。 |
| D8 | P1 单章正文草稿生成 | AU-02 / AU-05 / AU-10 | MicroPlan / ToolRequest / ToolResult / TentativeArtifactSet | closed | Tauri automation | `artifacts/slice-verify/p1-chapter-draft-generation-tauri/summary.json`；`bash scripts/tauri_slice_verify.sh p1-chapter-draft-generation` | 真实工作台基于已采纳章节计划生成 `prose_fragment` 待采纳正文草稿；未采纳正文不进入 ReadingMode。单章 1000 字下限仍待后续扩写 / 字数统计 checkpoint。 |
| D9 | P1 单章正文采纳与阅读 | AU-05 / AU-08 / AU-10 | AdoptionDecision / ProjectionHint / TurnResultViewModel | closed | Tauri automation | `artifacts/slice-verify/p1-chapter-adoption-reading-tauri{,-lmstudio}/summary.json`；`tasks/slices/P1-chapter-adoption-reading.md` | 已证明作者采纳 `prose_fragment` 后，正文进入作品事实和 Reading Projection，ReadingMode 目录和章节正文从 Channel 读取。 |
| D10 | VS-00C CP4 章计划结构化方向层 | VS-00C / NEM-GAP-03 | DialogueContext / ToolRequest / DecisionTrace | closed | Tauri + tests | `artifacts/slice-verify/vs00c-cp4-chapter-plan-structure-tauri/summary.json`；`tasks/slices/v3/VS-00C-creative-context-assembly.md` | 章计划已从自由文本摘要升级为 E18-E22 结构方向，prose_writing L2 可获得章功能、目标四件套、情绪定位、断章和字数场次。 |
| D11 | VS-00C CP5 ReaderEffectBrief 与自报告 | VS-00C / G12 / G14 | DialogueContext / ToolRequest / TurnResult / TraceSummaryView | closed | Tauri + tests | `artifacts/slice-verify/vs00c-cp5-reader-effect-brief-tauri/summary.json`；`tasks/slices/v3/VS-00C-creative-context-assembly.md` | 已在 CP4 章方向之上补读者效果目标、钩子承诺和风险约束；AI 输出自报告只作为 quality signal / warning，不自动进入 adoption payload 或作品事实。 |
| D12 | 修订或仅整理完整章节，采纳后仍为原章，阅读/后续创作使用新版本 | B28-WHOLE-CHAPTER-REVISION / Q1c / B25 / B11D / ADR-0029 | chapter_ref / 覆盖集合 / 版本 / Adoption / Projection | **partial（局部修订与分段采纳已有原生实模证据）** | 真实Strata + CUA原生输入/预览/采纳/阅读/重开 | `tasks/slices/B28-whole-chapter-revision.md`；`artifacts/slice-verify/b28-format-native-20261026-r3/run/real-model-proof.json`；局部T2见R3-resume证据 | 格式计划新增30处阅读段落，字句保真、同章历史/唯一当前稿/完整章摘要及恢复通过；缺目标实模、旧driver迁移及投影提示仍未闭环，文学质量未代签。 |
| D13 | 维护已有章节编号与结构，正文和对象身份不变 | B30-CHAPTER-STRUCTURE-MAINTENANCE / AU08 / B25 | chapter_ref / seq / Volume / 结构映射与引用 | **partial（浏览器已验，原生待补）** | 两个浏览器产品链 场景注册 nightly PASS（30/30 + 12/12 checks）+ 回归 + 实模 POST-FIX | `tasks/slices/B30-chapter-structure-maintenance.md` §7；`quality/acceptance/scenarios/b30-*.yml`；`artifacts/slice-verify/b30-chapter-renumber-roundtrip-tauri/summary.json`、`.../b30-volume-blueprint-kind-boundary-tauri/summary.json` | 重编号 old→new 映射/两阶段原子 seq 更新（交换/密集重排）、章 ID 集合/章数/归卷/正文 hash/title 文本不变；TOC/阅读/探索/写作坐标/账本按 chapter_ref+当前 seq 迁移；大纲物化 title-first 遗漏补齐（outline chapter_ref→ref-first）；卷蓝图仅 Volume/不占 seq、非法混排 type_mismatch；stage 存量清理仍需授权。D14/B29 接棒。 |
| D14 | 修改已有角色叙事身份，档案与后续创作一致 | B29-EXISTING-CHARACTER-ROLE-REVISION / AU09 CP2 | Character / narrative_role / 版本 / Adoption / Context | **partial（浏览器已验，原生待补）** | 浏览器产品链 场景注册 nightly PASS 23/23 checks + AU09/AU12 回归 + 实模 canonical | `tasks/slices/B29-existing-character-role-revision.md` §6；`quality/acceptance/scenarios/b29-existing-character-role-revision.yml`；`artifacts/slice-verify/b29-existing-character-role-revision-tauri/summary.json`；实模 `artifacts/slice-verify/b29-cp4-model-*-postfix/` | 同 character_id 更新、角色数/其它主角/正文 hash 不变；`revise_character_profile` 首闭环 narrative_role，character_ref+base_fingerprint、old→new 候选、原子采纳旧值回执；roster/档案/判断写作/「谁是主角」读主档案，旧 memory 不冒充；known limits（仅 narrative_role/other_character_changes 采纳侧拒绝/stage 历史 memory 清理需授权）。D15/P1 接棒。 |
| D15 | 连续创作中完成正文/结构/角色维护，重开续写、审读并导出 | P1-AUTHORING-DOGFOOD / G6 / NEM-GAP-05 | 真实工作台 / Canon / 五账 / 质量 / Reading / Export | **partial（canonical-3e 浏览器工程证据 PASS；原生待补）**；**I10 文学盲评待作者指定负责人/时机**（AI 不代签） | canonical-3e：10/10 章≥1000、12,894 字、维护 5/5、content 仅 segment0 变化其余 24 段逐字节、wrong-route 0、导出 44KB；wait 59/0 timeouts | `artifacts/novel-output/p1-authoring-dogfood-2026-10-25-canonical3e/`；`tasks/slices/VS00D-G-GAP-RECONCILIATION.md#真实创作复验`；B33–B37 slices | 真实模型/页面/continuous 创作与维护组合已验证；失败/事故批次（attempt1–4）保留；I10 盲评等负责人/时机，自动化不代替质量收益判定；B38 世界规则保存判断候选 deferred。D15 浏览器工程验收通过，原生未闭环，文学收益待盲评。 |

---

## 6. 使用规则

1. 本文只维护用户体验节点、依赖、覆盖范围及原任务/证据链接；任务执行状态以 `tasks/README.md` 指定的原任务为准。
2. 只有新增/改变用户路径、打通断点或发现覆盖失效时更新本文；checkpoint 内部进展无需同步。
3. `closed` 必须有真实页面闭环且只覆盖所述范围；局部测试和设计分别记录，不能外推整个旅程。
4. 本文不持有 next/queued、队首任务或当前施工顺序；选择工作只读 `tasks/NEXT.md`，无需再维护第二个 next。
5. 验收口径在 `docs/design/acceptance/`，原任务记录状态/阻塞/验证，事实台账记录已发生结果；链接优先，避免复制细节。
6. 体验节点变更仍需说明 Contract / Invariant / Boundary / Consumer / Proof；本次职责调整不降低产品验收标准。

---

## 7. Journey E：执行、确认与行为生命周期

目标：AI 可以提出行动建议，但执行权始终由 Orchestrator 掌握；高风险、写入、长跑、取消、澄清、恢复都以 durable behavior 和 available action 进入主链。

关联验收：AU-04、AU-06。

关联 v3 contract：`MicroPlan`、`OrchestratorDecision`、`BehaviorState`、`AvailableAction`、`AuthorActionInput`、`ConfirmationBinding`。

保护的不变量：`00c` §7 #2 MicroPlan 只是建议、#3 Orchestrator 唯一门禁、#4 默认只放行下一步、#7 behavior open/close/resolution、#10 UI 只能提交 available actions、#12 confirmation answer 重新 gate。

真实消费者：确认卡、ActionPanel、Channel `author_action`、BehaviorTrace/replay。

Longest Closed Prefix：E1-E2 是局部或最小闭环。

Current Breakpoint：E3/E4 confirmation 主链已有多条真实 Tauri checkpoint；cancel waiting terminal BehaviorTrace replay producer 已闭环，完整确认成功 terminal history、blocking clarification 与持久 BehaviorBinding ledger 仍待后续。

Next Proof：真实工作台高风险动作 -> confirmation behavior -> 点击确认 -> 重新 gate -> 幂等执行或拒绝 -> behavior resolution + trace。

| Step | 用户动作 / 体验节点 | AU/SU | v3 主链对象 | Status | Evidence Grade | Evidence / Command | Gap / Next |
|---:|---|---|---|---|---|---|---|
| E1 | 普通聊天不进入执行态 | AU-01 / AU-06 | DialogueFrame / MicroPlan | closed | Tauri automation | `au10-ordinary-chat-no-micro-plan`、`au01-ordinary-chat-two-turn-roundtrip` | 完整 AU-06 普通讨论场景仍需归档。 |
| E2 | 真实入口可以触发 MicroPlan | AU-04 / AU-10 | MicroPlan / OrchestratorDecision | partial | Browser + Tauri verify | `scripts/slice_verify.sh au10-micro-plan-entry`；`bash scripts/tauri_slice_verify.sh au10-micro-plan-entry` | 只证明入口，不证明完整 lifecycle。 |
| E3 | 高风险动作打开 confirmation behavior | AU-04 / AU-06 | BehaviorState / AvailableAction | partial | Application/Channel tests | `behavior_lifecycle_test.exs`、`v3_full_chain_test.exs` | 真实 UI 确认卡与 behavior_state 消费仍不足。 |
| E4 | 点击确认绑定目标并重新 gate | AU-04 / AU-06 | AuthorActionInput / ConfirmationBinding | partial | Channel/API automation | `action_roundtrip_test.exs`、`workspace_channel_v3_test.exs` | behavior resolution/history 仍未完整闭环。 |
| E5 | 重复点击、旧按钮、伪造按钮被拒绝 | AU-06 / AU-10 | AvailableAction / AuthorActionInput | partial | Channel/API automation | stale/invented/disabled/source missing tests | 缺真实 UI 重复点击和跨 session/work 验收。 |
| E6 | 取消、拒绝、澄清回答关闭或推进 behavior | AU-06 / AU-07 | BehaviorState / DecisionTrace | checkpoint closed / P1 follow-up | Tauri automation + application/channel test | `artifacts/slice-verify/au07-behavior-trace-terminal-replay-tauri/summary.json`；`artifacts/slice-verify/au10-workbench-recovery-cancel-waiting-tauri/summary.json` | cancel waiting terminal close/resolution refs 已可回放；confirm success terminal history、blocking clarification 和持久 BehaviorBinding ledger 仍待后续。 |
| E7 | 长任务 RUNNING/CHECKPOINT/COMPLETED/FAILED 反馈 | AU-10 | ToolRequest / ToolResult / TurnResultViewModel | checkpoint closed | Tauri automation + Channel test | `artifacts/slice-verify/au10-workbench-recovery-taskstate-tauri/summary.json`；`workspace_channel_task_state_test.exs` | 真实“导出全书”动作已证明 RUNNING/CHECKPOINT/COMPLETED UI 可见，FAILED 由 Channel 失败分支覆盖；完整异步 LongRunner streaming 和长任务恢复仍缺。 |

---

## 8. Journey F：候选、草稿、采纳与作品事实

目标：AI 产物默认是 tentative；作者选择、修改、放弃和采纳都通过后端 adoption boundary；只有采纳后的内容才能成为作品事实。

关联验收：AU-05、AU-02、AU-08。

关联 v3 contract：`TentativeArtifactSet`、`CandidateSet`、`AuthorActionInput.choose_candidate`、`AdoptionDecision`、`AdoptionBoundary`、`StateTrace`。

保护的不变量：`00c` §7 #6 写入默认 tentative、#10 UI 只能提交 available actions、#11 selection != adoption、#12 confirmation answer 重新 gate、#14 replay 默认不调 LLM。

真实消费者：候选卡、pending adoption 面板、AdoptionWorkflow、作品档案、阅读投影。

Longest Closed Prefix：F1-F4 最小闭环。

Current Breakpoint：F8 canon conflict recovery checkpoint 已闭环；StateTrace/adoption/projection replay producer 已由 AU-07 checkpoint 补齐；完整 context version/revision freshness、覆盖确认和持久 adoption inbox 仍待后续。

Next Proof：后续 P1 章节计划和正文生产必须继续复用 adoption/canon gate，避免长篇事实被静默污染。

| Step | 用户动作 / 体验节点 | AU/SU | v3 主链对象 | Status | Evidence Grade | Evidence / Command | Gap / Next |
|---:|---|---|---|---|---|---|---|
| F1 | 生成待采纳创作草稿 | AU-05 | ToolResult / TentativeArtifactSet | closed | Tauri automation | `artifacts/slice-verify/au05-adoption-boundary-tauri/summary.json` | 完整 StateTrace 仍不足。 |
| F2 | 采纳从真实工作台触发并走后端 | AU-05 | AuthorActionInput / AdoptionDecision | closed | Tauri automation | `au05-adoption-boundary` Tauri evidence 见台账 | 需继续加固 source turn / freshness。 |
| F3 | 放弃草稿从真实工作台触发 | AU-05 | AuthorActionInput / AdoptionDecision | closed | Tauri automation | `artifacts/slice-verify/au05-discard-boundary-tauri/summary.json` | 完整 replay/provenance 仍缺。 |
| F4 | 修改后再采纳从真实工作台触发 | AU-05 | AuthorActionInput / AdoptionDecision | closed | Tauri automation | `artifacts/slice-verify/au05-modify-draft-boundary-tauri/summary.json` | 修改链路的正式 revision boundary 仍缺。 |
| F5 | 高风险采纳要求确认并重新 gate | AU-05 / AU-06 | BehaviorState / ConfirmationBinding | checkpoint closed | Tauri automation | `artifacts/slice-verify/au05-adoption-safety-freshness-tauri/summary.json` | 已证明高风险候选不能静默采纳；完整 AU-04 confirmation lifecycle 仍需后续接 re-gate。 |
| F6 | stale source 草稿不能采纳 | AU-05 / SU-02 | AdoptionDecision / DecisionTrace | checkpoint closed | Tauri automation + application/channel test | `artifacts/slice-verify/au05-stale-conflict-cross-work-freshness-tauri/summary.json`；`tasks/slices/AU05-stale-conflict-cross-work-freshness.md` | stale restored candidate 已证明真实工作台拒绝且不写 production fact；context version 和 revision freshness 仍缺。 |
| F7 | cross-work 草稿不能采纳到当前作品 | AU-05 / SU-02 | AdoptionDecision / DecisionTrace | checkpoint closed | Tauri automation + application/channel test | `artifacts/slice-verify/au05-conflict-cross-work-recovery-tauri/summary.json`；`tasks/slices/AU05-conflict-cross-work-recovery.md` | cross-work candidate 已证明真实工作台 fail_with_recovery 且不写 production fact；完整 work-scoped adoption store 仍缺。 |
| F8 | canon conflict 采纳恢复 | AU-05 / SU-02 | AdoptionDecision / DecisionTrace | checkpoint closed | Tauri automation + application/channel test | `artifacts/slice-verify/au05-canon-conflict-recovery-tauri/summary.json`；`tasks/slices/AU05-canon-conflict-recovery.md` | 结构化 canon conflict candidate 已证明真实工作台 fail_with_recovery 且不写 production fact；自动读取 canon/revision 计算冲突、覆盖确认、StateTrace 仍缺。 |
| F9 | 采纳状态在领域、线格式与刷新恢复中一致 | DS02 / ADR-0019 / ADR-0024 | AdoptionStatus / TurnResult / transcript / schema | closed | 外部真实页面 + 全量回归 | `tasks/slices/DS02-adoption-status-canonicalization.md`；`artifacts/slice-verify/q3d-message-outcome-roundtrip-tauri/summary.json` | 已撤销 string 放宽；新产物与历史小写恢复统一 canonical 七态，作者原文字节保持；确定性 provider，真实模型质量不在此证据内。 |
| F9 | 采纳可回放且 AI 不谎报状态 | AU-05 / AU-07 | StateTrace / ReplayReport | checkpoint closed / P1 follow-up | Tauri automation + application test | `artifacts/slice-verify/au07-state-trace-adoption-replay-tauri/summary.json`；truthfulness/tool result tests | 采纳正文 action/projection 共用 StateTrace refs 已闭环；成功/失败文案矩阵、旧 turn replay UI 和完整 revision/canon store 仍待后续。 |

---

## 9. Journey G：阅读模式与投影刷新

目标：作者能像读一本书一样查看已采纳章节；阅读投影来自正式作品事实，ProjectionHint 只提示刷新，不授权写入。

关联验收：AU-08、AU-05。

关联 v3 contract：`ProjectionHint`、`StateTrace`、read model refresh、`TurnResultViewModel`。

保护的不变量：`00c` §7 #6 写入默认 tentative、#11 selection != adoption、#15 projection hints 只触发刷新。

真实消费者：ReadingMode、TOC、章节正文、projection notice。

Longest Closed Prefix：G1-G4（核心阅读链）。

Current Breakpoint：G3 projection refresh 状态机仍缺。

Next Proof：专用 projection refresh action -> no production write -> REBUILDING/FAILED 状态可见 -> refresh 失败不回写 production。

| Step | 用户动作 / 体验节点 | AU/SU | v3 主链对象 | Status | Evidence Grade | Evidence / Command | Gap / Next |
|---:|---|---|---|---|---|---|---|
| G1 | 采纳章节片段后阅读模式看到 TOC/正文 | AU-08 / AU-05 | ProjectionHint / TurnResultViewModel | closed | Tauri automation | `artifacts/slice-verify/p1-chapter-adoption-reading-tauri/summary.json`；`quality_accept.sh p1-chapter-adoption-reading --surface tauri` | projection refresh 状态机仍缺。 |
| G2 | 未采纳草稿不进入阅读模式 | AU-05 / AU-08 | TentativeArtifactSet / ProjectionHint | closed | Tauri automation | `artifacts/slice-verify/p1-chapter-draft-generation-tauri/summary.json`；`artifacts/slice-verify/au02-unadopted-candidate-no-reading-fact-tauri/summary.json` | 保持 regression。 |
| G3 | ProjectionHint adapter 与 stale/refresh UI | AU-08 | ProjectionHint / StateTrace | partial | Tauri automation + tests | `p1-chapter-adoption-reading` 断言 STALE banner；`adoption_workflow_test` 覆盖 projection_refs | 缺专用 refresh no-write、REBUILDING/FAILED 真实状态。 |
| G4 | 真实卷章归属、章节合并、阅读空态/错误态 | AU-08 | TurnResultViewModel | closed | Tauri automation | `p1-chapter-expansion-multichapter` 证明多章归属、TOC 点击和未写章空态 | 离线/加载失败细节待 AU-08 P1。 |

---

## 10. Journey H：故事设定、记忆治理与召回

目标：作者能管理作品设定；AI 只召回 confirmed/stabilized 且 recallable 的记忆；引用来源可解释，锁定、废弃、归档和有效期受治理。

关联验收：AU-09、AU-03、AU-07。

关联 v3 contract：`MemoryItem`、`DialogueContext`、`ContextSourceRef`、`DecisionTrace.context_refs`、`TraceSummaryView`。

保护的不变量：`00c` §7 #9 TurnResult canonical、#13 trace summary 脱敏、#14 replay 默认不调 LLM；领域层保护记忆状态机和 locked/recallable 规则。

真实消费者：作品档案、ContextAssembler、Planner prompt、why 面板、memory REST 管理入口。

Longest Closed Prefix：Journey H 当前文件级可交付。H3-H4/H6-H11 均有当前可复跑 Tauri / quality 入口；H1/H2 的完整 archive stats/detail 矩阵降为 P1，不再用历史 artifact 直接标当前已验收。

Current Breakpoint：AU-09 文件级收口已完成，10/14 已验收、1/14 已测试、3/14 部分实现，P0=0。8 个当前 AU-09 quality 入口覆盖记忆创建确认召回、管理入口、生命周期终态排除、lifecycle/reference author-safe 追溯、伏笔/规则 adoption、角色主档案、有效期窗口、跨作品隔离和 AU-03 会话/记忆分层。

Next Proof：Journey H 后续转向完整 archive stats current driver、pending inbox、筛选分页真实页面矩阵、developer replay、历史旧 turn 查询、完整独立 MemoryTrace/StateTrace 表和 Channel 管理入口；当前按用户指定顺序进入 AU-10 文件级审计。

| Step | 用户动作 / 体验节点 | AU/SU | v3 主链对象 | Status | Evidence Grade | Evidence / Command | Gap / Next |
|---:|---|---|---|---|---|---|---|
| H1 | 打开作品档案看到真实角色/伏笔/规则/统计 | AU-09 | TurnResultViewModel | partial | Tauri automation + historical artifact | 当前 `au09-character-dossier-roundtrip` / `au09-adopt-setting-recall` / `au09-cross-work-memory-isolation` 覆盖角色、伏笔、规则和跨作品隔离；历史 `au09-archive-real-data` 仅作背景 | 完整 archive stats current driver 是 P1。 |
| H2 | 档案 L2 列表到 L3 详情只读查看 | AU-09 | TurnResultViewModel | partial | Tauri automation + historical artifact | 当前角色/伏笔/规则 tab 有可复跑入口；历史 `au09-archive-real-data` 仅作背景 | 完整 detail/lineage current driver 是 P1。 |
| H3 | 记忆 REST 管理入口 | AU-09 | AuthorActionInput / MemoryItem | checkpoint closed | Tauri automation + Application/Persistence test | controller/service/repo 测试和台账记录；`tasks/slices/AU09-memory-management-workbench-entry.md`；`artifacts/slice-verify/au09-memory-management-entry-tauri/summary.json` | 正式工作台入口、创建、确认、锁定、废弃、归档与基础 recall/why 已闭环；仍缺 trace/replay 和正式设计追溯。 |
| H4 | 已确认记忆召回进 context/prompt | AU-09 / AU-03 | DialogueContext / ContextSourceRef | closed | Tauri automation + quality acceptance | `artifacts/slice-verify/au09-memory-create-recall-tauri/summary.json`；`quality/acceptance/scenarios/au09-memory-create-recall.yml` | AU-03 会话分层已由 H11 补齐；跨作品记忆隔离另列 H10。 |
| H5 | 作者查看某条记忆为何被引用 | AU-09 / AU-07 | TraceSummaryView | partial | Tauri automation + quality acceptance | `au09-memory-trace-roundtrip` 已证明 author-safe lifecycle/reference 追溯；why 面板可显示本轮 memory source | developer replay 与历史旧 turn 查询仍缺。 |
| H6 | 面板内采纳设定进入 governed memory | AU-09 / AU-05 | AdoptionDecision / MemoryItem | checkpoint closed | Tauri automation + Agent/Persistence tests | `tasks/slices/AU09-archive-memory-roundtrip.md`；`artifacts/slice-verify/au09-adopt-setting-recall-tauri/summary.json`；`world_building -> foreshadowing_seed / *_rule_seed` prompt；`AdoptionRepository` 显式 artifact type memory 分类测试 | CP2 已补：真实页面从伏笔/规则 tab 生成显式 artifact、采纳后按 `FORESHADOWING` / `WORLD_RULE` 等语义分类、对应 tab 重开可见，并在下一轮 recall/why 中解释引用来源。 |
| H7 | 记忆状态机、locked、terminal 影响召回 | AU-09 | MemoryItem / DialogueContext | checkpoint closed | Tauri automation + Domain/Persistence test | `artifacts/slice-verify/au09-memory-management-entry-tauri/summary.json`；memory status guard tests | locked 可召回且终端动作禁用、deprecated/archived 不再进入后续 memory context/why 已有真实 UI 证据；有效期窗口已由 H9 补齐。 |
| H8 | 记忆治理 trace / replay | AU-09 / AU-07 | MemoryTrace / StateTrace / TraceSummaryView | checkpoint closed / replay 待深化 | Tauri automation + Application/Persistence test | `artifacts/slice-verify/au09-memory-trace-roundtrip-tauri/summary.json`；`tasks/slices/AU09-memory-trace-roundtrip.md` | lifecycle/reference author-safe 追溯已补；完整 developer replay、独立 trace table 和历史旧 turn 查询仍缺。 |
| H9 | 有效期窗口影响召回 | AU-09 / AU-03 | MemoryItem / DialogueContext | checkpoint closed | Tauri automation + Persistence test | `artifacts/slice-verify/au09-validity-window-recall-tauri/summary.json`；`apps/novel_persistence/test/novel_persistence/memory_recall_repo_test.exs`；`tasks/slices/AU09-validity-window-recall.md` | 章节级窗口已证明；scene-level 窗口、降权策略和 story-order 字段仍属后续深化。 |
| H10 | 跨作品记忆隔离 | AU-09 / SU-02 / AU-03 | MemoryItem / DialogueContext / TraceSummaryView | checkpoint closed | Tauri automation + Application/Persistence test | `artifacts/slice-verify/au09-cross-work-memory-isolation-tauri/summary.json`；`tasks/slices/AU09-cross-work-memory-isolation.md` | 真实工作台 A→B 切换后，档案伏笔/规则、记忆管理页、ordinary recall 和 why 只消费当前 Work 的 memory；后续更深跨作品矩阵可并入 AU-03/SU-02。 |
| H11 | 会话与记忆来源分层 | AU-09 / AU-03 / AU-07 | DialogueContext / ContextSourceRef / TraceSummaryView | checkpoint closed | Tauri automation + Application/Persistence test | `artifacts/slice-verify/au09-au03-session-memory-layering-tauri/summary.json`；`tasks/slices/AU09-AU03-session-memory-layering.md` | 同一作品内 active session、historical session、current work snapshot 与 governed memory 已由真实工作台证明分层且不互相伪装；后续补 developer replay 和历史旧 turn 查询。 |
| H12 | 角色类型与“主角”语义可校验问答 | AU-09 | Character.narrative_role / CharacterRosterNarration | checkpoint closed | Tauri automation + Domain/Contract/Persistence/Application/Agent test | `artifacts/slice-verify/au09-character-role-taxonomy-protagonist-policy-tauri/summary.json`；`tasks/slices/AU09-character-role-taxonomy-protagonist-policy.md`；`bash scripts/quality_accept.sh au09-character-role-taxonomy-protagonist-policy --surface tauri` | 主角 = Character 结构化叙事角色 `narrative_role`（枚举，支持群像）；无主角时“主角是谁”诚实报缺口、不默认第一个角色、只读 no-write；“设计主角”经采纳边界写结构化 PROTAGONIST，档案显示“主角”标签，再问主角可校验回答。CP2 后续：把已有角色改判为主角的修订入口、字段级档案、关系/演化记忆。 |
| H13 | 多角色候选逐项独立采纳 | AU-09 / AU-05 | TentativeArtifactSet.adoptable_units / AvailableAction | closed | Tauri automation + Domain/Application test | `artifacts/slice-verify/au09-character-candidate-per-item-adoption-tauri/summary.json`；`tasks/slices/AU09-character-candidate-per-item-adoption.md`；`bash scripts/quality_accept.sh au09-character-candidate-per-item-adoption --surface tauri` | 一轮多角色候选时每个候选有独立 `artifact_id` + 独立采纳按钮；采纳一个只写对应 Character，其它候选保持 pending（档案“待采纳”段仍可采）但不进入已确认角色/记忆/上下文；采纳契约零改动，`outline_draft` 等保持整体采纳。后续：方向候选/主体候选不同 action type、伏笔/规则逐项采纳扩展。 |
| H14 | 记忆写入治理：主体不写记忆、角色演化写有类型角色记忆 | AU-09 | MemoryType / character_evolution_seed / 06 §4.5 | checkpoint closed | Tauri automation + Domain/Contract/Persistence/Agent test | `artifacts/slice-verify/au09-memory-taxonomy-write-policy-tauri/summary.json`；`tasks/slices/AU09-memory-taxonomy-write-policy.md`；`bash scripts/quality_accept.sh au09-memory-taxonomy-write-policy --surface tauri` | `06 §4.5` 冻结写入治理契约；角色主体（character_seed）写 Character 主档案不写记忆；角色演化（character_evolution_seed）采纳写 CHARACTER_PROFILE/CURRENT_STATE/RELATIONSHIP 角色记忆并按类型展示、保留 nonce；只读/失败/未采纳不写；终态/窗口外不召回。CP2：角色记忆↔主档案双向引用、supersede 入口、召回真实页面证据。 |
| H15 | 记忆列表可扫读 UX（全局调性） | AU-09 | MemoryListPage / memoryListView / 40-ui-overview token | closed | Tauri automation + 截图 + 前端单测 | `artifacts/slice-verify/au09-memory-list-ux-redesign-tauri/summary.json`；`tasks/slices/AU09-memory-list-ux-redesign.md`；`bash scripts/quality_accept.sh au09-memory-list-ux-redesign --surface tauri` | 记忆页改用全局浅色 token（bg=rgb(252,250,247)，原深色 off-theme）；状态/类型/范围中文标签 + 语义状态徽标（颜色服务真实状态非装饰）+ 召回列（终态不召回）+ 终态行降权；无重叠。CP2：详情抽屉/创建对话框对齐 token、统一措辞。 |

---

## 11. Journey I：透明度、Why、Trace 与 Replay

目标：作者能理解 AI 为什么这样回复、为什么没有执行、为什么要求确认；开发者能用保存 trace 离线复盘，不重新调用 LLM。

关联验收：AU-07、E2E-01、VS-10。

关联 v3 contract：`DecisionTrace`、`ToolTrace`、`BehaviorTrace`、`StateTrace`、`TraceSummaryView`、`ReplayReport`。

保护的不变量：`00c` §7 #5 工具调用 trace 完整、#9 TurnResult canonical、#13 trace summary 脱敏、#14 replay 默认不调 LLM。

真实消费者：why 面板、ReplayService、developer replay report、业务日志回溯。

Longest Closed Prefix：I1；I4 的 StateTrace producer 与 Behavior terminal producer 已有 AU-07 文件级 Tauri evidence。

Current Breakpoint：AU-07 文件级 P0 已关闭；I2-I5 的旧 turn 查询、developer 双视图、完整 ToolTrace registry snapshot、六问 report 和 work/session 查询隔离仍是 P1 后续。

Next Proof：从持久旧 turn 查询生成 author-safe replay report；developer replay report 回答六问且不调 LLM，并证明 work/session 授权隔离。

| Step | 用户动作 / 体验节点 | AU/SU | v3 主链对象 | Status | Evidence Grade | Evidence / Command | Gap / Next |
|---:|---|---|---|---|---|---|---|
| I1 | 当前消息旁打开“为什么”入口 | AU-07 | TraceSummaryView | closed | Tauri automation | `artifacts/slice-verify/au07-trace-why-entry-tauri/summary.json`；`bash scripts/tauri_slice_verify.sh au07-trace-why-entry` | 旧 turn 查询入口仍缺。 |
| I2 | author-safe trace summary 脱敏 | AU-07 | TraceSummaryView | partial | Application + Tauri evidence | `TraceRedactor` 测试、why UI 最小证据 | developer 双视图权限边界未闭环。 |
| I3 | replay 不调 LLM | AU-07 / E2E | ReplayReport | partial | Application test | `ReplayService` 单测、E2E replay | 缺持久化 trace 查询到 UI/API 的闭环。 |
| I4 | ToolTrace / BehaviorTrace / StateTrace 聚合 | AU-07 / AU-06 / AU-05 | ToolTrace / BehaviorTrace / StateTrace | checkpoint closed / P1 follow-up | Tauri automation + application/persistence test | `artifacts/slice-verify/au07-state-trace-adoption-replay-tauri/summary.json`；`artifacts/slice-verify/au07-behavior-trace-terminal-replay-tauri/summary.json`；ReplayService / TraceRepository tests | StateTrace producer 与 Behavior terminal producer 已闭环；完整 ToolTrace registry snapshot、旧 turn UI/API 和六问 ReplayReport 仍待后续。 |
| I5 | 旧 turn 查询、跨 work/session trace 隔离 | AU-07 / SU-02 | DecisionTrace / ReplayReport | gap | Document only | AU07-GAP-09/10 | 缺 trace 查询 API/UI 与隔离验收。 |

---

## 12. Journey J：工作台操作体验与个性化

目标：工作台作为 LLM 背后的工具箱，给作者提供状态、候选、动作、任务反馈、档案、阅读和个性化显示，但不反向发明 intent、slot、behavior、policy 或写入事实。

关联验收：AU-10、SU-03，横跨 AU-01/AU-02/AU-04/AU-05/AU-07/AU-08。

关联 v3 contract：`TurnResultViewModel`、`AvailableAction`、`AuthorActionInput`、`ui_cards`、`TraceSummaryView`、`ProjectionHint`。

保护的不变量：`00c` §7 #8 缺 slot 不自动表单、#9 TurnResult canonical、#10 UI 只能提交 available actions、#13 trace summary 脱敏、#15 projection 只刷新。

真实消费者：`WorkspaceChat`、ActionPanel、MessageList、StructurePanel、ReadingMode。历史 `历史旁路工作台` 实验组件已退役删除，不再作为当前消费者。

Longest Closed Prefix：J1-J5 是最小真实入口闭环；J8 是 AU-10 baseline matrix checkpoint；J9 task_state checkpoint 已补真实导出动作的任务状态生命周期；J10 的 CP1 provider failure recovery、CP2 WebSocket service reconnect、CP3A cancel waiting 与 CP3B provider timeout 已闭环，但仍不代表完整工作台恢复态闭环。

Current Breakpoint：J10/AU10-workbench-recovery-disconnect-timeout CP3B 已闭环，2026-10-22 晚间作者定向 B23（停等作者理由与出口可见）已登记并开工，当前队首回到 Journey J。`WorkspaceChat` 已是唯一生产工作台入口，`au10-workbench-matrix-layout` 已覆盖 1280×800 baseline，`AU10-workbench-recovery-taskstate` 已覆盖真实导出动作的 task_state 可见生命周期，`au10-workbench-recovery-disconnect-timeout` CP1 已覆盖 provider failure 后 no-write、loading 清除和恢复后继续下一轮；CP2 已覆盖后端服务断开/重启后的同步离线、输入禁用、自动 rejoin 与下一轮继续；CP3A 已覆盖高风险工具 confirmation 取消等待后的 cancelled action_result / TurnResult、no-write、按钮清除和下一轮继续；CP3B 已覆盖真实 provider receive timeout 后 no-write fallback、loading 清除和恢复后继续下一轮。完整异步 LongRunner 因缺真实生产消费者延后。

Next Proof：B23 已于 2026-10-23 收口（新真实 Tauri `agent-plan-exhausted-awaiting-reason` PASS：结构化停等理由可见→刷新仍可见→回复语义→同一 run 补充恢复 completed；`agent-dead-bounded-run-expiry` 证明死 bounded run 首 join 一次性收口 failed 且第二 join 零重复）。除 B23 外，Journey J 后续是完整异步 LongRunner streaming 和恢复后继续操作的一条综合 walkthrough，但必须先出现真实批量生成/推演消费者；短期队首恢复 `MAINLINE-RESET-3` 等待作者拍板。

| Step | 用户动作 / 体验节点 | AU/SU | v3 主链对象 | Status | Evidence Grade | Evidence / Command | Gap / Next |
|---:|---|---|---|---|---|---|---|
| J1 | 真实工作台普通聊天入口 | AU-10 / AU-01 | TurnResultViewModel | closed | Tauri automation | `au01-ordinary-chat-two-turn-roundtrip`、`au10-ordinary-chat-no-micro-plan` | 完整 AU-10 DOM/状态覆盖仍不足。 |
| J2 | 真实工作台 MicroPlan 入口 | AU-10 / AU-04 | MicroPlan / AvailableAction | partial | Browser + Tauri verify | `au10-micro-plan-entry` browser + Tauri evidence | 只证明入口，不证明完整执行 lifecycle。 |
| J3 | 候选卡、frame badge、继续探索和授权采纳 | AU-10 / AU-02 / AU-05 | DialogueFrame / AvailableAction / AdoptionDecision | closed | Tauri automation | `au02-candidate-continuation`；`artifacts/slice-verify/au02-candidate-adoption-bridge-tauri/summary.json` | 后续转入 AU-05 safety/freshness。 |
| J4 | AI 显示名按作品隔离 | SU-03 | TurnResultViewModel | closed | Tauri automation | `artifacts/slice-verify/su03-assistant-display-name-tauri/summary.json`；`bash scripts/tauri_slice_verify.sh su03-assistant-display-name` | 真实 LLM payload 不变仍缺独立日志证据。 |
| J5 | 工作台统一运行时状态 | AU-10 | TurnResultViewModel / ProjectionHint | closed | Tauri automation | `artifacts/slice-verify/workspace-runtime-state-tauri/summary.json` | 只覆盖 runtime state 模型，不覆盖完整用户流程。 |
| J6 | available action panel 和 stale/invented 拒绝 | AU-10 / AU-06 | AvailableAction / AuthorActionInput | partial | Channel/API automation | `workspace_channel_v3_test.exs`、`action_roundtrip_test.exs` | 缺完整 UI action walkthrough。 |
| J7 | trace/why、adoption、projection 在同一工作台主入口协作 | AU-10 / AU-05 / AU-07 / AU-08 | TraceSummaryView / AdoptionDecision / ProjectionHint | partial | Multiple Tauri proofs | 各 journey 有单点 evidence | 缺恢复态和深矩阵。 |
| J8 | AU-10 baseline matrix 与 1280×800 layout | AU-10 / AU-01 / AU-02 / AU-05 / AU-07 / AU-08 | TurnResultViewModel / AvailableAction / TraceSummaryView / AdoptionDecision / ProjectionHint | checkpoint closed | Tauri automation | `artifacts/slice-verify/au10-workbench-matrix-layout-tauri/summary.json`；`bash scripts/tauri_slice_verify.sh au10-workbench-matrix-layout` | 已覆盖普通聊天 no-MicroPlan、why、候选授权 action、正文草稿采纳、Reading Projection、task status 首屏基线和 1280×800 无横向溢出；不覆盖长任务和断线/超时恢复。 |
| J9 | task_state 生命周期可见性 | AU-10 | TurnResultViewModel / task_state | checkpoint closed | Tauri automation + Channel test | `artifacts/slice-verify/au10-workbench-recovery-taskstate-tauri/summary.json`；`bash scripts/tauri_slice_verify.sh au10-workbench-recovery-taskstate`；`workspace_channel_task_state_test.exs` | 真实“导出全书”动作覆盖 RUNNING/CHECKPOINT/COMPLETED UI，FAILED 由 Channel 回归覆盖；完整异步 LongRunner streaming 未覆盖。 |
| J10 | 断线、超时、取消等待和恢复后继续操作 | AU-10 / SU-01 | OrchestratorDecision / TurnResultViewModel | checkpoint closed / LongRunner deferred | Tauri automation | `artifacts/slice-verify/au10-workbench-recovery-disconnect-timeout-tauri/summary.json`；`artifacts/slice-verify/au10-workbench-recovery-reconnect-tauri/summary.json`；`artifacts/slice-verify/au10-workbench-recovery-cancel-waiting-tauri/summary.json`；`artifacts/slice-verify/au10-workbench-recovery-provider-timeout-tauri/summary.json`；`bash scripts/tauri_slice_verify.sh au10-workbench-recovery-provider-timeout` | CP1 已证明 provider failure recovery；CP2 已证明服务断开/重启后的 WebSocket rejoin 与下一轮继续；CP3A 已证明取消等待 no-write 关闭与下一轮继续；CP3B 已证明真实 provider timeout no-write fallback 与下一轮继续。完整异步 LongRunner 待真实生产消费者出现后再补；stale/disabled/idempotency UI 仍待更深矩阵。 |
| J11 | Prompt 前缀稳定性观测与首个实证（已收口） | AB-RESUME / VS-00I | ProviderRun / Prompt / TTFT | closed | VS-00I 已 Frozen（§14 选项 1，call2 覆盖 L0–L2 + I-CACHE-1 + DeepSeek/Strata live）；CP-AB/CP-D/CP-C/CP-E 完成；Q2/Anthropic 增量挂账不占队首 | `tasks/NEXT.md` MAINLINE-RESET / AB-RESUME；`docs/design/contracts/VS-00I-prompt-prefix-stability-contract-pack.md` §14 | 2026-10-23 作者已重开通道增量：真实调用对基线与 adapter 局部修复、Strata Tauri 回归完成；完整缓存缺口见 VS-00I §15 / UA01 §6，不改变原冻结边界。 |
| J12 | 工作台渲染稳定性与局部刷新隔离（AU-10 体验债） | AU10-RENDER-STABILITY / AU-10 | WorkspaceChat render/remount/layout | **done（2026-10-21）** | CP0 browser 7 违例 → CP1 browser 0 violations/0 errors → CP5 真实 Tauri PASS（3 场景 0 blank/remount/scroll/delta，work_switch_atomic=true）；证据 `artifacts/slice-verify/au10-workbench-render-stability-tauri/summary.json` | `tasks/NEXT.md` AU10-RENDER-STABILITY；`tasks/slices/AU10-workbench-render-stability.md` | CP2/CP3/CP4 conditional 未触发；AU10 已收口。 |
| J13 | gap ledger 台账对账与主线复位选择 | GAP-LEDGER-RECONCILE → MAINLINE-RESET | tasks/NEXT 队列 | **done（2026-10-22）** | 关闭 B12/B18/B19 残留（gap ledger 28→25，B轨14→11）；B13 核验：27 份 ADR（26 Accepted/1 Proposed）；AU10+B17+SU01 插单均已收口；2026-10-22 作者拍板 B13a → B11③ → B11① | `tasks/NEXT.md` MAINLINE-RESET；`reports/gap-ledger/latest.json` | 主线顺序已入档，转 B11C。 |
| J14 | writer timeout 后作者可见恢复出口 | B17-WRITER-TIMEOUT / DS03 | 工作台活动行 + 固定控制坞 | **done（2026-10-21，真实 Tauri PASS）** | timeout summary/reason codes 可见；scoped steer 同一 run 恢复完成并生成 pending prose；证据 `artifacts/slice-verify/b17-writer-timeout-steer-tauri/summary.json` | `tasks/slices/DS03-awaiting-author-runtime-validity-and-recovery-surface.md` §8.1 | 首跑发现并修复 replan 预算耗尽缺口；无裸 resume/无自动重试。 |
| J15 | 模型设置里使用 Strata App 统一推理后台 | SU01-STRATA-LOCAL-PROVIDER / SU-01 | ProviderOption / WorkspaceChat Dialog / Strata unified backend | **done（2026-10-22，真实 Tauri PASS；per-profile 方案 superseded）** | 产品只连 Strata App 管理的唯一统一后台 `http://127.0.0.1:47831/v1`；设置页无 per-profile 端点输入（`supports_endpoint=false`），刷新真实 `/v1/models` 选择 App 当前加载模型后连接/保存/真实 turn；2026-10-22 真实 Tauri PASS（turn `message_ae25085c-...`、模型 `iq3_s`、同 turn 2×HTTP 200；证据 `artifacts/slice-verify/su01-provider-strata-local-tauri-strata/summary.json`）。旧 per-profile 发现（`LocalModels`/`local-models` API/设置页 profile 列表）已被取代移除 | `bash scripts/tauri_slice_verify.sh --provider strata su01-provider-strata-local`；`tasks/slices/SU01-strata-local-provider.md` §10 | nightly/live 依赖 Strata App 在 47831 运行、非 CI 确定性；可选 Bearer live 路径未跑（adapter 单测覆盖）。 |
| J16 | 场级 craft 设计全集进入写作与档案可见（B11③） | B11C-SCENE-CRAFT / B11C | plan_direction.scene_plans / ProseExecutionBrief.scene_units / StructurePanel 场次计划块 | **done（2026-10-22，真实 Tauri PASS）** | 补 VS-00E 冻结的 causal_spine / information_delta / dialogue_intent / sensory_anchor，从规划字节确定性投影进 writer prompt；档案大纲可见「场次计划（2 场）」+9/9 新子槽、brief 两场且 coverage 含 4 新字段、draft 仍 tentative；证据 `artifacts/slice-verify/p1-prose-execution-brief-tauri/summary.json` | `bash scripts/tauri_slice_verify.sh p1-prose-execution-brief`（官方 env 端口可绕开占用）；`tasks/slices/B11C-scene-craft-completion.md` | B21（首次 append 场名误标）/质量场粒度/E28-E30 挂后续；非多场正文。 |
| J17 | 卷结构与卷级蓝图（B11① 大周期） | B11A-VOLUME-BLUEPRINT / VS-00J / ADR-0028 | volumes.blueprint / plot_outline 卷蓝图块 / 开新卷 plan_next_volume / 卷级收束 | **done（2026-10-22，真实 Tauri au08 三轮扩展 PASS）** | CP0–CP5 全落：E14-E17 蓝图结构化与采纳物化、卷身份/状态修复、TOC/档案可见、planner/prose/坐标/探索面消费、卷级收束守则、R10/R11 负债规则、开新卷机械 scope→scoped 候选→采纳→三卷 TOC 5/7/3（章 seq 1..15、前两卷不变）；证据 `artifacts/slice-verify/au08-volume-structured-planning-tauri/summary.json` | `tasks/slices/B11A-volume-blueprint.md`；`docs/design/contracts/VS-00J-...`；`bash scripts/tauri_slice_verify.sh au08-volume-structured-planning`；`mix run scripts/adr_trace.exs` | 长尾（R10/R11 真实触发、design_ref 接线、卷蓝图编辑/工作台当前卷 UI、45 §4.2 完整流）登记 ADR-0028 gaps；NEM-GAP-07 关闭、B11 销账。 |
| J18 | 三项收口后的主线复位选择 | MAINLINE-RESET-2 | tasks/NEXT 队列 | **done（2026-10-22，作者拍板本批顺序）** | B13a ADR 追溯门禁、B11③ 场级 craft、B11① 卷结构（CP0–CP5）均已完成并有真实页面/门禁证据；作者拍板本批 = 工程基线清账 + B21 → B13b（见 J19） | `tasks/NEXT.md` MAINLINE-RESET-2；`reports/gap-ledger/latest.json` | 选择入档；B13b 转出的候选与 B 轨项见 J19。 |
| J19 | 基线清账 + B21 + B13b 收口后的下一次主线选择 | MAINLINE-RESET-3 | tasks/NEXT 队列 | **superseded（2026-10-22 晚间作者定向 B23 插单；主选择项转入 J20）** | 2026-10-22 工程基线清账（门禁全绿）、B21 首次 append 场名误标（真实 Tauri PASS）、B13b 22 份 ADR/47 条 gaps 全部裁决落档；不预先开工 | `tasks/NEXT.md` MAINLINE-RESET-3；`tasks/slices/B13B-adr-enforcement-reconciliation.md`；`reports/gap-ledger/latest.json` | 候选：B13b 转出的 11 个独立 slice（工作台当前卷 UI、R10/R11 正触发验收等）、12 项 B 轨小修、B11D、E28-E30、VS-00D G1–G7；等待作者拍板。 |
| J20 | 停等作者时「为什么停、怎么继续」可见（B23） | B23-AWAITING-AUTHOR-REASON / DS03 / 46§9 | AgentRun awaiting_author summary / ProviderActivity 补水键 / control dock / copy | **done（2026-10-23，新场景 + 五回归真实 Tauri PASS）** | CP1 补水按 run 命中 + standalone run 刷新补水；CP2 回复/补充文案族；CP3 计划耗尽结构事实；CP4 首次 join 惰性收口 failed + 过期坞；CP5 新场景 `agent-plan-exhausted-awaiting-reason` PASS（理由可见→刷新仍可见→回复语义→同 run 恢复 completed）；回归 awaiting×2 / dead-run / writer-timeout / no-progress PASS；证据 `artifacts/slice-verify/agent-plan-exhausted-awaiting-reason-tauri/summary.json`、`agent-dead-bounded-run-expiry-tauri/summary.json` | `tasks/slices/B23-awaiting-author-reason-and-exit-surface.md`；`tasks/NEXT.md` B23 行；后端 1,816/0、前端 562/0、credo/dialyzer/format/enum/arch/xref/adr_trace/quality manifest 全绿；I1/I2/I3/N-NARR/I-CACHE-1 全绿；静态扫描 0 blocking | 判断循环「先问再做」调参、全只读计划规划层约束、run 级预算归 UA01/后续；reload 交付核对重传同 turn_id 属 server 幂等语义。 |
| J21 | B23 收口后的下一次主线选择 | MAINLINE-RESET-3 | tasks/NEXT 队列 | **closed（2026-10-23 作者定向选择 B24）** | B23 已完成（新场景 + 五回归真实 Tauri PASS），队首恢复主线复位；作者随后定向「方案 A 开一个 slice」= B24 探索面全章可读 | `tasks/NEXT.md` MAINLINE-RESET-3（已转 deferred）；`tasks/slices/B13B-adr-enforcement-reconciliation.md` §4/§7 | 选择已入档；B24 完成后 MAINLINE-RESET-3 恢复，候选清单不变（B13b 转出 11 项、12 项 B 轨小修、B11D、E28-E30、VS-00D G1–G7）。 |
| J22 | 架构与契约债按 ADR 证据逐项闭环（B13b 转出的 B 轨小修批） | B13B-FOLLOWUP / B13b | ADR enforcement / domain+application 边界 / 验收注册 | **closed（2026-10-23，10/13 落地 + 3 项作者拍板延后）** | 单测 + 两组真实 Tauri | `tasks/slices/B13B-adr-enforcement-reconciliation.md` §11；`artifacts/slice-verify/au13-review-adjudication-roundtrip-tauri/summary.json`；`artifacts/slice-verify/judgment-plan-multi-step-tauri/summary.json` | BB-1/2/3/5/6/8/9/11/12 + D14 已落；真实 Tauri：au13 rail「审读待处置 5」同源可见且全处置后消失、judgment-plan-multi-step 注册并 PASS；⏸ BB-4 `failed_recoverable` 边界 / BB-7 Q5 持久化失败 TurnResult / BB-10 日志噪声口径需作者拍板（§11.3） |
| J23 | 下一次主线选择与队列复位（B13B-FOLLOWUP 收口后） | MAINLINE-RESET-3 | tasks/NEXT 队列 | **closed（2026-10-23，作者裁决：本轮到此为止）** | 决策记录 | `tasks/NEXT.md` MAINLINE-RESET-3 / NEXT-AUTHOR-DIRECTED 行；`tasks/slices/B13B-adr-enforcement-reconciliation.md` §4.1/§7/§11 | 复位完成、不新开项；候选清单保留（B13b §4.1 11 项 + 延后 BB-4/BB-7/BB-10 + B11D/E28-E30/VS-00D G1–G7）；下一项等作者另行指示（`NEXT-AUTHOR-DIRECTED` 为队首，AI 不得自行替换） |
| J24 | 等待作者指定下一项（本轮队列已清空） | NEXT-AUTHOR-DIRECTED | tasks/NEXT 队列 | **closed（2026-10-23，作者已给出下一项指示）** | — | `tasks/NEXT.md` B13B-DEFERRED-CLOSURE 行；`tasks/slices/B13B-adr-enforcement-reconciliation.md` §11.3 | 作者拍板 B13b 延后 3 项（BB-4/BB-7/BB-10 均方案 A），指令「只定方案，下一轮再执行」；队首转 `B13B-DEFERRED-CLOSURE`（next） |
| J25 | 执行 B13b 延后 3 项收口（BB-4/BB-7/BB-10，方案 A 已拍板） | B13B-DEFERRED-CLOSURE / B13b | TurnStatus / Adoption 持久化失败 / 日志噪声门禁 | **closed（2026-10-23，CP1–CP5 全落；真实 Tauri 六场景 PASS + au04 既有漂移 D21 诚实登记）** | 单测 + 真实 Tauri（隔离库/分区） | `tasks/NEXT.md` B13B-DEFERRED-CLOSURE 行；`tasks/slices/B13B-adr-enforcement-reconciliation.md` §11.4；`artifacts/slice-verify/{q3d-author-registration-guards,q3d-candidate-semantics,au05-conflict-cross-work-recovery,au05-canon-conflict-recovery,p1-chapter-adoption-reading,judgment-explore-chapter-plan}-tauri/summary.json` | BB-4：`TurnResultBuilder`/`AgentRunServer.safe_failure_turn_result`/`AdoptionWorkflow.decision_status`/`DialogueGateway.candidate_status` → `failed_recoverable`（phase 仍 failed、run/action_result status 不变）；BB-7：persist error → 失败 action_result + failed_recoverable TurnResult + `{:ok,...}` 广播（VS-04 规则 5）；BB-10：ADR-0018 §4 `level` + §6 45/60 口径 + `scripts/check_log_noise.sh`（17/17）+ CI + verifier `evaluateAppLogNoise`（正常路径 0 error；p1 38 行 / judgment-explore 14 行）+ 3 份 manifest data 断言；au05 两场景 seed 补 `kind` 夹具漂移；au04 未通过=既有判断纪元漂移 D21（非本批引入） |
| J26 | Provider 存活策略真实页面闭环（慢但持续出字不被杀） | B22-CP4-SLOW-STREAM / B22 | Provider TimeoutPolicy / 流式 wire 静默 / 作者可见运行时长 | **closed（2026-10-23，真实 Tauri PASS）** | 外部 Tauri + 本地慢流替身 | `tasks/NEXT.md` B22-CP4-SLOW-STREAM 行；`tasks/slices/B22-provider-liveness-and-budget-policy.md` §2d；`artifacts/slice-verify/agent-provider-slow-stream-liveness-tauri/summary.json` | 新场景 `agent-provider-slow-stream-liveness`：本地 OpenAI 兼容替身 700ms/块持续 ~7s；真实 LM Studio adapter/Gateway/TimeoutPolicy + `NOVEL_LMSTUDIO_TIMEOUT_MS=3000`（仅 wire 静默窗口）→ 不被总挂钟误杀、5.2s 起作者可见「已运行」、正常 conversational TurnResult、`provider_timeout_count=0`；log noise 9 行/0 error；自适应校准明确保留 bootstrap 登记 C 轨观察（不冒充） |
| J27 | 章节身份统一（写入/采纳/阅读/使命链） | B25-CHAPTER-IDENTITY-UNIFICATION / B24 | chapter_ref 唯一寻址 / AdoptionRepository / ReadingProjection / 唯一约束 | **closed（2026-10-23，CP0–CP5 全落；新真实 Tauri 场景 + B24 两场景回归 PASS）** | 单测矩阵 + 真实 Tauri | `tasks/NEXT.md` B25 行；`tasks/slices/B25-chapter-identity-unification.md` §2.1–§2.5；`artifacts/slice-verify/b25-chapter-identity-unification-tauri/summary.json`；B24 两场景 summary | CP0 契约冻结（`chapter_ref` 唯一 / seq work 内唯一 / title 非唯一；禁止 first-match、同名多章诚实歧义）+ 90 章历史审计 0 冲突；CP1 仓储层 ref 写读与歧义错误；CP2a+CP2b 应用链/计划链 `target_chapter_ref` 贯通（含判断②合成重试步与修订路径继承）；CP3 `chapters` `(work_id,seq)` 唯一索引 + `chapter_identity_repair.exs` 显式修复（90 章演练无损、rollback 实测）；CP4 真实 Tauri：两章同名并存、采纳只落 ref 目标章（第一章 0 scene/0 chars、第二章 scene=2/chars=52）、TOC chapter_count=2/empty=1、作者可见无 ref/UUID，B24 两场景回归 PASS；CP5 全门禁绿 |
| J28 | 主线复位：B25 收口后队列无未闭环实现项，等待作者拍板下一项（B13b §4.1 候选/B11D/E28-E30/VS-00D G1–G7/C 轨观察；B26 由并行会话负责） | MAINLINE-RESET-4 | 队列选择 | **closed（2026-10-23，作者指令「按 tasks/NEXT.md 顺序逐项推进直到完成所有 task 和 slice」→ 授权按候选顺序自动推进 backlog；B26 仍由并行会话负责、本会话不碰）** | 作者裁决 | `tasks/NEXT.md` MAINLINE-RESET-4 / GATE-ORDER-CLOSURE 行；`tasks/NEXT.md` §4/§6 | 选择入档：B13b §4.1 `#2 GATE-ORDER-CLOSURE` 为首项（#1 PLANNER-SEMANTIC-BOUNDARY 因并行会话 B26 正在重写 judgment_protocol 而暂缓，避免写冲突）；后续按 §4.1 顺序推进 |
| J29 | 执行权门禁逐门可解释（12 门 + GateResult/version + DecisionTrace） | GATE-ORDER-CLOSURE / ADR-0005 / VS-01 | GateOrder / GateResult / OrchestratorDecision / DecisionTrace / Replay | **closed（2026-10-23，真实 Tauri `agent-step-regate` PASS + 36 单测；e2e-01 降级场景 blocked 裁决）** | 单测矩阵 + 真实 Tauri 外部自动化 | `tasks/slices/GATE-ORDER-CLOSURE-execution-gate-order-12.md`；`artifacts/slice-verify/agent-step-regate-tauri/summary.json`；`apps/novel_application/test/novel_application/gate_order_closure_test.exs` | ADR-0005 全 12 门落地（含 behavior/slot/policy/toolbox 独立门）；`GateResult` 六态 outcome + `gate_order_version=adr-0005-v1`；逐门 lineage 进 decision/log/agent event/DecisionTrace（migration `20261023000002`）；真实接线 run 剩余预算（6 flow）、trace readiness、confirm re-gate 幂等 lineage/behavior 解析；toolbox 用 dispatchable；pass-downgrade first gate 修正 nil；allow/blocked 双路径落 trace（`BlockedDecisionTrace`）；Replay 六问契约不变地并入 gate 事实。真实 Tauri：2 step × 12 门有序、budget `run_budget_remaining`、trace readiness pass、step trace_summary 12 条 gate results、2 条 gate_decided event。诚实边界：blocked 路径真实页面场景、behavior 主路径、slot 后置、policy 规则集、幂等输入一致性、e2e-01 re-anchor 均登记后续 |
| J30 | 行为生命周期决策权收口（同 workstream 显式 supersede 旧 author-blocking behavior） | BEHAVIOR-LIFECYCLE-DECISION-AUTHORITY / ADR-0008 / VS-03 | BehaviorState / AdoptionWorkflow / WorkspaceChannel | **closed（2026-10-23，真实 Tauri `au06` re-anchor PASS + 单测；8-1/9-2 文档化偏差）** | 单测矩阵 + 真实 Tauri（B1→B2 显式 supersede、旧确认不可执行、最新确认只采纳一次） | `tasks/NEXT.md` BEHAVIOR-LIFECYCLE 行；`tasks/slices/BEHAVIOR-LIFECYCLE-DECISION-AUTHORITY.md`；`artifacts/slice-verify/au06-single-active-confirmation-tauri/summary.json` | 作者默认裁决 Q2=B（VS-03 维持 draft）：8-2 显式 supersede 落地（`BehaviorState.supersede/3` + `snapshot/2` + `from_map/1`；AdoptionWorkflow history/trace refs；Channel active_behavior + 真实 accept 路径注入 previous_behavior）；8-1 cancel/reject 关闭不经 decision、9-2 binding 不校验 open behavior 登记文档化偏差 + 触发翻案条件。au06 re-anchor 为 seeded pending-candidate 流 |
| J31 | 采纳状态转换矩阵在持久化边界强制（canon 两步仪式、非法转换可解释拒绝） | Q1CB-ADOPTION-TRANSITION-ENFORCEMENT / ADR-0019 / VS-04 | AdoptionRepository / AdoptionWorkflow / Draft schema | **closed（2026-10-23，真实 Tauri `p1-chapter-edit-then-accept` PASS + 单测矩阵；复活 Deferred）** | 单测矩阵 + 真实 Tauri（pending TENTATIVE → resolved EDITED_ACCEPTED 两步留痕、合法流程零非法转换拒绝） | `tasks/NEXT.md` Q1CB 行；`tasks/slices/Q1CB-ADOPTION-TRANSITION-ENFORCEMENT.md`；`artifacts/slice-verify/p1-chapter-edit-then-accept-tauri/summary.json` | 作者默认裁决 Q4：矩阵下沉 persistence（`Draft.changeset` 矩阵校验 + supersede 逐行受校验 + 非法转换可解释失败）；复活/un-archive 维持 Deferred + trigger；库内仍单行 canon（两步仪式为 wire/决策语义）；非法转换拒绝真实页面不可达，由单测覆盖 |
| J32 | 卷级负债规则正触发（planned=4、事实 3 卷且 2 卷缺蓝图 → 审读 R10/R11 finding → 处置 → 清空报告） | R10R11-VOLUME-DEBT-SCENARIO / ADR-0028 / VS-00J | au13 审读场景（真实 Tauri） | **closed（2026-10-23，真实 Tauri `au13-review-adjudication-roundtrip` 扩展 PASS + au14 回归 PASS）** | 真实 Tauri：8 处偏离（R10 1 + R11 2 + 停滞 4 + 提前收官 1）→ 逐条处置（含 3 条修订设定 correction intent）→ 报告清空 + rail 计数归零 | `tasks/NEXT.md` R10R11 行；`tasks/slices/R10R11-VOLUME-DEBT-SCENARIO.md`；`artifacts/slice-verify/au13-review-adjudication-roundtrip-tauri/summary.json` | 产品零改动（规则已实现）；R10/R11 只产设计负债 finding，不静默改写规划/不阻断写作；扩既有审读场景不新增平行场景 |
| J33 | 工作台头部显示真实写作坐标当前卷（不出现假「未定卷」） | WORKBENCH-CURRENT-VOLUME / ADR-0028 §UI / VS-00J 消费面 | WorkspaceChat / TurnResult writing_coordinate / get_toc / Channel | **closed（2026-10-24，真实 Tauri `au08` 扩展 PASS + 4 端单测）** | 真实 Tauri：get_writing_coordinate reply 卷名 + 页面头部可见文本双层断言 = 本轮坐标解析真实卷（第一卷·觉醒），零「未定卷」 | `tasks/NEXT.md` WORKBENCH-CURRENT-VOLUME 行；`tasks/slices/WORKBENCH-CURRENT-VOLUME.md`；`artifacts/slice-verify/au08-volume-structured-planning-tauri/summary.json` | 作者默认裁决 Q11-A：写作坐标 volume_ref 为主 + get_toc 回退；规划态回退 TOC；无卷显示「全书」；TurnResult additive 字段不新增持久化列；卷蓝图编辑维持非目标 |
| J34 | B11D 质量场粒度（规划场级 finding 归因 + 质量卡可见 + 场级修订作用域；多场正文 Deferred→B28） | B11D-QUALITY-FIELD-GRANULARITY / VS-00E / ADR-0020 | QualityEvaluator / ProseQualityService / ProseRevisionService / 质量卡 | **closed（2026-10-24，真实 Tauri `p1-prose-quality-finding-roundtrip` 扩展 PASS + 9 端单测）** | 真实 Tauri：finding 归因「场 · 撤退（第 2 场）」+ 关联设计字段 + 场级修订 prompt（候选仍整章）+ 零采纳 | `tasks/NEXT.md` B11D 行；`tasks/slices/B11D-quality-field-granularity.md`；`artifacts/slice-verify/p1-prose-quality-finding-roundtrip-tauri/summary.json` | 审计默认：场语义=规划场次（scene_N 白名单）；方案 A（候选仍整章、采纳仍章级）；多场正文/场级替换 Deferred→B28；evaluator 自报场字段不采信 |
| J35 | VS-00D AI 引导创作契约包 G1–G7 差距对账（承接/降级/挂账裁决，契约未关闭项如实登记） | VS-00D-G1-G7 / VS-00D 契约包 | 差距台账 / 队列 / B27·B26 并行承接 | **closed（2026-10-24，差距回收仪式 22 项全裁决；无产品代码变更）** | 差距台账快照 + 逐项裁决入账 + B 轨销账/降级 + 重扫复核（22→19 开放） | `tasks/slices/VS00D-G-GAP-RECONCILIATION.md`；`reports/gap-ledger/latest.json`；`tasks/NEXT.md` VS-00D 行 | G1/G3/G5/G7 承接 B27+B26（trigger；复核补正：AU11 producer 已删除 c4509c86、两场景 2026-10-24 真实 Tauri 复跑 exit 1 标 blocked，known-gaps 修正为 4 条 blocked）；G2 余项（CA01 planner facts 段 + Order 7-ⓔ + OmissionNote/B10）降级 C 轨；G3 schema 无 owner 登记 gap；G4 观察；G6 机制由 B11D 关账+长篇效果狗粮观察；G1–G7 不关闭；契约文档状态更新归 B27 owner（不碰并行工作树） |
| J36 | 开工/收尾差距回收与触发条件复核 | C-TRACK-OBSERVATION / NEXT §5 | 差距台账 / 队列 | 周期动作（本轮已执行，不占 next） | 差距扫描与处置记录 | `tasks/NEXT.md` §4/§5；`reports/gap-ledger/latest.json` | 扫描、归并不等于功能完成；本轮从周期观察转向 C14 产品主线。 |


---

## 13. Journey Health Summary

| Journey | Closed Prefix | Current Breakpoint | P0/P1 Gaps | Evidence Level | Health |
|---|---|---|---:|---|---|
| A 启动与供应商 | A1-A4 | A5 provider runtime config | 多个 SU-01 P0/P1 | Tauri + API | watch |
| B 作品与上下文 | B1-B12 CP1 | AU12 CP2/CP3 后续 | 0（当前连续链路） | Tauri/LMStudio | closed-prefix |
| C 自然对话与探索 | C1-C6/C9-C10/C12-C13 已验范围保留；C7 补矩阵/C8 blocked | C14 联合作者交互 → C15 一般输入绑定；C8 待恢复 | 回复绑定/任务语义/当前协议未闭环 | 历史 Tauri + 当前源码；新链待验 | needs-focus |
| D 创作生命周期 | D1-D3、原 D5、P1 与 VS-00C 的已验范围 | D12 全章 → D13 结构 → D14 角色 → D15 创作复验 | 完整对象维护与长期质量未闭环 | 历史 Tauri/browser + tests；新链待验 | needs-focus |
| E 执行与行为 | E1-E2 局部 | E3/E4 lifecycle completion | 多个 P0 | Mixed | needs-focus |
| F 草稿与采纳 | F1-F8 checkpoint | revision/state trace completeness | 多个 P0 | Tauri | watch |
| G 阅读投影 | G1-G4 核心链 | G3 refresh state machine | P1 | Tauri | watch |
| H 记忆治理 | AU-09 文件级可交付：H3-H4/H6-H11 当前 Tauri/quality 闭环，H1/H2 部分实现 | archive stats / pending inbox / replay / old turn / full trace table | P1/P2 | Tauri + tests | watch |
| I Trace/Replay | I1 + I4 producer checkpoints | I2-I5 old-turn/developer/full-report completeness | 多个 P1 | Tauri + tests | watch |
| J 工作台体验 | J1-J5 最小闭环 + J8 baseline checkpoint + J9 task_state checkpoint + J10 CP1 provider failure recovery + CP2 service reconnect recovery + CP3A cancel waiting recovery + CP3B provider timeout recovery | LongRunner deferred / 深矩阵待补 | 多个 P0/P1 | Tauri | watch |

执行顺序见 [NEXT](../../tasks/NEXT.md)，任务状态及更新边界见 [tasks/README](../../tasks/README.md)。上表表示体验覆盖，不是施工进度。


---

## 14. 跨 Journey 依赖图

| Source Gap / Step | Blocks | Reason |
|---|---|---|
| B7-B11 work/session/context 分层 | H 记忆召回、I trace why、F adoption provenance | 上下文边界不稳会污染记忆、采纳来源和解释。 |
| C6 candidate -> adoption bridge | F 草稿采纳、D 创作生命周期 | 已闭环；候选选择现在可以通过授权 action 进入 adoption boundary。 |
| E3-E6 confirmation lifecycle | F5 高风险采纳、D5 修订覆盖 | 高风险写入必须复用 confirmation binding 和 re-gate。 |
| F5-F8 adoption safety | G 阅读投影、H 设定入记忆 | 没有可靠 adopted state，阅读和记忆都会读到不可信事实。 |
| G3 projection refresh | D 成稿阅读体验、J 工作台状态 | 投影刷新边界不稳会让阅读模式误报事实状态。 |
| H9 validity window recall | B9 context SSOT、I why 来源解释 | 已闭环：章节窗口外记忆不进入 context/why；scene-level 和降权策略可后续深化。 |
| H10 cross-work memory isolation | B1 作品切换、B9 context SSOT、I why 来源解释 | 已闭环：真实工作台 A→B 切换后，档案、记忆页、recall 和 why 不串作品。 |
| H11 session memory layering | B7-B11 work/session/context 分层、I why 来源解释 | 已闭环：同一作品内 historical transcript 不覆盖 active session，也不伪装成 governed memory。 |
| I2-I5 trace/replay completeness | E/F/H 的可解释性 | 工具、行为、状态、记忆都需要统一解释和 replay。 |
| J6-J8 integrated workbench | 所有作者旅程 | UI 是主消费者；如果 UI 分裂，真实用户无法完成闭环。 |

---

## 15. 执行入口

- [NEXT](../../tasks/NEXT.md)：选择当前任务与后续候选。
- [任务状态与更新规则](../../tasks/README.md)：原任务维护执行状态；本图仅随体验覆盖变化更新。
- [项目事实台账](../project-ledger.md)：历史交付与证据索引。

不再要求旅程图复制队首任务编号、next 状态或 NEXT 的决策日志。
