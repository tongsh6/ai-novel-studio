defmodule NovelPersistence.Schemas.Character do
  @moduledoc """
  Ecto schema for `characters` table — 人物/角色资产。

  ## ADR refs
  - 21-novel-object-model.md §6.1 — Character 对象定义
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias NovelFoundation.Enums.AdoptionStatus

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "characters" do
    field(:work_id, :binary_id)
    field(:name, :string)
    field(:aliases, {:array, :string})
    field(:role, :string)
    field(:summary, :string)
    field(:status, :string, default: AdoptionStatus.tentative())

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(character, attrs) do
    character
    |> cast(attrs, [:work_id, :name, :aliases, :role, :summary, :status])
    |> validate_required([:work_id, :name, :status])
    |> validate_inclusion(:status, AdoptionStatus.values())
  end
end
