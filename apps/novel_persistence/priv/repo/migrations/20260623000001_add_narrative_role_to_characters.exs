defmodule NovelPersistence.Repo.Migrations.AddNarrativeRoleToCharacters do
  use Ecto.Migration

  # AU-09 角色类型/主角语义：结构化叙事角色分类（主角/反派/配角/次要/群像 POV）。
  # 与自由文本 role 互补，使"主角是谁"成为可校验事实；允许 nil（尚未标注主角）。
  def change do
    alter table(:characters) do
      add :narrative_role, :string
    end
  end
end
