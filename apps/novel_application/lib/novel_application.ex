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
  @spec provider_health() ::
          {:ok, %{provider: atom(), model: String.t() | nil}}
          | {:error, %{provider: atom(), model: String.t() | nil, error: map()}}
  def provider_health do
    metadata = Gateway.provider_metadata()

    case Gateway.health_check() do
      :ok -> {:ok, metadata}
      {:error, error} -> {:error, Map.put(metadata, :error, error)}
    end
  end

  @doc """
  返回可配置 provider 列表和当前运行时选择。

  返回值不包含 API key 等 secret。
  """
  @spec provider_options() :: %{current_provider: atom(), providers: [map()]}
  def provider_options do
    Gateway.provider_options()
  end

  @doc """
  按当前运行时 provider 解析创作执行的上下文组装策略（VS-00C CP1）。

  在应用边界集中解析 provider→profile，挂到 DialogueContext envelope（`06` §5.3）；
  ContextAssembler 与 TurnExecutionService 只读 envelope，不直接够 provider 运行时。
  Gateway 不可用时安全回落地板档。
  """
  @spec current_assembly_policy() :: NovelDomain.AssemblyPolicy.t()
  def current_assembly_policy do
    provider =
      try do
        Gateway.provider_options() |> Map.get(:current_provider)
      rescue
        _ -> nil
      end

    NovelDomain.AssemblyPolicy.for_provider(provider)
  end

  @doc """
  保存当前运行时 provider 选择与配置。
  """
  @spec configure_provider(map()) ::
          {:ok, %{provider: atom(), model: String.t() | nil}} | {:error, map()}
  def configure_provider(attrs) when is_map(attrs) do
    Gateway.configure_provider(attrs)
  end

  @doc """
  使用传入 provider 配置做轻量连接测试，不改变当前运行时选择。
  """
  @spec test_provider(map()) ::
          {:ok, %{provider: atom(), model: String.t() | nil}} | {:error, map()}
  def test_provider(attrs) when is_map(attrs) do
    Gateway.test_provider(attrs)
  end

  @doc """
  使用传入 provider 配置实时拉取模型列表，不改变当前运行时选择。
  """
  @spec provider_models(map()) ::
          {:ok, %{provider: atom(), models: [map()]}} | {:error, map()}
  def provider_models(attrs) when is_map(attrs) do
    Gateway.provider_models(attrs)
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

  @doc """
  返回 overwrite reader 用于采纳边界判断「同 title 章节是否已有已采纳正文」。
  未启用真实持久化时返回 nil（视为不存在覆盖）。
  """
  def persistence_overwrite_reader do
    if inject_persistence?(), do: NovelPersistence.AdoptionRepository.overwrite_reader()
  end

  @doc """
  返回章节正文读端口：(work_id, chapter_title) -> 该章已采纳正文（续写/重写衔接用）。
  未启用真实持久化时返回 nil（视为无前文，prose_writing 不带本章已采纳正文）。
  """
  def persistence_chapter_prose_reader do
    if inject_persistence?(), do: &NovelPersistence.ReadingProjectionRepo.accepted_chapter_prose/2
  end

  defp inject_persistence? do
    Application.get_env(:novel_web, :persistence, [])
    |> Keyword.get(:inject_real_persistence, false)
  end
end
