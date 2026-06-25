alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.AdoptionRepository

# VS-00E CP1 真实页面验收种子：章节计划中第 02 章带 E18–E22 结构化方向标签，
# 经 ChapterPlanParser 解析后 plan_direction 被物化到 chapters，使
# ProseExecutionBriefBuilder 走「确定性投影」而非降级路径。其它章保持纯摘要。
chapter_plan = """
第01章：底层灵气账单: 主角在欠费停灵的夜晚发现灵气带宽被公司暗中抽走。
第02章：旧服务器里的残诀: 主角从废弃服务器中找到残缺功法。
章功能定位：铺垫章
情节推进：主角进入旧服务器并发现残缺功法
人物变化：主角第一次主动冒险
信息释放：残诀来源指向公司旧实验
伏笔动作：残诀尾页缺失
情绪定位：紧张中带兴奋
第03章：黑市调频师: 主角结识能改写灵气频段的调频师。
"""

{:ok, work} =
  WorkService.create(%{
    "title" => "VS-00E 场级执行简述验证作品",
    "genre" => "赛博修仙",
    "core_selling_point" => "章方向展开为场级执行简述并进入正文生成",
    "target_reader" => "关注正文质量闭环的作者",
    "tone_preference" => "克制、紧张、具象"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

{:ok, persisted} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_vs00e_cp1_plan_seed",
    artifact_id: "as_vs00e_cp1_plan_seed",
    artifact_type: :outline_draft,
    base_revision: 1,
    content: String.trim(chapter_plan),
    summary: "VS-00E CP1 结构化章方向计划"
  })

IO.puts(
  "[p1-prose-execution-brief-seed] work_id=#{work.id} session_id=#{session_id} memory_item_id=#{persisted.memory_item_id}"
)
