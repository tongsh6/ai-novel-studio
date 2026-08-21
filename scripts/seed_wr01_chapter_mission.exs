# WR01 写前推理场景 seed：三章计划（第 03 章带 E18–E22 结构化方向 + 两条场次）+ 前两章
# 已采纳正文 + 一条带预期且已超期的已采纳伏笔（planned_reveal=第 2 章，已写到第 2 章）
# + 一名已确认角色（采纳正文后弧光账有主体）。写前推理的输入材料因此同时含设计态
# （plan:3:*）与进度态（ledger:information:foreshadow_*、ledger:arc:*）；推导与正文生成
# 全部由外部 driver 在真实页面发起，seed 不预制任何使命。
alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.AdoptionRepository

chapter_plan = """
第01章：黑市对账夜: 沈洛潜入黑市核对灵气账单，摊主交出一枚刻着编号的旧账牌。
第02章：旧账兑现: 旧账牌的编号在当铺被当面兑现，牵出公司暗抽的第一段链路。
第03章：巡检收网: 公司巡检开始收网，沈洛必须带着证据撤出黑市。
章功能定位：推进章
情节推进：沈洛带着底单撤出黑市，巡检封锁巷口
人物变化：沈洛第一次主动为别人承担风险
信息释放：巡检头目认得旧账牌的编号
伏笔动作：旧账牌编号与公司暗抽链路在本章对上
情绪定位：压迫感中带一丝侥幸
场次：巷口封锁｜目标：避开巡检带底单撤离｜议程：沈洛要撤、巡检要清场｜情绪：压迫
场次：编号对上｜目标：让旧账牌编号与底单链路对上｜情绪：侥幸后坠入寒意
"""

accepted_prose = [
  {"第01章：黑市对账夜",
   "黑市的冷光下，沈洛把三张灵气账单摊开逐行核对。摊主递来一枚旧账牌，牌面刻着一串编号，" <>
     "说凭它能在当铺换到想要的答案。巡检的脚步声从巷口传来，他把账牌收进袖中。"},
  {"第02章：旧账兑现",
   "当铺的柜台后，老朝奉验过旧账牌，编号当面兑现——换出的不是灵石，而是一页公司暗抽" <>
     "频段的底单。沈洛终于看清了链路的第一段，也明白这枚账牌为什么会流到自己手里。"}
]

{:ok, work} =
  WorkService.create(%{
    "title" => "WR01 写前推理验收作品",
    "genre" => "赛博修仙",
    "core_selling_point" => "正文写作前先按计划与脉络推导本章使命",
    "target_reader" => "在意长篇连续性的连载作者",
    "tone_preference" => "克制、紧张、具象"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

{:ok, _plan} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_wr01_plan_seed",
    artifact_id: "as_wr01_plan_seed",
    artifact_type: :outline_draft,
    base_revision: 1,
    content: String.trim(chapter_plan),
    summary: "WR01 三章计划（第 03 章带结构化方向）"
  })

{:ok, _character} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_wr01_character_seed",
    artifact_id: "as_wr01_character_seed",
    artifact_type: :character_seed,
    base_revision: 1,
    content: "沈洛：灵气稽查员，靠核对账单追查公司暗抽。",
    summary: "沈洛",
    narrative_role: "PROTAGONIST"
  })

for {title, content} <- accepted_prose do
  {:ok, _} =
    AdoptionRepository.persist(%{
      actor_ref: "author",
      work_id: work.id,
      source_turn_ref: "turn_wr01_prose_#{title}",
      artifact_id: "as_wr01_prose_#{:erlang.phash2(title)}",
      artifact_type: :prose_fragment,
      base_revision: 1,
      content: content,
      summary: title
    })
end

{:ok, foreshadow} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_wr01_foreshadow_seed",
    artifact_id: "as_wr01_foreshadow_seed",
    artifact_type: :foreshadowing_seed,
    base_revision: 1,
    content: "旧账牌上的编号会在黑市兑现，牵出公司暗抽链路。",
    summary: "伏笔：矿区旧账",
    planned_reveal: %{"kind" => "chapter", "seq" => 2}
  })

IO.puts(
  "[wr01-chapter-mission-seed] work_id=#{work.id} session_id=#{session_id} " <>
    "foreshadow_ref=foreshadow_#{foreshadow.memory_item_id} planned_reveal=chapter:2 written=2"
)
