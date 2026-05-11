defmodule NovelPersistence.WorkRepo do
  @moduledoc """
  Works CRUD repository — Phase 1 minimum surface for VS-09 Work Management.

  仅暴露 application 层需要的最小操作（list / create / get），不包含 adoption /
  discard，那部分继续走 `Schemas.Work.adopt_changeset` / `discard_changeset`。
  """

  import Ecto.Query, only: [order_by: 3]

  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Work

  @doc "List all works newest-first (by updated_at)."
  @spec list() :: [Work.t()]
  def list do
    Work
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

  @doc "Get a work by binary_id; nil when missing."
  @spec get(String.t()) :: Work.t() | nil
  def get(id) when is_binary(id) do
    Repo.get(Work, id)
  end

  @doc "Touch updated_at to mark a work as last opened (no schema change)."
  @spec touch(Work.t()) :: {:ok, Work.t()} | {:error, Ecto.Changeset.t()}
  def touch(%Work{} = work) do
    work
    |> Work.changeset(%{})
    |> Ecto.Changeset.force_change(:updated_at, DateTime.utc_now())
    |> Repo.update()
  end
end
