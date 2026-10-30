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

  @duplicate_pair_limit 20

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

  @doc """
  确定性重复段落/重复章统计（P1 checkpoint B）。

  输入每章 `%{id, seq, content}`（只应传已采纳正文）。段落按空行切分，归一化
  空白后取 SHA-256；跨章重复按"不同章"去重计数，重复章按全文归一化 hash 判等。
  只读审计，不删除/改写正文；pair 摘要上限 #{@duplicate_pair_limit}。
  """
  @spec duplicate_analysis([map()]) :: map()
  def duplicate_analysis(chapters) when is_list(chapters) do
    chapters =
      chapters
      |> Enum.filter(&is_map/1)
      |> Enum.map(fn chapter ->
        %{
          id: Map.get(chapter, :id) || Map.get(chapter, "id"),
          seq: Map.get(chapter, :seq) || Map.get(chapter, "seq"),
          paragraphs: paragraphs(Map.get(chapter, :content) || Map.get(chapter, "content")),
          full: full_fingerprint(Map.get(chapter, :content) || Map.get(chapter, "content"))
        }
      end)
      |> Enum.reject(&is_nil(&1.id))

    paragraph_groups =
      chapters
      |> Enum.flat_map(fn chapter ->
        chapter.paragraphs
        |> Enum.uniq()
        |> Enum.map(&{&1, chapter})
      end)
      |> Enum.group_by(fn {fingerprint, _chapter} -> fingerprint end)
      |> Enum.filter(fn {_fingerprint, entries} ->
        entries |> Enum.map(fn {_f, chapter} -> chapter.id end) |> Enum.uniq() |> length() > 1
      end)

    chapter_groups =
      chapters
      |> Enum.filter(&(&1.full != nil))
      |> Enum.group_by(& &1.full)
      |> Enum.filter(fn {_hash, entries} -> length(entries) > 1 end)

    %{
      duplicate_paragraph_count: length(paragraph_groups),
      duplicate_paragraph_chapter_pairs:
        paragraph_groups
        |> Enum.take(@duplicate_pair_limit)
        |> Enum.map(fn {fingerprint, entries} ->
          %{
            fingerprint: String.slice(fingerprint, 0, 16),
            chapter_ids:
              entries |> Enum.map(fn {_fingerprint, chapter} -> chapter.id end) |> Enum.uniq(),
            chapter_seqs:
              entries |> Enum.map(fn {_fingerprint, chapter} -> chapter.seq end) |> Enum.uniq()
          }
        end),
      duplicate_chapter_count: length(chapter_groups),
      duplicate_chapter_pairs:
        chapter_groups
        |> Enum.take(@duplicate_pair_limit)
        |> Enum.map(fn {hash, entries} ->
          %{
            fingerprint: String.slice(hash, 0, 16),
            chapter_ids: Enum.map(entries, & &1.id),
            chapter_seqs: Enum.map(entries, & &1.seq)
          }
        end)
    }
  end

  @doc """
  确定性缺章统计（P1 checkpoint C）：计划 seq 与已采纳正文 seq 的差集。
  planned 为空时明确 `missing_not_applicable=true`，rate=0，不伪造 0% 达标。
  """
  @spec missing_analysis([integer()], [integer()]) :: map()
  def missing_analysis(planned_seqs, accepted_seqs)
      when is_list(planned_seqs) and is_list(accepted_seqs) do
    planned = planned_seqs |> Enum.filter(&is_integer/1) |> Enum.uniq() |> Enum.sort()
    accepted = accepted_seqs |> Enum.filter(&is_integer/1) |> Enum.uniq()
    missing = Enum.reject(planned, &(&1 in accepted))

    %{
      planned_chapter_count: length(planned),
      missing_chapter_count: length(missing),
      missing_chapter_rate: if(planned == [], do: 0.0, else: length(missing) / length(planned)),
      missing_chapter_seqs: missing,
      missing_not_applicable: planned == []
    }
  end

  defp paragraphs(content) when is_binary(content) do
    content
    |> String.split(~r/\n\s*\n/u, trim: true)
    |> Enum.map(&normalize_text/1)
    |> Enum.reject(fn text -> text == "" or punctuation_only?(text) end)
    |> Enum.map(&sha256/1)
    |> Enum.uniq()
  end

  defp paragraphs(_content), do: []

  defp full_fingerprint(content) when is_binary(content) do
    text =
      content
      |> String.replace(~r/\s+/u, " ")
      |> String.trim()

    if text == "", do: nil, else: sha256(text)
  end

  defp full_fingerprint(_content), do: nil

  defp normalize_text(text) do
    text |> String.replace(~r/\s+/u, " ") |> String.trim()
  end

  defp punctuation_only?(text) do
    Regex.replace(~r/[\p{P}\p{S}\s]+/u, text, "") == ""
  end

  defp sha256(text), do: :crypto.hash(:sha256, text) |> Base.encode16(case: :lower)
end
