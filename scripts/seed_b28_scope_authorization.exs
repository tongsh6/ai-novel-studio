alias NovelApplication.WorkService
alias NovelPersistence.Repo
alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}

# B28-SCOPE CP3：作者授权范围原生真实模型验收隔离种子。
# - 作品：两章；第01章为对照章（不得被改），第03章为目标章（两段 accepted 正文，可按段修订）；
#   「二十五岁」只出现在第03章第一段（字面替换正例可精确定位）。
# - 只写测试库；不预置判断/候选/范围/验收感知字段。由 tauri_slice_verify.sh reset_test_db 后执行。
{:ok, work} =
  WorkService.create(%{
    "title" => "B28 范围授权复现作品",
    "genre" => "雨港悬疑",
    "core_selling_point" => "否定/条件/局部限制下的章级修订授权范围",
    "target_reader" => "关注作者范围约束的读者",
    "tone_preference" => "克制、潮湿",
    "target_length" => 40_000,
    "planned_volumes" => 1,
    "serial_form" => "SERIALIZED"
  })

volume =
  Repo.insert!(%Volume{work_id: work.id, title: "第一卷", seq: 1, status: "DRAFTING"})

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

control =
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
    "灯楼夜账与潮汐账页的两段正文。",
    [
      "灯楼夜账翻到第七页时，陈九斤二十五岁，把灯芯挑亮，账页上的水痕还没有干。",
      "潮汐账页被海风掀起，陈九斤按住纸角，听见楼下有人把门闩轻轻放下。"
    ]
  )

IO.puts(
  "[b28-scope-authorization-seed] work_id=#{work.id} control_chapter_id=#{control.id} " <>
    "target_chapter_id=#{target.id} target_title=#{target.title} chapter_count=2"
)
