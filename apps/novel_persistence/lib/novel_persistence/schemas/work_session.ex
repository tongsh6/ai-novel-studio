defmodule NovelPersistence.Schemas.WorkSession do
  @moduledoc """
  作品内会话。一个 Work 可以拥有多个会话，active session 是桌面重开时
  自动恢复的对话边界。
  """

  use Ecto.Schema

  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @statuses ~w(ACTIVE EXITED ARCHIVED)

  schema "work_sessions" do
    field(:work_id, :binary_id)
    field(:title, :string)
    field(:summary, :string)
    field(:status, :string, default: "ACTIVE")
    field(:source_session_ref, :binary_id)
    field(:source_turn_ref, :string)
    field(:last_opened_at, :utc_datetime_usec)

    timestamps(type: :utc_datetime_usec)
  end

  @type t :: %__MODULE__{}

  @doc false
  def changeset(session, attrs) do
    session
    |> cast(attrs, [
      :work_id,
      :title,
      :summary,
      :status,
      :source_session_ref,
      :source_turn_ref,
      :last_opened_at
    ])
    |> put_default_last_opened_at()
    |> validate_required([:work_id, :title, :status, :last_opened_at])
    |> validate_length(:title, min: 1, max: 200)
    |> validate_inclusion(:status, @statuses)
  end

  defp put_default_last_opened_at(changeset) do
    case get_field(changeset, :last_opened_at) do
      nil -> put_change(changeset, :last_opened_at, DateTime.utc_now())
      _ -> changeset
    end
  end
end
