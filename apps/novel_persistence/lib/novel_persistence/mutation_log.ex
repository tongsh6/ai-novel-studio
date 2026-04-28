defmodule NovelPersistence.MutationLog do
  @moduledoc """
  Mutation Log — mutation 记录持久化。

  所有对 authoritative state 的写入变更都通过此模块记录。
  提供 create / apply / block / list_by_object 等基本操作。
  """

  import Ecto.Query, only: [where: 3, order_by: 3]

  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Mutation

  @doc "Record a new mutation proposal."
  @spec create(map()) :: {:ok, Mutation.t()} | {:error, Ecto.Changeset.t()}
  def create(attrs) when is_map(attrs) do
    %Mutation{}
    |> Mutation.changeset(attrs)
    |> Repo.insert()
  end

  @doc "Record a mutation as directly applied (one-step: proposed → applied)."
  @spec create_applied(map()) :: {:ok, Mutation.t()} | {:error, Ecto.Changeset.t()}
  def create_applied(attrs) when is_map(attrs) do
    %Mutation{}
    |> Mutation.changeset(attrs)
    |> Mutation.apply_changeset()
    |> Repo.insert()
  end

  @doc "Mark a mutation as applied."
  @spec apply(Mutation.t()) :: {:ok, Mutation.t()} | {:error, Ecto.Changeset.t()}
  def apply(%Mutation{} = mutation) do
    mutation
    |> Mutation.apply_changeset()
    |> Repo.update()
  end

  @doc "Mark a mutation as blocked."
  @spec block(Mutation.t()) :: {:ok, Mutation.t()} | {:error, Ecto.Changeset.t()}
  def block(%Mutation{} = mutation) do
    mutation
    |> Mutation.block_changeset()
    |> Repo.update()
  end

  @doc "List mutations for a target object, newest first."
  @spec list_by_object(String.t()) :: [Mutation.t()]
  def list_by_object(target_object_ref) do
    Mutation
    |> where([m], m.target_object_ref == ^target_object_ref)
    |> order_by([m], desc: m.inserted_at)
    |> Repo.all()
  end

  @doc "List mutations for a turn."
  @spec list_by_turn(String.t()) :: [Mutation.t()]
  def list_by_turn(source_turn_ref) do
    Mutation
    |> where([m], m.source_turn_ref == ^source_turn_ref)
    |> order_by([m], desc: m.inserted_at)
    |> Repo.all()
  end
end
