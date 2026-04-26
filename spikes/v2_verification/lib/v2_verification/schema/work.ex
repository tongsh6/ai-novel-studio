defmodule V2Verification.Schema.Work do
  use Ecto.Schema
  import Ecto.Changeset

  schema "works" do
    field :workspace_id, Ecto.UUID
    field :author_id, Ecto.UUID
    field :title, :string
    field :status, Ecto.Enum, values: [:draft, :active, :archived], default: :draft

    timestamps(type: :utc_datetime_usec)
  end

  @cast_fields [:workspace_id, :author_id, :title, :status]
  @required_fields [:workspace_id, :author_id, :title]

  def changeset(work, attrs) do
    work
    |> cast(attrs, @cast_fields)
    |> validate_required(@required_fields)
    |> validate_length(:title, min: 1, max: 200)
  end
end
