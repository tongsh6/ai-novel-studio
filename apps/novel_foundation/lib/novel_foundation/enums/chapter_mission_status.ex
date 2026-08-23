# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/chapter_mission_status.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.ChapterMissionStatus do
  @moduledoc """
  ChapterMissionStatus — generated from `docs/design/schemas/foundation/enums/chapter_mission_status.json`.

  ADR-0024-decision-surface-registry-v3.md VS-00E §16.8

  本章使命（chapters.plan_direction.chapter_mission）裁决状态。TENTATIVE=模型推导、作者未裁决（下次写作前会被新推导覆盖）；CONFIRMED=作者确认模型版；AUTHOR_EDITED=作者改写。CONFIRMED/AUTHOR_EDITED 为作者版：推理步直接采用、不再调模型、不被覆盖；作废=删除该键（无 DISCARDED 态）。冻结于 VS-00E §16.8 / ADR-0024 S8（WR01b）。
  """

  @values ["TENTATIVE", "CONFIRMED", "AUTHOR_EDITED"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def tentative, do: "TENTATIVE"
  def confirmed, do: "CONFIRMED"
  def author_edited, do: "AUTHOR_EDITED"
end
