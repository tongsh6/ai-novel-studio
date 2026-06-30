defmodule NovelPersistence.Schemas.ProviderEventRecord do
  @moduledoc """
  Persisted sanitized ProviderExecution event.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :string, autogenerate: false}
  @foreign_key_type :string

  schema "provider_events" do
    field(:provider_run_id, :string)
    field(:provider_call_ref, :string)
    field(:agent_run_id, :string)
    field(:sequence, :integer)
    field(:event_type, :string)
    field(:visibility, :string)
    field(:summary, :string)
    field(:payload, :map)
    field(:refs, {:array, :string}, default: [])
    field(:emitted_at, :utc_datetime_usec)

    timestamps(type: :utc_datetime_usec)
  end

  @required_fields [
    :id,
    :provider_run_id,
    :provider_call_ref,
    :sequence,
    :event_type,
    :visibility,
    :summary
  ]
  @optional_fields [:agent_run_id, :payload, :refs, :emitted_at]

  def changeset(record, attrs) do
    record
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_number(:sequence, greater_than: 0)
    |> validate_inclusion(:event_type, [
      "started",
      "progress",
      "chunk",
      "final_output",
      "usage_recorded",
      "error",
      "cancel_requested",
      "cancelled"
    ])
    |> validate_inclusion(:visibility, ["author", "developer", "internal"])
    |> unique_constraint([:provider_run_id, :sequence])
  end
end
