# SU-01 切换模型供应商

> 系统用户视角：我可以选择用哪个大模型来驱动 AI 创作助手，切换 Anthropic / 本地 LM Studio / 测试 Stub 等供应商，配置各自的 API Key、模型和端点，并确认连接是否正常。
>
> 场景化验收口径：本文按完整功能蓝图验收“模型供应商管理”，不把已有健康检查误判为完整供应商切换。
>
> 2026-05-20 对账结论：`GET /api/provider/health` 已补齐 provider/model 契约。Provider metadata 由 `NovelAgent.Provider.Gateway` 从当前 adapter 配置统一读取，`NovelApplication.provider_health/0` 在 connected/disconnected 两种结果中都保留 provider/model，`NovelWeb.ProviderController` 不再把断开状态折叠成 `unknown`。真实 `WorkspaceChat` 消费统一前端 health helper，状态徽标可展示后端返回的模型名或 provider 名；新增原生 Tauri 验证 `su01-provider-health-model` 从真实工作台启动、等待 health 轮询、上报 LLM 徽标文本并证明显示 `slice_verify`。这只关闭 health 可见性 checkpoint，不代表 provider 列表、运行时切换、Key/endpoint 设置或安全存储已实现。历史旁路 `WorkbenchV3` 已退役删除，不再作为当前证据。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 看当前 LLM 是否可用 | 状态栏显示检测中 / 已连接 / 未连接 |
| 看当前供应商和模型 | 显示 provider 名称、模型名和连接状态 |
| 切换到另一个供应商 | 下一轮对话使用新供应商，历史消息不丢 |
| 配置 API Key | Key 安全保存，不明文进入项目仓库 |
| 配置模型和端点 | 每个供应商可以独立设置 endpoint / model |
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
| `apps/novel_web/lib/novel_web/controllers/provider_controller.ex` | `GET /api/provider/health` 返回 `connected/provider/message/detail` | 有后端 health 入口，但不返回 model |
| `apps/novel_application/lib/novel_application.ex` | `provider_health/0` 读取 `Application.get_env(:novel_agent, :provider)[:default]` 并调用 Gateway | provider 当前是启动配置，不是运行时用户选择 |
| `apps/novel_agent/lib/novel_agent/provider/gateway.ex` | 注册 `stub/lmstudio/anthropic`，支持 `registered_providers/0` 和 `health_check/0` | 后端已有可复用 registry，但没有配置 API |
| `frontend/src/components/WorkspaceChat.tsx` | 轮询 health；title 可显示 `llmModel`，但 health 不返回 model | 旧 UI 状态也不完整 |
| `apps/novel_web/test/novel_web/controllers/provider_controller_test.exs` | 已覆盖 stub connected、model-backed provider metadata、disconnected 不折叠 unknown | 仍缺 provider 列表 / 配置变更测试 |
| `config/*.exs` | 通过 env/config 设置默认 provider、endpoint、model | 支持本地 LM Studio 配置，但不是用户可视化管理 |

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
| 用户视角 | 我能看到当前使用的是 LM Studio、Anthropic 或 Stub，以及具体模型 |
| 触发 | health check 成功 |
| 期望结果 | UI 显示 provider + model，例如 `LM Studio · openai/gpt-oss-120b` |
| 当前证据 | 后端返回 `provider` + `model`；`WorkspaceChat` 徽标消费 `providerHealthName`；`su01-provider-health-model` 原生 Tauri 验证覆盖真实工作台徽标 |
| 当前状态 | 部分实现 / 最小真实前端闭环已补 |
| 当前缺口 | 完整 provider 设置页仍未实现；运行时切换后下一轮真实 provider 证据未闭环 |
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
| 用户视角 | 我可以在设置中从 LM Studio 切换到 Anthropic 或 Stub |
| 期望结果 | provider 列表来自后端 registry；切换后 health 和下一轮对话使用新 provider |
| 当前证据 | Gateway 有 `registered_providers/0`，但没有 Web/API 暴露；前端无设置 UI |
| 当前状态 | 未实现 |
| 缺口类型 | 补实现 |
| 优先级 | P0 |

#### SC-SU01-B2 — 配置 API Key

| 字段 | 内容 |
|---|---|
| 用户视角 | 我能给 Anthropic 等云端 provider 配置 Key |
| 期望结果 | Key 默认隐藏，可测试连接，保存后不进入 git 管理目录 |
| 当前证据 | Anthropic adapter 从 config/env 读取 api_key；无运行时配置 UI |
| 当前状态 | 未实现 |
| 缺口类型 | 补设计 + 补实现 |
| 优先级 | P0 |

#### SC-SU01-B3 — 配置 endpoint / model

| 字段 | 内容 |
|---|---|
| 用户视角 | 我可以把 LM Studio endpoint 指向本地 `localhost:1234/v1` 或自定义端点 |
| 期望结果 | 每个 provider 有独立 endpoint/model，非法 URL 有校验 |
| 当前证据 | `config/config.exs` / `dev.exs` 支持环境变量和默认值 |
| 当前状态 | 部分实现 |
| 缺口类型 | 补实现 |
| 优先级 | P1 |

#### SC-SU01-B4 — 手动测试连接

| 字段 | 内容 |
|---|---|
| 用户视角 | 我改完 Key 或 endpoint 后，点击按钮立即知道能不能用 |
| 期望结果 | 显示检测中；成功显示 provider/model；失败保留配置并显示原因 |
| 当前证据 | `/api/provider/health` 可复用为只读探活 |
| 当前状态 | 未实现 |
| 缺口类型 | 补实现 + 补 UI 自动化 |
| 优先级 | P1 |

### 场景组 C：切换后的行为

#### SC-SU01-C1 — 切换后下一轮对话用新 provider

| 字段 | 内容 |
|---|---|
| 用户视角 | 我切换 provider 后，新发送的一轮消息用新模型回复 |
| 期望结果 | Gateway 用新 provider 发起 complete；trace/log 可看出 provider |
| 当前证据 | Gateway 从 application env 读默认 provider；无运行时切换状态 |
| 当前状态 | 未实现 |
| 缺口类型 | 补集成 |
| 优先级 | P0 |

#### SC-SU01-C2 — 切换 provider 不丢对话

| 字段 | 内容 |
|---|---|
| 用户视角 | 我切换模型后，当前作品和历史消息仍保留 |
| 期望结果 | 历史 TurnResult 不丢；新 turn 可标记 provider/model |
| 当前证据 | 无 provider 切换 UI，也无消息 provider 标记 |
| 当前状态 | 未实现 |
| 缺口类型 | 补验收 |
| 优先级 | P1 |

#### SC-SU01-C3 — 配置安全存储

| 字段 | 内容 |
|---|---|
| 用户视角 | 我的 API Key 和 provider 偏好不会被提交到项目仓库 |
| 期望结果 | 配置落在 Tauri app data / OS keychain / 明确的安全后端位置 |
| 当前证据 | 当前依赖 env/config；没有运行时配置存储 |
| 当前状态 | 未实现 |
| 缺口类型 | 补设计 |
| 优先级 | P0 |

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 状态 | 证据 | 缺口类型 |
|---|---|---|---|---|
| SC-SU01-A1 | 启动后看到 LLM 连接状态 | 已实现未完整验收 | ProviderController + 前端轮询 + happy-path test | 补测试/补验收 |
| SC-SU01-A2 | 看到 provider 和模型名 | 部分实现 / 最小真实前端闭环已补 | health 返回 provider/model；`su01-provider-health-model` 原生 Tauri 验证覆盖真实工作台徽标 | 继续补完整设置页与运行时切换验收 |
| SC-SU01-A3 | LM Studio 未启动提示明确 | 已实现未验收 | adapter/provider health 错误路径 | 补测试 |
| SC-SU01-B1 | 选择不同 provider | 未实现 | Gateway registry 未暴露到 UI | 补实现 |
| SC-SU01-B2 | 配置 API Key | 未实现 | 仅 env/config | 补设计/补实现 |
| SC-SU01-B3 | 配置 endpoint/model | 部分实现 | env/config 支持，UI 不支持 | 补实现 |
| SC-SU01-B4 | 手动测试连接 | 未实现 | 可复用 health endpoint | 补实现 |
| SC-SU01-C1 | 切换后下一轮用新 provider | 未实现 | Gateway 只读启动配置 | 补集成 |
| SC-SU01-C2 | 切换不丢对话 | 未实现 | 无切换入口 | 补验收 |
| SC-SU01-C3 | 配置安全存储 | 未实现 | 无运行时配置存储 | 补设计 |

**场景化覆盖判断：0/10 已验收，2/10 部分具备基础设施。**

解释：A1/A3 有实现基础，但缺断开路径和 UI 自动化；A2 发现了 model 字段断裂。供应商切换作为完整功能尚未开始。

---

## 6. 缺口台账

| ID | 缺口 | 影响 | 建议处理 | 优先级 |
|---|---|---|---|---|
| SU01-GAP-01 | health 响应不返回 model | 已补：health 响应返回 provider/model，前端徽标消费同一契约 | 保持 `su01-provider-health-model` 作为回归验证；后续设置页复用该契约 | P1 |
| SU01-GAP-02 | disconnected health 无测试 | 已补：controller/application 测试覆盖 disconnected 时仍保留 provider/model metadata | 后续补 LM Studio 未启动的端到端 UI 文案断言 | P0 |
| SU01-GAP-03 | provider registry 未暴露 | UI 无法列出可选供应商 | 新增 application/web 只读 provider list API | P1 |
| SU01-GAP-04 | 运行时 provider 选择缺失 | 用户只能改 env 重启 | 设计 provider config store 与 Gateway runtime selection | P0 |
| SU01-GAP-05 | API Key 安全存储缺设计 | 云端 provider 无法产品化 | 先做 ADR/设计：Tauri app data vs keychain vs 后端 secret | P0 |
| SU01-GAP-06 | endpoint/model UI 缺失 | 本地 LM Studio 配置不友好 | 设置面板支持 endpoint/model；非法 URL 校验 | P1 |
| SU01-GAP-07 | 切换后 trace/log 不标 provider | 难以验收是否真的切换 | 在 provider call trace/log 中记录 provider/model | P1 |

---

## 7. 最小下一步验收计划

| 步骤 | 目标 | 产物 | 验收方式 |
|---:|---|---|---|
| 1 | 修正 A2 基础断裂 | `/api/provider/health` 返回 `provider` + `model` | Controller test 断言字段 |
| 2 | 补 A3 降级证明 | disconnected/timeout health test | 模拟 Gateway error，断言 author-safe message |
| 3 | 暴露 provider registry | `GET /api/provider/options` 或等价 application API | 返回 `stub/lmstudio/anthropic` 不含 secret |
| 4 | 设计配置存储 | 小 ADR 或 design note | 明确 Key/endpoint/model 存储边界 |
| 5 | 再做切换 UI | 设置面板 + 手动 test connection | Playwright/Tauri walkthrough |

---

## 8. 验收命令

```bash
# 当前可验证：health endpoint happy path
mix test apps/novel_web/test/novel_web/controllers/provider_controller_test.exs

# 本地手动验证：需 Phoenix/Tauri 服务运行
curl http://localhost:4657/api/provider/health

# 当前不可自动验收：
# - provider 运行时切换
# - API Key 保存
# - endpoint/model 设置
# - 切换后下一轮真实使用新 provider
```
