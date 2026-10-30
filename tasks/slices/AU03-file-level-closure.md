# AU03 File-Level Closure

- 状态：file-level deliverable / P1-P2 follow-up registered
- 类型：Author Acceptance File Closure
- 验收文件：`docs/design/acceptance/author/AU-03-context.md`
- 当前结论：20 个场景中 13 个已有真实页面外部自动化证据，2 个已测试，3 个部分实现，1 个已实现未验收，0 个未实现，1 个不确定；P0 已关闭，当前可进入 AU-04。
- 最近复核：2026-06-22

## 1. 文件级目标

AU-03 验收作者对“AI 了解我的作品”的基础信任：AI 必须消费当前作品的最新背景、当前 active session transcript、已确认记忆和可解释 context source；历史会话可以搜索、只读回看、归档和从历史继续，但不能把旧 transcript、旧 pending/action/loading 或归档内容默认伪装成当前上下文。

本文件是 AU-03 的文件级收口记录，补齐从验收文档、实现入口、quality manifest、真实 Tauri driver 到剩余 P1/P2 owner 的对账链路。

2026-06-22 二轮复核：按剩余 P1/P2、external blocker 与 cross-reference 逐项复核第一轮登记项，不回退 file-level deliverable。当前 8 个默认 Tauri quality 入口和 `au03-current-work-context-ssot --provider lmstudio` 已串行复跑通过；后续依赖复核确认 `au11-missing-workstate-policy` 可作为 `SC-AU03-B1` missing WorkState 子证据，但不能替代完整 empty/work-only/failure 矩阵。

2026-06-22 依赖 checkpoint：`SC-AU03-A4 当前开放行为` 依赖 AU-04/AU-06 confirmation lifecycle 先产生真实 open behavior。当前 `WorkspaceContext` 已从最新 assistant TurnResult 的 `behavior_state.active` 生成 author-safe `behavior_summary`，`DialogueContext.to_prompt_text/1` 写入“当前待处理动作”，`workspace_context_test.exs` 覆盖 latest active / latest cleared / archived session guard，`context_grounding_test.exs` 覆盖 prompt 和 context refs，`au06-single-active-confirmation` 真实 Tauri / quality driver 证明第二个 high-risk confirmation turn 消费上一轮 behavior context ref 且不泄漏 behavior/action id。A4 本轮关闭；显式 archived/source、replay/developer trace、完整 empty/work-only/failure UI/LLM 矩阵仍保留 owner 或后续 checkpoint。

## 2. 开工检查

- Contract：`docs/design/acceptance/author/AU-03-context.md`；`docs/design/acceptance/author/AU-04-execute-and-confirm.md`；`docs/design/acceptance/author/AU-06-behavior-lifecycle.md`；`docs/design/acceptance/SCENARIO-BLUEPRINT.md`；`WorkSession` status/source refs；`DialogueContext.current_work_snapshot` / `context_refs` / `open_behavior_summary`；`TraceSummaryView` author-safe source contract；`quality/acceptance/scenarios/au03-*.yml`；`quality/acceptance/scenarios/au06-single-active-confirmation.yml`。
- Invariant：最新 Work 背景与 current active session transcript 分层；当前 latest active behavior 可以进入 author-safe context；latest turn cleared 或 archived session 不得复活旧等待态；历史 session 只读且不恢复运行态；archived session 默认不进普通 context；memory 与 session 来源在 why 中可区分；replay/read-only 不调 provider。
- Boundary：切穿真实 Tauri UI、Phoenix Channel / sessions API、`WorkSessionService`、`WorkspaceContext`、`ContextAssembler`、`DialogueGateway`、trace summary、persistence repos 和 frontend `WorkspaceChat`；不修改 `novel_agent` provider/runtime，不新增验收 hook，不把 fixture provider 注册进 production runtime。
- Consumer：`WorkspaceChat` 会话面板 / why 面板、`DialogueGateway` provider prompt、AU-03 quality acceptance runner、AU-06 single-active confirmation driver、后续 AU-07/AU-09/AU-12 文件 owner。
- Proof：AU-03 application/persistence/web/frontend 局部测试、8 个默认 Tauri driver、`au03-current-work-context-ssot` real LM Studio 变体、7 个 AU-03 quality acceptance 入口、`workspace_context_test.exs` / `context_grounding_test.exs` behavior context tests、`au06-single-active-confirmation` real Tauri quality driver。
- Acceptance Driver：`scripts/tauri_slice_verify.sh au03-*`、`scripts/tauri_slice_verify.sh au09-au03-session-memory-layering` 与 `scripts/quality_accept.sh au06-single-active-confirmation --surface tauri` 从产品外部驱动真实 Tauri 页面。产品代码没有读取 slice id、没有隐藏 DOM hook、没有验收专用 env/query/localStorage、没有自动输入/点击/上报验收状态。

## 3. 场景对账矩阵

| 场景 | 设计期望 | Contract / invariant | 相关实现入口 | 局部测试证据 | 真实页面外部自动化验收证据 | 当前状态 | 设计偏差 | 缺口类型 | 优先级 | 建议 checkpoint |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-AU03-A1 最新作品背景 | prompt 使用当前 Work 最新 title/genre/profile，不被旧会话覆盖 | current_work_snapshot；AU03-I1/I4 | `WorkspaceContext.fetch_workspace_info/1`、`DialogueGateway` | context / real_loop tests | `au03-current-work-context-ssot`、`--real-lmstudio` | 已验收 | 无 | 无 | closed | 保持回归 |
| SC-AU03-A2 当前 active 会话最近对话 | 同 session 最近 transcript 进入 provider prompt | session transcript；AU03-I4 | `context_fetcher_with_query/0` | interaction / real_loop tests | `au03-current-work-context-ssot`、`--real-lmstudio` | 已验收 | 无 | 无 | closed | 保持回归 |
| SC-AU03-A3 已确认记忆进入 context | confirmed memory 可 recall，why 标记 memory source | memory_summary；AU03-I3 | `MemoryRecallRepo`、`TraceSummaryView` | workspace_context / real_loop tests | `au03-context-source-ui`、`au09-au03-session-memory-layering` | 已验收 | 完整 lifecycle 归 AU-09 | cross-reference | P1 | AU-09 owner |
| SC-AU03-A4 行为上下文 | open behavior / pending confirmation 进入 context | behavior_summary | `WorkspaceContext.fetch_behavior_summary/2`；`DialogueContext.to_prompt_text/1` | `workspace_context_test.exs`；`context_grounding_test.exs` | `au06-single-active-confirmation` | 已验收 | terminal replay/ledger 仍归 AU-06/AU-07 | closed / cross-reference | closed | 保持 AU-06 回归 |
| SC-AU03-B1 空作品不编造 | 无作品事实时诚实说明不知道，不自动表单化 | AU03-I2 | `ContextAssembler.safe_fetch/4` | empty context tests | `au11-missing-workstate-policy` 作为 missing WorkState cross evidence | 已测试 | 完整 empty/no-facts 真实 UI/LLM 反证仍不足 | 补验收（完整矩阵） | P1 | empty-context UI/LLM |
| SC-AU03-B2 有背景无会话 | 只引用 Work 背景，不伪造“刚才讨论” | current_work_snapshot；AU03-I2 | `WorkspaceContext.fetch_workspace_info/1` | 无专属测试 | 无 | 不确定 | 证据不足 | 补测试/验收 | P1 | work-only context |
| SC-AU03-B3 fetcher 异常降级 | context 读取失败时 empty context + warning，不阻断 turn | safe_fetch | `ContextAssembler.safe_fetch/4` | safe_fetch unit | 无真实 UI/LLM | 已实现未验收 | 无 | 补验收 | P1 | fault-injection UI |
| SC-AU03-C1 会话列表 | work-scoped N 个会话、状态可见、不串作品 | WorkSession；AU03-I5/I7 | `WorkSessionService`、`WorkspaceChat` | service/controller/component tests | `au03-session-new-active`、`au03-session-history-readonly`、`au03-archive-session-filter` | 部分实现 | 完整状态矩阵不足 | 补验收 | P2 | session state matrix |
| SC-AU03-C2 新建会话 | 创建新 active session，旧 active 退出，新会话不带旧 transcript | create_active；AU03-I4/I7 | `createWorkSession` / sessions API | persistence/application/controller/frontend tests | `au03-session-new-active` | 已验收 | 无 | 无 | closed | 保持回归 |
| SC-AU03-C3 搜索历史会话 | 搜索 title/summary/transcript，可定位匹配 turn | `WorkSessionRepo.search/2` | sessions API、搜索框 | repo/controller tests | `au03-session-history-readonly` 搜索打开 session | 部分实现 | 缺 turn 定位/高亮 | 补实现 | P2 | search turn highlight |
| SC-AU03-C4 历史只读回看 | exited/read-only，不恢复 loading/action/confirmation | read_only；AU03-I5 | `WorkSessionService.show/2`、`WorkspaceChat` | service/controller/component tests | `au03-session-history-readonly` | 已验收 | 无 | 无 | closed | 保持回归 |
| SC-AU03-C5 归档会话 | archived 默认隐藏，不删 transcript，可搜索回看 | archive；AU03-I6 | `WorkSessionService.archive/2` | archived context filter tests | `au03-archive-session-filter` | 已验收 | 无 | 无 | closed | 保持回归 |
| SC-AU03-C6 从历史继续 | 创建新 active branch，记录 source refs，不改旧 transcript | source_session_ref/source_turn_ref；AU03-I7 | `handleBranchFromReadOnlySession` | service/controller/component tests | `au03-branch-from-history` | 已验收 | 无 | 无 | closed | 保持回归 |
| SC-AU03-D1 历史冻结，背景最新 | 历史内容不重写；当前背景仍取最新 Work | AU03-I4/I5 | read-only session + context fetcher | real_loop tests | `au03-session-history-readonly`、`au03-current-work-context-ssot` | 部分实现 | 同屏 profile/replay 未闭环 | 补验收 | P2 | AU-12/AU-07 owner |
| SC-AU03-D2 archived 不默认进 context | archived transcript 不进普通 prompt，显式引用另行标明 | AU03-I6 | `context_fetcher_with_query/0` | workspace_context tests | `au03-archive-session-filter` | 已验收 | 显式 archived source 产品路径未闭环 | 补实现 | P1 | AU-07/AU-09 source detail |
| SC-AU03-D3 切换作品不串上下文 | work/session/context 按当前 Work 隔离 | SU-02 isolation；AU03-I4 | work switch runtime + context fetcher | SU-02/AU-09 tests | SU-02 isolation slices、`au09-cross-work-memory-isolation`、`au09-au03-session-memory-layering` | 已验收 | AU-03 专属会话列表矩阵可细化 | 补验收 | P2 | cross-work session matrix |
| SC-AU03-E1 作者可见来源 | why 中区分 Work/session/memory/archived/behavior 来源 | ContextSourceRef；AU03-I3 | `TraceWriter` / `TraceSummaryView` | trace summary tests | `au03-context-source-ui` | 已验收 | archived/behavior source 未覆盖 | 补实现 | P1 | AU-07 source detail |
| SC-AU03-E2 author-safe 摘要 | 不暴露 raw prompt/provider/debug/跨作品数据 | redaction_level；AU03-I3 | `TraceSummaryView` | author-safe filtering tests | `au03-context-source-ui` | 已验收 | developer 双视图未闭环 | 补验收 | P1 | AU-07 developer trace |
| SC-AU03-F1 长会话压缩 | 最近必要上下文进入 prompt，原 transcript 可查看 | summary/window | `WorkspaceContext` | context tests | `au03-long-session-compression` | 已验收 | 完整 summary 策略未冻结 | 补实现 | P2 | session summary strategy |
| SC-AU03-F2 replay 不调 LLM | 历史回放使用 TurnResult/trace，不重新创作 | Replay contract；AU03-I5 | `ReplayService`；`TraceReplayService` | E2E reply-only replay；AU-07 scoped query tests | `au07-persisted-trace-query` 作为普通旧 turn scoped query / no-provider replay cross evidence；`au07-partial-replay-ui` 作为 partial replay 诚实提示 cross evidence；`au07-trace-query-scope-negative-matrix` 作为 scoped negative matrix cross evidence | 已测试 | 完整会话级 replay、developer view、多类型 UI 未闭环 | 补实现 | P1 | AU-07 replay owner |

### 3.1 二轮剩余缺口矩阵（2026-06-22）

| 场景 ID / 名称 | 第一轮状态 | 剩余缺口描述 | 缺口类型 | 优先级 | 当前证据 | 需要补的实现或验收 driver | 是否应在 AU-03 内关闭 | 建议 checkpoint / slice | 是否满足继续 AU-04 的二轮退出标准 |
|---|---|---|---|---|---|---|---|---|---|
| SC-AU03-A1 最新作品背景 | 已验收 | 无当前缺口；AU-12 可继续细化档案侧栏展示 | 无 / cross-reference | closed | `au03-current-work-context-ssot`、`--provider lmstudio` | 无 | 否 | 保持回归 | 是 |
| SC-AU03-A2 当前 active 会话最近对话 | 已验收 | 搜索 turn 定位不属于本场景 | 无 / P2 后续 | closed | `au03-current-work-context-ssot`、`--provider lmstudio` | 无 | 否 | 保持回归 | 是 |
| SC-AU03-A3 已确认记忆进入 context | 已验收 | 完整 memory lifecycle / developer replay 归 AU-09/AU-07 | cross-reference | P1 | `au03-context-source-ui`、`au09-au03-session-memory-layering` | AU-09/AU-07 继续补 lifecycle/replay | 否 | AU-09 / AU-07 owner | 是，owner 已登记 |
| SC-AU03-A4 当前开放行为 | 未实现 | 已由依赖 checkpoint 关闭：latest active behavior 进入 author-safe `behavior_summary`、prompt 和 context ref；terminal replay/ledger 不属于 A4 最小关闭条件 | closed / cross-reference | closed | `workspace_context_test.exs`；`context_grounding_test.exs`；`au06-single-active-confirmation` | 无当前 AU-03 实现缺口；AU-06/AU-07 继续补 terminal replay、blocking clarification 和 ledger | 否，当前已关闭 | AU-03 behavior context dependency checkpoint | 是 |
| SC-AU03-B1 空作品诚实不知道 | 已测试 | `au11-missing-workstate-policy` 已覆盖仅有标题但缺章节/正文/人物状态时不编造当前章、why 显示 missing、no tool/adoption/write；仍缺完整 empty/no-facts 与 real LLM 反证矩阵 | 补验收 / cross-reference | P1 | `context_grounding_test.exs`；`au11-missing-workstate-policy` summary | empty-context real UI/LLM driver；work-only/failure 分支另补 | 否，本轮只回填 cross evidence，不关闭整组矩阵 | AU-03 empty-context robustness 或 AU-11 missing context | 是，P1 已缩小并登记后续 robustness |
| SC-AU03-B2 有作品背景但无会话 | 不确定 | 缺专属 test/driver，需证明只引用 Work 背景、不伪造“刚才讨论” | 补测试/验收 | P1 | 旧 partial context 记录；当前 work snapshot 主链已由 A1 证明 | work-only context test + real UI driver | 否，本轮不新增 driver | AU-03 work-only context robustness | 是，登记后续 robustness |
| SC-AU03-B3 fetcher 异常降级 | 已实现未验收 | 缺真实 UI/LLM 故障注入，需证明作者可见恢复文案和下一轮继续 | 补验收 | P1 | `ContextAssembler.safe_fetch/4` 单元证据 | fault-injection UI/LLM driver | 否，本轮不新增 driver | AU-03 context-failure UI 或 AU-11 missing context | 是，登记后续 robustness |
| SC-AU03-C1 会话列表 | 部分实现 | 完整状态操作矩阵、AU-03 专属跨作品会话列表矩阵不足 | 补验收 | P2 | `au03-session-new-active`、`au03-session-history-readonly`、`au03-archive-session-filter` | session state matrix driver | 否 | AU-03 session-state matrix | 是，P2 后续 |
| SC-AU03-C2 新建会话 | 已验收 | 无 | 无 | closed | `au03-session-new-active` | 无 | 否 | 保持回归 | 是 |
| SC-AU03-C3 搜索历史会话 | 部分实现 | 搜索可打开 session，但缺匹配 turn 定位/高亮 | 补实现 | P2 | `au03-session-history-readonly` | search turn positioning/highlight | 否 | AU-03 search turn highlight | 是，P2 后续 |
| SC-AU03-C4 历史只读回看 | 已验收 | 无 | 无 | closed | `au03-session-history-readonly` | 无 | 否 | 保持回归 | 是 |
| SC-AU03-C5 归档会话 | 已验收 | 显式 archived source 标注归 D2/E1 | cross-reference | closed/P1 | `au03-archive-session-filter` | 无当前 AU-03 实现 | 否 | AU-07/AU-09 source detail | 是，owner 已登记 |
| SC-AU03-C6 从历史继续 | 已验收 | 无 | 无 | closed | `au03-branch-from-history` | 无 | 否 | 保持回归 | 是 |
| SC-AU03-D1 历史冻结，背景最新 | 部分实现 | 同屏 profile/replay 深联动未闭环 | cross-reference / 补验收 | P2 | `au03-session-history-readonly`、`au03-current-work-context-ssot` | AU-12/AU-07 继续补 profile/replay | 否 | AU-12/AU-07 owner | 是，P2 后续 |
| SC-AU03-D2 archived 不默认进 context | 已验收 | 普通 context 过滤已闭；显式引用 archived source 的 prompt/trace 标注未闭环 | cross-reference / 补实现 | P1 | `au03-archive-session-filter` + context filter tests | 显式 archived source prompt + trace + author-safe summary | 否 | AU-07/AU-09 source detail | 是，owner 已登记 |
| SC-AU03-D3 切换作品不串上下文 | 已验收 | AU-03 专属会话列表隔离矩阵可细化 | 补验收 | P2 | SU-02 isolation、`au09-cross-work-memory-isolation`、`au09-au03-session-memory-layering` | AU-03 cross-work session matrix | 否 | AU-03 cross-work session matrix | 是，P2 后续 |
| SC-AU03-E1 作者可见来源 | 已验收 | behavior context ref 已由 AU-06 driver 覆盖；显式 archived source 和历史旧 turn source 未覆盖 | cross-reference / 补实现 | P1 | `au03-context-source-ui`；`au06-single-active-confirmation` | AU-07/AU-09 补 archived / old-turn source detail | 否 | AU-07/AU-09 owner | 是，owner 已登记 |
| SC-AU03-E2 author-safe 摘要 | 已验收 | developer 双视图未闭环 | cross-reference / 补验收 | P1 | `au03-context-source-ui` | AU-07 developer trace/replay UI | 否 | AU-07 developer trace | 是，owner 已登记 |
| SC-AU03-F1 长会话压缩 | 已验收 | 完整 summary 策略未冻结；real-LMStudio 长会话 UI summary 仍不作为证据 | 补实现 | P2 | `au03-long-session-compression` deterministic Tauri | session summary strategy + optional real provider driver | 否 | AU-03 session summary strategy | 是，P2 后续 |
| SC-AU03-F2 replay 不调 LLM | 已测试 | 普通旧 turn scoped query / no-provider replay、partial replay 诚实提示与 scoped negative matrix 已由 AU-07 回填；完整会话级 replay、developer view、多类型 UI 未闭环 | cross-reference / 补实现 | P1 | `ReplayService` / E2E replay 局部证据；`au07-persisted-trace-query`；`au07-partial-replay-ui`；`au07-trace-query-scope-negative-matrix` | AU-07 补完整 replay/developer/多类型 UI | 否 | AU-07 replay owner | 是，owner 已登记 |

## 4. 偏差 review

- Work/session 分层：`WorkspaceContext` 按当前 `work_id` 和 active `session_id` 取最新 Work snapshot 与 recent transcript；`au03-current-work-context-ssot` 的默认和 real LM Studio 证据都证明历史只读回看后不会用旧 transcript 覆盖当前作品事实。
- 历史只读边界：`WorkSessionService.show/2` 和前端只读态会禁止输入/发送，不恢复旧 pending adoption；`au03-session-history-readonly` 已从真实 UI 验收旧 pending 不恢复。
- 从历史继续：产品路径显式创建新 active branch session 并记录 `source_session_ref/source_turn_ref`，没有把旧 transcript 复制到新 session。
- archived 边界：归档会话默认不进日常列表和普通 context，显式搜索可只读回看；仍缺“显式引用 archived source 时如何在 prompt/trace 标注”的产品路径，登记为 AU-07/AU-09 P1。
- 验收红线：现有 driver 通过真实按钮、输入框、会话列表、why 面板、websocket/backend log、LM Studio request log 和 summary artifact 取证；production code 没有为 AU-03 添加验收感知逻辑。

## 5. 缺口分级

| 优先级 | 缺口 | 处置 |
|---|---|---|
| P0 | 无 | 最新 Work 背景 SSOT、active/historical session 分层、新建会话、历史只读、从历史继续、归档过滤、上下文来源 UI、长会话压缩和跨作品/记忆分层均有当前真实页面证据或对应局部证据。 |
| closed | SC-AU03-A4 behavior summary 已接入 | 本轮依赖 checkpoint 已关闭：`WorkspaceContext` 从最新 active behavior 生成 author-safe summary，`DialogueContext.to_prompt_text/1` 写入 prompt，`au06-single-active-confirmation` 证明真实 Tauri turn 消费 behavior context ref 且不泄漏 behavior/action id。后续 AU-06/AU-07 仍负责 terminal replay、blocking clarification 和持久 BehaviorBinding ledger。 |
| P1 | SC-AU03-B1/B2/B3 empty/work-only/failure UI/LLM 矩阵不足 | 二轮判定：不推翻当前 file-level deliverable，但保留 P1 后续。`au11-missing-workstate-policy` 已补 B1 missing WorkState cross evidence；完整 empty/no-facts、work-only 和 fault-injection UI/LLM 仍未关闭。Owner：AU-03 后续或 AU-11 missing context。恢复路径：补 Work-only context test、empty-context real UI、fault-injection UI/LLM driver。 |
| P1 | SC-AU03-D2/E1 显式 archived source 引用与来源标注不足 | Owner：AU-07/AU-09。恢复路径：补显式引用历史/归档 source 的 prompt + trace + author-safe summary。 |
| P1 | SC-AU03-E2/F2 developer trace 与会话级 replay UI 未闭环 | Owner：AU-07。恢复路径：普通旧 turn scoped query / no-provider replay 已由 `au07-persisted-trace-query` 回填，partial 状态已由 `au07-partial-replay-ui` 回填，scoped negative matrix 已由 `au07-trace-query-scope-negative-matrix` 回填；继续在 trace/replay 文件内补 author/developer 双视图和多类型 replay UI。 |
| P2 | SC-AU03-C1/C3 会话列表状态矩阵与搜索 turn 高亮 | 不阻塞当前文件；后续补 session list state matrix 和 search turn positioning。 |
| P2 | SC-AU03-D1/D3/F1 profile/replay 联动、跨作品会话列表、压缩策略 | Owner：AU-12/AU-07/AU-03 后续。恢复路径：按对应文件细化，不回填为当前 P0。 |

## 6. 验证记录

已复跑：

```bash
bash scripts/tauri_slice_verify.sh --list
mix test apps/novel_application/test/novel_application/context_grounding_test.exs apps/novel_application/test/novel_application/work_session_service_test.exs apps/novel_application/test/novel_application/replay_service_test.exs apps/novel_persistence/test/novel_persistence/work_session_repo_test.exs apps/novel_persistence/test/novel_persistence/workspace_context_test.exs apps/novel_web/test/novel_web/controllers/work_sessions_controller_test.exs
mix test --include integration apps/novel_application/test/novel_application/dialogue_gateway_real_loop_test.exs
pnpm --dir frontend exec vitest run src/lib/__tests__/sessions.test.ts src/components/WorkspaceChat.availableActions.test.tsx slice-verify/native-tauri-verifier.test.mjs
bash scripts/quality_manifest_check.sh
bash scripts/tauri_slice_verify.sh au03-session-new-active
bash scripts/tauri_slice_verify.sh au03-session-history-readonly
bash scripts/tauri_slice_verify.sh au03-branch-from-history
bash scripts/tauri_slice_verify.sh au03-archive-session-filter
bash scripts/tauri_slice_verify.sh au03-current-work-context-ssot
bash scripts/tauri_slice_verify.sh au03-context-source-ui
bash scripts/tauri_slice_verify.sh au03-long-session-compression
bash scripts/tauri_slice_verify.sh au09-au03-session-memory-layering
bash scripts/tauri_slice_verify.sh --real-lmstudio au03-current-work-context-ssot
bash scripts/quality_accept.sh au03-session-new-active --surface tauri
bash scripts/quality_accept.sh au03-session-history-readonly --surface tauri
bash scripts/quality_accept.sh au03-branch-from-history --surface tauri
bash scripts/quality_accept.sh au03-archive-session-filter --surface tauri
bash scripts/quality_accept.sh au03-current-work-context-ssot --surface tauri
bash scripts/quality_accept.sh au03-context-source-ui --surface tauri
bash scripts/quality_accept.sh au03-long-session-compression --surface tauri
bash scripts/quality_accept.sh au03-current-work-context-ssot --surface tauri --provider lmstudio
mix compile
mix test apps/novel_persistence/test/novel_persistence/workspace_context_test.exs
mix test apps/novel_application/test/novel_application/context_grounding_test.exs
node --check frontend/slice-verify/external-ui-driver.mjs
node --check frontend/slice-verify/native-tauri-verifier.mjs
pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs
bash scripts/quality_accept.sh au06-single-active-confirmation --surface tauri
git diff --check
bash scripts/task_done.sh --skip-static-scan
bash scripts/ai_static_scan.sh --top 10
node scripts/task_done_check.mjs
```

2026-06-22 二轮复跑：

```bash
bash scripts/quality_accept.sh au03-session-new-active --surface tauri
bash scripts/quality_accept.sh au03-session-history-readonly --surface tauri
bash scripts/quality_accept.sh au03-branch-from-history --surface tauri
bash scripts/quality_accept.sh au03-archive-session-filter --surface tauri
bash scripts/quality_accept.sh au03-current-work-context-ssot --surface tauri
bash scripts/quality_accept.sh au03-context-source-ui --surface tauri
bash scripts/quality_accept.sh au03-long-session-compression --surface tauri
bash scripts/quality_accept.sh au09-au03-session-memory-layering --surface tauri
bash scripts/quality_accept.sh au03-current-work-context-ssot --surface tauri --provider lmstudio
mix compile
mix test apps/novel_persistence/test/novel_persistence/workspace_context_test.exs
mix test apps/novel_application/test/novel_application/context_grounding_test.exs
node --check frontend/slice-verify/external-ui-driver.mjs
node --check frontend/slice-verify/native-tauri-verifier.mjs
pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs
bash scripts/quality_accept.sh au06-single-active-confirmation --surface tauri
```

结果：

- 后端 AU-03 相关测试：76 tests / 0 failures。
- real-loop integration：6 tests / 0 failures。
- 前端 AU-03/native verifier 相关测试：142 tests / 0 failures。
- `quality_manifest_check.sh`：passed；warning 均为其它 slice 缺 manifest，AU-03 manifest 已存在。
- 8 个默认 Tauri driver 均 passed：`au03-session-new-active`、`au03-session-history-readonly`、`au03-branch-from-history`、`au03-archive-session-filter`、`au03-current-work-context-ssot`、`au03-context-source-ui`、`au03-long-session-compression`、`au09-au03-session-memory-layering`。
- `au03-current-work-context-ssot --real-lmstudio` passed；quality acceptance 的 LM Studio provider 变体也 passed。
- 7 个 AU-03 quality acceptance 入口均 passed。
- 2026-06-22 二轮复跑：上述 9 条 quality acceptance 命令全部 passed；`au03-current-work-context-ssot` 的 LM Studio summary 继续记录 `provider=lmstudio`、`request_count=1`、HTTP 200。
- AU-03 A4 依赖 checkpoint：`mix compile` passed；`workspace_context_test.exs` 15 tests / 0 failures；`context_grounding_test.exs` 23 tests / 0 failures；`node --check frontend/slice-verify/external-ui-driver.mjs` / `node --check frontend/slice-verify/native-tauri-verifier.mjs` passed；`pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs` 140 tests / 0 failures；`au06-single-active-confirmation` passed，真实 Tauri summary 记录 `second_turn_behavior_context_author_safe=true`、`second_turn_behavior_context_ref=ctx_17`，并证明第二个 confirmation turn 具备 behavior context ref 且不泄漏旧 behavior/action id。
- 额外尝试的 `au03-long-session-compression --real-lmstudio` 未计入当前验收：本轮真实 provider 调用已完成，但外部 UI evidence 等待 `slice_verify.ui_state.done` 超时，未生成可引用 `summary.json`。当前 AU-03 文件级证据只使用默认 Tauri `au03-long-session-compression`。
- `git diff --check`：passed。
- `task_done.sh --skip-static-scan` / `task_done_check.mjs`：manifest ok。
- `ai_static_scan.sh --top 10`：17 passed / 1 failed；唯一 Top 10 是既有 gitleaks `generic-api-key` accepted_risk，`blocking=0`、`touched=0`，不命中本轮文件。

## 7. 退出结论

AU-03 满足文件级退出标准，2026-06-22 二轮复核后仍可进入 AU-04：

1. 20 个场景均有可信对账矩阵。
2. P0 已关闭。
3. P1 已登记 owner 与恢复路径：SC-AU03-A4 behavior summary 已由依赖 checkpoint 关闭；AU-07 已回填普通旧 turn scoped replay query、partial replay 诚实提示和 scoped negative matrix，并继续负责完整 replay/developer/多类型 trace，AU-09/AU-07 负责显式 archived/source 引用；`au11-missing-workstate-policy` 已回填 B1 missing WorkState 子证据，AU-03/AU-11 后续继续补完整 empty/work-only/failure UI/LLM 矩阵。
4. 已实现场景均有局部测试证据；承重上下文主链有外部 Tauri 真实页面证据，关键 current-work/context SSOT 有 real LM Studio 证据。
5. AU-03 quality manifest、slice driver、summary artifact、验收 README、SCENARIO-BLUEPRINT 和项目台账口径一致。
6. 本文件补齐 tasks/slices 文件级收口入口。

当前可进入下一个验收文件：`docs/design/acceptance/author/AU-04-execute-and-confirm.md`。

## 当前上下文缺失与读取失败补验

- 状态：**done（2026-10-30 CP0–CP3；外部原生 Tauri + 真实模型故障注入通过 66/66，读取失败/未知与真实空同源表达闭环；残余 known-gap：prose/plot mission inputs 的可用性消费、模型措辞不代签）**。
- 设计依据：本文件 §3 的空作品、有背景无会话、fetcher 失败三类场景；[AU-03](../../docs/design/acceptance/author/AU-03-context.md) 的上下文诚实边界。既有 missing WorkState 的单场景与普通成功 prompt 不能代签整个矩阵。
- 下一步：按当前 B26/B27/ADR-0031 的真实入口重核 ContextAssembler、错误返回及 author-safe 提示，列明 empty/work-only/fetcher-failure 的可见事实与禁称内容；校正旧 frame/envelope 断言，先区分缺实现与缺证据。
- 完整后果：真实页面在空作品时不虚构事实，有背景无会话时不虚构“刚才讨论”，读取失败时不把未知当空事实或成功读取；恢复后当前作品事实进入后续请求，作品切换不串上下文。机制故障注入只在外部 harness/test support，真实模型措辞与机制接线分层取证。
- 边界/依赖：沿原上下文与 AU11/B27 的真实生产者，不造第二 Context 架构；B39 的 Preparation/观察扩展另按其 CP 矩阵。只读/失败路径不写 canon，产品不增加验收感知；实施前在本小节冻结具体七问与 driver。

**元原则整改承接（2026-10-30）**：本轮静态审查确认 `ContextAssembler.safe_fetch` 对异常/非 ok 结果返回空元组，失败原因只进业务日志；现役 `judgment_work_section` 会把 nil snapshot 渲染成“新对话或尚未创建作品”。这里要修复的是**APP 向模型提供的事实含义**：读取失败/尚未知与成功读取后的真实空结果必须可区分，不能只补错误日志或 UI 文案后继续给模型错误的空作品解释。尚未运行产品故障复现；本段不改写历史通过记录。

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 定位真实 fetcher→ContextAssembler→同次 provider 请求→trace/作者反馈路径；逐来源区分成功有值、成功为空、未取得/未知与读取失败，核对部分失败和已有可用事实；冻结最小错误/覆盖表达及各类继续/停止条件，不先发明新 Context 类或全局状态机 | **done（2026-10-30）**：静态链路审计 + 纯函数探针；证据 `artifacts/task-audit/2026-10-30-au03-context-cp0/{audit-map.json,probe.json,probe.exs}`；契约见下“CP0 记录” |
| CP1 | 在同一事实源上接通组装结果、请求渲染与反馈；若继续调用模型，该次实际请求须包含受影响来源的安全错误类别/未知范围和仍可信的事实；不得把失败渲染为已确认的“无作品/0 章/没有记忆”。若因身份/权限等必要底座不足而停止，诚实记录未派发而不是声称模型已获知 | **done（2026-10-30）**：DialogueContext additive `source_status` + `source_status_summary`；ContextAssembler 9 元组/旧 fetcher 兼容与失败 `:unavailable`；生产 fetcher 逐来源 safe 包装（保留已成功事实）；judgment prompt 同次请求「上下文可用性」段 + work/facts 不再把失败渲染为空；6 处 trace/观测带 author-safe 状态。新测试 8 条 + 全量 2358/0；证据见下节 CP1 记录 |
| CP2 | 局部验证 empty/work-only/异常/非 ok/部分失败、跨作品切换及恢复；核对实际发送内容和来源声明，失败不伪造空事实，旧记录缺字段保持未知；恢复后真实事实进入后续请求，重试不复活旧授权、不写 canon | **done（2026-10-30）**：新增同 turn 矩阵 7 条（走 `plan_agent_run` 真实判断步 + 捕获实际 provider prompt + trace 观测）：raise/非 ok→可用性段；部分失败保留 work、章节未知不渲染 0 章；真实空（生产 fetcher）可 0 章；work-only/旧 5 元组兼容；跨作品 A/B 隔离 + 故障→恢复真实事实重入；canon 计数不变。发现并修复 CP1 漏网：规划上下文步 `judgment_observation` 未带状态（仅 emit/trace 有）。全量 2365/0；证据见下节 CP2 记录 |
| CP3 | 外部真实工作台触发缺失/读取故障→作者可见反馈→故障解除→恢复对话；将同一 turn/run 的实际请求、来源状态、回复/trace 与恢复后请求对齐。分开报告局部故障矩阵、真实入口机制与真实模型如何处理未知；未取到请求或仅日志有 error 不算该链完成 | **done（2026-10-30）**：外部原生 Tauri + strata/iq3_s 单槽，外部 harness 重命名投影表注入故障 → H3/H1/H2 三场景 66/66 checks：H1 同 turn 真实请求含可用性段/读取失败且不称新对话/0章；app-log source_status chapters=unavailable/work=ok；agent_events trace unavailable 含 chapters；故障期零 canon 写入；恢复后请求重含真实作品/章节事实、表名恢复、canon 同 hash；strata 结束 loaded=null。证据 `artifacts/slice-verify/au03-context-read-failure-tauri-strata-native-au03cp3c/`；批次 a/b 为 harness 缺陷（故障期计数/嵌套读表、种子文案误判）只读保留 |

- **继续与停止不预设为一刀切**：非关键材料失败时，可在明确未知/覆盖边界下保留合法回复、现有只读取证或必要询问；失败是否阻断由真实身份、权限、操作需求和已接受 policy 决定。关键事实缺失不得猜测执行，但本整改不把任何 fetch 失败都升级为整轮禁止调用模型。
- **同次请求证明**：错误表达使用必要的安全类别、受影响来源和恢复信息，不把原始异常、凭据或内部日志整段注入模型。能证明“日志记录了失败”与“模型该次确实收到失败/未知事实”是两项证据；若请求没有派发，单列停止事实。
- **分工**：本小节拥有空/未知/错误及恢复语义；[B27 请求材料同源](B27-systematic-prompt-and-intent-integration.md#9-元原则整改实际请求材料与引用同源) 负责当前共通请求的材料/来源声明接线与对账。共享构造器和来源事实，不能在两处维护独立错误映射或复制执行状态；B39 的专业 run 求证与恢复仍按其完整 CP 承接。

### CP0 记录（2026-10-30 done）

- 证据：`artifacts/task-audit/2026-10-30-au03-context-cp0/{audit-map.json,probe.json,probe.exs}`（只读静态 + 纯函数探针，未起服务/未调 provider/未写产品数据）。
- 现役链路：生产 fetcher `NovelPersistence.WorkspaceContext.context_fetcher_with_query/0`（单体 8 元组，work/chapters/conversation/memory/behavior/interaction 各查询无 rescue）→ `ContextAssembler.safe_fetch/4`（异常或非 `{:ok,...}` → `@empty_fetch` 全 nil/[] + 仅日志）→ `DialogueContext`（无 source status）→ `DialoguePlanningService.judgment_work_section/1` 把 nil 渲染为「无——这是新对话或尚未创建作品」→ flows/trace 仅记 `context_ref_count`。
- 纯函数探针结论：
  - `fetcher raise` 与「生产 fetcher 成功但作品不存在（未知 UUID）」生成的模型 prompt **sha256 完全相同**（`f338d5df…`），均含「无——这是新对话或尚未创建作品」；读取失败与未知/空不可区分。
  - `成功但空` 同形态；`work-only` 成功时 work 段渲染、facts 渲染「全书 0 章」，conversation/memory 缺段。
  - 「部分失败」无法表达：任一来源 raise 即整轮全空，已有可用事实丢失；`DialogueContext` 无可用性字段。
- 冻结契约（CP1 实现依据）：
  1. 来源状态四类：成功有值 `:ok`、成功为空 `:empty`、未取得/未知 `:unknown`、读取失败 `:unavailable`；unknown 与 unavailable 不得渲染为确认空事实。
  2. `DialogueContext` 增 additive `source_status`（work/conversation/memory/behavior/chapters/interaction）；不新建 Context 类/全局状态机；旧 fetcher 5/6/7/8 元组兼容，生产 fetcher 追加第 9 项 statuses。
  3. 生产 fetcher 在来源边界 safe 包装，仅记录安全类别/受影响来源；prompt 不注入原始异常/凭据/内部日志。
  4. 同次模型请求追加「上下文可用性（APP 客观状态）」段：逐项列 unavailable/unknown 并禁止渲染为空作品/0 章/没有讨论/没有记忆；可用事实照常渲染。
  5. 读取失败不得渲染成“新对话或尚未创建作品”；真实空仍按既有语义（可零/无），但来源状态为 `:ok/:empty`。
  6. trace/assemble 日志/turn 级反馈带同一安全状态（author-safe），refs 仅为有值来源。
  7. 继续/停止：非关键来源（conversation/memory/behavior）unavailable → 可在未知边界下继续；work/chapters unavailable → 不得声称空事实/猜身份，写入请求因无真实 ref/版本自然零写入/询问；关键底座不足则诚实停止并记录未派发。
- CP2 预注册：raise/非 ok→unavailable、work 成功+chapters 失败的部分保留、真实空作品、work-only、跨作品切换/恢复、旧 fetcher 兼容；断言 prompt 含可用性段且不含错误空事实，零写入。
- CP3 预注册：外部原生 Tauri + 真实模型；外部 harness 以 SQLite 独占锁故障注入只读投影表（产品无验收感知），验证故障期同 turn 请求含 unavailability、作者反馈/trace 不称空、零 canon 写入；解锁后恢复请求含真实事实；无会话/记忆的 empty 对照。证据目录/预算/失败只读保留已冻结。
- 残余：CP0 未运行产品故障/页面/真实模型；“未知 vs 真实空”的作者可见文案在 CP2/CP3 冻结；历史数据缺失字段映射 unknown 按现有契约核对，不伪造迁移。

### CP1 记录（2026-10-30 done）

- 改动（同源事实 → 同次请求渲染 → trace/反馈）：
  - `NovelDomain.DialogueContext`：additive `source_status`（work/conversation/memory/behavior/chapters/interaction → `:ok|:empty|:unknown|:unavailable`）；`to_prompt_text/1` 分流——`unavailable/unknown` 渲染“读取失败/未知，不得当作无作品或新对话”，缺失状态保持既有字节语义；新增 `source_status_summary/1`（author-safe：sources/unavailable_sources/unknown_sources）。
  - `ContextAssembler`：接受生产 9 元组（追加 statuses）；旧 5/6/7/8 元组按值推断 `:ok/:empty`（既有 stub/测试字节不变）；异常/非 ok 的 `@empty_fetch` 显式全 `:unavailable`；assemble 完成日志携带 `source_status`；context 结构携带状态。
  - `NovelPersistence.WorkspaceContext`：两个生产 fetcher 改为逐来源 safe 包装（work/chapters/conversation/memory/behavior/interaction），单来源失败只记安全类别（`context.source.error`：source/reason_category/degraded_to，不含原始异常）并保留其它已成功来源，返回第 9 项 statuses。
  - `DialoguePlanningService`：判断上下文两条裁剪路径均插入「## 上下文可用性（APP 客观状态，不得改写）」段，列出 unavailable/unknown 并禁止渲染为空作品/0章/没有讨论/没有记忆；work 段在读取失败时输出“事实未知”而非“新对话”；work/chapters 未取得时不再渲染「0 章」类事实。
  - trace/观测：judgment/prose/character/plot/world 五处 context 观测与 planning emit 均带 `context_source_status`（安全摘要，不是原始错误）。
- 测试：新增 `au03_context_status_test.exs` 8 条（raise/非 ok → unavailable + 可用性段且不声称新对话；9 元组部分保留不渲染 0 章；真实空作品可 0 章；work-only 不声称讨论；旧 5 元组兼容；to_prompt_text 分流；summary）；持久层 WorkspaceContext/ChapterSummaryReader/InteractionLifecycle 合同测试更新为 9 元组（机械补位，原断言未放宽）；全量 mix test **2358/0**。
- 门禁：format/compile -Werror/credo strict/xref/arch、I1/I2/I3、manifest 209 scenarios、task_done `20261030T141318Z`、静态扫描无 blocking；B30 原生确定性场景复跑 PASS（30/30+T8 6/6，作为 UI 证据新鲜度回归，非本 CP 语义证明）。
- 残余：① `prose_drafting_with_quality` 等专业 run 的 writer prompt 仍沿用旧上下文渲染（本轮只补 trace 元数据；其上下文块是否需同步“可用性”段由 CP2 按真实入口判定）；② 真实页面故障矩阵/恢复与真实模型如何处理未知 = CP2/CP3；③ 未新增 UI 文案，作者可见措辞在 CP2/CP3 以真实请求/trace 收口。

### CP2 记录（2026-10-30 done）

- 方法：`apps/novel_application/test/novel_application/au03_context_turn_matrix_test.exs`（7 条，Sandbox+真实 Repo）：经 `DialoguePlanningService.plan_agent_run(input, fetcher, provider_execution)` 驱动真实机械 context 步 + 判断步，provider 捕获**该次实际判断 prompt**；同时读取 context 步 `AgentObservation.structured_payload.context_source_status` 作为 trace/反馈同源证据；每个故障用例比较 drafts/chapters 计数前后一致（零 canon 写入）。故障 fetcher 只在 test support 注入，产品代码无验收/故障感知。
- 覆盖与断言：
  1. `raise` fetcher → prompt 含「上下文可用性/读取失败」，不含「无——这是新对话或尚未创建作品」，不含「全书 0 章」；trace 观测 `unavailable_sources` 含 work；turn_result 叙事来自真实 provider 字节；零写入。
  2. 非 ok 返回 → 同 unavailable 语义。
  3. 部分失败（9 元组 work=:ok + chapters=:unavailable）→ prompt 保留「AU03 部分保留作品」、章节标未知、不渲染 0 章；trace unavailable_sources 含 chapters。
  4. 真实空作品（`WorkspaceContext.context_fetcher_with_query/0` 生产路径）→ prompt 可渲染「0 章中已写 0 章」，无可用性段、无 unavailable。
  5. work-only（旧 5 元组）→ 无可用性段、不声称刚才讨论；旧合同缺状态按既有空事实语义兼容。
  6. 旧 5 元组空 → 保留「无——这是新对话或尚未创建作品」（兼容），不伪造读取失败。
  7. 跨作品甲/乙：故障请求无 A/B 标题串入；`work_A` 恢复真实 fetcher 后请求含「AU03 作品甲」不含乙，`work_B` 反之；恢复后无可用性段；全程 canon 计数不变。
- 附加修复：CP1 只把状态写入 `emit_judgment_stage` 与 flow context observation，**规划服务自身 context 步的 `judgment_observation` 仍只有 stage**；CP2 发现后补 `context_source_status`，使 trace/反馈与同次请求真正同源（无测试代签）。
- 门禁：format/compile -Werror/credo strict/xref/arch、全量 mix test **2365/0**（新增 7）、I1/I2/I3、manifest 209 scenarios、task_done `20261030T141643Z`、静态扫描无 blocking。
- 残余/后续：① `prose_drafting_with_quality`/`plot_outline_with_context` 的 mission inputs 仍以 `work_snapshot %{}`/`written_chapters 0` 渲染（writer prompt 尚未消费 source_status），本 CP 以 judgment 路径为主、未改其渲染；作为 known-gap 保留（归 B39/B27 专业 run 上下文消费继续，CP3 不代签）；② 真实页面故障注入与真实模型如何措辞“未知” = CP3；③ 未新增 UI 文案，作者可见措辞以同次请求/trace 证据收口。

### CP3 执行注册（2026-10-30，冻结后执行）

- slice id：`au03-context-read-failure`；seed `scripts/seed_au03_context_status.exs`（作品 + 第03章 accepted 正文）；驱动 `scripts/native_au03_drive.mjs`；证据 `scripts/native_au03_evidence.mjs`。
- 场景：H3 baseline（真实事实）→ 外部注入故障（重命名 `chapter_summaries` 投影表）→ H1 fault（同 session，同 turn 请求必须含可用性段/读取失败，反馈与 trace 同源，零 canon 写入）→ 解除故障 → H2 recovery（请求重新含真实作品/章节事实，表名恢复）。
- 故障注入：仅外部 harness 对**隔离测试 DB** 执行 `ALTER TABLE chapter_summaries RENAME TO chapter_summaries_fault` 及反向恢复（预检 `artifacts/task-audit/2026-10-30-au03-context-cp3/preflight_fault.exs` 已证明只影响 context chapters 来源、work 等已成功来源保留）；产品代码不读取 env/slice/testid/故障开关；失败批次只读保留，驱动失败路径尽力恢复表名并记录。
- 判据：llm-calls 按 `turn_id` 对齐该轮真实 provider 请求；app-log `context.assemble.done.source_status` 与请求段一致（H1 chapters=unavailable、work=ok）；DB `agent_events.payload.context_source_status.unavailable_sources` 含 chapters；H1 前后 canon 计数/正文 hash 不变；H2 表名恢复、请求含真实 title/章节事实；strata 单槽结束 unload 核验。
- 证据目录：`artifacts/slice-verify/au03-context-read-failure-tauri-strata-native-<tag>/`；runner 注册五处 + scenario manifest（210 scenarios）。
- 预算：B37 分型等待（input/turn/candidate/adoption/maintenance/restore/export）+ 10s 心跳；同因失败 ≤2 次，超预算记录 root-cause 并升级；不重跑换分。

### CP3 记录（2026-10-30，原生故障注入 + 真实模型）

- 配置：slice `au03-context-read-failure`；seed `scripts/seed_au03_context_status.exs`；驱动 `scripts/native_au03_drive.mjs`；核验 `scripts/native_au03_evidence.mjs`；runner 五处注册 + scenario manifest（210 scenarios）。strata/iq3_s 单槽；开始记录 loader、结束 unload 核验 `loaded=null`。
- 故障注入（仅外部 harness）：隔离测试 DB 上 `ALTER TABLE chapter_summaries RENAME TO chapter_summaries_fault` 注入、反向恢复；产品代码不读 env/slice/testid/故障开关。预检 `artifacts/task-audit/2026-10-30-au03-context-cp3/preflight_fault.exs` 证明只影响 chapters 来源、work/其它来源保留。
- 批次：`au03cp3a`（驱动在故障期 capture 时因对缺失表计数失败，harness 缺陷只读保留）；`au03cp3b`（嵌套只读连接读表名返回空 + 种子作品 core_selling_point 含“读取失败”导致真实场景误判，harness 断言缺陷只读保留）；**`au03cp3c` 最终通过 checks 66/66**，runner exit 0。
- 关键证据（`artifacts/slice-verify/au03-context-read-failure-tauri-strata-native-au03cp3c/`）：
  - H3 baseline：真实请求含作品 title/章节事实，无「上下文可用性」段；模型 reply 引用真实正文。
  - H1 fault：同 turn 真实 provider 请求含「## 上下文可用性」「读取失败」「章节事实」，不出现「无——这是新对话或尚未创建作品」「全书 0 章」；app-log `context.assemble.done.source_status`：`chapters=unavailable, work=ok`；`agent_events.payload.context_source_status.unavailable_sources` 含 `chapters`；故障期 DB 生产表/草稿/摘要计数与章节正文 hash 不变（零 canon 写入）；H1 截图/AX/WS 帧保留。
  - H2 recovery：投影表恢复为 `chapter_summaries`；后续请求重新含真实 title/章节事实、无可用性段；canon hash 与 baseline 一致。
  - 模型行为诚实记录：H1 模型经会话历史复述了上一轮已确认事实（未复述“读取失败”措辞）；APP 请求/来源状态/trace 与零写成立；模型措辞不由自动化代签。
- 门禁：runner 内质量门禁 + 全量后端（本轮无产品源码变更，仍跑 format/compile/credo/xref/arch/test/I1–I3/manifest/task_done/静态扫描）见 `artifacts/gates/2026-10-30-au03-cp3/`。
- 残余 known-gap：① `prose_drafting_with_quality`/`plot_outline_with_context` 的 mission inputs 仍以空 `work_snapshot`/0 章渲染（writer prompt 未消费 source_status），归 B39/B27 专业 run 上下文消费继续；② 真实模型对“未知”的措辞只报告不代签；③ 故障注入为投影表 DDL（真实 DB 层），不覆盖连接级/网络级故障，属另一种故障类别未验；④ 历史数据缺字段映射 unknown 按现行契约（旧 fetcher 无状态按 :empty 兼容）保留，不伪造迁移；⑤ I10 不代签。

## 历史搜索命中定位与只读回看

- 状态：**todo（2026-10-30 承接 SC-AU03-C3/P2；已有会话搜索与只读打开不重做）**。
- 设计依据：本文件 §3、[Journey B4](../../docs/product/user-journeys.md#3-journey-b作品空间会话与上下文分层) 要求搜索命中后定位对应 turn。只读核对 `frontend/src/components/WorkspaceChat.tsx` 的 searchSessions 消费只更新 sessions 列表；尚未证明命中 turn 的定位与高亮闭环。
- 下一步：核定搜索结果的会话/turn 身份、匹配范围、分页定位与退出搜索的状态；查实际 API/DTO/视图能复用什么，再补最小定位契约与 UI 设计追溯，不能凭 title 或文本截断猜 turn。
- 完整后果：从真实历史搜索进入指定匹配消息并可见命中；较旧分页命中、多个结果、归档会话、空结果与跨作品隔离均可验证。浏览历史保持只读，不恢复旧 pending/action/loading、不调用模型、不修改 transcript；“从这里继续”仍走既有分支操作。
- Boundary/Consumer/Proof：现有 session search → web/application/persistence 查询 → WorkspaceChat 历史视图；以 scope/稳定消息身份局部测试和外部真实 Tauri 搜索/定位/返回证据证明；不新建全文搜索平台，不把检索结果自动塞进模型上下文。
