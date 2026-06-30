defmodule NovelPersistence.Schemas.ProviderOutputRecord do
  @moduledoc """
  Persisted ProviderExecution terminal output summary.

  This schema intentionally stores summary fields only; raw provider text,
  prompts, raw errors, and private reasoning are not persisted here.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:provider_run_id, :string, autogenerate: false}
  @foreign_key_type :string

  schema "provider_outputs" do
    field(:provider_call_ref, :string)
    field(:agent_run_id, :string)
    field(:status, :string)
    field(:output_type, :string)
    field(:content_length, :integer)
    field(:content_summary, :map)
    field(:usage, :map)
    field(:error_summary, :map)
    field(:refs, {:array, :string}, default: [])
    field(:finalized_at, :utc_datetime_usec)

    timestamps(type: :utc_datetime_usec)
  end

  @required_fields [:provider_run_id, :provider_call_ref, :status, :output_type]
  @optional_fields [
    :agent_run_id,
    :content_length,
    :content_summary,
    :usage,
    :error_summary,
    :refs,
    :finalized_at
  ]

  def changeset(record, attrs) do
    record
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:status, ["ok", "error", "cancelled"])
    |> validate_inclusion(:output_type, ["text", "json", "empty"])
    |> validate_number(:content_length, greater_than_or_equal_to: 0)
    |> unique_constraint(:provider_call_ref)
  end
end
