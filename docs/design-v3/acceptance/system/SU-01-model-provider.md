# SU-01 切换模型供应商

> 系统用户视角：我可以选择用哪个大模型来驱动 AI 创作助手，切换 DeepSeek / Anthropic / 本地 LM Studio / 测试 Stub 等供应商，配置各自的 API Key、模型和端点，并确认连接是否正常。
>
> 场景化验收口径：本文按完整功能蓝图验收“模型供应商管理”，不把已有健康检查误判为完整供应商切换。
>
> 2026-05-20 对账结论：`GET /api/provider/health` 已补齐 provider/model 契约。Provider metadata 由 `NovelAgent.Provider.Gateway` 从当前 adapter 配置统一读取，`NovelApplication.provider_health/0` 在 connected/disconnected 两种结果中都保留 provider/model，`NovelWeb.ProviderController` 不再把断开状态折叠成 `unknown`。真实 `WorkspaceChat` 消费统一前端 health helper，状态徽标可展示后端返回的模型名或 provider 名；新增原生 Tauri 验证 `su01-provider-health-model` 从真实工作台启动、等待 health 轮询、上报 LLM 徽标文本并证明显示 `slice_verify`。这只关闭 health 可见性 checkpoint，不代表 provider 列表、运行时切换、Key/endpoint 设置或安全存储已实现。历史旁路 `WorkbenchV3` 已退役删除，不再作为当前证据。
>
> 2026-06-12 对账结论：Gateway 已新增 `deepseek` adapter，配置来源为 `NOVEL_DEEPSEEK_API_KEY` / `DEEPSEEK_API_KEY`、`NOVEL_DEEPSEEK_MODEL`、`NOVEL_DEEPSEEK_ENDPOINT`，默认模型 `deepseek-v4-flash`，默认非 thinking 模式。该变更只扩展后端 provider registry 和 env/config 接入，不代表 SU-01 的 provider 列表 UI、运行时切换、安全存储或真实页面验收已完成。
>
> 2026-06-12 完整版模型切换实现进展：`Gateway` 已提供 `provider_options/provider_models/configure_provider/test_provider` 运行时 API，`NovelWeb.ProviderController` 暴露 `/api/provider/options`、`POST /api/provider/models`、`PUT /api/provider/config`、`POST /api/provider/test`，`WorkspaceChat` 顶栏新增“模型设置”入口，可查看后端 provider registry、配置 endpoint/API Key、实时刷新并选择供应商模型、DeepSeek thinking/reasoning effort、手动测试连接并保存切换；模型名不再由作者手输，也不由前端预制写死，DeepSeek/Anthropic/LM Studio 分别经供应商模型列表 API 拉取。Tauri 桌面侧将非 secret 偏好写入 app config，API Key 写入 macOS Keychain，后端运行时只保留当前进程配置；本轮修复了前端 camelCase payload 与 Rust snake_case struct 不匹配导致的保存失败，并以 Rust 单测锁定。新增外部自动化 `su01-model-provider-switching` 已从真实工作台打开设置、切换到 Stub、测试连接、保存、发送下一轮，并用 `provider_gateway.complete.done provider=stub` 业务日志证明下一轮确实走新 provider 且对话保留。当前仍不能标 SU-01 全量完成：DeepSeek/API Key/endpoint 的真实桌面矩阵、LM Studio 断开态、Keychain 端到端和非 macOS secret 策略仍未闭环。

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
| SU-I3 | API Key / endpoint 不应写入 git 管理的项目文件 | SC-SU01-B2/B3：配置应进入 Tauri app data / OS keychain / 后端安全配置 |
| SU-I4 | 切换供应商不破坏已有对话和作品上下文 | SC-SU01-C2：历史消息保留，新 turn 使用新 provider |

---

## 3. 证据与契约

| 证据 / 契约 | 当前事实 | 影响 |
|---|---|---|
| `apps/novel_web/lib/novel_web/controllers/provider_controller.ex` | `GET /api/provider/health` 返回 `connected/provider/model/message/detail`；新增 provider options/models/config/test API | 后端 API 已能支撑设置 UI，但完整页面验收未闭环 |
| `apps/novel_application/lib/novel_application.ex` | `provider_health/options/models/configure/test` 均经 Application 层代理 | `novel_web` 不直接依赖 `novel_agent` |
| `apps/novel_agent/lib/novel_agent/provider/runtime_config.ex` | 保存当前进程的 provider 选择与运行时配置 | 持久化归桌面 shell，不落项目仓库 |
| `apps/novel_agent/lib/novel_agent/provider/gateway.ex` | 注册 `stub/lmstudio/anthropic/deepseek`，支持 registry、实时模型列表、health、运行时切换和连接测试；`clear_api_key` 不复用旧 runtime key | 后端最小切换闭环已实现并有单元/控制器测试 |
| `frontend/src/lib/modelProvider.ts` | 集中封装 provider options/models/config/test、Tauri 偏好、Keychain 同步、浏览器 fallback | 前端只调用后端 API，不直接调用 provider |
| `frontend/src-tauri/src/lib.rs` | 非 secret provider 偏好写 app config，API Key 写 macOS Keychain；保存 payload 支持前端 camelCase | 桌面安全存储边界已实现；非 macOS Keychain 写入返回明确错误 |
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
| 真实消费者 | WorkspaceChat 状态栏 |
| 当前证据 | 前端 30s 轮询；ProviderControllerTest 覆盖 connected/disconnected 和 provider/model metadata |
| 当前状态 | 已实现未完整验收 |
| 当前缺口 | 无 UI 自动化；断开状态无测试；health 不返回 model |
| 优先级 | P1 |

#### SC-SU01-A2 — 看到当前 provider 和模型名

| 字段 | 内容 |
|---|---|
| 用户视角 | 我能看到当前使用的是 LM Studio、Anthropic、DeepSeek 或 Stub，以及具体模型 |
| 触发 | health check 成功 |
| 期望结果 | UI 显示 provider + model，例如 `LM Studio · openai/gpt-oss-120b` |
| 当前证据 | 后端返回 `provider` + `model`；`WorkspaceChat` 徽标消费 `providerHealthName`；`su01-provider-health-model` 原生 Tauri 验证覆盖真实工作台徽标 |
| 当前状态 | 已实现 / 最小真实前端闭环已补 |
| 当前缺口 | 运行时切换后下一轮真实 provider 证据未闭环 |
| 缺口类型 | 补实现 + 补测试 |
| 优先级 | P1 |

#### SC-SU01-A3 — LM Studio 未启动时提示明确

| 字段 | 内容 |
|---|---|
| 用户视角 | 我本地使用 LM Studio，忘记启动时能看到明确提示 |
| 前置条件 | 默认 provider 为 lmstudio，LM Studio 未启动 |
| 期望结果 | health 返回 `connected=false`，UI 显示未连接和可理解原因 |
| 当前证据 | LMStudio adapter 有 connection refused/timeout 错误；ProviderController 透出 `message/detail` |
| 当前状态 | 已实现未验收 |
| 当前缺口 | 缺 controller disconnected 测试；缺 UI 文案断言；错误消息可能仍偏技术化 |
| 优先级 | P0 |

### 场景组 B：配置供应商

#### SC-SU01-B1 — 选择不同 provider

| 字段 | 内容 |
|---|---|
| 用户视角 | 我可以在设置中从 LM Studio 切换到 Anthropic、DeepSeek 或 Stub |
| 期望结果 | provider 列表来自后端 registry；切换后 health 和下一轮对话使用新 provider |
| 当前证据 | `GET /api/provider/options` 返回后端 registry；`WorkspaceChat` 模型设置弹窗消费该 API |
| 当前状态 | 已实现未验收 |
| 缺口类型 | 补真实页面验收 |
| 优先级 | P0 |

#### SC-SU01-B2 — 配置 API Key

| 字段 | 内容 |
|---|---|
| 用户视角 | 我能给 Anthropic、DeepSeek 等云端 provider 配置 Key |
| 期望结果 | Key 默认隐藏，可测试连接，保存后不进入 git 管理目录 |
| 当前证据 | Tauri command 将 API Key 写入 macOS Keychain；后端 options 不返回 secret；前端测试断言 secret 不写 browser fallback store |
| 当前状态 | 已实现未验收 |
| 缺口类型 | 补真实页面验收 + 补非 macOS 策略 |
| 优先级 | P0 |

#### SC-SU01-B3 — 配置 endpoint 并从供应商实时模型列表选择 model

| 字段 | 内容 |
|---|---|
| 用户视角 | 我可以把 LM Studio endpoint 指向本地 `localhost:1234/v1` 或自定义端点，并从供应商当前可用模型中选择 |
| 期望结果 | 每个 provider 有独立 endpoint；模型列表来自供应商实时 API，不手输、不前端写死；非法 URL 有校验 |
| 当前证据 | `POST /api/provider/models` 经 Gateway 调 DeepSeek `/models`、Anthropic `/v1/models`、LM Studio `/v1/models`；设置弹窗在 endpoint/API Key 之后刷新并选择模型；真实 provider 未加载到模型列表时禁用保存 |
| 当前状态 | 已实现未验收 |
| 缺口类型 | 补 URL 校验 + 补真实页面验收 + 补云端/本地失败矩阵 |
| 优先级 | P1 |

#### SC-SU01-B4 — 手动测试连接

| 字段 | 内容 |
|---|---|
| 用户视角 | 我改完 Key 或 endpoint 后，点击按钮立即知道能不能用 |
| 期望结果 | 显示检测中；成功显示 provider/model；失败保留配置并显示原因 |
| 当前证据 | `POST /api/provider/test` 用传入配置构建 adapter state，不改变当前 runtime provider；设置弹窗有测试连接按钮 |
| 当前状态 | 已实现未验收 |
| 缺口类型 | 补 UI 自动化 + 补失败文案矩阵 |
| 优先级 | P1 |

### 场景组 C：切换后的行为

#### SC-SU01-C1 — 切换后下一轮对话用新 provider

| 字段 | 内容 |
|---|---|
| 用户视角 | 我切换 provider 后，新发送的一轮消息用新模型回复 |
| 期望结果 | Gateway 用新 provider 发起 complete；trace/log 可看出 provider |
| 当前证据 | `RuntimeConfig` 覆盖默认 provider；`Gateway.complete/3` 已按 runtime provider 路由；测试覆盖切换到 DeepSeek 后 complete 走 DeepSeek adapter |
| 当前状态 | 已测试，未完成真实页面验收 |
| 缺口类型 | 补真实页面验收 + 补 provider/model trace |
| 优先级 | P0 |

#### SC-SU01-C2 — 切换 provider 不丢对话

| 字段 | 内容 |
|---|---|
| 用户视角 | 我切换模型后，当前作品和历史消息仍保留 |
| 期望结果 | 历史 TurnResult 不丢；新 turn 可标记 provider/model |
| 当前证据 | 模型设置作为顶栏 Dialog，不重置 `WorkspaceChat` 消息、作品或 Channel；保存后只刷新 health |
| 当前状态 | 已实现未验收 |
| 缺口类型 | 补真实页面验收 |
| 优先级 | P1 |

#### SC-SU01-C3 — 配置安全存储

| 字段 | 内容 |
|---|---|
| 用户视角 | 我的 API Key 和 provider 偏好不会被提交到项目仓库 |
| 期望结果 | 配置落在 Tauri app data / OS keychain / 明确的安全后端位置 |
| 当前证据 | Tauri app config 保存非 secret 偏好；macOS Keychain 保存 API Key；后端 runtime config 进程内保存，不写仓库文件 |
| 当前状态 | 已实现未验收 |
| 缺口类型 | 补真实桌面验收 + 补跨平台 secret 策略 |
| 优先级 | P0 |

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 状态 | 证据 | 缺口类型 |
|---|---|---|---|---|
| SC-SU01-A1 | 启动后看到 LLM 连接状态 | 已实现未完整验收 | ProviderController + 前端轮询 + happy-path test | 补测试/补验收 |
| SC-SU01-A2 | 看到 provider 和模型名 | 已实现 / 最小真实前端闭环已补 | health 返回 provider/model；`su01-provider-health-model` 原生 Tauri 验证覆盖真实工作台徽标 | 继续补运行时切换验收 |
| SC-SU01-A3 | LM Studio 未启动提示明确 | 已实现未验收 | adapter/provider health 错误路径 | 补测试 |
| SC-SU01-B1 | 选择不同 provider | 已有最小真实 Tauri 验收 | options API + 工作台设置 Dialog + `su01-model-provider-switching` | 补 DeepSeek/LM Studio 矩阵 |
| SC-SU01-B2 | 配置 API Key | 已实现未验收 | Tauri Keychain + secret 不回传测试 | 补真实桌面验收/跨平台策略 |
| SC-SU01-B3 | 配置 endpoint/model | 已实现未验收 | 运行时 config API + 实时模型列表 API + UI 选择器 | 补校验/补真实页面验收 |
| SC-SU01-B4 | 手动测试连接 | 已有最小真实 Tauri 验收 | test API + UI 按钮 + `su01-model-provider-switching` | 补失败态 UI 验收 |
| SC-SU01-C1 | 切换后下一轮用新 provider | 已有最小真实 Tauri 验收 | Gateway runtime routing 测试 + `provider_gateway.complete.done provider=stub` | 补 DeepSeek/LM Studio 矩阵 |
| SC-SU01-C2 | 切换不丢对话 | 已有最小真实 Tauri 验收 | `su01-model-provider-switching` 断言切换后消息仍可见 | 补长会话/历史消息矩阵 |
| SC-SU01-C3 | 配置安全存储 | 已实现未验收 | app config + macOS Keychain + runtime in-memory | 补真实桌面验收/跨平台策略 |

**场景化覆盖判断：6/10 已有最小真实 Tauri 证据（A1/A2/B1/B4/C1/C2），3/10 已实现但缺真实桌面矩阵（B2/B3/C3），A3 仍缺 LM Studio 断开态页面验收。**

解释：这已经超过“最小可用闭环”：作者入口、后端运行时切换、桌面存储边界、provider/model 审计日志、局部测试和 Stub 切换真实页面验收都已落地。但 SU-01 的全量完成还必须覆盖云端 Key、endpoint 错误、LM Studio 断开、DeepSeek thinking 参数、Keychain 端到端和跨平台 secret 策略。

---

## 6. 缺口台账

| ID | 缺口 | 影响 | 建议处理 | 优先级 |
|---|---|---|---|---|
| SU01-GAP-01 | health 响应不返回 model | 已补：health 响应返回 provider/model，前端徽标消费同一契约 | 保持 `su01-provider-health-model` 作为回归验证；后续设置页复用该契约 | P1 |
| SU01-GAP-02 | disconnected health 无测试 | 已补：controller/application 测试覆盖 disconnected 时仍保留 provider/model metadata | 后续补 LM Studio 未启动的端到端 UI 文案断言 | P0 |
| SU01-GAP-03 | provider registry 未暴露 | 已补：`GET /api/provider/options` 返回可选 provider 且不含 secret | 保持 Web/controller/client 测试；补真实页面验收 | P1 |
| SU01-GAP-04 | 运行时 provider 选择缺失 | 已补：`RuntimeConfig` + `configure_provider` + `Gateway.complete` runtime routing | 补真实页面下一轮 provider 证据 | P0 |
| SU01-GAP-05 | API Key 安全存储缺设计 | 已补：Tauri app config 保存非 secret 偏好，macOS Keychain 保存 Key，后端进程内 runtime | 补真实桌面验收；决定非 macOS secret 策略 | P0 |
| SU01-GAP-06 | endpoint/model UI 缺失 | 已补：模型设置 Dialog 支持 endpoint，并通过供应商实时模型列表选择 model；保存失败的 Tauri payload 命名根因已修 | 补 URL 校验、真实 provider 页面验收和失败矩阵 | P1 |
| SU01-GAP-07 | 切换后 trace/log 不标 provider | 已补：`provider_gateway.complete.start/done/error` 记录 provider/model/duration/error，不含 prompt/secret | 保持 Gateway 日志测试和 `su01-model-provider-switching` 验收 | P1 |
| SU01-GAP-08 | 缺完整模型切换 Tauri driver | 已补：`su01-model-provider-switching` 覆盖设置、测试连接、保存、下一轮调用和对话保留 | 后续扩展 DeepSeek/LM Studio/API Key/endpoint 失败矩阵 | P0 |

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
7. macOS Keychain 路径有桌面验收，非 macOS secret 策略有明确产品口径。

### 7.3 后续规划

| 步骤 | 目标 | 产物 | 验收方式 |
|---:|---|---|---|
| 1 | 已完成：修正 A2 基础断裂 | `/api/provider/health` 返回 `provider` + `model` | Controller/application/frontend health test |
| 2 | 已完成：暴露 provider registry | `GET /api/provider/options` | Web/controller/frontend client test |
| 3 | 已完成：运行时配置与切换 UI | `PUT /api/provider/config` + `POST /api/provider/test` + 工作台 Dialog | Gateway/Web/frontend client test |
| 4 | 已完成：桌面存储边界 | Tauri preferences + macOS Keychain commands | `cargo check` + 前端 client test |
| 5 | 已完成：完整 Tauri 切换主路径验收 | `su01-model-provider-switching` driver | 外部自动化：打开设置、切换 provider、保存、发送下一轮、读取日志/截图 |
| 6 | 已完成：provider/model trace | provider call log 增加 provider/model 审计字段 | Gateway 日志测试 + Tauri 验收读取日志证据 |
| 7 | 已完成：供应商实时模型列表 | `POST /api/provider/models` + 工作台模型选择器 | Gateway/Web/frontend/Rust 局部测试 |
| 8 | 下一步：异常矩阵 | Key 缺失、endpoint 错误、LM Studio 断开、test connection 失败 | UI 自动化 + controller/client test |

---

## 8. 验收命令

```bash
# 当前可验证：health/options/models/config/test API 与运行时切换局部合同
mix test apps/novel_web/test/novel_web/controllers/provider_controller_test.exs
mix test apps/novel_agent/test/novel_agent/provider/gateway_test.exs
cd frontend && pnpm test -- --run src/lib/__tests__/modelProvider.test.ts
cd frontend/src-tauri && cargo test decodes_model_provider_settings_from_frontend_camel_case_payload
bash scripts/tauri_slice_verify.sh su01-model-provider-switching

# 本地手动验证：需 Phoenix/Tauri 服务运行
curl http://localhost:4657/api/provider/health
curl http://localhost:4657/api/provider/options
curl -X POST http://localhost:4657/api/provider/models \
  -H 'content-type: application/json' \
  -d '{"provider":"lmstudio","endpoint":"http://localhost:1234/v1"}'

# 当前不可自动验收：
# - API Key 在 macOS Keychain 的端到端桌面验收
# - DeepSeek / LM Studio / endpoint 失败矩阵
```
