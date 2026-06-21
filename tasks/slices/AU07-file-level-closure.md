# AU07 File-Level Closure

- 状态：file-level deliverable（P0 replay producers closed；P1 follow-up registered）
- 类型：Acceptance / Trace Replay / Tauri Slice
- 启动日期：2026-06-21
- 来源：`docs/design/acceptance/author/AU-07-trace-and-replay.md`、`docs/design/acceptance/SCENARIO-BLUEPRINT.md`、`tasks/slices/AU07-trace-replay-integrity.md`、`tasks/slices/AU07-state-trace-adoption-replay.md`、`tasks/slices/AU07-behavior-trace-terminal-replay.md`

## 1. 开工检查

- Contract: VS-06 ReplayReport、VS-03 Behavior lifecycle、ADR-0014 trace redaction、ADR-0017 no-provider replay、`DecisionTrace.tool_trace_refs/behavior_trace_refs/state_trace_refs`、TurnResult `trace_summary`。
- Invariant: author-safe why 不泄露 raw prompt/provider/debug；replay 默认不调用 provider；缺关键 refs 必须 partial；tool/behavior/state replay refs 必须可追溯；cancel waiting 不调用工具、不写 production state、不采纳 artifact。
- Boundary: 文件级收口跨 `novel_application` ReplayService / DialogueGateway、`novel_web` Channel action trace persistence、`novel_persistence` DecisionTrace 持久化、外部 Tauri harness 与 quality manifest；不修改 provider runtime，不新增生产验收感知逻辑。
- Consumer: `WorkspaceChat` why 入口、`TraceRepository`、`ReplayService.build_report/1`、后续旧 turn trace 查询 API/UI。
- Proof: `bash scripts/quality_accept.sh au07-trace-why-entry --surface tauri`、`bash scripts/quality_accept.sh au07-state-trace-adoption-replay --surface tauri`、`bash scripts/quality_accept.sh au07-behavior-trace-terminal-replay --surface tauri`、targeted backend/channel/replay tests、verifier tests、quality/task_done/static scan。
- Acceptance Driver: `scripts/tauri_slice_verify.sh` 的三个 AU-07 场景均由外部 Playwright/Tauri driver 从真实工作台输入、点击、打开 why 或采纳/取消动作，并读取 websocket/log/summary 证据。产品代码未新增验收感知逻辑。

## 2. 文件级对账结论

| 项目 | 结论 |
|---|---|
| 场景总数 | 16 |
| 已验收 | 6 |
| 已测试 | 4 |
| 部分实现 | 6 |
| P0 | 已关闭 |
| P1 | 旧 turn trace 查询 API/UI、developer 双视图权限、完整 ToolTrace registry snapshot、ReplayReport 六问、work/session trace 查询隔离 |
| 是否可进入下一文件 | 是，可进入 AU-08 |

## 3. 文件级 checkpoint

| Checkpoint | 结果 | 证据 |
|---|---|---|
| `au07-trace-why-entry` | closed | `artifacts/slice-verify/au07-trace-why-entry-tauri/summary.json` |
| `au07-state-trace-adoption-replay` | closed | `artifacts/slice-verify/au07-state-trace-adoption-replay-tauri/summary.json` |
| `au07-behavior-trace-terminal-replay` | closed | `artifacts/slice-verify/au07-behavior-trace-terminal-replay-tauri/summary.json` |

`au07-behavior-trace-terminal-replay` 证明：真实工作台出现 confirmation waiting 后，作者点击可见拒绝/取消动作，cancelled action turn 记录 terminal BehaviorTrace close event、`event_turn_ref` 与 `behavior_resolution` ref；ReplayService 可离线解释终态；本路径 no-provider、no-tool、no-production-write。

## 4. 文件级验证

- [x] `bash scripts/tauri_slice_verify.sh au07-trace-why-entry`
- [x] `bash scripts/quality_accept.sh au07-trace-why-entry --surface tauri`
- [x] `bash scripts/tauri_slice_verify.sh au07-state-trace-adoption-replay`
- [x] `bash scripts/quality_accept.sh au07-state-trace-adoption-replay --surface tauri`
- [x] `bash scripts/tauri_slice_verify.sh au07-behavior-trace-terminal-replay`
- [x] `bash scripts/quality_accept.sh au07-behavior-trace-terminal-replay --surface tauri`
- [x] targeted backend / Channel / replay tests
- [x] verifier 单测：`pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/task_done.sh --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`（剩余 Top 10 为历史 `gitleaks` accepted_risk，touched-file finding 0，blocking 0）

## 5. 后续 owner

| 缺口 | Owner | 恢复路径 |
|---|---|---|
| 旧 turn trace 查询 API/UI | AU-07 / AU-10 后续 | 从 `TraceRepository` 查询到 author-safe replay report，再接历史会话/消息 why 入口 |
| developer 双视图权限 | AU-07 / VS-10 | 明确权限边界、redaction profile 和敏感字段隔离后再做 UI |
| 完整 ToolTrace registry snapshot | AU-07 / tool runtime 后续 | 当前只持久化 summary-level refs；后续补 registry version 和 redacted I/O snapshot |
| ReplayReport 六问完整真实入口 | AU-07 / E2E-01 | 用 reply-only、confirmation、tool、adoption、behavior、UI action 组合生成 report，不调 provider |
| work/session trace 查询隔离 | AU-07 / SU-02 / AU-03 | 将 work_id/session_id/turn_id 查询边界固化到 API/UI 验收 |

## 6. 决策日志

- 2026-06-21 — AU-07 文件级退出标准按“P0 replay producer 闭环 + P1 follow-up 登记”执行；不把旧 turn API/UI、developer 双视图和完整六问 replay 伪装成已完成。
- 2026-06-21 — Behavior terminal replay 选择 cancel waiting 作为真实链路，因为它已有真实 confirmation card、server-authorized action、cancelled TurnResult、后续恢复 turn 和 no-tool/no-write 边界。
- 2026-06-21 — `task_done` 已生成 manifest；`ai_static_scan --top 10` 剩余唯一 Top 10 为历史 `gitleaks` accepted_risk，本文件级收口 touched-file finding 为 0，blocking 为 0。
