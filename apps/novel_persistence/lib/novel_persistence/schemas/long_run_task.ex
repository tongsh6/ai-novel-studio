defmodule NovelPersistence.Schemas.LongRunTask do
  @moduledoc """
  Ecto schema for `long_run_tasks` table — long-run task 持久化。

  完整 24 字段按 06-planning-and-long-run.md §5 落地。

  ## ADR refs
  - ADR-0002 §2 (status family) / §4 (task phase 11 态) — 字段值由 Foundation.Enums 强制
  - 06-planning-and-long-run §5 — task 最小模型（24 字段）
  - ADR-0003 — authority_scope / estimated_budget / consumed_budget 最小结构
  """

  use Ecto.Schema

  import Ecto.Changeset

  alias NovelFoundation.Enums.Status
  alias NovelFoundation.Enums.TaskPhase

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "long_run_tasks" do
    # Core identity
    field(:workspace_id, :string)
    field(:task_type, :string)
    field(:status, :string, default: Status.ready())
    field(:phase, :string, default: TaskPhase.planned())
    field(:goal, :string)

    # Scope & provenance (§5, §5.5)
    field(:scope_ref, :string)
    field(:created_by, :string)
    field(:parent_turn_ref, :string)
    field(:parent_task_ref, :string)

    # Planning (§5.2)
    field(:plan_ref, :string)
    field(:checkpoint_policy_ref, :string)

    # Budget (§5.3, §5.4, §9)
    field(:estimated_budget, :map)
    field(:consumed_budget, :map)

    # Authority (§5.5)
    field(:authority_scope, :string)

    # Execution tracking (§10)
    field(:current_unit_ref, :string)
    field(:completed_unit_refs, {:array, :string}, default: [])

    # Artifact tracking (§11)
    field(:pending_artifact_refs, {:array, :string}, default: [])
    field(:accepted_artifact_refs, {:array, :string}, default: [])

    # Risk & recovery (§17, §15, §16)
    field(:warning_refs, {:array, :string}, default: [])
    field(:failure_ref, :string)
    field(:resume_ref, :string)
    field(:branch_parent_ref, :string)

    # Checkpoint data
    field(:checkpoint_data, :map)
    field(:completed_at, :utc_datetime_usec)

    timestamps(type: :utc_datetime_usec)
  end

  @required_fields [:workspace_id, :task_type, :status, :phase]
  @optional_fields [
    :goal,
    :scope_ref,
    :created_by,
    :parent_turn_ref,
    :parent_task_ref,
    :plan_ref,
    :checkpoint_policy_ref,
    :estimated_budget,
    :consumed_budget,
    :authority_scope,
    :current_unit_ref,
    :completed_unit_refs,
    :pending_artifact_refs,
    :accepted_artifact_refs,
    :warning_refs,
    :failure_ref,
    :resume_ref,
    :branch_parent_ref,
    :checkpoint_data,
    :completed_at
  ]

  @doc false
  def changeset(task, attrs) do
    task
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:status, Status.values())
    |> validate_inclusion(:phase, TaskPhase.values())
  end

  # ---- Convenience changesets (ADR-0002 §4) ----

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

  @doc "Mark as running. status=RUNNING, phase=RUNNING (ADR-0002 §4)."
  def running_changeset(task) do
    task
    |> change(status: Status.running(), phase: TaskPhase.running())
  end
end
