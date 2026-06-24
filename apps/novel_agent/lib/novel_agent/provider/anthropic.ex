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

  require Logger

  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.Result
  alias NovelAgent.Provider.Usage
  alias NovelFoundation.UpstreamError

  defstruct [:api_key, :model, :timeout, :http_fn, :get_fn, :log_fn]

  @type http_fn :: (String.t(), map(), keyword() -> HTTP.http_result())
  @type get_fn :: (String.t(), keyword() -> HTTP.http_result())
  @type log_fn :: (String.t(), String.t(), map(), term(), integer() -> :ok)

  @type t :: %__MODULE__{
          api_key: String.t(),
          model: String.t(),
          timeout: pos_integer(),
          http_fn: http_fn(),
          get_fn: get_fn(),
          log_fn: log_fn()
        }

  @api_base "https://api.anthropic.com/v1"
  @api_version "2023-06-01"

  @impl true
  def complete(%__MODULE__{} = state, _model, prompt, params)
      when is_binary(prompt) or is_list(prompt) do
    start_time = System.monotonic_time(:millisecond)
    {system_prompt, messages} = anthropic_messages(prompt)
    body = %{model: state.model, max_tokens: 4096, messages: messages}
    body = if system_prompt, do: Map.put(body, :system, system_prompt), else: body
    body = HTTP.apply_params(body, params)
    url = Path.join(@api_base, "messages")
    headers = [{"x-api-key", state.api_key}, {"anthropic-version", @api_version}]

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

  defp anthropic_messages(prompt) do
    messages = NovelAgent.Provider.normalize_messages(prompt)

    {system_messages, chat_messages} =
      Enum.split_with(messages, fn message -> message.role == "system" end)

    system_prompt =
      case Enum.map(system_messages, & &1.content) do
        [] -> nil
        parts -> Enum.join(parts, "\n\n")
      end

    fallback_messages =
      case chat_messages do
        [] -> [%{role: "user", content: system_prompt || ""}]
        messages -> messages
      end

    {system_prompt, fallback_messages}
  end

  defp strip_attrs({:ok, result, _attrs}), do: {:ok, result}
  defp strip_attrs({:error, {:error, map}, _attrs}), do: {:error, map}

  # ── response handlers ────────────────────────

  defp handle_success(state, resp_body, start_time) do
    content = get_in(resp_body, ["content", Access.at(0), "text"]) || ""
    latency = System.monotonic_time(:millisecond) - start_time

    usage = Usage.from_anthropic_response(resp_body, state.model, latency)

    Logger.debug(
      "[Anthropic] 调用成功，输入 #{usage.input_tokens} tokens，输出 #{usage.output_tokens} tokens"
    )

    {:ok, Result.new(content, usage),
     %{status: 200, usage: usage, duration: latency, resp_body: Jason.encode!(resp_body)}}
  end

  defp handle_http_error(status, message, start_time) do
    duration = System.monotonic_time(:millisecond) - start_time

    type = http_error_type(status)
    err = UpstreamError.new(type, "Anthropic API: #{message}", name())
    Logger.warning("[Anthropic] #{err.message}")

    {:error, UpstreamError.to_error_tuple(err),
     %{status: status, usage: %{}, duration: duration, resp_body: message}}
  end

  defp handle_connection_error(:connection_refused, _msg, start_time) do
    duration = System.monotonic_time(:millisecond) - start_time
    err = UpstreamError.new(:connection_refused, "无法连接 Anthropic API", name())
    Logger.warning("[Anthropic] #{err.message}")

    {:error, UpstreamError.to_error_tuple(err),
     %{status: 0, usage: %{}, duration: duration, resp_body: "connection_refused"}}
  end

  defp handle_connection_error(:timeout, _msg, start_time) do
    duration = System.monotonic_time(:millisecond) - start_time
    err = UpstreamError.new(:timeout, "Anthropic API 请求超时", name())
    Logger.warning("[Anthropic] #{err.message}")

    {:error, UpstreamError.to_error_tuple(err),
     %{status: 0, usage: %{}, duration: duration, resp_body: "timeout"}}
  end

  defp handle_connection_error(_reason, message, start_time) do
    duration = System.monotonic_time(:millisecond) - start_time
    err = UpstreamError.new(:provider_internal, message, name())
    Logger.warning("[Anthropic] #{err.message}")

    {:error, UpstreamError.to_error_tuple(err),
     %{status: 0, usage: %{}, duration: duration, resp_body: message}}
  end

  @impl true
  def name, do: "anthropic"

  @impl true
  def health_check(%__MODULE__{api_key: key}) when is_binary(key) and key != "", do: :ok

  def health_check(%__MODULE__{}),
    do: {:error, %{message: "Anthropic API key 未配置", type: :unauthorized}}

  @impl true
  def list_models(%__MODULE__{api_key: key} = state) when is_binary(key) and key != "" do
    url = Path.join(@api_base, "models")
    get = state.get_fn || (&HTTP.get/2)
    headers = [{"x-api-key", key}, {"anthropic-version", @api_version}]

    case get.(url, headers: headers, receive_timeout: state.timeout || 15_000) do
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
      get_fn: Keyword.get(config, :get_fn, &HTTP.get/2),
      log_fn: Keyword.get(config, :log_fn, &NovelCommon.LLMLog.record/5)
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
