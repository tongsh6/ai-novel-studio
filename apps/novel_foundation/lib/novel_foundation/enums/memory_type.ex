# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/memory_type.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.MemoryType do
  @moduledoc """
  MemoryType — generated from `docs/design/schemas/foundation/enums/memory_type.json`.

  05-memory-retention-and-retrieval.md §4 记忆类型体系

  记忆类型枚举。定义可治理的创作事实分类——区分铁律、事实、状态、灵感、约束等不同性质的记忆。冻结于 05-memory-retention-and-retrieval.md §4。
  """

  @values ["WORLD_RULE", "CHARACTER_PROFILE", "CURRENT_STATE", "RELATIONSHIP", "PLOT_FACT", "FORESHADOWING", "STYLE_RULE", "CONSTRAINT", "AUTHOR_PREFERENCE", "IDEA", "DRAFT_CONTEXT"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def world_rule, do: "WORLD_RULE"
  def character_profile, do: "CHARACTER_PROFILE"
  def current_state, do: "CURRENT_STATE"
  def relationship, do: "RELATIONSHIP"
  def plot_fact, do: "PLOT_FACT"
  def foreshadowing, do: "FORESHADOWING"
  def style_rule, do: "STYLE_RULE"
  def constraint, do: "CONSTRAINT"
  def author_preference, do: "AUTHOR_PREFERENCE"
  def idea, do: "IDEA"
  def draft_context, do: "DRAFT_CONTEXT"
end
