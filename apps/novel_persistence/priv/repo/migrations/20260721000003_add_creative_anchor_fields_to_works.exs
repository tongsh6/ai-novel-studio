defmodule NovelPersistence.Repo.Migrations.AddCreativeAnchorFieldsToWorks do
  use Ecto.Migration

  def change do
    alter table(:works) do
      add(:premise, :string)
      add(:theme, :string)
      add(:main_goal, :string)
    end
  end
end
