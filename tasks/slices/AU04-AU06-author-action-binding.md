# AU04/AU06 Author Action Binding

- 状态：doing（AU-04 高风险确认主链、重复确认幂等、当前-turn stale confirmation checkpoint closed；ConfirmationBinding re-gate refs 局部闭环；完整 action matrix 继续）
- 类型：Behavior Slice / UI Contract Slice / Acceptance Slice
- 启动日期：2026-06-19
- 来源：`docs/design/acceptance/author/AU-04-execute-and-confirm.md` SC-AU04-A1/B2/B3/B4/B5/D2、`docs/design/acceptance/author/AU-06-behavior-lifecycle.md` SC-AU06-B1/B2/B5/C1/C5。

## 1. 用户 / 系统目标

作者点击确认、取消或采纳类 action 时，系统必须确认这个动作就是服务端当前 TurnResult 暴露的 action，而不是前端、旧会话或恶意客户端发明/篡改的动作。`behavior_ref`、`target_ref`、`candidate_*` 和 `idempotency_key` 都属于 action 绑定的一部分。作者取消、拒绝或确认 waiting behavior 后，结果必须关闭具体 behavior，进入 `behavior_state.history`，且按 action 类型维持 no-write 或 adoption boundary 语义。

## 2. 开工检查

- Contract: `AuthorActionInput`、`AvailableAction`、AU-04 §A1/B2/B4/B5/B6/D2、AU-06 §B1/B5/C5、`docs/design/contracts/VS-03-behavior-lifecycle-contract-pack.md`、`docs/design/adr/ADR-0009-confirmation-binding-v3.md`。
- Invariant: UI 只能提交服务端 action；高风险执行确认前不得 tool dispatch 或 production write；确认/取消必须绑定 open behavior；确认后必须重新 gate，并留下 `rebased_state_snapshot_ref` / `gate_result_refs` proof；取消/拒绝必须关闭具体 behavior 且 no-write；同一 `idempotency_key` 不重复执行；当前 turn 已推进后旧 confirmation action 不能继续执行。
- Boundary: 已修改过 `novel_domain` behavior snapshot / ConfirmationBinding contract、`novel_application` action validation / cancel TurnResult / confirmation re-gate proof、`novel_web` Channel contract tests 与当前-turn stale guard；`novel_persistence` 只做 TurnResult Ecto mirror 与 JSON SSOT 同步的验证卫生修复；本次不修改 provider、production UI 自动化逻辑或验收 hook。
- Consumer: `DialogueGateway.handle_action/3`、`ExecutionOrchestrator.decide/3`、`WorkspaceChannel.handle_in("author_action")`，以及真实工作台通过 `WorkspaceChat` / `socket.ts` 提交的 author action。
- Proof: `mix test apps/novel_domain/test/novel_domain/confirmation_binding_test.exs apps/novel_application/test/novel_application/execution_authority_test.exs apps/novel_application/test/novel_application/action_roundtrip_test.exs apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs apps/novel_web/test/novel_web/channels/workspace_channel_action_idempotency_test.exs`、`pnpm --dir frontend test -- --run frontend/slice-verify/native-tauri-verifier.test.mjs`、`bash scripts/tauri_slice_verify.sh au04-confirm-before-execute`、`bash scripts/tauri_slice_verify.sh au04-confirm-idempotency-ui`、`bash scripts/tauri_slice_verify.sh au04-stale-confirmation-ui`、`bash scripts/quality_accept.sh au04-confirm-before-execute --surface tauri`、`bash scripts/quality_accept.sh au04-confirm-idempotency-ui --surface tauri`、`bash scripts/quality_accept.sh au04-stale-confirmation-ui --surface tauri`。
- Acceptance Driver: `bash scripts/tauri_slice_verify.sh au04-confirm-before-execute` 从真实工作台输入高风险重写请求，等待 `needs_confirmation`，点击“确认执行”，验证 `author_action`、re-gate、`prose_writing` 和 pending artifact；`bash scripts/tauri_slice_verify.sh au04-confirm-idempotency-ui` 在同一真实确认卡上快速点击两次，验证重复确认只产生 1 次非 duplicate receipt、1 次工具 dispatch 和 1 份 pending artifact；`bash scripts/tauri_slice_verify.sh au04-stale-confirmation-ui` 在确认卡出现后先发送普通 follow-up 推进当前 turn，再点击旧确认，验证 Channel 以 stale 拒绝且 no-tool/no-draft。产品代码未新增验收感知逻辑。

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
| quality | yes | 新增 `quality/acceptance/scenarios/au04-confirm-before-execute.yml`、`quality/acceptance/scenarios/au04-confirm-idempotency-ui.yml`、`quality/acceptance/scenarios/au04-stale-confirmation-ui.yml` 并登记总表 |

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
| T10 | 完整外部 UI action matrix 验收 | todo | `au10-workbench-recovery-cancel-waiting` 已覆盖取消等待主路径；仍需覆盖 disabled、TTL、采纳确认 terminal history 的真实 UI 细节和跨作品/历史会话 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh au10-workbench-recovery-cancel-waiting`
- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh au04-confirm-before-execute`
- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh au04-confirm-idempotency-ui`
- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh au04-stale-confirmation-ui`
- [x] 质量验收入口：`bash scripts/quality_accept.sh au04-confirm-before-execute --surface tauri`
- [x] 质量验收入口：`bash scripts/quality_accept.sh au04-confirm-idempotency-ui --surface tauri`
- [x] 质量验收入口：`bash scripts/quality_accept.sh au04-stale-confirmation-ui --surface tauri`
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
- [x] `bash scripts/ai_static_scan.sh --top 10`（17 pass / 1 accepted_risk gitleaks，0 touched-file finding，blocking=0）

## 6. 决策日志

- 2026-06-19 — 先补 action binding 的最小安全边界。完整 ConfirmationBinding 还需要 state snapshot / gate result / TTL / behavior history，不在本 checkpoint 内伪装完成。
- 2026-06-19 — 补通用取消/拒绝的 terminal behavior history。完整 ConfirmationBinding 仍缺 rebased state snapshot / gate result；TTL、replay 和跨作品/历史会话矩阵仍未闭环。
- 2026-06-19 — 补采纳确认 confirm/reject 的 terminal behavior history。完整 ConfirmationBinding 仍缺 rebased state snapshot / gate result；TTL、replay、跨作品/历史会话和真实 UI action matrix 仍未闭环。
- 2026-06-19 — AU-04 高风险执行确认主链登记为 quality scenario：`au04-confirm-before-execute` 证明真实工作台收到确认卡、确认前无工具/无写入、确认 action 绑定 open behavior、确认后重新 gate 并生成待采纳正文草稿；重复点击、TTL、stale/cross-work 和完整 ConfirmationBinding 仍是后续 action matrix。
- 2026-06-20 — 补 ConfirmationBinding re-gate refs 局部强契约。`rebased_state_snapshot_ref` / `gate_result_refs` 现在是 domain 必填字段，`DialogueGateway` 确认 ack 和 `ExecutionOrchestrator.reason_codes` 均留下 proof；这只关闭 B6 的局部测试缺口，不替代真实页面 context-change、TTL、持久 snapshot 或 replay 验收。
- 2026-06-20 — 补 AU-04 重复确认真实页面验收：`au04-confirm-idempotency-ui` 通过真实工作台快速双击“确认执行”，证明第二个 confirm 被 `duplicate=true` 处理且只产生 1 次 `prose_writing` / 1 份 pending artifact；这关闭 B4 用户场景，不替代 TTL、stale/cross-work、历史会话只读态或持久 ConfirmationBinding snapshot。
- 2026-06-20 — 补 AU-04 当前-turn stale confirmation 真实页面验收：`WorkspaceChannel.source_turn_result/3` 对 `confirm_before_execute` / `reject_or_cancel_confirmation` / `cancel_pending_behavior` 改为以当前 turn 重新校验；`au04-stale-confirmation-ui` 通过真实工作台在确认卡后发送 follow-up，再点击旧确认，证明旧 confirm 被 `stale action: source_turn_ref turn_3 != current turn_13` 拒绝，且 stale 后无 `prose_writing` / 无 pending `prose_fragment`。这关闭 B5 的当前-turn stale 主路径，不替代 TTL、跨作品、历史只读态或持久 ConfirmationBinding snapshot。

## 7. 试行反馈

- AU-04 和 AU-06 的 action binding、幂等、ConfirmationBinding 容易混在一起。后续应把“payload 精确匹配”“重复动作去重”“确认后重新 gate 的状态快照”分成三个可验证层次，避免用一个单测替代完整 lifecycle。
