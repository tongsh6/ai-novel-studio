# AUTO-GENERATED FROM docs/design/schemas/foundation/enums/narrative_role.json — DO NOT EDIT.
# Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
defmodule NovelFoundation.Enums.NarrativeRole do
  @moduledoc """
  NarrativeRole — generated from `docs/design/schemas/foundation/enums/narrative_role.json`.

  AU-09 34-novel-element-field-priority §5 要素到落位矩阵（主角要素 → character）

  角色叙事功能分类。主角等叙事角色是 Character 的结构化分类（叙事功能层），不是作品立项字段，也不只是关系。允许多个 PROTAGONIST（群像/双主角）。无标记时主角必须诚实报缺口，不把第一个角色默认当主角。
  """

  @values ["PROTAGONIST", "ANTAGONIST", "SUPPORTING", "MINOR", "ENSEMBLE_POV"]

  @type t :: String.t()

  @doc "All canonical values, in declaration order."
  @spec values() :: [t()]
  def values, do: @values

  @doc "Returns true if `v` is a canonical value."
  @spec valid?(any()) :: boolean()
  def valid?(v) when is_binary(v), do: v in @values
  def valid?(_), do: false

  def protagonist, do: "PROTAGONIST"
  def antagonist, do: "ANTAGONIST"
  def supporting, do: "SUPPORTING"
  def minor, do: "MINOR"
  def ensemble_pov, do: "ENSEMBLE_POV"
end
