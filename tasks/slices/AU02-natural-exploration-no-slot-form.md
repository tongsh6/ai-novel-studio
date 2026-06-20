# AU02 Natural Exploration No Slot Form

- 状态：done（checkpoint closed）
- 类型：Acceptance Slice / UI Contract Slice
- 启动日期：2026-06-20

## 1. 用户 / 系统目标

作者输入模糊创意时，系统应先像创作伙伴一样自然展开方向，展示候选灵感入口，而不是把缺失信息转成机械必填字段表、MicroPlan、工具执行或确认卡。

## 2. 开工检查

- Contract: `docs/design/acceptance/author/AU-02-explore.md` 的 `SC-AU02-A1` / `SC-AU02-A2` / `SC-AU02-D1`；`DialogueFrame.frame_type=creative_exploration`；`TurnResult.assistant_message` / `candidate_directions`；`generate_micro_plan=false`；`docs/design/07-workbench-ui-contract.md` 的 candidate / available action / slot form 边界；`quality/acceptance/scenarios/au02-natural-exploration-no-slot-form.yml`。
- Invariant: 模糊探索必须产生 primary DialogueFrame；缺 slot 不自动等于表单；探索阶段不得默认触发 MicroPlan、工具、确认、采纳或 production write；真实 LM Studio provider 变体必须给出中文自然回复、无 JSON/代码块形态、候选语义贴合输入。
- Boundary: 只补外部 Tauri driver、native verifier、quality manifest、验收文档和 task 记录；不改 production `WorkspaceChat`、Channel、DialogueGateway、Planner 或 provider runtime。
- Consumer: `scripts/tauri_slice_verify.sh au02-natural-exploration-no-slot-form`、`scripts/tauri_slice_verify.sh --real-lmstudio au02-natural-exploration-no-slot-form` 与 `scripts/quality_accept.sh au02-natural-exploration-no-slot-form --surface tauri`。
- Proof: 真实 Tauri 工作台发送模糊创意，验证 `planner.form_frame.done frame_type=creative_exploration`、自然回复和候选卡可见、无 slot form / durable clarification / MicroPlan / 工具 / 确认 / 采纳 / production write；real LM Studio provider 变体 additionally 验证 provider request、中文自然回复、无 JSON/代码块形态和候选语义相关。
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
| docs/design | yes | 回填 AU-02 A1/A2 覆盖状态。 |
| quality | yes | 新增场景 manifest 和 quality index。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 新增 AU-02 自然探索 no-slot-form 外部 driver | done | 真实工作台发送模糊创意并观察自然探索回复。 |
| T2 | 扩展 native verifier 与单测 | done | 必须拒绝 slot form、MicroPlan、工具/确认/采纳/write 证据。 |
| T3 | 新增 quality manifest 与索引 | done | 记录 anti-hook 边界和证据目录。 |
| T4 | 回填 AU-02、总蓝图、验收 README 与台账 | done | 文件级重算后更新。 |
| T5 | 跑验证门禁 | done | Tauri、quality acceptance、verifier 单测、task_done 和 static scan 已闭环。 |
| T6 | 补 real LM Studio 中文探索质量验收 | done | `--real-lmstudio` 模式把中文、非 JSON/代码块、候选语义相关写入 machine-checkable summary。 |

## 5. 验证

- [x] `node --check frontend/slice-verify/external-ui-driver.mjs`
- [x] `node --check frontend/slice-verify/native-tauri-verifier.mjs`
- [x] `pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/tauri_slice_verify.sh au02-natural-exploration-no-slot-form`
- [x] `bash scripts/tauri_slice_verify.sh --real-lmstudio au02-natural-exploration-no-slot-form`
- [x] `bash scripts/quality_accept.sh au02-natural-exploration-no-slot-form --surface tauri`
- [x] `bash scripts/quality_accept.sh au02-natural-exploration-no-slot-form --surface tauri --provider lmstudio`
- [x] `bash scripts/task_done.sh --slice au02-natural-exploration-no-slot-form --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-20 — 选择补独立真实页面证据，而不是用候选 continuation/adoption driver 间接覆盖 A1/A2。这个 checkpoint 只证明模糊探索主入口：自然回复、候选卡、no slot form、no MicroPlan/no execution/no write。
- 2026-06-20 — 真实 Tauri 与 quality acceptance 已通过：`artifacts/slice-verify/au02-natural-exploration-no-slot-form-tauri/summary.json` 记录 `frame_type=creative_exploration`、`candidate_count=2`、`natural_reply_visible=true`、`candidate_panel_rendered=1`、`slot_form_visible=false`、`forbidden_slot_fields_absent=true`、`execution_card_visible=false`、`generate_micro_plan=false`、`tool_result_present=false`、`adoption_decision_present=false`、`candidate_selected=false`、`candidate_adopted=false`、`production_write_performed=false`。
- 2026-06-20 — D1 real LM Studio provider 质量复验已通过：`artifacts/slice-verify/au02-natural-exploration-no-slot-form-tauri-lmstudio/summary.json` 记录 `provider=lmstudio`、`request_count=1`、`status_codes=[200]`、`candidate_count=3`、`lmstudio_quality_checks_required=true`、`natural_reply_chinese=true`、`natural_reply_no_json_code=true`、`candidates_no_json_code=true`、`candidate_semantically_relevant=true`，且仍保持 no slot form / no MicroPlan / no action / no adoption / no write。`quality_accept --provider lmstudio` 也已通过；`ai_static_scan --top 10` 剩余唯一 Top 10 为历史 `gitleaks|generic-api-key|tools/company-console/server/config.mjs|4|generic-api-key`，处置状态 `accepted_risk`，0 个 finding 在本轮 touched files。
