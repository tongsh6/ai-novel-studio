# UA01 Character Evolution Agent Profile

- 状态：done / verified
- 类型：Agent Profile Slice / Creative Tool Slice / Acceptance Slice
- 启动日期：2026-06-29

## 1. 目标

把“其他创作 Profile”继续推进一个真实闭环：角色演化不再只依赖通用 conversation profile 中的旧 planner/tool 黑盒，而是拥有专门的 `character_evolution_with_context_v1` AgentRun profile。

作者从真实工作台更新已有角色的当前状态、成长变化或关系变化时，系统应快速 ack 一个 bounded AgentRun，并在 run 内完成：

1. 组装当前作品与角色上下文，并记录为 AgentObservation；
2. 由 `next_step_planner` 基于 observations 选择 `character_evolution` 工具 step；
3. 在工具 step 内制定单动作 MicroPlan，重新经过 `ExecutionOrchestrator`，再执行 `character_evolution` 生成 tentative `character_evolution_seed`；
4. 由 `next_step_planner` 基于 artifact observation 给出 completion decision，并汇总结果给作者。

未采纳前不得写角色主档案、角色记忆或 reading projection。采纳后的写入治理仍归既有 AU-09 adoption boundary。

## 2. 边界

- Contract: `docs/design/contracts/UA-01-unified-agent-run-loop-contract-pack.md`、`docs/design/06-memory-context-and-trace.md`、`docs/design/adr/ADR-0021-agent-run-and-turn-boundary-v3.md`。
- Invariant: A2 AgentPlan 不等于 MicroPlan；A3 每步只有一个 MicroPlan action；A4 每步重新经过 Orchestrator；A7 不 direct Toolbox；A8 创作产物默认 tentative；A9 Agent 不自主 adoption；A13 AgentEvent 不是 TurnResult。
- Boundary: 切过 `novel_application` / `novel_agent` profile registry / `frontend` acceptance driver / `quality`；不改 provider 协议，不改 adoption materialization，不改 Character 主档案或 Memory 写入语义。
- Consumer: `WorkspaceChat` 的普通作者输入；后续消费者是既有 `character_evolution_seed` adoption/write-memory 边界。
- Proof: application tests + real Tauri `agent-character-evolution-with-context`。
- Acceptance Driver: 外部自动化从真实 Tauri 工作台创建并采纳已有角色，再输入“更新林烬当前状态”，验证 fast ack、观察驱动 next-step planner loop、`character_evolution` re-gate、tentative `character_evolution_seed`、未采纳不写作品事实。

## 3. 任务

| # | 任务 | 状态 | 说明 |
|---|---|---|---|
| T1 | Profile 任务设计和 scenario 登记 | done | 本文件 + quality manifest 已登记。 |
| T2 | `character_evolution_with_context_v1` runtime | done | 已从固定 steps workflow 纯化为 context observation → next-step planner 选择工具 step → MicroPlan/Orchestrator gate → artifact observation → completion decision。 |
| T3 | 测试与真实 Tauri driver/verifier | done | application test + `agent-character-evolution-with-context` 已通过。 |
| T4 | 验证与台账 | done | 台账已同步；完整回归和 static scan 由本轮最终收口执行。 |

## 4. 验收

- [x] `bash scripts/quality_accept.sh agent-character-evolution-with-context --surface tauri`
- [x] `mix test apps/novel_application/test/novel_application/agent_run_character_evolution_flow_test.exs apps/novel_application/test/novel_application/dialogue_planning_service_test.exs`
- [x] `pnpm --dir frontend test`
- [x] `bash scripts/ai_static_scan.sh --top 10`

## 5. 验收证据

- `artifacts/slice-verify/agent-character-evolution-with-context-tauri/summary.json`
  - `profile_ref=character_evolution_with_context_v1`
  - `pending_artifact_type=character_evolution_seed`
  - `pending_memory_subtype=CURRENT_STATE`
  - `consumed_steps=2`
  - `consumed_tool_calls=1`
  - `consumed_provider_calls=4`
  - `character_evolution_tool_step_was_chosen_by_next_step_planner_and_reentered_orchestrator_gate`
