# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/requiredness.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.Requiredness do
  @moduledoc """
  Requiredness — generated from `docs/design/schemas/foundation/enums/requiredness.json`.

  ADR-0010 §3 slot entry 最小字段

  Slot 必要性枚举。required_to_execute 缺失时必须阻止执行；optional_preference 不得单独触发 clarification。冻结于 ADR-0010 §3。
  """

  @values ["required_to_execute", "optional_preference"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def required_to_execute, do: "required_to_execute"
  def optional_preference, do: "optional_preference"
end
