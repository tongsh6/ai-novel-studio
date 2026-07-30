# AU08 分卷规划场景 seed：只立作品与全书骨架，**不预置任何卷/章结构**。
#
# 卷分组必须由真实链路产出：规划 prompt（WorkSkeleton.volume_directive/1 只在
# planned_volumes > 1 且骨架有目标体量时发指令）→ 模型逐章标注「所属卷：卷标题」→
# ChapterPlanParser 解析 → AdoptionRepository 按标注物化多卷 → 目录按卷分层。
# 因此 seed 里唯一与卷有关的事实是 `planned_volumes`（作者立项时填的规划字段），
# 卷本身在采纳前必须为 0 行。
alias NovelApplication.{WorkService, WorkSessionService}

{:ok, work} =
  WorkService.create(%{
    "title" => "AU08 分卷规划作品",
    "genre" => "赛博修仙",
    "core_selling_point" => "分卷推进的长篇连载，卷与卷之间各有收束",
    "target_reader" => "追更长篇的连载读者",
    "tone_preference" => "克制、紧张、具象",
    # 目标体量：骨架段（含分卷守则）只在 target_length 存在时渲染。
    "target_length" => 60_000,
    "planned_volumes" => 2,
    "serial_form" => "SERIALIZED"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

IO.puts(
  "[au08-volume-planning-seed] work_id=#{work.id} session_id=#{session_id} planned_volumes=2 target_length=60000"
)
