defmodule NovelPersistence.Repo.Migrations.AddPlanDirectionToChapters do
  use Ecto.Migration

  # VS-00C CP4：章计划方向（E18-E22）与旧 summary 分开存储。
  def change do
    alter table(:chapters) do
      add :plan_direction, :map
    end
  end
end
