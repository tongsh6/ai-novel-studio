defmodule NovelPersistence.WorkArchiveRepo do
  @moduledoc """
  Read-model queries for the work archive panel.

  The archive panel must reflect persisted facts for the current work only.
  Unknown or placeholder work ids return empty DTOs instead of sample data.
  """

  import Ecto.Query

  alias NovelDomain.ProseWordCount
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.Character
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.Schemas.Volume
  alias NovelPersistence.Schemas.Work

  @accepted_adoption_statuses [AdoptionStatus.accepted(), AdoptionStatus.edited_accepted()]
  @confirmed_memory_statuses [MemoryStatus.confirmed(), MemoryStatus.stabilized()]
  @foreshadowing_types [MemoryType.foreshadowing(), MemoryType.plot_fact()]
  @rule_types [MemoryType.world_rule(), MemoryType.constraint(), MemoryType.style_rule()]

  @spec profile(String.t()) :: map()
  def profile(work_id) when is_binary(work_id) do
    with_uuid(work_id, %{}, fn uuid ->
      Work
      |> where([w], w.id == ^uuid)
      |> select([w], %{
        title: w.title,
        genre: w.genre,
        core_selling_point: w.core_selling_point,
        premise: w.premise,
        theme: w.theme,
        main_goal: w.main_goal,
        target_reader: w.target_reader,
        tone_preference: w.tone_preference,
        status: w.status,
        revision: w.revision,
        updated_at: w.updated_at
      })
      |> Repo.one()
      |> normalize_profile()
    end)
  end

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
        narrative_role: c.narrative_role,
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

  @spec current_states(String.t()) :: [map()]
  def current_states(work_id) when is_binary(work_id) do
    memory_items(work_id, [MemoryType.current_state()])
  end

  @spec relationships(String.t()) :: [map()]
  def relationships(work_id) when is_binary(work_id) do
    memory_items(work_id, [MemoryType.relationship()])
  end

  @spec preferences(String.t()) :: [map()]
  def preferences(work_id) when is_binary(work_id) do
    memory_items(work_id, [MemoryType.author_preference()])
  end

  @creative_fact_types [
    MemoryType.foreshadowing(),
    MemoryType.plot_fact(),
    MemoryType.world_rule(),
    MemoryType.constraint(),
    MemoryType.current_state(),
    MemoryType.relationship(),
    MemoryType.style_rule(),
    MemoryType.author_preference()
  ]

  @doc """
  写作事实链读端口（CA02）：一次查询取全部确认记忆，按创作消费分组。

  world_rules 不含 STYLE_RULE（与档案 rules 面口径不同）——风格归 style 组，
  作为写作前风格锚与事实基线分开渲染。
  """
  @spec creative_facts(String.t()) :: %{
          foreshadowing: [map()],
          world_rules: [map()],
          current_states: [map()],
          relationships: [map()],
          style: [map()]
        }
  def creative_facts(work_id) when is_binary(work_id) do
    all = memory_items(work_id, @creative_fact_types)

    %{
      foreshadowing: of_types(all, @foreshadowing_types),
      world_rules: of_types(all, [MemoryType.world_rule(), MemoryType.constraint()]),
      current_states: of_types(all, [MemoryType.current_state()]),
      relationships: of_types(all, [MemoryType.relationship()]),
      style: of_types(all, [MemoryType.style_rule(), MemoryType.author_preference()])
    }
  end

  defp of_types(items, types), do: Enum.filter(items, &(&1.type in types))

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

  defp normalize_profile(nil), do: %{}

  defp normalize_profile(profile) do
    profile
    |> Map.put(:updated_at, datetime_to_iso8601(profile.updated_at))
    |> Enum.reject(fn {_key, value} -> is_nil(value) or value == "" end)
    |> Map.new()
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

  # 正文有效字数统一走 NovelDomain.ProseWordCount（排除标点与空白），
  # 与 reading projection 共用同一口径，见 novel-output-milestones.md §2。
  defp text_size(text), do: ProseWordCount.count(text)

  defp inserted_today?(%{inserted_at: %DateTime{} = inserted_at}) do
    Date.compare(DateTime.to_date(inserted_at), Date.utc_today()) == :eq
  end

  defp inserted_today?(_), do: false
end
