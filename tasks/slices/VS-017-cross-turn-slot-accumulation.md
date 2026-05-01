# VS-017 Cross-Turn Slot Accumulation

- 状态：done
- 类型：Behavior Slice
- 启动日期：2026-05-01
- 完成日期：2026-05-01

## 1. 用户 / 系统目标

当作者输入缺少 required slot 时，系统进入 clarification 等待态。下一轮作者补充信息时，系统应识别这是在回答上一轮的澄清，累积 slot 而不是重新分类意图。三轮连续对话应能完成 CREATE_WORK_SEED 所需的全部 slot。

## 2. 开工检查

- Contract: ADR-0010 §6 clarification trigger rules (`blocking_slots` = required ∧ not_inferable ∧ no_default); ADR-0008 CREATE_WORK_SEED intent
- Invariant: 有 pending clarification 时行为 ID 匹配的消息不会触发新 intent 分类；跨轮 slot 不丢失；clarification 解析后 `behavior_state.history` 有解析记录
- Boundary: 涉及 `novel_agent` (ClarificationStore 新增 + Router 新增 `extract_for_schema`), `novel_application` (TurnService 三路径重构), `novel_web` (Channel 透传 behavior_id), `frontend` (state + socket); 不修改 `novel_foundation`, `novel_domain`, `novel_persistence`
- Consumer: WorkspaceChat → 多轮澄清对话 → CREATE_WORK_SEED 执行
- Proof: ClarificationStore 6 tests, Router.extract_for_schema 2 tests, mix test 全量 255 pass, xref 无循环, arch_check 通过, 前端 typecheck/lint/test 通过

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 只引用既有 enum/validator |
| novel_domain | no | 不引入新领域对象 |
| novel_agent | yes | 新增 ClarificationStore; Router 新增 extract_for_schema; application.ex 监督树 |
| novel_application | yes | TurnService 重构为三路径 (handle_message 分支 → process_regular_turn / process_clarification_answer) |
| novel_persistence | no | 不持久化 |
| novel_web | yes | Channel 提取 behavior_id 传给 TurnService |
| frontend | yes | socket.ts sendMessage 接受 behaviorId; WorkspaceChat 存储/携带 behavior_id |
| docs/design-v2 | no | 只引用既有 contract |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | IntentRegistry.get_by_schema_id/1 | done | 按 schema_id 反向查找 SlotSchema |
| T2 | Router.extract_for_schema/3 | done | 跳过 intent 分类，直接按已知 schema 提取 slot |
| T3 | ClarificationStore GenServer | done | ETS 双表 (pending + workspace index)，遵循 AuthorityGate 模式 |
| T4 | Application.ex 监督树更新 | done | 添加 ClarificationStore 到 children |
| T5 | TurnService 三路径重构 | done | handle_message 分支；process_regular_turn (含 supersede + persist)；process_clarification_answer (合并 slot) |
| T6 | handle_revise / handle_dismiss 清理 | done | 调用 ClarificationStore.take_pending |
| T7 | WorkspaceChannel 透传 behavior_id | done | 从 payload 提取 behavior_id 传入 TurnService opts |
| T8 | 前端 socket.ts + WorkspaceChat | done | sendMessage 接受 behaviorId；"answer" action 存储；handleSend 携带 |
| T9 | 测试 | done | ClarificationStore 6 tests, Router.extract_for_schema 2 tests |

## 5. 验证

- [x] `mix compile --warnings-as-errors` — 零警告
- [x] `mix test` — 255 tests, 0 failures
- [x] `mix xref graph --format cycles --label compile-connected --fail-above 0` — No cycles
- [x] `mix run scripts/arch_check.exs` — 通过
- [x] `cd frontend && pnpm typecheck` — 零错误
- [x] `cd frontend && pnpm lint` — 零错误
- [x] `cd frontend && pnpm test` — 22 tests, 0 failures

## 6. 决策日志

- 2026-05-01 — 选择 "behavior_id 由前端点击 answer 按钮传递" 方案。前端在 ClarificationCard 点击 "输入回答" 时存储 card 的 `target_ref` (=behavior_id)，用户发送时通过 `sendMessage` 携带。无 behavior_id 时走普通流程（含 supersede 旧澄清）。
- 2026-05-01 — ClarificationStore 使用 ETS 双表设计（`:clarification_pending` + `:clarification_ws_index`）实现 O(1) 按 behavior_id 和 workspace_id 双向查找，避免 ETS scan。
- 2026-05-01 — `process_regular_turn` 在路由前 supersede 同一 workspace 的旧澄清（`find_by_workspace` → `take_pending`），实现用户"改主意"场景。

## 7. 试行反馈

- 允许的降级：`process_clarification_answer` 中若 schema 不存在（schema_id 失效）→ fallback 到 `build_unknown_clarification` 并清理 ClarificationStore。
- 当前仅支持 "answer" action 携带 behavior_id。clarification 之外的行为类型（confirmation 等）仍走 `AuthorityGate` 路径，未与 ClarificationStore 耦合。
- `build_unknown_clarification` 的存储的 `intent_name` 和 `schema_id` 为 nil，此类 clarification 的 answer 只会回到 unknown 路径（无 slot 可累积），保持语义正确。
