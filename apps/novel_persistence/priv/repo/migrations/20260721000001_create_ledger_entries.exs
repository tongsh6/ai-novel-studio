defmodule NovelPersistence.Repo.Migrations.CreateLedgerEntries do
  use Ecto.Migration

  def change do
    create table(:ledger_entries, primary_key: false) do
      add(:id, :binary_id, primary_key: true)
      add(:work_id, :string, null: false)
      add(:ledger, :string, null: false)
      add(:subject_kind, :string, null: false)
      add(:subject_ref, :string, null: false)
      add(:subject_label, :string, null: false)
      add(:design_ref, :string)
      add(:status, :string, null: false)
      add(:payload, :map, null: false, default: %{})
      add(:source_refs, {:array, :string}, null: false, default: [])
      add(:last_event_chapter, :string)
      add(:adoption_status, :string, null: false)
      add(:revision, :integer, null: false, default: 1)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:ledger_entries, [:work_id, :ledger, :subject_ref]))
    create(index(:ledger_entries, [:work_id, :ledger]))
  end
end
