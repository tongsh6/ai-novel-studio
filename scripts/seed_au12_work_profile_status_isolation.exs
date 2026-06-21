alias NovelApplication.{WorkService, WorkSessionService}
alias NovelFoundation.Enums.AdoptionStatus
alias NovelFoundation.Enums.MemoryScope
alias NovelFoundation.Enums.MemorySourceType
alias NovelFoundation.Enums.MemoryStatus
alias NovelFoundation.Enums.MemoryType
alias NovelFoundation.ID
alias NovelPersistence.Repo
alias NovelPersistence.Schemas.{Character, MemoryItem, Work}
alias NovelPersistence.WorkRepo

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
        recallable: true
      },
      attrs
    )
  )
  |> Repo.insert!()
end

{:ok, accepted_work} =
  WorkService.create(%{
    "title" => "AU12已确认档案作品",
    "genre" => "都市异能",
    "core_selling_point" => "灵气交易所黑幕",
    "target_reader" => "喜欢强剧情反转的读者",
    "tone_preference" => "冷峻克制"
  })

accepted_work =
  accepted_work.id
  |> WorkRepo.get()
  |> Work.adopt_changeset()
  |> Repo.update!()

accepted_character =
  %Character{}
  |> Character.changeset(%{
    work_id: accepted_work.id,
    name: "林烬",
    role: "主角",
    summary: "只属于 AU12 已确认作品的角色主档案。",
    status: AdoptionStatus.accepted()
  })
  |> Repo.insert!()

accepted_foreshadowing =
  insert_memory.(accepted_work.id, %{
    content: "只属于已确认作品的黑市账本伏笔。",
    summary: "黑市账本伏笔",
    type: MemoryType.foreshadowing(),
    tags: ["AU12", "foreign-visible-only-in-accepted-work"]
  })

accepted_rule =
  insert_memory.(accepted_work.id, %{
    content: "只属于已确认作品的灵气交易规则。",
    summary: "灵气交易规则",
    type: MemoryType.world_rule(),
    tags: ["AU12", "foreign-visible-only-in-accepted-work"]
  })

{:ok, accepted_snapshot} = WorkSessionService.resume(accepted_work.id)

{:ok, empty_work} =
  WorkService.create(%{
    "title" => "AU12空字段档案作品"
  })

{:ok, empty_snapshot} = WorkSessionService.resume(empty_work.id)

IO.puts(
  "[au12-work-profile-status-isolation-seed] accepted_work_id=#{accepted_work.id} accepted_session_id=#{accepted_snapshot.active_session.id} empty_work_id=#{empty_work.id} empty_session_id=#{empty_snapshot.active_session.id} accepted_character_id=#{accepted_character.id} accepted_foreshadowing_id=#{accepted_foreshadowing.id} accepted_rule_id=#{accepted_rule.id}"
)
