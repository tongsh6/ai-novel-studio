defmodule NovelPersistence.Repo.Migrations.AddBehaviorRefToAuthorActionReceipts do
  use Ecto.Migration

  # VS-00L §16.14：receipt 用同一事实表达“该行为已由哪个作者动作消费”。
  # 历史记录不回填；可空列 + 部分唯一索引，不改变旧语义。
  def change do
    alter table(:author_action_receipts) do
      add(:behavior_ref, :string, null: true)
    end

    create(
      unique_index(
        :author_action_receipts,
        [:work_id, :session_id, :behavior_ref],
        where: "behavior_ref IS NOT NULL",
        name: :author_action_receipts_behavior_ref_index
      )
    )
  end
end
