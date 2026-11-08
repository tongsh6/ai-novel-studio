defmodule NovelPersistence.Schemas.AuthoringSessionMessage do
  @moduledoc """
  会话级 canonical 创作历史的消息行（ADR-0035 / B81 CP1）。

  canonical 作用域是会话：同一 `session_id` 的消息构成跨 turn 连续的运行历史，
  永久追加、不改写。`run_id`/`run_sequence` 把消息归因到执行段（AgentRun）；
  `sequence` 给出会话内唯一顺序。会话身份复用既有 `work_sessions`（`session_id`
  对应其 id），本表不新建第二套会话语义。

  存储层只校验自己拥有的壳（版本、外键式身份列、序号、消息 map 形状）；完整
  Request IR 语义校验由 application 写入边界（`AuthoringCheckpoint`）完成。
  """

  use Ecto.Schema

  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "authoring_session_messages" do
    field(:workspace_id, :string)
    field(:work_id, :string)
    field(:session_id, :string)
    field(:run_id, :string)
    field(:sequence, :integer)
    field(:run_sequence, :integer)
    field(:role, :string)
    field(:message, :map)
    field(:format_version, :string)

    timestamps(type: :utc_datetime_usec)
  end

  @type t :: %__MODULE__{}

  @required_fields [
    :workspace_id,
    :work_id,
    :session_id,
    :run_id,
    :sequence,
    :run_sequence,
    :role,
    :message,
    :format_version
  ]

  @doc false
  def changeset(row, attrs) do
    row
    |> cast(attrs, @required_fields)
    |> validate_required(@required_fields)
    |> validate_length(:workspace_id, min: 1)
    |> validate_length(:work_id, min: 1)
    |> validate_length(:session_id, min: 1)
    |> validate_length(:run_id, min: 1)
    |> validate_length(:role, min: 1)
    |> validate_length(:format_version, min: 1)
    |> validate_number(:sequence, greater_than: 0)
    |> validate_number(:run_sequence, greater_than: 0)
    |> validate_message_map()
  end

  defp validate_message_map(changeset) do
    case get_field(changeset, :message) do
      message when is_map(message) -> changeset
      _ -> add_error(changeset, :message, "must be a map")
    end
  end
end
