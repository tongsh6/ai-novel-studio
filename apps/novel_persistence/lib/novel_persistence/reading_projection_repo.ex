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
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.Scene
  alias NovelPersistence.Schemas.Volume

  # 阅读视图按当前产品阶段（P1）审计正文有效字数。阶段阈值见
  # NovelDomain.NovelMilestone / docs/product/novel-output-milestones.md §3。
  @audit_stage :p1

  @spec toc(String.t()) ::
          %{
            work_id: String.t(),
            total_word_count: non_neg_integer(),
            audit: ProseAudit.work_audit(),
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
          volumes: annotate_audit_status(rendered_volumes, audit.min_chapter_words)
        }

      :error ->
        %{
          work_id: work_id,
          total_word_count: 0,
          audit: ProseAudit.summarize([], @audit_stage),
          volumes: []
        }
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
  返回某章（按 work_id + 章节标题匹配）的已采纳正文：各场景取最新已采纳草稿，按场景顺序拼接。

  供续写/重写时把"本章已采纳正文"喂给 prose_writing，使其基于前文衔接（v2 28「基于前文」），
  而不是重复或从头另起。无匹配章节或无已采纳正文时返回 ""。口径与 `chapter_content/2` 一致
  （仅已采纳、每场景最新版本），与采纳层章节身份（同 work、同 title）对齐。
  """
  @spec accepted_chapter_prose(String.t(), String.t()) :: String.t()
  def accepted_chapter_prose(work_id, chapter_title)
      when is_binary(work_id) and is_binary(chapter_title) do
    title = String.trim(chapter_title)

    with {:ok, work_uuid} <- Ecto.UUID.cast(work_id),
         false <- title == "",
         %Chapter{} = chapter <- get_chapter_by_title(work_uuid, title) do
      scenes = scenes_for_chapter(chapter.id, work_uuid)
      drafts_by_scene = accepted_drafts_by_scene(Enum.map(scenes, & &1.id), work_uuid)

      scenes
      |> Enum.map(fn scene -> drafts_by_scene |> Map.get(scene.id) |> draft_content() end)
      |> Enum.reject(&(&1 == ""))
      |> Enum.join("\n\n")
    else
      _ -> ""
    end
  end

  def accepted_chapter_prose(_work_id, _chapter_title), do: ""

  defp get_chapter_by_title(work_uuid, title) do
    Chapter
    |> where([c], c.work_id == ^work_uuid and c.title == ^title)
    |> order_by([c], asc: c.seq)
    |> limit(1)
    |> Repo.one()
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
      summary: c.summary
    })
    |> Repo.all()
  end

  defp volumes_by_id(_work_id, []), do: []

  defp volumes_by_id(work_id, volume_ids) do
    Volume
    |> where([v], v.work_id == ^work_id and v.id in ^volume_ids)
    |> order_by([v], asc: v.seq)
    |> select([v], %{id: v.id, title: v.title, seq: v.seq})
    |> Repo.all()
  end

  defp volume_with_chapters(volume, chapters) do
    volume_chapters =
      chapters
      |> Enum.filter(&(&1.volume_id == volume.id))
      |> Enum.sort_by(& &1.seq)
      |> Enum.map(&Map.take(&1, [:id, :title, :seq, :word_count, :summary]))

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
