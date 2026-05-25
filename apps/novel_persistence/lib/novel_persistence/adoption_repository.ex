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

  defp persist_reading_projection(repo, attrs, mutation_id) do
    work_id = Map.fetch!(attrs, :work_id)
    title = projection_title(attrs)
    content = projection_content(attrs)
    volume_seq = next_volume_seq(repo, work_id)

    with {:ok, volume} <-
           insert_volume(repo, %{work_id: work_id, title: "已采纳内容", seq: volume_seq}),
         {:ok, chapter} <-
           insert_chapter(repo, %{
             work_id: work_id,
             volume_id: volume.id,
             title: title,
             seq: 1
           }),
         {:ok, scene} <-
           insert_scene(repo, %{
             work_id: work_id,
             chapter_id: chapter.id,
             title: title,
             seq: 1
           }),
         {:ok, draft} <-
           insert_draft(repo, %{
             work_id: work_id,
             scene_id: scene.id,
             content: content,
             status: AdoptionStatus.accepted()
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

  defp next_volume_seq(repo, work_id) do
    count =
      Volume
      |> where([v], v.work_id == ^work_id)
      |> repo.aggregate(:count)

    count + 1
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
    attrs
    |> Map.get(:summary, "已采纳内容")
    |> to_string()
    |> String.trim()
    |> case do
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
