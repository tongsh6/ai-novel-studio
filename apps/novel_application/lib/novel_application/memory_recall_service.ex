defmodule NovelApplication.MemoryRecallService do
  @moduledoc """
  记忆召回编排 — 05-memory-retention-and-retrieval.md §12。

  六阶段流程：
  1. 从 MemoryService 获取候选记忆
  2. Hard Filter — 铁律直接注入
  3. Candidate Search — 关键词+类型匹配
  4. Reranker — 重排序
  5. Diversity Filter — 去重降噪
  6. Token Packer — 按区块打包

  完成后异步写入引用日志（§12.6）。
  """

  alias NovelApplication.MemoryService
  alias NovelApplication.MemoryPolicy.HardFilter
  alias NovelApplication.MemoryPolicy.CandidateSearch
  alias NovelApplication.MemoryPolicy.Reranker
  alias NovelApplication.MemoryPolicy.DiversityFilter
  alias NovelApplication.MemoryPolicy.TokenPacker

  @type recall_opt :: {:token_budget, pos_integer()}
                    | {:scope, String.t()}
                    | {:prefer_types, [String.t()]}
                    | {:query, String.t()}

  @doc """
  执行完整召回流程，返回上下文文本和元数据。

  opts:
  - :token_budget — 总 token 预算（默认 3000）
  - :scope — 限定作用范围
  - :prefer_types — 优先召回的类型列表
  - :query — 查询描述（用于关键词匹配）
  - :scene — 召回场景标识（用于引用日志）
  - :task_id — 关联任务 ID（可选）
  """
  @spec recall(String.t(), keyword()) :: map()
  def recall(work_id, opts \\ []) do
    scene = Keyword.get(opts, :scene, "recall")
    task_id = Keyword.get(opts, :task_id)

    # 1. Fetch candidates (all recallable memories)
    all_memories = MemoryService.search(
      work_id: work_id,
      recallable: true,
      sort_by: :weight,
      sort_dir: :desc,
      limit: 200
    )

    # 2. Hard Filter
    {iron_laws, candidates} = HardFilter.filter(all_memories, scope: Keyword.get(opts, :scope))

    # 3. Candidate Search
    scored = CandidateSearch.search(candidates,
      query: Keyword.get(opts, :query, ""),
      prefer_types: Keyword.get(opts, :prefer_types, []),
      scope: Keyword.get(opts, :scope)
    )

    # 4. Reranker
    ranked = Reranker.rerank(scored)

    # 5. Diversity Filter
    filtered = DiversityFilter.filter(ranked)

    # 6. Token Packer
    token_budget = Keyword.get(opts, :token_budget, 3000)
    packed = TokenPacker.pack(iron_laws, filtered, token_budget: token_budget)

    # 7. Async reference logging
    schedule_reference_log(iron_laws ++ Enum.map(filtered, fn {m, _} -> m end),
      work_id, scene, task_id)

    Map.merge(packed, %{
      work_id: work_id,
      iron_law_ids: Enum.map(iron_laws, & &1.id),
      reference_ids: Enum.map(filtered, fn {m, _} -> m.id end)
    })
  end

  defp schedule_reference_log(memories, work_id, scene, task_id) do
    Task.start(fn ->
      entries =
        Enum.map(memories, fn m ->
          %{
            memory_id: m.id,
            work_id: work_id,
            task_id: task_id,
            reference_scene: scene,
            reference_reason: "recall"
          }
        end)

      NovelPersistence.MemoryReferenceLog.batch_write(entries)
    end)
  end
end
