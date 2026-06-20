# SU01 File Level Closure

- 状态：file-level deliverable / platform smoke artifact matrix added / external page evidence pending
- 类型：Acceptance Slice / System Slice / Quality Slice
- 启动日期：2026-06-19

## 1. 用户 / 系统目标

按 `docs/design/acceptance/system/SU-01-model-provider.md` 的完整文件级口径，把模型供应商管理推进到可交付状态，而不是只完成一个 checkpoint 后跳到 SU-02。

当前结论：SU-01 在当前 macOS 本机达到文件级可交付状态，可以进入 SU-02。8/10 场景已验收；`SC-SU01-C3` 已实现未验收，但剩余 Windows/Linux 真实页面证据仍是外部平台 blocker；本轮已新增 `.github/workflows/ci.yml` 的三平台 Tauri Rust smoke matrix，作为 Windows/Linux/macOS runner 入口，用于在真实平台执行 `frontend/src-tauri` contract tests，并上传 `tauri-platform-smoke-<os>` summary artifact。`SC-SU01-B3` 仍为 P1 部分实现，后续补 live vendor / 云端供应商真实失败矩阵。`SC-SU01-B4` 已由 `su01-provider-test-failure-ui` 证明测试连接失败反馈、草稿保留、无 turn/runtime 副作用和恢复成功。

## 2. 开工检查

- Contract: `docs/design/acceptance/SCENARIO-BLUEPRINT.md` 的 SU-01 条目；`docs/design/acceptance/system/SU-01-model-provider.md`；`docs/design/tech-stack/05-desktop.md` 桌面/secret 存储口径；`frontend/src-tauri/src/lib.rs` secret storage capability command；`scripts/tauri_slice_verify.sh` native Tauri WebView 与模型设置验收入口。
- Invariant: 没有外部自动化驱动真实页面证据时不能标“已验收”；API Key 不进入普通 UI、provider options response、业务日志、backend log 或项目文件；测试连接失败不得保存/切换 runtime 或创建 turn；产品代码不得新增验收感知逻辑。
- Boundary: 本 slice 修改验收脚本、native verifier、Tauri macOS Keychain 写入实现、Tauri secret storage capability、前端模型设置 UI、acceptance / task / ledger 记录；`su01-provider-test-failure-ui` 只补外部 driver 和 manifest，不修改 provider runtime，不新增产品验收感知逻辑。
- Consumer: 第一个真实消费者是 `WorkspaceChat` 模型设置 Dialog；决策消费者是 acceptance README / SCENARIO-BLUEPRINT / project ledger。
- Proof: `bash scripts/tauri_slice_verify.sh --list`；`bash scripts/tauri_slice_verify.sh su01-keychain-webview-capability`；`bash scripts/tauri_slice_verify.sh su01-keychain-webview-roundtrip`；`bash scripts/tauri_slice_verify.sh su01-provider-test-failure-ui`；`artifacts/slice-verify/su01-keychain-webview-roundtrip-tauri/summary.json`；`artifacts/slice-verify/su01-provider-test-failure-ui-tauri/summary.json`；Rust `cargo test`；frontend modelProvider test；native verifier test；quality manifest check；`.github/workflows/ci.yml` 的 `tauri-platform-smoke` matrix 与 uploaded summary artifact；静态扫描。
- Acceptance Driver: `scripts/tauri_slice_verify.sh su01-keychain-webview-roundtrip` 使用外部 macOS CGEvent/Accessibility driver 驱动真实 Tauri WebView；`scripts/tauri_slice_verify.sh su01-provider-test-failure-ui` 使用外部 Playwright driver 操作真实工作台模型设置 Dialog；产品代码新增验收感知逻辑：no。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改基础类型。 |
| novel_domain | no | provider secret 不进入领域层。 |
| novel_agent | no | 不改 provider runtime 或 fixture 边界。 |
| novel_application | no | 不改 application 入口。 |
| novel_persistence | no | 不涉及 DB。 |
| novel_web | no | 不改 controller/channel。 |
| frontend | yes | Tauri macOS Keychain 写入改为 Security.framework，避免 `security -w <secret>` 进程参数泄漏和 SecurityAgent 卡死；新增 secret storage capability command；工作台模型设置在 unsupported capability 下禁用 API Key 输入/清除并显示集中管理文案。 |
| scripts | yes | 在既有 `tauri_slice_verify.sh` 下新增/启用 `su01-keychain-webview-roundtrip` 两阶段 driver，保存后重启 Tauri 验证读回。 |
| docs/design | yes | 回填 SU-01 文件级对账矩阵和退出判断。 |
| tasks | yes | 登记本文件和索引，提供恢复路径。 |
| quality | yes | 新增 `quality/acceptance/scenarios/su01-keychain-webview-roundtrip.yml` 与 `su01-provider-test-failure-ui.yml` 并登记到 manifest。 |
| CI | yes | 新增 `tauri-platform-smoke` job，在 macOS / Ubuntu / Windows runner 执行 `frontend/src-tauri` 的 Rust contract tests，并上传 platform smoke `summary.json`；该入口只证明平台编译和 capability 分支合同，不替代真实页面验收。 |

## 4. 场景对账结论

| 场景 | 状态 | 证据 | 剩余缺口 | 优先级 |
|---|---|---|---|---|
| SC-SU01-A1 | 已验收 | `su01-provider-health-model`、`su01-lmstudio-disconnected-health` | 完整失败矩阵 | P1 |
| SC-SU01-A2 | 已验收 | `su01-provider-health-model`、`su01-model-provider-switching` | 非 Stub provider 切换矩阵 | P1 |
| SC-SU01-A3 | 已验收 | `su01-lmstudio-disconnected-health` | 启停/timeout/错误返回矩阵 | P1 |
| SC-SU01-B1 | 已验收 | `su01-model-provider-switching` | DeepSeek/Anthropic/LM Studio 保存矩阵 | P1 |
| SC-SU01-B2 | 已验收 | `su01-api-key-secret-redaction`；`su01-keychain-webview-roundtrip` | 非 macOS 平台矩阵归入 C3 | P1 |
| SC-SU01-B3 | 部分实现 | `su01-provider-endpoint-validation`、`su01-provider-model-list-success` | live vendor / 云端供应商真实失败矩阵 | P1 |
| SC-SU01-B4 | 已验收 | `su01-model-provider-switching`、`su01-provider-endpoint-validation`、`su01-provider-test-failure-ui` | live vendor 错误矩阵归入 B3 后续 | P1 |
| SC-SU01-C1 | 已验收 | `su01-model-provider-switching` | 非 Stub provider 矩阵 | P1 |
| SC-SU01-C2 | 已验收 | `su01-model-provider-switching` | 长会话/历史恢复矩阵 | P2 |
| SC-SU01-C3 | 已实现未验收 | `su01-api-key-secret-redaction`；`su01-keychain-webview-roundtrip`；Rust secret storage capability 测试；frontend unsupported capability helper 测试；`tauri-platform-smoke` CI matrix 与 summary artifact 入口 | `SU01-C3-non-macOS-platform-runner` 外部平台 blocker：缺 Windows/Linux 真实页面执行证据；CI 平台 smoke 需远端 runner 产出结果 | P0 blocker |

## 5. 当前完成计划

| # | Checkpoint | Status | 退出条件 |
|---|---|---|---|
| CP1 | 文件级审计矩阵与状态枚举收敛 | done | SU-01 文档使用允许状态；README / BLUEPRINT / ledger 同步。 |
| CP2A | Keychain WebView native 自动化能力探针 | done | `bash scripts/tauri_slice_verify.sh su01-keychain-webview-capability` 生成历史能力探针 summary，明确 Tauri CLI / tauri-driver / System Events 路径不可用，转向 CGEvent/Accessibility driver。 |
| CP2 | Keychain WebView 端到端验收能力 | done | `su01-keychain-webview-roundtrip` 从真实 Tauri WebView 打开模型设置、输入 fake Key、保存、重启后读回 `api_key_configured=true`，并证明 secret 不进 UI/日志/项目文件。 |
| CP3 | 跨平台 secret 产品口径 | done / platform smoke artifact matrix added / page evidence pending | 已明确非 macOS 当前行为：unsupported capability + 禁用 API Key 输入/清除 + 用户可理解提示；不得 silent fallback 到浏览器或明文文件。本轮新增三平台 Tauri Rust smoke CI 入口，用真实 Windows/Linux/macOS runner 执行 capability contract tests，并上传 summary artifact；仍缺 Windows/Linux 真实 Tauri 页面或后续 Stronghold/Credential Manager/Secret Service 实现证据。 |
| CP4A | 测试连接失败反馈与恢复 | done | `su01-provider-test-failure-ui` 证明不可达 LM Studio endpoint 显示作者可读失败，Dialog/草稿保留，测试连接不创建 turn 或切换 runtime，修正 endpoint 后可恢复。 |
| CP4B | live vendor / 平台矩阵 | follow-up | live vendor 错误、云端账号/权限失败、Windows/Linux Tauri secret storage 页面证据；平台 smoke runner 与 summary artifact 入口已补，仍需要远端 CI 结果和真实页面 driver，不阻塞当前 macOS 文件级收口。 |

## 6. Native 自动化路径说明

既有 `scripts/tauri_slice_verify.sh` 会启动原生 Tauri 窗口，但通用 `drive_external_ui` 调用 `frontend/slice-verify/external-ui-driver.mjs`，后者通过 Playwright Chromium 打开 `http://127.0.0.1:<vite-port>`。因此通用 browser-side driver 能证明真实工作台 DOM 和后端主链，但不能证明 Tauri WebView 环境中的 `isTauri=true`、`@tauri-apps/api/core.invoke` 和 macOS Keychain command。

已检查当前仓库和本机可用工具：Tauri CLI 2.10.1 没有 `driver` 子命令；用户同意后已安装 `tauri-driver` 2.0.6，但该二进制在 macOS 返回 `tauri-driver is not supported on this platform`，上游源码也只启用 Linux / Windows target，README 将 macOS Appium Mac2 路径标为 Todo。本机有 `safaridriver` 和 `security`，但 `safaridriver` 不能直接控制 Tauri WebView；Swift AX 当前为 trusted，但 `System Events` 在 runner 中超时，且 AX 审计只能看到 Tauri 窗口 chrome，未暴露 WebView DOM 语义。不能把 browser-side 结论包装成 Keychain WebView 证据。

`su01-keychain-webview-capability` 本轮结论：

- artifact: `artifacts/slice-verify/su01-keychain-webview-capability-tauri/summary.json`
- status: `blocked`
- `can_verify_keychain_webview_roundtrip=false`
- `tauri_cli_driver_available=false`
- `tauri_driver_binary_found=true`
- `tauri_driver_binary_available=false`
- `tauri_driver_platform_supported=false`
- `system_events_responsive=false`
- `swift_ax_trusted=true`
- `safaridriver_available=true` 但 `safaridriver_usable_for_tauri_webview=false`
- `security_cli_available=true`

本轮已在 `su01-keychain-webview-roundtrip` 中采用外部 macOS CGEvent/Accessibility driver 绕过 `tauri-driver` macOS 不支持的限制：保存阶段驱动真实 Tauri WebView，读回阶段重启 Tauri 验证新 WebView 从 Tauri 偏好 + Keychain 恢复 provider runtime。runner 在隔离 HOME 内创建临时 macOS Keychain，不污染真实用户 Keychain。`su01-keychain-webview-capability` 保留为历史能力探针，不再代表当前 Keychain WebView blocker。

## 7. 验证记录

- [x] `bash scripts/tauri_slice_verify.sh --list`
- [x] `bash scripts/tauri_slice_verify.sh su01-keychain-webview-capability`（生成历史能力探针 summary；不是验收证据）
- [x] `bash scripts/tauri_slice_verify.sh su01-keychain-webview-roundtrip`
- [x] `artifacts/slice-verify/su01-keychain-webview-roundtrip-tauri/summary.json`
- [x] `bash scripts/tauri_slice_verify.sh su01-provider-test-failure-ui`
- [x] `artifacts/slice-verify/su01-provider-test-failure-ui-tauri/summary.json`
- [x] `cd frontend/src-tauri && cargo test`
- [x] `cd frontend/src-tauri && cargo test --locked`（本轮三平台 smoke matrix 的本机合同验证）
- [x] `.github/workflows/ci.yml` 的 `tauri-platform-smoke` job 会上传 `tauri-platform-smoke-<os>/summary.json`（远端 runner 结果待 CI 产出；summary 显式 `real_page_acceptance=false`）
- [x] `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/ci.yml")'`
- [x] `pnpm --dir frontend exec vitest run src/lib/__tests__/modelProvider.test.ts`
- [x] `pnpm --dir frontend typecheck`
- [x] `pnpm --dir frontend lint`
- [x] `pnpm --dir frontend test`
- [x] `pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] 查看 `artifacts/slice-verify/su01-*/summary.json`
- [x] 审计 `scripts/tauri_slice_verify.sh` / `frontend/slice-verify/external-ui-driver.mjs`
- [x] `bash scripts/quality_manifest_check.sh`（通过；`su01-keychain-webview-roundtrip` / `su01-provider-test-failure-ui` manifest 已登记；`tauri-platform-smoke` 不登记为 scenario manifest，因为它是 CI 平台合同证据入口，不是外部自动化驱动真实页面的场景验收；剩余 warning 均为既有其它 slice 缺 manifest）
- [x] `bash scripts/task_done.sh --skip-static-scan --slice su01-keychain-webview-roundtrip`（`artifacts/task-done/20260619T151655Z/manifest.json`）
- [x] `bash scripts/task_done.sh --skip-static-scan`（`artifacts/task-done/20260619T153455Z/manifest.json`）
- [x] `bash scripts/task_done.sh --skip-static-scan --slice su01-provider-test-failure-ui`（`artifacts/task-done/20260619T174608Z/manifest.json`）
- [x] `bash scripts/task_done.sh --skip-static-scan --slice su01-keychain-webview-roundtrip`（`artifacts/task-done/20260620T051101Z/manifest.json`）
- [x] `bash scripts/task_done.sh --skip-static-scan --slice su01-keychain-webview-roundtrip`（`artifacts/task-done/20260620T052106Z/manifest.json`）
- [x] `bash scripts/ai_static_scan.sh --top 10`（17/18 pass；剩余 gitleaks 为既有 `accepted_risk`，blocking=0，0 touched-file finding；latest `artifacts/static-scan/top10.md` generated 2026-06-20T06:12:19Z）

## 8. 决策日志

- 2026-06-19 — 按新的文件级闭环目标重新审计 SU-01，不再沿用“一个 checkpoint 后跳到下个文件”的旧约束。
- 2026-06-19 — 初始审计阶段先下调 B4 状态，因缺失败反馈矩阵不再计入已验收；随后由 `su01-keychain-webview-roundtrip` 补回 B2 的真实 Tauri WebView Keychain 证据。
- 2026-06-19 — Keychain WebView 端到端一度是 P0 blocker；当时不能进入 SU-02 的剩余 P0 收敛为非 macOS 真实页面 / 平台矩阵。
- 2026-06-19 — 新增 `su01-keychain-webview-capability` runner 级探针；用户同意后安装 `tauri-driver` 2.0.6 并复跑，确认 Tauri CLI 无 driver 子命令、`tauri-driver` 在 macOS 不支持、System Events 超时，Swift AX 虽 trusted 但未形成可操作 WebView DOM 的稳定驱动；该探针只登记 blocker，不构成验收 evidence。
- 2026-06-19 — 新增 `su01-keychain-webview-roundtrip` 两阶段真实 Tauri 验收：第一阶段保存 fake DeepSeek Key 到 macOS Keychain 并 reset backend runtime，第二阶段重启 Tauri 后由新 WebView 从 Tauri 偏好 + Keychain 读回并恢复 DeepSeek runtime；同时修复生产 Tauri macOS Keychain 写入不再通过 `security -w <secret>` 暴露进程参数。
- 2026-06-19 — SU-01 当前文件级对账一度更新为 7/10 已验收、3/10 部分实现；B2 的 macOS Keychain WebView 写读已关闭，随后 C3 非 macOS 产品口径推进为已实现未验收。
- 2026-06-19 — 补 `quality/acceptance/scenarios/su01-keychain-webview-roundtrip.yml` 并接入 `quality/acceptance/scenarios.yml`，将本 checkpoint 纳入质量运行体系。
- 2026-06-19 — 新增 Tauri secret storage capability command 和工作台消费：macOS 报告 `macos_keychain` 可用，非 macOS 报告 `unsupported`，工作台在 unsupported capability 下禁用 API Key 输入/清除并提示使用 macOS、后端环境 Key 或本地 LM Studio；该产品口径关闭“缺明确口径”，但不等同非 macOS 真实页面验收。
- 2026-06-20 — 新增 `su01-provider-test-failure-ui`：真实工作台模型设置 Dialog 在不可达 LM Studio endpoint 下显示“LM Studio 未启动”，Dialog 和 provider/endpoint 草稿保留，测试连接不创建 turn、不保存或切换 runtime，修正 endpoint 后测试成功。B4 从“部分实现”更新为“已验收”。
- 2026-06-20 — `SC-SU01-C3` 剩余 Windows/Linux 真实页面 / 平台矩阵登记为外部平台 blocker；当前 macOS 本机不伪造非 macOS 证据，SU-01 文件级可交付并可进入 SU-02。
- 2026-06-20 — 为 `SU01-C3-non-macOS-platform-runner` 补最小基础设施入口：`.github/workflows/ci.yml` 新增 `tauri-platform-smoke` matrix，在 macOS / Ubuntu / Windows runner 执行 `frontend/src-tauri` 的 `cargo test --locked`，并上传 `tauri-platform-smoke-<os>` artifact；summary 记录 runner、命令、exit code、Rust/Cargo 版本和 `real_page_acceptance=false`。该入口用于证明 Tauri Rust 壳和 secret capability 平台分支在真实平台可编译并执行 contract tests；这不是真实页面自动化验收，C3 仍保持“已实现未验收”。
- 2026-06-20 — 复核 quality acceptance manifest 边界：当前 `quality/acceptance/scenarios.yml` 只登记 `browser` / `tauri` surface 下由 `slice_verify` / `tauri_slice_verify` / `dogfood_run` 驱动的场景验收。`tauri-platform-smoke` 是 CI matrix 合同证据入口，summary 显式 `real_page_acceptance=false`；因此本轮不扩展 quality manifest schema，也不把平台 smoke 冒充为真实页面 scenario。后续若要把 Windows/Linux 页面对账纳入 quality manifest，应先实现对应平台真实 Tauri 页面 driver 或跨平台 secret backend 的场景入口。

## 9. 试行反馈

- 后续如果引入 `tauri-driver`、Appium、系统 UI 自动化或其它 native WebView driver，必须先确认不会向生产代码加入验收专用 hook，也不能把 fixture provider 注册进 production runtime；安装或全局配置变更需要用户明确许可。
