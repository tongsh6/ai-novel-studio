# UA01 Natural Language Steering

- 状态：done / verified
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

## 4. 验收

- [x] `bash scripts/quality_accept.sh agent-natural-language-steer --surface tauri`
- [x] `pnpm --dir frontend test -- --run src/lib/__tests__/agentRunInputRouting.test.ts`
- [x] `pnpm --dir frontend typecheck`
- [x] `pnpm --dir frontend lint`

## 5. 决策记录

- 2026-06-29 — 选择先推进自然语言 steering，因为它不依赖外部账号或 ProviderExecution cancellation；token streaming / cancellation 仍保留为后续 provider 能力。
- 2026-06-29 — `agent-natural-language-steer` 真实 Tauri 验收通过；summary 记录 `command_source=main_input`、`adjusted_goal_version=2`、`no_second_user_message_for_steer=true`。
