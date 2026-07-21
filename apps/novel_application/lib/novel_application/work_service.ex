defmodule NovelApplication.WorkService do
  @moduledoc """
  作品（Work）管理用例层。封装 `NovelPersistence.WorkRepo` 暴露给 Channel /
  Controller 一组面向作者的小操作，避免 web 层直接访问 schema。

  本模块属于 VS-09 Work Management Closed Loop（见
  `tasks/slices/v3/VS-09-work-management.md`）。当前最小闭环覆盖 list /
  create / get / touch_opened / rename / discard，支撑真实工作台作品菜单、
  Channel 透传 work_id 与作品生命周期管理。
  """

  alias NovelPersistence.Schemas.Work
  alias NovelPersistence.WorkRepo

  @type work_dto :: %{
          id: String.t(),
          title: String.t(),
          genre: String.t() | nil,
          status: String.t(),
          revision: integer(),
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
    attrs = attrs |> normalize_attrs() |> Map.drop(["revision"])

    case WorkRepo.create(attrs) do
      {:ok, work} -> {:ok, to_dto(work)}
      {:error, _changeset} = err -> err
    end
  end

  @doc """
  Ensure startup has a real active work. This is intentionally separate from
  `create/1`: startup should be idempotent, while the author-facing create
  action must still allow multiple unnamed works.
  """
  @spec ensure_initial(map()) :: {:ok, work_dto()} | {:error, Ecto.Changeset.t() | term()}
  def ensure_initial(attrs \\ %{}) when is_map(attrs) do
    attrs =
      attrs
      |> normalize_attrs()
      |> Map.put_new("title", "未命名作品")
      |> Map.drop(["revision"])

    case WorkRepo.ensure_initial(attrs) do
      {:ok, work} -> {:ok, to_dto(work)}
      {:error, _reason} = err -> err
    end
  end

  @doc "Rename an existing work. Returns `:not_found` when id does not exist."
  @spec rename(String.t(), map()) ::
          {:ok, work_dto()} | :not_found | {:error, :revision_conflict | Ecto.Changeset.t()}
  def rename(id, attrs) when is_binary(id) and is_map(attrs) do
    attrs = normalize_attrs(attrs)

    with %Work{} = work <- WorkRepo.get(id),
         :ok <- ensure_revision(work, Map.get(attrs, "revision")) do
      case WorkRepo.rename(work, Map.get(attrs, "title", "")) do
        {:ok, updated} -> {:ok, to_dto(updated)}
        {:error, _changeset} = err -> err
      end
    else
      nil -> :not_found
      {:error, :revision_conflict} -> {:error, :revision_conflict}
    end
  end

  @doc """
  Safely move a work out of the default list without physical deletion.
  """
  @spec discard(String.t(), map()) ::
          {:ok, work_dto()} | :not_found | {:error, :revision_conflict | Ecto.Changeset.t()}
  def discard(id, attrs \\ %{}) when is_binary(id) and is_map(attrs) do
    attrs = normalize_attrs(attrs)

    with %Work{} = work <- WorkRepo.get(id),
         :ok <- ensure_revision(work, Map.get(attrs, "revision")) do
      case WorkRepo.discard(work) do
        {:ok, updated} -> {:ok, to_dto(updated)}
        {:error, _changeset} = err -> err
      end
    else
      nil -> :not_found
      {:error, :revision_conflict} -> {:error, :revision_conflict}
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
    |> Map.take([
      "title",
      "genre",
      "core_selling_point",
      "premise",
      "theme",
      "main_goal",
      "target_reader",
      "tone_preference",
      "revision"
    ])
    |> normalize_title()
  end

  defp normalize_title(%{"title" => title} = attrs) when is_binary(title) do
    Map.put(attrs, "title", String.trim(title))
  end

  defp normalize_title(attrs), do: attrs

  defp ensure_revision(_work, nil), do: :ok

  defp ensure_revision(%Work{revision: revision}, expected) when is_binary(expected) do
    case Integer.parse(expected) do
      {parsed, ""} -> ensure_revision(%Work{revision: revision}, parsed)
      _ -> {:error, :revision_conflict}
    end
  end

  defp ensure_revision(%Work{revision: revision}, expected) when is_integer(expected) do
    if revision == expected, do: :ok, else: {:error, :revision_conflict}
  end

  defp ensure_revision(_work, _expected), do: {:error, :revision_conflict}

  defp to_dto(%Work{} = w) do
    %{
      id: w.id,
      title: w.title,
      genre: w.genre,
      status: w.status,
      revision: w.revision,
      updated_at: w.updated_at,
      inserted_at: w.inserted_at
    }
  end
end
