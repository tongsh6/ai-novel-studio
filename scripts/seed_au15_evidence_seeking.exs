alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.Repo
alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}

# B39 CP1 AU-15 A0/A1/A2：外部原生 Tauri + 真实模型证据批次的隔离 fixture 种子。
#
# 只写隔离 test DB；不写作者真实作品，不预置任何验收感知字段/专用 packet：
# - 第01章 accepted 正文含一条人物承诺（沈砚答应三天后回灯楼接顾青），
#   该承诺不进入任何专用 packet；章节层只留短标题式摘要，不复制承诺内容。
# - 第02章 accepted 正文含时间事实（过了三天 / 又过了两星期，累计十七天）。
# - 第03/04章为 PLANNED 目标章（A1 写第03章、A2 写第04章）。
#
# 诚实边界：本 seed 是隔离 fixture，只用于机制/探针证据，不等于 D6-A 的
# “前置章节由真实模型创作 + 外部真实页面采纳”；正式 AU-15 A1/A2 验收仍须
# 按预注册用 D6-A setup 产生前置章节并人工复核。setup 与测量分账另行记录。
{:ok, work} =
  WorkService.create(%{
    "title" => "AU15 Evidence Work",
    "genre" => "雨港悬疑",
    "core_selling_point" => "求证式创作窗口的最小供给与按需求证证据作品",
    "target_reader" => "关注细节连续性的读者",
    "tone_preference" => "克制、潮湿",
    "target_length" => 60_000,
    "planned_volumes" => 1,
    "serial_form" => "SERIALIZED"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

volume =
  Repo.insert!(%Volume{work_id: work.id, title: "第一卷", seq: 1, status: "DRAFTING"})

chapter_01_prose =
  "灯楼在雨里立着，顾青把灯芯挑亮，旧钟刚敲过三下。" <>
    "沈砚提着湿透的药包进来，把伞靠在门边，说城西的账还得走一趟。" <>
    "顾青问他还走不走。沈砚沉默片刻，说：“我答应你，三天后一定回灯楼接你，一起去城西。”" <>
    "顾青点头，把这句话写进账册的最后一页。" <>
    "沈砚又从怀里摸出半枚铜钥匙，说留着，回来还要用。" <>
    "顾青把钥匙收进袖中，看着他推门走进雨里，灯芯在风里晃了一下。"

chapter_02_prose =
  "第一场雨过了三天才停。沈砚没有回来，灯楼的门闩一直没响。" <>
    "顾青把账册摊在灯下，数着门口的青石阶。" <>
    "又过了两星期，城西的账终于清了，雨却还是断断续续。" <>
    "她把半枚铜钥匙放在最高那层窗台上，让风把钥匙吹干，" <>
    "每天傍晚都来点灯，把灯芯挑得比往常亮些，好让从码头回来的人远远看见。"

chapter_specs = [
  {1, "第01章：灯楼旧约", "DRAFTING", "灯楼夜话，顾青守灯。", chapter_01_prose},
  {2, "第02章：两场雨", "DRAFTING", "两场雨之间的等待。", chapter_02_prose},
  {3, "第03章：灯楼夜戏", "PLANNED", "待写：灯楼的夜戏。", nil},
  {4, "第04章：归期", "PLANNED", "待写：归期将至。", nil}
]

chapters =
  Enum.map(chapter_specs, fn {seq, title, status, summary, prose} ->
    chapter =
      Repo.insert!(%Chapter{
        work_id: work.id,
        volume_id: volume.id,
        title: title,
        seq: seq,
        status: status,
        summary: summary
      })

    if is_binary(prose) do
      scene =
        Repo.insert!(%Scene{
          work_id: work.id,
          chapter_id: chapter.id,
          title: "场景 1",
          seq: 1
        })

      _draft =
        Repo.insert!(%Draft{
          work_id: work.id,
          scene_id: scene.id,
          content: prose,
          status: "ACCEPTED",
          revision: 1
        })
    end

    chapter
  end)

chapter_three = Enum.find(chapters, &(&1.seq == 3))
chapter_four = Enum.find(chapters, &(&1.seq == 4))

IO.puts(
  "[au15-evidence-seeking-seed] work_id=#{work.id} session_id=#{session_id} " <>
    "chapter_count=#{length(chapters)} " <>
    "chapter_3_id=#{chapter_three.id} chapter_4_id=#{chapter_four.id} " <>
    "setup_mode=isolated_fixture"
)
