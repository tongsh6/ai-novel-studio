defmodule NovelPersistence.WorkArchiveRepo do
  @moduledoc """
  Read-model queries for the work archive panel.

  The archive panel must reflect persisted facts for the current work only.
  Unknown or placeholder work ids return empty DTOs instead of sample data.
  """

  import Ecto.Query

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.Character
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.Schemas.Volume

  @accepted_adoption_statuses [AdoptionStatus.accepted(), AdoptionStatus.edited_accepted()]
  @confirmed_memory_statuses [MemoryStatus.confirmed(), MemoryStatus.stabilized()]
  @foreshadowing_types [MemoryType.foreshadowing(), MemoryType.plot_fact()]
  @rule_types [MemoryType.world_rule(), MemoryType.constraint(), MemoryType.style_rule()]

  @spec characters(String.t()) :: [map()]
  def characters(work_id) when is_binary(work_id) do
    with_uuid(work_id, [], fn uuid ->
      Character
      |> where([c], c.work_id == ^uuid and c.status in ^@accepted_adoption_statuses)
      |> order_by([c], asc: c.name, asc: c.inserted_at)
      |> select([c], %{
        id: c.id,
        name: c.name,
        role: c.role,
        summary: c.summary,
        aliases: c.aliases,
        status: c.status,
        updated_at: c.updated_at
      })
      |> Repo.all()
      |> Enum.map(&normalize_character/1)
    end)
  end

  @spec foreshadowing(String.t()) :: [map()]
  def foreshadowing(work_id) when is_binary(work_id) do
    memory_items(work_id, @foreshadowing_types)
  end

  @spec rules(String.t()) :: [map()]
  def rules(work_id) when is_binary(work_id) do
    memory_items(work_id, @rule_types)
  end

  @spec stats(String.t()) :: map()
  def stats(work_id) when is_binary(work_id) do
    with_uuid(work_id, empty_stats(), fn uuid ->
      accepted_drafts = accepted_drafts(uuid)

      %{
        words_total:
          accepted_drafts |> Enum.map(& &1.content) |> Enum.map(&text_size/1) |> Enum.sum(),
        words_today:
          accepted_drafts
          |> Enum.filter(&inserted_today?/1)
          |> Enum.map(& &1.content)
          |> Enum.map(&text_size/1)
          |> Enum.sum(),
        volumes: count_for(Volume, uuid),
        chapters: count_for(Chapter, uuid),
        characters: count_accepted_characters(uuid),
        memory_items: count_confirmed_memory_items(uuid),
        drafts_total: count_for(Draft, uuid),
        drafts_accepted: length(accepted_drafts)
      }
    end)
  end

  defp memory_items(work_id, types) do
    with_uuid(work_id, [], fn uuid ->
      MemoryItem
      |> where(
        [m],
        m.work_id == ^uuid and m.status in ^@confirmed_memory_statuses and
          m.recallable == true and m.type in ^types
      )
      |> order_by([m], desc: m.updated_at, desc: m.inserted_at)
      |> select([m], %{
        id: m.id,
        type: m.type,
        scope: m.scope,
        status: m.status,
        source_type: m.source_type,
        content: m.content,
        summary: m.summary,
        tags: m.tags,
        weight: m.weight,
        confidence: m.confidence,
        locked: m.locked,
        recallable: m.recallable,
        reference_count: m.reference_count,
        version: m.version,
        updated_at: m.updated_at
      })
      |> Repo.all()
      |> Enum.map(&normalize_memory_item/1)
    end)
  end

  defp accepted_drafts(work_id) do
    Draft
    |> where([d], d.work_id == ^work_id and d.status in ^@accepted_adoption_statuses)
    |> select([d], %{content: d.content, inserted_at: d.inserted_at})
    |> Repo.all()
  end

  defp count_for(schema, work_id) do
    schema
    |> where([row], row.work_id == ^work_id)
    |> Repo.aggregate(:count)
  end

  defp count_accepted_characters(work_id) do
    Character
    |> where([c], c.work_id == ^work_id and c.status in ^@accepted_adoption_statuses)
    |> Repo.aggregate(:count)
  end

  defp count_confirmed_memory_items(work_id) do
    MemoryItem
    |> where(
      [m],
      m.work_id == ^work_id and m.status in ^@confirmed_memory_statuses and m.recallable == true
    )
    |> Repo.aggregate(:count)
  end

  defp with_uuid(work_id, fallback, fun) do
    case Ecto.UUID.cast(work_id) do
      {:ok, uuid} -> fun.(uuid)
      :error -> fallback
    end
  end

  defp empty_stats do
    %{
      words_total: 0,
      words_today: 0,
      volumes: 0,
      chapters: 0,
      characters: 0,
      memory_items: 0,
      drafts_total: 0,
      drafts_accepted: 0
    }
  end

  defp normalize_character(character) do
    character
    |> Map.put(:aliases, character.aliases || [])
    |> Map.put(:updated_at, datetime_to_iso8601(character.updated_at))
  end

  defp normalize_memory_item(item) do
    item
    |> Map.put(:tags, item.tags || [])
    |> Map.put(:weight, decimal_to_float(item.weight))
    |> Map.put(:confidence, decimal_to_float(item.confidence))
    |> Map.put(:updated_at, datetime_to_iso8601(item.updated_at))
  end

  defp decimal_to_float(%Decimal{} = decimal), do: Decimal.to_float(decimal)
  defp decimal_to_float(value), do: value

  defp datetime_to_iso8601(%DateTime{} = datetime), do: DateTime.to_iso8601(datetime)
  defp datetime_to_iso8601(_), do: nil

  defp text_size(nil), do: 0
  defp text_size(text) when is_binary(text), do: String.length(text)

  defp inserted_today?(%{inserted_at: %DateTime{} = inserted_at}) do
    Date.compare(DateTime.to_date(inserted_at), Date.utc_today()) == :eq
  end

  defp inserted_today?(_), do: false
end
