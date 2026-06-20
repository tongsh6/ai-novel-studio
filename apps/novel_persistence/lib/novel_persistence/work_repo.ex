defmodule NovelPersistence.WorkRepo do
  @moduledoc """
  Works CRUD repository — Phase 1 minimum surface for VS-09 Work Management.

  仅暴露 application 层需要的最小操作（list / create / get / rename /
  discard），不让 web 层直接触碰 schema。
  """

  import Ecto.Query, only: [order_by: 3, where: 3]

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Work

  @inactive_statuses [AdoptionStatus.discarded(), AdoptionStatus.archived()]

  @doc "List works newest-first (by updated_at). Discarded/archived works are hidden by default."
  @spec list(keyword()) :: [Work.t()]
  def list(opts \\ []) do
    include_inactive? = Keyword.get(opts, :include_inactive, false)

    Work
    |> maybe_exclude_inactive(include_inactive?)
    |> order_by([w], desc: w.updated_at)
    |> Repo.all()
  end

  @doc "Insert a new work seed (default status from schema)."
  @spec create(map()) :: {:ok, Work.t()} | {:error, Ecto.Changeset.t()}
  def create(attrs) when is_map(attrs) do
    %Work{}
    |> Work.changeset(attrs)
    |> Repo.insert()
  end

  @doc "Return the newest active work, creating one when the active list is empty."
  @spec ensure_initial(map()) :: {:ok, Work.t()} | {:error, Ecto.Changeset.t() | term()}
  def ensure_initial(attrs) when is_map(attrs) do
    attrs
    |> transaction_initial_work()
    |> unwrap_initial_work_transaction()
  end

  defp transaction_initial_work(attrs) do
    Repo.transaction(fn -> get_or_create_initial_work(attrs) end)
  end

  defp get_or_create_initial_work(attrs) do
    case list() do
      [work | _] -> {:ok, work}
      [] -> create(attrs)
    end
  end

  defp unwrap_initial_work_transaction({:ok, {:ok, work}}), do: {:ok, work}
  defp unwrap_initial_work_transaction({:ok, {:error, reason}}), do: {:error, reason}
  defp unwrap_initial_work_transaction({:error, reason}), do: {:error, reason}

  @doc "Get a work by binary_id; nil when missing."
  @spec get(String.t()) :: Work.t() | nil
  def get(id) when is_binary(id) do
    Repo.get(Work, id)
  end

  @doc "Rename a work title."
  @spec rename(Work.t(), String.t()) :: {:ok, Work.t()} | {:error, Ecto.Changeset.t()}
  def rename(%Work{} = work, title) when is_binary(title) do
    work
    |> Work.changeset(%{title: title})
    |> Repo.update(stale_error_field: :revision)
  end

  @doc "Safely move a work out of the default list without physical deletion."
  @spec discard(Work.t()) :: {:ok, Work.t()} | {:error, Ecto.Changeset.t()}
  def discard(%Work{} = work) do
    work
    |> Work.discard_changeset()
    |> Repo.update(stale_error_field: :revision)
  end

  @doc "Touch updated_at to mark a work as last opened (no schema change)."
  @spec touch(Work.t()) :: {:ok, Work.t()} | {:error, Ecto.Changeset.t()}
  def touch(%Work{} = work) do
    work
    |> Ecto.Changeset.change()
    |> Ecto.Changeset.force_change(:updated_at, DateTime.utc_now())
    |> Repo.update()
  end

  defp maybe_exclude_inactive(query, true), do: query

  defp maybe_exclude_inactive(query, false),
    do: where(query, [w], w.status not in ^@inactive_statuses)
end
