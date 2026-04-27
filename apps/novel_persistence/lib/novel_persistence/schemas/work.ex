defmodule NovelPersistence.Schemas.Work do
  @moduledoc """
  Ecto schema for `works` table — the first Domain Object persistence.

  Phase 0 Week 4: 承载 CREATE_WORK_SEED 的 tentative → accepted 生命周期。
  """

  use Ecto.Schema

  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @valid_statuses ~w(tentative accepted discarded)

  schema "works" do
    field(:title, :string)
    field(:genre, :string)
    field(:status, :string, default: "tentative")
    field(:core_selling_point, :string)
    field(:target_reader, :string)
    field(:tone_preference, :string)
    field(:adopted_at, :utc_datetime_usec)

    timestamps(type: :utc_datetime_usec)
  end

  @doc false
  def changeset(work, attrs) do
    work
    |> cast(attrs, [
      :title,
      :genre,
      :status,
      :core_selling_point,
      :target_reader,
      :tone_preference,
      :adopted_at
    ])
    |> validate_required([:title, :status])
    |> validate_inclusion(:status, @valid_statuses)
  end

  @doc "Mark a tentative work as accepted."
  def adopt_changeset(work) do
    work
    |> change(status: "accepted", adopted_at: DateTime.utc_now())
  end
end
