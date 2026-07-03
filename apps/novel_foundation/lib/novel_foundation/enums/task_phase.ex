# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/task_phase.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.TaskPhase do
  @moduledoc """
  TaskPhase — generated from `docs/design/schemas/foundation/enums/task_phase.json`.

  ADR-0002 §4 Task phase 与 status 映射

  Long-run task 流程阶段，11 个值固定。冻结于 ADR-0002 §4。CHECKPOINT 不得合并进 PAUSED。
  """

  @values [
    "PLANNED",
    "ESTIMATED",
    "CONFIRMATION_REQUIRED",
    "CONFIRMED",
    "RUNNING",
    "CHECKPOINT",
    "RESUMING",
    "COMPLETED",
    "CANCELLED",
    "FAILED",
    "BRANCHED"
  ]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def planned, do: "PLANNED"
  def estimated, do: "ESTIMATED"
  def confirmation_required, do: "CONFIRMATION_REQUIRED"
  def confirmed, do: "CONFIRMED"
  def running, do: "RUNNING"
  def checkpoint, do: "CHECKPOINT"
  def resuming, do: "RESUMING"
  def completed, do: "COMPLETED"
  def cancelled, do: "CANCELLED"
  def failed, do: "FAILED"
  def branched, do: "BRANCHED"
end
