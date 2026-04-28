defmodule NovelPersistence.Schemas.LongRunTask do
  @moduledoc """
  Ecto schema for `long_run_tasks` table — long-run task 持久化。

  Phase 1：最小状态机骨架。完整 23 字段（plan_ref / authority_scope / budgets 等）
  按 06-planning-and-long-run §5 在后续 PR 补齐。

  ## ADR refs
  - ADR-0002 §2 (status family) / §4 (task phase 11 态) — 字段值由 Foundation.Enums 强制
  - 06-planning-and-long-run §5 — task 最小模型（部分字段尚未落地）
  """

  use Ecto.Schema

  import Ecto.Changeset

  alias NovelFoundation.Enums.Status
  alias NovelFoundation.Enums.TaskPhase

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "long_run_tasks" do
    field(:workspace_id, :string)
    field(:task_type, :string)
    field(:status, :string, default: Status.ready())
    field(:phase, :string, default: TaskPhase.planned())
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
    |> validate_inclusion(:status, Status.values())
    |> validate_inclusion(:phase, TaskPhase.values())
  end

  @doc "Mark task as checkpoint (paused). status=PAUSED, phase=CHECKPOINT (ADR-0002 §4)."
  def checkpoint_changeset(task, data) do
    task
    |> change(
      status: Status.paused(),
      phase: TaskPhase.checkpoint(),
      checkpoint_data: data
    )
  end

  @doc "Mark task as completed. status=DONE, phase=COMPLETED (ADR-0002 §4)."
  def complete_changeset(task) do
    task
    |> change(
      status: Status.done(),
      phase: TaskPhase.completed(),
      completed_at: DateTime.utc_now()
    )
  end

  @doc "Resume from checkpoint. status=WAITING_SYSTEM, phase=RESUMING (ADR-0002 §4)."
  def resume_changeset(task) do
    task
    |> change(status: Status.waiting_system(), phase: TaskPhase.resuming())
  end
end
