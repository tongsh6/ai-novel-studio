defmodule NovelPersistence.Repo.Migrations.CreateAuthorActionReceipts do
  use Ecto.Migration

  def change do
    create table(:author_action_receipts, primary_key: false) do
      add(:id, :binary_id, primary_key: true)
      add(:work_id, :string, null: false)
      add(:session_id, :string, null: false, default: "__none__")
      add(:source_turn_ref, :string, null: false)
      add(:action_id, :string, null: false)
      add(:action_type, :string, null: false)
      add(:idempotency_key, :string, null: false)
      add(:status, :string, null: false)
      add(:result, :map, null: false)

      timestamps(type: :utc_datetime_usec)
    end

    create(
      unique_index(
        :author_action_receipts,
        [
          :work_id,
          :session_id,
          :source_turn_ref,
          :action_id,
          :action_type,
          :idempotency_key
        ],
        name: :author_action_receipts_idempotency_key_index
      )
    )

    create(index(:author_action_receipts, [:work_id, :session_id, :inserted_at]))
  end
end
