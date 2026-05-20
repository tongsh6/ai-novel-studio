defmodule NovelPersistence.Schemas.AuthorActionReceipt do
  @moduledoc """
  Persisted author action idempotency receipt.

  The receipt stores the ack that left the Channel for an idempotent action, so
  a later Channel process can suppress duplicate side effects and return the
  same semantic result.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "author_action_receipts" do
    field(:work_id, :string)
    field(:session_id, :string, default: "__none__")
    field(:source_turn_ref, :string)
    field(:action_id, :string)
    field(:action_type, :string)
    field(:idempotency_key, :string)
    field(:status, :string)
    field(:result, :map)

    timestamps(type: :utc_datetime_usec)
  end

  @required_fields [
    :work_id,
    :session_id,
    :source_turn_ref,
    :action_id,
    :action_type,
    :idempotency_key,
    :status,
    :result
  ]

  @spec changeset(%__MODULE__{}, map()) :: Ecto.Changeset.t()
  def changeset(receipt, attrs) do
    receipt
    |> cast(attrs, @required_fields)
    |> normalize_session()
    |> validate_required(@required_fields)
    |> unique_constraint(
      [:work_id, :session_id, :source_turn_ref, :action_id, :action_type, :idempotency_key],
      name: :author_action_receipts_idempotency_key_index
    )
    |> unique_constraint(:work_id,
      name:
        :author_action_receipts_work_id_session_id_source_turn_ref_action_id_action_type_idempotency_key_index
    )
  end

  defp normalize_session(changeset) do
    case get_field(changeset, :session_id) do
      nil -> put_change(changeset, :session_id, "__none__")
      _ -> changeset
    end
  end
end
