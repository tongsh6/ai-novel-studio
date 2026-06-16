defmodule NovelPersistence.Repo.Migrations.CreateChapterSummaries do
  use Ecto.Migration

  # VS-00C CP2.1：章摘要（写后内容压缩的连续性对象，contract §5.2）。
  # 与 chapters.summary（计划摘要）是不同对象，独立表，anchor = chapter。
  def change do
    create table(:chapter_summaries, primary_key: false) do
      add(:id, :binary_id, primary_key: true)
      add(:work_id, :string, null: false)
      add(:chapter_id, :string, null: false)
      add(:status, :string, null: false)
      add(:summary_text, :text, null: false)
      add(:source_ref, :string)
      add(:revision_base, :string)

      timestamps(type: :utc_datetime_usec)
    end

    # current_accepted / supersede 按 (work_id, chapter_id, status) 命中。
    create(index(:chapter_summaries, [:work_id, :chapter_id, :status]))
    # list_recent_accepted 按作品维度取最近若干 ACCEPTED。
    create(index(:chapter_summaries, [:work_id, :status, :inserted_at]))
  end
end
