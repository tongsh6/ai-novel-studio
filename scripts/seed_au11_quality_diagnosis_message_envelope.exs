# B40 CP1（判断纪元重锚）：AU11 质量诊断场景 seed。
#
# 旧 envelope 时代这里只采纳章节计划（旧 envelope 读 chapter_lines 作为 WorkState）。
# 判断纪元后质量诊断按「普通回复来源/覆盖」验收：模型的判断 prompt 由生产
# judgment_work_facts_section/1 渲染「正文统计：N 章中已写 M 章」。为了让「这一章
# 不够爽」的诊断有真实当前章材料（而不是 0 章空作品），这里在章节计划之后追加
# 第 1 章已采纳正文。seed 只造作品事实，不预制裁断结论。
import Ecto.Query

alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.{AdoptionRepository, Repo}
alias NovelPersistence.Schemas.Chapter

chapter_lines = [
  "第01章：灵源账单: 林烬发现妹妹林瑶留下的灵气账单异常，决定潜入矿区追查。",
  "第02章：旧服务器残诀: 林烬用残缺功法破解第一道公司封锁，但代价是暴露了灵力频段。",
  "第03章：霓虹地牢试炼: 林烬在地下算力矿井轻松击败守卫，确认矿区与失踪散修有关，但胜利代价尚未显现。"
]

seed_chapter_one_prose =
  "灵气账单在夜色里泛着冷光。林烬把三张单据并排摊在桌面上，逐行核对扣费记录，" <>
    "指尖顺着那串编号一路划下去。妹妹林瑶留下的那张单据夹在最下面，边角已经磨得起毛。" <>
    "停灵倒计时挂在窗外的公共屏幕上，红色数字每跳一格，楼道里就少亮一盏灯。" <>
    "他记得上个月的用量并没有这么多，可账单上的带宽消耗却翻了近一倍。" <>
    "他把三张单据的编码对齐，发现它们共享同一个前缀，指向城西旧巷深处的一处出气口。" <>
    "矿区方向的天空泛着不正常的紫色。林烬把单据折好塞进衣袋，决定今晚就潜进去看看。" <>
    "他轻松翻过了第一道封锁线。守卫比他想象中弱，三招之内就被放倒，" <>
    "他甚至没来得及确认对方的灵力频段。胜利来得太容易，反而让他心里发毛。" <>
    "矿井深处传来规律的机械声，像有什么东西在黑暗里数着他的心跳。" <>
    "他摸到腰间的账单，忽然意识到：自己在没有任何代价的情况下走到了这里。" <>
    "而妹妹的名字，正写在矿井最深处那面显示屏的最上面一行。"

{:ok, work} =
  WorkService.create(%{
    "title" => "灵源纪元",
    "genre" => "赛博修仙",
    "core_selling_point" => "林烬为寻找妹妹林瑶追查灵源矿区真相",
    "target_reader" => "喜欢高压逆转和悬疑成长线的读者",
    "tone_preference" => "克制、紧张、带希望感"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

{:ok, persisted} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_au11_chapter_plan_seed",
    artifact_id: "as_au11_chapter_plan_seed",
    artifact_type: :outline_draft,
    base_revision: 1,
    content: Enum.join(chapter_lines, "\n"),
    summary: "AU11 质量诊断章节上下文"
  })

# 章节计划采纳会创建计划章；把第 1 章的已采纳正文（进度分子）补上，使判断 prompt
# 的「作品事实」段如实显示「已写 1 章」，质量诊断才有真实当前章材料可依。
first_chapter =
  Repo.one!(
    from(c in Chapter,
      where: c.work_id == ^work.id,
      order_by: [asc: c.seq],
      limit: 1
    )
  )

{:ok, prose} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_au11_prose_seed_ch1",
    artifact_id: "as_au11_prose_seed_ch1",
    artifact_type: :prose_fragment,
    base_revision: 1,
    content: seed_chapter_one_prose,
    summary: first_chapter.title
  })

IO.puts(
  "[au11-quality-diagnosis-message-envelope-seed] work_id=#{work.id} session_id=#{session_id} " <>
    "memory_item_id=#{persisted.memory_item_id} prose_memory_item_id=#{prose.memory_item_id} " <>
    "chapter_one_prose=#{length(String.split(seed_chapter_one_prose, "", trim: true))} chars"
)
