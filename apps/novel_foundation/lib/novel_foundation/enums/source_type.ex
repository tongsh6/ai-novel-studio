# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/source_type.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.SourceType do
  @moduledoc """
  SourceType — generated from `docs/design/schemas/foundation/enums/source_type.json`.

  05-memory-retention-and-retrieval.md §5.3 source_type

  记忆来源类型枚举。每条 memory entry 必须标记来源类型。冻结于 05-memory-retention-and-retrieval.md §5.3。
  """

  @values ["turn", "task_event", "artifact", "object_snapshot", "object_summary", "registry", "audit_event", "external_import"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def turn, do: "turn"
  def task_event, do: "task_event"
  def artifact, do: "artifact"
  def object_snapshot, do: "object_snapshot"
  def object_summary, do: "object_summary"
  def registry, do: "registry"
  def audit_event, do: "audit_event"
  def external_import, do: "external_import"
end
