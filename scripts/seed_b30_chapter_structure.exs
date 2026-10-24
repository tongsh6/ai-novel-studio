import Ecto.Query

alias NovelApplication.{WorkService, WorkSessionService}
alias NovelFoundation.Enums.AdoptionStatus
alias NovelPersistence.{AdoptionRepository, Repo}
alias NovelPersistence.Schemas.{Chapter, ChapterSummary, Draft, Scene, Volume}

# B30 CP0：章节结构维护/卷蓝图边界的隔离种子。
# work A：两卷结构（第一卷 1 章 planned；第二卷 3 章各带 accepted 正文与章摘要，
#   章标题里写「第11/12/13章」但真实 seq 为 3/4/5——复现标题编号、真实 seq、卷/章类型
#   混为一体的历史条件；正文/摘要用于观察维护请求是否改动内容与下游引用）。
# work B：AU08 同款「只有全书骨架、无卷/章行」作品，用于真实页面规划卷章/规划下一卷，
#   观察卷蓝图是否被物化为 Chapter/占 seq。
alias NovelPersistence.Schemas.ChapterSummary

create_work = fn title, planned_volumes ->
  {:ok, work} =
    WorkService.create(%{
      "title" => title,
      "genre" => "雨港悬疑",
      "core_selling_point" => "章节结构维护与卷蓝图类型边界",
      "target_reader" => "追更长篇的连载读者",
      "tone_preference" => "克制、潮湿",
      "target_length" => 60_000,
      "planned_volumes" => planned_volumes,
      "serial_form" => "SERIALIZED"
    })

  {:ok, snapshot} = WorkSessionService.resume(work.id)
  {work, snapshot.active_session.id}
end

# ── work A：既有两卷结构 ─────────────────────────────────────────────────────
{work_a, session_a} = create_work.("B30 章节重编号复现作品", 2)

volume1 =
  Repo.insert!(%Volume{
    work_id: work_a.id,
    title: "第一卷",
    seq: 1,
    status: "PLANNED"
  })

volume2 =
  Repo.insert!(%Volume{
    work_id: work_a.id,
    title: "第二卷",
    seq: 2,
    status: "PLANNED"
  })

_volume1_chapter =
  Repo.insert!(%Chapter{
    work_id: work_a.id,
    volume_id: volume1.id,
    title: "第01章：潮声之前",
    seq: 1,
    status: "PLANNED"
  })

chapter_specs = [
  {"第11章：外门名册上的空白", 3, "门册空白锚点：名册第七页留着一枚被水洇开的空白。", "外门名册、空白页、守门人"},
  {"第12章：旧钱与旧名", 4, "旧钱锚点：铜钱背面刻着不属于这个时代的年号。", "旧钱、旧年号、钱庄"},
  {"第13章：账外的名字", 5, "账外锚点：账本夹层里多出一个从未出现过的名字。", "旧账夹层、陌生名字、账房"}
]

chapter_seed_rows =
  Enum.map(chapter_specs, fn {title, seq, prose, summary} ->
    chapter =
      Repo.insert!(%Chapter{
        work_id: work_a.id,
        volume_id: volume2.id,
        title: title,
        seq: seq,
        status: "DRAFTING",
        summary: summary
      })

    scene =
      Repo.insert!(%Scene{
        work_id: work_a.id,
        chapter_id: chapter.id,
        title: "场景 1",
        seq: 1
      })

    _draft =
      Repo.insert!(%Draft{
        work_id: work_a.id,
        scene_id: scene.id,
        content: prose <> "（本章正文 " <> Integer.to_string(seq) <> "）",
        status: AdoptionStatus.accepted(),
        revision: 2
      })

    _summary =
      Repo.insert!(%ChapterSummary{
        work_id: work_a.id,
        chapter_id: chapter.id,
        status: "ACCEPTED",
        summary_text: "【情节推进】#{summary}",
        source_ref: "seed:#{chapter.id}",
        revision_base: "draft-seed"
      })

    chapter
  end)

# ── work B：AU08 同款全骨架、无卷/章行 ───────────────────────────────────────
{work_b, session_b} = create_work.("B30 卷蓝图复现作品", 2)

# ── work C：非法混排 harness（B30 CP2 type_mismatch 边界）────────────────────
# 直接走持久层 outline 采纳（真实入口之外的 seed harness，仅构造类型边界证据）：
# 章块标题含「卷蓝图」→ ensure_planned_chapter 必须 type_mismatch 整体回滚，
# 不得静默物化成 Chapter/占 seq。
{work_c, session_c} = create_work.("B30 卷蓝图混排边界作品", 1)

type_mismatch_content = """
第01章：正常开篇章
所属卷：第一卷
章功能定位：推进章
情节推进：正常开篇
第02章：卷蓝图
所属卷：第一卷
章功能定位：推进章
情节推进：蓝图行混入章块
"""

type_mismatch_result =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work_c.id,
    source_turn_ref: "turn_b30_type_mismatch_seed",
    artifact_id: "as_b30_type_mismatch_seed",
    artifact_type: :outline_draft,
    base_revision: 1,
    content: type_mismatch_content,
    summary: "B30 混排章块"
  })

type_mismatch_chapter_count =
  Repo.aggregate(from(c in Chapter, where: c.work_id == ^work_c.id), :count)

type_mismatch_volume_count =
  Repo.aggregate(from(v in Volume, where: v.work_id == ^work_c.id), :count)

type_mismatch_reason =
  case type_mismatch_result do
    {:error, reason} -> to_string(reason)
    _ -> "none"
  end

IO.puts(
  "[b30-chapter-structure-seed] work_c_id=#{work_c.id} session_c_id=#{session_c} " <>
    "type_mismatch_reason=#{type_mismatch_reason} " <>
    "type_mismatch_chapter_count=#{type_mismatch_chapter_count} " <>
    "type_mismatch_volume_count=#{type_mismatch_volume_count}"
)

IO.puts(
  "[b30-chapter-structure-seed] work_a_id=#{work_a.id} session_a_id=#{session_a} " <>
    "volume1_id=#{volume1.id} volume2_id=#{volume2.id} " <>
    "chapter_ids=#{Enum.map_join(chapter_seed_rows, ",", & &1.id)} " <>
    "work_b_id=#{work_b.id} session_b_id=#{session_b} " <>
    "chapter_count=#{length(chapter_seed_rows) + 1} work_b_chapter_count=0"
)
