defmodule NovelPersistence.Schemas.Foundation.TurnResult do
  @moduledoc """
  Mirrors `docs/design/schemas/foundation/turn_result_v2.json` (ADR-0001 §1).

  Phase 0 simplifications (intentional, will tighten as downstream ADRs land):

  - `phase` / `status` / `next_action` / behavior_status: stored as :string until
    ADR-0002 lands enums to `foundation/enums/*.json`. Then switch to `Ecto.Enum`.
  - Envelopes (`assistant_message` / `ui_card` / `validation` / `usage` /
    `trace_ref` / `warning` / `error`): stored as :map until each independent
    envelope ADR lands. Then switch to `embeds_one` / `embeds_many` of the
    generated module.
  - `adoption_state.pending` / `.resolved` already use `embeds_many` of the
    real `ArtifactAdoptionEntry` because ADR-0001 §2 inlines its full schema.

  Cross-field invariants (ADR-0001 §4 — 7 constraints) are NOT in this
  changeset yet; they belong to a higher-level orchestrator validator that runs
  on the assembled TurnResult. Phase 0 leaves them as TODO and relies on
  manual trace inspection.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias NovelPersistence.Schemas.Foundation.ArtifactAdoptionEntry

  @schema_source "foundation/turn_result_v2.json"
  @required_fields [
    :schema_version,
    :turn_id,
    :phase,
    :status,
    :next_action,
    :assistant_message,
    :ui_cards,
    :behavior_state,
    :adoption_state,
    :projection_refs,
    :validation,
    :usage,
    :trace_ref,
    :produced_at
  ]
  @optional_fields [
    :task_id,
    :agent_id,
    :parent_turn_id,
    :candidate_directions,
    :warnings,
    :errors
  ]

  @primary_key false
  embedded_schema do
    field(:schema_version, :string)
    field(:turn_id, :string)
    field(:task_id, :string)
    field(:agent_id, :string)
    field(:parent_turn_id, :string)
    field(:phase, :string)
    field(:status, :string)
    field(:next_action, :string)
    field(:assistant_message, :map)
    field(:ui_cards, {:array, :map}, default: [])
    field(:candidate_directions, {:array, :map}, default: [])
    field(:behavior_state, :map)
    field(:projection_refs, {:array, :map}, default: [])
    field(:validation, :map)
    field(:usage, :map)
    field(:trace_ref, :map)
    field(:warnings, {:array, :map}, default: [])
    field(:errors, {:array, :map}, default: [])
    field(:produced_at, :utc_datetime)

    embeds_one :adoption_state, AdoptionState, primary_key: false do
      embeds_many(:pending, ArtifactAdoptionEntry)
      embeds_many(:resolved, ArtifactAdoptionEntry)
    end
  end

  @spec schema_source() :: String.t()
  def schema_source, do: @schema_source
  @spec required_fields() :: [atom()]
  def required_fields, do: @required_fields
  @spec optional_fields() :: [atom()]
  def optional_fields, do: @optional_fields

  @cast_fields (@required_fields ++ @optional_fields) -- [:adoption_state]
  @cast_required @required_fields -- [:adoption_state]

  @spec changeset(struct(), map()) :: Ecto.Changeset.t()
  def changeset(struct, attrs) do
    struct
    |> cast(attrs, @cast_fields)
    |> cast_embed(:adoption_state, with: &adoption_state_changeset/2, required: true)
    |> validate_required(@cast_required)
    |> validate_format(:schema_version, ~r/^\d+\.\d+\.\d+$/)
  end

  defp adoption_state_changeset(struct, attrs) do
    struct
    |> cast(attrs, [])
    |> cast_embed(:pending, with: &ArtifactAdoptionEntry.changeset/2)
    |> cast_embed(:resolved, with: &ArtifactAdoptionEntry.changeset/2)
  end
end
