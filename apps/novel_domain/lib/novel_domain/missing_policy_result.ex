defmodule NovelDomain.MissingPolicyResult do
  @moduledoc """
  缺失内容处理结果（VS-00C CP0 / `06` context policy / VS-00D §4.5 MissingPolicy）。

  把"本轮需要但缺失的作品材料如何处理"固化为一等结果。

  CP0 只实现两档：
  - `:ok`：无阻断性缺失。
  - `:block`：hard missing（作者显式命名的目标章在作品结构中不存在），本轮不得调用 provider。

  `:confirm` / `:degrade` / `:omit`（软缺失/预算省略/降权）留待 CP1+。
  """

  alias NovelDomain.WritingCoordinate

  @type severity :: :ok | :block | :confirm | :degrade | :omit
  @type missing_item :: %{what: atom(), reason: atom(), ref: String.t() | nil}

  @type t :: %__MODULE__{severity: severity(), missing: [missing_item()]}

  defstruct severity: :ok, missing: []

  @doc "无阻断性缺失。"
  @spec ok() :: t()
  def ok, do: %__MODULE__{severity: :ok, missing: []}

  @doc """
  评估写作坐标的缺失。

  hard-missing（CP0 唯一 block 条件）：续写/重写且作者**显式点名**了目标章
  （`requested_chapter` 非空），但 planner 未能把它匹配到作品现有章节列表
  （`matched_chapter` 为空）——即"作者要写的章在作品里找不到"。现状会静默回退到
  "最近已写章"，掩盖作者意图。

  靠 planner 的匹配结果判定，不在此做模糊匹配（作者原话"第99章"与全名
  "第01章：xxx"不会精确相等，匹配由 planner 按"精确复制列表标题或置空"完成）。

  注意：未点名具体章的"接着往下写"不算缺失（`requested_chapter` 为空 → 回退到
  最新已写章是期望行为）。
  """
  @spec evaluate(WritingCoordinate.t()) :: t()
  def evaluate(%WritingCoordinate{} = coordinate) do
    cond do
      coordinate.authoring_mode not in [:continuation, :rewrite] ->
        ok()

      coordinate.requested_chapter in ["", nil] ->
        ok()

      coordinate.matched_chapter not in ["", nil] ->
        ok()

      true ->
        %__MODULE__{
          severity: :block,
          missing: [
            %{what: :target_chapter, reason: :not_found, ref: coordinate.requested_chapter}
          ]
        }
    end
  end

  def evaluate(_coordinate), do: ok()

  @spec block?(t()) :: boolean()
  def block?(%__MODULE__{severity: :block}), do: true
  def block?(_result), do: false
end
