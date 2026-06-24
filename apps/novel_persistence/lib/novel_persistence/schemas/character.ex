defmodule NovelPersistence.Schemas.Character do
  @moduledoc """
  Ecto schema for `characters` table — 人物/角色资产。

  ## ADR refs
  - 21-novel-object-model.md §6.1 — Character 对象定义
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.NarrativeRole

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "characters" do
    field(:work_id, :binary_id)
    field(:name, :string)
    field(:aliases, {:array, :string})
    field(:role, :string)
    # narrative_role：结构化叙事角色分类（主角/反派/配角/次要/群像 POV）。
    # 与自由文本 role 互补——role 承载具体身份描述，narrative_role 是可校验的叙事功能事实。
    # 允许 nil（尚未标注主角，召回/查询时诚实报缺口，不默认第一个角色为主角）。
    field(:narrative_role, :string)
    field(:summary, :string)
    field(:status, :string, default: AdoptionStatus.tentative())

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(character, attrs) do
    character
    |> cast(attrs, [:work_id, :name, :aliases, :role, :narrative_role, :summary, :status])
    |> validate_required([:work_id, :name, :status])
    |> validate_inclusion(:status, AdoptionStatus.values())
    |> validate_inclusion(:narrative_role, NarrativeRole.values())
  end

  @doc "Mark a tentative character as accepted."
  def adopt_changeset(character) do
    character
    |> change(status: AdoptionStatus.accepted())
  end

  @doc "Mark a tentative character as discarded."
  def discard_changeset(character) do
    character
    |> change(status: AdoptionStatus.discarded())
  end
end
