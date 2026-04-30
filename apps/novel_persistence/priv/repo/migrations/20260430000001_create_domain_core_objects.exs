defmodule NovelPersistence.Repo.Migrations.CreateDomainCoreObjects do
  @moduledoc """
  创建 novel_domain 第一批核心对象的持久化表。

  表：volumes / chapters / scenes / drafts / characters
  对应 21-novel-object-model.md §5 主结构对象 + §6 资产对象。
  """

  use Ecto.Migration

  def change do
    create_volumes()
    create_chapters()
    create_scenes()
    create_drafts()
    create_characters()
  end

  defp create_volumes do
    create table(:volumes, primary_key: false) do
      add(:id, :binary_id, primary_key: true)
      add(:work_id, :binary_id, null: false)
      add(:title, :string, null: false)
      add(:seq, :integer, null: false)
      add(:status, :string, null: false, default: "PLANNED")

      timestamps(type: :utc_datetime_usec)
    end

    create(index(:volumes, [:work_id, :seq]))
    create(index(:volumes, [:work_id, :status]))
  end

  defp create_chapters do
    create table(:chapters, primary_key: false) do
      add(:id, :binary_id, primary_key: true)
      add(:work_id, :binary_id, null: false)
      add(:volume_id, :binary_id, null: false)
      add(:title, :string, null: false)
      add(:seq, :integer, null: false)
      add(:status, :string, null: false, default: "PLANNED")

      timestamps(type: :utc_datetime_usec)
    end

    create(index(:chapters, [:volume_id, :seq]))
    create(index(:chapters, [:work_id, :status]))
  end

  defp create_scenes do
    create table(:scenes, primary_key: false) do
      add(:id, :binary_id, primary_key: true)
      add(:work_id, :binary_id, null: false)
      add(:chapter_id, :binary_id, null: false)
      add(:title, :string, null: false)
      add(:seq, :integer, null: false)
      add(:status, :string, null: false, default: "PLANNED")

      timestamps(type: :utc_datetime_usec)
    end

    create(index(:scenes, [:chapter_id, :seq]))
    create(index(:scenes, [:work_id, :status]))
  end

  defp create_drafts do
    create table(:drafts, primary_key: false) do
      add(:id, :binary_id, primary_key: true)
      add(:work_id, :binary_id, null: false)
      add(:scene_id, :binary_id, null: false)
      add(:content, :text, null: false)
      add(:status, :string, null: false, default: "TENTATIVE")
      add(:revision, :integer, null: false, default: 1)

      timestamps(type: :utc_datetime_usec)
    end

    create(index(:drafts, [:scene_id, :status]))
    create(index(:drafts, [:work_id, :status]))
  end

  defp create_characters do
    create table(:characters, primary_key: false) do
      add(:id, :binary_id, primary_key: true)
      add(:work_id, :binary_id, null: false)
      add(:name, :string, null: false)
      add(:aliases, {:array, :string})
      add(:role, :string)
      add(:summary, :text)
      add(:status, :string, null: false, default: "TENTATIVE")

      timestamps(type: :utc_datetime_usec)
    end

    create(index(:characters, [:work_id, :status]))
    create(index(:characters, [:work_id, :name]))
  end
end
