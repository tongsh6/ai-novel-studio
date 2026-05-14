defmodule NovelPersistence.Schemas.DecisionTraceRecord do
  @moduledoc """
  Persisted DecisionTrace — mirrors `NovelDomain.DecisionTrace`.

  Stored as a first-class table so traces survive across sessions and can be queried
  for replay, audit, and trace summary display.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "decision_traces" do
    field(:workspace_id, :string)
    field(:session_id, :binary_id)
    field(:trace_id, :string)
    field(:turn_id, :string)
    field(:frame_ref, :string)
    field(:decision_type, :string)
    field(:no_tool_reason, :string)
    field(:no_behavior_reason, :string)
    field(:no_write_reason, :string)
    field(:turn_result_ref, :string)
    field(:replay_policy, :map)
    field(:redaction_level, :string, default: "author_safe")
    field(:event_order, {:array, :string})
    field(:context_refs, {:array, :map})

    timestamps(type: :utc_datetime_usec)
  end

  @required_fields [
    :workspace_id,
    :trace_id,
    :turn_id,
    :frame_ref,
    :decision_type,
    :event_order
  ]
  @optional_fields [
    :session_id,
    :no_tool_reason,
    :no_behavior_reason,
    :no_write_reason,
    :turn_result_ref,
    :replay_policy,
    :redaction_level,
    :context_refs
  ]

  @spec changeset(%__MODULE__{}, map()) :: Ecto.Changeset.t()
  def changeset(struct, attrs) do
    struct
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> unique_constraint(:trace_id)
  end
end
