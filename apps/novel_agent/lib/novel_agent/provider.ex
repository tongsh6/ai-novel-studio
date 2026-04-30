defmodule NovelAgent.Provider do
  @moduledoc """
  Provider behaviour — LLM 能力提供者的统一抽象。

  定义 complete/3 的最小接口。每个 adapter 返回 `{:ok, %Result{}}` 或 `{:error, reason}`。
  Gateway 负责将旧版 `{:ok, content_string}` 自动包装为 Result。
  """

  alias NovelAgent.Provider.Result

  @type prompt :: String.t()
  @type model :: String.t()

  @type result :: {:ok, Result.t()} | {:error, reason :: term()}

  @doc """
  一次性请求并返回完整结果。

  返回 `{:ok, %Provider.Result{content: content, usage: usage}}`。
  usage 为 `%Provider.Usage{}` 或 nil（stub/LM Studio 等不返回 token 计数的 provider）。
  """
  @callback complete(state :: term(), model :: model(), prompt :: prompt()) :: result()

  @doc """
  返回 provider 名称（用于日志和 audit）。
  """
  @callback name() :: String.t()
end
