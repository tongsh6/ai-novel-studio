defmodule NovelAgent.Provider.Anthropic do
  @moduledoc """
  Anthropic (Claude) API Provider adapter。

  通过 Anthropic Messages API 调用 Claude 模型。使用共享的 `Provider.HTTP` 发送请求。

  ## 配置

      config :novel_agent, NovelAgent.Provider.Anthropic,
        api_key: "sk-ant-...",
        model: "claude-sonnet-4-6",
        timeout: 300_000

  或通过环境变量 ANTHROPIC_API_KEY 设置。
  """

  @behaviour NovelAgent.Provider

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.AnthropicStream
  alias NovelAgent.Provider.HTTP
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelFoundation.UpstreamError

  defstruct [:api_key, :model, :timeout, :http_fn, :eventsource_fn, :get_fn, :log_fn]

  @type http_fn :: (String.t(), map(), keyword() -> HTTP.http_result())
  @type eventsource_fn ::
          (String.t(), map(), keyword(), (binary() -> term()) -> HTTP.event_stream_result())
  @type get_fn :: (String.t(), keyword() -> HTTP.http_result())
  @type log_fn :: (String.t(), String.t(), map(), term(), integer() -> :ok)

  @type t :: %__MODULE__{
          api_key: String.t(),
          model: String.t(),
          timeout: pos_integer(),
          http_fn: http_fn(),
          eventsource_fn: eventsource_fn(),
          get_fn: get_fn(),
          log_fn: log_fn()
        }

  @api_base "https://api.anthropic.com/v1"
  @api_version "2023-06-01"

  @impl true
  def execute(%__MODULE__{api_key: key} = state, _model, %RequestIR{} = ir, params, ctx)
      when is_binary(key) and key != "" do
    execute_validated(state, key, ir, params, ctx)
  end

  def execute(%__MODULE__{}, _model, _prompt, _params, ctx) do
    {:error, error} =
      :auth
      |> UpstreamError.new("Anthropic API key 未配置", name())
      |> UpstreamError.to_error_tuple()

    AdapterExecution.materialize_result({:error, error}, ctx)
  end

  # B71 R2：工具调用不再隐式选择非流式——tool_use 同样走 Messages SSE 流式传输，
  # 由 adapter-owned decoder 在 content_block_start/delta 中无损累积参数。
  defp execute_validated(state, key, prompt, params, ctx) do
    case request_body(state, prompt, params, true) do
      {:ok, body} ->
        url = Path.join(@api_base, "messages")

        request_opts = [
          headers: [{"x-api-key", key}, {"anthropic-version", @api_version}],
          receive_timeout: AdapterExecution.response_timeout(ctx, state.timeout),
          connect_timeout: AdapterExecution.connect_timeout(ctx, 15_000)
        ]

        AnthropicStream.execute(state, url, body, request_opts, ctx)

      {:error, _reason} ->
        AdapterExecution.materialize_result(projection_error(), ctx)
    end
  end

  defp projection_error do
    :invalid_request
    |> UpstreamError.new("历史工具参数无法无损转换为当前提供者的对象参数。", name())
    |> UpstreamError.to_error_tuple()
  end

  defp request_body(state, %RequestIR{} = ir, params, stream?) do
    with {:ok, projected} <- Projection.project(ir, "anthropic_messages") do
      # AnthropicMessages 恒返回非空顶层 system（身份前缀 + canonical system），
      # 不再做「可能缺失」的兜底判断。
      body = %{
        model: state.model,
        max_tokens: 4096,
        messages: projected.messages,
        system: cacheable_system(projected.system)
      }

      body =
        body
        |> Map.merge(Map.take(projected, [:tools, :tool_choice]))
        |> maybe_stream(stream?)
        |> HTTP.apply_params(params)

      {:ok, body}
    end
  end

  defp maybe_stream(body, true), do: Map.put(body, :stream, true)
  defp maybe_stream(body, false), do: Map.delete(body, :stream)

  # CP3：Anthropic 需要显式 cache_control 才启用 prompt cache；最小可缓存长度
  # 以 token 计（通常 ≥1024），这里保守用 4096 字符近似，避免给过短 system
  # 块打标；达不到阈值时保持字符串，不伪造缓存标记。
  @cacheable_system_min_chars 4096

  defp cacheable_system([%{type: "text", text: text} = block]) when is_binary(text) do
    if String.length(text) >= @cacheable_system_min_chars do
      [Map.put(block, :cache_control, %{type: "ephemeral"})]
    else
      [block]
    end
  end

  defp cacheable_system(system), do: system

  @impl true
  def name, do: "anthropic"

  # 传输事实：Messages API 原生多轮、tool_use/tool_result、SSE 流式、tool schema
  # 结构化输出与 usage 都由本 adapter 真实发送并解析（含 AnthropicStream）。
  @impl true
  def capabilities(_state) do
    %{
      native_multi_turn: true,
      tool_calls: true,
      tool_results: true,
      streaming: true,
      structured_output: true,
      usage: true
    }
  end

  @impl true
  def projection_target(_state), do: "anthropic_messages"

  @impl true
  def health_check(%__MODULE__{api_key: key}) when is_binary(key) and key != "", do: :ok

  def health_check(%__MODULE__{}),
    do: {:error, %{message: "Anthropic API key 未配置", type: :unauthorized}}

  @impl true
  def list_models(%__MODULE__{api_key: key} = state) when is_binary(key) and key != "" do
    url = Path.join(@api_base, "models")
    get = state.get_fn || (&HTTP.get/2)
    headers = [{"x-api-key", key}, {"anthropic-version", @api_version}]

    case get.(url,
           headers: headers,
           receive_timeout: AdapterExecution.probe_timeout(state.timeout)
         ) do
      {:ok, _status, body} ->
        {:ok, models_from_anthropic_list(body)}

      {:error, :http_error, status, message} ->
        {:error, %{message: "Anthropic API: #{message}", type: http_error_type(status)}}

      {:error, :connection_refused, _status, _message} ->
        {:error, %{message: "无法连接 Anthropic API", type: :connection_refused}}

      {:error, :timeout, _status, _message} ->
        {:error, %{message: "Anthropic API 请求超时", type: :timeout}}

      {:error, reason, _status, message} ->
        {:error, %{message: message, type: reason}}
    end
  end

  def list_models(%__MODULE__{}),
    do: {:error, %{message: "Anthropic API key 未配置", type: :unauthorized}}

  @doc "从应用配置构建 state struct。支持环境变量 ANTHROPIC_API_KEY。"
  @spec from_config() :: t()
  def from_config(config \\ Application.get_env(:novel_agent, __MODULE__, [])) do
    %__MODULE__{
      api_key: Keyword.get(config, :api_key) || System.get_env("ANTHROPIC_API_KEY"),
      model: Keyword.get(config, :model, "claude-sonnet-4-6"),
      timeout: Keyword.get(config, :timeout, 300_000),
      http_fn: Keyword.get(config, :http_fn, &HTTP.post/3),
      eventsource_fn: Keyword.get(config, :eventsource_fn, &HTTP.post_event_stream/4),
      get_fn: Keyword.get(config, :get_fn, &HTTP.get/2),
      log_fn: Keyword.get(config, :log_fn, &NovelTelemetry.LLMLog.record/5)
    }
  end

  defp http_error_type(status) when status in [401, 403], do: :auth
  defp http_error_type(429), do: :rate_limit

  # 400/422 = 我们发出的请求被拒绝（参数/格式非法），属客户端请求问题，不是上游空响应。
  defp http_error_type(status) when status in [400, 422], do: :invalid_request
  defp http_error_type(_status), do: :provider_internal

  defp models_from_anthropic_list(%{"data" => models}) when is_list(models) do
    models
    |> Enum.flat_map(&model_from_anthropic_entry/1)
    |> Enum.uniq_by(& &1.id)
  end

  defp models_from_anthropic_list(_body), do: []

  defp model_from_anthropic_entry(%{"id" => id} = model) when is_binary(id) and id != "" do
    [
      %{
        id: id,
        label: normalize_label(model["display_name"], id),
        owned_by: "anthropic"
      }
    ]
  end

  defp model_from_anthropic_entry(_entry), do: []

  defp normalize_label(label, _fallback) when is_binary(label) and label != "", do: label
  defp normalize_label(_label, fallback), do: fallback
end
