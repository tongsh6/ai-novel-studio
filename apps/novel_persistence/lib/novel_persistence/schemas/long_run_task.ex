defmodule NovelPersistence.Schemas.LongRunTask do
  @moduledoc """
  Ecto schema for `long_run_tasks` table — long-run task 持久化。

  Phase 1：最小状态机（running / checkpoint / completed）。
  """

  use Ecto.Schema

  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @valid_statuses ~w(running checkpoint completed cancelled failed)
  @valid_phases ~w(running checkpoint resuming completed)

  schema "long_run_tasks" do
    field(:workspace_id, :string)
    field(:task_type, :string)
    field(:status, :string, default: "running")
    field(:phase, :string, default: "running")
    field(:goal, :string)
    field(:checkpoint_data, :map)
    field(:completed_at, :utc_datetime_usec)

    timestamps(type: :utc_datetime_usec)
  end

  @doc false
  def changeset(task, attrs) do
    task
    |> cast(attrs, [
      :workspace_id,
      :task_type,
      :status,
      :phase,
      :goal,
      :checkpoint_data,
      :completed_at
    ])
    |> validate_required([:workspace_id, :task_type, :status, :phase])
    |> validate_inclusion(:status, @valid_statuses)
    |> validate_inclusion(:phase, @valid_phases)
  end

  @doc "Mark task as checkpoint (paused)."
  def checkpoint_changeset(task, data) do
    task
    |> change(status: "checkpoint", phase: "checkpoint", checkpoint_data: data)
  end

  @doc "Mark task as completed."
  def complete_changeset(task) do
    task
    |> change(status: "completed", phase: "completed", completed_at: DateTime.utc_now())
  end

  @doc "Resume from checkpoint."
  def resume_changeset(task) do
    task
    |> change(status: "running", phase: "running")
  end
end
