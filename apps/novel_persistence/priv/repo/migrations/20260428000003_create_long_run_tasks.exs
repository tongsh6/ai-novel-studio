defmodule NovelPersistence.Repo.Migrations.CreateLongRunTasks do
  use Ecto.Migration

  def change do
    create table(:long_run_tasks, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :workspace_id, :string, null: false
      add :task_type, :string, null: false
      add :status, :string, null: false, default: "running"
      add :phase, :string, null: false, default: "running"
      add :goal, :text
      add :checkpoint_data, :map
      add :completed_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create index(:long_run_tasks, [:workspace_id, :status])
  end
end
