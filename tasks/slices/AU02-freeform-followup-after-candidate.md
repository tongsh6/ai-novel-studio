# AU02 Freeform Follow-up After Candidate

- 状态：done（checkpoint closed）
- 类型：Acceptance Slice / UI Contract Slice
- 启动日期：2026-06-19

## 1. 用户 / 系统目标

作者看到候选方向卡后，不一定要点击“继续聊这个方向”或“设为后续方向”。如果作者直接在输入框里继续追问，系统应把它当作普通自由输入处理：不隐式携带 `candidate_selection`，不提交 `author_action`，不进入 adoption boundary，也不写作品事实。

## 2. 开工检查

- Contract: `docs/design/acceptance/author/AU-02-explore.md` 的 `SC-AU02-C2`；`quality/acceptance/scenarios/au02-freeform-followup-after-candidate.yml`；候选 selection/adoption 边界仍沿用 `CandidateDirectionSet`、`AuthorActionInput.choose_candidate`、`AvailableAction` 与 `AdoptionBoundary`。
- Invariant: 候选卡不是强制动作；自由追问必须是普通 `user_message`，不得隐式带 `candidate_selection`，不得提交 `author_action`，不得产生 `action_result` / `AdoptionDecision` / production write。
- Boundary: 只补外部 Tauri driver、native verifier、quality manifest、验收文档和 task 记录；不改 production `WorkspaceChat`、Channel、DialogueGateway、Planner、provider runtime 或 adoption boundary。
- Consumer: `scripts/tauri_slice_verify.sh au02-freeform-followup-after-candidate` 与 `scripts/quality_accept.sh au02-freeform-followup-after-candidate --surface tauri`。
- Proof: 真实 Tauri 工作台先生成候选卡，保持候选按钮未点击，直接在输入框输入自由追问；验证发送的是无 `candidate_selection` 的普通 `user_message`，下一轮完成自然回复，且没有 `author_action` / `action_result` / adoption / production write。
- Acceptance Driver: `frontend/slice-verify/external-ui-driver.mjs` 外部驱动真实 Tauri 页面；产品代码不读取 slice id、不加 `data-testid`/隐藏 metadata、不自动输入或上报验收状态。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改基础类型。 |
| novel_domain | no | 不改领域模型。 |
| novel_agent | no | 不改 provider runtime。 |
| novel_application | no | 不改 DialogueGateway / Planner。 |
| novel_persistence | no | 不改 schema/repo。 |
| novel_web | no | 不改 Channel handler；只消费现有 websocket frame 和业务日志。 |
| frontend | yes | 只改外部 slice verifier，不改 production React。 |
| docs/design | yes | 回填 AU-02 自由追问覆盖状态。 |
| quality | yes | 新增场景 manifest 和 quality index。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 接入 AU-02 候选卡后自由追问外部 driver | done | 真实工作台生成候选卡后不点击候选按钮，直接输入自由追问。 |
| T2 | 扩展 native verifier 与单测 | done | 证据必须包含无 `candidate_selection`、无 `author_action`、无 adoption 和 no-write。 |
| T3 | 新增 quality manifest 与索引 | done | 记录 anti-hook 边界和证据目录。 |
| T4 | 回填 AU-02、总蓝图、验收 README 与台账 | done | 标为 SC-AU02-C2 最小 checkpoint，不冒充完整 AU-02。 |
| T5 | 跑验证门禁 | done | Tauri、quality acceptance、verifier 单测、task_done 和 static scan 已闭环。 |

## 5. 验证

- [x] `pnpm --dir frontend test -- native-tauri-verifier.test.mjs`
- [x] `bash scripts/tauri_slice_verify.sh au02-freeform-followup-after-candidate`
- [x] `bash scripts/quality_accept.sh au02-freeform-followup-after-candidate --surface tauri`
- [x] `bash scripts/task_done.sh --slice au02-freeform-followup-after-candidate --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-19 — 不修改 production 候选卡交互；当前 `WorkspaceChat` 已允许候选卡与输入框共存。本 checkpoint 只补真实页面外部验收，证明作者可以绕过候选按钮直接自由追问，且不会把候选选择或采纳边界静默绑定到本轮消息。
- 2026-06-19 — 真实 Tauri 与 quality acceptance 已通过。证据：`artifacts/slice-verify/au02-freeform-followup-after-candidate-tauri/summary.json`；task_done manifest 由最新 `bash scripts/task_done.sh --slice au02-freeform-followup-after-candidate --skip-static-scan` 生成。静态扫描 17 pass / 1 fail，唯一 Top10 是历史 `tools/company-console/server/config.mjs` generic-api-key accepted_risk，0 个 finding 在本次 touched files。

## 7. 试行反馈

- 该 checkpoint 只关闭 `SC-AU02-C2` 的最小真实页面反证。AU-02 仍缺连续多轮候选上下文质量、真实 LM Studio 中文探索质量、异常恢复和未采纳候选不进入阅读/事实的完整反证。
