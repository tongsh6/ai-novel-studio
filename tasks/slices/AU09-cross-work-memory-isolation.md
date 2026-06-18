# AU09 Cross-Work Memory Isolation / 跨作品记忆隔离

- 状态：checkpoint closed
- 类型：Memory Recall Slice + Work Isolation Slice
- 启动日期：2026-06-18
- 所属验收：`docs/design/acceptance/author/AU-09-story-memory.md` SC-AU09-A1 / A2 / B1 / D1 / D3，AU09-GAP-02、AU09-GAP-12；关联 SU-02 / AU-03。
- 所属设计：`docs/design/06-memory-context-and-trace.md` work-scoped memory，`docs/design/acceptance/system/SU-02-work-switching.md` 作品切换隔离。

## 1. 用户 / 系统目标

作者在同一桌面应用里切换作品后，记忆管理页、作品档案伏笔/规则 tab、普通对话 recall 和 why 面板都必须只消费当前 Work 的记忆。另一部作品的伏笔、规则或作者创建的设定不能显示、召回或进入 prompt。

本 slice 不重做记忆生命周期、trace 或有效期窗口。它只把 current work scope 贯穿到真实工作台切换作品后的记忆读写与召回链路。

## 2. 开工检查

- **Contract**：消费 `MemoryItem.work_id`、`WorkspaceContext` current work、`MemoryManagementRepo` list/get/references/recall、`WorkArchiveRepo.foreshadowing/1` / `rules/1`、`TraceSummaryView.context_refs`。
- **Invariant**：
  - 记忆列表、档案伏笔/规则、recall 和 why 只能展示当前 Work 的 memory。
  - 切换作品后，旧作品 memory 不得进入 prompt、TurnResult context refs 或 why 内容。
  - 产品代码不得为了验收读取 slice id、URL query、localStorage 或验收专用 env。
- **Boundary**：
  - `novel_persistence`：复核所有 memory/archive/references 查询按 `work_id` 过滤。
  - `novel_application`：确保 ContextAssembler / WorkspaceContext 使用当前 Work 的 recall 结果。
  - `novel_web`：只通过正式 Channel/REST 输出当前 Work 数据。
  - `frontend`：只通过真实工作台作品切换、档案、记忆页和 why 面板消费数据。
  - **不改** MemoryType enum、不新增验收 hook、不注册 fake provider 到生产 runtime。
- **Consumer**：真实工作台作品切换、作品档案、记忆管理页、普通对话、why 面板。
- **Proof**：
  - 外部 Tauri：新增或收紧 `bash scripts/tauri_slice_verify.sh au09-cross-work-memory-isolation`。seed 两个作品，各自有不同 memory；真实工作台切换到作品 B 后，档案/记忆页只显示 B，发送同时命中 A/B 关键词的消息时只召回 B，why 不出现 A。
  - 后端局部：persistence/application 测试覆盖 list/references/recall/archive read model 的跨 Work 隔离。
- **Acceptance Driver**：外部自动化从真实工作台操作作品切换、打开档案/记忆页、发送消息并打开 why；不新增产品验收感知逻辑。

## 3. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 审计 memory/archive/references 当前 work 过滤 | done | `MemoryManagementRepo` / `MemoryRecallRepo` / `WorkArchiveRepo` 已按 `work_id` 过滤。 |
| T2 | 补缺失的跨 Work 查询 guard 或测试 | done | 补 repo/service foreign memory id 的 get/update/confirm/references not_found 边界测试。 |
| T3 | 新增外部 Tauri seed/driver/verifier | done | `au09-cross-work-memory-isolation` seed 两个 Work，真实菜单 A→B 切换后验证档案、记忆页、recall、why。 |
| T4 | 同步 AU-09 / AU-03 / SU-02 / NEXT / ledger | done | H10 标 checkpoint closed；下一队首转 AU09/AU03 会话记忆分层。 |

## 4. 当前缺口

- 多个后端查询已经按 `work_id` 过滤，但跨作品 UI 切换后的记忆页、档案 tab、recall 和 why 尚未形成一条真实页面证据。
- AU-03 已有 current work context SSOT 证据，但 AU-09 记忆对象还缺专门的 cross-work memory isolation proof。
- 本 checkpoint 不解决 active/historical session 的完整分层，也不做 developer replay。

## 5. 验证计划

- [x] 后端 memory/archive/references 隔离测试：
  `mix test apps/novel_persistence/test/novel_persistence/memory_management_repo_test.exs apps/novel_application/test/novel_application/memory_management_service_test.exs`
- [x] `node --check frontend/slice-verify/external-ui-driver.mjs`
- [x] `node --check frontend/slice-verify/native-tauri-verifier.mjs`
- [x] `bash -n scripts/tauri_slice_verify.sh`
- [x] `cd frontend && pnpm exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/tauri_slice_verify.sh au09-cross-work-memory-isolation`
- [ ] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-18 — `AU09-validity-window-recall` 已复验证明章节有效期窗口参与普通召回；下一 AU09 P0/P1 缺口转为跨作品记忆隔离，避免另一部作品的伏笔/规则污染当前创作上下文。
- 2026-06-18 — checkpoint closed。后端补 foreign memory id 边界测试；外部 Tauri 证据 `artifacts/slice-verify/au09-cross-work-memory-isolation-tauri/summary.json` 证明真实工作台从作品 A 切到作品 B 后，档案伏笔/规则、记忆管理页、ordinary recall 和 why 只消费 B 的 `乙界星钥` / 规则记忆，排除 A 的 `甲界暮钟`。
