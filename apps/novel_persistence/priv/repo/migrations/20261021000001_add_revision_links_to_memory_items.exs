defmodule NovelPersistence.Repo.Migrations.AddRevisionLinksToMemoryItems do
  @moduledoc """
  Q1c 已采纳内容修订：给 memory_items 增加双向版本链。

  - `supersedes_ref`：新版本指向被它替代的旧版本。
  - `superseded_by_ref`：旧版本指向替代它的新版本。

  旧版本的退场状态是 `SUPERSEDED`（见 MemoryStatus）；普通召回只读
  CONFIRMED / STABILIZED，不依赖链字段，但链字段让档案历史和 replay 能回答
  “这一条被哪一版替代”。
  """

  use Ecto.Migration

  def change do
    alter table(:memory_items) do
      add(:supersedes_ref, :binary_id)
      add(:superseded_by_ref, :binary_id)
    end

    create(index(:memory_items, [:supersedes_ref]))
    create(index(:memory_items, [:superseded_by_ref]))
  end
end
