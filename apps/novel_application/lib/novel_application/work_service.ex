defmodule NovelApplication.WorkService do
  @moduledoc """
  作品（Work）管理用例层。封装 `NovelPersistence.WorkRepo` 暴露给 Channel /
  Controller 一组面向作者的小操作，避免 web 层直接访问 schema。

  本模块属于 VS-09 Work Management Closed Loop（见
  `tasks/slices/v3/VS-09-work-management.md`）。Phase 1 只覆盖 list / create /
  get / touch_opened，足够支撑前端去 mock + Channel 透传 work_id。
  """

  alias NovelPersistence.Schemas.Work
  alias NovelPersistence.WorkRepo

  @type work_dto :: %{
          id: String.t(),
          title: String.t(),
          genre: String.t() | nil,
          status: String.t(),
          updated_at: DateTime.t() | nil,
          inserted_at: DateTime.t() | nil
        }

  @doc "List all works as plain DTOs (newest-first)."
  @spec list() :: [work_dto()]
  def list do
    WorkRepo.list() |> Enum.map(&to_dto/1)
  end

  @doc """
  Create a new work seed. Defaults `status` to "tentative" via schema default.
  Returns DTO on success.
  """
  @spec create(map()) :: {:ok, work_dto()} | {:error, Ecto.Changeset.t()}
  def create(attrs) when is_map(attrs) do
    case WorkRepo.create(normalize_attrs(attrs)) do
      {:ok, work} -> {:ok, to_dto(work)}
      {:error, _changeset} = err -> err
    end
  end

  @doc "Get a single work DTO by id; nil when missing."
  @spec get(String.t()) :: work_dto() | nil
  def get(id) when is_binary(id) do
    case WorkRepo.get(id) do
      nil -> nil
      work -> to_dto(work)
    end
  end

  @doc """
  Touch updated_at on a work to mark it as the most-recently-opened. Used by
  WorkspaceChannel.join to surface the last-opened work first in the list.
  Returns DTO on success; `:not_found` when id does not exist.
  """
  @spec mark_opened(String.t()) :: {:ok, work_dto()} | :not_found | {:error, term()}
  def mark_opened(id) when is_binary(id) do
    case WorkRepo.get(id) do
      nil ->
        :not_found

      %Work{} = work ->
        case WorkRepo.touch(work) do
          {:ok, w} -> {:ok, to_dto(w)}
          {:error, cs} -> {:error, cs}
        end
    end
  end

  # ── private ────────────────────────────────

  defp normalize_attrs(attrs) do
    attrs
    |> Map.new(fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      {k, v} -> {k, v}
    end)
    |> Map.take(["title", "genre", "core_selling_point", "target_reader", "tone_preference"])
  end

  defp to_dto(%Work{} = w) do
    %{
      id: w.id,
      title: w.title,
      genre: w.genre,
      status: w.status,
      updated_at: w.updated_at,
      inserted_at: w.inserted_at
    }
  end
end
