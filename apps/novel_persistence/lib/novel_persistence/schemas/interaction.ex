defmodule NovelPersistence.Schemas.Interaction do
  @moduledoc """
  Ecto schema for `interactions` table — episodic memory 基础。

  每条记录对应一次 turn 中的一条消息（user 或 assistant）。
  Phase 1 按 05-memory-retention-and-retrieval.md §5.1 最小字段集落地。
  """

  use Ecto.Schema

  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @valid_roles ~w(user assistant system)
  @valid_classes ~w(episodic semantic procedural meta)
  @valid_tiers ~w(hot warm cold)

  schema "interactions" do
    field(:workspace_id, :string)
    field(:turn_id, :string)
    field(:role, :string)
    field(:content, :map)
    field(:memory_class, :string, default: "episodic")
    field(:retention_tier, :string, default: "hot")
    field(:source_type, :string, default: "turn")

    timestamps(type: :utc_datetime_usec)
  end

  @doc false
  def changeset(interaction, attrs) do
    interaction
    |> cast(attrs, [
      :workspace_id,
      :turn_id,
      :role,
      :content,
      :memory_class,
      :retention_tier,
      :source_type
    ])
    |> validate_required([:workspace_id, :turn_id, :role, :content])
    |> validate_inclusion(:role, @valid_roles)
    |> validate_inclusion(:memory_class, @valid_classes)
    |> validate_inclusion(:retention_tier, @valid_tiers)
  end
end
