defmodule NovelPersistence.Repo.Migrations.AddFiniteModeNameToProviderRuns do
  use Ecto.Migration

  # VS-00L §6.4（2026-11-06 作者裁决 D）：有限模式必须进入持久执行事实。
  # name 单独成列以便查询/筛选；完整声明（not_supported / durable_recovery）仍保存在
  # metadata.finite_mode。可空列，历史行不回填。
  def change do
    alter table(:provider_runs) do
      add(:finite_mode_name, :string, null: true)
    end

    create(
      index(:provider_runs, [:finite_mode_name], name: :provider_runs_finite_mode_name_index)
    )
  end
end
