defmodule NovelPersistence.Schemas.AgentRunRecord do
  @moduledoc """
  Persisted AgentRun state for bounded/durable run audit and recovery evidence.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :string, autogenerate: false}
  @foreign_key_type :string

  schema "agent_runs" do
    field(:workspace_id, :string)
    field(:work_id, :string)
    field(:session_id, :string)
    field(:parent_turn_ref, :string)
    field(:origin_frame_ref, :string)
    field(:run_mode, :string)
    field(:profile_ref, :string)
    field(:trigger, :map)
    field(:status, :string)
    field(:phase, :string)
    field(:goal, :map)
    field(:goal_version, :integer, default: 1)
    field(:plan, :map)
    field(:plan_ref, :string)
    field(:plan_version, :integer, default: 1)
    field(:run_policy, :map)
    field(:authority_scope, :map)
    field(:budget, :map)
    field(:consumed_budget, :map)
    field(:current_step_ref, :string)
    field(:completed_step_refs, {:array, :string}, default: [])
    field(:pending_artifact_refs, {:array, :string}, default: [])
    field(:active_behavior_ref, :string)
    field(:interrupt_state, :map)
    field(:long_run_task_ref, :string)
    field(:failure_ref, :string)
    field(:completed_at, :utc_datetime_usec)

    timestamps(type: :utc_datetime_usec)
  end

  @required_fields [
    :id,
    :workspace_id,
    :work_id,
    :session_id,
    :parent_turn_ref,
    :origin_frame_ref,
    :run_mode,
    :profile_ref,
    :status,
    :phase
  ]
  @optional_fields [
    :goal,
    :trigger,
    :goal_version,
    :plan,
    :plan_ref,
    :plan_version,
    :run_policy,
    :authority_scope,
    :budget,
    :consumed_budget,
    :current_step_ref,
    :completed_step_refs,
    :pending_artifact_refs,
    :active_behavior_ref,
    :interrupt_state,
    :long_run_task_ref,
    :failure_ref,
    :completed_at
  ]

  def changeset(record, attrs) do
    record
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:run_mode, ["bounded", "durable"])
    |> validate_inclusion(:status, [
      "created",
      "running",
      "pausing",
      "cancelling",
      "paused",
      "awaiting_author",
      "completed",
      "cancelled",
      "failed"
    ])
    |> validate_inclusion(:phase, ["planning", "executing", "finalizing", "stopped"])
  end
end
