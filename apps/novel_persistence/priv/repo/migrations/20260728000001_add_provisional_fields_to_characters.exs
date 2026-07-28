defmodule NovelPersistence.Repo.Migrations.AddProvisionalFieldsToCharacters do
  use Ecto.Migration

  # VS-00G CP5（§2.3 工作假定，零新实体）：既有 tentative 对象加来源/暂用两标注位。
  # provisional_source=AI_ASSUMPTION 区分「AI 假定」与普通作者候选（nil）；
  # provisional_active=true 表示该假定正被带【暂定】标注注入写作/规划。
  def change do
    alter table(:characters) do
      add(:provisional_source, :string)
      add(:provisional_active, :boolean, default: false, null: false)
    end
  end
end
