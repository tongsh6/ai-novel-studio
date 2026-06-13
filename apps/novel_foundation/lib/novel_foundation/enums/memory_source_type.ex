# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/memory_source_type.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.MemorySourceType do
  @moduledoc """
  MemorySourceType — generated from `docs/design/schemas/foundation/enums/memory_source_type.json`.

  05-memory-retention-and-retrieval.md §7 source_type

  记忆来源类型枚举。区分记忆的权威来源——作者确认高于文档导入高于 AI 推断。冻结于 05-memory-retention-and-retrieval.md §7。
  """

  @values ["AUTHOR_CONFIRMED", "AUTHOR_CREATED", "AI_EXTRACTED", "CHAPTER_EXTRACTED", "WORK_SETTING_IMPORTED", "SESSION_CONTEXT"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def author_confirmed, do: "AUTHOR_CONFIRMED"
  def author_created, do: "AUTHOR_CREATED"
  def ai_extracted, do: "AI_EXTRACTED"
  def chapter_extracted, do: "CHAPTER_EXTRACTED"
  def work_setting_imported, do: "WORK_SETTING_IMPORTED"
  def session_context, do: "SESSION_CONTEXT"
end
