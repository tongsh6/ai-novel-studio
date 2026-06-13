# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/structure_status.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.StructureStatus do
  @moduledoc """
  StructureStatus — generated from `docs/design/schemas/foundation/enums/structure_status.json`.

  ADR-0002 §5 结构对象状态

  小说结构对象（Volume/Chapter/Scene）的状态。对应 21-novel-object-model.md §5 对象状态。
  """

  @values ["PLANNED", "DRAFTING", "COMPLETED", "ARCHIVED"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def planned, do: "PLANNED"
  def drafting, do: "DRAFTING"
  def completed, do: "COMPLETED"
  def archived, do: "ARCHIVED"
end
