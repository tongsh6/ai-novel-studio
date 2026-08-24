defmodule NovelPersistence.Repo.Migrations.AddPlanningDirectionToWorks do
  # WR01c：规划使命持久位（works.planning_direction，map，键 "planning_mission"）。
  # 与 chapters.plan_direction 同构——工作级规划设计态容器，作者裁决走
  # ChapterMissionStatus 状态机（TENTATIVE/CONFIRMED/AUTHOR_EDITED，作废=删键）。
  use Ecto.Migration

  def change do
    alter table(:works) do
      add(:planning_direction, :map)
    end
  end
end
