defmodule NovelPersistence.LocalizedRevision do
  @moduledoc """
  B36 CP1：确定性分段 + 局部修订 diff 机械校验（纯函数，无 IO）。

  契约（B36 §2）：
  - 分段覆盖全文、无重叠，`Enum.map_join(segments, & &1.raw) == text`；
  - segment_id = `seg_<index>_<sha256(raw)[0..11]>`（index 0 基，重复正文也唯一）；
  - 空行分隔段落；CRLF/CR/LF 原样保留在 segment.raw（分隔空行归入前一段）；
  - 超长段按行边界再切；单行超长按完整 grapheme 打包（常规段 <= 4000 字节，
    单个本身过大的 grapheme 独占一段），每段均为合法 UTF-8，仍保证重建==原文；
  - diff 校验只在目标 segment 集合内允许变化；集合外逐字节相同，否则
    `out_of_scope_changes`；空/截断/无法证明范围 -> `incomplete_scope`；
    版本不符 -> `stale_base_version`。
  """

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

  @doc "由 segment_id 列表取目标段；未知 id 保持原样（交给校验器拒绝）。"
  @spec normalize_target_ids([String.t()] | nil) :: [String.t()]
  def normalize_target_ids(nil), do: []
  def normalize_target_ids(ids), do: ids |> List.wrap() |> Enum.map(&to_string/1) |> Enum.uniq()

  @doc """
  diff 校验：base 与候选正文逐段比较。

  opts:
  - `:scope` — "target_segments" | "whole_chapter" | "format_only"（默认 target_segments）
  - `:target_segment_ids` — 目标段 id（target_segments 必需；空 => incomplete_scope）
  - `:base_version` / `:current_version` — 可选版本校验（不等 => stale_base_version）
  """
  @spec validate(binary(), binary(), keyword()) ::
          {:ok, map()}
          | {:error, :incomplete_scope | :out_of_scope_changes | :stale_base_version}
  def validate(base_text, candidate_text, opts \\ [])

  def validate(base_text, candidate_text, opts)
      when is_binary(base_text) and is_binary(candidate_text) do
    scope = to_string(Keyword.get(opts, :scope) || "target_segments")
    target_ids = normalize_target_ids(Keyword.get(opts, :target_segment_ids))

    with :ok <- validate_version(opts),
         base when base != [] <- segment(base_text),
         candidate when candidate != [] <- segment(candidate_text),
         :ok <- validate_segment_count(base, candidate),
         :ok <- validate_scope(base, candidate, scope, target_ids) do
      pairs =
        base
        |> Enum.zip(candidate)
        |> Enum.map(fn {old, new} -> {old, new.raw} end)

      {:ok, diff_info(base_text, candidate_text, length(base), pairs, target_ids)}
    else
      [] -> {:error, :incomplete_scope}
      {:error, reason} -> {:error, reason}
      _ -> {:error, :incomplete_scope}
    end
  end

  def validate(_base, _candidate, _opts), do: {:error, :incomplete_scope}

  @doc """
  结构化段替换：按真实 base_segments 绑定目标 id 与新片段。

  调用前由既有事务绑定并校验 version / hash / id / 数量；本函数不再重复校验或归一化。
  每个目标段替换为“新片段 + 原尾分隔符”，其余段逐字节原样；diff 信息直接由绑定的
  旧/新片段派生，不再对候选全文重切（避免定长虚拟段窗口前移造成越界误判）。
  空/只空白片段 -> `incomplete_scope`；单片新增空行段落 -> `out_of_scope_changes`。
  """
  @spec replace_segments([segment()], [String.t()], [binary()]) ::
          {:ok, binary(), map()} | {:error, :incomplete_scope | :out_of_scope_changes}
  def replace_segments(base_segments, target_ids, pieces) do
    with :ok <- validate_pieces(pieces),
         :ok <- validate_piece_paragraphs(pieces) do
      by_id = Map.new(Enum.zip(target_ids, pieces))
      pairs = Enum.map(base_segments, &pair_for_segment(&1, by_id))

      old_text = Enum.map_join(pairs, fn {old, _new_raw} -> old.raw end)
      new_text = Enum.map_join(pairs, fn {_old, new_raw} -> new_raw end)

      {:ok, new_text, diff_info(old_text, new_text, length(base_segments), pairs, target_ids)}
    end
  end

  defp pair_for_segment(seg, by_id) do
    case Map.fetch(by_id, seg.segment_id) do
      {:ok, piece} ->
        {_content, separator} = split_segment_raw(seg.raw)
        {seg, piece <> separator}

      :error ->
        {seg, seg.raw}
    end
  end

  defp validate_pieces(pieces) do
    if Enum.any?(pieces, &(String.trim(&1) == "")),
      do: {:error, :incomplete_scope},
      else: :ok
  end

  # 段落边界只看 pieces 本身；拼回原 separator 后的形态不参与判定。
  defp validate_piece_paragraphs(pieces) do
    if Enum.any?(pieces, &(length(paragraph_chunks(&1)) > 1)),
      do: {:error, :out_of_scope_changes},
      else: :ok
  end

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
            kind: change_kind(old.raw, new_raw)
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

  defp validate_version(opts) do
    expected = Keyword.get(opts, :base_version)
    current = Keyword.get(opts, :current_version)

    if is_nil(expected) or is_nil(current) or to_string(expected) == to_string(current),
      do: :ok,
      else: {:error, :stale_base_version}
  end

  defp validate_segment_count(base, candidate) when length(candidate) < length(base),
    do: {:error, :incomplete_scope}

  defp validate_segment_count(base, candidate) when length(candidate) > length(base),
    do: {:error, :out_of_scope_changes}

  defp validate_segment_count(_base, _candidate), do: :ok

  defp validate_scope(_base, _candidate, scope, _target_ids)
       when scope in ["whole_chapter", "format_only"],
       do: :ok

  defp validate_scope(base, candidate, _scope, target_ids) do
    known = MapSet.new(Enum.map(base, & &1.segment_id))
    target = MapSet.new(target_ids)

    with :ok <- validate_known_targets(target_ids, known) do
      check_out_of_scope(Enum.zip(base, candidate), target)
    end
  end

  defp validate_known_targets(target_ids, known) do
    if Enum.any?(target_ids, &(not MapSet.member?(known, &1))),
      do: {:error, :incomplete_scope},
      else: :ok
  end

  defp check_out_of_scope(pairs, target) do
    case Enum.find(pairs, fn {old, new} ->
           old.raw != new.raw and not MapSet.member?(target, old.segment_id)
         end) do
      nil -> :ok
      _ -> {:error, :out_of_scope_changes}
    end
  end

  defp change_kind(_old, _new), do: "modified"

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
