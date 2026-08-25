# D3 断供自愈场景 seed：两章计划——第 01 章标题带 D3SUMFAIL（替身以此让该章摘要生成
# 定向失败，制造断供），第 02 章干净（组装读摘要时触发惰性补做）。
alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.AdoptionRepository

{:ok, work} =
  WorkService.create(%{
    "title" => "D3 摘要断供自愈作品",
    "genre" => "都市异闻",
    "core_selling_point" => "摘要断供后的读取侧自愈",
    "tone_preference" => "克制"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

{:ok, _plan} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_d3_plan_seed",
    artifact_id: "as_d3_plan_seed",
    artifact_type: :outline_draft,
    base_revision: 1,
    content:
      "第01章：D3SUMFAIL断供夜: 夜巡开始，第三盏灯的踪迹初现。\n" <>
        "第02章：蓝灰复检: 循蓝灰痕迹复检灯禁边界。",
    summary: "D3 两章计划"
  })

IO.puts("[d3-summary-repair-seed] work_id=#{work.id} session_id=#{session_id}")
