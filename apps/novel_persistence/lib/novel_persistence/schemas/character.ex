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
  alias NovelFoundation.Enums.ProvisionalSource

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
    # VS-00G §2.3 工作假定（零新实体）：既有 tentative 态 + 来源/暂用两标注位。
    # provisional_source=AI_ASSUMPTION（AI 假定，非作者候选）；provisional_active=true
    # 表示正被带【暂定】标注注入。生命周期复用既有 AdoptionStatus 状态机。
    field(:provisional_source, :string)
    field(:provisional_active, :boolean, default: false)

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(character, attrs) do
    character
    |> cast(attrs, [
      :work_id,
      :name,
      :aliases,
      :role,
      :narrative_role,
      :summary,
      :status,
      :provisional_source,
      :provisional_active
    ])
    |> validate_required([:work_id, :name, :status])
    |> validate_inclusion(:status, AdoptionStatus.values())
    |> validate_inclusion(:narrative_role, NarrativeRole.values())
    |> validate_inclusion(:provisional_source, ProvisionalSource.values())
  end

  @doc "Mark a tentative character as accepted（就地转正：假定停止注入，标注消失）."
  def adopt_changeset(character) do
    character
    |> change(status: AdoptionStatus.accepted(), provisional_active: false)
  end

  @doc "Mark a tentative character as discarded（否决：停注入，同一要素不自动重提）."
  def discard_changeset(character) do
    character
    |> change(status: AdoptionStatus.discarded(), provisional_active: false)
  end
end
