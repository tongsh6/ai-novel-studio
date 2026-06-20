# AU02 Candidate Multiturn Context

- 状态：done（checkpoint closed）
- 类型：Acceptance Slice / Context Slice / UI Contract Slice
- 启动日期：2026-06-20

## 1. 用户 / 系统目标

作者从探索候选方向里点“继续讨论”后，下一轮不应被当成采纳或写入；随后作者再用普通输入继续追问时，工作台必须仍能沿着刚才候选方向继续聊天，而不是丢失上下文、要求重新选择，或把候选误写入作品事实。

## 2. 开工检查

- Contract: `docs/design/acceptance/author/AU-02-explore.md` 的 `SC-AU02-C1`；`CandidateDirection`、`candidate_selection.source_turn_ref` / `candidate_selection.candidate_ref`；`TurnResult.truthfulness` 的 `candidate_selected` / `candidate_adopted` / `production_write_performed`；`context.assemble.done` 的 conversation/session summary 证据；`quality/acceptance/scenarios/au02-candidate-multiturn-context.yml`。
- Invariant: 候选“继续讨论”不是采纳；普通后续追问不得继续发送 `candidate_selection`；已选候选方向必须通过会话上下文影响后续回复；全链路不得触发 MicroPlan、`author_action`、adoption、tool result 或 production write。
- Boundary: 只改 test/support `slice_verify` provider、外部 Tauri driver、native verifier、quality manifest、验收文档和 task 记录；不修改 production provider 注册、Channel action handler、persistence、schema 或 React production 组件。
- Consumer: `WorkspaceChat` 的候选继续讨论按钮和普通输入框，以及 `scripts/tauri_slice_verify.sh au02-candidate-multiturn-context`。
- Proof: provider 单测证明 `AU02CTX` nonce 能从 source candidate 进入后续 follow-up；真实 Tauri 工作台先点击候选继续讨论，再发送无 nonce 的普通追问，`context.assemble.done` 有 conversation/session summary，assistant follow-up reply 反映 prior candidate nonce，且无 action/adoption/write。
- Acceptance Driver: `frontend/slice-verify/external-ui-driver.mjs` 外部驱动真实 Tauri 页面；产品代码不读取 slice id、不加 `data-testid`/隐藏 metadata、不自动输入或上报验收状态。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改基础类型。 |
| novel_domain | no | 不改 `CandidateDirection`。 |
| novel_agent | yes | 只改 `test/support` 的 slice verification provider，生产 provider runtime 不变。 |
| novel_application | no | 不改 ContextAssembler/Planner production 逻辑，只观察现有上下文组装。 |
| novel_persistence | no | 不改 schema/repo。 |
| novel_web | no | 不改 Channel handler。 |
| frontend | yes | 只改外部 slice verifier，不改 production React。 |
| docs/design | yes | 回填 AU-02 C1 多轮上下文证据。 |
| quality | yes | 新增场景 manifest 和 quality index。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 扩展 test/support provider 的 AU02CTX nonce 上下文回显 | done | source candidate title 带 nonce，后续普通追问只能从上下文中取回 nonce。 |
| T2 | 新增 AU-02 candidate multiturn 外部 driver | done | 真实工作台完成 source candidate、candidate continuation、plain follow-up 三回合。 |
| T3 | 扩展 native verifier 与单测 | done | 证据必须覆盖 candidate_selection、plain follow-up、context.assemble.done、no action/adoption/write。 |
| T4 | 新增 quality manifest 与索引 | done | 记录 anti-hook 边界和证据目录。 |
| T5 | 跑真实 Tauri 与 quality acceptance | done | `tauri_slice_verify` 与 `quality_accept` 均已通过；sandbox 内 Mix.PubSub `:eperm` 后使用脱 sandbox 同命令复跑。 |
| T6 | 回填 AU-02、总蓝图、验收 README 与台账 | done | 从 AU-02 剩余缺口移除多轮上下文质量。 |
| T7 | 跑 task_done 与 AI static scan | done | task_done 已更新；static scan 仅剩历史 gitleaks accepted_risk。 |

## 5. 验证

- [x] `mix test apps/novel_agent/test/novel_agent/provider/slice_verify_test.exs`
- [x] `node --check frontend/slice-verify/external-ui-driver.mjs`
- [x] `node --check frontend/slice-verify/native-tauri-verifier.mjs`
- [x] `bash -n scripts/tauri_slice_verify.sh`
- [x] `pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/tauri_slice_verify.sh au02-candidate-multiturn-context`
- [x] `bash scripts/quality_accept.sh au02-candidate-multiturn-context --surface tauri`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/task_done.sh --slice au02-candidate-multiturn-context --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-20 — 选择用外部 Tauri driver 构造三回合真实页面链路，而不是把单轮候选 continuation 证据扩大解释为多轮上下文。`AU02CTX` nonce 只存在于 test/support provider 与验收输入中，真实产品仍只消费普通会话上下文，不新增验收感知逻辑。
- 2026-06-20 — 真实 Tauri 与 quality acceptance 已通过：`artifacts/slice-verify/au02-candidate-multiturn-context-tauri/summary.json` 记录 source / continuation / follow-up 三个 `turn_id`，`continuation_candidate_selection_sent=true`、`followup_plain_user_message_sent=true`、`followup_context_has_conversation=true`、`followup_context_has_session_summary=true`、`followup_reply_contains_context_nonce=true`、`generate_micro_plan=false`、`tool_result_present=false`、`adoption_decision_present=false`、`candidate_selected=false`、`candidate_adopted=false`、`production_write_performed=false`。

## 7. 试行反馈

- 本 checkpoint 关闭 AU-02 的多轮候选上下文产品缺口；AU-02 文件级剩余为真实 LM Studio 中文质量和 D2 schema/codegen 回归。
