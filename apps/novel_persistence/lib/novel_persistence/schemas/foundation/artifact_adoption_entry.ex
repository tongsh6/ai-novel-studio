defmodule NovelPersistence.Schemas.Foundation.ArtifactAdoptionEntry do
  @moduledoc """
  Mirrors `docs/design/schemas/foundation/artifact_adoption_entry.json`
  (ADR-0001 §2). adoption_status 7 态由 30 §3.2 / ADR-0001 §2 唯一权威。
  """

  use Ecto.Schema
  import Ecto.Changeset

  @schema_source "foundation/artifact_adoption_entry.json"
  @required_fields [:artifact_id, :artifact_type, :adoption_status, :requires_adoption]
  @optional_fields [
    :revision_base,
    :supersedes_artifact_id,
    :payload,
    :source_turn_ref,
    :source_tool_result_ref
  ]
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
    field(:artifact_id, :string)
    field(:artifact_type, :string)
    field(:adoption_status, Ecto.Enum, values: @adoption_statuses)
    field(:requires_adoption, :boolean)
    field(:revision_base, :string)
    field(:supersedes_artifact_id, :string)
    # DS01 CP1：TurnResult adoption_state 条目携带的作者可见内容与产出溯源
    #（docs/design/schemas/foundation/artifact_adoption_entry.json 同步扩展）。
    field(:payload, :map)
    field(:source_turn_ref, :string)
    field(:source_tool_result_ref, :string)
  end

  @spec schema_source() :: String.t()
  def schema_source, do: @schema_source
  @spec required_fields() :: [atom()]
  def required_fields, do: @required_fields
  @spec optional_fields() :: [atom()]
  def optional_fields, do: @optional_fields

  @spec changeset(struct(), map()) :: Ecto.Changeset.t()
  def changeset(struct, attrs) do
    struct
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_adoption_transition(struct)
  end

  # ADR-0019：当已有 from 态（更新已存在的 adoption entry）时，拒绝非法转换。
  # 转换合法性由 NovelDomain.AdoptionStatus 单一权威（与 MemoryItem 状态机模式对称）。
  # 新建（struct.adoption_status 为 nil）= 初始设值，不校验转换。
  defp validate_adoption_transition(changeset, %{adoption_status: from}) when not is_nil(from) do
    case get_change(changeset, :adoption_status) do
      nil ->
        changeset

      to ->
        if NovelDomain.AdoptionStatus.transition_allowed?(to_string(from), to_string(to)) do
          changeset
        else
          add_error(changeset, :adoption_status, "illegal adoption transition #{from} -> #{to}")
        end
    end
  end

  defp validate_adoption_transition(changeset, _struct), do: changeset
end
