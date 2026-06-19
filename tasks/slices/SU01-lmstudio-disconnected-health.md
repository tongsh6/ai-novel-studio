# SU01 LM Studio Disconnected Health

- 状态：checkpoint closed（LM Studio 断开态最小真实 Tauri 闭环已补；SU-01 全量异常矩阵未完成）
- 类型：UI Contract Slice / Acceptance Slice / System Slice
- 启动日期：2026-06-19

## 1. 用户 / 系统目标

系统用户把模型供应商设为 LM Studio 但本地服务未启动时，真实工作台必须清楚显示模型不可用，而不是只显示供应商名或底层 TCP 错误。该 slice 补 `SC-SU01-A3` 的最小真实 Tauri 闭环，不扩展到云端 Key、DeepSeek、endpoint 全矩阵或跨平台 secret 策略。

## 2. 开工检查

- Contract: `docs/design/acceptance/system/SU-01-model-provider.md` `SC-SU01-A3`；`GET /api/provider/health`；`NovelAgent.Provider.LMStudio.health_check/1`。
- Invariant: 连接状态必须来自后端真实 health check；UI 不直接调用 provider；不可用 provider 不做静默 fallback；产品代码不得新增验收感知逻辑。
- Boundary: 涉及 `novel_agent`、`novel_web` 既有 provider health 路径、`frontend` health 展示、`quality` 场景 manifest 和外部 Tauri verifier；不应修改 `novel_domain` / `novel_persistence`。
- Consumer: 第一个真实消费者是 `WorkspaceChat` 顶栏模型状态按钮；后端消费者是 `ProviderController.health/2`。
- Proof: LM Studio adapter 单测覆盖 connection refused / timeout 文案；前端 health client 保留 disconnected metadata；外部 Tauri driver 将运行时 provider 配成不可达 LM Studio endpoint，刷新真实工作台并断言可见 `模型未连接` 与 LM Studio 断开原因。
- Acceptance Driver: `su01-lmstudio-disconnected-health`，通过 `frontend/slice-verify/external-ui-driver.mjs` 操作真实 Tauri 工作台和后端 API；不使用 URL query、localStorage、hidden DOM hook 或产品验收开关。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不新增 error enum。 |
| novel_domain | no | provider health 不进入领域层。 |
| novel_agent | yes | 统一 LM Studio health 错误文案。 |
| novel_application | no | 复用现有 `provider_health/0`。 |
| novel_persistence | no | 不涉及持久化。 |
| novel_web | no | 复用现有 ProviderController health contract。 |
| frontend | yes | 模型状态可见文本显示 provider + health 状态。 |
| docs/design | yes | 回填 SU-01 A3 最小闭环证据。 |
| quality | yes | 新增 scenario manifest 和 Tauri verifier 入口。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | Review SU-01 A3 当前实现偏差 | done | health API 存在，但 UI 可见文本不够明确，LM Studio health message 可能偏技术化。 |
| T2 | 统一 LM Studio disconnected health 文案 | done | connection refused -> `LM Studio 未启动`，timeout -> `LM Studio 请求超时`。 |
| T3 | 让顶栏模型状态可见显示断开态 | done | 可见文本包含 provider + `模型未连接`。 |
| T4 | 补外部 Tauri driver 与 quality manifest | done | slice id：`su01-lmstudio-disconnected-health`；已接 `tauri_slice_verify` 与 quality acceptance。 |
| T5 | 验证并回填 SU-01 / 蓝图 / README | done | 已回填 SU-01 / 总蓝图 / acceptance README；不把 SU-01 全量写成 done。 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh su01-lmstudio-disconnected-health`
- [x] quality 场景入口：`bash scripts/quality_accept.sh su01-lmstudio-disconnected-health --surface tauri`
- [x] 后端局部验证：`mix test apps/novel_agent/test/novel_agent/provider/lm_studio_test.exs apps/novel_web/test/novel_web/controllers/provider_controller_test.exs`
- [x] 前端局部验证：`pnpm --dir frontend test -- providerHealth.test.ts`
- [ ] 设计追溯：`bash scripts/check_design_trace.sh`
- [ ] 静态扫描：`bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-19 — 按用户指定顺序从 SU-01 继续逐项 review；A3 是 SU-01 中最靠前未闭环且可本轮闭合的场景。
- 2026-06-19 — 断开态只验证 LM Studio 不可达，不引入 fake provider 到产品 runtime，不修改产品代码读取 slice id。
- 2026-06-19 — `su01-lmstudio-disconnected-health` 外部 Tauri driver 已通过，证明真实工作台可见 `模型未连接`，health/title 包含“LM Studio 未启动”。

## 7. 试行反馈

- Provider health 的“已实现”不能只看 API 存在；用户可见文本必须直接表达连接状态，不能只依赖颜色或 hover title。
