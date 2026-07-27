defmodule NovelApplication.ProseFormCandidateAnalyzer do
  @moduledoc """
  正文局部形式异常候选分析器（VS-00E）。

  只负责召回连续句段中可机械验证的形式相似信号：相同句首、相同完整标点骨架与接近的
  句长。输出是 `form_candidate` plain map，不是 `QualityFinding`；是否属于机械重复，
  必须由独立语义 evaluator 结合递进、修辞意图和上下文判断。

  纯函数，无 I/O。
  """

  @minimum_run 3
  @maximum_length_spread_ratio 0.35
  @sentence_pattern ~r/[^。！？!?\n]+[。！？!?]?/u
  @punctuation_pattern ~r/[，,；;：:。！？!?、—…]+/u

  @type candidate :: map()

  @spec detect(String.t() | nil) :: [candidate()]
  def detect(text) when is_binary(text) and text != "" do
    text
    |> sentences()
    |> Enum.chunk_by(&signature/1)
    |> Enum.flat_map(&candidates_from_run/1)
  end

  def detect(_text), do: []

  defp sentences(text) do
    @sentence_pattern
    |> Regex.scan(text, return: :index)
    |> Enum.with_index(1)
    |> Enum.map(fn {[{offset, length}], sentence_index} ->
      raw = binary_part(text, offset, length)
      trimmed = String.trim(raw)
      leading_bytes = byte_size(raw) - byte_size(String.trim_leading(raw))
      start_offset = offset + leading_bytes

      %{
        text: trimmed,
        sentence_index: sentence_index,
        start_offset: start_offset,
        end_offset: start_offset + byte_size(trimmed),
        opening: opening_signature(trimmed),
        punctuation_skeleton: punctuation_skeleton(trimmed),
        grapheme_length: grapheme_length(trimmed)
      }
    end)
    |> Enum.reject(&(&1.text == ""))
  end

  defp signature(sentence), do: {sentence.opening, sentence.punctuation_skeleton}

  defp candidates_from_run(run) when length(run) < @minimum_run, do: []

  defp candidates_from_run(run) do
    if similar_lengths?(run) do
      [candidate(run)]
    else
      run
      |> Enum.chunk_every(@minimum_run, 1, :discard)
      |> Enum.filter(&similar_lengths?/1)
      |> Enum.reduce([], &append_non_overlapping_candidate/2)
    end
  end

  defp append_non_overlapping_candidate(window, acc) do
    if overlaps_previous?(window, acc), do: acc, else: acc ++ [candidate(window)]
  end

  defp similar_lengths?(sentences) do
    lengths = Enum.map(sentences, & &1.grapheme_length)
    minimum = Enum.min(lengths)
    maximum = Enum.max(lengths)
    average = Enum.sum(lengths) / length(lengths)

    average > 0 and (maximum - minimum) / average <= @maximum_length_spread_ratio
  end

  defp overlaps_previous?(_window, []), do: false

  defp overlaps_previous?(window, candidates) do
    first_index = window |> List.first() |> Map.fetch!(:sentence_index)
    last = List.last(candidates)
    first_index <= last["sentence_end"]
  end

  defp candidate(sentences) do
    first = List.first(sentences)
    last = List.last(sentences)
    evidence_text = Enum.map_join(sentences, "", & &1.text)

    candidate_id =
      "fc_" <>
        (:crypto.hash(:sha256, evidence_text)
         |> Base.encode16(case: :lower)
         |> String.slice(0, 12))

    %{
      "candidate_id" => candidate_id,
      "detector_ref" => "detector.sentence_structure_uniformity",
      "sentence_start" => first.sentence_index,
      "sentence_end" => last.sentence_index,
      "evidence_spans" => [
        %{
          "text" => evidence_text,
          "sentence_start" => first.sentence_index,
          "sentence_end" => last.sentence_index,
          "start_offset" => first.start_offset,
          "end_offset" => last.end_offset
        }
      ],
      "signals" => %{
        "opening" => first.opening,
        "punctuation_skeleton" => first.punctuation_skeleton,
        "grapheme_lengths" => Enum.map(sentences, & &1.grapheme_length),
        "length_spread_ratio" => length_spread_ratio(sentences)
      }
    }
  end

  defp length_spread_ratio(sentences) do
    lengths = Enum.map(sentences, & &1.grapheme_length)
    average = Enum.sum(lengths) / length(lengths)
    Float.round((Enum.max(lengths) - Enum.min(lengths)) / average, 3)
  end

  defp opening_signature(text) do
    text
    |> String.graphemes()
    |> Enum.reject(&(&1 =~ ~r/\s/u))
    |> List.first()
    |> to_string()
  end

  defp punctuation_skeleton(text) do
    @punctuation_pattern
    |> Regex.scan(text)
    |> Enum.map_join("", &hd/1)
  end

  defp grapheme_length(text), do: text |> String.graphemes() |> length()
end
