# AU01 Garbage JSON Recovery

- 状态：done（checkpoint closed）
- 类型：UI Contract Slice / Acceptance Slice
- 启动日期：2026-06-20

## 1. 用户 / 系统目标

作者在真实工作台遇到 LLM 返回无法解析的 frame JSON 时，系统不能把原始乱码展示给作者，也不能断开聊天链路；页面应显示友好降级提示，输入框恢复可用，下一条普通聊天仍能完成。

## 2. 开工检查

- Contract: `docs/design/acceptance/author/AU-01-chat.md` 的 `SC-AU01-E2`；`Planner` frame JSON fallback；`TurnResult.assistant_message`；`quality/acceptance/scenarios/au01-garbage-json-recovery.yml`。
- Invariant: malformed provider response 必须变成作者可读 fallback，raw provider payload 不进入用户可见 UI；Channel 保持可用，下一轮有效普通聊天仍为 `generate_micro_plan=false` 且不生成 MicroPlan。
- Boundary: 切穿真实 Tauri workbench → Channel → DialogueGateway/Planner → test/support `slice_verify` provider；不改 production provider/runtime 注册，不改 product UI hook，不改 persistence schema。
- Consumer: 真实工作台消息流、输入框、服务状态和 `scripts/tauri_slice_verify.sh au01-garbage-json-recovery`。
- Proof: 外部 driver 发送触发坏 JSON 的普通聊天，验证页面友好 fallback、raw payload 不可见、输入/Channel 可恢复；随后发送有效普通聊天，验证 Channel/Gateway 完成且无 MicroPlan。
- Acceptance Driver: `frontend/slice-verify/external-ui-driver.mjs` 外部驱动真实 Tauri 页面；产品代码不读取 slice id、不加 `data-testid`/隐藏 metadata、不自动输入或上报验收状态。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改基础类型。 |
| novel_domain | no | 不改领域模型。 |
| novel_agent | yes | 只改 test/support slice_verify provider，让外部验收可稳定触发 malformed JSON。 |
| novel_application | no | 不改 Planner fallback 产品逻辑，只消费现有实现。 |
| novel_persistence | no | 不改 schema/repo。 |
| novel_web | no | 不改 Channel handler；只消费现有日志事件。 |
| frontend | yes | 只改外部 slice verifier，不改 production React。 |
| docs/design | yes | 回填 AU-01 文件级对账与覆盖状态。 |
| quality | yes | 新增场景 manifest 和 quality index。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 接入坏 JSON 外部触发路径 | done | test/support provider 按作者输入 marker 返回 malformed JSON。 |
| T2 | 接入 AU-01 外部 driver | done | 从真实输入框触发 fallback，再发送恢复聊天。 |
| T3 | 扩展 native verifier 与单测 | done | 证据必须包含友好 fallback、raw payload 不可见和恢复 turn。 |
| T4 | 新增 quality manifest 与索引 | done | 记录 anti-hook 边界和证据目录。 |
| T5 | 回填 AU-01、总蓝图、验收 README 与台账 | done | 标为 SC-AU01-E2 checkpoint，不冒充完整 AU-01。 |
| T6 | 跑验证门禁 | done | Tauri、quality acceptance、verifier 单测、task_done 和 static scan。 |

## 5. 验证

- [x] `pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `mix test apps/novel_application/test/novel_application/dialogue_gateway_test.exs apps/novel_e2e/test/novel_e2e/v3_full_chain_test.exs`
- [x] `bash scripts/tauri_slice_verify.sh au01-garbage-json-recovery`
- [x] `bash scripts/quality_accept.sh au01-garbage-json-recovery --surface tauri`
- [x] `bash scripts/task_done.sh --slice au01-garbage-json-recovery --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-20 — 不修改 production fallback 逻辑；当前 `Planner` 已有 malformed JSON parse/retry/fallback 行为，本 checkpoint 补真实 Tauri 页面外部验收，证明作者看到的是友好降级而不是 raw provider payload，并且下一轮普通聊天可恢复。
- 2026-06-20 — 真实 Tauri 与 quality acceptance 已通过：`artifacts/slice-verify/au01-garbage-json-recovery-tauri/summary.json` 记录 `fallback_message_visible=true`、`raw_provider_payload_visible=false`、`input_enabled_after_garbage=true`、`channel_connected_after_garbage=true`、两轮 `generate_micro_plan=false`，恢复 turn 不是 fallback。后续 `au01-frame-validation-friendly-error` 已关闭 frame validation 作者友好提示，`au01-turnresult-recorder-ui-consistency` 已关闭 B4 recorder/UI 同源对账；AU-01 文件级仍未退出，剩余 P1 为 replay/trace UI cross-reference，P2 为 C3 no-slot-form UI 反证。
- 2026-06-20 — `task_done` 已生成完成清单；`bash scripts/ai_static_scan.sh --top 10` 的可处理项为历史 `tools/company-console/server/config.mjs:4` gitleaks `accepted_risk`，touched files 0、blocking 0。

## 7. 试行反馈

- 该 checkpoint 只关闭 `SC-AU01-E2` 的真实页面最小闭环。AU-01 仍缺 frame validation 作者友好提示、普通聊天 replay UI 和更完整异常矩阵。
