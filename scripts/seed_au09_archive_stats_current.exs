alias NovelApplication.{WorkService, WorkSessionService}
alias NovelFoundation.Enums.AdoptionStatus
alias NovelFoundation.Enums.MemoryScope
alias NovelFoundation.Enums.MemorySourceType
alias NovelFoundation.Enums.MemoryStatus
alias NovelFoundation.Enums.MemoryType
alias NovelFoundation.ID
alias NovelPersistence.Repo
alias NovelPersistence.Schemas.{Chapter, Character, Draft, MemoryItem, Scene, Volume}

insert_character = fn work_id, attrs ->
  %Character{}
  |> Character.changeset(
    Map.merge(
      %{
        work_id: work_id,
        name: "沈泊舟",
        role: "线人",
        summary: "只属于 AU09 档案统计当前作品的已采纳角色。",
        status: AdoptionStatus.accepted()
      },
      attrs
    )
  )
  |> Repo.insert!()
end

insert_memory = fn work_id, attrs ->
  %MemoryItem{}
  |> MemoryItem.changeset(
    Map.merge(
      %{
        id: ID.uuid(),
        work_id: work_id,
        scope: MemoryScope.work(),
        status: MemoryStatus.confirmed(),
        source_type: MemorySourceType.author_confirmed(),
        recallable: true,
        tags: ["AU09", "archive-stats-current"]
      },
      attrs
    )
  )
  |> Repo.insert!()
end

{:ok, work} =
  WorkService.create(%{
    "title" => "AU09档案统计当前作品",
    "genre" => "都市悬疑",
    "core_selling_point" => "星桥旧账牵出多年前的隐秘交易",
    "target_reader" => "喜欢线索回收与角色博弈的读者",
    "tone_preference" => "冷静克制"
  })

character =
  insert_character.(work.id, %{
    name: "沈泊舟",
    role: "线人",
    summary: "掌握星桥旧账的夜班修表师。"
  })

foreshadowing =
  insert_memory.(work.id, %{
    content: "星桥旧账伏笔：沈泊舟保留的蓝色账页指向十年前失踪案。",
    summary: "星桥旧账伏笔",
    type: MemoryType.foreshadowing()
  })

rule =
  insert_memory.(work.id, %{
    content: "星桥通行规则：只有持蓝色账页的人才能进入旧桥下的密道。",
    summary: "星桥通行规则",
    type: MemoryType.world_rule()
  })

idea =
  insert_memory.(work.id, %{
    content: "星桥补充灵感：雨夜钟声会让账页上的旧字短暂显影。",
    summary: "星桥补充灵感",
    type: MemoryType.idea()
  })

_not_recallable_memory =
  insert_memory.(work.id, %{
    content: "星桥废弃暗线：这条 confirmed 记忆不可召回，不应进入 archive stats 的 memory_items。",
    summary: "不可召回星桥暗线",
    type: MemoryType.world_rule(),
    recallable: false
  })

volume =
  %Volume{}
  |> Volume.changeset(%{work_id: work.id, title: "第一卷 星桥旧账", seq: 1})
  |> Repo.insert!()

chapter =
  %Chapter{}
  |> Chapter.changeset(%{
    work_id: work.id,
    volume_id: volume.id,
    title: "第一章 蓝色账页",
    seq: 1,
    summary: "沈泊舟交出蓝色账页，星桥旧账第一次浮出水面。"
  })
  |> Repo.insert!()

scene =
  %Scene{}
  |> Scene.changeset(%{work_id: work.id, chapter_id: chapter.id, title: "旧桥夜谈", seq: 1})
  |> Repo.insert!()

accepted_draft =
  %Draft{}
  |> Draft.changeset(%{
    work_id: work.id,
    scene_id: scene.id,
    content: "沈泊舟把蓝色账页推过桌面，雨水沿着旧桥栏杆滴落，账页上的十年前日期忽然显影。",
    status: AdoptionStatus.accepted()
  })
  |> Repo.insert!()

tentative_draft =
  %Draft{}
  |> Draft.changeset(%{
    work_id: work.id,
    scene_id: scene.id,
    content: "这是一段尚未采纳的备选场景，不应计入已采纳草稿数。",
    status: AdoptionStatus.tentative()
  })
  |> Repo.insert!()

{:ok, foreign_work} =
  WorkService.create(%{
    "title" => "AU09档案统计外部作品",
    "genre" => "奇幻"
  })

_foreign_character =
  insert_character.(foreign_work.id, %{
    name: "雾港外部角色",
    role: "外部线索",
    summary: "不应出现在当前作品档案中。"
  })

_foreign_memory =
  insert_memory.(foreign_work.id, %{
    content: "雾港外部样例：这条外部作品记忆不应进入当前作品档案。",
    summary: "雾港外部样例",
    type: MemoryType.foreshadowing()
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)

IO.puts(
  "[au09-archive-stats-current-seed] work_id=#{work.id} session_id=#{snapshot.active_session.id} work_title=#{work.title} character_id=#{character.id} character_name=#{character.name} foreshadowing_id=#{foreshadowing.id} foreshadowing_needle=星桥旧账伏笔 rule_id=#{rule.id} rule_needle=星桥通行规则 idea_id=#{idea.id} accepted_draft_id=#{accepted_draft.id} tentative_draft_id=#{tentative_draft.id} foreign_work_id=#{foreign_work.id} foreign_needle=雾港外部样例"
)
