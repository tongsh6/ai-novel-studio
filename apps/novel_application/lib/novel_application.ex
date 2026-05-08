defmodule NovelApplication do
  @moduledoc """
  Application 层根模块。v3 VS-00 阶段提供 DialogueGateway 作为对话入口。

  依赖方向：novel_agent + novel_domain → novel_application
  不依赖：novel_web / novel_persistence
  """

  alias NovelAgent.Provider.Gateway

  @doc """
  检查 LLM provider 连接状态。
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
