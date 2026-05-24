alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.AdoptionRepository

chapter_lines = [
  "第01章：底层灵气账单: 主角在欠费停灵的夜晚发现灵气带宽被公司暗中抽走。",
  "第02章：旧服务器里的残诀: 主角从废弃服务器中找到残缺功法，并第一次突破底层限制。",
  "第03章：黑市调频师: 主角结识能改写灵气频段的调频师，获得追查垄断链路的入口。",
  "第04章：巡检队的诱捕: 公司巡检队发现异常波动，主角被迫在贫民区展开第一次逃亡。",
  "第05章：霓虹地牢试炼: 主角进入地下算力矿井，确认灵气剥削与失踪散修有关。",
  "第06章：中层执行者的裂缝: 一名公司执行者透露内部清洗计划，主角开始区分敌人与可争取对象。",
  "第07章：断网之城: 公司切断整片街区灵气网络，主角组织底层散修维持基本生存。",
  "第08章：核心模块的代价: 主角夺得核心灵气模块，却发现它会吞噬使用者的记忆。",
  "第09章：伪仙直播夜: 公司用公开演示掩盖事故，主角借直播揭露部分真相。",
  "第10章：反向筑基协议: 主角把残诀、调频术和核心模块重组为能共享给底层的协议。",
  "第11章：天台上的背叛: 关键盟友被公司胁迫出卖坐标，团队遭遇最严重溃败。",
  "第12章：第一卷终局：灵气回流: 主角牺牲个人突破机会，让被垄断的灵气第一次回流到整座街区。"
]

{:ok, work} =
  WorkService.create(%{
    "title" => "P1 单章正文草稿验证作品",
    "genre" => "赛博修仙",
    "core_selling_point" => "从已采纳章节计划生成待采纳正文草稿",
    "target_reader" => "关注长篇主链闭环的作者",
    "tone_preference" => "克制、紧张、具象"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

{:ok, persisted} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_p1_chapter_plan_seed",
    artifact_id: "as_p1_chapter_plan_seed",
    artifact_type: :outline_draft,
    base_revision: 1,
    content: Enum.join(chapter_lines, "\n"),
    summary: "P1 10 万字章节计划"
  })

IO.puts(
  "[p1-chapter-draft-generation-seed] work_id=#{work.id} session_id=#{session_id} memory_item_id=#{persisted.memory_item_id}"
)
