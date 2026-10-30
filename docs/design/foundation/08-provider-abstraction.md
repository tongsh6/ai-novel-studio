# Provider Abstraction Contract

> 状态：v3 体系领域层 · 当前权威（横切契约）。归 v3 治理、服从 v3 原则（见 `docs/design/README.md`「整合原则：以 v3 为主体，吸取 v2」）；标题/历史中的 v2 仅为来源标记。
>
> 角色：`docs/design/foundation/00e-architecture.md` 的 Provider Abstraction 子系统展开文档，并依赖 `docs/design/03-capability-toolbox-contract.md` 与 `docs/design/04-execution-orchestrator.md`。
>
> 目标：定义 v2 中模型与外部智能能力提供者的统一抽象 contract，明确 provider interface、message/result 结构、usage 计量、error class、streaming、retryability、model selection 和 stub provider 的地位。

---

## 1. 文档定位

本文回答 8 个问题：

1. Provider abstraction 为什么必须存在
2. Domain 和 capability 层能否直接依赖某个模型 SDK
3. provider 的最小接口是什么
4. streaming 和 non-streaming 的统一结果语义是什么
5. usage 如何统一计量
6. provider error 如何标准化
7. retryability 应由谁决定
8. stub provider 在体系里是 mock 还是正式实现

本文不负责：

- 具体某个供应商的 SDK 适配实现
- 模型选择策略的业务 heuristics
- prompt 模板内容

本文只定义 provider 抽象 contract。

---

## 2. 设计目标

### 2.1 Provider 必须是可替换依赖

Foundation 不应把任何业务路径绑死在：

- 某个模型厂商
- 某个 SDK
- 某个本地推理服务

Provider 只是系统获得生成、解析、打分或结构化输出的一类依赖。

### 2.2 业务层不能直接碰 SDK

Domain、capability、orchestrator 不应直接调用供应商 SDK。

否则会导致：

- usage 统计失真
- error 处理不一致
- retry 策略散落
- streaming 语义分裂

### 2.3 streaming 和 non-streaming 必须共用同一语义层

无论底层是一次性返回还是流式返回，系统最终都必须能统一表达：

- 内容
- 结构化输出
- usage
- status
- error
- cancellation

### 2.4 stub provider 是正式实现

为了 greenfield 开发、契约测试和离线验证，stub provider 必须被视为正式 provider implementation，而不是只在测试里临时 mock。

---

## 3. Provider 的定义

在 v2 中，`provider` 指任何向系统提供“模型型智能结果”的后端实现。

它可以是：

- 云端大模型 API
- 本地推理服务
- 规则型 stub provider
- 未来的 specialized model service

Provider abstraction 的职责是：

1. 统一请求入口
2. 统一响应结果
3. 统一 usage 计量
4. 统一 error 分类
5. 统一 streaming 事件语义
6. 统一 cancellation 支持

---

## 4. Provider Interface Contract

### 4.1 最小接口集

Foundation 至少要求 provider 暴露：

1. `complete`
2. `stream`
3. `estimate`
4. `describe`

### 4.2 `complete`

用于一次性请求并返回完整结果。

抽象签名方向：

```text
complete(request: ProviderRequest) -> ProviderResult
```

### 4.3 `stream`

用于流式返回。

抽象签名方向：

```text
stream(request: ProviderRequest) -> ProviderEvent*
```

### 4.4 `estimate`

用于执行前预估成本与可行性。

抽象签名方向：

```text
estimate(request: ProviderRequest) -> ProviderEstimate
```

### 4.5 `describe`

用于返回 provider 的静态能力与限制。

抽象签名方向：

```text
describe() -> ProviderDescriptor
```

---

## 5. ProviderRequest Contract

所有 provider 请求都必须经过统一请求对象。

### 5.1 最小字段

至少包括：

- `request_id`
- `provider_profile_ref`
- `model_ref`
- `messages`
- `response_mode`
- `schema_ref`（可空）
- `temperature`（可空）
- `max_output_tokens`（可空）
- `timeout_ms`
- `budget_ref`
- `trace_ref`
- `metadata`

### 5.2 `messages`

是 provider-neutral 的消息数组，不应直接使用某家 SDK 的原生结构作为系统主格式。

### 5.3 `response_mode`

至少支持：

- `text`
- `json`
- `tool_like_structured`

### 5.4 `schema_ref`

如果请求期待结构化输出，必须显式给出 schema ref，而不是只在 prompt 文本里隐含。

### 5.5 `provider_profile_ref`

用于区分：

- 不同 provider 实现
- 同 provider 的不同配置

---

## 6. Provider-neutral Message Contract

provider 抽象层必须定义统一 message shape。

### 6.1 最小字段

至少包括：

- `role`
- `content`
- `content_type`
- `name`（可空）
- `metadata`（可空）

### 6.2 `role`

至少支持：

- `system`
- `developer`
- `user`
- `assistant`
- `tool`

### 6.3 `content_type`

至少支持：

- `text`
- `json`
- `parts`

### 6.4 Provider adapter 的职责

adapter 负责把 provider-neutral messages 转成供应商所需格式。

系统其他层不得直接依赖某个供应商的 message 结构。

> `system` role 的首个承重消费者是系统身份消息：内容真源、Gateway 唯一注入点、各 adapter 对 `system` role 的渲染责任矩阵、trace 只落引用不落原文、`cached_tokens`（§9.1）的落地分期，见 `docs/design/contracts/VS-00H-system-identity-message-contract-pack.md`。

---

## 7. ProviderResult Contract

non-streaming 返回必须统一成同一种结果结构。

### 7.1 最小字段

至少包括：

- `request_id`
- `provider_ref`
- `model_ref`
- `status`
- `finish_reason`
- `output_text`
- `output_structured`（可空）
- `raw_ref`（可空）
- `usage`
- `latency_ms`
- `warnings`
- `error_ref`（可空）

### 7.2 `status`

至少支持：

- `SUCCEEDED`
- `FAILED`
- `CANCELLED`
- `PARTIAL`

### 7.3 `finish_reason`

至少支持抽象语义：

- `STOP`
- `LENGTH`
- `TOOL_BOUNDARY`
- `CONTENT_FILTERED`
- `CANCELLED`
- `ERROR`

### 7.4 `output_structured`

当请求需要结构化输出时，结构化结果必须作为显式字段存在，而不是只留文本让上层再猜。

---

## 8. ProviderEvent Contract

streaming 返回必须统一成事件流。

### 8.1 最小事件类型

至少支持：

- `STREAM_STARTED`
- `TOKEN_DELTA`
- `STRUCTURED_DELTA`
- `USAGE_UPDATE`
- `WARNING`
- `STREAM_COMPLETED`
- `STREAM_FAILED`
- `STREAM_CANCELLED`

### 8.2 最小事件字段

至少包括：

- `event_id`
- `request_id`
- `event_type`
- `seq_no`
- `payload`
- `timestamp`

### 8.3 streaming 与 final result 的关系

streaming 结束后，系统必须能整理出一个等价的 `ProviderResult`。

也就是说：

- streaming 是增量过程
- ProviderResult 是归并后的稳定结果

### 8.4 事件顺序

同一 request 的 ProviderEvent 必须有严格单调的 `seq_no`。

---

## 9. Usage Contract

usage 计量是 provider abstraction 的核心职责之一。

### 9.1 usage 最小字段

至少包括：

- `prompt_tokens`
- `completion_tokens`
- `total_tokens`
- `cached_tokens`（可空）
- `ttft_ms`（可空；流式首 delta 墙钟，非流式 = `wall_time_ms`）
- `estimated_cost`
- `provider_billed_cost`（可空）
- `wall_time_ms`

### 9.2 estimate 与 actual 分离

系统必须区分：

- estimated usage
- actual usage

不能把 estimate 当真实消耗入账。

### 9.3 usage 的归属

每次 usage 必须能追溯到：

- turn
- task
- capability invocation
- provider request

### 9.4 usage 统一归口

无论底层 provider 如何计费，系统统一使用 Foundation usage envelope 向上暴露。

---

## 10. ProviderError Contract

provider error 必须标准化，不能把原始 SDK 异常直接往上抛。

### 10.1 最小字段

至少包括：

- `error_id`
- `provider_ref`
- `request_id`
- `error_class`
- `message`
- `raw_error_ref`（可空）
- `retryable`
- `throttle_related`
- `timeout_related`
- `auth_related`
- `schema_related`

### 10.2 `error_class`

至少支持：

- `NETWORK_ERROR`
- `TIMEOUT`
- `THROTTLED`
- `AUTH_ERROR`
- `INVALID_REQUEST`
- `MODEL_UNAVAILABLE`
- `MALFORMED_RESPONSE`
- `CONTENT_FILTERED`
- `UNKNOWN_PROVIDER_ERROR`

### 10.3 retryable

provider 层可以给出建议，但最终是否 retry 由：

- retry policy
- capability registry
- task runtime

共同决定。

> B22：超时类错误的 `timeout_kind` 结构诊断、三层存活时限与作者安全文案规则见 §25。

---

## 11. Retryability Contract

### 11.1 Provider 只能提供可重试提示

provider 不应自行无上限 retry。

它应只报告：

- 是否可重试
- 建议 backoff
- 是否属于瞬时失败

### 11.2 最终 retry 决策层级

最终 retry 决策顺序应为：

1. provider error hint
2. capability retry support
3. task retry policy
4. budget / timeout guard

### 11.3 不应自动 retry 的情况

至少包括：

- auth error
- invalid request
- schema mismatch caused by caller contract bug
- hard budget exceeded

---

## 12. Model Selection Contract

Provider abstraction 不直接负责业务路由，但必须提供选择模型的稳定入口。

### 12.1 model_ref

所有请求都必须带 `model_ref` 或通过 provider profile 可解析到具体模型。

### 12.2 模型选择与 capability 解耦

capability 可以表达“我需要什么能力等级”，但不应直接把模型名写死在业务逻辑里。

### 12.3 建议抽象

至少允许：

- explicit model binding
- profile-based default model
- policy-selected model

---

## 13. ProviderDescriptor Contract

`describe()` 返回的 descriptor 用于程序记忆与 explainability。

### 13.1 最小字段

至少包括：

- `provider_name`
- `provider_version`
- `supports_streaming`
- `supports_json_mode`
- `supports_cancellation`
- `supports_estimate`
- `default_timeout_ms`
- `known_limits`
- `status`

### 13.2 用途

至少用于：

- runtime capability checks
- explainability
- operator diagnostics

---

## 14. Stub Provider Contract

stub provider 是正式 provider implementation。

### 14.1 stub 的用途

至少包括：

- contract tests
- offline development
- deterministic replay-like scenarios
- UI prototyping

### 14.2 stub 必须遵守同样的接口

stub 不能绕过：

- ProviderRequest
- ProviderResult / ProviderEvent
- usage envelope
- error envelope

### 14.3 stub 不是 mock

mock 可以只为某个测试服务。  
stub provider 则是体系内的正式实现类型。

---

## 15. Provider 与 Capability 的边界

### 15.1 capability 调 provider，但 provider 不知道业务 intent

Provider 不应感知：

- novel intents
- chapter / scene 等业务术语
- adoption policy

### 15.2 capability 负责把业务需求翻译成 provider request

Provider 只接收标准化请求并返回标准化结果。

### 15.3 provider 不做业务校验

Provider 可以报告 schema / response 问题，但不能替代 Domain validator 判断“这段内容是否符合小说业务要求”。

---

## 16. Provider 与 Long-Run 的关系

long-run 大量依赖 provider，因此 provider contract 必须支持长跑语义。

### 16.1 long-run 依赖的 provider 特性

至少包括：

- estimate
- cancellation
- usage reporting
- retryable error hints

### 16.2 partial result

如果 streaming 中断，系统必须能判断：

- 是否存在 partial result
- partial result 是否可保留为 tentative artifact

### 16.3 provider cancellation

provider 支持 cancellation 时，必须能把：

- request cancelled
- stream cancelled

统一映射为标准结果或事件。

---

## 17. Provider 与 Observability 的关系

Provider 是观测性的重要来源。

### 17.1 trace 最低要求

至少要记录：

- provider request start/end
- model_ref
- latency
- usage
- error class
- stream lifecycle

### 17.2 raw_ref

如需保留原始 provider 输入输出，必须通过 `raw_ref` 间接引用，而不是把大块原始数据污染主结果对象。

### 17.3 explainability

至少要能回答：

- 这次调用用了哪个 provider / model
- 为什么失败
- 是否可重试

---

## 18. Provider 与 Security 的关系

Provider abstraction 还承担部分安全边界。

### 18.1 provider 不应接触未过滤的内部实现细节

传给 provider 的 request 必须经过系统边界整理。

### 18.2 raw error 不应直接暴露给 UI

原始错误信息可能包含：

- 内部 endpoint
- secret-ish metadata
- provider-specific noise

因此必须先标准化。

### 18.3 content filter 也是 provider 信号

如果 provider 返回内容过滤相关信号，必须以标准 error / finish_reason 暴露给上层。

---

## 19. Provider 与 Domain 的接口

Domain 不应直接注册 provider adapter，但可以声明能力需求。

### 19.1 Domain 可声明

至少包括：

- preferred response mode
- structured output requirement
- latency sensitivity
- determinism sensitivity

### 19.2 Domain 不得改写

Domain 不得改写：

- provider request/result 主结构
- usage envelope
- error class
- streaming event 基本语义

---

## 20. 持久化与事件要求

至少要持久化或可引用：

- provider requests refs
- provider results refs
- provider raw refs
- usage records
- provider errors

### 20.1 最小事件集合

至少包括：

- provider_request_started
- provider_request_succeeded
- provider_request_failed
- provider_stream_started
- provider_stream_completed
- provider_stream_failed
- provider_request_cancelled

---

## 21. 契约测试要求

### 21.1 interface tests

验证：

- complete / stream / estimate / describe 均可工作
- stub provider 遵守同一 contract

### 21.2 usage tests

验证：

- estimated / actual usage 分离
- usage 可归属到 request / turn / task

### 21.3 error tests

验证：

- provider raw errors 被标准化
- retryable hints 正确暴露

### 21.4 streaming tests

验证：

- event seq_no 单调
- streaming 最终可归并为 ProviderResult

---

## 22. 本文冻结的硬骨

本文正式冻结以下 provider 硬骨：

1. Provider 是可替换依赖
2. 业务层不得直接依赖 provider SDK
3. provider 至少暴露 `complete / stream / estimate / describe`
4. streaming 与 non-streaming 必须归并到统一结果语义
5. usage 必须统一计量并可追溯
6. provider error 必须标准化
7. provider 只提供 retry hint，最终 retry 决策不在 provider 层
8. stub provider 是正式实现，不是临时 mock

---

## 23. 本文暂不冻结的内容

以下只定边界，不定最终实现：

1. provider adapter 的具体模块结构
2. model selection policy 的最终算法
3. raw_ref 的最终存储后端
4. messages parts 格式的最终细节

---

## 24. 下一步

provider 之后，建议继续：

1. `09-observability-and-audit.md`

因为 usage、trace、raw_ref、error class 都已经定了，接下来最自然的是把观测与审计的统一 contract 补齐。

---

## 25. Timeout, Liveness and Budget Policy (B22)

> 状态：B22 方向冻结（2026-10-22 作者拍板「只要还在稳定出字就不杀」）；本节数值是 bootstrap 默认值（可经 env/配置覆盖），按模型实测的自适应校准归 B22 CP4。本节替代「单一 `timeout` = 单次调用总挂钟上限」的旧口径；§9 usage、§10 provider error、§11 retryability 的既有语义不变，本节只在超时路径上新增结构化诊断与作者可见的等待事实。

### 25.1 为什么默认不再用「总挂钟」杀灭

本产品允许单次模型调用合法运行 10–60 分钟，整条任务链可能跑数小时。作者侧 2026-10-22 真机观测（本地推理后端，B22 立项依据）显示：

- TTFT 27s–195s（排队、预填充、思考都可能计入），吞吐 26–66 tok/s，成功调用最长达 ~695s；
- 旧实现把单个 `timeout`（默认 300s）当作总挂钟上限，已实测误杀 3 次仍在稳定出字的健康调用。

因此冻结原则：**只要模型还在稳定出字就不杀**。总时长不承担默认控制；「该停不停」由 token 预算兜住（§25.4），「是否还活着」由「多久没有 wire data」承担（§25.2）。

### 25.2 三层时钟 + 可选总时长兜底

| 时钟 | 语义 | 默认 | 由谁执行 |
|---|---|---|---|
| `connect_ms` | TCP/TLS 连接建立 | 15_000 | Req `connect_options` |
| `response_ms` | 流式请求两次 wire data 之间的最长静默（等首包 / 等下一块） | local 900_000；hosted = legacy `timeout`（默认 300_000） | Req `receive_timeout`（流式） |
| `non_stream_ms` | 非流式请求（工具调用等无中间进展可观测）等待完整响应 | local 1_800_000；hosted = legacy `timeout`（默认 300_000） | Req `receive_timeout`（非流式） |
| `deadline_ms` | 可选总挂钟兜底；`nil` = 不启用（默认） | `nil` | 流式 adapter 应用层判定 |

- `response_ms` 是「多久没数据算挂死」的异常检测窗口，不是业务时限：只要还有任何 wire data（正文 delta、思考 delta、keepalive 等）到达，窗口就重新计时，调用继续。流式首字节之前的排队 / 预填充 / 思考都在这同一个窗口内等待。
- `non_stream_ms` 单独存在，因为非流式请求没有可观测的中间进展，无法像流式那样把「无数据」与「无进展」分开。
- `deadline_ms` 默认关闭，只用于部署侧强制限流或测试；未显式配置时不存在（不杀）。
- 健康检查 / 模型列表等轻量探测使用固定短窗（15s 上限；legacy 值更短时尊重 legacy），避免 UI 被长 timeout 拖住。
- 非流式工具调用路径（OpenAI 兼容 / LM Studio / DeepSeek / Anthropic）统一使用 `non_stream_ms`；Anthropic 的 tool-call 经 `do_complete/4` 接收 policy 注入的等待窗口。response 与 non_stream 两个窗口都不能兼任「单次调用总时长」。

### 25.3 Profile、解析顺序与配置旋钮

Profile：`local` = `:lmstudio` / `:strata`（同一套本机推理后端）；`hosted` = 其余所有 provider。

解析优先级（`NovelAgent.Provider.TimeoutPolicy.resolve/2` 是唯一真源）：

`response_ms` / `non_stream_ms`：

1. provider 配置显式 `response_timeout:` / `non_stream_timeout:`
2. env `NOVEL_<PROVIDER>_RESPONSE_TIMEOUT_MS` / `NOVEL_<PROVIDER>_NON_STREAM_TIMEOUT_MS`
3. profile 组 env：local 用 `NOVEL_LOCAL_RESPONSE_TIMEOUT_MS` / `NOVEL_LOCAL_NON_STREAM_TIMEOUT_MS`；hosted 用 `NOVEL_HOSTED_RESPONSE_TIMEOUT_MS` / `NOVEL_HOSTED_NON_STREAM_TIMEOUT_MS`
4. legacy env `NOVEL_<PROVIDER>_TIMEOUT_MS`（B22 前是单次调用总时长；现在同时作为 response / non_stream 兜底）
5. provider 配置 legacy `timeout:`
6. profile 默认（local 900_000 / 1_800_000；hosted 300_000 / 300_000）

`deadline_ms`（只有显式配置才启用）：

1. provider 配置 `deadline_timeout:`
2. env `NOVEL_<PROVIDER>_DEADLINE_TIMEOUT_MS`
3. profile 组 env `NOVEL_LOCAL_DEADLINE_TIMEOUT_MS` / `NOVEL_HOSTED_DEADLINE_TIMEOUT_MS`
4. 全都没有 → `nil`（关闭）；`0` / `"off"` / `"disabled"` 也视为关闭

`connect_ms`：provider 配置 `connect_timeout:` > env `NOVEL_<PROVIDER>_CONNECT_TIMEOUT_MS` > 15_000。`<PROVIDER>` 为 provider atom 的大写形式（`LMSTUDIO`、`STRATA`、`ANTHROPIC`、`DEEPSEEK`、`OPENAI` 等）。

配置落点与行为变化：

- `config/config.exs` / `config/dev.exs` / `config/prod.exs`：本地 provider（LM Studio / Strata）不再配置总时长 `timeout`；hosted provider 保留 legacy `timeout`（默认 300_000），只作为 response / non_stream 窗口兜底，不再承担总时长杀灭。
- 行为变化点：hosted provider 的 legacy `timeout` 过去兼作流式总挂钟（约 300s 必杀），现在只决定「多久没数据算挂死」；单次调用总时长默认不再有上界。
- 唯一注入点：`NovelAgent.Provider.Gateway.execute/4` 的 `resolve_timeout_policy/2` 解析后写入 execution context（`ctx.timeout_policy`）；adapter 侧只经 `NovelAgent.Provider.AdapterExecution` 的 `timeout_policy/1`、`response_timeout/2`、`non_stream_timeout/2`、`deadline_timeout/1`、`connect_timeout/2`、`probe_timeout/1` 消费，不自行读 env。
- 兼容：直接调用 adapter 的测试 / 旧路径没有 policy 时回退 legacy `state.timeout`，行为与 B22 前一致；生产主链走 `Gateway.execute/4`，不依赖该回退。
- §5.1 抽象的 `timeout_ms` 单值字段与 §13.1 的 `default_timeout_ms` 不再有「总时长」语义：前者由本节 response / non_stream 两层承载，后者只是描述字段，不参与解析。

### 25.4 token 预算与 run 级预算边界

- 「该停不停」由 provider 配置层的 `max_tokens` 兜住（`config/config.exs` 的 `max_tokens`、`NovelAgent.Provider.InferenceParams` 的 caller 覆盖；本地默认 32000）。B22 不改变 token 预算语义，也不重新引入跨 provider 的通用字面量默认值。
- 单调用不设总挂钟后，数小时任务链的 **run 级预算 / checkpoint / 后台化 / 通知** 仍是未实现缺口，不由本节假装解决；运行预算归 `tasks/slices/UA01-dynamic-agent-run-budget.md` 与 `NovelApplication.AgentRunBudget`（现有实现不属于 B22 范围）。

### 25.5 超时错误契约：结构诊断 + 作者安全文案

超时仍走 §10 的标准 provider error（`error_class = TIMEOUT`；`NovelFoundation.UpstreamError.retryable?(:timeout) = true`）。B22 在错误 `details` 上增加结构诊断，`UpstreamError.to_error_tuple/1` 原样透传 `details` 到调用方 error map：

| `timeout_kind` | 含义 |
|---|---|
| `:connection_stall` | 一次生成内容都没出现就遇到 wire 静默：排队、预填充、静默思考、连接停摆 |
| `:stream_interrupted` | 已经产出过生成内容后遇到 wire 静默（流中断） |
| `:deadline` | 仅当部署侧显式启用 `deadline_ms` 且总挂钟到达时 |

`details` 至少携带：`response_timeout_ms`、`deadline_ms`、`duration_ms`、`ttft_ms`、`output_chars`、`output_chunks`、`wire_chunks`（`OpenAICompatibleStream` / `AnthropicStream` 的 `diagnostics` 分支）。`details` 只允许结构事实，不得包含 prompt、CoT / thinking 原文或任何 secret。

作者可见文本只能由 `timeout_kind` + 数字派生，绝不透传 provider 原始 message（N-NARR / `docs/design/ui/47-ui-copy-guidelines.md` 文案红线）：

- 应用层 `NovelApplication.Planner.provider_failure_fallback_message/1`：`connection_stall` →「没有返回任何生成内容（可能仍在排队、预填充或思考）…」；`stream_interrupted` →「输出中途中断…」；`deadline` →「超过部署侧配置的总时长上限…」；无 details 的旧错误保留通用超时文案。
- AgentRun 失败终局：`AgentRunServer.failure_family_reason_codes/1` 给出可检索原因码 `provider_error` + `provider_timeout_connection_stall` / `provider_timeout_stream_interrupted` / `provider_timeout_deadline`；`failure_author_summary/1` 只用结构类别与字数（例如「模型输出中途中断（已生成 N 字）…」）作为 `run_failed` 摘要。
- 所有失败终局仍返回安全兜底 TurnResult（「没有创建待采纳内容，也没有写入作品事实」），作者在对话流中始终有下文；diagnostics 只经 adapter 日志钩子（llm-calls JSONL）与业务日志消费。

### 25.6 重试策略

- provider 层只给 hint（`:timeout` 的 `retryable` 为 `true`）；B22 不新增自动重试。
- 理由：10–60 分钟的本地调用若自动重试，成本翻倍且不解决排队 / 预填充慢的根因；误杀场景下正确的恢复是作者可见的失败 + 显式重发。
- 既有例外保持不变、不属于本策略新增：D4 计划起草的 provider 错误族单次瞬态重试（`tasks/slices/D4-planner-transient-retry.md`，`plan_draft.retry` 留痕）；作者显式操作触发的 `writer_timeout` scoped retry（`AgentRunServer` 的 `maybe_grant_writer_timeout_retry/2`）。run 级恢复仍以作者显式操作为准。
- 若未来要加有界自动重试，前置条件是 run 级时间 / 预算与可归因的重试上限，而不是在单调用层重新叠加挂钟。

### 25.7 作者可见性：真实等待时长

进行中的 AgentRun 在工作台显示真实墙钟等待（「已运行 N 分 M 秒」/「已运行 N 小时 M 分」），让慢模型不再看起来像卡死：

- 锚点 = 最新一条作者可见 `run_started` 事件的 `emitted_at`；没有时回退最早事件的 `emitted_at`；两者都没有则不显示，绝不用前端渲染时刻造起点。
- 5 秒门槛避免短任务闪烁；每秒 tick；只在 `created / running / pausing / cancelling` 显示，终态 / `awaiting_author` 不显示。
- 它只报已发生的时间，不是合成进度、不是百分比，也不替代 provider 事件与推理流（`docs/design/ui/46-state-and-feedback.md` §9.5 第 4 条「执行中标识必须全程连续」）。
- 实现：`frontend/src/components/WorkspaceChat.tsx`（`useAgentRunElapsedSeconds`）与 `frontend/src/lib/copy.ts`（`WORKBENCH.agentRunElapsedLabel`）。

### 25.8 诚实边界（未实现，不得当成已解决）

1. **只有心跳没有 token 的流不会被默认杀灭**：`response_ms` 只认 wire data；如果后端持续发 keepalive / 框架字节但不再产 token，尚无语义级 stall watchdog，调用会一直延续。
2. **没有按 `(provider, model, thinking)` 的自适应校准**：900s 是保守 bootstrap（实测 TTFT 最大 195s），不是按模型 p99 测量出的值；过紧的 response 窗口仍可能在极慢预填充上误杀。
3. **单机并发仍可能隐形排队**：多个调用同时打同一个本地推理后端时，请求可能在服务端排队，`response_ms` 在这段时间照常消耗。
4. **部分输出不可挽救**：`stream_interrupted` 只报告已产出字数，不把 partial content 变成待采纳草稿 / tentative artifact。
5. **没有自动重试**（§25.6）。
6. **数小时任务链的 checkpoint / 后台化 / 通知未实现**（§25.4）。
7. **真实页面验收未闭环**：慢但持续出字的流在真实 Tauri 工作台上的场景化验收仍待 B22 CP4，不拿单测冒充。
8. **诊断字段尚无真实调用抽样证据**：`timeout_kind` / ttft / chars / chunks 等 details 由单测覆盖，尚未在真实超时事件上抽样核对 llm-calls JSONL 与业务日志（B22 CP4 一并取证）。

---

## 26. Provider 多轮消息保真与请求投影（2026-10-30 登记，Proposed）

> 来源：作者要求对照 Codex、Claude Code、dsh 的真实多轮请求，评估本项目请求体的完善方向。本节约束消息与 provider 投影，不替代 VS-00H 的系统身份、VS-00I 的前缀稳定契约、B26 的单调用协议或 B39 的统一求证链。执行任务为 `tasks/slices/B71-provider-message-fidelity.md`；当前仅登记设计与证据，未 Accepted、未实现。

### 26.1 已核实事实与问题边界

- 外部真实多轮样本保留原生 `assistant` 工具调用、`tool` / `tool_result` 结果、消息顺序和 provider 特定推理元数据；脱敏样本位于 `artifacts/client-http-bodies/`。
- 本项目真实请求通常只有 `system + user`，一次契约纠错会形成 `system + user + user`。证据为 `log/llm-calls/stage/2026-10-29.jsonl` 第 8–9 行；这不等于真实 assistant 历史已完整进入请求。
- `NovelAgent.Provider.normalize_messages/1` 当前只保留 `role` 和字符串 `content`，会丢弃 `tool_calls`、`tool_call_id`、结构化 content blocks、`reasoning_content`、`cache_control` 等字段，因而不能无损投影多轮消息。
- 判断任务的共同规则、作品状态、会话摘要、操作目录和作者原话主要由一个大型 `user` 文档承载。 VS-00I 已定义 L0–L4 的稳定度与顺序，本设计不重新发明一套提示词骨架，也不移动其中有判例支撑的 L4。
- Strata 自动前缀缓存已实际命中：上述日志第 9 行 `cached_tokens=19037`。因此目标是保持并扩展可证明的缓存收益，不是假定“当前没有缓存”后全局增加缓存字段。

### 26.2 消息保真原则

1. 内部消息表达不得再把所有内容压成 `role + string content`；需要在 CP1 按真实消费者确定最小无损消息契约及字段，不在本设计登记时提前冻结 DTO。
2. Provider adapter 负责各自序列化：OpenAI 兼容通道的 `assistant.tool_calls` / `tool.tool_call_id`，Anthropic 的 content blocks / `tool_use` / `tool_result` / `cache_control`，DeepSeek 的 `reasoning_content` 等不得被通用归一化提前抹除。
3. 不支持的字段不得跨 provider 盲发。Strata、LM Studio、DeepSeek、Anthropic 和其他 OpenAI 兼容服务分别经过能力与黄金请求矩阵验证。
4. 作者原话、Provider 返回的 artifact 字段及其引用关系保持字节保真；消息重构不得修改 I1/I2/I3、N-NARR、作者采纳和 GateOrder 边界。
5. 推理与签名元数据只在确有原生多轮消费者时按 provider 保存和回放；不得把 CoT/thinking 当作者可见叙事，也不得发明跨 provider 的统一 reasoning 格式。

### 26.3 对话、重试与上下文投影

- 稳定产品规则、动态作品材料、真实对话和本轮作者输入应有明确的消息/段落归属；具体投影继续服从 VS-00H、VS-00I 和现有 ContextAssembler，不新增第二套上下文真源。
- 契约纠错若声明为多轮，应保留真实 assistant 响应及其原生工具调用，再追加纠错；若采用无状态重试，应重新构造完整请求并明确记录策略，不能用连续 `user` 消息冒充完整多轮历史。
- 现有 B26 单调用 `tool_choice: auto`、封装探索入口与调用计数不变。本设计不新增原生探索工具入口，不建立 writer 内第二套工具循环；B39 的观察继续经统一 AgentRun 和既有请求构造进入后续调用。
- 不迁移到 Responses API、不追求工具数量、不全局增加 `parallel_tool_calls` 或 `client_metadata`，也不把全量历史和作品档案无差别回送。

### 26.4 缓存与流式兼容

- 保持同调用点的稳定规则、工具 schema 和可复用上下文字节前缀稳定，易变版本与状态按 VS-00I 置后；不得为了缓存移动 L4 或改写作者/产物字节。
- Anthropic 的显式断点只按 VS-00I 的既有矩阵细化；OpenAI Responses 的 `prompt_cache_key` 仅在未来真实消费者存在时评估，不发送到其他通道。
- 对确认支持的 OpenAI 兼容通道可补 `stream_options.include_usage: true`；现有流解析已能消费 usage。Strata 当前已有 usage 与缓存命中，此字段属于兼容性增强而非紧急修复。

### 26.5 验收方向

CP1 先形成真实消费者、消息字段、重试策略和 provider 投影矩阵及黄金请求；后续实现必须证明：多轮消息顺序和工具调用 ID 关联不丢失、重试语义与声明一致、未知字段不越界发送、稳定前缀与缓存不退化、观察与引用仍进入实际后续请求。局部 golden/unit 证据不能替代外部自动化驱动真实 Tauri 工作台的场景验收；完整验收同时执行架构门禁和 I1/I2/I3。

