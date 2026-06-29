# UA01 Unified AgentRun Mainchain Closure

- 状态：doing
- 类型：Turn Slice / Agent Runtime Slice / UI Contract Slice / Acceptance Slice
- 启动日期：2026-06-29

## 1. 用户 / 系统目标

把作者对话框收口为真正统一的 AgentRun 主链。验收口径是：用户输入后的所有主要阶段都发生在 AgentRun 生命周期内，并通过 author-safe `agent_event` / `agent_run_state` 对 UI 可见；单纯把旧同步主链包进一个 AgentRun step 不算完成。

本 slice 覆盖 UA-01 CP4 / CP5 / CP6，以及已经登记但尚未形成可执行 slice 的后续 CP。CP 可以拆 checkpoint 交付，但不能降低完整 CP 范围。

## 2. 开工检查

- Contract: `docs/design/contracts/UA-01-unified-agent-run-loop-contract-pack.md`、`docs/design/adr/ADR-0021-agent-run-and-turn-boundary-v3.md`、`docs/design/contracts/VS-00E-prose-execution-quality-contract-pack.md`、`docs/design/04a-planning-and-long-run.md`。
- Invariant: UA-01 A1-A25；尤其 A3/A4/A7/A10/A12/A13/A18/A20/A21/A23，以及项目级 I1/I2/I3。
- Boundary: 切过 `frontend` / `novel_web` / `novel_application` / `novel_agent` / `novel_domain` / `novel_persistence` / `quality`；`novel_web` 只能做 Channel adapter 和 broadcast，不持有 runtime 状态；`novel_application` 负责编排 AgentRun；`novel_agent` 负责 provider/tool runtime；`novel_domain` 保持纯结构和校验。
- Consumer: 第一个真实消费者是 `WorkspaceChat` 单一对话框；后续消费者包括 prose drafting、LongRunTask durable resume、provider streaming/cancel 和只读 batch。
- Proof: CP inventory + 偏差矩阵；每个 CP 的应用/Channel/前端测试；真实 Tauri driver；`task_done` fresh manifest；AI static scan。
- Acceptance Driver: 本 slice 不允许产品代码感知 slice。外部自动化应从真实 Tauri 工作台输入作者文本，验证 fast ack、AgentRun 生命周期事件、过程面板、最终 TurnResult/trace/projection/no-write 边界。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不新增底层工具。 |
| novel_domain | yes | 可能补 AgentRun durable 字段、step lifecycle 和 policy 校验。 |
| novel_agent | yes | profile registry、provider/tool step 边界、stream/cancel 能力声明。 |
| novel_application | yes | AgentRun lifecycle、context/frame/plan/gate/execute/finalize 分阶段编排。 |
| novel_persistence | yes | CP5 durable resume 需要 LongRunTask 关联和恢复证据；bounded 审计表已存在。 |
| novel_web | yes | Channel fast ack、event/state broadcast、command binding；不能回退同步旧主链。 |
| frontend | yes | `WorkspaceChat` active run 状态、活动面板、loading 替换策略。 |
| docs/design | yes | 若新验收口径收紧 ADR/contract，必须同步登记。 |
| quality | yes | 每个 CP 必须有真实页面 scenario/driver/proof。 |

## 4. CP Inventory

| CP | 设计出处 | 当前证据 | 状态 | 主要缺口 |
|---|---|---|---|---|
| UA-CP0 VS-00E 修订边界回收 | `UA-01` §0 / ADR-0021 / VS-00E | `agent-revision-orchestrator-boundary`、VS-00E CP3 tests | 已实现且有证据 | 作为回归保持；不得在后续重构中绕过 Orchestrator。 |
| UA-CP1 AgentRun contract | `UA-01` §1-7 | domain/common/agent modules、ADR-0021 | 已实现且有证据 | 新验收口径需要补充“所有主要阶段在 run 内”的 contract 文字。 |
| UA-CP2 bounded runtime + Channel protocol | `UA-01` §8-10 | `AgentRunServer` / `AgentRunService` / Channel `agent_event` / `agent_run_state` / `WorkspaceChat` ack state / `agent-conversation-turn` | 已实现且有证据 | 普通对话已拆为 context / frame / strategy / finalize 四个 run 内 step，并由真实 Tauri 验证；后续 CP4/CP5/CP6 不能用 CP2 冒充。 |
| UA-CP3 roster-to-character-design | `UA-01` §11-12 | `ua01-agent-bounded-roster-to-character-design` 及 alias scenarios | 已实现且有证据 | 只证明复合角色 profile，不证明普通对话和正文主链统一。 |
| UA-CP4 正文 Agent Profile 迁移 | ADR-0021 后续工作；`agent-prose-drafting-with-quality` / `agent-revision-orchestrator-boundary` scenarios | `prose_drafting_with_quality_v1` 四步 flow；`prose_revision_from_findings_v1` 四步 flow；application tests；fresh Tauri summaries | 已实现且有证据 | 已拆除正文草稿单步黑盒，并把正文 context 组装拆为 run 内第一步；revision 已 fast ack 为 bounded AgentRun 并重新经过 Orchestrator。CP5/CP6 不属于 CP4 完成范围。 |
| UA-CP5 durable AgentRun + LongRunTask 真实消费者 | ADR-0021 后续工作；`UA-01` A18/A20 | `AgentRunService.start_durable/2` + LongRunTask checkpoint；Channel join recovery；`WorkspaceChat` durable/recovered panel；`agent-durable-resume-long-run-task` summary | 已实现且有证据 | 已证明 backend restart 后 stale checkpoint 进入 `awaiting_author`，不重复执行已完成 step；CP6 streaming/cancel/read-only batch 不属于 CP5。 |
| UA-CP6 streaming / provider cancel / read-only batch | ADR-0021 后续工作；`UA-01` A11/A12 | 子 slice `UA01-CP6-stream-cancel-readonly-batch.md`；`agent-provider-streaming-progress` / `agent-provider-cancel-honest-boundary` / `agent-readonly-batch-profile` fresh summaries | 已实现且有证据 | 当前 provider 不支持硬取消和 token 级 streaming，已诚实降级为 checkpoint progress / cooperative safe-point cancel；没有声明 hard cancellation 已完成。 |
| Ordinary conversation unified AgentRun | 新验收口径；`agent-conversation-turn` scenario | `conversation_turn_v1`、`agent-conversation-turn`、ack active run UI、`artifacts/slice-verify/agent-conversation-turn-tauri/summary.json` | 已实现且有证据 | 真实 Tauri 已证明 context / frame / strategy / finalize 四阶段在 AgentRun lifecycle 内可见，`steps=4`、`tool_calls=0`、`provider_calls=1`、无 `sync_turn` fallback。 |

## 5. 偏差矩阵

| ID | 严重度 | 证据 | 违反口径 | 影响 | 修复方向 |
|---|---|---|---|---|---|
| UA01-GAP-01 | P0 | 已修：`DialoguePlanningService.plan_agent_run/3` 不再调用 `DialogueGateway.handle_input/5`；`WorkspaceChannel.user_message` 不再处理 `{:turn_result, ...}` fallback。 | 用户输入后的主要阶段必须在 AgentRun 生命周期内。 | run 外同步主链已拆除。 | 保持无 `sync_turn` fallback；继续在 CP4/CP5/CP6 中按相同口径加严。 |
| UA01-GAP-02 | P0 | 已修：`ConversationTurn.steps/1` 不再调用完整 `DialogueGateway.handle_input/5`，已拆为 context assemble、frame form、strategy/gate、response/finalize 四个 step。 | 单纯把旧同步主链包进一个 AgentRun step 不算完成。 | 普通对话黑盒 step 已拆除；剩余同类风险转入 CP4 正文 profile review。 | `agent-conversation-turn` verifier 固定四阶段 step/observation、`steps=4`、无 tool/write/adoption。 |
| UA01-GAP-03 | P1 | 已修：`WorkspaceChat` 从 `sendMessage` ack 的 `run_id` 建立 optimistic active run；有 active run 时不再渲染独立“思考中...”；AgentRun 面板保留最近 12 条事件以覆盖四阶段过程。 | 前端必须从 ack 建立 active run 状态并用事件/状态展示过程。 | 普通对话页面已可见四阶段 step 摘要。 | 由真实 Tauri `agent-conversation-turn` 复跑确认。 |
| UA01-GAP-04 | P1 | 已修：CP5/CP6 已拆出独立子 slice，相关 quality scenarios 已 active/nightly 并通过真实 Tauri。 | 未实现项必须先补任务设计和验收入口。 | CP5/CP6 已形成生产实现、driver、verifier 和 summary artifact。 | 后续只保留 provider hard cancellation / token streaming 等能力扩展，不把当前协作式降级写成硬取消。 |

## 6. 执行顺序

1. **CP inventory 与偏差登记（本文件）**：先固定事实边界，不直接改 runtime。
2. **CP2/普通对话主链纠偏**：让有效 `user_message` 先创建 AgentRun，并把 context/frame/plan/gate/finalize 迁入 run lifecycle；前端 ack 即显示 active run。
3. **CP4 正文 Agent Profile review + 纠偏**：复用 VS-00E，不重建正文质量链；证明正文写作/质量复核主要阶段在 AgentRun lifecycle 内可见。
4. **CP5 durable AgentRun + LongRunTask**：先补子 slice，再实现真实消费者、checkpoint/resume、stale policy 和重启恢复验收。
5. **CP6 streaming / cancel / read-only batch**：先补子 slice，再实现 provider event、cancel 诚实边界和只读 batch profile。
6. **全量回归与台账收口**：同步 `tasks/NEXT.md`、`docs/project-ledger.md`、`quality/acceptance/scenarios*` 和 task_done/static scan。

## 7. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 登记 CP inventory / 偏差矩阵 / 执行顺序 | done | 本文件是当前事实审计落点。 |
| T2 | 更新 `tasks/NEXT.md` 和 `tasks/slices/README.md` 链入本 slice | done | 让 CP5/CP6 不再只是 ADR 后续一句话。 |
| T3 | 加严 `agent-conversation-turn` 验收 | done | 复用现有真实 Tauri driver/verifier，断言普通输入 fast ack、同 run_id event/state/TurnResult、无 `sync_turn` fallback。 |
| T4 | 拆除 `DialoguePlanningService` run 外同步主链 | done | `plan_agent_run/3` 不再调用 `DialogueGateway.handle_input/5`；Channel `user_message` 不再保留同步 `turn_result` fallback。 |
| T5 | 拆分 `conversation_turn_v1` 黑盒 step | done | 普通输入已拆成 context / frame / strategy / finalize 四个 AgentRun step；verifier 检查四个 `step_proposed`、三个 `observation_recorded`、最终 `steps=4`、无 tool/write/adoption。 |
| T6 | CP4 正文 Agent Profile review 与纠偏 | done | `agent-prose-drafting-with-quality` 已拆为正文上下文、策略/授权、正文生成+质量复核、最终汇总四步；`revise_from_findings` 已实现 `prose_revision_from_findings_v1` 四步 bounded AgentRun，并已形成 fresh Tauri summary。 |
| T7 | CP5 子 slice + durable resume 实现 | done | `agent-durable-resume-long-run-task` 已从 blocked 转 active/nightly，并通过真实 Tauri backend restart 验收。 |
| T8 | CP6 子 slice + stream/cancel/read-only batch 实现 | done | 三条 CP6 scenarios 已 active/nightly 并通过真实 Tauri；当前 provider hard cancel 不支持时诚实降级。 |

## 8. 验证

- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh agent-conversation-turn` 通过；summary 记录 `profile_ref=conversation_turn_v1`、`consumed_steps=4`、`consumed_tool_calls=0`、`consumed_provider_calls=1`。
- [x] CP3 回归外部验收：`bash scripts/tauri_slice_verify.sh ua01-agent-bounded-roster-to-character-design` 通过。
- [x] CP4 drafting 外部验收：`bash scripts/quality_accept.sh agent-prose-drafting-with-quality --surface tauri` 通过；summary 记录 bounded `prose_drafting_with_quality_v1` 四步 profile（context / strategy+gate / prose+quality / finalize，4 steps / 1 tool / 2 provider）。
- [x] CP4 execution brief 外部验收：`bash scripts/quality_accept.sh p1-prose-execution-brief --surface tauri` 通过；summary 记录 `turn_id=turn_3:agent:2`，verifier 关联同一 AgentRun 内 `turn_3:agent:1` context step 与 `turn_3:agent:2` execution brief/prose step。
- [x] CP4 quality 外部验收：`bash scripts/quality_accept.sh p1-prose-quality-finding-roundtrip --surface tauri`、`bash scripts/quality_accept.sh p1-prose-quality-evaluator-degrade --surface tauri`、`bash scripts/quality_accept.sh p1-prose-revision-candidate --surface tauri`、`bash scripts/quality_accept.sh p1-prose-quality-adoption-boundary --surface tauri` 均通过；summary 均记录 `turn_id=turn_3:agent:2`。
- [x] CP4 revision 外部验收：`bash scripts/quality_accept.sh agent-revision-orchestrator-boundary --surface tauri` 与 `bash scripts/quality_accept.sh agent-replay-no-provider --surface tauri` 均通过；summary 记录 bounded `prose_revision_from_findings_v1`（4 steps / 1 tool / 1 provider）和 `recall_provider=false` replay policy。
- [x] PR smoke 质量入口：`bash scripts/quality_accept.sh --tier pr-smoke` 通过；`au10-micro-plan-entry` 与 `vs10-observability-spine` 均通过真实 browser surface verifier。
- [x] CP5 外部验收：`bash scripts/quality_accept.sh agent-durable-resume-long-run-task --surface tauri` 通过；summary 记录 durable `long_run_task_ref`、backend restart 后 `runtime_not_live` stale recovery、completed step 数保持 1、恢复后 `toolbox.execute` 次数为 0。
- [x] CP6 外部验收：`bash scripts/quality_accept.sh agent-provider-streaming-progress --surface tauri`、`bash scripts/quality_accept.sh agent-provider-cancel-honest-boundary --surface tauri`、`bash scripts/quality_accept.sh agent-readonly-batch-profile --surface tauri` 均通过；summary 分别记录 provider progress author-safe/degraded、cooperative safe-point cancel、readonly batch no-provider/no-artifact。
- [x] 后端：本 checkpoint 已通过 `mix compile --warnings-as-errors`、全量 `mix test`（1079 tests, 0 failures；integration/real_llm excluded）、`mix run scripts/arch_check.exs`、`mix xref graph --format cycles --label compile-connected --fail-above 0`。`mix test` 中 provider timeout/unauthorized warning 为既有模拟失败用例输出。
- [x] 主链不变量：`MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs`、`MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs`、`MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs` 均通过。
- [x] 前端：本 checkpoint 已通过 `node --check frontend/slice-verify/native-tauri-verifier.mjs`、`node --check frontend/slice-verify/external-ui-driver.mjs`、`pnpm --dir frontend typecheck`、`pnpm --dir frontend lint`、`pnpm --dir frontend test`（25 files / 338 tests）、`pnpm --dir frontend build`、`bash scripts/frontend_audit.sh`、`bash scripts/check_design_trace.sh`。
- [x] `bash scripts/task_done.sh --skip-static-scan`：已生成 fresh task_done manifest，UI evidence 指向 `artifacts/slice-verify/agent-replay-no-provider-tauri/summary.json`。
- [x] `bash scripts/ai_static_scan.sh --top 10`：复跑退出码 0；17 passed / 1 failed / 0 skipped，失败项为历史 gitleaks `generic-api-key`，disposition=`accepted_risk`，且 Top10 `0 in touched files`；`task_done` 已转 PASS。

## 9. 决策日志

- 2026-06-29 — 根据用户收紧后的验收口径开工：旧 CP0-CP3 兼容口径不再足以证明“所有对话统一 AgentRun”。本轮先登记偏差，不把 `conversation_turn_v1` 的单 step 黑盒视为完成。
- 2026-06-29 — 已把 `tasks/NEXT.md` 当前队首切到本 slice，并把需要真实供应商账号的 `SU01-provider-failure-matrix-live-vendor` 从 `next` 调整为 `blocked` 后续；`node scripts/next_task_check.mjs` 通过，当前唯一 `next` 为本 slice。
- 2026-06-29 — `DialoguePlanningService.plan_agent_run/3` 已拆除 run 外 `DialogueGateway.handle_input/5`；`WorkspaceChannel` 的 `user_message` 不再广播同步 fallback `turn_result`，ack 返回 `run_id` / `run_mode` / `profile_ref` / `goal`。`WorkspaceChat` 已从 ack 建立 active AgentRun state，有 active run 时不再显示独立“思考中...”。`agent-conversation-turn` driver/verifier 已改为检查无 `sync_turn` fallback。
- 2026-06-29 — `conversation_turn_v1` 已从单 step 黑盒改为 context / frame / strategy / finalize 四阶段 AgentRun flow。`agent-conversation-turn` driver/verifier 不再认可旧三段兼容事件，要求四个 `step_proposed`、三个 `observation_recorded`、页面可见四阶段摘要、最终 `steps=4` / `tool_calls=0` / `provider_calls=1`。
- 2026-06-29 — `agent-prose-drafting-with-quality` 已从单步黑盒拆成正文上下文、策略/授权、正文生成+质量复核、最终汇总四步；verifier 不再接受 `steps=1` 或缺 context step，改为要求 context `step_proposed`、`goal_understood`、context observation、strategy/prose/finalization step、`plan_created`、`gate_decided`、`tool_started`、质量观察、草稿观察、`steps=4` / `tool_calls=1` / `provider_calls=2`、无 `sync_turn` fallback。真实 Tauri fresh summary 已通过。
- 2026-06-29 — `revise_from_findings` 已从 Channel 同步 `DialogueGateway.handle_action/3` 迁出，新增 `prose_revision_from_findings_v1` AgentRun profile：读取/校验修订对象、修订计划与授权、`prose_writing` 修订执行、最终候选汇总四步均通过 author-safe `agent_event` / `agent_run_state` 可见；最终 `TurnResult.agent_run.profile_ref=prose_revision_from_findings_v1`。应用层测试与真实 Tauri summary 均已通过。
- 2026-06-29 — 正文 AgentRun 拆成 context 与 prose 子 step 后，VS-00E verifier 的旧假设（`context.assemble.done` 与 `prose_execution_brief.built.done` 必须同一 child turn）已改为绑定同一 AgentRun sibling turn：context 可在 `:agent:1`，正文/brief/quality 在 `:agent:2`，仍要求真实 UI state、真实 Toolbox success、tentative/adoption 边界。
- 2026-06-29 — CP5/CP6 已从 ADR 后续一句话拆成可执行任务设计：新增 `UA01-CP5-durable-agent-run-resume.md` 与 `UA01-CP6-stream-cancel-readonly-batch.md`，并登记 blocked quality scenarios `agent-durable-resume-long-run-task`、`agent-provider-streaming-progress`、`agent-provider-cancel-honest-boundary`、`agent-readonly-batch-profile`。当前只代表任务设计和验收入口可达，不代表实现完成。
- 2026-06-29 — CP5 durable AgentRun + LongRunTask 已闭环：作者可通过真实文本请求启动 durable AgentRun，bounded run 仍不强制 LongRunTask；durable run 创建并 checkpoint LongRunTask，Channel join 可恢复 live runtime sink 或在 backend restart 后从 checkpoint 广播 author-safe `run_resumed` / `agent_run_state`。真实 Tauri `agent-durable-resume-long-run-task` 已通过，证明 stale recovery 等待作者且不重复执行已完成工具 step。
- 2026-06-29 — CP6 provider progress / cancel honest boundary / readonly batch 已闭环：新增 `provider_progress_v1` 和 `readonly_batch_context_v1`，`provider_progress` 事件不暴露 raw prompt，当前 provider 无 token streaming / hard cancel 时分别降级为 checkpoint progress 与 cooperative safe-point cancel；运行中 cancel 先广播 `cancelling`，safe point 后才 `cancelled`。三条真实 Tauri summary 均已通过。

## 10. 试行反馈

- `agent-conversation-turn` 现在能证明普通输入带 `run_id` 和 final `TurnResult.agent_run`，且 context/frame/strategy/finalize 四阶段均在 AgentRun lifecycle 内通过 author-safe event/state 对页面可见。CP4 已补正文草稿四步 profile 和修订四步 profile，并已由 fresh Tauri summary 覆盖；CP5 durable resume 已通过 backend restart Tauri 验收；CP6 provider progress / cancel honest boundary / readonly batch 已通过真实 Tauri 验收。剩余能力是后续 provider token streaming、provider hard cancellation 与更多创作 profile，不属于当前 CP6 已完成范围。
