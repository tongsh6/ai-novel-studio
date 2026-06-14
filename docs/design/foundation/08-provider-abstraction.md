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

