defmodule NovelAgent.Provider.DeepSeek do
  @moduledoc """
  DeepSeek API provider adapter.

  DeepSeek exposes an OpenAI-compatible non-streaming chat completion API. This
  adapter keeps the project contract stable: callers still go through
  `Provider.Gateway` and receive `Provider.Result`.
  """

  @behaviour NovelAgent.Provider

  require Logger

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.OpenAICompatibleStream
  alias NovelAgent.Provider.Result
  alias NovelAgent.Provider.Usage
  alias NovelFoundation.UpstreamError

  defstruct [
    :api_key,
    :endpoint,
    :model,
    :timeout,
    :http_fn,
    :eventsource_fn,
    :get_fn,
    :log_fn,
    :json_mode,
    :thinking,
    :reasoning_effort
  ]

  @type http_fn :: (String.t(), map(), keyword() -> HTTP.http_result())
  @type eventsource_fn ::
          (String.t(), map(), keyword(), (binary() -> term()) -> HTTP.event_stream_result())
  @type get_fn :: (String.t(), keyword() -> HTTP.http_result())
  @type log_fn :: (String.t(), String.t(), map(), term(), integer() -> :ok)
  @type thinking :: :enabled | :disabled

  @type t :: %__MODULE__{
          api_key: String.t() | nil,
          endpoint: String.t(),
          model: String.t(),
          timeout: pos_integer(),
          http_fn: http_fn() | nil,
          eventsource_fn: eventsource_fn() | nil,
          get_fn: get_fn() | nil,
          log_fn: log_fn() | nil,
          json_mode: boolean(),
          thinking: thinking(),
          reasoning_effort: String.t() | nil
        }

  @default_endpoint "https://api.deepseek.com"
  @default_model "deepseek-v4-flash"

  @impl true
  def complete(%__MODULE__{api_key: key} = state, _model, prompt, params)
      when is_binary(key) and key != "" do
    start_time = System.monotonic_time(:millisecond)

    body =
      state
      |> request_body(prompt, params, false)
      |> maybe_thinking(state.thinking, state.reasoning_effort)

    url = endpoint_url(state.endpoint)
    headers = [{"authorization", "Bearer #{key}"}]
    post = state.http_fn || (&HTTP.post/3)

    result =
      case post.(url, body, headers: headers, receive_timeout: state.timeout) do
        {:ok, status, resp_body} when status in 200..299 ->
          handle_success(state, resp_body, start_time)

        {:error, :http_error, status, message} ->
          handle_http_error(status, message, start_time)

        {:error, reason, _status, message} ->
          handle_connection_error(reason, message, start_time)
      end

    if log = state.log_fn, do: log.(name(), url, body, result, start_time)
    strip_attrs(result)
  end

  def complete(%__MODULE__{}, _model, _prompt, _params) do
    err = UpstreamError.new(:auth, "DeepSeek API key 未配置", name())
    UpstreamError.to_error_tuple(err)
  end

  @impl true
  def execute(%__MODULE__{api_key: key} = state, _model, prompt, params, ctx)
      when (is_binary(prompt) or is_list(prompt) or is_map(prompt)) and is_binary(key) and
             key != "" do
    if NovelAgent.Provider.tool_call_prompt?(prompt) do
      execute_tool_call(state, key, prompt, params, ctx)
    else
      body =
        state
        |> request_body(prompt, params, true)
        |> maybe_thinking(state.thinking, state.reasoning_effort)

      url = endpoint_url(state.endpoint)
      headers = [{"authorization", "Bearer #{key}"}]
      request_opts = [headers: headers, receive_timeout: state.timeout]

      OpenAICompatibleStream.execute(stream_meta(), state, url, body, request_opts, ctx)
    end
  end

  def execute(%__MODULE__{}, _model, _prompt, _params, ctx) do
    err = UpstreamError.new(:auth, "DeepSeek API key 未配置", name())

    err
    |> UpstreamError.to_error_tuple()
    |> AdapterExecution.materialize_result(ctx)
  end

  defp endpoint_url(endpoint) do
    endpoint
    |> String.trim_trailing("/")
    |> Kernel.<>("/chat/completions")
  end

  defp request_body(state, prompt, params, stream?) do
    %{
      model: state.model,
      messages: NovelAgent.Provider.normalize_messages(prompt),
      stream: stream?
    }
    |> HTTP.apply_params(params)
    |> maybe_json_mode(state.json_mode, prompt)
    |> NovelAgent.Provider.put_openai_tools(prompt)
  end

  defp maybe_json_mode(body, true, prompt) do
    if NovelAgent.Provider.tool_call_prompt?(prompt) do
      body
    else
      Map.put(body, :response_format, %{type: "json_object"})
    end
  end

  defp maybe_json_mode(body, _enabled, _prompt), do: body

  # DeepSeek API 约束：thinking 模式不支持强制具名 tool_choice（HTTP 400
  # "Thinking mode does not support this tool_choice"）。规划类调用依赖强制
  # tool call 的结构确定性，thinking 对其非必需——该请求整形为 disabled 并留痕。
  defp maybe_thinking(%{tool_choice: %{}} = body, :enabled, _effort) do
    Logger.info(
      "[DeepSeek] 请求带强制 tool_choice，thinking 按能力约束降级为 disabled（thinking 模式不支持强制具名 tool_choice）"
    )

    Map.put(body, :thinking, %{type: "disabled"})
  end

  defp maybe_thinking(body, :enabled, effort) when is_binary(effort) and effort != "" do
    body
    |> Map.put(:thinking, %{type: "enabled"})
    |> Map.put(:reasoning_effort, effort)
  end

  defp maybe_thinking(body, :enabled, _effort), do: Map.put(body, :thinking, %{type: "enabled"})
  defp maybe_thinking(body, _thinking, _effort), do: Map.put(body, :thinking, %{type: "disabled"})

  defp strip_attrs({:ok, result, _attrs}), do: {:ok, result}
  defp strip_attrs({:error, {:error, map}, _attrs}), do: {:error, map}

  defp execute_tool_call(state, key, prompt, params, ctx) do
    start_time = System.monotonic_time(:millisecond)

    body =
      state
      |> request_body(prompt, params, false)
      |> maybe_thinking(state.thinking, state.reasoning_effort)

    url = endpoint_url(state.endpoint)
    headers = [{"authorization", "Bearer #{key}"}]
    post = state.http_fn || (&HTTP.post/3)
    initial_events = AdapterExecution.initial_events(ctx)
    AdapterExecution.emit_events(ctx, initial_events, :running)

    result =
      case post.(url, body, headers: headers, receive_timeout: state.timeout) do
        {:ok, status, resp_body} when status in 200..299 ->
          handle_success(state, resp_body, start_time)

        {:error, :http_error, status, message} ->
          handle_http_error(status, message, start_time)

        {:error, reason, _status, message} ->
          handle_connection_error(reason, message, start_time)
      end

    if log = state.log_fn, do: log.(name(), url, body, result, start_time)

    result
    |> strip_attrs()
    |> AdapterExecution.materialize_result(ctx, initial_events: initial_events, emit: :terminal)
  end

  # ── response handlers ────────────────────────

  defp handle_success(state, resp_body, start_time) do
    message = get_in(resp_body, ["choices", Access.at(0), "message"]) || %{}
    content = Map.get(message, "content") || ""
    tool_calls = NovelAgent.Provider.extract_openai_tool_calls(message)
    latency = System.monotonic_time(:millisecond) - start_time
    usage = Usage.from_openai_response(resp_body, state.model, latency)

    if (is_binary(content) and content != "") or tool_calls != [] do
      Logger.debug(
        "[DeepSeek] 调用成功，输入 #{usage.input_tokens} tokens，输出 #{usage.output_tokens} tokens"
      )

      {:ok, Result.new(content, usage, tool_calls: tool_calls),
       %{status: 200, usage: usage, duration: latency, resp_body: Jason.encode!(resp_body)}}
    else
      err = UpstreamError.new(:invalid_response, "DeepSeek API 响应内容为空", name())
      Logger.warning("[DeepSeek] #{err.message}")

      {:error, UpstreamError.to_error_tuple(err),
       %{status: 200, usage: usage, duration: latency, resp_body: Jason.encode!(resp_body)}}
    end
  end

  defp handle_http_error(status, message, start_time) do
    duration = System.monotonic_time(:millisecond) - start_time
    type = http_error_type(status)
    err = UpstreamError.new(type, "DeepSeek API: #{message}", name())
    Logger.warning("[DeepSeek] #{err.message}")

    {:error, UpstreamError.to_error_tuple(err),
     %{status: status, usage: %{}, duration: duration, resp_body: message}}
  end

  defp http_error_type(status) when status in [401, 402, 403], do: :auth
  defp http_error_type(429), do: :rate_limit
  # 400/422 = DeepSeek 拒绝了我们发出的请求（如非法的 reasoning_effort 参数），
  # 是客户端请求问题，不是上游空响应；映射为 :invalid_request 让上层给出准确文案。
  defp http_error_type(status) when status in [400, 422], do: :invalid_request
  defp http_error_type(_status), do: :provider_internal

  defp handle_connection_error(:connection_refused, _msg, start_time) do
    duration = System.monotonic_time(:millisecond) - start_time
    err = UpstreamError.new(:connection_refused, "无法连接 DeepSeek API", name())
    Logger.warning("[DeepSeek] #{err.message}")

    {:error, UpstreamError.to_error_tuple(err),
     %{status: 0, usage: %{}, duration: duration, resp_body: "connection_refused"}}
  end

  defp handle_connection_error(:timeout, _msg, start_time) do
    duration = System.monotonic_time(:millisecond) - start_time
    err = UpstreamError.new(:timeout, "DeepSeek API 请求超时", name())
    Logger.warning("[DeepSeek] #{err.message}")

    {:error, UpstreamError.to_error_tuple(err),
     %{status: 0, usage: %{}, duration: duration, resp_body: "timeout"}}
  end

  defp handle_connection_error(_reason, message, start_time) do
    duration = System.monotonic_time(:millisecond) - start_time
    err = UpstreamError.new(:provider_internal, message, name())
    Logger.warning("[DeepSeek] #{err.message}")

    {:error, UpstreamError.to_error_tuple(err),
     %{status: 0, usage: %{}, duration: duration, resp_body: message}}
  end

  @impl true
  def name, do: "deepseek"

  @impl true
  def health_check(%__MODULE__{api_key: key}) when is_binary(key) and key != "", do: :ok

  def health_check(%__MODULE__{}),
    do: {:error, %{message: "DeepSeek API key 未配置", type: :unauthorized}}

  @impl true
  def list_models(%__MODULE__{api_key: key} = state) when is_binary(key) and key != "" do
    url = models_url(state.endpoint)
    get = state.get_fn || (&HTTP.get/2)
    headers = [{"authorization", "Bearer #{key}"}]

    case get.(url, headers: headers, receive_timeout: state.timeout || 15_000) do
      {:ok, _status, body} ->
        {:ok, models_from_openai_list(body)}

      {:error, :http_error, status, message} ->
        {:error, %{message: "DeepSeek API: #{message}", type: http_error_type(status)}}

      {:error, :connection_refused, _status, _message} ->
        {:error, %{message: "无法连接 DeepSeek API", type: :connection_refused}}

      {:error, :timeout, _status, _message} ->
        {:error, %{message: "DeepSeek API 请求超时", type: :timeout}}

      {:error, reason, _status, message} ->
        {:error, %{message: message, type: reason}}
    end
  end

  def list_models(%__MODULE__{}),
    do: {:error, %{message: "DeepSeek API key 未配置", type: :unauthorized}}

  @doc "从应用配置构建 state struct。支持环境变量 DEEPSEEK_API_KEY。"
  @spec from_config() :: t()
  def from_config(config \\ Application.get_env(:novel_agent, __MODULE__, [])) do
    %__MODULE__{
      api_key: Keyword.get(config, :api_key) || System.get_env("DEEPSEEK_API_KEY"),
      endpoint: Keyword.get(config, :endpoint, @default_endpoint),
      model: Keyword.get(config, :model, @default_model),
      timeout: Keyword.get(config, :timeout, 300_000),
      http_fn: Keyword.get(config, :http_fn, &HTTP.post/3),
      eventsource_fn: Keyword.get(config, :eventsource_fn, &HTTP.post_event_stream/4),
      get_fn: Keyword.get(config, :get_fn, &HTTP.get/2),
      log_fn: Keyword.get(config, :log_fn, &NovelCommon.LLMLog.record/5),
      json_mode: Keyword.get(config, :json_mode, false),
      thinking: normalize_thinking(Keyword.get(config, :thinking, :disabled)),
      reasoning_effort: Keyword.get(config, :reasoning_effort)
    }
  end

  defp normalize_thinking(value) when value in [:enabled, "enabled", true], do: :enabled
  defp normalize_thinking(_value), do: :disabled

  defp stream_meta, do: %{vendor: name(), label: "DeepSeek"}

  defp models_url(endpoint) do
    endpoint
    |> String.trim_trailing("/")
    |> Kernel.<>("/models")
  end

  defp models_from_openai_list(%{"data" => models}) when is_list(models) do
    models
    |> Enum.flat_map(&model_from_openai_entry/1)
    |> Enum.uniq_by(& &1.id)
  end

  defp models_from_openai_list(_body), do: []

  defp model_from_openai_entry(%{"id" => id} = model) when is_binary(id) and id != "" do
    [
      %{
        id: id,
        label: id,
        owned_by: normalize_owned_by(model["owned_by"])
      }
    ]
  end

  defp model_from_openai_entry(_entry), do: []

  defp normalize_owned_by(owner) when is_binary(owner) and owner != "", do: owner
  defp normalize_owned_by(_owner), do: nil
end
