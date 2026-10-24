defmodule NovelPersistence.ReadingProjectionRepo do
  @moduledoc """
  Read-model repository for AU-08 Reading Mode.

  目录（TOC）来源是当前作品**已采纳的卷/章结构**（AU08-I1：只有已采纳作品事实进投影；
  SC-AU08-B2：章可以在目录里但还没有已采纳正文 → 空章/待补足）。章节正文仍只来自
  accepted draft —— tentative 草稿是采纳候选，绝不进 TOC 或正文。
  """

  import Ecto.Query

  alias NovelDomain.ProseAudit
  alias NovelDomain.ProseWordCount
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.StructureStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.ChapterSummary
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.Scene
  alias NovelPersistence.Schemas.Volume
  alias NovelPersistence.Schemas.Work

  # 阅读视图按当前产品阶段（P1）审计正文有效字数。阶段阈值见
  # NovelDomain.NovelMilestone / docs/product/novel-output-milestones.md §3。
  @audit_stage :p1

  @spec toc(String.t()) ::
          %{
            work_id: String.t(),
            total_word_count: non_neg_integer(),
            audit: ProseAudit.work_audit(),
            planning_direction: map() | nil,
            volumes: [map()]
          }
  def toc(work_id) when is_binary(work_id) do
    case Ecto.UUID.cast(work_id) do
      {:ok, work_id} ->
        word_counts = word_counts_by_chapter(work_id)

        chapters =
          work_id
          |> structure_chapters()
          |> Enum.map(&Map.put(&1, :word_count, Map.get(word_counts, &1.id, 0)))

        volume_ids = chapters |> Enum.map(& &1.volume_id) |> Enum.uniq()
        volumes = volumes_by_id(work_id, volume_ids)

        rendered_volumes =
          volumes
          |> Enum.map(&volume_with_chapters(&1, chapters))
          |> Enum.reject(&(Map.get(&1, :chapters) == []))

        audit =
          rendered_volumes
          |> Enum.flat_map(& &1.chapters)
          |> Enum.map(& &1.word_count)
          |> ProseAudit.summarize(@audit_stage)

        %{
          work_id: work_id,
          total_word_count: audit.total_word_count,
          audit: audit,
          # WR01c：工作级规划使命随 TOC 进档案（大纲与结构 tab 顶部裁决块）。
          planning_direction: work_planning_direction(work_id),
          volumes: annotate_audit_status(rendered_volumes, audit.min_chapter_words)
        }

      :error ->
        %{
          work_id: work_id,
          total_word_count: 0,
          audit: ProseAudit.summarize([], @audit_stage),
          planning_direction: nil,
          volumes: []
        }
    end
  end

  defp work_planning_direction(work_id) do
    Work
    |> where([w], w.id == ^work_id)
    |> select([w], w.planning_direction)
    |> Repo.one()
    |> case do
      direction when is_map(direction) -> direction
      _ -> nil
    end
  end

  # 给每章附上审计状态（empty/short/ok），供阅读消费者标记短章/空章。
  defp annotate_audit_status(volumes, min_chapter_words) do
    Enum.map(volumes, &annotate_volume(&1, min_chapter_words))
  end

  defp annotate_volume(volume, min_chapter_words) do
    Map.update!(volume, :chapters, fn chapters ->
      Enum.map(chapters, &annotate_chapter(&1, min_chapter_words))
    end)
  end

  defp annotate_chapter(chapter, min_chapter_words) do
    status = ProseAudit.chapter_status(chapter.word_count, min_chapter_words)
    Map.put(chapter, :audit_status, status)
  end

  @spec chapter_content(String.t(), String.t()) ::
          {:ok,
           %{
             id: String.t(),
             title: String.t(),
             word_count: non_neg_integer(),
             scenes: [map()]
           }}
          | {:error, :not_found}
  def chapter_content(chapter_id, work_id) when is_binary(chapter_id) and is_binary(work_id) do
    with {:ok, chapter_id} <- Ecto.UUID.cast(chapter_id),
         {:ok, work_id} <- Ecto.UUID.cast(work_id),
         %Chapter{} = chapter <- get_chapter(chapter_id, work_id) do
      scenes = scenes_for_chapter(chapter.id, work_id)
      drafts_by_scene = accepted_drafts_by_scene(Enum.map(scenes, & &1.id), work_id)

      scene_views =
        Enum.map(scenes, fn scene ->
          %{
            id: scene.id,
            title: scene.title,
            content: drafts_by_scene |> Map.get(scene.id) |> draft_content()
          }
        end)

      {:ok,
       %{
         id: chapter.id,
         title: chapter.title,
         word_count: scene_views |> Enum.map(& &1.content) |> ProseWordCount.sum(),
         scenes: scene_views
       }}
    else
      _ -> {:error, :not_found}
    end
  end

  @doc """
  返回某章（`chapter_ref = "chapter:<chapters.id>"` 或章节标题）的已采纳正文：
  各场景取最新已采纳草稿，按场景顺序拼接。

  供续写/重写时把"本章已采纳正文"喂给 prose_writing，使其基于前文衔接（v2 28「基于前文」），
  而不是重复或从头另起。无匹配章节或无已采纳正文时返回 ""。

  B25（I-CH-1）：章节身份优先 ref（精确、改名稳定）；title 只在**唯一命中**时成立，
  同名多章返回 ""（歧义不猜），调用方应改用 ref。
  """
  @spec accepted_chapter_prose(String.t(), String.t()) :: String.t()
  def accepted_chapter_prose(work_id, chapter_identity)
      when is_binary(work_id) and is_binary(chapter_identity) do
    identity = String.trim(chapter_identity)

    with {:ok, work_uuid} <- Ecto.UUID.cast(work_id),
         false <- identity == "",
         {:ok, chapter} <- chapter_for_identity(work_uuid, identity) do
      chapter_accepted_prose(work_uuid, chapter)
    else
      _ -> ""
    end
  end

  def accepted_chapter_prose(_work_id, _chapter_identity), do: ""

  defp chapter_for_identity(work_uuid, "chapter:" <> uuid) do
    with {:ok, chapter_id} <- Ecto.UUID.cast(uuid),
         %Chapter{} = chapter <- get_chapter(chapter_id, work_uuid) do
      {:ok, chapter}
    else
      _ -> {:error, :not_found}
    end
  end

  defp chapter_for_identity(work_uuid, title) do
    case chapters_by_title(work_uuid, title) do
      [chapter] -> {:ok, chapter}
      _ -> {:error, :ambiguous_or_missing_title}
    end
  end

  defp chapter_accepted_prose(work_uuid, %Chapter{} = chapter) do
    scenes = scenes_for_chapter(chapter.id, work_uuid)
    drafts_by_scene = accepted_drafts_by_scene(Enum.map(scenes, & &1.id), work_uuid)

    scenes
    |> Enum.map(fn scene -> drafts_by_scene |> Map.get(scene.id) |> draft_content() end)
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n\n")
  end

  @doc """
  判断上下文「作品事实」投影（B27 CP4 M01/M16/M20）：按章返回当前采纳草稿事实。

  只读；只取当前 canon（Draft.status=ACCEPTED）与历史 SUPERSEDED 计数：
  - `word_count`：当前采纳正文有效字数（与阅读投影同源）
  - `accepted_draft_count` / `scene_count`：当前有采纳稿的场景数 / 场景总数
  - `current_draft_refs`：当前每场采纳稿的 `draft:<id>:<revision>`（最多 5 条）
  - `superseded_draft_count`：历史被替换稿数（明确不计入当前）
  - `chapter_status`：章结构状态（planned/drafting/…）
  - `summary_status` / `summary_revision_base`：当前章摘要状态（无则 nil）
  """
  @spec chapter_facts(String.t()) :: %{optional(String.t()) => map()}
  def chapter_facts(work_id) when is_binary(work_id) do
    case Ecto.UUID.cast(work_id) do
      {:ok, uuid} ->
        words = word_counts_by_chapter(uuid)

        chapters =
          Chapter
          |> where([c], c.work_id == ^uuid)
          |> select([c], %{id: c.id, status: c.status})
          |> Repo.all()

        scenes =
          Scene
          |> where([s], s.work_id == ^uuid)
          |> select([s], %{id: s.id, chapter_id: s.chapter_id})
          |> Repo.all()

        chapter_by_scene = Map.new(scenes, &{&1.id, &1.chapter_id})

        scene_counts =
          Enum.reduce(scenes, %{}, fn scene, acc ->
            Map.update(acc, scene.chapter_id, 1, &(&1 + 1))
          end)

        drafts =
          Draft
          |> where(
            [d],
            d.work_id == ^uuid and
              d.status in ^[AdoptionStatus.accepted(), AdoptionStatus.superseded()]
          )
          |> order_by([d], asc: d.scene_id, desc: d.revision)
          |> select([d], %{id: d.id, scene_id: d.scene_id, revision: d.revision, status: d.status})
          |> Repo.all()

        accepted_status = AdoptionStatus.accepted()
        superseded_status = AdoptionStatus.superseded()
        canon_summaries = [AdoptionStatus.accepted(), AdoptionStatus.edited_accepted()]

        summaries =
          ChapterSummary
          |> where([s], s.work_id == ^uuid and s.status in ^canon_summaries)
          |> order_by([s], desc: s.inserted_at)
          |> select([s], %{
            chapter_id: s.chapter_id,
            status: s.status,
            revision_base: s.revision_base
          })
          |> Repo.all()
          |> Enum.uniq_by(& &1.chapter_id)
          |> Map.new(&{&1.chapter_id, &1})

        Enum.reduce(chapters, %{}, fn chapter, acc ->
          chapter_drafts =
            Enum.filter(drafts, &(Map.get(chapter_by_scene, &1.scene_id) == chapter.id))

          accepted = Enum.filter(chapter_drafts, &(&1.status == accepted_status))
          superseded = Enum.filter(chapter_drafts, &(&1.status == superseded_status))
          summary = Map.get(summaries, chapter.id)

          refs =
            accepted
            |> Enum.take(5)
            |> Enum.map(&"draft:#{&1.id}:#{&1.revision}")

          Map.put(acc, to_string(chapter.id), %{
            word_count: Map.get(words, chapter.id, 0),
            accepted_draft_count: length(accepted),
            scene_count: Map.get(scene_counts, chapter.id, 0),
            current_draft_refs: refs,
            superseded_draft_count: length(superseded),
            chapter_status: chapter.status,
            summary_status: summary && summary.status,
            summary_revision_base: summary && summary.revision_base
          })
        end)

      :error ->
        %{}
    end
  end

  def chapter_facts(_work_id), do: %{}

  @doc """
  设定盘点材料读端口（VS-00G CP4b-2）。

  优先读取整部作品当前 ACCEPTED 章摘要（按章节顺序、每章最新一条），让长篇盘点覆盖全书且
  保持上下文有界；旧作品若尚无章摘要，则回退前 12 章已采纳正文。tentative 正文与历史
  superseded 摘要都不进入材料。
  """
  @spec fact_inventory_materials(String.t()) :: [
          %{seq: non_neg_integer(), title: String.t(), prose: String.t()}
        ]
  # D5（M5 考据反转）：原实现 all-or-nothing——只要有任一章摘要就整表用摘要，
  # 缺摘要的章被整章丢出材料（部分断供时盘点对那些章失明）。改逐章混合：
  # 每章摘要优先、缺失章回退该章正文（截断在 service prompt 层）。
  def fact_inventory_materials(work_id) when is_binary(work_id) do
    case Ecto.UUID.cast(work_id) do
      {:ok, work_uuid} ->
        summaries =
          work_uuid
          |> current_summary_materials()
          |> Map.new(&{&1.seq, &1})

        work_uuid
        |> prose_fallback_materials()
        |> Enum.map(fn prose_material ->
          Map.get(summaries, prose_material.seq, prose_material)
        end)
        |> case do
          [] -> Map.values(summaries) |> Enum.sort_by(& &1.seq)
          merged -> merged
        end

      :error ->
        []
    end
  end

  def fact_inventory_materials(_work_id), do: []

  defp chapters_by_title(work_uuid, title) do
    Chapter
    |> where([c], c.work_id == ^work_uuid and c.title == ^title)
    |> order_by([c], asc: c.seq)
    |> Repo.all()
  end

  defp current_summary_materials(work_uuid) do
    accepted = AdoptionStatus.accepted()

    ChapterSummary
    |> join(:inner, [summary], chapter in Chapter, on: chapter.id == summary.chapter_id)
    |> where(
      [summary, chapter],
      summary.work_id == ^work_uuid and chapter.work_id == ^work_uuid and
        summary.status == ^accepted
    )
    |> order_by([summary, chapter], asc: chapter.seq, desc: summary.inserted_at)
    |> select([summary, chapter], %{
      chapter_id: chapter.id,
      seq: chapter.seq,
      title: chapter.title,
      prose: summary.summary_text
    })
    |> Repo.all()
    |> Enum.uniq_by(& &1.chapter_id)
    |> Enum.map(&Map.delete(&1, :chapter_id))
  end

  defp prose_fallback_materials(work_uuid) do
    work_uuid
    |> structure_chapters()
    |> Enum.take(12)
    |> Enum.map(fn chapter ->
      %{
        seq: chapter.seq,
        title: chapter.title,
        prose: accepted_chapter_prose(work_uuid, "chapter:#{chapter.id}")
      }
    end)
    |> Enum.reject(&(String.trim(&1.prose) == ""))
  end

  # 目录按已采纳的卷/章结构展示（含还没有正文的计划章，SC-AU08-B2）。
  # 已归档章不展示。每章有效字数由 word_counts_by_chapter 叠加（无正文则为 0）。
  defp structure_chapters(work_id) do
    archived = StructureStatus.archived()

    Chapter
    |> where([c], c.work_id == ^work_id and c.status != ^archived)
    |> order_by([c], asc: c.volume_id, asc: c.seq)
    |> select([c], %{
      id: c.id,
      volume_id: c.volume_id,
      title: c.title,
      seq: c.seq,
      summary: c.summary,
      plan_direction: c.plan_direction
    })
    |> Repo.all()
  end

  defp volumes_by_id(_work_id, []), do: []

  # 目录卷节点暴露卷级蓝图（B11A CP1 / VS-00J §4 消费面）：`blueprint` 为 nil 时前端
  # 只读块不渲染（I-VOL-4 退化等价）；蓝图是设计态，不改章归属与字数事实。
  defp volumes_by_id(work_id, volume_ids) do
    Volume
    |> where([v], v.work_id == ^work_id and v.id in ^volume_ids)
    |> order_by([v], asc: v.seq)
    |> select([v], %{id: v.id, title: v.title, seq: v.seq, blueprint: v.blueprint})
    |> Repo.all()
  end

  defp volume_with_chapters(%{} = volume, chapters) do
    volume_chapters =
      chapters
      |> Enum.filter(&(&1.volume_id == volume.id))
      |> Enum.sort_by(& &1.seq)
      |> Enum.map(&Map.take(&1, [:id, :title, :seq, :word_count, :summary, :plan_direction]))

    Map.put(volume, :chapters, volume_chapters)
  end

  # 每章有效字数：以"阅读模式实际展示的内容"为准——每个 scene 取最新已采纳草稿，
  # 与 chapter_content/2 的选取规则一致。未采纳草稿不计入字数事实（§7 #11）。
  defp word_counts_by_chapter(work_id) do
    scene_to_chapter =
      Scene
      |> where([s], s.work_id == ^work_id)
      |> select([s], %{id: s.id, chapter_id: s.chapter_id})
      |> Repo.all()
      |> Map.new(&{&1.id, &1.chapter_id})

    scene_to_chapter
    |> Map.keys()
    |> accepted_drafts_by_scene(work_id)
    |> Enum.reduce(%{}, fn {scene_id, draft}, acc ->
      chapter_id = Map.get(scene_to_chapter, scene_id)
      words = ProseWordCount.count(draft.content)
      Map.update(acc, chapter_id, words, &(&1 + words))
    end)
  end

  defp get_chapter(chapter_id, work_id) do
    Chapter
    |> where([c], c.id == ^chapter_id and c.work_id == ^work_id)
    |> Repo.one()
  end

  defp scenes_for_chapter(chapter_id, work_id) do
    Scene
    |> where([s], s.chapter_id == ^chapter_id and s.work_id == ^work_id)
    |> order_by([s], asc: s.seq)
    |> select([s], %{id: s.id, title: s.title, seq: s.seq})
    |> Repo.all()
  end

  defp accepted_drafts_by_scene([], _work_id), do: %{}

  defp accepted_drafts_by_scene(scene_ids, work_id) do
    accepted = AdoptionStatus.accepted()

    Draft
    |> where([d], d.work_id == ^work_id and d.scene_id in ^scene_ids and d.status == ^accepted)
    |> order_by([d], asc: d.scene_id, desc: d.revision, desc: d.updated_at)
    |> Repo.all()
    |> Enum.reduce(%{}, fn draft, acc -> Map.put_new(acc, draft.scene_id, draft) end)
  end

  defp draft_content(nil), do: ""
  defp draft_content(%Draft{content: content}), do: content
end
