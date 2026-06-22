# AU09 File-Level Closure

- 状态：done
- 类型：Acceptance Slice / Memory Governance Slice / Trace Slice
- 启动日期：2026-06-21

## 1. 用户 / 系统目标

把 `docs/design/acceptance/author/AU-09-story-memory.md` 从“多个 checkpoint closed 但文件级未收口”的旧口径推进到文件级可交付状态。当前工作不把历史 `artifacts/slice-verify` 当作唯一真相，而是以 `scripts/tauri_slice_verify.sh --list` 中可复跑的 AU-09 入口、quality manifest 和局部测试共同对账。

## 2. 开工检查

- Contract: `docs/design/acceptance/author/AU-09-story-memory.md`；`docs/design/06-memory-context-and-trace.md`；`docs/design/domain/21-novel-object-model.md`；AU-03 context 分层；AU-07 author-safe trace；AU-05 adoption boundary；新增 `quality/acceptance/scenarios/au09-*.yml`。
- Invariant: pending selection 不等于 adoption；只有 confirmed/stabilized 且 recallable 的当前 Work 记忆能进入普通 recall；locked 记忆可引用但不可被静默改写；deprecated/archived 不召回；effective window 影响 recall；active session、historical session、current work 和 governed memory 必须分层。
- Boundary: 本 checkpoint 只改 docs、quality manifest 和 tasks 索引。生产 `frontend/src`、umbrella runtime、provider/runtime 边界、scenario invariant 脚本不改；不新增验收 env/query/localStorage/DOM hook；不把 fixture provider 注册进 production runtime。
- Consumer: `bash scripts/quality_accept.sh au09-* --surface tauri`；AU-09 文件级审计矩阵；`docs/design/acceptance/README.md` / `SCENARIO-BLUEPRINT.md` 的滚动闭环状态。
- Proof: 8 个当前可复跑 Tauri driver；`bash scripts/quality_manifest_check.sh`；`bash scripts/task_done.sh --skip-static-scan && node scripts/task_done_check.mjs`；`bash scripts/ai_static_scan.sh --top 10`。本 checkpoint 不触及 TurnResult/tool/artifact/adoption 主链代码，因此不新增 I1/I2/I3 要求；若后续改主链代码再补跑。
- Acceptance Driver: `au09-memory-create-recall`、`au09-memory-management-entry`、`au09-memory-trace-roundtrip`、`au09-adopt-setting-recall`、`au09-character-dossier-roundtrip`、`au09-validity-window-recall`、`au09-cross-work-memory-isolation`、`au09-au03-session-memory-layering`。产品代码新增验收感知逻辑：no。

## 3. 涉及范围

| Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation / novel_domain / novel_agent / novel_application / novel_persistence / novel_web | no | 本 checkpoint 不改生产后端 |
| frontend/src | no | 不改生产 UI |
| frontend/slice-verify | no | 复用当前 8 个 AU-09 driver/verifier |
| quality | yes | 新增 AU-09 quality manifests 并登记总表 |
| docs/design | yes | 更新 AU-09 文件级矩阵、蓝图和 acceptance README |
| tasks | yes | 新增本文件并更新 slice 索引 / NEXT |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 审计 AU-09 验收文件、蓝图、slice、Tauri list 和 artifacts | done | 当前可复跑入口为 8 个 `au09-*`；`au09-archive-real-data` / `au09-memory-recall-context` 仅作为历史背景 |
| T2 | 新增 AU-09 quality manifests 并登记索引 | done | 8 个当前 Tauri 入口已挂入 `quality_accept` |
| T3 | 重写 AU-09 文件级场景矩阵与 P0/P1/P2 缺口分级 | done | AU-09 当前 10/14 已验收、1/14 已测试、3/14 部分实现，P0=0 |
| T4 | 同步 SCENARIO-BLUEPRINT、acceptance README、ledger 和 slice 索引 | done | 当前按用户指定顺序可进入 AU-10 |
| T5 | 复跑真实 Tauri / quality acceptance 与质量门禁 | done | 8 个 AU-09 quality acceptance 已通过；task_done/static scan 见 §7 |

## 5. 当前退出判断

- P0：已关闭。当前 8 个真实 Tauri / quality 入口覆盖核心记忆创建/确认/召回、生命周期终态、author-safe trace、伏笔/规则 adoption、角色主档案、有效期窗口、跨作品隔离和 AU-03 会话/记忆分层。
- P1：管理页筛选/分页深矩阵、完整 archive stats current driver、pending inbox、developer replay、历史旧 turn 查询、Channel 管理入口、完整独立 MemoryTrace/StateTrace 表、角色 CP2 字段/关系/演化层。
- P2：Phase 0 记忆管理 UI 的正式 Pencil 追溯、scene-level window / ranking 深化、更多空态/错误态组合。

## 6. 二轮剩余缺口矩阵（2026-06-22）

本轮不推翻 2026-06-21 文件级可交付结论，只复核已登记的 P1/P2、external blocker 和 cross-reference。二轮复跑的当前证据为 8 个 AU-09 quality/Tauri 入口：`au09-memory-create-recall`、`au09-memory-management-entry`、`au09-memory-trace-roundtrip`、`au09-adopt-setting-recall`、`au09-character-dossier-roundtrip`、`au09-validity-window-recall`、`au09-cross-work-memory-isolation`、`au09-au03-session-memory-layering`，均通过。AU-09 当前没有 external platform blocker。

| 场景 ID / 名称 | 第一轮状态 | 剩余缺口描述 | 缺口类型 | 优先级 | 当前证据 | 需要补的实现或验收 driver | 是否应在 AU-09 本轮关闭 | 建议 checkpoint / slice | 是否满足继续到 AU-10 的二轮退出标准 |
|---|---|---|---|---|---|---|---|---|---|
| SC-AU09-A1 打开档案看到真实作品全貌 | 部分实现 | 概览 stats/detail 曾有历史 artifact，但未挂回当前 quality/Tauri driver；不能把历史 `au09-archive-real-data` 当 current runnable truth | 验收缺口 | P1 | 当前可复跑证据覆盖角色/伏笔/规则、跨作品隔离和 TOC cross-reference，不覆盖完整 stats 矩阵 | 新增 `au09-archive-stats-current`，或把 stats/detail 断言并入现有 cross-work archive driver | 否；保留 AU-09 后续 checkpoint，不阻塞本轮退出 | `AU09-archive-stats-current` | 是，P1 已登记且不影响 governed memory 主链 |
| SC-AU09-A2 分类浏览大纲、角色、伏笔、规则 | 已验收 | 无本轮剩余缺口；大纲证据继续 cross-reference AU-08 reading drivers | 无 | done | `au09-character-dossier-roundtrip`、`au09-adopt-setting-recall`、`au09-cross-work-memory-isolation`、AU-08 reading drivers | 保持回归即可 | 否，已关闭 | 已挂入 AU-09 / AU-08 quality | 是 |
| SC-AU09-A3 待采纳设定不混入已确认设定 | 部分实现 | pending 当前仍是 turn/resume 视图，缺持久 adoption inbox 与 pending archive view 恢复矩阵；采纳前不入事实已由 AU-05/AU-09 证据覆盖 | 产品/验收缺口；cross-owner | P1 | `au09-adopt-setting-recall` 证明采纳后才进入 governed memory；AU-05/AU-02/AU-08 证据证明未采纳不入事实/阅读 | AU-05 持久 adoption inbox + AU-09 pending archive view driver | 否；owner 跨 AU-05/AU-09，当前 governed memory 主链不阻塞 | `AU05-persistent-adoption-inbox` + `AU09-pending-archive-view` | 是，边界已登记且不误标已验收 |
| SC-AU09-A4 面板内采纳设定进入真实记忆 | 已验收 | 无本轮剩余缺口 | 无 | done | `au09-adopt-setting-recall` 通过，summary 记录伏笔/规则 adoption、archive tab 可见、后续 recall/why | 保持 quality 回归 | 否，已关闭 | `AU09-archive-memory-roundtrip` | 是 |
| SC-AU09-B1 打开记忆管理页面并读取当前作品记忆 | 已验收 | Phase 0 UI 正式 Pencil 追溯仍是 P2 | 设计追溯 | P2 | `au09-memory-create-recall`、`au09-memory-management-entry` | 后续补设计 trace，不改变当前验收状态 | 否，P2 后续 | UI design trace follow-up | 是 |
| SC-AU09-B2 筛选、搜索、排序当前作品设定 | 已测试 | 后端 repo/controller 已测，缺真实页面 filter/search/sort/pagination 深矩阵 | 验收缺口 | P1 | `MemoryManagementRepo.list/2` 等局部测试；当前 Tauri 只覆盖入口/生命周期，不覆盖全 filter 矩阵 | 新增 `au09-memory-management-filter-matrix` Tauri driver | 否；本轮不扩深矩阵，不阻塞核心 recall/lifecycle 出口 | `AU09-memory-management-filter-matrix` | 是，P1 明确登记 |
| SC-AU09-B3 作者新建一条设定 | 已验收 | 字段校验错误 UX 深矩阵未覆盖 | 验收缺口 | P2 | `au09-memory-management-entry`、`au09-memory-create-recall` | 后续补错误态/校验 UX driver | 否，P2 后续 | 管理页错误态矩阵 | 是 |
| SC-AU09-C1 草稿确认后才成为可召回设定 | 已验收 | 无本轮剩余缺口 | 无 | done | `au09-memory-create-recall`、`au09-memory-management-entry`、`au09-memory-trace-roundtrip` | 保持 quality 回归 | 否，已关闭 | 已挂入 AU-09 quality | 是 |
| SC-AU09-C2 废弃/归档设定不再召回 | 已验收 | 无本轮剩余缺口 | 无 | done | `au09-memory-management-entry`、`au09-memory-trace-roundtrip` | 保持 quality 回归 | 否，已关闭 | 已挂入 AU-09 quality | 是 |
| SC-AU09-C3 锁定设定可引用但不可自动改写 | 已验收 | 自动内容改写生产链路当前不存在；未来出现真实消费者后需补 locked overwrite 反证 | 后续深化 | P2 | `au09-memory-management-entry`、`au09-memory-trace-roundtrip`，以及 locked protected fields 局部 guard | 等真实自动治理/改写消费者出现后补专项验收 | 否，P2 后续 | `AU09-locked-overwrite-negative` | 是 |
| SC-AU09-C4 章节/场景有效期影响召回 | 已验收 | 当前是章节级窗口；scene-level、ranking/降权解释未做 | 产品深化 | P2 | `au09-validity-window-recall` | 后续补 scene-level window / ranking driver | 否，P2 后续 | validity window CP2 | 是 |
| SC-AU09-D1 已确认设定进入主链 context 和 prompt | 已验收 | 无本轮剩余缺口 | 无 | done | `au09-memory-create-recall`、`au09-adopt-setting-recall`、`au09-validity-window-recall`、`au09-cross-work-memory-isolation` | 保持 quality 回归 | 否，已关闭 | 已挂入 AU-09 quality | 是 |
| SC-AU09-D2 记忆引用可溯源 | 部分实现 | author-safe lifecycle/reference trace 已闭环；developer replay、历史旧 turn 查询、完整独立 MemoryTrace/StateTrace 聚合未闭环 | Trace/replay 缺口；cross-owner | P1 | `au09-memory-trace-roundtrip`；why 来源来自 `au09-memory-create-recall` / `au09-adopt-setting-recall`；AU-07/E2E 已覆盖部分 replay cross evidence | AU-07 旧 turn trace 查询 API/UI + AU-09 trace 聚合 follow-up | 否；owner 与 AU-07 共管，当前 author-safe 主链不阻塞 | `AU07-old-turn-trace-query` + `AU09-memory-state-trace-aggregate` | 是，P1 已登记且不误写为完整 trace |
| SC-AU09-D3 与 AU-03 最新作品背景和作品内会话分层一致 | 已验收 | 无本轮剩余缺口 | 无 | done | `au09-au03-session-memory-layering`、`au03-current-work-context-ssot` cross-reference | 保持 quality 回归 | 否，已关闭 | `AU09-AU03-session-memory-layering` | 是 |

二轮退出判断：AU-09 本轮无需要先关闭的新增 P0/P1；现有 P1/P2 均已明确 owner、证据边界和恢复路径。当前文件满足进入 AU-10 的二轮退出标准。

## 7. 验证

- [x] `bash scripts/quality_accept.sh au09-memory-create-recall --surface tauri`
- [x] `bash scripts/quality_accept.sh au09-memory-management-entry --surface tauri`
- [x] `bash scripts/quality_accept.sh au09-memory-trace-roundtrip --surface tauri`
- [x] `bash scripts/quality_accept.sh au09-adopt-setting-recall --surface tauri`
- [x] `bash scripts/quality_accept.sh au09-character-dossier-roundtrip --surface tauri`
- [x] `bash scripts/quality_accept.sh au09-validity-window-recall --surface tauri`
- [x] `bash scripts/quality_accept.sh au09-cross-work-memory-isolation --surface tauri`
- [x] `bash scripts/quality_accept.sh au09-au03-session-memory-layering --surface tauri`
- [x] `bash scripts/quality_manifest_check.sh`（passed；仍有既有非 AU-09 manifest warning）
- [x] `bash scripts/task_done.sh --skip-static-scan --slice au09-memory-create-recall && node scripts/task_done_check.mjs`
- [x] `bash scripts/ai_static_scan.sh --top 10`（17 passed / 1 failed；唯一 Top 10 为历史 gitleaks `accepted_risk`，0 touched-file finding，blocking=0）

## 8. 决策日志

- 2026-06-21 — 文件级审计不再沿用 `0/14 完整真实前后端验收` 的旧覆盖率口径。当前可复跑证据以 `tauri_slice_verify.sh --list` 中 8 个 AU-09 slice 为准；历史 artifact 只用于说明演进背景。
- 2026-06-21 — 本 checkpoint 不补生产代码。当前必要实现是把可复跑 AU-09 场景纳入 quality manifest、收口文件级矩阵，并把剩余 replay/Channel/设计追溯降为明确 P1/P2。
- 2026-06-21 — 8 个 AU-09 quality acceptance 已全部通过。AU-09 文件级 P0 关闭；下一验收文件按用户指定顺序进入 AU-10。
- 2026-06-22 — 二轮缺口收敛不回退文件级可交付结论。8 个 AU-09 quality/Tauri 入口串行复跑通过；SC-AU09-A1/A3/B2/D2 继续按 P1/P2 或 cross-owner 登记，当前无 AU-09 本轮必须关闭的 P0/P1，可进入 AU-10。
