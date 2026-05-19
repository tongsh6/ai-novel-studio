defmodule NovelPersistence.MemoryManagementRepo do
  @moduledoc """
  Governed memory management repository.

  This module owns persistence reads and writes for the author-facing memory
  management API. Lifecycle semantics remain in `NovelDomain.MemoryItem` and
  are enforced by the schema changeset.
  """

  import Ecto.Query

  alias NovelPersistence.MemoryRecallRepo
  alias NovelPersistence.MemoryReferenceLog
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.MemoryItem

  @default_limit 100
  @max_limit 200

  @spec list(String.t(), map()) :: [MemoryItem.t()]
  def list(work_id, filters \\ %{}) when is_binary(work_id) and is_map(filters) do
    case Ecto.UUID.cast(work_id) do
      {:ok, uuid} ->
        uuid
        |> base_query()
        |> apply_exact_filter(:type, Map.get(filters, :type))
        |> apply_exact_filter(:scope, Map.get(filters, :scope))
        |> apply_exact_filter(:status, Map.get(filters, :status))
        |> apply_exact_filter(:source_type, Map.get(filters, :source_type))
        |> apply_boolean_filter(:locked, Map.get(filters, :locked))
        |> apply_boolean_filter(:recallable, Map.get(filters, :recallable))
        |> order_by([m], desc: m.updated_at, desc: m.inserted_at)
        |> Repo.all()
        |> filter_keyword(Map.get(filters, :keyword))
        |> Enum.drop(offset(filters))
        |> Enum.take(limit(filters))

      :error ->
        []
    end
  end

  @spec get(String.t(), String.t()) :: MemoryItem.t() | nil
  def get(work_id, memory_id) when is_binary(work_id) and is_binary(memory_id) do
    with {:ok, work_uuid} <- Ecto.UUID.cast(work_id),
         {:ok, memory_uuid} <- Ecto.UUID.cast(memory_id) do
      MemoryItem
      |> where([m], m.work_id == ^work_uuid and m.id == ^memory_uuid)
      |> Repo.one()
    else
      :error -> nil
    end
  end

  @spec create(String.t(), map()) :: {:ok, MemoryItem.t()} | {:error, Ecto.Changeset.t()}
  def create(work_id, attrs) when is_binary(work_id) and is_map(attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> Map.put("work_id", work_id)
      |> Map.put_new("id", NovelFoundation.ID.uuid())

    %MemoryItem{}
    |> MemoryItem.changeset(attrs)
    |> Repo.insert()
  end

  @spec update(String.t(), String.t(), map()) ::
          {:ok, MemoryItem.t()} | {:error, :not_found | Ecto.Changeset.t()}
  def update(work_id, memory_id, attrs)
      when is_binary(work_id) and is_binary(memory_id) and is_map(attrs) do
    case get(work_id, memory_id) do
      nil ->
        {:error, :not_found}

      %MemoryItem{} = item ->
        item
        |> MemoryItem.update_changeset(stringify_keys(attrs))
        |> Repo.update()
    end
  end

  @spec recall(String.t(), String.t() | nil, keyword()) :: [MemoryRecallRepo.recalled_memory()]
  def recall(work_id, query, opts \\ []) when is_binary(work_id) do
    MemoryRecallRepo.recall(work_id, query, opts)
  end

  @spec references(String.t(), String.t()) :: [map()] | :not_found
  def references(work_id, memory_id) when is_binary(work_id) and is_binary(memory_id) do
    case get(work_id, memory_id) do
      nil ->
        :not_found

      %MemoryItem{} ->
        memory_id
        |> MemoryReferenceLog.by_memory()
        |> Enum.filter(&(&1.work_id == work_id))
    end
  end

  defp base_query(work_id) do
    from(m in MemoryItem, where: m.work_id == ^work_id)
  end

  defp apply_exact_filter(query, _field, value) when value in [nil, ""], do: query

  defp apply_exact_filter(query, field, value) do
    where(query, [m], field(m, ^field) == ^value)
  end

  defp apply_boolean_filter(query, _field, value) when value in [nil, ""], do: query

  defp apply_boolean_filter(query, field, value) when is_boolean(value) do
    where(query, [m], field(m, ^field) == ^value)
  end

  defp apply_boolean_filter(query, _field, _value), do: query

  defp filter_keyword(items, keyword) when keyword in [nil, ""], do: items

  defp filter_keyword(items, keyword) when is_binary(keyword) do
    needle = String.downcase(keyword)

    Enum.filter(items, fn item ->
      [item.content, item.summary, item.tags && Enum.join(item.tags, " ")]
      |> Enum.reject(&is_nil/1)
      |> Enum.any?(fn text -> text |> String.downcase() |> String.contains?(needle) end)
    end)
  end

  defp limit(filters) do
    filters
    |> Map.get(:limit, @default_limit)
    |> clamp_integer(@default_limit, 1, @max_limit)
  end

  defp offset(filters) do
    filters
    |> Map.get(:offset, 0)
    |> clamp_integer(0, 0, 10_000)
  end

  defp clamp_integer(value, _default, min, max) when is_integer(value) do
    value |> Kernel.max(min) |> Kernel.min(max)
  end

  defp clamp_integer(value, default, min, max) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} -> clamp_integer(parsed, default, min, max)
      _ -> default
    end
  end

  defp clamp_integer(_value, default, _min, _max), do: default

  defp stringify_keys(attrs) do
    Map.new(attrs, fn
      {key, value} when is_atom(key) -> {Atom.to_string(key), value}
      {key, value} -> {key, value}
    end)
  end
end
