# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/status.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.Status do
  @moduledoc """
  Status — generated from `docs/design/schemas/foundation/enums/status.json`.

  ADR-0002 §2 Foundation 通用 status family

  Foundation 通用 status family，turn / task / artifact projection 共用。冻结于 ADR-0002 §2。
  """

  @values ["READY", "WAITING_USER", "WAITING_SYSTEM", "RUNNING", "PAUSED", "DONE", "ERROR", "CANCELLED"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def ready, do: "READY"
  def waiting_user, do: "WAITING_USER"
  def waiting_system, do: "WAITING_SYSTEM"
  def running, do: "RUNNING"
  def paused, do: "PAUSED"
  def done, do: "DONE"
  def error, do: "ERROR"
  def cancelled, do: "CANCELLED"
end
