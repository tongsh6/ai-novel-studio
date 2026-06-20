# AU02 Candidate Fallback UI

- 状态：done（checkpoint closed）
- 类型：Acceptance Slice / UI Contract Slice
- 启动日期：2026-06-20

## 1. 用户 / 系统目标

作者在探索创作方向时，即使上游 LLM 返回缺失或坏格式的候选方向，真实工作台也必须继续展示可用候选卡。候选仍只是灵感入口，不能被误标为已采纳，也不能触发工具、采纳或 production write。

## 2. 开工检查

- Contract: `docs/design/acceptance/author/AU-02-explore.md` 的 `SC-AU02-B3`；`CandidateDirection` 的 `title` / `pitch` / `tone_tags` / `adoption_status`；`TurnResult.candidate_directions`；`DialogueFrame.frame_type=creative_exploration`；`quality/acceptance/scenarios/au02-candidate-fallback-ui.yml`。
- Invariant: 候选缺失或格式坏不能中断 exploration；fallback candidate 必须有非空标题和简介；fallback candidate 必须保持 `not_adopted`；探索阶段不得触发 MicroPlan、工具、采纳或 production write。
- Boundary: 只扩展 test/support `slice_verify` provider、外部 Tauri driver、native verifier、quality manifest、验收文档和 task 记录；不修改 production provider 注册、Planner fallback 规则、Channel handler、persistence 或 React production 组件。
- Consumer: `WorkspaceChat` 候选卡，以及 `scripts/tauri_slice_verify.sh au02-candidate-fallback-ui`。
- Proof: provider 单测证明测试 provider 可产生坏候选 payload；真实 Tauri 工作台发送坏候选场景后，`planner.form_frame.done` 记录 `creative_exploration` 和 `candidate_count >= 2`，UI 可见 Planner fallback 候选，TurnResult 中候选字段非空且 `not_adopted`，无 action/adoption/write。
- Acceptance Driver: `frontend/slice-verify/external-ui-driver.mjs` 外部驱动真实 Tauri 页面；产品代码不读取 slice id、不加 `data-testid`/隐藏 metadata、不自动输入或上报验收状态。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改基础类型。 |
| novel_domain | no | 不改 `CandidateDirection`。 |
| novel_agent | yes | 只改 `test/support` 的 slice verification provider，生产编译路径不包含。 |
| novel_application | no | 不改 Planner fallback 实现，只消费既有规则。 |
| novel_persistence | no | 不改 schema/repo。 |
| novel_web | no | 不改 Channel handler。 |
| frontend | yes | 只改外部 slice verifier，不改 production React。 |
| docs/design | yes | 回填 AU-02 B3 覆盖状态。 |
| quality | yes | 新增场景 manifest 和 quality index。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 扩展 test/support provider 的坏候选 payload | done | `AU02BADCANDIDATES` 只服务外部验收 harness。 |
| T2 | 新增 AU-02 candidate fallback 外部 driver | done | 真实工作台发送坏候选 exploration。 |
| T3 | 扩展 native verifier 与单测 | done | 必须验证 fallback 候选非空、可见、not_adopted、no write。 |
| T4 | 新增 quality manifest 与索引 | done | 记录 anti-hook 边界和证据目录。 |
| T5 | 回填 AU-02、总蓝图、验收 README 与台账 | done | AU-02 重算为 10/12 真实 Tauri checkpoint。 |
| T6 | 跑验证门禁 | done | Tauri、quality acceptance、manifest check 已通过；task_done/static scan 待本记录更新后复跑。 |

## 5. 验证

- [x] `mix test apps/novel_agent/test/novel_agent/provider/slice_verify_test.exs`
- [x] `node --check frontend/slice-verify/external-ui-driver.mjs`
- [x] `node --check frontend/slice-verify/native-tauri-verifier.mjs`
- [x] `pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/tauri_slice_verify.sh au02-candidate-fallback-ui`
- [x] `bash scripts/quality_accept.sh au02-candidate-fallback-ui --surface tauri`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/task_done.sh --slice au02-candidate-fallback-ui --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-20 — 选择补真实 UI 反证，而不是把后端 fallback 测试直接升级成已验收。test/support provider 返回坏候选 payload，真实工作台仍穿过 Channel / DialogueGateway / Planner / TurnResult / UI；生产 provider runtime 不注册验收替身。
- 2026-06-20 — 真实 Tauri 与 quality acceptance 已通过：`artifacts/slice-verify/au02-candidate-fallback-ui-tauri/summary.json` 记录 `provider_candidate_payload=malformed_candidates`、`frame_type=creative_exploration`、`frame_candidate_count=3`、fallback 标题 `矛盾切入` / `人物切入` / `世界规则切入`、`candidate_fields_nonempty=true`、`candidate_statuses_not_adopted=true`、`generate_micro_plan=false`、`tool_result_present=false`、`adoption_decision_present=false`、`candidate_selected=false`、`candidate_adopted=false`、`production_write_performed=false`。

## 7. 试行反馈

- 本 checkpoint 只关闭 AU-02 B3 的真实 UI 反证；多轮上下文质量已由后续 `au02-candidate-multiturn-context` 补真实 Tauri 证据，真实 LMStudio 中文质量和 D2 schema/codegen 仍需当前 AU-02 文件继续滚动收口。
