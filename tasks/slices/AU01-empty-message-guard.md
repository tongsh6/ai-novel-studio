# AU01 Empty Message Guard

- 状态：done（checkpoint closed）
- 类型：UI Contract Slice / Acceptance Slice
- 启动日期：2026-06-19

## 1. 用户 / 系统目标

作者在真实工作台误点发送空白聊天内容时，系统不能创建空业务 turn、不能追加空消息、不能进入 thinking；输入框仍可继续使用，随后发送有效普通聊天仍能完成。

## 2. 开工检查

- Contract: `docs/design/acceptance/author/AU-01-chat.md` 的 `SC-AU01-B3`；`quality/acceptance/scenarios/au01-empty-message-guard.yml`。
- Invariant: 空白聊天输入不得产生 `user_message` websocket frame 或业务 turn；恢复用普通聊天仍保持 `generate_micro_plan=false`。
- Boundary: 只补外部 Tauri driver、native verifier、quality manifest 与验收文档；不改 production `WorkspaceChat`、Channel、DialogueGateway、Planner 或 provider runtime。
- Consumer: `scripts/tauri_slice_verify.sh au01-empty-message-guard` 与 `scripts/quality_accept.sh au01-empty-message-guard --surface tauri`。
- Proof: 真实 Tauri 工作台输入空格并点击发送，验证无 `user_message` frame、DOM 消息数不变、thinking 不出现、输入仍可用；随后发送有效普通消息，验证 Channel/Gateway 完成且无 MicroPlan。
- Acceptance Driver: `frontend/slice-verify/external-ui-driver.mjs` 外部驱动真实 Tauri 页面；产品代码不读取 slice id、不加 `data-testid`/隐藏 metadata、不自动输入或上报验收状态。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改基础类型。 |
| novel_domain | no | 不改领域模型。 |
| novel_agent | no | 不改 provider runtime。 |
| novel_application | no | 不改 DialogueGateway / Planner。 |
| novel_persistence | no | 不改 schema/repo。 |
| novel_web | no | 不改 Channel handler；只消费现有日志事件。 |
| frontend | yes | 只改外部 slice verifier，不改 production React。 |
| docs/design | yes | 回填 AU-01 空消息覆盖状态。 |
| quality | yes | 新增场景 manifest 和 quality index。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 接入 AU-01 空消息外部 driver | done | 从真实输入框填空格并点击发送，验证无 frame/无 DOM 消息。 |
| T2 | 扩展 native verifier 与单测 | done | 证据必须包含空白不发送与有效消息恢复。 |
| T3 | 新增 quality manifest 与索引 | done | 记录 anti-hook 边界和证据目录。 |
| T4 | 回填 AU-01、总蓝图、验收 README 与台账 | done | 标为 SC-AU01-B3 checkpoint，不冒充完整 AU-01。 |
| T5 | 跑验证门禁 | done | Tauri、quality acceptance、verifier 单测、task_done 和 static scan 已闭环。 |

## 5. 验证

- [x] `pnpm --dir frontend test -- native-tauri-verifier.test.mjs`
- [x] `bash scripts/tauri_slice_verify.sh au01-empty-message-guard`
- [x] `bash scripts/quality_accept.sh au01-empty-message-guard --surface tauri`
- [x] `bash scripts/task_done.sh --slice au01-empty-message-guard --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-19 — 不修改 production 空消息行为；当前 `WorkspaceChat.handleSend` 已在 `trim()` 后直接 return，后端 Channel 对直接空 text 有 fallback turn_result 局部测试。本 checkpoint 只补真实页面外部验收，证明作者误点空白发送不会创建空 turn，且随后普通聊天可继续。

## 7. 试行反馈

- 该 checkpoint 只关闭 `SC-AU01-B3` 的真实页面最小闭环。AU-01 仍缺乱码 JSON、frame validation 友好提示、replay/trace UI 和更完整异常矩阵。
