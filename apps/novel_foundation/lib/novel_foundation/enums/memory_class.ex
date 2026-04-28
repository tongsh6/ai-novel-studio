# AUTO-GENERATED FROM docs/design-v2/schemas/foundation/enums/memory_class.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.MemoryClass do
  @moduledoc """
  MemoryClass — generated from `docs/design-v2/schemas/foundation/enums/memory_class.json`.

  05-memory-retention-and-retrieval.md §5.2 memory_class

  记忆分类枚举。Foundation 层定义四类记忆：episodic / semantic / procedural / meta。冻结于 05-memory-retention-and-retrieval.md §5.2。
  """

  @values ["episodic", "semantic", "procedural", "meta"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def episodic, do: "episodic"
  def semantic, do: "semantic"
  def procedural, do: "procedural"
  def meta, do: "meta"
end
