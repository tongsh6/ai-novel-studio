# AU01 Frame Validation Friendly Error

- 状态：done（checkpoint closed）
- 类型：UI Contract Slice / Acceptance Slice
- 启动日期：2026-06-20

## 1. 用户 / 系统目标

作者在真实工作台遇到 LLM 返回带禁止执行语义的 frame 时，系统必须拦截该 frame，并给作者显示稳定、可理解的降级提示；页面和 websocket `turn_result` 不暴露内部 validation reason，下一轮普通聊天仍可继续。

## 2. 开工检查

- Contract: `docs/design/acceptance/author/AU-01-chat.md` 的 `SC-AU01-E3`；`DialogueFrame.validate/1` forbidden semantics；Channel fallback `TurnResult.assistant_message` / `errors` payload；`quality/acceptance/scenarios/au01-frame-validation-friendly-error.yml`。
- Invariant: 禁止语义 frame 必须被拦截；作者可见 UI 和 websocket turn_result 不暴露 `frame validation failed`、`forbidden semantics`、`approved`、`ready_to_execute` 等内部 reason；本轮不写入、不采纳、不调用工具；下一轮普通聊天恢复且 `generate_micro_plan=false`。
- Boundary: 切穿真实 Tauri workbench → Channel → DialogueGateway → `DialogueFrame.validate/1`；只最小修改 production Channel fallback 的用户侧错误 payload；test/support provider 只用于外部验收触发，不注册进 production runtime；不改 persistence schema。
- Consumer: 真实工作台消息流、输入框、服务状态和 `scripts/tauri_slice_verify.sh au01-frame-validation-friendly-error`。
- Proof: 外部 driver 发送触发禁止语义 frame 的普通聊天，验证页面友好 fallback、内部 reason 不在 UI 或 turn_result、输入/Channel 可恢复；随后发送有效普通聊天，验证 Channel/Gateway 完成且无 MicroPlan。
- Acceptance Driver: `frontend/slice-verify/external-ui-driver.mjs` 外部驱动真实 Tauri 页面；产品代码不读取 slice id、不加 `data-testid`/隐藏 metadata、不自动输入或上报验收状态。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改基础类型。 |
| novel_domain | no | 不改 `DialogueFrame.validate/1` 规则，只消费现有 forbidden semantics 拦截。 |
| novel_agent | yes | 只改 test/support slice_verify provider，让外部验收可稳定触发 forbidden frame。 |
| novel_application | no | 不改 DialogueGateway / Planner 主逻辑；内部 reason 仍通过业务日志记录。 |
| novel_persistence | no | 不改 schema/repo。 |
| novel_web | yes | 最小修复 Channel fallback，避免把内部 reason 放进前端 turn_result payload。 |
| frontend | yes | 只改外部 slice verifier，不改 production React。 |
| docs/design | yes | 回填 AU-01 文件级对账与覆盖状态。 |
| quality | yes | 新增场景 manifest 和 quality index。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 修正 Channel fallback 用户侧 payload | done | `turn_result.error` / `errors[].message` 不再携带 raw internal reason。 |
| T2 | 接入 forbidden frame 外部触发路径 | done | test/support provider 按作者输入 marker 返回带禁止语义的 frame。 |
| T3 | 接入 AU-01 E3 外部 driver | done | 从真实输入框触发 validation failure，再发送恢复聊天。 |
| T4 | 扩展 native verifier 与单测 | done | 证据必须包含 error turn、恢复 turn、内部 reason 不可见。 |
| T5 | 新增 quality manifest 与索引 | done | 记录 anti-hook 边界和证据目录。 |
| T6 | 回填 AU-01、总蓝图、验收 README 与台账 | done | 标为 SC-AU01-E3 checkpoint，不冒充完整 AU-01。 |
| T7 | 跑验证门禁 | done | Tauri、quality acceptance、verifier 单测、task_done 和 static scan。 |

## 5. 验证

- [x] `pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `mix test apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs apps/novel_application/test/novel_application/dialogue_gateway_test.exs`
- [x] `bash scripts/tauri_slice_verify.sh au01-frame-validation-friendly-error`
- [x] `bash scripts/quality_accept.sh au01-frame-validation-friendly-error --surface tauri`
- [x] `bash scripts/task_done.sh --slice au01-frame-validation-friendly-error --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-20 — E3 审计发现 Channel fallback 虽然 `assistant_message.text` 已是通用友好文案，但 `turn_result.error` / `errors[].message` 仍携带 raw internal reason。按 AU-01 E3 修正为稳定 `turn_processing_failed` 和通用用户文案；内部 reason 保留在业务日志 `channel.user_message.error` / `dialogue_gateway.handle_input.error`。
- 2026-06-20 — 真实 Tauri 与 quality acceptance 已通过：`artifacts/slice-verify/au01-frame-validation-friendly-error-tauri/summary.json` 记录 `fallback_message_visible=true`、`internal_validation_reason_visible=false`、`internal_validation_reason_in_turn_result=false`、`input_enabled_after_invalid_frame=true`、`channel_connected_after_invalid_frame=true`，恢复 turn 不是 fallback。后续 `au01-turnresult-recorder-ui-consistency` 已关闭 B4 recorder/UI 同源对账；AU-01 文件级仍未退出，剩余 P1 为 D1 trace/replay UI cross-reference，P2 为 C3 no-slot-form UI 反证。
- 2026-06-20 — `task_done` 已生成完成清单；`bash scripts/ai_static_scan.sh --top 10` 的可处理项仍为历史 `tools/company-console/server/config.mjs:4` gitleaks `accepted_risk`，touched files 0、blocking 0。

## 7. 试行反馈

- 该 checkpoint 只关闭 `SC-AU01-E3` 的真实页面最小闭环。AU-01 后续已补 B4 recorder/UI 同源对账，当前仍缺 D1 trace/replay UI（owner 为 AU-07）和 C3 no-slot-form UI 反证。
