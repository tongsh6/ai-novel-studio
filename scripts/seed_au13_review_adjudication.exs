# SC-AU13-B1/C1 场景 seed：已采纳章节计划 + 4 名已采纳角色 + 4 条 STALLED 弧光条目。
# 账面经仓储 upsert（TENTATIVE→ACCEPTED 自动通过仪式，I-L2）；source_refs 非空（I-L1）。
# 全书审读由驱动器在真实页面显式发起，报告不在 seed 里预制（对账链路必须真实跑）。
alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.{AdoptionRepository, LedgerRepository}

chapter_lines = [
  "第01章：底层灵气账单: 主角在欠费停灵的夜晚发现灵气带宽被公司暗中抽走。",
  "章功能定位：推进章",
  "情节推进：主角核对灵气账单，发现带宽被公司暗中抽走",
  "人物变化：从麻木缴费者转为起疑的观察者",
  "信息释放：灵气按带宽计费且存在暗抽通道",
  "伏笔动作：埋下账单背面旧巷与出气口的位置线索",
  "情绪定位：压抑中透出第一丝反抗",
  "章首拉力：停灵倒计时逼近的紧迫感",
  "章尾断章：账单上浮现出不属于任何条目的扣费记录",
  "字数与场次：约1200字，两场（对账/夜巡）",
  "第02章：旧服务器里的残诀: 主角从废弃服务器中找到残缺功法，并第一次突破底层限制。",
  "章功能定位：推进章",
  "情节推进：主角潜入废弃机房找到残缺功法并突破底层限制",
  "人物变化：获得可成长的手段",
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
  "信息释放：灵气频段可被人为改写",
  "伏笔动作：调频师提及失踪散修名单",
  "情绪定位：警惕与好奇交织",
  "章首拉力：黑市接头的身份试探",
  "章尾断章：名单末尾出现主角熟悉的名字",
  "字数与场次：约1200字，两场（接头/交换）"
]

{:ok, work} =
  WorkService.create(%{
    "title" => "AU13 审读裁决作品",
    "genre" => "赛博修仙",
    "core_selling_point" => "审读报告逐项处置、脉络可查",
    "target_reader" => "关注长篇连续性的作者",
    "tone_preference" => "克制、紧张、具象"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

{:ok, _plan} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_au13b_chapter_plan_seed",
    artifact_id: "as_au13b_chapter_plan_seed",
    artifact_type: :outline_draft,
    base_revision: 1,
    content: Enum.join(chapter_lines, "\n"),
    summary: "AU13 审读三章章节计划"
  })

characters = [
  {"凌渊", "宗门遗孤，设计为贯穿主线的对手；第 1 章短暂出场后线索中断。"},
  {"沈墨", "公司内审专员，设计为中期反水的内线；第 1 章埋线后未再推进。"},
  {"韩晟", "旧网络维护者，设计为技术线导师；第 1 章提及后未出场。"},
  {"白露", "黑市情报贩子，设计为情报线支点；第 1 章交易后失联。"}
]

for {name, profile} <- characters do
  {:ok, _} =
    AdoptionRepository.persist(%{
      actor_ref: "author",
      work_id: work.id,
      source_turn_ref: "turn_au13b_character_seed_#{name}",
      artifact_id: "as_au13b_character_seed_#{name}",
      artifact_type: :character_seed,
      base_revision: 1,
      content: profile,
      summary: name
    })

  {:ok, _} =
    LedgerRepository.upsert(%{
      work_id: work.id,
      ledger: "arc",
      subject_kind: "character",
      subject_ref: "seed_char_#{name}",
      subject_label: name,
      status: "STALLED",
      payload: %{"last_seen_seq" => 1},
      source_refs: ["chapter_summary:au13b_seed_ch1"]
    })
end

IO.puts("[au13-review-adjudication-seed] work_id=#{work.id} session_id=#{session_id}")
