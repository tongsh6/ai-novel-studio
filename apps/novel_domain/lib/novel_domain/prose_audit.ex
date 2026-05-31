defmodule NovelDomain.ProseAudit do
  @moduledoc """
  正文有效字数审计（确定性纯函数）。

  在 `NovelDomain.ProseWordCount`（"怎么数一段文字"）之上，判定：

  - 单章：空章 / 短章 / 达标（依据 `NovelDomain.NovelMilestone` 的阶段下限）。
  - 作品：总有效字数、章数、各状态章数，以及是否达到阶段门槛。

  口径冻结于 `docs/product/novel-output-milestones.md` §2/§3/§4.1：

  - 审计只针对**已采纳正文有效字数**——"数哪些文字"由调用方（reading projection /
    work archive）界定，本模块只接收已数好的每章有效字数。
  - 判定确定性、可复算，禁止 LLM 自报。
  - 阶段门槛（§5 P1 Done）：总字数达标 **且** 每章达标（空章数 = 短章数 = 0 且至少 1 章）。
  """

  alias NovelDomain.NovelMilestone

  @type chapter_status :: :empty | :short | :ok

  @type work_audit :: %{
          stage: NovelMilestone.stage(),
          min_chapter_words: non_neg_integer(),
          total_target: non_neg_integer(),
          total_word_count: non_neg_integer(),
          chapter_count: non_neg_integer(),
          ok_chapter_count: non_neg_integer(),
          short_chapter_count: non_neg_integer(),
          empty_chapter_count: non_neg_integer(),
          meets_threshold: boolean()
        }

  @doc """
  判定单章状态。

  - `word_count <= 0` → `:empty`
  - `0 < word_count < min_chapter_words` → `:short`
  - `word_count >= min_chapter_words` → `:ok`
  """
  @spec chapter_status(integer(), non_neg_integer()) :: chapter_status()
  def chapter_status(word_count, min_chapter_words)
      when is_integer(word_count) and is_integer(min_chapter_words) do
    cond do
      word_count <= 0 -> :empty
      word_count < min_chapter_words -> :short
      true -> :ok
    end
  end

  @doc """
  汇总作品级审计。`word_counts` 是各已采纳章节的有效字数列表。
  """
  @spec summarize([non_neg_integer()], NovelMilestone.stage()) :: work_audit()
  def summarize(word_counts, stage) when is_list(word_counts) do
    %{min_chapter_words: min_chapter_words, total_target: total_target} =
      NovelMilestone.threshold(stage)

    statuses = Enum.map(word_counts, &chapter_status(&1, min_chapter_words))
    empty_count = Enum.count(statuses, &(&1 == :empty))
    short_count = Enum.count(statuses, &(&1 == :short))
    ok_count = Enum.count(statuses, &(&1 == :ok))
    chapter_count = length(word_counts)
    total_word_count = Enum.sum(word_counts)

    %{
      stage: stage,
      min_chapter_words: min_chapter_words,
      total_target: total_target,
      total_word_count: total_word_count,
      chapter_count: chapter_count,
      ok_chapter_count: ok_count,
      short_chapter_count: short_count,
      empty_chapter_count: empty_count,
      meets_threshold:
        chapter_count > 0 and empty_count == 0 and short_count == 0 and
          total_word_count >= total_target
    }
  end
end
