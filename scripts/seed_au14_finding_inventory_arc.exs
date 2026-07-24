# SC-AU14-A1 seed：真实作品已采纳 10 章、角色档案为空，且第 11 章已有计划。
# 驱动器从真实页面发起全书审读；主角缺位 finding、盘点、角色采纳与下一章弧光记账
# 均由产品主链完成。摘要只用于建立“已写满 N 章”的前置事实，不预制报告或账目。
import Ecto.Query

alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.{AdoptionRepository, Repo}
alias NovelPersistence.Schemas.{Chapter, ChapterSummary}

chapter_lines =
  Enum.flat_map(1..11, fn seq ->
    number = seq |> Integer.to_string() |> String.pad_leading(2, "0")
    title = if seq == 11, do: "频段反击", else: "账单追查 #{number}"

    [
      "第#{number}章：#{title}: 沈砚沿灵气账单追查公司暗抽频段的证据。",
      "章功能定位：推进章",
      "情节推进：沈砚核对第#{number}批账单并逼近暗抽频段的源头",
      "人物变化：沈砚从被动追查转为组织反击",
      "信息释放：公司通过未知频段抽走底层修士的灵气",
      "伏笔动作：残诀后半卷与旧服务器坐标继续互相印证",
      "情绪定位：紧张中积累反击力量",
      "章首拉力：新的停灵倒计时突然出现",
      "章尾断章：旧服务器回传一段未署名的调频记录",
      "字数与场次：约1200字，两场（核账/追踪）"
    ]
  end)

{:ok, work} =
  WorkService.create(%{
    "title" => "AU14 主角补全闭环验收作品",
    "genre" => "赛博修仙",
    "core_selling_point" => "从正文盘点实际主角并恢复弧光记账",
    "target_reader" => "先写后整理设定的长篇作者",
    "tone_preference" => "克制、紧张、具象",
    "target_length" => 120_000,
    "planned_volumes" => 4,
    "serial_form" => "SERIALIZED"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

{:ok, _plan} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_au14a_chapter_plan_seed",
    artifact_id: "as_au14a_chapter_plan_seed",
    artifact_type: :outline_draft,
    base_revision: 1,
    content: Enum.join(chapter_lines, "\n"),
    summary: "AU14 十一章章节计划"
  })

chapters =
  Repo.all(
    from(c in Chapter,
      where: c.work_id == ^work.id,
      order_by: [asc: c.seq]
    )
  )

for chapter <- Enum.take(chapters, 10) do
  number = chapter.seq |> Integer.to_string() |> String.pad_leading(2, "0")

  prose =
    "第#{number}章里，沈砚继续核对灵气账单。他发现公司把底层修士的灵气按频段计费，" <>
      "一笔未知扣费始终指向废弃旧服务器。云栖留下的残诀缺少后半卷，" <>
      "却让沈砚确认暗抽频段与调频师旧案有关。"

  {:ok, _prose} =
    AdoptionRepository.persist(%{
      actor_ref: "author",
      work_id: work.id,
      source_turn_ref: "turn_au14a_prose_seed_#{number}",
      artifact_id: "as_au14a_prose_seed_#{number}",
      artifact_type: :prose_fragment,
      base_revision: 1,
      content: prose,
      summary: chapter.title
    })

  %ChapterSummary{}
  |> ChapterSummary.changeset(%{
    work_id: work.id,
    chapter_id: to_string(chapter.id),
    status: "ACCEPTED",
    summary_text:
      "【情节推进】沈砚沿账单追查暗抽频段\n" <>
        "【人物状态与弧光】沈砚从被动核账转为主动追踪\n" <>
        "【伏笔动作】残诀后半卷与旧服务器坐标继续互证\n" <>
        "【情绪基调】紧张推进",
    source_ref: "seed:au14a:chapter:#{number}"
  })
  |> Repo.insert!()
end

IO.puts("[au14-finding-inventory-arc-seed] work_id=#{work.id} session_id=#{session_id}")
