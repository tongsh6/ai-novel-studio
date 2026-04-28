defmodule NovelPersistence.Repo.Migrations.AddMemorySourceFields do
  @moduledoc """
  补齐 05-memory-retention-and-retrieval.md §5.1 要求的 6 个字段：

  - source_ref / scope_ref：来源与作用域引用
  - freshness_score / importance_score：检索排序因子
  - replayable / retrievable：replay vs retrieval 分离标记 (§7)
  """

  use Ecto.Migration

  def change do
    alter table(:interactions) do
      add :source_ref, :string
      add :scope_ref, :string
      add :freshness_score, :float, default: 0.5, null: false
      add :importance_score, :float, default: 0.5, null: false
      add :replayable, :boolean, default: true, null: false
      add :retrievable, :boolean, default: true, null: false
    end

    create index(:interactions, [:scope_ref])
    create index(:interactions, [:source_ref])
  end
end
