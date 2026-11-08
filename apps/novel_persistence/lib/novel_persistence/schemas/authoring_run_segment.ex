defmodule NovelPersistence.Schemas.AuthoringRunSegment do
  @moduledoc """
  run 执行段头（ADR-0035 / B81 CP1）。

  AgentRun 是会话 canonical 历史中的一个执行段：段头只承载该段的派生配置与
  refs 快照（run/system/tools/projection/base_refs/observation_refs/used_refs），
  以及该段消息在会话流中的范围；canonical 消息永远在
  `authoring_session_messages`，本表不复制消息。

  段头随执行推进可更新（配置/refs 是执行段状态），消息只追加。
  """

  use Ecto.Schema

  import Ecto.Changeset

  @primary_key {:run_id, :string, autogenerate: false}
  @foreign_key_type :binary_id

  schema "authoring_run_segments" do
    field(:workspace_id, :string)
    field(:work_id, :string)
    field(:session_id, :string)
    field(:parent_turn_ref, :string)
    field(:header, :map)
    field(:message_count, :integer, default: 0)
    field(:first_sequence, :integer)
    field(:last_sequence, :integer)
    field(:format_version, :string)

    timestamps(type: :utc_datetime_usec)
  end

  @type t :: %__MODULE__{}

  @required_fields [
    :run_id,
    :workspace_id,
    :work_id,
    :session_id,
    :parent_turn_ref,
    :header,
    :message_count,
    :format_version
  ]

  @doc false
  def changeset(row, attrs) do
    row
    |> cast(attrs, @required_fields ++ [:first_sequence, :last_sequence])
    |> validate_required(@required_fields)
    |> validate_length(:run_id, min: 1)
    |> validate_length(:workspace_id, min: 1)
    |> validate_length(:work_id, min: 1)
    |> validate_length(:session_id, min: 1)
    |> validate_number(:message_count, greater_than_or_equal_to: 0)
    |> validate_header_map()
  end

  defp validate_header_map(changeset) do
    case get_field(changeset, :header) do
      header when is_map(header) -> changeset
      _ -> add_error(changeset, :header, "must be a map")
    end
  end
end
