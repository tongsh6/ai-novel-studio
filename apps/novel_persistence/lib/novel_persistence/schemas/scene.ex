defmodule NovelPersistence.Schemas.Scene do
  @moduledoc """
  Ecto schema for `scenes` table — 小说的场景结构单元。

  ## ADR refs
  - 21-novel-object-model.md §5.4 — Scene 对象定义
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias NovelFoundation.Enums.StructureStatus

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "scenes" do
    field(:work_id, :binary_id)
    field(:chapter_id, :binary_id)
    field(:title, :string)
    field(:seq, :integer)
    field(:status, :string, default: StructureStatus.planned())

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(scene, attrs) do
    scene
    |> cast(attrs, [:work_id, :chapter_id, :title, :seq, :status])
    |> validate_required([:work_id, :chapter_id, :title, :seq, :status])
    |> validate_inclusion(:status, StructureStatus.values())
    |> validate_number(:seq, greater_than: 0)
  end
end
