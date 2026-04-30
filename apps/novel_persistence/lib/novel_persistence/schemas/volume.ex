defmodule NovelPersistence.Schemas.Volume do
  @moduledoc """
  Ecto schema for `volumes` table — 小说的卷结构单元。

  ## ADR refs
  - 21-novel-object-model.md §5.2 — Volume 对象定义
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias NovelFoundation.Enums.StructureStatus

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "volumes" do
    field(:work_id, :binary_id)
    field(:title, :string)
    field(:seq, :integer)
    field(:status, :string, default: StructureStatus.planned())

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(volume, attrs) do
    volume
    |> cast(attrs, [:work_id, :title, :seq, :status])
    |> validate_required([:work_id, :title, :seq, :status])
    |> validate_inclusion(:status, StructureStatus.values())
    |> validate_number(:seq, greater_than: 0)
  end
end
