# Observability

> 状态：草案
>
> 目的：定义 [`../00-overview.md`](../00-overview.md) §4.9 观测性子系统在 Elixir 上的具体落地——OpenTelemetry-erlang + Phoenix.Telemetry。

---

## 1. 总览

```yaml
core_lib:        opentelemetry-erlang
exporter:        opentelemetry_exporter (OTLP)
phoenix_inst:    opentelemetry_phoenix
ecto_inst:       opentelemetry_ecto
http_inst:       opentelemetry_finch / opentelemetry_req
metrics:         telemetry_metrics + telemetry_metrics_prometheus
custom_events:   telemetry events for Agent / Provider / Authority / Budget
audit_sink:      append-only JSONL → 阶段 2 接 Loki / S3
trace_backend:   阶段 1 本地 Jaeger Docker 容器（开发） / 文件 exporter（用户机器）
                 阶段 2 接 Tempo / Honeycomb / Datadog / Grafana
log_format:      structured JSON via :logger + Logger.JSON formatter
```

---

## 2. 三大观测信号

### 2.1 Trace

每个 turn / capability invoke / agent message 都是一个 span。span 跨节点传播（Distributed Erlang + W3C Trace Context）。

### 2.2 Metrics

| 指标 | 类型 | 目的 |
|---|---|---|
| `agent.message_processed_count` | counter | 每个 Agent 处理的消息总数 |
| `agent.message_duration_ms` | histogram | 处理耗时分布 |
| `provider.complete_count` | counter | 每 provider 调用次数 |
| `provider.complete_duration_ms` | histogram | provider 延迟 |
| `provider.tokens_consumed` | counter | 累计 token 消耗 |
| `provider.cost_usd` | counter | 累计成本 |
| `authority.check_denied_count` | counter | 权限拒绝次数 |
| `budget.exceeded_count` | counter | 预算超限次数 |
| `clarification.rate` | counter | 触发 clarification 比率 |
| `confirmation.rate` | counter | 触发 confirmation 比率 |
| `adoption.accepted_count` | counter | 用户采纳数 |
| `adoption.rejected_count` | counter | 用户否决数 |
| `projection.refresh_duration_ms` | histogram | reading projection 刷新耗时 |
| `long_run.checkpoint_count` | counter | LongRunner 触发 checkpoint 数 |
| `crash.agent_count` | counter | Agent crash 数（按类型） |

### 2.3 Logs

结构化 JSON 日志：

```json
{
  "timestamp": "2026-04-26T03:15:42.123Z",
  "level": "info",
  "module": "AINovelStudio.Foundation.Agent.Reviewer",
  "agent_id": "017ed58e-...",
  "agent_type": "reviewer",
  "workspace_id": "...",
  "message": "review completed",
  "draft_id": "...",
  "findings_count": 3,
  "duration_ms": 4520,
  "trace_id": "...",
  "span_id": "..."
}
```

---

## 3. Application 启动配置

```elixir
# apps/novel_foundation/lib/foundation/application.ex
defmodule AINovelStudio.Foundation.Application do
  use Application
  
  @impl true
  def start(_type, _args) do
    :ok = OpentelemetryPhoenix.setup()
    :ok = OpentelemetryEcto.setup([:novel_persistence, :repo])
    
    children = [
      AINovelStudio.Telemetry,
      # ...
    ]
    
    Supervisor.start_link(children, strategy: :one_for_one)
  end
end
```

```elixir
# apps/novel_foundation/lib/foundation/telemetry.ex
defmodule AINovelStudio.Telemetry do
  use Supervisor
  import Telemetry.Metrics
  
  def start_link(arg) do
    Supervisor.start_link(__MODULE__, arg)
  end
  
  @impl true
  def init(_arg) do
    children = [
      {TelemetryMetricsPrometheus, [
        metrics: metrics(),
        port: 9568   # Prometheus scrape endpoint
      ]}
    ]
    
    Supervisor.init(children, strategy: :one_for_one)
  end
  
  defp metrics do
    [
      # Phoenix
      summary("phoenix.endpoint.start.system_time", unit: {:native, :millisecond}),
      summary("phoenix.endpoint.stop.duration", unit: {:native, :millisecond}),
      summary("phoenix.router_dispatch.stop.duration", 
        tags: [:route], unit: {:native, :millisecond}),
      
      # Ecto
      summary("novel_persistence.repo.query.total_time", unit: {:native, :millisecond}),
      summary("novel_persistence.repo.query.query_time", unit: {:native, :millisecond}),
      
      # Custom Agent
      counter("ai_novel_studio.agent.message_processed.count", 
        tags: [:agent_type, :workspace_id]),
      summary("ai_novel_studio.agent.message_duration.ms", 
        tags: [:agent_type, :workspace_id], unit: :millisecond),
      
      # Custom Provider
      counter("ai_novel_studio.provider.complete.count", 
        tags: [:provider_id, :model_id]),
      summary("ai_novel_studio.provider.complete.duration", 
        tags: [:provider_id], unit: :millisecond),
      counter("ai_novel_studio.provider.tokens_consumed", 
        tags: [:provider_id, :model_id, :kind]),
      counter("ai_novel_studio.provider.cost_usd", 
        tags: [:provider_id, :model_id])
    ]
  end
end
```

---

## 4. Custom telemetry emit 

每个关键边界 emit 标准 telemetry events：

### 4.1 Agent message processing

```elixir
def handle_cast({:review, draft}, state) do
  start_time = System.monotonic_time()
  
  # ... process ...
  
  duration = System.monotonic_time() - start_time
  
  :telemetry.execute(
    [:ai_novel_studio, :agent, :message_processed],
    %{count: 1, duration: duration},
    %{
      agent_id: state.ref.id,
      agent_type: state.ref.type,
      workspace_id: state.ref.workspace_id,
      message_kind: :review
    }
  )
end
```

### 4.2 Provider call

```elixir
def complete(messages, params) do
  start_time = System.monotonic_time()
  
  case do_complete(messages, params) do
    {:ok, result} ->
      :telemetry.execute(
        [:ai_novel_studio, :provider, :complete],
        %{
          count: 1,
          duration: System.monotonic_time() - start_time,
          prompt_tokens: result.usage.prompt_tokens,
          completion_tokens: result.usage.completion_tokens,
          cost_usd: result.usage.cost_usd
        },
        %{
          provider_id: result.usage.provider_id,
          model_id: result.usage.model_id,
          finish_reason: result.finish_reason
        }
      )
      
      {:ok, result}
    
    {:error, error} ->
      :telemetry.execute(
        [:ai_novel_studio, :provider, :error],
        %{count: 1},
        %{
          provider_id: error.provider_id,
          error_kind: error.kind
        }
      )
      
      {:error, error}
  end
end
```

---

## 5. OpenTelemetry Tracing

### 5.1 自动 span（Phoenix + Ecto）

`opentelemetry_phoenix` + `opentelemetry_ecto` 自动包装：

- Phoenix endpoint（HTTP request）
- Phoenix Channel（WebSocket frame）
- Ecto query

### 5.2 Custom span（Agent / Provider）

```elixir
require OpenTelemetry.Tracer, as: Tracer

def review(state, draft) do
  Tracer.with_span "agent.reviewer.review", %{
    attributes: %{
      "agent.id" => state.ref.id,
      "agent.type" => "reviewer",
      "draft.id" => draft.id,
      "draft.revision" => draft.revision_id
    }
  } do
    # 调用 Provider
    Tracer.with_span "provider.complete" do
      Provider.Gateway.complete(messages, params)
    end
    
    # 写 tentative artifact
    Tracer.with_span "persistence.tentative_insert" do
      Persistence.TentativeArtifact.insert(...)
    end
  end
end
```

---

## 6. Trace context 跨节点传播

阶段 2 多节点时：

- W3C Trace Context（`traceparent` header）通过 Distributed Erlang message
- `opentelemetry_process_propagator` 自动注入到 GenServer 消息

```elixir
# Spawn 子 Agent 时携带 trace context
def start_agent_with_trace(ref, args) do
  ctx = OpenTelemetry.Ctx.get_current()
  
  DynamicSupervisor.start_child(
    AgentChildrenSupervisor,
    {Agent.Reviewer, Map.put(args, :trace_ctx, ctx)}
  )
end

# 子 Agent init 恢复
def init(args) do
  if args[:trace_ctx], do: OpenTelemetry.Ctx.attach(args.trace_ctx)
  # ...
end
```

---

## 7. Audit Log（不同于 Trace）

Audit log 是**永久保留的事件流**，与 OTel trace（短期）分离：

```elixir
defmodule AINovelStudio.Foundation.Observability.AuditLog do
  def log(event_type, payload) do
    entry = %{
      timestamp: DateTime.utc_now(),
      event_type: event_type,
      payload: payload,
      trace_id: OpenTelemetry.Ctx.get_current_trace_id()
    }
    
    write_jsonl(entry)
    
    # 阶段 1: 本地 JSONL
    # 阶段 2: 异步推 S3 / Loki
  end
  
  defp write_jsonl(entry) do
    line = Jason.encode!(entry) <> "\n"
    File.write!(audit_log_path(), line, [:append])
  end
end
```

audit log 必须包含的事件：

- `intent.received` / `intent.routed`
- `capability.invoked`
- `artifact.created` / `artifact.adopted` / `artifact.rejected`
- `revision.created`
- `authority.denied`
- `budget.exceeded`
- `agent.spawned` / `agent.terminated`
- `escalation.raised` / `escalation.resolved`

---

## 8. 阶段 1 vs 阶段 2 部署

### 8.1 阶段 1（单机桌面应用）

- Trace：`OpenTelemetry.Exporter.Stdout` 或本地文件 exporter，**不发送到外部**（用户隐私）
- Metrics：Prometheus endpoint 监听 `:9568`，但**默认不暴露**（仅用户主动开启时启动）
- Audit log：`~/.local/share/.../logs/audit-YYYY-MM-DD.jsonl`，按天轮转

### 8.2 阶段 2（B/S）

- Trace：OTLP 推 Tempo / Honeycomb / Datadog
- Metrics：Prometheus scrape + Grafana dashboard
- Audit log：Loki / Elasticsearch / S3

不同部署形态用 `Application.put_env/3` 切换，业务代码 0 改动。

---

## 9. Replay（[`../00-overview.md`](../00-overview.md) §4.9）

每个 turn 可以从 trace 复现：

- `interaction_log` 表持久化原始 input + 关键中间状态
- 用 `interaction_id` 查询 trace
- 复现时用 stub provider 返回历史响应（如果 `usage.frozen_raw_result` 已保存）

详见 `../09-observability-and-audit.md`（待写）。

---

## 10. 关键 dashboard（阶段 2）

| Dashboard | 关键 panel |
|---|---|
| 全系统健康 | RPS、error rate、p50/p99 latency、active agents |
| Agent 监控 | 按 agent_type 分布、crash 率、平均处理时间、busy ratio |
| Provider 监控 | 各 provider 调用量、成本累计、平均延迟、错误率 |
| Budget 监控 | 各 workspace 累计消耗 vs 配额、超限事件 |
| Adoption 监控 | adoption 接受率、按 hook_type 分组、平均决策时间 |
| Long-run 监控 | 活跃 long-run 数、checkpoint 频率、平均完成时间 |

---

## 11. 当前 TBD

- 具体 sampling 策略（全量 trace vs 1% 头部 + 100% 错误）
- audit log 加密（用户 LLM 内容可能敏感）
- Replay 时 LLM cost 如何处理（重新调 vs 复用 frozen）
- 阶段 1 用户对 telemetry 的 opt-in/opt-out 控制
- Trace context 在 GenStage 数据流中的传播（producer → consumer 跨过 demand）

以上 TBD 在 v2 §4.9 主文档（`../09-observability-and-audit.md`）冻结后落实。
