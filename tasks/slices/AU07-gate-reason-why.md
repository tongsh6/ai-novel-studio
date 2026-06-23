# AU07 Gate Reason Why

- 状态：checkpoint closed（SC-AU07-A2 closed）
- 类型：Acceptance / Trace Replay / Tauri Slice
- 日期：2026-06-22
- Primary acceptance file：`docs/design/acceptance/author/AU-07-trace-and-replay.md`
- Affected acceptance files：`docs/design/acceptance/author/AU-01-chat.md`、`docs/design/acceptance/e2e/E2E-01-full-chain.md`

## 1. 开工检查

- Contract：AU-07 SC-A2/B3、VS-06 ReplayReport、ADR-0014 trace redaction、ADR-0017 no-provider replay、E2E-01 E4 action_scope downgrade。
- Invariant：作者视图必须解释降级 gate，但不能展示 raw prompt、provider raw log、debug、internal gate code；why/replay 不能重新调用 provider，不能写作品事实。
- Boundary：外部 Tauri driver 点击真实档案入口「发起综合修订」和消息流「为什么」；产品实现只补持久 replay summary 的白名单 gate 字段，不新增验收专用 DOM hook、env/query/localStorage 或 autorun。
- Consumer：`WorkspaceChat` why dialog、`TraceReplayService` / `TraceReplayController`、AU-01 D1 与 E2E-01 E10 cross-reference。
- Proof：`mix test apps/novel_application/test/novel_application/trace_replay_service_test.exs apps/novel_web/test/novel_web/controllers/trace_replay_controller_test.exs`、`pnpm --dir frontend exec vitest run src/lib/__tests__/traceSummaryView.test.ts slice-verify/native-tauri-verifier.test.mjs`、`bash scripts/quality_accept.sh au07-gate-reason-why --surface tauri --provider lmstudio`。
- Acceptance Driver：`scripts/tauri_slice_verify.sh au07-gate-reason-why --provider lmstudio`，通过 `quality_accept` 路由执行并写入 `artifacts/slice-verify/au07-gate-reason-why-tauri-lmstudio/summary.json`。

## 2. 结果

`au07-gate-reason-why` 已通过真实 Tauri + real LM Studio 验收。driver 从真实工作台打开档案概览，点击「发起综合修订」，等待多步 MicroPlan 被 Orchestrator 在 `action_scope` 降级；随后点击真实消息流的「为什么」，验证弹窗显示：

- “降级为对话”；
- “系统先评估了执行计划，再按权限和范围决定是否继续。”；
- “当前请求超出本轮可执行范围。”；
- no-provider replay 文案；
- 无 raw prompt / provider raw / hidden policy / debug / internal gate code。

首次验收失败暴露真实缺口：持久 replay summary 覆盖当前 turn summary 后丢失 `first_blocking_gate`。修复为 `TraceReplayService` 从白名单 `no_write_reason` 恢复 `first_blocking_gate`，前端继续使用既有 `copy.ts` / `traceSummaryView.ts` author-safe gate 映射。

## 3. 证据

| 证据 | 路径 |
|---|---|
| summary | `artifacts/slice-verify/au07-gate-reason-why-tauri-lmstudio/summary.json` |
| screenshot | `artifacts/slice-verify/au07-gate-reason-why-tauri-lmstudio/au07-gate-reason-why-external-ui.png` |
| app log | `artifacts/slice-verify/au07-gate-reason-why-tauri-lmstudio/app-log.json` |
| websocket frames | `artifacts/slice-verify/au07-gate-reason-why-tauri-lmstudio/ui-frames.json` |
| LM Studio log | `artifacts/slice-verify/au07-gate-reason-why-tauri-lmstudio/lmstudio-log.json` |

Summary 关键字段：`decision_type=downgrade_to_dialogue`、`first_blocking_gate=action_scope`、`provider=lmstudio`、`request_count=2`、HTTP 200、behavior=`gate_downgrade_why_explains_action_scope_without_raw_leak`。

## 4. 剩余缺口

本 checkpoint 不关闭完整 reason catalog、developer code 双视图、developer 权限边界、多类型 replay UI 或完整 ToolTrace registry snapshot。这些继续登记在 `AU07-file-level-closure.md` 的 P1 follow-up。
