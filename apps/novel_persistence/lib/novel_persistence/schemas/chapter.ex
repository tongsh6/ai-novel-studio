defmodule NovelPersistence.Schemas.Chapter do
  @moduledoc """
  Ecto schema for `chapters` table — 小说的章结构单元。

  ## ADR refs
  - 21-novel-object-model.md §5.3 — Chapter 对象定义
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias NovelFoundation.Enums.StructureStatus

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "chapters" do
    field(:work_id, :binary_id)
    field(:volume_id, :binary_id)
    field(:title, :string)
    field(:seq, :integer)
    field(:status, :string, default: StructureStatus.planned())

    # 章的大纲摘要（采纳章节计划时落到结构上）：结构即大纲，目录/面板单一数据源读它。
    field(:summary, :string)
    # VS-00C CP4：E18-E22 写前方向结构，保持与自由文本 summary 分离。
    field(:plan_direction, :map)

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(chapter, attrs) do
    chapter
    |> cast(attrs, [:work_id, :volume_id, :title, :seq, :status, :summary, :plan_direction])
    |> validate_required([:work_id, :volume_id, :title, :seq, :status])
    |> validate_inclusion(:status, StructureStatus.values())
    |> validate_number(:seq, greater_than: 0)
  end
end
