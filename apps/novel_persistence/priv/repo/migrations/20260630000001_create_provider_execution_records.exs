defmodule NovelPersistence.Repo.Migrations.CreateProviderExecutionRecords do
  use Ecto.Migration

  def change do
    create table(:provider_runs, primary_key: false) do
      add(:id, :string, primary_key: true)
      add(:provider_call_ref, :string, null: false)
      add(:agent_run_id, :string)
      add(:workspace_id, :string)
      add(:work_id, :string)
      add(:session_id, :string)
      add(:parent_turn_ref, :string)
      add(:step_id, :string)
      add(:purpose, :string, null: false)
      add(:execution_mode, :string, null: false)
      add(:status, :string, null: false)
      add(:provider_id, :string)
      add(:model, :string)
      add(:owner_refs, :map)
      add(:metadata, :map)
      add(:started_at, :utc_datetime_usec)
      add(:completed_at, :utc_datetime_usec)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:provider_runs, [:provider_call_ref]))
    create(index(:provider_runs, [:agent_run_id]))
    create(index(:provider_runs, [:work_id, :session_id]))

    create table(:provider_events, primary_key: false) do
      add(:id, :string, primary_key: true)
      add(:provider_run_id, :string, null: false)
      add(:provider_call_ref, :string, null: false)
      add(:agent_run_id, :string)
      add(:sequence, :integer, null: false)
      add(:event_type, :string, null: false)
      add(:visibility, :string, null: false)
      add(:summary, :text, null: false)
      add(:payload, :map)
      add(:refs, {:array, :string}, default: [])
      add(:emitted_at, :utc_datetime_usec)

      timestamps(type: :utc_datetime_usec)
    end

    create(index(:provider_events, [:provider_run_id]))
    create(index(:provider_events, [:agent_run_id]))
    create(unique_index(:provider_events, [:provider_run_id, :sequence]))

    create table(:provider_outputs, primary_key: false) do
      add(:provider_run_id, :string, primary_key: true)
      add(:provider_call_ref, :string, null: false)
      add(:agent_run_id, :string)
      add(:status, :string, null: false)
      add(:output_type, :string, null: false)
      add(:content_length, :integer)
      add(:content_summary, :map)
      add(:usage, :map)
      add(:error_summary, :map)
      add(:refs, {:array, :string}, default: [])
      add(:finalized_at, :utc_datetime_usec)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:provider_outputs, [:provider_call_ref]))
    create(index(:provider_outputs, [:agent_run_id]))
  end
end
