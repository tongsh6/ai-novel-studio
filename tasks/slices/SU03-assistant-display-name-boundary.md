# SU03 Assistant Display Name Boundary

- 状态：done（checkpoint closed）
- 类型：UI Contract Slice / Acceptance Slice
- 启动日期：2026-06-19

## 1. 用户 / 系统目标

作者可以给当前作品里的 AI 起显示名，但这个名字只能改变界面称呼，不能进入 provider prompt、LLM request payload、canonical role 或 TurnResult 契约。

## 2. 开工检查

- Contract: `docs/design/acceptance/system/SU-03-model-nickname.md` 的 `SC-SU03-C2`；`quality/acceptance/scenarios/su03-assistant-display-name.yml`。
- Invariant: assistant display name 是 work-scoped UI preference；`user_message` wire payload、TurnResult schema 和 LM Studio request body 都不得携带该 UI-only 显示名。
- Boundary: 只补外部 Tauri driver、native verifier、quality manifest 与验收文档；不改 production provider/planner/gateway/prompt runtime。
- Consumer: `scripts/tauri_slice_verify.sh su03-assistant-display-name` 与 `--real-lmstudio`；`scripts/quality_accept.sh su03-assistant-display-name --surface tauri`。
- Proof: 改名后从真实工作台发送普通消息，验证 websocket payload、TurnResult、UI label 和 LM Studio request log。
- Acceptance Driver: `frontend/slice-verify/external-ui-driver.mjs` 外部驱动真实 Tauri 页面；产品代码不读取 slice id、不添加隐藏 DOM hook、不上报验收状态。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改基础类型。 |
| novel_domain | no | 不改领域模型。 |
| novel_agent | no | 不改 provider/prompt runtime，只读取现有 LM Studio request log。 |
| novel_application | no | 不改 DialogueGateway / Planner / TurnResult。 |
| novel_persistence | no | 显示名仍是 Tauri/browser preference，不写 Work schema。 |
| novel_web | no | 不新增 Channel/API 字段。 |
| frontend | yes | 只改外部 slice verifier，不改 production React。 |
| docs/design | yes | 回填 SU-03 覆盖状态与蓝图。 |
| quality | yes | 标记 real LMStudio payload 证据入口。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 扩展 SU-03 外部 driver，改名后发送真实消息 | done | 记录 `turn_id`、wire payload 与 TurnResult contract。 |
| T2 | 扩展 native verifier，检查默认 provider 与 LM Studio payload 边界 | done | `--real-lmstudio` 模式要求 request body 不含“创作助手”。 |
| T3 | 回填 SU-03、总蓝图、quality manifest | done | SU-03 更新为 6/6 真实 Tauri 验收。 |
| T4 | 跑验证门禁 | done | 默认 Tauri、real LMStudio Tauri、quality acceptance 和 verifier 单测已通过。 |

## 5. 验证

- [x] `pnpm --dir frontend test -- native-tauri-verifier assistantDisplayName`
- [x] `bash scripts/tauri_slice_verify.sh su03-assistant-display-name`
- [x] `bash scripts/tauri_slice_verify.sh --real-lmstudio su03-assistant-display-name`
- [x] `bash scripts/quality_accept.sh su03-assistant-display-name --surface tauri`

## 6. 决策日志

- 2026-06-19 — 不向生产 DOM 添加 `data-role` 或验收 hook；改由外部 driver 读取 websocket frame、TurnResult 和 LM Studio request log 证明行为边界。
- 2026-06-19 — 按 `SCENARIO-BLUEPRINT.md` 的 SU-03 顺序复核当前 checkout：6 个场景仍与设计一致，默认 provider、real LM Studio 与 quality acceptance 均通过；未发现需要进入实现的设计偏差或 P0/P1 缺口。
- 2026-06-20 — 按文件级滚动闭环重新复跑 SU-03：默认 Tauri、real LM Studio、quality acceptance 和局部 verifier/assistantDisplayName 单测均通过；验收文件补入文件级对账矩阵，project ledger 旧 `0/6` 口径已更新为 `6/6`。SU-03 可进入 AU-01。
- 2026-06-22 — 二轮缺口收敛复跑 `quality_accept` 默认 Tauri 与 `--real-lmstudio`；真实页面仍证明显示名只影响 UI label，不进入 websocket payload、TurnResult 字段或 LM Studio request body。本 checkpoint 保持 closed，无 P0/P1。
