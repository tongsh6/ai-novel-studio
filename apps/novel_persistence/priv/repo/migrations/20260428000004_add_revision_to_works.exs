defmodule NovelPersistence.Repo.Migrations.AddRevisionToWorks do
  use Ecto.Migration

  def change do
    alter table(:works) do
      add :revision, :integer, null: false, default: 1
    end
  end
end
