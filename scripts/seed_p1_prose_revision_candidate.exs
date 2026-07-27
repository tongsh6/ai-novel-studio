alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.AdoptionRepository

# VS-00E CP3 真实页面验收种子：章节计划中第 02 章是“短促动作追击”场面章。该章方向里的
# 「短促 / 动作 / 追击」语义会进入正文请求上下文，使离线 provider（slice_verify）确定性地
# 写出句首雷同的短促动作段。产品侧形式分析器只召回候选，独立 evaluator 再确认机械重复。
# 第 03 章复刻“同形式但属于刻意修辞”的抑制边界；第 04 章复刻“形式不雷同但章功能与实际
# 推进失配”的章节节奏边界。三者从同一真实正文入口验证三段质量链。
chapter_plan = """
第01章：底层灵气账单: 主角在欠费停灵的夜晚发现灵气带宽被公司暗中抽走。
第02章：矿区追击战: 主角在废弃矿区遭遇巡检傀儡，短促的动作追击中且战且退。
章功能定位：动作章
情节推进：主角在矿区被巡检傀儡短促追击，动作打斗中夺路而逃
人物变化：主角第一次直面公司武力
信息释放：傀儡身上的编号指向公司矿区黑账
伏笔动作：傀儡核心残留一枚阵钉
情绪定位：紧张急促的动作压迫
第03章：誓词回环: 主角用三句递进誓词确认活着、回去、雪耻，进行刻意排比演练。
第04章：静室失速: 章节节奏错配演练；主角本应争夺黑账证据，正文却停留在静态环境。
章功能定位：主线推进章
情节推进：主角必须从交易所密室夺回黑账证据并公开关键编号
人物变化：主角从观望转为主动承担公开真相的风险
信息释放：黑账编号揭示矿区抽成流向
伏笔动作：证据页角留下调频师的暗号
情绪定位：从潜入压迫升级为夺证后的短暂释放
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
