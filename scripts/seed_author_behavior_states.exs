alias NovelApplication.WorkService
alias NovelPersistence.Repo
alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}

# B70 CP1：author-behavior 冻结语料的状态夹具（仅浏览器 runner 隔离 DB 使用）。
# 只创建合成作品；不含真实作品数据；不预置验收感知字段。
insert_work = fn title, chapters_spec ->
  {:ok, work} =
    WorkService.create(%{
      "title" => title,
      "genre" => "雨港悬疑",
      "core_selling_point" => "B70 author behavior state fixture",
      "target_reader" => "作者",
      "tone_preference" => "克制",
      "target_length" => 30_000,
      "planned_volumes" => 1,
      "serial_form" => "SERIALIZED"
    })

  volume = Repo.insert!(%Volume{work_id: work.id, title: "第一卷", seq: 1, status: "DRAFTING"})

  Enum.each(chapters_spec, fn {seq, chapter_title, status, prose} ->
    chapter =
      Repo.insert!(%Chapter{
        work_id: work.id,
        volume_id: volume.id,
        title: chapter_title,
        seq: seq,
        status: status,
        summary: "B70 state fixture chapter #{seq}"
      })

    if is_binary(prose) do
      scene =
        Repo.insert!(%Scene{work_id: work.id, chapter_id: chapter.id, title: "场景 1", seq: 1})

      _draft =
        Repo.insert!(%Draft{
          work_id: work.id,
          scene_id: scene.id,
          content: prose,
          status: "ACCEPTED",
          revision: 1
        })
    end
  end)

  work
end

s1 =
  insert_work.("B70 S1 部分多章", [
    {1, "第01章：灯楼夜话", "DRAFTING", "第01章正文：雨港的灯楼立在旧码头尽头，陈九斤守着旧账。"},
    {2, "第02章：井底回声", "DRAFTING", "第02章正文：井底回声落下来时，陈九斤没有睁眼。"},
    {3, "第03章：潮汐账页", "PLANNED", nil}
  ])

s2 = insert_work.("B70 S2 空骨架", [])

s3 =
  insert_work.("B70 S3 待采纳候选", [
    {1, "第01章：灯楼旧账", "DRAFTING", "第01章正文：灯楼旧账翻到第七页，账页上的水痕还没有干。"},
    {2, "第02章：潮汐账页", "PLANNED", nil}
  ])

IO.puts(
  "[b70-author-behavior-seed] s1_work_id=#{s1.id} s2_work_id=#{s2.id} s3_work_id=#{s3.id} " <>
    "s1_title=B70 S1 部分多章 s2_title=B70 S2 空骨架 s3_title=B70 S3 待采纳候选"
)
