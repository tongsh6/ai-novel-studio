defmodule NovelPersistence.Repo.Migrations.CreateInteractions do
  use Ecto.Migration

  def change do
    create table(:interactions, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :workspace_id, :string, null: false
      add :turn_id, :string, null: false
      add :role, :string, null: false
      add :content, :map, null: false
      add :memory_class, :string, null: false, default: "episodic"
      add :retention_tier, :string, null: false, default: "hot"
      add :source_type, :string, null: false, default: "turn"

      timestamps(type: :utc_datetime_usec)
    end

    create index(:interactions, [:workspace_id, :turn_id])
    create index(:interactions, [:retention_tier])
  end
end
