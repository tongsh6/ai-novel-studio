defmodule NovelPersistence.Schemas.ChapterSummary do
  @moduledoc """
  章摘要持久化 schema（VS-00C CP2.1 / contract §5.2）。

  写后内容压缩的连续性对象，anchor = chapter。状态走 artifact adoption 七态，
  转换合法性在持久化边界按 ADR-0019 单一矩阵校验（同 `Schemas.Draft` 先例，
  B44）：已有行的 status 变更须过 `NovelDomain.AdoptionStatus.transition_allowed?/2`。
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.StatusTransition

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "chapter_summaries" do
    field(:work_id, :string)
    field(:chapter_id, :string)
    field(:status, :string, default: AdoptionStatus.tentative())
    field(:summary_text, :string)
    field(:source_ref, :string)
    field(:revision_base, :string)

    timestamps(type: :utc_datetime_usec)
  end

  @type t :: %__MODULE__{}

  @required_fields [:work_id, :chapter_id, :status, :summary_text]
  @optional_fields [:source_ref, :revision_base]

  @spec changeset(%__MODULE__{}, map()) :: Ecto.Changeset.t()
  def changeset(summary, attrs) do
    summary
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:status, AdoptionStatus.values())
    |> StatusTransition.validate(:status, attrs,
      allowed?: &NovelDomain.AdoptionStatus.transition_allowed?/2,
      kind: "adoption"
    )
  end
end
