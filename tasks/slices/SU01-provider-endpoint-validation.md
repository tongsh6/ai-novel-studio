# SU01 Provider Endpoint Validation

- 状态：checkpoint closed（endpoint URL 校验最小真实 Tauri 闭环已补；SU-01 B3 实时模型列表成功矩阵未完成）
- 类型：UI Contract Slice / Acceptance Slice / System Slice
- 启动日期：2026-06-19

## 1. 用户 / 系统目标

系统用户在模型供应商设置中输入 endpoint 时，产品必须在保存、测试连接或拉取模型列表前拒绝明显非法的 URL。该 checkpoint 只补 `SC-SU01-B3` 中的 endpoint URL 校验与真实工作台验收，不声称补齐云端 Key、真实模型列表成功矩阵或跨平台 secret 全链路。

## 2. 开工检查

- Contract: `docs/design/acceptance/system/SU-01-model-provider.md` `SC-SU01-B3`；`Gateway.configure_provider/1`、`Gateway.test_provider/1`、`Gateway.provider_models/1`；`WorkspaceChat` 模型供应商设置 Dialog。
- Invariant: 非法 endpoint 不进入 runtime provider config；非法 endpoint 不触发 provider adapter 的模型列表请求；产品代码不得新增验收感知逻辑。
- Boundary: 涉及 `novel_agent` provider gateway、`novel_web` provider controller、`frontend` 模型设置 Dialog、`quality` 场景 manifest 和外部 Tauri verifier；不应修改 `novel_domain` / `novel_persistence`。
- Consumer: 第一个真实消费者是 `WorkspaceChat` 顶栏模型设置 Dialog；后端消费者是 provider config/models/test 三个公开 HTTP 入口。
- Proof: Gateway 单测覆盖 configure/test/models 拒绝非法 endpoint；ProviderController 单测覆盖 HTTP 422；前端单测覆盖 endpoint URL 判定；外部 Tauri driver 在真实 Dialog 选择 LM Studio、输入非法 endpoint，并断言错误可见、刷新/测试/保存禁用且无 provider models 请求。
- Acceptance Driver: `su01-provider-endpoint-validation`，通过 `frontend/slice-verify/external-ui-driver.mjs` 操作真实 Tauri 工作台；不使用 URL query、localStorage、hidden DOM hook 或产品验收开关。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不新增错误类型模块。 |
| novel_domain | no | provider 设置不进入领域层。 |
| novel_agent | yes | provider gateway 统一校验 endpoint。 |
| novel_application | no | 复用现有 provider 公开入口。 |
| novel_persistence | no | 不涉及持久化。 |
| novel_web | yes | ProviderController 保持 422 contract。 |
| frontend | yes | 模型设置 Dialog 显示校验并禁用动作。 |
| docs/design | yes | 回填 SU-01 B3 局部闭环证据。 |
| quality | yes | 新增 scenario manifest 和 Tauri verifier 入口。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | Review SU-01 B3 endpoint 当前实现偏差 | done | 原实现只 trim endpoint，未校验绝对 http(s) URL。 |
| T2 | 后端 Gateway 统一拒绝非法 endpoint | done | configure/test/models 三入口共享校验。 |
| T3 | 前端 Dialog 显示校验并阻断动作 | done | 刷新模型、测试连接、保存切换均禁用。 |
| T4 | 补外部 Tauri driver 与 quality manifest | done | slice id：`su01-provider-endpoint-validation`。 |
| T5 | 验证并回填 SU-01 / 蓝图 / README | done | 已回填 SU-01 / 总蓝图 / acceptance README；不把 B3 全量写成 done。 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh su01-provider-endpoint-validation`
- [x] quality 场景入口：`bash scripts/quality_accept.sh su01-provider-endpoint-validation --surface tauri`
- [x] 后端局部验证：`mix test apps/novel_agent/test/novel_agent/provider/gateway_test.exs apps/novel_web/test/novel_web/controllers/provider_controller_test.exs`
- [x] 前端局部验证：`pnpm --dir frontend test -- modelProvider.test.ts`
- [ ] 设计追溯：`bash scripts/check_design_trace.sh`
- [ ] 静态扫描：`bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-19 — 该 checkpoint 只补非法 URL 阻断；不把 `SC-SU01-B3` 的真实模型列表成功矩阵写成已闭环。
- 2026-06-19 — 校验放在 Gateway 和 Dialog 两层：前端给即时反馈，后端保护所有公开 provider 入口。
- 2026-06-19 — `su01-provider-endpoint-validation` 外部 Tauri driver 与 quality acceptance 均已通过；B3 覆盖状态记录为局部 checkpoint。

## 7. 试行反馈

- `SC-SU01-B3` 应拆分记录 endpoint URL 校验与真实模型列表成功矩阵，否则容易把“能输入 endpoint”误判成完整模型配置闭环。
