# AU01 TurnResult Recorder UI Consistency

- 状态：done（checkpoint closed）
- 类型：Acceptance Slice / UI Contract Slice
- 启动日期：2026-06-20

## 1. 用户 / 系统目标

作者在真实工作台看到的 AI 回复，必须和本轮 websocket `turn_result`、interaction recorder 写入的 transcript、重启/刷新后恢复出来的 UI 文本是同一个 canonical 输出。不能出现“UI 显示一套、系统记录另一套”的分裂。

## 2. 开工检查

- Contract: `docs/design/acceptance/author/AU-01-chat.md` 的 `SC-AU01-B4`；`TurnResult.assistant_message.text`；`DialogueGateway` interaction recorder；`WorkSessionService.show/2` / `resume/1` transcript DTO；`quality/acceptance/scenarios/au01-turnresult-recorder-ui-consistency.yml`。
- Invariant: AU01-I2 `TurnResult` 是前端消费的 canonical 输出；assistant interaction row 的 `content.text` 与 `content.turn_result.assistant_message.text` 必须等于作者看到的 assistant 文本；active session 恢复不重新生成或改写该文本。
- Boundary: 切穿真实 Tauri workbench → Channel → `DialogueGateway` → interaction recorder → persistence → `WorkSessionsController` → 前端启动恢复。明确不改 `novel_domain`、不改 provider/runtime、不新增生产验收 hook。
- Consumer: 真实工作台当前消息列表、启动恢复后的消息列表、会话 transcript API。
- Proof: 外部 driver 从真实输入框发普通聊天，按同一 `turn_id` 对账 websocket `turn_result`、active session transcript assistant row、reload 后 UI；局部补 verifier 单测；运行 Tauri slice、quality acceptance、task_done 和 static scan。
- Acceptance Driver: `scripts/tauri_slice_verify.sh au01-turnresult-recorder-ui-consistency` 驱动真实 Tauri 页面；产品代码不读取 slice id、不加 `data-testid`/隐藏 metadata、不自动输入或上报验收状态。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改基础类型。 |
| novel_domain | no | 不改领域规则。 |
| novel_agent | no | 不改 provider/runtime；使用既有 slice_verify provider。 |
| novel_application | no | 仅消费既有 `DialogueGateway` recorder 行为。 |
| novel_persistence | no | 仅通过既有 transcript repo/API 读取证据。 |
| novel_web | no | 仅通过既有 `WorkSessionsController` 获取 session snapshot。 |
| frontend | yes | 只改外部 slice verifier，不改 production React。 |
| docs/design | yes | 验收文档、蓝图、README 和台账收口时更新。 |
| quality | yes | 新增 quality manifest 与索引。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 新增 AU-01 B4 外部 Tauri driver | done | 发送普通聊天，读取 active session snapshot，reload 后验证恢复 UI。 |
| T2 | 扩展 native verifier 与单测 | done | 缺 transcript/show/resume 证据则拒绝通过。 |
| T3 | 新增 quality manifest 与索引 | done | `au01-turnresult-recorder-ui-consistency.yml`。 |
| T4 | 同步 AU-01、蓝图、README、ledger | done | 只关闭 B4，不冒充完整 AU-01。 |
| T5 | 跑真实 Tauri / quality acceptance / task_done / static scan | done | 真实 Tauri 与 quality acceptance 已通过；统一扫描闭环按本轮最终报告处理。 |

## 5. 验证

- [x] `pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/tauri_slice_verify.sh --list`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/tauri_slice_verify.sh au01-turnresult-recorder-ui-consistency`
- [x] `bash scripts/quality_accept.sh au01-turnresult-recorder-ui-consistency --surface tauri`
- [x] `pnpm --dir frontend typecheck`
- [x] `pnpm --dir frontend lint`
- [x] `pnpm --dir frontend test`
- [x] `bash scripts/check_design_trace.sh`
- [x] `bash scripts/frontend_audit.sh`
- [x] `mix compile --warnings-as-errors`
- [x] `mix run scripts/arch_check.exs`
- [x] `mix xref graph --format cycles --label compile-connected --fail-above 0`
- [x] `bash scripts/task_done.sh --slice au01-turnresult-recorder-ui-consistency --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-20 — B4 审计显示生产主链已有 recorder 与 session restore 边界：`DialogueGateway` 将 assistant row 的 `turn_result` 作为 JSON-safe map 写入 interaction，`WorkSessionService.show/resume` 从 transcript 返回该 `turn_result`，`WorkspaceChat` 用 transcript 还原消息。当前 checkpoint 不先改生产代码，只补真实页面同一 turn 对账；若 Tauri 验收暴露分裂，再最小修复生产链路。
- 2026-06-20 — 真实 Tauri 与 quality acceptance 已通过：`artifacts/slice-verify/au01-turnresult-recorder-ui-consistency-tauri/summary.json` 记录 `current_ui_assistant_visible=true`、`transcript_assistant_text_matches_ui=true`、`transcript_turn_result_assistant_text_matches_websocket=true`、`restored_ui_assistant_visible=true`、`transcript_count=14`、`reload_resume_transcript_count=14`。AU-01 当前重算为 11/13 有真实页面外部自动化证据，文件级可进入 AU-02；剩余 P1 为 D1 trace/replay UI cross-reference（owner：AU-07），P2 为 C3 no-slot-form UI 反证。
- 2026-06-20 — `task_done` 与 `bash scripts/ai_static_scan.sh --top 10` 已纳入本 checkpoint 收口。统一扫描剩余 Top10 为历史 `tools/company-console/server/config.mjs:4` gitleaks `generic-api-key`，处置为 `accepted_risk`，touched files 0、blocking 0。

## 7. 试行反馈

- B4 不需要新增生产 UI 或产品验收 hook；用既有 session snapshot API 与 reload 恢复路径即可证明 recorder 和 UI 同源。后续 D1 应在 AU-07 owner 中补 trace/replay 作者视图，不在 AU-01 中重复造入口。
