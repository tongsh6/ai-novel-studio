# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/adoption_status.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.AdoptionStatus do
  @moduledoc """
  AdoptionStatus — generated from `docs/design/schemas/foundation/enums/adoption_status.json`.

  ADR-0002 §5 Artifact lifecycle state 与 status 映射

  Artifact adoption 7 态。canonical 来源 30-contract-glossary §3.2 + ADR-0001。映射到 status family 见 ADR-0002 §5。
  """

  @values ["TENTATIVE", "ACCEPTED", "EDITED_ACCEPTED", "DISCARDED", "SUPERSEDED", "INVALIDATED", "ARCHIVED"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def tentative, do: "TENTATIVE"
  def accepted, do: "ACCEPTED"
  def edited_accepted, do: "EDITED_ACCEPTED"
  def discarded, do: "DISCARDED"
  def superseded, do: "SUPERSEDED"
  def invalidated, do: "INVALIDATED"
  def archived, do: "ARCHIVED"
end
