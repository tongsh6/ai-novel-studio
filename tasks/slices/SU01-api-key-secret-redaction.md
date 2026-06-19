# SU01 API Key Secret Redaction

- 状态：checkpoint closed（API Key 配置流脱敏最小真实工作台 checkpoint 已补；Keychain WebView 端到端未闭环）
- 类型：UI Contract Slice / Acceptance Slice / System Slice
- 启动日期：2026-06-19

## 1. 用户 / 系统目标

系统用户在模型供应商设置中输入云端 provider 的 API Key 后，产品必须能完成测试连接和保存，同时不能把 secret 暴露到 provider options response、浏览器 fallback settings、可见 UI、业务日志或后端请求日志。

本 slice 只补 `SC-SU01-B2/C3` 的脱敏 checkpoint，不把当前 browser-side workbench driver 误写成 macOS Keychain WebView 写读已验收。真实 Tauri WebView Keychain 端到端和跨平台 secret 策略仍是 SU-01 后续缺口。

## 2. 开工检查

- Contract: `docs/design/acceptance/system/SU-01-model-provider.md` `SC-SU01-B2/C3`；`GET /api/provider/options` 不返回 secret；`WorkspaceChat` 模型设置 Dialog；`docs/design/tech-stack/05-desktop.md` 的桌面 secret 存储口径。
- Invariant: API Key 不进入 options response、browser fallback settings、可见 UI、业务 JSONL 或 backend log；provider 模型列表可使用验收 harness 注入的外部 HTTP boundary，但不得把验收 provider 注册进生产 runtime。
- Boundary: 涉及 `novel_agent` DeepSeek adapter HTTP boundary、`novel_web` Phoenix 参数过滤、`frontend` 模型设置 Dialog、`quality` 场景 manifest 和外部 Tauri verifier；不修改 `novel_domain` / `novel_persistence`。
- Consumer: 第一个真实消费者是 `WorkspaceChat` 顶栏模型设置 Dialog；后端消费者是 provider options/models/test/config 四个公开 HTTP 入口。
- Proof: 外部 driver 打开真实工作台模型设置、选择 DeepSeek、输入 fake Key、通过 production DeepSeek adapter 的 harnessed HTTP boundary 拉取模型、测试连接并保存；verifier 读取 UI state、业务 JSONL 和 backend log，断言 fake Key 不泄漏。
- Acceptance Driver: `su01-api-key-secret-redaction`，通过 `frontend/slice-verify/external-ui-driver.mjs` 操作真实工作台；不使用 URL query、localStorage、hidden DOM hook 或产品验收开关。该 driver 当前不证明 Tauri WebView Keychain。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不新增基础类型。 |
| novel_domain | no | provider secret 不进入领域层。 |
| novel_agent | yes | 验收时给 DeepSeek adapter 注入外部 HTTP boundary，仍走生产 adapter。 |
| novel_application | no | 复用现有 provider 公开入口。 |
| novel_persistence | no | secret 不写 DB。 |
| novel_web | yes | Phoenix `filter_parameters` 过滤 `api_key` / `apiKey` / `authorization` / `secret`。 |
| frontend | yes | 模型设置 Dialog 输入 Key、刷新模型、测试连接和保存。 |
| docs/design | yes | 回填 SU-01 B2/C3 局部闭环证据和未闭环限制。 |
| quality | yes | 新增 scenario manifest 和 Tauri verifier 入口。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 核查 SU-01 B2/C3 当前实现和验收边界 | done | 当前外部 driver 不证明 Tauri WebView Keychain。 |
| T2 | 补 DeepSeek adapter HTTP boundary 验收路径 | done | `SLICE_VERIFY_DEEPSEEK_HTTP_FIXTURE=1` 只在外部 harness 注入。 |
| T3 | 修复后端日志 secret 泄漏 | done | Phoenix `filter_parameters` 补 `api_key` / `apiKey` / `authorization` / `secret`。 |
| T4 | 补外部 Tauri driver、verifier 和 quality manifest | done | slice id：`su01-api-key-secret-redaction`。 |
| T5 | 回填 SU-01 / 蓝图 / README / task 文档 | done | 保持 Keychain WebView 与跨平台 secret 策略为未闭环。 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh su01-api-key-secret-redaction`
- [ ] quality 场景入口：`bash scripts/quality_accept.sh su01-api-key-secret-redaction --surface tauri`（sandbox 内因 `Mix.PubSub :eperm` 失败；提升重跑被 Codex 用量限制拒绝；同一 Tauri runner 已由上一项和 task_done 证明通过）
- [x] 后端编译验证：`mix compile --warnings-as-errors`
- [x] 前端 verifier 局部验证：`pnpm --dir frontend test -- native-tauri-verifier.test.mjs`
- [x] quality manifest：`bash scripts/quality_manifest_check.sh`
- [x] 设计追溯：`bash scripts/check_design_trace.sh`
- [x] task_done manifest：`bash scripts/task_done.sh --slice su01-api-key-secret-redaction --skip-static-scan`
- [x] 静态扫描：`bash scripts/ai_static_scan.sh --top 10`（17/18 pass；剩余 gitleaks 为既有 `accepted_risk`，blocking=0）

## 6. 决策日志

- 2026-06-19 — 首次尝试 Keychain 端到端证明时发现当前 harness 驱动的是 browser-side workbench，不是 Tauri WebView；改为只登记 redaction checkpoint，Keychain WebView 证据保持 open。
- 2026-06-19 — DeepSeek 模型列表使用外部 HTTP boundary fixture 注入生产 adapter；不新增 production fake provider，也不让产品代码感知 slice id。
- 2026-06-19 — Phoenix backend log 默认会打印 request params；已把 API Key 相关字段加入全局过滤，避免普通 debug log 泄漏 secret。
- 2026-06-19 — `quality_accept` 正式入口在 sandbox 内因 Mix PubSub TCP socket 权限失败；直接 `tauri_slice_verify` 与 task_done runner 均通过，等待可提升环境后可补跑该入口。

## 7. 试行反馈

- Tauri slice driver 必须区分“原生 app 已启动”和“Playwright 实际驱动的页面是否是 Tauri WebView”。后续 Keychain 验收需要能直接驱动或观测 Tauri WebView，而不是浏览器 fallback。
