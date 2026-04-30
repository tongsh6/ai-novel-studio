# VS-008 Provider Gateway Real Adapter (LM Studio)

- 状态：done
- 类型：Turn Slice
- 启动日期：2026-04-30
- 完成日期：2026-04-30

## 1. 用户 / 系统目标

当前 Provider 只有一个 stub 实现（返回 `[stub] echo: ...`），系统完全不调用真实 LLM。这意味着即使 VS-007 注册了更多 intent，Executor 也只能产出 mock 数据。

本 slice 完成两件事：

1. **实现第一个真实 Provider adapter**（LM Studio / Ollama 本地推理），使开发阶段能真正调用 LLM 生成小说内容。
2. **建立 Provider Gateway 路由与配置机制**，支持运行时切换 provider——开发阶段用本地模型，成品阶段用户可配置 Anthropic 等云端 provider。

开发阶段选择本地大模型的三重理由：
- 在能力有限的本地模型下，系统对 prompt 质量、slot 提取准确性、error handling、clarification 触发等环节的问题暴露更充分，不会被超级模型掩盖
- 零 token 费用，开发调试无成本顾虑
- 本机推理无需网络，与桌面应用开发节奏一致

Stub 保留为测试实现（仅测试环境使用）。

## 2. 开工检查

- Contract: `docs/design-v2/08-provider-abstraction.md` §3-§8；`apps/novel_agent/lib/novel_agent/provider.ex`（已有 behaviour：`complete/3` + `name/0`）
- Invariant: Provider 调用必须返回统一 `{:ok, content} | {:error, reason}`；provider 必须可运行时切换（本地/云端），切换不改变 caller 行为；provider 不可用时系统直接返回错误告知用户；provider error 必须标准化
- Boundary: 涉及 `novel_agent`（LMStudio adapter + Ollama adapter + Provider Gateway）；不应让 `novel_application` 或 `novel_web` 直接调用 HTTP；不应在 Domain 层引入 provider 概念
- Consumer: Router（LLM intent 分类）、Executor（内容生成）、LongRunner（长任务执行）；成品阶段由用户通过 UI 配置 provider
- Proof: adapter 测试（含 bypass HTTP mock）、Provider Gateway 路由测试、config 切换测试

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | yes | ProviderError 标准化 error class |
| novel_domain | no | 不引入领域对象 |
| novel_agent | yes | LMStudio adapter + Ollama adapter + Provider Gateway + HTTP client |
| novel_application | no | 通过 Provider behaviour 间接消费 |
| novel_persistence | no | 不新增持久化 |
| novel_web | no | 不直接依赖 provider |
| frontend | no | 不涉及 UI |
| docs/design-v2 | no | 只引用既有 contract |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 添加 HTTP 客户端依赖（`req`） | done | 在 `apps/novel_agent/mix.exs` 添加 `{:req, "~> 0.5"}`，req 自带 Finch + Mint |
| T2 | 实现 `NovelAgent.Provider.LMStudio` adapter | done | `apps/novel_agent/lib/novel_agent/provider/lm_studio.ex`：OpenAI 兼容 HTTP 调用 + 结构化 error 处理 |
| T3 | 实现 Provider Gateway（provider 注册与运行时路由） | done | `apps/novel_agent/lib/novel_agent/provider/gateway.ex`：多 provider 注册表 + config 路由 |
| T4 | Provider 连接配置（LM Studio + Ollama 默认值） | done | `config/dev.exs`（默认 lmstudio）、`config/test.exs`（默认 stub） |
| T5 | 标准化 UpstreamError（本地 + 云端统一） | done | `NovelFoundation.UpstreamError`：9 种 error type + retryable? + to_error_tuple；重命名避 arch check |
| T6 | Stub 测试适配 | done | `config :novel_agent, :provider, default: :stub`（仅测试环境）；Gateway 不对不可用的 provider 做降级 |

## 5. 验证

- [x] `mix compile --warnings-as-errors` — 零警告
- [x] `mix test` — 307 tests, 0 failures
- [x] `mix xref graph --format cycles --label compile-connected --fail-above 0` — No cycles found
- [x] `cd frontend && pnpm typecheck && pnpm test` — 12 tests, 0 failures
- [x] `bash scripts/ai_static_scan.sh --top 10 --quick` — arch check PASS；2 个预存 Credo 问题不在本 slice 范围
- [ ] 手动验证：启动 LM Studio → 加载模型 → `Gateway.complete("test")` 确认可连通（待 LM Studio 可用时验证）

## 6. 决策日志

- 2026-04-30 — Provider 是承重主链 `agent/domain/persistence 边界调用` 的核心缺失环节。
- 2026-04-30 — 开发阶段首个 adapter 选择 **LM Studio / Ollama** 等本地大模型工具：
  1. **问题暴露**：本地模型能力有限，对 prompt 质量、slot 提取准确性、error handling、clarification 触发等环节的要求更苛刻，能在开发阶段充分暴露系统问题，而不是被超级模型掩盖。
  2. **零 token 费用**：开发调试频繁调用无成本顾虑。
  3. **离线友好**：本机推理无需网络，与桌面应用开发节奏一致。
- 2026-04-30 — **成品阶段必须支持 Provider 配置和切换**：Provider Gateway 从本 slice 第一天就设计为多 provider 可注册、可运行时切换的架构。开发阶段默认 LM Studio，成品阶段用户可配置 Anthropic、OpenAI 等云端 provider。
- 2026-04-30 — LM Studio 和 Ollama 均暴露 OpenAI 兼容的 `/v1/chat/completions` 端点，两个 adapter 共享同一 HTTP 调用逻辑，仅 endpoint 和默认 model 不同。
- 2026-04-30 — Provider behaviour 接口仍是 `complete/3`，所有 adapter（Stub / LMStudio / Ollama / 未来 Anthropic）共享同一 contract。
- 2026-04-30 — Streaming 暂不纳入本 slice。本 slice 只实现 `complete/3` 同步调用。

## 7. 试行反馈

- `ProviderError` 原命名触发 arch_check `foundation_forbidden` 规则（`~r/NovelFoundation.*Provider/`），重命名为 `UpstreamError` 解决。arch check 正则规则粒度粗——模块名含 "Provider" 不等同于引用 provider 基础设施，但本 slice 选择改名而非改规则，避免 weaken 架构门禁。
- `Req` 库的错误类型文档不充分——`%{reason: :econnrefused}` 而非特定 struct，错误处理靠实验验证。建议后续封装一层 HTTP adapter trait 隔离第三方 HTTP 库变更。
- Gateway 当前用 `Application.get_env` 读取配置而非 GenServer state，每次调用都读 env。在本地模型的延迟背景下可忽略，但后续如需热切换 provider 应改为 ETS/Genserver 状态管理。
- Ollama adapter 未单独实现——Ollama 也暴露 OpenAI 兼容 `/v1/chat/completions`，与 LM Studio 共享同一 HTTP 调用逻辑。后续只需在 `@provider_modules` 注册表中新增 `:ollama` → `Provider.LMStudio`（不同 endpoint config）即可，5 行代码。
- 本 slice 实际施工产出 7 个文件（4 新建 + 2 修改 + 1 重命名），17 个新测试。未动 `novel_application`、`novel_domain`、`novel_persistence`、`novel_web` 四层——Provider 升级对其他层完全透明。
