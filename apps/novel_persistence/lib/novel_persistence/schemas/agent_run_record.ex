defmodule NovelPersistence.Schemas.AgentRunRecord do
  @moduledoc """
  Persisted AgentRun state for bounded/durable run audit and recovery evidence.

  ## canonical 作用域（ADR-0035 / B81 CP1）

  AgentRun 是**执行段**，不是上下文边界：它不持有 canonical 创作历史。run 的
  执行段头（run 身份 + system/tools/refs 快照）与消息归
  `NovelPersistence.AuthoringSessionLog`（`authoring_run_segments` /
  `authoring_session_messages`）维护；本表只保留 run 的运行状态、计划、预算、
  权限与恢复事实。

  项目未发布：旧 run 级私有 `authoring_transcript` 列已随历史迁移退役，不做
  兼容读取。
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :string, autogenerate: false}
  @foreign_key_type :string

  schema "agent_runs" do
    field(:workspace_id, :string)
    field(:work_id, :string)
    field(:session_id, :string)
    field(:parent_turn_ref, :string)
    field(:origin_frame_ref, :string)
    field(:run_mode, :string)
    field(:profile_ref, :string)
    field(:trigger, :map)
    field(:status, :string)
    field(:phase, :string)
    field(:goal, :map)
    field(:goal_version, :integer, default: 1)
    field(:plan, :map)
    field(:plan_ref, :string)
    field(:plan_version, :integer, default: 1)
    field(:run_policy, :map)
    field(:authority_scope, :map)
    field(:budget, :map)
    field(:consumed_budget, :map)
    field(:current_step_ref, :string)
    field(:completed_step_refs, {:array, :string}, default: [])
    field(:pending_artifact_refs, {:array, :string}, default: [])
    field(:active_behavior_ref, :string)
    field(:interrupt_state, :map)
    field(:long_run_task_ref, :string)
    field(:failure_ref, :string)
    field(:completed_at, :utc_datetime_usec)

    timestamps(type: :utc_datetime_usec)
  end

  @type t :: %__MODULE__{}

  @required_fields [
    :id,
    :workspace_id,
    :work_id,
    :session_id,
    :parent_turn_ref,
    :origin_frame_ref,
    :run_mode,
    :profile_ref,
    :status,
    :phase
  ]

  @optional_fields [
    :goal,
    :trigger,
    :goal_version,
    :plan,
    :plan_ref,
    :plan_version,
    :run_policy,
    :authority_scope,
    :budget,
    :consumed_budget,
    :current_step_ref,
    :completed_step_refs,
    :pending_artifact_refs,
    :active_behavior_ref,
    :interrupt_state,
    :long_run_task_ref,
    :failure_ref,
    :completed_at
  ]

  def changeset(record, attrs) do
    record
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:run_mode, ["bounded", "durable"])
    |> validate_inclusion(:status, [
      "created",
      "running",
      "pausing",
      "cancelling",
      "paused",
      "awaiting_author",
      "completed",
      "cancelled",
      "failed"
    ])
    |> validate_inclusion(:phase, ["planning", "executing", "finalizing", "stopped"])
  end
end
