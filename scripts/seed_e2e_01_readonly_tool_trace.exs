alias NovelApplication.{WorkService, WorkSessionService}
alias NovelFoundation.Enums.AdoptionStatus
alias NovelPersistence.Repo
alias NovelPersistence.Schemas.Character

suffix = System.system_time(:millisecond)
target_title = "E2E只读工具Trace作品-#{suffix}"

{:ok, target_work} =
  WorkService.create(%{
    "title" => target_title,
    "genre" => "赛博修仙",
    "core_selling_point" => "角色档案只读查询与工具 trace 回查",
    "target_reader" => "验证低风险只读工具链路的作者",
    "tone_preference" => "克制、清晰"
  })

{:ok, foreign_work} =
  WorkService.create(%{
    "title" => "E2E外部角色作品-#{suffix}"
  })

accepted_character =
  %Character{}
  |> Character.changeset(%{
    work_id: target_work.id,
    name: "林澈",
    aliases: ["阿澈"],
    role: "主角",
    summary: "底层散修，追查灵气垄断链路。",
    status: AdoptionStatus.accepted()
  })
  |> Repo.insert!()

tentative_character =
  %Character{}
  |> Character.changeset(%{
    work_id: target_work.id,
    name: "未确认影子",
    role: "反派",
    summary: "用于证明未采纳角色不会进入当前只读列表。",
    status: AdoptionStatus.tentative()
  })
  |> Repo.insert!()

foreign_character =
  %Character{}
  |> Character.changeset(%{
    work_id: foreign_work.id,
    name: "外部角色",
    role: "配角",
    summary: "用于证明只读列表不会跨作品泄漏。",
    status: AdoptionStatus.accepted()
  })
  |> Repo.insert!()

{:ok, snapshot} = WorkSessionService.resume(target_work.id)

IO.puts(
  "[e2e-01-readonly-tool-trace-seed] work_id=#{target_work.id} work_title=#{target_title} session_id=#{snapshot.active_session.id} character_id=#{accepted_character.id} tentative_character_id=#{tentative_character.id} foreign_work_id=#{foreign_work.id} foreign_character_id=#{foreign_character.id}"
)
