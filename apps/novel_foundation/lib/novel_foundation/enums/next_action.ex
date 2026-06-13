# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/next_action.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.NextAction do
  @moduledoc """
  NextAction — generated from `docs/design/schemas/foundation/enums/next_action.json`.

  ADR-0002 §6 next_action 完整集合

  Runtime 下一步语义，不是 UI 按钮文案。冻结于 ADR-0002 §6。EXECUTE_DIRECTLY 不属于 canonical 集合。
  """

  @values ["ASK_USER", "CONFIRM_BEFORE_EXECUTE", "SHOW_RESULT", "RETRY_SYSTEM", "RESUME_TASK", "ADOPT_ARTIFACTS", "CANCEL_TASK", "NO_FURTHER_ACTION"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def ask_user, do: "ASK_USER"
  def confirm_before_execute, do: "CONFIRM_BEFORE_EXECUTE"
  def show_result, do: "SHOW_RESULT"
  def retry_system, do: "RETRY_SYSTEM"
  def resume_task, do: "RESUME_TASK"
  def adopt_artifacts, do: "ADOPT_ARTIFACTS"
  def cancel_task, do: "CANCEL_TASK"
  def no_further_action, do: "NO_FURTHER_ACTION"
end
