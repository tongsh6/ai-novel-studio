alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.AdoptionRepository

# VS-00E CP3 真实页面验收种子：章节计划中第 02 章是“短促动作追击”场面章。该章方向里的
# 「短促 / 动作 / 追击」语义会进入正文请求上下文，使离线 provider（slice_verify）确定性地
# 写出节奏单调、句首雷同的短促动作段——这是“模型写出了节奏单调动作戏”的真实复刻。
# 产品侧确定性 validator 会如实命中 prose_pattern_repetition，作者据此可走 revise_from_findings。
# 其它章保持普通摘要，不触发质量发现。
chapter_plan = """
第01章：底层灵气账单: 主角在欠费停灵的夜晚发现灵气带宽被公司暗中抽走。
第02章：矿区追击战: 主角在废弃矿区遭遇巡检傀儡，短促的动作追击中且战且退。
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
    "title" => "VS-00E 修订候选验证作品",
    "genre" => "赛博修仙",
    "core_selling_point" => "质量发现后按问题重写为修订候选草稿",
    "target_reader" => "关注正文质量闭环的作者",
    "tone_preference" => "克制、紧张、具象"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

{:ok, persisted} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_vs00e_cp3_plan_seed",
    artifact_id: "as_vs00e_cp3_plan_seed",
    artifact_type: :outline_draft,
    base_revision: 1,
    content: String.trim(chapter_plan),
    summary: "VS-00E CP3 含动作章的章节计划"
  })

IO.puts(
  "[p1-prose-revision-candidate-seed] work_id=#{work.id} session_id=#{session_id} memory_item_id=#{persisted.memory_item_id}"
)
