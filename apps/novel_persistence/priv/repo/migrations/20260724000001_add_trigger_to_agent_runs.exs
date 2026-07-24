defmodule NovelPersistence.Repo.Migrations.AddTriggerToAgentRuns do
  use Ecto.Migration

  def change do
    alter table(:agent_runs) do
      add(:trigger, :map)
    end
  end
end
