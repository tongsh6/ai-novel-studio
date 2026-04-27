defmodule NovelPersistence.Repo.Migrations.AddVersions do
  use Ecto.Migration

  @moduledoc """
  paper_trail revision audit table。binary_id 模式：item_id / originator_id 都用 uuid。

  与 paper_trail 默认 install task 的差异：
  - item_id / originator_id 从 :integer / references(:users) 改为 :binary_id
  - 不引用 users 表（Phase 0 暂无 users 表；originator 关系在 config 里 `define_field: false`）
  - id 保持默认 bigserial（paper_trail Version schema 的 @primary_key 约定）
  """

  def change do
    create table(:versions) do
      add :event, :string, null: false, size: 10
      add :item_type, :string, null: false
      add :item_id, :binary_id
      add :item_changes, :map, null: false
      add :originator_id, :binary_id
      add :origin, :string, size: 50
      add :meta, :map

      add :inserted_at, :utc_datetime_usec, null: false
    end

    create index(:versions, [:originator_id])
    create index(:versions, [:item_id, :item_type])
  end
end
