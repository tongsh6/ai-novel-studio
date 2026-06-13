# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/slot_type.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.SlotType do
  @moduledoc """
  SlotType — generated from `docs/design/schemas/foundation/enums/slot_type.json`.

  ADR-0010 §4 slot_type 最小集合

  Intent slot 类型枚举。首批支持 9 种类型：text / enum_or_text / object_ref / object_ref_list / scope_ref / anchor_ref / range_ref / integer / boolean。冻结于 ADR-0010 §4。
  """

  @values ["text", "enum_or_text", "object_ref", "object_ref_list", "scope_ref", "anchor_ref", "range_ref", "integer", "boolean"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def text, do: "text"
  def enum_or_text, do: "enum_or_text"
  def object_ref, do: "object_ref"
  def object_ref_list, do: "object_ref_list"
  def scope_ref, do: "scope_ref"
  def anchor_ref, do: "anchor_ref"
  def range_ref, do: "range_ref"
  def integer, do: "integer"
  def boolean, do: "boolean"
end
