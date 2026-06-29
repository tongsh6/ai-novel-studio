defmodule NovelPersistence.Schemas.AgentEventRecord do
  @moduledoc """
  Persisted author-safe AgentEvent stream item.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :string, autogenerate: false}
  @foreign_key_type :string

  schema "agent_events" do
    field(:run_id, :string)
    field(:step_id, :string)
    field(:sequence, :integer)
    field(:event_type, :string)
    field(:visibility, :string, default: "author")
    field(:summary, :string)
    field(:reason_codes, {:array, :string}, default: [])
    field(:refs, {:array, :string}, default: [])
    field(:payload, :map)

    timestamps(type: :utc_datetime_usec)
  end

  @required_fields [:id, :run_id, :sequence, :event_type, :visibility, :summary]
  @optional_fields [:step_id, :reason_codes, :refs, :payload]

  def changeset(record, attrs) do
    record
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_number(:sequence, greater_than: 0)
    |> validate_inclusion(:visibility, ["author", "developer", "internal"])
    |> unique_constraint([:run_id, :sequence])
  end
end
