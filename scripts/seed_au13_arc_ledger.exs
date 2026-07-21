# AU-13 SC-AU13-A1 场景 seed：已采纳 3 章计划 + 已采纳角色 roster（弧光账主体来源）。
# 与 seed_p1_chapter_draft_generation 同型；角色经真实采纳边界写入 Character 主档案
# （artifact_type=:character_seed，name←summary，AU-09 契约），无任何验收感知逻辑。
alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.AdoptionRepository

chapter_lines = [
  "第01章：底层灵气账单: 主角在欠费停灵的夜晚发现灵气带宽被公司暗中抽走。",
  "章功能定位：推进章",
  "情节推进：主角在欠费停灵的夜晚核对灵气账单，发现带宽被公司暗中抽走",
  "人物变化：从麻木缴费者转为起疑的观察者",
  "信息释放：灵气按带宽计费且存在暗抽通道",
  "伏笔动作：埋下账单背面旧巷与出气口的位置线索",
  "情绪定位：压抑中透出第一丝反抗",
  "章首拉力：停灵倒计时逼近的紧迫感",
  "章尾断章：账单上浮现出不属于任何条目的扣费记录",
  "字数与场次：约1200字，两场（对账/夜巡）",
  "第02章：旧服务器里的残诀: 主角从废弃服务器中找到残缺功法，并第一次突破底层限制。",
  "章功能定位：推进章",
  "情节推进：主角潜入废弃机房，从旧服务器中找到残缺功法，第一次突破底层限制",
  "人物变化：获得可成长的手段，胆量与野心同步抬头",
  "信息释放：旧网络时代存在未被公司收编的修行数据",
  "伏笔动作：残诀缺失的后半部指向黑市",
  "情绪定位：紧张后的振奋",
  "章首拉力：警报间隙潜入的机会窗口",
  "章尾断章：残诀末页的署名与调频师符号相同",
  "字数与场次：约1200字，两场（潜入/突破）",
  "第03章：黑市调频师: 主角结识能改写灵气频段的调频师，获得追查垄断链路的入口。",
  "章功能定位：铺垫章",
  "情节推进：主角循符号找到黑市调频师，达成互利交换",
  "人物变化：第一次拥有盟友关系",
  "信息释放：灵气频段可被人为改写，垄断存在技术缺口",
  "伏笔动作：调频师提及失踪散修名单",
  "情绪定位：警惕与好奇交织",
  "章首拉力：黑市接头的身份试探",
  "章尾断章：名单末尾出现主角熟悉的名字",
  "字数与场次：约1200字，两场（接头/交换）"
]

{:ok, work} =
  WorkService.create(%{
    "title" => "AU13 弧光账验收作品",
    "genre" => "赛博修仙",
    "core_selling_point" => "采纳即记账、账面可查可入上下文",
    "target_reader" => "关注长篇连续性的作者",
    "tone_preference" => "克制、紧张、具象"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

{:ok, _plan} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_au13_chapter_plan_seed",
    artifact_id: "as_au13_chapter_plan_seed",
    artifact_type: :outline_draft,
    base_revision: 1,
    content: Enum.join(chapter_lines, "\n"),
    summary: "AU13 三章章节计划"
  })

characters = [
  {"林岚", "底层散修，主角最早的同伴；擅长在巡检间隙传递消息，弧光设计为从跟随者成长为独当一面的联络人。"},
  {"沈曜", "灵气交易所稽查官，立场摇摆的内线；弧光设计为从体制执行者转向暗中协助底层。"}
]

for {name, profile} <- characters do
  {:ok, _} =
    AdoptionRepository.persist(%{
      actor_ref: "author",
      work_id: work.id,
      source_turn_ref: "turn_au13_character_seed_#{name}",
      artifact_id: "as_au13_character_seed_#{name}",
      artifact_type: :character_seed,
      base_revision: 1,
      content: profile,
      summary: name
    })
end

IO.puts("[au13-arc-ledger-seed] work_id=#{work.id} session_id=#{session_id}")
