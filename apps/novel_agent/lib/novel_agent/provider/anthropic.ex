defmodule NovelAgent.Provider.Anthropic do
  @moduledoc """
  Anthropic (Claude) API Provider adapter。

  通过 Anthropic Messages API 调用 Claude 模型。使用共享的 `Provider.HTTP` 发送请求。

  ## 配置

      config :novel_agent, NovelAgent.Provider.Anthropic,
        api_key: "sk-ant-...",
        model: "claude-sonnet-4-6",
        timeout: 120_000

  或通过环境变量 ANTHROPIC_API_KEY 设置。
  """

  @behaviour NovelAgent.Provider

  require Logger

  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.Result
  alias NovelAgent.Provider.Usage
  alias NovelFoundation.UpstreamError

  defstruct [:api_key, :model, :timeout, :http_fn, :log_fn]

  @type http_fn :: (String.t(), map(), keyword() -> HTTP.http_result())
  @type log_fn :: (String.t(), String.t(), map(), term(), integer() -> :ok)

  @type t :: %__MODULE__{
          api_key: String.t(),
          model: String.t(),
          timeout: pos_integer(),
          http_fn: http_fn(),
          log_fn: log_fn()
        }

  @api_base "https://api.anthropic.com/v1"
  @api_version "2023-06-01"

  @impl true
  def complete(%__MODULE__{} = state, _model, prompt, params) when is_binary(prompt) do
    start_time = System.monotonic_time(:millisecond)
    body = %{model: state.model, max_tokens: 4096, messages: [%{role: "user", content: prompt}]}
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

  defp strip_attrs({:ok, result, _attrs}), do: {:ok, result}
  defp strip_attrs({:error, {:error, map}, _attrs}), do: {:error, map}

  # ── response handlers ────────────────────────

  defp handle_success(state, resp_body, start_time) do
    content = get_in(resp_body, ["content", Access.at(0), "text"]) || ""
    latency = System.monotonic_time(:millisecond) - start_time

    usage = %Usage{
      input_tokens: get_in(resp_body, ["usage", "input_tokens"]) || 0,
      output_tokens: get_in(resp_body, ["usage", "output_tokens"]) || 0,
      model: state.model,
      latency_ms: latency
    }

    Logger.debug(
      "[Anthropic] 调用成功，输入 #{usage.input_tokens} tokens，输出 #{usage.output_tokens} tokens"
    )

    {:ok, Result.new(content, usage),
     %{status: 200, usage: usage, duration: latency, resp_body: Jason.encode!(resp_body)}}
  end

  defp handle_http_error(status, message, start_time) do
    duration = System.monotonic_time(:millisecond) - start_time

    type = if status in [401, 403], do: :auth, else: :invalid_response
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

  @doc "从应用配置构建 state struct。支持环境变量 ANTHROPIC_API_KEY。"
  @spec from_config() :: t()
  def from_config do
    config = Application.get_env(:novel_agent, __MODULE__, [])

    %__MODULE__{
      api_key: Keyword.get(config, :api_key) || System.get_env("ANTHROPIC_API_KEY"),
      model: Keyword.get(config, :model, "claude-sonnet-4-6"),
      timeout: Keyword.get(config, :timeout, 120_000),
      http_fn: Keyword.get(config, :http_fn, &HTTP.post/3),
      log_fn: Keyword.get(config, :log_fn, &NovelCommon.LLMLog.record/5)
    }
  end
end
