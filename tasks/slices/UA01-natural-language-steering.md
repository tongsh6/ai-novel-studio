# UA01 Natural Language Steering

- 状态：done / verified（含 awaiting_author regression checkpoint）
- 类型：AgentRun UI Contract Slice / Acceptance Slice
- 启动日期：2026-06-29

## 1. 目标

把“自然语言 steering”从后续能力推进为真实页面闭环：当一个 AgentRun 仍在运行、暂停或等待作者时，作者可以直接在主聊天输入框输入新的方向，前端必须把它绑定到当前 active `run_id` 并提交 `agent_command steer`，而不是创建新的 `user_message`、新的作者 turn 或新的 AgentRun。

本 slice 不改变显式“调整方向”控件；它补齐同一个对话框的自然语言入口。

## 2. 边界

- Contract: `docs/design/contracts/UA-01-unified-agent-run-loop-contract-pack.md` 的 `agent_command steer`、`plan_adjusted`、`agent_run_state.goal.version`。
- Invariant: A10 作者可以 steer；A12 Agent Activity 不暴露私有 chain-of-thought；A13 AgentEvent 不是 TurnResult；A14 内部 step 不伪造作者 turn；A18 stale state 不静默继续。
- Boundary: 修改 `frontend` 输入路由与 `quality` 外部验收；后端 `agent_command` 协议已存在，不新建 provider/tool 能力。
- Consumer: `WorkspaceChat` 主输入框。
- Proof: 纯函数单测 + 真实 Tauri `agent-natural-language-steer`。
- Acceptance Driver: 外部自动化从真实 Tauri 工作台发起慢速 AgentRun，再在主输入框发送 steering 文本，验证 websocket 只出现同 run 的 `agent_command steer`，没有第二个 `user_message`/run。

## 3. 任务

| # | 任务 | 状态 | 说明 |
|---|---|---|---|
| T1 | 前端输入路由纯函数 | done | `shouldRouteInputToAgentSteer` 锁住 active/terminal/pending answer/micro-plan 边界。 |
| T2 | `WorkspaceChat` 主输入接入 steer | done | active run 下主输入提交 `agent_command steer`，不追加聊天消息，不创建新 run。 |
| T3 | 真实 Tauri scenario | done | `agent-natural-language-steer` driver/verifier/manifest 已通过。 |
| T4 | 验证与台账 | done | summary 已生成，台账已同步。 |
| T5 | 登记 `awaiting_author` steer 卡住缺陷 | done | 2026-07-24 截图复现：补充文本只改 goal，未恢复 run，旧判断提示与等待状态重复。 |
| T6 | 同 run 恢复与旧判断检查点失效 | done | steer 清理旧 judgment/progress/final result，并以 goal version 2 重新判断。 |
| T7 | 最终结果锚定与旧叙事去重 | done | 同 turn 最终结果移到最新同 run 作者补充后；AgentRun 叙事复用 source assistant 文本去重。 |
| T8 | `awaiting_author` 真实 Tauri 回归 | done | `agent-awaiting-author-steer-resume`：等待作者 → 发送调整 → 同 run 恢复并完成；旧提示仅保留原始一次。 |

## 4. 验收

- [x] `bash scripts/quality_accept.sh agent-natural-language-steer --surface tauri`
- [x] `pnpm --dir frontend test -- --run src/lib/__tests__/agentRunInputRouting.test.ts`
- [x] `pnpm --dir frontend typecheck`
- [x] `pnpm --dir frontend lint`
- [x] `mix test apps/novel_application/test/novel_application/agent_run_runtime_test.exs apps/novel_application/test/novel_application/dialogue_planning_service_test.exs`
- [x] `pnpm --dir frontend exec vitest run src/components/WorkspaceChat.agentRunAnchoring.test.tsx`
- [x] `VITE_DEV_PORT=5771 PHOENIX_PORT=4659 bash scripts/tauri_slice_verify.sh agent-awaiting-author-steer-resume`

## 5. 决策记录

- 2026-06-29 — 选择先推进自然语言 steering，因为它不依赖外部账号或 ProviderExecution cancellation；token streaming / cancellation 仍保留为后续 provider 能力。
- 2026-06-29 — `agent-natural-language-steer` 真实 Tauri 验收通过；summary 记录 `command_source=main_input`、`adjusted_goal_version=2`、`no_second_user_message_for_steer=true`。
- 2026-07-24 — 登记真实页面缺陷：`awaiting_author` 下作者补充要求虽然发送为同 run 的 steer，但服务端只更新 goal、不恢复运行，并继续消费旧 judgment settled/context/progress；前端因此重复旧确认提示并保持“等待你确认”。本 checkpoint 只修复 UA-01 同 run 恢复链路，不宣称 ADR-0024 S7 的 `TurnResult + available_actions` CP3 已闭环。
- 2026-07-24 — `agent-awaiting-author-steer-resume` 真实 Tauri 通过：同一 `run_id` 从 `awaiting_author` 经 `plan_adjusted` / `run_resumed` 到 `completed`，goal version=2；无第二个 `user_message`/run，旧等待提示总数=1。
