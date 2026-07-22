# SC-AU13-B2 场景 seed：章节计划 + 1 名角色 + 1 条 STALLED 弧光 + 已采纳第 1 章正文。
# revise_prose 处置 → 对话流改写候选（VS-00E §8 sibling）→ 原稿保留由阅读投影证明。
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
  "字数与场次：约1200字，两场（潜入/突破）"
]

{:ok, work} =
  WorkService.create(%{
    "title" => "AU13 修订候选验收作品",
    "genre" => "赛博修仙",
    "core_selling_point" => "revise_prose 处置产 sibling 修订候选、原稿保留",
    "target_reader" => "关注长篇连续性的作者",
    "tone_preference" => "克制、紧张、具象"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

{:ok, _plan} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_au13c_chapter_plan_seed",
    artifact_id: "as_au13c_chapter_plan_seed",
    artifact_type: :outline_draft,
    base_revision: 1,
    content: Enum.join(chapter_lines, "\n"),
    summary: "AU13 修订两章章节计划"
  })

{:ok, _character} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_au13c_character_seed",
    artifact_id: "as_au13c_character_seed",
    artifact_type: :character_seed,
    base_revision: 1,
    content: "宗门遗孤，设计为贯穿主线的对手；第 1 章短暂出场后线索中断。",
    summary: "凌渊"
  })

{:ok, _prose} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_au13c_prose_seed",
    artifact_id: "as_au13c_prose_seed",
    artifact_type: :prose_fragment,
    base_revision: 1,
    content:
      "第01章：底层灵气账单：灵气账单在夜色里泛着冷光，凌渊在巷口留下最后一次出场的背影。主角逐行核对扣费记录，发现带宽被公司暗中抽走。",
    summary: "第01章：底层灵气账单"
  })

{:ok, _entry} =
  LedgerRepository.upsert(%{
    work_id: work.id,
    ledger: "arc",
    subject_kind: "character",
    subject_ref: "seed_char_凌渊",
    subject_label: "凌渊",
    status: "STALLED",
    payload: %{"last_seen_seq" => 1},
    source_refs: ["chapter_summary:au13c_seed_ch1"]
  })

IO.puts("[au13-revise-prose-seed] work_id=#{work.id} session_id=#{session_id}")
