defmodule NovelPersistence.Repo.Migrations.AddAuthoringTranscriptToAgentRuns do
  use Ecto.Migration

  def change do
    alter table(:agent_runs) do
      add(:authoring_transcript, :map)
    end
  end
end
