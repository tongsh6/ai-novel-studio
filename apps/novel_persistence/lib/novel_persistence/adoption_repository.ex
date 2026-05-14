defmodule NovelPersistence.AdoptionRepository do
  @moduledoc """
  Persistence boundary for accepted artifact adoption.

  AU-05 requires adoption to leave a durable state consequence. This repository
  records the accepted author action as an applied mutation and stores the
  adopted creative fact as a confirmed memory item scoped to the current work.
  """

  alias Ecto.Multi
  alias NovelFoundation.Enums.MemoryScope
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelFoundation.ID
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.Schemas.Mutation

  @spec writer() :: function()
  def writer do
    &persist/1
  end

  @spec persist(map()) :: {:ok, map()} | {:error, term()}
  def persist(attrs) when is_map(attrs) do
    mutation_attrs = mutation_attrs(attrs)

    Multi.new()
    |> Multi.insert(:mutation, Mutation.changeset(%Mutation{}, mutation_attrs) |> Mutation.apply_changeset())
    |> Multi.insert(:memory_item, fn %{mutation: mutation} ->
      MemoryItem.changeset(%MemoryItem{}, memory_item_attrs(attrs, mutation.id))
    end)
    |> Repo.transaction()
    |> case do
      {:ok, %{mutation: mutation, memory_item: memory_item}} ->
        {:ok,
         %{
           mutation_id: mutation.id,
           mutation_status: mutation.status,
           memory_item_id: memory_item.id,
           memory_status: memory_item.status,
           source_revision_ref: "mutation:#{mutation.id}"
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
      tags: ["adopted_artifact", to_string(Map.get(attrs, :artifact_type, "artifact"))]
    }
  end

  defp memory_type(:character_seed), do: MemoryType.character_profile()
  defp memory_type("character_seed"), do: MemoryType.character_profile()
  defp memory_type(:plot_direction), do: MemoryType.plot_fact()
  defp memory_type("plot_direction"), do: MemoryType.plot_fact()
  defp memory_type(:outline_draft), do: MemoryType.draft_context()
  defp memory_type("outline_draft"), do: MemoryType.draft_context()
  defp memory_type(_), do: MemoryType.draft_context()
end
