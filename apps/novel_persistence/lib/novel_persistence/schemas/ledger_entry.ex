defmodule NovelPersistence.Schemas.LedgerEntry do
  @moduledoc """
  五本账统一信封持久化 schema（VS-00F §2 / ADR-0026）。

  分账领域状态机合法性在领域层（`NovelDomain.LedgerEntry`）保证；采纳态走
  artifact adoption 七态（正交分层）。source_refs 非空为 I-L1 的持久化兜底。
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias NovelFoundation.Enums.AdoptionStatus

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "ledger_entries" do
    field(:work_id, :string)
    field(:ledger, :string)
    field(:subject_kind, :string)
    field(:subject_ref, :string)
    field(:subject_label, :string)
    field(:design_ref, :string)
    field(:status, :string)
    field(:payload, :map, default: %{})
    field(:source_refs, {:array, :string}, default: [])
    field(:last_event_chapter, :string)
    field(:adoption_status, :string)
    field(:revision, :integer, default: 1)

    timestamps(type: :utc_datetime_usec)
  end

  @required_fields [
    :work_id,
    :ledger,
    :subject_kind,
    :subject_ref,
    :subject_label,
    :status,
    :adoption_status
  ]
  @optional_fields [:design_ref, :payload, :source_refs, :last_event_chapter, :revision]

  @spec changeset(%__MODULE__{}, map()) :: Ecto.Changeset.t()
  def changeset(entry, attrs) do
    entry
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:adoption_status, AdoptionStatus.values())
    |> validate_source_refs()
  end

  # I-L1 持久化兜底：空数组等于字段默认值时 cast 不记变更，validate_length 不触发，
  # 故对当前值显式校验（非空且不含空串）。
  defp validate_source_refs(changeset) do
    refs = get_field(changeset, :source_refs) || []

    if refs != [] and Enum.all?(refs, &(is_binary(&1) and &1 != "")) do
      changeset
    else
      add_error(changeset, :source_refs, "must be a non-empty list of non-blank refs")
    end
  end
end
