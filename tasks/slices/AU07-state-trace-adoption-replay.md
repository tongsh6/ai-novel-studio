# AU07 StateTrace Adoption Replay

- 状态：checkpoint closed / AU-07 file-level closed
- 类型：Acceptance / Adoption / Projection / Replay
- 启动日期：2026-06-21
- 来源：`docs/design/acceptance/author/AU-07-trace-and-replay.md`、`docs/design/contracts/VS-04-adoption-boundary-contract-pack.md`、`docs/design/contracts/VS-06-replay-surface-contract-pack.md`

## 1. 用户 / 系统目标

把 AU-07 的 StateTrace / adoption / projection replay 缺口推进到真实页面可验收：作者从真实工作台生成章节正文草稿并点击“保存为章节正文”后，采纳 action turn 的 `trace_summary.state_trace_refs`、`adoption_state.resolved[].state_trace_ref` 与 `projection_refs[].source_state_trace_ref` 必须指向同一条可回放 StateTrace，并且 ReadingMode 能看到该采纳写入后的正文。

## 2. 开工检查

- Contract：VS-04 AdoptionDecision / ProjectionHint、VS-06 ReplayReport、ADR-0016 ProjectionHint UI、ADR-0017 ReplayReport、`DecisionTrace.state_trace_refs`、`TurnResult.adoption_state`、`TurnResult.projection_refs`。
- Invariant：生产采纳写入必须留下 StateTrace；ProjectionHint 必须引用本次采纳写入的 StateTrace；Replay 不允许重调 provider，缺 trace refs 时必须 partial 而不是伪造完整回放。
- Boundary：切穿 `novel_application` 的 AdoptionWorkflow、`novel_web` 的真实 Channel action turn、外部 Tauri harness 和 quality manifest；不修改 `novel_agent` provider runtime，不把 fixture provider 注册进 production，不新增产品验收感知逻辑。
- Consumer：真实工作台保存正文后的 ReadingMode、`ReplayService.build_report/1`、`TraceReplayService`、后续完整 StateTrace/adoption replay / developer / 多类型 UI。
- Proof：`mix test apps/novel_application/test/novel_application/adoption_workflow_test.exs apps/novel_web/test/novel_web/channels/workspace_channel_action_idempotency_test.exs`、`pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`、`bash scripts/tauri_slice_verify.sh au07-state-trace-adoption-replay`、`bash scripts/quality_accept.sh au07-state-trace-adoption-replay --surface tauri`。
- Acceptance Driver：`bash scripts/tauri_slice_verify.sh au07-state-trace-adoption-replay` 使用外部 Playwright/Tauri driver 从真实工作台点击生成正文草稿、保存为章节正文、打开阅读模式并核对 StateTrace refs。产品代码不新增验收感知逻辑。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改基础工具 |
| novel_domain | no | 本 checkpoint 不新增领域结构 |
| novel_agent | no | 不改 provider runtime |
| novel_application | yes | AdoptionWorkflow 输出真实 StateTrace refs / projection source refs |
| novel_persistence | no | 复用既有 `decision_traces.state_trace_refs` |
| novel_web | yes | 真实 author_action turn 通过 application tracer 持久化 action DecisionTrace |
| frontend | yes | 仅改外部 slice verifier/driver，不改生产 UI |
| docs/design | yes | 同步 AU-07 文件级矩阵 |
| quality | yes | 新增质量场景 manifest |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | AdoptionWorkflow 在 persisted accept / edit_then_accept turn result 中生成 StateTrace refs | done | no-writer 路径不伪造 StateTrace |
| T2 | WorkspaceChannel 持久化 author_action DecisionTrace refs | done | 通过 `NovelApplication.persistence_tracer/0`，不直接依赖 persistence |
| T3 | 外部 Tauri verifier 验证 adoption/projection 共用 StateTrace | done | `au07-state-trace-adoption-replay` |
| T4 | quality manifest 与 slice 文档登记 | done | 本文件与 `quality/acceptance/scenarios/*.yml` |
| T5 | AU-07 文件级矩阵和 ledger 同步 | done | 后续 Behavior terminal replay 已关闭，AU-07 文件级 P0 已关闭 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh au07-state-trace-adoption-replay`
- [x] 后端 / Channel 局部验证：`mix test apps/novel_application/test/novel_application/adoption_workflow_test.exs apps/novel_web/test/novel_web/channels/workspace_channel_action_idempotency_test.exs`
- [x] verifier 单测：`pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/quality_accept.sh au07-state-trace-adoption-replay --surface tauri`
- [x] `bash scripts/task_done.sh --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-21 — StateTrace refs 只在真实 persisted writer 成功时生成；无 writer / no-write 采纳路径必须保持空 refs，避免把局部测试或非生产写伪装成可回放状态变更。
- 2026-06-21 — author_action DecisionTrace 由 `novel_web` 通过 `NovelApplication.persistence_tracer/0` 记录，保持 umbrella 边界，不直接引用 `NovelPersistence`。
- 2026-06-21 — `bash scripts/quality_accept.sh au07-state-trace-adoption-replay --surface tauri` 已通过；本 checkpoint 当时只关闭 AU-07 的 StateTrace/adoption/projection P0，后续 `au07-behavior-trace-terminal-replay` 已继续关闭 Behavior terminal replay，AU-07 当前可进入 AU-08。
- 2026-06-21 — `bash scripts/ai_static_scan.sh --top 10` 剩余唯一 Top 10 为历史 `gitleaks` accepted_risk，touched-file finding 为 0，blocking 为 0。

## 7. 试行反馈

- AU-07 的 replay producer 缺口需要同时看 TurnResult、DecisionTrace、ProjectionHint 和真实 UI artifact。单测只能证明字段形状，不能替代 Tauri driver 对真实保存正文链路的外部验收。
