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

    case Gateway.health_check() do
      :ok -> {:ok, provider}
      {:error, error} -> {:error, error}
    end
  end

  @doc """
  返回 context_fetcher 用于注入 DialogueGateway。启用真实持久化时返回 DB fetcher。
  """
  def persistence_fetcher do
    if inject_persistence?(), do: NovelPersistence.WorkspaceContext.context_fetcher_with_query()
  end

  @doc """
  返回 trace_persister 用于注入 DialogueGateway。启用真实持久化时返回 DB persister。
  """
  def persistence_tracer do
    if inject_persistence?(), do: NovelPersistence.WorkspaceContext.trace_persister()
  end

  @doc """
  返回 interaction recorder 用于注入 DialogueGateway。启用真实持久化时写入 episodic memory。
  """
  def persistence_interaction_recorder do
    if inject_persistence?(), do: NovelPersistence.WorkspaceContext.interaction_recorder()
  end

  @doc """
  返回 adoption writer 用于把作者采纳动作写入 authoritative state 证据。
  """
  def persistence_adoption_writer do
    if inject_persistence?(), do: NovelPersistence.AdoptionRepository.writer()
  end

  defp inject_persistence? do
    Application.get_env(:novel_web, :persistence, [])
    |> Keyword.get(:inject_real_persistence, false)
  end
end
