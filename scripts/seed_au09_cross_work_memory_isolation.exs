alias NovelApplication.{WorkService, WorkSessionService}
alias NovelFoundation.Enums.MemoryScope
alias NovelFoundation.Enums.MemorySourceType
alias NovelFoundation.Enums.MemoryStatus
alias NovelFoundation.Enums.MemoryType
alias NovelFoundation.ID
alias NovelPersistence.Repo
alias NovelPersistence.Schemas.MemoryItem

create_memory = fn work_id, attrs ->
  %MemoryItem{}
  |> MemoryItem.changeset(
    Map.merge(
      %{
        id: ID.uuid(),
        work_id: work_id,
        scope: MemoryScope.work(),
        status: MemoryStatus.confirmed(),
        source_type: MemorySourceType.author_confirmed(),
        recallable: true
      },
      attrs
    )
  )
  |> Repo.insert!()
end

{:ok, work_a} =
  WorkService.create(%{
    "title" => "AU09 隔离甲作品",
    "genre" => "赛博修仙",
    "core_selling_point" => "验证其他作品记忆不能串入当前作品",
    "target_reader" => "关注多作品管理的作者",
    "tone_preference" => "克制、明确"
  })

foreign_memory =
  create_memory.(work_a.id, %{
    content: "甲界暮钟只属于隔离甲作品，任何后续剧情都围绕甲界暮钟回响。",
    summary: "甲界暮钟（只属于甲作品）",
    type: MemoryType.foreshadowing(),
    tags: ["AU09", "cross-work", "foreign"]
  })

{:ok, _snapshot_a} = WorkSessionService.resume(work_a.id)

{:ok, work_b} =
  WorkService.create(%{
    "title" => "AU09 隔离乙作品",
    "genre" => "赛博修仙",
    "core_selling_point" => "当前作品只能召回自己的伏笔和规则",
    "target_reader" => "关注多作品隔离的作者",
    "tone_preference" => "清晰、克制"
  })

current_foreshadowing =
  create_memory.(work_b.id, %{
    content: "乙界星钥是隔离乙作品的核心伏笔，只有持有星钥的人能打开终章密门。",
    summary: "乙界星钥（只属于乙作品）",
    type: MemoryType.foreshadowing(),
    tags: ["AU09", "cross-work", "current"]
  })

current_rule =
  create_memory.(work_b.id, %{
    content: "乙界规则要求每次使用星钥都必须付出一段真实记忆作为代价。",
    summary: "乙界星钥代价规则",
    type: MemoryType.world_rule(),
    tags: ["AU09", "cross-work", "rule"]
  })

{:ok, snapshot_b} = WorkSessionService.resume(work_b.id)

IO.puts(
  "[au09-cross-work-memory-isolation-seed] work_a_id=#{work_a.id} work_b_id=#{work_b.id} session_b_id=#{snapshot_b.active_session.id} foreign_memory_id=#{foreign_memory.id} current_foreshadowing_id=#{current_foreshadowing.id} current_rule_id=#{current_rule.id}"
)
