defmodule NovelPersistence.Schemas.Chapter do
  @moduledoc """
  Ecto schema for `chapters` table — 小说的章结构单元。

  ## ADR refs
  - 21-novel-object-model.md §5.3 — Chapter 对象定义
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias NovelFoundation.Enums.StructureStatus

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "chapters" do
    field(:work_id, :binary_id)
    field(:volume_id, :binary_id)
    field(:title, :string)
    field(:seq, :integer)
    field(:status, :string, default: StructureStatus.planned())

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(chapter, attrs) do
    chapter
    |> cast(attrs, [:work_id, :volume_id, :title, :seq, :status])
    |> validate_required([:work_id, :volume_id, :title, :seq, :status])
    |> validate_inclusion(:status, StructureStatus.values())
    |> validate_number(:seq, greater_than: 0)
  end
end
