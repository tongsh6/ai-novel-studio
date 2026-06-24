# SU01 Provider Vendor Matrix / OpenAI、Minimax、智谱、Kimi、Gemini 供应商矩阵

- 状态：todo
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
| T1 | 审计现有 provider abstraction、配置 API、UI 和 secret 存储 | todo | 先列清当前 DeepSeek/Anthropic/LM Studio 复用点 |
| T2 | 定义新增供应商和认证方式 contract | todo | OpenAI `api_key` / `subscription` 单独处理 |
| T3 | 实现 provider adapters、错误归一、模型列表/测试连接 | todo | 尽量复用 OpenAI-compatible 协议，不能假设全部兼容 |
| T4 | 更新模型设置 UI、secret redaction 和重启恢复 | todo | 文案集中在 `copy.ts` |
| T5 | 补 fake key 本地验收和可选 live vendor smoke 策略 | todo | 无真实账号时不得标 live 矩阵已验收 |

## 5. 验证

- [ ] 外部自动化驱动真实页面的场景化验收
- [ ] 后端 / provider / frontend 局部验证
- [ ] `cd frontend && pnpm typecheck && pnpm lint && pnpm test`
- [ ] `bash scripts/frontend_audit.sh`
- [ ] `bash scripts/quality_manifest_check.sh`
- [ ] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-23 — 登记用户反馈 15。该任务扩展 SU-01 B3 provider 矩阵，必须保持 secret redaction 和 live vendor evidence 边界，不用假证据关闭云端供应商真实失败矩阵。

## 7. 试行反馈

- 若实现需要新增项目依赖，必须使用项目声明的包管理方式，并先说明必要性；全局安装、升级或远程安装脚本不允许擅自执行。
