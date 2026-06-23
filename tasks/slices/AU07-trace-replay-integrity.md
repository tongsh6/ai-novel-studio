# AU07 Trace Replay Integrity

- 状态：checkpoint closed / AU-07 file-level closed
- 类型：Acceptance / Trace / Replay
- 启动日期：2026-06-21
- 来源：`docs/design/acceptance/author/AU-07-trace-and-replay.md`、`docs/design/contracts/VS-06-replay-surface-contract-pack.md`、`docs/design/06-memory-context-and-trace.md`

## 1. 开工检查

- Contract：VS-06 ReplayReport、ADR-0014 Trace Redaction、ADR-0017 ReplayReport、`DecisionTrace.event_order`、`tool_trace_refs`、`behavior_trace_refs`、`state_trace_refs`、`ReplayReport.missing_trace_refs/result_status`。
- Invariant：Replay 不调用 provider；缺关键 Tool / Behavior / State trace refs 时不得标 complete；author-safe surface 不展示 raw prompt / provider raw / hidden policy / debug / trace id / context id。
- Boundary：本 checkpoint 修改 `novel_domain`、`novel_application`、`novel_persistence` 的 replay/trace refs 与外部 Tauri harness；不修改 production provider runtime，不新增验收感知 UI/后端逻辑。
- Consumer：`ReplayService.build_report/1`、`TraceRepository`、`TraceReplayService`、真实工作台 `WorkspaceChat` why dialog、后续 developer/多类型 replay UI。
- Proof：`mix test apps/novel_application/test/novel_application/replay_service_test.exs ...`、`mix test apps/novel_persistence/test/novel_persistence/trace_repository_test.exs`、`pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs src/lib/__tests__/traceSummaryView.test.ts`、`bash scripts/quality_accept.sh au07-trace-why-entry --surface tauri`。
- Acceptance Driver：`bash scripts/tauri_slice_verify.sh au07-trace-why-entry` 从真实 Tauri 工作台发送普通创作讨论并点击消息旁“为什么”，验证 author-safe dialog、不重调模型、不写生产状态。产品代码未新增验收感知逻辑。

## 2. 本 checkpoint 关闭的缺口

| 缺口 | 处理 |
|---|---|
| AU07 why 入口历史 artifact 不在当前 runnable list | `au07-trace-why-entry` 已挂回 `scripts/tauri_slice_verify.sh --list`、quality manifest 和 verifier 正例测试 |
| ReplayService 硬编码 no production write | 已改为消费 tool/behavior/state refs；缺关键 refs 时 `missing_trace_refs` 非空并返回 `partial` |
| Tool/Behavior/State refs 无持久字段 | `decision_traces` 新增 nullable `tool_trace_refs`、`behavior_trace_refs`、`state_trace_refs` |

## 3. 文件级状态

本 checkpoint 当时只关闭 trace why 入口和 ReplayService refs/partial 基础设施；后续 `AU07-state-trace-adoption-replay` 与 `AU07-behavior-trace-terminal-replay` 已继续关闭文件级 P0。当前 AU-07 可进入 AU-08。

| 原文件级 P0 | 当前状态 |
|---|---|
| Behavior terminal replay | 已由 `au07-behavior-trace-terminal-replay` 关闭；旧 turn UI/API 归 P1 后续 |
| StateTrace / adoption / projection replay | 已由 `au07-state-trace-adoption-replay` 关闭；旧 turn UI/API 归 P1 后续 |

P1：developer 双视图权限、多类型 replay UI、reason catalog、ToolTrace 独立 registry snapshot。普通旧 turn trace 查询 API/UI 已由 `au07-persisted-trace-query` 关闭，partial replay UI 已由 `au07-partial-replay-ui` 关闭，work/session/turn scoped negative matrix 已由 `au07-trace-query-scope-negative-matrix` 关闭；旧 workspace_id 迁移细化登记为 P2。

## 4. 验证

- [x] `mix format --check-formatted apps/novel_domain/lib/novel_domain/decision_trace.ex apps/novel_application/lib/novel_application/trace_writer.ex apps/novel_application/lib/novel_application/replay_service.ex apps/novel_application/lib/novel_application/dialogue_gateway.ex apps/novel_application/test/novel_application/replay_service_test.exs apps/novel_persistence/lib/novel_persistence/schemas/decision_trace_record.ex apps/novel_persistence/test/novel_persistence/trace_repository_test.exs apps/novel_persistence/priv/repo/migrations/20260621000001_add_replay_trace_refs_to_decision_traces.exs`
- [x] `mix test apps/novel_application/test/novel_application/replay_service_test.exs apps/novel_application/test/novel_application/behavior_lifecycle_test.exs apps/novel_application/test/novel_application/dialogue_gateway_test.exs`
- [x] `mix test apps/novel_persistence/test/novel_persistence/trace_repository_test.exs`
- [x] `pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs src/lib/__tests__/traceSummaryView.test.ts`
- [x] `bash scripts/tauri_slice_verify.sh au07-trace-why-entry`
- [x] `bash scripts/quality_accept.sh au07-trace-why-entry --surface tauri`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/task_done.sh --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`

## 5. 决策日志

- 2026-06-21 — AU-07 不再把历史 `au07-trace-why-entry` artifact 当作当前 runnable truth。已补回 `tauri_slice_verify` / quality manifest 并复跑。
- 2026-06-21 — ReplayService 只在 trace refs 存在时解释 Tool / Behavior / State chain；缺 refs 时必须 partial，不允许用默认文案伪造完整 replay。
- 2026-06-21 — 本 checkpoint 当时不把 AU-07 标文件级完成；随后 `au07-state-trace-adoption-replay` 与 `au07-behavior-trace-terminal-replay` 已关闭文件级 P0，AU-07 当前可进入 AU-08。
- 2026-06-21 — `ai_static_scan --top 10` 当前剩余 Top 10 为历史 gitleaks accepted risk；本 checkpoint touched-file finding 为 0。
