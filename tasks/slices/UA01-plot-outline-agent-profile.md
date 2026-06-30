# UA01 Plot Outline Agent Profile

- 状态：done / verified
- 类型：Agent Profile Slice / Creative Tool Slice / Acceptance Slice
- 启动日期：2026-06-29

## 1. 目标

把“正文以外更多创作 Profile”推进一个真实闭环：章节大纲规划不再只依赖通用 conversation profile 中的旧 planner/tool 黑盒，而是拥有专门的 `plot_outline_with_context_v1` AgentRun profile。

作者从真实工作台用自然语言请求规划章节大纲时，系统应快速 ack 一个 bounded AgentRun，并在 run 内完成：

1. 组装当前作品上下文，并记录为 AgentObservation；
2. 由 `next_step_planner` 基于 observations 选择 `plot_outline` 工具 step；
3. 在工具 step 内制定单动作 MicroPlan，重新经过 `ExecutionOrchestrator`，再执行 `plot_outline` 生成 tentative `outline_draft`；
4. 由 `next_step_planner` 基于 artifact observation 给出 completion decision，并汇总结果给作者。

未采纳前不得写章节主档案或 reading projection。

## 2. 边界

- Contract: `docs/design/contracts/UA-01-unified-agent-run-loop-contract-pack.md`、`docs/design/contracts/VS-01-execution-authority-contract-pack.md`。
- Invariant: A2 AgentPlan 不等于 MicroPlan；A3 每步只有一个 MicroPlan action；A4 每步重新经过 Orchestrator；A7 不 direct Toolbox；A8 创作产物默认 tentative；A9 Agent 不自主 adoption；A13 AgentEvent 不是 TurnResult。
- Boundary: 切过 `novel_application` / `novel_agent` profile registry / `frontend` acceptance driver / `quality`；不改 adoption materialization，不改 plot_outline provider contract。
- Consumer: `WorkspaceChat` 的普通作者输入；后续消费者是既有 outline adoption/read-model。
- Proof: application tests + real Tauri `agent-plot-outline-with-context`。
- Acceptance Driver: 外部自动化从真实 Tauri 工作台输入“规划 12 章大纲”，验证 fast ack、观察驱动 next-step planner loop、`plot_outline` re-gate、tentative `outline_draft`、未采纳不写阅读投影。

## 3. 任务

| # | 任务 | 状态 | 说明 |
|---|---|---|---|
| T1 | Profile 任务设计和 scenario 登记 | done | 本文件 + quality manifest 已登记。 |
| T2 | `plot_outline_with_context_v1` runtime | done | 已从固定 steps workflow 纯化为 context observation → next-step planner 选择工具 step → MicroPlan/Orchestrator gate → artifact observation → completion decision。 |
| T3 | 测试与真实 Tauri driver/verifier | done | application test + `agent-plot-outline-with-context` 已通过。 |
| T4 | 验证与台账 | done | 全量回归、task_done 与 static scan 已收口；gitleaks 保留既有 accepted_risk。 |

## 4. 验收

- [x] `bash scripts/quality_accept.sh agent-plot-outline-with-context --surface tauri`
- [x] `mix test apps/novel_application/test/novel_application/agent_run_plot_outline_flow_test.exs apps/novel_application/test/novel_application/dialogue_planning_service_test.exs`
- [x] `pnpm --dir frontend test`
- [x] `bash scripts/ai_static_scan.sh --top 10`

## 5. 验收证据

- `artifacts/slice-verify/agent-plot-outline-with-context-tauri/summary.json`
  - `profile_ref=plot_outline_with_context_v1`
  - `pending_artifact_type=outline_draft`
  - `consumed_steps=2`
  - `consumed_tool_calls=1`
  - `consumed_provider_calls=4`
  - `outline_tool_step_was_chosen_by_next_step_planner_and_reentered_orchestrator_gate`
