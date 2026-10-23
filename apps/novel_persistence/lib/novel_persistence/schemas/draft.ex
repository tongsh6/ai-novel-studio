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

  alias NovelDomain.AdoptionStatus, as: AdoptionTransition
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
    |> validate_adoption_transition(attrs)
    |> optimistic_lock(:revision)
  end

  # ADR-0019（Q1Cb）：draft adoption 状态转换必须在持久化边界按矩阵校验。
  # 新建 struct 的 status 默认 TENTATIVE（初始态），因此首次以 ACCEPTED 落库等价
  # TENTATIVE→ACCEPTED 两步中的第二步；非法跳变（如 DISCARDED→ACCEPTED）被拒绝且
  # 错误可解释（changeset error "illegal adoption transition FROM -> TO"）。
  defp validate_adoption_transition(changeset, attrs) do
    from = changeset.data.status
    to = fetch_attr(attrs, :status)

    cond do
      is_nil(to) or is_nil(from) ->
        changeset

      to_string(from) == to_string(to) ->
        changeset

      AdoptionTransition.transition_allowed?(to_string(from), to_string(to)) ->
        changeset

      true ->
        add_error(changeset, :status, "illegal adoption transition #{from} -> #{to}")
    end
  end

  defp fetch_attr(attrs, key) when is_map(attrs),
    do: Map.get(attrs, key) || Map.get(attrs, Atom.to_string(key))

  defp fetch_attr(_attrs, _key), do: nil

  @doc "Mark a draft as accepted（经 changeset 的 ADR-0019 矩阵校验）。"
  def adopt_changeset(draft), do: changeset(draft, %{status: AdoptionStatus.accepted()})

  @doc "Mark a draft as discarded（经 changeset 的 ADR-0019 矩阵校验）。"
  def discard_changeset(draft), do: changeset(draft, %{status: AdoptionStatus.discarded()})

  @doc "Mark an accepted draft as superseded（ADR-0019 矩阵校验）。"
  def supersede_changeset(draft), do: changeset(draft, %{status: AdoptionStatus.superseded()})
end
