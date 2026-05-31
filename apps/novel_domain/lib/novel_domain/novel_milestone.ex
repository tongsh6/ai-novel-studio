defmodule NovelDomain.NovelMilestone do
  @moduledoc """
  长篇产出阶段目标阈值（确定性常量，单一事实来源）。

  口径冻结于 `docs/product/novel-output-milestones.md` §3 阶段目标：

  | 阶段 | 单章正文有效字数下限 | 总正文有效字数目标 |
  |------|--------------------|------------------|
  | P1   | ≥1,000             | ≥100,000         |
  | P2   | ≥2,000             | ≥500,000         |
  | P3   | ≥3,000             | ≥1,000,000       |
  | P4   | ≥5,000             | ≥5,000,000       |

  P3/P4 原表的单章是区间（3,000-5,000 / 5,000-8,000），本模块只固化**下限**，
  超长章标记属后续 checkpoint，不在此处判定。

  字数本身的统计口径见 `NovelDomain.ProseWordCount`；本模块只提供阈值，
  审计判定见 `NovelDomain.ProseAudit`。
  """

  @type stage :: :p1 | :p2 | :p3 | :p4
  @type threshold :: %{
          stage: stage(),
          min_chapter_words: non_neg_integer(),
          total_target: non_neg_integer()
        }

  @thresholds %{
    p1: %{min_chapter_words: 1_000, total_target: 100_000},
    p2: %{min_chapter_words: 2_000, total_target: 500_000},
    p3: %{min_chapter_words: 3_000, total_target: 1_000_000},
    p4: %{min_chapter_words: 5_000, total_target: 5_000_000}
  }

  @doc """
  返回某阶段的字数阈值。未知阶段抛 `KeyError`（阶段集合是冻结常量）。
  """
  @spec threshold(stage()) :: threshold()
  def threshold(stage) when is_map_key(@thresholds, stage) do
    @thresholds
    |> Map.fetch!(stage)
    |> Map.put(:stage, stage)
  end
end
