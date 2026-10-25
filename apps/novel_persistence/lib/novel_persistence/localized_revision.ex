defmodule NovelPersistence.LocalizedRevision do
  @moduledoc """
  B36 CP1：确定性分段 + 局部修订 diff 机械校验（纯函数，无 IO）。

  契约（B36 §2）：
  - 分段覆盖全文、无重叠，`Enum.map_join(segments, & &1.raw) == text`；
  - segment_id = `seg_<index>_<sha256(raw)[0..11]>`（index 0 基，重复正文也唯一）；
  - 空行分隔段落；CRLF/CR/LF 原样保留在 segment.raw（分隔空行归入前一段）；
  - 超长段按行边界再切，仍保证重建==原文；
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

      {acc ++ [segment], offset + byte_size(raw)}
    end)
    |> elem(0)
    |> put_occurrences()
  end

  def segment(_text), do: []

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

    with :ok <- validate_version(opts),
         base when base != [] <- segment(base_text),
         candidate when candidate != [] <- segment(candidate_text),
         :ok <- validate_segment_count(base, candidate),
         :ok <-
           validate_scope(
             base,
             candidate,
             scope,
             normalize_target_ids(Keyword.get(opts, :target_segment_ids))
           ) do
      changes =
        base
        |> Enum.zip(candidate)
        |> Enum.reject(fn {old, new} -> old.raw == new.raw end)

      {:ok,
       %{
         old_chars: String.length(base_text),
         new_chars: String.length(candidate_text),
         target_segment_ids: normalize_target_ids(Keyword.get(opts, :target_segment_ids)),
         segment_changes:
           Enum.map(changes, fn {old, new} ->
             %{
               segment_id: old.segment_id,
               old_sha: old.sha256,
               new_sha: new.sha256,
               kind: change_kind(old.raw, new.raw)
             }
           end),
         diff_stats: %{
           segment_count: length(base),
           changed_segment_count: length(changes),
           changed_old_chars:
             changes |> Enum.map(fn {o, _n} -> byte_size(o.raw) end) |> Enum.sum(),
           changed_new_chars:
             changes |> Enum.map(fn {_o, n} -> byte_size(n.raw) end) |> Enum.sum()
         }
       }}
    else
      [] -> {:error, :incomplete_scope}
      {:error, reason} -> {:error, reason}
      _ -> {:error, :incomplete_scope}
    end
  end

  def validate(_base, _candidate, _opts), do: {:error, :incomplete_scope}

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

  defp split_piece(piece) do
    size = byte_size(piece)

    0
    |> Stream.iterate(&(&1 + @max_segment_bytes))
    |> Stream.take_while(&(&1 < size))
    |> Enum.map(fn offset ->
      binary_part(piece, offset, min(@max_segment_bytes, size - offset))
    end)
    |> then(fn chunks -> chunks end)
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
