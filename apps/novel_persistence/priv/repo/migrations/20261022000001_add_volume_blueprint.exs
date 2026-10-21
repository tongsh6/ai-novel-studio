defmodule NovelPersistence.Repo.Migrations.AddVolumeBlueprint do
  # B11A CP1：卷级蓝图持久位（volumes.blueprint，map，nullable）。
  # 与 chapters.plan_direction / works.planning_direction 同构——设计态 map 容器，
  # 键集合随创作动作演化，用既有 map 列承载，零新业务列。键白名单/归一/
  # 三态（VolumeBlueprintStatus）由 NovelDomain.VolumeBlueprint 纯函数收敛。
  # 存量行 blueprint 为 NULL：TOC/探索/prompt/面板行为不变（VS-00J I-VOL-4）。
  use Ecto.Migration

  def change do
    alter table(:volumes) do
      add(:blueprint, :map)
    end
  end
end
