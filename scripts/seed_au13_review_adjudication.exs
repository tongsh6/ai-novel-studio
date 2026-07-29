# SC-AU13-B1/C1 场景 seed：已采纳章节计划 + 4 名已采纳角色 + 4 条 STALLED 弧光条目。
# 账面经仓储 upsert（TENTATIVE→ACCEPTED 自动通过仪式，I-L2）；source_refs 非空（I-L1）。
# 全书审读由驱动器在真实页面显式发起，报告不在 seed 里预制（对账链路必须真实跑）。
#
# VS-00G R7「提前收官」设计负债前置（三者同时成立才触发，规则本身不被 seed 感知）：
#   ① 作品已立目标体量 target_length（未立则归 R6 骨架缺位，不是 R7）；
#   ② 已采纳正文远低于目标体量（第 1 章一段正文 / 6 万字目标 → 进度个位数百分比）；
#   ③ 近窗（末 5 章）章计划里已出现终局/收官定位——第 04 章标题「第一卷终局」+
#      章功能定位「收官章」。
# 这是 M3 狗粮收官循环病灶的最小标本：书才起头，规划已自带终局。
import Ecto.Query

alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.{AdoptionRepository, LedgerRepository, Repo}
alias NovelPersistence.Schemas.Chapter

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
  "字数与场次：约1200字，两场（接头/交换）",
  "第04章：第一卷终局：灵气回流: 主角与调频师联手切断暗抽总闸，第一卷就此收束。",
  "章功能定位：收官章",
  "情节推进：主角与调频师合力切断暗抽总闸，灵气回流底层街区",
  "人物变化：从被动缴费者变成敢于对抗公司的行动者",
  "信息释放：暗抽通道的总闸位置与操盘者身份",
  "伏笔动作：残诀后半卷的去向留到下一卷",
  "情绪定位：紧绷之后的短暂释然",
  "章首拉力：总闸倒计时与巡查同时逼近",
  "章尾断章：回流的灵气里混进一段陌生频率",
  "字数与场次：约1200字，三场（潜入/断闸/回流）"
]

# 已写正文（进度分子）：只写第 1 章，让全书进度停在个位数百分比。
seed_chapter_one_prose =
  "灵气账单在夜色里泛着冷光。沈砚把三张单据并排摊在桌面上，逐行核对扣费记录，" <>
    "指尖顺着那串编号一路划下去。停灵倒计时挂在窗外的公共屏幕上，红色数字每跳一格，" <>
    "楼道里就少亮一盏灯。他记得上个月的用量并没有这么多，可账单上的带宽消耗却翻了近一倍。" <>
    "他把最早的一张翻到背面，那里印着一行几乎看不清的编码。按公司公开的计费口径，" <>
    "灵气按带宽结算，用多少扣多少，可这串编码对应的通道从来没有出现在任何条目里。" <>
    "沈砚试着把三张单据的编码对齐，发现它们共享同一个前缀，指向城西旧巷深处的一处出气口。" <>
    "凌渊那天夜里从巷口经过，只留下一个背影。沈砚追出去时，只看见地面上被灵气灼出的浅痕，" <>
    "像是有人在这里强行改过频段。他蹲下来，把浅痕的走向记在账单背面，" <>
    "又抬头看了看那台早已停机的旧服务器。夜风穿过机房外壳，发出一声闷响。" <>
    "回到出租屋，停灵倒计时只剩不到两个小时。沈砚重新算了一遍：按公开口径，" <>
    "他这个月的欠费不该超过三成；可账单上多出来的那部分，被折算成了一笔没有名目的扣费。" <>
    "他把这笔扣费单独抄下来，写在纸的最上面，然后在下面画了一条横线。" <>
    "那条横线之后，他决定不再按时缴费。"

{:ok, work} =
  WorkService.create(%{
    "title" => "AU13 审读裁决作品",
    "genre" => "赛博修仙",
    "core_selling_point" => "审读报告逐项处置、脉络可查",
    "target_reader" => "关注长篇连续性的作者",
    "tone_preference" => "克制、紧张、具象",
    "target_length" => 60_000,
    "planned_volumes" => 3,
    "serial_form" => "SERIALIZED"
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
    summary: "AU13 审读四章章节计划"
  })

first_chapter =
  Repo.one!(
    from(c in Chapter,
      where: c.work_id == ^work.id,
      order_by: [asc: c.seq],
      limit: 1
    )
  )

{:ok, _prose} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_au13b_prose_seed_ch1",
    artifact_id: "as_au13b_prose_seed_ch1",
    artifact_type: :prose_fragment,
    base_revision: 1,
    content: seed_chapter_one_prose,
    summary: first_chapter.title
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

IO.puts(
  "[au13-review-adjudication-seed] work_id=#{work.id} session_id=#{session_id} " <>
    "finale_chapter_seq=4 target_length=60000"
)
