alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.AdoptionRepository

# VS-00E CP2 真实页面验收种子（evaluator 降级）：第 02 章摘要里带一个中文降级标记
# 「评审故障演练」。该摘要会进入正文写作的 execution_brief，进而进入独立质量 evaluator 的
# 评审 prompt；离线 evaluator（slice_verify）识别该标记后返回非法 JSON、两次解析失败，
# 复现“质量评审未能完成”的诚实降级。中文标记不会被 opening_body 的随机标识符回显，所以
# 用户可见正文保持干净，不出现该标记。其它章为普通摘要、评审正常完成。
chapter_plan = """
第01章：底层灵气账单: 主角在欠费停灵的夜晚发现灵气带宽被公司暗中抽走。
第02章：评审降级章: 主角在矿区调查欠费黑账，逐步逼近公司旧实验。评审故障演练。
第03章：黑市调频师: 主角结识能改写灵气频段的调频师。
"""

{:ok, work} =
  WorkService.create(%{
    "title" => "VS-00E 评审降级验证作品",
    "genre" => "赛博修仙",
    "core_selling_point" => "质量评审失败时诚实降级，绝不伪装通过",
    "target_reader" => "关注正文质量闭环的作者",
    "tone_preference" => "克制、紧张、具象"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

{:ok, persisted} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_vs00e_degrade_plan_seed",
    artifact_id: "as_vs00e_degrade_plan_seed",
    artifact_type: :outline_draft,
    base_revision: 1,
    content: String.trim(chapter_plan),
    summary: "VS-00E CP2 含评审降级章的章节计划"
  })

IO.puts(
  "[p1-prose-quality-evaluator-degrade-seed] work_id=#{work.id} session_id=#{session_id} memory_item_id=#{persisted.memory_item_id}"
)
