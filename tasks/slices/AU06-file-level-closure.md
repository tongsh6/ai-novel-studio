# AU06 File-Level Closure

- 状态：file-level deliverable（P0 runtime safety closed；P1 follow-up registered）
- 类型：Acceptance / Behavior Lifecycle / Tauri Slice
- 启动日期：2026-06-21
- 来源：`docs/design/acceptance/author/AU-06-behavior-lifecycle.md`、`docs/design/acceptance/SCENARIO-BLUEPRINT.md`、`tasks/slices/AU04-AU06-author-action-binding.md`

## 1. 开工检查

- Contract: VS-03 Behavior Lifecycle、ADR-0007 AvailableAction、ADR-0008 BehaviorState、ADR-0009 ConfirmationBinding、`AuthorActionInput`、`behavior_state.active/history`、`available_action.expires_at`、`idempotency_key`。
- Invariant: awaiting_author 必须有 active behavior 和服务端 action；UI 只能提交服务端 action；确认前 no-tool/no-write；确认后重新 gate；取消关闭具体 behavior；旧/过期/禁用/跨作品/历史/重复 action 不能执行；同一 workstream 当前只允许一个可执行 primary author-blocking behavior。
- Boundary: 本文件级收口只补外部验收 driver、quality manifest、文档/台账；不修改生产 `frontend/src`、后端 runtime、provider 注册或验收感知逻辑。
- Consumer: `WorkspaceChat` 真实页面、`WorkspaceChannel.handle_in("author_action")`、`DialogueGateway.handle_action/3`、`ExecutionOrchestrator.decide/3`、`ActionValidator`。
- Proof: `bash scripts/quality_accept.sh au06-single-active-confirmation --surface tauri`、既有 AU04/AU10 Tauri evidence、`pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`、`quality_manifest_check.sh`、`task_done.sh`、`ai_static_scan.sh --top 10`。
- Acceptance Driver: `bash scripts/tauri_slice_verify.sh au06-single-active-confirmation` 从真实 Tauri 工作台连续输入两个高风险请求，验证旧 confirmation hidden/disabled/stale 且 no-tool/no-draft，最新 confirmation 仍能执行一次。产品代码未新增验收感知逻辑。

## 2. 文件级对账结论

| 项目 | 结论 |
|---|---|
| 场景总数 | 17 |
| 已验收 | 13 |
| 部分实现 | 4 |
| P0 | 已关闭 |
| P1 | blocking clarification、confirm terminal history / BehaviorTrace replay、持久 BehaviorBinding ledger |
| 是否可进入下一文件 | 是，可进入 AU-07 |

## 3. 二轮剩余缺口矩阵（2026-06-22）

本轮按当前 checkout 复跑 12 个 AU-06 关联真实 Tauri / quality 入口：`au04-confirm-before-execute`、`au04-confirmation-tool-failure-recovery`、`au04-confirm-idempotency-ui`、`au04-stale-confirmation-ui`、`au06-single-active-confirmation`、`au04-confirmation-ttl-ui`、`au04-disabled-confirmation-action-ui`、`au04-history-confirmation-readonly`、`au04-cross-work-confirmation-guard`、`au04-latest-context-rebase-confirmation`、`au10-workbench-recovery-cancel-waiting`、`au07-behavior-trace-terminal-replay`。全部通过，未发现 AU-06 文件内必须关闭的新 P1/P0。

| 场景 ID / 名称 | 第一轮状态 | 剩余缺口描述 | 缺口类型 | 优先级 | 当前证据 | 需要补的实现或验收 driver | 是否应在 AU-06 内关闭 | 建议 checkpoint / slice | 是否满足继续到 AU-07 的二轮退出标准 |
|---|---|---|---|---|---|---|---|---|---|
| SC-AU06-A1 高风险操作打开 confirmation behavior | 已验收 | 无新增缺口 | 已闭环 | P0 closed | `artifacts/slice-verify/au04-confirm-before-execute-tauri/summary.json` | 保持回归 | 否 | `AU04-AU06-author-action-binding.md` | 是 |
| SC-AU06-A2 缺关键补充信息时打开 clarification behavior | 部分实现 | 当前产品没有稳定 blocking clarification producer；不能把自然探索/no-slot-form 当作 clarification 验收 | 补实现/补验收 | P1 | contract/enum 局部存在；无真实页面 driver | 先补真实 product producer，再接 `answer_clarification` resolution driver | 否，owner 跨 AU-11/AU-06 | AU-11 / AU-06 clarification checkpoint | 是，登记 P1 owner 后可退出 |
| SC-AU06-A3 普通创作讨论不打开 waiting behavior | 已验收 | 无新增缺口 | 已闭环 | P0 closed | `au01-ordinary-chat-two-turn-roundtrip`；real LM Studio 变体 | 保持回归 | 否 | AU-01 evidence | 是 |
| SC-AU06-A4 真实工作台能识别 active behavior | 已验收 | confirmation/cancel active UI 已闭；clarification UI 矩阵仍缺 producer | 补验收 | P1 | `au04-confirm-before-execute`、`au10-workbench-recovery-cancel-waiting` | 等 clarification producer 存在后补真实页面 driver | 否 | clarification 后续 | 是 |
| SC-AU06-B1 点击确认绑定 open confirmation | 已验收 | 持久 ConfirmationBinding snapshot / replay 解释未完整 | 补集成/补验收 | P1 | `au04-confirm-before-execute`、`au04-latest-context-rebase-confirmation` | 补旧 turn/replay 查询时展示 binding snapshot | 否 | AU-07 replay owner | 是 |
| SC-AU06-B2 点击取消/拒绝关闭 behavior | 已验收 | 完整 behavior replay UI / developer view 仍缺 | 补验收 | P1 | `au10-workbench-recovery-cancel-waiting`、`au07-behavior-trace-terminal-replay`、`au07-persisted-trace-query`、`au07-partial-replay-ui` | 普通旧 turn query 与 partial 作者提示已闭合；补完整 behavior replay 与 developer 双视图 | 否 | AU-07 trace/replay | 是 |
| SC-AU06-B3 回答澄清后重新评估 | 部分实现 | `answer_clarification` 没有稳定后端主链和真实页面 evidence | 补实现/补集成/补验收 | P1 | action 文案/枚举局部存在；无真实页面 driver | 补 clarification resolution 主链与外部 driver | 否，owner 跨 AU-11/AU-06 | AU-11 / AU-06 clarification checkpoint | 是，登记 P1 owner 后可退出 |
| SC-AU06-B4 等待期间继续聊天不误执行 | 已验收 | 无新增缺口；当前策略是 current turn 推进后旧确认 stale/supersede | 已闭环/文档同步 | P0 closed | `au04-stale-confirmation-ui` | 保持回归 | 否 | `AU04-AU06-author-action-binding.md` | 是 |
| SC-AU06-B5 旧/伪造/禁用按钮被拒绝 | 已验收 | invented action 属 adversarial non-UI boundary，真实 UI 不会生成伪造按钮 | 补测试/补验收 | P2 | `au04-stale-confirmation-ui`、`au04-confirmation-ttl-ui`、`au04-disabled-confirmation-action-ui`、`au04-history-confirmation-readonly`、`au04-cross-work-confirmation-guard`；局部 invented action tests | 保持局部安全测试；如补 security fuzz，走 Channel negative driver | 否 | 后续安全回归 | 是 |
| SC-AU06-C1 open 到 resolved/cancelled 进入 history | 部分实现 | cancel terminal history 与 terminal BehaviorTrace 已补；confirm 成功路径 terminal history/replay 未闭环 | 补集成/补验收 | P1 | `au10-workbench-recovery-cancel-waiting`、`au07-behavior-trace-terminal-replay` | 补 confirm terminal history / replay evidence | 否 | AU-07 behavior replay checkpoint | 是，cancel terminal 已有 cross evidence |
| SC-AU06-C2 确认后重新 gate，不直接执行 | 已验收 | 持久 replay 解释仍缺 | 补验收 | P1 | `au04-latest-context-rebase-confirmation` | 补 replay view 对 re-gate refs 的解释 | 否 | AU-07 replay owner | 是 |
| SC-AU06-C3 同一 workstream 只有一个 primary author-blocking behavior | 已验收 | 独立 persistent open behavior ledger 未建模；live safety 已闭 | 补集成 | P1 | `au06-single-active-confirmation` | 持久 ledger 与 replay/diagnosis 联动时补 | 否 | 持久 ledger / replay follow-up | 是 |
| SC-AU06-C4 TTL / expires_at 控制过期等待 | 已验收 | 无新增缺口 | 已闭环 | P0 closed | `au04-confirmation-ttl-ui` | 保持回归 | 否 | `AU04-AU06-author-action-binding.md` | 是 |
| SC-AU06-C5 重复动作幂等 | 已验收 | behavior resolution ledger 与 replay 仍未完整 | 补验收 | P1 | `au04-confirm-idempotency-ui`、Channel idempotency regression | 补 replay/diagnosis 对 duplicate receipt 的解释 | 否 | AU-07 replay owner | 是 |
| SC-AU06-D1 行为生命周期可回放且不调 LLM | 部分实现 | cancel terminal replay producer 已补；普通旧 turn query 与 partial 作者提示已闭合；confirm terminal replay、完整 BehaviorTrace replay 和 developer 双视图仍缺 | 补集成/补验收 | P1 | `au07-behavior-trace-terminal-replay`、`au07-persisted-trace-query`、`au07-partial-replay-ui` | 补完整 BehaviorTrace replay 和 developer view | 否 | AU-07 文件 owner | 是，已有 AU-07 cross evidence 支撑退出 |
| SC-AU06-D2 跨作品/跨会话 action 不能关闭当前 behavior | 已验收 | 持久 BehaviorBinding ledger 未独立建模 | 补集成 | P1 | `au04-history-confirmation-readonly`、`au04-cross-work-confirmation-guard` | 持久 ledger / replay 需要保留 work/session/source refs | 否 | AU-07 / persistence follow-up | 是 |
| SC-AU06-D3 前端不能本地修改 lifecycle | 已验收 | 无新增缺口；本轮未新增生产验收 hook | 已闭环 | P0 closed | 多个 `author_action` Tauri driver 均通过 websocket action_result / turn_result 回流 | 保持 scenario acceptance 红线 | 否 | 保持回归 | 是 |

二轮退出判断：AU-06 当前没有应在本文件内立即关闭的 P1/P0；blocking clarification、confirm terminal replay、持久 BehaviorBinding ledger 均已登记 owner，不应在缺真实 producer / replay UI 前伪装为已验收。满足进入 AU-07 的二轮退出标准。

## 4. 新增 checkpoint

| Checkpoint | 结果 | 证据 |
|---|---|---|
| `au06-single-active-confirmation` | done | `artifacts/slice-verify/au06-single-active-confirmation-tauri/summary.json` |

该 checkpoint 证明：第一条高风险请求打开 confirmation 后，作者又输入第二条高风险请求，第二条成为新的当前 active confirmation；旧 confirmation 若仍可见也会被 stale 拒绝，且不会 dispatch `prose_writing` 或创建 pending draft；最新 confirmation 仍能执行一次并创建单一 pending `prose_fragment`。

## 5. 文件级验证

- [x] `bash scripts/tauri_slice_verify.sh au06-single-active-confirmation`
- [x] `bash scripts/tauri_slice_verify.sh au04-confirm-before-execute`
- [x] `bash scripts/tauri_slice_verify.sh au04-confirmation-tool-failure-recovery`
- [x] `bash scripts/tauri_slice_verify.sh au04-confirm-idempotency-ui`
- [x] `bash scripts/tauri_slice_verify.sh au04-stale-confirmation-ui`
- [x] `bash scripts/tauri_slice_verify.sh au04-confirmation-ttl-ui`
- [x] `bash scripts/tauri_slice_verify.sh au04-disabled-confirmation-action-ui`
- [x] `bash scripts/tauri_slice_verify.sh au04-history-confirmation-readonly`
- [x] `bash scripts/tauri_slice_verify.sh au04-cross-work-confirmation-guard`
- [x] `bash scripts/tauri_slice_verify.sh au04-latest-context-rebase-confirmation`
- [x] `bash scripts/tauri_slice_verify.sh au10-workbench-recovery-cancel-waiting`
- [x] `bash scripts/tauri_slice_verify.sh au07-behavior-trace-terminal-replay`
- [x] `bash scripts/quality_accept.sh au06-single-active-confirmation --surface tauri`
- [x] `pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/task_done.sh --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`（剩余 Top 10 为历史 `accepted_risk`，本次 touched files 0，blocking 0）

## 6. 后续 owner

| 缺口 | Owner | 恢复路径 |
|---|---|---|
| Blocking clarification 主链 | AU-11 / AU-06 后续 | 先补真实 product producer，再接 `answer_clarification` resolution |
| Confirm 成功后的 terminal behavior history | AU-07 / BehaviorTrace | 在 replay/trace 文件中定义作者视图与 developer 视图；cancel terminal 已有 cross evidence |
| Behavior lifecycle replay 不调 LLM | AU-07 | 从 cancel terminal BehaviorTrace 扩展到 confirm terminal replay、旧 turn 查询和 developer view |
| 独立 persistent BehaviorBinding ledger | AU-07 / persistence follow-up | 不能替代当前 live action safety；作为 replay/diagnosis 增强 |

## 7. 决策日志

- 2026-06-21 — AU-06 不再沿用 2026-05-13 “0/17 完整验收”的旧口径。当前真实 Tauri evidence 已覆盖 high-risk confirmation、确认卡内容、确认绑定/re-gate、cancel、stale、TTL、disabled、history readonly、cross-work、idempotency、latest-context rebase、tool failure 和 single-active runtime safety。
- 2026-06-21 — 新增 `au06-single-active-confirmation` 只改外部 harness/quality manifest，不改 production UI/backend。它把“单一活跃 author-blocking behavior”从 AU-04 stale evidence 的推断升级为 AU-06 直接证据。
- 2026-06-21 — Clarification 与 replay 保留 P1，不在 AU-06 文件级收口中伪装完成；它们分别交给 AU-11/AU-06 后续和 AU-07 文件。
- 2026-06-22 — 二轮复核串行复跑 12 个 AU-06 关联 Tauri / quality 入口，全部通过。`au07-behavior-trace-terminal-replay` 现在作为 AU-06 的 cross evidence，证明 cancel waiting 后 terminal BehaviorTrace close/resolution refs 可记录且 no-provider/no-tool/no-write；AU-06 本文件无新增必须实现项，可进入 AU-07。
