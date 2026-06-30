# tasks/slices/

承重竖切面执行目录。

长期规则见 `docs/engineering/vertical-slice.md`。当前队列入口见 `tasks/NEXT.md`；本目录只保留仍服务当前推进的 P1 / AU / SU / SI slice 文件。

## 文件类型

| 前缀 | 用途 |
|---|---|
| `P1-*.md` | P1 小说主链与质量 checkpoint |
| `AU*.md` | 作者旅程验收缺口或恢复 slice |
| `SU*.md` | 系统用户旅程验收缺口或恢复 slice |
| `SI-*.md` | 场景化验收不变量与 CI 强制项 |
| `v3/` | 历史命名的当前承重切面工作区；后续有改动时应逐步迁出或重命名，不再新建版本化目录 |

## 当前 Slice 文件

| 文件 | 角色 |
|---|---|
| `UA01-unified-agent-run-mainchain-closure.md` | **doing / UA-01 主链收口**：按 2026-06-29 收紧后的验收口径审计并推进 CP4/CP5/CP6 及后续 CP。CP2 普通对话已从 `conversation_turn_v1` 单 step 黑盒拆为 context / frame / strategy / finalize 四阶段 AgentRun，并由真实 Tauri `agent-conversation-turn` 验证；CP4 revision profile 已有 fresh Tauri summary，正文草稿已从旧四步 fixed workflow 继续纯化为 observation-led next-step planner profile，并完成 fresh Tauri summary；章节大纲与角色演化已进一步从固定 steps workflow 纯化为 observation-led next-step planner profile，并完成 fresh Tauri summary；CP5 durable AgentRun + LongRunTask 已通过 backend restart 恢复验收；CP6 provider progress / ProviderExecution cancel / readonly batch 已通过真实 Tauri。新的队首转向 provider execution stream 统一架构；更多创作 profile 继续作为后续扩展。 |
| `UA01-CP5-durable-agent-run-resume.md` | **done / verified**：CP5 durable AgentRun + LongRunTask 恢复闭环子 slice。已实现 durable profile 分账、LongRunTask 关联、checkpoint/recovery/stale policy、Channel join recovery 与 UI 恢复面板；`agent-durable-resume-long-run-task` 已转 active/nightly 并通过真实 Tauri 验收。 |
| `UA01-CP6-stream-cancel-readonly-batch.md` | **done / verified**：CP6 provider progress、ProviderExecution cancel 边界、只读 batch profile 子 slice。三条 scenarios 已 active/nightly 并通过真实 Tauri：`agent-provider-streaming-progress`、`agent-provider-cancel-honest-boundary`、`agent-readonly-batch-profile`。这是历史 CP6 progress/cancel/read-only batch 证据，不等于 provider token streaming 或真实 live vendor 验证矩阵完成。 |
| `UA01-provider-execution-stream-unification.md` | **doing / CP4D+CP5+CP6 conversation provider activity verified**：按用户最新决策推进完整 provider execution stream 统一架构。CP0 审计和队首登记已完成；CP1 已新增 `ProviderRun` / `ProviderEvent` / `ProviderOutput` 纯契约；CP2 已让 `Gateway.complete/3` 通过 `Gateway.execute/4` 消费同一 execution stream final Result；CP3 已新增 `NovelAgent.Provider.AdapterExecution`，final-only adapter 也在 adapter execution boundary 物化为同一 ProviderRun/Event/Output；CP4A 已让 `Provider.Execution.complete/2` 把 execution refs 附回 `Provider.Result`；CP4B 已新增 `Provider.Execution.dependency/1` 并迁移 Toolbox / AuthorizedToolExecutor / ToolAdapterRegistry / CreativeToolAdapter / CreativeProvider.Real / ProseQualityEvaluator / TurnExecutionService / ProseRevisionService / AgentRun creative profiles 消费同一 provider execution dependency；CP4C 已迁移 DialogueGateway / Planner / DialoguePlanningService / conversation profile 公开入口到 provider execution dependency；CP4D 已新增 `ProviderActivityProjector`，主对话/正文/角色设计/大纲/角色演化/修订 flow 可把 ProviderRun/Event/Output facts 投影为 author-safe `provider_progress`；CP5 Codex Desktop 式聊天流 UI 已消费该活动；真实 Tauri `agent-provider-execution-stream-unified` 已通过，证明普通 `conversation_turn_v1` 的 provider_started/provider_final_output 可见且携带 provider_run_ref/provider_call_ref；ProviderExecution cancellation 已通过 `agent-provider-cancel-honest-boundary` 真实 Tauri 验收。禁止新增 `complete` 之外的可选 streaming 支路，也禁止用历史 CP6 checkpoint progress 或“不支持则回退旧 complete 体系”的口径声明 streaming 完成。 |
| `UA01-natural-language-steering.md` | **done / verified**：自然语言 steering 已由真实 Tauri `agent-natural-language-steer` 闭环。active AgentRun 期间主输入框文本绑定当前 `run_id` 并提交 `agent_command steer`，不会创建第二个 user turn 或新 run。 |
| `UA01-plot-outline-agent-profile.md` | **done / verified**：正文以外更多创作 Profile 的首个闭环。章节大纲规划进入 `plot_outline_with_context_v1`，由 context observation → next-step planner → `plot_outline` re-gate → artifact observation → completion decision 推进，产物保持 tentative；`agent-plot-outline-with-context` 已通过真实 Tauri。 |
| `UA01-character-evolution-agent-profile.md` | **done / verified**：角色演化创作 Profile 闭环。已有角色状态/关系变化进入 `character_evolution_with_context_v1`，由 context observation → next-step planner → `character_evolution` re-gate → artifact observation → completion decision 推进，产物保持 tentative；`agent-character-evolution-with-context` 已通过真实 Tauri。 |
| `SU04-desktop-sidecar-packaging.md` | **active / 桌面打包承重 slice**：落地 `docs/design/tech-stack/05-desktop.md` 的 Tauri + Mix Release sidecar，让下载的桌面应用自带并自动拉起 Phoenix 后端（修「下载即模型未连接 / 同步离线」）。本机 macOS arm64 真实 `.app` 已验证冷启动 4s 内后端在 4658 服务、退出无孤儿。后续：代码签名+公证（下载双击即开）、Intel Mac、CI tag 真跑通。 |
| `SU01-file-level-closure.md` | **file-level deliverable / second-round C3 closed / B3 P1 follow-up**：SU-01 已按文件级二轮口径重算为 10 个场景：9/10 已验收、1/10 部分实现。2026-06-22 二轮关闭旧 Keychain / non-macOS external blocker：当前产品口径为统一 profile-scoped local file secret，`su01-local-secret-file-roundtrip` 已证明真实 Tauri WebView 保存 fake Key、重启后从 `provider-secrets.json` 恢复 DeepSeek runtime、0600 权限和 UI/日志/偏好脱敏边界；`su01-provider-test-failure-ui` 已证明测试连接失败反馈、草稿保留、无 turn/runtime 副作用和恢复成功。live vendor / 云端供应商真实失败矩阵仍为 B3/P1 后续，Windows/Linux local-file 页面矩阵为 P2 平台回归；当前可进入 SU-02。 |
| `SU02-file-level-closure.md` | **file-level deliverable / P2 follow-up matrix registered**：SU-02 已按文件级闭环口径复核为 13/13 已验收。运行时作品菜单、空库自动未命名作品、快速未命名创建、命名新增、改名、安全移出、leave/join、消息流隔离、慢回复迟到归属、reload 恢复和 artifact/projection/trace 隔离均有真实 Tauri summary 与 quality manifest；后端不可用 UX、恢复/归档管理入口、大列表和异常失败态为 P2 后续；当前可进入 SU-03。 |
| `SU03-file-level-closure.md` | **file-level deliverable / keep regression**：SU-03 已按文件级闭环口径复核为 6/6 已验收。work-scoped AI 显示名、默认名、设置/重置、按作品隔离、canonical role / TurnResult / websocket payload 边界和 LM Studio request body 反证均有当前真实 Tauri / real LM Studio 证据；无 P0/P1 缺口，后续只需随工作台重构保持回归；当前可进入 AU-01。 |
| `AU01-file-level-closure.md` | **file-level deliverable / cross-reference registered**：AU-01 已按文件级闭环口径复核为 13 个场景：普通聊天两轮、空消息 guard、乱码 JSON 友好降级、frame validation 友好错误、TurnResult/recorder/reload UI 同源对账均有当前真实 Tauri / quality acceptance 证据，普通聊天另有 real LM Studio 两轮请求证据；`au07-trace-why-entry` 已回填 D1 当前 turn author-safe why/no-provider/no-write 子证据，`au07-persisted-trace-query` 已回填普通旧 turn scoped query / no-provider replay 子证据，`au07-partial-replay-ui` 已回填 partial replay 诚实提示子证据；P0 已关闭，D1 完整 replay、developer view、多类型 UI 登记为 AU-07 cross-reference，C3 no-slot-form UI 反证为 P2；当前可进入 AU-02。 |
| `AU02-file-level-closure.md` | **file-level deliverable / keep regression**：AU-02 已按文件级闭环口径复核为 12 个场景：自然探索/no-slot-form、候选卡、坏候选 fallback、候选 continuation、多轮候选上下文、候选卡后自由追问、未采纳不入阅读/事实、明确采纳桥接均有当前真实 Tauri / quality acceptance 证据，自然探索另有 real LM Studio 质量证据；D2 schema/codegen 契约已测试；P0/P1 已关闭，剩余高风险/stale/conflict/cross-work 和已采纳投影矩阵归 AU-05/AU-08；当前可进入 AU-03。 |
| `AU03-file-level-closure.md` | **file-level deliverable / P1-P2 follow-up registered**：AU-03 已按文件级闭环口径复核为 20 个场景：13/20 已验收、2/20 已测试、3/20 部分实现、1/20 已实现未验收、0/20 未实现、1/20 不确定。新建会话、历史只读、从历史继续、归档过滤、最新 Work 背景 SSOT、active transcript 分层、开放 behavior context、上下文来源 UI、长会话压缩和跨作品/记忆分层均有当前真实 Tauri 证据，current-work SSOT 另有 real LM Studio 证据；`au11-missing-workstate-policy` 已作为 B1 missing WorkState cross evidence 回填，证明缺章节/正文/人物状态时不编造当前章；`au06-single-active-confirmation` 已作为 A4 dependency evidence 回填，证明第二个 confirmation turn 消费上一轮开放 behavior 的 author-safe context ref；P0 已关闭，完整 empty/work-only/failure UI、显式 archived source、AU-07 replay/trace 和搜索/压缩细化已登记 owner；当前可进入 AU-04。 |
| `AU04-file-level-closure.md` | **file-level deliverable / P1-P2 follow-up registered**：AU-04 已按文件级闭环口径复核为 18 个场景：10/18 已验收、5/18 已测试、3/18 部分实现。高风险确认主链、确认卡说明内容、普通聊天不误触发确认、确认走 `author_action`、取消等待、重复确认幂等、stale/expired/history/cross-work guard、latest-context rebase、pending adoption 和确认后工具失败恢复均有当前真实 Tauri 证据；P0 已关闭，持久 ConfirmationBinding snapshot、trace/replay、LLM timeout/retry、assistant_message truthfulness 和 LongRunner 矩阵已登记 owner；当前可进入 AU-05。 |
| `AU05-file-level-closure.md` | **file-level deliverable / second-round reviewed / P1-P2 follow-up registered**：AU-05 已按文件级闭环口径复核为 18 个场景：15/18 已验收、3/18 部分实现。2026-06-22 二轮已串行复跑 11 个真实 Tauri / quality 入口：候选 adoption boundary、高风险 confirmation、stale rejection、cross-work/canon recovery、artifact accept/discard/edit_then_accept、未采纳/已放弃不进阅读、采纳后 reading projection、StateTrace adoption replay 和设定 recall 均通过；P0 已关闭，persistent adoption inbox、ProjectionHint refresh 状态机、完整 replay/旧 turn 查询、canon/revision store 自动计算和人工合并 UX 已登记 owner；当前可进入 AU-06。 |
| `AU06-file-level-closure.md` | **file-level deliverable / second-round reviewed / P1 follow-up registered**：AU-06 已按文件级闭环口径复核为 17 个场景：13/17 已验收、4/17 部分实现。2026-06-22 二轮已串行复跑 12 个真实 Tauri / quality 入口：高风险 confirmation、确认后工具失败恢复、幂等、stale、single-active、TTL、disabled、history readonly、cross-work、latest-context rebase、cancel waiting 和 AU-07 terminal BehaviorTrace 均通过；P0 已关闭，blocking clarification、confirm terminal history/replay 与持久 BehaviorBinding ledger 已登记 owner；当前可进入 AU-07。 |
| `AU07-file-level-closure.md` | **file-level deliverable / second-round reviewed / old-turn query, partial UI, gate reason why and scope negative matrix closed / P1 follow-up registered**：AU-07 已按文件级闭环口径复核为 16 个场景：13/16 已验收、0/16 已测试、3/16 部分实现。2026-06-22 二轮已串行复跑 3 个 AU-07 本体真实 Tauri / quality 入口，以及 `e2e-01-readonly-tool-trace` / `e2e-01-replay-report` 默认 Tauri 与 real LM Studio cross evidence；随后 `au07-persisted-trace-query` 关闭普通旧 turn 持久 trace scoped query，`au07-partial-replay-ui` 关闭缺 refs 的 persisted partial replay 作者诚实提示，`au07-gate-reason-why` 关闭 `action_scope` 降级 why 面板中文解释，`au07-trace-query-scope-negative-matrix` 关闭跨 work/session/turn 负向 replay 查询矩阵。why 入口、旧 turn scoped query、partial replay UI、gate reason why、scope negative matrix、StateTrace/adoption/projection replay producer、Behavior terminal close/resolution replay producer、summary-level ToolTrace refs 持久回查和 ReplayReport 六问均有当前证据；P0 已关闭，developer 双视图、完整 ToolTrace registry snapshot / redacted I/O、多类型 replay UI 矩阵和 reason catalog 深化已登记 owner；当前可进入 AU-08。 |
| `AU07-gate-reason-why.md` | **checkpoint closed / AU-07 A2 closed**：`action_scope` 降级为什么解释已由 `au07-gate-reason-why` 真实 Tauri / real LM Studio quality acceptance 证明。真实档案入口触发多步 MicroPlan 后 Orchestrator 降级，作者点击消息流“为什么”可见中文 gate/reason、no-provider replay 和 no-write 证据，且无 raw prompt/provider/debug/internal gate code 泄漏。 |
| `AU07-partial-replay-ui.md` | **checkpoint closed / AU-07 C2 closed**：旧 turn partial replay 作者诚实提示已由 `au07-partial-replay-ui` 真实 Tauri / quality acceptance 证明。外部 harness 在同一 work/session/turn scope 插入缺 `turn_result_ref` / `tool_trace_refs` 的不完整 trace，真实工作台 reload 后从旧消息“为什么”入口触发产品 API，UI 显示 partial warning、missing refs 和 no-provider 文案，且 no-provider/no-tool/no-write/no raw leak。 |
| `AU07-trace-query-scope-negative-matrix.md` | **checkpoint closed / AU-07 E3 closed**：trace 查询跨作品/会话负向矩阵已由 `au07-trace-query-scope-negative-matrix` 真实 Tauri / quality acceptance 证明。真实工作台建立普通 turn 并 reload 恢复旧消息后，原 work/session/turn replay 返回 200；foreign work/source session、source work/foreign session、same-work other session/source turn、missing turn 均 404，负向响应不含 trace_summary / replay_report，错误不进 UI，且 no-provider/no-tool/no-write。 |
| `AU08-file-level-closure.md` | **file-level deliverable / second-round reviewed / B4 return-context and D1 no-write closed / P1 follow-up registered**：AU-08 已按文件级闭环口径复核为 16 个场景：12/16 已验收、2/16 已实现未验收、2/16 部分实现。2026-06-22 二轮已串行复跑 `p1-chapter-adoption-reading`、`p1-chapter-edit-then-accept`、`p1-word-count-audit`、`p1-chapter-expansion-multichapter`、`p1-export-minimum`、`p1-chapter-draft-generation`、`au02-unadopted-candidate-no-reading-fact`、`su02-artifact-projection-trace-isolation`；并关闭 `p1-chapter-draft-generation` 旧文案等待导致的 cross-reference driver 漂移。新增 `au08-reading-readonly-no-write` 证明阅读模式查看/导出/返回期间 no `author_action`、no `user_message`、no adoption/tool/write，返回后工作台输入/发送可用；新增 `au08-reading-return-context` 证明返回工作台后 follow-up 保持同一 `work_id` / `session_id` 且返回动作 no `author_action` / no `user_message`。采纳正文、编辑后采纳、未采纳不入阅读、跨作品隔离、多章导航、空章诚实显示、短章 audit、导出、STALE banner、D1 no-write 和 B4 return-context 均有当前真实 Tauri / quality 入口；P0 已关闭，projection refresh 专用 action/no-write driver、REBUILDING/FAILED 状态来源和离线降级登记为 P1；当前可进入 AU-09。 |
| `AU08-reading-return-context.md` | **checkpoint closed / AU-08 B4 closed**：阅读返回工作台后保持同一 work/session 上下文已由 `au08-reading-return-context` 真实 Tauri / quality acceptance 证明。外部 driver 从真实工作台生成并采纳正文、进入阅读模式、点击真实“返回工作台”后发送 follow-up，verifier 断言返回动作 no `author_action` / no `user_message`，follow-up websocket 与 turn_result 保持同一 `work_id` / `session_id`。 |
| `AU07-trace-replay-integrity.md` | **checkpoint closed / AU-07 file-level closed**：`au07-trace-why-entry` 已重新挂回当前 Tauri / quality 入口并通过复跑；`ReplayService` 已支持 Tool / Behavior / State replay refs 与 missing refs partial，`decision_traces` 已持久化 replay refs。 |
| `AU07-state-trace-adoption-replay.md` | **checkpoint closed / AU-07 file-level closed**：StateTrace / adoption / projection replay P0 已关闭。真实工作台“保存为章节正文”后的 action turn、采纳 resolved entry 与 reading projection 共用可回放 `state_trace_ref`，已由 `au07-state-trace-adoption-replay` Tauri/quality 入口证明。 |
| `AU07-behavior-trace-terminal-replay.md` | **checkpoint closed / AU-07 file-level closed**：Behavior terminal replay P0 已关闭。真实工作台 cancel waiting 后的 cancelled action turn 记录 terminal `behavior_trace_refs` close/resolution refs，并由 `au07-behavior-trace-terminal-replay` Tauri/quality 入口证明。 |
| `AU09-file-level-closure.md` | **file-level deliverable / second-round reviewed / A1 stats driver and B2 filter matrix closed / P1-P2 follow-up registered**：AU-09 已按文件级闭环口径复核为 14 个场景：12/14 已验收、2/14 部分实现。2026-06-22 二轮已串行复跑 10 个当前 Tauri / quality 入口，覆盖记忆创建确认召回、档案概览 stats/detail current driver、管理入口、管理页可见筛选矩阵、生命周期终态排除、trace、伏笔/规则 adoption、角色主档案、有效期窗口、跨作品隔离和 AU-03 会话/记忆分层；普通旧 turn scoped query 与 partial replay UI 已由 AU-07 回填；P0 已关闭，`au09-memory-management-filter-matrix` 已关闭 SC-AU09-B2 可见筛选矩阵 P1，`au09-archive-stats-current` 已关闭 SC-AU09-A1 stats/detail current driver P1，pending inbox、developer replay、多类型 replay UI、Channel 管理入口和完整 MemoryTrace/StateTrace 登记为 P1，排序/分页/limit UI 深化登记为 P2；当前可进入 AU-10。 |
| `AU09-character-role-taxonomy-protagonist-policy.md` | **CP1 闭环 / feedback 9,12,13**：角色类型和“主角”语义规范化。主角 = Character 结构化叙事角色 `narrative_role`（枚举，支持群像）；无主角诚实报缺口、不默认第一个、只读 no-write；“设计主角”经采纳边界写 PROTAGONIST，档案显示“主角”标签，再问主角可校验回答。真实 Tauri 验收通过（`au09-character-role-taxonomy-protagonist-policy`）。 |
| `AU09-character-candidate-per-item-adoption.md` | **闭环 / feedback 10**：角色设计返回多个候选时每个候选有独立 `artifact_id` + 独立待采纳动作（`TentativeArtifactSet.adoptable_units/1` 分解，仅 character_seed 多候选拆分）；采纳一个只写对应 Character，其它候选保持 pending 但不进入已确认角色/记忆/上下文。采纳契约零改动。真实 Tauri 验收通过（`au09-character-candidate-per-item-adoption`）。 |
| `AU09-memory-taxonomy-write-policy.md` | **CP1 闭环 / feedback 16,17**：`06 §4.5` 冻结记忆写入治理契约。角色主体（character_seed）归 Character 主档案不写记忆；新增 `character_evolution` 能力/`character_evolution_seed`，采纳写角色记忆（CHARACTER_PROFILE/CURRENT_STATE/RELATIONSHIP）；只读/失败/未采纳不写、终态/窗口外不召回。真实 Tauri 验收通过（`au09-memory-taxonomy-write-policy`）。 |
| `AU09-memory-list-ux-redesign.md` | **闭环 / feedback 14**：记忆页列表改用全局浅色 token（原深色 off-theme）；状态/类型/范围中文标签 + 语义状态徽标（颜色服务真实状态）+ 召回列 + 终态行降权；文案集中 copy.ts。真实 Tauri 截图验收通过（`au09-memory-list-ux-redesign`）。 |
| `AU10-file-level-closure.md` | **file-level deliverable / second-round reviewed / P1-P2 follow-up registered**：AU-10 已按文件级口径对账为 17 个场景：14/17 已验收、1/17 已测试、2/17 部分实现。2026-06-22 二轮已串行复跑 6 个当前 Tauri / quality 入口：baseline matrix、真实导出 task_state、provider 不可达、provider timeout、WebSocket reconnect 和 cancel waiting 均通过；P0 已关闭，未发现本文件内应关闭的新 P1/P0，剩余完整异步 LongRunner、FAILED task_state 真实页面、全 card/action 深矩阵、projection/trace 深链路和验收卫生登记为 P1/P2；当前可进入 AU-11。 |
| `AU11-file-level-closure.md` | **file-level deliverable / second-round reviewed / P1 follow-up registered**：AU-11 已按文件级口径对账为 4 个场景：2/4 已验收、2/4 部分实现。2026-06-22 二轮已串行复跑 `au11-quality-diagnosis-message-envelope` 与 `au11-missing-workstate-policy` 两个真实 Tauri / quality 入口，覆盖 VS-00D 质量诊断三层 envelope、缺上下文 WorkState missing、why 可见、不编造和 no tool/adoption/write；P0 已关闭，未发现本文件内应关闭的新 P1/P0，剩余 P1 是 `guidance_mode` schema 冻结、clarify/confirm 引导 proof、prose_writing envelope 投影；当前可进入 AU-12。 |
| `AU12-file-level-closure.md` | **file-level deliverable / second-round P1 closed**：AU-12 已按文件级口径对账为 11 个场景：10/11 已验收、1/11 已测试。2026-06-22 二轮已串行复跑 `au12-work-profile-overview` 与 `au12-work-profile-status-isolation`，并新增 `au12-correction-intent-roundtrip`、`au12-profile-read-failure-degrade` 真实 Tauri / quality 入口，覆盖作品档案概览、accepted/tentative 状态、空字段、读取失败诚实降级、tab 导航、跨作品隔离、no-write、UUID 脱敏，以及从档案发起立项修订意图回到对话主链并产生 pending `world_setting` 的采纳边界；P0/P1 已关闭，A2 prompt 同源为实现/测试约束且同轮 provider prompt proof 为 P2 加强项，accepted `world_setting` 是否物化 works 字段为 P2 contract；当前可进入 E2E-01。 |
| `AU12-archive-concurrent-model-run-read-snapshot.md` | **闭环 / feedback 11**：模型执行期间打开作品档案不空白。StructurePanel 常驻挂载保留快照 + 仅 workId 变才重置 + loading/error 诚实状态条 + 读失败保留上次内容；执行期间打开档案显示立项快照（非空白）+诚实加载，只读 no-write，turn 完成后刷新。真实 Tauri 验收通过（`au12-archive-concurrent-model-run-read-snapshot`）。已知边界：channel 串行下实时并发读取归后端异步化后续。 |
| `AU12-correction-intent-roundtrip.md` | **checkpoint closed / AU-12 C2 closed**：作品档案「提出立项修订」入口已由 `au12-correction-intent-roundtrip` 真实 Tauri / quality acceptance 证明。外部 driver 从真实档案概览点击可见按钮，发送 `generate_micro_plan=true` 的 user_message，Planner/MicroPlan/Orchestrator 允许 `world_building`，产生 pending `world_setting` 和保存/修改/放弃动作，作者选择前 no `author_action` / no adoption evaluation / no production write。 |
| `AU12-profile-read-failure-degrade.md` | **checkpoint closed / AU-12 B3 P1 closed**：作品档案读取失败诚实降级已由 `au12-profile-read-failure-degrade` 真实 Tauri / quality acceptance 证明。外部 driver 停止 slice Phoenix 服务后打开真实档案概览，UI 显示读取失败与重试，不显示 `状态未明` 或空字段行；服务恢复后点击「重试读取」读回真实 works 立项字段，全程 no `user_message` / no `author_action` / no adoption / no tool / no write。 |
| `E2E01-file-level-closure.md` | **file-level deliverable / second-round reviewed / P0-P2 closed, E10 cross-reference registered**：E2E-01 已按真实证据更新为 12/13 已验收、1/13 已测试、0/13 部分实现。2026-06-22 已串行复跑 `e2e-01-downgrade-real-page`、`e2e-01-readonly-tool-trace`、`e2e-01-replay-report` 三个真实 Tauri / LM Studio 入口和 `e2e-01-full-chain` 聚合 runner，并新增 `e2e-01-channel-action-security` 真实 Tauri 页面锚定外部协议 fuzz；E8/E13 invented/forged source 恶意 payload P2 已关闭。E10 普通旧 turn / developer / 多类型 trace query UI 归 AU-07 cross-reference owner；本轮满足退出标准。 |
| `AU12-work-profile-status-isolation.md` | **checkpoint closed / AU-12 file-level closed**：AU-12 文件级 checkpoint，补作品档案 accepted/tentative 状态可辨、空字段诚实显示、跨作品概览/角色/伏笔/规则隔离和只读 no-write 的真实 Tauri 矩阵。 |
| `SU01-lmstudio-disconnected-health.md` | **checkpoint closed**：`SC-SU01-A3` LM Studio 未启动/不可达时的真实工作台断开态已由 `su01-lmstudio-disconnected-health` 证明。SU-01 二轮当前只保留 B3 live vendor / 云端供应商真实失败矩阵为 P1 后续，平台 local-file 页面矩阵为 P2 回归。 |
| `SU01-provider-endpoint-validation.md` | **checkpoint closed**：`SC-SU01-B3` endpoint URL 校验 checkpoint。非法 endpoint 在真实模型设置 Dialog 中可见报错，刷新模型、测试连接、保存切换被阻断，且不触发 provider models 请求；供应商模型列表成功管线已由 `SU01-provider-model-list-success.md` 补齐，B3 剩余是 live vendor / 云端真实失败矩阵。 |
| `SU01-provider-model-list-success.md` | **checkpoint closed**：`SC-SU01-B3` 供应商实时模型列表成功矩阵最小闭环。真实工作台模型设置 Dialog 可分别从 DeepSeek、Anthropic、LM Studio provider models boundary 加载并选择模型；live vendor 账号/额度/真实云端失败矩阵仍为 B3/P1 后续，不用 harnessed HTTP 证据冒充关闭。 |
| `SU01-provider-vendor-matrix-openai-minimax-zhipu-kimi-gemini.md` | **CP1 闭环 / feedback 15**：新增 `OpenAICompatible` 共享基类 + 6 个 vendor adapter（OpenAI〔API Key/订阅〕、Minimax、智谱、Kimi、Gemini），Gateway 注册，OpenAI 两认证方式以独立 vendor id 区分；前端从后端 registry 自动渲染、Rust secret 白名单扩展到 10 id。真实页面 `su01-provider-vendor-matrix` 证明新供应商后端可列、订阅 hint、fake key 脱敏、test-fail 不切换 runtime/不建 turn、两认证方式独立。live vendor 云端失败矩阵 + 订阅 OAuth 登录传输为登记后续缺口（SC-SU01-B3 P1，需真实账号，不冒充）。 |
| `SU01-api-key-secret-redaction.md` | **checkpoint closed**：`SC-SU01-B2/C3` API Key 配置流脱敏 checkpoint。真实工作台输入 fake Key 后，provider options、browser fallback settings、可见 UI、业务 JSONL 和 backend log 均不泄漏 secret；当前 C3 已由 `su01-local-secret-file-roundtrip` 取代旧 Keychain 机制并闭环，平台 local-file 页面矩阵降为 P2 回归。 |
| `SU03-assistant-display-name-boundary.md` | **checkpoint closed**：补 SU-03 `SC-SU03-C2` 行为边界证据。真实工作台改名后发送普通消息，默认 Tauri 验证 wire/TurnResult 契约，`--real-lmstudio` 验证 provider request body 不含 UI 显示名。 |
| `SU02-work-lifecycle-management.md` | **checkpoint closed**：`SC-SU02-B3/B4/B5` 作品级命名新增、修改作品名、安全删除或移出已由 `su02-work-lifecycle-management` 真实 Tauri 验收证明。SU-02 后续缺口已收敛为 P2 管理/异常矩阵。 |
| `SU02-work-restart-recovery.md` | **checkpoint closed**：`SC-SU02-D1/D2` 作品重启恢复与 stale lastOpened 降级已由 `su02-work-restart-recovery` 真实 Tauri 验收证明；reload 后恢复真实 lastOpened，已移出作品不会作为当前 work 恢复。 |
| `SU02-empty-start-unnamed-work.md` | **checkpoint closed**：`SC-SU02-B2` 空工作区自动启动未命名作品已由 `su02-empty-start-unnamed-work` 真实 Tauri 验收证明。空库启动通过幂等 ensure initial 创建单个真实“未命名作品”，普通消息和重命名保持同一 Work，多个未命名作品在作品菜单里可见区分。 |
| `SU02-artifact-projection-trace-isolation.md` | **checkpoint closed**：`SC-SU02-C3` 剩余 artifact / projection / trace 隔离矩阵已由 `su02-artifact-projection-trace-isolation` 真实 Tauri 验收证明。源作品 pending prose artifact 不泄漏到目标作品，源作品采纳后 reading projection 只在源作品有内容，目标 why/trace 不带源作品 artifact/chapter 上下文；SU-02 当前 13/13 已验收，可进入 SU-03。 |
| `SU02-pending-result-work-isolation.md` | **checkpoint closed**：`SC-SU02-C4` 慢回复迟到归属已由 `su02-pending-result-work-isolation` 真实 Tauri 验收证明。作品 A 慢回复完成在原 `work_id`，作品 B 不显示 A 文本且不残留 loading，切回 A 可恢复完成 turn。 |
| `AU01-ordinary-chat-two-turn-roundtrip.md` | **checkpoint closed**：AU-01 普通聊天两轮真实工作台闭环。外部 Tauri driver 从真实输入框发送两轮自然创作聊天，证明 user/assistant 可见顺序、thinking 清退、`generate_micro_plan=false`、无 MicroPlan、无 action/candidate/adoption UI；`--real-lmstudio` 证明真实 provider 两轮 form_frame 请求。AU-01 D1 当前 turn why/no-provider 子证据已由 `au07-trace-why-entry` 回填，普通旧 turn scoped query 子证据已由 `au07-persisted-trace-query` 回填，partial replay 诚实提示已由 `au07-partial-replay-ui` 回填；全量仍缺完整 replay/developer/多类型 UI 和 C3 no-slot-form UI 反证。 |
| `AU01-empty-message-guard.md` | **checkpoint closed**：SC-AU01-B3 空消息不会创建聊天 turn。外部 Tauri driver 从真实输入框发送空白内容，证明无 `user_message` frame、DOM 消息数不变、thinking 不出现且输入仍可用；随后有效普通聊天完成，说明恢复路径未断。AU-01 D1 当前 turn why/no-provider 子证据已由 `au07-trace-why-entry` 回填，普通旧 turn scoped query 子证据已由 `au07-persisted-trace-query` 回填，partial replay 诚实提示已由 `au07-partial-replay-ui` 回填；全量仍缺完整 replay/developer/多类型 UI 和 C3 no-slot-form UI 反证。 |
| `AU01-garbage-json-recovery.md` | **checkpoint closed**：SC-AU01-E2 LLM 乱码 JSON 友好降级。外部 Tauri driver 从真实输入框触发 test/support provider 返回 malformed frame JSON，验证页面显示友好 fallback、raw payload 不可见、输入/Channel 可恢复，并继续完成一轮普通聊天。AU-01 D1 当前 turn why/no-provider 子证据已由 `au07-trace-why-entry` 回填，普通旧 turn scoped query 子证据已由 `au07-persisted-trace-query` 回填，partial replay 诚实提示已由 `au07-partial-replay-ui` 回填；全量仍缺完整 replay/developer/多类型 UI 和 C3 no-slot-form UI 反证。 |
| `AU01-frame-validation-friendly-error.md` | **checkpoint closed**：SC-AU01-E3 frame 校验失败作者友好提示。真实工作台触发 test/support provider 返回带禁止执行语义的 frame，验证 Channel fallback 不把内部 validation reason 放进 UI 或 turn_result，并能继续普通聊天。AU-01 D1 当前 turn why/no-provider 子证据已由 `au07-trace-why-entry` 回填，普通旧 turn scoped query 子证据已由 `au07-persisted-trace-query` 回填，partial replay 诚实提示已由 `au07-partial-replay-ui` 回填；全量仍缺完整 replay/developer/多类型 UI 和 C3 no-slot-form UI 反证。 |
| `AU01-turnresult-recorder-ui-consistency.md` | **checkpoint closed**：SC-AU01-B4 TurnResult、interaction recorder 和恢复 UI 同源对账。真实工作台发送普通聊天后，按同一 `turn_id` 证明 websocket `turn_result.assistant_message.text`、transcript assistant row、transcript 内嵌 turn_result 和 reload 后 UI 文本一致；AU-01 D1 当前 turn why/no-provider 子证据已由 `au07-trace-why-entry` 回填，普通旧 turn scoped query 子证据已由 `au07-persisted-trace-query` 回填，partial replay 诚实提示已由 `au07-partial-replay-ui` 回填，剩余 P1 为 AU-07 owner 的完整 replay/developer/多类型 UI，P2 为 C3 no-slot-form UI 反证。 |
| `AU02-candidate-adoption-bridge.md` | **checkpoint closed**：候选方向 continuation/adoption 边界已拆成两条真实 Tauri 证据。`au02-candidate-continuation` 证明“继续讨论”发送 `user_message.candidate_selection` 且不进入 adoption；`au02-candidate-adoption-bridge` 证明“设为后续方向”提交服务端授权 `author_action.choose_candidate` 并进入 `AdoptionBoundary`。AU-02 之后已由 `AU02-candidate-fallback-ui.md` 关闭 fallback UI 反证，由 `AU02-candidate-multiturn-context.md` 关闭多轮上下文质量反证，由 `AU02-natural-exploration-no-slot-form.md` 的 real LMStudio provider 变体关闭中文探索质量反证，并由 `AU02-candidate-schema-codegen.md` 关闭 D2 schema/codegen 回归。 |
| `AU02-natural-exploration-no-slot-form.md` | **checkpoint closed**：补 AU-02 模糊创意自然探索与 no-slot-form 真实 Tauri 证据。真实工作台发送模糊创意，验证 creative_exploration frame、自然回复、候选卡、无 slot form / MicroPlan / execution / adoption / write；`--real-lmstudio` 变体验证中文自然回复、无 JSON/代码块形态和候选语义相关。 |
| `AU02-candidate-fallback-ui.md` | **checkpoint closed**：补 AU-02 `SC-AU02-B3` 候选缺失/坏格式 fallback 的真实 Tauri UI 反证。test/support provider 返回坏候选 payload，真实工作台渲染 Planner fallback 候选卡，字段非空、`not_adopted`、无 action/adoption/write。 |
| `AU02-candidate-multiturn-context.md` | **checkpoint closed**：补 AU-02 `SC-AU02-C1` 候选继续讨论后的多轮上下文保持。真实 Tauri / quality acceptance 已证明点击“继续讨论”后，后续普通追问能通过会话上下文沿着已选候选方向继续，且无 action/adoption/write。 |
| `AU02-candidate-schema-codegen.md` | **checkpoint closed**：补 AU-02 `SC-AU02-D2` 候选方向 schema/codegen 统一回归。`candidate_direction.json` 固化 `direction_id/title/pitch/tone_tags/adoption_status=not_adopted`，前端 generated schema/type 被 `WorkspaceChat` 与契约测试消费，旧 fixture `"candidate"` 已修为 canonical `not_adopted`。 |
| `AU02-freeform-followup-after-candidate.md` | **checkpoint closed**：补 AU-02 候选卡出现后作者直接手输自由追问的反证。真实 Tauri 证明不点击候选按钮时，下一轮是无 `candidate_selection` 的普通 `user_message`，不提交 `author_action`、不进入 adoption boundary、不写作品事实。 |
| `AU02-unadopted-candidate-no-reading-fact.md` | **checkpoint closed**：补 AU-02 未采纳候选不进入阅读模式 / 作品事实的真实 Tauri 反证。生成候选卡后不点击候选动作，打开阅读模式，验证空 TOC、候选标题/简介不可见、无 action/adoption/projection/write。 |
| `AU03-session-history-readonly.md` | **checkpoint closed**：SC-AU03-C4 历史会话只读回看已由 `au03-session-history-readonly` 真实 Tauri 验收证明。真实工作台搜索历史会话、打开 exited transcript、确认旧 pending adoption 不恢复、输入/发送禁用，并可返回当前 active session；后续 `AU03-current-work-archive-evidence-entry.md` 已补归档过滤和最新 Work 背景 SSOT。 |
| `AU03-session-new-active.md` | **checkpoint closed**：SC-AU03-C2 新建作品内会话入口已由 `au03-session-new-active` 真实 Tauri 验收证明。真实工作台点击“新建会话”后创建新 active session、旧 active 变 `EXITED` 且可只读打开、新 active 以空 transcript rejoin，下一轮消息绑定新 session 且不带旧 transcript；后续 `AU03-current-work-archive-evidence-entry.md` 已补归档过滤和最新 Work 背景 SSOT。 |
| `AU03-branch-from-history.md` | **checkpoint closed**：SC-AU03-C6 从历史会话继续创建新 active session 已由 `au03-branch-from-history` 真实 Tauri 验收证明。产品入口记录 `source_session_ref` / `source_turn_ref`，旧历史保持只读，新分支 session 为空 transcript 且不复制旧历史内容。 |
| `AU03-current-work-archive-evidence-entry.md` | **checkpoint closed**：AU-03 文件级证据入口修复已闭环。`au03-current-work-context-ssot` 与 `au03-archive-session-filter` 已重新挂回 `tauri_slice_verify.sh`、外部 UI driver 和 quality manifest；真实 Tauri/quality acceptance 证明最新 Work 背景 SSOT、active transcript 分层、历史 transcript 不污染当前 prompt、归档默认隐藏且可显式搜索回看。`task_done` 已生成 manifest；静态扫描 0 touched-file finding，唯一 Top 10 为既有 gitleaks accepted_risk。 |
| `AU04-AU06-author-action-binding.md` | **doing / AU-04 and AU-06 file-level P0 closed, replay/clarification follow-up continues**：`au04-confirm-before-execute` 已证明真实工作台高风险重写先 `needs_confirmation`，确认卡说明确认对象、确认前无工具/无写入、确认后重新 gate，点击“确认执行”走服务端 `author_action` 并只产出待采纳草稿；`au04-confirm-idempotency-ui` 已证明真实快速重复确认只产生 1 次非 duplicate receipt、1 次工具 dispatch 和 1 份 pending artifact；`au04-stale-confirmation-ui` 已证明 follow-up 推进当前 turn 后旧确认被 stale 拒绝且 no-tool/no-draft；`au04-confirmation-ttl-ui` 已证明 expired confirmation 被服务端拒绝且 no-tool/no-draft；`au04-disabled-confirmation-action-ui` 已证明 disabled confirm 可见但不可提交且 no-author-action/no-tool/no-draft；`au04-history-confirmation-readonly` 已证明历史只读 confirmation 不可执行且 no-action/no-tool/no-draft；`au04-cross-work-confirmation-guard` 已证明源作品 confirmation 切到目标作品后不可见、不可执行且 no-action/no-tool/no-draft，切回源作品后恢复；`au04-latest-context-rebase-confirmation` 已证明确认前通过真实作品菜单改名后，binding/trace 消费最新 Work revision/title；`au04-confirmation-tool-failure-recovery` 已证明确认后工具失败显示失败且 no-draft/no-write；`au06-single-active-confirmation` 已证明同一 workstream 旧 confirmation 不可执行且最新 confirmation 执行一次；`au07-behavior-trace-terminal-replay` 已证明 cancel waiting 后的 cancelled action turn 记录 terminal BehaviorTrace close/resolution refs。`ActionValidator` 已要求 `behavior_ref` / `target_ref` / `candidate_*` / `idempotency_key` 与服务端 action 精确一致，并消费 `available_action.expires_at`；`ConfirmationBinding` 已强制 `rebased_state_snapshot_ref` / `gate_result_refs` 并在 confirmation ack / reason_codes 留下 proof。AU-04/AU-06 文件级 P0 已关闭；持久 state snapshot、confirm replay、LLM timeout/retry action、blocking clarification 和完整 behavior history 仍未闭环。 |
| `AU10-workbench-recovery-taskstate.md` | AU-10 recovery 已闭环 checkpoint：真实工作台“导出全书”的 task_state 生命周期可见性；下一队首见 `tasks/NEXT.md`。 |
| `AU10-workbench-recovery-disconnect-timeout.md` | **CP1~CP3B checkpoint closed**：provider 不可用、WebSocket service reconnect、取消等待与真实 provider timeout 均已有真实工作台 Tauri 证据；完整异步 LongRunner streaming 和 stale/disabled/idempotency UI 仍待后续。证据见 `tasks/NEXT.md` 和对应 `artifacts/slice-verify/au10-workbench-recovery-*-tauri/summary.json`。 |
| `AU12-work-profile-overview.md` | **AU-12 首个切面（checkpoint closed）**：补设计 43 §5① 缺失的「作品档案立项概览」只读视图。用户 2026-06-17 调整队列先做 AU12，CP1 已由 `artifacts/slice-verify/au12-work-profile-overview-tauri/summary.json` 证明真实工作台可核对 works 立项字段且不泄漏内部 Work UUID；下一队首见 `tasks/NEXT.md`。验收锚点 `docs/design/acceptance/author/AU-12-work-profile.md`。 |
| `AU09-character-dossier-roundtrip.md` | **CP1 done**：作品档案各 tab「数据展示+操作」端到端可用的第一个样板。已打通角色主档案断链——`character_seed` 采纳回写 `Character` 表（设计 21 §7.2 主档案层，**不写记忆**）+ AI 引导的上下文感知 schema 化角色设计（专用 capability 非独立 Agent）+ 角色 tab 展示 + 上下文读取。证据：`artifacts/slice-verify/au09-character-dossier-roundtrip-tauri/summary.json`；CP2 待做字段级结构化、关系对象和角色演化 memory。 |
| `AU09-archive-stats-current.md` | **checkpoint closed**：AU-09 A1 作品档案概览 stats/detail current-runnable driver 已闭环。真实 Tauri 工作台选择 seeded work、打开档案概览/伏笔详情/经验规则 tab，证明 `get_work_stats/get_characters/get_foreshadowing/get_rules` 与 UI 统计同属当前 `work_id`，并排除 foreign/non-recallable 对照项。证据：`artifacts/slice-verify/au09-archive-stats-current-tauri/summary.json`。 |
| `AU10-action-idempotency-stale-disabled.md` | **CP1 部分闭环**：AU10-GAP-03(P0)。后端 stale/invented/disabled + idempotency 去重早已实现且 channel/单测覆盖；本 slice 补前端 duplicate 可见反馈（commit `2724653`）。双击/旧按钮 stale 的外部真实页面验收因 UI 竞态 + 内部状态依赖判定为非确定性，按 Option A 不纳入 harness（slice §7 已落账）。 |
| `AU09-archive-memory-roundtrip.md` | **CP2 checkpoint closed**：作品档案伏笔/规则入口已能通过 `world_building -> foreshadowing_seed / *_rule_seed -> adoption` 写入 governed memory，并按语义进入伏笔/规则 tab 的 read model；`au09-adopt-setting-recall` 已证明真实页面 adoption、伏笔/规则 tab 重开可见、recall/why。不能标完整 AU09 done，因 replay 和完整 trace 仍待补。 |
| `AU09-memory-management-workbench-entry.md` | **checkpoint closed**：正式工作台记忆管理入口、创建、确认、锁定、废弃、归档与 recall/why 基础生命周期已由 `au09-memory-management-entry` 真实 Tauri 验收证明。 |
| `AU09-memory-trace-roundtrip.md` | **checkpoint closed**：记忆 lifecycle/reference 追溯已由 `au09-memory-trace-roundtrip` 证明；locked terminal 后端阻止和 blocked trace 有局部测试，真实页面可见“引用与治理追溯”。 |
| `AU09-validity-window-recall.md` | **checkpoint closed**：章节级 `valid_from` / `valid_until` 已参与普通召回，`au09-validity-window-recall` 证明窗口外记忆不进入 context/why。 |
| `AU09-cross-work-memory-isolation.md` | **checkpoint closed**：跨作品记忆隔离已由 `au09-cross-work-memory-isolation` 证明。真实工作台从作品 A 切到作品 B 后，记忆管理页、作品档案伏笔/规则、ordinary recall 和 why 只消费当前 Work 的 memory。 |
| `AU09-AU03-session-memory-layering.md` | **checkpoint closed**：同一作品内 active session、historical session、current work memory 在 context/why 中分层且不互相伪装，已由 `au09-au03-session-memory-layering` 真实 Tauri 证据证明。 |
| `AU11-quality-diagnosis-message-envelope.md` | **checkpoint closed**：SC-AU11-01 质量诊断引导已把 VS-00D 三层 message / AIMessageEnvelope 从 docs-ready 推进到真实工作台 trace proof；AU11 整体仍有缺上下文真实验收、clarify/confirm guidance_mode、prose_writing envelope 投影缺口。 |
| `AU11-missing-workstate-policy.md` | **checkpoint closed / AU-11 file-level closed**：SC-AU11-02 缺当前作品上下文不编造已由 `au11-missing-workstate-policy` 真实 Tauri / quality acceptance 证明。真实工作台创建无章节/正文/人物状态的 work 后，输入“帮我看看这一章哪里不成立”，trace/why 显式记录 chapter/prose/character missing，assistant 要求补材料且 no tool/adoption/write。 |
| `AU11-creative-partner-conversational-voice.md` | **设计（backlog，未开工）/ NEXT Order 60**：trivial/模糊输入（如「测试」）的对话回应偏系统诊断腔（「系统运行正常」），偏离愿景 `00` §2/§2.2「作者面对可感知的创作伙伴」。提示词/persona 层（`planner.ex` `form_frame` system_prompt 增补创作伙伴口吻约束），只改 `assistant_message` 语气，不改路由/AgentRun 主链/UI 阶段流/写入边界。分析性验收（非 0/1 不变量，参 memory `prose-ai-taste-findings`）；地板模型下收益有限，待排期。 |

旧 `VS-001..018` 与旧 `DAG.md` 已删除；它们引用的 phase roadmap、旧 ADR 和 Router-first 语义不再作为有效执行事实。

## 最小结构

每个 slice 文件至少包含：

```md
# <Slice Name>

- 状态：todo / doing / done / blocked / deferred
- 类型：Turn Slice / Behavior Slice / Artifact Slice / Projection Slice / Memory Slice / UI Contract Slice / Acceptance Slice
- 启动日期：YYYY-MM-DD

## 1. 用户 / 系统目标

本 slice 要打实什么长期承重能力。

## 2. 开工检查

- Contract:
- Invariant:
- Boundary:
- Consumer:
- Proof:
- Acceptance Driver:

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | |
| novel_domain | no | |
| novel_agent | no | |
| novel_application | no | |
| novel_persistence | no | |
| novel_web | no | |
| frontend | no | |
| docs/design | no | |
| quality | no | |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | | todo | |

## 5. 验证

- [ ] 外部自动化驱动真实页面的场景化验收
- [ ] 后端 / Channel / 组件局部验证
- [ ] `bash scripts/quality_manifest_check.sh`
- [ ] `bash scripts/check_design_trace.sh`（如果涉及 frontend）

## 6. 决策日志

- YYYY-MM-DD — ...

## 7. 试行反馈

记录本 slice 暴露出的规则缺口、过重流程或需要脚本化的检查。
```

## 试行原则

- slice 文件不是表格填空；它必须帮助接手者理解链路。
- 如果 Contract / Invariant / Boundary / Consumer / Proof / Acceptance Driver 写不出来，优先缩小或重切 slice。
- 不为了满足结构而制造未来抽象。
- 试行期允许更新本 README 和 `docs/engineering/vertical-slice.md`，但要在 slice 决策日志里说明原因。
