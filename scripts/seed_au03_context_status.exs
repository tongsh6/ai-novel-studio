alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.Repo
alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}

# AU03-CONTEXT CP3：读取失败/未知/真实空的原生真实模型验收隔离种子。
# - 一部合成作品，第03章有 accepted 正文（含“旧账”可回答）；context chapters 来源至少可读。
# - 只写测试库；不预置任何读取失败/验收感知字段。故障由外部 harness 在运行中注入
#   （重命名 chapter_summaries 投影表），解除后恢复。
{:ok, work} =
  WorkService.create(%{
    "title" => "AU03 上下文故障复现作品",
    "genre" => "雨港悬疑",
    "core_selling_point" => "读取失败与真实空事实区分",
    "target_reader" => "作者",
    "tone_preference" => "克制、潮湿",
    "target_length" => 20_000,
    "planned_volumes" => 1,
    "serial_form" => "SERIALIZED"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

volume = Repo.insert!(%Volume{work_id: work.id, title: "第一卷", seq: 1, status: "DRAFTING"})

insert_chapter = fn seq, title, summary, paragraphs ->
  chapter =
    Repo.insert!(%Chapter{
      work_id: work.id,
      volume_id: volume.id,
      title: title,
      seq: seq,
      status: "DRAFTING",
      summary: summary
    })

  Enum.with_index(paragraphs, 1)
  |> Enum.each(fn {content, scene_seq} ->
    scene =
      Repo.insert!(%Scene{
        work_id: work.id,
        chapter_id: chapter.id,
        title: "场景 #{scene_seq}",
        seq: scene_seq
      })

    _draft =
      Repo.insert!(%Draft{
        work_id: work.id,
        scene_id: scene.id,
        content: content,
        status: "ACCEPTED",
        revision: 1
      })
  end)

  chapter
end

_control =
  insert_chapter.(
    1,
    "第01章：灯楼夜话",
    "雨港灯楼的日常巡夜。",
    ["第01章正文：雨港的灯楼立在旧码头尽头，陈九斤守了二十五年。"]
  )

target =
  insert_chapter.(
    3,
    "第03章：潮汐账页",
    "灯楼旧账与潮汐账页。",
    ["灯楼旧账翻到第七页时，陈九斤二十五岁，把灯芯挑亮，账页上的水痕还没有干。"]
  )

IO.puts(
  "[au03-context-status-seed] work_id=#{work.id} session_id=#{session_id} " <>
    "target_chapter_id=#{target.id} target_title=#{target.title} chapter_count=2"
)
