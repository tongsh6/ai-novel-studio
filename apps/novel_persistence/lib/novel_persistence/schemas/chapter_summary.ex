defmodule NovelPersistence.Schemas.ChapterSummary do
  @moduledoc """
  章摘要持久化 schema（VS-00C CP2.1 / contract §5.2）。

  写后内容压缩的连续性对象，anchor = chapter。状态走 artifact adoption 七态，
  转换合法性在领域层（`NovelDomain.ChapterSummary` / `NovelDomain.AdoptionStatus`）保证，
  本 schema 只做字段校验与取值合法性。
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias NovelFoundation.Enums.AdoptionStatus

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "chapter_summaries" do
    field(:work_id, :string)
    field(:chapter_id, :string)
    field(:status, :string)
    field(:summary_text, :string)
    field(:source_ref, :string)
    field(:revision_base, :string)

    timestamps(type: :utc_datetime_usec)
  end

  @required_fields [:work_id, :chapter_id, :status, :summary_text]
  @optional_fields [:source_ref, :revision_base]

  @spec changeset(%__MODULE__{}, map()) :: Ecto.Changeset.t()
  def changeset(summary, attrs) do
    summary
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:status, AdoptionStatus.values())
  end
end
