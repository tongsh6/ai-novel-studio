defmodule NovelPersistence.Schemas.MemoryItem do
  @moduledoc """
  Ecto schema for `memory_items` table — Governed Memory 核心持久化。

  每条记录是可独立治理的创作事实。与 `interactions` 表（episodic log）互补。

  ## ADR refs
  - 05-memory-retention-and-retrieval.md §8.1 — 核心字段设计
  - 05-memory-retention-and-retrieval.md §24.1 — DDL
  """

  use Ecto.Schema

  import Ecto.Changeset

  alias NovelFoundation.Enums.MemoryType
  alias NovelFoundation.Enums.MemoryScope
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemorySourceType

  @primary_key {:id, Ecto.UUID, autogenerate: false}
  @foreign_key_type Ecto.UUID

  @required_fields [:id, :work_id, :content, :type, :scope, :source_type]

  schema "memory_items" do
    field :work_id, Ecto.UUID

    field :volume_id, Ecto.UUID
    field :arc_id, Ecto.UUID
    field :chapter_id, Ecto.UUID

    field :content, :string
    field :summary, :string

    field :type, :string, default: MemoryType.world_rule()
    field :scope, :string, default: MemoryScope.work()
    field :status, :string, default: MemoryStatus.draft()
    field :source_type, :string

    field :reference_count, :integer, default: 0

    field :weight, :decimal, default: Decimal.new("0.5000")
    field :confidence, :decimal, default: Decimal.new("0.5000")
    field :source_confidence, :decimal, default: Decimal.new("0.5000")

    field :locked, :boolean, default: false
    field :recallable, :boolean, default: true
    field :common_sense, :boolean, default: false

    field :valid_from, :map
    field :valid_until, :map
    field :expire_condition, :string

    field :version, :integer, default: 1

    field :tags, {:array, :string}

    field :source_id, Ecto.UUID
    field :last_referenced_at, :utc_datetime_usec

    timestamps(type: :utc_datetime_usec)
  end

  @doc """
  创建 changeset。用于新建记忆记录。
  """
  def changeset(struct, attrs) do
    struct
    |> cast(attrs, [
      :id,
      :work_id,
      :volume_id,
      :arc_id,
      :chapter_id,
      :content,
      :summary,
      :type,
      :scope,
      :status,
      :source_type,
      :reference_count,
      :weight,
      :confidence,
      :source_confidence,
      :locked,
      :recallable,
      :common_sense,
      :valid_from,
      :valid_until,
      :expire_condition,
      :version,
      :tags,
      :source_id,
      :last_referenced_at
    ])
    |> validate_required(@required_fields)
    |> validate_inclusion(:type, MemoryType.values())
    |> validate_inclusion(:scope, MemoryScope.values())
    |> validate_inclusion(:status, MemoryStatus.values())
    |> validate_inclusion(:source_type, MemorySourceType.values())
    |> validate_number(:weight, greater_than_or_equal_to: 0.0, less_than_or_equal_to: 1.0)
    |> validate_number(:confidence, greater_than_or_equal_to: 0.0, less_than_or_equal_to: 1.0)
    |> validate_number(:source_confidence, greater_than_or_equal_to: 0.0, less_than_or_equal_to: 1.0)
    |> validate_number(:version, greater_than_or_equal_to: 1)
    |> unique_constraint(:id, name: "memory_items_pkey")
  end

  @doc """
  更新 changeset。用于修改已存在的记忆记录。
  """
  def update_changeset(struct, attrs) do
    struct
    |> cast(attrs, [
      :content,
      :summary,
      :type,
      :scope,
      :status,
      :source_type,
      :weight,
      :confidence,
      :source_confidence,
      :locked,
      :recallable,
      :common_sense,
      :valid_from,
      :valid_until,
      :expire_condition,
      :tags,
      :source_id,
      :last_referenced_at
    ])
    |> validate_inclusion(:type, MemoryType.values())
    |> validate_inclusion(:scope, MemoryScope.values())
    |> validate_inclusion(:status, MemoryStatus.values())
    |> validate_inclusion(:source_type, MemorySourceType.values())
    |> validate_number(:weight, greater_than_or_equal_to: 0.0, less_than_or_equal_to: 1.0)
    |> validate_number(:confidence, greater_than_or_equal_to: 0.0, less_than_or_equal_to: 1.0)
    |> validate_number(:source_confidence, greater_than_or_equal_to: 0.0, less_than_or_equal_to: 1.0)
    |> validate_number(:version, greater_than_or_equal_to: 1)
  end
end
