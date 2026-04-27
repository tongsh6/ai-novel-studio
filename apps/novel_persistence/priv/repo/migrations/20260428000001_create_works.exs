defmodule NovelPersistence.Repo.Migrations.CreateWorks do
  use Ecto.Migration

  def change do
    create table(:works, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :title, :string, null: false
      add :genre, :string
      add :status, :string, null: false, default: "tentative"
      add :core_selling_point, :text
      add :target_reader, :text
      add :tone_preference, :text
      add :adopted_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create index(:works, [:status])
  end
end
