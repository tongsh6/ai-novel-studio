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

  @doc """
  返回章摘要 maintainer：正文采纳完成后产连续性摘要（VS-00C CP2.1 / contract §5.3）。

  未启用真实持久化时返回 nil（采纳路径无后续摘要副作用）。默认通过
  `NovelApplication.BackgroundTaskSupervisor` **异步**执行，不阻塞作者的采纳响应；
  测试环境可配置为同步执行，避免 Ecto Sandbox owner 退出后后台任务继续持有连接。
  **失败容忍**——绝不抛错、绝不阻断正文采纳主链。
  """
  def chapter_summary_maintainer do
    if inject_persistence?() do
      generator = default_summary_generator()
      repo = default_summary_repo()
      fn input -> run_summary_maintenance_async(input, generator, repo) end
    end
  end

  defp run_summary_maintenance_async(input, generator, repo) do
    task = fn -> NovelApplication.ChapterSummaryMaintenance.run(input, generator, repo) end

    if sync_chapter_summary_maintenance?() do
      _ = task.()
      :ok
    else
      start_background_task(task)
    end
  end

  defp sync_chapter_summary_maintenance? do
    Application.get_env(:novel_application, :sync_chapter_summary_maintenance, false)
  end

  defp start_background_task(task) do
    case Process.whereis(NovelApplication.BackgroundTaskSupervisor) do
      nil ->
        _ = task.()

      _pid ->
        case Task.Supervisor.start_child(NovelApplication.BackgroundTaskSupervisor, task) do
          {:ok, _pid} -> :ok
          {:error, _reason} -> :ok
        end
    end

    :ok
  end

  defp default_summary_generator do
    &NovelApplication.ChapterSummaryGenerator.generate/1
  end

  defp default_summary_repo do
    %{
      supersede: &NovelPersistence.ChapterSummaryRepo.supersede_prior_accepted/2,
      insert: &NovelPersistence.ChapterSummaryRepo.insert/1,
      update_status: &NovelPersistence.ChapterSummaryRepo.update_status/2
    }
  end

  @doc """
  返回章摘要 reader port（VS-00C CP2.2）：`%{by_title, previous}`，供续写/首稿组装消费
  本章摘要兜底（L5）与目标章前序 N 章摘要（L3a）。未启用真实持久化时返回 nil（无摘要消费）。
  """
  def persistence_chapter_summary_reader do
    if inject_persistence?(), do: NovelPersistence.WorkspaceContext.chapter_summary_reader()
  end

  @doc """
  返回角色主档案读端口：`(work_id) -> 当前作品已采纳角色列表`（设计 21 §7.2 主档案层）。

  供创作/角色设计上下文注入"现有角色"（VS-00C 同向 / AU09-character-dossier-roundtrip I-c）：
  停掉角色 memory 误路由后，AI 写作与设计新角色时改从 Character 主档案看见现有阵容，不回退。
  未启用真实持久化时返回 nil（无角色注入）。
  """
  def persistence_character_reader do
    if inject_persistence?(), do: &NovelPersistence.WorkArchiveRepo.characters/1
  end

  defp inject_persistence? do
    Application.get_env(:novel_web, :persistence, [])
    |> Keyword.get(:inject_real_persistence, false)
  end
end
