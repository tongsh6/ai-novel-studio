# UA01 / ADR-0023 CP4 AgentPlan 原生 Tool Calling 协议迁移

- 状态：done / verified / ADR-0023 CP4 closed
- 类型：Provider Runtime Slice / AgentRun Planning Protocol Slice / Acceptance Slice
- 登记日期：2026-07-05
- 来源：`docs/design/adr/ADR-0023-agentic-loop-plan-driven-execution-v3.md` 决策 4

## 1. 目标

把 AgentPlan 起草/修订结构输出从当前「作者 reasoning + JSON tail」迁到 provider-native tool calling。迁移完成后，结构计划必须来自 tool call 参数，作者可见叙事仍来自 provider 输出文本并受 N-NARR 约束。

迁移后，`AgenticPlanDraftPlanner` 的 AgentPlan 起草/修订结构只来自 provider-native tool call arguments；作者可见 reasoning 仍来自 provider output content。生产 AgentPlan 起草/修订路径不保留 JSON-tail fallback，也不得为了验收注册 fake/script provider。

## 2. 当前闭环证据

- `apps/novel_application/lib/novel_application/agentic_plan_draft_planner.ex` 已改为 structured prompt：`messages` + `tools` + forced `tool_choice`（`agent_plan_draft` / `agent_plan_revision`）。解析器只接受匹配 tool name 的 `tool_calls[].arguments`，binary content / 无 tool call / 多 tool call 均进入 native tool-call retry 或失败，不再解析 JSON tail。
- `apps/novel_agent/lib/novel_agent/provider*.ex` 已把 OpenAI-compatible、LM Studio、DeepSeek、Anthropic 与 stub/slice_verify 接入 provider-native tool call 请求/结果归一；ProviderExecution final output 会携带 `tool_calls`，持久层只保存 `native_tool_call_count` / `native_tool_call_names`，不保存 arguments。
- `apps/novel_application/lib/novel_application/provider_activity_projector.ex` 与 `NovelPersistence.ProviderRunLog` 均只暴露 author-safe tool-call telemetry（count/name），46§9/活动 API 不泄漏 `plan.steps`、`target_tool_ref` 或 tool arguments。
- `AgenticNextStepPlanner` 仍保留旧 JSON-tail 单步 next decision 测试入口，但生产 AgentPlan 起草/修订消费者均走 `AgenticPlanDraftPlanner` native tool-call 协议；不得把该 legacy 单步 planner 作为 AgentPlan draft/revision fallback。

## 3. 开工检查

- **Contract**: `docs/design/contracts/UA-01-unified-agent-run-loop-contract-pack.md` 的 AgentPlan / AgentEvent / AgentRunPolicy；ADR-0023 决策 4；ProviderExecution contract。
- **Invariant**: N-PLAN、N-NARR、Planner 只提议不批准；迁移期间不得出现双规划协议可选支路。
- **Boundary**: 主要涉及 `novel_application` planner/parser、`novel_agent` provider execution adapter/tool-call 支持、quality acceptance 与 Tauri verifier。不得修改 adoption/confirmation/projection 写入边界。
- **Consumer**: 首个消费者应是 `AgenticPlanDraftPlanner` 的 plan draft/revision；`AgenticNextStepPlanner` 仅处理仍存在的 legacy/兼容路径。
- **Proof**: focused planner/runtime/provider tests、provider persistence/activity tests、native verifier tests、真实 Tauri `agent-plan-native-tool-calling-protocol`、task_done 与 `bash scripts/ai_static_scan.sh --top 10`。
- **Acceptance Driver**: `bash scripts/tauri_slice_verify.sh agent-plan-native-tool-calling-protocol` 由真实工作台输入触发计划起草和 D6 计划修订，并从 scoped AgentRun activity API 证明 `agent_plan_draft` / `agent_plan_revision` tool call telemetry；产品代码未新增验收 hook。

## 4. 退出条件

- [x] Contract 冻结 native tool-call 参数 schema，并与 AgentPlan / `plan_drafted` / `plan_revised` 结构口径一致。
- [x] ProviderExecution adapter 支持规划 tool-call 输出，且失败路径诚实暴露 parse/tool-call validation error。
- [x] `AgenticPlanDraftPlanner` 不再要求 JSON tail；plan draft/revision 结构来自 provider-native tool call 参数。
- [x] `AgenticNextStepPlanner` legacy JSON-tail 入口仅保留为旧单步 next decision 测试/兼容边界；生产 AgentPlan 起草/修订不得双协议可选。
- [x] 真实 Tauri driver 证明普通计划起草和 `plan_revised` 偏离场景均消费 native tool call 结构；未新增生产验收 hook。

## 5. 验证

- Targeted backend:
  - `mix test apps/novel_agent/test/novel_agent/provider apps/novel_application/test/novel_application/agent_run_character_design_flow_test.exs apps/novel_application/test/novel_application/agent_run_character_evolution_flow_test.exs apps/novel_application/test/novel_application/agent_run_plot_outline_flow_test.exs apps/novel_application/test/novel_application/agent_run_world_building_flow_test.exs apps/novel_application/test/novel_application/agent_run_prose_revision_flow_test.exs`
  - `mix test apps/novel_agent/test/novel_agent/provider/slice_verify_test.exs apps/novel_application/test/novel_application/agent_run_prose_drafting_flow_test.exs apps/novel_application/test/novel_application/agent_run_runtime_test.exs`
  - `mix test apps/novel_persistence/test/novel_persistence/provider_run_log_test.exs apps/novel_application/test/novel_application/provider_activity_service_test.exs apps/novel_web/test/novel_web/controllers/provider_activity_controller_test.exs`
- Native verifier: `cd frontend && pnpm exec vitest run slice-verify/native-tauri-verifier.test.mjs`.
- Real Tauri: `bash scripts/tauri_slice_verify.sh agent-plan-native-tool-calling-protocol`; summary `artifacts/slice-verify/agent-plan-native-tool-calling-protocol-tauri/summary.json` records `native_tool_call_names=["agent_plan_draft","agent_plan_revision"]`, `native_tool_call_final_output_count=2`, 4 steps / 0 tool / 4 provider calls / 1 replan.
- Acceptance manifest: `quality/acceptance/scenarios/agent-plan-native-tool-calling-protocol.yml`.

## 6. 决策日志

- 2026-07-05 — 从 ADR-0023 收口中拆出。创建时 CP2/CP3 已闭合，但 CP4 仍被真实代码阻塞：AgentPlan 规划协议还在 JSON-tail 形态，provider execution stream 统一不等于规划协议迁移；该创建时 blocker 已由下一条 CP4 闭环记录关闭。
- 2026-07-05 — CP4 闭环：AgentPlan draft/revision 已迁到 native tool calling；ProviderExecution adapters、stub/slice_verify、focused tests、native verifier、quality acceptance manifest 与真实 Tauri `agent-plan-native-tool-calling-protocol` 均已收口。ADR-0023 可以在 task_done/static scan 完成后升 Accepted。
