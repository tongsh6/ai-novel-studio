# UA01 / ADR-0023 Agentic Loop 计划驱动执行

- 状态：done / verified / ADR-0023 Accepted-ready；CP0、CP1、CP2 D1-D7、CP3 当前 profile / 46§9 / acceptance 口径与 CP4 AgentPlan 原生 tool calling 协议均已由定向测试和真实 Tauri 验证
- 类型：AgentRun Loop 架构收口 Slice
- 登记日期：2026-07-04
- 来源：`docs/design/adr/ADR-0023-agentic-loop-plan-driven-execution-v3.md`

## 1. 目标

把当前 observation-led `next_step_planner` loop 推进到 ADR-0023 冻结的「计划驱动机械推进 + 偏离才 evaluate/replan」形态。

本 slice 不是重新定义 UA-01；它只承接 ADR-0023 对 UA-01 的执行经济学和鲁棒性修订。当前过渡态允许已迁移 profile 与旧逐步 pick-one profile 并存，但必须在任务记录中标明。

## 2. 边界（六问）

- **Contract**: `docs/design/adr/ADR-0023-agentic-loop-plan-driven-execution-v3.md`；`docs/design/contracts/UA-01-unified-agent-run-loop-contract-pack.md` 的 `AgentPlan` / `AgentNextStepDecision` / `AgentRunPolicy` / `AgentEvent`；ADR-0022 的 N-NARR。
- **Invariant**: N-PLAN：推进轨道必须来自模型 per-run 产出的 `AgentPlan` 及其修订版本；生产路径不得复活 app 预制 per-profile 固定步骤序列。CP0 额外保护「规划坏 JSON 不一次性灭 run」与「planner 能看到紧凑 structured observation」；CP1 首批保护 conversation/prose 不再为确定性下一步逐次调用模型 planner；CP2 保护 D1-D7 偏离信号只在真实原因命中后消耗 replan budget。
- **Boundary**: `novel_application` 的 AgentRun planner/runtime 调度为主；`novel_domain` 只放纯 contract/预算；`novel_agent` 只保持 provider execution dependency；不改 `novel_web` 协议和写入/adoption/confirmation 边界。
- **Consumer**: `conversation_turn_v1` 与 `prose_drafting_with_quality_v1` 是 CP1 首批真实消费者；`plot_outline_with_context_v1`、`character_evolution_with_context_v1`、`world_building_with_context_v1`、`provider_progress_v1`、`readonly_batch_context_v1`、`character_design_with_context_v1` 与 `prose_revision_from_findings_v1` 是 CP3 已迁移的更多 profile 消费者；CP2 D1-D2/D4/D7 当前由 `prose_drafting_with_quality_v1` 消费，D3 由 active AgentRun steer 消费，D5/D6 由 conversation runtime 消费。
- **Proof**: CP0 用 focused planner tests + profile/runtime tests；CP1 首批用 focused runtime tests、native verifier tests，以及真实 Tauri `agent-conversation-turn` / `agent-prose-drafting-with-quality` 复跑证明。CP2 用 focused runtime tests、native verifier tests 与真实 Tauri 证明 D1 工具失败、D2 质量行动、D3 steer、D4 gate deny/confirmation、D5 预算不足、D6 计划耗尽、D7 确定性缺口均触发 provider-sourced `plan_revised` 并消耗 replan budget；无偏离直通证明普通路径零 replan。CP3 各 profile 分别用 focused/runtime test、native verifier test 与真实 Tauri 证明 model-drafted AgentPlan + mechanical cursor；`agent-bounded-roster-to-character-design` / `ua01-agent-bounded-roster-to-character-design` 证明角色设计计划面板和 routed provider calls=3，`p1-prose-revision-candidate` / `agent-revision-orchestrator-boundary` / `agent-replay-no-provider` 证明修订计划面板、Orchestrator gate 和 replay no-provider。CP4 用 provider adapter/runtime/persistence tests、native verifier tests 与真实 Tauri `agent-plan-native-tool-calling-protocol` 证明 AgentPlan draft/revision 结构来自 native tool calls。
- **Acceptance Driver**: CP1 首批复用既有外部 Tauri driver：`bash scripts/tauri_slice_verify.sh agent-conversation-turn` 与 `bash scripts/tauri_slice_verify.sh agent-prose-drafting-with-quality`。CP2 外部 Tauri driver：`bash scripts/tauri_slice_verify.sh agentic-loop-tool-failure-replan` / `agentic-loop-quality-deviation-replan` / `agent-natural-language-steer` / `agentic-loop-gate-deviation-replan` / `agentic-loop-budget-deviation-replan` / `agentic-loop-plan-replan-reasoning` / `agentic-loop-deterministic-gap-replan` / `agentic-loop-no-deviation-direct`。CP3 复用 `bash scripts/tauri_slice_verify.sh agent-plot-outline-with-context` / `agent-character-evolution-with-context` / `agent-world-building-with-context` / `agent-world-building-style-rule-with-context` / `agent-provider-streaming-progress` / `agent-readonly-batch-profile` / `agent-bounded-roster-to-character-design` / `ua01-agent-bounded-roster-to-character-design` / `agent-provider-call-budget` / `p1-prose-revision-candidate` / `agent-revision-orchestrator-boundary` / `agent-replay-no-provider`。CP4 新增 `bash scripts/tauri_slice_verify.sh agent-plan-native-tool-calling-protocol`。产品代码不得新增验收感知逻辑。

## 3. CP 拆分

| CP | 内容 | 状态 | 说明 |
|---|---|---|---|
| CP0 | 规划协议鲁棒性：坏 JSON 携带失败片段重试一次；最近观察带紧凑 `structured_payload` 进 prompt | done | `AgenticNextStepPlanner.next_decision_with_meta/5` 已支持 parse failure 一次重试，并把 retry 后 provider call count 透传回 AgentRun；prompt 已带最近 8 条 observation 的紧凑 payload。已通过全量门禁与 `agent-prose-drafting-with-quality` 真实 Tauri 回归。 |
| CP1 | 计划起草调用 + `AgentPlan` 运行时落地 + conversation/prose 机械推进 | checkpoint verified | `AgenticPlanDraftPlanner` 已新增；`conversation_turn_v1` 与 `prose_drafting_with_quality_v1` 已起草 per-run AgentPlan 后机械推进，act step 仍需 MicroPlan + Orchestrator gate。真实 Tauri `agent-conversation-turn` 与 `agent-prose-drafting-with-quality` 均已通过。 |
| CP2 | D1-D7 偏离信号 + evaluate/replan 合并调用 + steer 融合 + 预算语义 | checkpoint verified / D1-D7 current Tauri evidence closed | 候选预算 backstop 已由 `UA01-bounded-run-single-candidate-termination.md` T3/T4 先行闭环；D1 工具失败、D2 质量行动、D3 steer、D4 Orchestrator gate deny/require_confirmation、D5 预算不足、D6 计划耗尽但完成条件未成立、D7 确定性缺口均已由 focused tests 与真实 Tauri checkpoint 证明触发 provider-sourced `plan_revised` 并消耗 1 次 replan budget；无偏离直通路径已由真实 Tauri `agentic-loop-no-deviation-direct` 证明零 replan。 |
| CP3 | 全 profile 迁移 + 机械完成态 + 46§9 计划面板消费 + 验收口径迁移 | checkpoint verified / current profile set migrated | `plot_outline_with_context_v1`、`character_evolution_with_context_v1`、`world_building_with_context_v1`、`provider_progress_v1`、`readonly_batch_context_v1`、`character_design_with_context_v1` 与 `prose_revision_from_findings_v1` 已迁到 model-drafted AgentPlan + mechanical cursor，真实 Tauri 对应场景已通过；46§9 计划面板与 acceptance provider call / plan assertions 已按当前事件族迁移。 |
| CP4 | AgentPlan 原生 tool calling 协议迁移 | verified | `AgenticPlanDraftPlanner` 的 draft/revision 已迁到 provider-native tool calls；OpenAI-compatible / LM Studio / DeepSeek / Anthropic / stub / slice_verify 均消费 structured prompt。`agent-plan-native-tool-calling-protocol` 真实 Tauri 证明 draft/revision tool call names 进入 author-safe activity summary 且不泄漏 arguments；生产 AgentPlan draft/revision 不保留 JSON-tail fallback。 |

## 4. CP0 验收

- [x] legacy next-step planner JSON tail malformed 时重试一次，retry prompt 携带失败片段与原始任务；AgentPlan draft/revision 当前已由 CP4 迁到 native tool calls。
- [x] retry 成功后 `provider_call_count=2` 进入 flow meta，避免 consumed budget 低报。
- [x] planner prompt 包含最近 observation 的紧凑 `structured_payload`。
- [x] 全量门禁：`mix compile --warnings-as-errors`、`mix test`、xref、arch_check、scenario invariants、`bash scripts/ai_static_scan.sh --top 10`。
- [x] 真实 Tauri profile 回归至少覆盖 `agent-prose-drafting-with-quality`。

## 5. CP1 首批 checkpoint

- [x] 新增 provider-backed `AgenticPlanDraftPlanner`；当前已升级为作者可见 reasoning + native tool call arguments（CP4），不再要求 AgentPlan JSON tail。
- [x] `AgentPlan.PlanStep` 补 `target_tool_ref`、`write_intent`、`risk_hint` 与 prose 写作坐标字段。
- [x] `conversation_turn_v1` 首次运行时起草包含 context/frame/strategy/finalize 的 AgentPlan；后续步骤机械推进，不再每步调用 next-step planner。
- [x] `prose_drafting_with_quality_v1` 首次运行时起草 context/prose_writing AgentPlan；`prose_writing` step 仍重建单动作 MicroPlan 并经过 Orchestrator gate。
- [x] stub/slice_verify 支持 `AgentRun 计划起草器` 响应，native verifier / acceptance 口径已改为 conversation routed 3 provider calls、prose routed 4 provider calls。
- [x] 真实 Tauri 复跑：`agent-conversation-turn`（summary: `artifacts/slice-verify/agent-conversation-turn-tauri/summary.json`；4 steps / 0 tool / 3 provider calls）。
- [x] 真实 Tauri 复跑：`agent-prose-drafting-with-quality`（summary: `artifacts/slice-verify/agent-prose-drafting-with-quality-tauri/summary.json`；2 steps / 1 tool / 4 provider calls，pending `prose_fragment` 恰 1，`prose_writing` dispatch 恰 1）。
- [x] 静态扫描 / task_done 收口：`bash scripts/task_done.sh` 已生成 fresh manifest，并通过内置 `bash scripts/ai_static_scan.sh --top 10`；最终 Top10 仅剩 2 个既有 gitleaks disposition（`.pen` false_positive、历史 ProjectGod accepted_risk），0 in touched files。
- [x] N-NARR 复验：`artifacts/scenario-invariants/n_narr.md` 记录 `PASS`，覆盖 `plan_drafted` 作者叙事字节绑定与 streamed reasoning prefix，未放宽 provenance 校验。

## 6. CP2 checkpoints

- [x] `AgenticPlanDraftPlanner` 新增 `AgentRun 计划修订器` 入口；当前已升级为作者可见 reasoning + native tool call arguments（CP4），并将修订版 `AgentPlan.version` 提升到 `plan_version+1`。
- [x] `conversation_turn_v1` 与 `prose_drafting_with_quality_v1` 在计划 cursor 走完且完成条件未成立时，先检查 `max_replans` 预算；有预算则调用计划修订器，发出 `plan_revised`，再沿修订计划继续执行当前 cursor 的下一步。
- [x] 修订路径仍不批准工具执行；后续 act step 继续重建单动作 MicroPlan 并经过 `ExecutionOrchestrator` gate。
- [x] 修订 meta 进入既有 `plan_revised` 事件和 `replan_count` 预算：`evaluation_of_last.plan_holds=false`，`plan_revision.revision_reason` 来自 D6 确定性信号。
- [x] focused runtime proof：`mix test apps/novel_application/test/novel_application/agent_run_runtime_test.exs:221`；相邻回归：`mix test apps/novel_application/test/novel_application/agent_run_runtime_test.exs apps/novel_application/test/novel_application/agent_run_prose_drafting_flow_test.exs`。
- [x] 真实 Tauri D6 复跑：`agentic-loop-plan-replan-reasoning`（summary: `artifacts/slice-verify/agentic-loop-plan-replan-reasoning-tauri/summary.json`；初始计划 1 step，仅 `context_assemble`；广播 provider-sourced `plan_revised` version 2；`consumed_steps=4` / `consumed_tool_calls=0` / `consumed_provider_calls=4` / `consumed_replans=1`）。
- [x] 真实 Tauri 无偏离直通复跑：`agentic-loop-no-deviation-direct`（summary: `artifacts/slice-verify/agentic-loop-no-deviation-direct-tauri/summary.json`；初始计划 4 steps；无 `plan_revised`；`consumed_steps=4` / `consumed_tool_calls=0` / `consumed_provider_calls=3` / `consumed_replans=0`）。
- [x] 真实 Tauri steer budget 复跑：`agent-natural-language-steer`（summary: `artifacts/slice-verify/agent-natural-language-steer-tauri/summary.json`；main input steer 命中同一 active `run_id`，广播 `plan_adjusted` 与 provider-sourced `plan_revised`，`consumed_replans=1`，且 `no_second_user_message_for_steer=true`）。
- [x] focused CP2 deviation proof：`mix test apps/novel_application/test/novel_application/agentic_deviation_signal_test.exs apps/novel_application/test/novel_application/agent_run_prose_drafting_flow_test.exs apps/novel_application/test/novel_application/agent_run_runtime_test.exs:271`。
- [x] native verifier proof：`pnpm run test -- native-tauri-verifier.test.mjs`（在 `frontend/` 工作目录），覆盖 D1/D2/D4/D7 新场景注册、provider/replan/plan assertions 与 D2 pending candidate TurnResult 口径。
- [x] 真实 Tauri D1 复跑：`agentic-loop-tool-failure-replan`（summary: `artifacts/slice-verify/agentic-loop-tool-failure-replan-tauri/summary.json`；`signal=D1`；2 steps / 1 tool / 5 provider calls / 1 replan；工具失败先触发 provider-sourced `plan_revised`，run `awaiting_author`，未直接 `run_failed`）。
- [x] 真实 Tauri D2 复跑：`agentic-loop-quality-deviation-replan`（summary: `artifacts/slice-verify/agentic-loop-quality-deviation-replan-tauri/summary.json`；`signal=D2`；2 steps / 1 tool / 5 provider calls / 1 replan；质量 `policy_action=confirm` 产出待采纳候选但 `AgentRun` 保持 `awaiting_author`，不静默完成）。
- [x] 真实 Tauri D4 复跑：`agentic-loop-gate-deviation-replan`（summary: `artifacts/slice-verify/agentic-loop-gate-deviation-replan-tauri/summary.json`；`signal=D4`；2 steps / 0 tool / 3 provider calls / 1 replan；`gate_decision_type=require_confirmation`、`gate_first_blocking_gate=authority`，writer provider 未 dispatch）。
- [x] 真实 Tauri D5 复跑：`agentic-loop-budget-deviation-replan`（summary: `artifacts/slice-verify/agentic-loop-budget-deviation-replan-tauri/summary.json`；1 step / 0 tool / 2 provider calls / 1 replan；剩余 step 预算不足触发 provider-sourced `plan_revised`，无 final TurnResult 或 tool execution）。
- [x] 真实 Tauri D7 复跑：`agentic-loop-deterministic-gap-replan`（summary: `artifacts/slice-verify/agentic-loop-deterministic-gap-replan-tauri/summary.json`；`signal=D7`；2 steps / 0 tool / 3 provider calls / 1 replan；`tool_completed_event_count=0`、`log_toolbox_execute_count=0`，确定性缺口阻止 writer dispatch）。

## 7. CP3 checkpoints

- [x] `AgenticPlanDraftPlanner` 新增 `plot_outline_with_context_v1` step catalog，计划包含 `context_assemble` 与 `plot_outline` 两步。
- [x] `plot_outline_with_context_v1` 首次运行时起草 per-run AgentPlan；runtime 机械执行 context 后推进到 `plot_outline`，工具 step 仍重建单动作 MicroPlan 并经过 `ExecutionOrchestrator` gate。
- [x] stub/slice_verify 支持章节大纲计划起草响应，验收口径从旧 observation-led planner 5 provider calls 改为 routed 3 provider calls（profile routing + plan draft + writer）。
- [x] focused proof：`mix test apps/novel_application/test/novel_application/agent_run_plot_outline_flow_test.exs`。
- [x] native verifier proof：`pnpm run test -- native-tauri-verifier.test.mjs`（在 `frontend/` 工作目录）。
- [x] 真实 Tauri 复跑：`agent-plot-outline-with-context`（summary: `artifacts/slice-verify/agent-plot-outline-with-context-tauri/summary.json`；`profile_ref=plot_outline_with_context_v1`，`pending_artifact_type=outline_draft`，`consumed_steps=2` / `consumed_tool_calls=1` / `consumed_provider_calls=3`）。
- [x] `AgenticPlanDraftPlanner` 新增 `character_evolution_with_context_v1` step catalog，计划包含 `context_assemble` 与 `character_evolution` 两步。
- [x] `character_evolution_with_context_v1` 首次运行时起草 per-run AgentPlan；runtime 机械执行 context 后推进到 `character_evolution`，工具 step 仍重建单动作 MicroPlan 并经过 `ExecutionOrchestrator` gate。
- [x] stub/slice_verify 支持角色演化计划起草响应，验收口径从旧 observation-led planner 5 provider calls 改为 routed 3 provider calls（profile routing + plan draft + writer）。
- [x] focused proof：`mix test apps/novel_application/test/novel_application/agent_run_character_evolution_flow_test.exs`。
- [x] native verifier proof：`pnpm run test -- native-tauri-verifier.test.mjs`（在 `frontend/` 工作目录）。
- [x] 真实 Tauri 复跑：`agent-character-evolution-with-context`（summary: `artifacts/slice-verify/agent-character-evolution-with-context-tauri/summary.json`；`profile_ref=character_evolution_with_context_v1`，`pending_artifact_type=character_evolution_seed`，`pending_memory_subtype=CURRENT_STATE`，`consumed_steps=2` / `consumed_tool_calls=1` / `consumed_provider_calls=3`）。
- [x] `AgenticPlanDraftPlanner` 新增 `world_building_with_context_v1` step catalog，计划包含 `context_assemble` 与 `world_building` 两步。
- [x] `world_building_with_context_v1` 首次运行时起草 per-run AgentPlan；runtime 机械执行 context 后推进到 `world_building`，工具 step 仍重建单动作 MicroPlan 并经过 `ExecutionOrchestrator` gate。
- [x] stub/slice_verify 支持世界设定计划起草响应，验收口径从旧 observation-led planner 5 provider calls 改为 routed 3 provider calls（profile routing + plan draft + writer）。
- [x] focused proof：`mix test apps/novel_application/test/novel_application/agent_run_world_building_flow_test.exs`，覆盖 `foreshadowing_seed` 与 `style_rule_seed` 两种 artifact type。
- [x] native verifier proof：`pnpm run test -- native-tauri-verifier.test.mjs`（在 `frontend/` 工作目录）。
- [x] 真实 Tauri 复跑：`agent-world-building-with-context` 与 `agent-world-building-style-rule-with-context`（summary 分别位于 `artifacts/slice-verify/agent-world-building-with-context-tauri/summary.json` 与 `artifacts/slice-verify/agent-world-building-style-rule-with-context-tauri/summary.json`；均为 `profile_ref=world_building_with_context_v1`，`consumed_steps=2` / `consumed_tool_calls=1` / `consumed_provider_calls=3`，并分别保持 `pending_artifact_type=foreshadowing_seed` / `style_rule_seed`）。
- [x] `AgenticPlanDraftPlanner` 新增 `provider_progress_v1` step catalog，计划包含 `provider_complete` 单步。
- [x] `provider_progress_v1` 首次运行时起草 per-run AgentPlan；runtime 机械推进到 `provider_complete`，保留 author-safe `provider_progress` 事件、不暴露 raw prompt。
- [x] `AgenticPlanDraftPlanner` 新增 `readonly_batch_context_v1` step catalog，计划包含两步 `readonly_batch`。
- [x] `readonly_batch_context_v1` 首次运行时起草 per-run AgentPlan；runtime 机械读取 4 项只读上下文后汇总，保持 no content provider / no artifact / no adoption / no production write。
- [x] focused proof：`mix test apps/novel_application/test/novel_application/agent_run_runtime_test.exs`，覆盖 provider progress、readonly batch、相关 runtime 回归。
- [x] native verifier proof：`pnpm run test -- native-tauri-verifier.test.mjs`（在 `frontend/` 工作目录）。
- [x] 真实 Tauri 复跑：`agent-provider-streaming-progress`（summary: `artifacts/slice-verify/agent-provider-streaming-progress-tauri/summary.json`；`profile_ref=provider_progress_v1`，`plan_drafted_target_tool_ref=provider_complete`，`plan_drafted_step_count=1`，`progress_event_count=3`，`consumed_provider_calls=3`）。
- [x] 真实 Tauri 复跑：`agent-readonly-batch-profile`（summary: `artifacts/slice-verify/agent-readonly-batch-profile-tauri/summary.json`；`profile_ref=readonly_batch_context_v1`，`plan_drafted_target_tool_ref=readonly_batch`，`plan_drafted_step_count=2`，`readonly_item_refs=[work_profile, characters, rules, stats]`，`consumed_tool_calls=4`，`consumed_provider_calls=2`，无 artifact/write/adoption）。
- [x] provider cancel 回归：`agent-provider-cancel-honest-boundary` 真实 Tauri 通过，证明 provider progress 计划起草后仍能通过真实取消按钮进入 `provider_execution_cancel` 并终态 `cancelled`。
- [x] `AgenticPlanDraftPlanner` 新增 `character_design_with_context_v1` step catalog，计划包含 `character_roster` 与 `character_design` 两步。
- [x] `character_design_with_context_v1` 首次运行时起草 per-run AgentPlan；runtime 先机械读取角色阵容，再推进到 `character_design`，工具 step 仍重建单动作 MicroPlan 并经过 `ExecutionOrchestrator` gate。
- [x] stub/slice_verify 支持角色设计计划起草响应，验收口径从旧 observation-led planner 5 provider calls 改为 routed 3 provider calls（profile routing + plan draft + writer）；只读 roster 证据改为 `turn_result.truthfulness.production_write_performed=false`，不要求旧 author `exploration_observed`。
- [x] focused proof：`mix test apps/novel_application/test/novel_application/agent_run_character_design_flow_test.exs apps/novel_application/test/novel_application/agent_run_runtime_test.exs apps/novel_application/test/novel_application/dialogue_planning_service_test.exs`。
- [x] 真实 Tauri 复跑：`agent-bounded-roster-to-character-design`（summary: `artifacts/slice-verify/agent-bounded-roster-to-character-design-tauri/summary.json`；`plan_drafted_target_tool_ref=character_roster`，`plan_drafted_step_count=2`，`plan_drafted_targets=[character_roster, character_design]`，`consumed_steps=2` / `consumed_tool_calls=2` / `consumed_provider_calls=3`）。
- [x] 真实 Tauri 复跑：`ua01-agent-bounded-roster-to-character-design`（summary: `artifacts/slice-verify/ua01-agent-bounded-roster-to-character-design-tauri/summary.json`）与 `agent-provider-call-budget`（summary: `artifacts/slice-verify/agent-provider-call-budget-tauri/summary.json`），证明 UA-01 contract 场景名和 provider budget 场景均已按 3 provider calls 口径迁移。
- [x] `AgenticPlanDraftPlanner` 新增 `prose_revision_from_findings_v1` step catalog，计划包含 `revision_prepare`、`revision_plan`、`prose_writing`、`revision_finalize` 四步。
- [x] `prose_revision_from_findings_v1` 作者动作 fast ack 后起草 per-run AgentPlan；`revision_plan` step 仍调用 `ProseRevisionService.plan_revision/2` 重建 revision MicroPlan 并经过 `ExecutionOrchestrator` gate，`prose_writing` step 才调用 writer 生成 sibling tentative revision draft。
- [x] stub/slice_verify 支持修订计划起草响应，验收口径从旧逐步 next-step planner 7 provider calls 改为 direct/author action 2 provider calls（AgentPlan draft + revision writer）；acceptance 不再等待旧 `evaluation_made`/`exploration_observed` 事件，而用 plan_drafted + gate_decided + turn_result truthfulness/no_write_reason 证明计划、授权与不写入边界。
- [x] focused proof：`mix test apps/novel_application/test/novel_application/agent_run_prose_revision_flow_test.exs apps/novel_application/test/novel_application/agent_run_runtime_test.exs apps/novel_application/test/novel_application/dialogue_planning_service_test.exs`。
- [x] 真实 Tauri 复跑：`p1-prose-revision-candidate`（summary: `artifacts/slice-verify/p1-prose-revision-candidate-tauri/summary.json`；`revision_plan_drafted_target_tool_ref=revision_prepare`，`revision_plan_drafted_step_count=4`，`revision_plan_drafted_targets=[revision_prepare, revision_plan, prose_writing, revision_finalize]`，`revision_consumed_steps=4` / `revision_consumed_tool_calls=1` / `revision_consumed_provider_calls=2`，`replay_policy.recall_provider=false`）。
- [x] 真实 Tauri 复跑：`agent-revision-orchestrator-boundary`（summary: `artifacts/slice-verify/agent-revision-orchestrator-boundary-tauri/summary.json`）与 `agent-replay-no-provider`（summary: `artifacts/slice-verify/agent-replay-no-provider-tauri/summary.json`），证明修订 act step 仍过 Orchestrator gate，replay 不重复调用 provider。
- [x] 46§9 / acceptance 口径迁移：计划面板消费 `plan_drafted.plan_steps` 的模型 step 描述与 app 结构状态；provider call assertions 已迁为 character routed 3、revision author action 2；旧 per-step next-step planner / `evaluation_made` / author `exploration_observed` 断言已从对应 driver/verifier/scenario 移除。

## 8. CP4 checkpoint

- [x] `AgenticPlanDraftPlanner` draft/revision prompt 改为 structured prompt，强制 tool_choice=`agent_plan_draft` / `agent_plan_revision`。
- [x] `AgenticPlanDraftPlanner` parser 只接受 matching native tool call arguments；binary content、缺 tool call、多 tool call 或 arguments 非对象均进入 native tool-call retry / 失败，不再解析 JSON tail。
- [x] OpenAI-compatible、LM Studio、DeepSeek 与 Anthropic adapters 支持 structured prompt 的 provider-native tools/tool_choice；stub/slice_verify 也返回 `Provider.Result.tool_calls` 供验收和测试使用。
- [x] ProviderExecution / ProviderOutput / ProviderRunLog 只持久化 `native_tool_call_count` 与 `native_tool_call_names`，不保存 tool arguments、plan steps 或 raw content。
- [x] focused proof：`mix test apps/novel_agent/test/novel_agent/provider ...`（provider adapter/runtime）与 `mix test apps/novel_persistence/test/novel_persistence/provider_run_log_test.exs apps/novel_application/test/novel_application/provider_activity_service_test.exs apps/novel_web/test/novel_web/controllers/provider_activity_controller_test.exs`。
- [x] native verifier proof：`cd frontend && pnpm exec vitest run slice-verify/native-tauri-verifier.test.mjs`。
- [x] 真实 Tauri 复跑：`agent-plan-native-tool-calling-protocol`（summary: `artifacts/slice-verify/agent-plan-native-tool-calling-protocol-tauri/summary.json`；`native_tool_call_names=[agent_plan_draft, agent_plan_revision]`，`native_tool_call_final_output_count=2`，4 steps / 0 tool / 4 provider calls / 1 replan）。
- [x] `quality/acceptance/scenarios/agent-plan-native-tool-calling-protocol.yml` 已登记；产品代码未新增验收 hook。

## 9. 决策记录

- 2026-07-04 — CP0 闭环：优先做协议鲁棒性和 observation 保真，不改变 loop 形态；这是 ADR-0023 的前置加固，不代表 N-PLAN 或机械推进已完成。
- 2026-07-04 — CP1 首批 runtime checkpoint：conversation/prose 已从 observation-led next-step 迁到 model-drafted AgentPlan + mechanical cursor；当时未覆盖的 D1-D7 evaluate/replan 与全 profile 迁移已由后续 CP2/CP3 checkpoint 补齐；dogfood 长跑复验仍按搭车复验，不为本 ADR 单独触发。
- 2026-07-04 — CP1 首批真实 Tauri 验证通过：`agent-conversation-turn` summary 记录 `consumed_steps=4` / `consumed_tool_calls=0` / `consumed_provider_calls=3`，`agent-prose-drafting-with-quality` summary 记录 `consumed_steps=2` / `consumed_tool_calls=1` / `consumed_provider_calls=4`，且 prose 只产生 1 份 pending prose fragment、`prose_writing` dispatch 恰 1 次。
- 2026-07-04 — task_done/static scan 收口：`mix compile --warnings-as-errors`、全量 `mix test`、xref、arch_check、I3/I1/I2/N-NARR、前端 typecheck/lint/test、frontend audit、design trace、task_done manifest、NEXT integrity、Semgrep 均通过；gitleaks 两项为既有 disposition，0 touched-file finding。
- 2026-07-04 — CP2 D6 backend checkpoint：计划耗尽但完成条件未成立时，conversation/prose 先触发计划修订器并消耗 replan budget；本 checkpoint 先证明后端 runtime 语义，其余偏离信号迁移另行推进。
- 2026-07-04 — CP2 D6 真实 Tauri checkpoint：新增并通过 `agentic-loop-plan-replan-reasoning`，证明真实工作台输入可触发短计划耗尽、provider-sourced `plan_revised`、修订计划恢复 frame/strategy/finalize，并在 1 次 replan budget 内完成 no-tool conversation turn。
- 2026-07-04 — CP2 无偏离直通真实 Tauri checkpoint：新增并通过 `agentic-loop-no-deviation-direct`，证明普通 conversation 路径初始 AgentPlan 已完整包含 context/frame/strategy/finalize，runtime 机械推进到完成，不发 `plan_revised` 且 `consumed_replans=0`。
- 2026-07-04 — CP2 steer budget 真实 Tauri checkpoint：加严 `agent-natural-language-steer` verifier，要求 main input steer 在同一 active run 内触发 `plan_adjusted` 与 `plan_revised`，消耗 `consumed_replans=1`，且不创建第二个作者 turn 或新 run。
- 2026-07-04 — CP3 章节大纲单 profile 真实 Tauri checkpoint：`plot_outline_with_context_v1` 已从 observation-led next-step planner 迁到 model-drafted AgentPlan + mechanical cursor；`agent-plot-outline-with-context` summary 记录 2 steps / 1 tool / 3 provider calls，并证明待采纳 `outline_draft` 不自动写入作品事实。
- 2026-07-04 — CP3 角色演化单 profile 真实 Tauri checkpoint：`character_evolution_with_context_v1` 已从 observation-led next-step planner 迁到 model-drafted AgentPlan + mechanical cursor；`agent-character-evolution-with-context` summary 记录 2 steps / 1 tool / 3 provider calls，并证明待采纳 `character_evolution_seed` 不自动写入角色记忆或作品事实。
- 2026-07-04 — CP3 世界设定 profile 真实 Tauri checkpoint：`world_building_with_context_v1` 已从 observation-led next-step planner 迁到 model-drafted AgentPlan + mechanical cursor；`agent-world-building-with-context` 与 `agent-world-building-style-rule-with-context` summary 均记录 2 steps / 1 tool / 3 provider calls，并分别证明待采纳 `foreshadowing_seed` / `style_rule_seed` 不自动写入作品事实。
- 2026-07-04 — CP3 provider progress + readonly batch 真实 Tauri checkpoint：`provider_progress_v1` 与 `readonly_batch_context_v1` 已从 observation-led next-step planner 迁到 model-drafted AgentPlan + mechanical cursor；`agent-provider-streaming-progress` summary 记录 `provider_complete` 单步计划、3 条 author-safe progress 事件和 3 provider calls，`agent-readonly-batch-profile` summary 记录两步 `readonly_batch` 计划、4 项只读读取、4 tool calls 和 2 provider calls；`agent-provider-cancel-honest-boundary` 同步回归通过。
- 2026-07-04 — CP3 character_design + prose_revision 真实 Tauri checkpoint：`character_design_with_context_v1` 与 `prose_revision_from_findings_v1` 已从 observation-led next-step planner 迁到 model-drafted AgentPlan + mechanical cursor；`agent-bounded-roster-to-character-design` / `ua01-agent-bounded-roster-to-character-design` / `agent-provider-call-budget` summary 记录角色设计计划 `character_roster -> character_design`、2 steps / 2 tool / 3 provider calls；`p1-prose-revision-candidate` / `agent-revision-orchestrator-boundary` / `agent-replay-no-provider` summary 记录修订计划 `revision_prepare -> revision_plan -> prose_writing -> revision_finalize`、4 steps / 1 tool / 2 provider calls、Orchestrator gate 与 replay no-provider。46§9 计划面板与 acceptance provider call / plan assertions 已同步到新事件族。
- 2026-07-05 — CP2 D1/D2/D4/D5/D7 偏离信号当前真实 Tauri checkpoint：新增并通过 `agentic-loop-tool-failure-replan`、`agentic-loop-quality-deviation-replan`、`agentic-loop-gate-deviation-replan`、`agentic-loop-deterministic-gap-replan`，并复跑既有 `agentic-loop-budget-deviation-replan` 与 `agent-natural-language-steer`。D1/D2 routed 口径为 2 steps / 1 tool / 5 provider calls / 1 replan；D4/D7 routed 口径为 2 steps / 0 tool / 3 provider calls / 1 replan；D5 routed 口径为 1 step / 0 tool / 2 provider calls / 1 replan。D2 允许 pending candidate TurnResult，但其 `AgentRun` summary 必须仍是 `awaiting_author`；D7 允许真实 UI 中出现 transient `tool_started` progress，但 `tool_completed_event_count=0` 且 `log_toolbox_execute_count=0`。
- 2026-07-05 — CP4 原生 tool calling 闭环：AgentPlan draft/revision 已迁到 native tool calls，ProviderExecution / persistence / activity summary 只暴露 tool call count/name；真实 Tauri `agent-plan-native-tool-calling-protocol` 证明 `agent_plan_draft` 与 `agent_plan_revision` 均来自 native tool call，且 runtime 继续沿修订后 AgentPlan 机械推进，无 sync_turn fallback。
