# AU03 File-Level Closure

- 状态：file-level deliverable / P1-P2 follow-up registered
- 类型：Author Acceptance File Closure
- 验收文件：`docs/design/acceptance/author/AU-03-context.md`
- 当前结论：20 个场景中 12 个已有真实页面外部自动化证据，2 个已测试，3 个部分实现，1 个已实现未验收，1 个未实现，1 个不确定；P0 已关闭，当前可进入 AU-04。
- 最近复核：2026-06-21

## 1. 文件级目标

AU-03 验收作者对“AI 了解我的作品”的基础信任：AI 必须消费当前作品的最新背景、当前 active session transcript、已确认记忆和可解释 context source；历史会话可以搜索、只读回看、归档和从历史继续，但不能把旧 transcript、旧 pending/action/loading 或归档内容默认伪装成当前上下文。

本文件是 AU-03 的文件级收口记录，补齐从验收文档、实现入口、quality manifest、真实 Tauri driver 到剩余 P1/P2 owner 的对账链路。本轮只新增文件级记录和索引，并同步过时证据引用；不修改 production runtime。

## 2. 开工检查

- Contract：`docs/design/acceptance/author/AU-03-context.md`；`docs/design/acceptance/SCENARIO-BLUEPRINT.md`；`WorkSession` status/source refs；`DialogueContext.current_work_snapshot` / `context_refs`；`TraceSummaryView` author-safe source contract；`quality/acceptance/scenarios/au03-*.yml`。
- Invariant：最新 Work 背景与 current active session transcript 分层；历史 session 只读且不恢复运行态；archived session 默认不进普通 context；memory 与 session 来源在 why 中可区分；replay/read-only 不调 provider。
- Boundary：切穿真实 Tauri UI、Phoenix Channel / sessions API、`WorkSessionService`、`WorkspaceContext`、`ContextAssembler`、`DialogueGateway`、trace summary、persistence repos 和 frontend `WorkspaceChat`；不修改 `novel_agent` provider/runtime，不新增验收 hook，不把 fixture provider 注册进 production runtime。
- Consumer：`WorkspaceChat` 会话面板 / why 面板、`DialogueGateway` provider prompt、AU-03 quality acceptance runner、后续 AU-04/AU-07/AU-09/AU-12 文件 owner。
- Proof：AU-03 application/persistence/web/frontend 局部测试、8 个默认 Tauri driver、`au03-current-work-context-ssot` real LM Studio 变体、7 个 AU-03 quality acceptance 入口。
- Acceptance Driver：`scripts/tauri_slice_verify.sh au03-*` 与 `scripts/tauri_slice_verify.sh au09-au03-session-memory-layering` 从产品外部驱动真实 Tauri 页面。产品代码没有读取 slice id、没有隐藏 DOM hook、没有验收专用 env/query/localStorage、没有自动输入/点击/上报验收状态。

## 3. 场景对账矩阵

| 场景 | 设计期望 | Contract / invariant | 相关实现入口 | 局部测试证据 | 真实页面外部自动化验收证据 | 当前状态 | 设计偏差 | 缺口类型 | 优先级 | 建议 checkpoint |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-AU03-A1 最新作品背景 | prompt 使用当前 Work 最新 title/genre/profile，不被旧会话覆盖 | current_work_snapshot；AU03-I1/I4 | `WorkspaceContext.fetch_workspace_info/1`、`DialogueGateway` | context / real_loop tests | `au03-current-work-context-ssot`、`--real-lmstudio` | 已验收 | 无 | 无 | closed | 保持回归 |
| SC-AU03-A2 当前 active 会话最近对话 | 同 session 最近 transcript 进入 provider prompt | session transcript；AU03-I4 | `context_fetcher_with_query/0` | interaction / real_loop tests | `au03-current-work-context-ssot`、`--real-lmstudio` | 已验收 | 无 | 无 | closed | 保持回归 |
| SC-AU03-A3 已确认记忆进入 context | confirmed memory 可 recall，why 标记 memory source | memory_summary；AU03-I3 | `MemoryRecallRepo`、`TraceSummaryView` | workspace_context / real_loop tests | `au03-context-source-ui`、`au09-au03-session-memory-layering` | 已验收 | 完整 lifecycle 归 AU-09 | cross-reference | P1 | AU-09 owner |
| SC-AU03-A4 行为上下文 | open behavior / pending confirmation 进入 context | behavior_summary | `WorkspaceContext` 预留字段 | 无完整闭环 | 无 | 未实现 | `behavior_summary` 仍为 nil | 补实现 | P1 | AU-04/AU-06 owner |
| SC-AU03-B1 空作品不编造 | 无作品事实时诚实说明不知道，不自动表单化 | AU03-I2 | `ContextAssembler.safe_fetch/4` | empty context tests | 无真实 UI/LLM | 已测试 | 无 | 补验收 | P1 | empty-context UI/LLM |
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
| SC-AU03-F2 replay 不调 LLM | 历史回放使用 TurnResult/trace，不重新创作 | Replay contract；AU03-I5 | `ReplayService` | E2E reply-only replay | 无会话级真实 UI | 已测试 | 会话级 replay UI 未闭环 | 补实现 | P1 | AU-07 replay owner |

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
| P1 | SC-AU03-A4 behavior summary 未接入 | Owner：AU-04/AU-06。恢复路径：在行为生命周期文件内补 open behavior / pending confirmation context、trace 和真实 UI evidence。 |
| P1 | SC-AU03-B1/B2/B3 empty/work-only/failure UI/LLM 矩阵不足 | Owner：AU-03 后续或 AU-11 missing context。恢复路径：补 Work-only context test、empty-context real UI、fault-injection UI/LLM driver。 |
| P1 | SC-AU03-D2/E1 显式 archived source 引用与来源标注不足 | Owner：AU-07/AU-09。恢复路径：补显式引用历史/归档 source 的 prompt + trace + author-safe summary。 |
| P1 | SC-AU03-E2/F2 developer trace 与会话级 replay UI 未闭环 | Owner：AU-07。恢复路径：在 trace/replay 文件内补 author/developer 双视图、旧 turn 查询和 replay no-provider UI。 |
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
git diff --check
bash scripts/task_done.sh --skip-static-scan
bash scripts/ai_static_scan.sh --top 10
node scripts/task_done_check.mjs
```

结果：

- 后端 AU-03 相关测试：76 tests / 0 failures。
- real-loop integration：6 tests / 0 failures。
- 前端 AU-03/native verifier 相关测试：142 tests / 0 failures。
- `quality_manifest_check.sh`：passed；warning 均为其它 slice 缺 manifest，AU-03 manifest 已存在。
- 8 个默认 Tauri driver 均 passed：`au03-session-new-active`、`au03-session-history-readonly`、`au03-branch-from-history`、`au03-archive-session-filter`、`au03-current-work-context-ssot`、`au03-context-source-ui`、`au03-long-session-compression`、`au09-au03-session-memory-layering`。
- `au03-current-work-context-ssot --real-lmstudio` passed；quality acceptance 的 LM Studio provider 变体也 passed。
- 7 个 AU-03 quality acceptance 入口均 passed。
- 额外尝试的 `au03-long-session-compression --real-lmstudio` 未计入当前验收：本轮真实 provider 调用已完成，但外部 UI evidence 等待 `slice_verify.ui_state.done` 超时，未生成可引用 `summary.json`。当前 AU-03 文件级证据只使用默认 Tauri `au03-long-session-compression`。
- `git diff --check`：passed。
- `task_done.sh --skip-static-scan` / `task_done_check.mjs`：manifest ok。
- `ai_static_scan.sh --top 10`：17 passed / 1 failed；唯一 Top 10 是既有 gitleaks `generic-api-key` accepted_risk，`blocking=0`、`touched=0`，不命中本轮文件。

## 7. 退出结论

AU-03 满足文件级退出标准：

1. 20 个场景均有可信对账矩阵。
2. P0 已关闭。
3. P1 已登记 owner 与恢复路径：AU-04/AU-06 负责 behavior summary，AU-07 负责 replay/developer trace，AU-09/AU-07 负责显式 archived/source 引用，AU-03/AU-11 后续可补 empty/work-only/failure UI/LLM 矩阵。
4. 已实现场景均有局部测试证据；承重上下文主链有外部 Tauri 真实页面证据，关键 current-work/context SSOT 有 real LM Studio 证据。
5. AU-03 quality manifest、slice driver、summary artifact、验收 README、SCENARIO-BLUEPRINT 和项目台账口径一致。
6. 本文件补齐 tasks/slices 文件级收口入口。

当前可进入下一个验收文件：`docs/design/acceptance/author/AU-04-execute-and-confirm.md`。
