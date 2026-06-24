# SU01 Provider Vendor Matrix / OpenAI、Minimax、智谱、Kimi、Gemini 供应商矩阵

- 状态：CP1 闭环（OpenAI 兼容矩阵 + 认证方式区分 + 离线真实页面验收）；live vendor / 订阅 OAuth 登录为登记后续缺口
- 类型：System Slice + Provider Runtime Slice + UI Contract Slice
- 启动日期：2026-06-23
- 来源反馈：用户问题 15
- 所属验收：`docs/design/acceptance/system/SU-01-model-provider.md`

## 1. 用户 / 系统目标

模型供应商配置需要扩展到 OpenAI（`api_key`、`subscription` 两种认证方式）、Minimax、智谱、Kimi、Gemini。作者应能在真实 Tauri 工作台配置供应商、选择模型、测试连接、保存并让下一轮请求使用该 provider，同时密钥不泄露到 UI、日志、options response 或项目文件。

## 2. 开工检查

- **Contract**：`docs/design/foundation/08-provider-abstraction.md`；`docs/design/acceptance/system/SU-01-model-provider.md`；当前 Tauri local-file secret 机制；provider config/options API。
- **Invariant**：
  - Provider runtime 必须经统一 Provider Abstraction；Domain 不直接调用供应商 SDK。
  - API Key / subscription secret 不回传、不入日志、不进项目文件、不进普通 UI。
  - 测试连接失败不得保存/切换 runtime 或创建 turn。
  - live vendor 失败矩阵不能用 harnessed HTTP 证据冒充真实云端验收。
  - OpenAI `api_key` 与 `subscription` 认证方式必须在 UI、配置、runtime 和 redaction 中清晰区分。
- **Boundary**：
  - `novel_agent`：新增 provider adapter / error normalization / model listing。
  - `novel_web` / `novel_application`：provider config/options/test connection 入口复用现有边界。
  - `frontend` / Tauri：模型设置 Dialog 新增供应商、认证方式、secret local-file 存储与脱敏 UI。
  - `quality`：fake key redaction、配置保存、失败 UI 可离线验收；live vendor smoke 需要真实账号策略，不默认阻塞本地开发。
  - **不做**：未经用户确认不安装新全局工具、不升级依赖、不引入非 spec SDK。
- **Consumer**：模型设置 Dialog、provider health badge、下一轮真实 LLM 请求、业务日志回溯。
- **Proof**：
  - 前端测试覆盖供应商枚举、认证方式、secret redaction。
  - 后端/provider 测试覆盖 request build、error normalization、options redaction。
  - 真实 Tauri 验收覆盖至少 fake key 保存/重启读回/不泄露/测试失败不切换；有凭据时再跑 live vendor smoke。
- **Acceptance Driver**：新增 `su01-provider-vendor-matrix` 系列外部 Tauri driver；产品代码新增验收感知逻辑：no。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | |
| novel_domain | no | Domain 不见 provider |
| novel_agent | yes | provider adapters / request / error |
| novel_application | maybe | config/test connection orchestration |
| novel_persistence | no | |
| novel_web | yes | provider API / DTO |
| frontend | yes | 模型设置 Dialog 和 provider client |
| frontend/src-tauri | yes | local-file secret 读写复用 |
| docs/design | maybe | provider matrix / authentication contract |
| quality | yes | 新增验收矩阵 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 审计现有 provider abstraction、配置 API、UI 和 secret 存储 | done | Gateway `@provider_modules`/`@provider_descriptors` 注册点、`/api/provider/{options,models,config,test}` 已对 registry 泛化、`modelProvider.ts` ProviderId 联合、Rust `MODEL_PROVIDER_IDS` 白名单、`provider-secrets.json`（0600）secret 存储均为单一扩展点 |
| T2 | 定义新增供应商和认证方式 contract | done | OpenAI 以 `openai`（API Key）/`openai_subscription`（订阅）两个独立 vendor id 区分（独立 secret/endpoint/label/redaction）；Minimax/智谱/Kimi/Gemini 经 OpenAI 兼容协议 |
| T3 | 实现 provider adapters、错误归一、模型列表/测试连接 | done | 新增 `OpenAICompatible` 共享基类（`__using__` 宏）+ 6 个薄 adapter；Bearer 鉴权、`/chat/completions`、`/models`、错误归一（auth/rate_limit/invalid_request/connection_refused/timeout）；非 thinking 供应商不发送 thinking 字段 |
| T4 | 更新模型设置 UI、secret redaction 和重启恢复 | done | UI 从后端 registry 自动渲染新供应商（前端不写死）；OpenAI 订阅认证方式 hint（`copy.ts`）；Rust 白名单扩展到 10 个 id，两认证方式 secret 隔离；redaction 不变量保持 |
| T5 | 补 fake key 本地验收和可选 live vendor smoke 策略 | done（CP1） | `su01-provider-vendor-matrix` 真实页面 driver：新供应商后端可列、订阅 hint、fake key、test-fail 不切换 runtime/不建 turn、保存后脱敏、两认证方式独立。live vendor 云端失败矩阵 + 订阅 OAuth 登录为登记后续缺口（无真实账号，不冒充） |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收（`bash scripts/tauri_slice_verify.sh su01-provider-vendor-matrix` 通过；`artifacts/slice-verify/su01-provider-vendor-matrix-tauri/summary.json` 证明 6 个新供应商来自后端 registry、订阅 hint 可见、fake key test-fail 不切换 runtime、保存后两认证方式独立且 secret 脱敏）
- [x] 后端 / provider / frontend 局部验证（`openai_compatible_test.exs`、`gateway_test.exs` 新增矩阵/认证方式区分用例；novel_agent 93 + novel_web 94 全绿；Rust 7 测试全绿，含新增矩阵白名单与两认证方式 secret 隔离）
- [x] `cd frontend && pnpm typecheck && pnpm lint && pnpm test`（320 通过）
- [x] `bash scripts/frontend_audit.sh`（27 pass）
- [x] `bash scripts/quality_manifest_check.sh`（passed）
- [x] `bash scripts/ai_static_scan.sh --top 10`（剩余 gitleaks ProjectGod 既有 accepted_risk；task-done-manifest 在 task_done 后复跑转绿）
- [x] `mix run scripts/arch_check.exs`（架构边界通过）；I3/I1/I2 scenario invariants 全绿（provider 层改动不触主链 artifact 不变量）

## 6. 决策日志

- 2026-06-23 — 登记用户反馈 15。该任务扩展 SU-01 B3 provider 矩阵，必须保持 secret redaction 和 live vendor evidence 边界，不用假证据关闭云端供应商真实失败矩阵。
- 2026-06-24 — CP1 闭环。根因判断：现有 provider 抽象已对 registry 泛化（web/application 的 options/models/config/test 零改动），扩展点是 Gateway 注册 + 前端 ProviderId 联合 + Rust secret 白名单 + config 默认。设计选择：
  - **不 6× 克隆 DeepSeek adapter**，新增 `NovelAgent.Provider.OpenAICompatible`（`__using__` 宏共享 `complete/health_check/list_models/from_config`），6 个 vendor adapter 各 ~10 行只声明 vendor/label/默认 endpoint·model/env_key/supports_thinking。DeepSeek/LMStudio/Anthropic 保留独立 adapter（各自鉴权/thinking 差异），不纳入基类。
  - **OpenAI 两认证方式用两个独立 vendor id**（`openai` / `openai_subscription`）而非单 id + auth_method 字段：契合既有「单 secret per provider」基础设施，UI/config/runtime/redaction 的区分天然成立（两行、两 secret、两 label），KISS。
  - **诚实未闭环缺口**（登记 SC-SU01-B3 P1 后续，与既有 live vendor 后续一致，不用 harnessed HTTP 冒充）：① live vendor 真实云端失败矩阵（无真实账号）；② OpenAI 订阅 OAuth 登录传输（浏览器授权换 ChatGPT 订阅 token + ChatGPT backend 专用传输，需真实订阅账号）。CP1 仅建模订阅认证方式的区分与离线脱敏/重启/test-fail 不变量。
  - 真实页面验收用 browser-side workbench Playwright driver + 本地 OpenAI 兼容 `/v1/models` fixture server（生产 adapter 经可配置 endpoint 发真实 HTTP 到 localhost，无需 fixture 注入 env），与既有 `su01-provider-test-failure-ui`/`su01-api-key-secret-redaction` 同模式。坑：改 endpoint 的 `onChange` 会清空模型列表并清 model，恢复 endpoint 后必须重新加载并选模型再保存（否则保存按钮 disabled）；失败时 UI 直接展示后端原因文案（connection refused → 「无法连接 OpenAI」），断言不能只匹配「连接不可用」。

## 7. 试行反馈

- 若实现需要新增项目依赖，必须使用项目声明的包管理方式，并先说明必要性；全局安装、升级或远程安装脚本不允许擅自执行。
