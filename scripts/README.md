# Scripts Index

本目录是项目内可复跑工程脚本入口。脚本应只服务构建、验收、扫描、开发启动、seed 或调试，不作为设计真源；设计和任务仍登记到 `docs/design/` 与 `tasks/`。

## 子目录

| 路径 | 角色 |
|---|---|
| `lib/` | 被多个脚本复用的 shell helper。 |
| `scenario_invariants/` | I1/I2/I3 场景化不变量 driver。 |

## 顶层脚本

| 文件 | 角色 |
|---|---|
| `adr_trace.exs` | ADR 引用追踪辅助脚本。 |
| `ai_static_scan.sh` | AI 静态扫描统一入口。 |
| `ai_static_scan_report.mjs` | 静态扫描报告生成器。 |
| `arch_check.exs` | Umbrella 架构边界检查。 |
| `before-tauri-dev.sh` | Tauri `beforeDevCommand` 启动 Vite 的入口。 |
| `build_sidecar.sh` | Tauri sidecar 构建辅助。 |
| `check_coverage.sh` | 覆盖率检查入口。 |
| `check_design_trace.sh` | 前端组件设计追溯检查。 |
| `dev.sh` | 本地开发启动入口。 |
| `dogfood_run.sh` | 狗粮运行入口。 |
| `e2e_01_full_chain_check.sh` | E2E-01 聚合检查脚本。 |
| `frontend_audit.sh` | 前端依赖、Tauri 配置和桌面约束审计。 |
| `grep_turn.sh` | 按 turn 检索日志/证据辅助。 |
| `grep_workspace.sh` | 按 workspace 检索日志/证据辅助。 |
| `lint_enum_literals.exs` | 枚举字面量 lint 辅助。 |
| `macos_cgevent_local_secret_file_driver.swift` | macOS 本地 secret 文件 UI 驱动辅助。 |
| `next_task_check.mjs` | `tasks/NEXT.md` 唯一 next 和队列完整性检查。 |
| `quality_accept.sh` | quality acceptance 统一入口。 |
| `quality_manifest_check.sh` | quality manifest 一致性检查。 |
| `seed_au03_context_source_ui.exs` | AU-03 context source UI 验收 seed。 |
| `seed_au03_current_work_context_ssot.exs` | AU-03 当前作品上下文 SSOT seed。 |
| `seed_au03_long_session_compression.exs` | AU-03 长会话压缩 seed。 |
| `seed_au03_session_history_readonly.exs` | AU-03 历史会话只读 seed。 |
| `seed_au04_confirmation_ttl_ui.exs` | AU-04 confirmation TTL UI seed。 |
| `seed_au04_cross_work_confirmation_guard.exs` | AU-04 跨作品 confirmation guard seed。 |
| `seed_au04_disabled_confirmation_action_ui.exs` | AU-04 disabled confirmation action seed。 |
| `seed_au04_history_confirmation_readonly.exs` | AU-04 历史 confirmation 只读 seed。 |
| `seed_au04_latest_context_rebase_confirmation.exs` | AU-04 latest context rebase confirmation seed。 |
| `seed_au05_canon_conflict_recovery.exs` | AU-05 canon conflict recovery seed。 |
| `seed_au05_conflict_cross_work_recovery.exs` | AU-05 跨作品 conflict recovery seed。 |
| `seed_au05_stale_conflict_cross_work_freshness.exs` | AU-05 stale conflict freshness seed。 |
| `seed_au09_archive_real_data.exs` | AU-09 档案真实数据 seed。 |
| `seed_au09_archive_stats_current.exs` | AU-09 当前档案统计 seed。 |
| `seed_au09_au03_session_memory_layering.exs` | AU-09/AU-03 session memory layering seed。 |
| `seed_au09_cross_work_memory_isolation.exs` | AU-09 跨作品记忆隔离 seed。 |
| `seed_au09_memory_recall_context.exs` | AU-09 记忆召回上下文 seed。 |
| `seed_au09_validity_window.exs` | AU-09 validity window seed。 |
| `seed_au11_quality_diagnosis_message_envelope.exs` | AU-11 质量诊断消息 envelope seed。 |
| `seed_au12_work_profile_status_isolation.exs` | AU-12 作品档案状态隔离 seed。 |
| `seed_e2e_01_readonly_tool_trace.exs` | E2E-01 只读工具 trace seed。 |
| `seed_p1_chapter_draft_generation.exs` | P1 章节正文草稿生成 seed。 |
| `seed_p1_prose_execution_brief.exs` | P1 prose execution brief seed。 |
| `seed_p1_prose_quality_evaluator_degrade.exs` | P1 prose quality evaluator degrade seed。 |
| `seed_p1_prose_revision_candidate.exs` | P1 prose revision candidate seed。 |
| `seed_stage_startup_context.exs` | stage startup context seed。 |
| `slice_verify.sh` | legacy/browser slice verify 入口。 |
| `slice_verify_server.exs` | slice verify server 辅助入口。 |
| `smoke_test.sh` | smoke test 入口。 |
| `stage.sh` | stage 桌面启动入口。 |
| `task_done.sh` | 任务完成统一门禁入口。 |
| `task_done_check.mjs` | task-done manifest 与 UI evidence 检查。 |
| `tauri_slice_verify.sh` | 真实 Tauri slice verify 入口。 |
| `verify_stage_process_ownership.sh` | stage/Tauri 进程 ownership 验收脚本。 |
| `walkthrough_template.ts` | 产品体验走查脚本模板。 |
