# VS00F 刀④ CP3 场景 seed：三章计划 + 前两章已采纳正文 + 一条带预期的已采纳伏笔
# （planned_reveal=第 1 章，已写到第 2 章 → R9 超期）。角色档案刻意为空——
# 弧光账零条目，prose 的 progress_state 一旦发射即证明信息段真实注入。
# 审读/盘点/回收采纳全部由外部 driver 在真实页面发起，seed 不预制任何结论。
alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.AdoptionRepository

chapter_plan = """
第01章：黑市对账夜: 沈洛潜入黑市核对灵气账单，摊主交出一枚刻着编号的旧账牌。
第02章：旧账兑现: 旧账牌的编号在当铺被当面兑现，牵出公司暗抽的第一段链路。
第03章：巡检收网: 公司巡检开始收网，沈洛必须带着证据撤出黑市。
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
    "title" => "VS00F 伏笔回收验收作品",
    "genre" => "赛博修仙",
    "core_selling_point" => "伏笔从埋设到超期提醒到作者收账的全环",
    "target_reader" => "在意伏笔回收的连载作者",
    "tone_preference" => "克制、紧张、具象"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

{:ok, _plan} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_vs00f_fr_plan_seed",
    artifact_id: "as_vs00f_fr_plan_seed",
    artifact_type: :outline_draft,
    base_revision: 1,
    content: String.trim(chapter_plan),
    summary: "VS00F 伏笔回收三章计划"
  })

for {title, content} <- accepted_prose do
  {:ok, _} =
    AdoptionRepository.persist(%{
      actor_ref: "author",
      work_id: work.id,
      source_turn_ref: "turn_vs00f_fr_prose_#{title}",
      artifact_id: "as_vs00f_fr_prose_#{:erlang.phash2(title)}",
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
    source_turn_ref: "turn_vs00f_fr_foreshadow_seed",
    artifact_id: "as_vs00f_fr_foreshadow_seed",
    artifact_type: :foreshadowing_seed,
    base_revision: 1,
    content: "旧账牌上的编号会在黑市兑现，牵出公司暗抽链路。",
    summary: "伏笔：矿区旧账",
    planned_reveal: %{"kind" => "chapter", "seq" => 1}
  })

IO.puts(
  "[vs00f-foreshadow-resolution-seed] work_id=#{work.id} session_id=#{session_id} " <>
    "foreshadow_ref=foreshadow_#{foreshadow.memory_item_id} planned_reveal=chapter:1 written=2"
)
