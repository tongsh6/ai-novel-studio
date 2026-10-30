alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.Repo
alias NovelPersistence.Schemas.{Chapter, Character, Draft, Scene, Volume}

# B33 CP3：语义判断与机械守卫分工的原生真实模型验收隔离种子。
# - 作品：4 章，标题编号 01/03/05/07 与真实 seq 1/3/5/7（重编号正例存在真实 old→new 映射）；
#   seq 3 章有 accepted 正文且无错别字（S1 条件性 no-op 目标）；
#   seq 7 章为 PLANNED 且无正文（S4 写章正例目标）；
# - 角色：顾青 PROTAGONIST（当前主角），陆晨 SUPPORTING（S3 讨论「把陆晨指定为主角是否合理」目标）。
# 只写测试库；不预置任何判断/候选/验收感知字段。
create_character = fn work_id, name, role, narrative_role, summary ->
  Repo.insert!(%Character{
    work_id: work_id,
    name: name,
    aliases: [],
    role: role,
    narrative_role: narrative_role,
    summary: summary,
    status: "ACCEPTED",
    provisional_active: false
  })
end

{:ok, work} =
  WorkService.create(%{
    "title" => "B33 语义判断与机械守卫复现作品",
    "genre" => "雨港悬疑",
    "core_selling_point" => "讨论、条件性无变化与明确创作动作的语义判断分工",
    "target_reader" => "关注判断语义与作者限制的读者",
    "tone_preference" => "克制、潮湿",
    "target_length" => 60_000,
    "planned_volumes" => 1,
    "serial_form" => "SERIALIZED"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

volume =
  Repo.insert!(%Volume{work_id: work.id, title: "第一卷", seq: 1, status: "DRAFTING"})

chapter_specs = [
  {1, "第01章：灯楼夜账", "DRAFTING", "灯楼夜账翻到第七页时，顾青把灯芯挑亮，账页上的水痕还没有干。"},
  {3, "第03章：井底回声", "DRAFTING",
   "井底回声最重的那一声落下来时，顾青没有睁眼，只把账册往怀里收了收。灯楼的旧钟跟着响了一下。"},
  {5, "第05章：潮汐账页", "DRAFTING", "潮汐账页被海风掀起，顾青按住纸角，听见楼下有人把门闩轻轻放下。"},
  {7, "第07章：空章待写", "PLANNED", "待写：雨夜灯塔的第一场。"}
]

chapters =
  Enum.map(chapter_specs, fn {seq, title, status, summary} ->
    chapter =
      Repo.insert!(%Chapter{
        work_id: work.id,
        volume_id: volume.id,
        title: title,
        seq: seq,
        status: status,
        summary: summary
      })

    if status == "DRAFTING" do
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
          content: summary <> "（B33 判断语义复现正文锚点）",
          status: "ACCEPTED",
          revision: 1
        })
    end

    chapter
  end)

_gu = create_character.(work.id, "顾青", "巡夜人", "PROTAGONIST", "当前作品主角，负责巡夜与外部行动")
_lu = create_character.(work.id, "陆晨", "灯楼账房", "SUPPORTING", "账房助手，动机线仍待展开")

chapter_three = Enum.find(chapters, &(&1.seq == 3))
chapter_seven = Enum.find(chapters, &(&1.seq == 7))

IO.puts(
  "[b33-authoring-intent-seed] work_id=#{work.id} session_id=#{session_id} " <>
    "chapter_count=#{length(chapters)} character_count=2 " <>
    "chapter_3_id=#{chapter_three.id} chapter_7_id=#{chapter_seven.id}"
)
