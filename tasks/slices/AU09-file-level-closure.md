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
| T4 | 同步 SCENARIO-BLUEPRINT、acceptance README、ledger、user journeys、NEXT | done | 当前按用户指定顺序可进入 AU-10 |
| T5 | 复跑真实 Tauri / quality acceptance 与质量门禁 | done | 8 个 AU-09 quality acceptance 已通过；task_done/static scan 见 §6 |

## 5. 当前退出判断

- P0：已关闭。当前 8 个真实 Tauri / quality 入口覆盖核心记忆创建/确认/召回、生命周期终态、author-safe trace、伏笔/规则 adoption、角色主档案、有效期窗口、跨作品隔离和 AU-03 会话/记忆分层。
- P1：管理页筛选/分页深矩阵、完整 archive stats current driver、pending inbox、developer replay、历史旧 turn 查询、Channel 管理入口、完整独立 MemoryTrace/StateTrace 表、角色 CP2 字段/关系/演化层。
- P2：Phase 0 记忆管理 UI 的正式 Pencil 追溯、scene-level window / ranking 深化、更多空态/错误态组合。

## 6. 验证

- [x] `bash scripts/quality_accept.sh au09-memory-create-recall --surface tauri`
- [x] `bash scripts/quality_accept.sh au09-memory-management-entry --surface tauri`
- [x] `bash scripts/quality_accept.sh au09-memory-trace-roundtrip --surface tauri`
- [x] `bash scripts/quality_accept.sh au09-adopt-setting-recall --surface tauri`
- [x] `bash scripts/quality_accept.sh au09-character-dossier-roundtrip --surface tauri`
- [x] `bash scripts/quality_accept.sh au09-validity-window-recall --surface tauri`
- [x] `bash scripts/quality_accept.sh au09-cross-work-memory-isolation --surface tauri`
- [x] `bash scripts/quality_accept.sh au09-au03-session-memory-layering --surface tauri`
- [x] `bash scripts/quality_manifest_check.sh`（passed；仍有既有非 AU-09 manifest warning）
- [x] `bash scripts/task_done.sh --skip-static-scan && node scripts/task_done_check.mjs`
- [x] `bash scripts/ai_static_scan.sh --top 10`（17 passed / 1 failed；唯一 Top 10 为历史 gitleaks `accepted_risk`，0 touched-file finding，blocking=0）

## 7. 决策日志

- 2026-06-21 — 文件级审计不再沿用 `0/14 完整真实前后端验收` 的旧覆盖率口径。当前可复跑证据以 `tauri_slice_verify.sh --list` 中 8 个 AU-09 slice 为准；历史 artifact 只用于说明演进背景。
- 2026-06-21 — 本 checkpoint 不补生产代码。当前必要实现是把可复跑 AU-09 场景纳入 quality manifest、收口文件级矩阵，并把剩余 replay/Channel/设计追溯降为明确 P1/P2。
- 2026-06-21 — 8 个 AU-09 quality acceptance 已全部通过。AU-09 文件级 P0 关闭；下一验收文件按用户指定顺序进入 AU-10。
