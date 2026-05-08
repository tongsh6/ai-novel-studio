defmodule NovelPersistence.Repo.Migrations.CreateDecisionTraces do
  use Ecto.Migration

  def change do
    create table(:decision_traces, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :workspace_id, :string, null: false
      add :trace_id, :string, null: false
      add :turn_id, :string, null: false
      add :frame_ref, :string, null: false
      add :decision_type, :string, null: false
      add :no_tool_reason, :string
      add :no_behavior_reason, :string
      add :no_write_reason, :string
      add :turn_result_ref, :string
      add :replay_policy, :map
      add :redaction_level, :string, null: false, default: "author_safe"
      add :event_order, {:array, :string}
      add :context_refs, {:array, :map}

      timestamps(type: :utc_datetime_usec)
    end

    create index(:decision_traces, [:workspace_id, :turn_id])
    create unique_index(:decision_traces, [:trace_id])
  end
end
