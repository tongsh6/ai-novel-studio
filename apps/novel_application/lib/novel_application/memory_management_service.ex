defmodule NovelApplication.MemoryManagementService do
  @moduledoc """
  Application boundary for AU-09 governed memory management.

  Controllers and future Channel handlers use this service instead of reaching
  into persistence directly. It keeps work isolation, lifecycle transitions,
  and JSON-safe DTO shaping in one place.
  """

  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelPersistence.MemoryManagementRepo
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.WorkRepo

  @create_fields [
    "volume_id",
    "arc_id",
    "chapter_id",
    "content",
    "summary",
    "type",
    "scope",
    "source_type",
    "weight",
    "confidence",
    "source_confidence",
    "locked",
    "recallable",
    "common_sense",
    "valid_from",
    "valid_until",
    "expire_condition",
    "tags",
    "source_id"
  ]

  @filter_fields [
    "type",
    "scope",
    "status",
    "source_type",
    "locked",
    "recallable",
    "keyword",
    "limit",
    "offset"
  ]

  @spec list(String.t(), map()) ::
          {:ok, %{items: [map()], count: non_neg_integer()}} | {:error, :work_not_found}
  def list(work_id, params \\ %{}) when is_binary(work_id) and is_map(params) do
    with :ok <- ensure_work(work_id) do
      items =
        work_id
        |> MemoryManagementRepo.list(normalize_filters(params))
        |> Enum.map(&to_dto/1)

      {:ok, %{items: items, count: length(items)}}
    end
  end

  @spec get(String.t(), String.t()) :: {:ok, map()} | {:error, :work_not_found | :not_found}
  def get(work_id, memory_id) when is_binary(work_id) and is_binary(memory_id) do
    with :ok <- ensure_work(work_id),
         %MemoryItem{} = item <- MemoryManagementRepo.get(work_id, memory_id) do
      {:ok, to_dto(item)}
    else
      nil -> {:error, :not_found}
      {:error, reason} -> {:error, reason}
    end
  end

  @spec create(String.t(), map()) ::
          {:ok, map()} | {:error, :work_not_found | Ecto.Changeset.t()}
  def create(work_id, attrs) when is_binary(work_id) and is_map(attrs) do
    with :ok <- ensure_work(work_id) do
      attrs =
        attrs
        |> stringify_keys()
        |> Map.take(@create_fields)
        |> Map.put_new("source_type", MemorySourceType.author_created())

      case MemoryManagementRepo.create(work_id, attrs) do
        {:ok, item} -> {:ok, to_dto(item)}
        {:error, changeset} -> {:error, changeset}
      end
    end
  end

  @spec confirm(String.t(), String.t()) ::
          {:ok, map()} | {:error, :work_not_found | :not_found | Ecto.Changeset.t()}
  def confirm(work_id, memory_id) do
    update(work_id, memory_id, %{
      status: MemoryStatus.confirmed(),
      source_type: MemorySourceType.author_confirmed()
    })
  end

  @spec lock(String.t(), String.t()) ::
          {:ok, map()} | {:error, :work_not_found | :not_found | Ecto.Changeset.t()}
  def lock(work_id, memory_id), do: update(work_id, memory_id, %{locked: true})

  @spec unlock(String.t(), String.t()) ::
          {:ok, map()} | {:error, :work_not_found | :not_found | Ecto.Changeset.t()}
  def unlock(work_id, memory_id), do: update(work_id, memory_id, %{locked: false})

  @spec deprecate(String.t(), String.t()) ::
          {:ok, map()} | {:error, :work_not_found | :not_found | Ecto.Changeset.t()}
  def deprecate(work_id, memory_id),
    do: update(work_id, memory_id, %{status: MemoryStatus.deprecated()})

  @spec archive(String.t(), String.t()) ::
          {:ok, map()} | {:error, :work_not_found | :not_found | Ecto.Changeset.t()}
  def archive(work_id, memory_id),
    do: update(work_id, memory_id, %{status: MemoryStatus.archived()})

  @spec update_weight(String.t(), String.t(), number()) ::
          {:ok, map()} | {:error, :work_not_found | :not_found | Ecto.Changeset.t()}
  def update_weight(work_id, memory_id, weight), do: update(work_id, memory_id, %{weight: weight})

  @spec update_validity(String.t(), String.t(), map()) ::
          {:ok, map()} | {:error, :work_not_found | :not_found | Ecto.Changeset.t()}
  def update_validity(work_id, memory_id, attrs) when is_map(attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.take(["valid_from", "valid_until", "expire_condition"])

    update(work_id, memory_id, attrs)
  end

  @spec recall(String.t(), map()) :: {:ok, map()} | {:error, :work_not_found}
  def recall(work_id, params \\ %{}) when is_binary(work_id) and is_map(params) do
    with :ok <- ensure_work(work_id) do
      filters = stringify_keys(params)
      limit = parse_limit(Map.get(filters, "token_budget"))
      memories = MemoryManagementRepo.recall(work_id, Map.get(filters, "query"), limit: limit)
      text = NovelPersistence.MemoryRecallRepo.summary(memories) || ""

      {:ok,
       %{
         text: text,
         iron_law_count: 0,
         candidate_count: length(memories),
         estimated_tokens: estimate_tokens(text)
       }}
    end
  end

  @spec references(String.t(), String.t()) ::
          {:ok, [map()]} | {:error, :work_not_found | :not_found}
  def references(work_id, memory_id) when is_binary(work_id) and is_binary(memory_id) do
    with :ok <- ensure_work(work_id) do
      case MemoryManagementRepo.references(work_id, memory_id) do
        :not_found -> {:error, :not_found}
        records -> {:ok, Enum.map(records, &reference_to_dto/1)}
      end
    end
  end

  defp update(work_id, memory_id, attrs) do
    with :ok <- ensure_work(work_id) do
      case MemoryManagementRepo.update(work_id, memory_id, attrs) do
        {:ok, item} -> {:ok, to_dto(item)}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp ensure_work(work_id) do
    with {:ok, _uuid} <- Ecto.UUID.cast(work_id),
         %{} <- WorkRepo.get(work_id) do
      :ok
    else
      _ -> {:error, :work_not_found}
    end
  end

  defp normalize_filters(params) do
    params
    |> stringify_keys()
    |> Map.take(@filter_fields)
    |> Map.new(fn {key, value} -> {filter_key(key), normalize_filter_value(key, value)} end)
  end

  defp filter_key("type"), do: :type
  defp filter_key("scope"), do: :scope
  defp filter_key("status"), do: :status
  defp filter_key("source_type"), do: :source_type
  defp filter_key("locked"), do: :locked
  defp filter_key("recallable"), do: :recallable
  defp filter_key("keyword"), do: :keyword
  defp filter_key("limit"), do: :limit
  defp filter_key("offset"), do: :offset

  defp normalize_filter_value(key, value) when key in ["locked", "recallable"] do
    case value do
      true -> true
      false -> false
      "true" -> true
      "false" -> false
      _ -> nil
    end
  end

  defp normalize_filter_value(_key, value), do: value

  defp parse_limit(value) when is_integer(value), do: max(value, 1)

  defp parse_limit(value) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} -> max(parsed, 1)
      _ -> 5
    end
  end

  defp parse_limit(_value), do: 5

  defp estimate_tokens(""), do: 0
  defp estimate_tokens(text) when is_binary(text), do: text |> String.length() |> div(2) |> max(1)

  defp to_dto(%MemoryItem{} = item) do
    %{
      id: item.id,
      work_id: item.work_id,
      volume_id: item.volume_id,
      arc_id: item.arc_id,
      chapter_id: item.chapter_id,
      content: item.content,
      summary: item.summary,
      type: item.type,
      scope: item.scope,
      status: item.status,
      source_type: item.source_type,
      source_id: item.source_id,
      reference_count: item.reference_count,
      weight: decimal_to_float(item.weight),
      confidence: decimal_to_float(item.confidence),
      source_confidence: decimal_to_float(item.source_confidence),
      locked: item.locked,
      recallable: item.recallable,
      common_sense: item.common_sense,
      valid_from: item.valid_from,
      valid_until: item.valid_until,
      expire_condition: item.expire_condition,
      version: item.version,
      tags: item.tags || [],
      last_referenced_at: iso(item.last_referenced_at),
      created_at: iso(item.inserted_at),
      updated_at: iso(item.updated_at)
    }
  end

  defp reference_to_dto(record) do
    %{
      id: record.id,
      memory_id: record.memory_id,
      work_id: record.work_id,
      task_id: record.task_id,
      conversation_id: record.conversation_id,
      reference_scene: record.reference_scene,
      reference_reason: record.reference_reason,
      inserted_at: iso(record.inserted_at)
    }
  end

  defp decimal_to_float(%Decimal{} = decimal), do: Decimal.to_float(decimal)
  defp decimal_to_float(value) when is_float(value), do: value
  defp decimal_to_float(value) when is_integer(value), do: value / 1
  defp decimal_to_float(_value), do: 0.0

  defp iso(%DateTime{} = datetime), do: DateTime.to_iso8601(datetime)
  defp iso(value) when is_binary(value), do: value
  defp iso(nil), do: nil

  defp stringify_keys(attrs) do
    Map.new(attrs, fn
      {key, value} when is_atom(key) -> {Atom.to_string(key), value}
      {key, value} -> {key, value}
    end)
  end
end
