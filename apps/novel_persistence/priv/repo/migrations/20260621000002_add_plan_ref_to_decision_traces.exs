defmodule NovelPersistence.Repo.Migrations.AddPlanRefToDecisionTraces do
  use Ecto.Migration

  def change do
    alter table(:decision_traces) do
      add(:plan_ref, :string)
    end
  end
end
