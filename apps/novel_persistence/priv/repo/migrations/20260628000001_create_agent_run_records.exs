defmodule NovelPersistence.Repo.Migrations.CreateAgentRunRecords do
  use Ecto.Migration

  def change do
    create table(:agent_runs, primary_key: false) do
      add :id, :string, primary_key: true
      add :workspace_id, :string, null: false
      add :work_id, :string, null: false
      add :session_id, :string, null: false
      add :parent_turn_ref, :string, null: false
      add :origin_frame_ref, :string, null: false
      add :run_mode, :string, null: false
      add :profile_ref, :string, null: false
      add :status, :string, null: false
      add :phase, :string, null: false
      add :goal, :map
      add :goal_version, :integer, null: false, default: 1
      add :plan, :map
      add :plan_ref, :string
      add :plan_version, :integer, null: false, default: 1
      add :run_policy, :map
      add :authority_scope, :map
      add :budget, :map
      add :consumed_budget, :map
      add :current_step_ref, :string
      add :completed_step_refs, {:array, :string}, default: []
      add :pending_artifact_refs, {:array, :string}, default: []
      add :active_behavior_ref, :string
      add :interrupt_state, :map
      add :long_run_task_ref, :string
      add :failure_ref, :string
      add :completed_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create index(:agent_runs, [:work_id, :status])
    create index(:agent_runs, [:session_id])
    create index(:agent_runs, [:parent_turn_ref])

    create table(:agent_run_steps, primary_key: false) do
      add :id, :string, primary_key: true
      add :run_id, :string, null: false
      add :sequence, :integer, null: false
      add :status, :string, null: false
      add :goal, :text, null: false
      add :micro_plan, :map
      add :micro_plan_ref, :string
      add :decision_ref, :string
      add :tool_request_ref, :string
      add :tool_result_ref, :string
      add :observation, :map
      add :observation_refs, {:array, :string}, default: []
      add :state_snapshot_ref, :string
      add :attempt, :integer, null: false, default: 1
      add :idempotency_key, :string, null: false
      add :failure_ref, :string
      add :started_at, :utc_datetime_usec
      add :completed_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create index(:agent_run_steps, [:run_id])
    create unique_index(:agent_run_steps, [:run_id, :sequence])

    create table(:agent_events, primary_key: false) do
      add :id, :string, primary_key: true
      add :run_id, :string, null: false
      add :step_id, :string
      add :sequence, :integer, null: false
      add :event_type, :string, null: false
      add :visibility, :string, null: false, default: "author"
      add :summary, :text, null: false
      add :reason_codes, {:array, :string}, default: []
      add :refs, {:array, :string}, default: []
      add :payload, :map

      timestamps(type: :utc_datetime_usec)
    end

    create index(:agent_events, [:run_id])
    create unique_index(:agent_events, [:run_id, :sequence])
  end
end
