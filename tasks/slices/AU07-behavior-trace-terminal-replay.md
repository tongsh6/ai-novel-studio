# AU07 BehaviorTrace Terminal Replay

- 状态：checkpoint closed / AU-07 file-level P0 closed
- 类型：Acceptance / Behavior / Replay
- 启动日期：2026-06-21
- 来源：`docs/design/acceptance/author/AU-07-trace-and-replay.md`、`docs/design/contracts/VS-03-behavior-lifecycle-contract-pack.md`、`docs/design/contracts/VS-06-replay-surface-contract-pack.md`

## 1. 用户 / 系统目标

关闭 AU-07 的 Behavior terminal replay P0：作者在真实工作台遇到 confirmation waiting 后点击可见“拒绝/取消”，系统必须关闭 active behavior，不调用工具、不写作品事实，并在 cancelled action turn 的 `trace_summary.behavior_trace_refs` / persisted `DecisionTrace.behavior_trace_refs` 中记录 terminal close event、closed turn 与 `behavior_resolution` ref，使 ReplayService 能离线解释行为终态。

## 2. 开工检查

- Contract：VS-03 Behavior lifecycle、VS-06 ReplayReport、ADR-0017 ReplayReport、`DecisionTrace.behavior_trace_refs`、TurnResult `behavior_state.history[].resolution_ref`。
- Invariant：terminal behavior close/resolution 必须可追溯；Replay 不调用 provider；cancel waiting 不调用工具、不写 production state、不采纳 artifact。
- Boundary：切穿 `novel_application` 的 `DialogueGateway`/`ReplayService`、`novel_web` 的真实 Channel action turn persistence、外部 Tauri harness 和 quality manifest；不修改 `novel_agent` provider runtime，不新增产品验收感知逻辑。
- Consumer：真实工作台取消等待后的 action TurnResult、`TraceRepository`、`ReplayService.build_report/1`、后续旧 turn trace 查询 API/UI。
- Proof：`mix test apps/novel_application/test/novel_application/dialogue_gateway_test.exs apps/novel_application/test/novel_application/replay_service_test.exs apps/novel_web/test/novel_web/channels/workspace_channel_action_idempotency_test.exs`、`pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`、`bash scripts/tauri_slice_verify.sh au07-behavior-trace-terminal-replay`、`bash scripts/quality_accept.sh au07-behavior-trace-terminal-replay --surface tauri`。
- Acceptance Driver：`bash scripts/tauri_slice_verify.sh au07-behavior-trace-terminal-replay` 使用外部 Playwright/Tauri driver 从真实工作台发起高风险重写请求、点击可见拒绝/取消动作、验证 cancelled turn 的 terminal BehaviorTrace refs。产品代码不新增验收感知逻辑。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改基础枚举 |
| novel_domain | no | 复用既有 BehaviorState / DecisionTrace |
| novel_agent | no | 不改 provider runtime |
| novel_application | yes | `DialogueGateway` 生成 terminal behavior refs；`ReplayService` 暴露 close/resolution refs |
| novel_persistence | no | 复用既有 `decision_traces.behavior_trace_refs` |
| novel_web | yes | generic author_action turn_result 通过 application tracer 持久化 |
| frontend | yes | 仅改外部 slice verifier/driver，不改生产 UI |
| docs/design | yes | 同步 AU-07 文件级矩阵 |
| quality | yes | 新增质量场景 manifest |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | Cancel waiting action turn 生成 terminal behavior trace refs | done | 包含 close event、closed turn、resolution ref |
| T2 | Generic Channel author_action turn_result 持久化 DecisionTrace | done | 通过 `NovelApplication.persistence_tracer/0`，不直接依赖 persistence |
| T3 | ReplayService 暴露 terminal close/resolution refs | done | chain_summary 与 state_explanations 均可见 |
| T4 | 外部 Tauri verifier 验证真实页面 terminal behavior refs | done | `au07-behavior-trace-terminal-replay` |
| T5 | AU-07 文件级矩阵和 ledger 同步 | done | AU-07 文件级 P0 已关闭 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh au07-behavior-trace-terminal-replay`
- [x] 后端 / Channel 局部验证：`mix test apps/novel_application/test/novel_application/dialogue_gateway_test.exs apps/novel_application/test/novel_application/replay_service_test.exs apps/novel_web/test/novel_web/channels/workspace_channel_action_idempotency_test.exs`
- [x] verifier 单测：`pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/quality_accept.sh au07-behavior-trace-terminal-replay --surface tauri`
- [x] `bash scripts/task_done.sh --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`（剩余 Top 10 为历史 `gitleaks` accepted_risk，touched-file finding 0，blocking 0）

## 6. 决策日志

- 2026-06-21 — 本 checkpoint 选择真实工作台 cancel waiting 作为 terminal behavior proof，因为它已有可见 confirmation card、真实 author_action、cancelled TurnResult 和后续恢复 turn，是 AU-07 D2 最小连续链路。
- 2026-06-21 — BehaviorTrace refs 记录在 action turn 的 `trace_summary` 并通过 Channel persistence 写入 `decision_traces`，避免把 terminal replay 只留在 UI snapshot。
- 2026-06-21 — `au07-behavior-trace-terminal-replay` Tauri / quality acceptance 已通过；AU-07 文件级 P0 关闭，剩余旧 turn API/UI、developer 双视图、完整 ToolTrace registry snapshot、六问 replay 和 work/session 隔离登记为 P1 后续。
- 2026-06-21 — `ai_static_scan --top 10` 剩余唯一 Top 10 为历史 `gitleaks` accepted_risk；本 checkpoint touched-file finding 为 0，blocking 为 0。

## 7. 试行反馈

- AU-07 的 Behavior replay 不能只证明 open behavior 存在；必须证明 terminal close/resolution 在 action turn 中可回放，并且取消路径没有 provider/tool/write 副作用。
