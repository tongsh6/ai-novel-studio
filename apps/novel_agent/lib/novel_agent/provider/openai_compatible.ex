defmodule NovelAgent.Provider.OpenAICompatible do
  @moduledoc """
  OpenAI 兼容 Chat Completions 适配器共享实现。

  OpenAI、Minimax、智谱（GLM）、Kimi（Moonshot）、Gemini 等供应商都暴露 OpenAI 兼容的
  `/chat/completions` 与 `/models` 接口，认证为 `Authorization: Bearer <key>`。各 vendor
  adapter 通过 `use NovelAgent.Provider.OpenAICompatible` 注入统一的 `complete/health_check/
  list_models/from_config`，只声明自己的 vendor 名、展示标签、默认 endpoint/model 与可选能力。

  DeepSeek / LMStudio / Anthropic 保留各自独立 adapter（历史实现 + 各自 thinking/鉴权差异），
  不在本基类范围内；本基类只服务新增的 OpenAI 兼容供应商矩阵，避免 6 份近重复 adapter。

  注意：OpenAI 订阅（subscription）认证方式以独立 vendor id 接入，结构上与 API Key 区分
  （独立 secret、独立 endpoint、独立 redaction）；其真实 OAuth 登录与 ChatGPT backend 传输
  需要真实账号与浏览器流程，登记为 SU-01 SC-SU01-B3 的 live vendor 后续缺口，本基类不冒充其
  live 可用性。
  """

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.OpenAICompatibleStream
  alias NovelAgent.Provider.Result
  alias NovelAgent.Provider.Usage
  alias NovelFoundation.UpstreamError

  @type meta :: %{
          vendor: String.t(),
          label: String.t(),
          supports_thinking: boolean()
        }

  @doc """
  注入 OpenAI 兼容 adapter 的统一实现。

  ## 选项

    - `:vendor`（必填）— provider id（即 `name/0`，用于路由/日志/audit）
    - `:label`（必填）— 错误文案用的中文展示名
    - `:default_endpoint`（必填）— OpenAI 兼容 base（不含 `/chat/completions`）
    - `:default_model`（必填）— 未配置或未实时拉取时的兜底模型
    - `:env_key`（可选）— 从环境变量回退读取 API Key
    - `:supports_thinking`（可选，默认 false）— 是否透传 thinking/reasoning_effort
  """
  defmacro __using__(opts) do
    quote bind_quoted: [opts: opts] do
      @behaviour NovelAgent.Provider

      alias NovelAgent.Provider.HTTP
      alias NovelAgent.Provider.OpenAICompatible

      @oac_vendor Keyword.fetch!(opts, :vendor)
      @oac_label Keyword.fetch!(opts, :label)
      @oac_default_endpoint Keyword.fetch!(opts, :default_endpoint)
      @oac_default_model Keyword.fetch!(opts, :default_model)
      @oac_env_key Keyword.get(opts, :env_key)
      @oac_supports_thinking Keyword.get(opts, :supports_thinking, false)

      defstruct [
        :api_key,
        :endpoint,
        :model,
        :timeout,
        :max_tokens,
        :http_fn,
        :eventsource_fn,
        :get_fn,
        :log_fn,
        :json_mode,
        :thinking,
        :reasoning_effort
      ]

      @type t :: %__MODULE__{
              api_key: String.t() | nil,
              endpoint: String.t(),
              model: String.t(),
              timeout: pos_integer(),
              max_tokens: pos_integer() | nil,
              http_fn: (String.t(), map(), keyword() -> HTTP.http_result()) | nil,
              eventsource_fn:
                (String.t(), map(), keyword(), (binary() -> term()) ->
                   HTTP.event_stream_result())
                | nil,
              get_fn: (String.t(), keyword() -> HTTP.http_result()) | nil,
              log_fn: (String.t(), String.t(), map(), term(), integer() -> :ok) | nil,
              json_mode: boolean(),
              thinking: :enabled | :disabled,
              reasoning_effort: String.t() | nil
            }

      @impl true
      def name, do: @oac_vendor

      @impl true
      def complete(state, model, prompt, params),
        do: OpenAICompatible.complete(oac_meta(), state, model, prompt, params)

      @impl true
      def execute(state, model, prompt, params, ctx),
        do: OpenAICompatible.execute(oac_meta(), state, model, prompt, params, ctx)

      @impl true
      def health_check(state), do: OpenAICompatible.health_check(oac_meta(), state)

      @impl true
      def list_models(state), do: OpenAICompatible.list_models(oac_meta(), state)

      @doc "从应用配置构建 state struct，可经 `:env_key` 从环境变量回退读取 API Key。"
      @spec from_config(keyword()) :: t()
      def from_config(config \\ Application.get_env(:novel_agent, __MODULE__, [])) do
        %__MODULE__{
          api_key: Keyword.get(config, :api_key) || OpenAICompatible.env(@oac_env_key),
          endpoint: Keyword.get(config, :endpoint, @oac_default_endpoint),
          model: Keyword.get(config, :model, @oac_default_model),
          timeout: Keyword.get(config, :timeout, 300_000),
          # 缺陷九跟进（2026-07-20）：托管 API 矩阵，风险低于本地可换模型，但止血阀
          # 是系统不变量——见 InferenceParams moduledoc、NovelAgent.Provider.DeepSeek
          # 同名字段。
          max_tokens: Keyword.get(config, :max_tokens, 16_000),
          http_fn: Keyword.get(config, :http_fn, &HTTP.post/3),
          eventsource_fn: Keyword.get(config, :eventsource_fn, &HTTP.post_event_stream/4),
          get_fn: Keyword.get(config, :get_fn, &HTTP.get/2),
          log_fn: Keyword.get(config, :log_fn, &NovelCommon.LLMLog.record/5),
          json_mode: Keyword.get(config, :json_mode, false),
          thinking:
            OpenAICompatible.normalize_thinking(Keyword.get(config, :thinking, :disabled)),
          reasoning_effort: Keyword.get(config, :reasoning_effort)
        }
      end

      defp oac_meta do
        %{vendor: @oac_vendor, label: @oac_label, supports_thinking: @oac_supports_thinking}
      end
    end
  end

  # ── 共享运行时实现（对任意 OpenAI 兼容 struct 生效，按字段读取）────────────

  @doc false
  @spec complete(meta(), struct(), String.t() | nil, term(), term()) ::
          {:ok, Result.t()} | {:error, map()}
  def complete(meta, %{api_key: key} = state, _model, prompt, params)
      when is_binary(key) and key != "" do
    start_time = System.monotonic_time(:millisecond)

    body =
      state
      |> request_body(prompt, params, false)
      |> maybe_thinking(meta.supports_thinking, state.thinking, state.reasoning_effort)

    url = endpoint_url(state.endpoint)
    headers = [{"authorization", "Bearer #{key}"}]
    post = state.http_fn || (&HTTP.post/3)

    result =
      case post.(url, body, headers: headers, receive_timeout: state.timeout) do
        {:ok, status, resp_body} when status in 200..299 ->
          handle_success(meta, state, resp_body, start_time)

        {:error, :http_error, status, message} ->
          handle_http_error(meta, status, message, start_time)

        {:error, reason, _status, message} ->
          handle_connection_error(meta, reason, message, start_time)
      end

    if log = state.log_fn, do: log.(meta.vendor, url, body, result, start_time)
    strip_attrs(result)
  end

  def complete(meta, _state, _model, _prompt, _params) do
    err = UpstreamError.new(:auth, "#{meta.label} API key 未配置", meta.vendor)
    UpstreamError.to_error_tuple(err)
  end

  @doc false
  @spec execute(meta(), struct(), String.t() | nil, term(), term(), AdapterExecution.context()) ::
          AdapterExecution.execution_result()
  def execute(meta, %{api_key: key} = state, _model, prompt, params, ctx)
      when (is_binary(prompt) or is_list(prompt) or is_map(prompt)) and is_binary(key) and
             key != "" do
    if NovelAgent.Provider.tool_call_prompt?(prompt) do
      execute_tool_call(meta, state, key, prompt, params, ctx)
    else
      body =
        state
        |> request_body(prompt, params, true)
        |> maybe_thinking(meta.supports_thinking, state.thinking, state.reasoning_effort)

      url = endpoint_url(state.endpoint)
      headers = [{"authorization", "Bearer #{key}"}]
      request_opts = [headers: headers, receive_timeout: state.timeout]

      OpenAICompatibleStream.execute(meta, state, url, body, request_opts, ctx)
    end
  end

  def execute(meta, _state, _model, _prompt, _params, ctx) do
    err = UpstreamError.new(:auth, "#{meta.label} API key 未配置", meta.vendor)

    err
    |> UpstreamError.to_error_tuple()
    |> AdapterExecution.materialize_result(ctx)
  end

  @doc false
  @spec health_check(meta(), struct()) :: :ok | {:error, map()}
  def health_check(_meta, %{api_key: key}) when is_binary(key) and key != "", do: :ok

  def health_check(meta, _state),
    do: {:error, %{message: "#{meta.label} API key 未配置", type: :unauthorized}}

  @doc false
  @spec list_models(meta(), struct()) :: {:ok, [map()]} | {:error, map()}
  def list_models(meta, %{api_key: key} = state) when is_binary(key) and key != "" do
    url = models_url(state.endpoint)
    get = state.get_fn || (&HTTP.get/2)
    headers = [{"authorization", "Bearer #{key}"}]

    case get.(url, headers: headers, receive_timeout: state.timeout || 15_000) do
      {:ok, _status, body} ->
        {:ok, models_from_openai_list(body)}

      {:error, :http_error, status, message} ->
        {:error, %{message: "#{meta.label}: #{message}", type: http_error_type(status)}}

      {:error, :connection_refused, _status, _message} ->
        {:error, %{message: "无法连接 #{meta.label}", type: :connection_refused}}

      {:error, :timeout, _status, _message} ->
        {:error, %{message: "#{meta.label} 请求超时", type: :timeout}}

      {:error, reason, _status, message} ->
        {:error, %{message: message, type: reason}}
    end
  end

  def list_models(meta, _state),
    do: {:error, %{message: "#{meta.label} API key 未配置", type: :unauthorized}}

  @doc false
  @spec env(String.t() | nil) :: String.t() | nil
  def env(nil), do: nil
  def env(key) when is_binary(key), do: System.get_env(key)

  @doc false
  @spec normalize_thinking(term()) :: :enabled | :disabled
  def normalize_thinking(value) when value in [:enabled, "enabled", true], do: :enabled
  def normalize_thinking(_value), do: :disabled

  # ── private ──────────────────────────────────

  defp endpoint_url(endpoint) do
    endpoint
    |> String.trim_trailing("/")
    |> Kernel.<>("/chat/completions")
  end

  defp request_body(state, prompt, params, stream?) do
    %{
      model: state.model,
      messages: NovelAgent.Provider.normalize_messages(prompt),
      stream: stream?,
      # 缺陷九跟进：provider 自己的安全上限先垫底，params.max_tokens 非 nil
      # 时 apply_params 覆盖——见 InferenceParams moduledoc。
      max_tokens: state.max_tokens
    }
    |> HTTP.apply_params(params)
    |> maybe_json_mode(state.json_mode, prompt)
    |> NovelAgent.Provider.put_openai_tools(prompt)
  end

  defp models_url(endpoint) do
    endpoint
    |> String.trim_trailing("/")
    |> Kernel.<>("/models")
  end

  defp maybe_json_mode(body, true, prompt) do
    if NovelAgent.Provider.tool_call_prompt?(prompt) do
      body
    else
      Map.put(body, :response_format, %{type: "json_object"})
    end
  end

  defp maybe_json_mode(body, _enabled, _prompt), do: body

  # 仅 supports_thinking 的供应商透传；其余供应商不发送 thinking 字段，避免被拒绝。
  defp maybe_thinking(body, false, _thinking, _effort), do: body

  defp maybe_thinking(body, true, :enabled, effort) when is_binary(effort) and effort != "" do
    body
    |> Map.put(:thinking, %{type: "enabled"})
    |> Map.put(:reasoning_effort, effort)
  end

  defp maybe_thinking(body, true, :enabled, _effort),
    do: Map.put(body, :thinking, %{type: "enabled"})

  defp maybe_thinking(body, true, _thinking, _effort),
    do: Map.put(body, :thinking, %{type: "disabled"})

  defp strip_attrs({:ok, result, _attrs}), do: {:ok, result}
  defp strip_attrs({:error, {:error, map}, _attrs}), do: {:error, map}

  defp execute_tool_call(meta, state, key, prompt, params, ctx) do
    start_time = System.monotonic_time(:millisecond)

    body =
      state
      |> request_body(prompt, params, false)
      |> maybe_thinking(meta.supports_thinking, state.thinking, state.reasoning_effort)

    url = endpoint_url(state.endpoint)
    headers = [{"authorization", "Bearer #{key}"}]
    post = state.http_fn || (&HTTP.post/3)
    initial_events = AdapterExecution.initial_events(ctx)
    AdapterExecution.emit_events(ctx, initial_events, :running)

    result =
      case post.(url, body, headers: headers, receive_timeout: state.timeout) do
        {:ok, status, resp_body} when status in 200..299 ->
          handle_success(meta, state, resp_body, start_time)

        {:error, :http_error, status, message} ->
          handle_http_error(meta, status, message, start_time)

        {:error, reason, _status, message} ->
          handle_connection_error(meta, reason, message, start_time)
      end

    if log = state.log_fn, do: log.(meta.vendor, url, body, result, start_time)

    result
    |> strip_attrs()
    |> AdapterExecution.materialize_result(ctx, initial_events: initial_events, emit: :terminal)
  end

  defp handle_success(meta, state, resp_body, start_time) do
    message = get_in(resp_body, ["choices", Access.at(0), "message"]) || %{}
    content = Map.get(message, "content") || ""
    tool_calls = NovelAgent.Provider.extract_openai_tool_calls(message)
    latency = System.monotonic_time(:millisecond) - start_time
    usage = Usage.from_openai_response(resp_body, state.model, latency)

    if (is_binary(content) and content != "") or tool_calls != [] do
      {:ok, Result.new(content, usage, tool_calls: tool_calls),
       %{status: 200, usage: usage, duration: latency, resp_body: Jason.encode!(resp_body)}}
    else
      err = UpstreamError.new(:invalid_response, "#{meta.label} 响应内容为空", meta.vendor)

      {:error, UpstreamError.to_error_tuple(err),
       %{status: 200, usage: usage, duration: latency, resp_body: Jason.encode!(resp_body)}}
    end
  end

  defp handle_http_error(meta, status, message, start_time) do
    duration = System.monotonic_time(:millisecond) - start_time
    err = UpstreamError.new(http_error_type(status), "#{meta.label}: #{message}", meta.vendor)

    {:error, UpstreamError.to_error_tuple(err),
     %{status: status, usage: %{}, duration: duration, resp_body: message}}
  end

  defp handle_connection_error(meta, :connection_refused, _msg, start_time) do
    duration = System.monotonic_time(:millisecond) - start_time
    err = UpstreamError.new(:connection_refused, "无法连接 #{meta.label}", meta.vendor)

    {:error, UpstreamError.to_error_tuple(err),
     %{status: 0, usage: %{}, duration: duration, resp_body: "connection_refused"}}
  end

  defp handle_connection_error(meta, :timeout, _msg, start_time) do
    duration = System.monotonic_time(:millisecond) - start_time
    err = UpstreamError.new(:timeout, "#{meta.label} 请求超时", meta.vendor)

    {:error, UpstreamError.to_error_tuple(err),
     %{status: 0, usage: %{}, duration: duration, resp_body: "timeout"}}
  end

  defp handle_connection_error(meta, _reason, message, start_time) do
    duration = System.monotonic_time(:millisecond) - start_time
    err = UpstreamError.new(:provider_internal, message, meta.vendor)

    {:error, UpstreamError.to_error_tuple(err),
     %{status: 0, usage: %{}, duration: duration, resp_body: message}}
  end

  defp http_error_type(status) when status in [401, 402, 403], do: :auth
  defp http_error_type(429), do: :rate_limit
  defp http_error_type(status) when status in [400, 422], do: :invalid_request
  defp http_error_type(_status), do: :provider_internal

  defp models_from_openai_list(%{"data" => models}) when is_list(models) do
    models
    |> Enum.flat_map(&model_from_openai_entry/1)
    |> Enum.uniq_by(& &1.id)
  end

  defp models_from_openai_list(_body), do: []

  defp model_from_openai_entry(%{"id" => id} = model) when is_binary(id) and id != "" do
    [%{id: id, label: id, owned_by: normalize_owned_by(model["owned_by"])}]
  end

  defp model_from_openai_entry(_entry), do: []

  defp normalize_owned_by(owner) when is_binary(owner) and owner != "", do: owner
  defp normalize_owned_by(_owner), do: nil
end
