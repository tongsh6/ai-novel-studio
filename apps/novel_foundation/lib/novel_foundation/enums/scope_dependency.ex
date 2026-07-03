# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/scope_dependency.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.ScopeDependency do
  @moduledoc """
  ScopeDependency — generated from `docs/design/schemas/foundation/enums/scope_dependency.json`.

  ADR-0010 §5 scope_dependency 最小集合

  Slot 作用域依赖枚举。描述 slot 所依赖的业务范围。冻结于 ADR-0010 §5。
  """

  @values [
    "work",
    "volume",
    "arc",
    "chapter",
    "scene",
    "draft",
    "style",
    "continuity",
    "reading_projection",
    "runtime"
  ]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def work, do: "work"
  def volume, do: "volume"
  def arc, do: "arc"
  def chapter, do: "chapter"
  def scene, do: "scene"
  def draft, do: "draft"
  def style, do: "style"
  def continuity, do: "continuity"
  def reading_projection, do: "reading_projection"
  def runtime, do: "runtime"
end
