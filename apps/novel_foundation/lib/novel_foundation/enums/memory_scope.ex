# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/memory_scope.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.MemoryScope do
  @moduledoc """
  MemoryScope — generated from `docs/design/schemas/foundation/enums/memory_scope.json`.

  05-memory-retention-and-retrieval.md §5 记忆作用范围

  记忆作用范围枚举。定义记忆在哪个层级生效——从全局作者偏好到单次会话临时上下文。冻结于 05-memory-retention-and-retrieval.md §5。
  """

  @values ["GLOBAL", "WORK", "VOLUME", "ARC", "CHAPTER", "SESSION"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def global, do: "GLOBAL"
  def work, do: "WORK"
  def volume, do: "VOLUME"
  def arc, do: "ARC"
  def chapter, do: "CHAPTER"
  def session, do: "SESSION"
end
