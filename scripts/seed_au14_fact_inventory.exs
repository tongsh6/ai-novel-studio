# SC-AU14-B1 场景 seed：真实作品 + 已采纳两章结构与正文，档案中的角色/规则/伏笔均为空。
# 外部 driver 从作品档案主动发起设定盘点；盘点只能读取这些 accepted 材料，未采纳候选
# 不得提前进入 Character / MemoryItem 权威投影。
alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.AdoptionRepository

chapter_lines = [
  "第01章：底层灵气账单: 沈砚发现灵气账单异常，并追查公司暗中抽走的频段。",
  "章功能定位：推进章",
  "情节推进：沈砚在停灵倒计时前核对账单，发现未知频段扣费",
  "人物变化：从麻木缴费者转为主动追查者",
  "信息释放：城市灵气由公司按频段计费，欠费后会被停灵",
  "伏笔动作：账单上的未知频段指向废弃旧服务器",
  "情绪定位：压抑中透出反抗",
  "章首拉力：停灵倒计时逼近",
  "章尾断章：未知频段留下旧服务器坐标",
  "字数与场次：约1200字，两场（对账/追查）",
  "第02章：旧服务器里的残诀: 云栖把缺失后半卷的残诀交给沈砚。",
  "章功能定位：推进章",
  "情节推进：沈砚抵达废弃机房，云栖交付残诀并警告公司追踪",
  "人物变化：沈砚第一次获得盟友",
  "信息释放：旧网络时代存在未被公司收编的修行数据",
  "伏笔动作：残诀缺失的后半卷去向未明",
  "情绪定位：紧张后的希望",
  "章首拉力：公司巡检逼近旧服务器",
  "章尾断章：残诀末页只剩半个调频师印记",
  "字数与场次：约1200字，两场（潜入/交付）"
]

{:ok, work} =
  WorkService.create(%{
    "title" => "AU14 设定盘点验收作品",
    "genre" => "赛博修仙",
    "core_selling_point" => "从已采纳正文反向整理作品里已经存在的设定",
    "target_reader" => "接手旧稿并需要补齐档案的作者",
    "tone_preference" => "克制、紧张、具象"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

{:ok, _plan} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_au14_chapter_plan_seed",
    artifact_id: "as_au14_chapter_plan_seed",
    artifact_type: :outline_draft,
    base_revision: 1,
    content: Enum.join(chapter_lines, "\n"),
    summary: "AU14 两章章节计划"
  })

accepted_prose = [
  {"第01章：底层灵气账单",
   "停灵倒计时只剩两个小时。沈砚逐行核对账单，发现公司把灵气按频段计费，欠费后会直接停灵。一笔未知频段扣费指向城西废弃的旧服务器，他决定在巡检到来前查清真相。"},
  {"第02章：旧服务器里的残诀", "沈砚潜入废弃机房，云栖从冷却柜后现身，把一部缺失后半卷的残诀交给他。残诀末页只剩半个调频师印记，后半卷的去向无人知晓，公司巡检的脚步却已逼近。"}
]

for {title, content} <- accepted_prose do
  {:ok, _prose} =
    AdoptionRepository.persist(%{
      actor_ref: "author",
      work_id: work.id,
      source_turn_ref: "turn_au14_prose_seed_#{title}",
      artifact_id: "as_au14_prose_seed_#{title}",
      artifact_type: :prose_fragment,
      base_revision: 1,
      content: content,
      summary: title
    })
end

IO.puts("[au14-fact-inventory-seed] work_id=#{work.id} session_id=#{session_id}")
