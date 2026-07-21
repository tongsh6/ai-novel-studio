defmodule NovelPersistence.Repo.Migrations.CreateReconciliationReports do
  use Ecto.Migration

  def change do
    create table(:reconciliation_reports, primary_key: false) do
      add(:id, :binary_id, primary_key: true)
      add(:work_id, :string, null: false)
      add(:findings, :map, null: false, default: %{})
      add(:finding_count, :integer, null: false, default: 0)
      add(:scanned_at_seq, :integer)
      add(:adoption_status, :string, null: false)

      timestamps(type: :utc_datetime_usec)
    end

    create(index(:reconciliation_reports, [:work_id, :adoption_status]))
  end
end
