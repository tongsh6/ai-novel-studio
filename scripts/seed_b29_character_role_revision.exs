alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.Repo
alias NovelPersistence.Schemas.{Chapter, Character, Draft, Scene, Volume}

# B29 CP0：已有角色叙事身份修订的隔离种子。
# - 沈砚（ENSEMBLE_POV，别名 老沈，有角色主档案与正文关联）；
# - 顾青（已是 PROTAGONIST，用于多主角/只改目标不被全局取消）；
# - 第二个同名「沈砚」（别名 小沈，MINOR，同作品不同 character_id，用于同名消歧）；
# - 阿鸢（SUPPORTING），以及一章 accepted 正文（正文提及沈砚/顾青）。
# 只写测试库；不预置任何「主角修订」能力事实。
create_character = fn work_id, name, aliases, role, narrative_role, summary ->
  Repo.insert!(%Character{
    work_id: work_id,
    name: name,
    aliases: aliases,
    role: role,
    narrative_role: narrative_role,
    summary: summary,
    status: "ACCEPTED",
    provisional_active: false
  })
end

{:ok, work} =
  WorkService.create(%{
    "title" => "B29 已有角色叙事身份复现作品",
    "genre" => "雨港悬疑",
    "core_selling_point" => "已有角色叙事身份修订与主角事实一致性",
    "target_reader" => "关注群像与主角语义的读者",
    "tone_preference" => "克制、潮湿",
    "target_length" => 60_000,
    "planned_volumes" => 1,
    "serial_form" => "SERIALIZED"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

volume =
  Repo.insert!(%Volume{work_id: work.id, title: "第一卷", seq: 1, status: "DRAFTING"})

chapter =
  Repo.insert!(%Chapter{
    work_id: work.id,
    volume_id: volume.id,
    title: "第01章：灯楼夜账",
    seq: 1,
    status: "DRAFTING",
    summary: "沈砚与顾青在灯楼核对夜账"
  })

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
    content: "灯楼夜账翻到第七页时，沈砚把灯芯挑亮，顾青在门外按刀等着。两人都没有说话，井底的风把账页吹得作响。（角色叙事身份复现正文锚点）",
    status: "ACCEPTED",
    revision: 1
  })

shen =
  create_character.(
    work.id,
    "沈砚",
    ["老沈"],
    "灯楼查账人",
    "ENSEMBLE_POV",
    "群像视角中的查账人，熟悉灯楼旧账与井底黑泉"
  )

gu =
  create_character.(
    work.id,
    "顾青",
    [],
    "巡夜人",
    "PROTAGONIST",
    "当前已确认的主角，负责巡夜与外部行动"
  )

shen_small =
  create_character.(
    work.id,
    "沈砚",
    ["小沈"],
    "账房学徒",
    "MINOR",
    "与查账人沈砚同名的账房学徒，偶尔替班"
  )

_ayuan =
  create_character.(
    work.id,
    "阿鸢",
    [],
    "灯楼守夜人",
    "SUPPORTING",
    "守夜人，知情但立场未明"
  )

IO.puts(
  "[b29-character-role-revision-seed] work_id=#{work.id} session_id=#{session_id} " <>
    "chapter_id=#{chapter.id} " <>
    "shen_character_id=#{shen.id} gu_character_id=#{gu.id} " <>
    "shen_small_character_id=#{shen_small.id} " <>
    "character_count=4"
)
