# CA04 携带缺口收口场景 seed：全书骨架已立（target_length/planned_volumes/serial_form）+
# 三章计划两章已采纳 + 已确认伏笔记忆与风格规则 + 已确认主角——让 G1（正文带全书进度与
# 收官守则）/ G2（规划带作品事实与风格）/ G3（world_building 带阵容）三条新携带都有真实
# 数据源可带；生成与采纳全部由外部 driver 在真实页面发起。
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
    "title" => "CA04 携带缺口验收作品",
    "genre" => "赛博修仙",
    "core_selling_point" => "携带层三条新通道各有真实数据源",
    "target_reader" => "在意设定一致性的连载作者",
    "tone_preference" => "克制、紧张、具象",
    "target_length" => 140_000,
    "planned_volumes" => 2,
    "serial_form" => "网络连载"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

{:ok, _plan} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_ca04_plan_seed",
    artifact_id: "as_ca04_plan_seed",
    artifact_type: :outline_draft,
    base_revision: 1,
    content: String.trim(chapter_plan),
    summary: "CA04 三章计划"
  })

{:ok, _character} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_ca04_character_seed",
    artifact_id: "as_ca04_character_seed",
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
      source_turn_ref: "turn_ca04_prose_#{title}",
      artifact_id: "as_ca04_prose_#{:erlang.phash2(title)}",
      artifact_type: :prose_fragment,
      base_revision: 1,
      content: content,
      summary: title
    })
end

{:ok, _foreshadow} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_ca04_foreshadow_seed",
    artifact_id: "as_ca04_foreshadow_seed",
    artifact_type: :foreshadowing_seed,
    base_revision: 1,
    content: "旧账牌上的编号会在黑市兑现，牵出公司暗抽链路。",
    summary: "伏笔：矿区旧账",
    planned_reveal: %{"kind" => "chapter", "seq" => 2}
  })

{:ok, _style} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_ca04_style_seed",
    artifact_id: "as_ca04_style_seed",
    artifact_type: :style_rule_seed,
    base_revision: 1,
    content: "多用对白推进情节，少用心理独白。",
    summary: "风格：对白优先"
  })

IO.puts(
  "[ca04-carry-gaps-seed] work_id=#{work.id} session_id=#{session_id} " <>
    "skeleton=140000/2卷 memory=伏笔+风格 roster=沈洛 written=2"
)
