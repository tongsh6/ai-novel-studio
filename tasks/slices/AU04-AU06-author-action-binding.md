# AU04/AU06 Author Action Binding

- 状态：doing（AU-04 高风险确认主链、重复确认幂等、当前-turn stale / expired / disabled / history-readonly / cross-work / latest-context rebase checkpoint closed；ConfirmationBinding re-gate refs 局部闭环；完整 action matrix 继续）
- 类型：Behavior Slice / UI Contract Slice / Acceptance Slice
- 启动日期：2026-06-19
- 来源：`docs/design/acceptance/author/AU-04-execute-and-confirm.md` SC-AU04-A1/B2/B3/B4/B5/D2、`docs/design/acceptance/author/AU-06-behavior-lifecycle.md` SC-AU06-B1/B2/B5/C1/C5。

## 1. 用户 / 系统目标

作者点击确认、取消或采纳类 action 时，系统必须确认这个动作就是服务端当前 TurnResult 暴露的 action，而不是前端、旧会话或恶意客户端发明/篡改的动作。`behavior_ref`、`target_ref`、`candidate_*` 和 `idempotency_key` 都属于 action 绑定的一部分。作者取消、拒绝或确认 waiting behavior 后，结果必须关闭具体 behavior，进入 `behavior_state.history`，且按 action 类型维持 no-write 或 adoption boundary 语义。

## 2. 开工检查

- Contract: `AuthorActionInput`、`AvailableAction`、AU-04 §A1/B2/B4/B5/B6/D2、AU-06 §B1/B5/C5、`docs/design/contracts/VS-03-behavior-lifecycle-contract-pack.md`、`docs/design/adr/ADR-0009-confirmation-binding-v3.md`。
- Invariant: UI 只能提交服务端 action；高风险执行确认前不得 tool dispatch 或 production write；确认/取消必须绑定 open behavior；确认后必须重新 gate，并留下 `rebased_state_snapshot_ref` / `gate_result_refs` proof；取消/拒绝必须关闭具体 behavior 且 no-write；同一 `idempotency_key` 不重复执行；当前 turn 已推进后旧 confirmation action 不能继续执行；超过 `available_action.expires_at` 的 confirmation 不能触发 re-gate、tool dispatch 或 pending draft；`enabled=false` 的 confirmation action 可以可见但不能提交到 `author_action` 边界；历史只读 transcript 内的 confirmation 不能渲染为可执行 action，也不能发送 `author_action`；切换到其他作品后，源作品 confirmation 不能在目标作品可见或可执行，且不能派发工具或产生 pending draft；确认等待期间 Work facts 变化时，确认后的 binding / trace 必须消费确认时最新 Work snapshot。
- Boundary: 已修改过 `novel_domain` behavior snapshot / ConfirmationBinding contract、`novel_application` action validation / cancel TurnResult / confirmation re-gate proof、`novel_web` Channel contract tests 与当前-turn stale guard；`novel_persistence` 只做 TurnResult Ecto mirror 与 JSON SSOT 同步的验证卫生修复；本次不修改 provider、production UI 自动化逻辑或验收 hook。
- Consumer: `DialogueGateway.handle_action/3`、`ExecutionOrchestrator.decide/3`、`WorkspaceChannel.handle_in("author_action")`，以及真实工作台通过 `WorkspaceChat` / `socket.ts` 提交的 author action。
- Proof: `mix test apps/novel_domain/test/novel_domain/confirmation_binding_test.exs apps/novel_application/test/novel_application/execution_authority_test.exs apps/novel_application/test/novel_application/action_roundtrip_test.exs apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs apps/novel_web/test/novel_web/channels/workspace_channel_action_idempotency_test.exs`、`pnpm --dir frontend test -- --run frontend/slice-verify/native-tauri-verifier.test.mjs`、`bash scripts/tauri_slice_verify.sh au04-confirm-before-execute`、`bash scripts/tauri_slice_verify.sh au04-confirm-idempotency-ui`、`bash scripts/tauri_slice_verify.sh au04-stale-confirmation-ui`、`bash scripts/tauri_slice_verify.sh au04-confirmation-ttl-ui`、`bash scripts/tauri_slice_verify.sh au04-disabled-confirmation-action-ui`、`bash scripts/tauri_slice_verify.sh au04-history-confirmation-readonly`、`bash scripts/tauri_slice_verify.sh au04-cross-work-confirmation-guard`、`bash scripts/tauri_slice_verify.sh au04-latest-context-rebase-confirmation`、`bash scripts/quality_accept.sh au04-confirm-before-execute --surface tauri`、`bash scripts/quality_accept.sh au04-confirm-idempotency-ui --surface tauri`、`bash scripts/quality_accept.sh au04-stale-confirmation-ui --surface tauri`、`bash scripts/quality_accept.sh au04-confirmation-ttl-ui --surface tauri`、`bash scripts/quality_accept.sh au04-disabled-confirmation-action-ui --surface tauri`、`bash scripts/quality_accept.sh au04-history-confirmation-readonly --surface tauri`、`bash scripts/quality_accept.sh au04-cross-work-confirmation-guard --surface tauri`、`bash scripts/quality_accept.sh au04-latest-context-rebase-confirmation --surface tauri`。
- Acceptance Driver: `bash scripts/tauri_slice_verify.sh au04-confirm-before-execute` 从真实工作台输入高风险重写请求，等待 `needs_confirmation`，点击“确认执行”，验证 `author_action`、re-gate、`prose_writing` 和 pending artifact；`bash scripts/tauri_slice_verify.sh au04-confirm-idempotency-ui` 在同一真实确认卡上快速点击两次，验证重复确认只产生 1 次非 duplicate receipt、1 次工具 dispatch 和 1 份 pending artifact；`bash scripts/tauri_slice_verify.sh au04-stale-confirmation-ui` 在确认卡出现后先发送普通 follow-up 推进当前 turn，再点击旧确认，验证 Channel 以 stale 拒绝且 no-tool/no-draft；`bash scripts/tauri_slice_verify.sh au04-confirmation-ttl-ui` 通过测试数据库恢复一个过期 persisted TurnResult，再在真实工作台点击可见“确认执行”，验证 Channel 以 expired 拒绝且 no-tool/no-draft；`bash scripts/tauri_slice_verify.sh au04-disabled-confirmation-action-ui` 通过测试数据库恢复一个 confirm action 为 disabled 的 TurnResult，验证真实工作台中“确认执行”可见但禁用，点击被浏览器阻止且 no-author-action/no-tool/no-draft；`bash scripts/tauri_slice_verify.sh au04-history-confirmation-readonly` 通过测试数据库恢复一个 EXITED 历史 session 中未过期的 confirmation TurnResult，再从真实工作台打开历史只读 transcript，验证确认动作隐藏且 no-action/no-tool/no-draft；`bash scripts/tauri_slice_verify.sh au04-cross-work-confirmation-guard` 通过测试数据库恢复源作品 confirmation 与目标作品 active transcript，从真实作品菜单切换，验证源作品 confirmation 在目标作品不可见、不可执行，且 no-action/no-tool/no-draft，切回源作品后 confirmation 仍恢复；`bash scripts/tauri_slice_verify.sh au04-latest-context-rebase-confirmation` 通过测试数据库恢复一个待确认 TurnResult，从真实作品菜单改名当前 Work 后点击确认，验证 binding / trace 消费最新 Work revision/title 且只产出 pending `character_seed`。产品代码未新增验收感知逻辑。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改 enum / validator |
| novel_domain | yes | `BehaviorState.snapshot/1` 暴露 terminal replay 所需 refs；`ConfirmationBinding` 强制 snapshot/gate proof 字段 |
| novel_agent | no | 不触碰 provider/runtime |
| novel_application | yes | `ActionValidator` 精确校验 action scope/idempotency；`DialogueGateway` / `ExecutionOrchestrator` 留下 confirmation re-gate proof |
| novel_persistence | yes | 不改 receipt schema；只同步 TurnResult Ecto mirror 的 `candidate_directions` 可选字段以恢复 schema drift / full `mix test` |
| novel_web | yes | 补 Channel contract tests |
| frontend | yes | 只改 `frontend/slice-verify` 外部 driver / verifier / tests；生产 `frontend/src` 不新增验收感知逻辑 |
| docs/design | yes | 更新 AU-04/AU-06/blueprint 当前证据 |
| quality | yes | 新增 `quality/acceptance/scenarios/au04-confirm-before-execute.yml`、`quality/acceptance/scenarios/au04-confirm-idempotency-ui.yml`、`quality/acceptance/scenarios/au04-stale-confirmation-ui.yml`、`quality/acceptance/scenarios/au04-confirmation-ttl-ui.yml`、`quality/acceptance/scenarios/au04-disabled-confirmation-action-ui.yml`、`quality/acceptance/scenarios/au04-history-confirmation-readonly.yml`、`quality/acceptance/scenarios/au04-cross-work-confirmation-guard.yml`、`quality/acceptance/scenarios/au04-latest-context-rebase-confirmation.yml` 并登记总表 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | `ActionValidator` 精确校验 `behavior_ref` / `target_ref` / `candidate_*` / `idempotency_key` | done | 服务端 action 带字段时客户端必须原样回传，额外篡改也拒绝 |
| T2 | 补 application / Channel 回归测试 | done | 覆盖漏传 `behavior_ref`、错 `idempotency_key` 不广播 action result |
| T3 | 通用取消/拒绝输出 terminal behavior history | done | `DialogueGateway` 返回 `CANCELLED` history、`closed_at_turn_ref`、`resolution_ref`，no tool/no write |
| T4 | 采纳确认 confirm/reject 输出 terminal behavior history | done | `AdoptionWorkflow` 对采纳确认 confirm 输出 `RESOLVED` history，对 reject 输出 `CANCELLED` history |
| T5 | 同步 AU-04/AU-06/blueprint 证据口径 | done | 不再记录已修复的 action scope / behavior_state 形状 / terminal history 误判 |
| T6 | 高风险确认主路径外部 UI 验收 | done | `au04-confirm-before-execute` 覆盖真实输入 -> needs_confirmation -> 点击确认 -> `author_action` -> re-gate -> tentative prose artifact |
| T7 | ConfirmationBinding re-gate refs 强契约 | done | `ConfirmationBinding.build/1` 强制 `rebased_state_snapshot_ref` / `gate_result_refs`；确认 ack 与 `reason_codes` 留下 `confirmation_binding` / `rebased_state_snapshot` / `gate_result_ref` proof |
| T8 | 重复确认真实 UI 幂等验收 | done | `au04-confirm-idempotency-ui` 覆盖真实确认卡快速双击；第二个 confirm 被 duplicate 处理，最终只有 1 次 dispatch / 1 份 pending artifact |
| T9 | 当前-turn stale confirmation 真实 UI 验收 | done | `au04-stale-confirmation-ui` 覆盖确认卡出现后发送 follow-up 推进当前 turn，再点击旧确认；Channel stale 拒绝，且无工具 dispatch / 无 pending draft |
| T10 | 过期 confirmation TTL 真实 UI 验收 | done | `au04-confirmation-ttl-ui` 覆盖 persisted TurnResult 恢复出的 expired confirmation；点击确认后 Channel expired 拒绝，且无工具 dispatch / 无 pending draft |
| T11 | 历史只读 confirmation 真实 UI 验收 | done | `au04-history-confirmation-readonly` 覆盖 EXITED 历史会话内未过期 confirmation；历史只读视图隐藏确认/拒绝动作，且无 author_action / 无工具 dispatch / 无 pending draft |
| T12 | 跨作品 confirmation 隔离真实 UI 验收 | done | `au04-cross-work-confirmation-guard` 覆盖源作品 confirmation -> 真实作品菜单切换目标作品 -> 目标作品不可见/不可执行且 no-action/no-tool/no-draft -> 切回源作品恢复 |
| T13 | latest-context rebase 真实 UI 验收 | done | `au04-latest-context-rebase-confirmation`：源作品 confirmation 等待中通过真实重命名入口改变 Work revision/title，再点击确认；summary 证明 `rebased_state_snapshot_ref` 包含 `revision:2`，trace current_work summary 包含改名标题，确认后只产生 pending `character_seed` |
| T14 | disabled confirmation action 真实 UI 验收 | done | `au04-disabled-confirmation-action-ui`：真实工作台恢复 disabled confirm action，确认按钮可见但 disabled，disabled reason 通过按钮 title 暴露；点击被浏览器阻止且 no-author-action/no-channel-action/no-tool/no-draft |
| T15 | 完整外部 UI action matrix 验收 | todo | `au10-workbench-recovery-cancel-waiting` 已覆盖取消等待主路径；仍需覆盖采纳确认 terminal history 的真实 UI 细节、持久 ConfirmationBinding snapshot、replay 和失败恢复 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh au10-workbench-recovery-cancel-waiting`
- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh au04-confirm-before-execute`
- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh au04-confirm-idempotency-ui`
- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh au04-stale-confirmation-ui`
- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh au04-confirmation-ttl-ui`
- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh au04-disabled-confirmation-action-ui`
- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh au04-history-confirmation-readonly`
- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh au04-cross-work-confirmation-guard`
- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh au04-latest-context-rebase-confirmation`
- [x] 质量验收入口：`bash scripts/quality_accept.sh au04-confirm-before-execute --surface tauri`
- [x] 质量验收入口：`bash scripts/quality_accept.sh au04-confirm-idempotency-ui --surface tauri`
- [x] 质量验收入口：`bash scripts/quality_accept.sh au04-stale-confirmation-ui --surface tauri`
- [x] 质量验收入口：`bash scripts/quality_accept.sh au04-confirmation-ttl-ui --surface tauri`
- [x] 质量验收入口：`bash scripts/quality_accept.sh au04-disabled-confirmation-action-ui --surface tauri`
- [x] 质量验收入口：`bash scripts/quality_accept.sh au04-history-confirmation-readonly --surface tauri`
- [x] 质量验收入口：`bash scripts/quality_accept.sh au04-cross-work-confirmation-guard --surface tauri`
- [x] 质量验收入口：`bash scripts/quality_accept.sh au04-latest-context-rebase-confirmation --surface tauri`
- [x] 后端 / Channel / 组件局部验证
  - `mix test apps/novel_domain/test/novel_domain/confirmation_binding_test.exs apps/novel_application/test/novel_application/execution_authority_test.exs apps/novel_application/test/novel_application/action_roundtrip_test.exs apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs apps/novel_web/test/novel_web/channels/workspace_channel_action_idempotency_test.exs`
- [x] 外部 verifier 局部验证
  - `pnpm --dir frontend test -- --run frontend/slice-verify/native-tauri-verifier.test.mjs`
- [x] 全量后端验证
  - `mix compile --warnings-as-errors`
  - `mix test`
  - `mix xref graph --format cycles --label compile-connected --fail-above 0`
  - `mix run scripts/arch_check.exs`
- [x] 前端 / UI 约束验证
  - `pnpm --dir frontend typecheck`
  - `pnpm --dir frontend lint`
  - `pnpm --dir frontend test`
  - `bash scripts/frontend_audit.sh`（0 fail；本机 DMG bundle 仍有既有 warning）
  - `bash scripts/check_design_trace.sh`
- [x] 场景不变量
  - `MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs`
  - `MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs`
  - `MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/task_done.sh --slice au04-confirm-idempotency-ui --skip-static-scan`
- [x] `bash scripts/task_done.sh --slice au04-stale-confirmation-ui --skip-static-scan`
- [x] `bash scripts/task_done.sh --slice au04-confirmation-ttl-ui --skip-static-scan`
- [x] `bash scripts/task_done.sh --slice au04-disabled-confirmation-action-ui --skip-static-scan`
- [x] `bash scripts/task_done.sh --slice au04-history-confirmation-readonly --skip-static-scan`
- [x] `bash scripts/task_done.sh --slice au04-cross-work-confirmation-guard --skip-static-scan`
- [x] `bash scripts/task_done.sh --slice au04-latest-context-rebase-confirmation --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`（17 pass / 1 accepted_risk gitleaks，0 touched-file finding，blocking=0）

## 6. 决策日志

- 2026-06-19 — 先补 action binding 的最小安全边界。完整 ConfirmationBinding 还需要 state snapshot / gate result / TTL / behavior history，不在本 checkpoint 内伪装完成。
- 2026-06-19 — 补通用取消/拒绝的 terminal behavior history。完整 ConfirmationBinding 仍缺 rebased state snapshot / gate result；TTL、replay 和跨作品/历史会话矩阵仍未闭环。
- 2026-06-19 — 补采纳确认 confirm/reject 的 terminal behavior history。完整 ConfirmationBinding 仍缺 rebased state snapshot / gate result；TTL、replay、跨作品/历史会话和真实 UI action matrix 仍未闭环。
- 2026-06-19 — AU-04 高风险执行确认主链登记为 quality scenario：`au04-confirm-before-execute` 证明真实工作台收到确认卡、确认前无工具/无写入、确认 action 绑定 open behavior、确认后重新 gate 并生成待采纳正文草稿；重复点击、TTL、stale/cross-work 和完整 ConfirmationBinding 仍是后续 action matrix。
- 2026-06-20 — 补 ConfirmationBinding re-gate refs 局部强契约。`rebased_state_snapshot_ref` / `gate_result_refs` 现在是 domain 必填字段，`DialogueGateway` 确认 ack 和 `ExecutionOrchestrator.reason_codes` 均留下 proof；这只关闭 B6 的局部测试缺口，不替代真实页面 context-change、持久 snapshot 或 replay 验收。
- 2026-06-20 — 补 AU-04 重复确认真实页面验收：`au04-confirm-idempotency-ui` 通过真实工作台快速双击“确认执行”，证明第二个 confirm 被 `duplicate=true` 处理且只产生 1 次 `prose_writing` / 1 份 pending artifact；这关闭 B4 用户场景，不替代 stale/cross-work 或持久 ConfirmationBinding snapshot。
- 2026-06-20 — 补 AU-04 当前-turn stale confirmation 真实页面验收：`WorkspaceChannel.source_turn_result/3` 对 `confirm_before_execute` / `reject_or_cancel_confirmation` / `cancel_pending_behavior` 改为以当前 turn 重新校验；`au04-stale-confirmation-ui` 通过真实工作台在确认卡后发送 follow-up，再点击旧确认，证明旧 confirm 被 `stale action: source_turn_ref turn_3 != current turn_13` 拒绝，且 stale 后无 `prose_writing` / 无 pending `prose_fragment`。这关闭 B5 的当前-turn stale 主路径；expired confirmation 已由 `au04-confirmation-ttl-ui` 补齐，history-readonly confirmation 已由 `au04-history-confirmation-readonly` 补齐，仍不替代跨作品或持久 ConfirmationBinding snapshot。
- 2026-06-20 — 补 AU-04 expired confirmation 真实页面验收：`ExecutionOrchestrator` 为 confirmation / clarification `available_actions` 生成 `expires_at`，`ActionValidator` 在服务端消费该字段并拒绝过期 action；`au04-confirmation-ttl-ui` 通过测试数据库恢复 expired confirmation，再在真实工作台点击“确认执行”，证明 Channel 返回 `expired action`，且 expired 后无 `prose_writing` / 无 pending `prose_fragment`。这关闭 B5/GAP-06 的 expired 子矩阵；history-readonly confirmation 已由 `au04-history-confirmation-readonly` 补齐，仍不替代 cross-work 或持久 ConfirmationBinding snapshot。
- 2026-06-20 — 补 AU-04 history-readonly confirmation 真实页面验收：`au04-history-confirmation-readonly` 通过测试数据库恢复 EXITED 历史 session 中未过期的 confirmation TurnResult，再从真实工作台打开历史只读 transcript，证明确认/拒绝动作不渲染、输入/发送禁用，且 `author_action_sent_count=0`、`toolbox_execute_after_history_open_count=0`、`pending_prose_fragment_after_history_open_count=0`。这关闭 B5/GAP-06 的历史只读子矩阵，不替代 cross-work 或持久 ConfirmationBinding snapshot。
- 2026-06-20 — 补 AU-04 cross-work confirmation 真实页面验收：`au04-cross-work-confirmation-guard` 通过测试数据库恢复源作品 active confirmation 和目标作品 active transcript，外部 driver 从真实作品菜单切换，证明源作品确认文案和确认/拒绝动作在目标作品不可见，`author_action_sent_count=0`、`toolbox_execute_after_cross_work_switch_count=0`、`pending_prose_fragment_after_cross_work_switch_count=0`，切回源作品后确认卡恢复。这关闭 B5/GAP-06 的跨作品可见性/执行子矩阵，不替代持久 ConfirmationBinding snapshot、latest-context rebase 或 replay。
- 2026-06-20 — 开工 AU-04 latest-context rebase checkpoint：`au04-latest-context-rebase-confirmation` 必须复用真实作品重命名入口制造确认前上下文变化，确认后 `ConfirmationBinding.rebased_state_snapshot_ref` / `gate_result_refs` 和后续 trace 必须指向确认时重新组装的最新 Work snapshot，而不是 source turn 创建时的旧 title/revision。Contract：AU-04 B6、`ConfirmationBinding` refs、Work revision snapshot。Invariant：确认后重新 gate 必须消费当前 app state。Boundary：真实 Tauri UI / Work API / Channel / Application / Persistence context fetcher；不改 provider/runtime 和生产验收 hook。Consumer：`author_action.confirm_before_execute` action_result 与 confirmed turn_result。Proof：application/Channel tests、`bash scripts/tauri_slice_verify.sh au04-latest-context-rebase-confirmation`、quality/task_done/static scan。
- 2026-06-20 — 补 AU-04 latest-context rebase 真实页面验收：`DialogueGateway` 在 confirmation dispatch 前重新经 `ContextAssembler` 组装当前 Work/session context，并用同一 context 生成 `ConfirmationBinding.rebased_state_snapshot_ref` 与执行 trace；`au04-latest-context-rebase-confirmation` 从真实工作台恢复 confirmation，先通过作品菜单重命名当前 Work，再点击“确认执行”，证明 binding ref 包含最新 `revision:2`、trace current_work summary 包含改名标题、确认后只产生 pending `character_seed`。这关闭 B6 的 latest-context rebase 主路径，不替代持久 ConfirmationBinding snapshot、replay 或失败恢复。
- 2026-06-20 — 补 AU-04 disabled confirmation action 真实页面验收：`au04-disabled-confirmation-action-ui` 通过测试数据库恢复一个 `confirm_before_execute` 为 `enabled=false` 的真实 TurnResult；外部 driver 在真实 Tauri 工作台验证“确认执行”按钮可见但 disabled，disabled reason 通过按钮 title 暴露，“拒绝”仍可用，尝试点击 disabled confirm 被浏览器阻止，且 `author_action_sent_count=0`、`channel_author_action_log_count=0`、`toolbox_execute_after_disabled_attempt_count=0`、`pending_prose_fragment_after_disabled_attempt_count=0`。这关闭 B1/GAP-02 的 disabled 子矩阵，不替代 replay、持久 ConfirmationBinding snapshot 或失败恢复。

## 7. 试行反馈

- AU-04 和 AU-06 的 action binding、幂等、ConfirmationBinding 容易混在一起。后续应把“payload 精确匹配”“重复动作去重”“确认后重新 gate 的状态快照”分成三个可验证层次，避免用一个单测替代完整 lifecycle。
