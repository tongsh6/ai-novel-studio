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
  评估写作坐标相对于作品现有章节列表的缺失。

  hard-missing（CP0 唯一 block 条件）：续写/重写且作者**显式命名**了目标章，
  但该章不在作品现有章节列表中——现状会静默回退到"最近已写章"，掩盖了作者意图。

  注意：未命名目标章的"接着往下写"不算缺失（回退到最新已写章是期望行为）。
  """
  @spec evaluate(WritingCoordinate.t(), [String.t()]) :: t()
  def evaluate(%WritingCoordinate{} = coordinate, available_chapters)
      when is_list(available_chapters) do
    requested = coordinate.requested_chapter

    cond do
      coordinate.authoring_mode not in [:continuation, :rewrite] ->
        ok()

      requested in ["", nil] ->
        ok()

      requested in available_chapters ->
        ok()

      true ->
        %__MODULE__{
          severity: :block,
          missing: [%{what: :target_chapter, reason: :not_found, ref: requested}]
        }
    end
  end

  def evaluate(_coordinate, _available_chapters), do: ok()

  @spec block?(t()) :: boolean()
  def block?(%__MODULE__{severity: :block}), do: true
  def block?(_result), do: false
end
