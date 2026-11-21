defmodule NovelPersistence.LocalizedRevision do
  @moduledoc """
  B36 / VS-00M §6.2：确定性源片段、显式区间替换与回执（纯函数，无 IO）。

  - 分段覆盖全文且原字节可重建；segment_id 绑定源位置和 raw hash；
  - 空行分隔符归前一源片段；超长段按行或完整 grapheme 切成不超过 4000 字节的块，
    单个超长 grapheme 独占一块；存储片段不是自然段或句子的修改边界；
  - item 显式绑定一个连续源区间，外层 items 顺序不决定应用顺序；
    授权外字节原样，区间内正文可以合并或拆成任意自然段；
  - whole 以原 items 顺序组合正文，不以新旧段数或长度比例猜完整性；
  - 作品、版本、hash 与覆盖资格由调用方在同一真实基线上复核。
  """

  alias NovelCommon.Contracts.ToolOutputContract

  @max_segment_bytes 4_000

  @type segment :: %{
          segment_id: String.t(),
          index: non_neg_integer(),
          byte_start: non_neg_integer(),
          byte_end: non_neg_integer(),
          raw: binary(),
          sha256: String.t(),
          occurrence: pos_integer()
        }

  @doc "把正文切为确定性段落块；重建 == 原文。"
  @spec segment(binary()) :: [segment()]
  def segment(text) when is_binary(text) do
    text
    |> paragraph_chunks()
    |> Enum.flat_map(&split_overlong/1)
    |> Enum.with_index()
    |> Enum.reduce({[], 0}, fn {raw, index}, {acc, offset} ->
      segment = %{
        segment_id: segment_id(index, raw),
        index: index,
        byte_start: offset,
        byte_end: offset + byte_size(raw),
        raw: raw,
        sha256: sha256(raw),
        occurrence: 1
      }

      {[segment | acc], offset + byte_size(raw)}
    end)
    |> elem(0)
    |> Enum.reverse()
    |> put_occurrences()
  end

  def segment(_text), do: []

  @doc """
  B82 G2：由既有分段派生页内可见段坐标（纯函数，不复制正文、不造新段 ID）。

  页范围是 canonical 正文的 0-based 字节半开区间。只列与该页正文实际相交的既有段：
  `byte_start/byte_end` 是整段正文（去尾分隔符，`split_segment_raw/1`），
  `page_range` 是该段在本页可见部分的 1-based 字素闭区间。部分段照常列出，
  跨页完整性由消费者按各页实际范围合并验证。
  """
  @spec page_segments(binary(), non_neg_integer(), non_neg_integer()) :: [map()]
  def page_segments(text, page_byte_start, page_byte_end)
      when is_binary(text) and is_integer(page_byte_start) and is_integer(page_byte_end) do
    text
    |> segment()
    |> Enum.flat_map(fn seg ->
      {content, _separator} = split_segment_raw(seg.raw)
      content_end = seg.byte_start + byte_size(content)
      from = max(seg.byte_start, page_byte_start)
      to = min(content_end, page_byte_end)

      if content_end > seg.byte_start and from < to do
        [page_segment(seg, content_end, text, page_byte_start, from, to)]
      else
        []
      end
    end)
  end

  def page_segments(_text, _page_byte_start, _page_byte_end), do: []

  defp page_segment(seg, content_end, text, page_byte_start, from, to) do
    %{
      segment_id: seg.segment_id,
      byte_start: seg.byte_start,
      byte_end: content_end,
      page_range: %{
        start: grapheme_length(text, page_byte_start, from - page_byte_start) + 1,
        end: grapheme_length(text, page_byte_start, to - page_byte_start)
      }
    }
  end

  defp grapheme_length(text, start_byte, length),
    do: text |> binary_part(start_byte, length) |> String.length()

  @doc "拆出段落正文与其尾部分隔符（空白行/换行原样保留，供段替换重组）。"
  @spec split_segment_raw(binary()) :: {binary(), binary()}
  def split_segment_raw(raw) when is_binary(raw) do
    case Regex.run(~r/(?:(?:\r\n|\n|\r)[ \t]*){2,}\z/u, raw, return: :index) do
      [{pos, len}] -> {binary_part(raw, 0, pos), binary_part(raw, pos, len)}
      _ -> {raw, ""}
    end
  end

  @doc "按候选原顺序用双 LF 组合 body；只验证非空，不改写正文。"
  @spec compose_content([map()]) :: {:ok, binary()} | {:error, :incomplete_scope}
  def compose_content(items) when is_list(items) and items != [] do
    if Enum.all?(items, &valid_body?/1),
      do: {:ok, Enum.map_join(items, "\n\n", &item_field(&1, :body))},
      else: {:error, :incomplete_scope}
  end

  def compose_content(_items), do: {:error, :incomplete_scope}

  @doc """
  按 item 的显式连续源区间应用正文；区间外字节不变，末尾源分隔符保留一次。
  版本/hash 由调用方用同一真实基线核验；原始授权和映射先校验，再构造查找表。
  """
  @spec replace_segments([segment()], [String.t()], [map()]) ::
          {:ok, binary(), map()} | {:error, :incomplete_scope | :out_of_scope_changes}
  def replace_segments(base_segments, target_ids, items)
      when is_list(base_segments) and base_segments != [] and is_list(target_ids) do
    with {:ok, _content} <- compose_content(items),
         true <- valid_ids?(target_ids),
         :ok <- ToolOutputContract.validate_unique_item_ids(items, []),
         {:ok, regions} <- bind_regions(base_segments, items),
         :ok <- validate_selection(base_segments, target_ids, regions) do
      replacements = region_replacements(base_segments, regions)

      pairs = Enum.map(base_segments, &{&1, Map.get(replacements, &1.segment_id, &1.raw)})
      replacement_result(base_segments, pairs, target_ids)
    else
      {:error, reason} when is_atom(reason) -> {:error, reason}
      _ -> {:error, :incomplete_scope}
    end
  end

  def replace_segments(_base_segments, _target_ids, _items), do: {:error, :incomplete_scope}

  @doc "完整章替换不依赖新旧段数或字数比例；正文与旧 source slots 回执共用同一纯应用。"
  @spec replace_scope([segment()], [map()]) ::
          {:ok, binary(), map()} | {:error, :incomplete_scope}
  def replace_scope(base_segments, items) when is_list(base_segments) and base_segments != [] do
    with {:ok, content} <- compose_content(items),
         false <- Enum.any?(items, &mapped_item?/1),
         :ok <- ToolOutputContract.validate_unique_item_ids(items, []) do
      pairs = replacement_pairs(base_segments, content)
      replacement_result(base_segments, pairs, [])
    else
      _ -> {:error, :incomplete_scope}
    end
  end

  def replace_scope(_base_segments, _items), do: {:error, :incomplete_scope}

  defp diff_info(old_text, new_text, segment_count, pairs, target_ids) do
    changes = Enum.reject(pairs, fn {old, new_raw} -> old.raw == new_raw end)

    %{
      old_chars: String.length(old_text),
      new_chars: String.length(new_text),
      target_segment_ids: target_ids,
      segment_changes:
        Enum.map(changes, fn {old, new_raw} ->
          %{
            segment_id: old.segment_id,
            old_sha: old.sha256,
            new_sha: sha256(new_raw),
            kind: "modified"
          }
        end),
      diff_stats: %{
        segment_count: segment_count,
        changed_segment_count: length(changes),
        changed_old_chars: changes |> Enum.map(fn {o, _n} -> byte_size(o.raw) end) |> Enum.sum(),
        changed_new_chars: changes |> Enum.map(fn {_o, n} -> byte_size(n) end) |> Enum.sum()
      }
    }
  end

  defp valid_body?(item) when is_map(item) do
    body = item_field(item, :body)
    is_binary(body) and String.trim(body) != ""
  end

  defp valid_body?(_item), do: false

  defp item_field(item, key), do: Map.get(item, key, Map.get(item, to_string(key)))

  defp mapped_item?(item),
    do: Map.has_key?(item, :target_segment_ids) or Map.has_key?(item, "target_segment_ids")

  defp valid_ids?(ids) when is_list(ids) and ids != [] do
    Enum.all?(ids, &(is_binary(&1) and &1 != "")) and
      length(ids) == MapSet.size(MapSet.new(ids))
  end

  defp valid_ids?(_ids), do: false

  defp bind_regions(base_segments, items) do
    positions =
      Map.new(Enum.with_index(base_segments), fn {segment, index} ->
        {segment.segment_id, index}
      end)

    Enum.reduce_while(items, {:ok, []}, fn item, {:ok, regions} ->
      ids = item_field(item, :target_segment_ids)
      item_id = item_field(item, :item_id)

      with true <- is_binary(item_id) and String.trim(item_id) != "",
           true <- valid_ids?(ids),
           indexes = Enum.map(ids, &Map.get(positions, &1)),
           true <- Enum.all?(indexes, &is_integer/1),
           true <- indexes == Enum.to_list(hd(indexes)..(hd(indexes) + length(ids) - 1)) do
        {:cont, {:ok, [{hd(indexes), length(ids), item_field(item, :body)} | regions]}}
      else
        _ -> {:halt, {:error, :incomplete_scope}}
      end
    end)
  end

  defp validate_selection(base_segments, target_ids, regions) do
    selected =
      Enum.flat_map(regions, fn {start, count, _body} ->
        base_segments |> Enum.slice(start, count) |> Enum.map(& &1.segment_id)
      end)

    selected_set = MapSet.new(selected)
    target_set = MapSet.new(target_ids)

    cond do
      length(selected) != MapSet.size(selected_set) -> {:error, :incomplete_scope}
      not MapSet.subset?(selected_set, target_set) -> {:error, :out_of_scope_changes}
      selected_set != target_set -> {:error, :incomplete_scope}
      true -> :ok
    end
  end

  defp region_replacements(base_segments, regions) do
    Enum.reduce(regions, %{}, fn {start, count, body}, acc ->
      source = Enum.slice(base_segments, start, count)
      {_last_body, separator} = split_segment_raw(List.last(source).raw)

      source
      |> replacement_pairs(body <> separator)
      |> Enum.reduce(acc, fn {segment, raw}, map -> Map.put(map, segment.segment_id, raw) end)
    end)
  end

  defp replacement_pairs(source, replacement) do
    if Enum.map_join(source, & &1.raw) == replacement do
      Enum.map(source, &{&1, &1.raw})
    else
      [first | rest] = source
      [{first, replacement} | Enum.map(rest, &{&1, ""})]
    end
  end

  defp replacement_result(base_segments, pairs, target_ids) do
    old_text = Enum.map_join(base_segments, & &1.raw)
    new_text = Enum.map_join(pairs, fn {_old, raw} -> raw end)
    {:ok, new_text, diff_info(old_text, new_text, length(base_segments), pairs, target_ids)}
  end

  # ── 分段实现 ─────────────────────────────────────────────────────────

  # 行级扫描：保留每行原换行符；空行（仅空白+换行）附着到前一段尾部；
  # 连续空行/CRLF 保真；末尾无换行也成段。
  defp paragraph_chunks(""), do: []

  defp paragraph_chunks(text) do
    {chunks, current} =
      text
      |> split_lines_with_endings()
      |> Enum.reduce({[], []}, fn {line, ending}, {chunks, current} ->
        if String.trim(line) == "" and current != [] do
          {chunks ++ [current ++ [{line, ending}]], []}
        else
          {chunks, current ++ [{line, ending}]}
        end
      end)

    chunks = if current == [], do: chunks, else: chunks ++ [current]

    Enum.map(chunks, fn lines ->
      Enum.map_join(lines, fn {line, ending} -> line <> ending end)
    end)
  end

  defp split_lines_with_endings(text) do
    text
    |> then(&Regex.scan(~r/\r\n|\n|\r/, &1, return: :index))
    |> Enum.map(&hd/1)
    |> Enum.reduce({[], 0}, fn {pos, len}, {acc, start} ->
      line = binary_part(text, start, pos - start)
      ending = binary_part(text, pos, len)
      {[{line, ending} | acc], pos + len}
    end)
    |> then(fn {acc, start} ->
      rest = binary_part(text, start, byte_size(text) - start)
      rest = if rest == "", do: [], else: [{rest, ""}]
      Enum.reverse(acc) ++ rest
    end)
  end

  # 超长段按行边界切；单行本身超长则按固定字节窗切（仍保证重建==原文）。
  defp split_overlong(raw) when byte_size(raw) <= @max_segment_bytes, do: [raw]

  defp split_overlong(raw) do
    raw
    |> split_lines_with_endings()
    |> Enum.map(fn {line, ending} -> line <> ending end)
    |> Enum.flat_map(&split_piece/1)
    |> Enum.reduce({[], ""}, fn piece, {chunks, current} ->
      if current == "" or byte_size(current) + byte_size(piece) <= @max_segment_bytes do
        {chunks, current <> piece}
      else
        {chunks ++ [current], piece}
      end
    end)
    |> then(fn {chunks, current} -> if current == "", do: chunks, else: chunks ++ [current] end)
  end

  defp split_piece(piece) when byte_size(piece) <= @max_segment_bytes, do: [piece]

  # 单行超长：按完整 grapheme 装到 <= max；单个 grapheme 本身超长则独占一段。
  defp split_piece(piece), do: grapheme_chunks(piece, 0, 0, [], byte_size(piece))

  defp grapheme_chunks(piece, start, size, acc, rest) when rest <= 0 do
    chunks = if size == 0, do: acc, else: [binary_part(piece, start, size) | acc]
    Enum.reverse(chunks)
  end

  defp grapheme_chunks(piece, start, size, acc, rest) do
    {grapheme, _rest} = String.next_grapheme(binary_part(piece, start + size, rest))
    grapheme_size = byte_size(grapheme)

    if size > 0 and size + grapheme_size > @max_segment_bytes do
      chunk = binary_part(piece, start, size)
      grapheme_chunks(piece, start + size, grapheme_size, [chunk | acc], rest - grapheme_size)
    else
      grapheme_chunks(piece, start, size + grapheme_size, acc, rest - grapheme_size)
    end
  end

  defp segment_id(index, raw), do: "seg_#{index}_#{binary_part(sha256(raw), 0, 12)}"

  defp sha256(raw), do: :crypto.hash(:sha256, raw) |> Base.encode16(case: :lower)

  defp put_occurrences(segments) do
    segments
    |> Enum.reduce({%{}, []}, fn seg, {counts, acc} ->
      seen = Map.get(counts, seg.sha256, 0) + 1
      {Map.put(counts, seg.sha256, seen), [%{seg | occurrence: seen} | acc]}
    end)
    |> elem(1)
    |> Enum.reverse()
  end
end
