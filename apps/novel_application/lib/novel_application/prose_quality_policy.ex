defmodule NovelApplication.ProseQualityPolicy do
  @moduledoc """
  把一组 `QualityFinding` 汇总成本轮质量策略（VS-00E §9.3 / ADR-0020）。

  策略只读、不修改 artifact 或作品事实；文学类发现默认不硬阻断作者采纳（I7）。
  evaluator 失败由 `review_status: :unavailable` 表达，绝不当作质量通过（I3）。

  动作优先级（高到低）：block > confirm > adoption_review > proceed_with_warning > proceed。
  """

  alias NovelDomain.QualityFinding

  @type action ::
          :proceed
          | :proceed_with_warning
          | :adoption_review
          | :confirm
          | :block
          | :quality_review_unavailable

  @type t :: %{
          action: action(),
          review_status: :completed | :unavailable,
          finding_count: non_neg_integer(),
          action_counts: %{optional(atom()) => non_neg_integer()}
        }

  @doc """
  根据 findings 决策。

  - `opts[:review_status]`：`:completed`（默认）或 `:unavailable`。`:unavailable` 时不论
    有无 finding 一律返回 `quality_review_unavailable`，不伪造通过。
  """
  @spec decide([QualityFinding.t()], keyword()) :: t()
  def decide(findings, opts \\ []) when is_list(findings) do
    review_status = Keyword.get(opts, :review_status, :completed)

    counts = action_counts(findings)

    action =
      cond do
        review_status == :unavailable -> :quality_review_unavailable
        counts[:block] && counts[:block] > 0 -> :block
        counts[:confirm] && counts[:confirm] > 0 -> :confirm
        counts[:adoption_review] && counts[:adoption_review] > 0 -> :adoption_review
        counts[:warn] && counts[:warn] > 0 -> :proceed_with_warning
        true -> :proceed
      end

    %{
      action: action,
      review_status: review_status,
      finding_count: length(findings),
      action_counts: counts
    }
  end

  defp action_counts(findings) do
    Enum.reduce(findings, %{}, fn %QualityFinding{action: action}, acc ->
      Map.update(acc, action, 1, &(&1 + 1))
    end)
  end
end
