defmodule NovelAgent.Provider.DeepSeek do
  @moduledoc """
  DeepSeek API provider adapter.

  DeepSeek exposes an OpenAI-compatible non-streaming chat completion API. This
  adapter keeps the project contract stable: callers still go through
  `Provider.Gateway` and receive `Provider.Result`.
  """

  @behaviour NovelAgent.Provider

  require Logger

  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.Result
  alias NovelAgent.Provider.Usage
  alias NovelFoundation.UpstreamError

  defstruct [
    :api_key,
    :endpoint,
    :model,
    :timeout,
    :http_fn,
    :get_fn,
    :log_fn,
    :json_mode,
    :thinking,
    :reasoning_effort
  ]

  @type http_fn :: (String.t(), map(), keyword() -> HTTP.http_result())
  @type get_fn :: (String.t(), keyword() -> HTTP.http_result())
  @type log_fn :: (String.t(), String.t(), map(), term(), integer() -> :ok)
  @type thinking :: :enabled | :disabled

  @type t :: %__MODULE__{
          api_key: String.t() | nil,
          endpoint: String.t(),
          model: String.t(),
          timeout: pos_integer(),
          http_fn: http_fn() | nil,
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
      when (is_binary(prompt) or is_list(prompt)) and is_binary(key) and key != "" do
    start_time = System.monotonic_time(:millisecond)

    body =
      %{
        model: state.model,
        messages: NovelAgent.Provider.normalize_messages(prompt),
        stream: false
      }
      |> HTTP.apply_params(params)
      |> maybe_json_mode(state.json_mode)
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

  defp endpoint_url(endpoint) do
    endpoint
    |> String.trim_trailing("/")
    |> Kernel.<>("/chat/completions")
  end

  defp maybe_json_mode(body, true), do: Map.put(body, :response_format, %{type: "json_object"})
  defp maybe_json_mode(body, _), do: body

  defp maybe_thinking(body, :enabled, effort) when is_binary(effort) and effort != "" do
    body
    |> Map.put(:thinking, %{type: "enabled"})
    |> Map.put(:reasoning_effort, effort)
  end

  defp maybe_thinking(body, :enabled, _effort), do: Map.put(body, :thinking, %{type: "enabled"})
  defp maybe_thinking(body, _thinking, _effort), do: Map.put(body, :thinking, %{type: "disabled"})

  defp strip_attrs({:ok, result, _attrs}), do: {:ok, result}
  defp strip_attrs({:error, {:error, map}, _attrs}), do: {:error, map}

  # ── response handlers ────────────────────────

  defp handle_success(state, resp_body, start_time) do
    content = get_in(resp_body, ["choices", Access.at(0), "message", "content"]) || ""
    latency = System.monotonic_time(:millisecond) - start_time
    usage = Usage.from_openai_response(resp_body, state.model, latency)

    if is_binary(content) and content != "" do
      Logger.debug(
        "[DeepSeek] 调用成功，输入 #{usage.input_tokens} tokens，输出 #{usage.output_tokens} tokens"
      )

      {:ok, Result.new(content, usage),
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
      get_fn: Keyword.get(config, :get_fn, &HTTP.get/2),
      log_fn: Keyword.get(config, :log_fn, &NovelCommon.LLMLog.record/5),
      json_mode: Keyword.get(config, :json_mode, false),
      thinking: normalize_thinking(Keyword.get(config, :thinking, :disabled)),
      reasoning_effort: Keyword.get(config, :reasoning_effort)
    }
  end

  defp normalize_thinking(value) when value in [:enabled, "enabled", true], do: :enabled
  defp normalize_thinking(_value), do: :disabled

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
