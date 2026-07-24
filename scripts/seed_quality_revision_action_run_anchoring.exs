alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.AdoptionRepository

# UA-01 / VS-00E 外部验收种子。`UA01CP6SLOW` 只被 test/support provider 识别，
# 用来制造可由真实页面暂停、刷新并继续的 provider 窗口；生产运行时不感知该标记。
chapter_plan = """
第01章：底层灵气账单: 主角在欠费停灵的夜晚发现灵气带宽被公司暗中抽走。
第02章：矿区追击战: 主角在废弃矿区遭遇巡检傀儡，短促的动作追击中且战且退。UA01CP6SLOW
章功能定位：动作章
情节推进：主角在矿区被巡检傀儡短促追击，动作打斗中夺路而逃
人物变化：主角第一次直面公司武力
信息释放：傀儡身上的编号指向公司矿区黑账
伏笔动作：傀儡核心残留一枚阵钉
情绪定位：紧张急促的动作压迫
第03章：黑市调频师: 主角结识能改写灵气频段的调频师。
"""

{:ok, work} =
  WorkService.create(%{
    "title" => "质量修订任务锚定验证作品",
    "genre" => "赛博修仙",
    "core_selling_point" => "质量修订动作、运行状态和候选边界保持单一可追踪链路",
    "target_reader" => "需要审阅原稿与修订稿的作者",
    "tone_preference" => "克制、紧张、具象"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

{:ok, persisted} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_quality_revision_anchor_plan_seed",
    artifact_id: "as_quality_revision_anchor_plan_seed",
    artifact_type: :outline_draft,
    base_revision: 1,
    content: String.trim(chapter_plan),
    summary: "质量修订动作运行锚定验收章节计划"
  })

IO.puts(
  "[quality-revision-action-run-anchoring-seed] work_id=#{work.id} session_id=#{session_id} memory_item_id=#{persisted.memory_item_id}"
)
