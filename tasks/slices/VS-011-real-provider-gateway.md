# VS-011 Real Provider Gateway (Anthropic API Adapter)

- 状态：done
- 类型：Turn Slice
- 启动日期：2026-04-30
- 完成日期：2026-04-30

## 1. 用户 / 系统目标

当前 Provider Gateway 已注册 2 个 adapter：`Provider.Stub`（返回固定文本）和 `Provider.LMStudio`（本地 HTTP API）。开发阶段使用 LM Studio 验证了链路的通畅性，但它依赖用户手动启动本地模型服务，不是可工作的默认状态。创作内容质量严重受限于本地模型能力。

本 slice 为 Provider Gateway 新增 Anthropic API adapter，接入真实 Claude 模型。Stub 保留为测试环境默认 provider，LM Studio 保留为开发阶段本地推理选项。

**与 VS-010 的关系**：VS-011 与 VS-010 无代码依赖（Provider 在 `novel_agent` 层，不接触领域对象），可并行施工。

## 2. 开工检查

- Contract: `docs/design-v2/08-provider-abstraction.md` §3（Provider 接口）、§4（Message/Result 结构）、§5（Usage 计量）、§6（Error 标准化）；`apps/novel_agent/lib/novel_agent/provider.ex`（Provider behaviour）
- Invariant:
  1. Anthropic adapter 必须实现 `NovelAgent.Provider` behaviour（`complete/2` + `name/0`）
  2. 调用失败时 Gateway 直接返回错误（不做降级），上层告知用户 LLM 不可用
  3. Usage token 信息必须返回并记录到 audit log
- Boundary: 涉及 `novel_agent`（新增 `Provider.Anthropic` + `Provider.Usage` struct）；不应修改 `novel_domain`、`novel_application`、`novel_persistence`、`novel_web`
- Consumer: `NovelAgent.Router`（intent 分类）、`NovelAgent.Orchestrator`（内容生成）、`NovelAgent.LongRunner`（长跑创作）；间接触达 `novel_application` 的 TurnService
- Proof:
  - Provider.Anthropic 单元测试（含真实 API 调用）
  - `mix test` 全绿

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | yes | 新增 `UpstreamError` 的 usage/token 相关 error type |
| novel_domain | no | 不涉及 |
| novel_agent | yes | 新增 `Provider.Anthropic` adapter + `Provider.Usage` struct；Gateway 注册 Anthropic |
| novel_application | no | TurnService 透明使用 Gateway，无需修改 |
| novel_persistence | no | 不涉及 |
| novel_web | no | 不涉及 |
| frontend | no | VS-012 消费 |
| docs/design-v2 | no | 只引用既有 contract |
| config | yes | `config/config.exs` 新增 Anthropic API key 配置项 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 设计 `Provider.Usage` + `Provider.Result` struct | done | `input_tokens, output_tokens, model, latency_ms`；同时更新 `Provider` behaviour 的 `@type result` |
| T2 | 升级 `Provider` behaviour：返回值从 `{:ok, String.t()}` 改为 `{:ok, %Result{}}` | done | 回传 token 计数；向后兼容——stub 返回 `usage: nil` |
| T3 | 实现 `Provider.Anthropic` adapter | done | 使用 `Req` HTTP 调用 Anthropic Messages API；API key 从 config 读取；支持 `claude-sonnet-4-6` / `claude-opus-4-7` 等 model 配置 |
| T4 | 更新 Gateway：注册 Anthropic + 自动包装旧版返回值 | done | Gateway 注册 3 个 provider（stub/lmstudio/anthropic），dev 默认 `:lmstudio`，test 默认 `:stub` |
| T5 | 更新所有调用方（Router/TurnService/Writer/SimpleComplete）适配 `%Result{}` | done | 使用 Gateway.chat/3 替代直接 complete/2；传递 usage 信息到 audit log |
| T6 | 补齐测试：Anthropic adapter + 更新所有现有测试兼容新接口 | done | Anthropic adapter 测试；Gateway 测试更新；全链路现有测试适配 `%Result{}` |

## 5. 验证

- [x] `mix compile --warnings-as-errors` — 零警告
- [x] `mix test` — 370 tests, 0 failures（+4 new: Anthropic adapter + Gateway anthropic 注册）
- [x] `mix xref graph --format cycles --label compile-connected --fail-above 0` — No cycles
- [x] `mix run scripts/arch_check.exs` — 1 pre-existing violation（provider_controller.ex）
- [x] `bash scripts/ai_static_scan.sh --top 10` — 11/13 passed, 5 findings（0 new, 2 touched pre-existing）
- [x] `cd frontend && pnpm typecheck && pnpm test` — 12 tests, 0 failures

## 6. 决策日志

- 2026-04-30 — **Provider 返回值升级方案**：选择 `Provider.Result` struct 包装方案（`{:ok, %Result{content: ..., usage: ...}}`），而非 3-tuple `{:ok, content, usage}`。理由：(1) 可扩展性好——未来新增字段不破坏 tuple arity；(2) 模式匹配更清晰——`{:ok, %{content: c}}` vs `{:ok, c, _}`；(3) Gateway 层自动包装旧版 `{:ok, string}` 返回值，保证向后兼容。
- 2026-04-30 — **不新增 `chat/3` callback**：原计划新增 `chat(system_prompt, messages, opts)` 接口，实际发现当前所有调用方只使用单一 prompt 模式（Router 分类、TurnService 生成文本）。Anthropic adapter 当前也不支持 system prompt，保留为后续需求驱动。
- 2026-04-30 — **Anthropic API key 配置**：支持两层配置读取——`config :novel_agent, NovelAgent.Provider.Anthropic, api_key: "..."` 和环境变量 `ANTHROPIC_API_KEY`（`System.get_env` 兜底）。环境变量优先级更高，符合 12-factor 原则。
- 2026-04-30 — **dev 环境默认 provider 保持 `:lmstudio`**：项目开发阶段使用本地 LLM（LM Studio/Ollama），零 token 费用 + 离线可用。Anthropic adapter 作为可选的云端 provider 已注册到 Gateway，用户可通过修改 config 切换。LLM 不可用时 Gateway 直接返回错误，不做静默降级。
- 2026-04-30 — **`UpstreamError` 错误类型**：Anthropic adapter 最初使用了 `:auth_error` type，但 `UpstreamError` 的有效类型是 `:auth`。已修正。401/403 状态码统一映射为 `:auth`（retryable: false）。

## 7. 试行反馈

- Provider 返回值升级影响面可控——只触及 3 个调用方（Router/TurnService/Writer）+ 4 个测试文件。所有修改都是模式匹配的 syntactic change，无逻辑变更。
- `Provider.Result` + `Provider.Usage` 两个 struct 保持轻量——只定义字段和 `new/1` 构造函数，不承载业务逻辑。符合 Shared Kernel 定位。
- Anthropic adapter 的 `handle_success/3` + `handle_http_error/2` 提取有效降低了 `complete/3` 的复杂度，同时提升可读性。LMStudio adapter 的 complete/3 也可按同样模式重构（下次触及该文件时）。
- Credo CyclomaticComplexity 对 HTTP adapter 的 case 分支模式过于敏感——每个 HTTP status 分支都需要一个 case clause，这是合理的设计模式。后续可考虑为特定文件配置 Credo 豁免。
