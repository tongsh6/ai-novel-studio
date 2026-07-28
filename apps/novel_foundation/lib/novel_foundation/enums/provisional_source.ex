# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/provisional_source.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.ProvisionalSource do
  @moduledoc """
  ProvisionalSource — generated from `docs/design/schemas/foundation/enums/provisional_source.json`.

  VS-00G contracts/VS-00G-fact-completeness-and-provisioning-contract-pack.md §2.3 / §3.4

  暂用态来源标注（VS-00G §2.3 工作假定）。区分「AI 假定」（盘点/分析产出、可被系统带【暂定】标注注入）与普通作者候选（provisional_source 为空的 tentative 对象）。零新实体：这是既有 tentative 对象上的来源标注字段，不是新状态机。
  """

  @values ["AI_ASSUMPTION"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def ai_assumption, do: "AI_ASSUMPTION"
end
