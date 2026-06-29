defmodule NovelPersistence.Schemas.AgentRunStepRecord do
  @moduledoc """
  Persisted AgentStep proof refs for one bounded/durable AgentRun step.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :string, autogenerate: false}
  @foreign_key_type :string

  schema "agent_run_steps" do
    field(:run_id, :string)
    field(:sequence, :integer)
    field(:status, :string)
    field(:goal, :string)
    field(:micro_plan, :map)
    field(:micro_plan_ref, :string)
    field(:decision_ref, :string)
    field(:tool_request_ref, :string)
    field(:tool_result_ref, :string)
    field(:observation, :map)
    field(:observation_refs, {:array, :string}, default: [])
    field(:state_snapshot_ref, :string)
    field(:attempt, :integer, default: 1)
    field(:idempotency_key, :string)
    field(:failure_ref, :string)
    field(:started_at, :utc_datetime_usec)
    field(:completed_at, :utc_datetime_usec)

    timestamps(type: :utc_datetime_usec)
  end

  @required_fields [:id, :run_id, :sequence, :status, :goal, :idempotency_key]
  @optional_fields [
    :micro_plan,
    :micro_plan_ref,
    :decision_ref,
    :tool_request_ref,
    :tool_result_ref,
    :observation,
    :observation_refs,
    :state_snapshot_ref,
    :attempt,
    :failure_ref,
    :started_at,
    :completed_at
  ]

  def changeset(record, attrs) do
    record
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_number(:sequence, greater_than: 0)
    |> validate_number(:attempt, greater_than: 0)
    |> validate_inclusion(:status, ["proposed", "running", "completed", "failed", "cancelled", "skipped"])
    |> unique_constraint([:run_id, :sequence])
  end
end
