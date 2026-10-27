defmodule NovelApplication.ChapterStructureMaintenance do
  @moduledoc """
  B30 CP1：章节结构维护（首闭环 `renumber_chapters`）的可审阅变更计划构建。

  边界：
  - 只读既有章结构事实（chapter_ref/seq/title/version），不写库、不改 title/正文/归卷/章数。
  - 只产出 change plan（mapping old→new、object_count、effects、warnings、base_versions），
    作为候选 artifact payload；采纳写入由 AdoptionWorkflow/持久层（B30 CP2）执行。
  - 缺目标/越界/歧义不猜：返回可解释错误码；同名/多卷不默认选择。
  """

  @effect "display_number_only"
  @operation "renumber_chapters"

  @doc "作者原话是否表达章节结构维护（重编号）意图。"
  def intent?(text) when is_binary(text) do
    normalized = text

    (String.contains?(normalized, ["编号", "序号", "章号", "重编号", "列表号"]) or
       String.contains?(normalized, ["章节顺序", "结构编号", "编号理顺"])) and
      String.contains?(normalized, ["卷", "章", "章节", "目录", "列表"])
  end

  def intent?(_text), do: false

  @doc """
  从读端口事实 + 作者原话构建 change plan（纯函数，不访问 DB）。

  facts：
    %{work_id, volume_ref: volume:<id>|nil,
      volumes: [%{volume_ref, title, seq}],
      chapters: [%{chapter_ref, volume_ref, seq, title, version, content_hash, accepted_summary_refs}]}

  返回 `{:ok, change_plan}`（mapping/object_count/effects/base_versions/warnings）
  或 `{:error, code}`（:no_target/:target_ambiguous/:out_of_range）。
  （B60：原文档列出的 :unsupported_effect 没有生产者，已从错误面移除。）
  """
  def change_plan(author_text, facts) when is_binary(author_text) and is_map(facts) do
    chapters = normalize_chapters(Map.get(facts, :chapters) || facts["chapters"])
    volumes = Map.get(facts, :volumes) || Map.get(facts, "volumes") || []

    with {:ok, volume_ref} <- scope_volume_ref(author_text, facts, volumes),
         {:ok, scoped} <- scoped_chapters(chapters, volume_ref),
         {:ok, mapping} <- mapping_for(author_text, scoped, chapters, volumes, volume_ref) do
      mapping = Enum.sort_by(mapping, & &1.from_seq)

      {:ok,
       %{
         operation: @operation,
         mapping: mapping,
         object_count: length(mapping),
         effects: [@effect],
         base_versions:
           Enum.map(mapping, fn entry ->
             %{chapter_ref: entry.chapter_ref, version: entry.expected_version}
           end),
         warnings: warnings(mapping, scoped)
       }}
    end
  end

  @doc "读取既有章结构事实（只读；aux task-61 提供读端口）。"
  def load_context(work_id, volume_ref \\ nil) do
    NovelPersistence.AdoptionRepository.chapter_structure_context(work_id, volume_ref)
  end

  defp normalize_chapters(chapters) when is_list(chapters) do
    Enum.filter(chapters, &is_map/1)
  end

  defp normalize_chapters(_), do: []

  defp scope_volume_ref(author_text, facts, volumes) do
    case explicit_volume_ref(facts) do
      ref when is_binary(ref) -> {:ok, ref}
      _ -> scope_volume_from_text(author_text, volumes)
    end
  end

  defp explicit_volume_ref(facts), do: Map.get(facts, :volume_ref) || Map.get(facts, "volume_ref")

  defp scope_volume_from_text(_author_text, []), do: {:ok, nil}

  defp scope_volume_from_text(author_text, volumes) do
    case volume_number_from_text(author_text, volumes) do
      nil -> default_volume(volumes)
      {:ok, ref} -> {:ok, ref}
      {:error, reason} -> {:error, reason}
    end
  end

  defp default_volume([volume]), do: {:ok, volume_ref(volume)}
  defp default_volume(_volumes), do: {:error, :target_ambiguous}

  # 作者原话的“第N卷”按卷 seq/中文序数匹配；不存在的卷 → :out_of_range（C1 不误路由）。
  defp volume_number_from_text(author_text, volumes) do
    case Regex.run(~r/第\s*([0-9一二三四五六七八九十]+)\s*卷/u, author_text) do
      [_, raw] -> resolve_volume_number(raw, volumes)
      _ -> nil
    end
  end

  defp resolve_volume_number(raw, volumes) do
    number = chapter_number(raw)

    matches =
      Enum.filter(volumes, fn volume ->
        volume_seq(volume) == number or volume_title_matches?(volume, raw)
      end)

    resolve_volume_matches(matches)
  end

  defp resolve_volume_matches([volume]), do: {:ok, volume_ref(volume)}
  defp resolve_volume_matches([]), do: {:error, :out_of_range}
  defp resolve_volume_matches(_matches), do: {:error, :target_ambiguous}

  defp volume_title_matches?(volume, raw) do
    title = to_string(Map.get(volume, :title) || Map.get(volume, "title"))
    String.contains?(title, "第#{raw}卷")
  end

  defp volume_ref(volume), do: Map.get(volume, :volume_ref) || Map.get(volume, "volume_ref")

  defp volume_seq(volume), do: Map.get(volume, :seq) || Map.get(volume, "seq")

  defp scoped_chapters(chapters, volume_ref) do
    scoped =
      case volume_ref do
        nil ->
          chapters

        ref ->
          Enum.filter(chapters, fn chapter ->
            (Map.get(chapter, :volume_ref) || Map.get(chapter, "volume_ref")) == ref
          end)
      end

    scoped =
      Enum.sort_by(scoped, fn chapter ->
        {Map.get(chapter, :seq) || Map.get(chapter, "seq") || 0, Map.get(chapter, :chapter_ref)}
      end)

    if scoped == [], do: {:error, :no_target}, else: {:ok, scoped}
  end

  defp mapping_for(author_text, scoped, all_chapters, volumes, volume_ref) do
    case explicit_chapter_numbers(author_text) do
      [] ->
        {:ok, dense_mapping(scoped, all_chapters, volumes, volume_ref)}

      numbers ->
        swap_or_reassign(numbers, scoped)
    end
  end

  # 默认重编号：按阅读顺序（seq 升序）在当前卷/作品内生成连续 seq。
  defp dense_mapping(scoped, all_chapters, volumes, volume_ref) do
    start_seq = scope_start_seq(volume_ref, all_chapters, volumes)

    scoped
    |> Enum.with_index(start_seq)
    |> Enum.map(fn {chapter, new_seq} ->
      %{
        chapter_ref: chapter_ref(chapter),
        expected_seq: seq(chapter),
        expected_version: version(chapter),
        from_seq: seq(chapter),
        to_seq: new_seq
      }
    end)
  end

  # 卷内重编号起点=前面所有卷的章数 + 1；作品范围=1。
  defp scope_start_seq(nil, _all_chapters, _volumes), do: 1

  defp scope_start_seq(volume_ref, all_chapters, volumes) do
    selected_seq = volume_seq_of(volume_ref, volumes)

    prior_count =
      Enum.count(all_chapters, &(volume_seq_of(Map.get(&1, :volume_ref), volumes) < selected_seq))

    prior_count + 1
  end

  defp volume_seq_of(nil, _volumes), do: 0

  defp volume_seq_of(volume_ref, volumes) do
    case Enum.find(
           volumes,
           &((Map.get(&1, :volume_ref) || Map.get(&1, "volume_ref")) == volume_ref)
         ) do
      nil -> 0
      volume -> volume_seq(volume) || 0
    end
  end

  # 作者点名两个章号时按序号对调（唯一匹配才执行；同名/多义不猜）。
  defp swap_or_reassign(numbers, scoped) do
    with {:ok, first} <- find_by_number(numbers |> List.first(), scoped),
         {:ok, second} <- find_by_number(numbers |> List.last(), scoped),
         true <- first != second do
      first_seq = seq(first)
      second_seq = seq(second)

      {:ok,
       [
         mapping_entry(second, second_seq, first_seq),
         mapping_entry(first, first_seq, second_seq)
       ]}
    else
      false -> {:error, :target_ambiguous}
      {:error, reason} -> {:error, reason}
    end
  end

  defp find_by_number(number, scoped) do
    matches =
      Enum.filter(scoped, fn chapter ->
        title_number(Map.get(chapter, :title)) == number or seq(chapter) == number
      end)

    case matches do
      [chapter] -> {:ok, chapter}
      [] -> {:error, :no_target}
      _ -> {:error, :target_ambiguous}
    end
  end

  defp mapping_entry(chapter, from_seq, to_seq) do
    %{
      chapter_ref: chapter_ref(chapter),
      expected_seq: from_seq,
      expected_version: version(chapter),
      from_seq: from_seq,
      to_seq: to_seq
    }
  end

  defp warnings(mapping, scoped) do
    mismatch_warnings =
      Enum.flat_map(scoped, fn chapter ->
        title_no = title_number(Map.get(chapter, :title))
        actual = seq(chapter)

        if is_integer(title_no) and title_no != actual do
          [
            "title_number_mismatch: #{chapter_ref(chapter)} 标题章号=#{title_no} 但 seq=#{actual}；" <>
              "展示以 seq 为准，历史 title 不改写"
          ]
        else
          []
        end
      end)

    change_warnings =
      if Enum.all?(mapping, &(&1.from_seq == &1.to_seq)),
        do: ["nothing_to_change"],
        else: []

    mismatch_warnings ++ change_warnings
  end

  defp explicit_chapter_numbers(author_text) do
    ~r/第\s*(\d+)\s*章/u
    |> Regex.scan(author_text)
    |> Enum.map(fn [_, n] -> String.to_integer(n) end)
    |> Enum.uniq()
  end

  defp chapter_number(raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, ""} ->
        n

      _ ->
        Map.get(
          %{
            "一" => 1,
            "二" => 2,
            "三" => 3,
            "四" => 4,
            "五" => 5,
            "六" => 6,
            "七" => 7,
            "八" => 8,
            "九" => 9,
            "十" => 10
          },
          raw
        )
    end
  end

  defp title_number(title) do
    case Regex.run(~r/第\s*(\d+)\s*章/u, to_string(title)) do
      [_, n] -> String.to_integer(n)
      _ -> nil
    end
  end

  defp chapter_ref(chapter), do: Map.get(chapter, :chapter_ref) || Map.get(chapter, "chapter_ref")
  defp seq(chapter), do: Map.get(chapter, :seq) || Map.get(chapter, "seq")
  defp version(chapter), do: Map.get(chapter, :version) || Map.get(chapter, "version")
end
