# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/volume_blueprint_status.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.VolumeBlueprintStatus do
  @moduledoc """
  VolumeBlueprintStatus — generated from `docs/design/schemas/foundation/enums/volume_blueprint_status.json`.

  ADR-0028-volume-structure-and-open-volume-action-v3.md VS-00J §2.1

  卷级蓝图（volumes.blueprint.status）裁决状态。TENTATIVE=模型推导、作者未裁决；CONFIRMED=采纳 outline_draft 即作者定稿（B11A CP1 采纳物化路径写此态）；AUTHOR_EDITED=作者手编（CP3+ 留位）。作废=删除该键或整行 blueprint（无 DISCARDED 态）。与 chapter_mission_status 同款三态。冻结于 VS-00J §2.1 / ADR-0028。
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
