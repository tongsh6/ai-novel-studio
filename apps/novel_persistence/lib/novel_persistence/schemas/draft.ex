defmodule NovelPersistence.Schemas.Draft do
  @moduledoc """
  Ecto schema for `drafts` table — AI 生成文本的持久化。

  Draft 必须归属到一个 Scene。使用 AdoptionStatus 枚举 + revision 乐观锁。

  ## ADR refs
  - 21-novel-object-model.md §5.4 — Draft 对象定义
  - ADR-0002 §5 — adoption 状态映射
  - 07-consistency-and-concurrency.md — revision 乐观锁
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias NovelFoundation.Enums.AdoptionStatus

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "drafts" do
    field(:work_id, :binary_id)
    field(:scene_id, :binary_id)
    field(:content, :string)
    field(:status, :string, default: AdoptionStatus.tentative())
    field(:revision, :integer, default: 1)

    timestamps(type: :utc_datetime_usec)
  end

  def changeset(draft, attrs) do
    draft
    |> cast(attrs, [:work_id, :scene_id, :content, :status, :revision])
    |> validate_required([:work_id, :scene_id, :content, :status])
    |> validate_inclusion(:status, AdoptionStatus.values())
    |> optimistic_lock(:revision)
  end

  @doc "Mark a tentative draft as accepted."
  def adopt_changeset(draft) do
    draft
    |> change(status: AdoptionStatus.accepted())
    |> optimistic_lock(:revision)
  end

  @doc "Mark a tentative draft as discarded."
  def discard_changeset(draft) do
    draft
    |> change(status: AdoptionStatus.discarded())
    |> optimistic_lock(:revision)
  end
end
