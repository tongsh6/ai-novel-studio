defmodule NovelPersistence.Repo.Migrations.CreateMemoryReferenceLogs do
  @moduledoc """
  创建 memory_reference_logs 表 — 记忆引用追踪。

  每次召回后异步写入引用记录，用于追溯“哪个场景因为什么原因引用了哪条记忆”。
  """

  use Ecto.Migration

  def change do
    create table(:memory_reference_logs, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :memory_id, :binary_id, null: false
      add :work_id, :binary_id, null: false
      add :task_id, :binary_id
      add :conversation_id, :binary_id
      add :reference_scene, :string, null: false
      add :reference_reason, :text

      timestamps(type: :utc_datetime_usec, updated_at: false)
    end

    create index(:memory_reference_logs, [:memory_id])
    create index(:memory_reference_logs, [:work_id, :reference_scene])
  end
end
