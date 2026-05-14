defmodule NovelPersistence.Repo.Migrations.CreateWorkSessions do
  use Ecto.Migration

  def change do
    create table(:work_sessions, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :work_id, references(:works, type: :binary_id, on_delete: :delete_all), null: false
      add :title, :string, null: false
      add :summary, :text
      add :status, :string, null: false, default: "ACTIVE"
      add :source_session_ref, :binary_id
      add :source_turn_ref, :string
      add :last_opened_at, :utc_datetime_usec, null: false

      timestamps(type: :utc_datetime_usec)
    end

    create index(:work_sessions, [:work_id, :status, :last_opened_at])
    create index(:work_sessions, [:work_id, :updated_at])

    alter table(:interactions) do
      add :session_id, references(:work_sessions, type: :binary_id, on_delete: :nilify_all)
    end

    create index(:interactions, [:session_id, :inserted_at])

    alter table(:decision_traces) do
      add :session_id, references(:work_sessions, type: :binary_id, on_delete: :nilify_all)
    end

    create index(:decision_traces, [:session_id, :turn_id])
  end
end
