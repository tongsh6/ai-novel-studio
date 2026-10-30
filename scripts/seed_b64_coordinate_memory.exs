alias NovelApplication.{WorkService, WorkSessionService}
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

# B64 CP3：真实 Tauri 页面矩阵的隔离种子。
# - 已采纳正文写到第10章（当前叙事位置=10），第03章是回写目标；第11章为计划中新章。
# - 记忆有效窗：B64EARLY 仅第1-4章有效；B64FUTURE 第8章后生效；B64CORE 无窗口。
# - 产品代码不读取本文件；本 seed 只写隔离 test DB，供外部 Playwright 驱动真实页面。
{:ok, work} =
  WorkService.create(%{
    "title" => "B64 坐标记忆验证作品",
    "genre" => "雨港悬疑",
    "core_selling_point" => "按真实写作坐标消费记忆有效窗",
    "target_reader" => "关注连续性的作者",
    "tone_preference" => "克制、潮湿"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

volume =
  %Volume{} |> Volume.changeset(%{work_id: work.id, title: "第一卷", seq: 1}) |> Repo.insert!()

add_chapter = fn seq, title, status, prose ->
  chapter =
    %Chapter{}
    |> Chapter.changeset(%{
      work_id: work.id,
      volume_id: volume.id,
      title: title,
      seq: seq,
      status: status
    })
    |> Repo.insert!()

  if is_binary(prose) do
    scene =
      %Scene{}
      |> Scene.changeset(%{work_id: work.id, chapter_id: chapter.id, title: "场景 1", seq: 1})
      |> Repo.insert!()

    %Draft{}
    |> Draft.changeset(%{
      work_id: work.id,
      scene_id: scene.id,
      content: prose,
      status: "ACCEPTED",
      revision: 1
    })
    |> Repo.insert!()
  end

  chapter
end

chapters =
  Enum.map(1..10, fn seq ->
    if seq == 3 do
      # 第03章留空，供页面主输入“写第03章”走真实正文生成；其前后章节均已采纳，当前位置=10。
      add_chapter.(seq, "第03章：旧誓", "DRAFTING", nil)
    else
      add_chapter.(seq, "第0#{seq}章：已写章节", "DRAFTING", "第#{seq}章已采纳正文，雨声落在灯楼瓦檐上。")
    end
  end)

chapter11 = add_chapter.(11, "第11章：新章", "PLANNED", nil)
ch1 = Enum.at(chapters, 0)
ch3 = Enum.at(chapters, 2)
ch4 = Enum.at(chapters, 3)
ch8 = Enum.at(chapters, 7)

insert_memory = fn content, summary, window ->
  %MemoryItem{}
  |> MemoryItem.changeset(
    Map.merge(
      %{
        id: ID.uuid(),
        work_id: work.id,
        type: MemoryType.world_rule(),
        scope: MemoryScope.work(),
        source_type: MemorySourceType.author_confirmed(),
        status: MemoryStatus.confirmed(),
        recallable: true,
        content: content,
        summary: summary
      },
      window
    )
  )
  |> Repo.insert!()
end

early =
  insert_memory.("B64EARLY 早期盟约只在第1到4章成立，第5章之后已经失效。", "B64EARLY 早期盟约", %{
    valid_from: %{"chapter_id" => ch1.id},
    valid_until: %{"chapter_id" => ch4.id}
  })

future =
  insert_memory.("B64FUTURE 第八幕真相：玄铁令会反噬持有者。", "B64FUTURE 第八幕真相", %{
    valid_from: %{"chapter_id" => ch8.id}
  })

core =
  insert_memory.("B64CORE 贯穿全书的核心信物是玄铁令。", "B64CORE 核心信物", %{})

IO.puts(
  "[b64-coordinate-memory-seed] work_id=#{work.id} session_id=#{session_id} " <>
    "ch3=#{ch3.id} ch11=#{chapter11.id} early=#{early.id} future=#{future.id} core=#{core.id}"
)
