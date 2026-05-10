defmodule NovelPersistence.Schemas.Interaction do
  @moduledoc """
  Ecto schema for `interactions` table — episodic memory 基础。

  每条记录对应一次 turn 中的一条消息（user 或 assistant），或 task_event /
  artifact / object_snapshot 等其他 source_type。

  ## ADR refs
  - 05-memory-retention-and-retrieval.md §5.1 — 12 个最小字段
  - 05-memory-retention-and-retrieval.md §5.2-5.4 — memory_class / source_type / scope_ref
  - 05-memory-retention-and-retrieval.md §7 — replayable / retrievable 分离
  """

  use Ecto.Schema

  import Ecto.Changeset

  alias NovelFoundation.Enums.MemoryClass
  alias NovelFoundation.Enums.RetentionTier
  alias NovelFoundation.Enums.SourceType

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @valid_roles ~w(user assistant system)

  schema "interactions" do
    field(:workspace_id, :string)
    field(:turn_id, :string)
    field(:role, :string)
    field(:content, :map)
    field(:memory_class, :string, default: MemoryClass.episodic())
    field(:retention_tier, :string, default: RetentionTier.hot())
    field(:source_type, :string, default: SourceType.turn())
    field(:source_ref, :string)
    field(:scope_ref, :string)
    field(:freshness_score, :float, default: 0.5)
    field(:importance_score, :float, default: 0.5)
    field(:replayable, :boolean, default: true)
    field(:retrievable, :boolean, default: true)

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
      :source_type,
      :source_ref,
      :scope_ref,
      :freshness_score,
      :importance_score,
      :replayable,
      :retrievable
    ])
    |> validate_required([:workspace_id, :turn_id, :role, :content])
    |> validate_inclusion(:role, @valid_roles)
    |> validate_inclusion(:memory_class, MemoryClass.values())
    |> validate_inclusion(:retention_tier, RetentionTier.values())
    |> validate_inclusion(:source_type, SourceType.values())
    |> validate_number(:freshness_score,
      greater_than_or_equal_to: 0.0,
      less_than_or_equal_to: 1.0
    )
    |> validate_number(:importance_score,
      greater_than_or_equal_to: 0.0,
      less_than_or_equal_to: 1.0
    )
  end
end
