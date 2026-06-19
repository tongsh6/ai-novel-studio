# AU01 Ordinary Chat Two-Turn Roundtrip

- 状态：done（checkpoint closed）
- 类型：UI Contract Slice / Acceptance Slice
- 启动日期：2026-06-19

## 1. 用户 / 系统目标

作者打开真实工作台后，可以连续两轮自然聊创作。系统显示用户消息和 AI 回复，loading / thinking 状态会结束，普通聊天不会默认升级为 MicroPlan、执行卡、候选卡或采纳卡。

## 2. 开工检查

- Contract: `docs/design/acceptance/author/AU-01-chat.md` 的 SC-AU01-A1/A2/B1/B2/C1/C2；`quality/acceptance/scenarios/au01-ordinary-chat-two-turn-roundtrip.yml`。
- Invariant: 普通聊天默认 `generate_micro_plan=false`；TurnResult 是 UI 展示的 canonical 输出；普通聊天不得渲染 action/candidate/adoption/execution 卡。
- Boundary: 只补外部 Tauri driver、native Tauri 脚本入口、quality manifest 与验收文档；不改 production DialogueGateway、Planner、Provider 或 React runtime 行为。
- Consumer: `scripts/tauri_slice_verify.sh au01-ordinary-chat-two-turn-roundtrip`、`--real-lmstudio` 和 `scripts/quality_accept.sh au01-ordinary-chat-two-turn-roundtrip --surface tauri`。
- Proof: 从真实 Tauri 工作台输入两轮自然创作聊天，验证可见消息顺序、thinking 清退、wire payload、Gateway 日志、无 MicroPlan 事件、无 action/candidate/adoption UI。
- Acceptance Driver: `frontend/slice-verify/external-ui-driver.mjs` 外部驱动真实 Tauri 页面；产品代码不读取 slice id、不加 `data-testid`/隐藏 metadata、不自动输入或上报验收状态。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改基础类型。 |
| novel_domain | no | 不改领域模型。 |
| novel_agent | no | 不改 provider runtime；real LMStudio 只作为外部验证模式。 |
| novel_application | no | 不改 DialogueGateway / Planner。 |
| novel_persistence | no | 不改 schema/repo。 |
| novel_web | no | 不改 Channel handler；只消费现有日志事件。 |
| frontend | yes | 只改外部 slice verifier，不改 production React。 |
| docs/design | yes | 回填 AU-01 覆盖状态与蓝图。 |
| quality | yes | 新增场景 manifest 和 quality index。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 接入 AU-01 external Tauri driver | done | 两轮普通消息，采集 websocket frame 与 DOM 可见状态。 |
| T2 | 暴露 `tauri_slice_verify` slice id | done | 默认 provider 与 `--real-lmstudio` 共用同一外部 driver。 |
| T3 | 新增 quality manifest 与索引 | done | 记录 anti-hook 边界和证据目录。 |
| T4 | 回填 AU-01 与总蓝图 | done | 标为普通聊天 checkpoint，不冒充完整 AU-01。 |
| T5 | 跑验证门禁 | done | 默认 Tauri、real LMStudio Tauri、quality acceptance、verifier 单测和静态扫描。 |

## 5. 验证

- [x] `pnpm --dir frontend test -- native-tauri-verifier ordinary`
- [x] `bash scripts/tauri_slice_verify.sh au01-ordinary-chat-two-turn-roundtrip`
- [x] `bash scripts/tauri_slice_verify.sh --real-lmstudio au01-ordinary-chat-two-turn-roundtrip`
- [x] `bash scripts/quality_accept.sh au01-ordinary-chat-two-turn-roundtrip --surface tauri`
- [x] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-19 — 不修改 production 聊天链路；当前缺口是 AU-01 verifier 已有行为判断但外部入口/quality manifest 断开。补外部入口和文档，不把 deterministic provider 证据等同于真实 LLM；另用 `--real-lmstudio` 证明真实 provider 两轮 form_frame 请求。

## 7. 试行反馈

- AU-01 是广义能力，不应因普通聊天 checkpoint 通过而整体标 done。异常降级、空消息作者提示、乱码 JSON 和 frame 校验失败仍应作为后续矩阵处理。
