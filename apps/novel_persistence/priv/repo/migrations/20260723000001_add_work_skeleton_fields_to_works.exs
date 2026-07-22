defmodule NovelPersistence.Repo.Migrations.AddWorkSkeletonFieldsToWorks do
  # VS-00G CP3：全书骨架立项字段（34 §4.1 设计清单已列、从未实现；NEM-GAP-08）。
  # target_length 整数（目标字数），planned_volumes 整数（预计卷数），
  # serial_form 字符串（连载形态：连载/买断/短篇集，自由文本+建议值）。
  use Ecto.Migration

  def change do
    alter table(:works) do
      add(:target_length, :integer)
      add(:planned_volumes, :integer)
      add(:serial_form, :string)
    end
  end
end
