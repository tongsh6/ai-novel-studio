# AU02 Unadopted Candidate No Reading Fact

- 状态：done（checkpoint closed）
- 类型：Acceptance Slice / UI Contract Slice
- 启动日期：2026-06-20

## 1. 用户 / 系统目标

作者看到候选方向后，如果没有点击“继续聊这个方向”或“设为后续方向”，候选只能作为灵感展示留在当前对话里，不能进入作品事实、阅读投影或任何 production write。

## 2. 开工检查

- Contract: `docs/design/acceptance/author/AU-02-explore.md` 的 `SC-AU02-B2` / `AU02-GAP-07`；`CandidateDirection`；`TurnResult.truthfulness.candidate_selected / candidate_adopted / production_write_performed`；`docs/design/contracts/VS-04-adoption-boundary-contract-pack.md`；`docs/design/contracts/VS-05-ui-roundtrip-contract-pack.md`；`quality/acceptance/scenarios/au02-unadopted-candidate-no-reading-fact.yml`。
- Invariant: candidate presented 不等于 selected/adopted；没有作者点击时不得提交 `author_action`；未采纳候选不得进入阅读模式、TOC、projection 或 production write。
- Boundary: 只补外部 Tauri driver、native verifier、quality manifest、验收文档和 task 记录；不改 production `WorkspaceChat`、Channel、DialogueGateway、Planner、provider runtime 或 adoption boundary。
- Consumer: `scripts/tauri_slice_verify.sh au02-unadopted-candidate-no-reading-fact` 与 `scripts/quality_accept.sh au02-unadopted-candidate-no-reading-fact --surface tauri`。
- Proof: 真实 Tauri 工作台生成候选卡后，不点击候选按钮，打开阅读模式；验证 `channel.get_toc.done` 返回 0 章 / 0 字，候选标题和简介不出现在阅读内容，且没有 `author_action` / `action_result` / adoption decision / projection / production write。
- Acceptance Driver: `frontend/slice-verify/external-ui-driver.mjs` 外部驱动真实 Tauri 页面；产品代码不读取 slice id、不加 `data-testid`/隐藏 metadata、不自动输入或上报验收状态。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改基础类型。 |
| novel_domain | no | 不改领域模型。 |
| novel_agent | no | 不改 provider runtime。 |
| novel_application | no | 不改 DialogueGateway / Planner / AdoptionBoundary。 |
| novel_persistence | no | 不改 schema/repo。 |
| novel_web | no | 不改 Channel handler；只消费现有 websocket frame 和业务日志。 |
| frontend | yes | 只改外部 slice verifier，不改 production React。 |
| docs/design | yes | 回填 AU-02 文件级对账状态。 |
| quality | yes | 新增场景 manifest 和 quality index。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 新增 AU-02 未采纳候选阅读反证外部 driver | done | 真实工作台生成候选后打开阅读模式。 |
| T2 | 扩展 native verifier 与单测 | done | 必须拒绝候选文本进入阅读模式、触发 action/adoption/write 的证据。 |
| T3 | 新增 quality manifest 与索引 | done | 记录 anti-hook 边界和证据目录。 |
| T4 | 回填 AU-02、总蓝图、验收 README 与台账 | done | 文件级重算后更新。 |
| T5 | 跑验证门禁 | done | Tauri、quality acceptance、verifier 单测、task_done 和 static scan 已闭环。 |

## 5. 验证

- [x] `node --check frontend/slice-verify/external-ui-driver.mjs`
- [x] `node --check frontend/slice-verify/native-tauri-verifier.mjs`
- [x] `pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/tauri_slice_verify.sh au02-unadopted-candidate-no-reading-fact`
- [x] `bash scripts/quality_accept.sh au02-unadopted-candidate-no-reading-fact --surface tauri`
- [x] `bash scripts/task_done.sh --slice au02-unadopted-candidate-no-reading-fact --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-20 — 选择补外部反证而不是改 production UI。当前缺口是证据不足：已有 continuation/freeform/adoption 证明候选动作边界，但还没有从真实阅读模式证明“未采纳候选没有进入作品事实”。本 checkpoint 只打开真实阅读模式并读取现有 `channel.get_toc.done`，不引入产品验收 hook。
- 2026-06-20 — 真实 Tauri 与 quality acceptance 已通过：`artifacts/slice-verify/au02-unadopted-candidate-no-reading-fact-tauri/summary.json` 记录 `reading_mode_opened=true`、`reading_empty_state_visible=true`、`reading_toc_chapter_count=0`、`reading_total_word_count=0`、`candidate_title_visible_in_reading=false`、`candidate_pitch_visible_in_reading=false`、`candidate_selected=false`、`candidate_adopted=false`、`production_write_performed=false`、`no_author_action_sent=true`、`no_action_result_received=true`、`no_projection_events=true`。AU02-GAP-07 在 AU-02 范围内关闭；AU-05/AU-08 后续继续覆盖已采纳投影和高风险/stale/conflict/cross-work。
