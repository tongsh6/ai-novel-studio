alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.AdoptionRepository

chapter_lines = [
  "第01章：灵源账单: 林烬发现妹妹林瑶留下的灵气账单异常，决定潜入矿区追查。",
  "第02章：旧服务器残诀: 林烬用残缺功法破解第一道公司封锁，但代价是暴露了灵力频段。",
  "第03章：霓虹地牢试炼: 林烬在地下算力矿井轻松击败守卫，确认矿区与失踪散修有关，但胜利代价尚未显现。"
]

{:ok, work} =
  WorkService.create(%{
    "title" => "灵源纪元",
    "genre" => "赛博修仙",
    "core_selling_point" => "林烬为寻找妹妹林瑶追查灵源矿区真相",
    "target_reader" => "喜欢高压逆转和悬疑成长线的读者",
    "tone_preference" => "克制、紧张、带希望感"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

{:ok, persisted} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_au11_chapter_plan_seed",
    artifact_id: "as_au11_chapter_plan_seed",
    artifact_type: :outline_draft,
    base_revision: 1,
    content: Enum.join(chapter_lines, "\n"),
    summary: "AU11 质量诊断章节上下文"
  })

IO.puts(
  "[au11-quality-diagnosis-message-envelope-seed] work_id=#{work.id} session_id=#{session_id} memory_item_id=#{persisted.memory_item_id}"
)
