defmodule NovelPersistence.Repo.Migrations.AddProviderOperationCheckpoint do
  use Ecto.Migration

  # VS-00L §16.2.1: pending operation bytes are private, not activity metadata.
  # Existing author data remains intact; missing historical response bytes stay unknown.
  def change do
    alter table(:provider_runs) do
      add(:operation_checkpoint, :map)
    end
  end
end
