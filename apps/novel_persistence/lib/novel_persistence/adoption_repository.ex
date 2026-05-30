defmodule NovelPersistence.AdoptionRepository do
  @moduledoc """
  Persistence boundary for accepted artifact adoption.

  AU-05 requires adoption to leave a durable state consequence. This repository
  records the accepted author action as an applied mutation and stores the
  adopted creative fact as a confirmed memory item scoped to the current work.
  """

  alias Ecto.Multi
  import Ecto.Query

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.MemoryScope
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelFoundation.Enums.SourceType
  alias NovelFoundation.Enums.StructureStatus
  alias NovelFoundation.ID
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.Schemas.Mutation
  alias NovelPersistence.Schemas.Scene
  alias NovelPersistence.Schemas.Volume

  @spec writer() :: function()
  def writer do
    &persist/1
  end

  @spec persist(map()) :: {:ok, map()} | {:error, term()}
  def persist(attrs) when is_map(attrs) do
    mutation_attrs = mutation_attrs(attrs)

    Multi.new()
    |> Multi.insert(
      :mutation,
      Mutation.changeset(%Mutation{}, mutation_attrs) |> Mutation.apply_changeset()
    )
    |> Multi.insert(:memory_item, fn %{mutation: mutation} ->
      MemoryItem.changeset(%MemoryItem{}, memory_item_attrs(attrs, mutation.id))
    end)
    |> Multi.run(:reading_projection, fn repo, %{mutation: mutation} ->
      maybe_persist_reading_projection(repo, attrs, mutation.id)
    end)
    |> Repo.transaction()
    |> case do
      {:ok,
       %{mutation: mutation, memory_item: memory_item, reading_projection: reading_projection}} ->
        {:ok,
         %{
           mutation_id: mutation.id,
           mutation_status: mutation.status,
           memory_item_id: memory_item.id,
           memory_status: memory_item.status,
           source_revision_ref: "mutation:#{mutation.id}",
           reading_projection: reading_projection
         }}

      {:error, _step, reason, _changes} ->
        {:error, reason}
    end
  end

  defp mutation_attrs(attrs) do
    %{
      actor_ref: Map.fetch!(attrs, :actor_ref),
      source_turn_ref: Map.fetch!(attrs, :source_turn_ref),
      target_scope: "work:#{Map.fetch!(attrs, :work_id)}",
      target_object_ref: Map.fetch!(attrs, :artifact_id),
      base_revision: Map.get(attrs, :base_revision, 1),
      mutation_type: "adopt_artifact",
      proposed_change_ref: Map.fetch!(attrs, :artifact_id),
      authority_scope: "author_confirmed_adoption",
      requires_adoption: false
    }
  end

  defp memory_item_attrs(attrs, mutation_id) do
    %{
      id: ID.uuid(),
      work_id: Map.fetch!(attrs, :work_id),
      content: Map.fetch!(attrs, :content),
      summary: Map.get(attrs, :summary),
      type: memory_type(Map.get(attrs, :artifact_type)),
      scope: MemoryScope.work(),
      status: MemoryStatus.confirmed(),
      source_type: MemorySourceType.author_confirmed(),
      source_id: mutation_id,
      weight: Decimal.new("0.8000"),
      confidence: Decimal.new("0.9000"),
      source_confidence: Decimal.new("1.0000"),
      locked: true,
      recallable: true,
      tags: ["adopted_artifact", to_string(Map.get(attrs, :artifact_type, SourceType.artifact()))]
    }
  end

  defp memory_type(:character_seed), do: MemoryType.character_profile()
  defp memory_type("character_seed"), do: MemoryType.character_profile()
  defp memory_type(:plot_direction), do: MemoryType.plot_fact()
  defp memory_type("plot_direction"), do: MemoryType.plot_fact()
  defp memory_type(:outline_draft), do: MemoryType.draft_context()
  defp memory_type("outline_draft"), do: MemoryType.draft_context()
  defp memory_type(_), do: MemoryType.draft_context()

  defp maybe_persist_reading_projection(repo, attrs, mutation_id) do
    if reading_projection_artifact?(Map.get(attrs, :artifact_type)) do
      persist_reading_projection(repo, attrs, mutation_id)
    else
      {:ok, nil}
    end
  end

  defp reading_projection_artifact?(:scene_draft), do: true
  defp reading_projection_artifact?("scene_draft"), do: true
  defp reading_projection_artifact?(:prose_fragment), do: true
  defp reading_projection_artifact?("prose_fragment"), do: true
  defp reading_projection_artifact?(_), do: false

  # 同 title 的正文采纳落到同一卷/章/场景（章节身份）：覆盖时 supersede 旧 accepted
  # 草稿，再写新 accepted 草稿。这样阅读投影同一章显示最新正文，而不是堆出重复章。
  defp persist_reading_projection(repo, attrs, mutation_id) do
    work_id = Map.fetch!(attrs, :work_id)
    title = projection_title(attrs)
    content = projection_content(attrs)

    with {:ok, volume} <- find_or_create_accepted_volume(repo, work_id),
         {:ok, chapter} <- find_or_create_chapter(repo, work_id, volume.id, title),
         {:ok, scene} <- find_or_create_scene(repo, work_id, chapter.id, title),
         :ok <- supersede_accepted_drafts(repo, work_id, scene.id),
         {:ok, draft} <-
           insert_draft(repo, %{
             work_id: work_id,
             scene_id: scene.id,
             content: content,
             status: AdoptionStatus.accepted(),
             revision: next_draft_revision(repo, scene.id)
           }) do
      {:ok,
       %{
         volume_id: volume.id,
         chapter_id: chapter.id,
         scene_id: scene.id,
         draft_id: draft.id,
         source_revision_ref: "draft:#{draft.id}:#{draft.revision}",
         mutation_id: mutation_id
       }}
    end
  end

  @doc """
  读端口：当前作品是否已有「同 title 且含已采纳正文」的章节。
  采纳边界用它判断是否为覆盖已有 canon（需作者确认）。
  """
  @spec has_accepted_chapter?(String.t(), String.t()) :: boolean()
  def has_accepted_chapter?(work_id, title) when is_binary(work_id) and is_binary(title) do
    case Ecto.UUID.cast(work_id) do
      {:ok, uuid} ->
        accepted = AdoptionStatus.accepted()
        normalized = canonical_chapter_title(title)

        Chapter
        |> join(:inner, [c], s in Scene, on: s.chapter_id == c.id and s.work_id == ^uuid)
        |> join(:inner, [_c, s], d in Draft,
          on: d.scene_id == s.id and d.work_id == ^uuid and d.status == ^accepted
        )
        |> where([c], c.work_id == ^uuid and c.title == ^normalized)
        |> Repo.exists?()

      :error ->
        false
    end
  end

  def has_accepted_chapter?(_work_id, _title), do: false

  @doc "读端口工厂：注入 AdoptionWorkflow 判断覆盖。"
  @spec overwrite_reader() :: (String.t(), String.t() -> boolean())
  def overwrite_reader, do: &has_accepted_chapter?/2

  defp find_or_create_accepted_volume(repo, work_id) do
    Volume
    |> where([v], v.work_id == ^work_id and v.title == "已采纳内容")
    |> order_by([v], asc: v.seq)
    |> limit(1)
    |> repo.one()
    |> case do
      nil ->
        insert_volume(repo, %{
          work_id: work_id,
          title: "已采纳内容",
          seq: next_volume_seq(repo, work_id)
        })

      volume ->
        {:ok, volume}
    end
  end

  # 章节身份按 (work_id, title) 跨卷匹配，与覆盖检测 has_accepted_chapter?/2 一致：
  # 旧代码每次采纳建新「已采纳内容」卷，遗留同名章会散落在多卷，按 title 跨卷查能复用并
  # 就地覆盖，不再堆出重复章（A3）。新章才落到当前规范卷。
  defp find_or_create_chapter(repo, work_id, volume_id, title) do
    Chapter
    |> where([c], c.work_id == ^work_id and c.title == ^title)
    |> order_by([c], asc: c.seq)
    |> limit(1)
    |> repo.one()
    |> case do
      nil ->
        insert_chapter(repo, %{
          work_id: work_id,
          volume_id: volume_id,
          title: title,
          seq: next_chapter_seq(repo, volume_id)
        })

      chapter ->
        {:ok, chapter}
    end
  end

  # 场景身份按 (work_id, chapter_id, title) 匹配：同章同 title 复用同场景并就地覆盖；
  # 多场景章不会误 supersede 别的场景（A6）。单场景模型下与原行为一致。
  defp find_or_create_scene(repo, work_id, chapter_id, title) do
    Scene
    |> where([s], s.work_id == ^work_id and s.chapter_id == ^chapter_id and s.title == ^title)
    |> order_by([s], asc: s.seq)
    |> limit(1)
    |> repo.one()
    |> case do
      nil -> insert_scene(repo, %{work_id: work_id, chapter_id: chapter_id, title: title, seq: 1})
      scene -> {:ok, scene}
    end
  end

  defp supersede_accepted_drafts(repo, work_id, scene_id) do
    accepted_statuses = [AdoptionStatus.accepted(), AdoptionStatus.edited_accepted()]

    Draft
    |> where(
      [d],
      d.work_id == ^work_id and d.scene_id == ^scene_id and d.status in ^accepted_statuses
    )
    |> repo.update_all(set: [status: AdoptionStatus.superseded(), updated_at: DateTime.utc_now()])

    :ok
  end

  defp next_draft_revision(repo, scene_id) do
    (Draft |> where([d], d.scene_id == ^scene_id) |> repo.aggregate(:max, :revision) || 0) + 1
  end

  # 下一个 seq 用 max(seq)+1（非 count+1）：删行后也不会和现存 seq 撞（A5）。
  defp next_chapter_seq(repo, volume_id) do
    (Chapter |> where([c], c.volume_id == ^volume_id) |> repo.aggregate(:max, :seq) || 0) + 1
  end

  defp next_volume_seq(repo, work_id) do
    (Volume |> where([v], v.work_id == ^work_id) |> repo.aggregate(:max, :seq) || 0) + 1
  end

  defp insert_volume(repo, attrs) do
    %Volume{}
    |> Volume.changeset(Map.put(attrs, :status, StructureStatus.completed()))
    |> repo.insert()
  end

  defp insert_chapter(repo, attrs) do
    %Chapter{}
    |> Chapter.changeset(Map.put(attrs, :status, StructureStatus.completed()))
    |> repo.insert()
  end

  defp insert_scene(repo, attrs) do
    %Scene{}
    |> Scene.changeset(Map.put(attrs, :status, StructureStatus.completed()))
    |> repo.insert()
  end

  defp insert_draft(repo, attrs) do
    %Draft{}
    |> Draft.changeset(Map.put_new(attrs, :revision, 1))
    |> repo.insert()
  end

  defp projection_title(attrs) do
    canonical_chapter_title(Map.get(attrs, :summary))
  end

  # 章节标题归一：trim + 空白回退「已采纳内容」。存储（projection_title）与覆盖查询
  # （has_accepted_chapter?）共用，保证空 summary 采纳也能被检测为覆盖（A4）。
  defp canonical_chapter_title(value) do
    case value |> to_string() |> String.trim() do
      "" -> "已采纳内容"
      title -> title
    end
  end

  defp projection_content(attrs) do
    attrs
    |> Map.get(:content, projection_title(attrs))
    |> to_string()
    |> String.trim()
    |> case do
      "" -> projection_title(attrs)
      content -> content
    end
  end
end
