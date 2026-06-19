# AU-06 对话行为生命周期

> 作者视角：当 AI 需要我确认、补充信息、取消等待或处理失败时，系统会进入一个明确的“等待作者”状态。我能看到它为什么等我、等哪个对象、我有哪些动作；我操作后，这个状态必须关闭、转入历史，并可回放，而不是永远挂在当前对话里。

> 2026-05-13 场景化对账结论：`BehaviorState` struct、Orchestrator 打开 confirmation、ActionValidator 拒绝 stale/invented action 已有局部证据；但真实工作台入口未可靠消费 behavior_state，确认/取消/澄清后的 resolution/history/trace/TTL/单活跃行为都未闭环。AU-06 不能再按“86% 核心已实现”判断，应视为“打开行为已部分实现，完整 lifecycle 未完成”。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 看到“需要确认/需要补充”的状态 | 清楚展示等待原因、目标对象、影响范围和可用动作 |
| 点击确认 | 系统绑定该 open behavior，进入 resolving，重新 gate 后关闭或产生新的等待 |
| 点击取消/拒绝 | 系统关闭该 behavior，记录取消原因，不产生写入副作用 |
| 回答澄清问题 | 系统把回答绑定到原 clarification，重新评估，而不是当普通聊天丢掉 |
| 暂时不处理，继续聊天 | 系统明确保留或取消等待态，不误执行 pending action |
| 过很久再点旧按钮 | 系统识别 stale/expired，不执行过期动作 |
| 回看历史会话 | 能看到当时打开了什么 behavior、我做了什么、最终如何关闭 |

明确不能做的：

- UI 不能自己打开、关闭或修改 `BehaviorState`。
- Planner / LLM 不能直接创建 resolved/cancelled 行为事实。
- 同一 workstream 不能同时有多个 primary author-blocking behavior。
- `completed` 不能掩盖仍然 open 的 confirmation / clarification。
- 旧作品、旧会话、旧 turn 的 action 不能关闭当前作品的新 behavior。

---

## 2. 不变量

| 编号 | 不变量 | 本验收如何验证 |
|---|---|---|
| AU06-I1 | Durable behavior 必须有 open/resolving/resolved/cancelled/failed/superseded 生命周期 | SC-AU06-C1/C2 |
| AU06-I2 | `awaiting_author` 必须有 active BehaviorState 和 author-facing action | SC-AU06-A1/A4 |
| AU06-I3 | 普通探索不自动打开 clarification / confirmation | SC-AU06-A3 |
| AU06-I4 | UI 只能提交服务端给出的 available action | SC-AU06-B1/B5 |
| AU06-I5 | confirmation answer 必须绑定 open confirmation 并重新 gate | SC-AU06-B1/C2 |
| AU06-I6 | cancel/reject 必须关闭具体 behavior 且无写入副作用 | SC-AU06-B2 |
| AU06-I7 | 同一 workstream 只能有一个 primary author-blocking behavior | SC-AU06-C3 |
| AU06-I8 | stale/expired/duplicate action 不能产生新执行 | SC-AU06-B5/C5 |
| AU06-I9 | Behavior lifecycle 必须可 trace/replay，且 replay 不调 LLM | SC-AU06-D1 |

---

## 3. 契约引用

| 契约 / 代码 | 用途 |
|---|---|
| `docs/design/contracts/VS-03-behavior-lifecycle-contract-pack.md` | BehaviorState、AvailableAction、ConfirmationBinding、Proof 总入口 |
| `docs/design/adr/ADR-0006-turn-phase-status-v3.md` | TurnPhase / TurnStatus 与 active behavior 关系 |
| `docs/design/adr/ADR-0007-next-action-available-action-v3.md` | `confirm_before_execute`、`cancel_pending_behavior` 等动作集合 |
| `docs/design/adr/ADR-0008-behavior-state-v3.md` | BehaviorState 作为 durable waiting state |
| `docs/design/adr/ADR-0009-confirmation-binding-v3.md` | confirmation answer 绑定与 re-gate |
| `apps/novel_domain/lib/novel_domain/behavior_state.ex` | BehaviorState struct 与 open/closed predicate |
| `apps/novel_application/lib/novel_application/execution_orchestrator.ex` | 打开 confirmation behavior 与生成 available_actions |
| `apps/novel_application/lib/novel_application/action_validator.ex` | stale / invented / disabled action 验证 |
| `apps/novel_application/lib/novel_application/dialogue_gateway.ex` | `confirm_before_execute` re-gate / tool dispatch 局部路径 |
| `apps/novel_application/test/novel_application/behavior_lifecycle_test.exs` | BehaviorState open/closed predicate 和 Orchestrator open 行为测试 |
| `apps/novel_application/test/novel_application/action_roundtrip_test.exs` | action validation / gateway 局部测试 |
| `frontend/src/components/WorkspaceChat.tsx` | 当前真实工作台对 behavior_state 的消费入口 |

---

## 4. 验收场景

### 场景组 A：等待态可见且语义正确

#### SC-AU06-A1 — 高风险操作打开 confirmation behavior

**用户视角**：作者要求“直接替换第一章正文”。

| 字段 | 内容 |
|---|---|
| 前置条件 | 已打开作品，模型或 stub 可用 |
| 触发 | 输入高风险/写入类请求 |
| 期望结果 | TurnResult 进入 `awaiting_author / needs_confirmation`；active behavior 指向确认对象；可见确认/取消动作 |
| 当前证据 | `behavior_lifecycle_test.exs` 覆盖 high-risk confirmation plan opens behavior；`v3_full_chain_test.exs` 覆盖 confirmation chain |
| 当前状态 | 后端局部已测试 |
| 当前缺口 | 真实入口 `WorkspaceChat` 不渲染 `available_actions` 面板；`TurnResultBuilder` 未生成 confirmation_card |
| 优先级 | P0 |

#### SC-AU06-A2 — 缺关键补充信息时打开 clarification behavior

**用户视角**：作者说“帮我改一下那个角色”，但系统不知道“哪个角色”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统打开 clarification，要求作者补充 target，而不是硬猜或直接表单化 |
| 当前证据 | VS-03 contract 定义 clarification；`BehaviorState` 支持 `:clarification` |
| 当前状态 | 设计存在，当前实现不确定/不足 |
| 当前缺口 | 当前 `ExecutionOrchestrator` 主要打开 confirmation；未看到 blocking clarification 主链测试 |
| 优先级 | P1 |

#### SC-AU06-A3 — 普通创作讨论不打开 waiting behavior

**用户视角**：作者只是讨论“这个角色动机可以怎么写？”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统自然对话，不进入 awaiting_author，不显示确认/澄清卡 |
| 当前证据 | `behavior_lifecycle_test.exs` 覆盖 downgrade does not open behavior |
| 当前状态 | 局部已测试 |
| 当前缺口 | AU-01 已发现真实入口默认 `generate_micro_plan: true`，普通聊天可能误入计划/行为路径 |
| 优先级 | P0 |

#### SC-AU06-A4 — 真实工作台能识别 active behavior

**用户视角**：作者看到工作台顶部/卡片/按钮明确显示“正在等待你确认/补充”。

| 字段 | 内容 |
|---|---|
| 期望结果 | `WorkspaceChat` 能从 TurnResult 识别 active behavior，并渲染可用动作 |
| 当前证据 | `WorkspaceChat` 读取 `result.behavior_state?.active`；`TurnResultBuilder.maybe_add_behavior/2` 通过 `BehaviorState.snapshot/1` 输出 `{active, history}`；`BehaviorStateTest` 防止扁平形状回归 |
| 当前状态 | 后端/前端 behavior_state 基础形状已对齐 |
| 当前缺口 | 仍缺完整真实 UI action matrix，尤其 clarification、disabled/stale、TTL、跨作品/历史会话和 replay 视图 |
| 优先级 | P0 |

### 场景组 B：作者动作能正确关闭或推进等待态

#### SC-AU06-B1 — 点击确认绑定 open confirmation

**用户视角**：作者点击“确认执行”。

| 字段 | 内容 |
|---|---|
| 期望结果 | action 包含 `source_turn_ref`、`action_id`、`action_type`、`behavior_ref`、`target_ref`、`idempotency_key`；系统验证并进入 resolving |
| 当前证据 | `ActionValidator` 能检查 action 来自 server-held TurnResult，并要求 `behavior_ref`、`target_ref`、`candidate_*`、`idempotency_key` 与服务端 available action 精确一致；`DialogueGateway.handle_action/3` 对 `confirm_before_execute` 做 re-gate |
| 当前状态 | 部分实现 |
| 当前缺口 | 已补 action 绑定校验；确认 re-gate 仍未持久化 ConfirmationBinding 的 state snapshot / gate result，也未输出完整 resolving lifecycle |
| 优先级 | P0 |

#### SC-AU06-B2 — 点击取消/拒绝关闭 behavior

**用户视角**：作者点击“取消”或“拒绝”。

| 字段 | 内容 |
|---|---|
| 期望结果 | behavior 进入 `cancelled` 或 `resolved(rejected)`；写入 resolution、closed_at_turn_ref、trace_ref；不执行工具或生产写入 |
| 当前证据 | Orchestrator 生成 `reject_or_cancel_confirmation` / `cancel_pending_behavior`；ActionValidator 可接受 cancel 类 action；`DialogueGateway.handle_action/3` 对通用取消/拒绝生成 `cancelled` TurnResult，`behavior_state.active=nil` 且 `history[]` 包含 `CANCELLED`、`closed_at_turn_ref`、`resolution_ref`；`AdoptionWorkflow` 对采纳确认 confirm/reject 输出 `RESOLVED` / `CANCELLED` history；`WorkspaceChannel` 会广播这些 TurnResult；`au10-workbench-recovery-cancel-waiting` 已通过真实 Tauri 验收 |
| 当前状态 | 通用取消/拒绝与采纳确认 terminal history checkpoint 已实现 |
| 当前缺口 | clarification answer、TTL、跨作品/历史会话、完整 trace/replay 仍未闭环 |
| 优先级 | P0 |

#### SC-AU06-B3 — 回答澄清后重新评估

**用户视角**：作者回答“我说的是女主林烬”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 回答绑定原 clarification，behavior 进入 resolving，重新形成 frame/plan/decision |
| 当前证据 | VS-03 contract 定义 `answer_clarification` |
| 当前状态 | 未实现/未验收 |
| 当前缺口 | `WorkspaceChat` 有 `pendingAnswerBid` 逻辑，但后端 `user_message` 没有处理 `behavior_id`，也没有 clarification resolution |
| 优先级 | P1 |

#### SC-AU06-B4 — 等待期间继续聊天不误执行

**用户视角**：作者暂时不处理确认，继续问“如果不替换正文，还有什么方案？”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统明确保留、取消或 supersede 当前 behavior；不会把普通消息当确认 |
| 当前证据 | ADR-0005/VS-03 要求先处理 open behavior compatibility |
| 当前状态 | 未实现/未验收 |
| 当前缺口 | 当前 Channel 只按 current_turn 存 action；没有 open behavior ledger 或 compatibility gate |
| 优先级 | P0 |

#### SC-AU06-B5 — 旧按钮、伪造按钮、禁用按钮被拒绝

**用户视角**：作者或客户端提交旧 turn / 发明出来 / disabled 的 action。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统拒绝，不关闭当前 behavior，不执行工具 |
| 当前证据 | `action_roundtrip_test.exs`、`workspace_channel_v3_test.exs` 覆盖 stale/invented/disabled/source missing |
| 当前状态 | 局部已测试 |
| 当前缺口 | 只基于当前 socket 的 `current_turn_id` 和 `available_actions`；缺 TTL、跨作品、历史会话、持久化 behavior 校验 |
| 优先级 | P0 |

### 场景组 C：生命周期完整性

#### SC-AU06-C1 — open 到 resolved/cancelled 进入 history

**用户视角**：作者确认或取消后，等待状态从当前 UI 消失，历史里能看到处理结果。

| 字段 | 内容 |
|---|---|
| 期望结果 | active behavior 关闭；history 追加 resolved/cancelled 项；closed_at_turn_ref 和 resolution 非空 |
| 当前证据 | `BehaviorState.snapshot/1` 输出 `{active, history}`；通用取消/拒绝和采纳确认 confirm/reject 都能在 TurnResult 中产生 terminal history，包含 `closed_at_turn_ref` / `resolution_ref` |
| 当前状态 | 主链 terminal history checkpoint 已实现 |
| 当前缺口 | behavior history 持久化、developer replay、clarification resolving 和完整跨作品/历史会话矩阵仍未闭环 |
| 优先级 | P0 |

#### SC-AU06-C2 — 确认后重新 gate，不直接执行

**用户视角**：作者确认后，系统发现上下文变了，于是要求重新确认或降级。

| 字段 | 内容 |
|---|---|
| 期望结果 | ConfirmationBinding 绑定 open behavior 和 target；基于最新 state snapshot 重新 gate |
| 当前证据 | `DialogueGateway.handle_action/3` 有 re-gate 局部路径；ADR-0009 已 Accepted |
| 当前状态 | 部分实现 |
| 当前缺口 | 未实现 ConfirmationBinding、rebased_state_snapshot_ref、gate_result_refs；re-gate 使用 source turn 恢复 frame，不读取最新上下文 |
| 优先级 | P0 |

#### SC-AU06-C3 — 同一 workstream 只有一个 primary author-blocking behavior

**用户视角**：一个确认未处理时，又触发另一个确认。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统拒绝新 behavior、关闭旧 behavior 或 supersede，并留下 trace |
| 当前证据 | VS-03 contract 和 ADR-0008 要求 single active behavior |
| 当前状态 | 未实现/未验收 |
| 当前缺口 | 当前 `ExecutionOrchestrator.open_behavior/5` 不检查已有 open behavior |
| 优先级 | P0 |

#### SC-AU06-C4 — TTL / expires_at 控制过期等待

**用户视角**：两天前的确认按钮现在被点击。

| 字段 | 内容 |
|---|---|
| 期望结果 | action 显示 disabled/expired 或后端拒绝，要求重新生成计划 |
| 当前证据 | VS-03 contract 允许 `expires_at`；ActionValidator 可拒绝 stale current_turn |
| 当前状态 | 部分测试，不是真 TTL |
| 当前缺口 | available_actions 没有 `expires_at`；无时间/TTL 判断 |
| 优先级 | P1 |

#### SC-AU06-C5 — 重复动作幂等

**用户视角**：作者双击确认或网络重试同一 action。

| 字段 | 内容 |
|---|---|
| 期望结果 | 同一 `idempotency_key` 只产生一次 resolution/execution |
| 当前证据 | action envelope 含 `idempotency_key` |
| 当前状态 | 未实现/未验证 |
| 当前缺口 | 缺 idempotency ledger；`DialogueGateway.handle_action/3` 没有重复动作去重 |
| 优先级 | P0 |

### 场景组 D：追溯、回放与跨边界安全

#### SC-AU06-D1 — 行为生命周期可回放且不调 LLM

**用户视角**：作者回看历史会话，能看到当时等待了什么、自己点了什么、最终结果是什么。

| 字段 | 内容 |
|---|---|
| 期望结果 | ReplayService 从 trace/history 还原，不调用 LLM |
| 当前证据 | AU-07 有 replay 局部测试；VS-03 要求 behavior trace replay |
| 当前状态 | 不确定/未闭环 |
| 当前缺口 | 缺 BehaviorTrace open/resolving/closed 事件和 history 持久化 |
| 优先级 | P1 |

#### SC-AU06-D2 — 跨作品/跨会话 action 不能关闭当前 behavior

**用户视角**：作者切换作品或打开历史会话后，点旧确认/取消按钮。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统验证 work_id/session_id/source_turn_ref，不影响当前作品的 open behavior |
| 当前证据 | SU-02/AU-03 已记录 work/session 隔离缺口 |
| 当前状态 | 未实现/未验收 |
| 当前缺口 | behavior 没有持久化 work/session ledger；Channel 只看 socket current_turn |
| 优先级 | P0 |

#### SC-AU06-D3 — 前端不能本地修改 lifecycle

**用户视角**：UI 显示等待态和按钮，但所有状态变化来自后端 TurnResult。

| 字段 | 内容 |
|---|---|
| 期望结果 | 前端只提交 action；不本地把 awaiting_author 改成 resolved |
| 当前证据 | `WorkspaceChat` 使用 `available_actions` / `sendAuthorAction`；真实入口通过收到 TurnResult 更新消息 |
| 当前状态 | 部分符合 |
| 当前缺口 | `WorkspaceChat` 当前对 confirm/reject 调旧事件且没有接收关闭后 TurnResult，真实 lifecycle 展示不完整 |
| 优先级 | P1 |

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 当前状态 | 是否闭环 |
|---|---|---|---|
| SC-AU06-A1 | 高风险打开 confirmation | 已测试 | 否，真实 UI 未闭环 |
| SC-AU06-A2 | 缺信息打开 clarification | 已设计/不确定 | 否 |
| SC-AU06-A3 | 普通讨论不打开等待态 | 局部已测试 | 否 |
| SC-AU06-A4 | 真实工作台识别 active behavior | 存在契约偏差 | 否 |
| SC-AU06-B1 | 点击确认绑定 open behavior | 部分实现 | 否 |
| SC-AU06-B2 | 取消/拒绝关闭 behavior | terminal history checkpoint 已补 | 否，完整矩阵未闭环 |
| SC-AU06-B3 | 回答澄清后重新评估 | 未实现/未验收 | 否 |
| SC-AU06-B4 | 等待期间继续聊天不误执行 | 未实现/未验收 | 否 |
| SC-AU06-B5 | stale/invented/disabled action 拒绝 | 局部已测试 | 否，缺 TTL/跨作品/持久化 |
| SC-AU06-C1 | open 到 closed 进入 history | terminal history checkpoint 已补 | 否，缺持久化/replay |
| SC-AU06-C2 | 确认后重新 gate | 部分实现 | 否 |
| SC-AU06-C3 | 单一活跃 behavior | 已设计 | 否 |
| SC-AU06-C4 | TTL / expires_at | 已设计 | 否 |
| SC-AU06-C5 | 重复动作幂等 | 字段存在 | 否 |
| SC-AU06-D1 | lifecycle 可回放 | 不确定/未闭环 | 否 |
| SC-AU06-D2 | 跨作品/跨会话隔离 | 未实现/未验收 | 否 |
| SC-AU06-D3 | 前端不本地改 lifecycle | 部分符合 | 否 |

**结论：17 个场景；0/17 完整真实前后端验收；7/17 有 domain/application/channel/front-end 局部证据；10/17 的关键缺口集中在真实 UI action matrix、clarification、ConfirmationBinding state snapshot / gate result、TTL、幂等、单活跃 behavior、持久化 history 和 replay。**

---

## 6. 缺口

| 缺口 | 具体表现 | 类型 | 优先级 |
|---|---|---|---|
| AU06-GAP-01 — 真实入口 behavior_state 契约不匹配 | `WorkspaceChat` 读 `behavior_state.active`，后端 v3 输出扁平 behavior_state | 修正/补集成 | P0 |
| AU06-GAP-02 — 真实入口不渲染 available_actions | **superseded（2026-05-25）**：`WorkspaceChat` 已改为从 `available_actions` 显示 v3 action panel；card 不承载业务动作。剩余为真实 UI 点击验收 | 补验收 | P0 |
| AU06-GAP-03 — cancel/reject/clarification resolution 未实现 | 非 confirm action 只 ack，不关闭 behavior；`behavior_id` 随 user_message 发送后后端不处理 | 补实现/补集成 | P0 |
| AU06-GAP-04 — open -> resolving -> resolved/history 未闭环 | 无 resolution builder、closed_at_turn_ref、history 输出和持久化 | 补实现/补测试 | P0 |
| AU06-GAP-05 — ConfirmationBinding 未完整实现 | **局部已补**：`behavior_ref`、`target_ref`、`candidate_*`、`idempotency_key` 已在 action validation 层与服务端 available action 精确绑定；仍缺 state snapshot / gate result / 持久 ConfirmationBinding | 补实现/补集成 | P0 |
| AU06-GAP-06 — 单一活跃 behavior 未强制 | 打开新 behavior 前不检查已有 open behavior | 补实现/补测试 | P0 |
| AU06-GAP-07 — TTL / expires_at 缺失 | available_actions 无 expires_at，无时间过期判断 | 补实现/补测试 | P1 |
| AU06-GAP-08 — 幂等 ledger 缺失 | **局部已补**：持久 `author_action_receipts` 可按 `idempotency_key` 去重；仍缺真实 UI 重复点击验收和 behavior resolution 结合 | 继续补验收/behavior 绑定 | P0 |
| AU06-GAP-09 — behavior/action 跨作品和跨会话隔离不足 | 持久 receipt key 已纳入 work/session scope；仍缺完整 work/session scoped BehaviorBinding ledger | 补集成/补验收 | P0 |
| AU06-GAP-10 — BehaviorTrace / replay 缺失 | open/resolving/closed 事件不可完整回放 | 补集成/补验收 | P1 |
| AU06-GAP-11 — blocking clarification 主链不明确 | 设计有 clarification，当前测试主要覆盖 confirmation | 状态核查/补实现 | P1 |

---

## 7. 已知基础设施

| 基础设施 | 当前价值 | 不应误判 |
|---|---|---|
| `BehaviorState` struct | 字段覆盖 lifecycle 设计 | 不是状态机，没有 transition guard |
| `BehaviorState.open?/closed?` | 能判断 open/closed 终态 | 不会自动关闭或写 history |
| `ExecutionOrchestrator.open_behavior/5` | 能打开 confirmation 并生成 actions | 不检查已有 open behavior、TTL、trace_ref |
| `ActionValidator` | 拒绝 stale/invented/disabled action，并校验 `behavior_ref` / `target_ref` / `candidate_*` / `idempotency_key` 绑定 | 不实现 TTL、state snapshot 或 behavior history |
| `DialogueGateway.handle_action/3` | confirm 有 re-gate / dispatch 局部路径 | cancel/reject/clarification resolution 未实现 |
| `WorkspaceChat` | 当前真实工作台 action panel 实现 | 缺完整 behavior lifecycle 和长跑状态矩阵 |

---

## 8. 验收命令

这些命令只能证明局部 behavior/action 能力，不能证明 AU-06 完整通过：

```bash
mix test apps/novel_application/test/novel_application/behavior_lifecycle_test.exs
mix test apps/novel_application/test/novel_application/action_roundtrip_test.exs
mix test apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs
```

完整 AU-06 验收还需要补充：

```text
1. 真实工作台：高风险请求 -> active behavior 可见 -> confirm/cancel 按钮来自 available_actions。
2. cancel/reject：关闭 behavior，TurnResult history 增加 resolved/cancelled 项，无工具/写入。
3. clarification：缺 target -> clarification open；作者回答 -> resolving -> re-gate。
4. pending 期间继续聊天：明确 retain / cancel / supersede，不误执行。
5. TTL/幂等/跨作品：expired、duplicate、cross-work action 不产生执行。
6. replay：open/resolving/closed 全链路可回放且不调 LLM。
```
