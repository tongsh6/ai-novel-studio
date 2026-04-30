defmodule NovelAgent.Provider.Anthropic do
  @moduledoc """
  Anthropic (Claude) API Provider adapter。

  通过 Anthropic Messages API 调用 Claude 模型。支持完整的 content + usage 返回。

  ## 配置

      config :novel_agent, NovelAgent.Provider.Anthropic,
        api_key: "sk-ant-...",
        model: "claude-sonnet-4-6",
        timeout: 120_000

  或通过环境变量 ANTHROPIC_API_KEY 设置。
  """

  @behaviour NovelAgent.Provider

  require Logger

  alias NovelAgent.Provider.Result
  alias NovelAgent.Provider.Usage
  alias NovelFoundation.UpstreamError

  defstruct [:api_key, :model, :timeout]

  @type t :: %__MODULE__{
          api_key: String.t(),
          model: String.t(),
          timeout: pos_integer()
        }

  @api_base "https://api.anthropic.com/v1"
  @api_version "2023-06-01"

  @impl true
  def complete(%__MODULE__{} = state, _model, prompt) when is_binary(prompt) do
    start_time = System.monotonic_time(:millisecond)

    body = %{
      model: state.model,
      max_tokens: 4096,
      messages: [%{role: "user", content: prompt}]
    }

    headers = [
      {"x-api-key", state.api_key},
      {"anthropic-version", @api_version},
      {"content-type", "application/json"}
    ]

    url = Path.join(@api_base, "messages")

    case Req.post(url,
           json: body,
           headers: headers,
           retry: false,
           receive_timeout: state.timeout,
           connect_options: [timeout: state.timeout]
         ) do
      {:ok, %{status: 200, body: resp_body}} ->
        handle_success(state, resp_body, start_time)

      {:ok, %{status: status, body: body}} ->
        handle_http_error(status, body)

      {:error, %{reason: reason}} when reason in [:econnrefused, :nxdomain, :timeout] ->
        type = if reason == :timeout, do: :timeout, else: :connection_refused
        msg = if reason == :timeout, do: "Anthropic API 请求超时", else: "无法连接 Anthropic API"
        err = UpstreamError.new(type, msg, name())
        Logger.warning("[Anthropic] #{err.message}")
        UpstreamError.to_error_tuple(err)

      {:error, other} ->
        err = UpstreamError.new(:provider_internal, "请求失败：#{inspect(other)}", name())
        Logger.warning("[Anthropic] #{err.message}")
        UpstreamError.to_error_tuple(err)
    end
  end

  @impl true
  def name, do: "anthropic"

  @doc "从应用配置构建 state struct。支持环境变量 ANTHROPIC_API_KEY。"
  @spec from_config() :: t()
  def from_config do
    config = Application.get_env(:novel_agent, __MODULE__, [])

    %__MODULE__{
      api_key: Keyword.get(config, :api_key) || System.get_env("ANTHROPIC_API_KEY"),
      model: Keyword.get(config, :model, "claude-sonnet-4-6"),
      timeout: Keyword.get(config, :timeout, 120_000)
    }
  end

  # ---- private helpers ----

  defp handle_success(state, resp_body, start_time) do
    content =
      get_in(resp_body, ["content", Access.at(0), "text"]) || ""

    latency = System.monotonic_time(:millisecond) - start_time

    usage = %Usage{
      input_tokens: get_in(resp_body, ["usage", "input_tokens"]) || 0,
      output_tokens: get_in(resp_body, ["usage", "output_tokens"]) || 0,
      model: state.model,
      latency_ms: latency
    }

    Logger.debug("[Anthropic] 调用成功，输入 #{usage.input_tokens} tokens，输出 #{usage.output_tokens} tokens")
    {:ok, Result.new(content, usage)}
  end

  defp handle_http_error(status, body) do
    msg =
      case body do
        %{"error" => %{"message" => err_msg}} -> "Anthropic API 错误 (#{status})：#{err_msg}"
        _ -> "Anthropic API 错误：HTTP #{status}"
      end

    err =
      if status in [401, 403] do
        UpstreamError.new(:auth, msg, name())
      else
        UpstreamError.new(:invalid_response, msg, name())
      end

    Logger.warning("[Anthropic] #{err.message}")
    UpstreamError.to_error_tuple(err)
  end
end
