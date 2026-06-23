# AU07 Partial Replay UI

- 状态：done
- 类型：Acceptance Slice / Trace Replay / Tauri Slice
- 启动日期：2026-06-22
- Primary Acceptance File: `docs/design/acceptance/author/AU-07-trace-and-replay.md`
- Affected Acceptance Files: AU-01、AU-03、AU-06、AU-09、AU-10、E2E-01

## 1. 用户 / 系统目标

作者回看旧 turn 时，如果持久 trace 缺少关键 replay refs，系统必须诚实显示解释不完整，而不是伪装成完整 replay，也不能重新调用模型或改写作品状态。

## 2. 依赖改序说明

- 原 blueprint 位置：AU-07 二轮后已满足进入 AU-08，但 AU-01/AU-03/AU-06/AU-09/AU-10/E2E-01 均把 partial replay UI 作为 AU-07 cross-reference owner。
- 被提前处理原因：partial replay UI 是跨文件 trace/replay P1，可一次性关闭 SC-AU07-C2，并减少多个文件对旧 partial 缺口的悬挂引用。
- 阻塞场景/文件：SC-AU07-C2；AU-01 D1 replay cross-reference；AU-03 F2 replay；AU-06 behavior replay；AU-09 D2 memory trace；AU-10 E2 trace/why；E2E-01 E10 持久 trace query。
- 回填范围：AU-07 主文件、AU07 file-level closure、acceptance README、SCENARIO-BLUEPRINT、project-ledger、tasks/slices README 和受影响 cross-reference 文件。
- 恢复顺序：本 checkpoint 关闭后，AU-07 仍满足二轮退出标准，恢复蓝图进入 AU-08/AU-09 后续收口顺序。

## 3. 开工检查

- Contract: VS-06 ReplayReport、ADR-0017 no-provider replay、`TraceReplayService.fetch_turn_report/3`、`ReplayService.find_missing_refs/1`、`TraceReplayController` persisted replay API。
- Invariant: missing replay refs 必须返回 `result_status=partial` 且 `missing_trace_refs` 非空；作者 UI 必须提示不完整；replay 默认不调用 provider、不调工具、不写 production state；author-safe 面板不得暴露 raw prompt/provider/debug/trace id。
- Boundary: 仅新增外部 Tauri driver/verifier、service/controller tests、quality manifest 和文档台账；不新增验收专用 production hook、env/query/localStorage、DOM hook 或 runtime provider。
- Consumer: `WorkspaceChat` 旧 turn “为什么”入口、`TraceReplayService`、AU-07 文件级 replay 矩阵，以及 AU-01/AU-03/AU-09/AU-10/E2E cross-reference。
- Proof: `bash scripts/quality_accept.sh au07-partial-replay-ui --surface tauri`、TraceReplayService/controller partial tests、native verifier tests、quality manifest check、task_done/static scan。
- Acceptance Driver: `scripts/tauri_slice_verify.sh au07-partial-replay-ui` 由外部 driver 从真实工作台发送普通 turn，外部 harness 在同一 work/session/turn scope 插入不完整 persisted trace，reload 后点击旧 turn 可见“为什么”，再由 API response、UI 文本、日志和 verifier 断言 partial/no-provider/no-write/no raw leak。

## 4. 实现与证据

| 项 | 当前证据 |
|---|---|
| 外部 driver | `frontend/slice-verify/external-ui-driver.mjs` 注册 `au07-partial-replay-ui` |
| Native verifier | `frontend/slice-verify/native-tauri-verifier.mjs` / `.test.mjs` 断言 partial replay UI |
| Quality manifest | `quality/acceptance/scenarios/au07-partial-replay-ui.yml` 与 `quality/acceptance/scenarios.yml` |
| Service/controller tests | `trace_replay_service_test.exs`、`trace_replay_controller_test.exs` 覆盖 persisted partial |
| Real Tauri evidence | `artifacts/slice-verify/au07-partial-replay-ui-tauri/summary.json`、`ui-state.json`、`partial-trace-insert.json` |

真实验收 summary 记录：

- `replay_report_result_status=partial`
- `replay_report_missing_trace_refs=["turn_result_ref","tool_trace_refs"]`
- `provider_called=false`
- `partial_replay_warning_rendered_in_author_safe_dialog`
- `replay_did_not_call_provider_or_write_state`
- `raw_prompt_provider_debug_not_visible`

## 5. 验证

- [x] `node --check frontend/slice-verify/external-ui-driver.mjs`
- [x] `node --check frontend/slice-verify/native-tauri-verifier.mjs`
- [x] `bash -n scripts/tauri_slice_verify.sh`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `mix format --check-formatted apps/novel_application/test/novel_application/trace_replay_service_test.exs apps/novel_web/test/novel_web/controllers/trace_replay_controller_test.exs`
- [x] `mix test apps/novel_application/test/novel_application/trace_replay_service_test.exs apps/novel_web/test/novel_web/controllers/trace_replay_controller_test.exs`
- [x] `pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs src/lib/__tests__/traceSummaryView.test.ts`
- [x] `bash scripts/quality_accept.sh au07-partial-replay-ui --surface tauri`

## 6. 文件级剩余缺口矩阵

| 场景 ID / 名称 | 原 blueprint 位置 | 本轮处理顺序 | 第一轮状态 | 第二轮状态 | 剩余缺口描述 | 缺口类型 | 优先级 | 当前证据 | 依赖关系与重排理由 | 已补实现或验收 driver | 是否已真实验收 | 回填到哪些验收文件 | 是否仍应在 AU-07 内关闭 | 建议 checkpoint / slice | 是否满足恢复 blueprint 顺序 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SC-AU07-C2 不完整 trace 诚实 partial | AU-07 | 依赖优先提前处理 | 已测试 | 已验收 | partial 作者提示已关闭；corrupt / invalid_trace 负向 UI 可后续补 P2 | closed / P2 follow-up | closed/P2 | `au07-partial-replay-ui-tauri/summary.json` | 多个 AU/E2E 文件引用 partial UI 缺口 | `au07-partial-replay-ui` | 是 | AU-07、AU-01、AU-03、AU-06、AU-09、AU-10、E2E-01 | 否，当前应关项已关闭 | 保持回归；后续 invalid_trace negative UI | 是 |
| SC-AU07-B2 developer 双视图隔离 | AU-07 | 后续 | 部分实现 | 部分实现 | developer path / 权限边界未冻结 | P1 | P1 | `ReplayReport.redaction_profile` 字段存在 | 需要权限 contract，不能由 partial UI 顺手关闭 | 无 | 否 | AU-07、AU-10 | 是，后续 | `AU07-developer-view-boundary` | 是，已登记后续 |
| SC-AU07-D1 ToolTrace registry / redacted I/O | AU-07/E2E | 后续 | 已测试/部分实现 | 部分实现 | summary-level refs 已有，独立 registry snapshot / redacted I/O 未闭合 | P1 | P1 | `e2e-01-readonly-tool-trace`、`e2e-01-replay-report` | 需要 tool runtime / trace registry 设计 | 无 | 否 | AU-07、E2E-01 | 是，后续 | `AU07-tool-trace-replay` | 是，已登记后续 |
| SC-AU07-C3 多类型 replay matrix | AU-07 | 后续 | 部分实现 | 已验收主干 / P1 follow-up | complete/partial 基础已闭合；reply-only、confirmation、adoption、behavior、UI action 的产品内多类型矩阵仍缺 | P1 | P1 | `e2e-01-replay-report`、`au07-partial-replay-ui` | 多类型矩阵依赖 developer/trace registry 设计 | 无 | 否 | AU-07、AU-10、E2E-01 | 是，后续 | `AU07-multi-type-replay-matrix` | 是，已登记后续 |

## 7. 决策日志

- 2026-06-22：本 checkpoint 使用外部 harness 在 test environment 写入不完整 trace，是验收 driver 的前置数据准备，不进入 production runtime，不作为产品自动输入或产品可感知逻辑。
- 2026-06-22：SC-AU07-C2 从已测试改为已验收；AU-07 总口径调整为 11/16 已验收、0/16 已测试、5/16 部分实现。
- 2026-06-22：developer 双视图、多类型 replay、ToolTrace registry snapshot / redacted I/O、work/session negative matrix 和 reason catalog 不随本 checkpoint 伪关闭。
