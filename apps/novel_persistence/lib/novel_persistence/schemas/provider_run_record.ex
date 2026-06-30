defmodule NovelPersistence.Schemas.ProviderRunRecord do
  @moduledoc """
  Persisted author-safe summary for one ProviderExecution run.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :string, autogenerate: false}
  @foreign_key_type :string

  schema "provider_runs" do
    field(:provider_call_ref, :string)
    field(:agent_run_id, :string)
    field(:workspace_id, :string)
    field(:work_id, :string)
    field(:session_id, :string)
    field(:parent_turn_ref, :string)
    field(:step_id, :string)
    field(:purpose, :string)
    field(:execution_mode, :string)
    field(:status, :string)
    field(:provider_id, :string)
    field(:model, :string)
    field(:owner_refs, :map)
    field(:metadata, :map)
    field(:started_at, :utc_datetime_usec)
    field(:completed_at, :utc_datetime_usec)

    timestamps(type: :utc_datetime_usec)
  end

  @required_fields [:id, :provider_call_ref, :purpose, :execution_mode, :status]
  @optional_fields [
    :agent_run_id,
    :workspace_id,
    :work_id,
    :session_id,
    :parent_turn_ref,
    :step_id,
    :provider_id,
    :model,
    :owner_refs,
    :metadata,
    :started_at,
    :completed_at
  ]

  def changeset(record, attrs) do
    record
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:purpose, [
      "conversation",
      "planner",
      "writer",
      "evaluator",
      "revision",
      "tool",
      "narration",
      "other"
    ])
    |> validate_inclusion(:execution_mode, ["event_stream"])
    |> validate_inclusion(:status, [
      "initialized",
      "running",
      "completed",
      "failed",
      "cancel_requested",
      "cancelled"
    ])
    |> unique_constraint(:provider_call_ref)
  end
end
