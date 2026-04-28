defmodule NovelPersistence.Repo.Migrations.CreateMutations do
  @moduledoc """
  创建 mutations 表 — 07-consistency-and-concurrency.md §7.1。

  每次写入都是显式 mutation record：actor / source / target_scope /
  base_revision / proposed_change / authority_scope / requires_adoption。
  """

  use Ecto.Migration

  def change do
    create table(:mutations, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :actor_ref, :string, null: false
      add :source_turn_ref, :string, null: false
      add :source_task_ref, :string
      add :target_scope, :string, null: false
      add :target_object_ref, :string, null: false
      add :base_revision, :integer, null: false
      add :mutation_type, :string, null: false
      add :status, :string, null: false, default: "PROPOSED"
      add :proposed_change_ref, :string
      add :authority_scope, :string
      add :requires_adoption, :boolean, default: false

      timestamps(type: :utc_datetime_usec)
    end

    create index(:mutations, [:target_object_ref])
    create index(:mutations, [:source_turn_ref])
    create index(:mutations, [:status])
  end
end
