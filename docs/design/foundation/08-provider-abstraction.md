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
8. 测试替身如何遵守正式 Provider 接口并保持在产品边界之外

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

### 2.4 测试替身遵守正式接口，不进入生产注册表

确定性 Stub、fixture provider 与脚本 provider 必须遵守同一 Provider 接口，但只位于 `test/support`、脚本或外部 harness，通过测试配置显式注入。它们不是作者可选择的真实模型能力，不得注册进生产 app/runtime 或充当缺省模型。此规则按 `AGENTS.md` 场景化验收红线与 VS-00L §19 的源头重构原则取代早期“正式 Stub 实现”的部署含义；B71 负责迁移，历史离线验证证据不改写为真实模型证据。

---

## 3. Provider 的定义

在 v2 中，`provider` 指任何向系统提供“模型型智能结果”的后端实现。

它可以是：

- 云端大模型 API
- 本地推理服务
- 测试环境显式注入的规则型替身（不属于生产供应商集合）
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

Stub 是实现正式接口的确定性测试替身；部署边界见 §2.4。

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

### 14.3 测试实现与生产实现的边界

测试可以复用符合接口的 Stub，也可以为一个案例注入更窄的 mock。两者都不能进入生产注册表、被展示成真实模型能力，或用其通过结果代签真实模型语义。产品代码不识别测试场景；注入归测试/脚本环境。

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
8. 测试替身遵守同一接口，只由测试/脚本环境注入，不进入生产注册表

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

Profile：`local` = `:lmstudio` / `:strata` / `:splash`（同一套本机推理后端）；`hosted` = 其余所有 provider。

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

`connect_ms`：provider 配置 `connect_timeout:` > env `NOVEL_<PROVIDER>_CONNECT_TIMEOUT_MS` > 15_000。`<PROVIDER>` 为 provider atom 的大写形式（`LMSTUDIO`、`STRATA`、`SPLASH`、`ANTHROPIC`、`DEEPSEEK`、`OPENAI` 等）。

配置落点与行为变化：

- `config/config.exs` / `config/dev.exs` / `config/prod.exs`：本地 provider（LM Studio / Strata / Splash）不再配置总时长 `timeout`；hosted provider 保留 legacy `timeout`（默认 300_000），只作为 response / non_stream 窗口兜底，不再承担总时长杀灭。
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

## 26. AI Novel Studio 原生多轮创作请求体（2026-10-30 目标设计；2026-10-31 作者选 A，方向 Accepted）

> 来源：作者要求以“优秀且符合项目调性，不为现状妥协”为目标，重新对照 Codex、Claude Code、dsh 的真实多轮请求。本节是目标架构，不是现有 giant prompt 的最小修补，也不以现役 provider 的最低能力反向限定设计。执行任务为 `tasks/slices/B71-provider-message-fidelity.md`；目标方向与迁移规则已由 [ADR-0033](../adr/ADR-0033-authoring-run-transcript-request-ir-v3.md) 接受，替换契约 [VS-00L](../contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md) 已冻结并完成 CP2–CP4b 确定性实现；**2026-11-03 状态**：能力事实已收敛到单一派生边界（adapter 可证声明 → `CapabilityProfile` → IR/执行边界身份比对），全 true 假声明已删除，SSE 工具调用无损累积与 Responses 真实传输已落地；实模 CP3b、压缩前端入口设计授权与 CP5 收口仍未闭环（见 VS-00L §17）。现役 B26/B39/VS-00I 是迁移与 ADR 对账输入，不是降低目标的理由。
>
> **2026-11-04 R1 状态**：实际 route 单源——canonical IR 不再保存 target/capability_profile/provider_route；Gateway 按本次 provider/model/purpose/route_hint 解析唯一配置快照并派生能力，adapter 直接投影原生协议；`to_provider_prompt/2` 与构造/执行双身份比对已删除，测试替身移出生产注册表（§2.4/§14）。R1 已提交（2026-11-05）并通过确定性门禁；R2 统一流式与 Responses SSE 已完成确定性机制层（2026-11-07）；未闭环为 CP3b 实模、G6 压缩后真实请求、真实页面与 CP5（2026-11-08 状态更正）。

### 26.1 对照结论：吸收协议能力，不复制代码 Agent 形态

| 参照 | 值得吸收的真实能力 | 不能直接照搬的部分 |
|---|---|---|
| Codex | 有序 run input、assistant/tool 输出连续回流、压缩检查点、原生推理句柄 | 代码执行与壳工具语义；把服务端 response id 当运行事实源 |
| Claude Code | 类型化 content blocks、`tool_use/tool_result`、显式缓存断点、结构化推理配置 | 通用编码工具与庞大固定系统包；缺少作者采纳和作品权威分层 |
| dsh | 清晰的 assistant/tool 多轮消息、DeepSeek 推理回放、流式 usage | 没有小说证据引用、tentative artifact、作者裁决与阅读投影 |
| 本项目目标 | **统一 AgentRun 的原生多轮消息循环 + 求证证据链 + 作者主权 + 可回放** | 不再以单个巨型 `user` 文档模拟全部会话结构 |

本项目真实日志中常见的 `system + user` 以及纠错时的 `system + user + user`，只能说明单次结构化调用可用，不能作为目标消息协议。`normalize_messages/1` 丢弃原生工具字段是结果，不是需要保留的约束。

### 26.2 核心决断：AgentRun 是事实源，HTTP body 是投影

1. **不是 writer 内另起一个工具循环，而是统一 AgentRun 自己成为原生多轮会话。** Provider 的 assistant/tool 消息只是 run 内真实计划、调用、观察、校验和候选的投影；Orchestrator、预算、权限、恢复和作者活动流仍只有一套。
2. **内部采用丰富的 Authoring Run Transcript / Request IR，不采用最低公分母字符串消息。** 它保留消息来源、角色、顺序、工具调用、观察覆盖、版本、引用、校验结果、候选和检查点；adapter 只做无损投影。
3. **每个 provider 请求可由 run 事实重建。** Provider 私有 response id、加密推理和签名只是优化或必需回放句柄，不能替代项目自己的 trace/replay；replay 默认不重调模型。
4. **最小 Base + 按需观察取代全知 giant prompt。** Base 只含不可猜测的作者意图、写作坐标、当前目标、权限、预算、必要版本与最小事实；其余作品知识通过只读工具观察进入后续消息。
5. **作者主权是协议结构，不是提示词口号。** 模型工具只能读取、计划、提问、报告缺口或生成/修订 tentative 候选；不存在 `adopt`、`canon_write` 或自我批准工具。

### 26.3 目标请求的逻辑组成

每次请求由稳定信封、运行上下文和原生消息序列组成：

```text
model / stream / usage / sampling / provider-native reasoning & cache options
system: 产品宪法 + 当前 run 角色与输出协议
messages:
  application_base（非作者冒充，含 run/work/goal/permission/budget/base refs）
  最近真实 user/assistant 对话或显式 compaction checkpoint
  本轮作者原话（独立 user 消息，字节不变）
  assistant: 作者可见叙事 + tool_call(s)
  tool: 观察或校验结果，按 call_id 关联
  assistant: 后续计划、探索、修订或 tentative artifact tool_call(s)
  tool: 观察/校验结果
  …直到 ready、普通回复、ask_author、诚实失败或预算停止
tools: 按 run 角色提供的最小完整目录，不追求数量
```

具体要求：

- `application_base` 在内部有独立 provenance，投影时明确标为应用数据，不能伪装成作者新指令；作者原话永远单独保留。
- 观察至少表达 `source refs / authority / version / coverage / omissions / next_offset / content`，未读、过期、失败和截断不得渲染成完整事实。
- 工具校验失败作为该 tool_call 的原生失败结果回流，让模型在同一 run 修正；不再追加一个 `user` 消息冒充完整纠错历史。
- 长会话压缩产生带省略范围、来源 refs 和版本的显式 checkpoint 消息，不做不可见截断；作者原文与 artifact 字节不因压缩被改写。
- 普通文本、工具参数和观察内容各守来源边界；CoT/thinking 不进入作者可见叙事。

### 26.4 工具与人机边界

目标工具按职责分为：

- **只读求证**：作品检索、章读取、档案读取、记忆召回及获授权的外部资料读取。
- **计划与修订**：提出或修订 AgentPlan；工具结果只表示结构/权限校验，不等于执行批准。
- **创作输出**：生成或修订 tentative artifact、质量复核、报告能力缺口；产物字段继续满足 I1 因果绑定。
- **作者出口**：`ask_author` 或需要裁决/追加预算时结束当前机器消息链，由应用持久真实问题与可用动作。

作者回答、选择、采纳、拒绝或追加预算开启新的授权边界和请求投影，不能把人类回答伪装成某个工具自动返回，也不让旧 tool_call 跨越不明授权状态继续执行。采纳后的事实版本、回执与 refs 进入下一 run 的 Base；模型从不直接执行采纳。

### 26.5 Provider 投影与能力门槛

- Chat Completions：投影为 `assistant.tool_calls` 与 `tool.tool_call_id`；DeepSeek 仅按原生要求回放 `reasoning_content`。
- Anthropic Messages：投影为 content blocks、`tool_use/tool_result` 和原生缓存断点；需要的 thinking/signature 只作 provider 私有回放数据。
- Responses API：可投影完整 `input`、原生工具项与推理句柄；`previous_response_id` 只能作为优化，不能成为唯一会话事实源。
- 完整 AgentRun 的必备能力至少包括原生多轮、工具调用与结果、流式解析、结构化输出和用量回收。缺少必备能力时必须显式降级到声明过的有限模式或拒绝路由，不能静默丢字段后仍宣称完整运行。
- 稳定 system、工具 schema 和 Base 形成可缓存前缀；易变观察、作者输入与校验结果置后。缓存不得牺牲语义顺序、证据保真或作者边界。支持的流式通道发送 usage 选项，不支持者不盲发。

### 26.6 目标验收与迁移纪律

CP1 必须先冻结目标 contract pack、消息/工具/观察/校验/候选/检查点语义、provider 投影矩阵和与现役 ADR 的差异；若改变 B26 或 ADR-0030 的现役决定，必须明确修订或 supersede，不能在代码中静默绕行。

至少保留首轮、观察后、校验失败后、tentative 候选后、作者边界后和压缩后六类黄金请求。真实验收必须由外部自动化驱动当前 Tauri 工作台，证明模型按需求证、观察进入下一真实请求、候选仍 tentative、作者采纳才改变 canon、恢复/replay 不调模型，并执行 I1/I2/I3、N-NARR、架构与静态扫描门禁。局部 adapter 或 golden 测试不得替代完整场景。

### 26.7 2026-11-01 修订：稳定层 + 动态 scope + 可恢复 transcript（Proposed）

作者复核实现后确认，Codex、dsh、Claude Code 同样考虑用户主权与证据一致性，因此“刷新 Base”本身不是优势。目标投影进一步收敛为：

- **稳定层**：产品宪法、run 角色、输出协议、工具 schema、作者原话与既有 assistant/tool 消息在同一 run 内保持来源、顺序和字节稳定，不因预算或作品状态变化而重写。
- **动态 scope 以追加消息更新**：作品 revision、操作目录、权限、预算、观察和恢复状态以带版本、来源与变更原因的 `scope_update` 消息追加；最新 scope 决定后续执行视图，旧 scope 保留为证据，不波及稳定层。scope 不授予执行权，实际执行仍由 Orchestrator/gate 裁决。
- **消息体采用追加式 transcript**：初始 Base 后只追加 scope_update、assistant、tool、checkpoint 等新事实，旧 body 不删、不改、不替换；后续请求以前序 body 为前缀，而不是重新生成整段上下文。
- **canonical transcript**：`judgment_prompt_override` 已从首个判断消费者退役。`AuthoringTranscript` 是唯一请求事实源；durable checkpoint 保存可校验恢复的 canonical transcript，重建 Request IR 时保留 assistant/tool 顺序、call_id 与最新 scope，replay 不调模型。
- **禁止整段 Base 刷新作为终态**：初始 Base 由稳定角色规则与输出协议构成；scope 变化只追加带版本、变更原因和 source_refs 的 `scope_update`。新作者 turn 同样追加，旧消息不删、不改、不替换。
- **统一原生反馈**：工具失败以 `validation_result` 回流；无工具响应的协议纠错用 `application_notice`，不伪装作者输入。原始工具参数和 Provider 私有推理引用经 checkpoint 保真；一个计划包含多次读取时聚合为真实观察，不虚构逐步模型调用。

验收新增 G7（动态 scope 后稳定前缀一致、权限/预算/revision 正确更新）与 G8（持久事实恢复后 transcript 等价、scope 当前、replay 无 Provider 调用）。实现必须分别证明确定性多轮、数据库离线恢复与真实页面接线；离线恢复事实不等于 durable 自动重启已闭环，后者仍归 CP4。

