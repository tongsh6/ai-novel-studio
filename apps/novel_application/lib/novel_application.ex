defmodule NovelApplication do
  require NovelCommon.LogEmit

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
  返回设定盘点材料读端口：`work_id -> [%{seq, title, prose}]`。

  生产实现优先消费整部作品当前章摘要，旧作品无摘要时回退有限的已采纳正文；未启用真实
  持久化时返回 nil，由盘点 run 诚实失败而不是伪造材料。
  """
  def persistence_fact_inventory_material_reader do
    if inject_persistence?(),
      do: &NovelPersistence.ReadingProjectionRepo.fact_inventory_materials/1
  end

  @doc """
  返回工作假定物化写端口（VS-00G CP5b）：盘点产出的主角候选 → tentative Character
  （AI_ASSUMPTION + required 自动激活）。守卫（canon 在场/同名跳过）集中在持久层；
  未启用真实持久化时返回 nil，盘点对假定诚实缺席（档案提案链不受影响）。
  """
  def persistence_assumption_character_writer do
    if inject_persistence?(),
      do: &NovelPersistence.AssumptionRepo.materialize_character/1
  end

  @doc """
  返回工作假定读端口（VS-00G CP5c）：「暂定设定」角色清单，供可标注注入通道与
  暂定设定区消费。未启用真实持久化时返回 nil（注入通道诚实缺席）。
  """
  def persistence_assumption_character_reader do
    if inject_persistence?(),
      do: &NovelPersistence.AssumptionRepo.list_assumption_characters/1
  end

  @doc """
  返回同名已确认角色检查端口（M4 实锤：同名重复采纳堆出重复档案行）。
  未启用真实持久化时返回恒 false 探针（不拦截，与此前行为一致）。
  """
  def persistence_accepted_character_name_checker do
    if inject_persistence?() do
      # AU12 CP2：返回命中详情（规范行主名 + 是否别名命中），确认卡据此点名
      # 「它是谁的别名」；布尔真值语义向后兼容（nil 即未命中）。
      &NovelPersistence.AssumptionRepo.accepted_character_matching/2
    else
      fn _work_id, _name -> nil end
    end
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
    task = fn ->
      result = NovelApplication.ChapterSummaryMaintenance.run(input, generator, repo)
      run_ledger_maintenance_after_summary(input, result)
      result
    end

    if sync_chapter_summary_maintenance?() do
      _ = task.()
      :ok
    else
      start_background_task(task)
    end
  end

  # VS-00F CP1（ADR-0026 hook.UPDATE_LEDGERS）：章摘要产出后同任务串行更新弧光账
  # （提炼输入直接吃摘要文本，无回读竞态）。摘要降级则以空文本进入维护用例，由其
  # 降级路径登记 ledger.update.error；账面维护自身失败容忍，绝不影响采纳主链。
  defp run_ledger_maintenance_after_summary(input, {:ok, summary}) do
    NovelApplication.LedgerMaintenance.run(
      %{
        work_id: Map.get(input, :work_id),
        chapter_id: Map.get(input, :chapter_id),
        summary_text: summary.summary_text,
        prose_text: Map.get(input, :prose_text)
      },
      ledger_maintenance_deps()
    )
  end

  defp run_ledger_maintenance_after_summary(input, _degraded) do
    NovelApplication.LedgerMaintenance.run(
      %{
        work_id: Map.get(input, :work_id),
        chapter_id: Map.get(input, :chapter_id),
        summary_text: ""
      },
      ledger_maintenance_deps()
    )
  end

  defp ledger_maintenance_deps do
    %{
      roster: &NovelPersistence.WorkArchiveRepo.characters/1,
      chapter_index: &NovelPersistence.LedgerRepository.chapter_index/1,
      profile: &NovelPersistence.WorkArchiveRepo.profile/1,
      # CP2b 节拍端口：达到章数节拍时全量对账并物化报告（TENTATIVE 作者裁决）。
      reconcile: fn work_id, current_seq ->
        NovelApplication.LedgerReconciliationService.materialize(
          work_id,
          NovelApplication.LedgerReconciliationService.persistence_deps(),
          NovelApplication.LedgerReconciliationService.persistence_report_repo(),
          current_seq
        )
      end,
      repo: %{
        list: &NovelPersistence.LedgerRepository.list_all/1,
        upsert: &NovelPersistence.LedgerRepository.upsert/1
      }
    }
  end

  @doc """
  账面读取端口（VS-00F CP1 / ADR-0026）：供写作上下文 progress_state 投影与
  探索面消费弧光账。未启用真实持久化时返回 nil（无账面注入，06 §5.0 诚实缺失）。
  """
  def persistence_ledger_reader do
    if inject_persistence?(), do: &NovelPersistence.LedgerRepository.list_all/1
  end

  @doc """
  已写进度读取端口（WR01 写前推理 / R9 同源口径）：`%{chapter_seq, volume_seq}`。
  未启用真实持久化时返回 nil（推理只带设计态，诚实缺席）。
  """
  def persistence_written_progress_reader do
    if inject_persistence?(), do: &NovelPersistence.LedgerRepository.written_progress/1
  end

  @doc """
  本章使命暂定写入端口（WR01b）：推理步把模型推导的使命落 `chapters.plan_direction`
  （作者版在场不覆盖）。未启用真实持久化时返回 nil（使命只活在本次 run）。
  """
  def persistence_chapter_mission_writer do
    if inject_persistence?(), do: &NovelPersistence.ChapterMissionRepo.put_tentative/3
  end

  # WR01c：规划使命的 work 级持久写/读端口（plot flow 暂定落库与作者版直取）。
  def persistence_planning_mission_writer do
    if inject_persistence?(), do: &NovelPersistence.PlanningMissionRepo.put_tentative/2
  end

  def persistence_planning_mission_reader do
    if inject_persistence?(), do: &NovelPersistence.PlanningMissionRepo.get_mission/1
  end

  defp sync_chapter_summary_maintenance? do
    Application.get_env(:novel_application, :sync_chapter_summary_maintenance, false)
  end

  # D3：后台任务失败可观测——start 失败与任务内崩溃都留业务日志（此前双双静默，
  # fire-and-forget 丢摘要只能靠 carry 日志 prior_summaries empty 间接发现）。
  # 失败容忍语义不变：只记录，绝不上抛、绝不影响调用方主链。
  defp start_background_task(task) do
    observed = fn ->
      try do
        task.()
      rescue
        error ->
          NovelCommon.LogEmit.emit(:background_task, :run, :error, %{
            reason: inspect(error)
          })

          :error
      end
    end

    case Process.whereis(NovelApplication.BackgroundTaskSupervisor) do
      nil ->
        _ = observed.()

      _pid ->
        case Task.Supervisor.start_child(NovelApplication.BackgroundTaskSupervisor, observed) do
          {:ok, _pid} ->
            :ok

          {:error, reason} ->
            NovelCommon.LogEmit.emit(:background_task, :start, :error, %{
              reason: inspect(reason)
            })

            :ok
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
    if inject_persistence?() do
      reader = NovelPersistence.WorkspaceContext.chapter_summary_reader()

      # D3：读取侧惰性补做——组装读摘要时顺带调度一次断供扫描（仅异步模式；同步
      # 测试环境行为逐字节不变）。调度只起后台任务，查询与补生成都在任务内。
      # 触发点只挂 previous（每次组装恰一次窗口读）——by_title 是逐章定点读，
      # 双挂会同 turn 重复调度补做（D3 场景实测两条 run.start 竞速）。
      %{
        by_title: reader.by_title,
        previous: fn work_id, title, n ->
          maybe_schedule_summary_repair(work_id)
          reader.previous.(work_id, title, n)
        end
      }
    end
  end

  defp maybe_schedule_summary_repair(work_id) do
    if not sync_chapter_summary_maintenance?() and
         is_pid(Process.whereis(NovelApplication.BackgroundTaskSupervisor)) do
      start_background_task(fn -> run_chapter_summary_repair(work_id) end)
    end

    :ok
  end

  @doc """
  D3 断供补做：找出「有 ACCEPTED 正文但无当前摘要」的章（cap 2/次防风暴），
  逐章重跑摘要维护（supersede+insert 单当前语义天然幂等）。失败容忍。
  """
  def run_chapter_summary_repair(work_id) when is_binary(work_id) do
    generator = default_summary_generator()
    repo = default_summary_repo()

    work_id
    |> NovelPersistence.ChapterSummaryRepo.chapters_missing_summary()
    |> Enum.take(2)
    |> Enum.each(fn %{chapter_id: chapter_id, prose_text: prose_text} ->
      NovelCommon.LogEmit.emit(:chapter_summary_repair, :run, :start, %{
        work_id: work_id,
        chapter_id: chapter_id
      })

      input = %{
        work_id: work_id,
        chapter_id: chapter_id,
        prose_text: prose_text,
        source_ref: "summary_repair:#{chapter_id}"
      }

      result = NovelApplication.ChapterSummaryMaintenance.run(input, generator, repo)
      run_ledger_maintenance_after_summary(input, result)

      case result do
        {:ok, _summary} ->
          NovelCommon.LogEmit.emit(:chapter_summary_repair, :run, :done, %{
            work_id: work_id,
            chapter_id: chapter_id
          })

        _degraded ->
          NovelCommon.LogEmit.emit(:chapter_summary_repair, :run, :error, %{
            work_id: work_id,
            chapter_id: chapter_id
          })
      end
    end)

    :ok
  end

  def run_chapter_summary_repair(_work_id), do: :ok

  @doc """
  返回章节标题读端口：`(work_id) -> 当前作品章节全名列表（含已规划但还没写正文的章）`。

  供 AgentRun 规划期（AgenticPlanDraftPlanner）注入「作品章节」段：target_chapter 契约
  要求模型从该列表精确复制全名；列表缺席时，点名章的正文请求会被缺失策略误判为
  "点名了不存在的章"而硬阻断。未启用真实持久化时返回 nil（prompt 不含作品章节段）。
  """
  def persistence_chapter_titles_reader do
    if inject_persistence?(), do: NovelPersistence.WorkspaceContext.chapter_titles_reader()
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

  @doc """
  确认记忆读端口（CA02 / VS-00C §3.1 L3b/L4 最小形态）：`(work_id) -> 分组确认记忆`
  （伏笔/规则/状态/关系/风格），供写作事实段与风格段、evaluator 事实基线消费。
  未启用真实持久化时返回 nil（无记忆注入，06 §5.0 诚实缺失）。
  """
  def persistence_memory_reader do
    if inject_persistence?(), do: &NovelPersistence.WorkArchiveRepo.creative_facts/1
  end

  defp inject_persistence? do
    Application.get_env(:novel_web, :persistence, [])
    |> Keyword.get(:inject_real_persistence, false)
  end
end
