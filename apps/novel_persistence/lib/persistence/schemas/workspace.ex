defmodule NovelPersistence.Schemas.Workspace do
  @moduledoc """
  第一张业务表 schema。Phase 0 Week 2 T5 用于打通 Ecto/Repo/migration 链路。

  字段规模有意保持最小（id / name / description / timestamps），
  避免与 paper_trail（T7）/ workspace 业务字段（Phase 1 真接入时）耦合。
  """

  use Ecto.Schema

  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "workspaces" do
    field :name, :string
    field :description, :string

    timestamps(type: :utc_datetime_usec)
  end

  @doc false
  def changeset(workspace, attrs) do
    workspace
    |> cast(attrs, [:name, :description])
    |> validate_required([:name])
    |> validate_length(:name, min: 1, max: 200)
    |> unique_constraint(:name)
  end
end
