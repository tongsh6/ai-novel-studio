# AU09 / AU03 Session Memory Layering / 会话与记忆分层

- 状态：checkpoint closed
- 类型：Memory Recall Slice + Session Context Slice
- 启动日期：2026-06-18
- 所属验收：`docs/design/acceptance/author/AU-09-story-memory.md` SC-AU09-D3，AU09-GAP-12；关联 AU-03 current work context / session history。
- 所属设计：`docs/design/06-memory-context-and-trace.md` context source layering，`docs/design/acceptance/author/AU-03-context-memory.md`（若后续补专门章节，以该文档为 AU-03 入口）。

## 1. 用户 / 系统目标

作者在同一作品内可能有 active session、历史只读 session、已归档 session 和 governed memory。AI 生成下一轮内容时必须使用“当前作品最新背景 + 当前 active session transcript + 当前作品可召回 memory”的分层上下文；打开历史会话或从历史会话分支继续时，旧 transcript 不能覆盖当前作品事实，也不能把历史片段伪装成 governed memory。

本 checkpoint 只证明 AU-09 记忆召回与 AU-03 作品内会话分层一致。它不重做跨作品隔离、有效期窗口、记忆生命周期或 developer replay。

## 2. 开工检查

- **Contract**：消费 `WorkSessionService.resume/show/create/archive`、`DialogueContext.context_refs`、`TraceSummaryView.context_refs`、`MemoryRecallRepo.recall/3`、`MemoryItem.work_id/status/recallable`。
- **Invariant**：
  - Active session transcript、historical session transcript、current work snapshot、governed memory 必须作为不同 context source 呈现。
  - 历史只读会话被打开后，返回 active session 的下一轮不能用历史 transcript 覆盖当前 active transcript。
  - 历史 transcript 不能伪装成 `memory` source；governed memory 仍按 status / recallable / validity / work_id 过滤。
  - 产品代码不得为了验收读取 slice id、URL query、localStorage 或验收专用 env。
- **Boundary**：
  - `novel_application`：ContextAssembler / WorkspaceContext / WorkSessionService 分层。
  - `novel_persistence`：session transcript、memory recall 和 reference log 读取。
  - `novel_web`：正式 REST/Channel session 入口和 workspace turn。
  - `frontend`：真实工作台历史会话列表、只读查看、返回 active session、why 面板。
  - **不改** provider runtime、不新增验收 hook、不把历史会话内容写入 governed memory。
- **Consumer**：真实工作台会话历史、普通对话、why 面板、Planner prompt。
- **Proof**：
  - 外部 Tauri：新增或收紧 `bash scripts/tauri_slice_verify.sh au09-au03-session-memory-layering`。seed 同一作品的 active session、historical session 和 confirmed memory；真实工作台打开历史只读会话再返回 active session，发送同时命中历史和 memory 的消息，验证 context/why 分层且 active/current memory 不被历史覆盖。
  - 后端局部：application/persistence 测试覆盖 active/historical session 与 memory source 分层，不把 historical transcript 作为 governed memory。
- **Acceptance Driver**：外部自动化从真实工作台操作历史会话和 why；不新增产品验收感知逻辑。

## 3. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 审计当前 AU-03 session / AU-09 memory 分层实现 | done | 已确认缺口是同场景 source type 分层：active transcript 需要 author-safe `session_transcript`，history 只读 transcript 不能进入普通 context，也不能伪装成 memory。 |
| T2 | 补 application/persistence 分层测试 | done | `context_grounding_test`、`dialogue_gateway_real_loop_test`、`workspace_context_test` 覆盖 active transcript、historical transcript、memory source 不互相伪装。 |
| T3 | 新增外部 Tauri seed/driver/verifier | done | `au09-au03-session-memory-layering` seed 同一 Work 的 active/history/memory；真实工作台历史只读 -> 返回 active -> recall/why 分层。 |
| T4 | 同步 AU-09 / AU-03 / user journeys / ledger | done | 已记录本 checkpoint 证据；AU09 整体仍保留 trace/replay/Channel 管理入口等缺口。 |

## 4. 当前缺口

- `au09-au03-session-memory-layering` 已证明真实工作台打开历史只读会话后，返回 active session 的下一轮 `trace_summary.context_refs` 同时包含 `current_work`、`session_transcript` 和 `memory`，并排除 historical transcript。
- 本 checkpoint 不补完整 developer replay、多类型 replay UI、Channel 管理入口或独立 StateTrace/MemoryTrace 表；普通旧 turn scoped query 与 partial replay UI 已由 AU-07 回填。

## 5. 验证计划

- [x] 后端 session / memory source 分层测试
- [x] `node --check frontend/slice-verify/external-ui-driver.mjs`
- [x] `node --check frontend/slice-verify/native-tauri-verifier.mjs`
- [x] `cd frontend && pnpm exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/tauri_slice_verify.sh au09-au03-session-memory-layering`
- [ ] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-18 — `AU09-cross-work-memory-isolation` 已闭环；下一 AU09 P0/P1 缺口转为 AU-09 governed memory 与 AU-03 active/historical session 分层，避免历史 transcript 覆盖当前作品事实或伪装成记忆来源。
- 2026-06-18 — checkpoint closed。实现将 session-scoped context ref 标为 `session_transcript`，保留 workspace fallback `conversation`；外部 Tauri 证据 `artifacts/slice-verify/au09-au03-session-memory-layering-tauri/summary.json` 证明真实工作台打开历史只读会话后返回 active session，下一轮 context/why 分别展示当前作品背景、当前会话记录和已确认设定，并排除历史 `旧稿赤塔` transcript。
