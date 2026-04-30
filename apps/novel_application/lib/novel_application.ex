defmodule NovelApplication do
  @moduledoc """
  Application 层根模块。

  本 app 负责用例编排，协调 Agent Runtime 与 Domain：
  - 上下文组装与策略选择
  - 用例流程编排（创建工作、推进章节、改稿等）
  - Prompt 构建
  - 领域对象注册

  依赖方向：novel_agent + novel_domain → novel_application
  不依赖：novel_web / novel_persistence
  """

  alias NovelAgent.Provider.Gateway

  @doc """
  检查 LLM provider 连接状态。通过 Gateway ping 当前配置的 provider。
  返回 `{:ok, provider_name}` 或 `{:error, reason}`。
  """
  @spec provider_health() :: {:ok, atom()} | {:error, map()}
  def provider_health do
    provider = Application.get_env(:novel_agent, :provider)[:default] || :unknown

    case Gateway.complete("ping") do
      {:ok, _result} -> {:ok, provider}
      {:error, error} -> {:error, error}
    end
  end
end
