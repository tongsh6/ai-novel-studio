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

## 3. 新增 checkpoint

| Checkpoint | 结果 | 证据 |
|---|---|---|
| `au06-single-active-confirmation` | done | `artifacts/slice-verify/au06-single-active-confirmation-tauri/summary.json` |

该 checkpoint 证明：第一条高风险请求打开 confirmation 后，作者又输入第二条高风险请求，第二条成为新的当前 active confirmation；旧 confirmation 若仍可见也会被 stale 拒绝，且不会 dispatch `prose_writing` 或创建 pending draft；最新 confirmation 仍能执行一次并创建单一 pending `prose_fragment`。

## 4. 文件级验证

- [x] `bash scripts/tauri_slice_verify.sh au06-single-active-confirmation`
- [x] `bash scripts/quality_accept.sh au06-single-active-confirmation --surface tauri`
- [x] `pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/task_done.sh --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`（剩余 Top 10 为历史 `accepted_risk`，本次 touched files 0，blocking 0）

## 5. 后续 owner

| 缺口 | Owner | 恢复路径 |
|---|---|---|
| Blocking clarification 主链 | AU-11 / AU-06 后续 | 先补真实 product producer，再接 `answer_clarification` resolution |
| Confirm 成功后的 terminal behavior history | AU-07 / BehaviorTrace | 在 replay/trace 文件中定义作者视图与 developer 视图 |
| Behavior lifecycle replay 不调 LLM | AU-07 | 从 current trace/reason_codes 扩展到 BehaviorTrace 聚合 |
| 独立 persistent BehaviorBinding ledger | AU-07 / persistence follow-up | 不能替代当前 live action safety；作为 replay/diagnosis 增强 |

## 6. 决策日志

- 2026-06-21 — AU-06 不再沿用 2026-05-13 “0/17 完整验收”的旧口径。当前真实 Tauri evidence 已覆盖 high-risk confirmation、确认卡内容、确认绑定/re-gate、cancel、stale、TTL、disabled、history readonly、cross-work、idempotency、latest-context rebase、tool failure 和 single-active runtime safety。
- 2026-06-21 — 新增 `au06-single-active-confirmation` 只改外部 harness/quality manifest，不改 production UI/backend。它把“单一活跃 author-blocking behavior”从 AU-04 stale evidence 的推断升级为 AU-06 直接证据。
- 2026-06-21 — Clarification 与 replay 保留 P1，不在 AU-06 文件级收口中伪装完成；它们分别交给 AU-11/AU-06 后续和 AU-07 文件。
