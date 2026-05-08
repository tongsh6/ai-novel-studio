defmodule NovelAgent.Provider.LMStudio do
  @moduledoc """
  LM Studio 本地推理 Provider adapter。

  LM Studio 暴露 OpenAI 兼容的 HTTP API（默认 `http://localhost:1234/v1`）。
  本 adapter 通过共享的 `Provider.HTTP` 模块发送请求。
  """

  @behaviour NovelAgent.Provider

  require Logger

  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.Result
  alias NovelFoundation.UpstreamError

  defstruct [:endpoint, :model, :timeout, :http_fn]

  @type http_fn :: (String.t(), map(), keyword() -> HTTP.http_result())

  @type t :: %__MODULE__{
          endpoint: String.t(),
          model: String.t(),
          timeout: pos_integer(),
          http_fn: http_fn()
        }

  @impl true
  def complete(%__MODULE__{} = state, _model, prompt, params) when is_binary(prompt) do
    start_time = System.monotonic_time(:millisecond)
    body = HTTP.apply_params(%{
      model: state.model,
      messages: [%{role: "user", content: prompt}]
    }, params)
    url = Path.join(state.endpoint, "chat/completions")

    post = state.http_fn || &HTTP.post/3

    result =
      case post.(url, body, receive_timeout: state.timeout) do
        {:ok, 200, resp_body} ->
          handle_success(resp_body, start_time)

        {:error, reason, _status, message} ->
          handle_error(reason, message, start_time)
      end

    NovelAgent.LLMLog.record(name(), url, body, result, start_time)
    strip_attrs(result)
  end

  # ── response handlers ────────────────────────

  defp handle_success(resp_body, start_time) do
    content = get_in(resp_body, ["choices", Access.at(0), "message", "content"])
    duration = System.monotonic_time(:millisecond) - start_time
    usage = resp_body["usage"] || %{}

    if content && content != "" do
      Logger.debug("[LMStudio] 调用成功，返回 #{byte_size(content)} 字节")
      {:ok, Result.new(content), %{status: 200, usage: usage, duration: duration, resp_body: Jason.encode!(resp_body)}}
    else
      err = UpstreamError.new(:invalid_response, "响应内容为空", name())
      Logger.warning("[LMStudio] #{err.message}")
      attrs = %{status: 200, usage: usage, duration: duration, resp_body: Jason.encode!(resp_body)}
      {:error, UpstreamError.to_error_tuple(err), attrs}
    end
  end

  defp handle_error(:connection_refused, _msg, start_time) do
    duration = System.monotonic_time(:millisecond) - start_time
    err = UpstreamError.new(:connection_refused, "LM Studio 未启动", name())
    Logger.warning("[LMStudio] #{err.message}")
    {:error, UpstreamError.to_error_tuple(err),
     %{status: 0, usage: %{}, duration: duration, resp_body: "connection_refused"}}
  end

  defp handle_error(:timeout, _msg, start_time) do
    duration = System.monotonic_time(:millisecond) - start_time
    err = UpstreamError.new(:timeout, "LM Studio 请求超时", name())
    Logger.warning("[LMStudio] #{err.message}")
    {:error, UpstreamError.to_error_tuple(err),
     %{status: 0, usage: %{}, duration: duration, resp_body: "timeout"}}
  end

  defp handle_error(_reason, message, start_time) do
    duration = System.monotonic_time(:millisecond) - start_time
    err = UpstreamError.new(:provider_internal, message, name())
    Logger.warning("[LMStudio] #{err.message}")
    {:error, UpstreamError.to_error_tuple(err),
     %{status: 0, usage: %{}, duration: duration, resp_body: message}}
  end

  defp strip_attrs({:ok, result, _attrs}), do: {:ok, result}
  defp strip_attrs({:error, {:error, map}, _attrs}), do: {:error, map}

  @impl true
  def name, do: "lmstudio"

  @doc "从应用配置构建 state struct。"
  @spec from_config() :: t()
  def from_config do
    config = Application.get_env(:novel_agent, __MODULE__, [])

    %__MODULE__{
      endpoint: Keyword.get(config, :endpoint, "http://localhost:1234/v1"),
      model: Keyword.get(config, :model, "qwen/qwen3.6-35b-a3b"),
      timeout: Keyword.get(config, :timeout, 60_000),
      http_fn: Keyword.get(config, :http_fn, &HTTP.post/3)
    }
  end
end
