defmodule NovelAgent.Provider.LMStudio do
  @moduledoc """
  LM Studio 本地推理 Provider adapter。

  LM Studio 暴露 OpenAI 兼容的 HTTP API（默认 `http://localhost:1234/v1`）。
  本 adapter 通过标准 HTTP POST 调用 `/v1/chat/completions`，不引入供应商特定 SDK。

  ## 配置

      config :novel_agent, NovelAgent.Provider.LMStudio,
        endpoint: "http://localhost:1234/v1",
        model: "local-model",
        timeout: 60_000

  ## 开发阶段定位

  开发阶段使用 LM Studio / Ollama 等本地模型的三重理由：
  1. 本地模型能力有限，能充分暴露 prompt 质量、slot 提取、error handling 等问题
  2. 零 token 费用
  3. 本机推理无需网络
  """

  @behaviour NovelAgent.Provider

  require Logger

  alias NovelAgent.Provider.Result
  alias NovelFoundation.UpstreamError

  defstruct [:endpoint, :model, :timeout]

  @type t :: %__MODULE__{
          endpoint: String.t(),
          model: String.t(),
          timeout: pos_integer()
        }

  @impl true
  def complete(%__MODULE__{} = state, _model, prompt) when is_binary(prompt) do
    body = %{
      model: state.model,
      messages: [%{role: "user", content: prompt}],
      temperature: 0.7,
      max_tokens: -1
    }

    url = Path.join(state.endpoint, "chat/completions")

    case Req.post(url,
           json: body,
           retry: false,
           receive_timeout: state.timeout,
           connect_options: [timeout: state.timeout]
         ) do
      {:ok, %{status: 200, body: resp_body}} ->
        content = get_in(resp_body, ["choices", Access.at(0), "message", "content"])

        if content && content != "" do
          Logger.debug("[LMStudio] 调用成功，返回 #{byte_size(content)} 字节")
          {:ok, Result.new(content)}
        else
          err = UpstreamError.new(:invalid_response, "响应内容为空", name())
          Logger.warning("[LMStudio] #{err.message}")
          UpstreamError.to_error_tuple(err)
        end

      {:ok, %{status: status, body: _body}} ->
        err =
          UpstreamError.new(
            :invalid_response,
            "HTTP #{status} 错误",
            name()
          )

        Logger.warning("[LMStudio] #{err.message}")
        UpstreamError.to_error_tuple(err)

      {:error, %{reason: reason}} when reason in [:econnrefused, :nxdomain, :timeout] ->
        type = if reason == :timeout, do: :timeout, else: :connection_refused
        msg = if reason == :timeout, do: "LM Studio 请求超时", else: "LM Studio 未启动"
        err = UpstreamError.new(type, msg, name())
        Logger.warning("[LMStudio] #{err.message}")
        UpstreamError.to_error_tuple(err)

      {:error, other} ->
        err =
          UpstreamError.new(:provider_internal, "请求失败：#{inspect(other)}", name())

        Logger.warning("[LMStudio] #{err.message}")
        UpstreamError.to_error_tuple(err)
    end
  end

  @impl true
  def name, do: "lmstudio"

  @doc "从应用配置构建 state struct。"
  @spec from_config() :: t()
  def from_config do
    config = Application.get_env(:novel_agent, __MODULE__, [])

    %__MODULE__{
      endpoint: Keyword.get(config, :endpoint, "http://localhost:1234/v1"),
      model: Keyword.get(config, :model, "local-model"),
      timeout: Keyword.get(config, :timeout, 60_000)
    }
  end
end
