defmodule NovelPersistence.Repo.Migrations.AddMaterialScopeToChapterSummaries do
  use Ecto.Migration

  def change do
    alter table(:chapter_summaries) do
      add(:material_scope, :string)
    end
  end
end
