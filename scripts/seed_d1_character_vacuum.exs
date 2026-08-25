# D1 CP2 场景 seed：角色档案真空的作品（work + 已采纳两章计划，零 characters、零记忆）——
# 真空守则、伴生角色 seed 接线与「采纳后 roster 进 prompt」的双向验证起点。
alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.AdoptionRepository

{:ok, work} =
  WorkService.create(%{
    "title" => "D1 角色真空验收作品",
    "genre" => "都市异闻",
    "core_selling_point" => "灯禁之城的巡夜与违禁点灯者",
    "premise" => "入夜即禁灯的城里，点亮第三盏灯的人会引来巡夜人",
    "tone_preference" => "克制、悬疑"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

{:ok, _plan} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_d1_plan_seed",
    artifact_id: "as_d1_plan_seed",
    artifact_type: :outline_draft,
    base_revision: 1,
    content:
      "第01章：灯禁初夜: 夜巡开始，城中出现第三盏灯的踪迹。\n" <>
        "第02章：蓝灰线索: 循着蓝灰痕迹追向违禁点灯者。",
    summary: "D1 两章计划"
  })

IO.puts("[d1-character-vacuum-seed] work_id=#{work.id} session_id=#{session_id} characters=0")
