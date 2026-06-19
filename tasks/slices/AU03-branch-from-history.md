# AU03 Branch From History / 从历史会话继续

- 状态：done（checkpoint closed）
- 类型：Acceptance Slice / UI Contract Slice / Persistence Slice
- 启动日期：2026-06-19

## 1. 用户 / 系统目标

作者打开历史只读会话后，可以选择“从这里继续”。系统必须创建一个新的当前 active session，并记录它引用的历史 `source_session_ref` / `source_turn_ref`；旧历史会话仍保持只读，历史 transcript 不被篡改，也不能被复制成新会话的初始 transcript。

## 2. 开工检查

- Contract: `docs/design/acceptance/author/AU-03-context.md` 的 `SC-AU03-C6`；`WorkSessionService.create/2`；`WorkSessionsController.create/2`；前端 `createWorkSession` 的 `source_session_ref` / `source_turn_ref` 输入。
- Invariant: 历史 session 是 read-only；从历史继续必须创建新的 active session；新 session 记录历史来源；旧 transcript 不被修改或复制；同一 work 仍只有一个 active session。
- Boundary: 只补外部 Tauri driver、shell/quality 注册、验收文档和 task 记录；不改 production `WorkspaceChat`、sessions API、provider/runtime 或上下文组装主链。
- Consumer: 真实工作台历史会话只读 banner 的“从这里继续”按钮；`scripts/tauri_slice_verify.sh au03-branch-from-history`。
- Proof: 真实 Tauri 工作台搜索并打开历史会话，点击“从这里继续”，验证 `work_session.create.done` 携带 `source_session_ref` / `source_turn_ref`，新 session rejoin 且 transcript 为空，旧历史正文没有出现在新 session 中。
- Acceptance Driver: `frontend/slice-verify/external-ui-driver.mjs` 外部驱动真实页面；产品代码不读取 slice id、不加 `data-testid`/隐藏 metadata、不自动输入或上报验收状态。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改基础类型。 |
| novel_domain | no | 不改领域模型。 |
| novel_agent | no | 不改 provider/runtime。 |
| novel_application | no | 复用现有 `WorkSessionService.create/2`。 |
| novel_persistence | no | 复用现有 session/source refs 持久化。 |
| novel_web | no | 复用现有 sessions API 和业务日志。 |
| frontend | yes | 只改外部 slice verifier，不改 production React。 |
| docs/design | yes | 回填 AU-03 C6 覆盖状态。 |
| quality | yes | 新增场景 manifest 和 quality index。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 接入 AU-03 从历史继续外部 driver | done | 从真实历史只读 banner 点击“从这里继续”。 |
| T2 | 注册 tauri_slice_verify 与 seed | done | 复用 `seed_au03_session_history_readonly.exs`。 |
| T3 | 新增 quality manifest 与索引 | done | 记录 anti-hook 边界和证据目录。 |
| T4 | 回填 AU-03、总蓝图、验收 README 与台账 | done | 标为 SC-AU03-C6 最小 checkpoint，不冒充完整 AU-03。 |
| T5 | 跑验证门禁 | done | Tauri、quality acceptance、verifier 单测、task_done 和 static scan 已闭环。 |

## 5. 验证

- [x] `node --check frontend/slice-verify/external-ui-driver.mjs`
- [x] `pnpm --dir frontend test -- native-tauri-verifier.test.mjs`
- [x] `bash scripts/tauri_slice_verify.sh au03-branch-from-history`
- [x] `bash scripts/quality_accept.sh au03-branch-from-history --surface tauri`
- [x] `bash scripts/task_done.sh --slice au03-branch-from-history --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-19 — 不修改 production 分支逻辑。当前产品入口已经通过 `handleBranchFromReadOnlySession` 调用 `createWorkSession` 并传入历史来源。本 checkpoint 只补真实页面外部验收，证明该能力已通过当前 shell/quality 入口可复跑。
- 2026-06-19 — 真实 Tauri 与 quality acceptance 已通过。证据：`artifacts/slice-verify/au03-branch-from-history-tauri/summary.json`。summary 记录 `source_turn_ref=turn_history_1`，并断言 `branch_session_records_source_session_ref` / `branch_session_records_source_turn_ref` / `old_history_transcript_not_copied_into_branch`。
- 2026-06-19 — task_done manifest 由最新 `bash scripts/task_done.sh --slice au03-branch-from-history --skip-static-scan` 生成。静态扫描剩历史 `tools/company-console/server/config.mjs` generic-api-key accepted_risk，0 个 finding 在本次 touched files。

## 7. 试行反馈

- 该 checkpoint 只关闭 `SC-AU03-C6` 的最小真实页面闭环。AU-03 仍缺搜索命中 turn 定位/高亮、归档过滤当前入口复跑、显式引用 archived source、最新作品背景 SSOT 和完整 replay 页面。
