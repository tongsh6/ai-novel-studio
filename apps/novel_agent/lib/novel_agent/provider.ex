defmodule NovelAgent.Provider do
  @moduledoc """
  Provider behaviour — LLM 能力提供者的统一抽象。

  定义 complete/2 的最小接口。stream / estimate / describe 留待后续 Phase 按需添加。
  """

  @type prompt :: String.t()
  @type model :: String.t()

  @type result :: {:ok, String.t()} | {:error, reason :: term()}

  @doc """
  一次性请求并返回完整结果。
  """
  @callback complete(state :: term(), model :: model(), prompt :: prompt()) :: result()

  @doc """
  返回 provider 名称（用于日志和 audit）。
  """
  @callback name() :: String.t()
end
