# SU-01 切换模型供应商

> 系统用户视角：我可以选择用哪个大模型来驱动 AI 创作助手，切换 DeepSeek / Anthropic / 本地 LM Studio / 测试 Stub 等供应商，配置各自的 API Key、模型和端点，并确认连接是否正常。
>
> 场景化验收口径：本文按完整功能蓝图验收“模型供应商管理”，不把已有健康检查误判为完整供应商切换。
>
> 2026-05-20 对账结论：`GET /api/provider/health` 已补齐 provider/model 契约。Provider metadata 由 `NovelAgent.Provider.Gateway` 从当前 adapter 配置统一读取，`NovelApplication.provider_health/0` 在 connected/disconnected 两种结果中都保留 provider/model，`NovelWeb.ProviderController` 不再把断开状态折叠成 `unknown`。真实 `WorkspaceChat` 消费统一前端 health helper，状态徽标可展示后端返回的模型名或 provider 名；新增原生 Tauri 验证 `su01-provider-health-model` 从真实工作台启动、等待 health 轮询、上报 LLM 徽标文本并证明显示 `slice_verify`。这只关闭 health 可见性 checkpoint，不代表 provider 列表、运行时切换、Key/endpoint 设置或安全存储已实现。历史旁路 `历史旁路工作台` 已退役删除，不再作为当前证据。
>
> 2026-06-12 对账结论：Gateway 已新增 `deepseek` adapter，配置来源为 `NOVEL_DEEPSEEK_API_KEY` / `DEEPSEEK_API_KEY`、`NOVEL_DEEPSEEK_MODEL`、`NOVEL_DEEPSEEK_ENDPOINT`，默认模型 `deepseek-v4-flash`，默认非 thinking 模式。该变更只扩展后端 provider registry 和 env/config 接入，不代表 SU-01 的 provider 列表 UI、运行时切换、安全存储或真实页面验收已完成。
>
> 2026-06-12 完整版模型切换实现进展：`Gateway` 已提供 `provider_options/provider_models/configure_provider/test_provider` 运行时 API，`NovelWeb.ProviderController` 暴露 `/api/provider/options`、`POST /api/provider/models`、`PUT /api/provider/config`、`POST /api/provider/test`，`WorkspaceChat` 顶栏新增“模型设置”入口，可查看后端 provider registry、配置 endpoint/API Key、实时刷新并选择供应商模型、DeepSeek thinking/reasoning effort、手动测试连接并保存切换；模型名不再由作者手输，也不由前端预制写死，DeepSeek/Anthropic/LM Studio 分别经供应商模型列表 API 拉取。Tauri 桌面侧将非 secret 偏好写入 profile-scoped app config，API Key 写入 profile-scoped macOS Keychain service，后端运行时只保留当前进程配置；本轮修复了前端 camelCase payload 与 Rust snake_case struct 不匹配导致的保存失败，并以 Rust 单测锁定。新增外部自动化 `su01-model-provider-switching` 已从真实工作台打开设置、切换到 Stub、测试连接、保存、发送下一轮，并用 `provider_gateway.complete.done provider=stub` 业务日志证明下一轮确实走新 provider 且对话保留。当时仍不能标 SU-01 全量完成：DeepSeek/API Key/endpoint 的真实桌面矩阵、LM Studio 断开态、Keychain 端到端和非 macOS secret 策略仍未闭环。
>
> 2026-06-19 对账结论：`su01-lmstudio-disconnected-health` 已补最小真实 Tauri 验收。外部 driver 通过公开 provider config API 将运行时 provider 配为不可达 LM Studio endpoint，刷新真实工作台后，顶栏模型状态可见显示 `LM Studio · missing-local-model · 模型未连接`，health/title 中包含作者可理解原因 `LLM 未连接：LM Studio 未启动`。`LMStudio.health_check/1` 已将 connection refused / timeout 映射成用户可读文案。该证据关闭 LM Studio 未启动断开态最小闭环；SU-01 全量仍缺云端 API Key/endpoint、DeepSeek/Anthropic/LM Studio 失败矩阵、Keychain 端到端和非 macOS secret 策略。
>
> 2026-06-19 对账结论：`su01-provider-endpoint-validation` 已补 `SC-SU01-B3` 的 endpoint URL 校验 checkpoint。`Gateway.configure_provider/1`、`Gateway.test_provider/1`、`Gateway.provider_models/1` 均拒绝非绝对 `http(s)` URL，`ProviderController` 对 config/models/test 三个入口返回 422 和用户可读原因；`WorkspaceChat` 模型设置 Dialog 在输入非法 endpoint 时显示“端点必须是完整的 http(s) URL。”并禁用刷新模型、测试连接、保存切换。外部 Tauri driver 从真实工作台打开模型设置、选择 LM Studio、输入 `localhost:1234/v1`，证明错误可见且没有携带该非法 endpoint 的 `/api/provider/models` 请求。该证据只关闭 URL 校验 checkpoint，不代表供应商实时模型列表成功矩阵、云端 Keychain 端到端或跨平台 secret 策略完成。
>
> 2026-06-19 对账结论：`su01-api-key-secret-redaction` 已补 `SC-SU01-B2/C3` 的 secret redaction checkpoint。外部 driver 从真实工作台打开模型设置、选择 DeepSeek、输入 fake API Key，经生产 DeepSeek adapter 的 harnessed HTTP boundary 拉取模型列表并测试连接，保存后证明 provider options 只返回 `api_key_configured=true` 而不回传 secret，浏览器 fallback settings、可见 UI、业务 JSONL 和 Phoenix backend log 都不包含该 fake Key。本 checkpoint 只证明 API Key 配置流的脱敏边界和日志过滤；当前 driver 驱动的是 browser-side workbench，不是 Tauri WebView，因此不证明 macOS Keychain 写入/读回，也不关闭跨平台 secret 策略。
>
> 2026-06-19 对账结论：`su01-provider-model-list-success` 已补 `SC-SU01-B3` 的供应商实时模型列表成功 checkpoint。外部 driver 从真实工作台打开模型设置，DeepSeek / Anthropic 经生产 adapter 的 harnessed HTTP boundary 拉取模型列表，LM Studio 经外部 driver 启动的 OpenAI-compatible `/v1/models` endpoint 拉取模型列表，并证明三类 provider 返回的模型都能在可见 Dialog 中选择。该证据证明 UI → ProviderController → Gateway → adapter models boundary 的成功管线，不证明 live vendor 账号可用，也不关闭云端/本地失败矩阵、Keychain WebView 或跨平台 secret 策略。
>
> 2026-06-19 对账结论：`su01-keychain-webview-roundtrip` 已补 `SC-SU01-B2/C3` 的 macOS Tauri WebView Keychain 端到端证据。外部 macOS CGEvent/Accessibility driver 从真实 Tauri WebView 打开模型设置、选择 DeepSeek、输入 fake API Key、保存；runner 在隔离 HOME 内创建临时 macOS Keychain，产品 Tauri command 通过 Security.framework 写入 Keychain，非 secret 偏好写 profile-scoped app config；随后外部脚本重启 Tauri，新的 WebView 从 Tauri 偏好 + Keychain 读回并自动 `PUT /api/provider/config` 恢复 DeepSeek runtime。证据 `artifacts/slice-verify/su01-keychain-webview-roundtrip-tauri/summary.json` 证明 Keychain item 存在、provider options 只返回 `api_key_configured=true`、偏好文件/UI/业务日志/backend log 不包含 fake Key，且未新增产品验收 hook。该 checkpoint 不读取明文 Keychain secret 作为证据，避免触发 macOS SecurityAgent；读回由真实 WebView 重启恢复链路证明。非 macOS 真实页面 / 平台矩阵仍未闭环。
>
> 2026-06-19 对账结论：`SU01-cross-platform-secret-policy` 已补非 macOS secret 的产品口径基础设施。Tauri 新增真实产品 command `get_model_provider_secret_storage_status`：macOS 返回 `available=true/kind=macos_keychain`，非 macOS 返回 `available=false/kind=unsupported`；`WorkspaceChat` 在不支持安全存储的桌面壳中禁用 API Key 输入/清除，并显示“当前系统暂不支持从桌面安全保存 API Key；请使用 macOS 配置 Key，或使用已在后端环境中配置的 Key / 本地 LM Studio。” 该口径避免把云端 Key silent fallback 到浏览器、本地明文文件或 production runtime fixture。当前 macOS 本机只能以 Rust/TypeScript 局部测试证明该产品口径与 macOS capability；非 macOS 真实页面外部自动化仍需 Windows/Linux Tauri runner 或后续 Stronghold/Credential Manager/Secret Service 实现，因此 C3 仍不能标“已验收”。
>
> 2026-06-20 对账结论：`su01-provider-test-failure-ui` 已补 `SC-SU01-B4` 的测试连接失败与恢复 checkpoint。外部 driver 从真实工作台打开模型设置、选择 LM Studio、先通过 OpenAI-compatible `/v1/models` fixture 加载并选择模型，再把 endpoint 改为不可达地址并点击“测试连接”；页面显示作者可理解原因“LM Studio 未启动”，Dialog 保持打开，provider/endpoint 草稿保留，且测试连接不创建 turn、不保存或切换 runtime。随后恢复 endpoint 再次测试成功，证明作者可以不刷新页面修正配置。该证据关闭 B4 的真实页面失败反馈与恢复缺口；live vendor 账号、云端供应商真实错误矩阵仍作为 B3/P1 后续矩阵，不阻塞当前 macOS 文件级收口。
>
> 2026-06-20 对账结论：为 `SU01-C3-non-macOS-platform-runner` 补最小基础设施入口。`.github/workflows/ci.yml` 新增 `tauri-platform-smoke` matrix，在 macOS / Ubuntu / Windows runner 执行 `frontend/src-tauri` 的 `cargo test --locked`，并上传 `tauri-platform-smoke-<os>` artifact，其中 `summary.json` 记录 runner、命令、exit code、Rust/Cargo 版本和 `real_page_acceptance=false`。该入口用于证明 Tauri Rust 壳和 secret storage capability 平台分支在真实平台可编译并执行 contract tests；它不驱动真实 Tauri 页面，也不实现 Windows Credential Manager / Linux Secret Service / Stronghold。因此 C3 仍是“已实现未验收”，剩余缺口是远端 CI 结果和 Windows/Linux 真实页面验收证据。
>
> 2026-06-22 对账结论（密钥存储简化，取代 macOS Keychain 机制）：经产品判断，本机单用户桌面工具阶段不需要 OS Keychain 级别的密钥托管——密钥是用户自己的 provider key、存在用户自己的机器上，真实风险是泄进 git/日志/备份（靠 `.gitignore` + 不打日志解决），而手写 `SecKeychain*` FFI 带来仅 macOS、依赖稳定代码签名、每次启动弹登录密码、跨平台 unsupported 分支等沉重成本。决策：删除 `frontend/src-tauri/src/lib.rs` 中全部 Keychain FFI，改为把 provider API Key 写入与 `preferences.json` 同目录、按 desktop profile 隔离的独立文件 `provider-secrets.json`（unix 权限 `0600`，明文）。后果：(1) 启动不再触发 macOS 钥匙串授权弹窗；(2) `get_model_provider_secret_storage_status` 在所有平台返回 `available=true / kind="local_file"`，**C3 的"非 macOS unsupported"产品口径与跨平台 blocker `SU01-C3-non-macOS-platform-runner` 随之消解**——所有桌面平台一致用本地受限文件；(3) 前端删除"存储不可用/unsupported"的禁用输入与提示分支（`providerApiKeyStorageUnavailable` / `modelProviderApiKeyStorageUnsupported` 等）。**保持不变的不变量**：SU-I3 仍成立（密钥不入 git、不回传 options、不进日志/UI/截图）。**被取代的证据**：`su01-keychain-webview-roundtrip`、`SU01-cross-platform-secret-policy` 中以 macOS Keychain 为机制的部分不再代表当前实现；其"重启后从本地持久化读回并恢复 runtime"的链路语义仍适用，只是后端从 Keychain 换成本地文件。**安全权衡明确登记**：密钥在本机以明文文件存储，安全边界等同于用户自己（与产品其余数据一致），这是 dev 阶段单用户桌面的有意取舍。Rust 侧以 `provider_secrets_round_trip_through_local_file` 与 `secret_file_is_written_with_owner_only_permissions`（0600）单测锁定；真实页面"保存→重启不弹密码→Key 仍生效"验收待补。
>
> 2026-06-22 二轮收口：`su01-local-secret-file-roundtrip` 已补当前实现的真实 Tauri WebView 验收。外部 macOS CGEvent/Accessibility driver 从真实 Tauri WebView 打开模型设置、选择 DeepSeek、输入 fake API Key、保存，验证隔离 desktop profile 下生成 `provider-secrets.json` 且 unix 权限为 `0600`；随后重置 backend runtime、重启 Tauri，新 WebView 从 `preferences.json` + `provider-secrets.json` 恢复 DeepSeek runtime，并证明 provider options 只返回 `api_key_configured=true`，偏好文件、可见 UI、业务 JSONL 和 backend log 不包含 fake Key。证据：`artifacts/slice-verify/su01-local-secret-file-roundtrip-tauri/summary.json`。因此 `SC-SU01-C3` 按当前 local-file 设计已验收；旧 Keychain 和 non-macOS unsupported blocker 只保留为历史机制，不再作为 SU-01 当前退出 blocker。`SC-SU01-B3` 的 live vendor / 云端供应商真实失败矩阵仍是 P1 后续，不在本轮用 harnessed HTTP 证据冒充 live vendor 可用性。
>
> 2026-06-24 对账结论（供应商矩阵扩展，来源用户反馈 15）：`su01-provider-vendor-matrix` 已把 `SC-SU01-B1` 的 provider 列表从 DeepSeek/Anthropic/LM Studio/Stub 扩展到 OpenAI（API Key）、OpenAI（订阅）、Minimax、智谱、Kimi、Gemini。后端新增 `NovelAgent.Provider.OpenAICompatible` 共享基类（`__using__` 宏）与 6 个薄 vendor adapter，统一 Bearer 鉴权、`/chat/completions`、`/models` 与错误归一；`Gateway.@provider_modules/@provider_descriptors` 注册新矩阵；`config/config.exs` 提供按 env 覆盖的默认 endpoint/model。OpenAI 的 API Key 与订阅以两个独立 vendor id 区分（独立 secret、独立 endpoint、独立 label、独立 redaction）。前端 `modelProvider.ts` 扩展 ProviderId 联合与归一化，模型设置 Dialog 从后端 registry 自动渲染新供应商（前端不写死），订阅认证方式有可见 hint；Rust `MODEL_PROVIDER_IDS` 扩展到 10 个 id 并以单测锁定两认证方式 secret 隔离。外部 Playwright driver 从真实 browser-side 工作台证明：6 个新供应商来自后端 registry、订阅 hint 可见、对不可达 endpoint 测试连接失败时 runtime 不切换且不创建 turn、保存后 provider options 把 `openai`/`openai_subscription` 列为两个独立 label 条目并只回传 `api_key_configured=true`，fake Key 不进入 options、可见 UI、浏览器 fallback settings、业务 JSONL 或 backend log。证据：`artifacts/slice-verify/su01-provider-vendor-matrix-tauri/summary.json`。**仍未闭环（登记为 `SC-SU01-B3` P1 后续，与既有 live vendor 后续合并）**：① live vendor 真实云端账号/权限/错误矩阵（无真实账号，本轮不冒充）；② OpenAI 订阅 OAuth 登录与 ChatGPT backend 专用传输（需真实订阅账号 + 浏览器授权流程），CP1 仅建模订阅认证方式区分与离线脱敏/重启/test-fail 不变量。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 看当前 LLM 是否可用 | 状态栏显示检测中 / 已连接 / 未连接 |
| 看当前供应商和模型 | 显示 provider 名称、模型名和连接状态 |
| 切换到另一个供应商 | 下一轮对话使用新供应商，历史消息不丢 |
| 配置 API Key | Key 安全保存，不明文进入项目仓库 |
| 配置模型和端点 | 每个供应商可以独立设置 endpoint；模型从供应商实时列表选择 |
| 测试连接 | 点击后立即得到成功/失败反馈 |
| 本地使用 LM Studio | 默认指向 `http://localhost:1234/v1`，未启动时提示明确 |

明确不覆盖：

- 不覆盖云端供应商计费、额度、模型权限管理。
- 不覆盖团队共享配置。
- 不要求当前阶段支持所有商业供应商，但必须把“当前只支持配置默认 provider”表达清楚。

---

## 2. 不变量

| 编号 | 不变量 | 本验收如何验证 |
|---|---|---|
| SU-I1 | 连接状态必须来自后端真实 health check | SC-SU01-A1/A2：UI 轮询 `/api/provider/health`，后端走 `NovelApplication.provider_health/0` |
| SU-I2 | provider 选择必须经 application / agent gateway，不由 UI 直接调用 provider | SC-SU01-B1/C1：前端只提交配置或选择，实际调用仍走 Gateway |
| SU-I3 | API Key / endpoint 不应写入 git 管理的项目文件 | SC-SU01-B2/B3：非 secret 偏好进入 Tauri app data `preferences.json`，API Key 进入同 profile 的 `provider-secrets.json`（unix 0600，本机明文），并且不回传 options、不进 UI/日志/项目文件 |
| SU-I4 | 切换供应商不破坏已有对话和作品上下文 | SC-SU01-C2：历史消息保留，新 turn 使用新 provider |

---

## 3. 证据与契约

| 证据 / 契约 | 当前事实 | 影响 |
|---|---|---|
| `apps/novel_web/lib/novel_web/controllers/provider_controller.ex` | `GET /api/provider/health` 返回 `connected/provider/model/message/detail`；新增 provider options/models/config/test API | 后端 API 已能支撑设置 UI，但完整页面验收未闭环 |
| `apps/novel_application/lib/novel_application.ex` | `provider_health/options/models/configure/test` 均经 Application 层代理 | `novel_web` 不直接依赖 `novel_agent` |
| `apps/novel_agent/lib/novel_agent/provider/runtime_config.ex` | 保存当前进程的 provider 选择与运行时配置 | 持久化归桌面 shell，不落项目仓库 |
| `apps/novel_agent/lib/novel_agent/provider/gateway.ex` | 注册 `stub/lmstudio/anthropic/deepseek`，支持 registry、实时模型列表、health、运行时切换和连接测试；`clear_api_key` 不复用旧 runtime key | 后端最小切换闭环已实现并有单元/控制器测试 |
| `frontend/src/lib/modelProvider.ts` | 集中封装 provider options/models/config/test、Tauri 偏好、本地密钥文件同步、浏览器 fallback | 前端只调用后端 API，不直接调用 provider |
| `frontend/src-tauri/src/lib.rs` | 非 secret provider 偏好写 profile-scoped app config，API Key 写同目录的 profile-scoped `provider-secrets.json`（unix 0600）；保存 payload 支持前端 camelCase | dev/stage/slice verification 的 provider 选择与密钥互相隔离；所有桌面平台一致用本地受限文件，不再依赖 macOS Keychain |
| `frontend/src/components/WorkspaceChat.tsx` | 顶栏“模型设置”入口，支持选择 provider、endpoint、API Key、刷新/选择供应商实时模型、DeepSeek thinking/reasoning effort、测试连接、保存切换 | 作者可在真实工作台发起模型切换；`su01-model-provider-switching` 已覆盖 Stub 切换主路径 |
| `apps/novel_web/test/novel_web/controllers/provider_controller_test.exs` | 覆盖 options/models/config/test 和 secret 不泄漏 | 后端 Web 合同已测试 |
| `frontend/src/lib/__tests__/modelProvider.test.ts` | 覆盖前端 runtime payload、模型列表 payload/归一化、secret 不写 localStorage、clear key 合同 | 前端 client 合同已测试 |
| `config/*.exs` | env/config 仍支持默认 provider、endpoint、model | 作为启动默认值和部署配置保留 |

---

## 4. 场景化验收 Case

### 场景组 A：查看当前供应商状态

#### SC-SU01-A1 — 启动后看到 LLM 连接状态

| 字段 | 内容 |
|---|---|
| 用户视角 | 我启动应用后，能知道 LLM 当前是否可用 |
| 前置条件 | Phoenix / Tauri app 已启动 |
| 触发 | 打开工作台 |
| 期望结果 | 状态栏先显示检测中，随后显示已连接或未连接 |
| 不变量 | SU-I1 |
| 边界 | frontend → `/api/provider/health` → NovelWeb → NovelApplication → NovelAgent Gateway |
| 真实消费者 | WorkspaceChat 顶栏模型状态 |
| 当前证据 | 前端 30s 轮询；ProviderControllerTest 覆盖 connected/disconnected 和 provider/model metadata；`su01-provider-health-model` 与 `su01-lmstudio-disconnected-health` 覆盖真实工作台 connected/disconnected 徽标 |
| 当前状态 | 已验收 |
| 当前缺口 | 云端/本地失败矩阵和跨平台 secret 策略仍待后续 |
| 优先级 | P1 |

#### SC-SU01-A2 — 看到当前 provider 和模型名

| 字段 | 内容 |
|---|---|
| 用户视角 | 我能看到当前使用的是 LM Studio、Anthropic、DeepSeek 或 Stub，以及具体模型 |
| 触发 | health check 成功 |
| 期望结果 | UI 显示 provider + model，例如 `LM Studio · openai/gpt-oss-120b` |
| 当前证据 | 后端返回 `provider` + `model`；`WorkspaceChat` 徽标消费 `providerHealthName`；`su01-provider-health-model` 原生 Tauri 验证覆盖真实工作台徽标 |
| 当前状态 | 已验收 |
| 当前缺口 | DeepSeek/LM Studio 等非 Stub 切换矩阵仍待后续 |
| 缺口类型 | 补真实页面矩阵 |
| 优先级 | P1 |

#### SC-SU01-A3 — LM Studio 未启动时提示明确

| 字段 | 内容 |
|---|---|
| 用户视角 | 我本地使用 LM Studio，忘记启动时能看到明确提示 |
| 前置条件 | 默认 provider 为 lmstudio，LM Studio 未启动 |
| 期望结果 | health 返回 `connected=false`，UI 显示未连接和可理解原因 |
| 当前证据 | `LMStudio.health_check/1` 将 connection refused 映射为“LM Studio 未启动”、timeout 映射为“LM Studio 请求超时”；ProviderController 透出 `message/detail`；`WorkspaceChat` 顶栏可见显示 provider + `模型未连接`；`su01-lmstudio-disconnected-health` 已从真实 Tauri 工作台验证 |
| 当前状态 | 已验收 |
| 当前缺口 | 仍缺 endpoint 错误、返回乱码、真实 LM Studio 关闭/启动切换等异常矩阵 |
| 优先级 | P0 |

### 场景组 B：配置供应商

#### SC-SU01-B1 — 选择不同 provider

| 字段 | 内容 |
|---|---|
| 用户视角 | 我可以在设置中从 LM Studio 切换到 Anthropic、DeepSeek 或 Stub |
| 期望结果 | provider 列表来自后端 registry；切换后 health 和下一轮对话使用新 provider |
| 当前证据 | `GET /api/provider/options` 返回后端 registry；`WorkspaceChat` 模型设置弹窗消费该 API |
| 当前状态 | 已验收 |
| 缺口类型 | 补真实页面验收 |
| 优先级 | P0 |

#### SC-SU01-B2 — 配置 API Key

| 字段 | 内容 |
|---|---|
| 用户视角 | 我能给 Anthropic、DeepSeek 等云端 provider 配置 Key |
| 期望结果 | Key 默认隐藏，可测试连接，保存后不进入 git 管理目录 |
| 当前证据 | Tauri command 将 API Key 写入 profile-scoped `provider-secrets.json`（unix 0600），非 secret provider 偏好写同 profile 的 `preferences.json`；`get_model_provider_secret_storage_status` 在当前实现返回 `available=true/kind=local_file`；后端 options 不返回 secret；前端测试断言 secret 不写 browser fallback store；`su01-api-key-secret-redaction` 从真实工作台验证输入 fake Key 后 provider options、browser fallback settings、可见 UI、业务日志和后端日志均不泄漏 secret；`su01-local-secret-file-roundtrip` 从真实 Tauri WebView 保存 fake Key，重启后从 Tauri 偏好 + `provider-secrets.json` 读回并恢复 DeepSeek runtime |
| 当前状态 | 已验收 |
| 缺口类型 | live vendor / 云端供应商真实失败矩阵归入 B3 后续；旧 Keychain / non-macOS unsupported 机制不再是当前缺口 |
| 优先级 | P1 |

#### SC-SU01-B3 — 配置 endpoint 并从供应商实时模型列表选择 model

| 字段 | 内容 |
|---|---|
| 用户视角 | 我可以把 LM Studio endpoint 指向本地 `localhost:1234/v1` 或自定义端点，并从供应商当前可用模型中选择 |
| 期望结果 | 每个 provider 有独立 endpoint；模型列表来自供应商实时 API，不手输、不前端写死；非法 URL 有校验 |
| 当前证据 | `POST /api/provider/models` 经 Gateway 调 DeepSeek `/models`、Anthropic `/v1/models`、LM Studio `/v1/models`；设置弹窗在 endpoint/API Key 之后刷新并选择模型；真实 provider 未加载到模型列表时禁用保存 |
| 当前证据补充 | `su01-provider-endpoint-validation` 已从真实 Tauri 工作台证明非法 endpoint 可见报错、刷新/测试/保存禁用，且不会触发携带非法 endpoint 的 provider models 请求；`su01-provider-model-list-success` 已证明 DeepSeek / Anthropic / LM Studio 三类 provider 模型列表成功返回后可在 Dialog 中选择；`su01-provider-vendor-matrix` 已把矩阵扩展到 OpenAI（API Key/订阅）、Minimax、智谱、Kimi、Gemini，并证明新供应商来自后端 registry、可配 endpoint、经本地 OpenAI 兼容 `/models` 选模型、test-fail 不切换 runtime、保存后脱敏 |
| 当前状态 | 部分实现 |
| 缺口类型 | 补 live vendor / 云端真实失败矩阵；OpenAI 订阅 OAuth 登录传输 |
| 优先级 | P1 |

#### SC-SU01-B4 — 手动测试连接

| 字段 | 内容 |
|---|---|
| 用户视角 | 我改完 Key 或 endpoint 后，点击按钮立即知道能不能用 |
| 期望结果 | 显示检测中；成功显示 provider/model；失败保留配置并显示原因 |
| 当前证据 | `POST /api/provider/test` 用传入配置构建 adapter state，不改变当前 runtime provider；设置弹窗有测试连接按钮 |
| 当前证据补充 | `su01-model-provider-switching` 覆盖成功；`su01-provider-endpoint-validation` 覆盖非法输入阻断；`su01-provider-test-failure-ui` 覆盖不可达 endpoint 失败、草稿保留、无 turn/runtime 副作用和恢复成功 |
| 当前状态 | 已验收 |
| 缺口类型 | live vendor / 云端供应商真实错误矩阵归入 B3 后续 |
| 优先级 | P1 |

### 场景组 C：切换后的行为

#### SC-SU01-C1 — 切换后下一轮对话用新 provider

| 字段 | 内容 |
|---|---|
| 用户视角 | 我切换 provider 后，新发送的一轮消息用新模型回复 |
| 期望结果 | Gateway 用新 provider 发起 complete；trace/log 可看出 provider |
| 当前证据 | `RuntimeConfig` 覆盖默认 provider；`Gateway.complete/3` 已按 runtime provider 路由；测试覆盖切换到 DeepSeek 后 complete 走 DeepSeek adapter |
| 当前状态 | 已验收 |
| 缺口类型 | 补真实页面验收 + 补 provider/model trace |
| 优先级 | P0 |

#### SC-SU01-C2 — 切换 provider 不丢对话

| 字段 | 内容 |
|---|---|
| 用户视角 | 我切换模型后，当前作品和历史消息仍保留 |
| 期望结果 | 历史 TurnResult 不丢；新 turn 可标记 provider/model |
| 当前证据 | 模型设置作为顶栏 Dialog，不重置 `WorkspaceChat` 消息、作品或 Channel；保存后只刷新 health |
| 当前状态 | 已验收 |
| 缺口类型 | 补真实页面验收 |
| 优先级 | P1 |

#### SC-SU01-C3 — 配置安全存储

| 字段 | 内容 |
|---|---|
| 用户视角 | 我的 API Key 和 provider 偏好不会被提交到项目仓库 |
| 期望结果 | 配置落在 profile-scoped Tauri app data：非 secret 偏好在 `preferences.json`，API Key 在同 profile 的 `provider-secrets.json`（unix 0600），且不进入仓库、options、UI 或日志 |
| 当前证据 | Tauri app config 保存非 secret 偏好；`provider-secrets.json` 保存 API Key；二者均按 `AI_NOVEL_DESKTOP_PROFILE` 隔离（dev/stage/slice-verify 默认不同 profile）；后端 runtime config 进程内保存，不写仓库文件；Tauri secret storage capability command 返回 `available=true/kind=local_file`；`su01-api-key-secret-redaction` 证明 fake Key 不进入 options response、browser fallback settings、可见 UI、业务 JSONL 或 Phoenix backend log；`su01-local-secret-file-roundtrip` 证明真实 Tauri WebView 保存后重启读回本地 secret 文件，并且 fake Key 不进入偏好文件、provider options、业务日志或 backend log |
| 当前状态 | 已验收 |
| 缺口类型 | 后续平台回归矩阵 / secret backend 安全策略强化，不阻塞当前 local-file 设计 |
| 优先级 | P2 |

---

## 5. 场景覆盖状态

### 5.1 文件级对账矩阵（2026-06-22）

| 场景 ID / 名称 | 设计期望 | Contract / Invariant | 相关实现入口 | 局部测试证据 | 真实页面外部自动化验收证据 | 当前状态 | 设计偏差 | 缺口类型 | 优先级 | 建议 checkpoint / slice |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-SU01-A1 启动后看到 LLM 连接状态 | 启动后知道 LLM 是否可用 | SU-I1；`GET /api/provider/health` | `ProviderController.health/2`；`NovelApplication.provider_health/0`；`Gateway.health_check/0`；`WorkspaceChat` 顶栏 | ProviderController connected/disconnected 测试；frontend health helper | `su01-provider-health-model`；`su01-lmstudio-disconnected-health` | 已验收 | 无 | 完整异常矩阵待补 | P1 | 后续并入 provider 失败矩阵 |
| SC-SU01-A2 看到 provider 和模型名 | UI 显示 provider + model | SU-I1；provider metadata contract | `Gateway.provider_metadata/0`；`providerHealthName`；`WorkspaceChat` | ProviderController provider/model metadata 测试 | `su01-provider-health-model`；`su01-model-provider-switching` | 已验收 | 无 | 非 Stub provider 切换矩阵待补 | P1 | `SU01-provider-failure-matrix` |
| SC-SU01-A3 LM Studio 未启动提示明确 | 未启动时有作者可理解提示 | SU-I1；LM Studio health detail | `LMStudio.health_check/1`；`ProviderController.health/2`；`WorkspaceChat` title/badge | health disconnected 测试 | `su01-lmstudio-disconnected-health` | 已验收 | 无 | 启停/timeout/错误返回矩阵待补 | P1 | `SU01-provider-failure-matrix` |
| SC-SU01-B1 选择不同 provider | provider 列表来自后端，保存后切换 runtime | SU-I2；provider registry contract | `Gateway.provider_options/0`；`configure_provider/1`；`WorkspaceChat` 模型设置 Dialog | Gateway/Web/frontend client 测试 | `su01-model-provider-switching` | 已验收 | 无 | DeepSeek/Anthropic/LM Studio 保存矩阵待补 | P1 | `SU01-provider-failure-matrix` |
| SC-SU01-B2 配置 API Key | Key 默认隐藏，可测试连接，保存后不进项目仓库 | SU-I3；Tauri desktop local secret storage | `modelProvider.ts`；`frontend/src-tauri/src/lib.rs` local file secret command；ProviderController options filtering | frontend secret fallback 测试；Rust payload/profile/local-file 测试；Phoenix filter 参数；native verifier secret redaction 测试 | `su01-api-key-secret-redaction`；`su01-local-secret-file-roundtrip` | 已验收 | 当前 local-file 路径已闭环；live vendor 错误矩阵归入 B3 | 后续回归矩阵 | P1 | `SU01-provider-failure-matrix` |
| SC-SU01-B3 配置 endpoint 并从实时模型列表选择 model | endpoint 独立配置；模型列表来自 provider 实时 API；非法 URL 阻断 | SU-I2/SU-I3；`POST /api/provider/models` | `Gateway.provider_models/1`；DeepSeek/Anthropic/LM Studio adapters；`WorkspaceChat` model select | Gateway/Web/frontend client 测试 | `su01-provider-endpoint-validation`；`su01-provider-model-list-success` | 部分实现 | 云端 provider 由外部 HTTP boundary harness，不证明 live vendor 账号；失败矩阵不足 | live vendor / 云端本地失败矩阵 | P1 | `SU01-provider-failure-matrix` |
| SC-SU01-B4 手动测试连接 | 成功/失败都有即时反馈，失败保留配置 | SU-I2；`POST /api/provider/test` | `Gateway.test_provider/1`；`ProviderController.test/2`；`WorkspaceChat` test button | Gateway/Web/frontend client 测试 | `su01-model-provider-switching` 覆盖成功；`su01-provider-endpoint-validation` 覆盖非法输入阻断；`su01-provider-test-failure-ui` 覆盖失败反馈、草稿保留、无 turn/runtime 副作用和恢复成功 | 已验收 | live vendor 错误矩阵归入 B3 后续，不影响 B4 合同 | 后续回归矩阵 | P1 | `SU01-provider-failure-matrix` |
| SC-SU01-C1 切换后下一轮用新 provider | 新 turn 经新 provider complete | SU-I2；provider runtime routing；provider/model audit log | `RuntimeConfig`；`Gateway.complete/3`；business JSONL | Gateway runtime routing 测试 | `su01-model-provider-switching` 的 `provider_gateway.complete.done provider=stub` | 已验收 | 无 | 非 Stub provider 矩阵待补 | P1 | `SU01-provider-failure-matrix` |
| SC-SU01-C2 切换 provider 不丢对话 | 当前作品、历史消息和 Channel 不丢 | SU-I4 | `WorkspaceChat` Dialog 状态；Channel 连接；message state | frontend contract 间接覆盖 | `su01-model-provider-switching` 断言切换后消息仍可见 | 已验收 | 无 | 长会话/历史恢复矩阵待补 | P2 | 后续回归矩阵 |
| SC-SU01-C3 配置安全存储 | API Key 和 provider 偏好落安全位置，不进仓库/日志/UI | SU-I3；desktop profile isolation | Tauri preferences；profile-scoped `provider-secrets.json`；secret storage capability command；backend runtime in-memory | Rust profile/local-file/0600 测试；Rust secret storage capability 测试；frontend no-localStorage secret 测试；frontend `local_file` capability helper 测试；native verifier local-file roundtrip 测试 | `su01-api-key-secret-redaction`；`su01-local-secret-file-roundtrip` | 已验收 | 当前产品决策已从 OS Keychain/unsupported 分支改为所有桌面平台同一 local-file 机制；Windows/Linux 页面矩阵降为后续平台回归，不再是 SU-01 C3 blocker | 后续平台回归矩阵 / 安全策略强化 | P2 | 后续平台回归 |

### 5.2 文件级退出判断（2026-06-22）

**当前可以进入 SU-02；SU-01 二轮无必须在本文件内继续关闭的 P0/P1 blocker。**

原因：

1. `SC-SU01-C3` 已按当前 local-file 设计关闭：`su01-local-secret-file-roundtrip` 证明真实 Tauri WebView 写入 `provider-secrets.json`、文件权限 0600、重启后从本地 secret 文件读回并恢复 runtime，且 fake Key 不进入偏好文件、options、UI、业务 JSONL 或 backend log。旧 `su01-keychain-webview-roundtrip` 与 `SU01-C3-non-macOS-platform-runner` 只保留为历史机制和被取代 blocker，不再代表当前 runnable truth。
2. P1 `SC-SU01-B3` 仍缺 live vendor、云端供应商真实失败矩阵和更完整本地异常矩阵；这需要真实供应商账号/额度/错误策略和更广平台资源，已登记为 `SU01-provider-failure-matrix` 后续 checkpoint，不应在本轮用 harnessed HTTP 或 macOS 单机结果冒充关闭。

**场景化覆盖判断：9/10 已验收（A1/A2/A3/B1/B2/B4/C1/C2/C3），1/10 部分实现（B3，P1 后续矩阵）。当前 SU-01 二轮可交付，可以进入 SU-02；进入后只需保留 B3 live vendor / 云端失败矩阵为后续 P1，以及 local-file 跨平台回归作为 P2。**

解释：作者入口、后端运行时切换、桌面 local-file 存储边界、测试连接失败恢复、provider/model 审计日志、局部测试和 Stub 切换真实页面验收都已落地。当前不再保留“非 macOS unsupported secret”产品口径；所有桌面平台统一使用 profile-scoped local file。后续如果要提升安全边界到 Stronghold / Credential Manager / Secret Service，应另立安全策略 slice，不能回写成 SU-01 当前未验收。

---

## 6. 缺口台账

| ID | 缺口 | 影响 | 建议处理 | 优先级 |
|---|---|---|---|---|
| SU01-GAP-01 | health 响应不返回 model | 已补：health 响应返回 provider/model，前端徽标消费同一契约 | 保持 `su01-provider-health-model` 作为回归验证；后续设置页复用该契约 | P1 |
| SU01-GAP-02 | disconnected health 无测试 | 已补：controller/application 测试覆盖 disconnected 时仍保留 provider/model metadata；`su01-lmstudio-disconnected-health` 覆盖真实工作台 LM Studio 未启动断开态 | 后续补 endpoint 错误、真实启动/关闭、返回异常等矩阵 | P0 |
| SU01-GAP-03 | provider registry 未暴露 | 已补：`GET /api/provider/options` 返回可选 provider 且不含 secret | 保持 Web/controller/client 测试；补真实页面验收 | P1 |
| SU01-GAP-04 | 运行时 provider 选择缺失 | 已补：`RuntimeConfig` + `configure_provider` + `Gateway.complete` runtime routing | 补真实页面下一轮 provider 证据 | P0 |
| SU01-GAP-05 | API Key 安全存储缺设计 | 已补：Tauri app config 保存非 secret 偏好，API Key 写入同 profile 的 `provider-secrets.json`（unix 0600）；后端进程内 runtime；`get_model_provider_secret_storage_status` 返回 `available=true/kind=local_file`；`su01-api-key-secret-redaction` 已证明 fake Key 不进入 options/browser fallback/UI/业务日志/backend log；`su01-local-secret-file-roundtrip` 已证明真实 Tauri WebView 保存后重启读回本地 secret 文件，且 fake Key 不进入偏好文件、options、业务日志或 backend log | 后续只做平台回归矩阵或更强 secret backend 策略强化 | P2 |
| SU01-GAP-06 | endpoint/model UI 缺失 | 已补：模型设置 Dialog 支持 endpoint，并通过供应商实时模型列表选择 model；保存失败的 Tauri payload 命名根因已修；非法 endpoint 校验已由 `su01-provider-endpoint-validation` 证明；模型列表成功矩阵已由 `su01-provider-model-list-success` 证明；测试连接失败反馈和恢复已由 `su01-provider-test-failure-ui` 证明 | 补 live vendor / 云端供应商真实错误矩阵 | P1 |
| SU01-GAP-07 | 切换后 trace/log 不标 provider | 已补：`provider_gateway.complete.start/done/error` 记录 provider/model/duration/error，不含 prompt/secret | 保持 Gateway 日志测试和 `su01-model-provider-switching` 验收 | P1 |
| SU01-GAP-08 | 缺完整模型切换 Tauri driver | 已补：`su01-model-provider-switching` 覆盖设置、测试连接、保存、下一轮调用和对话保留；`su01-provider-test-failure-ui` 覆盖测试连接失败和恢复 | 后续扩展 live vendor / 多平台矩阵 | P1 |

---

## 7. 最小可用闭环与完整版规划

### 7.1 为什么先叫“最小可用闭环”

最小可用闭环是为了先打通最短真实链路，而不是降低最终标准。本 slice 的最小闭环标准是：

1. provider registry 从后端单一来源输出，而不是前端写死；
2. 作者能从真实工作台入口打开设置；
3. 保存选择后，Gateway 的下一次调用能按 runtime provider 路由；
4. API Key 不写入 git 管理目录，也不通过 options API 回传；
5. 局部测试证明 API、Gateway、前端 client 合同成立。

这能让功能可用、可回滚、可继续验证，但还不是完整验收。

### 7.2 什么时候才是完整版

SU-01 完整版必须同时满足：

1. 外部自动化从真实 Tauri 工作台打开模型设置，切换 provider 并保存；
2. 验收脚本能证明下一轮消息确实由新 provider 处理，而不是只看 UI 文案；
3. 切换前后的当前作品、历史消息、Channel 连接不丢失；
4. 连接测试成功/失败、Key 缺失、endpoint 错误、LM Studio 断开都有作者可理解反馈；
5. API Key 不出现在项目文件、前端持久化、provider options response、截图或普通日志；
6. trace/log 能记录 provider/model 级别的审计信息，但不暴露 secret；
7. 当前 local-file secret 路径有真实 Tauri 桌面验收，并明确其本机明文、profile-scoped、0600 的安全边界。

### 7.3 后续规划

| 步骤 | 目标 | 产物 | 验收方式 |
|---:|---|---|---|
| 1 | 已完成：修正 A2 基础断裂 | `/api/provider/health` 返回 `provider` + `model` | Controller/application/frontend health test |
| 2 | 已完成：暴露 provider registry | `GET /api/provider/options` | Web/controller/frontend client test |
| 3 | 已完成：运行时配置与切换 UI | `PUT /api/provider/config` + `POST /api/provider/test` + 工作台 Dialog | Gateway/Web/frontend client test |
| 4 | 已完成：桌面存储边界 | profile-scoped Tauri preferences + profile-scoped `provider-secrets.json`（unix 0600） | Rust/frontend client test |
| 5 | 已完成：完整 Tauri 切换主路径验收 | `su01-model-provider-switching` driver | 外部自动化：打开设置、切换 provider、保存、发送下一轮、读取日志/截图 |
| 6 | 已完成：provider/model trace | provider call log 增加 provider/model 审计字段 | Gateway 日志测试 + Tauri 验收读取日志证据 |
| 7 | 已完成：供应商实时模型列表 | `POST /api/provider/models` + 工作台模型选择器 | Gateway/Web/frontend/Rust 局部测试 |
| 8 | 已完成：模型列表成功矩阵 | DeepSeek / Anthropic / LM Studio provider models 成功路径可在真实设置 Dialog 选择模型 | `su01-provider-model-list-success` |
| 9 | 已完成：LM Studio 断开态最小闭环 | 不可达 LM Studio endpoint -> health disconnected -> 工作台可见 `模型未连接` 和“LM Studio 未启动”原因 | `su01-lmstudio-disconnected-health` |
| 10 | 已完成：API Key redaction checkpoint | DeepSeek API Key 配置流中 fake Key 不进入 options/browser fallback/UI/业务日志/backend log | `su01-api-key-secret-redaction` |
| 11 | 已完成：Keychain WebView native capability 探针 | 不改产品代码，检查 Tauri/WebView/native/system UI 自动化能力并生成历史能力 summary | `su01-keychain-webview-capability`；不是验收 evidence |
| 12 | 已完成：真实 Tauri WebView local-file 写读验收 | 从真实 Tauri WebView 打开模型设置、输入 fake Key、保存、重启后从 `preferences.json` + `provider-secrets.json` 读回 `api_key_configured=true`，并证明 secret 不进 UI/日志/项目文件 | `su01-local-secret-file-roundtrip`；macOS CGEvent/Accessibility 外部 driver，不复用 browser-side Playwright |
| 13 | 已完成：统一 local-file secret 产品口径 | Tauri capability command 报告 `available=true/kind=local_file`；所有桌面平台使用同一 profile-scoped local secret file，不再有 unsupported UI 分支 | Rust/TypeScript 局部测试；local-file Tauri 真实页面验收 |
| 14 | 已完成：测试连接失败反馈与恢复 | 不可达 LM Studio endpoint -> 测试连接失败文案 -> Dialog/草稿保留 -> 修正 endpoint 后测试成功，且不创建 turn 或切换 runtime | `su01-provider-test-failure-ui` |
| 15 | 后续：live vendor / 平台回归矩阵 | live vendor 错误、云端供应商账号/权限失败、Windows/Linux local-file 回归页面证据 | 需要真实账号策略、远端 runner 结果或真实页面 driver；不阻塞 SU-01 二轮退出 |

---

## 8. 验收命令

```bash
# 当前可验证：health/options/models/config/test API 与运行时切换局部合同
mix test apps/novel_web/test/novel_web/controllers/provider_controller_test.exs
mix test apps/novel_agent/test/novel_agent/provider/gateway_test.exs
cd frontend && pnpm test -- --run src/lib/__tests__/modelProvider.test.ts
cd frontend/src-tauri && cargo test decodes_model_provider_settings_from_frontend_camel_case_payload
bash scripts/tauri_slice_verify.sh su01-model-provider-switching
bash scripts/tauri_slice_verify.sh su01-lmstudio-disconnected-health
bash scripts/tauri_slice_verify.sh su01-provider-endpoint-validation
bash scripts/tauri_slice_verify.sh su01-provider-model-list-success
bash scripts/tauri_slice_verify.sh su01-provider-test-failure-ui
bash scripts/tauri_slice_verify.sh su01-api-key-secret-redaction
bash scripts/tauri_slice_verify.sh su01-provider-vendor-matrix
bash scripts/tauri_slice_verify.sh su01-local-secret-file-roundtrip

# 本地手动验证：需 Phoenix/Tauri 服务运行
curl http://localhost:4657/api/provider/health
curl http://localhost:4657/api/provider/options
curl -X POST http://localhost:4657/api/provider/models \
  -H 'content-type: application/json' \
  -d '{"provider":"lmstudio","endpoint":"http://localhost:1234/v1"}'

# 当前仍未完整自动验收：
# - live vendor / 云端供应商真实失败矩阵
# - Windows/Linux local-file 回归页面矩阵
```
