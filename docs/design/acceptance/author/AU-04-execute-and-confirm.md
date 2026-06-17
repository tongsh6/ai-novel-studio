# AU-04 执行任务与系统确认

> 作者视角：当我让 AI 做具体工作时，AI 可以提出执行建议，但不能自己批准执行。系统必须把高风险、写入、长任务和生产事实变更拦在确认边界前；我确认后也不是直接执行，而是绑定原确认对象、重新审查当前状态，再决定是否执行。

> 2026-05-13 场景化对账结论：后端 Orchestrator / Gate / ActionValidator 已覆盖较多执行权不变量，Channel 也已有 `author_action` 局部闭环；但真实前端入口 `App.tsx -> WorkspaceChat` 仍调用旧 `confirm` / `reject` 事件，且主要渲染 `ui_cards` 而不是 `available_actions`。因此 AU-04 不能再按“86% 核心已实现”判断，应改为“后端门禁较强，真实工作台确认闭环不足”。
>
> 2026-05-25 纠偏更新：上述 2026-05-13 前端入口描述为 historical/superseded。真实入口已改为从 `available_actions` 渲染可提交动作，并通过 `author_action` 回传；card 不再作为业务 action 来源。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 让 AI 创建角色、生成大纲、整理设定 | AI 给出建议或执行结果，系统说明是否需要确认 |
| 要求直接替换正文、写入作品事实、执行高风险操作 | 系统显示确认对象、影响范围、确认/取消动作；确认前不写入生产事实 |
| 点击确认执行 | 系统绑定本次确认对象，重新 gate，再执行或说明仍被拦截 |
| 重复点击确认 | 系统按同一个幂等键处理，不能重复执行同一动作 |
| 点取消或拒绝 | 系统关闭该 pending 行为，回到自然讨论，不产生半执行状态 |
| 过一段时间再点旧确认 | 系统识别 stale / expired action，要求重新确认或重新生成计划 |
| 继续普通聊天 | 系统不因为历史 pending action 误执行最近任务 |

明确不能做的：

- AI 不能在回复里夹带“approved / ready_to_execute / production_write_allowed”绕过系统门禁。
- UI 不能直接调用工具或写生产状态，只能提交系统给出的 `AvailableAction` / `AuthorActionInput`。
- 点击确认不能等同于“无条件执行”；确认后必须重新审查权限、范围、预算、写入边界和当前作品状态。
- 旧会话、旧作品、旧 turn 的确认按钮不能确认当前作品里的新动作。

---

## 2. 不变量

| 编号 | 不变量 | 本验收如何验证 |
|---|---|---|
| AU04-I1 | MicroPlan 只是建议，不是授权 | SC-AU04-A1/A3/C2 |
| AU04-I2 | Orchestrator 是唯一执行门禁 | SC-AU04-C1/C2/C3 |
| AU04-I3 | 默认只允许下一步 | SC-AU04-A3 |
| AU04-I4 | 高风险、生产写入、采纳前写入必须确认 | SC-AU04-A1/B1 |
| AU04-I5 | UI 只能提交服务端给出的 action | SC-AU04-B2/C1 |
| AU04-I6 | confirmation answer 必须绑定 open confirmation 并重新 gate | SC-AU04-B2/B5/B6 |
| AU04-I7 | 重复、过期、跨 turn action 不得重复执行 | SC-AU04-B4/B5 |
| AU04-I8 | TurnResult 不能声称未发生的执行事实 | SC-AU04-D3 |
| AU04-I9 | 执行结果默认是 tentative / pending adoption，不直接成为生产事实 | SC-AU04-D2 |

---

## 3. 契约引用

| 契约 / 代码 | 用途 |
|---|---|
| `docs/design/04-execution-orchestrator.md` | 执行门禁、confirmation、re-gate、cancellation 的设计来源 |
| `docs/design/contracts/VS-01-execution-authority-contract-pack.md` | MicroPlan / OrchestratorDecision / truthfulness 规则 |
| `docs/design/contracts/VS-03-behavior-lifecycle-contract-pack.md` | BehaviorState、AvailableAction、ConfirmationBinding 最小契约 |
| `docs/design/adr/ADR-0005-execution-gate-order-v3.md` | gate 顺序和 confirmation answer 必须重新 gate |
| `docs/design/adr/ADR-0007-next-action-available-action-v3.md` | `confirm_before_execute` 等 author action 集合 |
| `docs/design/adr/ADR-0009-confirmation-binding-v3.md` | confirmation 绑定对象、状态快照和重新 gate |
| `apps/novel_application/lib/novel_application/execution_orchestrator.ex` | 后端门禁与 BehaviorState 打开 |
| `apps/novel_application/lib/novel_application/action_validator.ex` | 拒绝 stale / invented / disabled action |
| `apps/novel_application/lib/novel_application/dialogue_gateway.ex` | `handle_action/3` 执行确认后的 re-gate / tool dispatch |
| `apps/novel_web/lib/novel_web/channels/workspace_channel.ex` | `author_action` Channel 入口 |
| `frontend/src/components/WorkspaceChat.tsx` | 当前真实 App 入口使用的工作台 |
| `frontend/src/components/WorkspaceChat.tsx` + `frontend/src/lib/socket.ts` | 当前真实 App 入口使用的 action/task_state 前端实现 |

---

## 4. 验收场景

### 场景组 A：作者提出要执行的任务

#### SC-AU04-A1 — 高风险写入先要求确认

**用户视角**：作者在真实工作台输入“把第一章正文直接替换成悬疑风格”。

| 字段 | 内容 |
|---|---|
| 前置条件 | 已连接 LM Studio 或 stub provider；已打开某个作品 |
| 触发 | 输入高风险写入请求 |
| 期望结果 | AI 不直接声称已替换；系统进入 `needs_confirmation`；作者看到确认对象和影响范围 |
| 当前证据 | `execution_authority_test.exs` 覆盖 high-risk / production_candidate -> `require_confirmation`；`v3_full_chain_test.exs` 覆盖 stub confirmation chain |
| 当前状态 | 已测试，未完整真实入口验收 |
| 当前缺口 | **superseded（2026-05-25）**：真实入口已改为从 `available_actions` 渲染动作；仍缺完整真实 UI 点击验收 |
| 优先级 | P0 |

#### SC-AU04-A2 — 低风险单步工具可以执行，但结果仍是草稿

**用户视角**：作者说“帮我生成一个主角设定草案”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 单步低风险工具通过 gate，返回执行结果；如果产出创作内容，应进入待采纳草稿，不直接写成作品事实 |
| 当前证据 | `ExecutionOrchestrator.allow_tool`、`DialogueGateway.execute_tool`、`TurnResultBuilder.build_artifact_set/2`；`workspace_channel_v3_test.exs` 覆盖 task_state RUNNING/COMPLETED |
| 当前状态 | 后端/Channel 局部已测试，真实工作台未验收 |
| 当前缺口 | `WorkspaceChat` 未订阅 `task_state`，结果状态和 pending adoption 在真实入口的完整体验未验收 |
| 优先级 | P1 |

#### SC-AU04-A3 — 过大请求被降级为讨论

**用户视角**：作者说“把整本书写完，顺便更新所有角色和伏笔”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统不执行多步大任务，而是说明范围过大，建议先确定下一步 |
| 当前证据 | `execution_authority_test.exs` 覆盖 multi-step plan -> `downgrade_to_dialogue` |
| 当前状态 | 后端已测试，真实工作台文案/体验未验收 |
| 当前缺口 | 需要验证 TurnResult 文案不会机械化，也不会显示误导性的执行按钮 |
| 优先级 | P1 |

#### SC-AU04-A4 — 普通创作聊天不应误触发确认

**用户视角**：作者只是讨论“这个角色的动机可以怎么写？”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统自然回复，不打开 confirmation，不显示执行卡 |
| 当前证据 | AU-01 已发现 `WorkspaceChat` 的 `sendMessage` 默认 `generate_micro_plan: true` |
| 当前状态 | 存在设计偏差风险 |
| 当前缺口 | 与 AU-01/AU-02 共享：真实入口可能把普通聊天推入计划/执行路径 |
| 优先级 | P0 |

### 场景组 B：确认卡片与作者动作

#### SC-AU04-B1 — 确认卡片内容完整

**用户视角**：系统要求确认时，作者能看懂“要确认什么、影响哪里、确认后会发生什么、如何取消”。

| 字段 | 内容 |
|---|---|
| 期望结果 | UI 展示 confirmation card 或等价 action panel；包含 target、影响范围、确认、取消 |
| 当前证据 | `BehaviorState` 有 `prompt_contract` / `available_actions`；`TurnResultBuilder.maybe_add_behavior/2` 输出 behavior_state |
| 当前状态 | 部分实现 |
| 当前缺口 | `TurnResultBuilder` 未生成 `confirmation_card`；真实入口 `WorkspaceChat` 不渲染 `available_actions` 面板 |
| 优先级 | P0 |

#### SC-AU04-B2 — 点击确认必须走 `author_action`

**用户视角**：作者点击“确认执行”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 前端提交 `author_action`，包含 `source_turn_ref`、`action_id`、`action_type`、`behavior_ref`、`idempotency_key` |
| 当前证据 | `WorkspaceChat` 通过 `available_actions` 匹配后调用 `socket.ts.sendAuthorAction`；`WorkspaceChannel.handle_in("author_action")` 已实现 |
| 当前状态 | 备用前端已实现，真实 App 入口未接入 |
| 当前缺口 | `App.tsx` 当前渲染 `WorkspaceChat`；`WorkspaceChat` 的确认按钮调用旧 `confirm` 事件，但 `WorkspaceChannel` 未实现 `handle_in("confirm")` |
| 优先级 | P0 |

#### SC-AU04-B3 — 点击取消关闭本次等待态

**用户视角**：作者看到确认后点击“取消/先不弄”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 只取消该 pending confirmation；不会执行工具；输入框恢复自然对话 |
| 当前证据 | `BehaviorState` / `AvailableAction` 设计包含 `reject_or_cancel_confirmation`、`cancel_pending_behavior`；`ActionValidator` 能验证 cancel 类 action |
| 当前状态 | 局部 action validation 已测试，关闭 lifecycle 未闭环 |
| 当前缺口 | 缺 behavior resolved/cancelled 状态更新、trace、UI 关闭验证 |
| 优先级 | P0 |

#### SC-AU04-B4 — 重复点击确认不重复执行

**用户视角**：作者因为网络卡顿连续点击两次“确认执行”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 同一 `idempotency_key` 只产生一次执行或返回同一结果 |
| 当前证据 | action envelope 中有 `idempotency_key`；测试使用该字段 |
| 当前状态 | 未实现完整幂等 |
| 当前缺口 | 持久 author action receipt 已补；仍缺真实 UI 重复点击验收、TTL 和完整 ConfirmationBinding |
| 优先级 | P0 |

#### SC-AU04-B5 — 旧 turn / 旧作品的确认被拒绝

**用户视角**：作者回到历史对话或切换作品后，点了旧确认按钮。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统拒绝 stale action，要求重新生成计划或重新确认当前作品状态 |
| 当前证据 | `ActionValidator.check_not_stale/2`、`workspace_channel_v3_test.exs` stale source_turn_ref rejected |
| 当前状态 | 当前 Channel 内局部已测试 |
| 当前缺口 | 只和 `current_turn_id` 对比，缺跨作品、历史会话、TTL、持久化 ConfirmationBinding 验证 |
| 优先级 | P0 |

#### SC-AU04-B6 — 确认前上下文变化后必须重新 gate

**用户视角**：作者看到确认后，又修改了作品设定或切换了上下文，再点击确认。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统基于最新作品背景和状态快照重新 gate；若目标已变化，要求重新确认 |
| 当前证据 | `ADR-0009` 与 VS-03 contract 要求 `rebased_state_snapshot_ref` 和 gate_result_refs |
| 当前状态 | 设计已冻结，实现不完整 |
| 当前缺口 | `DialogueGateway.frame_from_turn_result/1` 用 source turn 恢复 frame，未看到最新上下文 snapshot rebasing |
| 优先级 | P0 |

### 场景组 C：执行权安全边界

#### SC-AU04-C1 — UI 不能提交发明出来的 action

**用户视角**：前端或恶意客户端提交一个 TurnResult 里没有的 action。

| 字段 | 内容 |
|---|---|
| 期望结果 | 后端拒绝 invented action |
| 当前证据 | `action_roundtrip_test.exs`、`workspace_channel_v3_test.exs` 覆盖 invented action rejected |
| 当前状态 | 后端/Channel 已测试 |
| 当前缺口 | 需要加入真实 UI 回归，确保前端只从服务端 action 渲染按钮 |
| 优先级 | P1 |

#### SC-AU04-C2 — AI 夹带批准语义被系统拦截

**用户视角**：AI 文本里出现“已批准执行”“可以直接写入作品”等越权表达。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统以 envelope_validation / forbidden semantics 拦截 |
| 当前证据 | `execution_authority_test.exs` 覆盖 `approved`、`production_write_allowed` |
| 当前状态 | 后端已测试 |
| 当前缺口 | 缺真实 LLM 样本和 UI 友好恢复文案验收 |
| 优先级 | P1 |

#### SC-AU04-C3 — Planner 风险提示不具备授权力

**用户视角**：AI 把写入动作标成低风险或不需要确认。

| 字段 | 内容 |
|---|---|
| 期望结果 | Orchestrator 根据 write boundary / authority 自行裁决，必要时仍要求确认 |
| 当前证据 | `execution_authority_test.exs` 覆盖 production_candidate -> require_confirmation |
| 当前状态 | 后端已测试 |
| 当前缺口 | 缺真实 LLM 输出下的端到端验收 |
| 优先级 | P1 |

### 场景组 D：确认后的执行反馈

#### SC-AU04-D1 — 确认后有任务状态反馈

**用户视角**：作者确认后能看到系统正在执行、完成或失败。

| 字段 | 内容 |
|---|---|
| 期望结果 | UI 接收并展示 RUNNING / COMPLETED / FAILED 等状态 |
| 当前证据 | 2026-05-25 起 synthetic task lifecycle 已移除；同步 creative tool 通过 TurnResult phase/status、ToolResult.status 与 trace_summary 表达结果。正式 TaskState / Long-running Creative Job Contract deferred |
| 当前状态 | 后端/备用前端局部实现 |
| 当前缺口 | 真实入口 `WorkspaceChat` 未订阅 `task_state`；没有 Playwright/人工 walkthrough 证明 |
| 优先级 | P1 |

#### SC-AU04-D2 — 执行产物默认进入待采纳，不直接写作品事实

**用户视角**：系统生成角色设定后，作者看到“待采纳”的草稿卡，而不是作品档案立刻被改。

| 字段 | 内容 |
|---|---|
| 期望结果 | `adoption_state.pending` 有草稿；`production_write_performed=false` |
| 当前证据 | `TurnResultBuilder.build_artifact_set/2`、`build_truthfulness/3`；E2E 覆盖 pending artifact |
| 当前状态 | 后端已测试，真实入口体验未完整验收 |
| 当前缺口 | 与 AU-05/AU-08 联动：采纳到作品事实和阅读投影仍需单独验收 |
| 优先级 | P1 |

#### SC-AU04-D3 — AI 回复不能撒谎

**用户视角**：如果系统只是要求确认、降级或拒绝，AI 不能说“已执行完成”。

| 字段 | 内容 |
|---|---|
| 期望结果 | TurnResult truthfulness 与实际 execution/tool/adoption 状态一致 |
| 当前证据 | `TurnResultBuilder.build_truthfulness/3`、`execution_authority_test.exs` truthfulness constraints |
| 当前状态 | 局部已实现 |
| 当前缺口 | 未看到对 assistant_message 文本本身的强约束测试；真实 LLM 可能仍生成误导文案 |
| 优先级 | P1 |

### 场景组 E：追溯与恢复

#### SC-AU04-E1 — 确认行为可追溯

**用户视角**：作者或开发者能回看某次为什么要求确认、确认了什么、最终是否执行。

| 字段 | 内容 |
|---|---|
| 期望结果 | trace 包含 decision、behavior、author action、gate result、tool result |
| 当前证据 | `TraceWriter.record_with_decision/5`、`TraceWriter.record_with_tool/7`；设计文档要求 ConfirmationBinding trace |
| 当前状态 | 决策/工具 trace 局部存在，confirmation binding trace 不完整 |
| 当前缺口 | 缺 BehaviorTrace / ConfirmationBinding / idempotency trace 端到端验收 |
| 优先级 | P1 |

#### SC-AU04-E2 — 执行失败后能恢复

**用户视角**：确认后工具失败、LLM 超时或系统异常，作者能看到失败原因和下一步选择。

| 字段 | 内容 |
|---|---|
| 期望结果 | UI 展示失败/重试/缩小范围/继续对话；不产生半写入 |
| 当前证据 | 设计有 `fail_with_recovery`、`retry_action`；`Toolbox.execute` 能返回失败状态 |
| 当前状态 | 不确定 |
| 当前缺口 | 缺真实确认后工具失败的 Channel + UI 验收 |
| 优先级 | P1 |

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 当前状态 | 是否闭环 |
|---|---|---|---|
| SC-AU04-A1 | 高风险写入先确认 | 已测试 | 否，真实 UI 入口未闭环 |
| SC-AU04-A2 | 低风险单步执行并产出草稿 | 已测试 | 否，真实 UI/task/adoption 体验未验收 |
| SC-AU04-A3 | 过大请求降级 | 已测试 | 否，真实 UI 文案未验收 |
| SC-AU04-A4 | 普通聊天不误触发确认 | 存在风险 | 否 |
| SC-AU04-B1 | 确认卡内容完整 | 部分实现 | 否 |
| SC-AU04-B2 | 点击确认走 `author_action` | 部分实现 | 否，真实入口仍用旧事件 |
| SC-AU04-B3 | 点击取消关闭等待态 | 部分实现 | 否 |
| SC-AU04-B4 | 重复确认幂等 | 未实现/未验证 | 否 |
| SC-AU04-B5 | stale confirmation 拒绝 | 已测试 | 否，缺跨作品/TTL/持久化 binding |
| SC-AU04-B6 | 确认前上下文变化后重新 gate | 已设计 | 否 |
| SC-AU04-C1 | invented action 拒绝 | 已测试 | 局部闭环 |
| SC-AU04-C2 | AI 自批准语义拦截 | 已测试 | 局部闭环 |
| SC-AU04-C3 | Planner hint 不授权 | 已测试 | 局部闭环 |
| SC-AU04-D1 | 确认后任务状态反馈 | 部分实现 | 否 |
| SC-AU04-D2 | 产物进入待采纳 | 已测试 | 否，真实入口/后续采纳未完整验收 |
| SC-AU04-D3 | AI 回复不撒谎 | 部分实现 | 否 |
| SC-AU04-E1 | 确认行为可追溯 | 部分实现 | 否 |
| SC-AU04-E2 | 执行失败后恢复 | 不确定 | 否 |

**结论：18 个场景；0/18 完整真实前后端验收；11/18 有后端或备用前端局部证据；7/18 属于真实入口、幂等、lifecycle、trace 或异常恢复缺口。**

---

## 6. 缺口

| 缺口 | 具体表现 | 类型 | 优先级 |
|---|---|---|---|
| AU04-GAP-01 — 真实入口确认动作未接入 `author_action` | **superseded（2026-05-25）**：真实入口已改为通过 `available_actions` + `author_action` 提交；剩余为 UI 点击验收 | 补验收 | P0 |
| AU04-GAP-02 — 确认卡/动作在真实入口不可见或不可点 | **superseded（2026-05-25）**：真实入口已渲染 available action panel；card 不再承载业务动作 | 补验收 | P0 |
| AU04-GAP-03 — 确认幂等未闭环 | **局部已补**：持久 `author_action_receipts` 以 `work_id/session_id/source_turn/action/idempotency_key` 去重，重复确认不会二次 dispatch；仍缺真实 UI 重复点击验收和 TTL | 继续补验收/TTL | P0 |
| AU04-GAP-04 — ConfirmationBinding 未完整实现 | 缺 `behavior_ref` + `target_ref` + rebased snapshot + gate result 的持久绑定 | 补实现/补集成 | P0 |
| AU04-GAP-05 — 取消/拒绝 lifecycle 未闭环 | cancel/reject 可被 validation，但未证明 behavior 关闭、trace 写入、UI 恢复 | 补集成/补验收 | P0 |
| AU04-GAP-06 — 过期/跨作品/历史确认验证不足 | 只覆盖 current turn stale，缺 TTL、跨作品、历史会话只读态 | 补实现/补验收 | P0/P1 |
| AU04-GAP-07 — task_state 真实入口完整展示不足 | Channel 可广播，`WorkspaceChat` 已订阅并映射到 longRun store；仍缺长跑全过程 UI 验收 | 补验收 | P1 |
| AU04-GAP-08 — assistant_message 文本真值约束不足 | truthfulness map 存在，但缺 LLM 文案不撒谎测试 | 补测试 | P1 |
| AU04-GAP-09 — 确认后失败恢复缺场景 | 缺工具失败、LLM 超时、恢复 action 的 UI/Channel 验收 | 补验收 | P1 |

---

## 7. 已知基础设施

| 基础设施 | 当前价值 | 不应误判 |
|---|---|---|
| `ExecutionOrchestrator.decide/2` | 已能根据 GateOrder 产生 allow/downgrade/confirm/recovery | 不等于真实 UI 确认闭环 |
| `ActionValidator.validate/2` | 能拒绝 missing/stale/invented/disabled action | 不等于幂等、TTL、跨作品安全完成 |
| `DialogueGateway.handle_action/3` | `confirm_before_execute` 可 re-gate 并在 allow_tool 时 dispatch | 不等于 ConfirmationBinding 完整实现 |
| `WorkspaceChannel.handle_in("author_action")` | Channel 层 action roundtrip 已有测试 | 不等于当前 App 入口已经使用 |
| `WorkspaceChat` + `socket.ts` | 当前真实入口已接 `available_actions` / `author_action` / `task_state`；真实导出 task_state checkpoint 已补 | 缺完整 action_result、完整异步 LongRunner、断线/超时恢复 UI 验收 |
| `workspace_channel_v3_test.exs` | 覆盖 task_state、stale/invented action 等局部链路 | 不等于 Playwright/真人工作台验收 |

---

## 8. 验收命令

这些命令只能证明后端/Channel 局部能力，不能证明 AU-04 完整通过：

```bash
mix test apps/novel_application/test/novel_application/execution_authority_test.exs
mix test apps/novel_application/test/novel_application/action_roundtrip_test.exs
mix test apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs
```

完整 AU-04 验收还需要补充：

```text
1. 真实工作台 walkthrough：高风险请求 -> 确认卡/动作可见 -> 点击确认 -> task_state -> 结果/待采纳。
2. 重复点击确认：同一 idempotency_key 只执行一次。
3. stale / expired / cross-work confirmation：旧动作不能确认当前作品任务。
4. cancel/reject：关闭 pending confirmation，trace 可回放，UI 恢复自然对话。
5. failure recovery：确认后工具失败时，UI 显示可恢复路径且无半写入。
```
