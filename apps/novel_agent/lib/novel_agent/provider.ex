defmodule NovelAgent.Provider do
  @moduledoc """
  Provider behaviour — LLM 能力提供者的统一抽象。

  定义 complete/3 的最小接口。每个 adapter 返回 `{:ok, %Result{}}` 或 `{:error, reason}`。
  Gateway 负责将旧版 `{:ok, content_string}` 自动包装为 Result。
  """

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.Result

  @type message :: %{required(:role) => String.t(), required(:content) => String.t()}
  @type prompt :: String.t() | [message()]
  @type model :: String.t()

  @type result :: {:ok, Result.t()} | {:error, reason :: term()}

  @doc """
  一次性请求并返回完整结果。

  params 为跨 provider 通用的推理参数，各 adapter 负责映射为自身 API 字段。
  """
  @callback complete(
              state :: term(),
              model :: model(),
              prompt :: prompt(),
              params :: InferenceParams.t()
            ) :: result()

  @doc """
  轻量健康检查——不调用 LLM，不消耗 token。

  LM Studio: GET /v1/models
  Anthropic: 仅检查 API key 是否配置
  Stub: 始终 :ok
  """
  @callback health_check(state :: term()) :: :ok | {:error, term()}

  @doc """
  返回 provider 名称（用于日志和 audit）。
  """
  @callback name() :: String.t()

  @doc """
  Normalize legacy string prompts and chat prompts into OpenAI-compatible
  message maps.
  """
  @spec normalize_messages(prompt()) :: [message()]
  def normalize_messages(prompt) when is_binary(prompt), do: [%{role: "user", content: prompt}]

  def normalize_messages(messages) when is_list(messages) do
    Enum.map(messages, fn message ->
      role = Map.get(message, :role) || Map.get(message, "role")
      content = Map.get(message, :content) || Map.get(message, "content")

      %{role: to_string(role || "user"), content: to_string(content || "")}
    end)
  end
end
