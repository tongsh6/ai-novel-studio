# AU04 File-Level Closure

- 状态：file-level deliverable / P1-P2 follow-up registered
- 类型：Author Acceptance File Closure
- 验收文件：`docs/design/acceptance/author/AU-04-execute-and-confirm.md`
- 当前结论：18 个场景中 10 个已有真实页面外部自动化证据，5 个已测试，3 个部分实现；P0 已关闭，2026-06-22 二轮已关闭本文件内应处理的确认主链 trace 持久化回归，当前可进入 AU-05。
- 最近复核：2026-06-22

## 1. 文件级目标

AU-04 验收作者要求 AI 执行具体工作时的执行权边界：MicroPlan 只是建议，Orchestrator 才能授权；高风险、写入、确认、取消、重复点击、旧 turn/旧作品、上下文变化和失败恢复都必须由服务端绑定、重审、追踪，并且确认前不得调用工具或写入作品事实。

本文件是 AU-04 的文件级收口记录。它不把 AU-06 的完整 behavior lifecycle、AU-07 replay、AU-10 LongRunner 或持久 ConfirmationBinding snapshot 冒充为当前文件完成项，而是登记为后续 owner。

## 2. 开工检查

- Contract：`docs/design/acceptance/author/AU-04-execute-and-confirm.md`；`docs/design/contracts/VS-01-execution-authority-contract-pack.md`；`docs/design/contracts/VS-03-behavior-lifecycle-contract-pack.md`；`docs/design/adr/ADR-0005-execution-gate-order-v3.md`；`docs/design/adr/ADR-0007-next-action-available-action-v3.md`；`docs/design/adr/ADR-0009-confirmation-binding-v3.md`；`AvailableAction` / `AuthorActionInput` / `ConfirmationBinding` / `TurnResult.ui_cards`。
- Invariant：MicroPlan 不授权；确认前 no-tool/no-write；确认卡解释确认对象、确认前边界和确认后 re-gate；UI 只能提交服务端 action；confirm/reject/cancel 绑定 open behavior；确认后必须重新 gate；重复、stale、expired、disabled、history-readonly、cross-work action 不得执行；执行产物默认 pending adoption；失败不得半写入。
- Boundary：切穿真实 Tauri UI、Phoenix Channel、`DialogueGateway`、`ExecutionOrchestrator`、`ActionValidator`、`TurnResultBuilder`、domain `BehaviorState` / `ConfirmationBinding`、persistence receipt / TurnResult replay evidence 和 `frontend/slice-verify` 外部 driver；不把 test/support provider 注册进 production runtime，不在 `frontend/src` 增加验收感知逻辑。
- Consumer：`WorkspaceChat` 确认卡和 action panel、`WorkspaceChannel.handle_in("author_action")`、`DialogueGateway.handle_action/3`、AU-04 quality acceptance runner、AU-06/AU-07/AU-10 后续 owner。
- Proof：AU-04 application/web/frontend 局部测试、9 个 AU-04 默认 Tauri driver、`au06-single-active-confirmation` 与 `au10-workbench-recovery-cancel-waiting` cross evidence、10 个 AU-04/AU-06 quality acceptance 入口、`task_done` 与 AI static scan。
- Acceptance Driver：`scripts/tauri_slice_verify.sh au04-*` 从产品外部驱动真实 Tauri 页面，通过作者可见输入、按钮、作品菜单、历史 session、websocket/backend log、summary artifact 取证。产品代码没有读取 slice id、没有隐藏 DOM hook、没有验收专用 env/query/localStorage、没有自动输入/点击/上报验收状态。

### 2.1 二轮 checkpoint 开工检查：确认后工具 trace 去重

- Contract：`WorkspaceChannel.handle_in("author_action")`、`DialogueGateway.handle_action/3`、`TurnResult.trace_summary.trace_ref`、`decision_traces.trace_id` 唯一约束、AU-04 A1/B2/E1 确认链路与可追溯性契约。
- Invariant：确认后执行只能持久化一条同 `trace_id` 的决策 trace；已由 application 在工具执行链写入的 trace 不应再被 Channel 用 action summary 重复写入；确认动作必须仍保留 author action receipt、ack、tool trace 和 pending artifact 证据。
- Boundary：只修改 `novel_web` Channel action trace 持久化分支和对应 Channel test；不改 `DialogueGateway` / `TraceRepository` 持久化契约，不改生产 provider runtime，不加验收感知 env/query/localStorage/DOM hook。
- Consumer：真实 Tauri 工作台点击“确认执行”后的 `author_action`、`au04-confirm-before-execute` quality acceptance、AU-07 后续 replay/trace 消费者。
- Proof：Channel idempotency test 新增“确认 re-gate 后不记录 channel.persist_trace 失败”断言；AU-04/AU-06 targeted backend tests；`au04-confirm-before-execute` 与全部 AU-04/AU-06/AU-10 相关真实 Tauri quality 入口串行复跑。
- Acceptance Driver：`bash scripts/quality_accept.sh au04-confirm-before-execute --surface tauri` 从产品外部驱动真实 Tauri 页面完成高风险确认、点击确认、重新 gate、工具执行与 pending artifact 取证；产品代码没有新增任何验收专用逻辑。

## 3. 场景对账矩阵

| 场景 | 设计期望 | Contract / invariant | 相关实现入口 | 局部测试证据 | 真实页面外部自动化验收证据 | 当前状态 | 设计偏差 | 缺口类型 | 优先级 | 建议 checkpoint |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-AU04-A1 高风险写入先要求确认 | 高风险写入先 `needs_confirmation`，确认前 no-tool/no-write | AU04-I1/I4；ADR-0005/0009 | `ExecutionOrchestrator`、`DialogueGateway`、`TurnResultBuilder` | execution authority / full chain tests | `au04-confirm-before-execute` | 已验收 | 无 | 无 | closed | 保持回归 |
| SC-AU04-A2 低风险单步工具仍为草稿 | 低风险单步可执行，创作结果 pending adoption | AU04-I9 | `DialogueGateway.execute_tool`、`TurnResultBuilder.build_artifact_set/2` | application/channel tests | 无专属真实 UI | 已测试 | 无 | 补验收 | P1 | AU-05/AU-10 owner |
| SC-AU04-A3 过大请求降级讨论 | 多步大任务降级，不显示误导执行按钮 | AU04-I1/I2/I3 | `ExecutionOrchestrator.decide/2` | `execution_authority_test.exs` | 无 | 已测试 | 无 | 补验收 | P1 | AU-11/AU-04 follow-up |
| SC-AU04-A4 普通聊天不误触发确认 | 普通讨论自然回复，不打开 confirmation | no-MicroPlan default | `WorkspaceChannel`、`WorkspaceChat` | ordinary chat tests | `au01-ordinary-chat-two-turn-roundtrip`、`au02-freeform-followup-after-candidate` | 已验收 | 无 | cross-reference | closed | 保持 AU-01/AU-02 回归 |
| SC-AU04-B1 确认卡内容完整 | 展示确认对象、影响范围、确认、取消 | UI card + AvailableAction | `TurnResultBuilder.maybe_add_behavior_card/2`、`WorkspaceChat` | `behavior_lifecycle_test.exs`、native verifier test | `au04-confirm-before-execute`、`au04-disabled-confirmation-action-ui` | 已验收 | replay 解释未完 | cross-reference | closed | AU-07 replay owner |
| SC-AU04-B2 点击确认走 `author_action` | 提交服务端 action_id/type/ref/idempotency | AU04-I5/I6 | `socket.ts`、`WorkspaceChannel`、`ActionValidator` | action roundtrip / channel tests | `au04-confirm-before-execute` | 已验收 | 无 | 无 | closed | 保持回归 |
| SC-AU04-B3 点击取消关闭等待态 | cancel/reject 关闭 active behavior，no-write，可继续聊天 | Behavior lifecycle | `DialogueGateway.handle_action/3` | channel tests | `au10-workbench-recovery-cancel-waiting` | 已验收 | 完整 replay 未完 | cross-reference | closed | AU-06/AU-07 owner |
| SC-AU04-B4 重复点击确认不重复执行 | 同 idempotency key 只执行一次 | receipt idempotency | `ActionValidator`、author action receipts | channel idempotency tests | `au04-confirm-idempotency-ui` | 已验收 | 无 | 无 | closed | 保持回归 |
| SC-AU04-B5 旧 turn/旧作品确认被拒绝 | stale/expired/history/cross-work 不执行 | action freshness/scope | `ActionValidator`、session/work switching | channel tests | `au04-stale-confirmation-ui`、`au04-confirmation-ttl-ui`、`au04-history-confirmation-readonly`、`au04-cross-work-confirmation-guard` | 已验收 | 持久 binding replay 未完 | cross-reference | closed | AU-07 owner |
| SC-AU04-B6 上下文变化后重新 gate | 确认时消费最新 Work/session state | ConfirmationBinding refs | `DialogueGateway.handle_action/3`、`ContextAssembler` | action roundtrip / idempotency tests | `au04-latest-context-rebase-confirmation` | 已验收 | 持久 snapshot 实体未完 | cross-reference | closed | AU-07/AU-06 owner |
| SC-AU04-C1 UI 不能提交 invented action | 后端拒绝 TurnResult 未授权 action | AU04-I5 | `ActionValidator.validate/2` | `action_roundtrip_test.exs`、channel tests | 无 | 已测试 | 无 | 补验收 | P1 | action-boundary UI regression |
| SC-AU04-C2 AI 夹带批准语义被拦截 | forbidden semantics 不授权 | AU04-I1/I2 | frame validator / orchestrator | `execution_authority_test.exs` | 无真实 LLM 样本 | 已测试 | 无 | 补验收 | P1 | AU-11/AU-04 real LLM |
| SC-AU04-C3 Planner 风险提示不授权 | Orchestrator 自行判定 write boundary | AU04-I2/I4 | `ExecutionOrchestrator` | `execution_authority_test.exs` | 无真实 LLM 样本 | 已测试 | 无 | 补验收 | P1 | AU-11/AU-04 real LLM |
| SC-AU04-D1 确认后任务状态反馈 | RUNNING/COMPLETED/FAILED 作者可见 | task_state / ToolResult | `Toolbox`、`WorkspaceChat`、LongRunner | channel task_state tests | `au04-confirmation-tool-failure-recovery`；AU-10 task_state/export evidence | 部分实现 | LongRunner 无真实消费者 | 补验收 | P1 | AU-10 owner |
| SC-AU04-D2 执行产物默认 pending | 执行结果不直接写作品事实 | AU04-I9 | `TurnResultBuilder`、adoption state | e2e / application tests | `au04-confirm-before-execute` | 已验收 | 无 | 无 | closed | AU-05/AU-08 后续采纳 |
| SC-AU04-D3 AI 回复不撒谎 | assistant text 与 execution/truthfulness 一致 | AU04-I8 | `TurnResultBuilder.build_truthfulness/3` | truthfulness constraints | 无真实 LLM/UI | 部分实现 | 文案强约束不足 | 补测试/验收 | P1 | AU-11/AU-04 owner |
| SC-AU04-E1 确认行为可追溯 | trace 含 decision/behavior/action/gate/tool | trace / replay | `TraceWriter`、summary views | trace tests | 无完整 replay UI | 部分实现 | author/developer replay 未完 | 补验收 | P1 | AU-07 owner |
| SC-AU04-E2 执行失败后恢复 | failed visible，no pending draft/no write，可继续 | fail_with_recovery | `Toolbox`、provider gateway、`TurnResultBuilder` | provider fixture tests | `au04-confirmation-tool-failure-recovery` | 已验收 | timeout/retry 未完 | 补验收 | P1/P2 | AU-10/AU-07 owner |

### 3.1 二轮剩余缺口矩阵（2026-06-22）

| 场景 ID / 名称 | 第一轮状态 | 剩余缺口描述 | 缺口类型 | 优先级 | 当前证据 | 需要补的实现或验收 driver | 是否应在 AU-04 内关闭 | 建议 checkpoint / slice | 是否满足继续到 AU-05 的二轮退出标准 |
|---|---|---|---|---|---|---|---|---|---|
| SC-AU04-A1 高风险写入先要求确认 | 已验收 | 二轮复跑 `au04-confirm-before-execute` 时发现确认后工具链已由 application 持久化 trace，Channel 又用同一 `trace_id` 写 action trace，触发唯一约束失败；UI 主链可见但质量入口超时，属于当前文件内应关闭回归。 | 本轮关闭的 P1 / current runnable regression | P1 -> closed | `artifacts/slice-verify/au04-confirm-before-execute-tauri/summary.json`；修复后无 `channel.persist_trace.error`，`slice_verify.ui_state.done` 存在 | `WorkspaceChannel.record_action_decision_trace/2` 对 `decision_type=tool_dispatched` 的 action result 跳过重复 Channel trace 持久化；补 Channel log regression test；复跑 quality driver | 是，已关闭 | `AU04-confirm-action-tool-trace-dedup` | 是 |
| SC-AU04-A2 低风险单步工具仍为草稿 | 已测试 | 低风险工具真实入口、task 状态和 pending adoption 完整体验尚无专属真实页面验收；不影响高风险确认主链。 | 后续真实入口矩阵 | P1 | application/channel tests；AU-10 task_state/export cross evidence | 补低风险单步工具真实工作台 driver，证明直接执行仍只进入 pending adoption | 否，移交 AU-05/AU-10 | `AU05-low-risk-tool-pending-adoption` 或 AU-10 task_state 矩阵 | 是，已登记 owner |
| SC-AU04-A3 过大请求降级讨论 | 已测试 | 过大任务降级只有局部门禁测试，缺真实 UI 文案和无误导 action 按钮反证。 | 后续 UI/文案验收 | P1 | `execution_authority_test.exs` | 补真实页面 downgrade driver，断言无确认/执行按钮且文案不声称已执行 | 否，本轮无当前 runnable blocker | `AU11/AU04-oversized-downgrade-ui` | 是，已登记 owner |
| SC-AU04-A4 普通聊天不误触发确认 | 已验收 | 无 AU-04 当前缺口；更多异常矩阵随 AU-01/AU-11 继续。 | cross-reference | closed/P2 | `au01-ordinary-chat-two-turn-roundtrip`、`au02-freeform-followup-after-candidate` | 保持回归 | 否 | AU-01/AU-02 普通聊天回归 | 是 |
| SC-AU04-B1 确认卡内容完整 | 已验收 | 主确认卡说明内容已闭环；replay 解释和完整 action/card matrix 不是当前确认主链 blocker。 | cross-reference | closed/P2 | `au04-confirm-before-execute`、`au04-disabled-confirmation-action-ui` | AU-07 补 replay 视图；后续补更多 disabled/card matrix | 否 | `AU07-confirmation-replay-view` | 是 |
| SC-AU04-B2 点击确认走 `author_action` | 已验收 | 主路径已闭环；二轮 trace 去重修复后 quality 入口恢复通过。 | 本轮关闭的 trace 回归关联项 | closed | `au04-confirm-before-execute`；Channel idempotency/rebase test | 保持 `author_action` payload 与服务端 action 精确绑定回归 | 是，关联 A1 已关闭 | `AU04-confirm-action-tool-trace-dedup` | 是 |
| SC-AU04-B3 点击取消关闭等待态 | 已验收 | 取消等待主路径有真实 Tauri cross evidence；完整 terminal replay 仍归 AU-07/AU-06。 | cross-reference | closed/P1 | `au10-workbench-recovery-cancel-waiting` | AU-07 补 terminal BehaviorTrace/replay；AU-06 继续 lifecycle 深水区 | 否 | AU-06/AU-07 behavior terminal replay | 是 |
| SC-AU04-B4 重复点击确认不重复执行 | 已验收 | 无当前缺口；持久 ConfirmationBinding snapshot 仍未独立物化。 | 后续持久模型 | closed/P2 | `au04-confirm-idempotency-ui` | 后续在 persistent binding snapshot owner 中补实体和 replay | 否 | AU-06/AU-07 persistent binding snapshot | 是 |
| SC-AU04-B5 旧 turn/旧作品确认被拒绝 | 已验收 | stale、expired、history-readonly、cross-work 主矩阵已闭环；持久 replay 解释仍缺。 | cross-reference | closed/P2 | `au04-stale-confirmation-ui`、`au04-confirmation-ttl-ui`、`au04-history-confirmation-readonly`、`au04-cross-work-confirmation-guard` | AU-07 补 replay 解释；AU-06 补更深 lifecycle ledger | 否 | AU-06/AU-07 stale confirmation replay | 是 |
| SC-AU04-B6 上下文变化后重新 gate | 已验收 | latest-context rebase 主路径已闭环；目标变化必须重新确认的冲突矩阵和持久 snapshot 仍未补。 | 后续复杂冲突矩阵 | P2/P1 | `au04-latest-context-rebase-confirmation`；Channel rebase test | 后续补目标变更冲突 driver 与 persistent ConfirmationBinding snapshot | 否 | AU-06/AU-07 rebase conflict matrix | 是，已登记 owner |
| SC-AU04-C1 UI 不能提交 invented action | 已测试 | 后端拒绝 invented action 有测试；缺从真实 UI/Channel 边界证明普通作者无法提交未授权 action 的负向回归。 | 安全负向验收 | P1 | `action_roundtrip_test.exs`、Channel tests | 补非产品 hook 的 Channel/security regression，或通过真实 UI 证明按钮只来自 server actions | 否，本轮无真实 UI 可触发路径 | `AU04/AU10-action-boundary-regression` | 是，已登记 owner |
| SC-AU04-C2 AI 夹带批准语义被拦截 | 已测试 | 真实 LLM 样本和 UI 友好恢复不足。 | live LLM / semantic guard | P1 | `execution_authority_test.exs` | 补 real LLM forbidden semantics sample 与用户可见恢复路径 | 否 | `AU11/AU04-forbidden-semantics-real-llm` | 是，已登记 owner |
| SC-AU04-C3 Planner 风险提示不授权 | 已测试 | 缺真实 LLM Planner hint 不授权的矩阵。 | live LLM / planner hint | P1 | `execution_authority_test.exs` | 补 real LLM planner hint driver，证明 Orchestrator 自行裁决 write boundary | 否 | `AU11/AU04-planner-hint-not-authority` | 是，已登记 owner |
| SC-AU04-D1 确认后任务状态反馈 | 部分实现 | 同步成功/失败主路径已有证据；完整 LongRunner RUNNING/COMPLETED/FAILED 真实消费者未到位。 | LongRunner external blocker / 后续 owner | P1 | `au04-confirmation-tool-failure-recovery`；AU-10 task_state/export evidence | 等真实 LongRunner consumer 后补 streaming/terminal task_state driver | 否 | AU-10 LongRunner matrix | 是，登记为 AU-10 owner |
| SC-AU04-D2 执行产物默认 pending | 已验收 | 无当前缺口；后续采纳归 AU-05/AU-08。 | closed / cross-reference | closed | `au04-confirm-before-execute` | 保持 pending adoption 回归；AU-05/AU-08 负责采纳/阅读投影 | 否 | AU-05/AU-08 adoption projection | 是 |
| SC-AU04-D3 AI 回复不撒谎 | 部分实现 | assistant text 与 execution/truthfulness 的真实 LLM/UI 强约束不足。 | truthfulness / live LLM | P1 | truthfulness constraints；部分 TurnResult builder 约束 | 补真实 UI/LLM driver，断言未执行时不声称已执行、失败时不声称成功 | 否 | AU-11/AU-04 truthfulness matrix | 是，已登记 owner |
| SC-AU04-E1 确认行为可追溯 | 部分实现 | 本轮发现并关闭 duplicate trace persistence；完整 author/developer replay 仍归 AU-07。 | 本轮关闭的 trace 持久化回归 + 后续 replay | P1 -> closed / 后续 P1 | 修复后 `au04-confirm-before-execute` 通过；Channel log regression test；AU-07 partial replay evidence | 已补 trace 去重；后续补 replay 双视图和完整 trace refs | 是，当前回归已关闭；replay 不在本文件冒充完成 | `AU04-confirm-action-tool-trace-dedup`；AU-07 replay | 是 |
| SC-AU04-E2 执行失败后恢复 | 已验收 | 确认后工具失败主路径已闭环；LLM timeout、retry action、完整 replay 解释仍缺。 | timeout/retry/replay 后续 | P1/P2 | `au04-confirmation-tool-failure-recovery`；`provider_error_count=1`、`toolbox_execute_error_count=1`、`pending_prose_fragment_after_failure_count=0` | AU-10/AU-07 补 timeout/retry/no-write/replay driver | 否 | AU-10 provider timeout/retry；AU-07 failure replay | 是，已登记 owner |

## 4. 偏差 review

- 确认卡内容：旧证据只证明“确认执行/拒绝”按钮可见，不能证明作者能看懂确认对象、确认前不执行不写入、确认后重新 gate。本 checkpoint 已把说明内容作为产品 `confirmation_card` 输出，并收紧 `au04-confirm-before-execute` 外部 driver 断言。
- 执行权边界：`ActionValidator`、receipt idempotency、expired/stale/cross-work guard 和 latest-context rebase 已形成真实入口证据链；没有发现需要为验收添加产品 hook 的实现偏差。
- trace 持久化：二轮发现并修复确认后工具 trace 重复落库。确认后的 `tool_dispatched` TurnResult 已由 application 侧随工具执行 trace 持久化，Channel 不再用同一 `trace_id` 追加 action-only trace；adoption / cancel 等非工具 action 仍保留 Channel trace 持久化路径。
- 持久与 replay：ConfirmationBinding refs 已是强契约并被真实 rebase driver 证明，但持久 snapshot 实体、author/developer replay 解释仍是 AU-07/AU-06 P1，不在 AU-04 当前文件内冒充完成。
- LongRunner：同步 creative tool 的 success/failure 已有证据；异步 RUNNING/COMPLETED/FAILED 全矩阵缺真实生产消费者，继续归 AU-10。

## 5. 缺口分级

| 优先级 | 缺口 | 处置 |
|---|---|---|
| P0 | 无 | AU-04 文件级 P0 已关闭：确认卡内容、主确认链、action binding、幂等、freshness/scope、latest-context rebase、pending adoption 和失败恢复主路径均有证据。 |
| P1 -> closed | SC-AU04-A1/B2/E1 确认后工具 trace 重复持久化 | 二轮复跑发现 `au04-confirm-before-execute` 因 Channel 重复写入 application 已持久化的 `tool_dispatched` trace 而触发 `decision_traces_trace_id_index` 唯一约束；已修复为跳过这类 Channel 二次落库，并补 Channel regression test。 |
| P1 | SC-AU04-A2/A3/C1/C2/C3 真实入口/真实 LLM 矩阵不足 | Owner：AU-04/AU-11/AU-10。恢复路径：补低风险工具真实 pending adoption、oversized downgrade UI、invented action UI regression、forbidden semantics real LLM / UI 友好恢复。 |
| P1 | SC-AU04-D1/D3/E1 LongRunner、assistant_message truthfulness、trace/replay 不足 | Owner：AU-10/AU-11/AU-07。恢复路径：等真实 LongRunner 消费者出现后补 streaming；补 assistant text 不撒谎测试；在 AU-07 补 confirmation replay author/developer 双视图。 |
| P1/P2 | SC-AU04-E2 timeout/retry action 和缩小范围建议不足 | Owner：AU-10/AU-07。恢复路径：在 provider timeout / retry slice 中补 no-write、retry action、replay 解释。 |
| P2 | 持久 ConfirmationBinding snapshot 实体与完整 action matrix | Owner：AU-06/AU-07。当前 refs/binding proof 已足够关闭 AU-04 文件级 P0；持久实体与完整 replay 作为 lifecycle 深水区继续。 |

## 6. 验证记录

已复跑：

```bash
mix test apps/novel_application/test/novel_application/behavior_lifecycle_test.exs apps/novel_application/test/novel_application/execution_authority_test.exs apps/novel_application/test/novel_application/action_roundtrip_test.exs apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs apps/novel_web/test/novel_web/channels/workspace_channel_action_idempotency_test.exs
mix test apps/novel_web/test/novel_web/channels/workspace_channel_action_idempotency_test.exs
pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs
bash scripts/tauri_slice_verify.sh au04-confirm-before-execute
bash scripts/tauri_slice_verify.sh au04-confirm-idempotency-ui
bash scripts/tauri_slice_verify.sh au04-stale-confirmation-ui
bash scripts/tauri_slice_verify.sh au04-confirmation-ttl-ui
bash scripts/tauri_slice_verify.sh au04-disabled-confirmation-action-ui
bash scripts/tauri_slice_verify.sh au04-history-confirmation-readonly
bash scripts/tauri_slice_verify.sh au04-cross-work-confirmation-guard
bash scripts/tauri_slice_verify.sh au04-latest-context-rebase-confirmation
bash scripts/tauri_slice_verify.sh au04-confirmation-tool-failure-recovery
bash scripts/tauri_slice_verify.sh au10-workbench-recovery-cancel-waiting
bash scripts/quality_accept.sh au04-confirm-before-execute --surface tauri
bash scripts/quality_accept.sh au04-confirm-idempotency-ui --surface tauri
bash scripts/quality_accept.sh au04-stale-confirmation-ui --surface tauri
bash scripts/quality_accept.sh au04-confirmation-ttl-ui --surface tauri
bash scripts/quality_accept.sh au04-disabled-confirmation-action-ui --surface tauri
bash scripts/quality_accept.sh au04-history-confirmation-readonly --surface tauri
bash scripts/quality_accept.sh au04-cross-work-confirmation-guard --surface tauri
bash scripts/quality_accept.sh au04-latest-context-rebase-confirmation --surface tauri
bash scripts/quality_accept.sh au04-confirmation-tool-failure-recovery --surface tauri
bash scripts/quality_accept.sh au06-single-active-confirmation --surface tauri
bash scripts/quality_accept.sh au10-workbench-recovery-cancel-waiting --surface tauri
bash scripts/quality_manifest_check.sh
mix compile --warnings-as-errors
mix test
mix xref graph --format cycles --label compile-connected --fail-above 0
mix run scripts/arch_check.exs
pnpm --dir frontend typecheck
pnpm --dir frontend lint
pnpm --dir frontend test
bash scripts/frontend_audit.sh
bash scripts/check_design_trace.sh
MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs
git diff --check
```

说明：`au06-single-active-confirmation` 和 `au10-workbench-recovery-cancel-waiting` 当前作为 AU-04 cross evidence 使用，均已在 quality acceptance manifest 中登记并可复跑；AU-06/AU-10 的文件级剩余缺口仍由各自 closure 继续追踪。

结果：

- AU-04 targeted backend / Channel tests 通过；二轮新增 Channel trace regression test：4 tests / 0 failures。
- 全量后端默认测试：914 tests / 0 failures；integration / real_llm 标签按默认排除；测试进程结束阶段出现一次异步 summary maintenance DB owner shutdown 日志，但 ExUnit 退出码为 0，未形成测试失败。
- 前端全量测试：22 files / 282 tests / 0 failures。
- `au04-confirm-before-execute` 已记录新断言 `confirmation_card_explains_target_no_write_and_re_gate_in_real_workbench`，`ui-state.json` 中 `confirmation_card_detail_visible`、`confirmation_card_target_visible`、`confirmation_card_no_write_visible`、`confirmation_card_re_gate_visible` 均为 `true`。
- 9 个 AU-04 默认 Tauri driver 均 passed；`au06-single-active-confirmation` 与 `au10-workbench-recovery-cancel-waiting` cross evidence driver passed。
- 9 个 AU-04 quality acceptance 入口、`au06-single-active-confirmation` 与 `au10-workbench-recovery-cancel-waiting` 均 passed。
- `quality_manifest_check.sh` passed；warning 均为其它非 AU-04/AU-06/AU-10 当前复验项缺 manifest。
- `mix compile --warnings-as-errors`、xref cycles、`arch_check`、frontend audit、design trace、I1/I2/I3 scenario invariants 和 `git diff --check` 均 passed。
- `task_done.sh --skip-static-scan` passed，latest manifest 由命令输出；`task_done_check.mjs` passed。
- `ai_static_scan.sh --top 10`：17 passed / 1 failed / 0 skipped；唯一 Top 10 是既有 gitleaks `generic-api-key` accepted_risk，0 touched-file finding，blocking=0。

## 7. 退出结论

AU-04 满足文件级退出标准：

1. 18 个场景均有可信对账矩阵。
2. P0 已关闭。
3. P1/P2 已登记 owner 与恢复路径：AU-06 负责 deeper lifecycle / persistent snapshot，AU-07 负责 replay/trace，AU-10 负责 LongRunner/timeout/retry，AU-11 负责 assistant_message truthfulness / real LLM semantics。
4. 已实现场景均有局部测试证据；承重确认主链有外部 Tauri 真实页面证据。
5. AU-04 quality manifest、slice driver、summary artifact、验收 README、SCENARIO-BLUEPRINT 和项目台账口径一致。

当前可进入下一个验收文件：`docs/design/acceptance/author/AU-05-artifact-adoption.md`。
