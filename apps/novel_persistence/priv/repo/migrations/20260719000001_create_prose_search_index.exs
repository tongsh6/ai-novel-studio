defmodule NovelPersistence.Repo.Migrations.CreateProseSearchIndex do
  use Ecto.Migration

  @moduledoc """
  CP5 探索内部翼 `prose_search`：已采纳正文的 FTS5 全文索引。

  选型见 spikes/fts_chinese_search（trigram tokenizer：≥3 字 MATCH 带
  bm25/snippet，<3 字 LIKE 回退仍走 trigram 索引）。索引由 ProseSearchRepo
  按 accepted drafts 水位惰性重建（机械导出物，采纳写路径零耦合），故降级
  安全：删表即失索引，不失任何真源数据。
  """

  def up do
    execute("""
    CREATE VIRTUAL TABLE prose_search_index USING fts5(
      work_id UNINDEXED,
      chapter_id UNINDEXED,
      chapter_title,
      content,
      tokenize='trigram'
    )
    """)

    create table(:prose_search_watermarks, primary_key: false) do
      add(:work_id, :binary_id, primary_key: true)
      add(:indexed_at, :utc_datetime_usec, null: false)
      add(:draft_watermark, :utc_datetime_usec)
    end
  end

  def down do
    drop(table(:prose_search_watermarks))
    execute("DROP TABLE prose_search_index")
  end
end
