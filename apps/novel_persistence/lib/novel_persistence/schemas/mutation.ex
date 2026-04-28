defmodule NovelPersistence.Schemas.Mutation do
  @moduledoc """
  Ecto schema for `mutations` table — mutation record (07-consistency §7.1)。

  每次对 authoritative state 的写入变更都记录为一条 mutation。
  adoption 是 mutation 的一种；直接写入、修正、补偿也是 mutation。

  ## ADR refs
  - 07-consistency-and-concurrency.md §7.1 — mutation 显式对象（10 字段）
  - 07-consistency-and-concurrency.md §7.2 — mutation 6 阶段
  """

  use Ecto.Schema

  import Ecto.Changeset

  alias NovelFoundation.Enums.MutationStatus

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "mutations" do
    field(:actor_ref, :string)
    field(:source_turn_ref, :string)
    field(:source_task_ref, :string)
    field(:target_scope, :string)
    field(:target_object_ref, :string)
    field(:base_revision, :integer)
    field(:mutation_type, :string)
    field(:status, :string, default: MutationStatus.proposed())
    field(:proposed_change_ref, :string)
    field(:authority_scope, :string)
    field(:requires_adoption, :boolean, default: false)

    timestamps(type: :utc_datetime_usec)
  end

  @required_fields [
    :actor_ref,
    :source_turn_ref,
    :target_scope,
    :target_object_ref,
    :base_revision,
    :mutation_type
  ]

  @doc false
  def changeset(mutation, attrs) do
    mutation
    |> cast(attrs, [
      :actor_ref,
      :source_turn_ref,
      :source_task_ref,
      :target_scope,
      :target_object_ref,
      :base_revision,
      :mutation_type,
      :status,
      :proposed_change_ref,
      :authority_scope,
      :requires_adoption
    ])
    |> validate_required(@required_fields)
    |> validate_inclusion(:status, MutationStatus.values())
    |> validate_number(:base_revision, greater_than: 0)
  end

  @doc "Mark mutation as applied."
  def apply_changeset(mutation) do
    mutation
    |> change(status: MutationStatus.applied())
  end

  @doc "Mark mutation as blocked by conflict."
  def block_changeset(mutation) do
    mutation
    |> change(status: MutationStatus.blocked())
  end
end
