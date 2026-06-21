defmodule NovelPersistence.Repo.Migrations.AddReplayTraceRefsToDecisionTraces do
  use Ecto.Migration

  def change do
    alter table(:decision_traces) do
      add(:tool_trace_refs, {:array, :map})
      add(:behavior_trace_refs, {:array, :map})
      add(:state_trace_refs, {:array, :map})
    end
  end
end
