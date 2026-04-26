defmodule Persistence.Schemas.Foundation.ArtifactAdoptionEntry do
  @moduledoc """
  Mirrors `docs/design-v2/schemas/foundation/artifact_adoption_entry.json`
  (ADR-0001 §2). adoption_status 7 态由 30 §3.2 / ADR-0001 §2 唯一权威。
  """

  use Ecto.Schema
  import Ecto.Changeset

  @schema_source "foundation/artifact_adoption_entry.json"
  @required_fields [:artifact_id, :artifact_type, :adoption_status, :requires_adoption]
  @optional_fields [:revision_base, :supersedes_artifact_id]
  @adoption_statuses [
    :TENTATIVE,
    :ACCEPTED,
    :EDITED_ACCEPTED,
    :DISCARDED,
    :SUPERSEDED,
    :INVALIDATED,
    :ARCHIVED
  ]

  @primary_key false
  embedded_schema do
    field :artifact_id, :string
    field :artifact_type, :string
    field :adoption_status, Ecto.Enum, values: @adoption_statuses
    field :requires_adoption, :boolean
    field :revision_base, :string
    field :supersedes_artifact_id, :string
  end

  def schema_source, do: @schema_source
  def required_fields, do: @required_fields
  def optional_fields, do: @optional_fields

  def changeset(struct, attrs) do
    struct
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
  end
end
