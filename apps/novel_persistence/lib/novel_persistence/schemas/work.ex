defmodule NovelPersistence.Schemas.Work do
  @moduledoc """
  Ecto schema for `works` table — the first Domain Object persistence.

  Phase 0 Week 4: 承载 CREATE_WORK_SEED 的 tentative → accepted 生命周期。

  ## ADR refs
  - ADR-0002 §5 — adoption 7 态映射到 Foundation status family
  - 30-contract-glossary §3.2 — adoption lifecycle 权威来源
  """

  use Ecto.Schema

  import Ecto.Changeset

  alias NovelFoundation.Enums.AdoptionStatus

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "works" do
    field(:title, :string)
    field(:genre, :string)
    field(:status, :string, default: AdoptionStatus.tentative())
    field(:core_selling_point, :string)
    field(:target_reader, :string)
    field(:tone_preference, :string)
    field(:adopted_at, :utc_datetime_usec)
    field(:revision, :integer, default: 1)

    timestamps(type: :utc_datetime_usec)
  end

  @doc false
  def changeset(work, attrs) do
    work
    |> cast(attrs, [
      :title,
      :genre,
      :status,
      :core_selling_point,
      :target_reader,
      :tone_preference,
      :adopted_at,
      :revision
    ])
    |> update_change(:title, &trim_title/1)
    |> maybe_optimistic_lock(work)
    |> validate_required([:title, :status])
    |> validate_length(:title, min: 1, max: 120)
    |> validate_inclusion(:status, AdoptionStatus.values())
  end

  @doc "Mark a tentative work as accepted. Includes optimistic_lock on revision."
  def adopt_changeset(work) do
    work
    |> change(status: AdoptionStatus.accepted(), adopted_at: DateTime.utc_now())
    |> optimistic_lock(:revision)
  end

  @doc "Mark a tentative work as discarded."
  def discard_changeset(work) do
    work
    |> change(status: AdoptionStatus.discarded())
    |> optimistic_lock(:revision)
  end

  defp trim_title(title) when is_binary(title), do: String.trim(title)
  defp trim_title(title), do: title

  defp maybe_optimistic_lock(changeset, %__MODULE__{__meta__: %{state: :built}}), do: changeset
  defp maybe_optimistic_lock(changeset, _work), do: optimistic_lock(changeset, :revision)
end
