defmodule NovelPersistence.Repo.Migrations.AddUniqueChapterSeqIndex do
  @moduledoc """
  B25 CP3（I-CH-3）：`chapters.seq` 在 work 内唯一。

  `seq` 是作者可见章号（全书全局单调）的权威序号，账本 accepted_summaries_by_seq、
  阅读章列表、正文检索三处都按它排序；此前只有代码意图、无 DB 约束，并发/删行/旧数据
  都可能撞号。上线前必须先跑 `scripts/chapter_identity_audit.exs` 审计重复 seq，
  再跑 `scripts/chapter_identity_repair.exs --fix-dup-seq`（显式）修复。

  回滚：`MIX_ENV=<env> mix ecto.rollback`（仅回滚本迁移，不触碰数据）。
  """

  use Ecto.Migration

  def change do
    # 命名遵循 Ecto 默认约定（SQLite UNIQUE 错误不携带索引名，custom name 无法被
    # `unique_constraint/3` 匹配；用默认名 chapters_work_id_seq_index 才能转 changeset error）。
    create(unique_index(:chapters, [:work_id, :seq]))
  end
end
