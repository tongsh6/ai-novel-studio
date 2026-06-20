# AU-04 执行任务与系统确认

> 作者视角：当我让 AI 做具体工作时，AI 可以提出执行建议，但不能自己批准执行。系统必须把高风险、写入、长任务和生产事实变更拦在确认边界前；我确认后也不是直接执行，而是绑定原确认对象、重新审查当前状态，再决定是否执行。

> 2026-05-13 场景化对账结论：后端 Orchestrator / Gate / ActionValidator 已覆盖较多执行权不变量，Channel 也已有 `author_action` 局部闭环；但真实前端入口 `App.tsx -> WorkspaceChat` 仍调用旧 `confirm` / `reject` 事件，且主要渲染 `ui_cards` 而不是 `available_actions`。因此 AU-04 不能再按“86% 核心已实现”判断，应改为“后端门禁较强，真实工作台确认闭环不足”。
>
> 2026-05-25 纠偏更新：上述 2026-05-13 前端入口描述为 historical/superseded。真实入口已改为从 `available_actions` 渲染可提交动作，并通过 `author_action` 回传；card 不再作为业务 action 来源。
>
> 2026-06-19 对账更新：`au04-confirm-before-execute` 已成为质量场景，证明真实 Tauri 工作台从自然语言高风险重写请求进入 `needs_confirmation`，确认前无工具调用/无生产写入，点击“确认执行”发送服务端授权的 `author_action.confirm_before_execute`，确认后重新 gate 并只产出待采纳 `prose_fragment`。AU-04 不能再沿用旧覆盖率口径；后续重复确认、当前-turn stale、expired、history-readonly 和 cross-work confirmation 均已补真实页面验收，持久 ConfirmationBinding snapshot、context-change/replay 和失败恢复仍未闭环。
>
> 2026-06-20 对账更新：`AU04-confirmation-binding-rebase-proof` 已把 `ConfirmationBinding` 的 `rebased_state_snapshot_ref` / `gate_result_refs` 从文档要求推进为 domain 强契约，并在 `DialogueGateway.handle_action/3` 确认 ack 与 `ExecutionOrchestrator.reason_codes` 中留下 re-gate 证明。该 checkpoint 只有局部后端/Channel 证据，不冒充真实页面 context-change 矩阵；B6 当前从“部分实现”推进到“已测试”。
>
> 2026-06-20 对账更新：`au04-confirm-idempotency-ui` 已补真实 Tauri 工作台重复确认验收：外部自动化在可见确认卡上快速点击“确认执行”两次，真实 websocket 发送 2 个 confirm action，Channel 将第二个识别为 `duplicate=true`，最终只有 1 次非 duplicate receipt、1 次 `prose_writing` dispatch、1 份 pending `prose_fragment`。该 checkpoint 关闭 B4 的“重复确认不重复执行”用户场景；持久 ConfirmationBinding snapshot 仍归后续缺口。
>
> 2026-06-20 对账更新：`au04-stale-confirmation-ui` 已补真实 Tauri 工作台旧确认 stale 验收：作者先收到高风险重写确认卡，再发送一条普通 follow-up 推进当前 turn，随后点击旧“确认执行”；真实 websocket 发送旧 confirm action，Channel 返回 `stale action: source_turn_ref turn_3 != current turn_13`，且 stale 后 `toolbox_execute_after_stale_count=0`、`pending_prose_fragment_after_stale_count=0`。该 checkpoint 关闭“当前 turn 已推进时旧确认不能执行”的 B5 主路径；expired confirmation 已由 `au04-confirmation-ttl-ui` 补齐，历史只读 confirmation 已由 `au04-history-confirmation-readonly` 补齐，跨作品 confirmation 已由 `au04-cross-work-confirmation-guard` 补齐，持久 ConfirmationBinding snapshot 仍归 GAP-06 后续矩阵。
>
> 2026-06-20 对账更新：`au04-confirmation-ttl-ui` 已补真实 Tauri 工作台过期确认验收：外部 seed 只在测试数据库恢复一个已过期的真实 `available_action.expires_at` confirmation TurnResult，产品 UI 不感知验收场景；作者点击可见“确认执行”后真实 `author_action.confirm_before_execute` 被 Channel 以 `expired action` 拒绝，且 `toolbox_execute_after_expired_count=0`、`pending_prose_fragment_after_expired_count=0`。该 checkpoint 关闭 B5/GAP-06 的 expired confirmation 部分；历史只读 confirmation 已由 `au04-history-confirmation-readonly` 补齐，跨作品 confirmation 已由 `au04-cross-work-confirmation-guard` 补齐，持久 ConfirmationBinding snapshot 仍归后续矩阵。
>
> 2026-06-20 对账更新：`au04-history-confirmation-readonly` 已补真实 Tauri 工作台历史只读确认验收：外部 seed 建立一个 `EXITED` 历史会话，里面包含未来未过期的 confirmation `available_actions`；作者从真实会话列表打开该历史 transcript 后只能只读回看，确认/拒绝按钮不渲染，输入和发送禁用，且 `author_action_sent_count=0`、`toolbox_execute_after_history_open_count=0`、`pending_prose_fragment_after_history_open_count=0`。该 checkpoint 关闭 B5/GAP-06 的历史会话只读 confirmation 部分；跨作品 confirmation 已由 `au04-cross-work-confirmation-guard` 补齐，持久 ConfirmationBinding snapshot 仍归后续矩阵。
>
> 2026-06-20 对账更新：`au04-cross-work-confirmation-guard` 已补真实 Tauri 工作台跨作品确认验收：外部 seed 建立源作品与目标作品，源作品 active transcript 含未过期 confirmation；作者从真实作品菜单打开源作品确认卡，再切到目标作品，目标 UI 中源确认文本和“确认执行/拒绝”均不可见，`author_action_sent_count=0`、`toolbox_execute_after_cross_work_switch_count=0`、`pending_prose_fragment_after_cross_work_switch_count=0`，返回源作品后确认仍在源作品下恢复。该 checkpoint 关闭 B5/GAP-06 的 cross-work visibility/execution 子矩阵；不冒充 B6 的 latest-context rebase、持久 snapshot 或 replay。
>
> 2026-06-20 对账更新：`au04-latest-context-rebase-confirmation` 已补真实 Tauri 工作台 latest-context rebase 验收：外部 seed 恢复一个待确认 TurnResult，作者通过真实作品菜单先重命名当前作品，再点击“确认执行”；`summary.json` 证明 `renamed_revision=2`，`ConfirmationBinding.rebased_state_snapshot_ref` 包含 `revision:2`，confirmed turn 的 trace current_work summary 包含改名后的作品标题，且确认后只产生 pending `character_seed`。该 checkpoint 关闭 B6 的真实页面“确认前上下文变化后重新 gate”主路径；持久 ConfirmationBinding snapshot、replay 解释和失败恢复仍未闭环。

> 2026-06-20 对账更新：`au04-disabled-confirmation-action-ui` 已补真实 Tauri 工作台 disabled confirmation action 验收：外部 seed 恢复一个 `confirm_before_execute.enabled=false` 的待确认 TurnResult，真实工作台展示“确认执行”按钮但浏览器层 disabled，按钮 title 暴露 disabled reason，“拒绝”仍可用；外部点击尝试被阻止，且 `author_action_sent_count=0`、`channel_author_action_log_count=0`、`toolbox_execute_after_disabled_attempt_count=0`、`pending_prose_fragment_after_disabled_attempt_count=0`。该 checkpoint 关闭 B1/GAP-02 的 disabled 子矩阵；B1 仍缺 replay 视图和完整 card/action matrix，不标“已验收”。

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
| `apps/novel_application/lib/novel_application/action_validator.ex` | 拒绝 stale / invented / disabled / expired action |
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
| 当前证据 | `execution_authority_test.exs` 覆盖 high-risk / production_candidate -> `require_confirmation`；`v3_full_chain_test.exs` 覆盖 stub confirmation chain；`au04-confirm-before-execute` 真实 Tauri 验收证明 `needs_confirmation` 从真实 websocket 到达、确认前无 tool/no-write |
| 当前状态 | 已验收 |
| 当前缺口 | 主路径已闭环；完整 context-change / 持久 snapshot / replay 矩阵仍归 B6/E 组后续 checkpoint |
| 优先级 | P0 |

#### SC-AU04-A2 — 低风险单步工具可以执行，但结果仍是草稿

**用户视角**：作者说“帮我生成一个主角设定草案”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 单步低风险工具通过 gate，返回执行结果；如果产出创作内容，应进入待采纳草稿，不直接写成作品事实 |
| 当前证据 | `ExecutionOrchestrator.allow_tool`、`DialogueGateway.execute_tool`、`TurnResultBuilder.build_artifact_set/2`；`workspace_channel_v3_test.exs` 覆盖 task_state RUNNING/COMPLETED；AU-10 已有真实 task_state/export checkpoint，但不是本场景的低风险工具草稿矩阵 |
| 当前状态 | 已测试 |
| 当前缺口 | 低风险工具结果、task 状态和 pending adoption 在本场景真实入口的完整体验未验收 |
| 优先级 | P1 |

#### SC-AU04-A3 — 过大请求被降级为讨论

**用户视角**：作者说“把整本书写完，顺便更新所有角色和伏笔”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统不执行多步大任务，而是说明范围过大，建议先确定下一步 |
| 当前证据 | `execution_authority_test.exs` 覆盖 multi-step plan -> `downgrade_to_dialogue` |
| 当前状态 | 已测试 |
| 当前缺口 | 需要验证 TurnResult 文案不会机械化，也不会显示误导性的执行按钮 |
| 优先级 | P1 |

#### SC-AU04-A4 — 普通创作聊天不应误触发确认

**用户视角**：作者只是讨论“这个角色的动机可以怎么写？”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统自然回复，不打开 confirmation，不显示执行卡 |
| 当前证据 | `au01-ordinary-chat-two-turn-roundtrip` 真实 Tauri 证明两轮普通创作聊天 `generate_micro_plan=false`，不出现 MicroPlan、action、candidate 或 adoption UI；`au02-freeform-followup-after-candidate` 证明候选卡出现后手输自由追问仍走普通 `user_message` |
| 当前状态 | 已验收 |
| 当前缺口 | 仍需异常矩阵与更多真实 LLM 质量样本；普通聊天误触发确认的主风险已关闭 |
| 优先级 | P0 |

### 场景组 B：确认卡片与作者动作

#### SC-AU04-B1 — 确认卡片内容完整

**用户视角**：系统要求确认时，作者能看懂“要确认什么、影响哪里、确认后会发生什么、如何取消”。

| 字段 | 内容 |
|---|---|
| 期望结果 | UI 展示 confirmation card 或等价 action panel；包含 target、影响范围、确认、取消 |
| 当前证据 | `BehaviorState` 有 `prompt_contract` / `available_actions`；`TurnResultBuilder.maybe_add_behavior/2` 通过 `BehaviorState.snapshot/1` 输出 `{active, history}`；`WorkspaceChat` 已从 `available_actions` 渲染可提交动作；`au04-confirm-before-execute` 证明真实页面可见“确认执行/拒绝”基础动作；`au04-disabled-confirmation-action-ui` 证明真实页面中 disabled confirm action 可见但不可提交，disabled reason 可见，且 no-author-action/no-tool/no-draft |
| 当前状态 | 部分实现 |
| 当前缺口 | disabled 子矩阵已闭环；仍缺完整 confirmation card / action matrix 的 replay 视图和持久 binding 解释 |
| 优先级 | P0 |

#### SC-AU04-B2 — 点击确认必须走 `author_action`

**用户视角**：作者点击“确认执行”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 前端提交 `author_action`，包含 `source_turn_ref`、`action_id`、`action_type`、`behavior_ref`、`idempotency_key` |
| 当前证据 | `WorkspaceChat` 通过 `available_actions` 匹配后调用 `socket.ts.sendAuthorAction`；`WorkspaceChannel.handle_in("author_action")` 已实现；`ActionValidator` 要求 `behavior_ref` / `target_ref` / `idempotency_key` 等服务端字段精确回传；`au04-confirm-before-execute` 证明真实页面点击“确认执行”后发送同一 `action_id` 的 `author_action.confirm_before_execute` |
| 当前状态 | 已验收 |
| 当前缺口 | 主路径、重复确认幂等、expired rejection、disabled UI 和 cross-work 隔离已闭环；持久 binding / replay 仍归后续 |
| 优先级 | P0 |

#### SC-AU04-B3 — 点击取消关闭本次等待态

**用户视角**：作者看到确认后点击“取消/先不弄”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 只取消该 pending confirmation；不会执行工具；输入框恢复自然对话 |
| 当前证据 | `BehaviorState` / `AvailableAction` 设计包含 `reject_or_cancel_confirmation`、`cancel_pending_behavior`；`ActionValidator` 能验证 cancel 类 action；`DialogueGateway.handle_action/3` 对通用取消/拒绝返回 `cancelled` TurnResult，并把关闭的 behavior 写入 `behavior_state.history`；`AdoptionWorkflow` 对采纳确认 confirm/reject 也输出 `RESOLVED` / `CANCELLED` history；`workspace_channel_v3_test.exs` 和 `au10-workbench-recovery-cancel-waiting` 真实 Tauri 验收覆盖无写入取消路径 |
| 当前状态 | 已验收 |
| 当前缺口 | 过期确认、跨作品切换和历史只读确认已闭环；持久化 ConfirmationBinding、完整 trace/replay 矩阵仍未闭环 |
| 优先级 | P0 |

#### SC-AU04-B4 — 重复点击确认不重复执行

**用户视角**：作者因为网络卡顿连续点击两次“确认执行”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 同一 `idempotency_key` 只产生一次执行或返回同一结果 |
| 当前证据 | action envelope 中有 `idempotency_key`；`ActionValidator` 要求客户端回传的 `idempotency_key` 与服务端 available action 精确一致；持久 `author_action_receipts` 按 work/session/source/action/idempotency 去重；`au04-confirm-idempotency-ui` 证明真实工作台快速双击“确认执行”时第二个 confirm 被 `duplicate=true` 处理，最终只有 1 次工具 dispatch 和 1 份 pending artifact |
| 当前状态 | 已验收 |
| 当前缺口 | expired confirmation 已闭环；持久 ConfirmationBinding snapshot 仍归 B5/B6/GAP-06 后续 |
| 优先级 | P0 |

#### SC-AU04-B5 — 旧 turn / 旧作品的确认被拒绝

**用户视角**：作者回到历史对话或切换作品后，点了旧确认按钮。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统拒绝 stale action，要求重新生成计划或重新确认当前作品状态 |
| 当前证据 | `ActionValidator` 覆盖 stale / expired 校验；`workspace_channel_v3_test.exs` 覆盖 stale source_turn_ref、旧确认 turn 仍保存在 socket 但 current turn 已推进时仍拒绝、以及当前确认超过 `expires_at` 后拒绝；`au04-stale-confirmation-ui` 证明真实 Tauri 工作台点击旧确认会收到 stale error，且不触发 `prose_writing` / pending `prose_fragment`；`au04-confirmation-ttl-ui` 证明真实 Tauri 工作台恢复过期 confirmation 后点击“确认执行”会收到 expired error，且不触发 `prose_writing` / pending `prose_fragment`；`au04-history-confirmation-readonly` 证明历史只读 transcript 中的 confirmation 不渲染可执行按钮，且不发送 `author_action` / 不触发工具 / 不产生 pending draft；`au04-cross-work-confirmation-guard` 证明源作品 confirmation 切到目标作品后不泄漏、不发送 `author_action`、不触发工具、不产生 pending draft，返回源作品后仍按源作品恢复 |
| 当前状态 | 已验收 |
| 当前缺口 | 当前 turn 推进后的旧确认、expired confirmation、历史只读 confirmation 和跨作品切换隔离已闭环；持久化 ConfirmationBinding snapshot / replay 解释仍归 B6/E 组后续 |
| 优先级 | P0 |

#### SC-AU04-B6 — 确认前上下文变化后必须重新 gate

**用户视角**：作者看到确认后，又修改了作品设定或切换了上下文，再点击确认。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统基于最新作品背景和状态快照重新 gate；若目标已变化，要求重新确认 |
| 当前证据 | `ADR-0009` 与 VS-03 contract 要求 `rebased_state_snapshot_ref` 和 `gate_result_refs`；`ConfirmationBinding.build/1` 强制要求这两个字段；`DialogueGateway.handle_action/3` 确认 ack 返回 `confirmation_binding` 视图；`ExecutionOrchestrator` 在确认 re-gate 后写入 `confirmed_by:*`、`rebased_state_snapshot:*`、`gate_result_ref:*` reason code；`action_roundtrip_test.exs` 覆盖 string-keyed source turn 的 re-gate refs；`workspace_channel_action_idempotency_test.exs` 覆盖确认等待期间 Work 被 rename 后，ack binding 和 confirmed turn trace 均消费最新 revision/title；`au04-latest-context-rebase-confirmation` 证明真实 Tauri 工作台从恢复出的确认卡出发，通过真实作品菜单改名后再确认，`rebased_state_snapshot_ref` 包含 `revision:2`，trace current_work summary 包含改名标题，确认后只产生 pending `character_seed` |
| 当前状态 | 已验收 |
| 当前缺口 | 持久 ConfirmationBinding snapshot 实体、replay 解释和失败恢复仍未闭环；“目标已变化必须重新确认”的更复杂冲突矩阵可作为后续 P1/P2 |
| 优先级 | P0 |

### 场景组 C：执行权安全边界

#### SC-AU04-C1 — UI 不能提交发明出来的 action

**用户视角**：前端或恶意客户端提交一个 TurnResult 里没有的 action。

| 字段 | 内容 |
|---|---|
| 期望结果 | 后端拒绝 invented action |
| 当前证据 | `action_roundtrip_test.exs`、`workspace_channel_v3_test.exs` 覆盖 invented action rejected |
| 当前状态 | 已测试 |
| 当前缺口 | 需要加入真实 UI 回归，确保前端只从服务端 action 渲染按钮 |
| 优先级 | P1 |

#### SC-AU04-C2 — AI 夹带批准语义被系统拦截

**用户视角**：AI 文本里出现“已批准执行”“可以直接写入作品”等越权表达。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统以 envelope_validation / forbidden semantics 拦截 |
| 当前证据 | `execution_authority_test.exs` 覆盖 `approved`、`production_write_allowed` |
| 当前状态 | 已测试 |
| 当前缺口 | 缺真实 LLM 样本和 UI 友好恢复文案验收 |
| 优先级 | P1 |

#### SC-AU04-C3 — Planner 风险提示不具备授权力

**用户视角**：AI 把写入动作标成低风险或不需要确认。

| 字段 | 内容 |
|---|---|
| 期望结果 | Orchestrator 根据 write boundary / authority 自行裁决，必要时仍要求确认 |
| 当前证据 | `execution_authority_test.exs` 覆盖 production_candidate -> require_confirmation |
| 当前状态 | 已测试 |
| 当前缺口 | 缺真实 LLM 输出下的端到端验收 |
| 优先级 | P1 |

### 场景组 D：确认后的执行反馈

#### SC-AU04-D1 — 确认后有任务状态反馈

**用户视角**：作者确认后能看到系统正在执行、完成或失败。

| 字段 | 内容 |
|---|---|
| 期望结果 | UI 接收并展示 RUNNING / COMPLETED / FAILED 等状态 |
| 当前证据 | 2026-05-25 起 synthetic task lifecycle 已移除；同步 creative tool 通过 TurnResult phase/status、ToolResult.status 与 trace_summary 表达结果。正式 TaskState / Long-running Creative Job Contract deferred |
| 当前状态 | 部分实现 |
| 当前缺口 | AU-10 已证明真实导出 task_state 可见；AU-04 确认后工具执行的 RUNNING/COMPLETED/FAILED 矩阵和完整 LongRunner 仍未验收 |
| 优先级 | P1 |

#### SC-AU04-D2 — 执行产物默认进入待采纳，不直接写作品事实

**用户视角**：系统生成角色设定后，作者看到“待采纳”的草稿卡，而不是作品档案立刻被改。

| 字段 | 内容 |
|---|---|
| 期望结果 | `adoption_state.pending` 有草稿；`production_write_performed=false` |
| 当前证据 | `TurnResultBuilder.build_artifact_set/2`、`build_truthfulness/3`；E2E 覆盖 pending artifact；`au04-confirm-before-execute` 证明确认后产出 `prose_fragment` 且仍停留在 `adoption_state.pending`，未自动写作品事实 |
| 当前状态 | 已验收 |
| 当前缺口 | 采纳到作品事实和阅读投影属于 AU-05/AU-08 后续矩阵；本场景只证明执行产物默认 pending |
| 优先级 | P1 |

#### SC-AU04-D3 — AI 回复不能撒谎

**用户视角**：如果系统只是要求确认、降级或拒绝，AI 不能说“已执行完成”。

| 字段 | 内容 |
|---|---|
| 期望结果 | TurnResult truthfulness 与实际 execution/tool/adoption 状态一致 |
| 当前证据 | `TurnResultBuilder.build_truthfulness/3`、`execution_authority_test.exs` truthfulness constraints |
| 当前状态 | 部分实现 |
| 当前缺口 | 未看到对 assistant_message 文本本身的强约束测试；真实 LLM 可能仍生成误导文案 |
| 优先级 | P1 |

### 场景组 E：追溯与恢复

#### SC-AU04-E1 — 确认行为可追溯

**用户视角**：作者或开发者能回看某次为什么要求确认、确认了什么、最终是否执行。

| 字段 | 内容 |
|---|---|
| 期望结果 | trace 包含 decision、behavior、author action、gate result、tool result |
| 当前证据 | `TraceWriter.record_with_decision/5`、`TraceWriter.record_with_tool/7`；设计文档要求 ConfirmationBinding trace |
| 当前状态 | 部分实现 |
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
| SC-AU04-A1 | 高风险写入先确认 | 已验收 | 是，`au04-confirm-before-execute` 证明真实入口先确认且 no-tool/no-write |
| SC-AU04-A2 | 低风险单步执行并产出草稿 | 已测试 | 否，真实 UI/task/adoption 体验未验收 |
| SC-AU04-A3 | 过大请求降级 | 已测试 | 否，真实 UI 文案未验收 |
| SC-AU04-A4 | 普通聊天不误触发确认 | 已验收 | 是，`au01-ordinary-chat-two-turn-roundtrip` / `au02-freeform-followup-after-candidate` 证明普通输入不进确认 |
| SC-AU04-B1 | 确认卡内容完整 | 部分实现 | 是，`au04-disabled-confirmation-action-ui` 已证明 disabled action 子矩阵；完整 replay/card matrix 未闭环 |
| SC-AU04-B2 | 点击确认走 `author_action` | 已验收 | 是，`au04-confirm-before-execute` 证明真实页面发送服务端授权 `author_action.confirm_before_execute` |
| SC-AU04-B3 | 点击取消关闭等待态 | 已验收 | 是，`au10-workbench-recovery-cancel-waiting` 证明真实页面取消等待 no-write、关闭 active behavior 并可继续下一轮 |
| SC-AU04-B4 | 重复确认幂等 | 已验收 | 是，`au04-confirm-idempotency-ui` 证明真实页面快速重复确认只产生 1 次非 duplicate receipt、1 次工具 dispatch 和 1 份 pending artifact |
| SC-AU04-B5 | stale / expired / history / cross-work confirmation 拒绝 | 已验收 | 是，`au04-stale-confirmation-ui` 证明当前 turn 推进后旧确认被 stale 拒绝且 no-tool/no-draft；`au04-confirmation-ttl-ui` 证明 expired confirmation 被拒绝且 no-tool/no-draft；`au04-history-confirmation-readonly` 证明历史只读 confirmation 不可执行且 no-action/no-tool/no-draft；`au04-cross-work-confirmation-guard` 证明跨作品切换后源 confirmation 在目标作品不可见不可执行且 no-action/no-tool/no-draft；持久化 binding 仍归 GAP-06/B6 |
| SC-AU04-B6 | 确认前上下文变化后重新 gate | 已验收 | 是，`au04-latest-context-rebase-confirmation` 证明真实页面确认前改名后，binding/trace 消费最新 Work revision/title；持久 snapshot/replay 仍归后续 |
| SC-AU04-C1 | invented action 拒绝 | 已测试 | 局部闭环 |
| SC-AU04-C2 | AI 自批准语义拦截 | 已测试 | 局部闭环 |
| SC-AU04-C3 | Planner hint 不授权 | 已测试 | 局部闭环 |
| SC-AU04-D1 | 确认后任务状态反馈 | 部分实现 | 否 |
| SC-AU04-D2 | 产物进入待采纳 | 已验收 | 是，`au04-confirm-before-execute` 证明确认后执行结果仍为 pending `prose_fragment` |
| SC-AU04-D3 | AI 回复不撒谎 | 部分实现 | 否 |
| SC-AU04-E1 | 确认行为可追溯 | 部分实现 | 否 |
| SC-AU04-E2 | 执行失败后恢复 | 不确定 | 否 |

**结论：18 个场景；8/18 已验收并已有真实 Tauri 页面证据（A1/A4/B2/B3/B4/B5/B6/D2），B1 disabled 子矩阵另有真实 Tauri 证据但 B1 仍未完整验收；5/18 有后端或 Channel 局部测试；5/18 仍是部分实现或不确定。AU-04 当前已关闭高风险确认主路径、重复确认不重复执行、当前 turn 推进后的旧确认 stale 拒绝、expired confirmation 拒绝、disabled confirm 不可提交、历史只读 confirmation 不可执行、跨作品切换后源 confirmation 不泄漏不执行，以及 latest-context rebase 主路径；仍不覆盖持久 ConfirmationBinding snapshot、trace/replay 或失败恢复。**

---

## 6. 缺口

| 缺口 | 具体表现 | 类型 | 优先级 |
|---|---|---|---|
| AU04-GAP-01 — 真实入口确认动作未接入 `author_action` | **主路径已关闭（2026-06-19）**：`au04-confirm-before-execute` 证明真实入口通过 `available_actions` + `author_action.confirm_before_execute` 提交；剩余重复点击/stale/expired 归 GAP-03/GAP-06 | 补验收 | closed |
| AU04-GAP-02 — 确认卡/动作在真实入口不可见或不可点 | **部分关闭（2026-06-20）**：真实入口已渲染并可点击“确认执行/拒绝”，重复确认、当前 turn 推进后的旧确认 stale 拒绝、expired rejection 和 disabled confirm 不可提交均已有真实 UI 验收；完整 card/action matrix 的 replay 视图和持久 binding 解释仍缺 | 补验收 | P0 |
| AU04-GAP-03 — 确认幂等未完整闭环 | **主路径关闭（2026-06-20）**：`ActionValidator` 要求 `idempotency_key` 与服务端 action 精确一致，持久 `author_action_receipts` 以 `work_id/session_id/source_turn/action/idempotency_key` 去重；`au04-confirm-idempotency-ui` 证明真实页面快速重复确认时第二个 confirm 被 `duplicate=true` 处理，且只产生 1 次工具 dispatch / 1 份 pending artifact | 补验收 | closed |
| AU04-GAP-04 — ConfirmationBinding 未完整实现 | **latest-context 主路径已补**：`ActionValidator` 已要求 `behavior_ref`、`target_ref`、`candidate_*`、`idempotency_key` 与服务端 action 精确一致，并拒绝 expired action；`ConfirmationBinding.build/1` 已强制 `rebased_state_snapshot_ref` / `gate_result_refs`，`DialogueGateway` 确认 ack 与 `ExecutionOrchestrator.reason_codes` 已留下 re-gate proof；`au04-latest-context-rebase-confirmation` 证明真实页面确认前改名后 binding/trace 消费最新 Work revision/title；仍缺持久 snapshot 实体和 replay 解释 | 补实现/补集成/补验收 | P0/P1 |
| AU04-GAP-05 — 取消/拒绝 lifecycle 未闭环 | **主路径已补**：`au10-workbench-recovery-cancel-waiting` 证明真实页面取消等待 no-write、active behavior 关闭和下一轮恢复；trace/replay 和完整 action result matrix 仍缺 | 补集成/补验收 | P0 |
| AU04-GAP-06 — 过期/跨作品/历史确认验证不足 | **大部分关闭（2026-06-20）**：`au04-stale-confirmation-ui` 已证明当前 turn 推进后的旧确认被 stale 拒绝且 no-tool/no-draft；`au04-confirmation-ttl-ui` 已证明 expired confirmation 被拒绝且 no-tool/no-draft；`au04-history-confirmation-readonly` 已证明历史只读 confirmation 不可执行且 no-action/no-tool/no-draft；`au04-cross-work-confirmation-guard` 已证明源作品 confirmation 切到目标作品后不泄漏、不发送 action、不触发工具、不产生草稿；latest-context rebase 已由 B6 关闭；仍缺持久 ConfirmationBinding snapshot / replay 解释 | 补实现/补验收 | P1 |
| AU04-GAP-07 — task_state 真实入口完整展示不足 | Channel 可广播，`WorkspaceChat` 已订阅并映射到 longRun store；仍缺长跑全过程 UI 验收 | 补验收 | P1 |
| AU04-GAP-08 — assistant_message 文本真值约束不足 | truthfulness map 存在，但缺 LLM 文案不撒谎测试 | 补测试 | P1 |
| AU04-GAP-09 — 确认后失败恢复缺场景 | 缺工具失败、LLM 超时、恢复 action 的 UI/Channel 验收 | 补验收 | P1 |

---

## 7. 已知基础设施

| 基础设施 | 当前价值 | 不应误判 |
|---|---|---|
| `ExecutionOrchestrator.decide/2` | 已能根据 GateOrder 产生 allow/downgrade/confirm/recovery | 不等于真实 UI 确认闭环 |
| `ActionValidator.validate/2` | 能拒绝 missing/stale/invented/disabled/expired action，并校验 `target_ref` / `behavior_ref` / `candidate_*` / `idempotency_key` 与服务端 action 精确一致 | 不等于 rebased snapshot 或完整持久 ConfirmationBinding |
| `DialogueGateway.handle_action/3` | `confirm_before_execute` 可在确认时重新组装当前 context、构造 binding，并在 allow_tool 时 dispatch；确认 ack 带 `confirmation_binding` 视图，reason code 留下 snapshot / gate ref proof | 不等于持久 ConfirmationBinding snapshot 或 replay 已完成 |
| `WorkspaceChannel.handle_in("author_action")` | Channel 层 action roundtrip 已有测试，`au04-confirm-before-execute` 已证明当前 App 入口使用 `author_action`；`au04-confirm-idempotency-ui` 已证明真实重复确认不会重复 dispatch；`au04-confirmation-ttl-ui` 已证明 expired action 真实拒绝；`au04-history-confirmation-readonly` 已证明历史只读 transcript 不发送 `author_action`；`au04-cross-work-confirmation-guard` 已证明跨作品切换不会发送源 action；`au04-latest-context-rebase-confirmation` 已证明真实页面确认前改名后 binding/trace 消费最新 Work snapshot | 不等于持久 ConfirmationBinding snapshot 或 replay 已完成 |
| `WorkspaceChat` + `socket.ts` | 当前真实入口已接 `available_actions` / `author_action` / `task_state`；真实导出 task_state checkpoint 已补 | 缺完整 action_result、完整异步 LongRunner、断线/超时恢复 UI 验收 |
| `workspace_channel_v3_test.exs` | 覆盖 task_state、stale/invented action 等局部链路 | 不等于 Playwright/真人工作台验收 |

---

## 8. 验收命令

这些命令只能证明后端/Channel 局部能力，不能证明 AU-04 完整通过：

```bash
mix test apps/novel_application/test/novel_application/execution_authority_test.exs
mix test apps/novel_application/test/novel_application/action_roundtrip_test.exs
mix test apps/novel_domain/test/novel_domain/confirmation_binding_test.exs
mix test apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs
```

完整 AU-04 验收还需要补充：

```text
1. 已补：真实工作台高风险请求 -> 确认卡/动作可见 -> 点击确认 -> re-gate -> 待采纳结果（`au04-confirm-before-execute`）。
2. 已补：重复点击确认时同一 idempotency_key 只执行一次（`au04-confirm-idempotency-ui`）。
3. 已补当前 turn stale：旧确认不能在 follow-up 推进当前 turn 后继续执行（`au04-stale-confirmation-ui`）；已补 expired：过期确认不能执行（`au04-confirmation-ttl-ui`）；已补 disabled：禁用确认可见但不可提交（`au04-disabled-confirmation-action-ui`）；已补 history readonly：历史 transcript 内旧确认不可执行（`au04-history-confirmation-readonly`）；已补 cross-work：源作品 confirmation 切到目标作品后不可见不可执行（`au04-cross-work-confirmation-guard`）。
4. 已补 latest-context rebase：确认卡等待期间通过真实作品菜单改名，再确认时 binding/trace 消费最新 Work revision/title（`au04-latest-context-rebase-confirmation`）。
5. 已补主路径：cancel/reject 关闭 pending confirmation，UI 恢复自然对话（`au10-workbench-recovery-cancel-waiting`）；trace/replay 矩阵仍缺。
6. failure recovery：确认后工具失败时，UI 显示可恢复路径且无半写入。
```

当前最小真实页面 checkpoint：

```bash
bash scripts/tauri_slice_verify.sh au04-confirm-before-execute
bash scripts/tauri_slice_verify.sh au04-confirm-idempotency-ui
bash scripts/tauri_slice_verify.sh au04-stale-confirmation-ui
bash scripts/tauri_slice_verify.sh au04-confirmation-ttl-ui
bash scripts/tauri_slice_verify.sh au04-disabled-confirmation-action-ui
bash scripts/tauri_slice_verify.sh au04-history-confirmation-readonly
bash scripts/tauri_slice_verify.sh au04-cross-work-confirmation-guard
bash scripts/tauri_slice_verify.sh au04-latest-context-rebase-confirmation
bash scripts/quality_accept.sh au04-confirm-before-execute --surface tauri
bash scripts/quality_accept.sh au04-confirm-idempotency-ui --surface tauri
bash scripts/quality_accept.sh au04-stale-confirmation-ui --surface tauri
bash scripts/quality_accept.sh au04-confirmation-ttl-ui --surface tauri
bash scripts/quality_accept.sh au04-disabled-confirmation-action-ui --surface tauri
bash scripts/quality_accept.sh au04-history-confirmation-readonly --surface tauri
bash scripts/quality_accept.sh au04-cross-work-confirmation-guard --surface tauri
bash scripts/quality_accept.sh au04-latest-context-rebase-confirmation --surface tauri
```
