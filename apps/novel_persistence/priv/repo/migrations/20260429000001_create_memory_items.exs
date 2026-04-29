defmodule NovelPersistence.Repo.Migrations.CreateMemoryItems do
  @moduledoc """
  创建 memory_items 表 — 05-memory-retention-and-retrieval.md §24.1。

  Governed Memory 层的核心持久化表。每条记录是一条可独立治理的创作事实。
  interactions 表保留用于 episodic memory log（回放/审计），本表独立存在。
  """

  use Ecto.Migration

  def change do
    create table(:memory_items, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :work_id, :binary_id, null: false

      add :volume_id, :binary_id
      add :arc_id, :binary_id
      add :chapter_id, :binary_id

      add :content, :text, null: false
      add :summary, :text

      add :type, :string, null: false
      add :scope, :string, null: false
      add :status, :string, null: false, default: "DRAFT"
      add :source_type, :string, null: false

      add :reference_count, :integer, null: false, default: 0

      add :weight, :decimal, precision: 5, scale: 4, null: false, default: 0.5000
      add :confidence, :decimal, precision: 5, scale: 4, null: false, default: 0.5000
      add :source_confidence, :decimal, precision: 5, scale: 4, null: false, default: 0.5000

      add :locked, :boolean, null: false, default: false
      add :recallable, :boolean, null: false, default: true
      add :common_sense, :boolean, null: false, default: false

      add :valid_from, :map
      add :valid_until, :map
      add :expire_condition, :text

      add :version, :integer, null: false, default: 1

      add :tags, {:array, :string}

      add :source_id, :binary_id
      add :last_referenced_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create index(:memory_items, [:work_id, :status, :type, :scope, :locked, :recallable])
    create index(:memory_items, [:work_id, :weight])
    create index(:memory_items, [:work_id, :source_type, :source_id])
  end
end
