alias NovelApplication.{WorkService, WorkSessionService}
alias NovelFoundation.Enums.AdoptionStatus
alias NovelFoundation.Enums.MemoryScope
alias NovelFoundation.Enums.MemorySourceType
alias NovelFoundation.Enums.MemoryStatus
alias NovelFoundation.Enums.MemoryType
alias NovelFoundation.ID
alias NovelPersistence.Repo
alias NovelPersistence.Schemas.Chapter
alias NovelPersistence.Schemas.Draft
alias NovelPersistence.Schemas.MemoryItem
alias NovelPersistence.Schemas.Scene
alias NovelPersistence.Schemas.Volume

{:ok, work} =
  WorkService.create(%{
    "title" => "AU09 有效期窗口验证作品",
    "genre" => "赛博修仙",
    "core_selling_point" => "验证有效期窗口影响召回",
    "target_reader" => "关注记忆治理的作者",
    "tone_preference" => "克制、具象"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

# 当前叙事位置 = 已采纳正文最大章节序号。建第 1 / 2 / 5 章（均已采纳）→ 位置=5。
# 窗口边界 chapter_id 用真实章节 UUID（NarrativePosition），不是序号整数。
volume =
  %Volume{} |> Volume.changeset(%{work_id: work.id, title: "已采纳内容", seq: 1}) |> Repo.insert!()

add_accepted_chapter = fn seq, content ->
  chapter =
    %Chapter{}
    |> Chapter.changeset(%{work_id: work.id, volume_id: volume.id, title: "第#{seq}章", seq: seq})
    |> Repo.insert!()

  scene =
    %Scene{}
    |> Scene.changeset(%{work_id: work.id, chapter_id: chapter.id, title: "场景", seq: 1})
    |> Repo.insert!()

  %Draft{}
  |> Draft.changeset(%{
    work_id: work.id,
    scene_id: scene.id,
    content: content,
    status: AdoptionStatus.accepted(),
    revision: 1
  })
  |> Repo.insert!()

  chapter
end

chapter1 = add_accepted_chapter.(1, "序章：盘古碑初现。")
chapter2 = add_accepted_chapter.(2, "第二章：盘古碑的余韵。")
add_accepted_chapter.(5, "已采纳正文写到第五章。")

memory_attrs = fn extra ->
  Map.merge(
    %{
      id: ID.uuid(),
      work_id: work.id,
      type: MemoryType.world_rule(),
      scope: MemoryScope.work(),
      source_type: MemorySourceType.author_confirmed(),
      status: MemoryStatus.confirmed(),
      recallable: true
    },
    extra
  )
end

# 窗口外设定（仅第 1-2 章有效；当前位置=5 → 不应召回）。nonce: 盘古碑
out_of_window =
  %MemoryItem{}
  |> MemoryItem.changeset(
    memory_attrs.(%{
      content: "盘古碑只在序章短暂出现，第三章后再不提及。",
      summary: "盘古碑（仅序章设定）",
      valid_from: %{"chapter_id" => chapter1.id},
      valid_until: %{"chapter_id" => chapter2.id}
    })
  )
  |> Repo.insert!()

# 无窗口设定（全书有效 → 应召回）。nonce: 玄铁令
unwindowed =
  %MemoryItem{}
  |> MemoryItem.changeset(
    memory_attrs.(%{
      content: "玄铁令是贯穿全书的核心信物，关系到灵气垄断的破局。",
      summary: "玄铁令（全书核心信物）"
    })
  )
  |> Repo.insert!()

IO.puts(
  "[au09-validity-window-seed] work_id=#{work.id} session_id=#{session_id} out_of_window=#{out_of_window.id} unwindowed=#{unwindowed.id}"
)
