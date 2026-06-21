# AU-06 对话行为生命周期

> 作者视角：当 AI 需要我确认、补充信息、取消等待或处理失败时，系统会进入一个明确的“等待作者”状态。我能看到它为什么等我、等哪个对象、我有哪些动作；我操作后，这个状态必须关闭或被新的当前等待态取代，并且不能让旧按钮、旧作品或历史会话误执行。

> 2026-06-21 文件级收口结论：AU-06 已按当前 checkout 重算为 17 个场景。13/17 已验收，4/17 部分实现；P0 runtime safety 缺口已关闭，当前可进入 AU-07。剩余 P1 集中在 blocking clarification 主链、确认成功后的 terminal behavior history 持久化、BehaviorTrace/replay 和完整 retry/timeout 解释，不再阻塞确认 lifecycle 的当前可交付状态。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 看到“需要确认/需要补充”的状态 | 清楚展示等待原因、目标对象、影响范围和可用动作 |
| 点击确认 | 系统绑定该 open behavior，重新 gate，确认前不执行不写入 |
| 点击取消/拒绝 | 系统关闭该 behavior，记录取消结果，不产生写入副作用 |
| 回答澄清问题 | 系统应把回答绑定到原 clarification 并重新评估；当前仍是 P1 后续 |
| 暂时不处理，继续聊天 | 系统让当前 turn 前进；旧确认隐藏、禁用或被 stale 拒绝，不误执行 |
| 过很久再点旧按钮 | 系统识别 stale/expired，不执行过期动作 |
| 回看历史会话/切换作品 | 历史或其他作品中的确认不可执行，不能关闭当前作品的新 behavior |

明确不能做的：

- UI 不能自己打开、关闭或修改 `BehaviorState`。
- Planner / LLM 不能直接创建 resolved/cancelled 行为事实。
- 同一 workstream 不能同时有多个可执行的 primary author-blocking behavior。
- `completed` 不能掩盖仍然可执行的旧 confirmation / clarification。
- 旧作品、旧会话、旧 turn 的 action 不能关闭当前作品的新 behavior。

---

## 2. 不变量

| 编号 | 不变量 | 当前验证 |
|---|---|---|
| AU06-I1 | Durable behavior 必须有 open/resolving/resolved/cancelled/failed/superseded 生命周期 | cancel terminal history 已验收；confirm terminal history / replay 为 P1 |
| AU06-I2 | `awaiting_author` 必须有 active BehaviorState 和 author-facing action | `au04-confirm-before-execute` |
| AU06-I3 | 普通探索不自动打开 clarification / confirmation | `au01-ordinary-chat-two-turn-roundtrip` |
| AU06-I4 | UI 只能提交服务端给出的 available action | `ActionValidator` 局部测试 + 多个 Tauri author_action 验收 |
| AU06-I5 | confirmation answer 必须绑定 open confirmation 并重新 gate | `au04-confirm-before-execute`、`au04-latest-context-rebase-confirmation` |
| AU06-I6 | cancel/reject 必须关闭具体 behavior 且无写入副作用 | `au10-workbench-recovery-cancel-waiting` |
| AU06-I7 | 同一 workstream 只能有一个可执行 primary author-blocking behavior | `au06-single-active-confirmation` |
| AU06-I8 | stale/expired/duplicate action 不能产生新执行 | `au04-stale-confirmation-ui`、`au04-confirmation-ttl-ui`、`au04-confirm-idempotency-ui` |
| AU06-I9 | Behavior lifecycle 必须可 trace/replay，且 replay 不调 LLM | P1，owner AU-07 |

---

## 3. 契约引用

| 契约 / 代码 | 用途 |
|---|---|
| `docs/design/contracts/VS-03-behavior-lifecycle-contract-pack.md` | BehaviorState、AvailableAction、ConfirmationBinding、Proof 总入口 |
| `docs/design/adr/ADR-0006-turn-phase-status-v3.md` | TurnPhase / TurnStatus 与 active behavior 关系 |
| `docs/design/adr/ADR-0007-next-action-available-action-v3.md` | `confirm_before_execute`、`cancel_pending_behavior` 等动作集合 |
| `docs/design/adr/ADR-0008-behavior-state-v3.md` | BehaviorState 作为 durable waiting state |
| `docs/design/adr/ADR-0009-confirmation-binding-v3.md` | confirmation answer 绑定与 re-gate |
| `apps/novel_domain/lib/novel_domain/behavior_state.ex` | BehaviorState struct、open/closed predicate、`snapshot/1` |
| `apps/novel_domain/lib/novel_domain/confirmation_binding.ex` | confirmation answer 的 binding proof |
| `apps/novel_application/lib/novel_application/execution_orchestrator.ex` | 打开 confirmation behavior 与生成 available_actions / expires_at |
| `apps/novel_application/lib/novel_application/action_validator.ex` | stale / invented / disabled / expired / scoped action 验证 |
| `apps/novel_application/lib/novel_application/dialogue_gateway.ex` | `confirm_before_execute` re-gate / tool dispatch / cancel TurnResult |
| `apps/novel_web/lib/novel_web/channels/workspace_channel.ex` | `author_action` 路由、当前 turn stale guard、receipt 幂等 |
| `frontend/src/components/WorkspaceChat.tsx` | 当前真实工作台对 `behavior_state.active`、`ui_cards`、`available_actions` 的消费入口 |
| `tasks/slices/AU04-AU06-author-action-binding.md` | AU-04/AU-06 action binding 与 lifecycle checkpoint 记录 |

---

## 4. 文件级对账矩阵

| 场景 | 设计期望 | Contract / invariant | 实现入口 | 局部测试证据 | 真实页面外部自动化证据 | 当前状态 | 设计偏差 | 缺口类型 | 优先级 | 建议 checkpoint / slice |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-AU06-A1 高风险操作打开 confirmation behavior | 高风险/写入类请求进入 `awaiting_author / needs_confirmation`，active behavior 指向确认对象，可见确认/取消动作 | VS-03 §2/§4；AU06-I2 | `ExecutionOrchestrator.decide/3`、`TurnResultBuilder`、`WorkspaceChat` | `behavior_lifecycle_test.exs` high-risk confirmation / confirmation card | `artifacts/slice-verify/au04-confirm-before-execute-tauri/summary.json`：确认卡真实可见，确认前 no-tool/no-write | 已验收 | 无 | 已闭环 | P0 closed | `AU04-AU06-author-action-binding.md` |
| SC-AU06-A2 缺关键补充信息时打开 clarification behavior | 缺 target 时打开 clarification，不硬猜也不表单化 | VS-03 `answer_clarification`；AU06-I1/I9 | `BehaviorState` 支持 `:clarification`，`available_actions` 枚举支持 | contract / enum 局部存在 | 无真实页面证据 | 部分实现 | 当前产品没有稳定 blocking clarification producer；模糊创作按 AU-02 自然探索处理 | 补实现/补验收 | P1 | AU-11 / AU-06 clarification checkpoint |
| SC-AU06-A3 普通创作讨论不打开 waiting behavior | 普通讨论自然回复，不进入 waiting，不显示确认/澄清卡 | VS-03 rule 3；AU06-I3 | `DialogueGateway.handle_input/3`、`WorkspaceChat` | `behavior_lifecycle_test.exs` downgrade no behavior | `au01-ordinary-chat-two-turn-roundtrip`：两轮普通聊天 no action/candidate/adoption UI、no MicroPlan | 已验收 | 无 | 已闭环 | P0 closed | AU-01 evidence |
| SC-AU06-A4 真实工作台能识别 active behavior | 页面从 TurnResult 识别 active behavior，渲染卡片和服务端 action | VS-03 BehaviorState + AvailableAction；AU06-I2/I4 | `TurnResultBuilder.maybe_add_behavior/2`、`WorkspaceChat` | `BehaviorState.snapshot/1` 测试、confirmation card 单测 | `au04-confirm-before-execute`、`au10-workbench-recovery-cancel-waiting` | 已验收 | clarification UI 矩阵仍未闭环 | 补验收 | P1 | clarification 后续 |
| SC-AU06-B1 点击确认绑定 open confirmation | action 包含 `source_turn_ref/action_id/action_type/behavior_ref/target_ref/idempotency_key`，确认后重新 gate | ADR-0009；AU06-I4/I5 | `ActionValidator`、`DialogueGateway.handle_action/3`、`ConfirmationBinding` | `action_roundtrip_test.exs`、`workspace_channel_action_idempotency_test.exs` | `au04-confirm-before-execute`、`au04-latest-context-rebase-confirmation` | 已验收 | 持久 ConfirmationBinding snapshot 实体 / replay 解释仍未完备 | 补验收/补集成 | P1 | AU-07 replay owner |
| SC-AU06-B2 点击取消/拒绝关闭 behavior | behavior 进入 cancelled，active 清空，history 有关闭项，无工具/写入 | VS-03 cancellation；AU06-I6 | `DialogueGateway.handle_action/3`、`WorkspaceChannel` | `action_roundtrip_test.exs` reject closes behavior | `au10-workbench-recovery-cancel-waiting`：取消等待、active behavior 关闭、输入恢复、下一轮可继续 | 已验收 | 完整 replay 解释仍缺 | 补验收 | P1 | AU-07 replay owner |
| SC-AU06-B3 回答澄清后重新评估 | 作者回答绑定原 clarification，进入 resolving 并重新形成 frame/plan/decision | VS-03 `answer_clarification`；AU06-I1/I9 | `WorkspaceChat` 有 action 文案/提交能力；后端主链不足 | 无完整后端主链测试 | 无真实页面证据 | 部分实现 | `user_message` 未形成稳定 clarification resolution 主链 | 补实现/补集成 | P1 | AU-11 / AU-06 clarification checkpoint |
| SC-AU06-B4 等待期间继续聊天不误执行 | 作者继续聊天时，旧 behavior 被保留/取消/supersede，但普通消息不能当确认执行 | VS-03 stale / current turn guard；AU06-I8 | `WorkspaceChannel.source_turn_result/3`、`ActionValidator` | current-turn stale / action validator tests | `au04-stale-confirmation-ui`：follow-up 推进 current turn 后旧确认 stale/no-tool/no-draft | 已验收 | 当前策略是 current turn 推进后旧确认 stale/supersede，不是保留原等待态；文档按现状同步 | 文档同步 | P0 closed | `AU04-AU06-author-action-binding.md` |
| SC-AU06-B5 旧按钮、伪造按钮、禁用按钮被拒绝 | 旧 turn / invented / disabled action 不关闭当前 behavior、不执行工具 | VS-03 AvailableAction；AU06-I4/I8 | `ActionValidator`、`WorkspaceChannel`、`WorkspaceChat` | invented/disabled/scope mismatch tests | `au04-stale-confirmation-ui`、`au04-confirmation-ttl-ui`、`au04-disabled-confirmation-action-ui`、`au04-history-confirmation-readonly`、`au04-cross-work-confirmation-guard` | 已验收 | invented action 是非 UI adversarial boundary，只能用局部测试证明；真实 UI 不会产生伪造按钮 | 补测试/补验收 | P2 | 保持局部安全测试 |
| SC-AU06-C1 open 到 resolved/cancelled 进入 history | active 关闭，history 追加 terminal item，closed_at_turn_ref / resolution_ref 非空 | VS-03 BehaviorState lifecycle；AU06-I1 | `BehaviorState.snapshot/1`、`DialogueGateway.cancel_waiting_behavior_state/3` | `behavior_state_test.exs`、`action_roundtrip_test.exs` cancel terminal history | `au10-workbench-recovery-cancel-waiting` 证明 cancel history；confirm path 以 binding/reason_codes 证明 re-gate | 部分实现 | confirm 成功路径尚未输出 terminal behavior history；持久 history/replay 未闭环 | 补集成/补验收 | P1 | AU-07 / behavior replay checkpoint |
| SC-AU06-C2 确认后重新 gate，不直接执行 | ConfirmationBinding 绑定 open behavior 和 target，基于最新 state snapshot 重新 gate | ADR-0009；AU06-I5 | `ConfirmationBinding.build/1`、`DialogueGateway.confirm_with_plan/4`、`ContextAssembler` | `action_roundtrip_test.exs` re-gate refs；Channel latest Work snapshot test | `au04-latest-context-rebase-confirmation`：确认前真实改名，binding/trace 消费最新 Work revision/title | 已验收 | 持久 replay 解释仍缺 | 补验收 | P1 | AU-07 replay owner |
| SC-AU06-C3 同一 workstream 只有一个 primary author-blocking behavior | 第二个等待态出现后，旧等待态不可继续执行；最新等待态仍可执行 | VS-03 single active；AU06-I7 | `WorkspaceChannel` current-turn guard、`ActionValidator`、`WorkspaceChat` | stale/source-turn tests | `au06-single-active-confirmation`：两个高风险请求得到不同 behavior_ref，旧确认 hidden/disabled/stale 且 no-tool/no-draft，最新确认执行一次 | 已验收 | 没有独立 persistent open behavior ledger；当前 live safety 由 current turn + action scope 保证 | 补集成 | P1 | 持久 ledger 归 replay/trace 后续 |
| SC-AU06-C4 TTL / expires_at 控制过期等待 | 过期 action 被 disabled/拒绝，要求重新生成计划 | VS-03 `expires_at`；AU06-I8 | `ExecutionOrchestrator.author_action_expires_at/0`、`ActionValidator` | `action_roundtrip_test.exs` expired available action | `au04-confirmation-ttl-ui`：expired confirmation 真实拒绝，no-tool/no-draft | 已验收 | 无 | 已闭环 | P0 closed | `AU04-AU06-author-action-binding.md` |
| SC-AU06-C5 重复动作幂等 | 同一 idempotency_key 只产生一次 resolution/execution | VS-03 `idempotency_key`; AU06-I8 | `ActionIdempotencyLedger`、`ActionIdempotencyService`、`WorkspaceChannel` | ledger/channel idempotency tests | `au04-confirm-idempotency-ui`：真实快速双击只 1 次 dispatch / 1 份 pending artifact | 已验收 | behavior resolution ledger 与 replay 仍未完整 | 补验收 | P1 | AU-07 replay owner |
| SC-AU06-D1 行为生命周期可回放且不调 LLM | ReplayService 从 trace/history 还原 open/resolving/closed，不调用 LLM | VS-03 proof；AU06-I9 | `ReplayService`、trace summary、interaction recorder | AU-07 局部 replay 证据 | 无完整 AU-06 behavior replay 页面证据 | 部分实现 | 当前 trace/reason_codes 可解释确认，但不是完整 BehaviorTrace replay | 补集成/补验收 | P1 | AU-07 文件 owner |
| SC-AU06-D2 跨作品/跨会话 action 不能关闭当前 behavior | 验证 work_id/session_id/source_turn_ref，不影响当前作品 open behavior | VS-03 scope；AU06-I4/I8 | `WorkspaceChannel` scoped receipts、history read-only view、work switch | action receipt scope tests | `au04-history-confirmation-readonly`、`au04-cross-work-confirmation-guard` | 已验收 | 持久 BehaviorBinding ledger 未独立建模 | 补集成 | P1 | AU-07 / persistence follow-up |
| SC-AU06-D3 前端不能本地修改 lifecycle | 前端只提交 action；状态变化来自后端 TurnResult / action_result | scenario acceptance 红线；AU06-I4 | `WorkspaceChat` `sendAuthorAction`、`workbenchActions.toAuthorActionPayload` | verifier tests | 多个 Tauri author_action driver 均验证真实 websocket action_result / turn_result 回来后 UI 变化 | 已验收 | 无生产验收 hook；slice driver 只在外部 harness | 已闭环 | P0 closed | 保持红线 |

---

## 5. 缺口分级与文件级计划

| 缺口 | 当前结论 | 类型 | 优先级 | Owner / 恢复路径 |
|---|---|---|---|---|
| AU06-GAP-01 — 真实入口 behavior_state 契约不匹配 | 已关闭。`BehaviorState.snapshot/1` 输出 `{active, history}`，`WorkspaceChat` 消费 active behavior，Tauri driver 已验证 | 已闭环 | P0 closed | 保持回归 |
| AU06-GAP-02 — 真实入口不渲染 available_actions | 已关闭。确认卡、确认/拒绝、disabled、history/cross-work 隐藏均有真实页面证据 | 已闭环 | P0 closed | 保持回归 |
| AU06-GAP-03 — cancel/reject/clarification resolution 未实现 | cancel/reject 主路径已关闭；clarification answer 仍未闭环 | 补实现/补验收 | P1 | AU-11 / AU-06 clarification checkpoint |
| AU06-GAP-04 — open -> resolving -> resolved/history 未闭环 | cancel terminal history 已关闭；confirm terminal history / replay 仍缺 | 补集成/补验收 | P1 | AU-07 replay / BehaviorTrace |
| AU06-GAP-05 — ConfirmationBinding 未完整实现 | binding refs、latest-context rebase 已关闭；持久 snapshot / replay 解释仍缺 | 补验收/补集成 | P1 | AU-07 replay owner |
| AU06-GAP-06 — 单一活跃 behavior 未强制 | 当前 live safety 已由 `au06-single-active-confirmation` 证明：旧确认不可执行，最新确认可执行一次；独立 persistent ledger 仍是后续治理项 | 补集成 | P1 | 后续持久 ledger / replay |
| AU06-GAP-07 — TTL / expires_at 缺失 | 已关闭。available action 带 `expires_at`，过期真实拒绝 | 已闭环 | P0 closed | 保持回归 |
| AU06-GAP-08 — 幂等 ledger 缺失 | 已关闭到 runtime safety：持久 receipt + 真实双击 single-shot；behavior replay 仍缺 | 补验收 | P1 | AU-07 replay owner |
| AU06-GAP-09 — behavior/action 跨作品和跨会话隔离不足 | 已关闭到 runtime safety：history readonly / cross-work 真实不可执行；独立 BehaviorBinding ledger 仍缺 | 补集成 | P1 | AU-07 / persistence follow-up |
| AU06-GAP-10 — BehaviorTrace / replay 缺失 | 未作为 AU-06 P0 关闭，登记 AU-07 文件 owner | 补集成/补验收 | P1 | AU-07 |
| AU06-GAP-11 — blocking clarification 主链不明确 | 保留 P1，不阻塞当前确认 lifecycle 文件级退出 | 补实现/状态核查 | P1 | AU-11 / AU-06 clarification |

本文件 P0 已关闭。P1 未闭合项都有 owner 文件和恢复路径，且不影响当前确认/取消/stale/TTL/幂等/跨作品/single-active 的 runtime safety。

---

## 6. 文件级验证命令

真实页面外部自动化：

```bash
bash scripts/quality_accept.sh au04-confirm-before-execute --surface tauri
bash scripts/quality_accept.sh au04-confirm-idempotency-ui --surface tauri
bash scripts/quality_accept.sh au04-stale-confirmation-ui --surface tauri
bash scripts/quality_accept.sh au04-confirmation-ttl-ui --surface tauri
bash scripts/quality_accept.sh au04-disabled-confirmation-action-ui --surface tauri
bash scripts/quality_accept.sh au04-history-confirmation-readonly --surface tauri
bash scripts/quality_accept.sh au04-cross-work-confirmation-guard --surface tauri
bash scripts/quality_accept.sh au04-latest-context-rebase-confirmation --surface tauri
bash scripts/quality_accept.sh au10-workbench-recovery-cancel-waiting --surface tauri
bash scripts/quality_accept.sh au06-single-active-confirmation --surface tauri
```

局部测试与质量门禁：

```bash
mix test apps/novel_application/test/novel_application/behavior_lifecycle_test.exs
mix test apps/novel_application/test/novel_application/action_roundtrip_test.exs
mix test apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs
mix test apps/novel_web/test/novel_web/channels/workspace_channel_action_idempotency_test.exs
pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs
bash scripts/quality_manifest_check.sh
bash scripts/task_done.sh --skip-static-scan
bash scripts/ai_static_scan.sh --top 10
```

---

## 7. 文件级退出判断

| 退出项 | 结果 |
|---|---|
| 所有场景都有可信对账矩阵 | 是，17/17 已重算 |
| P0 缺口关闭或登记 blocker | 是，P0 runtime safety 已关闭 |
| P1 有后续 checkpoint / owner / 恢复路径 | 是，clarification 归 AU-11/AU-06 后续，BehaviorTrace/replay 归 AU-07 |
| 已实现场景有局部测试证据 | 是，见 §6 |
| 承重主链有外部自动化驱动真实页面证据 | 是，10 条相关 Tauri / quality_accept driver |
| 文档、README、blueprint、ledger、tasks/slices、quality manifest 同步 | 本轮同步 |
| task_done 与 ai_static_scan | 本轮复跑；gitleaks accepted_risk 为既有处置项 |

结论：AU-06 当前可以进入下一个验收文件 AU-07。下一阶段不应重复补确认主链，而应转向 AU-07 trace/replay，把 AU-06 剩余 P1 的 BehaviorTrace / replay 解释闭环接住。
