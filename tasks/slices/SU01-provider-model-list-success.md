# SU01 Provider Model List Success

- 状态：checkpoint closed（供应商实时模型列表成功矩阵最小真实工作台 checkpoint 已补；live vendor 账号与 Keychain WebView 仍未闭环）
- 类型：UI Contract Slice / Acceptance Slice / System Slice
- 启动日期：2026-06-19

## 1. 用户 / 系统目标

系统用户在模型供应商设置中配置 DeepSeek、Anthropic 或 LM Studio 时，模型下拉框必须来自后端 provider adapter 的实时模型列表结果，而不是前端写死或作者手填。

本 slice 只补 `SC-SU01-B3` 的“模型列表成功矩阵”最小闭环：从真实工作台打开模型设置，依次拉取并选择 DeepSeek、Anthropic、LM Studio 三类 provider 的模型。云端 provider 响应由外部 harness 注入到生产 adapter 的 HTTP boundary，证明 UI/backend 成功管线，不证明 live vendor 账号可用。Keychain WebView 写读和跨平台 secret 策略仍保持 open。

## 2. 开工检查

- Contract: `docs/design/acceptance/system/SU-01-model-provider.md` `SC-SU01-B3`；`Gateway.provider_models/1`；`POST /api/provider/models`；`WorkspaceChat` 模型供应商设置 Dialog。
- Invariant: 模型列表必须从后端 provider adapter boundary 返回；前端不能预制 provider 模型集合；API Key 不进入可见 UI；产品代码不得新增验收感知逻辑。
- Boundary: 涉及 `scripts/slice_verify_server.exs` 的外部 harness fixture、`frontend/slice-verify/external-ui-driver.mjs`、`frontend/slice-verify/native-tauri-verifier.mjs`、`quality/acceptance` 和文档；不修改 production provider registry、`novel_domain`、`novel_persistence`。
- Consumer: 第一个真实消费者是 `WorkspaceChat` 顶栏模型设置 Dialog；后端消费者是 `ProviderController.models/2`。
- Proof: 外部 driver 打开真实工作台模型设置；DeepSeek/Anthropic 经生产 adapter 的 harnessed HTTP boundary 拉取模型；LM Studio 经外部 driver 启动的 OpenAI-compatible `/v1/models` endpoint 拉取模型；verifier 断言三家模型可见且可选择。
- Acceptance Driver: `su01-provider-model-list-success`，通过 `frontend/slice-verify/external-ui-driver.mjs` 操作真实工作台；不使用 URL query、localStorage、hidden DOM hook 或产品验收开关。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不新增基础类型。 |
| novel_domain | no | provider 设置不进入领域层。 |
| novel_agent | no | 不改 production adapter；只在 slice server harness 中注入 HTTP boundary fixture。 |
| novel_application | no | 复用现有 provider 公开入口。 |
| novel_persistence | no | 不涉及持久化。 |
| novel_web | no | 复用现有 ProviderController models contract。 |
| frontend | yes | 外部 driver 与 verifier 新增场景；不改生产 React 组件。 |
| docs/design | yes | 回填 SU-01 B3 checkpoint 证据和未闭环限制。 |
| quality | yes | 新增 scenario manifest 和 Tauri verifier 入口。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 核查 SU-01 B3 当前证据 | done | 后端已有三类 provider models 局部测试；真实页面只覆盖非法 endpoint 与 DeepSeek redaction 附带成功路径。 |
| T2 | 补外部 provider models fixture | done | DeepSeek/Anthropic 注入生产 adapter HTTP boundary；LM Studio 用外部 OpenAI-compatible `/v1/models` 服务。 |
| T3 | 补真实工作台 driver 和 verifier | done | slice id：`su01-provider-model-list-success`。 |
| T4 | 补 quality manifest 和 slice 索引 | done | 新增 `quality/acceptance/scenarios/su01-provider-model-list-success.yml`。 |
| T5 | 回填 SU-01 / 蓝图 / README | done | 不把 live vendor、Keychain WebView 或跨平台 secret 策略写成 closed。 |

## 5. 验证

- [x] 基线编译：`mix compile`
- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh su01-provider-model-list-success`
- [x] quality 场景入口：`bash scripts/quality_accept.sh su01-provider-model-list-success --surface tauri`
- [x] 后端局部验证：`mix test apps/novel_agent/test/novel_agent/provider/gateway_test.exs apps/novel_web/test/novel_web/controllers/provider_controller_test.exs`
- [x] 前端 verifier 局部验证：`pnpm --dir frontend test -- native-tauri-verifier.test.mjs`
- [x] quality manifest：`bash scripts/quality_manifest_check.sh`
- [x] 设计追溯：`bash scripts/check_design_trace.sh`
- [x] 静态扫描：`bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-19 — SU-01 的最高优先级 open gap 是 Keychain WebView 端到端，但当前 `tauri_slice_verify` 自动化实际驱动 Chromium/Vite 页面，没有 Tauri WebView 或 `tauri-driver` 能力；不能把 browser driver 结果包装成 Keychain 证据。
- 2026-06-19 — 本轮选择同文件内可闭环的 B3 模型列表成功矩阵：它能从真实设置入口压到 provider models API 和 adapter HTTP boundary，不需要产品代码新增验收感知逻辑。
- 2026-06-19 — 云端 provider 使用 harnessed HTTP boundary，只证明 production adapter 管线和 UI 选择，不证明 live vendor 账号或网络可用。

## 7. 试行反馈

- `tauri_slice_verify.sh` 的“native Tauri”命名容易让人误以为 Playwright 正在控制 Tauri WebView；Keychain、OS dialog、native menu 等桌面能力需要单独的 WebView/native UI 自动化能力，不能复用 browser-side DOM driver 结论。
