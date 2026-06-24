# Product User Journeys / 用户旅程地图

> 最后更新：2026-06-18
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
| `next` | 当前推进队列的下一断点，必须与 `tasks/NEXT.md` 对齐。 |
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

Longest Closed Prefix：C1-C6。

Current Breakpoint：C8 质量诊断 message envelope。

Next Proof：作者输入“这一章不够爽，主角赢得太轻了”后，真实工作台 trace/why 能重建小说层、当前作品层和本轮引导层，且不静默写入作品事实。

| Step | 用户动作 / 体验节点 | AU/SU | v3 主链对象 | Status | Evidence Grade | Evidence / Command | Gap / Next |
|---:|---|---|---|---|---|---|---|
| C1 | 普通创作聊天不误触发 MicroPlan | AU-01 / AU-10 | DialogueFrame / TurnResultViewModel | closed | Tauri automation | `artifacts/slice-verify/au10-ordinary-chat-no-micro-plan-tauri/summary.json` | 完整 AU-01 场景覆盖仍需重算。 |
| C2 | 两轮普通聊天保留上下文和 DOM 反馈 | AU-01 / AU-03 | DialogueContext / DialogueFrame | closed | Tauri automation | `artifacts/slice-verify/au01-ordinary-chat-two-turn-roundtrip-tauri/summary.json` | messages 契约后真实 LMStudio 复验仍需补。 |
| C3 | 模糊创意产生候选方向 | AU-02 | DialogueFrame / TurnResultViewModel | closed | Tauri automation | `artifacts/slice-verify/au02-candidate-continuation-tauri/summary.json` | 真人 UI 观感复验仍可补。 |
| C4 | 候选卡可点击继续探索 | AU-02 / AU-10 | AvailableAction / AuthorInput | closed | Tauri automation | `bash scripts/tauri_slice_verify.sh au02-candidate-continuation` | 继续探索不等于采纳已验证。 |
| C5 | frame badge 区分自然回复和探索 | AU-02 / AU-10 | DialogueFrame / TurnResultViewModel | closed | Tauri automation | `au02-candidate-continuation` frame badge evidence | 还缺更多 frame 类型样例。 |
| C6 | 从候选方向明确进入采纳边界 | AU-02 / AU-05 | AuthorActionInput / AdoptionDecision | closed | Tauri automation | `artifacts/slice-verify/au02-candidate-adoption-bridge-tauri/summary.json` | 已证明 selection / adoption 分离；后续转入 Journey F 安全门禁。 |
| C7 | LLM 异常、乱码、超时后可继续自然对话 | AU-01 | OrchestratorDecision / TraceSummaryView | checkpoint closed / 继续补矩阵 | Tauri automation + Application test | `artifacts/slice-verify/au10-workbench-recovery-disconnect-timeout-tauri/summary.json`；`artifacts/slice-verify/au10-workbench-recovery-cancel-waiting-tauri/summary.json`；`artifacts/slice-verify/au10-workbench-recovery-provider-timeout-tauri/summary.json`；broken provider / garbage JSON tests | provider 不可用恢复、高风险 confirmation 取消等待与真实 provider timeout 已由真实工作台证明；缺乱码和更完整 UI 恢复验收。 |
| C8 | 质量诊断请求组织三层 message | AU-11 / VS-00D / AU-07 | AIMessageEnvelope / DialogueFrame / TraceSummaryView | next | Documented task | `tasks/slices/AU11-quality-diagnosis-message-envelope.md` | 需要证明质量诊断 turn 的 NovelLayer / WorkState / TurnGuidance 可由 trace/why 重建，且不绕过 MicroPlan / Orchestrator / adoption 写入作品事实。 |

---

## 5. Journey D：小说创作生命周期

目标：作者能围绕一部长篇作品从立项、定位、世界观、角色、卷章、场景、正文、修订到成稿持续推进，而不是只得到零散聊天回复或孤立草稿。本 Journey 也是 `docs/product/novel-output-milestones.md` 的主要产品承载面，P1/P2/P3/P4 的字数目标必须通过这里的章节规划、正文生成、采纳、阅读和导出链路证明，而不是通过旁路脚本堆字数。

关联验收：AU-02、AU-05、AU-08、AU-09；复用 v2 小说领域设计 `20-28`、质量门禁 `31-32` 的产品语义。

关联 v3 contract：`DialogueContext`、`MicroPlan`、`ToolRequest`、`ToolResult`、`TentativeArtifactSet`、`AdoptionDecision`、`ProjectionHint`。

保护的不变量：`00c` §7 #3 Orchestrator 唯一门禁、#5 工具调用有 trace、#6 写入默认 tentative、#11 selection != adoption、#15 projection 只刷新。

真实消费者：作者主工作台、作品档案、采纳面板、阅读模式。

Longest Closed Prefix：D1-D3 是最小闭环；D7 的 P1 10 万字主链 checkpoint 已闭环；VS-00C CP2-CP5 已补齐当前设计要求下“写第 N 章首稿”的上下文质量前置。

Current Breakpoint：Journey D 当前支撑切面 VS-00C CP5 已闭环。P1 10 万字主链已证明系统能长跑；“写第 N 章首稿”的上下文质量前置现包括 CP2 实现态摘要窗口、CP3 目标章计划摘要和卷内位置、CP4 结构化方向层、CP5 ReaderEffectBrief 与非权威 self_report。AU09 archive memory roundtrip CP2、memory management workbench entry、memory trace roundtrip、validity window recall、cross-work memory isolation 与 session memory layering 已闭环，当前执行队列已转向 AU11 的质量诊断 message envelope。

Next Proof：当前队首是 AU11 / VS-00D 质量诊断 message envelope，先证明质量诊断 turn 能重建小说层、当前作品层和本轮引导层；后续若推进更深创作质量，应进入独立 creative-quality / maintenance slice，把 CP5 的风险线索变成正式 quality finding。

| Step | 用户动作 / 体验节点 | AU/SU | v3 主链对象 | Status | Evidence Grade | Evidence / Command | Gap / Next |
|---:|---|---|---|---|---|---|---|
| D1 | 模糊立项或题材想法被展开 | AU-02 | DialogueFrame / TurnResultViewModel | closed | Tauri automation | `artifacts/slice-verify/au02-candidate-continuation-tauri/summary.json` | 只是探索入口，不是完整立项生命周期。 |
| D2 | AI 生成小说材料但默认只是草稿 | AU-05 | ToolResult / TentativeArtifactSet | closed | Tauri automation | `artifacts/slice-verify/au05-adoption-boundary-tauri/summary.json` | 完整 StateTrace 仍不足。 |
| D3 | 采纳章节片段后能阅读 | AU-08 | AdoptionDecision / ProjectionHint | closed | Tauri automation | `artifacts/slice-verify/au08-adoption-reading-projection-tauri/summary.json` | 真实卷章归属/合并仍缺。 |
| D4 | 立项 -> 世界观/角色/大纲/章节/场景的连续规划 | AU-02 / AU-09 | MicroPlan / ToolRequest / DialogueContext | gap | Document only | v2 lifecycle 设计、v3 acceptance 分散覆盖 | 缺统一生命周期入口和分阶段 proof。 |
| D5 | 修订已采纳内容，保留 provenance 和冲突恢复 | AU-05 / AU-08 | AdoptionDecision / DecisionTrace | gap | Document only | AU-05 conflict/freshness gaps | 缺 revision boundary、覆盖确认、阅读投影刷新。 |
| D6 | 内容质量门禁参与采纳或修订 | AU-05 / AU-09 | ToolResult / OrchestratorDecision / TraceSummaryView | gap | Document only | v2 quality gates 已设计，v3 首批只接最小质量证明 | 缺质量 finding 到 UI/proof 的产品链。 |
| D7 | P1 10 万字最小长篇闭环 | AU-02 / AU-05 / AU-08 / AU-10 | TentativeArtifactSet / AdoptionDecision / ProjectionHint / TurnResultViewModel | closed | Tauri automation | `artifacts/novel-output/p1-100k-dogfood/`；`artifacts/slice-verify/p1-chapter-plan-minimum-tauri/summary.json`；`artifacts/slice-verify/p1-chapter-draft-generation-tauri/summary.json`；`tasks/slices/P1-chapter-adoption-reading.md` | P1 长篇主链已达成；VS-00C 上下文质量 CP、AU09 archive memory roundtrip CP2、AU09 memory management entry、AU09 memory trace roundtrip、AU09 validity window recall、AU09 cross-work memory isolation 和 AU09/AU03 session memory layering 均已闭环，当前队首转向 AU11 quality diagnosis message envelope。 |
| D8 | P1 单章正文草稿生成 | AU-02 / AU-05 / AU-10 | MicroPlan / ToolRequest / ToolResult / TentativeArtifactSet | closed | Tauri automation | `artifacts/slice-verify/p1-chapter-draft-generation-tauri/summary.json`；`bash scripts/tauri_slice_verify.sh p1-chapter-draft-generation` | 真实工作台基于已采纳章节计划生成 `prose_fragment` 待采纳正文草稿；未采纳正文不进入 ReadingMode。单章 1000 字下限仍待后续扩写 / 字数统计 checkpoint。 |
| D9 | P1 单章正文采纳与阅读 | AU-05 / AU-08 / AU-10 | AdoptionDecision / ProjectionHint / TurnResultViewModel | closed | Tauri automation | `artifacts/slice-verify/p1-chapter-adoption-reading-tauri{,-lmstudio}/summary.json`；`tasks/slices/P1-chapter-adoption-reading.md` | 已证明作者采纳 `prose_fragment` 后，正文进入作品事实和 Reading Projection，ReadingMode 目录和章节正文从 Channel 读取。 |
| D10 | VS-00C CP4 章计划结构化方向层 | VS-00C / NEM-GAP-03 | DialogueContext / ToolRequest / DecisionTrace | closed | Tauri + tests | `artifacts/slice-verify/vs00c-cp4-chapter-plan-structure-tauri/summary.json`；`tasks/slices/v3/VS-00C-creative-context-assembly.md` | 章计划已从自由文本摘要升级为 E18-E22 结构方向，prose_writing L2 可获得章功能、目标四件套、情绪定位、断章和字数场次。 |
| D11 | VS-00C CP5 ReaderEffectBrief 与自报告 | VS-00C / G12 / G14 | DialogueContext / ToolRequest / TurnResult / TraceSummaryView | closed | Tauri + tests | `artifacts/slice-verify/vs00c-cp5-reader-effect-brief-tauri/summary.json`；`tasks/slices/v3/VS-00C-creative-context-assembly.md` | 已在 CP4 章方向之上补读者效果目标、钩子承诺和风险约束；AI 输出自报告只作为 quality signal / warning，不自动进入 adoption payload 或作品事实。 |

---

## 6. 使用规则

1. 每次开工先读 `tasks/NEXT.md`，再用本文确认队首任务属于哪个 journey step。
2. `tasks/NEXT.md` 是执行队列唯一入口；本文是用户流程和断点依据；`docs/project-ledger.md` 是事实台账。
3. 如果要改变 Current Focus，必须先更新本文对应 journey 状态，再更新 `tasks/NEXT.md` 的 `Decision Log`。
4. 每完成一个 checkpoint，必须把对应 step 的 `Status`、`Evidence Grade`、`Evidence / Command` 更新到本文。
5. `closed` 必须有真实 Tauri/前端发起闭环；后端、Channel、组件或文档证据只能标 `partial` 或 `gap`。
6. 单场景细节仍以 `docs/design/acceptance/` 为准；本文只维护跨 AU/SU 的连续用户流程。
7. 如果一个 journey step 新增或改动，必须能回答 Contract / Invariant / Boundary / Consumer / Proof。

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

Current Breakpoint：J10/AU10-workbench-recovery-disconnect-timeout CP3B 已闭环，当前队首不在 Journey J，而是 AU11 / VS-00D quality diagnosis message envelope。`WorkspaceChat` 已是唯一生产工作台入口，`au10-workbench-matrix-layout` 已覆盖 1280×800 baseline，`AU10-workbench-recovery-taskstate` 已覆盖真实导出动作的 task_state 可见生命周期，`au10-workbench-recovery-disconnect-timeout` CP1 已覆盖 provider failure 后 no-write、loading 清除和恢复后继续下一轮；CP2 已覆盖后端服务断开/重启后的同步离线、输入禁用、自动 rejoin 与下一轮继续；CP3A 已覆盖高风险工具 confirmation 取消等待后的 cancelled action_result / TurnResult、no-write、按钮清除和下一轮继续；CP3B 已覆盖真实 provider receive timeout 后 no-write fallback、loading 清除和恢复后继续下一轮。完整异步 LongRunner 因缺真实生产消费者延后。

Next Proof：Journey J 后续是完整异步 LongRunner streaming 和恢复后继续操作的一条综合 walkthrough，但必须先出现真实批量生成/推演消费者；短期队首见 AU11 / VS-00D。

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

---

## 13. Journey Health Summary

| Journey | Closed Prefix | Current Breakpoint | P0/P1 Gaps | Evidence Level | Health |
|---|---|---|---:|---|---|
| A 启动与供应商 | A1-A4 | A5 provider runtime config | 多个 SU-01 P0/P1 | Tauri + API | watch |
| B 作品与上下文 | B1-B12 CP1 | AU12 CP2/CP3 后续 | 0（当前连续链路） | Tauri/LMStudio | closed-prefix |
| C 自然对话与探索 | C1-C6 | C7 error recovery | 1 | Tauri | watch |
| D 创作生命周期 | D1-D3 + P1 长篇主链 checkpoint + VS-00C CP5 | creative-quality / maintenance 后续 | 多个 | Tauri + tests | closed-prefix |
| E 执行与行为 | E1-E2 局部 | E3/E4 lifecycle completion | 多个 P0 | Mixed | needs-focus |
| F 草稿与采纳 | F1-F8 checkpoint | revision/state trace completeness | 多个 P0 | Tauri | watch |
| G 阅读投影 | G1-G4 核心链 | G3 refresh state machine | P1 | Tauri | watch |
| H 记忆治理 | AU-09 文件级可交付：H3-H4/H6-H11 当前 Tauri/quality 闭环，H1/H2 部分实现 | archive stats / pending inbox / replay / old turn / full trace table | P1/P2 | Tauri + tests | watch |
| I Trace/Replay | I1 + I4 producer checkpoints | I2-I5 old-turn/developer/full-report completeness | 多个 P1 | Tauri + tests | watch |
| J 工作台体验 | J1-J5 最小闭环 + J8 baseline checkpoint + J9 task_state checkpoint + J10 CP1 provider failure recovery + CP2 service reconnect recovery + CP3A cancel waiting recovery + CP3B provider timeout recovery | LongRunner deferred / 深矩阵待补 | 多个 P0/P1 | Tauri | watch |

当前推进锁定：

```text
Current Focus: 滚动验收文件级闭环，当前可进入 AU-10 工作台实时交互
Current Journey: Journey J（工作台体验），同时引用 Journey B/F/G/H/I 的已闭环证据
Current Breakpoint: AU10-file-level-audit
Next Task: AU10-file-level-audit
```

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

## 15. NEXT 对齐

`tasks/NEXT.md` 当前规定：

```text
Current Focus: 滚动验收文件级闭环，当前可进入 AU-10 工作台实时交互
Active Journey: Journey J（工作台体验）
Queue head: AU10-file-level-audit
```

本文对应位置：

```text
Journey H / AU-09
Step: AU09-file-level-closure
Status: file-level deliverable
Gap / Next: AU-09 核心记忆治理链 P0 已关闭；8 个 AU-09 quality 入口已挂入当前 Tauri acceptance。完整 archive stats、pending inbox、筛选分页、developer replay、历史旧 turn 查询、Channel 管理入口和完整 MemoryTrace/StateTrace 登记为 P1/P2。下一步按用户指定顺序进入 AU-10。
```

选择规则：

1. 默认只能取 `tasks/NEXT.md` 中第一个 `Status=next` 的任务。
2. 如果出现 P0 bug，可以临时插队，但必须同步更新 `tasks/NEXT.md` Decision Log 和本文对应 journey step。
3. 如果 C6 无法闭环，不能跳到其他 AU/SU；必须先把 blocker 写入 `tasks/NEXT.md`，再选择 Journey C/F 内最小可闭环 checkpoint。
4. 完成任务后必须同步更新：
   - `tasks/NEXT.md` 的 Queue 和 Decision Log
   - 本文对应 journey step 的 Status / Evidence
   - `docs/project-ledger.md` 的事实与证据
